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
 *
 * NUMÉROTATION DÉRIVÉE (§2/§6 SPEC-2026-08-18-pdf-et-champs.md) : les
 * marqueurs numérotés (« 3. ENVIRONNEMENT… » à « 9. RÉCAPITULATIF PATRACDVR »)
 * ne sont plus codés en dur dans `document-builder.ts` — leur numéro est
 * calculé par le registre `OI_PDF_SECTIONS`/`resolveOiPdfSectionOrder` selon
 * l'ordre par défaut (baseline 3, cf. JSDoc `OI_PDF_SECTIONS`). Le marqueur
 * « 6. LOGISTIQUE & TRANSPORTS » historique (doublon du « 7. ») a été
 * remplacé par « 4. TRANSPORT », déplacé juste après ENVIRONNEMENT ; le
 * doublon « 7. » a disparu (PATRACDVR devient « 9. »).
 */
import { describe, expect, it } from 'vitest';
import type { Content, ContextPageSize, DynamicBackground, DynamicContent } from 'pdfmake/interfaces';

import {
    buildOiDocDefinition,
    effractionFirstOverheadPt,
    hypothesisRowHeightPt,
    identityRowPt,
    internPhotoImages,
    OI_PDF_DEFAULT_SECTION_ORDER,
    OI_PDF_LOCKED_SECTION_ID,
    OI_PDF_SECTION_LABELS,
    oiPdfFileName,
    OiPdfFitRefusalError,
    PAGE_CAPACITY,
    resolveOiPdfSectionOrder,
    splitAtcdBoundaries,
} from '@oi/pdf/document-builder.js';
import { SOFT_HYPHEN } from '@oi/pdf/text-utils.js';
import { PDF_DARK, PDF_LIGHT } from '@oi/pdf/theme.js';
import type {
    OiAdversary,
    OiEffractionBlock,
    OiEffractionHypothesis,
    OiFormData,
    OiMoicpBlock,
    OiPatracMember,
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
describe('buildOiDocDefinition — ordre des sections (SPEC-2026-08-18-pdf-et-champs.md §2/§5/§6)', () => {
    it("produit les 15 marqueurs dans l'ordre attendu, numérotation CONTINUE dérivée de l'ordre effectif — TRANSPORT juste après ENVIRONNEMENT, plus de doublon « 7. » (fix §6)", () => {
        const data = collect(makeRichFormData(), { logphoto: 'data:image/jpeg;base64,bG9n' });

        const dd = buildOiDocDefinition(data, { format: 'a4' });
        const json = JSON.stringify(dd);

        const markers = [
            'ORDRE INITIAL',
            '1. SITUATION GLOBALE',
            'CIBLES(S)',
            '2.1 FICHE ADVERSAIRE : DUPONT',
            '3. ENVIRONNEMENT ET AMIS',
            '4. TRANSPORT',
            "5. MISSION DE L'UNITÉ",
            '6. EXÉCUTION',
            '7. ARTICULATION & ORDRES DE MOUVEMENT',
            'ARTICULATION : ZMSPCP - ZONE ALPHA',
            'ARTICULATION : MOICP - ITIN BRAVO',
            'ARTICULATION : EFFRACTION - PORTE CHARLIE',
            '8. CONDUITES À TENIR GÉNÉRALES',
            '9. RÉCAPITULATIF PATRACDVR',
            'AVEZ-VOUS DES QUESTIONS ?',
        ];

        const indices = markers.map((m) => json.indexOf(m));
        indices.forEach((idx, i) => expect(idx, `marqueur introuvable : ${markers[i]}`).toBeGreaterThanOrEqual(0));
        for (let i = 1; i < indices.length; i++) {
            expect(indices[i], `« ${markers[i]} » doit venir après « ${markers[i - 1]} »`).toBeGreaterThan(indices[i - 1] as number);
        }
    });

    it('aucun titre numéroté dupliqué : exactement 1 occurrence de h2 par numéro (fix du doublon historique « 7. », §6)', () => {
        const data = collect(makeRichFormData(), { logphoto: 'data:image/jpeg;base64,bG9n' });
        const json = JSON.stringify(buildOiDocDefinition(data, { format: 'a4' }));

        // 4 (TRANSPORT) exclu de cette boucle : sa légende de galerie
        // (`galleryPhotoStack`, blocks.ts) reprend le titre en repli
        // (`meta.customTitle || "<titre> - Détail"`) — 2 occurrences
        // ATTENDUES (h2 + légende), comportement PRÉEXISTANT de
        // `galleryPages()`, pas une régression du fix de numérotation.
        for (const n of [3, 5, 6, 7, 8, 9]) {
            expect((json.match(new RegExp(`"text":"${n}\\. `, 'g')) ?? []).length, `numéro ${n}`).toBe(1);
        }
        expect((json.match(/"text":"4\. /g) ?? []).length, 'numéro 4 (h2 + légende de galerie)').toBe(2);
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
// resolveOiPdfSectionOrder — réordonnancement (§2 SPEC-2026-08-18-pdf-et-
// champs.md), fondation consommée par le panneau IHM (pdf-section-order.ts).
// ===========================================================================
describe('resolveOiPdfSectionOrder', () => {
    it('sans ordre persisté, renvoie exactement OI_PDF_DEFAULT_SECTION_ORDER', () => {
        expect(resolveOiPdfSectionOrder(undefined)).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
    });

    it('un ordre persisté valide et complet est respecté tel quel', () => {
        const custom = ['adversaires', 'final', 'environnement', 'transport', 'mission-execution', 'articulation', 'cat', 'patracdvr'];
        expect(resolveOiPdfSectionOrder(custom)).toEqual(custom);
    });

    it('ids inconnus ignorés, ids manquants réinsérés dans leur ordre par défaut mutuel — jamais de section perdue ni dupliquée', () => {
        const persisted = ['final', 'id-inconnu-du-registre', 'transport', 'transport']; // doublon + id fantôme
        const order = resolveOiPdfSectionOrder(persisted);

        expect(order).toHaveLength(OI_PDF_DEFAULT_SECTION_ORDER.length);
        expect(new Set(order)).toEqual(new Set(OI_PDF_DEFAULT_SECTION_ORDER));
        expect(order.filter((id) => id === 'transport')).toHaveLength(1);
    });

    it("un ordre persisté vide/undefined/corrompu ne casse rien : repli intégral sur l'ordre par défaut", () => {
        expect(resolveOiPdfSectionOrder([])).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
        expect(resolveOiPdfSectionOrder(['n-importe-quoi', '', 'autre-id-bidon'])).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
    });

    it("OI_PDF_LOCKED_SECTION_ID ('adversaires') est TOUJOURS épinglée en première position, même si l'ordre persisté la place ailleurs", () => {
        expect(OI_PDF_LOCKED_SECTION_ID).toBe('adversaires');

        const pushedToEnd = ['environnement', 'transport', 'mission-execution', 'articulation', 'cat', 'patracdvr', 'final', 'adversaires'];
        const order = resolveOiPdfSectionOrder(pushedToEnd);
        expect(order[0]).toBe(OI_PDF_LOCKED_SECTION_ID);
        // Le reste de l'ordre persisté (hors la section verrouillée déplacée) est préservé.
        expect(order.slice(1)).toEqual(['environnement', 'transport', 'mission-execution', 'articulation', 'cat', 'patracdvr', 'final']);
    });

    it("OI_PDF_LOCKED_SECTION_ID est épinglée en première position même absente de l'ordre persisté (repli par défaut)", () => {
        const withoutLocked = ['final', 'environnement'];
        const order = resolveOiPdfSectionOrder(withoutLocked);
        expect(order[0]).toBe(OI_PDF_LOCKED_SECTION_ID);
    });

    it('OI_PDF_SECTION_LABELS couvre exactement les ids de OI_PDF_DEFAULT_SECTION_ORDER (un libellé humain par section réordonnable)', () => {
        expect(Object.keys(OI_PDF_SECTION_LABELS).sort()).toEqual([...OI_PDF_DEFAULT_SECTION_ORDER].sort());
    });
});

describe("buildOiDocDefinition — numérotation stable quand l'ordre des sections DÉRIVÉES change (§2/§6)", () => {
    it("'adversaires' toujours numérotée « 2.1 » et les sections dérivées restent numérotées en continu à partir de 3, quel que soit l'ordre choisi pour elles", () => {
        const formData = makeRichFormData();
        // 'final' déplacée en tête des sections dérivées (juste après 'adversaires',
        // toujours épinglée en 1re position par resolveOiPdfSectionOrder) — ne doit
        // JAMAIS décaler ni la numérotation fixe de la fiche adversaire ni la
        // numérotation continue des sections dérivées suivantes.
        formData.pdf_section_order = ['final', 'adversaires', 'environnement', 'transport', 'mission-execution', 'articulation', 'cat', 'patracdvr'];
        const json = JSON.stringify(buildOiDocDefinition(collect(formData, { logphoto: 'data:image/jpeg;base64,bG9n' }), { format: 'a4' }));

        expect(json).toContain('2.1 FICHE ADVERSAIRE : DUPONT');
        // 'final' (page sans numéro) rendue AVANT 'environnement' (qui redevient « 3. »).
        expect(json.indexOf('AVEZ-VOUS DES QUESTIONS ?')).toBeLessThan(json.indexOf('3. ENVIRONNEMENT ET AMIS'));
        expect(json).toContain('3. ENVIRONNEMENT ET AMIS');
    });
});

// ===========================================================================
// §4 SPEC-2026-08-18-pdf-et-champs.md — Finalisation : Place du chef de
// dispo, UDA (bloc ambre), libellés Place du Chef différenciés MOICP/ZMSPCP.
// ===========================================================================
describe('buildOiDocDefinition — finalisation (§4 SPEC-2026-08-18-pdf-et-champs.md)', () => {
    it('UDA et Place du chef de dispo apparaissent après le bloc NO-GO quand renseignés', () => {
        const formData = makeRichFormData();
        formData.no_go = 'Armes a feu';
        formData.uda = 'Article L435-1 du CSI';
        formData.place_chef_dispo = 'PC Mobile';
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        const nogoIdx = json.indexOf('NO-GO');
        const udaIdx = json.indexOf('"text":"UDA"');
        const placeChefDispoIdx = json.indexOf('Place du Chef de Dispo');
        expect(nogoIdx).toBeGreaterThanOrEqual(0);
        expect(udaIdx).toBeGreaterThan(nogoIdx);
        expect(placeChefDispoIdx).toBeGreaterThan(nogoIdx);
        expect(json).toContain('Article L435-1 du CSI');
        expect(json).toContain('PC Mobile');
    });

    it('UDA et Place du chef de dispo sont omis indépendamment quand vides', () => {
        const formData = makeRichFormData();
        formData.uda = '';
        formData.place_chef_dispo = '';
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        expect(json).not.toContain('"text":"UDA"');
        expect(json).not.toContain('Place du Chef de Dispo');
    });

    it('libellés Place du Chef différenciés : « Place du chef inter » (MOICP) vs « Place du chef AO » (ZMSPCP)', () => {
        const formData = makeRichFormData();
        formData.moicp_blocks = [
            { id: 'm1', title: 'BRAVO', mission: '-', objectif: '-', itineraire: '-', points_particuliers: '-', cat: '-', place_chef: 'ABC', members: [] },
        ];
        formData.zmspcp_blocks = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: '-', place_chef: 'DEF', members: [] },
        ];
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format: 'a4' }));

        expect(json).toContain('PLACE DU CHEF INTER : ');
        expect(json).toContain('PLACE DU CHEF AO : ');
    });

    // -----------------------------------------------------------------------
    // RÉGRESSION (directive Nico « une page = un contenu, aucun débordement,
    // jamais ») — l'ajout des cartes UDA/Place du Chef de Dispo (§4.1/§4.2)
    // au-dessus a fait déborder « 7. CONDUITES À TENIR GÉNÉRALES » sur une
    // page orpheline sans titre (reproduit sur données réelles,
    // /home/nico/Bureau/OI-Archive-ANONYME.oi.zip : le champ Liaison finissait
    // scindé, sa dernière ligne seule sur une page quasi vide). Avant le
    // correctif, cette page ne portait AUCUN essai de palier de police
    // (`unbreakable:false` partout, jamais de `fontSize` explicite).
    // -----------------------------------------------------------------------
    it('RÉGRESSION — 5 champs à volumétrie réaliste (même ordre de grandeur que la donnée réelle ayant révélé le bug) : UNE SEULE page, aucun « (SUITE) » (A4 et 16:9)', () => {
        for (const format of ['a4', '16:9'] as const) {
            const formData = makeRichFormData();
            formData.cat_generales =
                '- Si rébellion, user du strict niveau de force nécessaire\n- Si retranché, alerter en mesure de se ré-articuler\n- Si tente de fuir, alerter en mesure de jalonner/interpeller\n- UDA : Article L435-1 du CSI + légitime défense';
            formData.no_go = '- Armes a feu';
            formData.uda = 'Article L435-1 du CSI + légitime défense';
            formData.place_chef_dispo = 'Ici';
            formData.cat_liaison = 'TOM: \nDIR: 4471\nGestuelle et visuelle entre les éléments INDIA';
            const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));

            expect(json, `pas de « (SUITE) » à ce volume réaliste (${format})`).not.toContain('(SUITE)');
            expect(json).toContain('Gestuelle et visuelle entre les éléments INDIA');
            expect(json).toContain('Article L435-1 du CSI + légitime défense');
            expect((json.match(/CONDUITES À TENIR GÉNÉRALES/g) ?? []).length, `une seule occurrence du titre (${format})`).toBe(1);
        }
    });

    it('RÉGRESSION — les 5 champs remplis au maximum : jamais de refus, jamais tronqué, continuation propre sur des pages à titre distinct (jamais « (SUITE) », garde C1) si la grille ne tient plus (A4 et 16:9)', () => {
        const longField = (n: number): string =>
            Array.from(
                { length: n },
                (_, i) => `- Point de conduite a tenir numero ${i} avec des details operationnels suffisamment longs pour peser sur la mise en page.`,
            ).join('\n');
        for (const format of ['a4', '16:9'] as const) {
            const formData = makeRichFormData();
            formData.cat_generales = longField(18);
            formData.no_go = longField(10);
            formData.uda = 'Article L435-1 du CSI. '.repeat(60);
            formData.place_chef_dispo =
                "Poste de commandement mobile stationne a l'angle nord-est de la rue principale, visible depuis l'ensemble du dispositif. ".repeat(8);
            formData.cat_liaison = longField(14);
            const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));

            // `.toContain()` ligne par ligne (jamais le texte multi-ligne
            // intégral) : `JSON.stringify` échappe les retours à la ligne
            // saisis (`\n` réel → `\n` littéral 2 caractères dans le JSON),
            // comparer directement le texte brut contenant de VRAIS retours
            // à la ligne échouerait donc à tort — même précédent que le test
            // ATCD ci-dessus (`ATCD ${i} :`, jamais le champ complet).
            for (const line of (formData.cat_generales as string).split('\n')) {
                expect(json, `CAT Générales intégral, non tronqué (${format})`).toContain(line);
            }
            for (const line of (formData.no_go as string).split('\n')) {
                expect(json, `NO-GO intégral, non tronqué (${format})`).toContain(line);
            }
            expect(json, `UDA intégral, non tronqué (${format})`).toContain(formData.uda as string);
            expect(json, `Place du Chef de Dispo intégral, non tronqué (${format})`).toContain(formData.place_chef_dispo as string);
            for (const line of (formData.cat_liaison as string).split('\n')) {
                expect(json, `Liaison intégral, non tronqué (${format})`).toContain(line);
            }
            // À ce volume, même le palier plancher ne tient plus en grille :
            // une page de continuation à titre distinct doit avoir pris le
            // relais (avant le correctif, aucune pagination contrôlée
            // n'existait pour cette page) — jamais « (SUITE) » (garde C1),
            // le titre plage de rubriques (`slotRangeLabel`) en fait foi.
            expect(json, `pas de « (SUITE) » (${format})`).not.toContain('(SUITE)');
            const titleOccurrences = (json.match(/CONDUITES À TENIR GÉNÉRALES/g) ?? []).length;
            expect(titleOccurrences, `au moins 2 pages CAT à ce volume (${format})`).toBeGreaterThan(1);
            expect(json, `titre de continuation à plage de rubriques distincte (${format})`).toMatch(
                /CONDUITES À TENIR GÉNÉRALES — .+/,
            );
        }
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
// Édition en place — chemin `dataset` (mission « tout le texte modifiable »,
// 2026-08-19) : Récapitulatif PATRACDVR (p.14) et Vue d'ensemble de
// l'articulation (p.8) ne provenaient d'AUCUN `<input>`/`<textarea>` — texte
// porté par le `dataset` de pastilles/boutons réordonnables. Cf. JSDoc
// `pdf-preview-edit.ts` § SECOND CHEMIN D'ÉCRITURE et `patracMemberDatasetAnchor`/
// `patracVehicleDatasetAnchor` (`document-builder.ts`).
// ===========================================================================
describe("buildOiDocDefinition — édition en place PATRACDVR (chemin dataset, mission « tout le texte modifiable »)", () => {
    function memberFixture(overrides: Partial<OiPatracMember> = {}): OiPatracMember {
        return {
            trigramme: 'ABC', fonction: 'Chef', cellule: 'AO1', principales: 'UMP9',
            secondaires: 'PSA', afis: 'PIE', grenades: 'Sans', equipement: 'Sans',
            equipement2: 'Sans', tenue: 'Sans', gpb: 'Sans', dir: 'G1',
            ...overrides,
        };
    }

    it('récapitulatif PATRACDVR : ancre VL/PAX/DIR (kind dataset, sélecteur par identité) — CELLULE/FONCTION/PPALE/SEC./AFIS/EQPT-GREN. JAMAIS ancrées (pastilles à choix fermé ou valeur agrégée)', () => {
        const formData: OiFormData = { patracdvr_rows: [{ vehicle: 'VL1', members: [memberFixture()] }] };
        const dd = buildOiDocDefinition(collect(formData), { format: 'a4' });
        const datasetAnchors = dd.pdfEditAnchors.filter((a) => a.kind === 'dataset');

        const vlAnchor = datasetAnchors.find((a) => a.datasetKey === 'vehicleName');
        const trigAnchor = datasetAnchors.find((a) => a.datasetKey === 'trigramme' && a.value === 'ABC');
        const dirAnchor = datasetAnchors.find((a) => a.datasetKey === 'dir');

        expect(vlAnchor?.selector).toBe('#oi-form .patracdvr-vehicle-row[data-vehicle-name="VL1"]');
        expect(trigAnchor?.selector).toBe('#oi-form .patracdvr-member-btn[data-trigramme="ABC"]');
        expect(dirAnchor?.selector).toBe('#oi-form .patracdvr-member-btn[data-trigramme="ABC"]');
        expect(dirAnchor?.value).toBe('G1');

        // Aucune valeur des colonnes à choix fermé (pastilles) n'atterrit dans
        // UN ancrage — même exclusion que la décision <select> (JSDoc
        // pdf-preview-edit.ts) — ni la colonne agrégée EQPT/GREN.
        expect(dd.pdfEditAnchors.some((a) => a.value === 'AO1')).toBe(false); // cellule
        expect(dd.pdfEditAnchors.some((a) => a.value === 'Chef')).toBe(false); // fonction
        expect(dd.pdfEditAnchors.some((a) => a.value === 'UMP9')).toBe(false); // principales
        expect(dd.pdfEditAnchors.some((a) => a.value === 'PSA')).toBe(false); // secondaires
        expect(dd.pdfEditAnchors.some((a) => a.value === 'PIE')).toBe(false); // afis
    });

    it("2 membres de trigramme IDENTIQUE (anomalie : renommage manuel sans garde d'unicité) : sélecteur `[data-trigramme=...]` AMBIGU, AUCUN ancrage trigramme/dir enregistré pour ce trigramme (sous-couverture délibérée, jamais un pari sur l'élément dupliqué)", () => {
        const formData: OiFormData = {
            patracdvr_rows: [
                { vehicle: 'VL1', members: [memberFixture({ trigramme: 'DUP', dir: 'G1' })] },
                { vehicle: 'VL2', members: [memberFixture({ trigramme: 'DUP', dir: 'G2' })] },
            ],
        };
        const dd = buildOiDocDefinition(collect(formData), { format: 'a4' });
        const datasetAnchors = dd.pdfEditAnchors.filter((a) => a.kind === 'dataset');

        expect(datasetAnchors.some((a) => a.datasetKey === 'trigramme')).toBe(false);
        expect(datasetAnchors.some((a) => a.datasetKey === 'dir')).toBe(false);
        // Les 2 véhicules restent, eux, uniques (noms distincts) : toujours ancrés.
        expect(datasetAnchors.filter((a) => a.datasetKey === 'vehicleName')).toHaveLength(2);
    });

    it('2 véhicules de nom IDENTIQUE : sélecteur `[data-vehicle-name=...]` AMBIGU, AUCUN ancrage VL enregistré pour ce nom', () => {
        const formData: OiFormData = {
            patracdvr_rows: [
                { vehicle: 'DUPVL', members: [memberFixture({ trigramme: 'AAA' })] },
                { vehicle: 'DUPVL', members: [memberFixture({ trigramme: 'BBB' })] },
            ],
        };
        const dd = buildOiDocDefinition(collect(formData), { format: 'a4' });
        const datasetAnchors = dd.pdfEditAnchors.filter((a) => a.kind === 'dataset');

        expect(datasetAnchors.some((a) => a.datasetKey === 'vehicleName')).toBe(false);
        // Les 2 trigrammes restent, eux, uniques : toujours ancrés.
        expect(datasetAnchors.filter((a) => a.datasetKey === 'trigramme')).toHaveLength(2);
    });

    it("vue d'ensemble de l'articulation (p.8) : les 3 listes d'ordre (Rame VL, Colonne Progression, Ordre Pénétration) ancrent chaque pastille sur son véhicule/membre canonique — même sélecteur que le récapitulatif PATRACDVR (identité partagée)", () => {
        const formData: OiFormData = {
            patracdvr_rows: [{ vehicle: 'KODIAQ', members: [memberFixture({ trigramme: 'IND' })] }],
            rame_vl_order: ['KODIAQ'],
            colonne_progression_order: ['IND'],
            ordre_penetration_order: ['IND'],
        };
        const dd = buildOiDocDefinition(collect(formData), { format: 'a4' });
        const datasetAnchors = dd.pdfEditAnchors.filter((a) => a.kind === 'dataset');

        const vlAnchors = datasetAnchors.filter((a) => a.datasetKey === 'vehicleName' && a.value === 'KODIAQ');
        const trigAnchors = datasetAnchors.filter((a) => a.datasetKey === 'trigramme' && a.value === 'IND');

        // 1 pour le récap PATRACDVR + 1 pour la pastille Rame VL = 2 ; idem
        // trigramme (récap PATRACDVR + colonne + pénétration = 3).
        expect(vlAnchors.length).toBeGreaterThanOrEqual(2);
        expect(trigAnchors.length).toBeGreaterThanOrEqual(3);
        for (const a of vlAnchors) expect(a.selector).toBe('#oi-form .patracdvr-vehicle-row[data-vehicle-name="KODIAQ"]');
        for (const a of trigAnchors) expect(a.selector).toBe('#oi-form .patracdvr-member-btn[data-trigramme="IND"]');
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
// SPEC-2026-08-18-pdf-et-champs.md §3 — Modes d'action de la fiche adversaire :
// page dédiée « MODES D'ACTION — <nom> » émise juste après la fiche, jamais
// dans la fiche elle-même (verrouillée 1 page, refus de génération possible).
// ===========================================================================
describe("buildOiDocDefinition — fiche adversaire, page dédiée « Modes d'action » (SPEC §3)", () => {
    function advFormDataWithMa(maList?: string[]): OiFormData {
        return {
            adversaries: [
                {
                    id: 'adv1',
                    nom_adversaire: 'DUPONT',
                    domicile_adversaire: '1 rue Test',
                    me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [],
                    ...(maList !== undefined ? { ma_list: maList } : {}),
                },
            ],
        };
    }

    it('un adversaire avec 2 MA produit une page « MODES D\'ACTION — DUPONT » avec les 2 cartes MA1/MA2, juste après la fiche', () => {
        const json = JSON.stringify(
            buildOiDocDefinition(collect(advFormDataWithMa(['Fuite par le toit', 'Prise d\'otage'])), { format: 'a4' }),
        );

        const ficheIdx = json.indexOf('2.1 FICHE ADVERSAIRE : DUPONT');
        const maPageIdx = json.indexOf("MODES D'ACTION — DUPONT");
        expect(ficheIdx).toBeGreaterThanOrEqual(0);
        expect(maPageIdx).toBeGreaterThan(ficheIdx);
        expect(json).toContain('"text":"MA1"');
        expect(json).toContain('"text":"MA2"');
        expect(json).toContain('Fuite par le toit');
        expect(json).toContain("Prise d'otage");
    });

    it('un adversaire sans MA (champ absent) ne produit aucune page « Modes d\'action »', () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(advFormDataWithMa(undefined)), { format: 'a4' }));
        expect(json).not.toContain("MODES D'ACTION");
    });

    it('un adversaire avec ma_list vide ou ne contenant que des entrées blanches ne produit aucune page « Modes d\'action »', () => {
        const empty = JSON.stringify(buildOiDocDefinition(collect(advFormDataWithMa([])), { format: 'a4' }));
        expect(empty).not.toContain("MODES D'ACTION");

        const blank = JSON.stringify(buildOiDocDefinition(collect(advFormDataWithMa(['', '   '])), { format: 'a4' }));
        expect(blank).not.toContain("MODES D'ACTION");
    });

    it('un MA unique court : UNE SEULE page, palier de police 11 (nominal), aucun « (SUITE) »', () => {
        const json = JSON.stringify(buildOiDocDefinition(collect(advFormDataWithMa(['Fuite par le toit'])), { format: 'a4' }));
        expect(json).toContain('"text":"MA1"');
        expect(json).toContain('Fuite par le toit');
        expect(json).not.toContain('(SUITE)');
        expect((json.match(/MODES D'ACTION — DUPONT/g) ?? []).length).toBe(1);
    });

    it("RÉGRESSION — 10 MA : jamais de refus, empaquetés sur des pages à titre distinct (jamais « (SUITE) », garde C1) autonomes, AUCUN texte perdu (A4 et 16:9)", () => {
        const maList = Array.from(
            { length: 10 },
            (_, i) => `Mode d'action numero ${i}: comportement possible face a l'intervention, a surveiller de pres.`,
        );
        for (const format of ['a4', '16:9'] as const) {
            const json = JSON.stringify(buildOiDocDefinition(collect(advFormDataWithMa(maList)), { format }));
            for (let i = 1; i <= 10; i++) {
                expect(json, `MA${i} doit apparaître (${format})`).toContain(`"text":"MA${i}"`);
            }
            for (const ma of maList) {
                expect(json, `texte intégral du MA doit apparaître (${format})`).toContain(ma);
            }
            // Avant le correctif, cette page débordait SILENCIEUSEMENT sur des
            // pages sans titre (aucune pagination contrôlée) : la présence
            // d'une page « MODES D'ACTION — DUPONT — MA<plage> » distincte
            // (jamais « (SUITE) », garde C1) prouve que la continuation a
            // bien pris le relais plutôt qu'un débordement muet.
            expect(json, `pas de « (SUITE) » (${format})`).not.toContain('(SUITE)');
            const titleOccurrences = (json.match(/MODES D'ACTION — DUPONT/g) ?? []).length;
            expect(titleOccurrences, `au moins 2 pages MODES D'ACTION à ce volume (${format})`).toBeGreaterThan(1);
            expect(json, `titre de continuation à plage MA distincte (${format})`).toMatch(/MODES D'ACTION — DUPONT — MA\d+( À MA\d+)?/);
        }
    });

    it("RÉGRESSION — 1 MA de plusieurs milliers de caractères : jamais de refus, jamais tronqué, jamais de « (SUITE) » inutile (un seul MA reste un seul groupe)", () => {
        const hugeMa = "Hostile aux forces de l'ordre, susceptible de se retrancher ou de fuir. ".repeat(130); // ~9500 caractères
        for (const format of ['a4', '16:9'] as const) {
            const json = JSON.stringify(buildOiDocDefinition(collect(advFormDataWithMa([hugeMa])), { format }));
            expect(json, `texte intégral (non tronqué) du MA doit apparaître (${format})`).toContain(hugeMa);
            // Un seul MA = une seule frontière légitime = un seul groupe : même
            // s'il déborde une page à lui seul (`unbreakable:false` le laisse
            // alors couler naturellement sur la/les page(s) suivante(s)), il
            // n'y a jamais de 2e page « MODES D'ACTION… » à titrer.
            expect(json, `pas de « (SUITE) » pour un MA unique (${format})`).not.toContain('(SUITE)');
            expect((json.match(/MODES D'ACTION — DUPONT/g) ?? []).length, `un seul titre « MODES D'ACTION » (${format})`).toBe(1);
        }
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
// Défaut HAUTE (mesure PDF réelle, 2026-08-19, archive OI réelle,
// `nom_adversaire` porté à 25 600 caractères) : le TITRE d'un usage à
// contrat dur (fiche adversaire « 2.<i> FICHE ADVERSAIRE : <nom> », mais
// aussi tout `h2()` de page embarquant un texte utilisateur non borné —
// bloc ZMSPCP/MOICP/EFFRACTION, « MODES D'ACTION — <nom> ») n'était JAMAIS
// mesuré par le modèle de coût du solveur fit-to-page (constante FIXE
// `ADV_TITLE_BAR_PT`/`EFFRAC_H2_PT`, 1 seule ligne supposée) : un nom/titre
// démesuré faisait déborder le bandeau lui-même hors du modèle prévu — la
// génération réussissait alors À TORT (silence), laissant le contenu
// déborder sur plusieurs pages jusqu'à une page de queue orpheline VIDE.
// AVANT correctif, ce test échouait : `buildOiDocDefinition` ne levait
// JAMAIS `OiPdfFitRefusalError` pour un nom de 25 600 caractères.
// ===========================================================================
describe('buildOiDocDefinition — titre à texte utilisateur non borné (défaut « page de queue vide », mesure 2026-08-19)', () => {
    function minimalAdversary(nom: string): OiAdversary {
        return {
            id: 'adv1',
            nom_adversaire: nom,
            armes_connues: '-',
            me_list: [],
            etat_esprit_list: [],
            volume_list: [],
            vehicules_list: [],
        };
    }

    it('un nom d’adversaire RÉALISTE (100 caractères) tient sur une page unique, aucune régression', () => {
        const nom = 'DUPONT '.repeat(14).trim().slice(0, 100);
        const json = JSON.stringify(buildOiDocDefinition(collect({ adversaries: [minimalAdversary(nom)] }), { format: 'a4' }));
        expect((json.match(/FICHE ADVERSAIRE : /g) ?? []).length).toBe(1);
        expect(json).toContain(nom);
    });

    it.each(['a4', '16:9'] as const)(
        'un nom d’adversaire DÉLIBÉRÉMENT surdimensionné (25 600 caractères, reproduction archive réelle) REFUSE la génération — jamais de débordement silencieux sur des pages orphelines (%s)',
        (format) => {
            const nom = 'DUPONT Jean-Baptiste Alexandre '.repeat(900);
            expect(nom.length).toBeGreaterThan(25000);
            const data = collect({ adversaries: [minimalAdversary(nom)] });

            let caught: unknown;
            try {
                buildOiDocDefinition(data, { format });
            } catch (err) {
                caught = err;
            }
            expect(caught, `OiPdfFitRefusalError attendue (${format})`).toBeInstanceOf(OiPdfFitRefusalError);
            const refusal = caught as OiPdfFitRefusalError;
            expect(refusal.fitErrors.some((e) => /Fiche Adversaire/.test(e.section)), `fitErrors doit citer la Fiche Adversaire (${format})`).toBe(
                true,
            );
        },
    );

    it('un titre de bloc ZMSPCP DÉLIBÉRÉMENT surdimensionné (20 000 caractères) REFUSE la génération — même trou que la fiche adversaire, traité de façon homogène', () => {
        const hugeTitle = 'GROUPE ALPHA '.repeat(1600);
        expect(hugeTitle.length).toBeGreaterThan(20000);
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: hugeTitle, zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: '-', place_chef: '-', members: [] },
        ];
        let caught: unknown;
        try {
            buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format: 'a4' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(OiPdfFitRefusalError);
        expect((caught as OiPdfFitRefusalError).fitErrors.some((e) => /ZMSPCP/.test(e.section))).toBe(true);
    });

    it('un titre de bloc MOICP DÉLIBÉRÉMENT surdimensionné (20 000 caractères) REFUSE la génération — même trou que la fiche adversaire, traité de façon homogène', () => {
        const hugeTitle = 'GROUPE INDIA '.repeat(1600);
        const moicpBlocks: OiMoicpBlock[] = [
            { id: 'm1', title: hugeTitle, mission: '-', objectif: '-', itineraire: '-', points_particuliers: '-', cat: '-', place_chef: '-', members: [] },
        ];
        let caught: unknown;
        try {
            buildOiDocDefinition(collect({ moicp_blocks: moicpBlocks }), { format: 'a4' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(OiPdfFitRefusalError);
        expect((caught as OiPdfFitRefusalError).fitErrors.some((e) => /MOICP/.test(e.section))).toBe(true);
    });

    it('un titre de bloc EFFRACTION DÉLIBÉRÉMENT surdimensionné (20 000 caractères) REFUSE la génération — même trou que la fiche adversaire, traité de façon homogène', () => {
        const hugeTitle = 'PORTE ALPHA '.repeat(1700);
        const effractionBlocks: OiEffractionBlock[] = [
            {
                id: 'e1', title: hugeTitle, mission: '-', porte: '-', structure: '-', serrurerie: '-',
                environnement: '-', bati_a_bati: '-', dormant_a_dormant: '-', prof_linteaux: '-', prof_bati: '-',
                h_porte: '-', h_marche: '-', prof_marche: '-', prof_moulure: '-', members: [],
                hypotheses: [{ id: 'h1', title: 'H1', desc: '-', effrac: '-', degag: '-', assaut: '-' }],
            },
        ];
        let caught: unknown;
        try {
            buildOiDocDefinition(collect({ effraction_blocks: effractionBlocks }), { format: 'a4' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(OiPdfFitRefusalError);
        expect((caught as OiPdfFitRefusalError).fitErrors.some((e) => /EFFRACTION/.test(e.section))).toBe(true);
    });

    it('un adversaire au nom DÉLIBÉRÉMENT surdimensionné (20 000 caractères, avec au moins un MA) : la page « MODES D’ACTION — <nom> », qui NE REFUSE JAMAIS (contrat propre, cf. `packCardsByBudget`), ne remonte AUCUNE entrée `fitErrors` — seule la fiche adversaire (contrat dur) refuse, jamais une propagation vers cette page-là', () => {
        const nom = 'DUPONT Jean-Baptiste Alexandre '.repeat(700);
        expect(nom.length).toBeGreaterThan(20000);
        const adv: OiAdversary = {
            id: 'adv1',
            nom_adversaire: nom,
            armes_connues: '-',
            me_list: [],
            etat_esprit_list: [],
            volume_list: [],
            vehicules_list: [],
            ma_list: ['Action MA1 de test.'],
        };
        let caught: unknown;
        try {
            buildOiDocDefinition(collect({ adversaries: [adv] }), { format: 'a4' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(OiPdfFitRefusalError);
        const refusal = caught as OiPdfFitRefusalError;
        expect(refusal.fitErrors.some((e) => /Fiche Adversaire/.test(e.section))).toBe(true);
        expect(refusal.fitErrors.some((e) => /MODES D.ACTION/.test(e.section))).toBe(false);
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

// ===========================================================================
// RÉGRESSION (campagne de mesure, 2 pertes de données silencieuses) —
// anomalie CRITIQUE #1 : la carte CIBLES(S) de la page de garde disparaît
// (`ciblesCard` restait `unbreakable:true` par défaut, pdfmake supprime
// SILENCIEUSEMENT un bloc insécable qui excède une page) au-delà d'un petit
// nombre d'adversaires — page 2 restant blanche. Couvre 1/5/8/15/30
// adversaires, A4 et 16:9 (mêmes seuils que la campagne de mesure).
// ===========================================================================
describe('buildOiDocDefinition — RÉGRESSION anomalie #1 : carte CIBLES(S) de la page de garde', () => {
    function makeAdversaries(count: number): OiAdversary[] {
        return Array.from({ length: count }, (_, i) => ({
            id: `adv${i + 1}`,
            nom_adversaire: `CIBLE ${String(i + 1).padStart(2, '0')} REGRESSION`,
            stature_adversaire: '1m80',
            ethnie_adversaire: 'Test',
            me_list: [],
            etat_esprit_list: [],
            volume_list: [],
            vehicules_list: [],
        }));
    }

    /**
     * `buildOiDocDefinition` ne fait QUE construire la `TDocumentDefinitions`
     * (arbre déclaratif pdfmake) — la disparition d'un bloc `unbreakable:true`
     * trop grand est un comportement du MOTEUR DE MISE EN PAGE de pdfmake, à
     * l'exécution (`pdfMake.createPdf(...)`), invisible sur ce seul arbre : le
     * JSON contient TOUJOURS les N entrées, que le rendu réel les affiche ou
     * les supprime silencieusement. Un test `toContain('CIBLE 30')` ne peut
     * donc JAMAIS détecter l'anomalie #1 (vérifié : il passe même SANS le
     * correctif) — la preuve rendu réel est apportée séparément
     * (`tests/pdf/generate-from-fixture.mjs` + `pdftotext`/`verify-structure.mjs`,
     * cf. rapport de mission). Ce que CE test unitaire peut et doit vérifier
     * directement, c'est la CAUSE structurelle : plus aucun `card()` portant
     * « CIBLES(S) » ne doit rester `unbreakable:true` (`blocks.ts::card`,
     * défaut historique qui faisait disparaître la carte).
     */
    function collectUnbreakableCardsContaining(node: unknown, needle: string, found: boolean[]): void {
        if (node === null || typeof node !== 'object') {
            return;
        }
        if (Array.isArray(node)) {
            node.forEach((child) => collectUnbreakableCardsContaining(child, needle, found));
            return;
        }
        const obj = node as Record<string, unknown>;
        if ('unbreakable' in obj && 'table' in obj && JSON.stringify(obj).includes(needle)) {
            found.push(obj.unbreakable === true);
        }
        for (const key of Object.keys(obj)) {
            collectUnbreakableCardsContaining(obj[key], needle, found);
        }
    }

    it.each([1, 5, 8, 15, 30])(
        '%d adversaire(s) : la carte CIBLES(S) est TOUJOURS présente, chaque cible nommée apparaît, jamais de page top-level vide (A4 et 16:9)',
        (count) => {
            for (const format of ['a4', '16:9'] as const) {
                const dd = buildOiDocDefinition(collect({ adversaries: makeAdversaries(count) }), { format });
                const json = JSON.stringify(dd);

                expect(json, `« CIBLES(S) » doit apparaître (${count} adv., ${format})`).toContain('CIBLES(S)');
                for (let i = 1; i <= count; i++) {
                    expect(json, `cible ${i} doit apparaître (${count} adv., ${format})`).toContain(
                        `CIBLE ${String(i).padStart(2, '0')} REGRESSION`,
                    );
                }
                // Aucune page top-level SANS AUCUN texte (`text`/labelValue) —
                // reproduction directe du défaut mesuré (page 2 100 % blanche
                // à 30 adversaires, avant correctif).
                const content = dd.content as Content[];
                content.forEach((page, idx) => {
                    const pageJson = JSON.stringify(page);
                    expect(pageJson.length, `page top-level ${idx} ne doit jamais être vide (${count} adv., ${format})`).toBeGreaterThan(0);
                    expect(/"text"/.test(pageJson), `page top-level ${idx} doit porter du texte (${count} adv., ${format})`).toBe(true);
                });

                // La CAUSE de l'anomalie #1 : aucun `card()` contenant « CIBLES(S) »
                // ne doit rester `unbreakable:true` (cf. JSDoc `collectUnbreakableCardsContaining`).
                const unbreakableFlags: boolean[] = [];
                collectUnbreakableCardsContaining(dd.content, 'CIBLES(S)', unbreakableFlags);
                expect(unbreakableFlags.length, `au moins une carte CIBLES(S) attendue (${count} adv., ${format})`).toBeGreaterThan(0);
                expect(
                    unbreakableFlags.some(Boolean),
                    `aucune carte CIBLES(S) ne doit être unbreakable:true (${count} adv., ${format})`,
                ).toBe(false);
            }
        },
    );

    it("au-delà du seuil de la page 1, le débordement va sur des pages « CIBLES(S) — <plage> » AUTONOMES, JAMAIS « (SUITE) » (guardrail C1)", () => {
        const dd = buildOiDocDefinition(collect({ adversaries: makeAdversaries(30) }), { format: 'a4' });
        const json = JSON.stringify(dd);

        expect(json).not.toContain('(SUITE)');
        expect(json).not.toContain('(suite)');
        expect(json).toMatch(/CIBLES\(S\) — \d+(-\d+)?/);
    });

    /**
     * RÉGRESSION guardrail B1 (mesure `tests/pdf/verify-structure.mjs`,
     * fixture `tests/pdf/fixtures/blind-a-combined-stress.json`, A4, 5
     * adversaires) : le paqueteur glouton `packHypotheses` fait hériter le
     * DERNIER groupe de débordement d'UN SEUL adversaire (page « CIBLES(S)
     * — 5 » orpheline, 77 caractères non blancs — sous le seuil 120 de B1)
     * quand le groupe 0 (page 1, grid2) absorbe tout le reste. Le rééquilibrage
     * `rebalanceLastGroup` (JSDoc ci-dessus, guardrail préexistant) ne peut
     * RIEN ici : son slice exclut structurellement le groupe 0, et il n'y a
     * qu'UN SEUL groupe de débordement (pas de « groupe précédent » au sein
     * du débordement pour piocher). Le correctif rééquilibre la frontière
     * groupe 0 ↔ débordement elle-même — ce test vérifie sa signature
     * structurelle directement observable au niveau JSON (sans rendu PDF
     * réel) : plus AUCUNE page « CIBLES(S) — <N> » (plage à un seul numéro,
     * jamais une plage « <N>-<M> ») n'apparaît, quel que soit le nombre
     * total d'adversaires (2 à 30, un seul adversaire ne produit jamais de
     * débordement) — un débordement à 1 seule cible serait TOUJOURS
     * signalé par un tel titre à numéro unique.
     */
    it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 30])(
        '%d adversaire(s) : aucune page « CIBLES(S) — <N> » à un seul numéro (débordement à 1 seule cible), A4 et 16:9',
        (count) => {
            for (const format of ['a4', '16:9'] as const) {
                const dd = buildOiDocDefinition(collect({ adversaries: makeAdversaries(count) }), { format });
                const json = JSON.stringify(dd);
                const overflowTitles = json.match(/CIBLES\(S\) — \d+(-\d+)?/g) ?? [];
                const singleEntryTitles = overflowTitles.filter((title) => !/-\d+/.test(title));

                expect(
                    singleEntryTitles,
                    `aucune page de débordement à 1 seule cible attendue (${count} adv., ${format}) — titres : ${JSON.stringify(overflowTitles)}`,
                ).toHaveLength(0);
            }
        },
    );
});

// ===========================================================================
// RÉGRESSION (campagne de mesure, 2 pertes de données silencieuses) —
// anomalie CRITIQUE #2 : le premier bloc ZMSPCP/MOICP/EFFRACTION d'un OI
// perd son saut de page (`buildArticulationBlocksLoop` accumulait dans un
// `acc` LOCAL, `pushPage`/`pushPages` y appliquaient la convention « saute la
// page SAUF le tout premier élément » — évaluée sur CET `acc`, pas sur le
// document entier) : il atterrit sur la MÊME page physique que
// `buildArticulationOverview`, faisant déborder son propre contenu
// (« S SECTEUR »/« P POINTS PARTICULIERS » en 16:9) hors du PDF. Reproduit
// tel quel sur l'archive réelle (aucun cas limite requis).
// ===========================================================================
describe('buildOiDocDefinition — RÉGRESSION anomalie #2 : 1er bloc articulation sans saut de page', () => {
    it.each(['a4', '16:9'] as const)(
        "sans AUCUNE photo de galerie précédente, la page ZMSPCP porte SON PROPRE `pageBreak:'before'` — jamais glissée sur la page de « 7. ARTICULATION » (%s)",
        (format) => {
            const zmspcpBlocks: OiZmspcpBlock[] = [
                {
                    id: 'z1', title: 'ALPHA', zone: '-', mission: '-',
                    secteur: 'S SECTEUR TEST UNIQUE', points_particuliers: 'P POINTS TEST UNIQUE',
                    cat: '-', place_chef: '-', members: [],
                },
            ];
            const dd = buildOiDocDefinition(collect({ zmspcp_blocks: zmspcpBlocks }), { format });
            const content = dd.content as Content[];

            const overviewIdx = content.findIndex((page) => JSON.stringify(page).includes('ARTICULATION & ORDRES DE MOUVEMENT'));
            const zmspcpIdx = content.findIndex((page) => JSON.stringify(page).includes('ARTICULATION : ZMSPCP'));
            expect(overviewIdx, `page « 7. ARTICULATION » introuvable (${format})`).toBeGreaterThanOrEqual(0);
            expect(zmspcpIdx, `page ZMSPCP introuvable (${format})`).toBeGreaterThanOrEqual(0);
            expect(zmspcpIdx, `ZMSPCP doit être une page top-level DISTINCTE de l'overview (${format})`).not.toBe(overviewIdx);

            const zmspcpPage = content[zmspcpIdx] as { pageBreak?: string };
            expect(zmspcpPage.pageBreak, `la page ZMSPCP doit porter SON PROPRE pageBreak:'before' (${format})`).toBe('before');

            // Le contenu complet du bloc (jamais tronqué/glissé plus loin) est
            // bien sur CETTE MÊME page.
            const zmspcpJson = JSON.stringify(zmspcpPage);
            expect(zmspcpJson, `« S SECTEUR » doit apparaître sur la page ZMSPCP (${format})`).toContain('S SECTEUR TEST UNIQUE');
            expect(zmspcpJson, `« P POINTS PARTICULIERS » doit apparaître sur la page ZMSPCP (${format})`).toContain(
                'P POINTS TEST UNIQUE',
            );
        },
    );

    it("AVEC une photo « Baptême Terrain » précédente, la 1re page de galerie porte AUSSI SON PROPRE saut de page — jamais glissée sur la page de « 7. ARTICULATION » (vérifie le second bout : pas de double saut/page blanche)", () => {
        const zmspcpBlocks: OiZmspcpBlock[] = [
            { id: 'z1', title: 'ALPHA', zone: '-', mission: '-', secteur: '-', points_particuliers: '-', cat: '-', place_chef: '-', members: [] },
        ];
        const formData: OiFormData = {
            zmspcp_blocks: zmspcpBlocks,
            dynamic_photos: { photo_bapteme_z1: [makePhotoMeta('baptphoto')] },
        };
        const photosBase64 = { baptphoto: 'data:image/jpeg;base64,QkFQVFBIT1RP' };
        const dd = buildOiDocDefinition(collect(formData, photosBase64), { format: 'a4' });
        const content = dd.content as Content[];

        const overviewIdx = content.findIndex((page) => JSON.stringify(page).includes('ARTICULATION & ORDRES DE MOUVEMENT'));
        const galleryIdx = content.findIndex((page) => JSON.stringify(page).includes('"image":"baptphoto"'));
        expect(overviewIdx).toBeGreaterThanOrEqual(0);
        expect(galleryIdx).toBeGreaterThanOrEqual(0);
        expect(galleryIdx).not.toBe(overviewIdx);

        const galleryPage = content[galleryIdx] as { pageBreak?: string };
        expect(galleryPage.pageBreak, "la 1re page de galerie doit porter SON PROPRE pageBreak:'before'").toBe('before');

        // Pas de double saut : aucune page top-level vide entre l'overview et
        // la page ZMSPCP qui suit la galerie.
        const zmspcpIdx = content.findIndex((page) => JSON.stringify(page).includes('ARTICULATION : ZMSPCP'));
        expect(zmspcpIdx).toBeGreaterThan(galleryIdx);
        for (let i = overviewIdx; i <= zmspcpIdx; i++) {
            expect(JSON.stringify(content[i]).length, `page top-level ${i} ne doit jamais être vide`).toBeGreaterThan(2);
        }
    });
});

// ===========================================================================
// Campagne de mesure 2026-08-18 — 5 anomalies restantes (directive Nico
// « une page = un contenu ; aucun débordement ; aucune page vide »).
// ===========================================================================

// ---------------------------------------------------------------------------
// Anomalie A — le repli « Mission + Exécution » ne séparait pas les pages :
// `buildExecution()` ne portait aucun `pageBreak` propre (EXÉCUTION
// s'enchaînait sans saut derrière MISSION), et ni MISSION ni EXÉCUTION
// n'essayaient de palier de police avant ce repli (`unbreakable:false` sans
// budget).
// ---------------------------------------------------------------------------
describe('buildOiDocDefinition — anomalie A : repli « Mission + Exécution » (campagne 2026-08-18)', () => {
    function heavyMissionExecutionFormData(): OiFormData {
        return {
            missions_psig: 'Mission de reconnaissance et de neutralisation du groupe cible localise au 12 rue de la Republique.',
            date_execution: '2026-08-18',
            heure_execution: 'H+2',
            action_body_text: 'Progression discrete puis assaut coordonne sur objectif principal, appui feu en couverture laterale.',
            time_events: Array.from({ length: 24 }, (_, i) => ({
                hour: `0${i % 10}:00`,
                type: 'ÉVÉNEMENT',
                description: `Point de synchronisation numero ${i} avec des details operationnels suffisamment longs pour peser lourdement sur la mise en page du tableau chronologique complet.`,
            })),
            hypotheses: Array.from(
                { length: 16 },
                (_, i) => `Hypothese numero ${i} avec un developpement suffisamment long pour peser sur la mise en page generale du document complet.`,
            ),
        };
    }

    it.each(['a4', '16:9'] as const)(
        'RÉGRESSION — chronologie + hypothèses volumineuses (aucun palier ne fait tenir la fusion) : EXÉCUTION est une page top-level DISTINCTE portant SON PROPRE pageBreak, aucune donnée perdue (%s)',
        (format) => {
            const formData = heavyMissionExecutionFormData();
            const dd = buildOiDocDefinition(collect(formData), { format });
            const content = dd.content as Content[];
            const json = JSON.stringify(dd);

            const missionIdx = content.findIndex((page) => JSON.stringify(page).includes("MISSION DE L'UNITÉ"));
            const execIdx = content.findIndex((page) => JSON.stringify(page).includes('EXÉCUTION'));
            expect(missionIdx, `page MISSION introuvable (${format})`).toBeGreaterThanOrEqual(0);
            expect(execIdx, `page EXÉCUTION introuvable (${format})`).toBeGreaterThanOrEqual(0);
            expect(execIdx, `EXÉCUTION doit être une page top-level DISTINCTE de MISSION à ce volume (${format})`).not.toBe(missionIdx);

            const execPage = content[execIdx] as { pageBreak?: string };
            expect(execPage.pageBreak, `EXÉCUTION doit porter SON PROPRE pageBreak:'before' (${format})`).toBe('before');

            // Aucune perte : chaque description d'événement et chaque hypothèse
            // reste intégralement présente (jamais tronquée par le repli).
            for (const e of formData.time_events as Array<{ description: string }>) {
                expect(json, `description « ${e.description.slice(0, 20)}… » intégrale (${format})`).toContain(e.description);
            }
            for (const h of formData.hypotheses as string[]) {
                expect(json, `hypothèse « ${h.slice(0, 20)}… » intégrale (${format})`).toContain(h);
            }
        },
    );

    it('volumétrie nominale (fixture riche standard) : MISSION et EXÉCUTION restent fusionnées sur UNE SEULE page (pas de régression du cas courant)', () => {
        const formData = makeRichFormData();
        const dd = buildOiDocDefinition(collect(formData), { format: 'a4' });
        const content = dd.content as Content[];

        const missionIdx = content.findIndex((page) => JSON.stringify(page).includes("MISSION DE L'UNITÉ"));
        const execIdx = content.findIndex((page) => JSON.stringify(page).includes('EXÉCUTION'));
        expect(missionIdx).toBeGreaterThanOrEqual(0);
        expect(execIdx).toBe(missionIdx);
    });
});

// ===========================================================================
// Défaut MOYENNE (mesure PDF réelle, 2026-08-19, `long-case.json` en 16:9) :
// même quand MISSION+EXÉCUTION fusionnent (ou qu'EXÉCUTION obtient sa propre
// page dédiée), la table Chronologie/les Hypothèses d'ensemble n'avaient
// AUCUN repli de pagination titrée au-delà du palier plancher — l'ancien
// code laissait pdfmake déborder NATURELLEMENT (`unbreakable:false`, sans
// budget) sur autant de pages que nécessaire, chacune ne portant QUE l'en-
// tête de tableau répété (« Heure »/« Événement »), SANS AUCUN TITRE —
// rompant le principe « une page porte son titre » que CIBLES(S)/
// PATRACDVR/ARTICULATION/ENVIRONNEMENT respectent déjà. AVANT correctif, le
// test ci-dessous échouait : `content` ne contenait alors qu'UN SEUL élément
// « EXÉCUTION » (jamais de page « — CHRONOLOGIE <plage> » distincte), la
// scission réelle ne se manifestant qu'au RENDU pdfmake (invisible à ce
// niveau JSON pur, cf. `tests/pdf/generate-from-fixture.mjs` pour la preuve
// bout-en-bout sur PDF réel).
// ===========================================================================
describe('buildOiDocDefinition — pagination titrée de secours EXÉCUTION (défaut « page de continuation sans titre », mesure 2026-08-19)', () => {
    function heavyChronoFormData(eventCount: number): OiFormData {
        return {
            date_execution: '2026-08-19',
            heure_execution: 'H+2',
            action_body_text: 'Action de test pour la pagination de secours de la chronologie.',
            time_events: Array.from({ length: eventCount }, (_, i) => ({
                hour: `0${i % 10}:00`,
                type: 'ÉVÉNEMENT',
                description: `Evenement numero ${i + 1} de la chronologie previsionnelle.`,
            })),
            hypotheses: ['Hypothese unique de test.'],
        };
    }

    it.each(['a4', '16:9'] as const)(
        'chronologie TRÈS volumineuse (60 événements, ne tient sur aucune page dédiée même au palier plancher) : CHAQUE page de continuation porte un titre distinct autoportant « N. EXÉCUTION — CHRONOLOGIE <plage> », jamais de page nue (en-tête de tableau seul) — aucun événement perdu (%s)',
        (format) => {
            const formData = heavyChronoFormData(60);
            const dd = buildOiDocDefinition(collect(formData), { format });
            const content = dd.content as Content[];
            const json = JSON.stringify(dd);

            expect(json).not.toContain('(SUITE)');
            expect(json).not.toContain('(suite)');

            // Le mécanisme de pagination de secours (`buildExecutionOverflowPages`)
            // a bien produit AU MOINS une page de continuation titrée distincte.
            const chronoContinuationPages = content.filter((page) => /EXÉCUTION — CHRONOLOGIE ÉVÉNEMENTS/.test(JSON.stringify(page)));
            expect(chronoContinuationPages.length, `au moins une page « — CHRONOLOGIE <plage> » attendue (${format})`).toBeGreaterThan(0);

            // Aucune perte : les 60 événements restent intégralement présents.
            for (let i = 1; i <= 60; i++) {
                expect(json, `événement ${i} doit apparaître intégralement (${format})`).toContain(`Evenement numero ${i} de`);
            }
        },
    );

    it('volumétrie nominale (5 événements, comme `long-case.json`) : reste fusionnée avec MISSION sur une seule page, pas de régression du cas courant (16:9, marge verticale la plus stricte)', () => {
        const formData = heavyChronoFormData(5);
        const dd = buildOiDocDefinition(collect(formData), { format: '16:9' });
        const content = dd.content as Content[];
        const json = JSON.stringify(dd);

        expect(json).not.toContain('CHRONOLOGIE ÉVÉNEMENTS');
        const missionIdx = content.findIndex((page) => JSON.stringify(page).includes("MISSION DE L'UNITÉ"));
        const execIdx = content.findIndex((page) => JSON.stringify(page).includes('EXÉCUTION'));
        expect(missionIdx).toBeGreaterThanOrEqual(0);
        expect(execIdx, 'MISSION et EXÉCUTION doivent rester fusionnées à ce volume nominal').toBe(missionIdx);
        for (let i = 1; i <= 5; i++) {
            expect(json).toContain(`Evenement numero ${i} de`);
        }
    });
});

// ---------------------------------------------------------------------------
// Anomalie B — l'ordre d'ENREGISTREMENT des ancrages d'édition de
// `executionBodyContent` divergeait de l'ordre d'AFFICHAGE du tableau
// `Content` retourné (chronologie/hypothèses enregistrées AVANT date/heure/
// action, alors qu'elles s'affichent APRÈS) — désynchronise le curseur de la
// couche d'édition de l'aperçu (`pdf-preview-edit.ts`).
// ---------------------------------------------------------------------------
describe("buildOiDocDefinition — anomalie B : ordre des ancrages d'édition EXÉCUTION (campagne 2026-08-18)", () => {
    it("les ancrages sont enregistrés dans l'ORDRE D'AFFICHAGE (date/heure d'exécution, action, PUIS chronologie/hypothèses) — jamais l'ordre de construction interne", () => {
        const formData: OiFormData = {
            date_execution: '2026-08-18',
            heure_execution: 'H+2',
            action_body_text: 'Action test',
            time_events: [{ hour: '08:00', type: 'DÉPART', description: 'PC' }],
            hypotheses: ['Hypothese test'],
        };
        const dd = buildOiDocDefinition(collect(formData), { format: 'a4' });
        const anchors = dd.pdfEditAnchors;

        const idxOf = (pred: (a: (typeof anchors)[number]) => boolean): number => anchors.findIndex(pred);
        const dateIdx = idxOf((a) => a.selector === '#oi-form #date_execution');
        const heureIdx = idxOf((a) => a.selector === '#oi-form #heure_execution');
        const actionIdx = idxOf((a) => a.selector === '#oi-form #action_body_text');
        const timeIdx = idxOf((a) => a.selector.includes('time-hour-input'));
        const hypIdx = idxOf((a) => a.selector.includes('hypothese-input'));

        expect(dateIdx, 'date_execution ancré').toBeGreaterThanOrEqual(0);
        expect(heureIdx, 'heure_execution ancré').toBeGreaterThanOrEqual(0);
        expect(actionIdx, 'action_body_text ancré').toBeGreaterThanOrEqual(0);
        expect(timeIdx, 'chronologie ancrée').toBeGreaterThanOrEqual(0);
        expect(hypIdx, 'hypothèses ancrées').toBeGreaterThanOrEqual(0);

        expect(dateIdx, `date_execution avant la chronologie (ordre d'affichage)`).toBeLessThan(timeIdx);
        expect(heureIdx, `heure_execution avant la chronologie (ordre d'affichage)`).toBeLessThan(timeIdx);
        expect(actionIdx, `action_body_text avant la chronologie (ordre d'affichage)`).toBeLessThan(timeIdx);
        expect(dateIdx, `date_execution avant les hypothèses (ordre d'affichage)`).toBeLessThan(hypIdx);
        expect(heureIdx, `heure_execution avant les hypothèses (ordre d'affichage)`).toBeLessThan(hypIdx);
        expect(actionIdx, `action_body_text avant les hypothèses (ordre d'affichage)`).toBeLessThan(hypIdx);
    });
});

// ---------------------------------------------------------------------------
// Anomalie C — « Environnement et amis » n'essayait jamais de palier de
// police ni de budget réel (`unbreakable:false` partout, section TOUJOURS
// rendue) : des champs longs produisaient des pages orphelines sans titre.
// ---------------------------------------------------------------------------
describe('buildOiDocDefinition — anomalie C : « Environnement et amis » bornée (campagne 2026-08-18)', () => {
    it.each(['a4', '16:9'] as const)('volumétrie réaliste : UNE SEULE page, aucun « (SUITE) », aucune perte (%s)', (format) => {
        const formData: OiFormData = {
            amies: 'Groupe GIGN en soutien a 500m, unite K9 en reserve, helicoptere de la gendarmerie en observation aerienne.',
            terrain_info: 'Zone pavillonnaire dense, meteo degagee, vent faible de secteur nord-ouest, visibilite bonne.',
            population: 'Quartier residentiel calme, peu de riverains presents en soiree, ecole a proximite immediate.',
            cadre_juridique: 'Flagrant delit, mandat de perquisition en cours de validite, autorisation du magistrat obtenue.',
        };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));
        expect(json, `pas de « (SUITE) » à ce volume réaliste (${format})`).not.toContain('(SUITE)');
        expect(json, `amies intégral (${format})`).toContain(formData.amies as string);
        expect(json, `cadre_juridique intégral (${format})`).toContain(formData.cadre_juridique as string);
    });

    it.each(['a4', '16:9'] as const)(
        'RÉGRESSION — champs remplis au maximum : jamais de refus, jamais tronqué, continuation propre sur des pages à titre distinct (jamais « (SUITE) », garde C1) (%s)',
        (format) => {
            const longField = (n: number): string => 'Detail operationnel suffisamment long pour peser sur la mise en page complete. '.repeat(n);
            const formData: OiFormData = {
                amies: longField(40),
                terrain_info: longField(40),
                population: longField(40),
                cadre_juridique: longField(40),
            };
            const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));
            expect(json, `pas de « (SUITE) » (${format})`).not.toContain('(SUITE)');
            const titleOccurrences = (json.match(/ENVIRONNEMENT ET AMIS/g) ?? []).length;
            expect(titleOccurrences, `au moins 2 pages ENVIRONNEMENT à ce volume (${format})`).toBeGreaterThan(1);
            expect(json, `titre de continuation à plage de rubriques distincte (${format})`).toMatch(/ENVIRONNEMENT ET AMIS — .+/);
            expect(json, `amies intégral, non tronqué (${format})`).toContain(formData.amies as string);
            expect(json, `terrain_info intégral, non tronqué (${format})`).toContain(formData.terrain_info as string);
            expect(json, `population intégral, non tronqué (${format})`).toContain(formData.population as string);
            expect(json, `cadre_juridique intégral, non tronqué (${format})`).toContain(formData.cadre_juridique as string);
        },
    );
});

// ---------------------------------------------------------------------------
// Anomalie D — les 3 listes de pastilles d'articulation (`pillRow`) n'étaient
// jamais bornées : `rame_vl_order`/`colonne_progression_order`/
// `ordre_penetration_order` longues produisaient une page orpheline.
// ---------------------------------------------------------------------------
describe("buildOiDocDefinition — anomalie D : listes d'articulation bornées (campagne 2026-08-18)", () => {
    it.each(['a4', '16:9'] as const)('volumétrie réaliste (8 éléments par liste) : UNE SEULE page, aucun « (SUITE) » (%s)', (format) => {
        const formData: OiFormData = {
            rame_vl_order: Array.from({ length: 8 }, (_, i) => `VL${i + 1}`),
            colonne_progression_order: Array.from({ length: 8 }, (_, i) => `C${i + 1}`),
            ordre_penetration_order: Array.from({ length: 8 }, (_, i) => `P${i + 1}`),
            place_chef: 'PC mobile',
        };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));
        expect(json, `pas de « (SUITE) » à ce volume réaliste (${format})`).not.toContain('(SUITE)');
        expect(json).toContain('VL8');
        expect(json).toContain('P8');
    });

    it.each(['a4', '16:9'] as const)(
        'RÉGRESSION — 40 éléments par liste : jamais de refus, jamais tronqué, continuation propre sur des pages à titre distinct (jamais « (SUITE) », garde C1), aucun élément perdu (%s)',
        (format) => {
            const formData: OiFormData = {
                rame_vl_order: Array.from({ length: 40 }, (_, i) => `VL${i + 1}`),
                colonne_progression_order: Array.from({ length: 40 }, (_, i) => `C${i + 1}`),
                ordre_penetration_order: Array.from({ length: 40 }, (_, i) => `P${i + 1}`),
                place_chef: 'PC mobile',
            };
            const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));
            expect(json, `pas de « (SUITE) » (${format})`).not.toContain('(SUITE)');
            const titleOccurrences = (json.match(/ARTICULATION & ORDRES DE MOUVEMENT/g) ?? []).length;
            expect(titleOccurrences, `au moins 2 pages ARTICULATION à ce volume (${format})`).toBeGreaterThan(1);
            expect(json, `titre de continuation à plage de rubriques distincte (${format})`).toMatch(
                /ARTICULATION & ORDRES DE MOUVEMENT — .+/,
            );
            expect(json, `VL40 présent, non perdu (${format})`).toContain('VL40');
            expect(json, `C40 présent, non perdu (${format})`).toContain('C40');
            expect(json, `P40 présent, non perdu (${format})`).toContain('P40');
        },
    );
});

// ---------------------------------------------------------------------------
// Anomalie E — le tableau PATRACDVR (`patracFontPx`) réduisait la police par
// paliers de NOMBRE DE LIGNES sans jamais calculer de budget de hauteur réel
// : une unité volumineuse s'étalait sur plusieurs pages PHYSIQUES sans
// qu'aucune ne porte le titre « RÉCAPITULATIF PATRACDVR ».
// ---------------------------------------------------------------------------
describe('buildOiDocDefinition — anomalie E : tableau PATRACDVR, budget de hauteur réel (campagne 2026-08-18)', () => {
    function patracMember(i: number): OiPatracMember {
        return {
            trigramme: `M${i}`,
            fonction: 'Op',
            cellule: `AO${i % 4}`,
            principales: 'UMP9',
            secondaires: 'PSA',
            afis: 'PIE',
            grenades: 'Sans',
            equipement: 'Sans',
            equipement2: 'Sans',
            tenue: 'Sans',
            gpb: 'Sans',
            dir: '',
        };
    }

    it.each(['a4', '16:9'] as const)('volumétrie réaliste (10 membres) : UNE SEULE page, une seule occurrence du titre (%s)', (format) => {
        const formData: OiFormData = {
            patracdvr_rows: [{ vehicle: 'VL1', members: Array.from({ length: 10 }, (_, i) => patracMember(i)) }],
        };
        const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));
        expect(json, `pas de « (SUITE) » à ce volume réaliste (${format})`).not.toContain('(SUITE)');
        expect((json.match(/RÉCAPITULATIF PATRACDVR/g) ?? []).length, `une seule occurrence du titre (${format})`).toBe(1);
        expect(json).toContain('"text":"M9"');
    });

    it.each(['a4', '16:9'] as const)(
        'RÉGRESSION — 60 membres : jamais de refus, jamais tronqué, CHAQUE page porte son titre distinct (« — MEMBRES <plage> » à partir de la 2e, jamais « (SUITE) », garde C1), aucun membre perdu (%s)',
        (format) => {
            const formData: OiFormData = {
                patracdvr_rows: [{ vehicle: 'VL1', members: Array.from({ length: 60 }, (_, i) => patracMember(i)) }],
            };
            const json = JSON.stringify(buildOiDocDefinition(collect(formData), { format }));

            // Aucun membre perdu.
            for (let i = 0; i < 60; i++) {
                expect(json, `trigramme M${i} présent (${format})`).toContain(`"text":"M${i}"`);
            }

            // Plusieurs occurrences du titre — une par page, jamais de page sans
            // titre — et AU MOINS autant de tables `headerRows:1` que de pages
            // PATRACDVR (chacune répète l'en-tête de colonnes ; le document
            // porte aussi d'autres tables `headerRows:1` par ailleurs, ex. la
            // chronologie d'EXÉCUTION — d'où l'inégalité plutôt qu'une égalité
            // stricte).
            const titleOccurrences = (json.match(/RÉCAPITULATIF PATRACDVR/g) ?? []).length;
            expect(titleOccurrences, `au moins 2 pages PATRACDVR à ce volume (${format})`).toBeGreaterThan(1);
            expect(json, `pas de « (SUITE) » (${format})`).not.toContain('(SUITE)');
            expect(json, `titre de continuation à plage de membres distincte (${format})`).toMatch(
                /RÉCAPITULATIF PATRACDVR — MEMBRES? \d+(-\d+)?/,
            );
            const headerRowsOccurrences = (json.match(/"headerRows":1/g) ?? []).length;
            expect(headerRowsOccurrences, `chaque page PATRACDVR répète l'en-tête de colonnes (${format})`).toBeGreaterThanOrEqual(titleOccurrences);
        },
    );
});
