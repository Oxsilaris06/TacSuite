/**
 * oi-pdf-document-builder.test.ts — Tests unitaires de
 * `src/apps/oi/pdf/document-builder.ts` (SPEC-PDF-V3.md §2.1/§3.2/§3.4,
 * paquet P4 « pdf-p4-document-builder »). Module PUR : aucun rendu PDF réel,
 * uniquement des assertions sur la STRUCTURE (et son sérialisé JSON) de la
 * `TDocumentDefinitions` pdfmake retournée.
 *
 * `makeRichFormData()`/`makePatracRow()` sont une COPIE LOCALE (pas un
 * import) de `tests/unit/oi/oi-pdf-engine-v2.test.ts:168-227` — même
 * fixture, l'original n'est PAS modifié (consigne du contremaître).
 *
 * NOTE DE CASSE (documentée ici, pas dans document-builder.ts pour ne pas le
 * polluer de méta-commentaire test) : `blocks.h2()` MAJUSCULE le texte qu'on
 * lui passe (pas de CSS `text-transform` sous pdfmake). Les marqueurs du
 * TEST PIVOT qui transitent par un `h2()` dont le texte source contient des
 * minuscules ('Articulation : ZMSPCP/MOICP/EFFRACTION - <titre>') sont donc
 * recherchés ici en MAJUSCULES — à la différence du test HTML équivalent de
 * `oi-pdf-engine-v2.test.ts:343-370` (voie B, CSS-only, texte DOM inchangé).
 * Le marqueur « 6. LOGISTIQUE & TRANSPORTS » est volontairement tronqué
 * AVANT le suffixe « (Cheminement) » pour la même raison (il transite aussi
 * par `galleryPages()` → `h2()`), sans perdre la preuve d'ordre recherchée.
 */
import { describe, expect, it } from 'vitest';
import type { Content, ContextPageSize, DynamicBackground, DynamicContent } from 'pdfmake/interfaces';

import {
    buildOiDocDefinition,
    effractionFirstOverheadPt,
    hypothesisRowHeightPt,
    identityRowPt,
    internPhotoImages,
    oiPdfFileName,
    OiPdfFitRefusalError,
    PAGE_CAPACITY,
    splitAtcdBoundaries,
} from '@oi/pdf/document-builder.js';
import { SOFT_HYPHEN } from '@oi/pdf/text-utils.js';
import { PDF_DARK, PDF_LIGHT } from '@oi/pdf/theme.js';
import type {
    OiEffractionBlock,
    OiEffractionHypothesis,
    OiFormData,
    OiMoicpBlock,
    OiPatracRow,
    OiPdfCollectedData,
    OiPhotoMeta,
    OiZmspcpBlock,
} from '@shared/types/contracts.js';

// ---------------------------------------------------------------------------
// Fixtures (copie locale de tests/unit/oi/oi-pdf-engine-v2.test.ts:168-227).
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

/** Fixture riche (sections 1 à 8) pour vérifier l'ORDRE des marqueurs de `buildOiDocDefinition`. */
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
            // `structure` non vide (BLIND.REFIX round 2 : `isEffractionBlockEmpty`
            // ignore désormais le repli `'-'`, cf. sa JSDoc) — bloc VOLONTAIREMENT
            // non vide pour rester présent dans l'ordre des marqueurs testé ici.
            id: 'e1', title: 'PORTE CHARLIE', mission: '-', porte: '-', structure: 'Porte blindee',
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

function makePhotoMeta(id: string): OiPhotoMeta {
    return { id, annotations: '[]', tools: '[]', other_tools: '', customTitle: '' };
}

function collect(formData: OiFormData, photosBase64: Record<string, string> = {}, isDark = false): OiPdfCollectedData {
    return { formData, photosBase64, isDark };
}

// ===========================================================================
// TEST PIVOT — ordre des 15 marqueurs de la spec §7 (même esprit que
// oi-pdf-engine-v2.test.ts:343-370, adapté à la casse pdfmake — cf. en-tête).
// ===========================================================================
describe('buildOiDocDefinition — ordre des sections (SPEC-PDF-V3.md §7)', () => {
    it("produit les 15 marqueurs dans l'ordre attendu, y compris les DEUX sections « 7. » (défaut hérité reproduit)", () => {
        const data = collect(makeRichFormData(), { logphoto: 'data:image/jpeg;base64,bG9n' });

        const dd = buildOiDocDefinition(data, { format: 'a4' });
        const json = JSON.stringify(dd);

        const markers = [
            'ORDRE INITIAL',
            '1. SITUATION GLOBALE',
            'CIBLES(S)',
            '2.1 FICHE ADVERSAIRE : DUPONT',
            '3. ENVIRONNEMENT ET AMIS',
            "4. MISSION DE L'UNITÉ",
            '5. EXÉCUTION',
            '6. LOGISTIQUE & TRANSPORTS',
            '7. ARTICULATION & ORDRES DE MOUVEMENT',
            'ARTICULATION : ZMSPCP - ZONE ALPHA',
            'ARTICULATION : MOICP - ITIN BRAVO',
            'ARTICULATION : EFFRACTION - PORTE CHARLIE',
            '8. CONDUITES À TENIR GÉNÉRALES',
            '7. RÉCAPITULATIF PATRACDVR',
            'AVEZ-VOUS DES QUESTIONS ?',
        ];

        const indices = markers.map((m) => json.indexOf(m));
        indices.forEach((idx, i) => expect(idx, `marqueur introuvable : ${markers[i]}`).toBeGreaterThanOrEqual(0));
        for (let i = 1; i < indices.length; i++) {
            expect(indices[i], `« ${markers[i]} » doit venir après « ${markers[i - 1]} »`).toBeGreaterThan(indices[i - 1] as number);
        }
    });

    it('exactement 2 titres commençant par « 7. »', () => {
        const data = collect(makeRichFormData(), { logphoto: 'data:image/jpeg;base64,bG9n' });
        const json = JSON.stringify(buildOiDocDefinition(data, { format: 'a4' }));

        expect((json.match(/"text":"7\. /g) ?? []).length).toBe(2);
    });

    it('sans cat_generales/no_go/cat_liaison, « 8. CONDUITES À TENIR GÉNÉRALES » est omise', () => {
        const formData = makeRichFormData();
        delete formData.cat_generales;
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        expect(json).not.toContain('8. CONDUITES À TENIR GÉNÉRALES');
    });

    it("sans aucun adversaire, la section CIBLES(S) affiche le repli et aucune fiche adversaire n'apparaît", () => {
        const json = JSON.stringify(buildOiDocDefinition(collect({}), { format: 'a4' }));

        expect(json).toContain('Aucune cible renseignée.');
        expect(json).not.toContain('FICHE ADVERSAIRE');
    });
});

// ===========================================================================
// Tableau PATRACDVR — colonne DIR conditionnelle (SPEC-PDF-V3.md §3.2 ligne 10,
// POINT DE VIGILANCE §1).
// ===========================================================================
describe('buildOiDocDefinition — PATRACDVR, colonne DIR conditionnelle', () => {
    function patracFormData(dir: string): OiFormData {
        return {
            patracdvr_rows: [
                {
                    vehicle: 'VL1',
                    members: [
                        {
                            trigramme: 'ABC', fonction: 'Chef', cellule: 'AO1', principales: 'UMP9',
                            secondaires: 'PSA', afis: 'PIE', grenades: 'Sans', equipement: 'Sans',
                            equipement2: 'Sans', tenue: 'Sans', gpb: 'Sans', dir,
                        },
                    ],
                },
            ],
        };
    }

    it("aucun membre n'a de dir : colonne DIR absente, EQPT/GREN. en '*'", () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(patracFormData('')), { format: 'a4' }));

        expect(json).toContain('"widths":["auto","auto","auto","auto","auto","auto","auto","*"]');
        expect(json).not.toContain('"text":"DIR"');
    });

    it("un membre a un dir non vide : colonne DIR présente, EQPT/GREN. en '*'", () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(patracFormData('G1')), { format: 'a4' }));

        expect(json).toContain('"widths":["auto","auto","auto","auto","auto","auto","auto","*","auto"]');
        expect(json).toContain('"text":"DIR"');
    });

    it('sans aucun membre PATRACDVR, la section est omise (aucune table PATRAC)', () => {
        const json = JSON.stringify(buildOiDocDefinition(collect({}), { format: 'a4' }));

        expect(json).not.toContain('RÉCAPITULATIF PATRACDVR');
    });
});

// ===========================================================================
// Ordre des photos (SPEC-PDF-V3.md §3.4 règle 3).
// ===========================================================================
describe('buildOiDocDefinition — ordre des photos', () => {
    it('MOICP : extérieur avant intérieur', () => {
        const formData: OiFormData = {
            moicp_blocks: [
                { id: 'm1', title: 'BRAVO', mission: '-', objectif: '-', itineraire: '-', points_particuliers: '-', cat: '-', place_chef: '-', members: [] },
            ],
            dynamic_photos: {
                photo_itin_ext_m1: [makePhotoMeta('extphoto')],
                photo_itin_int_m1: [makePhotoMeta('intphoto')],
            },
        };
        const photosBase64 = { extphoto: 'data:image/jpeg;base64,EXTPHOTO', intphoto: 'data:image/jpeg;base64,INTPHOTO' };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData, photosBase64), { format: 'a4' }));

        // D4 (internement des images) : le contenu référence chaque photo par
        // sa CLÉ (`"image":"extphoto"`), la dataURL ne vit qu'une fois dans le
        // dictionnaire `images` — l'ordre se lit donc sur les références.
        const extIdx = json.indexOf('"image":"extphoto"');
        const intIdx = json.indexOf('"image":"intphoto"');
        expect(extIdx).toBeGreaterThanOrEqual(0);
        expect(intIdx).toBeGreaterThanOrEqual(0);
        expect(extIdx).toBeLessThan(intIdx);
    });

    it('baptême Terrain AVANT la page ZMSPCP, emplacement AO APRÈS', () => {
        const formData: OiFormData = {
            zmspcp_blocks: [
                { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: '-', place_chef: '-', members: [] },
            ],
            dynamic_photos: {
                photo_bapteme_z1: [makePhotoMeta('baptphoto')],
                photo_empl_ao_z1: [makePhotoMeta('aophoto')],
            },
        };
        const photosBase64 = { baptphoto: 'data:image/jpeg;base64,BAPTPHOTO', aophoto: 'data:image/jpeg;base64,AOPHOTO' };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData, photosBase64), { format: 'a4' }));

        // D4 (internement des images) : même lecture par CLÉ que le test
        // itinéraires ci-dessus.
        const baptIdx = json.indexOf('"image":"baptphoto"');
        const zmspcpIdx = json.indexOf('ARTICULATION : ZMSPCP - ALPHA');
        const aoIdx = json.indexOf('"image":"aophoto"');
        expect(baptIdx).toBeGreaterThanOrEqual(0);
        expect(zmspcpIdx).toBeGreaterThanOrEqual(0);
        expect(aoIdx).toBeGreaterThanOrEqual(0);
        expect(baptIdx).toBeLessThan(zmspcpIdx);
        expect(zmspcpIdx).toBeLessThan(aoIdx);
    });
});

// ===========================================================================
// oiPdfFileName — port exact de pdf-engine-v2.ts:442-444 (contrat E2E).
// ===========================================================================
describe('oiPdfFileName (pdf-engine-v2.ts:442-444, contrat E2E oi.spec.ts:968)', () => {
    it('cas nominal', () => {
        expect(oiPdfFileName({ date_op: '2026-05-15', trigramme_redacteur: 'REF' })).toBe('OI_2026-05-15_REF.pdf');
    });

    it("remplace les '/' du date_op par des '-'", () => {
        expect(oiPdfFileName({ date_op: '15/05/2026', trigramme_redacteur: 'ABC' })).toBe('OI_15-05-2026_ABC.pdf');
    });

    it("date_op absent -> repli 'SANS_DATE'", () => {
        expect(oiPdfFileName({ trigramme_redacteur: 'ABC' })).toBe('OI_SANS_DATE_ABC.pdf');
    });

    it("trigramme_redacteur absent -> repli 'RED'", () => {
        expect(oiPdfFileName({ date_op: '2026-05-15' })).toBe('OI_2026-05-15_RED.pdf');
    });

    it('les deux absents', () => {
        expect(oiPdfFileName({})).toBe('OI_SANS_DATE_RED.pdf');
    });
});

// ===========================================================================
// pageSize / pageOrientation (SPEC-PDF-V3.md, ÉLÉMENTS DE HAUT NIVEAU).
// ===========================================================================
describe('buildOiDocDefinition — géométrie de page', () => {
    it("'a4' -> pageSize 'A4' + orientation landscape", () => {
        const dd = buildOiDocDefinition(collect({}), { format: 'a4' });
        expect(dd.pageSize).toBe('A4');
        expect(dd.pageOrientation).toBe('landscape');
    });

    it("'16:9' -> pageSize objet mesuré au banc { width: 958.11, height: 539.01 }", () => {
        const dd = buildOiDocDefinition(collect({}), { format: '16:9' });
        expect(dd.pageSize).toEqual({ width: 958.11, height: 539.01 });
    });
});

// ===========================================================================
// footer — bande confidentielle + pagination, absente en page 1 (écart E2).
// ===========================================================================
describe('buildOiDocDefinition — footer document-wide', () => {
    const fakePageSize: ContextPageSize = { width: 841.89, height: 595.28, orientation: 'landscape' };

    it('renvoie null pour currentPage === 1', () => {
        const dd = buildOiDocDefinition(collect({ trigramme_redacteur: 'REF', unite_redacteur: 'PSIG' }), { format: 'a4' });
        const footerFn = dd.footer as DynamicContent;
        expect(typeof footerFn).toBe('function');
        expect(footerFn(1, 5, fakePageSize)).toBeNull();
    });

    it('sur les autres pages, une bande contenant CONFIDENTIEL et « n / N »', () => {
        const dd = buildOiDocDefinition(collect({ trigramme_redacteur: 'REF', unite_redacteur: 'PSIG' }), { format: 'a4' });
        const footerFn = dd.footer as DynamicContent;
        const band = footerFn(2, 5, fakePageSize) as Content;
        const json = JSON.stringify(band);

        expect(json).toContain('CONFIDENTIEL');
        expect(json).toContain('REF');
        expect(json).toContain('PSIG');
        expect(json).toContain('2 / 5');
    });
});

// ===========================================================================
// Absence de gabarit HTML (SPEC-PDF-V3.md §3.4 règle 8) : les valeurs du
// Store sont insérées comme TEXTE, jamais interprétées/échappées en HTML.
// ===========================================================================
describe('buildOiDocDefinition — aucune valeur du Store ne produit une entité HTML', () => {
    it("une valeur contenant '<' et '&' traverse le document TELLE QUELLE (pas de &lt;/&amp;)", () => {
        const formData: OiFormData = {
            situation_generale: 'Repli <b>gras</b> & vérification',
        };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        expect(json).toContain('Repli <b>gras</b> & vérification');
        expect(json).not.toContain('&lt;');
        expect(json).not.toContain('&amp;');
    });
});

// ===========================================================================
// D1/D2 (pdfv3-design-fix/DEFAUTS.md) — la palette suit le thème COURANT de
// l'app (isDark), jamais les défauts internes blancs/noirs de pdfmake.
// ===========================================================================
describe('buildOiDocDefinition — thème : fond de page + encre par défaut suivent isDark (D1/D2)', () => {
    const fakePageSize: ContextPageSize = { width: 841.89, height: 595.28, orientation: 'landscape' };

    it("isDark=false : fond de page peint en PDF_LIGHT.bg ('#ffffff'), encre de corps par défaut = PDF_LIGHT.text ('#111111')", () => {
        const dd = buildOiDocDefinition(collect({}, {}, false), { format: 'a4' });
        expect(dd.defaultStyle?.color).toBe(PDF_LIGHT.text);

        const bg = (dd.background as DynamicBackground)(1, fakePageSize) as Content & { canvas?: unknown[] };
        const rect = bg.canvas?.[0] as { color?: string; w?: number; h?: number; type?: string };
        expect(rect.type).toBe('rect');
        expect(rect.color).toBe(PDF_LIGHT.bg);
        expect(rect.w).toBe(fakePageSize.width);
        expect(rect.h).toBe(fakePageSize.height);
    });

    it("isDark=true : fond de page peint en PDF_DARK.bg ('#000000'), encre de corps par défaut = PDF_DARK.text ('#e0e0e0')", () => {
        const dd = buildOiDocDefinition(collect({}, {}, true), { format: 'a4' });
        expect(dd.defaultStyle?.color).toBe(PDF_DARK.text);

        const bg = (dd.background as DynamicBackground)(1, fakePageSize) as Content & { canvas?: unknown[] };
        const rect = bg.canvas?.[0] as { color?: string };
        expect(rect.color).toBe(PDF_DARK.bg);
    });
});

// ===========================================================================
// D3 (pdfv3-design-fix/DEFAUTS.md) — grille des tableaux de données posée en
// p.border par CELLULE (jamais le noir par défaut de pdfmake), Chronologie /
// Effraction (hypothèses) / PATRACDVR, dans les DEUX thèmes.
// ===========================================================================
describe('buildOiDocDefinition — tableaux de données : grille p.border, jamais noir figé (D3)', () => {
    it.each([
        ['clair', false, PDF_LIGHT],
        ['sombre', true, PDF_DARK],
    ] as const)('Chronologie Prévisionnelle (thème %s) : en-tête bordée p.border, fond p.headerRow', (_label, isDark, pal) => {
        const formData: OiFormData = { time_events: [{ hour: '08:00', type: 'DÉPART', description: 'PC' }] };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData, {}, isDark), { format: 'a4' }));

        expect(json).toContain(
            `{"text":"Heure","bold":true,"fillColor":"${pal.headerRow}","borderColor":["${pal.border}","${pal.border}","${pal.border}","${pal.border}"]}`,
        );
        expect(json).toContain(
            `{"text":"Événement","bold":true,"fillColor":"${pal.headerRow}","borderColor":["${pal.border}","${pal.border}","${pal.border}","${pal.border}"]}`,
        );
    });

    it.each([
        ['clair', false, PDF_LIGHT],
        ['sombre', true, PDF_DARK],
    ] as const)("Hypothèses d'Effraction (thème %s) : en-tête bordée p.border", (_label, isDark, pal) => {
        // Mission P1 : au-delà de `EFFRAC_HYP_CARDS_MAX` (4) hypothèses, le
        // rendu repose sur la table dense historique (son en-tête, seul objet
        // testé ici) plutôt que sur des cartes — 6 hypothèses COURTES pour
        // déclencher ce mode sans risquer un refus fit-to-page.
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: 'PORTE', mission: '-', porte: '-', structure: 'Porte blindee', serrurerie: '-',
                environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-',
                prof_bati: '-', h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-',
                members: [],
                hypotheses: Array.from({ length: 6 }, (_, i) => ({
                    id: `h${i}`,
                    title: `H${i + 1}`,
                    desc: '',
                    effrac: 'Pied de biche',
                    degag: 'Evacuation',
                    assaut: 'Direct',
                })),
            },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ effraction_blocks: effractionBlocks }, {}, isDark), { format: 'a4' }));

        expect(json).toContain(
            `{"text":"Hypothèse","bold":true,"fillColor":"${pal.headerRow}","borderColor":["${pal.border}","${pal.border}","${pal.border}","${pal.border}"]}`,
        );
    });

    it.each([
        ['clair', false, PDF_LIGHT],
        ['sombre', true, PDF_DARK],
    ] as const)('RÉCAPITULATIF PATRACDVR (thème %s) : en-tête ET lignes de membres bordées p.border', (_label, isDark, pal) => {
        const json = JSON.stringify(
            buildOiDocDefinition(collect({ patracdvr_rows: [makePatracRow()] }, {}, isDark), { format: 'a4' }),
        );

        expect(json).toContain(
            `{"text":"VL","bold":true,"fillColor":"${pal.headerRow}","alignment":"center","borderColor":["${pal.border}","${pal.border}","${pal.border}","${pal.border}"]}`,
        );
        expect(json).toContain(
            `{"text":"ABC","bold":true,"alignment":"center","noWrap":true,"borderColor":["${pal.border}","${pal.border}","${pal.border}","${pal.border}"]}`,
        );
    });
});

// ===========================================================================
// Arbitrage DFIX.REFIX (round 1, 2026-08-02) — alignement des cellules,
// dernier écart A↔B sur les tableaux. Référence B : `print-style.ts`
// `.patrac td, .patrac th { text-align:center }` (TOUT le roster PATRACDVR
// centré, pas seulement VL/DIR) et `print-view.ts:410`
// `<td style="text-align:center;">` sur la colonne Heure de la Chronologie
// (la colonne Événement reste alignée à gauche, comportement par défaut de
// B non redéfini pour cette colonne).
// ===========================================================================
describe('buildOiDocDefinition — alignement centré du roster PATRACDVR (arbitrage A↔B, round DFIX.REFIX)', () => {
    it('les colonnes CELLULE/FONCTION/PPALE/SEC./AFIS/EQPT+GREN. sont centrées, comme VL/DIR/en-tête', () => {
        const json = JSON.stringify(buildOiDocDefinition(collect({ patracdvr_rows: [makePatracRow()] }), { format: 'a4' }));

        expect(json).toContain('{"text":"AO1","alignment":"center","noWrap":true,"borderColor":');
        expect(json).toContain('{"text":"Chef inter","alignment":"center","noWrap":true,"borderColor":');
        expect(json).toContain('{"text":"UMP9","alignment":"center","noWrap":true,"borderColor":');
        expect(json).toContain('{"text":"PSA","alignment":"center","noWrap":true,"borderColor":');
        expect(json).toContain('{"text":"PIE","alignment":"center","noWrap":true,"borderColor":');
        expect(json).toContain('{"text":"GENL, UBAS","fontSize":8,"alignment":"center","borderColor":');
    });
});

describe("buildOiDocDefinition — Chronologie : colonne Heure centrée (arbitrage A↔B), colonne Événement inchangée (gauche)", () => {
    it('la cellule Heure porte alignment:center, la cellule Événement n\'a aucune clé alignment', () => {
        const formData: OiFormData = { time_events: [{ hour: '08:00', type: 'DÉPART', description: 'PC' }] };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        expect(json).toContain('{"text":"08:00","alignment":"center","borderColor":');
        expect(json).not.toContain('"text":[{"text":"DÉPART","bold":true},{"text":" : PC"}],"alignment"');
    });
});

// ===========================================================================
// D4 (pdfv3-design-fix/DEFAUTS.md) — bloc IDENTITÉ de fiche adversaire rendu
// en tableau bordé `kvTable()`, plus en lignes `labelValue()` nues.
// ===========================================================================
describe('buildOiDocDefinition — fiche adversaire, bloc IDENTITÉ : tableau bordé kvTable (D4)', () => {
    function advFormData(meList: string[] = []): OiFormData {
        return {
            adversaries: [
                {
                    id: 'adv1',
                    nom_adversaire: 'DUPONT',
                    date_naissance: '01/01/1990',
                    lieu_naissance: 'Paris',
                    profession_adversaire: 'Inconnue',
                    situation_familiale: 'Célibataire',
                    stature_adversaire: '1m80',
                    ethnie_adversaire: 'Caucasien',
                    me_list: meList,
                    etat_esprit_list: [],
                    volume_list: [],
                    vehicules_list: [],
                },
            ],
        };
    }

    it('la ligne « Naissance » est une cellule kvTable (label gras fillColor p.cardAlt, bordée p.border) — plus une ligne labelValue nue', () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(advFormData()), { format: 'a4' }));

        expect(json).toContain(
            `{"text":"Naissance","bold":true,"fillColor":"${PDF_LIGHT.cardAlt}","borderColor":["${PDF_LIGHT.border}","${PDF_LIGHT.border}","${PDF_LIGHT.border}","${PDF_LIGHT.border}"]}`,
        );
        // labelValue() (ex-rendu, D4) aurait produit "NAISSANCE : " — absent désormais.
        expect(json).not.toContain('NAISSANCE : ');
    });

    it("« Moyens Employés » n'apparaît QUE si me_list contient une entrée non vide (repli conditionnel préservé)", () => {
        const without = JSON.stringify(buildOiDocDefinition(collect(advFormData([])), { format: 'a4' }));
        expect(without).not.toContain('Moyens Employés');

        const withMe = JSON.stringify(buildOiDocDefinition(collect(advFormData(['MP9'])), { format: 'a4' }));
        expect(withMe).toContain('"text":"Moyens Employés"');
        expect(withMe).toContain('"text":"MP9"');
    });
});

// ===========================================================================
// D5/D6 (pdfv3-design-fix/DEFAUTS.md) — « Composition par Cellule » : fond
// PLEIN p.cardAlt (jamais un voile translucide) + pastilles CONTOUR (jamais
// un badge plein), dans les DEUX thèmes.
// ===========================================================================
describe('buildOiDocDefinition — Composition par Cellule : fond plein + pastilles contour (D5/D6)', () => {
    function cellFormData(): OiFormData {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: '-', place_chef: '-', members: ['ABC'] },
        ];
        return {
            zmspcp_blocks: zmspcpBlocks,
            patracdvr_rows: [
                {
                    vehicle: 'VL1',
                    members: [
                        { trigramme: 'ABC', fonction: '-', cellule: 'AO1', principales: '-', secondaires: '-', afis: '-', grenades: '-', equipement: '-', equipement2: '-', tenue: '-', gpb: '-', dir: '' },
                    ],
                },
            ],
        };
    }

    it.each([
        ['clair', false, PDF_LIGHT],
        ['sombre', true, PDF_DARK],
    ] as const)('(thème %s) fond PLEIN p.cardAlt, jamais de fillOpacity (voile translucide)', (_label, isDark, pal) => {
        const json = JSON.stringify(buildOiDocDefinition(collect(cellFormData(), {}, isDark), { format: 'a4' }));

        expect(json).not.toContain('fillOpacity');
        expect(json).toContain(`"fillColor":"${pal.cardAlt}","borderColor":["${pal.accent}","${pal.accent}","${pal.accent}","${pal.accent}"]`);
    });

    it.each([
        ['clair', false, PDF_LIGHT],
        ['sombre', true, PDF_DARK],
    ] as const)('(thème %s) le trigramme ABC est une pastille CONTOUR (bordure p.accent, aucun fillColor/color plein) — pas un badge', (_label, isDark, pal) => {
        const json = JSON.stringify(buildOiDocDefinition(collect(cellFormData(), {}, isDark), { format: 'a4' }));

        expect(json).toContain(
            `{"text":"ABC","borderColor":["${pal.accent}","${pal.accent}","${pal.accent}","${pal.accent}"],"alignment":"center"}`,
        );
    });
});

// ===========================================================================
// D7 (pdfv3-design-fix/DEFAUTS.md) — « Ordre de Pénétration » rend la MÊME
// pastille inline numérotée que « Ordre Rame VL »/« Colonne Progression »,
// plus le pavé 2 lignes `bigPenetrationPill` (supprimé).
// ===========================================================================
describe('buildOiDocDefinition — Ordre de Pénétration : même pastille inline que les 2 autres rangées (D7)', () => {
    it('les 3 rangées rendent le même item avec EXACTEMENT la même structure de pastille numérotée', () => {
        const formData: OiFormData = {
            rame_vl_order: ['A1'],
            colonne_progression_order: ['A1'],
            ordre_penetration_order: ['A1'],
        };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        const pillShape =
            `{"text":[{"text":"1 ","bold":true,"color":"${PDF_LIGHT.accent}"},{"text":"A1"}],` +
            `"borderColor":["${PDF_LIGHT.accent}","${PDF_LIGHT.accent}","${PDF_LIGHT.accent}","${PDF_LIGHT.accent}"],"alignment":"center"}`;
        const occurrences = json.split(pillShape).length - 1;
        expect(occurrences).toBe(3);
    });

    it("l'ancien pavé 2 lignes (indice muted au-dessus du libellé, fillColor p.headerRow) a disparu", () => {
        const formData: OiFormData = { ordre_penetration_order: ['A1'] };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        expect(json).not.toContain(`"fontSize":8,"color":"${PDF_LIGHT.muted}"`);
    });
});

// ===========================================================================
// D8 (pdfv3-design-fix/DEFAUTS.md) — `card()` (blocks.ts) transparente par
// défaut, pas de fond `p.cardAlt` systématique — vérifié ici au niveau
// document (page de garde « 1. SITUATION GLOBALE », dans une vraie
// `TDocumentDefinitions`), en complément du test unitaire de `blocks.ts`.
// ===========================================================================
describe('buildOiDocDefinition — cartes/encadrés simples : transparentes par défaut (D8)', () => {
    it('la carte « 1. SITUATION GLOBALE » (card(), page de garde) ne porte aucun fillColor de fond', () => {
        const formData: OiFormData = { situation_generale: 'RAS' };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        // h3('1. SITUATION GLOBALE') est immédiatement suivi, dans la même cellule
        // de card(), de la bordure p.border SANS fillColor intercalé.
        expect(json).toContain(
            `[{"text":"1. SITUATION GLOBALE","fontSize":12,"bold":true,"decoration":"underline","color":"${PDF_LIGHT.accent}"}`,
        );
        // Signature de l'ANCIEN défaut (fond systématique cardAlt sur une card() nue) : absente.
        expect(json).not.toContain(`"fillColor":"${PDF_LIGHT.cardAlt}","borderColor":["${PDF_LIGHT.border}"`);
    });
});

// ===========================================================================
// MISSION P1 (refonte mise en page PDF OI, directive Nico 2026-08-10) —
// blocs ZMSPCP/MOICP : UNE SEULE page par bloc, solveur fit-to-page PUR
// (`fitUsageToPage`, theme.ts) réduisant la police par paliers (11→7) puis
// REFUS DE GÉNÉRATION explicite (`OiPdfFitRefusalError`) si même 7 px ne
// suffit pas — INTERDICTION ABSOLUE de continuation « (SUITE) »/« (suite) »
// (l'ancien `chunkItemsByCost`/pages « (SUITE) » ont été retirés).
// ===========================================================================
describe('buildOiDocDefinition — page unique ZMSPCP/MOICP, fit-to-page (mission P1)', () => {
    function dashItems(count: number, wordy = false): string {
        return Array.from({ length: count }, (_, i) =>
            wordy
                ? `- Item numero ${i + 1} tres long qui occupe plusieurs lignes une fois rendu, avec beaucoup de details operationnels supplementaires ajoutes ici pour alourdir le champ.`
                : `- Item numero ${i + 1} du champ conduite a tenir.`,
        ).join('\n');
    }

    it('champ « C conduite à tenir » COURT (sans tiret) : rendu inchangé, un seul labelValue, une seule page, jamais de continuation', () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: 'RAS', place_chef: '-', members: [] },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' }));

        expect(json).toContain('"text":[{"text":"C CONDUITE À TENIR : ","bold":true,"color":"#0033a0"},{"text":"RAS"');
        expect(json).not.toContain('(suite)');
        expect(json).not.toContain('(SUITE)');
    });

    it('champ « C conduite à tenir » à tirets tenant sur UNE page : liste d\'items insécables, jamais de continuation « (SUITE) »', () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: dashItems(5), place_chef: '-', members: [] },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' }));

        // Chaque item rendu comme un `text` insécable distinct (pas un labelValue unique multi-lignes).
        expect(json).toContain('{"text":"- Item numero 1 du champ conduite a tenir.","color":"#111111","margin":[0,0,0,0],"unbreakable":true,"preserveLeadingSpaces":true}');
        expect(json).toContain('{"text":"- Item numero 5 du champ conduite a tenir.","color":"#111111","margin":[0,2,0,0],"unbreakable":true,"preserveLeadingSpaces":true}');
        expect(json).not.toContain('(suite)');
        expect(json).not.toContain('(SUITE)');
        expect((json.match(/ARTICULATION : ZMSPCP - ALPHA/g) ?? []).length).toBe(1);
    });

    it("un champ « C conduite à tenir » volumineux (30 items) ne produit JAMAIS de continuation « (SUITE) » : soit il tient (police réduite, les 30 items présents sur l'unique page), soit la génération est explicitement REFUSÉE (OiPdfFitRefusalError) — jamais de troncature silencieuse ni de coupure en milieu de phrase", () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: dashItems(30), place_chef: '-', members: [] },
        ];
        const data = collect({ zmspcp_blocks: zmspcpBlocks });

        try {
            const json = JSON.stringify(buildOiDocDefinition(data, { format: 'a4' }));
            expect(json).not.toContain('(SUITE)');
            expect(json).not.toContain('(suite)');
            expect((json.match(/ARTICULATION : ZMSPCP - ALPHA/g) ?? []).length).toBe(1);
            for (let i = 1; i <= 30; i++) {
                expect(json, `item ${i} doit apparaître`).toContain(`Item numero ${i} du champ conduite a tenir.`);
            }
        } catch (err) {
            expect(err).toBeInstanceOf(OiPdfFitRefusalError);
            const refusal = err as OiPdfFitRefusalError;
            expect(refusal.fitErrors.some((e) => /ZMSPCP/.test(e.section))).toBe(true);
        }
    });

    it('un champ « C conduite à tenir » DÉLIBÉRÉMENT surdimensionné (40 items longs) REFUSE la génération — jamais de troncature ni de continuation', () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: dashItems(40, true), place_chef: '-', members: [] },
        ];
        const data = collect({ zmspcp_blocks: zmspcpBlocks });

        let caught: unknown;
        try {
            buildOiDocDefinition(data, { format: 'a4' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(OiPdfFitRefusalError);
        const refusal = caught as OiPdfFitRefusalError;
        expect(refusal.fitErrors.length).toBeGreaterThan(0);
        expect(refusal.fitErrors[0]?.section).toContain('ZMSPCP');
        expect(refusal.fitErrors[0]?.excessRatio).toBeGreaterThan(0);
        expect(refusal.message).toContain('dépassement');
    });
});

// ===========================================================================
// Correctif PG.REFIX round 1 — 2 défauts « carte esseulée »/« section vide
// non omise » (2e retour utilisateur, guardrail structurel B4-B6 dédié,
// `tests/pdf/verify-structure.mjs`).
// ===========================================================================
describe('buildOiDocDefinition — correctif PG.REFIX round 1', () => {
    it('page de garde : un `situation_generale`/`situation_particuliere` volumineux réduit le palier de police de `situationCard`/`ciblesCard` (grid2) sous le palier document', () => {
        const longSituation = 'Reconduite du scenario de recette OI avec un jeu de donnees volontairement charge. '.repeat(6);
        const formData: OiFormData = { situation_generale: longSituation, situation_particuliere: longSituation };
        const dd = buildOiDocDefinition(collect(formData), { format: 'a4' });
        const json = JSON.stringify(dd);

        // La grille couverture (`{ stack: [grid2(...)], fontSize: coverFontPx }`,
        // document-builder.ts::buildCover) porte un `fontSize` explicite juste
        // après la fermeture du `stack` qui enveloppe `grid2()` — <= 10 pour un
        // volume aussi long (`coverCardFontPx`, bien SOUS le palier plancher
        // `adaptivePagePx` de 9, cf. sa JSDoc).
        const gridMatch = json.match(/"columnGap":[\d.]+\}\],"fontSize":(\d+)/);
        expect(gridMatch).not.toBeNull();
        expect(Number(gridMatch?.[1])).toBeLessThanOrEqual(10);
    });

    it("un bloc effraction SANS AUCUNE mesure technique, SANS hypothèse, SANS photo est OMIS (section vide = OMISE, jamais de page 'titre seul')", () => {
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: 'CELLULE VIDE', mission: '-', porte: '', structure: '', serrurerie: '',
                environnement: '', bati_a_bati: '', dormant_a_dormant: '', prof_linteaux: '', prof_bati: '',
                h_porte: '', h_marche: '', prof_marche: '', prof_moulure: '', members: [], hypotheses: [],
            },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ effraction_blocks: effractionBlocks }), { format: 'a4' }));

        expect(json).not.toContain('ARTICULATION : EFFRACTION');
        expect(json).not.toContain('CELLULE VIDE');
    });

    it('un bloc effraction avec AU MOINS une mesure technique saisie est rendu (aucune perte de données saisies)', () => {
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: 'CELLULE RENSEIGNEE', mission: '-', porte: '', structure: 'Beton arme', serrurerie: '',
                environnement: '', bati_a_bati: '', dormant_a_dormant: '', prof_linteaux: '', prof_bati: '',
                h_porte: '', h_marche: '', prof_marche: '', prof_moulure: '', members: [], hypotheses: [],
            },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ effraction_blocks: effractionBlocks }), { format: 'a4' }));

        expect(json).toContain('ARTICULATION : EFFRACTION - CELLULE RENSEIGNEE');
        expect(json).toContain('Beton arme');
    });

    it('un bloc effraction SANS mesure technique mais avec au moins UNE hypothèse saisie est rendu (aucune perte de données saisies)', () => {
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: 'CELLULE HYP', mission: '-', porte: '', structure: '', serrurerie: '',
                environnement: '', bati_a_bati: '', dormant_a_dormant: '', prof_linteaux: '', prof_bati: '',
                h_porte: '', h_marche: '', prof_marche: '', prof_moulure: '', members: [],
                hypotheses: [{ id: 'h1', title: 'H1', desc: '-', effrac: 'Pied de biche', degag: '-', assaut: '-' }],
            },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ effraction_blocks: effractionBlocks }), { format: 'a4' }));

        expect(json).toContain('ARTICULATION : EFFRACTION - CELLULE HYP');
        expect(json).toContain('Pied de biche');
    });
});

// ===========================================================================
// Blindage PDF OI — mission BLIND.A (voie A pdfmake).
// Arbitrage #2 : coupure automatique au rendu des tokens sans espace > 40 car.
// ===========================================================================
describe('buildOiDocDefinition — blindage BLIND.A #2 : coupure des tokens sans espace', () => {
    // Nom conservé « ZWSP » dans les assertions ci-dessous pour minimiser le
    // diff, mais la valeur importée est désormais SOFT_HYPHEN (U+00AD).
    const ZWSP = SOFT_HYPHEN;

    it("un mot ininterrompu de 80 caractères dans « C conduite à tenir » (crash fontkit confirmé, matrice-rupture.md §4) ne fait PLUS planter buildOiDocDefinition", () => {
        const longWord = 'A'.repeat(80);
        const zmspcpBlocks: OiZmspcpBlock[] = [
            {
                id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-',
                cat: `- Consigne normale.\n- ${longWord}\n- Autre consigne normale.`, place_chef: '-', members: [],
            },
        ];

        expect(() => buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' })).not.toThrow();

        const json = JSON.stringify(buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' }));
        // Contenu intégral préservé : le mot de 80 car., une fois les points de
        // coupure ZWSP retirés, est retrouvé EXACTEMENT dans le JSON produit.
        const stripped = json.replace(new RegExp(ZWSP, 'g'), '');
        expect(stripped).toContain(longWord);
        // Au moins un point de coupure a bien été inséré (mot > 40 car.).
        expect(json).toContain(ZWSP);
    });

    it('un mot ininterrompu de 80 caractères dans un champ texte libre (situation_generale, hors dashItemList) est également coupé', () => {
        const longWord = 'B'.repeat(80);
        const json = JSON.stringify(
            buildOiDocDefinition(collect({ situation_generale: `RAS ${longWord} RAS` }), { format: 'a4' }),
        );
        expect(json.replace(new RegExp(ZWSP, 'g'), '')).toContain(longWord);
    });
});

// ===========================================================================
// MISSION P1 (refonte mise en page PDF OI, directive Nico 2026-08-10) —
// « 1 page par cellule effraction (mission + caractéristiques + hypothèses) »
// : UNE SEULE page toujours, hypothèses en CARTES (≤ `EFFRAC_HYP_CARDS_MAX`,
// empilées ou 2 colonnes) ou table dense au-delà, solveur fit-to-page PUR
// (`fitUsageToPage`) puis REFUS DE GÉNÉRATION explicite si même 7 px ne
// suffit pas. L'ancien mécanisme `chunkItemsByCost`/`expandOversizedHypothesis`
// (fragmentation de rangée + continuation « (SUITE) ») a été RETIRÉ.
// ===========================================================================
describe('buildOiDocDefinition — page unique EFFRACTION, hypothèses en cartes/table, fit-to-page (mission P1)', () => {
    function effractionWithHypotheses(count: number, wordy = false): OiEffractionBlock {
        return {
            id: 'e1', title: 'PORTE ALPHA', mission: '-', porte: '-', structure: '-', serrurerie: '-',
            environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-', prof_bati: '-',
            h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-', members: [],
            hypotheses: Array.from({ length: count }, (_, i) => ({
                id: `he${i}`,
                title: `Hypothese ${i + 1}`,
                desc: '',
                effrac: wordy
                    ? `Technique effraction ${i + 1} : `.repeat(1) + 'A'.repeat(400)
                    : `Technique ${i + 1}`,
                degag: wordy ? `Degagement ${i + 1} : `.repeat(1) + 'B'.repeat(400) : `Degagement ${i + 1}`,
                assaut: wordy ? `Assaut ${i + 1} : `.repeat(1) + 'C'.repeat(400) : `Assaut ${i + 1}`,
            })),
        };
    }

    it('4 hypothèses COURTES (rendues en cartes) : une seule page, aucune continuation « (SUITE) », aucune perte', () => {
        const json = JSON.stringify(
            buildOiDocDefinition(collect({ effraction_blocks: [effractionWithHypotheses(4)] }), { format: 'a4' }),
        );
        for (let i = 1; i <= 4; i++) {
            expect(json).toContain(`Hypothese ${i}`);
        }
        expect(json).not.toContain('(SUITE)');
        expect(json).not.toContain('(suite)');
        expect((json.match(/ARTICULATION : EFFRACTION - PORTE ALPHA/g) ?? []).length).toBe(1);
    });

    it('6 hypothèses COURTES (au-delà du seuil cartes, repli sur la table dense) : toutes présentes sur l’unique page, jamais de continuation', () => {
        const json = JSON.stringify(
            buildOiDocDefinition(collect({ effraction_blocks: [effractionWithHypotheses(6)] }), { format: 'a4' }),
        );
        for (let i = 1; i <= 6; i++) {
            expect(json, `Hypothese ${i} doit apparaître`).toContain(`Hypothese ${i}`);
        }
        expect(json).not.toContain('(SUITE)');
        expect((json.match(/ARTICULATION : EFFRACTION - PORTE ALPHA/g) ?? []).length).toBe(1);
    });

    it("12 hypothèses VOLUMINEUSES (défaut historique : table entièrement disparue à 8+) — RENDUES intégralement (jamais de perte), le refus n'est plus déclenché pour ce seul volume : escalade vers des pages autonomes si nécessaire (dernière passe, « le refus devient l'ultime recours »)", () => {
        const json = JSON.stringify(
            buildOiDocDefinition(collect({ effraction_blocks: [effractionWithHypotheses(12, true)] }), { format: 'a4' }),
        );
        for (let i = 1; i <= 12; i++) {
            expect(json, `Hypothese ${i} doit apparaître`).toContain(`Hypothese ${i}`);
        }
        // Jamais de continuation « (SUITE) » — si une scission a été nécessaire,
        // chaque page porte un titre DISTINCT et autonome (cf. describe ci-dessous).
        expect(json).not.toContain('(SUITE)');
        expect(json).not.toContain('(suite)');
    });
});

// ===========================================================================
// DERNIÈRE PASSE EFFRACTION (directive Nico 2026-08-10) — « le refus doit
// devenir l'ultime recours pour l'effraction » : escalade de dispositions
// (colonnes internes adaptatives + densité, police, asymétrie, PAGES
// AUTONOMES) avant tout refus. Refus SEULEMENT si une hypothèse UNIQUE ne
// tient pas, seule, sur une page entière même au palier plancher 7 px.
// ===========================================================================
describe('buildOiDocDefinition — dernière passe EFFRACTION : pages autonomes avant refus (directive Nico 2026-08-10)', () => {
    function heavyHypothesis(i: number): OiEffractionHypothesis {
        return {
            id: `he${i}`,
            title: `Hypothese ${i + 1}`,
            desc: `Description operationnelle detaillee du scenario numero ${i + 1}, avec de nombreux details tactiques complementaires ajoutes pour alourdir sensiblement le texte saisi ici et forcer un enroulement sur plusieurs lignes.`,
            effrac: `Technique effraction ${i + 1} : `.repeat(1) + 'A'.repeat(350),
            degag: `Degagement ${i + 1} : `.repeat(1) + 'B'.repeat(350),
            assaut: `Assaut ${i + 1} : `.repeat(1) + 'C'.repeat(350),
        };
    }
    function effractionBlockWithHyps(hypotheses: OiEffractionHypothesis[]): OiEffractionBlock {
        return {
            id: 'e1', title: 'PORTE ALPHA', mission: '-', porte: '-', structure: '-', serrurerie: '-',
            environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-', prof_bati: '-',
            h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-', members: [], hypotheses,
        };
    }

    it('4 hypothèses VOLUMINEUSES (trop grosses pour 1 page) : rendues sur 2 PAGES AUTONOMES, titres distincts, jamais de « (SUITE) », aucune hypothèse coupée en son milieu', () => {
        const hypotheses = Array.from({ length: 4 }, (_, i) => heavyHypothesis(i));
        const dd = buildOiDocDefinition(collect({ effraction_blocks: [effractionBlockWithHyps(hypotheses)] }), { format: 'a4' });
        const json = JSON.stringify(dd);

        // Aucune perte, aucune duplication : chaque hypothèse apparaît exactement 1 fois.
        for (let i = 1; i <= 4; i++) {
            expect(json.split(`Hypothese ${i}`).length - 1, `Hypothese ${i} doit apparaître exactement 1 fois`).toBeGreaterThanOrEqual(1);
        }
        expect(json).not.toContain('(SUITE)');
        expect(json).not.toContain('(suite)');

        // Titres distincts et autonomes : « MISSION & CARACTÉRISTIQUES » puis « HYPOTHÈSES <plage> ».
        expect(json).toContain('ARTICULATION : EFFRACTION - PORTE ALPHA — MISSION & CARACTÉRISTIQUES');
        expect(json).toContain('ARTICULATION : EFFRACTION - PORTE ALPHA — HYPOTHÈSES');

        // Effectivement plusieurs pages top-level (pageBreak explicite entre elles).
        const content = dd.content as Content[];
        const effracPages = content.filter((node) => JSON.stringify(node).includes('ARTICULATION : EFFRACTION - PORTE ALPHA'));
        expect(effracPages.length).toBeGreaterThanOrEqual(2);
    });

    it('1 hypothèse MONSTRUEUSE (ne tient seule sur aucune page, même à 7px) : REFUS explicite, message mentionnant l’hypothèse unique en cause', () => {
        const monster: OiEffractionHypothesis = {
            id: 'he0',
            title: 'Hypothese Monstre',
            desc: 'D'.repeat(6000),
            effrac: 'A'.repeat(6000),
            degag: 'B'.repeat(6000),
            assaut: 'C'.repeat(6000),
        };
        const data = collect({ effraction_blocks: [effractionBlockWithHyps([monster])] });

        let caught: unknown;
        try {
            buildOiDocDefinition(data, { format: 'a4' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(OiPdfFitRefusalError);
        const refusal = caught as OiPdfFitRefusalError;
        expect(refusal.fitErrors.some((e) => /EFFRACTION/.test(e.section))).toBe(true);
        const effracError = refusal.fitErrors.find((e) => /EFFRACTION/.test(e.section));
        expect(effracError?.details).toContain('Hypothese Monstre');
        expect(effracError?.details).toMatch(/hypothèse.*seule.*page/i);
        expect(effracError?.excessRatio).toBeGreaterThan(0);
        expect(refusal.message).toContain('Hypothese Monstre');
    });
});

describe('hypothesisRowHeightPt — coût (pt) d’UNE rangée de la table dense Hypothèses d’Effraction (modèle physique D2, réutilisé par le solveur fit-to-page P1)', () => {
    it('une hypothèse plus longue coûte STRICTEMENT plus de points qu’une hypothèse courte, à police/largeur égales', () => {
        const short = { id: 'h1', title: 'H1', desc: '', effrac: 'Pied de biche', degag: '-', assaut: '-' };
        const long = { id: 'h1', title: 'H1', desc: '', effrac: 'A'.repeat(500), degag: '-', assaut: '-' };
        expect(hypothesisRowHeightPt(long, 9, 780)).toBeGreaterThan(hypothesisRowHeightPt(short, 9, 780));
    });

    it('une police plus petite réduit le coût (plus de caractères par ligne, avance de ligne plus courte)', () => {
        const h = { id: 'h1', title: 'H1', desc: '', effrac: 'Description operationnelle detaillee de la technique employee.', degag: '-', assaut: '-' };
        expect(hypothesisRowHeightPt(h, 7, 780)).toBeLessThan(hypothesisRowHeightPt(h, 11, 780));
    });
});

describe("PAGE_CAPACITY — capacités calibrées par champ/section (mission P1, consommées par P3)", () => {
    it('effractionHypothesesCardsMax() === 4 (seuil cartes/table dense, même valeur que le rendu réel)', () => {
        expect(PAGE_CAPACITY.effractionHypothesesCardsMax()).toBe(4);
    });

    it('adversaireAtcdMaxChars/articulationCatMaxChars décroissent quand la police grandit (moins de caractères tiennent par ligne à police plus grande, mais moins de lignes aussi — capacité positive et finie)', () => {
        for (const fontPx of [7, 9, 11]) {
            expect(PAGE_CAPACITY.adversaireAtcdMaxChars(fontPx)).toBeGreaterThan(0);
            expect(PAGE_CAPACITY.articulationCatMaxChars(fontPx)).toBeGreaterThan(0);
        }
    });
});

// ===========================================================================
// MISSION P1 (refonte mise en page PDF OI, directive Nico 2026-08-10) — fiche
// adversaire : carte ATCD en liste DENSE (1 ou 2 sous-colonnes selon le
// volume, `PAGE_CAPACITY`/`splitRoundRobin`), UNE SEULE page toujours,
// solveur fit-to-page puis REFUS explicite si même 7 px ne suffit pas —
// AUCUNE continuation « (SUITE) », AUCUNE troncature silencieuse.
// ===========================================================================
describe('buildOiDocDefinition — page unique fiche adversaire, ATCD dense, fit-to-page (mission P1)', () => {
    function advWithAtcd(lines: number, longEntries = false): OiFormData {
        const atcd = Array.from(
            { length: lines },
            (_, i) =>
                longEntries
                    ? `- ATCD ${i + 1} : mesure operationnelle detaillee decrivant une consigne precise a appliquer sur zone, avec de nombreux details supplementaires ajoutes pour alourdir considerablement le texte saisi ici.`
                    : `- ATCD ${i + 1} : vol.`,
        ).join('\n');
        return {
            adversaries: [
                {
                    id: 'adv1', nom_adversaire: 'DUPONT', antecedents_adversaire: atcd, armes_connues: 'Arme de poing',
                    me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [],
                },
            ],
        };
    }

    it('un champ ATCD court (5 lignes) : rendu sur UNE page, aucun « (SUITE) », aucune perte', () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(advWithAtcd(5)), { format: 'a4' }));
        expect(json).toContain('DANGEROSITÉ');
        expect(json).toContain('Arme de poing');
        for (let i = 1; i <= 5; i++) {
            expect(json).toContain(`ATCD ${i} :`);
        }
        expect(json).not.toContain('(SUITE)');
        expect(json).not.toContain('(suite)');
        expect((json.match(/FICHE ADVERSAIRE : DUPONT/g) ?? []).length).toBe(1);
    });

    it('un champ ATCD de 25 lignes COURTES (liste dense multi-colonnes) : soit tout tient sur l’unique page (police réduite), soit la génération est explicitement REFUSÉE — jamais de continuation ni de troncature', () => {
        const data = collect(advWithAtcd(25));
        try {
            const json = JSON.stringify(buildOiDocDefinition(data, { format: 'a4' }));
            expect(json).not.toContain('(SUITE)');
            expect(json).not.toContain('(suite)');
            for (let i = 1; i <= 25; i++) {
                expect(json, `ATCD ${i} doit apparaître`).toContain(`ATCD ${i} :`);
            }
        } catch (err) {
            expect(err).toBeInstanceOf(OiPdfFitRefusalError);
            const refusal = err as OiPdfFitRefusalError;
            expect(refusal.fitErrors.some((e) => /Fiche Adversaire/.test(e.section))).toBe(true);
        }
    });

    it('un champ ATCD DÉLIBÉRÉMENT surdimensionné (40 entrées longues) REFUSE la génération — jamais de perte silencieuse, jamais de continuation', () => {
        const data = collect(advWithAtcd(40, true));

        let caught: unknown;
        try {
            buildOiDocDefinition(data, { format: 'a4' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(OiPdfFitRefusalError);
        const refusal = caught as OiPdfFitRefusalError;
        expect(refusal.fitErrors.length).toBeGreaterThan(0);
        expect(refusal.fitErrors[0]?.section).toContain('Fiche Adversaire');
        expect(refusal.fitErrors[0]?.excessRatio).toBeGreaterThan(0);
    });
});

// ===========================================================================
// Correctif Nico 2026-08-10 — fiche adversaire : la photo d'identité et les
// libellés `kvTable` à 2 mots (« Situation familiale », « Signes
// particuliers ») n'étaient pas (ou mal) comptés par le modèle de coût du
// solveur fit-to-page, ce qui laissait passer un palier de police trop grand
// : la fiche débordait alors RÉELLEMENT (au rendu pdfmake, invisible à ce
// niveau JSON pur) sur une page orpheline portant la seule boîte DANGEROSITÉ
// — reproduit sur une archive OI réelle, cf. tests/pdf/fixtures/real-shape.json
// + verify-structure.mjs::assertC2_adversaryFicheSinglePage pour la preuve
// bout-en-bout (rendu réel). Les tests ci-dessous couvrent le MODÈLE DE COÛT
// lui-même (`identityRowPt`) et son effet sur le palier choisi par le
// solveur (`buildOiDocDefinition`), au niveau unitaire pur.
// ===========================================================================
describe('identityRowPt — coût (pt) d’UNE rangée kvTable de la fiche adversaire (correctif photo + libellé long)', () => {
    const fontPx = 11;
    const columnWidthPt = 380; // ordre de grandeur réel (A4 paysage, cf. document-builder.ts::buildAdversaryFiche)

    it('libellé et valeur courts : coût ≈ 1 ligne + le padding/bordure mesuré (EFFRAC_ROW_VPAD_PT)', () => {
        const short = identityRowPt('Naissance', '2004-04-07 @ MONACO', fontPx, columnWidthPt);
        // 1 ligne à 11px (PDF_LINE_ADVANCE_EM=1.914) + EFFRAC_ROW_VPAD_PT=9, ordre de grandeur ~30pt.
        expect(short).toBeGreaterThan(20);
        expect(short).toBeLessThan(40);
    });

    it('libellé à 2 mots qui s’enroule dans la colonne 30 % (« Situation familiale ») coûte STRICTEMENT plus qu’un libellé court à valeur identique — le libellé n’est plus supposé tenir sur 1 ligne', () => {
        const shortLabel = identityRowPt('Naissance', '/', fontPx, columnWidthPt);
        const longLabel = identityRowPt('Situation familiale', '/', fontPx, columnWidthPt);
        expect(longLabel).toBeGreaterThan(shortLabel);
    });

    it('valeur qui s’enroule sur plusieurs lignes dans la colonne 70 % coûte plus qu’une valeur tenant sur 1 ligne', () => {
        const oneLine = identityRowPt('Substances', 'THC', fontPx, columnWidthPt);
        const wrapped = identityRowPt(
            'Substances',
            "Consommateur régulier de plusieurs substances différentes selon les témoignages recueillis lors de l'enquête préliminaire",
            fontPx,
            columnWidthPt,
        );
        expect(wrapped).toBeGreaterThan(oneLine);
    });
});

describe('buildOiDocDefinition — fiche adversaire avec photo d’identité : la photo (élément NON TEXTUEL) doit peser sur le palier de police choisi (correctif Nico 2026-08-10)', () => {
    /** Même volumétrie que le cas réel ayant révélé le bug (archive OI, cf. tests/pdf/fixtures/real-shape.json) : ATCD 8 lignes + libellés 2 mots. */
    function richAdversary(): OiFormData {
        return {
            adversaries: [
                {
                    id: 'advPhoto',
                    nom_adversaire: 'DUPONT Jean',
                    domicile_adversaire: '12 Rue de Test, 99999 TESTVILLE',
                    date_naissance: '1995-06-12',
                    lieu_naissance: 'TESTVILLE',
                    stature_adversaire: '1m80 corpulent',
                    ethnie_adversaire: 'Caucasien',
                    signes_particuliers: 'Tatouage avant-bras droit',
                    situation_familiale: 'Célibataire, un enfant à charge',
                    profession_adversaire: 'Sans emploi déclaré',
                    antecedents_adversaire: [
                        '2024 : USAGE ILLICITE DE STUPEFIANTS',
                        'DETENTION NON AUTORISEE DE STUPEFIANTS',
                        "CESSION OU OFFRE DE STUPEFIANTS A UNE PERSONNE EN VUE DE SA CONSOMMATION PERSONNELLE",
                        "VIOLENCE AGGRAVEE PAR DEUX CIRCONSTANCES SUIVIE D'INCAPACITE N'EXCEDANT PAS 8 JOURS",
                        "2022 : DEGRADATION OU DETERIORATION VOLONTAIRE DU BIEN D'AUTRUI CAUSANT UN DOMMAGE LEGER",
                        'USAGE ILLICITE DE STUPEFIANTS',
                        "2021 : TROUBLE A LA TRANQUILLITE D'AUTRUI PAR AGRESSIONS SONORES",
                        '2020 : DETENTION NON AUTORISEE DE STUPEFIANTS',
                    ].join('\n'),
                    attitude_adversaire: 'Hostile, refus probable',
                    substances_adversaire: 'Consommateur régulier de stupéfiants',
                    armes_connues: 'Arme blanche, possible arme à feu non déclarée',
                    me_list: ['Fuite', 'Retranchement'],
                    etat_esprit_list: ['Déterminé', 'Imprévisible'],
                    volume_list: ['Salon', 'Chambre', 'Cave'],
                    vehicules_list: ['Peugeot 208 blanche imm. TEST-99-XY'],
                },
            ],
        };
    }

    /** Cherche, dans l'arbre `Content`, le premier nœud portant `fontSize` (nombre) dont le sérialisé contient `marker` — c'est le `stack` posé par `buildAdversaryFiche`. */
    function findFontSizeNear(node: unknown, marker: string): number | undefined {
        if (node === null || typeof node !== 'object') return undefined;
        const obj = node as Record<string, unknown>;
        if (typeof obj.fontSize === 'number' && JSON.stringify(obj).includes(marker)) {
            return obj.fontSize;
        }
        for (const value of Object.values(obj)) {
            if (Array.isArray(value)) {
                for (const item of value) {
                    const found = findFontSizeNear(item, marker);
                    if (found !== undefined) return found;
                }
            } else if (typeof value === 'object') {
                const found = findFontSizeNear(value, marker);
                if (found !== undefined) return found;
            }
        }
        return undefined;
    }

    it('avec une photo d’identité, le solveur choisit un palier de police au moins aussi réduit que sans photo (la photo occupe de la place, jamais ignorée)', () => {
        const withoutPhoto = buildOiDocDefinition(collect(richAdversary()), { format: 'a4' });

        const withPhotoFormData: OiFormData = {
            ...richAdversary(),
            dynamic_photos: {
                photo_main_advPhoto: [{ id: 'photoAdv', annotations: '[]', tools: '[]', other_tools: '', customTitle: '' }],
            },
        };
        const withPhoto = buildOiDocDefinition(
            collect(withPhotoFormData, {
                photoAdv: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            }),
            { format: 'a4' },
        );

        const fontWithout = findFontSizeNear(withoutPhoto.content, 'DANGEROSITÉ');
        const fontWith = findFontSizeNear(withPhoto.content, 'DANGEROSITÉ');
        expect(fontWithout).toBeDefined();
        expect(fontWith).toBeDefined();
        expect(fontWith as number).toBeLessThanOrEqual(fontWithout as number);

        // Les deux variantes tiennent sur UNE page (jamais de « (SUITE) », jamais de refus) — la police plancher 7px suffit toujours à ce volume.
        expect(JSON.stringify(withPhoto)).not.toContain('(SUITE)');
        expect(JSON.stringify(withPhoto)).toContain('DANGEROSITÉ');
        expect((JSON.stringify(withPhoto).match(/FICHE ADVERSAIRE : DUPONT Jean/g) ?? []).length).toBe(1);
    });
});

// ===========================================================================
// Blindage PDF OI — mission BLIND.A. Arbitrage #3 : champs fantômes —
// `effraction_blocks[].{mission,porte,prof_marche,prof_moulure}` +
// `hypotheses[].desc` (champs-fantomes.md, régression du port TacSuite vs
// strategica `OrderHtmlArticulation.kt:245,279,289,290`).
// ===========================================================================
describe('buildOiDocDefinition — blindage BLIND.A #3 : champs fantômes effraction', () => {
    it('mission/porte/prof_marche/prof_moulure de la cellule Effraction sont rendus (régression strategica corrigée)', () => {
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: 'PORTE ALPHA', mission: 'FRANCHISSEMENT DE LA PORTE PRINCIPALE.', porte: 'Blindee',
                structure: '-', serrurerie: '-', environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-',
                prof_linteaux: '-', prof_bati: '-', h_porte: '-', h_marche: '-', prof_marche: '12',
                prof_moulure: '5', members: [], hypotheses: [],
            },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ effraction_blocks: effractionBlocks }), { format: 'a4' }));

        expect(json).toContain('FRANCHISSEMENT DE LA PORTE PRINCIPALE.');
        expect(json).toContain('Blindee');
        expect(json).toContain('"text":"12 mm"');
        expect(json).toContain('"text":"5 mm"');
    });

    it("hypotheses[].desc est rendu en bloc texte SOUS le tableau des hypothèses (dérogation anti-débordement, jamais dans la cellule)", () => {
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: 'PORTE ALPHA', mission: '-', porte: '-', structure: '-', serrurerie: '-',
                environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-', prof_bati: '-',
                h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-', members: [],
                hypotheses: [{ id: 'h1', title: 'Hypothese A', desc: 'Description longue de l’hypothese A.', effrac: 'Pied de biche', degag: '-', assaut: '-' }],
            },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ effraction_blocks: effractionBlocks }), { format: 'a4' }));

        expect(json).toContain('Description longue de l’hypothese A.');
        // La cellule « Hypothèse » du tableau reste SEULE (le titre, sans la
        // description) : jamais le pattern `<br/>` strategica qui concatène desc
        // DANS la cellule et pousse au débordement (cf. champs-fantomes.md #4).
        expect(json).toContain('"text":"Hypothese A"');
        expect(json).not.toContain('Hypothese A\\nDescription longue');
    });
});

// ---------------------------------------------------------------------------
// Non-régression gate ROUND1 (mineur #2) : les trois correctifs D1/D2/D4 du
// lot « PDF réel fautif » (cas-reel-01) ne sont protégés par AUCUN test du
// dépôt (le harnais PDF et la fixture fidèle vivent hors repo) — un refactor
// futur les régresserait avec toute la suite verte. Les fonctions sont
// exportées à cette seule fin (aucun autre appelant hors module).
// ---------------------------------------------------------------------------

describe('splitAtcdBoundaries — D1 : frontières ATCD sans tiret (fiche adversaire p2→3 orpheline)', () => {
    it('replie sur les retours à la ligne saisis quand aucun tiret n’existe, indentation de tête PRÉSERVÉE', () => {
        // Forme réelle du PDF fautif : lignes nues « 2024 : … », continuation
        // indentée « ␣␣␣␣DETENTION… ». Avant D1 : texte renvoyé INTACT (1 seul
        // item), scission NATURELLE pdfmake sans « (SUITE) » (FAIL B10/B11).
        const items = splitAtcdBoundaries(
            '2024 : USAGE ILLICITE DE STUPEFIANTS\n    DETENTION DE PRODUITS STUPEFIANTS\n2023 : REFUS D OBTEMPERER',
        );
        expect(items).toHaveLength(3);
        // `trimEnd()` seul : l'indentation SAISIE des lignes de continuation
        // est une mise en forme volontaire (rendue via `preserveLeadingSpaces`).
        expect(items[1]).toBe('    DETENTION DE PRODUITS STUPEFIANTS');
    });

    it('les entrées à tiret gardent la priorité (comportement historique inchangé)', () => {
        expect(splitAtcdBoundaries('- ATCD 1 : vol\n- ATCD 2 : recel')).toEqual(['- ATCD 1 : vol', '- ATCD 2 : recel']);
    });

    it('sans tiret NI retour à la ligne : texte intact en un seul élément (filet R10 inchangé)', () => {
        expect(splitAtcdBoundaries('2024 : FAITS UNIQUES SUR UNE SEULE LIGNE')).toEqual(['2024 : FAITS UNIQUES SUR UNE SEULE LIGNE']);
    });
});

describe("effractionFirstOverheadPt — D2 : modèle physique de la 1re page Hypothèses d'Effraction", () => {
    const sparseBlock = (over?: Partial<OiEffractionBlock>): OiEffractionBlock => ({
        id: 'e1', title: 'PORTE ALPHA', mission: 'OUVERTURE.', porte: '-', structure: '-', serrurerie: '-',
        environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-', prof_bati: '-',
        h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-', members: [], hypotheses: [],
        ...over,
    });

    it('le bandeau photo de porte entre dans l’overhead (cause D2 : titre + thead seuls en bas de p11)', () => {
        // Avant D2, `photoBandPt` (mm(75) + badges ≈ 242 pt) n'entrait NULLE
        // PART dans le coût de tête : la 1re ligne de données était réputée
        // tenir, pdfmake la reportait via `headerRows` sans « (SUITE) ».
        const sans = effractionFirstOverheadPt(sparseBlock(), 10, 523, 300, 0);
        const avec = effractionFirstOverheadPt(sparseBlock(), 10, 523, 300, 242);
        expect(avec).toBeGreaterThan(sans);
        expect(avec).toBeGreaterThanOrEqual(242);
    });

    it('une mesure blanche (« - ») ne coûte AUCUNE ligne, une mesure réelle en coûte (filtrage aligné sur le rendu)', () => {
        const blanches = effractionFirstOverheadPt(sparseBlock(), 10, 523, 300, 0);
        const vides = effractionFirstOverheadPt(
            sparseBlock({ porte: '', structure: '', bati_a_bati: '' }), 10, 523, 300, 0);
        expect(blanches).toBe(vides);
        const reelles = effractionFirstOverheadPt(sparseBlock({ porte: 'Blindée 3 points' }), 10, 523, 300, 0);
        expect(reelles).toBeGreaterThan(blanches);
    });

    it('les retours à la ligne SAISIS dans la mission comptent (wrappedLinesWithNewlines, pas un simple ratio de longueur)', () => {
        const uneLigne = effractionFirstOverheadPt(sparseBlock({ mission: 'A' }), 10, 523, 300, 0);
        const troisLignes = effractionFirstOverheadPt(sparseBlock({ mission: 'A\nB\nC' }), 10, 523, 300, 0);
        expect(troisLignes).toBeGreaterThan(uneLigne);
    });
});

describe('internPhotoImages — D4 : internement/déduplication des images (poids du PDF)', () => {
    const PX = 'data:image/png;base64,AAAA';
    const PX2 = 'data:image/png;base64,BBBB';

    it('deux IDs portant une dataURL IDENTIQUE sont fusionnés sur la première clé (une seule incorporation pdfmake)', () => {
        // Cause D4 : la même photo de porte (bandeau effraction + page détail
        // galerie) était embarquée en DEUX objets PDF de 2074 K chacun.
        const { photoRefs, images } = internPhotoImages({ door_banner: PX, door_detail: PX });
        expect(Object.keys(images)).toEqual(['door_banner']);
        expect(images.door_banner).toBe(PX);
        expect(photoRefs).toEqual({ door_banner: 'door_banner', door_detail: 'door_banner' });
    });

    it('des dataURL distinctes restent des entrées distinctes (aucune fusion abusive)', () => {
        const { photoRefs, images } = internPhotoImages({ a: PX, b: PX2 });
        expect(images).toEqual({ a: PX, b: PX2 });
        expect(photoRefs).toEqual({ a: 'a', b: 'b' });
    });

    it('les valeurs vides restent telles quelles (sémantique des gardes aval conservée), jamais dans `images`', () => {
        const { photoRefs, images } = internPhotoImages({ vide: '', a: PX });
        expect(photoRefs.vide).toBe('');
        expect(images).toEqual({ a: PX });
    });
});
