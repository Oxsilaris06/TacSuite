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
 * `window.toast` : stub `vi.fn()`, même précédent que `oi-medias.test.ts`.
 *
 * PDF.INTEG (SPEC-PDF-V3.md §4) : `downloadOiPdf()` (html2canvas + jsPDF,
 * ancien `pdf_engine_v2.js:189-349`) a été RETIRÉE de `pdf-engine-v2.ts` — le
 * describe `downloadOiPdf` correspondant, ainsi que le mocking html2canvas/
 * jsPDF dédié (`loadPdfEngine()`), sont SUPPRIMÉS de ce fichier. Ces tests
 * sont RÉORIENTÉS vers `tests/unit/oi/pdf/oi-pdf-engine-v3.test.ts` (describe
 * `downloadOiPdfV3`, moteur vectoriel pdfmake, `@oi/pdf/engine-v3.js`).
 * `generateHTML`/`_fitPageToBudget` restent testés ICI, INCHANGÉS : ils
 * continuent de servir l'aperçu HTML in-app (`openPreview`) et le mode
 * « Présenter ici » (`openPresentInPlace`), qui ne rastérisent jamais.
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
 *  (d)/(e) anciennement downloadOiPdf() (nom de fichier + repli SANS_DATE/RED
 *      + branches « librairie absente ») : voir désormais le describe
 *      `downloadOiPdfV3` de `tests/unit/oi/pdf/oi-pdf-engine-v3.test.ts`.
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
