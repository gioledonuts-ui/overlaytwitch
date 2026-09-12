#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   7GIONNY — Rendu des bruitages du widget (WAV 44.1 kHz mono 16 bits)
   Aucun asset externe, aucun copyright : les sons sont conçus ici.
   Déterministe (RNG seedé) — même fichier à chaque exécution.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const SR = 44100;
const OUT = path.join(__dirname, '..', 'sounds');

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function normalize(s, target) {
  let peak = 0;
  for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
  if (peak < 1e-6) return s;
  const g = target / peak;
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i] * g;
  return out;
}
function makeIR(dur, decay, seed) {
  const rnd = mulberry32(seed);
  const n = Math.floor(SR * dur);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    a[i] = (rnd() * 2 - 1) * Math.exp(-decay * x) * Math.sqrt(1 - x);
  }
  return a;
}
function reverb(sig, dur, wet, seed) {
  const ir = makeIR(dur, 4.5, seed);
  const n = sig.length + ir.length - 1;
  const wetOut = new Float32Array(n);
  for (let i = 0; i < ir.length; i++) {
    const g = ir[i];
    if (Math.abs(g) < 1e-4) continue;
    for (let j = 0; j < sig.length; j++) wetOut[i + j] += g * sig[j];
  }
  const out = new Float32Array(n);
  out.set(sig);
  for (let i = 0; i < n; i++) out[i] += wet * wetOut[i];
  return out;
}
function toWavFile(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  console.log(`  ✓ ${path.basename(file)}  (${(buf.length / 1024).toFixed(0)} Ko, ${(n / SR).toFixed(2)} s)`);
}

/* ── 1) IMPACT (apparition) — sub-bass drop cinématique, saturé, spatialisé ── */
function renderImpact() {
  const rnd = mulberry32(7);
  const dur = 1.25, n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let phSub = 0, phBody = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fSub = t < 0.8 ? 62 * Math.pow(30 / 62, t / 0.8) : 30;   // 62 → 30 Hz
    phSub += 2 * Math.PI * fSub / SR;
    const ampSub = t < 0.015 ? t / 0.015 : Math.exp(-(t - 0.015) / 0.30);
    phBody += 2 * Math.PI * 45 / SR;                                 // corps 45 Hz
    const ampBody = t < 0.45 ? 0.55 * Math.exp(-t / 0.09) : 0;
    out[i] = 0.9 * Math.sin(phSub) * ampSub + 0.5 * Math.sin(phBody) * ampBody;
  }
  let y = 0;
  for (let i = 0; i < n; i++) {                                      // sweep de bruit low-pass 1200 → 60 Hz
    const t = i / SR;
    const f = t < 0.9 ? 1200 * Math.pow(60 / 1200, t / 0.9) : 60;
    const a = 1 - Math.exp(-2 * Math.PI * f / SR);
    y += a * ((rnd() * 2 - 1) - y);
    out[i] += 0.30 * y * Math.exp(-t / 0.35);
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(2.2 * out[i]);      // saturation analogique
  return normalize(reverb(out, 0.45, 0.16, 11), 0.88);
}

/* ── 2) CLICK (changement de leader) — tic mécanique sec ── */
function renderClick() {
  const rnd = mulberry32(21);
  const dur = 0.09, n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let ph = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = rnd() * 2 - 1;
    const diff = x - prev; prev = x;                                 // dérivation → hautes fréquences
    ph += 2 * Math.PI * 1900 / SR;
    out[i] = 0.8 * diff * Math.exp(-t / 0.011) + 0.5 * Math.sin(ph) * Math.exp(-t / 0.007);
  }
  return normalize(reverb(out, 0.18, 0.10, 5), 0.7);
}

/* ── 3) VICTORY (clôture) — tampon grave + note de validation claire (non mélodique) ── */
function renderVictory() {
  const dur = 0.95, n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    if (t < 0.22) {                                                   // tampon d'autorité 150 → 55 Hz
      const f = 150 * Math.pow(55 / 150, t / 0.18);
      ph += 2 * Math.PI * f / SR;
      s += 0.9 * Math.sin(ph) * Math.exp(-t / 0.055);
    }
    if (t > 0.07) {                                                   // validation : une note (B5) + 2 partiels
      const tt = t - 0.07;
      const env = Math.min(1, tt / 0.008) * Math.exp(-tt / 0.17);
      s += env * (0.55 * Math.sin(2 * Math.PI * 987.77 * tt)
               + 0.30 * Math.sin(2 * Math.PI * 1975.5 * tt)
               + 0.14 * Math.sin(2 * Math.PI * 2963 * tt));
    }
    if (t > 0.15) { const tt = t - 0.15; s += 0.25 * Math.sin(2 * Math.PI * 2400 * tt) * Math.exp(-tt / 0.006); }
    out[i] = s;
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(1.8 * out[i]);
  return normalize(reverb(out, 0.55, 0.20, 3), 0.9);
}

/* ── 4) CLOCK (boucle 1 s) — tic-tac de chrono, discret, sans couture ── */
function renderClock() {
  const rnd = mulberry32(31);
  const dur = 1.0, n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  const beat = (t0, fc, fs, gain, decay) => {
    const i0 = Math.floor(t0 * SR);
    let prev = 0;
    for (let i = i0; i < n; i++) {
      const t = i / SR - t0;
      const x = rnd() * 2 - 1;
      const diff = x - prev; prev = x;
      out[i] += gain * Math.exp(-t / decay) * (0.75 * diff + 0.45 * Math.sin(2 * Math.PI * fs * t));
    }
  };
  beat(0.0, 2100, 2100, 0.5, 0.012);   // TIC (fort, aigu)
  beat(0.5, 1500, 1500, 0.3, 0.010);   // TAC (plus doux, grave)
  // reverb minime pour un peu d'air
  const rev = reverb(out, 0.12, 0.08, 17);
  // recouper à 1 s pour une boucle parfaite
  const loop = new Float32Array(n);
  for (let i = 0; i < n; i++) loop[i] = rev[i] + rev[i + n] * 0.35;   // recouvrement de queue
  return normalize(loop, 0.55);
}

fs.mkdirSync(OUT, { recursive: true });
console.log('Rendu des bruitages…');
toWavFile(path.join(OUT, 'impact.wav'), renderImpact());
toWavFile(path.join(OUT, 'click.wav'), renderClick());
toWavFile(path.join(OUT, 'victory.wav'), renderVictory());
toWavFile(path.join(OUT, 'clock.wav'), renderClock());
console.log('Terminé → /sounds');
