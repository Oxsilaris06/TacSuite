/**
 * pm-geo.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-geo` :
 * `planmap/geo.ts` (12 méthodes pures + `shapeCoords`/`coordAt`) et
 * `planmap/tiles.ts` (9 fonctions XYZ). Écrit AVANT le port (TDD strict,
 * mission P2.CONV). Références `planMap.js:<ligne>` en commentaire.
 *
 * Valeurs de référence : calculées en exécutant les fonctions VERBATIM de
 * `planMap.js` (mêmes formules, mêmes constantes R=6371000, N=64, MAX_RETRY=3,
 * backoff 400·2^n) dans Node (`node --input-type=module`), cf.
 * docs/SPEC-PLANMAP-SPLIT.md §9. Provenance détaillée dans le compte-rendu
 * final de l'agent (pas dans ce fichier).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAT_TILE_TEMPLATE } from '../../../src/apps/pctac/planmap/constants.js';
import {
    GeoMethods,
    circleDiameter,
    circlePolygon,
    coordAt,
    formatBearing,
    formatDistance,
    geoEdgeNorth,
    haversineMeters,
    measureTotalMeters,
    parseGps,
    rectPolygon,
    shapeAnchor,
    shapeCentroid,
    shapeCoords,
    trueBearing,
} from '../../../src/apps/pctac/planmap/geo.js';
import {
    enumerateTiles,
    estimateTileCount,
    fillTileTemplate,
    lat2tile,
    lon2tile,
    prefetchFranceTiles,
    prefetchTiles,
    styleTileTemplates,
    tileUrl,
} from '../../../src/apps/pctac/planmap/tiles.js';
import type { GeoBBox, LngLatTuple, PlanShape, PrefetchOptions, TileTemplate } from '../../../src/apps/pctac/planmap/types.js';

/* ─────────────────────────────────────────────────────────────────────────
 * geo.ts
 * ───────────────────────────────────────────────────────────────────── */

describe('geo.ts — haversineMeters (planMap.js:2712-2720)', () => {
    it('Paris → Lyon ≈ 391498.93 m (référence calculée en Node depuis la formule verbatim)', () => {
        const paris: LngLatTuple = [2.3522, 48.8566];
        const lyon: LngLatTuple = [4.8357, 45.7640];
        expect(haversineMeters(paris, lyon)).toBeCloseTo(391498.93167425727, 6);
    });

    it('distance nulle entre deux points identiques', () => {
        expect(haversineMeters([2, 48], [2, 48])).toBe(0);
    });
});

describe('geo.ts — trueBearing (planMap.js:2276-2284)', () => {
    it('Paris → Lyon ≈ 150.51245022567218° (référence calculée en Node)', () => {
        const paris: LngLatTuple = [2.3522, 48.8566];
        const lyon: LngLatTuple = [4.8357, 45.7640];
        expect(trueBearing(paris, lyon)).toBeCloseTo(150.51245022567218, 9);
    });

    it('Lyon → Paris ≈ 332.33870968700353° (asymétrie attendue, pas un simple +180°)', () => {
        const paris: LngLatTuple = [2.3522, 48.8566];
        const lyon: LngLatTuple = [4.8357, 45.7640];
        expect(trueBearing(lyon, paris)).toBeCloseTo(332.33870968700353, 9);
    });

    it('plein nord = 0°, plein est ≈ 89.63° (mêmes latitudes, delta longitude positif)', () => {
        expect(trueBearing([2, 48], [2, 49])).toBe(0);
        expect(trueBearing([2, 48], [3, 48])).toBeCloseTo(89.62842336406771, 9);
    });
});

describe('geo.ts — formatBearing (planMap.js:2292-2294) — padding à 3 chiffres', () => {
    it.each<[number, string]>([
        [0, '000°'],
        [5.4, '005°'],
        [45.6, '046°'],
        [359.6, '360°'],
    ])('formatBearing(%s) === %s', (deg, expected) => {
        expect(formatBearing(deg)).toBe(expected);
    });
});

describe('geo.ts — formatDistance (planMap.js:2723-2728) — 5 paliers', () => {
    it('valeurs non finies ou <= 0 → chaîne vide', () => {
        expect(formatDistance(0)).toBe('');
        expect(formatDistance(-5)).toBe('');
        expect(formatDistance(NaN)).toBe('');
        expect(formatDistance(Infinity)).toBe('');
    });

    it('< 1 m → centimètres arrondis', () => {
        expect(formatDistance(0.5)).toBe('50 cm');
    });

    it('< 1000 m → mètres arrondis', () => {
        expect(formatDistance(999)).toBe('999 m');
        // 999.6 s'arrondit à 1000 (Math.round), reste dans la branche "m"
        // car le test de palier `m < 1000` porte sur la valeur SOURCE, pas
        // sur l'arrondi — comportement verbatim de l'original.
        expect(formatDistance(999.6)).toBe('1000 m');
    });

    it('< 10000 m → kilomètres, 2 décimales', () => {
        expect(formatDistance(1000)).toBe('1.00 km');
        expect(formatDistance(5000)).toBe('5.00 km');
        expect(formatDistance(9999)).toBe('10.00 km');
    });

    it('>= 10000 m → kilomètres, 1 décimale', () => {
        expect(formatDistance(10000)).toBe('10.0 km');
        expect(formatDistance(15000)).toBe('15.0 km');
    });
});

describe('geo.ts — circlePolygon (planMap.js:4976-5004)', () => {
    it('65 points (N=64 segments fermés), premier === dernier', () => {
        const center: LngLatTuple = [2.3522, 48.8566];
        const edge = geoEdgeNorth(center, 1000);
        const poly = circlePolygon(center, edge);
        expect(poly).toHaveLength(65);
        expect(poly[0]).toEqual(poly[64]);
    });

    it('rayon mesuré (Haversine) proche du rayon demandé, à toute latitude', () => {
        const center: LngLatTuple = [2.3522, 48.8566];
        const edge = geoEdgeNorth(center, 500);
        const poly = circlePolygon(center, edge);
        const p0 = poly[0];
        expect(p0).toBeDefined();
        if (!p0) return;
        expect(haversineMeters(center, p0)).toBeCloseTo(500, 3);
    });
});

describe('geo.ts — geoEdgeNorth (planMap.js:5006-5017) — rayon exact à 3 latitudes', () => {
    it.each<[number]>([[0], [45], [89]])('à la latitude %s°, haversineMeters(centre, edge) === radiusM', (lat) => {
        const center: LngLatTuple = [2, lat];
        const radiusM = 1000;
        const edge = geoEdgeNorth(center, radiusM);
        // Diff mesurée en Node ~1e-10 à 1e-13 (erreur flottante pure) : le
        // rayon est exact au nanomètre près, cf. commentaire d'invariant de
        // `_geoEdgeNorth` (même R que _haversineMeters).
        expect(haversineMeters(center, edge)).toBeCloseTo(radiusM, 6);
        // Déplacement plein nord uniquement (Δlng = 0).
        expect(edge[0]).toBe(center[0]);
        expect(edge[1]).toBeGreaterThan(center[1]);
    });
});

describe('geo.ts — rectPolygon (planMap.js:4964-4972) — 5 points fermés', () => {
    it('polygone [a, (b.lng,a.lat), b, (a.lng,b.lat), a]', () => {
        const a: LngLatTuple = [1, 2];
        const b: LngLatTuple = [3, 4];
        expect(rectPolygon(a, b)).toEqual([
            [1, 2],
            [3, 2],
            [3, 4],
            [1, 4],
            [1, 2],
        ]);
    });
});

describe('geo.ts — parseGps (planMap.js:811-822)', () => {
    it('accepte les séparateurs virgule, point-virgule et espace', () => {
        expect(parseGps('48.8566, 2.3522')).toEqual({ lat: 48.8566, lng: 2.3522 });
        expect(parseGps('48.8566;2.3522')).toEqual({ lat: 48.8566, lng: 2.3522 });
        expect(parseGps('48.8566 2.3522')).toEqual({ lat: 48.8566, lng: 2.3522 });
    });

    it('gère la virgule décimale française', () => {
        expect(parseGps('48,8566, 2,3522')).toEqual({ lat: 48.8566, lng: 2.3522 });
    });

    it('accepte les bornes exactes ±90/±180', () => {
        expect(parseGps('90, 180')).toEqual({ lat: 90, lng: 180 });
        expect(parseGps('-90, -180')).toEqual({ lat: -90, lng: -180 });
    });

    it('rejette hors bornes, non-numérique, format incomplet ou surnuméraire', () => {
        expect(parseGps('90.0001, 0')).toBeNull();
        expect(parseGps('0, 180.0001')).toBeNull();
        expect(parseGps('abc')).toBeNull();
        expect(parseGps('48.8566')).toBeNull();
        expect(parseGps('48.8566, 2.3522, 5')).toBeNull();
    });
});

describe('geo.ts — shapeCoords / coordAt (helpers imposés §6.3)', () => {
    it('shapeCoords retourne s.coords, ou [] si absent (measure-rings)', () => {
        const withCoords: PlanShape = { id: '1', type: 'line', coords: [[1, 1], [2, 2]] };
        const withoutCoords: PlanShape = { id: '2', type: 'measure-rings' };
        expect(shapeCoords(withCoords)).toEqual([[1, 1], [2, 2]]);
        expect(shapeCoords(withoutCoords)).toEqual([]);
    });

    it('coordAt retourne shapeCoords(s)[i], ou [0,0] hors bornes', () => {
        const s: PlanShape = { id: '1', type: 'line', coords: [[5, 6]] };
        expect(coordAt(s, 0)).toEqual([5, 6]);
        expect(coordAt(s, 3)).toEqual([0, 0]);
    });
});

describe('geo.ts — circleDiameter (planMap.js:2731-2735)', () => {
    it('center/edge explicites : diamètre = 2 × distance(center, edge)', () => {
        const center: LngLatTuple = [2, 48];
        const edge = geoEdgeNorth(center, 500);
        const s: PlanShape = { id: '1', type: 'circle', center, edge };
        expect(circleDiameter(s)).toBeCloseTo(1000, 3);
    });

    it('ni center/edge ni coords → 0 (branche vivante, PAS un repli coordAt)', () => {
        const s: PlanShape = { id: '1', type: 'measure-rings' };
        expect(circleDiameter(s)).toBe(0);
    });

    it('repli sur coords[0]/coords[floor(len/4)] quand center/edge absents', () => {
        const s: PlanShape = { id: '1', type: 'circle', coords: [[0, 0], [0, 0], [0, 0], [0, 0]] };
        // floor(4/4) = 1 → coords[0] et coords[1], tous deux [0,0] → distance nulle.
        expect(circleDiameter(s)).toBe(0);
    });
});

describe('geo.ts — shapeCentroid (planMap.js:3067-3077)', () => {
    it('line : milieu des deux extrémités', () => {
        const s: PlanShape = { id: '1', type: 'line', coords: [[0, 0], [2, 2]] };
        expect(shapeCentroid(s)).toEqual([1, 1]);
    });

    it('rectangle : centre de la bbox', () => {
        const s: PlanShape = { id: '1', type: 'rectangle', coords: rectPolygon([0, 0], [2, 4]) };
        expect(shapeCentroid(s)).toEqual([1, 2]);
    });

    it('circle : center si présent', () => {
        const s: PlanShape = { id: '1', type: 'circle', center: [5, 6] };
        expect(shapeCentroid(s)).toEqual([5, 6]);
    });

    it('circle : repli coords[0] si center absent', () => {
        const s: PlanShape = { id: '1', type: 'circle', coords: [[7, 8]] };
        expect(shapeCentroid(s)).toEqual([7, 8]);
    });

    it('text : coords[0]', () => {
        const s: PlanShape = { id: '1', type: 'text', coords: [[9, 9]] };
        expect(shapeCentroid(s)).toEqual([9, 9]);
    });

    it('type inconnu de cette liste (measure) : [0,0]', () => {
        const s: PlanShape = { id: '1', type: 'measure' };
        expect(shapeCentroid(s)).toEqual([0, 0]);
    });
});

describe('geo.ts — shapeAnchor (planMap.js:4722-4741)', () => {
    it('line/rectangle/circle/text : même géométrie que shapeCentroid, en {lng,lat}', () => {
        const line: PlanShape = { id: '1', type: 'line', coords: [[0, 0], [2, 2]] };
        expect(shapeAnchor(line)).toEqual({ lng: 1, lat: 1 });

        const rect: PlanShape = { id: '2', type: 'rectangle', coords: rectPolygon([0, 0], [2, 4]) };
        expect(shapeAnchor(rect)).toEqual({ lng: 1, lat: 2 });

        const circle: PlanShape = { id: '3', type: 'circle', center: [5, 6] };
        expect(shapeAnchor(circle)).toEqual({ lng: 5, lat: 6 });

        const text: PlanShape = { id: '4', type: 'text', coords: [[9, 9]] };
        expect(shapeAnchor(text)).toEqual({ lng: 9, lat: 9 });
    });

    it('type inconnu de cette liste (measure) : null', () => {
        const s: PlanShape = { id: '1', type: 'measure' };
        expect(shapeAnchor(s)).toBeNull();
    });
});

describe('geo.ts — measureTotalMeters (planMap.js:2343-2349)', () => {
    it('somme des segments consécutifs (Haversine)', () => {
        const a: LngLatTuple = [2, 48];
        const b: LngLatTuple = [2, 48.01];
        const c: LngLatTuple = [2.01, 48.01];
        const expected = haversineMeters(a, b) + haversineMeters(b, c);
        expect(measureTotalMeters([a, b, c])).toBeCloseTo(expected, 9);
    });

    it('0 ou 1 sommet → 0', () => {
        expect(measureTotalMeters([])).toBe(0);
        expect(measureTotalMeters([[2, 48]])).toBe(0);
    });
});

describe('geo.ts — GeoMethods (délégation one-liner, sans this, planMap.js §1.3)', () => {
    it('chaque méthode délègue à sa fonction pure homonyme', () => {
        expect(GeoMethods._haversineMeters([2, 48], [3, 49])).toBe(haversineMeters([2, 48], [3, 49]));
        expect(GeoMethods._trueBearing([2, 48], [3, 49])).toBe(trueBearing([2, 48], [3, 49]));
        expect(GeoMethods._formatBearing(12.3)).toBe(formatBearing(12.3));
        expect(GeoMethods._formatDistance(1500)).toBe(formatDistance(1500));
        expect(GeoMethods._parseGps('48.8566, 2.3522')).toEqual(parseGps('48.8566, 2.3522'));
        expect(GeoMethods._rectPolygon([0, 0], [1, 1])).toEqual(rectPolygon([0, 0], [1, 1]));
        expect(GeoMethods._geoEdgeNorth([0, 0], 100)).toEqual(geoEdgeNorth([0, 0], 100));
        expect(GeoMethods._circlePolygon([0, 0], [0, 1])).toEqual(circlePolygon([0, 0], [0, 1]));
        const s: PlanShape = { id: '1', type: 'circle', center: [1, 1] };
        expect(GeoMethods._shapeCentroid(s)).toEqual(shapeCentroid(s));
        expect(GeoMethods._shapeAnchor(s)).toEqual(shapeAnchor(s));
        expect(GeoMethods._circleDiameter(s)).toBe(circleDiameter(s));
        expect(GeoMethods._measureTotalMeters([[0, 0], [0, 1]])).toBe(measureTotalMeters([[0, 0], [0, 1]]));
    });
});

/* ─────────────────────────────────────────────────────────────────────────
 * tiles.ts
 * ───────────────────────────────────────────────────────────────────── */

describe('tiles.ts — lon2tile / lat2tile (planMap.js:157-163) — valeurs OSM connues', () => {
    it('Paris (2.3522, 48.8566) à z=10 → (518, 352), à z=14 → (8299, 5636)', () => {
        expect(lon2tile(2.3522, 10)).toBe(518);
        expect(lat2tile(48.8566, 10)).toBe(352);
        expect(lon2tile(2.3522, 14)).toBe(8299);
        expect(lat2tile(48.8566, 14)).toBe(5636);
    });

    it('bornes du monde à z=0 : une seule tuile (0,0)', () => {
        expect(lon2tile(-180, 0)).toBe(0);
        expect(lon2tile(179.9, 0)).toBe(0);
    });

    it('équateur/méridien à z=1 → tuile (1,1) (quadrant sud-est)', () => {
        expect(lon2tile(0, 1)).toBe(1);
        expect(lat2tile(0, 1)).toBe(1);
    });
});

describe('tiles.ts — fillTileTemplate (planMap.js:165-167) — ordre du template respecté', () => {
    it('template ESRI réel {z}/{y}/{x} : l’ordre y-avant-x est préservé dans l’URL', () => {
        expect(fillTileTemplate(SAT_TILE_TEMPLATE, 12, 2050, 1364)).toBe(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1364/2050'
        );
    });

    it('template synthétique à ordre arbitraire', () => {
        expect(fillTileTemplate('a/{z}/{y}/{x}/b', 5, 7, 6)).toBe('a/5/6/7/b');
    });
});

describe('tiles.ts — tileUrl (planMap.js:168-170) — code mort conservé, toujours correct', () => {
    it('délègue à fillTileTemplate(SAT_TILE_TEMPLATE, …)', () => {
        expect(tileUrl(1, 2, 3)).toBe(fillTileTemplate(SAT_TILE_TEMPLATE, 1, 2, 3));
    });
});

describe('tiles.ts — styleTileTemplates (planMap.js:132-155)', () => {
    it('extrait satellite / ign-ortho / terrain-dem de RASTER_STYLE', () => {
        const templates = styleTileTemplates();
        expect(templates.map(t => t.id).sort()).toEqual(['ign-ortho', 'satellite', 'terrain-dem']);

        const sat = templates.find(t => t.id === 'satellite');
        expect(sat).toBeDefined();
        if (sat) {
            expect(sat.minzoom).toBe(0);
            expect(sat.maxzoom).toBe(19);
            expect(sat.bounds).toBeNull();
        }

        const ign = templates.find(t => t.id === 'ign-ortho');
        expect(ign).toBeDefined();
        if (ign) {
            expect(ign.minzoom).toBe(11);
            expect(ign.maxzoom).toBe(19);
            expect(ign.bounds).toEqual([-5.6, 41.1, 9.8, 51.3]);
        }
    });
});

describe('tiles.ts — enumerateTiles vs estimateTileCount (planMap.js:172-233) — propriété invariante', () => {
    const satTpl: TileTemplate = { id: 'satellite', url: 'https://esri.test/{z}/{y}/{x}', minzoom: 0, maxzoom: 19, bounds: null };
    const ignTpl: TileTemplate = {
        id: 'ign-ortho', url: 'https://ign.test/{z}/{x}/{y}', minzoom: 11, maxzoom: 19,
        bounds: [-5.6, 41.1, 9.8, 51.3],
    };

    it.each<[string, GeoBBox, number, number, TileTemplate[], number]>([
        ['Paris z11-13 (sat+ign)', { west: 2.2, south: 48.8, east: 2.5, north: 48.9 }, 11, 13, [satTpl, ignTpl], 106],
        ['New York z11-13 (sat+ign)', { west: -74.1, south: 40.6, east: -73.9, north: 40.8 }, 11, 13, [satTpl, ignTpl], 62],
        ['France z0-2 (sat seul)', { west: -5.6, south: 41.1, east: 9.8, north: 51.3 }, 0, 2, [satTpl], 5],
        ['Paris z5-8 (sat seul)', { west: 2.0, south: 48.7, east: 2.6, north: 49.0 }, 5, 8, [satTpl], 8],
    ])('%s : enumerateTiles().length === estimateTileCount() === %i', (_label, bbox, minZ, maxZ, templates, expected) => {
        const enumerated = enumerateTiles(bbox, minZ, maxZ, templates);
        const estimated = estimateTileCount(bbox, minZ, maxZ, templates);
        expect(enumerated).toHaveLength(expected);
        expect(estimated).toBe(expected);
        expect(enumerated.length).toBe(estimated);
    });

    it('monde entier, template mono-zoom z=3 → 8×8 = 64 tuiles (2^z par axe)', () => {
        const worldBbox: GeoBBox = { west: -180, south: -85, east: 180, north: 85 };
        const tpl: TileTemplate = { id: 'mixed', url: 'https://x.test/{z}/{x}/{y}', minzoom: 3, maxzoom: 3, bounds: null };
        expect(enumerateTiles(worldBbox, 0, 10, [tpl])).toHaveLength(64);
        expect(estimateTileCount(worldBbox, 0, 10, [tpl])).toBe(64);
    });

    it('bbox hors couverture IGN (New York) ⇒ 0 tuile IGN, alors que satellite en produit', () => {
        const nyBbox: GeoBBox = { west: -74.1, south: 40.6, east: -73.9, north: 40.8 };
        expect(enumerateTiles(nyBbox, 11, 13, [ignTpl])).toHaveLength(0);
        expect(estimateTileCount(nyBbox, 11, 13, [ignTpl])).toBe(0);
        expect(enumerateTiles(nyBbox, 11, 13, [satTpl]).length).toBeGreaterThan(0);
    });
});

/* ─── helpers réponse fetch / cache pour prefetchTiles ─────────────────── */

function okResponse(): Response {
    return {
        ok: true,
        type: 'basic',
        clone() { return this; },
    } as unknown as Response;
}

function makeSingleTileTemplates(n: number): TileTemplate[] {
    // z=0 : une seule tuile au monde par template (nbT=1) → n templates
    // produisent exactement n tuiles, indépendamment de la géométrie du bbox.
    return Array.from({ length: n }, (_v, i) => ({
        id: `t${i}`,
        url: `https://example.test/{z}/{x}/{y}/t${i}`,
        minzoom: 0,
        maxzoom: 0,
        bounds: null,
    }));
}

const WORLD_BBOX: GeoBBox = { west: -180, south: -85, east: 180, north: 85 };

describe('tiles.ts — prefetchTiles (planMap.js:235-287)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('concurrence plafonnée à 6 (8 tuiles à traiter, jamais plus de 6 fetch en vol)', async () => {
        const templates = makeSingleTileTemplates(8);
        const cachePutUrls: string[] = [];
        vi.stubGlobal('caches', {
            open: async () => ({
                match: async () => undefined,
                put: async (url: string) => { cachePutUrls.push(String(url)); },
            }),
        } as unknown as CacheStorage);

        const pending = new Map<string, (r: Response) => void>();
        let active = 0;
        let maxActive = 0;
        const fetchImpl: typeof fetch = (input) => {
            const url = String(input);
            active++;
            maxActive = Math.max(maxActive, active);
            return new Promise<Response>((resolve) => {
                pending.set(url, (r) => { active--; resolve(r); });
            });
        };
        vi.stubGlobal('fetch', fetchImpl);

        const resultPromise = prefetchTiles(WORLD_BBOX, 0, 0, templates);

        await vi.waitFor(() => {
            if (pending.size !== 6) throw new Error(`en attente de 6 fetch en vol, vus: ${pending.size}`);
        });
        expect(maxActive).toBe(6);

        for (const [, resolve] of pending) resolve(okResponse());
        pending.clear();

        await vi.waitFor(() => {
            if (pending.size !== 2) throw new Error(`en attente des 2 dernières tuiles, vus: ${pending.size}`);
        });
        expect(maxActive).toBe(6); // jamais dépassé, même sur le second lot

        for (const [, resolve] of pending) resolve(okResponse());

        const result = await resultPromise;
        expect(result).toEqual({ total: 8, ok: 8, fail: 0, aborted: false });
        expect(cachePutUrls).toHaveLength(8);
    });

    it('3 réessais, backoff 400·2^n (fake timers) ; renonce après l’échec du 4e essai', async () => {
        vi.useFakeTimers();
        const templates = makeSingleTileTemplates(1);
        vi.stubGlobal('caches', {
            open: async () => ({ match: async () => undefined, put: async () => {} }),
        } as unknown as CacheStorage);

        let fetchCallCount = 0;
        const fetchImpl: typeof fetch = async () => {
            fetchCallCount++;
            throw new Error('réseau indisponible (simulation)');
        };
        vi.stubGlobal('fetch', fetchImpl);

        const resultPromise = prefetchTiles(WORLD_BBOX, 0, 0, templates);

        await vi.advanceTimersByTimeAsync(0); // essai #0 (immédiat, sans délai)
        expect(fetchCallCount).toBe(1);

        await vi.advanceTimersByTimeAsync(400); // backoff 400·2^0 → essai #1
        expect(fetchCallCount).toBe(2);

        await vi.advanceTimersByTimeAsync(800); // backoff 400·2^1 → essai #2
        expect(fetchCallCount).toBe(3);

        await vi.advanceTimersByTimeAsync(1600); // backoff 400·2^2 → essai #3 (dernier, MAX_RETRY=3)
        expect(fetchCallCount).toBe(4);

        const result = await resultPromise;
        expect(result).toEqual({ total: 1, ok: 0, fail: 1, aborted: false });
    });

    it('abandon coopératif : signal.aborted stoppe les workers avant les tuiles restantes', async () => {
        const templates = makeSingleTileTemplates(8);
        vi.stubGlobal('caches', {
            open: async () => ({ match: async () => undefined, put: async () => {} }),
        } as unknown as CacheStorage);

        const pending = new Map<string, (r: Response) => void>();
        const fetchImpl: typeof fetch = (input) => {
            const url = String(input);
            return new Promise<Response>((resolve) => { pending.set(url, resolve); });
        };
        vi.stubGlobal('fetch', fetchImpl);

        const opts: PrefetchOptions = { signal: { aborted: false } };
        const resultPromise = prefetchTiles(WORLD_BBOX, 0, 0, templates, null, opts);

        await vi.waitFor(() => {
            if (pending.size !== 6) throw new Error(`en attente de 6 fetch en vol, vus: ${pending.size}`);
        });

        const signal = opts.signal;
        if (signal) signal.aborted = true;

        for (const [, resolve] of pending) resolve(okResponse());

        const result = await resultPromise;
        // Les 6 fetch déjà en vol se terminent (ok), mais les 2 tuiles
        // restantes ne sont jamais consommées : le worker revérifie
        // `signal.aborted` en tête de boucle avant de lire la tuile suivante.
        expect(result).toEqual({ total: 8, ok: 6, fail: 0, aborted: true });
    });

    it('progression : onProgress(done, total, ok, fail) appelé à chaque tuile traitée', async () => {
        const templates = makeSingleTileTemplates(3);
        vi.stubGlobal('caches', {
            open: async () => ({ match: async () => undefined, put: async () => {} }),
        } as unknown as CacheStorage);
        vi.stubGlobal('fetch', (async () => okResponse()) as typeof fetch);

        const calls: Array<[number, number, number, number]> = [];
        const result = await prefetchTiles(WORLD_BBOX, 0, 0, templates, (done, total, ok, fail) => {
            calls.push([done, total, ok, fail]);
        });

        expect(result).toEqual({ total: 3, ok: 3, fail: 0, aborted: false });
        expect(calls).toHaveLength(3);
        const last = calls[calls.length - 1];
        expect(last).toEqual([3, 3, 3, 0]);
    });

    it('tuile déjà en cache (cache.match) : pas de fetch, comptée ok', async () => {
        const templates = makeSingleTileTemplates(1);
        vi.stubGlobal('caches', {
            open: async () => ({ match: async () => okResponse(), put: async () => {} }),
        } as unknown as CacheStorage);
        let fetchCalled = false;
        vi.stubGlobal('fetch', (async () => { fetchCalled = true; return okResponse(); }) as typeof fetch);

        const result = await prefetchTiles(WORLD_BBOX, 0, 0, templates);
        expect(result).toEqual({ total: 1, ok: 1, fail: 0, aborted: false });
        expect(fetchCalled).toBe(false);
    });
});

describe('tiles.ts — prefetchFranceTiles (planMap.js:289-299)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('délègue à prefetchTiles(FRANCE_BBOX, minZ, maxZ, [satellite])', async () => {
        vi.stubGlobal('caches', {
            open: async () => ({ match: async () => undefined, put: async () => {} }),
        } as unknown as CacheStorage);
        vi.stubGlobal('fetch', (async () => okResponse()) as typeof fetch);

        // France z0-2, satellite seul : 5 tuiles (même combinatoire que le
        // test de propriété enumerateTiles/estimateTileCount ci-dessus).
        const result = await prefetchFranceTiles(0, 2);
        expect(result).toEqual({ total: 5, ok: 5, fail: 0, aborted: false });
    });
});
