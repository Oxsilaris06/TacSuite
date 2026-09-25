/**
 * image-size.ts — Dimensions d'une image JPEG ou PNG lues dans son en-tête,
 * sans la décoder (module pur : la galerie adaptative, décision 44, doit
 * connaître la forme de chaque photo au moment de composer le document).
 *
 * ponytail: l'orientation EXIF n'est pas lue — les photos passent toutes par
 * un canvas (orientation appliquée, EXIF retiré) ; au pire une forme est mal
 * classée, jamais déformée (la galerie pose les images en `fit`).
 */

export interface ImageSize {
    widthPx: number;
    heightPx: number;
}

/** Octets d'en-tête lus au plus (les segments APPn d'un JPEG précèdent le SOF). */
const HEADER_BASE64_CHARS = 128 * 1024;

export function imageSizeFromDataUrl(dataUrl: string): ImageSize | null {
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || comma < 0) return null;
    const b64 = dataUrl.slice(comma + 1, comma + 1 + HEADER_BASE64_CHARS);
    let bin: string;
    try {
        bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
    } catch {
        return null;
    }
    const byte = (i: number): number => bin.charCodeAt(i);
    const u16 = (i: number): number => (byte(i) << 8) | byte(i + 1);
    const u32 = (i: number): number => ((u16(i) << 16) >>> 0) + u16(i + 2);

    if (bin.length >= 24 && bin.startsWith('\x89PNG\r\n\x1a\n')) {
        const size = { widthPx: u32(16), heightPx: u32(20) };
        return size.widthPx > 0 && size.heightPx > 0 ? size : null;
    }
    if (byte(0) !== 0xff || byte(1) !== 0xd8) return null;
    let i = 2;
    while (i + 8 < bin.length) {
        if (byte(i) !== 0xff) return null;
        const marker = byte(i + 1);
        if (marker === 0xff) {
            i += 1; // octet de remplissage
            continue;
        }
        // SOF0..SOF15, sauf DHT (C4), JPG (C8) et DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            const size = { widthPx: u16(i + 7), heightPx: u16(i + 5) };
            return size.widthPx > 0 && size.heightPx > 0 ? size : null;
        }
        i += 2 + u16(i + 2);
    }
    return null;
}
