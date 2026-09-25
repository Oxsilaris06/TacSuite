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
import { mergeFicheFields } from '@pctac/fiche.js';

export interface MergePersonResult {
    merged: PctacCollectionItem;
    /** Champs complétés depuis l'entrante (récapitulatif). */
    filled: string[];
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

    if (existing.hasImage) {
        // L'existante a déjà une photo : elle la garde, l'entrante n'apporte rien.
        merged.hasImage = true;
        if (existing.annotations === undefined) delete merged.annotations;
        else merged.annotations = existing.annotations;
    } else if (incoming.hasImage) {
        // Reprendre la photo de l'entrante : recopier vers l'id gardé.
        const copied = await copyImage(String(incoming.id), String(existing.id));
        if (copied) merged.hasImage = true;
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
    return { merged, filled };
}
