/**
 * public/sw.ts — Service Worker TacSuite (Phase 4.B).
 * ====================================================================
 * Port du routage GStart-main/sw.js vers Workbox (vite-plugin-pwa, mode
 * injectManifest). Trois stratégies, une par nature de ressource :
 *
 *  1. Précache + réponse directe : tous les assets buildés (JS/CSS/HTML/
 *     icônes) listés dans le manifest injecté par vite-plugin-pwa
 *     (`self.__WB_MANIFEST`, généré depuis `injectManifest.globPatterns`
 *     dans vite.config.ts) — géré automatiquement par `precacheAndRoute`.
 *  2. Cache-first + expiration : tuiles cartographiques (4 fournisseurs
 *     CDN externes, cf. src/apps/{pctac,oi}/**\/constants.ts). Ces tuiles
 *     ne sont PAS dans le build `dist/` — routées ici en `runtime`, hors
 *     du manifest précaché.
 *  3. Réseau d'abord, secours précache : navigations (chargement/rechargement
 *     de page). Chaque page hors-ligne récupère SA PROPRE copie précachée
 *     (index.html / pctac/index.html / oi/index.html), pas une page générique
 *     — résolu via `matchPrecache`, qui applique la même résolution
 *     "répertoire → index.html" que Workbox utilise pour le précache.
 *
 * IMPORTANT : la chaîne `self.__WB_MANIFEST` ci-dessous doit rester
 * TEXTUELLEMENT inchangée — c'est le point d'injection par défaut de
 * workbox-build (`injectionPoint`), recherché tel quel dans ce fichier
 * source au build. La renommer casse l'injection (erreur de build).
 */

import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

// ── 1. Précachage du manifest injecté (assets buildés). ─────────────
// Nettoie les caches des versions précédentes puis précache + route la
// version courante. Workbox gère les noms de cache versionnés.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── 2. Tuiles cartographiques : cache-first, expiration bornée. ─────
// Fournisseurs réels (cf. planmap/constants.ts et carto/constants.ts) :
// arcgisonline (satellite), data.geopf.fr (ortho/BD TOPO), elevation-tiles
// (relief), tiles.openfreemap.org (fond vecteur + polices glyphes).
const TILE_HOSTS = /^https:\/\/(server\.arcgisonline\.com|data\.geopf\.fr|elevation-tiles-prod\.s3\.amazonaws\.com|tiles\.openfreemap\.org)\//;

registerRoute(
    ({ url }) => TILE_HOSTS.test(url.href),
    new CacheFirst({
        cacheName: 'tacsuite-map-tiles',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 jours
                purgeOnQuotaError: true,
            }),
        ],
    }),
);

// ── Polices même origine : mise en cache opportuniste (première requête). ──
// Exclues du précache statique (cf. injectManifest.globPatterns dans
// vite.config.ts — Material Symbols seul pèse ~4 Mo, au-delà de la limite
// Workbox par fichier). `request.destination === 'font'` couvre .woff/.woff2
// indépendamment du nom de fichier (hashes Vite).
registerRoute(
    ({ request, url }) => request.destination === 'font' && url.origin === self.location.origin,
    new StaleWhileRevalidate({
        cacheName: 'tacsuite-fonts',
        plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 })],
    }),
);

// ── Cycle de vie : mise à jour immédiate (comme GStart-main/sw.js). ─
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            if (self.registration.navigationPreload) {
                try {
                    await self.registration.navigationPreload.enable();
                } catch {
                    // Non bloquant : navigationPreload est une optimisation, pas un
                    // prérequis (le chemin réseau simple ci-dessous reste valide).
                }
            }
            await self.clients.claim();
        })(),
    );
});

// ── 3. Navigations : réseau d'abord, secours sur la copie précachée
// de LA PAGE DEMANDÉE (pas une page générique unique). ───────────────
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.mode !== 'navigate') {
        return; // délégué à precacheAndRoute (assets) / registerRoute (tuiles) ci-dessus
    }

    event.respondWith(
        (async () => {
            try {
                // navigationPreload : réponse pré-lancée par le navigateur en parallèle.
                const preloadResp = await event.preloadResponse;
                if (preloadResp) return preloadResp;
                return await fetch(req);
            } catch {
                // Hors-ligne : sert la page précachée correspondant à l'URL demandée
                // (matchPrecache résout '/pctac/' → 'pctac/index.html', etc.), avec
                // repli sur le portail si l'entrée précise est introuvable.
                const own = (await matchPrecache(req)) ?? (await matchPrecache('index.html'));
                return own ?? new Response('Hors ligne', { status: 503, statusText: 'Offline' });
            }
        })(),
    );
});
