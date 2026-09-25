/**
 * pdf-fonts-extra.test.ts — polices de repli (Noto Sans, Noto Sans Arabic),
 * chargées à la demande : clés attendues, couverture des écritures promises
 * par la décision 44, et aucune ligature qui ferait planter fontkit (incident
 * JetBrains Mono du 02/08 au 25/09).
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { EXTRA_FONT_KEYS, base64ToBytes, glyphTester, loadExtraFontVfs } from '@shared/pdf-fonts/index.js';

describe('polices de repli', () => {
    it('le module chargé à la demande contient les trois polices', async () => {
        const vfs = await loadExtraFontVfs();
        expect(Object.keys(vfs).sort()).toEqual(Object.values(EXTRA_FONT_KEYS).sort());
    });

    it('Noto Sans couvre latin, grec et cyrillique ; Noto Sans Arabic couvre l’arabe', async () => {
        const vfs = await loadExtraFontVfs();
        const noto = glyphTester(base64ToBytes(vfs[EXTRA_FONT_KEYS.notoRegular]!));
        const arabic = glyphTester(base64ToBytes(vfs[EXTRA_FONT_KEYS.notoArabic]!));
        for (const ch of 'AéŒ€’Ωλ Жж…') expect(noto(ch.codePointAt(0)!)).toBe(true);
        expect(noto('ب'.codePointAt(0)!)).toBe(false);
        for (const ch of 'بنمحد') expect(arabic(ch.codePointAt(0)!)).toBe(true);
    });

    it('aucune suite de ponctuation ne fait planter l’embarquement pdf-lib', async () => {
        const vfs = await loadExtraFontVfs();
        const doc = await PDFDocument.create();
        doc.registerFontkit(fontkit);
        const fonts = await Promise.all(Object.values(vfs).map((b64) => doc.embedFont(base64ToBytes(b64), { subset: true })));
        const page = doc.addPage();
        const P = '.?!-=<>:|&#/*+~_;';
        for (const font of fonts) for (const a of P) for (const b of P) {
            expect(() => page.drawText(`${a}${b}${a} fi ffl`, { x: 10, y: 10, size: 9, font })).not.toThrow();
        }
        await expect(doc.save()).resolves.toBeInstanceOf(Uint8Array);
    });
});
