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
- **Consequence tutoriel (trouvee en P2.FIX reprise 1)** : `src/apps/pctac/tuto-data.ts:25`
  (chapitre "Prise en main de PC Tac", premiere etape) conserve
  `selector: "#version-toggle-btn"` et un `body` decrivant verbatim le badge
  BETA — "Le badge BETA, en haut a gauche, signale la version beta et
  bascule vers la version classique (pctac.html) si on clique dessus." —
  alors que l'element et ses regles CSS associees sont desormais absents du
  portage. Degradation gracieuse confirmee : `src/shared/tuto-engine.ts:827-838`
  ne cree simplement pas le bouton "Montrer sur la page" quand le `selector`
  ne correspond a aucun element du DOM, sans erreur ni blocage du tutoriel —
  **non bloquant**. Reste neanmoins un ecart de contenu : le texte affiche au
  lecteur decrit une fonctionnalite (bascule vers `pctac.html`) qui n'existe
  plus dans TacSuite. Non corrige par la mission P2.FIX (hors perimetre CSS
  de cette reprise) — a traiter lors d'une prochaine passe sur
  `tuto-data.ts` (reformuler l'etape sans le badge BETA, ou la retirer).

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

## 5. OI : `#pctacLink` — cible legacy `pctac.html` → chemin absolu `/pctac/`

- **Original** : `4.html` (dock) — `<a href="pctac.html" id="pctacLink">`.
- **TacSuite** : `oi/index.html` — `<a href="/pctac/" id="pctacLink">`.
- **Justification** : `pctac.html` n'existe pas dans l'arborescence portee
  (page PC-Tac deplacee sous `/pctac/`, cf. `vite.config.ts` multi-page).
  Alignement sur la convention de chemins absolus racine deja actee pour les
  assets (P0.A5) et pour PC-Tac lui-meme.
- **Mission P3B.C.**

## 6. OI et PC-Tac : ajout de `#portalLink` (retour au portail TacSuite)

- **OI** (`oi/index.html`, dock) : `<a href="/" id="portalLink" title="Retour
  au portail TacSuite"><span class="material-symbols-outlined">home</span></a>`
  insere entre `#dockToggleBtn` et `#pctacLink` (portee decroissante : portail
  = retour au plus haut niveau, puis PC-Tac = app soeur, puis outils internes
  a l'OI).
- **PC-Tac** (`pctac/index.html`, dock) : meme markup (`style="text-decoration:
  none;"` en plus, coherence avec le lien OI voisin), insere entre
  `#dockToggleBtn` et le lien vers l'OI.
- **Justification** : lien de retour vers le portail TacSuite (`/`), absent
  des deux originaux (`4.html`/`pctac2.html`) qui n'avaient pas de portail —
  ajout pur, decision utilisateur, hors perimetre du portage 1:1. Icone
  `home` (Material Symbols deja chargee, aucun nouvel asset), id `portalLink`
  identique cote OI et PC-Tac.
- **Consequence visuelle PC-Tac** : `#dockMenu` porte la classe `collapsed`
  par defaut (`pctac/index.html`), et `.dock-menu.collapsed
  .dock-menu-item:not(#dockToggleBtn) { display: none; }` (`styles/pctac.css`)
  masque tous les items sauf le toggle. Aucun des 10 etats/20 captures de
  `tests/visual/compare.mjs pctac` n'ouvre le dock (aucun `run()` ne clique
  `#dockToggleBtn`) : `#portalLink` n'est visible dans AUCUNE des captures
  baseline ni portees → 0 pixel affecte, aucun masque necessaire. Verifie a
  la mission P3B.C (`npm run test:visual -- pctac` → 20/20 sans modification
  de `tests/visual/compare.mjs`).
- **Consequence visuelle OI** : a la difference de PC-Tac, `#dockMenu` de
  `oi/index.html` n'a PAS la classe `collapsed` par defaut (dock deploye au
  chargement) — `#portalLink` y est donc visible des le premier rendu. Les
  baselines `tests/visual/baseline/oi/` (18 captures, Phase 0) ne le
  contiennent pas. `compare.mjs oi` n'est PAS un gate de la mission P3B.C
  (seul `compare.mjs pctac` est requis) et n'a pas ete relance ici ; si/quand
  le regression visuel OI redevient un gate actif, un masque cible (meme
  forme que `HEADER_MASK`) devra etre ajoute pour la zone de `#portalLink`
  sur les captures OI, ou les baselines OI devront etre re-capturees.
- **Mission P3B.C**, symetrique OI/PC-Tac.

## 7. PC-Tac : lien dock vers l'OI — cible legacy `1.html` → chemin absolu `/oi/`

- **Original** : `pctac2.html` (dock) — `<a href="1.html">` (pas d'id).
- **TacSuite** : `pctac/index.html` — `<a href="/oi/">` (id toujours absent,
  ecart pre-existant non lie a cette correction).
- **Justification** : `1.html` est une page legacy hors perimetre du portage
  (`docs/PLAN.md` §2), absente de l'arborescence `TacSuite` — lien mort avant
  correction, meme nature de probleme que le point 5 ci-dessus (`#pctacLink`
  cote OI). Corrige dans la meme passe que l'ajout de `#portalLink` (§6),
  directive orchestrateur P3B.C (meme zone du DOM, evite un second
  aller-retour sur ce fichier).
- **Mission P3B.C.**

## 8. OI : délégation `data-action` — 63 attributs statiques retirés

- **Original** : `4.html` — 37 `onclick` + 19 `oninput` + 7 `onchange`
  statiques (inline JS) sur les elements du wizard OI.
- **TacSuite** : `oi/index.html` — les 63 attributs `on*="..."` sont
  remplaces par un attribut `data-action="<nom>"` (+ `data-*` complementaires
  selon les cas : `data-format`, `data-color`, `data-step`, `data-target`,
  `data-preview-container`, `data-single`). Trois listeners delegues
  (`click`/`input`/`change`) poses une seule fois sur `document` dans
  `src/apps/oi/main.ts`, table `action → handler`. Decision identique a
  `SPEC-PCTAC-CONVERSION.md` §3.2, portee par `SPEC-OI-CONVERSION.md` §12.4.
- **Hors perimetre** : les `onclick` GENERES dynamiquement en `innerHTML` par
  `formulaires.ts`/`patrac.ts`/`articulation.ts`/`medias.ts`/`dessin.ts`
  restent VERBATIM — retrait differe (§12.4), non traite par cette mission.
- **Asymetrie assumee avec PC-Tac** : `src/apps/pctac/main.ts` documente en
  tete (§3.2) que sa PROPRE delegation `data-action` reste differee au-dela
  de P2.D — `pctac/index.html` porte donc encore ses 5 `onclick` statiques
  (hors la correction ponctuelle du point 7 et l'ajout du point 6, qui ne
  sont pas des `on*` a convertir). `SPEC-OI-CONVERSION.md` §12.4 scope
  explicitement la delegation `data-action` de l'OI a cette mission (P3B.C) ;
  celle de PC-Tac reste hors mandat ici. Assume et documente, pas de passe
  d'alignement retroactive sur PC-Tac dans cette mission.
- **Mission P3B.C.**

## 9. OI : manifest dynamique (4.html:5-13) — non porte dans `main.ts`

- **Original** : `4.html:5-13` — injection JS d'un `<link rel="manifest"
  href="manifest.json">`, sous garde `location.protocol.startsWith('http')`
  (evite une erreur CORS en contexte `file://`). Fait partie du meme bloc que
  le filet `error`/`unhandledrejection` (`4.html:14-23`), lui-meme porte
  verbatim dans `src/apps/oi/main.ts`.
- **TacSuite** : `oi/index.html:8` porte deja, de facon STATIQUE (decision
  P0.A5, anterieure a cette mission), `<link rel="manifest"
  href="/manifest.webmanifest">`. Rejouer le bloc dynamique de l'original
  ajouterait un DEUXIEME `<link rel="manifest">` pointant vers un chemin
  relatif `manifest.json` inexistant dans l'arborescence Vite (404) :
  regression, pas fidelite.
- **Decision** : omission VALIDEE — directive orchestrateur P3B.C. Seul le
  filet d'erreurs (`4.html:14-23`) est repris dans `src/apps/oi/main.ts`
  (etape 0) ; la partie manifest (`4.html:5-13`) reste volontairement
  absente.
- **Mission P3B.C.**

## 10. PC-Tac : les DEUX `<style>` inline du body — relocalises dans `styles/pctac.css`

`pctac2.html` contient DEUX balises `<style>` inline dans le `<body>`, pas une
seule : celle ci-dessous, `#tl-orbat-style` (avec id), ET une seconde,
ANONYME (sans id), non documentee jusqu'ici bien que deja relocalisee — cf.
sous-section "10bis" apres celle-ci pour cette seconde balise.

- **Original** : `pctac2.html:1926-1959` (bloc identique dans `GStart-main/pctac.html:1926`)
  — une balise `<style id="tl-orbat-style">` INLINE, imbriquee au milieu du
  markup du bandeau Tchap live (`#tl_bar`), entre le bouton `#tl_toggle` et
  le panneau `#tl_panel`. Contient 35 regles CSS (34 selecteurs + 1
  `@keyframes tlDotPulse`) stylant la liste operateurs (tableau d'ordre de
  bataille par fonction/cellule) : `#tl_ops`, `.tl-ops-bar`, `.tl-batch-*`,
  `.tl-grp*`, `.tl-op*`, `.tl-empty`, etc.
- **TacSuite** : `pctac/index.html` — la balise `<style id="tl-orbat-style">`
  elle-meme est ABSENTE (aucun `<style>` inline dans le squelette porte).
  Les 35 regles sont neanmoins TOUTES presentes, verbatim, dans
  `styles/pctac.css` (extraction concatenee, cf. en-tete de ce fichier) — 0
  selecteur manquant (verifie par correspondance exacte des 34 selecteurs +
  `@keyframes tlDotPulse` contre le contenu de `styles/pctac.css`).
  `src/apps/pctac/tchap-live.ts:430` documente egalement ce choix dans son
  propre commentaire : *« les styles de la LISTE operateurs (.tl-ops-bar/
  .tl-grp/.tl-op…) sont definis statiquement dans pctac2.html
  (#tl-orbat-style). On ne garde ici que le marqueur carte. »* — le module
  TS ne recree QUE le style du marqueur cartographique (`.tl-icon`/`.tl-glyph`/
  `.tl-label`, injecte dynamiquement en JS, verbatim planMap-equivalent),
  pas le bloc `#tl-orbat-style` qui n'a jamais eu besoin d'etre dynamique.
- **Justification** : meme categorie que le point 4 ci-dessus (feuilles
  `<link>`/`<style>` retirees du DOM mais dont le contenu est concatene
  VERBATIM dans `styles/pctac.css`) — relocalisation, pas suppression.
  Aucun ecart de contenu CSS, uniquement de VEHICULE (balise `<style>`
  inline au milieu du body vs feuille externe concatenee dans `<head>`).
- **Consequence visuelle** : aucune — les 35 regles s'appliquent de facon
  identique une fois chargees, peu importe le vehicule ; aucune baseline
  visuelle (`tests/visual/baseline/pctac/`) ne differencie les deux formes.
- **Trouve et documente par la mission P3B.FIX (reprise 1), MINEUR R4** —
  ecart reel mais benin, non trace jusqu'ici alors que ses deux voisins
  DOM immediats (`#version-toggle-btn`, point 1 ; `#beta-button`, point 2)
  l'etaient deja.

## 10bis. PC-Tac : second `<style>` inline (ANONYME) — relocalise dans `styles/pctac.css:1706`

- **Original** : `pctac2.html:1916` — `<style>#plan_legend > summary::-webkit-details-marker,
  #plan_legend > summary::marker { display: none; }</style>`, imbriquee juste
  apres la fermeture de `<details id="plan_legend">` (masque le marqueur natif
  du `<summary>` de la legende carte). Contrairement au point 10 ci-dessus,
  cette balise ne porte AUCUN id — c'est le second `<style>` inline du body,
  distinct de `#tl-orbat-style`, que le point 10 ne couvrait pas explicitement
  (son titre et son texte ne visaient que la balise AVEC id).
- **TacSuite** : `pctac/index.html` — balise absente (aucun `<style>` inline
  dans le squelette porte, comme pour le point 10). La regle unique est
  neanmoins presente VERBATIM dans `styles/pctac.css:1706`, sous le
  commentaire `Source 3/4 : <style> inline de pctac2.html, ligne 1916`.
- **Justification** : meme categorie que le point 10 (relocalisation, pas
  suppression) — seul le VEHICULE change (balise `<style>` inline au milieu
  du body vs feuille externe concatenee dans `<head>`), le contenu CSS est
  identique.
- **Consequence visuelle** : aucune — la regle s'applique de facon identique
  une fois chargee, peu importe le vehicule ; aucune baseline visuelle
  (`tests/visual/baseline/pctac/`) ne differencie les deux formes.
- **Bilan DOM body PC-Tac desormais complet** : avec ce point, la categorie
  "`<style>` inline retires du body" est entierement tracee (2/2, points 10 et
  10bis) — le delta d'elements body entre `pctac2.html` et `pctac/index.html`
  est alors integralement explique : -3 `<script>`, -2 `<style>` (points
  10/10bis), -1 `<a id="version-toggle-btn">` (point 1) et +1
  `<a id="portalLink">` (point 6) qui s'annulent au niveau du COMPTE brut
  d'elements (meme s'ils ne sont pas le meme noeud — remplacement, pas
  no-op), +1 `<span>` (point 6, imbrique dans ce `<a id="portalLink">`) —
  soit -4 elements nets.
- **Trouve et documente par la mission P3B.FIX (reprise 3), MINEUR R3** — le
  point 10 (mission precedente) ne couvrait que la balise AVEC id, laissant
  le document incomplet sur la categorie qu'il venait precisement d'ouvrir.

## 11. OI et PC-Tac : liens dock (`#portalLink`, `#pctacLink`, lien OI) — chemins absolus `/…` → relatifs `../…`

- **Points modifies** : `#pctacLink` (point 5, `oi/index.html`), `#portalLink`
  (point 6, `oi/index.html` ET `pctac/index.html`), lien dock PC-Tac vers l'OI
  (point 7, `pctac/index.html`) — les quatre chemins absolus `/pctac/`, `/`
  (x2) et `/oi/` deviennent respectivement `../pctac/`, `../` (x2) et `../oi/`.
- **Original** : aucun (ces liens sont des ajouts purs du portage, cf. points
  5/6/7 ci-dessus — pas d'equivalent legacy a comparer).
- **Justification** : deploiement GitHub Pages sous base `/TacSuite/`
  (`vite.config.ts`, `TACSUITE_BASE`). Vite reecrit les references d'assets
  du HTML (`<link>`, `<script src>`, `<img src>`) avec la base au moment du
  build, mais PAS le contenu des ancres `<a href>` — un chemin absolu
  `/pctac/` reste `/pctac/` apres build, donc pointe hors du sous-repertoire
  `/TacSuite/` une fois deploye (404 sur Pages). Les chemins relatifs
  (`../pctac/` depuis `oi/index.html`, `../` depuis `pctac/index.html`)
  traversent correctement le prefixe de base quel qu'il soit (`/` en dev/
  preview, `/TacSuite/` sur Pages) car ils sont resolus par le navigateur
  contre l'URL de la page courante, pas contre la racine du site.
- **Chemins non touches** : les references d'assets (`href="/favicon.ico"`,
  `href="/manifest.webmanifest"`, `href="/styles/*.css"`,
  `script src="/src/apps/*/main.ts"`, `img src="/portal/*.webp"`) restent en
  chemins absolus — Vite les reecrit deja correctement avec la base au build,
  contrairement aux ancres `<a href>`.
- **Portail racine** (`index.html`) : deja en chemins relatifs (`href="./pctac/"`,
  `href="./oi/"`) depuis sa version courante — aucun changement necessaire sur
  ce fichier pour ce point.
- **Tests ajustes** : `tests/e2e/oi.spec.ts` — assertions `toHaveAttribute('href', …)`
  sur `#pctacLink` (`'/pctac/'` → `'../pctac/'`) et `#portalLink`
  (`'/'` → `'../'`). `tests/e2e/pctac.spec.ts` ne portait aucune assertion
  d'attribut `href` sur ces liens (rien a ajuster). `tests/e2e/offline.spec.ts`
  navigue via `page.goto()` sur des chemins absolus independants du DOM des
  ancres — non concerne.
- **Mission P4.C** (livraison : preparation GitHub Pages).

## Portee de ce document

Les ecarts DOM ci-dessus (points 1 a 10, plus 10bis et 11) sont, a la date du
2026-08-02, la liste exhaustive des divergences constatees entre le DOM des
originaux et celui des squelettes portes. Toute divergence future devra etre
ajoutee ici avant d'etre acceptee par un gate.
