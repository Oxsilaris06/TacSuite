/**
 * pdf-test-helpers.ts — Génère le PDF PC-Tac sous jsdom (buildPdf réel) et
 * le relit : texte par page (pdf.js), opérateurs de dessin décompressés
 * (pdf-lib + zlib), métadonnées. Partagé par les tests du rapport complet.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { vi } from 'vitest';
import { PDFArray, PDFDocument, type PDFRawStream } from 'pdf-lib';
import type { PdfOptions } from '@shared/pdf-options.js';

/** Lance `buildPdf(options)` et rend les octets du PDF téléchargé (ou null). */
export async function generatePdfBytes(options?: PdfOptions): Promise<Uint8Array | null> {
    const captured: { blob?: Blob } = {};
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((b: Blob) => {
        captured.blob = b;
        return 'blob:mock-url';
    });
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    const { PdfExport } = await import('@pctac/pdf-export.js');
    await PdfExport.buildPdf(options);
    return captured.blob ? new Uint8Array(await captured.blob.arrayBuffer()) : null;
}

/** Texte de chaque page (espaces normalisés). */
export async function pdfPagesText(bytes: Uint8Array): Promise<string[]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, disableFontFace: true }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
    }
    return pages;
}

/** Morceaux de texte d'une page avec leur position (points, origine en bas à gauche). */
export async function pdfTextItems(bytes: Uint8Array, pageIndex: number): Promise<{ str: string; x: number; y: number; width: number }[]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, disableFontFace: true }).promise;
    const content = await (await pdf.getPage(pageIndex + 1)).getTextContent();
    return content.items.flatMap((item) => ('str' in item && item.str.trim()
        ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width }]
        : []));
}

/** Opérateurs de dessin décompressés d'une page (texte brut du flux de contenu). */
export async function pdfPageOperators(bytes: Uint8Array, pageIndex: number): Promise<string> {
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[pageIndex];
    if (!page) throw new Error(`page ${pageIndex} absente`);
    const contents = page.node.Contents();
    if (!contents) return '';
    const streams = contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref) as PDFRawStream)
        : [contents as PDFRawStream];
    return streams.map((s) => {
        const raw = Buffer.from(s.getContents());
        try { return inflateSync(raw).toString('latin1'); } catch { return raw.toString('latin1'); }
    }).join('\n');
}

/** Tailles de page (points) du PDF. */
export async function pdfPageSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
    const doc = await PDFDocument.load(bytes);
    return doc.getPages().map((p) => p.getSize());
}

/** PNG uni `w` × `h` (pixels), encodé à la main : IHDR lisible sans décodage. */
export function pngDataUrl(w: number, h: number): string {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf: Uint8Array): number => {
        let c = 0xffffffff;
        for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Uint8Array): Uint8Array => {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        out.set(Array.from(type, (c) => c.charCodeAt(0)), 4);
        out.set(data, 8);
        view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
        return out;
    };
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, w);
    v.setUint32(4, h);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RVB
    const rows = new Uint8Array(h * (1 + 3 * w));
    for (let y = 0; y < h; y++) {
        const o = y * (1 + 3 * w);
        for (let x = 0; x < w; x++) rows.set([40, 110, 190], o + 1 + 3 * x);
    }
    const idat = new Uint8Array(deflateSync(rows));
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const parts = [new Uint8Array(sig), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())];
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    return `data:image/png;base64,${Buffer.from(all).toString('base64')}`;
}
