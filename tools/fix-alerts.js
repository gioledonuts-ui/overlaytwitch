'use strict';
const fs = require('fs');
let s = fs.readFileSync('widget.html', 'utf8');
const start = ".alert__icon{width:120px;height:120px;object-fit:contain;flex:none}";
const end = ".alert--raid .alert__user{font-size:56px}";
const i = s.indexOf(start);
const j = s.indexOf(end);
if (i < 0 || j < 0 || j < i) { console.error('RÉGION TROUVÉE'); process.exit(1); }
const neu = [
  ".alert__icon{width:100px;height:100px;object-fit:contain}",
  "/* label : Bebas violet très espacé + filet de chaque côté (touch TV) */",
  ".alert__labeltxt{font-family:'Bebas Neue',sans-serif;font-size:22px;font-weight:400;",
  "  letter-spacing:.5em;color:#B06CFF;line-height:1;",
  "  display:flex;align-items:center;gap:16px}",
  ".alert__labeltxt::before,.alert__labeltxt::after{content:\"\";width:46px;height:1px;flex:none}",
  ".alert__labeltxt::before{background:linear-gradient(90deg,transparent,rgba(176,108,255,.75))}",
  ".alert__labeltxt::after{background:linear-gradient(90deg,rgba(176,108,255,.75),transparent)}",
  ".alert__body{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}",
  "/* PSEUDO : bleu clair uni, très grand, lueur bleue */",
  ".alert__user{font-family:'Bebas Neue',sans-serif;font-size:56px;letter-spacing:.06em;line-height:1;",
  "  color:#7CC7FF;filter:drop-shadow(0 0 16px rgba(80,170,255,.55))}",
  "/* détail : Inter italique grisé — le nom du receveur ressort en bleu gras non italique */",
  ".alert__sub{font-size:14px;font-weight:400;font-style:italic;letter-spacing:.03em;color:#B9BEC9}",
  ".alert__sub .hl{color:#7CC7FF;font-style:normal;font-weight:700}",
  "/* monogramme 7G : coin haut-droit, discret */",
  ".alert .mark7g{position:absolute;top:14px;right:16px;opacity:.45;z-index:2}",
  "/* FOLLOW : le plus simple */",
  ".alert--follow{min-width:540px}",
  ".alert--follow .alert__user{font-size:52px}",
  "/* SUB : le plus imposant + lueur (l'écart se VOIT) */",
  ".alert--sub{min-width:700px;padding:38px 80px;border-color:rgba(145,70,255,.55);",
  "  box-shadow:0 28px 70px rgba(0,0,0,.6),0 0 44px rgba(145,70,255,.35)}",
  ".alert--sub::before{content:\"\";position:absolute;inset:0;z-index:1;pointer-events:none;",
  "  background:radial-gradient(ellipse at 50% 45%,rgba(145,70,255,.26),transparent 70%)}",
  ".alert--sub .alert__icon{width:120px;height:120px}",
  ".alert--sub .alert__labeltxt{font-size:28px}",
  ".alert--sub .alert__user{font-size:72px;filter:drop-shadow(0 0 24px rgba(80,170,255,.7))}",
  ".alert--sub .alert__sub{color:#CFC4E8;font-size:15px}",
  "/* RAID : blanc net */",
  ".alert--raid{min-width:660px;border-color:rgba(255,255,255,.35)}",
  ".alert--raid .alert__icon{width:110px;height:110px}",
  ".alert--raid .alert__labeltxt{font-size:24px;color:#E7E9EE}",
  ".alert--raid .alert__labeltxt::before{background:linear-gradient(90deg,transparent,rgba(231,233,238,.6))}",
  ".alert--raid .alert__labeltxt::after{background:linear-gradient(90deg,rgba(231,233,238,.6),transparent)}",
  ".alert--raid .alert__user{font-size:62px}"
].join('\n');
s = s.slice(0, i) + neu + s.slice(j + end.length);
fs.writeFileSync('widget.html', s);
console.log('BLOC ALERTES REMPLACÉ');
