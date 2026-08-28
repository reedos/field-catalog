use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

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

const CLI_NAME: &str = if cfg!(windows) {
    "fieldcatalog.exe"
} else {
    "fieldcatalog"
};

/// Locate the worker CLI.
///
/// Order matters: an installed app must never fall back to a path baked in at
/// compile time, because `CARGO_MANIFEST_DIR` points at the build machine's
/// source tree. Installed locations are checked first, the dev venv last.
fn find_cli() -> Result<PathBuf, String> {
    let mut tried: Vec<PathBuf> = Vec::new();

    // 1. Explicit override — used by tests and for pointing at a custom build.
    if let Ok(p) = std::env::var("FIELDCATALOG_CLI") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Ok(pb);
        }
        tried.push(pb);
    }

    // 2. Installed layout. Tauri drops sidecars beside the app executable and
    //    resources either beside it or under `resources/`.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join(CLI_NAME), dir.join("resources").join(CLI_NAME)] {
                if candidate.is_file() {
                    return Ok(candidate);
                }
                tried.push(candidate);
            }
        }
    }

    // 3. Dev fallback: the venv in the source tree. Only ever hits on the
    //    machine the binary was compiled on.
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    for candidate in [
        repo.join(".venv").join("Scripts").join("fieldcatalog.exe"),
        repo.join(".venv").join("bin").join("fieldcatalog"),
    ] {
        if candidate.is_file() {
            return Ok(candidate);
        }
        tried.push(candidate);
    }

    Err(format!(
        "fieldcatalog CLI not found. Tried:\n{}",
        tried
            .iter()
            .map(|p| format!("  {}", p.display()))
            .collect::<Vec<_>>()
            .join("\n")
    ))
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

fn base_command(cli: &PathBuf) -> Command {
    let mut cmd = Command::new(cli);
    cmd.env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// A long-lived `fieldcatalog serve` child. Requests are one JSON line each,
/// matched to responses by id, so out-of-order completion (the serve slow lane)
/// is fine. Dropping stdin is the shutdown signal.
struct ServeClient {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<String>>>>,
    next_id: AtomicU64,
    child: Mutex<Child>,
}

static CLIENT: Mutex<Option<Arc<ServeClient>>> = Mutex::new(None);

fn spawn_serve(on_stderr: impl Fn(String) + Send + 'static) -> Result<Arc<ServeClient>, String> {
    let cli = find_cli()?;
    let library = library_path();
    let mut cmd = base_command(&cli);
    cmd.arg("--library")
        .arg(&library)
        .arg("serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {} serve: {e}", cli.display()))?;
    let stdin = child.stdin.take().ok_or("serve: no stdin")?;
    let stdout = child.stdout.take().ok_or("serve: no stdout")?;
    let stderr = child.stderr.take().ok_or("serve: no stderr")?;

    let pending: Arc<Mutex<HashMap<u64, mpsc::Sender<String>>>> = Arc::default();
    let for_reader = pending.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let id = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|v| v.get("id").and_then(|i| i.as_u64()));
            if let Some(id) = id {
                if let Some(tx) = for_reader.lock().unwrap().remove(&id) {
                    let _ = tx.send(line);
                }
            }
        }
        // Stream ended: the child died. Dropping the senders wakes every
        // waiter with an error instead of leaving them to their timeouts.
        for_reader.lock().unwrap().clear();
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            on_stderr(line);
        }
    });

    Ok(Arc::new(ServeClient {
        stdin: Mutex::new(stdin),
        pending,
        next_id: AtomicU64::new(1),
        child: Mutex::new(child),
    }))
}

impl ServeClient {
    fn request(&self, args: &[String], timeout: Duration) -> Result<String, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let line = serde_json::json!({ "id": id, "args": args }).to_string();
        let write_result = {
            let mut stdin = self.stdin.lock().map_err(|_| "serve stdin poisoned")?;
            writeln!(stdin, "{line}").and_then(|_| stdin.flush())
        };
        if let Err(e) = write_result {
            self.pending.lock().unwrap().remove(&id);
            return Err(format!("serve write: {e}"));
        }
        match rx.recv_timeout(timeout) {
            Ok(line) => Ok(line),
            Err(e) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("serve worker: {e}"))
            }
        }
    }

    fn alive(&self) -> bool {
        self.child
            .lock()
            .map(|mut c| matches!(c.try_wait(), Ok(None)))
            .unwrap_or(false)
    }
}

fn get_or_spawn(app: &AppHandle) -> Result<Arc<ServeClient>, String> {
    let mut slot = CLIENT.lock().map_err(|_| "client lock poisoned")?;
    if let Some(client) = slot.as_ref() {
        if client.alive() {
            return Ok(client.clone());
        }
        *slot = None;
    }
    let app = app.clone();
    let client = spawn_serve(move |line| {
        let _ = app.emit("worker-progress", &line);
    })?;
    *slot = Some(client.clone());
    Ok(client)
}

fn drop_client() {
    if let Ok(mut slot) = CLIENT.lock() {
        *slot = None;
    }
}

fn request_timeout(args: &[String]) -> Duration {
    match args.first().map(String::as_str) {
        // identify waits on a local model; import and refresh walk whole cards.
        Some("identify") => Duration::from_secs(330),
        Some("import") | Some("refresh-previews") => Duration::from_secs(3600),
        _ => Duration::from_secs(60),
    }
}

/// One-shot fallback, used only when the serve child cannot be started at all.
/// Never used after a request line was written -- the serve worker may be
/// executing it, and re-running a mutation is worse than reporting an error.
fn run_worker_once(app: AppHandle, args: Vec<String>) -> Result<WorkerProc, String> {
    let cli = find_cli()?;
    let library = library_path();
    let mut cmd = base_command(&cli);
    cmd.arg("--library")
        .arg(&library)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if args.first().map(String::as_str) == Some("identify") {
        let key_file = library.join("xai.key");
        if let Ok(key) = std::fs::read_to_string(&key_file) {
            let key = key.trim();
            if !key.is_empty() {
                cmd.env("XAI_API_KEY", key);
            }
        }
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", cli.display()))?;
    let stderr = child.stderr.take();
    let stdout_pipe = child.stdout.take();
    let stderr_handle = thread::spawn(move || {
        let mut buf = String::new();
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
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

fn run_worker_impl(app: AppHandle, args: Vec<String>) -> Result<WorkerProc, String> {
    let timeout = request_timeout(&args);
    match get_or_spawn(&app) {
        Ok(client) => match client.request(&args, timeout) {
            Ok(line) => Ok(WorkerProc {
                stdout: line,
                stderr: String::new(),
                code: Some(0),
            }),
            Err(e) => {
                if !client.alive() {
                    drop_client(); // next call respawns
                }
                Err(e)
            }
        },
        // serve would not start; fall back to the old one-process-per-call path.
        Err(_) => run_worker_once(app, args),
    }
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
    tauri::async_runtime::spawn_blocking(move || run_worker_impl(app, args))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trips real requests through a real `fieldcatalog serve` child,
    /// including concurrent callers, using the repo venv. Skips silently when
    /// the venv CLI is missing (e.g. CI without Python).
    #[test]
    fn serve_client_round_trip() {
        let Ok(cli) = find_cli() else { return };
        let lib = std::env::temp_dir().join(format!("fc-rs-test-{}", std::process::id()));
        std::env::set_var("FIELDCATALOG_CLI", &cli);
        std::env::set_var("FIELDCATALOG_LIBRARY", &lib);

        let client = spawn_serve(|_line| {}).expect("spawn serve");
        let init = client
            .request(&["init".into()], Duration::from_secs(30))
            .expect("init");
        let v: serde_json::Value = serde_json::from_str(&init).expect("init json");
        assert_eq!(v["ok"], true);
        assert!(v["id"].is_u64());

        // Concurrent requests must each get their own response.
        let c2 = Arc::clone(&client);
        let handle = thread::spawn(move || {
            c2.request(&["list".into(), "--summary".into()], Duration::from_secs(30))
                .expect("threaded list")
        });
        let a = client
            .request(&["list".into(), "--summary".into()], Duration::from_secs(30))
            .expect("list");
        let b = handle.join().expect("join");
        let va: serde_json::Value = serde_json::from_str(&a).unwrap();
        let vb: serde_json::Value = serde_json::from_str(&b).unwrap();
        assert_eq!(va["ok"], true);
        assert_eq!(vb["ok"], true);
        assert_ne!(va["id"], vb["id"]);

        assert!(client.alive());
        drop(client); // stdin closes -> serve exits on EOF
        let _ = std::fs::remove_dir_all(&lib);
    }
}
