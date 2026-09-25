/**
 * r2b-pdf-widths.test.ts — C16 / « Insuffisant B-3 » : après le passage du
 * corps en JetBrains Mono (monospace, ~40 % plus large que l'Oswald condensé),
 * TOUTES les colonnes à largeur fixe du PDF doivent tronquer avec « … » plutôt
 * que déborder sur la colonne voisine ou la marge.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDF_FONT_VFS } from '@oi/pdf/fonts.js';
import { fitTextToWidth } from '@pctac/pdf-export.js';

const bytes = (n: string): Uint8Array => Uint8Array.from(atob(PDF_FONT_VFS[n]!), (c) => c.charCodeAt(0));

async function fonts(): Promise<{ font: import('pdf-lib').PDFFont; bold: import('pdf-lib').PDFFont }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes('JetBrainsMono-400.ttf'), { subset: true });
  const bold = await doc.embedFont(bytes('JetBrainsMono-700.ttf'), { subset: true });
  return { font, bold };
}

describe('C16 / B-3 — troncature des colonnes fixes du PDF', () => {
  it('la table Forces amies tient dans ses trois colonnes', async () => {
    const { font } = await fonts();
    // (texte, largeur disponible) — cf. pdf-export.ts fCols [150,150,215] moins 5 pt.
    const cases: [string, number][] = [
      ['LEFEBVRE-DUMONT Marie-Christine', 145],
      ['DE LA FONTAINE-MARTIN Jean-Baptiste', 145],
      ['PSIG Sabre Orléans compagnie', 145],
      ['Négociateur principal GIGN [06 12 34 56 78]', 210],
    ];
    for (const [text, width] of cases) {
      const out = fitTextToWidth(text, font, 9, width);
      expect(out.endsWith('…')).toBe(true);
      expect(font.widthOfTextAtSize(out, 9)).toBeLessThanOrEqual(width + 0.01);
    }
  });

  it('un texte qui tient déjà est rendu tel quel', async () => {
    const { font } = await fonts();
    expect(fitTextToWidth('PSIG', font, 9, 145)).toBe('PSIG');
  });

  it('les autres colonnes fixes (journal, points) restent dans leur largeur', async () => {
    const { font, bold } = await fonts();
    // (texte représentatif au pire, police, taille, largeur) — largeurs des
    // colWidths/pCols de pdf-export.ts, moins 5 pt de marge interligne.
    const cases: [string, import('pdf-lib').PDFFont, number, number][] = [
      ['ADVERSAIRE-LONGPRE', bold, 8, 65],   // journal : Pax (colWidths[1]-5)
      ['RUE DE LA REPUBLIQUE 1234567890', font, 9, 145], // journal : Lieu (colWidths[2]-5)
      ['12:34', font, 9, 45],                 // journal : Heure (colWidths[0]-5)
      ['POINT DE RASSEMBLEMENT ALPHA BRAVO CHARLIE', font, 9, 135], // points : Label (pCols[0]-5)
      ['31U DQ 12345 67890', font, 8, 125],   // points : MGRS (pCols[1]-5)
      ['AB12', bold, 9, 35],                   // points : Case (pCols[2]-5)
      ['48,123456', font, 8, 67],             // points : Latitude (pCols[3]-5)
      ['2,123456', font, 8, 67],              // points : Longitude (pCols[4]-5)
      ['1234', font, 9, 56],                  // points : Diamètre (pCols[5]-5)
    ];
    for (const [text, face, size, width] of cases) {
      const out = fitTextToWidth(text, face, size, width);
      expect(face.widthOfTextAtSize(out, size)).toBeLessThanOrEqual(width + 0.01);
    }
  });
});
