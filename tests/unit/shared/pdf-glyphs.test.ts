/**
 * pdf-glyphs.test.ts — écritures non latines dans les PDF (décision 44) :
 * découpage d'un texte en segments par police de la chaîne de repli, arabe
 * gardé d'un seul tenant (bidi minimal), caractères sans police signalés
 * avant génération puis remplacés (émoji retirés, le reste en « ? »).
 */
import { describe, expect, it } from 'vitest';
import { findUnsupported, replaceUnsupported, splitFontRuns, type FontCandidate } from '@shared/pdf-glyphs.js';

// Chaîne de test : « latin » couvre l'ASCII et le latin étendu, « grec »
// couvre le grec, « arabe » couvre l'arabe, les espaces et la ponctuation.
const latin: FontCandidate = { id: 'latin', has: (c) => c < 0x0250 };
const grec: FontCandidate = { id: 'grec', has: (c) => (c >= 0x0370 && c <= 0x03ff) || c === 0x20 };
const arabe: FontCandidate = { id: 'arabe', has: (c) => (c >= 0x0600 && c <= 0x06ff) || (c >= 0x20 && c <= 0x40) };
const CHAIN = [latin, grec, arabe];

describe('splitFontRuns', () => {
    it('un texte latin tient en un seul segment', () => {
        expect(splitFontRuns('Pavillon 12', CHAIN)).toEqual([{ text: 'Pavillon 12', fontId: 'latin', rtl: false }]);
    });

    it('bascule sur la police qui couvre chaque écriture', () => {
        expect(splitFontRuns('Nom : Ωμέγα', CHAIN)).toEqual([
            { text: 'Nom : ', fontId: 'latin', rtl: false },
            { text: 'Ωμέγα', fontId: 'grec', rtl: false },
        ]);
    });

    it('garde un passage arabe de plusieurs mots d’un seul tenant, espaces compris', () => {
        const runs = splitFontRuns('Nom : بن محمد (alias)', CHAIN);
        expect(runs).toEqual([
            { text: 'Nom : ', fontId: 'latin', rtl: false },
            { text: 'بن محمد', fontId: 'arabe', rtl: true },
            { text: ' (alias)', fontId: 'latin', rtl: false },
        ]);
    });

    it('un caractère qu’aucune police ne couvre forme un segment sans police', () => {
        expect(splitFontRuns('A中B', CHAIN)).toEqual([
            { text: 'A', fontId: 'latin', rtl: false },
            { text: '中', fontId: null, rtl: false },
            { text: 'B', fontId: 'latin', rtl: false },
        ]);
    });

    it('chaîne vide : aucun segment', () => {
        expect(splitFontRuns('', CHAIN)).toEqual([]);
    });
});

describe('findUnsupported / replaceUnsupported', () => {
    it('liste une seule fois chaque caractère sans police, espaces et contrôles exclus', () => {
        expect(findUnsupported('A 中文 中 \n\t😀 Ω', CHAIN)).toEqual(['中', '文', '😀']);
        expect(findUnsupported('Élodie Ωμέγα بن', CHAIN)).toEqual([]);
    });

    it('retire les émoji et remplace les autres caractères sans police par « ? »', () => {
        expect(replaceUnsupported('RAS 👍 chez 王', CHAIN)).toBe('RAS  chez ?');
        expect(replaceUnsupported('famille 👨‍👩‍👧 ok', CHAIN)).toBe('famille  ok');
    });
});
