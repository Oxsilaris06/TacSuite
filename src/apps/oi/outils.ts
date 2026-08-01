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
import { oiState } from '@oi/state.js';
import type { OiAnnotation, OiPointAnnotation, OiShapeAnnotation } from '@shared/types/contracts.js';

// ==================== Utils.js ====================

// outils.js:8-15
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    // outils.js:10-14 — noUncheckedIndexedAccess : la regex a exactement 3
    // groupes capturants NON optionnels, donc toujours renseignés quand
    // `result` est non nul (même idiome que `carto/map-core.ts` `_parseGps`) ;
    // `?? ''` ne change rien en pratique (jamais atteint), `parseInt('', 16)`
    // vaut `NaN` comme `parseInt(undefined, 16)` dans l'original.
    return result
        ? {
              r: parseInt(result[1] ?? '', 16),
              g: parseInt(result[2] ?? '', 16),
              b: parseInt(result[3] ?? '', 16),
          }
        : null;
}

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

// outils.js:27-38
export function getEventPos(canvas: HTMLCanvasElement, evt: MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    // Utiliser une vérification plus robuste pour l'événement tactile
    // outils.js:30-31 — `'touches' in evt` distingue MouseEvent/TouchEvent
    // (même test que le duck-typing `evt.touches && …` de l'original) ;
    // noUncheckedIndexedAccess impose une capture locale de `touches[0]`
    // (`TouchList[0]` est `Touch | undefined`) avant lecture.
    const touch = 'touches' in evt && evt.touches.length > 0 ? evt.touches[0] : undefined;
    // outils.js:30-31 — dans la branche « pas de touch », l'original lit
    // `evt.clientX` sans discriminer le type (y compris si `evt` est un
    // TouchEvent à `touches` vide, où `.clientX` vaut `undefined` — même
    // issue avec ce cast, comportement identique).
    const clientX = touch ? touch.clientX : (evt as MouseEvent).clientX;
    const clientY = touch ? touch.clientY : (evt as MouseEvent).clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
}

// outils.js:40-49
export function getRotatedPoint(
    x: number,
    y: number,
    centerX: number,
    centerY: number,
    angle: number,
): { x: number; y: number } {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const translatedX = x - centerX;
    const translatedY = y - centerY;
    return {
        x: translatedX * cos - translatedY * sin + centerX,
        y: translatedX * sin + translatedY * cos + centerY,
    };
}

/**
 * ÉCART DE CONTRAT SIGNALÉ (règle commune (6), SPEC §2.2) — voir le
 * commentaire de tête de fichier. `OiShapeAnnotation` (contracts.ts) ne
 * déclare que `startX/startY/endX/endY/thickness/text/opacity` pour
 * 'location'|'arrow'|'box' ; le hit-test original lit en plus `x`/`y`/`radius`
 * ('location') et `x`/`y`/`width`/`height` ('box'), champs réellement posés
 * par `dessin.js` (:795-800, :899-909 — GStart-main, lecture seule).
 * Élargissement LOCAL à ce fichier, EN LECTURE SEULE : n'écrit aucun champ,
 * ne redéfinit pas `OiShapeAnnotation`/`OiAnnotation` (exports canoniques de
 * contracts.ts inchangés). `contracts.ts` est hors périmètre de ce paquet
 * (src/shared/**, interdiction commune (2)) : à corriger au gate.
 */
type OiShapeAnnotationWithBounds = OiShapeAnnotation & {
    x: number;
    y: number;
    radius: number;
    width: number;
    height: number;
};
type OiAnnotationForHitTest = OiPointAnnotation | OiShapeAnnotationWithBounds;

/**
 * outils.js:51-119 — lit `Store.state.annotations` (parcours en ordre
 * inverse : la dernière annotation dessinée est testée en premier) et
 * `oiState.ctx` (mesure de texte pour 'text'/'member'). NE PAS simplifier la
 * trigonométrie ni les tolérances (PAQUETS-OI.json `oi-outils`).
 */
export function getAnnotationAtPosition(x: number, y: number): OiAnnotation | null {
    // outils.js:80,87 — `ctx` capturé une seule fois : le `const` narrowé par
    // les gardes ci-dessous reste non nul pour le reste de la fonction (même
    // idiome que `carto/map-core.ts`, capture locale dès l'entrée).
    const ctx = oiState.ctx;

    for (let i = Store.state.annotations.length - 1; i >= 0; i--) {
        // outils.js:53 — noUncheckedIndexedAccess (index toujours valide par
        // construction de la boucle, jamais vérifié dans l'original) combiné
        // à l'élargissement de contrat ci-dessus : passage par `unknown`,
        // aucun sous-typage direct n'exprime les deux écarts à la fois.
        const annotation = Store.state.annotations[i] as unknown as OiAnnotationForHitTest;
        const angle = annotation.rotation || 0;
        // outils.js:55 — TypeScript exige une valeur initiale (analyse de
        // définite assignment) : le if/else if ci-dessous couvre
        // exhaustivement les 5 types d'annotation (aucun `else` dans
        // l'original) ; ces valeurs par défaut ne sont donc jamais lues en
        // pratique — écart de typage assumé, comportement identique
        // (l'original laissait `undefined`, jamais lu non plus dans ce cas).
        let centerX = 0;
        let centerY = 0;

        if (annotation.type === 'location' || annotation.type === 'text' || annotation.type === 'member') {
            centerX = annotation.x;
            centerY = annotation.y;
        } else if (annotation.type === 'box') {
            centerX = annotation.x + annotation.width / 2;
            centerY = annotation.y + annotation.height / 2;
        } else if (annotation.type === 'arrow') {
            centerX = (annotation.startX + annotation.endX) / 2;
            centerY = (annotation.startY + annotation.endY) / 2;
        }

        // Pour des Store.state.annotations simples, le centre de rotation est le centre de l'objet
        const rotatedPos = getRotatedPoint(x, y, centerX, centerY, angle);
        const testX = rotatedPos.x;
        const testY = rotatedPos.y;

        const tolerance = 15;
        let isInside = false;

        switch (annotation.type) {
            case 'location':
                isInside = Math.sqrt(Math.pow(testX - annotation.x, 2) + Math.pow(testY - annotation.y, 2)) <= annotation.radius + tolerance / 2;
                break;
            case 'box':
                isInside = testX >= annotation.x - tolerance && testX <= annotation.x + annotation.width + tolerance &&
                    testY >= annotation.y - tolerance && testY <= annotation.y + annotation.height + tolerance;
                break;
            case 'text': {
                // Simple bounding box approx
                const size = annotation.size || 30;
                // outils.js:80 — `ctx` potentiellement `null` côté TS (jamais
                // en pratique, cf. capture ci-dessus) ; `!` interdit ⇒ un
                // `break` laisse `isInside` à `false`, même issue observable
                // que l'exception que l'original aurait levée ici (annotation
                // ignorée par ce test de position).
                if (!ctx) break;
                ctx.font = `bold ${size}px Oswald`;
                const w = ctx.measureText(annotation.text).width;
                const h = size;
                isInside = testX >= annotation.x && testX <= annotation.x + w && testY >= annotation.y - h && testY <= annotation.y;
                break;
            }
            case 'member': {
                const mSize = annotation.size || 20;
                if (!ctx) break;
                ctx.font = `bold ${mSize}px Oswald`;
                const mPadX = mSize * 0.8;
                const mPadY = mSize * 0.4;
                const mW = ctx.measureText(annotation.text).width + mPadX * 2;
                const mH = mSize + mPadY * 2;
                isInside = testX >= annotation.x - mW / 2 && testX <= annotation.x + mW / 2 && testY >= annotation.y - mH / 2 && testY <= annotation.y + mH / 2;
                break;
            }
            case 'arrow': {
                const dx = annotation.endX - annotation.startX;
                const dy = annotation.endY - annotation.startY;
                const lenSq = dx * dx + dy * dy;
                if (lenSq === 0) break;
                const t = ((testX - annotation.startX) * dx + (testY - annotation.startY) * dy) / lenSq;
                const projX = annotation.startX + t * dx;
                const projY = annotation.startY + t * dy;
                if (t >= 0 && t <= 1) {
                    // Vérification de la distance au carré de la position du clic à la ligne projetée
                    const distSq = Math.pow(testX - projX, 2) + Math.pow(testY - projY, 2);
                    // outils.js:105,110 — `thickness` est optionnel dans
                    // `OiShapeAnnotation` ; `?? NaN` reproduit exactement la
                    // coercion `undefined + tolerance → NaN` de l'original
                    // (comparaisons `<=`/`||` avec NaN toujours fausses, même
                    // résultat observable).
                    isInside = distSq <= Math.pow((annotation.thickness ?? NaN) + tolerance, 2);
                } else {
                    // Vérification si l'on est proche des extrémités (pour les flèches courtes)
                    const distStartSq = Math.pow(testX - annotation.startX, 2) + Math.pow(testY - annotation.startY, 2);
                    const distEndSq = Math.pow(testX - annotation.endX, 2) + Math.pow(testY - annotation.endY, 2);
                    const maxDistSq = Math.pow((annotation.thickness ?? NaN) + tolerance, 2);
                    isInside = distStartSq <= maxDistSq || distEndSq <= maxDistSq;
                }
                break;
            }
        }

        if (isInside) return annotation;
    }
    return null;
}

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

// outils.js:136-188
export async function compressImage(imageBlob: Blob, quality: number, maxDimension: number = 1920): Promise<ArrayBuffer> {
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
            reject(new Error("Échec du chargement du Blob de l'image dans l'élément Image."));
        };
    });
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
