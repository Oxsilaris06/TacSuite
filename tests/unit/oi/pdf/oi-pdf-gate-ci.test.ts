/**
 * Gate PDF de la CI (`.github/workflows/ci.yml`) : B2 et C5 adaptés au
 * PATRACDVR du Complet (décision 9, c2f7005 : valeurs empilées une par ligne,
 * rangées mesurées sans interligne). Chaque adaptation garde sa contre-épreuve :
 * un mot vraiment coupé, une valeur vraiment tronquée FAIL toujours.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    assertB2_noVerticalWordSplit,
    assertC5_fixtureIntegrity,
    // @ts-expect-error — module .mjs sans déclaration de types.
} from '../../../pdf/verify-structure.mjs';

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oi-pdf-gate-ci-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function fixture(formData: unknown): string {
    const path = join(dir, 'fixture.json');
    writeFileSync(path, JSON.stringify({ formData }));
    return path;
}

const members = [
    { trigramme: 'ALF', principales: 'UMP9', secondaires: 'PSA', equipement: 'UBAS, GPBL' },
    { trigramme: 'BRV', principales: 'G36', secondaires: 'PSA', equipement: 'UBAS, GPBL' },
];
const patracFixture = { patracdvr_rows: [{ vehicle: 'SHARAN', members }] };

// Rangées denses de pdftotext -layout : aucune ligne blanche entre deux membres.
const denseRows = [
    '9. RÉCAPITULATIF PATRACDVR',
    ' VL      PAX  PPALE  SEC.  EQPT/GREN.',
    ' SHARAN  ALF  UMP9   PSA   UBAS / GPBL',
    '         BRV  G36    PSA   UBAS / GPBL',
    'AVEZ-VOUS DES QUESTIONS ?',
].join('\n');

describe('B2 avec --fixture : vocabulaire de la fixture', () => {
    it('PASS : deux valeurs saisies empilées dans une colonne (« ALF »/« BRV », « PSA »/« PSA ») ne sont pas un mot cassé', () => {
        expect(assertB2_noVerticalWordSplit(denseRows).ok).toBe(false); // l'ancienne heuristique seule les prend pour des césures
        expect(assertB2_noVerticalWordSplit(denseRows, fixture(patracFixture)).ok).toBe(true);
    });

    it('contre-épreuve : « SHARAN » coupé en « SHAR » / « AN » FAIL toujours avec la fixture', () => {
        const cut = denseRows.replace(' SHARAN  ALF', ' SHAR    ALF').replace('         BRV', ' AN      BRV');
        const r = assertB2_noVerticalWordSplit(cut, fixture(patracFixture));
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/SHARAN/);
    });

    it('fixture illisible : FAIL explicite, jamais un PASS silencieux', () => {
        expect(assertB2_noVerticalWordSplit(denseRows, join(dir, 'absente.json')).ok).toBe(false);
    });
});

describe('C5 : valeurs à choix multiple du PATRACDVR', () => {
    const multi = { patracdvr_rows: [{ vehicle: 'VL1', members: [{ trigramme: 'TST', principales: 'UBAS, GPBL, Casque lourd' }] }] };
    const stacked = ['PPALE', 'UBAS /', 'GPBL /', 'Casque lourd'].join('\n');

    it('PASS : « UBAS, GPBL, Casque lourd » rendu une valeur par ligne (« / »), chaque valeur entière', () => {
        expect(assertC5_fixtureIntegrity(stacked, fixture(multi)).ok).toBe(true);
    });

    it('contre-épreuve : une valeur tronquée (« Casque lo ») FAIL', () => {
        const r = assertC5_fixtureIntegrity(stacked.replace('Casque lourd', 'Casque lo'), fixture(multi));
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/Casque lourd/);
    });

    it('étroit : hors d’un membre PATRACDVR, une liste à virgules reste exigée telle quelle', () => {
        const r = assertC5_fixtureIntegrity(stacked, fixture({ situation_generale: 'UBAS, GPBL, Casque lourd' }));
        expect(r.ok).toBe(false);
    });
});
