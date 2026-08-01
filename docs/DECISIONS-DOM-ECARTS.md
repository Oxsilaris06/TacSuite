# Ecarts DOM assumes vs les originaux (Phase 0)

Ce document liste, de facon exhaustive et opposable aux gates suivants, les
SEULS ecarts constates entre le DOM verbatim des originaux (`GStart-main/pctac2.html`,
`GStart-main/4.html`) et les squelettes portes (`TacSuite/pctac/index.html`,
`TacSuite/oi/index.html`). Conforme au protocole zero regression, §4 point 1 de
`docs/PLAN.md` : "ids/classes/attributs identiques aux originaux ; ecarts
autorises documentes (scripts retires, toggle STABLE/BETA, chemins d'assets
reecrits en absolu)".

## 1. PC-Tac : suppression du bouton de bascule STABLE/BETA

- **Original** : `pctac2.html:1537` — `<a href="pctac.html" id="version-toggle-btn">BETA</a>`.
- **TacSuite** : element absent de `pctac/index.html`.
- **Justification** : decision actee utilisateur (`docs/PLAN.md` §2, ligne
  "Source de verite PC-Tac") — `pctac2.html` est la source de verite (identique
  a `pctac.html` au toggle pres) ; le toggle disparait car TacSuite ne porte
  qu'UNE seule version de PC-Tac. La cible `pctac.html` du lien n'existe de
  toute facon pas dans l'arborescence portee.
- **Ecart admis explicitement par la mission P0.FIX (reprise 1).**
- **CSS mort residuel** : les regles `#version-toggle-btn` (`styles/pctac.css`,
  ex-lignes 399, 421, 429, 738 au moment de cette note) restent presentes car
  `styles/pctac.css` est une extraction VERBATIM (cf. en-tete du fichier) —
  purge prevue en **P2.F** (modernisation CSS pctac), pas avant.
- **Consequence visuelle** : `#version-toggle-btn` est visible dans les 20
  captures baseline pctac (10 etats x 2 viewports — element d'en-tete,
  present dans toutes), alors qu'il est absent du porte. Strategie de
  comparaison retenue : masquage par RECTANGLE FIXE (constantes px,
  independantes de la presence du selecteur DOM cote porte), applique
  identiquement aux deux images par le script de diff P2.F — cf.
  `tests/visual/README.md` § "Zones a MASQUER" / "Forme d'appel a utiliser
  en P2.F / P3.D" pour la forme d'appel exacte et les coordonnees.

## 2. OI : suppression du bouton BETA (pont vers la page legacy `1.html`)

- **Original** : `4.html:4078` — `<a href="1.html" id="beta-button">BETA</a>`.
- **TacSuite** : element absent de `oi/index.html`.
- **Justification** : `1.html` est une page legacy explicitement hors
  perimetre du portage (`docs/PLAN.md` §2, ligne "Perimetre" : *"Pages
  secondaires (mhe, mrz, qg, synthese, patracdvr, tchap_geoloc_test...) NON
  portees"* — et §6, Phase 0 registre des risques : *"Code mort ambigu"* /
  §2 "Code mort" liste `old.html`/`1.html` parmi l'exclu). Ce bouton est
  l'equivalent fonctionnel, cote OI, du toggle STABLE/BETA de PC-Tac (point 1
  ci-dessus) : meme nature d'ecart, meme justification de fond (bascule vers
  une variante de page non portee), traite de facon symetrique.
- **Ecart admis** au meme titre que le point 1 — documente ici a la demande
  explicite de la mission P0.FIX (reprise 1), qui le qualifiait de non encore
  trace par ecrit.
- **CSS mort residuel** : les regles `#beta-button` (`styles/oi.css`, ex-lignes
  3503, 3546, 3559 au moment de cette note) restent presentes pour la meme
  raison d'extraction verbatim — purge prevue en **P3.E** (modernisation CSS
  oi.css), pas avant.
- **Consequence visuelle** : `#beta-button` est visible dans les 18 captures
  baseline oi (9 etats x 2 viewports — element d'en-tete, present dans
  toutes), alors qu'il est absent du porte. Meme strategie que le point 1 :
  masquage par RECTANGLE FIXE (constantes px, independantes de la presence
  du selecteur DOM cote porte), applique identiquement aux deux images par
  le script de diff P3.D — cf. `tests/visual/README.md` § "Zones a MASQUER"
  / "Forme d'appel a utiliser en P2.F / P3.D" pour la forme d'appel exacte
  et les coordonnees.

## 3. PC-Tac : 4 balises `<meta>` PWA/iOS manquantes — RESTAUREES (P2.FIX reprise 2, 2026-08-01)

- **Constat** : un re-diff attribut par attribut de `GStart-main/pctac2.html`
  vs `TacSuite/pctac/index.html` (parse HTML, attributs tries, scripts/styles
  exclus, espaces normalises) a mis en evidence 4 balises `<meta>` de
  l'original absentes du porte et non documentees ici :
  `<meta name="theme-color" content="#10141c">` (`pctac2.html:28`),
  `<meta name="apple-mobile-web-app-capable" content="yes">` (`:29`),
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` (`:30`),
  `<meta name="apple-mobile-web-app-title" content="PC Tac">` (`:31`).
  Ce sont des metadonnees PWA/iOS pures (couleur de la barre d'etat systeme,
  titre affiche en mode standalone) sans dependance au service worker
  (differe en P4.A, cf. `docs/PLAN.md` §6).
- **Decision** : RESTAUREES verbatim dans `pctac/index.html` (juste apres
  `<link rel="manifest">`, meme regroupement PWA que l'original), conformement
  au protocole zero regression §4 point 1 (`docs/PLAN.md`) — aucune raison de
  les retirer, elles n'ont aucun cout ni dependance bloquante.
- **Consequence visuelle** : aucune — des balises `<meta>` ne rendent rien a
  l'ecran, n'affectent aucune des baselines `tests/visual/baseline/pctac/`.

## 4. `<link>` retires ne relevant d'aucune categorie ci-dessus — renvois

Trois `<link>` de plus, presents dans `pctac2.html` mais absents de
`pctac/index.html`, ne sont ni le toggle BETA (point 1) ni les 4 `<meta>`
du point 3. Ils sont deja traces, mais ailleurs que dans ce document — ce
paragraphe centralise le renvoi pour que ce fichier cesse d'affirmer qu'il
n'existe "aucun autre ecart" :

- `<link rel="stylesheet" href="shared/ui-platform.css">` (`pctac2.html:19`) —
  absent en tant que `<link>` distinct : concatene VERBATIM dans
  `styles/pctac.css` (source 1/4, cf. l'en-tete de ce fichier,
  `styles/pctac.css:1-25`).
- Les 2 feuilles Google Fonts (`pctac2.html:33-41` : `preconnect` ×2 +
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">` +
  la feuille Material Symbols) — remplacees par des paquets npm auto-heberges
  (zero CDN a l'execution, `docs/PLAN.md` §2), tracees dans
  `docs/DECISIONS-DEPS.md` § "Polices (ajout P0.FIX, reprise 1)".
- `<link rel="stylesheet" href="./vendor/maplibre-gl.css">` (`pctac2.html:47`) —
  remplace par l'import npm `maplibre-gl/dist/maplibre-gl.css` dans
  `src/apps/pctac/main.ts`, trace dans l'en-tete de `styles/pctac.css`
  (§ "HORS PERIMETRE").

Ces trois ecarts sont deja couverts par la documentation existante (CSS
concatene ou dependances npm) — aucun n'affecte le rendu visuel puisque le
CSS/JS equivalent est bien charge par une autre voie.

## Portee de ce document

Les ecarts DOM ci-dessus (points 1 a 4) sont, a la date du 2026-08-01, la
liste exhaustive des divergences constatees entre le DOM des originaux et
celui des squelettes portes. Toute divergence future devra etre ajoutee ici
avant d'etre acceptee par un gate.
