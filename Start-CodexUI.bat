@echo off
setlocal

cd /d "%~dp0"
title Codex UI Lite

echo.
echo ========================================
echo   Codex UI Lite
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 20 or newer.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please reinstall Node.js with npm enabled.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Dependencies were not found. Running npm install first...
  echo.
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting development server...
echo.
echo Web UI:  http://localhost:5177
echo Server:  http://localhost:4177
echo.
echo Keep this window open while using Codex UI Lite.
echo Press Ctrl+C to stop.
echo.

call npm.cmd run dev

echo.
echo Codex UI Lite stopped.
pause
