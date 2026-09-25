/**
 * pm-tabsync-plan.test.ts — Onglets synchronisés sur le plan (décision 29, C8).
 * ===========================================================================
 *
 * Sur `pctac:data` distant d'une clé du plan (points, formes, carroyage ; PAS
 * la vue), l'état est relu du stockage et repeint. Un geste en cours diffère le
 * rechargement ; à sa fin, l'état est relu PUIS le geste appliqué PUIS écrit →
 * les ajouts de l'autre onglet sont conservés, le dernier geste gagne par objet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _lngLat = { lng: 0, lat: 0 };
        private _listeners = new Map<string, () => void>();
        constructor() { /* options (élément) ignorées */ }
        setLngLat(ll: { lng: number; lat: number }): this { this._lngLat = ll; return this; }
        getLngLat(): { lng: number; lat: number } { return this._lngLat; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return document.createElement('div'); }
        setOffset(): this { return this; }
        setDraggable(): this { return this; }
        on(type: string, cb: () => void): this { this._listeners.set(type, cb); return this; }
        _fire(type: string): void { this._listeners.get(type)?.(); }
    }
    class FakeLngLatBounds { extend(): this { return this; } }
    return { default: { Marker: FakeMarker, LngLatBounds: FakeLngLatBounds } };
});

import { PINS_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { GeoMethods } from '../../../src/apps/pctac/planmap/geo.js';
import { MapCoreMethods } from '../../../src/apps/pctac/planmap/map-core.js';
import { PinsMethods } from '../../../src/apps/pctac/planmap/pins.js';
import { SafeMethods, createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PlanMapInternal, PlanPin } from '../../../src/apps/pctac/planmap/types.js';

function makePin(over: Partial<PlanPin> = {}): PlanPin {
    return { id: 'p1', lng: 2.35, lat: 48.85, label: 'A', color: '#f55', kind: 'libre', ...over };
}

const mapStub = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };

function makeFakeThis(over: Partial<PlanMapInternal> = {}): PlanMapInternal {
    const state = createPlanMapState();
    return {
        ...state,
        ...SafeMethods,
        ...GeoMethods,
        ...MapCoreMethods,
        ...PinsMethods,
        map: mapStub as unknown as PlanMapInternal['map'],
        overlays: { reload: vi.fn() } as unknown as PlanMapInternal['overlays'],
        _setTool: vi.fn(),
        _selectShape: vi.fn(),
        _clearPreview: vi.fn(),
        _pushHistory: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
        _renderShapes: vi.fn(),
        ...over,
    } as unknown as PlanMapInternal;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('_onRemotePlanData — recharger, sauf pendant un geste', () => {
    it('clé des points sans geste : rechargement immédiat', () => {
        const reload = vi.fn();
        const fake = makeFakeThis({ _reloadPlanFromStorage: reload });
        fake._onRemotePlanData(PINS_KEY);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(fake._pendingRemoteReload).toBe(false);
    });

    it('la VUE n’est jamais synchronisée', () => {
        const reload = vi.fn();
        const fake = makeFakeThis({ _reloadPlanFromStorage: reload });
        fake._onRemotePlanData('pcTacPlanView');
        expect(reload).not.toHaveBeenCalled();
    });

    it('geste en cours (tracé) : rechargement différé, puis rejoué à la fin', () => {
        const reload = vi.fn();
        const fake = makeFakeThis({ _reloadPlanFromStorage: reload, drawState: { start: [0, 0], current: [1, 1] } });
        fake._onRemotePlanData(PINS_KEY);
        expect(reload).not.toHaveBeenCalled();
        expect(fake._pendingRemoteReload).toBe(true);

        fake.drawState = null;
        fake._flushPendingRemoteReload();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(fake._pendingRemoteReload).toBe(false);
    });

    it('glisser d’un point en cours : différé jusqu’au relâcher', () => {
        const reload = vi.fn();
        const fake = makeFakeThis({ _reloadPlanFromStorage: reload, _pinDragging: true });
        fake._onRemotePlanData(PINS_KEY);
        expect(reload).not.toHaveBeenCalled();
        fake._pinDragging = false;
        fake._flushPendingRemoteReload();
        expect(reload).toHaveBeenCalledTimes(1);
    });
});

describe('point ajouté ailleurs visible ici', () => {
    it('un rechargement distant remet le marqueur du point ajouté', () => {
        const fake = makeFakeThis();
        fake._savePins([makePin({ id: 'a' })]);
        fake._renderPins();
        expect(fake._pinMarkers?.has('a')).toBe(true);

        // Un autre onglet ajoute « b » : on le simule en écrivant puis en
        // annonçant le changement.
        fake._savePins([...fake._loadPins(), makePin({ id: 'b' })]);
        fake._onRemotePlanData(PINS_KEY);

        expect(fake._pinMarkers?.has('b')).toBe(true);
    });
});

describe('le dernier geste gagne par objet (relire PUIS appliquer PUIS écrire)', () => {
    function entryFor(fake: PlanMapInternal, id: string): {
        pinMarker: unknown;
    } {
        const entry = fake._pinMarkers?.get(id);
        if (!entry) throw new Error('entrée absente');
        return { pinMarker: entry.pinMarker };
    }

    it('point déplacé ici pendant qu’un autre est ajouté ailleurs : les deux sont gardés', () => {
        const fake = makeFakeThis();
        fake._savePins([makePin({ id: 'a', lng: 1, lat: 1 })]);
        fake._renderPins();
        const entry = entryFor(fake, 'a');
        const marker = entry.pinMarker as { setLngLat: (ll: { lng: number; lat: number }) => void; _fire: (t: string) => void };

        marker._fire('dragstart');
        expect(fake._pinDragging).toBe(true);
        // L'autre onglet ajoute « b » PENDANT le glisser.
        fake._savePins([...fake._loadPins(), makePin({ id: 'b', lng: 5, lat: 5 })]);
        fake._onRemotePlanData(PINS_KEY); // différé (geste en cours)
        expect(fake._pendingRemoteReload).toBe(true);

        marker.setLngLat({ lng: 2.5, lat: 48.9 });
        marker._fire('dragend');

        const pins = fake._loadPins();
        expect(pins.map((p) => p.id).sort()).toEqual(['a', 'b']);
        expect(pins.find((p) => p.id === 'a')?.lng).toBe(2.5);
        expect(pins.find((p) => p.id === 'b')?.lng).toBe(5);
    });

    it('même point déplacé des deux côtés : le dernier geste (le nôtre) gagne', () => {
        const fake = makeFakeThis();
        fake._savePins([makePin({ id: 'a', lng: 1, lat: 1 })]);
        fake._renderPins();
        const marker = entryFor(fake, 'a').pinMarker as { setLngLat: (ll: { lng: number; lat: number }) => void; _fire: (t: string) => void };

        marker._fire('dragstart');
        // L'autre onglet a déplacé « a » en (9, 9) pendant notre geste.
        fake._savePins([{ ...makePin({ id: 'a' }), lng: 9, lat: 9 }]);

        marker.setLngLat({ lng: 2.5, lat: 48.9 });
        marker._fire('dragend');

        const a = fake._loadPins().find((p) => p.id === 'a');
        expect(a?.lng).toBe(2.5);
        expect(a?.lat).toBe(48.9);
    });
});
