@echo off
REM Browser-only dev loop: Vite serves the UI and bridges to the worker CLI.
REM For the real desktop window use "Run Field Catalog.bat" in the repo root.
cd /d "%~dp0.."
npm run dev
pause
