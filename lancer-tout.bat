@echo off
title 7GIONNY - Lancement overlay + OBS
cd /d "%~dp0"

echo ==============================================
echo   7GIONNY - Lancement du pont + OBS + panneau
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
for %%I in ("%NODE%") do set "NODEDIR=%%~dpI"

rem ==== 2. Fermer tout ancien pont ====
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8321 -State Listen -ErrorAction SilentlyContinue; if ($p) { $p | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"

rem ==== 3. Dependances ====
if not exist node_modules (
  echo [1/3] Installation des dependances...
  if exist "%NODEDIR%npm.cmd" ( call "%NODEDIR%npm.cmd" install --no-audit --no-fund ) else ( call npm install --no-audit --no-fund )
)

rem ==== 4. Lancer le pont dans une fenetre separee ====
echo [2/3] Demarrage du pont...
start "7GIONNY - Pont (ne pas fermer)" "%NODE%" server.js

rem ==== 5. Ouvrir le panneau de controle ====
echo [3/3] Ouverture du panneau de controle...
timeout /t 2 /nobreak >nul
start "" "http://localhost:8321/panneau"

rem ==== 6. Lancer OBS (si trouve) ====
set "OBS="
if exist "%ProgramFiles%\obs-studio\bin\64bit\obs64.exe" (
  set "OBSDIR=%ProgramFiles%\obs-studio\bin\64bit"
  set "OBS=%ProgramFiles%\obs-studio\bin\64bit\obs64.exe"
)
if not defined OBS if exist "%ProgramFiles(x86)%\obs-studio\bin\64bit\obs64.exe" (
  set "OBSDIR=%ProgramFiles(x86)%\obs-studio\bin\64bit"
  set "OBS=%ProgramFiles(x86)%\obs-studio\bin\64bit\obs64.exe"
)
if not defined OBS if exist "%LocalAppData%\Programs\obs-studio\bin\64bit\obs64.exe" (
  set "OBSDIR=%LocalAppData%\Programs\obs-studio\bin\64bit"
  set "OBS=%LocalAppData%\Programs\obs-studio\bin\64bit\obs64.exe"
)

if defined OBS (
  echo        Lancement d'OBS...
  rem OBS a besoin de demarrer DEPUIS son propre dossier, sinon
  rem il affiche "failed to find locale/en-US.ini".
  cd /d "%OBSDIR%"
  start "" obs64.exe
  cd /d "%~dp0"
) else (
  echo        OBS introuvable : ouvre-le manuellement.
)

echo.
echo ==============================================
echo   Tout est lance !
echo     - Pont : fenetre noire "7GIONNY - Pont"
echo     - Panneau : http://localhost:8321/panneau
echo     - OBS : source navigateur -> widget.html
echo ==============================================
echo.
timeout /t 4 /nobreak >nul
