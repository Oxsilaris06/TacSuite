/**
 * pm-aoi.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js:5293-5564`
 * (GStart-main, lecture seule) pour le paquet `pm-aoi` : `planmap/aoi.ts`
 * (`_startAoiFraming` :5307, `_endAoiFraming` :5383, `_confirmAoi` :5414,
 * `_runAoiDownload` :5454, `_createAoiProgressBar` :5508). Références
 * `planMap.js:<ligne>` en commentaire, cf. docs/SPEC-PLANMAP-SPLIT.md §4.16,
 * §5.10, §9.
 *
 * `this` FACTICE : un faux `map` (on/off/project/dragPan/boxZoom/
 * doubleClickZoom en `vi.fn()`), jamais `new maplibregl.Map` (WebGL absent
 * sous jsdom — SPEC-PCTAC-CONVERSION §8.4).
 *
 * `./tiles.js` est intégralement mocké (`styleTileTemplates`/
 * `estimateTileCount`/`prefetchTiles`) : la logique de tuiles est déjà
 * couverte par pm-geo.test.ts, ce paquet teste l'ORCHESTRATION AOI seule
 * (quota, invariant §5.10, index persisté, cadrage).
 *
 * `caches`/`fetch`/`alert`/`confirm` sont ABSENTS ou non implémentés sous
 * jsdom (SPEC-PCTAC-CONVERSION §8.4) : stubbés explicitement par test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pctac/planmap/tiles.js', () => ({
    styleTileTemplates: vi.fn(),
    estimateTileCount: vi.fn(),
    prefetchTiles: vi.fn(),
}));

import { AoiMethods } from '@pctac/planmap/aoi.js';
import { AOI_INDEX_KEY, AOI_MAX_TILES } from '@pctac/planmap/constants.js';
import { estimateTileCount, prefetchTiles, styleTileTemplates } from '@pctac/planmap/tiles.js';
import type {
    AoiIndexEntry,
    GeoBBox,
    LngLatTuple,
    PlanMapInternal,
    TileTemplate,
} from '@pctac/planmap/types.js';

const styleTileTemplatesMock = vi.mocked(styleTileTemplates);
const estimateTileCountMock = vi.mocked(estimateTileCount);
const prefetchTilesMock = vi.mocked(prefetchTiles);

// ---------------------------------------------------------------------------
// Fabriques de `map`/`this` factices
// ---------------------------------------------------------------------------

/** Sous-ensemble RÉELLEMENT appelé de `maplibregl.Map` par les 5 méthodes AOI. */
function makeFakeMap() {
    return {
        getCanvas: vi.fn(() => ({ style: { cursor: '' } as { cursor: string } })),
        dragPan: { disable: vi.fn(), enable: vi.fn() },
        boxZoom: { disable: vi.fn(), enable: vi.fn() },
        doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
        on: vi.fn(),
        off: vi.fn(),
        // Échelle arbitraire mais déterministe : suffisante pour distinguer
        // "simple clic" (même point, distPx=0) de "vrai rectangle" (>8px).
        project: vi.fn(({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 1000, y: lat * 1000 })),
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

/** `this` factice — cast `unknown` (même idiome que pm-drawlayers.test.ts /
 * pm-capture.test.ts : `PlanMapInternal` ne "chevauche" pas suffisamment un
 * littéral partiel pour un `as` direct). */
function makeFakeState(map: FakeMap | null): PlanMapInternal {
    return {
        map,
        drawTool: null,
        pendingFreePin: null,
        pendingEntityPin: null,
        _aoiFraming: false,
        _aoiFramingHandlers: null,
        _aoiDownloadBusy: false,
        AOI_MIN_Z: 13,
        AOI_MAX_Z: 18,

        // Enveloppe `_safe` neutre : n'attrape rien, retourne `fn` telle quelle
        // (le chemin d'erreur de `_safe` est déjà couvert par pm-core.test.ts,
        // hors périmètre pm-aoi — même procédé que pm-drawlayers.test.ts).
        _safe: vi.fn((fn: (...a: never[]) => unknown) => fn),

        _setTool: vi.fn(),
        _showHint: vi.fn(),
        _hideHint: vi.fn(),
        _renderPreview: vi.fn(),
        _clearPreview: vi.fn(),
        _rectPolygon: vi.fn((a: LngLatTuple, b: LngLatTuple): LngLatTuple[] => [a, [b[0], a[1]], b, [a[0], b[1]], a]),
        // `_confirmAoi`/`_runAoiDownload` isolées en `vi.fn()` : les tests de
        // `_confirmAoi`/`_startAoiFraming` vérifient seulement QU'ELLES SONT
        // APPELÉES avec les bons arguments, sans exécuter la vraie chaîne de
        // téléchargement (testée séparément via un appel direct à
        // `AoiMethods._runAoiDownload`/`AoiMethods._confirmAoi`).
        _confirmAoi: vi.fn(),
        _runAoiDownload: vi.fn(),
        // `_endAoiFraming`/`_createAoiProgressBar` : implémentations RÉELLES —
        // ce sont des méthodes SŒURS du même paquet `pm-aoi` (pas une
        // dépendance externe à isoler) ; `_startAoiFraming.up` et
        // `_runAoiDownload` en dépendent réellement (fermeture du cadrage,
        // barre de progression avec son vrai bouton "Annuler").
        _endAoiFraming: AoiMethods._endAoiFraming,
        _createAoiProgressBar: AoiMethods._createAoiProgressBar,
    } as unknown as PlanMapInternal;
}

function makeBbox(): GeoBBox {
    return { west: 0, south: 0, east: 1, north: 1 };
}

function makeTemplate(): TileTemplate {
    return { id: 'satellite', url: 'https://example.test/{z}/{x}/{y}', minzoom: 0, maxzoom: 19, bounds: null };
}

beforeEach(() => {
    vi.clearAllMocks();
    styleTileTemplatesMock.mockReturnValue([]);
    estimateTileCountMock.mockReturnValue(0);
    prefetchTilesMock.mockResolvedValue({ total: 0, ok: 0, fail: 0, aborted: false });
    localStorage.clear();
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('smoke — les 5 méthodes ne jettent pas sans DOM (vue Plan jamais ouverte)', () => {
    it('_startAoiFraming (this.map absent)', () => {
        const state = makeFakeState(null);
        expect(() => AoiMethods._startAoiFraming.call(state)).not.toThrow();
    });

    it('_endAoiFraming (aucun cadrage en cours)', () => {
        const state = makeFakeState(null);
        expect(() => AoiMethods._endAoiFraming.call(state)).not.toThrow();
    });

    it('_confirmAoi (aucune source cartographique)', async () => {
        const state = makeFakeState(null);
        vi.stubGlobal('alert', vi.fn());
        await expect(AoiMethods._confirmAoi.call(state, makeBbox())).resolves.toBeUndefined();
    });

    it('_runAoiDownload (aucun #plan_map dans le DOM : repli document.body)', async () => {
        const state = makeFakeState(null);
        await expect(
            AoiMethods._runAoiDownload.call(state, makeBbox(), 13, 18, [], 0)
        ).resolves.toBeUndefined();
    });

    it('_createAoiProgressBar (aucun #plan_map dans le DOM : repli document.body)', () => {
        const state = makeFakeState(null);
        expect(() => AoiMethods._createAoiProgressBar.call(state, 10)).not.toThrow();
    });
});

describe('_startAoiFraming (planMap.js:5307-5380) puis _endAoiFraming (planMap.js:5383-5411)', () => {
    it('installe 6 listeners carte (down/move/up ×2 mousedown+touchstart etc.) + keydown + click hint, et _endAoiFraming retire les 5 handlers (invariant §5.10 piège 2)', () => {
        vi.stubGlobal('caches', {} as CacheStorage);
        document.body.innerHTML = '<button id="plan_btn_aoi"></button><div id="plan_hint"></div>';
        const map = makeFakeMap();
        const state = makeFakeState(map);
        const hintEl = document.getElementById('plan_hint') as HTMLDivElement;
        const docAddSpy = vi.spyOn(document, 'addEventListener');
        const docRemoveSpy = vi.spyOn(document, 'removeEventListener');
        const hintAddSpy = vi.spyOn(hintEl, 'addEventListener');
        const hintRemoveSpy = vi.spyOn(hintEl, 'removeEventListener');

        AoiMethods._startAoiFraming.call(state);

        // --- état après armement ---
        expect(state._aoiFraming).toBe(true);
        expect(state._aoiFramingHandlers).not.toBeNull();
        expect(document.getElementById('plan_btn_aoi')?.classList.contains('active')).toBe(true);
        expect(map.dragPan.disable).toHaveBeenCalledTimes(1);
        expect(map.boxZoom.disable).toHaveBeenCalledTimes(1);
        expect(map.doubleClickZoom.disable).toHaveBeenCalledTimes(1);
        expect(state._showHint).toHaveBeenCalledTimes(1);

        expect(map.on).toHaveBeenCalledTimes(6);
        const onTypes = map.on.mock.calls.map((c) => c[0]);
        expect(onTypes).toEqual(['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend']);
        expect(docAddSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
        expect(hintAddSpy).toHaveBeenCalledWith('click', expect.any(Function));

        // Même référence de fonction pour mousedown/touchstart (down partagé),
        // mousemove/touchmove (move partagé), mouseup/touchend (up partagé) —
        // condition nécessaire pour que `_endAoiFraming` retire EXACTEMENT ce
        // qui a été posé (planMap.js:5388-5393).
        const onByType = new Map(map.on.mock.calls.map((c) => [c[0], c[1]]));
        expect(onByType.get('touchstart')).toBe(onByType.get('mousedown'));
        expect(onByType.get('touchmove')).toBe(onByType.get('mousemove'));
        expect(onByType.get('touchend')).toBe(onByType.get('mouseup'));

        // --- désarmement ---
        AoiMethods._endAoiFraming.call(state);

        expect(state._aoiFraming).toBe(false);
        expect(state._aoiFramingHandlers).toBeNull();
        expect(document.getElementById('plan_btn_aoi')?.classList.contains('active')).toBe(false);
        expect(state._clearPreview).toHaveBeenCalledTimes(1);
        expect(state._hideHint).toHaveBeenCalledTimes(1);
        expect(map.dragPan.enable).toHaveBeenCalledTimes(1);
        expect(map.boxZoom.enable).toHaveBeenCalledTimes(1);
        expect(map.doubleClickZoom.enable).toHaveBeenCalledTimes(1);

        expect(map.off).toHaveBeenCalledTimes(6);
        const offByType = new Map(map.off.mock.calls.map((c) => [c[0], c[1]]));
        expect(offByType.get('mousedown')).toBe(onByType.get('mousedown'));
        expect(offByType.get('mousemove')).toBe(onByType.get('mousemove'));
        expect(offByType.get('mouseup')).toBe(onByType.get('mouseup'));
        expect(offByType.get('touchstart')).toBe(onByType.get('touchstart'));
        expect(offByType.get('touchmove')).toBe(onByType.get('touchmove'));
        expect(offByType.get('touchend')).toBe(onByType.get('touchend'));

        expect(docRemoveSpy).toHaveBeenCalledWith('keydown', docAddSpy.mock.calls.find((c) => c[0] === 'keydown')?.[1]);
        expect(hintRemoveSpy).toHaveBeenCalledWith('click', hintAddSpy.mock.calls[0]?.[1]);
    });

    it('alerte et ne fait rien si Cache Storage est absent (message d\'origine inchangé)', () => {
        vi.stubGlobal('caches', undefined);
        const map = makeFakeMap();
        const state = makeFakeState(map);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        AoiMethods._startAoiFraming.call(state);

        expect(alertSpy).toHaveBeenCalledWith('Cache hors-ligne indisponible sur ce navigateur (Cache Storage absent).');
        expect(state._aoiFraming).toBe(false);
        expect(map.on).not.toHaveBeenCalled();
    });

    it('un rectangle valide (>8px) appelle _confirmAoi avec la bbox min/max attendue, et referme le cadrage', () => {
        vi.stubGlobal('caches', {} as CacheStorage);
        const map = makeFakeMap();
        const state = makeFakeState(map);
        AoiMethods._startAoiFraming.call(state);
        const byType = (t: string) => map.on.mock.calls.find((c) => c[0] === t)?.[1] as (e: unknown) => void;

        byType('mousedown')({
            lngLat: { lng: 2.0, lat: 48.0 },
            originalEvent: { preventDefault: vi.fn(), stopPropagation: vi.fn() },
        });
        byType('mouseup')({ lngLat: { lng: 2.1, lat: 48.1 } });

        expect(state._confirmAoi).toHaveBeenCalledWith({ west: 2.0, south: 48.0, east: 2.1, north: 48.1 });
        expect(state._aoiFraming).toBe(false);
    });

    it('un simple clic (<8px, même point) n\'appelle pas _confirmAoi et laisse le cadrage actif', () => {
        vi.stubGlobal('caches', {} as CacheStorage);
        const map = makeFakeMap();
        const state = makeFakeState(map);
        AoiMethods._startAoiFraming.call(state);
        const byType = (t: string) => map.on.mock.calls.find((c) => c[0] === t)?.[1] as (e: unknown) => void;

        byType('mousedown')({
            lngLat: { lng: 2.0, lat: 48.0 },
            originalEvent: { preventDefault: vi.fn(), stopPropagation: vi.fn() },
        });
        byType('mouseup')({ lngLat: { lng: 2.0, lat: 48.0 } });

        expect(state._confirmAoi).not.toHaveBeenCalled();
        expect(state._aoiFraming).toBe(true);
    });
});

describe('_confirmAoi (planMap.js:5414-5451) — quota et confirmation', () => {
    it('alerte "Aucune source cartographique disponible." et ne lance rien si styleTileTemplates() est vide', async () => {
        const state = makeFakeState(null);
        styleTileTemplatesMock.mockReturnValue([]);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        await AoiMethods._confirmAoi.call(state, makeBbox());

        expect(alertSpy).toHaveBeenCalledWith('Aucune source cartographique disponible.');
        expect(state._runAoiDownload).not.toHaveBeenCalled();
    });

    it('alerte "Zone hors couverture des sources cartographiques." si l\'estimation vaut 0', async () => {
        const state = makeFakeState(null);
        styleTileTemplatesMock.mockReturnValue([makeTemplate()]);
        estimateTileCountMock.mockReturnValue(0);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        await AoiMethods._confirmAoi.call(state, makeBbox());

        expect(alertSpy).toHaveBeenCalledWith('Zone hors couverture des sources cartographiques.');
        expect(state._runAoiDownload).not.toHaveBeenCalled();
    });

    it('refuse le téléchargement si l\'estimation dépasse AOI_MAX_TILES, avec le message d\'origine INCHANGÉ', async () => {
        const state = makeFakeState(null);
        const templates = [makeTemplate()];
        styleTileTemplatesMock.mockReturnValue(templates);
        const overCount = AOI_MAX_TILES + 1;
        estimateTileCountMock.mockReturnValue(overCount);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        await AoiMethods._confirmAoi.call(state, makeBbox());

        expect(alertSpy).toHaveBeenCalledWith(
            `Zone trop vaste : ${overCount.toLocaleString('fr-FR')} tuiles (max ${AOI_MAX_TILES.toLocaleString('fr-FR')}).\n`
            + 'Réduis l\'emprise ou refais un rectangle plus petit.'
        );
        expect(state._runAoiDownload).not.toHaveBeenCalled();
    });

    it('n\'appelle pas _runAoiDownload si l\'utilisateur refuse la boîte de confirmation', async () => {
        const state = makeFakeState(null);
        styleTileTemplatesMock.mockReturnValue([makeTemplate()]);
        estimateTileCountMock.mockReturnValue(500);
        vi.stubGlobal('alert', vi.fn());
        vi.stubGlobal('confirm', vi.fn(() => false));

        await AoiMethods._confirmAoi.call(state, makeBbox());

        expect(state._runAoiDownload).not.toHaveBeenCalled();
    });

    it('lance _runAoiDownload(bbox, AOI_MIN_Z, AOI_MAX_Z, templates, tileCount) si l\'utilisateur confirme', async () => {
        const state = makeFakeState(null);
        const templates = [makeTemplate()];
        styleTileTemplatesMock.mockReturnValue(templates);
        estimateTileCountMock.mockReturnValue(500);
        vi.stubGlobal('alert', vi.fn());
        vi.stubGlobal('confirm', vi.fn(() => true));
        const bbox = makeBbox();

        await AoiMethods._confirmAoi.call(state, bbox);

        expect(state._runAoiDownload).toHaveBeenCalledWith(bbox, 13, 18, templates, 500);
    });
});

describe('_runAoiDownload (planMap.js:5454-5505) — invariant §5.10 : _aoiDownloadBusy sur les 4 chemins de sortie', () => {
    it('refuse un second téléchargement si _aoiDownloadBusy est déjà true, avec le message d\'origine INCHANGÉ', async () => {
        const state = makeFakeState(null);
        state._aoiDownloadBusy = true;
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        await AoiMethods._runAoiDownload.call(state, makeBbox(), 13, 18, [], 10);

        expect(alertSpy).toHaveBeenCalledWith(
            'Un téléchargement de zone est déjà en cours. Attends la fin (ou annule-le) avant d\'en lancer un autre.'
        );
        expect(prefetchTilesMock).not.toHaveBeenCalled();
    });

    it('chemin 1/4 — erreur : _aoiDownloadBusy revient à false après un rejet de prefetchTiles', async () => {
        const state = makeFakeState(null);
        prefetchTilesMock.mockRejectedValueOnce(new Error('cache indisponible (test)'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(state._aoiDownloadBusy).toBe(false);
        const p = AoiMethods._runAoiDownload.call(state, makeBbox(), 13, 18, [], 10);
        // `_aoiDownloadBusy` passe à true de façon SYNCHRONE avant le premier `await`.
        expect(state._aoiDownloadBusy).toBe(true);
        await p;

        expect(state._aoiDownloadBusy).toBe(false);
        expect(errSpy).toHaveBeenCalled();
    });

    it('chemin 2/4 — abandon utilisateur : _aoiDownloadBusy revient à false après un clic sur le bouton "Annuler"', async () => {
        const state = makeFakeState(null);
        prefetchTilesMock.mockImplementationOnce(async (_bbox, _minZ, _maxZ, _templates, _onProgress, opts) => {
            // Simule le clic utilisateur pendant le téléchargement : déclenche
            // EXACTEMENT le handler câblé par _runAoiDownload (planMap.js:5464)
            // sur le vrai bouton produit par _createAoiProgressBar.
            const cancelBtn = document.querySelector<HTMLButtonElement>('#plan_aoi_progress button');
            cancelBtn?.click();
            return { total: 10, ok: 4, fail: 0, aborted: !!opts?.signal?.aborted };
        });

        await AoiMethods._runAoiDownload.call(state, makeBbox(), 13, 18, [], 10);

        expect(state._aoiDownloadBusy).toBe(false);
    });

    it('chemin 3/4 — succès complet (fail===0) : _aoiDownloadBusy revient à false', async () => {
        const state = makeFakeState(null);
        prefetchTilesMock.mockResolvedValueOnce({ total: 10, ok: 10, fail: 0, aborted: false });

        await AoiMethods._runAoiDownload.call(state, makeBbox(), 13, 18, [], 10);

        expect(state._aoiDownloadBusy).toBe(false);
    });

    it('chemin 4/4 — succès partiel (fail>0) : _aoiDownloadBusy revient à false', async () => {
        const state = makeFakeState(null);
        prefetchTilesMock.mockResolvedValueOnce({ total: 10, ok: 7, fail: 3, aborted: false });

        await AoiMethods._runAoiDownload.call(state, makeBbox(), 13, 18, [], 10);

        expect(state._aoiDownloadBusy).toBe(false);
    });

    it('écrit dans pcTacAoiIndex une entrée avec les 8 champs attendus (bbox/minZ/maxZ/total/ok/fail/complete/ts)', async () => {
        const state = makeFakeState(null);
        const bbox: GeoBBox = { west: 1.1, south: 2.2, east: 3.3, north: 4.4 };
        prefetchTilesMock.mockResolvedValueOnce({ total: 42, ok: 40, fail: 2, aborted: false });
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

        await AoiMethods._runAoiDownload.call(state, bbox, 13, 18, [], 42);

        const raw = localStorage.getItem(AOI_INDEX_KEY);
        expect(raw).not.toBeNull();
        const index = JSON.parse(raw ?? '[]') as AoiIndexEntry[];
        expect(index).toHaveLength(1);
        expect(index[0]).toEqual({
            bbox, minZ: 13, maxZ: 18,
            total: 42, ok: 40, fail: 2,
            complete: false, // fail=2 → complete = (result.fail === 0) = false
            ts: 1700000000000,
        });
        expect(Object.keys(index[0] as object).sort()).toEqual(
            ['bbox', 'complete', 'fail', 'maxZ', 'minZ', 'ok', 'total', 'ts'].sort()
        );
        nowSpy.mockRestore();
    });

    it('n\'écrit PAS dans pcTacAoiIndex si le téléchargement est annulé (result.aborted)', async () => {
        const state = makeFakeState(null);
        prefetchTilesMock.mockResolvedValueOnce({ total: 10, ok: 3, fail: 0, aborted: true });

        await AoiMethods._runAoiDownload.call(state, makeBbox(), 13, 18, [], 10);

        expect(localStorage.getItem(AOI_INDEX_KEY)).toBeNull();
    });
});

describe('_createAoiProgressBar (planMap.js:5508-5564) — surface AoiProgressUi', () => {
    it('crée la barre, l\'attache au DOM et expose exactement cancelBtn/setLabel/update/remove (piège §4)', () => {
        const state = makeFakeState(null);

        const ui = AoiMethods._createAoiProgressBar.call(state, 1234);

        expect(document.getElementById('plan_aoi_progress')).not.toBeNull();
        expect(ui.cancelBtn).toBeInstanceOf(HTMLButtonElement);
        expect(typeof ui.setLabel).toBe('function');
        expect(typeof ui.update).toBe('function');
        expect(typeof ui.remove).toBe('function');

        expect(() => ui.update(5, 10, 3, 2)).not.toThrow();
        expect(() => ui.setLabel('test label')).not.toThrow();
        expect(document.getElementById('plan_aoi_progress')?.textContent).toContain('test label');

        ui.remove();
        expect(document.getElementById('plan_aoi_progress')).toBeNull();
    });

    it('s\'attache au parent de #plan_map si présent, sinon à document.body', () => {
        document.body.innerHTML = '<div id="plan_map_host"><div id="plan_map"></div></div>';
        const state = makeFakeState(null);

        AoiMethods._createAoiProgressBar.call(state, 10);

        const host = document.getElementById('plan_map_host');
        expect(host?.querySelector('#plan_aoi_progress')).not.toBeNull();
    });
});
