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
/* V47 — OBS : adresse et mot de passe du serveur WebSocket d'OBS
   (OBS : Outils > Paramètres du serveur WebSocket). Le mot de passe peut être
   vide si tu as décoché « Activer l'authentification ». */
const OBS_WS_URL = env('OBS_WS_URL', 'ws://127.0.0.1:4455');
const OBS_WS_PASSWORD = env('OBS_WS_PASSWORD', '');
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
  velocityBoostMult: 1,   // V43 : a 100 %, le chrono descend xN (1 = pas d'acceleration)
  velocityBarWidth: 30,
  velocityBarHeight: 700,
  velocityShowMetrics: true,
  velocityEnabled: true,
  velocityGoalThreshold: 90,
  velocityGoalDurationMinutes: 15,
  velocityFinHour: 21,
  velocityFinMinute: 30,
  velocityFinEnabled: true,
  // velocite anti-spam V35 : 1 viewer ne peut pas gonfler la barre tout seul
  velocityAntiSpam: true,
  velocityCooldownSeconds: 15,
  velocityMaxPerMinute: 2,
  velocityExcludedUsers: [],   // V44 : plus aucun pseudo impose d'office — c'est TOI qui decides (champ « Pseudos exclus » du panneau)

  /* ═══ V46 — MISSIONS (points de chaine Twitch) ═══
     Quand un viewer echange des points contre une recompense, un bandeau s'affiche
     en bas de l'ecran pour prevenir tout le monde de ce que tu dois faire.
     Le TITRE de la recompense Twitch EST la mission affichee. */
  missionsEnabled: true,
  missionDuration: 8,          // s a l'ecran (3 a 30)
  missionBottom: 64,           // px depuis le bas (0 a 400)
  missionWidth: 1100,          // px de large (600 a 1600)
  missionScale: 100,           // % taille globale (60 a 140)
  missionMinCost: 0,           // ignore les recompenses en dessous de ce cout (0 = toutes)
  missionRewards: [],          // titres de recompenses a afficher ([] = toutes)
  missionIgnored: [],          // titres a ne jamais afficher (ex. Highlight My Message)
  missionShowUser: true,       // afficher « demande par X »
  missionShowInput: true,      // afficher le texte ecrit par le viewer, s'il y en a un
  /* Reglages PAR recompense. Une entree = une recompense personnalisee :
       { key: 'fais 10 pompes', title: 'FAIS 10 POMPES', duration: 60, chrono: true }
     Tout ce qui n'a pas d'entree ici garde les reglages generaux ci-dessus.
     On garde le titre d'origine pour l'afficher dans le panneau, et "key" (le
     titre normalise) pour la comparaison. */
  missionCustom: [],

  /* ═══ V47 — DISPOSITIONS PAR SCENE OBS ═══
     Une entree par scene OBS que tu veux agencer differemment :
       { scene: 'Partage ecran', blocs: { chat:{x,y,w,h}, velocity:{...}, ... } }
     Les blocs absents gardent leur position par defaut. Une scene sans entree
     garde l'agencement normal. Coordonnees en pixels sur une base 1920x1080. */
  sceneLayouts: []
};

/* Les 4 blocs deplaçables de l'overlay.
   On ne stocke QUE la position : la taille de chaque bloc reste celle definie
   par ses propres reglages (onglet VELOCITE, largeur du chat, etc.). C'est la
   seule liste a completer si on ajoute un bloc plus tard. */
const BLOCS = {
  chat:     { nom: 'Chat' },
  velocity: { nom: 'Velocite' },
  mission:  { nom: 'Mission' },
  poll:     { nom: 'Sondage' }
};

/* Nettoie les dispositions. On ne garde que x/y (et le masquage) : aucune
   taille n'est enregistree, donc rien ne peut redimensionner un bloc. */
function normalizeSceneLayouts(v) {
  if (!Array.isArray(v)) return [];
  const out = [], vues = new Set();
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const scene = String(it.scene == null ? '' : it.scene).trim().slice(0, 120);
    if (!scene || vues.has(scene)) continue;
    vues.add(scene);
    const blocs = {};
    const src = it.blocs && typeof it.blocs === 'object' ? it.blocs : {};
    for (const cle of Object.keys(BLOCS)) {
      const b = src[cle];
      if (!b || typeof b !== 'object') continue;
      if (b.hidden === true) { blocs[cle] = { hidden: true }; continue; }
      blocs[cle] = {
        x: Math.round(clampNum(b.x, 0, 1920 - 40, 0)),
        y: Math.round(clampNum(b.y, 0, 1080 - 40, 0))
      };
    }
    out.push({ scene, blocs });
    if (out.length >= 40) break;
  }
  return out;
}

/* Position et taille par defaut de chaque bloc, telles qu'elles sortent
   reellement du CSS, en tenant compte des reglages en cours.
   A garder synchronise avec le CSS de widget.html. */
function blocsGeometrie() {
  const velH = clampNum(appConfig.velocityBarHeight, 280, 900, 700);
  const misW = clampNum(appConfig.missionWidth, 600, 1600, 1100);
  const misB = clampNum(appConfig.missionBottom, 0, 400, 64);
  const misH = 130;   // hauteur du bandeau, imposee par son contenu
  return {
    // #card : centre en haut, 880 de large
    poll:     { x: Math.round((1920 - 880) / 2), y: 96, w: 880, h: 260 },
    // .chat : ancre a 48 px du bord droit et 160 px du bas
    chat:     { x: 1920 - 48 - 460, y: 1080 - 160 - 640, w: 460, h: 640 },
    // #velocityWrap : ancre a 28 px a gauche et 160 px du bas, hauteur = ton reglage
    velocity: { x: 28, y: 1080 - 160 - velH, w: 180, h: velH },
    // #mission : centre entre la velocite et le chat, ancre en bas
    mission:  { x: Math.round((1920 - misW) / 2), y: 1080 - misB - misH, w: misW, h: misH }
  };
}

/* Envoie a l'overlay la scene active et la disposition qui lui correspond. */
function broadcastScene() {
  const scene = obsState.scene || '';
  const entree = (appConfig.sceneLayouts || []).find(l => l.scene === scene) || null;
  const payload = 'data: ' + JSON.stringify({
    sceneChange: 1,
    scene,
    layout: entree ? entree.blocs : null   // null = disposition par defaut
  }) + '\n\n';
  for (const res of sse) res.write(payload);
}
function clampNum(n, min, max, d) {
  const v = +n;
  if (!isFinite(v)) return d;
  return Math.max(min, Math.min(max, v));
}

/* Liste de titres de recompenses : accepte "a, b" ou ["a","b"], comparaison en minuscules
   sans accent (le streamer n'a pas a recopier au caractere pres). */
function missionKey(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function normalizeRewardList(v) {
  const raw = Array.isArray(v) ? v.join(',') : String(v == null ? '' : v);
  const out = [], seen = new Set();
  for (const part of raw.split(/[,;\n]+/)) {
    const t = String(part).trim().slice(0, 80);
    if (!t) continue;
    const k = missionKey(t);
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out.slice(0, 40);
}

/* Nettoie la liste des personnalisations par recompense. On refuse les entrees
   sans titre, on borne la duree, et on evite les doublons. */
function normalizeMissionCustom(v) {
  if (!Array.isArray(v)) return [];
  const out = [], seen = new Set();
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const title = String(it.title == null ? '' : it.title).trim().slice(0, 90);
    if (!title) continue;
    const key = missionKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      title,
      duration: Math.max(3, Math.min(600, Math.round(+it.duration || 8))),
      chrono: !!it.chrono
    });
    if (out.length >= 60) break;
  }
  return out;
}

/* Renvoie la personnalisation d'une recompense, ou null si elle suit les
   reglages generaux. */
function missionCustomFor(title) {
  const k = missionKey(title);
  const list = appConfig.missionCustom || [];
  for (const c of list) if (c.key === k) return c;
  return null;
}

function normalizeExcludedUsers(v) {
  const raw = Array.isArray(v) ? v.join(',') : String(v == null ? '' : v);
  const list = raw.split(/[,;\s]+/).map(s => String(s).toLowerCase().trim().slice(0, 32)).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const n of list) { if (!seen.has(n)) { seen.add(n); out.push(n); } }
  return out.slice(0, 40);
}

let appConfig = Object.assign({}, DEFAULT_CONFIG);
let legacyNeedsSave = false;
try {
  if (fs.existsSync(PERSIST_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8')) || {};
    appConfig = Object.assign({}, DEFAULT_CONFIG, saved);
  }
} catch (e) { console.warn('[config] config-perso.json illisible :', e.message); }
/* Velocite : regles figees - streamer et mods comptent dans le % ; la liste des exclus vient uniquement du panneau (V44 : plus aucun pseudo force d'office).
   V43 : « exempter les mods » n'existe plus (cle supprimee du code, du panneau et de la config).
   La duree du verrou se regle par UNE seule cle (velocityHold) : le doublon
   velocityHoldDurationSeconds est retire des fichiers de config existants. */
if (appConfig.velocityExemptStaff !== undefined || appConfig.velocityHoldDurationSeconds !== undefined) {
  delete appConfig.velocityExemptStaff; delete appConfig.velocityHoldDurationSeconds;
  legacyNeedsSave = true;
  console.log('[config] cles perimees retirees (velocityExemptStaff, velocityHoldDurationSeconds)');
}
/* V45 : les alertes ont ete retirees de l'application. Les reglages qu'elles avaient
   laisses dans config-perso.json (alert*, tts*) sont effaces une bonne fois : plus
   aucune trace, et le fichier ne traine pas de cles qui ne servent plus a rien.
   Tout le reste du fichier (debat, sub goal, ambiance, velocite) est conserve tel quel. */
{
  const morts = Object.keys(appConfig).filter(k => /^alert/i.test(k) || /^tts/i.test(k));
  if (morts.length) {
    for (const k of morts) delete appConfig[k];
    legacyNeedsSave = true;
    console.log('[config] reglages d\'alertes effaces (' + morts.length + ' cles) - la fonctionnalite a ete retiree');
  }
}
if (legacyNeedsSave) saveConfig();
appConfig.velocityExcludedUsers = normalizeExcludedUsers(appConfig.velocityExcludedUsers);
function saveConfig() {
  try { fs.writeFileSync(PERSIST_FILE, JSON.stringify(appConfig, null, 2)); } catch (e) {}
}

/* Multiplicateur turbo : x1 a x2 par pas de 0,25. Toute autre valeur est ramenee au
   cran le plus proche ; x1 = pas d'acceleration. */
function velBoostQuantize(v) {
  const n = Number(v);
  if (!isFinite(n)) return 1;
  return Math.max(1, Math.min(2, Math.round(n * 4) / 4));
}

function velocityConfigFields(src) {
  const s = src || appConfig;
  return {
    velocity: 1,
    equilibriumMPM: s.velocityEquilibrium,
    climbSensitivity: s.velocityClimb,
    decayRate: s.velocityDecay,
    holdDurationSeconds: s.velocityHold,
    barWidth: s.velocityBarWidth,
    barHeight: s.velocityBarHeight,
    showMetrics: s.velocityShowMetrics,
    velocityEnabled: s.velocityEnabled,
    goalThreshold: s.velocityGoalThreshold,
    goalDurationMinutes: s.velocityGoalDurationMinutes,
    finHour: s.velocityFinHour,
    finMinute: s.velocityFinMinute,
    finEnabled: s.velocityFinEnabled,
    velocityBoostMult: velBoostQuantize(s.velocityBoostMult),
    boostMult: velBoostQuantize(s.velocityBoostMult),
    velocityAntiSpam: s.velocityAntiSpam,
    velocityCooldownSeconds: s.velocityCooldownSeconds,
    velocityMaxPerMinute: s.velocityMaxPerMinute,
    velocityExcludedUsers: s.velocityExcludedUsers,
    antiSpam: s.velocityAntiSpam,
    cooldownSeconds: s.velocityCooldownSeconds,
    maxPerMinute: s.velocityMaxPerMinute,
    excludedUsers: s.velocityExcludedUsers,
    // V46 : missions (points de chaine)
    missionsEnabled: s.missionsEnabled !== false,
    missionDuration: s.missionDuration,
    missionBottom: s.missionBottom,
    missionWidth: s.missionWidth,
    missionScale: s.missionScale,
    missionShowUser: s.missionShowUser !== false,
    missionShowInput: s.missionShowInput !== false
  };
}

/* ═══ V46 — MISSIONS : diffusion au widget ═══════════════════════════
   Une « mission » = un echange de points de chaine. Le titre de la recompense est
   le texte affiche en gros ; le pseudo et le message eventuel viennent en dessous. */
function missionAllowed(title, cost) {
  if (appConfig.missionsEnabled === false) return 'missions desactivees dans le panneau';
  const k = missionKey(title);
  const ignored = (appConfig.missionIgnored || []).map(missionKey);
  if (ignored.includes(k)) return 'recompense decochee dans le panneau';
  const only = (appConfig.missionRewards || []).map(missionKey).filter(Boolean);
  if (only.length && !only.includes(k)) return 'absente de la liste autorisee';
  const min = Math.max(0, +appConfig.missionMinCost || 0);
  if (min > 0 && (+cost || 0) < min) return 'cout ' + cost + ' inferieur au minimum ' + min;
  return null;   // null = rien ne s'y oppose
}

function broadcastMission(m) {
  const title = String(m.title || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 90);
  if (!title) return false;
  const cost = Math.max(0, Math.round(+m.cost || 0));
  const refus = m.force ? null : missionAllowed(title, cost);
  if (refus) {
    pointsDiag.lastBlocked = title + ' → ' + refus;
    console.log('[mission] ecartee : ' + title + ' — ' + refus);
    return false;
  }
  /* Personnalisation eventuelle de CETTE recompense : duree propre et chrono.
     Si elle n'est pas personnalisee, on n'envoie rien et l'overlay applique
     la duree generale. */
  const perso = missionCustomFor(title);
  const payload = 'data: ' + JSON.stringify({
    mission: 1,
    title,
    user: String(m.user || '').slice(0, 40),
    cost,
    input: String(m.input || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160),
    duration: perso ? perso.duration : undefined,
    chrono: perso && perso.chrono ? 1 : undefined,
    test: m.test ? 1 : undefined
  }) + '\n\n';
  for (const res of sse) res.write(payload);
  pointsDiag.lastShown = title + (sse.size ? '' : ' (AUCUN OVERLAY CONNECTE !)');
  if (!sse.size) console.warn('[mission] ⚠️ aucune source navigateur connectee — la mission n\'ira nulle part. Recharge la source dans OBS.');
  console.log('[mission] ' + title + (m.user ? ' — ' + m.user : '') + (cost ? ' (' + cost + ' pts)' : ''));
  return true;
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

// recompute V32 : logique "plus proche au-dessus"
// - queue trie petit->grand
// - actuel = plus petit target > currentCount, sinon dernier (même si dépassé)
// - upcoming = ceux > actuel
// - history : on n'auto-ajoute QUE lors d'une transition (ancien actuel <= cur et différent du nouveau)
//   + au démarrage, si history vide, on peuple avec tous les queue <= cur sauf actuel (pour premier affichage)
//   + clearHistory filtre aussi queue > cur pour éviter réapparition immédiate
function recomputeGoalsFromCount(opts = {}) {
  const cur = goalState.current;
  const queue = normalizeQueue(appConfig.subGoalQueue);
  appConfig.subGoalQueue = queue;
  goalState.queue = queue.slice();

  if (queue.length === 0) {
    goalState.upcoming = [];
    saveConfig();
    broadcastGoal();
    return;
  }

  const sorted = queue.slice().sort((a,b)=>a.target-b.target);
  const above = sorted.filter(q => q.target > cur);
  let chosen;
  let upcoming = [];
  if (above.length > 0) {
    chosen = above[0];
    upcoming = above.slice(1);
  } else {
    chosen = sorted[sorted.length - 1];
    upcoming = [];
  }

  // transition : ancien actuel terminé ?
  const prevTarget = goalState.target;
  const prevLabel = goalState.label;
  const isNewCurrent = !prevTarget || chosen.target !== prevTarget;

  if (isNewCurrent && prevTarget && prevTarget <= cur) {
    // ancien objectif atteint → passe en history s'il n'y est pas déjà
    if (!goalState.history.some(h=>h.target===prevTarget)) {
      goalState.history.push({
        label: prevLabel || 'SUB GOAL',
        target: prevTarget,
        currentAtCompletion: cur,
        completedAt: new Date().toISOString()
      });
    }
  }

  // si history vide (premier démarrage) et qu'on a des objectifs déjà dépassés, on les met en history
  // mais PAS après un clear explicite (opts.skipAutoHistory)
  if (!opts.skipAutoHistory && goalState.history.length === 0) {
    for (const q of sorted) {
      if (q.target <= cur && q.target !== chosen.target) {
        if (!goalState.history.some(h=>h.target===q.target)) {
          goalState.history.push({
            label: q.label,
            target: q.target,
            currentAtCompletion: cur,
            completedAt: new Date().toISOString()
          });
        }
      }
    }
  } else if (isNewCurrent) {
    // si on a sauté plusieurs paliers d'un coup (ex: 2→10 avec 5 et 7 entre), on met les intermédiaires en history
    for (const q of sorted) {
      if (q.target <= cur && q.target !== chosen.target && q.target !== prevTarget) {
        if (q.target > (prevTarget||0) && q.target < chosen.target) {
          if (!goalState.history.some(h=>h.target===q.target)) {
            goalState.history.push({
              label: q.label,
              target: q.target,
              currentAtCompletion: cur,
              completedAt: new Date().toISOString()
            });
          }
        }
      }
    }
  }

  // tri history petit->grand, max 20
  goalState.history.sort((a,b)=>a.target-b.target);
  if (goalState.history.length > 20) goalState.history = goalState.history.slice(-20);
  appConfig.subGoalHistory = goalState.history.slice();

  goalState.label = chosen.label;
  goalState.target = chosen.target;
  goalState.upcoming = upcoming;
  appConfig.subGoalLabel = chosen.label;
  appConfig.subGoalTarget = chosen.target;
  if (upcoming.length>0) {
    appConfig.subGoalNextLabel = upcoming[0].label;
    appConfig.subGoalNextTarget = upcoming[0].target;
  } else {
    appConfig.subGoalNextLabel = '';
    appConfig.subGoalNextTarget = 0;
  }

  saveConfig();
  broadcastGoal();
}

function checkAndSwitchGoal() {
  // V32 : recompute avec logique plus proche
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

let chatPending = null, chatFlushT = null;
function chatFrame(m) {
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
  return payload;
}
/* V44 — ne JAMAIS perdre un message.
   L'ancien garde-fou (« if (now - lastChatBcast < 50) return ») supprimait silencieusement
   tout message arrivé moins de 50 ms apres le precedent. Or Twitch livraille les messages
   par paquets : pendant un burst (pile ce qui fait monter la vélocité), seule la 1re ligne
   passait → le MPM vu par l'overlay etait bien plus bas que le MPM reel de Twitch, et le
   chat n' affichait pas « tous les messages » comme prevu. Maintenant on met en file et on
   écrit par paquets : memes economies d'ecritures, zero message perdu. */
function flushChat() {
  chatFlushT = null;
  if (!chatPending || !chatPending.length) return;
  const frames = chatPending.map(chatFrame).join('');
  chatPending = null;
  lastChatBcast = Date.now();
  for (const res of sse) { try { res.write(frames); } catch (e) {} }
}
function broadcastChat(m) {
  if (!chatPending) chatPending = [];
  chatPending.push(m);
  if (chatPending.length > 400) chatPending.shift();          // garde-fou memoire
  if (chatFlushT) return;
  const since = Date.now() - lastChatBcast;
  chatFlushT = setTimeout(flushChat, since >= 50 ? 0 : (50 - since));   // groupés, jamais plus de 50 ms de latence
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

    /* V46 : declencher une mission a la main, sans passer par les points */
    if (c === '!mission') {
      if (!isStaff) { chat.say(channel, '[Mission] Reserve au streamer et aux mods.'); return; }
      const txt = rest.join(' ').trim();
      if (!txt) { chat.say(channel, '[Mission] Usage : !mission FAIS 10 POMPES'); return; }
      if (broadcastMission({ title: txt, user: username, force: true }))
        chat.say(channel, '[Mission] Affichee : ' + txt.slice(0, 60));
      return;
    }

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
    if (!scopes.includes('channel:read:redemptions')) missing.push('points de chaine');
    tokenInfo.missing = missing;
    console.log('[auth] token VALIDE — compte : ' + (v.login || '?') + ' — droits : ' + (scopes.join(', ') || '(aucun)'));
    if (!scopes.includes('channel:read:subscriptions'))
      console.warn('[auth] ⚠️ il MANQUE le droit "channel:read:subscriptions" → le sub goal ne marchera pas');
    if (!scopes.includes('channel:read:redemptions'))
      console.warn('[auth] ⚠️ il MANQUE le droit "channel:read:redemptions" → les missions (points de chaine) ne s\'afficheront pas');
  } catch (e) {
    tokenInfo = { valid: false, reason: 'réseau' };
    console.warn('[auth] erreur réseau sur la validation :', e.message || e);
  }
}

/* V46 : la liste de TES recompenses de points de chaine, pour pouvoir les cocher
   dans le panneau au lieu de recopier les titres a la main.
   On n'envoie PAS only_manageable_rewards : sans ce filtre Twitch renvoie toutes
   les recompenses de la chaine, y compris celles creees a la main dans ton
   tableau de bord (avec le filtre, on ne verrait que celles creees par l'appli). */
async function helixRewards() {
  if (!CLIENT_ID || !POLL_OAUTH) return { ok: false, reason: 'no-token' };
  if (!resolvedBroadcasterId) { await resolveBroadcaster(); }
  if (!resolvedBroadcasterId) return { ok: false, reason: 'no-broadcaster' };
  try {
    const base = process.env.HELIX_REWARDS_URL || 'https://api.twitch.tv/helix/channel_points/custom_rewards';
    const r = await fetch(base + '?broadcaster_id='
      + encodeURIComponent(resolvedBroadcasterId), {
      headers: { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + POLL_OAUTH }
    });
    if (r.status === 401) return { ok: false, reason: 'scope' };
    if (r.status === 403) return { ok: false, reason: 'affiliate' };
    if (!r.ok) return { ok: false, reason: 'http-' + r.status };
    const d = await r.json();
    const list = (d.data || []).map(x => ({
      id: x.id,
      title: x.title,
      cost: x.cost,
      enabled: x.is_enabled !== false,
      paused: !!x.is_paused,
      needsInput: !!x.is_user_input_required,
      color: x.background_color || ''
    })).sort((a, b) => a.cost - b.cost);
    return { ok: true, rewards: list };
  } catch (e) {
    return { ok: false, reason: 'network' };
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

/* ═══ V46 — POINTS DE CHAINE (EventSub WebSocket) ════════════════════
   Twitch previent en temps reel quand un viewer echange des points contre une de
   TES recompenses : channel.channel_points_custom_reward_redemption.add.
   • Il faut le droit channel:read:redemptions sur TON token de streamer
     (un token de moderateur ne suffit pas, Twitch le refuse).
   • Toutes tes recompenses remontent, y compris celles creees a la main dans
     le tableau de bord Twitch (le filtre par application ne concerne que les
     routes de gestion, pas cet evenement).
   • Les recompenses automatiques de Twitch (« Mettre en avant mon message »…)
     sont un autre evenement : on ne s'y abonne pas, donc pas de bandeau parasite. */
let pointsWs = null, pointsRetry = 0, pointsOk = false, pointsForceModule = false;
let migrationVoulue = false;   // vrai pendant une reconnexion demandee par Twitch
/* Journal de bord de la connexion aux points : permet de voir dans le panneau
   exactement ou ca coince, au lieu de deviner. */
const pointsDiag = {
  supported: null,     // une implementation WebSocket est-elle disponible ?
  opened: false,       // socket ouverte ?
  welcomed: false,     // Twitch a-t-il ouvert la session ?
  subscribed: false,   // abonnement accepte ? (tes recompenses)
  autoSubscribed: null,// abonnement aux recompenses integrees / Power-ups
  subError: null,      // message d'erreur d'abonnement
  lastMessage: null,   // date du dernier message recu de Twitch
  lastError: null,     // derniere erreur reseau, en clair
  echecsNatif: 0,      // echecs consecutifs du WebSocket integre
  events: 0,           // nombre d'echanges de points recus
  lastEvent: null,     // dernier echange recu (titre + pseudo)
  lastShown: null,     // dernier bandeau reellement envoye a l'overlay
  lastBlocked: null,   // dernier echange ecarte par les filtres, avec la raison
  closes: 0
};
/* URLs surchargeables par variable d'environnement : utilise uniquement par les
   tests automatiques pour simuler Twitch. En usage normal, ce sont les vraies. */
/* L'adresse EXACTE de Twitch est wss://eventsub.wss.twitch.tv/ws — le chemin "/ws"
   est obligatoire. Sans lui, Twitch repond 403 et la connexion n'est jamais etablie
   (c'etait le bug : on se connectait a la racine du domaine). */
const EVENTSUB_WS = process.env.EVENTSUB_WS_URL || 'wss://eventsub.wss.twitch.tv/ws';
const EVENTSUB_API = process.env.EVENTSUB_API_URL || 'https://api.twitch.tv/helix/eventsub/subscriptions';
function connectChannelPoints() {
  if (!CLIENT_ID || !POLL_OAUTH || !resolvedBroadcasterId) return;
  async function abonnerUn(sessionId, type, version) {
    const r = await fetch(EVENTSUB_API, {
      method: 'POST',
      headers: { 'Client-Id': CLIENT_ID, 'Authorization': 'Bearer ' + POLL_OAUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type, version,
        condition: { broadcaster_user_id: resolvedBroadcasterId },
        transport: { method: 'websocket', session_id: sessionId }
      })
    });
    return r;
  }

  async function subscribe(sessionId) {
    try {
      /* Deux familles de recompenses existent chez Twitch, et elles n'envoient
         PAS le meme evenement :
           1. tes recompenses a toi (celles que tu as creees)  -> custom_reward
           2. les recompenses integrees de Twitch et les Power-ups
              (mettre en avant un message, gigantifier un emote, celebration...)
              -> automatic_reward, un type completement different.
         On s'abonne aux deux, sinon la moitie des echanges passe a la trappe. */
      const r = await abonnerUn(sessionId, 'channel.channel_points_custom_reward_redemption.add', '1');

      // les recompenses integrees / Power-ups : en plus, et sans bloquer si ca echoue
      try {
        const r2 = await abonnerUn(sessionId, 'channel.channel_points_automatic_reward_redemption.add', '1');
        pointsDiag.autoSubscribed = r2.ok;
        if (r2.ok) console.log('[points] abonnement OK aussi pour les recompenses integrees / Power-ups');
        else console.log('[points] recompenses integrees non disponibles (HTTP ' + r2.status + ') — sans gravite');
      } catch (e) { pointsDiag.autoSubscribed = false; }

      if (r.ok) {
        pointsOk = true;
        pointsDiag.subscribed = true; pointsDiag.subError = null;
        console.log('[points] abonnement OK — les echanges de points affichent une mission');
      } else {
        const txt = await r.text().catch(() => '');
        pointsOk = false;
        pointsDiag.subscribed = false;
        pointsDiag.subError = 'HTTP ' + r.status + ' ' + txt.slice(0, 200);
        if (r.status === 401 || r.status === 403) {
          console.warn('[points] ⚠️ refuse (HTTP ' + r.status + ') — il manque le droit "channel:read:redemptions" sur ton token,');
          console.warn('         ou le token n\'est pas celui du compte de la chaine. Regenere-le depuis le panneau (onglet Reglages).');
        } else {
          console.warn('[points] abonnement impossible (HTTP ' + r.status + ') ' + txt.slice(0, 140));
        }
      }
    } catch (e) { pointsDiag.subError = e.message; console.warn('[points] erreur abonnement :', e.message); }
  }
  /* Choix de l'implementation WebSocket.
     forcerModule = true -> on ignore le WebSocket integre de Node.
     Le WebSocket integre (Node 22+) passe par undici et se fait refuser par
     certains antivirus / proxys d'entreprise la ou le module "ws" passe. On
     bascule donc automatiquement sur "ws" si le natif n'arrive pas a s'ouvrir. */
  function choisirWS(forcerModule) {
    if (!forcerModule && typeof WebSocket !== 'undefined') {
      pointsDiag.supported = 'natif';
      return WebSocket;
    }
    try {
      const W = require('ws');
      pointsDiag.supported = 'module ws';
      return W;
    } catch (e) {
      if (!forcerModule && typeof WebSocket !== 'undefined') { pointsDiag.supported = 'natif'; return WebSocket; }
      pointsDiag.supported = null;
      console.warn('[points] ⚠️ pas de WebSocket disponible sur cette version de Node (' + process.version + ').');
      console.warn('         Installe Node 22 ou lance "npm install ws" dans le dossier de l\'overlay.');
      return null;
    }
  }

  function ouvrir(url) {
    const WS = choisirWS(pointsForceModule);
    if (!WS) return;
    let ouverte = false;   // a-t-on reussi a etablir cette connexion ?
    try { pointsWs = new WS(url || EVENTSUB_WS); }
    catch (e) {
      pointsDiag.lastError = e.message;
      console.warn('[points] connexion impossible :', e.message);
      return;
    }
    /* Le WebSocket integre utilise onmessage/onclose, le module "ws" utilise .on().
       Les deux acceptent onmessage, mais on passe par une fonction commune pour
       que le comportement soit rigoureusement identique dans les deux cas. */
    const surMessage = async (data) => {
      let msg; try { msg = JSON.parse(data); } catch (e) { return; }
      const t = msg.metadata && msg.metadata.message_type;
      pointsDiag.lastMessage = new Date().toISOString();
      if (t === 'session_welcome') {
        pointsRetry = 0;
        pointsDiag.welcomed = true;
        await subscribe(msg.payload.session.id);
      } else if (t === 'notification') {
        const evt = msg.payload && msg.payload.event;
        if (!evt || !evt.reward) return;
        const type = (msg.payload.subscription && msg.payload.subscription.type) || '';
        const auto = type.indexOf('automatic') !== -1;
        /* Une recompense integree n'a pas de titre : elle a un "type" technique
           (send_highlighted_message...). On le traduit en francais lisible. */
        const NOMS_AUTO = {
          single_message_bypass_sub_mode: 'Message malgre le mode abonnes',
          send_highlighted_message: 'Message mis en avant',
          random_sub_emote_unlock: 'Emote aleatoire debloquee',
          chosen_sub_emote_unlock: 'Emote choisie debloquee',
          chosen_modified_sub_emote_unlock: 'Emote modifiee debloquee',
          message_effect: 'Effet de message (Power-up)',
          gigantify_an_emote: 'Emote geante (Power-up)',
          celebration: 'Celebration a l\'ecran (Power-up)'
        };
        const titre = auto
          ? (NOMS_AUTO[evt.reward.type] || evt.reward.type || 'Recompense Twitch')
          : evt.reward.title;
        const cout = auto
          ? (evt.reward.channel_points != null ? evt.reward.channel_points : evt.reward.cost)
          : evt.reward.cost;
        pointsDiag.events++;
        pointsDiag.lastEvent = titre + ' — ' + (evt.user_name || '?') + (auto ? ' (integree)' : '');
        console.log('[points] echange recu : ' + pointsDiag.lastEvent);
        broadcastMission({
          title: titre,
          cost: cout,
          user: evt.user_name || evt.user_login || '',
          input: evt.user_input || (evt.message && evt.message.text) || ''
        });
      } else if (t === 'session_reconnect') {
        /* Twitch nous demande de migrer vers une nouvelle adresse. On marque la
           fermeture comme voulue, sinon onclose relancerait AUSSI une connexion
           et on se retrouverait avec deux sockets en parallele. */
        const u = (msg.payload.session && msg.payload.session.reconnect_url) || null;
        const ancien = pointsWs;
        migrationVoulue = true;
        try { ancien.close(); } catch (e) {}
        ouvrir(u);   // si u est null, on repart sur l'adresse normale
      }
    };
    pointsWs.onmessage = (ev) => surMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
    pointsWs.onopen = () => {
      ouverte = true; pointsDiag.opened = true; pointsDiag.lastError = null;
      pointsDiag.echecsNatif = 0;
      console.log('[points] connecte a Twitch (' + pointsDiag.supported + '), attente de la session…');
    };
    pointsWs.onclose = (e) => {
      if (!pointsWs) return;
      pointsDiag.opened = false;
      /* fermeture voulue (migration demandee par Twitch) : la nouvelle connexion
         est deja lancee, on ne doit surtout pas en ouvrir une seconde. */
      if (migrationVoulue) { migrationVoulue = false; return; }
      pointsDiag.closes++;
      /* Si la connexion n'a JAMAIS abouti avec le WebSocket integre, on repasse
         sur le module "ws" : c'est le cas typique d'un antivirus qui bloque
         undici mais laisse passer le reste. */
      if (!ouverte && !pointsForceModule && pointsDiag.supported === 'natif') {
        pointsDiag.echecsNatif = (pointsDiag.echecsNatif || 0) + 1;
        if (pointsDiag.echecsNatif >= 2) {
          pointsForceModule = true;
          console.warn('[points] le WebSocket integre de Node n\'arrive pas a joindre Twitch — bascule sur le module "ws".');
          return setTimeout(() => ouvrir(), 1500);
        }
      }
      const wait = Math.min(60000, 5000 * Math.pow(2, Math.min(pointsRetry++, 3)));
      console.warn('[points] connexion fermee' + (pointsDiag.lastError ? ' (' + pointsDiag.lastError + ')' : '')
        + ' — nouvelle tentative dans ' + Math.round(wait / 1000) + ' s');
      setTimeout(() => ouvrir(), wait);   // reconnexion avec attente croissante
    };
    pointsWs.onerror = (e) => {
      /* On GARDE le message : sans lui, impossible de savoir si c'est un
         pare-feu, un proxy, un DNS ou Twitch qui refuse. */
      const m = (e && (e.message || (e.error && e.error.message))) || (e && e.type) || 'erreur reseau';
      pointsDiag.lastError = String(m).slice(0, 200);
      console.warn('[points] erreur reseau :', pointsDiag.lastError);
      try { pointsWs.close(); } catch (err) {}
    };
  }
  ouvrir();
}

/* ═══ V47 — OBS : savoir quelle scene est affichee ═══════════════════
   On se connecte au serveur WebSocket d'OBS (Outils > Parametres du serveur
   WebSocket) pour connaitre la scene active en temps reel. Ca permet de ranger
   les blocs differemment selon la scene : ta camera est a droite en partage
   d'ecran, donc le chat doit se pousser ailleurs.
   Le protocole est celui d'obs-websocket 5.x :
     op 0 Hello  -> op 1 Identify (avec authentification SHA256 si demandee)
     op 2 Identified -> on est connecte
     op 5 Event  -> CurrentProgramSceneChanged quand tu changes de scene
   Rien n'est envoye a OBS qui puisse modifier ton reglage : on ne fait que LIRE. */
const crypto = require('crypto');
let obsWs = null, obsRetry = 0, obsMigration = false;
const obsState = {
  enabled: !!OBS_WS_URL,
  connected: false,
  identified: false,
  scene: null,          // scene actuellement a l'antenne
  scenes: [],           // toutes les scenes existantes
  lastError: null,
  version: null
};

/* Reponse au defi d'authentification, exactement comme decrit par OBS :
   base64(sha256( base64(sha256(motdepasse + salt)) + challenge )) */
function obsAuthString(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

function obsSend(obj) {
  try { obsWs.send(JSON.stringify(obj)); } catch (e) {}
}

function obsRequest(type, data) {
  obsSend({ op: 6, d: { requestType: type, requestId: type + '-' + Date.now(), requestData: data || {} } });
}

function connectOBS() {
  if (!OBS_WS_URL) { obsState.enabled = false; return; }
  obsState.enabled = true;
  let WS;
  try { WS = (typeof WebSocket !== 'undefined') ? WebSocket : require('ws'); }
  catch (e) { try { WS = require('ws'); } catch (e2) { return; } }

  let ouverte = false;
  try { obsWs = new WS(OBS_WS_URL); }
  catch (e) { obsState.lastError = e.message; return; }

  obsWs.onopen = () => { ouverte = true; obsState.connected = true; obsState.lastError = null; };

  obsWs.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
    const d = msg.d || {};

    if (msg.op === 0) {
      obsState.version = d.obsWebSocketVersion || null;
      const ident = { rpcVersion: 1 };
      if (d.authentication) {
        if (!OBS_WS_PASSWORD) {
          obsState.lastError = 'mot-de-passe-manquant';
          console.warn('[obs] OBS demande un mot de passe. Copie-le depuis OBS (Outils > Parametres du serveur WebSocket > Afficher les informations de connexion) dans l\'onglet REGLAGES.');
          try { obsWs.close(); } catch (e) {}
          return;
        }
        ident.authentication = obsAuthString(OBS_WS_PASSWORD, d.authentication.salt, d.authentication.challenge);
      }
      obsSend({ op: 1, d: ident });
      return;
    }

    if (msg.op === 2) {
      obsState.identified = true; obsRetry = 0; obsState.lastError = null;
      console.log('[obs] connecte a OBS ' + (obsState.version ? '(websocket ' + obsState.version + ')' : ''));
      obsRequest('GetSceneList');
      return;
    }

    /* Reponse a la question posee au debut de la transition : on connait la
       scene cible avant meme que la transition soit finie. */
    if (msg.op === 7 && d.requestType === 'GetCurrentProgramScene' && d.responseData) {
      const nom = d.responseData.sceneName || d.responseData.currentProgramSceneName;
      if (nom && nom !== obsState.scene) {
        obsState.scene = nom;
        console.log('[obs] scene : ' + nom + ' (des le debut de la transition)');
        broadcastScene();
      }
      return;
    }

    if (msg.op === 7 && d.requestType === 'GetSceneList' && d.responseData) {
      const r = d.responseData;
      obsState.scenes = (r.scenes || []).map(x => x.sceneName).filter(Boolean).reverse();
      const nouvelle = r.currentProgramSceneName || null;
      if (nouvelle && nouvelle !== obsState.scene) { obsState.scene = nouvelle; broadcastScene(); }
      else if (nouvelle) obsState.scene = nouvelle;
      return;
    }

    if (msg.op === 5) {
      /* SceneTransitionStarted part DES LE DEBUT de la transition, alors que
         CurrentProgramSceneChanged n'arrive qu'a la fin. En basculant l'overlay
         des le debut, le reagencement se fait PENDANT le fondu d'OBS au lieu
         d'arriver en retard, une fois la nouvelle scene deja affichee.
         En mode direct (transition instantanee), les deux se suivent de si pres
         que ca ne change rien. */
      if (d.eventType === 'SceneTransitionStarted') {
        obsRequest('GetCurrentProgramScene');   // vers quelle scene va-t-on ?
        return;
      }
      if (d.eventType === 'CurrentProgramSceneChanged') {
        const nom = d.eventData && d.eventData.sceneName;
        if (nom && nom !== obsState.scene) {
          obsState.scene = nom;
          console.log('[obs] scene : ' + nom);
          broadcastScene();
        }
      } else if (d.eventType === 'SceneListChanged' || d.eventType === 'SceneNameChanged'
              || d.eventType === 'SceneCreated' || d.eventType === 'SceneRemoved') {
        obsRequest('GetSceneList');   // la liste a bouge, on la relit
      }
    }
  };

  obsWs.onerror = (e) => {
    const m = (e && (e.message || (e.error && e.error.message))) || 'erreur reseau';
    obsState.lastError = String(m).slice(0, 200);
  };

  obsWs.onclose = () => {
    obsState.connected = false; obsState.identified = false;
    if (obsMigration) { obsMigration = false; return; }
    const wait = Math.min(30000, 3000 * Math.pow(2, Math.min(obsRetry++, 3)));
    setTimeout(() => connectOBS(), wait);
  };
}

/* — Connexion a OBS (scene active) — */
connectOBS();

/* — Lancement des connexions "données" (sub goal + points de chaine) — */
if (CLIENT_ID && POLL_OAUTH) {
  (async () => {
    if (await resolveBroadcaster()) {
      syncSubGoal();
      setInterval(syncSubGoal, 60 * 1000);   // sub goal toutes les minutes
      connectChannelPoints();
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

    /* — Assets statiques (demo/ + assets/ : GIFs, images) — */
    for (const dir of ['demo', 'assets']) {
      if (u.pathname.startsWith('/' + dir + '/')) {
        const f = path.join(__dirname, dir, path.basename(u.pathname));
        if (!f.startsWith(path.join(__dirname, dir))) return send(403, 'text/plain', 'nope');
        fs.readFile(f, (e, b) => {
          if (e) return send(404, 'text/plain', 'introuvable');
          const ext = path.extname(f).toLowerCase();
          const mime = ext === '.gif' ? 'image/gif'
            : ext === '.png' ? 'image/png'
            : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
            : ext === '.webp' ? 'image/webp'
            : ext === '.webm' ? 'video/webm'
            : ext === '.mp4' ? 'video/mp4'
            : 'application/octet-stream';
          send(200, mime, b, { 'Cache-Control': 'no-store' });
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

    /* — Bruitages (WAV/MP3 rendus localement) — */
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
          // V32 gestion queue
          if (p.queue !== undefined && Array.isArray(p.queue)) {
            appConfig.subGoalQueue = normalizeQueue(p.queue);
            goalState.queue = appConfig.subGoalQueue.slice();
            saveConfig();
            recomputeGoalsFromCount();
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.add !== undefined) {
            const toAdd = normalizeQueue([p.add])[0];
            if (!toAdd || !toAdd.target) return send(400, 'application/json', JSON.stringify({ ok:false, err:'cible invalide' }));
            // si queue vide, on n'auto-injecte pas 1, on prend ce qui est demandé
            appConfig.subGoalQueue = normalizeQueue((appConfig.subGoalQueue||[]).concat([toAdd]));
            saveConfig();
            recomputeGoalsFromCount();
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.edit !== undefined) {
            // {oldTarget, newTarget, newLabel}
            const oldT = Math.max(1, Math.round(+p.edit.oldTarget||0));
            const newT = Math.max(1, Math.round(+p.edit.newTarget||0));
            const newL = String(p.edit.newLabel||'SUB GOAL').slice(0,24);
            if (!oldT || !newT) return send(400, 'application/json', JSON.stringify({ ok:false, err:'cible invalide' }));
            // remplace dans queue
            appConfig.subGoalQueue = (appConfig.subGoalQueue||[]).map(q=> q.target===oldT ? { label:newL, target:newT } : q);
            // aussi dans history si present
            goalState.history = goalState.history.map(h=> h.target===oldT ? Object.assign({}, h, { label:newL, target:newT }) : h);
            appConfig.subGoalHistory = goalState.history.slice();
            appConfig.subGoalQueue = normalizeQueue(appConfig.subGoalQueue);
            saveConfig();
            recomputeGoalsFromCount();
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.removeTarget !== undefined) {
            const rem = Math.max(1, Math.round(+p.removeTarget));
            appConfig.subGoalQueue = (appConfig.subGoalQueue||[]).filter(q=>q.target!==rem);
            if (p.removeHistoryToo) {
              goalState.history = goalState.history.filter(h=>h.target!==rem);
              appConfig.subGoalHistory = goalState.history.slice();
            }
            saveConfig();
            recomputeGoalsFromCount({ skipAutoHistory: true });
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.label !== undefined) { goalState.label = String(p.label).slice(0, 24); appConfig.subGoalLabel = goalState.label; }
          if (p.current !== undefined) goalState.current = Math.max(0, Math.round(+p.current || 0));
          if (p.target !== undefined) { 
            const t = Math.max(1, Math.round(+p.target || 1));
            goalState.target = t; appConfig.subGoalTarget = t;
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
          if (p.clearHistory === true) { 
            goalState.history = []; appConfig.subGoalHistory = []; 
            // V32 : quand on efface historique, on garde seulement les objectifs > current pour éviter réapparition immédiate
            const cur = goalState.current;
            appConfig.subGoalQueue = (appConfig.subGoalQueue||[]).filter(q=>q.target > cur);
            saveConfig();
            recomputeGoalsFromCount({ skipAutoHistory: true });
            return send(200, 'application/json', JSON.stringify(goalState));
          }
          if (p.history !== undefined && Array.isArray(p.history)) { goalState.history = p.history.slice(-20); appConfig.subGoalHistory = goalState.history.slice(); }
          saveConfig();
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
      readBody().then(async d => {
        try {
          const p = JSON.parse(d || '{}');
          /* Aperçu « Ambiance générale » : diffusé à l'overlay en direct,
             mais NI enregistré NI persisté (Enregistrer le fera, Annuler
             renverra l'ancienne valeur de la même manière). */
          if (p.preview === true) {
            const previewCfg = Object.assign({}, appConfig, {
              chatTitle: p.chatTitle !== undefined ? String(p.chatTitle).slice(0, 40) : appConfig.chatTitle,
              accent: p.accent !== undefined ? String(p.accent).slice(0, 16) : appConfig.accent,
              velocityEquilibrium: p.equilibriumMPM !== undefined ? Math.max(1, Math.round(+p.equilibriumMPM)) : appConfig.velocityEquilibrium,
              velocityClimb: p.climbSensitivity !== undefined ? +p.climbSensitivity : appConfig.velocityClimb,
              velocityDecay: p.decayRate !== undefined ? +p.decayRate : appConfig.velocityDecay,
              velocityHold: p.holdDurationSeconds !== undefined ? Math.round(+p.holdDurationSeconds) : appConfig.velocityHold,
              velocityBarWidth: p.barWidth !== undefined ? Math.round(+p.barWidth) : appConfig.velocityBarWidth,
              velocityBarHeight: p.barHeight !== undefined ? Math.round(+p.barHeight) : appConfig.velocityBarHeight,
              velocityShowMetrics: p.showMetrics !== undefined ? !!p.showMetrics : appConfig.velocityShowMetrics,
              velocityEnabled: p.velocityEnabled !== undefined ? !!p.velocityEnabled : appConfig.velocityEnabled,
              velocityGoalThreshold: p.goalThreshold !== undefined ? Math.round(+p.goalThreshold) : appConfig.velocityGoalThreshold,
              velocityGoalDurationMinutes: p.goalDurationMinutes !== undefined ? Math.round(+p.goalDurationMinutes) : appConfig.velocityGoalDurationMinutes,
              velocityFinHour: p.finHour !== undefined ? Math.round(+p.finHour) : appConfig.velocityFinHour,
              velocityFinMinute: p.finMinute !== undefined ? Math.round(+p.finMinute) : appConfig.velocityFinMinute,
              velocityFinEnabled: p.finEnabled !== undefined ? !!p.finEnabled : appConfig.velocityFinEnabled,
              velocityAntiSpam: p.velocityAntiSpam !== undefined ? !!p.velocityAntiSpam : (p.antiSpam !== undefined ? !!p.antiSpam : appConfig.velocityAntiSpam),
              velocityCooldownSeconds: p.velocityCooldownSeconds !== undefined ? Math.round(+p.velocityCooldownSeconds) : (p.cooldownSeconds !== undefined ? Math.round(+p.cooldownSeconds) : appConfig.velocityCooldownSeconds),
              velocityMaxPerMinute: p.velocityMaxPerMinute !== undefined ? Math.round(+p.velocityMaxPerMinute) : (p.maxPerMinute !== undefined ? Math.round(+p.maxPerMinute) : appConfig.velocityMaxPerMinute),
              velocityBoostMult: (p.velocityBoostMult !== undefined || p.boostMult !== undefined)
                ? velBoostQuantize(p.velocityBoostMult !== undefined ? p.velocityBoostMult : p.boostMult) : appConfig.velocityBoostMult,
              missionsEnabled: p.missionsEnabled !== undefined ? !!p.missionsEnabled : appConfig.missionsEnabled,
              missionDuration: p.missionDuration !== undefined ? Math.max(3, Math.min(30, Math.round(+p.missionDuration || 8))) : appConfig.missionDuration,
              missionBottom: p.missionBottom !== undefined ? Math.max(0, Math.min(400, Math.round(+p.missionBottom))) : appConfig.missionBottom,
              missionWidth: p.missionWidth !== undefined ? Math.max(600, Math.min(1600, Math.round(+p.missionWidth))) : appConfig.missionWidth,
              missionScale: p.missionScale !== undefined ? Math.max(60, Math.min(140, Math.round(+p.missionScale))) : appConfig.missionScale,
              missionShowUser: p.missionShowUser !== undefined ? !!p.missionShowUser : appConfig.missionShowUser,
              missionShowInput: p.missionShowInput !== undefined ? !!p.missionShowInput : appConfig.missionShowInput,
              velocityExcludedUsers: (p.velocityExcludedUsers !== undefined || p.excludedUsers !== undefined)
                ? normalizeExcludedUsers(p.velocityExcludedUsers !== undefined ? p.velocityExcludedUsers : p.excludedUsers)
                : appConfig.velocityExcludedUsers,
            });
            const payload = 'data: ' + JSON.stringify(Object.assign({
              cfg: 1,
              chatTitle: previewCfg.chatTitle,
              accent: previewCfg.accent
            }, velocityConfigFields(previewCfg))) + '\n\n';
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
          if (p.subGoalHistory !== undefined && Array.isArray(p.subGoalHistory)) { appConfig.subGoalHistory = p.subGoalHistory.slice(-20); goalState.history = appConfig.subGoalHistory.slice(); }
          if (p.clearHistory === true) { 
            appConfig.subGoalHistory = []; goalState.history = []; 
            // garde seulement objectifs > current pour éviter réapparition
            const cur = appConfig.subGoalAuto ? goalState.current : appConfig.subGoalManual;
            appConfig.subGoalQueue = (appConfig.subGoalQueue||[]).filter(q=>q.target > cur);
          }
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
          // V43 : l'overlay envoie un INCREMENT (velocityFinAdd) et non plus l'heure absolue.
          // Avant, deux declenchements rapproches pouvaient ecrire une valeur plus vieille que
          // celle que l'overlay venait de calculer (l'echo SSE lui remis a jour) → FIN PRÉVUE
          // qui derive de 15 min entre l'ecran et la config. Le calcul est dorenavant ici seul.
          if (p.velocityFinAdd !== undefined) {
            const add = Math.max(-1440, Math.min(1440, Math.round(+p.velocityFinAdd || 0)));
            let tot = appConfig.velocityFinHour * 60 + appConfig.velocityFinMinute + add;
            tot = ((tot % 1440) + 1440) % 1440;
            appConfig.velocityFinHour = Math.floor(tot / 60);
            appConfig.velocityFinMinute = tot % 60;
          }
          if (p.velocityFinHour !== undefined) appConfig.velocityFinHour = Math.max(0, Math.min(23, Math.round(+p.velocityFinHour || 21)));
          if (p.finHour !== undefined) appConfig.velocityFinHour = Math.max(0, Math.min(23, Math.round(+p.finHour || 21)));
          if (p.velocityFinMinute !== undefined) appConfig.velocityFinMinute = Math.max(0, Math.min(59, Math.round(+p.velocityFinMinute || 30)));
          if (p.finMinute !== undefined) appConfig.velocityFinMinute = Math.max(0, Math.min(59, Math.round(+p.finMinute || 30)));
          if (p.velocityFinEnabled !== undefined) appConfig.velocityFinEnabled = !!p.velocityFinEnabled;
          if (p.finEnabled !== undefined) appConfig.velocityFinEnabled = !!p.finEnabled;
          if (p.velocityBoostMult !== undefined || p.boostMult !== undefined)
            appConfig.velocityBoostMult = velBoostQuantize(p.velocityBoostMult !== undefined ? p.velocityBoostMult : p.boostMult);
          if (p.velocityAntiSpam !== undefined) appConfig.velocityAntiSpam = !!p.velocityAntiSpam;
          if (p.antiSpam !== undefined) appConfig.velocityAntiSpam = !!p.antiSpam;
          if (p.velocityCooldownSeconds !== undefined) appConfig.velocityCooldownSeconds = Math.max(0, Math.min(120, Math.round(+p.velocityCooldownSeconds || 0)));
          if (p.cooldownSeconds !== undefined) appConfig.velocityCooldownSeconds = Math.max(0, Math.min(120, Math.round(+p.cooldownSeconds || 0)));
          if (p.velocityMaxPerMinute !== undefined) appConfig.velocityMaxPerMinute = Math.max(1, Math.min(30, Math.round(+p.velocityMaxPerMinute || 2)));
          if (p.maxPerMinute !== undefined) appConfig.velocityMaxPerMinute = Math.max(1, Math.min(30, Math.round(+p.maxPerMinute || 2)));
          if (p.missionsEnabled !== undefined) appConfig.missionsEnabled = !!p.missionsEnabled;
          if (p.missionDuration !== undefined) appConfig.missionDuration = Math.max(3, Math.min(30, Math.round(+p.missionDuration || 8)));
          if (p.missionBottom !== undefined) appConfig.missionBottom = Math.max(0, Math.min(400, Math.round(+p.missionBottom)));
          if (p.missionWidth !== undefined) appConfig.missionWidth = Math.max(600, Math.min(1600, Math.round(+p.missionWidth)));
          if (p.missionScale !== undefined) appConfig.missionScale = Math.max(60, Math.min(140, Math.round(+p.missionScale)));
          if (p.missionMinCost !== undefined) appConfig.missionMinCost = Math.max(0, Math.min(1000000, Math.round(+p.missionMinCost || 0)));
          if (p.missionRewards !== undefined) appConfig.missionRewards = normalizeRewardList(p.missionRewards);
          if (p.missionIgnored !== undefined) appConfig.missionIgnored = normalizeRewardList(p.missionIgnored);
          if (p.missionCustom !== undefined) appConfig.missionCustom = normalizeMissionCustom(p.missionCustom);
          if (p.sceneLayouts !== undefined) {
            appConfig.sceneLayouts = normalizeSceneLayouts(p.sceneLayouts);
            broadcastScene();   // application immediate dans l'overlay
          }
          if (p.missionShowUser !== undefined) appConfig.missionShowUser = !!p.missionShowUser;
          if (p.missionShowInput !== undefined) appConfig.missionShowInput = !!p.missionShowInput;
          if (p.velocityExcludedUsers !== undefined) appConfig.velocityExcludedUsers = normalizeExcludedUsers(p.velocityExcludedUsers);
          if (p.excludedUsers !== undefined) appConfig.velocityExcludedUsers = normalizeExcludedUsers(p.excludedUsers);
          saveConfig();

          // met à jour le sub goal V32 avec queue + gestion auto/manuel
          goalState.label = appConfig.subGoalLabel;
          goalState.target = appConfig.subGoalTarget;
          goalState.nextLabel = appConfig.subGoalNextLabel || '';
          goalState.nextTarget = appConfig.subGoalNextTarget || 0;
          goalState.history = Array.isArray(appConfig.subGoalHistory) ? appConfig.subGoalHistory.slice(-20) : [];
          goalState.queue = normalizeQueue(appConfig.subGoalQueue || []);
          appConfig.subGoalQueue = goalState.queue.slice();
          goalState.upcoming = [];
          let needSync = false;
          if (!appConfig.subGoalAuto) {
            goalState.current = appConfig.subGoalManual;
          } else {
            // repasse en auto : on garde current mais on va forcer synchro Twitch immédiate
            // si on vient de passer de manuel à auto, current était manuel, on le met à 0 pour forcer maj
            if (p.subGoalAuto === true) needSync = true;
          }

          // logique plus proche (skipAutoHistory si clear)
          const skip = p.clearHistory === true;
          recomputeGoalsFromCount({ skipAutoHistory: skip });

          // si besoin de synchro auto, on le fait AVANT de répondre pour que le panneau voie la vraie valeur
          if (needSync) {
            try { await syncSubGoal(); } catch(e){}
          }

          // diffuse au widget : sub goal + titre du chat + accent + velocite V5
          const payload = 'data: ' + JSON.stringify(Object.assign({
            goal: 1, ...goalState,
            cfg: 1, chatTitle: appConfig.chatTitle, accent: appConfig.accent
          }, velocityConfigFields(appConfig))) + '\n\n';
          for (const res of sse) res.write(payload);
          send(200, 'application/json', JSON.stringify({ ok: true, config: appConfig, goal: goalState }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    /* — OBS : etat de la connexion + liste des scenes — */
    if (u.pathname === '/api/obs' && req.method === 'GET') {
      send(200, 'application/json', JSON.stringify({
        url: OBS_WS_URL,
        passwordSet: !!OBS_WS_PASSWORD,
        connected: obsState.connected,
        identified: obsState.identified,
        scene: obsState.scene,
        scenes: obsState.scenes,
        version: obsState.version,
        lastError: obsState.lastError,
        blocs: Object.fromEntries(Object.entries(BLOCS).map(([k, v]) => [k, v.nom])),
        /* Geometrie REELLE de chaque bloc, calculee depuis tes reglages du
           moment. L'editeur s'en sert pour dessiner un apercu fidele : sans ca
           il affichait une velocite de 700 px alors que la tienne en fait 350,
           et on ne pouvait pas la descendre assez bas. */
        geometrie: blocsGeometrie(),
        layouts: appConfig.sceneLayouts || []
      }));
      return;
    }

    /* — OBS : previsualiser une scene dans l'overlay pendant qu'on la regle — */
    if (u.pathname === '/api/obs/preview' && req.method === 'POST') {
      readBody().then(d => {
        let p2 = {}; try { p2 = JSON.parse(d || '{}'); } catch (e) {}
        const scene = String(p2.scene || '').trim();
        const entree = (appConfig.sceneLayouts || []).find(l => l.scene === scene) || null;
        const payload = 'data: ' + JSON.stringify({
          sceneChange: 1, scene, layout: entree ? entree.blocs : null, preview: 1
        }) + '\n\n';
        for (const res of sse) res.write(payload);
        send(200, 'application/json', JSON.stringify({ ok: true, scene, applied: !!entree }));
      });
      return;
    }

    /* — MISSION : diagnostic de la connexion aux points de chaine — */
    if (u.pathname === '/api/mission/diag' && req.method === 'GET') {
      send(200, 'application/json', JSON.stringify({
        node: process.version,
        tokenPresent: !!POLL_OAUTH,
        broadcasterId: resolvedBroadcasterId || null,
        overlaysConnected: sse.size,
        scopes: (tokenInfo && tokenInfo.scopes) || null,
        missionsEnabled: appConfig.missionsEnabled !== false,
        ignoredCount: (appConfig.missionIgnored || []).length,
        minCost: appConfig.missionMinCost || 0,
        points: pointsDiag
      }));
      return;
    }

    /* — MISSION : la liste de tes recompenses de points de chaine — */
    if (u.pathname === '/api/mission/rewards' && req.method === 'GET') {
      helixRewards().then(out => send(200, 'application/json', JSON.stringify(out)));
      return;
    }

    /* — MISSION : declenchement manuel / test depuis le panneau —
         POST /api/mission {title, user, cost, input, test} — */
    if (u.pathname === '/api/mission' && req.method === 'POST') {
      readBody().then(d => {
        try {
          const p = JSON.parse(d || '{}');
          const ok = broadcastMission({
            title: p.title, user: p.user, cost: p.cost, input: p.input,
            test: p.test, force: p.force !== false   // un test passe outre les filtres
          });
          send(200, 'application/json', JSON.stringify({ ok }));
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
          const ALLOWED_KEYS = ['CHAT_NICK', 'CHAT_OAUTH', 'CHAT_CHANNEL', 'CLIENT_ID', 'POLL_OAUTH', 'ADMIN_TOKEN', 'ALLOWED_USERS', 'OBS_WS_URL', 'OBS_WS_PASSWORD'];
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
  console.log(`  Missions → ${CLIENT_ID && POLL_OAUTH ? 'points de chaine (EventSub)' : 'manuel (bouton du panneau)'}`);
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
