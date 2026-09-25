/**
 * pc-pdf-a3.test.ts — synthèse PC-Tac sur une page A3 paysage (décision 41),
 * générée réellement (pdf-lib, polices Noto) puis relue avec pdf.js.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const OPTIONS = { kind: 'a3', theme: 'clair', sortie: 'impression' } as const;

let captured: { blob?: Blob; name?: string } = {};

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    captured = {};
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((b: Blob) => { captured.blob = b; return 'blob:mock'; });
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { captured.name = this.download; });
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'PlanMap');
});

function seed(over: { advNom?: string } = {}): void {
    localStorage.setItem('pcTacLogData', JSON.stringify([
        { id: 'l1', date: '2026-09-25', heure: '08:00', pax: 'Adversaire', paxMode: 'standard', lieu: 'Pavillon', remarques: 'Arrivée sur les lieux ordinaire' },
        { id: 'l2', date: '2026-09-25', heure: '08:30', pax: 'Otage', paxMode: 'standard', lieu: 'Cour', remarques: 'Contact établi avec le requérant', favori: true },
        { id: 'l3', date: '2026-09-25', heure: '09:00', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: 'ADV DURAND Marc : neutralisé', auto: true },
        { id: 'l4', date: '2026-09-25', heure: '09:10', pax: 'Carte', paxMode: 'free', lieu: '', remarques: '[PIN] Point posé', auto: true },
    ]));
    localStorage.setItem('pcTacAdversaries', JSON.stringify([
        { id: 'a1', nom: over.advNom ?? 'DURAND', prenom: 'Marc', status: 'neutralized', armes: 'Fusil de chasse calibre 12', position: 'Étage 1' },
    ]));
    localStorage.setItem('pcTacHostages', JSON.stringify([
        { id: 'h1', nom: 'BERNARD', prenom: 'Claire', status: 'blesse', etat: 'Conscient', lien: 'a1' },
    ]));
    localStorage.setItem('pcTacFriends', JSON.stringify([{ id: 'f1', nom: 'LEROY', prenom: 'Cdt', unite: 'PSIG 45', mission: 'Bouclage', tph: '' }]));
    Reflect.set(window, 'PlanMap', {
        getPinsSummary: () => [{ label: 'Portail nord', mgrs: '31U DQ 12345 67890', cell: 'B3', lat: 47.123456, lng: 1.654321, diameterM: 50 }],
    });
}

async function readPdf(): Promise<{ numPages: number; size: number[]; text: string }> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (!captured.blob) throw new Error('aucun PDF produit');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await captured.blob.arrayBuffer()), useWorkerFetch: false, disableFontFace: true }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ');
    return { numPages: pdf.numPages, size: page.view, text };
}

describe('buildA3Pdf', () => {
    it('une seule page A3 paysage, identifiée, avec fiches, faits marquants, points et amis', async () => {
        seed();
        const { buildA3Pdf } = await import('@pctac/pdf-a3.js');
        await expect(buildA3Pdf(OPTIONS)).resolves.toBe(true);
        const { numPages, size, text } = await readPdf();
        expect(numPages).toBe(1);
        expect(size[2]).toBeCloseTo(1190.55, 0);
        expect(size[3]).toBeCloseTo(841.89, 0);
        expect(text).toContain('SYNTHÈSE');
        expect(text).toContain('DIFFUSION RESTREINTE');
        expect(text).toContain('DURAND');
        expect(text).toContain('BERNARD');
        expect(text).toContain('Contact établi avec le requérant');
        expect(text).toContain('neutralisé');
        expect(text).not.toContain('Arrivée sur les lieux ordinaire');
        expect(text).not.toContain('Point posé');
        expect(text).toContain('Portail nord');
        expect(text).toContain('B3');
        expect(text).toContain('31U DQ 12345 67890');
        expect(text).not.toContain('47.123456');
        expect(text).toContain('LEROY');
        expect(captured.name).toMatch(/^PC-Tac_Synthese-A3_.*\.pdf$/);
        expect(captured.name).not.toMatch(/['’]/);
    });

    it('un caractère non imprimable est annoncé ; « Corriger la saisie » n’exporte rien', async () => {
        seed({ advNom: 'DURAND 王' });
        const { buildA3Pdf } = await import('@pctac/pdf-a3.js');
        const pending = buildA3Pdf(OPTIONS);
        await vi.waitFor(() => expect(document.querySelector('dialog')?.textContent ?? '').toContain('王'));
        document.querySelector<HTMLElement>('[data-tac-confirm="cancel"]')!.click();
        await expect(pending).resolves.toBe(false);
        expect(captured.blob).toBeUndefined();
    });

    it('« Générer quand même » imprime « ? » à la place du caractère', async () => {
        seed({ advNom: 'DURAND 王' });
        const { buildA3Pdf } = await import('@pctac/pdf-a3.js');
        const pending = buildA3Pdf(OPTIONS);
        await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
        document.querySelector<HTMLElement>('[data-tac-confirm="ok"]')!.click();
        await expect(pending).resolves.toBe(true);
        const { text } = await readPdf();
        expect(text).toContain('DURAND ?');
    });

    it('un nom arabe est imprimé sans « ? » (police de repli)', async () => {
        seed({ advNom: 'بن محمد' });
        const { buildA3Pdf } = await import('@pctac/pdf-a3.js');
        await expect(buildA3Pdf(OPTIONS)).resolves.toBe(true);
        expect(document.querySelector('dialog')).toBeNull();
        const { text } = await readPdf();
        expect(text).not.toMatch(/\?\s*\?/);
    });
});
