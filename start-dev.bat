@echo off
setlocal
cd /d "%~dp0"

REM Hidden launch of local frontend+backend (no console windows):
REM   FastAPI(8001) + Vite(5173)
REM Logs: backend/_uvicorn_boot.log, frontend/_vite_boot.log
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& '%~dp0start-hidden.ps1' %*"
endlocal
