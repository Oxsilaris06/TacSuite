/**
 * pdf-a3-layout.ts — Moteur de placement de la synthèse PC-Tac sur UNE page
 * A3 paysage (décision 41). Fonction PURE : aucune dépendance au moteur PDF ;
 * la mesure du texte est injectée (`A3Measure`, en points) pour que les tests
 * tournent sans police et que le dessin mesure avec la vraie chaîne de polices.
 *
 * Unités : millimètres, origine en HAUT à gauche de la feuille (420 × 297).
 *
 * Maquette (prototype mesuré de l'audit du 2026-09-25) :
 *  - bandeau d'en-tête 13 mm, pied 5 mm, marges 8 mm ;
 *  - colonne A (175 mm) : plan puis photos, si l'un existe ;
 *  - colonne B : adversaires puis otages/victimes, partage calculé pour
 *    maximiser le plus petit corps ;
 *  - colonne C : faits marquants, points du plan, forces amies.
 *
 * « Jamais dépasser » : chaque zone est placée par mesure, avec des paliers de
 * corps de 10 à 5,5 pt (le plus grand qui tient). Quand même 5,5 pt ne
 * suffit pas, RÉDUCTION GRADUÉE ANNONCÉE (un bandeau rouge liste ce qui a été
 * réduit), zone par zone :
 *  1. fiches ramenées à leurs 3 faits clés ;
 *  2. photos en vignettes carrées (18 à 12 mm, sans légende) ;
 *  3. faits marquants : les plus récents, le nombre d'antérieurs annoncé.
 * Refus explicite (`refused`, raisons en clair) seulement au-delà.
 */

export const A3_PAGE = { width: 420, height: 297, margin: 8 } as const;

const PT_PER_MM = 72 / 25.4;
const HEAD_H = 13;
const FOOT_H = 5;
const GAP = 4;
const COL_GAP = 3;
const BANNER_H = 5;
const A_WIDTH = 175;
const TIERS = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5] as const;
const PHOTO_MIN_H = 18;
const SQUARE_MAX = 18;
const SQUARE_MIN = 12;
const CAPTION_H = 2.6;
const ROW_GAP = 1.5;
const PHOTO_GAP = 2;
/** Ligne sous le plan : attributions, échelle, nord. */
export const PLAN_CAPTION_H = 3;

export interface A3Badge { text: string; color: string }

export interface A3Fiche {
    title: string;
    badge?: A3Badge | null;
    /** Toutes les sections remplies, en une chaîne. */
    full: string;
    /** Les 3 faits clés (réduction de premier niveau). */
    short: string;
}

export interface A3Input {
    plan: { widthPx: number; heightPx: number } | null;
    photos: { id: string; widthPx: number; heightPx: number; title: string }[];
    adv: { header: string; fiches: A3Fiche[] };
    host: { header: string; fiches: A3Fiche[] };
    /** Faits marquants, dans l'ordre chronologique (le plus ancien d'abord). */
    faits: { header: string; legend?: string; entries: string[] };
    points: { header: string; items: string[] };
    amis: { header: string; items: string[] };
}

/** Largeur en points d'un texte, au corps donné, en gras ou non. */
export type A3Measure = (text: string, bold: boolean, sizePt: number) => number;

export interface A3Box { x: number; y: number; w: number; h: number }

export interface A3Line { text: string; bold: boolean; badge?: A3Badge | undefined }

export interface A3TextBox extends A3Box {
    zone: 'adv' | 'host' | 'faits';
    size: number;
    lines: A3Line[];
}

export interface A3PhotoPlacement {
    id: string;
    title: string;
    box: A3Box;
    square: boolean;
    /** Haut de la légende, `null` en vignettes carrées (pas de légende). */
    captionY: number | null;
}

export interface A3Layout {
    header: A3Box;
    footer: A3Box;
    banner: A3Box | null;
    plan: A3Box | null;
    photos: A3PhotoPlacement[];
    textBoxes: A3TextBox[];
    /** Réductions appliquées, en clair (contenu du bandeau rouge). */
    reductions: string[];
    /** Raisons du refus, `null` si la page est produite. */
    refused: string[] | null;
}

/** Interligne en points pour un corps donné. */
export const lineHeightPt = (size: number): number => size * 1.18;

interface Block { title?: string | undefined; badge?: A3Badge | null | undefined; body?: string | undefined }

/** Coupe au mot, et coupe DURE d'un mot plus large que la colonne. */
function wrap(text: string, bold: boolean, size: number, widthPt: number, measure: A3Measure): string[] {
    const out: string[] = [];
    for (const para of text.split(/\r?\n/)) {
        let line = '';
        for (const w of para.split(' ')) {
            let word = w;
            while (word && measure(word, bold, size) > widthPt) {
                let lo = 1, hi = word.length;
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    if (measure(word.slice(0, mid), bold, size) <= widthPt) lo = mid; else hi = mid - 1;
                }
                if (line) { out.push(line); line = ''; }
                out.push(word.slice(0, lo));
                word = word.slice(lo);
            }
            const t = line ? `${line} ${word}` : word;
            if (measure(t, bold, size) <= widthPt) line = t;
            else { out.push(line); line = word; }
        }
        if (line) out.push(line);
    }
    return out;
}

function blockLines(b: Block, size: number, widthPt: number, measure: A3Measure): A3Line[] {
    const lines: A3Line[] = [];
    if (b.title) {
        const badgeW = b.badge ? measure(b.badge.text, true, size) + 4 : 0;
        wrap(b.title, true, size, widthPt - badgeW, measure).forEach((t, i) => {
            lines.push({ text: t, bold: true, ...(i === 0 && b.badge ? { badge: b.badge } : {}) });
        });
    }
    if (b.body) for (const t of wrap(b.body, false, size, widthPt, measure)) lines.push({ text: t, bold: false });
    return lines;
}

/** Écoulement « journal » d'une liste de blocs dans une zone ; null si ça ne tient pas. */
function flow(blocks: readonly Block[], zone: A3Box, zoneName: A3TextBox['zone'], size: number, cols: number, measure: A3Measure): A3TextBox[] | null {
    const colW = (zone.w - (cols - 1) * COL_GAP) / cols;
    const hMax = zone.h * PT_PER_MM;
    const lineH = lineHeightPt(size);
    const padB = size * 0.6;
    const placed: A3TextBox[] = [];
    let col = 0;
    let y = 0;
    for (const b of blocks) {
        let lines = blockLines(b, size, colW * PT_PER_MM, measure);
        const need = lines.length * lineH;
        // Un bloc qui tient dans une colonne n'est pas coupé.
        if (y > 0 && y + need > hMax && need <= hMax) { col++; y = 0; }
        while (lines.length) {
            if (col >= cols) return null;
            const room = Math.floor((hMax - y) / lineH);
            if (room < 2) { col++; y = 0; continue; }
            const take = lines.slice(0, room);
            lines = lines.slice(room);
            placed.push({ zone: zoneName, x: zone.x + col * (colW + COL_GAP), y: zone.y + y / PT_PER_MM, w: colW, h: (take.length * lineH) / PT_PER_MM, size, lines: take });
            y += take.length * lineH + padB;
            if (lines.length) {
                col++;
                y = 0;
                const cont = b.title ? `${b.title} (suite)` : '(suite)';
                lines = [...wrap(cont, true, size, colW * PT_PER_MM, measure).map((t) => ({ text: t, bold: true })), ...lines];
            }
        }
    }
    return placed;
}

function fitFlow(blocks: readonly Block[], zone: A3Box, zoneName: A3TextBox['zone'], colOptions: readonly number[], measure: A3Measure): A3TextBox[] | null {
    if (zone.h <= 0 || zone.w <= 0) return null;
    for (const size of TIERS) for (const cols of colOptions) {
        const placed = flow(blocks, zone, zoneName, size, cols, measure);
        if (placed) return placed;
    }
    return null;
}

type PhotoIn = A3Input['photos'][number];
const ratioOf = (p: { widthPx: number; heightPx: number }): number => {
    const r = p.widthPx / p.heightPx;
    return Number.isFinite(r) && r > 0 ? r : 4 / 3;
};

/** Rangées justifiées, ratio conservé, sans recadrage, à la hauteur `h` ; null si ça déborde. */
function justifiedRows(photos: readonly PhotoIn[], zone: A3Box, h: number): A3PhotoPlacement[] | null {
    const out: A3PhotoPlacement[] = [];
    let row: PhotoIn[] = [];
    let sum = 0;
    let y = 0;
    const flush = (last: boolean): boolean => {
        if (!row.length) return true;
        const gaps = (row.length - 1) * PHOTO_GAP;
        let rh = (zone.w - gaps) / sum;
        if (last && rh > h) rh = h; // dernière rangée jamais étirée
        if (y + rh + CAPTION_H > zone.h + 1e-6) return false;
        let x = zone.x;
        for (const p of row) {
            const w = ratioOf(p) * rh;
            out.push({ id: p.id, title: p.title, box: { x, y: zone.y + y, w, h: rh }, square: false, captionY: zone.y + y + rh + 0.4 });
            x += w + PHOTO_GAP;
        }
        y += rh + CAPTION_H + ROW_GAP;
        row = [];
        sum = 0;
        return true;
    };
    for (const p of photos) {
        row.push(p);
        sum += ratioOf(p);
        if (sum * h + (row.length - 1) * PHOTO_GAP >= zone.w && !flush(false)) return null;
    }
    return flush(true) ? out : null;
}

function squareGrid(photos: readonly PhotoIn[], zone: A3Box, s: number): A3PhotoPlacement[] | null {
    const cols = Math.floor((zone.w + PHOTO_GAP) / (s + PHOTO_GAP));
    if (cols < 1) return null;
    const rows = Math.ceil(photos.length / cols);
    if (rows * (s + ROW_GAP) - ROW_GAP > zone.h + 1e-6) return null;
    return photos.map((p, i) => ({
        id: p.id, title: p.title, square: true, captionY: null,
        box: { x: zone.x + (i % cols) * (s + PHOTO_GAP), y: zone.y + Math.floor(i / cols) * (s + ROW_GAP), w: s, h: s },
    }));
}

/** Plus grande valeur de [lo, hi] pour laquelle `ok` tient (dichotomie, 30 pas). */
function largest(lo: number, hi: number, ok: (v: number) => boolean): number | null {
    if (!ok(lo)) return null;
    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid; else hi = mid;
    }
    return lo;
}

function placePhotos(photos: readonly PhotoIn[], zone: A3Box, squares: boolean): A3PhotoPlacement[] | null {
    if (!photos.length) return [];
    if (zone.h <= 0) return null;
    if (!squares) {
        const h = largest(PHOTO_MIN_H, Math.max(PHOTO_MIN_H, zone.h - CAPTION_H), (v) => justifiedRows(photos, zone, v) !== null);
        return h === null ? null : justifiedRows(photos, zone, h);
    }
    const s = largest(SQUARE_MIN, SQUARE_MAX, (v) => squareGrid(photos, zone, v) !== null);
    return s === null ? null : squareGrid(photos, zone, s);
}

interface Flags { short: boolean; squares: boolean; recent: boolean }

export function layoutA3(input: A3Input, measure: A3Measure): A3Layout {
    const { width, height, margin } = A3_PAGE;
    const header: A3Box = { x: margin, y: margin, w: width - 2 * margin, h: HEAD_H };
    const footer: A3Box = { x: margin, y: height - margin - FOOT_H, w: width - 2 * margin, h: FOOT_H };
    const flags: Flags = { short: false, squares: false, recent: false };

    const attempt = (): { result: Omit<A3Layout, 'header' | 'footer' | 'refused'>; failures: { zone: keyof Flags; reason: string }[] } => {
        const withBanner = flags.short || flags.squares || flags.recent;
        let top = margin + HEAD_H + 3;
        const banner: A3Box | null = withBanner ? { x: margin, y: top, w: width - 2 * margin, h: BANNER_H } : null;
        if (banner) top += BANNER_H + 1;
        const bottom = height - margin - FOOT_H - 2;
        const bodyH = bottom - top;
        const bodyW = width - 2 * margin;
        const hasA = input.plan !== null || input.photos.length > 0;
        const hasB = input.adv.fiches.length > 0 || input.host.fiches.length > 0;
        const aW = hasA ? A_WIDTH : 0;
        const rest = bodyW - aW - (hasA ? GAP : 0);
        const bW = hasB ? Math.round(rest * 0.585) : 0;
        const cW = rest - bW - (hasB ? GAP : 0);
        const A: A3Box = { x: margin, y: top, w: aW, h: bodyH };
        const B: A3Box = { x: margin + aW + (hasA ? GAP : 0), y: top, w: bW, h: bodyH };
        const C: A3Box = { x: B.x + bW + (hasB ? GAP : 0), y: top, w: cW, h: bodyH };
        const failures: { zone: keyof Flags; reason: string }[] = [];
        const reductions: string[] = [];

        // Colonne A : plan puis photos.
        let plan: A3Box | null = null;
        let photoZone = A;
        if (input.plan) {
            const r = ratioOf(input.plan);
            const zoneH = input.photos.length ? Math.min(A.w / r, A.h * 0.55) : A.h - PLAN_CAPTION_H;
            const w = Math.min(A.w, zoneH * r);
            plan = { x: A.x, y: A.y, w, h: w / r };
            photoZone = { x: A.x, y: A.y + plan.h + PLAN_CAPTION_H + GAP, w: A.w, h: A.h - plan.h - PLAN_CAPTION_H - GAP };
        }
        const photos = placePhotos(input.photos, photoZone, flags.squares);
        if (!photos) failures.push({ zone: 'squares', reason: `photos : ${input.photos.length} ne tiennent pas, même en vignettes carrées de ${SQUARE_MIN} mm` });
        else if (flags.squares) reductions.push('Photos en vignettes carrées');

        // Colonne B : partage adversaires / otages qui maximise le plus petit corps.
        const ficheBlocks = (list: readonly A3Fiche[]): Block[] => list.map((f) => ({ title: f.title, badge: f.badge ?? null, body: flags.short ? f.short : f.full }));
        const advBlocks: Block[] = [{ title: input.adv.header }, ...ficheBlocks(input.adv.fiches)];
        const hostBlocks: Block[] = [{ title: input.host.header }, ...ficheBlocks(input.host.fiches)];
        let fiches: A3TextBox[] | null = [];
        if (hasB) {
            const nA = input.adv.fiches.length, nH = input.host.fiches.length;
            let best: { score: number; boxes: A3TextBox[] } | null = null;
            const minSize = (b: A3TextBox[]): number => (b.length ? Math.min(...b.map((x) => x.size)) : 99);
            for (let s = 0.2; s <= 0.8001; s += 0.05) {
                const hA = nA ? (nH ? B.h * s - GAP / 2 : B.h) : 0;
                const zA: A3Box = { ...B, h: hA };
                const zH: A3Box = { ...B, y: B.y + hA + (hA ? GAP : 0), h: B.h - hA - (hA ? GAP : 0) };
                const fa = nA ? fitFlow(advBlocks, zA, 'adv', [1, 2, 3], measure) : [];
                const fh = nH ? fitFlow(hostBlocks, zH, 'host', [1, 2, 3], measure) : [];
                if (fa && fh) {
                    const score = Math.min(minSize(fa), minSize(fh)) * 100 + minSize(fa) + minSize(fh);
                    if (!best || score > best.score) best = { score, boxes: [...fa, ...fh] };
                }
                if (!nA || !nH) break;
            }
            fiches = best?.boxes ?? null;
            if (!fiches) failures.push({ zone: 'short', reason: `fiches : ${nA} + ${nH} ne tiennent pas, même ramenées à leurs 3 faits clés en ${String(TIERS[TIERS.length - 1]).replace('.', ',')} pt` });
            else if (flags.short) reductions.push('Fiches ramenées à leurs 3 faits clés (fiches complètes au rapport complet)');
        }

        // Colonne C : faits marquants (les N plus récents si réduit), points, forces amies.
        const cBlocks = (n: number): Block[] => {
            const kept = input.faits.entries.slice(input.faits.entries.length - n);
            const skipped = input.faits.entries.length - n;
            return [
                { title: input.faits.header, body: input.faits.legend },
                ...(skipped > 0 ? [{ body: `+ ${skipped} antérieurs au rapport complet` }] : []),
                ...kept.map((e) => ({ body: e })),
                { title: input.points.header },
                ...input.points.items.map((i) => ({ body: i })),
                { title: input.amis.header },
                ...input.amis.items.map((i) => ({ body: i })),
            ];
        };
        const total = input.faits.entries.length;
        let faits = fitFlow(cBlocks(total), C, 'faits', [1, 2], measure);
        if (!faits && flags.recent) {
            let lo = 0, hi = total;
            if (fitFlow(cBlocks(0), C, 'faits', [1, 2], measure)) {
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    if (fitFlow(cBlocks(mid), C, 'faits', [1, 2], measure)) lo = mid; else hi = mid - 1;
                }
                faits = fitFlow(cBlocks(lo), C, 'faits', [1, 2], measure);
                reductions.push(`Faits marquants : les ${lo} plus récents (${total - lo} antérieurs au rapport complet)`);
            }
        }
        if (!faits) failures.push({ zone: 'recent', reason: `faits marquants, points et forces amies ne tiennent pas en ${String(TIERS[TIERS.length - 1]).replace('.', ',')} pt` });

        return {
            result: { banner: reductions.length ? banner : null, plan, photos: photos ?? [], textBoxes: [...(fiches ?? []), ...(faits ?? [])], reductions },
            failures,
        };
    };

    // Passes successives : une zone qui ne tient pas active SA réduction ; le
    // bandeau ainsi apparu peut en faire déborder une autre, d'où la boucle.
    for (let pass = 0; pass < 5; pass++) {
        const { result, failures } = attempt();
        const toEnable = failures.filter((f) => !flags[f.zone]);
        if (!toEnable.length) {
            if (failures.length) {
                return { header, footer, ...result, banner: result.banner, refused: failures.map((f) => f.reason) };
            }
            // Bandeau réservé mais plus aucune réduction effective : il reste
            // vide et n'est pas rendu (jamais le cas en pratique, par sûreté).
            return { header, footer, ...result, refused: null };
        }
        for (const f of toEnable) flags[f.zone] = true;
    }
    const { result, failures } = attempt();
    return { header, footer, ...result, refused: failures.length ? failures.map((f) => f.reason) : null };
}
