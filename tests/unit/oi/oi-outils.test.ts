/**
 * oi-outils.test.ts — Comportement OBSERVÉ de `modules/outils.js`
 * (GStart-main, 430 LOC, lecture seule) pour le paquet `oi-outils` :
 * `src/apps/oi/outils.ts`. Références `outils.js:<ligne>` en commentaire,
 * cf. SPEC-OI-CONVERSION.md §11.7, PAQUETS-OI.json (`oi-outils`).
 *
 * Environnement (règle commune §13.5) :
 *  - `canvas.getContext('2d')` renvoie `null` par défaut sous jsdom (aucun
 *    paquet `canvas`) : mocké explicitement via
 *    `vi.spyOn(HTMLCanvasElement.prototype, 'getContext')` quand un contexte
 *    est nécessaire — sinon exploité TEL QUEL pour exercer la garde
 *    `if (!ctx)` de `compressImage`/`reencodeImageViaCanvasForPdf` (précédent
 *    `carto/panels-capture.test.ts`).
 *  - `new Image()` ne charge jamais réellement sous jsdom (pas de réseau) :
 *    `FakeImage` (stub global) déclenche `onload`/`onerror` en microtask,
 *    piloté par `fakeImageState`.
 *  - `HTMLCanvasElement.prototype.toBlob` mocké synchrone (précédent
 *    `carto/panels-capture.test.ts`).
 *
 * ÉCART DE CONTRAT (voir l'en-tête de `outils.ts`) : les fixtures
 * `location`/`box` sont construites via des interfaces locales élargissant
 * `OiShapeAnnotation` (x/y/radius, x/y/width/height) — même écart signalé au
 * gate, `contracts.ts` n'est pas modifié.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Store } from '@oi/init.js';
import {
    cleanupObjectUrls,
    compressImage,
    embedPdfImageFromBytes,
    getAnnotationAtPosition,
    getDragAfterElement,
    getEventPos,
    getRotatedPoint,
    handleThemeToggle,
    hexToRgb,
    isFullscreen,
    isJpegArrayBuffer,
    isPngArrayBuffer,
    reencodeImageViaCanvasForPdf,
    toggleDock,
    toggleFullscreen,
    updateFullscreenIcon,
} from '@oi/outils.js';
import { oiState } from '@oi/state.js';
import type { OiPointAnnotation, OiShapeAnnotation } from '@shared/types/contracts.js';
import type { PDFDocument } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Fixtures d'annotation — même écart de contrat que outils.ts (cf. son
// en-tête) : OiShapeAnnotation ne déclare pas x/y/radius/width/height pour
// 'location'/'box'. Interfaces locales au test, contracts.ts inchangé.
// ---------------------------------------------------------------------------
interface LocationFixture extends OiShapeAnnotation {
    x: number;
    y: number;
    radius: number;
}
interface BoxFixture extends OiShapeAnnotation {
    x: number;
    y: number;
    width: number;
    height: number;
}

// ---------------------------------------------------------------------------
// FakeImage — stub global de `Image` (jsdom ne charge jamais réellement une
// source). `fakeImageState` pilote dimensions et succès/échec.
// ---------------------------------------------------------------------------
const fakeImageState = { naturalWidth: 100, naturalHeight: 50, shouldError: false };

class FakeImage {
    onload: (() => void) | null = null;
    // outils.js:350-353 lit un event-like sur onerror (cf. outils.ts) : un
    // vrai `Event` (comme le ferait un <img> réel) plutôt que rien, pour ne
    // pas planter la lecture défensive `(event as unknown as {message?}).message`.
    onerror: ((event: Event) => void) | null = null;
    naturalWidth = fakeImageState.naturalWidth;
    naturalHeight = fakeImageState.naturalHeight;
    width = fakeImageState.naturalWidth;
    height = fakeImageState.naturalHeight;
    complete = true;
    private _src = '';

    get src(): string {
        return this._src;
    }

    set src(value: string) {
        this._src = value;
        queueMicrotask(() => {
            if (fakeImageState.shouldError) {
                this.onerror?.(new Event('error'));
            } else {
                this.onload?.();
            }
        });
    }
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    Store.state.annotations = [];
    Store.state.objectUrlsCache = {};
    oiState.ctx = null;
    fakeImageState.naturalWidth = 100;
    fakeImageState.naturalHeight = 50;
    fakeImageState.shouldError = false;
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// hexToRgb (outils.js:8-15)
// ---------------------------------------------------------------------------
describe('hexToRgb', () => {
    it('convertit une couleur avec # (défaut currentAnnotationColor)', () => {
        expect(hexToRgb('#c0392b')).toEqual({ r: 192, g: 57, b: 43 });
    });

    it('convertit une couleur sans #', () => {
        expect(hexToRgb('ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('renvoie null pour une chaîne invalide', () => {
        expect(hexToRgb('not-a-color')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// cleanupObjectUrls (outils.js:17-25)
// ---------------------------------------------------------------------------
describe('cleanupObjectUrls', () => {
    it('révoque toutes les URLs non vides et vide le cache', () => {
        Store.state.objectUrlsCache = { a: 'blob:a', b: 'blob:b', c: '' };
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { /* no-op */ });

        cleanupObjectUrls();

        expect(revokeSpy).toHaveBeenCalledTimes(2);
        expect(revokeSpy).toHaveBeenCalledWith('blob:a');
        expect(revokeSpy).toHaveBeenCalledWith('blob:b');
        expect(Store.state.objectUrlsCache).toEqual({});
    });

    it('est posée sur window (OiToolsGlobals)', () => {
        expect(window.cleanupObjectUrls).toBe(cleanupObjectUrls);
    });
});

// ---------------------------------------------------------------------------
// getEventPos (outils.js:27-38)
// ---------------------------------------------------------------------------
describe('getEventPos', () => {
    function makeCanvas(): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 100;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 10, top: 5, width: 100, height: 50, right: 110, bottom: 55, x: 10, y: 5, toJSON: () => ({}),
        } as DOMRect);
        return canvas;
    }

    it('lit clientX/clientY sur un MouseEvent', () => {
        const canvas = makeCanvas();
        const evt = new MouseEvent('mousemove', { clientX: 60, clientY: 30 });

        expect(getEventPos(canvas, evt)).toEqual({ x: 100, y: 50 });
    });

    it('lit touches[0] sur un TouchEvent (priorité sur clientX/Y)', () => {
        const canvas = makeCanvas();
        const evt = { touches: [{ clientX: 110, clientY: 55 }], clientX: -1, clientY: -1 } as unknown as TouchEvent;

        expect(getEventPos(canvas, evt)).toEqual({ x: 200, y: 100 });
    });

    it('retombe sur clientX/Y si touches est vide', () => {
        const canvas = makeCanvas();
        const evt = { touches: [], clientX: 60, clientY: 30 } as unknown as TouchEvent;

        expect(getEventPos(canvas, evt)).toEqual({ x: 100, y: 50 });
    });
});

// ---------------------------------------------------------------------------
// getRotatedPoint (outils.js:40-49) — valeurs de référence
// ---------------------------------------------------------------------------
describe('getRotatedPoint', () => {
    it('angle nul : identité', () => {
        const p = getRotatedPoint(60, 50, 50, 50, 0);
        expect(p.x).toBeCloseTo(60);
        expect(p.y).toBeCloseTo(50);
    });

    it('rotation de 90° (Math.PI/2) autour du centre', () => {
        const p = getRotatedPoint(60, 50, 50, 50, Math.PI / 2);
        expect(p.x).toBeCloseTo(50);
        expect(p.y).toBeCloseTo(40);
    });

    it('rotation de 180° (Math.PI) autour du centre', () => {
        const p = getRotatedPoint(60, 50, 50, 50, Math.PI);
        expect(p.x).toBeCloseTo(40);
        expect(p.y).toBeCloseTo(50);
    });
});

// ---------------------------------------------------------------------------
// getAnnotationAtPosition (outils.js:51-119)
// ---------------------------------------------------------------------------
describe('getAnnotationAtPosition', () => {
    function makeFakeCtx(): CanvasRenderingContext2D {
        // outils.js:80,87 — seuls `.font` (settable) et `.measureText` sont lus.
        return {
            font: '',
            measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics,
        } as unknown as CanvasRenderingContext2D;
    }

    const location: LocationFixture = {
        id: 1, type: 'location', startX: 0, startY: 0, endX: 0, endY: 0,
        rotation: 0, color: '#ff0000', x: 100, y: 100, radius: 20,
    };
    const box: BoxFixture = {
        id: 2, type: 'box', startX: 0, startY: 0, endX: 0, endY: 0,
        rotation: 0, color: '#00ff00', x: 50, y: 50, width: 100, height: 40,
    };
    const arrow: OiShapeAnnotation = {
        id: 3, type: 'arrow', startX: 0, startY: 0, endX: 100, endY: 0,
        rotation: 0, color: '#0000ff', thickness: 5,
    };
    const text: OiPointAnnotation = {
        id: 4, type: 'text', x: 10, y: 50, text: 'AB', color: '#000000', rotation: 0, size: 30,
    };
    const member: OiPointAnnotation = {
        id: 5, type: 'member', x: 200, y: 200, text: 'XX', color: '#000000', rotation: 0, size: 20,
    };

    it("renvoie null s'il n'y a aucune annotation", () => {
        expect(getAnnotationAtPosition(0, 0)).toBeNull();
    });

    it("'location' : distance <= radius + tolerance/2 (15/2)", () => {
        Store.state.annotations = [location];
        expect(getAnnotationAtPosition(100, 100)).toEqual(location); // centre
        expect(getAnnotationAtPosition(130, 100)).toBeNull(); // distance 30 > 20+7.5
        expect(getAnnotationAtPosition(127, 100)).toEqual(location); // distance 27 <= 27.5
    });

    it("'box' : rectangle étendu de la tolérance (15px)", () => {
        Store.state.annotations = [box];
        expect(getAnnotationAtPosition(100, 70)).toEqual(box); // intérieur strict
        expect(getAnnotationAtPosition(160, 70)).toEqual(box); // 150+10 <= 150+15
        expect(getAnnotationAtPosition(500, 500)).toBeNull();
    });

    it("'arrow' : distance à la ligne <= thickness + tolerance (5+15)", () => {
        Store.state.annotations = [arrow];
        expect(getAnnotationAtPosition(50, 0)).toEqual(arrow); // sur la ligne
        expect(getAnnotationAtPosition(50, 19)).toEqual(arrow); // 19 <= 20
        expect(getAnnotationAtPosition(50, 100)).toBeNull();
    });

    it("'text' : bounding box mesurée via ctx.measureText, police posée", () => {
        oiState.ctx = makeFakeCtx();
        Store.state.annotations = [text];

        expect(getAnnotationAtPosition(20, 35)).toEqual(text); // x:[10,30] y:[20,50]
        expect(getAnnotationAtPosition(20, 100)).toBeNull();
    });

    it("'member' : bounding box centrée avec padding (mPadX/mPadY)", () => {
        oiState.ctx = makeFakeCtx();
        Store.state.annotations = [member];

        expect(getAnnotationAtPosition(200, 200)).toEqual(member); // centre
        expect(getAnnotationAtPosition(0, 0)).toBeNull();
    });

    it('sans ctx (null) : les types text/member ne matchent jamais (écart assumé, pas de throw)', () => {
        oiState.ctx = null;
        Store.state.annotations = [text];

        expect(() => getAnnotationAtPosition(20, 35)).not.toThrow();
        expect(getAnnotationAtPosition(20, 35)).toBeNull();
    });

    it('parcourt en ordre INVERSE : la dernière dessinée est testée en premier', () => {
        const overlapA: LocationFixture = { ...location, id: 10 };
        const overlapB: LocationFixture = { ...location, id: 11 };
        Store.state.annotations = [overlapA, overlapB]; // B dessinée après A

        expect(getAnnotationAtPosition(100, 100)).toEqual(overlapB);
    });
});

// ---------------------------------------------------------------------------
// getDragAfterElement (outils.js:121-134)
// ---------------------------------------------------------------------------
describe('getDragAfterElement', () => {
    function draggable(top: number, height: number, extraClass?: string): HTMLElement {
        const el = document.createElement('div');
        el.className = extraClass ? `draggable ${extraClass}` : 'draggable';
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
            top, height, left: 0, right: 0, bottom: top + height, width: 0, x: 0, y: top, toJSON: () => ({}),
        } as DOMRect);
        return el;
    }

    it("renvoie l'élément le plus proche au-dessus du curseur (offset<0 maximal)", () => {
        const container = document.createElement('div');
        const el1 = draggable(40, 20); // centre 50
        const el2 = draggable(140, 20); // centre 150
        const el3 = draggable(240, 20); // centre 250
        container.append(el1, el2, el3);

        // y=100 : el2 offset=-50, el3 offset=-150, el1 offset=+50 (exclu)
        expect(getDragAfterElement(container, 100)).toBe(el2);
    });

    it('exclut .dragging et .time-item même si plus proches', () => {
        const container = document.createElement('div');
        const closerButExcludedDragging = draggable(100, 20, 'dragging'); // centre 110, offset=-20
        const closerButExcludedTimeItem = draggable(105, 20, 'time-item'); // centre 115, offset=-25
        const el2 = draggable(140, 20); // centre 150, offset=-50
        container.append(closerButExcludedDragging, closerButExcludedTimeItem, el2);

        expect(getDragAfterElement(container, 100)).toBe(el2);
    });

    it('renvoie undefined si le conteneur est vide', () => {
        const container = document.createElement('div');
        expect(getDragAfterElement(container, 100)).toBeUndefined();
    });

    it('renvoie undefined si le curseur est en dessous de tous les éléments (aucun candidat)', () => {
        const container = document.createElement('div');
        container.append(draggable(140, 20), draggable(240, 20));
        // y=1000 : offset positif pour les deux (leur milieu est au-dessus du
        // curseur) ⇒ aucun candidat (offset<0 requis).
        expect(getDragAfterElement(container, 1000)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// compressImage (outils.js:136-188)
// ---------------------------------------------------------------------------
describe('compressImage', () => {
    it("rejette si le contexte 2D est indisponible (jsdom, non mocké)", async () => {
        await expect(compressImage(new Blob(['x'], { type: 'image/jpeg' }), 0.8)).rejects.toThrow(
            "Impossible d'obtenir le contexte 2D du canvas.",
        );
    });

    it('rejette si le chargement de l\'image échoue (onerror)', async () => {
        fakeImageState.shouldError = true;
        await expect(compressImage(new Blob(['x'], { type: 'image/jpeg' }), 0.8)).rejects.toThrow(
            "Échec du chargement du Blob de l'image dans l'élément Image.",
        );
    });

    it('compresse en JPEG (source non-PNG) via toBlob mocké et résout un ArrayBuffer', async () => {
        const fakeCtx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
        const toBlobArgs: unknown[] = [];
        const jpegBlob = new Blob(['compressed'], { type: 'image/jpeg' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
            this: HTMLCanvasElement, cb: BlobCallback, type?: string, quality?: number,
        ) {
            toBlobArgs.push(type, quality);
            cb(jpegBlob);
        });

        const result = await compressImage(new Blob(['source'], { type: 'image/jpeg' }), 0.75);

        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(toBlobArgs).toEqual(['image/jpeg', 0.75]);
    });

    it('conserve le PNG (source PNG) via toBlob mocké', async () => {
        const fakeCtx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
        const toBlobArgs: unknown[] = [];
        const pngBlob = new Blob(['compressed'], { type: 'image/png' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
            this: HTMLCanvasElement, cb: BlobCallback, type?: string, quality?: number,
        ) {
            toBlobArgs.push(type, quality);
            cb(pngBlob);
        });

        const result = await compressImage(new Blob(['source'], { type: 'image/png' }), 0.9);

        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(toBlobArgs).toEqual(['image/png', 0.9]);
    });

    it('rejette si toBlob() résout un blob null', async () => {
        const fakeCtx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(null));

        await expect(compressImage(new Blob(['x'], { type: 'image/jpeg' }), 0.8)).rejects.toThrow(
            'La conversion du canevas en Blob a échoué.',
        );
    });

    it('redimensionne quand naturalWidth/Height dépasse maxDimension', async () => {
        fakeImageState.naturalWidth = 4000;
        fakeImageState.naturalHeight = 2000;
        const fakeCtx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
        let capturedWidth = 0;
        let capturedHeight = 0;
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
            capturedWidth = this.width;
            capturedHeight = this.height;
            cb(new Blob(['x'], { type: 'image/jpeg' }));
        });

        await compressImage(new Blob(['source'], { type: 'image/jpeg' }), 0.8, 1920);

        expect(capturedWidth).toBe(1920);
        expect(capturedHeight).toBe(960);
    });
});

// ---------------------------------------------------------------------------
// isPngArrayBuffer / isJpegArrayBuffer (outils.js:191-201)
// ---------------------------------------------------------------------------
describe('isPngArrayBuffer / isJpegArrayBuffer', () => {
    it('détecte une signature PNG valide', () => {
        const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer;
        expect(isPngArrayBuffer(buf)).toBe(true);
        expect(isJpegArrayBuffer(buf)).toBe(false);
    });

    it('détecte une signature JPEG valide', () => {
        const buf = new Uint8Array([0xff, 0xd8, 0xff, 0, 0]).buffer;
        expect(isJpegArrayBuffer(buf)).toBe(true);
        expect(isPngArrayBuffer(buf)).toBe(false);
    });

    it('renvoie false pour un buffer trop court', () => {
        expect(isPngArrayBuffer(new Uint8Array([0x89]).buffer)).toBe(false);
        expect(isJpegArrayBuffer(new Uint8Array([0xff]).buffer)).toBe(false);
    });

    it("renvoie false pour une valeur qui n'est pas un ArrayBuffer", () => {
        expect(isPngArrayBuffer('not-a-buffer')).toBe(false);
        expect(isPngArrayBuffer(null)).toBe(false);
        expect(isJpegArrayBuffer(undefined)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// embedPdfImageFromBytes (outils.js:207-232) — CODE MORT, porté par fidélité
// ---------------------------------------------------------------------------
describe('embedPdfImageFromBytes (code mort, jamais appelée dans la source)', () => {
    function fakePdfDoc(overrides: Partial<{ embedPng: PDFDocument['embedPng']; embedJpg: PDFDocument['embedJpg'] }> = {}): PDFDocument {
        return {
            embedPng: vi.fn().mockResolvedValue({ marker: 'png' }),
            embedJpg: vi.fn().mockResolvedValue({ marker: 'jpg' }),
            ...overrides,
        } as unknown as PDFDocument;
    }

    it('renvoie null si byteLength === 0', async () => {
        const doc = fakePdfDoc();
        expect(await embedPdfImageFromBytes(doc, new ArrayBuffer(0))).toBeNull();
    });

    it('renvoie null si byteLength === 20 (protection bug "[object ArrayBuffer]")', async () => {
        const doc = fakePdfDoc();
        expect(await embedPdfImageFromBytes(doc, new ArrayBuffer(20))).toBeNull();
    });

    it('résout via embedPng en premier (accepte aussi une Promise<ArrayBuffer>)', async () => {
        const doc = fakePdfDoc();
        const result = await embedPdfImageFromBytes(doc, Promise.resolve(new ArrayBuffer(30)));
        expect(result).toEqual({ marker: 'png' });
        expect(doc.embedJpg).not.toHaveBeenCalled();
    });

    it('retombe sur embedJpg si embedPng rejette', async () => {
        const doc = fakePdfDoc({ embedPng: vi.fn().mockRejectedValue(new Error('pas un PNG')) });
        const result = await embedPdfImageFromBytes(doc, new ArrayBuffer(30));
        expect(result).toEqual({ marker: 'jpg' });
    });
});

// ---------------------------------------------------------------------------
// reencodeImageViaCanvasForPdf (outils.js:237-360)
// ---------------------------------------------------------------------------
describe('reencodeImageViaCanvasForPdf', () => {
    it('rejette si les données sont trop petites (< 100 octets)', async () => {
        const doc = { embedJpg: vi.fn(), embedPng: vi.fn() } as unknown as PDFDocument;
        await expect(reencodeImageViaCanvasForPdf(doc, new ArrayBuffer(10))).rejects.toThrow(
            'Données image corrompues ou incomplètes (trop petites)',
        );
    });

    it('rejette si le bitmap décodé a des dimensions nulles', async () => {
        fakeImageState.naturalWidth = 0;
        fakeImageState.naturalHeight = 0;
        const doc = { embedJpg: vi.fn(), embedPng: vi.fn() } as unknown as PDFDocument;

        await expect(reencodeImageViaCanvasForPdf(doc, new ArrayBuffer(200))).rejects.toThrow(
            'Image sans dimensions naturelles - probablement corrompue',
        );
    });

    it('rejette avec le message de repli si le décodage échoue (onerror)', async () => {
        fakeImageState.shouldError = true;
        const doc = { embedJpg: vi.fn(), embedPng: vi.fn() } as unknown as PDFDocument;

        await expect(reencodeImageViaCanvasForPdf(doc, new ArrayBuffer(200))).rejects.toThrow(/Échec du décodage d'image/);
    });

    it('décode puis embarque en JPEG via pdfDoc.embedJpg', async () => {
        fakeImageState.naturalWidth = 40;
        fakeImageState.naturalHeight = 20;
        const fakeCtx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => {
            cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
        });
        const embedJpg = vi.fn().mockResolvedValue({ marker: 'reencoded-jpg' });
        const doc = { embedJpg, embedPng: vi.fn() } as unknown as PDFDocument;

        const result = await reencodeImageViaCanvasForPdf(doc, new ArrayBuffer(200));

        expect(result).toEqual({ marker: 'reencoded-jpg' });
        expect(embedJpg).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// isFullscreen / toggleFullscreen / updateFullscreenIcon (outils.js:364-403)
// ---------------------------------------------------------------------------
describe('isFullscreen / toggleFullscreen / updateFullscreenIcon', () => {
    afterEach(() => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    it('isFullscreen : lit document.fullscreenElement en priorité', () => {
        const el = document.createElement('div');
        Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
        expect(isFullscreen()).toBe(el);
    });

    it('isFullscreen : replie sur le vendor prefix webkit si fullscreenElement est absent', () => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        const el = document.createElement('div');
        (document as unknown as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement = el;

        expect(isFullscreen()).toBe(el);

        delete (document as unknown as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
    });

    it('toggleFullscreen : pas en plein écran ⇒ appelle requestFullscreen() du documentElement', () => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        const reqSpy = vi.fn(() => Promise.resolve());
        document.documentElement.requestFullscreen = reqSpy;

        toggleFullscreen();

        expect(reqSpy).toHaveBeenCalledTimes(1);
    });

    it('toggleFullscreen : déjà en plein écran ⇒ appelle document.exitFullscreen()', () => {
        const el = document.createElement('div');
        Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
        const exitSpy = vi.fn(() => Promise.resolve());
        document.exitFullscreen = exitSpy;

        toggleFullscreen();

        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    it('toggleFullscreen : replie sur mozRequestFullScreen si requestFullscreen absent', () => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        const original = document.documentElement.requestFullscreen;
        (document.documentElement as unknown as { requestFullscreen?: unknown }).requestFullscreen = undefined;
        const mozSpy = vi.fn();
        (document.documentElement as unknown as { mozRequestFullScreen?: () => void }).mozRequestFullScreen = mozSpy;

        toggleFullscreen();

        expect(mozSpy).toHaveBeenCalledTimes(1);

        document.documentElement.requestFullscreen = original;
        delete (document.documentElement as unknown as { mozRequestFullScreen?: () => void }).mozRequestFullScreen;
    });

    it('updateFullscreenIcon : actif ⇒ fullscreen_exit + titre', () => {
        document.body.innerHTML = '<span id="fullscreenIcon"></span>';
        const el = document.createElement('div');
        Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });

        updateFullscreenIcon();

        const icon = document.getElementById('fullscreenIcon');
        expect(icon?.textContent).toBe('fullscreen_exit');
        expect(icon?.title).toBe('Quitter le plein écran');
    });

    it('updateFullscreenIcon : inactif ⇒ fullscreen + titre', () => {
        document.body.innerHTML = '<span id="fullscreenIcon"></span>';
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });

        updateFullscreenIcon();

        const icon = document.getElementById('fullscreenIcon');
        expect(icon?.textContent).toBe('fullscreen');
        expect(icon?.title).toBe('Plein écran');
    });

    it('toggleFullscreen est posée sur window (OiToolsGlobals)', () => {
        expect(window.toggleFullscreen).toBe(toggleFullscreen);
    });
});

// ---------------------------------------------------------------------------
// handleThemeToggle (outils.js:405-414)
// ---------------------------------------------------------------------------
describe('handleThemeToggle', () => {
    afterEach(() => {
        document.body.className = '';
    });

    it('bascule light-mode/dark-mode et persiste "theme"', () => {
        document.body.innerHTML = '<span id="darkModeIcon"></span>';
        document.body.classList.add('light-mode');

        handleThemeToggle();

        expect(document.body.classList.contains('dark-mode')).toBe(true);
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(document.getElementById('darkModeIcon')?.textContent).toBe('nightlight');

        handleThemeToggle();

        expect(document.body.classList.contains('light-mode')).toBe(true);
        expect(localStorage.getItem('theme')).toBe('light');
        expect(document.getElementById('darkModeIcon')?.textContent).toBe('clear_day');
    });

    it('est posée sur window (OiToolsGlobals)', () => {
        expect(window.handleThemeToggle).toBe(handleThemeToggle);
    });
});

// ---------------------------------------------------------------------------
// toggleDock (outils.js:416-428)
// ---------------------------------------------------------------------------
describe('toggleDock', () => {
    it('no-op si #dockMenu est absent', () => {
        expect(() => toggleDock()).not.toThrow();
    });

    it('replie/déplie #dockMenu et persiste "dockCollapsed" (String(boolean))', () => {
        document.body.innerHTML = `
            <div id="dockMenu"></div>
            <button id="dockToggleBtn"><span class="material-symbols-outlined">expand_more</span></button>
        `;

        toggleDock();

        expect(document.getElementById('dockMenu')?.classList.contains('collapsed')).toBe(true);
        expect(localStorage.getItem('dockCollapsed')).toBe('true');
        expect(document.querySelector('#dockToggleBtn .material-symbols-outlined')?.textContent).toBe('expand_less');

        toggleDock();

        expect(document.getElementById('dockMenu')?.classList.contains('collapsed')).toBe(false);
        expect(localStorage.getItem('dockCollapsed')).toBe('false');
        expect(document.querySelector('#dockToggleBtn .material-symbols-outlined')?.textContent).toBe('expand_more');
    });

    it('est posée sur window (OiToolsGlobals)', () => {
        expect(window.toggleDock).toBe(toggleDock);
    });
});

// ---------------------------------------------------------------------------
// Contrat OiToolsGlobals — les 4 noms exposés sur window
// ---------------------------------------------------------------------------
describe('contrat OiToolsGlobals', () => {
    it('expose les 4 noms attendus sur window', () => {
        expect(typeof window.cleanupObjectUrls).toBe('function');
        expect(typeof window.toggleFullscreen).toBe('function');
        expect(typeof window.handleThemeToggle).toBe('function');
        expect(typeof window.toggleDock).toBe('function');
    });
});

