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
// normalizePhotos (SPEC-PDF-V3.md §3.5)
// ===========================================================================
describe('normalizePhotos', () => {
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
});
