# Baselines visuelles — ORIGINAL (GStart-main, port 9679)

Ce dossier contient les captures de référence de l'application **originale**
(non portée), servie en lecture seule sur `http://127.0.0.1:9679`
(`scripts/serve-original.sh`, source `/home/nico/Bureau/Web/GStart-main`).
Elles servent de référence opposable pour les diffs visuels des phases
suivantes du portage TacSuite (Protocole zéro régression §3, `docs/PLAN.md`).

Spec : `capture-baseline.spec.ts`
Config Playwright dédiée : `playwright.config.ts` (scope local à ce dossier —
voir "Pourquoi un config séparé" ci-dessous)

## Lancer la capture

Prérequis : le serveur original doit tourner sur 9679.

```bash
./scripts/serve-original.sh   # si pas déjà lancé
npx playwright test --config=tests/visual/playwright.config.ts
```

## Pourquoi un config Playwright séparé

Le `playwright.config.ts` racine cible `testDir: './tests/e2e'` avec
`baseURL: http://127.0.0.1:9678` (le TacSuite en cours de portage). Ces
baselines ciblent l'ORIGINAL (9679) via des URLs absolues (`page.goto`
explicite), un serveur différent — pas de `baseURL` pertinent ici.

Élargir le `testDir` racine à `./tests` aurait aussi fait matcher
`tests/unit/smoke.test.ts` (spec **Vitest**, pattern par défaut Playwright =
`**/*.@(spec|test).?(c|m)[jt]s`) et cassé son exécution sous le runner
Playwright. D'où un config scope au dossier `tests/visual/`, reprenant à
l'identique les 2 projets/viewports du config racine (`chromium-desktop`
1440×900, `chromium-mobile` 390×844) pour rester cohérent.

## Nommage

```
tests/visual/baseline/<app>/<etat>-<viewport>.png
```

- `<app>` : `oi` (4.html) ou `pctac` (pctac2.html)
- `<etat>` : identifiant stable de l'état capturé (voir tableaux ci-dessous)
- `<viewport>` : `desktop` (1440×900) ou `mobile` (390×844)

## États capturés — Générateur d'OI (`4.html`)

Un seul test parcourt séquentiellement le wizard (pas de rechargement entre
états — navigation SPA via les puces de la barre de progression, cf.
`docs/recon-oi.md` §3 et §9). Sélecteurs issus de `modules/navigation.js`
(`goToStep(n)`, sauts directs autorisés sans validation bloquante) et
`modules/oi_cartographie.js` (`OICarto.open()`).

| Fichier (`<etat>`) | Étape / action | Sélecteur utilisé |
|---|---|---|
| `step0-situation` | Vue initiale — Étape 1 Situation | (état de chargement, aucun clic) |
| `step1-adversaires` | Étape 2 Adversaires | `.wizard-progress-step` (nth 1) → `goToStep(1)` |
| `step2-environnement` | Étape 3 Environnement | `.wizard-progress-step` (nth 2) |
| `step3-mission` | Étape 4 Mission | `.wizard-progress-step` (nth 3) |
| `step4-execution` | Étape 5 Exécution | `.wizard-progress-step` (nth 4) |
| `step5-articulation-moicp-zmspcp` | Étape 6 Articulation MOICP/ZMSPCP | `.wizard-progress-step` (nth 5) |
| `step6-patracdvr` | Étape 7 PATRACDVR | `.wizard-progress-step` (nth 6) |
| `step7-finalisation` | Étape 8 Finalisation | `.wizard-progress-step` (nth 7) |
| `cartography-modal` | Cartographie OI (dialog modale, init MapLibre paresseuse au 1er open) | `#cartographyBtn` → `<dialog id="cartographyModal">` |

Attente avant chaque capture : 300 ms après le clic (mise à jour synchrone des
classes `.active`) ; `networkidle` (timeout dégradé, jamais bloquant) + 1.2 s
avant `step0-situation` et avant `cartography-modal` (polices Google Fonts,
tuiles MapLibre/Nominatim).

Non capturés (hors périmètre de cette tâche — modales secondaires "outils",
pas des "onglets/sections principales") : `quickEditModal`,
`uniteConfigModal`, `annotationModal` (canvas d'annotation photo),
`effractionToolsModal`, `presentationModal` (aperçu PDF), `resetOptionsModal`,
`importSelectModal`. Ces états relèvent des checklists fonctionnelles
Playwright e2e des phases suivantes (P3.D), pas des baselines visuelles P0.

## États capturés — PC-Tac (`pctac2.html`)

Un seul test parcourt séquentiellement les 7 onglets puis 3 panneaux/outils
de l'onglet Plan (pas de rechargement — navigation SPA via `UI.switchMainView`,
cf. `docs/recon-pctac.md` §1 et §6).

| Fichier (`<etat>`) | Onglet / panneau | Sélecteur utilisé |
|---|---|---|
| `initial-main-courante` | Vue initiale — onglet Main Courante (actif par défaut) | (état de chargement, aucun clic) |
| `tab-adversaires` | Onglet Adversaires | `.tab-btn[data-view="view-adversaires"]` |
| `tab-otages` | Onglet Otages | `.tab-btn[data-view="view-otages"]` |
| `tab-amis` | Onglet Amis | `.tab-btn[data-view="view-amis"]` |
| `tab-photos` | Onglet Photos | `.tab-btn[data-view="view-photos"]` |
| `tab-plan` | Onglet Plan (carte MapLibre chargée) | `.tab-btn[data-view="view-plan"]` |
| `tab-liens` | Onglet Liens (liens externes statiques) | `.tab-btn[data-view="view-liens"]` |
| `tab-plan-panneau-recherche` | Plan → bandeau recherche adresse/GPS ouvert | `#plan_btn_search` → `#plan_search_panel.open` |
| `tab-plan-dock-dessin` | Plan → dock outils de dessin ouvert (trait/rect/cercle/texte/mesure) | `#plan_btn_draw` → `#plan_draw_dock.open` |
| `tab-plan-panneau-tchap-live` | Plan → panneau géoloc équipe live (Tchap) ouvert | `#tl_toggle` → `#tl_panel` (`display:block`) |

Attente avant chaque capture : 300 ms après le clic (toggle synchrone de
classes/style) ; `networkidle` (dégradé, timeout 15 s) + 1.2 s avant
`initial-main-courante` (la carte MapLibre s'initialise dès `main.js`, même
onglet Main Courante actif) et avant `tab-plan` (rechargement des tuiles au
`resize()` déclenché par `PlanMap.refresh()`).

Non capturés (hors périmètre — outils secondaires nécessitant une
interaction carte supplémentaire, pas de simple clic d'ouverture de
panneau) : roue contextuelle de ping (`plan_btn_ping`, nécessite un point
sur la carte), mesure distance/azimut, verrou par-annotation, capture
carto (`plan_btn_capture`), AOI hors-ligne (`plan_btn_aoi`, arme un
cadrage rectangle one-shot — pas d'état visuel distinct au clic seul, et
risque de déclencher un vrai téléchargement de tuiles), 2D/3D relief,
plein écran, modales d'édition (adversaire/otage/ami/photo), transfert QR,
dock flottant (`#dockMenu`) dans ses 2 états replié/déployé, tuto interactif
(`window.PocheTuto`). Ces états relèvent des checklists fonctionnelles
Playwright e2e des phases suivantes (P2.E), pas des baselines visuelles P0.

## Zones à MASQUER dans les comparaisons visuelles FUTURES

Les baselines de ce dossier NE masquent rien elles-mêmes (première capture
de référence — les tuiles telles que chargées au moment du run, ainsi que
les boutons BETA d'origine, font partie intégrante du PNG). Pour les diffs
ultérieurs (TacSuite porté vs baseline), masquer impérativement :

| App | État(s) concerné(s) | Élément à masquer | Raison |
|---|---|---|---|
| PC-Tac | `tab-plan`, `tab-plan-panneau-*` | `canvas.maplibregl-canvas` dans `#plan_map` | Tuiles IGN/ESRI/OpenFreeMap chargées en réseau au moment du test — rendu non déterministe (cache CDN, disponibilité tuile, angle de éclairage/saison des couches satellite) |
| OI | `cartography-modal` | `canvas.maplibregl-canvas` dans `#oi_carto_map` | Idem — cartographie OI (`oi_cartographie.js`), tuiles réseau |
| PC-Tac | Tous les états pctac (10 états / 20 captures — élément d'en-tête, présent sur toutes) | `#version-toggle-btn` | Élément supprimé du portage (écart admis, cf. `docs/DECISIONS-DOM-ECARTS.md` §1), présent dans la baseline (original) mais absent du porté (TacSuite) |
| OI | Tous les états oi (9 états / 18 captures — élément d'en-tête, présent sur toutes) | `#beta-button` | Idem, cf. `docs/DECISIONS-DOM-ECARTS.md` §2 |

**Correction (P0.FIX reprise 2)** — la phrase précédente de cette section
affirmait à tort que les captures hors carte pouvaient être comparées
« pixel à pixel sans masque ». C'est FAUX : les états carte (`tab-plan*`,
`cartography-modal`) nécessitent le masque `canvas.maplibregl-canvas`
ci-dessus, et **toutes les autres captures des deux apps** (donc les 38
baselines sans exception, chaque état contenant l'en-tête) montrent le
bouton BETA (`#version-toggle-btn` côté PC-Tac, `#beta-button` côté OI),
absent du porté. Son masque est donc également OBLIGATOIRE, sur 100 % des
états, pas seulement sur les états carte.

### Écart volontaire : lien portail (`#portalLink`, mission P3B.C)

`P3B.C` ajoute un lien de retour vers le portail TacSuite (`#portalLink`,
icône `home`) dans les docks PC-Tac et OI — absent des originaux (aucun
portail n'existait), cf. `docs/DECISIONS-DOM-ECARTS.md` §6. Analyse de
l'impact sur `tests/visual/compare.mjs pctac` (seul gate visuel requis par
cette mission) :

- **PC-Tac** : `#dockMenu` porte `class="dock-menu collapsed"` par défaut, et
  `.dock-menu.collapsed .dock-menu-item:not(#dockToggleBtn) { display:
  none; }` (`styles/pctac.css`) masque tous les items du dock sauf le
  toggle. Aucun des 10 états de `compare.mjs pctac` (`APP_CONFIG.pctac`
  ci-dessus) ne clique `#dockToggleBtn` : `#portalLink` reste `display:none`
  dans les 20 captures (2 viewports), donc invisible et sans impact sur le
  diff pixel. **Aucun masque ajouté à `HEADER_MASK`/`compare.mjs` — vérifié
  inutile, pas un oubli.**
- **OI** : à la différence de PC-Tac, `#dockMenu` de `oi/index.html` N'A PAS
  la classe `collapsed` par défaut (dock déployé au premier rendu) —
  `#portalLink` y est donc visible dès le chargement, sur les 9 états / 18
  captures de baseline OI. `compare.mjs oi` n'était PAS un gate de la mission
  P3B.C (seul `compare.mjs pctac` était requis par ce mandat-là) et n'avait
  pas été relancé/corrigé à ce moment.

**Mise à jour (P3B.E, `compare.mjs oi` redevenu un gate actif)** : masque
ajouté à `tests/visual/compare.mjs` (`PORTAL_LINK_MASK.oi`). Premier essai
insuffisant : masquer seulement le rectangle du nouvel icône (mesuré
56×56 desktop / 38×52 mobile) laissait 16/18 états en FAIL (~0,13-0,43 %,
juste au-dessus du seuil 0,1 %) — `#dockMenu` est une barre flex CENTRÉE
sans `collapsed` côté OI, donc insérer un item de plus RECENTRE toute la
barre et translate tous les icônes voisins d'une largeur de slot, pas
seulement `#portalLink` lui-même. Le masque couvre donc désormais la
bounding box entière de `#dockMenu` (mesurée en direct sur le porté) :

| Viewport | x | y | w | h |
|---|---:|---:|---:|---:|
| desktop 1440×900 | 427 | 802 | 586 | 74 |
| mobile 390×844 | 16 | 766 | 358 | 62 |

Avec ce masque : `node tests/visual/compare.mjs oi` → **18/18 PASS**
(0,009-0,047 % desktop et mobile confondus), stable sur re-runs consécutifs.
Aucun impact sur `compare.mjs pctac` (masque scopé à la clé `oi` de
`PORTAL_LINK_MASK`, absente pour `pctac`) — revérifié **20/20 PASS**.

### Chrome au-dessus du canvas plein écran (`cartography-modal`, P3B.FIX)

`#cartographyModal` est un `<dialog>` `100vw`/`100vh` (4.html:3613-3620,
verbatim) : `canvas.maplibregl-canvas` y occupe donc la totalité du
viewport, sans aucun chrome de PAGE visible autour (contrairement aux états
carte de PC-Tac). La seule zone de chrome réelle est `.oi-carto-toolbar`
(colonne de 8 FABs circulaires `.oi-carto-fab`, ⌀50px chacun), qui flotte
par-dessus le canvas.

**Reprise 1 (BLOQUANT R3)** démasquait le rectangle ENGLOBANT de
`.oi-carto-toolbar` (50×456) pour lui redonner un statut d'assertion réelle
plutôt que de le noyer dans le masque canvas — mais une colonne de disques
séparés par des interstices TRANSPARENTS laisse le canvas visible à travers
ces interstices, ce qui réintroduit le non-déterminisme (tuiles réseau) que
le masque canvas existe pour supprimer. Mesuré sur 8 exécutions du dépôt :
2 régimes discrets sur `cartography-modal-desktop` — 332px (tuiles déjà
chargées au clic) / 8036px = bbox entière de la toolbar (tuiles pas encore
chargées), `run()` n'attendant qu'un `waitForTimeout(500)` fixe sans
attendre la fin de chargement des tuiles.

**Reprise 2 (BLOQUANT R3bis)**, deux correctifs combinés :
1. `unmaskSelector: '.oi-carto-toolbar .oi-carto-fab'` — un rect **par
   bouton** (8 × 50×50) plutôt qu'un seul rect englobant. Les interstices
   retombent dans le masque canvas (non comparés) ; `paintMask()` accepte
   désormais un tableau d'exclusions (`excludeRects`) au lieu d'un rect
   unique.
2. `state.waitForMapIdle: true` — après le clic, `captureState()` attend
   `window.OICarto.map.loaded() && .areTilesLoaded()` (API publique
   maplibre-gl, filet de sécurité 5s) avant la capture, en plus de
   `networkidle` (qui ne couvre que les requêtes réseau, pas le rendu
   interne MapLibre).

Vérifié : 8 exécutions consécutives de `node tests/visual/compare.mjs oi`
→ **exit 0**, `cartography-modal-desktop` stable à **220px (0,017 %)**
pixel-pour-pixel identique à chaque run (crop toolbar isolé : md5 identique
sur 5 captures indépendantes). `MAX_CANVAS_MASK_PCT` (99 %) reste valide
sans modification : masque désormais ~98,46 % (8×50×50 = 20 000 /
1 296 000 px, mesuré) au lieu de ~98,24 % avant — toujours sous le seuil.

**Résidu 332px → 220px, root cause (MOYEN)** : le résidu documenté en
reprise 1 (anneau de focus bleu sur le 1er bouton, `#oi_carto_btn_search`,
absent de la baseline) N'EST PAS un écart DOM/CSS du portage — vérifié par
sonde directe (`getComputedStyle`) : `outline`/`box-shadow`/`:focus-visible`
sont **strictement identiques** (mêmes valeurs calculées, même règle globale
`:focus-visible { outline: ... !important }` de `shared/ui-platform.css`,
chargée par les deux apps) entre l'ORIGINAL (9679) et le porté (9678) à
séquence d'interaction égale. La divergence est un artefact de
**méthodologie de capture** : le heuristique `:focus-visible` de Chromium
dépend de l'historique d'interaction de la page — `capture-baseline.spec.ts`
parcourt les 7 étapes du wizard par clics réels AVANT d'ouvrir la
cartographie (session continue), tandis que `compare.mjs` fait un
`page.goto` frais puis un clic immédiat sur `#cartographyBtn` PAR ÉTAT (états
indépendants). Reproduit à l'identique sur l'ORIGINAL seul (sans toucher au
porté) : séquence "goto frais + clic immédiat" → anneau visible
(`:focus-visible` = true) ; séquence "7 clics wizard puis clic" → anneau
absent (`:focus-visible` = false, `activeElement` identique mais sans
indicateur visuel) — les DEUX comportements sont donc légitimes et
reproductibles sur l'original lui-même, purement fonction du chemin
emprunté par le harnais de test, pas d'une régression du produit. **Pas
d'entrée `DECISIONS-DOM-ECARTS.md`** en conséquence (réservé aux écarts DOM
réels type `#portalLink`/`#tl-orbat-style`) : il n'y a rien à corriger côté
application, le masquage par bouton (ci-dessus) réduit mécaniquement le
résidu (332→220px) en excluant la majorité du halo (`outline`/`box-shadow`
dessinés hors de la boîte de bordure du bouton, donc hors du rect
50×50 démasqué) sans avoir besoin de le neutraliser explicitement ; le
reliquat (bord de l'arc du 1er bouton + quelques pixels d'antialiasing
d'icône sur les boutons 2-4) reste largement sous le seuil de 0,1 %.

### Baselines mode clair OI (`oi-light`, P3B.E)

Les 18 baselines Phase 0 de `tests/visual/baseline/oi/` sont toutes en mode
**sombre** (défaut de `4.html`, cf. `docs/DECISIONS-CSS.md` §6.3). Un trou de
couverture mode clair a été comblé en amont par capture sur l'ORIGINAL
(`.tacsuite-prep/capture-oi-light.mjs` → `.tacsuite-prep/oi-baseline-light/`,
18 PNG, mécanisme documenté dans son propre `README.md`) — intégré ici tel
quel dans `tests/visual/baseline/oi-light/` (mêmes 9 états × 2 viewports,
mêmes noms de fichiers).

`tests/visual/compare.mjs` définit une clé d'app dédiée `oi-light`
(`APP_CONFIG['oi-light']`, mêmes `states`/`entryUrl` que `oi`, ajoute
`theme: 'light'`) : `captureState()` bascule le porté en mode clair par un
clic réel sur `#darkModeToggle` (même mécanisme que
`capture-oi-light.mjs`), avec un garde nécessaire ici : contrairement à
`capture-oi-light.mjs` (une seule navigation par viewport, thème basculé une
fois puis navigation SPA entre états), `compare.mjs` fait un `page.goto` par
ÉTAT — dès le 2e état, `localStorage.theme` (persistée par
`handleThemeToggle()` au 1er clic) fait déjà démarrer la page en
`light-mode` ; cliquer à nouveau sans garde la ferait REBASCULER en sombre
(bug constaté à l'implémentation : 9/18 états en `ERROR` par timeout,
exactement 1 état sur 2 — la parité trahissant l'aller-retour clair/sombre à
chaque état). Corrigé en ne cliquant que si `body` n'est pas déjà
`light-mode`. `HEADER_MASK`/`PORTAL_LINK_MASK` réutilisés tels quels pour
`oi-light` (mêmes bounding boxes qu'en mode sombre — la bascule de thème ne
change que des couleurs, aucune propriété de layout, vérifié dans
`oi-baseline-light/README.md`).

`node tests/visual/compare.mjs oi-light` → **18/18 PASS** (0,009-0,052 %),
stable sur re-runs consécutifs.

### Forme naïve envisagée puis REJETÉE (piège documenté ci-dessous)

```ts
// Côté PC-Tac
await page.screenshot({
  mask: [page.locator('#version-toggle-btn'), page.locator('canvas.maplibregl-canvas')],
});

// Côté OI
await page.screenshot({
  mask: [page.locator('#beta-button'), page.locator('canvas.maplibregl-canvas')],
});
```

Cette forme n'est PAS celle utilisée par `tests/visual/compare.mjs` (voir
« Stratégie retenue » ci-dessous pour l'implémentation réelle) — elle est
conservée ici uniquement à titre d'exemple du piège à ne pas reproduire.

**Piège à éviter** : cette forme, prise telle quelle, ne suffit PAS pour
`#version-toggle-btn` / `#beta-button`. Playwright peint le masque sur la
capture de la page **effectivement screenshotée au moment de l'appel** —
ici la page COMPARÉE, c'est-à-dire le porté servi sur 9678. Or
`#version-toggle-btn` / `#beta-button` n'existent PLUS dans le DOM du porté
(c'est précisément l'écart admis) : `page.locator(...)` y résout 0 élément,
donc `mask` n'y peint rien pour ces deux sélecteurs. Et la baseline en face
est un PNG déjà enregistré sur disque (`tests/visual/baseline/...png`), pas
une page vivante — impossible d'y appliquer un `Locator` Playwright au
moment du diff. En s'arrêtant à la forme ci-dessus, la zone du bouton BETA
resterait donc intégralement visible (bouton réel) côté baseline et
intégralement vide côté porté → diff garanti à ~100 % des pixels de cette
zone sur les 38 états, quel que soit le seuil retenu.

**Stratégie retenue : masquage par RECTANGLE FIXE**, appliqué identiquement
aux DEUX images (baseline ET capture du porté) par le script de comparaison
de P2.F/P3.D, indépendamment de la présence du sélecteur DOM. Concrètement :
avant `pixelmatch` (ou équivalent), peindre le même rectangle (couleur
unie) aux mêmes coordonnées pixel sur les deux images — une copie en
mémoire de la baseline, le fichier `.png` sur disque restant intact — puis
differ normalement. Coordonnées mesurées au navigateur sur l'original
(127.0.0.1:9679, `devices['Desktop Chrome']` sans override de
`deviceScaleFactor` → 1, cf. `playwright.config.ts` racine et
`tests/visual/playwright.config.ts`) :

| Sélecteur (original) | Viewport | x | y | w | h |
|---|---|---:|---:|---:|---:|
| `#version-toggle-btn` (`pctac2.html`) | desktop 1440×900 | 1144 | 45 | 61 | 36 |
| `#version-toggle-btn` (`pctac2.html`) | mobile 390×844 | 324 | 30 | 46 | 28 |
| `#beta-button` (`4.html`) | desktop 1440×900 | 1066 | 66 | 68 | 46 |
| `#beta-button` (`4.html`) | mobile 390×844 | 332 | 24 | 40 | 26 |

Ces 4 rectangles sont des CONSTANTES (pas de bounding box interrogée en
direct), à la différence de `canvas.maplibregl-canvas` qui existe des deux
côtés (bounding box interrogeable en direct sur le porté et réutilisable
telle quelle sur la baseline, layout DOM/CSS identique par protocole) : il
n'y a côté porté aucun élément équivalent à `#version-toggle-btn` /
`#beta-button` à partir duquel dériver une position. Elles restent valables
tant que la mise en page de l'en-tête ne change pas — à revérifier si P2.F
/ P3.E (modernisation CSS) déplacent les éléments d'en-tête adjacents.

**Correction (P2.FIX reprise 2)** — ces 4 rectangles sont des constantes
mesurées à l'état NON défilé (`scrollY=0`), ce qui est le cas de la quasi
totalité des états capturés MAIS PAS de tous : côté PC-Tac, l'état
`tab-plan-panneau-tchap-live` (clic sur `#tl_toggle`, ouverture du panneau
Tchap live) fait défiler la page de ~28-32 px en mobile (390×844) et
~228 px en desktop (1440×900) avant la capture finale. Appliquer le
rectangle constant tel quel désaligne le masque de la position réelle du
bouton BETA dans l'image (mesuré directement sur les PNG de baseline :
`x=324..369 y=30..57` dans `tab-plan-mobile.png`/`initial-main-courante-mobile.png`
non défilés, mais `x=324..369 y=2..25` dans
`tab-plan-panneau-tchap-live-mobile.png`, défilé) — le masque manque
intégralement sa cible et le bouton fuit dans le diff (mesuré : 393 px de
diff sur cet état, 0,119 % > seuil 0,1 %, contre ~204 px / 0,062 % attendu
hors ce défaut).

`tests/visual/compare.mjs` corrige ceci en relevant `window.scrollY` côté
page vivante (le porté, seul capturable en direct) juste avant le
screenshot de chaque état, puis en translatant le rectangle constant de
`-scrollY` avant de peindre le masque sur LES DEUX images (baseline
figée ET capture fraîche) — le layout DOM/CSS étant identique des deux
côtés par protocole zéro régression, le même décalage de scroll s'applique
aux deux. Les coordonnées `x`/`y` du tableau ci-dessus restent donc les
constantes de référence (état non défilé) ; c'est uniquement au moment du
diff que `y` est ajusté dynamiquement. Sans effet sur les états qui ne
défilent pas (`scrollY=0` → rectangle inchangé).

**Alternative écartée** : re-capturer les 38 baselines avec les boutons
BETA neutralisés (ex. `display:none` injecté) dans l'original. Rejetée
pour ne pas invalider/refaire les 38 captures déjà produites et validées
(gate P0.A6), et parce que la neutralisation via CSS provoquerait un
reflow de l'en-tête sur l'original (les éléments voisins du bouton BETA
se repositionneraient), ce qui changerait la baseline au-delà de la seule
zone du bouton — effet de bord non maîtrisé que le rectangle fixe évite
totalement.

## États inatteignables / notes d'exécution

Voir le compte-rendu de la tâche pour le résultat effectif du run (nombre de
captures produites, écarts éventuels). Un `dialog` natif (`alert()`) peut en
théorie apparaître sur `cartography-modal` si `maplibregl` échoue à se
charger depuis le CDN unpkg (`oi_cartographie.js` : *"Librairie
cartographique indisponible (réseau ?)"*) — le test l'intercepte et le
journalise (`console.warn`) sans faire échouer la capture, l'état
`cartography-modal` serait alors une modale vide/dégradée plutôt qu'un échec
de test.
