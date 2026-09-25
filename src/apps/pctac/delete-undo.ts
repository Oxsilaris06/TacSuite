/**
 * delete-undo.ts — Suppressions annulables (décision 31).
 *
 * Toute suppression (fiche, ami, photo, entrée de main courante) suit le même
 * contrat : confirmation PUIS disparition immédiate de la liste ET du stockage,
 * avec un toast « <objet> supprimé » offrant « Annuler » pendant 10 s.
 *
 * Les images IndexedDB (originaux `<id>_orig`, copies `_sync`) ne sont
 * effacées qu'à l'ÉCHÉANCE (`onCommit` de `undoableToast`) : tant que le toast
 * court, « Annuler » replace l'élément avec son image intacte. Un rechargement
 * avant l'échéance laisse une image orpheline (documenté en dette) : la donnée
 * n'est pas restaurée, seule l'image reste.
 *
 * Revue du 25/09 :
 *  - A7 : l'échéance pose une pierre tombale (`tombstones.ts`) ; « Annuler »
 *    n'en pose pas ;
 *  - A11 : la situation est FIGÉE à la suppression (un changement de situation
 *    avant l'échéance ne fait pas purger la mauvaise galerie) ;
 *  - A9 : « Annuler » sur stockage plein ne perd rien : message, et un nouvel
 *    essai est proposé.
 *
 * Ce module ne touche pas à l'UI : il reçoit un rappel `refresh` (rendu de la
 * vue concernée) et un rappel `onCommit` (purge différée).
 */

import type { PctacCollectionItem, PctacLogEntry } from '@shared/types/contracts.js';
import { Storage } from '@pctac/storage.js';
import { ImageStore } from '@pctac/image-store.js';
import { Persist } from '@shared/persist.js';
import { currentModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';
import { ADVERSARIES_KEY, HOSTAGES_KEY, LOCAL_STORAGE_KEY, PHOTOS_KEY, DASHBOARD_KEY } from '@pctac/config.js';
import { PINS_KEY } from '@pctac/planmap/constants.js';
import { toast, undoableToast } from '@shared/feedback.js';
import { recordTombstone } from '@pctac/tombstones.js';

export interface UndoableDeleteOptions {
    /** Clé de collection (`pcTacAdversaires`, `pcTacPhotos`…) ou clé de journal. */
    key: string;
    id: string;
    /** Message du toast, déjà accordé (« Photo supprimée »). */
    message: string;
    /** Re-rend la vue concernée (liste, tableau, galerie). */
    refresh: () => void | Promise<void>;
    /** Purge différée (images, références) exécutée à l'échéance seulement, dans la situation de la suppression. */
    onCommit?: (modeId: PctacModeId) => void | Promise<void>;
}

function run(fn: (() => void | Promise<void>) | undefined): void {
    if (!fn) return;
    try {
        void fn();
    } catch {
        // Un rendu qui échoue ne doit jamais remonter à l'utilisateur.
    }
}

/**
 * Supprime un élément de collection avec annulation. Retourne `false` si
 * l'élément est introuvable (aucun toast : rien n'a été supprimé).
 */
export function undoableDelete(opts: UndoableDeleteOptions): boolean {
    const modeId = currentModeId(); // A11 — situation figée à la suppression
    const list = Storage.loadCollection(opts.key, modeId);
    const index = list.findIndex((item) => item.id === opts.id);
    const removed = index === -1 ? undefined : list[index];
    if (!removed) return false;
    const next = list.filter((item) => item.id !== opts.id);
    Storage.saveCollection(opts.key, next, modeId);
    run(opts.refresh);
    const noun = opts.message.includes('Photo') ? 'Photo' : 'Fiche';
    const restore = (): void => {
        const current = Storage.loadCollection(opts.key, modeId);
        // C9 (R14) — l'élément a pu être RECRÉÉ sous le même id entre-temps
        // (« Recréer en enregistrant » depuis un autre onglet) : le réinsérer
        // créerait un doublon d'id, et une suppression ultérieure en perdrait
        // un. « Annuler » ne remet donc que ce qui manque encore.
        if (current.some((item) => item.id === removed.id)) {
            toast(`${noun} déjà recréée ailleurs`, { kind: 'info' });
            return;
        }
        // « Même position » : on borne l'index si la liste a rétréci depuis.
        const at = Math.min(index, current.length);
        current.splice(at, 0, removed as PctacCollectionItem);
        // A9 — stockage plein : rien n'est écrit, l'élément ne doit pas se
        // perdre. Un nouveau toast « Annuler » permet de réessayer.
        if (!Storage.saveCollection(opts.key, current, modeId)) {
            toast(`Stockage plein : ${noun.toLowerCase()} NON restaurée. Libérez de la place, puis « Annuler » de nouveau.`, { kind: 'error' });
            undoableToast(opts.message, { onUndo: restore, onCommit: commit });
            return;
        }
        run(opts.refresh);
    };
    const commit = (): void => {
        // C9 (R14) — l'élément a pu être RECRÉÉ sous le même id avant
        // l'échéance : purger effacerait alors sa photo, son entrée de
        // galerie et ses liens, alors que la fiche recréée garde
        // `hasImage:true` (photo perdue, carte cassée). On ne purge donc
        // rien tant que l'id est de nouveau présent dans la collection.
        if (Storage.loadCollection(opts.key, modeId).some((item) => item.id === removed.id)) return;
        recordTombstone(opts.key, opts.id, modeId); // A7
        run(() => opts.onCommit?.(modeId));
    };
    undoableToast(opts.message, { onUndo: restore, onCommit: commit });
    return true;
}

/**
 * Supprime une entrée de main courante avec annulation. Le journal est retrié
 * par `Storage.saveLogData` (date, heure) : la réinsertion retrouve donc le bon
 * rang, même après l'ajout d'autres entrées.
 */
export function undoableDeleteLog(id: string, message: string, refresh: () => void | Promise<void>): boolean {
    const modeId = currentModeId(); // A11
    const logs = Storage.loadLogData(modeId);
    const index = logs.findIndex((entry) => entry.id === id);
    const removed = index === -1 ? undefined : logs[index];
    if (!removed) return false;
    Storage.saveLogData(logs.filter((entry) => entry.id !== id), modeId);
    run(refresh);
    const restore = (): void => {
        const current = Storage.loadLogData(modeId);
        // C9 (R14) — même garde que pour les collections : ne pas réinsérer
        // une entrée dont l'id est de nouveau présent.
        if (current.some((entry) => entry.id === removed.id)) return;
        const at = Math.min(index, current.length);
        current.splice(at, 0, removed as PctacLogEntry);
        if (!Storage.saveLogData(current, modeId)) {
            toast('Stockage plein : entrée NON restaurée. Libérez de la place, puis « Annuler » de nouveau.', { kind: 'error' });
            undoableToast(message, { onUndo: restore, onCommit: commit });
            return;
        }
        run(refresh);
    };
    const commit = (): void => {
        if (Storage.loadLogData(modeId).some((entry) => entry.id === removed.id)) return;
        recordTombstone(LOCAL_STORAGE_KEY, id, modeId); // A7
    };
    undoableToast(message, { onUndo: restore, onCommit: commit });
    return true;
}

/** Purge des références photo d'un élément supprimé (pings du plan, board). */
function purgeReferences(id: string, modeId: PctacModeId): void {
    const syncId = `${id}_sync`;
    try {
        const pins = Persist.get<{ photoId?: string }[]>(scopedKey(PINS_KEY, modeId), { validator: Array.isArray, fallback: [] }) ?? [];
        let touched = false;
        for (const pin of pins) {
            if (pin && (pin.photoId === id || pin.photoId === syncId)) {
                delete pin.photoId; // jamais `= undefined` (cf. commentaire d'origine)
                touched = true;
            }
        }
        if (touched) {
            Persist.set(scopedKey(PINS_KEY, modeId), pins);
            if (window.PlanMap && window.PlanMap.initialized) window.PlanMap.refresh();
        }
    } catch { /* purge pings non bloquante */ }

    try {
        const state = Persist.get<{
            positions?: Record<string, unknown>;
            links?: ({ from?: unknown; to?: unknown } | null | undefined)[];
        } | null>(scopedKey(DASHBOARD_KEY, modeId), {
            validator: (v) => v !== null && typeof v === 'object',
            fallback: null,
        });
        if (!state) return;
        const matches = (k: unknown): boolean => k === id || k === syncId || String(k).endsWith(`:${id}`);
        let touched = false;
        if (state.positions) {
            for (const key of Object.keys(state.positions)) {
                if (matches(key)) { delete state.positions[key]; touched = true; }
            }
        }
        if (Array.isArray(state.links)) {
            const before = state.links.length;
            state.links = state.links.filter((l) => !l || (!matches(l.from) && !matches(l.to)));
            if (state.links.length !== before) touched = true;
        }
        if (touched) Persist.set(scopedKey(DASHBOARD_KEY, modeId), state);
    } catch { /* purge board non bloquante */ }
}

/**
 * EFFACEMENT DIFFÉRÉ des images d'un élément (à l'échéance du toast) :
 * `id`, original `_orig`, et pour une fiche adverse/protégée la copie `_sync`
 * (retirée de la galerie Photos). Purge aussi les références mortes (pings,
 * board). Un import partiel peut avoir laissé une image sans référence.
 * `modeId` : situation de la suppression (A11), par défaut la situation courante.
 */
export async function purgeCollectionImages(key: string, id: string, modeId: PctacModeId = currentModeId()): Promise<void> {
    const syncId = `${id}_sync`;
    // B-1 — nettoyage SYNCHRONE d'abord : `pagehide` fige la page sans laisser
    // tourner les `await` IndexedDB. La retirée de la galerie et la purge des
    // références doivent donc être acquises AVANT la première attente, sinon
    // l'entrée `_sync` reste dans Photos (10 s, ou pour toujours si la page
    // se ferme avant l'échéance).
    if (key === ADVERSARIES_KEY || key === HOSTAGES_KEY) {
        const photos = Storage.loadCollection(PHOTOS_KEY, modeId);
        const filtered = photos.filter((photo) => photo.id !== syncId);
        if (filtered.length !== photos.length) Storage.saveCollection(PHOTOS_KEY, filtered, modeId);
    }
    purgeReferences(id, modeId);
    try { await ImageStore.delete(id); } catch { /* image absente ou stockage indispo */ }
    try { await ImageStore.delete(`${id}_orig`); } catch { /* original absent */ }
    if (key === ADVERSARIES_KEY || key === HOSTAGES_KEY) {
        try { await ImageStore.delete(syncId); } catch { /* copie absente */ }
    }
}
