/**
 * Polices embarquées pour le moteur PDF vectoriel de l'OI (pdfmake, voie A —
 * seule voie restante depuis R4-a, D2 « une seule voie d'output PDF »).
 * `fontFacesCss()` (déclarations `@font-face` pour l'impression HTML de la
 * voie B) a été retirée avec `print-view.ts`/`print-style.ts` (R4-a) : son
 * seul consommateur.
 * AUCUN import de pdfmake — reste indépendant du moteur.
 */

import { PDF_FONT_VFS } from './fonts.generated.js';

export { PDF_FONT_VFS };

/**
 * Définition des familles et leurs poids dans pdfmake.
 * Note : seule la graisse Oswald 500 (Medium) existe ; 'bold' pointe
 * volontairement sur le même fichier (les titres strategica sont en font-weight:500).
 */
export const PDF_FONTS = {
  Oswald: { normal: 'Oswald-500.ttf', bold: 'Oswald-500.ttf' },
  JetBrainsMono: { normal: 'JetBrainsMono-400.ttf', bold: 'JetBrainsMono-700.ttf' },
} as const;
