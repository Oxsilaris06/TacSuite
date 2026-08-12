/**
 * oi-carto-measure.test.ts — Tests du paquet `oi-carto-measure` (`carto/measure.ts`),
 * portage de l'UX PC-Tac (`@pctac/planmap/measure.ts`). `this` FACTICE (pattern
 * `oi-carto-draw.test.ts`), seules les dépendances externes au groupe (`_loadShapes`/
 * `_saveShapes`/`_pushHistory`/`_refreshUndoRedoButtons`/`_showHint`/`_hideHint`/`_safe`)
 * sont mockées.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// FakeMarker : évite `_getUIString`/internes réels de `maplibregl.Map`
// (jamais fournis par un faux `map` minimal sous jsdom) — même technique que
// `oi-carto-pins.test.ts`.
vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        private _lngLat: { lng: number; lat: number };
        constructor(opts: { element?: HTMLElement } = {}) {
            this._element = opts.element ?? document.createElement('div');
            this._lngLat = { lng: 0, lat: 0 };
            if (this._element.parentElement === null) document.body.appendChild(this._element);
        }
        setLngLat(ll: { lng: number; lat: number }): this { this._lngLat = ll; return this; }
        getLngLat(): { lng: number; lat: number } { return this._lngLat; }
        addTo(): this { return this; }
        remove(): this { this._element.remove(); return this; }
        getElement(): HTMLElement { return this._element; }
    }
    return { default: { Marker: FakeMarker } };
});

import { MeasureMethods } from '../../../src/apps/oi/carto/measure.js';
import type { LngLatTuple, OICartoInternal, OiCartoShape } from '../../../src/apps/oi/carto/types.js';

function makeFakeMap() {
    return {
        getCenter: vi.fn(() => ({ lng: 2.0, lat: 48.0 })),
        getSource: vi.fn(() => ({ setData: vi.fn() })),
        addSource: vi.fn(),
        addLayer: vi.fn(),
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

function makeFakeState(map: FakeMap | null): OICartoInternal {
    let shapesStore: OiCartoShape[] = [];
    const state = {
        map,
        drawColor: '#ef4444',
        _measureState: null,
        _measureLabelMarkers: [],
        _committedMeasureMarkers: [],
        _measureControls: null,
        _measureUndoBtn: null,

        ...MeasureMethods,

        _safe: (fn: (...a: unknown[]) => unknown) => fn,
        _loadShapes: vi.fn((): OiCartoShape[] => shapesStore),
        _saveShapes: vi.fn((list: readonly OiCartoShape[]) => { shapesStore = [...list]; }),
        _pushHistory: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
        _showHint: vi.fn(),
        _hideHint: vi.fn(),
    };
    return state as unknown as OICartoInternal;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('_toggleMeasure', () => {
    it('active puis désactive le mode mesure', () => {
        const state = makeFakeState(makeFakeMap());
        expect(state._measureState).toBeNull();

        state._toggleMeasure();
        expect(state._measureState).not.toBeNull();
        expect(state._measureState?.vertices).toEqual([]);

        state._toggleMeasure();
        expect(state._measureState).toBeNull();
    });
});

describe('_measureAddVertex — accumulation de distance', () => {
    it('cumule la distance sur 2 segments (mesure finalisée = shape persisté)', () => {
        const state = makeFakeState(makeFakeMap());
        state._toggleMeasure();

        const a: LngLatTuple = [2.0, 48.0];
        const b: LngLatTuple = [2.0, 48.01]; // ~1112 m plein nord
        const c: LngLatTuple = [2.0, 48.02]; // encore ~1112 m plein nord
        state._measureAddVertex(a);
        state._measureAddVertex(b);
        state._measureAddVertex(c);
        state._finishMeasure();

        const shapes = state._loadShapes();
        expect(shapes).toHaveLength(1);
        const shape = shapes[0]!;
        expect(shape.type).toBe('measure');
        expect(shape.coords).toEqual([a, b, c]);
        expect(shape.totalM).toBeGreaterThan(2000);
        expect(shape.totalM).toBeLessThan(2300);
        // Mode mesure quitté après validation.
        expect(state._measureState).toBeNull();
    });
});

describe('_trueBearing (via étiquettes de segment) — azimut connu entre 2 points', () => {
    it('point B plein Est de A → azimut ≈ 90°', () => {
        const state = makeFakeState(makeFakeMap());
        state._toggleMeasure();
        const a: LngLatTuple = [2.0, 48.0];
        const b: LngLatTuple = [2.02, 48.0]; // même latitude, lng+ → plein Est
        state._measureAddVertex(a);
        state._measureAddVertex(b);
        state._finishMeasure();

        const label = document.querySelector('.oi-carto-measure-label span');
        expect(label?.textContent).toContain('090°');
    });

    it('point B plein Nord de A → azimut ≈ 000°', () => {
        const state = makeFakeState(makeFakeMap());
        state._toggleMeasure();
        const a: LngLatTuple = [2.0, 48.0];
        const b: LngLatTuple = [2.0, 48.02]; // même longitude, lat+ → plein Nord
        state._measureAddVertex(a);
        state._measureAddVertex(b);
        state._finishMeasure();

        const label = document.querySelector('.oi-carto-measure-label span');
        expect(label?.textContent).toContain('000°');
    });
});

describe('_cancelMeasure / reset', () => {
    it('annule sans persister de shape, réinitialise l\'état', () => {
        const state = makeFakeState(makeFakeMap());
        state._toggleMeasure();
        state._measureAddVertex([2.0, 48.0]);
        state._measureAddVertex([2.0, 48.01]);

        state._cancelMeasure();

        expect(state._measureState).toBeNull();
        expect(state._loadShapes()).toHaveLength(0);
    });
});

describe('_addEngagementRings', () => {
    it('persiste un shape measure-rings avec 3 rayons (50/100/200 m)', () => {
        const state = makeFakeState(makeFakeMap());
        state._addEngagementRings([2.0, 48.0]);

        const shapes = state._loadShapes();
        expect(shapes).toHaveLength(1);
        const shape = shapes[0]!;
        expect(shape.type).toBe('measure-rings');
        expect(shape.center).toEqual([2.0, 48.0]);
        expect(shape.rings?.map((r) => r.radiusM)).toEqual([50, 100, 200]);
        expect(shape.coords).toEqual([]);
    });
});
