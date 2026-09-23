import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    _resetPowerMemory,
    classifyPower,
    loadPowerLines,
    OVERPASS_ENDPOINTS,
    prefetchPowerLines,
    overpassToGeoJSON,
    parseVoltage,
    tilesFor,
} from '@shared/power-lines.js';

const sample = {
    elements: [
        { type: 'way', id: 1, tags: { power: 'line', voltage: '400000;225000', operator: 'RTE' }, geometry: [{ lat: 47.9, lon: 1.9 }, { lat: 47.91, lon: 1.91 }] },
        { type: 'way', id: 2, tags: { power: 'minor_line' }, geometry: [{ lat: 47.905, lon: 1.905 }, { lat: 47.906, lon: 1.906 }] },
        { type: 'way', id: 3, tags: { power: 'line', voltage: '90000' }, geometry: [{ lat: 47.9, lon: 1.9 }] },
        { type: 'node', id: 10, lat: 47.9, lon: 1.9, tags: { power: 'tower' } },
    ],
};

describe('lignes électriques — lecture OSM', () => {
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

    it('conversion : lignes étiquetées, ligne à un seul point écartée, pylônes gardés', () => {
        const { lines, towers } = overpassToGeoJSON(sample);
        expect(lines.map((l) => [l.properties.id, l.properties.cls, l.properties.label])).toEqual([[1, 'tht', '400 kV'], [2, 'hta', '']]);
        expect(towers).toHaveLength(1);
        expect(overpassToGeoJSON({ nope: 1 })).toEqual({ lines: [], towers: [] });
    });

    it('trop de tuiles (dézoom) : null', () => {
        expect(tilesFor({ west: 1, south: 47, east: 3, north: 49 })).toBeNull();
        expect(tilesFor({ west: 1.91, south: 47.91, east: 1.93, north: 47.94 })).toHaveLength(1);
    });
});

describe('lignes électriques — chargement, repli, cache', () => {
    beforeEach(() => _resetPowerMemory());
    const bounds = { west: 1.91, south: 47.91, east: 1.93, north: 47.94 };
    const ok = (): Response => new Response(JSON.stringify(sample), { status: 200 });

    it('premier serveur saturé (504) : le second répond', async () => {
        const f = vi.fn()
            .mockResolvedValueOnce(new Response('', { status: 504 }))
            .mockResolvedValueOnce(ok());
        const r = await loadPowerLines(bounds, f as unknown as typeof fetch);
        expect(f.mock.calls.map((c) => c[0])).toEqual(OVERPASS_ENDPOINTS);
        expect(r?.missing).toBe(0);
        expect(r?.lines.features.length).toBe(2);
    });

    it('tous les serveurs en échec : résultat vide, tuiles signalées manquantes, jamais d’exception', async () => {
        const f = vi.fn().mockRejectedValue(new Error('réseau'));
        const r = await loadPowerLines(bounds, f as unknown as typeof fetch);
        expect(r?.missing).toBe(1);
        expect(r?.lines.features).toEqual([]);
    });

    it('réponse 200 avec « remark » d’erreur (Overpass saturé) : échec, JAMAIS mis en cache comme « aucune ligne »', async () => {
        const timedOut = (): Response => new Response(JSON.stringify({ remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.', elements: [] }), { status: 200 });
        const f = vi.fn().mockImplementation(async () => timedOut());
        const r = await loadPowerLines(bounds, f as unknown as typeof fetch);
        expect(r?.missing).toBe(1);
        // Serveur rétabli : la zone est redemandée, pas servie vide depuis le cache.
        const f2 = vi.fn().mockResolvedValue(ok());
        const r2 = await loadPowerLines(bounds, f2 as unknown as typeof fetch);
        expect(f2).toHaveBeenCalled();
        expect(r2?.lines.features.length).toBe(2);
    });

    it('deuxième chargement de la même zone : servi par le cache, aucune requête', async () => {
        const f = vi.fn().mockResolvedValue(ok());
        await loadPowerLines(bounds, f as unknown as typeof fetch);
        const f2 = vi.fn();
        const r = await loadPowerLines(bounds, f2 as unknown as typeof fetch);
        expect(f2).not.toHaveBeenCalled();
        expect(r?.lines.features.length).toBe(2);
    });

    it('pack hors ligne : une zone de 8 × 8 tuiles est préchargée en 4 blocs, puis servie sans réseau', async () => {
        const f = vi.fn().mockImplementation(async () => ok());
        const zone = { west: 1.901, south: 47.901, east: 2.299, north: 48.299 };
        expect(await prefetchPowerLines(zone, f as unknown as typeof fetch)).toEqual({ missing: 0 });
        expect(f).toHaveBeenCalledTimes(4);
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
