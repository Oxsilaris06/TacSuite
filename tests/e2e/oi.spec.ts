import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * P3B.E — Tests E2E fonctionnels Générateur d'OI, contre
 * http://127.0.0.1:9678/oi/. Déposé depuis `.tacsuite-prep/draft-oi.spec.ts`
 * (relu/ajusté post-câblage P3B.C), à côté de tests/e2e/pctac.spec.ts dont ce
 * fichier reprend le style, les helpers et les conventions à l'identique.
 *
 * Source des critères : docs/recon-oi.md **§9** « Checklist fonctionnelle de
 * non-régression — Générateur d'OI » (le brief de cette tâche référence un
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
 * Spécifique OI (pas d'équivalent dans pctac.spec.ts) : l'original utilise
 * `prompt()`/`confirm()` NATIFS partout dans le flux PATRACDVR (création VL,
 * création PAX, cellule en lot, suppression drag&drop vers la poubelle...).
 * Playwright n'auto-résout PAS un `prompt()` avec le texte voulu (seulement
 * `dialog.accept()` sans argument → chaîne vide, qui échoue silencieusement
 * les validations de longueur de `addManualMember`/`addCellBatch`).
 *
 * CORRIGÉ (défaut de test constaté à l'exécution, PAS une régression du
 * portage) : le brouillon posait un `page.once('dialog', ...)` DANS
 * `withPrompt()`, en supposant qu'il se déclencherait AVANT le handler
 * persistant `page.on('dialog', ...)` posé par `beforeEach` (« FIFO d'ajout
 * des listeners »). À l'exécution c'est l'INVERSE qui est vrai (Node
 * `EventEmitter` : le PREMIER listener AJOUTÉ est le premier appelé — celui
 * de `beforeEach`, ajouté avant le début du corps du test, précède
 * nécessairement celui de `withPrompt()`, ajouté pendant le test) : le
 * handler persistant consommait le dialogue en premier (chaîne vide), puis
 * le `once()` de `withPrompt()` tentait de le ré-accepter → exception
 * `"Cannot accept dialog which is already handled!"` qui plantait la page en
 * cascade (VL/PAX jamais créés avec le bon trigramme, tous les tests
 * PATRACDVR/Articulation qui en dépendent échouaient). Remplacé par un seul
 * handler PERSISTANT (posé une fois dans `beforeEach`) qui consulte une
 * valeur "en attente" positionnée par `withPrompt()` juste avant l'action —
 * aucun risque d'ordre de listeners.
 */
let pendingPromptValue: string | null = null;

async function withPrompt<T>(value: string, action: () => Promise<T>): Promise<T> {
  pendingPromptValue = value;
  return action();
}

test.describe('OI — Checklist fonctionnelle (docs/recon-oi.md §9)', () => {
  test.beforeEach(async ({ page }) => {
    // Handler global UNIQUE (voir justification ci-dessus) : un `prompt()`
    // consomme `pendingPromptValue` s'il est positionné (par `withPrompt()`,
    // remis à `null` aussitôt lu — usage à UN seul coup, comme `page.once()`
    // était censé se comporter) sinon accepte avec une chaîne VIDE
    // (comportement délibérément permissif, jamais une annulation) ; tout
    // `confirm()`/`alert()` est accepté sans texte.
    pendingPromptValue = null;
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'prompt') {
        const value = pendingPromptValue ?? '';
        pendingPromptValue = null;
        void dialog.accept(value);
      } else {
        void dialog.accept();
      }
    });
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
    await step('atteindre l\'étape 3 (index 2) puis recharger', async () => {
      await goToStepViaBullet(page, 2);
      await expect.soft(page.locator('.wizard-step').nth(2)).toHaveClass(/active/, { timeout: 1500 });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect.soft(page.locator('.wizard-step').nth(2)).toHaveClass(/active/, { timeout: 1500 });
    });
    await step('les puces déjà visitées portent la classe completed (navigation.js:13-14)', async () => {
      await expect.soft(page.locator('.wizard-progress-step').nth(0)).toHaveClass(/completed/, { timeout: 1500 });
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

    await step('suppression de la fiche adversaire (removeAdversary, résidu window, confirm natif)', async () => {
      // Résolu (formulaires.ts:430) : bouton `.remove-btn` distingué des
      // autres (photos, ME, chronologie…) par son `title` unique posé par
      // `addAdversary` — `onclick="removeAdversary('${id}')"` appelle
      // `confirm()` (auto-accepté par le handler global de `beforeEach`).
      const removeBtn = page.locator('#adversaries_container .remove-btn[title="Supprimer cet adversaire"]').first();
      await removeBtn.click();
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
      await withPrompt('VL-ALPHA', () => page.locator('#addManualVehicleBtn').click());
      await withPrompt('VL-BRAVO', () => page.locator('#addManualVehicleBtn').click());
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
      await chips.nth(1).dragTo(chips.nth(0), { timeout: 4000 });
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
      await withPrompt('KODIAQ-E2E', () => page.locator('#addManualVehicleBtn').click());
      await expect
        .soft(page.locator('.patracdvr-vehicle-row[data-vehicle-name="KODIAQ-E2E"]'))
        .toHaveCount(1, { timeout: 1500 });
    });
    await step('création PAX manuel (prompt, addManualMember) : trigramme 2-4 caractères', async () => {
      await withPrompt('ABC', () => page.locator('#addManualMemberBtn').click());
      await expect
        .soft(page.locator('#unassigned_members_container .patracdvr-member-btn[data-trigramme="ABC"]'))
        .toHaveCount(1, { timeout: 1500 });
    });
    await step('cellule India en lot (addCellBatch, ≥2 PAX, prompt liste de trigrammes)', async () => {
      // Résolu (patrac.ts:286-297) : `input.split(/[\s,;]+/)` — séparateurs
      // espace/virgule/point-virgule tous acceptés et interchangeables ;
      // "IND1, IND2" (virgule + espace) est donc une valeur valide confirmée.
      await withPrompt('IND1, IND2', () =>
        page.locator('.cell-batch-btn[data-cell="India"]').click()
      );
      await expect
        .soft(page.locator('.patracdvr-member-btn[data-cellule="India 1"]'))
        .not.toHaveCount(0, { timeout: 1500 });
    });
  });

  test('PATRACDVR — drag&drop souris (non-affectés → véhicule → poubelle avec confirmation)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await withPrompt('VECT-E2E', () => page.locator('#addManualVehicleBtn').click());
    await withPrompt('XYZ', () => page.locator('#addManualMemberBtn').click());
    // Corrigé (défaut de test, même nature que le commentaire de
    // « Articulation — rame VL réordonnable » ci-dessus) : un `dragTo()`
    // immédiatement après la création du PAX (juste avant, via prompt) n'a
    // pas le temps de se stabiliser sous `actionTimeout: 2000` — le `dragTo`
    // aboutit (pas d'exception) mais le drop n'est pas pris en compte.
    await page.waitForTimeout(200);

    await step('glisser le PAX non-affecté vers le véhicule (drag.js, DnD HTML5 natif)', async () => {
      const member = page.locator('#unassigned_members_container .patracdvr-member-btn[data-trigramme="XYZ"]');
      const target = page.locator('.patracdvr-vehicle-row[data-vehicle-name="VECT-E2E"] .patracdvr-members-container');
      await member.dragTo(target, { timeout: 4000 });
      await expect
        .soft(page.locator('.patracdvr-vehicle-row[data-vehicle-name="VECT-E2E"] .patracdvr-member-btn[data-trigramme="XYZ"]'))
        .toHaveCount(1, { timeout: 1500 });
    });

    await step('glisser vers #trashCan supprime définitivement (confirm natif accepté par beforeEach)', async () => {
      // Même défaut de test que le drag précédent (settle avant un dragTo
      // HTML5 natif juste après un DOM ré-affecté par le drop précédent).
      await page.waitForTimeout(300);
      const member = page.locator('.patracdvr-member-btn[data-trigramme="XYZ"]');
      await member.dragTo(page.locator('#trashCan'), { timeout: 4000 });
      await expect.soft(page.locator('.patracdvr-member-btn[data-trigramme="XYZ"]')).toHaveCount(0, { timeout: 1500 });
    });
  });

  test('PATRACDVR — panneau quick-edit (sélection PAX, couplage cellule↔fonction)', async ({ page }) => {
    await goToStepViaBullet(page, 6);
    await withPrompt('QED', () => page.locator('#addManualMemberBtn').click());
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
    await withPrompt('BA1', () => page.locator('#addManualMemberBtn').click());
    await withPrompt('BA2', () => page.locator('#addManualMemberBtn').click());

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
    await withPrompt('CTX', () => page.locator('#addManualMemberBtn').click());

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
    await withPrompt('PDF', () => page.locator('#addManualMemberBtn').click());
    await step('#patracdvrPdfBtn → generatePatracdvrPdf() → download', async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await page.locator('#patracdvrPdfBtn').click();
      const download = await downloadPromise;
      expect.soft(download).not.toBeNull();
      if (download) expect.soft(download.suggestedFilename()).toMatch(/\.pdf$/);
    });
  });

  test('PATRACDVR — réinitialisation isolée du reste des données (resetPatracdvrUI, confirm natif)', async ({ page }) => {
    await goToStepViaBullet(page, 0);
    await page.locator('#situation_generale').fill('Doit survivre au reset PATRAC');
    await goToStepViaBullet(page, 6);
    await withPrompt('RST', () => page.locator('#addManualMemberBtn').click());

    await step('#resetPatracdvrBtn vide le PATRACDVR (confirm auto-accepté par beforeEach)', async () => {
      await page.locator('#resetPatracdvrBtn').click();
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
      await page.locator('button', { hasText: 'Rétablir' }).click();
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
  test('Cartographie — ouverture/fermeture modale + toolbar 7 boutons', async ({ page }) => {
    await step('ouverture (#cartographyBtn dock → OICarto.open, id-based addEventListener)', async () => {
      await page.locator('#cartographyBtn').click();
      await expect.soft(page.locator('#cartographyModal')).toBeVisible({ timeout: 2000 });
      await expect.soft(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 3000 });
    });
    await step('toolbar verticale complète', async () => {
      for (const id of [
        'oi_carto_btn_search', 'oi_carto_btn_ping', 'oi_carto_btn_draw',
        'oi_carto_btn_capture', 'oi_carto_btn_labels', 'oi_carto_btn_3d', 'oi_carto_btn_fullscreen',
      ]) {
        await expect.soft(page.locator(`#${id}`)).toBeVisible();
      }
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

    await step('poser un pin « Rassemblement » : modale → clic sur la carte → persisté (cartography.pins)', async () => {
      await page.locator('#oi_carto_btn_ping').click();
      await expect.soft(page.locator('#oi_carto_ping_modal')).toBeVisible({ timeout: 1500 });
      await page.locator('#oi_carto_rassemblement_list button', { hasText: 'Rassemblement' }).click();
      // _armPinPlacement ferme la modale et arme le placement (pins.ts:356-362).
      await expect.soft(page.locator('#oi_carto_ping_modal')).toBeHidden({ timeout: 1500 });
      const map = page.locator('canvas.maplibregl-canvas');
      await map.click({ position: { x: 120, y: 120 } });
      await expect.poll(cartoPinsCount, { timeout: 2000 }).toBe(1);
    });

    await step('dessiner un rectangle : dock → outil → glisser sur la carte → persisté (cartography.shapes)', async () => {
      await page.locator('#oi_carto_btn_draw').click();
      await expect.soft(page.locator('#oi_carto_draw_dock')).toHaveClass(/open/, { timeout: 1500 });
      await page.locator('.oi-carto-draw-btn[data-tool="rectangle"]').click();
      const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
      if (box) {
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
  test('Génération — aperçu HTML vivant (previewBtn → openPresentationMode → openPreview)', async ({ page }) => {
    await goToFinalStepAndOpenPreview(page);
    await step('clic sur #previewBtn ouvre #presentationModal avec du contenu', async () => {
      await expect.soft(page.locator('#presentationModal')).toBeVisible({ timeout: 5000 });
      await expect.soft(page.locator('#presentation-content')).not.toBeEmpty({ timeout: 5000 });
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

  test('Génération — téléchargement PDF déclenche un download (downloadOiPdf)', async ({ page }) => {
    await goToFinalStepAndOpenPreview(page);
    await expect.soft(page.locator('#presentationModal')).toBeVisible({ timeout: 5000 });
    await step('#downloadPdfBtn → fichier OI_<date>_<trigramme>.pdf (nom non vérifié finement ici)', async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
      await page.locator('#downloadPdfBtn').click();
      const download = await downloadPromise;
      expect.soft(download).not.toBeNull();
      if (download) expect.soft(download.suggestedFilename()).toMatch(/^OI_.*\.pdf$/);
    });
  });

  test('Génération — mode présentation plein écran autonome (openPresentInPlace, nouvel onglet)', async ({ page, context }) => {
    await goToFinalStepAndOpenPreview(page);
    await expect.soft(page.locator('#presentationModal')).toBeVisible({ timeout: 5000 });
    await step('#presentHereBtn ouvre un nouvel onglet avec un document Blob autonome', async () => {
      const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await page.locator('#presentHereBtn').click();
      const popup = await popupPromise;
      expect.soft(popup).not.toBeNull();
      if (popup) {
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        expect.soft(popup.url()).toMatch(/^blob:|^data:/);
      }
    });
  });

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
      await page.waitForTimeout(700); // laisser le debounce écrire dans le Store avant l'export
      sessionJson = await page.evaluate(() => localStorage.getItem('tactical_oi_data') || '{}');
      expect(sessionJson).toContain('SESSION IMPORTÉE E2E');
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
      // importSession() déclenche alert() (auto-accepté par beforeEach) puis
      // location.reload() : attendre la navigation induite.
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
      await expect.soft(page.locator('#amies')).toHaveValue('', { timeout: 1500 });
      await goToStepViaBullet(page, 0);
      await expect.soft(page.locator('#situation_generale')).toHaveValue('Sera effacé par reset Page Active');
    });
    await step('« Tout » (#resetAllBtn) efface l\'intégralité du formulaire (config PATRAC conservée)', async () => {
      await page.locator('#resetMenuBtn').click();
      await page.locator('#resetAllBtn').click();
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
    await step('lien PC-Tac pointe vers /pctac/ (SPEC-OI-CONVERSION §12.4 : pctac.html → /pctac/)', async () => {
      // Résolu : oi/index.html:663 porte bien href="/pctac/" (appliqué en
      // P3B.C, commit aa1f10f).
      await expect.soft(page.locator('#pctacLink')).toHaveAttribute('href', '/pctac/');
    });
    await step('réduire/agrandir le dock (toggleDock, persisté dockCollapsed)', async () => {
      await page.locator('#dockToggleBtn').click();
      const collapsedAfterClick = await page.locator('#dockMenu').getAttribute('class');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      const collapsedAfterReload = await page.locator('#dockMenu').getAttribute('class');
      expect.soft(collapsedAfterClick?.includes('collapsed')).toBe(collapsedAfterReload?.includes('collapsed'));
      // Corrigé (défaut de test) : `.dock-menu.collapsed .dock-menu-item:
      // not(#dockToggleBtn)` est masqué en CSS (styles/oi.css:3335) — si l'on
      // n'annule pas ce repli avant l'étape suivante, `#darkModeToggle` reste
      // caché et son clic échoue. Ré-agrandir le dock pour ne pas polluer les
      // étapes suivantes de ce test.
      if (collapsedAfterReload?.includes('collapsed')) {
        await page.locator('#dockToggleBtn').click();
        await expect.soft(page.locator('#dockMenu')).not.toHaveClass(/collapsed/, { timeout: 1000 });
      }
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
    // de ce fichier, jamais lus ni modifiés ici).
    await expect.soft(page.locator('#portalLink')).toBeAttached();
    await expect.soft(page.locator('#portalLink')).toHaveAttribute('href', '/');
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
      await withPrompt('PNT', () => page.locator('#addManualMemberBtn').click());
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
        .soft(page.locator('#adversary-table-body tr', { hasText: 'PONT-ADV-E2E' }))
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
