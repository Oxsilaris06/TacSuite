#!/usr/bin/env node
/**
 * tests/visual/compare.mjs — outil de comparaison visuelle réutilisable
 * (P2.F pour PC-Tac, P3.D pour l'OI).
 *
 * Capture les états de `<app>` (« pctac » ou « oi ») sur le TacSuite en cours
 * de dev (http://127.0.0.1:9678), applique aux DEUX images (la baseline figée
 * de l'ORIGINAL sur disque ET la capture fraîche du porté) les mêmes masques
 * documentés dans `tests/visual/README.md` § « Zones à MASQUER », puis compare
 * pixel à pixel (pixelmatch). Seuil : 0,1 % de pixels différents (rapporté au
 * total de l'image — les zones masquées sont peintes de la même couleur unie
 * des deux côtés, donc structurellement non-différentes, ce qui revient bien
 * à un seuil « hors zones masquées »).
 *
 * Usage :
 *   node tests/visual/compare.mjs pctac
 *   node tests/visual/compare.mjs oi
 *   node tests/visual/compare.mjs pctac --viewport=desktop   (par défaut : les deux)
 *
 * Prérequis : le serveur TacSuite dev tourne sur 127.0.0.1:9678
 * (scripts/dev.sh) ET les baselines existent dans tests/visual/baseline/<app>/.
 *
 * Sortie : tableau état → % de diff → verdict sur stdout, PNG de diff (+ PNG
 * de la capture brute pour debug) dans tests/visual/diffs/<app>/. Code de
 * sortie non nul si au moins un état dépasse le seuil ou est en erreur.
 */

import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://127.0.0.1:9678';
const BASELINE_DIR = join(__dirname, 'baseline');
const DIFF_DIR = join(__dirname, 'diffs');
const THRESHOLD_PCT = 0.1;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// Rectangles fixes documentés dans README.md § « Zones à MASQUER » (bouton
// BETA/version-toggle, absent du porté par écart DOM assumé — DECISIONS-DOM-ECARTS.md).
const HEADER_MASK = {
  pctac: {
    desktop: { x: 1144, y: 45, w: 61, h: 36 },
    mobile: { x: 324, y: 30, w: 46, h: 28 },
  },
  oi: {
    desktop: { x: 1066, y: 66, w: 68, h: 46 },
    mobile: { x: 332, y: 24, w: 40, h: 26 },
  },
};

// Sélecteur du canvas cartographique à masquer (tuiles réseau non déterministes) —
// mesuré EN DIRECT sur la page vivante (le porté), puis réutilisé tel quel sur
// la baseline (layout DOM/CSS identique par protocole zéro régression §1/§3).
const CANVAS_SELECTOR = 'canvas.maplibregl-canvas';

const MASK_COLOR = { r: 255, g: 0, b: 255, a: 255 }; // magenta — bien visible dans les diffs debug

/** Séquence d'interaction menant à chaque état, cf. tests/visual/README.md. */
const APP_CONFIG = {
  pctac: {
    entryUrl: '/pctac/',
    states: [
      { id: 'initial-main-courante', canvas: false, run: async () => {} },
      { id: 'tab-adversaires', canvas: false, run: async (page) => page.locator('.tab-btn[data-view="view-adversaires"]').click() },
      { id: 'tab-otages', canvas: false, run: async (page) => page.locator('.tab-btn[data-view="view-otages"]').click() },
      { id: 'tab-amis', canvas: false, run: async (page) => page.locator('.tab-btn[data-view="view-amis"]').click() },
      { id: 'tab-photos', canvas: false, run: async (page) => page.locator('.tab-btn[data-view="view-photos"]').click() },
      { id: 'tab-plan', canvas: true, run: async (page) => page.locator('.tab-btn[data-view="view-plan"]').click() },
      { id: 'tab-liens', canvas: false, run: async (page) => page.locator('.tab-btn[data-view="view-liens"]').click() },
      {
        id: 'tab-plan-panneau-recherche',
        canvas: true,
        run: async (page) => {
          await page.locator('.tab-btn[data-view="view-plan"]').click();
          await page.waitForTimeout(300);
          await page.locator('#plan_btn_search').click();
        },
      },
      {
        id: 'tab-plan-dock-dessin',
        canvas: true,
        run: async (page) => {
          await page.locator('.tab-btn[data-view="view-plan"]').click();
          await page.waitForTimeout(300);
          await page.locator('#plan_btn_draw').click();
        },
      },
      {
        id: 'tab-plan-panneau-tchap-live',
        canvas: true,
        run: async (page) => {
          await page.locator('.tab-btn[data-view="view-plan"]').click();
          await page.waitForTimeout(300);
          await page.locator('#tl_toggle').click();
        },
      },
    ],
  },
  oi: {
    entryUrl: '/oi/',
    states: [
      { id: 'step0-situation', canvas: false, run: async () => {} },
      { id: 'step1-adversaires', canvas: false, run: async (page) => page.locator('.wizard-progress-step').nth(1).click() },
      { id: 'step2-environnement', canvas: false, run: async (page) => page.locator('.wizard-progress-step').nth(2).click() },
      { id: 'step3-mission', canvas: false, run: async (page) => page.locator('.wizard-progress-step').nth(3).click() },
      { id: 'step4-execution', canvas: false, run: async (page) => page.locator('.wizard-progress-step').nth(4).click() },
      { id: 'step5-articulation-moicp-zmspcp', canvas: false, run: async (page) => page.locator('.wizard-progress-step').nth(5).click() },
      { id: 'step6-patracdvr', canvas: false, run: async (page) => page.locator('.wizard-progress-step').nth(6).click() },
      { id: 'step7-finalisation', canvas: false, run: async (page) => page.locator('.wizard-progress-step').nth(7).click() },
      {
        id: 'cartography-modal',
        canvas: true,
        run: async (page) => {
          page.once('dialog', (d) => void d.dismiss().catch(() => {}));
          await page.locator('#cartographyBtn').click();
          await page.waitForTimeout(500);
        },
      },
    ],
  },
};

function parseArgs(argv) {
  const app = argv[2];
  if (!app || !APP_CONFIG[app]) {
    console.error(`Usage: node tests/visual/compare.mjs <pctac|oi> [--viewport=desktop|mobile]`);
    process.exit(2);
  }
  const viewportArg = argv.find((a) => a.startsWith('--viewport='));
  const viewports = viewportArg ? [viewportArg.split('=')[1]] : Object.keys(VIEWPORTS);
  return { app, viewports };
}

/** Peint un rectangle plein (couleur unie) directement dans un buffer PNG décodé. */
function paintMask(png, rect) {
  if (!rect) return;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(png.height, Math.ceil(rect.y + rect.h));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = MASK_COLOR.r;
      png.data[idx + 1] = MASK_COLOR.g;
      png.data[idx + 2] = MASK_COLOR.b;
      png.data[idx + 3] = MASK_COLOR.a;
    }
  }
}

async function captureState(page, app, entryUrl, state, viewportName) {
  await page.setViewportSize(VIEWPORTS[viewportName]);
  await page.goto(`${BASE_URL}${entryUrl}`, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(state.id.startsWith('initial') || state.id.startsWith('step0') ? 1200 : 300);
  await state.run(page);
  await page.waitForTimeout(300);
  if (state.canvas) {
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  let canvasBox = null;
  if (state.canvas) {
    canvasBox = await page
      .locator(CANVAS_SELECTOR)
      .boundingBox()
      .catch(() => null);
  }

  const buffer = await page.screenshot({ animations: 'disabled' });
  return { buffer, canvasBox };
}

function loadBaselinePng(app, state, viewportName) {
  const file = join(BASELINE_DIR, app, `${state.id}-${viewportName}.png`);
  if (!existsSync(file)) return { error: `baseline manquante : ${file}` };
  return { png: PNG.sync.read(readFileSync(file)) };
}

async function run() {
  const { app, viewports } = parseArgs(process.argv);
  const config = APP_CONFIG[app];
  const outDir = join(DIFF_DIR, app);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const results = [];

  for (const viewportName of viewports) {
    const context = await browser.newContext({ viewport: VIEWPORTS[viewportName] });
    const page = await context.newPage();
    // Sans cette borne, une action (click) sur un element rendu inactionnable
    // par l'absence de cablage JS (P2.D non execute cote pctac au moment de
    // ce run, cf. docs/CHECKLIST-PCTAC.md) attend le defaut librairie (30s)
    // par etat/viewport avant d'echouer - on borne a 3s pour rester rapide.
    page.setDefaultTimeout(3000);

    for (const state of config.states) {
      const label = `${state.id}-${viewportName}`;
      try {
        const { buffer, canvasBox } = await captureState(page, app, config.entryUrl, state, viewportName);
        const actualPng = PNG.sync.read(buffer);
        writeFileSync(join(outDir, `${label}.actual.png`), buffer);

        const { png: basePng, error } = loadBaselinePng(app, state, viewportName);
        if (error) {
          results.push({ label, status: 'ERROR', detail: error });
          continue;
        }

        if (basePng.width !== actualPng.width || basePng.height !== actualPng.height) {
          results.push({
            label,
            status: 'ERROR',
            detail: `dimensions differentes : baseline ${basePng.width}x${basePng.height} vs capture ${actualPng.width}x${actualPng.height}`,
          });
          continue;
        }

        const headerRect = HEADER_MASK[app][viewportName];
        paintMask(basePng, headerRect);
        paintMask(actualPng, headerRect);

        if (state.canvas) {
          if (canvasBox) {
            paintMask(basePng, canvasBox);
            paintMask(actualPng, canvasBox);
          } else {
            results.push({
              label,
              status: 'WARN',
              detail: `${CANVAS_SELECTOR} introuvable/invisible sur le porte (carte non initialisee) — masque carte NON applique, diff carte comptabilise tel quel`,
            });
          }
        }

        const { width, height } = basePng;
        const diffPng = new PNG({ width, height });
        const diffPixels = pixelmatch(basePng.data, actualPng.data, diffPng.data, width, height, {
          threshold: 0.1,
        });
        const totalPixels = width * height;
        const diffPct = (diffPixels / totalPixels) * 100;
        const verdict = diffPct <= THRESHOLD_PCT ? 'PASS' : 'FAIL';

        writeFileSync(join(outDir, `${label}.diff.png`), PNG.sync.write(diffPng));

        results.push({ label, status: verdict, diffPixels, totalPixels, diffPct });
      } catch (err) {
        results.push({ label, status: 'ERROR', detail: String(err && err.stack ? err.stack : err) });
      }
    }

    await context.close();
  }

  await browser.close();

  console.log('');
  console.log(`Comparaison visuelle — app=${app} (seuil ${THRESHOLD_PCT}% hors masques)`);
  console.log('='.repeat(96));
  console.log(
    `${'État'.padEnd(42)} ${'Diff px'.padStart(10)} ${'Total px'.padStart(11)} ${'% diff'.padStart(9)}  Verdict`
  );
  console.log('-'.repeat(96));
  let anyFail = false;
  for (const r of results) {
    if (r.status === 'PASS' || r.status === 'FAIL') {
      console.log(
        `${r.label.padEnd(42)} ${String(r.diffPixels).padStart(10)} ${String(r.totalPixels).padStart(11)} ${r.diffPct
          .toFixed(3)
          .padStart(8)}%  ${r.status}`
      );
      if (r.status === 'FAIL') anyFail = true;
    } else {
      console.log(`${r.label.padEnd(42)} ${r.status.padEnd(10)} ${r.detail}`);
      if (r.status === 'ERROR') anyFail = true;
    }
  }
  console.log('='.repeat(96));
  console.log(`PNG de diff/capture ecrits dans : ${outDir}`);
  console.log('');

  process.exit(anyFail ? 1 : 0);
}

run();
