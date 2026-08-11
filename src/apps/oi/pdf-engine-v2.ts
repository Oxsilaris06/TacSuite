/**
 * pdf-engine-v2.ts — Collecte des données PDF + aperçu/présentation du
 * Générateur d'OI. Port from: modules/pdf_engine_v2.js (1156 LOC, intégral).
 * Fonctions principales : PDFEngineV2.openPreview, PDFEngineV2.openPresentInPlace,
 * PDFEngineV2.collectAllData (le téléchargement PDF est `downloadOiPdfV3()`,
 * `@oi/pdf/engine-v3.js` — SPEC-PDF-V3.md §4).
 *
 * R4-a (D2, « une seule voie d'output PDF ») : `generateHTML`/`_fitPageToBudget`/
 * `_buildPresentationDocument` (ex-:107/:369/:419-1115, ~740 LOC — la « voie C »,
 * 3ᵉ copie indépendante des 14 sections en HTML/CSS gabarité) sont RETIRÉES.
 * `openPreview()` et `openPresentInPlace()` construisent désormais le MÊME blob
 * PDF vectoriel que le téléchargement (`buildOiPdfBlob()`, `@oi/pdf/engine-v3.js`,
 * lui-même adossé à `buildOiDocDefinition()`/`document-builder.ts`, SOURCE UNIQUE
 * DE VÉRITÉ) : `openPreview` l'affiche dans un `<iframe>` embarqué dans
 * `#presentation-content` (Blob URL, révoquée à la fermeture de
 * `#presentationModal`) ; `openPresentInPlace` l'ouvre dans un nouvel onglet
 * (le visualiseur PDF natif du navigateur fournit déjà zoom/plein écran/
 * impression — plus besoin du « deck » HTML custom qu'assemblait
 * `_buildPresentationDocument`). `PDFEngineV2.options` (bloc de config
 * html2canvas/jsPDF, mort depuis le retrait du téléchargement rastérisé,
 * PDF.INTEG) est retiré avec son contrat (`contracts.ts`).
 *
 * `collectAllData()` (collecteur UNIQUE photos IndexedDB + fusion des
 * annotations + fond personnalisé) reste INCHANGÉ et continue de servir les
 * trois entrées (téléchargement, aperçu, présentation).
 */

import type {
    OiAnnotation,
    OiFormData,
    OiPdfCollectedData,
    PdfEngineV2Contract,
} from '@shared/types/contracts.js';
import { createAnnotatedImageBlob } from '@oi/dessin.js';
import { dbManager, Store } from '@oi/init.js';
import type { OiPdfFormat } from '@oi/pdf/theme.js';
import { toast } from '@shared/feedback.js';

// pdf_engine_v2.js:14-16 — Parse JSON tolérant : retourne le fallback si la
// donnée est corrompue. Générique ajouté pour le typage (aucun changement de
// comportement : JSON.parse renvoie `any` sous lib.es5, le contrat de cette
// fonction reste de renvoyer la forme attendue par l'appelant, exactement
// comme l'original non typé).
function safeJsonParse<T>(str: string, fallback: T): T {
    try {
        // JUSTIFICATION as : JSON.parse renvoie `any` (aucune validation de forme
        // dans l'original non plus) — assertion vers T, comportement identique.
        return JSON.parse(str) as T;
    } catch (e) {
        console.warn('[PDF] JSON corrompu ignoré:', e);
        return fallback;
    }
}

/** Dépendances injectables (couture de test) pour `openPreview`/`openPresentInPlace`
 * — même précédent que `downloadOiPdfV3({ collect })` (`@oi/pdf/engine-v3.js`). */
interface OiPdfBuildDeps {
    collect?: () => Promise<OiPdfCollectedData>;
    buildBlob?: (data: OiPdfCollectedData, opts: { format: OiPdfFormat }) => Promise<Blob>;
}

/** Import dynamique de `buildOiPdfBlob` — isole `pdfmake`/`document-builder.ts`
 * dans leur propre chunk (même raison que `downloadOiPdfV3` important
 * dynamiquement `pdf-engine-v2.js` pour `collectAllData`, chunk mutuel). */
async function defaultBuildBlob(data: OiPdfCollectedData, opts: { format: OiPdfFormat }): Promise<Blob> {
    const { buildOiPdfBlob } = await import('@oi/pdf/engine-v3.js');
    return buildOiPdfBlob(data, opts);
}

function currentPdfFormat(): OiPdfFormat {
    return window.pdfOutputFormat === '16:9' ? '16:9' : 'a4';
}

/**
 * Le navigateur sait-il afficher un PDF EMBARQUÉ (`<iframe src="blob:...">`) ?
 * `navigator.pdfViewerEnabled` est standard (Chrome/Edge/Firefox/Safari
 * desktop ≥ 16.4) ; SEUL `false` explicite signale une incapacité connue —
 * `undefined` (navigateur trop ancien pour exposer la propriété) reste dans
 * la branche « on tente », cas très majoritaire.
 */
function canRenderInlinePdf(): boolean {
    return navigator.pdfViewerEnabled !== false;
}

// --- Cycle de vie de l'URL blob de l'aperçu embarqué --------------------
let previewObjectUrl: string | null = null;

function revokePreviewObjectUrl(): void {
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
}

/** Révoque l'URL blob de l'aperçu à la fermeture de `#presentationModal`
 * (événement natif `close` d'un `<dialog>` : couvre `.close()` PROGRAMMATIQUE
 * (bouton « Fermer », `main.ts`), la touche Échap ET un clic sur le
 * fond — un seul point de revocation, pas un par site d'appel de `.close()`).
 * `addEventListener` avec la MÊME référence de fonction est idempotent par
 * spec DOM (un doublon exact `(type, listener)` sur la même cible est
 * ignoré) : nul besoin d'un drapeau « déjà posé » — sûr à rappeler à chaque
 * `openPreview()`, y compris si `#presentationModal` était remonté entre
 * deux appels. */
function ensurePreviewCloseCleanup(modal: HTMLDialogElement): void {
    modal.addEventListener('close', revokePreviewObjectUrl);
}

// Exporté (en plus de window.PDFEngineV2, RÈGLE D'OR §2.2 pour les AUTRES
// modules) : même précédent que init.ts (Store/dbManager), pour la
// testabilité de ce fichier lui-même. `satisfies` (pas `:`) — vérifie la
// conformité au contrat PUBLIC (`PdfEngineV2Contract`, sans `deps`) tout en
// conservant, sur l'export LOCAL, le type inféré plus précis avec le
// paramètre `deps` optionnel (couture de test de `openPreview`/
// `openPresentInPlace`, même précédent que `downloadOiPdfV3({ collect })`).
export const PDFEngineV2 = {
    /**
     * Lance l'aperçu dans `#presentationModal` : construit le MÊME blob PDF
     * vectoriel que le téléchargement (source unique de vérité, R4-a) et
     * l'affiche dans un `<iframe>` (`URL.createObjectURL`, révoquée à la
     * fermeture de la modale). Repli explicite AVANT toute construction si le
     * navigateur signale son incapacité à peindre un PDF embarqué
     * (`navigator.pdfViewerEnabled === false` — rare desktop, possible
     * mobile) : invite à utiliser le bouton « Télécharger le PDF » déjà
     * présent dans la modale. PAS de tentative d'iframe dans ce cas — un
     * navigateur incapable de rendre un PDF embarqué déclenche en coulisses
     * une tentative de TÉLÉCHARGEMENT fantôme pour la navigation de l'iframe
     * (constaté), risquant de perturber un téléchargement légitime déclenché
     * peu après (`#downloadPdfBtn`) ; mieux vaut ne rien tenter que ce
     * repli-là.
     */
    async openPreview(deps?: OiPdfBuildDeps): Promise<void> {
        const presentationContent = document.getElementById('presentation-content');
        if (!presentationContent) return;

        revokePreviewObjectUrl();

        const modal = document.getElementById('presentationModal') as HTMLDialogElement | null;
        if (modal) ensurePreviewCloseCleanup(modal);

        if (!canRenderInlinePdf()) {
            presentationContent.innerHTML =
                '<div class="pdf-preview-fallback">' +
                '<h3>Aperçu non disponible sur ce navigateur</h3>' +
                '<p>Ce navigateur ne sait pas afficher un PDF intégré ici. ' +
                'Utilisez le bouton « Télécharger le PDF » ci-dessous pour l\'obtenir directement.</p>' +
                '</div>';
            return;
        }

        const loader = document.getElementById('pdfLoadingModal');
        const statusText = document.getElementById('pdfLoadingStatus');
        const updateStatus = (msg: string): void => {
            if (statusText) statusText.textContent = msg;
        };

        presentationContent.innerHTML = '';
        if (loader) loader.style.display = 'flex';

        try {
            updateStatus('Collecte des données…');
            const collect = deps?.collect ?? ((): Promise<OiPdfCollectedData> => this.collectAllData());
            const data = await collect();

            const format = currentPdfFormat();

            updateStatus('Préparation des images…');
            updateStatus('Composition du document…');
            const buildBlob = deps?.buildBlob ?? defaultBuildBlob;
            const blob = await buildBlob(data, { format });

            const url = URL.createObjectURL(blob);
            previewObjectUrl = url;

            const iframe = document.createElement('iframe');
            iframe.src = url;
            iframe.title = "Aperçu du PDF de l'Ordre Initial";
            iframe.className = 'pdf-preview-frame';
            presentationContent.innerHTML = '';
            presentationContent.appendChild(iframe);
        } catch (error) {
            console.error('Preview Error:', error);
            presentationContent.innerHTML = '<div class="pdf-preview-error">Erreur lors de la génération de l\'aperçu.</div>';
        } finally {
            if (loader) loader.style.display = 'none';
        }
    },

    /**
     * MODE PRÉSENTATION DÉDIÉ « Présenter ici ». Ouvre le MÊME blob PDF
     * vectoriel (R4-a) dans un NOUVEL ONGLET : le visualiseur PDF natif du
     * navigateur fournit déjà zoom, plein écran, navigation clavier/tactile et
     * impression — inutile de réassembler un « deck » HTML autonome.
     */
    async openPresentInPlace(deps?: OiPdfBuildDeps): Promise<void> {
        const loader = document.getElementById('pdfLoadingModal');
        const statusText = document.getElementById('pdfLoadingStatus');
        const updateStatus = (msg: string): void => {
            if (statusText) statusText.textContent = msg;
        };

        if (loader) loader.style.display = 'flex';
        try {
            updateStatus('Collecte des données…');
            const collect = deps?.collect ?? ((): Promise<OiPdfCollectedData> => this.collectAllData());
            const data = await collect();

            const format = currentPdfFormat();

            updateStatus('Préparation des images…');
            updateStatus('Composition du document…');
            const buildBlob = deps?.buildBlob ?? defaultBuildBlob;
            const blob = await buildBlob(data, { format });

            const url = URL.createObjectURL(blob);
            const win = window.open(url, '_blank');
            if (!win) {
                URL.revokeObjectURL(url);
                toast("La fenêtre de présentation a été bloquée par le navigateur. Autorisez les pop-ups pour ce site, puis réessayez.", { kind: 'error' });
                return;
            }
            // On révoque l'URL après un délai large : l'onglet a eu le temps de charger.
            setTimeout(() => URL.revokeObjectURL(url), 120000);
        } catch (e) {
            console.error('[Présenter ici] échec:', e);
            // U19 — toast unique (@shared/feedback.js), plus de window.toast.
            toast("Erreur lors de l'ouverture de la présentation.", { kind: 'error' });
        } finally {
            if (loader) loader.style.display = 'none';
        }
    },

    async collectAllData(): Promise<OiPdfCollectedData> {
        console.log("📸 Début collecte exhaustive des données et fusion des annotations...");
        // JUSTIFICATION as : JSON.parse renvoie `any` (lib.es5) ; copie PROFONDE de
        // Store.state.formData, même forme que la source — aucune validation dans
        // l'original non plus.
        const formData = JSON.parse(JSON.stringify(Store.state.formData)) as OiFormData;
        const photosBase64: Record<string, string> = {};

        const dynamicPhotos = formData.dynamic_photos;
        if (dynamicPhotos) {
            const promises: Promise<void>[] = [];
            for (const category in dynamicPhotos) {
                // noUncheckedIndexedAccess : category provient d'un for...in sur ce
                // même objet, donc toujours défini — assertion de type, aucune garde
                // ajoutée (fidélité), même pattern que init.ts (checkIntegrity).
                const metas = dynamicPhotos[category] as (typeof dynamicPhotos)[string];
                metas.forEach(photoMeta => {
                    promises.push((async () => {
                        try {
                            const blob = await dbManager.getItem(photoMeta.id);
                            if (blob) {
                                let finalBlob: Blob = blob;
                                // Fusion des annotations si présentes
                                const annotations = safeJsonParse<OiAnnotation[]>(photoMeta.annotations || '[]', []);
                                // pdf_engine_v2.js:367 — createAnnotatedImageBlob est importée
                                // de @oi/dessin.js (non exposée sur window, SPEC §7) : la garde
                                // `typeof … === 'function'` est réécrite en test de forme sur le
                                // symbole importé, branchement conservé.
                                if (annotations.length > 0 && typeof createAnnotatedImageBlob === 'function') {
                                    console.log(`🎨 Fusion annotations pour ${photoMeta.id}...`);
                                    try {
                                        finalBlob = await createAnnotatedImageBlob(blob, annotations);
                                    } catch (err) {
                                        console.warn(`Échec fusion annotations pour ${photoMeta.id}, utilisation original.`, err);
                                    }
                                }
                                photosBase64[photoMeta.id] = await this.blobToBase64(finalBlob);
                                console.log(`✓ Photo préparée: ${photoMeta.id} (${category})`);
                            } else {
                                console.warn(`⚠ Photo non trouvée dans DB: ${photoMeta.id}`);
                            }
                        } catch (e) { console.error(`✗ Erreur préparation photo ${photoMeta.id}`, e); }
                    })());
                });
            }
            await Promise.all(promises);
        }

        // --- NOUVEAU: Collecte du fond personnalisé ---
        try {
            const customBg = await dbManager.getItem('custom_pdf_background');
            if (customBg) {
                photosBase64['custom_pdf_background'] = await this.blobToBase64(customBg);
                console.log("✓ Fond personnalisé chargé (DB).");
            }
        } catch (e) { console.warn("Erreur chargement fond personnalisé (PDF Engine):", e); }

        console.log(`📸 Fin collecte. ${Object.keys(photosBase64).length} photos prêtes pour le rendu.`);
        return {
            formData, photosBase64,
            isDark: formData.pdf_theme === 'dark' || (formData.pdf_theme !== 'light' && document.body.classList.contains('dark-mode'))
        };
    },

    blobToBase64(blob: Blob): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            // pdf_engine_v2.js:406 — readAsDataURL() ne produit que du texte (jamais un
            // ArrayBuffer) ; FileReader.result est typé largement par lib.dom
            // (string | ArrayBuffer | null) — assertion fidèle, aucune garde ajoutée
            // (identique à l'original qui ne vérifie rien non plus).
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },
} satisfies PdfEngineV2Contract;

window.PDFEngineV2 = PDFEngineV2;
window.openPresentInPlace = function () { void PDFEngineV2.openPresentInPlace(); };
