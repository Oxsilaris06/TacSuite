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
 *   node tests/visual/compare.mjs oi-light
 *   node tests/visual/compare.mjs pctac --viewport=desktop   (par défaut : les deux)
 *
 * `oi-light` (P3B.E) : mêmes 9 états que `oi`, contre les baselines mode
 * CLAIR de l'ORIGINAL (`.tacsuite-prep/oi-baseline-light/`, intégrées dans
 * `tests/visual/baseline/oi-light/`, cf. README.md « Baselines mode clair »)
 * — comble le trou de couverture Phase 0 (baselines `oi` toutes en mode
 * sombre, seul état par défaut de `4.html`). Bascule effectuée par clic
 * réel sur `#darkModeToggle` juste après le chargement (même mécanisme que
 * `.tacsuite-prep/capture-oi-light.mjs`, qui a produit ces baselines côté
 * ORIGINAL), avant d'exécuter les mêmes `run()` d'état que `oi`. Masques
 * (`HEADER_MASK`/`PORTAL_LINK_MASK`) réutilisés tels quels : la bascule de
 * thème ne change que des couleurs, aucune propriété de layout (vérifié
 * dans `oi-baseline-light/README.md`).
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

// Rectangles documentés dans README.md § « Zones à MASQUER » (bouton
// BETA/version-toggle, absent du porté par écart DOM assumé — DECISIONS-DOM-ECARTS.md).
// Coordonnées mesurées à l'état NON défilé (scrollY=0) : la plupart des états
// le sont, mais certains (ex. pctac « tab-plan-panneau-tchap-live », qui fait
// défiler la page en ouvrant le panneau Tchap live) ne le sont pas — le
// rectangle est alors translaté verticalement de `-scrollY` au moment du
// diff (cf. `captureState()` / boucle de `run()` ci-dessous), le layout
// DOM/CSS étant identique côté baseline et côté porté par protocole.
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

// P3B.E — `#portalLink` (retour au portail TacSuite, ajout pur P3B.C, cf.
// docs/DECISIONS-DOM-ECARTS.md §6) : absent des baselines OI (Phase 0,
// antérieures à cet ajout), visible dans TOUTES les captures OI car
// `#dockMenu` y est déployé par défaut (contrairement à PC-Tac, où le dock
// ship `collapsed` et où aucun état capturé ne l'ouvre — §6 documente que
// `compare.mjs pctac` n'a donc besoin d'aucun masque).
//
// Un premier essai masquant SEULEMENT le rectangle du nouvel icône (56x56 /
// 38x52) a été mesuré insuffisant : `#dockMenu` (`styles/oi.css`) est une
// barre flex centrée SANS `collapsed` sur OI — insérer un item de plus la
// recentre et TRANSLATE tous les icônes voisins d'une largeur de slot, pas
// seulement le nouveau (vérifié : 16-18 états sur 18 en FAIL à ~0.13-0.43%,
// diff concentré sur toute la largeur de la barre, pas seulement sur
// l'icône ajoutée). Le masque couvre donc désormais tout `#dockMenu`
// (bounding box mesurée en direct sur le porté, mode sombre ET clair : la
// bascule de thème ne change que des couleurs, aucune propriété de layout —
// cf. oi-baseline-light/README.md) plutôt que le seul rectangle de
// `#portalLink`. `#dockMenu` est `position:fixed` : sa position ne dépend
// PAS du scroll (pas de correctif `-scrollY` requis, contrairement à
// HEADER_MASK).
const PORTAL_LINK_MASK = {
  oi: {
    desktop: { x: 427, y: 802, w: 586, h: 74 },
    mobile: { x: 16, y: 766, w: 358, h: 62 },
  },
};
// `oi-light` réutilise les mêmes rectangles que `oi` (même bounding box
// `#dockMenu`/`#beta-button` en mode clair qu'en mode sombre, cf. commentaire
// APP_CONFIG['oi-light'] plus haut et oi-baseline-light/README.md).
HEADER_MASK['oi-light'] = HEADER_MASK.oi;
PORTAL_LINK_MASK['oi-light'] = PORTAL_LINK_MASK.oi;

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
// `oi-light` (P3B.E) : mêmes états/entryUrl que `oi`, seule la bascule de
// thème (`theme: 'light'`, lue par `captureState()`) change — voir
// commentaire en tête de fichier.
APP_CONFIG['oi-light'] = { entryUrl: APP_CONFIG.oi.entryUrl, theme: 'light', states: APP_CONFIG.oi.states };

function parseArgs(argv) {
  const app = argv[2];
  if (!app || !APP_CONFIG[app]) {
    console.error(`Usage: node tests/visual/compare.mjs <pctac|oi|oi-light> [--viewport=desktop|mobile]`);
    process.exit(2);
  }
  const viewportArg = argv.find((a) => a.startsWith('--viewport='));
  const viewports = viewportArg ? [viewportArg.split('=')[1]] : Object.keys(VIEWPORTS);
  return { app, viewports };
}

/**
 * Peint un rectangle plein (couleur unie) directement dans un buffer PNG décodé.
 *
 * Accepte DEUX formes de rectangle : `{x, y, w, h}` (HEADER_MASK, littéraux
 * ci-dessus) ET `{x, y, width, height}` (retour de Playwright `boundingBox()`,
 * utilisé pour `canvasBox`). Avant correctif, `rect.w`/`rect.h` valaient
 * `undefined` pour un `boundingBox()` → `x1`/`y1` = NaN → toute comparaison
 * `y < y1` est fausse → boucle jamais exécutée → 0 pixel peint, SANS ERREUR
 * (le masque carte était donc inerte pour tous les états `canvas:true`).
 *
 * @returns {number} nombre de pixels effectivement peints (0 si rect
 *   manquant/invalide) — permet à l'appelant de détecter un masque inerte.
 */
function paintMask(png, rect) {
  if (!rect) return 0;
  const w = rect.w ?? rect.width;
  const h = rect.h ?? rect.height;
  if (![rect.x, rect.y, w, h].every(Number.isFinite)) return 0;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + w));
  const y1 = Math.min(png.height, Math.ceil(rect.y + h));
  let painted = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = MASK_COLOR.r;
      png.data[idx + 1] = MASK_COLOR.g;
      png.data[idx + 2] = MASK_COLOR.b;
      png.data[idx + 3] = MASK_COLOR.a;
      painted++;
    }
  }
  return painted;
}

async function captureState(page, app, entryUrl, state, viewportName, theme) {
  await page.setViewportSize(VIEWPORTS[viewportName]);
  await page.goto(`${BASE_URL}${entryUrl}`, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (theme === 'light') {
    // Bascule vers le mode clair par clic réel (même mécanisme que
    // .tacsuite-prep/capture-oi-light.mjs) — l'app démarre en mode sombre
    // par défaut (aucune classe 'light-mode' au chargement initial, cf.
    // oi-baseline-light/README.md). Contrairement à capture-oi-light.mjs
    // (une seule navigation par viewport, thème basculé une fois), ce script
    // fait un `page.goto` par ÉTAT : dès le 2e état, `localStorage.theme`
    // ('light', persistée par handleThemeToggle() au 1er clic) fait déjà
    // démarrer la page en 'light-mode' — cliquer à nouveau la ferait
    // REBASCULER en sombre. D'où ce garde : ne cliquer que si pas déjà clair.
    const alreadyLight = await page.evaluate(() => document.body.classList.contains('light-mode'));
    if (!alreadyLight) {
      await page.locator('#darkModeToggle').click();
      await page.waitForFunction(() => document.body.classList.contains('light-mode'), { timeout: 5000 });
    }
    await page.waitForTimeout(300); // laisse filer la transition CSS background-color/color
  }
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

  // Relevé après state.run() : certains états (ex. ouverture du panneau
  // Tchap live) font défiler la page — le masque d'en-tête (rectangle fixe)
  // doit suivre ce décalage pour rester aligné sur la position réelle de
  // l'en-tête dans l'image capturée (cf. commentaire HEADER_MASK ci-dessus).
  const scrollY = await page.evaluate(() => window.scrollY);

  const buffer = await page.screenshot({ animations: 'disabled' });
  return { buffer, canvasBox, scrollY };
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
        const { buffer, canvasBox, scrollY } = await captureState(page, app, config.entryUrl, state, viewportName, config.theme);
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

        // Translation verticale par -scrollY : voir commentaire HEADER_MASK
        // en tête de fichier. Sans effet (scrollY=0) sur les états qui ne
        // font pas défiler la page.
        const headerRectBase = HEADER_MASK[app][viewportName];
        const headerRect = headerRectBase
          ? { ...headerRectBase, y: headerRectBase.y - scrollY }
          : headerRectBase;
        paintMask(basePng, headerRect);
        paintMask(actualPng, headerRect);

        // `#dockMenu` étant `position:fixed`, aucune translation -scrollY
        // (contrairement à headerRect ci-dessus) — voir commentaire
        // PORTAL_LINK_MASK en tête de fichier.
        const portalLinkRect = PORTAL_LINK_MASK[app]?.[viewportName];
        paintMask(basePng, portalLinkRect);
        paintMask(actualPng, portalLinkRect);

        if (state.canvas) {
          if (canvasBox) {
            const paintedBase = paintMask(basePng, canvasBox);
            const paintedActual = paintMask(actualPng, canvasBox);
            // Garde-fou : un état canvas:true DOIT masquer au moins 1 pixel
            // des deux côtés. 0 pixel peint = masque inerte (bug de forme du
            // rectangle, cf. commentaire paintMask() ci-dessus) — on sort en
            // ERROR explicite plutôt que de laisser passer un PASS/FAIL
            // trompeur (diff carte non déterministe compté comme un vrai diff,
            // ou pire, un FAIL fantôme masquant en fait un masque cassé).
            if (paintedBase === 0 || paintedActual === 0) {
              results.push({
                label,
                status: 'ERROR',
                detail: `masque carte inerte (0 pixel peint, base=${paintedBase} actual=${paintedActual}) pour un état canvas:true — canvasBox=${JSON.stringify(canvasBox)}`,
              });
              continue;
            }
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
