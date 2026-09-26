import { test, expect, type Download, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * P3B.E — Tests E2E fonctionnels Générateur d'OI, contre
 * http://127.0.0.1:9678/oi/. À côté de tests/e2e/pctac.spec.ts dont ce
 * fichier reprend le style, les helpers et les conventions à l'identique.
 *
 * Source des critères : checklist fonctionnelle de non-régression du
 * Générateur d'OI (le brief de cette tâche référence un
 * « §8 » ; §8 du document est en réalité « Autres éléments de GStart-main —
 * porter ou ignorer », §9 est la checklist point par point — voir
 * draft-oi-spec-notes.md §0). Un `test()` par grande rubrique, chaque
 * sous-point est une `step()` (même helper que pctac.spec.ts : enveloppe
 * `test.step` + try/catch + `expect.soft`, une exception dans une étape ne
 * bloque pas les étapes suivantes du même test).
 *
 * ÉTAT AU MOMENT DU DÉPÔT (P3B.E, après P3B.C — commit aa1f10f) :
 * `src/apps/oi/main.ts` câble désormais les 18 étapes du `DOMContentLoaded`
 * (SPEC-OI-CONVERSION.md §12.3) et la délégation `data-action` (3 listeners
 * délégués click/input/change). Les 9 `TODO-CABLAGE` du brouillon ont été
 * résolus par lecture directe du code câblé réel (`formulaires.ts`,
 * `patrac.ts`, `carto/*.ts`, `main.ts`) — voir le commentaire à chaque site
 * ci-dessous pour la source exacte. Contrairement à PC-Tac, l'original
 * (`4.html`) utilise massivement `prompt()` natif (pas de modale custom) pour
 * la création VL/PAX/cellule PATRACDVR (`addManualVehicle`, `addManualMember`,
 * `addCellBatch`) — voir le helper `withPrompt()` ci-dessous, spécifique à ce
 * fichier (pctac.spec.ts n'a besoin que d'auto-accepter des `confirm()`).
 * 26 noms de fonctions restent posés sur `window` (résidu des
 * `onclick`/`oninput` inline générés dynamiquement par `formulaires.ts`/
 * `patrac.ts`, SPEC-CONTRATS.md §3.13 : `goToStep`, `addAdversary`,
 * `addTimeEvent`, `addHypothesis`, `openAnnotationModal`, `removeImage`,
 * `handleFileChange`, `renameVehicle`, `syncDomToStore`, `setPdfFormat`,
 * `openLogs`, etc.) — ce résidu est un choix de portage assumé (SPEC-OI-
 * CONVERSION.md §12.4), pas un défaut de câblage : ces `onclick` inline
 * fonctionnent normalement dès lors que `window.<fn>` est posé par le module
 * correspondant au chargement, indépendamment de `main.ts`.
 */

/**
 * R (P3B.E) — construit un fixture `.oi.zip` minimal mais réaliste, au format
 * strictement produit par `exportArchive()` (formulaires.ts:1225-1300) :
 * `manifest.json` (`{appName:'OI', version, createdAt, imageCount}`) +
 * `data.json` (objet dont la SEULE clé `tactical_oi_data` — `OI_ARCHIVE_KEYS`,
 * formulaires.ts:1219 — porte la chaîne JSON brute de `Store.state.formData`,
 * PAS un objet imbriqué) + `images.json` (vide ici, aucune image). Même
 * patron que `buildPctacZipFixture()` de `pctac.spec.ts`. `adversaries` est
 * la clé attendue par la catégorie « Adversaires » de `detectImportCategories`
 * (formulaires.ts:1415) : au moins 1 entrée non vide est nécessaire pour que
 * cette catégorie apparaisse dans `#importSelectList`.
 */
async function buildOiZipFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify({ appName: 'OI', version: 1, createdAt: new Date().toISOString(), imageCount: 0 }),
  );
  const oiData = {
    situation_generale: 'Import catégoriel E2E',
    adversaries: [{ id: 'e2e_adv1', nom_adversaire: 'ADV IMPORT E2E' }],
  };
  zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify(oiData) }));
  zip.file('images.json', JSON.stringify({}));
  return zip.generateAsync({ type: 'nodebuffer' });
}

const WIZARD_STEPS = 8;

/**
 * PNG 200×150 gris uni (généré via `pngjs`, hors périmètre applicatif), pour
 * le SEUL test qui a besoin d'une image de taille non triviale : l'annotation
 * canvas (`AnnotationEngine`, dessin.ts) dimensionne `#annotationCanvas` sur
 * les dimensions NATURELLES de l'image chargée — le PNG 1×1 réutilisé
 * partout ailleurs dans ce fichier (upload « juste besoin d'un fichier
 * valide ») produit un canvas de 1×1 px, sur lequel AUCUN tracé de taille
 * significative n'est possible (constaté : `Store.state.annotations` reste
 * `[]` après un drag complet, pas une exception — défaut de test, pas une
 * régression de `dessin.ts`).
 */
const LARGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAACWCAYAAACb3McZAAABbUlEQVR4Ae3BAQGAAAwCMKR/sLfSAtJg23N3b4BfDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTA1wNQAUwNMDTB9u1QEg6QVrgMAAAAASUVORK5CYII=';

async function gotoOi(page: Page): Promise<void> {
  await page.goto('/oi/');
  await page.waitForLoadState('domcontentloaded');
}

async function goToStepViaBullet(page: Page, n: number): Promise<void> {
  await page.locator('.wizard-progress-step').nth(n).click();
}

/**
 * Corrigé (défaut de test, reproduit AUSSI contre l'ORIGINAL 4.html sur
 * :9679 — donc pas une régression du portage) : à l'arrivée sur l'étape 8,
 * le contrôle de cohérence (`Navigation — contrôle de cohérence…`) peuple
 * `#coherence_alerts_container` de façon asynchrone, ce qui déplace
 * `#previewBtn` sous le point de clic pendant une fenêtre de quelques
 * centaines de ms — sous le budget `actionTimeout: 2000` de
 * `playwright.config.ts`, un `.click()` immédiat échoue par instabilité
 * d'élément puis, une fois stable, se heurte parfois transitoirement à
 * `#dockMenu` (fixed) pendant le scroll-into-view. Laisser le layout se
 * stabiliser avant de cliquer, même précédent que `Plan — dessin` de
 * `pctac.spec.ts` (attente après changement de vue).
 */
async function goToFinalStepAndOpenPreview(page: Page): Promise<void> {
  await goToStepViaBullet(page, 7);
  await page.locator('#previewBtn').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await page.locator('#previewBtn').click();
  // U6 : un OI incomplet (celui des tests) demande d'abord « Incohérences
  // détectées — Générer quand même ? » ; on génère quand même.
  const generateAnyway = page.locator('[data-tac-confirm="ok"]');
  await generateAnyway.or(page.locator('#presentationModal[open]')).first().waitFor();
  if (await generateAnyway.isVisible()) await generateAnyway.click();
}

/**
 * Enveloppe une étape de checklist : capture toute exception en échec `soft`
 * au lieu de laisser l'exception interrompre les étapes suivantes du même
 * test. Copie conforme de tests/e2e/pctac.spec.ts (même sémantique, même
 * message de diagnostic — adapté « P3.C » au lieu de « P2.D »).
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
          `Étape « ${name} » interrompue par une exception (probable élément non interactif faute de câblage P3.C) : ${msg}`
        )
        .toBe(true);
    }
  });
}

/**
 * Saisie demandée par l'appli (création VL, PAX, cellule en lot…). U25 : les
 * `prompt()` natifs sont devenus `promptDialog()` (`src/shared/feedback.ts`,
 * `<dialog class="tac-confirm-dialog">` avec un champ) : `page.on('dialog')`
 * ne les voit plus. L'action ouvre la fenêtre ; on y tape la valeur, « Valider »,
 * et la fenêtre doit disparaître. (Pas Entrée : elle rouvre aujourd'hui la
 * fenêtre, le bouton déclencheur reprenant le focus — défaut de feedback.ts
 * relevé par l'atelier UI-2.)
 */
async function withPrompt(page: Page, value: string, action: () => Promise<unknown>): Promise<void> {
  await action();
  const input = page.locator('dialog.tac-confirm-dialog .tac-confirm-input');
  await input.fill(value);
  await page.locator('dialog.tac-confirm-dialog .tac-confirm-btn--ok').click();
  await expect(input).toHaveCount(0);
}

/**
 * R2-T2b : les `confirm()`/`alert()` natifs d'OI sont remplacés par
 * `confirmDialog()`/`toast()` (`src/shared/feedback.ts`, `<dialog>` HTML
 * injecté, PAS un dialogue navigateur natif) — `page.on('dialog')` (handler
 * `beforeEach` ci-dessous) ne les intercepte donc plus (cette API Playwright
 * ne couvre QUE les vrais `alert()`/`confirm()`/`prompt()`/`beforeunload` du
 * moteur ; les saisies passent par `withPrompt()` ci-dessus).
 * Chaque site d'appel qui ouvrait un `confirm()` bloquant est désormais
 * cliqué explicitement via ce sélecteur stable (`data-tac-confirm="ok"`, posé
 * par `confirmDialog()`) — même helper que `tests/e2e/pctac.spec.ts`.
 */
async function clickConfirmDialogOk(page: Page): Promise<void> {
  await page.locator('[data-tac-confirm="ok"]').click();
}

// R4-a (D2, « une seule voie d'output PDF ») : `channel: 'chromium'` FORCE le
// binaire Chromium COMPLET (celui que Playwright installe à côté du
// « headless shell » minimal utilisé par défaut en mode headless depuis
// Playwright ≥1.49). Constaté : le « headless shell » par défaut n'embarque
// AUCUN visualiseur PDF (`navigator.pdfViewerEnabled === false`), alors que
// la quasi-totalité des navigateurs RÉELS (desktop Chrome/Firefox/Safari en
// sont pourvus) l'ont — la divergence est un artefact de l'infra de test, pas
// un cas réel. Conséquence observée SANS ce réglage : naviguer un `<iframe>`
// (aperçu) OU `window.open()` (présentation) vers un blob `application/pdf`
// déclenche en coulisses une tentative de TÉLÉCHARGEMENT fantôme (repli du
// moteur de rendu faute de visualiseur), qui peut ENTRER EN COLLISION avec un
// téléchargement légitime survenant peu après (`#downloadPdfBtn`) et lui faire
// perdre son nom de fichier (`suggestedFilename()` retombe sur un UUID
// aléatoire généré par Chromium plutôt que l'attribut `download` du lien) —
// reproduit de façon déterministe SANS ce réglage, disparaît AVEC. Portée
// limitée à CE fichier (pas de `channel` dans `playwright.config.ts`,
// `pctac.spec.ts` non affecté).
test.use({ launchOptions: { channel: 'chromium' } });

test.describe('OI — Checklist fonctionnelle', () => {
  test.beforeEach(async ({ page }) => {
    // Dialogue NATIF résiduel (aucun attendu depuis U25) : accepté sans texte.
    page.on('dialog', (dialog) => void dialog.accept());
    await gotoOi(page);
  });

  // ------------------------------------------------------------------
  // Navigation / wizard
  // ------------------------------------------------------------------
  test('Navigation — 8 étapes accessibles (puces cliquables + Précédent/Suivant)', async ({ page }) => {
    await step('8 puces + 8 wizard-step existent (structurel, indépendant du câblage)', async () => {
      await expect.soft(page.locator('.wizard-progress-step')).toHaveCount(WIZARD_STEPS);
      await expect.soft(page.locator('.wizard-step')).toHaveCount(WIZARD_STEPS);
      await expect.soft(page.locator('.wizard-step').first()).toHaveClass(/active|oi-grid/);
    });

    // TODO-CABLAGE : `goToStep` fait partie du résidu window des 26 noms
    // (SPEC-CONTRATS §3.13), mais dépend de `oiState.steps`/`progressSteps`
    // peuplés à l'étape 4 du DOMContentLoaded (SPEC-OI-CONVERSION §12.3),
    // non exécuté tant que P3.C n'a pas eu lieu — donc non fiable avant.
    for (let n = 1; n < WIZARD_STEPS; n++) {
      await step(`clic sur la puce ${n + 1} active l'étape correspondante`, async () => {
        await goToStepViaBullet(page, n);
        await expect.soft(page.locator('.wizard-step').nth(n)).toHaveClass(/active/, { timeout: 1500 });
        await expect.soft(page.locator('.wizard-progress-step').nth(n)).toHaveClass(/active/, { timeout: 1500 });
      });
    }

    await step('Suivant/Précédent avancent et reculent d\'une étape', async () => {
      await goToStepViaBullet(page, 0);
      await page.locator('#nextBtn').click();
      await expect.soft(page.locator('.wizard-step').nth(1)).toHaveClass(/active/, { timeout: 1500 });
      await page.locator('#prevBtn').click();
      await expect.soft(page.locator('.wizard-step').nth(0)).toHaveClass(/active/, { timeout: 1500 });
    });

    await step('#prevBtn masqué à l\'étape 0, #nextBtn masqué à la dernière étape (navigation.js:16-19)', async () => {
      await goToStepViaBullet(page, 0);
      await expect.soft(page.locator('#prevBtn')).toBeHidden({ timeout: 1500 });
      await goToStepViaBullet(page, WIZARD_STEPS - 1);
      await expect.soft(page.locator('#nextBtn')).toBeHidden({ timeout: 1500 });
      await expect.soft(page.locator('#previewBtn')).toBeVisible({ timeout: 1500 });
    });

    await step('navigation clavier (Entrée) sur une puce + rôle tab (a11y T13, navigation.js/4.html:4553-4570)', async () => {
      const first = page.locator('.wizard-progress-step').first();
      await expect.soft(first).toHaveAttribute('role', 'tab');
      const third = page.locator('.wizard-progress-step').nth(2);
      await third.focus();
      await page.keyboard.press('Enter');
      await expect.soft(page.locator('.wizard-step').nth(2)).toHaveClass(/active/, { timeout: 1500 });
    });
  });

  test('Navigation — étape et étapes visitées persistées après rechargement (oiWizardStep/oiVisitedSteps)', async ({ page }) => {
    // U17 : « complétée » = visitée ET sans incohérence. L'Environnement (index
    // 2) n'en a aucune à vide ; la Situation vide (date manquante) jamais.
    await step('visiter les étapes 3 puis 4 (index 2, 3) puis recharger', async () => {
      await goToStepViaBullet(page, 2);
      await goToStepViaBullet(page, 3);
      await expect.soft(page.locator('.wizard-step').nth(3)).toHaveClass(/active/, { timeout: 1500 });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect.soft(page.locator('.wizard-step').nth(3)).toHaveClass(/active/, { timeout: 1500 });
    });
    await step('les puces déjà visitées portent la classe completed (navigation.ts, U17)', async () => {
      await expect.soft(page.locator('.wizard-progress-step').nth(2)).toHaveClass(/completed/, { timeout: 1500 });
    });
  });

  test('Navigation — contrôle de cohérence déclenché automatiquement à la dernière étape', async ({ page }) => {
    await step('atteindre l\'étape 8 (Finalisation) sans rien saisir : alertes de champs manquants', async () => {
      await goToStepViaBullet(page, WIZARD_STEPS - 1);
      await expect
        .soft(page.locator('#coherence_alerts_container .coherence-alert'))
        .not.toHaveCount(0, { timeout: 1500 });
      await expect
        .soft(page.locator('#coherence_alerts_container'))
        .toContainText("Date de l'opération est manquante", { timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // Étapes 1/3/4 — champs texte simples + persistance après rechargement
  // ------------------------------------------------------------------
  const SIMPLE_TEXT_FIELDS: Array<{ step: number; id: string; value: string; tag?: 'input' | 'textarea' }> = [
    { step: 0, id: 'date_op', value: '2026-08-01' },
    { step: 0, id: 'situation_generale', value: 'Situation générale E2E', tag: 'textarea' },
    { step: 0, id: 'situation_particuliere', value: 'Situation particulière E2E', tag: 'textarea' },
    { step: 2, id: 'amies', value: 'Unité Amie E2E' },
    { step: 2, id: 'terrain_info', value: 'Terrain E2E' },
    { step: 2, id: 'eclairage', value: 'Nuit E2E' },
    { step: 2, id: 'population', value: 'Population E2E' },
    { step: 2, id: 'faune_animaux', value: 'Faune E2E' },
    { step: 2, id: 'cadre_juridique', value: 'CPP E2E' },
    { step: 3, id: 'missions_psig', value: 'Mission E2E modifiée', tag: 'textarea' },
  ];

  test('Étapes 1/3/4 — Situation/Environnement/Mission : saisie + persistance après rechargement', async ({ page }) => {
    for (const f of SIMPLE_TEXT_FIELDS) {
      await step(`remplir #${f.id} (étape ${f.step + 1})`, async () => {
        await goToStepViaBullet(page, f.step);
        await page.locator(`#${f.id}`).fill(f.value);
        // syncDomToStore est débouncée (500 ms, formulaires.js:386-393) : on
        // laisse passer la fenêtre avant de vérifier le flush localStorage.
        await page.waitForTimeout(700);
      });
    }
    await step('rechargement : toutes les valeurs sont restaurées', async () => {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      for (const f of SIMPLE_TEXT_FIELDS) {
        await goToStepViaBullet(page, f.step);
        await expect.soft(page.locator(`#${f.id}`)).toHaveValue(f.value, { timeout: 1500 });
      }
    });
  });

  // ------------------------------------------------------------------
  // Étape 2 — Adversaires
  // ------------------------------------------------------------------
  test('Adversaires — création, titre dynamique, section collapsible, moyens employés (max 3), suppression', async ({ page }) => {
    await goToStepViaBullet(page, 1);
    await step('création via #createAdversaryBtn (addAdversary, résidu window §3.13)', async () => {
      await page.locator('#createAdversaryBtn').click();
      await expect.soft(page.locator('#adversaries_container .adv-title')).toHaveCount(1, { timeout: 1500 });
    });

    await step('titre dynamique (updateAdvTitle) quand on saisit le nom', async () => {
      await page.locator('#adversaries_container input[data-field="nom_adversaire"]').first().fill('DUPONT E2E');
      await expect
        .soft(page.locator('#adversaries_container .adv-title').first())
        .toContainText('DUPONT E2E', { timeout: 1500 });
    });

    await step('section « Photos » collapsible : toggleAdvSection bascule aria-expanded', async () => {
      const toggle = page.locator('#adversaries_container .adv-section-toggle').first();
      const expandedBefore = await toggle.getAttribute('aria-expanded');
      await toggle.click();
      await expect
        .soft(toggle)
        .not.toHaveAttribute('aria-expanded', expandedBefore ?? 'true', { timeout: 1500 });
    });

    await step('Moyens employés : plafond de 3 en saisie interactive (formulaires.js:100)', async () => {
      // `.adv-section-body` anime son repli/dépli sur 0,38s
      // (`grid-template-rows`, styles/oi.css:1071) — l'étape précédente vient
      // de basculer la section « Photos » ; laisser le layout se stabiliser
      // avant de cliquer un bouton potentiellement déplacé par la transition
      // (flake constaté : « element not stable »).
      await page.waitForTimeout(450);
      const advBlock = page.locator('#adversaries_container > div').first();
      const addMeBtn = advBlock.locator('button', { hasText: 'Moyen employé' });
      for (let i = 0; i < 4; i++) await addMeBtn.click();
      await expect.soft(advBlock.locator('.me-input')).toHaveCount(3, { timeout: 1500 });
    });

    await step('suppression de la fiche adversaire (removeAdversary, résidu window, confirmDialog)', async () => {
      // Résolu (formulaires.ts:430) : bouton `.remove-btn` distingué des
      // autres (photos, ME, chronologie…) par son `title` unique posé par
      // `addAdversary` — `onclick="removeAdversary('${id}')"` appelle
      // désormais `confirmDialog()` (R2-T2b) — clic explicite requis.
      const removeBtn = page.locator('#adversaries_container .remove-btn[title="Supprimer cet adversaire"]').first();
      await removeBtn.click();
      await clickConfirmDialogOk(page);
      await expect.soft(page.locator('#adversaries_container .adv-title')).toHaveCount(0, { timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // Étape 5 — Exécution (chronologie, hypothèses, photos)
  // ------------------------------------------------------------------
  test('Exécution — chronologie (ajout/suppression), hypothèses (ajout/suppression), photos cheminement', async ({ page }) => {
    await goToStepViaBullet(page, 4);

    await step('date/heure H + corps de mission', async () => {
      await page.locator('#date_execution').fill('2026-08-01');
      await page.locator('#heure_execution').fill('06:30');
      await expect.soft(page.locator('#heure_execution')).toHaveValue('06:30');
    });

    await step('ajout d\'un événement de chronologie (addTimeEvent, résidu window)', async () => {
      await page.locator('#time_events_container').locator('..').locator('button', { hasText: 'Ajouter Événement' }).click();
      await expect.soft(page.locator('#time_events_container').locator(':scope > *')).not.toHaveCount(0, { timeout: 1500 });
    });

    await step('suppression du dernier événement créé', async () => {
      const before = await page.locator('#time_events_container').locator(':scope > *').count();
      await page.locator('#time_events_container').locator('.remove-btn').last().click();
      await expect
        .poll(() => page.locator('#time_events_container').locator(':scope > *').count(), { timeout: 1500 })
        .toBeLessThan(before);
    });

    await step('création d\'hypothèse (addHypothesis, résidu window)', async () => {
      await page.locator('button', { hasText: 'Créer Hypothèse' }).click();
      await expect.soft(page.locator('#hypotheses_container').locator(':scope > *')).not.toHaveCount(0, { timeout: 1500 });
    });

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await step('upload photo cheminement (Transport PSIG → PR) : compression + prévisualisation', async () => {
      await page.setInputFiles('#photo_container_transport_pr_input', {
        name: 'e2e.png',
        mimeType: 'image/png',
        buffer: Buffer.from(pngBase64, 'base64'),
      });
      await expect
        .soft(page.locator('#photo_container_transport_pr_preview_container .image-preview-item'))
        .toHaveCount(1, { timeout: 3000 });
    });
  });

  // ------------------------------------------------------------------
  // Étape 6 — Articulation MOICP/ZMSPCP/Effraction
  // ------------------------------------------------------------------
  test('Articulation — blocs MOICP/ZMSPCP/Effraction (création manuelle) + suppression', async ({ page }) => {
    await goToStepViaBullet(page, 5);
    await step('création MOICP/ZMSPCP/Effraction (addMoicp/addZmspcp/addEffraction, id-based addEventListener)', async () => {
      await page.locator('#addMoicpBtn').click();
      await expect.soft(page.locator('#moicp_container .moicp-block')).toHaveCount(1, { timeout: 1500 });
      await page.locator('#addZmspcpBtn').click();
      await expect.soft(page.locator('#zmspcp_container .articulation-block')).not.toHaveCount(0, { timeout: 1500 });
      await page.locator('#addEffractionBtn').click();
      await expect.soft(page.locator('#effraction_container').locator(':scope > *')).not.toHaveCount(0, { timeout: 1500 });
    });

    await step('un bloc MOICP créé manuellement est ouvert (state=open) et éditable', async () => {
      const block = page.locator('#moicp_container .moicp-block').first();
      await expect.soft(block).toHaveClass(/open/);
      await block.locator('.moicp-objectif').fill('Objectif E2E');
      await expect.soft(block.locator('.moicp-objectif')).toHaveValue('Objectif E2E');
    });

    await step('suppression d\'un bloc MOICP', async () => {
      await page.locator('#moicp_container .moicp-block').first().locator('.remove-btn').click();
      await expect.soft(page.locator('#moicp_container .moicp-block')).toHaveCount(0, { timeout: 1500 });
    });
  });

  // R7-like — DnD SOURIS natif des 3 listes réordonnables (rame VL, colonne
  // progression, ordre pénétration). Vérifié dans la source (articulation.js) :
  // `.rame-vl-chip`/`.order-chip` ont `draggable=true` + `dragstart`/`dragend`
  // (HTML5 DnD natif) pour la SOURIS ; `UIPlatform.sortable(container, {
  // pointerTypes: ['touch'] })` gère UNIQUEMENT le tactile en complément
  // (articulation.js:442-447, commentaire T6 explicite : « souris -> on laisse
  // le DnD HTML5 natif »). `locator.dragTo()` (comme le test « Main Courante —
  // réordonnancement » de pctac.spec.ts) est donc le bon outil ici, PAS des
  // `page.mouse.move/down/up` bruts (qui simulent Pointer Events, pas DnD).
  test('Articulation — rame VL réordonnable par glisser-déposer SOURIS (synchronisée depuis le PATRACDVR)', async ({ page }) => {
    await step('créer 2 VL dans le PATRACDVR (étape 7) pour peupler la rame VL (étape 6)', async () => {
      await goToStepViaBullet(page, 6);
      await withPrompt(page, 'VL-ALPHA', () => page.locator('#addManualVehicleBtn').click());
      await withPrompt(page, 'VL-BRAVO', () => page.locator('#addManualVehicleBtn').click());
      await expect.soft(page.locator('#patracdvr_container .patracdvr-vehicle-row')).toHaveCount(2, { timeout: 1500 });
    });
    await step('la rame VL (étape 6) se synchronise automatiquement (refreshRameVL, non destructif)', async () => {
      await goToStepViaBullet(page, 5);
      // Corrigé (défaut de test) : « Ordre de la rame VL » est un
      // `.collapsible-container` FERMÉ par défaut (`.collapsible-content`
      // reste `visibility:hidden`, oi/index.html:373-379 — même motif que
      // « Fond PDF Personnalisé » à l'étape 8, cf. commentaire du test
      // Finalisation) — `count()`/`toContainText()` fonctionnent sur un
      // élément invisible, mais `dragTo()` exige la visibilité : sans cette
      // ouverture, la seconde étape échouait par « element is not visible ».
      await page.locator('.collapsible-header', { hasText: 'Ordre de la rame VL' }).click();
      const chips = page.locator('#rame_vl_container .rame-vl-chip');
      await expect.soft(chips).toHaveCount(2, { timeout: 1500 });
      await expect.soft(chips.nth(0)).toContainText('VL-ALPHA');
      await expect.soft(chips.nth(1)).toContainText('VL-BRAVO');
      await expect.soft(chips.nth(1)).toBeVisible({ timeout: 1000 });
    });
    await step('glisser le 2e chip au-dessus du 1er (DnD HTML5 natif, souris)', async () => {
      const chips = page.locator('#rame_vl_container .rame-vl-chip');
      // `timeout` généreux (défaut `actionTimeout: 2000` trop juste pour un
      // DnD HTML5 natif complet, cf. commentaires ci-dessus) — même patron
      // que les téléchargements PDF de ce fichier (5000-8000ms).
      // Lâcher dans la moitié HAUTE du 1er (articulation.ts `_setupRameDropZone` :
      // insertion avant l'élément dont le milieu est sous le pointeur) ; le
      // centre exact (défaut de `dragTo`) tombe pile sur le milieu : rien ne bouge.
      // Défilement doux (oi.css `scroll-behavior: smooth`) : le point visé était
      // calculé en plein défilement (3 échecs sur 4). Mouvement réduit = défilement
      // immédiat (oi.css, media prefers-reduced-motion).
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await chips.nth(1).dragTo(chips.nth(0), { timeout: 4000, targetPosition: { x: 20, y: 4 } });
      await expect.soft(chips.nth(0)).toContainText('VL-BRAVO', { timeout: 1500 });
      await expect.soft(chips.nth(1)).toContainText('VL-ALPHA', { timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // Étape 7 — PATRACDVR (la plus riche fonctionnellement)
  // ------------------------------------------------------------------
  test('PATRACDVR — création VL/PAX manuels (prompt), cellule en lot, plafonds India(5)/AO(8)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await step('création VL manuel (prompt, addManualVehicle)', async () => {
      await withPrompt(page, 'KODIAQ-E2E', () => page.locator('#addManualVehicleBtn').click());
      await expect
        .soft(page.locator('.patracdvr-vehicle-row[data-vehicle-name="KODIAQ-E2E"]'))
        .toHaveCount(1, { timeout: 1500 });
    });
    await step('création PAX manuel (prompt, addManualMember) : trigramme 2-4 caractères', async () => {
      await withPrompt(page, 'ABC', () => page.locator('#addManualMemberBtn').click());
      await expect
        .soft(page.locator('#unassigned_members_container .patracdvr-member-btn[data-trigramme="ABC"]'))
        .toHaveCount(1, { timeout: 1500 });
    });
    await step('cellule India en lot (addCellBatch, ≥2 PAX, prompt liste de trigrammes)', async () => {
      // Résolu (patrac.ts:286-297) : `input.split(/[\s,;]+/)` — séparateurs
      // espace/virgule/point-virgule tous acceptés et interchangeables ;
      // "IND1, IND2" (virgule + espace) est donc une valeur valide confirmée.
      await withPrompt(page, 'IND1, IND2', () =>
        page.locator('.cell-batch-btn[data-cell="India"]').click()
      );
      await expect
        .soft(page.locator('.patracdvr-member-btn[data-cellule="India 1"]'))
        .not.toHaveCount(0, { timeout: 1500 });
    });
  });

  test('PATRACDVR — drag&drop souris (non-affectés → véhicule → poubelle avec confirmation)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'VECT-E2E', () => page.locator('#addManualVehicleBtn').click());
    await withPrompt(page, 'XYZ', () => page.locator('#addManualMemberBtn').click());
    // Corrigé (défaut de test, même nature que le commentaire de
    // « Articulation — rame VL réordonnable » ci-dessus) : un `dragTo()`
    // immédiatement après la création du PAX (juste avant, via prompt) n'a
    // pas le temps de se stabiliser sous `actionTimeout: 2000` — le `dragTo`
    // aboutit (pas d'exception) mais le drop n'est pas pris en compte.
    // P3B.FIX (reprise 1), BLOQUANT R2 : releve de 200 a 500ms - mesure
    // (playwright.config.ts workers=1) : ce test echoue encore parfois seul
    // dans la suite COMPLETE (130 tests), jamais isole. Meme nature que le
    // relevement des `waitForTimeout` de « Plan — dessin » (pctac.spec.ts) -
    // pas seulement de la contention inter-workers, mais un budget de
    // stabilisation DOM trop juste sous charge cumulee du serveur dev.
    await page.waitForTimeout(500);

    await step('glisser le PAX non-affecté vers le véhicule (drag.js, DnD HTML5 natif)', async () => {
      const member = page.locator('#unassigned_members_container .patracdvr-member-btn[data-trigramme="XYZ"]');
      const target = page.locator('.patracdvr-vehicle-row[data-vehicle-name="VECT-E2E"] .patracdvr-members-container');
      await member.dragTo(target, { timeout: 4000 });
      await expect
        .soft(page.locator('.patracdvr-vehicle-row[data-vehicle-name="VECT-E2E"] .patracdvr-member-btn[data-trigramme="XYZ"]'))
        .toHaveCount(1, { timeout: 1500 });
    });

    await step('glisser vers #trashCan supprime définitivement (confirmDialog, R2-T2b)', async () => {
      // Même défaut de test que le drag précédent (settle avant un dragTo
      // HTML5 natif juste après un DOM ré-affecté par le drop précédent).
      // P3B.FIX (reprise 1), BLOQUANT R2 : releve de 300 a 600ms, meme
      // justification que ci-dessus.
      await page.waitForTimeout(600);
      const member = page.locator('.patracdvr-member-btn[data-trigramme="XYZ"]');
      await member.dragTo(page.locator('#trashCan'), { timeout: 4000 });
      await clickConfirmDialogOk(page);
      await expect.soft(page.locator('.patracdvr-member-btn[data-trigramme="XYZ"]')).toHaveCount(0, { timeout: 1500 });
    });
  });

  test('PATRACDVR — panneau quick-edit (sélection PAX, couplage cellule↔fonction)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'QED', () => page.locator('#addManualMemberBtn').click());
    const member = page.locator('.patracdvr-member-btn[data-trigramme="QED"]');

    // Corrigé (défaut de test) : `addManualMember` (patrac.ts:267-271) appelle
    // DÉJÀ `handleMemberSelection({ target: newMemberBtn })` juste après la
    // création — le panneau quick-edit est donc OUVERT dès la création, PAS
    // à l'issue d'un premier clic explicite du test (le brouillon cliquait
    // une 2e fois sur un membre déjà sélectionné, ce qui BASCULE en fermeture
    // — patrac.ts:678-684 — d'où le panneau `hidden` observé).
    await step('le panneau quick-edit est ouvert dès la création (comportement de addManualMember)', async () => {
      await expect.soft(page.locator('#quickEditPanel')).toBeVisible({ timeout: 1500 });
      await expect.soft(page.locator('#selectedMemberTrigramme')).toHaveText('QED', { timeout: 1500 });
    });
    await step('reclic sur le même PAX déjà sélectionné BASCULE en fermeture (handleMemberSelection)', async () => {
      await member.click();
      await expect.soft(page.locator('#quickEditPanel')).toBeHidden({ timeout: 1500 });
    });
    await step('reclic ouvre à nouveau le panneau (populateQuickEditPanel)', async () => {
      await member.click();
      await expect.soft(page.locator('#quickEditPanel')).toBeVisible({ timeout: 1500 });
      await expect.soft(page.locator('#selectedMemberTrigramme')).toHaveText('QED', { timeout: 1500 });
    });
  });

  test('PATRACDVR — mode batch (sélection multiple, désaffectation en lot)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'BA1', () => page.locator('#addManualMemberBtn').click());
    await withPrompt(page, 'BA2', () => page.locator('#addManualMemberBtn').click());

    await step('activer le mode batch (togglePatracBatchMode, body.patrac-batch-mode)', async () => {
      await page.locator('#patracBatchToggleBtn').click();
      await expect.soft(page.locator('body')).toHaveClass(/patrac-batch-mode/, { timeout: 1500 });
      await expect.soft(page.locator('#patracBatchBar')).toBeVisible({ timeout: 1500 });
    });

    // Résolu (patrac.ts:663-676, handleMemberSelection) : MÊME listener
    // `click` que hors mode batch (posé une seule fois par membre à la
    // création, patrac.ts:374) — la branche `if (_patracBatchMode)` en tête
    // de fonction redirige vers `_patracBatchToggle` au lieu d'ouvrir le
    // quick-edit. Un simple `.click()` sur `.patracdvr-member-btn` est donc
    // bien le geste de sélection en mode batch, confirmé.
    await step('sélectionner 2 PAX incrémente le compteur du bandeau batch', async () => {
      await page.locator('.patracdvr-member-btn[data-trigramme="BA1"]').click();
      await page.locator('.patracdvr-member-btn[data-trigramme="BA2"]').click();
      await expect.soft(page.locator('#patracBatchCount')).not.toContainText('0 PAX', { timeout: 1500 });
    });

    await step('désaffecter la sélection (patracBatchUnassign)', async () => {
      await page.locator('#patracBatchUnassign').click();
      await expect
        .soft(page.locator('#unassigned_members_container .patracdvr-member-btn[data-trigramme="BA1"]'))
        .toHaveCount(1, { timeout: 1500 });
    });
  });

  test('PATRACDVR — menu contextuel (cloner/supprimer un membre)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'CTX', () => page.locator('#addManualMemberBtn').click());

    // Corrigé (défaut de test — bug de POSITIONNEMENT PRÉEXISTANT, vérifié
    // VERBATIM dans l'ORIGINAL, PAS une régression du portage : `4.html:4889`
    // + `modules/patrac.js:236-247` posent déjà `position:fixed` avec
    // `top/left = event.pageY/pageX` — coordonnées DOCUMENT, pas VIEWPORT,
    // pour un élément `fixed`). Le panneau PATRACDVR (étape 7) est assez long
    // pour nécessiter un scroll vertical avant d'atteindre `.patracdvr-member-btn`,
    // ce qui fait apparaître `#memberContextMenu` HORS du viewport (repro
    // confirmée aussi contre l'ORIGINAL sur :9679 avec les mêmes coordonnées).
    // Agrandir le viewport à la hauteur du document contourne le besoin de
    // scroll pour CE test, sans modifier le comportement testé.
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 1440, height: Math.min(scrollHeight + 50, 4000) });

    await step('clic droit ouvre #memberContextMenu (handleMemberContextMenu, patrac.js:221)', async () => {
      await page.locator('.patracdvr-member-btn[data-trigramme="CTX"]').click({ button: 'right' });
      await expect.soft(page.locator('#memberContextMenu')).toBeVisible({ timeout: 1500 });
    });
    await step('« Cloner » (window.cloneMemberFromContext, résidu window §3.13) crée un doublon', async () => {
      await page.locator('#memberContextMenu button', { hasText: 'Cloner' }).click();
      await expect.soft(page.locator('.patracdvr-member-btn[data-trigramme^="CTX"]')).toHaveCount(2, { timeout: 1500 });
    });
  });

  test('PATRACDVR — configuration d\'unité (uniteConfigModal édite memberConfig)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await step('ouverture (openUniteConfigModal, id-based addEventListener)', async () => {
      await page.locator('#openUniteConfigBtn').click();
      await expect.soft(page.locator('#uniteConfigModal')).toBeVisible({ timeout: 1500 });
      await expect.soft(page.locator('#unite_config_content textarea, #unite_config_content input')).not.toHaveCount(0, { timeout: 1500 });
    });
    await step('enregistrement (saveUniteConfig, id-based addEventListener)', async () => {
      await page.locator('#unite_config_saveBtn').click();
      await expect.soft(page.locator('#uniteConfigModal')).toBeHidden({ timeout: 1500 });
    });
  });

  test('PATRACDVR — génération PDF autonome (pdf-lib) déclenche un téléchargement', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'PDF', () => page.locator('#addManualMemberBtn').click());
    await step('#patracdvrPdfBtn → generatePatracdvrPdf() → download', async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await page.locator('#patracdvrPdfBtn').click();
      const download = await downloadPromise;
      expect.soft(download).not.toBeNull();
      if (download) expect.soft(download.suggestedFilename()).toMatch(/\.pdf$/);
    });
  });

  test('PATRACDVR — réinitialisation isolée du reste des données (resetPatracdvrUI, confirmDialog)', async ({ page }) => {
    await goToStepViaBullet(page, 0);
    await page.locator('#situation_generale').fill('Doit survivre au reset PATRAC');
    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'RST', () => page.locator('#addManualMemberBtn').click());

    await step('#resetPatracdvrBtn vide le PATRACDVR (confirmDialog, R2-T2b)', async () => {
      await page.locator('#resetPatracdvrBtn').click();
      await clickConfirmDialogOk(page);
      await expect.soft(page.locator('.patracdvr-member-btn[data-trigramme="RST"]')).toHaveCount(0, { timeout: 1500 });
    });
    await step('les autres étapes ne sont pas affectées (isolation du reset)', async () => {
      await goToStepViaBullet(page, 0);
      await expect.soft(page.locator('#situation_generale')).toHaveValue('Doit survivre au reset PATRAC');
    });
  });

  // ------------------------------------------------------------------
  // Étape 8 — Finalisation
  // ------------------------------------------------------------------
  test('Finalisation — fond PDF perso, rédacteur, CAT, alertes de cohérence', async ({ page }) => {
    await goToStepViaBullet(page, 7);
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    // Corrigé (défaut de test) : la section « Fond PDF Personnalisé »
    // (oi/index.html:572) est un `.collapsible-container` SANS classe `open`
    // par défaut (contrairement à la fiche adversaire créée `.open` à la
    // volée) — sa `.collapsible-content` reste `display:none` (délégation
    // §12.3 étape 11, main.ts:449-458) tant qu'on n'a pas cliqué son
    // `.collapsible-header`. Le brouillon uploadait directement dans
    // `#custom_bg_input` sans l'ouvrir : l'input est bien atteignable
    // (`setInputFiles` ne requiert pas la visibilité), mais l'`<img>` de
    // prévisualisation restait `hidden` et le bouton « Rétablir » inatteignable.
    await step('ouvrir la section « Fond PDF Personnalisé » (collapsible fermé par défaut)', async () => {
      await page.locator('.collapsible-header', { hasText: 'Fond PDF Personnalisé' }).click();
      // `#custom_bg_input` est `class="sr-only-input"` (toujours visuellement
      // masqué, déclenché via le bouton « Choisir Image », `data-action=
      // "trigger-file-input"`, oi/index.html:581-583) — la classe reste
      // hidden que le collapsible soit ouvert ou fermé (`setInputFiles` ne
      // requiert de toute façon pas la visibilité). C'est
      // `.collapsible-container.open` qui prouve l'ouverture réelle.
      await expect
        .soft(page.locator('.collapsible-container', { has: page.locator('#custom_bg_input') }))
        .toHaveClass(/open/, { timeout: 1000 });
    });

    await step('upload fond PDF personnalisé (handleCustomBackgroundChange, résidu window)', async () => {
      await page.setInputFiles('#custom_bg_input', {
        name: 'bg.png', mimeType: 'image/png', buffer: Buffer.from(pngBase64, 'base64'),
      });
      await expect.soft(page.locator('#custom_bg_preview_container').locator(':scope > *')).not.toHaveCount(0, { timeout: 2000 });
    });
    await step('suppression du fond perso (removeCustomBackground, résidu window)', async () => {
      // « Rétablir » seul est ambigu : chaque section retirée (décision 10) a le sien.
      await page.locator('[data-action="remove-custom-background"]').click();
      // Corrigé (défaut de test) : `updateCustomBgPreview()` (medias.ts:349-350)
      // ne VIDE PAS le conteneur en l'absence de fond perso — il y insère un
      // `<p>` de substitution (« Aucun fond personnalisé. Fond par défaut
      // actif. »). Le conteneur a donc TOUJOURS 1 enfant ; ce qui distingue
      // « supprimé » de « présent » est l'ABSENCE d'`<img>`, pas le décompte
      // brut d'enfants.
      await expect.soft(page.locator('#custom_bg_preview_container img')).toHaveCount(0, { timeout: 1500 });
      await expect
        .soft(page.locator('#custom_bg_preview_container'))
        .toContainText('Aucun fond personnalisé', { timeout: 1500 });
    });
    await step('infos rédacteur + CAT', async () => {
      await page.locator('#trigramme_redacteur').fill('ABC');
      await page.locator('#unite_redacteur').fill('PSIG E2E');
      await page.locator('#no_go').fill('Condition NO-GO E2E');
      await expect.soft(page.locator('#trigramme_redacteur')).toHaveValue('ABC');
    });
    await step('renseigner date_op + 1 adversaire fait disparaître ces 2 alertes de cohérence', async () => {
      await goToStepViaBullet(page, 0);
      await page.locator('#date_op').fill('2026-08-01');
      await goToStepViaBullet(page, 1);
      await page.locator('#createAdversaryBtn').click();
      await page.locator('#adversaries_container input[data-field="nom_adversaire"]').first().fill('CIBLE E2E');
      await goToStepViaBullet(page, 7);
      await expect
        .soft(page.locator('#coherence_alerts_container'))
        .not.toContainText("Date de l'opération est manquante", { timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // Cartographie OI (MapLibre)
  // ------------------------------------------------------------------
  test('Cartographie — ouverture/fermeture modale + toolbar 5 FABs + panneau Calques + tiroir « Plus »', async ({ page }) => {
    await step('ouverture (#cartographyBtn dock → OICarto.open, id-based addEventListener)', async () => {
      await page.locator('#cartographyBtn').click();
      await expect.soft(page.locator('#cartographyModal')).toBeVisible({ timeout: 2000 });
      await expect.soft(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 3000 });
    });
    await step('FABs primaires visibles, panneau et tiroir repliés', async () => {
      for (const id of [
        'oi_carto_btn_search', 'oi_carto_btn_ping', 'oi_carto_btn_draw', 'oi_carto_btn_layers',
        'oi_carto_btn_fullscreen', 'oi_carto_btn_more',
      ]) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
      await expect.soft(page.locator('#oi_carto_more_tools')).toBeHidden();
      await expect.soft(page.locator('#oi_carto_layers_panel')).toBeHidden();
    });
    await step('panneau « Calques » : ouverture, fond de carte / surimpressions / vue, fermeture Échap', async () => {
      await page.locator('#oi_carto_btn_layers').click();
      for (const id of [
        'oi_carto_btn_topo', 'oi_carto_btn_lidar', 'oi_carto_btn_contours',
        'oi_carto_btn_streets', 'oi_carto_btn_3d',
      ]) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect.soft(page.locator('#oi_carto_layers_panel')).toBeHidden();
      // Échap intercepté par le panneau : la modale reste ouverte
      await expect.soft(page.locator('#cartographyModal')).toBeVisible();
    });
    await step('tiroir « Plus » : ouverture, capture + libellés, fermeture Échap', async () => {
      await page.locator('#oi_carto_btn_more').click();
      for (const id of ['oi_carto_btn_capture', 'oi_carto_btn_labels']) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect.soft(page.locator('#oi_carto_more_tools')).toBeHidden();
      // Échap intercepté par le tiroir : la modale reste ouverte
      await expect.soft(page.locator('#cartographyModal')).toBeVisible();
    });
    await step('recherche adresse/coordonnées GPS (Nominatim)', async () => {
      await page.locator('#oi_carto_btn_search').click();
      await expect.soft(page.locator('#oi_carto_search_panel')).toBeVisible({ timeout: 1500 });
      await page.locator('#oi_carto_address_input').fill('48.8566, 2.3522');
      await page.locator('#oi_carto_search_btn').click();
      await expect.soft(page.locator('#oi_carto_search_results')).not.toBeEmpty({ timeout: 3000 });
    });
    await step('fermeture (#oi_carto_btn_close)', async () => {
      await page.locator('#oi_carto_btn_close').click();
      await expect.soft(page.locator('#cartographyModal')).toBeHidden({ timeout: 1500 });
    });
  });

  // Résolu (TODO-CABLAGE §5 point 8 du brouillon) : carto/*.ts (pins.ts,
  // draw.ts) lu en détail. Persistance : `Store.state.formData.cartography`
  // (carto/state.ts `_getCartoState`/`_savePins`/`_saveShapes`), écrite dans
  // localStorage['tactical_oi_data'] de façon SYNCHRONE (pas débouncée,
  // contrairement à syncDomToStore) — `Store` est un Proxy dont chaque
  // mutation appelle `notify()` → `saveToStorage()` immédiatement (init.ts:162-171).
  // Pin « Rassemblement » choisi : seul bouton générique de la modale ping
  // sans dépendance à un membre PATRACDVR/véhicule préexistant
  // (pins.ts:160-166), donc le plus simple à driver sans flakiness.
  test('Cartographie — pin générique (Rassemblement) et dessin (rectangle), persistance synchrone', async ({ page }) => {
    const cartoShapesCount = () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('tactical_oi_data') || '{}';
        const carto = (JSON.parse(raw) as { cartography?: { shapes?: unknown[] } }).cartography;
        return carto && Array.isArray(carto.shapes) ? carto.shapes.length : 0;
      });
    const cartoPinsCount = () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('tactical_oi_data') || '{}';
        const carto = (JSON.parse(raw) as { cartography?: { pins?: unknown[] } }).cartography;
        return carto && Array.isArray(carto.pins) ? carto.pins.length : 0;
      });

    await page.locator('#cartographyBtn').click();
    await expect.soft(page.locator('#cartographyModal')).toBeVisible({ timeout: 2000 });
    await expect.soft(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 3000 });

    await step('poser un pin « Rassemblement » : FAB ping → roue → « Ajouter entité » → persisté (cartography.pins)', async () => {
      // Un simple clic sur la carte ne crée plus rien (seul l'appui long le
      // fait, pins.ts `_wireLongPressForPing`) ; le FAB ping ouvre la roue de
      // création au centre de la vue (map-core.ts, parité PC-Tac). « Ajouter
      // entité » ouvre le panneau des entités, dont « Rassemblement » pose
      // directement le pin (_openEntityPickerPanel → _quickPlacePing).
      await page.locator('#oi_carto_btn_ping').click();
      await expect.soft(page.locator('.oi-wheel')).toBeVisible({ timeout: 1500 });
      await page.locator('.oi-wheel').getByRole('button', { name: 'Ajouter entité' }).click();
      await page.locator('.oi-carto-inline-panel').getByRole('button', { name: 'Rassemblement' }).click();
      await expect.poll(cartoPinsCount, { timeout: 2000 }).toBe(1);
      // _quickPlacePing rouvre la roue d'OPTIONS du pin ~80 ms après la pose
      // (pins.ts:571) : la fermer (bouton central) avant l'étape dessin.
      await page.locator('.oi-wheel button[title="Fermer"]').click();
      await expect.soft(page.locator('.oi-wheel')).toBeHidden({ timeout: 1500 });
    });

    await step('dessiner un rectangle : dock → outil → glisser sur la carte → persisté (cartography.shapes)', async () => {
      await page.locator('#oi_carto_btn_draw').click();
      await expect.soft(page.locator('#oi_carto_draw_dock')).toHaveClass(/open/, { timeout: 1500 });
      await page.locator('.oi-carto-draw-btn[data-tool="rectangle"]').click();
      const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
      const precisionStart = page.locator('#oi_carto_draw_precision_start');
      if (box && (await precisionStart.isVisible())) {
        // Écran étroit : tracé de précision au réticule (draw.ts) — « Débuter
        // tracé », viser en déplaçant la carte, « Valider ».
        await precisionStart.click();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 100, { steps: 5 });
        await page.mouse.up();
        await page.locator('#oi_carto_draw_precision_confirm').click();
      } else if (box) {
        await page.mouse.move(box.x + 60, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 160, box.y + 160, { steps: 5 });
        await page.mouse.up();
      }
      await expect.poll(cartoShapesCount, { timeout: 2000 }).toBe(1);
    });

    await step('undo (Ctrl+Z) retire la forme, redo (Ctrl+Y) la restitue', async () => {
      await page.keyboard.press('Control+z');
      await expect.poll(cartoShapesCount, { timeout: 1500 }).toBe(0);
      await page.keyboard.press('Control+y');
      await expect.poll(cartoShapesCount, { timeout: 1500 }).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // Annotation photo (canvas)
  // ------------------------------------------------------------------
  test('Annotation photo — ouverture depuis une vignette, outil + dessin + undo + validation', async ({ page }) => {
    await goToStepViaBullet(page, 4); // étape 5, photos de cheminement
    // Corrigé (défaut de test) : image 200×150 (LARGE_PNG_BASE64, cf. son
    // en-tête) au lieu du PNG 1×1 utilisé ailleurs — requis pour que
    // `#annotationCanvas` ait une surface de dessin exploitable.
    await page.setInputFiles('#photo_container_transport_pr_input', {
      name: 'e2e.png', mimeType: 'image/png', buffer: Buffer.from(LARGE_PNG_BASE64, 'base64'),
    });
    // Corrigé (défaut de test — sélecteur erroné) : `.image-preview` EST déjà
    // la classe de l'`<img>` lui-même (medias.ts, `renderPreview`), PAS un
    // conteneur autour d'un `<img>` imbriqué — `.image-preview img` (avec
    // descendant) ne matchait donc AUCUN élément (0 résultat), d'où le
    // timeout sur `getAttribute` plus bas (locator jamais résolu).
    const previewImg = page.locator('#photo_container_transport_pr_preview_container img.image-preview').first();
    // `handleFileChange` compresse l'image via un canvas AVANT de créer la
    // vignette (`compressImage(file, 0.95, 2560)`, medias.ts:170) — un vrai
    // travail de canvas (contrairement au PNG 1×1 utilisé ailleurs, quasi
    // instantané), asynchrone et de durée variable sous charge. Attendre la
    // vignette avec un budget généreux AVANT de cliquer `.add-btn` (qui, lui,
    // garde le budget standard `actionTimeout: 2000`) évite un flake constaté
    // (le bouton n'existe pas encore au moment du clic).
    await previewImg.waitFor({ state: 'attached', timeout: 5000 });

    await step('bouton crayon ouvre la modale d\'annotation (openAnnotationModal, résidu window)', async () => {
      // medias.js:82 — bouton `.add-btn` avec `onclick="openAnnotationModal(...)"`,
      // premier bouton de l'item (avant le `.remove-btn` de suppression) ; pas
      // de bouton effraction ici (`isEffrac` ne s'applique pas aux photos de
      // cheminement transport).
      await page.locator('#photo_container_transport_pr_preview_container .image-preview-item .add-btn').first().click();
      await expect.soft(page.locator('#annotationModal')).toBeVisible({ timeout: 2000 });
      await expect.soft(page.locator('#annotationCanvas')).toBeVisible({ timeout: 1500 });
      // Barrière d'init (défaut de test) : la visibilité de la modale et du
      // canvas ne garantit PAS que son buffer de dessin est prêt —
      // `openAnnotationModal` (dessin.ts:558) affiche la modale PUIS diffère
      // l'init (dimensionnement du canvas, rechargement de
      // Store.state.annotations depuis data-annotations, resetAnnotationHistory)
      // de deux `requestAnimationFrame` imbriqués. Sans cette attente, le
      // step suivant peut dessiner dans la fenêtre de course et se faire
      // effacer par le reset sous charge machine. 200×150 = dimensions de
      // LARGE_PNG_BASE64.
      await page.waitForFunction(() => {
        const canvas = document.getElementById('annotationCanvas') as HTMLCanvasElement | null;
        return !!canvas && canvas.width === 200 && canvas.height === 150;
      }, undefined, { timeout: 5000 });
    });

    await step('sélection outil Box + tracé souris sur le canvas', async () => {
      await page.locator('#tool_box').click();
      await expect.soft(page.locator('#tool_box')).toHaveClass(/active/, { timeout: 1000 });
      const box = await page.locator('#annotationCanvas').boundingBox();
      if (box) {
        await page.mouse.move(box.x + 30, box.y + 30);
        await page.mouse.down();
        // Plus de pas + petite pause avant le `up` : un tracé trop rapide
        // (5 pas) s'est révélé occasionnellement flaky (mousemove non pris
        // en compte avant le mouseup par le handler pointerdown/pointermove
        // du canvas) — 15 pas + pause laisse au moins un `mousemove`
        // intermédiaire s'exécuter avant le relâchement.
        await page.mouse.move(box.x + 160, box.y + 110, { steps: 15 });
        await page.waitForTimeout(50);
        await page.mouse.up();
        // refreshAnnotationUndoRedo (dessin.ts:227) n'active #annotation_undo
        // que si l'historique n'est pas vide : confirme que le tracé a bien
        // été enregistré avant de poursuivre.
        await expect(page.locator('#annotation_undo')).toBeEnabled({ timeout: 2000 });
      }
    });

    await step('undo (Ctrl+Z) puis redo (Ctrl+Y)', async () => {
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+y');
      // Assertion faible (pas d'accès direct à Store.state.annotations avant
      // « Valider ») : vérifie juste que la modale reste opérationnelle.
      await expect.soft(page.locator('#annotationModal')).toBeVisible();
    });

    await step('Valider (annotation_save_header) aplatit sur l\'image (data-annotations non vide)', async () => {
      await page.locator('#annotation_save_header').click();
      await expect.soft(page.locator('#annotationModal')).toBeHidden({ timeout: 1500 });
      const annotations = await previewImg.getAttribute('data-annotations');
      expect.soft(annotations && annotations !== '[]').toBeTruthy();
    });
  });

  // ------------------------------------------------------------------
  // Génération du document (aperçu / téléchargement / présentation / format)
  // ------------------------------------------------------------------
  // SPEC-2026-08-18-pdf-et-champs.md §1 : l'aperçu (#previewBtn →
  // openPresentationMode → PDFEngineV2.openPreview) rend désormais le MÊME
  // blob PDF vectoriel que le téléchargement PAGE PAR PAGE dans des
  // `<canvas class="pdf-preview-canvas">` (pdf.js embarqué, worker local) —
  // plus aucune URL `blob:`, plus d'`<iframe>` : inexploitable tel quel sur
  // le parc Gendarmerie verrouillé visé par cette mission (blob: invisible en
  // iframe, lecteur PDF natif souvent désactivé).
  test('Génération — aperçu PDF vivant (previewBtn → openPresentationMode → openPreview, pages pdf.js/<canvas> réellement peintes)', async ({ page }) => {
    await goToFinalStepAndOpenPreview(page);
    await step('clic sur #previewBtn ouvre #presentationModal avec au moins une page pdf.js peinte (canvas non vide)', async () => {
      await expect.soft(page.locator('#presentationModal')).toBeVisible({ timeout: 5000 });
      const firstCanvas = page.locator('#presentation-content canvas.pdf-preview-canvas').first();
      await expect.soft(firstCanvas).toBeVisible({ timeout: 15000 });
      const hasPaintedPixels = await firstCanvas.evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Une page pdf.js rendue n'est jamais uniformément transparente
        // (canal alpha nul) : au moins un pixel opaque suffit à distinguer un
        // vrai rendu d'un <canvas> resté vierge.
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] !== 0) return true;
        }
        return false;
      });
      expect.soft(hasPaintedPixels).toBe(true);
    });
  });

  test('Génération — bascule format A4/16:9 persistée (pdfOutputFormat)', async ({ page }) => {
    await goToFinalStepAndOpenPreview(page);
    await expect.soft(page.locator('#presentationModal')).toBeVisible({ timeout: 5000 });

    await step('bascule vers 16:9 (setPdfFormat, résidu window, posé en tête de main.ts §12.1)', async () => {
      await page.locator('#btnFormat169').click();
      await expect.soft(page.locator('#btnFormat169')).toHaveClass(/active/, { timeout: 1500 });
      await expect.soft(page.locator('#pdfFormatDims')).not.toContainText('297×210', { timeout: 1500 });
    });
    await step('persistance après rechargement', async () => {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await goToFinalStepAndOpenPreview(page);
      await expect.soft(page.locator('#btnFormat169')).toHaveClass(/active/, { timeout: 2000 });
    });
  });

  // PDF.INTEG (SPEC-PDF-V3.md §4/§8) : `#downloadPdfBtn` est désormais câblé
  // sur `downloadOiPdfV3()` (`src/apps/oi/pdf/engine-v3.ts`), moteur vectoriel
  // pdfmake — l'ancien `downloadOiPdf()` (html2canvas + jsPDF, retiré de
  // `pdf-engine-v2.ts`) ne participe plus à ce chemin. Le défaut hérité
  // documenté ci-dessous jusqu'à cette mission (blocage intermittent DANS
  // `html2canvas` sur la page de couverture, `retries: 2`/`timeout: 60000`
  // dédiés) NE S'APPLIQUE PLUS : `html2canvas` n'est plus consommé par la
  // génération PDF (reste utilisé par la capture cartographique, hors
  // périmètre ici). Mesuré après câblage : le nouveau chemin (collecte →
  // `normalizePhotos` → `buildOiDocDefinition` → `pdfmake.createPdf().getBlob()`
  // → clic `<a download>`) prend ~0,4s en local, systématiquement < 2,5s de
  // bout en bout (5 exécutions consécutives, aucun échec) — la marge de
  // sécurité ci-dessous (`waitForEvent('download', { timeout: 15000 })`)
  // couvre un premier import dynamique à froid du chunk `pdfmake` sans
  // reconduire le `retries`/`timeout` spécial devenu sans objet.
  test('Génération — téléchargement PDF déclenche un download (downloadOiPdfV3, moteur vectoriel)', async ({ page }) => {
    await goToFinalStepAndOpenPreview(page);
    await expect.soft(page.locator('#presentationModal')).toBeVisible({ timeout: 5000 });
    await step('#downloadPdfBtn → fichier OI_<date>_<trigramme>.pdf (nom non vérifié finement ici)', async () => {
      // Le verrou « une génération à la fois » (generation-lock.ts, F23)
      // refuse le clic tant que l'aperçu ouvert par #previewBtn se rend
      // (« Un PDF est déjà en cours… ») : on reclique jusqu'à ce qu'il
      // soit libre. Constaté : 2 échecs sur 3 isolé, bureau.
      await expect.soft(page.locator('#presentation-content canvas.pdf-preview-canvas').first()).toBeVisible({ timeout: 15000 });
      let download: Download | null = null;
      for (let i = 0; i < 6 && !download; i++) {
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
        await page.locator('#downloadPdfBtn').click();
        download = await downloadPromise;
      }
      expect.soft(download).not.toBeNull();
      if (download) expect.soft(download.suggestedFilename()).toMatch(/^OI_.*\.pdf$/);
    });
  });

  // R4-a (D2, « une seule voie d'output PDF ») : `openPresentInPlace` ouvre
  // désormais le MÊME blob PDF vectoriel (plus le « deck » HTML autonome de
  // `_buildPresentationDocument`, retiré) — l'URL reste un `blob:` (le
  // visualiseur PDF natif du nouvel onglet fournit zoom/plein écran/
  // impression).
  // Le Chromium headless de test n'embarque PAS de visualiseur PDF
  // (`navigator.pdfViewerEnabled === false`, constaté) : naviguer un onglet
  // COMPLET vers un blob `application/pdf` via `window.open()` n'y aboutit
  // JAMAIS (`popup.url()` reste vide indéfiniment, contrairement à l'ancien
  // blob `text/html`, qui navigue immédiatement) — limitation de
  // l'environnement de test, pas un défaut de `openPresentInPlace()`. On
  // vérifie donc directement l'APPEL à `window.open()` (URL `blob:` + cible
  // `_blank`), stubé pour ne jamais dépendre du rendu PDF réel du navigateur
  // — même principe que le stub `window.print` de l'ancien test `#printHqBtn`
  // (retiré avec la voie B) : contrat vérifié, pas rendu.
  test('Génération — présentation plein écran (openPresentInPlace, window.open sur le blob PDF réel)', async ({ page }) => {
    await goToFinalStepAndOpenPreview(page);
    await expect.soft(page.locator('#presentationModal')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      (window as unknown as { __openCalls: Array<{ url: string; target: string }> }).__openCalls = [];
      window.open = ((url?: string | URL, target?: string): Window | null => {
        (window as unknown as { __openCalls: Array<{ url: string; target: string }> }).__openCalls.push({
          url: String(url ?? ''),
          target: String(target ?? ''),
        });
        // Renvoie un objet tronqué mais TRUTHY : évite la branche « popup
        // bloquée » de openPresentInPlace() (alert + revoke immédiat), on ne
        // veut exercer QUE la branche succès ici.
        return window;
      }) as typeof window.open;
    });

    await step('#presentHereBtn appelle window.open(blob:…, "_blank")', async () => {
      // Même course que le téléchargement (3ee6fd4) : le verrou « une
      // génération à la fois » refuse le clic tant que l'aperçu se rend.
      // On attend la première page, puis on reclique tant que rien ne s'ouvre.
      await expect.soft(page.locator('#presentation-content canvas.pdf-preview-canvas').first()).toBeVisible({ timeout: 15000 });
      const openCalls = (): Promise<number> => page.evaluate(() => (window as unknown as { __openCalls: unknown[] }).__openCalls.length);
      for (let i = 0; i < 6 && (await openCalls()) === 0; i++) {
        await page.locator('#presentHereBtn').click();
        await expect.poll(openCalls, { timeout: 5000 }).toBeGreaterThan(0).catch(() => {});
      }
      await expect.poll(openCalls, { timeout: 1000 }).toBeGreaterThan(0);
      const calls = await page.evaluate(
        () => (window as unknown as { __openCalls: Array<{ url: string; target: string }> }).__openCalls,
      );
      expect.soft(calls[0]?.url).toMatch(/^blob:/);
      expect.soft(calls[0]?.target).toBe('_blank');
    });
  });

  // R4-a (D2, « une seule voie d'output PDF ») : le bouton `#printHqBtn`
  // (« Imprimer — qualité maximale », voie B, `printOiHighQuality()` →
  // `print-view.ts`/`print-style.ts`) est RETIRÉ — on imprime désormais le
  // PDF vectoriel via le bouton natif du visualiseur PDF du navigateur
  // (téléchargement ou aperçu/présentation, tous les trois construits par
  // `buildOiPdfBlob()`). Le test dédié `#printHqBtn` disparaît avec lui.

  // ------------------------------------------------------------------
  // Persistance / sessions
  // ------------------------------------------------------------------
  test('Persistance — auto-sauvegarde débouncée + flush forcé sur pagehide/visibilitychange', async ({ page }) => {
    await goToStepViaBullet(page, 0);
    await step('saisie puis déclenchement manuel de pagehide/visibilitychange (avant la fin du debounce)', async () => {
      await page.locator('#situation_generale').fill('Flush avant debounce E2E');
      // Immédiatement après la frappe (<500ms), on force les frontières de
      // sortie (formulaires.js: installFlushOnBoundaries) sans attendre le
      // minuteur du debounce (formulaires.ts §11.4 : flushFormData = version
      // IMMÉDIATE, distincte de syncDomToStore = débouncée).
      await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        window.dispatchEvent(new Event('beforeunload'));
      });
      const stored = await page.evaluate(() => localStorage.getItem('tactical_oi_data') || '');
      expect.soft(stored).toContain('Flush avant debounce E2E');
    });
  });

  test('Persistance — export archive .oi.zip déclenche un téléchargement (OI-Archive-<horodatage>.oi.zip)', async ({ page }) => {
    await step('#exportArchiveBtn → exportArchive() (id-based addEventListener)', async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await page.locator('#exportArchiveBtn').click();
      const download = await downloadPromise;
      expect.soft(download).not.toBeNull();
      if (download) expect.soft(download.suggestedFilename()).toMatch(/^OI-Archive-.*\.oi\.zip$/);
    });
  });

  test('Persistance — import archive .oi.zip : sélection catégorielle, fusion non destructive', async ({ page }) => {
    // Résolu : fixture réel construit par buildOiZipFixture() (format confirmé
    // contre exportArchive()/parseArchive()/detectImportCategories(),
    // formulaires.ts:1219-1420).
    let archiveBuffer: Buffer | null = null;
    await step('construire le fixture .oi.zip (1 champ texte + 1 adversaire)', async () => {
      archiveBuffer = await buildOiZipFixture();
      expect(archiveBuffer.length).toBeGreaterThan(0);
    });

    await step('après sélection du fichier .oi.zip, #importSelectModal liste les catégories détectées', async () => {
      await page.setInputFiles('#archiveFileInput', {
        name: 'fixture.oi.zip',
        mimeType: 'application/zip',
        buffer: archiveBuffer as unknown as Buffer,
      });
      await expect.soft(page.locator('#importSelectModal')).toBeVisible({ timeout: 2000 });
      // 2 catégories attendues d'après le contenu du fixture : « champs »
      // (rest, situation_generale) et « adversaires » (1 entrée) — PAS
      // « photos », « membres », « articulation », « cartographie » (absents
      // du fixture) — d'où le `toHaveCount(2)` strict plutôt que `not.toHaveCount(0)`.
      await expect.soft(page.locator('#importSelectList .import-cat-row')).toHaveCount(2, { timeout: 1500 });
      await expect
        .soft(page.locator('#importSelectList .import-cat-row', { hasText: 'Adversaires' }))
        .toBeVisible({ timeout: 1500 });
    });

    await step('confirmer l\'import : fusion non destructive (adversaire importé apparaît)', async () => {
      await page.locator('#importSelectConfirmBtn').click();
      await expect.soft(page.locator('#importSelectModal')).toBeHidden({ timeout: 1500 });
      await goToStepViaBullet(page, 1);
      await expect
        .soft(page.locator('#adversaries_container .adv-title'))
        .toContainText('ADV IMPORT E2E', { timeout: 1500 });
    });
  });

  test('Persistance — import de session .json SURVIT au rechargement (bug corrigé, SPEC-OI-CONVERSION §9)', async ({ page }) => {
    // Le fichier .json importé passe par la branche `.json` de importArchive
    // (archiveFileInput accepte « .zip,.json ») qui délègue à importSession
    // (formulaires.js:1069-1073). AVANT le correctif documenté dans
    // SPEC-OI-CONVERSION.md §9, le flush de `beforeunload` (déclenché par le
    // `location.reload()` d'importSession) réécrivait localStorage avec le
    // DOM encore vierge, écrasant la session tout juste importée — bug
    // reproductible à 100 %. Le correctif pose `window.isFormLoading = true`
    // AVANT le reload (même garde que applyArchiveImport/resetAllData).
    let sessionJson = '';
    await step('produire un export de session réel via window.exportSession() (résidu window)', async () => {
      await page.locator('#date_op').fill('2026-08-01');
      await page.locator('#situation_generale').fill('SESSION IMPORTÉE E2E — doit survivre au reload');
      // Synchro différée (500 ms) puis écriture du Store : plus de 700 ms mesurés,
      // on attend l'écriture elle-même plutôt qu'un délai fixe.
      const stored = (): Promise<string> => page.evaluate(() => localStorage.getItem('tactical_oi_data') || '{}');
      await expect.poll(stored, { timeout: 3000 }).toContain('SESSION IMPORTÉE E2E');
      sessionJson = await stored();
    });

    await step('recharger sur un état VIERGE distinct, puis importer le fichier .json ci-dessus', async () => {
      await page.evaluate(() => localStorage.removeItem('tactical_oi_data'));
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#situation_generale').fill('ÉTAT VIERGE AVANT IMPORT — ne doit PAS survivre');
      await page.setInputFiles('#archiveFileInput', {
        name: 'session-e2e.json',
        mimeType: 'application/json',
        buffer: Buffer.from(sessionJson, 'utf-8'),
      });
      // R2-T2b : importSession() déclenche désormais un toast() non bloquant
      // (@shared/feedback.js) puis location.reload() après un court délai
      // (setTimeout 600ms, laisse le temps au toast d'être visible) : attendre
      // la navigation induite.
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    });

    await step('après le reload induit par l\'import, la session importée est bien celle affichée (PAS l\'état vierge)', async () => {
      await expect.soft(page.locator('#situation_generale')).toHaveValue(
        'SESSION IMPORTÉE E2E — doit survivre au reload', { timeout: 3000 }
      );
    });

    await step('un SECOND rechargement (sans import) confirme que la session est bien celle en localStorage, pas un résidu DOM', async () => {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect.soft(page.locator('#situation_generale')).toHaveValue(
        'SESSION IMPORTÉE E2E — doit survivre au reload', { timeout: 1500 }
      );
    });
  });

  test('Persistance — réinitialisation Page Active vs Tout (modale de confirmation)', async ({ page }) => {
    await goToStepViaBullet(page, 0);
    await page.locator('#situation_generale').fill('Sera effacé par reset Page Active');
    await goToStepViaBullet(page, 2);
    await page.locator('#amies').fill('Doit survivre au reset Page Active');

    await step('#resetMenuBtn ouvre #resetOptionsModal', async () => {
      await page.locator('#resetMenuBtn').click();
      await expect.soft(page.locator('#resetOptionsModal')).toBeVisible({ timeout: 1500 });
    });
    await step('« Page Active » (#resetPageBtn) ne vide que l\'étape courante (Environnement)', async () => {
      await page.locator('#resetPageBtn').click();
      await clickConfirmDialogOk(page);
      await expect.soft(page.locator('#amies')).toHaveValue('', { timeout: 1500 });
      await goToStepViaBullet(page, 0);
      await expect.soft(page.locator('#situation_generale')).toHaveValue('Sera effacé par reset Page Active');
    });
    await step('« Tout » (#resetAllBtn) efface l\'intégralité du formulaire (config PATRAC conservée)', async () => {
      await page.locator('#resetMenuBtn').click();
      await page.locator('#resetAllBtn').click();
      await clickConfirmDialogOk(page);
      await expect.soft(page.locator('#situation_generale')).toHaveValue('', { timeout: 1500 });
    });
  });

  // ------------------------------------------------------------------
  // UI transverse (dock, thème, tuto, logs)
  // ------------------------------------------------------------------
  test('Dock — réduire/agrandir (persisté), lien PC-Tac, dark mode (persisté)', async ({ page }) => {
    await step('présence des items du dock (structurel)', async () => {
      for (const id of ['dockToggleBtn', 'portalLink', 'pctacLink', 'cartographyBtn', 'exportArchiveBtn', 'importArchiveBtn', 'resetMenuBtn', 'darkModeToggle']) {
        await expect.soft(page.locator(`#${id}`)).toBeAttached();
      }
    });
    await step('lien PC-Tac pointe vers ../pctac/ (SPEC-OI-CONVERSION §12.4 : pctac.html → /pctac/ ; relatif depuis P4.C, base GitHub Pages)', async () => {
      // Résolu : oi/index.html:663 portait href="/pctac/" (P3B.C, commit
      // aa1f10f), converti en href="../pctac/" (liens inter-apps relatifs).
      await expect.soft(page.locator('#pctacLink')).toHaveAttribute('href', '../pctac/');
    });
    await step('réduire/agrandir le dock (toggleDock, persisté dockCollapsed)', async () => {
      await page.locator('#dockToggleBtn').click();
      await expect.soft(page.locator('#dockMenu')).toHaveClass(/collapsed/, { timeout: 1000 });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      // Le repli est reposé par l'init asynchrone (main.ts) : une lecture
      // immédiate de la classe, sans attente, était une course.
      await expect.soft(page.locator('#dockMenu')).toHaveClass(/collapsed/, { timeout: 3000 });
      // `.dock-menu.collapsed` masque les autres items (styles/oi.css) :
      // ré-agrandir pour que `#darkModeToggle` reste cliquable ensuite.
      await page.locator('#dockToggleBtn').click();
      await expect.soft(page.locator('#dockMenu')).not.toHaveClass(/collapsed/, { timeout: 1000 });
    });
    await step('bascule thème clair/sombre persistée (handleThemeToggle, clé theme)', async () => {
      await expect.soft(page.locator('body')).toHaveClass(/dark-mode/);
      await page.locator('#darkModeToggle').click();
      await expect.soft(page.locator('body')).not.toHaveClass(/dark-mode/, { timeout: 1500 });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect.soft(page.locator('body')).not.toHaveClass(/dark-mode/, { timeout: 1500 });
    });
  });

  test('Lien retour vers le portail TacSuite (#portalLink)', async ({ page }) => {
    // Résolu (TODO-CABLAGE §5 point 6 du brouillon) : la décision supposée
    // « non prise » l'était déjà au moment du dépôt — `#portalLink`
    // (oi/index.html:659, `href="/"`) a été committé dans aa1f10f (P3B.C,
    // même commit que le câblage main.ts), AVANT cette mission. Précédent
    // symétrique côté PC-Tac : `pctac/index.html:802` (même id, même href),
    // non testé dans `pctac.spec.ts` — ce test comble ce trou pour OI SANS
    // toucher aux 4 chemins protégés du portail racine (index.html,
    // styles/portal.css, src/apps/portal/, public/portal/ — hors périmètre
    // de ce fichier, jamais lus ni modifiés ici). Converti en `href="../"`
    // en `href="../"` (liens inter-apps relatifs).
    await expect.soft(page.locator('#portalLink')).toBeAttached();
    await expect.soft(page.locator('#portalLink')).toHaveAttribute('href', '../');
  });

  test('Tuto interactif — bouton injecté dans le dock + ouverture (PocheTuto, appId="oi")', async ({ page }) => {
    // Corrigé (défaut de test — copié de pctac.spec.ts sans ajuster l'état
    // par défaut) : `pctac/index.html:796` ship `class="dock-menu collapsed"`
    // (d'où le clic `#dockToggleBtn` nécessaire côté PC-Tac pour RÉVÉLER
    // `.ptuto-dock`), mais `oi/index.html:654` ship `class="dock-menu"` SANS
    // `collapsed` (confirmé aussi par `main.ts:442` : la classe n'est ajoutée
    // que si `localStorage['dockCollapsed'] === 'true'`, absent sur une page
    // fraîche) — le dock OI est donc déjà DÉPLIÉ par défaut. Cliquer
    // `#dockToggleBtn` ici l'aurait au contraire REPLIÉ, masquant
    // `.ptuto-dock` (`.dock-menu.collapsed .dock-menu-item:not(#dockToggleBtn)`,
    // styles/oi.css:3335) — d'où l'échec observé. Aucun clic préalable requis.
    await step('bouton .ptuto-dock injecté après #dockToggleBtn (PocheTuto.mount, insertAfter)', async () => {
      await expect.soft(page.locator('#dockMenu .ptuto-dock')).toBeVisible({ timeout: 1500 });
      await page.locator('#dockMenu .ptuto-dock').click();
      await expect.soft(page.locator('[class*="ptuto"]').first()).toBeVisible({ timeout: 1500 });
    });
  });

  test('Fenêtre de logs debug mobile (window.openLogs, résidu window §3.13)', async ({ page, context }) => {
    // Résolu (main.ts:83-150, VERBATIM de 4.html:44-110) : #log-button
    // (data-action="open-logs") appelle window.openLogs(), qui ouvre une
    // VRAIE nouvelle fenêtre/onglet via window.open('', 'GStartLogs', ...) et
    // y écrit un document HTML autonome (document.write) listant
    // window.__capturedLogs — pas une modale injectée dans le DOM courant.
    await step('#log-button ouvre une nouvelle fenêtre "GStartLogs" avec les logs capturés', async () => {
      const popupPromise = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
      await page.locator('#log-button').click();
      const popup = await popupPromise;
      expect.soft(popup).not.toBeNull();
      if (popup) {
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        await expect.soft(popup.locator('h2')).toContainText('GStart Mobile Console', { timeout: 1500 });
      }
    });
  });

  // ------------------------------------------------------------------
  // Pont .oi.zip → PC-Tac (passerelle inter-app)
  // ------------------------------------------------------------------
  test('Pont OI → PC-Tac — un .oi.zip exporté depuis OI est importable dans PC-Tac (#importOiDockBtn)', async ({ page }) => {
    // Couvre CHECKLIST-PCTAC.md item #31 (« NON COUVERT ... dépend de l'app OI
    // pour produire un .oi.zip réel ») côté OI : Archive.importOiArchive
    // (TacSuite-oi-wt/src/apps/pctac/archive.ts:387+) est déjà couvert
    // unitairement côté PC-Tac ; ce test E2E ferme la boucle bout en bout.
    let archivePath: string | null = null;

    await step('OI : créer 1 adversaire + 1 PAX PATRAC puis exporter l\'archive .oi.zip', async () => {
      await goToStepViaBullet(page, 1);
      await page.locator('#createAdversaryBtn').click();
      await page.locator('#adversaries_container input[data-field="nom_adversaire"]').first().fill('PONT-ADV-E2E');
      await goToStepViaBullet(page, 6);
      await withPrompt(page, 'PNT', () => page.locator('#addManualMemberBtn').click());
      await page.waitForTimeout(700);

      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await page.locator('#exportArchiveBtn').click();
      const download = await downloadPromise;
      expect(download).not.toBeNull();
      archivePath = download ? await download.path() : null;
    });

    await step('PC-Tac : importer ce .oi.zip via #importOiDockBtn/#oiImportInput et retrouver l\'adversaire', async () => {
      test.skip(!archivePath, 'Export OI a échoué en amont (câblage non fait) — pont non testable.');
      await page.goto('/pctac/');
      await page.waitForLoadState('domcontentloaded');
      // setInputFiles ne requiert pas que l'input soit visible (CDP) — même
      // remarque que le test « Dock — import archive .pctac.zip » de
      // pctac.spec.ts pour #archiveImportInput.
      await page.setInputFiles('#oiImportInput', archivePath as string);
      // Résolu (strict mode : `#view-adversaires` ET `#adversary-table-body`
      // existent tous deux dans le DOM, la locator combinée matchait donc
      // 2 éléments) : un seul sélecteur suffit comme sonde structurelle.
      await expect.soft(page.locator('#adversary-table-body')).toBeAttached();
      // PC-Tac est câblé (P2.D) : la vue Adversaires n'est pas active par
      // défaut au chargement (vue Main Courante l'est) — cliquer l'onglet.
      await page.locator('.tab-btn[data-view="view-adversaires"]').click().catch(() => {});
      await expect
        .soft(page.locator('#adversary-table-body .fiche-card', { hasText: 'PONT-ADV-E2E' }))
        .toBeVisible({ timeout: 3000 });
    });
  });

  // ------------------------------------------------------------------
  // Persistance globale (localStorage seedé → réaffichage après reload)
  // ------------------------------------------------------------------
  test('Persistance — restauration fidèle depuis localStorage après rechargement (formData complet)', async ({ page }) => {
    await step('seed tactical_oi_data puis reload : les champs se réaffichent', async () => {
      // Corrigé (défaut de test) : SANS `window.isFormLoading = true` avant le
      // `reload()`, le flush `beforeunload`/`pagehide` de
      // `installFlushOnBoundaries` (formulaires.ts:1133-1140) re-sérialise le
      // DOM ENCORE VIERGE de la page EN COURS (chargée par `beforeEach` avant
      // ce seed) et ÉCRASE le seed — exactement le bug documenté en tête de
      // fichier (formulaires.ts:64-66) et déjà couvert par le test
      // « Persistance — import de session .json SURVIT au rechargement »
      // pour le chemin `importSession` (qui pose ce même garde avant SON
      // `location.reload()` interne). Un `page.reload()` déclenché par le
      // TEST (hors de tout chemin applicatif) a besoin du même garde.
      await page.evaluate(() => {
        window.isFormLoading = true;
        localStorage.setItem('tactical_oi_data', JSON.stringify({
          date_op: '2026-08-01',
          situation_generale: 'Seed situation',
          adversaries: [{ id: 'seed_adv1', nom_adversaire: 'SEED ADV' }],
        }));
      });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect.soft(page.locator('#situation_generale')).toHaveValue('Seed situation', { timeout: 1500 });
      await goToStepViaBullet(page, 1);
      await expect.soft(page.locator('#adversaries_container .adv-title')).toContainText('SEED ADV', { timeout: 1500 });
    });
  });
});

// ============================================================================
// Capture de la carte vers un champ photo (retour Nico 2026-09-24 : « Error
// attempting to parse color »). html2canvas 1.4 ne lit pas `color(srgb …)`,
// forme calculée de `color-mix()` : la capture échouait sans rien ajouter.
// ============================================================================

test('capture de la carte vers « OI Express — Carte » : photo ajoutée, aucune erreur', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && /capture|parse/i.test(m.text())) errors.push(m.text()); });
  await page.goto('/oi/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-oi-mode="express"]').click();
  await page.locator('#expressCartoCaptureBtn').click();
  await page.waitForTimeout(3000);
  await page.locator('#oi_carto_btn_more').click();
  await page.locator('#oi_carto_btn_capture').click();
  await page.locator('#oi_carto_capture_export').click();
  await expect(page.locator('#photo_container_express_carte_preview_container img')).toHaveCount(1, { timeout: 15000 });
  expect(errors).toEqual([]);
});


// ============================================================================
// Ergonomie (atelier UI-2, 2026-09-26)
// ============================================================================

test.describe('OI — ergonomie', () => {
  /** Boutons visibles de `scope` dont un côté fait moins de 44 px (cible tactile). */
  async function smallButtons(page: Page, scope: string): Promise<string[]> {
    return page.locator(scope).evaluateAll((roots) => roots.flatMap((root) =>
      Array.from(root.querySelectorAll('button')).flatMap((b) => {
        const r = b.getBoundingClientRect();
        if (!r.width || getComputedStyle(b).visibility === 'hidden') return [];
        return Math.min(r.width, r.height) < 43.5 ? [`${b.className || b.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`] : [];
      })));
  }

  test('cibles tactiles ≥ 44 px : tutoriel, ordre des sections, suppression d\'un VL', async ({ page }) => {
    await gotoOi(page);
    await page.locator('#dockMenu .ptuto-dock').click();
    await expect(page.locator('.ptuto-panel')).toBeVisible();
    expect(await smallButtons(page, '.ptuto-panel')).toEqual([]);
    await page.keyboard.press('Escape');

    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'VL-CIBLE', () => page.locator('#addManualVehicleBtn').click());
    expect(await smallButtons(page, '.vehicle-header')).toEqual([]);

    await goToFinalStepAndOpenPreview(page);
    await page.locator('#pdfSectionOrderToggleBtn').click();
    await expect(page.locator('.pdf-section-order-move-btn').first()).toBeVisible();
    // Le panneau s'ouvre en s'agrandissant : mesurer une fois posé.
    await expect.poll(() => smallButtons(page, '#presentationModal .pdf-section-order-move-btns')).toEqual([]);
  });

  test('tutoriel : la recherche est un seul champ (pas de cadre dans le cadre)', async ({ page }) => {
    await gotoOi(page);
    await page.locator('#dockMenu .ptuto-dock').click();
    const input = page.locator('.ptuto-search input');
    await expect(input).toBeVisible();
    const style = await input.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderTopWidth, margin: cs.marginBottom, bg: cs.backgroundColor };
    });
    expect(style).toEqual({ border: '0px', margin: '0px', bg: 'rgba(0, 0, 0, 0)' });
  });

  test('tutoriel : titres sans l\'habillage des titres de l\'OI (barre, soulignement, capitales)', async ({ page }) => {
    await gotoOi(page);
    await page.locator('#dockMenu .ptuto-dock').click();
    for (const sel of ['.ptuto-head h2', '.ptuto-step-title']) {
      const style = await page.locator(sel).first().evaluate((el) => ({
        bar: getComputedStyle(el, '::before').content,
        underline: getComputedStyle(el).borderBottomWidth,
        caps: getComputedStyle(el).textTransform,
      }));
      expect(style, sel).toEqual({ bar: 'none', underline: '0px', caps: 'none' });
    }
  });

  /** Éléments visibles portant un liseré latéral épais (bordure gauche ≥ 3 px plus
   *  épaisse que les autres, ou pseudo-élément barre collée à gauche). */
  async function thickSideStripes(page: Page): Promise<string[]> {
    return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('body *')).flatMap((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return [];
      const cs = getComputedStyle(el);
      const left = parseFloat(cs.borderLeftWidth);
      const name = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
      const out: string[] = [];
      if (left >= 3 && left > parseFloat(cs.borderTopWidth) && cs.borderLeftStyle !== 'none') out.push(`${name} border-left ${left}px`);
      const b = getComputedStyle(el, '::before');
      if (b.content !== 'none' && b.position === 'absolute' && b.left === '0px' && b.top === '0px' && b.bottom === '0px' && parseFloat(b.width) >= 3 && parseFloat(b.width) <= 8) {
        out.push(`${name}::before ${b.width}`);
      }
      return out;
    }));
  }

  test('aucun liseré latéral épais (PATRACDVR, articulation, finalisation)', async ({ page }) => {
    await gotoOi(page);
    await goToStepViaBullet(page, 6);
    await withPrompt(page, 'VL-LIS', () => page.locator('#addManualVehicleBtn').click());
    await withPrompt(page, 'LIS', () => page.locator('#addManualMemberBtn').click());
    const found = await thickSideStripes(page);
    await goToStepViaBullet(page, 5);
    await page.locator('#addMoicpBtn').click();
    found.push(...await thickSideStripes(page));
    await goToStepViaBullet(page, 7);
    found.push(...await thickSideStripes(page));
    expect([...new Set(found)]).toEqual([]);
  });

  test('articulation : l\'en-tête d\'un bloc tient dans la largeur (chevron visible)', async ({ page }) => {
    await gotoOi(page);
    await goToStepViaBullet(page, 5);
    for (const btn of ['#addMoicpBtn', '#addZmspcpBtn', '#addEffractionBtn']) await page.locator(btn).click();
    const overflow = await page.locator('.articulation-block > .collapsible-header').evaluateAll((hs) =>
      hs.flatMap((h) => {
        const box = h.getBoundingClientRect();
        return Array.from(h.querySelectorAll('*')).some((c) => c.getBoundingClientRect().right > box.right + 1)
          ? [h.textContent?.trim().slice(0, 30)] : [];
      }));
    expect(overflow).toEqual([]);
  });

  test('chronologie : un événement se lit d\'un bloc (type, heure et suppression sur une ligne)', async ({ page }) => {
    await gotoOi(page);
    await goToStepViaBullet(page, 4);
    for (let i = 0; i < 2; i++) await page.locator('[data-action="add-time-event"]').click();
    const item = page.locator('#time_events_container .time-item').first();
    const top = async (sel: string): Promise<number> => (await item.locator(sel).boundingBox())!.y;
    expect(Math.abs((await top('.time-type-select')) - (await top('.remove-btn')))).toBeLessThan(8);
    expect(Math.abs((await top('.time-type-select')) - (await top('.time-hour-input')))).toBeLessThan(8);
    // Deux lignes au plus : les champs d'un même événement restent groupés.
    expect((await item.boundingBox())!.height).toBeLessThan(180);
  });

  test('sections : crayon et × restent sur la ligne du titre', async ({ page }) => {
    await gotoOi(page);
    for (const n of [4, 5]) {
      await goToStepViaBullet(page, n);
      const wrapped = await page.locator('.wizard-step.active .oi-section-heading').evaluateAll((hs) =>
        hs.flatMap((h) => {
          const label = h.querySelector('.oi-section-label')?.getBoundingClientRect();
          const tools = h.querySelector('.oi-section-tools')?.getBoundingClientRect();
          if (!label || !tools || !tools.width) return [];
          return tools.top >= label.bottom - 2 ? [h.textContent?.replace(/\s+/g, ' ').trim().slice(0, 30)] : [];
        }));
      expect(wrapped, `étape ${n + 1}`).toEqual([]);
    }
  });

  test('un champ qui prend le focus n\'est pas caché sous le dock', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // défilement immédiat
    await gotoOi(page);
    await goToStepViaBullet(page, 4);
    for (let i = 0; i < 4; i++) await page.locator('[data-action="add-time-event"]').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const dock = await page.locator('#dockMenu').boundingBox();
    // Parcours clavier réel : Tab de champ en champ dans la chronologie.
    await page.locator('#time_events_container .time-type-select').first().focus();
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const box = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('#time_events_container')) return null;
        const r = el.getBoundingClientRect();
        return { bottom: r.bottom, name: el.className };
      });
      if (!box) break;
      expect(dock && box.bottom <= dock.y, `${box.name} sous le dock`).toBe(true);
    }
  });

  test('annotation photo sur téléphone : titre dégagé, barre des couleurs dans l\'écran, pastilles de 44 px', async ({ page }, testInfo) => {
    // Constat UI-1/UI-2 (390 px) : « Enregistrer » recouvrait le titre, la
    // corbeille « Tout effacer » sortait à droite, pastilles de 30 px.
    test.skip(testInfo.project.name !== 'chromium-mobile', 'mise en page du téléphone');
    await gotoOi(page);
    await goToStepViaBullet(page, 4);
    await page.setInputFiles('#photo_container_transport_pr_input', {
      name: 'e2e.png', mimeType: 'image/png', buffer: Buffer.from(LARGE_PNG_BASE64, 'base64'),
    });
    await page.locator('#photo_container_transport_pr_preview_container [aria-label="Annoter la photo"]').first().click({ timeout: 5000 });
    await expect(page.locator('#annotationModal')).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const title = box('#annotationModalTitle');
      const hits = ['#annotation_cancel_header', '#annotation_save_header'].filter((s) => {
        const b = box(s);
        return title.width > 1 && b.left < title.right && title.left < b.right && b.top < title.bottom && title.top < b.bottom;
      });
      const out = Array.from(document.querySelectorAll('#dock-bottom button')).filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth;
      }).map((b) => b.getAttribute('aria-label'));
      const circles = Array.from(document.querySelectorAll('#dock-bottom .color-circle')).map((c) => Math.min((c as HTMLElement).offsetWidth, (c as HTMLElement).offsetHeight));
      return { hits, out, circles };
    });
    expect(m.hits, 'boutons sur le titre').toEqual([]);
    expect(m.out, 'boutons hors de l\'écran').toEqual([]);
    expect(Math.min(...m.circles), m.circles.join()).toBeGreaterThanOrEqual(44);
  });
});
