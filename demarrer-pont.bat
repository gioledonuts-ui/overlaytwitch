@echo off
title 7GIONNY - Pont debat
cd /d "%~dp0"

rem ==== 1. Trouver node.exe (meme sans PATH a jour) ====
set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"

if not defined NODE (
  echo =====================================================
  echo  ERREUR : Node.js introuvable.
  echo  Telecharge-le sur https://nodejs.org  ^(version LTS^)
  echo  puis relance ce fichier.
  echo  Si tu viens de l'installer : redemarre le PC.
  echo =====================================================
  pause
  exit /b 1
)

for %%I in ("%NODE%") do set "NODEDIR=%%~dpI"

echo Node.js detecte : %NODE%
echo.

rem ==== 2. Fermer tout ancien pont deja ouvert (evite l'erreur EADDRINUSE) ====
echo Verification : aucun ancien pont ne doit tourner...
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8321 -State Listen -ErrorAction SilentlyContinue; if ($p) { $p | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host ('  Ancien pont arrete (processus ' + $_ + ')') } } else { Write-Host '  OK : port 8321 libre.' }"

rem ==== 3. Dependances (optionnel : chat Twitch uniquement) ====
if not exist node_modules (
  echo [1/2] Installation des dependances ^(1 min, optionnel^)...
  if exist "%NODEDIR%npm.cmd" (
    call "%NODEDIR%npm.cmd" install --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
)

echo.
echo [2/2] Pont demarre.
echo.
echo   Demo  -^>  http://localhost:8321/
echo   OBS   -^>  http://localhost:8321/widget.html
echo.
echo   Garde cette fenetre ouverte pendant le stream.
echo.
"%NODE%" server.js
pause
