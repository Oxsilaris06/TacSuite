/**
 * map-overlays-rotation.test.ts — Revue finale du carroyage orientable
 * (décision 39, constats F1 à F7) : étiquettes jamais à l'envers quel que soit
 * le cap, premier coin ancré au sol, mode rotation robuste (autres actions,
 * zoom, pointeurs annulés, clavier), maille qui garde couleur et taille.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => {
    class M {
        el: HTMLElement; ll: unknown = null;
        constructor(o: { element: HTMLElement }) { this.el = o.element; (globalThis as any).__mk.push(this); }
        setLngLat(ll: unknown) { this.ll = ll; return this; }
        addTo() { return this; }
        remove() { (this as any).removed = true; return this; }
        getElement() { return this.el; }
    }
    (globalThis as any).__mk = [];
    return { Marker: M, default: { Marker: M } };
});

import { createMapOverlays, mountOverlayControls } from '@shared/map-overlays.js';
import { gridToGeo, metersPerDegree, type TacticalGridSpec } from '@shared/tactical-grid.js';

const LAT0 = 47.9, LNG0 = 1.9;
const mpd = metersPerDegree(LAT0);

/** Faux map à transformation MUTABLE (zoom autour d'un point, bearing, recentrage). */
function makeMap(bearing0: number) {
    const t = { s: 1, b: bearing0, E0: 0, N0: 0 }; // s px/m, centre géo (E0,N0) m au pixel (400,300)
    const cx = 400, cy = 300;
    const rot = () => { const r = (t.b * Math.PI) / 180; return [Math.cos(r), Math.sin(r)] as const; };
    const project = (ll: { lng: number; lat: number }) => {
        const [ca, sa] = rot();
        const E = (ll.lng - LNG0) * mpd.lon - t.E0, N = (ll.lat - LAT0) * mpd.lat - t.N0;
        return { x: cx + t.s * (E * ca - N * sa), y: cy + t.s * (-E * sa - N * ca) };
    };
    const unproject = ([x, y]: [number, number]) => {
        const [ca, sa] = rot();
        const dx = (x - cx) / t.s, dy = (y - cy) / t.s;
        const E = dx * ca - dy * sa + t.E0, N = -dx * sa - dy * ca + t.N0;
        return { lng: LNG0 + E / mpd.lon, lat: LAT0 + N / mpd.lat };
    };
    /** Zoom ×k autour du pixel P (molette au curseur, centre d'un pincement). */
    const zoomAt = (k: number, P: [number, number]) => {
        const g = unproject(P);
        t.s *= k;
        const [ca, sa] = rot();
        const dx = (P[0] - cx) / t.s, dy = (P[1] - cy) / t.s;
        t.E0 = (g.lng - LNG0) * mpd.lon - (dx * ca - dy * sa);
        t.N0 = (g.lat - LAT0) * mpd.lat - (-dx * sa - dy * ca);
    };
    const listeners = new Map<string, Array<(e: unknown) => void>>();
    const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    let dragOn = true;
    const canvas = { style: { cursor: '' }, clientWidth: 800, clientHeight: 600, width: 800, height: 600, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const map = {
        getCanvas: () => canvas,
        project, unproject: (p: [number, number]) => unproject(p),
        getBearing: () => t.b, getZoom: () => 17, loaded: () => true,
        getBounds: () => ({ getWest: () => 1.89, getSouth: () => 47.89, getEast: () => 1.91, getNorth: () => 47.91 }),
        on: (ty: string, fn: (e: unknown) => void) => { listeners.set(ty, [...(listeners.get(ty) ?? []), fn]); return map; },
        off: (ty: string, fn: (e: unknown) => void) => { listeners.set(ty, (listeners.get(ty) ?? []).filter((f) => f !== fn)); return map; },
        jumpTo: (o: { center?: { lng: number; lat: number } | [number, number] }) => {
            const c = Array.isArray(o.center) ? { lng: o.center[0], lat: o.center[1] } : o.center;
            if (c) { t.E0 = (c.lng - LNG0) * mpd.lon; t.N0 = (c.lat - LAT0) * mpd.lat; }
            return map;
        },
        getSource: (id: string) => sources.get(id),
        addSource: (id: string) => { sources.set(id, { setData: vi.fn() }); },
        addLayer: vi.fn(), setLayoutProperty: vi.fn(), setPaintProperty: vi.fn(), hasImage: () => false, addImage: vi.fn(),
        dragPan: { enable: () => { dragOn = true; }, disable: () => { dragOn = false; }, isEnabled: () => dragOn },
    };
    const emit = (ty: string, e: unknown) => (listeners.get(ty) ?? []).forEach((f) => f(e));
    const tap = (x: number, y: number) => {
        const ll = unproject([x, y]);
        emit('mousedown', { lngLat: ll, point: { x, y } });
        emit('mouseup', { lngLat: ll, point: { x, y } });
    };
    return { map, t, project, unproject, zoomAt, emit, tap, sources, isDragOn: () => dragOn };
}

function api(h: ReturnType<typeof makeMap>, saved: TacticalGridSpec[] = []) {
    return createMapOverlays(h.map as never, {
        load: () => ({ gridOn: true, cellM: 50 }),
        save: (s) => { if (s.grid) saved.push(s.grid); },
        toast: () => {}, confirm: async () => true,
    });
}
const lastMarkerEl = (): HTMLElement => (globalThis as any).__mk.at(-1).el;
const ptr = (ty: string, x: number, y: number, target: EventTarget = document) =>
    target.dispatchEvent(new MouseEvent(ty, { clientX: x, clientY: y, bubbles: true }));

/** Direction ÉCRAN du « haut » d'une étiquette en `text-rotation-alignment: map` :
 *  texte calé est-ouest puis tourné de `rotation` (sens horaire) → son haut
 *  pointe au cap `rotation`. Renvoie dy écran (négatif = vers le haut, lisible). */
function labelUpDy(h: ReturnType<typeof makeMap>, at: [number, number], rotation: number): number {
    const r = (rotation * Math.PI) / 180;
    const p0 = h.project({ lng: at[0], lat: at[1] });
    const p1 = h.project({ lng: at[0] + (5 * Math.sin(r)) / mpd.lon, lat: at[1] + (5 * Math.cos(r)) / mpd.lat });
    return p1.y - p0.y;
}

function lastLabels(h: ReturnType<typeof makeMap>) {
    return h.sources.get('tac-grid-labels')!.setData.mock.calls.at(-1)![0] as GeoJSON.FeatureCollection<GeoJSON.Point, { rotation: number }>;
}
function centerPx(h: ReturnType<typeof makeMap>, g: TacticalGridSpec) {
    const c = gridToGeo(g, g.cols / 2, g.rows / 2);
    return h.project({ lng: c[0], lat: c[1] });
}

describe('carroyage orientable, revue finale (F1 à F7)', () => {
    it('F1 : tracé sur une carte tournée à 120°, 180° ou 270° : étiquettes lisibles à l’écran', async () => {
        for (const bearing of [0, 90, 120, 180, 270]) {
            const h = makeMap(bearing);
            const a = api(h);
            await a.startGridDraw();
            const p0 = h.unproject([100, 100]), p1 = h.unproject([300, 250]);
            h.emit('mousedown', { lngLat: p0, point: { x: 100, y: 100 } });
            h.emit('mousemove', { lngLat: p1, point: { x: 300, y: 250 } });
            h.emit('mouseup', { lngLat: p1, point: { x: 300, y: 250 } });
            for (const f of lastLabels(h).features) {
                expect(labelUpDy(h, f.geometry.coordinates as [number, number], f.properties.rotation), `cap ${bearing}`).toBeLessThan(0);
            }
        }
    });

    it('F1 : carroyage au nord puis carte tournée à 180° : les étiquettes se retournent', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        h.t.b = 180;
        h.emit('rotate', {});
        for (const f of lastLabels(h).features) {
            expect(labelUpDy(h, f.geometry.coordinates as [number, number], f.properties.rotation)).toBeLessThan(0);
        }
    });

    it('F5 : changer de maille garde couleur, taille et angle', async () => {
        const h = makeMap(30);
        const a = api(h);
        await a.placeGridOnView();
        a.setGridColor('magenta');
        a.setGridLabelSize('xlarge');
        await a.setCellSize(100);
        expect(a.state.grid!.color).toBe('magenta');
        expect(a.state.grid!.labelSize).toBe('xlarge');
        expect(a.state.grid!.angle).toBe(30);
    });

    it('F2 : deux touchers avec un zoom entre les deux : A1 reste au point touché', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.startGridDraw();
        const firstGeo = h.unproject([200, 200]);
        h.tap(200, 200);
        h.zoomAt(0.5, [400, 300]);
        h.tap(600, 500);
        const a1 = gridToGeo(a.state.grid!, 0, 0);
        expect(Math.hypot((a1[0] - firstGeo.lng) * mpd.lon, (a1[1] - firstGeo.lat) * mpd.lat)).toBeLessThan(0.5);
    });

    it('F3 : couleur changée pendant le mode rotation : le mode se termine, la couleur reste', async () => {
        const h = makeMap(0);
        const saved: TacticalGridSpec[] = [];
        const a = api(h, saved);
        await a.placeGridOnView();
        await a.startGridRotate();
        a.setGridColor('magenta');
        expect(a.isCapturing()).toBe(false);
        expect(h.isDragOn()).toBe(true);
        const c = centerPx(h, a.state.grid!);
        ptr('pointerdown', c.x, c.y - 90, lastMarkerEl());
        ptr('pointermove', c.x + 70, c.y - 66);
        ptr('pointerup', c.x + 70, c.y - 66);
        expect(a.state.grid!.color).toBe('magenta');
        expect(a.state.grid!.angle).toBe(0);
        expect(saved.at(-1)!.color).toBe('magenta');
    });

    it('F3 : « Effacer » pendant le mode rotation : plus de poignée ni de capture, rien ne ressuscite', async () => {
        const h = makeMap(0);
        const saved: TacticalGridSpec[] = [];
        const a = api(h, saved);
        await a.placeGridOnView();
        const g = a.state.grid!;
        await a.startGridRotate();
        const marker = (globalThis as any).__mk.at(-1);
        await a.clearGrid();
        expect(a.state.grid).toBeNull();
        expect(a.isCapturing()).toBe(false);
        expect(h.isDragOn()).toBe(true);
        expect(marker.removed).toBe(true);
        const c = centerPx(h, g);
        const before = saved.length;
        ptr('pointerdown', c.x, c.y - 90, marker.el);
        ptr('pointermove', c.x + 90, c.y);
        ptr('pointerup', c.x + 90, c.y);
        expect(a.state.grid).toBeNull();
        expect(saved.length).toBe(before);
    });

    it('F3 : relecture du stockage pendant le mode rotation : le mode se termine avant', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        await a.startGridRotate();
        a.reload();
        expect(a.isCapturing()).toBe(false);
    });

    it('F4 : zoom pendant le mode rotation : saisir la poignée sans bouger ne change pas l’angle, la poignée suit le centre', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        const g = a.state.grid!;
        const cg = gridToGeo(g, g.cols / 2, g.rows / 2);
        await a.startGridRotate();
        h.zoomAt(2, [200, 150]);
        h.emit('move', {});
        const hp = h.project((globalThis as any).__mk.at(-1).ll);
        const cp = h.project({ lng: cg[0], lat: cg[1] });
        expect(Math.hypot(hp.x - cp.x, hp.y - cp.y)).toBeCloseTo(90, 0);
        ptr('pointerdown', hp.x, hp.y, lastMarkerEl());
        ptr('pointermove', hp.x, hp.y);
        expect(a.state.grid!.angle).toBe(0);
        ptr('pointerup', hp.x, hp.y);
        expect(a.state.grid!.angle).toBe(0);
    });

    it('F4 : centre du carroyage hors de la vue au lancement de « Tourner » : la carte s’y recentre', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        h.zoomAt(4, [100, 100]);
        await a.startGridRotate();
        const hp = h.project((globalThis as any).__mk.at(-1).ll);
        expect(hp.x >= 0 && hp.x <= 800 && hp.y >= 0 && hp.y <= 600).toBe(true);
    });

    it('F6 : pointercancel pendant le geste : rotation annulée, rien d’enregistré', async () => {
        const h = makeMap(0);
        const saved: TacticalGridSpec[] = [];
        const a = api(h, saved);
        await a.placeGridOnView();
        const before = saved.length;
        const c = centerPx(h, a.state.grid!);
        await a.startGridRotate();
        ptr('pointerdown', c.x, c.y - 90, lastMarkerEl());
        ptr('pointermove', c.x + 70, c.y - 66);
        expect(a.state.grid!.angle).toBe(45);
        document.dispatchEvent(new Event('pointercancel'));
        expect(a.state.grid!.angle).toBe(0);
        expect(saved.length).toBe(before);
        expect(a.isCapturing()).toBe(false);
    });

    it('F6 : un autre pointeur qui se lève ne valide pas la rotation', async () => {
        const h = makeMap(0);
        const saved: TacticalGridSpec[] = [];
        const a = api(h, saved);
        await a.placeGridOnView();
        const before = saved.length;
        const c = centerPx(h, a.state.grid!);
        await a.startGridRotate();
        const down = new MouseEvent('pointerdown', { clientX: c.x, clientY: c.y - 90, bubbles: true });
        Object.defineProperty(down, 'pointerId', { value: 1 });
        lastMarkerEl().dispatchEvent(down);
        const move = new MouseEvent('pointermove', { clientX: c.x + 70, clientY: c.y - 66, bubbles: true });
        Object.defineProperty(move, 'pointerId', { value: 1 });
        document.dispatchEvent(move);
        const otherUp = new MouseEvent('pointerup', { clientX: 10, clientY: 10, bubbles: true });
        Object.defineProperty(otherUp, 'pointerId', { value: 2 });
        document.dispatchEvent(otherUp);
        expect(saved.length).toBe(before);
        expect(a.isCapturing()).toBe(true);
    });

    it('F7 : poignée au clavier : focalisable, valeur annoncée, flèches ±5°, Entrée enregistre', async () => {
        const h = makeMap(0);
        const saved: TacticalGridSpec[] = [];
        const a = api(h, saved);
        await a.placeGridOnView();
        await a.startGridRotate();
        const el = lastMarkerEl();
        expect(el.getAttribute('role')).toBe('slider');
        expect(el.tabIndex).toBe(0);
        expect(el.getAttribute('aria-valuenow')).toBe('0');
        expect(el.getAttribute('aria-valuemin')).toBe('0');
        expect(el.getAttribute('aria-valuemax')).toBe('355');
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(a.state.grid!.angle).toBe(5);
        expect(el.getAttribute('aria-valuenow')).toBe('5');
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(a.state.grid!.angle).toBe(355);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(saved.at(-1)!.angle).toBe(355);
        expect(a.isCapturing()).toBe(false);
    });
});

describe('Revue du 25/09 — sortie de capture, ordre d’enregistrement, maille importée (B1, B3, B7)', () => {
    const live = (h: ReturnType<typeof makeMap>, initial: Record<string, unknown>) => {
        let stored: Record<string, unknown> = initial;
        const a = createMapOverlays(h.map as never, {
            load: () => stored as never,
            save: (s) => { stored = { ...s }; },
            toast: () => {},
            confirm: async () => true,
        });
        return { a, stored: () => stored };
    };

    it('B1 : Déplacer puis Effacer termine la capture, la carte redevient libre', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        a.startGridMove();
        expect(a.isCapturing()).toBe(true);
        expect(h.isDragOn()).toBe(false);
        await a.clearGrid();
        expect(a.state.grid).toBeNull();
        expect(a.isCapturing()).toBe(false);
        expect(h.isDragOn()).toBe(true);
        h.tap(300, 300);
        expect(a.state.grid).toBeNull();
        expect(a.isCapturing()).toBe(false);
    });

    it('B1 : Tracer puis Effacer annule le tracé, deux touchers ne posent plus rien', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        await a.startGridDraw();
        await a.clearGrid();
        expect(a.isCapturing()).toBe(false);
        h.tap(200, 200);
        h.tap(500, 400);
        expect(a.state.grid).toBeNull();
    });

    it('B1 : Déplacer puis interrupteur éteint : un toucher ne déplace plus A1', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        const before = { west: a.state.grid!.west, north: a.state.grid!.north };
        a.startGridMove();
        a.setGridOn(false);
        expect(a.isCapturing()).toBe(false);
        h.tap(100, 100);
        expect(a.state.grid!.west).toBe(before.west);
        expect(a.state.grid!.north).toBe(before.north);
    });

    it('B1 : au tactile, Tracer devient Annuler pendant la capture et la termine', async () => {
        const h = makeMap(0);
        const a = api(h);
        const section = document.createElement('div');
        document.body.appendChild(section);
        mountOverlayControls(section, a, { row: 'r', fab: 'f', label: 'l' });
        const byText = (t: string) => [...section.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
        await a.startGridDraw();
        expect(a.isCapturing()).toBe(true);
        const cancel = byText('Annuler');
        expect(cancel).toBeDefined();
        cancel!.click();
        expect(a.isCapturing()).toBe(false);
        expect(byText('Tracer')).toBeDefined();
        expect(byText('Annuler')).toBeUndefined();
        section.remove();
    });

    it('B1 : Déplacer devient Annuler pendant le déplacement', async () => {
        const h = makeMap(0);
        const a = api(h);
        await a.placeGridOnView();
        const section = document.createElement('div');
        document.body.appendChild(section);
        mountOverlayControls(section, a, { row: 'r', fab: 'f', label: 'l' });
        a.startGridMove();
        const cancel = [...section.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Annuler'));
        expect(cancel).toBeDefined();
        cancel!.click();
        expect(a.isCapturing()).toBe(false);
        expect(a.state.grid).not.toBeNull();
        section.remove();
    });

    it('B3 : une relecture distante différée pendant « Sur la vue » ne remplace pas le nouveau carroyage', async () => {
        const h = makeMap(0);
        const { a, stored } = live(h, { gridOn: true, cellM: 50 });
        await a.placeGridOnView();
        const first = a.state.grid!;
        let pending = false;
        // Hôte (map-core) : rejoue la relecture différée dès que la carte est libre.
        a.onChange(() => { if (pending && !a.isCapturing()) { pending = false; a.reload(); } });
        pending = true; // un autre onglet a écrit pendant le geste
        h.t.E0 += 500; // la carte a été déplacée de 500 m vers l'est
        await a.placeGridOnView();
        expect(a.state.grid!.west).not.toBe(first.west);
        expect((stored().grid as TacticalGridSpec).west).toBe(a.state.grid!.west);
    });

    it('B3 : une relecture distante différée pendant la rotation ne perd pas la rotation', async () => {
        const h = makeMap(0);
        const { a, stored } = live(h, { gridOn: true, cellM: 50 });
        await a.placeGridOnView();
        let pending = false;
        a.onChange(() => { if (pending && !a.isCapturing()) { pending = false; a.reload(); } });
        await a.startGridRotate();
        const el = lastMarkerEl();
        pending = true;
        for (let i = 0; i < 18; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(a.state.grid!.angle).toBe(90);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(a.state.grid!.angle).toBe(90);
        expect((stored().grid as TacticalGridSpec).angle).toBe(90);
        expect(a.isCapturing()).toBe(false);
    });

    it('B7 : la maille affichée suit le carroyage chargé, pas les réglages', async () => {
        const h = makeMap(0);
        const a1 = createMapOverlays(h.map as never, { load: () => ({ gridOn: true, cellM: 100 }) as never, save: () => {}, toast: () => {}, confirm: async () => true });
        await a1.placeGridOnView();
        const grid100 = a1.state.grid!;
        expect(grid100.cellM).toBe(100);
        const a2 = createMapOverlays(h.map as never, { load: () => ({ gridOn: true, cellM: 50, grid: grid100 }) as never, save: () => {}, toast: () => {}, confirm: async () => true });
        expect(a2.state.cellM).toBe(100);
    });
});
