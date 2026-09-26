// @vitest-environment node
/**
 * OI Express densifié (décision 43, audit PDF du 2026-09-25, F06 et A6) —
 * vérifié sur le PDF RÉELLEMENT RENDU par pdfmake, relu par pdf.js (texte,
 * positions, tailles de police).
 *
 * Objectif mesuré : l'ordre tient sur UNE page jusqu'à 12-16 membres ;
 * au-delà, le PATRACDVR passe seul en page 2 ; jamais de rangée coupée ni de
 * nom cassé (« VL/1 », « SHAR/AN ») ; 8 pt au minimum ; le titre de la
 * chronologie jamais seul en bas de page ; ligne NO-GO / UDA si renseignés.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OiFormData, OiPatracMember } from '@shared/types/contracts.js';
import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';

const FONTS = path.resolve(__dirname, '../../../../src/apps/oi/pdf/fonts');

interface Item { str: string; x: number; y: number; size: number }

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
            ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, size: Math.abs(it.transform[3] as number) }]
            : [])));
    }
    return out;
}

const text = (items: Item[]): string => items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
const txt = (n: number): string => 'Individu retranché au 1er étage, arme longue signalée, accès cour arrière. '.repeat(Math.ceil(n / 75)).slice(0, n);
const VEH = ['SHARAN', 'VL1', 'MASTER PSIG', 'KANGOO', 'VL5', 'VL6', 'VL7', 'VL8', 'VL9', 'VL10'];
const ARMES: Array<[string, string, string]> = [['HK416A5, UMP9', 'SIG SP 2022', 'PIE'], ['G36', 'Glock 17', 'Sans'], ['UMP9, Benelli M4', 'SIG SP 2022, Glock 26', 'LBD 40']];

/** Trigramme unique `Q<i>` (2 à 3 caractères, jamais présent ailleurs dans l'ordre). */
const trig = (i: number): string => `Q${String(i).padStart(2, '0')}`;

function member(i: number): OiPatracMember {
    const a = ARMES[i % 3] as [string, string, string];
    return {
        trigramme: trig(i), fonction: i === 0 ? 'Chef inter' : i % 5 === 1 ? 'Chef de bord, Opérateur' : 'Équipier', cellule: `India ${Math.floor(i / 4) + 1}`,
        principales: a[0], secondaires: a[1], afis: a[2], grenades: i % 2 ? 'GM2L, GENL' : 'Sans', equipement: ['Bouclier', 'Bélier', 'Sans', 'Kit effraction'][i % 4] as string,
        equipement2: i % 3 ? 'Sans' : 'Échelle', tenue: "Tenue d'intervention", gpb: i % 2 ? 'GPB lourd' : 'Sans', dir: '',
    };
}

function express(n: number, opts: { ev?: number; len?: number; extra?: Partial<OiFormData> } = {}): OiFormData {
    const { ev = 5, len = 300 } = opts;
    const rows: NonNullable<OiFormData['patracdvr_rows']> = [];
    for (let k = 0; k < n; k += 4) {
        rows.push({ vehicle: VEH[(k / 4) % VEH.length] as string, members: Array.from({ length: Math.min(4, n - k) }, (_, j) => member(k + j)) });
    }
    return {
        oi_mode: 'express', date_op: '2026-09-24', nom_operation: 'OPÉRATION FICTIVE', trigramme_redacteur: 'ABC', unite_redacteur: 'PSIG TESTVILLE',
        situation_generale: txt(len), situation_particuliere: txt(len / 2), missions_psig: "INTERPELLER L'INDIVIDU",
        date_execution: '2026-09-25', heure_execution: '06:00', action_body_text: txt(len),
        time_events: Array.from({ length: ev }, (_, i) => ({ type: `E${i}`, hour: `0${5 + (i % 4)}:00`, description: `Étape ${i} ${txt(40)}` })),
        patracdvr_rows: rows,
        ...opts.extra,
    };
}

/** Page (0-based) de chaque trigramme du PATRACDVR. */
function pagesOf(pages: Item[][], n: number): number[] {
    return Array.from({ length: n }, (_, i) => pages.findIndex((items) => items.some((it) => it.str.trim() === trig(i))));
}

describe('OI Express densifié — ordre sur une page, PATRACDVR seul en page 2 au-delà', () => {
    // Textes de 300 caractères jusqu'à 12 membres, 250 à 16 (seuil mesuré :
    // à 16 membres et 300 caractères, le PATRACDVR passe en page 2).
    for (const [n, len] of [[4, 300], [12, 300], [16, 250]] as const) {
        it(`${n} membres, 5 étapes, textes de ${len} caractères : l'ordre ENTIER sur une seule page`, async () => {
            const pages = await renderPages(express(n, { len }));
            expect(pages).toHaveLength(1);
            expect(pagesOf(pages, n).every((p) => p === 0)).toBe(true);
        }, 30_000);
    }

    for (const n of [24, 40]) {
        it(`${n} membres : la page 1 porte l'ordre sans PATRACDVR, le PATRACDVR commence seul en page 2, en-tête répété`, async () => {
            const pages = await renderPages(express(n));
            const where = pagesOf(pages, n);
            expect(where.every((p) => p >= 1)).toBe(true);
            expect(text(pages[0] as Item[])).toMatch(/Chronologie/i);
            expect(text(pages[1] as Item[])).toMatch(/PATRACDVR/);
            // Chaque page qui porte des membres porte aussi l'en-tête des colonnes.
            for (const p of new Set(where)) expect(text(pages[p] as Item[])).toMatch(/\bPAX\b/);
        }, 30_000);
    }
});

describe('OI Express densifié — lisibilité', () => {
    it('8 pt au minimum sur l\'ordre, et les noms de véhicules jamais cassés (« SHARAN », « VL1 », « MASTER PSIG » d\'un seul tenant)', async () => {
        const pages = await renderPages(express(40));
        for (const items of pages) for (const it of items) expect(it.size).toBeGreaterThanOrEqual(7.95);
        const all = pages.flat().map((i) => i.str.trim());
        for (const v of ['SHARAN', 'VL1', 'KANGOO']) expect(all).toContain(v);
        expect(all).not.toContain('SHAR');
        expect(pages.map(text).join(' ')).toContain('MASTER PSIG');
    }, 30_000);

    it('en-tête compact d\'une ligne : type, opération, date et rédacteur à la même hauteur', async () => {
        const [p1] = await renderPages(express(4));
        const y = (s: string): number | undefined => p1?.find((i) => i.str.includes(s))?.y;
        const top = y('OI EXPRESS');
        expect(top).toBeDefined();
        for (const s of ['FICTIVE', '24/09/2026', 'Rédacteur']) expect(Math.abs((y(s) ?? -999) - (top as number))).toBeLessThan(6);
    }, 30_000);

    it('le titre de la chronologie n\'est jamais seul en bas de page : toute page qui le porte porte aussi au moins une étape', async () => {
        // Textes démesurés : l'ordre déborde, la chronologie démarre en bas d'une page.
        for (const len of [1400, 1700, 2000, 2300]) {
            const pages = await renderPages(express(8, { ev: 12, len }));
            pages.forEach((items) => {
                if (/Chronologie/i.test(text(items))) expect(items.some((i) => /^E\d+$/.test(i.str.trim()))).toBe(true);
            });
        }
    }, 60_000);
});

describe('OI Express — ligne NO-GO / UDA (décision 43)', () => {
    it('présente quand les champs sont renseignés, sur la page de l\'ordre', async () => {
        const [p1] = await renderPages(express(12, { extra: { no_go: 'Pas de tir vers la rue.', uda: 'Riposte graduée.' } }));
        const t = text(p1 as Item[]);
        expect(t).toMatch(/NO-GO/);
        expect(t).toContain('Pas de tir vers la rue.');
        expect(t).toMatch(/UDA/);
        expect(t).toContain('Riposte graduée.');
    }, 30_000);

    it('absente quand ils sont vides', async () => {
        const [p1] = await renderPages(express(4));
        expect(text(p1 as Item[])).not.toMatch(/NO-GO|\bUDA\b/);
    }, 30_000);
});
