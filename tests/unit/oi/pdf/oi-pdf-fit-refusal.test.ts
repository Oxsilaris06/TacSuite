/**
 * oi-pdf-fit-refusal.test.ts — Refus « une page = un usage » mieux expliqué
 * (décision 43, audit F07) : le refus est gardé, mais
 *  - chaque dépassement dit à peu près combien retirer (lignes) et désigne
 *    le champ à corriger (« Aller au champ ») ;
 *  - le compteur sous le champ vient du MÊME modèle que le solveur : il passe
 *    au rouge au plus tard quand le PDF serait refusé (l'audit l'a trouvé
 *    orange, voire vert, au moment du refus).
 */
import { describe, expect, it } from 'vitest';

import {
    adversaryFicheMarginLines,
    articulationMarginLines,
    buildOiDocDefinition,
    OiPdfFitRefusalError,
} from '@oi/pdf/document-builder.js';
import type { OiAdversary, OiFormData, OiPatracRow, OiZmspcpBlock } from '@shared/types/contracts.js';

const TAJ = [
    'VIOLENCE AGGRAVEE PAR DEUX CIRCONSTANCES SUIVIE D\'INCAPACITE N\'EXCEDANT PAS 8 JOURS',
    'DETENTION NON AUTORISEE DE STUPEFIANTS',
    'REFUS D\'OBTEMPERER A UNE SOMMATION DE S\'ARRETER',
    'MENACE DE MORT REITEREE',
    'CONDUITE D\'UN VEHICULE SANS PERMIS',
];

function adversary(atcdLines: number): OiAdversary {
    return {
        id: 'adv1', nom_adversaire: 'MARTIN Paul', date_naissance: '1990-03-14', lieu_naissance: 'TESTVILLE',
        profession_adversaire: 'Mécanicien', situation_familiale: 'Marié, deux enfants', stature_adversaire: '1m82',
        ethnie_adversaire: 'Européen', signes_particuliers: 'Tatouage main gauche', substances_adversaire: 'Alcool',
        armes_connues: 'Fusil de chasse calibre 12', domicile_adversaire: '3 impasse des Tilleuls, 99999 TESTVILLE',
        attitude_adversaire: 'Retranché, refus de dialogue',
        antecedents_adversaire: Array.from({ length: atcdLines }, (_, i) => `- ${2024 - Math.floor(i / 2)} : ${TAJ[i % 5]}`).join('\n'),
        me_list: ['Arme longue'], etat_esprit_list: ['Agressif'], volume_list: ['Pavillon R+1'], vehicules_list: ['Peugeot 308 AB-123-CD'],
    };
}

function refusal(fd: OiFormData): OiPdfFitRefusalError | null {
    try {
        buildOiDocDefinition({ formData: fd, photosBase64: {}, isDark: false }, { format: 'a4' });
        return null;
    } catch (e) {
        if (e instanceof OiPdfFitRefusalError) return e;
        throw e;
    }
}

describe('fiche adversaire : marge du compteur = verdict du solveur', () => {
    it('pour 5 à 60 lignes TAJ, marge < 0 exactement quand le PDF est refusé', () => {
        let firstRefused: number | null = null;
        for (let n = 5; n <= 60; n++) {
            const adv = adversary(n);
            const refused = refusal({ adversaries: [adv] }) !== null;
            const margin = adversaryFicheMarginLines(adv, { hasPhoto: false, format: 'a4' });
            expect(margin < 0, `${n} lignes TAJ : marge ${margin}, refus ${refused}`).toBe(refused);
            if (refused && firstRefused === null) firstRefused = n;
        }
        // Le cas réaliste de l'audit refuse avant 60 lignes : la plage couvre le seuil.
        expect(firstRefused).not.toBeNull();
    });

    it('le refus dit combien retirer (lignes) et désigne le champ ATCD de CETTE fiche', () => {
        const adv = adversary(40);
        const err = refusal({ adversaries: [adv] });
        expect(err).not.toBeNull();
        const fit = err!.fitErrors.find((e) => /Fiche Adversaire/.test(e.section));
        expect(fit?.excessLines).toBe(-adversaryFicheMarginLines(adv, { hasPhoto: false, format: 'a4' }));
        expect(fit?.excessLines).toBeGreaterThan(0);
        expect(fit?.field?.selector).toContain('adv1');
        expect(fit?.field?.selector).toContain('antecedents_adversaire');
        expect(err!.message).toMatch(/environ \d+ lignes?/);
    });
});

describe('bloc ZMSPCP : marge du compteur = verdict du solveur', () => {
    function withCells(nCells: number, cat = '- Riposte graduée'): OiFormData {
        const rows: OiPatracRow[] = [{
            vehicle: 'VL1',
            members: Array.from({ length: nCells }, (_, i) => ({
                trigramme: `T${i}`, fonction: 'Inter', cellule: `India ${i + 1}`, principales: '', secondaires: '', afis: '',
                grenades: '', equipement: '', equipement2: '', tenue: '', gpb: '', dir: '',
            })),
        }];
        const block: OiZmspcpBlock = {
            id: 'z1', title: 'APPUI 1', zone: 'Bois au sud', mission: 'Observer et appuyer', secteur: 'Façade sud',
            points_particuliers: 'Fenêtre étage', cat, place_chef: 'Lisière', members: rows[0]!.members.map((m) => m.trigramme),
        };
        return { patracdvr_rows: rows, zmspcp_blocks: [block] };
    }

    it('de 1 à 14 cellules, marge < 0 exactement quand le PDF est refusé', () => {
        for (let n = 1; n <= 14; n++) {
            const fd = withCells(n);
            const refused = refusal(fd) !== null;
            const margin = articulationMarginLines('zmspcp', fd.zmspcp_blocks![0]!, fd, 'a4');
            expect(margin < 0, `${n} cellules : marge ${margin}, refus ${refused}`).toBe(refused);
        }
    });

    it('CAT longue : même accord, et le refus désigne le champ CAT du bloc', () => {
        for (const items of [10, 20, 30, 40, 60]) {
            const cat = Array.from({ length: items }, (_, i) => `- Consigne ${i + 1} : rester en appui feu et rendre compte de tout mouvement suspect`).join('\n');
            const fd = withCells(2, cat);
            const err = refusal(fd);
            const margin = articulationMarginLines('zmspcp', fd.zmspcp_blocks![0]!, fd, 'a4');
            expect(margin < 0, `${items} consignes : marge ${margin}`).toBe(err !== null);
            if (err) {
                const fit = err.fitErrors[0]!;
                expect(fit.field?.selector).toContain('z1');
                expect(fit.field?.selector).toContain('cat');
                expect(fit.excessLines).toBe(-margin);
            }
        }
    });
});
