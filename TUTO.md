# 🎮 Tuto — Héberger tes widgets et connecter l'API Twitch

Tout est **gratuit** : GitHub Pages pour l'hébergement, l'API Twitch pour les données.
Aucun serveur à payer, rien à installer. Compte **20 minutes** pour tout mettre en place la première fois.

---

## Ce que contient le pack

| Widget | Ce qu'il affiche | Taille conseillée dans OBS |
|---|---|---|
| **Texte** | Le texte envoyé par un viewer via une récompense de points de chaîne, la commande `!texte …`, ou manuellement depuis le panneau | 1920 × 300 |
| **Dernier follower** | Le follower le plus récent, en temps réel | 460 × 110 |
| **Derniers événements** | Fil en direct : subs, réabonnements, subs offerts, bits, raids | 540 × 720 |
| **Objectif followers** | Barre de progression vers ton objectif | 640 × 150 |
| **Compteur de viewers** | Nombre de viewers (invisible quand tu es hors ligne) | 320 × 90 |

> **Règle d'or du projet** : si l'API ne renvoie rien, le widget n'affiche **rien du tout**.
> Jamais de texte fictif, jamais de placeholder. (Le seul contenu d'exemple existe en
> **mode démo**, activé uniquement à la main via `?demo=1`, pour tester le design.)

---

## Étape 0 — Mettre le code en ligne (une seule fois)

1. Va sur GitHub, dans le dépôt `overlaytwitch`.
2. Ouvre la **pull request** (onglet *Pull requests*) et clique sur **« Merge pull request »**.
3. Dans le dépôt : **Settings → Pages** (menu de gauche).
4. Dans *Build and deployment* → *Branch* : choisis **main**, dossier **/ (root)**, puis **Save**.
5. Attends 1 à 2 minutes, puis recharge la page : ton site est en ligne sur
   **https://gioledonuts-ui.github.io/overlaytwitch/**

> ⚠️ Chaque modification du code poussée sur `main` re-déploie le site automatiquement (≈ 1 min).
> Le dépôt doit rester **public** (condition du gratuit pour GitHub Pages).

---

## Étape 1 — Créer ton application Twitch (2 min)

C'est « ton API » : Twitch te fournit une clé d'application (le **Client ID**).

1. Ouvre **https://dev.twitch.tv/console/apps** et connecte-toi avec ton compte Twitch.
   *(Twitch exige une vérification à deux facteurs sur ton compte pour créer une application.)*
2. Clique sur **« Register Your Application »**.
3. Remplis :
   - **Name** : ce que tu veux, ex. `Overlays de GioleDonuts`
   - **OAuth Redirect URLs** : colle l'URL de redirection affichée sur ton panneau (bouton **Copier**, étape 1 du panneau).
     C'est l'adresse de ton panneau sur GitHub Pages, elle doit être **exactement identique**.
   - **Category** : `Other`
4. Clique sur **Create**, puis sur **Manage** à côté de ton application.
5. Copie le **Client ID** (une suite de lettres/chiffres).

> Le Client ID n'est **pas** un secret : c'est un identifiant public. Le vrai secret
> (Client Secret) n'est utilisé nulle part ici — pas besoin de le générer.

---

## Étape 2 — Connecter ton compte (1 min)

1. Ouvre **https://gioledonuts-ui.github.io/overlaytwitch/** → le panneau s'affiche.
2. **Étape 1 du panneau** : colle ton Client ID → **Enregistrer**.
3. **Étape 2 du panneau** : clique sur **« Se connecter avec Twitch »** → Twitch te demande
   d'autoriser l'application → clique sur **Autoriser**.
4. De retour sur le panneau : ton pseudo s'affiche avec une pastille verte. ✅ **C'est connecté !**

Le panneau mémorise la connexion pendant **environ 60 jours** (durée de vie du token Twitch).
Au bout de ce délai la pastille devient orange puis rouge : il suffit de se reconnecter
(cf. *Maintenance* plus bas).

---

## Étape 3 — Créer la récompense des points de chaîne (2 min)

Pour que les viewers puissent envoyer du texte à l'écran :

1. Sur Twitch : **Tableau de bord du créateur → Chaîne → Récompenses de points de chaîne**.
2. **+ Nouvelle récompense** :
   - **Nom** : par ex. `Affiche ton message` (ou ce que tu veux)
   - **Coche « Demander au viewer de saisir un texte »** ← c'est ça qui permet d'envoyer du texte
   - Coche « demander la confirmation… » si tu veux valider avant affichage (optionnel)
   - Prix, icône, délai de recharge : comme tu veux
3. **Important** : sur le panneau (étape 3), si tu veux que le widget n'écoute **que cette
   récompense, écris son nom exact** dans « Récompense à écouter ». Sinon, laisse vide :
   toute récompense avec texte s'affichera.

> Bonus : la commande **`!texte ton message`** dans le chat fonctionne aussi
> (toi et tes modérateurs par défaut — réglable sur le panneau), ainsi que l'envoi
> **manuel** depuis le panneau (étape 4).

---

## Étape 4 — Le dock OBS, la petite astuce qui change tout (3 min)

Ajoute le panneau comme **dock** dans OBS : la connexion et les réglages sont alors
**partagés automatiquement avec tous les widgets**. Tu n'auras plus jamais besoin de
re-copier les URLs quand le token expire ou quand tu changes un réglage.

1. OBS → menu **Docks** → **Docks de navigateur personnalisés…**
   *(dans les vieilles versions : Affichage → Docks)*
2. Nom : `Overlays` — URL : celle du panneau (bouton **Copier**, étape 5 du panneau) → **Appliquer**.
3. Dans le dock qui apparaît : clique **« Se connecter avec Twitch »** (une seule fois).
   *(La première fois, OBS te demande de te connecter à Twitch à l'intérieur d'OBS : c'est normal,
   il garde la session ensuite.)*
4. À l'étape 6 du panneau, **décoche « URLs complètes »** : tes widgets n'auront plus besoin
   de token dans leurs URLs.

> Si tu préfères ne pas utiliser le dock, tout marche quand même avec les « URLs complètes »
> (étape 6) — mais il faudra les re-copier à chaque expiration du token ou changement de réglage.

---

## Étape 5 — Ajouter les widgets dans OBS (5 min)

1. OBS → **Sources → + → Navigateur** → donne un nom (ex. `Widget Texte`) → OK.
2. Dans **URL** : colle l'URL du widget copiée depuis le panneau (étape 6, bouton **Copier l'URL**).
3. Dans **Largeur/Hauteur** : mets la taille conseillée (tableau en haut de ce tuto).
4. Vérifie que **« Arrêter la source quand elle n'est pas visible »** est **décochée**
   (sinon le widget s'éteint quand tu changes de scène).
5. Plaque le widget où tu veux sur ta scène.
6. Répète pour chaque widget voulu.

> ⚠️ **Garde une seule source par widget.** Twitch autorise **3 connexions temps réel par
> compte** : Texte + Dernier follower + Derniers événements = les 3. Les widgets Objectif
> et Viewers, eux, interrogent l'API régulièrement sans connexion temps réel.

> 🔒 Les « URLs complètes » contiennent ta clé de connexion personnelle (token). Elles
> restent sur ta machine, mais **ne les partage pas** (screen, Discord…).

---

## Étape 6 — Tester

1. **Test design** : depuis le panneau, section *Aperçu (mode démo)* → ouvre un widget
   pour voir son rendu avec des exemples (marqués « MODE DÉMO »).
2. **Vrai test** :
   - **Texte** : échange la récompense depuis un autre compte Twitch (ou ton téléphone)
     → le texte apparaît à l'écran pendant la durée choisie, puis disparaît.
     Ou tape `!texte coucou` dans ton chat → ça s'affiche aussi.
   - **Dernier follower** : suis ta chaîne avec un autre compte → mise à jour instantanée.
   - **Événements** : un sub, des bits ou un raid arrivent en direct dans le fil.
   - **Viewers** : lance ton stream → le compteur apparaît ; hors ligne il disparaît.

---

## 🔧 Maintenance (2 min tous les ~2 mois)

| Situation | Que faire |
|---|---|
| Pastille **orange/rouge** sur le panneau (token expiré) | **Avec le dock** : clique « Se connecter » dans le dock, c'est tout ✅ · **Sans dock** : reconnecte-toi puis **re-copie chaque URL** dans OBS |
| Tu changes un réglage (durée, récompense, objectif…) | **Avec le dock** : appliqué en direct ✅ · **Sans dock** : re-copie les URLs OBS concernées |
| Un widget n'apparaît pas | C'est peut-être normal (aucune donnée, règle d'or) ! Sinon, ajoute `&debug=1` à la fin de son URL dans OBS : un badge indique l'état (token, connexion temps réel…) |
| Tu as fait « Effacer le cache et redémarrer » dans OBS | La connexion du dock est effacée : rouvre le dock et reconnecte-toi |
| Tu modifies le code du site | Pousse sur `main` → Pages se met à jour en ~1 min |

---

## 🚑 Dépannage rapide

- **« redirect_uri mismatch »** à la connexion → l'URL de redirection dans ton application
  Twitch (Étape 1) n'est **pas exactement** celle affichée sur le panneau. Recopie-la.
- **« Token expiré ou invalide »** → re-connecte-toi sur le panneau (le token a ~60 jours de vie).
- **Widget invisible en permanence** → ajoute `&debug=1` à l'URL dans OBS et regarde le badge.
  Vérifie aussi que le token dans l'URL est le bon (re-copie l'URL depuis le panneau).
- **Un texte n'apparaît pas** → le viewer a-t-il bien écrit un texte ? La récompense
  correspond-elle au nom exact configuré dans le panneau ? L'échange a-t-il été annulé ?
- **La commande !texte ne marche pas** → elle est réservée à **toi + tes modérateurs** par
  défaut (badge modérateur/broadcaster exigé). Coche « tout le monde » sur le panneau si tu veux.
- **Un widget temps réel reste muet après un redémarrage d'OBS** → rafraîchis la source
  (clic droit → Actualiser) : le widget nettoie et recrée son abonnement tout seul.
- **Page blanche sur GitHub Pages** → vérifie que Pages est bien activé sur `main` (Étape 0),
  et attends ~2 minutes après un déploiement.

---

## Options d'URL (à la fin de l'URL d'un widget dans OBS)

| Option | Effet |
|---|---|
| `?demo=1` | Aperçu du design avec contenu d'exemple |
| `&debug=1` | Badge d'état (token, connexion temps réel, chat…) |
| `?scale=1.5` | Grossit tout le widget (0.2 à 4) |
| `?channel=pseudo` | Suivre une autre chaîne |
| `?objectif=500` | Fixer l'objectif followers |
| `?style=net` | Widget texte sans carte, texte brut |
| `?pseudo=1` | Widget texte : afficher qui a envoyé le texte |
| `?couleur=%23ffd700` | Widget texte : changer la couleur |

*(`?` pour la première option, `&` pour les suivantes : `texte.html?scale=1.5&pseudo=1`.)*

---

## Comment ça marche, en résumé

```
Viewer échange une récompense / suit / sub / envoie des bits…
        │
        ▼
API Twitch  ──(EventSub WebSocket, temps réel)──▶  Widget (page HTML dans OBS)
        │                                              ▲
        └──(API Helix, état initial + compteurs)────────┘
                                                   │
                              Dock OBS (panneau) ──┘  connexion + réglages partagés
```

- Les widgets sont des **pages HTML statiques** servies par GitHub Pages (gratuit, HTTPS).
- La connexion se fait **directement avec Twitch**, sans serveur intermédiaire, grâce au
  flux OAuth « implicit » (token utilisateur de ~60 jours).
- **Deux modes au choix** :
  - **dock OBS** (recommandé) : connexion et réglages partagés, rien à re-copier ;
  - **URLs complètes** : token et réglages inclus dans l'URL de chaque widget
    (méthode de l'ancienne version, 100 % autonome).
- Toute la personnalisation visuelle se passe dans **`assets/theme.css`** (couleurs, police).
- Fixes de cette version : plus de conflit d'abonnement entre « Dernier follower » et
  « Objectif followers », abonnements morts nettoyés automatiquement au démarrage,
  reconnexion automatique en cas de silence du serveur.
