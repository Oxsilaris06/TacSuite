/**
 * photo-annotation.ts — Annotation des photos du PC-Tac (décision 25) : même
 * moteur (`@oi/dessin.js`) et même fenêtre (`@shared/annotation-modal.js`)
 * que l'OI, non destructive comme l'OI.
 *
 * Stockage :
 *  - l'image AFFICHÉE reste sous son id (et sous `<fiche>_sync`, la copie
 *    galerie d'une photo de fiche) : cartes, visionneuse, pings du plan, PDF
 *    et archive montrent la version annotée sans autre changement ;
 *  - l'original sous `<base>_orig`, écrit à la première annotation ;
 *  - les annotations (JSON du moteur) dans le champ `annotations` de la fiche
 *    (photo de fiche) ou de la photo (galerie), qui les transportent.
 * L'image annotée est toujours rendue depuis l'original : aucune perte en
 * cascade d'une retouche à l'autre.
 *
 * Comme dans l'OI, « Annuler » garde les annotations : l'enregistrement se
 * fait à la fermeture de la fenêtre, quelle qu'elle soit (Échap compris).
 */
import { createAnnotatedImageBlob } from '@oi/dessin.js';
import { ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY } from '@pctac/config.js';
import { ImageStore } from '@pctac/image-store.js';
import { Storage } from '@pctac/storage.js';
import { Utils } from '@pctac/utils.js';
import { setAnnotationHost, type AnnotationHost } from '@shared/annotation-host.js';
import { mountAnnotationModal } from '@shared/annotation-modal.js';
import { toast } from '@shared/feedback.js';
import type { OiAnnotation } from '@shared/types/contracts.js';

/** Photo à annoter : images à réécrire et élément qui porte les annotations. */
export interface PhotoTarget {
    base: string;
    keys: string[];
    owner: { key: string; id: string };
}

export const origId = (base: string): string => `${base}_orig`;

/** `p1` (galerie), `f1` (fiche) ou `f1_sync` (copie galerie de la fiche). */
export function resolvePhotoTarget(photoId: string): PhotoTarget | null {
    const photos = Storage.loadCollection(PHOTOS_KEY);
    const base = photoId.endsWith('_sync') ? photoId.slice(0, -'_sync'.length) : photoId;
    for (const key of [ADVERSARIES_KEY, HOSTAGES_KEY]) {
        if (Storage.loadCollection(key).some((i) => i.id === base)) {
            const sync = `${base}_sync`;
            return { base, keys: photos.some((p) => p.id === sync) ? [base, sync] : [base], owner: { key, id: base } };
        }
    }
    return photos.some((p) => p.id === photoId) ? { base: photoId, keys: [photoId], owner: { key: PHOTOS_KEY, id: photoId } } : null;
}

async function toBlob(dataUrl: string): Promise<Blob> {
    return (await fetch(dataUrl)).blob();
}

/** Rendu du moteur (PNG pleine taille), recompressé comme une photo ajoutée. */
async function renderAnnotated(original: string, annotations: OiAnnotation[]): Promise<string> {
    const png = await createAnnotatedImageBlob(await toBlob(original), annotations);
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (): void => resolve(String(reader.result));
        reader.onerror = (): void => reject(reader.error ?? new Error('lecture impossible'));
        reader.readAsDataURL(png);
    });
    return Utils.compressImage(dataUrl, 1024, 1024, 0.7);
}

/** Écrit les annotations : original d'abord (jamais perdu), puis images et fiche. */
export async function saveAnnotations(
    target: PhotoTarget,
    annotations: OiAnnotation[],
    render: (original: string, annotations: OiAnnotation[]) => Promise<string> = renderAnnotated,
): Promise<void> {
    const kept = await ImageStore.get(origId(target.base));
    if (!annotations.length && !kept) return;
    const original = kept ?? (await ImageStore.get(target.keys[0] ?? ''));
    if (!original) throw new Error('photo introuvable');
    const display = annotations.length ? await render(original, annotations) : original;
    if (annotations.length && !kept) await ImageStore.put(origId(target.base), original);
    for (const key of target.keys) await ImageStore.put(key, display);
    if (!annotations.length) await ImageStore.delete(origId(target.base));
    const list = Storage.loadCollection(target.owner.key);
    const item = list.find((i) => i.id === target.owner.id);
    if (!item) return;
    if (annotations.length) item.annotations = JSON.stringify(annotations);
    else delete item.annotations;
    Storage.saveCollection(target.owner.key, list);
}

// --- Fenêtre ------------------------------------------------------------------

/** Aperçu caché sur lequel le moteur travaille (id, src `blob:`, annotations). */
const PREVIEW_ID = 'pctacAnnotationPreview';

/** Hôte du PC-Tac : ni Store ni base de l'OI ; tout s'écrit à la fermeture. */
const host: AnnotationHost = {
    annotations: [],
    objectUrlsCache: {},
    async getImage() { return null; },
    save() {},
    syncDom() {},
    renderPreview: false,
};

let session: { target: PhotoTarget; url: string; resolve: (saved: boolean) => void } | null = null;
let boundTo: HTMLDialogElement | null = null;

async function finish(): Promise<void> {
    const s = session;
    if (!s) return;
    session = null;
    document.body.classList.remove('modal-open');
    let saved = false;
    try {
        await saveAnnotations(s.target, host.annotations);
        saved = true;
    } catch (e) {
        console.error('[PC TAC] annotation non enregistrée:', e);
        toast('Annotation non enregistrée (stockage)', { kind: 'error' });
    } finally {
        URL.revokeObjectURL(s.url);
    }
    const ui = window.UI;
    await ui?.renderPhotos?.();
    if (s.target.owner.key === ADVERSARIES_KEY) await ui?.renderAdversaries?.();
    if (s.target.owner.key === HOSTAGES_KEY) await ui?.renderHostages?.();
    s.resolve(saved);
}

/**
 * Ouvre l'annotation d'une photo ; la promesse se résout à la fermeture,
 * annotations enregistrées (true) ou non.
 */
export async function annotatePhoto(photoId: string): Promise<boolean> {
    if (session) return false;
    const target = resolvePhotoTarget(photoId);
    const original = target && ((await ImageStore.get(origId(target.base))) ?? (await ImageStore.get(target.keys[0] ?? '')));
    if (!target || !original) {
        toast('Photo introuvable', { kind: 'error' });
        return false;
    }
    const modal = mountAnnotationModal({ memberTool: false });
    if (boundTo !== modal) {
        boundTo = modal;
        modal.addEventListener('close', () => { void finish(); });
    }
    setAnnotationHost(host);
    const url = URL.createObjectURL(await toBlob(original));
    let img = document.getElementById(PREVIEW_ID) as HTMLImageElement | null;
    if (!img) {
        img = document.createElement('img');
        img.id = PREVIEW_ID;
        img.alt = '';
        img.hidden = true;
        document.body.append(img);
    }
    img.src = url;
    const owner = Storage.loadCollection(target.owner.key).find((i) => i.id === target.owner.id);
    img.dataset.annotations = typeof owner?.annotations === 'string' ? owner.annotations : '[]';
    // Une URL par ouverture : le moteur prend celle du cache avant l'aperçu.
    host.objectUrlsCache = { [PREVIEW_ID]: url };
    return new Promise<boolean>((resolve) => {
        session = { target, url, resolve };
        void window.openAnnotationModal(PREVIEW_ID);
    });
}
