# SPEC-PCTAC-CONVERSION — conversion des modules PC-Tac (P2.A0)

> **Document opposable.** Source : `/home/nico/Bureau/Web/GStart-main` — **LECTURE
> SEULE ABSOLUE** (aucune création/modification/suppression, y compris de fichiers
> temporaires). Cible : `/home/nico/Bureau/Web/TacSuite`.
> Compagnon : `docs/SPEC-PLANMAP-SPLIT.md` (découpage du monolithe `planMap.js`).
> Références opposables : `docs/PLAN.md` §2 §4, `docs/SPEC-CONTRATS.md`,
> `docs/DECISIONS-DEPS.md`, `docs/DECISIONS-DOM-ECARTS.md`, `docs/recon-pctac.md`.

---

## 1. Filemap exhaustif — source → cible

### 1.1 Modules VIVANTS restant à porter en Phase 2

| # | Source (`GStart-main/`) | LOC | Cible (`TacSuite/src/apps/pctac/`) | Exports TS attendus | `window.*` posé au scope module |
|---:|---|---:|---|---|---|
| 1 | `modules/pctac/config.js` | 317 | `config.ts` | `LOCAL_STORAGE_KEY`, `TP_ASSOC_KEY`, `ADVERSARIES_KEY`, `HOSTAGES_KEY`, `FRIENDS_KEY`, `PHOTOS_KEY`, `CUSTOM_PAX_KEY`, `DASHBOARD_KEY`, `PHOTO_CATEGORIES`, `FREE_MODE_COLORS`, `PDF_PAX_COLORS`, `QR_BATCH_SIZE`, `LONG_PRESS_DELAY`, `PIN_ICONS`, `BOARD_NODE_TYPES`, `normalizeForMatch()`, `suggestPinIcons()`, `labelTokens()`, `matchPhotosByLabel()` | `PIN_ICONS`, `suggestPinIcons`, `LOCAL_STORAGE_KEY`, `PHOTO_CATEGORIES`, `FREE_MODE_COLORS`, `PDF_PAX_COLORS` (`config.js:310-317`) |
| 2 | `modules/pctac/storage.js` | 117 | `storage.ts` | `Storage: PctacStorageContract` | `saveLogData`, `loadLogData`, `getTpAssociations`, `saveTpAssociation` (`storage.js:114-117`) |
| 3 | `modules/pctac/utils.js` | 52 | `utils.ts` | `Utils` (`{ compressImage }`) | — |
| 4 | `modules/pctac/logManager.js` | 139 | `log-manager.ts` | `LogManager: LogManagerContract` | `LogManager` (`logManager.js:139`) |
| 5 | `modules/pctac/imageStore.js` | 154 | `image-store.ts` | `ImageStore: ImageStoreContract` | `ImageStore` (`imageStore.js:154`) |
| 6 | `modules/pctac/wheel.js` | 351 | `wheel.ts` | `class Wheel` (+ types `WheelOptions`, `WheelOption`) | — |
| 7 | `modules/pctac/archive.js` | 459 | `archive.ts` | `Archive: ArchiveContract` | `Archive` (`archive.js:459`) |
| 8 | `modules/pctac/pdfExport.js` | 596 | `pdf-export.ts` | `PdfExport: PdfExportContract` | `PdfExport` (`pdfExport.js:596`) |
| 9 | `modules/pctac/ui.js` | 890 | `ui.ts` | `UI: UIContract` | `UI`, `setPaxMode`, `openEditModal`, `switchMainView`, `toggleSearchMode`, `closeSearchMode`, `filterLogs` (`ui.js:884-890`) |
| 10 | `modules/pctac/tchapLive.js` | 961 | `tchap-live.ts` | `TchapLive` (`{ startManual, startOidc, stop, wireUI }`) | — (auto-câblage par effet de bord, `tchapLive.js:960-961`) |
| 11 | `modules/pctac/planMap.js` | 5596 | `planmap/` (21 fichiers) | cf. `SPEC-PLANMAP-SPLIT.md` §2 | `PlanMap` (`planMap.js:5596`) |
| 12 | `modules/pctac/main.js` | 546 | `main.ts` | *(script, aucun export)* | `deleteLogEntry`, `deleteCollectionItem` (`main.js:293,298`) — **P2.D, hors paquets** |

### 1.2 Déjà porté en Phase 1 — **NE PAS RECRÉER, IMPORTER**

| Source | Cible existante | Import à utiliser |
|---|---|---|
| `modules/pctac/persist.js` | `src/shared/persist.ts` | `import { Persist } from '@shared/persist.js';` |
| `modules/pctac/coords.js` | `src/shared/coords.ts` | `import { formatCoordsClipboard, shortMgrs } from '@shared/coords.js';` |
| `modules/tuto-engine.js` | `src/shared/tuto-engine.ts` | `import { PocheTuto } from '@shared/tuto-engine.js';` |
| `shared/ui-platform.js` | `src/shared/ui-platform.ts` | `import { esc, UIPlatform } from '@shared/ui-platform.js';` |
| `modules/pctac/tuto_data.js` | `src/apps/pctac/tuto-data.ts` | `import { pctacTutoData } from '@pctac/tuto-data.js';` |
| types de contrats | `src/shared/types/contracts.ts`, `global.d.ts`, `tuto.ts` | `import type { … } from '@shared/types/contracts.js';` |

**229 tests unitaires sont déjà verts sur ces modules : ne rien y toucher**, à
la seule exception documentée en §7 (normalisation `opts` de `ui-platform.ts`).

### 1.3 Modules EXCLUS du portage (code mort prouvé — `SPEC-CONTRATS.md` §4)

| Source | Motif | Conséquence obligatoire |
|---|---|---|
| `modules/pctac/dashboard.js` (1232) | jamais importé (`main.js:9-10`, commentaire explicite) | **supprimer** la branche `viewId === 'view-dashboard'` de `ui.ts` (`ui.js:110-113`) et la section 7 de `pdf-export.ts` (`pdfExport.js:503-538`) — `window.Dashboard` n'existe pas dans `global.d.ts`, ces branches ne compileraient pas |
| `modules/pctac/qrSync.js` (193) | jamais importé, `<script>` absent, DOM cible absent | ne pas porter |
| `modules/pctac/collectionManagers.js` (51) | 0 occurrence hors le fichier | ne pas porter |
| `modules/shared.js` | 0 consommateur | ne pas porter |

Le **code mort INTERNE à `planMap.js`** (cluster « transform », 10 méthodes) est
traité à part : porté verbatim dans `planmap/legacy.ts`, cf.
`SPEC-PLANMAP-SPLIT.md` §7.

### 1.4 Bibliothèques : global vendoré → import npm

| Original (global) | Import TS imposé | Sites concernés |
|---|---|---|
| `maplibregl` | `import maplibregl from 'maplibre-gl';` | `planmap/*`, `tchap-live.ts` |
| `html2canvas` | `import html2canvas from 'html2canvas';` | `planmap/capture.ts` |
| `JSZip` | `import JSZip from 'jszip';` | `archive.ts` |
| `PDFLib` (destructuré) | `import * as PDFLib from 'pdf-lib';` puis **conserver verbatim** `const { PDFDocument, rgb: pdfRgb, StandardFonts, PageSizes } = PDFLib;` | `pdf-export.ts` |

**Gardes « lib absente ».** Les tests `typeof X === 'undefined'` deviennent
inatteignables avec un import statique. Règle : **le branchement (alerte,
message DOM, `return null`) est CONSERVÉ mot pour mot**, la condition est
réécrite en test de forme :

```ts
if (typeof JSZip !== 'function')            { alert("JSZip indisponible …"); return; }   // archive.js:52-55, 114
if (typeof PDFLib?.PDFDocument !== 'function') { alert('Librairie pdf-lib non chargée …'); return; } // pdfExport.js:97-99
if (typeof html2canvas !== 'function')      { return null; }                             // planMap.js:5056
if (typeof maplibregl?.Map !== 'function')  { /* bloc DOM d'erreur verbatim */ return; }  // planMap.js:349-354
```

Aucun message utilisateur n'est modifié.

### 1.5 Récapitulatif des chemins cibles (aucun chevauchement)

```
src/apps/pctac/
├── config.ts            ├── archive.ts        ├── planmap/types.ts
├── storage.ts           ├── pdf-export.ts     ├── planmap/constants.ts
├── utils.ts             ├── ui.ts             ├── planmap/geo.ts
├── log-manager.ts       ├── tchap-live.ts     ├── planmap/tiles.ts
├── image-store.ts       ├── main.ts   (P2.D)  ├── planmap/state.ts
├── wheel.ts             └── tuto-data.ts (P1) ├── planmap/map-core.ts
                                               ├── planmap/chrome.ts
                                               ├── planmap/ping-modal.ts
                                               ├── planmap/pins.ts
                                               ├── planmap/draw-layers.ts
                                               ├── planmap/draw-tools.ts
                                               ├── planmap/measure.ts
                                               ├── planmap/shapes-render.ts
                                               ├── planmap/shapes-gestures.ts
                                               ├── planmap/wheels.ts
                                               ├── planmap/panels.ts
                                               ├── planmap/text-modal.ts
                                               ├── planmap/capture.ts
                                               ├── planmap/aoi.ts
                                               ├── planmap/legacy.ts
                                               └── planmap/index.ts
```

Tests : `tests/unit/pctac/<id-de-paquet>.test.ts` (un fichier par paquet, jamais
partagé).

---

## 2. Conventions d'import

1. **Alias obligatoires** (déjà configurés dans `tsconfig.json` **et**
   `vite.config.ts`, donc valides en build ET en Vitest) :
   `@shared/*` → `src/shared/*` · `@pctac/*` → `src/apps/pctac/*` · `@oi/*` → `src/apps/oi/*`.
2. **Extension `.js` obligatoire** dans tous les specifiers relatifs et alias
   (`moduleResolution: "bundler"` + `isolatedModules`) :
   `import { Storage } from '@pctac/storage.js';` — c'est la convention déjà
   appliquée en Phase 1 (`src/shared/types/global.d.ts:35`).
3. **`import type` pour tout ce qui est purement typage** (`isolatedModules`).
4. **Pas de chemins relatifs entre dossiers** : `@pctac/config.js`, jamais
   `../config.js`. **Exception** : à l'INTÉRIEUR de `planmap/`, les imports entre
   fichiers frères sont relatifs (`./types.js`, `./constants.js`, `./geo.js`,
   `./tiles.js`) — cf. `SPEC-PLANMAP-SPLIT.md` §1.2.
5. **`any` interdit** (règle P1.A0, `SPEC-CONTRATS.md` §0.1). Utiliser `unknown`
   + garde, ou un type précis. Chaque `unknown` porte un commentaire de
   justification.
6. **`!` (non-null assertion) interdit.** Utiliser une garde explicite ou un
   helper documenté (`coordAt`, cf. `SPEC-PLANMAP-SPLIT.md` §6.3).
7. **Aucun `export default`** sauf : `planmap/index.ts` (miroir de l'original) et
   `@shared/persist.js` (déjà en place).

---

## 3. Stratégie de remplacement des `onclick` inline — **DÉCISION**

### 3.1 État des lieux (relevé exhaustif)

| Origine | Nombre | Détail |
|---|---:|---|
| `onclick` STATIQUES du HTML | **5** | `pctac/index.html:599, 665, 697, 728, 785` (repris verbatim de `pctac2.html:2157, 2223, 2255, 2286, 2343`) : `UI.hideCreatePaxModal()`, `UI.hideEditModal()`, `UI.hideEditAdversaryModal()`, `UI.hideEditHostageModal()`, `UI.closeLightbox()` |
| Handlers GÉNÉRÉS en `innerHTML` par `ui.js` | **13** | `ui.js:214, 217, 460, 461, 490, 491, 508, 530, 545, 550, 551, 557, 563` + les 4 attributs `ondragstart/ondragover/ondrop/ondragend` de la carte photo (`ui.js:544`) |
| `<script>` inline de `pctac2.html` | **1 bloc, 9 lignes** (`:8-16`) | `window.onerror` / `unhandledrejection` → `console` |

> ⚠ **Correction factuelle.** Le chiffre de « ~350 lignes d'inline » du brief
> concerne `4.html` (Générateur d'OI, phase 3). **PC-Tac n'a que 9 lignes de
> `<script>` inline** (`pctac2.html:8-16`) et 5 attributs `onclick` statiques.
> Ce bloc de 9 lignes est **déjà absent** de `pctac/index.html` (P0.A5,
> catégorie « scripts retirés » du protocole §4.1) : il doit être **réintroduit
> à l'identique en TÊTE de `src/apps/pctac/main.ts`** (cf. §5, étape 0) —
> à défaut, la journalisation d'erreurs globale de l'app est perdue.
> `docs/DECISIONS-DOM-ECARTS.md` sera complété par le gate P2.E.

### 3.2 Décision : **délégation par `data-action`, en P2.D uniquement**

| Question | Décision |
|---|---|
| Mécanisme | **Un unique listener `click` en délégation sur `document`**, dispatchant sur `event.target.closest('[data-action]')` ; la table `action → handler` vit dans `main.ts`. Un second listener délégué `change` pour les `<select>` de statut photo. |
| Pourquoi pas « par id » | Les 13 handlers générés sont **paramétrés** (`deleteCollectionItem('pcTacAdversaries','<id>','view-adversaires')`). L'approche par id imposerait de recâbler après chaque `innerHTML` (fuite de listeners, oubli garanti). `data-action` + `data-*` transporte les paramètres **dans le markup**, sans recâblage. |
| Pourquoi pas `addEventListener` par élément après chaque rendu | `ui.js` reconstruit `innerHTML` à chaque `render*()` : le recâblage serait à faire dans 6 méthodes, avec risque d'oubli et de double-binding. La délégation est posée **une fois**. |
| Format | `data-action="<verbe-kebab>"` + paramètres en `data-*` : `data-id`, `data-key`, `data-view`, `data-category`, `data-src`, `data-title`, `data-status`. Exemple : `<button data-action="delete-collection-item" data-key="pcTacAdversaries" data-id="…" data-view="view-adversaires">`. |
| Périmètre | Les **5 statiques** + les **13 générés** + les 4 attributs drag de la carte photo. |
| **Calendrier** | **P2.D**, PAS dans les paquets de conversion. En P2.B/P2.C, `ui.ts` génère l'`innerHTML` **VERBATIM avec les `onclick`**, et les façades `window.UI` / `window.openEditModal` / `window.deleteLogEntry` / `window.deleteCollectionItem` sont **maintenues**. Motif : découpler la conversion (risque typage) du recâblage (risque comportemental) ; chacun a son gate. |
| Ordre de retrait des façades | Exactement `SPEC-CONTRATS.md` §5. Les 5 binds sans consommateur (`setPaxMode`, `switchMainView`, `toggleSearchMode`, `closeSearchMode`, `filterLogs`) peuvent partir dès P2.D ; `window.UI`, `openEditModal`, `deleteLogEntry`, `deleteCollectionItem` partent **après** la délégation. |
| Attributs du HTML statique | Les 5 `onclick` de `pctac/index.html` seront remplacés par `data-action` en P2.D. **Écart DOM** à inscrire dans `docs/DECISIONS-DOM-ECARTS.md` à ce moment-là (il n'est PAS couvert par le document actuel). |

### 3.3 Table de correspondance à appliquer en P2.D

| Site d'origine | Appel actuel | `data-action` cible | `data-*` |
|---|---|---|---|
| `index.html:599` | `UI.hideCreatePaxModal()` | `hide-create-pax-modal` | — |
| `index.html:665` | `UI.hideEditModal()` | `hide-edit-modal` | — |
| `index.html:697` | `UI.hideEditAdversaryModal()` | `hide-edit-adversary-modal` | — |
| `index.html:728` | `UI.hideEditHostageModal()` | `hide-edit-hostage-modal` | — |
| `index.html:785` | `UI.closeLightbox()` | `close-lightbox` | — |
| `ui.js:214` | `window.openEditModal(id)` | `open-edit-modal` | `data-id` |
| `ui.js:217` | `window.deleteLogEntry(id)` | `delete-log-entry` | `data-id` |
| `ui.js:460` | `UI.showEditAdversaryModal(id)` | `show-edit-adversary-modal` | `data-id` |
| `ui.js:461/491/508/551` | `deleteCollectionItem(key,id,view)` | `delete-collection-item` | `data-key`, `data-id`, `data-view` |
| `ui.js:490` | `UI.showEditHostageModal(id)` | `show-edit-hostage-modal` | `data-id` |
| `ui.js:530` | `UI.renderPhotos(catId)` | `filter-photos` | `data-category` |
| `ui.js:545` | `UI.openLightbox(src,title)` | `open-lightbox` | *(lire `img.src` + `img.alt` — supprime l'échappement `\\`/`\'` fragile de `ui.js:545`)* |
| `ui.js:550` | `UI.editPhotoTitle(id)` | `edit-photo-title` | `data-id` |
| `ui.js:557/563` | `UI.updateAdversaryStatus(id,value)` (`onchange`) | `update-photo-status` (listener `change`) | `data-id` |
| `ui.js:544` | `ondragstart/over/drop/dragend` | listeners délégués sur `#photo-board` | — |

---

## 4. Contrats `window.*` — où poser quoi

**Règle générale (fidélité) : chaque module TS pose ses propres globales AU SCOPE
MODULE, exactement là où l'original le fait** (colonne « `window.*` posé » de
§1.1). Ne PAS déplacer ces affectations dans `main.ts`.

*Justification opposable* : dans un graphe ESM, les corps des modules importés
s'exécutent **avant** celui de l'entrée. Déplacer les affectations dans `main.ts`
change l'ordre de disponibilité des globales — or `tchap-live.ts` s'auto-câble à
l'import et lit `window.PlanMap`. La pose au scope module reproduit l'ordre de
`main.js:1-12` à l'identique.

*Exception* : `window.deleteLogEntry` et `window.deleteCollectionItem` restent
définies **dans `main.ts`**, à l'intérieur du handler `DOMContentLoaded`, comme
`main.js:293` et `:298`.

*Typage* : `global.d.ts` déclare déjà ces propriétés (P1.A0). Aucune modification
n'est requise, **sauf** si un agent constate un écart de signature — auquel cas
il **signale** au lieu de modifier `global.d.ts` (fichier partagé, conflit de
paquets).

---

## 5. `main.ts` — ordre d'initialisation (identique à `main.js`) — **P2.D**

`main.ts` n'est PAS dans les paquets de conversion : il est produit en P2.D.
La séquence ci-dessous est **imposée** et sera vérifiée au gate P2.E.

### 5.1 En-tête de module (avant tout `await`)

```
0.  Bloc de journalisation d'erreurs, VERBATIM de pctac2.html:8-16
    (window.onerror + window.addEventListener('unhandledrejection', …)) — cf. §3.1
1.  import '@shared/fonts.js';                     // P0.FIX (déjà présent)
2.  import 'maplibre-gl/dist/maplibre-gl.css';     // P0.A5 point 4 (déjà présent)
3.  import '@shared/ui-platform.js'  → window.UIPlatform = UIPlatform     (1er, comme pctac2.html:20)
4.  import '@shared/tuto-engine.js'  → window.PocheTuto = PocheTuto       (pctac2.html:2392)
5.  import '@pctac/tuto-data.js'     → PocheTuto.mount({appId:'pctac',…}) (pctac2.html:2393)
```

> ⚠ **Ordre 3→4→5 obligatoire** : `tuto_data.js` est gardé par
> `if (!window.PocheTuto || !window.PocheTuto.mount)` — inverser l'ordre
> désactiverait silencieusement le tutoriel.

### 5.2 Imports applicatifs — **ordre de `main.js:1-12`, à respecter à la ligne près**

```
import { Storage }    from '@pctac/storage.js';       // main.js:1
import { UI }         from '@pctac/ui.js';            // main.js:2
import { LogManager } from '@pctac/log-manager.js';   // main.js:3
import { PdfExport }  from '@pctac/pdf-export.js';    // main.js:4
import { Utils }      from '@pctac/utils.js';         // main.js:5
import { ImageStore } from '@pctac/image-store.js';   // main.js:6
import '@pctac/planmap/index.js';                     // main.js:7  → pose window.PlanMap
import '@pctac/tchap-live.js';                        // main.js:8  → auto-câblage, LIT window.PlanMap
import { Persist }    from '@shared/persist.js';      // main.js:11
import { CUSTOM_PAX_KEY, ADVERSARIES_KEY, HOSTAGES_KEY,
         FRIENDS_KEY, PHOTOS_KEY, DASHBOARD_KEY } from '@pctac/config.js'; // main.js:12
```

**`planmap` AVANT `tchap-live`** : non négociable (cf.
`SPEC-PLANMAP-SPLIT.md` §6.1). `dashboard.js` reste non importé, le commentaire
`main.js:9-10` est reporté tel quel.

### 5.3 Corps du `DOMContentLoaded` — 22 étapes, ordre de `main.js:18-546`

| # | L. `main.js` | Étape |
|---:|---:|---|
| 1 | 20-22 | Enregistrement du Service Worker, **gardé** par `location.protocol.startsWith('http')` (⚠ le SW est reconstruit en **P4.A** : en P2.D, garder l'appel mais pointer sur le futur SW du build ou le neutraliser explicitement avec un `TODO P4.A` — décision au gate) |
| 2 | 25-29 | `await ImageStore.migrateFromLocalStorage()` sous `try/catch` |
| 3 | 32 | `UI.initElements()` |
| 4 | 33 | `UI.initPaxModeAndColors()` |
| 5 | 34-35 | `UI.updateTimeInput()` + `setInterval(…, 60000)` |
| 6 | 38-40 | listener `input` sur `#heure_input` → `window.isTimeInputManuallyChanged = true` |
| 7 | 43-45 | `Storage.loadLogData()` → `UI.renderLogTable()` + `UI.refreshLieuSuggestions()` |
| 8 | 48-54 | boucle `.tab-btn` : `role="tab"` + listener `click` → `UI.switchMainView(dataset.view)` |
| 9 | 57-63 | `UIPlatform.makeTablist(tabBar, { tabSelector, activate })` |
| 10 | 66-69 | restauration `lastView` + repli si l'id n'existe plus |
| 11 | 72-76 | restauration du thème (`theme`) |
| 12 | 81-104 | soumission `#log-form` |
| 13 | 107-127 | `#confirmCreatePaxBtn` (unicité de couleur) |
| 14 | 130-239 | 3 formulaires de collection (adv/otage/ami) + copies « _sync » vers Photos + statut otage déduit des blessures |
| 15 | 242-263 | `change` sur `#adv_photo` / `#hostage_photo` → `Utils.compressImage(…, 800, 800, 0.7)` + miniature |
| 16 | 266-290 | soumission `#photo-form` (`compressImage(…, 1024, 1024, 0.7)`) |
| 17 | 293-343 | `window.deleteLogEntry` + `window.deleteCollectionItem` (dont purge `pcTacDashboard` via `Persist`, à **conserver** : la clé voyage encore dans l'archive) |
| 18 | 345-433 | boutons dock : PDF, reset (+ confirm/cancel), création PAX, éditions adversaire/otage/log |
| 19 | 436-468 | `const { Archive } = await import('@pctac/archive.js');` — **import dynamique conservé** (`main.js:436`) + `#exportJsonDockBtn`, `#importJsonDockBtn`, `#archiveImportInput` |
| 20 | 470-500 | passerelle OI → PC-Tac (`#importOiDockBtn`, `#oiImportInput`) |
| 21 | 502-509 | `#darkModeToggle`, `#fullscreenToggle` (+ `fullscreenchange`) |
| 22 | 514-545 | écouteur `pctac:quota` (bandeau) + `#dockToggleBtn` + restauration `dockCollapsed` |

Aucune étape ne peut être fusionnée, réordonnée ni « optimisée ».

---

## 6. Persistance — clés et exceptions (protocole §4.5)

**Aucune clé localStorage / IndexedDB ne change.** La liste de
`recon-pctac.md` §5 fait foi.

**Exception documentée et MAINTENUE** : les accès `localStorage` directs (hors
`Persist`) sont **conservés à l'identique** — ce sont des préférences d'UI ou des
chaînes déjà sérialisées :

| Fichier | Clés en accès direct | L. |
|---|---|---:|
| `main.js` | `lastView`, `theme`, `dockCollapsed` | 66, 72, 539 |
| `ui.js` | `lastPhotoFilter`, `lastView`, `theme`, `dockCollapsed` | 104, 116, 518, 535, 618, 691, 697 |
| `planMap.js` | `pcTacPlanLocked`, `pcTacFranceTilesCached`, `pcTacStreetLabels`, `pcTacPlanView`, `pcTacPlanShapes` (undo/redo) | 357, 426, 433, 453, 462, 680, 684, 1975, 1985, 2793 |
| `storage.js` | les 14 clés de `clearAllData()` (`removeItem`) | 84-109 |
| `archive.js` | snapshot/restauration brute de l'archive | 62, 169, 179, 193 |
| `imageStore.js` | flag `pcTacIdbMigratedV1` + relecture/réécriture des 3 collections | 96, 118, 128 |

Ne PAS « uniformiser vers `Persist` » : cela changerait le comportement sur quota
plein (`Persist` avale l'exception et émet `pctac:quota` ; `localStorage.setItem`
direct jette). Toute lecture/écriture de **données opérationnelles** nouvelle
passe en revanche par `Persist`.

---

## 7. Normalisation actée — les 5 fonctions `ui-platform.ts` à défaut TS

### 7.1 Constat

| Original (`shared/ui-platform.js`) | Port TS (`src/shared/ui-platform.ts`) |
|---|---|
| `function onLongPress(el, cb, opts) { opts = opts \|\| {}; …}` (`:85-86`) | `opts: UIPlatformLongPressOptions = {}` (`:175`) |
| `onDoubleTap` (`:104-105`) | `:216` |
| `sortable` (`:122-123`) | `:247` |
| `makeDialog` (`:236-237`) | `:410` |
| `makeTablist` (`:268-269`) | `:461` |

Un **paramètre par défaut** TS/JS ne s'applique qu'à `undefined`. L'original
utilise `opts = opts || {}`, qui absorbe **aussi `null`** (et `0`, `''`, `false`).
Un appelant passant explicitement `null` — pattern courant en JS legacy, et
autorisé par le contrat `UIPlatformContract` puisque `opts?: T` avec
`exactOptionalPropertyTypes` n'interdit pas un `null` venant de code non typé
(HTML inline, futur consommateur OI) — provoquerait un `TypeError` dans le port
alors qu'il fonctionnait dans l'original.

### 7.2 Décision (actée par ce document)

Les **5 fonctions** sont normalisées pour **tolérer `null` exactement comme
l'original** :

```ts
export function onLongPress(
    el: HTMLElement,
    cb: (e: PointerEvent) => void,
    opts?: UIPlatformLongPressOptions | null,
): UIPlatformLongPressHandle {
    const o = opts ?? {};          // ≡ `opts = opts || {}` de ui-platform.js:86
    const delay = o.delay || 450;
    …
}
```

Règles :
1. Signature : `opts?: T | null` (le `?` conserve la compatibilité des appels
   existants ; le `| null` restaure la tolérance de l'original).
2. Corps : `const o = opts ?? {};` en **première ligne**, puis remplacer les
   `opts.` par `o.` — **aucune autre modification**.
3. `src/shared/types/contracts.ts` : les 5 signatures correspondantes
   (`UIPlatformContract.onLongPress/onDoubleTap/sortable/makeDialog/makeTablist`)
   passent à `opts?: T | null`. C'est un **élargissement** : aucun appelant
   existant ne casse.
4. Les 229 tests existants doivent rester verts **sans modification** ; ajouter
   5 cas `…(el, cb, null)` ne jette pas et applique les défauts.

*Écart d'observable* : `?? ` diffère de `||` pour `0`/`''`/`false`. Un `opts`
valant `0` ou `''` est **impossible** ici (le contrat le type en objet) ; la
différence est donc inobservable. Documenté pour la revue.

---

## 8. Règles de travail communes à TOUS les paquets P2.B / P2.C

Ces règles sont **reprises intégralement** dans chaque instruction de paquet.

### 8.1 Interdits absolus

1. **Aucune écriture dans `/home/nico/Bureau/Web/GStart-main`** (ni fichier, ni
   `sed -i`, ni `git`, ni fichier temporaire). Lecture seule stricte : `cat`,
   `sed -n`, `grep`, `Read`.
2. Ne toucher qu'aux fichiers listés dans `targets` + son propre fichier de test.
   **Ne jamais modifier** `src/shared/**` (hors paquet dédié), `tsconfig.json`,
   `vite.config.ts`, `vitest.config.ts`, `package.json`, `pctac/index.html`,
   `styles/*`, ni les cibles d'un autre paquet.
3. `any`, `!` (non-null assertion), `@ts-ignore`, `eslint-disable` : **interdits**.
4. Aucun refactor du code adjacent, aucun renommage de variable, aucune
   « amélioration » non demandée. **Fidélité avant élégance** (`PLAN.md` §4.7).

### 8.2 Vérifications en contexte parallèle

Plusieurs agents écrivent simultanément dans `src/apps/pctac/`. `npm run
typecheck` compile **tout** le projet et remontera donc des erreurs venant de
fichiers d'autres paquets, ou de fichiers pas encore écrits.

> **Seul critère qui fait foi :**
> ```bash
> cd /home/nico/Bureau/Web/TacSuite
> npx tsc --noEmit 2>&1 | grep -E '<un de tes chemins cibles>|<ton fichier de test>'   # doit être VIDE
> npx eslint <tes fichiers>                                                            # 0 erreur
> npx vitest run tests/unit/pctac/<ton-id>.test.ts                                     # tous verts
> ```
> Les erreurs situées **hors** de tes fichiers sont ignorées et **signalées** dans
> ton compte-rendu final (elles seront traitées par le gate).

### 8.3 Méthode de portage

1. Lire **en entier** le fichier source concerné avant d'écrire.
2. Porter **méthode par méthode, dans l'ordre du fichier d'origine**. Conserver
   les commentaires FR d'origine (ils portent les invariants) et **ajouter** la
   référence `// <fichier>.js:<ligne>` en tête de chaque bloc non trivial.
3. Ne convertir que le typage. Aucune restructuration de flux de contrôle,
   aucune extraction de fonction, aucune substitution `for`→`map`.
4. Écrire les tests **avant** le port pour les modules PURS (marqués « TDD » dans
   l'instruction) ; après le port pour les modules DOM (tests de fumée ciblés).

### 8.4 Environnement de test

* Vitest, environnement `jsdom`, `tests/setup.ts` fournit `localStorage` /
  `sessionStorage` en mémoire.
* **`indexedDB` n'existe PAS sous jsdom** : `image-store.ts` et `tchap-live.ts`
  doivent poser leur propre double (`globalThis.indexedDB = fakeIdb`) dans le
  test, ou tester uniquement les branches sans IDB. Ne PAS ajouter de dépendance
  npm.
* **`maplibre-gl` ne peut pas s'instancier sous jsdom** (WebGL absent) : ne
  jamais appeler `new maplibregl.Map(...)` en test ; tester les méthodes avec un
  `this` factice portant un faux `map`.
* `caches` (Cache Storage), `navigator.storage.estimate`, `fetch`,
  `navigator.clipboard` : absents → mocker explicitement.
* `confirm` / `alert` / `prompt` : absents ou non implémentés → `vi.stubGlobal`.

### 8.5 Compte rendu attendu de chaque agent

Texte final (pas de fichier `.md`) : chemins absolus produits, commandes
exécutées + résultats bruts, invariants vérifiés (avec le n° de §), écarts
assumés et leur justification, points laissés au gate.

---

## 9. Points d'attention par module (hors planMap)

| Module | Pièges relevés (fichier:ligne) |
|---|---|
| `config.ts` | `normalizeForMatch` (`config.js:159`) fait `.normalize('NFD').replace(/[...]/g, '')` ou la classe contient les **combinantes U+0300 et U+036F ecrites EN CLAIR** (octets UTF-8 `CC 80` et `CD AF`, verifies a l'`od -c`). **Ecrire la forme echappee `/[\u0300-\u036f]/g`** dans le TS : strictement equivalent, robuste au copier-coller et au diff. Meme regex en `labelTokens:229` et `matchPhotosByLabel:277,290`. `PIN_ICONS` : 51 entrees, a recopier **verbatim** (ids Material Symbols verifies). |
| `storage.ts` | `saveTpAssociation(label, color)` écrit `assoc[color] = label` — **indexé par COULEUR**, pas par libellé (`storage.js:57`). `saveLogData` **trie en place** (mutation du tableau reçu) avant persistance (`:26-29`). `clearAllData` supprime **14 clés**, dont `pcTacPlanLocked` et `pcTacDashboard`. |
| `utils.ts` | `compressImage` accepte `File` **ou** dataURL (`utils.js:38-46`) ; sortie **toujours** `image/jpeg`. |
| `log-manager.ts` | `importJson` : `paxMode` est **recalculé d'abord**, puis sert au repli de couleur (`logManager.js:107-112`) — l'ordre est un correctif, ne pas l'inverser. Dédup par `id`. Historique lieux LRU **max 30**, insensible à la casse. `addEntry` fait des `alert()` et retourne `null` : conserver. |
| `image-store.ts` | `put/delete/deleteMany/clear` résolvent sur **`tx.oncomplete`**, pas sur `req.onsuccess` (`imageStore.js:33-42`). `hydrate` ne mute pas la liste d'entrée. `migrateFromLocalStorage` est gardée par `pcTacIdbMigratedV1` et pose le flag **même si rien n'a migré**. |
| `wheel.ts` | Le `transform` des boutons radiaux **encode leur position** : ne jamais le modifier en `:active` (commentaire `wheel.js:330-334`). `_position()` **détruit** la roue si l'ancre sort de la vue + `ext`, et **clampe** sinon (`:137-146`). `_onOutside` ignore les 120 premières ms. Le CSS est injecté une seule fois via `#plan-wheel-style` (`:335-351`) — conserver l'injection. `opt.keepOpen` empêche la fermeture après action. |
| `archive.ts` | **Validation du manifest AVANT toute modification** (`archive.js:129-147`) : refuser sans rien effacer. **Double snapshot** localStorage + images IDB, `rollback()` intégral sur échec (`:160-232`). Les images sont stockées en `.txt` à l'export mais l'import accepte `.txt` **et** `.bin` (`:218`). Passerelle OI : dédup par `_normName`, photo lue dans `images/<encodeURIComponent(id)>.bin` avec repli non encodé (`:369-370`). |
| `pdf-export.ts` | `PageSizes.A4` est un **tuple partagé** : `.slice()` à chaque `addPage` (`pdfExport.js:102-104, 161`). `sanitizeWinAnsi` : table de translittération à recopier **verbatim** (guillemets courbes, tirets, espaces insécables, BOM…). **Supprimer la section 7 « BOARD RELATIONNEL »** (`:503-538`, `window.Dashboard` mort). Section 6 : bascule de vue vers `view-plan` + `resize()` + attente 450 ms, restauration dans `finally`. Footer sur **toutes** les pages, `void restrictWidth` conservé ou supprimé au choix (variable inutilisée → `noUnusedLocals` : la supprimer avec son `void`). |
| `ui.ts` | **Supprimer** la branche `view-dashboard` (`ui.js:110-113`). `renderPhotos(filterCategory?)` sans argument reprend `lastPhotoFilter` (`:517-519`). `handlePhotoDrop` : garde `draggedIdx === -1 \|\| targetIdx === -1` (`:598`) — sans elle, `splice(-1,1)` déplace la dernière photo. `renderLogTable` : `_logDndBound` évite le double binding (`:246-250`) ; `dragend` avec `dropEffect === 'none'` re-render depuis le stockage (`:241-243`). `updateTimeInput` lit `window.isTimeInputManuallyChanged`. Les `esc()` viennent de `@shared/ui-platform.js`. |
| `tchap-live.ts` | S'auto-câble à l'import (`tchapLive.js:960-961`) — **conserver**. Lit `window.PlanMap` (jamais d'import direct : éviterait un cycle mais changerait l'ordre). Deux modes d'auth (token manuel / device-code ProConnect RFC 8628 + refresh). IndexedDB **propre** (`pcTacTchapLive`/`tchapLiveState`), distinct de `pcTacImages`. `fetch('members_config.json')` **relatif** → à réécrire en `/members_config.json` **si et seulement si** l'asset a été copié dans `public/` en P0.A2 ; sinon conserver le chemin relatif et **signaler**. Ne PAS confondre avec le prototype `tchap-live/` de la racine (`recon-pctac.md` §7.9). |

---

## 10. Ce qui n'est PAS dans le périmètre des paquets P2.B/P2.C

| Sujet | Phase |
|---|---|
| `src/apps/pctac/main.ts` (câblage, ordre d'init, délégation `data-action`) | **P2.D** |
| Tests E2E Playwright, checklist fonctionnelle `recon-pctac.md` §6 | **P2.E** |
| Diffs visuels, modernisation `styles/pctac.css`, purge du CSS mort (`#version-toggle-btn`) | **P2.F** |
| Service Worker, manifest PWA, précache | **P4.A** |
| Retrait définitif du cluster mort `planmap/legacy.ts` | post-P2, sur décision explicite |
