#!/usr/bin/env node
/* Génère demo/gif-demo.gif — GIF89a animé 1×1, 2 frames (pulse violet), boucle infinie.
   Zéro dépendance : encodage GIF89a à la main. Sert d'exemple de GIF dans le chat démo. */
'use strict';
const fs = require('fs');
const path = require('path');

class BitWriter {
  constructor() { this.bytes = []; this.bits = 0; this.cur = 0; }
  write(code, n) { for (let i = 0; i < n; i++) { this.cur |= ((code >> i) & 1) << this.bits; if (++this.bits === 8) { this.bytes.push(this.cur); this.cur = 0; this.bits = 0; } } }
  pad() { if (this.bits) { this.bytes.push(this.cur); this.bits = 0; this.cur = 0; } }
  buf() { this.pad(); return Buffer.from(this.bytes); }
}
const u16 = n => Buffer.from([n & 255, (n >> 8) & 255]);

/* LZW pour une image monochrome 1×1 : clear, pixel, EOI */
function lzw1x1(pixel, minCode) {
  const w = new BitWriter();
  const clear = 1 << (minCode + 1);      // 4
  const eoi = clear + 1;                 // 5
  w.write(clear, minCode + 1);
  w.write(pixel, minCode + 1);
  w.write(eoi, minCode + 1);
  const b = w.buf();
  return Buffer.concat([Buffer.from([minCode, b.length]), b, Buffer.from([0])]);
}

const W = 1, H = 1;
const gct = [
  [0x70, 0x00, 0xff],  // 0 : violet profond
  [0x91, 0x46, 0xff],  // 1 : violet clair
  [0x0a, 0x0a, 0x0a],  // 2 : fond
  [0x00, 0x00, 0x00]   // 3 : transparent (déclaré)
];
const frames = [0, 1];      // pixel affiché par frame (pulse)
const delay = 40;           // en 1/100 s (0,4 s par frame)

const out = [];
out.push(Buffer.from('GIF89a'));
out.push(u16(W)); out.push(u16(H));  // largeur / hauteur (LE)
out.push(Buffer.from([0x91, 3, 0]));   // GCT 4 entrées, bg index 0
for (const c of gct) out.push(Buffer.from(c));
/* extension de boucle Netscape (infini) */
out.push(Buffer.from([0x21, 0xff, 0x0b]));
out.push(Buffer.from('NETSCAPE2.0', 'ascii'));
out.push(Buffer.from([3, 1, 0, 0, 0]));
for (const f of frames) {
  /* GCE : délai + transparence index 3 */
  out.push(Buffer.from([0x21, 0xf9, 4, 0x04, delay & 255, (delay >> 8) & 255, 3, 0]));
  /* descripteur d'image */
  out.push(Buffer.from([0x2c, 0, 0, 0, 0]));
  out.push(Buffer.concat([u16(W), u16(H)]));
  out.push(Buffer.from([0]));
  out.push(lzw1x1(f, 2));
}
out.push(Buffer.from([0x3b]));

const file = Buffer.concat(out);
const dest = path.join(__dirname, '..', 'demo', 'gif-demo.gif');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, file);
console.log('✓ demo/gif-demo.gif (' + file.length + ' octets, 2 frames, boucle infinie)');
