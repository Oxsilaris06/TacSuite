/**
 * pm-search.test.ts — Tests du géocodage du plan (décision 35, lot C).
 * ===========================================================================
 *
 * Ordre imposé : BAN (Géoplateforme IGN) d'abord, Nominatim SEULEMENT si la BAN
 * ne rend rien ou échoue (réseau, délai 5 s, statut non 200). `fetch` est
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

describe('search — geocodeAddress : BAN d’abord, Nominatim en repli', () => {
    it('BAN trouve → Nominatim jamais appelé', async () => {
        const calls: string[] = [];
        const fetchImpl: FetchLike = (url) => {
            calls.push(url);
            return Promise.resolve(jsonResponse(banBody([{ label: 'Paris', lng: 2.35, lat: 48.85 }])));
        };
        const hits = await geocodeAddress('Paris', fetchImpl, 0);
        expect(hits).toEqual([{ label: 'Paris', lng: 2.35, lat: 48.85, source: 'ban' }]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('data.geopf.fr');
    });

    it('BAN vide → Nominatim trouve', async () => {
        const calls: string[] = [];
        const fetchImpl: FetchLike = (url) => {
            calls.push(url);
            if (url.includes('data.geopf.fr')) return Promise.resolve(jsonResponse(banBody([])));
            return Promise.resolve(jsonResponse([{ display_name: 'Ailleurs', lon: '1.5', lat: '44.0' }]));
        };
        const hits = await geocodeAddress('Ailleurs', fetchImpl, 0);
        expect(hits).toEqual([{ label: 'Ailleurs', lng: 1.5, lat: 44.0, source: 'nominatim' }]);
        expect(calls).toHaveLength(2);
        expect(calls[1]).toContain('nominatim');
    });

    it('BAN en erreur réseau → Nominatim', async () => {
        const fetchImpl: FetchLike = (url) => {
            if (url.includes('data.geopf.fr')) return Promise.reject(new Error('offline'));
            return Promise.resolve(jsonResponse([{ display_name: 'Lyon', lon: '4.85', lat: '45.75' }]));
        };
        const hits = await geocodeAddress('Lyon', fetchImpl, 0);
        expect(hits[0]?.source).toBe('nominatim');
    });

    it('BAN statut non 200 → Nominatim', async () => {
        const fetchImpl: FetchLike = (url) => {
            if (url.includes('data.geopf.fr')) return Promise.resolve(jsonResponse({}, 503));
            return Promise.resolve(jsonResponse([{ display_name: 'Lyon', lon: '4.85', lat: '45.75' }]));
        };
        const hits = await geocodeAddress('Lyon', fetchImpl, 0);
        expect(hits[0]?.source).toBe('nominatim');
    });

    it('BAN et Nominatim vides → []', async () => {
        const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse({ features: [] }));
        await expect(geocodeAddress('nulle part', fetchImpl, 0)).resolves.toEqual([]);
    });

    it('requête vide → aucun appel réseau', async () => {
        const fetchImpl = vi.fn();
        await expect(geocodeAddress('   ', fetchImpl as unknown as FetchLike, 0)).resolves.toEqual([]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('search — fetchWithTimeout', () => {
    it('un délai dépassé abandonne la requête BAN et bascule sur Nominatim', async () => {
        vi.useFakeTimers();
        try {
            const calls: string[] = [];
            const fetchImpl: FetchLike = (url, init) => {
                calls.push(url);
                if (url.includes('data.geopf.fr')) {
                    // Respecte l'abandon : ne se résout jamais autrement.
                    return new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    });
                }
                return Promise.resolve(jsonResponse([{ display_name: 'Repli', lon: '1.0', lat: '2.0' }]));
            };
            const promise = geocodeAddress('Trop lent', fetchImpl, 5000);
            await vi.advanceTimersByTimeAsync(5000);
            const hits = await promise;
            expect(hits[0]?.source).toBe('nominatim');
            expect(calls[0]).toContain('data.geopf.fr');
            expect(calls[1]).toContain('nominatim');
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
    const weakBan = (): unknown => ({
        type: 'FeatureCollection',
        features: [{ properties: { label: 'Rue Gaston Cornavin 18100 Vierzon', score: 0.4 }, geometry: { coordinates: [2.07, 47.22] } }],
    });

    it('score faible → Nominatim consulté, ses résultats rendus en premier, les BAN faibles derrière et marqués', async () => {
        const calls: string[] = [];
        const fetchImpl: FetchLike = (url) => {
            calls.push(url);
            if (url.includes('data.geopf.fr')) return Promise.resolve(jsonResponse(weakBan()));
            return Promise.resolve(jsonResponse([{ display_name: 'Gare Cornavin, Genève', lon: '6.142', lat: '46.210' }]));
        };
        const hits = await geocodeAddress('Genève gare Cornavin', fetchImpl, 0);
        expect(calls).toHaveLength(2);
        expect(hits[0]).toMatchObject({ label: 'Gare Cornavin, Genève', source: 'nominatim' });
        expect(hits[1]).toMatchObject({ source: 'ban', weak: true });
        expect(hits.some((h) => h.weak)).toBe(true);
    });

    it('score faible et Nominatim vide → résultats BAN rendus, marqués faibles', async () => {
        const fetchImpl: FetchLike = (url) => {
            if (url.includes('data.geopf.fr')) return Promise.resolve(jsonResponse(weakBan()));
            return Promise.resolve(jsonResponse([]));
        };
        const hits = await geocodeAddress('Genève gare Cornavin', fetchImpl, 0);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ source: 'ban', weak: true });
    });

    it('score faible et Nominatim en erreur → résultats BAN rendus plutôt qu’une erreur', async () => {
        const fetchImpl: FetchLike = (url) => {
            if (url.includes('data.geopf.fr')) return Promise.resolve(jsonResponse(weakBan()));
            return Promise.reject(new Error('offline'));
        };
        const hits = await geocodeAddress('Genève gare Cornavin', fetchImpl, 0);
        expect(hits[0]).toMatchObject({ source: 'ban', weak: true });
    });

    it('score fort → Nominatim jamais consulté, aucun marquage', async () => {
        const calls: string[] = [];
        const fetchImpl: FetchLike = (url) => {
            calls.push(url);
            return Promise.resolve(jsonResponse({ type: 'FeatureCollection', features: [{ properties: { label: 'Paris', score: 0.9 }, geometry: { coordinates: [2.35, 48.85] } }] }));
        };
        const hits = await geocodeAddress('Paris', fetchImpl, 0);
        expect(calls).toHaveLength(1);
        expect(hits[0]?.weak).toBeUndefined();
    });
});
