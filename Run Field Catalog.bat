@echo off
title Field Catalog
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
REM MSVC environment for the Rust link step. Adjust if Build Tools live elsewhere.
set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" (call "%VCVARS%") else (echo [warn] vcvars64.bat not found; the Rust link step may fail.)
echo Starting Field Catalog desktop window (not a browser)...
cmd /c npx tauri dev
if errorlevel 1 pause
