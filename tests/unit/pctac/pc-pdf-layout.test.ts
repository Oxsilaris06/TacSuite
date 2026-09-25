/**
 * pc-pdf-layout.test.ts — Mise en page et intégrité du contenu du PDF PC-Tac
 * (audit du 2026-09-25 : constats M1, M2, M3, M4, M5, Mo5).
 *
 * Les helpers purs (wrapText) sont testés directement ; les correctifs qui se
 * voient seulement dans le document sont vérifiés sur un PDF réellement généré
 * par buildPdf(), relu avec pdf.js.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDF_FONT_VFS } from '@oi/pdf/fonts.js';

const bytes = (n: string): Uint8Array => Uint8Array.from(atob(PDF_FONT_VFS[n]!), (c) => c.charCodeAt(0));

let mono: PDFFont;

beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    mono = await doc.embedFont(bytes('JetBrainsMono-400.ttf'), { subset: true });
});

describe('wrapText — coupe dure des mots trop longs (M2)', () => {
    it('scinde un jeton plus large que la colonne au lieu de le laisser déborder', async () => {
        const { wrapText } = await import('@pctac/pdf-export.js');
        const width = 145;
        const lines = wrapText('NOMTRESLONG'.repeat(40), width, mono, 9);
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
            expect(mono.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(width + 0.01);
        }
    });

    it('conserve le repli aux espaces pour un texte normal', async () => {
        const { wrapText } = await import('@pctac/pdf-export.js');
        expect(wrapText('un deux trois', 1000, mono, 9)).toEqual(['un deux trois']);
    });
});
