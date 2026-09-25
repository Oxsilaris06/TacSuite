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
 * de la carte graphique (voir `planmap/capture.ts`).
 */

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
    /** Attente après la bascule de vue, en ms (tests : 0). @default 450 */
    settleMs?: number;
    /** Qualité JPEG de l'image rendue. @default 0.85 */
    jpegQuality?: number;
}

interface PlanMapForCapture {
    captureToDataUrl?: (options?: { targetWidthPx?: number }) => Promise<string | null>;
    map?: { resize?: () => void; getBearing?: () => number } | null;
}

/** Taille d'une image PNG ou JPEG lue dans ses en-têtes, sans décodage. */
export function imageSizeFromDataUrl(dataUrl: string): { widthPx: number; heightPx: number } | null {
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:image/') || comma < 0) return null;
    let bytes: Uint8Array;
    try {
        const bin = atob(dataUrl.slice(comma + 1));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
        return null;
    }
    const u32 = (o: number): number => ((bytes[o]! << 24) >>> 0) + (bytes[o + 1]! << 16) + (bytes[o + 2]! << 8) + bytes[o + 3]!;
    // PNG : signature puis IHDR (largeur à 16, hauteur à 20).
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
        const widthPx = u32(16), heightPx = u32(20);
        return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
    }
    // JPEG : on parcourt les segments jusqu'au premier SOFn.
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let o = 2;
        while (o + 9 < bytes.length) {
            if (bytes[o] !== 0xff) return null;
            const marker = bytes[o + 1]!;
            const len = (bytes[o + 2]! << 8) + bytes[o + 3]!;
            const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
            if (isSof) {
                const heightPx = (bytes[o + 5]! << 8) + bytes[o + 6]!;
                const widthPx = (bytes[o + 7]! << 8) + bytes[o + 8]!;
                return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
            }
            o += 2 + len;
        }
    }
    return null;
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
            await new Promise((r) => setTimeout(r, request.settleMs ?? 450));
        }
        dataUrl = await planMap.captureToDataUrl(request.targetWidthPx ? { targetWidthPx: request.targetWidthPx } : undefined);
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
