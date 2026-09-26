/**
 * patrac-doc.ts — PDF PATRACDVR séparé (décision 43), produit avec le moteur
 * pdfmake et les polices de l'OI.
 *
 * L'ancien PDF (pdf-lib, Helvetica standard) changeait « ’ », « œ », « € » et
 * le cyrillique en « ? », laissait déborder les mots longs, n'était ni marqué
 * CONFIDENTIEL, ni daté de l'opération, ni paginé (audit PDF du 2026-09-25,
 * F15). Ici : même police que l'OI (JetBrains Mono, qui couvre latin, grec et
 * cyrillique), mention CONFIDENTIEL et « n / N » en pied de chaque page, unité,
 * nom et date de l'opération en tête, membres non assignés sous « NON ASSIGNÉS ».
 *
 * Colonnes adaptées : la police est à chasse fixe (600/1000 em par glyphe), la
 * largeur d'un texte se calcule donc exactement, sans rendu d'essai. Chaque
 * colonne reçoit au moins la largeur de son mot le plus long : aucun mot n'est
 * coupé ni ne sort du tableau. Les largeurs sont communes à tous les véhicules
 * (colonnes alignées d'un tableau à l'autre).
 *
 * Un tableau par véhicule, dont l'en-tête (bandeau du véhicule et libellés des
 * colonnes) est répété sur la page suivante et jamais laissé seul en bas de
 * page ; une rangée n'est jamais coupée.
 */

import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

import type { OiPatracMember, OiPatracRow } from '@shared/types/contracts.js';

import { PDF_FONT_VFS, PDF_FONTS } from './fonts.js';
import { pageGeometry, palette } from './theme.js';

export interface PatracDocInput {
    rows: readonly OiPatracRow[];
    unassigned: readonly OiPatracMember[];
    unite: string;
    /** Date de l'opération, `AAAA-MM-JJ` (champ `date_op`), ou vide. */
    dateOp: string;
    nomOperation?: string;
    isDark?: boolean;
}

const COLUMNS: ReadonlyArray<{ label: string; key: keyof OiPatracMember }> = [
    { label: 'PAX', key: 'trigramme' },
    { label: 'FONCTION', key: 'fonction' },
    { label: 'CELLULE', key: 'cellule' },
    { label: 'ARME P.', key: 'principales' },
    { label: 'ARME S.', key: 'secondaires' },
    { label: 'AFI', key: 'afis' },
    { label: 'GREN.', key: 'grenades' },
    { label: 'ÉQUIP. 1', key: 'equipement' },
    { label: 'ÉQUIP. 2', key: 'equipement2' },
    { label: 'TENUE', key: 'tenue' },
    { label: 'GPB', key: 'gpb' },
    { label: 'DIR', key: 'dir' },
];

/** Paliers de police du tableau (pt) : 8 pt au minimum (décision 43). */
const FONT_FLOOR = 8;
const FONT_STEPS = [9, FONT_FLOOR] as const;
/** Avance d'un glyphe de JetBrains Mono NL, en em (toutes graisses). */
const CHAR_EM = 0.6;
const CELL_PAD = 3;
const LINE = 0.5;
/** Marge de sûreté par colonne contre les arrondis de mesure (pt). */
const EPS = 0.5;

/** Valeurs d'un attribut à choix multiple (`"UMP9, G36"`) : « Sans » et vides écartés. */
function values(v: string | undefined): string[] {
    return (v ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== 'Sans');
}

/** Texte d'une case : une valeur par ligne, séparées par « / » (décision 9). */
function cellText(m: OiPatracMember, key: keyof OiPatracMember): string {
    if (key === 'trigramme' || key === 'dir' || key === 'cellule') return m[key].trim() || '-';
    return values(m[key]).join(' /\n') || '-';
}

const chars = (s: string): number => [...s].length;

const sum = (a: readonly number[]): number => a.reduce((s, x) => s + x, 0);

/**
 * Police et largeurs de contenu (pt) des colonnes (`columns` : textes de
 * chaque colonne, en-tête compris). Dans l'ordre : chaque case sur ses seules
 * lignes de valeurs, à 9 puis 8 pt ; sinon à 8 pt, retour à la ligne entre
 * les mots, chaque colonne gardant la largeur de son mot le plus long.
 */
function fitColumns(columns: readonly string[][], availablePt: number): { fontPt: number; widths: number[] } {
    const room = availablePt - columns.length * (2 * CELL_PAD + LINE) - LINE;
    const measure = (fontPt: number, split: RegExp): number[] =>
        columns.map((texts) => Math.max(...texts.flatMap((t) => t.split(split).map(chars))) * CHAR_EM * fontPt + EPS);
    for (const fontPt of FONT_STEPS) {
        const nat = measure(fontPt, /\n/);
        if (sum(nat) <= room) return { fontPt, widths: nat.map((w) => w + (room - sum(nat)) * (w / sum(nat))) };
    }
    const nat = measure(FONT_FLOOR, /\n/);
    // « / » ne se sépare pas du mot qui le précède (UAX 14, LB13) : « mot / » est un bloc.
    const min = measure(FONT_FLOOR, /\s+(?!\/)/);
    if (sum(min) <= room) {
        const slack = nat.map((w, i) => w - (min[i] as number));
        return { fontPt: FONT_FLOOR, widths: min.map((w, i) => w + (room - sum(min)) * ((slack[i] as number) / sum(slack))) };
    }
    // Mots trop longs pour la page : seules les colonnes aux mots les plus longs
    // sont plafonnées (même plafond pour toutes), les autres gardent la largeur
    // de leur mot le plus long. pdfmake coupe le mot plafonné, jamais débordant.
    let lo = 0;
    let hi = Math.max(...min);
    for (let k = 0; k < 40; k++) {
        const cap = (lo + hi) / 2;
        if (sum(min.map((w) => Math.min(w, cap))) <= room) lo = cap; else hi = cap;
    }
    return { fontPt: FONT_FLOOR, widths: min.map((w) => Math.min(w, lo)) };
}

/** `AAAA-MM-JJ` → `JJ/MM/AAAA` ; toute autre saisie rendue telle quelle. */
function frDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso.trim();
}

/** Nom du fichier : date de l'opération, sinon date LOCALE du jour (jamais UTC). */
export function patracPdfFileName(dateOp: string, now: Date = new Date()): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(dateOp.trim())
        ? dateOp.trim()
        : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return `PATRACDVR_${day}.pdf`;
}

export function buildPatracDocDefinition(input: PatracDocInput): TDocumentDefinitions {
    const p = palette(!!input.isDark);
    const geo = pageGeometry('a4');
    const groups = [
        ...input.rows.map((r) => ({ title: `VÉHICULE : ${r.vehicle || 'Véhicule'}`, members: r.members })),
        { title: 'NON ASSIGNÉS', members: input.unassigned },
    ].filter((g) => g.members.length > 0);
    const all = groups.flatMap((g) => g.members);

    const { fontPt, widths } = fitColumns(COLUMNS.map((c) => [c.label, ...all.map((m) => cellText(m, c.key))]), geo.contentWidthPt);

    const border: [string, string, string, string] = [p.border, p.border, p.border, p.border];
    // Cellules neuves pour chaque tableau : pdfmake annote les objets qu'il met en page.
    const header = (): TableCell[] => COLUMNS.map((c) => ({ text: c.label, bold: true, fillColor: p.headerRow, alignment: 'center', borderColor: border }));
    const tables: Content[] = groups.map((g) => ({
        table: {
            widths,
            headerRows: 2,
            keepWithHeaderRows: 1,
            dontBreakRows: true,
            body: [
                [
                    { text: g.title, colSpan: COLUMNS.length, bold: true, color: p.accent, fillColor: p.cardAlt, borderColor: border },
                    ...COLUMNS.slice(1).map(() => ({})),
                ],
                header(),
                ...g.members.map((m) => COLUMNS.map((c): TableCell => ({
                    text: cellText(m, c.key),
                    bold: c.key === 'trigramme',
                    alignment: 'center',
                    borderColor: border,
                }))),
            ],
        },
        layout: {
            hLineWidth: () => LINE,
            vLineWidth: () => LINE,
            paddingLeft: () => CELL_PAD,
            paddingRight: () => CELL_PAD,
            paddingTop: () => 2,
            paddingBottom: () => 2,
        },
        fontSize: fontPt,
        margin: [0, 0, 0, 8],
    }));

    const date = frDate(input.dateOp);
    const unite = input.unite.trim();
    const info = [
        unite && `Unité : ${unite}`,
        input.nomOperation?.trim() && `Opération : ${input.nomOperation.trim()}`,
        date && `Date : ${date}`,
        `Effectif : ${all.length}`,
    ].filter(Boolean).join('   ·   ');

    return {
        info: { title: `PATRACDVR${date ? ` ${date}` : ''}`, subject: 'CONFIDENTIEL' },
        pageSize: 'A4',
        pageOrientation: 'landscape',
        pageMargins: geo.marginsPt,
        defaultStyle: { font: 'JetBrainsMono', fontSize: 9, color: p.text },
        background: (_page: number, size: { width: number; height: number }): Content => ({
            canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: size.height, color: p.bg, lineWidth: 0 }],
        }),
        footer: (page: number, count: number): Content => ({
            text: [
                { text: `PATRACDVR${unite ? ` - ${unite}` : ''}${date ? ` - ${date}` : ''} - ` },
                { text: 'CONFIDENTIEL', color: p.danger, bold: true },
                { text: ` - ${page} / ${count}` },
            ],
            alignment: 'center',
            fontSize: 9,
            margin: [0, 4, 0, 0],
        }),
        content: [
            {
                columns: [
                    { text: 'PATRACDVR', font: 'Oswald', fontSize: 20, color: p.accent },
                    { text: 'CONFIDENTIEL', bold: true, fontSize: 12, color: p.danger, alignment: 'right', margin: [0, 6, 0, 0] },
                ],
            },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: geo.contentWidthPt, y2: 0, lineWidth: 2, lineColor: p.accent }], margin: [0, 2, 0, 6] },
            { text: info, margin: [0, 0, 0, 8] },
            ...tables,
        ],
    };
}

let fontsReady = false;

/** Rendu navigateur (pdfmake, polices embarquées de l'OI). Import dynamique : cf. `engine-v3.ts::buildOiPdfBlob`. */
export async function renderPatracPdfBlob(docDefinition: TDocumentDefinitions): Promise<Blob> {
    const pdfMake = (await import('pdfmake')).default;
    if (!fontsReady) {
        pdfMake.addVirtualFileSystem(PDF_FONT_VFS);
        pdfMake.addFonts(PDF_FONTS);
        fontsReady = true;
    }
    // R5 : même passe d'écritures non latines que l'OI (avertissement, police
    // de repli) ; « Corriger la saisie » lève OiScriptsCancelledError.
    await (await import('./scripts-fallback.js')).applyOiScriptFallback(docDefinition, pdfMake);
    return pdfMake.createPdf(docDefinition).getBlob();
}
