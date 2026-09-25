/**
 * pc-pdf-sortie.test.ts — Thème et sortie du rapport complet PC-Tac
 * (décision 42, audit PDF du 2026-09-25) : le thème vient de la fenêtre de
 * génération (plus du thème de l'écran), la sortie fixe la définition des
 * images (profils PDF_IMAGE_PROFILES), le budget « Partage » (10 Mo) agit
 * vraiment, et le poids est annoncé après la génération.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePdfBytes, pdfPageOperators } from './pdf-test-helpers.js';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
}));

vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        getMany: async (): Promise<Record<string, string | null>> => ({}),
        hydrate: async <T,>(items: T[]): Promise<T[]> => items,
    },
    GpxStore: { get: async (): Promise<null> => null },
}));

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    toastSpy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
    Reflect.deleteProperty(window, 'UI');
    Reflect.deleteProperty(window, 'PlanMap');
});

const WHITE_BG = /\n1 1 1 rg\n/;
const DARK_BG = /\n0\.1 0\.1 0\.1 rg\n/;

describe('thème du PDF choisi dans la fenêtre (décision 42)', () => {
    it('thème clair : pages blanches, même quand l’écran est en thème sombre', async () => {
        document.body.classList.add('dark-mode');
        const bytes = await generatePdfBytes({ kind: 'complet', theme: 'clair', sortie: 'impression' });
        expect(bytes).not.toBeNull();
        const ops = await pdfPageOperators(bytes!, 0);
        expect(ops).toMatch(WHITE_BG);
        expect(ops).not.toMatch(DARK_BG);
    });

    it('thème sombre : pages sombres, même quand l’écran est en thème clair', async () => {
        const bytes = await generatePdfBytes({ kind: 'complet', theme: 'sombre', sortie: 'impression' });
        expect(await pdfPageOperators(bytes!, 0)).toMatch(DARK_BG);
    });

    it('sans argument : derniers choix retenus de la fenêtre', async () => {
        const { savePdfOptions } = await import('@shared/pdf-options.js');
        savePdfOptions('pctac', { kind: 'complet', theme: 'sombre', sortie: 'partage' });
        const bytes = await generatePdfBytes();
        expect(await pdfPageOperators(bytes!, 0)).toMatch(DARK_BG);
    });
});

describe('définition des images selon la sortie (PDF_IMAGE_PROFILES)', () => {
    it('vise la définition du profil pour la taille imprimée, sans jamais agrandir', async () => {
        const { printPixelSize } = await import('@pctac/pdf-export.js');
        // 120 pt imprimés : 417 px à 250 ppi (Impression), 250 px à 150 ppi (Partage).
        expect(printPixelSize(1024, 768, 120, 'impression')).toEqual({ widthPx: 417, heightPx: 313 });
        expect(printPixelSize(1024, 768, 120, 'partage')).toEqual({ widthPx: 250, heightPx: 188 });
        // Image plus petite que la cible : taille native gardée.
        expect(printPixelSize(40, 30, 500, 'impression')).toEqual({ widthPx: 40, heightPx: 30 });
        // Facteur de réduction du budget « Partage ».
        expect(printPixelSize(1024, 768, 120, 'partage', 0.5)).toEqual({ widthPx: 125, heightPx: 94 });
    });

    it('la capture du plan est demandée à la définition du profil', async () => {
        const capture = vi.fn(async () => null);
        Reflect.set(window, 'PlanMap', { captureToDataUrl: capture, getPinsSummary: () => [] });
        const { targetPixels } = await import('@shared/pdf-options.js');
        await generatePdfBytes({ kind: 'complet', theme: 'clair', sortie: 'impression' });
        const impression = (capture.mock.calls[0] as unknown[] | undefined)?.[0] as { targetWidthPx?: number } | undefined;
        expect(impression?.targetWidthPx).toBeGreaterThanOrEqual(targetPixels(500, 'impression'));
        capture.mockClear();
        await generatePdfBytes({ kind: 'complet', theme: 'clair', sortie: 'partage' });
        const partage = (capture.mock.calls[0] as unknown[] | undefined)?.[0] as { targetWidthPx?: number } | undefined;
        expect(partage?.targetWidthPx).toBeLessThan(impression?.targetWidthPx ?? 0);
        expect(partage?.targetWidthPx).toBeGreaterThanOrEqual(targetPixels(500, 'partage'));
    });
});

describe('budget « Partage » : il agit vraiment', () => {
    it('refait le rendu avec des images réduites jusqu’à tenir sous le budget', async () => {
        const { renderWithinBudget } = await import('@pctac/pdf-export.js');
        const scales: number[] = [];
        const render = async (scale: number): Promise<Uint8Array> => {
            scales.push(scale);
            // 30 Mo à pleine définition, proportionnel au nombre de pixels.
            return new Uint8Array(Math.round(30_000_000 * scale * scale));
        };
        const out = await renderWithinBudget(render, 10_000_000);
        expect(out.overBudget).toBe(false);
        expect(out.bytes.length).toBeLessThanOrEqual(10_000_000);
        expect(scales.length).toBeGreaterThan(1);
        for (let i = 1; i < scales.length; i++) expect(scales[i]!).toBeLessThan(scales[i - 1]!);
    });

    it('sans plafond (Impression) : un seul rendu', async () => {
        const { renderWithinBudget } = await import('@pctac/pdf-export.js');
        const render = vi.fn(async () => new Uint8Array(50));
        const out = await renderWithinBudget(render, null);
        expect(render).toHaveBeenCalledTimes(1);
        expect(out.overBudget).toBe(false);
    });

    it('un PDF que la réduction des images ne suffit pas à alléger est signalé, pas bouclé sans fin', async () => {
        const { renderWithinBudget } = await import('@pctac/pdf-export.js');
        const render = vi.fn(async () => new Uint8Array(20));
        const out = await renderWithinBudget(render, 10);
        expect(out.overBudget).toBe(true);
        expect(render.mock.calls.length).toBeLessThanOrEqual(4);
    });
});

describe('poids annoncé après la génération', () => {
    it('un toast donne le poids du PDF', async () => {
        await generatePdfBytes({ kind: 'complet', theme: 'clair', sortie: 'impression' });
        const messages = toastSpy.mock.calls.map((c) => String(c[0]));
        expect(messages.some((m) => /PDF .*\d+(,\d)? (o|Ko|Mo)/.test(m))).toBe(true);
    });

    it('en « Partage », le toast rappelle le plafond de 10 Mo', async () => {
        await generatePdfBytes({ kind: 'complet', theme: 'clair', sortie: 'partage' });
        const messages = toastSpy.mock.calls.map((c) => String(c[0]));
        expect(messages.some((m) => m.includes('10 Mo'))).toBe(true);
    });
});
