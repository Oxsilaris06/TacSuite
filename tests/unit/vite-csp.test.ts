// @vitest-environment node
/**
 * Politique de sécurité du contenu (CSP) posée au build dans chaque page (revue du 2026-10-28).
 * PC-Tac, le portail et la 404 refusent tout script inline non haché : un nom piégé injecté
 * par innerHTML (`<img onerror=…>`) ne s'exécute plus. Le Générateur d'OI garde
 * 'unsafe-inline' tant que ses gestionnaires `onclick=` générés ne sont pas convertis.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withCsp } from '../../vite.config';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const policyOf = (html: string): string => /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
const scriptSrc = (policy: string): string => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';

describe('CSP de build', () => {
    it('PC-Tac : scripts limités à l’origine et aux scripts inline hachés, sans unsafe-inline', () => {
        const html = read('pctac/index.html');
        const out = withCsp(html, '/pctac/index.html');
        const src = scriptSrc(policyOf(out));
        const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
        const hash = createHash('sha256').update(inline).digest('base64');
        expect(src).toContain("'self'");
        expect(src).toContain(`'sha256-${hash}'`);
        expect(src).not.toContain('unsafe-inline');
        expect(policyOf(out)).toContain("object-src 'none'");
    });

    it('la balise CSP précède le premier script de la page', () => {
        for (const [file, path] of [['index.html', '/index.html'], ['pctac/index.html', '/pctac/index.html'], ['404.html', '/404.html']] as const) {
            const out = withCsp(read(file), path);
            expect(out.indexOf('Content-Security-Policy')).toBeGreaterThan(-1);
            expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<script'));
        }
    });

    it('Générateur d’OI : unsafe-inline sans hachage (un hachage désactiverait unsafe-inline)', () => {
        const src = scriptSrc(policyOf(withCsp(read('oi/index.html'), '/oi/index.html')));
        expect(src).toContain("'unsafe-inline'");
        expect(src).not.toContain('sha256-');
    });

    it('PC-Tac n’a plus de gestionnaire inline dans sa page', () => {
        expect(read('pctac/index.html')).not.toMatch(/\son[a-z]+="/);
    });

    // Le serveur de dev n'a pas de CSP : un `onclick="…"` généré y marcherait et casserait
    // en production. Ce garde couvre le code de PC-Tac, du portail et du code partagé.
    it('aucun gestionnaire inline généré dans src/apps/pctac, src/apps/portal, src/shared', () => {
        const root = fileURLToPath(new URL('../../src/', import.meta.url));
        const offenders = ['apps/pctac', 'apps/portal', 'shared']
            .flatMap((dir) => readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).map((f) => join(root, dir, f)))
            .filter((f) => f.endsWith('.ts'))
            .flatMap((f) => readFileSync(f, 'utf8').split('\n')
                .filter((l) => !/^\s*(\*|\/\/)/.test(l) && /[\s'"`]on[a-z]+=["']/.test(l))
                .map((l) => `${f}: ${l.trim()}`));
        expect(offenders).toEqual([]);
    });
});
