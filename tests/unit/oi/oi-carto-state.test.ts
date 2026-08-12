/**
 * oi-carto-state.test.ts — Comportement OBSERVÉ de `modules/oi_cartographie.js`
 * (GStart-main, 1681 LOC, lecture seule) pour le paquet `oi-carto-state` :
 * `carto/state.ts` (`createOICartoState`, `SafeMethods._safe`,
 * `PersistMethods` : `_getCartoState`/`_loadView`/`_saveView`/`_loadPins`/
 * `_savePins`/`_loadShapes`/`_saveShapes`). Références `oi_cartographie.js:<ligne>`
 * en commentaire, cf. SPEC-OI-CONVERSION.md §6.2/§6.3, `PAQUETS-OI.json`
 * id="oi-carto-state".
 *
 * `Store` RÉEL (pas de double) : importé depuis `@oi/init.js`, comme
 * `oi-navigation.test.ts` (même précédent) — `Store.state.formData` est
 * réinitialisé avant chaque test. C'est la SEULE frontière de persistance de
 * `carto/` (cf. note de tête de `state.ts`) : tester contre le Proxy réel
 * exerce fidèlement le lazy-init et l'aller-retour lecture/écriture.
 *
 * `this` FACTICE (même politique que `oi-carto-map-core.test.ts`) :
 * `makeFakeThis()` combine `createOICartoState()` avec des stubs `vi.fn()`
 * pour la surface COMPLÈTE de `OICartoInternal` (~85 méthodes) — SEULES les
 * méthodes RÉELLEMENT sous test (`_safe`, les 7 méthodes de `PersistMethods`)
 * portent l'implémentation RÉELLE par défaut, appelées via
 * `PersistMethods.xxx.call(fake, ...)` / `SafeMethods._safe.call(fake, ...)`,
 * jamais via `fake.xxx()` directement. `fake.persistence` (posé par
 * `createOICartoState()`) porte TOUJOURS l'implémentation RÉELLE de l'adapter
 * (mission R3-c, `@shared/map-persistence.ts`) : `_loadView`/`_saveView`/
 * `_loadPins`/`_savePins`/`_loadShapes`/`_saveShapes` délèguent à
 * `this.persistence`, dont les accesseurs lisent `Store` via la fonction de
 * MODULE `getCartoState()` (state.ts) — PAS via `this._getCartoState()`
 * (dispatch dynamique). Conséquence pour les tests "Store indisponible" :
 * on vide `Store.state.formData` directement plutôt que de mocker
 * `fake._getCartoState` (qui n'a plus d'effet sur ces 6 méthodes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Store } from '@oi/init.js';

import { createOICartoState, PersistMethods, SafeMethods } from '../../../src/apps/oi/carto/state.js';
import type { OICartoInternal, OiCartoPin, OiCartoShape } from '../../../src/apps/oi/carto/types.js';

// ---------------------------------------------------------------------------
// Fabriques de `map`/`this` factices
// ---------------------------------------------------------------------------

/** Sous-ensemble de `maplibregl.Map` réellement appelé par `_saveView` (oi_cartographie.js:381-393). */
function makeFakeMap(overrides: Record<string, unknown> = {}) {
    return {
        getCenter: vi.fn(() => ({ lng: 2.3522, lat: 48.8566 })),
        getZoom: vi.fn(() => 5),
        getPitch: vi.fn(() => 0),
        getBearing: vi.fn(() => 0),
        ...overrides,
    };
}

/** `this` factice — cast `unknown` (même procédé que `oi-carto-map-core.test.ts` :
 * `OICartoInternal`, ~85 méthodes, ne "chevauche" pas suffisamment un littéral
 * partiel pour un `as` direct). Les méthodes du groupe SOUS TEST (`_safe` +
 * `PersistMethods`) portent l'implémentation RÉELLE par défaut ; toutes les
 * autres sont des stubs `vi.fn()` neutres (ce fichier teste `state.ts`, pas
 * leur contenu). */
function makeFakeThis(overrides: Record<string, unknown> = {}): OICartoInternal {
    return {
        // --- État — les 13 champs de createOICartoState() (oi_cartographie.js:270-282) ---
        ...createOICartoState(),
        // Champ ad hoc hors littéral (types.ts) — non couvert par createOICartoState().
        _inlinePanelMove: null,

        // --- Groupe SOUS TEST : implémentation RÉELLE ---
        _safe: SafeMethods._safe,
        _getCartoState: PersistMethods._getCartoState,
        _loadView: PersistMethods._loadView,
        _saveView: PersistMethods._saveView,
        _loadPins: PersistMethods._loadPins,
        _savePins: PersistMethods._savePins,
        _loadShapes: PersistMethods._loadShapes,
        _saveShapes: PersistMethods._saveShapes,

        // --- Cycle de vie carte (map-core.ts, autre paquet) ---
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
    // Réinitialise la SEULE frontière de persistance de carto/ (cf. note de
    // tête de fichier) — même précédent que oi-navigation.test.ts.
    Store.state.formData = {};
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. createOICartoState (oi_cartographie.js:270-282)
// ---------------------------------------------------------------------------

describe('createOICartoState (oi_cartographie.js:270-282)', () => {
    it('pose les 13 champs avec leurs valeurs initiales exactes', () => {
        const state = createOICartoState();

        expect(state._activeWheel).toBeNull();
        expect(state._inlinePanel).toBeNull();
        expect(state.map).toBeNull();
        expect(state.initialized).toBe(false);
        expect(state.is3D).toBe(false);
        expect(state.markers).toBeInstanceOf(Map);
        expect(state.markers.size).toBe(0);
        expect(state.labelsVisible).toBe(true);
        expect(state.pendingPin).toBeNull();
        expect(state.drawTool).toBeNull();
        expect(state.drawColor).toBe('#ef4444');
        expect(state.drawState).toBeNull();
        expect(state.history).toEqual([]);
        expect(state.redoStack).toEqual([]);
    });

    it('deux appels produisent des références indépendantes (markers/history/redoStack)', () => {
        const a = createOICartoState();
        const b = createOICartoState();

        expect(a.markers).not.toBe(b.markers);
        expect(a.history).not.toBe(b.history);
        expect(a.redoStack).not.toBe(b.redoStack);

        a.markers.set('x', { pin: {}, label: {} });
        a.history.push('{}');
        expect(b.markers.size).toBe(0);
        expect(b.history).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 2. SafeMethods._safe (oi_cartographie.js:284-291)
// ---------------------------------------------------------------------------

describe('_safe (oi_cartographie.js:284-291)', () => {
    // Appelé via `fake._safe(...)` (méthode, PAS `SafeMethods._safe.call(...)`) :
    // `Function.prototype.call` fait perdre l'inférence des paramètres de type
    // propres de `_safe` (A, R sont figés à `unknown[]`/`unknown`), un appel de
    // méthode normal les infère correctement depuis `fn`.
    it('exécution normale : transmet les arguments et le résultat', () => {
        const fake = makeFakeThis();
        const fn = vi.fn((a: number, b: number) => a + b);

        const wrapped = fake._safe(fn, 'addition');
        const result = wrapped(2, 3);

        expect(fn).toHaveBeenCalledWith(2, 3);
        expect(result).toBe(5);
    });

    it('exception capturée : ne se propage pas, log avec le label par défaut "handler"', () => {
        const fake = makeFakeThis();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = vi.fn(() => {
            throw new Error('kaboom');
        });

        const wrapped = fake._safe(boom);

        expect(() => wrapped()).not.toThrow();
        expect(wrapped()).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith('[OICarto] handler a échoué:', expect.any(Error));
    });

    it('exception capturée avec label personnalisé : le message reprend le label', () => {
        const fake = makeFakeThis();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = vi.fn(() => {
            throw new Error('kaboom');
        });

        const wrapped = fake._safe(boom, 'mapClick');
        wrapped();

        expect(errorSpy).toHaveBeenCalledWith('[OICarto] mapClick a échoué:', expect.any(Error));
    });
});

// ---------------------------------------------------------------------------
// 3. _getCartoState (oi_cartographie.js:366-373)
// ---------------------------------------------------------------------------

describe('_getCartoState (oi_cartographie.js:366-373)', () => {
    it('formData.cartography absent ⇒ lazy-init { view: null, pins: [], shapes: [] } et le retourne', () => {
        const fake = makeFakeThis();

        const carto = PersistMethods._getCartoState.call(fake);

        expect(carto).toEqual({ view: null, pins: [], shapes: [] });
        expect(Store.state.formData.cartography).toEqual({ view: null, pins: [], shapes: [] });
    });

    it('formData.cartography déjà présent ⇒ ne réinitialise PAS son contenu (pas de double lazy-init)', () => {
        const fake = makeFakeThis();
        PersistMethods._getCartoState.call(fake); // 1er appel : lazy-init
        const pin: OiCartoPin = {
            id: 'p1',
            kind: 'member',
            label: 'AO1',
            memberTri: 'AAA',
            fonction: null,
            icon: null,
            color: null,
            lng: 2.35,
            lat: 48.85,
        };
        PersistMethods._savePins.call(fake, [pin]);

        const carto = PersistMethods._getCartoState.call(fake); // 2e appel

        expect(carto?.pins).toEqual([pin]);
    });

    it('appels successifs renvoient le MÊME objet (référence stable)', () => {
        const fake = makeFakeThis();

        const first = PersistMethods._getCartoState.call(fake);
        const second = PersistMethods._getCartoState.call(fake);

        expect(first).toBe(second);
    });
});

// ---------------------------------------------------------------------------
// 4-5. _loadView / _saveView (oi_cartographie.js:374-393)
// ---------------------------------------------------------------------------

describe('_loadView / _saveView (oi_cartographie.js:374-393)', () => {
    it('_loadView sans vue persistée ⇒ France entière par défaut (center/zoom, sans is3D)', () => {
        const fake = makeFakeThis();

        const view = PersistMethods._loadView.call(fake);

        expect(view).toEqual({ center: [2.3522, 48.8566], zoom: 5 });
    });

    it('_saveView sans carte (this.map === null) ⇒ ne crée pas formData.cartography, ne jette pas', () => {
        const fake = makeFakeThis({ map: null });

        expect(() => PersistMethods._saveView.call(fake)).not.toThrow();
        expect(Store.state.formData.cartography).toBeUndefined();
    });

    // R3-c : `_saveView` délègue désormais à `this.persistence.saveView()`
    // (adapter posé par `createOICartoState()`, cf. `buildCartoPersistenceAdapter`
    // dans state.ts) dont les accesseurs appellent la fonction de MODULE
    // `getCartoState()` — plus `this._getCartoState()` (dispatch dynamique) —
    // donc mocker `fake._getCartoState` n'a plus d'effet sur `_saveView`.
    // Adaptation du mock (attendu inchangé : ne jette pas) : on simule
    // "Store indisponible" à la source, en vidant `Store.state.formData`
    // (même garde `!Store.state.formData` que l'original `_getCartoState`).
    it('_saveView avec Store indisponible (formData vide) ⇒ ne jette pas', () => {
        const map = makeFakeMap();
        const fake = makeFakeThis({ map });
        Store.state.formData = undefined as unknown as typeof Store.state.formData;

        expect(() => PersistMethods._saveView.call(fake)).not.toThrow();
    });

    it('_saveView : persiste exactement { center:[lng,lat], zoom, pitch, bearing, is3D, streetLabelsOn }', () => {
        const map = makeFakeMap({
            getCenter: vi.fn(() => ({ lng: 4.835, lat: 45.764 })),
            getZoom: vi.fn(() => 12.5),
            getPitch: vi.fn(() => 45),
            getBearing: vi.fn(() => 90),
        });
        const fake = makeFakeThis({ map, is3D: true });

        PersistMethods._saveView.call(fake);

        expect(Store.state.formData.cartography?.view).toEqual({
            center: [4.835, 45.764],
            zoom: 12.5,
            pitch: 45,
            bearing: 90,
            is3D: true,
            streetLabelsOn: false,
        });
    });

    it('aller-retour : _saveView puis _loadView renvoie exactement la vue persistée', () => {
        const map = makeFakeMap({
            getCenter: vi.fn(() => ({ lng: 1.2, lat: 43.6 })),
            getZoom: vi.fn(() => 8),
        });
        const fake = makeFakeThis({ map, is3D: false });

        PersistMethods._saveView.call(fake);
        const reloaded = PersistMethods._loadView.call(fake);

        expect(reloaded).toEqual({ center: [1.2, 43.6], zoom: 8, pitch: 0, bearing: 0, is3D: false, streetLabelsOn: false });
    });

    it('_loadView : vue persistée avec center non-tableau (état corrompu) ⇒ repli par défaut', () => {
        const fake = makeFakeThis();
        PersistMethods._getCartoState.call(fake); // lazy-init
        // État délibérément corrompu pour exercer `Array.isArray(v.center)` :
        // cast justifié (test de la branche de repli, aucune API ne produit
        // normalement cette forme).
        Store.state.formData.cartography = {
            view: { center: 'invalide' as unknown as [number, number], zoom: 9 },
            pins: [],
            shapes: [],
        };

        const view = PersistMethods._loadView.call(fake);

        expect(view).toEqual({ center: [2.3522, 48.8566], zoom: 5 });
    });
});

// ---------------------------------------------------------------------------
// 6-7. _loadPins / _savePins (oi_cartographie.js:395-403)
// ---------------------------------------------------------------------------

describe('_loadPins / _savePins (oi_cartographie.js:395-403)', () => {
    it('_loadPins sans pins persistés ⇒ []', () => {
        const fake = makeFakeThis();
        expect(PersistMethods._loadPins.call(fake)).toEqual([]);
    });

    // R3-c : cf. commentaire de `_saveView avec Store indisponible` ci-dessus —
    // même adaptation (mock `_getCartoState` sans effet sur `_savePins`,
    // qui délègue à `this.persistence.savePins()`).
    it('_savePins avec Store indisponible (formData vide) ⇒ ne jette pas (no-op)', () => {
        const fake = makeFakeThis();
        Store.state.formData = undefined as unknown as typeof Store.state.formData;
        expect(() => PersistMethods._savePins.call(fake, [])).not.toThrow();
    });

    it('aller-retour : _savePins puis _loadPins renvoie la même liste', () => {
        const fake = makeFakeThis();
        const pins: OiCartoPin[] = [
            {
                id: 'p1',
                kind: 'member',
                label: 'AO1 · Chef inter',
                memberTri: 'AAA',
                fonction: 'Chef inter',
                icon: 'stars',
                color: '#3b82f6',
                lng: 2.35,
                lat: 48.85,
            },
            {
                id: 'p2',
                kind: 'rassemblement',
                label: 'Rassemblement',
                memberTri: null,
                fonction: null,
                icon: null,
                color: null,
                lng: 2.36,
                lat: 48.86,
            },
        ];

        PersistMethods._savePins.call(fake, pins);
        const reloaded = PersistMethods._loadPins.call(fake);

        expect(reloaded).toEqual(pins);
        expect(Store.state.formData.cartography?.pins).toEqual(pins);
    });

    it('_savePins([]) écrase une liste précédente', () => {
        const fake = makeFakeThis();
        const pin: OiCartoPin = {
            id: 'p1',
            kind: 'member',
            label: 'AO1',
            memberTri: 'AAA',
            fonction: null,
            icon: null,
            color: null,
            lng: 2.35,
            lat: 48.85,
        };
        PersistMethods._savePins.call(fake, [pin]);

        PersistMethods._savePins.call(fake, []);

        expect(PersistMethods._loadPins.call(fake)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 8-9. _loadShapes / _saveShapes (oi_cartographie.js:405-413)
// ---------------------------------------------------------------------------

describe('_loadShapes / _saveShapes (oi_cartographie.js:405-413)', () => {
    it('_loadShapes sans shapes persistées ⇒ []', () => {
        const fake = makeFakeThis();
        expect(PersistMethods._loadShapes.call(fake)).toEqual([]);
    });

    // R3-c : cf. commentaire de `_saveView avec Store indisponible` (plus haut) —
    // même adaptation.
    it('_saveShapes avec Store indisponible (formData vide) ⇒ ne jette pas (no-op)', () => {
        const fake = makeFakeThis();
        Store.state.formData = undefined as unknown as typeof Store.state.formData;
        expect(() => PersistMethods._saveShapes.call(fake, [])).not.toThrow();
    });

    it('aller-retour : _saveShapes puis _loadShapes renvoie la même liste', () => {
        const fake = makeFakeThis();
        const shapes: OiCartoShape[] = [
            {
                id: 's1',
                type: 'rectangle',
                color: '#ef4444',
                coords: [
                    [2.35, 48.85],
                    [2.36, 48.85],
                    [2.36, 48.86],
                    [2.35, 48.86],
                ],
            },
            {
                id: 's2',
                type: 'circle',
                color: '#22c55e',
                coords: [[2.4, 48.9]],
                center: [2.4, 48.9],
                edge: [2.41, 48.9],
            },
        ];

        PersistMethods._saveShapes.call(fake, shapes);
        const reloaded = PersistMethods._loadShapes.call(fake);

        expect(reloaded).toEqual(shapes);
        expect(Store.state.formData.cartography?.shapes).toEqual(shapes);
    });
});
