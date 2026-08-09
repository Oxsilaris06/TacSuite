/**
 * medias.ts — Import/compression/miniatures des photos et fond PDF personnalisé
 * (P3.CONV, paquet `oi-medias`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM, fonction par fonction dans l'ordre du fichier, de
 * `modules/medias.js` (GStart-main, lecture seule, 283 LOC intégral) :
 * `displayMap` (:13), `handleFileChange` (:28), `removeImage` (:107),
 * `syncAllThumbnails` (:129), `handleCustomBackgroundChange` (:159),
 * `removeCustomBackground` (:174), `updateCustomBgPreview` (:184),
 * `loadImageAsBlobViaImageElement` (:210), `fetchImageAndCompress` (:235),
 * `getAdversaryImageInfo` (:270). Cf. `docs/SPEC-OI-CONVERSION.md` §2.2/§11.8,
 * `PAQUETS-OI.json` (`oi-medias`).
 *
 * Implémente `OiMediaGlobals` (`@shared/types/contracts.js`) : `handleFileChange`,
 * `removeImage`, `syncAllThumbnails`, `handleCustomBackgroundChange`,
 * `removeCustomBackground`, `updateCustomBgPreview`.
 *
 * ÉCART ASSUMÉ vs original, SIGNALÉ (pas un bug) : `medias.js:103-105` ne pose
 * QUE 3 des 6 noms sur `window`, au MILIEU du fichier (`handleFileChange`,
 * `removeImage`, `updateCustomBgPreview`) ; les 3 autres (`syncAllThumbnails`,
 * `handleCustomBackgroundChange`, `removeCustomBackground`) étaient déjà des
 * propriétés globales implicites en script classique (déclarations de fonction
 * top-level hoistées). Un module ESM ne le fait pas : le contrat `OiMediaGlobals`
 * (figé) exige les 6. Ce port pose donc LES 6 EXPLICITEMENT, groupées EN FIN DE
 * MODULE (après les 10 déclarations), dans l'ordre du contrat. Iso-comportement :
 * `syncAllThumbnails` est appelée depuis `init.ts` (`checkIntegrity`, via
 * `window.syncAllThumbnails`) uniquement à l'exécution (jamais pendant le
 * chargement des modules), et l'ordre de chargement `medias → formulaires → …`
 * (SPEC §12.2) garantit que ce module a fini de s'exécuter (donc posé les 6
 * propriétés) avant qu'aucun autre module ne puisse les invoquer.
 *
 * RÈGLE D'OR (SPEC §2.2) — appels cross-module vers des symboles exposés sur
 * `window` par D'AUTRES modules, jamais importés :
 *   - `window.syncDomToStore()` (formulaires.ts, version débouncée) — AUCUNE
 *     garde `typeof`, comme l'original (`medias.js:99,118,125`, appels nus).
 *   - `window.toast(...)` (notifications.ts) — garde `typeof … === 'function'`
 *     CONSERVÉE (`medias.js:91`, seul appel gardé du fichier).
 *   - `openAnnotationModal` (dessin.ts) et `openEffractionToolsModal`
 *     (articulation.ts) n'apparaissent que dans des attributs `onclick`
 *     VERBATIM de gabarits `innerHTML` (chaînes JS jamais évaluées par TS,
 *     `medias.js:82-83`) : aucune référence directe nécessaire dans ce fichier.
 *   - Ce paquet ne dépend donc NI de `dessin.ts` NI de `articulation.ts`
 *     (aucun import), conformément à la consigne.
 *
 * IMPORTS RÉELS (acycliques, SPEC §2.3 `medias.ts ← init, outils`) :
 * `Store`/`dbManager` depuis `@oi/init.js`, `compressImage` depuis
 * `@oi/outils.js` (NE PAS réimplémenter la compression — paramètres relevés
 * dans la source : `compressImage(file, 0.95, 2560)`, `medias.js:50`).
 *
 * Clés IndexedDB INCHANGÉES : `img_<timestamp>_<random>` (`medias.js:42`) et
 * `custom_pdf_background` (`medias.js:163,176,189`).
 *
 * Code mort confirmé, porté par fidélité (PAQUETS-OI.json `oi-medias`) :
 * `fetchImageAndCompress` (:235) et `getAdversaryImageInfo` (:270) n'ont AUCUN
 * appelant dans le graphe porté — leur seul appelant dans GStart-main est
 * `modules/presentation_legacy.js`, EXCLU du portage (SPEC §1.2 : « chargé par
 * aucun HTML »). Portées à l'identique, exportées pour satisfaire
 * `noUnusedLocals`, jamais posées sur `window` (absentes de `OiMediaGlobals`).
 *
 * ÉCART DE CONTRAT SIGNALÉ AU GATE (règle commune (6), SPEC §2.2) :
 * `OiMediaGlobals.removeImage` (contracts.ts) type `itemElement: HTMLElement`
 * (NON nullable). L'original (`medias.js:107,116,123`) accepte explicitement
 * un `itemElement` possiblement `null` (garde `if (itemElement) itemElement.remove();`
 * dans le corps) — nécessaire car son unique appelant interne
 * (`handleFileChange:35`, mode `isSingle`) lui passe `img.closest(...)`, qui
 * peut renvoyer `null`. Ignorer un `itemElement` nul en amont changerait le
 * comportement : `dbManager.deleteItem`/`syncAllThumbnails`/`syncDomToStore`
 * doivent s'exécuter même si l'élément DOM à retirer est introuvable. Ce port
 * type donc `itemElement: HTMLElement | null` (compatible côté `window.removeImage`
 * par sous-typage simple : `HTMLElement` est assignable à `HTMLElement | null`,
 * aucune incompatibilité de compilation) ; `contracts.ts` n'est PAS modifié
 * (hors périmètre de ce paquet, interdiction commune (2)).
 * `getAdversaryImageInfo` : le paramètre `formData` (`medias.js:270`) n'est
 * JAMAIS lu dans le corps d'origine (qui lit `Store.state.formData` à la
 * place, un doublon apparent) — porté à l'identique, renommé `_formData` et
 * typé `unknown` (paramètre mort, appelant réel absent du graphe porté cf.
 * ci-dessus ; `unknown` car aucune forme n'est exploitée).
 *
 * Adaptations de TYPAGE PUR (aucune restructuration de logique, règle commune
 * §3/§9 ; même patron que `outils.ts`, `articulation.ts`, déjà portés) :
 *   - `document.getElementById` renvoie `HTMLElement | null` en TS strict :
 *     garde `if (!x) return;` ajoutée en tête de `handleFileChange`
 *     (conteneur statique du gabarit, jamais absent en pratique — même
 *     précédent que `articulation.ts`, cf. son en-tête). `updateCustomBgPreview`
 *     avait déjà cette garde dans l'original (`medias.js:186`), conservée telle
 *     quelle.
 *   - `HTMLInputElement.files` est `FileList | null` : capture locale
 *     (`const files = input.files; if (files && files.length > 0)`) au lieu de
 *     l'accès nu de l'original — même idiome que `@pctac/main.ts` (`files?.[0]`)
 *     et que `init.ts`/`outils.ts` (« capture locale avant lecture »).
 *   - `Store.state.objectUrlsCache[imgId]` / `…dynamic_photos[key]` :
 *     `noUncheckedIndexedAccess` impose une capture locale avant lecture —
 *     même idiome qu'`outils.ts` `cleanupObjectUrls` / `init.ts` `dbManager.deleteItem`.
 *   - `FileReader.result` est `string | ArrayBuffer | null` côté TS ; toujours
 *     une chaîne avec `readAsDataURL` — narrowing `typeof result === 'string'`
 *     avec `reject` de repli (jamais emprunté en pratique), même précédent que
 *     `@pctac/utils.ts:67-73`. Dupliqué deux fois (`handleFileChange`,
 *     `updateCustomBgPreview`) car l'original duplique déjà ce bloc sans le
 *     factoriser — fidélité, pas de helper introduit.
 *   - `canvas.getContext('2d')` est nullable côté TS (jamais gardé dans
 *     l'original) : garde `if (!ctx) { resolve(null); return; }` dans
 *     `loadImageAsBlobViaImageElement` — même précédent que `outils.ts`
 *     `compressImage` (:319), adapté au chemin `resolve(null)` (cette fonction
 *     ne rejette jamais, `medias.js:230`).
 *   - `querySelectorAll`/`closest` : generic explicite `<HTMLElement>` /
 *     `<HTMLImageElement>` (ce dernier pour lire `.src` dans `syncAllThumbnails`)
 *     — même précédent que `outils.ts`, `articulation.ts`, `@pctac/ui.ts`.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/medias.js` (lecture
 * seule).
 */
import { Store, dbManager } from '@oi/init.js';
import { compressImage } from '@oi/outils.js';

// ==================== MediaManager.js ====================

// medias.js:13-26 — table de correspondance aperçu (upload) → affichage
// (lecture seule dans les autres onglets). `null` = pas de miroir pour ce
// conteneur (Display map: preview container id => display container id).
const displayMap: Record<string, string | null> = {
    'adversary_photo_preview_container': 'adversary_photo_display',
    'adversary_extra_photos_preview_container': 'adversary_extra_photos_display',
    'renforts_photo_preview_container': 'renforts_photo_display',
    'adversary_photo_preview_container_2': 'adversary_photo_display_2',
    'adversary_extra_photos_preview_container_2': 'adversary_extra_photos_display_2',
    'photo_container_itineraire_exterieur_preview_container': 'photo_container_itineraire_exterieur_display',
    'photo_container_itineraire_interieur_preview_container': 'photo_container_itineraire_interieur_display',
    'photo_container_bapteme_terrain_preview_container': 'photo_container_bapteme_terrain_display',
    'photo_container_emplacement_ao_preview_container': 'photo_container_emplacement_ao_display',
    'photo_container_transport_pr_preview_container': null,
    'photo_container_transport_domicile_preview_container': null,
    'photo_container_cellule_effraction_preview_container': null,
};

// medias.js:28-100
export async function handleFileChange(
    input: HTMLInputElement,
    previewContainerId: string,
    isSingle: boolean,
): Promise<void> {
    // medias.js:29 — getElementById renvoie `HTMLElement | null` en TS strict ;
    // conteneur statique du gabarit, jamais absent en pratique (même précédent
    // que `articulation.ts`, cf. en-tête de ce fichier).
    const previewContainer = document.getElementById(previewContainerId);
    if (!previewContainer) return;

    if (isSingle) {
        const existingImages = previewContainer.querySelectorAll<HTMLElement>('.image-preview');
        for (const img of existingImages) {
            // Supprimer l'image, en passant l'élément parent pour suppression
            await removeImage(img.id, img.closest<HTMLElement>('.image-preview-item'));
        }
        previewContainer.innerHTML = '';
    }

    // medias.js:40 — capture locale (`files`) : `HTMLInputElement.files` est
    // `FileList | null` côté TS, jamais gardé dans l'original.
    const files = input.files;
    if (files && files.length > 0) {
        for (const file of Array.from(files)) {
            const previewImgId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            try {
                // Compression à l'upload : quasi sans perte (JPEG q0.95) avec
                // résolution généreuse (2560px max) pour préserver le détail
                // tout en allégeant IndexedDB et l'embarquement PDF.
                let blobToStore: Blob = file;
                try {
                    const compressedBuffer = await compressImage(file, 0.95, 2560);
                    blobToStore = new Blob([compressedBuffer], {
                        type: file.type === 'image/png' ? 'image/png' : 'image/jpeg'
                    });
                } catch (compressErr) {
                    console.warn("Compression échouée, stockage de l'original:", compressErr);
                    blobToStore = file;
                }

                await dbManager.putItem(previewImgId, blobToStore);

                // On utilise FileReader pour obtenir du Base64 (DataURL)
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        // medias.js:64 — `FileReader.result` est
                        // `string | ArrayBuffer | null` côté TS ; toujours une
                        // chaîne avec `readAsDataURL` (même précédent que
                        // `@pctac/utils.ts:67-73`), jamais emprunté en pratique.
                        const result = reader.result;
                        if (typeof result === 'string') {
                            resolve(result);
                        } else {
                            reject(new Error("FileReader n'a pas renvoyé de chaîne (readAsDataURL)."));
                        }
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blobToStore);
                });

                const interactiveItem = document.createElement('div');
                interactiveItem.className = 'image-preview-item draggable';
                interactiveItem.draggable = true;
                interactiveItem.id = previewImgId + "_item";

                const isEffrac = previewContainerId.includes('effrac');

                interactiveItem.innerHTML = `
                            <img id="${previewImgId}" class="image-preview" src="${base64Data}" style="display:block;" data-annotations="[]" data-tools="[]" data-other-tools="">
                            <input type="text" class="photo-title-input" placeholder="Légende de la photo..."
                                style="width: 100%; margin-top: 5px; background: var(--bg-interactive); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; padding: 2px 5px; font-size: 0.8em;"
                                oninput="syncDomToStore()">
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button type="button" class="add-btn" style="background-color: var(--accent-blue); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openAnnotationModal('${previewImgId}')" aria-label="Annoter la photo"><span class="material-symbols-outlined" style="font-size: 1.2em;">edit</span></button>
                                ${isEffrac ? `<button type="button" class="add-btn" style="background-color: var(--effraction-gold); padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="openEffractionToolsModal('${previewImgId}')" aria-label="Sélectionner les outils d'effraction"><span class="material-symbols-outlined" style="font-size: 1.2em;">hardware</span></button>` : ''}
                                <button type="button" class="remove-btn" style="padding: 4px 8px;" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="removeImage('${previewImgId}', this.closest('.image-preview-item'))" aria-label="Supprimer la photo">&times;</button>
                            </div>`;
                previewContainer.appendChild(interactiveItem);

            } catch (error) {
                console.error("Erreur lors du stockage de l'image (IndexedDB) - Persistance indisponible:", error);
                // OI3 — fail-loud : ne pas perdre une photo en silence.
                if (typeof window.toast === 'function') {
                    window.toast("Échec d'enregistrement d'une photo (stockage saturé/indisponible). Exportez votre session puis réessayez.", "error");
                }
            }
        }
    }
    syncAllThumbnails();
    if (input) input.value = '';
    window.syncDomToStore();
}

// medias.js:107-127
export async function removeImage(imgId: string, itemElement: HTMLElement | null): Promise<void> {
    try {
        // medias.js:110-112 — noUncheckedIndexedAccess : capture locale avant
        // lecture (même idiome qu'`init.ts` `dbManager.deleteItem` / `outils.ts`
        // `cleanupObjectUrls`), même condition qu'à l'origine.
        const cachedUrl = Store.state.objectUrlsCache[imgId];
        if (cachedUrl) {
            // Révocation de l'URL de l'objet et suppression du cache
            URL.revokeObjectURL(cachedUrl);
            delete Store.state.objectUrlsCache[imgId];
        }

        await dbManager.deleteItem(imgId);
        if (itemElement) itemElement.remove();
        syncAllThumbnails();
        window.syncDomToStore();
    } catch (error) {
        console.error("Erreur lors de la suppression de l'image:", error);
        // On n'alerte pas ici, car l'erreur pourrait être liée à IndexedDB,
        // mais on retire quand même l'élément de l'UI si possible.
        if (itemElement) itemElement.remove();
        syncAllThumbnails();
        window.syncDomToStore();
    }
}

// medias.js:129-157
export function syncAllThumbnails(): void {
    // Nettoyer UNIQUEMENT les conteneurs qui sont des cibles de synchronisation dans displayMap
    for (const previewId in displayMap) {
        const displayId = displayMap[previewId];
        if (displayId) {
            const displayContainer = document.getElementById(displayId);
            if (displayContainer) displayContainer.innerHTML = '';
        }
    }

    for (const previewId in displayMap) {
        const displayId = displayMap[previewId];
        if (!displayId) continue;

        const previewContainer = document.getElementById(previewId);
        const displayContainer = document.getElementById(displayId);

        if (previewContainer && displayContainer) {
            previewContainer.querySelectorAll<HTMLImageElement>('.image-preview-item img').forEach(previewImg => {
                const displayImg = document.createElement('img');
                displayImg.className = 'image-preview';
                // IMPORTANT: Utilisez toujours l'URL de l'objet du DOM, qui est l'URL de l'objet Blob
                displayImg.src = previewImg.src;
                displayImg.dataset.refId = previewImg.id;
                displayContainer.appendChild(displayImg);
            });
        }
    }
}

// medias.js:159-172
export async function handleCustomBackgroundChange(input: HTMLInputElement): Promise<void> {
    // medias.js:160 — noUncheckedIndexedAccess : capture locale avant lecture
    // (même idiome qu'ailleurs dans ce fichier), même condition
    // (`input.files && input.files[0]`) qu'à l'origine.
    const file = input.files?.[0];
    if (file) {
        try {
            await dbManager.putItem('custom_pdf_background', file);
            updateCustomBgPreview();
            alert("Fond personnalisé enregistré.");
        } catch (e) {
            console.error(e);
            alert("Erreur lors de l'enregistrement du fond.");
        }
    }
    input.value = '';
}

// medias.js:174-182
export async function removeCustomBackground(): Promise<void> {
    try {
        await dbManager.deleteItem('custom_pdf_background');
        updateCustomBgPreview();
        alert("Fond personnalisé supprimé. Le fond par défaut sera utilisé.");
    } catch (e) {
        console.error(e);
    }
}

// medias.js:184-208
export async function updateCustomBgPreview(): Promise<void> {
    const container = document.getElementById('custom_bg_preview_container');
    if (!container) return;
    container.innerHTML = '';
    try {
        const blob = await dbManager.getItem('custom_pdf_background');
        if (blob) {
            const base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    // medias.js:193 — mêmes raisons qu'en :64 (cf. commentaire
                    // `handleFileChange`).
                    const result = reader.result;
                    if (typeof result === 'string') {
                        resolve(result);
                    } else {
                        reject(new Error("FileReader n'a pas renvoyé de chaîne (readAsDataURL)."));
                    }
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            const img = document.createElement('img');
            img.src = base64Data;
            img.className = 'image-preview';
            img.style.maxWidth = '200px';
            container.appendChild(img);
        } else {
            container.innerHTML = '<p style="font-style:italic; color:var(--text-secondary);">Aucun fond personnalisé. Fond par défaut actif.</p>';
        }
    } catch (e) {
        console.error(e);
    }
}

// medias.js:210-233
function loadImageAsBlobViaImageElement(resolvedUrl: string): Promise<Blob | null> {
    return new Promise<Blob | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                if (!canvas.width || !canvas.height) {
                    resolve(null);
                    return;
                }
                const ctx = canvas.getContext('2d');
                // medias.js:222 — `ctx` jamais gardé dans l'original ; nullable
                // côté TS. Le `try/catch` englobant capturait déjà un éventuel
                // TypeError sur `.drawImage(null)` et résolvait `null` — même
                // résultat via une garde explicite (même précédent que
                // `outils.ts` `compressImage` :319, adapté au chemin
                // `resolve(null)` : cette fonction ne rejette jamais, `medias.js:230`).
                if (!ctx) {
                    resolve(null);
                    return;
                }
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => resolve(blob || null), 'image/png');
            } catch (err) {
                console.warn('Repli canvas image fond:', err);
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = resolvedUrl;
    });
}

// medias.js:235-268 — CODE MORT confirmé (cf. en-tête de ce fichier) : porté à
// l'identique, exporté pour satisfaire `noUnusedLocals`, jamais posé sur `window`.
export async function fetchImageAndCompress(imagePath: string, quality: number): Promise<ArrayBuffer | null> {
    try {
        const resolvedUrl = new URL(imagePath, window.location.href).href;
        let blob: Blob | null = null;
        try {
            const response = await fetch(resolvedUrl);
            if (response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.startsWith('image/')) {
                    blob = await response.blob();
                    if (blob.size < 100) {
                        console.warn(`Image blob trop petit (${blob.size}b) pour ${imagePath}`);
                        blob = null;
                    }
                } else {
                    console.warn(`Type de contenu invalide (${contentType}) pour ${imagePath}`);
                }
            }
        } catch (fetchErr) {
            console.warn(`fetch indisponible pour ${imagePath}, repli <img> :`, fetchErr);
        }
        if (!blob) {
            blob = await loadImageAsBlobViaImageElement(resolvedUrl);
        }
        if (!blob) {
            console.error(`Impossible de charger l'image: ${imagePath}`);
            return null;
        }
        return await compressImage(blob, quality);
    } catch (error) {
        console.error(`Erreur de chargement/compression de l'image ${imagePath}:`, error);
        return null;
    }
}

// medias.js:270-282 — CODE MORT confirmé (cf. en-tête de ce fichier) : porté à
// l'identique, exporté pour satisfaire `noUnusedLocals`, jamais posé sur
// `window`. `_formData` : paramètre jamais lu dans l'original (écart de
// contrat signalé au gate, cf. en-tête).
export function getAdversaryImageInfo(
    _formData: unknown,
    adversaryIndex: number = 1,
): { id: string; annotationsJson: string } | null {
    const mainPhotoContainerId = adversaryIndex === 1 ? 'adversary_photo_preview_container' : 'adversary_photo_preview_container_2';
    // medias.js:272-273 — noUncheckedIndexedAccess : capture locale avant
    // lecture, même idiome qu'ailleurs dans ce fichier.
    const dynamicPhotos = Store.state.formData.dynamic_photos;
    const photos = dynamicPhotos ? dynamicPhotos[mainPhotoContainerId] : undefined;
    const firstImage = photos ? photos[0] : undefined;
    if (firstImage) {
        return {
            id: firstImage.id,
            annotationsJson: firstImage.annotations || '[]'
        };
    }
    return null;
}

// medias.js:103-105 — export des fonctions au scope global. L'original ne pose
// que 3 des 6 noms ICI (les 3 autres étaient déjà globales, déclarations de
// fonction hoistées en script classique) ; ce port pose LES 6, EN FIN DE
// MODULE, ordre du contrat `OiMediaGlobals` (cf. en-tête de ce fichier).
window.handleFileChange = handleFileChange;
window.removeImage = removeImage;
window.syncAllThumbnails = syncAllThumbnails;
window.handleCustomBackgroundChange = handleCustomBackgroundChange;
window.removeCustomBackground = removeCustomBackground;
window.updateCustomBgPreview = updateCustomBgPreview;
