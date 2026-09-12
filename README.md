# overlaytwitch

Overlays Twitch personnalisés pour OBS — **100 % statiques**, hébergés sur
**GitHub Pages** (gratuit), connectés en **temps réel** à l'API Twitch
(EventSub WebSocket + Helix), sans aucun serveur à gérer.

**👉 Suis [TUTO.md](TUTO.md) pour l'installation complète (20 min).**

## Contenu

| Fichier | Rôle |
|---|---|
| `config.html` | Panneau de configuration : connexion Twitch, réglages, génération des URLs OBS |
| `index.html` | Redirige vers le panneau |
| `widgets/texte.html` | Texte envoyé par un viewer via une récompense de points de chaîne |
| `widgets/dernier-follower.html` | Dernier follower, en temps réel |
| `widgets/derniers-evenements.html` | Fil en direct : subs, réabonnements, subs offerts, bits, raids |
| `widgets/objectif-followers.html` | Barre de progression vers un objectif de followers |
| `widgets/viewers.html` | Compteur de viewers (invisible hors ligne) |
| `assets/ovt.js` | Bibliothèque commune : réglages, token, Helix, EventSub WebSocket |
| `assets/theme.css` | Thème visuel (couleurs, police — charte graphique) |

## Règle d'or

**Pas de donnée = widget invisible.** Jamais de texte fictif ni de placeholder en
production. Le contenu d'exemple n'existe qu'en mode démo (`?demo=1`), activé
manuellement pour tester le design.

## Astuces

- Ajoute `?demo=1` à l'URL d'un widget → aperçu du design.
- Ajoute `&debug=1` → badge d'état (token, connexion temps réel) pour diagnostiquer.
