'use strict';
const fs = require('fs');
let s = fs.readFileSync('widget.html', 'utf8');
const rep = (name, old, neu) => {
  const n = s.split(old).length - 1;
  if (n !== 1) { console.error('ECHEC ' + name + ' (occurrences: ' + n + ')'); process.exit(1); }
  s = s.replace(old, neu);
  console.log('ok ' + name);
};
rep('comment',
  "S\u00e9paration de couleurs : PSEUDOS = violet #C79BFF (celui qui donne ET celui qui\n   re\u00e7oit, m\u00eame couleur) \u00b7 LE RESTE = blanc / gris clair. */",
  "S\u00e9paration de couleurs : PSEUDOS = bleu clair #7CC7FF (celui qui donne ET celui qui\n   re\u00e7oit, m\u00eame couleur \u2014 s'accorde avec le violet du fond) \u00b7 LE RESTE = blanc / gris clair.\n   Ico\u00f4nes/labels : PNG transparents (plus de blend, plus de rectangle noir, pas de flou). */");
rep('icon+label',
  ".alert__icon{width:84px;height:84px;object-fit:contain;mix-blend-mode:screen;flex:none}\n.alert__labelimg{height:34px;width:auto;display:block;mix-blend-mode:screen}",
  ".alert__icon{width:120px;height:120px;object-fit:contain;flex:none}\n.alert__labelimg{height:34px;width:auto;display:block}");
rep('user+hl',
  "color:#C79BFF;filter:drop-shadow(0 0 16px rgba(145,70,255,.55))}",
  "color:#7CC7FF;filter:drop-shadow(0 0 16px rgba(80,170,255,.5))}");
rep('hl',
  ".alert__sub .hl{color:#C79BFF;font-weight:700}",
  ".alert__sub .hl{color:#7CC7FF;font-weight:700}");
rep('sub-ic',
  ".alert--sub .alert__icon{width:104px;height:104px}",
  ".alert--sub .alert__icon{width:150px;height:150px}");
rep('sub-user',
  "filter:drop-shadow(0 0 22px rgba(145,70,255,.7))",
  "filter:drop-shadow(0 0 22px rgba(80,170,255,.65))");
rep('raid-ic',
  ".alert--raid .alert__icon{width:92px;height:92px}",
  ".alert--raid .alert__icon{width:135px;height:135px}");
fs.writeFileSync('widget.html', s);
console.log('TOUS LES CHANGEMENTS APPLIQUES');
