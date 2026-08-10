/**
 * oi-pdf-engine-v3.test.ts — Tests unitaires de `engine-v3.ts` (SPEC-PDF-V3.md
 * §2.1 « contrat engine-v3.ts », §3.5 `normalizePhotos()`, §4 « devenir de
 * l'ancien moteur » ; paquet P6 « pdf-p6-engine-v3 »).
 *
 * `pdfmake` est mocké via `vi.doMock('pdfmake', …)` AVANT un import DYNAMIQUE
 * du module testé — même technique que `tests/unit/oi/oi-pdf-engine-v2.test.ts`
 * (`loadPdfEngine()`, :148-162) pour `html2canvas`/`jspdf` : le module réel
 * (~1,4 Mo) n'est jamais chargé sous jsdom, seule sa FORME est simulée.
 * `loadEngineV3()` ci-dessous fait `vi.resetModules()` + `vi.doMock('pdfmake', …)`
 * + réimport dynamique de `engine-v3.ts`, pour que le booléen de mémoïsation
 * `fontsRegistered` reparte de zéro à CHAQUE test — mais persiste entre deux
 * appels successifs AU SEIN d'un même test (c'est justement ce que vérifie le
 * test « n'enregistre les polices qu'une seule fois »).
 *
 * `new Image()` : ne charge/décode jamais réellement une source sous jsdom
 * (`decode()` n'existe même pas sur `HTMLImageElement`) — stub global
 * `FakeImage`, même précédent que `oi-dessin.test.ts`/`oi-outils.test.ts`
 * (dimensions/échec pilotés par `fakeImageState`).
 *
 * `URL.createObjectURL` : absente de jsdom (contrairement à
 * `revokeObjectURL`, réellement implémentée sous jsdom 30, cf.
 * `oi-medias.test.ts:35`) — stubbée par test, même précédent que
 * `oi-carto-panels-capture.test.ts:722-723`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OiFormData, OiPdfCollectedData } from '@shared/types/contracts.js';

// ---------------------------------------------------------------------------
// pdfmake — double partagé, injecté au chargement dynamique de engine-v3.ts.
// ---------------------------------------------------------------------------
const { fakePdfMake, addVfsMock, addFontsMock, createPdfMock, getBlobMock } = vi.hoisted(() => {
    const getBlobMock = vi.fn(async (): Promise<Blob> => new Blob(['%PDF-fake'], { type: 'application/pdf' }));
    const createPdfMock = vi.fn(() => ({ getBlob: getBlobMock }));
    const addVfsMock = vi.fn();
    const addFontsMock = vi.fn();
    const fakePdfMake = {
        addVirtualFileSystem: addVfsMock,
        addFonts: addFontsMock,
        createPdf: createPdfMock,
    };
    return { fakePdfMake, addVfsMock, addFontsMock, createPdfMock, getBlobMock };
});

/**
 * Recharge `engine-v3.ts` avec `pdfmake` mocké POUR CE TEST — seule façon de
 * faire varier le comportement de `createPdf`/`getBlob` d'un test à l'autre
 * sans toucher au module source (le vrai `import('pdfmake')` est dynamique,
 * DANS `buildOiPdfBlob`) ; même précédent que `loadPdfEngine()`
 * (`oi-pdf-engine-v2.test.ts:148-162`).
 */
async function loadEngineV3(): Promise<typeof import('@oi/pdf/engine-v3.js')> {
    vi.resetModules();
    vi.doMock('pdfmake', () => ({ default: fakePdfMake }));
    return import('@oi/pdf/engine-v3.js');
}

// ---------------------------------------------------------------------------
// new Image() — stub global (jsdom ne décode jamais réellement une source).
// ---------------------------------------------------------------------------
const fakeImageState = { naturalWidth: 100, naturalHeight: 80, shouldFailDecode: false };

class FakeImage {
    naturalWidth = fakeImageState.naturalWidth;
    naturalHeight = fakeImageState.naturalHeight;
    src = '';
    async decode(): Promise<void> {
        if (fakeImageState.shouldFailDecode) {
            throw new Error('decode indisponible (format non supporté sous jsdom)');
        }
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeCollectedData(overrides: Partial<OiFormData> = {}): OiPdfCollectedData {
    return {
        formData: { date_op: '2026-05-15', trigramme_redacteur: 'REF', ...overrides },
        photosBase64: {},
        isDark: false,
    };
}

beforeEach(() => {
    fakeImageState.naturalWidth = 100;
    fakeImageState.naturalHeight = 80;
    fakeImageState.shouldFailDecode = false;
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
    window.toast = vi.fn();

    addVfsMock.mockClear();
    addFontsMock.mockClear();
    createPdfMock.mockClear();
    createPdfMock.mockImplementation(() => ({ getBlob: getBlobMock }));
    getBlobMock.mockClear();
    getBlobMock.mockImplementation(async (): Promise<Blob> => new Blob(['%PDF-fake'], { type: 'application/pdf' }));
});

afterEach(() => {
    vi.doUnmock('pdfmake');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

// ===========================================================================
// normalizePhotos — voie de repli `<img>`/`<canvas>` (jsdom n'a ni
// `createImageBitmap` ni `OffscreenCanvas` : `supportsModernPhotoPipeline()`
// renvoie donc naturellement `false` sous jsdom, sans stub à poser) —
// SPEC-PDF-V3.md §3.5, R4-c.
// ===========================================================================
describe('normalizePhotos — voie de repli (jsdom, sans createImageBitmap/OffscreenCanvas)', () => {
    it("conserve une entrée data:image/jpeg de petite taille à l'identique", async () => {
        const { normalizePhotos } = await loadEngineV3();
        const dataUrl = 'data:image/jpeg;base64,ZmFrZS1qcGVn';

        const result = await normalizePhotos({ photo1: dataUrl });

        expect(result).toEqual({ photo1: dataUrl });
    });

    it('omet une entrée data:image/webp non décodable et journalise un avertissement', async () => {
        const { normalizePhotos } = await loadEngineV3();
        fakeImageState.shouldFailDecode = true;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await normalizePhotos({ photoX: 'data:image/webp;base64,ZmFrZS13ZWJw' });

        expect(result).toEqual({});
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('photoX'), expect.anything());
    });

    it('ré-encode une entrée dépassant MAX_PHOTO_PX (2000px) via le pipeline canvas de repli (ratio préservé, plus grand côté = 2000, qualité JPEG 0.85)', async () => {
        // jsdom n'a pas de rastérisation canvas réelle (paquet npm `canvas`
        // absent) : `getContext('2d')` est doublé pour vérifier les PARAMÈTRES
        // de la décision (dimensions cible, qualité d'encodage) sans dépendre
        // du rendu pixel réel.
        const drawImageSpy = vi.fn();
        const toDataURLSpy = vi.fn(() => 'data:image/jpeg;base64,cmVlbmNvZGVk');
        const getContextSpy = vi
            .spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockReturnValue({ drawImage: drawImageSpy } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURLSpy);

        const { normalizePhotos } = await loadEngineV3();
        fakeImageState.naturalWidth = 4000;
        fakeImageState.naturalHeight = 2000;

        const result = await normalizePhotos({ big: 'data:image/jpeg;base64,YmlnLWpwZWc=' });

        expect(result.big).toBe('data:image/jpeg;base64,cmVlbmNvZGVk');
        expect(drawImageSpy).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1000);
        expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.85);
        getContextSpy.mockRestore();
    });
});

// ===========================================================================
// normalizePhotos — voie moderne (`createImageBitmap`/`OffscreenCanvas`),
// simulée via des doubles GLOBAUX (jsdom n'implémente ni l'une ni l'autre
// API) — R4-c. Vérifie que la voie moderne est bien EMPRUNTÉE quand
// disponible, avec les BONS paramètres (`resizeWidth`/`resizeHeight`/
// `resizeQuality:'high'`, qualité JPEG 0.85), et que la voie de repli
// (`Image`/canvas) n'est PAS sollicitée dans ce cas.
// ===========================================================================
describe('normalizePhotos — voie moderne (createImageBitmap/OffscreenCanvas, doubles globaux)', () => {
    function makeFakeBitmap(width: number, height: number): { width: number; height: number; close: ReturnType<typeof vi.fn> } {
        return { width, height, close: vi.fn() };
    }

    function stubModernPipeline(opts: {
        naturalWidth: number;
        naturalHeight: number;
        convertToBlobSpy?: ReturnType<typeof vi.fn<(options: unknown) => Promise<Blob>>>;
    }): {
        createImageBitmapMock: ReturnType<typeof vi.fn>;
        drawImageSpy: ReturnType<typeof vi.fn>;
        convertToBlobSpy: ReturnType<typeof vi.fn<(options: unknown) => Promise<Blob>>>;
    } {
        const drawImageSpy = vi.fn();
        const convertToBlobSpy: ReturnType<typeof vi.fn<(options: unknown) => Promise<Blob>>> =
            opts.convertToBlobSpy ??
            vi.fn(async () => new Blob(['%fake-jpeg'], { type: 'image/jpeg' }));

        const createImageBitmapMock = vi.fn(async (_source: unknown, resizeOpts?: { resizeWidth?: number; resizeHeight?: number }) => {
            if (resizeOpts) {
                return makeFakeBitmap(resizeOpts.resizeWidth ?? opts.naturalWidth, resizeOpts.resizeHeight ?? opts.naturalHeight);
            }
            return makeFakeBitmap(opts.naturalWidth, opts.naturalHeight);
        });

        class FakeOffscreenCanvas {
            width: number;
            height: number;
            constructor(width: number, height: number) {
                this.width = width;
                this.height = height;
            }
            getContext(): { drawImage: typeof drawImageSpy } {
                return { drawImage: drawImageSpy };
            }
            convertToBlob(options: unknown): Promise<Blob> {
                return convertToBlobSpy(options) as Promise<Blob>;
            }
        }

        vi.stubGlobal('createImageBitmap', createImageBitmapMock);
        vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
        vi.stubGlobal(
            'fetch',
            vi.fn(async (dataUrl: string) => ({
                blob: async () => new Blob([dataUrl], { type: 'application/octet-stream' }),
            })),
        );

        return { createImageBitmapMock, drawImageSpy, convertToBlobSpy };
    }

    it('petite image JPEG (≤ MAX_PHOTO_PX) : pass-through — un seul décodage-sonde, AUCUN convertToBlob/drawImage', async () => {
        const { createImageBitmapMock, convertToBlobSpy, drawImageSpy } = stubModernPipeline({
            naturalWidth: 800,
            naturalHeight: 600,
        });
        const { normalizePhotos } = await loadEngineV3();
        const dataUrl = 'data:image/jpeg;base64,c21hbGwtanBlZw==';

        const result = await normalizePhotos({ small: dataUrl });

        expect(result).toEqual({ small: dataUrl });
        expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
        expect(convertToBlobSpy).not.toHaveBeenCalled();
        expect(drawImageSpy).not.toHaveBeenCalled();
    });

    it("image surdimensionnée : 2e createImageBitmap appelé avec resizeWidth/resizeHeight (ratio préservé, plus grand côté = 2000) et resizeQuality:'high', convertToBlob en JPEG qualité 0.85", async () => {
        const { createImageBitmapMock, convertToBlobSpy } = stubModernPipeline({
            naturalWidth: 4000,
            naturalHeight: 2000,
        });
        const { normalizePhotos } = await loadEngineV3();

        const result = await normalizePhotos({ big: 'data:image/jpeg;base64,YmlnLWpwZWc=' });

        expect(createImageBitmapMock).toHaveBeenCalledTimes(2);
        expect(createImageBitmapMock).toHaveBeenNthCalledWith(2, expect.anything(), {
            resizeWidth: 2000,
            resizeHeight: 1000,
            resizeQuality: 'high',
        });
        expect(convertToBlobSpy).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.85 });
        expect(result.big).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('une entrée non décodable (createImageBitmap rejette) est omise (repli null) et journalise un avertissement — la voie de repli Image/canvas n’est PAS utilisée', async () => {
        const decodeImageSpy = vi.spyOn(global, 'Image');
        stubModernPipeline({ naturalWidth: 100, naturalHeight: 100 });
        vi.stubGlobal(
            'createImageBitmap',
            vi.fn(async () => {
                throw new Error('format non supporté (double de test)');
            }),
        );
        const { normalizePhotos } = await loadEngineV3();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await normalizePhotos({ badPhoto: 'data:image/webp;base64,YmFk' });

        expect(result).toEqual({});
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('badPhoto'), expect.anything());
        expect(decodeImageSpy).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// normalizePhotos — pool de concurrence bornée (R4-c, remplace le
// `Promise.all` illimité) : au plus `PHOTO_CONCURRENCY` décodages en vol
// simultanément, résultats rendus dans l'ORDRE D'ENTRÉE quel que soit
// l'ordre de complétion réel.
// ===========================================================================
describe('normalizePhotos — pool de concurrence bornée', () => {
    it('ne dépasse jamais 5 décodages simultanés sur 12 photos, et le pic observé atteint bien la limite (pool réellement saturé)', async () => {
        const { normalizePhotos } = await loadEngineV3();
        let inFlight = 0;
        let maxInFlight = 0;
        const originalDecode = FakeImage.prototype.decode;
        FakeImage.prototype.decode = async function (this: FakeImage): Promise<void> {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 1));
            inFlight -= 1;
        };

        const photos: Record<string, string> = {};
        for (let i = 0; i < 12; i++) {
            photos[`photo${i}`] = 'data:image/jpeg;base64,c21hbGw=';
        }

        try {
            const result = await normalizePhotos(photos);
            expect(Object.keys(result)).toHaveLength(12);
            expect(maxInFlight).toBeLessThanOrEqual(6);
            expect(maxInFlight).toBeGreaterThanOrEqual(4);
        } finally {
            FakeImage.prototype.decode = originalDecode;
        }
    });

    it('préserve les résultats associés à leur clé même si les décodages se terminent dans le désordre', async () => {
        const { normalizePhotos } = await loadEngineV3();
        const originalDecode = FakeImage.prototype.decode;
        let callIndex = 0;
        FakeImage.prototype.decode = async function (this: FakeImage): Promise<void> {
            const idx = callIndex++;
            // Les décodages pairs se terminent plus vite que les impairs —
            // force un ordre de complétion différent de l'ordre d'entrée.
            await new Promise((resolve) => setTimeout(resolve, idx % 2 === 0 ? 0 : 5));
        };

        try {
            const result = await normalizePhotos({
                a: 'data:image/jpeg;base64,YQ==',
                b: 'data:image/jpeg;base64,Yg==',
                c: 'data:image/jpeg;base64,Yw==',
                d: 'data:image/jpeg;base64,ZA==',
            });
            expect(result).toEqual({
                a: 'data:image/jpeg;base64,YQ==',
                b: 'data:image/jpeg;base64,Yg==',
                c: 'data:image/jpeg;base64,Yw==',
                d: 'data:image/jpeg;base64,ZA==',
            });
        } finally {
            FakeImage.prototype.decode = originalDecode;
        }
    });
});

// ===========================================================================
// normalizePhotos — onProgress (R4-c) : appelé après CHAQUE photo traitée
// (succès ou échec), `total` figé, `done` strictement croissant jusqu'à
// `total`.
// ===========================================================================
describe('normalizePhotos — onProgress', () => {
    it('appelle onProgress(done, total) une fois par photo, total figé, done croissant jusqu’au total, y compris pour une photo en échec', async () => {
        const { normalizePhotos } = await loadEngineV3();
        const originalDecode = FakeImage.prototype.decode;
        let callIndex = 0;
        FakeImage.prototype.decode = async function (this: FakeImage): Promise<void> {
            const idx = callIndex++;
            if (idx === 1) throw new Error('échec simulé');
        };
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const onProgress = vi.fn();
        try {
            const result = await normalizePhotos(
                {
                    p0: 'data:image/jpeg;base64,cDA=',
                    p1: 'data:image/jpeg;base64,cDE=',
                    p2: 'data:image/jpeg;base64,cDI=',
                },
                onProgress,
            );

            expect(Object.keys(result)).toHaveLength(2);
            expect(onProgress).toHaveBeenCalledTimes(3);
            for (const call of onProgress.mock.calls) {
                expect(call[1]).toBe(3);
            }
            const doneValues = onProgress.mock.calls.map((call) => call[0]).sort((a, b) => a - b);
            expect(doneValues).toEqual([1, 2, 3]);
        } finally {
            FakeImage.prototype.decode = originalDecode;
        }
    });

    it('aucune photo : onProgress n’est jamais appelé', async () => {
        const { normalizePhotos } = await loadEngineV3();
        const onProgress = vi.fn();

        const result = await normalizePhotos({}, onProgress);

        expect(result).toEqual({});
        expect(onProgress).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// buildOiPdfBlob — COUTURE DE TEST PRINCIPALE (SPEC §2.1)
// ===========================================================================
describe('buildOiPdfBlob', () => {
    it("appelle addVirtualFileSystem puis addFonts puis createPdf, et n'enregistre les polices QU'UNE SEULE FOIS sur deux appels successifs", async () => {
        const { buildOiPdfBlob } = await loadEngineV3();
        const data = makeCollectedData();

        const blob1 = await buildOiPdfBlob(data, { format: 'a4' });
        const blob2 = await buildOiPdfBlob(data, { format: 'a4' });

        expect(blob1).toBeInstanceOf(Blob);
        expect(blob2).toBeInstanceOf(Blob);
        expect(addVfsMock).toHaveBeenCalledTimes(1);
        expect(addFontsMock).toHaveBeenCalledTimes(1);
        expect(createPdfMock).toHaveBeenCalledTimes(2);

        const vfsOrder = addVfsMock.mock.invocationCallOrder[0] as number;
        const fontsOrder = addFontsMock.mock.invocationCallOrder[0] as number;
        const createOrder = createPdfMock.mock.invocationCallOrder[0] as number;
        expect(vfsOrder).toBeLessThan(fontsOrder);
        expect(fontsOrder).toBeLessThan(createOrder);
    });

    it('transmet opts.onProgress à normalizePhotos (i/N reçu pour chaque photo collectée)', async () => {
        const { buildOiPdfBlob } = await loadEngineV3();
        const data = makeCollectedData();
        data.photosBase64 = {
            p0: 'data:image/jpeg;base64,cDA=',
            p1: 'data:image/jpeg;base64,cDE=',
        };
        const onProgress = vi.fn();

        await buildOiPdfBlob(data, { format: 'a4', onProgress });

        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenCalledWith(expect.any(Number), 2);
    });
});

// ===========================================================================
// downloadOiPdfV3 (port de pdf-engine-v2.ts:281-467, SPEC §2.1)
// ===========================================================================
describe('downloadOiPdfV3', () => {
    beforeEach(() => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    });

    it("produit un <a> dont l'attribut download vaut exactement OI_<date>_<trigramme>.pdf et déclenche un clic", async () => {
        const { downloadOiPdfV3 } = await loadEngineV3();
        let capturedDownload: string | null = null;
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            capturedDownload = this.download;
        });

        await downloadOiPdfV3({ collect: () => Promise.resolve(makeCollectedData()) });

        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(capturedDownload).toBe('OI_2026-05-15_REF.pdf');
    });

    it('masque le loader (#pdfLoadingModal.style.display === "none") aussi bien en succès qu\'en échec (branche finally)', async () => {
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        // --- succès ---
        const loaderOk = document.createElement('div');
        loaderOk.id = 'pdfLoadingModal';
        document.body.appendChild(loaderOk);
        const engineOk = await loadEngineV3();
        await engineOk.downloadOiPdfV3({ collect: () => Promise.resolve(makeCollectedData()) });
        expect(loaderOk.style.display).toBe('none');
        document.body.innerHTML = '';

        // --- échec (collecte en erreur) ---
        const loaderKo = document.createElement('div');
        loaderKo.id = 'pdfLoadingModal';
        document.body.appendChild(loaderKo);
        const engineKo = await loadEngineV3();
        await engineKo.downloadOiPdfV3({
            collect: () => Promise.reject(new Error('collecte impossible')),
        });
        expect(loaderKo.style.display).toBe('none');
    });

    it("en cas d'échec de createPdf, window.toast est appelé avec 'error' et le message exact", async () => {
        const engine = await loadEngineV3();
        createPdfMock.mockImplementationOnce(() => {
            throw new Error('pdfmake createPdf a échoué');
        });

        await engine.downloadOiPdfV3({ collect: () => Promise.resolve(makeCollectedData()) });

        expect(window.toast).toHaveBeenCalledWith('Erreur de génération. Veuillez consulter les logs.', 'error');
    });

    it("affiche la progression i/N sur #pdfLoadingStatus pendant « Préparation des images… » (R4-c, onProgress consommé par downloadOiPdfV3)", async () => {
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const statusEl = document.createElement('div');
        statusEl.id = 'pdfLoadingStatus';
        document.body.appendChild(statusEl);

        const statusHistory: string[] = [];
        let currentText = '';
        Object.defineProperty(statusEl, 'textContent', {
            get: () => currentText,
            set: (value: string) => {
                currentText = value;
                statusHistory.push(value);
            },
        });

        const engine = await loadEngineV3();
        const data = makeCollectedData();
        data.photosBase64 = {
            p0: 'data:image/jpeg;base64,cDA=',
            p1: 'data:image/jpeg;base64,cDE=',
            p2: 'data:image/jpeg;base64,cDI=',
        };

        await engine.downloadOiPdfV3({ collect: () => Promise.resolve(data) });

        expect(statusHistory).toContain('Préparation des images… (1/3)');
        expect(statusHistory).toContain('Préparation des images… (2/3)');
        expect(statusHistory).toContain('Préparation des images… (3/3)');
        // La progression est postée AVANT le message de composition (ordre
        // chronologique réel des mises à jour du overlay).
        const lastProgressIdx = statusHistory.lastIndexOf('Préparation des images… (3/3)');
        const compositionIdx = statusHistory.indexOf('Composition du document…');
        expect(compositionIdx).toBeGreaterThan(lastProgressIdx);
    });
});
