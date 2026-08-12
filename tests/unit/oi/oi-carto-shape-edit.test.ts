/**
 * oi-carto-shape-edit.test.ts — Groupe `ShapeEditMethods` (`carto/shape-edit.ts`,
 * chantier shape-edit) : sélection, poignées, pinch, toolbar flottante.
 * Modelé sur `tests/unit/pctac/pm-shapesgestures.test.ts` (même machine
 * partagée `@shared/shape-gestures.js`, même mock `maplibregl.Marker`).
 *
 * `this` FACTICE portant un faux `map` (jamais `new maplibregl.Map`, WebGL
 * absent sous jsdom). Les méthodes du groupe sous test sont RÉELLES (appels
 * croisés `_selectShape` → `_renderHandles`/`_renderShapeToolbar` exécutés
 * pour de vrai) ; seules les dépendances d'AUTRES groupes (state.ts, draw.ts)
 * sont stubbées.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapLayerMouseEvent } from 'maplibre-gl';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ toast: toastSpy }));

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

import { ShapeEditMethods } from '../../../src/apps/oi/carto/shape-edit.js';
import type { LngLatTuple, OICartoInternal, OiCartoShape } from '../../../src/apps/oi/carto/types.js';

// `_safe` réimplémenté localement (le vrai vit dans `carto/state.ts`, qui
// importe `@oi/init.js` — trop lourd sous jsdom pour un simple wrapper).
const SafeMethods = {
    _safe<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
        return (...args: A) => { try { return fn(...args); } catch { return undefined; } };
    },
};

/** Narrowing sans `!` : jette explicitement si null/undefined. */
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
        getCanvas: vi.fn(() => canvas),
        queryRenderedFeatures: vi.fn((): { properties: Record<string, unknown> }[] => []),
        on: vi.fn(),
        off: vi.fn(),
        dragPan: { enable: vi.fn(), disable: vi.fn() },
        touchZoomRotate: { enable: vi.fn(), disable: vi.fn() },
        doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

interface FakeMocks {
    loadShapes: ReturnType<typeof vi.fn>;
    saveShapes: ReturnType<typeof vi.fn>;
    pushHistory: ReturnType<typeof vi.fn>;
    refreshUndoRedoButtons: ReturnType<typeof vi.fn>;
    renderShapes: ReturnType<typeof vi.fn>;
}

function makeFakeThis(opts: { shapes?: OiCartoShape[]; withMap?: boolean; selectedShapeId?: string | null } = {}): {
    fake: OICartoInternal;
    mocks: FakeMocks;
    map: FakeMap | null;
    shapes: () => OiCartoShape[];
} {
    const { shapes = [], withMap = true, selectedShapeId = null } = opts;
    let stored: OiCartoShape[] = shapes;
    const map = makeFakeMap();

    const mocks: FakeMocks = {
        loadShapes: vi.fn((): OiCartoShape[] => stored),
        saveShapes: vi.fn((list: readonly OiCartoShape[]): void => { stored = list.slice(); }),
        pushHistory: vi.fn(),
        refreshUndoRedoButtons: vi.fn(),
        renderShapes: vi.fn(),
    };

    const base = {
        ...SafeMethods,
        ...ShapeEditMethods,
        map: (withMap ? map : null) as unknown as OICartoInternal['map'],
        drawTool: null,
        pendingPin: null,
        drawPrecisionMode: false,
        _gesture: null,
        _selectedShapeId: selectedShapeId,
        _handleMarkers: [],
        _shapeToolbarMarker: null,
        _pinchListener: null,
        _loadShapes: mocks.loadShapes,
        _saveShapes: mocks.saveShapes,
        _pushHistory: mocks.pushHistory,
        _refreshUndoRedoButtons: mocks.refreshUndoRedoButtons,
        _renderShapes: mocks.renderShapes,
    };

    const fake = base as unknown as OICartoInternal;
    return { fake, mocks, map: withMap ? map : null, shapes: () => stored };
}

afterEach(() => {
    document.body.innerHTML = '';
    toastSpy.mockClear();
});

// ============================================================
// Fumée : aucune méthode ne jette quand carte/formes sont absentes
// ============================================================
describe('fumée — DOM/carte/formes absents', () => {
    it('_bindShapeEditGestures ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._bindShapeEditGestures()).not.toThrow();
    });

    it('_shapePointerDown ne jette pas sans feature ciblée', () => {
        const { fake } = makeFakeThis();
        const e = { features: [], lngLat: { lng: 0, lat: 0 }, preventDefault: vi.fn() } as unknown as MapLayerMouseEvent;
        expect(() => fake._shapePointerDown(e)).not.toThrow();
    });

    it('_startShapeGesture ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._startShapeGesture('s1', { lng: 0, lat: 0 })).not.toThrow();
    });

    it('_renderHandles / _clearHandles / toolbar ne jettent pas à vide', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._renderHandles()).not.toThrow();
        expect(() => fake._clearHandles()).not.toThrow();
        expect(() => fake._renderShapeToolbar()).not.toThrow();
        expect(() => fake._clearShapeToolbar()).not.toThrow();
        expect(() => fake._updateShapeToolbarPos()).not.toThrow();
    });

    it('_startPinchGesture ne jette pas sans forme sélectionnée', () => {
        const { fake } = makeFakeThis({ shapes: [] });
        expect(() => fake._startPinchGesture()).not.toThrow();
    });
});

// ============================================================
// _selectShape / _deselectShape
// ============================================================
describe('_selectShape / _deselectShape', () => {
    it('sélectionne : pose _selectedShapeId, rend les poignées (4 pour un rectangle) et la toolbar', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake } = makeFakeThis({ shapes: [rect] });

        fake._selectShape('r1');

        expect(fake._selectedShapeId).toBe('r1');
        expect(fake._handleMarkers).toHaveLength(4);
        expect(fake._shapeToolbarMarker).not.toBeNull();
        expect(fake._pinchListener).not.toBeNull();
    });

    it('ligne → 2 poignées endpoint ; cercle → 2 poignées (edge + move)', () => {
        const line: OiCartoShape = { id: 'l1', type: 'line', color: '#fff', coords: [[0, 0], [2, 2]] };
        const circle: OiCartoShape = { id: 'c1', type: 'circle', color: '#fff', center: [0, 0], edge: [0, 1], coords: [[0, 1]] };
        const { fake } = makeFakeThis({ shapes: [line, circle] });

        fake._selectShape('l1');
        expect(fake._handleMarkers).toHaveLength(2);

        fake._selectShape('c1');
        expect(fake._handleMarkers).toHaveLength(2);
    });

    it("sélectionner une forme INEXISTANTE ne colle pas : _renderHandles désélectionne", () => {
        const { fake } = makeFakeThis({ shapes: [] });
        fake._selectShape('missing');
        expect(fake._selectedShapeId).toBeNull();
    });

    it('désélectionne : purge poignées, toolbar et listener pinch', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, map } = makeFakeThis({ shapes: [rect] });
        fake._selectShape('r1');

        fake._deselectShape();

        expect(fake._selectedShapeId).toBeNull();
        expect(fake._handleMarkers).toEqual([]);
        expect(fake._shapeToolbarMarker).toBeNull();
        expect(fake._pinchListener).toBeNull();
        expect(assertNonNull(map).off).toHaveBeenCalledWith('touchstart', expect.any(Function));
    });

    it("les éléments de poignée ne portent jamais position/inset inline (invariant Marker §5.1)", () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake } = makeFakeThis({ shapes: [rect] });

        fake._selectShape('r1');

        const el = fake._handleMarkers[0]?.getElement();
        expect(el?.style.position).toBe('');
        expect(el?.style.getPropertyValue('inset')).toBe('');
    });
});

// ============================================================
// _shapePointerDown — gardes d'entrée
// ============================================================
describe('_shapePointerDown', () => {
    function makeDownEvent(shapeId: string): MapLayerMouseEvent {
        return {
            features: [{ properties: { shapeId } }],
            lngLat: { lng: 0.5, lat: 0.5 },
            preventDefault: vi.fn(),
            originalEvent: undefined,
        } as unknown as MapLayerMouseEvent;
    }

    it('amorce le geste (désactive le pan, pose les listeners carte + document)', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, map } = makeFakeThis({ shapes: [rect] });

        fake._shapePointerDown(makeDownEvent('r1'));

        const m = assertNonNull(map);
        expect(m.dragPan.disable).toHaveBeenCalledTimes(1);
        expect(m.on).toHaveBeenCalledWith('mousemove', expect.any(Function));
        expect(fake._gesture).not.toBeNull();
    });

    it('outil de dessin actif → aucun geste (priorité au tracé)', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, map } = makeFakeThis({ shapes: [rect] });
        fake.drawTool = 'line';

        fake._shapePointerDown(makeDownEvent('r1'));

        expect(assertNonNull(map).dragPan.disable).not.toHaveBeenCalled();
        expect(fake._gesture).toBeNull();
    });

    it('geste déjà en cours → ignoré', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, map } = makeFakeThis({ shapes: [rect] });
        fake._gesture = { shapeId: 'other' };

        fake._shapePointerDown(makeDownEvent('r1'));

        expect(assertNonNull(map).dragPan.disable).not.toHaveBeenCalled();
    });
});

// ============================================================
// Drag de la forme SÉLECTIONNÉE : poignées/toolbar masquées le temps du
// geste (sinon figées à l'ancienne position, poignée quasi au même point
// que le marker texte → intercepte le pointerdown suivant, cf. shape-edit.ts
// commentaire `gestureDeps.renderShapes`).
// ============================================================
describe('drag de la forme sélectionnée — poignées/toolbar masquées puis restaurées', () => {
    function makeDownEvent(shapeId: string): MapLayerMouseEvent {
        return {
            features: [{ properties: { shapeId } }],
            lngLat: { lng: 0.5, lat: 0.5 },
            preventDefault: vi.fn(),
            originalEvent: undefined,
        } as unknown as MapLayerMouseEvent;
    }

    it('mousemove (drag en cours) sur la forme déjà sélectionnée : purge poignées + toolbar', () => {
        const text: OiCartoShape = { id: 't1', type: 'text', color: '#fff', textColor: '#fff', coords: [[0.5, 0.5]], text: 'X' };
        const { fake, map } = makeFakeThis({ shapes: [text] });
        fake._selectShape('t1'); // poignées + toolbar déjà affichées (sélection précédente)
        expect(fake._handleMarkers.length).toBeGreaterThan(0);
        expect(fake._shapeToolbarMarker).not.toBeNull();

        fake._shapePointerDown(makeDownEvent('t1'));
        const m = assertNonNull(map);
        const onMove = m.on.mock.calls.find(c => c[0] === 'mousemove')?.[1] as (e: unknown) => void;

        // Déplacement au-delà du seuil de drag (6px) : project() = ll*100.
        onMove({ lngLat: { lng: 0.6, lat: 0.6 } });

        expect(fake._gesture?.isDrag).toBe(true);
        expect(fake._handleMarkers).toEqual([]);
        expect(fake._shapeToolbarMarker).toBeNull();
    });

    it('mouseup en fin de drag : poignées + toolbar réapparaissent à la position finale', () => {
        const text: OiCartoShape = { id: 't1', type: 'text', color: '#fff', textColor: '#fff', coords: [[0.5, 0.5]], text: 'X' };
        const { fake, map } = makeFakeThis({ shapes: [text] });
        fake._selectShape('t1');

        fake._shapePointerDown(makeDownEvent('t1'));
        const m = assertNonNull(map);
        const onMove = m.on.mock.calls.find(c => c[0] === 'mousemove')?.[1] as (e: unknown) => void;
        const onUp = m.on.mock.calls.find(c => c[0] === 'mouseup')?.[1] as (e: unknown) => void;

        onMove({ lngLat: { lng: 0.6, lat: 0.6} });
        expect(fake._handleMarkers).toEqual([]);

        onUp({ lngLat: { lng: 0.6, lat: 0.6 } });

        expect(fake._gesture).toBeNull();
        expect(fake._handleMarkers.length).toBeGreaterThan(0); // la poignée textresize revient
        expect(fake._shapeToolbarMarker).not.toBeNull();
    });

    it("tap sans drag (pas de franchissement de seuil) : poignées/toolbar restent affichées sans clignoter", () => {
        const text: OiCartoShape = { id: 't1', type: 'text', color: '#fff', textColor: '#fff', coords: [[0.5, 0.5]], text: 'X' };
        const { fake, map } = makeFakeThis({ shapes: [text] });
        fake._selectShape('t1');

        fake._shapePointerDown(makeDownEvent('t1'));
        const m = assertNonNull(map);
        const onUp = m.on.mock.calls.find(c => c[0] === 'mouseup')?.[1] as (e: unknown) => void;

        onUp({ lngLat: { lng: 0.5, lat: 0.5 } }); // pas de move : tap

        expect(fake._gesture).toBeNull();
        expect(fake._handleMarkers.length).toBeGreaterThan(0);
        expect(fake._shapeToolbarMarker).not.toBeNull();
    });
});

// ============================================================
// Pinch : attache/détache sans fuite
// ============================================================
describe('_attachPinchListeners / _detachPinchListeners', () => {
    it('détache EXACTEMENT le listener posé (même référence), aucun résidu', () => {
        const { fake, map } = makeFakeThis();
        const m = assertNonNull(map);

        fake._attachPinchListeners();
        expect(m.on).toHaveBeenCalledTimes(1);
        const attached = assertNonNull(fake._pinchListener);

        fake._detachPinchListeners();
        expect(m.off).toHaveBeenCalledWith('touchstart', attached);
        expect(fake._pinchListener).toBeNull();
    });

    it('un second attach ne repose pas de listener tant que non détaché', () => {
        const { fake, map } = makeFakeThis();
        fake._attachPinchListeners();
        fake._attachPinchListeners();
        expect(assertNonNull(map).on).toHaveBeenCalledTimes(1);
    });

    it('_startPinchGesture : forme trouvée → désactive pinch-zoom/pan natifs + history', () => {
        const circle: OiCartoShape = { id: 'c1', type: 'circle', color: '#fff', center: [0, 0], edge: [0, 1], coords: [[0, 1]] };
        const { fake, map, mocks } = makeFakeThis({ shapes: [circle], selectedShapeId: 'c1' });

        fake._startPinchGesture();

        const m = assertNonNull(map);
        expect(m.touchZoomRotate.disable).toHaveBeenCalledTimes(1);
        expect(m.dragPan.disable).toHaveBeenCalledTimes(1);
        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// Toolbar flottante : supprimer + couleur
// ============================================================
describe('_renderShapeToolbar — supprimer + couleur', () => {
    it('le bouton supprimer retire la forme (réversible : _pushHistory AVANT), désélectionne et toast', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const other: OiCartoShape = { id: 'r2', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, mocks, shapes } = makeFakeThis({ shapes: [rect, other] });
        fake._selectShape('r1');

        const el = assertNonNull(fake._shapeToolbarMarker).getElement();
        const del = assertNonNull(el.querySelector<HTMLButtonElement>('.oi-carto-shape-toolbar-delete'));
        del.click();

        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
        expect(shapes().map(s => s.id)).toEqual(['r2']);
        expect(fake._selectedShapeId).toBeNull();
        expect(mocks.renderShapes).toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('supprimé'), { kind: 'success' });
    });

    it('un swatch couleur re-colore la forme sélectionnée (avec _pushHistory)', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, mocks, shapes } = makeFakeThis({ shapes: [rect] });
        fake._selectShape('r1');

        const el = assertNonNull(fake._shapeToolbarMarker).getElement();
        const blue = assertNonNull(el.querySelector<HTMLButtonElement>('.oi-carto-draw-color-blue'));
        blue.click();

        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
        expect(shapes()[0]?.color).toBe('#3b82f6');
        expect(mocks.renderShapes).toHaveBeenCalled();
        // La forme reste sélectionnée (édition enchaînable)
        expect(fake._selectedShapeId).toBe('r1');
    });

    it('la toolbar expose les 5 couleurs du dock + le bouton supprimer', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake } = makeFakeThis({ shapes: [rect] });
        fake._selectShape('r1');

        const el = assertNonNull(fake._shapeToolbarMarker).getElement();
        expect(el.querySelectorAll('.oi-carto-draw-color')).toHaveLength(5);
        expect(el.querySelectorAll('.oi-carto-shape-toolbar-delete')).toHaveLength(1);
        // Invariant Marker §5.1 : pas de position/inset inline
        expect(el.style.position).toBe('');
        expect(el.style.getPropertyValue('inset')).toBe('');
    });
});

// ============================================================
// Désélection : clic ailleurs + Échap (câblage _bindShapeEditGestures)
// ============================================================
describe('_bindShapeEditGestures — désélection', () => {
    it('clic carte sans forme sous le pointeur → désélectionne', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, map } = makeFakeThis({ shapes: [rect] });
        const m = assertNonNull(map);
        fake._bindShapeEditGestures();
        fake._selectShape('r1');

        // Récupère le handler `click` global posé par le câblage
        const clickCall = m.on.mock.calls.find(c => c[0] === 'click' && typeof c[1] === 'function');
        const onClick = assertNonNull(clickCall)[1] as (e: unknown) => void;
        m.queryRenderedFeatures.mockReturnValue([]);
        onClick({ point: { x: 10, y: 10 } });

        expect(fake._selectedShapeId).toBeNull();
    });

    it('clic carte SUR une forme → ne désélectionne pas (le clic couche gère la sélection)', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake, map } = makeFakeThis({ shapes: [rect] });
        const m = assertNonNull(map);
        fake._bindShapeEditGestures();
        fake._selectShape('r1');

        const clickCall = m.on.mock.calls.find(c => c[0] === 'click' && typeof c[1] === 'function');
        const onClick = assertNonNull(clickCall)[1] as (e: unknown) => void;
        m.queryRenderedFeatures.mockReturnValue([{ properties: { shapeId: 'r1' } }]);
        onClick({ point: { x: 10, y: 10 } });

        expect(fake._selectedShapeId).toBe('r1');
    });

    it('Échap → désélectionne (et preventDefault pour ne pas fermer la modale)', () => {
        const rect: OiCartoShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: RECT_COORDS };
        const { fake } = makeFakeThis({ shapes: [rect] });
        fake._bindShapeEditGestures();
        fake._selectShape('r1');

        const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        document.dispatchEvent(ev);

        expect(fake._selectedShapeId).toBeNull();
        expect(ev.defaultPrevented).toBe(true);
    });
});

// ============================================================
// Mesures/anneaux commités : sélectionnables au clic, supprimables via
// toolbar — PAS de move/resize générique (parité PC-Tac : annotation
// lecture seule pour la géométrie, cf. `carto/shape-edit.ts::_shapePointerDown`).
// ============================================================
describe('_shapePointerDown — mesures/anneaux : clic-sélection sans drag', () => {
    function makeDownEvent(shapeId: string): MapLayerMouseEvent {
        return {
            features: [{ properties: { shapeId } }],
            lngLat: { lng: 0.5, lat: 0.5 },
            preventDefault: vi.fn(),
            originalEvent: undefined,
        } as unknown as MapLayerMouseEvent;
    }

    it("type 'measure' : mousedown n'amorce PAS de geste (le clic gère la sélection)", () => {
        const measure: OiCartoShape = { id: 'm1', type: 'measure', color: '#ef4444', coords: [[0, 0], [1, 1]], totalM: 100 };
        const { fake, map } = makeFakeThis({ shapes: [measure] });

        fake._shapePointerDown(makeDownEvent('m1'));

        expect(assertNonNull(map).dragPan.disable).not.toHaveBeenCalled();
        expect(fake._gesture).toBeNull();
    });

    it("type 'measure-rings' : mousedown n'amorce PAS de geste", () => {
        const rings: OiCartoShape = {
            id: 'ring1', type: 'measure-rings', color: '#ef4444', coords: [],
            center: [0, 0], rings: [{ radiusM: 50, coords: [[0, 1]] }],
        };
        const { fake, map } = makeFakeThis({ shapes: [rings] });

        fake._shapePointerDown(makeDownEvent('ring1'));

        expect(assertNonNull(map).dragPan.disable).not.toHaveBeenCalled();
        expect(fake._gesture).toBeNull();
    });

    it("type 'line' (contrôle) : mousedown amorce bien le geste normalement", () => {
        const line: OiCartoShape = { id: 'l1', type: 'line', color: '#fff', coords: [[0, 0], [1, 1]] };
        const { fake, map } = makeFakeThis({ shapes: [line] });

        fake._shapePointerDown(makeDownEvent('l1'));

        expect(assertNonNull(map).dragPan.disable).toHaveBeenCalledTimes(1);
        expect(fake._gesture).not.toBeNull();
    });
});

describe('_selectShape — mesures/anneaux : toolbar sans poignées', () => {
    it("type 'measure' sélectionnée : toolbar (couleur+supprimer) mais AUCUNE poignée", () => {
        const measure: OiCartoShape = { id: 'm1', type: 'measure', color: '#ef4444', coords: [[0, 0], [1, 1]], totalM: 100 };
        const { fake } = makeFakeThis({ shapes: [measure] });

        fake._selectShape('m1');

        expect(fake._handleMarkers).toHaveLength(0);
        expect(fake._shapeToolbarMarker).not.toBeNull();
    });

    it("type 'measure-rings' : ancre/centroïde de la toolbar = `s.center` (coords vide, pas [0,0])", () => {
        const rings: OiCartoShape = {
            id: 'ring1', type: 'measure-rings', color: '#ef4444', coords: [],
            center: [2, 3], rings: [{ radiusM: 50, coords: [[2, 4]] }],
        };
        const { fake } = makeFakeThis({ shapes: [rings] });

        fake._selectShape('ring1');

        const ll = assertNonNull(fake._shapeToolbarMarker).getLngLat() as unknown as [number, number];
        expect(ll).toEqual([2, 3]);
    });

    it('le bouton supprimer retire la mesure sélectionnée (toolbar générique, aucun code dédié)', () => {
        const measure: OiCartoShape = { id: 'm1', type: 'measure', color: '#ef4444', coords: [[0, 0], [1, 1]], totalM: 100 };
        const { fake, shapes } = makeFakeThis({ shapes: [measure] });
        fake._selectShape('m1');

        const el = assertNonNull(fake._shapeToolbarMarker).getElement();
        const del = assertNonNull(el.querySelector<HTMLButtonElement>('.oi-carto-shape-toolbar-delete'));
        del.click();

        expect(shapes()).toHaveLength(0);
        expect(fake._selectedShapeId).toBeNull();
    });
});

describe('_renderShapeToolbar — texte : bouton "modifier" + synchro textColor', () => {
    it("type 'text' sélectionné : la toolbar expose un bouton édition en plus de couleur/supprimer", () => {
        const text: OiCartoShape = { id: 't1', type: 'text', color: '#fff', textColor: '#fff', coords: [[0, 0]], text: 'X' };
        const { fake } = makeFakeThis({ shapes: [text] });
        fake._selectShape('t1');

        const el = assertNonNull(fake._shapeToolbarMarker).getElement();
        expect(el.querySelectorAll('.oi-carto-shape-toolbar-edit')).toHaveLength(1);
    });

    it("type 'line' (contrôle) : pas de bouton édition", () => {
        const line: OiCartoShape = { id: 'l1', type: 'line', color: '#fff', coords: [[0, 0], [1, 1]] };
        const { fake } = makeFakeThis({ shapes: [line] });
        fake._selectShape('l1');

        const el = assertNonNull(fake._shapeToolbarMarker).getElement();
        expect(el.querySelectorAll('.oi-carto-shape-toolbar-edit')).toHaveLength(0);
    });

    it("un swatch couleur sur un texte met aussi à jour `textColor` (parité PC-Tac color===textColor)", () => {
        const text: OiCartoShape = { id: 't1', type: 'text', color: '#ffffff', textColor: '#ffffff', coords: [[0, 0]], text: 'X' };
        const { fake, shapes } = makeFakeThis({ shapes: [text] });
        fake._selectShape('t1');

        const el = assertNonNull(fake._shapeToolbarMarker).getElement();
        const blue = assertNonNull(el.querySelector<HTMLButtonElement>('.oi-carto-draw-color-blue'));
        blue.click();

        expect(shapes()[0]).toMatchObject({ color: '#3b82f6', textColor: '#3b82f6' });
    });
});
