/**
 * utils.ts — Utilitaires globaux pour PC-Tac
 * ==========================================
 *
 * Port TypeScript de `modules/pctac/utils.js` (GStart-main, 52 LOC).
 * Cf. docs/SPEC-PCTAC-CONVERSION.md §1.1 et §9 (piège).
 */

export const Utils = {
  /**
   * Compresse une image (redimensionnement et qualité JPEG).
   *
   * PIÈGE : accepte INDIFFÉREMMENT un File OU une dataURL (string).
   * La sortie est TOUJOURS 'image/jpeg', même si l'entrée est PNG.
   * (utils.js:14-51)
   *
   * @param source - Fichier image (File) ou Data URL (string)
   * @param maxWidth - Largeur maximale, défaut 1024
   * @param maxHeight - Hauteur maximale, défaut 1024
   * @param quality - Facteur JPEG 0-1, défaut 0.7
   * @returns Promise<string> Data URL compressée en image/jpeg
   */
  async compressImage(
    source: File | string,
    maxWidth: number = 1024,
    maxHeight: number = 1024,
    quality: number = 0.7,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calcul des dimensions en conservant l'aspect ratio
        // (utils.js:22-31)
        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // Sortie TOUJOURS en image/jpeg (utils.js:38)
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;

      // Branchement : File OU dataURL (utils.js:42-48)
      if (source instanceof File) {
        // Lecture du File en dataURL
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            img.src = result;
          } else {
            reject(new Error('FileReader did not return a string'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(source);
      } else {
        // Chaîne dataURL directement
        img.src = source;
      }
    });
  },
};
