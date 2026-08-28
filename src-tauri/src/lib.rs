use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
struct WorkerProc {
    stdout: String,
    stderr: String,
    code: Option<i32>,
}

#[derive(Serialize)]
struct AppPaths {
    cli: String,
    library: String,
}

fn find_cli() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("FIELDCATALOG_CLI") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Ok(pb);
        }
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let win = repo.join(".venv").join("Scripts").join("fieldcatalog.exe");
    if win.is_file() {
        return Ok(win);
    }
    let unix = repo.join(".venv").join("bin").join("fieldcatalog");
    if unix.is_file() {
        return Ok(unix);
    }
    Err("fieldcatalog CLI not found (.venv/Scripts/fieldcatalog.exe)".into())
}

fn library_path() -> PathBuf {
    if let Ok(p) = std::env::var("FIELDCATALOG_LIBRARY") {
        return PathBuf::from(p);
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("FieldCatalog")
}

fn run_worker_sync(app: AppHandle, args: Vec<String>) -> Result<WorkerProc, String> {
    let cli = find_cli()?;
    let library = library_path();
    let mut cmd = Command::new(&cli);
    cmd.arg("--library")
        .arg(&library)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8");
    // Only `identify` can use this. Reading it on every list and set-verdict
    // put the secret in the environment of every child process for nothing.
    if args.first().map(String::as_str) == Some("identify") {
        let key_file = library.join("xai.key");
        if key_file.is_file() {
            if let Ok(key) = std::fs::read_to_string(&key_file) {
                let key = key.trim();
                if !key.is_empty() {
                    cmd.env("XAI_API_KEY", key);
                }
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", cli.display()))?;
    let stderr = child.stderr.take();
    let stdout_pipe = child.stdout.take();
    let stderr_handle = thread::spawn(move || {
        let mut buf = String::new();
        if let Some(pipe) = stderr {
            let reader = BufReader::new(pipe);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit("worker-progress", &line);
                if !buf.is_empty() {
                    buf.push('\n');
                }
                buf.push_str(&line);
            }
        }
        buf
    });
    let mut stdout = String::new();
    if let Some(mut pipe) = stdout_pipe {
        pipe.read_to_string(&mut stdout).ok();
    }
    let status = child.wait().map_err(|e| format!("wait: {e}"))?;
    let stderr_text = stderr_handle.join().unwrap_or_default();
    Ok(WorkerProc {
        stdout,
        stderr: stderr_text,
        code: status.code(),
    })
}

#[tauri::command]
fn app_paths() -> Result<AppPaths, String> {
    Ok(AppPaths {
        cli: find_cli()?.to_string_lossy().into_owned(),
        library: library_path().to_string_lossy().into_owned(),
    })
}

#[tauri::command]
async fn run_worker(app: AppHandle, args: Vec<String>) -> Result<WorkerProc, String> {
    tauri::async_runtime::spawn_blocking(move || run_worker_sync(app, args))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![run_worker, app_paths])
        .run(tauri::generate_context!())
        .expect("error while running Field Catalog");
}
