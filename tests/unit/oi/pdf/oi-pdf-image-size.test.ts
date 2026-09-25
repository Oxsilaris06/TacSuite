/**
 * oi-pdf-image-size.test.ts — Dimensions lues dans l'en-tête des images
 * (galerie adaptative, décision 44) : la mise en page doit connaître la forme
 * de chaque photo sans la décoder.
 */
import { describe, expect, it } from 'vitest';

import { imageSizeFromDataUrl } from '@oi/pdf/image-size.js';

function dataUrl(mime: string, bytes: number[]): string {
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/** PNG minimal : signature + bloc IHDR. */
function pngHeader(width: number, height: number): number[] {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 2, 0, 0, 0, 0, 0, 0, 0];
}

/** JPEG minimal : SOI, un segment APP0 (JFIF), un DQT factice, puis SOF0. */
function jpegHeader(width: number, height: number, sofMarker = 0xc0): number[] {
    const app0 = [0xff, 0xe0, ...u16(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const dqt = [0xff, 0xdb, ...u16(5), 0, 1, 2];
    const sof = [0xff, sofMarker, ...u16(17), 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return [0xff, 0xd8, ...app0, ...dqt, ...sof, 0xff, 0xd9];
}

describe('imageSizeFromDataUrl', () => {
    it('PNG : largeur et hauteur du bloc IHDR', () => {
        expect(imageSizeFromDataUrl(dataUrl('image/png', pngHeader(2560, 1920)))).toEqual({ widthPx: 2560, heightPx: 1920 });
    });

    it('JPEG : dimensions du segment SOF, après les segments APPn et DQT', () => {
        expect(imageSizeFromDataUrl(dataUrl('image/jpeg', jpegHeader(1080, 2340)))).toEqual({ widthPx: 1080, heightPx: 2340 });
    });

    it('JPEG progressif (SOF2) reconnu aussi', () => {
        expect(imageSizeFromDataUrl(dataUrl('image/jpeg', jpegHeader(800, 600, 0xc2)))).toEqual({ widthPx: 800, heightPx: 600 });
    });

    it('le segment DHT (0xC4) n’est pas pris pour un SOF', () => {
        const bytes = jpegHeader(640, 480);
        // DHT factice inséré juste après SOI.
        bytes.splice(2, 0, 0xff, 0xc4, ...u16(4), 0, 0);
        expect(imageSizeFromDataUrl(dataUrl('image/jpeg', bytes))).toEqual({ widthPx: 640, heightPx: 480 });
    });

    it('illisible ou tronqué : null (la galerie retombe sur un 4:3 sans déformer)', () => {
        expect(imageSizeFromDataUrl('data:image/jpeg;base64,AAAA')).toBeNull();
        expect(imageSizeFromDataUrl('pas une data url')).toBeNull();
        expect(imageSizeFromDataUrl(dataUrl('image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
    });
});
