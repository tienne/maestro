use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub staged: bool,
    pub status: String,
}

#[tauri::command]
pub fn git_status(workspace_path: String) -> Result<Vec<GitFileStatus>, String> {
    let output = Command::new("git")
        .args(["status", "--porcelain=v1"])
        .current_dir(&workspace_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let files = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let xy = &line[..2];
            let path = line[3..].to_string();
            let staged = xy.chars().next().map(|c| c != ' ' && c != '?').unwrap_or(false);
            let status = xy.trim().to_string();
            GitFileStatus { path, staged, status }
        })
        .collect();

    Ok(files)
}

#[tauri::command]
pub fn git_diff(workspace_path: String, file_path: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&file_path);

    let output = Command::new("git")
        .args(&args)
        .current_dir(&workspace_path)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn git_stage_all(workspace_path: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["add", "-A"])
        .current_dir(&workspace_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(workspace_path: String, message: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&workspace_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn fs_read_dir(dir_path: String) -> Result<Vec<FsEntry>, String> {
    let entries = std::fs::read_dir(&dir_path).map_err(|e| e.to_string())?;

    let mut result: Vec<FsEntry> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            // Skip hidden files and common noise
            let name = e.file_name();
            let name_str = name.to_string_lossy();
            !name_str.starts_with('.') && name_str != "node_modules" && name_str != "target"
        })
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let path = e.path().to_string_lossy().to_string();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            FsEntry { name, path, is_dir }
        })
        .collect();

    result.sort_by(|a, b| {
        // Directories first, then alphabetical
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(result)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}
