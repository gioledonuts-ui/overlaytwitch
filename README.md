# 7GIONNY — Debate / Sondage Overlay

Widget **interactif** pour OBS Studio : débats et sondages en direct avec le chat Twitch.
DA : noir mat `#0A0A0A` · violet électrique `#7000FF / #9146FF` · blanc pur — lower-third sobre,
type plateau télé. **100 % transparent** quand aucun débat n'est en cours.

```
overlaytwitch/
├── widget.html          ← LA source OBS (widget, fond transparent)
├── server.js            ← pont local : SSE + votes + chat + /poll Twitch
├── sounds/              ← bruitages WAV rendus (impact, click, victory)
├── fonts/               ← Inter & Bebas Neue auto-hébergées (offline-safe)
├── api/                 ← endpoints pour l'hébergement Vercel (état sur KV)
├── tools/render-sounds.js ← re-rendu des sons (optionnel)
├── demarrer-pont.bat/.sh  ← 1 clic : démarre le pont
├── tester-debat.bat/.sh   ← 1 clic : débat de test 45 s
├── MIDJOURNEY_PROMPTS.md← prompts assets graphiques (même DA)
└── package.json         ← Node ≥ 18, deps : tmi.js (optionnel en pratique)
```

---

## 1. Démarrage (5 minutes)

```bash
npm install          # installe tmi.js (+ les polices fontsource)
node server.js
```

Le pont écoute sur le port **8321** :

| URL | Rôle |
|---|---|
| `http://localhost:8321/widget.html` | **Mode OBS** — transparent, connecté au pont |
| `http://localhost:8321/` | **Démo auto** — cycle complet (apparition → votes → résultat → sortie) + fond caméra simulé, pour valider la DA sans Twitch |
| `http://localhost:8321/api/state` | État courant (JSON) |
| `http://localhost:8321/events` | Flux SSE temps réel |

> Port occupé ? `PORT=8400 node server.js` (et `?ws=http://localhost:8400` côté widget si besoin).

---

## 2. Guide d'intégration OBS — pas à pas

### 2.1 Avant le live (test local)

1. `node server.js` (dans un terminal, **qui reste ouvert pendant le stream**).
2. Ouvre `http://localhost:8321/` dans ton navigateur → tu dois voir le widget
   apparaitre/s'envoler en boucle sur un fond simulé. **Aucune musique, seulement** :
   un impact de basse à l'apparition, des clicks discrets sur les changements de leader,
   une validation nette à la clôture.
3. Teste un vrai débat piloté par API (dans un autre terminal) :
   ```bash
   curl -X POST http://localhost:8321/api/debate \
     -H "Content-Type: application/json" \
     -d '{"question":"Test — ceci est une question","a":"Option A","b":"Option B","duration":60}'
   curl -X POST http://localhost:8321/api/vote -H "Content-Type: application/json" -d '{"choice":"A","user":"test1"}'
   curl -X POST http://localhost:8321/api/end
   ```
   Dans le navigateur, ouvre `http://localhost:8321/?bg=1` (pas de démo) : le débat
   doit apparaitre depuis le port. Tu peux cliquer sur les barres pour voter.

### 2.2 Ajout de la source dans OBS

1. **Sources → + → Navigateur** (*Browser*).
2. **URL** : `http://localhost:8321/widget.html`
3. **Largeur 1920 · Hauteur 1080** (la grille de calibrage exacte du widget).
4. ☑ **Contrôler l'audio via OBS** (*Control audio via OBS*) — indispensable :
   les bruitages du widget (impact, clicks, validation) sont alors gérés par le mixeur
   audio OBS comme n'importe quelle autre source (volume, monitoring, mute).
5. Laisse **CSS personnalisé** vide. Ferme.
6. La source doit être **par-dessus la caméra** (ordre des sources), dans une scène
   « Just Chatting / Débat ». Quand rien ne se passe : la source est **invisible** —
   ton image reste 100 % caméra.
7. **À chaque mise à jour du code** : clic droit sur la source OBS → **Actualiser**
   (le widget est servi sans cache : tu vois toujours la dernière version).

### 2.3 Vérification finale avant le live

- [ ] Source ajoutée, 1920×1080, audio contrôlé par OBS.
- [ ] Écran ne montre **que la caméra** (aucun artifact, pas de bordure).
- [ ] Lancer `!debate` (ou `curl` ci-dessus) → la carte monte en 650 ms, impact de basse audible dans le moniteur.
- [ ] `!vote A` / `!vote B` → barres animées, pourcentages qui somment à 100 %, timer qui tourne.
- - [ ] `!end` ou fin du timer → le gagnant pulse, 5 s de sentence, validation nette, la carte descend et disparaît.
- [ ] Après sortie : retour caméra nue, sans résidu.
- [ ] Si le son ne passe pas : voir §5 (autoplay).

---

## 3. Commandes chat

| Commande | Qui | Effet |
|---|---|---|
| `!debate Question \| Choix A \| Choix B \| 120` | streamer + mods | Lance un débat (durée en secondes, défaut 120, max 600) |
| `voiture` (le mot attendu, sans commande) | tout le monde | **Vote fluide** : écrire simplement le mot suffit, insensible à la casse (`Voiture` = `VOITURE` = `voiture`) — 1 seule voix par personne et par débat (le 1er vote compte, les suivants sont ignorés) |
| `!vote A` / `!vote B` (ou `A` / `B` / `1` / `2` seuls) | tout le monde | Vote classique (toujours supporté, même règle anti-doublon) |
| `!end` | streamer + mods | Clôture et affiche le résultat |

> Le mot à taper s'affiche en bas de la carte dans OBS (ex. `TAPEZ « voiture » OU « vélo »`).
> Un débat se lance aussi depuis le panneau de contrôle (`/panneau`), sans passer par Twitch.

Exemple :
```
!debate Le format court a-t-il tué la culture ? | Oui, tout s'accélère | Non, l'accès s'élargit | 180
```

Activation du chat dans `server.js` — variables d'environnement :

```bash
export CHAT_NICK="ton_compte_bot"                     # un compte second recommandé
export CHAT_OAUTH="oauth:xxxxxxxx"                    # token du bot (Twitch → Connexion → Connect to Developer → GetMyp Token / ou client id + secret)
node server.js
```

> Pas de bot ? Utilise `curl`/l'API HTTP (§2.1) ou un petit outil de commandes
> (Nightbot/StreamElements) en action HTTP POST vers `http://localhost:8321/api/debate`.

### Capture des sondages natifs `/poll`

Lance simplement `/poll Question A B` depuis tes outils Twitch : le pont détecte
le sondage via l'API Helix (toutes les 2,5 s) et affiche les **2 premiers choix**.
Résultat final récupéré quand Twitch clôt. Nécessite :

```bash
export CLIENT_ID="client_id_application"
export BROADCASTER_ID="id_canal"
export POLL_OAUTH="oauth:token_utilisateur"   # scope channel:read:polls
```

> Les sondages à plus de 2 choix sont ignorés (console). Le widget est calibré A vs B.

---

## 4. API HTTP (automatisations, panel streamdeck, etc.)

| Méthode | Route | Body | Rôle |
|---|---|---|---|
| GET | `/api/state` | — | État courant |
| GET | `/events` | — | SSE temps réel |
| POST | `/api/debate` | `{question, a, b, duration?}` | Lance un débat |
| POST | `/api/vote` | `{choice:"A"\|"B", user}` ou `{text:"voiture", user}` | Vote (1 seul par user, les suivants ignorés ; `text` = vote fluide par mot) |
| GET | `/api/version` | — | Version installée, dernière MAJ, dernière version dispo, historique |
| POST | `/api/end` | — | Clôture |

`ADMIN_TOKEN` (env) : si défini, `/api/debate` et `/api/end` exigent l'en-tête `X-Admin-Token`.

---

## 5. Audio — fonctionnement & états d'esprit

**Aucune musique, aucun instrument, aucun jingle.** Les sons sont des **bruitages
rendus en WAV** (fichiers `sounds/`, générés localement par `tools/render-sounds.js`
→ zéro asset externe, zéro droit d'auteur), lus en **HTML Audio**.

**Actuellement seul le TIC-TAC est actif** (ton choix). L'impact d'apparition, le click
de leader et le son de validation sont désactivés dans le widget (constante `SFX` en
tête du JS — remets un `true` pour les réactiver, tout est en place) :

| Fichier | Moment | Description |
|---|---|---|
| `impact.wav` (1.7 s) | Apparition du débat | sub-bass drop cinématique 62→30 Hz, corps 45 Hz, saturation, léger espace — « punch » de plateau télé |
| `click.wav` (0.3 s) | Changement de leader | tic mécanique sec (hautes fréquences), très discret |
| `clock.wav` (1 s, boucle) | **Dès le début, tout le long du débat** | **tic-tac de chrono** discret (volume 0.22, monté à 0.30 dans les 15 dernières s) — **s'accélère progressivement dans les 5 dernières secondes** (jusqu'à ~2,5×), s'arrête à la clôture |
| `victory.wav` (1.5 s) | Clôture / sentence | **mise en avant du gagnant** : tampon grave d'autorité + note de validation claire (une seule note + partiels, non mélodique) |

- En cas de blocage autoplay persistant, le widget bascule sur un repli synthétique
  discret (Web Audio) — le flux n'est jamais interrompu.
- Regénérer les sons (optionnel) : `node tools/render-sounds.js`

- Le mix est géré par OBS via **Contrôler l'audio via OBS** (volume dédié, monitoring).
- `?mute=1` dans l'URL de la source si tu veux le widget sans son.
- Si un navigateur/OBS bloque l'autoplay Web Audio (rare sur les builds récents d'OBS) :
  le widget se tait proprement sans erreur ; au besoin, relance OBS avec l'argument
  `--autoplay-policy=no-user-gesture-required` (raccourci → cible).

---

## 6. Le chat Twitch (panneau gauche)

Panneau **460 × 640 px**, à **droite**, **bottom 160 px** (la carte du débat reste
centrée — aucun chevauchement, marge de 12 px conservée). **~50 % transparent** (flou 12 px en dessous : on voit
la caméra à travers), bordure 1 px, coins 12 px, pastille violet pulsée.

- **En démo** (`/`) : un **chat fictif** tourne en boucle pour te laisser juger le rendu
  (messages liés aux débats, **emojis**, rythme réaliste 1,5–3,5 s).
- **En live** : le **vrai chat Twitch** s'affiche au même endroit, message par message,
  dés que le bot est branché sur le pont :
  ```bash
  export CHAT_NICK="ton_compte_bot"
  export CHAT_OAUTH="oauth:xxxxxxxx"
  node server.js
  ```
- **Rôles visuels** (couleur du pseudo) : streamer = **blanc**, mod = **violet**,
  spectateur = **couleur vive et stable par pseudo** (palette de 8 teintes).
  Police **18 px** bien lisible + stack d'emojis système (Segoe UI Emoji / Noto Color Emoji)
  pour des **emojis lisibles**. 10 messages visibles, les plus anciens s'estompent,
  arrivée animée (slide-up 350 ms). Badges 20 px, emotes 26 px, réponses 13 px.
- **Badges Twitch officiels** (sub + palier, mod, VIP, staff, team…) : lus depuis les
  tags IRC du message et rendus via `static-cdn.jtvnw.net` ; si l'image ne charge pas,
  une **chip texte** prend le relais (SUB 2, MOD, VIP, STAFF…). Avec ton compte branché,
  ce sont **les vrais badges de ton chat** qui s'affichent automatiquement.
- **Message MIS EN AVANT** (highlight Twitch) : encart **violet**, en avant dans le flux.
- **Message ÉPINGLÉ** : il apparaît **en haut du chat**, style **blanc**, un cran plus
  gros (pseudo 20 px / texte 18 px), avec 📌 — apparaît quand tu épingle sur Twitch (détecté via les notices IRC) ou
  via `POST /api/pin {"user":"…","msg":"…"}` / `{"clear":true}` pour le retirer.
  Style volontairement différent du highlight violet.
- **Réponses à message** (thread) : faisable — le tag IRC `reply-parent-display-name`
  est lu et le message s'affiche avec **`↪ @pseudo`** au-dessus du texte : on voit
  d'un coup d'œil que le chatteur répond à quelqu'un et pas au streamer.
- **Emotes & GIFs animés** : les emotes du message sont tokenisées et rendues comme
  images animées (Kreygasm, CatJAM, etc.) ; les **URLs .gif / .webp brutes** dans un
  message s'affichent aussi inline (exemples dans la démo, dont un GIF local servi par
  le pont sur `/demo/gif-demo.gif`).
- **Liste pleine hauteur** : 10 messages visibles, ils remplissent tout le panneau ;
  la **disparition progressive se fait en HAUT** (fondu 64 px) là où les messages
  sortent — rendu propre, pas d'espace mort.
- **Typographie** : pseudo en **Outfit 700 19px** (max-width 170, mis en avant, lisible) + texte en **Inter 500 18px** line-height 1.5 (lisibilité maximale). Titre du chat en Bebas 18px. Sub-goal label + compteur en Outfit 800 18px, barre 10px.
- **SUB GOAL** (rallonge sous le chat, séparateur propre) : label, nombre actuel /
  objectif et barre de progression, personnalisable **à tout moment** :
  1. `POST /api/goal {"current":48,"target":60,"label":"SUB GOAL"}` (panel, script, Stream Deck…)
  2. Env au démarrage du pont : `SUB_GOAL_LABEL` / `SUB_GOAL_CURRENT` / `SUB_GOAL_TARGET`
  3. Plus tard : branchement API Twitch (liste des subs de la chaîne) → le compteur
     suit automatiquement les sub/gagnés et perdus.
- En-tête du panneau : **« CHAT DE 7GIONNY »**.
- **Monogramme 7G** : signature discrète (petit carré violet, Bebas) présente sur les
  3 zones — carte de débat (haut-gauche), chat (haut-droit de l'en-tête)
  — l'élément fédérateur de l'identité.
- Test sans bot (badges, highlight, réponse, pin, goal) :
  ```bash
  curl -X POST localhost:8321/api/chat -H "Content-Type: application/json" \
    -d '{"user":"kevin","msg":"je vote A","badges":{"subscriber":{"version":2}},"highlight":true,"replyTo":"maeva"}'
  curl -X POST localhost:8321/api/pin -H "Content-Type: application/json" \
    -d '{"user":"7GIONNY","role":"me","msg":"Le débat commence dans 1 minute"}'
  curl -X POST localhost:8321/api/pin -H "Content-Type: application/json" -d '{"clear":true}'
  curl -X POST localhost:8321/api/goal -H "Content-Type: application/json" \
    -d '{"current":48,"target":60,"label":"SUB GOAL"}'
  ```
- Le chat réel est diffusé via le pont (SSE) → **fonctionne en local** (pas sur Vercel,
  qui ne peut pas maintenir une connexion IRC).
- Pas besoin de bot ? Le widget reste invisible côté chat tant qu'aucun message n'arrive
  (la règle du 100 % propre est respectée).

## 7. Hébergement Vercel (optionnel — état distant, pas de Node local)

Si tu ne veux pas lancer `node server.js` à chaque stream, le widget peut tourner
**entièrement en ligne** sur Vercel. L'état du débat vit alors dans un KV Upstash
(gratuit), et le widget le consulte par polling (1 s).

**Ce qui marche sur Vercel** : widget, API (`/api/debate`, `/api/vote`, `/api/end`,
`/api/state`), sons, polices. **Ce qui reste local** : le bot chat (`!debate`/`!vote`)
et la capture des `/poll` natifs (il faut un serveur qui tourne en permanence).

### Étapes

1. **Upstash** → https://upstash.com → console → *Create database* (KV, plan Free)
   → copier **REST URL** et **REST Token**.
2. **Vercel** → https://vercel.com → *Add New → Project* → importer le repo GitHub
   → Framework **Other** → Deploy.
3. Vercel → projet → *Settings → Environment Variables* → ajouter :
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   → le projet se redéploye tout seul.
4. **OBS** → Source Navigateur → URL :
   `https://ton-projet.vercel.app/widget.html?poll=1` (1920×1080, audio via OBS).
5. Lancer un débat depuis n'importe où (PC, téléphone, panel) :
   ```bash
   curl -X POST https://ton-projet.vercel.app/api/debate \
     -H "Content-Type: application/json" \
     -d '{"question":"Question ?","a":"Choix A","b":"Choix B","duration":120}'
   ```
   → action HTTP de Nightbot/StreamElements, ou une URL de raccourci sur téléphone.

**Recos** : pour un live, le **pont local reste le meilleur choix** (latence ~0,
aucun quota, chat + /poll inclus). Vercel = idéale pour déclencher des débats à
distance ou en secours. Budget KV Free : 100 000 lectures/jour ≈ 1 widget en polling 1 s.

---

## 8. Calibration & DA — rappel des valeurs

- Scène de référence : **1920×1080**, carte **880×272 px** (lisible, 880×272), centrée, **bottom 96 px**
  (tiers inférieur ; ta face au centre n'est jamais masquée). Chat **460×640 px**, bottom 160 px, marge 12 px avec la carte.
- Couleurs : `#0A0A0A` · `#7000FF` · `#9146FF` · `#FFFFFF` · gris neutres `#9AA0A6 / #6B7280`.
- Bordures 1 px, coins 12 px, glassmorphism sombre `blur(18px)` — aucun décor superflu
  (aucun filet / dégradé en haut de carte : le bord supérieur est propre).
- Typos : **Bebas Neue** (question 46px, timer 28px, pourcentages 30px, chip 14px) · **Outfit** (labels 700 16px, badges A/B 20px, tag GAGNANT 9px, pseudos chat 700 19px, sub-goal 800 18px, pied 600 12.5px .14em) · **Inter** (messages 500 18px line-height 1.5).
- Grille options : **200/1fr/76** (label/barre/%), barres **12px**, badges A/B **20px**, emotes chat **26px**, badges chat **20px**, réponses **13px**, épinglé pseudo **20px** / texte **18px**.
- Animations : entrée `650 ms` expo-out (slide-up 46 px), barres `700 ms`, sortie `420 ms` ease-in.
- Sentence : 5 s, gagnant en pulse sobre (violet ou blanc selon le choix), badge **GAGNANT**,
  perdant à 30 % d'opacité.
- **Contraste avance / recul** : à chaque vote, la barre qui **gagne s'illumine**
  (flash violet ou blanc, pourcentage qui « pop ») et celle qui **perd s'éteint**
  (baisse de luminosité, ~550 ms) — le sens du match se lit d'un coup d'œil, en continu.
- **Sensation du temps** : barre de décompte 3 px en bas de carte (se vide de 100 % → 0,
  vire au violet lumineux dans les 15 dernières secondes, **pulse dans les 5 dernières**)
  + deux-points du chrono qui pulsent chaque seconde + chrono violet au sprint final.
- **Tic-tac** de chrono discret en arrière-plan dès le début du débat, **accéléré dans
  les 5 dernières secondes** (voir §5).
- **Lecture des options** : badges **A** (violet) / **B** (blanc) — ancre visuelle et
  rappel de la commande chat ; total des votes à **droite, sous les pourcentages**,
  commande **centrée**.
- Question **centrée**, une seule ligne (Bebas Neue 46 px), 10 messages max dans le chat.

Pour recaler la position : modifie `bottom:96px` (ou `width:880px`) en tête du CSS de `widget.html`.
