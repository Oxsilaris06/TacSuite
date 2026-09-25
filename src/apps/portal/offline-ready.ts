/**
 * offline-ready.ts — Badge « Prêt hors ligne » du portail (décision 28/A7).
 * =========================================================================
 *
 * Pour PC-Tac et l'OI, le portail indique si l'application est réellement
 * utilisable au départ :
 *
 *   - « Prêt hors ligne » si un service worker ACTIF contrôle la page ET si le
 *     précache contient la page de l'application (`caches.match`) ;
 *   - « À ouvrir une fois en ligne avant départ » sinon.
 *
 * On interroge le cache avec `ignoreSearch: true` : les entrées de précache
 * Workbox portent une query `__WB_REVISION__`, et l'URL demandée peut être le
 * dossier (`/pctac/`) ou son `index.html`.
 */

/** Candides à chercher dans le précache pour une page d'application. */
export function offlineCandidates(pageUrl: string): string[] {
    const dir = pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`;
    const out = [dir];
    if (!dir.endsWith('index.html')) out.push(`${dir}index.html`);
    return out;
}

/** Surface minimale de `caches` réellement utilisée. */
export interface CachesLike {
    match(request: string, options?: { ignoreSearch?: boolean }): Promise<unknown>;
}

export interface OfflineCheckDeps {
    /** `navigator.serviceWorker` (simulé en test). */
    serviceWorker?: { controller: unknown } | null;
    /** `caches` (simulé en test). */
    caches?: CachesLike | null;
}

/** Vrai si la page est servie hors ligne : SW actif + page précachée. */
export async function isPageReadyOffline(pageUrl: string, deps: OfflineCheckDeps = {}): Promise<boolean> {
    const sw = deps.serviceWorker !== undefined
        ? deps.serviceWorker
        : (typeof navigator !== 'undefined' ? navigator.serviceWorker : null);
    if (!sw || !sw.controller) return false;

    const cache = deps.caches !== undefined
        ? deps.caches
        : (typeof caches !== 'undefined' ? caches : null);
    if (!cache || typeof cache.match !== 'function') return false;

    for (const candidate of offlineCandidates(pageUrl)) {
        try {
            const hit = await cache.match(candidate, { ignoreSearch: true });
            if (hit) return true;
        } catch {
            // Une erreur de cache ne doit pas conclure à tort : on continue.
        }
    }
    return false;
}

export interface OfflineBadgeApp {
    /** Id de l'élément badge dans le portail. */
    badgeId: string;
    /** URL de la page de l'application (ex. `.../pctac/`). */
    pageUrl: string;
}

const READY_LABEL = 'Prêt hors ligne';
const NOT_READY_LABEL = 'À ouvrir une fois en ligne avant départ';

/** Met à jour un badge et rend l'état calculé. */
export async function renderOfflineBadge(app: OfflineBadgeApp, deps: OfflineCheckDeps = {}): Promise<boolean> {
    const ready = await isPageReadyOffline(app.pageUrl, deps);
    const el = typeof document !== 'undefined' ? document.getElementById(app.badgeId) : null;
    if (el) {
        el.dataset.ready = String(ready);
        const label = el.querySelector<HTMLElement>('.offline-badge__label');
        if (label) label.textContent = ready ? READY_LABEL : NOT_READY_LABEL;
        el.title = ready
            ? "Cette application est installée pour un usage hors connexion."
            : "Ouvrez cette application une fois en ligne (avec la connexion active) avant de partir.";
    }
    return ready;
}

/** Renseigne les badges des applications du portail (fire-and-forget). */
export function initOfflineBadges(apps: readonly OfflineBadgeApp[], deps: OfflineCheckDeps = {}): void {
    apps.forEach((app) => { void renderOfflineBadge(app, deps); });
}
