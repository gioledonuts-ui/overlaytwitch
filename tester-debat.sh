#!/usr/bin/env bash
# 7GIONNY — débat de test (45 s) pour valider le widget dans OBS.
set -e
API="${API:-http://localhost:8321}"

echo "Lancement d'un débat de test de 45 s…"
curl -s -X POST "$API/api/debate" -H "Content-Type: application/json" \
  -d "{\"question\":\"TEST — Le format court a-t-il tué la culture ?\",\"a\":\"Oui, tout s'accélère\",\"b\":\"Non, l'accès s'élargit\",\"duration\":45}" >/dev/null

sleep 2
for u in lucas emma thomas julie rachel antoine louna kevin amelie yassine; do
  curl -s -X POST "$API/api/vote" -H "Content-Type: application/json" -d "{\"choice\":\"A\",\"user\":\"$u\"}" >/dev/null
done
for u in sacha maeva noah jessilyne; do
  curl -s -X POST "$API/api/vote" -H "Content-Type: application/json" -d "{\"choice\":\"B\",\"user\":\"$u\"}" >/dev/null
done

echo
echo "Débat lancé ! Regarde OBS :"
echo "  - la carte monte en bas de l'écran (impact de basse)"
echo "  - les barres évoluent (clicks discrets)"
echo "  - à la fin : le gagnant pulse 5 s, puis la carte disparaît"
