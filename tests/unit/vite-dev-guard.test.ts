// @vitest-environment node
/**
 * vite-dev-guard.test.ts — garde du serveur de DÉVELOPPEMENT (revue du 2026-09-26).
 *
 * SEC-4 : Vite monte `/__open-in-editor` par connect, qui compare le chemin sans
 * tenir compte de la casse ; la garde comparait en minuscules seulement, donc
 * `/__OPEN-IN-EDITOR` passait (vérifié sur le Funnel).
 * F1 : les fichiers servis sont une liste d'autorisation, fermée par défaut ; la
 * liste de refus ne sert plus que de seconde barrière.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_SERVER_FS, isEditorRequest } from '../../vite.config';

describe('isEditorRequest', () => {
    it.each([
        '/__open-in-editor?file=src/main.ts',
        '/__OPEN-IN-EDITOR',
        '/__Open-In-Editor?file=x',
        '/%5F%5Fopen-in-editor?file=x',
        '/tacsuite/__open-in-editor?file=x',
    ])('bloque %s', (url) => {
        expect(isEditorRequest(url)).toBe(true);
    });

    it.each(['/', '/pctac/', '/src/apps/oi/main.ts', '/%E0%A4%A', '/editor/open.ts'])('laisse passer %s', (url) => {
        expect(isEditorRequest(url)).toBe(false);
    });
});

describe('DEV_SERVER_FS', () => {
    const root = path.resolve(__dirname, '../..');
    const allowed = DEV_SERVER_FS.allow.map((p) => path.relative(root, p));

    it('n’autorise que l’application, jamais la racine du dépôt', () => {
        expect(DEV_SERVER_FS.strict).toBe(true);
        expect(allowed).not.toContain('');
        expect(allowed).toEqual(expect.arrayContaining(['index.html', 'pctac', 'oi', 'src', 'styles', 'public', 'node_modules']));
        for (const hidden of ['scratch', 'tools', 'docs', 'graphify-out', 'DevSYNCState.md', 'playwright-report']) {
            expect(allowed.some((a) => hidden === a || hidden.startsWith(`${a}/`))).toBe(false);
        }
    });

    it('garde la liste de refus en seconde barrière', () => {
        expect(DEV_SERVER_FS.deny).toEqual(expect.arrayContaining(['.env', '**/.git/**', '*.md', 'tokens.json']));
    });
});

describe('DEV_SERVER_FS.deny — même lecture que Vite (picomatch)', () => {
    // Vite préfixe par « **/ » un motif sans « / », puis compare le chemin absolu.
    const require = createRequire(import.meta.url);
    const pm = require('picomatch') as (globs: string[], opts: object) => (p: string) => boolean;
    const denied = pm(DEV_SERVER_FS.deny.map((p) => (p.includes('/') ? p : `**/${p}`)), { matchBase: false, nocase: true, dot: true });
    const root = path.resolve(__dirname, '../..');

    it('ne refuse aucun fichier de l’application, ni dans le dépôt ni dans un worktree de ~/.ai', () => {
        for (const base of [root, '/home/u/.ai/worktrees/atelier']) {
            for (const f of ['src/apps/pctac/main.ts', 'pctac/index.html', 'styles/pctac.css', 'node_modules/.vite/deps/maplibre-gl.js']) {
                expect(denied(`${base}/${f}`), `${base}/${f}`).toBe(false);
            }
        }
    });

    it('ne sert ni les secrets ni les notes locales, à la racine comme dans un dossier autorisé', () => {
        const served = (abs: string): boolean => DEV_SERVER_FS.allow.some((a) => abs === a || abs.startsWith(`${a}/`)) && !denied(abs);
        for (const f of ['.env', 'DevSYNCState.md', 'tools/osmand-relay/tokens.json', '.git/config', 'graphify-out/graph.json',
            'src/.env.local', 'src/NOTES.md', 'public/tokens.json', 'src/cle.pem', 'node_modules/playwright-core/lib/x.js']) {
            expect(served(`${root}/${f}`), f).toBe(false);
        }
        expect(served(`${root}/src/apps/pctac/main.ts`)).toBe(true);
    });
});
