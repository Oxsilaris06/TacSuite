/**
 * pc-tuto-data.test.ts — Garde-fou du tutoriel PC-Tac (décision 36, C10).
 * ===========================================================================
 *
 * Le fichier `tuto-data.ts` se dit « généré » : ce test le vérifie contre le
 * code ACTUEL.
 *   - chaque `selector` non nul désigne un élément de `pctac/index.html`
 *     (analysé avec jsdom), OU figure dans une liste EXPLICITE d'éléments créés
 *     par le code (chacun avec le fichier qui le crée) ;
 *   - chaque terme de `terms` apparaît verbatim dans `pctac/index.html` ou dans
 *     `src/` — la source du tutoriel elle-même est EXCLUE (sinon le test serait
 *     circulaire).
 * Le lot B modifie `pctac/index.html` en parallèle : lancer ce test après
 * fusion pour recaler les libellés.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { pctacTutoData } from '../../../src/apps/pctac/tuto-data.js';
import type { TutoData } from '../../../src/shared/types/tuto.js';

const REPO = process.cwd();
const html = readFileSync(join(REPO, 'pctac', 'index.html'), 'utf8');
const htmlDoc = new JSDOM(html).window.document;

/** Source de tous les .ts de `src/`, SAUF le tutoriel lui-même (anti-circulaire). */
function collectSrc(): string {
    const root = join(REPO, 'src');
    const parts: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (extname(entry.name) === '.ts') {
                if (p.endsWith(join('pctac', 'tuto-data.ts'))) continue;
                parts.push(readFileSync(p, 'utf8'));
            }
        }
    };
    walk(root);
    return parts.join('\n');
}

const SRC = collectSrc();

/**
 * Éléments créés par le code (absents de `index.html`), avec le fichier qui
 * les crée. Toute entrée ici est une DETTE : idéalement, l'élément devrait
 * exister dans le balisage ou le tutoriel ne pas le citer.
 */
const CODE_CREATED_SELECTORS: Record<string, string> = {
    // (aucun pour l'instant : tout sélecteur cité doit exister dans index.html)
};

function allSteps(data: TutoData): Array<{ chapter: string; step: string; selector: string | null; terms: string[] }> {
    const out: Array<{ chapter: string; step: string; selector: string | null; terms: string[] }> = [];
    for (const chapter of data.chapters) {
        for (const step of chapter.steps) {
            out.push({ chapter: chapter.title, step: step.title, selector: step.selector, terms: step.terms });
        }
    }
    return out;
}

describe('tutoriel PC-Tac — garde-fou contre le code', () => {
    const data = pctacTutoData();
    const steps = allSteps(data);

    it('chaque selector non nul désigne un élément réel (index.html ou liste explicite)', () => {
        const missing: string[] = [];
        for (const s of steps) {
            if (!s.selector) continue;
            const found = htmlDoc.querySelector(s.selector) !== null || Object.prototype.hasOwnProperty.call(CODE_CREATED_SELECTORS, s.selector);
            if (!found) missing.push(`« ${s.chapter} » / « ${s.step} » : ${s.selector}`);
        }
        expect(missing, `sélecteurs introuvables :\n${missing.join('\n')}`).toEqual([]);
    });

    it('chaque terme de terms apparaît verbatim dans index.html ou dans src/ (hors tutoriel)', () => {
        const missing: string[] = [];
        for (const s of steps) {
            for (const term of s.terms) {
                if (!term) continue;
                if (!html.includes(term) && !SRC.includes(term)) {
                    missing.push(`« ${s.chapter} » / « ${s.step} » : ${term}`);
                }
            }
        }
        expect(missing, `termes introuvables :\n${missing.join('\n')}`).toEqual([]);
    });

    it('la structure TutoData est complète (intro + chapitres + 5 champs par étape)', () => {
        expect(typeof data.intro.title).toBe('string');
        expect(typeof data.intro.text).toBe('string');
        expect(data.chapters.length).toBeGreaterThan(0);
        for (const c of data.chapters) {
            expect(typeof c.id).toBe('string');
            expect(typeof c.icon).toBe('string');
            for (const st of c.steps) {
                expect(typeof st.title).toBe('string');
                expect(typeof st.body).toBe('string');
                expect(Array.isArray(st.terms)).toBe(true);
                expect(st.selector === null || typeof st.selector === 'string').toBe(true);
                expect(st.tip === null || typeof st.tip === 'string').toBe(true);
            }
        }
    });
});
