#!/usr/bin/env node
/* Test DOM (jsdom) du widget en mode démo :
   - pas d'erreur JS
   - carte en mode live
   - question affichée
   - timer au format MM:SS
   - barres + pourcentages peuplés
   - variable --tension mise à jour
   - barre de décompte du temps présente */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'widget.html'), 'utf8')
  .replace('<title>', '<script>window.__AUTO__="demo=1";</script><title>');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: true,
  beforeParse(window) {
    // stub média : pas de vrai audio en jsdom
    window.Audio = class {
      constructor() { this.loop = false; this.muted = false; this.currentTime = 0; this.volume = 1; this._l = {}; }
      addEventListener(t, cb) { (this._l[t] = this._l[t] || []).push(cb); }
      removeEventListener() {}
      play() { return Promise.resolve(); }
      pause() {}
    };
    window.addEventListener('error', e => errors.push(String(e.message || e)));
  }
});

const doc = dom.window.document;
setTimeout(() => {
  const card = doc.getElementById('card');
  const q = doc.getElementById('question');
  const timer = doc.getElementById('timer');
  const fillA = doc.getElementById('fillA');
  const timeFill = doc.getElementById('timeFill');

  console.log('mode is-live   :', card.classList.contains('is-live'));
  console.log('question       :', JSON.stringify(q.textContent));
  console.log('timer          :', timer.textContent.trim());
  console.log('fillA width    :', fillA.style.width);
  console.log('pctA / pctB    :', doc.getElementById('pctA').textContent, '/', doc.getElementById('pctB').textContent);
  console.log('--tension      :', JSON.stringify(card.style.getPropertyValue('--tension')));
  console.log('timeFill width :', timeFill.style.width);
  const chatList = doc.getElementById('chatList');
  const firstMsg = chatList.children[0];
  const goalCount = doc.getElementById('goalCount');
  console.log('chat           :', chatList.children.length, 'message(s)',
    firstMsg ? '— ' + JSON.stringify(firstMsg.textContent.slice(0, 60)) : '');
  console.log('sub goal       :', goalCount ? goalCount.textContent : 'absent');
  console.log('erreurs JS     :', errors.length ? errors : 'aucune');

  const checks = [
    card.classList.contains('is-live'),
    q.textContent.length > 10,
    /^\d{2}:\d{2}$/.test(timer.textContent.trim()),
    fillA.style.width.endsWith('%'),
    /^\d+%$/.test(doc.getElementById('pctA').textContent),
    timeFill.style.width.endsWith('%'),
    chatList.children.length >= 1,
    !!firstMsg && firstMsg.querySelector('.cn').textContent !== 'spectateur',
    !!firstMsg && firstMsg.querySelector('.ctext').textContent.length > 3,   // texte non vide
    !!goalCount && /\d+\s*\/\s*\d+/.test(goalCount.textContent),            // sub goal peuplé
    errors.length === 0
  ];
  console.log(checks.every(Boolean) ? 'SMOKE_OK' : 'SMOKE_FAIL');
  process.exit(checks.every(Boolean) ? 0 : 1);
}, 3500);
