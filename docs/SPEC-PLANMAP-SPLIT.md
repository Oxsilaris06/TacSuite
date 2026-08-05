# SPEC-PLANMAP-SPLIT — découpage de `planMap.js` (P2.A0)

> **Document opposable.** Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
> (5 596 LOC, **lu intégralement**, LECTURE SEULE). Cible :
> `/home/nico/Bureau/Web/TacSuite/src/apps/pctac/planmap/`.
> À lire conjointement avec `docs/SPEC-PCTAC-CONVERSION.md` (conventions communes,
> imports, `window.*`, ordre d'init), `docs/SPEC-CONTRATS.md` §2.1 (contrat
> `PlanMapContract`) et `docs/PLAN.md` §4 (protocole zéro régression).

---

## 0. Décompte surface (vérifié)

| Catégorie | Nombre | Relevé |
|---|---:|---|
| Méthodes de l'objet `PlanMap` | **159** | `planMap.js:335 → 5590`, toutes indentées à 4 espaces |
| Propriétés de données déclarées dans littéral | **28** | `planMap.js:302-328` |
| Constantes publiques littéral | **2** | `AOI_MIN_Z` / `AOI_MAX_Z` (`:5303-5304`) |
| **Total membres littéral** | **189** | ≈ « ~190 membres » de `recon-pctac.md` |
| Propriétés ad hoc créées à l'exécution (hors littéral) | **28** | recensées en §3.2 |
| Helpers/constantes de MODULE (hors objet) | **19** | `planMap.js:23-299` |

 159 méthodes et 30 propriétés/constantes littéral sont affectées et seule fois dans tables §4 → §4.17 (contrôle : somme lignes
« méthodes » table §2 vaut 159).

---

## 1. Principe de découpage retenu (et pourquoi)

### 1.1 Contrainte

`planMap.js` est ** objet littéral unique** dont 159 méthodes s'appellent
mutuellement par `this._xxx()`, dans graphe **fortement cyclique**
(`_renderShapes` → `_renderShapeLocks` → `_toggleShapeLock` → `_renderHandles` →
`_startHandleGesture` → `_renderShapes`, `_renderPins` ↔ `_togglePinLock`,
`_setTool` ↔ `_startMeasure` ↔ `_clearMeasureState` ↔ `_setTool`…).

Deux découpages ont été envisagés :

| Option | Verdict |
|---|---|
| **A — fonctions libres `f(state, …)`** avec imports croisés entre sous-modules | **REJETÉE.** Réintroduit cycles au niveau ESM, oblige à réécrire ~900 sites d'appel `this._x(...)`, casse comparabilité ligne à ligne avec l'original (protocole §4.7 : *fidélité avant élégance*). |
| **B — groupes de méthodes `this`-typés, réassemblés par façade** | **RETENUE.** |
### 1.2 Option B — règle unique et opposable

> **Chaque sous-module exporte objet de méthodes dont chaque méthode déclare
> `this: PlanMapInternal`. Aucun sous-module de méthodes n'importe autre> sous-module de méthodes.** seules dépendances autorisées sont :
> `./types.js` (types uniquement), `./constants.js`, `./geo.js`, `./tiles.js`
> (fonctions **pures**), `@shared/*`, `@pctac/*` (modules hors planMap) et 
> paquets npm.

Conséquences :

1. **Zéro cycle ESM** : `types.ts`, `constants.ts`, `geo.ts`, `tiles.ts` sont 
 feuilles ; 13 groupes de méthodes sont feuilles entre eux ; seul
 `index.ts` importe tout monde.
2. ** corps de méthodes sont portés VERBATIM** : `this._renderShapes()`,
 `this.map`, `this._locked`… restent écrits à l'identique. diff avec
 l'original se limite au typage.
3. **Parallélisme maximal** : 15 paquets en vague 2 sans se voir.4. **Test unitaire trivial** : groupe se teste en l'appelant avec `this`
 factice (`GroupMethods._formatDistance.call(fakeState, 1234)`), ou en montant
 façade complète (`index.ts`) en jsdom.

### 1.3 Forme exacte d' groupe de méthodes

```ts
// src/apps/pctac/planmap/<module>.ts
import type { PlanMapInternal, PlanPin } from './types.js';

export const XxxMethods = {
    _maMethode(this: PlanMapInternal, arg: string): void {
        // corps VERBATIM de l'original
        this._autreMethode(arg);
    },
    // …
};
```

* paramètre `this` n'est PAS compté par `noUnusedParameters` (règle TS) : il
 peut donc être déclaré même si corps ne l'utilise pas — mais **on ne 
 déclare que si corps utilise réellement `this`** (cas de `geo.ts`, qui n'en
 a pas besoin).
* **Aucun `export default`** dans sous-modules (seul `index.ts` en a ).
* nom de l'objet exporté est imposé par table §2 (colonne « Export »).
### 1.4 Réassemblage (`index.ts`)

```ts
import { createPlanMapState } from './state.js';
import { SafeMethods }   from './state.js';
import { GeoMethods }    from './geo.js';
/* … 13 autres groupes … */
import type { PlanMapInternal } from './types.js';

export const PlanMap: PlanMapInternal = {
    ...createPlanMapState(),
    ...SafeMethods,
    ...GeoMethods,
    ...MapCoreMethods,
    ...ChromeMethods,
    ...PingModalMethods,
    ...PinsMethods,
    ...DrawLayersMethods,
    ...DrawToolsMethods,
    ...MeasureMethods,
    ...ShapesRenderMethods,
    ...ShapesGesturesMethods,
    ...WheelsMethods,
    ...PanelsMethods,
    ...TextModalMethods,
    ...CaptureMethods,
    ...AoiMethods,
    ...LegacyMethods,
};

// planMap.js:5596 — VERBATIM : la façade est posée au SCOPE MODULE (cf. §6.1)
window.PlanMap = PlanMap;

export default PlanMap;
```

L'annotation `: PlanMapInternal` sur cible fait vérification d'exhaustivité :
**si seul 189 membres manque, `tsc` échoue.** C'est filet de sécurité
« aucun oubli » exigé par mission.

---

## 2. Carte sous-modules

Tous sous `src/apps/pctac/planmap/`.

| # | Fichier | Export(s) | Méthodes | Props | Responsabilité | Dépendances internes |
|---:|---|---|---:|---:|---|---|
| 1 | `types.ts` | *types uniquement* | — | — | Modèle de données (`PlanPin`, `PlanShape`…), `PlanMapState`, `PlanMapInternal`, `PlanWheel` | — (feuille : aucun import de paquet PC-Tac) |
| 2 | `constants.ts` | `PINS_KEY`, `VIEW_KEY`, `SHAPES_KEY`, `ENTITY_COLORS`, `RASTER_STYLE`, `OFFLINE_MAP_CACHE`, `SAT_TILE_TEMPLATE`, `FRANCE_BBOX`, `AOI_INDEX_KEY`, `AOI_MAX_TILES`, `escHtml` | — | — | Constantes de module (`planMap.js:23-130`) | `./types.js`, `@shared/ui-platform` |
| 3 | `geo.ts` | 14 fonctions pures + `GeoMethods` | 12 | — | Géodésie, formats, géométrie de forme (aucun DOM, aucune carte) | `./types.js` |
| 4 | `tiles.ts` | 9 fonctions | — | — | Énumération/estimation/pré-téléchargement de tuiles XYZ (`planMap.js:140-299`) | `./types.js`, `./constants.js` |
| 5 | `state.ts` | `createPlanMapState`, `SafeMethods` | 1 | 28 | État initial complet (déclaré + ad hoc) + garde `_safe` | `./types.js` |
| 6 | `map-core.ts` | `MapCoreMethods` | 15 | — | Cycle de vie carte, vue persistée, 3D/relief, overlay noms de rues, pré-cache France | `./types.js`, `./constants.js`, `./tiles.js` |
| 7 | `chrome.ts` | `ChromeMethods` | 9 | — | Toolbar 6 FABs, plein écran, panneau de recherche + Nominatim, marqueur de recherche, dock dessin, hint | `./types.js`, `./constants.js`, `./geo.js` |
| 8 | `ping-modal.ts` | `PingModalMethods` | 8 | — | Modale « Ping » hybride : liste d'entités, picker d'icônes, armement placement libre | `./types.js`, `./constants.js`, `@pctac/storage.js` (`:985-987`), `@pctac/config.js` (`ADVERSARIES_KEY`, `HOSTAGES_KEY`, `FRIENDS_KEY`, `PIN_ICONS`, `suggestPinIcons` — `:985-987, 1044, 1074`) |
| 9 | `pins.ts` | `PinsMethods` | 15 | — | Pings : CRUD, persistance, réconciliation markers, cadenas, décorations. **Invariants 1 & 2** | `./types.js`, `./constants.js`, `./geo.js`, `@shared/persist.js` (`:1206, 1213`), `@pctac/storage.js` + `@pctac/config.js` (`:1220-1221`) |
| 10 | `draw-layers.ts` | `DrawLayersMethods` | 3 | — | Création sources/couches GeoJSON + bâtiments 3D, câblage dock de dessin, long-press création de ping | `./types.js` |
| 11 | `draw-tools.ts` | `DrawToolsMethods` | 16 | — | Outils de tracé (trait/rect/cercle/texte), undo/redo, preview, persistance formes | `./types.js`, `./constants.js`, `./geo.js` |
| 12 | `measure.ts` | `MeasureMethods` | 15 | — | Mesure distance/azimut (machine d'états), anneaux d'engagement, étiquettes persistées | `./types.js`, `./geo.js` |
| 13 | `shapes-render.ts` | `ShapesRenderMethods` | 12 | — | Rendu formes/textes/diamètres/cadenas + verrous global & par-forme | `./types.js`, `./geo.js` |
| 14 | `shapes-gestures.ts` | `ShapesGesturesMethods` | 15 | — | Gestes sur formes : tap/drag/pinch, sélection, poignées | `./types.js`, `./geo.js` |
| 15 | `wheels.ts` | `WheelsMethods` | 7 | — | Roues contextuelles (création ping, options ping, options forme), copie de coordonnées | `./types.js`, `@pctac/wheel.js`, `@pctac/config.js`, `@shared/coords.js` |
| 16 | `panels.ts` | `PanelsMethods` | 7 | — | Mini-panneaux flottants inline (texte, diamètre, catalogue d'icônes, couleur) | `./types.js`, `@pctac/config.js` (`suggestPinIcons` `:3921` ; `PIN_ICONS` `:4119, 4206, 4227`) |
| 17 | `text-modal.ts` | `TextModalMethods` | 7 | — | Modale `#planTextModal` + reparentage plein écran + texte libre | `./types.js` |
| 18 | `capture.ts` | `CaptureMethods` | 2 | — | **Chaîne `captureToDataUrl` — PORT QUASI VERBATIM** + téléchargement PNG | `./types.js` |
| 19 | `aoi.ts` | `AoiMethods` | 5 | 2 | Zone d'opération hors-ligne : cadrage, estimation, quota, téléchargement, barre de progression | `./types.js`, `./constants.js`, `./tiles.js`, `./geo.js` |
| 20 | `legacy.ts` | `LegacyMethods` | 10 | — | **Code mort interne** conservé verbatim (cluster « transform » + 2 orphelins) — §7 | `./types.js` |
| 21 | `index.ts` | `PlanMap` (+ `default`) | — | — | Réassemblage + pose de `window.PlanMap` | tous précédents |

**Contrôle** : 1+12+15+9+8+15+3+16+15+12+15+7+7+7+2+5+10 = **159 méthodes**.28 (state) + 2 (aoi) = **30 propriétés**. Total **189**. ✔
---

## 3. `types.ts` — modèle de données (paquet `pm-types`, VAGUE 1)

C'est **pivot** : tous autres sous-modules n'en dépendent que par
`import type`. Il ne contient **aucun runtime**.
### 3.1 Types de données persistées

```ts
import type { Map as MapLibreMap, Marker, LngLat, LngLatLike, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import type { PlanMapContract, PlanMapPinSummary } from '@shared/types/contracts.js';

/**
 * Surface de `Wheel` (@pctac/wheel.js) RÉELLEMENT utilisée par planMap.
 * Déclarée structurellement ICI, et NON importée, pour que `types.ts` reste
 * une feuille sans dépendance de paquet (`new Wheel(...)` y est assignable
 * par typage structurel). Sites : planMap.js:3523-3534, 3618-3625, 3716-3723,
 * 4308-4315, 5093, 2828, 3525.
 */
export interface PlanWheel {
    lngLat: LngLatObj | null;
    element: HTMLElement | null;
    open(): void;
    destroy(): void;
}

/** Couple [longitude, latitude] tel que persisté. Tuple → non affecté par `noUncheckedIndexedAccess`. */
export type LngLatTuple = [number, number];

/** Point {lng,lat} — forme utilisée par MapLibre et par les roues/panneaux. */
export interface LngLatObj { lng: number; lat: number }

/** Entité liée d'un ping (planMap.js:1218-1224). */
export type PlanEntityKind = 'adv' | 'host' | 'friend';
export interface PlanEntityRef { kind: PlanEntityKind; id: string }

/** Un ping persisté sous `pcTacPlanPins` (planMap.js:1167-1184, 3634-3642). */
export interface PlanPin {
    id: string;
    lng: number;
    lat: number;
    entityRef?: PlanEntityRef | undefined;
    /** Libellé d'un ping libre ; absent pour un ping lié-entité. */
    label?: string | undefined;
    color?: string | undefined;
    /** Catégorie OTAN libre ('Adv'|'Otage'|'Inter'|'Oscar'|'Inconnu'|'Vehicule'|…) — string ouvert : données historiques. */
    kind?: string | undefined;
    /** Nom d'icône Material Symbols (id de `PIN_ICONS`). */
    icon?: string | undefined;
    /** Texte personnalisé, prioritaire sur `label` à l'affichage. */
    text?: string | undefined;
    locked?: boolean | undefined;
    diameterM?: number | undefined;
    showDiameter?: boolean | undefined;
}

export type PlanShapeType = 'line' | 'rectangle' | 'circle' | 'text' | 'measure' | 'measure-rings';

/** Un anneau d'engagement (planMap.js:2572-2575). */
export interface PlanRing { radiusM: number; coords: LngLatTuple[] }

/**
 * Une forme persistée sous `pcTacPlanShapes`.
 * ⚠ `coords` est OPTIONNEL : les shapes `measure-rings` n'en ont pas
 * (planMap.js:2576-2582). Ne JAMAIS écrire `coords: []` sur une forme
 * `measure-rings` — cela modifierait le JSON persisté (protocole §4.5).
 */
export interface PlanShape {
    id: string;
    type: PlanShapeType;
    color?: string | undefined;
    coords?: LngLatTuple[] | undefined;
    center?: LngLatTuple | undefined;
    edge?: LngLatTuple | undefined;
    text?: string | undefined;
    textColor?: string | undefined;
    fontSize?: number | undefined;
    strokeWidth?: number | undefined;
    locked?: boolean | undefined;
    showDiameter?: boolean | undefined;
    /** `measure` uniquement. */ totalM?: number | undefined;
    /** `measure-rings` uniquement. */ rings?: PlanRing[] | undefined;
}

/** Vue caméra persistée sous `pcTacPlanView` (planMap.js:459-469). */
export interface PlanView {
    center: LngLatTuple;
    zoom: number;
    pitch?: number | undefined;
    bearing?: number | undefined;
    is3D?: boolean | undefined;
}

/** Entrée réconciliée d'un ping (planMap.js:1513). */
export interface PinEntry {
    pin: PlanPin;
    pinWrap: HTMLDivElement;
    labelEl: HTMLDivElement;
    pinMarker: Marker | null;
    labelMarker: Marker | null;
    sig: string | null;
    _anchor: 'center' | 'bottom' | null;
    /** Posé par `_bindPinListeners` (planMap.js:1402). */
    _updateLiveCircle?: ((ll: LngLat) => void) | undefined;
}

/** Résultat de `_resolvePin` (planMap.js:1216-1226). */
export interface ResolvedPin { label: string; color: string; kind: string }

/** Entrée du cache de cadenas de forme (planMap.js:3105). */
export interface ShapeLockEntry { marker: Marker; el: HTMLElement; locked: boolean }

/** Poignée de manipulation (planMap.js:3203-3231). */
export type HandleRole = 'move' | 'corner' | 'edge' | 'endpoint' | 'textresize';
export interface ShapeHandle { role: HandleRole; index: number; lngLat: LngLatObj; cursor: string }

/** Emprise géographique d'une AOI / de la France. */
export interface GeoBBox { west: number; south: number; east: number; north: number }

/** Template XYZ actif extrait de `RASTER_STYLE` (planMap.js:140-155). */
export interface TileTemplate {
    id: string; url: string; minzoom: number; maxzoom: number;
    /** `[west, south, east, north]` ou `null`. */
    bounds: number[] | null;
}

export interface PrefetchResult { total: number; ok: number; fail: number; aborted: boolean }
export type PrefetchProgress = (done: number, total: number, ok: number, fail: number) => void;
export interface PrefetchOptions { signal?: { aborted: boolean } | undefined }

/** Entrée de l'index `pcTacAoiIndex` (planMap.js:5489-5494). */
export interface AoiIndexEntry {
    bbox: GeoBBox; minZ: number; maxZ: number;
    total: number; ok: number; fail: number; complete: boolean; ts: number;
}

/** Handle de la barre de progression AOI (planMap.js:5551-5563). */
export interface AoiProgressUi {
    cancelBtn: HTMLButtonElement;
    setLabel(txt: string): void;
    update(done: number, total: number, ok: number, fail: number): void;
    remove(): void;
}

/** Couleur OTAN (planMap.js:3576-3582). */
export interface OtanColor { kind: string; color: string; icon: string; defaultLabel?: string | undefined }

/** État d'un geste de forme (planMap.js:2882) / de pinch / de poignée. */
export interface ShapeGestureState {
    type?: 'pinch' | 'handle' | undefined;
    shapeId?: string | undefined;
    startLngLat?: LngLatObj | undefined;
    isDrag?: boolean | undefined;
    original?: PlanShape | null | undefined;
    role?: HandleRole | undefined;
    index?: number | undefined;
    startPx?: { x: number; y: number } | undefined;
}

/** État de mesure en cours (planMap.js:2299-2304). */
export interface MeasureState { vertices: LngLatTuple[]; cursor: LngLatTuple | null; reticle: boolean }

/** Options de `_openInlinePanel` (planMap.js:3759). */
export interface InlinePanelOptions {
    onMount?: ((el: HTMLElement) => void) | undefined;
    anchorOffsetY?: number | undefined;
    centerScreen?: boolean | undefined;
    onBack?: (() => void) | null | undefined;
}

/** Panneau inline monté : élément DOM + son nettoyeur (planMap.js:3854). */
export type InlinePanelElement = HTMLDivElement & { __cleanup?: () => void };

/** Options de `_startTransform` — cluster mort, cf. §7 (planMap.js:4350). */
export interface TransformOptions {
    mode: 'move' | 'resize';
    shapeId: string;
    applyMove: (cur: LngLatTuple, original: PlanShape, target: PlanShape) => void;
    cursor?: string | undefined;
    hintText: string;
}
export interface MoveState { shapeId: string; mode: 'move' | 'resize'; original: PlanShape; applyMove: TransformOptions['applyMove'] }

/** Handlers du cadrage AOI (planMap.js:5332-5379). */
export interface AoiFramingHandlers {
    down: (e: MapMouseEvent | MapTouchEvent) => void;
    move: (e: MapMouseEvent | MapTouchEvent) => void;
    up: (e: MapMouseEvent | MapTouchEvent) => void;
    key: (e: KeyboardEvent) => void;
    hintClick: () => void;
    _start?: LngLatTuple | undefined;
}

/** Mémo de reparentage de modale en plein écran (planMap.js:4587-4591). */
export interface ModalReparent {
    modal: HTMLElement; backdrop: HTMLElement | null;
    modalParent: ParentNode | null; modalNext: ChildNode | null;
    bdParent: ParentNode | null; bdNext: ChildNode | null;
}

/** Feature GeoJSON d'un cercle de ping (planMap.js:1591-1595). */
export interface PinCircleFeature {
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: LngLatTuple[][] };
    properties: { color: string; _pinId: string };
}
```

> **Ré-export** : `types.ts` ré-exporte `PlanMapPinSummary` depuis
> `@shared/types/contracts.js` (`export type { PlanMapPinSummary };`) pour que
> `pins.ts` n'ait qu' seul point d'import.

### 3.2 `PlanMapState` — 28 propriétés déclarées + 28 ad hoc

```ts
export interface PlanMapState {
    /* --- 28 propriétés du littéral (planMap.js:302-328) --- */
    map: MapLibreMap | null;
    _pinMarkers: Map<string, PinEntry> | null;
    pendingFreePin: { label: string; color: string; kind: string; icon: string } | null;
    searchMarker: Marker | null;
    initialized: boolean;
    drawTool: 'line' | 'rectangle' | 'circle' | 'text' | 'measure' | null;
    drawColor: string;
    drawState: { start: LngLatTuple; current: LngLatTuple; points?: LngLatTuple[] } | null;
    drawPreviewLayerIds: string[];
    history: string[];
    redoStack: string[];
    is3D: boolean;
    _pinCancel: (() => void) | null;
    streetLabelsOn: boolean;
    _selectedShapeId: string | null;
    _handleMarkers: Marker[];
    _textMarkers: Marker[];
    _diameterMarkers: Marker[];
    _toolbarMarker: Marker | null;
    _contextPopup: unknown | null;          // legacy, jamais assigné (§7)
    _gesture: ShapeGestureState | null;
    _diameterGlobal: boolean;
    _drawingDiameterMarker: Marker | null;
    _locked: boolean;
    _measureState: MeasureState | null;
    _measureLabelMarkers: Marker[];
    _committedMeasureMarkers: Marker[];

    /* --- 28 propriétés créées à l'exécution (hors littéral) --- */
    _searchSeq: number;                     // :834
    pendingEntityPin: PlanEntityRef | null; // :1022, 1150, 1165
    _iconPickerBound: boolean;              // :1115
    _pinCircleFeatures: PinCircleFeature[] | null;   // :1386-1400, 1598
    _pinDiameterLabels: Record<string, Marker> | null; // :1427, 1600, 1623
    _pinDecoMarkers: Marker[] | null;       // :1571-1572, 1622
    _pinDiameterSrc: boolean;               // :1573, 1627, 1652
    _lastPinTap: { id: string; t: number } | null;   // :1433-1438
    drawPrecisionMode: boolean;             // :1941, 2019
    moveState: MoveState | null;            // :2848, 4360 (toujours null — §7)
    _measureControls: HTMLDivElement | null;         // :2480, 2491
    _measurePointBtn: HTMLButtonElement | null;      // :2470, 2492
    _measureUndoBtn: HTMLButtonElement | null;       // :2474, 2493
    _textMarkersById: Record<string, Marker> | null; // :2772, 4775, 4851
    _activeWheel: PlanWheel | null;         // :3523-3534, 3618, 4308
    _wheelJustClosed: number;               // :1811, 3535, 3750
    _lastShapeTap: { id: string; t: number } | null; // :2965-2970
    _dblZoomTimer: ReturnType<typeof setTimeout> | null; // :2994-2996
    _pinchListener: ((e: MapTouchEvent) => void) | null;  // :3045-3064
    _shapeLockMarkers: Map<string, ShapeLockEntry> | null; // :3090-3118
    _inlinePanel: InlinePanelElement | null;          // :3746-3853
    _moveHandlers: { onMove: (e: MapMouseEvent | MapTouchEvent) => void; onKey: (e: KeyboardEvent) => void } | null; // :4382-4472
    _modalReparent: ModalReparent | null;   // :4587-4604
    _textModalBound: boolean;               // :4671-4672
    _captureBusy: boolean;                  // :5073-5074, 5239
    _aoiFraming: boolean;                   // :5313-5385
    _aoiFramingHandlers: AoiFramingHandlers | null;  // :5379-5400
    _aoiDownloadBusy: boolean;              // :5457-5504

    /* --- 2 constantes publiques (planMap.js:5303-5304) --- */
    AOI_MIN_Z: number;
    AOI_MAX_Z: number;
}
```

> **Règle d'initialisation opposable.** `createPlanMapState()` initialise chaque
> propriété ad hoc à valeur qui **reproduit exactement première lecture de
> l'original** (`undefined` → falsy) : `null` pour tout objet/marker/handler,
> `false` pour tout booléen, `0` pour `_searchSeq` et `_wheelJustClosed`.
> Vérifié par :
> - `_wheelJustClosed = 0` → `Date.now() - 0 < 250` est `false`, comme `NaN < 250` ;
> - `_searchSeq = 0` → `(0 || 0) + 1 === 1`, identique ;
> - `_pinDiameterLabels = null` → tous sites d'accès sont gardés
> (`this._pinDiameterLabels && …`, `:1427`, `:1467`) ;
> - `_textMarkersById = null` → site gardé (`:2772`).
> 28 propriétés littéral gardent **littéralement** valeurs de
> `planMap.js:302-328` (dont `_pinMarkers: null`, initialisé paresseusement en
> `Map` par `_renderPins`, `:1496`).

### 3.3 `PlanMapInternal`

```ts
export interface PlanMapInternal extends PlanMapState, PlanMapContract {
    /* les 159 méthodes, dont les 4 du contrat public
       (init, refresh, getPinsSummary, captureToDataUrl) déjà héritées de PlanMapContract */
    _safe<A extends unknown[], R>(fn: (...args: A) => R, label?: string): (...args: A) => R | undefined;
    /* … signatures exactes reprises des tables §4.x … */
}
```

* `PlanMapContract` apporte `map`, `initialized`, `init()`, `refresh()`,
 `getPinsSummary()`, `captureToDataUrl()`. `PlanMapState` redéclare `map` et
 `initialized` **avec mêmes types** (compatible).* 155 autres méthodes sont déclarées ici, **avec signatures exactes  tables §4.1 → §4.17**. C'est ce fichier qui rend réassemblage vérifiable.

---

## 4. Table exhaustive : membre d'origine → sous-module de destination

Légende : « L. » = ligne dans `modules/pctac/planMap.js`.
Signature = signature TypeScript attendue **dans `PlanMapInternal`** (paramètre `this` n'y figure pas ; il figure dans l'implémentation).

### 4.0 Helpers et constantes de MODULE (hors objet `PlanMap`)

| L. | Membre | Destination | Export / signature |
|---:|---|---|---|
| 23 | `escHtml` | `constants.ts` | `export const escHtml: (v: unknown) => string` — **délégué à `esc` de `@shared/ui-platform`** (§6.4) || 29 | `PINS_KEY` | `constants.ts` | `export const PINS_KEY = 'pcTacPlanPins'` |
| 30 | `VIEW_KEY` | `constants.ts` | `export const VIEW_KEY = 'pcTacPlanView'` |
| 31 | `SHAPES_KEY` | `constants.ts` | `export const SHAPES_KEY = 'pcTacPlanShapes'` |
| 35 | `ENTITY_COLORS` | `constants.ts` | `export const ENTITY_COLORS: Record<PlanEntityKind, string>` |
| 43 | `RASTER_STYLE` | `constants.ts` | `export const RASTER_STYLE: StyleSpecification` (type `maplibre-gl`) |
| 123 | `OFFLINE_MAP_CACHE` | `constants.ts` | `export const OFFLINE_MAP_CACHE = 'pctac-map-v2'` |
| 124 | `SAT_TILE_TEMPLATE` | `constants.ts` | `export const SAT_TILE_TEMPLATE: string` |
| 126 | `FRANCE_BBOX` | `constants.ts` | `export const FRANCE_BBOX: GeoBBox` |
| 128 | `AOI_INDEX_KEY` | `constants.ts` | `export const AOI_INDEX_KEY = 'pcTacAoiIndex'` |
| 130 | `AOI_MAX_TILES` | `constants.ts` | `export const AOI_MAX_TILES = 60000` |
| 140 | `_styleTileTemplates` | `tiles.ts` | `export function styleTileTemplates(): TileTemplate[]` |
| 157 | `_lon2tile` | `tiles.ts` | `export function lon2tile(lon: number, z: number): number` |
| 160 | `_lat2tile` | `tiles.ts` | `export function lat2tile(lat: number, z: number): number` |
| 165 | `_fillTileTemplate` | `tiles.ts` | `export function fillTileTemplate(tpl: string, z: number, x: number, y: number): string` |
| 168 | `_tileUrl` | `tiles.ts` | `export function tileUrl(z: number, x: number, y: number): string` — **mort** (0 appelant), conservé |
| 181 | `_enumerateTiles` | `tiles.ts` | `export function enumerateTiles(bbox: GeoBBox, minZ: number, maxZ: number, templates: readonly TileTemplate[]): { url: string }[]` |
| 211 | `_estimateTileCount` | `tiles.ts` | `export function estimateTileCount(bbox: GeoBBox, minZ: number, maxZ: number, templates: readonly TileTemplate[]): number` |
| 246 | `_prefetchTiles` | `tiles.ts` | `export async function prefetchTiles(bbox: GeoBBox, minZ: number, maxZ: number, templates: readonly TileTemplate[], onProgress?: PrefetchProgress \| null, opts?: PrefetchOptions): Promise<PrefetchResult>` |
| 296 | `_prefetchFranceTiles` | `tiles.ts` | `export async function prefetchFranceTiles(minZ: number, maxZ: number, onProgress?: PrefetchProgress \| null): Promise<PrefetchResult>` |

### 4.1 `state.ts` — 28 propriétés + `_safe`

| L. | Membre | Signature |
|---:|---|---|
| 302-328 | 28 propriétés déclarées | cf. §3.2 (valeurs littérales inchangées) |
| 335 | `_safe` | `_safe<A extends unknown[], R>(fn: (...args: A) => R, label?: string): (...args: A) => R \| undefined` |

Export additionnel : `export function createPlanMapState(): PlanMapState` (inclut
aussi 28 ad hoc et `AOI_MIN_Z: 13` / `AOI_MAX_Z: 18`).

### 4.2 `geo.ts` — 12 méthodes (toutes pures)

| L. | Méthode | Fonction pure exportée | Signature (dans `PlanMapInternal`) |
|---:|---|---|---|
| 813 | `_parseGps` | `parseGps` | `_parseGps(str: string): { lat: number; lng: number } \| null` |
| 2282 | `_trueBearing` | `trueBearing` | `_trueBearing(a: LngLatTuple, b: LngLatTuple): number` |
| 2292 | `_formatBearing` | `formatBearing` | `_formatBearing(deg: number): string` |
| 2343 | `_measureTotalMeters` | `measureTotalMeters` | `_measureTotalMeters(vertices: readonly LngLatTuple[]): number` |
| 2713 | `_haversineMeters` | `haversineMeters` | `_haversineMeters(a: LngLatTuple, b: LngLatTuple): number` |
| 2723 | `_formatDistance` | `formatDistance` | `_formatDistance(m: number): string` |
| 2731 | `_circleDiameter` | `circleDiameter` | `_circleDiameter(s: PlanShape): number` |
| 3067 | `_shapeCentroid` | `shapeCentroid` | `_shapeCentroid(s: PlanShape): LngLatTuple` |
| 4723 | `_shapeAnchor` | `shapeAnchor` | `_shapeAnchor(s: PlanShape): LngLatObj \| null` |
| 4964 | `_rectPolygon` | `rectPolygon` | `_rectPolygon(a: LngLatTuple, b: LngLatTuple): LngLatTuple[]` |
| 4976 | `_circlePolygon` | `circlePolygon` | `_circlePolygon(center: LngLatTuple, edge: LngLatTuple): LngLatTuple[]` |
| 5013 | `_geoEdgeNorth` | `geoEdgeNorth` | `_geoEdgeNorth(center: LngLatTuple, radiusM: number): LngLatTuple` |

Deux helpers supplémentaires **imposés** (voir §6.3) :

```ts
/** `s.coords ?? []` — les shapes `measure-rings` n'ont pas de `coords`. */
export function shapeCoords(s: PlanShape): LngLatTuple[];
/** `shapeCoords(s)[i] ?? [0, 0]` — neutralise `noUncheckedIndexedAccess`. */
export function coordAt(s: PlanShape, i: number): LngLatTuple;
```

`GeoMethods` = 12 méthodes ci-dessus, chacune one-liner déléguant à 
fonction pure homonyme (sans paramètre `this`).

### 4.3 `map-core.ts` — 15 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 342 | `init` | `init(): void` *(contrat public)* || 424 | `_initOfflineCache` | `_initOfflineCache(): void` |
| 441 | `refresh` | `refresh(): void` *(contrat public)* || 451 | `_loadView` | `_loadView(): PlanView` |
| 459 | `_saveView` | `_saveView(): void` |
| 472 | `_toggle3D` | `_toggle3D(): void` |
| 479 | `_enable3D` | `_enable3D(animate?: boolean): void` |
| 551 | `_pinCamera` | `_pinCamera(target: { center: LngLat; zoom: number; bearing: number; pitch: number }): void` |
| 597 | `_disable3D` | `_disable3D(): void` |
| 628 | `_streetLabelPaint` | `_streetLabelPaint(): Record<string, unknown>` |
| 631 | `_ensureStreetLabelLayers` | `_ensureStreetLabelLayers(): boolean` |
| 668 | `_applyStreetLabelsVisibility` | `_applyStreetLabelsVisibility(): void` |
| 675 | `_toggleStreetLabels` | `_toggleStreetLabels(): void` |
| 683 | `_initStreetLabels` | `_initStreetLabels(): void` |
| 688 | `_updateStreetLabelsBtn` | `_updateStreetLabelsBtn(): void` |

### 4.4 `chrome.ts` — 9 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 695 | `_bindUi` | `_bindUi(): void` |
| 769 | `_toggleFullscreen` | `_toggleFullscreen(): void` |
| 782 | `_updateFullscreenIcon` | `_updateFullscreenIcon(): void` |
| 798 | `_toggleSearchPanel` | `_toggleSearchPanel(force?: boolean): void` |
| 824 | `_searchAddress` | `_searchAddress(): Promise<void>` |
| 894 | `_placeSearchMarker` | `_placeSearchMarker(lng: number, lat: number, label?: string \| null): void` |
| 946 | `_toggleDrawDock` | `_toggleDrawDock(force?: boolean): void` |
| 5566 | `_showHint` | `_showHint(msg: string): void` |
| 5590 | `_hideHint` | `_hideHint(): void` |

### 4.5 `ping-modal.ts` — 8 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 957 | `_openPingModal` | `_openPingModal(): void` |
| 972 | `_closePingModal` | `_closePingModal(): void` |
| 978 | `_renderPingEntities` | `_renderPingEntities(): void` |
| 1030 | `_setSelectedIcon` | `_setSelectedIcon(iconId: string, iconLabel: string): void` |
| 1040 | `_refreshIconSuggestions` | `_refreshIconSuggestions(labelText: string): void` |
| 1070 | `_renderIconCatalog` | `_renderIconCatalog(filterText: string): void` |
| 1114 | `_bindIconPickerOnce` | `_bindIconPickerOnce(): void` |
| 1142 | `_armFreePinPlacement` | `_armFreePinPlacement(): void` |

### 4.6 `pins.ts` — 15 méthodes ⚠ **invariants 1 et 2**

| L. | Méthode | Signature |
|---:|---|---|
| 1156 | `_onMapClick` | `_onMapClick(e: MapMouseEvent): void` |
| 1190 | `_addPin` | `_addPin(pin: PlanPin): void` |
| 1197 | `_removePin` | `_removePin(id: string): void` |
| 1203 | `_loadPins` | `_loadPins(): PlanPin[]` |
| 1209 | `_savePins` | `_savePins(pins: readonly PlanPin[]): void` |
| 1216 | `_resolvePin` | `_resolvePin(pin: PlanPin): ResolvedPin` |
| 1231 | `_pinSignature` | `_pinSignature(pin: PlanPin): string` |
| 1253 | `_applyLockBadgeStyle` | `_applyLockBadgeStyle(badge: HTMLElement, locked: boolean, variant: 'corner' \| 'marker'): void` |
| 1275 | `_makeLockBadge` | `_makeLockBadge(locked: boolean, onToggle: () => void, variant: 'corner' \| 'marker'): HTMLSpanElement` |
| 1291 | `_buildPinVisual` | `_buildPinVisual(entry: PinEntry): [number, number]` |
| 1376 | `_bindPinListeners` | `_bindPinListeners(entry: PinEntry): void` |
| 1494 | `_renderPins` | `_renderPins(): void` |
| 1570 | `_renderPinDecorations` | `_renderPinDecorations(): void` |
| 3727 | `_togglePinLock` | `_togglePinLock(pinId: string, reopenWheel?: boolean): void` |
| 5025 | `getPinsSummary` | `getPinsSummary(): PlanMapPinSummary[]` *(contrat public C2)* |
### 4.7 `draw-layers.ts` — 3 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 1665 | `_initDrawingLayers` | `_initDrawingLayers(): void` |
| 1829 | `_bindDrawUi` | `_bindDrawUi(): void` |
| 4863 | `_wireLongPressForPing` | `_wireLongPressForPing(): void` |

### 4.8 `draw-tools.ts` — 16 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 1963 | `_pushHistory` | `_pushHistory(): void` |
| 1970 | `_undo` | `_undo(): void` |
| 1980 | `_redo` | `_redo(): void` |
| 1990 | `_refreshUndoRedoButtons` | `_refreshUndoRedoButtons(): void` |
| 2003 | `_setTool` | `_setTool(tool: PlanMapState['drawTool']): void` |
| 2082 | `_setDrawColor` | `_setDrawColor(color: string): void` |
| 2092 | `_handleDrawDown` | `_handleDrawDown(e: MapMouseEvent \| MapTouchEvent): void` |
| 2116 | `_handleDrawMove` | `_handleDrawMove(e: { lngLat: LngLatObj; originalEvent?: Event }): void` |
| 2163 | `_renderLiveDiameter` | `_renderLiveDiameter(center: LngLatTuple, edge: LngLatTuple): void` |
| 2191 | `_clearLiveDiameter` | `_clearLiveDiameter(): void` |
| 2199 | `_handleDrawUp` | `_handleDrawUp(e: { lngLat?: LngLatObj; originalEvent?: Event }): void` |
| 2250 | `_finishShape` | `_finishShape(shape: PlanShape): void` |
| 2593 | `_renderPreview` | `_renderPreview(feature: GeoJSON.Feature): void` |
| 2598 | `_clearPreview` | `_clearPreview(): void` |
| 4953 | `_loadShapes` | `_loadShapes(): PlanShape[]` |
| 4957 | `_saveShapes` | `_saveShapes(list: readonly PlanShape[]): void` |

> ⚠ `_handleDrawMove` / `_handleDrawUp` sont appelés **aussi bien avec 
> événement MapLibre qu'avec objet synthétique** `{ lngLat: center }`
> (`planMap.js:1908, 1916, 1943`) : type élargi ci-dessus est **obligatoire**.

### 4.9 `measure.ts` — 15 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 2297 | `_startMeasure` | `_startMeasure(isMobile: boolean): void` |
| 2316 | `_measureAddVertex` | `_measureAddVertex(lngLat: LngLatTuple): void` |
| 2329 | `_measureUpdateCursor` | `_measureUpdateCursor(lngLat: LngLatTuple): void` |
| 2337 | `_measureReticlePoint` | `_measureReticlePoint(): LngLatTuple` |
| 2356 | `_renderMeasurePreview` | `_renderMeasurePreview(): void` |
| 2382 | `_renderMeasureLabels` | `_renderMeasureLabels(pts: readonly LngLatTuple[], committed: boolean): void` |
| 2437 | `_buildMeasureControls` | `_buildMeasureControls(): void` |
| 2484 | `_updateMeasureControls` | `_updateMeasureControls(): void` |
| 2490 | `_removeMeasureControls` | `_removeMeasureControls(): void` |
| 2497 | `_measureUndoVertex` | `_measureUndoVertex(): void` |
| 2506 | `_finishMeasure` | `_finishMeasure(): void` |
| 2539 | `_cancelMeasure` | `_cancelMeasure(): void` |
| 2545 | `_clearMeasureState` | `_clearMeasureState(): void` |
| 2567 | `_addEngagementRings` | `_addEngagementRings(center?: LngLatTuple): void` |
| 2672 | `_renderCommittedMeasures` | `_renderCommittedMeasures(): void` |

### 4.10 `shapes-render.ts` — 12 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 2604 | `_renderShapes` | `_renderShapes(): void` |
| 2738 | `_renderDiameters` | `_renderDiameters(): void` |
| 2791 | `_toggleLock` | `_toggleLock(): void` |
| 2806 | `_updateLockButton` | `_updateLockButton(): void` |
| 2819 | `_toggleGlobalDiameter` | `_toggleGlobalDiameter(): void` |
| 3088 | `_renderShapeLocks` | `_renderShapeLocks(): void` |
| 3489 | `_adjustFontSize` | `_adjustFontSize(shapeId: string, delta: number): void` |
| 3503 | `_adjustStrokeWidth` | `_adjustStrokeWidth(shapeId: string, delta: number): void` |
| 3516 | `_toggleShapeDiameter` | `_toggleShapeDiameter(shapeId: string): void` |
| 4319 | `_toggleShapeLock` | `_toggleShapeLock(shapeId: string, reopenWheel?: boolean): void` |
| 4746 | `_shapePixelBounds` | `_shapePixelBounds(s: PlanShape): { width: number; height: number }` |
| 4769 | `_renderShapeTexts` | `_renderShapeTexts(): void` |

### 4.11 `shapes-gestures.ts` — 15 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 2846 | `_shapePointerDown` | `_shapePointerDown(e: MapLayerMouseEvent \| MapLayerTouchEvent): void` |
| 2871 | `_startShapeGesture` | `_startShapeGesture(shapeId: string, startLngLat: LngLatObj, originalEvent: Event \| null): void` |
| 2991 | `_suppressDblZoom` | `_suppressDblZoom(): void` |
| 3007 | `_openShapeContextMenu` | `_openShapeContextMenu(shapeId: string, lngLat: LngLatObj \| null): void` |
| 3017 | `_selectShape` | `_selectShape(shapeId: string): void` |
| 3029 | `_deselectShape` | `_deselectShape(): void` |
| 3044 | `_attachPinchListeners` | `_attachPinchListeners(): void` |
| 3061 | `_detachPinchListeners` | `_detachPinchListeners(): void` |
| 3122 | `_startPinchGesture` | `_startPinchGesture(): void` |
| 3182 | `_clearHandles` | `_clearHandles(): void` |
| 3187 | `_clearFloatingToolbar` | `_clearFloatingToolbar(): void` |
| 3203 | `_shapeHandles` | `_shapeHandles(s: PlanShape): ShapeHandle[]` |
| 3233 | `_renderHandles` | `_renderHandles(): void` |
| 3292 | `_startHandleGesture` | `_startHandleGesture(shapeId: string, role: HandleRole, index: number, startLngLat: LngLatObj, originalEvent: Event): void` |
| 3481 | `_updateFloatingToolbarPos` | `_updateFloatingToolbarPos(): void` |

### 4.12 `wheels.ts` — 7 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 3533 | `_closeWheel` | `_closeWheel(): void` |
| 3543 | `_copyCoords` | `_copyCoords(lng: number, lat: number): void` |
| 3575 | `_otanColors` | `_otanColors(): OtanColor[]` |
| 3591 | `_openCreatePingWheel` | `_openCreatePingWheel(lngLat: LngLatObj): void` |
| 3630 | `_quickPlacePing` | `_quickPlacePing(lngLat: LngLatObj, otan: Pick<OtanColor, 'kind' \| 'color'> & Partial<OtanColor>, iconId: string): void` |
| 3648 | `_openPingOptionsWheel` | `_openPingOptionsWheel(pinId: string): void` |
| 4243 | `_openShapeWheel` | `_openShapeWheel(shapeId: string, lngLat: LngLatObj \| null): void` |

### 4.13 `panels.ts` — 7 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 3745 | `_closeInlinePanel` | `_closeInlinePanel(): void` |
| 3759 | `_openInlinePanel` | `_openInlinePanel(lngLat: LngLatObj \| null, contentHtml: string, opts?: InlinePanelOptions): InlinePanelElement` |
| 3870 | `_editPinText` | `_editPinText(pinId: string): void` |
| 3977 | `_editPinDiameter` | `_editPinDiameter(pinId: string): void` |
| 4069 | `_openIconCatalogPanel` | `_openIconCatalogPanel(lngLat: LngLatObj): void` |
| 4149 | `_openPinColorPanel` | `_openPinColorPanel(pinId: string): void` |
| 4180 | `_openIconCatalogPanelForEdit` | `_openIconCatalogPanelForEdit(pinId: string): void` |

### 4.14 `text-modal.ts` — 7 méthodes

| L. | Méthode | Signature |
|---:|---|---|
| 4546 | `_openTextModal` | `_openTextModal(targetId: string): void` |
| 4583 | `_mountModalInFullscreen` | `_mountModalInFullscreen(modal: HTMLElement, backdrop: HTMLElement \| null): void` |
| 4597 | `_restoreModalFromFullscreen` | `_restoreModalFromFullscreen(): void` |
| 4607 | `_hideTextModal` | `_hideTextModal(): void` |
| 4629 | `_confirmTextModal` | `_confirmTextModal(): void` |
| 4670 | `_bindTextModalOnce` | `_bindTextModalOnce(): void` |
| 4705 | `_addFreeText` | `_addFreeText(lngLat: LngLatObj): void` |

### 4.15 `capture.ts` — 2 méthodes ⚠ **invariant 3, port QUASI VERBATIM**

| L. | Méthode | Signature |
|---:|---|---|
| 5054 | `captureToDataUrl` | `captureToDataUrl(): Promise<string \| null>` *(contrat public C2)* || 5258 | `_takeScreenshot` | `_takeScreenshot(): Promise<void>` |

### 4.16 `aoi.ts` — 5 méthodes + 2 constantes

| L. | Membre | Signature |
|---:|---|---|
| 5303 | `AOI_MIN_Z` | `AOI_MIN_Z: number` *(valeur `13` — initialisée par `createPlanMapState`, §4.1)* |
| 5304 | `AOI_MAX_Z` | `AOI_MAX_Z: number` *(valeur `18` — idem)* |
| 5307 | `_startAoiFraming` | `_startAoiFraming(): void` |
| 5383 | `_endAoiFraming` | `_endAoiFraming(): void` |
| 5414 | `_confirmAoi` | `_confirmAoi(bbox: GeoBBox): Promise<void>` |
| 5454 | `_runAoiDownload` | `_runAoiDownload(bbox: GeoBBox, minZ: number, maxZ: number, templates: readonly TileTemplate[], estTotal: number): Promise<void>` |
| 5508 | `_createAoiProgressBar` | `_createAoiProgressBar(estTotal: number): AoiProgressUi` |

> valeurs `AOI_MIN_Z`/`AOI_MAX_Z` sont posées par `createPlanMapState()`
> (§4.1) et non par `aoi.ts` : ce sont DONNÉES, pas méthodes, et 
> groupe `AoiMethods` ne contient que fonctions. `aoi.ts` lit via
> `this.AOI_MIN_Z` exactement comme l'original (`planMap.js:5417`).

### 4.17 `legacy.ts` — 10 méthodes (code mort interne, §7)

| L. | Méthode | Signature |
|---:|---|---|
| 3192 | `_onShapeClick` | `_onShapeClick(e: MapLayerMouseEvent): void` |
| 3398 | `_renderFloatingToolbar` | `_renderFloatingToolbar(): void` |
| 4350 | `_startTransform` | `_startTransform(opts: TransformOptions): void` |
| 4394 | `_startMoveShape` | `_startMoveShape(shapeId: string, anchorLngLat: LngLatTuple): void` |
| 4414 | `_startResizeShape` | `_startResizeShape(shapeId: string): void` |
| 4444 | `_endMoveShape` | `_endMoveShape(): void` |
| 4450 | `_cancelMoveShape` | `_cancelMoveShape(): void` |
| 4467 | `_teardownMove` | `_teardownMove(): void` |
| 4480 | `_showTransformToolbar` | `_showTransformToolbar(message: string): void` |
| 4532 | `_hideTransformToolbar` | `_hideTransformToolbar(): void` |

---

## 5. Invariants critiques par sous-module (opposables au gate P2.E)

### 5.1 `pins.ts` — invariant 1 : **jamais de `position` inline sur l'élément d' Marker**

`planMap.js:1303-1306`. Dans `_buildPinVisual`, ligne
`pinWrap.style.cssText = 'width: 38px; height: 38px; cursor: …; display: flex; …'`
**ne doit contenir NI `position:` NI `inset:`**. commentaire d'origine(4 lignes) est **reporté tel quel** dans TS. badge cadenas
(`position:absolute`, `:1266`) dépend de ce contrat.
→ *Test unitaire obligatoire* : construire `PinEntry` factice, appeler
`PinsMethods._buildPinVisual.call(state, entry)` et asserter
`entry.pinWrap.style.position === ''` pour deux branches (icône custom /
SVG par défaut).

### 5.2 `pins.ts` — invariant 2a : cadenas stoppe `pointerdown/mousedown/touchstart`

`planMap.js:1279-1282` (`_makeLockBadge`). 3 `stopPropagation` + 
`{ passive: true }` sur `touchstart` sont **obligatoires** : sans eux, drag
natif marker et sélection forme sous-jacente se déclenchent.
→ *Test* : dispatcher `pointerdown` sur badge et vérifier qu' listener
posé sur parent ne reçoit pas.

### 5.3 `pins.ts` — invariant 2b : verrou par-ping ≠ verrou global

`draggable: !this._locked && !pin.locked` à **création** (`:1522`) ET à 
mise à jour (`setDraggable`, `:1545`). `_pinSignature` (`:1231-1243`) inclut
**à fois** `pin.locked` et `this._locked` : ne jamais retirer l' deux
 calcul de signature, sinon bascule verrou global ne re-rend rien.
`_togglePinLock(pinId, reopenWheel = true)` : **défaut `true`** est requis( roue rouvre) alors que cadenas direct appelle avec `false` (`:1336`).

### 5.4 `shapes-render.ts` — invariant 2c : verrou par-forme

`_toggleShapeLock(shapeId, reopenWheel = true)` (`:4319`), même défaut.
`_renderHandles` sort si `this._locked` **ou** `s.locked` (`:3237`, `:3240`).
`_attachPinchListeners` sort aussi sur deux (`:3048`, `:3050`).
`_renderShapeLocks` réconcilie par id (Map) — **ne pas repasser à 
destruction/recréation systématique**.

### 5.5 `capture.ts` — invariant 3 : chaîne `captureToDataUrl` (`planMap.js:5054-5241`)

**Port QUASI VERBATIM. Aucune refactorisation, aucune extraction de sous-fonction,aucun changement d'ordre.** 10 points suivants sont vérifiés par au
gate :

1. Gardes d'entrée dans l'ordre exact : `!this.map` → `typeof html2canvas === 'undefined'` → `!mapContainer` → `!mapContainer.offsetWidth` → double `requestAnimationFrame` puis re-test `clientWidth` → `this._captureBusy`.
2. `this._captureBusy = true` **avant** toute mutation DOM, remis à `false` **uniquement dans `finally`**.
3. Liste `toHide` **exactement** 7 ids + `.plan-lock-badge` + `.plan-inline-panel` + `_activeWheel.element` + `_handleMarkers[].getElement()` + `_toolbarMarker` + `_drawingDiameterMarker` ; `memo` capture `el.style.display` **avant** masquage.4. Attente idle bornée à **2500 ms** (`setTimeout(fin, 2500)` + `map.once('idle', fin)` + garde `done`).
5. `triggerRepaint()` puis `await new Promise(r => rAF(() => rAF(r)))`.
6. Aplatissement markers : boucle sur `.maplibregl-marker, .mapboxgl-marker`, saut si `display === 'none'` ou `offsetWidth/Height === 0`, mémorisation 6 propriétés (`position,left,top,transform,width,height`), écriture `position:absolute; left/top` relatifs à `parentRect`, `transform:none`, `width/height` en px.
7. Snapshot `baseCanvas` canvas WebGL **AVANT** `html2canvas`.
8. **Épinglage px de 3 niveaux de conteneurs** (`for (let depth = 0; el && depth < 3; depth++, el = el.parentElement)`) via `data-h2c-pin` + restitution dans `onclone` (`width/height/maxWidth:none/maxHeight:none/minHeight:0`). ⚠ *Cause n°1 markers amputés.*
9. Options `html2canvas` **inchangées** : `useCORS:true, allowTaint:false, backgroundColor:null, logging:false, scale:dpr, width:cssW, height:cssH, scrollX:0, scrollY:0, ignoreElements: n => n.tagName === 'CANVAS'`. **Ne PAS ajouter `windowWidth`/`windowHeight`** (commentaire `:5198-5199`).
10. `finally` : restauration markers, `removeAttribute('data-h2c-pin')`, `el.style.display = memo[i] || ''`, `_captureBusy = false`.

Adaptations TS **autorisées et limitées à** :
* `import html2canvas from 'html2canvas'` ( `typeof html2canvas === 'undefined'` devient `typeof html2canvas !== 'function'`) ;
* typage tableaux `markersToRestore` / `pinnedEls` / `memo` ;
* `el` boucle d'épinglage typé `HTMLElement | null` ;
* `baseCanvas.getContext('2d')` → garde `if (!ctx) …` **ajoutée** (TS l'exige) : en cas de `null`, retourner `null` **depuis `try`** ( `finally` restaure) — documenter en commentaire.

### 5.6 `map-core.ts` — épinglage caméra 3D

`_pinCamera` : **7 délais** `[0, 120, 280, 500, 850, 1300, 1900]` + 
`setTimeout(…, 2400)` de désabonnement `idle`, et l'annulation sur
`dragstart/zoomstart/rotatestart` **avec `e.originalEvent` présent uniquement**
(`:575`). nouvel appel annule précédent via `this._pinCancel`.

### 5.7 `chrome.ts` — jeton de séquence Nominatim

`_searchAddress` : `const seq = (this._searchSeq = (this._searchSeq || 0) + 1);`
**avant** branche GPS (`:834`), et double test `if (seq !== this._searchSeq) return;`
(succès `:856`, échec `:883`).

### 5.8 `draw-tools.ts` — historique et undo/redo

`_undo`/`_redo` écrivent **directement** `localStorage.setItem(SHAPES_KEY, prev)`
(`:1975`, `:1985`) et **non** via `Persist` : c'est volontaire ( chaîne
sérialisée est déjà connue). **Porter tel quel**, sous `try/catch` vide.
`_pushHistory` borne l'historique à 50 et vide `redoStack`.

### 5.9 `measure.ts` — `_renderCommittedMeasures` mute `this.drawColor`

`:2681-2684` : couleur courante est sauvegardée, remplacée par `s.color`, puis
restaurée. Ce hack est **nécessaire** car `_renderMeasureLabels` lit
`this.drawColor`. Porter tel quel.
### 5.10 `aoi.ts` — seul téléchargement à fois

`_aoiDownloadBusy` (`:5457`) : garde + remise à `false` sur ** 4 chemins de
sortie** (erreur, abandon, succès complet, succès partiel).

---

## 6. Conventions de portage (spécifiques planMap)

### 6.1 `window.PlanMap` — posé au SCOPE MODULE de `index.ts`

**Décision.** `planmap/index.ts` termine par `window.PlanMap = PlanMap;`, comme
`planMap.js:5596`.

*Justification (opposable)* : dans l'original, `main.js:7-8` importe `planMap.js`
**puis** `tchapLive.js` ; `tchapLive.js` s'auto-câble à l'import (`:960-961`) et
peut atteindre `window.PlanMap` dès sa réhydratation. Poser façade dans
`main.ts` (comme pour `UIPlatform`/`PocheTuto`) inverserait l'ordre — corps
de modules importés s'exécutent AVANT corps de `main.ts`. pose au scopemodule est donc seule qui reproduit exactement l'ordre d'initialisation.
`src/apps/pctac/main.ts` **doit** importer `@pctac/planmap` avant
`@pctac/tchap-live` (cf. `SPEC-PCTAC-CONVERSION.md` §5).

Effet de bord en test : importer `@pctac/planmap` sous Vitest pose
`window.PlanMap` (jsdom). Sans conséquence — tests unitaires ciblent 
groupes de méthodes, pas façade.

### 6.2 MapLibre : import npm au lieu global

`import maplibregl from 'maplibre-gl';` dans chaque sous-module qui instancie
`maplibregl.Map`, `maplibregl.Marker`, `maplibregl.Popup`,
`maplibregl.NavigationControl`, `maplibregl.ScaleControl`, `maplibregl.LngLatBounds`.
 garde `if (typeof maplibregl === 'undefined')` de `init()` (`:349-354`)
devient `if (typeof maplibregl?.Map !== 'function')` — ** bloc DOM d'erreur est
conservé mot pour mot** (message utilisateur inchangé).

### 6.3 `noUncheckedIndexedAccess` — règle unique

 projet compile avec `noUncheckedIndexedAccess: true`. Sur accès indexés à`PlanShape['coords']` et aux tableaux de coordonnées :

* utiliser `coordAt(s, i)` et `shapeCoords(s)` de `geo.ts` (§4.2) ;
* **ne jamais** utiliser `!` (non-null assertion) — interdit par revue ;
* repli `[0, 0]` de `coordAt` n'est atteignable que sur donnée persistée
 malformée, cas où l'original levait `TypeError` capté par `_safe`
 (interaction morte, aucun état corrompu) : normalisation est **neutre en
 observable** et doit être commentée à chaque site.

Pour `LngLatTuple` (tuples), destructuration reste typée `number` : aucun
traitement particulier.

### 6.4 `escHtml`

`planMap.js:23-27` interroge `window.UIPlatform`. En ESM, `esc` est importable :
`constants.ts` fait `import { esc } from '@shared/ui-platform.js'; export const escHtml = esc;`.
 branche de repli est **morte par construction** (l'import ne peut pas manquer)
→ supprimée, comportement identique.

### 6.5 Événements MapLibre typés

`this.map.on('mousedown', handler)` : MapLibre 4.7 type ses événements. Quand 
même handler sert `mousedown`/`touchstart` (`_shapePointerDown`, `_handleDrawDown`),
typer paramètre en union (`MapMouseEvent | MapTouchEvent`, ou
`MapLayerMouseEvent | MapLayerTouchEvent` pour handlers liés à couche).
Si surcharge `map.on` refuse l'union, **ne pas caster l'objet map** :
enrober (`(e) => this._shapePointerDown(e)`) comme fait déjà `_safe`.

### 6.6 Ce qu'il ne faut PAS faire

* Ne pas convertir `document.getElementById(...)` en refs mémorisées : DOM
 est reconstruit par `UI.switchMainView`, lookups à chaque appel sont voulus.
* Ne pas remplacer `el.onclick = …` par `addEventListener` : l'original s'appuie
 sur l'écrasement idempotent (`_bindUi` peut être rejoué).
* Ne pas fusionner `try {} catch (_) {}` vides : ils bornent APIs
 MapLibre qui jettent selon l'état style.
* Ne pas « corriger » `_buildPinVisual` : commentaire `:1341-1350` explique que
 l'ancre d' marker MapLibre n'est pas modifiable après création — code
 compense volontairement par l'offset label seulement.

---

## 7. Code mort INTERNE à planMap.js (constat + décision)

Vérifié par `grep -c` sur `planMap.js` (nombre total d'occurrences, définition
comprise) :

| Membre | Occurrences | Statut |
|---|---:|---|
| `_onShapeClick` | 1 | jamais appelé — commentaire d'origine : *« legacy : conservé au cas où »* |
| `_renderFloatingToolbar` | 1 | jamais appelé — remplacé par `_openShapeWheel` |
| `_startMoveShape` | 1 | jamais appelé |
| `_startResizeShape` | 1 | jamais appelé |
| `_startTransform` | 3 | appelé **uniquement** par deux précédents |
| `_endMoveShape`, `_cancelMoveShape`, `_teardownMove`, `_showTransformToolbar`, `_hideTransformToolbar` | — | atteignables **uniquement** depuis `_startTransform` |
| `moveState` / `_moveHandlers` | 18 / 6 | **jamais assignés hors cluster** ⇒ toujours `null` ; 8 gardes `if (this.moveState) return;` sont donc toujours fausses |
| `_toolbarMarker` | 6 | assigné **uniquement** par `_renderFloatingToolbar` ⇒ toujours `null` ; `_clearFloatingToolbar` / `_updateFloatingToolbarPos` / `captureToDataUrl` restent no-op **vivants** |
| `_contextPopup` | 1 | déclaré, jamais lu ni écrit |
| `drawPreviewLayerIds` | 1 | déclaré, jamais lu |
| `_tileUrl` (module) | 1 | jamais appelé |

**Décision.** Ce code est **PORTÉ VERBATIM** dans `planmap/legacy.ts` (méthodes)
et conservé dans `state.ts`/`tiles.ts` (propriétés/helper), avec en-tête
`@deprecated — code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher`.

*Motifs* : (a) protocole §4.7 impose fidélité ; (b) conserver 189membres rend contrôle d'exhaustivité de `PlanMapInternal` trivialement vert au
gate P2.E ; (c) gardes `if (this.moveState)` restent écrites à l'identique,
donc corps méthodes vivantes ne sont pas modifiés.
*Non-décision* : suppression définitive est arbitrage **hors P2**, à porteren P2.F ou plus tard, avec preuve de non-régression.

Ce constat **complète** `docs/SPEC-CONTRATS.md` §4.3 (qui listait code mort
au niveau FICHIER : `dashboard.js`, `qrSync.js`, `collectionManagers.js`,
`modules/shared.js`).

---

## 8. Façade et surface `window` après câblage (P2.D)

Conformément à `SPEC-CONTRATS.md` §2.1 et §5 :

| Élément | Après P2.B (ce document) | Après P2.D |
|---|---|---|
| `window.PlanMap` | **posé** par `planmap/index.ts` (§6.1) | **conservé** tant que `tchap-live.ts` lit `window.PlanMap` ; retirable seulement si `tchap-live.ts` importe `PlanMap` (possible sans cycle : planMap n'importe pas tchapLive) |
| Type de `window.PlanMap` | `PlanMapContract` (déjà déclaré dans `global.d.ts`) — **inchangé** | inchangé |
| Surface publique réellement lue de l'extérieur | `map`, `initialized`, `init()`, `refresh()`, `getPinsSummary()`, `captureToDataUrl()` | idem |
| 183 autres membres | internes au module TS, typés dans `PlanMapInternal`, **absents** de `PlanMapContract` | idem |

`index.ts` exporte `PlanMap: PlanMapInternal` (typage riche pour 
consommateurs internes et tests) ; l'affectation `window.PlanMap = PlanMap`
est valide car `PlanMapInternal extends PlanMapContract`.

**Aucune modification de `src/shared/types/contracts.ts` n'est requise par ce
découpage.** types de planMap vivent dans `planmap/types.ts`.

---

## 9. Stratégie de test par sous-module

| Sous-module | Test attendu | Niveau |
|---|---|---|
| `geo.ts` | **TDD strict.** Valeurs de référence calculées sur l'original exécuté en Node (`node --input-type=module`) : `haversineMeters`, `trueBearing`, `circlePolygon` (65 points, 1er = dernier), `geoEdgeNorth` (rayon exact à 3 latitudes), `formatDistance` (5 paliers : <1 m, <1 km, <10 km, ≥10 km), `formatBearing` (padding 3), `rectPolygon` (5 points fermés), `parseGps` (séparateurs `,` `;` espace, virgule décimale FR, bornes ±90/±180) | pur |
| `tiles.ts` | **TDD strict.** `lon2tile`/`lat2tile` (valeurs OSM connues), `enumerateTiles` vs `estimateTileCount` (**même total**, propriété invariante), intersection avec `bounds` IGN (zone hors France ⇒ 0 tuile IGN), `fillTileTemplate` (ordre `{z}/{y}/{x}` ESRI), `prefetchTiles` avec `caches`/`fetch` mockés : concurrence 6, `MAX_RETRY` 3, backoff 400·2^n, abandon coopératif via `signal.aborted` | pur + mocks |
| `state.ts` | `createPlanMapState()` retourne **exactement** 58 clés attendues avec bonnes valeurs initiales ; `_safe` capture et journalise sans propager, et retourne valeur en cas de succès | pur |
| `constants.ts` | `RASTER_STYLE` : 5 sources, 2 couches, `glyphs` OpenFreeMap, `bounds` IGN `[-5.6,41.1,9.8,51.3]`, `minzoom:11` ; clés localStorage littérales | pur |
| `pins.ts` | invariants 5.1/5.2/5.3 (cf. ci-dessus) + `_pinSignature` (change si `locked` change, si `_locked` change, si position change) + `_resolvePin` (entité supprimée ⇒ `'[supprimé]'`) + `getPinsSummary` (jamais d'exception, `[]` si stockage cassé) | jsdom |
| `capture.ts` | `captureToDataUrl()` retourne `null` sur chacune 5 conditions CONTRAT C2 ; `finally` restaure `display` et `_captureBusy` **même si `html2canvas` jette** | jsdom + mocks |
| `map-core.ts` | `_loadView` (JSON corrompu ⇒ défaut Paris `[2.3522, 48.8566]` zoom 5) ; `_initOfflineCache` ne marque `pcTacFranceTilesCached` que si `fail === 0` | jsdom |
| `draw-tools.ts` | `_pushHistory` borne à 50 + vide `redoStack` ; `_undo`/`_redo` symétriques ; `_setTool` toggle (re-clic ⇒ `null`) | jsdom |
| `measure.ts` | `_measureTotalMeters`, `_measureAddVertex` (refus doublon exact), `_finishMeasure` (< 2 sommets ⇒ annulation, pas de shape persisté) | jsdom |
| `shapes-render.ts`, `shapes-gestures.ts`, `wheels.ts`, `panels.ts`, `text-modal.ts`, `chrome.ts`, `ping-modal.ts`, `draw-layers.ts`, `aoi.ts` | tests de **fumée ciblés** : méthode ne jette pas quand DOM attendu est absent (cas réel : vue Plan jamais ouverte) + 1 à 3 assertions métier par module (précisées dans instructions de paquet) | jsdom |
| `legacy.ts` | aucun test fonctionnel (code mort) — seul test : 10 méthodes existent et sont fonctions | jsdom |
| `index.ts` | façade expose ** 189 membres** ; `window.PlanMap` est posé ; `PlanMap.initialized === false` avant `init()` ; `PlanMap.captureToDataUrl()` résout `null` sans carte | jsdom |
