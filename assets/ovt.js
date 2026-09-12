/* ============================================================
   OVT — bibliothèque commune des overlays Twitch
   Gère : réglages, token, appels API Helix, EventSub WebSocket.
   Chargée par le panneau (config.html) et par tous les widgets.
   ============================================================ */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);

  /* ---------- stockage local ---------- */
  var store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem('ovt_' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('ovt_' + k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) {
      try { localStorage.removeItem('ovt_' + k); } catch (e) {}
    }
  };

  /* ---------- réglages (paramètres d'URL > stockage local) ----------
     Les widgets étant dans OBS (un navigateur séparé), tout peut
     être passé dans l'URL générée par le panneau de configuration. */
  var settings = {
    clientId: Q.get('client_id') || store.get('clientId', '') || '',
    token:    Q.get('token')    || store.get('token', '')    || '',
    duree:    Math.max(3, parseInt(Q.get('duree') || store.get('duree', 12), 10) || 12),
    reward:   Q.has('reward') ? Q.get('reward') : (store.get('reward', '') || ''),
    objectif: Math.max(0, parseInt(Q.get('objectif') || store.get('objectif', 0), 10) || 0)
  };

  /* mode démo (aperçu du design, contenu d'exemple uniquement)
     mode debug (petit badge d'état pour diagnostiquer un souci) */
  var DEMO  = Q.get('demo')  === '1';
  var DEBUG = Q.get('debug') === '1';

  /* ---------- erreurs ---------- */
  function err(status, message) { var e = new Error(message); e.status = status; return e; }

  /* ---------- appels à l'API Helix ---------- */
  async function helix(path, opts) {
    opts = opts || {};
    if (!settings.clientId) throw err(0, 'Client ID manquant (à définir sur le panneau)');
    if (!settings.token)    throw err(401, 'Token manquant — reconnecte-toi depuis le panneau');
    var res = await fetch('https://api.twitch.tv/helix' + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        { 'Client-Id': settings.clientId, 'Authorization': 'Bearer ' + settings.token },
        opts.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (!res.ok) {
      var msg = 'HTTP ' + res.status;
      try { var j = await res.json(); if (j && j.message) msg = j.message; } catch (e) {}
      throw err(res.status, msg);
    }
    return res.json();
  }

  /* ---------- validation du token ---------- */
  async function validate() {
    var res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': 'OAuth ' + settings.token }
    });
    if (!res.ok) throw err(res.status, 'Token expiré ou invalide');
    return res.json();
  }

  /* ---------- identités ---------- */
  var moiCache = null;
  async function me() {
    if (moiCache) return moiCache;
    var d = await helix('/users');
    if (!d.data || !d.data.length) throw err(0, 'Compte Twitch introuvable');
    moiCache = d.data[0];
    return moiCache;
  }

  async function userById(id) {
    var cache = store.get('users', {}) || {};
    var c = cache[id];
    if (c && Date.now() - c.t < 86400000) return c.u;
    var d = await helix('/users?id=' + encodeURIComponent(id));
    var u = d.data && d.data[0];
    if (u) { cache[id] = { t: Date.now(), u: u }; store.set('users', cache); }
    return u || null;
  }

  /* ---------- EventSub WebSocket (temps réel) ----------
     topics : [{ type, version, condition }]
     handlers : { onEvent(événement, type), onStatus(état, info) } */
  function eventsub(topics, handlers) {
    handlers = handlers || {};
    var ws = null, sessionId = null, stopped = false, essais = 0;

    function status() {
      if (!handlers.onStatus) return;
      handlers.onStatus.apply(null, Array.prototype.slice.call(arguments));
    }

    async function abonner() {
      var problemes = [];
      for (var i = 0; i < topics.length; i++) {
        var t = topics[i];
        try {
          await helix('/eventsub/subscriptions', {
            method: 'POST',
            body: {
              type: t.type, version: t.version, condition: t.condition,
              transport: { method: 'websocket', session_id: sessionId }
            }
          });
        } catch (e) {
          if (e.status === 409) continue; /* déjà abonné : normal */
          problemes.push(t.type + ' : ' + e.message);
        }
      }
      status('ready', problemes.length ? problemes.join(' · ') : null);
    }

    function ouvrir(url) {
      ws = new WebSocket(url || 'wss://eventsub.wss.twitch.tv:443');
      ws.onmessage = function (m) {
        var msg;
        try { msg = JSON.parse(m.data); } catch (e) { return; }
        var t = msg.metadata && msg.metadata.message_type;
        if (t === 'session_welcome') {
          sessionId = msg.payload.session.id;
          essais = 0;
          abonner().catch(function (e) { status('error', e.message); });
        } else if (t === 'notification') {
          if (handlers.onEvent) handlers.onEvent(msg.payload.event, msg.metadata.subscription_type);
        } else if (t === 'session_reconnect') {
          var u = msg.payload.session.reconnect_url;
          try { ws.onclose = null; ws.close(); } catch (e) {}
          ouvrir(u);
        } else if (t === 'revocation') {
          status('revoked', msg.payload.subscription && msg.payload.subscription.type);
        }
        /* session_keepalive / pong : rien à faire */
      };
      ws.onclose = function () {
        if (stopped) return;
        essais++;
        status('reconnecting', 'tentative ' + essais);
        setTimeout(function () { ouvrir(); }, Math.min(1000 * essais, 15000));
      };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }

    status('connecting');
    ouvrir();
    return {
      stop: function () {
        stopped = true;
        try { ws.onclose = null; ws.close(); } catch (e) {}
      }
    };
  }

  /* ---------- badges démo / debug ---------- */
  function demoBadge() {
    if (document.querySelector('.ovt-badge.demo')) return;
    var b = document.createElement('div');
    b.className = 'ovt-badge demo';
    b.textContent = "MODE DÉMO — contenu d'exemple, jamais affiché en direct";
    document.body.appendChild(b);
  }

  function debugBadge(msg) {
    var b = document.querySelector('.ovt-badge.debug');
    if (!b) {
      b = document.createElement('div');
      b.className = 'ovt-badge debug';
      document.body.appendChild(b);
    }
    b.textContent = 'DEBUG · ' + msg;
  }

  /* ---------- export ---------- */
  window.OVT = {
    Q: Q, store: store, settings: settings,
    DEMO: DEMO, DEBUG: DEBUG,
    helix: helix, validate: validate, me: me, userById: userById,
    eventsub: eventsub, demoBadge: demoBadge, debugBadge: debugBadge
  };
})();
