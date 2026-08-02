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
import type { Content, ContextPageSize, DynamicContent } from 'pdfmake/interfaces';

import { buildOiDocDefinition, oiPdfFileName } from '@oi/pdf/document-builder.js';
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

    it("aucun membre n'a de dir : colonne DIR absente, EQPT/GREN. à 34%", () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(patracFormData('')), { format: 'a4' }));

        expect(json).toContain('"widths":["7%","7%","10%","14%","10%","10%","8%","34%"]');
        expect(json).not.toContain('"text":"DIR"');
    });

    it('un membre a un dir non vide : colonne DIR présente, EQPT/GREN. à 28%', () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(patracFormData('G1')), { format: 'a4' }));

        expect(json).toContain('"widths":["7%","7%","10%","14%","10%","10%","8%","28%","6%"]');
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
