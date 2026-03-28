use crate::state::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiAppState {
    pub active_workspace_id: Option<String>,
    pub active_session_id: Option<String>,
    pub sidebar_width: i64,
    pub right_sidebar_width: i64,
}

#[tauri::command]
pub fn app_state_load(db: State<DbState>) -> Result<UiAppState, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let get_val = |key: &str| -> Option<String> {
        conn.query_row(
            "SELECT value FROM app_state WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .ok()
    };

    Ok(UiAppState {
        active_workspace_id: get_val("activeWorkspaceId"),
        active_session_id: get_val("activeSessionId"),
        sidebar_width: get_val("sidebarWidth")
            .and_then(|v| v.parse().ok())
            .unwrap_or(280),
        right_sidebar_width: get_val("rightSidebarWidth")
            .and_then(|v| v.parse().ok())
            .unwrap_or(320),
    })
}

#[tauri::command]
pub fn app_state_save(state: UiAppState, db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let upsert = |key: &str, value: &str| -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO app_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    };

    if let Some(id) = &state.active_workspace_id {
        upsert("activeWorkspaceId", id).map_err(|e| e.to_string())?;
    }
    if let Some(id) = &state.active_session_id {
        upsert("activeSessionId", id).map_err(|e| e.to_string())?;
    }
    upsert("sidebarWidth", &state.sidebar_width.to_string()).map_err(|e| e.to_string())?;
    upsert("rightSidebarWidth", &state.right_sidebar_width.to_string())
        .map_err(|e| e.to_string())?;

    Ok(())
}
