@echo off
title 7GIONNY - Test des alertes (follow / sub / raid)
setlocal
set API=http://localhost:8321

echo ==============================================
echo   TEST DES ANIMATIONS D'ALERTE
echo   (follow, sub, resub, gift, raid)
echo ==============================================
echo.
echo Chaque alerte s'affiche ~7 secondes dans OBS.
echo Garde OBS ouvert et regarde le haut de l'ecran.
echo.

echo [1/6] NOUVEAU FOLLOW...
curl -s -X POST %API%/api/alert -H "Content-Type: application/json" -d "{\"type\":\"follow\",\"user\":\"ViewerExemple\"}" >nul
timeout /t 7 /nobreak >nul

echo [2/6] NOUVEAU SUB (1er mois)...
curl -s -X POST %API%/api/alert -H "Content-Type: application/json" -d "{\"type\":\"sub\",\"user\":\"amelie\"}" >nul
timeout /t 7 /nobreak >nul

echo [3/6] RESUB (3 mois consecutif - 12 mois total)...
curl -s -X POST %API%/api/alert -H "Content-Type: application/json" -d "{\"type\":\"resub\",\"user\":\"Louna\",\"stints\":2,\"total\":12,\"message\":\"Toujours la pour le debat !\"}" >nul
timeout /t 7 /nobreak >nul

echo [4/6] SUB OFFERT (kevin offre a maeva)...
curl -s -X POST %API%/api/alert -H "Content-Type: application/json" -d "{\"type\":\"gift\",\"user\":\"kevin\",\"viewer\":\"maeva\"}" >nul
timeout /t 7 /nobreak >nul

echo [5/6] SUB COMMUNAUTAIRE (a tout le chat)...
curl -s -X POST %API%/api/alert -H "Content-Type: application/json" -d "{\"type\":\"community\",\"user\":\"GenereuxViewer\"}" >nul
timeout /t 7 /nobreak >nul

echo [6/6] RAID (1240 spectateurs)...
curl -s -X POST %API%/api/alert -H "Content-Type: application/json" -d "{\"type\":\"raid\",\"user\":\"UNAUTRECREATOR\",\"viewers\":1240,\"message\":\"Salut le chat, on arrive !\"}" >nul
timeout /t 8 /nobreak >nul

echo.
echo ==============================================
echo   Termine ! Toutes les alertes ont ete testees.
echo   Si rien ne s'affiche : verifie que le pont
echo   tourne (demarrer-pont.bat) et que OBS pointe
echo   sur http://localhost:8321/widget.html
echo ==============================================
echo.
pause
