/**
 * photo-layout.ts — Galerie adaptative des PDF (OI et PC-Tac, décision 44).
 *
 * Fonction PURE, sans moteur PDF : elle rend, page par page, la place de
 * chaque image dans la zone utile (points, origine en HAUT à gauche). Chaque
 * moteur (pdfmake pour l'OI, pdf-lib pour PC-Tac) convertit ensuite vers son
 * propre repère.
 *
 * Règles (audit PDF du 2026-09-25) :
 *  - un plan ou une photo paysage : seul sur sa page ;
 *  - portraits : 2 par page, côte à côte ;
 *  - captures d'écran de téléphone : 4 par page sur une page paysage, 3 sur
 *    une page portrait ;
 *  - panoramas : empilés tant qu'ils tiennent en hauteur ;
 *  - l'ordre de saisie est gardé : une page ne regroupe que des images
 *    CONSÉCUTIVES de même forme ;
 *  - jamais agrandie au-delà de `maxUpscalePpi` (150 par défaut) ; une image
 *    que ce plafond laisse à moins de la moitié de sa place est signalée
 *    `lowRes` (« basse définition » à l'impression) ;
 *  - le rapport largeur/hauteur est toujours conservé.
 */

export type PhotoShape = 'paysage' | 'portrait' | 'ecran' | 'panorama' | 'plan';

export interface GalleryPhoto {
    id: string;
    widthPx: number;
    heightPx: number;
    /** Capture de carte ou plan : toujours seul sur sa page. */
    isPlan?: boolean | undefined;
}

export interface GalleryBox {
    /** Largeur de la zone utile, en points. */
    width: number;
    /** Hauteur de la zone utile, en points. */
    height: number;
}

export interface GallerySlot {
    id: string;
    /** Coin haut gauche de l'image, en points, dans la zone utile. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Haut de la ligne de légende, juste sous l'image. */
    captionY: number;
    /** L'image est restée nettement plus petite que sa place (définition insuffisante). */
    lowRes: boolean;
}

export interface GalleryOptions {
    /** Espace entre deux images, en points. @default 12 */
    gap?: number;
    /** Hauteur réservée sous chaque image pour sa légende, en points. @default 14 */
    captionHeight?: number;
    /** Définition minimale à l'impression : l'image n'est jamais agrandie en deçà. @default 150 */
    maxUpscalePpi?: number;
}

const PANORAMA_MIN_RATIO = 2;
const PAYSAGE_MIN_RATIO = 1.15;
const PORTRAIT_MIN_RATIO = 0.62;
/** Une image dont le plafond de définition laisse moins de cette part de sa place est « basse définition ». */
const LOW_RES_FILL = 0.5;
const CAPTION_GAP = 2;

/** Rapport largeur/hauteur, 4:3 si les dimensions sont illisibles. */
function aspect(p: GalleryPhoto): number {
    const r = p.widthPx / p.heightPx;
    return Number.isFinite(r) && r > 0 ? r : 4 / 3;
}

export function photoShape(p: GalleryPhoto): PhotoShape {
    if (p.isPlan) return 'plan';
    const r = aspect(p);
    if (r > PANORAMA_MIN_RATIO) return 'panorama';
    if (r >= PAYSAGE_MIN_RATIO) return 'paysage';
    if (r >= PORTRAIT_MIN_RATIO) return 'portrait';
    return 'ecran';
}

/** Nombre d'images côte à côte sur une page, pour les formes placées en rangée. */
function perPage(shape: PhotoShape, box: GalleryBox): number {
    if (shape === 'portrait') return 2;
    if (shape === 'ecran') return box.width > box.height ? 4 : 3;
    return 1;
}

/** Largeur finale : la place disponible, plafonnée par la définition minimale. */
function sized(p: GalleryPhoto, fitWidth: number, ppi: number): { width: number; lowRes: boolean } {
    const maxWidth = Number.isFinite(p.widthPx) && p.widthPx > 0 ? (p.widthPx / ppi) * 72 : Number.POSITIVE_INFINITY;
    const width = Math.min(fitWidth, maxWidth);
    return { width, lowRes: width < LOW_RES_FILL * fitWidth };
}

export function layoutGallery(photos: readonly GalleryPhoto[], box: GalleryBox, options: GalleryOptions = {}): GallerySlot[][] {
    const gap = options.gap ?? 12;
    const caption = options.captionHeight ?? 14;
    const ppi = options.maxUpscalePpi ?? 150;
    const pages: GallerySlot[][] = [];
    let i = 0;

    while (i < photos.length) {
        const shape = photoShape(photos[i]!);

        if (shape === 'panorama') {
            // Empilement vertical, chaque bande sur toute la largeur utile.
            const page: GallerySlot[] = [];
            let y = 0;
            while (i < photos.length && photoShape(photos[i]!) === 'panorama') {
                const p = photos[i]!;
                const r = aspect(p);
                const { width, lowRes } = sized(p, Math.min(box.width, (box.height - caption) * r), ppi);
                const height = width / r;
                if (page.length > 0 && y + height + caption > box.height) break;
                page.push({ id: p.id, x: (box.width - width) / 2, y, width, height, captionY: y + height + CAPTION_GAP, lowRes });
                y += height + caption + gap;
                i++;
            }
            pages.push(page);
            continue;
        }

        // Rangée de 1 à 4 images de même forme ; la taille des cellules suit
        // la capacité de la page, pour que la dernière page (incomplète) garde
        // la même taille d'image que les autres.
        const n = perPage(shape, box);
        const group: GalleryPhoto[] = [];
        while (i < photos.length && group.length < n && photoShape(photos[i]!) === shape) {
            group.push(photos[i]!);
            i++;
        }
        const cellWidth = (box.width - (n - 1) * gap) / n;
        const cellHeight = box.height - caption;
        const rowWidth = group.length * cellWidth + (group.length - 1) * gap;
        const x0 = (box.width - rowWidth) / 2;
        pages.push(group.map((p, k) => {
            const r = aspect(p);
            const { width, lowRes } = sized(p, Math.min(cellWidth, cellHeight * r), ppi);
            const height = width / r;
            const cellX = x0 + k * (cellWidth + gap);
            return { id: p.id, x: cellX + (cellWidth - width) / 2, y: 0, width, height, captionY: height + CAPTION_GAP, lowRes };
        }));
    }
    return pages;
}
