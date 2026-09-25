/**
 * tab-sync-views.ts — Repeint les vues sur un changement venu d'un autre onglet
 * (décision 29).
 *
 * `tab-sync.ts` (autre lot) traduit les évènements `storage`/`BroadcastChannel`
 * en évènements DOM `pctac:data` (`{ key, remote: true }`) et `pctac:image`
 * (`{ id, op, remote: true }`). Ici on route ces évènements vers le RE-RENDU de
 * la vue concernée. On ne repeint QUE ce qui vient d'un autre onglet (`remote`)
 * : une écriture locale déclenche déjà son propre rendu.
 *
 * Le défilement des listes est préservé : le re-rendu ne touche qu'à la liste
 * (le `<tbody>`, la grille), jamais la page. Une fiche ouverte vit HORS de la
 * liste (dans `.fiche-layout`), elle n'est donc pas refermée.
 */

import { ADVERSARIES_KEY, FRIENDS_KEY, HOSTAGES_KEY, PHOTOS_KEY, LOCAL_STORAGE_KEY } from '@pctac/config.js';

export interface RemoteViewActions {
    log: () => void;
    adversaries: () => void;
    hostages: () => void;
    friends: () => void;
    photos: () => void;
}

/** Route une clé logique distante vers le re-rendu de sa vue. */
export function routeRemoteData(key: string, remote: boolean, actions: RemoteViewActions): void {
    if (!remote) return;
    switch (key) {
        case LOCAL_STORAGE_KEY: actions.log(); break;
        case ADVERSARIES_KEY: actions.adversaries(); break;
        case HOSTAGES_KEY: actions.hostages(); break;
        case FRIENDS_KEY: actions.friends(); break;
        case PHOTOS_KEY: actions.photos(); break;
        default: break;
    }
}

/**
 * Une image changée ailleurs peut apparaître dans une fiche (photo), dans la
 * galerie Photos, et suivre un statut : on repeint les trois.
 */
export function routeRemoteImage(id: string, op: 'put' | 'delete', actions: RemoteViewActions): void {
    if (!id) return;
    void op;
    actions.photos();
    actions.adversaries();
    actions.hostages();
}

/**
 * Branche les écouteurs DOM. IDEMPOTENT. Les rappels fournis par `main.ts`
 * enveloppent déjà les rendus de `UI`.
 */
let initialized = false;

export function initTabSyncViews(actions: RemoteViewActions): void {
    if (initialized) return;
    initialized = true;
    if (typeof document === 'undefined') return;
    document.addEventListener('pctac:data', (e) => {
        const detail = (e as CustomEvent<{ key?: unknown; remote?: unknown }>).detail;
        if (!detail || typeof detail.key !== 'string') return;
        routeRemoteData(detail.key, detail.remote === true, actions);
    });
    document.addEventListener('pctac:image', (e) => {
        const detail = (e as CustomEvent<{ id?: unknown; op?: unknown; remote?: unknown }>).detail;
        if (!detail || typeof detail.id !== 'string' || detail.remote !== true) return;
        if (detail.op !== 'put' && detail.op !== 'delete') return;
        routeRemoteImage(detail.id, detail.op, actions);
    });
}

/** Réservé aux tests : réarme le drapeau d'initialisation. */
export function resetTabSyncViewsForTests(): void {
    initialized = false;
}
