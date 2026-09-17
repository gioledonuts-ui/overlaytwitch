#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   7GIONNY — DÉBAT OVERLAY · PONT LOCAL (Node ≥ 18, zéro dépendance
   obligatoire ; tmi.js optionnel pour les commandes chat)
   ───────────────────────────────────────────────────────────────────
   Rôle :
     • servir le widget (http://localhost:8321/widget.html → OBS)
     • diffuser l'état au widget en temps réel (SSE /events)
     • recevoir les votes (chat, clics, API HTTP)
     • lancer/terminer les débats (chat !debate, /api/debate, /poll Twitch)
   ═══════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = +(process.env.PORT || 8321);

/* — Clés : chargées depuis secrets.json (à remplir à la main, jamais versionné).
     Si une variable d'environnement existe, elle a priorité. — */
let SECRETS = {};
try {
  const sp = path.join(__dirname, 'secrets.json');
  if (fs.existsSync(sp)) SECRETS = JSON.parse(fs.readFileSync(sp, 'utf8')) || {};
} catch (e) { console.warn('[config] secrets.json illisible (ignoré) :', e.message); }
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '') ? process.env[k] : (SECRETS[k] !== undefined && SECRETS[k] !== '' ? SECRETS[k] : d);

/* Nettoie un token : retire le préfixe "oauth:" (s'il y est collé par erreur),
   les espaces, guillemets et retours à la ligne. Un token Twitch est une suite
   de lettres/chiffres SANS "oauth:" devant (le "oauth:" c'est uniquement pour le CHAT). */
function cleanToken(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^["']|["']$/g, '').trim();                    // guillemets éventuels
  t = t.replace(/^oauth:/i, '').trim();                        // préfixe oauth: collé par erreur
  t = t.replace(/\s+/g, '');                                   // espaces / retours à la ligne
  return t;
}

const ADMIN_TOKEN = env('ADMIN_TOKEN', '');
const ALLOWED = String(env('ALLOWED_USERS', '')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/* — Capture des sondages natifs /poll (Helix, polling 2,5 s) — */
const CLIENT_ID = cleanToken(env('CLIENT_ID', ''));
const BROADCASTER_ID = cleanToken(env('BROADCASTER_ID', ''));
const POLL_OAUTH = cleanToken(env('POLL_OAUTH', ''));      // user token · scope channel:read:polls

/* — Chat Twitch (tmi.js optionnel) — */
const CHAT_OAUTH = env('CHAT_OAUTH', '');   // le "oauth:" EST attendu ici (tmi.js)
const CHAT_NICK = cleanToken(env('CHAT_NICK', ''));
/* Canal à écouter = ta chaîne Twitch (où le bot doit lire les messages).
   Par défaut = CHAT_NICK (si tu utilises ton propre compte comme bot).
   Si ton bot est un compte séparé, mets ici le nom de TA chaîne (ex. 7gionny). */
const CHAT_CHANNEL = env('CHAT_CHANNEL', CHAT_NICK);

/* ═══ État global ═══════════════════════════════════════════════ */
let state = { mode: 'idle' };
const votes = new Map();        // username → { c:'A'|'B', ts }
const sse = new Set();          // réponses EventSource
let lastBroadcast = 0, dirty = false;
let currentPollId = null;

const broadcast = force => {
  const now = Date.now();
  if (!force && !dirty) return;
  if (now - lastBroadcast < 150 && !force) return;   // max ~7 msg/s
  lastBroadcast = now; dirty = false;
  const payload = 'data: ' + JSON.stringify(state) + '\n\n';
  for (const res of sse) res.write(payload);
};

/* — CONFIG PERSISTANTE (modifiable via le panneau de contrôle) — */
const PERSIST_FILE = path.join(__dirname, 'config-perso.json');
const DEFAULT_CONFIG = {
  subGoalLabel: 'SUB GOAL',
  subGoalTarget: 50,
  subGoalAuto: true,
  subGoalManual: 0,
  // file d'attente d'objectifs (tous les objectifs definis par l'utilisateur, tries petit->grand)
  subGoalQueue: [], // [{label,target}]
  // prochain objectif prepare a l'avance (compat V30, affiche en dessous, non checke)
  subGoalNextLabel: '',
  subGoalNextTarget: 0,
  subGoalHistory: [], // [{label,target,completedAt,currentAtCompletion}]
  chatTitle: 'CHAT DE 7GIONNY',
  accent: '#9146FF',
  // velocite V5 : seuil % + duree ajout + chrono verrou + fin prevue
  velocityEquilibrium: 20,
  velocityClimb: 0.65,
  velocityDecay: 0.14,
  velocityHold: 120,
  velocityBarWidth: 30,
  velocityBarHeight: 700,
  velocityShowMetrics: true,
  velocityEnabled: true,
  velocityGoalThreshold: 90,
  velocityGoalDurationMinutes: 15,
  velocityHoldDurationSeconds: 120,
  velocityFinHour: 21,
  velocityFinMinute: 30,
  velocityFinEnabled: true
};
let appConfig = Object.assign({}, DEFAULT_CONFIG);
try {
  if (fs.existsSync(PERSIST_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8')) || {};
    appConfig = Object.assign({}, DEFAULT_CONFIG, saved);
  }
} catch (e) { console.warn('[config] config-perso.json illisible :', e.message); }
function saveConfig() {
  try { fs.writeFileSync(PERSIST_FILE, JSON.stringify(appConfig, null, 2)); } catch (e) {}
}

/* ═══ VERSIONING & HISTORIQUE DES MISES À JOUR ══════════════════
   • VERSION.txt (à la racine) = version installée (« v28 », ou
     l'ancien format « VERSION 26 » — les deux sont compris).
   • update-info.json (local, jamais écrasé par les MAJ) = date de la
     dernière mise à jour + historique des versions installées.
   • La dernière version dispo est lue sur GitHub (brut, cache 5 min) :
     si elle égale la version installée, le panneau affiche « À jour »
     et ne retélécharge rien (pas d'actualisation inutile). */
const VERSION_FILE = path.join(__dirname, 'VERSION.txt');
const UPDATE_INFO_FILE = path.join(__dirname, 'update-info.json');
const REMOTE_VERSION_URL = 'https://raw.githubusercontent.com/gioledonuts-ui/overlaytwitch/main/VERSION.txt';

function parseVersion(raw) {
  const m = String(raw || '').match(/(\d+)/);
  const num = m ? parseInt(m[1], 10) : 0;
  return { display: num > 0 ? 'v' + num : '?', num, raw: String(raw || '').trim().slice(0, 24) };
}
function readLocalVersion() {
  try { return parseVersion(fs.readFileSync(VERSION_FILE, 'utf8')); }
  catch (e) { return { display: '?', num: 0, raw: '' }; }
}
let updateInfo = { version: null, updatedAt: null, history: [] };
try {
  if (fs.existsSync(UPDATE_INFO_FILE)) {
    updateInfo = Object.assign(updateInfo, JSON.parse(fs.readFileSync(UPDATE_INFO_FILE, 'utf8')) || {});
  }
} catch (e) { console.warn('[version] update-info.json illisible :', e.message); }
if (!Array.isArray(updateInfo.history)) updateInfo.history = [];
function saveUpdateInfo() {
  try { fs.writeFileSync(UPDATE_INFO_FILE, JSON.stringify(updateInfo, null, 2)); } catch (e) {}
}
/* 1er démarrage avec ce système : on initialise depuis VERSION.txt
   (date du fichier = date approximative de la dernière MAJ). */
(function initUpdateInfo() {
  const local = readLocalVersion();
  if (!updateInfo.version || !updateInfo.updatedAt) {
    let at = new Date().toISOString();
    try { at = fs.statSync(VERSION_FILE).mtime.toISOString(); } catch (e) {}
    updateInfo.version = local.display;
    updateInfo.updatedAt = at;
    if (local.num > 0 && !updateInfo.history.some(h => h.version === local.display)) {
      updateInfo.history.push({ version: local.display, date: at });
    }
    saveUpdateInfo();
  }
})();
function recordUpdate(newDisplay) {
  const now = new Date().toISOString();
  updateInfo.version = newDisplay;
  updateInfo.updatedAt = now;
  const last = updateInfo.history[updateInfo.history.length - 1];
  if (!last || last.version !== newDisplay) {
    updateInfo.history.push({ version: newDisplay, date: now });
    updateInfo.history = updateInfo.history.slice(-20);   // 20 dernières entrées max
  }
  saveUpdateInfo();
}
/* Version distante (GitHub brut) avec cache de 5 min. */
let remoteCache = { at: 0, data: null };
async function fetchRemoteVersion() {
  if (Date.now() - remoteCache.at < 5 * 60 * 1000 && remoteCache.data) return remoteCache.data;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(REMOTE_VERSION_URL, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const parsed = parseVersion(await r.text());
    remoteCache = { at: Date.now(), data: parsed };
    return parsed;
  } finally { clearTimeout(timer); }
}

/* — SUB GOAL V31 : file d'attente + logique plus proche du nombre de subs — */
function normalizeQueue(q) {
  if (!Array.isArray(q)) return [];
  const cleaned = q.map(o => {
    if (typeof o === 'number') return { label: 'SUB GOAL', target: Math.max(1, Math.round(o)) };
    return { label: String(o.label || 'SUB GOAL').slice(0,24), target: Math.max(1, Math.round(+o.target || 0)) };
  }).filter(o => o.target > 0);
  cleaned.sort((a,b)=> a.target - b.target);
  // dedup par target (garde premier)
  const seen = new Set();
  const dedup = [];
  for (const it of cleaned) {
    if (!seen.has(it.target)) { seen.add(it.target); dedup.push(it); }
  }
  return dedup;
}

// si queue vide mais ancien next existe, on l'injecte dans queue pour compat
if ((!appConfig.subGoalQueue || appConfig.subGoalQueue.length===0) && appConfig.subGoalNextTarget>0) {
  appConfig.subGoalQueue = [{ label: appConfig.subGoalNextLabel||appConfig.subGoalLabel, target: appConfig.subGoalNextTarget }];
}
// si queue vide mais current target existe, on l'injecte aussi (au moins 1 objectif)
if (!appConfig.subGoalQueue || appConfig.subGoalQueue.length===0) {
  appConfig.subGoalQueue = [{ label: appConfig.subGoalLabel, target: appConfig.subGoalTarget }];
}
appConfig.subGoalQueue = normalizeQueue(appConfig.subGoalQueue);

const goalState = {
  label: appConfig.subGoalLabel,
  current: appConfig.subGoalAuto ? 0 : appConfig.subGoalManual,
  target: appConfig.subGoalTarget,
  nextLabel: appConfig.subGoalNextLabel || '',
  nextTarget: appConfig.subGoalNextTarget || 0,
  history: Array.isArray(appConfig.subGoalHistory) ? appConfig.subGoalHistory.slice(-10) : [],
  queue: appConfig.subGoalQueue.slice(), // tous les objectifs definis tries
  upcoming: [] // ceux > current, a venir
};

// init V31 : calcule actuel/upcoming/history depuis queue + current
// on ne peut pas appeler recompute avant sa declaration, on le fera apres definition
function broadcastGoal() {
  // compat : next = premier upcoming
  if (goalState.upcoming && goalState.upcoming.length>0) {
    goalState.nextLabel = goalState.upcoming[0].label;
    goalState.nextTarget = goalState.upcoming[0].target;
  } else {
    // fallback ancien champ
    goalState.nextLabel = goalState.nextLabel || '';
    goalState.nextTarget = goalState.nextTarget || 0;
  }
  const payload = 'data: ' + JSON.stringify(Object.assign({ goal: 1 }, goalState)) + '\n\n';
  for (const res of sse) res.write(payload);
}

function saveGoalHistory() {
  appConfig.subGoalHistory = goalState.history.slice(-10);
  saveConfig();
}

// recompute : logique "plus proche du nombre de subs actuels"
// - queue trie petit->grand
// - tout target <= current → history (si pas deja dedans)
// - premier target > current → current goal (actuel)
// - reste → upcoming (a venir en dessous)
function recomputeGoalsFromCount() {
  const cur = goalState.current;
  const queue = normalizeQueue(appConfig.subGoalQueue);
  appConfig.subGoalQueue = queue;
  goalState.queue = queue.slice();

  // history existant : on garde ceux deja completes + on ajoute ceux <= cur qui ne sont pas deja en history
  const histTargets = new Set(goalState.history.map(h=>h.target));
  const newCompleted = [];
  for (const q of queue) {
    if (q.target <= cur && !histTargets.has(q.target)) {
      newCompleted.push({ label: q.label, target: q.target, currentAtCompletion: cur, completedAt: new Date().toISOString() });
    }
  }
  if (newCompleted.length) {
    goalState.history = goalState.history.concat(newCompleted);
    // tri history petit->grand
    goalState.history.sort((a,b)=>a.target-b.target);
    if (goalState.history.length>10) goalState.history = goalState.history.slice(-10);
    appConfig.subGoalHistory = goalState.history.slice();
  }

  // trouve actuel : plus proche au dessus du nombre actuel
  // ex: 2 subs, objectifs 5 et 10 → 5
  const above = queue.filter(q => q.target > cur).sort((a,b)=>a.target-b.target);
  if (above.length>0) {
    const chosen = above[0];
    goalState.label = chosen.label;
    goalState.target = chosen.target;
    goalState.upcoming = above.slice(1);
    // compat anciens champs
    appConfig.subGoalLabel = chosen.label;
    appConfig.subGoalTarget = chosen.target;
    if (goalState.upcoming.length>0) {
      appConfig.subGoalNextLabel = goalState.upcoming[0].label;
      appConfig.subGoalNextTarget = goalState.upcoming[0].target;
    } else {
      appConfig.subGoalNextLabel = '';
      appConfig.subGoalNextTarget = 0;
    }
  } else {
    // aucun au dessus : on reste sur le dernier objectif (meme si depasse) comme demande
    if (queue.length>0) {
      const last = queue[queue.length-1];
      goalState.label = last.label;
      goalState.target = last.target;
      goalState.upcoming = [];
      appConfig.subGoalLabel = last.label;
      appConfig.subGoalTarget = last.target;
      appConfig.subGoalNextLabel = '';
      appConfig.subGoalNextTarget = 0;
    }
    // sinon garde actuel
  }
  saveConfig();
  broadcastGoal();
}

function checkAndSwitchGoal() {
  // V31 : on passe par recompute, qui gere automatiquement le plus proche
  const beforeLabel = goalState.label;
  const beforeTarget = goalState.target;
  const beforeHistLen = goalState.history.length;
  recomputeGoalsFromCount();
  const switched = (goalState.label !== beforeLabel || goalState.target !== beforeTarget || goalState.history.length !== beforeHistLen);
  if (switched) {
    console.log(`[sub-goal] recompute → actuel ${goalState.label} ${goalState.current}/${goalState.target} (hist ${goalState.history.length}, upcoming ${goalState.upcoming.length})`);
  }
  return switched;
}

// init au demarrage : calcule upcoming/history selon current
try { recomputeGoalsFromCount(); } catch(e){ console.warn('init goal recompute', e.message); }

/* — Alertes (follow / sub / gift / raid) : diffuses au widget — */
function broadcastAlert(a) {
  const payload = 'data: ' + JSON.stringify({
    alert: a.type,
    user: String(a.user || '').slice(0, 64),
    viewer: a.viewer ? String(a.viewer).slice(0, 64) : undefined,
    stints: a.stints || undefined,
    total: a.total || undefined,
    viewers: a.viewers || undefined,
    plan: a.plan ? String(a.plan).slice(0, 8) : undefined,
    message: a.message ? String(a.message).slice(0, 120) : undefined   // message personnalisé du sub/raid
  }) + '\n\n';
  for (const res of sse) res.write(payload);
}

/* — Diffusion du chat Twitch au widget (panneau gauche) — */
let lastChatBcast = 0;

/* Reformate l'objet tmi.js { id: ['début-fin', …] } en "id:début-fin/id:début-fin" */
function rawEmotes(emotesObj) {
  if (!emotesObj || typeof emotesObj !== 'object') return '';
  const parts = [];
  for (const [id, ranges] of Object.entries(emotesObj)) {
    const r = Array.isArray(ranges) ? ranges : [ranges];
    for (const range of r) if (range) parts.push(id + ':' + range);
  }
  return parts.join('/');
}

function broadcastChat(m) {
  const now = Date.now();
  if (now - lastChatBcast < 50) return;              // ~20 msg/s max
  lastChatBcast = now;
  const badges = (m.badges && typeof m.badges === 'object')
    ? Object.fromEntries(Object.entries(m.badges).slice(0, 6)
        .map(([id, v]) => [String(id).slice(0, 32), String(v || '1').slice(0, 8)]))
    : undefined;
  const payload = 'data: ' + JSON.stringify({
    chat: 1,
    user: String(m.user || '').slice(0, 64),
    msg: String(m.msg || '').slice(0, 300),
    role: m.role === 'me' ? 'me' : (m.role === 'mod' ? 'mod' : 'user'),
    emotes: m.emotes ? String(m.emotes).slice(0, 200) : undefined,
    emoteSets: m.emoteSets ? String(m.emoteSets).slice(0, 400) : undefined,
    highlight: m.highlight === true || m.highlight === 1 || m.highlight === '1',
    replyTo: m.replyTo ? String(m.replyTo).slice(0, 64) : undefined,
    color: m.color ? String(m.color).slice(0, 32) : undefined
  }) + '\n\n';
  for (const res of sse) res.write(payload);
}
setInterval(() => { if (dirty) broadcast(true); }, 200);   // flush différé

function idle() { state = { mode: 'idle' }; broadcast(true); }

function startDebate({ question, a, b, c, d, duration = 120, source = 'chat', startsAt = Date.now() }) {
  const dur = Math.min(600, Math.max(15, Math.round(duration) || 120));
  votes.clear();
  const choices = {};
  choices.a = String(a||'').slice(0,60);
  choices.b = String(b||'').slice(0,60);
  if (c) choices.c = String(c).slice(0,60);
  if (d) choices.d = String(d).slice(0,60);
  state = { 
    mode: 'live', source, question: String(question||'').slice(0,140), 
    a: choices.a, b: choices.b, 
    c: choices.c || undefined, d: choices.d || undefined,
    va: 0, vb: 0, vc: 0, vd: 0,
    startsAt, endsAt: Date.now() + dur * 1000 
  };
  lastBroadcast = 0;
  broadcast(true);
  const list = [choices.a, choices.b, choices.c, choices.d].filter(Boolean).map((x,i)=>String.fromCharCode(65+i)+'='+x).join(' ');
  console.log(`[débat] (${source}) ${question} · ${list} · ${dur}s`);
}

function tally(choice, user = 'anon') {
  if (state.mode !== 'live') return false;
  let raw = String(choice).toUpperCase().trim();
  let c = 'A';
  if (raw.startsWith('B') || raw==='2') c='B';
  else if (raw.startsWith('C') || raw==='3') c='C';
  else if (raw.startsWith('D') || raw==='4') c='D';
  else if (raw.startsWith('A') || raw==='1') c='A';
  else c='A';
  // if choice C/D requested but debate has only 2 options, map to A/B? Keep but ignore if not exist
  if ((c==='C' && !state.c) || (c==='D' && !state.d)) {
    // if only 2 options, treat C as A and D as B? No, ignore
    if (!state.c && !state.d) {
      // fallback to A/B logic already
    }
  }
  const u = String(user || 'anon').toLowerCase().slice(0, 64);
  if (votes.has(u)) return false;
  votes.set(u, { c, ts: Date.now() });
  if (c==='A') state.va = (state.va||0)+1;
  else if (c==='B') state.vb = (state.vb||0)+1;
  else if (c==='C') state.vc = (state.vc||0)+1;
  else if (c==='D') state.vd = (state.vd||0)+1;
  dirty = true;
  return true;
}

/* ═══ Vote fluide (sans commande) ══════════════════════════════
   Les spectateurs votent en écrivant simplement le mot attendu
   (ex. « voiture ») — insensible à la casse ET aux accents.
   Méthodes acceptées :
     • le mot / l'option en toutes lettres (« voiture », « oui je pense »)
     • « A » / « B » / « 1 » / « 2 » seuls
     • « !vote A » / « !vote B » (historique, toujours supporté) */
function normVote(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
/* Mot-clé d'une option = son premier mot significatif (≥ 2 lettres).
   Ex. « Oui, tout s'accélère » → « oui » · « Non, … » → « non ». */
function voteKeyword(opt) {
  const words = normVote(opt).split(' ').filter(Boolean);
  for (const w of words) if (w.length >= 2) return w;
  return words[0] || '';
}
/* Déduit un vote depuis un message libre. Retourne 'A'|'B'|'C'|'D'|null.
   null = pas de vote détecté, ou message ambigu. */
function matchVoteFromText(text) {
  if (state.mode !== 'live') return null;
  const raw = String(text || '').trim();
  if (!raw || raw.startsWith('!')) return null;
  const n = normVote(raw);
  if (!n) return null;
  if (n === 'a' || n === '1') return 'A';
  if (n === 'b' || n === '2') return 'B';
  if (n === 'c' || n === '3') return state.c ? 'C' : null;
  if (n === 'd' || n === '4') return state.d ? 'D' : null;
  const na = normVote(state.a), nb = normVote(state.b), nc = state.c ? normVote(state.c) : '', nd = state.d ? normVote(state.d) : '';
  const hay = ' ' + n + ' ';
  const hasA = na.length >= 2 && (n === na || hay.includes(' ' + na + ' '));
  const hasB = nb.length >= 2 && (n === nb || hay.includes(' ' + nb + ' '));
  const hasC = nc.length >= 2 && (n === nc || hay.includes(' ' + nc + ' '));
  const hasD = nd.length >= 2 && (n === nd || hay.includes(' ' + nd + ' '));
  const count = (hasA?1:0)+(hasB?1:0)+(hasC?1:0)+(hasD?1:0);
  if (count!==1) {
    if (count>1) return null;
    // try keyword
    const ka = voteKeyword(state.a), kb = voteKeyword(state.b), kc = state.c ? voteKeyword(state.c) : '', kd = state.d ? voteKeyword(state.d) : '';
    const words = new Set(n.split(' '));
    const inA = ka.length >= 2 && words.has(ka);
    const inB = kb.length >= 2 && words.has(kb);
    const inC = kc.length >= 2 && words.has(kc);
    const inD = kd.length >= 2 && words.has(kd);
    const kcCount = (inA?1:0)+(inB?1:0)+(inC?1:0)+(inD?1:0);
    if (kcCount!==1) return null;
    if (inA) return 'A';
    if (inB) return 'B';
    if (inC) return 'C';
    if (inD) return 'D';
    return null;
  }
  if (hasA) return 'A';
  if (hasB) return 'B';
  if (hasC) return 'C';
  if (hasD) return 'D';
  return null;
}

function finish(source) {
  if (state.mode !== 'live') return;
  const va = state.va || 0, vb = state.vb || 0, vc = state.vc || 0, vd = state.vd || 0;
  const scores = [{k:'A',v:va},{k:'B',v:vb}];
  if (state.c) scores.push({k:'C',v:vc});
  if (state.d) scores.push({k:'D',v:vd});
  scores.sort((x,y)=>y.v - x.v);
  const top = scores[0];
  const tie = scores.length>1 && scores[0].v === scores[1].v;
  state = {
    mode: 'ended', source: state.source,
    question: state.question, a: state.a, b: state.b, c: state.c, d: state.d,
    va, vb, vc, vd,
    endsAt: Date.now(),
    winner: tie ? null : top.k
  };
  broadcast(true);
  const resStr = scores.map(s=>`${s.k} ${s.v}`).join(' - ');
  console.log(`[résultat] ${resStr} · gagnant : ${state.winner || 'égalité'}`);
  setTimeout(() => { if (state.mode === 'ended') idle(); }, 6000);
}

/* auto-fin quand le timer expire (débats lancés via chat/API) */
setInterval(() => {
  if (state.mode === 'live' && Date.now() >= state.endsAt && state.source !== 'twitch') finish('timer');
}, 500);

/* ═══ Chat Twitch (tmi.js — optionnel) ══════════════════════════ */
let tmi = null;
try { tmi = require('tmi.js'); } catch (e) {
  console.warn('[chat] tmi.js non installé — commandes chat désactivées. (npm install tmi.js)');
}
let chatOn = false;
if (tmi && CHAT_OAUTH && CHAT_NICK) {
  chatOn = true;
  const chat = new tmi.Client({
    options: { debug: false },
    connection: { secure: true, reconnect: true },
    identity: { username: CHAT_NICK, password: CHAT_OAUTH },
    channels: [CHAT_CHANNEL]
  });
  chat.on('initialized', () => console.log(`[chat] connecté comme ${CHAT_NICK}`));
  /* — Pin Twitch : NOTICE « pinned » (le texte du message épinglé arrive en contenu)
        et « unpinned » (dépingle). Heuristique : on ignore les notices techniques. — */
  chat.on('notice', (channel, msg) => {
    if (typeof msg !== 'string') return;
    const t = msg.trim();
    if (/^(r99w?|emoteco|emoteonly|subbadgesonly|raid.*|followage|hosted|automod)/i.test(t)) return;
    if (t === 'unpinned') {
      for (const res of sse) res.write('data: ' + JSON.stringify({ pin: 0 }) + '\n\n');
      console.log('[chat] message désépinglé');
    } else if (t.length > 2) {
      for (const res of sse) res.write('data: ' + JSON.stringify({
        pin: 1, user: CHAT_NICK, msg: t.slice(0, 300), role: 'me'
      }) + '\n\n');
      console.log('[chat] message épinglé → ' + t.slice(0, 40));
    }
  });
  /* — Subs / gifts / raids Twitch → alertes dans l'overlay — */
  chat.on('subscription', (channel, user, courtesy, stints, message) => {
    broadcastAlert({ type: stints > 0 ? 'resub' : 'sub', user, stints: stints || 0, message });
    console.log('[alerte] ' + (stints > 0 ? 'resub R' + (stints + 1) : 'sub') + ' : ' + user);
  });
  chat.on('subnotice', (channel, userId, nick, msg) => {
    const t = String(msg || '').toLowerCase();
    let type = 'gift';
    if (t.includes('mass-gift') || t.includes('mass gift')) type = 'community';
    else if (t.includes('anon')) type = 'anon';
    else if (t.includes('prime')) type = 'prime';
    broadcastAlert({ type, user: nick });
    console.log('[alerte] sub-notice (' + type + ') : ' + nick);
  });
  chat.on('raid', (channel, user, viewers, msg) => {
    broadcastAlert({ type: 'raid', user, viewers, message: msg });
    console.log('[alerte] raid : ' + user + ' (' + viewers + ' spectateurs)');
  });

  chat.on('message', (channel, userstate, message, self) => {
    // Signature tmi.js : (channel, userstate, message, self)
    //   userstate = les "tags" du message (pseudo, badges, emotes, réponses…)
    //   message   = LE TEXTE du message
    const text = String(message || '');
    const username = (userstate && (userstate['display-name'] || userstate.username)) || '';
    const badges = (userstate && userstate.badges) || {};
    const color = (userstate && userstate.color) || '';
    // tmi.js stocke les emotes en OBJET { id: ['début-fin', …] }.
    // On les reformate en chaîne brute "id:début-fin/id:début-fin"
    // pour que le widget puisse les afficher en images.
    const emotes = rawEmotes(userstate && userstate.emotes);
    const replyTo = (userstate && userstate['reply-parent-display-name']) || undefined;
    const highlighted = (userstate && userstate['msg-id']) === 'highlighted-message'
      || (userstate && userstate['pinned-chat-paid-amount'] !== undefined);

    /* diffusion au widget (tous les messages, comme le vrai chat Twitch) :
       badges officiels (sub/mod/vip/staff…), emotes + GIFs animés, highlight/pin */
    if (emotes) console.log('[chat] emotes détectées :', emotes, '→', text.slice(0, 50));
    broadcastChat({
      user: username,
      msg: text,
      role: badges.broadcaster ? 'me' : (badges.moderator ? 'mod' : 'user'),
      badges: badges,
      color: color,
      emotes: emotes,
      highlight: highlighted,
      replyTo: replyTo
    });
    /* Vote fluide : un simple mot suffit (« voiture » vote, sans !vote,
       insensible à la casse — 1 seul vote par personne et par débat) */
    if (!text.startsWith('!')) {
      if (state.mode === 'live') {
        const pick = matchVoteFromText(text);
        if (pick) tally(pick, username);
      }
      return;
    }
    const [cmd, ...rest] = text.split(' ');
    const c = cmd.toLowerCase();
    const isStaff = (badges.broadcaster || badges.moderator)
      || ALLOWED.includes(username.toLowerCase());

    if (c === '!debate') {
      if (!isStaff) { chat.say(channel, '[Débat] Réservé au streamer et aux mods.'); return; }
      const parts = rest.join(' ').split('|').map(s => s.trim().replace(/^["']|["']$/g, ''));
      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return;
      let dur = 120;
      const m = parts[parts.length - 1].match(/^(\d{1,4})\s*(s|sec)?$/i);
      if (m) { dur = +m[1]; parts.pop(); }
      const qa = parts[0].slice(0, 140);
      const qa_a = parts[1].slice(0, 60), qa_b = parts[2].slice(0, 60);
      const qa_c = (parts[3]||'').slice(0,60), qa_d = (parts[4]||'').slice(0,60);
      startDebate({ question: qa, a: qa_a, b: qa_b, c: qa_c, d: qa_d, duration: dur, source: 'chat' });
      const short = s => (s.length > 28 ? s.slice(0, 27) + '…' : s);
      let msg = `[Débat] LANCÉ · ${dur}s · ${short(qa_a)} / ${short(qa_b)}`;
      if (qa_c) msg += ` / ${short(qa_c)}`;
      if (qa_d) msg += ` / ${short(qa_d)}`;
      chat.say(channel, msg);
    } else if (c === '!vote') {
      const arg = (rest[0] || '').toLowerCase();
      if (arg === 'a' || arg === '1') tally('A', username);
      else if (arg === 'b' || arg === '2') tally('B', username);
      else if (arg === 'c' || arg === '3') { if (state.c) tally('C', username); }
      else if (arg === 'd' || arg === '4') { if (state.d) tally('D', username); }
      else if (state.mode === 'live') chat.say(channel, '[Débat] Vote invalide — tapez A / B / C / D dans le chat.');
    } else if (c === '!end') {
      if (!isStaff) return;
      finish('chat');
    }
  });
  chat.connect();
}

/* ═══ Sondages natifs /poll (API Helix) ═════════════════════════ */
let helixOn = false;
let resolvedBroadcasterId = BROADCASTER_ID;

/* Résout automatiquement ton ID de chaîne (numéro) à partir de ton token :
   l'appel /users renvoie l'identité du propriétaire du token. Tu n'as donc
   PAS besoin de chercher ton BROADCASTER_ID à la main. */
async function resolveBroadcaster() {
  if (resolvedBroadcasterId) return true;
  if (!CLIENT_ID || !POLL_OAUTH) return false;
  try {
    const r = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + POLL_OAUTH }
    });
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = j.message || j.error || JSON.stringify(j); } catch (e) {}
      console.warn('[auth] GET /users → HTTP ' + r.status + (detail ? ' — ' + detail : ''));
      return false;
    }
    const d = await r.json();
    if (d.data && d.data[0] && d.data[0].id) {
      resolvedBroadcasterId = d.data[0].id;
      console.log('[auth] chaîne détectée : ' + (d.data[0].login || d.data[0].display_name) + ' (' + resolvedBroadcasterId + ')');
      return true;
    }
    console.warn('[auth] GET /users → aucune donnée (token valide mais pas de compte ?)');
  } catch (e) {
    console.warn('[auth] erreur réseau sur GET /users :', e.message || e);
  }
  return false;
}

/* — État du token (pour le panneau) : null = pas encore vérifié — */
let tokenInfo = null;

/* — Validation du token au démarrage : affiche clairement s'il est valide
     et quels droits il possède (sondages, abonnés, follows). — */
async function checkToken() {
  if (!POLL_OAUTH) { tokenInfo = { valid: false, reason: 'absent' }; console.warn('[auth] aucun token POLL_OAUTH dans secrets.json'); return; }
  // affiche la longueur + les 6 premiers caractères (pour vérifier qu'il est bien lu)
  console.log('[auth] token lu : ' + POLL_OAUTH.length + ' caractères, commence par "' + POLL_OAUTH.slice(0, 6) + '..."');
  try {
    const r = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': 'OAuth ' + POLL_OAUTH }
    });
    if (!r.ok) {
      tokenInfo = { valid: false, reason: 'invalide' };
      console.warn('[auth] token INVALIDE (HTTP ' + r.status + ') — régénère-le avec le bon lien');
      return;
    }
    const v = await r.json();
    const scopes = v.scopes || [];
    tokenInfo = { valid: true, login: v.login || '', scopes };
    const missing = [];
    if (!scopes.includes('channel:read:polls')) missing.push('sondages');
    if (!scopes.includes('channel:read:subscriptions')) missing.push('abonnés');
    if (!scopes.includes('moderator:read:followers')) missing.push('follows');
    tokenInfo.missing = missing;
    console.log('[auth] token VALIDE — compte : ' + (v.login || '?') + ' — droits : ' + (scopes.join(', ') || '(aucun)'));
    if (!scopes.includes('channel:read:subscriptions'))
      console.warn('[auth] ⚠️ il MANQUE le droit "channel:read:subscriptions" → le sub goal ne marchera pas');
    if (!scopes.includes('moderator:read:followers'))
      console.warn('[auth] ⚠️ il MANQUE le droit "moderator:read:followers" → les follows ne marcheront pas');
  } catch (e) {
    tokenInfo = { valid: false, reason: 'réseau' };
    console.warn('[auth] erreur réseau sur la validation :', e.message || e);
  }
}

async function helixPolls() {
  const r = await fetch('https://api.twitch.tv/helix/polls?broadcaster_id=' + resolvedBroadcasterId, {
    headers: { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + POLL_OAUTH }
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) console.error(`[twitch-poll] HTTP ${r.status} — vérifiez POLL_OAUTH / scopes (token invalide ou mauvais scope)`);
    else console.error(`[twitch-poll] HTTP ${r.status} — réponse inattendue`);
    return null;
  }
  const json = await r.json();
  if (json && json.error) console.error('[twitch-poll] API :', json.message || json.error);
  return (json && json.data) || [];
}
let _pollLogCount = 0;
async function pollLoop() {
  try {
    const polls = await helixPolls();
    if (polls === null) return;
    /* trace légère (toutes les ~10 itérations) pour diagnostiquer sans spammer */
    if (++_pollLogCount % 10 === 1) {
      console.log(`[twitch-poll] ${polls.length} sondage(s) reçu(s) · statuts : ${polls.map(p => p.status).join(', ') || '(aucun)'}`);
    }
    const live = polls.find(p => p.status === 'ACTIVE');
    const ended = polls.find(p => (p.status === 'COMPLETED' || p.status === 'TERMINATED') && p.id === currentPollId);

    if (live) {
      // Twitch renvoie `ended_at: null` pour un sondage ACTIF. La vraie fin
      // se calcule : started_at + duration (en secondes).
      const started = live.started_at ? new Date(live.started_at).getTime() : Date.now();
      const durMs = Math.max(15000, (live.duration || 60) * 1000);
      const ends = started + durMs;

      if (state.mode !== 'live') {
        if (live.choices && live.choices.length === 2) {
          currentPollId = live.id;
          console.log(`[twitch-poll] SONDAGE DÉTECTÉ : "${live.title}" (${Math.round(durMs/1000)}s) → lancement du débat`);
          startDebate({
            question: live.title.slice(0, 140),
            a: live.choices[0].title.slice(0, 60),
            b: live.choices[1].title.slice(0, 60),
            duration: Math.max(15, Math.floor((ends - Date.now()) / 1000)),
            startsAt: started,
            source: 'twitch'
          });
        } else {
          console.warn(`[twitch-poll] sondage ignoré (${live.choices ? live.choices.length : 0} choix, il en faut 2) : "${live.title}"`);
          currentPollId = live.id;
        }
      } else if (state.source === 'twitch' && currentPollId === live.id) {
        state.va = live.choices[0].votes || 0;
        state.vb = live.choices[1].votes || 0;
        state.endsAt = ends;
        dirty = true;
      }
    } else if (ended && state.mode === 'live' && state.source === 'twitch') {
      const va = ended.choices[0].votes || 0, vb = ended.choices[1].votes || 0;
      state = {
        mode: 'ended', source: 'twitch',
        question: state.question, a: state.a, b: state.b,
        va, vb, endsAt: Date.now(),
        winner: va === vb ? null : (va > vb ? 'A' : 'B')
      };
      currentPollId = null;
      broadcast(true);
      setTimeout(() => { if (state.mode === 'ended') idle(); }, 6000);
    }
  } catch (e) { /* réseau momentané : on réessaie au prochain cycle */ }
}
if (CLIENT_ID && POLL_OAUTH) {
  (async () => {
    if (await resolveBroadcaster()) {
      helixOn = true;
      console.log(`  /poll → actif (chaîne ${resolvedBroadcasterId})`);
      pollLoop();
      setInterval(pollLoop, 2500);
    } else {
      console.warn('  /poll → impossible de détecter ta chaîne (vérifie CLIENT_ID / POLL_OAUTH)');
    }
  })();
}

/* ═══ BADGES TWITCH (vraies images officielles) ═══════════════════
   On récupère les badges globaux + ceux de ta chaîne via l'API Helix,
   puis on les envoie au widget (qui les affiche). Sans ça, impossible
   d'avoir les vrais badges (sub, mod, vip…), car l'image dépend du set. */
let badgeMap = null;
async function loadBadges() {
  const token = POLL_OAUTH || CHAT_OAUTH;
  if (!CLIENT_ID || !token) return;
  const headers = { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + token };
  try {
    const map = {};
    const parse = (json) => {
      for (const set of (json.data || [])) {
        const versions = {};
        for (const v of (set.versions || [])) {
          if (v.id !== undefined && v.image_url_4x) versions[String(v.id)] = v.image_url_4x;
        }
        if (Object.keys(versions).length) map[set.set_id] = versions;
      }
    };
    const [g, c] = await Promise.all([
      fetch('https://api.twitch.tv/helix/chat/badges/global', { headers }),
      fetch('https://api.twitch.tv/helix/chat/badges?broadcaster_id=' + resolvedBroadcasterId, { headers })
    ]);
    if (g.ok) parse(await g.json());
    if (c.ok) parse(await c.json());
    if (Object.keys(map).length) {
      badgeMap = map;
      const payload = 'data: ' + JSON.stringify({ badgeMap }) + '\n\n';
      for (const res of sse) res.write(payload);
      console.log('[badges] ' + Object.keys(map).length + ' sets de badges chargés');
    }
  } catch (e) { /* badges indisponibles : le widget utilise un repli texte */ }
}
if (CLIENT_ID) {
  (async () => {
    if (await resolveBroadcaster()) {
      await loadBadges();
      setInterval(loadBadges, 30 * 60 * 1000); // rechargé toutes les 30 min
    }
  })();
}

/* ═══ SUB GOAL AUTO (vrai nombre d'abonnés) ══════════════════════
   Récupère le total de subs de la chaîne via Helix (GET /subscriptions,
   champ `total`) et met à jour le compteur du sub goal automatiquement.
   Nécessite le scope channel:read:subscriptions sur le token utilisateur. */
async function syncSubGoal() {
  if (!appConfig.subGoalAuto) return;   // mode manuel : on ne touche pas au compteur
  if (!CLIENT_ID || !POLL_OAUTH || !resolvedBroadcasterId) {
    return;
  }
  try {
    const r = await fetch('https://api.twitch.tv/helix/subscriptions?broadcaster_id=' + resolvedBroadcasterId + '&first=1', {
      headers: { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + POLL_OAUTH }
    });
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = j.message || j.error || JSON.stringify(j); } catch (e) {}
      console.warn('[sub-goal] HTTP ' + r.status + (detail ? ' — ' + detail : ''));
      return;
    }
    const d = await r.json();
    console.log('[sub-goal] réponse reçue : total=' + d.total + ', points=' + d.points + ', data.length=' + ((d.data && d.data.length) || 0));
    if (typeof d.total === 'number' && d.total !== goalState.current) {
      goalState.current = d.total;
      // check auto-switch avant broadcast (si depasse + next existe)
      if (!checkAndSwitchGoal()) {
        broadcastGoal();
      }
      console.log('[sub-goal] synchronisé : ' + d.total + ' abonnés');
    }
  } catch (e) {
    console.warn('[sub-goal] erreur :', e.message || e);
  }
}

/* ═══ FOLLOWS + SUBS + RAIDS (EventSub WebSocket, temps réel) ═══════════
   Twitch n'envoie PAS les follows via IRC : on utilise EventSub WebSocket
   (channel.follow v2). On ajoute aussi sub, gift, raid pour garantir les alertes
   même si tmi.js rate un event. */
function connectFollows() {
  if (!CLIENT_ID || !POLL_OAUTH || !resolvedBroadcasterId) return;
  let ws = null;
  const token = POLL_OAUTH;
  async function subscribeAll(sessionId) {
    const types = [
      { type: 'channel.follow', version: '2', condition: { broadcaster_user_id: resolvedBroadcasterId, moderator_user_id: resolvedBroadcasterId } },
      { type: 'channel.subscribe', version: '1', condition: { broadcaster_user_id: resolvedBroadcasterId } },
      { type: 'channel.subscription.gift', version: '1', condition: { broadcaster_user_id: resolvedBroadcasterId } },
      { type: 'channel.subscription.message', version: '1', condition: { broadcaster_user_id: resolvedBroadcasterId } },
      { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: resolvedBroadcasterId } }
    ];
    for (const sub of types) {
      try {
        const r = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST',
          headers: { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: sub.type, version: sub.version,
            condition: sub.condition,
            transport: { method: 'websocket', session_id: sessionId }
          })
        });
        if (r.ok) console.log(`[eventsub] ${sub.type} OK`);
        else {
          const txt = await r.text().catch(()=> '');
          console.warn(`[eventsub] ${sub.type} fail ${r.status} ${txt.slice(0,120)}`);
        }
      } catch (e) { console.warn(`[eventsub] ${sub.type} error`, e.message); }
    }
    console.log('[eventsub] WebSocket connecté — alertes follow/sub/gift/raid actives');
  }
  function ouvrir(url) {
    try { ws = new WebSocket(url || 'wss://eventsub.wss.twitch.tv:443'); }
    catch (e) { console.warn('[follows] WebSocket indisponible (Node trop ancien) :', e.message); return; }
    ws.onopen = () => {};
    ws.onmessage = async (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      const t = msg.metadata && msg.metadata.message_type;
      if (t === 'session_welcome') {
        const sessionId = msg.payload.session.id;
        await subscribeAll(sessionId);
      } else if (t === 'notification') {
        const subType = msg.metadata && msg.metadata.subscription_type;
        const evt = msg.payload && msg.payload.event;
        if (!evt) return;
        if (subType === 'channel.follow') {
          const nom = evt.user_name || evt.user_login || 'un viewer';
          broadcastAlert({ type: 'follow', user: nom });
          console.log('[alerte] follow : ' + nom);
        } else if (subType === 'channel.subscribe') {
          const nom = evt.user_name || evt.user_login || 'viewer';
          const isResub = (evt.cumulative_months || 0) > 1 || (evt.streak_months || 0) > 0;
          if (isResub) {
            broadcastAlert({ type: 'resub', user: nom, stints: (evt.streak_months||1)-1, total: evt.cumulative_months||1, message: evt.message && evt.message.text });
            console.log('[alerte] resub EventSub : ' + nom);
          } else {
            broadcastAlert({ type: 'sub', user: nom, message: evt.message && evt.message.text });
            console.log('[alerte] sub EventSub : ' + nom);
          }
        } else if (subType === 'channel.subscription.gift') {
          const nom = evt.user_name || evt.user_login || 'viewer';
          const isAnon = evt.is_anonymous;
          if (isAnon) {
            broadcastAlert({ type: 'anon', viewer: evt.total ? String(evt.total)+' subs' : undefined });
            console.log('[alerte] gift anon EventSub');
          } else {
            const total = evt.total || 1;
            if (total > 1) {
              broadcastAlert({ type: 'community', user: nom, message: total + ' subs offerts' });
              console.log('[alerte] community gift EventSub : ' + nom + ' x' + total);
            } else {
              broadcastAlert({ type: 'gift', user: nom, viewer: evt.recipient_user_name || 'un spectateur' });
              console.log('[alerte] gift EventSub : ' + nom);
            }
          }
        } else if (subType === 'channel.subscription.message') {
          const nom = evt.user_name || evt.user_login || 'viewer';
          broadcastAlert({ type: 'resub', user: nom, stints: (evt.streak_months||1)-1, total: evt.cumulative_months||1, message: evt.message && evt.message.text });
          console.log('[alerte] resub message EventSub : ' + nom);
        } else if (subType === 'channel.raid') {
          const nom = evt.from_broadcaster_user_name || evt.from_broadcaster_user_login || 'raideur';
          broadcastAlert({ type: 'raid', user: nom, viewers: evt.viewers || 0 });
          console.log('[alerte] raid EventSub : ' + nom + ' (' + (evt.viewers||0) + ')');
        }
      } else if (t === 'session_reconnect') {
        const u = msg.payload.session && msg.payload.session.reconnect_url;
        try { ws.close(); } catch (e) {}
        ouvrir(u);
      }
    };
    ws.onclose = () => { if (ws) setTimeout(() => ouvrir(), 10000); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  ouvrir();
}

/* — Lancement des connexions "données" (sub goal + follows) — */
if (CLIENT_ID && POLL_OAUTH) {
  (async () => {
    if (await resolveBroadcaster()) {
      syncSubGoal();
      setInterval(syncSubGoal, 60 * 1000);   // sub goal toutes les minutes
      connectFollows();
    }
  })();
}

/* ═══ Serveur HTTP + SSE ════════════════════════════════════════ */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token' };
  const send = (code, ctype, body, extra = {}) => {
    res.writeHead(code, Object.assign({}, headers, { 'Content-Type': ctype }, extra));
    res.end(body);
  };
  const readBody = () => new Promise(resolve => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(d));
  });
  const authOK = !ADMIN_TOKEN || req.headers['x-admin-token'] === ADMIN_TOKEN;

  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }

  try {
    /* — Flux temps réel (EventSource) — */
    if (u.pathname === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...headers });
      res.write('data: ' + JSON.stringify(state) + '\n\n');
      sse.add(res);
      const hb = setInterval(() => res.write(':hb\n\n'), 15000);
      req.on('close', () => { clearInterval(hb); sse.delete(res); });
      return;
    }

    /* — Assets statiques (demo/ + assets/ : GIFs, fonds d'alertes) — */
    for (const dir of ['demo', 'assets']) {
      if (u.pathname.startsWith('/' + dir + '/')) {
        const f = path.join(__dirname, dir, path.basename(u.pathname));
        if (!f.startsWith(path.join(__dirname, dir))) return send(403, 'text/plain', 'nope');
        fs.readFile(f, (e, b) => {
          if (e) return send(404, 'text/plain', 'introuvable');
          send(200, f.endsWith('.gif') ? 'image/gif' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream', b,
               { 'Cache-Control': 'no-store' });
        });
        return;
      }
    }

    /* — Widget (mode OBS) — servi SANS cache : chaque chargement = dernière version — */
    if (u.pathname === '/widget.html' || u.pathname === '/widget') {
      fs.readFile(path.join(__dirname, 'widget.html'), (e, b) => {
        if (e) return send(500, 'text/plain', 'widget.html introuvable');
        send(200, 'text/html; charset=utf-8', b, { 'Cache-Control': 'no-store' });
      });
      return;
    }

    /* — Panneau de contrôle (personnalisation sans coder) — */
    if (u.pathname === '/panneau' || u.pathname === '/panneau.html' || u.pathname === '/panel') {
      fs.readFile(path.join(__dirname, 'panneau.html'), (e, b) => {
        if (e) return send(500, 'text/plain', 'panneau.html introuvable');
        send(200, 'text/html; charset=utf-8', b, { 'Cache-Control': 'no-store' });
      });
      return;
    }

    /* — Racine : aperçu auto-démontré dans le navigateur — */
    if (u.pathname === '/') {
      fs.readFile(path.join(__dirname, 'widget.html'), (e, b) => {
        if (e) return send(500, 'text/plain', 'widget.html introuvable');
        const html = b.toString('utf8').replace('<title>', '<script>window.__AUTO__="demo=1&bg=1&loop=1";</script><title>');
        send(200, 'text/html; charset=utf-8', html, { 'Cache-Control': 'no-cache' });
      });
      return;
    }

    /* — Polices auto-hébergées — */
    if (u.pathname.startsWith('/fonts/')) {
      const f = path.join(__dirname, 'fonts', path.basename(u.pathname));
      fs.readFile(f, (e, b) => e ? send(404, 'text/plain', '404')
        : send(200, 'font/woff2', b, { 'Cache-Control': 'public, max-age=31536000' }));
      return;
    }

    /* — Bruitages (WAV/MP3 rendus localement, custom alert-{type}.* inclus) — */
    if (u.pathname.startsWith('/sounds/')) {
      const f = path.join(__dirname, 'sounds', path.basename(u.pathname));
      fs.readFile(f, (e, b) => {
        if (e) return send(404, 'text/plain', '404');
        const ext = path.extname(f).toLowerCase();
        const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : ext === '.wav' ? 'audio/wav' : 'audio/wav';
        send(200, mime, b, { 'Cache-Control': 'public, max-age=60' });
      });
      return;
    }

    /* — API — */
    if (u.pathname === '/api/state' && req.method === 'GET') return send(200, 'application/json', JSON.stringify(state));
    if (u.pathname === '/healthz') return send(200, 'text/plain', 'ok');

    /* — Sons d'alerte custom — */
    if (u.pathname === '/api/sounds' && req.method === 'GET') {
      const soundsDir = path.join(__dirname, 'sounds');
      try { if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true }); } catch(e){}
      fs.readdir(soundsDir, (e, files) => {
        if (e) return send(200, 'application/json', JSON.stringify({ ok: true, files: [], all: [] }));
        const known = ['follow','sub','resub','gift','raid','prime','anon','community','default'];
        const list = [];
        const all = files.map(f => f);
        for (const f of files) {
          const low = f.toLowerCase();
          // supporte alert-xxx.mp3 et aussi xxx.mp3 direct
          let type = null;
          if (low.startsWith('alert-')) {
            type = low.replace(/^alert-/, '').replace(/\.[^.]+$/, '');
          } else {
            // si fichier contient un type connu sans prefix alert-
            for (const k of known) {
              if (low.includes(k)) { type = k; break; }
            }
          }
          if (!type) continue;
          // normalise
          type = type.replace(/[^a-z]/g,'');
          if (!known.includes(type)) continue;
          list.push({ file: f, type });
        }
        // dedup par type (garde premier)
        const seen = new Set();
        const dedup = [];
        for (const it of list) {
          if (!seen.has(it.type)) { seen.add(it.type); dedup.push(it); }
        }
        send(200, 'application/json', JSON.stringify({ ok: true, files: dedup, all }));
      });
      return;
    }
    if (u.pathname === '/api/sounds' && req.method === 'POST') {
      // Accepte JSON {type, data: base64, ext} ou raw upload via FormData simplifié (on parse en buffer)
      const chunks = [];
      let total = 0;
      req.on('data', c => { chunks.push(c); total += c.length; if (total > 8 * 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          const ctype = (req.headers['content-type'] || '').toLowerCase();
          if (ctype.includes('application/json')) {
            const j = JSON.parse(buf.toString('utf8'));
            const allowed = ['follow','sub','resub','gift','raid','prime','anon','community','default'];
            let type = String(j.type || '').toLowerCase().replace(/[^a-z]/g, '');
            if (!allowed.includes(type)) type = 'default';
            if (!j.data) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'data manquant' }));
            const raw = Buffer.from(j.data, 'base64');
            if (raw.length < 100) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'fichier trop petit' }));
            let ext = String(j.ext || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!['mp3','wav','ogg','m4a','mp4','webm'].includes(ext)) ext = 'mp3';
            const outPath = path.join(__dirname, 'sounds', `alert-${type}.${ext}`);
            // remove other ext for same type
            try { fs.readdirSync(path.join(__dirname, 'sounds')).forEach(f => { if (f.startsWith(`alert-${type}.`) && f !== `alert-${type}.${ext}`) fs.unlinkSync(path.join(__dirname, 'sounds', f)); }); } catch(e){}
            fs.writeFileSync(outPath, raw);
            console.log(`[sons] custom upload alert-${type}.${ext} (${(raw.length/1024).toFixed(1)} Ko)`);
            return send(200, 'application/json', JSON.stringify({ ok: true, file: `alert-${type}.${ext}` }));
          } else {
            // multipart minimal: on cherche type en query ?type=
            const qtype = (u.searchParams.get('type') || 'default').toLowerCase().replace(/[^a-z]/g, '');
            const allowed = ['follow','sub','resub','gift','raid','prime','anon','community','default'];
            let type = allowed.includes(qtype) ? qtype : 'default';
            // try to extract filename extension from content-type
            let ext = 'mp3';
            if (ctype.includes('wav')) ext = 'wav';
            else if (ctype.includes('ogg')) ext = 'ogg';
            else if (ctype.includes('mpeg') || ctype.includes('mp3')) ext = 'mp3';
            // if multipart, try to find file bytes (naive: take whole body after double CRLF if present)
            let raw = buf;
            const doubleCRLF = buf.indexOf('\r\n\r\n');
            if (ctype.includes('multipart') && doubleCRLF !== -1) {
              const start = doubleCRLF + 4;
              const endMarker = buf.lastIndexOf('\r\n--');
              raw = endMarker > start ? buf.subarray(start, endMarker) : buf.subarray(start);
            }
            if (raw.length < 100) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'fichier trop petit' }));
            const outPath = path.join(__dirname, 'sounds', `alert-${type}.${ext}`);
            try { fs.readdirSync(path.join(__dirname, 'sounds')).forEach(f => { if (f.startsWith(`alert-${type}.`) && f !== `alert-${type}.${ext}`) fs.unlinkSync(path.join(__dirname, 'sounds', f)); }); } catch(e){}
            fs.writeFileSync(outPath, raw);
            console.log(`[sons] custom upload alert-${type}.${ext} (${(raw.length/1024).toFixed(1)} Ko) raw`);
            return send(200, 'application/json', JSON.stringify({ ok: true, file: `alert-${type}.${ext}` }));
          }
        } catch (e) {
          console.warn('[sons] upload error', e.message);
          return send(400, 'application/json', JSON.stringify({ ok: false, err: e.message }));
        }
      });
      return;
    }
    if (u.pathname === '/api/sounds' && req.method === 'DELETE') {
      const type = (u.searchParams.get('type') || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!type) return send(400, 'application/json', JSON.stringify({ ok: false }));
      try {
        fs.readdirSync(path.join(__dirname, 'sounds')).forEach(f => { if (f.startsWith(`alert-${type}.`)) fs.unlinkSync(path.join(__dirname, 'sounds', f)); });
      } catch(e){}
      return send(200, 'application/json', JSON.stringify({ ok: true }));
    }

    /* — Alert background photo (IMG_0607.jpg / alert-photo.jpg) — */
    if (u.pathname === '/api/alert-bg' && req.method === 'GET') {
      const assetsDir = path.join(__dirname, 'assets');
      try {
        const files = fs.readdirSync(assetsDir).filter(f => /^(IMG_0607|alert-photo|alert-bg)\.(jpg|jpeg|png)$/i.test(f)).map(f => {
          try { const st = fs.statSync(path.join(assetsDir, f)); return { file: f, size: st.size, mtime: st.mtime.toISOString() }; } catch(e){ return { file: f }; }
        });
        return send(200, 'application/json', JSON.stringify({ ok: true, files }));
      } catch(e) { return send(200, 'application/json', JSON.stringify({ ok: true, files: [] })); }
    }
    if (u.pathname === '/api/alert-bg' && req.method === 'POST') {
      const chunks = [];
      let total = 0;
      req.on('data', c => { chunks.push(c); total += c.length; if (total > 12 * 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          const ctype = (req.headers['content-type'] || '').toLowerCase();
          let raw, ext = 'jpg';
          if (ctype.includes('application/json')) {
            const j = JSON.parse(buf.toString('utf8'));
            if (!j.data) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'data manquant' }));
            raw = Buffer.from(j.data, 'base64');
            ext = String(j.ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
            if (!['jpg','jpeg','png'].includes(ext)) ext = 'jpg';
          } else {
            raw = buf;
            if (ctype.includes('png')) ext = 'png';
          }
          if (raw.length < 500) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'fichier trop petit' }));
          const out1 = path.join(__dirname, 'assets', `alert-photo.${ext}`);
          const out2 = path.join(__dirname, 'assets', `IMG_0607.${ext}`);
          // save both names for compatibility
          fs.writeFileSync(out1, raw);
          fs.writeFileSync(out2, raw);
          console.log(`[alert-bg] photo custom ${raw.length/1024|0} Ko → ${out1}`);
          return send(200, 'application/json', JSON.stringify({ ok: true, file: `alert-photo.${ext}` }));
        } catch(e) {
          return send(400, 'application/json', JSON.stringify({ ok: false, err: e.message }));
        }
      });
      return;
    }
    if (u.pathname === '/api/alert-bg' && req.method === 'DELETE') {
      try {
        const assetsDir = path.join(__dirname, 'assets');
        fs.readdirSync(assetsDir).forEach(f => { if (/^(IMG_0607|alert-photo)\.(jpg|jpeg|png)$/i.test(f)) fs.unlinkSync(path.join(assetsDir, f)); });
      } catch(e){}
      return send(200, 'application/json', JSON.stringify({ ok: true }));
    }

    if (u.pathname === '/api/vote' && req.method === 'POST') {
      readBody().then(d => {
        try {
          /* {choice:'A'|'B', user} (historique) ou {text:'voiture', user}
             (vote fluide : le mot suffit, insensible à la casse) */
          const { choice, user, text } = JSON.parse(d || '{}');
          let c = choice;
          if (!c && text) {
            c = matchVoteFromText(text);
            if (!c) return send(200, 'application/json', JSON.stringify({ ok: true, matched: false, state }));
          }
          const counted = tally(c, user);
          broadcast(false);
          send(200, 'application/json', JSON.stringify({ ok: true, matched: true, counted, state }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    if (u.pathname === '/api/debate' && req.method === 'POST' && authOK) {
      readBody().then(d => {
        try {
          const { question, a, b, c, d: dChoice, duration } = JSON.parse(d || '{}');
          if (!question || !a || !b) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'question, a, b requis' }));
          startDebate({ question, a, b, c, d: dChoice, duration, source: 'api' });
          send(200, 'application/json', JSON.stringify({ ok: true }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    if (u.pathname === '/api/end' && req.method === 'POST' && authOK) {
      finish('api');
      return send(200, 'application/json', JSON.stringify({ ok: true }));
    }

    /* — Alertes (follow, sub, gift, raid…) — déclenchable par n'importe quelle source
         (panel, webhook EventSub, test) : POST /api/alert {type, user, …} — */
    if (u.pathname === '/api/alert' && req.method === 'POST') {
      readBody().then(d => {
        try {
          const a = JSON.parse(d || '{}');
          const types = { follow: 1, sub: 1, resub: 1, gift: 1, anon: 1, community: 1, prime: 1, raid: 1 };
          if (!types[a.type]) return send(400, 'application/json', JSON.stringify({ ok: false }));
          broadcastAlert(a);
          send(200, 'application/json', JSON.stringify({ ok: true }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    /* — Chat : injection externe (test, webhook, panel) — */
    if (u.pathname === '/api/chat' && req.method === 'POST') {
      readBody().then(d => {
        try {
          broadcastChat(JSON.parse(d || '{}'));   // user, msg, role, badges, emotes, highlight, replyTo…
          send(200, 'application/json', JSON.stringify({ ok: true }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    /* — Message ÉPINGLÉ (affiche / enlève le pin en haut du chat) — */
    if (u.pathname === '/api/pin' && req.method === 'POST') {
      readBody().then(d => {
        try {
          const p = JSON.parse(d || '{}');
          const payload = (p.clear === true || !p.msg)
            ? 'data: ' + JSON.stringify({ pin: 0 }) + '\n\n'
            : 'data: ' + JSON.stringify({
                pin: 1,
                user: String(p.user || '').slice(0, 64),
                msg: String(p.msg).slice(0, 300),
                role: p.role === 'me' ? 'me' : (p.role === 'mod' ? 'mod' : 'user'),
                badges: p.badges && typeof p.badges === 'object' ? p.badges : undefined
              }) + '\n\n';
          for (const res of sse) res.write(payload);
          send(200, 'application/json', JSON.stringify({ ok: true }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    /* — SUB GOAL (personnalisable à tout moment) —
         GET  : état courant          POST : {current, target, label} → broadcast immédiat
         Env de base : SUB_GOAL_LABEL / SUB_GOAL_CURRENT / SUB_GOAL_TARGET */
    if (u.pathname === '/api/goal' && req.method === 'GET') {
      return send(200, 'application/json', JSON.stringify(goalState));
    }
    if (u.pathname === '/api/goal' && req.method === 'POST') {
      readBody().then(d => {
        try {
          const p = JSON.parse(d || '{}');
          // gestion queue V31
          if (p.queue !== undefined && Array.isArray(p.queue)) {
            appConfig.subGoalQueue = normalizeQueue(p.queue);
            goalState.queue = appConfig.subGoalQueue.slice();
            saveConfig();
            recomputeGoalsFromCount();
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.add !== undefined) {
            const toAdd = normalizeQueue([p.add])[0];
            if (toAdd) {
              appConfig.subGoalQueue = normalizeQueue((appConfig.subGoalQueue||[]).concat([toAdd]));
              saveConfig();
              recomputeGoalsFromCount();
            }
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.removeTarget !== undefined) {
            const rem = Math.max(1, Math.round(+p.removeTarget));
            appConfig.subGoalQueue = (appConfig.subGoalQueue||[]).filter(q=>q.target!==rem);
            // aussi retire de history si present ?
            if (p.removeHistoryToo) {
              goalState.history = goalState.history.filter(h=>h.target!==rem);
              appConfig.subGoalHistory = goalState.history.slice();
            }
            saveConfig();
            recomputeGoalsFromCount();
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.label !== undefined) { goalState.label = String(p.label).slice(0, 24); appConfig.subGoalLabel = goalState.label; }
          if (p.current !== undefined) goalState.current = Math.max(0, Math.round(+p.current || 0));
          if (p.target !== undefined) { 
            // si on modifie target directement, on met a jour queue aussi
            const t = Math.max(1, Math.round(+p.target || 1));
            goalState.target = t; appConfig.subGoalTarget = t;
            // met a jour queue : remplace ou ajoute
            const idx = (appConfig.subGoalQueue||[]).findIndex(q=>q.target===t || q.label===goalState.label);
            if (idx>=0) appConfig.subGoalQueue[idx] = { label: goalState.label, target: t };
            else appConfig.subGoalQueue = normalizeQueue((appConfig.subGoalQueue||[]).concat([{label:goalState.label, target:t}]));
          }
          if (p.nextLabel !== undefined) { goalState.nextLabel = String(p.nextLabel).slice(0, 24); appConfig.subGoalNextLabel = goalState.nextLabel; }
          if (p.nextTarget !== undefined) { 
            const nt = Math.max(0, Math.round(+p.nextTarget || 0));
            goalState.nextTarget = nt; appConfig.subGoalNextTarget = nt;
            if (nt>0) {
              appConfig.subGoalQueue = normalizeQueue((appConfig.subGoalQueue||[]).concat([{label:goalState.nextLabel||goalState.label, target:nt}]));
            }
          }
          if (p.clearHistory === true) { goalState.history = []; appConfig.subGoalHistory = []; }
          if (p.history !== undefined && Array.isArray(p.history)) { goalState.history = p.history.slice(-10); appConfig.subGoalHistory = goalState.history.slice(); }
          saveConfig();
          // recompute logique plus proche
          recomputeGoalsFromCount();
          send(200, 'application/json', JSON.stringify(goalState));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false, err: e.message })); }
      });
      return;
    }

    /* — CONFIG (panneau de contrôle) — GET : état · POST : modifie + persiste — */
    if (u.pathname === '/api/config' && req.method === 'GET') {
      return send(200, 'application/json', JSON.stringify({
        config: appConfig,
        goal: goalState,
        token: tokenInfo
      }));
    }
    if (u.pathname === '/api/config' && req.method === 'POST') {
      readBody().then(d => {
        try {
          const p = JSON.parse(d || '{}');
          /* Aperçu « Ambiance générale » : diffusé à l'overlay en direct,
             mais NI enregistré NI persisté (Enregistrer le fera, Annuler
             renverra l'ancienne valeur de la même manière). */
          if (p.preview === true) {
            const payload = 'data: ' + JSON.stringify({
              cfg: 1,
              chatTitle: p.chatTitle !== undefined ? String(p.chatTitle).slice(0, 40) : appConfig.chatTitle,
              accent: p.accent !== undefined ? String(p.accent).slice(0, 16) : appConfig.accent,
              velocity: 1,
              equilibriumMPM: p.equilibriumMPM !== undefined ? Math.max(1, Math.round(+p.equilibriumMPM)) : appConfig.velocityEquilibrium,
              climbSensitivity: p.climbSensitivity !== undefined ? +p.climbSensitivity : appConfig.velocityClimb,
              decayRate: p.decayRate !== undefined ? +p.decayRate : appConfig.velocityDecay,
              holdDurationSeconds: p.holdDurationSeconds !== undefined ? Math.round(+p.holdDurationSeconds) : appConfig.velocityHold,
              barWidth: p.barWidth !== undefined ? Math.round(+p.barWidth) : appConfig.velocityBarWidth,
              barHeight: p.barHeight !== undefined ? Math.round(+p.barHeight) : appConfig.velocityBarHeight,
              showMetrics: p.showMetrics !== undefined ? !!p.showMetrics : appConfig.velocityShowMetrics,
              velocityEnabled: p.velocityEnabled !== undefined ? !!p.velocityEnabled : appConfig.velocityEnabled,
              goalThreshold: p.goalThreshold !== undefined ? Math.round(+p.goalThreshold) : appConfig.velocityGoalThreshold,
              goalDurationMinutes: p.goalDurationMinutes !== undefined ? Math.round(+p.goalDurationMinutes) : appConfig.velocityGoalDurationMinutes,
              finHour: p.finHour !== undefined ? Math.round(+p.finHour) : appConfig.velocityFinHour,
              finMinute: p.finMinute !== undefined ? Math.round(+p.finMinute) : appConfig.velocityFinMinute,
              finEnabled: p.finEnabled !== undefined ? !!p.finEnabled : appConfig.velocityFinEnabled
            }) + '\n\n';
            for (const res of sse) res.write(payload);
            return send(200, 'application/json', JSON.stringify({ ok: true, preview: true }));
          }
          if (p.subGoalQueue !== undefined && Array.isArray(p.subGoalQueue)) {
            appConfig.subGoalQueue = normalizeQueue(p.subGoalQueue);
            goalState.queue = appConfig.subGoalQueue.slice();
          }
          if (p.subGoalLabel !== undefined) { appConfig.subGoalLabel = String(p.subGoalLabel).slice(0, 24); goalState.label = appConfig.subGoalLabel; }
          if (p.subGoalTarget !== undefined) { appConfig.subGoalTarget = Math.max(1, Math.round(+p.subGoalTarget || 1)); goalState.target = appConfig.subGoalTarget; }
          if (p.subGoalAuto !== undefined) appConfig.subGoalAuto = !!p.subGoalAuto;
          if (p.subGoalManual !== undefined) appConfig.subGoalManual = Math.max(0, Math.round(+p.subGoalManual || 0));
          if (p.subGoalNextLabel !== undefined) { appConfig.subGoalNextLabel = String(p.subGoalNextLabel).slice(0, 24); goalState.nextLabel = appConfig.subGoalNextLabel; }
          if (p.subGoalNextTarget !== undefined) { appConfig.subGoalNextTarget = Math.max(0, Math.round(+p.subGoalNextTarget || 0)); goalState.nextTarget = appConfig.subGoalNextTarget; }
          if (p.subGoalHistory !== undefined && Array.isArray(p.subGoalHistory)) { appConfig.subGoalHistory = p.subGoalHistory.slice(-10); goalState.history = appConfig.subGoalHistory.slice(); }
          if (p.clearHistory === true) { appConfig.subGoalHistory = []; goalState.history = []; }
          // sync queue depuis label/target/next si queue vide
          if ((!appConfig.subGoalQueue || appConfig.subGoalQueue.length===0) && appConfig.subGoalTarget>0) {
            appConfig.subGoalQueue = [{ label: appConfig.subGoalLabel, target: appConfig.subGoalTarget }];
            if (appConfig.subGoalNextTarget>0) appConfig.subGoalQueue.push({ label: appConfig.subGoalNextLabel||appConfig.subGoalLabel, target: appConfig.subGoalNextTarget });
            appConfig.subGoalQueue = normalizeQueue(appConfig.subGoalQueue);
          }
          if (p.chatTitle !== undefined) appConfig.chatTitle = String(p.chatTitle).slice(0, 40);
          if (p.accent !== undefined) appConfig.accent = String(p.accent).slice(0, 16);
          if (p.velocityEquilibrium !== undefined) appConfig.velocityEquilibrium = Math.max(1, Math.round(+p.velocityEquilibrium || 20));
          if (p.equilibriumMPM !== undefined) appConfig.velocityEquilibrium = Math.max(1, Math.round(+p.equilibriumMPM || 20));
          if (p.velocityClimb !== undefined) appConfig.velocityClimb = Math.max(0.05, Math.min(5, +p.velocityClimb || 0.65));
          if (p.climbSensitivity !== undefined) appConfig.velocityClimb = Math.max(0.05, Math.min(5, +p.climbSensitivity || 0.65));
          if (p.velocityDecay !== undefined) appConfig.velocityDecay = Math.max(0.02, Math.min(5, +p.velocityDecay || 0.14));
          if (p.decayRate !== undefined) appConfig.velocityDecay = Math.max(0.02, Math.min(5, +p.decayRate || 0.14));
          if (p.velocityHold !== undefined) appConfig.velocityHold = Math.max(5, Math.min(600, Math.round(+p.velocityHold || 120)));
          if (p.holdDurationSeconds !== undefined) appConfig.velocityHold = Math.max(5, Math.min(600, Math.round(+p.holdDurationSeconds || 120)));
          if (p.velocityHoldDurationSeconds !== undefined) appConfig.velocityHold = Math.max(5, Math.min(600, Math.round(+p.velocityHoldDurationSeconds || 120)));
          if (p.velocityBarWidth !== undefined) appConfig.velocityBarWidth = Math.max(12, Math.min(40, Math.round(+p.velocityBarWidth || 30)));
          if (p.barWidth !== undefined) appConfig.velocityBarWidth = Math.max(12, Math.min(40, Math.round(+p.barWidth || 30)));
          if (p.velocityBarHeight !== undefined) appConfig.velocityBarHeight = Math.max(280, Math.min(900, Math.round(+p.velocityBarHeight || 700)));
          if (p.barHeight !== undefined) appConfig.velocityBarHeight = Math.max(280, Math.min(900, Math.round(+p.barHeight || 700)));
          if (p.velocityShowMetrics !== undefined) appConfig.velocityShowMetrics = !!p.velocityShowMetrics;
          if (p.showMetrics !== undefined) appConfig.velocityShowMetrics = !!p.showMetrics;
          if (p.velocityEnabled !== undefined) appConfig.velocityEnabled = !!p.velocityEnabled;
          if (p.velocityGoalThreshold !== undefined) appConfig.velocityGoalThreshold = Math.max(10, Math.min(99, Math.round(+p.velocityGoalThreshold || 90)));
          if (p.goalThreshold !== undefined) appConfig.velocityGoalThreshold = Math.max(10, Math.min(99, Math.round(+p.goalThreshold || 90)));
          if (p.velocityGoalDurationMinutes !== undefined) appConfig.velocityGoalDurationMinutes = Math.max(1, Math.min(120, Math.round(+p.velocityGoalDurationMinutes || 15)));
          if (p.goalDurationMinutes !== undefined) appConfig.velocityGoalDurationMinutes = Math.max(1, Math.min(120, Math.round(+p.goalDurationMinutes || 15)));
          if (p.goalDuration !== undefined) appConfig.velocityGoalDurationMinutes = Math.max(1, Math.min(120, Math.round(+p.goalDuration || 15)));
          if (p.velocityFinHour !== undefined) appConfig.velocityFinHour = Math.max(0, Math.min(23, Math.round(+p.velocityFinHour || 21)));
          if (p.finHour !== undefined) appConfig.velocityFinHour = Math.max(0, Math.min(23, Math.round(+p.finHour || 21)));
          if (p.velocityFinMinute !== undefined) appConfig.velocityFinMinute = Math.max(0, Math.min(59, Math.round(+p.velocityFinMinute || 30)));
          if (p.finMinute !== undefined) appConfig.velocityFinMinute = Math.max(0, Math.min(59, Math.round(+p.finMinute || 30)));
          if (p.velocityFinEnabled !== undefined) appConfig.velocityFinEnabled = !!p.velocityFinEnabled;
          if (p.finEnabled !== undefined) appConfig.velocityFinEnabled = !!p.finEnabled;
          saveConfig();

          // met à jour le sub goal (mode manuel = valeur manuelle) V31 avec queue
          goalState.label = appConfig.subGoalLabel;
          goalState.target = appConfig.subGoalTarget;
          goalState.nextLabel = appConfig.subGoalNextLabel || '';
          goalState.nextTarget = appConfig.subGoalNextTarget || 0;
          goalState.history = Array.isArray(appConfig.subGoalHistory) ? appConfig.subGoalHistory.slice(-10) : [];
          goalState.queue = normalizeQueue(appConfig.subGoalQueue || []);
          appConfig.subGoalQueue = goalState.queue.slice();
          goalState.upcoming = [];
          if (!appConfig.subGoalAuto) goalState.current = appConfig.subGoalManual;

          // logique plus proche
          recomputeGoalsFromCount();

          // diffuse au widget : sub goal + titre du chat + accent + velocite V5
          const payload = 'data: ' + JSON.stringify({
            goal: 1, ...goalState,
            cfg: 1, chatTitle: appConfig.chatTitle, accent: appConfig.accent,
            velocity: 1,
            equilibriumMPM: appConfig.velocityEquilibrium,
            climbSensitivity: appConfig.velocityClimb,
            decayRate: appConfig.velocityDecay,
            holdDurationSeconds: appConfig.velocityHold,
            barWidth: appConfig.velocityBarWidth,
            barHeight: appConfig.velocityBarHeight,
            showMetrics: appConfig.velocityShowMetrics,
            velocityEnabled: appConfig.velocityEnabled,
            goalThreshold: appConfig.velocityGoalThreshold,
            goalDurationMinutes: appConfig.velocityGoalDurationMinutes,
            holdDurationSeconds: appConfig.velocityHold,
            finHour: appConfig.velocityFinHour,
            finMinute: appConfig.velocityFinMinute,
            finEnabled: appConfig.velocityFinEnabled
          }) + '\n\n';
          for (const res of sse) res.write(payload);
          send(200, 'application/json', JSON.stringify({ ok: true, config: appConfig, goal: goalState }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    /* — VELOCITY RESET (panneau admin) — */
    if (u.pathname === '/api/velocity/reset' && req.method === 'POST') {
      const payload = 'data: ' + JSON.stringify({ velocityReset: 1 }) + '\n\n';
      for (const res of sse) res.write(payload);
      return send(200, 'application/json', JSON.stringify({ ok: true }));
    }
    if (u.pathname === '/api/velocity/validate' && req.method === 'POST') {
      const payload = 'data: ' + JSON.stringify({ velocityValidate: 1 }) + '\n\n';
      for (const res of sse) res.write(payload);
      return send(200, 'application/json', JSON.stringify({ ok: true }));
    }

    /* — STATUT (panneau) : état des connexions — */
    if (u.pathname === '/api/status' && req.method === 'GET') {
      return send(200, 'application/json', JSON.stringify({
        chat: chatOn, chatNick: CHAT_NICK, chatChannel: CHAT_CHANNEL,
        poll: helixOn, follows: helixOn,
        token: tokenInfo,
        goal: goalState,
        config: appConfig,
        version: readLocalVersion().display,
        lastUpdate: updateInfo.updatedAt
      }));
    }

    /* — VERSION (panneau) : version installée, dernière MAJ, dernière
         version dispo sur GitHub + historique. Si installée == dispo,
         le panneau affiche « À jour » et ne retélécharge rien. — */
    if (u.pathname === '/api/version' && req.method === 'GET') {
      (async () => {
        if (u.searchParams.get('force') === '1') remoteCache = { at: 0, data: null };
        const local = readLocalVersion();
        let latest = null, upToDate = null, checkError = null;
        try {
          latest = await fetchRemoteVersion();
          if (local.num > 0 && latest.num > 0) upToDate = local.num >= latest.num;
        } catch (e) { 
          checkError = e.name === 'AbortError' ? 'Timeout – pas d\'internet ?' : 'Vérification impossible (pas d\'internet ? – ' + (e.message||'').slice(0,60) + ')';
        }
        send(200, 'application/json', JSON.stringify({
          current: local.display, currentNum: local.num,
          latest: latest ? latest.display : null, latestNum: latest ? latest.num : null,
          upToDate, checkError,
          lastUpdate: updateInfo.updatedAt,
          history: updateInfo.history.slice(-10).reverse()
        }));
      })().catch(() => send(500, 'application/json', JSON.stringify({ ok: false })));
      return;
    }

    /* — SECRETS (panneau) : écrit les clés dans secrets.json (sans coder) — */
    if (u.pathname === '/api/secrets' && req.method === 'POST') {
      readBody().then(d => {
        try {
          const p = JSON.parse(d || '{}');
          const ALLOWED_KEYS = ['CHAT_NICK', 'CHAT_OAUTH', 'CHAT_CHANNEL', 'CLIENT_ID', 'POLL_OAUTH', 'ADMIN_TOKEN', 'ALLOWED_USERS'];
          let secrets = {};
          try { secrets = JSON.parse(fs.readFileSync(path.join(__dirname, 'secrets.json'), 'utf8')) || {}; } catch (e) {}
          let changed = 0;
          for (const k of Object.keys(p)) {
            if (ALLOWED_KEYS.includes(k)) { secrets[k] = String(p[k]); changed++; }
          }
          if (!changed) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'aucune clé valide' }));
          fs.writeFileSync(path.join(__dirname, 'secrets.json'), JSON.stringify(secrets, null, 2));
          send(200, 'application/json', JSON.stringify({ ok: true, note: 'Relance demarrer-pont.bat pour appliquer les nouvelles clés.' }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false, err: String(e.message || e) })); }
      });
      return;
    }

    /* — MISE À JOUR (panneau) : télécharge la dernière version depuis GitHub
         et remplace les fichiers. Redémarre automatiquement après. — */
    if (u.pathname === '/api/update' && req.method === 'POST') {
      const isWin = process.platform === 'win32';
      if (isWin) {
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'update.ps1')],
          { timeout: 300000, windowsHide: true },
          (err, stdout, stderr) => {
            if (err) return send(500, 'application/json', JSON.stringify({ ok: false, error: String(stderr || err.message || 'échec').trim().slice(0, 500) }));
            const out = String(stdout || '').trim();
            if (out.startsWith('ERREUR')) return send(500, 'application/json', JSON.stringify({ ok: false, error: out.slice(0, 500) }));
            const installed = readLocalVersion();
            recordUpdate(installed.display);
            remoteCache = { at: 0, data: null };
            send(200, 'application/json', JSON.stringify({ ok: true, version: installed.display, lastUpdate: updateInfo.updatedAt, restart: true }));
            // redémarrage auto robuste : tue ancien port puis relance après 2s
            setTimeout(() => {
              try {
                const escDir = __dirname.replace(/"/g,'""');
                const escNode = process.execPath.replace(/"/g,'""');
                const cmd = `
                  Start-Sleep -Seconds 2
                  try{ $c=Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select -ExpandProperty OwningProcess -Unique; if($c){ Stop-Process -Id $c -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 } }catch{}
                  Start-Process -FilePath "${escNode}" -ArgumentList "server.js" -WorkingDirectory "${escDir}" -WindowStyle Hidden
                `;
                const child = spawn('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-Command',cmd], { detached:true, stdio:'ignore', windowsHide:true });
                child.unref();
                console.log('[update] redemarrage programme');
              } catch(e){ console.warn('[update] restart fail', e.message); }
              setTimeout(()=>process.exit(0), 800);
            }, 600);
          });
      } else {
        const installed = readLocalVersion();
        recordUpdate(installed.display);
        remoteCache = { at: 0, data: null };
        send(200, 'application/json', JSON.stringify({ ok: true, version: installed.display, lastUpdate: updateInfo.updatedAt, restart: false, note: 'MAJ simulee (Linux)' }));
      }
      return;
    }

    /* — REDÉMARRAGE du pont seul (PAS OBS) — relance node puis s'arrête — */
    if (u.pathname === '/api/restart' && req.method === 'POST') {
      send(200, 'application/json', JSON.stringify({ ok: true, restarting: true }));
      setTimeout(() => {
        try {
          const escDir = __dirname.replace(/"/g,'""');
          const escNode = process.execPath.replace(/"/g,'""');
          const cmd = `
            Start-Sleep -Seconds 2
            try{ $c=Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select -ExpandProperty OwningProcess -Unique; if($c){ Stop-Process -Id $c -Force -ErrorAction SilentlyContinue; Write-Host "Ancien pont tue $c"; Start-Sleep -Seconds 1 } }catch{}
            Start-Process -FilePath "${escNode}" -ArgumentList "server.js" -WorkingDirectory "${escDir}" -WindowStyle Hidden
            Write-Host "Nouveau pont lance"
          `;
          const ps = spawn('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-Command',cmd], { detached:true, stdio:'ignore', windowsHide:true });
          ps.unref();
          console.log('[restart] redemarrage programme via powershell');
        } catch(e){
          console.warn('[restart] powershell fail, fallback direct spawn', e.message);
          try {
            const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, detached:true, stdio:'ignore', windowsHide:true });
            child.unref();
          } catch(e2){}
        }
        setTimeout(() => process.exit(0), 1000);
      }, 300);
      return;
    }

    send(404, 'text/plain', '404');
  } catch (e) { send(500, 'text/plain', '500'); }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  7GIONNY · Debate Overlay — pont local');
  console.log('  ─────────────────────────────────────────────────');
  console.log(`  OBS  →  http://localhost:${PORT}/widget.html`);
  console.log(`  Démo →  http://localhost:${PORT}/   (démonstration auto + fond caméra)`);
  console.log(`  Chat →  ${chatOn ? 'actif (' + CHAT_NICK + ' → écoute #' + CHAT_CHANNEL + ')' : 'inactif (CHAT_OAUTH / CHAT_NICK manquants)'}`);
  console.log(`  /poll → ${helixOn ? 'actif (polling Helix 2,5 s)' : (CLIENT_ID && POLL_OAUTH ? 'détection de la chaîne…' : 'inactif (CLIENT_ID / POLL_OAUTH manquants)')}`);
  console.log(`  Sub goal → ${CLIENT_ID && POLL_OAUTH ? 'auto (vrai nombre de subs)' : 'manuel (POST /api/goal)'}`);
  console.log(`  Follows → ${CLIENT_ID && POLL_OAUTH ? 'EventSub (alertes temps réel)' : 'inactif (token manquant)'}`);
  console.log('  ─────────────────────────────────────────────────');
  checkToken();
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[serveur] port ${PORT} occupe – tentative de recuperation dans 2s...`);
    setTimeout(() => {
      try {
        // essaie de fermer et re-ecouter
        server.close(() => {
          setTimeout(() => {
            server.listen(PORT, '0.0.0.0');
          }, 1000);
        });
      } catch(e){
        setTimeout(() => {
          try{ server.listen(PORT, '0.0.0.0'); }catch(e2){}
        }, 2000);
      }
    }, 2000);
  } else {
    console.error('[serveur] erreur', err);
  }
});
