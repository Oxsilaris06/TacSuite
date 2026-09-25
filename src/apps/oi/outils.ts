/**
 * outils.ts — Géométrie canvas, compression d'image, thème/dock, plein écran
 * (P3.CONV, paquet `oi-outils`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM de `modules/outils.js` (GStart-main, lecture
 * seule, 430 LOC intégral) : `hexToRgb` (:8), `cleanupObjectUrls` (:17),
 * `getEventPos` (:27), `getRotatedPoint` (:40), `getAnnotationAtPosition`
 * (:51), `getDragAfterElement` (:121), `compressImage` (:136),
 * `isPngArrayBuffer` (:191), `isJpegArrayBuffer` (:197),
 * `embedPdfImageFromBytes` (:207), `reencodeImageViaCanvasForPdf` (:237),
 * `isFullscreen` (:364), `toggleFullscreen` (:368), `updateFullscreenIcon`
 * (:392), `handleThemeToggle` (:405), `toggleDock` (:416). Cf.
 * `docs/SPEC-OI-CONVERSION.md` §11.7, `PAQUETS-OI.json` (`oi-outils`).
 *
 * Implémente `OiToolsGlobals` (`@shared/types/contracts.js`) pour la partie
 * exposée sur `window` : `cleanupObjectUrls`, `toggleFullscreen`,
 * `handleThemeToggle`, `toggleDock`. Posées AU SCOPE MODULE, immédiatement
 * après chaque déclaration — comme l'original le fait explicitement pour
 * `cleanupObjectUrls` (:25) ; en script classique les 3 autres devenaient
 * globales implicitement (déclaration de fonction top-level), un module ESM
 * ne le fait pas : l'exposition explicite est donc REQUISE ici, pas une
 * addition de confort.
 *
 * Code mort confirmé, porté par fidélité (PAQUETS-OI.json `oi-outils`) :
 * `embedPdfImageFromBytes` (:207) n'a AUCUN appelant dans toute la source ;
 * exportée pour satisfaire `noUnusedLocals`, jamais posée sur `window`.
 *
 * ÉCART DE CONTRAT SIGNALÉ AU GATE (règle commune (6), SPEC §2.2) :
 * `getAnnotationAtPosition` lit, pour les types 'location'/'box', des champs
 * `x`/`y`/`radius`/`width`/`height` qu'`OiShapeAnnotation` (contracts.ts) ne
 * déclare pas (seuls `startX/startY/endX/endY/thickness` y figurent). Ces
 * champs sont pourtant bien posés à l'exécution par `dessin.js`
 * (`final.width`/`final.height` :899-900, `final.radius` :909 — GStart-main,
 * lecture seule) : contrat INCOMPLET, pas un bug de la source. Voir le
 * commentaire détaillé au-dessus de `OiShapeAnnotationWithBounds` plus bas
 * dans ce fichier. `contracts.ts` n'est PAS modifié (hors périmètre de ce
 * paquet, interdiction commune (2)).
 *
 * Autres adaptations de TYPAGE PUR (aucun changement de comportement
 * observable) :
 *  - `getEventPos` : `(evt as MouseEvent).clientX/.clientY` dans la branche
 *    « pas de touch » — `TouchEvent` n'a pas `.clientX` côté lib.dom.d.ts ;
 *    l'original lit `evt.clientX` sans discrimination de type (duck-typing)
 *    y compris dans le cas limite `TouchEvent` à `touches` vide (retournerait
 *    `undefined` dans les deux versions).
 *  - `compressImage`, `reencodeImageViaCanvasForPdf` : `canvas.getContext('2d')`
 *    est nullable côté TS (jamais gardé dans l'original) ; un `reject`/`throw`
 *    minimal réutilise le même chemin d'erreur que les autres échecs déjà
 *    gérés par ces fonctions — jamais emprunté en pratique.
 *  - `isFullscreen`/`toggleFullscreen` : vendor prefixes non déclarés par
 *    lib.dom.d.ts (`webkitFullscreenElement`, `mozRequestFullScreen`, …) —
 *    même idiome que `@pctac/ui.ts:826-828` (précédent déjà validé).
 *  - `toggleDock` : `localStorage.setItem('dockCollapsed', String(dockCollapsed))`
 *    — `Storage.setItem` exige une `string` ; `String(boolean)` reproduit la
 *    coercion DOMString native que l'original obtenait implicitement (même
 *    précédent que `@pctac/ui.ts:855`).
 *  - `hexToRgb`, `getDragAfterElement` : `noUncheckedIndexedAccess` impose une
 *    capture locale (`?? ''`) ou un typage explicite de l'accumulateur —
 *    mêmes idiomes que `carto/map-core.ts` (`_parseGps`) et `init.ts`.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/outils.js` (lecture
 * seule).
 */
import type { PDFDocument, PDFImage } from 'pdf-lib';

import { Store } from '@oi/init.js';

// ==================== Utils.js ====================

// Déplacées dans le moteur d'annotation (`@oi/dessin.js`), qui ne dépend plus
// de ce module (décision 25) ; réexportées pour les importeurs existants.
export { getAnnotationAtPosition, getEventPos, getRotatedPoint, hexToRgb } from '@oi/dessin.js';


// outils.js:17-24
export function cleanupObjectUrls(): void {
    // outils.js:18-19 — noUncheckedIndexedAccess : capture locale avant
    // lecture (même idiome qu'`init.ts` dbManager.deleteItem), même condition
    // qu'à l'origine.
    for (const urlId in Store.state.objectUrlsCache) {
        const url = Store.state.objectUrlsCache[urlId];
        if (url) {
            URL.revokeObjectURL(url);
        }
    }
    Store.state.objectUrlsCache = {};
}
window.cleanupObjectUrls = cleanupObjectUrls; // outils.js:25


// outils.js:121-134
export function getDragAfterElement(container: HTMLElement, y: number): HTMLElement | undefined {
    // S'assurer de ne considérer que les éléments qui peuvent être déplacés
    const draggableElements = [...container.querySelectorAll<HTMLElement>('.draggable:not(.dragging):not(.time-item)')];
    // outils.js:124,133 — l'accumulateur initial n'a pas de propriété
    // `element` (`.element` vaut alors `undefined`, cas « conteneur vide » /
    // « aucun élément plus proche ») : typé explicitement en optionnel pour
    // refléter ce comportement exact (`exactOptionalPropertyTypes` : jamais
    // assigné à `undefined` explicitement, toujours omis ou renseigné).
    return draggableElements.reduce<{ offset: number; element?: HTMLElement }>(
        (closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            }
            else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * Image que le navigateur ne sait pas décoder (format inconnu, fichier abîmé,
 * HEIC non convertible) : l'appelant la REFUSE plutôt que de la stocker, elle
 * n'apparaîtrait jamais dans le PDF (audit PDF du 2026-09-25, F10). Reconnue
 * par son `name` (sûr même à travers les doubles de test d'un module).
 */
export class ImageDecodeError extends Error {
    override name = 'ImageDecodeError';
}

/** HEIC/HEIF par type MIME, ou par extension quand le type est vide — même règle que PC-Tac (`pctac/utils.ts`). */
function looksLikeHeic(blob: Blob): boolean {
    const type = (blob.type || '').toLowerCase();
    if (type === 'image/heic' || type === 'image/heif') return true;
    if (type) return false;
    const name = blob instanceof File ? blob.name.toLowerCase() : '';
    return name.endsWith('.heic') || name.endsWith('.heif');
}

/**
 * Compresse une image par canvas (JPEG, ou PNG si la source l'est). HEIC/HEIF
 * (décision 34, comme PC-Tac) : décodage natif d'abord (Safari sait), sinon
 * conversion en JPEG par `heic-to`, chargé À LA DEMANDE. Lève
 * `ImageDecodeError` si l'image reste illisible.
 */
export async function compressImage(imageBlob: Blob, quality: number, maxDimension: number = 1920): Promise<ArrayBuffer> {
    try {
        return await compressViaCanvas(imageBlob, quality, maxDimension);
    } catch (e) {
        if (!(e instanceof ImageDecodeError) || !looksLikeHeic(imageBlob)) throw e;
    }
    let jpeg: Blob;
    try {
        const { heicTo } = await import('heic-to');
        jpeg = await heicTo({ blob: imageBlob, type: 'image/jpeg', quality: 0.9 });
    } catch {
        throw new ImageDecodeError('Photo HEIC illisible : conversion impossible (hors ligne ou fichier abîmé).');
    }
    return compressViaCanvas(jpeg, quality, maxDimension);
}

// outils.js:136-188
function compressViaCanvas(imageBlob: Blob, quality: number, maxDimension: number): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const img = new Image();
        const objectURL = URL.createObjectURL(imageBlob);
        img.src = objectURL;

        img.onload = () => {
            URL.revokeObjectURL(objectURL);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            // outils.js:145 — l'original ne garde jamais `ctx` nul (aucun
            // branchement dans la source) ; `!` interdit ⇒ ce `reject` referme
            // le seul chemin d'erreur possible ici (même famille que le rejet
            // « conversion en Blob échouée » plus bas), jamais emprunté en
            // pratique.
            if (!ctx) {
                reject(new Error('Impossible d\'obtenir le contexte 2D du canvas.'));
                return;
            }

            const MAX_DIMENSION = maxDimension;
            let { naturalWidth: width, naturalHeight: height } = img;
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                if (width > height) {
                    height = (MAX_DIMENSION / width) * height;
                    width = MAX_DIMENSION;
                } else {
                    width = (MAX_DIMENSION / height) * width;
                    height = MAX_DIMENSION;
                }
            }
            canvas.width = width;
            canvas.height = height;

            // CORRECTION: Pour les PNG (image de fond ou annotée), ne pas forcer le fond blanc
            if (imageBlob.type !== 'image/png') {
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('La conversion du canevas en Blob a échoué.'));
                        return;
                    }
                    // arrayBuffer() est asynchrone sur Blob (navigateurs récents) — ne pas résoudre la Promise.
                    Promise.resolve(blob.arrayBuffer()).then(resolve).catch(reject);
                },
                // Utiliser PNG si le Blob original était PNG (y compris les images annotées), JPEG sinon
                (imageBlob.type === 'image/png' ? 'image/png' : 'image/jpeg'),
                quality,
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectURL);
            reject(new ImageDecodeError("Échec du chargement du Blob de l'image dans l'élément Image."));
        };
    });
}

/**
 * Définition maximale admise au ré-encodage d'ENTRÉE — alignée sur le plafond
 * du pipeline photo du PDF (`engine-v3.ts`, SPEC §3.5) : aucune définition
 * n'est perdue en aval, l'image est seulement reconstruite sans métadonnées.
 */
const EXIF_REENCODE_MAX_DIMENSION = 2560;

/**
 * Ré-encode une image par canvas à l'ENTRÉE, pour supprimer tout segment EXIF
 * — donc les coordonnées GPS (audit PDF du 2026-09-25, F09).
 *
 * Les photos saisies par les champs photo traversent déjà le pipeline canvas
 * (`medias.ts`, `engine-v3.ts`) et ressortent propres. Deux chemins, eux,
 * stockaient l'octet d'origine : le **fond PDF personnalisé**
 * (`medias.ts::handleCustomBackgroundChange`) et les **images d'un import
 * d'archive** (`formulaires.ts`). Un fond photographié sur place partait donc
 * dans le PDF — et dans les archives échangées entre unités — avec le lieu de
 * prise de vue, alors que la décision 34 promet l'inverse pour PC-Tac
 * (« position jamais gardée dans l'image »).
 *
 * Le format d'entrée est conservé (PNG reste PNG, JPEG reste JPEG) ; seul le
 * passage par le canvas compte, il reconstruit l'image sans ses métadonnées.
 * Lève si l'image n'est pas décodable : à l'appelant de refuser proprement
 * plutôt que de laisser passer un fichier qui n'apparaîtra jamais dans le PDF.
 */
export async function reencodeSansExif(imageBlob: Blob, quality = 0.95): Promise<Blob> {
    const octets = await compressImage(imageBlob, quality, EXIF_REENCODE_MAX_DIMENSION);
    return new Blob([octets], { type: imageBlob.type === 'image/png' ? 'image/png' : 'image/jpeg' });
}

/** Détecte PNG (signature IHDR) pour choisir embedPng vs embedJpg (pdf-lib). */
// outils.js:191-195
export function isPngArrayBuffer(buffer: unknown): boolean {
    // outils.js:191 — `buffer` peut être n'importe quelle valeur passée par
    // l'appelant (retour de fetch, de dbManager.getItem, etc.) : `unknown`
    // reflète fidèlement l'absence de typage de l'original, resserré par
    // `instanceof ArrayBuffer` avant tout accès.
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) return false;
    const b = new Uint8Array(buffer, 0, 8);
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

// outils.js:197-201
export function isJpegArrayBuffer(buffer: unknown): boolean {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 3) return false;
    const b = new Uint8Array(buffer, 0, 3);
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/**
 * Embarque des octets image (JPEG ou PNG) dans un document pdf-lib.
 * compressImage() émet du PNG pour tout blob source PNG — ne pas supposer du JPEG.
 *
 * outils.js:207-232 — CODE MORT confirmé (aucun appelant dans toute la
 * source, PAQUETS-OI.json `oi-outils`) : portée à l'identique par fidélité,
 * exportée pour `noUnusedLocals`, jamais posée sur `window`.
 */
export async function embedPdfImageFromBytes(pdfDoc: PDFDocument, imageBytesInput: ArrayBuffer | Promise<ArrayBuffer>): Promise<PDFImage | null> {
    // outils.js:208-210 — l'original accepte indifféremment un ArrayBuffer
    // déjà résolu ou une Promise (duck-typing `typeof imageBytes.then ===
    // 'function'`) ; typé ici en union explicite (pas de `any`).
    const imageBytes: ArrayBuffer = imageBytesInput instanceof Promise ? await imageBytesInput : imageBytesInput;

    // Protection contre le bug "[object ArrayBuffer]" (exactement 20 octets)
    if (!imageBytes || imageBytes.byteLength === 0 || imageBytes.byteLength === 20) {
        console.error("embedPdfImageFromBytes: Données invalides ou corrompues (20 octets).");
        return null;
    }

    // Logique simplifiée et robuste calquée sur 4.html
    try {
        // Tentative directe PNG (pdf-lib gère les erreurs en interne)
        return await pdfDoc.embedPng(imageBytes);
    } catch {
        try {
            // Tentative JPEG
            return await pdfDoc.embedJpg(imageBytes);
        } catch {
            console.warn("embedPdfImageFromBytes: Échec PNG et JPEG directs, tentative Canvas (fallback).");
            // Dernier recours pour les formats comme WebP ou formats mal identifiés
            return reencodeImageViaCanvasForPdf(pdfDoc, imageBytes);
        }
    }
}

/**
 * Dernier recours : décode via <img> + canvas → JPEG pour pdf-lib (WebP, JPEG corrompu, etc.).
 */
// outils.js:237-360
export async function reencodeImageViaCanvasForPdf(pdfDoc: PDFDocument, imageBytes: ArrayBuffer): Promise<PDFImage> {
    console.group("fallback re-encoding via canvas");

    // Validation des données d'entrée - Sanity check
    if (!imageBytes || imageBytes.byteLength < 100) {
        console.error('reencodeImageViaCanvasForPdf: Données image corrompues ou trop petites (< 100 octets)');
        console.groupEnd();
        throw new Error('Données image corrompues ou incomplètes (trop petites)');
    }

    // Convertir en Blob
    let blob: Blob;
    try {
        blob = new Blob([imageBytes]);
    } catch (e) {
        console.error('reencodeImageViaCanvasForPdf: Erreur lors de la création du Blob:', e);
        console.groupEnd();
        throw new Error('Impossible de créer le Blob image');
    }

    // Vérification de base
    if (!blob || blob.size === 0) {
        console.error('reencodeImageViaCanvasForPdf: Blob invalide ou vide');
        throw new Error('Blob image invalide - taille nulle');
    }

    const url = URL.createObjectURL(blob);

    try {
        // Vérifier le type de fichier avant d'essayer de décoder
        if (blob.type && !blob.type.startsWith('image/')) {
            console.warn('reencodeImageViaCanvasForPdf: Type d\'image inconnu, tentative de décodage forcé');
        }

        return await new Promise<PDFImage>((resolve, reject) => {
            const bitmap = new Image();

            // Log détaillé des paramètres
            console.log('Début du décodage image avec parameters:', {
                urlLength: url.length,
                blobSize: blob.size,
                blobType: blob.type || 'inconnu',
                isArrayBuffer: ArrayBuffer.isView(imageBytes),
                // outils.js:280 — `imageBytes` est ici typé `ArrayBuffer`
                // (jamais `string`) : la branche est structurellement
                // inatteignable (`never`), TS interdit l'accès direct à
                // `.substring` dessus ; passage par `unknown` pour conserver
                // le ternaire défensif de l'original tel quel.
                imageBytesPreview: typeof imageBytes === 'string' ? (imageBytes as unknown as string).substring(0, 100) : 'non-string'
            });

            bitmap.onload = () => {
                console.log('✅ Image décodée avec succès:', {
                    width: bitmap.width,
                    height: bitmap.height,
                    naturalWidth: bitmap.naturalWidth,
                    naturalHeight: bitmap.naturalHeight,
                    complete: bitmap.complete
                });

                // Vérifier que l'image a des dimensions valides
                if (bitmap.naturalWidth === 0 || bitmap.naturalHeight === 0) {
                    reject(new Error('Image sans dimensions naturelles - probablement corrompue'));
                    return;
                }

                const canvas = document.createElement('canvas');
                canvas.width = bitmap.naturalWidth;
                canvas.height = bitmap.naturalHeight;

                // Créer un contexte 2D et dessiner l'image
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Impossible d\'obtenir le contexte 2D du canvas'));
                    return;
                }

                // Remplir avec fond blanc pour les formats non PNG
                if (blob.type !== 'image/png') {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                ctx.drawImage(bitmap, 0, 0);

                // Exporter en JPEG avec qualité adaptée
                canvas.toBlob((jpegBlob) => {
                    if (!jpegBlob || jpegBlob.size === 0) {
                        reject(new Error('toBlob JPEG échoué - image vide'));
                        return;
                    }

                    console.log('✅ Blob JPEG généré, taille:', jpegBlob.size);
                    Promise.resolve(jpegBlob.arrayBuffer()).then(async ab => {
                        try {
                            const embedded = await pdfDoc.embedJpg(ab);
                            resolve(embedded);
                        } catch (e) {
                            console.error('Erreur lors de l\'embedding du JPG:', e);
                            // Fallback: essayer d'abord en PNG si JPEG échoue
                            if (blob.type === 'image/jpeg') {
                                throw new Error('Embedding JPEG échoué et blob type est déjà JPEG');
                            }
                            // Essayer de convertir en PNG pour l'embedding
                            canvas.toBlob((pngBlob) => {
                                if (!pngBlob || pngBlob.size === 0) {
                                    reject(new Error('toBlob PNG échoué'));
                                    return;
                                }
                                Promise.resolve(pngBlob.arrayBuffer()).then(ab2 => {
                                    pdfDoc.embedPng(ab2).then(resolve).catch(reject);
                                }).catch(reject);
                            }, 'image/png', 0.92);
                        }
                    }).catch(reject);
                }, 'image/jpeg', 0.85); // Qualité légèrement réduite pour les images complexes
            };

            bitmap.onerror = (event) => {
                // outils.js:350-353 — l'original accède à `e.message` sur
                // l'argument "event" du handler `onerror` (qui n'est PAS une
                // Error : `Event | string` selon lib.dom.d.ts, l'objet Error
                // éventuel est le 5ᵉ paramètre, non lu par l'original) ; TS
                // interdit l'accès direct. Passage par `unknown` : reproduit
                // exactement le même résultat à l'exécution (`undefined` dans
                // tous les cas réels, d'où le repli 'unknown error' déjà
                // présent dans l'original).
                const message = (event as unknown as { message?: string }).message;
                console.error('❌ Erreur de décodage image:', event, 'URL préfixe:', url.substring(0, 100));
                reject(new Error(`Échec du décodage d'image: ${message || 'unknown error'}`));
            };

            bitmap.src = url;
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

// ==================== UI.js ====================

/**
 * outils.js:364-390 — accès typés aux API plein écran préfixées (vendor),
 * non déclarées par lib.dom.d.ts. Même idiome que `@pctac/ui.ts:826-828`
 * (précédent déjà validé par un `tsc --noEmit` vide).
 */
interface OiVendorFullscreenDocumentElement extends HTMLElement {
    mozRequestFullScreen?: () => void;
    webkitRequestFullscreen?: () => void;
    msRequestFullscreen?: () => void;
}
interface OiVendorFullscreenDocument extends Document {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
    mozCancelFullScreen?: () => void;
    webkitExitFullscreen?: () => void;
    msExitFullscreen?: () => void;
}

// outils.js:364-366
export function isFullscreen(): Element | null | undefined {
    const doc = document as OiVendorFullscreenDocument;
    return document.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
}

// outils.js:368-390
export function toggleFullscreen(): void {
    if (!isFullscreen()) {
        const docEl = document.documentElement as OiVendorFullscreenDocumentElement;
        if (docEl.requestFullscreen) {
            docEl.requestFullscreen();
        } else if (docEl.mozRequestFullScreen) { /* Firefox */
            docEl.mozRequestFullScreen();
        } else if (docEl.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
            docEl.webkitRequestFullscreen();
        } else if (docEl.msRequestFullscreen) { /* IE/Edge */
            docEl.msRequestFullscreen();
        }
    } else {
        const doc = document as OiVendorFullscreenDocument;
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (doc.mozCancelFullScreen) { /* Firefox */
            doc.mozCancelFullScreen();
        } else if (doc.webkitExitFullscreen) { /* Chrome, Safari and Opera */
            doc.webkitExitFullscreen();
        } else if (doc.msExitFullscreen) { /* IE/Edge */
            doc.msExitFullscreen();
        }
    }
}
window.toggleFullscreen = toggleFullscreen; // outils.js:368 — posée explicitement (cf. en-tête de fichier)

// outils.js:392-403
export function updateFullscreenIcon(): void {
    const icon = document.getElementById('fullscreenIcon');
    if (icon) {
        if (isFullscreen()) {
            icon.textContent = 'fullscreen_exit';
            icon.title = 'Quitter le plein écran';
        } else {
            icon.textContent = 'fullscreen';
            icon.title = 'Plein écran';
        }
    }
}

// outils.js:405-414
export function handleThemeToggle(): void {
    document.body.classList.toggle('light-mode');
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    // U20 — pont de continuité : le portail lit sa propre clé.
    localStorage.setItem('tacsuite.portal.theme', isDarkMode ? 'dark' : 'light');
    const icon = document.getElementById('darkModeIcon');
    if (icon) {
        icon.textContent = isDarkMode ? 'nightlight' : 'clear_day';
    }
}
window.handleThemeToggle = handleThemeToggle; // outils.js:405 — posée explicitement (cf. en-tête de fichier)

// outils.js:416-428
export function toggleDock(): void {
    const dock = document.getElementById('dockMenu');
    if (!dock) return;
    const dockCollapsed = dock.classList.toggle('collapsed');
    // outils.js:420 — `Storage.setItem` exige une `string` ; `String(boolean)`
    // reproduit la coercion DOMString native que l'original obtenait
    // implicitement (même précédent que `@pctac/ui.ts:855`).
    localStorage.setItem('dockCollapsed', String(dockCollapsed));

    // Mise à jour de l'icône de toggle
    const icon = document.querySelector('#dockToggleBtn .material-symbols-outlined');
    if (icon) {
        // Inverser l'icône : expand_more (pointe vers le bas/ouvert) -> expand_less (pointe vers le haut/fermé)
        icon.textContent = dockCollapsed ? 'expand_less' : 'expand_more';
    }
}
window.toggleDock = toggleDock; // outils.js:416 — posée explicitement (cf. en-tête de fichier)
