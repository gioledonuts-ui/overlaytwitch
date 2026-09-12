@echo off
title 7GIONNY - Pont
cd /d "%~dp0"

echo ==============================================
echo   7GIONNY - Pont + panneau
echo ==============================================
echo(

rem Trouver node.exe
set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE goto noNode

rem Fermer l'ancien pont
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8321 -State Listen -ErrorAction SilentlyContinue; if ($p) { $p | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"

rem Installer les dependances si besoin
for %%I in ("%NODE%") do set "NODEDIR=%%~dpI"
if not exist node_modules goto lance
echo Installation des dependances...
if exist "%NODEDIR%npm.cmd" call "%NODEDIR%npm.cmd" install --omit=dev --no-audit --no-fund
if not exist "%NODEDIR%npm.cmd" call npm install --omit=dev --no-audit --no-fund

:lance
start "7GIONNY - Pont" "%NODE%" server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:8321/panneau"
echo Tout est lance. Garde la fenetre "7GIONNY - Pont" ouverte.
timeout /t 3 /nobreak >nul
exit /b 0

:noNode
echo [ERREUR] Node.js introuvable. Installe-le depuis https://nodejs.org
pause
exit /b 1
