#!/usr/bin/env node

/**
 * Générateur de module VFS base64 pour les polices PDF.
 * Lit les TTF depuis src/apps/oi/pdf/fonts/ et produit fonts.generated.ts
 * avec un Record<string, string> contenant les données base64 encodées.
 *
 * Usage:
 *   npm run gen:pdf-fonts
 *   ou
 *   node scripts/gen-pdf-fonts.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

const FONTS_DIR = resolve(import.meta.dirname, '../src/apps/oi/pdf/fonts');
const OUTPUT_FILE = resolve(FONTS_DIR, '../fonts.generated.ts');

// Mapping VFS : clé → fichier (ordre FIXE pour déterminisme)
const FONT_MAPPING = [
  ['Oswald-500.ttf', 'oswald_500.ttf'],
  ['JetBrainsMono-400.ttf', 'jetbrains_mono_400.ttf'],
  ['JetBrainsMono-700.ttf', 'jetbrains_mono_700.ttf'],
];

try {
  const vfs = {};
  let totalSize = 0;

  // Lire et encoder les 3 TTF
  for (const [vfsKey, fileName] of FONT_MAPPING) {
    const filePath = join(FONTS_DIR, fileName);
    let buffer;
    try {
      buffer = readFileSync(filePath);
    } catch {
      console.error(`❌ Erreur : fichier manquant: ${filePath}`);
      process.exit(1);
    }

    const base64 = buffer.toString('base64');
    vfs[vfsKey] = base64;
    totalSize += base64.length;

    console.log(`✓ ${fileName}: ${buffer.length} octets → base64 (${base64.length} car.)`);
  }

  // Générer le code TypeScript (ordre fixe des clés)
  const tsCode = `// FICHIER GÉNÉRÉ par scripts/gen-pdf-fonts.mjs — NE PAS ÉDITER À LA MAIN.
// Régénérer avec :  npm run gen:pdf-fonts

export const PDF_FONT_VFS: Record<string, string> = {
${FONT_MAPPING.map(([vfsKey]) => `  '${vfsKey}': '${vfs[vfsKey]}',`).join('\n')}
};
`;

  writeFileSync(OUTPUT_FILE, tsCode, 'utf8');

  console.log(`✓ Fichier généré : ${OUTPUT_FILE}`);
  console.log(`  Taille du module : ${(tsCode.length / 1024).toFixed(1)} Ko`);
  console.log(`  Données base64 totales : ${(totalSize / 1024).toFixed(1)} Ko`);
} catch (err) {
  console.error('❌ Erreur lors de la génération :', err.message);
  process.exit(1);
}
