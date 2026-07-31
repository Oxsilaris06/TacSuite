# Reconnaissance exhaustive — PC-Tac (GStart-main)

Racine du projet : `/home/nico/Bureau/Web/GStart-main`
Point d'entrée déclaré : `pctac2.html`. Un fichier quasi-identique `pctac.html` coexiste
(voir §1 et §7 — divergence d'un seul lien).

Sources graphify consultées : `graphify-out/GRAPH_REPORT.md` (795 lignes, lu en entier).
Pas de `graphify-out/wiki/index.md` (dossier `wiki/` absent) → navigation faite par
lecture directe des fichiers + grep ciblés. Les god nodes `_()`, `_`, `$()`, `de`, `ts`,
`f`, `ta`, `e()`, `Ut()`, `va()` sont tous des symboles minifiés de MapLibre GL
(vendor/maplibre-gl.js) — bruit, ignorés comme demandé.

---

## 1. Point d'entrée — structure de `pctac2.html`

2396 lignes. Pas de framework, HTML + CSS inline (`<style>` lignes 57–1531) + scripts
classiques + un unique module ESM final.

### Ordre exact de chargement (`<head>` puis fin de `<body>`)
```
1.  <script> inline (lignes 8-16)         — handlers window.onerror / unhandledrejection (log console)
2.  shared/ui-platform.css                — CSS partagé OI+PC-Tac
3.  shared/ui-platform.js                 — script classique, expose window.UIPlatform (idempotent)
4.  fonts Google (Oswald/Inter/JetBrains Mono) + Material Symbols Outlined (CDN, réseau)
5.  vendor/qrcode.min.js                  — génération QR (QrSync)
6.  vendor/html5-qrcode.min.js            — lecture QR caméra (QrSync)
7.  vendor/maplibre-gl.css + vendor/maplibre-gl.js  (v4.7.1, vendoré)
8.  vendor/html2canvas.min.js             (v1.4.1)  — screenshot plan + dashboard
9.  vendor/jszip.min.js                   (v3.10.1) — archive .pctac.zip
    ... <body> (DOM, cf. §1 structure + §6) ...
10. vendor/pdf-lib.min.js                 (juste avant </body>, "Version 2.0")
11. modules/tuto-engine.js                — script classique, expose window.PocheTuto
12. modules/pctac/tuto_data.js            — script classique (IIFE), appelle PocheTuto.mount({appId:'pctac',...})
13. modules/pctac/main.js  <script type="module">  — SEUL point d'entrée ESM, importe toute la couche modules/pctac/*
```
Note : `type="module"` n'apparaît qu'une seule fois (main.js) — tous les imports
inter-modules (`storage.js`, `ui.js`, `planMap.js`, etc.) transitent par cet unique
graphe ESM, chargé en dernier.

### CSS
- `shared/ui-platform.css` (141 lignes, externe)
- Un unique gros bloc `<style>` inline (lignes 57–1531, ~1475 lignes) définissant le thème
  "Tactical Glass" (variables CSS `--bg-*, --accent-*, --font-*, --space-*...`), avec un
  bloc explicite de **parité de vocabulaire de design avec l'OI (4.html)** (commentaire
  ligne 115-119 : « noms pctac existants restent valides, on ajoute les noms OI + alias
  croisés »). Deux petits `<style>` secondaires inline (lignes 1916, 1963) pour des
  détails ponctuels (masquer le marker `<summary>` de `#plan_legend`, styles `#tl_*`).

### Structure DOM principale (`<body class="dark-mode">`)
- `.container` > lien toggle `#version-toggle-btn` (BETA → pctac.html) + `<h1>PC TAC</h1>`
- `<nav class="main-tab-bar">` — 7 boutons `.tab-btn[data-view=...]` (rôle ARIA tablist posé
  en JS via `UIPlatform.makeTablist`) :
  `view-main-courante, view-adversaires, view-otages, view-amis, view-photos, view-plan, view-liens`
- 7 `<div class="tab-content-view" id="view-...">` correspondants (un seul `.active` à la fois,
  géré par `UI.switchMainView`)
- Modales : `pingModal`, `planTextModal`, modales d'édition adversaire/otage/ami/photo,
  `lightboxModal`, modale de transfert QR (`transferModal`/`modalBackdrop`, cf. qrSync.js)
- `#dockMenu` — dock flottant global (archive export/import, import OI→PCTAC, thème,
  plein écran, PDF, reset). Le bouton **Tuto** n'est PAS dans le HTML statique : il est
  injecté dynamiquement par `tuto-engine.js` dans `#dockMenu` après `#dockToggleBtn`
  (cf. `modules/pctac/tuto_data.js:17-24`, `dock.selector:'#dockMenu'`).
- `#archiveImportInput`, `#oiImportInput` : `<input type="file" style="display:none">` cachés

---

## 2. Inventaire exhaustif des modules JS

Racine des modules PC-Tac : `modules/pctac/` (ESM) + 2 fichiers classiques partagés à la
racine de `modules/` (`modules/tuto-engine.js`) et `shared/` (`shared/ui-platform.js`).

| Fichier | LOC | Rôle | Exports ESM | window.* exposé | Dépend de (import) |
|---|---:|---|---|---|---|
| `modules/pctac/config.js` | 317 | Constantes globales : clés localStorage, catalogues (PHOTO_CATEGORIES, FREE_MODE_COLORS, PDF_PAX_COLORS, PIN_ICONS ~80 icônes), matching flou (`normalizeForMatch`, `suggestPinIcons`, `labelTokens`, `matchPhotosByLabel`), `BOARD_NODE_TYPES` (pour dashboard.js) | `LOCAL_STORAGE_KEY, TP_ASSOC_KEY, ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY, DASHBOARD_KEY, PHOTO_CATEGORIES, FREE_MODE_COLORS, PDF_PAX_COLORS, QR_BATCH_SIZE, LONG_PRESS_DELAY, PIN_ICONS, normalizeForMatch(), suggestPinIcons(), BOARD_NODE_TYPES, labelTokens(), matchPhotosByLabel()` | `PIN_ICONS, suggestPinIcons, LOCAL_STORAGE_KEY, PHOTO_CATEGORIES, FREE_MODE_COLORS, PDF_PAX_COLORS` | aucune (pur) |
| `modules/pctac/persist.js` | 258 | Couche transactionnelle localStorage : ne jette jamais sur quota, backup `<key>.bak` si JSON corrompu/rejeté par validateur, émet `window` CustomEvent `pctac:quota`. **Module standalone, zéro import** (le "socle Fondations") | `Persist { get, set, getRaw, setRaw }` + `export default Persist` | non (import-only, jamais posé sur window) | aucune |
| `modules/pctac/storage.js` | 117 | Façade localStorage par domaine (log, collections génériques, pins/vues/formes du plan, associations TP, historique lieux), toute I/O passe par `Persist` | `Storage { saveLogData, loadLogData, getTpAssociations, saveTpAssociation, saveCollection, loadCollection, ... }` | `window.saveLogData/loadLogData/getTpAssociations/saveTpAssociation` (bind) | `config.js`, `persist.js` |
| `modules/pctac/collectionManagers.js` | 51 | Classe générique `CollectionManager(key)` (CRUD + id auto) instanciée 4× | `AdversaryManager, HostageManager, FriendManager, PhotoManager` (instances) | non | `storage.js`, `config.js` |
| `modules/pctac/coords.js` | 158 | Conversion géo pure (aucun réseau/clé API) : UTM (Snyder USGS), MGRS (lettrage USNG standard), DMS. Vérifié : (0,0)→"31N AA 66021 00000" | `latLngToUtm(), latLngToMgrs(), formatCoordsClipboard(), shortMgrs()` | non | aucune (pur calcul) |
| `modules/pctac/wheel.js` | 351 | Composant générique de menu radial (roue contextuelle) sur la carte, sous-menus via `children:()=>[...]`, fermeture tap-dehors/Échap/destroy | `class Wheel` | non | aucune |
| `modules/pctac/imageStore.js` | 154 | Cache image binaire dans IndexedDB (`pcTacImages`/store `images`), migration one-shot base64→IDB depuis 3 collections localStorage, flag `pcTacIdbMigratedV1` | `ImageStore { get, set, delete, migrateFromLocalStorage, ... }` | `window.ImageStore` | aucune |
| `modules/pctac/logManager.js` | 139 | Logique métier journal (main courante) : ajout d'entrée, historisation lieux (`pcTacLieuHistory`) | `LogManager { addEntry, ... }` | `window.LogManager` | `storage.js`, `persist.js`, `config.js` |
| `modules/pctac/qrSync.js` | 193 | Transfert de données par QR code (chunking, scan caméra html5-qrcode, génération qrcode.js) — mécanisme historique, largement remplacé par l'archive .pctac.zip (archive.js) mais toujours présent | `QrSync { chunkArray, openModal, closeModal, switchTab, html5QrCode, qrChunks, currentIndex, ... }` | `window.QrSync` | `config.js`, `storage.js` |
| `modules/pctac/archive.js` | 459 | Export/import "tout-en-un" `.pctac.zip` (JSZip) : `manifest.json + data.json + images/<id>.bin + images.json`. Gère aussi l'import legacy `.json` et la **passerelle OI→PC-Tac** (lit l'archive `.oi.zip` du générateur 4.html, clé `tactical_oi_data`, dédup par `_normName`) | `Archive { exportZip, importFile, _importLegacyJson, importOiArchive?, ... }` | `window.Archive` | `storage.js`, `imageStore.js`, `config.js` |
| `modules/pctac/pdfExport.js` | 596 | Export PDF (pdf-lib) multi-pages : journal, fiches adversaires/otages/amis, photos par catégorie, snapshot carte (`PlanMap.captureToDataUrl`), board relationnel (`Dashboard.captureToDataUrl` — mais Dashboard non chargé, cf. §7). Recompresse tout PNG lourd en JPEG avant embed (`dataUrlToJpeg`) | `PdfExport { buildPdf/downloadOiPdf-like API, ... }` | `window.PdfExport` | `storage.js`, `imageStore.js`, `config.js` |
| `modules/pctac/ui.js` | 890 | Contrôleur UI central : refs DOM (`elements`), rendu du tableau journal + drag&drop réordonnancement, navigation onglets (`switchMainView`), CRUD adversaires/otages/amis/photos, modales d'édition, palettes couleur, dark/light, plein écran, recherche/filtre | `UI { initElements, switchMainView, openEditModal, renderLogTable, setPaxMode, toggleSearchMode, filterLogs, hideEdit*Modal, ... }` (~45 méthodes) | `window.UI, window.setPaxMode, window.openEditModal, window.switchMainView, window.toggleSearchMode, window.closeSearchMode, window.filterLogs` (tous bind) | `config.js`, `storage.js`, `imageStore.js`, `logManager.js` |
| `modules/pctac/planMap.js` | 5596 | **Plus gros module.** Vue carte tactique MapLibre : recherche adresse (Nominatim OSM, sans clé), pins liés-entité + libres (icônes OTAN), dessin (trait/rectangle/cercle/texte), mesure distance/azimut, verrou global + par-annotation, mode 3D relief, cache hors-ligne AOI, capture PNG (`captureToDataUrl`, contrat "C2"), export coords presse-papier (`coords.js`), intégration roue contextuelle (`wheel.js`). 190 membres top-niveau. | `PlanMap` (objet énorme) | `window.PlanMap` | `storage.js`, `config.js`, `wheel.js`, `persist.js`, `coords.js` |
| `modules/pctac/tchapLive.js` | 961 | Géoloc temps réel d'une équipe depuis un salon Tchap/Matrix **non chiffré** (Forum), via `/sync` HTTP direct (PAS de SDK, pas de crypto) — 2 modes auth : ProConnect OAuth device-code (RFC 8628, refresh auto) ou token manuel (~5 min). Pose des marqueurs `maplibregl.Marker` sur `window.PlanMap`, panneau `#tl_*`, liste opérateurs groupée par cellule/fonction. Se câble tout seul au chargement (`if (document.readyState==='loading') ... else wireUI()`) | `TchapLive { startManual, startOidc, stop, wireUI }` (export non posé sur window) | non (auto-exécuté par effet de bord à l'import) | `persist.js` ; lit `window.PlanMap` en interne |
| `modules/pctac/dashboard.js` | 1232 | Board relationnel "tableau de chasseur de prime" (nœuds Lieu/Adversaire/Otage/Véhicule/Piégeage, liens, capture html2canvas). **Existe mais N'EST PLUS IMPORTÉ par main.js** — commentaire explicite : « VOLONTAIREMENT débranché — inefficace en l'état... Ne pas réimporter sans décision explicite ». L'onglet `view-liens` du DOM contient en réalité des liens externes statiques (Google Maps/Earth, Tchap), pas ce board. | `Dashboard { show, init, render, refresh, captureToDataUrl, destroy }` + `export default` | `window.Dashboard` (mais jamais posé en pratique, le fichier n'est jamais importé) | `config.js`, `storage.js`, `persist.js`, `imageStore.js` |
| `modules/pctac/main.js` | 546 | Point d'entrée ESM : bootstrap DOMContentLoaded, enregistrement Service Worker, migration IndexedDB, init UI/onglets/thème, listeners globaux (soumission log, dock, import/export archive, passerelle OI, delete handlers exposés sur window) | (script, pas d'export) | `window.deleteLogEntry, window.deleteCollectionItem` (définis inline) | quasi tous les modules ci-dessus |
| `modules/pctac/utils.js` | 52 | Utilitaire unique : compression image (Canvas resize + JPEG quality) | `Utils { compressImage() }` | non (jamais posé sur window ; consommé via import direct dans main.js) | aucune |
| `modules/pctac/tuto_data.js` | 964 | Données du tutoriel interactif PC-Tac (généré, verbatim UI) — appelle `window.PocheTuto.mount({appId:'pctac', dock:{selector:'#dockMenu',...}, data:{...}})` | (IIFE, pas d'export) | consomme `window.PocheTuto` | dépend de `tuto-engine.js` chargé avant |
| `modules/tuto-engine.js` (racine `modules/`, **partagé OI+PC-Tac**) | 755 | Moteur générique de tutoriel pas-à-pas réutilisable (`window.PocheTuto.mount(cfg)`), injecte son propre bouton flottant `.ptuto-fab` ou s'intègre dans un dock existant (`cfg.dock`), persiste progression/vus dans localStorage `ptuto_<appId>_seen/_pos/_greeted` | `window.PocheTuto = { mount, ... }` | `window.PocheTuto` | aucune |
| `shared/ui-platform.js` (racine `shared/`, **partagé OI+PC-Tac**) | 319 | Socle UI transverse "native-quality" : échappement HTML, persistance d'état UI, lock/unlock scroll, clamp viewport, long-press/double-tap, listes triables tactiles, dialogs/tablist accessibles a11y | `window.UIPlatform = { esc, escAttr, loadState, saveState, persistState, lockScroll, unlockScroll, clampToViewport, onLongPress, onDoubleTap, sortable, makeDialog, makeTablist }` | idem | aucune |

**Total LOC applicatif PC-Tac (modules/pctac/* + pctac2.html) : 16 900 lignes**
(dont `planMap.js` seul = 5596, soit 33% du total). En excluant `dashboard.js` (débranché,
1232 lignes mortes) et en comptant les 2 fichiers partagés (`tuto-engine.js` 755,
`ui-platform.js` 319) au prorata, le code **réellement exécuté** au runtime avoisine
**~15 700 lignes** (HTML inclus).

### Graphe de dépendances (résumé)
```
persist.js (0 dep)
 └─ storage.js, logManager.js, planMap.js, tchapLive.js, dashboard.js(mort)
config.js (0 dep) ── consommé par presque tous
coords.js (0 dep) ── planMap.js
wheel.js  (0 dep) ── planMap.js
storage.js ── collectionManagers.js, archive.js, pdfExport.js, ui.js, planMap.js, logManager.js, qrSync.js
imageStore.js ── archive.js, pdfExport.js, ui.js, main.js, dashboard.js(mort)
main.js ── importe TOUT (storage, ui, logManager, pdfExport, utils, imageStore,
            planMap [side-effect], tchapLive [side-effect], persist, config)
```
Aucun cycle d'import détecté par graphify (« Import Cycles: None detected »).

---

## 3. Contrats globaux `window.*`

| Global | Posé par | Signature / forme | Consommateurs |
|---|---|---|---|
| `window.UIPlatform` | `shared/ui-platform.js` (script classique, chargé en tout premier) | `{esc, escAttr, loadState, saveState, persistState, lockScroll, unlockScroll, clampToViewport, onLongPress, onDoubleTap, sortable, makeDialog, makeTablist}` | `ui.js` (esc), `planMap.js` (escHtml), `main.js` (makeTablist pour les onglets) — **partagé avec 4.html** |
| `window.PocheTuto` | `modules/tuto-engine.js` | `{ mount(cfg) }` avec `cfg={appId, appName, accent, buttonLabel, dock:{selector,itemTag,itemClass,icon,title,insertAfter}, data:{intro,chapters:[...]}}` | `modules/pctac/tuto_data.js` (`appId:'pctac'`) — **partagé avec `modules/tuto_oi_data.js` de 4.html (`appId:'oi'` probable)** |
| `window.PlanMap` | `modules/pctac/planMap.js` (fin de fichier, `window.PlanMap = PlanMap`) | Objet énorme (190 membres) ; contrats documentés en commentaire : `captureToDataUrl()` (CONTRAT C2), AOI hors-ligne (CONTRAT C4), `getPinsSummary()` (CONTRAT C2) | `ui.js` (switchMainView active la vue plan), `pdfExport.js` (capture carte), `tchapLive.js` (pose ses marqueurs via `window.PlanMap`) |
| `window.Dashboard` | `modules/pctac/dashboard.js` | `{show, init, render, refresh, captureToDataUrl, destroy}` | **PERSONNE** en pratique — le fichier n'est jamais importé par `main.js` (débranché volontairement) |
| `window.Archive` | `archive.js` | `{exportZip, importFile, ...}` | boutons dock `#exportJsonDockBtn`/`#importJsonDockBtn`/`#importOiDockBtn` câblés dans `main.js` |
| `window.ImageStore` | `imageStore.js` | `{get,set,delete,migrateFromLocalStorage,...}` | `ui.js`, `pdfExport.js`, `main.js` |
| `window.LogManager` | `logManager.js` | `{addEntry,...}` | `main.js` (soumission formulaire) |
| `window.PdfExport` | `pdfExport.js` | API de génération PDF | dock `#previewPdfDockBtn` |
| `window.QrSync` | `qrSync.js` | `{openModal, closeModal, switchTab, chunkArray,...}` | boutons de transfert QR (legacy) |
| `window.UI`, `window.setPaxMode`, `window.openEditModal`, `window.switchMainView`, `window.toggleSearchMode`, `window.closeSearchMode`, `window.filterLogs` | `ui.js` | bindings individuels en plus de l'objet `UI` complet — **utilisés par des `onclick="..."` inline dans le HTML** (ex. ligne 2286 `onclick="UI.hideEditHostageModal()"`) | markup pctac2.html |
| `window.PIN_ICONS`, `window.suggestPinIcons`, `window.LOCAL_STORAGE_KEY`, `window.PHOTO_CATEGORIES`, `window.FREE_MODE_COLORS`, `window.PDF_PAX_COLORS` | `config.js` | constantes/fonctions dupliquées sur window en plus de l'export ESM | probablement legacy/compat, pas de consommateur direct identifié dans modules/pctac (possible resté d'une passerelle avec du code non-module) |
| `window.deleteLogEntry`, `window.deleteCollectionItem` | `main.js` (inline) | `(id) => ...`, `(key,id,viewId) => ...` | boutons "supprimer" générés dynamiquement en `innerHTML` (onclick inline) |

**Non posés sur window (ESM pur, import-only)** : `Persist`, `Utils`, `Wheel`, `AdversaryManager/HostageManager/FriendManager/PhotoManager`, tout `coords.js`, `TchapLive` (auto-exécuté par effet de bord, mais l'objet exporté lui-même n'est jamais assigné à `window`).

---

## 4. Dépendances tierces (vendor/)

Toutes vendorées localement dans `vendor/` (pas de CDN pour les libs lourdes, sauf polices/CDN Material Symbols) :

| Lib | Fichier | Version | Usage |
|---|---|---|---|
| MapLibre GL JS | `vendor/maplibre-gl.js` + `.css` | **4.7.1** | Carte tactique (planMap.js), marqueurs live (tchapLive.js) |
| html2canvas | `vendor/html2canvas.min.js` | **1.4.1** | Capture PNG du plan (`captureToDataUrl`) + du dashboard (mort) |
| JSZip | `vendor/jszip.min.js` | **3.10.1** | Archive `.pctac.zip` (archive.js), import `.oi.zip` |
| pdf-lib | `vendor/pdf-lib.min.js` | "Version 2.0" (build) | Génération PDF (pdfExport.js) |
| QRCode.js | `vendor/qrcode.min.js` | 1.0.0 (non versionné dans le header, cf. graphify) | Génération QR (qrSync.js) |
| html5-qrcode | `vendor/html5-qrcode.min.js` | **2.3.8** | Scan QR caméra (qrSync.js) |

CDN réseau (non vendorés, requièrent connexion) : Google Fonts (Oswald/Inter/JetBrains
Mono) + Material Symbols Outlined. Le service worker met ces polices en cache
(`isMapAsset` inclut `fonts.googleapis.com`/`fonts.gstatic.com`) mais l'app n'est PAS
utilisable offline dès la 1ère visite pour les fonts.

**Comparaison avec 4.html (OI)** : 4.html charge MapLibre 4.7.1, html2canvas 1.4.1,
JSZip 3.10.1, pdf-lib via CDN (unpkg/cdnjs) — mêmes versions logiques que PC-Tac mais
sources différentes (CDN vs vendor local) ⇒ pas de mismatch de version constaté à date,
mais deux copies binaires distinctes à maintenir en cas de mise à jour.

**Non lié à pctac2.html** : `tchap-live/` (répertoire séparé à la racine) est un
prototype Vite + `matrix-js-sdk@34` + `maplibre-gl@4.7.1` — test "Phase 2" (salon Tchap
CHIFFRÉ, crypto Rust, keyless) totalement indépendant de `modules/pctac/tchapLive.js`
(qui lui ne fait que du `/sync` HTTP brut sur salon non chiffré). Ne pas confondre les
deux lors du portage.

---

## 5. Persistance

### localStorage — clés recensées
| Clé | Module(s) propriétaire(s) | Contenu |
|---|---|---|
| `pcTacLogData` (`LOCAL_STORAGE_KEY`) | storage.js/logManager.js | Journal / main courante |
| `pcTacTpAssociations` | storage.js | Associations TP |
| `pcTacAdversaries` | collectionManagers.js (AdversaryManager) | Collection adversaires |
| `pcTacHostages` | idem (HostageManager) | Collection otages |
| `pcTacFriends` | idem (FriendManager) | Collection amis |
| `pcTacPhotos` | idem (PhotoManager) | Métadonnées photos (dataURL migré vers IndexedDB) |
| `pcTacCustomPax` | ui.js | PAX personnalisés |
| `pcTacDashboard` (`DASHBOARD_KEY`) | dashboard.js (mort), archive.js, storage.js | `{positions,links,locked,layout}` — plus utilisé en pratique |
| `pcTacPlanPins`, `pcTacPlanShapes`, `pcTacPlanView` | planMap.js | Pins, formes dessinées, dernière vue caméra |
| `pcTacPlanLocked` | planMap.js | Verrou global pings/dessins |
| `pcTacStreetLabels` | planMap.js | Toggle overlay noms de rues |
| `pcTacFranceTilesCached` | planMap.js | Flag cache tuiles France pré-téléchargées |
| `pcTacAoiIndex` | planMap.js | Index des zones AOI téléchargées hors-ligne |
| `pcTacLieuHistory` | logManager.js/archive.js | Historique des lieux saisis (autosuggestion) |
| `pcTacTchapLive`, `pcTacTchapLiveSince` | tchapLive.js | Config connexion + curseur `/sync` |
| `pcTacIdbMigratedV1` | imageStore.js | Flag migration base64→IndexedDB (one-shot) |
| `lastView` | main.js | Dernier onglet actif (repli si vue disparue) |
| `theme` | main.js | `dark`/`light` |
| `dockCollapsed` | main.js | État replié/ouvert du dock flottant |
| `lastPhotoFilter` | ui.js | Filtre catégorie actif dans l'onglet Photos |
| `ptuto_pctac_seen`, `ptuto_pctac_pos`, `ptuto_pctac_greeted` | tuto-engine.js | Progression tutoriel (préfixe dynamique `ptuto_<appId>_`) |
| `<clé>.bak` | persist.js (`backupRaw`) | Sauvegarde brute best-effort si JSON corrompu ou rejeté par un validateur — une par clé potentiellement affectée |

### IndexedDB
- Base `pcTacImages`, store `images`, version 1 (`modules/pctac/imageStore.js`). Clé =
  probablement l'id de la photo, valeur = dataURL/blob binaire. Migration automatique et
  unique depuis les 3 collections localStorage (`pcTacPhotos`, `pcTacAdversaries`,
  `pcTacHostages`) au premier `DOMContentLoaded` de main.js.

### Couche canonique
**`persist.js` est LA couche canonique** (confirmé mémoire utilisateur "PC-Tac 6
améliorations"). Règles :
- Ne jette jamais sur quota → émet `window.dispatchEvent(new CustomEvent('pctac:quota', {detail}))`
- JSON corrompu ou rejeté par un `validator` optionnel → sauvegarde de la chaîne brute
  dans `<key>.bak` (best-effort) avant de retourner le fallback
- `storage.js` est une façade métier au-dessus de `Persist` (ne touche jamais
  `localStorage` directement)
- Tous les autres modules qui veulent lire/écrire du JSON en localStorage DOIVENT passer
  par `Persist.get/set` ou par `Storage`/`CollectionManager`, jamais `localStorage.*`
  en direct (sauf 3 exceptions ad hoc identifiées : `lastView`, `theme`,
  `dockCollapsed`, `lastPhotoFilter`, et quelques clés `pcTacPlan*`/`pcTacStreetLabels`
  lues en direct dans `planMap.js` — cf. §7 invariant à vérifier lors du portage).

---

## 6. Checklist fonctionnelle de non-régression (déduite code + UI)

**Navigation** : 7 onglets (Main Courante / Adversaires / Otages / Amis / Photos / Plan /
Liens), navigation clavier flèches (a11y `makeTablist`), dernier onglet restauré au reload.

**Main Courante (journal)** : ajout entrée (mode PAX standard ou libre + couleur), tri
par heure, réordonnancement drag&drop (souris + tactile), autosuggestion lieu
(historique), édition/suppression d'entrée, recherche/filtre.

**Adversaires / Otages / Amis** : CRUD fiches (nom, statut, notes, champs spécifiques
otage : état/blessures), rattachement photo, couleur, badges de statut, suppression.

**Photos** : upload (drag&drop + input file), compression auto (Utils.compressImage),
catégorisation (otage/lieu/piégeage/adversaire neutralisé/VL target/toutes), titre
éditable, lightbox plein écran, liaison à une entité (adversaire/otage), filtre par
catégorie persistant (`lastPhotoFilter`), stockage image dans IndexedDB.

**Plan (carte tactique MapLibre)** :
- Recherche adresse/coordonnées GPS (Nominatim OSM, pas de clé)
- Plein écran, bascule 2D/3D relief
- Capture haute qualité PNG (bouton dédié + utilisée dans l'export PDF)
- Ping : placer une entité existante OU un point libre (5 catégories OTAN : Adv/Otage/
  Inter/Oscar/Inconnu), choix d'icône (catalogue filtrable + suggestions auto par libellé)
- Dessin : trait / rectangle / cercle / texte libre, 5 couleurs, undo/redo (Ctrl+Z/Y),
  effacer tout
- Mesure de distance/azimut
- Verrouillage : global (tous pings+dessins) ET par-annotation individuel (cadenas
  cliquable sur chaque pin/forme)
- Diamètres de cercle affichables/masquables
- Overlay noms de rues togglable
- Zone d'opération hors-ligne (AOI) : cadrage rectangle, estimation tuiles/volume,
  vérification quota (`storage.estimate()`), confirmation, téléchargement avec
  backoff/retry + barre de progression annulable, zoom 13→18 par défaut
- Copier coordonnées (WGS84 décimal + DMS + MGRS) via le presse-papier, depuis la roue
  contextuelle sur un pin/point de dessin
- Légende repliable (statuts géoloc live)
- Géoloc équipe live (Tchap) : connexion ProConnect OAuth ou token manuel, liste
  opérateurs groupée par cellule/fonction avec jauges, suivi caméra individuel/groupe,
  trace, réhydratation offline de la dernière position connue, reprise auto après reload

**Liens (onglet statique)** : liens externes Google Maps / Google Earth / Tchap /
communication — pas de fonctionnalité applicative propre (le "vrai" board relationnel
`dashboard.js` existe en code mais est débranché, donc PAS dans la checklist de
non-régression active).

**Global / dock flottant** : export archive `.pctac.zip` (données + photos), import
archive (+ legacy `.json`), import passerelle depuis Ordre Initial (`.oi.zip`), bascule
thème clair/sombre, plein écran, génération/téléchargement PDF, réinitialisation totale
des données (avec confirmation), tutoriel interactif pas-à-pas (bouton injecté dans le
dock), transfert par QR code (legacy, toujours câblé).

**PWA** : installable, service worker offline-first (cache carto + shell app).

---

## 7. Invariants et pièges repérés (fichiers/lignes précises)

1. **Ne jamais poser de `position` inline sur l'élément d'un Marker MapLibre.**
   `modules/pctac/planMap.js:1303-1306` — commentaire explicite : l'élément est déjà
   `position:absolute` via la classe `.maplibregl-marker` ; l'écraser en `relative`
   « casse le positionnement carte (dérive au zoom + décalage du label) ». Le badge
   cadenas (position:absolute) suppose ce contrat.

2. **Verrou par-annotation vs verrou global.** Deux mécanismes distincts et cumulables :
   verrou global `_locked` (`planMap.js:325`, toggle via `#plan_draw_lock`) et verrou
   individuel par ping (`_togglePinLock`, `planMap.js:3726`) / par forme
   (`planMap.js:4318`). Le cadenas UI (`_makeLockBadge`, `planMap.js:1275-1288`) stoppe
   `pointerdown/mousedown/touchstart` en `stopPropagation` pour ne PAS déclencher le
   drag natif du marker ni la sélection de la forme sous-jacente — piège classique si
   réécrit sans cette garde.

3. **Chaîne `captureToDataUrl` durcie** (`planMap.js:5054-5241`, contrat "C2") — invariants
   à préserver impérativement lors du portage :
   - Verrou anti-concurrence `_captureBusy` (une 2e capture pendant la 1re
     "gèlerait l'UI au restore", ligne 5071-5074)
   - Attente idle carte + tuiles chargées, bornée à 2.5s max (ne bloque jamais hors-ligne)
   - `triggerRepaint()` + 2× `requestAnimationFrame` avant snapshot du canvas WebGL
   - **Épinglage en PIXELS de la chaîne de conteneurs parents** (`#plan_map`, wrapper
     78vh, `#view-plan`) via `data-h2c-pin` + restauré dans l'`onclone` html2canvas
     (lignes 5178-5215) — sans ça les unités `vh` se recalculent dans le viewport du
     clone et `:fullscreen` ne s'y applique pas → conteneur cloné rétréci →
     `overflow:hidden` ampute les markers (commentaire : « cause n°1 des éléments
     manquants »)
   - Aplatissement temporaire des positions 3D/2D de tous les markers DOM visibles
     avant capture, restauration garantie en `finally` (lignes 5131-5159, 5228-5236)
   - `ignoreElements: n => n.tagName === 'CANVAS'` (le fond WebGL est composé à part,
     PAS via html2canvas)
   - Masquage de toute l'UI superposée (toolbar, dock dessin, panneau recherche,
     légende, hint, réticule, cadenas, panneaux inline, roue active, marqueurs de
     poignées/toolbar/diamètre) avant capture, restauration garantie en `finally`
   - Tout est sous `try/finally` : une exception pendant l'attente tuiles ou le repaint
     ne doit JAMAIS laisser l'UI masquée ni le verrou posé

4. **`Persist` est standalone par conception** (`persist.js:1-19`) : zéro import, "aucun
   cycle possible". Toute réécriture TypeScript doit préserver cette absence de
   dépendance (c'est la fondation sur laquelle tout le reste s'appuie).

5. **`dashboard.js` (1232 lignes) est du code mort en l'état** — non importé par
   `main.js` (`main.js:9-10`, commentaire explicite « VOLONTAIREMENT débranché »).
   Décision à prendre explicitement avant portage : le réimplémenter en TS (le contrat
   `window.Dashboard` et le board sont assez avancés) ou l'abandonner définitivement.
   Piège pour un audit automatique/IA naïf : `pdfExport.js:503-520` référence encore
   `window.Dashboard.captureToDataUrl` de façon défensive (`if (window.Dashboard &&
   typeof ... === 'function')`) — ce chemin n'est JAMAIS emprunté en pratique tant que
   dashboard.js n'est pas importé.

6. **`manifest.json` est partagé et mal ciblé.** Le fichier référencé par
   `<link rel="manifest" href="manifest.json">` dans pctac2.html (`pctac2.html:26`) est
   le MÊME fichier que celui de l'OI : `name/short_name: "OI-V1"`, **`start_url:
   "./1.html"`** (le générateur d'OI, pas PC-Tac). Une installation PWA de PC-Tac
   ouvrirait donc potentiellement la mauvaise page au lancement — à corriger dans
   TacSuite (manifest dédié par app, ou `start_url` dynamique).

7. **Service worker ne précache que `pctac2.html`** (`sw.js:18,23`, constante
   `offlineFallbackPage`), pas `pctac.html`. Si `pctac.html` devient un jour le vrai
   fichier canonique (il est le plus récent sur disque, modifié après pctac2.html — cf.
   §8), le fallback offline serait incohérent.

8. **Divergence pctac.html / pctac2.html strictement limitée au lien de bascule**
   (`diff` = 2 lignes) : sur `pctac.html` le lien affiche "STABLE"→`pctac2.html` ; sur
   `pctac2.html` il affiche "BETA"→`pctac.html`. Cette convention est **contradictoire
   avec le graphe graphify** (`GRAPH_REPORT.md:661` classe *"pctac2.html (PC Tac beta
   ESM), pctac.html (PC Tac stable)"* — ce qui correspondrait à l'inverse de ce que
   suggèrent les labels des boutons). À date les deux fichiers sont fonctionnellement
   identiques (même modules, mêmes vendor) donc sans impact réel pour le portage — mais
   il faut choisir UNE source de vérité avant de porter (le brief désigne pctac2.html).

9. **Deux implémentations Tchap totalement séparées** — ne pas les confondre lors du
   portage : `modules/pctac/tchapLive.js` (salon non chiffré, `/sync` HTTP brut, aucune
   dépendance npm, auto-wiring à l'import) vs `tchap-live/` à la racine (prototype Vite +
   `matrix-js-sdk@34`, salon CHIFFRÉ, crypto Rust, "test *keyless* Phase 2" — projet
   séparé, jamais chargé par pctac2.html).

10. **Écriture localStorage directe hors `Persist`/`Storage`** repérée dans `main.js`
    (`lastView`, `theme`, `dockCollapsed`), `ui.js` (`lastPhotoFilter`), et `planMap.js`
    (`pcTacPlanLocked`, `pcTacFranceTilesCached`, `pcTacStreetLabels` lues en direct via
    `localStorage.getItem`, cf. grep §5). Incohérence mineure par rapport à la règle "tout
    passe par Persist" énoncée en tête de storage.js/persist.js — à trancher lors du
    portage (uniformiser ou documenter comme exception voulue pour les préférences UI
    pures, par opposition aux données opérationnelles).

---

## 8. Hypothèses d'exécution

- **Serveur HTTP recommandé, mais dégradation `file://` partiellement prévue.**
  Indices : `main.js:20` n'enregistre le Service Worker que si
  `location.protocol.startsWith('http')` (donc SW/PWA/offline-cache désactivés en
  `file://`, sans planter) ; `sw.js:118-126` tolère l'échec item par item du précache
  (commentaire « file://, vendor absent, etc. »). En `file://`, MapLibre/fetch vers
  Nominatim, tuiles IGN/ESRI et fonts Google fonctionneraient quand même (CORS public),
  mais sans aucun cache offline ni PWA installable.
- **Fetch réseau nécessaires (non vendorés)** : Nominatim (recherche adresse), tuiles
  cartographiques (IGN Géoplateforme `data.geopf.fr`, satellite ESRI
  `server.arcgisonline.com`, élévation `elevation-tiles-prod.s3.amazonaws.com`, vecteur
  `tiles.openfreemap.org`), Google Fonts/Material Symbols, `/sync` Matrix Tchap
  (`https://matrix.agent.interieur.tchap.gouv.fr` par défaut), `members_config.json`
  (fetch relatif, racine du projet, pour les listes fonctions/cellules Tchap).
- **CORS** : tuiles/Nominatim sont publics (pas de souci). Tchap `/sync` nécessite un
  token valide (device-code OAuth ProConnect ou token manuel) — hors périmètre CORS
  classique (API JSON directe).
- **Chemins relatifs sensibles** : tous les `<script src="modules/...">`,
  `href="./vendor/..."`, `href="shared/..."` sont relatifs à la racine du dépôt — un
  portage TypeScript avec bundler (Vite etc.) devra réécrire ces chemins ou répliquer
  l'arborescence `vendor/`/`modules/`/`shared/` telle quelle si on veut un diff minimal.
  `sw.js` utilise aussi des chemins relatifs (`'./'`, `'pctac2.html'`, `./vendor/...`) —
  cohérent avec un déploiement à la racine du domaine (`scope:"./"` du manifest).
- **Aucun build step actuel** pour PC-Tac : `package.json` racine ne déclare aucune
  dépendance (`type:"commonjs"`, `scripts.test` = stub). C'est du HTML/JS vanilla servi
  tel quel. Le seul sous-projet avec un vrai build (Vite) est `tchap-live/`, indépendant
  (cf. invariant #9).
- **Web Workers** : aucun détecté dans modules/pctac (à l'exception du Service Worker
  `sw.js`, qui n'est pas un Worker de calcul).

---

## Résumé synthèse (pour retour à l'orchestrateur)

Voir message de fin de tâche.
