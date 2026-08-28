@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location 'C:\Users\reedo\.openclaw\workspace\field-catalog-worker'; npm run dev"
pause
