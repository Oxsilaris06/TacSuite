/**
 * Photos perdues à l'entrée (point 11, audit PDF du 2026-09-25, F10) : une
 * photo HEIC (iPhone « Haute efficacité », Android Samsung) était acceptée,
 * comptée comme ajoutée, puis absente du PDF sans un mot. Désormais :
 *  - la HEIC est convertie à l'entrée par `heic-to`, chargé à la demande
 *    (même règle que PC-Tac, `pctac/utils.ts`), après un essai de décodage
 *    natif (Safari sait) ;
 *  - un fichier que le navigateur ne sait pas décoder est REFUSÉ avec un
 *    message clair, jamais stocké.
 *
 * Chaîne réelle `handleFileChange` → `compressImage` ; seuls le décodage
 * d'image (jsdom n'en fait pas), le canvas et le convertisseur sont simulés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@shared/feedback.js')>()),
    confirmDialog: vi.fn(async () => true),
    toast: toastSpy,
}));

const heicToMock = vi.hoisted(() => vi.fn(async (): Promise<Blob> => new Blob(['jpeg-converti'], { type: 'image/jpeg' })));
vi.mock('heic-to', () => ({ heicTo: heicToMock }));

import { dbManager, Store } from '@oi/init.js';
import { handleFileChange } from '@oi/medias.js';
import { compressImage } from '@oi/outils.js';

// ---------------------------------------------------------------------------
// Décodage simulé : chaque source reçue par une `Image` se décode ou non
// selon `decodable(blob)`, décidé par le test.
// ---------------------------------------------------------------------------
const urls = new Map<string, Blob>();
let decodable: (blob: Blob) => boolean = () => true;

class FakeImage {
    onload: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    naturalWidth = 100;
    naturalHeight = 50;
    set src(url: string) {
        const blob = urls.get(url);
        queueMicrotask(() => (blob && decodable(blob) ? this.onload?.() : this.onerror?.(new Event('error'))));
    }
}

const heic = (name = 'IMG_0001.HEIC'): File => new File(['ftypheic'], name, { type: 'image/heic' });
const isHeicBytes = async (b: Blob): Promise<boolean> => (await b.text()) === 'ftypheic';

beforeEach(() => {
    let n = 0;
    urls.clear();
    decodable = () => true;
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => { const u = `blob:t${n++}`; urls.set(u, b as Blob); return u; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
        cb(new Blob(['encode'], { type: type ?? 'image/png' }));
    });
    heicToMock.mockClear();
    heicToMock.mockImplementation(async () => new Blob(['jpeg-converti'], { type: 'image/jpeg' }));
    toastSpy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('compressImage — HEIC converties, images illisibles signalées', () => {
    it('HEIC que le navigateur ne décode pas : convertie par heic-to (chargé à la demande), puis compressée', async () => {
        const blobs: Blob[] = [];
        decodable = (b) => { blobs.push(b); return b.type === 'image/jpeg'; };

        const out = await compressImage(heic(), 0.95, 2560);

        expect(out).toBeInstanceOf(ArrayBuffer);
        expect(heicToMock).toHaveBeenCalledTimes(1);
        expect(heicToMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }));
        expect(blobs.map((b) => b.type)).toEqual(['image/heic', 'image/jpeg']);
    });

    it('HEIC décodée nativement (Safari) : aucun convertisseur chargé', async () => {
        await compressImage(heic(), 0.95, 2560);
        expect(heicToMock).not.toHaveBeenCalled();
    });

    it('HEIC dont la conversion échoue (hors ligne, fichier abîmé) : erreur de décodage explicite', async () => {
        decodable = () => false;
        heicToMock.mockRejectedValueOnce(new Error('chunk introuvable'));

        await expect(compressImage(heic(), 0.95, 2560)).rejects.toMatchObject({ name: 'ImageDecodeError', message: expect.stringMatching(/HEIC/) });
    });

    it('fichier non décodable et non HEIC : erreur de décodage, sans tenter de conversion', async () => {
        decodable = () => false;

        await expect(compressImage(new File(['???'], 'scan.tif', { type: 'image/tiff' }), 0.95, 2560)).rejects.toMatchObject({ name: 'ImageDecodeError' });
        expect(heicToMock).not.toHaveBeenCalled();
    });
});

describe('handleFileChange — refus clair des fichiers illisibles', () => {
    const stored = new Map<string, Blob>();

    beforeEach(() => {
        stored.clear();
        document.body.innerHTML = '<div id="adversary_photo_preview_container"></div><div id="adversary_photo_display"></div>';
        Store.state.formData = {};
        Store.state.objectUrlsCache = {};
        vi.spyOn(dbManager, 'putItem').mockImplementation(async (k: string, b: Blob) => { stored.set(k, b); });
        window.syncDomToStore = vi.fn();
    });

    function input(files: File[]): HTMLInputElement {
        const el = document.createElement('input');
        el.type = 'file';
        Object.defineProperty(el, 'files', { value: files, configurable: true });
        document.body.appendChild(el);
        return el;
    }

    it('une HEIC est ajoutée en JPEG (plus jamais l’original illisible)', async () => {
        decodable = (b) => b.type !== 'image/heic';

        await handleFileChange(input([heic()]), 'adversary_photo_preview_container', false);

        expect(stored.size).toBe(1);
        const [blob] = [...stored.values()];
        expect(blob?.type).toBe('image/jpeg');
        expect(await isHeicBytes(blob as Blob)).toBe(false);
        expect(toastSpy).toHaveBeenCalledWith('1 photo ajoutée', { kind: 'success' });
    });

    it('un fichier illisible est refusé, nommé dans le message, jamais stocké ; les autres passent', async () => {
        decodable = (b) => b.type === 'image/jpeg';

        await handleFileChange(input([new File(['???'], 'scan.tif', { type: 'image/tiff' }), new File(['ok'], 'photo.jpg', { type: 'image/jpeg' })]), 'adversary_photo_preview_container', false);

        expect(stored.size).toBe(1);
        expect(document.querySelectorAll('#adversary_photo_preview_container .image-preview-item')).toHaveLength(1);
        expect(toastSpy).toHaveBeenCalledWith('1 photo ajoutée', { kind: 'success' });
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/refusée.*scan\.tif/s), expect.objectContaining({ kind: 'error' }));
    });

    it('une HEIC non convertible (hors ligne) est refusée avec la raison', async () => {
        decodable = () => false;
        heicToMock.mockRejectedValue(new Error('hors ligne'));

        await handleFileChange(input([heic('IMG_0042.HEIC')]), 'adversary_photo_preview_container', false);

        expect(stored.size).toBe(0);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/IMG_0042\.HEIC.*HEIC/s), expect.objectContaining({ kind: 'error' }));
        expect(toastSpy).not.toHaveBeenCalledWith(expect.stringMatching(/ajoutée/), expect.anything());
    });
});
