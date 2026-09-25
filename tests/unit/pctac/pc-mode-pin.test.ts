/**
 * pc-mode-pin.test.ts — La situation est FIGÉE pour la vie de la page
 * (décision 29, sûreté : chaque onglet garde la situation qu'il a chargée ;
 * un changement dans un autre onglet ne réoriente pas ses écritures).
 *
 * Avant, `currentModeId()` relisait `localStorage` à chaque appel : un autre
 * onglet passant sur une autre situation faisait écrire cet onglet-ci dans les
 * clés de l'autre, qu'il écrasait.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
    PCTAC_MODE_KEY,
    currentModeId,
    persistModeId,
    resetModePinForTests,
    scopedKey,
} from '@pctac/modes.js';

beforeEach(() => {
    localStorage.clear();
});

describe('situation figée par page', () => {
    it('la première lecture est mémorisée : l’écriture d’un autre onglet ne la change pas', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        expect(currentModeId()).toBe('tp');

        // Écriture DIRECTE dans localStorage : ce qu'on observe d'un `storage`
        // event d'un autre onglet.
        localStorage.setItem(PCTAC_MODE_KEY, 'recherche');

        expect(currentModeId()).toBe('tp');
        expect(scopedKey('pcTacAdversaries')).toBe('pcTacAdversaries@tp');
    });

    it('persistModeId met à jour la valeur mémorisée pour la page', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        expect(currentModeId()).toBe('forcene');

        expect(persistModeId('evenement')).toBe(true);
        expect(currentModeId()).toBe('evenement');
        expect(scopedKey('pcTacAdversaries')).toBe('pcTacAdversaries@evenement');
    });

    it('resetModePinForTests repart de la valeur stockée', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        expect(currentModeId()).toBe('tp');

        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        resetModePinForTests();

        expect(currentModeId()).toBe('forcene');
        expect(scopedKey('pcTacAdversaries')).toBe('pcTacAdversaries');
    });

    it('valeur illisible : Forcené, et la page y reste', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'situation-inventée');
        expect(currentModeId()).toBe('forcene');
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        expect(currentModeId()).toBe('forcene');
    });
});
