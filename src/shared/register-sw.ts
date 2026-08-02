// Enregistrement du Service Worker (PWA, offline-fallback) — Phase 4.B.
// Module partage : la logique d'enregistrement est identique pour les trois
// pages (portail, pctac, oi), seul le prefixe des `console.log` differe.
//
// IMPORTANT (multi-page) : le SW est buildé UNE FOIS à la racine (`/sw.js`),
// mais les trois pages vivent a des URLs differentes (`/`, `/pctac/`, `/oi/`).
// `register('sw.js')` (URL relative) resoudrait sw.js relativement au
// DOCUMENT courant — depuis pctac/index.html cela viserait `/pctac/sw.js`
// (404). On construit donc l'URL absolue via `import.meta.env.BASE_URL`
// (toujours terminee par `/`, reflete `base` de vite.config.ts — cf.
// TACSUITE_BASE pour un deploiement en sous-chemin type GitHub Pages), et on
// fixe explicitement `scope` sur cette meme base : sans cela, le scope par
// defaut d'un enregistrement depuis pctac/ serait limite a `/pctac/` et ne
// couvrirait pas les navigations vers `/` ou `/oi/`.
export function registerServiceWorker(label: string): void {
    if (!('serviceWorker' in navigator)) return;

    // `npm run dev` (Vite dev server) ne construit aucun `sw.js` (devOptions
    // de VitePWA laissé à `enabled: false`, cf. vite.config.ts) : un
    // enregistrement y échouerait systématiquement en 404, et le navigateur
    // journalise CETTE erreur-là de lui-même (indépendamment du `.catch()`
    // ci-dessous) — bruit de console constant en dev, absent avant P4.B. Le
    // SW n'a de sens qu'une fois buildé (`npm run build` + `preview`, ou
    // hébergement statique réel) : on saute l'enregistrement en dev.
    if (import.meta.env.DEV) return;

    const swUrl = `${import.meta.env.BASE_URL}sw.js`;

    navigator.serviceWorker
        .register(swUrl, { scope: import.meta.env.BASE_URL })
        .then((registration) => {
            console.log(`[PWA:${label}] Service Worker enregistré:`, registration);
        })
        .catch((err) => {
            // Silencieux en échec (404, contexte non sécurisé, etc.) — aucune
            // régression observable : rien ne s'enregistre, ni avant ni après.
            console.warn(`[PWA:${label}] Enregistrement SW échoué:`, err);
        });
}
