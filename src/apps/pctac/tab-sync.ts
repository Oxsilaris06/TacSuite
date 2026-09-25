/**
 * tab-sync.ts — Synchronisation entre onglets de PC-Tac (décision 29).
 *
 * Deux onglets de la MÊME situation se synchronisent en direct. La règle de
 * sûreté (décision 29, Fable) : chaque onglet garde la situation qu'il a
 * chargée ; un changement de situation dans un autre onglet ne réoriente JAMAIS
 * ses écritures (cf. `modes.ts`, situation figée par page).
 *
 * Ce module est le SEUL à parler aux évènements `storage` et à la
 * `BroadcastChannel` des images. Il les traduit en évènements DOM :
 *   - `pctac:data`  : clé LOGIQUE (jamais suffixée) d'une donnée qui a changé,
 *     avec `remote: true`. `storage.ts` émet les mêmes sans `remote`.
 *   - `pctac:image` : `{ id, op: 'put' | 'delete', remote: true }`.
 *
 * La clé physique `storage` est ramenée à sa clé logique pour la situation
 * FIGÉE de la page : `pcTacAdversaries@tp` → `pcTacAdversaries` en TP, tandis
 * qu'une clé d'une autre situation (`@recherche`) est ignorée. En Forcené, les
 * clés opérationnelles sont nues ; toute clé suffixée appartient à une autre
 * situation.
 */

import { toast } from '@shared/feedback.js';
import { PCTAC_MODE_KEY, PCTAC_MODES, SHARED_KEYS, currentModeId, type PctacModeId } from '@pctac/modes.js';
import { SITUATION_KEYS } from '@pctac/storage.js';

const IMAGE_CHANNEL_NAME = 'pctac-images';

let initialized = false;
let imageChannel: BroadcastChannel | null = null;
let imageChannelResolved = false;

function isModeId(value: unknown): value is PctacModeId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PCTAC_MODES, value);
}

/**
 * Canal des images, créé une fois. Absent (navigateur sans `BroadcastChannel`)
 * ou refusé : on dégrade sans erreur. `unref()` quand la plateforme le propose
 * (Node) pour ne pas retenir le processus.
 */
function getImageChannel(): BroadcastChannel | null {
    if (!imageChannelResolved) {
        imageChannelResolved = true;
        try {
            if (typeof BroadcastChannel === 'function') {
                imageChannel = new BroadcastChannel(IMAGE_CHANNEL_NAME);
                (imageChannel as unknown as { unref?: () => void }).unref?.();
            }
        } catch {
            imageChannel = null;
        }
    }
    return imageChannel;
}

/**
 * Publie un changement d'image APRÈS le succès de l'écriture IndexedDB.
 * Appelé par `ImageStore.put` / `delete` / `deleteMany`.
 */
export function publishImageChange(id: string, op: 'put' | 'delete'): void {
    if (!id) return;
    const channel = getImageChannel();
    if (!channel) return;
    try {
        channel.postMessage({ id, op });
    } catch {
        // Un canal fermé ne doit jamais faire échouer l'écriture de l'image.
    }
}

/** Clés logiques connues, pour un vidage complet (`storage` avec `key === null`). */
function knownLogicalKeys(): string[] {
    return [...new Set<string>([...SHARED_KEYS, ...SITUATION_KEYS])];
}

/** Clé logique d'une clé physique pour la situation FIGÉE, ou `null` si étrangère. */
function logicalKeyFor(physical: string): string | null {
    if (SHARED_KEYS.has(physical)) return physical;
    const mode = currentModeId();
    if (mode === 'forcene') {
        // Forcené : les clés opérationnelles sont nues ; un suffixe = autre situation.
        return physical.includes('@') ? null : physical;
    }
    const suffix = `@${mode}`;
    return physical.endsWith(suffix) ? physical.slice(0, -suffix.length) : null;
}

function emitData(key: string): void {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    try {
        document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key, remote: true } }));
    } catch {
        // Un écouteur en échec ne remonte jamais.
    }
}

function onStorage(event: StorageEvent): void {
    // Vidage complet : aucune clé physique à traduire, on annonce tout ce qu'on
    // connaît (l'appelant choisit ce qu'il repeint).
    if (event.key === null) {
        knownLogicalKeys().forEach(emitData);
        return;
    }
    // La situation elle-même : on prévient sans réorienter cet onglet.
    if (event.key === PCTAC_MODE_KEY) {
        const remote = event.newValue;
        const mode = currentModeId();
        if (isModeId(remote) && remote !== mode) {
            toast(
                `Un autre onglet est passé sur ${PCTAC_MODES[remote].label}. `
                + `Cet onglet reste sur ${PCTAC_MODES[mode].label}.`,
                { kind: 'info' },
            );
        }
        return;
    }
    const logical = logicalKeyFor(event.key);
    if (logical) emitData(logical);
}

function onImageMessage(event: MessageEvent): void {
    const data = event.data as { id?: unknown; op?: unknown } | null;
    if (!data || typeof data.id !== 'string') return;
    if (data.op !== 'put' && data.op !== 'delete') return;
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    try {
        document.dispatchEvent(new CustomEvent('pctac:image', {
            detail: { id: data.id, op: data.op, remote: true },
        }));
    } catch {
        // Un écouteur en échec ne remonte jamais.
    }
}

/**
 * Branche la synchronisation entre onglets. IDEMPOTENT : un second appel ne
 * pose pas un deuxième jeu d'écouteurs.
 */
export function initTabSync(): void {
    if (initialized) return;
    initialized = true;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', onStorage);
    }
    const channel = getImageChannel();
    if (channel) channel.onmessage = onImageMessage;
}
