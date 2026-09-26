// @vitest-environment node
/**
 * PATRACDVR de l'OI Complet (décisions 9 et 43, audit PDF du 2026-09-25, F04,
 * F05 et F16) — vérifié sur le PDF RÉELLEMENT RENDU par pdfmake, relu par
 * pdf.js (texte, positions, tailles).
 *
 * Avant : valeurs multiples jamais empilées (« HK416A5 /UMP9 » sur une ligne),
 * 9 chevauchements sur 32 membres (« SHARAN » sur « TAA »), 32 membres sur 7
 * pages à moitié vides, ÉQUIPEMENT à 8 pt dans un tableau à 11, membres non
 * assignés absents.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OiFormData, OiPatracMember } from '@shared/types/contracts.js';
import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';

const FONTS = path.resolve(__dirname, '../../../../src/apps/oi/pdf/fonts');

interface Item { str: string; x: number; y: number; w: number; size: number }

async function renderPages(fd: OiFormData): Promise<Item[][]> {
    const dd = buildOiDocDefinition({ formData: fd, photosBase64: {}, isDark: false }, { format: 'a4' });
    const pdfMake = (await import('pdfmake')).default as unknown as {
        setFonts(f: unknown): void;
        createPdf(d: unknown): { getBuffer(): Promise<Uint8Array> };
    };
    pdfMake.setFonts({
        Oswald: { normal: path.join(FONTS, 'oswald_500.ttf'), bold: path.join(FONTS, 'oswald_500.ttf') },
        JetBrainsMono: { normal: path.join(FONTS, 'jetbrains_mono_400.ttf'), bold: path.join(FONTS, 'jetbrains_mono_700.ttf') },
    });
    const warn = console.warn;
    console.warn = () => {};
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await pdfMake.createPdf(dd).getBuffer());
    } finally {
        console.warn = warn;
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, disableFontFace: true }).promise;
    const out: Item[][] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        out.push(content.items.flatMap((it) => ('str' in it && it.str.trim()
            ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width, size: Math.abs(it.transform[3] as number) }]
            : [])));
    }
    return out;
}

const ARMES: Array<[string, string, string]> = [['HK416A5, UMP9', 'SIG SP 2022', 'PIE'], ['G36', 'Glock 17', 'Sans'], ['UMP9, Benelli M4', 'SIG SP 2022, Glock 26', 'LBD 40']];
const VEH = ['SHARAN', 'VL1', 'MASTER PSIG', 'KANGOO', 'VL5', 'VL6', 'VL7', 'VL8'];
const trig = (i: number): string => `Q${String(i).padStart(2, '0')}`;

function member(i: number): OiPatracMember {
    const a = ARMES[i % 3] as [string, string, string];
    return {
        trigramme: trig(i), fonction: i % 5 === 1 ? 'Chef de bord, Opérateur' : 'Équipier', cellule: `India ${Math.floor(i / 4) + 1}`,
        principales: a[0], secondaires: a[1], afis: a[2], grenades: i % 2 ? 'GM2L, GENL' : 'Sans', equipement: ['Bouclier', 'Bélier', 'Sans', 'Kit effraction'][i % 4] as string,
        equipement2: i % 3 ? 'Sans' : 'Échelle', tenue: "Tenue d'intervention", gpb: i % 2 ? 'GPB lourd' : 'Sans', dir: i % 7 === 0 ? 'PSIG VOISIN' : '',
    };
}

/** OI Complet réduit au PATRACDVR : `n` membres par véhicules de 4, `u` non assignés. */
function complet(n: number, u = 0): OiFormData {
    const rows: NonNullable<OiFormData['patracdvr_rows']> = [];
    for (let k = 0; k < n; k += 4) rows.push({ vehicle: VEH[(k / 4) % VEH.length] as string, members: Array.from({ length: Math.min(4, n - k) }, (_, j) => member(k + j)) });
    return { patracdvr_rows: rows, patracdvr_unassigned: Array.from({ length: u }, (_, k) => member(90 + k)) };
}

/** Pages du PATRACDVR (celles qui portent son titre). */
const patracPages = (pages: Item[][]): Item[][] => pages.filter((items) => items.some((i) => /PATRACDVR/.test(i.str)));

/** Lignes de texte d'une page (morceaux de même hauteur), triées de gauche à droite. */
function lines(items: Item[]): Item[][] {
    const by = new Map<number, Item[]>();
    for (const it of items) {
        const k = Math.round(it.y);
        by.set(k, [...(by.get(k) ?? []), it]);
    }
    return [...by.values()].map((l) => l.sort((a, b) => a.x - b.x));
}

describe('PATRACDVR de l’OI Complet — rendu réel', () => {
    it('32 membres et 2 non assignés : 2 pages au plus, tous les membres présents, « NON ASSIGNÉS » listés', async () => {
        const pages = patracPages(await renderPages(complet(32, 2)));
        expect(pages.length).toBeGreaterThanOrEqual(1);
        expect(pages.length).toBeLessThanOrEqual(2);
        const all = pages.flat().map((i) => i.str.trim());
        for (let i = 0; i < 32; i++) expect(all).toContain(trig(i));
        expect(all).toContain(trig(90));
        expect(all).toContain(trig(91));
        expect(pages.map((p) => p.map((i) => i.str).join(' ')).join(' ')).toContain('NON ASSIGNÉS');
    }, 30_000);

    it('12 membres : une seule page', async () => {
        expect(patracPages(await renderPages(complet(12)))).toHaveLength(1);
    }, 30_000);

    it('aucun chevauchement de texte (« SHARAN » ne recouvre plus « TAA »)', async () => {
        for (const page of patracPages(await renderPages(complet(32, 2)))) {
            for (const line of lines(page)) {
                for (let k = 1; k < line.length; k++) {
                    const a = line[k - 1] as Item;
                    const b = line[k] as Item;
                    expect(a.x + a.w, `« ${a.str} » recouvre « ${b.str} »`).toBeLessThanOrEqual(b.x + 0.5);
                }
            }
        }
    }, 30_000);

    it('valeurs multiples empilées (décision 9) : « HK416A5 / » puis « UMP9 » sur la ligne suivante, jamais sur la même', async () => {
        const pages = patracPages(await renderPages(complet(12)));
        const texts = pages.flatMap(lines).map((l) => l.map((i) => i.str).join(' '));
        expect(texts.some((t) => /HK416A5 \//.test(t))).toBe(true);
        expect(texts.some((t) => /HK416A5 ?\/ ?UMP9/.test(t))).toBe(false);
    }, 30_000);

    it('ÉQUIPEMENT à la taille du tableau (plus de 8 pt fixes dans un tableau plus grand)', async () => {
        const [page] = patracPages(await renderPages(complet(12)));
        const size = (s: string): number | undefined => page?.find((i) => i.str.trim().startsWith(s))?.size;
        expect(size('Q00')).toBeDefined();
        expect(size('Tenue')).toBeCloseTo(size('Q00') as number, 1);
    }, 30_000);
});
