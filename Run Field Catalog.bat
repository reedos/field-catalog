@echo off
title Field Catalog
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
echo Starting Field Catalog desktop window (not a browser)...
cmd /c npx tauri dev
if errorlevel 1 pause
