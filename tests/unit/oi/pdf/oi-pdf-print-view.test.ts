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
// SCISSION PILOTÉE + police adaptative ZMSPCP/MOICP/EFFRACTION
// (mission BLIND.B, arbitrages 1/4, matrice-rupture.md §1).
// ===========================================================================
describe('scission pilotée + police adaptative (blocs à risque ZMSPCP/MOICP/EFFRACTION)', () => {
    /** Génère un texte "- item N : ..." de N lignes, mêmes frontières légitimes
     * que les fixtures de stress de l'audit (`cat-lines-120.json`). */
    function dashItems(count: number): string {
        return Array.from(
            { length: count },
            (_, i) => `- Mesure operationnelle numero ${i + 1} : consigne detaillee a appliquer sur zone.`,
        ).join('\n');
    }

    function makeZmspcpFormData(catLines: number): OiFormData {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            {
                id: 'z1',
                title: 'GROUPE ALPHA',
                zone: 'Zone test',
                mission: 'Mission test',
                secteur: 'Secteur test',
                points_particuliers: 'Points test',
                cat: dashItems(catLines),
                place_chef: 'Chef test',
                members: [],
            },
        ];
        return { zmspcp_blocks: zmspcpBlocks };
    }

    it('un bloc ZMSPCP à conduite à tenir courte reste sur UNE seule page, sans "(SUITE)"', () => {
        const html = buildPrintDocument(makeData(makeZmspcpFormData(3)), { format: 'a4' });
        expect(html).toContain('Articulation : ZMSPCP - GROUPE ALPHA');
        expect(html).not.toContain('Articulation : ZMSPCP - GROUPE ALPHA (SUITE)');
        expect(html).toContain('Mesure operationnelle numero 3');
    });

    it('un bloc ZMSPCP à conduite à tenir volumineuse (120 items) SCINDE avec titre "(SUITE)", ZÉRO perte de données', () => {
        const html = buildPrintDocument(makeData(makeZmspcpFormData(120)), { format: 'a4' });
        expect(html).toContain('Articulation : ZMSPCP - GROUPE ALPHA (SUITE)');
        // Aucune donnée perdue : les 120 items sont TOUS présents (première ET
        // dernière frontière), contrairement à la voie A qui les supprime
        // silencieusement au-delà d'un certain volume (matrice-rupture.md §2/§3).
        expect(html).toContain('Mesure operationnelle numero 1 ');
        expect(html).toContain('Mesure operationnelle numero 120');
        // Chaque fragment scindé est un `.adv-page` isolé (jamais de perte
        // possible même si un fragment déborde encore sa propre page).
        expect((html.match(/class="adv-page"/g) ?? []).length).toBeGreaterThan(1);
    });

    it('sans frontière légitime (aucun tiret), le texte reste INTACT, jamais scindé', () => {
        const formData = makeZmspcpFormData(0);
        formData.zmspcp_blocks![0]!.cat = 'Un unique paragraphe sans tiret, aussi long soit-il, jamais scindé.';
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });
        expect(html).not.toContain('(SUITE)');
        expect(html).toContain('Un unique paragraphe sans tiret, aussi long soit-il, jamais scindé.');
    });

    it('la police adaptative ZMSPCP suit le barème adaptivePagePx (volume faible -> 14px, volume élevé -> palier réduit)', () => {
        const low = buildPrintDocument(makeData(makeZmspcpFormData(1)), { format: 'a4' });
        const high = buildPrintDocument(makeData(makeZmspcpFormData(120)), { format: 'a4' });
        expect(low).toMatch(/Articulation : ZMSPCP - GROUPE ALPHA<\/h2>/);
        const lowFontMatch = /<div class="adv-page" style="font-size:(\d+)px;"><h2>Articulation : ZMSPCP/.exec(low);
        const highFontMatch = /<div class="adv-page" style="font-size:(\d+)px;"><h2>Articulation : ZMSPCP/.exec(high);
        expect(lowFontMatch).not.toBeNull();
        expect(highFontMatch).not.toBeNull();
        expect(Number(highFontMatch?.[1])).toBeLessThan(Number(lowFontMatch?.[1]));
    });

    it('la police adaptative EFFRACTION (effracFontPx transposé) réagit au volume cumulé mission+hypothèses', () => {
        const manyHyp: OiEffractionBlock = {
            id: 'e1',
            title: 'PORTE CHARLIE',
            mission: 'Mission effraction longue et détaillée '.repeat(10),
            porte: '-',
            structure: '-',
            serrurerie: '-',
            environnement: '-',
            bati_a_bati: '-',
            dormant_a_dormant: '-',
            prof_linteaux: '-',
            prof_bati: '-',
            h_porte: '-',
            h_marche: '-',
            prof_marche: '-',
            prof_moulure: '-',
            members: [],
            hypotheses: Array.from({ length: 12 }, (_, i) => ({
                id: `he${i}`,
                title: `Hypothèse ${i + 1}`,
                desc: 'Description longue de l\'hypothèse '.repeat(5),
                effrac: 'Technique',
                degag: 'Dégagement',
                assaut: 'Assaut',
            })),
        };
        const html = buildPrintDocument(makeData({ effraction_blocks: [manyHyp] }), { format: 'a4' });
        const match = /Articulation : EFFRACTION - PORTE CHARLIE<\/h2>/.exec(html);
        expect(match).not.toBeNull();
        const openTag = html.slice(0, match?.index).lastIndexOf('<div class="adv-page"');
        expect(html.slice(openTag, openTag + 60)).toContain('font-size:9px');
    });
});

// ===========================================================================
// CHAMPS FANTÔMES effraction (mission BLIND.B §3, champs-fantomes.md)
// ===========================================================================
describe('champs fantômes effraction (mission/porte/prof_marche/prof_moulure/hypotheses[].desc)', () => {
    function makeEffracFormData(): { formData: OiFormData; block: OiEffractionBlock } {
        const block: OiEffractionBlock = {
            id: 'e1',
            title: 'PORTE CHARLIE',
            mission: 'FRANCHISSEMENT DE LA PORTE PRINCIPALE.',
            porte: 'Porte blindée',
            structure: 'Béton',
            serrurerie: 'Multipoints',
            environnement: 'Urbain',
            bati_a_bati: '90',
            dormant_a_dormant: '85',
            prof_linteaux: '15',
            prof_bati: '20',
            h_porte: '210',
            h_marche: '18',
            prof_marche: '30',
            prof_moulure: '5',
            members: [],
            hypotheses: [
                { id: 'he1', title: 'Hypothèse A', desc: 'Description tactique détaillée A.', effrac: 'E', degag: 'D', assaut: 'A' },
            ],
        };
        return { formData: { effraction_blocks: [block] }, block };
    }

    it('rend mission/porte/prof_marche/prof_moulure (5 champs fantômes -1, desc traité séparément)', () => {
        const { formData } = makeEffracFormData();
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });
        expect(html).toContain('Mission :</strong> FRANCHISSEMENT DE LA PORTE PRINCIPALE.');
        expect(html).toContain('Type de Porte</span> Porte blindée');
        expect(html).toContain('Prof. Marche</span> 30');
        expect(html).toContain('Prof. Moulure</span> 5');
    });

    it('hypotheses[].desc est rendu en BLOC TEXTE SOUS le tableau (dérogation anti-débordement), jamais dans une cellule de table', () => {
        const { formData } = makeEffracFormData();
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });
        expect(html).toContain('Description des Hypothèses');
        expect(html).toContain('Description tactique détaillée A.');
        // La cellule "Hypothèse" de la table ne contient QUE le titre, pas desc.
        const tableIdx = html.indexOf('Hypothèses d\'Effraction');
        const descBlockIdx = html.indexOf('Description des Hypothèses');
        expect(descBlockIdx).toBeGreaterThan(tableIdx);
        const tableSlice = html.slice(tableIdx, descBlockIdx);
        expect(tableSlice).not.toContain('Description tactique détaillée A.');
    });

    it('sans aucune hypothèse desc renseignée, le bloc "Description des Hypothèses" est omis', () => {
        const { formData, block } = makeEffracFormData();
        block.hypotheses[0]!.desc = '';
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });
        expect(html).not.toContain('Description des Hypothèses');
    });
});

// ===========================================================================
// VOIEB.FIX — placement du bloc « Description des Hypothèses » (motif
// D2-équivalent, thème CLAIR uniquement, cf. JSDoc des constantes
// `DESC_FIT_SAFETY_PX`/`PAGE_VERTICAL_LOSS_MM` de print-view.ts). Fixture
// ANONYMISÉE à métriques identiques à la fixture réelle du banc (mêmes
// longueurs de champs, mêmes retours-ligne, photo de porte présente) : la
// page effraction est alors PRESQUE pleine — le bloc desc tient encore dans
// les 202 mm utiles du thème sombre mais déborde des 191 mm du clair.
// ===========================================================================
describe('placement du bloc desc effraction (asymétrie clair/sombre)', () => {
    function makeNearFullEffrac(): OiFormData {
        const block: OiEffracShim = {
            id: 'e1',
            title: 'PORTE TEST',
            mission:
                'APPUYER LA CELLULE DE FRANCHISSEMENT\n' +
                "L'objectif premier de la cellule est d'effectuer une ouverture rapide et securisee de la porte principale facade NORD " +
                'afin de permettre la progression fluide du groupe de tete. En mesure de se rearticuler sur ordre.',
            porte: 'Porte PVC',
            structure: '/',
            serrurerie: '/',
            environnement: '', bati_a_bati: '', dormant_a_dormant: '', prof_linteaux: '', prof_bati: '',
            h_porte: '', h_marche: '', prof_marche: '', prof_moulure: '',
            members: [],
            hypotheses: [
                {
                    id: 'he0',
                    title: 'Hypothèse 1',
                    desc: 'Controle du palier si besoin\nTest porte NORD 1\nSi ferme : ouverture manuelle aux outils (OutilUn / OutilDeux)',
                    effrac: 'AAA : OutilUn\nBBB : OutilDeux',
                    degag: 'Repli en arriere de la cellule effrac',
                    assaut: 'Entree NORD puis ouverture',
                },
                {
                    id: 'he1',
                    title: 'Hypothèse 2',
                    desc: 'Echec ouverture manuelle',
                    effrac: 'Si echec ouverture manuelle\nAAA : OutilUn\nBBB : Masse lourde',
                    degag: 'Repli en arriere de la cellule effrac',
                    assaut: 'Entree NORD puis ouverture',
                },
            ],
        };
        return {
            effraction_blocks: [block],
            dynamic_photos: {
                photo_effrac_e1: [{ id: 'ph1', annotations: '[]', tools: '["OutilUn","Masse lourde"]', other_tools: '', customTitle: '' }],
            },
        };
    }
    type OiEffracShim = OiEffractionBlock;
    const photos = { logphoto: 'data:image/jpeg;base64,bG9n', ph1: 'data:image/png;base64,cG9ydGU=' };

    it('thème CLAIR (191 mm utiles) : le bloc desc part sur sa PROPRE page titrée "(SUITE)", jamais en page nue', () => {
        const html = buildPrintDocument({ formData: makeNearFullEffrac(), photosBase64: photos, isDark: false }, { format: 'a4' });
        expect(html).toContain('<h2>Articulation : EFFRACTION - PORTE TEST (SUITE)</h2>');
        // Le bloc desc est APRÈS le titre (SUITE), pas sur la 1re page du bloc.
        const suiteIdx = html.indexOf('Articulation : EFFRACTION - PORTE TEST (SUITE)');
        const descIdx = html.indexOf('Description des Hypothèses');
        expect(descIdx).toBeGreaterThan(suiteIdx);
        // Zéro perte de données.
        expect(html).toContain('Controle du palier si besoin');
        expect(html).toContain('Echec ouverture manuelle');
    });

    it('thème SOMBRE (202 mm utiles) : le MÊME contenu garde le bloc desc sur la page du tableau, sans "(SUITE)"', () => {
        const html = buildPrintDocument({ formData: makeNearFullEffrac(), photosBase64: photos, isDark: true }, { format: 'a4' });
        expect(html).not.toContain('PORTE TEST (SUITE)');
        expect(html).toContain('Description des Hypothèses');
        expect(html).toContain('Controle du palier si besoin');
    });

    it('bloc effraction court (sans photo, desc bref) : jamais de page desc séparée, quel que soit le thème', () => {
        const formData: OiFormData = {
            effraction_blocks: [
                {
                    id: 'e1', title: 'PORTE COURTE', mission: 'Mission breve.', porte: 'Bois',
                    structure: '', serrurerie: '', environnement: '', bati_a_bati: '', dormant_a_dormant: '',
                    prof_linteaux: '', prof_bati: '', h_porte: '', h_marche: '', prof_marche: '', prof_moulure: '',
                    members: [],
                    hypotheses: [{ id: 'h1', title: 'Hypothèse 1', desc: 'Courte.', effrac: 'E', degag: 'D', assaut: 'A' }],
                },
            ],
        };
        for (const isDark of [false, true]) {
            const html = buildPrintDocument({ formData, photosBase64: photos, isDark }, { format: 'a4' });
            expect(html).not.toContain('PORTE COURTE (SUITE)');
            expect(html).toContain('Description des Hypothèses');
        }
    });
});

// ===========================================================================
// Durcissement défensif print-style.ts (SPEC-PDF-DEFINITIF.md §8.2) —
// présence des règles `break-*` MODERNES en complément des `page-break-*`.
// ===========================================================================
describe('durcissement défensif §8.2 (syntaxe break-* moderne)', () => {
    it.each([['clair', PDF_LIGHT], ['sombre', PDF_DARK]] as const)('printCss (%s) contient les 3 règles §8.2', (_label, p) => {
        const css = printCss(p, 12, true, '');
        expect(css).toContain('h2, h3 { break-after: avoid; }');
        expect(css).toContain('.adv-page .box, .accent-card { break-inside: avoid; }');
        expect(css).toContain('.hyp-table thead { break-inside: avoid; }');
        expect(css).toContain('.hyp-table thead + tbody tr:first-child { break-before: avoid; }');
    });

    it('le tableau Hypothèses d\'Effraction porte la classe hyp-table (cible des règles §8.2)', () => {
        const { formData } = makeEffracFormDataForClass();
        const html = buildPrintDocument(makeData(formData), { format: 'a4' });
        expect(html).toContain('<table class="hyp-table">');
    });

    function makeEffracFormDataForClass(): { formData: OiFormData } {
        return {
            formData: {
                effraction_blocks: [
                    {
                        id: 'e1', title: 'PORTE', mission: '-', porte: '-', structure: '-', serrurerie: '-',
                        environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-', prof_bati: '-',
                        h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-', members: [],
                        hypotheses: [{ id: 'h1', title: 'H1', desc: '', effrac: 'E', degag: 'D', assaut: 'A' }],
                    },
                ],
            },
        };
    }
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
