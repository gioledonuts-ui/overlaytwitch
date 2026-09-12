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
Pour afficher ton **vrai chat**, il faut un compte bot :

1. Crée (ou prends) un **second compte Twitch** (ex. `7gionny_bot`).
2. Connecté avec ce compte, va sur **https://twitchapps.com/tmi/** → **Connect**.
3. Copie le token affiché (il commence par `oauth:`).
4. Ouvre le dossier du projet, **clic droit sur `demarrer-pont.bat` → Modifier** (Bloc-notes).
5. Tout en haut, ajoute ces 2 lignes (remplace par TON token et TON pseudo bot) :
   ```bat
   set CHAT_NICK=7gionny_bot
   set CHAT_OAUTH=oauth:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. Enregistre et referme. **Relance** `demarrer-pont.bat`.
7. La fenêtre doit afficher : `Chat → actif (7gionny_bot)`.

> Le chat s'affiche alors en direct à droite, avec badges, emotes, couleurs, etc.

---

## 📊 (Optionnel) Activer les sondages natifs `/poll`

Pour que le widget capture tes sondages `/poll` de Twitch automatiquement :

1. Crée une app sur **https://dev.twitch.tv/console/apps** → récupère ton **Client ID**.
2. Récupère aussi ton **token utilisateur** (scope `channel:read:polls`) et ton **ID de chaîne**.
3. Ajoute ces 3 lignes tout en haut de `demarrer-pont.bat` :
   ```bat
   set CLIENT_ID=ton_client_id
   set BROADCASTER_ID=ton_id_de_chaine
   set POLL_OAUTH=ton_token_oauth
   ```
4. Enregistre, relance. La fenêtre doit afficher : `/poll → actif`.

---

## 🚑 En cas de problème

| Souci | Solution |
|---|---|
| La fenêtre noire affiche une erreur `Node.js n'est pas installé` | Refais l'**étape 1** |
| `http://localhost:8321` ne s'ouvre pas | Vérifie que `demarrer-pont.bat` tourne (fenêtre ouverte) |
| OBS n'affiche rien | Normal si aucun débat n'est lancé ! Lance `tester-debat.bat` |
| Pas de son dans le casque | Refais l'**étape 6** |
| Le chat reste vide | Vérifie l'étape optionnelle « chat » (token `oauth:`) |
| Port 8321 déjà pris | Ouvre l'invite de commandes et lance `PORT=8400 node server.js`, puis mets `http://localhost:8400/widget.html` dans OBS |

---

## 🔁 Le jour J, en résumé (copie-colle à garder sous la main)

```
1. Double-clic sur demarrer-pont.bat  →  laisse la fenêtre ouverte
2. Ouvre OBS  →  ta scène est déjà prête (faite une fois)
3. Lance un débat :  !debate Question | Choix A | Choix B | 180
4. Fin de stream : ferme la fenêtre noire
```
