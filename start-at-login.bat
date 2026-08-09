@echo off
REM Start local frontend+backend after Windows login (hidden, no browser)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& '%~dp0start-hidden.ps1' -NoBrowser"
