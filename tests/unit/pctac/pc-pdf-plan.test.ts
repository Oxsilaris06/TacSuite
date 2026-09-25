/**
 * pc-pdf-plan.test.ts — Plan tactique dans le rapport complet PC-Tac (audit
 * PDF du 2026-09-25, constat M8) : page orientée selon la capture (portrait
 * de téléphone : page portrait), définition demandée pour la largeur
 * réellement imprimée, attributions et orientation écrites sous l'image.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePdfBytes, pdfImageDraws, pdfPagesText, pdfPageSizes, pdfTextItems, pngDataUrl } from './pdf-test-helpers.js';

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
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'PlanMap');
});

function planMap(capture: string | null, container?: { width: number; height: number }): { captureToDataUrl: ReturnType<typeof vi.fn> } {
    const el = document.createElement('div');
    if (container) {
        Object.defineProperty(el, 'clientWidth', { value: container.width, configurable: true });
        Object.defineProperty(el, 'clientHeight', { value: container.height, configurable: true });
    }
    const pm = {
        captureToDataUrl: vi.fn(async () => capture),
        getPinsSummary: () => [],
        map: { getContainer: () => el, getBearing: () => 0 },
    };
    Reflect.set(window, 'PlanMap', pm);
    return pm;
}

async function planPageSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
    const pages = await pdfPagesText(bytes);
    const index = pages.findIndex((t) => t.includes('PLAN TACTIQUE') && !t.includes('LISTE DES POINTS'));
    expect(index).toBeGreaterThanOrEqual(0);
    return (await pdfPageSizes(bytes))[index]!;
}

describe('page du plan orientée selon la capture', () => {
    it('capture de téléphone (portrait) : page portrait', async () => {
        planMap(pngDataUrl(300, 560), { width: 390, height: 730 });
        const size = await planPageSize((await generatePdfBytes({ ...OPTS }))!);
        expect(size.height).toBeGreaterThan(size.width);
    });

    it('capture de bureau (paysage) : page paysage', async () => {
        planMap(pngDataUrl(800, 560), { width: 1000, height: 700 });
        const size = await planPageSize((await generatePdfBytes({ ...OPTS }))!);
        expect(size.width).toBeGreaterThan(size.height);
    });
});

describe('définition demandée pour la largeur imprimée', () => {
    it('une carte portrait demande moins de pixels de large qu’une carte paysage', async () => {
        const { targetPixels } = await import('@shared/pdf-options.js');
        const { planPrintedWidth } = await import('@pctac/pdf-export.js');
        const portrait = planMap(null, { width: 390, height: 730 });
        await generatePdfBytes({ ...OPTS });
        const asked = (portrait.captureToDataUrl.mock.calls[0] as unknown[])[0] as { targetWidthPx: number };
        expect(asked.targetWidthPx).toBe(targetPixels(planPrintedWidth(390 / 730), 'impression'));
        expect(planPrintedWidth(390 / 730)).toBeLessThan(planPrintedWidth(1000 / 700));
    });
});

describe('rien ne se dessine sur le plan', () => {
    it('page portrait : la liste des points et le journal passent sous l’image, jamais dessus', async () => {
        const pm = planMap(pngDataUrl(300, 560), { width: 390, height: 730 });
        Reflect.set(pm, 'getPinsSummary', () => [{ label: 'PRV', lat: 47.39, lng: 0.69, diameterM: null, mgrs: '31T CN 1 2', cell: 'E4' }]);
        const bytes = (await generatePdfBytes({ ...OPTS }))!;
        const pages = await pdfPagesText(bytes);
        const index = pages.findIndex((t) => t.includes('PLAN TACTIQUE'));
        const [image] = await pdfImageDraws(bytes, index);
        expect(image).toBeDefined();
        const over = (await pdfTextItems(bytes, index)).filter((it) => it.y > image!.y && it.y < image!.y + image!.height);
        expect(over.map((it) => it.str)).toEqual([]);
    });
});

describe('légende écrite sous le plan', () => {
    it('attributions de la carte et orientation du nord', async () => {
        document.body.innerHTML = '<div id="view-plan"><div class="maplibregl-ctrl-attrib-inner">© OpenStreetMap · BD ORTHO © IGN</div></div>';
        planMap(pngDataUrl(800, 560), { width: 1000, height: 700 });
        const pages = await pdfPagesText((await generatePdfBytes({ ...OPTS }))!);
        const plan = pages.find((t) => t.includes('PLAN TACTIQUE') && !t.includes('LISTE DES POINTS'))!;
        expect(plan).toContain('© OpenStreetMap');
        expect(plan).toContain('Nord en haut');
    });
});
