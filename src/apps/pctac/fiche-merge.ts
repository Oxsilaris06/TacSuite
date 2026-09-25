/**
 * fiche-merge.ts — Fusion de deux fiches « même personne » (décision 32/33).
 *
 * `mergeFicheFields` complète les champs vides de l'existante avec l'entrante.
 * Il recopie aussi `hasImage` et `annotations`, alors que les images vivent dans
 * `ImageStore` sous l'id ENTRANT (`<id>`, `<id>_orig`, `<id>_sync`). Ce module
 * s'assure donc que :
 *   - l'existante GARDE ses images (l'entrante n'écrase rien) ;
 *   - reprendre la photo de l'entrante recopie ses blobs vers l'id GARDÉ,
 *     AVANT que l'appelant n'écrive la fiche ;
 *   - l'invariant « `<id>_orig` seulement si la fiche porte `annotations` »
 *     tient : pas d'`annotations` sans original, pas d'original orphelin.
 */

import type { PctacCollectionItem } from '@shared/types/contracts.js';
import { ImageStore } from '@pctac/image-store.js';
import { Storage } from '@pctac/storage.js';
import { PHOTOS_KEY } from '@pctac/config.js';
import { defaultStatus, ficheTitle, mergeFicheFields } from '@pctac/fiche.js';
import { currentModeId, type PctacModeId } from '@pctac/modes.js';

export interface MergePersonResult {
    merged: PctacCollectionItem;
    /** Champs complétés depuis l'entrante (récapitulatif). */
    filled: string[];
    /** La fiche gardée n'avait pas de photo et vient de prendre celle de l'entrante. */
    photoTaken: boolean;
}

async function copyImage(srcId: string, dstId: string): Promise<boolean> {
    try {
        const data = await ImageStore.get(srcId);
        if (!data) return false;
        await ImageStore.put(dstId, data);
        // `_sync` est la copie galerie de la photo affichée : on reprend celle
        // de l'entrante quand elle existe, sinon on duplique l'image de base.
        const sync = await ImageStore.get(`${srcId}_sync`);
        await ImageStore.put(`${dstId}_sync`, sync ?? data);
        return true;
    } catch {
        return false;
    }
}

async function copyOriginal(srcId: string, dstId: string): Promise<boolean> {
    try {
        const data = await ImageStore.get(`${srcId}_orig`);
        if (!data) return false;
        await ImageStore.put(`${dstId}_orig`, data);
        return true;
    } catch {
        return false;
    }
}

/**
 * Fusionne `incoming` dans `existing` en gérant les images. Ne mute aucun des
 * deux objets ; l'écriture de la fiche reste à la charge de l'appelant.
 */
export async function mergePersonIntoExisting(
    existing: PctacCollectionItem,
    incoming: PctacCollectionItem,
): Promise<MergePersonResult> {
    const { merged, filled } = mergeFicheFields(existing, incoming);
    merged.id = existing.id;
    let photoTaken = false;

    if (existing.hasImage) {
        // L'existante a déjà une photo : elle la garde, l'entrante n'apporte rien.
        merged.hasImage = true;
        if (existing.annotations === undefined) delete merged.annotations;
        else merged.annotations = existing.annotations;
    } else if (incoming.hasImage) {
        // Reprendre la photo de l'entrante : recopier vers l'id gardé.
        const copied = await copyImage(String(incoming.id), String(existing.id));
        if (copied) { merged.hasImage = true; photoTaken = true; }
        else delete merged.hasImage;
        // Les annotations de l'entrante ne sont reprises qu'avec son original.
        if (incoming.annotations !== undefined && await copyOriginal(String(incoming.id), String(existing.id))) {
            merged.annotations = incoming.annotations;
        } else {
            delete merged.annotations;
            try { await ImageStore.delete(`${String(existing.id)}_orig`); } catch { /* rien à retirer */ }
        }
    } else {
        // Ni l'une ni l'autre n'a de photo : aucune trace d'image ne doit rester.
        delete merged.hasImage;
        delete merged.annotations;
    }

    // `updatedAt` est reposé par `Storage.saveCollection`.
    delete merged.updatedAt;
    return { merged, filled, photoTaken };
}

/** Camp d'une fiche qui a une copie galerie (`<id>_sync`). */
export type MergeGallerySide = 'adv' | 'host';

/**
 * Met la GALERIE Photos en cohérence avec une fusion de fiches (C4/C12/B-2) :
 *   - retire l'entrée `<entrante>_sync` (la fiche entrante disparaît : sa
 *     vignette deviendrait morte) ;
 *   - CRÉE `<existante>_sync` seulement quand la photo vient d'être reprise
 *     de l'entrante (`photoTaken`) ; sinon il n'actualise qu'une entrée déjà
 *     là (revue finale F13 : une copie de galerie supprimée volontairement
 *     ne revient pas, sans image, à la fusion suivante).
 *
 * Fonction COMMUNE aux trois appelants de `mergePersonIntoExisting` : la
 * fusion depuis la fiche (RB), `resolveDuplicateFiches` (import d'archive) et
 * la fusion de l'import d'OI. Avant, seule la première la gérait (B-2 corrigé
 * à un seul endroit) ; les imports laissaient une vignette morte et une photo
 * reprise invisible.
 *
 * Écrit la galerie de la situation CIBLE via `Storage` (elle peut différer de
 * celle affichée, décision 2).
 */
export function syncMergedGallery(
    side: MergeGallerySide,
    incomingId: string,
    merged: PctacCollectionItem,
    opts: { photoTaken: boolean; modeId?: PctacModeId | undefined },
): boolean {
    const modeId = opts.modeId ?? currentModeId();
    const keptId = String(merged.id);
    const incomingEntryId = `${incomingId}_sync`;
    const photos = Storage.loadCollection(PHOTOS_KEY, modeId);
    const before = photos.length;
    const filtered = photos.filter((p) => p.id !== incomingEntryId);
    let changed = filtered.length !== before;

    if (merged.hasImage) {
        const title = ficheTitle(side, modeId, merged);
        const status = String(merged.status || defaultStatus(side, modeId));
        const existing = filtered.find((p) => p.id === `${keptId}_sync`);
        if (!existing && !opts.photoTaken) {
            // Rien à créer : la fiche gardait déjà sa photo, sans copie de galerie.
        } else if (existing) {
            // Réutilise l'objet : sa classe de rendu peut être en cache côté vue.
            delete existing.data;
            existing.hasImage = true;
            existing.title = title;
            existing.status = status;
        } else {
            filtered.push({
                id: `${keptId}_sync`,
                title,
                category: side === 'adv' ? 'neutralized' : 'hostage',
                status,
                hasImage: true,
            });
        }
        if (existing || opts.photoTaken) changed = true;
    }

    if (changed) Storage.saveCollection(PHOTOS_KEY, filtered, modeId);
    return changed;
}
