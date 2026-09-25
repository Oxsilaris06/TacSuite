/**
 * pc-pdf-busy.test.ts — Génération du PDF PC-Tac : verrou contre le double
 * clic et progression affichée (audit PDF du 2026-09-25, jeu extrême : 35 s
 * sans retour visuel). Un second appel pendant une génération ne lance pas
 * un second PDF ; l'écran d'attente nomme l'étape en cours.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const OPTS = { kind: 'complet', theme: 'clair', sortie: 'impression' } as const;

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    toastSpy.mockClear();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock-url');
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@pctac/busy.js');
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'PlanMap');
});

describe('verrou contre le double clic', () => {
    it('un second appel pendant la génération ne produit pas un second PDF', async () => {
        const { PdfExport } = await import('@pctac/pdf-export.js');
        await Promise.all([PdfExport.buildPdf({ ...OPTS }), PdfExport.buildPdf({ ...OPTS })]);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(toastSpy.mock.calls.some((c) => /déjà en cours/.test(String(c[0])))).toBe(true);
    });

    it('le verrou est relâché à la fin : une nouvelle génération reste possible', async () => {
        const { PdfExport } = await import('@pctac/pdf-export.js');
        await PdfExport.buildPdf({ ...OPTS });
        await PdfExport.buildPdf({ ...OPTS });
        expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    });

    it('le verrou est relâché même quand la génération échoue', async () => {
        const { PdfExport } = await import('@pctac/pdf-export.js');
        localStorage.setItem('pcTacLogData', '{json cassé');
        Reflect.set(window, 'PlanMap', { captureToDataUrl: () => { throw new Error('boum'); }, getPinsSummary: () => [] });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await PdfExport.buildPdf({ ...OPTS });
        Reflect.deleteProperty(window, 'PlanMap');
        localStorage.clear();
        await PdfExport.buildPdf({ ...OPTS });
        expect(URL.createObjectURL).toHaveBeenCalled();
    });

    it('la fenêtre ne s’ouvre pas pendant une génération', async () => {
        const { PdfExport, openPdfDialog } = await import('@pctac/pdf-export.js');
        const running = PdfExport.buildPdf({ ...OPTS });
        await openPdfDialog();
        expect(document.querySelector('dialog')).toBeNull();
        await running;
    });
});

describe('progression affichée', () => {
    it('l’écran d’attente nomme les étapes (main courante, fiches, photos, plan)', async () => {
        const steps: string[] = [];
        vi.doMock('@pctac/busy.js', () => ({
            showBusy: (m: string) => { steps.push(m); },
            hideBusy: () => {},
            setBusyMessage: (m: string) => { steps.push(m); },
        }));
        localStorage.setItem('pcTacLogData', JSON.stringify([{ id: 'e1', heure: '08:15', pax: 'Inter', paxMode: 'standard', lieu: '', remarques: 'RAS' }]));
        localStorage.setItem('pcTacAdversaries', JSON.stringify([{ id: 'a1', nom: 'DURAND', prenom: 'Marc' }]));
        localStorage.setItem('pcTacPhotos', JSON.stringify([
            { id: 'p1', category: 'location', title: 'Vue', data: 'data:image/png;base64,AAAA' },
            { id: 'p2', category: 'location', title: 'Vue 2', data: 'data:image/png;base64,AAAA' },
        ]));
        Reflect.set(window, 'PlanMap', { captureToDataUrl: async () => null, getPinsSummary: () => [] });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { PdfExport } = await import('@pctac/pdf-export.js');
        await PdfExport.buildPdf({ ...OPTS });
        const all = steps.join(' | ');
        expect(all).toMatch(/main courante/i);
        expect(all).toMatch(/fiches/i);
        expect(all).toMatch(/photos? \(2\/2\)/i);
        expect(all).toMatch(/plan/i);
    });
});

describe('busy.ts — message d’étape', () => {
    it('setBusyMessage change le texte sans empiler l’écran d’attente', async () => {
        document.body.innerHTML = '<div id="pctacBusyOverlay" style="display:none"><canvas id="pctacBusyOrb"></canvas><div id="pctacBusyMessage"></div></div>';
        const { showBusy, hideBusy, setBusyMessage } = await import('@pctac/busy.js');
        showBusy('Génération du PDF…');
        setBusyMessage('Génération du PDF : photos (3/12)…');
        expect(document.getElementById('pctacBusyMessage')?.textContent).toBe('Génération du PDF : photos (3/12)…');
        hideBusy();
        expect(document.getElementById('pctacBusyOverlay')?.style.display).toBe('none');
    });
});
