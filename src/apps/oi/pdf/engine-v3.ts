/**
 * engine-v3.ts — Orchestration du moteur PDF vectoriel « voie A » (pdfmake)
 * de l'OI : normalisation des photos, construction du blob PDF, téléchargement
 * automatique nommé (SPEC-PDF-V3.md §2.1 « contrat engine-v3.ts », §3.5
 * `normalizePhotos()`, §4 « devenir de l'ancien moteur » ; paquet
 * « pdf-p6-engine-v3 »).
 *
 * R4-a (D2, « une seule voie d'output PDF ») : `buildOiPdfBlob()` ci-dessous
 * est désormais la SOURCE UNIQUE DE VÉRITÉ pour les TROIS entrées — le
 * téléchargement (`downloadOiPdfV3`, ci-dessous), l'aperçu in-app
 * (`PDFEngineV2.openPreview()`, `<iframe>` sur le blob) et la présentation
 * plein écran (`PDFEngineV2.openPresentInPlace()`, nouvel onglet sur le
 * blob) — toutes les trois importent dynamiquement ce module. L'ancien
 * gabarit HTML dupliqué (`PDFEngineV2.generateHTML()`/`_fitPageToBudget()`/
 * `_buildPresentationDocument()`, ~740 LOC) a été retiré de
 * `pdf-engine-v2.ts`. `collectAllData()` (collecteur UNIQUE photos IndexedDB
 * + fusion des annotations + fond personnalisé) reste RÉUTILISÉ ici, jamais
 * dupliqué.
 */

import type { TDocumentDefinitions } from 'pdfmake/interfaces';

import { buildOiDocDefinition, oiPdfFileName } from './document-builder.js';
import { PDF_FONT_VFS, PDF_FONTS } from './fonts.js';
import type { OiPdfFormat } from './theme.js';
import type { OiPdfCollectedData } from '@shared/types/contracts.js';

/** Plus grand côté (px) toléré pour une photo intégrée telle quelle — SPEC §1.5/§3.5. */
const MAX_PHOTO_PX = 2000;

/**
 * Enregistrement des polices pdfmake — IDEMPOTENT, mémoïsé par ce booléen de
 * MODULE (une seule fois par session, SPEC §2.1 « ENREGISTREMENT DES
 * POLICES »). N'est remis à `false` que par un rechargement du module lui-même
 * (tests unitaires : `vi.resetModules()`).
 */
let fontsRegistered = false;

/**
 * Callback de progression de `normalizePhotos()`/`buildOiPdfBlob()` — appelé
 * après CHAQUE photo traitée (succès ou échec), jamais en amont (R4-c) :
 * `done` inclut les photos ignorées (repli `null`), `total` est figé au
 * nombre d'entrées de départ.
 */
export type PhotoNormalizeProgress = (done: number, total: number) => void;

/** Bornage de la concurrence des décodages/ré-encodages (R4-c) — 50 photos
 * simultanées en `Promise.all` illimité = pic mémoire inutile (N décodages +
 * N canvases vivants en même temps). 4 à 6 en vol, cf. audit. */
const PHOTO_CONCURRENCY = 5;

/**
 * Calcule les dimensions cible (ratio préservé, plus grand côté ramené à
 * `MAX_PHOTO_PX`) — logique de décision PARTAGÉE entre la voie moderne
 * (`createImageBitmap`/`OffscreenCanvas`) et la voie de repli (`<canvas>`),
 * SPEC §3.5.
 */
function computeTargetSize(width: number, height: number): { width: number; height: number } {
    const maxSide = Math.max(width, height);
    const scale = maxSide > MAX_PHOTO_PX ? MAX_PHOTO_PX / maxSide : 1;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/**
 * Une entrée JPEG/PNG déjà dans le gabarit ET sous `MAX_PHOTO_PX` traverse
 * SANS ré-encodage (pass-through inchangé, SPEC §3.5) — décision PARTAGÉE
 * entre les deux voies.
 */
function isPassthroughEligible(dataUrl: string, maxSide: number): boolean {
    const isDirectlySupported = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/png');
    return isDirectlySupported && maxSide <= MAX_PHOTO_PX;
}

/**
 * Détection de capacité (PAS d'UA sniffing, R4-c) — vrai sur tout navigateur
 * récent (Chromium/Firefox/Safari 17+), faux sur le vieux WebKit qui n'a ni
 * `createImageBitmap` avec options de redimensionnement ni `OffscreenCanvas`.
 */
function supportsModernPhotoPipeline(): boolean {
    return (
        typeof createImageBitmap === 'function' &&
        typeof OffscreenCanvas === 'function'
    );
}

// ---------------------------------------------------------------------------
// Voie de repli — ancien pipeline `<img>`/`<canvas>` SYNCHRONE sur le thread
// principal (SPEC §3.5), conservé pour les navigateurs sans
// `createImageBitmap`/`OffscreenCanvas` (vieux WebKit).
// ---------------------------------------------------------------------------

/**
 * Décode une image en mémoire (jamais insérée dans le DOM) et renvoie
 * l'élément décodé — seule façon fiable de connaître ses dimensions réelles
 * avant de décider si elle doit être ré-encodée (SPEC §3.5).
 */
async function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return img;
}

/**
 * Ré-encode une image en JPEG via `<canvas>`, ratio préservé, plus grand côté
 * ramené à `MAX_PHOTO_PX` — SPEC §3.5.
 */
function reencodeViaCanvas(img: HTMLImageElement): string {
    const { width: targetW, height: targetH } = computeTargetSize(img.naturalWidth, img.naturalHeight);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Contexte canvas 2D indisponible.');
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', 0.85);
}

/** Voie de repli complète pour UNE photo — mêmes règles de décision que la
 * voie moderne, décodage/ré-encodage SYNCHRONES sur le thread principal. */
async function normalizeOnePhotoLegacy(id: string, dataUrl: string): Promise<string | null> {
    try {
        const img = await decodeImage(dataUrl);
        const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
        if (isPassthroughEligible(dataUrl, maxSide)) {
            return dataUrl;
        }
        return reencodeViaCanvas(img);
    } catch (e) {
        console.warn(`[PDF v3] photo ${id} ignorée (format non supporté ou illisible)`, e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Voie moderne (R4-c) — décodage ET ré-encodage HORS thread principal autant
// que l'API le permet : `createImageBitmap` (décodage/redimensionnement
// natif) + `OffscreenCanvas.convertToBlob` (encodage JPEG). Élimine le gel
// UI perceptible à 50 photos pendant « Préparation des images… ».
// ---------------------------------------------------------------------------

/** Convertit un `Blob` en data URL — seule sortie acceptée en aval
 * (`document-builder.ts` référence les photos par data URL, SPEC §3.4). */
async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (): void => resolve(reader.result as string);
        reader.onerror = (): void => reject(reader.error ?? new Error('FileReader a échoué.'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Ré-encode un `ImageBitmap` déjà décodé/redimensionné (via les options de
 * `createImageBitmap`) en JPEG via `OffscreenCanvas.convertToBlob` — même
 * qualité (0.85) que la voie de repli.
 */
async function reencodeViaOffscreenCanvas(bitmap: ImageBitmap): Promise<string> {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Contexte OffscreenCanvas 2D indisponible.');
    }
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return blobToDataUrl(blob);
}

/** Voie moderne complète pour UNE photo — mêmes règles de décision que la
 * voie de repli, décodage/redimensionnement/encodage délégués au navigateur
 * (hors thread principal autant que l'API le permet). */
async function normalizeOnePhotoModern(id: string, dataUrl: string): Promise<string | null> {
    let probeBitmap: ImageBitmap | null = null;
    try {
        const sourceBlob = await (await fetch(dataUrl)).blob();

        // 1er décodage — sonde les dimensions réelles (nécessaire pour décider
        // pass-through vs ré-encodage, SPEC §3.5) ; décodage natif, hors thread
        // principal côté navigateur.
        probeBitmap = await createImageBitmap(sourceBlob);
        const maxSide = Math.max(probeBitmap.width, probeBitmap.height);
        if (isPassthroughEligible(dataUrl, maxSide)) {
            return dataUrl;
        }

        const { width: targetW, height: targetH } = computeTargetSize(probeBitmap.width, probeBitmap.height);
        probeBitmap.close();
        probeBitmap = null;

        // 2e décodage AVEC redimensionnement natif (`resizeWidth`/`resizeHeight`/
        // `resizeQuality:'high'`) — le navigateur effectue le redimensionnement
        // pendant le décodage, hors thread principal, plutôt qu'un
        // `drawImage` manuel sur canvas plein format.
        const resizedBitmap = await createImageBitmap(sourceBlob, {
            resizeWidth: targetW,
            resizeHeight: targetH,
            resizeQuality: 'high',
        });
        try {
            return await reencodeViaOffscreenCanvas(resizedBitmap);
        } finally {
            resizedBitmap.close();
        }
    } catch (e) {
        console.warn(`[PDF v3] photo ${id} ignorée (format non supporté ou illisible)`, e);
        return null;
    } finally {
        probeBitmap?.close();
    }
}

/**
 * Normalise UNE photo — SPEC §3.5 : JPEG/PNG déjà dans le gabarit ⇒ conservée
 * telle quelle ; sinon ré-encodage JPEG. Repli `null` (entrée OMISE par
 * l'appelant) en cas d'échec de décodage/ré-encodage. Choisit la voie moderne
 * (`createImageBitmap`/`OffscreenCanvas`, hors thread principal) si
 * disponible, sinon la voie de repli `<canvas>` (R4-c).
 */
async function normalizeOnePhoto(id: string, dataUrl: string): Promise<string | null> {
    if (supportsModernPhotoPipeline()) {
        return normalizeOnePhotoModern(id, dataUrl);
    }
    return normalizeOnePhotoLegacy(id, dataUrl);
}

/**
 * Exécute `worker` sur `items` avec AU PLUS `limit` exécutions concurrentes —
 * pool de tâches simple (file d'attente partagée entre `limit` « runners »),
 * préserve l'INDEX de sortie (résultats dans l'ordre d'entrée, quel que soit
 * l'ordre de complétion réel) — R4-c, remplace le `Promise.all` illimité.
 */
async function runWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function runner(): Promise<void> {
        for (;;) {
            const i = nextIndex++;
            if (i >= items.length) return;
            results[i] = await worker(items[i] as T, i);
        }
    }

    const runnerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: runnerCount }, () => runner()));
    return results;
}

/**
 * Normalise l'ensemble des photos collectées AVANT construction du document —
 * garde OBLIGATOIRE (SPEC §1.5) : pdfkit (moteur sous-jacent de pdfmake)
 * n'accepte que JPEG/PNG ; une image WebP/AVIF non normalisée ferait échouer
 * TOUT le document. Concurrence BORNÉE (`PHOTO_CONCURRENCY`, R4-c) — remplace
 * l'ancien `Promise.all` illimité (pic mémoire à N décodages/canvases vivants
 * simultanément). `onProgress`, si fourni, est appelé après CHAQUE photo
 * traitée (i/N, succès ou échec).
 */
export async function normalizePhotos(
    photosBase64: Record<string, string>,
    onProgress?: PhotoNormalizeProgress,
): Promise<Record<string, string>> {
    const entries = Object.entries(photosBase64);
    const total = entries.length;
    let done = 0;

    const normalized = await runWithConcurrency(
        entries,
        PHOTO_CONCURRENCY,
        async ([id, dataUrl]): Promise<readonly [string, string] | null> => {
            const result = await normalizeOnePhoto(id, dataUrl);
            done += 1;
            onProgress?.(done, total);
            return result !== null ? ([id, result] as const) : null;
        },
    );

    const out: Record<string, string> = {};
    for (const entry of normalized) {
        if (entry !== null) {
            out[entry[0]] = entry[1];
        }
    }
    return out;
}

/**
 * Construit le blob PDF complet : photos normalisées → définition du document
 * (`document-builder.ts`, pur) → rendu pdfmake. COUTURE DE TEST PRINCIPALE
 * (SPEC §2.1).
 *
 * PIÈGE VÉRIFIÉ (SPEC-PDF-V3.md §1.3) : `import * as pdfMake from 'pdfmake'`
 * COMPILE mais PLANTE À L'EXÉCUTION (`TypeError: Cannot set property fonts of
 * #<en> which has only a getter` — l'espace de noms ESM est figé, `addFonts()`
 * fait `this.fonts = …`). Les imports nommés sont proscrits aussi (le module
 * exporte une INSTANCE DE CLASSE ; des méthodes détachées perdraient `this`).
 * SEULE forme correcte : import DYNAMIQUE + `.default` — isole en outre
 * pdfmake dans son propre chunk pour ne pas peser sur le démarrage de l'OI.
 */
export async function buildOiPdfBlob(
    data: OiPdfCollectedData,
    opts: { format: OiPdfFormat; onProgress?: PhotoNormalizeProgress },
): Promise<Blob> {
    const photosBase64 = await normalizePhotos(data.photosBase64, opts.onProgress);
    const docDefinition: TDocumentDefinitions = buildOiDocDefinition({ ...data, photosBase64 }, opts);

    const pdfMake = (await import('pdfmake')).default;
    if (!fontsRegistered) {
        pdfMake.addVirtualFileSystem(PDF_FONT_VFS);
        pdfMake.addFonts(PDF_FONTS);
        fontsRegistered = true;
    }

    return pdfMake.createPdf(docDefinition).getBlob();
}

/**
 * Téléchargement automatique nommé du PDF de l'OI — reprend LE MÊME
 * SQUELETTE que `PDFEngineV2.downloadOiPdf()` (`pdf-engine-v2.ts:281-467`),
 * messages utilisateur compris (SPEC §2.1/§4). Le collecteur (`collectAllData`,
 * photos IndexedDB + fusion des annotations + fond personnalisé) reste CELUI
 * DU MOTEUR V2 — non dupliqué ; `deps.collect` est la seule COUTURE DE TEST.
 */
export async function downloadOiPdfV3(deps?: {
    collect?: () => Promise<OiPdfCollectedData>;
}): Promise<void> {
    console.group('🚀 [PDF ENGINE V3] - Démarrage de la génération');
    const startTime = Date.now();

    const loader = document.getElementById('pdfLoadingModal');
    const statusText = document.getElementById('pdfLoadingStatus');
    const updateStatus = (msg: string): void => {
        if (statusText) statusText.textContent = msg;
    };

    // pdf_engine_v2.js:202 / pdf-engine-v2.ts:291-295 — cast HTMLDialogElement,
    // même précédent.
    const previewModal = document.getElementById('presentationModal') as HTMLDialogElement | null;
    if (previewModal && previewModal.open) {
        previewModal.close();
        document.body.classList.remove('modal-open');
    }

    if (loader) loader.style.display = 'flex';

    try {
        updateStatus('Collecte des données…');
        const collect =
            deps?.collect ??
            ((): Promise<OiPdfCollectedData> =>
                import('@oi/pdf-engine-v2.js').then((m) => m.PDFEngineV2.collectAllData()));
        const data = await collect();

        // Même test que pdf-engine-v2.ts:121/:321.
        const format: OiPdfFormat = window.pdfOutputFormat === '16:9' ? '16:9' : 'a4';

        updateStatus('Préparation des images…');
        const blob = await buildOiPdfBlob(data, {
            format,
            onProgress: (done, total) => {
                if (total > 0) updateStatus(`Préparation des images… (${done}/${total})`);
            },
        });
        updateStatus('Composition du document…');
        const fileName = oiPdfFileName(data.formData);

        updateStatus('Assemblage final…');

        // TÉLÉCHARGEMENT AUTOMATIQUE NOMMÉ — CONTRAT E2E
        // (tests/e2e/oi.spec.ts:960-968 attend un événement `download` avec un
        // nom `/^OI_.*\.pdf$/`).
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

        console.log(`✅ [SUCCESS] PDF V3 généré en ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        if (typeof window.toast === 'function') {
            window.toast('PDF généré avec succès !', 'success');
        }
    } catch (error) {
        console.error('❌ [CRITICAL V3] PDF Engine Failed:', error);
        // RÈGLE D'OR (SPEC-PDF-V3.md §2.1) : window.toast, message IDENTIQUE à
        // pdf-engine-v2.ts:460.
        if (typeof window.toast === 'function') {
            window.toast('Erreur de génération. Veuillez consulter les logs.', 'error');
        }
    } finally {
        if (loader) loader.style.display = 'none';
        console.groupEnd();
    }
}
