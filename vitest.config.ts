import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    // Polyfill localStorage/sessionStorage : voir tests/setup.ts pour le
    // contexte (Node >=22 expose un localStorage natif non fonctionnel qui
    // masque celui de jsdom).
    setupFiles: ['./tests/setup.ts'],
  },
});
