/**
 * r2a-dob.test.ts — CONTROLE C6 (R9) : la date de naissance doit être comparée
 * en forme NORMALISÉE (AAAA-MM-JJ), pas littéralement. L'OI saisit en
 * `input type=date` (1980-01-01), PC-Tac en texte JJ/MM/AAAA. Les âges
 * estimés (« ~40 ans ») ne sont pas des dates et ne déclenchent rien.
 *
 * Porté du contrôleur /tmp/claude-1000/controle-socle/oi-dob.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('@shared/feedback.js', () => ({ confirmDialog: vi.fn(async () => true), toast: vi.fn(), showBanner: vi.fn(), hideBanner: vi.fn() }));

import { findOiDuplicatePerson } from '@pctac/archive.js';
import { findDuplicatePerson, normalizeDob } from '@pctac/fiche.js';

describe('normalizeDob', () => {
    it('reconnaît JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA et AAAA-MM-JJ', () => {
        expect(normalizeDob('01/01/1980')).toBe('1980-01-01');
        expect(normalizeDob('1-1-1980')).toBe('1980-01-01');
        expect(normalizeDob('01.01.1980')).toBe('1980-01-01');
        expect(normalizeDob('1980-01-01')).toBe('1980-01-01');
        expect(normalizeDob('1980-1-1')).toBe('1980-01-01');
    });
    it('ignore les âges, le vide et les dates impossibles', () => {
        expect(normalizeDob('~40 ans')).toBeNull();
        expect(normalizeDob('40')).toBeNull();
        expect(normalizeDob('')).toBeNull();
        expect(normalizeDob(null)).toBeNull();
        expect(normalizeDob('31/02/1980')).toBeNull();
        expect(normalizeDob('1980-13-01')).toBeNull();
    });
});

describe('R9 : repli nom + date de naissance', () => {
    it('fiche saisie dans PC-Tac (JJ/MM/AAAA) vs OI (input date AAAA-MM-JJ)', () => {
        const items = [{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', dob: '01/01/1980' }];
        const hit = findOiDuplicatePerson(items, 'Dupont', '1980-01-01');
        console.log('HIT', JSON.stringify(hit));
        expect(hit?.id).toBe('fc1');
    });
    it('un âge estimé des deux côtés ne déclenche pas la fusion (nom inclus)', () => {
        const items = [{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', dob: '~40 ans' }];
        expect(findOiDuplicatePerson(items, 'Dupont', '~40 ans')).toBeNull();
    });
});

describe('findDuplicatePerson — comparaison normalisée des dates', () => {
    it('ISO côté candidat, FR côté existant : même date, même personne', () => {
        const existing = [{ id: 'a', nom: 'Dupont', prenom: '', dob: '01/01/1980' }];
        expect(findDuplicatePerson(existing, { id: 'b', nom: 'Dupont', dob: '1980-01-01' })?.id).toBe('a');
    });
    it('un âge estimé identique n’est pas une date de naissance', () => {
        const existing = [{ id: 'a', nom: 'Dupont', prenom: '', dob: '~40 ans' }];
        expect(findDuplicatePerson(existing, { id: 'b', nom: 'Dupont', dob: '~40 ans' })).toBeNull();
    });
});
