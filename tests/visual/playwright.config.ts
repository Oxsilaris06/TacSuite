import { defineConfig, devices } from '@playwright/test';

// Config Playwright DEDIEE aux baselines visuelles (P0.A4).
//
// Separee de ../../playwright.config.ts (testDir: ./tests/e2e, baseURL: 9678)
// pour deux raisons :
//   1. Ces specs ciblent l'ORIGINAL (127.0.0.1:9679) via des URLs absolues,
//      pas le TacSuite en cours de portage (127.0.0.1:9678) -> pas de baseURL ici.
//   2. testDir: '../..'/tests avec le testMatch par defaut de Playwright
//      (**/*.@(spec|test).?(c|m)[jt]s) capterait aussi tests/unit/*.test.ts
//      (specs Vitest, pas Playwright) -> on scope explicitement a ce dossier.
//
// Les 2 projets reprennent EXACTEMENT les viewports du config principal
// (desktop 1440x900, mobile 390x844) — memes noms de projet pour que le
// libelle <viewport> dans les noms de fichiers baseline/ reste coherent.
//
// Prerequis : le serveur original doit tourner (scripts/serve-original.sh,
// port 9679) — non demarre automatiquement ici (cf. convention du config
// principal : demarrage manuel / scripts dedies).
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});
