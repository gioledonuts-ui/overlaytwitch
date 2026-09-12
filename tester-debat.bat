@echo off
title 7GIONNY - Test debat OBS
setlocal
set API=http://localhost:8321

echo Lancement d'un debat de test de 45 secondes...
echo.

curl -s -X POST %API%/api/debate -H "Content-Type: application/json" -d "{""question"":""TEST - Le format court a-t-il tue la culture ?"",""a"":""Oui, tout s'accelere"",""b"":""Non, l'acces s'elargit"",""duration"":45}" >nul
if errorlevel 1 (
  echo [ERREUR] Le pont ne repond pas sur http://localhost:8321
  echo Lance d'abord  demarrer-pont.bat  et garde la fenetre ouverte.
  pause
  exit /b 1
)

timeout /t 2 /nobreak >nul

for %%u in (lucas emma thomas julie rachel antoine louna kevin amelie yassine) do (
  curl -s -X POST %API%/api/vote -H "Content-Type: application/json" -d "{""choice"":""A"",""user"":""%%u""}" >nul
)
for %%u in (sacha maeva noah jessilyne) do (
  curl -s -X POST %API%/api/vote -H "Content-Type: application/json" -d "{""choice"":""B"",""user"":""%%u""}" >nul
)

echo.
echo Debate lance ! Regarde OBS :
echo   - la carte doit monter en bas de l'ecran (impact de basse)
echo   - les barres evoluent (clicks discrets)
echo   - a la fin : le gagnant pulse pendant 5 s, puis la carte disparait
echo.
pause
