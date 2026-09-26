/**
 * sw-routes.ts — Correspondances de routes et protocole du service worker.
 *
 * Ces fonctions sont PURES et exportées pour être testables sans exécuter le
 * service worker. `public/sw.ts` les importe ; le module ne dépend d'aucun
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

/* -------------------------------------------------------------------------
 * Protocole de transition du service worker (A-2)
 *
 * Les appareils déjà installés ont l'ancien SW (qui appelait `skipWaiting()` à
 * l'installation) et l'ancien code de page (qui ne propose PAS « Recharger »).
 * Avec le nouveau SW qui attend sagement, un tel appareil resterait bloqué sur
 * l'ancienne version jusqu'à la fermeture de TOUS ses onglets.
 *
 * Remède : une MARQUE de protocole, posée en cache à l'ACTIVATION du nouveau
 * worker. À l'installation, si un worker est DÉJÀ actif ET que la marque est
 * absente (donc l'actif est un ancien SW), on `skipWaiting()` une dernière fois.
 * Ensuite la marque existe : les mises à jour suivantes attendent le clic
 * « Recharger » (décision 28).
 * ------------------------------------------------------------------------- */

/** Cache dédié à la marque de protocole (une seule entrée). */
export const SW_PROTOCOL_CACHE = 'tacsuite-sw-protocol';

/** URL de la marque, dans {@link SW_PROTOCOL_CACHE}. */
export const SW_PROTOCOL_MARK_URL = '/__tacsuite_sw_protocol';
/**
 * Marque posée à l'activation par un worker qui sert les polices depuis le
 * précache (Nico 2026-09-26). Sans elle, une police trouvée au précache peut
 * venir d'un worker encore EN ATTENTE (décision 28) : l'ancien worker actif
 * ne la servirait pas, et le badge « Prêt hors ligne » mentirait.
 */
export const SW_FONTS_MARK_URL = '/__tacsuite_fonts_precached';

/**
 * Faut-il forcer l'activation à l'installation ?
 *
 * Vrai seulement quand un worker ACTIF existe (mise à jour, pas première
 * installation) ET que la marque de protocole est absente (l'actif est une
 * ancienne version sans protocole). Fonction pure, testée sans navigateur.
 */
export function shouldSkipWaitingOnInstall(hasActiveWorker: boolean, hasProtocolMark: boolean): boolean {
    return hasActiveWorker && !hasProtocolMark;
}

/**
 * A13 (revue du 25/09) — navigation : faut-il servir la réponse réseau ?
 * Une erreur SERVEUR (5xx : relais tombé derrière le Funnel, 502) n'est pas
 * une page ; la copie précachée prend le relais, comme hors ligne. Un 404 ou
 * un 304 restent des réponses légitimes.
 */
export function serveFromNetwork(status: number): boolean {
    return status < 500;
}
