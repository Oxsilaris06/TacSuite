/**
 * plan-capture-for-pdf.ts — Capture du plan tactique pour les PDF de PC-Tac
 * (rapport complet ET synthèse A3), extraite de `pdf-export.ts` (audit PDF du
 * 2026-09-25) pour que les deux documents partagent la même chaîne.
 *
 * La capture exige une vue Plan VISIBLE (canvas dimensionné) : lancée depuis
 * un autre onglet, elle bascule sur la vue Plan le temps de la capture, puis
 * rend la vue de départ (R25 : sans fermer la fiche ouverte). Tout échec rend
 * `null` : l'appelant le DIT dans le PDF, jamais d'absence silencieuse.
 *
 * `targetWidthPx` exprime la définition voulue pour l'impression (profils
 * `PDF_IMAGE_PROFILES`) ; la chaîne de capture la respecte dans les limites
 * de la carte graphique (voir `planmap/capture.ts`). `targetWidthPxFor` la
 * calcule d'après la forme de la carte, quand la page du PDF s'oriente comme
 * elle (portrait de téléphone : page portrait).
 *
 * Audit PDF 2026-09-25 (M7) : plus d'attente fixe de 450 ms ; la capture
 * attend elle-même la carte prête (style, sources, `idle`, borné), y compris
 * quand l'onglet Plan n'avait jamais été ouvert.
 */

import { imageSizeFromDataUrl } from '@shared/image-size.js';

// Taille lue dans les en-têtes, 128 Ko au plus (la version d'ici décodait tout
// le base64 de chaque photo). Réexportée pour pdf-export et pdf-a3.
export { imageSizeFromDataUrl };

export interface PlanPrintCapture {
    /** Image JPEG (ou PNG si la conversion échoue). */
    dataUrl: string;
    widthPx: number;
    heightPx: number;
    /** Orientation de la carte (degrés, 0 = nord en haut). */
    bearingDeg: number;
    /** Texte des attributions de la carte (© OpenStreetMap, IGN…), à imprimer sous l'image. */
    attribution: string;
    /** Texte de l'échelle graphique au moment de la capture (« 100 m »), ou null. */
    scaleText: string | null;
}

export interface PlanCaptureRequest {
    /** Largeur voulue en pixels pour l'impression (indicative). */
    targetWidthPx?: number;
    /**
     * Largeur voulue selon le rapport largeur/hauteur de la carte à l'écran ;
     * prime sur `targetWidthPx` quand la carte est mesurable.
     */
    targetWidthPxFor?: (aspect: number) => number;
    /** Mise en page de la vue après la bascule, en ms (tests : 0). @default 100 */
    settleMs?: number;
    /** Qualité JPEG de l'image rendue. @default 0.85 */
    jpegQuality?: number;
}

interface PlanMapForCapture {
    captureToDataUrl?: (options?: { targetWidthPx?: number }) => Promise<string | null>;
    map?: { resize?: () => void; getBearing?: () => number; getContainer?: () => HTMLElement } | null;
}

/**
 * Recompresse un dataURL image (PNG plein DPR de la capture ≈ plusieurs Mo)
 * en JPEG sur fond blanc : divise ~par 10 le poids embarqué dans le PDF.
 * En cas d'échec, l'appelant garde le dataURL d'origine.
 */
export async function dataUrlToJpeg(dataUrl: string, quality = 0.85): Promise<string> {
    // Contexte d'abord : sans canvas 2D, inutile de charger l'image.
    const c = document.createElement('canvas');
    const cx = c.getContext('2d');
    if (!cx) throw new Error('Canvas 2D context indisponible');
    const img = new Image();
    await new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error('image load timeout')), 10_000);
        img.onload = () => { clearTimeout(timer); res(); };
        img.onerror = () => { clearTimeout(timer); rej(new Error('image load failed')); };
        img.src = dataUrl;
    });
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', quality);
}

function mapText(selector: string): string {
    const root = document.getElementById('view-plan') ?? document;
    return root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export async function capturePlanForPdf(request: PlanCaptureRequest = {}): Promise<PlanPrintCapture | null> {
    const planMap = (window as unknown as { PlanMap?: PlanMapForCapture }).PlanMap;
    if (!planMap || typeof planMap.captureToDataUrl !== 'function') return null;

    const planView = document.getElementById('view-plan');
    const planHidden = !planView || !planView.classList.contains('active');
    const prevView = localStorage.getItem('lastView');
    const ui = (window as unknown as { UI?: { switchMainView?: (id: string, o?: { keepFiche?: boolean }) => void } }).UI;
    const canSwitch = !!ui && typeof ui.switchMainView === 'function';

    let dataUrl: string | null = null;
    let bearingDeg = 0;
    let attribution = '';
    let scaleText: string | null = null;
    try {
        if (planHidden && canSwitch) {
            ui.switchMainView!('view-plan', { keepFiche: true });
            try { planMap.map?.resize?.(); } catch { /* sans effet */ }
            await new Promise((r) => setTimeout(r, request.settleMs ?? 100));
        }
        let aspect = 0;
        try {
            const container = planMap.map?.getContainer?.();
            if (container && container.clientHeight > 0) aspect = container.clientWidth / container.clientHeight;
        } catch { aspect = 0; }
        const targetWidthPx = request.targetWidthPxFor && aspect > 0 ? request.targetWidthPxFor(aspect) : request.targetWidthPx;
        dataUrl = await planMap.captureToDataUrl(targetWidthPx ? { targetWidthPx } : undefined);
        try { bearingDeg = planMap.map?.getBearing?.() ?? 0; } catch { bearingDeg = 0; }
        attribution = mapText('.maplibregl-ctrl-attrib-inner');
        scaleText = mapText('.maplibregl-ctrl-scale') || null;
    } catch (err) {
        console.warn('PDF Plan capture échouée :', err);
        dataUrl = null;
    } finally {
        if (planHidden && canSwitch && prevView) ui.switchMainView!(prevView, { keepFiche: true });
    }

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
    // toDataURL peut renvoyer 'data:,' SANS exception (canvas trop grand ou
    // mémoire) : on ne remplace le PNG que par un JPEG valide.
    try {
        const jpeg = await dataUrlToJpeg(dataUrl, request.jpegQuality ?? 0.85);
        if (jpeg && jpeg.startsWith('data:image')) dataUrl = jpeg;
    } catch { /* on garde le PNG */ }
    const size = imageSizeFromDataUrl(dataUrl);
    if (!size) return null;
    return { dataUrl, ...size, bearingDeg, attribution, scaleText };
}
