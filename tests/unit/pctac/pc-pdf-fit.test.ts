/**
 * pc-pdf-fit.test.ts — Coupe d'un texte à la largeur d'une colonne du PDF
 * (revue finale, F8). Le passage à une police complète (JetBrains Mono) a
 * étendu la coupe au journal, aux amis et aux points ; elle retirait un
 * caractère à la fois en remesurant toute la chaîne : coût quadratique, plusieurs
 * secondes de blocage pour un champ long arrivé d'une archive.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDF_FONT_VFS } from '@oi/pdf/fonts.js';
import { fitTextToWidth } from '@pctac/pdf-export.js';

const bytes = (n: string): Uint8Array => Uint8Array.from(atob(PDF_FONT_VFS[n]!), (c) => c.charCodeAt(0));

/** Référence : l'algorithme d'origine (un caractère à la fois). */
function naiveFit(text: string, font: PDFFont, size: number, maxWidth: number): string {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) out = out.slice(0, -1);
    return `${out.trimEnd()}…`;
}

let mono: PDFFont;
let oswald: PDFFont;

beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    mono = await doc.embedFont(bytes('JetBrainsMono-400.ttf'), { subset: true });
    oswald = await doc.embedFont(bytes('Oswald-500.ttf'), { subset: true });
});

describe('fitTextToWidth', () => {
    it('même résultat que la coupe d’origine sur des textes courts et moyens', () => {
        const samples = [
            'Court',
            'Rue de la République, 45000 Orléans, près du rond-point',
            'LEFEBVRE-DUMONT Marie-Christine',
            'Négociateur principal GIGN [06 12 34 56 78]',
            'Łukasz Ștefan Øyvind Ğül Дмитрий',
            'Fin avec espaces            ',
        ];
        for (const font of [mono, oswald]) {
            for (const text of samples) {
                for (const width of [30, 80, 145, 210]) {
                    expect(fitTextToWidth(text, font, 9, width), `${text} @${width}`).toBe(naiveFit(text, font, 9, width));
                }
            }
        }
    });

    it('le résultat tient toujours dans la largeur', () => {
        const text = 'Carrefour rue Jeanne d’Arc / rue de la République, Orléans '.repeat(20);
        for (const width of [20, 60, 145, 400]) {
            expect(mono.widthOfTextAtSize(fitTextToWidth(text, mono, 9, width), 9)).toBeLessThanOrEqual(width);
        }
    });

    it('coût quasi constant : 5 000 caractères coupés en moins de 60 ms', () => {
        const text = 'Rue de la République '.repeat(250).slice(0, 5000);
        fitTextToWidth(text, mono, 9, 145); // échauffement
        const t0 = performance.now();
        const out = fitTextToWidth(text, mono, 9, 145);
        expect(performance.now() - t0).toBeLessThan(60);
        expect(out.endsWith('…')).toBe(true);
    });
});
