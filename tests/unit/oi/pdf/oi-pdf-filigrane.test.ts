/**
 * oi-pdf-filigrane.test.ts — Fond personnalisé du PDF de l'OI (audit PDF du
 * 2026-09-25, F08 ; question 6 tranchée : filigrane discret).
 *
 * Le fond était posé à 90 % d'opacité (60 % en sombre), calé sur le coin
 * haut gauche de la page : titre et cartes de la couverture illisibles. Il
 * devient un filigrane : 15 % d'opacité au plus, centré sur la page, sous des
 * cartes à fond opaque, sur la couverture et la page finale seulement.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import type { Content, ContextPageSize } from 'pdfmake/interfaces';
import { describe, expect, it } from 'vitest';

import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';
import { pageGeometry, PDF_DARK, PDF_LIGHT } from '@oi/pdf/theme.js';
import type { OiFormData } from '@shared/types/contracts.js';

/** En-tête PNG seul (signature + IHDR) : le constructeur ne lit que les dimensions. */
function pngHeaderDataUrl(width: number, height: number): string {
    const u32 = (n: number): string => String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    const bin = '\x89PNG\r\n\x1a\n' + u32(13) + 'IHDR' + u32(width) + u32(height) + '\x08\x06\x00\x00\x00' + u32(0);
    return `data:image/png;base64,${btoa(bin)}`;
}

function findNodes(node: unknown, pred: (n: Record<string, unknown>) => boolean, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(node)) {
        node.forEach((n) => findNodes(n, pred, out));
    } else if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (pred(obj)) out.push(obj);
        Object.values(obj).forEach((v) => findNodes(v, pred, out));
    }
    return out;
}

const FORM: OiFormData = {
    date_op: '2026-09-25',
    situation_generale: 'Individu retranché.',
    situation_particuliere: 'Pavillon isolé.',
    adversaries: [{ id: 'a1', nom_adversaire: 'MARTIN Paul', me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] }],
    missions_psig: 'Interpeller',
};

function build(bg: string | null, isDark = false, format: 'a4' | '16:9' = 'a4') {
    const photosBase64: Record<string, string> = bg ? { custom_pdf_background: bg } : {};
    return buildOiDocDefinition({ formData: FORM, photosBase64, isDark }, { format });
}

/** Fond de la page `n` (callback `background` de la définition). */
function backgroundOf(dd: ReturnType<typeof build>, n: number, format: 'a4' | '16:9' = 'a4'): Content {
    const geo = pageGeometry(format);
    const size = { width: geo.widthPt, height: geo.heightPt, orientation: 'landscape' } as ContextPageSize;
    return (dd.background as (page: number, s: ContextPageSize) => Content)(n, size);
}

const isWatermark = (n: Record<string, unknown>): boolean => typeof n.image === 'string' && n.opacity !== undefined && n.absolutePosition !== undefined;

describe('Fond personnalisé — filigrane discret', () => {
    it.each([
        ['clair, A4, paysage 400×200', false, 'a4', 400, 200],
        ['sombre, A4, portrait 300×900', true, 'a4', 300, 900],
        ['clair, 16:9, carré 500×500', false, '16:9', 500, 500],
    ] as const)('%s : opacité de 0,15 au plus, image centrée sur la page', (_label, dark, format, w, h) => {
        const dd = build(pngHeaderDataUrl(w, h), dark, format);
        const geo = pageGeometry(format);
        // Couverture : le filigrane est dans le FOND de la page 1 (sous les fonds de cellule).
        const marks = findNodes(backgroundOf(dd, 1, format), isWatermark);
        expect(marks).toHaveLength(1);
        const mark = marks[0]!;
        expect(Number(mark.opacity)).toBeGreaterThan(0);
        expect(Number(mark.opacity)).toBeLessThanOrEqual(0.15);
        // Taille posée explicitement (même rapport que l'image) et centre de
        // l'image au centre de la page.
        const pos = mark.absolutePosition as { x: number; y: number };
        const width = mark.width as number;
        const height = mark.height as number;
        expect(width / height).toBeCloseTo(w / h, 3);
        expect(width).toBeLessThanOrEqual(geo.contentWidthPt + 0.01);
        expect(height).toBeLessThanOrEqual(geo.contentHeightPt + 0.01);
        expect(pos.x + width / 2).toBeCloseTo(geo.widthPt / 2, 1);
        expect(pos.y + height / 2).toBeCloseTo(geo.heightPt / 2, 1);
    });

    it('couverture et page finale seulement, et toujours dessiné sous le reste de la page', () => {
        const dd = build(pngHeaderDataUrl(400, 200));
        // Couverture : fond de la page 1 = couleur de page PUIS filigrane ; aucune autre page.
        const bg1 = backgroundOf(dd, 1) as { stack: Record<string, unknown>[] };
        expect(bg1.stack[0]!.canvas).toBeDefined();
        expect(isWatermark(bg1.stack[1]!)).toBe(true);
        expect(findNodes(backgroundOf(dd, 2), isWatermark)).toHaveLength(0);
        // Page finale (sans carte) : premier élément dessiné de son contenu.
        const pages = dd.content as unknown[];
        const withMark = pages.map((pg, i) => [i, findNodes(pg, isWatermark).length] as const).filter(([, n]) => n > 0);
        expect(withMark.map(([i]) => i)).toEqual([pages.length - 1]);
        // Les sauts de page enveloppent la page dans une pile.
        let first = pages[pages.length - 1] as Record<string, unknown>;
        while (Array.isArray(first.stack)) first = (first.stack as Record<string, unknown>[])[0]!;
        expect(isWatermark(first), 'page finale : filigrane en premier').toBe(true);
    });

    it.each([[false, PDF_LIGHT.bg], [true, PDF_DARK.bg]] as const)('sombre=%s : carte Situation à fond opaque (couleur de page) sous le filigrane', (dark, bg) => {
        const cover = (build(pngHeaderDataUrl(400, 200), dark).content as unknown[])[0];
        const cards = findNodes(cover, (n) => Array.isArray(n.stack) && JSON.stringify(n.stack).match(/SITUATION GLOBALE|CIBLE/) !== null && n.fillColor !== undefined);
        const titles = cards.map((c) => JSON.stringify(c.stack));
        expect(titles.some((t) => t.includes('SITUATION GLOBALE'))).toBe(true);
        cards.forEach((c) => expect(c.fillColor).toBe(bg));
    });

    it('sans fond : aucune image de filigrane, cartes inchangées (transparentes)', () => {
        const dd = build(null);
        expect(findNodes(dd.content, isWatermark)).toHaveLength(0);
        expect(findNodes(backgroundOf(dd, 1), isWatermark)).toHaveLength(0);
        const cover = (dd.content as unknown[])[0];
        expect(findNodes(cover, (n) => Array.isArray(n.stack) && JSON.stringify(n.stack).includes('SITUATION GLOBALE') && n.fillColor !== undefined)).toHaveLength(0);
    });
});

describe("Fond personnalisé — aide de l'écran", () => {
    const doc = new JSDOM(readFileSync(join(process.cwd(), 'oi', 'index.html'), 'utf8')).window.document;
    const panel = doc.querySelector('#custom_bg_input')!.closest('.collapsible-container')!;

    it("ne promet plus de fond par défaut (« Grille Tactique ») ni de « Rétablir Défaut »", () => {
        const text = panel.textContent!.replace(/\s+/g, ' ');
        expect(text).not.toMatch(/Grille Tactique/i);
        expect(text).not.toMatch(/Rétablir\s+Défaut/i);
        expect(text).not.toMatch(/fond par défaut/i);
    });

    it("dit ce que devient l'image : filigrane discret, page de garde et dernière page", () => {
        const help = panel.querySelector('.collapsible-content p')!.textContent!.replace(/\s+/g, ' ');
        expect(help).toMatch(/filigrane/i);
        expect(help).toMatch(/page de garde/i);
        expect(help).toMatch(/dernière page/i);
        const remove = panel.querySelector('[data-action="remove-custom-background"]')!;
        expect(remove.textContent!.replace(/\s+/g, ' ')).toMatch(/Retirer le fond/);
    });
});
