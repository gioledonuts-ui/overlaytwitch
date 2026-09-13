@echo off
title 7GIONNY - Mise a jour
cd /d "%~dp0"

set "URL=https://github.com/gioledonuts-ui/overlaytwitch/archive/refs/heads/main.zip"
set "ZIP=%TEMP%\overlaytwitch-update.zip"
set "EXTRACT=%TEMP%\overlaytwitch-update"

echo.
echo ==============================================
echo   Mise a jour de l'overlay (depuis GitHub)
echo ==============================================
echo.

echo [1/4] Telechargement...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%ZIP%' -UseBasicParsing"
if not exist "%ZIP%" (
  echo.
  echo [ERREUR] Le telechargement a echoue.
  echo Verifie ta connexion internet, puis relance ce fichier.
  pause
  exit /b 1
)
echo        OK : telecharge.

echo [2/4] Extraction...
if exist "%EXTRACT%" rmdir /s /q "%EXTRACT%"
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%EXTRACT%' -Force"
if not exist "%EXTRACT%\overlaytwitch-main\widget.html" (
  echo.
  echo [ERREUR] Extraction impossible.
  pause
  exit /b 1
)
echo        OK : extrait.

echo [3/4] Copie des fichiers (ECRASE tout, meme si la date parait ancienne)...
rem --- sauvegarde tes cles et reglages (secrets.json + config-perso.json) ---
if exist "secrets.json" copy /y "secrets.json" "%TEMP%\secrets.backup.json" >nul
if exist "config-perso.json" copy /y "config-perso.json" "%TEMP%\config-perso.backup.json" >nul
rem --- copie FORCEE de tous les fichiers ---
powershell -NoProfile -Command "Copy-Item -Path '%EXTRACT%\overlaytwitch-main\*' -Destination '%~dp0' -Recurse -Force"
rem --- restaure tes cles et reglages ---
if exist "%TEMP%\secrets.backup.json" copy /y "%TEMP%\secrets.backup.json" "secrets.json" >nul
if exist "%TEMP%\config-perso.backup.json" copy /y "%TEMP%\config-perso.backup.json" "config-perso.json" >nul

echo [4/4] Verification...
echo.
if exist "VERSION.txt" (
  echo ==============================================
  type VERSION.txt
  echo ==============================================
) else (
  echo [ERREUR] VERSION.txt introuvable : la copie a echoue.
)

rem --- nettoyage ---
del /q "%ZIP%" >nul 2>nul
rmdir /s /q "%EXTRACT%" >nul 2>nul

echo.
echo Si tu vois une "VERSION" ci-dessus, tout est a jour.
echo Relance  demarrer-pont.bat
echo.
pause
