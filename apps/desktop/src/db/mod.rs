use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::PathBuf;

pub fn get_db_path() -> PathBuf {
    let mut path = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("maestro");
    std::fs::create_dir_all(&path).ok();
    path.push("maestro.db");
    path
}

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    seed_built_in_agents(conn)?;
    Ok(())
}

const SCHEMA_SQL: &str = "
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS repositories (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspaces (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        branch          TEXT NOT NULL,
        worktree_path   TEXT NOT NULL UNIQUE,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        command     TEXT NOT NULL,
        args        TEXT NOT NULL DEFAULT '[]',
        env         TEXT NOT NULL DEFAULT '{}',
        is_built_in INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        agent_id        TEXT NOT NULL REFERENCES agents(id),
        status          TEXT NOT NULL DEFAULT 'stopped',
        pid             INTEGER,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_state (
        key     TEXT PRIMARY KEY,
        value   TEXT NOT NULL
    );
";

fn seed_built_in_agents(conn: &Connection) -> Result<()> {
    let built_in_agents = vec![
        ("claude-code", "Claude Code", "claude", vec!["--dangerously-skip-permissions"], std::collections::HashMap::<String,String>::new()),
        ("codex", "Codex CLI", "codex", vec![], std::collections::HashMap::new()),
        ("opencode", "openCode", "opencode", vec![], std::collections::HashMap::new()),
        ("gemini-cli", "Gemini CLI", "gemini", vec![], std::collections::HashMap::new()),
        ("pi", "Pi", "pi", vec![], std::collections::HashMap::new()),
        ("cursor-agent", "Cursor Agent", "cursor-agent", vec![], std::collections::HashMap::new()),
    ];

    for (id, name, command, args, env) in built_in_agents {
        let args_json = serde_json::to_string(&args)?;
        let env_json = serde_json::to_string(&env)?;
        conn.execute(
            "INSERT OR IGNORE INTO agents (id, name, command, args, env, is_built_in)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            params![id, name, command, args_json, env_json],
        )?;
    }
    Ok(())
}
