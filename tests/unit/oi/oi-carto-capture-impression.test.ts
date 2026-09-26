/**
 * Captures de carte de l'OI pour le PDF (point 10, audit PDF du 2026-09-25,
 * F12) : attente du chargement (événement `idle`, délai borné, message si
 * dépassé), refus d'une carte vide ou incomplète (hors ligne), contrôles
 * masqués, définition doublée bornée par la carte graphique, flèche du nord et
 * échelle toujours incrustées.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ toast: toastSpy }));

import { capturePixelRatio, mapSampleVerdict, niceScale } from '../../../src/apps/oi/carto/capture.js';
import type { OICartoInternal } from '../../../src/apps/oi/carto/types.js';

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/** Échantillon RGBA de `n` pixels, fabriqué pixel par pixel. */
function sample(n: number, px: (i: number) => [number, number, number, number]): Uint8ClampedArray {
    const d = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) d.set(px(i), i * 4);
    return d;
}
const varied = (i: number): [number, number, number, number] => [(i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255];

describe('mapSampleVerdict — la carte a-t-elle un fond ?', () => {
    it('tout transparent (tuiles absentes, hors ligne) : vide', () => {
        expect(mapSampleVerdict(sample(4096, () => [0, 0, 0, 0]))).toBe('vide');
    });
    it('uniforme même opaque (écran noir, gris) : vide', () => {
        expect(mapSampleVerdict(sample(4096, () => [20, 20, 20, 255]))).toBe('vide');
    });
    it('un dixième de trous transparents : incomplète', () => {
        expect(mapSampleVerdict(sample(4096, (i) => (i % 10 === 0 ? [0, 0, 0, 0] : varied(i))))).toBe('incomplete');
    });
    it('image variée et couvrante : ok', () => {
        expect(mapSampleVerdict(sample(4096, varied))).toBe('ok');
    });
});

describe('niceScale — barre d’échelle ronde', () => {
    it('prend la plus grande valeur ronde (1, 2, 5 × 10ⁿ) qui tient', () => {
        expect(niceScale(0.5, 700)).toEqual({ meters: 200, px: 400, label: '200 m' });
        expect(niceScale(10, 400)).toEqual({ meters: 2000, px: 200, label: '2 km' });
    });
    it('rend null pour une mesure absurde', () => {
        expect(niceScale(0, 400)).toBeNull();
        expect(niceScale(Number.NaN, 400)).toBeNull();
    });
});

describe('capturePixelRatio — définition doublée, bornée par la carte graphique', () => {
    it('double l’écran de bureau', () => {
        expect(capturePixelRatio(1440, 900, 1, 16384)).toBe(2);
    });
    it('garde la densité d’un téléphone déjà plus fine', () => {
        expect(capturePixelRatio(390, 700, 3, 4096)).toBe(3);
    });
    it('jamais plus de 4096 pixels de côté (iOS), même si la carte graphique accepte plus', () => {
        expect(capturePixelRatio(2560, 1440, 1, 16384)).toBeCloseTo(1.6);
    });
    it('borné par une carte graphique plus petite', () => {
        expect(capturePixelRatio(1440, 900, 1, 2048)).toBeCloseTo(2048 / 1440);
    });
});

// ---------------------------------------------------------------------------
// Chaîne de capture (`_captureCanvas`) avec une carte simulée
// ---------------------------------------------------------------------------

interface Ctx2d {
    calls: { name: string; args: unknown[] }[];
    pixels: Uint8ClampedArray;
}

/** Contexte 2D enregistreur : chaque appel est noté, `getImageData` rend l'échantillon voulu. */
function makeCtx(pixels: Uint8ClampedArray): Ctx2d & CanvasRenderingContext2D {
    const rec: Ctx2d = { calls: [], pixels };
    return new Proxy(rec, {
        get(target, prop) {
            if (prop in target) return target[prop as keyof Ctx2d];
            if (prop === 'getImageData') return () => ({ data: target.pixels });
            if (prop === 'measureText') return (t: string) => ({ width: t.length * 7 });
            return (...args: unknown[]) => { target.calls.push({ name: String(prop), args }); };
        },
        set() { return true; },
    }) as Ctx2d & CanvasRenderingContext2D;
}

function glCanvas(w = 800, h = 600): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    Object.defineProperty(c, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(c, 'clientHeight', { value: h, configurable: true });
    return c;
}

function makeMap(opts: { idle?: boolean; bearing?: number; canvas?: HTMLCanvasElement } = {}) {
    const canvas = opts.canvas ?? glCanvas();
    const lngLat = (x: number) => ({ lng: x, lat: 0, distanceTo: (o: { lng: number }) => Math.abs(o.lng - x) * 0.5 });
    return {
        getCanvas: vi.fn(() => canvas),
        triggerRepaint: vi.fn(),
        isMoving: vi.fn(() => false),
        areTilesLoaded: vi.fn(() => opts.idle !== false),
        once: vi.fn((ev: string, cb: () => void) => { if (ev === 'idle' && opts.idle !== false) cb(); }),
        off: vi.fn(),
        getPixelRatio: vi.fn(() => 1),
        setPixelRatio: vi.fn(),
        getBearing: vi.fn(() => opts.bearing ?? 0),
        // 0,5 m par pixel CSS le long de l'axe horizontal.
        unproject: vi.fn((p: [number, number]) => lngLat(p[0])),
    };
}

function mapWrap(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'oi_carto_map_wrap';
    Object.defineProperty(el, 'offsetWidth', { value: 800, configurable: true });
    el.innerHTML = `
        <div class="maplibregl-ctrl-top-left"><div class="maplibregl-ctrl maplibregl-ctrl-group" id="nav"></div></div>
        <div class="maplibregl-ctrl-bottom-right">
            <div class="maplibregl-ctrl maplibregl-ctrl-scale" id="scale">100 m</div>
            <details class="maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact" id="attrib"></details>
        </div>`;
    document.body.appendChild(el);
    return el;
}

async function load(html2canvasImpl: (...a: unknown[]) => Promise<HTMLCanvasElement>) {
    vi.resetModules();
    vi.doMock('html2canvas', () => ({ default: html2canvasImpl }));
    return (await import('../../../src/apps/oi/carto/capture.js')).CaptureMethods;
}

function state(methods: object, map: ReturnType<typeof makeMap>): OICartoInternal {
    return { map, ...methods } as unknown as OICartoInternal;
}

let ctx: Ctx2d & CanvasRenderingContext2D;
function useCtx(pixels: Uint8ClampedArray): void {
    ctx = makeCtx(pixels);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => (type === '2d' ? ctx : null)) as unknown as HTMLCanvasElement['getContext']);
}

// jsdom : `showModal()` absent (même polyfill que `oi-carto-panels-capture.test.ts`).
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void { this.setAttribute('open', ''); };
}

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    toastSpy.mockClear();
});

describe('_captureCanvas — capture d’impression', () => {
    it('attend l’événement idle, double la définition puis la rend', async () => {
        useCtx(sample(4096, varied));
        mapWrap();
        const map = makeMap();
        const methods = await load(vi.fn(async () => document.createElement('canvas')));

        const out = await state(methods, map)._captureCanvas();

        expect(out).toBeInstanceOf(HTMLCanvasElement);
        expect(map.once).toHaveBeenCalledWith('idle', expect.any(Function));
        expect(map.setPixelRatio).toHaveBeenNthCalledWith(1, 2);
        expect(map.setPixelRatio).toHaveBeenCalledTimes(2); // rendue après la capture
    });

    it('masque les boutons et l’échelle de MapLibre pendant la capture, déplie l’attribution, puis restaure', async () => {
        useCtx(sample(4096, varied));
        mapWrap();
        let during: Record<string, string | boolean> = {};
        const methods = await load(vi.fn(async () => {
            during = {
                nav: (document.getElementById('nav') as HTMLElement).style.display,
                scale: (document.getElementById('scale') as HTMLElement).style.display,
                attrib: (document.getElementById('attrib') as HTMLElement).classList.contains('maplibregl-compact-show'),
            };
            return document.createElement('canvas');
        }));

        await state(methods, makeMap())._captureCanvas();

        expect(during).toEqual({ nav: 'none', scale: 'none', attrib: true });
        expect((document.getElementById('nav') as HTMLElement).style.display).toBe('');
        expect((document.getElementById('attrib') as HTMLElement).classList.contains('maplibregl-compact-show')).toBe(false);
    });

    it('incruste la flèche du nord (orientée) et une échelle ronde', async () => {
        useCtx(sample(4096, varied));
        mapWrap();
        const methods = await load(vi.fn(async () => document.createElement('canvas')));

        await state(methods, makeMap({ bearing: 60 }))._captureCanvas();

        const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
        expect(texts).toContain('N');
        expect(texts).toContain('50 m'); // 0,5 m/px, barre ≤ 20 % de 800 px
        const rotations = ctx.calls.filter((c) => c.name === 'rotate').map((c) => c.args[0] as number);
        expect(rotations.some((r) => Math.abs(r + (60 * Math.PI) / 180) < 1e-9)).toBe(true);
    });

    it('refuse une carte vide hors ligne, avec un message clair, sans rien composer', async () => {
        useCtx(sample(4096, () => [0, 0, 0, 0]));
        mapWrap();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const h2c = vi.fn(async () => document.createElement('canvas'));
        const methods = await load(h2c);
        const map = makeMap();

        const out = await state(methods, map)._captureCanvas();

        expect(out).toBeNull();
        expect(h2c).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/refusée.*hors ligne/i), { kind: 'error' });
        expect(map.setPixelRatio).toHaveBeenCalledTimes(2); // définition rendue malgré le refus
    });

    it('refuse une carte uniforme (écran noir) en ligne', async () => {
        useCtx(sample(4096, () => [0, 0, 0, 255]));
        mapWrap();
        const methods = await load(vi.fn(async () => document.createElement('canvas')));

        expect(await state(methods, makeMap())._captureCanvas()).toBeNull();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/refusée.*vide/i), { kind: 'error' });
    });

    it('refuse une carte trouée (tuiles manquantes)', async () => {
        useCtx(sample(4096, (i) => (i % 10 === 0 ? [0, 0, 0, 0] : varied(i))));
        mapWrap();
        const methods = await load(vi.fn(async () => document.createElement('canvas')));

        expect(await state(methods, makeMap())._captureCanvas()).toBeNull();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/refusée.*pas encore chargée/i), { kind: 'error' });
    });

    it('le refus s’affiche DANS la fenêtre de capture : un toast y serait caché par les fenêtres modales', async () => {
        useCtx(sample(4096, () => [0, 0, 0, 0]));
        mapWrap();
        document.body.insertAdjacentHTML('beforeend', '<dialog id="oi_carto_capture_modal" open><div class="modal-content"></div></dialog>');
        const methods = await load(vi.fn(async () => document.createElement('canvas')));

        await state(methods, makeMap())._captureCanvas();

        const status = document.querySelector('#oi_carto_capture_modal .oi-carto-capture-status');
        expect(status?.textContent).toMatch(/Capture refusée/);
        expect(status?.getAttribute('role')).toBe('alert');
    });

    it('réouvrir la fenêtre efface l’état de la capture précédente', async () => {
        document.body.insertAdjacentHTML('beforeend', '<dialog id="oi_carto_capture_modal"><div class="modal-content"><p class="oi-carto-capture-status">Capture refusée : …</p></div></dialog>');
        const methods = await load(vi.fn());
        const s = state(methods, makeMap());
        s._getPhotoTargets = () => [];

        s._openCaptureModal();

        expect(document.querySelector<HTMLElement>('.oi-carto-capture-status')?.hidden).toBe(true);
    });

    it('délai de chargement dépassé : capture faite, mais l’utilisateur est prévenu', async () => {
        vi.useFakeTimers();
        useCtx(sample(4096, varied));
        mapWrap();
        const map = makeMap({ idle: false });
        const methods = await load(vi.fn(async () => document.createElement('canvas')));

        const pending = state(methods, map)._captureCanvas();
        await vi.advanceTimersByTimeAsync(10_000);
        const out = await pending;

        expect(out).toBeInstanceOf(HTMLCanvasElement);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/pas fini de charger/i), { kind: 'info' });
        expect(out?.dataset.chargementIncomplet).toBe('1');
    });
});

describe('_exportToField — capture faite avant la fin du chargement', () => {
    it('la photo est ajoutée mais la fenêtre reste ouverte, avertissement lisible', async () => {
        class FakeDataTransfer {
            private readonly list: File[] = [];
            items = { add: (f: File): void => { this.list.push(f); } };
            get files(): File[] { return this.list; }
        }
        vi.stubGlobal('DataTransfer', FakeDataTransfer);
        const filesDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
        Object.defineProperty(HTMLInputElement.prototype, 'files', { configurable: true, get: () => null, set: () => {} });
        try {
            const methods = await load(vi.fn());
            const s = state(methods, makeMap());
            const canvas = document.createElement('canvas');
            canvas.dataset.chargementIncomplet = '1';
            s._captureCanvas = vi.fn(async () => canvas);
            const close = vi.fn();
            s._closeCaptureModal = close;
            vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) { cb(new Blob(['x'], { type: 'image/jpeg' })); });
            const handle = vi.fn(async () => {});
            (window as unknown as Record<string, unknown>).handleFileChange = handle;

            await s._exportToField('photo_container_express_carte_preview_container');

            expect(handle).toHaveBeenCalledTimes(1);
            expect(close).not.toHaveBeenCalled();
        } finally {
            if (filesDesc) Object.defineProperty(HTMLInputElement.prototype, 'files', filesDesc);
            delete (window as unknown as Record<string, unknown>).handleFileChange;
        }
    });
});

describe('_exportToField — champ photo plein (« Baptême terrain » : 2 photos)', () => {
    it('refus affiché dans la fenêtre de capture, sans capturer ni fermer', async () => {
        document.body.insertAdjacentHTML('beforeend', `<dialog id="oi_carto_capture_modal" open><div class="modal-content"></div></dialog>
            <div id="bapt" data-max-photos="2"><img class="image-preview"><img class="image-preview"></div>`);
        const methods = await load(vi.fn());
        const s = state(methods, makeMap());
        const capture = vi.fn(async () => document.createElement('canvas'));
        s._captureCanvas = capture;
        const close = vi.fn();
        s._closeCaptureModal = close;
        const handle = vi.fn(async () => 1);
        (window as unknown as Record<string, unknown>).handleFileChange = handle;
        try {
            await s._exportToField('bapt');

            expect(capture).not.toHaveBeenCalled();
            expect(handle).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
            const status = document.querySelector('#oi_carto_capture_modal .oi-carto-capture-status');
            expect(status?.textContent).toMatch(/2 photos au plus/);
            expect(status?.getAttribute('role')).toBe('alert');
        } finally {
            delete (window as unknown as Record<string, unknown>).handleFileChange;
        }
    });
});
