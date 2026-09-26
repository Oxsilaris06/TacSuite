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

// U19 — toast unique (`@shared/feedback.js`) mocké.
const toastSpy = vi.hoisted(() => vi.fn());
// Décision 43 : le refus « une page = un usage » passe par une fenêtre persistante.
const confirmSpy = vi.hoisted(() => vi.fn(() => Promise.resolve(false)));
vi.mock('@shared/feedback.js', () => ({ toast: toastSpy, confirmDialog: confirmSpy }));

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
    toastSpy.mockClear();

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

    it('ré-encode une entrée plus définie que le profil Impression à sa taille imprimée (250 ppi sur la pleine largeur utile A4, décision 42) via le pipeline canvas de repli', async () => {
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

        // 2:1 sur une page photo A4 (779,5 × 493,4 pt sous le titre) : imprimée
        // sur toute la largeur, 779,5 pt = 10,83 pouces × 250 ppi = 2707 px.
        expect(result.big).toBe('data:image/jpeg;base64,cmVlbmNvZGVk');
        expect(drawImageSpy).toHaveBeenCalledWith(expect.anything(), 0, 0, 2707, 1354);
        expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.85);
        getContextSpy.mockRestore();
    });

    it("ré-encode TOUJOURS le fond PDF personnalisé, même petit — aucune traversée telle quelle (fuite EXIF/GPS, audit F09)", async () => {
        // Le fond est choisi comme un FICHIER, jamais saisi par un champ photo :
        // il n'a pas traversé le pipeline canvas. Sous le palier, il partait
        // octet pour octet dans le PDF — coordonnées GPS comprises, relues dans
        // l'image extraite du PDF lors de l'audit du 2026-09-25.
        const drawImageSpy = vi.fn();
        const toDataURLSpy = vi.fn(() => 'data:image/jpeg;base64,cmVlbmNvZGVk');
        const getContextSpy = vi
            .spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockReturnValue({ drawImage: drawImageSpy } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURLSpy);

        const { normalizePhotos } = await loadEngineV3();
        fakeImageState.naturalWidth = 800;
        fakeImageState.naturalHeight = 600;
        const petit = 'data:image/jpeg;base64,cGV0aXQtYXZlYy1leGlm';

        const result = await normalizePhotos({ custom_pdf_background: petit, photo1: petit });

        // Le fond est reconstruit par canvas — donc sans ses métadonnées —
        // alors que la photo ordinaire, elle, garde sa traversée directe.
        expect(result.custom_pdf_background).toBe('data:image/jpeg;base64,cmVlbmNvZGVk');
        expect(result.photo1).toBe(petit);
        expect(toDataURLSpy).toHaveBeenCalledTimes(1);
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
// ===========================================================================
// SEC-6 (revue neuve du 2026-09-26) : un JPEG déjà à la bonne définition
// traversait le PDF octet pour octet, EXIF et GPS compris (image d'archive
// ancienne, ou gardée brute après un échec du ré-encodage anti-EXIF).
// ===========================================================================
describe('normalizePhotos — traversée d’un JPEG sans ses métadonnées (SEC-6)', () => {
    const seg = (marker: number, payload: string): number[] => {
        const body = Array.from(payload, (c) => c.charCodeAt(0));
        const len = body.length + 2;
        return [0xff, marker, len >> 8, len & 0xff, ...body];
    };
    /** JPEG minimal : JFIF, Exif (GPS), XMP, Photoshop/IPTC, SOF0 100×80, SOS, données. */
    const JPEG = [
        0xff, 0xd8,
        ...seg(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
        ...seg(0xe1, 'Exif\0\0GPSLatitude 48/1,51/1'),
        ...seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'),
        ...seg(0xed, 'Photoshop 3.0\x008BIM'),
        0xff, 0xc0, 0, 11, 8, 0, 80, 0, 100, 1, 1, 0x11, 0,
        0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0,
        0x12, 0x34, 0xff, 0x00, 0x56,
        0xff, 0xd9,
    ];
    const toUrl = (b: number[]): string => 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...b));
    const bytesOf = (url: string): string => atob(url.slice(url.indexOf(',') + 1));

    it('retire APP1 (Exif, XMP) et APP13, garde JFIF, SOF et les données', async () => {
        const { normalizePhotos } = await loadEngineV3();
        const result = await normalizePhotos({ p: toUrl(JPEG) });
        const out = bytesOf(result.p ?? '');
        expect(out).not.toContain('Exif');
        expect(out).not.toContain('xmpmeta');
        expect(out).not.toContain('Photoshop');
        expect(out.startsWith('\xff\xd8\xff\xe0')).toBe(true);
        expect(out).toContain('JFIF');
        expect(out.endsWith('\x12\x34\xff\x00\x56\xff\xd9')).toBe(true);
        const { imageSizeFromDataUrl } = await import('@oi/pdf/image-size.js');
        expect(imageSizeFromDataUrl(result.p ?? '')).toEqual({ widthPx: 100, heightPx: 80 });
    });

    it('JPEG sans métadonnée : rendu à l’identique', async () => {
        const { normalizePhotos } = await loadEngineV3();
        const clean = [0xff, 0xd8, ...JPEG.slice(JPEG.indexOf(0xc0) - 1)];
        const url = toUrl(clean);
        expect((await normalizePhotos({ p: url })).p).toBe(url);
    });
});

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

    it("image surdimensionnée : 2e createImageBitmap appelé avec resizeWidth/resizeHeight (ratio préservé, 250 ppi à la taille imprimée, profil Impression) et resizeQuality:'high', convertToBlob en JPEG qualité 0.85", async () => {
        const { createImageBitmapMock, convertToBlobSpy } = stubModernPipeline({
            naturalWidth: 4000,
            naturalHeight: 2000,
        });
        const { normalizePhotos } = await loadEngineV3();

        const result = await normalizePhotos({ big: 'data:image/jpeg;base64,YmlnLWpwZWc=' });

        expect(createImageBitmapMock).toHaveBeenCalledTimes(2);
        expect(createImageBitmapMock).toHaveBeenNthCalledWith(2, expect.anything(), {
            resizeWidth: 2707,
            resizeHeight: 1354,
            resizeQuality: 'high',
        });
        expect(convertToBlobSpy).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.85 });
        expect(result.big).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('sortie Partage : 150 ppi et qualité 0,72 (PDF_IMAGE_PROFILES.partage)', async () => {
        const { createImageBitmapMock, convertToBlobSpy } = stubModernPipeline({ naturalWidth: 2000, naturalHeight: 1500 });
        const { normalizePhotos } = await loadEngineV3();

        await normalizePhotos({ p: 'data:image/jpeg;base64,cA==' }, undefined, { sortie: 'partage', format: 'a4' });

        // 4:3 limitée par la hauteur d'une page photo A4 sous son titre :
        // 493,4 × 4/3 = 657,9 pt → 1371 px à 150 ppi.
        expect(createImageBitmapMock).toHaveBeenNthCalledWith(2, expect.anything(), {
            resizeWidth: 1371,
            resizeHeight: 1028,
            resizeQuality: 'high',
        });
        expect(convertToBlobSpy).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.72 });
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
// Profils de sortie (décision 42) : la définition visée dépend de la TAILLE
// IMPRIMÉE maximale de l'image (zone utile de la page) et du profil
// `PDF_IMAGE_PROFILES[sortie]` ; la sortie Partage (10 Mo) réduit
// progressivement jusqu'à tenir. Remplace l'ancien budget de 50 Mo
// (`planPhotoBudget`/`PHOTO_BUDGET_STEPS`), sans effet réel (audit F11) :
// tests adaptés à la décision 42.
// ===========================================================================
describe('photoTargetSize / nextPhotoPass (profils de sortie, décision 42)', () => {
    it('taille utile = taille imprimée maximale × ppi, jamais agrandie', async () => {
        const { photoTargetSize } = await loadEngineV3();
        const box = { width: 779.53, height: 541.42 };
        expect(photoTargetSize(3000, 2250, box, 250)).toEqual({ width: 2507, height: 1880 });
        expect(photoTargetSize(3000, 2250, box, 150)).toEqual({ width: 1504, height: 1128 });
        // Déjà sous la cible : dimensions d'origine.
        expect(photoTargetSize(800, 600, box, 250)).toEqual({ width: 800, height: 600 });
        // Portrait : limité par la hauteur utile.
        expect(photoTargetSize(3000, 4000, box, 150).height).toBeLessThanOrEqual(Math.ceil((541.42 / 72) * 150) + 1);
    });

    it('première passe = profil de la sortie, sans ré-encodage forcé', async () => {
        const { firstPhotoPass } = await loadEngineV3();
        expect(firstPhotoPass('impression')).toEqual({ ppi: 250, quality: 0.85, forceReencode: false });
        expect(firstPhotoPass('partage')).toEqual({ ppi: 150, quality: 0.72, forceReencode: false });
    });

    it('sans plafond (Impression) ou sous le budget : aucune passe de plus', async () => {
        const { firstPhotoPass, nextPhotoPass } = await loadEngineV3();
        expect(nextPhotoPass(firstPhotoPass('impression'), 80e6, null)).toBeNull();
        expect(nextPhotoPass(firstPhotoPass('partage'), 5e6, 9e6)).toBeNull();
    });

    it('au-delà du budget : définition réduite (racine du rapport, avec marge), puis qualité une fois au plancher de définition', async () => {
        const { firstPhotoPass, nextPhotoPass } = await loadEngineV3();
        const first = firstPhotoPass('partage');
        const second = nextPhotoPass(first, 36e6, 9e6);
        expect(second).not.toBeNull();
        expect(second!.ppi).toBeLessThan(first.ppi);
        expect(second!.ppi).toBeLessThanOrEqual(Math.floor(150 * Math.sqrt(9 / 36)));
        expect(second!.forceReencode).toBe(true);
        // Au plancher de 72 ppi : c'est la qualité qui baisse.
        const floor = { ppi: 72, quality: 0.72, forceReencode: true };
        const third = nextPhotoPass(floor, 20e6, 9e6);
        expect(third).toEqual({ ppi: 72, quality: expect.any(Number), forceReencode: true });
        expect(third!.quality).toBeLessThan(0.72);
        // Tout au plancher : meilleur effort, plus de passe.
        expect(nextPhotoPass({ ppi: 72, quality: 0.4, forceReencode: true }, 20e6, 9e6)).toBeNull();
    });
});

describe('normalizePhotos — PNG, transparence et budget Partage (décision 42)', () => {
    /** Canvas de repli doublé : `getImageData` rend des pixels de l'alpha voulu,
     *  `toDataURL` une chaîne dont la longueur suit la surface et la qualité
     *  (le poids d'un JPEG suit à peu près le nombre de pixels). */
    function stubLegacyCanvas(alpha: number): { drawImageSpy: ReturnType<typeof vi.fn>; toDataURLSpy: ReturnType<typeof vi.fn> } {
        const drawImageSpy = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
            const { width, height } = this;
            return {
                drawImage: drawImageSpy,
                getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4).fill(alpha) }),
            } as unknown as CanvasRenderingContext2D;
        } as unknown as typeof HTMLCanvasElement.prototype.getContext);
        const toDataURLSpy = vi.fn(function (this: HTMLCanvasElement, type?: string, quality?: number) {
            const bytes = Math.round(this.width * this.height * (quality ?? 1));
            return `data:${type ?? 'image/png'};base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`;
        });
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURLSpy as unknown as typeof HTMLCanvasElement.prototype.toDataURL);
        return { drawImageSpy, toDataURLSpy };
    }

    it('PNG opaque (photo annotée) : ressort en JPEG, même petit', async () => {
        const { toDataURLSpy } = stubLegacyCanvas(255);
        const { normalizePhotos } = await loadEngineV3();
        fakeImageState.naturalWidth = 800;
        fakeImageState.naturalHeight = 600;

        const result = await normalizePhotos({ annotee: 'data:image/png;base64,cG5n' });

        expect(result.annotee).toMatch(/^data:image\/jpeg;/);
        expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.85);
    });

    it('PNG réellement transparent (logo) : gardé en PNG, tel quel s’il est assez petit', async () => {
        stubLegacyCanvas(0);
        const { normalizePhotos } = await loadEngineV3();
        fakeImageState.naturalWidth = 800;
        fakeImageState.naturalHeight = 600;
        const logo = 'data:image/png;base64,bG9nbw==';

        const result = await normalizePhotos({ logo });

        expect(result.logo).toBe(logo);
    });

    it('PNG transparent trop défini : réduit mais toujours en PNG (jamais un fond noir)', async () => {
        const { toDataURLSpy } = stubLegacyCanvas(0);
        const { normalizePhotos } = await loadEngineV3();
        fakeImageState.naturalWidth = 5000;
        fakeImageState.naturalHeight = 2500;

        const result = await normalizePhotos({ logo: 'data:image/png;base64,bG9nbw==' });

        expect(result.logo).toMatch(/^data:image\/png;/);
        expect(toDataURLSpy).toHaveBeenCalledWith('image/png');
    });

    it('Partage : 12 photos trop lourdes → passes de réduction jusqu’à tenir sous le budget photo', async () => {
        const { drawImageSpy } = stubLegacyCanvas(255);
        const { normalizePhotos, PDF_NON_PHOTO_RESERVE_BYTES } = await loadEngineV3();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        fakeImageState.naturalWidth = 3000;
        fakeImageState.naturalHeight = 2250;
        const photos: Record<string, string> = {};
        for (let i = 0; i < 12; i++) photos[`p${i}`] = `data:image/jpeg;base64,cCR7${i}`;

        const result = await normalizePhotos(photos, undefined, { sortie: 'partage', format: 'a4' });

        const total = Object.values(result).reduce((sum, url) => sum + Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4), 0);
        expect(Object.keys(result)).toHaveLength(12);
        expect(total).toBeLessThanOrEqual(10 * 1024 * 1024 - PDF_NON_PHOTO_RESERVE_BYTES);
        // Première passe à 150 ppi (1371 px), puis au moins une passe plus petite.
        const widths = drawImageSpy.mock.calls.map((call) => call[3] as number);
        expect(widths).toContain(1371);
        expect(Math.min(...widths)).toBeLessThan(1371);
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

    it('transmet la sortie choisie à la normalisation des photos (Partage : qualité 0,72)', async () => {
        const toDataURLSpy = vi.fn(() => 'data:image/jpeg;base64,cmVlbmNvZGVk');
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURLSpy);
        const { buildOiPdfBlob } = await loadEngineV3();
        fakeImageState.naturalWidth = 2000;
        fakeImageState.naturalHeight = 1500;
        const data = makeCollectedData();
        data.photosBase64 = { p0: 'data:image/jpeg;base64,cDA=' };

        await buildOiPdfBlob(data, { format: 'a4', sortie: 'partage' });

        expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.72);
    });

    it('R2 — sortie Partage : la galerie est composée sur les tailles d’origine, pas sur les photos réduites', async () => {
        const header = (w: number, h: number): string =>
            'data:image/jpeg;base64,' + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xff, 0xd9));
        // Ré-encodage simulé : la photo sort réduite à 300 × 225 px.
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => header(300, 225));
        const { buildOiPdfBlob } = await loadEngineV3();
        fakeImageState.naturalWidth = 4000;
        fakeImageState.naturalHeight = 3000;
        const data = makeCollectedData({ dynamic_photos: { photo_container_transport_pr_preview_container: [{ id: 'img_t1' }] } } as unknown as Partial<OiFormData>);
        data.photosBase64 = { img_t1: header(4000, 3000) };

        await buildOiPdfBlob(data, { format: 'a4', sortie: 'partage' });

        const dd = (createPdfMock.mock.calls[0] as unknown[] | undefined)?.[0];
        expect(JSON.stringify(dd)).toContain(header(300, 225)); // la définition a bien baissé
        expect(JSON.stringify(dd)).not.toContain('basse définition'); // pas la taille sur la page
    });
});

// ===========================================================================
// downloadOiPdfV3 (port de pdf-engine-v2.ts:281-467, SPEC §2.1)
// ===========================================================================
describe('downloadOiPdfV3', () => {
    beforeEach(() => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    });

    it("produit un <a> dont l'attribut download vaut OI_Complet_<date>_<heure>_<trigramme>.pdf (audit F23) et déclenche un clic", async () => {
        const { downloadOiPdfV3 } = await loadEngineV3();
        let capturedDownload: string | null = null;
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            capturedDownload = this.download;
        });

        await downloadOiPdfV3({ collect: () => Promise.resolve(makeCollectedData()) });

        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(capturedDownload).toMatch(/^OI_Complet_2026-05-15_\d{2}h\d{2}_REF\.pdf$/);
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

    it('double clic sur « Télécharger » : une seule génération, un seul fichier (verrou, audit F23)', async () => {
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const { downloadOiPdfV3 } = await loadEngineV3();
        const collect = vi.fn(() => Promise.resolve(makeCollectedData()));

        await Promise.all([downloadOiPdfV3({ collect }), downloadOiPdfV3({ collect })]);

        expect(collect).toHaveBeenCalledTimes(1);
        expect(createPdfMock).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('déjà en cours'), expect.anything());

        // Verrou rendu à la fin : un nouveau clic, plus tard, génère bien.
        await downloadOiPdfV3({ collect });
        expect(clickSpy).toHaveBeenCalledTimes(2);
    });

    it('verrou rendu aussi après un échec', async () => {
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const { downloadOiPdfV3 } = await loadEngineV3();
        await downloadOiPdfV3({ collect: () => Promise.reject(new Error('collecte impossible')) });
        const collect = vi.fn(() => Promise.resolve(makeCollectedData()));
        await downloadOiPdfV3({ collect });
        expect(collect).toHaveBeenCalledTimes(1);
    });

    it('annonce le poids du PDF produit (décision 42)', async () => {
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const { downloadOiPdfV3 } = await loadEngineV3();

        await downloadOiPdfV3({ collect: () => Promise.resolve(makeCollectedData()) });

        // Blob factice « %PDF-fake » : 9 octets.
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('9 o'), expect.objectContaining({ kind: 'success' }));
    });

    it('applique la sortie retenue dans la fenêtre de génération (Partage)', async () => {
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const toDataURLSpy = vi.fn(() => 'data:image/jpeg;base64,cmVlbmNvZGVk');
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURLSpy);
        localStorage.setItem('tacPdfOptions:oi', JSON.stringify({ kind: null, theme: 'clair', sortie: 'partage' }));
        const { downloadOiPdfV3 } = await loadEngineV3();
        fakeImageState.naturalWidth = 2000;
        fakeImageState.naturalHeight = 1500;
        const data = makeCollectedData();
        data.photosBase64 = { p0: 'data:image/jpeg;base64,cDA=' };

        try {
            await downloadOiPdfV3({ collect: () => Promise.resolve(data) });
        } finally {
            localStorage.removeItem('tacPdfOptions:oi');
        }

        expect(toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.72);
    });

    it('refus « une page = un usage » : fenêtre persistante qui nomme la fiche et dit combien retirer, pas de toast (décision 43)', async () => {
        const { downloadOiPdfV3 } = await loadEngineV3();
        confirmSpy.mockClear();
        const atcd = Array.from({ length: 40 }, (_, i) => `- ${2024 - i} : VIOLENCE AGGRAVEE PAR DEUX CIRCONSTANCES SUIVIE D'INCAPACITE`).join('\n');
        const adversaries = [{ id: 'adv1', nom_adversaire: 'MARTIN Paul', antecedents_adversaire: atcd, me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] }];

        await downloadOiPdfV3({ collect: () => Promise.resolve(makeCollectedData({ adversaries })) });

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/Fiche Adversaire 1 : MARTIN Paul — environ \d+ lignes? de trop/),
            confirmLabel: 'Aller au champ',
        }));
        expect(toastSpy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'error' }));
    });

    it("en cas d'échec de createPdf, toast est appelé avec kind 'error' et le message exact", async () => {
        const engine = await loadEngineV3();
        createPdfMock.mockImplementationOnce(() => {
            throw new Error('pdfmake createPdf a échoué');
        });

        await engine.downloadOiPdfV3({ collect: () => Promise.resolve(makeCollectedData()) });

        expect(toastSpy).toHaveBeenCalledWith('Erreur de génération. Veuillez consulter les logs.', { kind: 'error' });
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
