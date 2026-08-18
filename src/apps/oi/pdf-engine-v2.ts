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
 * DE VÉRITÉ).
 *
 * SPEC-2026-08-18-pdf-et-champs.md §1 — parc Gendarmerie verrouillé : une URL
 * `blob:` dans un `<iframe>` ne s'affiche pas et le lecteur PDF natif est
 * souvent désactivé par stratégie de groupe. `openPreview` ne crée donc plus
 * AUCUNE URL `blob:` ni `<iframe>` : le blob PDF est lu en `ArrayBuffer` et
 * rendu PAGE PAR PAGE par pdf.js (`pdfjs-dist`, embarqué — worker servi
 * localement par Vite via `?url`, JAMAIS un CDN, fonctionne hors ligne) dans
 * des `<canvas>` insérés dans `#presentation-content`. `openPresentInPlace`
 * garde son chemin nominal (nouvel onglet via `window.open` sur un Blob URL —
 * le visualiseur PDF natif du navigateur, quand il existe, y fournit zoom/
 * plein écran/impression) mais retombe désormais sur l'aperçu intégré
 * ci-dessus si `window.open` échoue ou est bloqué, au lieu d'un simple toast
 * d'erreur. `PDFEngineV2.options` (bloc de config html2canvas/jsPDF, mort
 * depuis le retrait du téléchargement rastérisé, PDF.INTEG) est retiré avec
 * son contrat (`contracts.ts`).
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
import { attachEditableTextLayer, collectEditCandidates } from '@oi/pdf-preview-edit.js';
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

interface OiPdfRenderProgress {
    /** Appelé après chaque page peinte (1-indexé) — alimente `#pdfLoadingStatus`. */
    onProgress: (page: number, total: number) => void;
    /** `true` si un `openPreview()` plus récent (ou la fermeture de la modale)
     * a supplanté ce rendu — le rendu doit s'arrêter au prochain point de
     * contrôle plutôt que continuer à peindre un conteneur périmé. */
    isCancelled: () => boolean;
}

/** Dépendances injectables (couture de test) pour `openPreview`/`openPresentInPlace`
 * — même précédent que `downloadOiPdfV3({ collect })` (`@oi/pdf/engine-v3.js`).
 * `renderPdf` isole pdf.js (worker, décodage, rendu `<canvas>` — difficile à
 * exercer sous jsdom, aucun mock requis dans la suite unitaire : elle injecte
 * un faux rendu, `defaultRenderPdf` — la vraie implémentation pdf.js — n'est
 * jamais exécutée en test). */
interface OiPdfBuildDeps {
    collect?: () => Promise<OiPdfCollectedData>;
    buildBlob?: (data: OiPdfCollectedData, opts: { format: OiPdfFormat }) => Promise<Blob>;
    renderPdf?: (blob: Blob, container: HTMLElement, progress: OiPdfRenderProgress) => Promise<void>;
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

/** Laisse respirer le fil principal entre deux pages — un document de
 * plusieurs dizaines de pages ne doit pas figer l'UI pendant son rendu. */
function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Rend CHAQUE page du blob PDF dans un `<canvas>`, progressivement, à
 * l'intérieur de `container` (déjà attaché au DOM — sa largeur mesurée pilote
 * l'échelle). pdf.js et son worker sont importés dynamiquement (mêmes raisons
 * que `defaultBuildBlob` : chunk dédié, jamais chargé tant que l'aperçu n'est
 * pas ouvert) ; le worker est résolu en URL LOCALE par Vite (`?url`) — jamais
 * un CDN, condition du fonctionnement hors ligne (parc Gendarmerie).
 *
 * Chaque page est un `.pdf-preview-page` en `position: relative`, aux
 * dimensions CSS EXACTES de la page (indépendantes du `devicePixelRatio` —
 * seule la résolution INTERNE du `<canvas>` en tient compte, pour un rendu
 * net), portant `data-page-number` et `data-scale` (facteur point-PDF →
 * pixel-CSS). Un `.pdf-preview-page-overlay` (`position: absolute; inset: 0;
 * pointer-events: none`) y est superposé ; `attachEditableTextLayer`
 * (`pdf-preview-edit.ts`, SPEC-2026-08-18-pdf-et-champs.md §2) y ajoute, par
 * page, une zone cliquable pour chaque fragment de texte pdf.js reliable
 * SANS AMBIGUÏTÉ à un champ du formulaire — chaque zone garde
 * `pointer-events: auto` sur elle-même, l'overlay reste transparent aux
 * clics partout ailleurs.
 */
async function defaultRenderPdf(blob: Blob, container: HTMLElement, progress: OiPdfRenderProgress): Promise<void> {
    const pdfjsLib = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

    const data = new Uint8Array(await blob.arrayBuffer());
    const loadingTask = pdfjsLib.getDocument({ data });
    const doc = await loadingTask.promise;
    try {
        const total = doc.numPages;
        // ponytail: largeur mesurée UNE fois avant le rendu — pas de
        // ResizeObserver pour reflow live si la fenêtre est redimensionnée en
        // cours de lecture ; upgrade si demandé, en repassant simplement par
        // un nouvel `openPreview()` (rouvre l'aperçu à la largeur courante).
        const availableWidth = container.clientWidth || 800;
        const dpr = window.devicePixelRatio || 1;
        // Scan UNE fois pour tout le document : les champs du formulaire ne
        // changent pas pendant qu'on peint les pages (cf. JSDoc `pdf-preview-edit.ts`).
        const editCandidates = collectEditCandidates();

        for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
            if (progress.isCancelled()) return;

            const page = await doc.getPage(pageNumber);
            const scale = availableWidth / page.getViewport({ scale: 1 }).width;
            const viewport = page.getViewport({ scale: scale * dpr });

            const pageEl = document.createElement('div');
            pageEl.className = 'pdf-preview-page';
            pageEl.dataset.pageNumber = String(pageNumber);
            pageEl.dataset.scale = String(scale);
            pageEl.style.width = `${viewport.width / dpr}px`;
            pageEl.style.height = `${viewport.height / dpr}px`;

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-preview-canvas';
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            const overlay = document.createElement('div');
            overlay.className = 'pdf-preview-page-overlay';

            pageEl.append(canvas, overlay);
            container.appendChild(pageEl);

            await page.render({ canvas, viewport }).promise;
            if (progress.isCancelled()) return;

            // Régénère l'aperçu complet après correction (§2 point 5 SPEC) — pas
            // de `deps` : ce chemin n'existe QUE dans la vraie implémentation
            // pdf.js (jamais en test, cf. JSDoc de fichier), toujours le flux réel.
            await attachEditableTextLayer(page, pageEl, overlay, viewport, dpr, editCandidates, () => runOpenPreview());

            progress.onProgress(pageNumber, total);
            if (pageNumber < total) await yieldToMain();
        }
    } finally {
        void loadingTask.destroy();
    }
}

// --- Annulation d'un rendu d'aperçu en vol -------------------------------
// Remplace l'ancienne révocation d'URL blob (obsolète : `openPreview` ne crée
// plus de Blob URL). Un nouvel `openPreview()` OU la fermeture de la modale
// incrémentent le compteur : toute boucle de rendu encore active le constate
// à son prochain point de contrôle (`isCancelled`) et s'arrête — évite de
// peindre un conteneur périmé ou de continuer un rendu que plus personne ne
// regarde.
let renderGeneration = 0;

function cancelPendingPreviewRender(): void {
    renderGeneration++;
}

/** Annule le rendu d'aperçu en cours à la fermeture de `#presentationModal`
 * (événement natif `close` d'un `<dialog>` : couvre `.close()` PROGRAMMATIQUE
 * (bouton « Fermer », `main.ts`), la touche Échap ET un clic sur le fond).
 * `addEventListener` avec la MÊME référence de fonction est idempotent par
 * spec DOM (un doublon exact `(type, listener)` sur la même cible est
 * ignoré) : nul besoin d'un drapeau « déjà posé » — sûr à rappeler à chaque
 * `openPreview()`, y compris si `#presentationModal` était remonté entre
 * deux appels. */
function ensurePreviewCloseCleanup(modal: HTMLDialogElement): void {
    modal.addEventListener('close', cancelPendingPreviewRender);
}

/**
 * Corps de `PDFEngineV2.openPreview` — extrait en fonction libre (plutôt que
 * `this.openPreview(...)`) pour que `openPresentInPlace` puisse s'y replier
 * SANS friction de typage : `this`, dans une méthode d'un littéral vérifié
 * par `satisfies PdfEngineV2Contract`, s'infère au contrat PUBLIC (0
 * argument) — un appel `this.openPreview(deps)` depuis une AUTRE méthode du
 * même littéral échouerait donc à la compilation.
 */
async function runOpenPreview(deps?: OiPdfBuildDeps): Promise<void> {
    const presentationContent = document.getElementById('presentation-content');
    if (!presentationContent) return;

    const modal = document.getElementById('presentationModal') as HTMLDialogElement | null;
    if (modal) ensurePreviewCloseCleanup(modal);

    // Toute génération PRÉCÉDENTE (rendu encore en cours) est supplantée :
    // elle le constate à son prochain point de contrôle et s'arrête.
    const generation = ++renderGeneration;
    const isCancelled = (): boolean => generation !== renderGeneration;

    const loader = document.getElementById('pdfLoadingModal');
    const statusText = document.getElementById('pdfLoadingStatus');
    const updateStatus = (msg: string): void => {
        if (statusText) statusText.textContent = msg;
    };

    presentationContent.innerHTML = '';
    if (loader) loader.style.display = 'flex';

    try {
        updateStatus('Collecte des données…');
        const collect = deps?.collect ?? ((): Promise<OiPdfCollectedData> => PDFEngineV2.collectAllData());
        const data = await collect();

        const format = currentPdfFormat();

        updateStatus('Préparation des images…');
        updateStatus('Composition du document…');
        const buildBlob = deps?.buildBlob ?? defaultBuildBlob;
        const blob = await buildBlob(data, { format });

        if (isCancelled()) return;

        const pagesContainer = document.createElement('div');
        pagesContainer.className = 'pdf-preview-pages';
        presentationContent.innerHTML = '';
        presentationContent.appendChild(pagesContainer);

        updateStatus('Rendu des pages…');
        const renderPdf = deps?.renderPdf ?? defaultRenderPdf;
        await renderPdf(blob, pagesContainer, {
            onProgress: (page, total) => updateStatus(`Rendu des pages… (${page}/${total})`),
            isCancelled,
        });
    } catch (error) {
        console.error('Preview Error:', error);
        if (!isCancelled()) {
            presentationContent.innerHTML =
                '<div class="pdf-preview-error">Erreur lors de la génération de l\'aperçu. ' +
                'Utilisez le bouton « Télécharger le PDF » ci-dessous.</div>';
        }
    } finally {
        if (!isCancelled() && loader) loader.style.display = 'none';
    }
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
     * vectoriel que le téléchargement (source unique de vérité, R4-a) et le
     * rend PAGE PAR PAGE dans des `<canvas>` via pdf.js embarqué
     * (`defaultRenderPdf`) — AUCUNE URL `blob:`, AUCUN `<iframe>`, aucune
     * dépendance au lecteur PDF du navigateur (SPEC §1 : parc Gendarmerie
     * verrouillé, `blob:` inexploitable en `<iframe>`, lecteur PDF natif
     * souvent désactivé). Rendu progressif avec avancement affiché dans
     * `#pdfLoadingStatus` ; un `openPreview()` plus récent OU la fermeture de
     * la modale annulent proprement un rendu encore en vol
     * (`cancelPendingPreviewRender`).
     */
    openPreview(deps?: OiPdfBuildDeps): Promise<void> {
        return runOpenPreview(deps);
    },

    /**
     * MODE PRÉSENTATION DÉDIÉ « Présenter ici ». Ouvre le MÊME blob PDF
     * vectoriel (R4-a) dans un NOUVEL ONGLET (`window.open` sur un Blob URL) :
     * quand le navigateur le permet, son visualiseur PDF natif fournit déjà
     * zoom, plein écran, navigation clavier/tactile et impression — inutile
     * de réassembler un « deck » HTML autonome. Sur le parc Gendarmerie
     * verrouillé visé par SPEC §1, `window.open` peut être bloqué (pop-up) ou
     * déboucher sur un onglet incapable d'afficher le blob : dans ce cas, on
     * retombe PROPREMENT sur l'aperçu intégré (`openPreview`, pdf.js/canvas)
     * en réutilisant les données/blob déjà construits, plutôt que de laisser
     * l'utilisateur avec un simple toast d'erreur.
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
                toast("La fenêtre de présentation a été bloquée par le navigateur (pop-up). Affichage dans l'aperçu intégré à la place.", { kind: 'error' });
                // Repli : même blob déjà construit, aucune recollecte/reconstruction.
                // `exactOptionalPropertyTypes` : `renderPdf` omise plutôt que
                // valant `undefined` si `deps` n'en fournit pas (couture de test).
                await runOpenPreview({
                    collect: () => Promise.resolve(data),
                    buildBlob: () => Promise.resolve(blob),
                    ...(deps?.renderPdf ? { renderPdf: deps.renderPdf } : {}),
                });
                const modal = document.getElementById('presentationModal') as HTMLDialogElement | null;
                if (modal && !modal.open) {
                    if (typeof modal.showModal === 'function') modal.showModal();
                    else modal.style.display = 'flex';
                }
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
