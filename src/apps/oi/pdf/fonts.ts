/**
 * Polices embarquées pour le moteur PDF vectoriel de l'OI.
 * Module reutilisable par pdfmake (voie A) et impression HTML (voie B).
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

/**
 * Déclarations CSS @font-face pour les trois faces.
 * Résultat mémoïsé — calculé une seule fois.
 */
let fontFaceCssCache: string | null = null;

export function fontFacesCss(): string {
  if (fontFaceCssCache !== null) {
    return fontFaceCssCache;
  }

  const faces = [
    { family: 'Oswald', weight: 500, key: 'Oswald-500.ttf' },
    { family: 'JetBrains Mono', weight: 400, key: 'JetBrainsMono-400.ttf' },
    { family: 'JetBrains Mono', weight: 700, key: 'JetBrainsMono-700.ttf' },
  ];

  fontFaceCssCache = faces
    .map(
      (face) =>
        `@font-face { font-family:'${face.family}'; font-weight:${face.weight}; ` +
        `src:url(data:font/ttf;base64,${PDF_FONT_VFS[face.key]}) format('truetype'); }`,
    )
    .join('\n');

  return fontFaceCssCache;
}
