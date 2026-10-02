/**
 * pm-shapesgestures.test.ts — Comportement OBSERVÉ des 15 méthodes GESTES SUR
 * FORMES de `modules/pctac/planMap.js` (GStart-main, 5596 LOC, lecture seule),
 * pour le portage `src/apps/pctac/planmap/shapes-gestures.ts` (P2.CONV, paquet
 * `pm-shapesgestures`). Références `planMap.js:<ligne>` en commentaire, cf.
 * docs/SPEC-PLANMAP-SPLIT.md §4.11, §5.1, §5.4, §9.
 *
 * `this` FACTICE portant un faux `map` (jamais `new maplibregl.Map`, WebGL
 * absent sous jsdom — SPEC-PCTAC-CONVERSION §8.4).
 *
 * `maplibregl.Marker` est mocké : sa vraie implémentation appelle des méthodes
 * internes de `maplibregl.Map` (`_getUIString`, `on`, `getCanvasContainer`…)
 * lors de `addTo()`, qu'un faux `map` minimal ne peut pas fournir (vérifié :
 * `new maplibregl.Marker(...).addTo(fakeMap)` jette `TypeError:
 * t._getUIString is not a function` sous jsdom — même constat que
 * pm-shapesrender.test.ts, qui utilise le même mock). `shapes-gestures.ts`
 * n'utilise de 'maplibre-gl' QUE `Marker` au runtime (le reste est `import
 * type`) : le mock ne couvre donc que `Marker`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeoMethods } from '../../../src/apps/pctac/planmap/geo.js';
import { ShapesGesturesMethods } from '../../../src/apps/pctac/planmap/shapes-gestures.js';
import { SafeMethods, createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { LngLatTuple, PlanMapInternal, PlanShape } from '../../../src/apps/pctac/planmap/types.js';
import type { MapLayerMouseEvent } from 'maplibre-gl';

vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        private _lngLat: unknown = null;
        constructor(opts: { element?: HTMLElement } = {}) {
            this._element = opts.element ?? document.createElement('div');
        }
        setLngLat(ll: unknown): this { this._lngLat = ll; return this; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return this._element; }
        getLngLat(): unknown { return this._lngLat; }
    }
    return { default: { Marker: FakeMarker } };
});

/** Narrowing sans `!` (interdit par la mission) : jette explicitement si null/undefined. */
function assertNonNull<T>(value: T | null | undefined, message = 'expected non-null value'): T {
    if (value === null || value === undefined) throw new Error(message);
    return value;
}

const RECT_COORDS: LngLatTuple[] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

function makeFakeMap() {
    const canvasStyle: { cursor: string } = { cursor: '' };
    const canvas = {
        style: canvasStyle,
        getBoundingClientRect: () => ({
            left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
        }) as DOMRect,
    };
    return {
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng * 100, y: ll.lat * 100 })),
        unproject: vi.fn((p: [number, number]) => ({ lng: p[0] / 100, lat: p[1] / 100 })),
        // `_shapePointerDown` interroge lui-même les couches de formes (retours terrain 2026-10-02).
        queryRenderedFeatures: vi.fn((): unknown[] => []),
        getCanvas: vi.fn(() => canvas),
        on: vi.fn(),
        off: vi.fn(),
        dragPan: { enable: vi.fn(), disable: vi.fn() },
        touchZoomRotate: { enable: vi.fn(), disable: vi.fn() },
        doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

function makeShape(overrides: Partial<PlanShape> & Pick<PlanShape, 'id' | 'type'>): PlanShape {
    return { color: '#ef4444', ...overrides };
}

interface FakeMocks {
    loadShapes: ReturnType<typeof vi.fn>;
    saveShapes: ReturnType<typeof vi.fn>;
    pushHistory: ReturnType<typeof vi.fn>;
    refreshUndoRedoButtons: ReturnType<typeof vi.fn>;
    renderShapes: ReturnType<typeof vi.fn>;
    renderShapeLocks: ReturnType<typeof vi.fn>;
    closeWheel: ReturnType<typeof vi.fn>;
    openShapeWheel: ReturnType<typeof vi.fn>;
}

/**
 * Construit un `this` factice conforme à `PlanMapInternal` pour `ShapesGesturesMethods`.
 * Les 15 méthodes du paquet sous test sont RÉELLES (`...ShapesGesturesMethods`,
 * appels croisés `this._selectShape()`/`this._renderHandles()`… exécutés pour de
 * vrai) ; `geo.ts` (`_rectPolygon`/`_circlePolygon`/`_shapeCentroid`/`_shapeAnchor`)
 * et `state.ts` (`_safe`) sont aussi RÉELS (dépendances feuilles autorisées,
 * SPEC-PLANMAP-SPLIT.md §1.2) ; seules les méthodes d'AUTRES paquets
 * (draw-tools.ts, shapes-render.ts, wheels.ts) sont stubbées.
 */
function makeFakeThis(opts: { shapes?: PlanShape[]; withMap?: boolean; selectedShapeId?: string | null } = {}): {
    fake: PlanMapInternal;
    mocks: FakeMocks;
    map: FakeMap | null;
    shapes: () => PlanShape[];
} {
    const { shapes = [], withMap = true, selectedShapeId = null } = opts;
    let stored: PlanShape[] = shapes;
    const state = createPlanMapState();
    const map = makeFakeMap();

    const mocks: FakeMocks = {
        loadShapes: vi.fn((): PlanShape[] => stored),
        saveShapes: vi.fn((list: readonly PlanShape[]): void => { stored = list.slice(); }),
        pushHistory: vi.fn(),
        refreshUndoRedoButtons: vi.fn(),
        renderShapes: vi.fn(),
        renderShapeLocks: vi.fn(),
        closeWheel: vi.fn(),
        openShapeWheel: vi.fn(),
    };

    const base = {
        ...state,
        ...GeoMethods,
        ...SafeMethods,
        ...ShapesGesturesMethods,
        map: (withMap ? map : null) as unknown as PlanMapInternal['map'],
        _selectedShapeId: selectedShapeId,
        _loadShapes: mocks.loadShapes,
        _saveShapes: mocks.saveShapes,
        _pushHistory: mocks.pushHistory,
        _refreshUndoRedoButtons: mocks.refreshUndoRedoButtons,
        _renderShapes: mocks.renderShapes,
        _renderShapeLocks: mocks.renderShapeLocks,
        _closeWheel: mocks.closeWheel,
        _openShapeWheel: mocks.openShapeWheel,
    };

    const fake = base as unknown as PlanMapInternal;
    return { fake, mocks, map: withMap ? map : null, shapes: () => stored };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// ============================================================
// Fumée : aucune des 15 méthodes ne jette quand le DOM / la
// source (formes) sont absents (SPEC-PLANMAP-SPLIT §9).
// ============================================================
describe('fumée — DOM/source absents (planMap.js:2846-3487)', () => {
    it('_shapePointerDown ne jette pas sans feature ciblée', () => {
        const { fake } = makeFakeThis();
        const e = {
            originalEvent: undefined, point: { x: 0, y: 0 }, preventDefault: vi.fn(), lngLat: { lng: 0, lat: 0 },
        } as unknown as MapLayerMouseEvent;
        expect(() => ShapesGesturesMethods._shapePointerDown.call(fake, e)).not.toThrow();
    });

    it('outil mesure actif : toucher un dessin ne démarre AUCUN geste (retours terrain 2026-10-02, décision 4)', () => {
        const { fake } = makeFakeThis({ shapes: [makeShape({ id: 's1', type: 'line', coords: [[0, 0], [1, 1]] })] });
        // La cible vient de `_shapeTargetAt` (queryRenderedFeatures), plus de `e.features`.
        vi.mocked(assertNonNull(fake.map).queryRenderedFeatures).mockReturnValue([{ properties: { shapeId: 's1' } }] as never);
        const start = vi.spyOn(fake, '_startShapeGesture').mockImplementation(() => {});
        const preventDefault = vi.fn();
        const e = {
            originalEvent: { preventDefault }, preventDefault, point: { x: 0, y: 0 }, lngLat: { lng: 0, lat: 0 },
        } as unknown as MapLayerMouseEvent;
        // Témoin : hors mesure, le même toucher sur le trait sélectionné démarre bien le geste.
        fake._selectedShapeId = 's1';
        ShapesGesturesMethods._shapePointerDown.call(fake, e);
        expect(start).toHaveBeenCalledTimes(1);
        start.mockClear(); preventDefault.mockClear();
        fake._gesture = null; fake._selectedShapeId = null;
        fake.drawTool = 'measure';
        ShapesGesturesMethods._shapePointerDown.call(fake, e);
        expect(start).not.toHaveBeenCalled();
        // Pas de preventDefault : la carte garde son déplacement natif pendant la mesure.
        expect(preventDefault).not.toHaveBeenCalled();
        expect(fake._gesture).toBeNull();
        expect(fake._selectedShapeId).toBeNull();
    });

    it('_startShapeGesture ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => ShapesGesturesMethods._startShapeGesture.call(fake, 's1', { lng: 0, lat: 0 }, null)).not.toThrow();
    });

    it('_startShapeGesture ne jette pas avec carte (enregistre les listeners maplibre + document)', () => {
        const { fake, map } = makeFakeThis();
        expect(() => ShapesGesturesMethods._startShapeGesture.call(fake, 's1', { lng: 0, lat: 0 }, null)).not.toThrow();
        expect(assertNonNull(map).on).toHaveBeenCalled();
    });

    it('_suppressDblZoom ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => ShapesGesturesMethods._suppressDblZoom.call(fake)).not.toThrow();
    });

    it('_openShapeContextMenu ne jette pas quand la forme est introuvable', () => {
        const { fake } = makeFakeThis({ shapes: [] });
        expect(() => ShapesGesturesMethods._openShapeContextMenu.call(fake, 'missing', null)).not.toThrow();
    });

    it('_attachPinchListeners / _detachPinchListeners ne jettent pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => ShapesGesturesMethods._attachPinchListeners.call(fake)).not.toThrow();
        expect(() => ShapesGesturesMethods._detachPinchListeners.call(fake)).not.toThrow();
    });

    it('_startPinchGesture ne jette pas sans forme sélectionnée', () => {
        const { fake } = makeFakeThis({ shapes: [] });
        expect(() => ShapesGesturesMethods._startPinchGesture.call(fake)).not.toThrow();
    });

    it('_clearHandles / _clearFloatingToolbar ne jettent pas à vide', () => {
        const { fake } = makeFakeThis();
        expect(() => ShapesGesturesMethods._clearHandles.call(fake)).not.toThrow();
        expect(() => ShapesGesturesMethods._clearFloatingToolbar.call(fake)).not.toThrow();
    });

    it('_renderHandles ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => ShapesGesturesMethods._renderHandles.call(fake)).not.toThrow();
    });

    it('_startHandleGesture ne jette pas quand la forme est introuvable', () => {
        const { fake } = makeFakeThis({ shapes: [] });
        expect(() => ShapesGesturesMethods._startHandleGesture.call(
            fake, 'missing', 'corner', 0, { lng: 0, lat: 0 }, new Event('pointerdown'),
        )).not.toThrow();
    });

    it('_updateFloatingToolbarPos ne jette pas sans barre flottante active', () => {
        const { fake } = makeFakeThis();
        expect(() => ShapesGesturesMethods._updateFloatingToolbarPos.call(fake)).not.toThrow();
    });
});

// ============================================================
// _shapeHandles — pure, une entrée par type de forme
// ============================================================
describe('_shapeHandles (planMap.js:3203-3231)', () => {
    it('rectangle → 4 poignées "corner" (index 0..3), curseurs alternés nwse/nesw', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const handles = ShapesGesturesMethods._shapeHandles(rect);
        expect(handles.map(h => h.role)).toEqual(['corner', 'corner', 'corner', 'corner']);
        expect(handles.map(h => h.index)).toEqual([0, 1, 2, 3]);
        expect(handles.map(h => h.cursor)).toEqual(['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize']);
    });

    it('ligne → 2 poignées "endpoint" (1er et dernier point, y compris multi-points)', () => {
        const line = makeShape({ id: 'l1', type: 'line', coords: [[0, 0], [1, 1], [2, 2]] });
        const handles = ShapesGesturesMethods._shapeHandles(line);
        expect(handles.map(h => h.role)).toEqual(['endpoint', 'endpoint']);
        expect(handles.map(h => h.index)).toEqual([0, 2]);
        expect(handles[1]?.lngLat).toEqual({ lng: 2, lat: 2 });
    });

    it('cercle → poignée "edge" (rayon, index 0) + poignée "move" (centre, index -1)', () => {
        const circle = makeShape({ id: 'c1', type: 'circle', center: [0, 0], edge: [0, 1] });
        const handles = ShapesGesturesMethods._shapeHandles(circle);
        expect(handles.map(h => h.role)).toEqual(['edge', 'move']);
        expect(handles[0]?.index).toBe(0);
        expect(handles[0]?.lngLat).toEqual({ lng: 0, lat: 1 });
        expect(handles[1]?.index).toBe(-1);
        expect(handles[1]?.lngLat).toEqual({ lng: 0, lat: 0 });
    });

    it('texte → une seule poignée "textresize"', () => {
        const text = makeShape({ id: 't1', type: 'text', coords: [[5, 6]] });
        const handles = ShapesGesturesMethods._shapeHandles(text);
        expect(handles.map(h => h.role)).toEqual(['textresize']);
        expect(handles[0]?.lngLat).toEqual({ lng: 5, lat: 6 });
    });

    it('type inconnu (measure/measure-rings) → aucune poignée', () => {
        const measure = makeShape({ id: 'm1', type: 'measure', coords: [[0, 0], [1, 1]] });
        expect(ShapesGesturesMethods._shapeHandles(measure)).toEqual([]);
    });
});

// ============================================================
// _renderHandles — INVARIANT §5.4 : verrou GLOBAL vs verrou PAR-FORME
// (deux conditions distinctes, planMap.js:3237 et :3240)
// ============================================================
describe('_renderHandles (planMap.js:3233-3282) — INVARIANT §5.4 verrou par-forme', () => {
    it('verrou GLOBAL (_locked=true) : aucune poignée produite', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake } = makeFakeThis({ shapes: [rect], selectedShapeId: 'r1' });
        fake._locked = true;

        ShapesGesturesMethods._renderHandles.call(fake);

        expect(fake._handleMarkers).toEqual([]);
    });

    it('verrou PAR-FORME (s.locked=true) : aucune poignée produite même si _locked est false', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS, locked: true });
        const { fake } = makeFakeThis({ shapes: [rect], selectedShapeId: 'r1' });
        fake._locked = false;

        ShapesGesturesMethods._renderHandles.call(fake);

        expect(fake._handleMarkers).toEqual([]);
    });

    it('forme déverrouillée et sélectionnée, verrou global OFF → produit les 4 poignées du rectangle', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake } = makeFakeThis({ shapes: [rect], selectedShapeId: 'r1' });
        fake._locked = false;

        ShapesGesturesMethods._renderHandles.call(fake);

        expect(fake._handleMarkers).toHaveLength(4);
    });

    it("n'écrit jamais position/inset inline sur l'élément d'une poignée (INVARIANT MARKER §5.1)", () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake } = makeFakeThis({ shapes: [rect], selectedShapeId: 'r1' });

        ShapesGesturesMethods._renderHandles.call(fake);

        const el = fake._handleMarkers[0]?.getElement();
        expect(el?.style.position).toBe('');
        expect(el?.style.getPropertyValue('inset')).toBe('');
    });

    it('aucune sélection → aucune poignée, ne jette pas', () => {
        const { fake } = makeFakeThis({ shapes: [] });
        expect(() => ShapesGesturesMethods._renderHandles.call(fake)).not.toThrow();
        expect(fake._handleMarkers).toEqual([]);
    });
});

// ============================================================
// _attachPinchListeners / _detachPinchListeners — zéro fuite
// ============================================================
describe('_attachPinchListeners / _detachPinchListeners (planMap.js:3044-3065)', () => {
    it('détache EXACTEMENT le listener posé (même référence de fonction), aucun résidu', () => {
        const { fake, map } = makeFakeThis();
        const m = assertNonNull(map);

        ShapesGesturesMethods._attachPinchListeners.call(fake);
        expect(m.on).toHaveBeenCalledTimes(1);
        expect(m.on).toHaveBeenCalledWith('touchstart', expect.any(Function));
        const attachedListener = assertNonNull(fake._pinchListener);

        ShapesGesturesMethods._detachPinchListeners.call(fake);
        expect(m.off).toHaveBeenCalledTimes(1);
        expect(m.off).toHaveBeenCalledWith('touchstart', attachedListener);
        expect(fake._pinchListener).toBeNull();
    });

    it('un second _attachPinchListeners ne repose pas de listener tant que non détaché (garde planMap.js:3045)', () => {
        const { fake, map } = makeFakeThis();
        const m = assertNonNull(map);

        ShapesGesturesMethods._attachPinchListeners.call(fake);
        ShapesGesturesMethods._attachPinchListeners.call(fake);

        expect(m.on).toHaveBeenCalledTimes(1);
    });

    it('_detachPinchListeners sans listener posé ne jette pas et ne touche pas map.off', () => {
        const { fake, map } = makeFakeThis();
        const m = assertNonNull(map);

        expect(() => ShapesGesturesMethods._detachPinchListeners.call(fake)).not.toThrow();

        expect(m.off).not.toHaveBeenCalled();
    });
});

// ============================================================
// _selectShape / _deselectShape — mise à jour de _selectedShapeId
// ============================================================
describe('_selectShape / _deselectShape (planMap.js:3017-3037)', () => {
    it('_selectShape sur une forme EXISTANTE met à jour _selectedShapeId', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake } = makeFakeThis({ shapes: [rect] });
        expect(fake._selectedShapeId).toBeNull();

        ShapesGesturesMethods._selectShape.call(fake, 'r1');

        expect(fake._selectedShapeId).toBe('r1');
    });

    it('_selectShape sur une forme INEXISTANTE ne "colle" pas : _renderHandles désélectionne (planMap.js:3238-3239)', () => {
        const { fake } = makeFakeThis({ shapes: [] });

        ShapesGesturesMethods._selectShape.call(fake, 'missing');

        expect(fake._selectedShapeId).toBeNull();
    });

    it('_deselectShape remet _selectedShapeId à null et détache le pinch', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake, mocks } = makeFakeThis({ shapes: [rect], selectedShapeId: 'r1' });

        ShapesGesturesMethods._deselectShape.call(fake);

        expect(fake._selectedShapeId).toBeNull();
        expect(mocks.closeWheel).toHaveBeenCalledTimes(1);
        expect(mocks.renderShapeLocks).toHaveBeenCalledTimes(1);
    });

    it('_deselectShape sans sélection ne jette pas et ne fait rien (planMap.js:3030)', () => {
        const { fake, mocks } = makeFakeThis();

        expect(() => ShapesGesturesMethods._deselectShape.call(fake)).not.toThrow();

        expect(mocks.closeWheel).not.toHaveBeenCalled();
    });

    it('re-sélectionner la MÊME forme re-rend les poignées sans changer _selectedShapeId (planMap.js:3018-3020)', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake } = makeFakeThis({ shapes: [rect], selectedShapeId: 'r1' });

        ShapesGesturesMethods._selectShape.call(fake, 'r1');

        expect(fake._selectedShapeId).toBe('r1');
        expect(fake._handleMarkers).toHaveLength(4);
    });
});

describe('_openShapeContextMenu (planMap.js:3004-3015)', () => {
    it('sélectionne la forme et ouvre la roue au point fourni', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake, mocks } = makeFakeThis({ shapes: [rect] });

        ShapesGesturesMethods._openShapeContextMenu.call(fake, 'r1', { lng: 9, lat: 9 });

        expect(fake._selectedShapeId).toBe('r1');
        expect(mocks.openShapeWheel).toHaveBeenCalledWith('r1', { lng: 9, lat: 9 });
    });

    it('outil de dessin actif → ne fait rien (planMap.js:3008)', () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS });
        const { fake, mocks } = makeFakeThis({ shapes: [rect] });
        fake.drawTool = 'line';

        ShapesGesturesMethods._openShapeContextMenu.call(fake, 'r1', null);

        expect(fake._selectedShapeId).toBeNull();
        expect(mocks.openShapeWheel).not.toHaveBeenCalled();
    });
});

// ============================================================
// _startPinchGesture — intégration légère (garde + délégation geo.ts réelle)
// ============================================================
describe('_startPinchGesture (planMap.js:3122-3180)', () => {
    it('forme sélectionnée introuvable → ne démarre aucun geste, ne jette pas', () => {
        const { fake, map } = makeFakeThis({ shapes: [], selectedShapeId: 'missing' });

        expect(() => ShapesGesturesMethods._startPinchGesture.call(fake)).not.toThrow();

        expect(assertNonNull(map).touchZoomRotate.disable).not.toHaveBeenCalled();
    });

    it('forme trouvée → désactive pinch-zoom/pan natifs et pose les listeners touch', () => {
        const circle = makeShape({ id: 'c1', type: 'circle', center: [0, 0], edge: [0, 1] });
        const { fake, map, mocks } = makeFakeThis({ shapes: [circle], selectedShapeId: 'c1' });

        ShapesGesturesMethods._startPinchGesture.call(fake);

        const m = assertNonNull(map);
        expect(m.touchZoomRotate.disable).toHaveBeenCalledTimes(1);
        expect(m.dragPan.disable).toHaveBeenCalledTimes(1);
        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
        expect(m.on).toHaveBeenCalledWith('touchmove', expect.any(Function));
        expect(m.on).toHaveBeenCalledWith('touchend', expect.any(Function));
        expect(m.on).toHaveBeenCalledWith('touchcancel', expect.any(Function));
    });
});

// ============================================================
// _startHandleGesture — pivot par rôle (intégration avec geo.ts réel)
// ============================================================
describe('_startHandleGesture (planMap.js:3284-3395)', () => {
    it("déplace la poignée 'edge' d'un cercle : met à jour center/edge/coords via le vrai onMove", () => {
        const circle = makeShape({ id: 'c1', type: 'circle', center: [0, 0], edge: [0, 1] });
        const { fake, map } = makeFakeThis({ shapes: [circle], selectedShapeId: 'c1' });
        const m = assertNonNull(map);

        ShapesGesturesMethods._startHandleGesture.call(fake, 'c1', 'edge', 0, { lng: 0, lat: 1 }, new Event('pointerdown'));

        expect(fake._gesture).toEqual(expect.objectContaining({ type: 'handle', shapeId: 'c1', role: 'edge' }));
        expect(m.dragPan.disable).toHaveBeenCalledTimes(1);

        const moveCall = m.on.mock.calls.find(c => c[0] === 'mousemove');
        const onMove = assertNonNull(moveCall)[1] as (e: unknown) => void;
        onMove({ lngLat: { lng: 0, lat: 2 } });

        const updated = assertNonNull(fake._loadShapes().find(s => s.id === 'c1'));
        expect(updated.edge).toEqual([0, 2]);
        expect(updated.center).toEqual([0, 0]);
    });

    it("forme absente → ne pousse aucun historique, ne touche pas la carte", () => {
        const { fake, map, mocks } = makeFakeThis({ shapes: [] });

        ShapesGesturesMethods._startHandleGesture.call(fake, 'missing', 'corner', 0, { lng: 0, lat: 0 }, new Event('pointerdown'));

        expect(mocks.pushHistory).not.toHaveBeenCalled();
        expect(assertNonNull(map).dragPan.disable).not.toHaveBeenCalled();
    });
});

// ============================================================
// Poignées du NOM d'une forme : rail le long du tracé + rotation
// ============================================================
describe('_shapeHandles — poignées de label', () => {
    it("sans nom : aucune poignée de label, la liste reste celle d'avant", () => {
        const line = makeShape({ id: 'l1', type: 'line', coords: [[0, 0], [0, 1]] });
        expect(ShapesGesturesMethods._shapeHandles(line).map(h => h.role)).toEqual(['endpoint', 'endpoint']);
    });

    it("ligne nommée : ajoute 'label' (rail) et 'labelrot' (rotation)", () => {
        const line = makeShape({ id: 'l1', type: 'line', coords: [[0, 0], [0, 1]], text: 'Axe A' });
        const handles = ShapesGesturesMethods._shapeHandles(line);
        expect(handles.map(h => h.role)).toEqual(['endpoint', 'endpoint', 'label', 'labelrot']);
        // Posées sur le label, donc au milieu de la corde tant que labelT est absent.
        expect(handles[2]?.lngLat).toEqual({ lng: 0, lat: 0.5 });
        // Décalage vertical aligné sur le marker de texte d'une ligne (-18), et
        // décalage horizontal de part et d'autre du nom : posées DESSUS, elles
        // seraient interceptées par le texte, qui a son propre geste.
        expect(handles[2]?.offset).toEqual([-34, -18]);
        expect(handles[3]?.offset).toEqual([34, -18]);
    });

    it('ligne nommée avec labelT : la poignée suit le rail, pas la corde', () => {
        const coords: LngLatTuple[] = [[0, 0], [0, 0.02], [0.01, 0.02]];
        const line = makeShape({ id: 'l1', type: 'line', coords, text: 'Axe A', labelT: 1 });
        const handles = ShapesGesturesMethods._shapeHandles(line);
        const label = assertNonNull(handles.find(h => h.role === 'label'));
        expect(label.lngLat.lng).toBeCloseTo(0.01, 10);
        expect(label.lngLat.lat).toBeCloseTo(0.02, 10);
    });

    it("rectangle nommé : rotation seulement, PAS de rail (le nom reste au centre)", () => {
        const rect = makeShape({ id: 'r1', type: 'rectangle', coords: RECT_COORDS, text: 'ZRA' });
        const handles = ShapesGesturesMethods._shapeHandles(rect);
        expect(handles.map(h => h.role)).toEqual(['corner', 'corner', 'corner', 'corner', 'labelrot']);
        expect(handles[4]?.lngLat).toEqual({ lng: 0.5, lat: 0.5 });
        // offsetY nul hors ligne : le marker de texte d'un rectangle n'est pas décalé.
        expect(handles[4]?.offset).toEqual([34, 0]);
    });

    it('cercle nommé : rotation seulement, ancrée sur le centre', () => {
        const circle = makeShape({ id: 'c1', type: 'circle', center: [3, 4], edge: [3, 5], text: 'Périmètre' });
        const handles = ShapesGesturesMethods._shapeHandles(circle);
        expect(handles.map(h => h.role)).toEqual(['edge', 'move', 'labelrot']);
        expect(handles[2]?.lngLat).toEqual({ lng: 3, lat: 4 });
    });

    it("ligne dégénérée à un seul point : pas de rail (rien à parcourir), rotation conservée", () => {
        const line = makeShape({ id: 'l1', type: 'line', coords: [[1, 2]], text: 'X' });
        expect(ShapesGesturesMethods._shapeHandles(line).map(h => h.role))
            .toEqual(['endpoint', 'endpoint', 'labelrot']);
    });

    it("texte LIBRE : aucune poignée de label — c'est un texte, pas le nom d'un dessin", () => {
        // Verrou de non-régression pour OI : `type:'text'` y est le seul type de
        // forme portant du texte, donc cette exclusion garantit que la carte OI
        // ne voit apparaître aucune poignée nouvelle.
        const text = makeShape({ id: 't1', type: 'text', coords: [[5, 6]], text: 'Cible' });
        expect(ShapesGesturesMethods._shapeHandles(text).map(h => h.role)).toEqual(['textresize']);
    });
});

describe("_startHandleGesture — rôles 'label' et 'labelrot'", () => {
    it("'label' : écrit labelT et ne touche PAS aux coordonnées de la forme", () => {
        const coords: LngLatTuple[] = [[0, 0], [0, 0.02], [0.01, 0.02]];
        const line = makeShape({ id: 'l1', type: 'line', coords, text: 'Axe A' });
        const { fake, map } = makeFakeThis({ shapes: [line], selectedShapeId: 'l1' });
        const m = assertNonNull(map);

        ShapesGesturesMethods._startHandleGesture.call(fake, 'l1', 'label', 0, { lng: 0, lat: 0.01 }, new Event('pointerdown'));
        const onMove = assertNonNull(m.on.mock.calls.find(c => c[0] === 'mousemove'))[1] as (e: unknown) => void;
        // Doigt posé près du DÉBUT du premier segment.
        onMove({ lngLat: { lng: 0, lat: 0.005 } });

        const updated = assertNonNull(fake._loadShapes().find(s => s.id === 'l1'));
        expect(typeof updated.labelT).toBe('number');
        expect(updated.labelT).toBeGreaterThan(0);
        expect(updated.labelT).toBeLessThan(0.5);
        // Le rail déplace le NOM, jamais le tracé.
        expect(updated.coords).toEqual(coords);
    });

    it("'labelrot' : écrit un angle normalisé dans [0,360)", () => {
        const line = makeShape({ id: 'l1', type: 'line', coords: [[0, 0], [0, 1]], text: 'Axe A' });
        const { fake, map } = makeFakeThis({ shapes: [line], selectedShapeId: 'l1' });
        const m = assertNonNull(map);

        ShapesGesturesMethods._startHandleGesture.call(fake, 'l1', 'labelrot', 0, { lng: 0, lat: 0.5 }, new Event('pointerdown'));
        const onMove = assertNonNull(m.on.mock.calls.find(c => c[0] === 'mousemove'))[1] as (e: unknown) => void;

        // Le faux `project` fait x = lng*100, y = lat*100 : l'ancrage du label
        // (milieu de corde [0, 0.5]) tombe en {x:0, y:50}, décalé de -18 px pour
        // une ligne → {x:0, y:32}. Un doigt droit en dessous vaut 90°.
        onMove({ lngLat: { lng: 0, lat: 0.5 }, point: { x: 0, y: 32 + 34 } });
        expect(assertNonNull(fake._loadShapes().find(s => s.id === 'l1')).labelRot).toBe(90);

        // Droit au-dessus : -90° ramené à 270°, jamais de valeur négative.
        onMove({ lngLat: { lng: 0, lat: 0.5 }, point: { x: 0, y: 32 - 34 } });
        expect(assertNonNull(fake._loadShapes().find(s => s.id === 'l1')).labelRot).toBe(270);
    });

    it("'labelrot' sur une forme sans nom : ne fait rien (pas d'ancrage de label)", () => {
        const line = makeShape({ id: 'l1', type: 'line', coords: [[0, 0], [0, 1]] });
        const { fake, map } = makeFakeThis({ shapes: [line], selectedShapeId: 'l1' });
        const m = assertNonNull(map);

        ShapesGesturesMethods._startHandleGesture.call(fake, 'l1', 'labelrot', 0, { lng: 0, lat: 0.5 }, new Event('pointerdown'));
        const onMove = assertNonNull(m.on.mock.calls.find(c => c[0] === 'mousemove'))[1] as (e: unknown) => void;
        onMove({ lngLat: { lng: 0, lat: 0.5 }, point: { x: 10, y: 10 } });

        expect(assertNonNull(fake._loadShapes().find(s => s.id === 'l1')).labelRot).toBeUndefined();
    });
});
