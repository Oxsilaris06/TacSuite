/**
 * map-overlays.test.ts — Tracé du carroyage à l'orientation de l'écran
 * (décision 39, G2). Un faux map MapLibre reprojette avec une rotation
 * (bearing) cohérente avec `metersPerDegree` : à bearing 0 on doit retrouver le
 * comportement historique (rectangle calé nord-sud), à bearing non nul le
 * rectangle glissé à l'écran devient un carroyage ORIENTÉ, colonnes parallèles
 * aux bords de l'écran, A1 au coin haut-gauche.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        private _lngLat: unknown = null;
        constructor(opts: { element?: HTMLElement } = {}) { this._element = opts.element ?? document.createElement('div'); }
        setLngLat(ll: unknown): this { this._lngLat = ll; return this; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return this._element; }
        getLngLat(): unknown { return this._lngLat; }
    }
    (globalThis as { __fakeMarkers?: FakeMarker[] }).__fakeMarkers = [];
    class RecordingMarker extends FakeMarker {
        constructor(opts: { element?: HTMLElement } = {}) { super(opts); (globalThis as { __fakeMarkers?: FakeMarker[] }).__fakeMarkers?.push(this); }
    }
    return { Marker: RecordingMarker, default: { Marker: RecordingMarker } };
});

import { createMapOverlays, gridAngleFromScreen, mountOverlayControls, overlayLayers, overlayLegend, snapGridAngle, type MapOverlays } from '@shared/map-overlays.js';
import { GRID_COLORS, geoToGrid, gridToGeo, makeOrientedGrid, metersPerDegree, type TacticalGridSpec } from '@shared/tactical-grid.js';

const CENTER_LAT = 47.9;
const CENTER_LNG = 1.9;

interface FakeMap {
    [k: string]: unknown;
}

/** Faux map : 1 px = 1 m au centre, rotation au bearing voulu. */
function makeRotatingMap(bearing: number): { map: FakeMap; project: (p: [number, number]) => { x: number; y: number }; unproject: (p: [number, number]) => { lng: number; lat: number }; emit: (type: string, ev: unknown) => void; paint: ReturnType<typeof vi.fn>; layout: ReturnType<typeof vi.fn> } {
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
    const paint = vi.fn();
    const layout = vi.fn();
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
        setLayoutProperty: layout,
        setPaintProperty: paint,
        hasImage: () => false,
        addImage: vi.fn(),
        dragPan: { enable: vi.fn(), disable: vi.fn(), isEnabled: () => true },
    };
    const emit = (type: string, ev: unknown): void => {
        for (const fn of listeners.get(type) ?? []) fn(ev);
    };
    return { map, project, unproject, emit, paint, layout };
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

function fakeMarkers(): Array<{ getElement(): HTMLElement }> {
    return (globalThis as { __fakeMarkers?: Array<{ getElement(): HTMLElement }> }).__fakeMarkers ?? [];
}

function emitPointer(type: string, x: number, y: number): void {
    document.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

describe('rotation du carroyage (décision 39, G3)', () => {
    it('angle depuis un pointeur écran, aimanté tous les 5°', () => {
        const center = { x: 100, y: 100 };
        // Pointeur à droite du centre, carte au nord → 90°.
        expect(snapGridAngle(gridAngleFromScreen(0, center, { x: 200, y: 100 }))).toBe(90);
        // Carte déjà tournée de 30° : le nord géo (0°) est à −30° à l'écran.
        expect(snapGridAngle(gridAngleFromScreen(30, center, { x: 50, y: 13 }))).toBe(0);
        // 47° → 45°.
        expect(snapGridAngle(gridAngleFromScreen(0, center, { x: 170, y: 30 }))).toBe(45);
        // 0°/360° : jamais 360.
        expect(snapGridAngle(359.9)).toBe(0);
    });

    it('la poignée tourne autour du centre, se cale au 5°, et enregistre au relâcher', async () => {
        const helper = makeRotatingMap(0);
        const toast = vi.fn();
        const api = makeApi(helper, toast);
        await api.placeGridOnView();
        const before = api.state.grid as TacticalGridSpec;
        const centerGeo = gridToGeo(before, before.cols / 2, before.rows / 2);
        const centerPx = helper.project(centerGeo);

        await api.startGridRotate();
        const el = fakeMarkers().at(-1)?.getElement();
        expect(el).toBeTruthy();
        el!.dispatchEvent(new MouseEvent('pointerdown', { clientX: centerPx.x + 90, clientY: centerPx.y, bubbles: true }));
        // Direction ~47° (haut-droite) → aimant 45°.
        emitPointer('pointermove', centerPx.x + 70, centerPx.y - 66);
        emitPointer('pointerup', centerPx.x + 70, centerPx.y - 66);

        const after = api.state.grid as TacticalGridSpec;
        expect(after.angle).toBe(45);
        const centerAfter = gridToGeo(after, after.cols / 2, after.rows / 2);
        expect(centerAfter[0]).toBeCloseTo(centerGeo[0], 9);
        expect(centerAfter[1]).toBeCloseTo(centerGeo[1], 9);
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('orienté à 45°'), 'success');
    });

    it('Échap pendant la rotation : rien ne change', async () => {
        const helper = makeRotatingMap(0);
        const api = makeApi(helper, vi.fn());
        await api.placeGridOnView();
        const before = api.state.grid as TacticalGridSpec;
        await api.startGridRotate();
        const el = fakeMarkers().at(-1)!.getElement();
        const centerPx = helper.project(gridToGeo(before, before.cols / 2, before.rows / 2));
        el.dispatchEvent(new MouseEvent('pointerdown', { clientX: centerPx.x + 90, clientY: centerPx.y, bubbles: true }));
        emitPointer('pointermove', centerPx.x + 70, centerPx.y - 66);
        expect((api.state.grid as TacticalGridSpec).angle).toBe(45);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect((api.state.grid as TacticalGridSpec).angle).toBe(before.angle);
    });

    it('« Nord en haut » remet l’angle à 0 autour du centre', async () => {
        const helper = makeRotatingMap(30);
        const api = makeApi(helper, vi.fn());
        await api.startGridDraw();
        drag(helper, [100, 100], [300, 250]);
        const before = api.state.grid as TacticalGridSpec;
        const centerGeo = gridToGeo(before, before.cols / 2, before.rows / 2);
        api.gridNorthUp();
        const after = api.state.grid as TacticalGridSpec;
        expect(after.angle).toBe(0);
        const centerAfter = gridToGeo(after, after.cols / 2, after.rows / 2);
        expect(centerAfter[0]).toBeCloseTo(centerGeo[0], 9);
        expect(centerAfter[1]).toBeCloseTo(centerGeo[1], 9);
    });
});

describe('couleur et taille du carroyage (décision 39, G4)', () => {
    it('un liseré sombre encadre lignes et aperçu', () => {
        const ids = overlayLayers(false).map((l) => l.id);
        expect(ids).toContain('tac-grid-casing');
        expect(ids).toContain('tac-grid-preview-casing');
        // Le liseré est AVANT la ligne colorée (dessous).
        expect(ids.indexOf('tac-grid-casing')).toBeLessThan(ids.indexOf('tac-grid-line'));
    });

    it('la couleur et la taille s’appliquent aux lignes, étiquettes et aperçu, et voyagent dans le spec', async () => {
        const helper = makeRotatingMap(0);
        const api = makeApi(helper, vi.fn());
        await api.placeGridOnView();
        api.setGridColor('magenta');
        api.setGridLabelSize('xlarge');
        const spec = api.state.grid as TacticalGridSpec;
        expect(spec.color).toBe('magenta');
        expect(spec.labelSize).toBe('xlarge');
        const magenta = GRID_COLORS.magenta;
        expect(helper.paint).toHaveBeenCalledWith('tac-grid-line', 'line-color', magenta);
        expect(helper.paint).toHaveBeenCalledWith('tac-grid-label', 'text-color', magenta);
        expect(helper.paint).toHaveBeenCalledWith('tac-grid-preview-line', 'line-color', magenta);
        expect(helper.layout).toHaveBeenCalledWith('tac-grid-label', 'text-size', 24);
    });

    it('le panneau offre couleur et taille, accessibles', async () => {
        const helper = makeRotatingMap(0);
        const api = makeApi(helper, vi.fn());
        await api.placeGridOnView();
        const section = document.createElement('div');
        mountOverlayControls(section, api as MapOverlays, { row: 'r', fab: 'f', label: 'l' });
        const color = section.querySelector<HTMLSelectElement>('select[aria-label="Couleur du carroyage"]');
        const size = section.querySelector<HTMLSelectElement>('select[aria-label="Taille des lettres du carroyage"]');
        expect(color).not.toBeNull();
        expect(size).not.toBeNull();
        expect(color!.options).toHaveLength(4);
        expect(size!.options).toHaveLength(4);
        expect(color!.style.minHeight).toBe('44px');
        color!.value = 'orange';
        color!.dispatchEvent(new Event('change'));
        expect((api.state.grid as TacticalGridSpec).color).toBe('orange');
        size!.value = 'small';
        size!.dispatchEvent(new Event('change'));
        expect((api.state.grid as TacticalGridSpec).labelSize).toBe('small');
    });
});

describe('légende des captures (décision 39, G5)', () => {
    function legendFor(spec: TacticalGridSpec): string | null {
        const ov = { state: { gridOn: true, grid: spec, mgrsOn: false, powerOn: false, cellM: spec.cellM } } as unknown as MapOverlays;
        return overlayLegend(ov, 0);
    }

    it('dit « A1 » sans prétendre qu’il est au nord-ouest', () => {
        const { spec } = makeOrientedGrid([1.9, 47.9], 200, 100, 50, 0);
        const legend = legendFor(spec);
        expect(legend).toContain('Carroyage 50 m');
        expect(legend).toContain('A1');
        expect(legend).not.toContain('nord-ouest');
    });

    it('dit l’orientation quand elle n’est pas nulle', () => {
        const flat = makeOrientedGrid([1.9, 47.9], 200, 100, 50, 0).spec;
        expect(legendFor(flat)).not.toContain('orienté');
        const turned = { ...flat, angle: 35 };
        expect(legendFor(turned)).toContain('orienté à 35°');
    });
});
