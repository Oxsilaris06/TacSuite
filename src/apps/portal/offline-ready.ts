/**
 * offline-ready.ts — Badge « Prêt hors ligne » du portail (décision 28/A7).
 * =========================================================================
 *
 * Pour PC-Tac et l'OI, le portail indique si l'application est réellement
 * utilisable au départ :
 *
 *   - « Prêt hors ligne » si un service worker ACTIF contrôle la page ET si le
 *     précache contient la page de l'application (`caches.match`) ;
 *   - rien sinon : le badge est masqué (Nico, 09-25 : le message « À ouvrir
 *     une fois en ligne avant départ » est supprimé).
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

/** Surface minimale d'un cache nommé (`caches.open(...)`). */
export interface CacheLike {
    keys(): Promise<Array<{ url?: string } | string>>;
}

/** Surface minimale de `caches` réellement utilisée. */
export interface CachesLike {
    match(request: string, options?: { ignoreSearch?: boolean }): Promise<unknown>;
    /** Optionnel : son absence empêche seulement de vérifier la police. */
    open?(name: string): Promise<CacheLike>;
}

export interface OfflineCheckDeps {
    /** `navigator.serviceWorker` (simulé en test). */
    serviceWorker?: { controller: unknown } | null;
    /** `caches` (simulé en test). */
    caches?: CachesLike | null;
}

/** Cache des polices (runtime `StaleWhileRevalidate`, cf. public/sw.ts). */
export const FONT_CACHE_NAME = 'tacsuite-fonts';
/** Une entrée de ce cache porte le nom du fichier de la police d'icônes. */
const ICON_FONT_RE = /material-symbols/i;

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

/**
 * La police d'icônes Material Symbols est-elle en cache ? Elles vit dans
 * `tacsuite-fonts`, alimenté à la PREMIÈRE ouverture de PC-Tac ou de l'OI
 * (elle est exclue du précache, cf. vite.config.ts). Tant qu'elle manque,
 * l'application s'ouvre hors ligne mais tous les boutons à icône seule
 * affichent le mot de ligature (« delete », « edit »…).
 *
 * Rend `null` si l'API ne permet pas de conclure (pas de `caches.open`) : on
 * retombe alors sur l'ancien critère page + contrôleur, pour ne pas bloquer à
 * tort un navigateur qui ne sait pas inspecter le cache nommé.
 */
export async function hasIconFontCached(deps: OfflineCheckDeps = {}): Promise<boolean | null> {
    const cache = deps.caches !== undefined
        ? deps.caches
        : (typeof caches !== 'undefined' ? caches : null);
    if (!cache || typeof cache.open !== 'function') return null;
    try {
        const fontCache = await cache.open(FONT_CACHE_NAME);
        if (!fontCache || typeof fontCache.keys !== 'function') return null;
        const keys = await fontCache.keys();
        return keys.some((k) => ICON_FONT_RE.test(typeof k === 'string' ? k : (k.url ?? '')));
    } catch {
        return null;
    }
}

/**
 * Vrai si l'APPLICATION est réellement prête hors ligne : page précachée ET
 * police d'icônes présente. C'est ce critère qui pilote le badge du portail
 * (R11) : sans la police, l'appli « prête » s'afficherait sans ses icônes.
 */
export async function isAppReadyOffline(pageUrl: string, deps: OfflineCheckDeps = {}): Promise<boolean> {
    if (!(await isPageReadyOffline(pageUrl, deps))) return false;
    const icons = await hasIconFontCached(deps);
    return icons !== false;
}

export interface OfflineBadgeApp {
    /** Id de l'élément badge dans le portail. */
    badgeId: string;
    /** URL de la page de l'application (ex. `.../pctac/`). */
    pageUrl: string;
}

const READY_LABEL = 'Prêt hors ligne';

/** Met à jour un badge et rend l'état calculé. */
export async function renderOfflineBadge(app: OfflineBadgeApp, deps: OfflineCheckDeps = {}): Promise<boolean> {
    const ready = await isAppReadyOffline(app.pageUrl, deps);
    const el = typeof document !== 'undefined' ? document.getElementById(app.badgeId) : null;
    if (el) {
        el.dataset.ready = String(ready);
        // Pas prête : badge masqué, aucun message (décision de Nico du 09-25).
        el.hidden = !ready;
        const label = el.querySelector<HTMLElement>('.offline-badge__label');
        if (label) label.textContent = ready ? READY_LABEL : '';
        if (ready) el.title = 'Cette application est installée pour un usage hors connexion.';
        else el.removeAttribute('title');
    }
    return ready;
}

/** Renseigne les badges des applications du portail (fire-and-forget). */
export function initOfflineBadges(apps: readonly OfflineBadgeApp[], deps: OfflineCheckDeps = {}): void {
    const refresh = (): void => apps.forEach((app) => { void renderOfflineBadge(app, deps); });
    refresh();

    // R11 : réévaluer à la prise de contrôle par le service worker : à la toute
    // première visite, le badge apparaît dès que l'application est prête.
    const sw = deps.serviceWorker !== undefined
        ? deps.serviceWorker
        : (typeof navigator !== 'undefined' ? navigator.serviceWorker : null);
    const target = sw as { addEventListener?: (type: string, cb: () => void) => void } | null;
    if (target && typeof target.addEventListener === 'function') {
        target.addEventListener('controllerchange', refresh);
    }
}
