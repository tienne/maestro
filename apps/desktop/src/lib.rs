mod commands;
mod db;
mod models;
mod state;

use commands::{agent::*, app_state::*, git::*, repository::*, session::*, workspace::*};
use db::{get_db_path, init_db};
use rusqlite::Connection;
use state::{DbState, ProcessRegistry, ProcessState};
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = get_db_path();
    let conn = Connection::open(&db_path).expect("Failed to open database");
    init_db(&conn).expect("Failed to initialize database");

    let db_state = DbState(Arc::new(Mutex::new(conn)));
    let process_state = ProcessState(Arc::new(Mutex::new(ProcessRegistry::default())));

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db_state)
        .manage(process_state)
        .invoke_handler(tauri::generate_handler![
            // Repository
            repository_list,
            repository_add,
            repository_remove,
            // Workspace
            workspace_list,
            workspace_create,
            workspace_delete,
            // Agent
            agent_list,
            agent_create,
            agent_update,
            agent_delete,
            // Session
            session_list,
            session_list_all,
            session_start,
            session_stop,
            session_send_input,
            session_update_status,
            // Git
            git_status,
            git_diff,
            git_stage_all,
            git_commit,
            fs_read_dir,
            // App State
            app_state_load,
            app_state_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
