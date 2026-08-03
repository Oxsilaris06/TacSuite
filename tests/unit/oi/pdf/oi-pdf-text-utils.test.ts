/**
 * oi-pdf-text-utils.test.ts — Tests unitaires de `src/apps/oi/pdf/text-utils.ts`
 * (blindage PDF OI, mission BLIND.A #1 « coupure mots »). Démontre le
 * comportement AVANT/APRÈS de `breakLongTokens()` : un token ≥ 76-80
 * caractères (cf. `matrice-rupture.md` §4, crash fontkit confirmé) doit
 * recevoir des points de coupure invisibles SANS perte d'aucun caractère du
 * texte source.
 */
import { describe, expect, it } from 'vitest';

import { breakLongTokens, MAX_UNBROKEN_TOKEN_LENGTH, SOFT_HYPHEN } from '@oi/pdf/text-utils.js';

// Nom conservé « ZWSP » dans les assertions ci-dessous pour minimiser le diff,
// mais la valeur importée est désormais SOFT_HYPHEN (U+00AD) — cf. text-utils.ts
// (BLIND.REFIX round 1 : ZWSP abandonné, glyphe .notdef non mappé dans la police).
const ZWSP = SOFT_HYPHEN;

describe('breakLongTokens', () => {
    it('texte vide/falsy renvoyé tel quel, jamais d’exception', () => {
        expect(breakLongTokens('')).toBe('');
        expect(breakLongTokens(undefined as unknown as string)).toBe(undefined);
        expect(breakLongTokens(null as unknown as string)).toBe(null);
    });

    it('un token court (<= 40 car.) traverse inchangé', () => {
        const text = 'RAS, un mot de taille normale.';
        expect(breakLongTokens(text)).toBe(text);
    });

    it('un mot exactement à la limite (40 car.) reste inchangé', () => {
        const word = 'A'.repeat(MAX_UNBROKEN_TOKEN_LENGTH);
        expect(breakLongTokens(word)).toBe(word);
    });

    it('un mot de 41 car. reçoit un point de coupure ZWSP après 40 car.', () => {
        const word = 'A'.repeat(41);
        const result = breakLongTokens(word);
        expect(result).toBe('A'.repeat(40) + ZWSP + 'A');
    });

    // ===========================================================================
    // Cas AUDIT — mot de 80 caractères (crash fontkit confirmé, matrice-rupture.md §4).
    // ===========================================================================
    it("le mot de 80 caractères de l'audit (crash fontkit confirmé) ne perd AUCUN caractère : le texte débarrassé de ses ZWSP est identique à l'original", () => {
        const longUrl =
            'http://AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.example/chemin/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const item = `- ${longUrl}`;
        const result = breakLongTokens(item);

        // Au moins un point de coupure inséré (le token nu fait 183 car., > 40).
        expect(result).toContain(ZWSP);
        // Contenu intégral préservé : retirer les ZWSP redonne EXACTEMENT le texte source.
        expect(result.replace(new RegExp(ZWSP, 'g'), '')).toBe(item);
        // Aucun run de plus de 40 caractères consécutifs SANS point de coupure ne subsiste.
        const worstRun = result.split(new RegExp(`[\\s${ZWSP}]`)).reduce((max, run) => Math.max(max, run.length), 0);
        expect(worstRun).toBeLessThanOrEqual(MAX_UNBROKEN_TOKEN_LENGTH);
    });

    it('un texte à plusieurs tokens ne touche QUE les tokens dépassant la limite, les autres restent identiques', () => {
        const text = `Consigne normale. ${'B'.repeat(50)} Autre consigne normale.`;
        const result = breakLongTokens(text);
        expect(result).toContain('Consigne normale.');
        expect(result).toContain('Autre consigne normale.');
        expect(result).toContain(ZWSP);
        expect(result.replace(new RegExp(ZWSP, 'g'), '')).toBe(text);
    });

    // ===========================================================================
    // Cas AUDIT — paire `//` adjacente (URL `http://…`, crash pdfmake/fontkit
    // confirmé par contre-épreuve DIRECTE, INDÉPENDANT de la longueur du token :
    // reproduit avec la seule chaîne « // », cf. JSDoc `protectSlashPairs`).
    // ===========================================================================
    it('une paire « // » adjacente est séparée par un ZWSP, quelle que soit la longueur du texte', () => {
        expect(breakLongTokens('//')).toBe(`/${ZWSP}/`);
        expect(breakLongTokens('a//b')).toBe(`a/${ZWSP}/b`);
    });

    it('une URL complète (http:// + domaine long) a sa paire « // » séparée, contenu intégral préservé', () => {
        const url =
            'http://AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.example/chemin/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const result = breakLongTokens(url);
        expect(result).not.toContain('//');
        expect(result.replace(new RegExp(ZWSP, 'g'), '')).toBe(url);
    });

    it('un triple slash « /// » (aucune paire adjacente ne subsiste) — cassure confirmée aussi sur ce motif', () => {
        const result = breakLongTokens('a///b');
        expect(result).not.toMatch(/\/\//);
    });

    it("l'algorithme de repli à la ligne UAX#14 de pdfmake (module `linebreak`) reconnaît bien un point de coupure après le ZWSP inséré", async () => {
        // Contre-épreuve directe contre la dépendance réelle de pdfmake (pas une
        // supposition) : cf. JSDoc de `text-utils.ts` sur le choix du caractère.
        // `linebreak` n'expose pas de types — import dynamique non typé assumé,
        // circonscrit à ce seul test de contre-épreuve.
        // @ts-expect-error `linebreak` n'expose aucune déclaration de type.
        const linebreakMod = await import('linebreak');
        const LineBreaker = linebreakMod.default as new (text: string) => { nextBreak(): { position: number } | null };
        const word = 'C'.repeat(60);
        const broken = breakLongTokens(word, 20);
        const breaker = new LineBreaker(broken);
        const positions: number[] = [];
        let bk;
        while ((bk = breaker.nextBreak())) {
            positions.push(bk.position);
        }
        // Un point de coupure doit tomber juste après chacun des 2 ZWSP insérés (à 20 et 41, cf. longueur ZWSP=1).
        expect(positions).toContain(21);
        expect(positions).toContain(42);
    });
});
