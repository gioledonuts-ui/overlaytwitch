# 7GIONNY — Prompts Midjourney (assets UI, DA Debate Overlay)

Règles communes appliquées à chaque prompt :
- Palette verrouillée : noir mat `#0A0A0A`, violet électrique `#9146FF` / `#7000FF`, blanc `#FFFFFF`.
- Style : broadcast premium, talk-show tech/streetwear haut de gamme, bordures 1 px, zéro cartoon.
- Toujours `--style raw` (finition fidèle, pas de sur-stylisation) et des `--no` stricts.
- Générer en **PNG transparent** ensuite (ou détourer sur fond noir) · taille cible : carte 1240×212 px, icônes ≤ 64 px.

---

## 1 · Texture de fond en verre dépoli sombre (panneau)

```
Seamless dark frosted glass texture for a broadcast lower-third panel, matte black #0A0A0A base,
extremely subtle electric violet #9146FF rim light on the top edge, faint diagonal light streak,
ultra thin 1px hairline edge, premium tech talk-show aesthetic, studio key lighting,
photoreal material render, minimal, high detail --style raw
--no text, logo, people, rainbow gradient, busy pattern, cartoon
```

## 2 · Icône « débat » (deux micros en face-à-face)

```
Minimalist broadcast icon, two studio microphones facing each other across an invisible dividing line,
single ultra-thin 1px white outline on matte black #0A0A0A background, one small electric violet
#9146FF accent dot centered between them, flat vector style, premium TV debate show branding,
centered, generous negative space --style raw
--no text, 3d, gradient fills, cartoon, shadow, colorful
```

## 3 · Badge de résultat / sentence

```
Minimalist result badge for a premium dark broadcast UI, thin 1px white ring with a short electric
violet #9146FF arc accent on the upper left, ultra-thin checkmark stroke inside, matte black
#0A0A0A background, flat vector, sober, high-end talk-show aesthetic, centered --style raw
--no text, numbers, 3d, heavy glow, cartoon, colorful
```

## 4 · Texture HUD discrète (scanlines + grain, option d'arrière-plan)

```
Subtle dark broadcast HUD background texture, matte black #0A0A0A with 2 percent opacity white
scanlines and fine film grain, one very thin horizontal electric violet #9146FF hairline crossing
the lower third, extremely minimal, premium TV studio look, 16:9 --style raw
--no text, logo, colorful, pattern overload, people
```

## 5 · Filet d'accent / séparateur (décorative pour chip & footer)

```
Ultra minimal horizontal divider element for a premium dark UI, a single 1px gradient line fading
from deep electric violet #7000FF to transparent left to right, soft violet bloom at the start of
the line, matte black #0A0A0A background, broadcast lower-third aesthetic, 16:9 crop --style raw
--no objects, text, icons, cartoon, heavy glow
```

---

### Conseils de retouche
- Fond noir → transparence : `ImageMagick : convert in.png -channel RGBA -fuzz 12% -fill none -opaque black out.png`
  (ou l'outil « fond noir → transparent » dans Photopea).
- Garde les accents violet **≤ 10 % de la surface** de chaque asset : c'est la signature « discret ».
- Évite tout texte dans les assets Midjourney (le texte est géré par CSS — Bebas Neue / Inter).
