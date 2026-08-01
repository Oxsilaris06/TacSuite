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
// P3B.FIX (reprise 1), BLOQUANT R3 : garde-fou symétrique au garde-fou
// « masque inerte » existant (0 pixel peint) — cf. commentaire au point
// d'usage (boucle de `run()`) pour la justification complète du seuil.
// P3B.FIX (reprise 3), BLOQUANT R1 : relevé de 99 à 99.5 — cf. commentaire au
// point d'usage (le passage au carré inscrit fait mécaniquement remonter le
// masqué desktop à ~99,23%, au-dessus de l'ancien seuil).
const MAX_CANVAS_MASK_PCT = 99.5;
// P3B.FIX (reprise 3), BLOQUANT R1 : timeout de `waitForMapIdle` (cf.
// `captureState()`), relevé de 5000 à 15000ms et rendu NON silencieux —
// cf. commentaire au point d'usage pour la justification complète.
const MAP_IDLE_TIMEOUT_MS = 15000;

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
        // P3B.FIX (reprise 1), BLOQUANT R3 : `#cartographyModal` est un
        // `<dialog>` `width:100vw; height:100vh` (4.html:3613-3620, verbatim)
        // — `canvas.maplibregl-canvas` y occupe donc LITTÉRALEMENT 100% du
        // viewport desktop (mesuré : boundingBox {0,0,1440,900} =
        // 1 296 000/1 296 000 px), sans aucune autre zone de chrome PAGE en
        // dehors de la carte (contrairement aux 4 états canvas de PC-Tac,
        // où la carte est intégrée dans la mise en page et laisse du chrome
        // visible autour). La seule zone de chrome réelle est
        // `.oi-carto-toolbar` (barre de FABs verticale), qui flotte
        // PAR-DESSUS le canvas (position:absolute, z-index:12) — le canvas
        // continue structurellement de s'étendre EN DESSOUS d'elle (mesuré :
        // boundingBox du canvas identique avec ou sans la barre). Sans
        // exclusion explicite, masquer tout `canvasBox` masque donc aussi la
        // barre, qui est pourtant un élément DOM déterministe et
        // authentiquement comparable — d'où `unmaskSelector` : ci-dessous,
        // `run()` troue le masque canvas à l'emplacement mesuré EN DIRECT de
        // ce sélecteur (mêmes garanties verbatim que `CANVAS_SELECTOR`),
        // pour lui redonner un statut d'assertion réelle plutôt que de la
        // noyer dans un masque inerte.
        //
        // P3B.FIX (reprise 2), BLOQUANT R3bis : la reprise 1 démasquait le
        // rectangle ENGLOBANT de `.oi-carto-toolbar` (50×456) — or c'est une
        // COLONNE DE FABS CIRCULAIRES (`.oi-carto-fab`, ⌀50px) séparées par
        // des interstices TRANSPARENTS : le canvas MapLibre reste visible à
        // travers ces interstices, réintroduisant exactement le
        // non-déterminisme que le masque canvas existe pour supprimer
        // (mesuré sur 8 exécutions du dépôt : 6 PASS à 332px quand les
        // tuiles sont déjà chargées au moment de la capture, 2 FAIL à
        // 8036px = bbox ENTIÈRE de la toolbar quand elles ne le sont pas
        // encore). Correctif à deux volets :
        //   1. `unmaskSelector` cible désormais CHAQUE bouton individuellement
        //      (`.oi-carto-fab`, 8 éléments) plutôt que le conteneur — les
        //      interstices retombent dans le masque canvas (magenta, non
        //      comparés), seuls les 8 disques de 50×50 restent des pixels
        //      réellement comparés (cf. `paintMask()`, tableau d'exclusions).
        //   2. `waitForMapIdle` (cf. `captureState()`) élimine le résidu de
        //      non-déterminisme qui subsisterait dans les coins non
        //      circulaires de chaque rectangle 50×50 (le cercle n'occupe que
        //      ~78,5% de son bounding box) si les tuiles n'étaient pas
        //      garanties chargées avant la capture — vérifié : 5 captures
        //      consécutives avec cette attente produisent un crop toolbar
        //      strictement identique au pixel près (md5 identique).
        //
        // P3B.FIX (reprise 3), BLOQUANT R1 : la reprise 2 a laissé subsister
        // les DEUX moitiés du correctif décrites ci-dessus dans un état
        // incomplet, mesuré en direct sur 15 exécutions (1 FAIL à 5025px/
        // 0,388%, seuil 0,1% — les 14 autres à 220px/0,017%) :
        //   1. Le point 1 démasque le rectangle ENGLOBANT (50×50) de chaque
        //      `.oi-carto-fab`, pas le disque lui-même — les 4 coins NON
        //      circulaires de chaque carré (1 − π/4 ≈ 21,5% de sa surface)
        //      laissent le canvas MapLibre transparaître et être comparé,
        //      alors que le commentaire ci-dessus les attribue à tort au
        //      seul point 2 (`waitForMapIdle`). Sur 8 boutons × 2500px² :
        //      21,5% ≈ 4300px, cohérent avec l'écart mesuré (5025−220=4805px).
        //      Correctif : `unmaskBoxes` (cf. `captureState()`) réduit
        //      maintenant chaque rectangle 50×50 au CARRÉ INSCRIT dans le
        //      disque (inset ≈7,3px par bord, ≈35×35 centré) avant de le
        //      passer à `paintMask()` — tous les pixels démasqués sont alors
        //      garantis opaques (bouton), plus aucun pixel de canvas ne
        //      transparaît dans la zone comparée, quel que soit l'état des
        //      tuiles au moment de la capture.
        //   2. `waitForMapIdle` n'est qu'une RÉDUCTION DE FRÉQUENCE, pas une
        //      élimination : son timeout de 5s se résout silencieusement en
        //      `.catch(() => {})` (cf. `captureState()`) dès que les tuiles
        //      mettent plus de 5s à charger, dégradant SANS AUCUNE TRACE vers
        //      l'ancien comportement (capture quel que soit l'état réel de la
        //      carte) — exactement la fenêtre dans laquelle le FAIL mesuré
        //      s'est produit. Porté à `MAP_IDLE_TIMEOUT_MS` (15s) ET rendu
        //      NON silencieux : un dépassement produit désormais un résultat
        //      `ERROR` explicite pour cet état (cf. boucle `run()`) plutôt
        //      qu'une capture dégradée comptée comme un PASS/FAIL trompeur.
        unmaskSelector: '.oi-carto-toolbar .oi-carto-fab',
        waitForMapIdle: true,
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
 * @param {{x:number,y:number,w?:number,h?:number,width?:number,height?:number}|null} rect
 * @param {Array<{x:number,y:number,w?:number,h?:number,width?:number,height?:number}>} [excludeRects]
 *   P3B.FIX (reprise 2), BLOQUANT R3bis : trous rectangulaires optionnels dans
 *   le masque — les pixels dans N'IMPORTE LEQUEL des rects de ce tableau ne
 *   sont PAS peints (donc restent comparables). Un rect PAR ÉLÉMENT (pas un
 *   seul rect englobant l'ensemble) : utilisé pour `unmaskSelector` (cf. état
 *   `cartography-modal`, APP_CONFIG.oi) afin de ne redonner un statut
 *   d'assertion réelle qu'aux pixels des éléments de chrome eux-mêmes, jamais
 *   aux interstices entre eux (cf. commentaire `unmaskSelector` pour la
 *   justification complète — reprise 1 utilisait un seul rect englobant,
 *   `excludeRect` singulier, remplacé ici par ce tableau).
 * @returns {number} nombre de pixels effectivement peints (0 si rect
 *   manquant/invalide) — permet à l'appelant de détecter un masque inerte.
 */
function paintMask(png, rect, excludeRects) {
  if (!rect) return 0;
  const w = rect.w ?? rect.width;
  const h = rect.h ?? rect.height;
  if (![rect.x, rect.y, w, h].every(Number.isFinite)) return 0;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + w));
  const y1 = Math.min(png.height, Math.ceil(rect.y + h));
  const excludes = (excludeRects || [])
    .map((r) => {
      const ew = r?.w ?? r?.width;
      const eh = r?.h ?? r?.height;
      if (![r?.x, r?.y, ew, eh].every(Number.isFinite)) return null;
      return { x0: r.x, y0: r.y, x1: r.x + ew, y1: r.y + eh };
    })
    .filter(Boolean);
  let painted = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (excludes.some((e) => x >= e.x0 && x < e.x1 && y >= e.y0 && y < e.y1)) continue;
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

/**
 * P3B.FIX (reprise 3), BLOQUANT R1 : réduit un rectangle `{x, y, width,
 * height}` (boundingBox() d'un `.oi-carto-fab`, disque CSS ⌀ = min(w,h)) au
 * CARRÉ INSCRIT dans ce disque — cf. commentaire `unmaskSelector` (état
 * `cartography-modal`, APP_CONFIG.oi) pour la justification complète. Un
 * carré inscrit dans un cercle de diamètre `d` a pour côté `d/√2` ; l'inset
 * par bord est donc `(d − d/√2) / 2`. Tous les pixels du rectangle retourné
 * sont garantis à l'intérieur du disque (donc opaques, bouton réel) — aucun
 * pixel de canvas ne peut plus transparaître à travers un coin non circulaire.
 *
 * @param {{x:number,y:number,width:number,height:number}|null} box
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
function inscribedSquare(box) {
  if (!box) return null;
  const d = Math.min(box.width, box.height);
  const side = d * Math.SQRT1_2; // d/√2
  const inset = (d - side) / 2;
  return {
    x: box.x + (box.width - d) / 2 + inset,
    y: box.y + (box.height - d) / 2 + inset,
    width: side,
    height: side,
  };
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
      await page.waitForFunction(() => document.body.classList.contains('light-mode'), undefined, { timeout: 5000 });
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

  // P3B.FIX (reprise 2), BLOQUANT R3bis : `networkidle` ci-dessus porte sur
  // les requêtes RÉSEAU du document — il se résout dès que les octets des
  // tuiles ont fini d'arriver, PAS quand MapLibre a fini de les décoder et
  // peindre sur le canvas. `waitForMapIdle` attend en plus l'état interne
  // « idle » réel de la carte OI (aucun rendu ni tuile en attente — API
  // publique `Map#loaded()` + `Map#areTilesLoaded()`, maplibre-gl.d.ts), pour
  // que le fond de carte visible à travers `unmaskSelector` (cf. état
  // `cartography-modal`, APP_CONFIG.oi) soit déterministe des deux côtés de
  // la comparaison plutôt qu'un alternat tuiles-chargées / noir-uni selon le
  // timing du run. `window.OICarto` est absent hors de la page OI/hors de cet
  // état (`state.waitForMapIdle` n'est posé que sur `cartography-modal`) ;
  // filet de sécurité 5s (`.catch`) si la carte n'atteint jamais cet état
  // (ex. réseau tuiles indisponible) — dégrade alors vers le comportement
  // précédent (attente fixe) plutôt que de bloquer le test.
  //
  // P3B.FIX (reprise 3), BLOQUANT R1 : ce `.catch(() => {})` était SILENCIEUX
  // — un dépassement de timeout dégradait vers une capture quand même prise,
  // sans aucune trace, indiscernable d'un run où la carte a réellement atteint
  // l'idle. C'est cette dégradation silencieuse (déclenchée dès que les
  // tuiles dépassent 5s) qui a laissé passer la capture non déterministe à
  // l'origine du FAIL 5025px/0,388% mesuré sur 1 run/15. Timeout porté à
  // `MAP_IDLE_TIMEOUT_MS` (15s, contre 5s) ET dégradation remplacée par un
  // flag (`mapIdleTimedOut`) que l'appelant (`run()`) traduit en résultat
  // `ERROR` explicite pour cet état plutôt que de capturer quand même.
  // P3B.FIX (reprise 3), BLOQUANT R1 : `waitForFunction(pageFunction, arg,
  // options)` — l'`arg` (2e paramètre positionnel) est OBLIGATOIRE pour que
  // Playwright résolve le 3e comme `options` ; l'omettre (forme à 2 arguments
  // `waitForFunction(fn, { timeout })`) fait passer l'objet `{ timeout }`
  // comme `arg` et NON comme `options`, silencieusement — Playwright retombe
  // alors sur le timeout par défaut de la page (`page.setDefaultTimeout(3000)`
  // posé plus haut dans `run()`, cf. plus bas), pas sur `MAP_IDLE_TIMEOUT_MS`
  // (15s). Confirmé par un test isolé (`chromium.launch()` + les deux formes
  // d'appel) : forme à 2 arguments → time out à 30000ms (défaut Playwright
  // sans page.setDefaultTimeout) au lieu du `{timeout}` fourni ; forme à 3
  // arguments (`arg` explicite `undefined`) → time out bien à la valeur
  // demandée. `undefined` ci-dessous est cet `arg` explicite.
  let mapIdleTimedOut = false;
  if (state.waitForMapIdle) {
    await page
      .waitForFunction(
        () => {
          const map = window.OICarto && window.OICarto.map;
          if (!map) return true;
          try {
            return map.loaded() && map.areTilesLoaded();
          } catch {
            return true;
          }
        },
        undefined,
        { timeout: MAP_IDLE_TIMEOUT_MS }
      )
      .catch(() => {
        mapIdleTimedOut = true;
      });
  }

  let canvasBox = null;
  if (state.canvas) {
    canvasBox = await page
      .locator(CANVAS_SELECTOR)
      .boundingBox()
      .catch(() => null);
  }

  // P3B.FIX (reprise 1/2), BLOQUANT R3/R3bis : cf. commentaire `unmaskSelector`
  // sur l'état `cartography-modal` (APP_CONFIG.oi) — relevé EN DIRECT, mêmes
  // garanties que `canvasBox` ci-dessus (jamais de coordonnées codées en dur
  // pour un élément qui flotte par-dessus une carte). Reprise 2 : UN rect PAR
  // élément matché (ex. les 8 `.oi-carto-fab`), pas un seul rect englobant —
  // cf. commentaire `paintMask()` pour la justification.
  //
  // P3B.FIX (reprise 3), BLOQUANT R1 : chaque boundingBox() (rectangle
  // ENGLOBANT 50×50 d'un disque) est réduite via `inscribedSquare()` au carré
  // INSCRIT dans le disque (≈35×35 centré) — cf. commentaire `inscribedSquare`
  // et commentaire `unmaskSelector` (état `cartography-modal`) pour la
  // justification complète (les 4 coins non circulaires du rectangle
  // englobant laissaient transparaître et comparer des pixels de canvas).
  let unmaskBoxes = [];
  if (state.unmaskSelector) {
    unmaskBoxes = await page
      .locator(state.unmaskSelector)
      .all()
      .then((locators) => Promise.all(locators.map((l) => l.boundingBox().catch(() => null))))
      .then((boxes) => boxes.filter(Boolean).map(inscribedSquare))
      .catch(() => []);
  }

  // Relevé après state.run() : certains états (ex. ouverture du panneau
  // Tchap live) font défiler la page — le masque d'en-tête (rectangle fixe)
  // doit suivre ce décalage pour rester aligné sur la position réelle de
  // l'en-tête dans l'image capturée (cf. commentaire HEADER_MASK ci-dessus).
  const scrollY = await page.evaluate(() => window.scrollY);

  const buffer = await page.screenshot({ animations: 'disabled' });
  return { buffer, canvasBox, unmaskBoxes, scrollY, mapIdleTimedOut };
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
        const { buffer, canvasBox, unmaskBoxes, scrollY, mapIdleTimedOut } = await captureState(page, app, config.entryUrl, state, viewportName, config.theme);
        const actualPng = PNG.sync.read(buffer);
        writeFileSync(join(outDir, `${label}.actual.png`), buffer);

        // P3B.FIX (reprise 3), BLOQUANT R1 : cf. commentaire `waitForMapIdle`
        // dans `captureState()` — un dépassement du timeout d'idle carte
        // produit désormais un ERROR explicite (capture abandonnée pour cet
        // état) plutôt qu'une dégradation silencieuse vers l'ancien
        // comportement (capture quand même, verdict PASS/FAIL non fiable).
        if (mapIdleTimedOut) {
          results.push({
            label,
            status: 'ERROR',
            detail: `waitForMapIdle : timeout ${MAP_IDLE_TIMEOUT_MS}ms sans que window.OICarto.map atteigne l'état idle (loaded()+areTilesLoaded()) — capture abandonnée plutôt que dégradée silencieusement`,
          });
          continue;
        }

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
            // P3B.FIX (reprise 1/2), BLOQUANT R3/R3bis : `unmaskBoxes` (cf.
            // `unmaskSelector` sur l'état, et commentaire `paintMask()`) troue
            // le masque à l'emplacement des éléments de chrome déterministes
            // qui flottent par-dessus le canvas (ex. chaque `.oi-carto-fab`
            // sur `cartography-modal`) — tableau vide pour tous les autres
            // états, comportement strictement inchangé (masque plein comme
            // avant).
            const paintedBase = paintMask(basePng, canvasBox, unmaskBoxes);
            const paintedActual = paintMask(actualPng, canvasBox, unmaskBoxes);
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
            // P3B.FIX (reprise 1), BLOQUANT R3 — garde-fou SYMÉTRIQUE au
            // précédent : celui-ci détecte un masque INERTE (0 pixel peint,
            // 0% du viewport), qui produit un ERROR explicite. Mais un masque
            // TOTAL (~100% du viewport peint) est le défaut inverse et
            // silencieux : `basePng`/`actualPng` deviennent alors deux images
            // uniformément magenta, `pixelmatch` les trouve donc identiques
            // (0 pixel de diff) et le verdict est un PASS 0.000% qui n'a
            // rien vérifié (cf. mission — mesuré sur `cartography-modal`
            // desktop, `canvasBox` = {0,0,1440,900} = 100% du viewport, AVANT
            // `unmaskBoxes` ci-dessus). Seuil retenu à l'origine 99% (pas 95%
            // comme dans la première formulation de ce correctif) : les zones
            // de chrome déterministes existant réellement au-dessus d'un
            // `<dialog>` `100vw`/`100vh` verbatim (cf. commentaire
            // `unmaskSelector`) ne couvraient, à la reprise 2 (un rect
            // ENGLOBANT par bouton, 8 × 50×50 = 20 000px), que ~1,54% du
            // viewport desktop (20 000 / 1 296 000) — d'où un seuil à 99%,
            // entre les ~98,46% mesurés et 100%.
            //
            // P3B.FIX (reprise 3), BLOQUANT R1 : `unmaskBoxes` couvre
            // désormais le CARRÉ INSCRIT dans chaque disque (cf.
            // `inscribedSquare()`), pas le rectangle englobant — surface par
            // bouton divisée par 2 (côté 50/√2 ≈ 35,36 → 1250px² au lieu de
            // 2500px²). La zone réellement démasquée retombe donc à ~0,77%
            // du viewport desktop (8 × 1250 / 1 296 000 ≈ 0,7716%, mesuré :
            // 99,228% masqué), au-dessus de l'ancien seuil 99% — un état
            // légitime aurait donc été rejeté à tort. Seuil relevé à 99,5% :
            // reste largement en-deçà de 100% (donc continue de bloquer le
            // cas masque total ~100% d'origine, avec ~0,5 point de marge
            // sous ce plafond), tout en laissant passer les ~99,23% mesurés
            // avec le carré inscrit (marge ~0,27 point, largement au-dessus
            // du bruit de mesure d'un boundingBox() sub-pixel).
            const totalPixels = basePng.width * basePng.height;
            const maskedPct = (Math.max(paintedBase, paintedActual) / totalPixels) * 100;
            if (maskedPct >= MAX_CANVAS_MASK_PCT) {
              results.push({
                label,
                status: 'ERROR',
                detail: `masque carte quasi-total (${maskedPct.toFixed(2)}% du viewport masqué, seuil ${MAX_CANVAS_MASK_PCT}%) pour un état canvas:true — le verdict PASS/FAIL n'assert quasiment rien pour cet état — canvasBox=${JSON.stringify(canvasBox)} unmaskBoxes=${JSON.stringify(unmaskBoxes)}`,
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
