/**
 * pdf-a3.ts — Synthèse PC-Tac sur UNE page A3 paysage (décision 41).
 *
 * Le bouton PDF (fenêtre de génération, `kind === 'a3'`) appelle
 * `buildA3Pdf(options)` par import dynamique. Écrit par le CTO ; aucun autre
 * atelier n'y touche.
 *
 * Chaîne :
 *  1. collecte (situation courante) : fiches triées par priorité, faits
 *     marquants (entrées en favori seulement, Nico 09-26),
 *     points du plan (case + MGRS), forces amies, photos de la galerie ;
 *  2. écritures : caractères sans police annoncés AVANT la génération
 *     (`confirmUnsupportedChars`), puis remplacés ;
 *  3. placement pur (`pdf-a3-layout.ts`) mesuré avec la vraie chaîne de
 *     polices (Noto Sans pour le corps, Oswald pour le titre, Noto Sans Arabic
 *     en repli) ; réduction graduée annoncée, refus au-delà (avec l'offre du
 *     rapport complet) ;
 *  4. dessin pdf-lib, thème et sortie de la fenêtre (profils d'image), poids
 *     annoncé ; budget « Partage » tenu par une seconde passe plus compressée.
 */

import * as PDFLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDF_FONT_VFS } from '@oi/pdf/fonts.js';
import { Storage } from '@pctac/storage.js';
import { ImageStore } from '@pctac/image-store.js';
import { currentMode, currentModeId, paxChipLabel } from '@pctac/modes.js';
import { filledSections, ficheTitle, sortFichesByPriority, statusMeta, summaryRows, type FicheSide } from '@pctac/fiche.js';
import { showBusy, hideBusy, setBusyMessage } from '@pctac/busy.js';
import { Utils } from '@pctac/utils.js';
import { situationPeriod } from '@pctac/pdf-export.js';
import { capturePlanForPdf, imageSizeFromDataUrl, type PlanPrintCapture } from '@pctac/plan-capture-for-pdf.js';
import { A3_PAGE, PLAN_CAPTION_H, layoutA3, lineHeightPt, type A3Fiche, type A3Input, type A3Layout, type A3Measure } from '@pctac/pdf-a3-layout.js';
import { PDF_IMAGE_PROFILES, formatBytes, targetPixels, type PdfOptions } from '@shared/pdf-options.js';
import { EXTRA_FONT_KEYS, base64ToBytes, glyphTester, loadExtraFontVfs } from '@shared/pdf-fonts/index.js';
import { findUnsupported, replaceUnsupported, splitFontRuns, type FontCandidate } from '@shared/pdf-glyphs.js';
import { confirmUnsupportedChars, type UnsupportedChars } from '@shared/pdf-unsupported-dialog.js';
import { confirmDialog, toast } from '@shared/feedback.js';

const MM = 72 / 25.4;
const PHOTO_COLUMN_MM = 175;

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

interface Palette { bg: PDFLib.RGB | null; text: PDFLib.RGB; muted: PDFLib.RGB; line: PDFLib.RGB; danger: PDFLib.RGB; frame: PDFLib.RGB }

function palette(theme: PdfOptions['theme']): Palette {
    const { rgb } = PDFLib;
    return theme === 'sombre'
        ? { bg: rgb(0.07, 0.08, 0.09), text: rgb(0.91, 0.91, 0.91), muted: rgb(0.66, 0.66, 0.68), line: rgb(0.35, 0.35, 0.38), danger: rgb(0.97, 0.44, 0.44), frame: rgb(0.3, 0.3, 0.33) }
        : { bg: null, text: rgb(0.07, 0.07, 0.08), muted: rgb(0.33, 0.33, 0.35), line: rgb(0.6, 0.6, 0.62), danger: rgb(0.72, 0.1, 0.1), frame: rgb(0.8, 0.8, 0.82) };
}

function hexColor(hex: string, pal: Palette, theme: PdfOptions['theme']): PDFLib.RGB {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return pal.text;
    const n = parseInt(m[1]!, 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    // Un statut noir (DCD) resterait invisible sur fond sombre : couleur du texte.
    if (theme === 'sombre' && 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.25) return pal.text;
    return PDFLib.rgb(r, g, b);
}

// ─── Collecte ────────────────────────────────────────────────────────────────

interface A3Photo { id: string; title: string; dataUrl: string; widthPx: number; heightPx: number }
interface Collected {
    input: A3Input;
    photos: A3Photo[];
    missingPhotos: number;
    logCount: number;
    period: string;
    situation: string;
    /** Textes à vérifier avant génération (où, texte). */
    texts: { where: string; text: string }[];
}

function sideBlocks(side: FicheSide, items: Rec[], resolveLink: (id: string) => string, texts: Collected['texts']): A3Fiche[] {
    const modeId = currentModeId();
    const now = new Date();
    return items.map((item) => {
        const title = ficheTitle(side, modeId, item) || '(sans nom)';
        // Nom et prénom sont déjà dans le titre de la fiche.
        const full = filledSections(side, modeId, item, now, resolveLink)
            .map((s) => s.rows.filter((r) => r.label !== 'Nom' && r.label !== 'Prénom').map((r) => `${r.label} : ${r.value}`).join(' · '))
            .filter(Boolean)
            .join(' · ');
        const short = summaryRows(side, modeId, item, now).map((r) => `${r.label} : ${r.value}`).join(' · ');
        const status = str(item.status);
        const meta = status ? statusMeta(side, modeId, status) : null;
        texts.push({ where: `Fiche ${title}`, text: `${title} ${full}` });
        return { title, full, short: short || full, badge: meta ? { text: meta.label, color: meta.color } : null };
    });
}

/**
 * Points du plan : libellé, case du carroyage, MGRS (décision 41, pas de
 * décimal). Relu APRÈS la capture du plan : c'est elle qui prépare la carte
 * (et donc le carroyage) quand l'onglet Plan n'a jamais été ouvert.
 */
function collectPointItems(texts?: Collected['texts']): string[] {
    let pins: Rec[] = [];
    try {
        const planMap = (window as unknown as { PlanMap?: { getPinsSummary?: () => unknown } }).PlanMap;
        const raw = planMap?.getPinsSummary?.();
        if (Array.isArray(raw)) pins = raw.filter((p): p is Rec => !!p && typeof p === 'object');
    } catch { pins = []; }
    return pins.map((p) => {
        const item = `${str(p.label) || 'Point'} [${str(p.cell) || '-'}] ${str(p.mgrs) || 'MGRS N/C'}`;
        texts?.push({ where: `Point ${str(p.label)}`, text: item });
        return item;
    });
}

async function collect(): Promise<Collected> {
    const mode = currentMode();
    const modeId = currentModeId();
    const texts: Collected['texts'] = [];
    const logs = Storage.loadLogData();

    const adversaries = sortFichesByPriority('adv', modeId, Storage.loadCollection('pcTacAdversaries') as unknown as Rec[]);
    const hostages = sortFichesByPriority('host', modeId, Storage.loadCollection('pcTacHostages') as unknown as Rec[]);
    const byId = new Map(adversaries.map((a) => [str(a.id), ficheTitle('adv', modeId, a)]));
    const resolveLink = (id: string): string => byId.get(id) ?? id;

    // Faits marquants : entrées en favori SEULEMENT (Nico, 09-26, modifie la
    // décision 41). Une entrée automatique n'y figure que si on l'a étoilée.
    const faitsLogs = logs.filter((e) => e.favori);
    const faits = faitsLogs.map((e) => {
        const [y, m, d] = str(e.date).split('-');
        const when = `${d && m && y ? `${d}/${m} ` : ''}${str(e.heure)}`;
        // Entrée automatique étoilée : « Carte » pour un point du plan, sinon
        // « Statut » (changement de statut d'une fiche).
        const who = e.auto ? (str(e.pax) === 'Carte' ? 'Carte' : 'Statut') : paxChipLabel(str(e.pax), mode);
        const line = `${when} ${who} — ${str(e.lieu) ? `${str(e.lieu)} — ` : ''}${str(e.remarques)}`;
        texts.push({ where: `Main courante ${str(e.heure)}`, text: line });
        return line;
    });

    const points = collectPointItems(texts);

    const friends = Storage.loadCollection('pcTacFriends') as unknown as Rec[];
    const amis = friends.map((f) => {
        const item = [`${str(f.nom)} ${str(f.prenom)}`.trim(), str(f.unite) ? `(${str(f.unite)})` : '', str(f.mission), str(f.tph)].filter(Boolean).join(' ');
        texts.push({ where: `Forces amies ${str(f.nom)}`, text: item });
        return item;
    });

    const gallery = await ImageStore.hydrate(Storage.loadCollection('pcTacPhotos'), 'data') as unknown as Rec[];
    const photos: A3Photo[] = [];
    let missingPhotos = 0;
    for (const p of gallery) {
        const dataUrl = str(p.data);
        const size = dataUrl.startsWith('data:image/') ? imageSizeFromDataUrl(dataUrl) : null;
        if (!size) { missingPhotos++; continue; }
        const title = str(p.title) || str(p.category) || 'Photo';
        texts.push({ where: `Photo ${title}`, text: title });
        photos.push({ id: str(p.id) || `photo-${photos.length}`, title, dataUrl, ...size });
    }

    const advBlocks = sideBlocks('adv', adversaries, resolveLink, texts);
    const hostBlocks = sideBlocks('host', hostages, resolveLink, texts);
    return {
        input: {
            plan: null,
            photos: photos.map(({ id, title, widthPx, heightPx }) => ({ id, title, widthPx, heightPx })),
            adv: { header: `${mode.adv.plural.toUpperCase()} (${adversaries.length})`, fiches: advBlocks },
            host: { header: `${mode.host.plural.toUpperCase()} (${hostages.length})`, fiches: hostBlocks },
            faits: { header: `FAITS MARQUANTS (${faits.length})`, legend: '(entrées marquées d’une étoile dans la main courante)', entries: faits },
            points: { header: `POINTS DU PLAN (${points.length})`, items: points },
            amis: { header: `FORCES AMIES (${amis.length})`, items: amis },
        },
        photos, missingPhotos,
        logCount: logs.length,
        period: situationPeriod(logs),
        situation: mode.label,
        texts,
    };
}

// ─── Polices et mesure ───────────────────────────────────────────────────────

interface FontSet {
    body: PDFLib.PDFFont; bold: PDFLib.PDFFont; title: PDFLib.PDFFont; arabic: PDFLib.PDFFont | null;
    bodyChain: FontCandidate[]; boldChain: FontCandidate[]; titleChain: FontCandidate[];
    byId: Record<string, PDFLib.PDFFont>;
}

interface FontBytes { body: Uint8Array; bold: Uint8Array; title: Uint8Array; arabic: Uint8Array; mono: Uint8Array; monoBold: Uint8Array }

async function loadFontBytes(): Promise<FontBytes> {
    const extra = await loadExtraFontVfs();
    return {
        body: base64ToBytes(extra[EXTRA_FONT_KEYS.notoRegular]!),
        bold: base64ToBytes(extra[EXTRA_FONT_KEYS.notoBold]!),
        title: base64ToBytes(PDF_FONT_VFS['Oswald-500.ttf']!),
        arabic: base64ToBytes(extra[EXTRA_FONT_KEYS.notoArabic]!),
        // Dernier repli : symboles que Noto Sans n'a pas (→ ● ■ ▲ ✕).
        mono: base64ToBytes(PDF_FONT_VFS['JetBrainsMono-400.ttf']!),
        monoBold: base64ToBytes(PDF_FONT_VFS['JetBrainsMono-700.ttf']!),
    };
}

const chainCache = new WeakMap<FontBytes, Pick<FontSet, 'bodyChain' | 'boldChain' | 'titleChain'>>();

function chains(bytes: FontBytes): Pick<FontSet, 'bodyChain' | 'boldChain' | 'titleChain'> {
    const cached = chainCache.get(bytes);
    if (cached) return cached;
    const has = {
        body: glyphTester(bytes.body), bold: glyphTester(bytes.bold), title: glyphTester(bytes.title),
        arabic: glyphTester(bytes.arabic), mono: glyphTester(bytes.mono), monoBold: glyphTester(bytes.monoBold),
    };
    const result = {
        bodyChain: [{ id: 'body', has: has.body }, { id: 'arabic', has: has.arabic }, { id: 'mono', has: has.mono }],
        boldChain: [{ id: 'bold', has: has.bold }, { id: 'arabic', has: has.arabic }, { id: 'monoBold', has: has.monoBold }],
        titleChain: [{ id: 'title', has: has.title }, { id: 'bold', has: has.bold }, { id: 'arabic', has: has.arabic }, { id: 'monoBold', has: has.monoBold }],
    };
    chainCache.set(bytes, result);
    return result;
}

async function embedFonts(doc: PDFLib.PDFDocument, bytes: FontBytes, needArabic: boolean): Promise<FontSet> {
    doc.registerFontkit(fontkit);
    const body = await doc.embedFont(bytes.body, { subset: true });
    const bold = await doc.embedFont(bytes.bold, { subset: true });
    const title = await doc.embedFont(bytes.title, { subset: true });
    const arabic = needArabic ? await doc.embedFont(bytes.arabic, { subset: true }) : null;
    const mono = await doc.embedFont(bytes.mono, { subset: true });
    const monoBold = await doc.embedFont(bytes.monoBold, { subset: true });
    const byId: Record<string, PDFLib.PDFFont> = { body, bold, title, mono, monoBold, ...(arabic ? { arabic } : {}) };
    return { body, bold, title, arabic, byId, ...chains(bytes) };
}

function runsOf(text: string, chain: readonly FontCandidate[], fonts: FontSet): { text: string; font: PDFLib.PDFFont }[] {
    return splitFontRuns(text, chain)
        .map((r) => ({ text: r.text, font: r.fontId ? fonts.byId[r.fontId] : undefined }))
        .filter((r): r is { text: string; font: PDFLib.PDFFont } => r.font !== undefined);
}

const widthCache = new WeakMap<FontSet, Map<string, number>>();

/** Largeur en points, mémorisée : le placement mesure les mêmes mots des milliers de fois. */
function widthOf(text: string, chain: readonly FontCandidate[], fonts: FontSet, size: number): number {
    let cache = widthCache.get(fonts);
    if (!cache) { cache = new Map(); widthCache.set(fonts, cache); }
    const key = `${chain[0]?.id ?? ''}|${size}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const w = runsOf(text, chain, fonts).reduce((sum, r) => sum + r.font.widthOfTextAtSize(r.text, size), 0);
    cache.set(key, w);
    return w;
}

function drawRuns(page: PDFLib.PDFPage, text: string, x: number, y: number, size: number, chain: readonly FontCandidate[], fonts: FontSet, color: PDFLib.RGB): void {
    let cx = x;
    for (const r of runsOf(text, chain, fonts)) {
        page.drawText(r.text, { x: cx, y, size, font: r.font, color });
        cx += r.font.widthOfTextAtSize(r.text, size);
    }
}

/** Réduit un texte d'une seule ligne à une largeur (corps puis coupe avec « … »). */
function fitLine(text: string, chain: readonly FontCandidate[], fonts: FontSet, size: number, maxPt: number, minSize = size): { text: string; size: number } {
    let s = size;
    while (s > minSize && widthOf(text, chain, fonts, s) > maxPt) s -= 0.25;
    if (widthOf(text, chain, fonts, s) <= maxPt) return { text, size: s };
    let t = text;
    while (t.length > 1 && widthOf(`${t}…`, chain, fonts, s) > maxPt) t = t.slice(0, -1);
    return { text: `${t.trimEnd()}…`, size: s };
}

// ─── Images ──────────────────────────────────────────────────────────────────

/**
 * Ré-encode une image à la définition du profil pour sa taille imprimée
 * (JPEG sur fond blanc, recadrée au carré pour une vignette). Sans canvas
 * (tests), les octets d'origine sont gardés.
 */
async function prepareImage(dataUrl: string, printedWmm: number, printedHmm: number, maxPpi: number, quality: number, square: boolean): Promise<{ bytes: Uint8Array; png: boolean }> {
    const original = (): { bytes: Uint8Array; png: boolean } => {
        const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { bytes, png: bytes[0] === 0x89 };
    };
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return original();
    try {
        const img = new Image();
        await new Promise<void>((res, rej) => {
            const t = setTimeout(() => rej(new Error('timeout')), 10_000);
            img.onload = () => { clearTimeout(t); res(); };
            img.onerror = () => { clearTimeout(t); rej(new Error('décodage')); };
            img.src = dataUrl;
        });
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        if (square) { const side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = side; sh = side; }
        const wantW = Math.ceil((printedWmm / 25.4) * maxPpi);
        const wantH = Math.ceil((printedHmm / 25.4) * maxPpi);
        const scale = Math.min(1, wantW / sw, wantH / sh);
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL('image/jpeg', quality);
        if (!out.startsWith('data:image/jpeg')) return original();
        const bin = atob(out.slice(out.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { bytes, png: false };
    } catch {
        return original();
    }
}

// ─── Dessin ──────────────────────────────────────────────────────────────────

interface RenderContext {
    collected: Collected;
    layout: A3Layout;
    plan: PlanPrintCapture | null;
    planRequested: boolean;
    options: PdfOptions;
    fontBytes: FontBytes;
    needArabic: boolean;
    /** Facteur appliqué au profil (seconde passe « Partage » plus compressée). */
    squeeze: number;
}

async function render(ctx: RenderContext): Promise<Uint8Array> {
    const { collected, layout, plan, options } = ctx;
    const doc = await PDFLib.PDFDocument.create();
    const fonts = await embedFonts(doc, ctx.fontBytes, ctx.needArabic);
    const pal = palette(options.theme);
    const profile = PDF_IMAGE_PROFILES[options.sortie];
    const maxPpi = Math.round(profile.maxPpi * ctx.squeeze);
    const quality = Math.max(0.5, profile.jpegQuality * ctx.squeeze);
    const page = doc.addPage([A3_PAGE.width * MM, A3_PAGE.height * MM]);
    const Y = (mm: number): number => (A3_PAGE.height - mm) * MM;
    if (pal.bg) page.drawRectangle({ x: 0, y: 0, width: A3_PAGE.width * MM, height: A3_PAGE.height * MM, color: pal.bg });

    // En-tête : titre, diffusion, sous-titre.
    const h = layout.header;
    const dr = 'DIFFUSION RESTREINTE';
    const drW = widthOf(dr, fonts.boldChain, fonts, 10);
    page.drawText(dr, { x: (h.x + h.w) * MM - drW, y: Y(h.y + 5.5), size: 10, font: fonts.bold, color: pal.danger });
    const title = fitLine(`PC-TAC · SYNTHÈSE · ${collected.situation.toUpperCase()}`, fonts.titleChain, fonts, 16, h.w * MM - drW - 20, 11);
    drawRuns(page, title.text, h.x * MM, Y(h.y + 6.2), title.size, fonts.titleChain, fonts, pal.text);
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const mode = currentMode();
    const sub = [
        `Période : ${collected.period}`,
        `Main courante : ${collected.logCount} entrées`,
        `${mode.adv.plural} : ${collected.input.adv.fiches.length}`,
        `${mode.host.plural} : ${collected.input.host.fiches.length}`,
        `Photos : ${collected.photos.length}${collected.missingPhotos ? ` (${collected.missingPhotos} ${collected.missingPhotos > 1 ? 'absentes' : 'absente'} de l'appareil)` : ''}`,
        ctx.planRequested && !plan ? 'Plan indisponible au moment de l\'export' : '',
        `Exporté le ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} à ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    ].filter(Boolean).join(' · ');
    const subLine = fitLine(sub, fonts.bodyChain, fonts, 7, h.w * MM, 5.5);
    drawRuns(page, subLine.text, h.x * MM, Y(h.y + 11), subLine.size, fonts.bodyChain, fonts, pal.muted);
    page.drawLine({ start: { x: h.x * MM, y: Y(h.y + h.h) }, end: { x: (h.x + h.w) * MM, y: Y(h.y + h.h) }, thickness: 0.6, color: pal.line });

    // Bandeau rouge des réductions appliquées.
    if (layout.banner) {
        const b = layout.banner;
        page.drawRectangle({ x: b.x * MM, y: Y(b.y + b.h), width: b.w * MM, height: b.h * MM, borderColor: pal.danger, borderWidth: 0.8 });
        const msg = fitLine(`Synthèse réduite pour tenir sur une page : ${layout.reductions.join(' ; ')}.`, fonts.boldChain, fonts, 7.5, (b.w - 4) * MM, 5.5);
        drawRuns(page, msg.text, (b.x + 2) * MM, Y(b.y + b.h / 2 + 1), msg.size, fonts.boldChain, fonts, pal.danger);
    }

    // Plan et sa ligne d'attributions.
    if (layout.plan && plan) {
        const img = await prepareImage(plan.dataUrl, layout.plan.w, layout.plan.h, maxPpi, quality, false);
        const pdfImg = img.png ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
        const p = layout.plan;
        page.drawImage(pdfImg, { x: p.x * MM, y: Y(p.y + p.h), width: p.w * MM, height: p.h * MM });
        page.drawRectangle({ x: p.x * MM, y: Y(p.y + p.h), width: p.w * MM, height: p.h * MM, borderColor: pal.frame, borderWidth: 0.5 });
        const bearing = Math.round(((plan.bearingDeg % 360) + 360) % 360);
        const caption = [
            plan.attribution || '© OpenStreetMap',
            plan.scaleText ? `Échelle ${plan.scaleText}` : '',
            bearing ? `Carte tournée de ${bearing}° : nord NON en haut` : 'Nord en haut',
        ].filter(Boolean).join(' · ');
        const cap = fitLine(caption, fonts.bodyChain, fonts, 5.5, p.w * MM, 4.5);
        drawRuns(page, cap.text, p.x * MM, Y(p.y + p.h + PLAN_CAPTION_H - 0.8), cap.size, fonts.bodyChain, fonts, bearing ? pal.danger : pal.muted);
    }

    // Photos.
    const photoById = new Map(collected.photos.map((p) => [p.id, p]));
    for (const place of layout.photos) {
        const src = photoById.get(place.id);
        if (!src) continue;
        const b = place.box;
        try {
            const img = await prepareImage(src.dataUrl, b.w, b.h, maxPpi, quality, place.square);
            const pdfImg = img.png ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
            if (place.square && !img.png && img.bytes.length > 0) {
                page.drawImage(pdfImg, { x: b.x * MM, y: Y(b.y + b.h), width: b.w * MM, height: b.h * MM });
            } else {
                // Sans recadrage possible, l'image est ajustée DANS sa case, ratio gardé.
                const r = pdfImg.width / pdfImg.height;
                const w = Math.min(b.w, b.h * r), hh = w / r;
                page.drawImage(pdfImg, { x: (b.x + (b.w - w) / 2) * MM, y: Y(b.y + (b.h - hh) / 2 + hh), width: w * MM, height: hh * MM });
            }
        } catch {
            page.drawRectangle({ x: b.x * MM, y: Y(b.y + b.h), width: b.w * MM, height: b.h * MM, borderColor: pal.frame, borderWidth: 0.5 });
            drawRuns(page, 'image illisible', (b.x + 1) * MM, Y(b.y + b.h / 2), 5, fonts.bodyChain, fonts, pal.muted);
        }
        if (place.captionY !== null) {
            const cap = fitLine(src.title, fonts.bodyChain, fonts, 5.5, b.w * MM, 5.5);
            drawRuns(page, cap.text, b.x * MM, Y(place.captionY + 2), cap.size, fonts.bodyChain, fonts, pal.muted);
        }
    }

    // Colonnes de texte.
    for (const t of layout.textBoxes) {
        const lh = lineHeightPt(t.size);
        const topPt = Y(t.y);
        t.lines.forEach((line, i) => {
            const y = topPt - (i + 1) * lh + t.size * 0.22;
            const chain = line.bold ? fonts.boldChain : fonts.bodyChain;
            drawRuns(page, line.text, t.x * MM, y, t.size, chain, fonts, pal.text);
            if (line.badge) {
                const bw = widthOf(line.badge.text, fonts.boldChain, fonts, t.size);
                drawRuns(page, line.badge.text, (t.x + t.w) * MM - bw, y, t.size, fonts.boldChain, fonts, hexColor(line.badge.color, pal, options.theme));
            }
        });
    }

    // Pied de page.
    const f = layout.footer;
    const foot = `${dr} · PC TAC · Synthèse A3 1/1 · la main courante intégrale (${collected.logCount} entrées) et les fiches complètes figurent au rapport complet`;
    const footLine = fitLine(foot, fonts.bodyChain, fonts, 6, f.w * MM, 5);
    drawRuns(page, footLine.text, f.x * MM, Y(f.y + f.h - 1), footLine.size, fonts.bodyChain, fonts, pal.muted);

    // Métadonnées sans nom de personne.
    doc.setTitle(`PC-Tac — Synthèse A3 — ${collected.situation}`);
    doc.setSubject('Synthèse de situation (une page A3 paysage)');
    doc.setCreator('TacSuite PC-Tac');
    doc.setProducer('TacSuite PC-Tac (pdf-lib)');
    return doc.save();
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

let busy = false;

/**
 * Génère et télécharge la synthèse A3. Rend `false` si rien n'a été produit, et
 * `'complet'` quand la situation ne tient pas et que l'utilisateur demande le
 * rapport complet : l'appelant le lance une fois son verrou de génération relâché.
 */
export async function buildA3Pdf(options: PdfOptions): Promise<boolean | 'complet'> {
    if (busy) {
        toast('Une synthèse A3 est déjà en cours de génération.', { kind: 'info' });
        return false;
    }
    busy = true;
    // UNE seule ouverture de l'overlay (compteur de `busy.ts`) : les étapes
    // ne changent que le message ; il est masqué le temps d'une fenêtre de
    // dialogue, puis rouvert. `overlayShown` garantit une fermeture et une seule.
    let overlayShown = false;
    const overlay = (message: string | null): void => {
        if (message === null) { if (overlayShown) { hideBusy(); overlayShown = false; } return; }
        if (overlayShown) setBusyMessage(message);
        else { showBusy(message); overlayShown = true; }
    };
    overlay('Synthèse A3 : collecte des données…');
    try {
        const collected = await collect();
        const fontBytes = await loadFontBytes();
        const { bodyChain } = chains(fontBytes);

        // Écritures : annonce AVANT, puis remplacement (émoji retirés, reste « ? »).
        const unsupported: UnsupportedChars[] = collected.texts
            .map((t) => ({ where: t.where, chars: findUnsupported(t.text, bodyChain) }))
            .filter((u) => u.chars.length > 0);
        if (unsupported.length) {
            overlay(null);
            const go = await confirmUnsupportedChars(unsupported);
            if (!go) return false;
            overlay('Synthèse A3 : mise en page…');
        }
        const clean = (s: string): string => replaceUnsupported(s, bodyChain);
        const cleanFiche = (fi: A3Fiche): A3Fiche => ({ ...fi, title: clean(fi.title), full: clean(fi.full), short: clean(fi.short) });
        const input: A3Input = {
            ...collected.input,
            photos: collected.input.photos.map((p) => ({ ...p, title: clean(p.title) })),
            adv: { ...collected.input.adv, fiches: collected.input.adv.fiches.map(cleanFiche) },
            host: { ...collected.input.host, fiches: collected.input.host.fiches.map(cleanFiche) },
            faits: { ...collected.input.faits, entries: collected.input.faits.entries.map(clean) },
            points: { ...collected.input.points, items: collected.input.points.items.map(clean) },
            amis: { ...collected.input.amis, items: collected.input.amis.items.map(clean) },
        };
        collected.photos.forEach((p) => { p.title = clean(p.title); });
        const allText = JSON.stringify(input);
        const needArabic = splitFontRuns(allText, bodyChain).some((r) => r.fontId === 'arabic');

        // Plan capturé à la définition de la sortie choisie.
        const planRequested = !!(window as unknown as { PlanMap?: { captureToDataUrl?: unknown } }).PlanMap?.captureToDataUrl;
        overlay('Synthèse A3 : capture du plan…');
        const plan = planRequested
            ? await capturePlanForPdf({ targetWidthPx: targetPixels(PHOTO_COLUMN_MM * MM, options.sortie), jpegQuality: PDF_IMAGE_PROFILES[options.sortie].jpegQuality })
            : null;
        input.plan = plan ? { widthPx: plan.widthPx, heightPx: plan.heightPx } : null;
        // Cases du carroyage connues seulement une fois la carte prête (voir collectPointItems).
        if (plan) input.points = { ...input.points, items: collectPointItems().map(clean) };

        // Mesure avec la vraie chaîne de polices (document jetable).
        overlay('Synthèse A3 : mise en page…');
        const measureDoc = await PDFLib.PDFDocument.create();
        const measureFonts = await embedFonts(measureDoc, fontBytes, needArabic);
        const measure: A3Measure = (text, bold, size) => widthOf(text, bold ? measureFonts.boldChain : measureFonts.bodyChain, measureFonts, size);
        const layout = layoutA3(input, measure);

        if (layout.refused) {
            overlay(null);
            const full = await confirmDialog({
                title: 'Synthèse A3 impossible',
                message: `Même réduite, la situation ne tient pas sur une page A3 :\n\n${layout.refused.map((r) => `• ${r}`).join('\n')}\n\nLe rapport complet contient tout.`,
                confirmLabel: 'Générer le rapport complet',
                cancelLabel: 'Fermer',
            });
            return full ? 'complet' : false;
        }

        overlay('Synthèse A3 : dessin…');
        const ctx: RenderContext = { collected: { ...collected, input }, layout, plan, planRequested, options, fontBytes, needArabic, squeeze: 1 };
        let bytes = await render(ctx);
        const budget = PDF_IMAGE_PROFILES[options.sortie].budgetBytes;
        if (budget !== null && bytes.length > budget) bytes = await render({ ...ctx, squeeze: 0.7 });

        const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = Utils.readableFileName(collected.situation, new Date(), 'pdf').replace(/^PC-Tac_/, 'PC-Tac_Synthese-A3_').replace(/['’]/g, '');
        link.click();
        setTimeout(() => { try { URL.revokeObjectURL(link.href); } catch { /* sans effet */ } }, 30000);
        const over = budget !== null && bytes.length > budget ? ' (au-dessus de la cible Partage : trop de photos)' : '';
        toast(`Synthèse A3 prête : ${formatBytes(bytes.length)}${over}.`, { kind: over ? 'info' : 'success' });
        return true;
    } catch (e) {
        console.error('Synthèse A3 :', e);
        toast(`Erreur lors de la génération de la synthèse A3 : ${e instanceof Error ? e.message : String(e)}`, { kind: 'error' });
        return false;
    } finally {
        busy = false;
        overlay(null);
    }
}
