import { defineConfig, devices } from '@playwright/test';

// Pas de webServer automatique : le serveur dev (scripts/dev.sh, port 9678)
// et le serveur de l'original (scripts/serve-original.sh, port 9679) sont
// demarres manuellement / par les scripts dedies avant de lancer les tests.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'html',
  // P3B.FIX (reprise 1), BLOQUANT R2 : workers fige a 1 (au lieu du defaut,
  // qui vaut ~moitie des coeurs logiques - 8 sur la machine de mesure).
  // Mesure : 11 echecs/130 a 8 workers ; encore 1 a 4 echecs non
  // reproductibles a workers=2 (essaye avec actionTimeout/expect.timeout
  // relevs jusqu'a 4000 puis 6000ms - jamais 2 runs complets consecutifs
  // verts obtenus). Cause reelle : un seul serveur dev (scripts/dev.sh, port
  // 9678) sert TOUTES les pages de test - des qu'au moins 2 workers tapent
  // dessus en parallele (rendu carte MapLibre + tuiles reseau, drag&drop
  // HTML5, cablage async de PlanMap.init()), la contention est non bornee et
  // aucun timeout raisonnable ne l'absorbe de facon fiable. workers=1
  // supprime la contention a la racine (suite serialisee, un seul worker
  // parle au serveur dev a la fois) - conforme a l'observation de la mission
  // ("tous les tests concernes passent 3/3 en isolation --workers=1").
  // Contrepartie assumee : duree totale de la suite complete plus longue
  // (workers=1 vs 2), au benefice d'une suite reellement verte de facon
  // reproductible (cf. 2 runs complets consecutifs verts exiges plus bas).
  workers: 1,
  // P2.E1 : timeout d'assertion resserre (defaut 5000ms) - la checklist
  // fonctionnelle comporte de nombreuses assertions independantes (expect.soft)
  // par test ; un defaut plus court borne la duree totale du run sans changer
  // la semantique (une assertion qui reussit reussit toujours immediatement).
  // P3B.FIX (reprise 1), BLOQUANT R2 : releve de 2000 a 3000ms - marge de
  // securite conservee meme sous workers=1 (pas de contention inter-worker,
  // mais le serveur dev unique reste partage avec d'eventuels autres process
  // de la machine hote).
  expect: {
    timeout: 3000,
  },
  use: {
    baseURL: 'http://127.0.0.1:9678',
    trace: 'on-first-retry',
    // P2.E1 : une action (click/fill) sur un element rendu inactionnable par
    // l'absence de cablage JS (P2.D non execute, cf. tests/e2e/pctac.spec.ts)
    // ne doit pas monopoliser tout le budget du test (defaut 30s) - elle doit
    // echouer vite pour laisser les etapes suivantes du meme test s'executer
    // (chaque etape est encapsulee individuellement, cf. helper step()).
    // P3B.FIX (reprise 1), BLOQUANT R2 : releve de 2000 a 3000ms, meme
    // justification que expect.timeout ci-dessus.
    actionTimeout: 3000,
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
