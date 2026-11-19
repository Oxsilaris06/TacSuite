/**
 * storage-persistence.ts — persistance du stockage, partagée OI + PC-Tac.
 * =====================================================================
 *
 * La persistance vaut pour toute l'ORIGINE : une page qui ne la demande jamais
 * laisse le navigateur libre d'effacer les données (stockage plein, inactivité,
 * Safari iOS après 7 jours). PC-Tac la demandait déjà (`device-guard.ts`) ; ce
 * module porte la logique pour que l'OI la demande aussi.
 *
 * Comportement (décision 28) : `persisted()` est lu ; s'il est faux, `persist()`
 * est demandé. Un refus (ou l'absence de l'API) affiche un bandeau
 * « important » expliquant le risque, avec l'action « Exporter l'archive ».
 * L'état est rendu visible par une pastille injectée dans le dock. Rien ici ne
 * dépend de PC-Tac ni de l'OI : l'export d'archive est injecté.
 *
 * Le bandeau de persistance n'est affiché qu'UNE fois par session (A-3) : sans
 * cette mémoire, Chrome refuse `persist()` à un site non installé et le bandeau
 * reviendrait à chaque chargement. La pastille du dock reste l'état permanent.
 */

import { showBanner, toast } from '@shared/feedback.js';

/** Surface minimale de `navigator.storage` réellement utilisée. */
export interface StorageManagerLike {
    persisted?: () => Promise<boolean>;
    persist?: () => Promise<boolean>;
    estimate?: () => Promise<{ quota?: number; usage?: number } | null>;
}

export const PERSIST_BANNER_ID = 'device-persist';
export const STORAGE_BADGE_ID = 'deviceStorageBadge';
/**
 * Clé `sessionStorage` mémorisant que l'opérateur a fermé le bandeau de
 * persistance (A-3). Chrome refuse `persist()` à un site non installé : sans
 * cette mémoire, le bandeau reviendrait à CHAQUE chargement de la session. La
 * pastille du dock reste, elle, l'état permanent.
 */
export const PERSIST_BANNER_SESSION_KEY = 'pcTacPersistBannerDismissed';

function persistBannerDismissed(): boolean {
    try { return sessionStorage.getItem(PERSIST_BANNER_SESSION_KEY) === '1'; } catch { return false; }
}

function markPersistBannerDismissed(): void {
    try { sessionStorage.setItem(PERSIST_BANNER_SESSION_KEY, '1'); } catch { /* best-effort */ }
}

/** Options du garde-fou de persistance (injectables en test). */
export interface PersistenceDeps {
    storageManager?: StorageManagerLike | null;
    show?: typeof showBanner;
    /** Export d'archive déclenché par l'action du bandeau. */
    exportArchive?: () => Promise<boolean>;
    /** Dock accueillant la pastille d'état. */
    dock?: HTMLElement | null;
    /** Le bandeau de persistance a-t-il déjà été fermé dans cette session ? */
    isPersistBannerDismissed?: () => boolean;
    /** Mémorise la fermeture du bandeau de persistance pour la session. */
    onPersistBannerDismissed?: () => void;
    /** Page ouverte dans un onglet Safari iOS (hors écran d'accueil) ? */
    isIosBrowserTab?: () => boolean;
}

/** iOS n'accorde la persistance qu'aux apps ajoutées à l'écran d'accueil. */
export function isIosBrowserTab(): boolean {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!ios) return false;
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
        || window.matchMedia?.('(display-mode: standalone)').matches === true;
    return !standalone;
}

export const PERSIST_MESSAGE =
    "Le stockage n'est pas persistant : le navigateur peut effacer vos données (stockage plein, inactivité) sans prévenir. Installez l'application ou exportez l'archive.";
export const PERSIST_MESSAGE_IOS =
    "Le stockage n'est pas persistant : Safari peut effacer vos données sans prévenir. Sur iPhone, seule l'application installée le garde : touchez Partager, puis « Sur l'écran d'accueil », et ouvrez-la depuis son icône. Les données de cet onglet ne passent pas dans l'application installée : exportez l'archive avant de l'installer, puis importez-la dans l'application. Sinon, exportez l'archive.";

/**
 * Affiche le bandeau de persistance refusée (ou d'API absente). Ne réapparaît
 * pas si l'opérateur l'a déjà fermé dans cette session (A-3) ; la pastille du
 * dock continue de porter l'état permanent.
 */
export function showPersistenceBanner(deps: PersistenceDeps = {}): void {
    const isDismissed = deps.isPersistBannerDismissed ?? persistBannerDismissed;
    if (isDismissed()) return;
    const show = deps.show ?? showBanner;
    // Sans export injecté, l'action reste inerte : un clic ne doit jamais jeter.
    const exportArchive = deps.exportArchive ?? (async () => false);
    const onDismiss = deps.onPersistBannerDismissed ?? markPersistBannerDismissed;
    show(PERSIST_BANNER_ID, {
        message: (deps.isIosBrowserTab ?? isIosBrowserTab)() ? PERSIST_MESSAGE_IOS : PERSIST_MESSAGE,
        level: 'important',
        actions: [{ label: "Exporter l'archive", onClick: () => { void exportArchive(); } }],
        onDismiss,
    });
}

/**
 * Injecte (ou rafraîchit) la pastille d'état du stockage dans le dock.
 * Le HTML de la page n'est PAS modifié : l'élément est créé par JS. Il reste
 * sobre (point coloré + infobulle) pour ne pas concurrencer les outils.
 */
export function mountStorageBadge(dock: HTMLElement | null | undefined, persisted: boolean): HTMLElement | null {
    if (!dock) return null;
    let badge = dock.querySelector<HTMLElement>(`#${STORAGE_BADGE_ID}`);
    if (!badge) {
        // Bouton (et non span inerte) : l'infobulle s'affiche au survol, et un
        // toucher explique l'état sur tablette et téléphone, sans infobulle.
        const button = document.createElement('button');
        button.type = 'button';
        badge = button;
        badge.id = STORAGE_BADGE_ID;
        badge.className = 'dock-menu-item device-storage-badge';
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';
        badge.style.padding = '0 8px';
        button.addEventListener('click', () => {
            toast(button.title, { kind: button.dataset.persisted === 'true' ? 'info' : 'error', duration: 8000 });
        });
        const dot = document.createElement('span');
        dot.className = 'device-storage-badge__dot';
        dot.style.width = '10px';
        dot.style.height = '10px';
        dot.style.borderRadius = '50%';
        dot.setAttribute('aria-hidden', 'true');
        badge.appendChild(dot);
        dock.appendChild(badge);
    }
    badge.dataset.persisted = String(persisted);
    const title = persisted
        ? 'Stockage persistant : le navigateur ne devrait pas effacer vos données.'
        : "Stockage NON persistant : le navigateur peut effacer vos données. Exportez une archive.";
    badge.title = title;
    badge.setAttribute('aria-label', title);
    const dot = badge.querySelector<HTMLElement>('.device-storage-badge__dot');
    if (dot) dot.style.background = persisted ? '#22c55e' : '#f97316';
    return badge;
}

/**
 * Demande la persistance puis rend l'état final :
 *  - `persisted` : le stockage est persistant ;
 *  - `refused` : refusé, ou API absente (même traitement).
 * Ne jette jamais.
 */
export async function ensurePersistence(
    storage: StorageManagerLike | null | undefined,
): Promise<{ persisted: boolean; refused: boolean }> {
    if (!storage || typeof storage.persisted !== 'function' || typeof storage.persist !== 'function') {
        return { persisted: false, refused: true };
    }
    let persisted = false;
    try {
        persisted = await storage.persisted();
    } catch {
        persisted = false;
    }
    if (persisted) return { persisted: true, refused: false };
    try {
        persisted = await storage.persist();
    } catch {
        persisted = false;
    }
    return { persisted, refused: !persisted };
}

/**
 * Garde-fou de persistance d'un point d'entrée : résout `navigator.storage` et
 * `#dockMenu` par défaut, demande la persistance, monte la pastille et affiche
 * le bandeau si elle est refusée. Ne jette jamais (le démarrage de la page ne
 * dépend pas de ce garde-fou).
 */
export async function initPersistenceGuard(deps: PersistenceDeps = {}): Promise<void> {
    const storage = deps.storageManager !== undefined
        ? deps.storageManager
        : (typeof navigator !== 'undefined' ? (navigator.storage as StorageManagerLike | undefined) : undefined);
    const dock = deps.dock !== undefined ? deps.dock : (typeof document !== 'undefined' ? document.getElementById('dockMenu') : null);
    try {
        const { persisted, refused } = await ensurePersistence(storage ?? null);
        mountStorageBadge(dock, persisted);
        if (refused) showPersistenceBanner(deps);
    } catch (e) {
        console.warn('[storage-persistence] garde-fou stockage en échec:', e);
    }
}
