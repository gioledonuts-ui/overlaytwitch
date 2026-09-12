#!/usr/bin/env node
/* Rend les assets (icônes + labels) en fond NOIR → TRANSPARENCE.
   La luminosité (max r,g,b) devient l'alpha : noir = transparent, blanc = opaque,
   gris = semi-transparent (bordures douces). Supprime le besoin du mix-blend-mode
   (qui causait le « flou » / rectangle noir sur les fonds d'alerte). */
'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const dir = path.join(__dirname, '..', 'assets');
// IMPORTANT : à n'appliquer qu'UNE seule fois par image (non idempotent).
// Usage : node tools/transparentize.js [fichier1 fichier2 ...] (défaut : toutes)
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['icon-follow.png', 'icon-sub.png', 'icon-raid.png'];

for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.log('skip', f); continue; }
  const png = PNG.sync.read(fs.readFileSync(p));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.max(d[i], d[i + 1], d[i + 2]);
    // seuil 36 : le « bruit » quasi-noir (haze/glows parasites) devient totalement
    // transparent ; les arêtes antialiasées (36-255) gardent leur douceur
    d[i + 3] = lum < 36 ? 0 : lum;
    d[i] = d[i + 1] = d[i + 2] = 255;     // pixels blancs (l'alpha fait le reste)
  }
  fs.writeFileSync(p, PNG.sync.write(png));
  console.log('✓', f, '→ transparent');
}
console.log('Terminé.');
