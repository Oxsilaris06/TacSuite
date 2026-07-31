import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.js';

// Reprend les alias @shared/@pctac/@oi de vite.config.ts (resolve.alias) pour
// que les tests puissent importer les modules comme le fait le code applicatif.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.ts'],
      // Polyfill localStorage/sessionStorage : voir tests/setup.ts pour le
      // contexte (Node >=22 expose un localStorage natif non fonctionnel qui
      // masque celui de jsdom).
      setupFiles: ['./tests/setup.ts'],
    },
  }),
);
