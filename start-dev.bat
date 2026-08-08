@echo off
setlocal
cd /d "%~dp0"

REM Double-click friendly launcher for local frontend + backend.
REM Usage:
REM   start-dev.bat
REM   start-dev.bat -Restart
REM   start-dev.bat -NoBrowser

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
set ERR=%ERRORLEVEL%
if %ERR% neq 0 (
  echo.
  echo start-dev.ps1 failed with exit code %ERR%.
  pause
  exit /b %ERR%
)

echo.
echo Launcher finished. Backend/Frontend windows stay open for logs.
pause
endlocal
