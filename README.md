# 🎮 Overlays Twitch

Widgets d'overlay pour tes streams, **100 % gratuits** : hébergés sur
[GitHub Pages](https://gioledonuts-ui.github.io/overlaytwitch/), connectés
directement à l'API Twitch. Aucun serveur à louer.

**👉 Le tutoriel complet est dans [`TUTO.md`](TUTO.md)** (20 minutes de mise en place).

## Les widgets

| Widget | Ce qu'il affiche |
|---|---|
| **Texte** (`widgets/texte.html`) | Le texte envoyé par un viewer via une récompense de points de chaîne, la commande `!texte …`, ou manuellement depuis le panneau |
| **Dernier follower** (`widgets/dernier-follower.html`) | Le follower le plus récent, en temps réel |
| **Derniers événements** (`widgets/derniers-evenements.html`) | Subs, réabonnements, subs offerts, bits, raids |
| **Objectif followers** (`widgets/objectif-followers.html`) | Barre de progression vers ton objectif |
| **Compteur de viewers** (`widgets/viewers.html`) | Nombre de viewers en direct |

> **Règle d'or** : si l'API ne renvoie rien, le widget n'affiche **rien du tout** —
> jamais de texte fictif, jamais de placeholder. (Seule exception : le mode démo
> manuel `?demo=1`, pour préparer tes scènes.)

## En bref

- **Panneau de configuration** : [`config.html`](https://gioledonuts-ui.github.io/overlaytwitch/config.html) — Client ID, connexion Twitch, réglages, URLs OBS.
- **Temps réel** : EventSub WebSocket (texte, dernier follower, événements) + API Helix (objectif, viewers) — dans la limite Twitch de 3 connexions temps réel par compte.
- **Chat** : lecture anonyme en temps réel pour la commande `!texte`.
- **Personnalisation** : couleurs et police dans `assets/theme.css`.
- **Dépannage sur un widget** : ajouter `&debug=1` à son URL dans OBS.

## Structure du dépôt

```
overlaytwitch/
├── index.html                        ← redirige vers le panneau
├── config.html                       ← LE panneau (connexion, réglages, URLs OBS)
├── TUTO.md                           ← le tuto complet pas à pas
├── assets/
│   ├── ovt.js                        ← bibliothèque (API Twitch, temps réel, chat)
│   └── theme.css                     ← charte graphique (couleurs, police)
└── widgets/
    ├── texte.html
    ├── dernier-follower.html
    ├── derniers-evenements.html
    ├── objectif-followers.html
    └── viewers.html
```
