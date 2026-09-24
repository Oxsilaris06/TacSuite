import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    _resetPowerMemory,
    classifyPower,
    enedisToGeoJSON,
    loadPowerLines,
    OVERPASS_ENDPOINTS,
    overpassToGeoJSON,
    parseVoltage,
    prefetchPowerLines,
    tilesFor,
} from '@shared/power-lines.js';

const overpassSample = {
    elements: [
        { type: 'way', id: 1, tags: { power: 'line', voltage: '400000;225000', operator: 'RTE' }, geometry: [{ lat: 47.92, lon: 1.92 }, { lat: 47.93, lon: 1.93 }] },
        { type: 'way', id: 2, tags: { power: 'line', voltage: '90000' }, geometry: [{ lat: 47.925, lon: 1.925 }, { lat: 47.926, lon: 1.926 }] },
        { type: 'way', id: 3, tags: { power: 'line', voltage: '90000' }, geometry: [{ lat: 47.92, lon: 1.92 }] },
        { type: 'node', id: 10, lat: 47.92, lon: 1.92, tags: { power: 'tower' } },
    ],
};
const enedisSample = (n: number) => ({
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => ({
        type: 'Feature', properties: { _id: `e${i}` },
        geometry: { type: 'LineString', coordinates: [[1.92 + i * 1e-4, 47.92], [1.921 + i * 1e-4, 47.921]] },
    })),
});

type Route = 'overpass' | 'hta' | 'bt';
/** Faux réseau aiguillé par URL ; chaque appel reçoit une Response NEUVE (un corps ne se lit qu'une fois). */
function network(handlers: Partial<Record<Route, (url: string) => Response | Promise<Response>>>) {
    const calls: Record<Route, string[]> = { overpass: [], hta: [], bt: [] };
    const overpassBodies: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
        const route: Route = url.includes('overpass') ? 'overpass' : url.includes('7p9-paqaf6cckipnjiubcncw') ? 'hta' : 'bt';
        calls[route].push(url);
        if (route === 'overpass') overpassBodies.push(decodeURIComponent(String(init?.body)));
        const h = handlers[route];
        if (!h) return new Response(JSON.stringify(route === 'overpass' ? { elements: [] } : { features: [] }), { status: 200 });
        return h(url);
    });
    return { fetch: f as unknown as typeof fetch, calls, overpassBodies };
}
const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status });

describe('lignes électriques — lecture des sources', () => {
    it('tension : la plus haute d’une valeur multiple, illisible = null', () => {
        expect(parseVoltage('400000;225000')).toBe(400000);
        expect(parseVoltage('20000')).toBe(20000);
        expect(parseVoltage('inconnue')).toBeNull();
        expect(parseVoltage(undefined)).toBeNull();
    });

    it('classes : THT ≥ 200 kV, HT ≥ 50 kV, HTA ≥ 1 kV, BT en dessous ; sans tension selon le type', () => {
        expect(classifyPower({ voltage: '400000' }).cls).toBe('tht');
        expect(classifyPower({ voltage: '63000' }).cls).toBe('ht');
        expect(classifyPower({ voltage: '20000' }).cls).toBe('hta');
        expect(classifyPower({ voltage: '400' }).cls).toBe('bt');
        expect(classifyPower({ power: 'line' }).cls).toBe('ht');
        expect(classifyPower({ power: 'minor_line' }).cls).toBe('hta');
    });

    it('OSM : lignes étiquetées, ligne à un seul point écartée, pylônes gardés', () => {
        const { lines, towers } = overpassToGeoJSON(overpassSample);
        expect(lines.map((l) => [l.properties.id, l.properties.cls, l.properties.label])).toEqual([['osm:1', 'tht', '400 kV'], ['osm:2', 'ht', '90 kV']]);
        expect(towers).toHaveLength(1);
        expect(overpassToGeoJSON({ nope: 1 })).toEqual({ lines: [], towers: [] });
    });

    it('Enedis : classe du jeu, MultiLineString éclatée, géométrie invalide ignorée', () => {
        const lines = enedisToGeoJSON({
            features: [
                { properties: { _id: 'a' }, geometry: { type: 'MultiLineString', coordinates: [[[1, 47], [1.1, 47.1]], [[2, 48], [2.1, 48.1]]] } },
                { properties: { _id: 'b' }, geometry: { type: 'LineString', coordinates: [[1, 47]] } },
                { properties: { _id: 'c' }, geometry: { type: 'LineString', coordinates: [[1, 'x'], [2, 3]] } },
                null,
            ],
        }, 'bt', 'Enedis BT');
        expect(lines.map((l) => l.properties.id)).toEqual(['enedis:bt:a:0', 'enedis:bt:a:1']);
        expect(lines[0]?.properties.cls).toBe('bt');
        expect(enedisToGeoJSON('pas du json', 'hta', 'x')).toEqual([]);
    });

    it('trop de tuiles (dézoom) : null', () => {
        expect(tilesFor({ west: 1, south: 47, east: 3, north: 49 })).toBeNull();
        expect(tilesFor({ west: 1.91, south: 47.91, east: 1.93, north: 47.94 })).toHaveLength(1);
    });
});

describe('lignes électriques — chargement, sources, repli, cache', () => {
    beforeEach(() => _resetPowerMemory());
    const bounds = { west: 1.91, south: 47.91, east: 1.93, north: 47.94 }; // une tuile, en métropole

    it('métropole : HTB d’OSM, HTA et BT d’Enedis, fusionnées', async () => {
        const net = network({ overpass: () => json(overpassSample), hta: () => json(enedisSample(2)), bt: () => json(enedisSample(3)) });
        const r = await loadPowerLines(bounds, net.fetch);
        const byCls = (c: string) => r!.lines.features.filter((f) => f.properties.cls === c).length;
        expect([byCls('tht'), byCls('ht'), byCls('hta'), byCls('bt')]).toEqual([1, 1, 2, 3]);
        expect(r?.missing).toBe(0);
        // OSM ne ramène plus la distribution en métropole (Enedis la couvre, sans doublon).
        expect(net.overpassBodies[0]).not.toContain('minor_line');
    });

    it('hors métropole (La Réunion) : pas d’Enedis, la distribution vient d’OSM', async () => {
        const net = network({});
        await loadPowerLines({ west: 55.41, south: -20.94, east: 55.43, north: -20.91 }, net.fetch);
        expect(net.calls.hta.length + net.calls.bt.length).toBe(0);
        expect(net.overpassBodies[0]).toContain('minor_line');
    });

    it('premier serveur Overpass saturé (504) : le second répond', async () => {
        let n = 0;
        const net = network({ overpass: () => (n++ === 0 ? json({}, 504) : json(overpassSample)) });
        const r = await loadPowerLines(bounds, net.fetch);
        expect(net.calls.overpass).toEqual(OVERPASS_ENDPOINTS);
        expect(r?.missing).toBe(0);
    });

    it('Overpass répond 200 avec « remark » d’erreur : tuile incomplète, montrée mais JAMAIS mise en cache', async () => {
        const net = network({
            overpass: () => json({ remark: 'runtime error: Query timed out in "query" at line 1 after 41 seconds.', elements: overpassSample.elements }),
            bt: () => json(enedisSample(3)),
        });
        const r = await loadPowerLines(bounds, net.fetch);
        expect(r?.missing).toBe(1);
        // Ce qui est arrivé (Enedis) est montré…
        expect(r?.lines.features.filter((f) => f.properties.cls === 'bt')).toHaveLength(3);
        // …mais, le serveur rétabli, la tuile est redemandée (pas de cache incomplet).
        const net2 = network({ overpass: () => json(overpassSample) });
        await loadPowerLines(bounds, net2.fetch);
        expect(net2.calls.overpass.length).toBeGreaterThan(0);
    });

    it('Enedis en panne : les lignes RTE s’affichent quand même, tuile incomplète', async () => {
        const net = network({ overpass: () => json(overpassSample), bt: () => json({}, 500), hta: () => { throw new Error('réseau'); } });
        const r = await loadPowerLines(bounds, net.fetch);
        expect(r?.missing).toBe(1);
        expect(r?.lines.features.some((f) => f.properties.cls === 'tht')).toBe(true);
    });

    it('tous les serveurs en échec : résultat vide, tuile signalée, jamais d’exception', async () => {
        const f = vi.fn().mockRejectedValue(new Error('réseau'));
        const r = await loadPowerLines(bounds, f as unknown as typeof fetch);
        expect(r?.missing).toBe(1);
        expect(r?.lines.features).toEqual([]);
    });

    it('Enedis paginé (`next`) : pages suivies ; une URL `next` étrangère est ignorée', async () => {
        const API = 'https://opendata.enedis.fr/data-fair/api/v1/datasets';
        let page = 0;
        const net = network({
            bt: () => {
                page++;
                if (page === 1) return json({ ...enedisSample(2), next: `${API}/hxx7-ja0txok7ipb5tgsz4kv/lines?after=2` });
                return json({ ...enedisSample(1), next: 'https://attaquant.example/lines' });
            },
        });
        await loadPowerLines(bounds, net.fetch);
        expect(page).toBe(2);
        expect(net.calls.bt.every((u) => u.startsWith(API))).toBe(true);
    });

    it('deuxième chargement de la même zone : servi par le cache, aucune requête', async () => {
        const net = network({ overpass: () => json(overpassSample), bt: () => json(enedisSample(2)) });
        await loadPowerLines(bounds, net.fetch);
        const f2 = vi.fn();
        const r = await loadPowerLines(bounds, f2 as unknown as typeof fetch);
        expect(f2).not.toHaveBeenCalled();
        expect(r?.lines.features.length).toBe(4);
    });

    it('affichage progressif : un rappel par bloc chargé', async () => {
        const net = network({ overpass: () => json(overpassSample) });
        const progress = vi.fn();
        // 1,90–2,10 × 47,90–48,00 : 4 × 2 tuiles = 2 blocs de 2 × 2.
        await loadPowerLines({ west: 1.901, south: 47.901, east: 2.099, north: 47.999 }, net.fetch, progress);
        expect(progress).toHaveBeenCalledTimes(2);
    });

    it('pack hors ligne : une zone de 8 × 8 tuiles est préchargée par blocs de 2 × 2, puis servie sans réseau', async () => {
        const net = network({ overpass: () => json(overpassSample) });
        const zone = { west: 1.901, south: 47.901, east: 2.299, north: 48.299 };
        expect(await prefetchPowerLines(zone, net.fetch)).toEqual({ missing: 0 });
        expect(net.calls.overpass).toHaveLength(16);
        const offline = vi.fn().mockRejectedValue(new Error('hors ligne'));
        const r = await loadPowerLines({ west: 2.01, south: 48.01, east: 2.04, north: 48.04 }, offline as unknown as typeof fetch);
        expect(offline).not.toHaveBeenCalled();
        expect(r?.missing).toBe(0);
    });

    it('pack hors ligne : zone trop grande refusée (null), aucune requête', async () => {
        const f = vi.fn();
        expect(await prefetchPowerLines({ west: 0, south: 45, east: 1, north: 46 }, f as unknown as typeof fetch)).toBeNull();
        expect(f).not.toHaveBeenCalled();
    });
});
