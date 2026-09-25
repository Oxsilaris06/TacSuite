/**
 * pm-chrome-grid.test.ts — C17 : avec un carroyage ACTIF, une saisie qui
 * ressemble à une case mais tombe HORS du rectangle (« N7 », « D951 ») est un
 * nom de route / d'axe : elle doit partir au géocodage, l'indication « hors du
 * carroyage » restant en tête des résultats. Une case DANS le carroyage reste
 * reconnue sans réseau (décision 35).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChromeMethods } from '../../../src/apps/pctac/planmap/chrome.js';
import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';
import type { GridCellSpec } from '@shared/coords.js';

/** Carroyage 10×10 dont le coin nord-ouest est A1. */
const GRID: GridCellSpec = { west: 2.0, north: 49.0, dLon: 0.001, dLat: 0.001, cols: 10, rows: 10 };

function jsonResponse(body: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function banResponse(label: string, lng: number, lat: number): Response {
    return jsonResponse({
        type: 'FeatureCollection',
        features: [{ properties: { label }, geometry: { type: 'Point', coordinates: [lng, lat] } }],
    });
}

function makeInstance(grid: GridCellSpec | null): { instance: PlanMapInternal; placeSearchMarker: ReturnType<typeof vi.fn> } {
    const placeSearchMarker = vi.fn();
    const fake = {
        ...ChromeMethods,
        map: { flyTo: vi.fn() },
        searchMarker: null,
        _searchSeq: 0,
        overlays: { state: { grid, gridOn: !!grid } },
        _placeSearchMarker: placeSearchMarker,
        _setTool: vi.fn(),
        _restoreModalFromFullscreen: vi.fn(),
    };
    return { instance: fake as unknown as PlanMapInternal, placeSearchMarker };
}

function mountSearchDom(): { input: HTMLInputElement; resultsBox: HTMLDivElement } {
    document.body.innerHTML = `
        <input id="plan_address_input" type="text" />
        <div id="plan_search_results"></div>
    `;
    return {
        input: document.getElementById('plan_address_input') as HTMLInputElement,
        resultsBox: document.getElementById('plan_search_results') as HTMLDivElement,
    };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('C17 — case hors carroyage → géocodage (carroyage actif)', () => {
    it('« D951 » part au géocodage et l’indication « hors du carroyage » reste en tête', async () => {
        const { input, resultsBox } = mountSearchDom();
        const fetchSpy = vi.fn(() => Promise.resolve(banResponse('D951, Orléans', 2.1, 48.9)));
        vi.stubGlobal('fetch', fetchSpy);
        const { instance, placeSearchMarker } = makeInstance(GRID);

        input.value = 'D951';
        await instance._searchAddress();

        expect(fetchSpy).toHaveBeenCalled();
        expect(resultsBox.innerHTML).toContain('D951, Orléans');
        expect(resultsBox.innerHTML).toContain('hors du carroyage');
        expect(placeSearchMarker).toHaveBeenCalledWith(2.1, 48.9, 'D951, Orléans');
    });

    it('« N7 » part au géocodage', async () => {
        const { input } = mountSearchDom();
        const fetchSpy = vi.fn(() => Promise.resolve(banResponse('N7, Orléans', 2.2, 48.8)));
        vi.stubGlobal('fetch', fetchSpy);
        const { instance } = makeInstance(GRID);

        input.value = 'N7';
        await instance._searchAddress();

        expect(fetchSpy).toHaveBeenCalled();
    });

    it('une case DANS le carroyage reste reconnue sans réseau', async () => {
        const { input, resultsBox } = mountSearchDom();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const { instance, placeSearchMarker } = makeInstance(GRID);

        input.value = 'A1';
        await instance._searchAddress();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(resultsBox.innerHTML).toContain('Case du carroyage');
        expect(placeSearchMarker).toHaveBeenCalledTimes(1);
        const args = placeSearchMarker.mock.calls[0] as [number, number, string];
        expect(args[0]).toBeCloseTo(2.0005, 6);
        expect(args[1]).toBeCloseTo(48.9995, 6);
        expect(args[2]).toBe('Case A1');
    });
});
