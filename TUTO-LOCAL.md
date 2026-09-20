# 🎮 TUTO LOCAL — Overlay débat/sondage 7GIONNY

Suis ce tuto **dans l'ordre, sans sauter d'étape**. Tout est gratuit, rien de compliqué.
À la fin, ton overlay tourne dans OBS avec le son, le chat et les sondages.

> ⏱️ Première fois : ~15 minutes. Ensuite, à chaque stream : ~30 secondes (étape 4 + 5).

---

## 📦 Ce dont tu as besoin

| Outil | Pour quoi | Obligatoire ? |
|---|---|---|
| **Node.js** (LTS) | Faire tourner le "pont" (le mini-serveur) | ✅ Oui |
| **OBS Studio** | Afficher l'overlay sur ton stream | ✅ Oui |
| **Le dossier du projet** | Ton overlay (les fichiers) | ✅ Oui |
| Un compte Twitch secondaire (optionnel) | Le **chat en direct** dans l'overlay | 🔸 Plus tard |

---

## ÉTAPE 1 — Installer Node.js (une seule fois)

1. Va sur **https://nodejs.org**
2. Clique sur le bouton vert **« LTS »** (Long Term Support).
3. Télécharge l'installateur, puis **double-clic** dessus.
4. Clique **« Next »** partout (garde les réglages par défaut) → **« Install »** → **« Finish »**.

> ✅ Pour vérifier que c'est bon : ouvre le menu Démarrer, tape `cmd`, appuie sur Entrée,
> puis tape `node -v`. Si un numéro s'affiche (ex. `v20.11.0`), c'est bon.

---

## ÉTAPE 2 — Télécharger ton overlay (une seule fois)

1. Va sur **https://github.com/gioledonuts-ui/overlaytwitch**
2. Clique sur le bouton vert **« Code »** → **« Download ZIP »**.
3. Le fichier `overlaytwitch-main.zip` se télécharge.
4. **Extrais-le** (clic droit → « Extraire tout… ») où tu veux, par exemple dans **Documents**.
5. Tu obtiens un dossier **`overlaytwitch-main`** — garde-le, c'est ton overlay.

> 💡 Tu peux renommer ce dossier comme tu veux (ex. `overlay-7gionny`).

---

## ÉTAPE 3 — Premier lancement (une seule fois)

Dans le dossier `overlaytwitch-main`, tu vois un fichier **`demarrer-pont.bat`**.

1. **Double-clic sur `demarrer-pont.bat`**.
2. La première fois, il installe tout seul les dépendances (ça peut prendre 1 min).
3. À la fin, une **fenêtre noire** s'ouvre et affiche :

```
7GIONNY · Debate Overlay — pont local
OBS  →  http://localhost:8321/widget.html
Démo →  http://localhost:8321/
```

4. ⚠️ **NE FERME PAS cette fenêtre.** C'est elle qui fait tourner l'overlay.

> 👀 Envie de voir le résultat tout de suite ? Ouvre ton navigateur et va sur
> **http://localhost:8321/** → tu vois une démo automatique (débat + chat fictif).

---

## ÉTAPE 4 — À chaque stream (30 secondes)

1. **Double-clic sur `demarrer-pont.bat`**.
2. Laisse la fenêtre noire **ouverte** pendant tout ton stream.

C'est tout. La suite (OBS) ne se refait pas à chaque fois.

---

## ÉTAPE 5 — Ajouter l'overlay dans OBS (une seule fois)

1. Ouvre **OBS**.
2. Dans la scène où tu veux l'overlay : **Sources → + → Navigateur** (*Browser*).
3. Donne un nom, ex. `Overlay débat` → **OK**.
4. Dans **URL**, colle exactement :
   ```
   http://localhost:8321/widget.html
   ```
5. **Largeur : `1920` · Hauteur : `1080`**.
6. ☑ Coche **« Contrôler l'audio via OBS »** ← indispensable pour le son.
7. Laisse **CSS personnalisé** vide → **OK**.
8. Place la source **au-dessus de ta caméra** (elle est invisible tant qu'il n'y a pas de débat).

---

## ÉTAPE 6 — 🎧 T'entendre dans ton casque (une seule fois)

1. Dans OBS, en bas, ouvre le **Mixeur audio**.
2. Cherche la ligne **« Overlay débat »** (ta source navigateur).
3. Clique sur la **roue dentée ⚙️** → **« Filtres audio avancés »** (ou *Propriétés audio*).
4. Mets **« Monitoring audio »** sur **« Moniteur et sortie »**.

> Résultat : tu entends les bruitages (impact, clicks, validation, tic-tac) **dans ton
> casque ET** ils partent au stream. Tu n'es plus "mute".

---

## ÉTAPE 7 — Tester que tout marche

Pendant que `demarrer-pont.bat` tourne :

1. **Double-clic sur `tester-debat.bat`** (dans le dossier).
2. Il lance un débat de test de 45 s avec des faux votes.
3. Regarde OBS : la carte monte en bas de l'écran, les barres bougent, puis le gagnant
   apparaît et tout disparaît. Tu entends le tic-tac, les clicks et la validation.

> ✅ Si tu vois ça : ton overlay est **prêt pour le live**.

---

## 🎤 Lancer un débat en live

Pendant ton stream, avec le pont ouvert :

- **Démarrer** : dans ton chat Twitch, tape :
  ```
  !debate Le format court a-t-il tué la culture ? | Oui, tout s'accélère | Non, l'accès s'élargit | 180
  ```
  *(question | choix A | choix B | durée en secondes)*
- **Voter** : tes viewers tapent `!vote A` ou `!vote B` (1 voix par personne).
- **Clôturer** : tape `!end` (ou attends la fin du timer).

---

## 💬 (Optionnel) Activer le vrai chat Twitch dans l'overlay

Sans bot, le panneau chat reste vide (c'est normal, pas de message fictif en live).
Pour afficher ton **vrai chat**, il suffit de remplir 2 cases du fichier **`secrets.json`**
(à ouvrir avec le Bloc-notes, à la racine du projet) :

1. **`CHAT_NICK`** → ton pseudo Twitch en minuscules (ex. `7gionny`).
   *(Tu peux utiliser ton propre compte pour commencer. Plus tard tu pourras créer un
   compte bot séparé si tu préfères.)*
2. **`CHAT_OAUTH`** → génère un token en cliquant sur ce lien :
   ```
   https://id.twitch.tv/oauth2/authorize?client_id=53shwqq9p92zl8gpqk03sewwdcb0xg&redirect_uri=http://localhost&response_type=token&scope=chat:read+chat:edit
   ```
   → **Autoriser** → ton navigateur arrive sur une page "introuvable" (`http://localhost`),
   c'est normal → dans la **barre d'adresse**, copie ce qui suit `access_token=` (jusqu'au
   `&scope=`).
3. Dans `secrets.json`, colle `oauth:` **directement suivi** du token (sans espace) :
   ```
   "CHAT_OAUTH": "oauth:TON_TOKEN_COLLÉ_ICI"
   ```
4. Sauvegarde le fichier, puis **relance** `demarrer-pont.bat`.
5. La fenêtre doit afficher : `Chat → actif (7gionny)`.

> Le chat s'affiche alors en direct à droite, avec badges, emotes, couleurs, etc.

---

## 📊 Activer les sondages + abonnés + follows (LE token principal)

Le champ **`POLL_OAUTH`** sert à 3 choses à la fois : les sondages `/poll`,
le compteur de subs (sub goal) et les **missions** (points de chaîne).
Il faut donc générer UN token avec les 3 droits d'un coup.

> ⚠️ Ce token doit être celui **du compte de ta chaîne**. Twitch refuse qu'un compte
> modérateur ou un compte-bot lise les échanges de points de chaîne.

1. **`CLIENT_ID`** → déjà pré-rempli (`53shw…`). Tu peux le laisser tel quel.
2. **`POLL_OAUTH`** → génère un token en cliquant sur CE lien (il contient les 3 droits) :
   *(si tu avais déjà un token d'une version précédente, il faut le refaire avec ce lien‑ci :
   le droit « points de chaîne » est nouveau en v46)*
   ```
   https://id.twitch.tv/oauth2/authorize?client_id=53shwqq9p92zl8gpqk03sewwdcb0xg&redirect_uri=http://localhost&response_type=token&scope=channel:read:polls+channel:read:subscriptions+channel:read:redemptions
   ```
   → **Autoriser** → copie ce qui suit `access_token=` dans la barre d'adresse
   → colle-le dans `POLL_OAUTH` (**sans** le préfixe `oauth:`).
3. Sauvegarde, relance `demarrer-pont.bat`. La fenêtre doit afficher :
   - `/poll → actif`
   - `Sub goal → auto (vrai nombre de subs)`
   - `Missions → points de chaîne (EventSub)` puis `[points] abonnement OK`

> 💡 Ton ID de chaîne est trouvé **automatiquement** par le programme (à partir du
> token) : tu n'as rien d'autre à chercher.
>
> ⚠️ **Important** : si tu avais déjà un `POLL_OAUTH` avec seulement le droit
> « sondages », **régénère-le avec ce nouveau lien** (il contient les 3 droits),
> sinon le sub goal et les follows ne fonctionneront pas.

---

## 📝 Connecter le réel (résumé express)

Toutes les connexions se font dans **UN seul fichier** : `secrets.json` (Bloc-notes).

| Case | Quoi mettre |
|---|---|
| `CHAT_NICK` | ton pseudo Twitch (ex. `7gionny`) |
| `CHAT_OAUTH` | `oauth:` + token (lien "chat" ci-dessus) |
| `CLIENT_ID` | déjà rempli (`53shw…`) |
| `POLL_OAUTH` | token du lien "sondages + abonnés + follows" (sans `oauth:`) |
| `ADMIN_TOKEN` | laisse vide pour l'instant |

Une fois rempli + `demarrer-pont.bat` relancé, la fenêtre affiche :
`Chat → actif`, `/poll → actif`, `Sub goal → auto` et `Follows → EventSub`.

> 💡 **Subs / gifts / resubs / raids** : déjà automatiques (via le bot chat), rien à faire.
> **Follows** : actifs dès que `POLL_OAUTH` a le bon droit (lien ci-dessus).

---

## 🚑 En cas de problème

| Souci | Solution |
|---|---|
| La fenêtre noire affiche une erreur `Node.js n'est pas installé` | Refais l'**étape 1** |
| `http://localhost:8321` ne s'ouvre pas | Vérifie que `demarrer-pont.bat` tourne (fenêtre ouverte) |
| OBS n'affiche rien | Normal si aucun débat n'est lancé ! Lance `tester-debat.bat` |
| Pas de son dans le casque | Refais l'**étape 6** |
| Le chat reste vide | Vérifie l'étape optionnelle « chat » (token `oauth:`) |
| Le journal de script d'OBS dit `Error opening file: (null)` et rien ne se lance | OBS n'arrive plus à trouver le script (dossier déplacé/renommé, ou ligne restée d'une ancienne installation). Va dans **Outils → Scripts**, sélectionne `demarrer-avec-obs.lua`, clique sur **–** pour l'enlever, puis sur **+** pour le rajouter **depuis le dossier actuel de l'overlay**. Voir juste en dessous. |
| Port 8321 déjà pris | Ouvre l'invite de commandes et lance `PORT=8400 node server.js`, puis mets `http://localhost:8400/widget.html` dans OBS |

---

### 🔧 Les missions (points de chaîne) ne s'affichent pas

Onglet **MISSIONS** → bouton **VÉRIFIER LA CONNEXION**. Il te dit à quelle étape ça bloque.
La ligne la plus utile est « Connecté à Twitch en temps réel » :

| Ce que tu vois | Ce que ça veut dire |
|---|---|
| ✖ **Non connecté à Twitch** | Le pont n'arrive pas à ouvrir la connexion temps réel. C'est presque toujours un **pare-feu, un antivirus ou un VPN** qui bloque `node.exe`. Autorise `node.exe`, coupe le VPN, et **laisse le pont tourner une minute** : après 2 échecs il bascule tout seul sur une autre méthode de connexion, qui passe souvent là où la première échoue. |
| ✖ **Abonnement refusé (401/403)** | Le droit « points de chaîne » manque sur ton jeton, ou le jeton n'est pas celui du compte de la chaîne. Regénère-le (onglet RÉGLAGES) puis relance le pont. |
| ✔ connecté et abonné, mais **0 échange reçu** | La chaîne marche, mais Twitch n'a rien envoyé. Échange une récompense **pendant que le pont tourne**. |
| ✔ échanges reçus mais **rien à l'écran** | Regarde « Dernier échange écarté » : la récompense est probablement décochée dans la liste, ou son coût est sous le minimum. |
| ✖ **Aucune source OBS connectée** | Même reçues, les missions n'iraient nulle part : dans OBS, clic droit sur la source → **Actualiser**. |

> ℹ️ Les **Power-ups** et les récompenses intégrées de Twitch (mettre en avant un message,
> emote géante, célébration…) sont gérés depuis la v46 : ils affichent une mission avec leur
> nom traduit en français. Si tu n'en veux pas, décoche-les dans la liste.

---

### 🔧 « Error opening file: (null) » au lancement d'OBS

Ce message vient **d'OBS lui-même**, pas de l'overlay : il veut dire qu'OBS a gardé en
mémoire un script dont il ne retrouve plus le fichier. Ça arrive quand le dossier de
l'overlay a été **déplacé, renommé** (ou re-téléchargé ailleurs) après avoir ajouté le
script. OBS ne sait pas suivre le déplacement, donc il n'exécute rien.

La réparation prend 20 secondes :

1. Dans OBS : **Outils → Scripts** (onglet *Scripts*).
2. Sélectionne la ligne `demarrer-avec-obs.lua` et clique sur le bouton **–** (moins).
3. Clique sur **+** (plus) et va rechercher `demarrer-avec-obs.lua` **dans le dossier
   où se trouve ton overlay aujourd'hui** (celui qui contient `server.js`).
4. Ferme la fenêtre. Dans l'onglet **Journal de script** tu dois maintenant lire :
   `Dossier de l'overlay : ...` puis `Lancement de la mini-app 7G : ...`.

> ⚠️ Règle à retenir : `demarrer-avec-obs.lua` doit **rester dans le dossier de
> l'overlay**, à côté de `lancer-app.vbs`. Ne le copie pas ailleurs (ni sur le Bureau,
> ni dans le dossier d'OBS) : c'est en cherchant ses voisins qu'il trouve quoi lancer.

Depuis la v46, si le fichier voisin manque, le script te l'écrit **en clair** dans le
journal (avec le chemin exact qu'il a regardé) au lieu d'échouer en silence. Et en
attendant, `lancer-tout.bat` lance tout à la main, ça marche toujours.

---

## 🔁 Le jour J, en résumé (copie-colle à garder sous la main)

```
1. Double-clic sur demarrer-pont.bat  →  laisse la fenêtre ouverte
2. Ouvre OBS  →  ta scène est déjà prête (faite une fois)
3. Lance un débat :  !debate Question | Choix A | Choix B | 180
4. Fin de stream : ferme la fenêtre noire
```
