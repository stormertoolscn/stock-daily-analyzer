@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 股票日报助手
if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" ui.py
) else if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" ui.py
) else (
  python ui.py
)
