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

## Portee de ce document

Aucun autre ecart DOM (id/classe/attribut) n'a ete introduit lors du portage
des squelettes P0.A5. Toute divergence future devra etre ajoutee ici avant
d'etre acceptee par un gate.
