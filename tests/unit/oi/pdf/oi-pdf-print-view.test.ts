/**
 * oi-pdf-print-view.test.ts — Tests unitaires de `print-style.ts`/`print-view.ts`
 * (SPEC-PDF-V3.md §2.1/§3.2/§5.3, paquet P5 « pdf-p5-print-view »).
 *
 * Fixture `makeRichFormData`/`makePatracRow` alignée sur celle de
 * `oi-pdf-engine-v2.test.ts` (même liste de 15 marqueurs, SPEC-PDF-V3.md §7)
 * pour vérifier que la voie B reproduit la MÊME structure/ordre que
 * `generateHTML` (voie « aperçu », inchangée).
 */
import { describe, expect, it, vi } from 'vitest';

import type {
    OiEffractionBlock,
    OiFormData,
    OiMoicpBlock,
    OiPatracRow,
    OiPdfCollectedData,
    OiZmspcpBlock,
} from '@shared/types/contracts.js';
import { esc, field, nl2br, printCss, section } from '@oi/pdf/print-style.js';
import { buildPrintDocument, printOiHighQuality } from '@oi/pdf/print-view.js';
import { PDF_DARK, PDF_LIGHT } from '@oi/pdf/theme.js';

// ---------------------------------------------------------------------------
// Fixtures (port du même motif que tests/unit/oi/oi-pdf-engine-v2.test.ts).
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

/** Fixture riche (sections 1 à 8) pour vérifier l'ORDRE des 15 marqueurs. */
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
        adversaries: [
            { id: 'adv1', nom_adversaire: 'DUPONT', me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] },
        ],
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

function makeData(formData: OiFormData): OiPdfCollectedData {
    return { formData, photosBase64: { logphoto: 'data:image/jpeg;base64,bG9n' }, isDark: false };
}

// Les 15 marqueurs imposés par SPEC-PDF-V3.md §7 (ordre imposé).
const MARKERS = [
    'ORDRE INITIAL',
    '1. SITUATION GLOBALE',
    'CIBLES(S)',
    '2.1 FICHE ADVERSAIRE',
    '3. ENVIRONNEMENT ET AMIS',
    "4. MISSION DE L'UNITÉ",
    '5. EXÉCUTION',
    '6. LOGISTIQUE & TRANSPORTS',
    '7. ARTICULATION & ORDRES DE MOUVEMENT',
    'Articulation : ZMSPCP',
    'Articulation : MOICP',
    'Articulation : EFFRACTION',
    '8. CONDUITES À TENIR GÉNÉRALES',
    '7. RÉCAPITULATIF PATRACDVR',
    'AVEZ-VOUS DES QUESTIONS ?',
];

// ===========================================================================
// printCss (OrderPdfStyle.kt:81-212)
// ===========================================================================
describe('printCss', () => {
    it('contient les sélecteurs clés du langage visuel strategica et les AJOUTS propres à notre structure', () => {
        const css = printCss(PDF_LIGHT, 12, true, '');
        const selectors = [
            '@page', '.row', '.col', '.patrac', '.photo-page-gallery', '.adv-page',
            '.fullpage', '.watermark', '.effrac-specs', '.cell-group', '.tool-badge',
            '.accent-card', '.danger-card', '.warning-card', '.pill',
        ];
        selectors.forEach((sel) => expect(css, `sélecteur manquant : ${sel}`).toContain(sel));
    });

    it('injecte fontFaces tel quel, en tête du <style>', () => {
        const marker = "@font-face{font-family:'Marqueur-Test-Unique';}";
        const css = printCss(PDF_LIGHT, 12, true, marker);
        expect(css).toContain(marker);
        expect(css.indexOf(marker)).toBeLessThan(css.indexOf('@page'));
    });

    it("@page vaut 'margin: 0' en thème sombre et '8mm 0 11mm 0' en thème clair (piège OrderPdfStyle.kt:84-95)", () => {
        const dark = printCss(PDF_DARK, 12, true, '');
        const light = printCss(PDF_LIGHT, 12, true, '');
        expect(dark).toMatch(/@page\s*\{\s*size:[^;]+;\s*margin:\s*0;/);
        expect(light).toMatch(/@page\s*\{\s*size:[^;]+;\s*margin:\s*8mm 0 11mm 0;/);
    });
});

// ===========================================================================
// esc / nl2br / field / section (OrderPdfStyle.kt:216-228)
// ===========================================================================
describe('esc / nl2br / field / section', () => {
    it('esc échappe & < > " (élargissement assumé par rapport à strategica)', () => {
        expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    });

    it('esc tolère null/undefined (chaîne vide)', () => {
        expect(esc(null)).toBe('');
        expect(esc(undefined)).toBe('');
    });

    it('nl2br échappe puis convertit les retours-ligne en <br/>', () => {
        expect(nl2br('a<b>\nc')).toBe('a&lt;b&gt;<br/>c');
    });

    it("field('x','') === '' (et toute valeur blanche)", () => {
        expect(field('x', '')).toBe('');
        expect(field('x', '   ')).toBe('');
        expect(field('x', null)).toBe('');
        expect(field('x', undefined)).toBe('');
    });

    it('field produit un paragraphe label/valeur sinon', () => {
        expect(field('Label', 'Valeur')).toBe('<p><strong>Label :</strong> Valeur</p>');
    });

    it('section pose un h2 puis le corps, sans échapper le titre', () => {
        expect(section('Titre & Cie', '<p>corps</p>')).toBe('<h2>Titre & Cie</h2><p>corps</p>');
    });
});

// ===========================================================================
// buildPrintDocument (pdf-engine-v2.ts:817-1294)
// ===========================================================================
describe('buildPrintDocument', () => {
    it('produit les 15 marqueurs de la spec dans un ordre strictement croissant', () => {
        const html = buildPrintDocument(makeData(makeRichFormData()), { format: 'a4' });

        const indices = MARKERS.map((m) => html.indexOf(m));
        indices.forEach((idx, i) => expect(idx, `marqueur introuvable : ${MARKERS[i]}`).toBeGreaterThanOrEqual(0));
        for (let i = 1; i < indices.length; i++) {
            expect(indices[i], `« ${MARKERS[i]} » doit venir après « ${MARKERS[i - 1]} »`).toBeGreaterThan(
                indices[i - 1] as number,
            );
        }
    });

    it('exactement 2 titres distincts commençant par "7. " (défaut hérité reproduit tel quel, assertion A4)', () => {
        const html = buildPrintDocument(makeData(makeRichFormData()), { format: 'a4' });
        expect((html.match(/>7\. /g) ?? []).length).toBe(2);
    });

    it('commence par <!DOCTYPE html> et contient <style>', () => {
        const html = buildPrintDocument(makeData(makeRichFormData()), { format: 'a4' });
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(html).toContain('<style>');
    });

    it('sans cat_generales/no_go/cat_liaison, "8. CONDUITES À TENIR GÉNÉRALES" est omise', () => {
        const formData = makeRichFormData();
        delete formData.cat_generales;
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });
        expect(html).not.toContain('8. CONDUITES À TENIR GÉNÉRALES');
    });

    it("sans aucun adversaire, CIBLES(S) affiche le repli et aucune fiche 2.x n'apparaît", () => {
        const html = buildPrintDocument(makeData({}), { format: 'a4' });
        expect(html).toContain('Aucune cible renseignée.');
        expect(html).not.toContain('FICHE ADVERSAIRE');
    });

    it('sans membre PATRACDVR, "7. RÉCAPITULATIF PATRACDVR" est omise', () => {
        const formData = makeRichFormData();
        delete formData.patracdvr_rows;
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });
        expect(html).not.toContain('7. RÉCAPITULATIF PATRACDVR');
    });

    it('ÉCHAPPEMENT : une valeur de Store contenant <script>alert(1)</script> et des guillemets ressort échappée', () => {
        const formData = makeRichFormData();
        formData.situation_generale = '<script>alert(1)</script> "citation"';
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });

        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&quot;citation&quot;');
        expect(html).not.toContain('<script>alert(1)</script>');
    });
});

// ===========================================================================
// printOiHighQuality (SPEC-PDF-V3.md §5.3)
// ===========================================================================
describe('printOiHighQuality', () => {
    it("crée l'iframe, appelle print() une fois avec la Window de l'iframe, et la retire après afterprint", async () => {
        const collect = vi.fn(
            async (): Promise<OiPdfCollectedData> => ({ formData: {}, photosBase64: {}, isDark: false }),
        );
        const printSpy = vi.fn();

        const promise = printOiHighQuality({ collect, print: printSpy });

        // Laisse le micro-tâche `await collect()` s'écouler avant que l'iframe
        // ne soit créée et attachée au DOM (même motif que oi-store.test.ts:283-284).
        await Promise.resolve();
        await Promise.resolve();

        // jsdom ne « navigue » pas réellement via `srcdoc` : on simule l'événement
        // 'load' de l'iframe une fois qu'elle a été créée et attachée au DOM.
        const iframe = document.querySelector('iframe');
        expect(iframe).not.toBeNull();
        iframe?.dispatchEvent(new Event('load'));

        await promise;

        expect(collect).toHaveBeenCalledTimes(1);
        expect(printSpy).toHaveBeenCalledTimes(1);
        const calledWith = printSpy.mock.calls[0]?.[0] as Window | undefined;
        expect(calledWith).toBe(iframe?.contentWindow);
        expect(document.body.contains(iframe)).toBe(true);

        iframe?.contentWindow?.dispatchEvent(new Event('afterprint'));
        expect(document.body.contains(iframe)).toBe(false);
    });
});
