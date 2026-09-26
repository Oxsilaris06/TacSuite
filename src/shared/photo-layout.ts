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

/**
 * Une page à une ou deux images de place fixe (photos « Baptême terrain » de
 * l'OI, Nico 2026-09-26) : une image prend toute la zone ; deux se la
 * partagent à parts égales, côte à côte ou l'une sous l'autre, selon la
 * découpe qui leur donne le plus de surface. L'ensemble est centré dans la
 * hauteur, deux images côte à côte alignées sur leur milieu. Mêmes plafond de
 * définition et proportions que `layoutGallery`. Au-delà de deux images,
 * seules les deux premières sont placées (l'appelant fait une page par paire).
 */
export function layoutSplitPage(photos: readonly GalleryPhoto[], box: GalleryBox, options: GalleryOptions = {}): GallerySlot[] {
    const gap = options.gap ?? 12;
    const caption = options.captionHeight ?? 14;
    const ppi = options.maxUpscalePpi ?? 150;
    const shown = photos.slice(0, 2);
    const place = (cols: number): GallerySlot[] => {
        const rows = shown.length / cols;
        const cellWidth = (box.width - (cols - 1) * gap) / cols;
        const cellHeight = Math.max(0, (box.height - (rows - 1) * gap) / rows - caption);
        const sizes = shown.map((p) => {
            const r = aspect(p);
            const { width, lowRes } = sized(p, Math.min(cellWidth, cellHeight * r), ppi);
            return { width, height: width / r, lowRes };
        });
        // Hauteur de chaque rangée (image la plus haute + légende), puis
        // décalage qui centre le tout dans la zone.
        const rowHeights = Array.from({ length: rows }, (_, row) =>
            Math.max(...sizes.slice(row * cols, (row + 1) * cols).map((z) => z.height)) + caption);
        let top = (box.height - rowHeights.reduce((sum, h) => sum + h, 0) - (rows - 1) * gap) / 2;
        const rowTops = rowHeights.map((h) => { const t = top; top += h + gap; return t; });
        return shown.map((p, k) => {
            const { width, height, lowRes } = sizes[k]!;
            const row = Math.floor(k / cols);
            const x = (k % cols) * (cellWidth + gap) + (cellWidth - width) / 2;
            const y = rowTops[row]! + (rowHeights[row]! - caption - height) / 2;
            return { id: p.id, x, y, width, height, captionY: y + height + CAPTION_GAP, lowRes };
        });
    };
    const surface = (page: GallerySlot[]): number => page.reduce((sum, s) => sum + s.width * s.height, 0);
    const sideBySide = place(shown.length);
    const stacked = place(1);
    return surface(stacked) > surface(sideBySide) ? stacked : sideBySide;
}
