@echo off
title 7GIONNY - Mise a jour depuis GitHub
cd /d "%~dp0"

set "URL=https://github.com/gioledonuts-ui/overlaytwitch/archive/refs/heads/main.zip"
set "ZIP=%TEMP%\overlaytwitch-update.zip"
set "EXTRACT=%TEMP%\overlaytwitch-update"

echo.
echo ==============================================
echo   Mise a jour de l'overlay depuis GitHub
echo ==============================================
echo.

echo [1/3] Telechargement de la derniere version...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%ZIP%' -UseBasicParsing"

if not exist "%ZIP%" (
  echo.
  echo [ERREUR] Telechargement impossible. Verifie ta connexion internet.
  pause
  exit /b 1
)

echo [2/3] Extraction...
if exist "%EXTRACT%" rmdir /s /q "%EXTRACT%"
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%EXTRACT%' -Force"
set "SRC=%EXTRACT%\overlaytwitch-main"

if not exist "%SRC%" (
  echo [ERREUR] Extraction impossible.
  pause
  exit /b 1
)

echo [3/3] Copie des fichiers (ta connexion secrets.json est preservee)...

rem --- sauvegarde de tes cles locales ---
if exist "secrets.json" copy /y "secrets.json" "%TEMP%\secrets.backup.json" >nul

rem --- copie tout SAUF secrets.json (pour ne pas ecraser tes cles) ---
robocopy "%SRC%" "%~dp0" /E /XF secrets.json /XD node_modules .git /NFL /NDL /NJH /NJS /NP >nul

rem --- restaure tes cles ---
if exist "%TEMP%\secrets.backup.json" copy /y "%TEMP%\secrets.backup.json" "secrets.json" >nul

rem --- nettoyage ---
del /q "%ZIP%" >nul 2>nul
rmdir /s /q "%EXTRACT%" >nul 2>nul

echo.
echo ==============================================
echo   Mise a jour terminee !
echo   Relance  demarrer-pont.bat
echo ==============================================
echo.
pause
