@echo off
rem One-click launcher: starts the dev server if it isn't running, then opens
rem the editor in Chrome (or Edge). Close the "Projection Studio server"
rem window to stop the server.
setlocal
cd /d "%~dp0"
set "URL=http://localhost:5173"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Install it with:  winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

call :check
if not errorlevel 1 goto open

if not exist node_modules (
  echo Installing packages, first run only...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

echo Starting the Projection Studio server...
start "Projection Studio server" /min cmd /k "npm run dev -- --port 5173 --strictPort"

rem Wait up to 30 seconds for it to answer.
for /l %%i in (1,1,30) do (
  call :check
  if not errorlevel 1 goto open
  timeout /t 1 /nobreak >nul
)
echo The server didn't start. Check the "Projection Studio server" window for errors.
pause
exit /b 1

:open
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER (
  start "" "%BROWSER%" "%URL%"
) else (
  start "" "%URL%"
)
exit /b 0

rem Sets errorlevel 0 when the server answers, 1 when it doesn't.
:check
powershell -NoProfile -Command "try { Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
exit /b %errorlevel%
