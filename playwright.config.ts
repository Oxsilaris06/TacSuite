import { defineConfig, devices } from '@playwright/test';

// Pas de webServer automatique : le serveur dev (scripts/dev.sh, port 9678)
// et le serveur de l'original (scripts/serve-original.sh, port 9679) sont
// demarres manuellement / par les scripts dedies avant de lancer les tests.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:9678',
    trace: 'on-first-retry',
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
