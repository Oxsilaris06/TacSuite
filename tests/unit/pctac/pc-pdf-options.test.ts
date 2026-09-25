/**
 * pc-pdf-options.test.ts — Bouton PDF du dock de PC-Tac (décisions 41 et 42,
 * audit PDF du 2026-09-25) : il ouvre la fenêtre de génération (type de
 * rapport, thème, sortie), puis lance le rapport complet ou la synthèse A3.
 * « Annuler » ne produit rien.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const a3Spy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@pctac/pdf-a3.js', () => ({ buildA3Pdf: a3Spy }));

// IndexedDB est absent sous jsdom : `@pctac/image-store.js` est mocké
// (passthrough), comme dans pc-pdfexport.test.ts.
vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        getMany: async (): Promise<Record<string, string | null>> => ({}),
        hydrate: async <T,>(items: T[]): Promise<T[]> => items,
    },
    GpxStore: { get: async (): Promise<null> => null },
}));

beforeEach(() => {
    localStorage.clear();
    a3Spy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

function click(selector: string): void {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`introuvable : ${selector}`);
    el.click();
}

describe('bouton PDF du dock : fenêtre de génération (décision 42)', () => {
    it('propose le rapport complet (par défaut) et la synthèse A3, avec thème et sortie', async () => {
        const { openPdfDialog, PdfExport } = await import('@pctac/pdf-export.js');
        vi.spyOn(PdfExport, 'buildPdf').mockResolvedValue();
        const pending = openPdfDialog();
        const dialog = document.querySelector('dialog');
        expect(dialog?.textContent).toContain('Générer le PDF');
        expect(dialog?.textContent).toContain('Rapport complet');
        expect(dialog?.textContent).toContain('Synthèse A3');
        expect(document.querySelector<HTMLInputElement>('input[name="tac-pdf-kind"][value="complet"]')?.checked).toBe(true);
        expect(document.querySelector<HTMLInputElement>('input[name="tac-pdf-theme"][value="clair"]')?.checked).toBe(true);
        click('[data-tac-confirm="cancel"]');
        await pending;
    });

    it('« Rapport complet » lance buildPdf avec les choix de la fenêtre', async () => {
        const { openPdfDialog, PdfExport } = await import('@pctac/pdf-export.js');
        const build = vi.spyOn(PdfExport, 'buildPdf').mockResolvedValue();
        const pending = openPdfDialog();
        click('input[name="tac-pdf-theme"][value="sombre"]');
        click('input[name="tac-pdf-sortie"][value="partage"]');
        click('[data-tac-confirm="ok"]');
        await pending;
        expect(build).toHaveBeenCalledWith({ kind: 'complet', theme: 'sombre', sortie: 'partage' });
        expect(a3Spy).not.toHaveBeenCalled();
    });

    it('« Synthèse A3 » charge le module A3 et lui passe les choix', async () => {
        const { openPdfDialog, PdfExport } = await import('@pctac/pdf-export.js');
        const build = vi.spyOn(PdfExport, 'buildPdf').mockResolvedValue();
        const pending = openPdfDialog();
        click('input[name="tac-pdf-kind"][value="a3"]');
        click('[data-tac-confirm="ok"]');
        await pending;
        expect(a3Spy).toHaveBeenCalledWith({ kind: 'a3', theme: 'clair', sortie: 'impression' });
        expect(build).not.toHaveBeenCalled();
    });

    it('« Annuler » ne produit rien', async () => {
        const { openPdfDialog, PdfExport } = await import('@pctac/pdf-export.js');
        const build = vi.spyOn(PdfExport, 'buildPdf').mockResolvedValue();
        const pending = openPdfDialog();
        click('[data-tac-confirm="cancel"]');
        await pending;
        expect(build).not.toHaveBeenCalled();
        expect(a3Spy).not.toHaveBeenCalled();
    });

    it('le bouton du dock passe par la fenêtre, plus par buildPdf direct', async () => {
        const { readFileSync } = await import('node:fs');
        const main = readFileSync('src/apps/pctac/main.ts', 'utf8');
        expect(main).toMatch(/previewPdfBtn\.onclick = \(\) => \{ void openPdfDialog\(\); \}/);
    });
});
