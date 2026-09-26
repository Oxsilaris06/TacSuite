/**
 * scripts-fallback.ts — Écritures non latines dans le PDF de l'OI (décision
 * 44, audit PDF du 2026-09-25, F14 : un nom arabe sortait en carrés vides et
 * disparaissait du texte, le grec des titres aussi).
 *
 * PASSE SUR LA DÉFINITION DU DOCUMENT, après sa construction et avant le
 * rendu pdfmake (`engine-v3.ts::buildOiPdfBlob`, une ligne) :
 *   1. chaque texte est rattaché à sa police effective (JetBrains Mono NL
 *      pour le corps, Oswald pour les titres) ;
 *   2. ce qu'aucune police ne couvre (chinois, émoji…) est annoncé AVANT la
 *      génération (`confirmUnsupportedChars`) ; « Corriger la saisie » annule
 *      (`OiScriptsCancelledError`), « Générer quand même » est retenu pour la
 *      session tant que les caractères signalés ne changent pas (l'aperçu se
 *      régénère à chaque réglage) ;
 *   3. ces caractères sont remplacés (émoji retirés, le reste « ? ») ;
 *   4. chaque texte est découpé en segments d'une seule police
 *      (`splitFontRuns`) : chaîne JetBrains Mono NL → Noto Sans → Noto Sans
 *      Arabic pour le corps, Oswald → Noto Sans → Noto Sans Arabic → JetBrains
 *      Mono pour les titres ;
 *   5. les polices de repli ne sont enregistrées dans pdfmake que si un
 *      segment s'en sert (`loadExtraFontVfs`, chargé à la demande).
 *
 * Un texte latin courant ne charge rien (ni fontkit, ni Noto) ; un texte que
 * la police de base couvre en entier ne charge pas Noto.
 *
 * Arabe : fontkit remet un segment de droite à gauche dans l'ordre visuel à
 * condition qu'il arrive d'un seul tenant ; pdfmake coupant les lignes aux
 * espaces, les espaces INTERNES d'un segment arabe deviennent insécables.
 */

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import { findUnsupported, replaceUnsupported, splitFontRuns, type FontCandidate, type HasGlyph } from '@shared/pdf-glyphs.js';
import type { UnsupportedChars } from '@shared/pdf-unsupported-dialog.js';
import { PDF_FONT_VFS } from './fonts.js';

/** Le strict nécessaire de l'instance pdfmake du navigateur. */
export interface PdfMakeFontRegistry {
    addVirtualFileSystem(vfs: Record<string, string>): void;
    addFonts(fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>): void;
}

/** « Corriger la saisie » : la génération s'arrête, rien n'est produit. */
export class OiScriptsCancelledError extends Error {
    constructor() {
        super('Génération annulée : corrigez les caractères non imprimables signalés.');
        this.name = 'OiScriptsCancelledError';
    }
}

const BODY = 'JetBrainsMono';
const TITLE = 'Oswald';
const NOTO = 'NotoSans';
const ARABIC = 'NotoSansArabic';

/**
 * Latin courant, entièrement couvert par JetBrains Mono NL et par Oswald
 * (vérifié avec fontkit ; le trait d'union conditionnel U+00AD, absent
 * d'Oswald, est un caractère invisible que fontkit efface au rendu).
 */
const SAFE_TEXT = /^[\t\n\r\x20-\x7E\u00A0-\u00FF\u0152\u0153\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]*$/u;

interface Chains { body: FontCandidate[]; title: FontCandidate[] }

/** Contrôles (retours à la ligne) et U+00AD : jamais un motif de repli. */
function lenient(has: HasGlyph): HasGlyph {
    return (cp) => cp < 0x20 || cp === 0xad || has(cp);
}

let baseTesters: Promise<{ body: HasGlyph; title: HasGlyph }> | null = null;
let fullChains: Promise<{ chains: Chains; vfs: Record<string, string> }> | null = null;
/** Caractères déjà acceptés (« Générer quand même ») pendant cette session. */
let acceptedKey: string | null = null;

function loadBaseTesters(): Promise<{ body: HasGlyph; title: HasGlyph }> {
    baseTesters ??= import('@shared/pdf-fonts/index.js').then(({ base64ToBytes, glyphTester }) => ({
        body: lenient(glyphTester(base64ToBytes(PDF_FONT_VFS['JetBrainsMono-400.ttf']!))),
        title: lenient(glyphTester(base64ToBytes(PDF_FONT_VFS['Oswald-500.ttf']!))),
    }));
    return baseTesters;
}

function loadFullChains(): Promise<{ chains: Chains; vfs: Record<string, string> }> {
    fullChains ??= Promise.all([import('@shared/pdf-fonts/index.js'), loadBaseTesters()]).then(async ([kit, base]) => {
        const vfs = await kit.loadExtraFontVfs();
        const tester = (key: string): HasGlyph => lenient(kit.glyphTester(kit.base64ToBytes(vfs[key]!)));
        const noto = { id: NOTO, has: tester(kit.EXTRA_FONT_KEYS.notoRegular) };
        const arabic = { id: ARABIC, has: tester(kit.EXTRA_FONT_KEYS.notoArabic) };
        const body = { id: BODY, has: base.body };
        return {
            vfs,
            chains: {
                body: [body, noto, arabic],
                title: [{ id: TITLE, has: base.title }, noto, arabic, body],
            },
        };
    }).catch((err: unknown) => {
        fullChains = null; // hors ligne sans cache : on retentera
        throw err;
    });
    return fullChains;
}

/** Un texte rencontré : sa police de base et le dernier titre vu (pour dire « où »). */
interface Found { text: string; base: string; title: string }

type Rewrite = (text: string, base: string) => string | Content[];

/**
 * Parcourt un nœud pdfmake dans l'ordre du document ; `rewrite` reçoit chaque
 * texte avec sa police effective et rend sa nouvelle valeur. Héritage pdfmake :
 * `font` d'un nœud vaut pour ses descendants (pile, colonnes, cellules,
 * segments d'un texte).
 */
function walk(node: unknown, font: string, rewrite: Rewrite): unknown {
    if (typeof node === 'string') {
        const next = rewrite(node, font);
        return next === node ? node : { text: next };
    }
    if (Array.isArray(node)) return node.map((n) => walk(n, font, rewrite));
    if (!node || typeof node !== 'object') return node;
    const o = node as Record<string, unknown>;
    const own = typeof o.font === 'string' ? o.font : font;
    if (typeof o.text === 'string') {
        o.text = rewrite(o.text, own);
    } else if (Array.isArray(o.text)) {
        o.text = o.text.flatMap((part) => inlineParts(part, own, rewrite));
    } else if (o.text && typeof o.text === 'object') {
        o.text = walk(o.text, own, rewrite);
    }
    for (const key of ['stack', 'columns', 'ul', 'ol'] as const) {
        if (Array.isArray(o[key])) o[key] = (o[key] as unknown[]).map((n) => walk(n, own, rewrite));
    }
    const table = o.table as { body?: unknown[][] } | undefined;
    if (table && Array.isArray(table.body)) table.body = table.body.map((row) => row.map((cell) => walk(cell, own, rewrite)));
    return o;
}

/**
 * Morceaux d'un texte en ligne. Un morceau découpé devient plusieurs morceaux
 * qui gardent CHACUN son style : pdfmake aplatit un tableau imbriqué dans un
 * morceau en perdant le gras et la couleur de ce morceau (vu au rendu).
 */
function inlineParts(part: unknown, font: string, rewrite: Rewrite): unknown[] {
    if (typeof part === 'string') {
        const next = rewrite(part, font);
        return typeof next === 'string' ? [next] : next;
    }
    if (!part || typeof part !== 'object') return [part];
    const p = part as Record<string, unknown>;
    if (typeof p.text !== 'string') return [walk(p, font, rewrite)];
    const next = rewrite(p.text, typeof p.font === 'string' ? p.font : font);
    if (typeof next === 'string') {
        p.text = next;
        return [p];
    }
    return next.map((run) => (typeof run === 'string' ? { ...p, text: run } : { ...p, ...(run as object) }));
}

type FooterFn = (currentPage: number, pageCount: number, pageSize: unknown) => Content | null | undefined;

/** Textes du document (contenu puis pied de page) ; `record` rend chaque texte tel quel. */
function collect(dd: TDocumentDefinitions, baseFont: string): Found[] {
    const found: Found[] = [];
    let title = 'Page de garde';
    const record: Rewrite = (text, base) => {
        if (base === TITLE && text.trim()) title = text.trim().slice(0, 60);
        found.push({ text, base, title });
        return text;
    };
    walk(dd.content, baseFont, record);
    if (typeof dd.footer === 'function') {
        title = 'Pied de page';
        const sample = (dd.footer as FooterFn)(2, 2, { width: 0, height: 0, orientation: 'landscape' });
        if (sample) walk(sample, baseFont, record);
    }
    return found;
}

function covered(text: string, has: HasGlyph): boolean {
    for (const ch of text) if (!has(ch.codePointAt(0) ?? 0)) return false;
    return true;
}

/** Nouvelle valeur d'un texte : remplacé, puis découpé en segments d'une police. */
function segment(text: string, base: string, chain: FontCandidate[], used: Set<string>): string | Content[] {
    const clean = replaceUnsupported(text, chain);
    const runs = splitFontRuns(clean, chain);
    if (runs.every((r) => r.fontId === base || r.fontId === null)) return clean;
    return runs.map((r): Content => {
        const t = r.rtl ? r.text.replace(/ /g, '\u00a0') : r.text;
        if (r.fontId === base || r.fontId === null) return t;
        used.add(r.fontId);
        // Titre : Noto Sans en gras, plus proche de la graisse d'Oswald Medium.
        return base === TITLE && r.fontId === NOTO ? { text: t, font: r.fontId, bold: true } : { text: t, font: r.fontId };
    });
}

/**
 * Passe complète (voir l'en-tête). Modifie `dd` en place ; lève
 * `OiScriptsCancelledError` si l'utilisateur choisit de corriger la saisie.
 */
export async function applyOiScriptFallback(dd: TDocumentDefinitions, pdfMake: PdfMakeFontRegistry): Promise<void> {
    const baseFont = (dd.defaultStyle?.font as string | undefined) ?? BODY;
    // Seules les deux polices de l'OI ont une couverture connue ; un texte posé
    // dans une autre police est laissé tel quel.
    const ours = (font: string): boolean => font === BODY || font === TITLE;
    const found = collect(dd, baseFont).filter((f) => ours(f.base));
    if (found.every((f) => SAFE_TEXT.test(f.text))) return;

    const base = await loadBaseTesters();
    if (found.every((f) => covered(f.text, f.base === TITLE ? base.title : base.body))) return;

    const { chains, vfs } = await loadFullChains();
    const chainOf = (font: string): FontCandidate[] => (font === TITLE ? chains.title : chains.body);

    // 1. Avertissement AVANT la génération : un texte = une ligne.
    const issues: UnsupportedChars[] = [];
    const seen = new Set<string>();
    for (const f of found) {
        const chars = findUnsupported(f.text, chainOf(f.base));
        if (chars.length === 0 || seen.has(f.text)) continue;
        seen.add(f.text);
        const excerpt = f.text.length > 40 ? `${f.text.slice(0, 40)}…` : f.text;
        issues.push({ where: `${f.title} — « ${excerpt} »`, chars });
    }
    const key = JSON.stringify(issues.map((i) => i.chars.join('')).sort());
    if (issues.length > 0 && key !== acceptedKey) {
        const { confirmUnsupportedChars } = await import('@shared/pdf-unsupported-dialog.js');
        if (!(await confirmUnsupportedChars(issues))) throw new OiScriptsCancelledError();
        acceptedKey = key;
    }

    // 2. Remplacement et découpage, contenu puis pied de page.
    const used = new Set<string>();
    const rewrite: Rewrite = (text, font) => (SAFE_TEXT.test(text) || !ours(font) ? text : segment(text, font, chainOf(font), used));
    dd.content = walk(dd.content, baseFont, rewrite) as Content;
    if (typeof dd.footer === 'function') {
        const footer = dd.footer as FooterFn;
        dd.footer = ((page: number, count: number, size: unknown) => {
            const c = footer(page, count, size);
            return c ? walk(c, baseFont, rewrite) : c;
        }) as TDocumentDefinitions['footer'];
        // Le pied n'est composé qu'au rendu : ses polices sont prévues d'avance.
        walk(footer(2, 2, { width: 0, height: 0, orientation: 'landscape' }) ?? '', baseFont, rewrite);
    }

    // 3. Polices de repli, seulement celles qui servent.
    if (used.has(NOTO)) {
        pdfMake.addVirtualFileSystem({ 'NotoSans-400.ttf': vfs['NotoSans-400.ttf']!, 'NotoSans-700.ttf': vfs['NotoSans-700.ttf']! });
        pdfMake.addFonts({ [NOTO]: { normal: 'NotoSans-400.ttf', bold: 'NotoSans-700.ttf', italics: 'NotoSans-400.ttf', bolditalics: 'NotoSans-700.ttf' } });
    }
    if (used.has(ARABIC)) {
        const file = 'NotoSansArabic-400.ttf';
        pdfMake.addVirtualFileSystem({ [file]: vfs[file]! });
        pdfMake.addFonts({ [ARABIC]: { normal: file, bold: file, italics: file, bolditalics: file } });
    }
}
