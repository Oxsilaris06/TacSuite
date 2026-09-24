/**
 * photo-annotation.ts — Annotation des photos du PC-Tac (décision 25) : même
 * moteur (`@oi/dessin.js`) et même fenêtre (`@shared/annotation-modal.js`)
 * que l'OI, non destructive comme l'OI.
 *
 * Stockage :
 *  - l'image AFFICHÉE reste sous son id (et sous `<fiche>_sync`, la copie
 *    galerie d'une photo de fiche) : cartes, visionneuse, pings du plan, PDF
 *    et archive montrent la version annotée sans autre changement ;
 *  - l'original sous `<base>_orig`, écrit au premier tracé ;
 *  - les annotations (JSON du moteur) dans le champ `annotations` de la fiche
 *    (photo de fiche) ou de la photo (galerie), qui les transportent.
 * `<base>_orig` ne vaut que si le propriétaire porte `annotations` : seul, il
 * est périmé (import partiel, écriture interrompue) et l'image affichée fait
 * foi. L'image annotée est toujours rendue depuis l'original : aucune perte en
 * cascade d'une retouche à l'autre.
 *
 * Comme dans l'OI, chaque changement est gardé aussitôt (brouillon : les
 * annotations, sans rendu) et survit à un rechargement ; l'image annotée est
 * rendue à la fermeture. « Annuler », la croix et Échap ramènent les
 * annotations à l'ouverture (moteur, décision 26).
 */
import { createAnnotatedImageBlob } from '@oi/dessin.js';
import { ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY } from '@pctac/config.js';
import { ImageStore } from '@pctac/image-store.js';
import { Storage } from '@pctac/storage.js';
import { Utils } from '@pctac/utils.js';
import { setAnnotationHost, type AnnotationHost } from '@shared/annotation-host.js';
import { mountAnnotationModal } from '@shared/annotation-modal.js';
import { toast } from '@shared/feedback.js';
import type { OiAnnotation, PctacCollectionItem } from '@shared/types/contracts.js';

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
export async function renderAnnotated(original: string, annotations: OiAnnotation[]): Promise<string> {
    const png = await createAnnotatedImageBlob(await toBlob(original), annotations);
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (): void => resolve(String(reader.result));
        reader.onerror = (): void => reject(reader.error ?? new Error('lecture impossible'));
        reader.readAsDataURL(png);
    });
    return Utils.compressImage(dataUrl, 1024, 1024, 0.7);
}

function ownerOf(target: PhotoTarget): { list: PctacCollectionItem[]; item: PctacCollectionItem | undefined } {
    const list = Storage.loadCollection(target.owner.key);
    return { list, item: list.find((i) => i.id === target.owner.id) };
}

/** Original de la photo : `_orig` s'il vaut (propriétaire annoté), sinon l'image affichée. */
async function originalOf(target: PhotoTarget, item: PctacCollectionItem | undefined): Promise<{ original: string | null; kept: boolean }> {
    const kept = item?.annotations !== undefined ? await ImageStore.get(origId(target.base)) : null;
    return kept ? { original: kept, kept: true } : { original: await ImageStore.get(target.keys[0] ?? ''), kept: false };
}

/** `saveCollection` ne jette pas sur quota : on relit. */
function commit(target: PhotoTarget, list: PctacCollectionItem[], item: PctacCollectionItem): void {
    Storage.saveCollection(target.owner.key, list);
    const back = Storage.loadCollection(target.owner.key).find((i) => i.id === item.id);
    if (back?.annotations !== item.annotations) throw new Error('stockage plein');
}

/**
 * Écrit les annotations : rendu d'abord, puis original, annotations (vérifiées)
 * et enfin images affichées. Stockage plein : erreur, rien de visible n'a changé.
 */
export async function saveAnnotations(
    target: PhotoTarget,
    annotations: OiAnnotation[],
    render: (original: string, annotations: OiAnnotation[]) => Promise<string> = renderAnnotated,
): Promise<void> {
    const { list, item } = ownerOf(target);
    if (!item) throw new Error('photo introuvable');
    const { original, kept } = await originalOf(target, item);
    if (!original) throw new Error('photo introuvable');
    if (!annotations.length) {
        if (kept) for (const key of target.keys) await ImageStore.put(key, original);
        if (item.annotations !== undefined) {
            delete item.annotations;
            commit(target, list, item);
        }
        await ImageStore.delete(origId(target.base)); // périmé ou plus utile
        return;
    }
    const display = await render(original, annotations);
    if (!kept) await ImageStore.put(origId(target.base), original);
    item.annotations = JSON.stringify(annotations);
    try {
        commit(target, list, item);
    } catch (e) {
        if (!kept) await ImageStore.delete(origId(target.base));
        throw e;
    }
    for (const key of target.keys) await ImageStore.put(key, display);
}

/** Brouillon d'un changement : annotations (et original au premier tracé), sans rendu. */
async function saveDraft(target: PhotoTarget, json: string): Promise<void> {
    const { list, item } = ownerOf(target);
    if (!item) return;
    if (item.annotations === undefined) {
        if (json === '[]') return;
        const shown = await ImageStore.get(target.keys[0] ?? '');
        if (!shown) return;
        await ImageStore.put(origId(target.base), shown);
    }
    item.annotations = json;
    Storage.saveCollection(target.owner.key, list);
}

/** Écritures l'une après l'autre : brouillons, fermeture, puis réouverture. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job);
    queue = run.catch(() => undefined);
    return run;
}

// --- Fenêtre ------------------------------------------------------------------

/** Aperçu caché sur lequel le moteur travaille (id, src `blob:`, annotations). */
const PREVIEW_ID = 'pctacAnnotationPreview';

interface Session {
    photoId: string;
    target: PhotoTarget;
    url: string;
    opened: string;
    closing: boolean;
    resolve: (saved: boolean) => void;
}

let session: Session | null = null;
let opening = false;
let boundTo: HTMLDialogElement | null = null;

/** Hôte du PC-Tac : ni Store ni base de l'OI. */
const host: AnnotationHost = {
    annotations: [],
    objectUrlsCache: {},
    async getImage() { return null; },
    save() {
        const s = session;
        if (!s || s.closing) return;
        const json = JSON.stringify(host.annotations);
        void enqueue(() => saveDraft(s.target, json)).catch((e: unknown) => console.warn('[PC TAC] brouillon d’annotation non gardé:', e));
    },
    syncDom() {},
    renderPreview: false,
};

async function finish(): Promise<void> {
    const s = session;
    if (!s || s.closing) return;
    s.closing = true;
    document.body.classList.remove('modal-open');
    const json = JSON.stringify(host.annotations);
    const changed = json !== s.opened;
    let saved = false;
    try {
        // Sans annotation, on range aussi ce qu'un brouillon a pu laisser.
        if (changed || json === '[]') await enqueue(() => saveAnnotations(s.target, JSON.parse(json) as OiAnnotation[]));
        saved = changed;
    } catch (e) {
        console.error('[PC TAC] annotation non enregistrée:', e);
        toast('Annotation non enregistrée (stockage)', { kind: 'error' });
    } finally {
        URL.revokeObjectURL(s.url);
        if (session === s) session = null;
    }
    if (saved) {
        const ui = window.UI;
        await ui?.renderPhotos?.();
        if (s.target.owner.key === ADVERSARIES_KEY) await ui?.renderAdversaries?.();
        if (s.target.owner.key === HOSTAGES_KEY) await ui?.renderHostages?.();
        // Le rendu a remplacé le bouton qui avait le focus (galerie) : même carte.
        if (document.activeElement === document.body) {
            const card = Array.from(document.querySelectorAll<HTMLElement>('.photo-card')).find((c) => c.dataset.id === s.photoId);
            card?.querySelector<HTMLElement>('[data-photo-action="annotate"]')?.focus();
        }
    }
    s.resolve(saved);
}

/** Photo prête à annoter : cible, original décodable, annotations d'ouverture. */
async function prepare(photoId: string): Promise<{ target: PhotoTarget; original: string; opened: string } | null> {
    await queue; // fermeture précédente écrite
    if (session && !session.closing) return null;
    const target = resolvePhotoTarget(photoId);
    const { item } = target ? ownerOf(target) : { item: undefined };
    const { original } = target ? await originalOf(target, item) : { original: null };
    if (!target || !original) {
        toast('Photo introuvable', { kind: 'error' });
        return null;
    }
    // Une image illisible n'ouvrirait jamais la fenêtre : refusée ici.
    const probe = new Image();
    probe.src = original;
    try {
        await probe.decode();
    } catch {
        toast('Photo illisible : annotation impossible', { kind: 'error' });
        return null;
    }
    return { target, original, opened: typeof item?.annotations === 'string' ? item.annotations : '[]' };
}

/**
 * Ouvre l'annotation d'une photo ; la promesse se résout à la fermeture,
 * annotations enregistrées (true) ou non. Une écriture en cours (fermeture
 * précédente) est attendue avant de lire la photo.
 */
export async function annotatePhoto(photoId: string): Promise<boolean> {
    if (opening || (session && !session.closing)) return false;
    opening = true;
    let ready: Awaited<ReturnType<typeof prepare>> = null;
    let url = '';
    try {
        ready = await prepare(photoId);
        if (ready) url = URL.createObjectURL(await toBlob(ready.original));
    } finally {
        opening = false;
    }
    if (!ready) return false;
    const { target, opened } = ready;
    const modal = mountAnnotationModal({ memberTool: false });
    if (boundTo !== modal) {
        boundTo = modal;
        modal.addEventListener('close', () => { void finish(); });
    }
    setAnnotationHost(host);
    let img = document.getElementById(PREVIEW_ID) as HTMLImageElement | null;
    if (!img) {
        img = document.createElement('img');
        img.id = PREVIEW_ID;
        img.alt = '';
        img.hidden = true;
        document.body.append(img);
    }
    img.src = url;
    img.dataset.annotations = opened;
    // Une URL par ouverture : le moteur prend celle du cache avant l'aperçu.
    host.objectUrlsCache = { [PREVIEW_ID]: url };
    return new Promise<boolean>((resolve) => {
        session = { photoId, target, url, opened, closing: false, resolve };
        void window.openAnnotationModal(PREVIEW_ID);
    });
}
