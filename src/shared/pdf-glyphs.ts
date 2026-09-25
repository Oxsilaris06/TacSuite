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
const EMOJI_SEQUENCE = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/gu;

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
    const chars = Array.from(text);
    const resolved: (Resolved | null)[] = chars.map((ch) => {
        if (!STRONG.test(ch)) return null; // neutre : résolu au second passage
        const cp = codePoint(ch);
        return { ch, fontId: firstCovering(cp, chain), rtl: isRtlCodePoint(cp) };
    });

    // Second passage : les neutres (espaces, ponctuation, chiffres, symboles).
    for (let i = 0; i < chars.length; i++) {
        if (resolved[i]) continue;
        const ch = chars[i]!;
        const cp = codePoint(ch);
        let prev: Resolved | null = null;
        for (let j = i - 1; j >= 0 && !prev; j--) if (resolved[j] && STRONG.test(chars[j]!)) prev = resolved[j]!;
        let next: Resolved | null = null;
        for (let j = i + 1; j < chars.length && !next; j++) if (resolved[j] && STRONG.test(chars[j]!)) next = resolved[j]!;

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
    const sansEmoji = text.replace(EMOJI_SEQUENCE, '').replace(/[‍️]/gu, '');
    let out = '';
    for (const ch of Array.from(sansEmoji)) {
        const cp = codePoint(ch);
        out += cp < 0x20 || WHITESPACE.test(ch) || firstCovering(cp, chain) !== null ? ch : '?';
    }
    return out;
}
