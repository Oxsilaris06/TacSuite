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

### Forme d'appel à utiliser en P2.F / P3.D

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
