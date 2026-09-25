/**
 * pm-capture-pdf.test.ts — Capture du plan pour le PDF (audit PDF du
 * 2026-09-25, constats M7 et M8) :
 *  - définition voulue (`targetWidthPx`) : `setPixelRatio` borné par la carte
 *    graphique et la surface de canvas d'iOS, rendu restauré après ;
 *  - carte prête avant la capture (style, sources, `idle`), même quand
 *    l'onglet Plan n'a jamais été ouvert ;
 *  - contrôles de zoom masqués, boussole gardée ;
 *  - légende sous l'image : elle ne recouvre plus l'échelle ;
 *  - cercles de diamètre des points posés quand le style est chargé (plus
 *    d'erreur « Style is not done loading ») ;
 *  - page du plan orientée selon la capture (portrait de téléphone).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../src/shared/feedback.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../src/shared/feedback.js')>()),
    toast: toastSpy,
}));

import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';

/** Contexte 2D factice : ce que la capture et la légende appellent. */
function fakeCtx(): CanvasRenderingContext2D {
    return {
        drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })), font: '', fillStyle: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D;
}

function makeContainer(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'plan_map';
    Object.defineProperty(el, 'offsetWidth', { value: 800, configurable: true });
    el.innerHTML = `<div class="maplibregl-ctrl-top-left"><div class="maplibregl-ctrl-group">
        <button class="maplibregl-ctrl-zoom-in"></button><button class="maplibregl-ctrl-zoom-out"></button>
        <button class="maplibregl-ctrl-compass"></button></div></div>
        <div class="maplibregl-ctrl-bottom-left"><div class="maplibregl-ctrl maplibregl-ctrl-scale">30 m</div></div>
        <div class="maplibregl-ctrl-bottom-right"><details class="maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show">
        <div class="maplibregl-ctrl-attrib-inner">Tiles © Esri</div></details></div>`;
    document.body.appendChild(el);
    return el;
}

/** Canvas WebGL factice qui suit le rapport de pixels posé par `setPixelRatio`. */
function makeMap(container: HTMLElement, opts: { loaded?: boolean; maxTextureSize?: number; dpr?: number } = {}) {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
    let ratio = opts.dpr ?? 1;
    const resize = (): void => { canvas.width = Math.round(800 * ratio); canvas.height = Math.round(600 * ratio); };
    resize();
    const map = {
        _overridePixelRatio: null as number | null,
        painter: { context: { maxTextureSize: opts.maxTextureSize ?? 8192 } },
        getContainer: () => container,
        getCanvas: () => canvas,
        isMoving: () => false,
        areTilesLoaded: () => true,
        loaded: vi.fn(() => opts.loaded ?? true),
        triggerRepaint: vi.fn(),
        once: vi.fn((_type: string, cb: () => void) => { cb(); }),
        off: vi.fn(),
        getBearing: () => 0,
        getPixelRatio: () => ratio,
        setPixelRatio: vi.fn((r: number | null) => { map._overridePixelRatio = r; ratio = r ?? (opts.dpr ?? 1); resize(); }),
    };
    return map;
}

function makeThis(map: unknown, overrides: Record<string, unknown> = {}): PlanMapInternal {
    return {
        map, _captureBusy: false, _activeWheel: null, _handleMarkers: [], _toolbarMarker: null, _drawingDiameterMarker: null,
        ...overrides,
    } as unknown as PlanMapInternal;
}

async function loadCapture(h2c: unknown) {
    vi.resetModules();
    vi.doMock('html2canvas', () => ({ default: h2c }));
    return (await import('../../../src/apps/pctac/planmap/capture.js')).CaptureMethods;
}

let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx());
    // Le PNG « rendu » décrit la taille du canvas de sortie.
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
        return `data:image/png;base64,${this.width}x${this.height}`;
    });
});

afterEach(() => {
    getContextSpy.mockRestore();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.doUnmock('html2canvas');
    Reflect.deleteProperty(window, 'PlanMap');
    Reflect.deleteProperty(window, 'UI');
    localStorage.clear();
});

describe('capture.ts — définition voulue pour l’impression', () => {
    it('pose le rapport de pixels visé, capture à cette définition, puis le restaure', async () => {
        const map = makeMap(makeContainer());
        const Capture = await loadCapture(vi.fn(async () => document.createElement('canvas')));
        const out = await Capture.captureToDataUrl.call(makeThis(map), { targetWidthPx: 2000 });
        expect(map.setPixelRatio).toHaveBeenNthCalledWith(1, 2.5);
        expect(out).toBe('data:image/png;base64,2000x1500');
        // Restauré : plus de forçage (retour au devicePixelRatio).
        expect(map.setPixelRatio).toHaveBeenLastCalledWith(null);
    });

    it('bornée par la taille de texture de la carte graphique', async () => {
        const map = makeMap(makeContainer(), { maxTextureSize: 2048 });
        const Capture = await loadCapture(vi.fn(async () => document.createElement('canvas')));
        await Capture.captureToDataUrl.call(makeThis(map), { targetWidthPx: 4000 });
        expect(map.setPixelRatio).toHaveBeenNthCalledWith(1, 2048 / 800);
    });

    it('bornée par la surface de canvas d’iOS', async () => {
        const map = makeMap(makeContainer());
        const Capture = await loadCapture(vi.fn(async () => document.createElement('canvas')));
        await Capture.captureToDataUrl.call(makeThis(map), { targetWidthPx: 20000 });
        const ratio = (map.setPixelRatio.mock.calls[0] as [number])[0];
        expect(800 * ratio * 600 * ratio).toBeLessThanOrEqual(16_777_216);
    });

    it('ne réduit jamais la définition de l’écran', async () => {
        const map = makeMap(makeContainer(), { dpr: 3 });
        const Capture = await loadCapture(vi.fn(async () => document.createElement('canvas')));
        await Capture.captureToDataUrl.call(makeThis(map), { targetWidthPx: 1200 });
        expect(map.setPixelRatio).not.toHaveBeenCalled();
    });

    it('restaure le rapport de pixels même quand la capture échoue', async () => {
        const map = makeMap(makeContainer());
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const Capture = await loadCapture(vi.fn(async () => { throw new Error('h2c'); }));
        const out = await Capture.captureToDataUrl.call(makeThis(map), { targetWidthPx: 2000 });
        expect(out).toBeNull();
        expect(map.setPixelRatio).toHaveBeenLastCalledWith(null);
    });
});

describe('capture.ts — carte prête et habillage', () => {
    it('attend l’événement idle quand la carte n’a pas fini de charger (onglet jamais ouvert)', async () => {
        const map = makeMap(makeContainer(), { loaded: false });
        const Capture = await loadCapture(vi.fn(async () => document.createElement('canvas')));
        await Capture.captureToDataUrl.call(makeThis(map));
        expect(map.once).toHaveBeenCalledWith('idle', expect.any(Function));
    });

    it('masque les boutons de zoom (boussole gardée) pendant la capture, puis les rend', async () => {
        const container = makeContainer();
        const map = makeMap(container);
        const seen: Record<string, string> = {};
        const Capture = await loadCapture(vi.fn(async () => {
            seen.zoomIn = container.querySelector<HTMLElement>('.maplibregl-ctrl-zoom-in')!.style.display;
            seen.compass = container.querySelector<HTMLElement>('.maplibregl-ctrl-compass')!.style.display;
            return document.createElement('canvas');
        }));
        await Capture.captureToDataUrl.call(makeThis(map));
        expect(seen.zoomIn).toBe('none');
        expect(seen.compass).not.toBe('none');
        expect(container.querySelector<HTMLElement>('.maplibregl-ctrl-zoom-in')!.style.display).toBe('');
    });

    it('capture pour l’impression : attributions masquées (le PDF les écrit sous l’image), échelle gardée', async () => {
        // Sur téléphone, le cartouche d'attributions déplié couvrait l'échelle.
        const container = makeContainer();
        const map = makeMap(container);
        const seen: Record<string, string> = {};
        const Capture = await loadCapture(vi.fn(async () => {
            seen.attrib = container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib')!.style.display;
            seen.scale = container.querySelector<HTMLElement>('.maplibregl-ctrl-scale')!.style.display;
            return document.createElement('canvas');
        }));
        await Capture.captureToDataUrl.call(makeThis(map), { targetWidthPx: 2000 });
        expect(seen).toEqual({ attrib: 'none', scale: '' });
        expect(container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib')!.style.display).toBe('');
    });

    it('capture sans définition voulue (image téléchargée seule) : attributions gardées', async () => {
        const container = makeContainer();
        const map = makeMap(container);
        let attrib = '';
        const Capture = await loadCapture(vi.fn(async () => {
            attrib = container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib')!.style.display;
            return document.createElement('canvas');
        }));
        await Capture.captureToDataUrl.call(makeThis(map));
        expect(attrib).toBe('');
    });

    it('la légende des surimpressions est posée SOUS la carte : l’échelle reste visible', async () => {
        const map = makeMap(makeContainer());
        const Capture = await loadCapture(vi.fn(async () => document.createElement('canvas')));
        const overlays = { state: { gridOn: false, mgrsOn: true, powerOn: false } };
        const out = await Capture.captureToDataUrl.call(makeThis(map, { overlays }));
        // 800 × 600 de carte, plus un bandeau de 29 px dessous.
        expect(out).toBe('data:image/png;base64,800x629');
    });
});

describe('pins.ts — cercles de diamètre posés quand le style est chargé', () => {
    async function pinsThis(styleLoaded: boolean) {
        const { PinsMethods } = await import('../../../src/apps/pctac/planmap/pins.js');
        const { GeoMethods } = await import('../../../src/apps/pctac/planmap/geo.js');
        const { createPlanMapState } = await import('../../../src/apps/pctac/planmap/state.js');
        const map = { style: { _loaded: styleLoaded }, getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const self = {
            ...createPlanMapState(), ...GeoMethods, ...PinsMethods, map,
            // Étiquettes « ⌀ » (marqueurs DOM) hors sujet ici : seules les couches comptent.
            _diameterGlobal: false,
            _loadPins: () => [{ id: 'p1', lng: 0.69, lat: 47.39, label: 'PRV', diameterM: 50 }],
        } as unknown as PlanMapInternal;
        return { self, map, PinsMethods };
    }

    it('style pas encore chargé : aucune couche tentée, aucune erreur', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { self, map, PinsMethods } = await pinsThis(false);
        PinsMethods._renderPinDecorations.call(self);
        expect(map.addSource).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
    });

    it('style chargé : la source et les couches des cercles sont posées', async () => {
        const { self, map, PinsMethods } = await pinsThis(true);
        PinsMethods._renderPinDecorations.call(self);
        expect(map.addSource).toHaveBeenCalledWith('plan-pin-circles-src', expect.anything());
        expect(map.addLayer).toHaveBeenCalledTimes(2);
    });
});

describe('map-core.ts — les cercles des points sont posés au chargement du style', () => {
    it('le gestionnaire « load » redessine les décorations des points', async () => {
        vi.resetModules();
        const handlers: Record<string, (() => void)[]> = {};
        vi.doMock('maplibre-gl', () => {
            class FakeMap {
                on(type: string, fn: () => void): void { (handlers[type] ??= []).push(fn); }
                addControl(): void {}
            }
            class Control {}
            return { default: { Map: FakeMap, NavigationControl: Control, ScaleControl: Control } };
        });
        document.body.innerHTML = '<div id="plan_map"></div>';
        const { MapCoreMethods } = await import('../../../src/apps/pctac/planmap/map-core.js');
        const stub = (): ReturnType<typeof vi.fn> => vi.fn();
        const renderDecorations = vi.fn();
        const self = {
            initialized: false, _safe: (fn: unknown) => fn, _loadView: () => ({ center: [0, 0], zoom: 5 }),
            _bindUi: stub(), _initOverlays: stub(), _initDrawingLayers: stub(), _bindDrawUi: stub(), _bindTextModalOnce: stub(),
            _renderShapes: stub(), _renderShapeTexts: stub(), _initStreetLabels: stub(), _initTopoLayers: stub(), _initLidar: stub(),
            _loadGpxTracks: vi.fn(async () => {}), _renderPins: stub(), _initOfflineCache: stub(),
            _renderPinDecorations: renderDecorations,
        } as unknown as PlanMapInternal;
        MapCoreMethods.init.call(self);
        expect(renderDecorations).not.toHaveBeenCalled();
        handlers.load?.forEach((fn) => fn());
        expect(renderDecorations).toHaveBeenCalled();
        vi.doUnmock('maplibre-gl');
    });
});

describe('plan-capture-for-pdf — définition selon la forme de la carte', () => {
    it('la largeur voulue est calculée d’après le rapport largeur/hauteur de la carte', async () => {
        const { capturePlanForPdf } = await import('../../../src/apps/pctac/plan-capture-for-pdf.js');
        const container = document.createElement('div');
        Object.defineProperty(container, 'clientWidth', { value: 390, configurable: true });
        Object.defineProperty(container, 'clientHeight', { value: 700, configurable: true });
        const captureToDataUrl = vi.fn(async () => null);
        Reflect.set(window, 'PlanMap', { captureToDataUrl, map: { getContainer: () => container } });
        const widthFor = vi.fn((aspect: number) => (aspect < 1 ? 1300 : 2600));
        await capturePlanForPdf({ targetWidthPxFor: widthFor, settleMs: 0 });
        expect(widthFor).toHaveBeenCalledWith(390 / 700);
        expect(captureToDataUrl).toHaveBeenCalledWith({ targetWidthPx: 1300 });
    });
});
