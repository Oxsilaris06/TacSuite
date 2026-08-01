import { test, expect, type Page } from '@playwright/test';

/**
 * P2.E1 — Tests E2E fonctionnels PC-Tac, contre http://127.0.0.1:9678/pctac/.
 *
 * Source des critères : docs/recon-pctac.md §6 (checklist fonctionnelle de
 * non-régression), point par point. Un `test()` par grande rubrique de la
 * checklist ; chaque sous-point est une `step(nom, fn)` (helper ci-dessous,
 * enveloppe `test.step` + try/catch + `expect.soft`) : une exception dans une
 * étape (ex. clic sur un élément resté non interactif faute de câblage) est
 * capturée et rapportée comme un échec `soft` SANS interrompre les étapes
 * suivantes du même test — condition nécessaire pour obtenir un diagnostic
 * point par point complet même quand la app est largement non fonctionnelle.
 *
 * ÉTAT CONNU AU MOMENT DE L'ÉCRITURE (voir compte-rendu de la tâche P2.E1) :
 * `src/apps/pctac/main.ts` est encore le PLACEHOLDER de scaffold (P0.A1) — le
 * câblage réel (P2.D : délégation d'événements, `UI.initElements()`, montage
 * de `PlanMap`, `PocheTuto.mount()`, etc., cf. docs/SPEC-PCTAC-CONVERSION.md
 * §3 et §5) n'a PAS encore été exécuté. La quasi-totalité des tests
 * comportementaux ci-dessous échouent donc pour UNE SEULE cause racine
 * commune (aucune vue ne réagit, aucun formulaire n'est intercepté, aucun
 * `window.*` n'est posé) — ce n'est PAS N régressions indépendantes, voir
 * docs/CHECKLIST-PCTAC.md pour le détail. Les assertions purement
 * structurelles (DOM statique : présence des 7 onglets, hrefs des liens
 * externes de l'onglet Liens, items du dock, manifest PWA...) sont, elles,
 * indépendantes du câblage et restent vertes. Ces tests restent la cible
 * opposable pour le prochain gate une fois P2.D exécuté — ne pas les
 * affaiblir pour les faire passer artificiellement.
 */

const VIEWS = [
  'view-main-courante',
  'view-adversaires',
  'view-otages',
  'view-amis',
  'view-photos',
  'view-plan',
  'view-liens',
] as const;

async function gotoPctac(page: Page): Promise<void> {
  await page.goto('/pctac/');
  await page.waitForLoadState('domcontentloaded');
}

async function clickTab(page: Page, viewId: string): Promise<void> {
  await page.locator(`.tab-btn[data-view="${viewId}"]`).click();
}

/**
 * Enveloppe une étape de checklist : capture toute exception (ex. clic sur un
 * élément non interactif) en échec `soft` au lieu de laisser l'exception
 * interrompre les étapes suivantes du même test. `test.step` reste utilisé
 * pour le nommage/regroupement dans le rapport Playwright.
 */
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  await test.step(name, async () => {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      expect
        .soft(
          false,
          `Étape « ${name} » interrompue par une exception (probable élément non interactif faute de câblage P2.D) : ${msg}`
        )
        .toBe(true);
    }
  });
}

test.describe('PC-Tac — Checklist fonctionnelle (docs/recon-pctac.md §6)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPctac(page);
  });

  // ------------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------------
  test('Navigation — structure des 7 onglets + bascule de vue', async ({ page }) => {
    await step('les 7 boutons data-view existent avec le bon libellé (structurel, indépendant du câblage)', async () => {
      for (const viewId of VIEWS) {
        await expect.soft(page.locator(`.tab-btn[data-view="${viewId}"]`)).toBeVisible();
        await expect.soft(page.locator(`#${viewId}`)).toBeAttached();
      }
      // Onglet par défaut actif dans le DOM statique.
      await expect.soft(page.locator('#view-main-courante')).toHaveClass(/active/);
      await expect.soft(page.locator('.tab-btn[data-view="view-main-courante"]')).toHaveClass(/active/);
    });

    for (const viewId of VIEWS.slice(1)) {
      await step(`clic sur l'onglet ${viewId} active la vue correspondante`, async () => {
        await clickTab(page, viewId);
        await expect.soft(page.locator(`#${viewId}`)).toHaveClass(/active/, { timeout: 1500 });
        await expect
          .soft(page.locator(`.tab-btn[data-view="${viewId}"]`))
          .toHaveClass(/active/, { timeout: 1500 });
        // Les autres vues ne doivent plus être actives.
        for (const other of VIEWS) {
          if (other === viewId) continue;
          await expect.soft(page.locator(`#${other}`)).not.toHaveClass(/active/, { timeout: 500 });
        }
      });
    }

    await step('navigation clavier flèches sur la tablist (a11y makeTablist)', async () => {
      await page.locator('.tab-btn[data-view="view-main-courante"]').focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .soft(page.locator('.tab-btn[data-view="view-adversaires"]'))
        .toBeFocused({ timeout: 1500 });
    });
  });

  test('Navigation — dernier onglet restauré après rechargement', async ({ page }) => {
    await step('activer un onglet non défaut puis recharger', async () => {
      await clickTab(page, 'view-otages');
      await expect.soft(page.locator('#view-otages')).toHaveClass(/active/, { timeout: 1500 });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect.soft(page.locator('#view-otages')).toHaveClass(/active/, { timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // Main Courante (journal)
  // ------------------------------------------------------------------
  test("Main Courante — ajout, tri, édition, suppression d'entrée", async ({ page }) => {
    await step("ajout d'une entrée en mode PAX standard", async () => {
      await page.locator('#heure_input').fill('10:00');
      await page.locator('.pax-select-option[data-pax="Otage"]').click();
      await page.locator('#lieu_input').fill('Entrée A — E2E');
      await page.locator('#remarques_input').fill('Remarque E2E 1');
      await page.locator('#log-form button[type="submit"]').click();
      await expect
        .soft(page.locator('#logTable tbody tr', { hasText: 'Entrée A — E2E' }))
        .toBeVisible({ timeout: 1500 });
    });

    await step('tri par heure (entrée plus ancienne insérée après, doit apparaître avant)', async () => {
      await page.locator('#heure_input').fill('08:00');
      await page.locator('#lieu_input').fill('Entrée B — E2E (plus tôt)');
      await page.locator('#remarques_input').fill('Remarque E2E 2');
      await page.locator('#log-form button[type="submit"]').click();
      const rows = page.locator('#logTable tbody tr');
      await expect.soft(rows.first()).toContainText('Entrée B — E2E', { timeout: 1500 });
    });

    await step("édition d'une entrée existante (modale editModal)", async () => {
      const row = page.locator('#logTable tbody tr', { hasText: 'Entrée A — E2E' });
      await row.locator('button.edit, .action-btn-small.edit').click();
      await expect.soft(page.locator('#editModal')).toHaveClass(/active/, { timeout: 1500 });
      await page.locator('#edit_remarques').fill('Remarque E2E 1 — modifiée');
      await page.locator('#confirmEditBtn').click();
      await expect
        .soft(page.locator('#logTable tbody tr', { hasText: 'Remarque E2E 1 — modifiée' }))
        .toBeVisible({ timeout: 1500 });
    });

    await step("suppression d'une entrée", async () => {
      const row = page.locator('#logTable tbody tr', { hasText: 'Entrée B — E2E' });
      await row.locator('button.delete-btn, .delete-btn').click();
      await expect
        .soft(page.locator('#logTable tbody tr', { hasText: 'Entrée B — E2E' }))
        .toHaveCount(0, { timeout: 1500 });
    });
  });

  test('Main Courante — mode PAX libre + couleur personnalisée', async ({ page }) => {
    // cf. ui.js setPaxMode/.mode-toggle-btn — bascule standard/libre. Sélecteur
    // best-effort : les wrappers #pax_select_wrapper_standard/_free et les
    // .mode-toggle-btn ne sont PAS dans le DOM statique de pctac2.html/pctac/index.html,
    // ils sont attendus injectés au runtime par UI.init (non confirmé avant câblage réel).
    await step('bouton de bascule vers le mode libre atteignable', async () => {
      await expect
        .soft(page.locator('.mode-toggle-btn[data-mode="free"]'))
        .toBeVisible({ timeout: 1500 });
    });
  });

  test('Main Courante — autosuggestion de lieu (historique)', async ({ page }) => {
    await step('ajouter une entrée puis retrouver le lieu en suggestion', async () => {
      await page.locator('#heure_input').fill('09:00');
      await page.locator('.pax-select-option[data-pax="Inter"]').click();
      await page.locator('#lieu_input').fill('Lieu Historique E2E');
      await page.locator('#remarques_input').fill('x');
      await page.locator('#log-form button[type="submit"]').click();
      await page.locator('#lieu_input').fill('');
      await expect
        .soft(page.locator('#lieu_suggestions option[value="Lieu Historique E2E"]'))
        .toHaveCount(1, { timeout: 1500 });
    });
  });

  test('Main Courante — recherche/filtre journal (dépendance connue, cf. CHECKLIST-PCTAC.md)', async ({
    page,
  }) => {
    // NOTE : `UI.toggleSearchMode/filterLogs` référencent `#search_container` /
    // `#searchInput` / `#addLogBtn` (modules/pctac/ui.js:701-719) qui n'existent
    // dans AUCUN DOM statique — ni pctac2.html (ORIGINAL), ni pctac/index.html
    // (porté) — et aucun bouton n'invoque `toggleSearchMode()` dans l'original.
    // Ce test documente l'état (déjà mort dans la source), il ne doit pas être
    // interprété comme une régression du portage. Voir docs/CHECKLIST-PCTAC.md.
    await expect.soft(page.locator('#search_container')).toHaveCount(0);
  });

  // ------------------------------------------------------------------
  // Adversaires / Otages / Amis — CRUD
  // ------------------------------------------------------------------
  async function testCrudCollection(
    page: Page,
    viewId: string,
    formId: string,
    fields: Record<string, string>,
    submitSelector: string,
    tbodyId: string,
    matchText: string
  ): Promise<void> {
    await clickTab(page, viewId);
    await step(`${viewId} — création via formulaire`, async () => {
      for (const [id, value] of Object.entries(fields)) {
        await page.locator(`#${id}`).fill(value);
      }
      await page.locator(`#${formId} ${submitSelector}`).click();
      await expect
        .soft(page.locator(`#${tbodyId} tr`, { hasText: matchText }))
        .toBeVisible({ timeout: 1500 });
    });

    await step(`${viewId} — suppression`, async () => {
      const row = page.locator(`#${tbodyId} tr`, { hasText: matchText });
      await row.locator('.delete-btn').click();
      await expect.soft(page.locator(`#${tbodyId} tr`, { hasText: matchText })).toHaveCount(0, {
        timeout: 1500,
      });
    });
  }

  test('Adversaires — CRUD fiche (nom, statut, notes) + suppression', async ({ page }) => {
    await testCrudCollection(
      page,
      'view-adversaires',
      'adversary-form',
      { adv_nom: 'DUPONT-E2E', adv_prenom: 'Jean', adv_arme: 'Arme E2E' },
      'button[type="submit"]',
      'adversary-table-body',
      'DUPONT-E2E'
    );
  });

  test('Otages — CRUD fiche (nom, état/blessures) + suppression', async ({ page }) => {
    await testCrudCollection(
      page,
      'view-otages',
      'hostage-form',
      { hostage_nom: 'MARTIN-E2E', hostage_etat: 'Conscient' },
      'button[type="submit"]',
      'hostage-table-body',
      'MARTIN-E2E'
    );
  });

  test('Amis — CRUD (nom, unité, TPH, mission) + suppression', async ({ page }) => {
    await testCrudCollection(
      page,
      'view-amis',
      'friend-form',
      { friend_nom: 'GROUPE-E2E', friend_unite: 'GIGN' },
      'button[type="submit"]',
      'friend-table-body',
      'GROUPE-E2E'
    );
  });

  // ------------------------------------------------------------------
  // Photos
  // ------------------------------------------------------------------
  test('Photos — upload (input file), catégorisation, titre, lightbox, filtre', async ({ page }) => {
    await clickTab(page, 'view-photos');
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await step('upload + catégorisation + titre', async () => {
      await page.locator('#photo_title').fill('Photo E2E');
      await page.locator('#photo_category').selectOption('hostage');
      await page.setInputFiles('#photo_file', {
        name: 'e2e.png',
        mimeType: 'image/png',
        buffer: Buffer.from(pngBase64, 'base64'),
      });
      await page.locator('#photo-form button[type="submit"]').click();
      await expect
        .soft(page.locator('#photo-board .photo-card', { hasText: 'Photo E2E' }))
        .toBeVisible({ timeout: 1500 });
    });

    await step('filtre par catégorie persistant', async () => {
      await page.locator('#photo-filter-container button', { hasText: 'Otages' }).click();
      await expect
        .soft(page.locator('#photo-board .photo-card', { hasText: 'Photo E2E' }))
        .toBeVisible({ timeout: 1500 });
      await page.reload();
      await clickTab(page, 'view-photos');
      await expect
        .soft(page.locator('#photo-filter-container button.active'))
        .toContainText('Otages', { timeout: 1500 });
    });

    await step('lightbox plein écran', async () => {
      await page.locator('#photo-board .photo-card img').first().click();
      await expect.soft(page.locator('#lightboxModal')).toBeVisible({ timeout: 1500 });
      await page.locator('#lightboxModal button').click();
      await expect.soft(page.locator('#lightboxModal')).toBeHidden({ timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // Plan (carte tactique MapLibre)
  // ------------------------------------------------------------------
  test('Plan — initialisation carte + toolbar unifiée', async ({ page }) => {
    await step('carte + 8 FABs de la toolbar unifiée', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1500);
      await expect.soft(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 3000 });
      for (const id of [
        'plan_btn_search',
        'plan_btn_fullscreen',
        'plan_btn_3d',
        'plan_btn_capture',
        'plan_btn_ping',
        'plan_btn_draw',
        'plan_btn_labels',
        'plan_btn_aoi',
      ]) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
    });
  });

  test('Plan — recherche adresse / coordonnées GPS (Nominatim)', async ({ page }) => {
    await step('ouvrir le bandeau et rechercher des coordonnées GPS', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_search').click();
      await expect.soft(page.locator('#plan_search_panel')).toHaveClass(/open/, { timeout: 1500 });
      await page.locator('#plan_address_input').fill('48.8566, 2.3522');
      await page.locator('#plan_search_btn').click();
      await expect.soft(page.locator('#plan_search_results')).not.toBeEmpty({ timeout: 3000 });
    });
  });

  test('Plan — ping : entité existante et point libre', async ({ page }) => {
    await step('ouvrir la modale et créer un point libre', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_ping').click();
      await expect.soft(page.locator('#pingModal')).toBeVisible({ timeout: 1500 });
      await page.locator('#free_pin_label').fill('Point libre E2E');
      await page.locator('#free_pin_color_select .pax-select-option[data-kind="Oscar"]').click();
      await page.locator('#freePinConfirmBtn').click();
      await expect.soft(page.locator('#pingModal')).toBeHidden({ timeout: 1500 });
    });
    await step('placer le point sur la carte', async () => {
      await page.locator('#plan_map').click({ position: { x: 200, y: 200 } });
      await expect.soft(page.locator('.maplibregl-marker')).toHaveCount(1, { timeout: 2000 });
    });
  });

  test('Plan — dessin (trait/rectangle/cercle/texte) + couleurs + undo/redo + effacer', async ({
    page,
  }) => {
    await step('ouvrir le dock et sélectionner outil + couleur', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_draw').click();
      await expect.soft(page.locator('#plan_draw_dock')).toHaveClass(/open/, { timeout: 1500 });
      for (const tool of ['line', 'rectangle', 'circle', 'text', 'measure']) {
        await expect.soft(page.locator(`.plan-draw-btn[data-tool="${tool}"]`)).toBeVisible();
      }
      await page.locator('.plan-draw-btn[data-tool="rectangle"]').click();
      await expect
        .soft(page.locator('.plan-draw-btn[data-tool="rectangle"]'))
        .toHaveClass(/active|selected/, { timeout: 1500 });
      await page.locator('.plan-draw-color[data-color="#22c55e"]').click();
    });
    await step('tracer un rectangle par glisser', async () => {
      const box = await page.locator('#plan_map').boundingBox();
      if (box) {
        await page.mouse.move(box.x + 100, box.y + 100);
        await page.mouse.down();
        await page.mouse.move(box.x + 200, box.y + 200);
        await page.mouse.up();
      }
      await expect
        .soft(page.locator('#plan_map .maplibregl-canvas, #plan_map svg, #plan_map [data-shape-id]'))
        .toBeVisible({ timeout: 1500 });
    });
    await step('undo/redo (Ctrl+Z/Y) et effacer tout', async () => {
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+y');
      await page.locator('#plan_draw_clear').click();
    });
  });

  test('Plan — mesure de distance / azimut', async ({ page }) => {
    await step('outil mesure : deux clics sur la carte affichent une distance', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_draw').click();
      await page.locator('.plan-draw-btn[data-tool="measure"]').click();
      const box = await page.locator('#plan_map').boundingBox();
      if (box) {
        await page.mouse.click(box.x + 80, box.y + 80);
        await page.mouse.click(box.x + 220, box.y + 180);
      }
      await expect
        .soft(page.locator('#plan_map').locator('text=/\\d+\\s?(m|km)/'))
        .toBeVisible({ timeout: 2000 });
    });
  });

  test('Plan — verrouillage global et par-annotation', async ({ page }) => {
    await clickTab(page, 'view-plan');
    await page.locator('#plan_btn_draw').click();
    await step('verrou global (#plan_draw_lock)', async () => {
      await page.locator('#plan_draw_lock').click();
      await expect
        .soft(page.locator('#plan_draw_lock .material-symbols-outlined'))
        .toHaveText('lock', { timeout: 1500 });
    });
    await step('verrou par-annotation (cadenas sur un ping)', async () => {
      // Nécessite un ping déjà placé sur la carte — non recréé ici (couvert par
      // le test "ping"), best-effort : on vérifie juste qu'un badge de verrou
      // existe quelque part sur un pin/forme visible.
      await page.locator('#plan_btn_ping').click();
      await page.locator('#free_pin_label').fill('Lock E2E');
      await page.locator('#freePinConfirmBtn').click();
      await page.locator('#plan_map').click({ position: { x: 250, y: 150 } });
      await expect
        .soft(page.locator('.maplibregl-marker .lock-badge, .maplibregl-marker [data-lock-badge]'))
        .toHaveCount(1, { timeout: 1500 });
    });
  });

  test('Plan — diamètres cercle, overlay noms de rues, légende repliable', async ({ page }) => {
    await step('toggles diamètres + noms de rues + légende', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_draw').click();
      await page.locator('#plan_draw_diameter_toggle').click();
      await page.locator('#plan_btn_labels').click();
      await expect.soft(page.locator('#plan_btn_labels')).toHaveClass(/active/, { timeout: 1500 });
      const legend = page.locator('#plan_legend');
      await legend.locator('summary').click();
      await expect.soft(legend).toHaveAttribute('open', '', { timeout: 1500 });
    });
  });

  test('Plan — zone hors-ligne (AOI) : armement du cadrage', async ({ page }) => {
    await step('clic sur le FAB AOI arme le cadrage rectangle', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_aoi').click();
      await expect.soft(page.locator('#plan_btn_aoi')).toHaveClass(/active/, { timeout: 1500 });
    });
  });

  test('Plan — copier coordonnées (WGS84/DMS/MGRS) via presse-papier', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Permissions clipboard non supportées hors Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await step('placer un point puis copier ses coordonnées via la roue contextuelle', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_ping').click();
      await page.locator('#free_pin_label').fill('Coord E2E');
      await page.locator('#freePinConfirmBtn').click();
      await page.locator('#plan_map').click({ position: { x: 150, y: 150 } });
      await page.locator('.maplibregl-marker').first().click({ button: 'right' });
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      expect.soft(clipboardText).not.toBe('');
    });
  });

  test('Plan — capture haute qualité (captureToDataUrl → dataUrl non vide)', async ({ page }) => {
    await step('window.PlanMap.captureToDataUrl() retourne un data:image/ non vide', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1200);
      const result = await page.evaluate(async () => {
        const pm = (window as unknown as { PlanMap?: { captureToDataUrl?: () => Promise<string> } })
          .PlanMap;
        if (!pm || typeof pm.captureToDataUrl !== 'function') return null;
        return pm.captureToDataUrl();
      });
      expect.soft(result, 'window.PlanMap.captureToDataUrl doit exister et retourner un data URL').not.toBeNull();
      if (result) {
        expect.soft(result.startsWith('data:image/')).toBe(true);
        expect.soft(result.length).toBeGreaterThan(100);
      }
    });
  });

  test('Plan — géoloc équipe live (Tchap) : panneau et bascule token/ProConnect', async ({ page }) => {
    await clickTab(page, 'view-plan');
    await step('ouverture du panneau', async () => {
      await page.locator('#tl_toggle').click();
      await expect.soft(page.locator('#tl_panel')).toBeVisible({ timeout: 1500 });
    });
    await step('connexion réelle (OAuth device-code / token) — HORS PÉRIMÈTRE E2E', async () => {
      // Nécessite un vrai compte ProConnect / token Tchap valide et un salon non
      // chiffré réel : voir docs/CHECKLIST-PCTAC.md pour la méthode de
      // vérification alternative (revue de code de src/apps/pctac/tchap-live.ts).
      test.info().annotations.push({
        type: 'hors-e2e',
        description: 'Connexion Tchap réelle non testable en E2E — vérifiée par revue de code.',
      });
    });
  });

  // ------------------------------------------------------------------
  // Liens (onglet statique — structure DOM, ne dépend d'AUCUN câblage JS ;
  // la bascule visuelle .active de l'onglet est déjà couverte par le test
  // "Navigation", volontairement PAS revérifiée ici pour ne pas mélanger une
  // assertion comportementale dans un test documenté comme structurel)
  // ------------------------------------------------------------------
  test('Liens — liens externes statiques (Google Maps/Earth, Tchap, WhatsApp)', async ({ page }) => {
    const expectations: Array<[string, string]> = [
      ['OUVRIR GOOGLE MAPS', 'google.com/maps'],
      ['OUVRIR GOOGLE EARTH', 'earth.google.com'],
      ['TCHAP', 'tchap.gouv.fr'],
      ['WHATSAPP', 'web.whatsapp.com'],
    ];
    for (const [text, hrefFragment] of expectations) {
      const link = page.locator('#view-liens a', { hasText: text });
      await expect.soft(link).toHaveAttribute('href', new RegExp(hrefFragment));
      await expect.soft(link).toHaveAttribute('target', '_blank');
    }
  });

  // ------------------------------------------------------------------
  // Global / dock flottant
  // ------------------------------------------------------------------
  test('Dock global — export/import archive, import OI, thème, plein écran, PDF, reset', async ({
    page,
  }) => {
    await step('présence des items du dock (structurel)', async () => {
      for (const id of [
        'dockToggleBtn',
        'exportJsonDockBtn',
        'importJsonDockBtn',
        'importOiDockBtn',
        'darkModeToggle',
        'fullscreenToggle',
        'previewPdfDockBtn',
        'resetDataDockBtn',
      ]) {
        await expect.soft(page.locator(`#${id}`)).toBeAttached();
      }
    });

    await step('bascule thème clair/sombre', async () => {
      await expect.soft(page.locator('body')).toHaveClass(/dark-mode/);
      await page.locator('#darkModeToggle').click();
      await expect.soft(page.locator('body')).not.toHaveClass(/dark-mode/, { timeout: 1500 });
    });

    await step('export archive .pctac.zip déclenche un téléchargement', async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
      await page.locator('#exportJsonDockBtn').click();
      const download = await downloadPromise;
      expect.soft(download).not.toBeNull();
      if (download) {
        expect.soft(download.suggestedFilename()).toMatch(/\.pctac\.zip$|\.zip$/);
      }
    });

    await step('génération PDF déclenche un téléchargement', async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await page.locator('#previewPdfDockBtn').click();
      const download = await downloadPromise;
      expect.soft(download).not.toBeNull();
      if (download) {
        expect.soft(download.suggestedFilename()).toMatch(/\.pdf$/);
      }
    });

    await step('réinitialisation totale (confirmation puis purge)', async () => {
      await page.locator('#resetDataDockBtn').click();
      await expect.soft(page.locator('#resetModal')).toHaveClass(/active/, { timeout: 1500 });
      await page.locator('#confirmResetBtn').click();
      await expect.soft(page.locator('#logTable tbody tr')).toHaveCount(0, { timeout: 1500 });
    });

    await step('transfert par QR — EXCLU DU PORTAGE (décision explicite, qrSync.js code mort)', async () => {
      // cf. CONTEXTE COMMUN de la mission : qrSync.js est dans la liste du code
      // mort exclu du portage. Aucun bouton de déclenchement QR n'existe dans
      // pctac/index.html porté — écart volontaire, pas une régression.
      await expect.soft(page.locator('[id*="qr" i], [id*="Qr" i]')).toHaveCount(0);
    });
  });

  test('Tuto interactif — bouton injecté dans le dock + ouverture', async ({ page }) => {
    await step('bouton .ptuto-dock injecté par PocheTuto.mount()', async () => {
      await expect.soft(page.locator('#dockMenu .ptuto-dock')).toBeVisible({ timeout: 1500 });
      await page.locator('#dockMenu .ptuto-dock').click();
      await expect.soft(page.locator('[class*="ptuto"]').first()).toBeVisible({ timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // Persistance après rechargement (toutes collections)
  // ------------------------------------------------------------------
  test('Persistance — les données en localStorage sont ré-affichées après rechargement', async ({
    page,
  }) => {
    await step('seed localStorage puis reload : le journal se ré-affiche', async () => {
      await page.evaluate(() => {
        localStorage.setItem(
          'pcTacLogData',
          JSON.stringify([
            {
              id: 'seed1',
              heure: '12:00',
              pax: 'Adversaire',
              paxMode: 'standard',
              lieu: 'Seed Lieu',
              remarques: 'Seed remarque',
            },
          ])
        );
        localStorage.setItem('pcTacAdversaries', JSON.stringify([{ id: 'seedadv1', nom: 'SEED-ADV', prenom: '' }]));
      });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect
        .soft(page.locator('#logTable tbody tr', { hasText: 'Seed Lieu' }))
        .toBeVisible({ timeout: 1500 });
    });
    await step('seed localStorage puis reload : les adversaires se ré-affichent', async () => {
      await clickTab(page, 'view-adversaires');
      await expect
        .soft(page.locator('#adversary-table-body tr', { hasText: 'SEED-ADV' }))
        .toBeVisible({ timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // PWA — hors périmètre de la Phase 2 (précache/service worker = P4.A,
  // cf. docs/PLAN.md §6). On vérifie seulement ce qui est déjà attendu ici.
  // ------------------------------------------------------------------
  test('PWA — manifest référencé (le service worker est un livrable de la Phase 4)', async ({ page }) => {
    await expect.soft(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    const swRegistered = await page.evaluate(() => 'serviceWorker' in navigator);
    expect.soft(swRegistered).toBe(true); // API dispo dans le navigateur ; l'enregistrement effectif est P4.A.
  });
});
