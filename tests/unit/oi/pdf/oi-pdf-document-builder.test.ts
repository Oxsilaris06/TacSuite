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

import { buildOiDocDefinition, oiPdfFileName } from '@oi/pdf/document-builder.js';
import { PDF_DARK, PDF_LIGHT } from '@oi/pdf/theme.js';
import type {
    OiEffractionBlock,
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

        const extIdx = json.indexOf('EXTPHOTO');
        const intIdx = json.indexOf('INTPHOTO');
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

        const baptIdx = json.indexOf('BAPTPHOTO');
        const zmspcpIdx = json.indexOf('ARTICULATION : ZMSPCP - ALPHA');
        const aoIdx = json.indexOf('AOPHOTO');
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
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: 'PORTE', mission: '-', porte: '-', structure: '-', serrurerie: '-',
                environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-',
                prof_bati: '-', h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-',
                members: [], hypotheses: [],
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
// Modèle de PAGINATION v2 (correctif PG.IMPL, docs/SPEC-PDF-V3.md § Pagination
// v2) — blocs ZMSPCP/MOICP « C conduite à tenir » : police adaptative PUIS
// scission aux frontières légitimes (tirets) en dernier recours. Contre-épreuve
// terrain équivalente (guardrail structurel réel) : `tests/pdf/fixtures/long-case.json`
// + `tests/pdf/verify-structure.mjs` (assertions B1/B2/B3, cf. `tests/pdf/README.md`).
// ===========================================================================
describe('buildOiDocDefinition — modèle de pagination v2 (ZMSPCP/MOICP, correctif PG.IMPL)', () => {
    function dashItems(count: number): string {
        return Array.from({ length: count }, (_, i) => `- Item numero ${i + 1} du champ conduite a tenir.`).join('\n');
    }

    it('champ « C conduite à tenir » COURT (sans tiret) : rendu inchangé, un seul labelValue, une seule page', () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: 'RAS', place_chef: '-', members: [] },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' }));

        expect(json).toContain('"text":[{"text":"C CONDUITE À TENIR : ","bold":true,"color":"#0033a0"},{"text":"RAS"');
        expect(json).not.toContain('(suite)');
    });

    it('champ « C conduite à tenir » à tirets tenant sur UNE page : liste d\'items insécables, AUCUNE scission', () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: dashItems(5), place_chef: '-', members: [] },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' }));

        // Chaque item rendu comme un `text` insécable distinct (pas un labelValue unique multi-lignes).
        expect(json).toContain('{"text":"- Item numero 1 du champ conduite a tenir.","color":"#111111","margin":[0,0,0,0],"unbreakable":true}');
        expect(json).toContain('{"text":"- Item numero 5 du champ conduite a tenir.","color":"#111111","margin":[0,2,0,0],"unbreakable":true}');
        expect(json).not.toContain('(suite)');
        expect((json.match(/ARTICULATION : ZMSPCP - ALPHA/g) ?? []).length).toBe(1);
    });

    it("champ « C conduite à tenir » DÉPASSANT le budget d'une page : scission aux frontières légitimes, fragment « (suite) », jamais de coupure en milieu de phrase", () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: dashItems(30), place_chef: '-', members: [] },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' }));

        // Fragment « (suite) » présent, EXACTEMENT une fois (une seule scission pour 30 items au budget calibré).
        expect(json).toContain('ARTICULATION : ZMSPCP - ALPHA (SUITE)');
        expect((json.match(/\(SUITE\)/g) ?? []).length).toBeGreaterThanOrEqual(1);

        // Les 30 items apparaissent chacun EXACTEMENT une fois (aucune perte, aucune duplication),
        // chacun comme bloc `unbreakable` INTACT — jamais une coupure en milieu de phrase.
        for (let i = 1; i <= 30; i++) {
            const marker = `Item numero ${i} du champ conduite a tenir.`;
            const occurrences = json.split(marker).length - 1;
            expect(occurrences, `item ${i} doit apparaître exactement 1 fois`).toBe(1);
            expect(json).toContain(`"text":"- ${marker}","color":"#111111"`);
        }

        // Le fragment « (suite) » porte bien un saut de page explicite (convention `galleryPages()`).
        const suiteIdx = json.indexOf('ARTICULATION : ZMSPCP - ALPHA (SUITE)');
        const finalPageIdx = json.indexOf('AVEZ-VOUS DES QUESTIONS');
        const secondPageJson = json.slice(suiteIdx, finalPageIdx);
        expect(secondPageJson).toContain('"pageBreak":"before"');

        // La composition par cellule ne réapparaît pas sur le fragment « (suite) ».
        const firstPageEnd = suiteIdx;
        expect(secondPageJson).not.toContain('Composition par Cellule');
        expect(json.slice(0, firstPageEnd)).toContain('Composition par Cellule');
    });
});
