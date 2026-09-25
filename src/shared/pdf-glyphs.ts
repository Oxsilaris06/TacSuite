/**
 * pdf-glyphs.ts — Écritures non latines dans les PDF (décision 44, audit PDF
 * du 2026-09-25).
 *
 * Aucune police ne couvre tout : le corps du texte est en JetBrains Mono NL
 * (ou Noto Sans pour la synthèse A3), avec une CHAÎNE DE REPLI (Noto Sans pour
 * le grec et le cyrillique des titres, Noto Sans Arabic pour l'arabe). Ce
 * module, pur et sans moteur PDF, découpe un texte en segments dessinables
 * chacun avec une seule police.
 *
 * Bidi minimal : fontkit (pdf-lib comme pdfmake) remet de lui-même un segment
 * arabe dans l'ordre visuel, à condition que le passage arabe arrive d'un
 * seul tenant. Les espaces et la ponctuation PRIS ENTRE deux lettres arabes
 * restent donc dans le segment arabe ; ailleurs, ils suivent le sens de la
 * ligne (gauche à droite).
 *
 * Ce qu'aucune police ne couvre (chinois, émoji…) est signalé AVANT la
 * génération (`findUnsupported`), puis remplacé (`replaceUnsupported`) :
 * émoji retirés, le reste en « ? ».
 */

export type HasGlyph = (codePoint: number) => boolean;

export interface FontCandidate {
    id: string;
    has: HasGlyph;
}

export interface TextRun {
    text: string;
    /** Police du segment, `null` si aucune police de la chaîne ne le couvre. */
    fontId: string | null;
    /** Segment de droite à gauche (arabe, hébreu). */
    rtl: boolean;
}

const STRONG = /[\p{L}\p{M}]/u;
const WHITESPACE = /\s/u;
const EMOJI_SEQUENCE = /\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

export function isRtlCodePoint(cp: number): boolean {
    return (cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
}

function codePoint(ch: string): number {
    return ch.codePointAt(0) ?? 0;
}

function firstCovering(cp: number, chain: readonly FontCandidate[]): string | null {
    for (const f of chain) if (f.has(cp)) return f.id;
    return null;
}

function covers(fontId: string | null, cp: number, chain: readonly FontCandidate[]): boolean {
    if (fontId === null) return false;
    return chain.find((f) => f.id === fontId)?.has(cp) ?? false;
}

interface Resolved { ch: string; fontId: string | null; rtl: boolean }

export function splitFontRuns(text: string, chain: readonly FontCandidate[]): TextRun[] {
    if (!text) return [];
    const chars = Array.from(text);
    const cps = chars.map(codePoint);
    // Chemin rapide : la première police couvre tout (cas du texte latin).
    const first = chain[0];
    if (first && cps.every((cp) => first.has(cp) && !isRtlCodePoint(cp))) {
        return [{ text, fontId: first.id, rtl: false }];
    }
    const strong = chars.map((ch) => STRONG.test(ch));
    const resolved: (Resolved | null)[] = chars.map((ch, i) => (strong[i]
        ? { ch, fontId: firstCovering(cps[i]!, chain), rtl: isRtlCodePoint(cps[i]!) }
        : null)); // neutre : résolu au second passage

    // Lettres fortes voisines de chaque position, en deux passes linéaires.
    const prevStrong: (Resolved | null)[] = new Array(chars.length).fill(null);
    const nextStrong: (Resolved | null)[] = new Array(chars.length).fill(null);
    for (let i = 1; i < chars.length; i++) prevStrong[i] = strong[i - 1] ? resolved[i - 1]! : prevStrong[i - 1]!;
    for (let i = chars.length - 2; i >= 0; i--) nextStrong[i] = strong[i + 1] ? resolved[i + 1]! : nextStrong[i + 1]!;

    // Second passage : les neutres (espaces, ponctuation, chiffres, symboles).
    for (let i = 0; i < chars.length; i++) {
        if (resolved[i]) continue;
        const ch = chars[i]!;
        const cp = cps[i]!;
        const prev = prevStrong[i] ?? null;
        const next = nextStrong[i] ?? null;
        if (prev?.rtl && next?.rtl && covers(prev.fontId, cp, chain)) {
            resolved[i] = { ch, fontId: prev.fontId, rtl: true };
            continue;
        }
        const ltrPrev = prev && !prev.rtl ? prev.fontId : null;
        const ltrNext = next && !next.rtl ? next.fontId : null;
        const fontId = covers(ltrPrev, cp, chain) ? ltrPrev
            : covers(ltrNext, cp, chain) ? ltrNext
                : firstCovering(cp, chain);
        resolved[i] = { ch, fontId, rtl: false };
    }

    const runs: TextRun[] = [];
    for (const r of resolved as Resolved[]) {
        const last = runs[runs.length - 1];
        if (last && last.fontId === r.fontId && last.rtl === r.rtl) last.text += r.ch;
        else runs.push({ text: r.ch, fontId: r.fontId, rtl: r.rtl });
    }
    return runs;
}

/** Caractères qu'aucune police de la chaîne ne couvre (une fois chacun, dans l'ordre). */
export function findUnsupported(text: string, chain: readonly FontCandidate[]): string[] {
    const out: string[] = [];
    for (const ch of Array.from(text)) {
        const cp = codePoint(ch);
        if (cp < 0x20 || WHITESPACE.test(ch) || cp === 0x200d || cp === 0xfe0f) continue;
        if (firstCovering(cp, chain) === null && !out.includes(ch)) out.push(ch);
    }
    return out;
}

/** Retire les émoji et remplace tout autre caractère sans police par « ? ». */
export function replaceUnsupported(text: string, chain: readonly FontCandidate[]): string {
    const sansEmoji = text.replace(EMOJI_SEQUENCE, '').replace(/[\u200D\uFE0F]/gu, '');
    let out = '';
    for (const ch of Array.from(sansEmoji)) {
        const cp = codePoint(ch);
        out += cp < 0x20 || WHITESPACE.test(ch) || firstCovering(cp, chain) !== null ? ch : '?';
    }
    return out;
}
