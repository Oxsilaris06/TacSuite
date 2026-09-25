/**
 * merge-absent-local.test.ts — R2 : en fusion, une valeur d'archive NON liste
 * est reprise quand la situation locale n'en a pas (carroyage, tableau de
 * liens, associations, cadrage, verrou).
 */
import { describe, expect, it } from 'vitest';
import { applyScope, mergeCollectionJson } from '@pctac/import-scope.js';

describe('fusion : valeur locale absente, valeur d’archive NON liste', () => {
    it('mergeCollectionJson(null, objet) reprend l’archive (comportement d’avant 034fc1f)', () => {
        const grid = JSON.stringify({ lat: 47.9, lon: 1.9, cellM: 50 });
        expect(mergeCollectionJson(null, grid)).toBe(grid);
    });
    it('applyScope en fusion écrit le carroyage de l’archive dans une situation qui n’en a pas', () => {
        localStorage.clear();
        const grid = JSON.stringify({ lat: 47.9, lon: 1.9, cellM: 50 });
        const assoc = JSON.stringify({ '#ff0000': 'Equipe A' });
        const dash = '{"nodes":{},"links":[]}';
        applyScope({ pcTacPlanGrid: grid, pcTacTpAssociations: assoc, pcTacDashboard: dash } as Record<string, string>,
            { categories: ['plan', 'journal', 'liens'], mode: 'merge', full: false }, 'forcene');
        expect(localStorage.getItem('pcTacPlanGrid')).toBe(grid);
        expect(localStorage.getItem('pcTacTpAssociations')).toBe(assoc);
        expect(localStorage.getItem('pcTacDashboard')).toBe(dash);
    });
});
