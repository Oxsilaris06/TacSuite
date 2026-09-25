/**
 * lotA-sw-routes.ts — Correspondances de routes du service worker (lot A/A2).
 *
 * Ces fonctions sont PURES et exportées pour être testables sans exécuter le
 * service worker. `public/sw.ts` les importe ; la fonction ne dépend d'aucun
 * module Workbox, donc son import dans le bundle du worker reste trivial.
 */

/** Fournisseurs de tuiles hors `data.geopf.fr` : le domaine entier est en tuiles. */
export const OTHER_TILE_HOSTS =
    /^https:\/\/(server\.arcgisonline\.com|elevation-tiles-prod\.s3\.amazonaws\.com|tiles\.openfreemap\.org)\//;

/**
 * Vrai si `url` désigne une TUILE cartographique à mettre en cache.
 *
 * `data.geopf.fr` est restreint à ses chemins de tuiles (`/wmts`, `/tms`) : la
 * même plateforme sert aussi la recherche d'adresse (`/geocodage/search`,
 * successeur de l'API Adresse, décision 35). Une recherche d'adresse est une
 * donnée VOLATILE : la mettre en cache 30 jours rendrait des résultats périmés
 * et ferait servir « Paris » pour une requête suivante.
 */
export function isTileRequest(url: URL): boolean {
    if (url.hostname === 'data.geopf.fr') {
        return /^\/(?:wmts|tms)(?:\/|$)/.test(url.pathname);
    }
    return OTHER_TILE_HOSTS.test(url.href);
}
