/**
 * oi-pdf-finitions.test.ts — Finitions du PDF de l'OI (audit PDF du
 * 2026-09-25 : F18, F21, F23, F24, F27, F28 ; décision 43).
 *
 *  - numérotation continue quand aucun adversaire n'est saisi (plus de saut
 *    de « 1. » à « 3. ») ;
 *  - une section entièrement vide n'est plus imprimée (plus de pages de
 *    « LIBELLÉ : - ») et ne consomme pas de numéro ;
 *  - dates au format français ;
 *  - noms de fichier distincts pour l'OI complet et l'OI express, avec l'heure ;
 *  - titre des métadonnées sans nom de personne ;
 *  - « CIBLE(S) » ;
 *  - unité « mm » sur toutes les mesures d'effraction.
 */
import { describe, expect, it } from 'vitest';

import { buildOiDocDefinition, oiPdfFileName } from '@oi/pdf/document-builder.js';
import type { OiEffractionBlock, OiFormData } from '@shared/types/contracts.js';

function build(formData: OiFormData) {
    return buildOiDocDefinition({ formData, photosBase64: {}, isDark: false }, { format: 'a4' });
}

function allTexts(node: unknown, out: string[] = []): string[] {
    if (typeof node === 'string') {
        out.push(node);
    } else if (Array.isArray(node)) {
        node.forEach((n) => allTexts(n, out));
    } else if (node && typeof node === 'object') {
        Object.values(node as Record<string, unknown>).forEach((v) => allTexts(v, out));
    }
    return out;
}

/** Titres de section numérotés (« N. TITRE »), dans l'ordre du document. */
function numberedTitles(formData: OiFormData): string[] {
    return allTexts(build(formData).content).filter((t) => /^\d+\. [A-ZÀ-Ý]/.test(t));
}

const ADV = { id: 'a1', nom_adversaire: 'DURAND Marc', me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] };
const FILLED: OiFormData = {
    date_op: '2026-09-25',
    trigramme_redacteur: 'RED',
    unite_redacteur: 'PSIG TESTVILLE',
    situation_generale: 'Individu retranché.',
    amies: 'BAC de nuit',
    missions_psig: 'INTERPELLER',
    place_chef: 'Derrière India 1',
    patracdvr_rows: [{ vehicle: 'VL1', members: [{ trigramme: 'TAA', fonction: 'Chef', cellule: 'India', principales: 'UMP9', secondaires: '', afis: '', grenades: '', equipement: '', equipement2: '', tenue: '', gpb: '', dir: '' }] }],
};

describe('Numérotation sans trou', () => {
    it('sans adversaire, les sections commencent à 2 et se suivent', () => {
        const titles = numberedTitles(FILLED);
        expect(titles[0]).toBe('1. SITUATION GLOBALE');
        expect(titles.slice(1).map((t) => Number(t.split('.')[0]))).toEqual([2, 3, 4, 5, 6]);
        expect(titles[1]).toBe('2. ENVIRONNEMENT ET AMIS');
    });

    it("avec un adversaire, la fiche « 2.1 » garde le 2, la suite commence à 3", () => {
        const texts = allTexts(build({ ...FILLED, adversaries: [ADV] }).content);
        expect(texts).toContain('2.1 FICHE ADVERSAIRE : DURAND Marc');
        expect(texts).toContain('3. ENVIRONNEMENT ET AMIS');
    });
});

describe('Sections vides', () => {
    it("OI vide : couverture et page finale seulement, aucune page de « LIBELLÉ : - »", () => {
        const dd = build({});
        expect((dd.content as unknown[]).length).toBe(2);
        const texts = allTexts(dd.content);
        expect(texts).toContain('ORDRE INITIAL');
        expect(texts).toContain('AVEZ-VOUS DES QUESTIONS ?');
        expect(texts.filter((t) => /^\d+\. /.test(t) && !t.startsWith('1. '))).toEqual([]);
    });

    it('une section vide est omise sans consommer de numéro ; une section remplie reste', () => {
        const titles = numberedTitles({ ...FILLED, amies: '' });
        expect(titles.some((t) => t.includes('ENVIRONNEMENT'))).toBe(false);
        expect(titles[1]).toBe("2. MISSION DE L'UNITÉ");
        // Une seule donnée suffit à garder la section (ici la chronologie).
        const chrono = numberedTitles({ time_events: [{ type: 'T0', hour: '05:00', description: 'Départ' }] });
        expect(chrono).toContain("2. MISSION DE L'UNITÉ");
        expect(chrono).toContain('3. EXÉCUTION');
        // Articulation : un ordre de rame suffit.
        expect(numberedTitles({ rame_vl_order: ['VL1'] })).toContain('2. ARTICULATION & ORDRES DE MOUVEMENT');
    });
});

describe('Dates en français', () => {
    it('couverture : « DATE : 25/09/2026 »', () => {
        const texts = allTexts((build(FILLED).content as unknown[])[0]);
        expect(texts).toContain('DATE : 25/09/2026');
        expect(texts.some((t) => t.includes('2026-09-25'))).toBe(false);
    });
});

describe('Nom de fichier', () => {
    const at = new Date(2026, 8, 25, 14, 32);

    it('OI complet : OI_Complet_<date>_<heure>_<trigramme>.pdf', () => {
        expect(oiPdfFileName({ date_op: '2026-09-25', trigramme_redacteur: 'RED' }, at)).toBe('OI_Complet_2026-09-25_14h32_RED.pdf');
    });

    it('OI express : OI_Express_…, distinct du complet', () => {
        expect(oiPdfFileName({ oi_mode: 'express', date_op: '2026-09-25', trigramme_redacteur: 'RED' }, at)).toBe('OI_Express_2026-09-25_14h32_RED.pdf');
    });

    it('replis et caractères interdits dans un nom de fichier', () => {
        expect(oiPdfFileName({}, new Date(2026, 0, 2, 3, 4))).toBe('OI_Complet_SANS_DATE_03h04_RED.pdf');
        expect(oiPdfFileName({ date_op: '2026-09-25', trigramme_redacteur: 'A/B C' }, at)).toBe('OI_Complet_2026-09-25_14h32_A-B-C.pdf');
    });
});

describe('Métadonnées du document', () => {
    it("titre explicite (type d'OI et date), sans nom de personne ni trigramme", () => {
        const dd = build({ ...FILLED, adversaries: [ADV], nom_operation: 'HIBOU 26' });
        const info = dd.info as Record<string, string>;
        expect(info.title).toBe('OI Complet du 25/09/2026');
        expect(info.subject).toMatch(/CONFIDENTIEL/);
        expect(info.creator).toMatch(/TacSuite/);
        const all = Object.values(info).join(' ');
        expect(all).not.toMatch(/DURAND|Marc|RED\b/);
        expect(info.author).toBeUndefined();
    });

    it('OI express sans date', () => {
        expect((build({ oi_mode: 'express' }).info as Record<string, string>).title).toBe('OI Express');
    });
});

describe('Libellés', () => {
    it('« CIBLE(S) » (et non plus « CIBLES(S) »)', () => {
        const texts = allTexts(build({ adversaries: [ADV] }).content);
        expect(texts).toContain('CIBLE(S)');
        expect(texts.some((t) => t.includes('CIBLES(S)'))).toBe(false);
    });

    it('effraction : toutes les mesures portent « mm »', () => {
        const block: OiEffractionBlock = {
            id: 'e1', title: 'PORTE', mission: 'Ouvrir', porte: 'Blindée', structure: 'Bois',
            serrurerie: '3 points', environnement: '-', bati_a_bati: '900', dormant_a_dormant: '850',
            prof_linteaux: '200', prof_bati: '70', h_porte: '2100', h_marche: '180',
            prof_marche: '300', prof_moulure: '15', members: [], hypotheses: [],
        };
        const texts = allTexts(build({ effraction_blocks: [block] }).content);
        for (const v of ['900 mm', '850 mm', '200 mm', '70 mm', '2100 mm', '180 mm', '300 mm', '15 mm']) {
            expect(texts, v).toContain(v);
        }
    });
});
