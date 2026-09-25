/**
 * photo-layout.test.ts — galerie adaptative commune aux PDF de l'OI et de
 * PC-Tac (décision 44) : 2 portraits par page, 3 à 4 captures de téléphone,
 * panoramas empilés, 1 seule photo pour les paysages et les plans ; jamais
 * agrandie au-delà de ~150 ppi (sinon « basse définition »).
 */
import { describe, expect, it } from 'vitest';
import { layoutGallery, photoShape, type GalleryPhoto, type GallerySlot } from '@shared/photo-layout.js';

const A4_PAYSAGE = { width: 770, height: 480 };
const A4_PORTRAIT = { width: 515, height: 720 };

const photo = (id: string, w: number, h: number, isPlan = false): GalleryPhoto => ({ id, widthPx: w, heightPx: h, isPlan });

function inside(s: GallerySlot, box: { width: number; height: number }): boolean {
    return s.x >= -0.01 && s.y >= -0.01 && s.x + s.width <= box.width + 0.01 && s.captionY + 12 <= box.height + 0.01;
}
function overlap(a: GallerySlot, b: GallerySlot): boolean {
    const ay2 = a.captionY + 12, by2 = b.captionY + 12;
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < by2 && b.y < ay2;
}

describe('photoShape', () => {
    it('classe par rapport largeur/hauteur, le plan d’abord', () => {
        expect(photoShape(photo('a', 4000, 3000))).toBe('paysage');
        expect(photoShape(photo('b', 3000, 4000))).toBe('portrait');
        expect(photoShape(photo('c', 1170, 2532))).toBe('ecran');
        expect(photoShape(photo('d', 8000, 2000))).toBe('panorama');
        expect(photoShape(photo('e', 3000, 4000, true))).toBe('plan');
    });

    it('une image sans dimensions lisibles est traitée comme un paysage', () => {
        expect(photoShape(photo('z', 0, 0))).toBe('paysage');
        expect(photoShape(photo('z', Number.NaN, 10))).toBe('paysage');
    });
});

describe('layoutGallery', () => {
    it('rien à placer : aucune page', () => {
        expect(layoutGallery([], A4_PAYSAGE)).toEqual([]);
    });

    it('2 portraits par page, côte à côte, même taille', () => {
        const pages = layoutGallery([photo('p1', 3000, 4000), photo('p2', 3000, 4000), photo('p3', 3000, 4000)], A4_PAYSAGE);
        expect(pages.map((p) => p.map((s) => s.id))).toEqual([['p1', 'p2'], ['p3']]);
        const [a, b] = pages[0] as [GallerySlot, GallerySlot];
        expect(a.width).toBeCloseTo(b.width, 5);
        expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    });

    it('un paysage ou un plan est seul sur sa page', () => {
        const pages = layoutGallery([photo('l1', 4000, 3000), photo('pl', 3000, 4000, true), photo('l2', 4000, 3000)], A4_PAYSAGE);
        expect(pages.map((p) => p.map((s) => s.id))).toEqual([['l1'], ['pl'], ['l2']]);
    });

    it('4 captures de téléphone par page en paysage, 3 en portrait', () => {
        const shots = Array.from({ length: 5 }, (_, i) => photo(`s${i}`, 1170, 2532));
        expect(layoutGallery(shots, A4_PAYSAGE).map((p) => p.length)).toEqual([4, 1]);
        expect(layoutGallery(shots, A4_PORTRAIT).map((p) => p.length)).toEqual([3, 2]);
    });

    it('les panoramas s’empilent tant qu’ils tiennent en hauteur', () => {
        const panos = Array.from({ length: 3 }, (_, i) => photo(`n${i}`, 8000, 2000));
        const pages = layoutGallery(panos, A4_PAYSAGE);
        expect(pages[0]?.length).toBeGreaterThanOrEqual(2);
        expect(pages.flat()).toHaveLength(3);
    });

    it('garde l’ordre de saisie', () => {
        const list = [photo('a', 3000, 4000), photo('b', 4000, 3000), photo('c', 3000, 4000), photo('d', 3000, 4000)];
        expect(layoutGallery(list, A4_PAYSAGE).flat().map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('n’agrandit jamais au-delà de 150 ppi et signale une image trop petite', () => {
        const [[tiny]] = layoutGallery([photo('t', 40, 30)], A4_PAYSAGE) as [[GallerySlot]];
        expect(tiny.width).toBeLessThanOrEqual((40 / 150) * 72 + 0.01);
        expect(tiny.lowRes).toBe(true);
    });

    it('une photo de 1024 px reste grande et n’est pas marquée basse définition', () => {
        const [[s]] = layoutGallery([photo('m', 1024, 768)], A4_PAYSAGE) as [[GallerySlot]];
        expect(s.width).toBeCloseTo((1024 / 150) * 72, 1);
        expect(s.lowRes).toBe(false);
    });

    it('conserve le rapport largeur/hauteur de chaque image', () => {
        const list = [photo('a', 3000, 4000), photo('b', 1170, 2532), photo('c', 8000, 2000), photo('d', 4000, 3000)];
        for (const s of layoutGallery(list, A4_PAYSAGE).flat()) {
            const src = list.find((p) => p.id === s.id)!;
            expect(s.width / s.height).toBeCloseTo(src.widthPx / src.heightPx, 3);
        }
    });

    it('invariants : tout dans la zone, aucun chevauchement (jeu mêlé de 60 images)', () => {
        const dims: [number, number][] = [[3000, 4000], [4000, 3000], [1170, 2532], [8000, 2000], [40, 30], [2000, 2000], [6000, 1000]];
        const list = Array.from({ length: 60 }, (_, i) => {
            const [w, h] = dims[i % dims.length]!;
            return photo(`x${i}`, w, h, i % 11 === 0);
        });
        for (const box of [A4_PAYSAGE, A4_PORTRAIT]) {
            const pages = layoutGallery(list, box);
            expect(pages.flat()).toHaveLength(60);
            for (const page of pages) {
                for (const s of page) expect(inside(s, box)).toBe(true);
                for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) {
                    expect(overlap(page[i]!, page[j]!)).toBe(false);
                }
            }
        }
    });
});
