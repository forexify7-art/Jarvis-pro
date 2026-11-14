@echo off
REM One-click start for Windows. Installs dependencies on the first run.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.12 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Installing dependencies... & call npm install || (pause & exit /b 1))
if not exist .env (copy .env.example .env >nul & echo Created .env - open it and set GEMINI_API_KEY, then run this file again. & notepad .env & pause & exit /b 0)
start "" http://localhost:4173
call npm start
pause
