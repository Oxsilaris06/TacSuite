/**
 * tombstones.ts — Pierres tombales des suppressions (décision de Nico du
 * 25/09, revue A7).
 *
 * Par situation, la liste datée des éléments supprimés (fiches, photos,
 * entrées de main courante, points), posée à l'ÉCHÉANCE d'une suppression
 * annulable (`delete-undo.ts`), jamais à « Annuler ». À la fusion d'une archive
 * (`import-scope.ts`), un élément supprimé ici APRÈS sa dernière modification
 * là-bas ne revient pas ; un élément modifié là-bas après sa suppression ici
 * revient (la plus récente gagne, décision 32). Les pierres voyagent avec
 * l'archive (`data.json`) et se fusionnent comme une collection : id
 * `<clé>:<id>`, `updatedAt` = date de suppression. Purgées avec la situation au
 * RESET (`SITUATION_KEYS`).
 */

import { DELETED_KEY } from '@pctac/config.js';
import { Persist } from '@shared/persist.js';
import { currentModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';

export interface Tombstone {
    /** `<clé>:<id>` : identifiant de fusion (une pierre par élément). */
    id: string;
    key: string;
    itemId: string;
    /** ISO 8601. */
    deletedAt: string;
    /** = `deletedAt` : la fusion générique (« la plus récente gagne ») s'applique telle quelle. */
    updatedAt: string;
}

/** Plafond par situation : au-delà, les plus anciennes sortent. */
export const TOMBSTONES_MAX = 2000;

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

function isTombstone(v: unknown): v is Tombstone {
    if (!v || typeof v !== 'object') return false;
    const t = v as Record<string, unknown>;
    return typeof t.key === 'string' && typeof t.itemId === 'string' && typeof t.deletedAt === 'string';
}

export function readTombstones(modeId: PctacModeId = currentModeId()): Tombstone[] {
    const raw = Persist.get<unknown[]>(scopedKey(DELETED_KEY, modeId), { validator: isArray, fallback: [] }) ?? [];
    return raw.filter(isTombstone);
}

/** Pose (ou rafraîchit) la pierre de `itemId` dans `key`, pour la situation `modeId`. */
export function recordTombstone(key: string, itemId: string, modeId: PctacModeId = currentModeId(), now: Date = new Date()): void {
    const iso = now.toISOString();
    const list = readTombstones(modeId).filter((t) => !(t.key === key && t.itemId === itemId));
    list.push({ id: `${key}:${itemId}`, key, itemId, deletedAt: iso, updatedAt: iso });
    if (list.length > TOMBSTONES_MAX) list.splice(0, list.length - TOMBSTONES_MAX);
    Persist.set(scopedKey(DELETED_KEY, modeId), list);
}

/** `itemId` → date de suppression (ms) pour une clé de collection. */
export function tombstoneMap(list: readonly Tombstone[], key: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const t of list) {
        if (t.key !== key) continue;
        const ms = Date.parse(t.deletedAt);
        if (Number.isFinite(ms)) out.set(t.itemId, ms);
    }
    return out;
}
