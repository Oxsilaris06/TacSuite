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
 * SPEC-2026-08-18-pdf-et-champs.md §1 — l'aperçu rend désormais le PDF en
 * `<canvas>` via pdf.js embarqué au lieu d'un `<iframe>` sur une URL `blob:`.
 * pdf.js (worker, décodage, rendu canvas) est difficile à exercer sous jsdom
 * et n'a AUCUN besoin de l'être ici : `deps.renderPdf` (couture de test déjà
 * du même type que `collect`/`buildBlob`) isole tout ça — `defaultRenderPdf`,
 * la vraie implémentation pdf.js, n'est jamais exécutée par cette suite. La
 * garde `canRenderInlinePdf()` (`navigator.pdfViewerEnabled`) et son message
 * de repli disparaissent avec l'`<iframe>` : plus aucun appelant n'en dépend
 * (grep confirmé sur `src/`, `tests/`) — les tests correspondants disparaissent
 * avec elle.
 *
 * Tests obligatoires (PAQUETS-OI.json id="oi-pdf-engine-v2") :
 *  (a) collectAllData avec un Store mocké contenant une photo (avec et sans
 *      annotations) et un `custom_pdf_background` → `photosBase64` peuplé aux
 *      bonnes clés, ET la copie de `formData` est bien PROFONDE (muter la
 *      copie ne touche pas le Store).
 *  (b) openPreview : construit le blob (collect → buildBlob) puis délègue le
 *      rendu à `deps.renderPdf` dans un conteneur `.pdf-preview-pages` de
 *      `#presentation-content`, affiche/masque le loader `#pdfLoadingModal`,
 *      relaie la progression (`onProgress`) dans `#pdfLoadingStatus`, affiche
 *      un message d'erreur si `buildBlob`/`renderPdf` échoue, ANNULE un rendu
 *      encore en vol (au prochain point de contrôle du faux `renderPdf`
 *      injecté) quand un nouvel `openPreview()` est déclenché OU quand
 *      `#presentationModal` se ferme (événement natif `close`).
 *  (c) openPresentInPlace : ouvre le blob dans un nouvel onglet
 *      (`window.open`), révoque l'URL après le délai différé en cas
 *      d'ouverture réussie, révoque IMMÉDIATEMENT + alerte + retombe sur
 *      l'aperçu intégré (pdf.js/canvas, via le même blob déjà construit) si
 *      la popup est bloquée, notifie via `window.toast` en cas d'échec de
 *      collecte/build.
 *  (d)/(e) anciennement downloadOiPdf() (nom de fichier + repli SANS_DATE/RED
 *      + branches « librairie absente ») : voir désormais le describe
 *      `downloadOiPdfV3` de `tests/unit/oi/pdf/oi-pdf-engine-v3.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dbManager, Store } from '@oi/init.js';
import { PDFEngineV2 } from '@oi/pdf-engine-v2.js';
import type { OiPdfCollectedData } from '@shared/types/contracts.js';

// R2-T2b : `alert()` natif → `toast` (`@shared/feedback.js`) mocké plutôt que
// `vi.spyOn(window, 'alert')`, même pattern que `pc-archive.test.ts`.
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({
    toast: toastSpy,
}));

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

function makeFakeBlob(): Blob {
    return new Blob(['%PDF-fake'], { type: 'application/pdf' });
}

/** Faux `renderPdf` (couture de test) : simule un rendu à `pageCount` pages,
 * une par `onProgress`, sans jamais toucher pdf.js. */
function makeFakeRenderPdf(pageCount = 1) {
    return vi.fn(async (_blob: Blob, container: HTMLElement, progress: { onProgress: (p: number, t: number) => void; isCancelled: () => boolean }) => {
        for (let page = 1; page <= pageCount; page++) {
            if (progress.isCancelled()) return;
            const pageEl = document.createElement('div');
            pageEl.className = 'pdf-preview-page';
            container.appendChild(pageEl);
            progress.onProgress(page, pageCount);
        }
    });
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
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    toastSpy.mockClear();
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
// openPreview (SPEC-2026-08-18-pdf-et-champs.md §1 : rendu pdf.js/<canvas>,
// remplace l'<iframe> sur Blob URL)
// ===========================================================================
describe('openPreview', () => {
    it("ne fait rien si #presentation-content est absent (pas de modale montée)", async () => {
        const collect = vi.fn(async () => makeCollectedData());
        const buildBlob = vi.fn(async () => makeFakeBlob());
        const renderPdf = makeFakeRenderPdf();

        await PDFEngineV2.openPreview({ collect, buildBlob, renderPdf });

        expect(collect).not.toHaveBeenCalled();
        expect(buildBlob).not.toHaveBeenCalled();
        expect(renderPdf).not.toHaveBeenCalled();
    });

    it('construit le blob (collect → buildBlob avec le format courant) puis délègue le rendu à renderPdf dans un conteneur .pdf-preview-pages', async () => {
        const { content } = buildPresentationDom();
        window.pdfOutputFormat = '16:9';
        const blob = makeFakeBlob();
        const collect = vi.fn(async () => makeCollectedData());
        const buildBlob = vi.fn(async () => blob);
        const renderPdf = makeFakeRenderPdf(2);

        await PDFEngineV2.openPreview({ collect, buildBlob, renderPdf });

        expect(collect).toHaveBeenCalledTimes(1);
        expect(buildBlob).toHaveBeenCalledWith(expect.anything(), { format: '16:9' });
        expect(renderPdf).toHaveBeenCalledTimes(1);
        const [renderedBlob, container] = renderPdf.mock.calls[0] as [Blob, HTMLElement, unknown];
        expect(renderedBlob).toBe(blob);
        expect(container.className).toBe('pdf-preview-pages');
        expect(content.contains(container)).toBe(true);
        // Le faux renderPdf a peint 2 pages dans le conteneur qu'on lui a passé.
        expect(container.querySelectorAll('.pdf-preview-page')).toHaveLength(2);
    });

    it("relaie la progression (onProgress) dans #pdfLoadingStatus pendant le rendu", async () => {
        buildPresentationDom();
        const { statusText } = buildLoaderDom();

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: makeFakeRenderPdf(3),
        });

        expect(statusText.textContent).toBe('Rendu des pages… (3/3)');
    });

    it("affiche/masque le loader #pdfLoadingModal pendant la génération", async () => {
        buildPresentationDom();
        const { loader } = buildLoaderDom();
        let resolveBuild: (blob: Blob) => void = () => {};
        const pending = new Promise<Blob>((resolve) => { resolveBuild = resolve; });

        const openPromise = PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => pending,
            renderPdf: makeFakeRenderPdf(),
        });

        // Toujours en attente de buildBlob : le loader doit être visible.
        await Promise.resolve();
        await Promise.resolve();
        expect(loader.style.display).toBe('flex');

        resolveBuild(makeFakeBlob());
        await openPromise;

        expect(loader.style.display).toBe('none');
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

    it("affiche un message d'erreur si renderPdf (pdf.js) échoue, en gardant le bouton de téléchargement exploitable", async () => {
        const { content } = buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: () => Promise.reject(new Error('pdf.js KO')),
        });

        const errorEl = content.querySelector('.pdf-preview-error');
        expect(errorEl).not.toBeNull();
        expect(errorEl?.textContent).toContain('Télécharger le PDF');
    });

    it('annule le rendu PRÉCÉDENT (isCancelled devient true) quand un nouvel aperçu est généré avant qu\'il ne se termine', async () => {
        const { content } = buildPresentationDom();
        let firstIsCancelled: (() => boolean) | undefined;
        const firstRenderPdf = vi.fn((_blob: Blob, _container: HTMLElement, progress: { isCancelled: () => boolean }) => {
            firstIsCancelled = progress.isCancelled;
            return new Promise<void>(() => {}); // ne se termine jamais dans ce test
        });

        // Premier rendu : buildBlob résout tout de suite, renderPdf DÉMARRE
        // (et s'installe) avant qu'un second aperçu ne soit déclenché.
        void PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: firstRenderPdf,
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(firstRenderPdf).toHaveBeenCalledTimes(1);
        expect(firstIsCancelled?.()).toBe(false);

        // Deuxième aperçu, avant que le premier ne se termine.
        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: makeFakeRenderPdf(),
        });

        expect(firstIsCancelled?.()).toBe(true);
        // Le conteneur affiché est celui du DEUXIÈME rendu, pas pollué par le premier.
        expect(content.querySelectorAll('.pdf-preview-pages')).toHaveLength(1);
    });

    it("annule le rendu en cours à la fermeture de #presentationModal (événement natif `close`)", async () => {
        const { modal } = buildPresentationDom();
        let isCancelled: (() => boolean) | undefined;

        void PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: (_blob, _container, progress) => {
                isCancelled = progress.isCancelled;
                return new Promise(() => {});
            },
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(isCancelled?.()).toBe(false);
        modal.dispatchEvent(new Event('close'));
        expect(isCancelled?.()).toBe(true);
    });
});

// ===========================================================================
// openPresentInPlace (R4-a : nouvel onglet sur le vrai PDF ; SPEC §1 : repli
// sur l'aperçu intégré pdf.js/<canvas> si le nouvel onglet échoue/est bloqué)
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
            buildBlob: () => Promise.resolve(makeFakeBlob()),
        });

        expect(openSpy).toHaveBeenCalledWith('blob:present-1', '_blank');
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        vi.advanceTimersByTime(120000);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:present-1');
        vi.useRealTimers();
    });

    it("popup bloquée (window.open renvoie null) : révoque IMMÉDIATEMENT, alerte, et retombe sur l'aperçu intégré (pdf.js/<canvas>) avec le MÊME blob déjà construit", async () => {
        const { modal, content } = buildPresentationDom();
        vi.spyOn(window, 'open').mockReturnValue(null);
        const blob = makeFakeBlob();
        const renderPdf = makeFakeRenderPdf(1);

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(blob),
            renderPdf,
        });

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:present-1');
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('bloquée'), { kind: 'error' });
        // Repli sur l'aperçu intégré : même blob réutilisé (pas de recollecte/rebuild).
        expect(renderPdf).toHaveBeenCalledTimes(1);
        expect(renderPdf.mock.calls[0]?.[0]).toBe(blob);
        expect(content.querySelector('.pdf-preview-page')).not.toBeNull();
        // jsdom n'implémente pas showModal() : repli défensif par style inline.
        expect(modal.style.display).toBe('flex');
    });

    it("échec de collecte/build : notifie via toast(kind 'error') plutôt que de laisser planter", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.reject(new Error('collecte KO')),
        });

        expect(toastSpy).toHaveBeenCalledWith("Erreur lors de l'ouverture de la présentation.", { kind: 'error' });
    });

    it('affiche/masque le loader #pdfLoadingModal pendant la génération', async () => {
        const { loader } = buildLoaderDom();
        vi.spyOn(window, 'open').mockReturnValue({} as Window);

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
        });

        expect(loader.style.display).toBe('none');
    });
});
