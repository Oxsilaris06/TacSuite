/**
 * types.ts — Modèle de données de `planMap.js` (P2.CONV, paquet `pm-core`).
 * ===========================================================================
 *
 * Pivot du découpage (cf. `docs/SPEC-PLANMAP-SPLIT.md` §3) : c'est une FEUILLE,
 * sans dépendance de paquet PC-Tac, dont les 20 autres sous-modules de
 * `planmap/` n'importent que par `import type`. AUCUN runtime ici.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import type { Map as MapLibreMap, Marker, LngLat, MapMouseEvent, MapTouchEvent, MapLayerMouseEvent, MapLayerTouchEvent } from 'maplibre-gl';
import type { PlanMapContract, PlanMapPinSummary } from '@shared/types/contracts.js';

export type { PlanMapPinSummary };

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

/**
 * `PlanMapState` — 28 propriétés déclarées dans le littéral (planMap.js:302-328)
 * + 28 propriétés créées à l'exécution (hors littéral, recensées en
 * SPEC-PLANMAP-SPLIT.md §3.2) + les 2 constantes publiques AOI_MIN_Z/AOI_MAX_Z
 * (planMap.js:5303-5304). Total 58.
 */
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

/**
 * `PlanMapInternal` — surface complète des 159 méthodes de `PlanMap`, typée
 * pour le réassemblage vérifiable par `index.ts` (SPEC-PLANMAP-SPLIT §1.4).
 * `init`, `refresh`, `getPinsSummary`, `captureToDataUrl` viennent déjà de
 * `PlanMapContract` (hérité) et ne sont pas redéclarées ici.
 */
export interface PlanMapInternal extends PlanMapState, PlanMapContract {
    /* --- state.ts --- */
    _safe<A extends unknown[], R>(fn: (...args: A) => R, label?: string): (...args: A) => R | undefined;

    /* --- geo.ts (12) --- */
    _parseGps(str: string): { lat: number; lng: number } | null;
    _trueBearing(a: LngLatTuple, b: LngLatTuple): number;
    _formatBearing(deg: number): string;
    _measureTotalMeters(vertices: readonly LngLatTuple[]): number;
    _haversineMeters(a: LngLatTuple, b: LngLatTuple): number;
    _formatDistance(m: number): string;
    _circleDiameter(s: PlanShape): number;
    _shapeCentroid(s: PlanShape): LngLatTuple;
    _shapeAnchor(s: PlanShape): LngLatObj | null;
    _rectPolygon(a: LngLatTuple, b: LngLatTuple): LngLatTuple[];
    _circlePolygon(center: LngLatTuple, edge: LngLatTuple): LngLatTuple[];
    _geoEdgeNorth(center: LngLatTuple, radiusM: number): LngLatTuple;

    /* --- map-core.ts (15, dont init/refresh déjà hérités) --- */
    _initOfflineCache(): void;
    _loadView(): PlanView;
    _saveView(): void;
    _toggle3D(): void;
    _enable3D(animate?: boolean): void;
    _pinCamera(target: { center: LngLat; zoom: number; bearing: number; pitch: number }): void;
    _disable3D(): void;
    _streetLabelPaint(): Record<string, unknown>;
    _ensureStreetLabelLayers(): boolean;
    _applyStreetLabelsVisibility(): void;
    _toggleStreetLabels(): void;
    _initStreetLabels(): void;
    _updateStreetLabelsBtn(): void;

    /* --- chrome.ts (9) --- */
    _bindUi(): void;
    _toggleFullscreen(): void;
    _updateFullscreenIcon(): void;
    _toggleSearchPanel(force?: boolean): void;
    _searchAddress(): Promise<void>;
    _placeSearchMarker(lng: number, lat: number, label?: string | null): void;
    _toggleDrawDock(force?: boolean): void;
    _showHint(msg: string): void;
    _hideHint(): void;

    /* --- ping-modal.ts (8) --- */
    _openPingModal(): void;
    _closePingModal(): void;
    _renderPingEntities(): void;
    _setSelectedIcon(iconId: string, iconLabel: string): void;
    _refreshIconSuggestions(labelText: string): void;
    _renderIconCatalog(filterText: string): void;
    _bindIconPickerOnce(): void;
    _armFreePinPlacement(): void;

    /* --- pins.ts (15, dont getPinsSummary déjà hérité) --- */
    _onMapClick(e: MapMouseEvent): void;
    _addPin(pin: PlanPin): void;
    _removePin(id: string): void;
    _loadPins(): PlanPin[];
    _savePins(pins: readonly PlanPin[]): void;
    _resolvePin(pin: PlanPin): ResolvedPin;
    _pinSignature(pin: PlanPin): string;
    _applyLockBadgeStyle(badge: HTMLElement, locked: boolean, variant: 'corner' | 'marker'): void;
    _makeLockBadge(locked: boolean, onToggle: () => void, variant: 'corner' | 'marker'): HTMLSpanElement;
    _buildPinVisual(entry: PinEntry): [number, number];
    _bindPinListeners(entry: PinEntry): void;
    _renderPins(): void;
    _renderPinDecorations(): void;
    _togglePinLock(pinId: string, reopenWheel?: boolean): void;

    /* --- draw-layers.ts (3) --- */
    _initDrawingLayers(): void;
    _bindDrawUi(): void;
    _wireLongPressForPing(): void;

    /* --- draw-tools.ts (16) --- */
    _pushHistory(): void;
    _undo(): void;
    _redo(): void;
    _refreshUndoRedoButtons(): void;
    _setTool(tool: PlanMapState['drawTool']): void;
    _setDrawColor(color: string): void;
    _handleDrawDown(e: MapMouseEvent | MapTouchEvent): void;
    _handleDrawMove(e: { lngLat: LngLatObj; originalEvent?: Event }): void;
    _renderLiveDiameter(center: LngLatTuple, edge: LngLatTuple): void;
    _clearLiveDiameter(): void;
    _handleDrawUp(e: { lngLat?: LngLatObj; originalEvent?: Event }): void;
    _finishShape(shape: PlanShape): void;
    _renderPreview(feature: GeoJSON.Feature): void;
    _clearPreview(): void;
    _loadShapes(): PlanShape[];
    _saveShapes(list: readonly PlanShape[]): void;

    /* --- measure.ts (15) --- */
    _startMeasure(isMobile: boolean): void;
    _measureAddVertex(lngLat: LngLatTuple): void;
    _measureUpdateCursor(lngLat: LngLatTuple): void;
    _measureReticlePoint(): LngLatTuple;
    _renderMeasurePreview(): void;
    _renderMeasureLabels(pts: readonly LngLatTuple[], committed: boolean): void;
    _buildMeasureControls(): void;
    _updateMeasureControls(): void;
    _removeMeasureControls(): void;
    _measureUndoVertex(): void;
    _finishMeasure(): void;
    _cancelMeasure(): void;
    _clearMeasureState(): void;
    _addEngagementRings(center?: LngLatTuple): void;
    _renderCommittedMeasures(): void;

    /* --- shapes-render.ts (12) --- */
    _renderShapes(): void;
    _renderDiameters(): void;
    _toggleLock(): void;
    _updateLockButton(): void;
    _toggleGlobalDiameter(): void;
    _renderShapeLocks(): void;
    _adjustFontSize(shapeId: string, delta: number): void;
    _adjustStrokeWidth(shapeId: string, delta: number): void;
    _toggleShapeDiameter(shapeId: string): void;
    _toggleShapeLock(shapeId: string, reopenWheel?: boolean): void;
    _shapePixelBounds(s: PlanShape): { width: number; height: number };
    _renderShapeTexts(): void;

    /* --- shapes-gestures.ts (15) --- */
    _shapePointerDown(e: MapLayerMouseEvent | MapLayerTouchEvent): void;
    _startShapeGesture(shapeId: string, startLngLat: LngLatObj, originalEvent: Event | null): void;
    _suppressDblZoom(): void;
    _openShapeContextMenu(shapeId: string, lngLat: LngLatObj | null): void;
    _selectShape(shapeId: string): void;
    _deselectShape(): void;
    _attachPinchListeners(): void;
    _detachPinchListeners(): void;
    _startPinchGesture(): void;
    _clearHandles(): void;
    _clearFloatingToolbar(): void;
    _shapeHandles(s: PlanShape): ShapeHandle[];
    _renderHandles(): void;
    _startHandleGesture(shapeId: string, role: HandleRole, index: number, startLngLat: LngLatObj, originalEvent: Event): void;
    _updateFloatingToolbarPos(): void;

    /* --- wheels.ts (7) --- */
    _closeWheel(): void;
    _copyCoords(lng: number, lat: number): void;
    _otanColors(): OtanColor[];
    _openCreatePingWheel(lngLat: LngLatObj): void;
    _quickPlacePing(lngLat: LngLatObj, otan: Pick<OtanColor, 'kind' | 'color'> & Partial<OtanColor>, iconId: string): void;
    _openPingOptionsWheel(pinId: string): void;
    _openShapeWheel(shapeId: string, lngLat: LngLatObj | null): void;

    /* --- panels.ts (7) --- */
    _closeInlinePanel(): void;
    _openInlinePanel(lngLat: LngLatObj | null, contentHtml: string, opts?: InlinePanelOptions): InlinePanelElement;
    _editPinText(pinId: string): void;
    _editPinDiameter(pinId: string): void;
    _openIconCatalogPanel(lngLat: LngLatObj): void;
    _openPinColorPanel(pinId: string): void;
    _openIconCatalogPanelForEdit(pinId: string): void;

    /* --- text-modal.ts (7) --- */
    _openTextModal(targetId: string): void;
    _mountModalInFullscreen(modal: HTMLElement, backdrop: HTMLElement | null): void;
    _restoreModalFromFullscreen(): void;
    _hideTextModal(): void;
    _confirmTextModal(): void;
    _bindTextModalOnce(): void;
    _addFreeText(lngLat: LngLatObj): void;

    /* --- capture.ts (2, dont captureToDataUrl déjà hérité) --- */
    _takeScreenshot(): Promise<void>;

    /* --- aoi.ts (5) --- */
    _startAoiFraming(): void;
    _endAoiFraming(): void;
    _confirmAoi(bbox: GeoBBox): Promise<void>;
    _runAoiDownload(bbox: GeoBBox, minZ: number, maxZ: number, templates: readonly TileTemplate[], estTotal: number): Promise<void>;
    _createAoiProgressBar(estTotal: number): AoiProgressUi;

    /* --- legacy.ts (10, code mort interne — cf. SPEC-PLANMAP-SPLIT §7) --- */
    _onShapeClick(e: MapLayerMouseEvent): void;
    _renderFloatingToolbar(): void;
    _startTransform(opts: TransformOptions): void;
    _startMoveShape(shapeId: string, anchorLngLat: LngLatTuple): void;
    _startResizeShape(shapeId: string): void;
    _endMoveShape(): void;
    _cancelMoveShape(): void;
    _teardownMove(): void;
    _showTransformToolbar(message: string): void;
    _hideTransformToolbar(): void;
}
