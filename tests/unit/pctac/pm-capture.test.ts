/**
 * pm-capture.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js:5054-5291`
 * (GStart-main, lecture seule) pour le paquet `pm-capture` :
 * `planmap/capture.ts` (`CaptureMethods.captureToDataUrl` / `_takeScreenshot`).
 *
 * `this` FACTICE (jamais `new maplibregl.Map`, cf. SPEC-PCTAC-CONVERSION §8.4) :
 * un faux `map` ne portant que la surface réellement appelée par la chaîne
 * (`getContainer`, `getCanvas`, `isMoving`, `areTilesLoaded`, `triggerRepaint`,
 * `once`, `off`), cast `as unknown as PlanMapInternal` (même idiome que
 * pm-core.test.ts pour `SafeMethods._safe`, élargi car `PlanMapInternal` ne
 * "chevauche" pas suffisamment un littéral partiel pour un simple `as`).
 *
 * `html2canvas` est mocké via `vi.doMock` + `vi.resetModules()` + import
 * dynamique de `capture.ts` À CHAQUE test : c'est la seule façon de faire
 * varier "html2canvas absent" (contrat C2) d'un test à l'autre sans toucher
 * au module source (import statique `import html2canvas from 'html2canvas'`
 * dans capture.ts — SPEC-PCTAC-CONVERSION §1.4).
 *
 * `HTMLCanvasElement.prototype.getContext('2d')` n'est pas implémenté par
 * jsdom (retourne `null`, cf. le paquet `canvas` absent des dépendances) :
 * mocké pour toute la suite avec un faux contexte 2D (`drawImage` en no-op),
 * sinon la garde TS (d) de capture.ts (`if (!ctx) return null`) empêcherait
 * d'atteindre `html2canvas(...)` dans tous les tests qui vont plus loin que
 * les 5 gardes d'entrée.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';

// ---------------------------------------------------------------------------
// Fabriques de DOM/`this` factice
// ---------------------------------------------------------------------------

/** Conteneur `#plan_map` factice : `offsetWidth` figé (jsdom ne fait pas de layout). */
function makeMapContainer(offsetWidth = 800): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: offsetWidth, configurable: true });
    document.body.appendChild(el);
    return el;
}

/** Canvas WebGL factice : dimensions pixel réelles + `clientWidth/Height` figés. */
function makeGlCanvas(clientWidth = 800, clientHeight = 600): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = clientWidth;
    c.height = clientHeight;
    Object.defineProperty(c, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(c, 'clientHeight', { value: clientHeight, configurable: true });
    return c;
}

interface FakeMapOptions {
    isMoving?: boolean;
    areTilesLoaded?: boolean;
}

/** Sous-ensemble RÉELLEMENT appelé de `maplibregl.Map` par la chaîne de capture. */
function makeFakeMap(container: HTMLElement, canvas: HTMLCanvasElement, opts: FakeMapOptions = {}) {
    return {
        getContainer: () => container,
        getCanvas: () => canvas,
        isMoving: () => opts.isMoving ?? false,
        areTilesLoaded: () => opts.areTilesLoaded ?? true,
        triggerRepaint: () => {},
        once: (_type: string, cb: () => void) => { cb(); },
        off: () => {},
    };
}

/** `this` factice — cast `unknown` car `PlanMapInternal` (159 méthodes) ne
 * "chevauche" pas suffisamment un littéral partiel pour un `as` direct. */
function makeFakeThis(overrides: Record<string, unknown> = {}): PlanMapInternal {
    return {
        map: null,
        _captureBusy: false,
        _activeWheel: null,
        _handleMarkers: [],
        _toolbarMarker: null,
        _drawingDiameterMarker: null,
        ...overrides,
    } as unknown as PlanMapInternal;
}

/** Recharge `capture.ts` avec `html2canvas` mocké à la valeur donnée pour CE test. */
async function loadCapture(html2canvasValue: unknown) {
    vi.resetModules();
    vi.doMock('html2canvas', () => ({ default: html2canvasValue }));
    const mod = await import('../../../src/apps/pctac/planmap/capture.js');
    return mod.CaptureMethods;
}

// ---------------------------------------------------------------------------

let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    // jsdom : HTMLCanvasElement.getContext('2d') n'est pas implémenté (paquet
    // `canvas` absent) → sans ce mock, TOUT accès au-delà des 5 gardes
    // d'entrée échouerait sur la garde `if (!ctx) return null` de capture.ts.
    const fakeCtx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
});

afterEach(() => {
    getContextSpy.mockRestore();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.doUnmock('html2canvas');
});

describe('capture.ts — captureToDataUrl (planMap.js:5054-5241) — CONTRAT C2, 5 conditions null', () => {
    it('1) retourne null si !this.map', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const fake = makeFakeThis({ map: null });

        const result = await CaptureMethods.captureToDataUrl.call(fake);

        expect(result).toBeNull();
    });

    it('2) retourne null si html2canvas est indisponible (typeof !== "function")', async () => {
        // planMap.js:5056 — équivalent TS de `typeof html2canvas === 'undefined'`.
        const CaptureMethods = await loadCapture(undefined);
        const container = makeMapContainer();
        const canvas = makeGlCanvas();
        const fake = makeFakeThis({ map: makeFakeMap(container, canvas) });

        const result = await CaptureMethods.captureToDataUrl.call(fake);

        expect(result).toBeNull();
    });

    it('3) retourne null si !mapContainer (this.map.getContainer() falsy)', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const canvas = makeGlCanvas();
        const fake = makeFakeThis({
            map: {
                getContainer: () => null,
                getCanvas: () => canvas,
                isMoving: () => false,
                areTilesLoaded: () => true,
                triggerRepaint: () => {},
                once: () => {},
                off: () => {},
            },
        });

        const result = await CaptureMethods.captureToDataUrl.call(fake);

        expect(result).toBeNull();
    });

    it('4) retourne null si !mapContainer.offsetWidth (vue Plan cachée)', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const container = makeMapContainer(0); // offsetWidth 0 : vue masquée
        const canvas = makeGlCanvas();
        const fake = makeFakeThis({ map: makeFakeMap(container, canvas) });

        const result = await CaptureMethods.captureToDataUrl.call(fake);

        expect(result).toBeNull();
    });

    it('5) retourne null si this._captureBusy (capture déjà en cours)', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const container = makeMapContainer();
        const canvas = makeGlCanvas();
        const fake = makeFakeThis({ map: makeFakeMap(container, canvas), _captureBusy: true });

        const result = await CaptureMethods.captureToDataUrl.call(fake);

        expect(result).toBeNull();
        // planMap.js:5073-5074 — le verrou n'est PAS touché quand on sort par cette garde.
        expect(fake._captureBusy).toBe(true);
    });
});

describe('capture.ts — captureToDataUrl — finally (planMap.js:5227-5240)', () => {
    it("restaure les `display` mémorisés ET remet `_captureBusy` à false MÊME QUAND html2canvas jette", async () => {
        const boom = new Error('html2canvas a explosé');
        const CaptureMethods = await loadCapture(vi.fn().mockImplementation(() => { throw boom; }));

        const container = makeMapContainer();
        const canvas = makeGlCanvas();

        // Un élément de `toHide` (planMap.js:5079-5087) avec un display connu, à restaurer.
        const hint = document.createElement('div');
        hint.id = 'plan_hint';
        hint.style.display = 'block';
        document.body.appendChild(hint);

        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const fake = makeFakeThis({ map: makeFakeMap(container, canvas) });

        const result = await CaptureMethods.captureToDataUrl.call(fake);

        expect(result).toBeNull();
        expect(errSpy).toHaveBeenCalledWith('[PlanMap] capture échec:', boom);
        // planMap.js:5238 — display restauré (pas resté 'none').
        expect(hint.style.display).toBe('block');
        // planMap.js:5239 — verrou anti-concurrence relâché.
        expect(fake._captureBusy).toBe(false);
        // planMap.js:5178-5188 — l'attribut d'épinglage px ne doit pas fuiter.
        expect(container.hasAttribute('data-h2c-pin')).toBe(false);

        errSpy.mockRestore();
    });

    it("restaure aussi quand l'exception survient AVANT html2canvas (getContext('2d') → null)", async () => {
        // Adaptation (d) du §5.5 : le `if (!ctx) return null` doit lui aussi
        // passer par le `finally` (retour DEPUIS le `try`, pas un throw).
        getContextSpy.mockReturnValue(null);
        const CaptureMethods = await loadCapture(vi.fn());

        const container = makeMapContainer();
        const canvas = makeGlCanvas();
        const hint = document.createElement('div');
        hint.id = 'plan_hint';
        hint.style.display = 'block';
        document.body.appendChild(hint);

        const fake = makeFakeThis({ map: makeFakeMap(container, canvas) });

        const result = await CaptureMethods.captureToDataUrl.call(fake);

        expect(result).toBeNull();
        expect(hint.style.display).toBe('block');
        expect(fake._captureBusy).toBe(false);
    });
});

describe('capture.ts — _takeScreenshot (planMap.js:5258-5291)', () => {
    it('alerte et ne déclenche pas de capture si html2canvas est indisponible', async () => {
        const CaptureMethods = await loadCapture(undefined);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const captureSpy = vi.fn();
        const fake = makeFakeThis({ map: {}, captureToDataUrl: captureSpy });

        await CaptureMethods._takeScreenshot.call(fake);

        expect(alertSpy).toHaveBeenCalledWith('Librairie html2canvas indisponible (réseau ?)');
        expect(captureSpy).not.toHaveBeenCalled();
    });

    it('ne fait rien (silencieux) si !this.map', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const fake = makeFakeThis({ map: null });

        await CaptureMethods._takeScreenshot.call(fake);

        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('ne fait rien (silencieux) si this._captureBusy — évite le mensonge "Capture impossible"', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const fake = makeFakeThis({ map: {}, _captureBusy: true });

        await CaptureMethods._takeScreenshot.call(fake);

        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('alerte avec le message d\'erreur si captureToDataUrl() jette (catch e instanceof Error)', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const fake = makeFakeThis({
            map: {},
            captureToDataUrl: vi.fn().mockRejectedValue(new Error('kaboom')),
        });

        await CaptureMethods._takeScreenshot.call(fake);

        expect(alertSpy).toHaveBeenCalledWith('Erreur lors de la capture : kaboom');
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });

    it('alerte "Capture impossible" si captureToDataUrl() résout null', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const fake = makeFakeThis({ map: {}, captureToDataUrl: vi.fn().mockResolvedValue(null) });

        await CaptureMethods._takeScreenshot.call(fake);

        expect(alertSpy).toHaveBeenCalledWith('Capture impossible (carte non initialisée ?)');
    });

    it('déclenche le téléchargement (lien <a download> cliqué) quand captureToDataUrl() résout un dataURL', async () => {
        const CaptureMethods = await loadCapture(vi.fn());
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const dataUrl = 'data:image/png;base64,AAAA';
        const fake = makeFakeThis({ map: {}, captureToDataUrl: vi.fn().mockResolvedValue(dataUrl) });

        await CaptureMethods._takeScreenshot.call(fake);

        expect(clickSpy).toHaveBeenCalledTimes(1);
    });
});
