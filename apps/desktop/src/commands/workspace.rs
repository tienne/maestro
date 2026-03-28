use crate::{models::Workspace, state::DbState};
use rusqlite::params;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn workspace_list(db: State<DbState>) -> Result<Vec<Workspace>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, repository_id, branch, worktree_path, created_at
             FROM workspaces ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let workspaces = stmt
        .query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                repository_id: row.get(2)?,
                branch: row.get(3)?,
                worktree_path: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(workspaces)
}

#[tauri::command]
pub fn workspace_create(
    name: String,
    repository_id: String,
    branch: String,
    db: State<DbState>,
) -> Result<Workspace, String> {
    // Get repository path
    let repo_path: String = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT path FROM repositories WHERE id = ?1",
            params![repository_id],
            |row| row.get(0),
        )
        .map_err(|_| "Repository not found".to_string())?
    };

    // Determine worktree path: <repo_parent>/.maestro-worktrees/<name>
    let repo_parent = std::path::Path::new(&repo_path)
        .parent()
        .ok_or("Cannot determine parent directory")?;
    let worktrees_dir = repo_parent.join(".maestro-worktrees");
    std::fs::create_dir_all(&worktrees_dir).map_err(|e| e.to_string())?;
    let worktree_path = worktrees_dir.join(&name);

    // Run git worktree add
    let output = std::process::Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            &branch,
            worktree_path.to_str().unwrap(),
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree add failed: {}", stderr));
    }

    let id = Uuid::new_v4().to_string();
    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO workspaces (id, name, repository_id, branch, worktree_path)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, repository_id, branch, worktree_path_str],
    )
    .map_err(|e| e.to_string())?;

    let workspace = conn
        .query_row(
            "SELECT id, name, repository_id, branch, worktree_path, created_at
             FROM workspaces WHERE id = ?1",
            params![id],
            |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    repository_id: row.get(2)?,
                    branch: row.get(3)?,
                    worktree_path: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(workspace)
}

#[tauri::command]
pub fn workspace_delete(id: String, db: State<DbState>) -> Result<(), String> {
    let worktree_path: String = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT worktree_path FROM workspaces WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Workspace not found".to_string())?
    };

    // git worktree remove
    let output = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree remove failed: {}", stderr));
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
