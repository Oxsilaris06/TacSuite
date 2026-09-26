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
import { OiPdfFitRefusalError } from '@oi/pdf/theme.js';
import { acquirePdfLock, releasePdfLock } from '@oi/pdf/generation-lock.js';
import type { OiPdfCollectedData } from '@shared/types/contracts.js';

// R2-T2b : `alert()` natif → `toast` (`@shared/feedback.js`) mocké plutôt que
// `vi.spyOn(window, 'alert')`, même pattern que `pc-archive.test.ts`.
const toastSpy = vi.hoisted(() => vi.fn());
// Décision 43 : le refus « une page = un usage » passe par une fenêtre persistante.
const confirmSpy = vi.hoisted(() => vi.fn(() => Promise.resolve(false)));
vi.mock('@shared/feedback.js', () => ({
    toast: toastSpy,
    confirmDialog: confirmSpy,
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

    // Décision 42 : le thème du PDF vient de la fenêtre de génération (clair
    // par défaut), plus du thème de l'application ni de `pdf_theme` (qui
    // rendait un PDF noir dès que l'appli était en sombre, audit F02). Ce test
    // remplace l'ancien « isDark reflète pdf_theme puis dark-mode du body ».
    it("isDark suit le thème choisi dans la fenêtre de génération (clair par défaut), jamais le thème de l'application", async () => {
        vi.spyOn(dbManager, 'getItem').mockResolvedValue(undefined);
        localStorage.removeItem('tacPdfOptions:oi');

        document.body.classList.add('dark-mode');
        Store.state.formData = { pdf_theme: 'dark' };
        expect((await PDFEngineV2.collectAllData()).isDark).toBe(false);

        localStorage.setItem('tacPdfOptions:oi', JSON.stringify({ kind: null, theme: 'sombre', sortie: 'impression' }));
        document.body.classList.remove('dark-mode');
        Store.state.formData = { pdf_theme: 'light' };
        expect((await PDFEngineV2.collectAllData()).isDark).toBe(true);
        localStorage.removeItem('tacPdfOptions:oi');
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
        expect(buildBlob).toHaveBeenCalledWith(expect.anything(), { format: '16:9', sortie: 'impression' });
        expect(renderPdf).toHaveBeenCalledTimes(1);
        const [renderedBlob, container] = renderPdf.mock.calls[0] as [Blob, HTMLElement, unknown];
        expect(renderedBlob).toBe(blob);
        expect(container.className).toBe('pdf-preview-pages');
        expect(content.contains(container)).toBe(true);
        // Le faux renderPdf a peint 2 pages dans le conteneur qu'on lui a passé.
        expect(container.querySelectorAll('.pdf-preview-page')).toHaveLength(2);
    });

    it('annonce le poids du PDF sous les choix de sortie (décision 42)', async () => {
        const { modal } = buildPresentationDom();
        const note = document.createElement('span');
        note.id = 'pdfWeightNote';
        modal.appendChild(note);

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: makeFakeRenderPdf(1),
        });

        expect(note.textContent).toBe('Poids du PDF : 9 o');
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

    it('premier aperçu refusé (une page déborde) : l’aperçu explique le refus au lieu de renvoyer vers « Télécharger », qui échouerait pareil (décision 43, audit F07)', async () => {
        const { content } = buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        confirmSpy.mockClear();

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.reject(new OiPdfFitRefusalError([
                { section: 'Fiche Adversaire 1 : DUPONT', details: 'réduisez les ATCD', excessRatio: 0.05, excessLines: 4 },
            ])),
        });

        const text = content.querySelector('.pdf-preview-error')?.textContent ?? '';
        expect(text).toContain('Fiche Adversaire 1 : DUPONT');
        expect(text).toContain('environ 4 lignes de trop');
        expect(text).not.toContain('Télécharger le PDF');
        expect(confirmSpy).toHaveBeenCalledTimes(1);
    });

    it('« Présenter ici » refusé (une page déborde) : même fenêtre persistante, pas le message générique', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        confirmSpy.mockClear();

        await PDFEngineV2.openPresentInPlace({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.reject(new OiPdfFitRefusalError([
                { section: 'Articulation : ZMSPCP - APPUI', details: 'retirez des cellules', excessRatio: 0.1, excessLines: 2 },
            ])),
        });

        expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Articulation : ZMSPCP - APPUI') }));
        expect(toastSpy).not.toHaveBeenCalledWith("Erreur lors de l'ouverture de la présentation.", expect.anything());
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

    it("bascule sur le lecteur PDF du navigateur (<object>) quand pdf.js échoue mais que le PDF existe", async () => {
        const { content } = buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const revoked: string[] = [];
        vi.stubGlobal('URL', Object.assign(Object.create(URL), {
            createObjectURL: () => 'blob:fake-pdf',
            revokeObjectURL: (u: string) => revoked.push(u),
        }));

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: () => Promise.reject(new Error('worker pdf.js refusé')),
        });

        const viewer = content.querySelector('object.pdf-preview-fallback-object');
        expect(viewer).not.toBeNull();
        expect(viewer?.getAttribute('type')).toBe('application/pdf');
        expect(viewer?.getAttribute('data')).toBe('blob:fake-pdf');
        // Contenu enfant = dernier recours si le lecteur natif est lui aussi coupé.
        expect(viewer?.querySelector('.pdf-preview-error')?.textContent).toContain('Télécharger le PDF');
        // La cause reste lisible à l'écran.
        expect(content.querySelector('.pdf-preview-fallback-note')?.textContent)
            .toContain('worker pdf.js refusé');

        // Fermeture de la modale : l'URL blob est révoquée (pas de fuite mémoire).
        document.getElementById('presentationModal')?.dispatchEvent(new Event('close'));
        expect(revoked).toContain('blob:fake-pdf');
        vi.unstubAllGlobals();
    });

    it("révoque l'URL blob du repli dès qu'un aperçu suivant réussit", async () => {
        buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const revoked: string[] = [];
        vi.stubGlobal('URL', Object.assign(Object.create(URL), {
            createObjectURL: () => 'blob:fake-pdf',
            revokeObjectURL: (u: string) => revoked.push(u),
        }));

        // 1er aperçu : pdf.js échoue, repli sur le lecteur du navigateur.
        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: () => Promise.reject(new Error('worker pdf.js refusé')),
        });
        expect(revoked).not.toContain('blob:fake-pdf');

        // 2e aperçu, celui-ci RÉUSSIT : le blob du repli n'a plus de raison
        // d'être retenu, même si la modale reste ouverte.
        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: makeFakeRenderPdf(),
        });
        expect(revoked).toContain('blob:fake-pdf');
        vi.unstubAllGlobals();
    });

    it("ne bascule PAS sur le lecteur du navigateur si le PDF n'a pas pu être construit", async () => {
        const { content } = buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('URL', Object.assign(Object.create(URL), {
            createObjectURL: () => 'blob:fake-pdf',
            revokeObjectURL: () => {},
        }));

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.reject(new Error('pdfmake KO')),
        });

        expect(content.querySelector('object.pdf-preview-fallback-object')).toBeNull();
        expect(content.querySelector('.pdf-preview-error')?.textContent).toContain('pdfmake KO');
        vi.unstubAllGlobals();
    });

    it("expose la cause technique quand MÊME le lecteur du navigateur est hors jeu (blob: interdit)", async () => {
        const { content } = buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        // Stratégie de groupe interdisant les URL `blob:` : `createObjectURL`
        // lève, le niveau 2 est impossible, il ne reste que le texte — qui doit
        // alors porter la cause, seul diagnostic disponible sur un parc sans console.
        vi.stubGlobal('URL', Object.assign(Object.create(URL), {
            createObjectURL: () => { throw new Error('blob: interdit'); },
            revokeObjectURL: () => {},
        }));

        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: () => Promise.reject(new TypeError('Promise.withResolvers is not a function')),
        });

        expect(content.querySelector('object.pdf-preview-fallback-object')).toBeNull();
        const errorEl = content.querySelector('.pdf-preview-error');
        expect(errorEl?.textContent).toContain('Promise.withResolvers is not a function');
        expect(errorEl?.textContent).toContain('Télécharger le PDF');
        vi.unstubAllGlobals();
    });

    // Non-régression (mission « effondrement pagination », mesuré : une
    // session d'aperçu enchaînant plusieurs corrections en place — clic sur un
    // texte → édition → validation → régénération, plusieurs fois de suite —
    // finit par faire dépasser une page-usage à contrat dur (fiche
    // adversaire/ZMSPCP/MOICP/effraction, `OiPdfFitRefusalError`) : reproduit
    // via 25 corrections successives réelles, ATCD d'une fiche adversaire
    // (chaque correction repart de la valeur COURANTE COMPLÈTE, donc
    // s'allonge cumulativement) — le nombre de pages du document
    // s'effondrait de 15 à 0 (`.pdf-preview-page` disparaissait entièrement,
    // remplacé par un message d'erreur générique, plus aucune zone éditable
    // pour corriger le champ fautif). AVANT correctif : cette régénération en
    // échec vidait `presentationContent` de façon SYNCHRONE dès son
    // déclenchement, perdant les pages du DERNIER aperçu réussi avant même de
    // savoir si la nouvelle génération allait aboutir. APRÈS correctif : un
    // échec de régénération (refus fit-to-page ou toute autre erreur) laisse
    // le dernier aperçu réussi INTACT à l'écran — jamais de collapse à 0 page
    // tant qu'un rendu précédent existe.
    it("un échec de régénération (OiPdfFitRefusalError, ex. correction en place qui fait dépasser une fiche adversaire) NE VIDE PAS le dernier aperçu réussi — pas d'effondrement du nombre de pages", async () => {
        const { content } = buildPresentationDom();
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // 1) Premier aperçu : réussit, 4 pages rendues (état d'une session
        // d'édition qui a déjà accumulé plusieurs corrections valides).
        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: makeFakeRenderPdf(4),
        });
        expect(content.querySelectorAll('.pdf-preview-page')).toHaveLength(4);

        // 2) Une correction de trop (ex. ATCD qui dépasse maintenant la fiche
        // adversaire, même au palier plancher) : buildBlob échoue avec le
        // refus de génération explicite du solveur fit-to-page.
        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.reject(new OiPdfFitRefusalError([
                { section: 'Fiche Adversaire 1 : DUPONT', details: 'ATCD trop longs', excessRatio: 0.02 },
            ])),
        });

        // Les 4 pages du DERNIER aperçu réussi sont toujours là — aucun
        // effondrement, aucun message d'erreur générique qui les remplacerait.
        expect(content.querySelectorAll('.pdf-preview-page')).toHaveLength(4);
        expect(content.querySelector('.pdf-preview-error')).toBeNull();
        // L'utilisateur est notifié (message SPÉCIFIQUE du refus, pas le
        // générique) — décision 43 : fenêtre persistante avec « Aller au
        // champ » (plus un toast de 4 s), sans détruire l'aperçu affiché.
        expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Fiche Adversaire 1') }));
        expect(toastSpy).not.toHaveBeenCalledWith(expect.anything(), { kind: 'error' });

        // 3) Une régénération qui réussit ENSUITE (champ raccourci) retrouve
        // normalement un rendu propre — la voie de récupération reste intacte.
        await PDFEngineV2.openPreview({
            collect: () => Promise.resolve(makeCollectedData()),
            buildBlob: () => Promise.resolve(makeFakeBlob()),
            renderPdf: makeFakeRenderPdf(3),
        });
        expect(content.querySelectorAll('.pdf-preview-page')).toHaveLength(3);
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
describe('verrou : une génération à la fois (audit F23)', () => {
    it('aperçu ou « Présenter ici » pendant un téléchargement : refusé, rien n\'est construit', async () => {
        buildPresentationDom();
        const token = acquirePdfLock('telechargement');
        expect(token).not.toBeNull();
        const buildBlob = vi.fn(async () => makeFakeBlob());
        try {
            await PDFEngineV2.openPreview({ collect: () => Promise.resolve(makeCollectedData()), buildBlob, renderPdf: makeFakeRenderPdf() });
            await PDFEngineV2.openPresentInPlace({ collect: () => Promise.resolve(makeCollectedData()), buildBlob });
        } finally {
            releasePdfLock(token as number);
        }
        expect(buildBlob).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('déjà en cours'), expect.anything());
    });

    it('le verrou de l\'aperçu est rendu à la fin : un téléchargement peut suivre', async () => {
        buildPresentationDom();
        await PDFEngineV2.openPreview({ collect: () => Promise.resolve(makeCollectedData()), buildBlob: async () => makeFakeBlob(), renderPdf: makeFakeRenderPdf() });
        const token = acquirePdfLock('telechargement');
        expect(token).not.toBeNull();
        releasePdfLock(token as number);
    });

    it('« Présenter ici » bloqué par le navigateur : le repli sur l\'aperçu intégré n\'est pas refusé par son propre verrou', async () => {
        buildPresentationDom();
        vi.spyOn(window, 'open').mockReturnValue(null);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const renderPdf = makeFakeRenderPdf();
        await PDFEngineV2.openPresentInPlace({ collect: () => Promise.resolve(makeCollectedData()), buildBlob: async () => makeFakeBlob(), renderPdf });
        expect(renderPdf).toHaveBeenCalledTimes(1);
        const token = acquirePdfLock('telechargement');
        expect(token).not.toBeNull();
        releasePdfLock(token as number);
    });
});

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
