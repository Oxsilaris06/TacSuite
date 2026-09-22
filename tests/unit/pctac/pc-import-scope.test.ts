/**
 * pc-import-scope.test.ts — Import d'archive par catégories.
 *
 * Ce qui est verrouillé ici :
 *   - une catégorie NON cochée n'est jamais touchée. C'est toute la raison
 *     d'être de la fonctionnalité : importer la main courante d'un collègue
 *     ne doit pas effacer ses propres photos.
 *   - en fusion, la version LOCALE gagne sur un conflit d'identifiant, et
 *     importer deux fois la même archive n'accumule pas de doublons.
 *   - en remplacement, une clé absente de l'archive est bien supprimée : la
 *     catégorie adopte l'état de l'archive, y compris son vide.
 *   - une valeur qui n'est pas une liste d'objets identifiés (réglage,
 *     position de caméra) n'est JAMAIS fusionnée n'importe comment.
 *   - sans interface de choix, le comportement historique est intact — c'est
 *     ce repli qui permet à toute la suite archive existante de continuer à
 *     passer sans modification.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    IMPORT_CATEGORIES,
    applyScope,
    askImportScope,
    mergeCollectionJson,
    scopeCarriesGpx,
    scopeCarriesImages,
    scopeKeys,
    type ImportScope,
} from '@pctac/import-scope.js';
import { ADVERSARIES_KEY, HOSTAGES_KEY, LOCAL_STORAGE_KEY } from '@pctac/config.js';

const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@shared/feedback.js', () => ({
    confirmDialog: confirmSpy,
    promptDialog: vi.fn(),
    toast: vi.fn(),
}));

function scope(categories: string[], mode: 'merge' | 'replace'): ImportScope {
    return { categories, mode, full: mode === 'replace' && categories.length === IMPORT_CATEGORIES.length };
}

const item = (id: string, nom: string): Record<string, string> => ({ id, nom });

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    confirmSpy.mockClear();
    confirmSpy.mockResolvedValue(true);
});

describe('catégories', () => {
    it('couvre chaque clé une seule fois', () => {
        const toutes = IMPORT_CATEGORIES.flatMap((c) => c.keys);
        expect(new Set(toutes).size).toBe(toutes.length);
    });

    it('ne rapporte images et GPX que pour les catégories qui en portent', () => {
        expect(scopeCarriesImages(scope(['journal'], 'merge'))).toBe(false);
        expect(scopeCarriesImages(scope(['photos'], 'merge'))).toBe(true);
        expect(scopeCarriesGpx(scope(['journal'], 'merge'))).toBe(false);
        expect(scopeCarriesGpx(scope(['plan'], 'merge'))).toBe(true);
    });

    it('ne rend que les clés des catégories retenues', () => {
        expect(scopeKeys(scope(['adversaires'], 'merge'))).toEqual([ADVERSARIES_KEY]);
        expect(scopeKeys(scope([], 'merge'))).toEqual([]);
    });
});

describe('fusion', () => {
    it('ajoute ce qui manque et garde la version locale sur un conflit', () => {
        const local = JSON.stringify([item('1', 'local'), item('2', 'local')]);
        const distant = JSON.stringify([item('2', 'distant'), item('3', 'distant')]);
        const fusion = JSON.parse(mergeCollectionJson(local, distant) as string) as Record<string, string>[];

        expect(fusion.map((i) => i.id)).toEqual(['1', '2', '3']);
        expect(fusion.find((i) => i.id === '2')?.nom).toBe('local');
    });

    it('n\'accumule pas de doublons quand la même archive est importée deux fois', () => {
        const distant = JSON.stringify([item('1', 'a'), item('2', 'b')]);
        const un = mergeCollectionJson(null, distant);
        const deux = mergeCollectionJson(un, distant);
        expect((JSON.parse(deux as string) as unknown[]).length).toBe(2);
    });

    it('garde la valeur locale quand ce n\'est pas une liste d\'objets identifiés', () => {
        expect(mergeCollectionJson('{"zoom":12}', '{"zoom":18}')).toBe('{"zoom":12}');
        expect(mergeCollectionJson('true', 'false')).toBe('true');
    });

    it('garde la valeur locale sur un JSON illisible des deux côtés', () => {
        expect(mergeCollectionJson('pas du json', '[]')).toBe('pas du json');
    });

    it('adopte la valeur distante quand rien n\'existe localement', () => {
        expect(mergeCollectionJson(null, '[]')).toBe('[]');
    });

    it('laisse le local intact quand l\'archive ne porte pas la clé', () => {
        expect(mergeCollectionJson('[1]', undefined)).toBe('[1]');
    });
});

describe('application au stockage', () => {
    it('ne touche PAS aux catégories non cochées', () => {
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([item('a', 'mien')]));
        localStorage.setItem(HOSTAGES_KEY, JSON.stringify([item('h', 'mien')]));

        applyScope({
            [ADVERSARIES_KEY]: JSON.stringify([item('b', 'sien')]),
            [HOSTAGES_KEY]: JSON.stringify([item('z', 'sien')]),
        }, scope(['adversaires'], 'merge'));

        const otages = JSON.parse(localStorage.getItem(HOSTAGES_KEY) as string) as Record<string, string>[];
        expect(otages.map((i) => i.id)).toEqual(['h']);
        const advs = JSON.parse(localStorage.getItem(ADVERSARIES_KEY) as string) as Record<string, string>[];
        expect(advs.map((i) => i.id)).toEqual(['a', 'b']);
    });

    it('vide une catégorie remplacée que l\'archive ne porte pas', () => {
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([item('a', 'mien')]));
        applyScope({}, scope(['adversaires'], 'replace'));
        expect(localStorage.getItem(ADVERSARIES_KEY)).toBeNull();
    });

    it('écrase la catégorie choisie en remplacement', () => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([item('vieux', 'x')]));
        applyScope({ [LOCAL_STORAGE_KEY]: JSON.stringify([item('neuf', 'y')]) }, scope(['journal'], 'replace'));
        const journal = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) as string) as Record<string, string>[];
        expect(journal.map((i) => i.id)).toEqual(['neuf']);
    });
});

describe('demande de portée', () => {
    it('retombe sur la confirmation simple et la restauration intégrale sans interface', async () => {
        const result = await askImportScope();
        expect(confirmSpy).toHaveBeenCalledOnce();
        expect(result?.full).toBe(true);
        expect(result?.mode).toBe('replace');
        expect(result?.categories).toHaveLength(IMPORT_CATEGORIES.length);
    });

    it('rend null quand la confirmation est refusée', async () => {
        confirmSpy.mockResolvedValue(false);
        expect(await askImportScope()).toBeNull();
    });
});
