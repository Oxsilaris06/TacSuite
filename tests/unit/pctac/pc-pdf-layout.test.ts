/**
 * pc-pdf-layout.test.ts — Mise en page et intégrité du contenu du PDF PC-Tac
 * (audit du 2026-09-25 : constats M1, M2, M3, M4, M5, Mo5).
 *
 * Les helpers purs (wrapText) sont testés directement ; les correctifs qui se
 * voient seulement dans le document sont vérifiés sur un PDF réellement généré
 * par buildPdf(), relu avec pdf.js.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDF_FONT_VFS } from '@oi/pdf/fonts.js';

// IndexedDB est absent sous jsdom : `@pctac/image-store.js` est mocké
// (passthrough), comme dans pc-pdfexport.test.ts.
vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        put: async (): Promise<void> => {},
        get: async (): Promise<string | null> => null,
        getMany: async (): Promise<Record<string, string | null>> => ({}),
        delete: async (): Promise<void> => {},
        deleteMany: async (): Promise<void> => {},
        clear: async (): Promise<void> => {},
        migrateFromLocalStorage: async (): Promise<void> => {},
        hydrate: async <T,>(items: T[]): Promise<T[]> => items,
    },
}));

const bytes = (n: string): Uint8Array => Uint8Array.from(atob(PDF_FONT_VFS[n]!), (c) => c.charCodeAt(0));

let mono: PDFFont;

beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    mono = await doc.embedFont(bytes('JetBrainsMono-400.ttf'), { subset: true });
});

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => 'blob:mock-url');
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'UI');
    Reflect.deleteProperty(window, 'PlanMap');
});

/** Génère le PDF depuis localStorage et relit son texte page par page. */
async function buildAndReadPdf(): Promise<{ numPages: number; pages: string[] }> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const captured: { blob?: Blob } = {};
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((b: Blob) => {
        captured.blob = b;
        return 'blob:mock-url';
    });
    const { PdfExport } = await import('@pctac/pdf-export.js');
    await PdfExport.buildPdf();
    if (!captured.blob) throw new Error('buildPdf n’a produit aucun blob PDF');
    const data = new Uint8Array(await captured.blob.arrayBuffer());
    const task = pdfjs.getDocument({ data, useWorkerFetch: false, disableFontFace: true });
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return { numPages: pdf.numPages, pages };
}

const logEntry = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: 'e1', heure: '08:15', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: '', ...over,
});

describe('wrapText — coupe dure des mots trop longs (M2)', () => {
    it('scinde un jeton plus large que la colonne au lieu de le laisser déborder', async () => {
        const { wrapText } = await import('@pctac/pdf-export.js');
        const width = 145;
        const lines = wrapText('NOMTRESLONG'.repeat(40), width, mono, 9);
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
            expect(mono.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(width + 0.01);
        }
    });

    it('conserve le repli aux espaces pour un texte normal', async () => {
        const { wrapText } = await import('@pctac/pdf-export.js');
        expect(wrapText('un deux trois', 1000, mono, 9)).toEqual(['un deux trois']);
    });
});

describe('wrapText — retours à la ligne saisis (M4)', () => {
    it('respecte les sauts de ligne au lieu de les aplatir en espaces', async () => {
        const { wrapText } = await import('@pctac/pdf-export.js');
        const lines = wrapText('Ligne 1\nLigne 2\n\nParagraphe 3', 1000, mono, 9);
        expect(lines).toEqual(['Ligne 1', 'Ligne 2', 'Paragraphe 3']);
    });
});

describe('main courante — lieu replié, plus de « … » (M3)', () => {
    it('affiche le lieu entier au lieu de le tronquer', async () => {
        localStorage.setItem('pcTacLogData', JSON.stringify([
            logEntry({ lieu: 'Pavillon 12 rue des Acacias secteur nord derriere le stade municipal' }),
        ]));
        const { pages } = await buildAndReadPdf();
        const main = (pages[0] ?? '').replace(/\s+/g, ' ');
        expect(main).toContain('Pavillon 12 rue des Acacias secteur nord derriere le stade municipal');
        expect(main).not.toContain('Acaci…');
    });
});
