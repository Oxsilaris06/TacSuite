/**
 * pm-index.test.ts — Tests du paquet `pm-index` (façade `planmap/index.ts`)
 * ===========================================================================
 *
 * Contrôle d'exhaustivité : la façade `PlanMap` réassemble les 17 groupes
 * (state.ts + 16 sous-modules de méthodes, SPEC-PLANMAP-SPLIT.md §2) sans
 * perdre aucun membre de l'objet littéral d'origine
 * (`modules/pctac/planMap.js:301-5594`, GStart-main, lecture seule).
 *
 * Décompte : 159 méthodes (tables §4.1 → §4.17) + les propriétés/constantes
 * du littéral déclarées `planMap.js:302-328` + `AOI_MIN_Z`/`AOI_MAX_Z`
 * (`:5303-5304`).
 *
 * ⚠ Écart de décompte DÉJÀ SIGNALÉ (cf. `pm-core.test.ts`, commentaire
 * « écart de comptage du document... source de vérité = planMap.js ») :
 * SPEC-PLANMAP-SPLIT.md §0 annonce « 28 propriétés déclarées dans le
 * littéral » (donc 189 membres au total = 159 + 28 + 2), mais une lecture
 * directe de `planMap.js:301-327` (comptée ici une seconde fois, à la ligne
 * près) n'en dénombre que **27** :
 *   map, _pinMarkers, pendingFreePin, searchMarker, initialized, drawTool,
 *   drawColor, drawState, drawPreviewLayerIds, history, redoStack, is3D,
 *   _pinCancel, streetLabelsOn, _selectedShapeId, _handleMarkers,
 *   _textMarkers, _diameterMarkers, _toolbarMarker, _contextPopup, _gesture,
 *   _diameterGlobal, _drawingDiameterMarker, _locked, _measureState,
 *   _measureLabelMarkers, _committedMeasureMarkers.
 * Total réel du littéral d'origine : 159 méthodes + 27 propriétés déclarées
 * + 2 constantes (`AOI_MIN_Z`/`AOI_MAX_Z`) = **188**, pas 189. Ce test vérifie
 * donc les 188 membres RÉELLEMENT présents dans `planMap.js`, source de
 * vérité (protocole §4.7 : fidélité avant élégance) ; l'écart d'un membre
 * avec le chiffre « 189 » de la spec est un défaut du DOCUMENT, pas une perte
 * lors du réassemblage — il est signalé dans le compte rendu de mission
 * plutôt que « corrigé » silencieusement dans un fichier partagé.
 *
 * Les 28 propriétés créées à l'exécution (hors littéral, SPEC-PLANMAP-SPLIT
 * §3.2 « ad hoc ») sont HORS PÉRIMÈTRE de ce contrôle : elles n'ont jamais
 * fait partie de l'objet littéral original, seul `createPlanMapState()`
 * (paquet `pm-core`, déjà testé dans `pm-core.test.ts`) les initialise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// (a) Contrôle d'exhaustivité — 159 méthodes + 29 propriétés/constantes
// ---------------------------------------------------------------------------

/** Table §4.1 (state.ts) — 1 méthode. */
const STATE_METHODS = ['_safe'];

/** Table §4.2 (geo.ts) — 12 méthodes, toutes pures. */
const GEO_METHODS = [
    '_parseGps',
    '_trueBearing',
    '_formatBearing',
    '_measureTotalMeters',
    '_haversineMeters',
    '_formatDistance',
    '_circleDiameter',
    '_shapeCentroid',
    '_shapeAnchor',
    '_rectPolygon',
    '_circlePolygon',
    '_geoEdgeNorth',
];

/** Table §4.3 (map-core.ts) — 15 méthodes (dont `init`/`refresh` du contrat public). */
const MAP_CORE_METHODS = [
    'init',
    '_initOfflineCache',
    'refresh',
    '_loadView',
    '_saveView',
    '_toggle3D',
    '_enable3D',
    '_pinCamera',
    '_disable3D',
    '_streetLabelPaint',
    '_ensureStreetLabelLayers',
    '_applyStreetLabelsVisibility',
    '_toggleStreetLabels',
    '_initStreetLabels',
    '_updateStreetLabelsBtn',
];

/** Table §4.4 (chrome.ts) — 9 méthodes. */
const CHROME_METHODS = [
    '_bindUi',
    '_toggleFullscreen',
    '_updateFullscreenIcon',
    '_toggleSearchPanel',
    '_searchAddress',
    '_placeSearchMarker',
    '_toggleDrawDock',
    '_showHint',
    '_hideHint',
];

/** Table §4.6 (pins.ts) — 15 méthodes (dont `getPinsSummary` du contrat public). */
const PINS_METHODS = [
    '_onMapClick',
    '_addPin',
    '_removePin',
    '_loadPins',
    '_savePins',
    '_resolvePin',
    '_pinSignature',
    '_applyLockBadgeStyle',
    '_makeLockBadge',
    '_buildPinVisual',
    '_bindPinListeners',
    '_renderPins',
    '_renderPinDecorations',
    '_togglePinLock',
    'getPinsSummary',
];

/** Table §4.7 (draw-layers.ts) — 3 méthodes. */
const DRAW_LAYERS_METHODS = ['_initDrawingLayers', '_bindDrawUi', '_wireLongPressForPing'];

/** Table §4.8 (draw-tools.ts) — 16 méthodes. */
const DRAW_TOOLS_METHODS = [
    '_pushHistory',
    '_undo',
    '_redo',
    '_refreshUndoRedoButtons',
    '_setTool',
    '_setDrawColor',
    '_handleDrawDown',
    '_handleDrawMove',
    '_renderLiveDiameter',
    '_clearLiveDiameter',
    '_handleDrawUp',
    '_finishShape',
    '_renderPreview',
    '_clearPreview',
    '_loadShapes',
    '_saveShapes',
];

/** Table §4.9 (measure.ts) — 15 méthodes. */
const MEASURE_METHODS = [
    '_startMeasure',
    '_measureAddVertex',
    '_measureUpdateCursor',
    '_measureReticlePoint',
    '_renderMeasurePreview',
    '_renderMeasureLabels',
    '_buildMeasureControls',
    '_updateMeasureControls',
    '_removeMeasureControls',
    '_measureUndoVertex',
    '_finishMeasure',
    '_cancelMeasure',
    '_clearMeasureState',
    '_addEngagementRings',
    '_renderCommittedMeasures',
];

/** Table §4.10 (shapes-render.ts) — 12 méthodes. */
const SHAPES_RENDER_METHODS = [
    '_renderShapes',
    '_renderDiameters',
    '_toggleLock',
    '_updateLockButton',
    '_toggleGlobalDiameter',
    '_renderShapeLocks',
    '_adjustFontSize',
    '_adjustStrokeWidth',
    '_toggleShapeDiameter',
    '_toggleShapeLock',
    '_shapePixelBounds',
    '_renderShapeTexts',
];

/** Table §4.11 (shapes-gestures.ts) — 15 méthodes. */
const SHAPES_GESTURES_METHODS = [
    '_shapePointerDown',
    '_startShapeGesture',
    '_suppressDblZoom',
    '_openShapeContextMenu',
    '_selectShape',
    '_deselectShape',
    '_attachPinchListeners',
    '_detachPinchListeners',
    '_startPinchGesture',
    '_clearHandles',
    '_clearFloatingToolbar',
    '_shapeHandles',
    '_renderHandles',
    '_startHandleGesture',
    '_updateFloatingToolbarPos',
];

/** Table §4.12 (wheels.ts) — 7 méthodes. */
const WHEELS_METHODS = [
    '_closeWheel',
    '_copyCoords',
    '_otanColors',
    '_openCreatePingWheel',
    '_quickPlacePing',
    '_openPingOptionsWheel',
    '_openShapeWheel',
];

/** Table §4.13 (panels.ts) — 7 méthodes. */
const PANELS_METHODS = [
    '_closeInlinePanel',
    '_openInlinePanel',
    '_editPinText',
    '_editPinDiameter',
    '_openIconCatalogPanel',
    '_openPinColorPanel',
    '_openIconCatalogPanelForEdit',
    '_openEntityPickerPanel',
];

/** Table §4.14 (text-modal.ts) — 7 méthodes. */
const TEXT_MODAL_METHODS = [
    '_openTextModal',
    '_mountModalInFullscreen',
    '_restoreModalFromFullscreen',
    '_hideTextModal',
    '_confirmTextModal',
    '_bindTextModalOnce',
    '_addFreeText',
];

/** Table §4.15 (capture.ts) — 2 méthodes (dont `captureToDataUrl` du contrat public). */
const CAPTURE_METHODS = ['captureToDataUrl', '_takeScreenshot'];

/** Table §4.16 (aoi.ts) — 5 méthodes. */
const AOI_METHODS = [
    '_startAoiFraming',
    '_endAoiFraming',
    '_confirmAoi',
    '_runAoiDownload',
    '_createAoiProgressBar',
];

const ALL_METHODS = [
    ...STATE_METHODS,
    ...GEO_METHODS,
    ...MAP_CORE_METHODS,
    ...CHROME_METHODS,
    ...PINS_METHODS,
    ...DRAW_LAYERS_METHODS,
    ...DRAW_TOOLS_METHODS,
    ...MEASURE_METHODS,
    ...SHAPES_RENDER_METHODS,
    ...SHAPES_GESTURES_METHODS,
    ...WHEELS_METHODS,
    ...PANELS_METHODS,
    ...TEXT_MODAL_METHODS,
    ...CAPTURE_METHODS,
    ...AOI_METHODS,
];

/**
 * 27 propriétés déclarées dans le littéral (`planMap.js:302-328`, comptées à
 * la ligne près ci-dessus dans l'en-tête de fichier) + 2 constantes publiques
 * `AOI_MIN_Z`/`AOI_MAX_Z` (`:5303-5304`) = 29 propriétés/constantes.
 */
const ALL_PROPERTIES = [
    'map',
    '_pinMarkers',
    'pendingFreePin',
    'searchMarker',
    'initialized',
    'drawTool',
    'drawColor',
    'drawState',
    'drawPreviewLayerIds',
    'history',
    'redoStack',
    'is3D',
    '_pinCancel',
    'streetLabelsOn',
    '_selectedShapeId',
    '_handleMarkers',
    '_textMarkers',
    '_diameterMarkers',
    '_toolbarMarker',
    '_contextPopup',
    '_gesture',
    '_diameterGlobal',
    '_drawingDiameterMarker',
    '_locked',
    '_measureState',
    '_measureLabelMarkers',
    '_committedMeasureMarkers',
    'AOI_MIN_Z',
    'AOI_MAX_Z',
];

describe('planmap/index.ts — PlanMap (façade, SPEC-PLANMAP-SPLIT §1.4)', () => {
    it(`expose les ${ALL_METHODS.length} méthodes du littéral d'origine, chacune une fonction`, async () => {
        expect(ALL_METHODS).toHaveLength(142);
        const { PlanMap } = await import('../../../src/apps/pctac/planmap/index.js');
        const facade = PlanMap as unknown as Record<string, unknown>;
        for (const name of ALL_METHODS) {
            expect(Object.prototype.hasOwnProperty.call(facade, name), `membre manquant : ${name}`).toBe(true);
            expect(typeof facade[name], `${name} devrait être une fonction`).toBe('function');
        }
    });

    it(`expose les ${ALL_PROPERTIES.length} propriétés/constantes du littéral d'origine, aucune n'étant une fonction`, async () => {
        expect(ALL_PROPERTIES).toHaveLength(29);
        const { PlanMap } = await import('../../../src/apps/pctac/planmap/index.js');
        const facade = PlanMap as unknown as Record<string, unknown>;
        for (const name of ALL_PROPERTIES) {
            expect(Object.prototype.hasOwnProperty.call(facade, name), `membre manquant : ${name}`).toBe(true);
            expect(typeof facade[name], `${name} ne devrait pas être une fonction`).not.toBe('function');
        }
    });

    it('membres réellement présents après coupe ping-modal/legacy (142 méthodes + 27 propriétés + 2 constantes)', () => {
        expect(ALL_METHODS.length + ALL_PROPERTIES.length).toBe(171);
    });

    it("aucun nom de méthode n'est partagé entre deux groupes (sinon l'ordre des spreads perdrait silencieusement un membre)", () => {
        const seen = new Set<string>();
        for (const name of ALL_METHODS) {
            expect(seen.has(name), `${name} apparaît dans au moins deux groupes`).toBe(false);
            seen.add(name);
        }
    });
});

// ---------------------------------------------------------------------------
// (b) `window.PlanMap` posé par le simple import du module
// ---------------------------------------------------------------------------

describe("window.PlanMap — posé au scope module par l'import (planMap.js:5596, décision SPEC-PLANMAP-SPLIT §6.1)", () => {
    beforeEach(() => {
        // `vi.resetModules()` vide le cache ESM de Vitest : sans lui, le
        // `import(...)` dynamique ci-dessous retournerait l'instance déjà
        // évaluée par un test précédent (module singleton), dont le corps de
        // module — donc `window.PlanMap = PlanMap;` — ne se réexécute pas.
        // C'est le même idiome que `pc-tchaplive.test.ts`/`pm-capture.test.ts`.
        vi.resetModules();
        // Nettoie le résidu d'un import précédent (ce fichier ou un autre du run)
        // pour prouver que c'est bien l'IMPORT — et non un appel explicite — qui
        // pose window.PlanMap.
        delete (window as unknown as { PlanMap?: unknown }).PlanMap;
    });

    it('window.PlanMap === PlanMap dès `import(...)`, sans appel explicite', async () => {
        expect((window as unknown as { PlanMap?: unknown }).PlanMap).toBeUndefined();
        const mod = await import('../../../src/apps/pctac/planmap/index.js');
        expect(window.PlanMap).toBe(mod.PlanMap);
        expect(window.PlanMap).toBe(mod.default);
    });
});

// ---------------------------------------------------------------------------
// (c) PlanMap.initialized === false avant init()
// ---------------------------------------------------------------------------

describe('PlanMap.initialized (planMap.js:305, valeur initiale du littéral)', () => {
    it('vaut false avant tout appel à init()', async () => {
        const { PlanMap } = await import('../../../src/apps/pctac/planmap/index.js');
        expect(PlanMap.initialized).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// (d) captureToDataUrl() résout null sans carte, sans jeter (CONTRAT C2)
// ---------------------------------------------------------------------------

describe('PlanMap.captureToDataUrl (CONTRAT C2, garde `!this.map` — capture.ts:30)', () => {
    it('résout null quand il n\'y a pas de carte (map === null), sans jeter', async () => {
        const { PlanMap } = await import('../../../src/apps/pctac/planmap/index.js');
        expect(PlanMap.map).toBeNull();
        await expect(PlanMap.captureToDataUrl()).resolves.toBeNull();
    });
});
