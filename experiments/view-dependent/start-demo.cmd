@echo off
rem One-click launcher: starts the demo server and opens it in the browser.
rem Close this window to stop the server.
title View-dependent demo
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages, first run only...
  call npm install || goto :fail
)
call npm run dev -- --open
goto :eof
:fail
echo.
echo Something went wrong. See the messages above.
pause
