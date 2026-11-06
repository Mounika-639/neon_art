@echo off
REM ===========================================================
REM  Divine Darshan - local preview launcher (Windows)
REM
REM  Double-click this file. It starts a tiny local web server
REM  in this folder and opens the page in your browser.
REM
REM  This is ONLY for previewing on your own PC. The website
REM  itself needs no server - GitHub Pages serves it directly.
REM  You can delete this file before uploading if you like.
REM ===========================================================

cd /d "%~dp0"
title Divine Darshan - local preview

echo.
echo   Divine Darshan - starting local preview...
echo.

REM Find Python
where py >nul 2>nul
if %errorlevel%==0 (
    set "PY=py -3"
    goto :run
)
where python >nul 2>nul
if %errorlevel%==0 (
    set "PY=python"
    goto :run
)

echo   [X] Python was not found on this PC.
echo.
echo   Either install Python from https://python.org/downloads
echo   ^(tick "Add Python to PATH" during setup^),
echo   or open the folder in VS Code and use the "Live Server" extension.
echo.
pause
exit /b 1

:run
echo   Opening  http://localhost:8080
echo.
echo   Keep this black window OPEN while you use the page.
echo   Press Ctrl+C or just close it when you are finished.
echo.
start "" http://localhost:8080
%PY% -m http.server 8080
pause
