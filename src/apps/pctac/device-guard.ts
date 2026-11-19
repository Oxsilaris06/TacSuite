/**
 * device-guard.ts — Garde-fous d'appareil de PC-Tac (décision 28).
 * =================================================================
 *
 * Trois vérifications au démarrage, toutes SANS bloquer la page :
 *
 *  1. **Persistance du stockage** — `navigator.storage.persist()` demandé si
 *     `persisted()` est faux. Un refus (ou l'absence de l'API) affiche un
 *     bandeau « important » expliquant que le navigateur peut effacer les
 *     données, avec l'action « Exporter l'archive ». L'état est rendu visible
 *     par une pastille injectée dans le dock. La logique vit dans
 *     `@shared/storage-persistence.js` (l'OI la demande aussi) ; elle est
 *     ré-exportée ici pour ses consommateurs PC-Tac et ses tests.
 *  2. **Navigation privée** — aucune API fiable n'existe. On combine deux
 *     signaux documentés : un quota de `navigator.storage.estimate()`
 *     anormalement bas ET une persistance explicitement refusée. Voir
 *     `detectPrivateMode` et ses faux positifs connus. Le bandeau « alerte »
 *     est PERMANENT (non fermable) : en navigation privée, tout est perdu à
 *     la fermeture.
 *  3. **Horloge** — un `HEAD` sur la page elle-même (même origine, pas de
 *     CORS) lit l'en-tête `Date` du serveur, corrigé de la moitié de
 *     l'aller-retour. Un écart supérieur à 2 minutes affiche un bandeau
 *     « important » : les heures de la main courante seraient fausses.
 *
 * Les fonctions publiques acceptent leurs dépendances (stockage, `fetch`,
 * horloge, dock, `showBanner`) pour être testables sans navigateur réel.
 */

import { showBanner } from '@shared/feedback.js';
import {
    ensurePersistence,
    mountStorageBadge,
    showPersistenceBanner,
    type PersistenceDeps,
    type StorageManagerLike,
} from '@shared/storage-persistence.js';

export * from '@shared/storage-persistence.js';

export const PRIVATE_BANNER_ID = 'device-private';
export const CLOCK_BANNER_ID = 'device-clock';

/** Écart d'horloge toléré avant alerte (2 minutes). */
export const CLOCK_TOLERANCE_MS = 2 * 60 * 1000;

/**
 * Seuil de quota « anormalement bas » (navigateur en navigation privée ou
 * stockage fortement contraint). 120 Mio : bien en dessous des quotas usuels
 * (souvent plusieurs Gio), au-dessus de ce qu'un poste peut légitimement avoir
 * sur un appareil très contraint.
 *
 * FAUX POSITIFS CONNUS (signalés, non corrigés) : un appareil en fin de vie
 * avec un quota réellement réduit, un navigateur qui plafonne
 * volontairement le quota d'un site non installé, ou une réponse
 * `estimate()` partielle. Comme le seuil n'est retenu qu'EN PLUS d'un refus de
 * persistance, la probabilité reste faible ; une alerte à tort invite
 * seulement à exporter, ce qui est sans danger.
 */
export const PRIVATE_MODE_QUOTA_THRESHOLD_BYTES = 120 * 1024 * 1024;

export interface PrivateModeSignals {
    /** `quota` rendu par `navigator.storage.estimate()`, ou `null`. */
    quota?: number | null;
    /** `persist()` a explicitement rendu `false` (ou l'API est absente). */
    persistRefused?: boolean;
}

/**
 * Détection best-effort de la navigation privée. Combine un quota bas ET un
 * refus de persistance ; chaque signal seul est trop bruité.
 *
 * « API de stockage absente » (quota `null`) n'est PAS de la navigation
 * privée : `persistRefused` vaut alors vrai, mais le quota manquant suffit à
 * écarter la conclusion.
 */
export function detectPrivateMode(signals: PrivateModeSignals): boolean {
    const quota = signals.quota;
    const lowQuota = typeof quota === 'number' && quota > 0 && quota < PRIVATE_MODE_QUOTA_THRESHOLD_BYTES;
    return lowQuota && signals.persistRefused === true;
}

/** Options des garde-fous restants (horloge, navigation privée). */
export interface DeviceGuardDeps extends PersistenceDeps {
    fetchFn?: typeof fetch;
    /** URL de la page pour la mesure d'horloge (même origine). */
    pageUrl?: string;
    now?: () => number;
}

function defaultExportArchive(): Promise<boolean> {
    // Import dynamique : `device-guard` reste léger au démarrage, et l'archive
    // (JSZip, IndexedDB) n'est chargée qu'au clic.
    return import('@pctac/archive.js')
        .then((m) => m.Archive.exportZip())
        .catch(() => false);
}

/** Affiche le bandeau permanent de navigation privée. */
export function showPrivateModeBanner(deps: DeviceGuardDeps = {}): void {
    const show = deps.show ?? showBanner;
    show(PRIVATE_BANNER_ID, {
        message: 'Navigation privée : tout sera perdu à la fermeture de la fenêtre. Exportez l’archive.',
        level: 'alert',
        dismissible: false,
    });
}

/** Affiche le bandeau d'écart d'horloge (`minutes` est arrondi, >= 2). */
export function showClockBanner(minutes: number, deps: DeviceGuardDeps = {}): void {
    const show = deps.show ?? showBanner;
    show(CLOCK_BANNER_ID, {
        message: `L’horloge de cet appareil a ${minutes} min d’écart avec l’heure réelle : les heures de la main courante seront fausses.`,
        level: 'important',
    });
}

/* -------------------------------------------------------------------------
 * 3. Horloge
 * ------------------------------------------------------------------------- */

/**
 * Mesure l'écart entre l'horloge de l'appareil et celle du serveur, en
 * millisecondes (positif = appareil en retard). Rend `null` si le réseau ou
 * l'en-tête `Date` ne permettent pas de conclure (jamais d'alerte dans ce cas).
 *
 * L'en-tête `Date` n'a qu'une précision d'une seconde : la mesure ne vaut pas
 * mieux. La moitié de l'aller-retour compense l'asymétrie du trajet.
 */
export async function measureClockSkew(
    fetchFn: typeof fetch,
    pageUrl: string,
    now: () => number,
): Promise<number | null> {
    const start = now();
    let res: Response;
    try {
        res = await fetchFn(pageUrl, { method: 'HEAD', cache: 'no-store' });
    } catch {
        return null;
    }
    const end = now();
    // Corps vide (HEAD), mais jamais lu : Chromium abandonne la requête et
    // journalise `net::ERR_ABORTED` au premier chargement.
    try { await res?.text(); } catch { /* corps illisible : la mesure n'en dépend pas */ }
    if (!res || !res.ok) return null;
    const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('Date') : null;
    if (!header) return null;
    const serverMs = Date.parse(header);
    if (!Number.isFinite(serverMs)) return null;
    const rtt = Math.max(0, end - start);
    return serverMs + rtt / 2 - end;
}

/**
 * Mesure l'horloge et alerte au-delà de {@link CLOCK_TOLERANCE_MS}. Hors ligne
 * ou sans en-tête : rien (jamais d'alerte sur une mesure impossible).
 */
export async function checkClock(deps: DeviceGuardDeps = {}): Promise<number | null> {
    const fetchFn = deps.fetchFn ?? (typeof fetch === 'function' ? fetch : null);
    const now = deps.now ?? Date.now;
    const pageUrl = deps.pageUrl ?? (typeof location !== 'undefined' ? location.href : '');
    if (!fetchFn || !pageUrl) return null;
    const skew = await measureClockSkew(fetchFn, pageUrl, now);
    if (skew === null) return null;
    if (Math.abs(skew) <= CLOCK_TOLERANCE_MS) return skew;
    showClockBanner(Math.round(Math.abs(skew) / 60000), deps);
    return skew;
}

/* -------------------------------------------------------------------------
 * Orchestration
 * ------------------------------------------------------------------------- */

/** Exécute les trois garde-fous. Ne jette jamais. */
export async function runDeviceGuard(deps: DeviceGuardDeps = {}): Promise<void> {
    const storage = deps.storageManager !== undefined
        ? deps.storageManager
        : (typeof navigator !== 'undefined' ? (navigator.storage as StorageManagerLike | undefined) : undefined);
    const dock = deps.dock !== undefined ? deps.dock : (typeof document !== 'undefined' ? document.getElementById('dockMenu') : null);

    // 1) Persistance + pastille.
    try {
        const { persisted, refused } = await ensurePersistence(storage ?? null);
        mountStorageBadge(dock, persisted);
        if (refused) {
            showPersistenceBanner({ ...deps, exportArchive: deps.exportArchive ?? defaultExportArchive });
        }

        // 2) Navigation privée : besoin du quota ET du refus.
        let quota: number | null = null;
        if (storage && typeof storage.estimate === 'function') {
            try {
                const est = await storage.estimate();
                quota = est && typeof est.quota === 'number' ? est.quota : null;
            } catch {
                quota = null;
            }
        }
        if (detectPrivateMode({ quota, persistRefused: refused })) showPrivateModeBanner(deps);
    } catch (e) {
        // Les garde-fous ne doivent jamais empêcher PC-Tac de démarrer.
        console.warn('[device-guard] garde-fou stockage en échec:', e);
    }

    // 3) Horloge.
    try {
        await checkClock(deps);
    } catch (e) {
        console.warn('[device-guard] garde-fou horloge en échec:', e);
    }
}

/** Branche les garde-fous d'appareil. Appelé au démarrage de PC-Tac.
 *  L'horloge est revérifiée au retour en ligne. */
export function initDeviceGuard(deps: DeviceGuardDeps = {}): void {
    void runDeviceGuard(deps);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('online', () => {
            void checkClock(deps);
        });
    }
}
