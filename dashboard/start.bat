@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"
echo Starting Vibe Dashboard...
echo.
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
call npm run dev
