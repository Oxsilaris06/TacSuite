#!/usr/bin/env node
/**
 * tests/pdf/generate-from-fixture.mjs — harnais Node PUR de génération PDF
 * (mission PG.GUARD) : prend un fichier de données au format `OiPdfCollectedData`
 * (`{ formData, photosBase64?, isDark? }`) et produit le PDF réel de l'OI via
 * la MÊME fonction pure que l'application (`document-builder.ts::buildOiDocDefinition`),
 * SANS navigateur, SANS Playwright, SANS `print-view.ts` — uniquement
 * `document-builder.ts` (voie A, pdfmake) + `pdfmake` en mode serveur Node.
 *
 * POURQUOI un bundle Vite éphémère : `document-builder.ts` est un module TS
 * ESM (imports relatifs `./blocks.js`/`./theme.js` résolus vers les `.ts`
 * frères par la résolution « bundler » du projet, `import type` effacés à la
 * compilation). Node ne sait résoudre ni les types TS ni ce mapping .js->.ts
 * nativement : on bundle donc `document-builder.ts` avec l'API programmatique
 * de Vite (déjà une dépendance du projet, même moteur que `vite build`) en un
 * unique fichier ESM autonome, dans un dossier TEMPORAIRE hors du repo — cette
 * sortie n'est PAS un artefact source, jamais committée. Zéro alias `@shared`/
 * `@oi` à résoudre : `document-builder.ts` n'importe QUE des types depuis
 * `@shared/types/contracts.js` (`import type`, effacé) et deux frères locaux
 * (`blocks.ts`, `theme.ts`) — le bundle est donc fermé sans configuration
 * d'alias.
 *
 * POURQUOI pdfmake « nu » (pas `engine-v3.ts`) : `engine-v3.ts::buildOiPdfBlob`
 * appelle `pdfMake.createPdf(...).getBlob()` — API `Blob`/`URL` du NAVIGATEUR,
 * absente de Node. Le point d'entrée Node de pdfmake (`pdfmake` → `js/index.js`,
 * cf. `package.json:"main"`) expose une instance SERVEUR dont
 * `createPdf(docDefinition).write(path)` écrit directement sur disque (aucune
 * dépendance à `Blob`). Polices : plutôt que rejouer `addVirtualFileSystem`
 * (méthode ABSENTE de l'entrée Node, réservée à `browser-extensions/index.js`),
 * on pointe `setFonts()` directement vers les 3 TTF sources
 * (`src/apps/oi/pdf/fonts/*.ttf`, mêmes fichiers que `fonts.generated.ts`
 * encode en base64 pour le navigateur) : `PDFDocument.provideFont()` lit un
 * chemin réel sur disque quand il n'est pas trouvé dans le VFS pdfmake
 * (`virtualfs.existsSync` → false pour un chemin absolu) — comportement
 * documenté de `node_modules/pdfmake/js/PDFDocument.js:64-73`.
 *
 * Usage :
 *   node tests/pdf/generate-from-fixture.mjs <fixture.json> [--out=<fichier.pdf>]
 *       [--format=a4|16:9] [--theme=light|dark]
 *
 * Fixture attendue (JSON) : `{ "formData": {...OiFormData}, "photosBase64"?:
 * {...}, "isDark"?: boolean }` — même forme que `OiPdfCollectedData`
 * (`@shared/types/contracts.ts`), directement compatible avec un export
 * `Store.state.formData` réel (cf. `tests/pdf/fixtures/*.json`).
 *
 * Sortie : écrit le PDF à `--out` (défaut : un fichier temporaire nommé
 * d'après la fixture, sous le répertoire temporaire du système — JAMAIS dans
 * le repo sans `--out` explicite), imprime `PDF_PATH=<chemin>` en dernière
 * ligne de stdout (couture simple pour un script appelant), code de sortie 0
 * en succès, 1 en échec (message d'erreur sur stderr).
 */

import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DOCUMENT_BUILDER_ENTRY = path.join(PROJECT_ROOT, 'src/apps/oi/pdf/document-builder.ts');
const FONTS_DIR = path.join(PROJECT_ROOT, 'src/apps/oi/pdf/fonts');

function printUsage() {
  console.error(
    'Usage : node tests/pdf/generate-from-fixture.mjs <fixture.json> [--out=<fichier.pdf>] ' +
      '[--format=a4|16:9] [--theme=light|dark]'
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  if (positional.length !== 1) {
    printUsage();
    process.exit(2);
  }

  const getValue = (name) => {
    const flag = flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
    if (!flag) return undefined;
    const eq = flag.indexOf('=');
    return eq === -1 ? '' : flag.slice(eq + 1);
  };

  const fixturePath = path.resolve(positional[0]);
  const format = (getValue('format') ?? 'a4').toLowerCase();
  if (format !== 'a4' && format !== '16:9') {
    console.error(`Format invalide : "${format}" (attendu : a4 ou 16:9)`);
    printUsage();
    process.exit(2);
  }
  const themeRaw = getValue('theme');
  if (themeRaw !== undefined && themeRaw !== 'light' && themeRaw !== 'dark') {
    console.error(`--theme invalide : "${themeRaw}" (attendu : light ou dark)`);
    printUsage();
    process.exit(2);
  }
  const out = getValue('out');

  return { fixturePath, format, theme: themeRaw, out };
}

/**
 * Bundle `document-builder.ts` (+ ses 2 frères locaux `blocks.ts`/`theme.ts`)
 * en un unique fichier ESM Node autonome, via l'API programmatique de Vite
 * (mode « lib », zéro plugin du `vite.config.ts` applicatif — inutile ici,
 * aucune des 3 pages HTML/PWA n'est en jeu). Sortie dans un dossier temporaire
 * du système, jamais dans le repo.
 */
async function bundleDocumentBuilder() {
  const { build } = await import('vite');
  const outDir = mkdtempSync(path.join(tmpdir(), 'tacsuite-pdf-harness-'));
  const fileName = 'document-builder-bundle.mjs';

  await build({
    root: PROJECT_ROOT,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      target: 'node20',
      lib: {
        entry: DOCUMENT_BUILDER_ENTRY,
        formats: ['es'],
        fileName: () => fileName,
      },
    },
  });

  return path.join(outDir, fileName);
}

/** Enregistre les 3 polices pdfmake en pointant directement les TTF sources sur disque (cf. en-tête). */
function pdfFontDescriptors() {
  return {
    Oswald: {
      normal: path.join(FONTS_DIR, 'oswald_500.ttf'),
      bold: path.join(FONTS_DIR, 'oswald_500.ttf'),
    },
    JetBrainsMono: {
      normal: path.join(FONTS_DIR, 'jetbrains_mono_400.ttf'),
      bold: path.join(FONTS_DIR, 'jetbrains_mono_700.ttf'),
    },
  };
}

function defaultOutPath(fixturePath) {
  const base = path.basename(fixturePath, path.extname(fixturePath));
  const dir = mkdtempSync(path.join(tmpdir(), 'tacsuite-pdf-out-'));
  return path.join(dir, `${base}.pdf`);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!existsSync(opts.fixturePath)) {
    console.error(`Fixture introuvable : ${opts.fixturePath}`);
    process.exit(2);
  }

  let fixture;
  try {
    fixture = JSON.parse(readFileSync(opts.fixturePath, 'utf8'));
  } catch (err) {
    console.error(`JSON invalide dans ${opts.fixturePath} : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  if (!fixture || typeof fixture !== 'object' || !fixture.formData) {
    console.error(`${opts.fixturePath} doit contenir un objet avec une clé "formData" (forme OiPdfCollectedData).`);
    process.exit(2);
  }

  const isDark = opts.theme !== undefined ? opts.theme === 'dark' : Boolean(fixture.isDark);
  const outPath = opts.out ? path.resolve(opts.out) : defaultOutPath(opts.fixturePath);

  let bundlePath;
  try {
    bundlePath = await bundleDocumentBuilder();
  } catch (err) {
    console.error(`Échec du bundle de document-builder.ts (Vite) : ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  }

  const { buildOiDocDefinition } = await import(pathToFileURL(bundlePath).href);

  let docDefinition;
  try {
    docDefinition = buildOiDocDefinition(
      { formData: fixture.formData, photosBase64: fixture.photosBase64 ?? {}, isDark },
      { format: opts.format }
    );
  } catch (err) {
    console.error(`Échec de buildOiDocDefinition() : ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  }

  const pdfMakeMod = await import('pdfmake');
  const pdfMake = pdfMakeMod.default;
  pdfMake.setFonts(pdfFontDescriptors());

  // pdfmake avertit sur stderr (console.warn) en l'absence de politique
  // d'accès URL/fichier local — non pertinent pour ce harnais de test qui ne
  // charge que des polices locales connues, donc réduit au silence le temps
  // de l'appel plutôt que de laisser fuiter un avertissement à chaque run.
  const originalWarn = console.warn;
  console.warn = () => {};
  let doc;
  try {
    doc = pdfMake.createPdf(docDefinition);
    await doc.write(outPath);
  } catch (err) {
    console.error(`Échec du rendu pdfmake : ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  } finally {
    console.warn = originalWarn;
  }

  const bytes = statSync(outPath).size;
  console.log(`Fixture   : ${opts.fixturePath}`);
  console.log(`Format    : ${opts.format} — thème ${isDark ? 'sombre' : 'clair'}`);
  console.log(`PDF       : ${outPath} (${bytes} octets)`);
  console.log(`PDF_PATH=${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
