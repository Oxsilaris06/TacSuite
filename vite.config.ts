import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Multi-page app: portail + PC-Tac + Generateur d'OI.
// base est parametrable via TACSUITE_BASE (ex: '/TacSuite/' pour GitHub Pages).
export default defineConfig({
  base: process.env.TACSUITE_BASE ?? '/',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@pctac': fileURLToPath(new URL('./src/apps/pctac', import.meta.url)),
      '@oi': fileURLToPath(new URL('./src/apps/oi', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        pctac: fileURLToPath(new URL('./pctac/index.html', import.meta.url)),
        oi: fileURLToPath(new URL('./oi/index.html', import.meta.url)),
      },
    },
  },
});
