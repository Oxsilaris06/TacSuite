import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

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
 * P3B.FIX (reprise 3), BLOQUANT R2 : point de synchronisation RÉEL avant
 * d'interagir avec le dock dessin de la vue Plan, remplaçant un
 * `page.waitForTimeout(1800)` fixe (posé en P3B.FIX reprise 1). Mesuré sur 2
 * runs complets de la suite (130 tests, `workers: 1`) : 1 échec sur 2 de
 * « Plan — dessin … » en `chromium-mobile`, cascade lue dans
 * error-context.md remontant à `PlanMap.init()` pas encore prêt au moment du
 * clic sur `.plan-draw-btn[data-tool="rectangle"]` (`style.background`
 * jamais posé) — le budget fixe de 1800ms peut être dépassé par la charge
 * CUMULÉE du serveur dev sur une suite longue, avec ou sans parallélisme
 * inter-workers.
 *
 * `PlanMapContract` (`docs/SPEC-CONTRATS.md:162`) expose `map` et
 * `initialized` : on attend l'état interne réel plutôt qu'un délai —
 * `window.PlanMap.initialized` (fin d'`init()` réussi) ET `map.loaded()` +
 * `map.areTilesLoaded()` (API MapLibre publique, mêmes garanties que
 * `waitForMapIdle` dans `tests/visual/compare.mjs`) — avant de considérer le
 * dock dessin interactif. Vérifié en direct sur 127.0.0.1:9678/pctac/ :
 * `{hasPlanMap:true, initialized:true, hasMap:true, loaded:true, tiles:true}`.
 *
 * ⚠ `waitForFunction(pageFunction, arg, options)` : l'`arg` (2e paramètre)
 * est requis pour que Playwright résolve le 3e comme `options` — l'omettre
 * (forme à 2 arguments `waitForFunction(fn, { timeout })`) fait passer
 * l'objet `{ timeout }` comme `arg`, PAS comme `options` (confirmé : la
 * 1re version de ce correctif time out à 3000ms — `use.actionTimeout` de
 * `playwright.config.ts` — au lieu des 15000ms demandés, cause du FAIL
 * `chromium-desktop` de « Plan — mesure de distance / azimut » constaté sur
 * le 2e run complet de validation de cette même reprise). `undefined`
 * ci-dessous est cet `arg` explicite, obligatoire pour que `{ timeout: 15000 }`
 * soit bien reçu comme `options`.
 */
async function waitForPlanMapReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const pm = window.PlanMap;
      return !!pm && pm.initialized && !!pm.map && pm.map.loaded() && pm.map.areTilesLoaded();
    },
    undefined,
    // P4.FIX, BLOQUANT R1 : releve de 15000 a 30000ms — mesure sur un run
    // COMPLET (136 tests, workers=1, preview) : « Plan — dessin » a encore
    // echoue ici (desktop ET mobile), meme diagnostic que documente par
    // P3B.FIX reprise 1/3 (cf. commentaire au point d'usage) — un budget
    // FIXE, quelle que soit sa valeur, reste sujet a la charge CUMULEE
    // (memoire/GC, contextes WebGL) d'une suite longue a un seul worker ;
    // ce point de synchronisation attend deja un etat REEL (pas un delai
    // arbitraire), le relevement ne fait qu'absorber un ralentissement
    // temporaire de ce meme etat sous charge, pas masquer un blocage
    // permanent. Cf. aussi le `retries` cible sur le test « Plan — dessin »
    // (meme fichier, meme cause), defense en profondeur.
    { timeout: 30000 }
  );
}

/**
 * R7 (P2.FIX reprise 1) — CHECKLIST-PCTAC.md item #30 : construit un fixture
 * `.pctac.zip` minimal mais réaliste (manifest.json + data.json), au format
 * strictement attendu par `Archive.importFile` (archive.ts) : `data.json` est
 * un objet dont les valeurs sont les CHAÎNES JSON brutes de chaque clé
 * localStorage (`data[k] = localStorage.getItem(k)`, PAS un objet imbriqué).
 * Aucune image : `imgIds` reste vide, la branche `images/` n'est pas requise.
 */
async function buildPctacZipFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify({ appName: 'PC TAC', version: 1, createdAt: new Date().toISOString() }),
  );
  const logEntry = {
    id: 'e2e-import-1',
    heure: '11:11',
    pax: 'Adversaire',
    paxMode: 'standard',
    lieu: 'Lieu Import ZIP E2E',
    remarques: 'Importé via fixture E2E',
  };
  zip.file('data.json', JSON.stringify({ pcTacLogData: JSON.stringify([logEntry]) }));
  return zip.generateAsync({ type: 'nodebuffer' });
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

/**
 * R2-T2a : les `confirm()`/`alert()` natifs de PC-Tac sont remplacés par
 * `confirmDialog()`/`toast()` (`src/shared/feedback.ts`, `<dialog>` HTML
 * injecté, PAS un dialogue navigateur natif) — `page.on('dialog')` ne les
 * intercepte donc plus (cette API Playwright ne couvre QUE les vrais
 * `alert()`/`confirm()`/`prompt()`/`beforeunload` du moteur). Chaque site
 * d'appel qui ouvrait un `confirm()` bloquant est désormais cliqué
 * explicitement via ce sélecteur stable (`data-tac-confirm="ok"`, posé par
 * `confirmDialog()`), à l'endroit de chaque test concerné.
 */
async function clickConfirmDialogOk(page: Page): Promise<void> {
  await page.locator('[data-tac-confirm="ok"]').click();
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
      // U15 — la première ligne peut être un séparateur de jour : on ne
      // compare que les lignes d'entrée.
      const rows = page.locator('#logTable tbody tr:not(.log-day-sep)');
      await expect.soft(rows.first()).toContainText('Entrée B — E2E', { timeout: 1500 });
    });

    await step("édition d'une entrée existante (modale editModal)", async () => {
      const row = page.locator('#logTable tbody tr', { hasText: 'Entrée A — E2E' });
      await row.locator('button.edit, .action-btn-small.edit').click();
      // openEditModal (ui.js:286-297 / ui.ts) bascule `style.display`, PAS une
      // classe CSS — vérifié contre l'original (aucune classe `.active` n'est
      // jamais posée sur #editModal, ni dans pctac2.html/ui.js ni dans le port).
      await expect.soft(page.locator('#editModal')).toBeVisible({ timeout: 1500 });
      await page.locator('#edit_remarques').fill('Remarque E2E 1 — modifiée');
      await page.locator('#confirmEditBtn').click();
      await expect
        .soft(page.locator('#logTable tbody tr', { hasText: 'Remarque E2E 1 — modifiée' }))
        .toBeVisible({ timeout: 1500 });
    });

    await step("suppression d'une entrée", async () => {
      const row = page.locator('#logTable tbody tr', { hasText: 'Entrée B — E2E' });
      await row.locator('button.delete-btn, .delete-btn').click();
      // U3 : deleteLogEntry passe désormais par confirmDialog() (danger:true).
      await clickConfirmDialogOk(page);
      await expect
        .soft(page.locator('#logTable tbody tr', { hasText: 'Entrée B — E2E' }))
        .toHaveCount(0, { timeout: 1500 });
    });
  });

  // U4 — le drag&drop du journal a été SUPPRIMÉ (le tri chronologique de
  // Storage.saveLogData est la source de vérité) : test de réordonnancement retiré.

  test('Main Courante — mode PAX libre + couleur personnalisée', async ({ page }) => {
    // REVALIDÉ post-P2.D (CHECKLIST-PCTAC.md item #6) : `.mode-toggle-btn` et
    // `#pax_select_wrapper_standard`/`#pax_select_wrapper_free` sont absents à
    // la fois de `pctac2.html` (ORIGINAL, grep confirmé — 0 occurrence) et de
    // `pctac/index.html` (porté) — CE N'EST PAS un oubli du câblage P2.D : rien
    // n'injecte ces éléments au runtime non plus (`UI.initPaxModeAndColors`
    // n'en crée aucun). `UI.setPaxMode`/`.mode-toggle-btn` sont du code MORT
    // déjà dans la source (aucun appelant, aucun déclencheur UI), au même
    // titre que `#search_container`/`toggleSearchMode` (item #11). La fonction
    // `setPaxMode` elle-même reste néanmoins correcte : on l'invoque
    // directement via la façade `window.setPaxMode` pour vérifier la logique
    // portée (bascule des wrappers, valeur de `#pax_mode_input`), même si rien
    // dans l'UI ne l'atteint.
    await step('.mode-toggle-btn absent du DOM (dead code confirmé, non une régression)', async () => {
      await expect.soft(page.locator('.mode-toggle-btn')).toHaveCount(0);
      await expect.soft(page.locator('#pax_select_wrapper_free')).toHaveCount(0);
    });
    // `setPaxMode` (code mort) a été SUPPRIMÉ de ui.ts/UIContract : plus rien
    // à vérifier via la façade window.
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

  test('Main Courante — recherche/filtre journal (U2)', async ({ page }) => {
    // U2 : le markup (#search_container / #searchInput / #addLogBtn / loupe
    // #openSearchBtn) existe désormais et main.ts câble les 3 handlers.
    await step('ajouter deux entrées puis filtrer', async () => {
      for (const lieu of ['Recherche-A E2E', 'Recherche-B E2E']) {
        await page.locator('#heure_input').fill('11:00');
        await page.locator('.pax-select-option[data-pax="Inter"]').click();
        await page.locator('#lieu_input').fill(lieu);
        await page.locator('#remarques_input').fill('x');
        await page.locator('#log-form button[type="submit"]').click();
      }
      await page.locator('#openSearchBtn').click();
      await expect.soft(page.locator('#search_container')).toBeVisible();
      await page.locator('#searchInput').fill('recherche-b');
      // U15 — les séparateurs de jour sont exclus du comptage.
      await expect.soft(page.locator('#logTable tbody tr:not(.log-day-sep):visible')).toHaveCount(1);
      await page.locator('#closeSearchBtn').click();
      await expect.soft(page.locator('#search_container')).toBeHidden();
      await expect.soft(page.locator('#logTable tbody tr:not(.log-day-sep):visible')).toHaveCount(2);
    });
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
      // R2-T2a : window.deleteCollectionItem ouvre désormais confirmDialog()
      // (danger:true) au lieu de confirm() natif — clic explicite requis.
      await clickConfirmDialogOk(page);
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
      // Point de synchronisation : renderPhotos() pose la classe `active` (DOM,
      // synchrone) puis `localStorage.setItem('lastPhotoFilter', …)` sans await
      // entre les deux (ui.ts renderPhotos) - attendre le DOM garantit que le
      // localStorage est déjà écrit avant le reload qui suit immédiatement.
      await expect(page.locator('#photo-filter-container button.active')).toContainText('Otages', {
        timeout: 1500,
      });
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
    await step('carte + 9 FABs de la toolbar unifiée', async () => {
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
        'plan_btn_lidar',
        'plan_btn_aoi',
      ]) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
    });
  });

  // R7 (P2.FIX reprise 1) — CHECKLIST-PCTAC.md item #16 : bascule relief 2D/3D,
  // non couverte jusqu'ici. `window.PlanMap.is3D` (map-core.ts `_toggle3D`) est
  // l'état interne fiable à vérifier en headless (le pitch/bearing MapLibre
  // réel dépend du rendu WebGL, non déterministe en CI).
  test('Plan — bascule 2D/3D relief (#plan_btn_3d)', async ({ page }) => {
    await step('clic sur le FAB 3D bascule window.PlanMap.is3D', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1200);
      const before = await page.evaluate(
        () => (window as unknown as { PlanMap: { is3D: boolean } }).PlanMap.is3D,
      );
      await page.locator('#plan_btn_3d').click();
      await page.waitForTimeout(400); // _enable3D/_disable3D animent la caméra
      const after = await page.evaluate(
        () => (window as unknown as { PlanMap: { is3D: boolean } }).PlanMap.is3D,
      );
      expect.soft(before).toBe(false);
      expect.soft(after).toBe(true);
      await page.locator('#plan_btn_3d').click();
      await page.waitForTimeout(400);
      const afterToggleBack = await page.evaluate(
        () => (window as unknown as { PlanMap: { is3D: boolean } }).PlanMap.is3D,
      );
      expect.soft(afterToggleBack).toBe(false);
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
    // REVALIDÉ post-P2.D : `_openPingModal` (`#pingModal`) N'A AUCUN APPELANT
    // dans `planMap.js` (grep confirmé sur les 5596 lignes — la seule
    // occurrence est sa propre déclaration, planMap.js:957) : ce n'est PAS le
    // point d'entrée réel de la création de ping, ni dans l'original ni dans
    // le port. Le vrai flux (chrome.ts `_bindUi`, planMap.js:722-726) est une
    // ROUE CONTEXTUELLE (`wheels.ts` `_openCreatePingWheel`, planMap.js:3591) :
    // clic sur `#plan_btn_ping` → roue à 5 segments couleur OTAN (« Adv »,
    // « Otage », « Inter », « Oscar », « Inconnu ») + « Catalogue » + « Copier
    // coords », posée sur le centre de la carte. Taper un segment couleur
    // pose directement un ping (icône par défaut) — `_quickPlacePing`.
    await step('ouvrir la roue de création (clic sur le FAB ping)', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1000); // carte + tuiles
      await page.locator('#plan_btn_ping').click();
      await expect.soft(page.locator('.plan-wheel')).toBeVisible({ timeout: 1500 });
    });
    await step('taper un segment couleur pose un ping directement', async () => {
      await page.locator('.plan-wheel button[title="Oscar"]').click();
      // Un ping = 2 `maplibregl.Marker` distincts (pins.ts:492/495 : icône +
      // label), pas 1 — vérifié dans le code (`entry.pinMarker`/`entry.labelMarker`).
      await expect.soft(page.locator('.maplibregl-marker')).toHaveCount(2, { timeout: 2000 });
    });
  });

  // P4.FIX, BLOQUANT R1 : `describe` dédié pour un `retries` CIBLÉ sur ce
  // seul test — mesuré en échec (desktop ET mobile) sur un run COMPLET
  // (136 tests, workers=1, preview), toujours à l'étape `waitForPlanMapReady`
  // (cf. sa JSDoc ci-dessus) : cause identique et déjà documentée par
  // P3B.FIX (reprise 1/3) — un budget fixe, aussi large soit-il, reste par
  // nature sujet à la charge CUMULÉE (mémoire/GC, contextes WebGL) d'une
  // suite longue à un seul worker. Défense en profondeur avec le
  // relèvement du timeout ci-dessus (30000ms) : pas de `retries` global dans
  // `playwright.config.ts`, qui masquerait des régressions ailleurs.
  //
  // `timeout: 60000` ICI AUSSI (pas seulement le `waitForFunction` interne
  // à `waitForPlanMapReady`) — BUG mesuré en direct dans cette même reprise :
  // le timeout GLOBAL par défaut d'un test Playwright (30000ms, non modifié
  // dans `playwright.config.ts`) est resté à 30000ms alors que
  // `waitForPlanMapReady` (relevé ci-dessus à 30000ms lui aussi) l'occupe à
  // lui seul en cas de lenteur réelle — le test entier expirait ALORS QUE
  // son propre `waitForFunction` interne tournait encore (« Test timeout of
  // 30000ms exceeded », page/contexte fermés en plein milieu de l'étape
  // suivante). Le timeout de test doit rester STRICTEMENT SUPÉRIEUR à la
  // somme du budget `waitForPlanMapReady` + celui, cumulé, des étapes de
  // dessin qui le suivent dans le même test.
  test.describe('Plan — dessin (retry cible, charge cumulee suite longue)', () => {
    test.describe.configure({ retries: 1, timeout: 60000 });

    test('Plan — dessin (trait/rectangle/cercle/texte) + couleurs + undo/redo + effacer', async ({
      page,
    }) => {
      await step('ouvrir le dock et sélectionner outil + couleur', async () => {
        await clickTab(page, 'view-plan');
        // cf. test « Plan — verrouillage » : laisser PlanMap.init() se stabiliser
        // avant d'interagir avec le dock dessin (flaky sous charge parallèle sans
        // cette attente).
        // P3B.FIX (reprise 3), BLOQUANT R2 : `waitForTimeout` fixe remplacé par
        // le vrai point de synchronisation (`waitForPlanMapReady`, cf. sa
        // JSDoc) — la reprise 1 avait relevé ce délai de 1000 à 1800ms mais son
        // propre commentaire admettait que ce test échouait encore parfois
        // seul dans la suite COMPLÈTE (130 tests), jamais isolé : un budget
        // FIXE, quelle que soit sa valeur, reste par nature sujet à la charge
        // cumulée (mémoire/GC) du serveur dev sur une suite longue.
        await waitForPlanMapReady(page);
        await page.locator('#plan_btn_draw').click();
        await expect.soft(page.locator('#plan_draw_dock')).toHaveClass(/open/, { timeout: 1500 });
        for (const tool of ['line', 'rectangle', 'circle', 'text', 'measure']) {
          await expect.soft(page.locator(`.plan-draw-btn[data-tool="${tool}"]`)).toBeVisible();
        }
        // Ordre couleur PUIS outil (pas l'inverse) : `_setDrawColor` (draw-tools.ts,
        // verbatim planMap.js:2082-2089) réinvoque `_setTool(this.drawTool)` pour
        // re-styler le bouton actif, mais le garde de toggle de `_setTool`
        // (`if (tool && this.drawTool === tool) tool = null`) désélectionne
        // l'outil s'il est déjà actif au moment du clic couleur — comportement de
        // l'ORIGINAL, pas une régression de portage (vérifié verbatim). Cliquer
        // l'outil EN DERNIER est donc requis pour qu'il reste actif au moment du
        // tracé ci-dessous.
        await page.locator('.plan-draw-color[data-color="#22c55e"]').click();
        await page.locator('.plan-draw-btn[data-tool="rectangle"]').click();
        // _setDrawTool (draw-tools.ts, planMap.js:2025-2029) marque l'outil actif
        // via `style.background` inline, PAS une classe CSS — vérifié contre
        // l'original (aucune classe `.active`/`.selected` n'est jamais posée ici).
        const bg = await page
          .locator('.plan-draw-btn[data-tool="rectangle"]')
          .evaluate((el) => (el as HTMLElement).style.background);
        expect.soft(bg).not.toBe('transparent');
      });
      // Assertion sur l'état persistant (localStorage `pcTacPlanShapes`,
      // `planmap/constants.ts` SHAPES_KEY) plutôt que sur le rendu WebGL du
      // canvas MapLibre : `#plan_map .maplibregl-canvas` est présent AVANT
      // tout tracé (dès l'initialisation de la carte), donc ne prouve pas
      // qu'une forme a réellement été créée — cf. SPEC-PLANMAP-SPLIT.md §5.8
      // (`_undo`/`_redo` écrivent directement dans ce même localStorage).
      const shapesCount = () =>
        page.evaluate(() => JSON.parse(localStorage.getItem('pcTacPlanShapes') || '[]').length);

      await step('tracer un rectangle par glisser', async () => {
        // Viewport <=768px (mobile) : `_setTool` (draw-tools.ts, verbatim
        // planMap.js:2018-2023) active `drawPrecisionMode` pour tout outil autre
        // que trait/mesure (même condition `window.innerWidth <= 768` reprise
        // ici — `drawPrecisionMode` est un état INTERNE, volontairement absent
        // de la façade `PlanMapContract`, cf. docs/SPEC-CONTRATS.md), et
        // `_handleDrawDown` retourne alors immédiatement
        // (`if (!this.drawTool || this.drawPrecisionMode) return;`, planMap.js:2094)
        // — un glisser-déposer direct sur la carte NE crée AUCUNE forme, comme
        // dans l'ORIGINAL (comportement mobile délibéré : réticule + boutons
        // Viser/Valider plutôt qu'un drag imprécis au doigt). Le flux diffère
        // donc selon le viewport, pas seulement l'assertion finale.
        const viewport = page.viewportSize();
        const precisionMode = !!viewport && viewport.width <= 768;
        const box = await page.locator('#plan_map').boundingBox();
        if (precisionMode) {
          await page.locator('#plan_draw_precision_start').click();
          if (box) {
            // Panote la carte (dragPan reste actif en mode précision) pour que le
            // centre au moment de « Valider » diffère du centre visé au départ.
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 5 });
            await page.mouse.up();
          }
          await page.locator('#plan_draw_precision_confirm').click();
        } else if (box) {
          await page.mouse.move(box.x + 100, box.y + 100);
          await page.mouse.down();
          await page.mouse.move(box.x + 200, box.y + 200);
          await page.mouse.up();
        }
        await expect.poll(shapesCount, { timeout: 1500 }).toBe(1);
      });
      await step('undo/redo (Ctrl+Z/Y) et effacer tout', async () => {
        await page.keyboard.press('Control+z');
        await expect.poll(shapesCount, { timeout: 1500 }).toBe(0);
        await page.keyboard.press('Control+y');
        await expect.poll(shapesCount, { timeout: 1500 }).toBe(1);
        // R2-T2a (design-taste) : #plan_draw_clear n'ouvre plus de confirm()
        // — action directe (déjà réversible par Ctrl+Z, _pushHistory() posé
        // avant le vidage) + toast, donc aucun clic de confirmation à faire ici.
        await page.locator('#plan_draw_clear').click();
        await expect.poll(shapesCount, { timeout: 1500 }).toBe(0);
      });
    });
  });

  test('Plan — mesure de distance / azimut', async ({ page }) => {
    await step('outil mesure : deux clics sur la carte affichent une distance', async () => {
      await clickTab(page, 'view-plan');
      // P3B.FIX (reprise 3), BLOQUANT R2 : `waitForPlanMapReady` (vrai point
      // de synchronisation), même justification que le test « Plan — dessin »
      // ci-dessus.
      await waitForPlanMapReady(page);
      await page.locator('#plan_btn_draw').click();
      await page.locator('.plan-draw-btn[data-tool="measure"]').click();
      // P3B.FIX (reprise 1), BLOQUANT R2 : petite marge après la sélection de
      // l'outil (même nature que le commentaire « Ordre couleur PUIS outil »
      // du test « Plan — dessin » — le clic sur `.plan-draw-btn` déclenche un
      // câblage/état interne avant que le premier clic carte soit pris en
      // compte comme sommet de mesure) - sans elle, sous charge cumulée du
      // serveur dev, les deux clics ci-dessous arrivent parfois avant que
      // l'outil measure soit réellement actif et aucun label n'apparaît.
      await page.waitForTimeout(200);
      const box = await page.locator('#plan_map').boundingBox();
      if (box) {
        await page.mouse.click(box.x + 80, box.y + 80);
        await page.mouse.click(box.x + 220, box.y + 180);
      }
      // Sélecteur précisé : `text=/\d+\s?(m|km)/` seul était ambigu (matchait
      // aussi le contrôle d'échelle natif MapLibre, toujours présent —
      // `.maplibregl-ctrl-scale`, ex. « 100 km »), en violation du mode strict
      // Playwright dès que le libellé de mesure est réellement rendu (measure.ts
      // `.plan-measure-label`). Deux clics posent un sommet + un cumul : deux
      // labels existent, `.first()` suffit à confirmer le rendu.
      // P3B.FIX (reprise 1), BLOQUANT R2 : timeout releve de 2000 a 3500ms -
      // mesure : ce test a encore echoue une fois sur cette assertion dans la
      // suite COMPLETE (130 tests, workers=1) malgre le relevement de
      // playwright.config.ts (cette valeur EXPLICITE ecrase le defaut global
      // `expect.timeout`, elle doit donc etre relevee ici aussi).
      await expect
        .soft(page.locator('#plan_map .plan-measure-label').first())
        .toBeVisible({ timeout: 3500 });
    });
  });

  test('Plan — verrouillage global et par-annotation', async ({ page }) => {
    await clickTab(page, 'view-plan');
    // Comme les autres tests Plan : laisser PlanMap.init() (asynchrone) et le
    // câblage du dock dessin se stabiliser avant d'interagir — sans cette
    // attente, le clic sur #plan_draw_lock arrive parfois avant que son
    // `onclick` soit posé (flaky sous charge parallèle constatée).
    // P3B.FIX (reprise 3), BLOQUANT R2 : `waitForPlanMapReady` (vrai point de
    // synchronisation), même justification que le test « Plan — dessin »
    // ci-dessus.
    await waitForPlanMapReady(page);
    await page.locator('#plan_btn_draw').click();
    await step('verrou global (#plan_draw_lock)', async () => {
      await page.locator('#plan_draw_lock').click();
      await expect
        .soft(page.locator('#plan_draw_lock .material-symbols-outlined'))
        .toHaveText('lock', { timeout: 1500 });
    });
    await step('verrou par-annotation (cadenas sur un ping)', async () => {
      // REVALIDÉ post-P2.D : la création se fait via la roue contextuelle
      // (`_openCreatePingWheel`, cf. test « Plan — ping »), pas via #pingModal
      // (dead code, aucun appelant dans planMap.js). Après pose, `_quickPlacePing`
      // rouvre AUTOMATIQUEMENT la roue d'OPTIONS ~80 ms plus tard (wheels.ts:151),
      // avec un segment « Verrouiller » — plus fiable ici qu'un double-tap manuel
      // sur un marqueur potentiellement minuscule à l'écran.
      await page.locator('#plan_btn_ping').click();
      await page.locator('.plan-wheel button[title="Inconnu"]').click();
      // Un ping = 2 `maplibregl.Marker` (icône + label, pins.ts:492/495).
      await expect.soft(page.locator('.maplibregl-marker')).toHaveCount(2, { timeout: 2000 });
      await expect.soft(page.locator('.plan-wheel button[title="Verrouiller"]')).toBeVisible({ timeout: 1500 });
      await page.locator('.plan-wheel button[title="Verrouiller"]').click();
      // Cadenas TOUJOURS présent sur le marqueur icône (pins.ts:279-282, « cadenas
      // cliquable TOUJOURS visible »), classe RÉELLE `.plan-lock-badge` (pas
      // `.lock-badge`/`[data-lock-badge]`, constatée dans le code).
      const badge = page.locator('.maplibregl-marker .plan-lock-badge').first();
      await expect.soft(badge).toHaveText('lock', { timeout: 1500 });
    });
  });

  test('Plan — diamètres cercle, overlay noms de rues', async ({ page }) => {
    await step('toggles diamètres + noms de rues', async () => {
      await clickTab(page, 'view-plan');
      await page.locator('#plan_btn_draw').click();
      await page.locator('#plan_draw_diameter_toggle').click();
      await page.locator('#plan_btn_labels').click();
      await expect.soft(page.locator('#plan_btn_labels')).toHaveClass(/active/, { timeout: 1500 });
    });
  });

  // CHECKLIST-PCTAC.md item #26 : ISOLÉ de son test d'origine (qui dépendait
  // de #plan_btn_draw) — `<details id="plan_legend">` est un élément HTML
  // NATIF (aucun JS requis pour se déplier), donc testable indépendamment de
  // tout câblage `PlanMap`/dock dessin.
  test('Plan — légende repliable (élément <details> natif)', async ({ page }) => {
    await step('déplier la légende via <summary>, sans dépendance au dock dessin', async () => {
      await clickTab(page, 'view-plan');
      const legend = page.locator('#plan_legend');
      await legend.locator('summary').click();
      await expect.soft(legend).toHaveAttribute('open', '', { timeout: 1500 });
    });
  });

  // Overlays LiDAR HD (IGN) : l'état interne `window.PlanMap.lidarLayer` est le
  // seul témoin fiable en headless (le rendu raster dépend du réseau IGN et de
  // WebGL). On vérifie le cyclage MNT → MNS → MNH → aucun et sa persistance.
  test('Plan — ombrage LiDAR HD (#plan_btn_lidar) : cyclage MNT/MNS/MNH/aucun', async ({ page }) => {
    await step('4 clics ramènent au point de départ, en passant par les 3 couches', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1500);
      // Le FAB vit dans le tiroir « Plus » (U24), `hidden` par défaut.
      await page.locator('#plan_btn_more').click();
      const btn = page.locator('#plan_btn_lidar');
      // Même procédé que le test 2D/3D ci-dessus : `lidarLayer` est un état
      // INTERNE de `PlanMap`, hors du contrat public `PlanMapContract`.
      const current = () => page.evaluate(
        () => (window as unknown as { PlanMap: { lidarLayer: string | null } }).PlanMap.lidarLayer,
      );

      expect.soft(await current()).toBeNull();
      for (const expected of ['mnt', 'mns', 'mnh']) {
        await btn.click();
        expect.soft(await current()).toBe(expected);
      }
      await expect.soft(btn).toHaveClass(/active/, { timeout: 1500 });
      await btn.click();
      expect.soft(await current()).toBeNull();
      await expect.soft(btn).not.toHaveClass(/active/, { timeout: 1500 });
      // La couche éteinte ne laisse rien derrière elle en stockage.
      expect.soft(await page.evaluate(() => localStorage.getItem('pcTacPlanLidar'))).toBeNull();
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
      // REVALIDÉ post-P2.D : un ping existant s'atteint normalement par un
      // DOUBLE-TAP sur son marqueur (`_openPingOptionsWheel`, wheels.ts:158,
      // déclenché par `_lastPinTap` — deux taps < 350 ms, pins.ts:392-397).
      // Chemin plus fiable en E2E : `_quickPlacePing` ROUVRE déjà cette même
      // roue d'options ~80 ms après la pose (wheels.ts:151), avec son propre
      // segment « Copier coords » lié aux coordonnées RÉELLES du pin (par
      // opposition à celui de la roue de CRÉATION, qui copie le centre carte).
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1000);
      await page.locator('#plan_btn_ping').click();
      await page.locator('.plan-wheel button[title="Inter"]').click();
      // Un ping = 2 `maplibregl.Marker` (icône + label, pins.ts:492/495).
      await expect.soft(page.locator('.maplibregl-marker')).toHaveCount(2, { timeout: 2000 });
      await expect.soft(page.locator('.plan-wheel button[title="Copier coords"]')).toBeVisible({ timeout: 1500 });
      await page.locator('.plan-wheel button[title="Copier coords"]').click();
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
  // R7 (P2.FIX reprise 1) — CHECKLIST-PCTAC.md item #30 : import d'archive
  // `.pctac.zip`, jusqu'ici NON COUVERT (seulement `archive.ts` testé
  // unitairement). `setInputFiles` n'exige pas que l'input soit visible (il
  // passe par CDP), donc aucun besoin de déplier le dock au préalable ici —
  // seul l'événement `change` compte, câblé par main.ts étape 19.
  test('Dock — import archive .pctac.zip (checklist item #30)', async ({ page }) => {
    await step('importer un fixture .pctac.zip et retrouver son entrée de journal', async () => {
      const buffer = await buildPctacZipFixture();
      await page.setInputFiles('#archiveImportInput', {
        name: 'fixture.pctac.zip',
        mimeType: 'application/zip',
        buffer,
      });
      // R2-T2a : Archive.importFile ouvre désormais confirmDialog() (danger:true,
      // « Les données actuelles seront remplacées. ») au lieu de confirm() natif.
      await clickConfirmDialogOk(page);
      await expect
        .soft(page.locator('#logTable tbody tr', { hasText: 'Lieu Import ZIP E2E' }))
        .toBeVisible({ timeout: 3000 });
    });
  });

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

    // `#dockMenu` ship AVEC la classe `collapsed` figée dans le DOM statique
    // (T17, pctac/index.html) : `.dock-menu.collapsed .dock-menu-item:not(#dockToggleBtn)`
    // est `display:none` (styles/pctac.css) tant que le dock n'a pas été déplié.
    // Sans ce clic préalable, TOUS les boutons internes du dock restent non
    // interactifs — cause racine confirmée, pas un défaut de câblage P2.D.
    await step('déplier le dock (préalable requis avant tout item interne)', async () => {
      await page.locator('#dockToggleBtn').click();
      await expect.soft(page.locator('#dockMenu')).not.toHaveClass(/collapsed/, { timeout: 1500 });
    });

    await step('bascule thème clair/sombre', async () => {
      await expect.soft(page.locator('body')).toHaveClass(/dark-mode/);
      await page.locator('#darkModeToggle').click();
      await expect.soft(page.locator('body')).not.toHaveClass(/dark-mode/, { timeout: 1500 });
    });

    // P2.FIX reprise 1 — régression prouvée : --shadow-glow-accent (styles/pctac.css,
    // bloc :root, P2.F) référence var(--accent-glow) en IMBRIQUÉ. Un var() imbriqué
    // dans une custom property se substitue avec la valeur cascadée au POINT DE
    // DÉCLARATION (:root, valeur sombre) et non par élément : sans réaffectation
    // explicite dans body.light-mode, .add-btn:hover / .add-log-btn:hover /
    // .custom-file-upload:hover gardaient le glow SOMBRE en thème clair. Le gate
    // visuel (tests/visual/compare.mjs) ne l'aurait jamais détecté : ses 20 états
    // capturent tous en dark-mode (défaut du DOM statique), aucune baseline claire.
    // Cette assertion ciblée comble ce trou de couverture sans capture d'écran.
    // Détail : docs/DECISIONS-CSS.md §6.
    await step('cohérence --shadow-glow-accent en thème clair (P2.FIX reprise 1)', async () => {
      const vals = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        const accentGlowRaw = cs.getPropertyValue('--accent-glow').trim();
        return {
          // P4.FIX, BLOQUANT R1 : `getComputedStyle` sur une PROPRIÉTÉ
          // PERSONNALISÉE (non typée) sérialise sa couleur dans le format
          // choisi par le moteur de rendu au moment de la requête — mesuré :
          // `rgba(29, 99, 214, 0.16)` texte, TEL QU'AUTEURÉ dans
          // `styles/pctac.css:342`, sur les versions de Chromium utilisées
          // lors des gates P2/P3 ; `#1d63d629` (hex8, MÊME couleur —
          // 0x29 = round(0.16×255) = 41) sur la version bundlée par
          // `@playwright/test@1.62.1` de cette mission. Comparaison
          // rendue INDÉPENDANTE de ce détail de sérialisation en passant
          // par une propriété TYPÉE (`color`, dont la forme calculée
          // `rgb()`/`rgba()` est fixée par la spec CSSOM, cf. probe
          // ci-dessous) plutôt que de comparer le texte brut de la
          // custom property à un littéral figé sur un format precis.
          accentGlow: (() => {
            const probe = document.createElement('div');
            probe.style.color = accentGlowRaw;
            document.body.appendChild(probe);
            const normalized = getComputedStyle(probe).color;
            probe.remove();
            return normalized;
          })(),
          // Auto-cohérence (shadowGlowAccent référence accentGlow) : les
          // DEUX valeurs proviennent du même appel `getPropertyValue` sur
          // des custom properties, donc du MÊME format quel qu'il soit —
          // comparaison déjà indépendante de la sérialisation, aucun
          // changement nécessaire ici (garde le texte BRUT, pas normalisé).
          shadowGlowAccent: cs.getPropertyValue('--shadow-glow-accent').trim(),
          accentGlowRaw,
        };
      });
      expect.soft(vals.accentGlow).toBe('rgba(29, 99, 214, 0.16)');
      expect.soft(vals.shadowGlowAccent).toBe(`0 0 15px ${vals.accentGlowRaw}`);
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
      // showResetModal (ui.ts) bascule `style.display`, pas une classe (même
      // remarque que pour #editModal ci-dessus).
      await expect.soft(page.locator('#resetModal')).toBeVisible({ timeout: 1500 });
      await page.locator('#confirmResetBtn').click();
      // U11 : journal vide → une ligne d'état vide « Aucun événement enregistré ».
      await expect.soft(page.locator('#logTable tbody tr .empty-state')).toHaveCount(1, { timeout: 1500 });
    });

    await step('transfert par QR — EXCLU DU PORTAGE (décision explicite, qrSync.js code mort)', async () => {
      // cf. CONTEXTE COMMUN de la mission : qrSync.js est dans la liste du code
      // mort exclu du portage. Aucun bouton de déclenchement QR n'existe dans
      // pctac/index.html porté — écart volontaire, pas une régression.
      await expect.soft(page.locator('[id*="qr" i], [id*="Qr" i]')).toHaveCount(0);
    });
  });

  test('Tuto interactif — bouton injecté dans le dock + ouverture', async ({ page }) => {
    // Même préalable que le test « Dock global » : le dock ship `collapsed`,
    // qui masque tous les `.dock-menu-item` (dont `.ptuto-dock`) sauf le
    // bouton de bascule lui-même.
    await page.locator('#dockToggleBtn').click();
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
