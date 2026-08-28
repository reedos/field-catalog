# Build the standalone worker exe that ships inside the installer.
# Run from the repo root:  powershell -File scripts\build-worker.ps1
$ErrorActionPreference = "Stop"
& .\.venv\Scripts\python.exe -m pip install --quiet pyinstaller
& .\.venv\Scripts\python.exe -m PyInstaller `
  --onefile `
  --console `
  --name fieldcatalog `
  --distpath src-tauri\binaries `
  --workpath build\pyinstaller `
  --specpath build\pyinstaller `
  --paths src `
  scripts\fieldcatalog_entry.py
Write-Host "built src-tauri\binaries\fieldcatalog.exe"
