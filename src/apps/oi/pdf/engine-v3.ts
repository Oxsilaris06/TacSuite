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
import { OiPdfFitRefusalError, PDF_H2_BLOCK_PT, pageGeometry } from './theme.js';
import { PDF_FONT_VFS, PDF_FONTS } from './fonts.js';
import { currentOiPdfOptions } from './options.js';
import { acquirePdfLock, releasePdfLock } from './generation-lock.js';
import { toast } from '@shared/feedback.js';
import { PDF_IMAGE_PROFILES, formatBytes, type PdfSortie } from '@shared/pdf-options.js';
import type { OiPdfFormat } from './theme.js';
import type { OiPdfCollectedData } from '@shared/types/contracts.js';
import { confirmPhotoBilan, notePhotoIssue, resetPhotoBilan } from '@oi/photo-bilan.js';

/**
 * Passe de normalisation des photos (décision 42) : définition visée à la
 * taille imprimée maximale (`ppi`), qualité JPEG, et, pour les passes de
 * réduction de la sortie Partage, ré-encodage forcé (aucune image ne traverse
 * telle quelle).
 */
export interface PhotoPass {
    readonly ppi: number;
    readonly quality: number;
    readonly forceReencode: boolean;
}

/** Plancher de définition d'une passe de réduction (lisible à l'écran). */
const PHOTO_PPI_FLOOR = 72;
/** Plancher de qualité JPEG d'une passe de réduction. */
const PHOTO_QUALITY_FLOOR = 0.4;
const PHOTO_QUALITY_STEP = 0.15;
/** Passes au plus (la première comprise) : chaque passe redécode toutes les photos. */
const PHOTO_MAX_PASSES = 5;
/** Part du budget de la sortie laissée au reste du PDF (polices, texte, tracés). */
export const PDF_NON_PHOTO_RESERVE_BYTES = 1024 * 1024;

/** Première passe d'une sortie : son profil tel quel (`PDF_IMAGE_PROFILES`). */
export function firstPhotoPass(sortie: PdfSortie): PhotoPass {
    const profile = PDF_IMAGE_PROFILES[sortie];
    return { ppi: profile.maxPpi, quality: profile.jpegQuality, forceReencode: false };
}

/**
 * Passe suivante quand les photos dépassent `budgetBytes` (sortie Partage) :
 * le poids d'un JPEG suit à peu près son nombre de pixels, la définition
 * baisse donc de la racine du rapport (avec 10 % de marge) ; au plancher de
 * définition, c'est la qualité qui baisse. `null` : budget tenu, pas de
 * plafond, ou tout au plancher (meilleur effort, jamais un refus).
 */
export function nextPhotoPass(pass: PhotoPass, totalBytes: number, budgetBytes: number | null): PhotoPass | null {
    if (budgetBytes === null || totalBytes <= budgetBytes) return null;
    const ppi = Math.max(PHOTO_PPI_FLOOR, Math.floor(pass.ppi * Math.sqrt(budgetBytes / totalBytes) * 0.9));
    const quality = ppi < pass.ppi ? pass.quality : Math.max(PHOTO_QUALITY_FLOOR, Math.round((pass.quality - PHOTO_QUALITY_STEP) * 100) / 100);
    if (ppi === pass.ppi && quality === pass.quality) return null;
    return { ppi, quality, forceReencode: true };
}

/**
 * Dimensions utiles (px) d'une image de `widthPx × heightPx` imprimée au plus
 * grand dans `box` (points : zone utile de la page) à `ppi`. Jamais agrandie.
 */
export function photoTargetSize(widthPx: number, heightPx: number, box: { width: number; height: number }, ppi: number): { width: number; height: number } {
    const ratio = widthPx / heightPx;
    const printedWidthPt = Math.min(box.width, box.height * ratio);
    const maxWidth = Math.max(1, Math.ceil((printedWidthPt / 72) * ppi));
    if (widthPx <= maxWidth) return { width: widthPx, height: heightPx };
    return { width: maxWidth, height: Math.max(1, Math.round(maxWidth / ratio)) };
}

/** Taille approximative (octets) d'une data URL base64 — `atob().length`
 *  n'est pas dispo hors navigateur/de façon fiable sur de grandes chaînes ;
 *  l'approximation standard base64 (`4/3` d'expansion) suffit ici, la
 *  décision de palier n'a pas besoin d'une précision à l'octet près. */
function dataUrlSizeBytes(dataUrl: string): number {
    const commaIdx = dataUrl.indexOf(',');
    const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return Math.floor((b64.length * 3) / 4);
}

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
 * Identifiants dont les octets ne doivent JAMAIS traverser sans ré-encodage.
 *
 * Le fond PDF personnalisé est choisi comme un FICHIER, jamais saisi par un
 * champ photo : il n'a donc pas traversé le pipeline canvas qui retire les
 * métadonnées. Tant qu'il tenait sous la définition visée, il partait OCTET
 * POUR OCTET dans le PDF, EXIF et coordonnées GPS compris (audit du
 * 2026-09-25, F09 : les coordonnées ont été relues dans l'image extraite du
 * PDF). Il est désormais ré-encodé à l'entrée (`medias.ts`, `formulaires.ts`)
 * ET exempté ici : un fond déjà enregistré dans une base existante est ainsi
 * assaini au premier PDF suivant, sans migration de données.
 */
const PASSTHROUGH_EXEMPT_IDS = new Set(['custom_pdf_background']);

/** Côté de la vignette sur laquelle la transparence est cherchée. */
const ALPHA_PROBE_PX = 256;

/** Au moins un pixel non opaque (vignette de `ALPHA_PROBE_PX` au plus). Tout
 *  échec de lecture vaut « opaque » : l'image part alors en JPEG. */
function hasTransparency(source: CanvasImageSource, width: number, height: number): boolean {
    try {
        const scale = Math.min(1, ALPHA_PROBE_PX / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        const ctx = typeof OffscreenCanvas === 'function'
            ? new OffscreenCanvas(w, h).getContext('2d')
            : Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(source, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < data.length; i += 4) {
            if ((data[i] ?? 255) < 255) return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Décision de normalisation d'UNE image, partagée par les deux voies :
 *  - `target` : dimensions utiles à sa taille imprimée maximale ;
 *  - `png` : sortie PNG (seulement une image PNG réellement transparente —
 *    une photo annotée, opaque, ressort en JPEG, environ 3 fois plus légère) ;
 *  - `passthrough` : l'image traverse telle quelle (JPEG, ou PNG transparent,
 *    déjà à la bonne définition, hors passe de réduction et hors fond).
 */
interface PhotoPlan {
    target: { width: number; height: number };
    png: boolean;
    passthrough: boolean;
}

function planPhoto(
    id: string,
    dataUrl: string,
    size: { width: number; height: number },
    transparent: () => boolean,
    pass: PhotoPass,
    box: { width: number; height: number },
): PhotoPlan {
    const target = photoTargetSize(size.width, size.height, box, pass.ppi);
    const png = dataUrl.startsWith('data:image/png') && transparent();
    const fits = target.width === size.width;
    const encodedAsIs = dataUrl.startsWith('data:image/jpeg') || png;
    const passthrough = fits && encodedAsIs && !pass.forceReencode && !PASSTHROUGH_EXEMPT_IDS.has(id);
    return { target, png, passthrough };
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

/** Voie de repli complète pour UNE photo — mêmes règles de décision que la
 * voie moderne (`planPhoto`), décodage/ré-encodage SYNCHRONES sur le thread
 * principal. */
async function normalizeOnePhotoLegacy(id: string, dataUrl: string, pass: PhotoPass, box: { width: number; height: number }): Promise<string | null> {
    try {
        const img = await decodeImage(dataUrl);
        const size = { width: img.naturalWidth, height: img.naturalHeight };
        const plan = planPhoto(id, dataUrl, size, () => hasTransparency(img, size.width, size.height), pass, box);
        if (plan.passthrough) {
            return dataUrl;
        }
        const canvas = document.createElement('canvas');
        canvas.width = plan.target.width;
        canvas.height = plan.target.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Contexte canvas 2D indisponible.');
        }
        ctx.drawImage(img, 0, 0, plan.target.width, plan.target.height);
        return plan.png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', pass.quality);
    } catch (e) {
        console.warn(`[PDF v3] photo ${id} ignorée (format non supporté ou illisible)`, e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Voie moderne (R4-c) — décodage ET ré-encodage HORS thread principal autant
// que l'API le permet : `createImageBitmap` (décodage/redimensionnement
// natif) + `OffscreenCanvas.convertToBlob` (encodage). Élimine le gel UI
// perceptible à 50 photos pendant « Préparation des images… ».
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

/** Voie moderne complète pour UNE photo — mêmes règles de décision que la
 * voie de repli, décodage/redimensionnement/encodage délégués au navigateur
 * (hors thread principal autant que l'API le permet). */
async function normalizeOnePhotoModern(id: string, dataUrl: string, pass: PhotoPass, box: { width: number; height: number }): Promise<string | null> {
    let probe: ImageBitmap | null = null;
    let resized: ImageBitmap | null = null;
    try {
        const sourceBlob = await (await fetch(dataUrl)).blob();
        // 1er décodage : sonde des dimensions réelles (décision tel quel ou
        // ré-encodage) ; décodage natif, hors thread principal côté navigateur.
        probe = await createImageBitmap(sourceBlob);
        const bitmap = probe;
        const size = { width: bitmap.width, height: bitmap.height };
        const plan = planPhoto(id, dataUrl, size, () => hasTransparency(bitmap, size.width, size.height), pass, box);
        if (plan.passthrough) {
            return dataUrl;
        }
        // 2e décodage AVEC redimensionnement natif (`resizeQuality: 'high'`)
        // seulement s'il faut réduire : le navigateur redimensionne pendant le
        // décodage plutôt qu'un `drawImage` sur un canvas plein format.
        if (plan.target.width !== size.width) {
            resized = await createImageBitmap(sourceBlob, {
                resizeWidth: plan.target.width,
                resizeHeight: plan.target.height,
                resizeQuality: 'high',
            });
        }
        const drawn = resized ?? bitmap;
        const canvas = new OffscreenCanvas(drawn.width, drawn.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Contexte OffscreenCanvas 2D indisponible.');
        }
        ctx.drawImage(drawn, 0, 0);
        const blob = await canvas.convertToBlob(plan.png ? { type: 'image/png' } : { type: 'image/jpeg', quality: pass.quality });
        return await blobToDataUrl(blob);
    } catch (e) {
        console.warn(`[PDF v3] photo ${id} ignorée (format non supporté ou illisible)`, e);
        return null;
    } finally {
        probe?.close();
        resized?.close();
    }
}

/**
 * Normalise UNE photo — décision 42 : JPEG (ou PNG réellement transparent)
 * déjà à la définition visée ⇒ conservée telle quelle ; sinon ré-encodage à la
 * définition de la passe (JPEG, PNG si transparent). Repli `null` (entrée
 * OMISE par l'appelant) en cas d'échec de décodage/ré-encodage. Choisit la
 * voie moderne (`createImageBitmap`/`OffscreenCanvas`, hors thread principal)
 * si disponible, sinon la voie de repli `<canvas>` (R4-c).
 */
async function normalizeOnePhoto(id: string, dataUrl: string, pass: PhotoPass, box: { width: number; height: number }): Promise<string | null> {
    if (supportsModernPhotoPipeline()) {
        return normalizeOnePhotoModern(id, dataUrl, pass, box);
    }
    return normalizeOnePhotoLegacy(id, dataUrl, pass, box);
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

/** Une passe de normalisation de TOUTES les photos (première passe, puis
 *  passes de réduction de la sortie Partage, cf. `normalizePhotos`). */
async function normalizePhotosAtPass(
    entries: ReadonlyArray<[string, string]>,
    pass: PhotoPass,
    box: { width: number; height: number },
    onProgress: PhotoNormalizeProgress | undefined,
): Promise<Array<readonly [string, string] | null>> {
    const total = entries.length;
    let done = 0;
    return runWithConcurrency(entries, PHOTO_CONCURRENCY, async ([id, dataUrl]): Promise<readonly [string, string] | null> => {
        const result = await normalizeOnePhoto(id, dataUrl, pass, box);
        done += 1;
        onProgress?.(done, total);
        return result !== null ? ([id, result] as const) : null;
    });
}

export interface NormalizePhotosOptions {
    /** Sortie choisie dans la fenêtre de génération. @default 'impression' */
    sortie?: PdfSortie;
    /** Format de page : sa zone utile borne la taille imprimée. @default 'a4' */
    format?: OiPdfFormat;
}

/**
 * Normalise l'ensemble des photos collectées AVANT construction du document —
 * garde OBLIGATOIRE (SPEC §1.5) : pdfkit (moteur sous-jacent de pdfmake)
 * n'accepte que JPEG/PNG ; une image WebP/AVIF non normalisée ferait échouer
 * TOUT le document. Concurrence BORNÉE (`PHOTO_CONCURRENCY`, R4-c).
 * `onProgress`, si fourni, est appelé après CHAQUE photo traitée (i/N, succès
 * ou échec), à chaque passe.
 *
 * PROFILS DE SORTIE (décision 42, `PDF_IMAGE_PROFILES`) : chaque image vise la
 * définition du profil (250 ppi en Impression, 150 en Partage) à sa taille
 * imprimée MAXIMALE (une page photo sous son titre) ; plus définie, elle est
 * réduite.
 * La sortie Partage a un plafond (10 Mo) : tant que les photos dépassent ce
 * plafond, moins la part du reste du PDF, une passe de réduction
 * (`nextPhotoPass`) repart des ORIGINAUX (jamais de perte cumulée), au plus
 * `PHOTO_MAX_PASSES` passes. La décision est journalisée (`console.info`).
 */
export async function normalizePhotos(
    photosBase64: Record<string, string>,
    onProgress?: PhotoNormalizeProgress,
    options: NormalizePhotosOptions = {},
): Promise<Record<string, string>> {
    const entries = Object.entries(photosBase64);
    const sortie = options.sortie ?? 'impression';
    // Plus grande place d'une image dans l'OI : une page photo, sous son titre.
    const geo = pageGeometry(options.format ?? 'a4');
    const box = { width: geo.contentWidthPt, height: geo.contentHeightPt - PDF_H2_BLOCK_PT };
    const budgetBytes = PDF_IMAGE_PROFILES[sortie].budgetBytes;
    const photoBudget = budgetBytes === null ? null : Math.max(0, budgetBytes - PDF_NON_PHOTO_RESERVE_BYTES);

    let pass = firstPhotoPass(sortie);
    let normalized = await normalizePhotosAtPass(entries, pass, box, onProgress);
    for (let passes = 1; passes < PHOTO_MAX_PASSES; passes++) {
        const totalBytes = normalized.reduce((sum, entry) => sum + (entry ? dataUrlSizeBytes(entry[1]) : 0), 0);
        const next = nextPhotoPass(pass, totalBytes, photoBudget);
        if (!next) break;
        console.info(
            `[PDF v3] photos ${formatBytes(totalBytes)} > ${formatBytes(photoBudget ?? 0)} (sortie ${sortie}) — ` +
                `réduction à ${next.ppi} ppi, qualité ${next.quality}`,
        );
        pass = next;
        normalized = await normalizePhotosAtPass(entries, pass, box, onProgress);
    }
    console.info(`[PDF v3] photos normalisées (sortie ${sortie}, ${pass.ppi} ppi, qualité ${pass.quality})`);

    const out: Record<string, string> = {};
    for (const entry of normalized) {
        if (entry !== null) {
            out[entry[0]] = entry[1];
        }
    }
    // Point 11 : image illisible à la préparation, relevée pour le bilan avant téléchargement.
    for (const [id] of entries) if (!(id in out)) notePhotoIssue(id, 'illisible');
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
    opts: { format: OiPdfFormat; sortie?: PdfSortie; onProgress?: PhotoNormalizeProgress },
): Promise<Blob> {
    const photosBase64 = await normalizePhotos(data.photosBase64, opts.onProgress, {
        format: opts.format,
        sortie: opts.sortie ?? 'impression',
    });
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
    // Verrou pris AVANT toute attente : un double clic ne lance qu'une génération.
    const lockToken = acquirePdfLock('telechargement');
    if (lockToken === null) return;
    resetPhotoBilan();
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
        const { sortie } = currentOiPdfOptions();
        const blob = await buildOiPdfBlob(data, {
            format,
            sortie,
            onProgress: (done, total) => {
                if (total > 0) updateStatus(`Préparation des images… (${done}/${total})`);
            },
        });
        updateStatus('Composition du document…');
        const fileName = oiPdfFileName(data.formData);

        updateStatus('Assemblage final…');

        // Point 11 : bilan des photos non intégrées, montré AVANT le téléchargement.
        if (!(await confirmPhotoBilan(data.formData))) return;
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
        // Décision 42 : poids annoncé ; en Partage, dépassement du plafond dit.
        const budget = PDF_IMAGE_PROFILES[sortie].budgetBytes;
        const overBudget = budget !== null && blob.size > budget;
        toast(
            overBudget
                ? `PDF généré : ${formatBytes(blob.size)}, au-delà des ${formatBytes(budget)} visés pour le partage (trop de photos).`
                : `PDF généré : ${formatBytes(blob.size)}.`,
            { kind: 'success', ...(overBudget ? { duration: 8000 } : {}) },
        );
    } catch (error) {
        console.error('❌ [CRITICAL V3] PDF Engine Failed:', error);
        {
            // Mission P1 (directive Nico 2026-08-10) — REFUS DE GÉNÉRATION
            // explicite : `buildOiDocDefinition` lève `OiPdfFitRefusalError`
            // quand au moins un usage (fiche adversaire, bloc ZMSPCP/MOICP,
            // cellule effraction) ne tient pas sur sa page unique même au
            // palier plancher 7 px — message EXPLICITE listant les sections en
            // cause (jamais le message générique « Erreur de génération »,
            // qui masquerait la cause et n'orienterait pas l'utilisateur vers
            // la bonne action : réduire les ATCD/textes concernés).
            if (error instanceof OiPdfFitRefusalError) {
                toast(error.message, { kind: 'error' });
            } else {
                // Message IDENTIQUE à pdf-engine-v2.ts (U19 : toast unique).
                toast('Erreur de génération. Veuillez consulter les logs.', { kind: 'error' });
            }
        }
    } finally {
        if (loader) loader.style.display = 'none';
        console.groupEnd();
        releasePdfLock(lockToken);
    }
}
