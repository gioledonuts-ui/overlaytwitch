#!/usr/bin/env bash
# 7GIONNY — démarre le pont local (démonstrateur). À garder ouvert pendant le stream.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Télécharge-le sur https://nodejs.org (LTS) puis relance."
  exit 1
fi

[ -d node_modules ] || { echo "[1/2] Premier lancement : installation des dépendances…"; npm install --no-audit --no-fund; }

echo
echo "[2/2] Pont démarré."
echo "  Démo dans le navigateur  →  http://localhost:8321/"
echo "  URL à mettre dans OBS    →  http://localhost:8321/widget.html"
echo "  Garde cette fenêtre ouverte."
echo
node server.js
