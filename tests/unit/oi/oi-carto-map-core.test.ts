/**
 * oi-carto-map-core.test.ts — Comportement OBSERVÉ de `modules/oi_cartographie.js`
 * (GStart-main, 1681 LOC, lecture seule) pour le paquet `oi-carto-map-core` :
 * `carto/map-core.ts` (13 méthodes — cycle de vie carte, toolbar, recherche
 * adresse/GPS Nominatim, relief 3D + bâtiments). Références
 * `oi_cartographie.js:<ligne>` en commentaire, cf. SPEC-OI-CONVERSION.md §6.2, §6.3.
 *
 * `this` FACTICE (jamais `new maplibregl.Map`, WebGL absent sous jsdom — règle
 * commune §11) : `makeFakeMap()` fournit un faux `map` ne portant que la
 * surface réellement appelée par map-core.ts (`getCenter`, `getZoom`,
 * `getPitch`, `getBearing`, `on`, `off`, `addControl`, `flyTo`, `easeTo`,
 * `resize`, `setTerrain`, `setSky`, `getLayer`, `setLayoutProperty`), tous en
 * `vi.fn()`. `makeFakeThis()` combine cet état avec des stubs `vi.fn()` pour
 * la surface COMPLÈTE de `OICartoInternal` (~85 méthodes) — seules les
 * méthodes RÉELLEMENT sous test viennent de `MapCoreMethods`, appelées via
 * `MapCoreMethods.xxx.call(fake, ...)`, jamais via `fake.xxx()`.
 *
 * `maplibre-gl` est mocké (`vi.mock` + `vi.hoisted`) pour piloter
 * `typeof maplibregl?.Map !== 'function'` (garde de `open()`, oi_cartographie.js:297) —
 * seul moyen de tester cette branche : le vrai paquet npm expose toujours
 * `.Map`. Le mock n'expose QUE `.Map` (getter piloté par `mapLibreState.hasMap`) :
 * `_init()`'s construction réelle (`new maplibregl.Map(...)`,
 * `NavigationControl`, `ScaleControl`) N'EST JAMAIS EXERCÉE — seule la garde
 * amont (`#oi_carto_map` absent → retour immédiat) est testée, même politique
 * que `@pctac/planmap/map-core.ts` (pm-mapcore.test.ts : smoke tests
 * DOM-absent/déjà-initialisé UNIQUEMENT sur `init()`).
 *
 * jsdom 30 n'implémente PAS `HTMLDialogElement.showModal()`/`.close()`
 * (vérifié : `typeof d.showModal === 'undefined'`) — stubbés par test quand
 * nécessaire ; `.open` (IDL réfléchissant l'attribut) reste, lui, natif et
 * assignable directement. `document.fullscreenElement` est piloté via
 * `Object.defineProperty` (accesseur sans setter natif).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mapLibreState } = vi.hoisted(() => ({ mapLibreState: { hasMap: true } }));

// Mock minimal de 'maplibre-gl' : seul `.Map` est lu par map-core.ts en dehors
// de `_init()` (jamais exercé, cf. note de tête de fichier) — `.Map` piloté
// par `mapLibreState.hasMap` pour tester la garde `open()` (oi_cartographie.js:297).
vi.mock('maplibre-gl', () => ({
    default: {
        get Map() {
            return mapLibreState.hasMap ? class {} : undefined;
        },
    },
}));

import { MapCoreMethods } from '../../../src/apps/oi/carto/map-core.js';
import type { OICartoInternal } from '../../../src/apps/oi/carto/types.js';

// ---------------------------------------------------------------------------
// Fabriques de `map`/`this` factices
// ---------------------------------------------------------------------------

/** Sous-ensemble RÉELLEMENT appelé de `maplibregl.Map` par map-core.ts. */
function makeFakeMap(overrides: Record<string, unknown> = {}) {
    return {
        getCenter: vi.fn(() => ({ lng: 2.3522, lat: 48.8566 })),
        getZoom: vi.fn(() => 5),
        getPitch: vi.fn(() => 0),
        getBearing: vi.fn(() => 0),
        on: vi.fn(),
        off: vi.fn(),
        addControl: vi.fn(),
        flyTo: vi.fn(),
        easeTo: vi.fn(),
        resize: vi.fn(),
        setTerrain: vi.fn(),
        setSky: vi.fn(),
        getLayer: vi.fn(),
        setLayoutProperty: vi.fn(),
        ...overrides,
    };
}

/** `this` factice — cast `unknown` car `OICartoInternal` (~85 méthodes) ne
 * "chevauche" pas suffisamment un littéral partiel pour un `as` direct (même
 * procédé que `pm-mapcore.test.ts` / `pm-drawlayers.test.ts` côté PC-Tac).
 * Toutes les méthodes hors du groupe sous test sont des stubs `vi.fn()`
 * neutres : ce fichier teste `map-core.ts`, pas leur contenu. */
function makeFakeThis(overrides: Record<string, unknown> = {}): OICartoInternal {
    return {
        // --- État (OICartoContract + champs propres, oi_cartographie.js:270-282) ---
        map: null,
        initialized: false,
        is3D: false,
        markers: new Map(),
        labelsVisible: true,
        _activeWheel: null,
        _inlinePanel: null,
        pendingPin: null,
        drawTool: null,
        drawColor: '#ef4444',
        drawState: null,
        history: [],
        redoStack: [],
        _inlinePanelMove: null,

        // Enveloppe `_safe` neutre : n'attrape rien, retourne `fn` telle quelle.
        _safe: vi.fn((fn: (...a: never[]) => unknown) => fn),

        // --- Méthodes du GROUPE SOUS TEST (map-core.ts) : stubs par défaut,
        // écrasés par `overrides` avec l'implémentation RÉELLE quand un test
        // exerce l'intégration (ex. open() → _init(), _toggle3D() → _enable3D()). ---
        open: vi.fn(),
        close: vi.fn(),
        _init: vi.fn(),
        _bindUi: vi.fn(),
        _toggleSearchPanel: vi.fn(),
        _toggleFullscreen: vi.fn(),
        _updateFullscreenIcon: vi.fn(),
        _showHint: vi.fn(),
        _hideHint: vi.fn(),
        _parseGps: vi.fn(() => null),
        _searchAddress: vi.fn(async () => {}),
        _toggle3D: vi.fn(),
        _enable3D: vi.fn(),
        _disable3D: vi.fn(),

        // --- Persistance (carto/state.ts, autre paquet) ---
        _getCartoState: vi.fn(() => null),
        _loadView: vi.fn(() => ({ center: [2.3522, 48.8566], zoom: 5 })),
        _saveView: vi.fn(),
        _loadPins: vi.fn(() => []),
        _savePins: vi.fn(),
        _loadShapes: vi.fn(() => []),
        _saveShapes: vi.fn(),

        // --- PINS (carto/pins.ts, autre paquet) ---
        _openPingModal: vi.fn(),
        _closePingModal: vi.fn(),
        _renderPingLists: vi.fn(),
        _memberLabel: vi.fn(() => ''),
        _customOr: vi.fn((fallback: string) => fallback),
        _emptyMsg: vi.fn((txt: string) => txt),
        _pinButton: vi.fn(() => document.createElement('button')),
        _isMemberPlaced: vi.fn(() => false),
        _renderMemberList: vi.fn(),
        _memberButton: vi.fn(() => document.createElement('div')),
        _resetMember: vi.fn(),
        _goToMember: vi.fn(),
        _getPatracdvrVehicles: vi.fn(() => []),
        _getAdversaryVehicles: vi.fn(() => []),
        _armPinPlacement: vi.fn(),
        _onMapClick: vi.fn(),
        _addPin: vi.fn(),
        _removePin: vi.fn(),
        _clearAllPins: vi.fn(),
        _renderPins: vi.fn(),

        // --- Roue d'un pin + panneaux inline (carto/panels.ts, autre paquet) ---
        _closeWheel: vi.fn(),
        _closeInlinePanel: vi.fn(),
        _openPinWheel: vi.fn(),
        _openInlinePanel: vi.fn(() => document.createElement('div')),
        _openPinIconPanel: vi.fn(),
        _openPinColorPanel: vi.fn(),
        _openPinRenamePanel: vi.fn(),
        _toggleLabels: vi.fn(),

        // --- Capture (carto/capture.ts, autre paquet) ---
        _openCaptureModal: vi.fn(),
        _closeCaptureModal: vi.fn(),
        _getPhotoTargets: vi.fn(() => []),
        _captureCanvas: vi.fn(async () => null),
        _downloadCapture: vi.fn(async () => {}),
        _exportToField: vi.fn(async () => {}),

        // --- Dessins (carto/draw.ts, autre paquet) ---
        _initDrawingLayers: vi.fn(),
        _bindDrawUi: vi.fn(),
        _toggleDrawDock: vi.fn(),
        _setTool: vi.fn(),
        _setDrawColor: vi.fn(),
        _handleDrawDown: vi.fn(),
        _handleDrawMove: vi.fn(),
        _handleDrawUp: vi.fn(),
        _finishShape: vi.fn(),
        _renderPreview: vi.fn(),
        _clearPreview: vi.fn(),
        _renderShapes: vi.fn(),
        _onShapeClick: vi.fn(),
        _pushHistory: vi.fn(),
        _undo: vi.fn(),
        _redo: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
        _rectPolygon: vi.fn(() => []),
        _circlePolygon: vi.fn(() => []),

        ...overrides,
    } as unknown as OICartoInternal;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.body.className = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mapLibreState.hasMap = true;
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
});

// ---------------------------------------------------------------------------
// 1. open (oi_cartographie.js:294-311)
// ---------------------------------------------------------------------------

describe('open (oi_cartographie.js:294-311)', () => {
    it('#cartographyModal absent ⇒ ne jette pas, ne fait rien', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods.open.call(fake)).not.toThrow();
    });

    it('sans MapLibre (typeof maplibregl.Map !== "function") ⇒ alerte, n\'ouvre pas la modale, n\'initialise pas', () => {
        mapLibreState.hasMap = false;
        document.body.innerHTML = '<dialog id="cartographyModal"></dialog>';
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        const showModalSpy = vi.fn();
        modal.showModal = showModalSpy;
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const init = vi.fn();
        const fake = makeFakeThis({ initialized: false, _init: init });

        MapCoreMethods.open.call(fake);

        expect(alertSpy).toHaveBeenCalledWith('Librairie cartographique indisponible (réseau ?). Réessayez en ligne.');
        expect(showModalSpy).not.toHaveBeenCalled();
        expect(init).not.toHaveBeenCalled();
    });

    it('MapLibre présente, modale fermée, non initialisée ⇒ showModal() + classe modal-open + _init()', () => {
        document.body.innerHTML = '<dialog id="cartographyModal"></dialog>';
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        modal.showModal = vi.fn(() => { modal.open = true; });
        const init = vi.fn();
        const fake = makeFakeThis({ initialized: false, _init: init });

        MapCoreMethods.open.call(fake);

        expect(modal.showModal).toHaveBeenCalledTimes(1);
        expect(document.body.classList.contains('modal-open')).toBe(true);
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('modale déjà ouverte ⇒ ne rappelle pas showModal()', () => {
        document.body.innerHTML = '<dialog id="cartographyModal"></dialog>';
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        modal.open = true;
        modal.showModal = vi.fn();
        const fake = makeFakeThis({ initialized: true, map: makeFakeMap() });

        MapCoreMethods.open.call(fake);

        expect(modal.showModal).not.toHaveBeenCalled();
    });

    it('déjà initialisée ⇒ ne rappelle pas _init(), programme un resize de la carte à 60ms', () => {
        vi.useFakeTimers();
        document.body.innerHTML = '<dialog id="cartographyModal"></dialog>';
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        modal.open = true;
        modal.showModal = vi.fn();
        const map = makeFakeMap();
        const init = vi.fn();
        const fake = makeFakeThis({ initialized: true, map, _init: init });

        MapCoreMethods.open.call(fake);

        expect(init).not.toHaveBeenCalled();
        expect(map.resize).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60);
        expect(map.resize).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// 2. close (oi_cartographie.js:313-316)
// ---------------------------------------------------------------------------

describe('close (oi_cartographie.js:313-316)', () => {
    it('#cartographyModal absent ⇒ no-op', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods.close.call(fake)).not.toThrow();
    });

    it('modale ouverte ⇒ appelle close()', () => {
        document.body.innerHTML = '<dialog id="cartographyModal"></dialog>';
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        modal.open = true;
        const closeSpy = vi.fn(() => { modal.open = false; });
        modal.close = closeSpy;
        const fake = makeFakeThis();

        MapCoreMethods.close.call(fake);

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('modale déjà fermée ⇒ n\'appelle PAS close()', () => {
        document.body.innerHTML = '<dialog id="cartographyModal"></dialog>';
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        modal.open = false;
        const closeSpy = vi.fn();
        modal.close = closeSpy;
        const fake = makeFakeThis();

        MapCoreMethods.close.call(fake);

        expect(closeSpy).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 3. _init (oi_cartographie.js:318-360) — smoke UNIQUEMENT (jamais
//    `new maplibregl.Map`, cf. note de tête de fichier)
// ---------------------------------------------------------------------------

describe('_init (oi_cartographie.js:318-360) — smoke', () => {
    it('#oi_carto_map absent ⇒ retourne sans jeter, reste non initialisé', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._init.call(fake)).not.toThrow();
        expect(fake.initialized).toBe(false);
        expect(fake.map).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 4. _bindUi (oi_cartographie.js:419-500)
// ---------------------------------------------------------------------------

describe('_bindUi (oi_cartographie.js:419-500)', () => {
    function buildDom(): void {
        document.body.innerHTML = `
            <dialog id="cartographyModal"></dialog>
            <button id="oi_carto_btn_close"></button>
            <button id="oi_carto_btn_search"></button>
            <button id="oi_carto_btn_ping"></button>
            <button id="oi_carto_btn_draw"></button>
            <button id="oi_carto_btn_capture"></button>
            <button id="oi_carto_btn_labels"></button>
            <button id="oi_carto_btn_3d"></button>
            <button id="oi_carto_btn_fullscreen"></button>
            <input id="oi_carto_address_input" type="text" />
            <button id="oi_carto_search_btn"></button>
            <button id="oi_carto_search_close"></button>
            <button id="oi_carto_ping_cancel"></button>
            <button id="oi_carto_clear_pins"></button>
            <button id="oi_carto_capture_download"></button>
            <button id="oi_carto_capture_export"></button>
            <select id="oi_carto_capture_target"><option value="target1">T1</option></select>
            <button id="oi_carto_capture_cancel"></button>
            <div id="oi_carto_hint"></div>
        `;
    }

    it('câble tous les boutons de la toolbar sur les méthodes attendues', () => {
        buildDom();
        const close = vi.fn();
        const toggleSearchPanel = vi.fn();
        const openPingModal = vi.fn();
        const toggleDrawDock = vi.fn();
        const openCaptureModal = vi.fn();
        const toggleLabels = vi.fn();
        const toggle3D = vi.fn();
        const toggleFullscreen = vi.fn();
        const fake = makeFakeThis({
            close,
            _toggleSearchPanel: toggleSearchPanel,
            _openPingModal: openPingModal,
            _toggleDrawDock: toggleDrawDock,
            _openCaptureModal: openCaptureModal,
            _toggleLabels: toggleLabels,
            _toggle3D: toggle3D,
            _toggleFullscreen: toggleFullscreen,
        });

        MapCoreMethods._bindUi.call(fake);

        document.getElementById('oi_carto_btn_close')?.click();
        expect(close).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_btn_search')?.click();
        expect(toggleSearchPanel).toHaveBeenCalledWith();
        document.getElementById('oi_carto_btn_ping')?.click();
        expect(openPingModal).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_btn_draw')?.click();
        expect(toggleDrawDock).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_btn_capture')?.click();
        expect(openCaptureModal).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_btn_labels')?.click();
        expect(toggleLabels).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_btn_3d')?.click();
        expect(toggle3D).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_btn_fullscreen')?.click();
        expect(toggleFullscreen).toHaveBeenCalledTimes(1);
    });

    it('fullscreenchange / webkitfullscreenchange déclenchent _updateFullscreenIcon', () => {
        buildDom();
        const updateIcon = vi.fn();
        const fake = makeFakeThis({ _updateFullscreenIcon: updateIcon });
        MapCoreMethods._bindUi.call(fake);

        document.dispatchEvent(new Event('fullscreenchange'));
        expect(updateIcon).toHaveBeenCalledTimes(1);
        document.dispatchEvent(new Event('webkitfullscreenchange'));
        expect(updateIcon).toHaveBeenCalledTimes(2);
    });

    it('Entrée dans le champ adresse déclenche _searchAddress (pas les autres touches)', () => {
        buildDom();
        const searchAddress = vi.fn();
        const fake = makeFakeThis({ _searchAddress: searchAddress });
        MapCoreMethods._bindUi.call(fake);

        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        expect(searchAddress).not.toHaveBeenCalled();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(searchAddress).toHaveBeenCalledTimes(1);
    });

    it('recherche : bouton loupe et croix de fermeture câblés', () => {
        buildDom();
        const searchAddress = vi.fn();
        const toggleSearchPanel = vi.fn();
        const fake = makeFakeThis({ _searchAddress: searchAddress, _toggleSearchPanel: toggleSearchPanel });
        MapCoreMethods._bindUi.call(fake);

        document.getElementById('oi_carto_search_btn')?.click();
        expect(searchAddress).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_search_close')?.click();
        expect(toggleSearchPanel).toHaveBeenCalledWith(false);
    });

    it('modale ping : Annuler et "Supprimer tous les pins" câblés', () => {
        buildDom();
        const closePingModal = vi.fn();
        const clearAllPins = vi.fn();
        const fake = makeFakeThis({ _closePingModal: closePingModal, _clearAllPins: clearAllPins });
        MapCoreMethods._bindUi.call(fake);

        document.getElementById('oi_carto_ping_cancel')?.click();
        expect(closePingModal).toHaveBeenCalledTimes(1);
        document.getElementById('oi_carto_clear_pins')?.click();
        expect(clearAllPins).toHaveBeenCalledTimes(1);
    });

    it('modale capture : téléchargement, export (avec sélection) et fermeture câblés', () => {
        buildDom();
        const downloadCapture = vi.fn();
        const exportToField = vi.fn();
        const closeCaptureModal = vi.fn();
        const fake = makeFakeThis({
            _downloadCapture: downloadCapture,
            _exportToField: exportToField,
            _closeCaptureModal: closeCaptureModal,
        });
        MapCoreMethods._bindUi.call(fake);

        document.getElementById('oi_carto_capture_download')?.click();
        expect(downloadCapture).toHaveBeenCalledTimes(1);

        const sel = document.getElementById('oi_carto_capture_target') as HTMLSelectElement;
        sel.value = 'target1';
        document.getElementById('oi_carto_capture_export')?.click();
        expect(exportToField).toHaveBeenCalledWith('target1');

        document.getElementById('oi_carto_capture_cancel')?.click();
        expect(closeCaptureModal).toHaveBeenCalledTimes(1);
    });

    it('modale capture : export sans sélection ⇒ _exportToField NON appelé', () => {
        buildDom();
        const exportToField = vi.fn();
        const fake = makeFakeThis({ _exportToField: exportToField });
        MapCoreMethods._bindUi.call(fake);

        const sel = document.getElementById('oi_carto_capture_target') as HTMLSelectElement;
        sel.value = '';
        document.getElementById('oi_carto_capture_export')?.click();
        expect(exportToField).not.toHaveBeenCalled();
    });

    it('hint : clic annule le placement en attente et masque le hint', () => {
        buildDom();
        const hideHint = vi.fn();
        const fake = makeFakeThis({ pendingPin: { kind: 'member', label: 'x' }, _hideHint: hideHint });
        MapCoreMethods._bindUi.call(fake);

        document.getElementById('oi_carto_hint')?.click();

        expect(fake.pendingPin).toBeNull();
        expect(hideHint).toHaveBeenCalledTimes(1);
    });

    it('modale : événement close ⇒ retire modal-open, ferme la roue/le panneau, sauvegarde la vue', () => {
        buildDom();
        document.body.classList.add('modal-open');
        const closeWheel = vi.fn();
        const closeInlinePanel = vi.fn();
        const saveView = vi.fn();
        const fake = makeFakeThis({ _closeWheel: closeWheel, _closeInlinePanel: closeInlinePanel, _saveView: saveView });
        MapCoreMethods._bindUi.call(fake);

        document.getElementById('cartographyModal')?.dispatchEvent(new Event('close'));

        expect(document.body.classList.contains('modal-open')).toBe(false);
        expect(closeWheel).toHaveBeenCalledTimes(1);
        expect(closeInlinePanel).toHaveBeenCalledTimes(1);
        expect(saveView).toHaveBeenCalledTimes(1);
    });

    it('modale : Échap avec un outil de dessin actif ⇒ annule l\'outil au lieu de fermer', () => {
        buildDom();
        const setTool = vi.fn();
        const fake = makeFakeThis({ drawTool: 'line', _setTool: setTool });
        MapCoreMethods._bindUi.call(fake);

        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        const ev = new Event('cancel', { cancelable: true });
        modal.dispatchEvent(ev);

        expect(ev.defaultPrevented).toBe(true);
        expect(setTool).toHaveBeenCalledWith(null);
    });

    it('modale : Échap avec un pin en attente (pas d\'outil) ⇒ annule le placement au lieu de fermer', () => {
        buildDom();
        const hideHint = vi.fn();
        const fake = makeFakeThis({
            drawTool: null,
            pendingPin: { kind: 'member', label: 'x' },
            _hideHint: hideHint,
        });
        MapCoreMethods._bindUi.call(fake);

        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        const ev = new Event('cancel', { cancelable: true });
        modal.dispatchEvent(ev);

        expect(ev.defaultPrevented).toBe(true);
        expect(fake.pendingPin).toBeNull();
        expect(hideHint).toHaveBeenCalledTimes(1);
    });

    it('modale : Échap sans outil ni pin en attente ⇒ ne bloque pas la fermeture', () => {
        buildDom();
        const fake = makeFakeThis({ drawTool: null, pendingPin: null });
        MapCoreMethods._bindUi.call(fake);

        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        const ev = new Event('cancel', { cancelable: true });
        modal.dispatchEvent(ev);

        expect(ev.defaultPrevented).toBe(false);
    });

    it('raccourcis Ctrl+Z / Ctrl+Y actifs UNIQUEMENT modale ouverte : _undo / _redo', () => {
        buildDom();
        const undo = vi.fn();
        const redo = vi.fn();
        const fake = makeFakeThis({ _undo: undo, _redo: redo });
        MapCoreMethods._bindUi.call(fake);

        // Modale fermée : aucun raccourci actif.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
        expect(undo).not.toHaveBeenCalled();

        const modal = document.getElementById('cartographyModal') as HTMLDialogElement;
        modal.open = true;

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
        expect(undo).toHaveBeenCalledTimes(1);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
        expect(redo).toHaveBeenCalledTimes(1);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true }));
        expect(redo).toHaveBeenCalledTimes(2);

        // Ctrl+Shift+Z ne doit PAS déclencher _undo (garde `!e.shiftKey`).
        expect(undo).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// 5. _toggleSearchPanel (oi_cartographie.js:502-513)
// ---------------------------------------------------------------------------

describe('_toggleSearchPanel (oi_cartographie.js:502-513)', () => {
    it('panneau absent ⇒ no-op', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._toggleSearchPanel.call(fake)).not.toThrow();
    });

    it('force=undefined, fermé ⇒ ouvre le panneau et active le FAB', () => {
        document.body.innerHTML = `
            <div id="oi_carto_search_panel"></div>
            <button id="oi_carto_btn_search"></button>
            <input id="oi_carto_address_input" />
        `;
        const fake = makeFakeThis();

        MapCoreMethods._toggleSearchPanel.call(fake);

        expect(document.getElementById('oi_carto_search_panel')?.classList.contains('open')).toBe(true);
        expect(document.getElementById('oi_carto_btn_search')?.classList.contains('active')).toBe(true);
    });

    it('force=undefined, déjà ouvert ⇒ referme', () => {
        document.body.innerHTML = '<div id="oi_carto_search_panel" class="open"></div>';
        const fake = makeFakeThis();

        MapCoreMethods._toggleSearchPanel.call(fake);

        expect(document.getElementById('oi_carto_search_panel')?.classList.contains('open')).toBe(false);
    });

    it('force=true : ouvre et met le focus sur le champ adresse', () => {
        document.body.innerHTML = `
            <div id="oi_carto_search_panel"></div>
            <input id="oi_carto_address_input" />
        `;
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        const focusSpy = vi.spyOn(input, 'focus');
        const fake = makeFakeThis();

        MapCoreMethods._toggleSearchPanel.call(fake, true);

        expect(document.getElementById('oi_carto_search_panel')?.classList.contains('open')).toBe(true);
        expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('force=false : ferme sans toucher au focus', () => {
        document.body.innerHTML = '<div id="oi_carto_search_panel" class="open"></div>';
        const fake = makeFakeThis();

        MapCoreMethods._toggleSearchPanel.call(fake, false);

        expect(document.getElementById('oi_carto_search_panel')?.classList.contains('open')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 6. _toggleFullscreen (oi_cartographie.js:515-526)
// ---------------------------------------------------------------------------

describe('_toggleFullscreen (oi_cartographie.js:515-526)', () => {
    it('conteneur #oi_carto_map_wrap absent ⇒ no-op', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._toggleFullscreen.call(fake)).not.toThrow();
    });

    it('pas en plein écran ⇒ appelle requestFullscreen() sur le conteneur', () => {
        document.body.innerHTML = '<div id="oi_carto_map_wrap"></div>';
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        const container = document.getElementById('oi_carto_map_wrap') as HTMLDivElement;
        const reqSpy = vi.fn(() => Promise.resolve());
        container.requestFullscreen = reqSpy;
        const fake = makeFakeThis();

        MapCoreMethods._toggleFullscreen.call(fake);

        expect(reqSpy).toHaveBeenCalledTimes(1);
    });

    it('déjà en plein écran ⇒ appelle document.exitFullscreen()', () => {
        document.body.innerHTML = '<div id="oi_carto_map_wrap"></div>';
        const container = document.getElementById('oi_carto_map_wrap') as HTMLDivElement;
        Object.defineProperty(document, 'fullscreenElement', { value: container, configurable: true });
        const exitSpy = vi.fn(() => Promise.resolve());
        document.exitFullscreen = exitSpy;
        const fake = makeFakeThis();

        MapCoreMethods._toggleFullscreen.call(fake);

        expect(exitSpy).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// 7. _updateFullscreenIcon (oi_cartographie.js:528-538)
// ---------------------------------------------------------------------------

describe('_updateFullscreenIcon (oi_cartographie.js:528-538)', () => {
    it('bouton absent ⇒ ne jette pas', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._updateFullscreenIcon.call(fake)).not.toThrow();
    });

    it('actif : classe "active" + icône "fullscreen_exit"', () => {
        document.body.innerHTML = '<button id="oi_carto_btn_fullscreen"><span class="material-symbols-outlined">fullscreen</span></button>';
        const container = document.createElement('div');
        Object.defineProperty(document, 'fullscreenElement', { value: container, configurable: true });
        const fake = makeFakeThis();

        MapCoreMethods._updateFullscreenIcon.call(fake);

        const btn = document.getElementById('oi_carto_btn_fullscreen');
        expect(btn?.classList.contains('active')).toBe(true);
        expect(btn?.querySelector('.material-symbols-outlined')?.textContent).toBe('fullscreen_exit');
    });

    it('inactif : classe retirée + icône "fullscreen"', () => {
        document.body.innerHTML = '<button id="oi_carto_btn_fullscreen" class="active"><span class="material-symbols-outlined">fullscreen_exit</span></button>';
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        const fake = makeFakeThis();

        MapCoreMethods._updateFullscreenIcon.call(fake);

        const btn = document.getElementById('oi_carto_btn_fullscreen');
        expect(btn?.classList.contains('active')).toBe(false);
        expect(btn?.querySelector('.material-symbols-outlined')?.textContent).toBe('fullscreen');
    });

    it('map présente ⇒ programme un resize à 60ms', () => {
        vi.useFakeTimers();
        const map = makeFakeMap();
        const fake = makeFakeThis({ map });

        MapCoreMethods._updateFullscreenIcon.call(fake);
        expect(map.resize).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60);
        expect(map.resize).toHaveBeenCalledTimes(1);
    });

    it('map absente ⇒ ne programme rien, ne jette pas', () => {
        vi.useFakeTimers();
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._updateFullscreenIcon.call(fake)).not.toThrow();
        vi.advanceTimersByTime(1000);
    });
});

// ---------------------------------------------------------------------------
// 8-9. _showHint / _hideHint (oi_cartographie.js:540-550)
// ---------------------------------------------------------------------------

describe('_showHint / _hideHint (oi_cartographie.js:540-550)', () => {
    it('_showHint : élément absent ⇒ no-op', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._showHint.call(fake, 'Placez un point')).not.toThrow();
    });

    it('_showHint : texte + suffixe fixe + classe "show"', () => {
        document.body.innerHTML = '<div id="oi_carto_hint"></div>';
        const fake = makeFakeThis();

        MapCoreMethods._showHint.call(fake, 'Placez un point');

        const hint = document.getElementById('oi_carto_hint');
        expect(hint?.textContent).toBe('Placez un point (clic ici pour annuler)');
        expect(hint?.classList.contains('show')).toBe(true);
    });

    it('_hideHint : élément absent ⇒ no-op', () => {
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._hideHint.call(fake)).not.toThrow();
    });

    it('_hideHint : retire la classe "show"', () => {
        document.body.innerHTML = '<div id="oi_carto_hint" class="show"></div>';
        const fake = makeFakeThis();

        MapCoreMethods._hideHint.call(fake);

        expect(document.getElementById('oi_carto_hint')?.classList.contains('show')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 10. _parseGps (oi_cartographie.js:557-565)
// ---------------------------------------------------------------------------

describe('_parseGps (oi_cartographie.js:557-565)', () => {
    it.each<[string, { lat: number; lng: number }]>([
        ['48.8566, 2.3522', { lat: 48.8566, lng: 2.3522 }],
        ['48.8566;2.3522', { lat: 48.8566, lng: 2.3522 }],
        ['48.8566 2.3522', { lat: 48.8566, lng: 2.3522 }],
        ['48,8566, 2,3522', { lat: 48.8566, lng: 2.3522 }],
        ['  -33.87, 151.21  ', { lat: -33.87, lng: 151.21 }],
        ['90, 180', { lat: 90, lng: 180 }],
        ['-90, -180', { lat: -90, lng: -180 }],
    ])('accepte %s', (input, expected) => {
        const fake = makeFakeThis();
        expect(MapCoreMethods._parseGps.call(fake, input)).toEqual(expected);
    });

    it.each<[string]>([
        ['12 rue de la Paix, Paris'],
        ['91, 2.3522'],
        ['48.8566, 181'],
        ['abc, def'],
        [''],
        ['48.8566'],
    ])('rejette %s ⇒ null', (input) => {
        const fake = makeFakeThis();
        expect(MapCoreMethods._parseGps.call(fake, input)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 11. _searchAddress (oi_cartographie.js:567-612)
// ---------------------------------------------------------------------------

describe('_searchAddress (oi_cartographie.js:567-612)', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="oi_carto_address_input" />
            <div id="oi_carto_search_results"></div>
        `;
    });

    it('champ adresse absent ⇒ ne jette pas, ne fetch pas', async () => {
        document.body.innerHTML = '<div id="oi_carto_search_results"></div>';
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('zone de résultats absente ⇒ ne jette pas, ne fetch pas', async () => {
        document.body.innerHTML = '<input id="oi_carto_address_input" value="paris" />';
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('champ vide (espaces) ⇒ ne fetch pas', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = '   ';
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('entrée GPS reconnue par _parseGps ⇒ centre la carte directement, pas de fetch', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = '48.8566, 2.3522';
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const map = makeFakeMap();
        const parseGps = vi.fn(() => ({ lat: 48.8566, lng: 2.3522 }));
        const fake = makeFakeThis({ map, _parseGps: parseGps });

        await MapCoreMethods._searchAddress.call(fake);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(map.flyTo).toHaveBeenCalledWith({ center: [2.3522, 48.8566], zoom: 17, speed: 1.4 });
        expect(document.getElementById('oi_carto_search_results')?.innerHTML).toContain('48.85660, 2.35220');
    });

    it('géocodage Nominatim réussi : fetch avec URL/en-têtes attendus, rend les résultats, clic centre la carte', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = '12 rue de la Paix';
        const list = [
            { display_name: 'Résultat 1', lon: '2.33', lat: '48.87' },
            { display_name: 'Résultat 2', lon: '2.34', lat: '48.86' },
        ];
        const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(list) }));
        vi.stubGlobal('fetch', fetchSpy);
        const map = makeFakeMap();
        const fake = makeFakeThis({ map });

        await MapCoreMethods._searchAddress.call(fake);

        expect(fetchSpy).toHaveBeenCalledWith(
            'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=12%20rue%20de%20la%20Paix',
            { headers: { 'Accept-Language': 'fr' } },
        );
        const resultsBox = document.getElementById('oi_carto_search_results');
        expect(resultsBox?.querySelectorAll('.oi-carto-search-result')).toHaveLength(2);
        expect(resultsBox?.textContent).toContain('Résultat 1');

        const first = resultsBox?.querySelector<HTMLDivElement>('[data-idx="0"]');
        first?.click();
        expect(map.flyTo).toHaveBeenCalledWith({ center: [2.33, 48.87], zoom: 17, speed: 1.4 });
        expect(resultsBox?.innerHTML).toBe('');
    });

    it('aucun résultat ⇒ message "Aucun résultat."', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = 'lieu inexistant xyzzy';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })));
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(document.getElementById('oi_carto_search_results')?.textContent).toContain('Aucun résultat.');
    });

    it('HTTP 429 ⇒ message quota', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = 'adresse';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve([]) })));
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(document.getElementById('oi_carto_search_results')?.textContent).toContain('Quota de recherche atteint');
    });

    it('HTTP 403 ⇒ message quota', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = 'adresse';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve([]) })));
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(document.getElementById('oi_carto_search_results')?.textContent).toContain('Quota de recherche atteint');
    });

    it('autre erreur HTTP (500) ⇒ message générique réseau', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = 'adresse';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve([]) })));
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(document.getElementById('oi_carto_search_results')?.textContent).toContain('Erreur réseau');
    });

    it('fetch rejette (réseau coupé) ⇒ message générique réseau, ne jette pas', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = 'adresse';
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
        const fake = makeFakeThis();

        await expect(MapCoreMethods._searchAddress.call(fake)).resolves.toBeUndefined();
        expect(document.getElementById('oi_carto_search_results')?.textContent).toContain('Erreur réseau');
    });

    it('échappement : window.UIPlatform absent ⇒ le texte brut est utilisé', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = 'adresse';
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([{ display_name: 'Rue du Test', lon: '1', lat: '2' }]),
            })),
        );
        vi.stubGlobal('UIPlatform', undefined);
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(document.getElementById('oi_carto_search_results')?.innerHTML).toContain('Rue du Test');
    });

    it('échappement : window.UIPlatform présent ⇒ UIPlatform.esc est appelé', async () => {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement;
        input.value = 'adresse';
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([{ display_name: 'Rue X', lon: '1', lat: '2' }]),
            })),
        );
        const esc = vi.fn((s: string) => `[ESC]${s}`);
        vi.stubGlobal('UIPlatform', { esc } as unknown as typeof window.UIPlatform);
        const fake = makeFakeThis();

        await MapCoreMethods._searchAddress.call(fake);

        expect(esc).toHaveBeenCalledWith('Rue X');
        expect(document.getElementById('oi_carto_search_results')?.innerHTML).toContain('[ESC]Rue X');
    });
});

// ---------------------------------------------------------------------------
// 12. _toggle3D (oi_cartographie.js:1609-1612)
// ---------------------------------------------------------------------------

describe('_toggle3D (oi_cartographie.js:1609-1612)', () => {
    it('is3D=false ⇒ délègue à _enable3D(true)', () => {
        const enable3D = vi.fn();
        const disable3D = vi.fn();
        const fake = makeFakeThis({ is3D: false, _enable3D: enable3D, _disable3D: disable3D });

        MapCoreMethods._toggle3D.call(fake);

        expect(enable3D).toHaveBeenCalledWith(true);
        expect(disable3D).not.toHaveBeenCalled();
    });

    it('is3D=true ⇒ délègue à _disable3D()', () => {
        const enable3D = vi.fn();
        const disable3D = vi.fn();
        const fake = makeFakeThis({ is3D: true, _enable3D: enable3D, _disable3D: disable3D });

        MapCoreMethods._toggle3D.call(fake);

        expect(disable3D).toHaveBeenCalledTimes(1);
        expect(enable3D).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 13. _enable3D (oi_cartographie.js:1614-1650)
// ---------------------------------------------------------------------------

describe('_enable3D (oi_cartographie.js:1614-1650)', () => {
    it('map absente ⇒ no-op', () => {
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._enable3D.call(fake)).not.toThrow();
        expect(fake.is3D).toBe(false);
    });

    it('setTerrain jette ⇒ alerte, sort AVANT d\'activer is3D', () => {
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const map = makeFakeMap({ setTerrain: vi.fn(() => { throw new Error('DEM indisponible'); }) });
        const saveView = vi.fn();
        const fake = makeFakeThis({ map, is3D: false, _saveView: saveView });

        expect(() => MapCoreMethods._enable3D.call(fake)).not.toThrow();

        expect(alertSpy).toHaveBeenCalledWith('Relief 3D indisponible (réseau ?). Les tuiles d\'élévation AWS sont peut-être bloquées.');
        expect(fake.is3D).toBe(false);
        expect(saveView).not.toHaveBeenCalled();
    });

    it('nominal : pose le terrain, le ciel, active is3D, la classe active, sauvegarde la vue', () => {
        document.body.innerHTML = '<button id="oi_carto_btn_3d"></button>';
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined) });
        const saveView = vi.fn();
        const fake = makeFakeThis({ map, is3D: false, _saveView: saveView });

        MapCoreMethods._enable3D.call(fake, false);

        expect(map.setTerrain).toHaveBeenCalledWith({ source: 'terrain-dem', exaggeration: 1.4 });
        expect(map.setSky).toHaveBeenCalledWith({
            'sky-color': '#7ab8e6',
            'sky-horizon-blend': 0.6,
            'horizon-color': '#dfeefc',
            'horizon-fog-blend': 0.6,
            'fog-color': '#cfd8e0',
            'fog-ground-blend': 0.4,
        });
        expect(fake.is3D).toBe(true);
        expect(document.getElementById('oi_carto_btn_3d')?.classList.contains('active')).toBe(true);
        expect(saveView).toHaveBeenCalledTimes(1);
    });

    it('couche buildings-3d présente ⇒ visibility "visible"', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => ({})) });
        const fake = makeFakeThis({ map, is3D: false });

        MapCoreMethods._enable3D.call(fake, false);

        expect(map.setLayoutProperty).toHaveBeenCalledWith('buildings-3d', 'visibility', 'visible');
    });

    it('couche buildings-3d absente ⇒ ne tente pas setLayoutProperty', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map, is3D: false });

        MapCoreMethods._enable3D.call(fake, false);

        expect(map.setLayoutProperty).not.toHaveBeenCalled();
    });

    it('setSky absent (fonctionnalité optionnelle) ⇒ ne jette pas, saute l\'appel', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined) });
        // Retire complètement la propriété (au lieu de la mettre à `undefined`)
        // pour reproduire fidèlement `typeof this.map.setSky === 'function'` → false.
        delete (map as { setSky?: unknown }).setSky;
        const fake = makeFakeThis({ map, is3D: false });

        expect(() => MapCoreMethods._enable3D.call(fake, false)).not.toThrow();
        expect(fake.is3D).toBe(true);
    });

    it('animate=true, pitch actuel < 20° ⇒ easeTo incline à 60°', () => {
        const map = makeFakeMap({ getPitch: vi.fn(() => 0), getLayer: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map, is3D: false });

        MapCoreMethods._enable3D.call(fake, true);

        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 60, duration: 900 });
    });

    it('animate=true, pitch actuel >= 20° ⇒ garde le pitch courant', () => {
        const map = makeFakeMap({ getPitch: vi.fn(() => 45), getLayer: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map, is3D: false });

        MapCoreMethods._enable3D.call(fake, true);

        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 45, duration: 900 });
    });

    it('animate=false ⇒ aucun easeTo', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map, is3D: false });

        MapCoreMethods._enable3D.call(fake, false);

        expect(map.easeTo).not.toHaveBeenCalled();
    });

    it('animate par défaut (paramètre omis) ⇒ true', () => {
        const map = makeFakeMap({ getPitch: vi.fn(() => 0), getLayer: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map, is3D: false });

        MapCoreMethods._enable3D.call(fake);

        expect(map.easeTo).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// 14. _disable3D (oi_cartographie.js:1652-1666)
// ---------------------------------------------------------------------------

describe('_disable3D (oi_cartographie.js:1652-1666)', () => {
    it('map absente ⇒ no-op', () => {
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._disable3D.call(fake)).not.toThrow();
    });

    it('nominal : retire le terrain et le ciel, désactive is3D, aplatit la vue, sauvegarde', () => {
        document.body.innerHTML = '<button id="oi_carto_btn_3d" class="active"></button>';
        const map = makeFakeMap({ getLayer: vi.fn(() => ({})) });
        const saveView = vi.fn();
        const fake = makeFakeThis({ map, is3D: true, _saveView: saveView });

        MapCoreMethods._disable3D.call(fake);

        expect(map.setTerrain).toHaveBeenCalledWith(null);
        expect(map.setSky).toHaveBeenCalledWith(null);
        expect(map.setLayoutProperty).toHaveBeenCalledWith('buildings-3d', 'visibility', 'none');
        expect(fake.is3D).toBe(false);
        expect(document.getElementById('oi_carto_btn_3d')?.classList.contains('active')).toBe(false);
        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0, duration: 900 });
        expect(saveView).toHaveBeenCalledTimes(1);
    });

    it('couche buildings-3d absente ⇒ ne tente pas setLayoutProperty', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map, is3D: true });

        MapCoreMethods._disable3D.call(fake);

        expect(map.setLayoutProperty).not.toHaveBeenCalled();
    });

    it('setSky absent ⇒ ne jette pas', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined) });
        delete (map as { setSky?: unknown }).setSky;
        const fake = makeFakeThis({ map, is3D: true });

        expect(() => MapCoreMethods._disable3D.call(fake)).not.toThrow();
        expect(fake.is3D).toBe(false);
    });
});
