@echo off
setlocal
cd /d "%~dp0"

REM Stop listeners on Vite 5173 and FastAPI 8001, then optionally restart.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports=5173,8001; foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue | ForEach-Object { Write-Host ('Stopping PID {0} on {1}' -f $_.OwningProcess,$p); Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } }"

echo Ports cleared.
if /I "%~1"=="restart" (
  call "%~dp0start-dev.bat" -Restart -NoBrowser
) else (
  pause
)
endlocal
