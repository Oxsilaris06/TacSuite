/**
 * pm-search.test.ts — Tests du géocodage du plan (décision 35, lot C).
 * ===========================================================================
 *
 * Ordre imposé (2026-10-28) : Nominatim d'abord, BAN (Géoplateforme IGN)
 * SEULEMENT si Nominatim ne rend rien ou échoue (réseau, délai 5 s, statut non 200). `fetch` est
 * injecté en paramètre : aucun réseau réel n'est touché.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    banSearchUrl,
    fetchWithTimeout,
    geocodeAddress,
    nominatimSearchUrl,
    parseBanResults,
    parseNominatimResults,
    type FetchLike,
} from '../../../src/apps/pctac/planmap/search.js';

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

function banBody(hits: Array<{ label: string; lng: number; lat: number }>): unknown {
    return {
        type: 'FeatureCollection',
        features: hits.map((h) => ({ properties: { label: h.label }, geometry: { coordinates: [h.lng, h.lat] } })),
    };
}

describe('search — URLs', () => {
    it('BAN sur la Géoplateforme, paramètre q encodé, limit 5', () => {
        expect(banSearchUrl('8 bd du port')).toBe('https://data.geopf.fr/geocodage/search?q=8%20bd%20du%20port&limit=5');
    });
    it('Nominatim en repli', () => {
        expect(nominatimSearchUrl('Paris')).toContain('nominatim.openstreetmap.org/search');
        expect(nominatimSearchUrl('Paris')).toContain('limit=5');
    });
});

describe('search — parseurs de réponse', () => {
    it('parseBanResults lit properties.label et geometry.coordinates [lon, lat]', () => {
        expect(parseBanResults(banBody([{ label: 'Paris', lng: 2.35, lat: 48.85 }]))).toEqual([
            { label: 'Paris', lng: 2.35, lat: 48.85, source: 'ban' },
        ]);
    });
    it('parseBanResults tolère les formes inattendues', () => {
        expect(parseBanResults(null)).toEqual([]);
        expect(parseBanResults({})).toEqual([]);
        expect(parseBanResults({ features: [{ properties: {} }] })).toEqual([]);
    });
    it('parseNominatimResults lit display_name/lon/lat', () => {
        expect(parseNominatimResults([{ display_name: 'Lyon', lon: '4.85', lat: '45.75' }])).toEqual([
            { label: 'Lyon', lng: 4.85, lat: 45.75, source: 'nominatim' },
        ]);
        expect(parseNominatimResults({})).toEqual([]);
    });
});

describe('search — geocodeAddress : Nominatim d’abord, BAN en repli', () => {
    const nomi = (label: string, lon = '1.5', lat = '44.0'): unknown => [{ display_name: label, lon, lat }];

    it('Nominatim trouve → BAN jamais appelée', async () => {
        const calls: string[] = [];
        const fetchImpl: FetchLike = (url) => {
            calls.push(url);
            return Promise.resolve(jsonResponse(nomi('Gendarmerie, Brive', '1.53', '45.16')));
        };
        const hits = await geocodeAddress('gendarmerie Brive', fetchImpl, 0);
        expect(hits).toEqual([{ label: 'Gendarmerie, Brive', lng: 1.53, lat: 45.16, source: 'nominatim' }]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('nominatim');
    });

    it('Nominatim vide → BAN trouve', async () => {
        const calls: string[] = [];
        const fetchImpl: FetchLike = (url) => {
            calls.push(url);
            if (url.includes('nominatim')) return Promise.resolve(jsonResponse([]));
            return Promise.resolve(jsonResponse(banBody([{ label: '3 Rue X 19100 Brive', lng: 1.5, lat: 45.1 }])));
        };
        const hits = await geocodeAddress('3 rue X Brive', fetchImpl, 0);
        expect(hits).toEqual([{ label: '3 Rue X 19100 Brive', lng: 1.5, lat: 45.1, source: 'ban' }]);
        expect(calls).toHaveLength(2);
        expect(calls[1]).toContain('data.geopf.fr');
    });

    it('Nominatim en erreur réseau → BAN', async () => {
        const fetchImpl: FetchLike = (url) => {
            if (url.includes('nominatim')) return Promise.reject(new Error('offline'));
            return Promise.resolve(jsonResponse(banBody([{ label: 'Lyon', lng: 4.85, lat: 45.75 }])));
        };
        const hits = await geocodeAddress('Lyon', fetchImpl, 0);
        expect(hits[0]?.source).toBe('ban');
    });

    it('Nominatim en quota (429) → BAN', async () => {
        const fetchImpl: FetchLike = (url) => {
            if (url.includes('nominatim')) return Promise.resolve(jsonResponse({}, 429));
            return Promise.resolve(jsonResponse(banBody([{ label: 'Lyon', lng: 4.85, lat: 45.75 }])));
        };
        const hits = await geocodeAddress('Lyon', fetchImpl, 0);
        expect(hits[0]?.source).toBe('ban');
    });

    it('Nominatim et BAN vides → []', async () => {
        const fetchImpl: FetchLike = (url) => Promise.resolve(jsonResponse(url.includes('nominatim') ? [] : { features: [] }));
        await expect(geocodeAddress('nulle part', fetchImpl, 0)).resolves.toEqual([]);
    });

    it('Nominatim vide et BAN en erreur → [] (rien trouvé, pas une panne)', async () => {
        const fetchImpl: FetchLike = (url) => (url.includes('nominatim') ? Promise.resolve(jsonResponse([])) : Promise.reject(new Error('offline')));
        await expect(geocodeAddress('nulle part', fetchImpl, 0)).resolves.toEqual([]);
    });

    it('Nominatim en quota et BAN vide → l’erreur de Nominatim remonte (message de quota)', async () => {
        const fetchImpl: FetchLike = (url) => Promise.resolve(url.includes('nominatim') ? jsonResponse({}, 429) : jsonResponse({ features: [] }));
        await expect(geocodeAddress('Lyon', fetchImpl, 0)).rejects.toThrow('HTTP 429');
    });

    it('requête vide → aucun appel réseau', async () => {
        const fetchImpl = vi.fn();
        await expect(geocodeAddress('   ', fetchImpl as unknown as FetchLike, 0)).resolves.toEqual([]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('des coordonnées illisibles ne partent jamais au géocodage (position non révélée)', async () => {
        const fetchImpl = vi.fn();
        await expect(geocodeAddress('48 51 N 2 21', fetchImpl as unknown as FetchLike, 0)).resolves.toEqual([]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('search — fetchWithTimeout', () => {
    it('un délai dépassé abandonne la requête Nominatim et bascule sur la BAN', async () => {
        vi.useFakeTimers();
        try {
            const calls: string[] = [];
            const fetchImpl: FetchLike = (url, init) => {
                calls.push(url);
                if (url.includes('nominatim')) {
                    // Respecte l'abandon : ne se résout jamais autrement.
                    return new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    });
                }
                return Promise.resolve(jsonResponse(banBody([{ label: 'Repli', lng: 1, lat: 2 }])));
            };
            const promise = geocodeAddress('Trop lent', fetchImpl, 5000);
            await vi.advanceTimersByTimeAsync(5000);
            const hits = await promise;
            expect(hits[0]?.source).toBe('ban');
            expect(calls[0]).toContain('nominatim');
            expect(calls[1]).toContain('data.geopf.fr');
        } finally {
            vi.useRealTimers();
        }
    });

    it('timeoutMs ≤ 0 → appel direct sans AbortController', async () => {
        const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(banBody([{ label: 'X', lng: 1, lat: 2 }]))));
        const r = await fetchWithTimeout('http://a', fetchImpl as unknown as FetchLike, 0);
        expect(r.ok).toBe(true);
        expect(fetchImpl).toHaveBeenCalledWith('http://a');
    });
});

describe('Revue du 25/09 — BAN sous le seuil de score (B4)', () => {
    const banScored = (): unknown => ({
        type: 'FeatureCollection',
        features: [
            { properties: { label: 'Rue Gaston Cornavin 18100 Vierzon', score: 0.4 }, geometry: { coordinates: [2.07, 47.22] } },
            { properties: { label: 'Place Cornavin 75001 Paris', score: 0.8 }, geometry: { coordinates: [2.35, 48.85] } },
        ],
    });
    const nominatimEmpty: FetchLike = (url) => Promise.resolve(url.includes('nominatim') ? jsonResponse([]) : jsonResponse(banScored()));

    it('en repli, un résultat BAN sous le seuil est marqué faible, les autres non', async () => {
        const hits = await geocodeAddress('Cornavin', nominatimEmpty, 0);
        expect(hits.map((h) => [h.label, h.weak])).toEqual([
            ['Place Cornavin 75001 Paris', undefined],
            ['Rue Gaston Cornavin 18100 Vierzon', true],
        ]);
    });

    it('les résultats sûrs passent avant les faibles (le premier n’est pas suivi d’office s’il est faible)', async () => {
        const hits = await geocodeAddress('Cornavin', nominatimEmpty, 0);
        expect(hits[0]?.weak).toBeUndefined();
    });
});
