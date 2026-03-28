use crate::{
    models::{Agent, Session, SessionOutputPayload, SessionStatus, SessionStatusPayload},
    state::{DbState, ProcessState},
};
use rusqlite::params;
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::{Emitter, State};
use uuid::Uuid;

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<Session> {
    let status_str: String = row.get(4)?;
    let status = match status_str.as_str() {
        "running" => SessionStatus::Running,
        "error" => SessionStatus::Error,
        _ => SessionStatus::Stopped,
    };
    Ok(Session {
        id: row.get(0)?,
        name: row.get(1)?,
        workspace_id: row.get(2)?,
        agent_id: row.get(3)?,
        status,
        pid: row.get(5)?,
        created_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn session_list(workspace_id: String, db: State<DbState>) -> Result<Vec<Session>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, workspace_id, agent_id, status, pid, created_at
             FROM sessions WHERE workspace_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map(params![workspace_id], row_to_session)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

#[tauri::command]
pub fn session_list_all(db: State<DbState>) -> Result<Vec<Session>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, workspace_id, agent_id, status, pid, created_at
             FROM sessions ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map([], row_to_session)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

#[tauri::command]
pub fn session_start(
    name: String,
    workspace_id: String,
    agent_id: String,
    app: tauri::AppHandle,
    db: State<DbState>,
    processes: State<ProcessState>,
) -> Result<Session, String> {
    // Load agent config
    let agent: Agent = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, name, command, args, env, is_built_in FROM agents WHERE id = ?1",
            params![agent_id],
            |row| {
                let args_json: String = row.get(3)?;
                let env_json: String = row.get(4)?;
                let is_built_in: i64 = row.get(5)?;
                Ok(Agent {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    command: row.get(2)?,
                    args: serde_json::from_str(&args_json).unwrap_or_default(),
                    env: serde_json::from_str(&env_json).unwrap_or_default(),
                    is_built_in: is_built_in != 0,
                })
            },
        )
        .map_err(|_| "Agent not found".to_string())?
    };

    // Get workspace worktree path
    let worktree_path: String = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT worktree_path FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|_| "Workspace not found".to_string())?
    };

    // Spawn agent process
    let mut child = Command::new(&agent.command)
        .args(&agent.args)
        .envs(&agent.env)
        .current_dir(&worktree_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", agent.command, e))?;

    let pid = child.id();
    let session_id = Uuid::new_v4().to_string();

    // Extract stdin/stdout/stderr before moving child
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Save session to DB
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sessions (id, name, workspace_id, agent_id, status, pid)
             VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
            params![session_id, name, workspace_id, agent_id, pid],
        )
        .map_err(|e| e.to_string())?;
    }

    // Stream stdout → xterm event
    if let Some(stdout) = stdout {
        let app_h = app.clone();
        let sid = session_id.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_h.emit(
                    "session-output",
                    SessionOutputPayload {
                        session_id: sid.clone(),
                        data: format!("{}\r\n", line),
                    },
                );
            }
        });
    }

    // Stream stderr → xterm event (red-ish, but same channel)
    if let Some(stderr) = stderr {
        let app_h = app.clone();
        let sid = session_id.clone();
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_h.emit(
                    "session-output",
                    SessionOutputPayload {
                        session_id: sid.clone(),
                        data: format!("{}\r\n", line),
                    },
                );
            }
        });
    }

    // Store stdin separately so it stays accessible during exit monitoring
    {
        let mut reg = processes.0.lock().map_err(|e| e.to_string())?;
        if let Some(stdin) = stdin {
            reg.stdins.insert(session_id.clone(), stdin);
        }
        reg.children.insert(session_id.clone(), child);
    }

    // Exit-monitoring: take child out of registry, wait() without holding mutex
    let processes_exit = processes.0.clone();
    let db_exit = db.0.clone();
    let app_exit = app.clone();
    let sid_exit = session_id.clone();

    std::thread::spawn(move || {
        // Take child out of registry so wait() doesn't block other commands
        let mut child_opt = {
            let mut reg = processes_exit.lock().unwrap();
            reg.children.remove(&sid_exit)
        };

        let exit_ok = child_opt
            .as_mut()
            .and_then(|c| c.wait().ok())
            .map(|s| s.success())
            .unwrap_or(false);

        // Clean up stdin handle
        {
            let mut reg = processes_exit.lock().unwrap();
            reg.stdins.remove(&sid_exit);
        }

        let new_status = if exit_ok { SessionStatus::Stopped } else { SessionStatus::Error };
        let status_str = new_status.to_string();

        // Update DB
        if let Ok(conn) = db_exit.lock() {
            let _ = conn.execute(
                "UPDATE sessions SET status = ?2, pid = NULL WHERE id = ?1",
                params![sid_exit, status_str],
            );
        }

        // Notify frontend
        let _ = app_exit.emit(
            "session-status",
            SessionStatusPayload {
                session_id: sid_exit,
                status: new_status,
            },
        );
    });

    let session = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, name, workspace_id, agent_id, status, pid, created_at
             FROM sessions WHERE id = ?1",
            params![session_id],
            row_to_session,
        )
        .map_err(|e| e.to_string())?
    };

    Ok(session)
}

#[tauri::command]
pub fn session_stop(
    session_id: String,
    db: State<DbState>,
    processes: State<ProcessState>,
) -> Result<(), String> {
    {
        let mut reg = processes.0.lock().map_err(|e| e.to_string())?;
        reg.stdins.remove(&session_id);
        if let Some(mut child) = reg.children.remove(&session_id) {
            child.kill().ok();
        }
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET status = 'stopped', pid = NULL WHERE id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn session_send_input(
    session_id: String,
    text: String,
    processes: State<ProcessState>,
) -> Result<(), String> {
    let mut reg = processes.0.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = reg.stdins.get_mut(&session_id) {
        stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    } else {
        return Err("Session stdin not available (process may have exited)".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn session_update_status(
    session_id: String,
    status: String,
    db: State<DbState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET status = ?2, pid = CASE WHEN ?2 != 'running' THEN NULL ELSE pid END WHERE id = ?1",
        params![session_id, status],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
