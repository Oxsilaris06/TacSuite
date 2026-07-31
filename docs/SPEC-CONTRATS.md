# SPEC-CONTRATS — contrats globaux `window.*` (P1.A0)

Document de référence pour toutes les phases suivantes. Il recense les contrats
globaux des DEUX applications, leur rôle, leurs consommateurs RÉELS (relevés
par lecture du code de `/home/nico/Bureau/Web/GStart-main`, en lecture seule),
la stratégie de façade retenue pour le portage TypeScript, et la condition de
retrait de chaque façade.

Artefacts produits par P1.A0 :

| Fichier | Contenu |
|---|---|
| `src/shared/types/contracts.ts` | Interfaces TypeScript exportées, une par contrat |
| `src/shared/types/global.d.ts` | Augmentation `Window` rattachant chaque contrat |
| `src/shared/types/tuto.ts` | Types des DONNÉES de tutoriel (`TutoStep`, `TutoChapter`, `TutoData`…) |

Vérifications exécutées : `npm run typecheck` → 0 erreur ; `npm run lint` → 0 erreur.

---

## 0. Principes de typage retenus

1. **`any` interdit.** `unknown` est utilisé là où la donnée est réellement
   hétérogène (`Store.state.formData`, valeurs JSON restaurées, instance JSZip).
   Chaque `unknown` est accompagné d'un commentaire de justification.
2. **Surcharges implicites du JS** rendues par paramètres optionnels et unions
   (`renderPhotos(filterCategory?)`, `togglePatracBatchMode(force?)`,
   `addMoicp(data?: Partial<OiMoicpBlock> | null)`…).
3. **`exactOptionalPropertyTypes` actif** : tout champ pouvant recevoir
   explicitement `undefined` est déclaré `?: T | undefined`.
4. **Règle d'optionnalité sur `Window`** (détaillée en tête de `global.d.ts`) :
   une propriété est REQUISE quand le module qui la pose est importé
   inconditionnellement par l'entrée de l'app ; elle n'est OPTIONNELLE que si
   elle peut réellement manquer à l'exécution. Aujourd'hui, seules deux
   propriétés sont optionnelles : `QrSync` (module jamais chargé) et
   `isTimeInputManuallyChanged` (posée paresseusement).
   Les gardes défensives des originaux (`if (window.X)`,
   `typeof X === 'function'`) restent valides en TS sur un type requis : elles
   se portent **verbatim**, sans régression.
5. **Façades vs internes.** Pour les deux gros objets (`PlanMap` ~190 membres,
   `OICarto` ~90 membres), l'interface publiée ne couvre QUE la surface lue
   depuis l'extérieur du module. Les membres privés (`_*`) restent typés dans
   le module TS. Le runtime est inchangé (`window.PlanMap = PlanMap` sur une
   *variable*, donc pas de contrôle d'excédent de propriétés) : c'est un
   rétrécissement de TYPE, pas d'API.

---

## 1. Contrats PARTAGÉS (OI + PC-Tac)

### 1.1 `window.UIPlatform` — `shared/ui-platform.js` (319 LOC)

**Rôle.** Socle transverse « native-quality » : échappement HTML, persistance
d'état UI, verrou de scroll réf-compté, recadrage viewport, gestes
(long-press / double-tap), tri tactile unifié (Pointer Events), dialogs et
tablists accessibles, suivi du clavier virtuel. Script classique idempotent
(`if (window.UIPlatform) return;`), chargé en tout premier dans les deux pages.

**Consommateurs réels** (grep par méthode, hors `ui-platform.js` lui-même) :

| Méthode | Consommateurs |
|---|---|
| `esc` | `modules/pctac/ui.js:9`, `modules/pctac/planMap.js:23-24`, `modules/formulaires.js:105,189,1140`, `modules/patrac.js:1060`, `modules/oi_cartographie.js:594` |
| `sortable` | `modules/articulation.js:439,442` |
| `makeTablist` | `modules/pctac/main.js:58-59`, `4.html:4569-4570` |
| `escAttr`, `loadState`, `saveState`, `persistState`, `lockScroll`, `unlockScroll`, `clampToViewport`, `onLongPress`, `onDoubleTap`, `makeDialog` | **aucun** (exposés, jamais appelés) |

**Interface.** `UIPlatformContract` (+ 8 interfaces d'options/handles).
Nuance relevée : le JSDoc annonce `onReorder(orderedEls, fromIdx, toIdx)` mais
le code n'en passe que **deux** (`ui-platform.js:211`) — la signature typée est
celle du code.

**Stratégie de façade.** Module TS interne `src/shared/ui-platform.ts` exportant
un objet `UIPlatform` ; l'entrée de chaque app pose `window.UIPlatform = UIPlatform`
(idempotence conservée). Les consommateurs internes passent à l'`import` direct.

**Retrait.** La façade `window` n'a plus d'utilité dès que **plus aucun script
inline** des deux pages n'y accède — c'est-à-dire après **P3.C** (le seul accès
hors module est `4.html:4569-4570`, absorbé par `src/apps/oi/main.ts`).
Recommandation : la conserver jusqu'au gate P4.C, la retirer ensuite.

### 1.2 `window.PocheTuto` — `modules/tuto-engine.js` (755 LOC)

**Rôle.** Moteur de tutoriel pas-à-pas autonome et partagé à l'identique par les
deux apps. Injecte lui-même son déclencheur (item de dock `#ptutoDockBtn` après
`#dockToggleBtn`, ou FAB flottant en repli). Persiste la progression sous
`ptuto_<appId>_seen` / `_pos` / `_greeted`.

**Consommateurs réels.**
`modules/tuto_oi_data.js:10,14` (`appId:'oi'`) et
`modules/pctac/tuto_data.js:10,14` (`appId:'pctac'`), tous deux gardés par
`if (!window.PocheTuto || !window.PocheTuto.mount)`.

**Interfaces.** `PocheTutoContract`, `PocheTutoConfig`, `PocheTutoDockConfig`,
`PocheTutoInstance` (contracts.ts) ; `TutoData`, `TutoChapter`, `TutoStep`,
`TutoIntro`, `TutoFlatStep` (tuto.ts).

**Structure des données (relevé exhaustif sur les DEUX fichiers).**

| Niveau | Champs | Observations |
|---|---|---|
| `intro` | `title`, `text` | `text` est présent dans les deux jeux mais **jamais lu** par le moteur (seul `intro.title` l'est, `tuto-engine.js:463`) |
| `chapter` | `id`, `icon`, `title`, `summary`, `steps` | 8 chapitres (oi) / 9 (pctac), tous champs présents |
| `step` | `title`, `body`, `terms`, `selector`, `tip` | 56 steps (oi) / 73 (pctac) ; `selector` `null` 5×/36× ; `tip` `null` 6×/20× ; `terms` `string[]` parfois vide (4× pctac) ; **aucun `""`** — l'absence est toujours `null` |

`body` et `tip` acceptent un mini-markdown `**gras**` (échappé d'abord).
`terms` n'est pas affiché : il alimente uniquement la recherche
(`tuto-engine.js:659`).

**Stratégie de façade.** `src/shared/tuto-engine.ts` (P1.A3) exporte l'objet et
pose `window.PocheTuto`. Les données deviennent des `const` TS typées `TutoData`
(P1.A4), importées par l'entrée de chaque app, qui appelle `PocheTuto.mount(...)`.

**Retrait.** La façade `window` peut disparaître dès que les deux jeux de
données sont des modules TS (fin P1.A4) — les données ne « cherchent » plus le
moteur sur `window`. Conservée jusqu'au gate P4.C par précaution (le moteur est
aussi le seul point d'extension d'un futur tuto tiers).

---

## 2. Contrats PC-Tac

### 2.0 `Persist` — contrat de MODULE (jamais sur `window`)

**Rôle.** Couche de persistance transactionnelle canonique
(`modules/pctac/persist.js`, 258 LOC, **zéro import** par conception) :
ne jette jamais sur quota (émet `CustomEvent('pctac:quota')`), sauvegarde la
chaîne brute dans `<key>.bak` si le JSON est corrompu ou rejeté par le
validateur, tolère un `localStorage` totalement indisponible.

**Consommateurs.** `storage.js:2`, `logManager.js:2`, `planMap.js:18`,
`tchapLive.js` (import), `dashboard.js` (mort).

**Interfaces.** `PersistContract`, `PersistWriteResult`, `PersistGetOptions<T>`,
`PctacQuotaEventDetail`.

Nuance typée : `get<T>` est une **assertion** dont la preuve d'exécution est
`opts.validator` — c'est exactement le contrat d'usage d'origine
(`Persist.get(K, { validator: isArray, fallback: [] })`). Sans validateur,
appeler avec `T = unknown`.

**Stratégie.** Aucune façade `window` (invariant à préserver : module standalone,
« aucun cycle possible »). L'interface vit dans `contracts.ts` uniquement pour
que tous les consommateurs partagent la même définition.

### 2.1 `window.PlanMap` — `modules/pctac/planMap.js:5596`

**Rôle.** Vue Plan tactique MapLibre : recherche d'adresse (Nominatim), pings
liés-entité et libres, dessin, mesure, verrous global et par-annotation, mode 3D,
cache hors-ligne AOI, capture PNG.

**Consommateurs hors `planMap.js`** (surface RÉELLE du contrat inter-modules) :

| Consommateur | Membres utilisés |
|---|---|
| `modules/pctac/main.js:460` | `initialized`, `refresh()` |
| `modules/pctac/ui.js:108` | `refresh()` |
| `modules/pctac/pdfExport.js:402,412,417` | `captureToDataUrl()`, `map` (puis `map.resize()`) |
| `modules/pctac/pdfExport.js:448,451` | `getPinsSummary()` |
| `modules/pctac/tchapLive.js:226-234` | `initialized`, `init()`, `map` |

**Interface.** `PlanMapContract` = `{ map, initialized, init(), refresh(),
getPinsSummary(), captureToDataUrl() }` + `PlanMapPinSummary`.
Les ~185 autres membres (tous `_`-préfixés sauf `AOI_MIN_Z`/`AOI_MAX_Z`, non lus
de l'extérieur) restent internes au module TS et seront spécifiés en **P2.A0**
(`SPEC-PLANMAP-SPLIT.md`).

**Contrats documentés dans le code d'origine, préservés dans les types :**
- `captureToDataUrl()` (CONTRAT C2) → `Promise<string | null>` ; `null` si carte
  non initialisée, `html2canvas` absent, vue masquée, canvas de largeur 0 après
  2 rAF, ou capture déjà en cours (`_captureBusy`).
- `getPinsSummary()` (CONTRAT C2) → `PlanMapPinSummary[]`, `[]` en cas d'échec,
  jamais d'exception.

**Stratégie de façade.** `src/apps/pctac/plan-map/index.ts` (ou équivalent P2.A0)
exporte l'objet ; `window.PlanMap = PlanMap` est conservé tant que
`tchapLive.ts` y accède.

**Retrait.** Deux conditions cumulatives : (a) `tchapLive.ts` importe `PlanMap`
directement — c'est possible **sans cycle**, `planMap.js` n'importe pas
`tchapLive.js` ; (b) `pdfExport.ts` et `ui.ts` font de même. Cible : **P2.D**,
validation au gate **P2.E**.

### 2.2 `window.UI` + 6 binds individuels — `modules/pctac/ui.js:884-890`

**Rôle.** Contrôleur UI central (~50 méthodes) : refs DOM, rendu du journal +
drag&drop, navigation d'onglets, CRUD des 4 collections, modales d'édition,
palettes, thème, plein écran, recherche.

**Consommateurs `onclick` INLINE (HTML statique) — `pctac2.html` :**

| Ligne | Attribut |
|---|---|
| 2157 | `onclick="UI.hideCreatePaxModal()"` |
| 2223 | `onclick="UI.hideEditModal()"` |
| 2255 | `onclick="UI.hideEditAdversaryModal()"` |
| 2286 | `onclick="UI.hideEditHostageModal()"` |
| 2343 | `onclick="UI.closeLightbox()"` |

**Consommateurs `onclick` GÉNÉRÉS en `innerHTML` — `modules/pctac/ui.js` :**

| Ligne | Appel |
|---|---|
| 214 | `window.openEditModal(...)` |
| 217 | `window.deleteLogEntry(...)` |
| 460 | `window.UI.showEditAdversaryModal(...)` |
| 461, 491, 508, 551 | `window.deleteCollectionItem(...)` |
| 490 | `window.UI.showEditHostageModal(...)` |
| 530 | `UI.renderPhotos(...)` |
| 545 | `UI.openLightbox(...)` |
| 550 | `window.UI.editPhotoTitle(...)` |
| 557, 563 | `UI.updateAdversaryStatus(...)` |

**Binds individuels sans AUCUN consommateur** (vérifié par grep sur
`pctac2.html` et `modules/pctac/*.js`) : `window.setPaxMode`,
`window.switchMainView`, `window.toggleSearchMode`, `window.closeSearchMode`,
`window.filterLogs`. Seul `window.openEditModal` est réellement utilisé.

**Interfaces.** `UIContract`, `PctacUiElements`.
`elements` est typé `Partial<PctacUiElements>` : l'objet vaut `{}` avant
`initElements()` et tous les accès du code d'origine sont gardés.

**Stratégie de façade.** `src/apps/pctac/ui.ts` exporte `UI` ; `main.ts` pose
`window.UI` + les 6 binds, à l'identique, **tant que les `onclick` existent**.

**Retrait.**
- Les 5 binds sans consommateur (`setPaxMode`, `switchMainView`,
  `toggleSearchMode`, `closeSearchMode`, `filterLogs`) peuvent être supprimés
  **dès P2.D** — aucun consommateur à casser.
- `window.UI`, `window.openEditModal`, `window.deleteLogEntry`,
  `window.deleteCollectionItem` disparaissent lorsque **P2.D** aura remplacé
  les 5 `onclick` statiques et les 13 `onclick` générés par de la délégation
  d'événements (`data-action` + listener unique sur le conteneur).

### 2.3 `window.deleteLogEntry` / `window.deleteCollectionItem` — `main.js:293,298`

**Rôle.** Handlers de suppression définis inline dans l'entrée, appelés depuis
les boutons générés en `innerHTML`.
`deleteCollectionItem(key, id, viewId)` : `confirm()`, retrait de la collection,
suppression de l'image IndexedDB, puis **suppression en cascade** de la photo
`<id>_sync` pour `view-adversaires` / `view-otages`.

**Retrait.** Même échéance que §2.2 (P2.D).

### 2.4 `window.Archive` — `modules/pctac/archive.js:459`

**Rôle.** Export/import « tout-en-un » `.pctac.zip` (manifest + `data.json` +
`images/<id>.txt`), import legacy `.json`, et **passerelle OI → PC-Tac**
(lecture d'un `.oi.zip`, fusion non destructive des adversaires et des
trigrammes PATRACDVR).

**Consommateurs.** Aucun via `window`. Le module est **importé dynamiquement**
par `main.js:436` (`const { Archive } = await import('./archive.js')`), puis
utilisé pour câbler `#exportJsonDockBtn`, `#importJsonDockBtn` et
`#importOiDockBtn`.

**Interfaces.** `ArchiveContract`, `ArchiveImportResult`, `ArchiveOiImportResult`.

**Retrait.** `window.Archive` est du pur legacy : supprimable **dès P2.D**
(l'import dynamique reste, il porte tout l'usage réel).

### 2.5 `window.ImageStore` — `modules/pctac/imageStore.js:154`

**Rôle.** Cache image binaire IndexedDB (`pcTacImages` / store `images` / v1) +
migration one-shot base64 → IDB (flag `pcTacIdbMigratedV1`).

**Consommateurs.** Aucun via `window` : `ui.js`, `pdfExport.js`, `archive.js` et
`main.js` l'importent en ESM.

**Interface.** `ImageStoreContract`. Nuance documentée : `put`/`delete`/
`deleteMany`/`clear` résolvent sur le commit de transaction avec un artefact IDB
interne jamais consommé — typés `Promise<void>`.

**Retrait.** Supprimable **dès P2.D**.

### 2.6 `window.LogManager` — `modules/pctac/logManager.js:139`

**Rôle.** Logique métier du journal : `addEntry` (validation + `alert()`),
historique LRU des lieux (30 max), `deleteEntry`, `updateEntry`, `importJson`
(dédup par `id`).

**Consommateurs.** Aucun via `window` (`main.js` l'importe).
Note d'origine (`logManager.js:136-138`) : l'ancien `window.deleteLogEntry`
défini ici était systématiquement écrasé par `main.js` — il a déjà été retiré.

**Interfaces.** `LogManagerContract`, `PctacLogEntryInput`,
`PctacLegacyLogJson`, `PctacImportJsonResult`.

**Retrait.** Supprimable **dès P2.D**.

### 2.7 `window.PdfExport` — `modules/pctac/pdfExport.js:596`

**Rôle.** Export PDF pdf-lib multi-pages (journal, fiches, photos par catégorie,
snapshot carte). Surface publique : **une seule méthode**, `buildPdf()`.

**Consommateurs.** Aucun via `window` (`main.js` l'importe pour `#previewPdfDockBtn`).

**Interface.** `PdfExportContract`.

⚠ `pdfExport.js:504-520` référence encore `window.Dashboard.captureToDataUrl` de
façon défensive : **branche morte** (cf. §4.1) — à supprimer au portage.

**Retrait.** `window.PdfExport` supprimable **dès P2.D**.

### 2.8 `window.QrSync` — `modules/pctac/qrSync.js:193` — ⚠ MODULE MORT

**Rôle déclaré.** Transfert du journal par QR code (chunking `QR_BATCH_SIZE = 5`,
génération `qrcode.js`, scan caméra `html5-qrcode`).

**Constat de reconnaissance (contredit `recon-pctac.md` §3, qui le présentait
comme « toujours câblé ») :**

| Vérification | Commande | Résultat |
|---|---|---|
| Importé par le graphe ESM ? | `grep -rn "qrSync" modules/pctac/*.js pctac2.html` (hors `qrSync.js`) | **0 occurrence** |
| Balise `<script>` ? | `grep -n "<script" pctac2.html` | 9 balises, **aucune** ne charge `qrSync.js` |
| DOM piloté présent ? | `grep -c "transferModal\|qr-reader\|qrcode-container" pctac2.html` | **0** |

⇒ `window.QrSync` n'est **jamais posé** et le DOM qu'il manipule n'existe pas
dans la page. Même statut de fait que `dashboard.js`.

**Interface.** `QrSyncContract` fournie (exigée par la mission), + `PctacQrRow`,
`PctacQrScanCallback`. Déclarée **optionnelle** sur `Window`.

**Recommandation (à arbitrer par l'orchestrateur avant P2.C).** Exclure
`qrSync.js` du portage, au même titre que `dashboard.js` : ni le module ni le
DOM ne sont chargés, la fonctionnalité est de toute façon remplacée par
l'archive `.pctac.zip`. Si l'exclusion est retenue, supprimer aussi
`QrSyncContract` et sa déclaration `Window`, ainsi que les dépendances npm
`qrcodejs` et `html5-qrcode` (elles ne servent QU'à ce module).

### 2.9 Binds de `modules/pctac/storage.js:114-117`

`window.saveLogData`, `window.loadLogData`, `window.getTpAssociations`,
`window.saveTpAssociation` — exposés « pour compatibilité ».

**Consommateurs : AUCUN** (grep sur `pctac2.html` et `modules/pctac/*.js` :
0 occurrence hors la ligne de définition).

**Interface.** `PctacStorageContract` (l'objet `Storage` complet, y compris
`saveCollection` / `loadCollection` / `clearAllData` qui ne sont PAS sur
`window`) ; seules les 4 méthodes bindées sont rattachées à `Window`
(via `Pick<...>`).

Piège documenté : `saveTpAssociation(label, color)` écrit `assoc[color] = label` —
la map est indexée par **couleur**, pas par libellé.

**Retrait.** Supprimables **dès P2.D**.

### 2.10 Constantes de `modules/pctac/config.js:310-317`

`window.PIN_ICONS`, `window.suggestPinIcons`, `window.LOCAL_STORAGE_KEY`,
`window.PHOTO_CATEGORIES`, `window.FREE_MODE_COLORS`, `window.PDF_PAX_COLORS`.

**Consommateurs : AUCUN** (grep `pctac2.html` + `modules/pctac/*.js` : les seules
occurrences sont les exports ESM et les lignes de définition).

**Interface.** `PctacConfigGlobals` + `PctacPinIcon`, `PctacPhotoCategory`,
`PctacNamedColor`, `PctacPaxColorEntry`.

⚠ **Homonymie inter-apps** : `window.LOCAL_STORAGE_KEY` vaut `'pcTacLogData'`
côté PC-Tac (`config.js:314`) et `'tactical_oi_data'` côté OI (`init.js:8`).
Aucune collision à l'exécution (deux documents distincts) ; une seule
déclaration `string` couvre les deux cas, avec le commentaire correspondant
dans `global.d.ts`.

**Retrait.** Supprimables **dès P2.D**.

### 2.11 `window.isTimeInputManuallyChanged`

Drapeau booléen partagé entre `main.js:39` (pose `true` au premier `input` sur
`#heure_input`), `main.js:100` (remet `false` après soumission) et
`ui.js:84` (`updateTimeInput` n'écrase pas l'heure si le drapeau est posé, sauf
`force`). Déclaré **optionnel** : absent tant que l'utilisateur n'a pas touché
le champ.

**Retrait.** Devient un état de module partagé en TS (P2.C/P2.D) ; la propriété
`window` disparaît alors.

---

## 3. Contrats OI (Générateur d'Ordre Initial)

Les 16 modules de `4.html` sont des **scripts classiques** : toute
`function foo()` de premier niveau devient automatiquement `window.foo`.
En revanche, les `let`/`const` de premier niveau (`steps`, `progressSteps`,
`prevBtn`, `nextBtn`, `previewBtn`, `patracdvrContainer`, `unassignedContainer`,
`resetPatracdvrBtn`, `presentationModal`, `downloadPdfBtn`,
`coherenceAlertsContainer`, `recapFinalisation`, `annotationModal`, `canvas`,
`ctx`, `rotationInput`, `activeMemberId`, `currentTool`, `selectedAnnotation`,
`currentAnnotationColor`, `memberConfig`, `DEFAULTS`…) créent des **liaisons
lexicales globales, PAS des propriétés de `window`**.
⇒ Elles ne sont **pas** déclarées dans `global.d.ts` : elles deviendront de
l'état de module en TypeScript. Seules celles que le code re-pose
explicitement (`window.memberConfig`, `window.DEFAULTS`, `window.visitedSteps`,
`window.LOCAL_STORAGE_KEY`) sont typées.

### 3.1 Socle — `modules/init.js`

| Global | Interface | Notes |
|---|---|---|
| `window.LOCAL_STORAGE_KEY` (init.js:8) | `string` | `'tactical_oi_data'` |
| `window.Store` (init.js:340) | `OiStoreContract` | Proxy profond ; **invariant** : `Blob`/`File`/`ArrayBuffer`/TypedArray ne sont PAS proxyfiés (init.js:112-121) — corrompt sinon pdf-lib et `URL.createObjectURL` |
| `window.dbManager` (init.js:341) | `OiDbManagerContract` | IndexedDB `OI_GeneratorLiteDB` / store `images` ; `putItem` résout sur le **commit** de transaction |
| `window.visitedSteps` (init.js:342) | `Set<number>` | Muté en place, jamais réassigné → la référence posée sur `window` reste valide |
| `window.memberConfig` (init.js:343) | `OiMemberConfig` | Idem : `loadConfigObject` fait `Object.assign(memberConfig, …)`, jamais de réaffectation |
| `window.saveToStorage`, `window.saveFormData` (init.js:346,353) | `OiFormGlobals` | Alias ; **écrasés plus tard** par `formulaires.js:842-843` (voir §3.3) |
| `window.DEFAULTS` (init.js:356) | `OiDefaults` | Textes pré-remplis MOICP / ZMSPCP / Effraction |

Modèles de données dérivés typés dans `contracts.ts` :
`OiStoreState`, `OiFormData`, `OiAdversary`, `OiPatracMember`, `OiPatracRow`,
`OiMoicpBlock`, `OiZmspcpBlock`, `OiEffractionBlock`,
`OiEffractionHypothesis`, `OiTimeEvent`, `OiPhotoMeta`, `OiCartographyState`,
`OiCartoView`, `OiAnnotation` (union `OiPointAnnotation` | `OiShapeAnnotation`).

`OiFormData` est un dictionnaire ouvert (`[key: string]: unknown`) — les clés
sont les `id`/`name` du DOM — **plus** les 15 sous-structures connues typées
explicitement (relevées dans `formulaires.js:406-539`).

### 3.2 Wizard — `modules/navigation.js`

`showStep(n)`, `goToStep(n)`, `changeStep(n)` (`OiWizardGlobals`).
Consommateurs : `4.html:4566` (`goToStep(i)` au clavier), `4.html:4596-4597`
(`changeStep(±1)`), `4.html:4787` (`showStep(savedStep)`), et **8 `onclick`
inline** `goToStep(0..7)` sur les puces `.wizard-progress-step`.
Persistance : `oiWizardStep`, `oiVisitedSteps`.

### 3.3 Persistance formulaire — `modules/formulaires.js` (`OiFormGlobals`)

⚠ **Piège majeur à préserver** (`formulaires.js:386-393`) :

```js
const debouncedSync = debounce(syncDomToStore, 500);
const immediateSync = syncDomToStore;          // capture AVANT écrasement
window.syncDomToStore = debouncedSync;         // écrase la fonction homonyme
window.syncDomToStoreImmediate = immediateSync;
```

⇒ après cette ligne, l'identifiant nu `syncDomToStore` **désigne la version
débouncée**. `window.flushFormData` (`:844`) est la seule voie vers la version
immédiate, utilisée pour les flush de fin de cycle de vie
(`pagehide`/`beforeunload`/`visibilitychange`) et par `navigation.js:24` avant
`checkCoherence()`. Les alias `window.saveToStorage` / `window.saveFormData`
(`:842-843`) écrasent ceux d'`init.js` et pointent la version **débouncée**.

Autres globaux typés : `loadFormData`, `checkCoherence`, `addDynamicField`,
`initChipContainer`, `getChipData`, `addMeField`, `addTimeEvent`,
`updateAdvTitle`, `addAdversary`, `removeAdversary`, `toggleAdvSection`,
`addHypothesis`, `exportSession`, `importSession`, `exportArchive`,
`importArchive`, `parseArchive`, `detectImportCategories`,
`showImportSelectModal`, `resetActivePage`, `resetAllData`, `isFormLoading`.

Types associés : `OiParsedArchive` (union `Ok`/`Error`), `OiImportCategory`.

Consommateurs `onclick`/`oninput` inline de `4.html` :
`syncDomToStore()`, `addAdversary()`, `addHypothesis()`, `addTimeEvent()`.
Consommateurs générés en `innerHTML` : `addDynamicField(...)`,
`addMeField(...)`, `removeAdversary(...)`, `toggleAdvSection(this)`,
`updateAdvTitle(...)`, `syncDomToStore()`.

### 3.4 PATRACDVR — `modules/patrac.js` (`OiPatracGlobals`)

23 fonctions + `window.contextMemberId` (id du bouton visé par le menu
contextuel, `patrac.js:241`).
Consommateurs inline : `window.cloneMemberFromContext()` et
`window.deleteMemberFromContext()` (`4.html`), `renameVehicle(this)`
(`innerHTML`). Tous les autres sont câblés par le `DOMContentLoaded` inline de
`4.html:4536-4814` (donc absorbés par `src/apps/oi/main.ts`).

### 3.5 Articulation — `modules/articulation.js` (`OiArticulationGlobals`)

`addMoicp`, `addZmspcp`, `addEffraction`, `addEffractionHypothesis`,
`openEffractionToolsModal`, `saveEffractionTools`,
`refreshArticulationFromPatracdvr`, `refreshRameVL`,
`refreshColonneProgression`, `refreshOrdrePenetration`.
Consommateurs inline : `saveEffractionTools()` (`4.html`),
`addEffractionHypothesis(...)` et `openEffractionToolsModal(...)` (`innerHTML`).

⚠ `articulation.js` pose ses globaux **deux fois** (`:21-27` puis `:1003-1009`)
et `addEffractionHypothesis` est réassignée en `:911` — redondance à ne pas
reproduire, mais à vérifier iso-comportement (les valeurs finales sont
identiques).

### 3.6 Drag & drop — `modules/drag.js` (`OiDragGlobals`)

`initializeDragDropListeners()`, `initDocumentDragTransfer()`.
Rappel plan §7 : les règles de drag&drop sont **dupliquées** entre `patrac.js`
et `drag.js` ; la fusion en un module unique iso-comportement est une tâche
**P3.A0/P3.B**, elle ne change pas ce contrat.

### 3.7 Médias — `modules/medias.js` (`OiMediaGlobals`)

`handleFileChange`, `removeImage`, `syncAllThumbnails`,
`handleCustomBackgroundChange`, `removeCustomBackground`, `updateCustomBgPreview`.
Consommateurs inline : `handleCustomBackgroundChange(this)`,
`handleFileChange(this, '<containerId>', false)` (`4.html`, 2 occurrences),
`removeCustomBackground()`, et `handleFileChange(...)` / `removeImage(...)`
générés en `innerHTML`.
`syncAllThumbnails` est appelé depuis `init.js:187` via `window.`.

### 3.8 Annotation canvas — `modules/dessin.js` (`OiAnnotationGlobals`)

`openAnnotationModal`, `closeAnnotationModal`, `initAnnotationWorkspace`,
`setActiveTool`, `updateStrokeWidth`, `updateTextSize`, `updateZoneText`,
`updateZoneOpacity`, `updateAnnotationRotation`, `setAnnotationColor`,
`undoAnnotation`, `redoAnnotation`, `changeZoom`, `resetZoom`,
`toggleMobileDock`, `closeMobileSheet`, `populateMemberCanvasModal`.
Consommateurs inline : `closeAnnotationModal()`, `closeMobileSheet()`,
`toggleMobileDock()`, `setAnnotationColor('<hex>', this)` (5 occurrences),
et `openAnnotationModal(...)` en `innerHTML`.

Types : `OiAnnotationTool` (`'move' | 'location' | 'arrow' | 'box' | 'text' |
'member'`, déduit des `id="tool_*"` de `4.html` ; `tool_reset` est un bouton,
pas un outil) ; `OiAnnotation`.
Nuance typée : les setters reçoivent la **valeur brute d'un `<input>`**
(`string`), parsée en interne (`parseInt`/`parseFloat`) ;
`updateAnnotationRotation` lit des **degrés** et écrit des **radians**.
`id` d'annotation = `Date.now() + Math.random()` → un **number**, pas une chaîne.

### 3.9 Génération du document — `pdf_engine_v2.js` / `presentation.js`

`window.PDFEngineV2` (`PdfEngineV2Contract`) + les 3 raccourcis
`openPresentationMode`, `downloadOiPdf`, `openPresentInPlace`
(`OiPresentationGlobals`).
Consommateur du contrat objet : `presentation.js:46-47` uniquement.
Types associés : `OiPdfEngineOptions`, `OiPdfCollectedData`, `OiPdfPageOptions`.

### 3.10 Cartographie OI — `modules/oi_cartographie.js:1669`

`window.OICarto` (`OICartoContract`). **Aucun consommateur externe** : le module
se câble lui-même sur `#cartographyBtn` (`oi_cartographie.js:1673-1677`).
Même politique que `PlanMap` : seule la surface publique
(`map`, `initialized`, `is3D`, `markers`, `labelsVisible`, `open()`, `close()`)
est typée ; les ~80 membres `_*` restent internes (spécification **P3.A0**).

### 3.11 Notifications & outils — `notifications.js` / `outils.js`

`window.showNotification(msg, type?, dur?)` et son alias `window.toast`
(`OiNotificationGlobals`) — `type` ∈ `'info' | 'success' | 'error' | 'warning'`
(défaut `'info'` ; valeurs réellement passées relevées par grep :
`success`, `error`, `warning`), `dur` défaut 4000 ms.
`window.cleanupObjectUrls`, `handleThemeToggle`, `toggleDock`,
`toggleFullscreen` (`OiToolsGlobals`).

⚠ `outils.js:207 embedPdfImageFromBytes` est signalé « inutilisé » par la
reconnaissance : hors contrat global, à trancher en P3.B.

### 3.12 Globaux des `<script>` inline de `4.html` (`OiInlineGlobals`)

| Global | Ligne | Rôle |
|---|---|---|
| `window.setPdfFormat(fmt)` | 4795 | Bascule A4 / 16:9 + persiste `pdfOutputFormat` ; 2 `onclick` inline |
| `window.pdfOutputFormat` | 4796 | Miroir mémoire du format courant |
| `window.openLogs()` | 98 | Fenêtre de logs mobile ; 1 `onclick` inline |
| `window.__capturedLogs` | 58 | Tampon circulaire de 500 lignes, persisté sous `gstart_captured_logs` |

### 3.13 Stratégie de façade OI et condition de retrait

**Façade.** Chaque module TS exporte ses fonctions ; `src/apps/oi/main.ts`
importe et pose sur `window` **uniquement** les noms encore requis par des
attributs `onclick`/`onchange`/`oninput` du DOM porté.

**Résidu minimal à conserver jusqu'à la fin de P3.C** (26 noms — union des
attributs inline de `4.html` et des attributs générés en `innerHTML`) :

`addAdversary`, `addDynamicField`, `addEffractionHypothesis`, `addHypothesis`,
`addMeField`, `addTimeEvent`, `cloneMemberFromContext`, `closeAnnotationModal`,
`closeMobileSheet`, `deleteMemberFromContext`, `goToStep`,
`handleCustomBackgroundChange`, `handleFileChange`, `openAnnotationModal`,
`openEffractionToolsModal`, `openLogs`, `removeAdversary`,
`removeCustomBackground`, `removeImage`, `renameVehicle`,
`saveEffractionTools`, `setAnnotationColor`, `setPdfFormat`, `syncDomToStore`,
`toggleAdvSection`, `toggleMobileDock`, `updateAdvTitle`.

**Retrait.** Tout le reste de la surface `window` OI (soit ~60 noms) est du
câblage intra-bundle : il devient de l'`import` ESM et peut disparaître de
`window` **dès P3.C**. Le résidu ci-dessus disparaît quand P3.C aura converti
les `onclick` inline en délégation d'événements (`data-action`), y compris ceux
générés en `innerHTML` par `formulaires.js`, `patrac.js`, `articulation.js`,
`medias.js` et `dessin.js`. Validation au gate **P3.D**.

---

## 4. Exclusions — grep de confirmation

### 4.1 `window.Dashboard` — `modules/pctac/dashboard.js` (1232 LOC) — EXCLU

| Vérification | Résultat |
|---|---|
| `import`/`<script>` de `dashboard.js` | **Aucun**. Les 3 occurrences trouvées (`archive.js:36`, `ui.js:111`, `main.js:9`) sont des **commentaires** ; `main.js:9-10` dit explicitement « VOLONTAIREMENT débranché […] Ne pas réimporter sans décision explicite » |
| `#view-dashboard` dans `pctac2.html` | `grep -c "view-dashboard" pctac2.html` → **0** |
| Lecteurs de `window.Dashboard` | 2, **tous gardés et morts** : `ui.js:110-112` (branche `viewId === 'view-dashboard'`, id inexistant) et `pdfExport.js:508-520` (`if (window.Dashboard && typeof … === 'function')`) |

⇒ **Aucune interface `DashboardContract`, aucune déclaration `Window`.**
Conséquence opérationnelle pour P2 : les deux branches défensives ci-dessus
**doivent être supprimées** au portage (elles ne compileront pas — c'est voulu,
cf. sonde négative exécutée en P1.A0 : `Property 'Dashboard' does not exist on
type 'Window & typeof globalThis'`). Ce n'est pas une régression : le chemin
n'est jamais emprunté, `window.Dashboard` n'étant jamais posé.
La clé localStorage `pcTacDashboard` reste, elle, gérée par `archive.js` et
`storage.js` (voyage dans l'archive, effacée par `clearAllData`) — **inchangé**.

### 4.2 `window.SharedComponents` — `modules/shared.js` (288 LOC) — EXCLU

| Vérification | Résultat |
|---|---|
| Chargé par un HTML ? | **Oui** : `4.html:4529` `<script src="modules/shared.js"></script>` |
| Appels `SharedComponents.{Adversaire,Pax,Photo}.*` hors `shared.js` | **0** (grep sur tout le dépôt, `old modules/` exclu) |
| Lecteurs de la clé `gstart_shared_data` hors `shared.js` | **0** |
| Effet de bord au chargement | `shared.js:286-287` → `SharedData.init()` qui **crée** `gstart_shared_data` avec `{adversaires:[],amis:[],otages:[],intervenants:[],photos:[]}` si la clé est absente |

⇒ **Aucune interface, aucune déclaration `Window`.** Le module est du code mort
au sens fonctionnel : son unique effet observable est la création d'une clé
localStorage que **personne ne lit**. Ne pas porter `modules/shared.js` ne
supprime donc aucune donnée exploitée et ne casse aucun consommateur.
Effet de bord assumé et tracé ici : après portage, la clé `gstart_shared_data`
ne sera plus créée (les clés existantes chez un utilisateur restent intactes —
aucune migration destructive, conformément au protocole §4.5 de `PLAN.md`).

### 4.3 Modules PC-Tac morts découverts en P1.A0 (hors périmètre initial)

| Module | Constat | Recommandation |
|---|---|---|
| `modules/pctac/qrSync.js` | Jamais importé, aucune balise `<script>`, DOM cible absent de `pctac2.html` (cf. §2.8) | Exclure du portage ; arbitrage orchestrateur avant P2.C |
| `modules/pctac/collectionManagers.js` | `grep -rn "collectionManagers\|AdversaryManager\|HostageManager\|FriendManager\|PhotoManager"` hors le fichier lui-même → **0 occurrence**. Les 4 instances ne sont jamais créées ; les collections passent par `Storage.loadCollection`/`saveCollection` | Exclure du portage |

Ces deux constats **corrigent** `recon-pctac.md` §2/§3 (qui présentait `QrSync`
comme un contrat vivant et `collectionManagers.js` comme instancié 4 fois).

---

## 5. Récapitulatif — condition de retrait de chaque façade `window`

| Façade | Consommateurs `window` aujourd'hui | Retirable |
|---|---|---|
| `UIPlatform` | `4.html:4569` (inline) | après P3.C |
| `PocheTuto` | 2 fichiers de données | après P1.A4 (conservée jusqu'à P4.C) |
| `PlanMap` | `main.js`, `ui.js`, `pdfExport.js`, `tchapLive.js` | P2.D (imports directs, aucun cycle) |
| `UI` + `openEditModal` + `deleteLogEntry` + `deleteCollectionItem` | 5 `onclick` statiques + 13 générés | P2.D (délégation d'événements) |
| `setPaxMode`, `switchMainView`, `toggleSearchMode`, `closeSearchMode`, `filterLogs` | **aucun** | P2.D, sans risque |
| `Archive`, `ImageStore`, `LogManager`, `PdfExport` | **aucun** (tous en ESM) | P2.D, sans risque |
| `saveLogData`, `loadLogData`, `getTpAssociations`, `saveTpAssociation` | **aucun** | P2.D, sans risque |
| `PIN_ICONS`, `suggestPinIcons`, `LOCAL_STORAGE_KEY`, `PHOTO_CATEGORIES`, `FREE_MODE_COLORS`, `PDF_PAX_COLORS` | **aucun** | P2.D, sans risque |
| `isTimeInputManuallyChanged` | `main.js`, `ui.js` | P2.D (état de module) |
| `QrSync` | **jamais posé** | exclusion recommandée |
| OI — 26 noms du résidu inline (§3.13) | attributs `onclick`/`oninput` | P3.C |
| OI — ~60 autres noms (`Store`, `dbManager`, `PDFEngineV2`, `OICarto`, `patracBatch*`, `refresh*`, …) | câblage intra-bundle uniquement | P3.C, sans risque |

---

## 6. Journal des vérifications P1.A0

```
npm run typecheck   → 0 erreur
npm run lint        → 0 erreur
sonde positive      → window.PlanMap / .UI / .Store / .PocheTuto / .UIPlatform /
                      .PDFEngineV2 / .memberConfig / .visitedSteps /
                      .__capturedLogs / .QrSync (optionnel) / goToStep /
                      getChipData / showNotification / deleteCollectionItem
                      compilent sans erreur
sonde négative      → window.Dashboard et window.SharedComponents produisent
                      TS2339 « Property does not exist » (exclusions opposables
                      à la compilation)
```

Aucune écriture dans `GStart-main` (lecture seule respectée : uniquement
`grep`, `sed -n`, `cat` en lecture).
