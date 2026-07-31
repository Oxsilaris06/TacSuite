import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P0.A4 — Baselines visuelles de l'ORIGINAL (GStart-main servi sur 127.0.0.1:9679).
 *
 * But : capturer l'etat visuel de reference AVANT toute conversion TypeScript,
 * pour pouvoir diffuser ensuite le TacSuite porte contre ces PNG (seuil <= 0.1%
 * de pixels hors zones masquees, cf. PLAN-TACSUITE.md section 4).
 *
 * Sources de verite pour les selecteurs/checklists :
 *   - docs/recon-oi.md    (section 3 "DOM principal" + section 9 "Checklist")
 *   - docs/recon-pctac.md (section 1 "Structure DOM" + section 6 "Checklist")
 *
 * Zones a MASQUER dans les comparaisons FUTURES (documentees aussi dans README.md) :
 *   - PC-Tac  : canvas.maplibregl-canvas dans #plan_map (tuiles reseau non deterministes)
 *   - OI      : canvas.maplibregl-canvas dans #oi_carto_map (idem, cartographie modale)
 * Ces baselines elles-memes NE masquent RIEN (premiere capture de reference,
 * les tuiles telles que chargees au moment du run font partie du PNG).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORIGINAL_BASE = 'http://127.0.0.1:9679';
const BASELINE_DIR = join(__dirname, 'baseline');

function viewportLabel(projectName: string): string {
  return projectName.includes('mobile') ? 'mobile' : 'desktop';
}

/** Capture un PNG et le range dans baseline/<app>/<etat>-<viewport>.png. */
async function capture(page: Page, testInfo: TestInfo, app: string, state: string): Promise<string> {
  const dir = join(BASELINE_DIR, app);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${state}-${viewportLabel(testInfo.project.name)}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  return file;
}

/**
 * Attend un reseau "calme" (tuiles cartographiques MapLibre/Nominatim en vol)
 * SANS jamais faire echouer le test si l'inactivite totale n'est pas atteinte
 * (le long-poll Tchap ou des requetes de tuiles en continu peuvent empecher
 * 'networkidle' de se resoudre) — on degrade alors en simple delai fixe.
 */
async function settleMap(page: Page, timeoutMs = 15000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(1200);
}

test.describe('Baseline ORIGINAL — Generateur OI (4.html)', () => {
  test('vue initiale + 8 etapes du wizard + cartographie', async ({ page }, testInfo) => {
    // Native alert() de secours si MapLibre echoue a charger (cf. oi_cartographie.js
    // open() : "Librairie cartographique indisponible (reseau ?)") — on l'intercepte
    // pour ne jamais bloquer le test, et on la journalise dans le compte-rendu.
    const nativeDialogs: string[] = [];
    page.on('dialog', (d) => {
      nativeDialogs.push(d.message());
      void d.dismiss().catch(() => {});
    });

    await page.goto(`${ORIGINAL_BASE}/4.html`, { waitUntil: 'load' });
    await settleMap(page, 8000);
    // Etape 1/8 — Situation (etat initial, .wizard-progress-step index 0)
    await capture(page, testInfo, 'oi', 'step0-situation');

    const steps: Array<{ index: number; state: string }> = [
      { index: 1, state: 'step1-adversaires' },
      { index: 2, state: 'step2-environnement' },
      { index: 3, state: 'step3-mission' },
      { index: 4, state: 'step4-execution' },
      { index: 5, state: 'step5-articulation-moicp-zmspcp' },
      { index: 6, state: 'step6-patracdvr' },
      { index: 7, state: 'step7-finalisation' },
    ];

    for (const { index, state } of steps) {
      // Puces cliquables de la barre de progression (goToStep(n), navigation.js) —
      // sauts directs autorises sans validation bloquante (cf. recon-oi.md §9).
      await page.locator('.wizard-progress-step').nth(index).click();
      await expect(page.locator('.wizard-step').nth(index)).toHaveClass(/active/);
      await page.waitForTimeout(300);
      await capture(page, testInfo, 'oi', state);
    }

    // Cartographie OI (modale native <dialog>#cartographyModal, init paresseuse
    // MapLibre au 1er open() — cf. modules/oi_cartographie.js:292-309).
    await page.locator('#cartographyBtn').click();
    await page
      .locator('#cartographyModal')
      .evaluate((el) => (el as HTMLDialogElement).open, undefined)
      .catch(() => {});
    await page.waitForTimeout(500);
    await settleMap(page, 15000);
    await capture(page, testInfo, 'oi', 'cartography-modal');

    if (nativeDialogs.length > 0) {
      console.warn(
        `[baseline][oi] dialog(s) natif(s) intercepte(s) (etat potentiellement degrade) : ${JSON.stringify(nativeDialogs)}`
      );
    }
  });
});

test.describe('Baseline ORIGINAL — PC-Tac (pctac2.html)', () => {
  test('vue initiale + 7 onglets + panneaux du Plan', async ({ page }, testInfo) => {
    await page.goto(`${ORIGINAL_BASE}/pctac2.html`, { waitUntil: 'load' });
    // La carte MapLibre s'initialise des le chargement (main.js), meme si
    // l'onglet actif au demarrage est "Main Courante" (pas "Plan") — delai
    // genereux ici aussi car les requetes (fonts, tuiles pre-chargees) sont en vol.
    await settleMap(page, 15000);
    await capture(page, testInfo, 'pctac', 'initial-main-courante');

    const tabs: Array<{ view: string; state: string }> = [
      { view: 'view-adversaires', state: 'tab-adversaires' },
      { view: 'view-otages', state: 'tab-otages' },
      { view: 'view-amis', state: 'tab-amis' },
      { view: 'view-photos', state: 'tab-photos' },
      { view: 'view-plan', state: 'tab-plan' },
      { view: 'view-liens', state: 'tab-liens' },
    ];

    for (const { view, state } of tabs) {
      await page.locator(`.tab-btn[data-view="${view}"]`).click();
      await expect(page.locator(`#${view}`)).toHaveClass(/active/);
      await page.waitForTimeout(300);
      if (view === 'view-plan') {
        // Onglet carte : tuiles reseau, delai generique jusqu'a 15s (cf. mission).
        await settleMap(page, 15000);
      }
      await capture(page, testInfo, 'pctac', state);
    }

    // --- Panneaux/outils principaux de l'onglet Plan, ouverts un par un ---
    // La boucle ci-dessus termine sur le DERNIER onglet du tableau (Liens),
    // pas sur Plan (#plan_* est alors dans un .tab-content-view masque,
    // display:none -> tout .click() dessus resterait "not visible" jusqu'au
    // timeout). Il faut revenir explicitement sur l'onglet Plan.
    await page.locator('.tab-btn[data-view="view-plan"]').click();
    await expect(page.locator('#view-plan')).toHaveClass(/active/);
    await page.waitForTimeout(300);

    // 1. Bandeau recherche adresse/coordonnees (#plan_btn_search -> .open sur #plan_search_panel)
    await page.locator('#plan_btn_search').click();
    await expect(page.locator('#plan_search_panel')).toHaveClass(/open/);
    await page.waitForTimeout(300);
    await capture(page, testInfo, 'pctac', 'tab-plan-panneau-recherche');
    await page.locator('#plan_search_close').click();

    // 2. Dock d'outils de dessin (#plan_btn_draw -> .open sur #plan_draw_dock)
    await page.locator('#plan_btn_draw').click();
    await expect(page.locator('#plan_draw_dock')).toHaveClass(/open/);
    await page.waitForTimeout(300);
    await capture(page, testInfo, 'pctac', 'tab-plan-dock-dessin');
    await page.locator('#plan_btn_draw').click(); // referme (etat propre pour la suite)

    // 3. Panneau geoloc equipe live (Tchap) (#tl_toggle -> display:block sur #tl_panel)
    await page.locator('#tl_toggle').click();
    await expect(page.locator('#tl_panel')).toHaveCSS('display', 'block');
    await page.waitForTimeout(300);
    await capture(page, testInfo, 'pctac', 'tab-plan-panneau-tchap-live');
  });
});
