/**
 * import-merge-label.test.ts — R8 : le libellé de « Fusionner » ne doit plus
 * promettre que rien de local n'est perdu (décision 32 : la fiche la plus
 * récente gagne et peut remplacer une saisie locale plus ancienne).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'pctac/index.html'), 'utf8');

describe('modale d’import — libellé « Fusionner » (R8)', () => {
    it('annonce la version la plus récente gardée, et plus « rien de local n’est perdu »', () => {
        expect(html).toContain('la version la plus récente est gardée');
        expect(html).not.toContain("Rien de local n'est perdu");
    });
});
