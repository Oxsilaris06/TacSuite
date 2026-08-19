import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    VitePWA({
      // SW maison (public/sw.ts) plutot qu'un SW genere : controle explicite
      // du routage (tuiles carto exclues, secours de navigation par page).
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.ts', // resolu en public/sw.ts -> dist/sw.js (conversion auto .ts -> .js)

      // Enregistrement manuel dans chaque main.ts (pctac/oi/portail) : pas
      // d'injection automatique de script d'enregistrement par le plugin.
      injectRegister: false,
      registerType: 'autoUpdate',

      // public/manifest.webmanifest existe deja, complet (16 icones toutes
      // tailles/plateformes) et deja reference par <link rel="manifest"> dans
      // pctac/index.html et oi/index.html. On le laisse tel quel (copie
      // verbatim via publicDir de Vite) plutot que de laisser le plugin en
      // regenerer un concurrent.
      manifest: false,

      injectManifest: {
        // Fichiers buildes a precacher (chemins relatifs a dist/, cf. structure
        // reelle observee : index.html + pctac/index.html + oi/index.html a la
        // racine de chaque dossier, assets/**, icones et manifest a la racine).
        // Polices (assets/**/*.{woff,woff2}) volontairement EXCLUES du precache
        // statique : la police Material Symbols pese ~4 Mo (glyphes variables),
        // au-dela de la limite Workbox (2 Mo/fichier) — cf. runtime caching
        // StaleWhileRevalidate dans public/sw.ts (mise en cache opportuniste
        // des polices memes origine, sans limite de taille par fichier).
        globPatterns: [
          'index.html',
          'pctac/index.html',
          'oi/index.html',
          'assets/**/*.{js,mjs,css}',
          'manifest.webmanifest',
          'favicon.ico',
          '*.png',
          'portal/*.webp',
        ],
        globIgnores: ['**/*.map'],
        // Le nouveau moteur PDF vectoriel embarque pdfmake (~1,4 Mo brut) et le VFS des
        // polices Oswald/JetBrains Mono en base64 (~415 Ko) dans des chunks JavaScript
        // dedies (import dynamique). Ces chunks sont deja couverts par le motif
        // 'assets/**/*.{js,mjs,css}'. Le worker pdf.js (aperçu PDF intégré,
        // SPEC-2026-08-18-pdf-et-champs.md §1) est importé via `?url` — Vite le copie
        // TEL QUEL en .mjs dans assets/ (pas de bundling/minification par Vite, pdf.js
        // livre deja sa propre version minifiee `pdf.worker.min.mjs`, ~1,3 Mo) : sans
        // l'extension `mjs` dans ce motif, ce fichier resterait hors precache et
        // l'apercu casserait au premier chargement hors ligne. La limite Workbox par
        // defaut de 2 Mio par fichier est relevee pour garantir qu'il entre, comme les
        // chunks pdfmake — sans quoi la generation/l'apercu PDF hors ligne seraient
        // silencieusement casses.
        // Taille reelle mesuree du plus gros chunk (phase build actuelle) : ~1,4 Mo.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
});
