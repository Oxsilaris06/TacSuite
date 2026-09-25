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
//
// Décision 28 : une nouvelle version ne prend JAMAIS la main sous une page
// ouverte. Le service worker reste en attente (`public/sw.ts` n'appelle plus
// `skipWaiting()` à l'installation) et la page propose « Nouvelle version
// prête — Recharger ». Un onglet qui n'a pas cliqué et reçoit malgré tout
// `controllerchange` (un autre onglet a rechargé) ne se recharge pas tout
// seul : une saisie peut être en cours, il affiche l'information.

import { showBanner } from '@shared/feedback.js';

/** Identifiant du bandeau de mise à jour (un seul, remplacé en place). */
export const SW_UPDATE_BANNER_ID = 'sw-update';

const UPDATE_READY_MESSAGE = 'Nouvelle version prête.';
const UPDATED_ELSEWHERE_MESSAGE = 'Version mise à jour dans un autre onglet — Recharger.';
const RELOAD_LABEL = 'Recharger';

/** Worker en attente d'activation : capable de recevoir `SKIP_WAITING`. */
export interface WaitingWorkerLike {
    postMessage(message: unknown): void;
}

/** Événement minimal (`statechange`, `updatefound`, `controllerchange`). */
interface EventTargetLike {
    addEventListener(type: string, listener: () => void): void;
}

/** Worker en cours d'installation, porteur d'un état. */
export interface InstallingWorkerLike extends EventTargetLike {
    state?: string;
}

/** Enregistrement minimal du service worker. */
export interface SwRegistrationLike extends EventTargetLike {
    waiting: WaitingWorkerLike | null;
    installing: InstallingWorkerLike | null;
}

/** Conteneur minimal (`navigator.serviceWorker`). */
export interface SwContainerLike extends EventTargetLike {
    controller: unknown;
}

export interface SwUpdateDeps {
    /** Rechargement (injectable en test). */
    reload?: () => void;
    /** Affichage du bandeau (injectable en test). */
    show?: typeof showBanner;
}

function defaultReload(): void {
    try {
        location.reload();
    } catch {
        // Environnement sans navigation (tests unitaires) : sans conséquence.
    }
}

/**
 * Branche la détection de mise à jour sur un enregistrement DÉJÀ contrôlé.
 *
 * Règles :
 *   - un worker en attente au chargement, ou installé après `updatefound`,
 *     fait apparaître « Nouvelle version prête » avec l'action « Recharger » ;
 *   - l'action poste `SKIP_WAITING` puis recharge au `controllerchange` ;
 *   - un `controllerchange` reçu sans clic (un autre onglet a activé la
 *     version) affiche l'information SANS recharger ;
 *   - un premier enregistrement (aucun contrôleur) ne montre rien et ne
 *     recharge jamais.
 */
export function wireServiceWorkerUpdate(
    registration: SwRegistrationLike,
    container: SwContainerLike,
    deps: SwUpdateDeps = {},
): void {
    const reload = deps.reload ?? defaultReload;
    const show = deps.show ?? showBanner;
    const hadController = !!container.controller;
    let reloadRequested = false;

    const promptReload = (message: string, onClick: () => void): void => {
        show(SW_UPDATE_BANNER_ID, {
            message,
            level: 'info',
            actions: [{ label: RELOAD_LABEL, onClick }],
        });
    };

    const offerWaiting = (): void => {
        const waiting = registration.waiting;
        if (!hadController || !waiting) return;
        promptReload(UPDATE_READY_MESSAGE, () => {
            reloadRequested = true;
            waiting.postMessage({ type: 'SKIP_WAITING' });
        });
    };

    // Worker déjà en attente au moment où la page branche la détection.
    offerWaiting();

    registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing || typeof installing.addEventListener !== 'function') return;
        installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') offerWaiting();
        });
    });

    container.addEventListener('controllerchange', () => {
        if (!hadController) return; // premier enregistrement : rien à faire
        if (reloadRequested) {
            reload();
            return;
        }
        // Un autre onglet a pris la nouvelle version : on informe, on ne
        // recharge pas d'office (une saisie peut être en cours ici).
        promptReload(UPDATED_ELSEWHERE_MESSAGE, reload);
    });
}

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
            wireServiceWorkerUpdate(
                registration as unknown as SwRegistrationLike,
                navigator.serviceWorker as unknown as SwContainerLike,
            );
        })
        .catch((err) => {
            // Silencieux en échec (404, contexte non sécurisé, etc.) — aucune
            // régression observable : rien ne s'enregistre, ni avant ni après.
            console.warn(`[PWA:${label}] Enregistrement SW échoué:`, err);
        });
}
