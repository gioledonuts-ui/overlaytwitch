@echo off
title 7GIONNY - Pont (auto)
cd /d "%~dp0"

echo ==============================================
echo   7GIONNY - Pont + panneau (lance par OBS)
echo ==============================================
echo.

rem ==== 1. Trouver node.exe ====
set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"

if not defined NODE (
  echo [ERREUR] Node.js introuvable. Installe-le depuis https://nodejs.org
  pause
  exit /b 1
)

rem ==== 2. Fermer tout ancien pont deja ouvert ====
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8321 -State Listen -ErrorAction SilentlyContinue; if ($p) { $p | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"

rem ==== 3. Dependances (une seule fois) ====
for %%I in ("%NODE%") do set "NODEDIR=%%~dpI"
if not exist node_modules (
  echo Installation des dependances (1 min, une seule fois)...
  if exist "%NODEDIR%npm.cmd" ( call "%NODEDIR%npm.cmd" install --no-audit --no-fund ) else ( call npm install --no-audit --no-fund )
)

rem ==== 4. Lancer le pont dans une fenetre separee ====
start "7GIONNY - Pont (ne pas fermer)" "%NODE%" server.js

rem ==== 5. Ouvrir le panneau de controle ====
timeout /t 2 /nobreak >nul
start "" "http://localhost:8321/panneau"

echo.
echo Tout est lance ! Garde la fenetre "7GIONNY - Pont" ouverte.
timeout /t 3 /nobreak >nul
