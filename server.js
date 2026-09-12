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

const PORT = +(process.env.PORT || 8321);

/* — Clés : chargées depuis secrets.json (à remplir à la main, jamais versionné).
     Si une variable d'environnement existe, elle a priorité. — */
let SECRETS = {};
try {
  const sp = path.join(__dirname, 'secrets.json');
  if (fs.existsSync(sp)) SECRETS = JSON.parse(fs.readFileSync(sp, 'utf8')) || {};
} catch (e) { console.warn('[config] secrets.json illisible (ignoré) :', e.message); }
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '') ? process.env[k] : (SECRETS[k] !== undefined && SECRETS[k] !== '' ? SECRETS[k] : d);

const ADMIN_TOKEN = env('ADMIN_TOKEN', '');
const ALLOWED = String(env('ALLOWED_USERS', '')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/* — Capture des sondages natifs /poll (Helix, polling 2,5 s) — */
const CLIENT_ID = env('CLIENT_ID', '');
const BROADCASTER_ID = env('BROADCASTER_ID', '');
const POLL_OAUTH = env('POLL_OAUTH', '');      // user token · scope channel:read:polls

/* — Chat Twitch (tmi.js optionnel) — */
const CHAT_OAUTH = env('CHAT_OAUTH', '');
const CHAT_NICK = env('CHAT_NICK', '');
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

/* — SUB GOAL : état modifiable à chaud (env de base + POST /api/goal) — */
const goalState = {
  label: process.env.SUB_GOAL_LABEL || 'SUB GOAL',
  current: Math.max(0, parseInt(process.env.SUB_GOAL_CURRENT || '0', 10) || 0),
  target: Math.max(1, parseInt(process.env.SUB_GOAL_TARGET || '50', 10) || 50)
};

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

function startDebate({ question, a, b, duration = 120, source = 'chat', startsAt = Date.now() }) {
  const dur = Math.min(600, Math.max(15, Math.round(duration) || 120));
  votes.clear();
  state = { mode: 'live', source, question, a, b, va: 0, vb: 0, startsAt, endsAt: Date.now() + dur * 1000 };
  lastBroadcast = 0;
  broadcast(true);
  console.log(`[débat] (${source}) ${question} · « ${a} » vs « ${b} » · ${dur}s`);
}

function tally(choice, user = 'anon') {
  if (state.mode !== 'live') return false;
  const c = String(choice).toUpperCase().startsWith('B') ? 'B' : 'A';
  const u = String(user || 'anon').toLowerCase().slice(0, 64);
  const prev = votes.get(u);
  if (prev) {
    if (prev.c === c) return false;
    state[prev.c === 'A' ? 'va' : 'vb'] = Math.max(0, state[prev.c === 'A' ? 'va' : 'vb'] - 1);
    votes.delete(u);
  }
  votes.set(u, { c, ts: Date.now() });
  state[c === 'A' ? 'va' : 'vb']++;
  dirty = true;
  return true;
}

function finish(source) {
  if (state.mode !== 'live') return;
  const va = state.va || 0, vb = state.vb || 0;
  state = {
    mode: 'ended', source: state.source,
    question: state.question, a: state.a, b: state.b,
    va, vb, endsAt: Date.now(),
    winner: va === vb ? null : (va > vb ? 'A' : 'B')
  };
  broadcast(true);
  console.log(`[résultat] A ${va} — B ${vb} · gagnant : ${state.winner || 'égalité'}`);
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
    const emotes = (userstate && (userstate['emotes-raw'] || userstate.emotes)) || '';
    const replyTo = (userstate && userstate['reply-parent-display-name']) || undefined;
    const highlighted = (userstate && userstate['msg-id']) === 'highlighted-message'
      || (userstate && userstate['pinned-chat-paid-amount'] !== undefined);

    /* diffusion au widget (tous les messages, comme le vrai chat Twitch) :
       badges officiels (sub/mod/vip/staff…), emotes + GIFs animés, highlight/pin */
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
    if (!text.startsWith('!')) return;
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
      startDebate({ question: parts[0].slice(0, 140), a: parts[1].slice(0, 60), b: parts[2].slice(0, 60), duration: dur, source: 'chat' });
      chat.say(channel, `[Débat] LANCÉ · ${dur}s · tapez !vote A ou !vote B`);
    } else if (c === '!vote') {
      const arg = (rest[0] || '').toLowerCase();
      if (arg === 'a' || arg === '1') tally('A', username);
      else if (arg === 'b' || arg === '2') tally('B', username);
      else if (state.mode === 'live') chat.say(channel, '[Débat] Vote invalide — utilise !vote A ou !vote B.');
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
    if (!r.ok) return false;
    const d = await r.json();
    if (d.data && d.data[0] && d.data[0].id) { resolvedBroadcasterId = d.data[0].id; return true; }
  } catch (e) {}
  return false;
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
      if (state.mode !== 'live') {
        if (live.choices && live.choices.length === 2) {
          currentPollId = live.id;
          const ends = new Date(live.ends_at || Date.now() + 120000).getTime();
          console.log(`[twitch-poll] SONDAGE DÉTECTÉ : "${live.title}" → lancement du débat`);
          startDebate({
            question: live.title.slice(0, 140),
            a: live.choices[0].title.slice(0, 60),
            b: live.choices[1].title.slice(0, 60),
            duration: Math.max(15, Math.floor((ends - Date.now()) / 1000)),
            startsAt: new Date(live.started_at || Date.now()).getTime(),
            source: 'twitch'
          });
        } else {
          console.warn(`[twitch-poll] sondage ignoré (${live.choices ? live.choices.length : 0} choix, il en faut 2) : "${live.title}"`);
          currentPollId = live.id;
        }
      } else if (state.source === 'twitch' && currentPollId === live.id) {
        state.va = live.choices[0].votes || 0;
        state.vb = live.choices[1].votes || 0;
        state.endsAt = new Date(live.ends_at || state.endsAt).getTime();
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

    /* — Bruitages (WAV rendus localement) — */
    if (u.pathname.startsWith('/sounds/')) {
      const f = path.join(__dirname, 'sounds', path.basename(u.pathname));
      fs.readFile(f, (e, b) => e ? send(404, 'text/plain', '404')
        : send(200, 'audio/wav', b, { 'Cache-Control': 'public, max-age=31536000' }));
      return;
    }

    /* — API — */
    if (u.pathname === '/api/state' && req.method === 'GET') return send(200, 'application/json', JSON.stringify(state));
    if (u.pathname === '/healthz') return send(200, 'text/plain', 'ok');

    if (u.pathname === '/api/vote' && req.method === 'POST') {
      readBody().then(d => {
        try {
          const { choice, user } = JSON.parse(d || '{}');
          tally(choice, user);
          broadcast(false);
          send(200, 'application/json', JSON.stringify({ ok: true, state }));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
      return;
    }

    if (u.pathname === '/api/debate' && req.method === 'POST' && authOK) {
      readBody().then(d => {
        try {
          const { question, a, b, duration } = JSON.parse(d || '{}');
          if (!question || !a || !b) return send(400, 'application/json', JSON.stringify({ ok: false, err: 'question, a, b requis' }));
          startDebate({ question, a, b, duration, source: 'api' });
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
          if (p.label !== undefined) goalState.label = String(p.label).slice(0, 24);
          if (p.current !== undefined) goalState.current = Math.max(0, Math.round(+p.current || 0));
          if (p.target !== undefined) goalState.target = Math.max(1, Math.round(+p.target || 1));
          const payload = 'data: ' + JSON.stringify(Object.assign({ goal: 1 }, goalState)) + '\n\n';
          for (const res of sse) res.write(payload);
          send(200, 'application/json', JSON.stringify(goalState));
        } catch (e) { send(400, 'application/json', JSON.stringify({ ok: false })); }
      });
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
  console.log('');
});
