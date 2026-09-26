import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * P2.E1 — Tests E2E fonctionnels PC-Tac, contre http://127.0.0.1:9678/pctac/.
 *
 * Source des critères : checklist fonctionnelle de non-régression, point par
 * point. Un `test()` par grande rubrique de la
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
 * de `PlanMap`, `PocheTuto.mount()`, etc.) n'a PAS encore été exécuté. La quasi-totalité des tests
 * comportementaux ci-dessous échouent donc pour UNE SEULE cause racine
 * commune (aucune vue ne réagit, aucun formulaire n'est intercepté, aucun
 * `window.*` n'est posé) — ce n'est PAS N régressions indépendantes. Les
 * assertions purement
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

test.describe('PC-Tac — Checklist fonctionnelle', () => {
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

  // Décision 17 — fiche unique : bouton « + », fiche plein écran, carte.
  async function testCrudFiche(
    page: Page,
    viewId: string,
    side: 'adv' | 'host',
    fill: (page: Page) => Promise<void>,
    listId: string,
    matchText: string
  ): Promise<void> {
    await clickTab(page, viewId);
    await step(`${viewId} — création via la fiche`, async () => {
      await page.locator(`[data-fiche-new="${side}"]`).click();
      await expect.soft(page.locator('#ficheSheet')).toBeVisible({ timeout: 1500 });
      await fill(page);
      await page.locator('#ficheSheet .fiche-save').click();
      await expect
        .soft(page.locator(`#${listId} .fiche-card`, { hasText: matchText }))
        .toBeVisible({ timeout: 1500 });
    });

    await step(`${viewId} — suppression`, async () => {
      const card = page.locator(`#${listId} .fiche-card`, { hasText: matchText });
      await card.locator('.delete-btn').click();
      await clickConfirmDialogOk(page);
      await expect.soft(page.locator(`#${listId} .fiche-card`, { hasText: matchText })).toHaveCount(0, {
        timeout: 1500,
      });
    });
  }

  test('Adversaires — CRUD fiche (nom, armes) + suppression', async ({ page }) => {
    await testCrudFiche(page, 'view-adversaires', 'adv', async (p) => {
      await p.locator('#fiche_nom').fill('DUPONT-E2E');
      await p.locator('#fiche_prenom').fill('Jean');
      await p.locator('#ficheSheet .fiche-section[data-section="armement"] > summary').click();
      await p.locator('[data-key="armes"] .fiche-chip[data-chip="Arme longue"]').click();
    }, 'adversary-table-body', 'DUPONT-E2E');
  });

  test('Otages — CRUD fiche (nom, état) + suppression', async ({ page }) => {
    await testCrudFiche(page, 'view-otages', 'host', async (p) => {
      await p.locator('#fiche_nom').fill('MARTIN-E2E');
      await p.locator('#ficheSheet .fiche-section[data-section="etat"] > summary').click();
      await p.locator('[data-key="etat"] .fiche-chip[data-chip="Conscient"]').click();
    }, 'hostage-table-body', 'MARTIN-E2E');
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
      // Décision 26 : bord à bord, la marge de la feuille UA du <dialog> retirée.
      const box = await page.locator('#lightboxModal').boundingBox();
      const vp = page.viewportSize();
      expect.soft(box && vp ? [box.x, box.y, box.width, box.height] : null).toEqual(vp ? [0, 0, vp.width, vp.height] : null);
      // Décision 25 : une photo de la galerie s'annote depuis la visionneuse.
      await expect.soft(page.locator('#lightboxAnnotateBtn')).toBeVisible({ timeout: 1500 });
      await page.locator('#lightboxModal .pctac-lightbox-close-btn').click();
      await expect.soft(page.locator('#lightboxModal')).toBeHidden({ timeout: 1500 });
    });
  });

  test('Photos — annotation : texte de la Zone, Annuler jette le tracé (décision 26)', async ({ page }, testInfo) => {
    // Sur téléphone, les outils vivent dans le dock mobile : parcours de bureau.
    test.skip(testInfo.project.name === 'chromium-mobile', 'outils dans le dock mobile');
    await clickTab(page, 'view-photos');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      const g = c.getContext('2d')!;
      g.fillStyle = '#4a6';
      g.fillRect(0, 0, 400, 300);
      return c.toDataURL('image/png').split(',')[1]!;
    });
    await page.locator('#photo_title').fill('Zone E2E');
    await page.setInputFiles('#photo_file', { name: 'zone.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.locator('#photo-form button[type="submit"]').click();
    const card = page.locator('#photo-board .photo-card', { hasText: 'Zone E2E' });
    const stored = (): Promise<string | null> =>
      page.evaluate(() => {
        const list = JSON.parse(localStorage.getItem('pcTacPhotos') || '[]') as { title?: string; annotations?: string }[];
        return list.find((p) => p.title === 'Zone E2E')?.annotations ?? null;
      });
    const drag = async (dx: number): Promise<void> => {
      const box = (await page.locator('#annotationCanvas').boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx, cy + dx / 2, { steps: 4 });
      await page.mouse.up();
    };

    await step('Zone : le texte saisi est gardé', async () => {
      await card.locator('[data-photo-action="annotate"]').click();
      await expect(page.locator('#annotationModal')).toBeVisible();
      await page.locator('#tool_location').click();
      await page.locator('.tac-confirm-dialog .tac-confirm-input').fill('PC');
      await page.locator('.tac-confirm-dialog .tac-confirm-btn--ok').click();
      await drag(80);
      await page.locator('#annotation_save_header').click();
      await expect(page.locator('#annotationModal')).toBeHidden();
      await expect.poll(stored).toContain('"text":"PC"');
    });

    await step('Annuler : confirmation, puis rien du nouveau tracé n’est gardé', async () => {
      const before = await stored();
      await card.locator('[data-photo-action="annotate"]').click();
      await expect(page.locator('#annotationModal')).toBeVisible();
      await page.locator('#tool_box').click();
      await drag(-90);
      await page.locator('#annotation_cancel_header').click();
      await page.locator('.tac-confirm-dialog .tac-confirm-btn--danger').click();
      await expect(page.locator('#annotationModal')).toBeHidden();
      await page.waitForTimeout(300);
      expect(await stored()).toBe(before);
    });
  });

  test('Photos — tablette portrait et téléphone paysage : annotation et visionneuse utilisables (revue)', async ({ page }) => {
    await clickTab(page, 'view-photos');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 1200;
      const g = c.getContext('2d')!;
      g.fillStyle = '#4a6';
      g.fillRect(0, 0, 1600, 1200);
      return c.toDataURL('image/png').split(',')[1]!;
    });
    await page.locator('#photo_title').fill('Tablette E2E');
    await page.setInputFiles('#photo_file', { name: 't.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.locator('#photo-form button[type="submit"]').click();
    const card = page.locator('#photo-board .photo-card', { hasText: 'Tablette E2E' });
    await expect(card).toBeVisible();

    for (const [w, h] of [[800, 1280], [768, 1024], [844, 390]] as const) {
      await step(`annotation ${w}×${h} : la photo est visible`, async () => {
        await page.setViewportSize({ width: w, height: h });
        await card.locator('[data-photo-action="annotate"]').click();
        await expect(page.locator('#annotationModal')).toBeVisible();
        await page.waitForTimeout(300);
        const box = await page.locator('#annotationCanvas').boundingBox();
        expect.soft(box && box.width > 100 && box.height > 60, `toile ${JSON.stringify(box)}`).toBe(true);
        await page.locator('#annotation_cancel_header').click();
        await expect(page.locator('#annotationModal')).toBeHidden();
      });
    }

    await step('visionneuse 844×390 : ouverte en haut, croix visible et focalisée', async () => {
      await page.setViewportSize({ width: 844, height: 390 });
      await card.locator('img').click();
      await expect(page.locator('#lightboxModal')).toBeVisible();
      await page.waitForTimeout(200);
      const close = page.locator('#lightboxModal .pctac-lightbox-close-btn');
      expect.soft(await page.locator('#lightboxModal').evaluate((d) => d.scrollTop)).toBe(0);
      expect.soft((await close.boundingBox())!.y).toBeGreaterThanOrEqual(0);
      await expect.soft(close).toBeFocused();
      await close.click();
    });
  });

  // ------------------------------------------------------------------
  // Plan (carte tactique MapLibre)
  // ------------------------------------------------------------------
  test('Plan — initialisation carte + toolbar unifiée', async ({ page }) => {
    await step('carte + 6 FABs du rail principal', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1500);
      await expect.soft(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 3000 });
      for (const id of [
        'plan_btn_search',
        'plan_btn_ping',
        'plan_btn_draw',
        'plan_btn_layers',
        'plan_btn_fullscreen',
        'plan_btn_more',
      ]) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
    });

    await step('tiroir « Plus » : capture + zone hors-ligne', async () => {
      await page.locator('#plan_btn_more').click();
      for (const id of ['plan_btn_capture', 'plan_btn_aoi']) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
    });

    await step('panneau « Calques » : fond de carte, surimpressions, vue', async () => {
      await page.locator('#plan_btn_layers').click();
      for (const id of ['plan_btn_topo', 'plan_btn_lidar', 'plan_btn_contours', 'plan_btn_labels', 'plan_btn_3d']) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
    });
  });

  // R7 (P2.FIX reprise 1) — CHECKLIST-PCTAC.md item #16 : bascule relief 2D/3D,
  // non couverte jusqu'ici. `window.PlanMap.is3D` (map-core.ts `_toggle3D`) est
  // l'état interne fiable à vérifier en headless (le pitch/bearing MapLibre
  // réel dépend du rendu WebGL, non déterministe en CI).
  test('Plan — bascule 2D/3D relief (#plan_btn_3d)', async ({ page }) => {
    const skyErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && /sky/i.test(m.text())) skyErrors.push(m.text()); });
    await step('clic sur le FAB 3D bascule window.PlanMap.is3D', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1200);
      const before = await page.evaluate(
        () => (window as unknown as { PlanMap: { is3D: boolean } }).PlanMap.is3D,
      );
      // Le FAB vit dans le panneau « Calques », fermé par défaut.
      await page.locator('#plan_btn_layers').click();
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
      // Retour en 2D : le ciel est vraiment retiré, sans erreur de validation
      // MapLibre (setSky(null) était refusé : « sky: object expected, null found »).
      const skyAfter = await page.evaluate(
        () => (window as unknown as { PlanMap: { map: { getSky: () => unknown } } }).PlanMap.map.getSky() ?? null,
      );
      expect.soft(skyAfter).toBeNull();
      expect.soft(skyErrors).toEqual([]);
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
      // Autour du centre : le haut de la carte passe sous la barre d'onglets
      // collante sur téléphone (390 px), un clic à +80 px y tombait.
      if (box) {
        await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 60);
        await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40);
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
      // Le FAB vit dans le panneau « Calques », fermé par défaut.
      await page.locator('#plan_btn_layers').click();
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
      // Le FAB vit dans le panneau « Calques », fermé par défaut.
      await page.locator('#plan_btn_layers').click();
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

  // Fond topo couleur + courbes : deux bascules INDÉPENDANTES, composables avec
  // l'ombrage LiDAR. On vérifie l'indépendance (l'une n'éteint pas l'autre) et
  // la persistance séparée des deux clés.
  test('Plan — fond Plan IGN et courbes de niveau (#plan_btn_topo, #plan_btn_contours)', async ({ page }) => {
    await step('les deux bascules sont indépendantes et persistées séparément', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1500);
      await page.locator('#plan_btn_layers').click();

      const topo = page.locator('#plan_btn_topo');
      const contours = page.locator('#plan_btn_contours');
      const state = () => page.evaluate(() => {
        const pm = (window as unknown as { PlanMap: { planIgnOn: boolean; contoursOn: boolean } }).PlanMap;
        return { topo: pm.planIgnOn, contours: pm.contoursOn };
      });

      expect.soft(await state()).toEqual({ topo: false, contours: false });
      await topo.click();
      expect.soft(await state()).toEqual({ topo: true, contours: false });
      await contours.click();
      expect.soft(await state()).toEqual({ topo: true, contours: true });
      await expect.soft(topo).toHaveClass(/active/, { timeout: 1500 });
      await expect.soft(contours).toHaveClass(/active/, { timeout: 1500 });

      // Éteindre le fond ne doit PAS emporter les courbes avec lui.
      await topo.click();
      expect.soft(await state()).toEqual({ topo: false, contours: true });

      expect.soft(await page.evaluate(() => [
        localStorage.getItem('pcTacPlanTopo'),
        localStorage.getItem('pcTacPlanContours'),
      ])).toEqual(['0', '1']);
    });
  });

  test('Plan — zone hors-ligne (AOI) : armement du cadrage', async ({ page }) => {
    await step('clic sur le FAB AOI arme le cadrage rectangle', async () => {
      await clickTab(page, 'view-plan');
      await page.waitForTimeout(1200);
      // Le FAB vit dans le tiroir « Plus », fermé par défaut.
      await page.locator('#plan_btn_more').click();
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
      // chiffré réel : vérification alternative par revue de code de
      // src/apps/pctac/tchap-live.ts.
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
      // L'import ouvre la fenêtre de portée (#importScopeModal, fusion par
      // défaut, rien n'est écrasé) : « Importer » la valide.
      await page.locator('#importScopeConfirm').click();
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
      // Décision 42 — le bouton ouvre la fenêtre de génération (rapport
      // complet par défaut) : on confirme.
      await page.locator('dialog.tac-confirm-dialog [data-tac-confirm="ok"]').click();
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
        .soft(page.locator('#adversary-table-body .fiche-card', { hasText: 'SEED-ADV' }))
        .toBeVisible({ timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // PWA — précache/service worker hors périmètre ici. On vérifie seulement
  // ce qui est déjà attendu.
  // ------------------------------------------------------------------
  test('PWA — manifest référencé (le service worker est un livrable de la Phase 4)', async ({ page }) => {
    await expect.soft(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    const swRegistered = await page.evaluate(() => 'serviceWorker' in navigator);
    expect.soft(swRegistered).toBe(true); // API dispo dans le navigateur ; l'enregistrement effectif est P4.A.
  });
});

// ============================================================================
// Confirmation d'action destructrice — lisibilité dans les DEUX thèmes.
//
// Deux régressions mesurées avant correctif, sur `#resetModal` :
//   - thème SOMBRE, titre « RESET COMPLET » en rgb(0,0,0) sur rgba(16,16,19)
//     soit ~1,1:1. Cause : depuis la migration vers <dialog> natif, la feuille
//     UA applique `dialog { color: CanvasText }` À L'ÉLÉMENT, ce qui bat
//     l'héritage depuis body — et `.modal` ne déclarait aucun `color`.
//   - thème CLAIR, bouton « ANNULER » en rgb(255,255,255) sur rgba(255,255,255)
//     soit ~1,0:1. Cause : `.add-btn` pose `color: white` et les classes de
//     variante ne défaisaient que le `background`.
// Le gate visuel ne pouvait rien voir : ses états ne couvrent que la carto OI
// et capturent tous en thème sombre.
// ============================================================================

/** Luminance relative WCAG d'une couleur sérialisée `rgb()` / `rgba()`. */
function relativeLuminance(serialized: string): number {
  const parts = serialized.match(/[\d.]+/g);
  if (!parts) throw new Error(`couleur illisible : ${serialized}`);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(Number(parts[0])) + 0.7152 * channel(Number(parts[1])) + 0.0722 * channel(Number(parts[2]));
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

for (const theme of ['dark', 'light'] as const) {
  test(`modale RESET COMPLET — contraste AA en thème ${theme}`, async ({ page }) => {
    await page.addInitScript((t: string) => { localStorage.setItem('theme', t); }, theme);
    await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toHaveClass(theme === 'dark' ? /dark-mode/ : /light-mode/, { timeout: 3000 });

    const measured = await page.evaluate(() => {
      const dialog = document.getElementById('resetModal') as HTMLDialogElement | null;
      if (!dialog) throw new Error('#resetModal absent');
      if (!dialog.open) dialog.showModal();
      // Remonte jusqu'au premier fond réellement opaque : les boutons de la
      // modale sont peints sur des fonds semi-transparents.
      const opaqueBackdrop = (start: Element | null): string => {
        let el: Element | null = start;
        while (el) {
          const bg = getComputedStyle(el).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && !/,\s*0\)$/.test(bg)) return bg;
          el = el.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };
      const title = document.getElementById('resetModalTitle');
      const cancel = document.getElementById('cancelResetBtn');
      const confirm = document.getElementById('confirmResetBtn');
      if (!title || !cancel || !confirm) throw new Error('éléments de la modale absents');
      return {
        dialogBg: getComputedStyle(dialog).backgroundColor,
        titleColor: getComputedStyle(title).color,
        cancelColor: getComputedStyle(cancel).color,
        cancelBg: opaqueBackdrop(cancel),
        confirmColor: getComputedStyle(confirm).color,
        confirmBg: opaqueBackdrop(confirm),
      };
    });

    // Le titre d'une confirmation destructrice est ROUGE, jamais la couleur de
    // texte courante — et surtout jamais le noir de la feuille UA.
    const dangerRed = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = getComputedStyle(document.body).getPropertyValue('--danger-red').trim();
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect.soft(measured.titleColor).toBe(dangerRed);
    expect.soft(contrastRatio(measured.titleColor, measured.dialogBg)).toBeGreaterThanOrEqual(4.5);

    // « ANNULER » : c'est l'issue SÛRE, elle doit être la plus lisible.
    expect.soft(contrastRatio(measured.cancelColor, measured.cancelBg)).toBeGreaterThanOrEqual(4.5);

    // « CONFIRMER LE RESET » : action destructrice, fond plein, texte blanc.
    expect.soft(contrastRatio(measured.confirmColor, measured.confirmBg)).toBeGreaterThanOrEqual(4.5);
  });
}

// ============================================================================
// Sous-menus GPX — lisibilité dans les DEUX thèmes.
//
// `_openInlinePanel` peint son conteneur en dur, en sombre, par style INLINE :
// c'est le style historique des roues posées sur la carte. Les contenus GPX
// sont écrits avec les variables de thème, si bien qu'en thème clair un titre
// en `--text-muted` (encre sombre) tombait sur ce fond quasi noir. Le gate
// visuel ne peut rien voir : ses états ne couvrent pas ces sous-menus.
// ============================================================================

for (const theme of ['dark', 'light'] as const) {
  test(`sous-menus GPX — contraste AA en thème ${theme}`, async ({ page }) => {
    await page.addInitScript((t: string) => { localStorage.setItem('theme', t); }, theme);
    await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toHaveClass(theme === 'dark' ? /dark-mode/ : /light-mode/, { timeout: 3000 });
    await page.evaluate(() => { (window as unknown as { UI?: { switchMainView?: (v: string) => void } }).UI?.switchMainView?.('view-plan'); });
    await page.waitForTimeout(2500);

    await page.locator('#plan_btn_more').click();
    await page.waitForTimeout(250);
    await page.locator('#plan_btn_gpx').click();
    await page.waitForTimeout(350);
    // Le sous-menu de réglages reste ouvrable sans aucune trace importée.
    await page.locator('#plan_gpx_settings').click();
    await page.waitForTimeout(400);

    const measured = await page.evaluate(() => {
      const panel = document.querySelector('.plan-inline-panel');
      if (!panel) throw new Error('sous-menu GPX absent');
      const title = panel.querySelector('.plan-gpx-menu-title');
      const hint = panel.querySelector('.plan-gpx-menu-hint');
      const btn = panel.querySelector('.plan-gpx-menu-btn');
      if (!title || !hint || !btn) throw new Error('contenu du sous-menu absent');
      return {
        panelBg: getComputedStyle(panel).backgroundColor,
        titleColor: getComputedStyle(title).color,
        hintColor: getComputedStyle(hint).color,
        btnColor: getComputedStyle(btn).color,
        btnBg: getComputedStyle(btn).backgroundColor,
      };
    });

    expect.soft(contrastRatio(measured.titleColor, measured.panelBg)).toBeGreaterThanOrEqual(4.5);
    expect.soft(contrastRatio(measured.hintColor, measured.panelBg)).toBeGreaterThanOrEqual(4.5);
    expect.soft(contrastRatio(measured.btnColor, measured.btnBg)).toBeGreaterThanOrEqual(4.5);
  });
}

// ============================================================================
// Traces GPX — parcours complet : import, visibilité, persistance, suppression.
// Le câblage (FAB dans le tiroir « Plus », sélecteur de fichier, délégation des
// actions de ligne) et la persistance IndexedDB ne sont pas atteignables en
// test unitaire : c'est le seul endroit où ils sont vérifiés pour de vrai.
// ============================================================================

test('traces GPX — import, masquage, persistance et suppression', async ({ page }) => {
  const openPlan = async (): Promise<void> => {
    await page.evaluate(() => { (window as unknown as { UI?: { switchMainView?: (v: string) => void } }).UI?.switchMainView?.('view-plan'); });
    await page.waitForTimeout(2500);
  };
  const openGpxPanel = async (): Promise<void> => {
    await page.locator('#plan_btn_more').click();
    await page.waitForTimeout(250);
    await page.locator('#plan_btn_gpx').click();
    await page.waitForTimeout(350);
  };
  /** Nombre de features publiées sur la source GL des traces. */
  const featureCount = (): Promise<number> => page.evaluate(() => {
    const src = (window as unknown as { PlanMap?: { map?: { getSource(id: string): unknown } } })
      .PlanMap?.map?.getSource('plan-gpx-src') as { _data?: { features?: unknown[] } } | undefined;
    return src?._data?.features?.length ?? -1;
  });

  await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await openPlan();
  await openGpxPanel();

  await expect.soft(page.locator('#plan_gpx_panel')).toHaveClass(/open/);
  await expect.soft(page.locator('.plan-gpx-empty')).toContainText('Aucune trace');

  await page.locator('#plan_gpx_file').setInputFiles('tests/e2e/fixtures/reconnaissance-sud.gpx');
  await page.waitForTimeout(1200);

  await expect.soft(page.locator('.plan-gpx-row')).toHaveCount(1);
  // Le nom de la TRACE l'emporte sur celui des métadonnées du fichier.
  await expect.soft(page.locator('.plan-gpx-name')).toHaveText('Reconnaissance Sud');
  expect.soft(await featureCount()).toBe(1);

  // Une trace importée passe SOUS les dessins de l'opérateur, jamais par-dessus.
  const order = await page.evaluate(() => {
    const map = (window as unknown as { PlanMap: { map: { getStyle(): { layers: Array<{ id: string }> } } } }).PlanMap.map;
    const ids = map.getStyle().layers.map((l) => l.id);
    return { gpx: ids.indexOf('plan-gpx-line'), shapes: ids.indexOf('plan-shapes-fill') };
  });
  expect.soft(order.gpx).toBeGreaterThanOrEqual(0);
  expect.soft(order.gpx).toBeLessThan(order.shapes);

  // Masquer retire de la carte sans supprimer, et NE FERME PAS le panneau : la
  // liste est re-rendue dans le handler, donc la cible du clic est détachée
  // avant que l'écoute « clic extérieur » du document ne l'examine.
  await page.locator('[data-gpx-act="toggle"]').click();
  await page.waitForTimeout(400);
  expect.soft(await featureCount()).toBe(0);
  await expect.soft(page.locator('#plan_gpx_panel')).toHaveClass(/open/);
  await expect.soft(page.locator('.plan-gpx-row')).toHaveCount(1);

  await page.locator('[data-gpx-act="toggle"]').click();
  await page.waitForTimeout(400);
  expect.soft(await featureCount()).toBe(1);

  // Persistance réelle : index localStorage + coordonnées IndexedDB.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await openPlan();
  expect.soft(await featureCount()).toBe(1);
  await openGpxPanel();
  await expect.soft(page.locator('.plan-gpx-name')).toHaveText('Reconnaissance Sud');

  await page.locator('[data-gpx-act="remove"]').click();
  // Audit du 26/09 : la suppression d'une trace demande confirmation.
  await clickConfirmDialogOk(page);
  await page.waitForTimeout(700);
  expect.soft(await featureCount()).toBe(0);
  await expect.soft(page.locator('.plan-gpx-empty')).toHaveCount(1);
  expect.soft(JSON.parse(await page.evaluate(() => localStorage.getItem('pcTacGpxIndex')) ?? '[]')).toEqual([]);
});

// ============================================================================
// Dessin : outil ligne droite, puis rail et rotation du nom de la forme.
// Ces deux comportements dépendent d'un glissement réel sur la carte et de la
// position effective des poignées à l'écran — impossibles à couvrir en test
// unitaire, où la projection est simulée.
// ============================================================================

test('ligne droite + nom déplaçable le long du tracé et rotatif', async ({ page }) => {
  // À 768 px et moins, la ligne droite se pose au réticule (mode précision,
  // draw-tools.ts `drawPrecisionMode`, conçu pour les gants), pas au glisser :
  // ce parcours à la souris ne concerne que les écrans larges.
  test.skip((page.viewportSize()?.width ?? 0) <= 768, 'ligne droite au réticule sous 769 px');
  await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { (window as unknown as { UI?: { switchMainView?: (v: string) => void } }).UI?.switchMainView?.('view-plan'); });
  await page.waitForTimeout(2500);

  const shapes = (): Promise<Array<Record<string, unknown>>> =>
    page.evaluate(() => JSON.parse(localStorage.getItem('pcTacPlanShapes') ?? '[]'));
  const canvas = await page.locator('.maplibregl-canvas').first().boundingBox();
  if (!canvas) throw new Error('canvas carte introuvable');
  const at = (dx: number, dy: number): { x: number; y: number } => ({ x: canvas.x + dx, y: canvas.y + dy });

  await page.locator('#plan_btn_draw').click();
  await page.waitForTimeout(300);
  await expect.soft(page.locator('.plan-draw-btn[data-tool="line"]')).toHaveAttribute('title', 'Tracer un trait à main levée');

  // Glissement volontairement COURBE : une main levée y accumulerait des points
  // intermédiaires, la ligne droite ne doit garder que départ et arrivée.
  await page.locator('.plan-draw-btn[data-tool="straight"]').click();
  await page.waitForTimeout(200);
  const start = at(300, 300);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const [dx, dy] of [[340, 280], [380, 290], [420, 330], [460, 400]] as const) {
    const p = at(dx, dy);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  const drawn = (await shapes()).at(-1);
  expect.soft(drawn?.type).toBe('line');
  expect.soft((drawn?.coords as unknown[])?.length).toBe(2);

  // Nommer la forme fait apparaître les deux poignées de label.
  const id = String(drawn?.id);
  const coordsBefore = JSON.stringify(drawn?.coords);
  await page.evaluate((sid: string) => {
    const list = JSON.parse(localStorage.getItem('pcTacPlanShapes') ?? '[]') as Array<{ id: string; text?: string }>;
    const s = list.find((x) => x.id === sid);
    if (s) s.text = 'AXE ALPHA';
    localStorage.setItem('pcTacPlanShapes', JSON.stringify(list));
    const pm = (window as unknown as { PlanMap: { _renderShapes(): void; _selectShape(id: string): void } }).PlanMap;
    pm._renderShapes();
    pm._selectShape(sid);
  }, id);
  await page.waitForTimeout(600);

  const rail = page.locator('.maplibregl-marker[title*="le long du"]');
  const rot = page.locator('.maplibregl-marker[title*="tourner le nom"]');
  await expect.soft(rail).toHaveCount(1);
  await expect.soft(rot).toHaveCount(1);

  // La poignée de rail doit être RÉELLEMENT cliquable : posée sur le nom, elle
  // serait interceptée par le texte, qui a son propre geste de déplacement.
  const railBox = await rail.boundingBox();
  if (!railBox) throw new Error('poignée de rail sans boîte');
  const rx = railBox.x + railBox.width / 2;
  const ry = railBox.y + railBox.height / 2;
  const topMost = await page.evaluate((pt: { x: number; y: number }) =>
    document.elementFromPoint(pt.x, pt.y)?.closest('.maplibregl-marker')?.getAttribute('title') ?? 'rien',
    { x: rx, y: ry });
  expect.soft(topMost).toContain('le long du tracé');

  // Glisser le rail jusqu'au premier point du tracé.
  const firstPoint = await page.evaluate((sid: string) => {
    const list = JSON.parse(localStorage.getItem('pcTacPlanShapes') ?? '[]') as Array<{ id: string; coords: [number, number][] }>;
    const s = list.find((x) => x.id === sid);
    const pm = (window as unknown as { PlanMap: { map: { project(ll: { lng: number; lat: number }): { x: number; y: number }; getCanvas(): HTMLCanvasElement } } }).PlanMap;
    const c = s?.coords[0] ?? [0, 0];
    const pt = pm.map.project({ lng: c[0], lat: c[1] });
    const r = pm.map.getCanvas().getBoundingClientRect();
    return { x: pt.x + r.left, y: pt.y + r.top };
  }, id);
  await page.mouse.move(rx, ry);
  await page.mouse.down();
  await page.mouse.move(firstPoint.x, firstPoint.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  let updated = (await shapes()).find((s) => s.id === id);
  expect.soft(typeof updated?.labelT).toBe('number');
  expect.soft(updated?.labelT as number).toBeLessThan(0.25);
  // Le rail déplace le NOM, jamais le tracé.
  expect.soft(JSON.stringify(updated?.coords)).toBe(coordsBefore);

  const rotBox = await rot.boundingBox();
  if (!rotBox) throw new Error('poignée de rotation sans boîte');
  await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  updated = (await shapes()).find((s) => s.id === id);
  expect.soft(updated?.labelRot as number).toBeGreaterThanOrEqual(0);
  expect.soft(updated?.labelRot as number).toBeLessThan(360);

  const transform = (): Promise<string | undefined> => page.evaluate(() =>
    (document.querySelector('.maplibregl-marker .plan-shape-text') as HTMLElement | null)?.style.transform);
  const applied = await transform();
  expect.soft(applied).toMatch(/^rotate\(\d+deg\)$/);
  expect.soft(applied).not.toBe('rotate(0deg)');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { (window as unknown as { UI?: { switchMainView?: (v: string) => void } }).UI?.switchMainView?.('view-plan'); });
  await page.waitForTimeout(2500);
  expect.soft(await transform()).toBe(applied);
});

// ============================================================================
// Tiroir « Plus » : seconde colonne à gauche du rail en fenêtré, inchangé en
// plein écran. Fenêtré, la carte n'occupe qu'une partie de la page et les trois
// boutons empilés sous le bouton « Plus » débordaient du bas (mesuré : 26 px en
// 900x600). Piloté par `:fullscreen` en CSS, donc seul un vrai passage en plein
// écran le vérifie — hors de portée d'un test unitaire.
// ============================================================================

test('tiroir « Plus » — seconde colonne alignée sur la loupe en fenêtré', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => { (window as unknown as { UI?: { switchMainView?: (v: string) => void } }).UI?.switchMainView?.('view-plan'); });
  await page.waitForTimeout(2200);

  interface DrawerGeometry {
    cols: number;
    rows: number;
    offsetFromMagnifier: number;
    leftOfRail: boolean;
    gutter: number;
    belowMoreButton: number;
    overflow: number;
  }

  /** Géométrie du tiroir ouvert, souris écartée : le `:hover` d'un FAB le met
   *  à l'échelle 1.08 et fausserait les positions au pixel. */
  const readDrawer = async (): Promise<DrawerGeometry> => {
    await page.locator('#plan_btn_more').click({ force: true });
    await page.waitForTimeout(250);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      // `getBoundingClientRect()` renvoie un DOMRect dont les propriétés vivent
      // sur le prototype : les recopier explicitement, un spread ne prend rien.
      const box = (el: Element): { x: number; y: number; top: number; left: number; right: number; bottom: number } => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x), y: Math.round(r.y), top: Math.round(r.top),
          left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom),
        };
      };
      const magnifier = box(document.getElementById('plan_btn_search') as Element);
      const more = box(document.getElementById('plan_btn_more') as Element);
      const drawer = Array.from(document.getElementById('plan_more_tools')?.children ?? []).map(box);
      const toolbar = box(document.getElementById('plan_unified_toolbar') as Element);
      const map = box(document.querySelector('.maplibregl-map') as Element);
      const first = drawer[0] ?? magnifier;
      const lowest = Math.max(toolbar.bottom, ...drawer.map((d) => d.bottom));
      return {
        cols: new Set(drawer.map((d) => d.x)).size,
        rows: new Set(drawer.map((d) => d.y)).size,
        offsetFromMagnifier: first.top - magnifier.top,
        leftOfRail: first.right <= magnifier.left,
        gutter: magnifier.left - first.right,
        belowMoreButton: first.top - more.bottom,
        overflow: lowest - map.bottom,
      };
    });
  };

  const windowed = await readDrawer();
  // Une seule colonne verticale de trois boutons…
  expect.soft(windowed.cols).toBe(1);
  expect.soft(windowed.rows).toBe(3);
  // …à gauche du rail, avec la gouttière habituelle…
  expect.soft(windowed.leftOfRail).toBe(true);
  expect.soft(windowed.gutter).toBe(8);
  // …et démarrant exactement au niveau de la loupe, le premier FAB du rail.
  expect.soft(windowed.offsetFromMagnifier).toBe(0);
  // La barre ne déborde plus sous la carte (+26 px avant correctif).
  expect.soft(windowed.overflow).toBeLessThan(0);

  await page.locator('#plan_btn_more').click({ force: true });
  await page.waitForTimeout(150);
  await page.locator('#plan_btn_fullscreen').click({ force: true });
  await page.waitForTimeout(900);

  // Plein écran : comportement d'origine, empilé sous le bouton « Plus ».
  const fullscreen = await readDrawer();
  expect.soft(fullscreen.cols).toBe(1);
  expect.soft(fullscreen.rows).toBe(3);
  expect.soft(fullscreen.belowMoreButton).toBe(8);
  expect.soft(fullscreen.offsetFromMagnifier).toBeGreaterThan(0);
});

// ============================================================================
// Traces GPX : horodatage, groupement par jour, actions groupées et timelapse.
// Le rejeu dépend de WebGL et de `line-gradient` : rien de tout cela n'existe
// sous jsdom, c'est le seul endroit où il est vérifié pour de vrai.
// ============================================================================

test('traces GPX — groupement par jour, actions groupées et timelapse', async ({ page }) => {
  const openGpxPanel = async (): Promise<void> => {
    const open = await page.locator('#plan_gpx_panel').evaluate((el) => el.classList.contains('open'));
    if (open) return;
    await page.locator('#plan_btn_more').click();
    await page.waitForTimeout(250);
    await page.locator('#plan_btn_gpx').click();
    await page.waitForTimeout(350);
  };
  const featureCount = (): Promise<number> => page.evaluate(() => {
    const src = (window as unknown as { PlanMap?: { map?: { getSource(id: string): unknown } } })
      .PlanMap?.map?.getSource('plan-gpx-src') as { _data?: { features?: unknown[] } } | undefined;
    return src?._data?.features?.length ?? -1;
  });
  const playLayers = (): Promise<string[]> => page.evaluate(() => {
    const map = (window as unknown as { PlanMap: { map: { getStyle(): { layers: Array<{ id: string }> } } } }).PlanMap.map;
    return map.getStyle().layers.map((l) => l.id).filter((id) => id.startsWith('plan-gpx-play-'));
  });

  await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // La barre de lecture ne doit PAS être visible avant toute lecture : une
  // règle d'auteur `display: flex` sur un identifiant bat le `[hidden]` du
  // navigateur, il faut la neutraliser explicitement.
  await expect.soft(page.locator('#plan_gpx_player')).toBeHidden();

  await page.evaluate(() => { (window as unknown as { UI?: { switchMainView?: (v: string) => void } }).UI?.switchMainView?.('view-plan'); });
  await page.waitForTimeout(2500);
  await openGpxPanel();

  // Deux traces du MÊME engagement, qui se chevauchent dans le temps.
  await page.locator('#plan_gpx_file').setInputFiles([
    'tests/e2e/fixtures/reconnaissance-sud.gpx',
    'tests/e2e/fixtures/appui-sud.gpx',
  ]);
  await page.waitForTimeout(1500);

  await expect.soft(page.locator('.plan-gpx-row')).toHaveCount(2);
  // Même jour opérationnel : un seul groupe.
  await expect.soft(page.locator('.plan-gpx-group')).toHaveCount(1);
  await expect.soft(page.locator('.plan-gpx-hour')).toHaveCount(2);

  // L'horodatage lu dans le fichier est bien persisté dans l'index.
  const index = await page.evaluate(() => JSON.parse(localStorage.getItem('pcTacGpxIndex') ?? '[]') as Array<{ startedAt?: number }>);
  expect.soft(typeof index[0]?.startedAt).toBe('number');

  // Tout masquer, puis tout réafficher.
  await page.locator('#plan_gpx_all').click();
  await page.waitForTimeout(400);
  expect.soft(await featureCount()).toBe(0);
  await page.locator('#plan_gpx_all').click();
  await page.waitForTimeout(400);
  expect.soft(await featureCount()).toBe(2);

  // Sous-menu transitoire de couleur.
  await page.locator('#plan_gpx_color').click();
  await page.waitForTimeout(400);
  await expect.soft(page.locator('.plan-inline-panel [data-act="byday"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- Timelapse ---
  await openGpxPanel();
  await page.locator('#plan_gpx_play').click();
  await page.waitForTimeout(600);

  await expect.soft(page.locator('#plan_gpx_player')).toBeVisible();
  // Une couche par trace : le dégradé écrase line-color et refuse les
  // expressions pilotées par la donnée, la couleur vit donc dans l'expression.
  const layers = await playLayers();
  expect.soft(layers).toHaveLength(2);
  // L'affichage normal est masqué le temps du rejeu, pour la même raison.
  expect.soft(await page.evaluate(() => (window as unknown as { PlanMap: { map: { getLayoutProperty(l: string, p: string): unknown } } })
    .PlanMap.map.getLayoutProperty('plan-gpx-line', 'visibility'))).toBe('none');
  await expect.soft(page.locator('#plan_gpx_mode')).toHaveText('Temps réel');
  await expect.soft(page.locator('.plan-gpx-head-marker')).toHaveCount(2);

  const gradients = (): Promise<string[]> => page.evaluate((ids: string[]) => ids.map((id) =>
    JSON.stringify((window as unknown as { PlanMap: { map: { getPaintProperty(l: string, p: string): unknown } } })
      .PlanMap.map.getPaintProperty(id, 'line-gradient'))), layers);

  const before = await gradients();
  const clockBefore = await page.locator('#plan_gpx_clock').textContent();
  await page.waitForTimeout(2500);
  const after = await gradients();
  const clockAfter = await page.locator('#plan_gpx_clock').textContent();

  // Les deux traces se chevauchant, les deux dégradés doivent progresser.
  expect.soft(before.every((g, i) => g !== after[i])).toBe(true);
  expect.soft(clockBefore).not.toBe(clockAfter);

  // Faire glisser le curseur met la lecture en pause.
  await page.locator('#plan_gpx_seek').fill('900');
  await page.waitForTimeout(400);
  await expect.soft(page.locator('#plan_gpx_playpause .material-symbols-outlined')).toHaveText('play_arrow');

  // Bascule vers la progression normalisée : l'horloge devient un pourcentage.
  await page.locator('#plan_gpx_mode').click();
  await page.waitForTimeout(400);
  await expect.soft(page.locator('#plan_gpx_mode')).toHaveText('Progression');
  await expect.soft(page.locator('#plan_gpx_clock')).toContainText('%');

  // L'arrêt démonte tout et rend l'affichage normal.
  await page.locator('#plan_gpx_close').click();
  await page.waitForTimeout(600);
  await expect.soft(page.locator('#plan_gpx_player')).toBeHidden();
  expect.soft(await playLayers()).toHaveLength(0);
  await expect.soft(page.locator('.plan-gpx-head-marker')).toHaveCount(0);
  expect.soft(await page.evaluate(() => (window as unknown as { PlanMap: { map: { getLayoutProperty(l: string, p: string): unknown } } })
    .PlanMap.map.getLayoutProperty('plan-gpx-line', 'visibility'))).toBe('visible');
});

// ============================================================================
// Main courante en cartes (décision 22) : téléphone et écran scindé ; le
// bureau standard garde le tableau. Rendu seulement (jsdom n'a pas de mise en
// page) : on lit l'affichage calculé d'une ligne.
// ============================================================================

test('main courante : cartes en écran scindé, tableau en bureau standard', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium-mobile', 'écran scindé réservé au bureau (viewport posé ici)');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('pcTacLogData', JSON.stringify([
      { id: '1', timestamp: Date.now(), heure: '14:32', pax: 'Otage', lieu: 'Pavillon 3', remarques: 'Contact établi.' },
    ]));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const rowDisplay = (): Promise<string> => page.evaluate(() => {
    const row = document.querySelector('#logTable tbody tr:not(.log-day-sep)');
    return row ? getComputedStyle(row).display : 'absente';
  });
  await expect.poll(rowDisplay).toBe('table-row');

  await page.locator('#dockToggleBtn').click();
  await page.locator('#splitViewDockBtn').click();
  await page.locator('.split-pane-select').first().selectOption('view-main-courante');
  await expect.poll(rowDisplay).toBe('grid');
  const hScroll = await page.evaluate(() => {
    const c = document.getElementById('logTableContainer')!;
    return c.scrollWidth > c.clientWidth;
  });
  expect(hScroll).toBe(false);

  await page.keyboard.press('Escape');
  await expect.poll(rowDisplay).toBe('table-row');
});

// ============================================================================
// Fiche dans la page (décisions 21 et 23) : liste vide, la fiche prend toute
// la largeur ; dès la première fiche enregistrée, liste à gauche, fiche à
// droite.
// ============================================================================

test('fiche sur bureau : pleine largeur sans fiche, deux colonnes ensuite', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium-mobile', 'fiche plein écran sur téléphone');
  await page.goto('/pctac/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('pcTacAdversaries', '[]'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await clickTab(page, 'view-adversaires');
  await page.locator('[data-fiche-new="adv"]').click();
  const widths = (): Promise<{ fiche: number; layout: number; list: number }> => page.evaluate(() => {
    const w = (sel: string): number => Math.round(document.querySelector(sel)!.getBoundingClientRect().width);
    return { fiche: w('#ficheSheet'), layout: w('#view-adversaires .fiche-layout'), list: w('#adversary-table-body') };
  });
  await expect.poll(async () => (await widths()).fiche).toBe((await widths()).layout);
  expect((await widths()).list).toBe(0);

  await page.locator('#fiche_nom').fill('DUPONT');
  await page.locator('#ficheSheet .fiche-save-next').click();
  await expect(page.locator('#adversary-table-body .fiche-card')).toHaveCount(1);
  const two = await widths();
  expect(two.list).toBeGreaterThan(200);
  expect(two.fiche).toBeLessThan(two.layout - two.list);
});

// ============================================================================
// Thème clair : un champ qui prend le focus garde son fond clair (le voile
// noir à 50 % du thème sombre rendait le texte illisible, en plein soleil).
// ============================================================================
test('thème clair : le champ actif reste lisible (fond clair au focus)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await gotoPctac(page);
  const field = page.locator('#remarques_input');
  await field.focus();
  await page.waitForTimeout(500); // fin de la transition de fond
  const bg = await field.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Canal rouge du fond (rgb ou rgba) : clair = au-dessus de 200.
  const red = Number(/\d+/.exec(bg)?.[0]);
  const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(bg)?.[1] ?? 1);
  expect(red >= 200 || alpha < 0.2, `fond du champ actif en thème clair : ${bg}`).toBe(true);
});

// ============================================================================
// Téléphone : la barre de la mesure (Point, Annuler dernier, Terminer,
// Quitter) tient dans la carte ; centrée sans retour à la ligne, elle
// débordait des deux côtés (« Point » et « Quitter » coupés).
// ============================================================================
test('mesure sur téléphone : tous les boutons de la barre restent dans l’écran', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPctac(page);
  await clickTab(page, 'view-plan');
  await waitForPlanMapReady(page);
  await page.locator('#plan_btn_draw').click();
  await page.locator('.plan-draw-btn[data-tool="measure"]').click();
  const map = await page.locator('#plan_map').boundingBox();
  if (!map) throw new Error('carte sans boîte');
  await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
  const buttons = page.locator('#plan_measure_controls button:visible');
  await expect(buttons.first()).toBeVisible();
  for (const b of await buttons.all()) {
    const r = await b.boundingBox();
    if (!r) continue;
    expect.soft(r.x, `bouton « ${await b.innerText()} » coupé à gauche`).toBeGreaterThanOrEqual(0);
    expect.soft(r.x + r.width, `bouton « ${await b.innerText()} » coupé à droite`).toBeLessThanOrEqual(390);
  }
});

// ============================================================================
// Portail (destination du bouton « maison » du dock), téléphone 390×844 :
// les deux applications se voient sans défiler et le bouton de thème est
// une cible tactile de 44 px.
// ============================================================================
test('portail sur téléphone : deux applications à l’écran, thème à 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const toggle = await page.locator('#theme-toggle').boundingBox();
  expect.soft(toggle?.height ?? 0, 'hauteur du bouton de thème').toBeGreaterThanOrEqual(44);
  const cards = page.locator('.app-card');
  await expect(cards).toHaveCount(2);
  const second = await cards.nth(1).boundingBox();
  // Le titre de la seconde carte (OI) doit être visible sans défiler.
  const title = await cards.nth(1).locator('.app-card__title').boundingBox();
  expect.soft(second, 'seconde carte').not.toBeNull();
  expect.soft((title?.y ?? 9999) + (title?.height ?? 0), 'titre OI sous la ligne de flottaison').toBeLessThanOrEqual(844);
});

// ============================================================================
// Journal sur tablette et bureau : la case PAX est une pastille (marge
// intérieure, coins arrondis), pas un surlignage collé au texte.
// ============================================================================
test('journal large : la case PAX est une pastille', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoPctac(page);
  await page.locator('.pax-select-option[data-pax="Adversaire"]').click();
  await page.fill('#remarques_input', 'Pastille');
  await page.click('#addLogBtn');
  const cell = page.locator('#logTable .pax-cell').first();
  await expect(cell).toBeVisible();
  const st = await cell.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { pad: parseFloat(cs.paddingLeft), radius: parseFloat(cs.borderTopLeftRadius) };
  });
  expect.soft(st.pad, 'marge intérieure').toBeGreaterThanOrEqual(6);
  expect.soft(st.radius, 'coins arrondis').toBeGreaterThanOrEqual(6);
});

// ============================================================================
// Photos : les filtres de catégorie sont des cibles tactiles de 44 px
// (26 px mesurés sur téléphone).
// ============================================================================
test('photos : filtres de catégorie à 44 px', async ({ page }) => {
  await gotoPctac(page);
  await clickTab(page, 'view-photos');
  const filters = page.locator('#photo-filter-container button');
  await expect(filters.first()).toBeVisible();
  for (const f of await filters.all()) {
    const r = await f.boundingBox();
    expect.soft(r?.height ?? 0, `filtre « ${await f.innerText()} »`).toBeGreaterThanOrEqual(44);
  }
});

// Photos : le formulaire dit ce qu'il fait (« Dashboard Opération »,
// jargon anglais, ne disait pas qu'on ajoute une photo).
test('photos : le titre du formulaire est « Ajouter une photo »', async ({ page }) => {
  await gotoPctac(page);
  await clickTab(page, 'view-photos');
  await expect(page.locator('#view-photos h3').first()).toHaveText(/Ajouter une photo/);
});

test('téléphone : champs de saisie et boutons « Ajouter » d\'au moins 44 px (mesuré : 41 et 37 px)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'cibles tactiles du téléphone');
  await gotoPctac(page);
  const small: string[] = [];
  for (const viewId of ['view-main-courante', 'view-adversaires', 'view-otages', 'view-amis', 'view-photos']) {
    await clickTab(page, viewId);
    await expect(page.locator(`#${viewId}`)).toHaveClass(/active/);
    small.push(...await page.locator(`#${viewId}`).evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('input, select, .add-btn')).flatMap((el) => {
        if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(el.type)) return [];
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).visibility === 'hidden') return [];
        return r.height < 43.5 ? [`${root.id} ${el.id || el.className} ${Math.round(r.height)}px`] : [];
      })));
  }
  expect(small).toEqual([]);
});

test('bureau : les options du sélecteur de situation font 44 px (mesuré : 34 px)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'sur téléphone, liste native');
  await gotoPctac(page);
  const heights = await page.locator('.mode-selector-option').evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});
