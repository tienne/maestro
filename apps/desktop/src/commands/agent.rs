use crate::{models::Agent, state::DbState};
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

fn row_to_agent(row: &rusqlite::Row) -> rusqlite::Result<Agent> {
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
}

#[tauri::command]
pub fn agent_list(db: State<DbState>) -> Result<Vec<Agent>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, command, args, env, is_built_in FROM agents ORDER BY name")
        .map_err(|e| e.to_string())?;

    let agents = stmt
        .query_map([], row_to_agent)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(agents)
}

#[tauri::command]
pub fn agent_create(
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    db: State<DbState>,
) -> Result<Agent, String> {
    let id = Uuid::new_v4().to_string();
    let args_json = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let env_json = serde_json::to_string(&env).map_err(|e| e.to_string())?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agents (id, name, command, args, env, is_built_in) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![id, name, command, args_json, env_json],
    )
    .map_err(|e| e.to_string())?;

    let agent = conn
        .query_row(
            "SELECT id, name, command, args, env, is_built_in FROM agents WHERE id = ?1",
            params![id],
            row_to_agent,
        )
        .map_err(|e| e.to_string())?;

    Ok(agent)
}

#[tauri::command]
pub fn agent_update(
    id: String,
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    db: State<DbState>,
) -> Result<Agent, String> {
    let args_json = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let env_json = serde_json::to_string(&env).map_err(|e| e.to_string())?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Cannot update built-in agents
    let is_built_in: i64 = conn
        .query_row(
            "SELECT is_built_in FROM agents WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Agent not found".to_string())?;

    if is_built_in != 0 {
        return Err("Cannot modify built-in agents".to_string());
    }

    conn.execute(
        "UPDATE agents SET name = ?2, command = ?3, args = ?4, env = ?5 WHERE id = ?1",
        params![id, name, command, args_json, env_json],
    )
    .map_err(|e| e.to_string())?;

    let agent = conn
        .query_row(
            "SELECT id, name, command, args, env, is_built_in FROM agents WHERE id = ?1",
            params![id],
            row_to_agent,
        )
        .map_err(|e| e.to_string())?;

    Ok(agent)
}

#[tauri::command]
pub fn agent_delete(id: String, db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let is_built_in: i64 = conn
        .query_row(
            "SELECT is_built_in FROM agents WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Agent not found".to_string())?;

    if is_built_in != 0 {
        return Err("Cannot delete built-in agents".to_string());
    }

    conn.execute("DELETE FROM agents WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
