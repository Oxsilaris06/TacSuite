/**
 * pc-pdf-galerie.test.ts — Galeries photo du rapport complet PC-Tac
 * (décision 44, audit PDF du 2026-09-25, constats Mo1 à Mo4 et Mo6) :
 * disposition adaptative (layoutGallery), jamais agrandie au-delà de
 * 150 ppi (« basse définition » sinon), cadre « image absente » au lieu d'un
 * blanc muet, titres bornés et repliés, statut imprimé, catégorie « other »
 * (logo d'unité importé d'un OI) incluse.
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
});

interface PhotoSeed { id: string; category: string; title: string; data?: string; status?: string }

function seedPhotos(list: PhotoSeed[]): void {
    localStorage.setItem('pcTacPhotos', JSON.stringify(list));
}

/** Pages (index) dont le texte contient `needle`. */
function pagesWith(pages: string[], needle: string): number[] {
    return pages.flatMap((t, i) => (t.includes(needle) ? [i] : []));
}

describe('définition : jamais agrandie au-delà de 150 ppi', () => {
    it('une photo de 40 × 30 px reste à sa taille native à 150 ppi et porte « basse définition »', async () => {
        seedPhotos([{ id: 'p1', category: 'location', title: 'Minuscule', data: pngDataUrl(40, 30) }]);
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const [page] = pagesWith(pages, 'GALERIE : LIEU');
        const draws = await pdfImageDraws(bytes!, page!);
        expect(draws).toHaveLength(1);
        expect(draws[0]!.width).toBeLessThanOrEqual((40 / 150) * 72 + 0.01);
        expect(pages[page!]).toContain('basse définition');
    });

    it('une photo assez définie remplit sa place, sans mention', async () => {
        seedPhotos([{ id: 'p1', category: 'location', title: 'Grande', data: pngDataUrl(2400, 1800) }]);
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const [page] = pagesWith(pages, 'GALERIE : LIEU');
        const draws = await pdfImageDraws(bytes!, page!);
        expect(draws[0]!.width).toBeGreaterThan(500);
        expect(pages[page!]).not.toContain('basse définition');
    });
});

describe('disposition adaptative (layoutGallery)', () => {
    it('deux portraits partagent une page, un paysage est seul sur la sienne', async () => {
        seedPhotos([
            { id: 'a', category: 'location', title: 'Portrait A', data: pngDataUrl(600, 800) },
            { id: 'b', category: 'location', title: 'Portrait B', data: pngDataUrl(600, 800) },
            { id: 'c', category: 'location', title: 'Paysage C', data: pngDataUrl(800, 600) },
        ]);
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const gallery = pagesWith(pages, 'GALERIE : LIEU');
        expect(gallery).toHaveLength(2);
        expect((await pdfImageDraws(bytes!, gallery[0]!)).length).toBe(2);
        expect((await pdfImageDraws(bytes!, gallery[1]!)).length).toBe(1);
        // Pages de galerie en paysage.
        const sizes = await pdfPageSizes(bytes!);
        expect(sizes[gallery[0]!]!.width).toBeGreaterThan(sizes[gallery[0]!]!.height);
    });

    it('quatre captures d’écran de téléphone tiennent sur une page', async () => {
        seedPhotos([1, 2, 3, 4].map((n) => ({ id: `s${n}`, category: 'target', title: `Écran ${n}`, data: pngDataUrl(390, 844) })));
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const gallery = pagesWith(pages, 'GALERIE : VL TARGET');
        expect(gallery).toHaveLength(1);
        expect((await pdfImageDraws(bytes!, gallery[0]!)).length).toBe(4);
    });
});

describe('image absente ou illisible : dit, jamais un blanc muet (Mo1)', () => {
    it('une photo sans image en base laisse un cadre « Image absente de la base »', async () => {
        seedPhotos([{ id: 'p1', category: 'location', title: 'Façade' }]);
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const [page] = pagesWith(pages, 'GALERIE : LIEU');
        expect(pages[page!]).toContain('Image absente de la base');
        expect(pages[page!]).toContain('Façade');
    });

    it('une image illisible le dit aussi', async () => {
        seedPhotos([{ id: 'p1', category: 'location', title: 'Abîmée', data: 'data:image/png;base64,AAAA' }]);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const [page] = pagesWith(pages, 'GALERIE : LIEU');
        expect(pages[page!]).toMatch(/Image (illisible|absente)/);
    });
});

describe('titres bornés et repliés (Mo3)', () => {
    it('le titre long d’un portrait reste dans sa colonne, sans chevaucher son voisin', async () => {
        const long = 'Vue prise depuis le toit de la mairie vers le pavillon cible avec la cour arrière et le garage';
        seedPhotos([
            { id: 'a', category: 'location', title: long, data: pngDataUrl(600, 800) },
            { id: 'b', category: 'location', title: 'Voisin', data: pngDataUrl(600, 800) },
        ]);
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const [page] = pagesWith(pages, 'GALERIE : LIEU');
        const draws = await pdfImageDraws(bytes!, page!);
        const rightImageX = Math.max(...draws.map((d) => d.x));
        const items = await pdfTextItems(bytes!, page!);
        const leftCaption = items.filter((i) => i.x < rightImageX - 1 && i.y < Math.min(...draws.map((d) => d.y)));
        expect(leftCaption.length).toBeGreaterThan(1); // replié sur plusieurs lignes
        for (const item of leftCaption) expect(item.x + item.width).toBeLessThanOrEqual(rightImageX);
        expect(pages[page!]).toContain('Voisin');
    });
});

describe('statut et catégories (Mo4)', () => {
    it('le statut d’un piégeage et d’une photo d’adversaire est imprimé', async () => {
        seedPhotos([
            { id: 't1', category: 'trap', title: 'Porte garage', data: pngDataUrl(800, 600), status: 'neutralized' },
            { id: 'n1', category: 'neutralized', title: 'Individu', data: pngDataUrl(800, 600), status: 'active' },
        ]);
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const trap = pagesWith(pages, 'GALERIE : PIÉGEAGES')[0]!;
        expect(pages[trap]).toContain('Neutralisé');
        const adv = pagesWith(pages, 'GALERIE : ADVERSAIRE')[0]!;
        expect(pages[adv]).toContain('Actif');
    });

    it('la catégorie « other » (logo d’unité importé d’un OI) a sa galerie', async () => {
        seedPhotos([{ id: 'logo', category: 'other', title: 'Logo unité', data: pngDataUrl(400, 400) }]);
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const [page] = pagesWith(pages, 'GALERIE : AUTRE');
        expect(page).toBeDefined();
        expect(pages[page!]).toContain('Logo unité');
    });
});
