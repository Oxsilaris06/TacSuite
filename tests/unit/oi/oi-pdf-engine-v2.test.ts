/**
 * oi-pdf-engine-v2.test.ts — Tests unitaires de `pdf-engine-v2.ts` (P3.CONV,
 * paquet `oi-pdf-engine-v2`, port de `modules/pdf_engine_v2.js`, GStart-main,
 * 1156 LOC intégral, lecture seule). Cf. SPEC-OI-CONVERSION.md §7 (ARBITRAGE 3),
 * PAQUETS-OI.json (`oi-pdf-engine-v2`).
 *
 * `Store`/`dbManager` RÉELS (pas de double), importés depuis `@oi/init.js` —
 * même précédent que `oi-medias.test.ts`/`oi-articulation.test.ts` :
 * `Store.state.formData` est réinitialisé avant chaque test ;
 * `dbManager.getItem` est MOCKÉ via `vi.spyOn` sur l'objet réel exporté
 * (aucune vraie IndexedDB ouverte, absente sous jsdom, règle commune §13.5).
 * Utilisé pour les describe `collectAllData` / `generateHTML` / `_fitPageToBudget`.
 *
 * `createAnnotatedImageBlob` (`@oi/dessin.js`, import NOMMÉ de fonction, pas
 * un objet/méthode — impossible à intercepter par `vi.spyOn`) MOCKÉ via
 * `vi.mock` + `vi.hoisted`, même précédent que `compressImage` dans
 * `oi-medias.test.ts`.
 *
 * `html2canvas`/`jspdf` (imports npm SPEC §7, PAS les globaux CDN) : mockés
 * PAR TEST via `vi.resetModules()` + `vi.doMock()` + réimport dynamique de
 * `pdf-engine-v2.ts` (et de `init.ts`, pour obtenir le COUPLE Store/dbManager
 * assorti au même graphe de modules) — seule façon de faire varier « librairie
 * absente » (`typeof … !== 'function'`) d'un test à l'autre sans toucher au
 * module source (import statique). Même précédent que `pm-capture.test.ts`
 * pour `html2canvas`. Utilisé UNIQUEMENT par le describe `downloadOiPdf`
 * (seule méthode qui consomme ces deux bibliothèques) ; les autres describe
 * utilisent l'import statique habituel de `PDFEngineV2`/`Store`/`dbManager`.
 *
 * `<img>.decode()` n'existe pas sous jsdom, et tout `<img src="data:...">`
 * (src non vide) y a `complete === false` par défaut : un appel non gardé à
 * `.decode()` lèverait une `TypeError` AVANT le `.catch()`. Les fixtures du
 * describe `downloadOiPdf` sont donc volontairement SANS PHOTO (aucune clé
 * `dynamic_photos`/`custom_pdf_background`) : `generateHTML` ne produit alors
 * aucun `<img src="...">` non vide (tous les blocs image sont conditionnels
 * dans le gabarit, cf. pdf-engine-v2.ts). La fidélité de rendu des photos
 * elles-mêmes est couverte par le describe `generateHTML` (chaîne de sortie
 * uniquement, jamais injectée dans le DOM réel).
 *
 * `canvas.toDataURL` : « Not implemented » sous jsdom (paquet `canvas`
 * absent) → le stub `html2canvasMock` ci-dessous écrase `.toDataURL` sur le
 * canvas factice qu'il retourne, avant que `downloadOiPdf` ne l'appelle.
 *
 * `window.toast` : stub `vi.fn()`, même précédent que `oi-medias.test.ts`.
 *
 * Tests obligatoires (PAQUETS-OI.json id="oi-pdf-engine-v2") :
 *  (a) collectAllData avec un Store mocké contenant une photo (avec et sans
 *      annotations) et un `custom_pdf_background` → `photosBase64` peuplé aux
 *      bonnes clés, ET la copie de `formData` est bien PROFONDE (muter la
 *      copie ne touche pas le Store).
 *  (b) generateHTML produit les marqueurs de section dans l'ORDRE attendu
 *      (assertions sur la présence et l'ordre des titres, pas sur le rendu
 *      pixel), y compris les DEUX sections « 7. » (artefact reproduit).
 *  (c) _fitPageToBudget avec différentes géométries simulées (pas de
 *      débordement / débordement modéré / débordement extrême clampé à
 *      MIN_SCALE / idempotence / préservation des éléments position:absolute).
 *  (d) downloadOiPdf avec html2canvas et jsPDF stubbés → nom de fichier
 *      généré (avec et sans repli SANS_DATE/RED) et nombre d'appels
 *      addImage/addPage.
 *  (e) branche « librairie absente » (jsPDF puis html2canvas) → messages
 *      utilisateur INCHANGÉS (console.error + toast générique).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dbManager, Store } from '@oi/init.js';
import { PDFEngineV2 } from '@oi/pdf-engine-v2.js';
import type {
    OiEffractionBlock,
    OiFormData,
    OiMoicpBlock,
    OiPatracRow,
    OiPdfCollectedData,
    OiZmspcpBlock,
} from '@shared/types/contracts.js';

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
// html2canvas / jsPDF — doubles partagés, injectés au chargement dynamique de
// pdf-engine-v2.ts (describe downloadOiPdf uniquement, cf. loadPdfEngine()).
// ---------------------------------------------------------------------------
const { html2canvasMock, FakeJsPdf, jsPdfInstances } = vi.hoisted(() => {
    const html2canvasFn = vi.fn(async (): Promise<HTMLCanvasElement> => {
        const canvas = document.createElement('canvas');
        // jsdom : HTMLCanvasElement.toDataURL() n'est pas implémentée (paquet
        // `canvas` absent) — remplacée par une valeur déterministe. Longueur
        // ≥100 caractères délibérée : downloadOiPdf traite tout data URL plus
        // court comme un rendu vide (pdf_engine_v2.js:309).
        canvas.toDataURL = (): string => `data:image/jpeg;base64,ZmFrZS1jYW52YXM${'A'.repeat(100)}`;
        return canvas;
    });

    interface FakeJsPdfInstance {
        opts: unknown;
        addImageCalls: unknown[][];
        addPageCalls: number;
        savedFileName: string | undefined;
    }
    const instances: FakeJsPdfInstance[] = [];
    class FakeJsPdfImpl implements FakeJsPdfInstance {
        opts: unknown;
        addImageCalls: unknown[][] = [];
        addPageCalls = 0;
        savedFileName: string | undefined;
        constructor(opts: unknown) {
            this.opts = opts;
            instances.push(this);
        }
        addImage(...args: unknown[]): this {
            this.addImageCalls.push(args);
            return this;
        }
        addPage(): this {
            this.addPageCalls++;
            return this;
        }
        save(fileName: string): this {
            this.savedFileName = fileName;
            return this;
        }
    }

    return { html2canvasMock: html2canvasFn, FakeJsPdf: FakeJsPdfImpl, jsPdfInstances: instances };
});

/**
 * Recharge `pdf-engine-v2.ts` (+ `init.ts`, pour un couple Store/dbManager
 * assorti au même graphe de modules) avec `html2canvas`/`jsPDF` mockés à la
 * valeur donnée POUR CE TEST — seule façon de faire varier la branche
 * « librairie absente » (`typeof … !== 'function'`) sans toucher au module
 * source. Même précédent que `loadCapture()` dans `pm-capture.test.ts`.
 *
 * Paramètres SANS valeur par défaut (délibéré) : un paramètre par défaut se
 * substituerait silencieusement à un `undefined` passé explicitement (sémantique
 * standard des paramètres par défaut JS), ce qui est EXACTEMENT la valeur dont
 * les tests « librairie absente » ont besoin — toujours passer les deux
 * arguments explicitement.
 */
async function loadPdfEngine(
    html2canvasValue: unknown,
    jsPdfValue: unknown,
): Promise<{
    PDFEngineV2: typeof PDFEngineV2;
    Store: typeof Store;
    dbManager: typeof dbManager;
}> {
    vi.resetModules();
    vi.doMock('html2canvas', () => ({ default: html2canvasValue }));
    vi.doMock('jspdf', () => ({ jsPDF: jsPdfValue }));
    const engineMod = await import('@oi/pdf-engine-v2.js');
    const initMod = await import('@oi/init.js');
    return { PDFEngineV2: engineMod.PDFEngineV2, Store: initMod.Store, dbManager: initMod.dbManager };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePatracRow(): OiPatracRow {
    return {
        vehicle: 'VL1',
        members: [
            {
                trigramme: 'ABC',
                fonction: 'Chef inter',
                cellule: 'AO1',
                principales: 'UMP9',
                secondaires: 'PSA',
                afis: 'PIE',
                grenades: 'GENL',
                equipement: 'Sans',
                equipement2: 'Sans',
                tenue: 'UBAS',
                gpb: 'Sans',
                dir: '',
            },
        ],
    };
}

/** Fixture riche (sections 1 à 8) pour vérifier l'ORDRE des marqueurs de `generateHTML`. */
function makeRichFormData(): OiFormData {
    const zmspcpBlocks: OiZmspcpBlock[] = [
        {
            id: 'z1', title: 'ZONE ALPHA', zone: '-', mission: '-', secteur: '-',
            points_particuliers: '-', cat: '-', place_chef: '-', members: [],
        },
    ];
    const moicpBlocks: OiMoicpBlock[] = [
        {
            id: 'm1', title: 'ITIN BRAVO', mission: '-', objectif: '-', itineraire: '-',
            points_particuliers: '-', cat: '-', place_chef: '-', members: [],
        },
    ];
    const effractionBlocks: OiEffractionBlock[] = [
        {
            id: 'e1', title: 'PORTE CHARLIE', mission: '-', porte: '-', structure: '-',
            serrurerie: '-', environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-',
            prof_linteaux: '-', prof_bati: '-', h_porte: '-', h_marche: '-',
            prof_marche: '-', prof_moulure: '-', members: [], hypotheses: [],
        },
    ];
    return {
        date_op: '2026-05-15',
        trigramme_redacteur: 'REF',
        adversaries: [{ id: 'adv1', nom_adversaire: 'DUPONT', me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] }],
        dynamic_photos: {
            photo_container_transport_pr_preview_container: [
                { id: 'logphoto', annotations: '[]', tools: '[]', other_tools: '', customTitle: '' },
            ],
        },
        zmspcp_blocks: zmspcpBlocks,
        moicp_blocks: moicpBlocks,
        effraction_blocks: effractionBlocks,
        cat_generales: 'RAS',
        patracdvr_rows: [makePatracRow()],
    };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
    window.toast = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
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
// generateHTML (pdf_engine_v2.js:465-1151)
// ===========================================================================
describe('generateHTML', () => {
    it('produit les marqueurs de section dans l\'ordre attendu, y compris les DEUX sections « 7. » (artefact reproduit tel quel)', () => {
        const data: OiPdfCollectedData = {
            formData: makeRichFormData(),
            photosBase64: { logphoto: 'data:image/jpeg;base64,bG9n' },
            isDark: false,
        };

        const html = PDFEngineV2.generateHTML(data, false, { pageW: 297, pageH: 210 });

        const markers = [
            'ORDRE INITIAL',
            '1. SITUATION GLOBALE',
            'CIBLES(S)',
            '2.1 FICHE ADVERSAIRE : DUPONT',
            '3. ENVIRONNEMENT ET AMIS',
            "4. MISSION DE L'UNITÉ",
            '5. EXÉCUTION',
            '6. LOGISTIQUE &amp; TRANSPORTS (Cheminement)'.replace('&amp;', '&'),
            '7. ARTICULATION &amp; ORDRES DE MOUVEMENT'.replace('&amp;', '&'),
            'Articulation : ZMSPCP - ZONE ALPHA',
            'Articulation : MOICP - ITIN BRAVO',
            'Articulation : EFFRACTION - PORTE CHARLIE',
            '8. CONDUITES À TENIR GÉNÉRALES',
            '7. RÉCAPITULATIF PATRACDVR',
            'AVEZ-VOUS DES QUESTIONS ?',
        ];

        const indices = markers.map((m) => html.indexOf(m));
        indices.forEach((idx, i) => expect(idx, `marqueur introuvable : ${markers[i]}`).toBeGreaterThanOrEqual(0));
        for (let i = 1; i < indices.length; i++) {
            expect(indices[i], `« ${markers[i]} » doit venir après « ${markers[i - 1]} »`).toBeGreaterThan(indices[i - 1] as number);
        }

        // NUMÉROTATION INCOHÉRENTE reproduite telle quelle (SPEC §7) : exactement
        // deux titres « 7. » distincts (articulation ET patracdvr).
        expect((html.match(/>7\. /g) ?? []).length).toBe(2);
    });

    it('sans cat_generales/no_go/cat_liaison, la page "8. CONDUITES À TENIR GÉNÉRALES" est omise', () => {
        const formData = makeRichFormData();
        delete formData.cat_generales;
        const data: OiPdfCollectedData = { formData, photosBase64: {}, isDark: false };

        const html = PDFEngineV2.generateHTML(data, false, {});

        expect(html).not.toContain('8. CONDUITES À TENIR GÉNÉRALES');
    });

    it("sans aucun adversaire, la section CIBLES(S) affiche le repli et aucune fiche 2.x n'apparaît", () => {
        const data: OiPdfCollectedData = { formData: {}, photosBase64: {}, isDark: false };

        const html = PDFEngineV2.generateHTML(data, false, {});

        expect(html).toContain('Aucune cible renseignée.');
        expect(html).not.toContain('FICHE ADVERSAIRE');
    });
});

// ===========================================================================
// _fitPageToBudget (pdf_engine_v2.js:412-460)
// ===========================================================================
describe('_fitPageToBudget', () => {
    function buildFittedPage(opts: { clientHeight: number; scrollHeight: number }): { pageEl: HTMLElement; inner: HTMLElement } {
        const pageEl = document.createElement('div');
        Object.defineProperty(pageEl, 'clientHeight', { value: opts.clientHeight, configurable: true });
        const inner = document.createElement('div');
        inner.className = 'pdf-page-fit';
        Object.defineProperty(inner, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
        pageEl.appendChild(inner);
        document.body.appendChild(pageEl);
        return { pageEl, inner };
    }

    it('retourne false si pageEl est null (idempotent, aucun DOM à manipuler)', () => {
        expect(PDFEngineV2._fitPageToBudget(null, 0)).toBe(false);
    });

    it('crée le wrapper .pdf-page-fit et y déplace le contenu EN FLUX, en laissant les éléments position:absolute directement enfants de la page', () => {
        const pageEl = document.createElement('div');
        const flowChild = document.createElement('div');
        flowChild.textContent = 'contenu';
        const absChild = document.createElement('div');
        absChild.style.position = 'absolute';
        absChild.className = 'watermark';
        pageEl.appendChild(flowChild);
        pageEl.appendChild(absChild);
        document.body.appendChild(pageEl);

        PDFEngineV2._fitPageToBudget(pageEl, 0);

        const inner = pageEl.querySelector('.pdf-page-fit');
        expect(inner).not.toBeNull();
        expect(inner?.contains(flowChild)).toBe(true);
        expect(Array.from(pageEl.children)).toContain(absChild);
        expect(inner?.contains(absChild)).toBe(false);
    });

    it('ne réduit rien (retourne false, aucun transform) quand le contenu tient dans la hauteur disponible', () => {
        const { pageEl, inner } = buildFittedPage({ clientHeight: 200, scrollHeight: 150 });

        expect(PDFEngineV2._fitPageToBudget(pageEl, 0)).toBe(false);
        expect(inner.style.transform).toBe('');
    });

    it('applique scale = avail/needed (au-dessus de MIN_SCALE) en cas de débordement modéré', () => {
        const { pageEl, inner } = buildFittedPage({ clientHeight: 90, scrollHeight: 100 });

        expect(PDFEngineV2._fitPageToBudget(pageEl, 2)).toBe(true);
        expect(inner.style.transform).toBe('scale(0.9)');
    });

    it('clampe à MIN_SCALE (0.62) et journalise un avertissement en cas de débordement extrême', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { pageEl, inner } = buildFittedPage({ clientHeight: 50, scrollHeight: 500 });

        expect(PDFEngineV2._fitPageToBudget(pageEl, 4)).toBe(true);
        expect(inner.style.transform).toBe('scale(0.62)');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Page 5'));
    });

    it('est idempotent : un second appel sur la même page ne recrée pas de wrapper supplémentaire', () => {
        const { pageEl } = buildFittedPage({ clientHeight: 90, scrollHeight: 100 });

        PDFEngineV2._fitPageToBudget(pageEl, 0);
        PDFEngineV2._fitPageToBudget(pageEl, 0);

        expect(pageEl.querySelectorAll('.pdf-page-fit').length).toBe(1);
    });
});

// ===========================================================================
// downloadOiPdf (pdf_engine_v2.js:189-349)
// ===========================================================================
describe('downloadOiPdf', () => {
    beforeEach(() => {
        jsPdfInstances.length = 0;
        html2canvasMock.mockClear();
    });

    afterEach(() => {
        // Chaque test réimporte pdf-engine-v2.ts via loadPdfEngine() : sans ce
        // démontage, un vi.doMock('jspdf'/'html2canvas', ...) enregistré par un
        // test resterait actif pour le suivant (même précédent que
        // pm-capture.test.ts).
        vi.doUnmock('html2canvas');
        vi.doUnmock('jspdf');
    });

    it('génère OI_<date_op>_<trigramme>.pdf et appelle addImage/addPage le bon nombre de fois (1 par page, addPage sauf la 1re)', async () => {
        const engine = await loadPdfEngine(html2canvasMock, FakeJsPdf);
        // Fixture SANS PHOTO (cf. en-tête) : garde + environnement + mission +
        // exécution + articulation + patracdvr + fin = 7 pages.
        engine.Store.state.formData = {
            date_op: '2026-05-15',
            trigramme_redacteur: 'REF',
            patracdvr_rows: [makePatracRow()],
        };
        vi.spyOn(engine.dbManager, 'getItem').mockResolvedValue(undefined);

        await engine.PDFEngineV2.downloadOiPdf();

        expect(jsPdfInstances).toHaveLength(1);
        const doc = jsPdfInstances[0];
        if (!doc) throw new Error('aucune instance jsPDF créée');
        expect(doc.savedFileName).toBe('OI_2026-05-15_REF.pdf');
        expect(doc.addImageCalls).toHaveLength(7);
        expect(doc.addPageCalls).toBe(6);
        expect(html2canvasMock).toHaveBeenCalledTimes(7);
        expect(window.toast).toHaveBeenCalledWith('PDF généré avec succès !', 'success');
    });

    it('replie sur OI_SANS_DATE_RED.pdf quand date_op/trigramme_redacteur sont absents, et remplace les "/" du date_op par des "-"', async () => {
        const engineNoDate = await loadPdfEngine(html2canvasMock, FakeJsPdf);
        engineNoDate.Store.state.formData = {};
        vi.spyOn(engineNoDate.dbManager, 'getItem').mockResolvedValue(undefined);

        await engineNoDate.PDFEngineV2.downloadOiPdf();

        expect(jsPdfInstances).toHaveLength(1);
        expect(jsPdfInstances[0]?.savedFileName).toBe('OI_SANS_DATE_RED.pdf');

        const engineSlash = await loadPdfEngine(html2canvasMock, FakeJsPdf);
        engineSlash.Store.state.formData = { date_op: '15/05/2026', trigramme_redacteur: 'ABC' };
        vi.spyOn(engineSlash.dbManager, 'getItem').mockResolvedValue(undefined);

        await engineSlash.PDFEngineV2.downloadOiPdf();

        expect(jsPdfInstances).toHaveLength(2);
        expect(jsPdfInstances[1]?.savedFileName).toBe('OI_15-05-2026_ABC.pdf');
    });

    it('branche « librairie jsPDF absente » : message inchangé, aucune instance créée, toast générique', async () => {
        const engine = await loadPdfEngine(html2canvasMock, undefined);
        engine.Store.state.formData = {};
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await engine.PDFEngineV2.downloadOiPdf();

        expect(errorSpy).toHaveBeenCalledWith('❌ Librairie jsPDF non trouvée.');
        expect(errorSpy).toHaveBeenCalledWith('❌ [CRITICAL V4] PDF Engine Failed:', expect.any(Error));
        expect(window.toast).toHaveBeenCalledWith('Erreur de génération. Veuillez consulter les logs.', 'error');
        expect(jsPdfInstances).toHaveLength(0);
    });

    it('branche « librairie html2canvas absente » : message inchangé, aucun rendu de page', async () => {
        const engine = await loadPdfEngine(undefined, FakeJsPdf);
        engine.Store.state.formData = {};
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await engine.PDFEngineV2.downloadOiPdf();

        expect(errorSpy).toHaveBeenCalledWith('❌ Librairie html2canvas non trouvée.');
        expect(errorSpy).toHaveBeenCalledWith('❌ [CRITICAL V4] PDF Engine Failed:', expect.any(Error));
        expect(window.toast).toHaveBeenCalledWith('Erreur de génération. Veuillez consulter les logs.', 'error');
        expect(jsPdfInstances).toHaveLength(0);
    });
});
