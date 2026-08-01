/**
 * pc-config.test.ts — Comportement OBSERVÉ de `modules/pctac/config.js`
 * (GStart-main, 317 LOC, aucun import). Écrit AVANT `src/apps/pctac/config.ts`
 * (TDD, mission P2.CONV). Valeurs de référence relevées en lisant le fichier
 * source ligne par ligne (références `config.js:<ligne>` en commentaire).
 */
import { describe, expect, it } from 'vitest';

import {
    ADVERSARIES_KEY,
    BOARD_NODE_TYPES,
    CUSTOM_PAX_KEY,
    DASHBOARD_KEY,
    FREE_MODE_COLORS,
    FRIENDS_KEY,
    HOSTAGES_KEY,
    LOCAL_STORAGE_KEY,
    LONG_PRESS_DELAY,
    PDF_PAX_COLORS,
    PHOTOS_KEY,
    PHOTO_CATEGORIES,
    PIN_ICONS,
    QR_BATCH_SIZE,
    TP_ASSOC_KEY,
    labelTokens,
    matchPhotosByLabel,
    normalizeForMatch,
    suggestPinIcons,
} from '../../../src/apps/pctac/config.js';

describe('config.ts — clés localStorage littérales (config.js:6-15)', () => {
    it('expose les 8 clés attendues, valeurs exactes', () => {
        expect(LOCAL_STORAGE_KEY).toBe('pcTacLogData');
        expect(TP_ASSOC_KEY).toBe('pcTacTpAssociations');
        expect(ADVERSARIES_KEY).toBe('pcTacAdversaries');
        expect(HOSTAGES_KEY).toBe('pcTacHostages');
        expect(FRIENDS_KEY).toBe('pcTacFriends');
        expect(PHOTOS_KEY).toBe('pcTacPhotos');
        expect(CUSTOM_PAX_KEY).toBe('pcTacCustomPax');
        expect(DASHBOARD_KEY).toBe('pcTacDashboard');
    });
});

describe('config.ts — PHOTO_CATEGORIES (config.js:18-25)', () => {
    it('contient les 6 catégories, dans l’ordre, avec leurs labels', () => {
        expect(PHOTO_CATEGORIES).toEqual([
            { id: 'hostage', label: 'Otages' },
            { id: 'location', label: 'Lieu' },
            { id: 'trap', label: 'Piégeages' },
            { id: 'neutralized', label: 'Adversaire' },
            { id: 'target', label: 'VL target' },
            { id: 'all', label: 'Toutes' },
        ]);
    });
});

describe('config.ts — FREE_MODE_COLORS (config.js:33-46)', () => {
    it('contient 12 couleurs distinctes', () => {
        expect(FREE_MODE_COLORS).toHaveLength(12);
        const hexes = FREE_MODE_COLORS.map((c) => c.hex);
        expect(new Set(hexes).size).toBe(12);
    });

    it('première et dernière couleur (bornes vérifiées)', () => {
        expect(FREE_MODE_COLORS[0]).toEqual({ hex: '#7c3aed', name: 'Violet' });
        expect(FREE_MODE_COLORS[11]).toEqual({ hex: '#ffffff', name: 'Blanc' });
    });
});

describe('config.ts — PDF_PAX_COLORS (config.js:49-57)', () => {
    it('contient les 7 clés attendues avec leurs métadonnées exactes', () => {
        expect(Object.keys(PDF_PAX_COLORS)).toEqual([
            'Adversaire', 'Otage', 'Civil', 'Inter', 'Nego', 'Oscar', 'Autre',
        ]);
        expect(PDF_PAX_COLORS.Adversaire).toEqual({ text: 'Adversaire', color: '#be1b09', fontColor: '#ffffff' });
        // 'Otage' et 'Civil' partagent le même libellé affiché.
        expect(PDF_PAX_COLORS.Otage).toEqual({ text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' });
        expect(PDF_PAX_COLORS.Civil).toEqual({ text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' });
        expect(PDF_PAX_COLORS.Autre).toEqual({ text: 'Autre', color: '#2d2d2d', fontColor: '#e0e0e0' });
    });
});

describe('config.ts — QR_BATCH_SIZE / LONG_PRESS_DELAY (config.js:60-61)', () => {
    it('valeurs littérales', () => {
        expect(QR_BATCH_SIZE).toBe(5);
        expect(LONG_PRESS_DELAY).toBe(700);
    });
});

describe('config.ts — PIN_ICONS (config.js:74-152)', () => {
    it('contient 52 entrées (recompté verbatim depuis la source)', () => {
        // NB : la mission annonçait 51 entrées ; un recomptage exhaustif du
        // tableau source (`{ id: ... }` entre config.js:74 et :152) en donne
        // 52. Valeur de référence retenue = comptage effectif de la source.
        expect(PIN_ICONS).toHaveLength(52);
    });

    it('a des ids uniques', () => {
        const ids = PIN_ICONS.map((ic) => ic.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('chaque entrée a id/label/cat/tags bien formés', () => {
        for (const ic of PIN_ICONS) {
            expect(typeof ic.id).toBe('string');
            expect(ic.id.length).toBeGreaterThan(0);
            expect(typeof ic.label).toBe('string');
            expect(typeof ic.cat).toBe('string');
            expect(Array.isArray(ic.tags)).toBe(true);
        }
    });

    it('première et dernière entrée (bornes vérifiées)', () => {
        expect(PIN_ICONS[0]).toEqual({
            id: 'local_police', label: 'Police', cat: 'Forces', tags: ['police', 'flic', 'agent', 'op'],
        });
        expect(PIN_ICONS[PIN_ICONS.length - 1]).toEqual({
            id: 'flag', label: 'Repère', cat: 'Lieu', tags: ['repere', 'flag', 'marker', 'drapeau'],
        });
    });
});

describe('config.ts — BOARD_NODE_TYPES (config.js:201-207)', () => {
    it('mappe les 5 catégories de photo (hors "all") vers leurs métadonnées de nœud', () => {
        expect(BOARD_NODE_TYPES.location).toEqual({
            type: 'location', icon: 'maps_home_work', label: 'Lieu', role: 'hub',
        });
        expect(BOARD_NODE_TYPES.neutralized).toEqual({
            type: 'adversary', icon: 'person_alert', label: 'Adversaire', role: 'satellite',
        });
        expect(BOARD_NODE_TYPES.target?.role).toBe('satellite');
        expect(BOARD_NODE_TYPES.hostage?.role).toBe('satellite');
        expect(BOARD_NODE_TYPES.trap?.role).toBe('satellite');
        expect(BOARD_NODE_TYPES.all).toBeUndefined();
    });
});

describe('normalizeForMatch (config.js:157-161)', () => {
    it('supprime les accents, met en minuscules, trim', () => {
        expect(normalizeForMatch('  Négociateur  ')).toBe('negociateur');
        expect(normalizeForMatch('GENDARMERIE')).toBe('gendarmerie');
        expect(normalizeForMatch('Piéton')).toBe('pieton');
    });

    it('est défensif sur null/undefined/valeurs vides', () => {
        expect(normalizeForMatch(null)).toBe('');
        expect(normalizeForMatch(undefined)).toBe('');
        expect(normalizeForMatch('')).toBe('');
    });

    it('ne touche pas à la ponctuation ni aux chiffres', () => {
        expect(normalizeForMatch('Pc-Tac 2')).toBe('pc-tac 2');
    });
});

describe('labelTokens (config.js:226-247)', () => {
    it('normalise (accents/majuscules) et tokenize sur la ponctuation', () => {
        expect(labelTokens('café-hôtel')).toEqual(['CAFE', 'C', 'A', 'F', 'E', 'HOTEL']);
    });

    it('déduplique les tokens (mot hors plage A–F, pas d’éclatement)', () => {
        expect(labelTokens('XY XY')).toEqual(['XY']);
    });

    it('éclate un token court de lettres A–F en lettres individuelles, en plus du token entier', () => {
        expect(labelTokens('AB')).toEqual(['AB', 'A', 'B']);
        expect(labelTokens('A')).toEqual(['A']);
    });

    it('ne déstructure pas un vrai mot (ex RENAULT reste un seul token)', () => {
        expect(labelTokens('RENAULT')).toEqual(['RENAULT']);
    });

    it('n’éclate pas une suite de lettres de façade trop longue (>6)', () => {
        expect(labelTokens('ABCDEFA')).toEqual(['ABCDEFA']);
    });

    it('est défensif : null/undefined → []', () => {
        expect(labelTokens(null)).toEqual([]);
        expect(labelTokens(undefined)).toEqual([]);
        expect(labelTokens('   ')).toEqual([]);
    });
});

describe('suggestPinIcons (config.js:167-186)', () => {
    it('retourne [] pour un libellé vide ou sans tokens exploitables', () => {
        expect(suggestPinIcons('')).toEqual([]);
        expect(suggestPinIcons('a')).toEqual([]); // token < 2 caractères filtré
    });

    it('retourne les icônes pertinentes triées par score décroissant', () => {
        const results = suggestPinIcons('pompier');
        expect(results.length).toBeGreaterThan(0);
        // 'pompier' est un match EXACT du tag 'pompier' (score 3) pour ces deux ids.
        expect(results[0]?.id).toBe('local_fire_department');
        expect(results.map((r) => r.id)).toContain('fire_truck');
    });

    it('respecte le paramètre max (par défaut 6)', () => {
        const results = suggestPinIcons('camion pompier vehicule');
        expect(results.length).toBeLessThanOrEqual(6);
        const limited = suggestPinIcons('camion pompier vehicule', 2);
        expect(limited.length).toBeLessThanOrEqual(2);
    });

    it('un match exact de token (label === tag) score plus haut qu’un match partiel', () => {
        // 'gendarme' matche exactement le tag 'gendarme' de military_tech (score 3),
        // et n'apparaît dans aucun autre tag en tant que sous-chaîne pertinente.
        const results = suggestPinIcons('gendarme');
        expect(results[0]?.id).toBe('military_tech');
    });
});

describe('matchPhotosByLabel (config.js:272-308)', () => {
    it('cas 1 — lettre de façade unique : matche par intersection de lettres, catégorie location uniquement', () => {
        const photos = [
            { title: 'A', category: 'location' },
            { title: 'AB', category: 'location' },
            { title: 'C', category: 'location' },
            { title: 'A', category: 'target' }, // mauvaise catégorie
        ];
        const result = matchPhotosByLabel('A', photos);
        expect(result).toEqual([
            { title: 'A', category: 'location' },
            { title: 'AB', category: 'location' },
        ]);
    });

    it('cas 1 — deux lettres de façade : matche via intersection (label AB matche BC via B)', () => {
        const photos = [
            { title: 'BC', category: 'location' },
            { title: 'D', category: 'location' },
        ];
        expect(matchPhotosByLabel('AB', photos)).toEqual([{ title: 'BC', category: 'location' }]);
    });

    it('cas 2 — égalité de token normalisé, toutes catégories confondues', () => {
        const photos = [
            { title: 'RENAULT CLIO', category: 'target' },
            { title: 'autre chose', category: 'trap' },
        ];
        expect(matchPhotosByLabel('renault', photos)).toEqual([{ title: 'RENAULT CLIO', category: 'target' }]);
    });

    it('est défensif : label null → [], photos non tableau → []', () => {
        expect(matchPhotosByLabel(null, [{ title: 'A', category: 'location' }])).toEqual([]);
        expect(matchPhotosByLabel<{ title?: string | null; category?: string | null }>('A', null)).toEqual([]);
    });

    it('label vide après normalisation (espaces) → []', () => {
        expect(matchPhotosByLabel('   ', [{ title: 'A', category: 'location' }])).toEqual([]);
    });
});
