use crate::{models::Repository, state::DbState};
use anyhow::Result;
use rusqlite::params;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn repository_list(db: State<DbState>) -> Result<Vec<Repository>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, path, created_at FROM repositories ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let repos = stmt
        .query_map([], |row| {
            Ok(Repository {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(repos)
}

#[tauri::command]
pub fn repository_add(path: String, db: State<DbState>) -> Result<Repository, String> {
    // Validate it's a git repository
    let git_dir = std::path::Path::new(&path).join(".git");
    if !git_dir.exists() {
        // Try git rev-parse to check if it's a worktree or bare repo
        let output = std::process::Command::new("git")
            .args(["rev-parse", "--git-dir"])
            .current_dir(&path)
            .output()
            .map_err(|_| format!("{} is not a git repository", path))?;

        if !output.status.success() {
            return Err(format!("{} is not a git repository", path));
        }
    }

    let name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let id = Uuid::new_v4().to_string();
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO repositories (id, name, path) VALUES (?1, ?2, ?3)",
        params![id, name, path],
    )
    .map_err(|e| e.to_string())?;

    let repo = conn
        .query_row(
            "SELECT id, name, path, created_at FROM repositories WHERE id = ?1",
            params![id],
            |row| {
                Ok(Repository {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(repo)
}

#[tauri::command]
pub fn repository_remove(id: String, db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM repositories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
