@echo off
REM Windows 登录后自动启动本地前后端（无 pause，不弹浏览器）
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "%~dp0start-dev.ps1" -NoBrowser
