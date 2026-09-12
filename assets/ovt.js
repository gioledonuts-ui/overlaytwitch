/* ============================================================
   OVT — bibliothèque commune des overlays Twitch
   Gère : réglages, token, appels API Helix, EventSub WebSocket,
   chat en lecture seule, texte partagé (panneau ↔ widgets),
   badges démo / debug.

   Priorité des réglages : paramètres d'URL > panneau (stockage
   local, partagé si tu utilises le dock OBS) > valeurs par défaut.

   Correctifs par rapport à l'ancienne version :
   - un abonnement mort (page OBS rafraîchie) est supprimé puis
     recréé au lieu d'être ignoré (l'ancien code l'ignorait → le
     widget restait muet) ;
   - surveillance du keepalive : reconnexion automatique si le
     serveur devient silencieux ;
   - l'objectif followers n'ouvre plus de 2ᵉ abonnement « follow »
     (il polle l'API) → plus de conflit avec « Dernier follower » ;
   - limite respectée : 3 connexions temps réel max par compte
     (texte + dernier follower + derniers événements = 3).
   ============================================================ */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);

  /* ---------- stockage local (préfixe ovt_) ---------- */
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

  /* ---------- réglages ---------- */
  var DEFAUTS = {
    duree: 12,          /* durée d'affichage du texte (s), 0 = jusqu'au remplacement */
    reward: '',         /* nom exact de la récompense à écouter, '' = toutes avec texte */
    objectif: 0,        /* objectif followers, 0 = widget masqué */
    canal: '',          /* chaîne suivie, '' = ton compte connecté */
    commande: '!texte', /* commande chat pour le widget texte */
    toutLeMonde: false, /* qui peut utiliser la commande (sinon : toi + modos) */
    sources: { manuel: true, chat: true, points: true },
    evenements: { sub: true, bits: true, raid: true, max: 5, dureeVie: 0 }
  };

  function merge(base, extra) {
    if (extra === undefined || extra === null) return base;
    if (Array.isArray(base) || Array.isArray(extra) ||
        typeof base !== 'object' || base === null ||
        typeof extra !== 'object' || extra === null) return extra;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(extra).forEach(function (k) { out[k] = merge(base[k], extra[k]); });
    return out;
  }

  function clampInt(v, min, max, defaut) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return defaut;
    return Math.max(min, Math.min(max, n));
  }

  /* Réglages effectifs, recalculés à la demande (permet de changer
     un réglage dans le dock et de le voir appliqué en direct).     */
  function reglages() {
    var r = merge(DEFAUTS, store.get('reglages', {}));
    /* paramètres d'URL = priorité maximale (URL « complète » du panneau) */
    if (Q.has('duree')) r.duree = clampInt(Q.get('duree'), 0, 86400, r.duree);
    if (Q.has('reward') || Q.has('recompense')) r.reward = Q.get('reward') || Q.get('recompense') || '';
    if (Q.has('objectif') || Q.has('cible') || Q.has('goal')) {
      r.objectif = clampInt(Q.get('objectif') || Q.get('cible') || Q.get('goal'), 0, 100000000, 0);
    }
    if (Q.has('channel') || Q.has('canal')) r.canal = (Q.get('channel') || Q.get('canal') || '').toLowerCase();
    if (Q.has('commande')) r.commande = Q.get('commande') || '!texte';
    if (Q.has('tout_le_monde')) r.toutLeMonde = Q.get('tout_le_monde') === '1';
    ['manuel', 'chat', 'points'].forEach(function (s) {
      if (Q.has('src_' + s)) r.sources[s] = Q.get('src_' + s) === '1';
    });
    if (Q.has('ev_max')) r.evenements.max = clampInt(Q.get('ev_max'), 1, 10, r.evenements.max);
    if (Q.has('ev_vie')) r.evenements.dureeVie = clampInt(Q.get('ev_vie'), 0, 86400, r.evenements.dureeVie);
    ['sub', 'bits', 'raid'].forEach(function (t) {
      if (Q.has('ev_' + t)) r.evenements[t] = Q.get('ev_' + t) === '1';
    });
    r.clientId = Q.get('client_id') || store.get('clientId', '') || '';
    r.token = Q.get('token') || store.get('token', '') || '';
    return r;
  }

  /* compatibilité : instantané des réglages au chargement */
  var settings = reglages();

  /* ---------- mode démo / debug ---------- */
  var DEMO = Q.get('demo') === '1';
  var DEBUG = Q.get('debug') === '1';

  /* ---------- échelle (?scale=1.5) ---------- */
  function echelle() {
    var s = parseFloat(Q.get('scale') || '1');
    if (isFinite(s) && s >= 0.2 && s <= 4) {
      document.documentElement.style.fontSize = (16 * s) + 'px';
    }
  }

  /* ---------- erreurs ---------- */
  function err(status, message) { var e = new Error(message); e.status = status; return e; }

  /* ---------- appels à l'API Helix ---------- */
  async function helix(path, opts) {
    opts = opts || {};
    var r = reglages();
    if (!r.clientId) throw err(0, 'Client ID manquant (à définir sur le panneau)');
    if (!r.token) throw err(401, 'Token manquant — reconnecte-toi depuis le panneau');
    var res = await fetch('https://api.twitch.tv/helix' + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        { 'Client-Id': r.clientId, 'Authorization': 'Bearer ' + r.token },
        opts.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401) throw err(401, 'Token expiré ou invalide — reconnecte-toi depuis le panneau');
    if (!res.ok) {
      var msg = 'HTTP ' + res.status;
      try { var j = await res.json(); if (j && j.message) msg = j.message; } catch (e) {}
      throw err(res.status, msg);
    }
    return res.json();
  }

  /* ---------- validation du token (expire dans : nb de jours) ---------- */
  async function validate() {
    var r = reglages();
    var res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': 'OAuth ' + r.token }
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
    if (c && Date.now() - c.t < 86400000) return c.u; /* cache 24 h */
    var d = await helix('/users?id=' + encodeURIComponent(id));
    var u = d.data && d.data[0];
    if (u) { cache[id] = { t: Date.now(), u: u }; store.set('users', cache); }
    return u || null;
  }

  /* ---------- canal suivi (?channel= > réglage > compte connecté) ---------- */
  async function canal() {
    var r = reglages();
    var login = (r.canal || '').toLowerCase().trim();
    if (login) {
      var id = null;
      if (r.token) {
        try { id = await idDeCanal(login); } catch (e) { console.warn('OVT.canal :', e.message); }
      }
      return { login: login, id: id };
    }
    if (r.token) {
      var moi = await me();
      return { login: moi.login, id: moi.id };
    }
    return { login: '', id: null };
  }

  var cacheCanal = {};
  async function idDeCanal(login) {
    if (cacheCanal[login]) return cacheCanal[login];
    var d = await helix('/users?login=' + encodeURIComponent(login));
    var u = d.data && d.data[0];
    if (!u) throw err(0, 'Chaîne « ' + login + ' » introuvable');
    cacheCanal[login] = u.id;
    return u.id;
  }

  /* ---------- EventSub WebSocket (temps réel) ----------
     topics : [{ type, version, condition }]
     handlers : { onEvent(événement, type), onStatus(état, info) } */
  function eventsub(topics, handlers) {
    handlers = handlers || {};
    var ws = null, sessionId = null, stopped = false, essais = 0;
    var delaiKA = 10, minuteurKA = null;

    function status() {
      if (handlers.onStatus) {
        handlers.onStatus.apply(null, Array.prototype.slice.call(arguments));
      }
    }

    function armerKA() {
      clearTimeout(minuteurKA);
      minuteurKA = setTimeout(function () {
        console.warn('OVT.eventsub : silence prolongé, reconnexion…');
        try { if (ws) ws.close(); } catch (e) {}
      }, (delaiKA + 15) * 1000);
    }

    /* supprime un vieil abonnement identique lié à une session morte
       (page OBS rafraîchie, OBS redémarré…) pour pouvoir recréer */
    async function nettoyerDoublon(t, cond) {
      try {
        var apres = null;
        do {
          var q = new URLSearchParams({ type: t.type, version: t.version });
          if (apres) q.set('after', apres);
          var j = await helix('/eventsub/subscriptions?' + q.toString());
          (j.data || []).forEach(function (sub) {
            var meme = Object.keys(cond).every(function (k) {
              return String(sub.condition[k]) === String(cond[k]);
            });
            var autreSession = !sub.transport || sub.transport.session_id !== sessionId;
            if (meme && autreSession) {
              helix('/eventsub/subscriptions?id=' + encodeURIComponent(sub.id), { method: 'DELETE' })
                .catch(function () {});
            }
          });
          apres = (j.pagination && j.pagination.cursor) || null;
        } while (apres);
      } catch (e) { console.warn('OVT.eventsub nettoyage :', e.message); }
    }

    async function abonnerUn(t) {
      var corps = {
        type: t.type, version: t.version, condition: t.condition,
        transport: { method: 'websocket', session_id: sessionId }
      };
      var envoyer = function () {
        return helix('/eventsub/subscriptions', { method: 'POST', body: corps });
      };
      try {
        await envoyer();
      } catch (e) {
        if (e.status === 409) {           /* déjà abonné (session morte) */
          await nettoyerDoublon(t, t.condition);
          await envoyer();                 /* une seule retente */
        } else if (e.status === 429) {
          throw err(429, 'Limite Twitch atteinte (3 connexions temps réel max par compte) — une seule source par widget');
        } else {
          throw e;
        }
      }
    }

    async function abonner() {
      var problemes = [];
      for (var i = 0; i < topics.length; i++) {
        try { await abonnerUn(topics[i]); }
        catch (e) {
          if (e.status === 401 || e.status === 0) { status('error', e.message); return; }
          problemes.push(e.message);
        }
      }
      status('ready', problemes.length ? problemes.join(' · ') : null);
    }

    function ouvrir(url, reprise) {
      var socket = ws = new WebSocket(url || 'wss://eventsub.wss.twitch.tv:443/ws');

      socket.onmessage = async function (m) {
        var msg;
        try { msg = JSON.parse(m.data); } catch (e) { return; }
        var t = msg.metadata && msg.metadata.message_type;

        if (t === 'session_welcome') {
          sessionId = msg.payload.session.id;
          delaiKA = msg.payload.session.keepalive_timeout_seconds || 10;
          essais = 0;
          armerKA();
          status('connecte');
          if (!reprise) abonner().catch(function (e) { status('error', e.message); });
          /* une reconnexion via reconnect_url garde ses abonnements */

        } else if (t === 'notification') {
          armerKA();
          if (handlers.onEvent) handlers.onEvent(msg.payload.event, msg.metadata.subscription_type);

        } else if (t === 'session_keepalive') {
          armerKA();

        } else if (t === 'session_reconnect') {
          status('bascule');
          ouvrir(msg.payload.session.reconnect_url, true);
          setTimeout(function () {
            try { socket.remplace = true; socket.close(); } catch (e) {}
          }, 3000);

        } else if (t === 'revocation') {
          status('revoked', msg.payload.subscription && msg.payload.subscription.type);
        }
      };

      socket.onclose = function (e) {
        if (socket !== ws) return;         /* une socket remplacée part en silence */
        clearTimeout(minuteurKA);
        if (stopped) return;
        essais++;
        status('reconnecting', 'tentative ' + essais + (e && e.code ? ' (code ' + e.code + ')' : ''));
        setTimeout(function () { ouvrir(null, false); }, Math.min(1000 * Math.pow(2, essais), 30000));
      };

      socket.onerror = function () { /* géré par onclose */ };
    }

    status('connecting');
    ouvrir(null, false);

    return {
      stop: function () {
        stopped = true;
        try { if (ws) ws.close(); } catch (e) {}
      }
    };
  }

  /* ---------- chat IRC en lecture seule (anonyme, sans token) ----------
     Sert à la commande du widget texte (!texte …). */
  function chat(canalLogin, surMessage, surEtat) {
    var ws = null, stopped = false, essais = 0;

    function etat(s) { if (surEtat) surEtat(s); }

    function envoyer(l) {
      try { if (ws && ws.readyState === 1) ws.send(l); } catch (e) {}
    }

    function traiter(ligne) {
      if (!ligne) return;
      if (ligne.indexOf('PING') === 0) { envoyer('PONG' + ligne.slice(4)); return; }
      if (/^001 /.test(ligne)) { envoyer('JOIN #' + canalLogin); etat('connecte'); return; }
      var m = ligne.match(/^@([^ ]+) :([^!\s]+)![^ ]+ PRIVMSG #\S+ :([\s\S]*)$/);
      if (!m) return;

      var tags = {};
      m[1].split(';').forEach(function (paire) {
        var i = paire.indexOf('=');
        if (i > 0) tags[paire.slice(0, i)] = paire.slice(i + 1);
      });

      var texte = m[3];
      if (texte.indexOf('\x01ACTION ') === 0) texte = texte.slice(8).replace(/\x01$/, '');

      surMessage({
        login: m[2].toLowerCase(),
        nom: tags['display-name'] || m[2],
        badges: tags['badges'] || '',
        modero: /(^|,)(broadcaster|moderator)\//.test(tags['badges'] || ''),
        texte: texte.replace(/[\r\n\s]+$/, '')
      });
    }

    function ouvrir() {
      ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      ws.onopen = function () {
        ws.send('CAP REQ :twitch.tv/tags');
        ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 89999));
      };
      ws.onmessage = function (e) {
        String(e.data).split(/\r\n/).forEach(traiter);
      };
      ws.onclose = function () {
        if (stopped) return;
        essais++;
        etat('reconnecting');
        setTimeout(ouvrir, Math.min(1000 * Math.pow(2, essais), 30000));
      };
      ws.onerror = function () { /* géré par onclose */ };
    }

    ouvrir();

    return {
      stop: function () { stopped = true; try { if (ws) ws.close(); } catch (e) {} }
    };
  }

  /* ---------- texte manuel partagé (panneau / dock ↔ widget) ---------- */
  function ecrireTexte(valeur) {
    store.set('texte', { valeur: valeur || '', le: Date.now() });
    /* l'évènement `storage` ne se déclenche pas dans la page qui écrit */
    window.dispatchEvent(new CustomEvent('ovt-texte', { detail: valeur || '' }));
  }
  function lireTexte() {
    var t = store.get('texte', null);
    return t ? String(t.valeur || '') : '';
  }
  function surveillerTexte(cb) {
    window.addEventListener('storage', function (e) {
      if (e.key === 'ovt_texte') cb(lireTexte());
    });
    window.addEventListener('ovt-texte', function (e) { cb(String(e.detail || '')); });
    var dernier = localStorage.getItem('ovt_texte');
    setInterval(function () {
      var c = localStorage.getItem('ovt_texte');
      if (c !== dernier) { dernier = c; cb(lireTexte()); }
    }, 1000);
  }
  function surveillerReglages(cb) {
    window.addEventListener('storage', function (e) {
      if (e.key === 'ovt_reglages') cb();
    });
    var dernier = localStorage.getItem('ovt_reglages');
    setInterval(function () {
      var c = localStorage.getItem('ovt_reglages');
      if (c !== dernier) { dernier = c; cb(); }
    }, 1000);
  }

  /* ---------- connexion partagée (dock) ----------
     Recharge la page quand la connexion apparaît / change / disparaît
     dans le stockage partagé. Avec le dock OBS : tu cliques « Se
     connecter » dans le dock et tous les widgets se reconnectent
     tout seuls (fini le token expiré au milieu d'un stream).       */
  function surveillerConnexion(cb) {
    window.addEventListener('storage', function (e) {
      if (e.key === 'ovt_token') cb();
    });
    var dernier = localStorage.getItem('ovt_token');
    setInterval(function () {
      var c = localStorage.getItem('ovt_token');
      if (c !== dernier) { dernier = c; cb(); }
    }, 1000);
  }
  function autoRecharge() {
    surveillerConnexion(function () { location.reload(); });
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

  /* ---------- apparition / disparition (règle d'or) ---------- */
  function on(el) { el.classList.add('on'); }
  function off(el) { el.classList.remove('on'); }

  /* ---------- export ---------- */
  window.OVT = {
    Q: Q, store: store, settings: settings, reglages: reglages,
    DEMO: DEMO, DEBUG: DEBUG,
    helix: helix, validate: validate, me: me, userById: userById,
    canal: canal, idDeCanal: idDeCanal,
    eventsub: eventsub, chat: chat,
    ecrireTexte: ecrireTexte, lireTexte: lireTexte,
    surveillerTexte: surveillerTexte, surveillerReglages: surveillerReglages,
    demoBadge: demoBadge, debugBadge: debugBadge,
    echelle: echelle, on: on, off: off
  };
})();
