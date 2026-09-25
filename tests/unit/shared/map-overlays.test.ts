/**
 * map-overlays.test.ts — Tracé du carroyage à l'orientation de l'écran
 * (décision 39, G2). Un faux map MapLibre reprojette avec une rotation
 * (bearing) cohérente avec `metersPerDegree` : à bearing 0 on doit retrouver le
 * comportement historique (rectangle calé nord-sud), à bearing non nul le
 * rectangle glissé à l'écran devient un carroyage ORIENTÉ, colonnes parallèles
 * aux bords de l'écran, A1 au coin haut-gauche.
 */
import { describe, expect, it, vi } from 'vitest';
import { createMapOverlays } from '@shared/map-overlays.js';
import { geoToGrid, gridToGeo, metersPerDegree, type TacticalGridSpec } from '@shared/tactical-grid.js';

const CENTER_LAT = 47.9;
const CENTER_LNG = 1.9;

interface FakeMap {
    [k: string]: unknown;
}

/** Faux map : 1 px = 1 m au centre, rotation au bearing voulu. */
function makeRotatingMap(bearing: number): { map: FakeMap; project: (p: [number, number]) => { x: number; y: number }; unproject: (p: [number, number]) => { lng: number; lat: number }; emit: (type: string, ev: unknown) => void } {
    const m = metersPerDegree(CENTER_LAT);
    const b = (bearing * Math.PI) / 180;
    const ca = Math.cos(b);
    const sa = Math.sin(b);
    const cx = 400;
    const cy = 300;
    const project = ([lng, lat]: [number, number]): { x: number; y: number } => {
        const E = (lng - CENTER_LNG) * m.lon;
        const N = (lat - CENTER_LAT) * m.lat;
        return { x: E * ca - N * sa + cx, y: -E * sa - N * ca + cy };
    };
    const unproject = ([x, y]: [number, number]): { lng: number; lat: number } => {
        const dx = x - cx;
        const dy = y - cy;
        // Inverse de la rotation écran → géo (matrice involutive).
        const E = dx * ca - dy * sa;
        const N = -dx * sa - dy * ca;
        return { lng: CENTER_LNG + E / m.lon, lat: CENTER_LAT + N / m.lat };
    };
    const listeners = new Map<string, Array<(ev: unknown) => void>>();
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const canvas = {
        style: { cursor: '' },
        clientWidth: 800,
        clientHeight: 600,
        width: 800,
        height: 600,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    };
    const map: FakeMap = {
        getCanvas: () => canvas,
        project: (ll: { lng: number; lat: number }) => project([ll.lng, ll.lat]),
        unproject: (p: [number, number]) => unproject(p),
        getBearing: () => bearing,
        getZoom: () => 17,
        loaded: () => true,
        getBounds: () => ({ getWest: () => 1.89, getSouth: () => 47.89, getEast: () => 1.91, getNorth: () => 47.91 }),
        on: (type: string, fn: (ev: unknown) => void) => { const a = listeners.get(type) ?? []; a.push(fn); listeners.set(type, a); return map; },
        off: () => map,
        getSource: (id: string) => sources.get(id),
        addSource: (id: string) => { sources.set(id, { setData: vi.fn() }); },
        addLayer: vi.fn(),
        getLayer: () => undefined,
        setLayoutProperty: vi.fn(),
        setPaintProperty: vi.fn(),
        hasImage: () => false,
        addImage: vi.fn(),
        dragPan: { enable: vi.fn(), disable: vi.fn(), isEnabled: () => true },
    };
    const emit = (type: string, ev: unknown): void => {
        for (const fn of listeners.get(type) ?? []) fn(ev);
    };
    return { map, project, unproject, emit };
}

function drag(helper: ReturnType<typeof makeRotatingMap>, a: [number, number], b: [number, number]): void {
    const p0 = helper.unproject(a);
    const p1 = helper.unproject(b);
    helper.emit('mousedown', { lngLat: p0, point: { x: a[0], y: a[1] } });
    helper.emit('mousemove', { lngLat: p1, point: { x: b[0], y: b[1] } });
    helper.emit('mouseup', { lngLat: p1, point: { x: b[0], y: b[1] } });
}

function makeApi(helper: ReturnType<typeof makeRotatingMap>, toast: (message: string, kind?: 'info' | 'success' | 'error') => void) {
    return createMapOverlays(helper.map as never, {
        load: () => ({ gridOn: true, cellM: 50 }),
        save: () => { /* test */ },
        toast,
        confirm: async () => true,
    });
}

describe('tracé du carroyage à l’orientation de l’écran', () => {
    it('carte au nord (bearing 0) : A1 au coin haut-gauche, colonnes vers l’est', async () => {
        const helper = makeRotatingMap(0);
        const api = makeApi(helper, vi.fn());
        await api.startGridDraw();
        drag(helper, [100, 100], [300, 250]);
        const spec = api.state.grid as TacticalGridSpec;
        expect(spec).not.toBeNull();
        expect(spec.angle).toBe(0);
        expect([spec.cols, spec.rows]).toEqual([4, 3]);
        const a1 = gridToGeo(spec, 0, 0);
        expect(a1[0]).toBeCloseTo(helper.unproject([100, 100]).lng, 9);
        expect(a1[1]).toBeCloseTo(helper.unproject([100, 100]).lat, 9);
        // Colonnes vers +x écran (est), rangées vers +y écran (sud).
        const right = helper.project(gridToGeo(spec, 1, 0));
        expect(right.y).toBeCloseTo(100, 2);
        expect(right.x).toBeCloseTo(150, 2);
    });

    it('carte tournée (bearing 30°) : le carroyage prend l’orientation de l’écran', async () => {
        const helper = makeRotatingMap(30);
        const api = makeApi(helper, vi.fn());
        await api.startGridDraw();
        drag(helper, [100, 100], [300, 250]);
        const spec = api.state.grid as TacticalGridSpec;
        expect(spec.angle).toBe(30);
        // A1 au coin haut-gauche À L'ÉCRAN du rectangle glissé.
        const a1 = gridToGeo(spec, 0, 0);
        const tl = helper.unproject([100, 100]);
        expect(a1[0]).toBeCloseTo(tl.lng, 9);
        expect(a1[1]).toBeCloseTo(tl.lat, 9);
        // L'axe des colonnes (grid +x) est horizontal À L'ÉCRAN.
        const p0 = helper.project(gridToGeo(spec, 0, 0));
        const pr = helper.project(gridToGeo(spec, 1, 0));
        const pd = helper.project(gridToGeo(spec, 0, 1));
        expect(pr.y).toBeCloseTo(p0.y, 2);
        expect(pr.x - p0.x).toBeCloseTo(50, 2); // une maille de 50 m ≈ 50 px
        expect(pd.x).toBeCloseTo(p0.x, 2);
        expect(pd.y - p0.y).toBeCloseTo(50, 2);
    });

    it('« Déplacer » et changement de maille conservent l’angle', async () => {
        const helper = makeRotatingMap(30);
        const api = makeApi(helper, vi.fn());
        await api.startGridDraw();
        drag(helper, [100, 100], [300, 250]);
        const before = api.state.grid as TacticalGridSpec;
        api.startGridMove();
        const target = helper.unproject([500, 400]);
        helper.emit('mousedown', { lngLat: target, point: { x: 500, y: 400 } });
        helper.emit('mouseup', { lngLat: target, point: { x: 500, y: 400 } });
        const moved = api.state.grid as TacticalGridSpec;
        expect(moved.angle).toBe(before.angle);
        expect(moved.west).toBeCloseTo(target.lng, 9);
        await api.setCellSize(100);
        const resized = api.state.grid as TacticalGridSpec;
        expect(resized.angle).toBe(before.angle);
        expect(resized.cellM).toBe(100);
        // Même emprise physique, donc deux fois moins de cases.
        expect(resized.cols).toBe(2);
        expect(resized.rows).toBe(2);
    });

    it('« Sur la vue » pose un carroyage orienté comme la carte', async () => {
        const helper = makeRotatingMap(90);
        const api = makeApi(helper, vi.fn());
        await api.placeGridOnView();
        const spec = api.state.grid as TacticalGridSpec;
        expect(spec.angle).toBe(90);
        const tl = helper.unproject([800 * 0.2, 600 * 0.2]);
        const a1 = gridToGeo(spec, 0, 0);
        expect(a1[0]).toBeCloseTo(tl.lng, 9);
        expect(a1[1]).toBeCloseTo(tl.lat, 9);
        // Le repère de la case est bien tourné : geoToGrid(A1) = (0,0).
        const g = geoToGrid(spec, a1[0], a1[1]);
        expect(g.x).toBeCloseTo(0, 9);
        expect(g.y).toBeCloseTo(0, 9);
    });
});
