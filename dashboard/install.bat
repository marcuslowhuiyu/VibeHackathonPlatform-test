@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"
echo Installing dashboard dependencies...
call npm install
if errorlevel 1 (
    echo Backend install failed!
    pause
    exit /b 1
)
echo.
echo Installing client dependencies...
cd client
call npm install
if errorlevel 1 (
    echo Client install failed!
    pause
    exit /b 1
)
cd ..
echo.
echo Installation complete!
pause
