// @vitest-environment node
/**
 * PDF PATRACDVR séparé (décision 43, audit PDF du 2026-09-25, F15) — vérifié
 * sur le PDF RÉELLEMENT RENDU par pdfmake avec les polices de l'OI, relu par
 * pdf.js (texte et positions).
 *
 * L'ancien PDF (pdf-lib, Helvetica standard) changeait « ’ », « œ », « € » et
 * le cyrillique en « ? », laissait déborder les mots longs hors de leur
 * colonne, n'était ni marqué CONFIDENTIEL, ni daté de l'opération, ni paginé.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OiPatracMember, OiPatracRow } from '@shared/types/contracts.js';
import { buildPatracDocDefinition, patracPdfFileName, type PatracDocInput } from '@oi/pdf/patrac-doc.js';

const FONTS = path.resolve(__dirname, '../../../../src/apps/oi/pdf/fonts');
const A4_LANDSCAPE_WIDTH = 841.89;

async function render(input: PatracDocInput): Promise<Uint8Array> {
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
    try {
        return new Uint8Array(await pdfMake.createPdf(buildPatracDocDefinition(input)).getBuffer());
    } finally {
        console.warn = warn;
    }
}

interface Item { str: string; x: number; width: number }

/** Morceaux de texte de chaque page (pdf.js). */
async function pages(bytes: Uint8Array): Promise<Item[][]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, disableFontFace: true }).promise;
    const out: Item[][] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        out.push(content.items.flatMap((it) => ('str' in it && it.str.trim()
            ? [{ str: it.str, x: it.transform[4] as number, width: it.width }]
            : [])));
    }
    return out;
}

const pageText = (items: Item[]): string => items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');

function member(over: Partial<OiPatracMember>): OiPatracMember {
    return {
        trigramme: 'TAA', fonction: 'Équipier', cellule: 'India 1', principales: 'UMP9', secondaires: 'SIG SP 2022',
        afis: 'Sans', grenades: 'GM2L', equipement: 'Bouclier', equipement2: 'Sans', tenue: 'UBAS', gpb: 'GPB lourd', dir: '',
        ...over,
    };
}

/** Jeu fictif de l'audit (scénario B7) : apostrophe d'iOS, œ, €, cyrillique, mots longs, non assigné. */
function cas(): PatracDocInput {
    const rows: OiPatracRow[] = [
        {
            vehicle: 'SHARAN-BANALISÉ-LONG',
            members: [
                member({ trigramme: 'TAA', fonction: 'Chef de bord', principales: 'HK416A5, UMP9, Benelli M4', tenue: 'Tenue d’intervention, Gilet-porte-plaques-lourd' }),
                member({ trigramme: 'TBA', equipement: 'Bélier œil-de-bœuf 250 €', dir: 'PSIG-TESTVIL-SUD' }),
                member({ trigramme: 'TCA' }),
            ],
        },
        { vehicle: 'VL2', members: [member({ trigramme: 'ИВН' }), member({ trigramme: 'TEA' })] },
    ];
    return {
        rows,
        unassigned: [member({ trigramme: 'NAS', cellule: '', principales: 'UMP9', secondaires: '', grenades: '', equipement: '', tenue: '', gpb: '' })],
        unite: 'PSIG TESTVILLE',
        dateOp: '2026-09-25',
        nomOperation: 'AUBE GRISE',
    };
}

describe('PDF PATRACDVR séparé — rendu pdfmake avec les polices de l’OI', () => {
    it('garde ’, œ, € et le cyrillique (plus aucun « ? »)', async () => {
        const text = (await pages(await render(cas()))).map(pageText).join(' ');
        expect(text).toContain('Tenue d’intervention');
        expect(text).toContain('Bélier œil-de-bœuf 250 €');
        expect(text).toContain('ИВН');
        expect(text).not.toContain('?');
    });

    it('porte CONFIDENTIEL, l’unité, le nom et la date de l’opération, et « n / N » sur chaque page', async () => {
        // 60 membres de plus : le tableau passe sur plusieurs pages.
        const base = cas();
        const input = { ...base, rows: [...base.rows, { vehicle: 'RENFORT', members: Array.from({ length: 60 }, (_, i) => member({ trigramme: `R${String(i).padStart(2, '0')}` })) }] };
        const all = await pages(await render(input));
        expect(all.length).toBeGreaterThan(1);
        const first = pageText(all[0] ?? []);
        expect(first).toContain('PSIG TESTVILLE');
        expect(first).toContain('AUBE GRISE');
        expect(first).toContain('25/09/2026');
        all.forEach((items, i) => {
            const t = pageText(items);
            expect(t).toContain('CONFIDENTIEL');
            expect(t).toContain(`${i + 1} / ${all.length}`);
        });
    });

    it('répète les libellés des colonnes sous le bandeau de CHAQUE véhicule', async () => {
        const text = (await pages(await render(cas()))).map(pageText).join(' ');
        // 2 véhicules + non assignés = 3 tableaux, chacun avec ses libellés.
        expect(text.match(/PAX FONCTION CELLULE ARME P\. ARME S\./g)).toHaveLength(3);
    });

    it('liste les membres non assignés sous « NON ASSIGNÉS »', async () => {
        const text = (await pages(await render(cas()))).map(pageText).join(' ');
        const idx = text.indexOf('NON ASSIGNÉS');
        expect(idx).toBeGreaterThan(-1);
        expect(text.indexOf('NAS', idx)).toBeGreaterThan(idx);
    });

    it('adapte les colonnes : aucun mot coupé ni sorti du tableau', async () => {
        const all = await pages(await render(cas()));
        const words = all.flatMap((items) => pageText(items).split(' '));
        for (const w of ['Gilet-porte-plaques-lourd', 'PSIG-TESTVIL-SUD', 'HK416A5', 'd’intervention']) {
            expect(words).toContain(w);
        }
        const right = A4_LANDSCAPE_WIDTH - 20;
        for (const it of all.flat()) expect(it.x + it.width).toBeLessThanOrEqual(right);
    });

    it('un mot plus long que la page entière reste dans la page, sans écraser les autres colonnes', async () => {
        // « / » ne se sépare jamais du mot qui le précède (UAX 14) : la case
        // empilée « Gilet-porte-plaques-lourd / » forme un seul bloc.
        const input = { ...cas(), unassigned: [member({ trigramme: 'LNG', equipement: 'X'.repeat(300), tenue: 'Tenue d’intervention, Gilet-porte-plaques-lourd, Casque balistique' })] };
        const all = await pages(await render(input));
        for (const it of all.flat()) expect(it.x + it.width).toBeLessThanOrEqual(A4_LANDSCAPE_WIDTH - 20);
        // Seul le mot démesuré est coupé : les autres restent entiers.
        const words = all.flatMap((items) => pageText(items).split(' '));
        for (const w of ['PSIG-TESTVIL-SUD', 'FONCTION', 'CELLULE', 'Équipier']) expect(words).toContain(w);
        expect(words.filter((w) => w === 'Gilet-porte-plaques-lourd')).toHaveLength(2);
    });
});

describe('patracPdfFileName', () => {
    it('porte la date de l’opération', () => {
        expect(patracPdfFileName('2026-09-25')).toBe('PATRACDVR_2026-09-25.pdf');
    });

    it('sans date d’opération : la date LOCALE du jour, jamais la date UTC (minuit à 2 h)', () => {
        expect(patracPdfFileName('', new Date(2026, 8, 26, 0, 30))).toBe('PATRACDVR_2026-09-26.pdf');
    });
});
