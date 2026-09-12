@echo off
title 7GIONNY - Pont debat (ne pas fermer pendant le test)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  echo Telecharge-le gratuitement sur https://nodejs.org (version LTS),
  echo installe-le en cliquant a chaque "Next", puis relance ce fichier.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/2] Premier lancement : installation des dependances...
  call npm install --no-audit --no-fund
)

echo.
echo [2/2] Pont demarre.
echo.
echo   Demos dans le navigateur  -^> http://localhost:8321/
echo   URL a mettre dans OBS     -^> http://localhost:8321/widget.html
echo.
echo   Garde cette fenetre ouverte pendant le stream.
echo.
node server.js
pause
