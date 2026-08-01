import { defineConfig, devices } from '@playwright/test';

// Pas de webServer automatique : le serveur dev (scripts/dev.sh, port 9678)
// et le serveur de l'original (scripts/serve-original.sh, port 9679) sont
// demarres manuellement / par les scripts dedies avant de lancer les tests.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'html',
  // P2.E1 : timeout d'assertion resserre (defaut 5000ms) - la checklist
  // fonctionnelle comporte de nombreuses assertions independantes (expect.soft)
  // par test ; un defaut plus court borne la duree totale du run sans changer
  // la semantique (une assertion qui reussit reussit toujours immediatement).
  expect: {
    timeout: 2000,
  },
  use: {
    baseURL: 'http://127.0.0.1:9678',
    trace: 'on-first-retry',
    // P2.E1 : une action (click/fill) sur un element rendu inactionnable par
    // l'absence de cablage JS (P2.D non execute, cf. tests/e2e/pctac.spec.ts)
    // ne doit pas monopoliser tout le budget du test (defaut 30s) - elle doit
    // echouer vite pour laisser les etapes suivantes du meme test s'executer
    // (chaque etape est encapsulee individuellement, cf. helper step()).
    actionTimeout: 2000,
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
