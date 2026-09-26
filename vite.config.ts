import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Sécurité du serveur de DÉVELOPPEMENT (revue du 2026-09-26) : il est joignable
// hors de la machine (écoute réseau, démonstration par Funnel) alors que le
// dossier du dépôt contient des fichiers locaux non versionnés (registres,
// notes, jetons du relais, rapports d'essai, outillage). Liste d'AUTORISATION,
// fermée par défaut : seuls les dossiers de l'application sont servis ; un
// fichier ajouté plus tard à la racine reste privé sans rien retoucher ici. La
// liste de refus reste en seconde barrière (secrets, dépôt git, notes).
const APP_DIRS = ['index.html', 'pctac', 'oi', 'src', 'styles', 'public', 'node_modules'];
export const DEV_SERVER_FS = {
  strict: true,
  allow: APP_DIRS.map((p) => fileURLToPath(new URL(`./${p}`, import.meta.url))),
  // Seconde barrière : ce qui pourrait se glisser DANS un dossier autorisé.
  // Pas de motif sur un nom de dossier (« **/.ai/** », « **/docs/** ») : Vite
  // compare le chemin absolu, et un tel motif refuserait tout un worktree
  // rangé sous ~/.ai ou un dépôt cloné sous ~/docs ; les dossiers de la racine
  // hors application sont déjà exclus par `allow`.
  deny: [
    '.env', '.env.*', '*.{crt,pem,key}', '**/.git/**',
    '*.md', '*.yaml', '*.yml', '*.log', 'entities.json', 'tokens.json', 'vite.funnel*.config.ts',
    '**/node_modules/playwright*/**',
  ],
};

// `/__open-in-editor` ouvre un fichier dans l'éditeur du poste. Vite le monte par
// connect, qui compare le chemin sans tenir compte de la casse : la garde fait
// de même, après décodage des %XX.
export function isEditorRequest(url: string): boolean {
  const pathname = url.split('?')[0] ?? '';
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* %XX invalide : chemin brut */ }
  return decoded.toLowerCase().includes('/__open-in-editor');
}

const devServerGuard: Plugin = {
  name: 'tacsuite-dev-server-guard',
  apply: 'serve',
  configureServer(server) {
    // Posé AVANT les middlewares internes de Vite (appel direct, pas de retour).
    server.middlewares.use((req, res, next) => {
      if (isEditorRequest(req.url ?? '')) {
        res.statusCode = 403;
        res.end('Interdit');
        return;
      }
      next();
    });
  },
};

// Multi-page app: portail + PC-Tac + Generateur d'OI.
// base est parametrable via TACSUITE_BASE (ex: '/TacSuite/' pour GitHub Pages).
export default defineConfig({
  base: process.env.TACSUITE_BASE ?? '/',
  // Vitest charge ses modules par ce même serveur (dont tools/osmand-relay) : les
  // listes ne valent que pour le serveur de développement.
  server: process.env.VITEST ? {} : { fs: DEV_SERVER_FS },
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
    devServerGuard,
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
        // Polices woff2 PRECACHEES (Nico 2026-09-26) : une premiere visite en
        // ligne, portail compris, suffit pour que PC-Tac et l'OI s'ouvrent hors
        // ligne avec leurs icones (Material Symbols, ~4 Mo) et leurs polices.
        // Avant, elles n'entraient en cache qu'a l'ouverture de chaque appli.
        // Les .woff (repli des vieux navigateurs) restent au cache d'execution
        // de public/sw.ts.
        globPatterns: [
          'index.html',
          'pctac/index.html',
          'oi/index.html',
          'assets/**/*.{js,mjs,css,woff2}',
          'manifest.webmanifest',
          'favicon.ico',
          '*.png',
          'portal/*.webp',
        ],
        globIgnores: ['**/*.map'],
        // Le nouveau moteur PDF vectoriel embarque pdfmake (~1,4 Mo brut) et le VFS des
        // polices Oswald/JetBrains Mono en base64 (~415 Ko) dans des chunks JavaScript
        // dedies (import dynamique). Ces chunks sont deja couverts par le motif
        // 'assets/**/*.{js,mjs,css}'. Le worker pdf.js (apercu PDF integre) est importe
        // via `?worker&url` et NON `?url` : Vite le BUNDLE et l'emet en `.js` (~1,2 Mo)
        // au lieu de recopier tel quel le `.mjs` de pdfjs-dist. Raison : ce `.mjs`
        // etait la SEULE extension non standard servie par TacSuite, et le SEUL fichier
        // recupere au moment du clic — un filtrage de parc qui l'ecarte cassait
        // l'apercu alors que tout le reste de l'application continuait de marcher.
        // `mjs` reste dans le motif par precaution (une dependance future pourrait en
        // reintroduire un). La limite Workbox par defaut de 2 Mio par fichier est
        // relevee pour que le worker et les chunks pdfmake entrent au precache — sans
        // quoi la generation et l'apercu PDF hors ligne seraient silencieusement casses.
        // Taille reelle mesuree du plus gros chunk (phase build actuelle) : ~1,4 Mo.
        // Relevee a 5 Mio pour la police d'icones Material Symbols (~3,8 Mio).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
});
