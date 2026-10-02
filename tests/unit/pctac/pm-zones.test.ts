/**
 * pm-zones.test.ts — Retours terrain 2026-10-02 : les zones dessinées
 * (rectangle, cercle) sont un ARRIÈRE-PLAN (« arrière-plan + priorité »,
 * décisions de Nico) :
 *   1. rendues SOUS traits, flèches, textes et mesures (ordre des couches +
 *      tri des features : la plus grande zone dessous) ;
 *   2. au toucher, un objet non-zone prime ; entre zones, la plus petite
 *      surface gagne ; une zone contenue dans une autre reste attrapable ;
 *   3. un glisser qui commence sur une zone NON sélectionnée panote la carte
 *      (le geste n'est pas saisi), le tap la sélectionne par `click` ;
 *   4. opacité de remplissage par zone : `fillOpacity` (absent = 0.18, 0 =
 *      contour seul), réglée depuis la roue « Remplissage -/+ », annulable et
 *      relue entre onglets. La validation d'import est testée dans
 *      pc-archive-import.test.ts.
 *
 * PDF / A3 : `captureToDataUrl` compose le canvas WebGL de la carte
 * (capture.ts) et ni pdf-export.ts ni pdf-a3.ts ne repeignent les zones —
 * l'ordre et l'opacité par zone y sont donc déjà ceux de l'écran.
 *
 * `this` FACTICE, faux `map` (jamais `new maplibregl.Map`, WebGL absent sous
 * jsdom). Les couches sont en revanche vérifiées par le validateur et
 * l'évaluateur d'expressions OFFICIELS de MapLibre (style-spec) : filtres et
 * `fill-opacity` sont donc jugés sur leur sémantique réelle, pas sur leur forme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPropertyExpression, featureFilter, latest, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

import { circlePolygon, rectPolygon } from '../../../src/shared/geo-shapes.js';
import { SHAPES_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { DrawLayersMethods } from '../../../src/apps/pctac/planmap/draw-layers.js';
import { DrawToolsMethods } from '../../../src/apps/pctac/planmap/draw-tools.js';
import {
    GeoMethods,
    ZONE_FILL_DEFAULT,
    ZONE_FILL_LEVELS,
    isFillOpacity,
    polygonAreaM2,
    zoneFillOpacity,
} from '../../../src/apps/pctac/planmap/geo.js';
import { MapCoreMethods } from '../../../src/apps/pctac/planmap/map-core.js';
import { ShapesGesturesMethods, pickShapeTarget } from '../../../src/apps/pctac/planmap/shapes-gestures.js';
import { ShapesRenderMethods } from '../../../src/apps/pctac/planmap/shapes-render.js';
import { SafeMethods, createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PlanMapInternal, PlanShape } from '../../../src/apps/pctac/planmap/types.js';
import { WheelsMethods } from '../../../src/apps/pctac/planmap/wheels.js';

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
    class FakeLngLatBounds { extend(): this { return this; } }
    return { default: { Marker: FakeMarker, LngLatBounds: FakeLngLatBounds } };
});

// ============================================================
// Fixtures
// ============================================================
const BIG: PlanShape = {
    id: 'big', type: 'rectangle', color: '#ef4444',
    coords: rectPolygon([2, 48], [2.02, 48.02]),
};
const SMALL: PlanShape = {
    id: 'small', type: 'circle', color: '#3b82f6',
    center: [2.01, 48.01], edge: [2.01, 48.012],
    coords: circlePolygon([2.01, 48.01], [2.01, 48.012]),
};
const LINE: PlanShape = { id: 'l1', type: 'line', color: '#22c55e', coords: [[2, 48], [2.02, 48.02]] };
const TEXT: PlanShape = { id: 't1', type: 'text', text: 'PC', coords: [[2.005, 48.005]] };
const MEASURE: PlanShape = { id: 'm1', type: 'measure', color: '#22d3ee', coords: [[2, 48], [2.01, 48.01]] };

/** Features telles que MapLibre les rend par `queryRenderedFeatures` (propriétés de `_renderShapes`). */
const zoneF = (id: string, area: number): { properties: Record<string, unknown> } => ({ properties: { shapeId: id, zone: true, area } });
const lineF = (id: string): { properties: Record<string, unknown> } => ({ properties: { shapeId: id } });
const textF = (id: string): { properties: Record<string, unknown> } => ({ properties: { shapeId: id, isText: true } });
const measureF = (): { properties: Record<string, unknown> } => ({ properties: { color: '#22d3ee', strokeWidth: 3 } });

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ============================================================
// Pure : opacité de remplissage et surface
// ============================================================
describe('zoneFillOpacity — absent = 0.18 (formes antérieures), 0 = contour seul', () => {
    it('absent → 0.18, rétrocompatible', () => {
        expect(zoneFillOpacity({ id: 'a', type: 'rectangle' })).toBe(0.18);
        expect(ZONE_FILL_DEFAULT).toBe(0.18);
    });

    it('0 reste 0 (ne retombe pas sur le défaut comme un `||`)', () => {
        expect(zoneFillOpacity({ id: 'a', type: 'circle', fillOpacity: 0 })).toBe(0);
    });

    it('valeur valide conservée, bornes comprises', () => {
        expect(zoneFillOpacity({ id: 'a', type: 'circle', fillOpacity: 0.45 })).toBe(0.45);
        expect(zoneFillOpacity({ id: 'a', type: 'circle', fillOpacity: 1 })).toBe(1);
    });

    it('valeur corrompue (hors 0..1, NaN, Infinity, texte) → 0.18, jamais propagée à la couche', () => {
        for (const bad of [-0.01, 1.01, 5, NaN, Infinity, -Infinity, '0.5', null, {}, []]) {
            expect(zoneFillOpacity({ id: 'a', type: 'circle', fillOpacity: bad as unknown as number }), String(bad)).toBe(0.18);
        }
    });

    it('isFillOpacity : nombre fini dans [0, 1] seulement (partagé avec la frontière d’import)', () => {
        expect([0, 0.18, 1].every(isFillOpacity)).toBe(true);
        expect([-0.1, 1.1, NaN, Infinity, '0.5', null, undefined, {}].some(isFillOpacity)).toBe(false);
    });

    it('les paliers de la roue : contour seul, défaut 0.18 inclus, croissants, bornés', () => {
        expect(ZONE_FILL_LEVELS[0]).toBe(0);
        expect(ZONE_FILL_LEVELS).toContain(0.18);
        expect([...ZONE_FILL_LEVELS]).toEqual([...ZONE_FILL_LEVELS].sort((a, b) => a - b));
        expect(ZONE_FILL_LEVELS.every(isFillOpacity)).toBe(true);
    });
});

describe('polygonAreaM2 (partagé avec l’export PDF)', () => {
    it('un carré de 0,01° à 48°N ≈ 0,83 km² (1,11 km × 0,74 km), croît avec le côté, 0 sous 3 points', () => {
        const small = polygonAreaM2(rectPolygon([2, 48], [2.01, 48.01]));
        const big = polygonAreaM2(rectPolygon([2, 48], [2.02, 48.02]));
        expect(small).toBeGreaterThan(800_000);
        expect(small).toBeLessThan(850_000);
        expect(big / small).toBeCloseTo(4, 1);
        expect(polygonAreaM2([[0, 0], [1, 1]])).toBe(0);
    });
});

// ============================================================
// 1. Qui est visé ? Priorité aux objets, puis la plus petite zone
// ============================================================
describe('pickShapeTarget — priorité au toucher (décision 2)', () => {
    it('un trait prime sur une zone, même plus petite', () => {
        expect(pickShapeTarget([zoneF('z', 10), lineF('l1')], null)).toEqual({ id: 'l1', zone: false });
        expect(pickShapeTarget([lineF('l1'), zoneF('z', 10)], null)).toEqual({ id: 'l1', zone: false });
    });

    it('une zone d’annotation texte (zone de détection) prime aussi sur une zone', () => {
        expect(pickShapeTarget([zoneF('z', 1_000), textF('t1')], null)).toEqual({ id: 't1', zone: false });
    });

    it('entre zones, la plus petite surface gagne, quel que soit l’ordre renvoyé par la carte', () => {
        expect(pickShapeTarget([zoneF('big', 1_000), zoneF('small', 10)], null)).toEqual({ id: 'small', zone: true });
        expect(pickShapeTarget([zoneF('small', 10), zoneF('big', 1_000)], null)).toEqual({ id: 'small', zone: true });
    });

    it('une zone entièrement contenue dans une autre reste attrapable ; l’englobante l’est hors de la petite', () => {
        // Sous le doigt, dans la petite : les deux zones sont touchées → la petite.
        expect(pickShapeTarget([zoneF('big', 1_000), zoneF('small', 10)], null)?.id).toBe('small');
        // Hors de la petite : seule l’englobante est touchée.
        expect(pickShapeTarget([zoneF('big', 1_000)], null)?.id).toBe('big');
    });

    it('une zone n’est visée que s’il n’y a rien d’autre', () => {
        expect(pickShapeTarget([zoneF('z', 10)], null)).toEqual({ id: 'z', zone: true });
    });

    it('les features sans shapeId (mesures, anneaux) ne sont pas sélectionnables : ni bloquantes ni visées', () => {
        expect(pickShapeTarget([measureF(), zoneF('z', 10)], null)).toEqual({ id: 'z', zone: true });
        expect(pickShapeTarget([measureF()], null)).toBeNull();
        expect(pickShapeTarget([], null)).toBeNull();
    });

    it('une même forme renvoyée plusieurs fois (une par tuile) ne compte qu’une fois', () => {
        expect(pickShapeTarget([zoneF('z', 10), zoneF('z', 10)], null)).toEqual({ id: 'z', zone: true });
        // Deux fois le même trait ne déclenche pas la sélection cyclique.
        expect(pickShapeTarget([lineF('l1'), lineF('l1')], 'l1')).toEqual({ id: 'l1', zone: false });
    });

    it('sélection cyclique conservée entre OBJETS : le trait déjà sélectionné cède au suivant', () => {
        expect(pickShapeTarget([lineF('l1'), lineF('l2')], 'l1')).toEqual({ id: 'l2', zone: false });
        expect(pickShapeTarget([lineF('l1'), lineF('l2')], 'l2')).toEqual({ id: 'l1', zone: false });
    });

    it('la zone sélectionnée ne cède PAS le geste à une autre zone : elle reste déplaçable', () => {
        expect(pickShapeTarget([zoneF('small', 10)], 'small')).toEqual({ id: 'small', zone: true });
    });

    it('un objet sélectionné seul sous une zone reste visé (pas de bascule vers la zone)', () => {
        expect(pickShapeTarget([lineF('l1'), zoneF('z', 10)], 'l1')).toEqual({ id: 'l1', zone: false });
    });
});

// ============================================================
// 2. Saisie du geste : pointerdown
// ============================================================
function makeGestureThis(opts: { shapes?: PlanShape[]; selected?: string | null; locked?: boolean } = {}) {
    const shapes = opts.shapes ?? [];
    const map = {
        queryRenderedFeatures: vi.fn((): unknown[] => []),
        getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    };
    const mocks = {
        startShapeGesture: vi.fn(),
        selectShape: vi.fn(),
        openShapeContextMenu: vi.fn(),
        suppressDblZoom: vi.fn(),
    };
    const fake = {
        ...createPlanMapState(),
        ...SafeMethods,
        ...GeoMethods,
        ...ShapesGesturesMethods,
        map,
        _selectedShapeId: opts.selected ?? null,
        _locked: opts.locked ?? false,
        _loadShapes: () => shapes,
        _startShapeGesture: mocks.startShapeGesture,
        _selectShape: mocks.selectShape,
        _openShapeContextMenu: mocks.openShapeContextMenu,
        _suppressDblZoom: mocks.suppressDblZoom,
    } as unknown as PlanMapInternal;
    return { fake, map, mocks };
}

function downEvent(target: EventTarget = document.body) {
    const originalEvent = { target, preventDefault: vi.fn() };
    const e = { point: { x: 40, y: 50 }, lngLat: { lng: 2.01, lat: 48.01 }, originalEvent, preventDefault: vi.fn() };
    return { e: e as unknown as Parameters<PlanMapInternal['_shapePointerDown']>[0], originalEvent, preventDefault: e.preventDefault };
}

describe('_shapePointerDown — une zone d’arrière-plan ne saisit pas le geste (décision 3)', () => {
    it('zone NON sélectionnée : ni preventDefault ni geste de forme — le glisser panote la carte', () => {
        const { fake, map, mocks } = makeGestureThis({ shapes: [BIG] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        const { e, originalEvent, preventDefault } = downEvent();

        fake._shapePointerDown(e);

        expect(mocks.startShapeGesture).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(originalEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('zone SÉLECTIONNÉE : saisie comme avant (preventDefault + geste de déplacement)', () => {
        const { fake, map, mocks } = makeGestureThis({ shapes: [BIG], selected: 'big' });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        const { e, originalEvent, preventDefault } = downEvent();

        fake._shapePointerDown(e);

        expect(preventDefault).toHaveBeenCalled();
        expect(mocks.startShapeGesture).toHaveBeenCalledWith('big', { lng: 2.01, lat: 48.01 }, originalEvent);
    });

    it('zone sélectionnée mais FIGÉE (verrou par forme) : rien à déplacer, le glisser panote', () => {
        const { fake, map, mocks } = makeGestureThis({ shapes: [{ ...BIG, locked: true }], selected: 'big' });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);

        fake._shapePointerDown(downEvent().e);

        expect(mocks.startShapeGesture).not.toHaveBeenCalled();
    });

    it('zone sélectionnée sous le verrou GLOBAL : le glisser panote aussi', () => {
        const { fake, map, mocks } = makeGestureThis({ shapes: [BIG], selected: 'big', locked: true });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);

        fake._shapePointerDown(downEvent().e);

        expect(mocks.startShapeGesture).not.toHaveBeenCalled();
    });

    it('un trait sous la zone est saisi, pas la zone (priorité à l’objet)', () => {
        const { fake, map, mocks } = makeGestureThis({ shapes: [BIG, LINE] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000), lineF('l1')]);

        fake._shapePointerDown(downEvent().e);

        expect(mocks.startShapeGesture).toHaveBeenCalledTimes(1);
        expect(mocks.startShapeGesture.mock.calls[0]?.[0]).toBe('l1');
    });

    it('interroge TOUTES les couches de formes au point du doigt (et non une seule couche déléguée)', () => {
        const { fake, map } = makeGestureThis({ shapes: [BIG] });
        const { e } = downEvent();

        fake._shapePointerDown(e);

        expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
            { x: 40, y: 50 },
            { layers: ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit'] },
        );
    });

    it('forme absente du stockage (supprimée dans un autre onglet) : aucun geste', () => {
        const { fake, map, mocks } = makeGestureThis({ shapes: [] });
        map.queryRenderedFeatures.mockReturnValue([lineF('fantome')]);

        fake._shapePointerDown(downEvent().e);

        expect(mocks.startShapeGesture).not.toHaveBeenCalled();
    });

    it('gardes inchangées : outil de dessin actif, geste en cours, appui sur un ping', () => {
        const a = makeGestureThis({ shapes: [LINE] });
        a.map.queryRenderedFeatures.mockReturnValue([lineF('l1')]);
        a.fake.drawTool = 'line';
        a.fake._shapePointerDown(downEvent().e);
        expect(a.mocks.startShapeGesture).not.toHaveBeenCalled();

        const b = makeGestureThis({ shapes: [LINE] });
        b.map.queryRenderedFeatures.mockReturnValue([lineF('l1')]);
        b.fake._gesture = { shapeId: 'autre' };
        b.fake._shapePointerDown(downEvent().e);
        expect(b.mocks.startShapeGesture).not.toHaveBeenCalled();

        const c = makeGestureThis({ shapes: [LINE] });
        c.map.queryRenderedFeatures.mockReturnValue([lineF('l1')]);
        const pin = document.createElement('div');
        pin.className = 'plan-pin';
        c.fake._shapePointerDown(downEvent(pin).e);
        expect(c.mocks.startShapeGesture).not.toHaveBeenCalled();
    });

    it('un trait seul est saisi comme avant', () => {
        const { fake, map, mocks } = makeGestureThis({ shapes: [LINE] });
        map.queryRenderedFeatures.mockReturnValue([lineF('l1')]);

        fake._shapePointerDown(downEvent().e);

        expect(mocks.startShapeGesture.mock.calls[0]?.[0]).toBe('l1');
    });
});

// ============================================================
// 3. Le tap sélectionne une zone d’arrière-plan (map 'click') ; appui long
// ============================================================
function makeLayersThis(opts: { shapes?: PlanShape[]; selected?: string | null } = {}) {
    const gesture = makeGestureThis(opts);
    const fake = {
        ...gesture.fake,
        ...DrawLayersMethods,
        // `DrawLayersMethods` ne porte pas les méthodes de geste : on garde les VRAIES
        // `_shapeTargetAt` / `_tapShape` / `_shapeGrabsPress` de `gesture.fake`.
        _safe: <A extends unknown[], R>(fn: (...a: A) => R) => fn,
        _shapePointerDown: vi.fn(),
        _renderShapeTexts: vi.fn(),
        _renderDiameters: vi.fn(),
        _deselectShape: vi.fn(),
        _openCreatePingWheel: vi.fn(),
        _activeWheel: null,
        _inlinePanel: null,
        _wheelJustClosed: 0,
    } as unknown as PlanMapInternal;
    return { ...gesture, fake };
}

function clickHandler(map: { on: ReturnType<typeof vi.fn> }): (e: unknown) => void {
    const call = map.on.mock.calls.find((c) => c[0] === 'click' && typeof c[1] === 'function');
    if (!call) throw new Error('aucun handler click posé sur la carte');
    return call[1] as (e: unknown) => void;
}

const CLICK = { point: { x: 40, y: 50 }, lngLat: { lng: 2.01, lat: 48.01 } };

describe('map click — le tap sélectionne une zone non saisie (décision 3)', () => {
    it('tap sur une zone NON sélectionnée : elle est sélectionnée', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake._initDrawingLayers();

        clickHandler(map)(CLICK);

        expect(mocks.selectShape).toHaveBeenCalledWith('big');
        expect(fake._deselectShape).not.toHaveBeenCalled();
    });

    it('deux taps rapprochés sur la zone : le second ouvre la roue d’options (double tap conservé)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake._initDrawingLayers();
        const click = clickHandler(map);

        click(CLICK);
        vi.setSystemTime(new Date('2026-10-02T10:00:00.200Z'));
        click(CLICK);

        expect(mocks.openShapeContextMenu).toHaveBeenCalledWith('big', { lng: 2.01, lat: 48.01 });
        // Le zoom double-clic natif est neutralisé le temps de la fenêtre de double tap.
        expect(mocks.suppressDblZoom).toHaveBeenCalled();
    });

    it('tap sur la zone SÉLECTIONNÉE (saisie par le geste) : le click ne refait rien', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG], selected: 'big' });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake._initDrawingLayers();

        clickHandler(map)(CLICK);

        expect(mocks.selectShape).not.toHaveBeenCalled();
        expect(fake._deselectShape).not.toHaveBeenCalled();
    });

    it('tap sur un trait (saisi par le geste) : le click ne refait rien', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [LINE] });
        map.queryRenderedFeatures.mockReturnValue([lineF('l1')]);
        fake._initDrawingLayers();

        clickHandler(map)(CLICK);

        expect(mocks.selectShape).not.toHaveBeenCalled();
    });

    it('zone sélectionnée mais figée (non saisie) : le tap passe par le même chemin (double tap → roue pour la déverrouiller)', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [{ ...BIG, locked: true }], selected: 'big' });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake._initDrawingLayers();

        clickHandler(map)(CLICK);

        expect(mocks.selectShape).toHaveBeenCalledWith('big');
    });

    it('tap sur le vide : désélection, comme avant', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG], selected: 'big' });
        map.queryRenderedFeatures.mockReturnValue([]);
        fake._initDrawingLayers();

        clickHandler(map)(CLICK);

        expect(fake._deselectShape).toHaveBeenCalledTimes(1);
        expect(mocks.selectShape).not.toHaveBeenCalled();
    });

    it('une roue ouverte (ex. appui long à la souris puis relâché) n’est pas doublée d’une sélection de zone', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake._activeWheel = { lngLat: null, element: null, open: vi.fn(), destroy: vi.fn() };
        fake._initDrawingLayers();

        clickHandler(map)(CLICK);

        expect(mocks.selectShape).not.toHaveBeenCalled();
    });

    it('un click venu d’un autre élément posé sur la carte (poignée, roue, panneau) ne sélectionne pas la zone dessous ; le nom de la zone, si', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake._initDrawingLayers();
        const click = clickHandler(map);

        const handle = document.createElement('div');
        handle.className = 'maplibregl-marker';
        document.body.appendChild(handle);
        click({ ...CLICK, originalEvent: { target: handle } });
        const wheel = document.createElement('div');
        wheel.className = 'plan-wheel';
        document.body.appendChild(wheel);
        click({ ...CLICK, originalEvent: { target: wheel } });
        expect(mocks.selectShape).not.toHaveBeenCalled();

        // Le nom de la zone est un marker, mais il fait partie de la zone.
        const marker = document.createElement('div');
        marker.className = 'maplibregl-marker';
        const label = document.createElement('div');
        label.className = 'plan-shape-text';
        marker.appendChild(label);
        document.body.appendChild(marker);
        click({ ...CLICK, originalEvent: { target: label } });
        expect(mocks.selectShape).toHaveBeenCalledWith('big');

        // Le canevas lui-même (cas courant) : sélection.
        mocks.selectShape.mockClear();
        fake._lastShapeTap = null;
        click({ ...CLICK, originalEvent: { target: document.body } });
        expect(mocks.selectShape).toHaveBeenCalledWith('big');
    });

    it('un click déjà consommé par la pose d’un ping (preventDefault) : la zone n’est pas sélectionnée en plus', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake._initDrawingLayers();

        clickHandler(map)({ ...CLICK, defaultPrevented: true });

        expect(mocks.selectShape).not.toHaveBeenCalled();
    });

    it('outil de dessin actif : le click n’agit pas', () => {
        const { fake, map, mocks } = makeLayersThis({ shapes: [BIG] });
        map.queryRenderedFeatures.mockReturnValue([zoneF('big', 1_000)]);
        fake.drawTool = 'line';
        fake._initDrawingLayers();

        clickHandler(map)(CLICK);

        expect(mocks.selectShape).not.toHaveBeenCalled();
    });
});

describe('appui long — une zone ne bloque pas la pose d’un ping', () => {
    function startLongPress(hits: unknown[]): { open: ReturnType<typeof vi.fn> } {
        vi.useFakeTimers();
        const { fake, map } = makeLayersThis({ shapes: [BIG, LINE] });
        map.queryRenderedFeatures.mockReturnValue(hits);
        fake._wireLongPressForPing();
        const start = map.on.mock.calls.find((c) => c[0] === 'mousedown')?.[1] as (e: unknown) => void;
        start({
            point: { x: 100, y: 100 },
            lngLat: { lng: 2.3, lat: 48.8 },
            originalEvent: { clientX: 100, clientY: 100, target: document.body },
        });
        vi.advanceTimersByTime(480);
        return { open: fake._openCreatePingWheel as unknown as ReturnType<typeof vi.fn> };
    }

    it('appui long sur une zone seule : la roue de création de ping s’ouvre', () => {
        expect(startLongPress([zoneF('big', 1_000)]).open).toHaveBeenCalledWith({ lng: 2.3, lat: 48.8 });
    });

    it('appui long sur un trait (même sous une zone) : pas de ping, le trait gère', () => {
        expect(startLongPress([zoneF('big', 1_000), lineF('l1')]).open).not.toHaveBeenCalled();
    });

    it('appui long sur une mesure (feature sans shapeId) : toujours bloqué, comme avant', () => {
        expect(startLongPress([measureF()]).open).not.toHaveBeenCalled();
    });
});

describe('curseur au survol — « grab » seulement quand le glisser déplace la forme', () => {
    /** Survol de la couche `layerId` (fond de zone par défaut) ; le canevas factice rend le curseur lisible. */
    function hover(opts: { shapes: PlanShape[]; selected?: string | null; hits: unknown[]; layerId?: string; drawTool?: 'line' }) {
        const { fake, map } = makeLayersThis({ shapes: opts.shapes, selected: opts.selected ?? null });
        const canvas = { style: { cursor: '' } };
        map.getCanvas.mockReturnValue(canvas);
        map.queryRenderedFeatures.mockReturnValue(opts.hits);
        if (opts.drawTool) fake.drawTool = opts.drawTool;
        fake._initDrawingLayers();
        const layerId = opts.layerId ?? 'plan-shapes-fill';
        const call = map.on.mock.calls.find((c) => c[0] === 'mouseenter' && c[1] === layerId);
        if (!call) throw new Error(`aucun mouseenter posé sur ${layerId}`);
        (call[2] as (e: unknown) => void)({ point: { x: 40, y: 50 } });
        return { map, canvas, leave: map.on.mock.calls.find((c) => c[0] === 'mouseleave' && c[1] === layerId)?.[2] as () => void };
    }

    it('zone NON sélectionnée : le glisser y panote la carte, donc pas de « grab » (le clic la sélectionne : « pointer »)', () => {
        const { canvas } = hover({ shapes: [BIG], hits: [zoneF('big', 1_000)] });
        expect(canvas.style.cursor).toBe('pointer');
    });

    it('zone SÉLECTIONNÉE : « grab », le glisser la déplace', () => {
        const { canvas } = hover({ shapes: [BIG], selected: 'big', hits: [zoneF('big', 1_000)] });
        expect(canvas.style.cursor).toBe('grab');
    });

    it('zone sélectionnée mais FIGÉE : rien à déplacer, « pointer »', () => {
        const { canvas } = hover({ shapes: [{ ...BIG, locked: true }], selected: 'big', hits: [zoneF('big', 1_000)] });
        expect(canvas.style.cursor).toBe('pointer');
    });

    it('un trait sous la zone : « grab » (l’objet prime sur la zone, comme au toucher)', () => {
        const { canvas } = hover({ shapes: [BIG, LINE], hits: [zoneF('big', 1_000), lineF('l1')] });
        expect(canvas.style.cursor).toBe('grab');
    });

    it('survol d’un trait (sa zone de détection) : « grab » comme avant', () => {
        const { canvas } = hover({ shapes: [LINE], hits: [lineF('l1')], layerId: 'plan-shapes-line-hit' });
        expect(canvas.style.cursor).toBe('grab');
    });

    it('forme absente du stockage (supprimée dans un autre onglet) : « grab » comme avant, rien de plus fin à dire', () => {
        const { canvas } = hover({ shapes: [], hits: [zoneF('gone', 1_000)] });
        expect(canvas.style.cursor).toBe('grab');
    });

    it('outil de dessin actif : le curseur de l’outil n’est pas touché', () => {
        const { canvas } = hover({ shapes: [BIG], hits: [zoneF('big', 1_000)], drawTool: 'line' });
        expect(canvas.style.cursor).toBe('');
    });

    it('en quittant la forme, le curseur est rendu à la carte', () => {
        const { canvas, leave } = hover({ shapes: [BIG], hits: [zoneF('big', 1_000)] });
        leave();
        expect(canvas.style.cursor).toBe('');
    });
});

// ============================================================
// 4. Couches : zones dessous, opacité par zone
// ============================================================
type LayerSpec = {
    id: string;
    type: string;
    source?: string;
    filter?: unknown;
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
};

function drawLayerSpecs(): LayerSpec[] {
    const layersThis = makeLayersThis();
    layersThis.fake._initDrawingLayers();
    return layersThis.map.addLayer.mock.calls.map((c) => c[0] as LayerSpec);
}

function layer(id: string): LayerSpec {
    const found = drawLayerSpecs().find((l) => l.id === id);
    if (!found) throw new Error(`couche absente : ${id}`);
    return found;
}

/** Vrai si la couche retient cette feature (filtre MapLibre OFFICIEL). */
function layerKeeps(id: string, type: 'Polygon' | 'LineString', properties: Record<string, unknown>): boolean {
    const spec = layer(id);
    if (spec.filter === undefined) return true;
    return featureFilter(spec.filter as never).filter({ zoom: 0 }, { type, properties });
}

const ZONE_PROPS = { shapeId: 'z', zone: true, area: 10, fillOpacity: 0.18, strokeWidth: 3, color: '#ef4444' };
const LINE_PROPS = { shapeId: 'l1', strokeWidth: 3, color: '#22c55e' };
const MEASURE_PROPS = { color: '#22d3ee', strokeWidth: 3 };
const RING_PROPS = { color: '#22d3ee', strokeWidth: 2 };
const TEXT_HIT_PROPS = { shapeId: 't1', isText: true, color: '#fff' };

describe('couches de dessin — zones dessous (décision 1)', () => {
    it('empilement : zone (fond + contour) PUIS zone de détection des traits, traits, textes', () => {
        const ids = drawLayerSpecs().map((l) => l.id);
        expect(ids).toEqual([
            'buildings-3d',
            'plan-shapes-fill',
            'plan-shapes-zone-line',
            'plan-shapes-line-hit',
            'plan-shapes-line',
            'plan-shapes-text-hit',
            'plan-draw-preview-fill',
            'plan-draw-preview-line',
        ]);
    });

    it('le style complet passe le validateur MapLibre (aucune propriété invalide, source connue)', () => {
        const geojson = { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } };
        const style = {
            version: 8 as const,
            sources: {
                'plan-shapes-src': geojson,
                'plan-draw-preview-src': geojson,
                bdtopo: { type: 'vector' as const, tiles: ['https://exemple.test/{z}/{x}/{y}.pbf'] },
            },
            layers: drawLayerSpecs(),
        };
        expect(validateStyleMin(style as unknown as Parameters<typeof validateStyleMin>[0]).map((e) => e.message)).toEqual([]);
    });

    it('le fond de zone ne reçoit que des polygones (zones et anneaux), jamais les zones de détection de texte', () => {
        expect(layerKeeps('plan-shapes-fill', 'Polygon', ZONE_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-fill', 'Polygon', RING_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-fill', 'Polygon', TEXT_HIT_PROPS)).toBe(false);
        expect(layerKeeps('plan-shapes-fill', 'LineString', LINE_PROPS)).toBe(false);
    });

    it('le contour des ZONES est dans sa propre couche, sous celle des traits', () => {
        expect(layerKeeps('plan-shapes-zone-line', 'Polygon', ZONE_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-zone-line', 'LineString', LINE_PROPS)).toBe(false);
        expect(layerKeeps('plan-shapes-zone-line', 'LineString', MEASURE_PROPS)).toBe(false);
        expect(layerKeeps('plan-shapes-zone-line', 'Polygon', RING_PROPS)).toBe(false);
    });

    it('la couche des traits ne dessine PLUS les contours de zone, mais garde traits, mesures et anneaux', () => {
        expect(layerKeeps('plan-shapes-line', 'Polygon', ZONE_PROPS)).toBe(false);
        expect(layerKeeps('plan-shapes-line', 'LineString', LINE_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-line', 'LineString', MEASURE_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-line', 'Polygon', RING_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-line', 'Polygon', TEXT_HIT_PROPS)).toBe(false);
    });

    it('la zone de détection (hit) couvre tout sauf les textes : contours de zone compris', () => {
        expect(layerKeeps('plan-shapes-line-hit', 'Polygon', ZONE_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-line-hit', 'LineString', LINE_PROPS)).toBe(true);
        expect(layerKeeps('plan-shapes-line-hit', 'Polygon', TEXT_HIT_PROPS)).toBe(false);
    });

    it('le contour de zone garde l’épaisseur pilotée par la donnée (strokeWidth), comme les traits', () => {
        const width = layer('plan-shapes-zone-line').paint?.['line-width'];
        expect(width).toEqual(layer('plan-shapes-line').paint?.['line-width']);
        expect(JSON.stringify(width)).toContain('strokeWidth');
    });
});

describe('couche fond de zone — opacité par zone (décision 4)', () => {
    function fillOpacityOf(properties: Record<string, unknown>): number {
        const expression = layer('plan-shapes-fill').paint?.['fill-opacity'];
        const spec = (latest as unknown as { paint_fill: Record<string, unknown> }).paint_fill['fill-opacity'];
        const parsed = createPropertyExpression(expression, spec as Parameters<typeof createPropertyExpression>[1]);
        if (parsed.result !== 'success') throw new Error('expression fill-opacity invalide');
        return parsed.value.evaluate({ zoom: 0 }, { type: 'Polygon', properties }) as number;
    }

    it('lit la propriété fillOpacity de la zone', () => {
        expect(fillOpacityOf({ fillOpacity: 0.45 })).toBe(0.45);
        expect(fillOpacityOf({ fillOpacity: 1 })).toBe(1);
    });

    it('0 = contour seul : un fond de zone à 0, pas retombé sur le défaut', () => {
        expect(fillOpacityOf({ fillOpacity: 0 })).toBe(0);
    });

    it('sans propriété (anneaux d’engagement, anciennes features) : 0.18 comme avant', () => {
        expect(fillOpacityOf({})).toBe(0.18);
    });
});

// ============================================================
// 5. Rendu : features ordonnées, propriétés
// ============================================================
function makeRenderThis(shapes: PlanShape[], extra: Record<string, unknown> = {}) {
    localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes));
    const src = { setData: vi.fn() };
    const map = {
        getSource: vi.fn(() => src),
        // Zone de détection d'un texte libre : carré de 14 px projeté en degrés.
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng * 1000, y: ll.lat * 1000 })),
        unproject: vi.fn((p: [number, number]) => ({ lng: p[0] / 1000, lat: p[1] / 1000 })),
        getCanvas: vi.fn(() => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) })),
    };
    const fake = {
        ...createPlanMapState(),
        ...SafeMethods,
        ...GeoMethods,
        ...DrawToolsMethods,
        ...MapCoreMethods,
        ...ShapesRenderMethods,
        map,
        _renderShapeTexts: vi.fn(),
        _renderDiameters: vi.fn(),
        _renderCommittedMeasures: vi.fn(),
        _renderHandles: vi.fn(),
        _renderShapeLocks: vi.fn(),
        _updateFloatingToolbarPos: vi.fn(),
        _renderPins: vi.fn(),
        ...extra,
    } as unknown as PlanMapInternal;
    const features = (): GeoJSON.Feature[] => {
        const last = src.setData.mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection | undefined;
        return last ? last.features : [];
    };
    const stored = (): PlanShape[] => JSON.parse(localStorage.getItem(SHAPES_KEY) ?? '[]') as PlanShape[];
    return { fake, src, features, stored };
}

describe('_renderShapes — zones écrites en premier, donc rendues dessous (décision 1)', () => {
    it('les zones précèdent traits, textes et mesures, quel que soit l’ordre de dessin', () => {
        const { fake, features } = makeRenderThis([LINE, SMALL, TEXT, BIG, MEASURE]);
        fake._renderShapes();
        expect(features().map((f) => f.id)).toEqual(['big', 'small', 'l1', 't1', 'm1']);
    });

    it('entre zones : la plus grande dessous, la plus petite dessus (elle reste visible et attrapable)', () => {
        const { fake, features } = makeRenderThis([SMALL, BIG]);
        fake._renderShapes();
        expect(features().map((f) => f.id)).toEqual(['big', 'small']);
        // Stable : à surface égale, l’ordre de dessin est gardé.
        const twin: PlanShape = { ...BIG, id: 'twin' };
        const again = makeRenderThis([twin, BIG]);
        again.fake._renderShapes();
        expect(again.features().map((f) => f.id)).toEqual(['twin', 'big']);
    });

    it('les anneaux d’engagement (mesures) restent au-dessus des zones', () => {
        const rings: PlanShape = {
            id: 'r1', type: 'measure-rings', color: '#22d3ee',
            rings: [{ radiusM: 50, coords: circlePolygon([2, 48], [2, 48.0005]) }],
        };
        const { fake, features } = makeRenderThis([rings, BIG]);
        fake._renderShapes();
        const feats = features();
        expect(feats).toHaveLength(2);
        expect(feats[0]?.id).toBe('big');
        expect(feats[1]?.properties?.zone).toBeUndefined();
    });

    it('marque les zones (zone, surface, opacité) ; les traits, textes et mesures ne sont pas des zones', () => {
        const { fake, features } = makeRenderThis([BIG, LINE, TEXT, MEASURE]);
        fake._renderShapes();
        const byId = new Map(features().map((f) => [String(f.id), f.properties ?? {}]));
        expect(byId.get('big')).toMatchObject({ shapeId: 'big', zone: true, fillOpacity: 0.18 });
        expect(byId.get('big')?.area).toBeCloseTo(polygonAreaM2(BIG.coords ?? []), 3);
        for (const id of ['l1', 't1', 'm1']) {
            expect(byId.get(id)?.zone, id).toBeUndefined();
            expect(byId.get(id)?.fillOpacity, id).toBeUndefined();
        }
    });

    it('fillOpacity : absent → 0.18, 0 → 0 (contour seul), valeur persistée reprise, corrompue → 0.18', () => {
        const { fake, features } = makeRenderThis([
            { ...BIG, id: 'absent' },
            { ...BIG, id: 'zero', fillOpacity: 0 },
            { ...BIG, id: 'mid', fillOpacity: 0.45 },
            { ...BIG, id: 'bad', fillOpacity: 7 },
            { ...BIG, id: 'txt', fillOpacity: '0.5' as unknown as number },
        ]);
        fake._renderShapes();
        const byId = new Map(features().map((f) => [String(f.id), f.properties?.fillOpacity]));
        expect(byId.get('absent')).toBe(0.18);
        expect(byId.get('zero')).toBe(0);
        expect(byId.get('mid')).toBe(0.45);
        expect(byId.get('bad')).toBe(0.18);
        expect(byId.get('txt')).toBe(0.18);
    });

    it('l’épaisseur de trait des zones est inchangée (strokeWidth, défaut 3)', () => {
        const { fake, features } = makeRenderThis([BIG, { ...SMALL, strokeWidth: 8 }]);
        fake._renderShapes();
        const byId = new Map(features().map((f) => [String(f.id), f.properties?.strokeWidth]));
        expect(byId.get('big')).toBe(3);
        expect(byId.get('small')).toBe(8);
    });
});

describe('nom d’une zone (étiquette DOM) — comme la zone, il ne saisit pas le geste', () => {
    function pressLabel(shapes: PlanShape[], id: string, selected: string | null): { startShapeGesture: ReturnType<typeof vi.fn>; ev: Event } {
        const startShapeGesture = vi.fn();
        const { fake } = makeRenderThis(shapes, {
            _renderShapeTexts: ShapesRenderMethods._renderShapeTexts,
            _shapeGrabsPress: ShapesGesturesMethods._shapeGrabsPress,
            _startShapeGesture: startShapeGesture,
            _selectedShapeId: selected,
        });
        fake._renderShapeTexts();
        const marker = fake._textMarkersById?.[id];
        const label = marker?.getElement().querySelector('.plan-shape-text');
        if (!label) throw new Error(`pas d'étiquette pour ${id}`);
        const ev = new Event('pointerdown', { cancelable: true, bubbles: true });
        label.dispatchEvent(ev);
        return { startShapeGesture, ev };
    }

    it('zone NON sélectionnée : l’appui passe à la carte (ni preventDefault, ni geste de forme)', () => {
        const { startShapeGesture, ev } = pressLabel([{ ...BIG, text: 'Zone A' }], 'big', null);
        expect(startShapeGesture).not.toHaveBeenCalled();
        expect(ev.defaultPrevented).toBe(false);
    });

    it('zone SÉLECTIONNÉE : saisie comme avant', () => {
        const { startShapeGesture, ev } = pressLabel([{ ...BIG, text: 'Zone A' }], 'big', 'big');
        expect(startShapeGesture.mock.calls[0]?.[0]).toBe('big');
        expect(ev.defaultPrevented).toBe(true);
    });

    it('zone sélectionnée mais figée : l’appui passe à la carte', () => {
        const { startShapeGesture } = pressLabel([{ ...BIG, text: 'Zone A', locked: true }], 'big', 'big');
        expect(startShapeGesture).not.toHaveBeenCalled();
    });

    it('nom d’un trait et texte libre : toujours saisis (objets)', () => {
        expect(pressLabel([{ ...LINE, text: 'Axe' }], 'l1', null).startShapeGesture).toHaveBeenCalledTimes(1);
        expect(pressLabel([TEXT], 't1', null).startShapeGesture).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// 6. Réglage : _adjustFillOpacity, annulation, synchro onglets
// ============================================================
describe('_adjustFillOpacity — paliers, contour seul, annulable', () => {
    it('+ : du défaut 0.18 au palier suivant ; - : au précédent ; persisté sur la forme', () => {
        const { fake, stored } = makeRenderThis([BIG]);
        fake._adjustFillOpacity('big', +1);
        expect(stored()[0]?.fillOpacity).toBe(0.3);
        fake._adjustFillOpacity('big', -1);
        fake._adjustFillOpacity('big', -1);
        expect(stored()[0]?.fillOpacity).toBe(0.08);
    });

    it('jusqu’à « contour seul » (0), puis plus bas ne bouge plus et n’encombre pas l’historique', () => {
        const { fake, stored } = makeRenderThis([BIG]);
        fake._adjustFillOpacity('big', -1);
        fake._adjustFillOpacity('big', -1);
        expect(stored()[0]?.fillOpacity).toBe(0);
        const before = fake.history.length;
        fake._adjustFillOpacity('big', -1);
        expect(stored()[0]?.fillOpacity).toBe(0);
        expect(fake.history.length).toBe(before);
    });

    it('au plus haut palier, + ne bouge plus', () => {
        const top = ZONE_FILL_LEVELS[ZONE_FILL_LEVELS.length - 1];
        const { fake, stored } = makeRenderThis([{ ...BIG, fillOpacity: top as number }]);
        fake._adjustFillOpacity('big', +1);
        expect(stored()[0]?.fillOpacity).toBe(top);
    });

    it('valeur hors paliers (importée) : + va au palier STRICTEMENT supérieur, - au palier strictement inférieur', () => {
        const up = makeRenderThis([{ ...BIG, fillOpacity: 0.5 }]);
        up.fake._adjustFillOpacity('big', +1);
        expect(up.stored()[0]?.fillOpacity).toBe(0.6);
        const down = makeRenderThis([{ ...BIG, fillOpacity: 0.5 }]);
        down.fake._adjustFillOpacity('big', -1);
        expect(down.stored()[0]?.fillOpacity).toBe(0.45);
    });

    it('repeint la source avec la nouvelle opacité et rafraîchit poignées/annuler', () => {
        const { fake, features } = makeRenderThis([BIG]);
        fake._adjustFillOpacity('big', +1);
        expect(features()[0]?.properties?.fillOpacity).toBe(0.3);
        expect(fake._renderHandles).toHaveBeenCalled();
    });

    it('annulable (Ctrl+Z) : retrouve l’opacité d’avant, y compris « absente »', () => {
        const { fake, stored } = makeRenderThis([BIG]);
        fake._adjustFillOpacity('big', -1);
        expect(stored()[0]?.fillOpacity).toBe(0.08);
        fake._undo();
        expect(stored()[0]?.fillOpacity).toBeUndefined();
        fake._redo();
        expect(stored()[0]?.fillOpacity).toBe(0.08);
    });

    it('ne concerne que les zones : un trait, un texte ou une forme inconnue sont laissés tels quels', () => {
        const { fake, stored } = makeRenderThis([LINE, TEXT]);
        const before = JSON.stringify(stored());
        fake._adjustFillOpacity('l1', +1);
        fake._adjustFillOpacity('t1', +1);
        fake._adjustFillOpacity('absent', +1);
        expect(JSON.stringify(stored())).toBe(before);
        expect(fake.history).toHaveLength(0);
    });

    it('ne touche à aucune autre propriété de la forme (épaisseur, verrou, texte)', () => {
        const rich: PlanShape = { ...BIG, strokeWidth: 6, locked: true, text: 'ZONE', textColor: '#fff' };
        const { fake, stored } = makeRenderThis([rich]);
        fake._adjustFillOpacity('big', +1);
        expect(stored()[0]).toEqual({ ...rich, fillOpacity: 0.3 });
    });
});

describe('synchro inter-onglets — l’opacité voyage avec la forme', () => {
    it('un réglage fait dans un autre onglet est relu du stockage et repeint à l’identique', () => {
        const { fake, features } = makeRenderThis([BIG]);
        fake._renderShapes();
        expect(features()[0]?.properties?.fillOpacity).toBe(0.18);

        // L’autre onglet règle le fond puis annonce la clé du plan.
        localStorage.setItem(SHAPES_KEY, JSON.stringify([{ ...BIG, fillOpacity: 0 }]));
        fake._onRemotePlanData('pcTacPlanShapes');

        expect(features()[0]?.properties?.fillOpacity).toBe(0);
    });

    it('un réglage reçu pendant un geste est rejoué à la fin du geste, avec la bonne opacité', () => {
        const { fake, features } = makeRenderThis([BIG]);
        fake._gesture = { shapeId: 'big' };
        localStorage.setItem(SHAPES_KEY, JSON.stringify([{ ...BIG, fillOpacity: 0.6 }]));
        fake._onRemotePlanData('pcTacPlanShapes');
        expect(features()).toHaveLength(0);

        fake._gesture = null;
        fake._flushPendingRemoteReload();
        expect(features()[0]?.properties?.fillOpacity).toBe(0.6);
    });
});

// ============================================================
// 7. Roue de la forme : Remplissage -/+ (comme Épaisseur -/+)
// ============================================================
function makeWheelThis(shapes: PlanShape[]) {
    const mocks = {
        adjustFillOpacity: vi.fn(),
        adjustStrokeWidth: vi.fn(),
    };
    const fake = {
        map: null,
        _activeWheel: null,
        _wheelJustClosed: 0,
        _diameterGlobal: true,
        _loadShapes: () => shapes,
        _saveShapes: vi.fn(),
        _pushHistory: vi.fn(),
        _deselectShape: vi.fn(),
        _renderShapes: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
        _openTextModal: vi.fn(),
        _adjustFontSize: vi.fn(),
        _adjustStrokeWidth: mocks.adjustStrokeWidth,
        _adjustFillOpacity: mocks.adjustFillOpacity,
        _toggleShapeDiameter: vi.fn(),
        _toggleShapeLock: vi.fn(),
        ...WheelsMethods,
    } as unknown as PlanMapInternal;
    const button = (title: string): HTMLButtonElement | undefined =>
        Array.from(document.body.querySelectorAll<HTMLButtonElement>('.plan-wheel button')).find((b) => b.title === title);
    return { fake, mocks, button };
}

describe('roue de la forme — « Remplissage -/+ » sur les zones', () => {
    it.each([['rectangle'], ['circle']] as const)('%s : Remplissage - / + règlent l’opacité, la roue reste ouverte', (type) => {
        const zone: PlanShape = type === 'circle' ? { ...SMALL, id: 'z1' } : { ...BIG, id: 'z1' };
        const { fake, mocks, button } = makeWheelThis([zone]);
        fake._openShapeWheel('z1', { lng: 2, lat: 48 });

        button('Remplissage -')?.click();
        button('Remplissage +')?.click();

        expect(mocks.adjustFillOpacity.mock.calls).toEqual([['z1', -1], ['z1', +1]]);
        // keepOpen : réglages enchaînés sans rouvrir la roue.
        expect(document.body.querySelector('.plan-wheel')).not.toBeNull();
        expect(fake._activeWheel).not.toBeNull();
    });

    it('les boutons d’épaisseur restent à leur place (Épaisseur -/+ inchangés)', () => {
        const { fake, mocks, button } = makeWheelThis([{ ...BIG, id: 'z1' }]);
        fake._openShapeWheel('z1', null);
        button('Épaisseur +')?.click();
        expect(mocks.adjustStrokeWidth).toHaveBeenCalledWith('z1', +1);
    });

    it('trait et texte libre : pas de remplissage à régler', () => {
        const line = makeWheelThis([LINE]);
        line.fake._openShapeWheel('l1', null);
        expect(line.button('Remplissage +')).toBeUndefined();
        expect(line.button('Remplissage -')).toBeUndefined();
        document.body.innerHTML = '';

        const text = makeWheelThis([TEXT]);
        text.fake._openShapeWheel('t1', null);
        expect(text.button('Remplissage +')).toBeUndefined();
    });
});
