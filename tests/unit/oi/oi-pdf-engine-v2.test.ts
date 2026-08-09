/**
 * oi-pdf-engine-v2.test.ts — Tests unitaires de `pdf-engine-v2.ts` (P3.CONV,
 * paquet `oi-pdf-engine-v2`, port de `modules/pdf_engine_v2.js`, GStart-main,
 * 1156 LOC intégral à l'origine, lecture seule). Cf. SPEC-OI-CONVERSION.md §7
 * (ARBITRAGE 3), PAQUETS-OI.json (`oi-pdf-engine-v2`).
 *
 * `Store`/`dbManager` RÉELS (pas de double), importés depuis `@oi/init.js` —
 * même précédent que `oi-medias.test.ts`/`oi-articulation.test.ts` :
 * `Store.state.formData` est réinitialisé avant chaque test ;
 * `dbManager.getItem` est MOCKÉ via `vi.spyOn` sur l'objet réel exporté
 * (aucune vraie IndexedDB ouverte, absente sous jsdom, règle commune §13.5).
 * Utilisé pour le describe `collectAllData`.
 *
 * `createAnnotatedImageBlob` (`@oi/dessin.js`, import NOMMÉ de fonction, pas
 * un objet/méthode — impossible à intercepter par `vi.spyOn`) MOCKÉ via
 * `vi.mock` + `vi.hoisted`, même précédent que `compressImage` dans
 * `oi-medias.test.ts`.
 *
 * `window.toast` : stub `vi.fn()`, même précédent que `oi-medias.test.ts`.
 *
 * PDF.INTEG (SPEC-PDF-V3.md §4) : `downloadOiPdf()` (html2canvas + jsPDF,
 * ancien `pdf_engine_v2.js:189-349`) a été RETIRÉE de `pdf-engine-v2.ts` — le
 * describe `downloadOiPdf` correspondant est RÉORIENTÉ vers
 * `tests/unit/oi/pdf/oi-pdf-engine-v3.test.ts` (describe `downloadOiPdfV3`,
 * moteur vectoriel pdfmake, `@oi/pdf/engine-v3.js`).
 *
 * R4-a (D2, « une seule voie d'output PDF ») : `generateHTML`/
 * `_fitPageToBudget`/`_buildPresentationDocument` (gabarit HTML dupliqué de
 * l'aperçu/présentation, ~740 LOC) sont RETIRÉES de `pdf-engine-v2.ts` — les
 * describe correspondants disparaissent avec elles. `openPreview()`/
 * `openPresentInPlace()` construisent désormais le MÊME blob PDF que le
 * téléchargement ; testés ICI via la couture `deps.buildBlob`/`deps.collect`
 * (même précédent que `downloadOiPdfV3({ collect })`,
 * `oi-pdf-engine-v3.test.ts`) — AUCUN mock de `pdfmake`/import dynamique
 * requis, `buildBlob` est directement injecté.
 *
 * Tests obligatoires (PAQUETS-OI.json id="oi-pdf-engine-v2") :
 *  (a) collectAllData avec un Store mocké contenant une photo (avec et sans
 *      annotations) et un `custom_pdf_background` → `photosBase64` peuplé aux
 *      bonnes clés, ET la copie de `formData` est bien PROFONDE (muter la
 *      copie ne touche pas le Store).
 *  (b) openPreview : injecte le blob dans un `<iframe class="pdf-preview-frame">`
 *      de `#presentation-content` (Blob URL), révoque l'URL précédente à
 *      chaque nouvel appel ET à la fermeture de `#presentationModal`
 *      (événement natif `close`), REPLIE sur un message clair (SANS tenter
 *      l'iframe) quand `navigator.pdfViewerEnabled === false` — un navigateur
 *      qui ne sait pas rendre un PDF embarqué déclenche en coulisses une
 *      tentative de téléchargement fantôme pour la navigation de l'iframe
 *      (constaté empiriquement, cf. tests/e2e/oi.spec.ts qui force le canal
 *      Chromium complet — PAS le « headless shell » par défaut, dépourvu de
 *      visualiseur PDF — pour éviter que ce fantôme ne percute un
 *      téléchargement légitime survenant peu après), affiche/masque le
 *      loader `#pdfLoadingModal`, affiche un message d'erreur en cas d'échec.
 *  (c) openPresentInPlace : ouvre le blob dans un nouvel onglet
 *      (`window.open`), révoque l'URL après le délai différé en cas
 *      d'ouverture réussie, révoque IMMÉDIATEMENT et alerte si la popup est
 *      bloquée, notifie via `window.toast` en cas d'échec de collecte/build.
 *  (d)/(e) anciennement downloadOiPdf() (nom de fichier + repli SANS_DATE/RED
 *      + branches « librairie absente ») : voir désormais le describe
 *      `downloadOiPdfV3` de `tests/unit/oi/pdf/oi-pdf-engine-v3.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dbManager, Store } from '@oi/init.js';
import { PDFEngineV2 } from '@oi/pdf-engine-v2.js';
import type { OiPdfCollectedData } from '@shared/types/contracts.js';

// ---------------------------------------------------------------------------
// createAnnotatedImageBlob (@oi/dessin.js) — import NOMMÉ de fonction, mocké
// via vi.mock + vi.hoisted (même précédent que compressImage, oi-medias.test.ts).
// ---------------------------------------------------------------------------
const { createAnnotatedImageBlobMock } = vi.hoisted(() => ({
    createAnnotatedImageBlobMock: vi.fn(async (blob: Blob): Promise<Blob> => blob),
}));

vi.mock('@oi/dessin.js', () => ({
    createAnnotatedImageBlob: createAnnotatedImageBlobMock,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCollectedData(): OiPdfCollectedData {
    return {
        formData: { date_op: '2026-05-15', trigramme_redacteur: 'REF' },
        photosBase64: {},
        isDark: false,
    };
}

/** Construit `#presentationModal` (dialog) + `#presentation-content`, comme `oi/index.html`. */
function buildPresentationDom(): { modal: HTMLDialogElement; content: HTMLDivElement } {
    const modal = document.createElement('dialog');
    modal.id = 'presentationModal';
    document.body.appendChild(modal);
    const content = document.createElement('div');
    content.id = 'presentation-content';
    modal.appendChild(content);
    return { modal, content };
}

function buildLoaderDom(): { loader: HTMLDivElement; statusText: HTMLDivElement } {
    const loader = document.createElement('div');
    loader.id = 'pdfLoadingModal';
    const statusText = document.createElement('div');
    statusText.id = 'pdfLoadingStatus';
    loader.appendChild(statusText);
    document.body.appendChild(loader);
    return { loader, statusText };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
    window.toast = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

// ===========================================================================
// collectAllData (pdf_engine_v2.js:351-401)
// ===========================================================================
describe('collectAllData', () => {
    it('peuple photosBase64 aux bonnes clés (photo simple, photo annotée, fond personnalisé) et copie formData EN PROFONDEUR', async () => {
        const blobPhoto1 = new Blob(['annotated-source-bytes'], { type: 'image/jpeg' });
        const blobPhoto2 = new Blob(['photo2-bytes'], { type: 'image/jpeg' });
        const blobBg = new Blob(['bg-bytes'], { type: 'image/png' });
        const blobAnnotated = new Blob(['annotated-bytes'], { type: 'image/jpeg' });

        createAnnotatedImageBlobMock.mockReset();
        createAnnotatedImageBlobMock.mockResolvedValue(blobAnnotated);

        vi.spyOn(dbManager, 'getItem').mockImplementation(async (key: string): Promise<Blob | undefined> => {
            if (key === 'photo1') return blobPhoto1;
            if (key === 'photo2') return blobPhoto2;
            if (key === 'custom_pdf_background') return blobBg;
            return undefined;
        });

        Store.state.formData = {
            pdf_theme: 'light',
            dynamic_photos: {
                photo_extra_adv1: [
                    {
                        id: 'photo1',
                        annotations: JSON.stringify([{ id: 1, type: 'text', x: 0, y: 0, text: 'hi', color: '#fff', rotation: 0, size: 10 }]),
                        tools: '[]',
                        other_tools: '',
                        customTitle: '',
                    },
                    { id: 'photo2', annotations: '[]', tools: '[]', other_tools: '', customTitle: '' },
                ],
            },
        };

        const result = await PDFEngineV2.collectAllData();

        // photo1 a des annotations → fusion via createAnnotatedImageBlob → le
        // base64 reflète le blob FUSIONNÉ ('annotated-bytes'), pas l'original.
        expect(createAnnotatedImageBlobMock).toHaveBeenCalledTimes(1);
        expect(createAnnotatedImageBlobMock.mock.calls[0]?.[0]).toBe(blobPhoto1);
        expect(result.photosBase64['photo1']).toBe(`data:image/jpeg;base64,${Buffer.from('annotated-bytes').toString('base64')}`);
        // photo2 n'a pas d'annotations → pas de fusion, base64 du blob original.
        expect(result.photosBase64['photo2']).toBe(`data:image/jpeg;base64,${Buffer.from('photo2-bytes').toString('base64')}`);
        // custom_pdf_background résolu à la clé littérale (pdf_engine_v2.js:389-391).
        expect(result.photosBase64['custom_pdf_background']).toBe(`data:image/png;base64,${Buffer.from('bg-bytes').toString('base64')}`);

        // Copie PROFONDE : muter le résultat ne touche pas Store.state.formData.
        const photos = result.formData.dynamic_photos;
        if (!photos) throw new Error('dynamic_photos absent du résultat');
        const firstMeta = photos['photo_extra_adv1']?.[0];
        if (!firstMeta) throw new Error('photo1 absente du résultat');
        firstMeta.customTitle = 'MUTÉ';
        const storeMeta = Store.state.formData.dynamic_photos?.['photo_extra_adv1']?.[0];
        expect(storeMeta?.customTitle).toBe('');
    });

    it('photo absente de la DB : avertit (pas de rejet) et laisse la clé absente de photosBase64', async () => {
        vi.spyOn(dbManager, 'getItem').mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        Store.state.formData = {
            dynamic_photos: {
                photo_extra_adv1: [{ id: 'introuvable', annotations: '[]', tools: '[]', other_tools: '', customTitle: '' }],
            },
        };

        const result = await PDFEngineV2.collectAllData();

        expect(result.photosBase64['introuvable']).toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
    });

    it("isDark reflète pdf_theme ('dark'/'light') puis, à défaut, la classe dark-mode du body", async () => {
        vi.spyOn(dbManager, 'getItem').mockResolvedValue(undefined);

        Store.state.formData = { pdf_theme: 'dark' };
        expect((await PDFEngineV2.collectAllData()).isDark).toBe(true);

        Store.state.formData = { pdf_theme: 'light' };
        document.body.classList.add('dark-mode');
        expect((await PDFEngineV2.collectAllData()).isDark).toBe(false);

        Store.state.formData = {};
        expect((await PDFEngineV2.collectAllData()).isDark).toBe(true);
        document.body.classList.remove('dark-mode');
    });
});

// ===========================================================================
// openPreview (R4-a : aperçu = vrai PDF, remplace generateHTML)
// ===========================================================================
describe('openPreview', () => {
    let createObjectURLSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview-1');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    it("ne fait rien si #presentation-content est absent (pas de modale montée)", async () => {
        const collect = vi.fn(async () => makeCollectedData());
        const buildBlob = vi.fn(async () => new Blob(['%PDF-fake'], { type: 'application/pdf' }));

        await PDFEngineV2.openPreview({ collect, buildBlob });

        expect(collect).not.toHaveBeenCalled();
        expect(buildBlob).not.toHaveBeenCalled();
    });

    it('construit le blob (collect → buildBlob avec le format courant) et injecte un <iframe class="pdf-preview-frame"> pointant sur son URL blob', async () => {
        const { content } = buildPresentationDom();
        window.pdfOutputFormat = '16:9';
        const blob = new Blob(['%PDF-fake'], { type: 'application/pdf' });
        const collect = vi.fn(async () => makeCollectedData());
        const buildBlob = vi.fn(async () => blob);

        await PDFEngineV2.openPreview({ collect, buildBlob });

        expect(collect).toHaveBeenCalledTimes(1);
        expect(buildBlob).toHaveBeenCalledWith(expect.anything(), { format: '16:9' });
        const iframe = content.querySelector<HTMLIFrameElement>('.pdf-preview-frame');
        expect(iframe).not.toBeNull();
        expect(iframe?.src).toBe('blob:preview-1');
    });

    it("affiche/masque le loader #pdfLoadingModal pendant la génération", async () => {
        buildPresentationDom();
        const { loader } = buildLoaderDom();
        let resolveBuild: (blob: Blob) => void = () => {};
        const pending = new Promise<Blob>((resolve) => { resolveBuild = resolve; });

        const openPromise = PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => pending,
        });

        // Toujours en attente de buildBlob : le loader doit être visible.
        await Promise.resolve();
        await Promise.resolve();
        expect(loader.style.display).toBe('flex');

        resolveBuild(new Blob(['%PDF-fake'], { type: 'application/pdf' }));
        await openPromise;

        expect(loader.style.display).toBe('none');
    });

    it("replie sur un message clair quand navigator.pdfViewerEnabled === false, SANS appeler collect/buildBlob ni créer d'iframe (un navigateur incapable de rendre un PDF embarqué déclenche en coulisses un téléchargement fantôme pour la navigation de l'iframe — évité en ne la tentant pas)", async () => {
        const { content } = buildPresentationDom();
        vi.stubGlobal('navigator', { pdfViewerEnabled: false });
        const collect = vi.fn(async () => makeCollectedData());
        const buildBlob = vi.fn(async () => new Blob(['%PDF-fake'], { type: 'application/pdf' }));

        await PDFEngineV2.openPreview({ collect, buildBlob });

        expect(collect).not.toHaveBeenCalled();
        expect(buildBlob).not.toHaveBeenCalled();
        expect(content.querySelector('.pdf-preview-frame')).toBeNull();
        expect(content.querySelector('.pdf-preview-fallback')).not.toBeNull();
        expect(content.textContent).toContain('Télécharger le PDF');
    });

    it("affiche un message d'erreur si buildBlob échoue", async () => {
        const { content } = buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.reject(new Error('pdfmake KO')),
        });

        expect(content.querySelector('.pdf-preview-error')).not.toBeNull();
    });

    it('révoque l\'URL blob PRÉCÉDENTE quand un nouvel aperçu est généré', async () => {
        buildPresentationDom();
        createObjectURLSpy.mockReturnValueOnce('blob:preview-1').mockReturnValueOnce('blob:preview-2');
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
        const deps = {
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(new Blob(['%PDF-fake'], { type: 'application/pdf' })),
        };

        await PDFEngineV2.openPreview(deps);
        await PDFEngineV2.openPreview(deps);

        expect(revokeSpy).toHaveBeenCalledWith('blob:preview-1');
    });

    it("révoque l'URL blob à la fermeture de #presentationModal (événement natif `close`)", async () => {
        const { modal } = buildPresentationDom();
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(new Blob(['%PDF-fake'], { type: 'application/pdf' })),
        });

        modal.dispatchEvent(new Event('close'));

        expect(revokeSpy).toHaveBeenCalledWith('blob:preview-1');
    });
});

// ===========================================================================
// openPresentInPlace (R4-a : nouvel onglet sur le vrai PDF, remplace le
// « deck » HTML autonome de _buildPresentationDocument)
// ===========================================================================
describe('openPresentInPlace', () => {
    beforeEach(() => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:present-1');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    it('ouvre le blob PDF dans un nouvel onglet (window.open) et révoque son URL après le délai différé', async () => {
        vi.useFakeTimers();
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(new Blob(['%PDF-fake'], { type: 'application/pdf' })),
        });

        expect(openSpy).toHaveBeenCalledWith('blob:present-1', '_blank');
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        vi.advanceTimersByTime(120000);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:present-1');
        vi.useRealTimers();
    });

    it('popup bloquée (window.open renvoie null) : révoque IMMÉDIATEMENT et alerte', async () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(new Blob(['%PDF-fake'], { type: 'application/pdf' })),
        });

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:present-1');
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('bloquée'));
    });

    it("échec de collecte/build : notifie via window.toast('error', …) plutôt que de laisser planter", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.reject(new Error('collecte KO')),
        });

        expect(window.toast).toHaveBeenCalledWith("Erreur lors de l'ouverture de la présentation.", 'error');
    });

    it('affiche/masque le loader #pdfLoadingModal pendant la génération', async () => {
        const { loader } = buildLoaderDom();
        vi.spyOn(window, 'open').mockReturnValue({} as Window);

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(new Blob(['%PDF-fake'], { type: 'application/pdf' })),
        });

        expect(loader.style.display).toBe('none');
    });
});
