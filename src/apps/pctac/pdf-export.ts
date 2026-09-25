/**
 * pdf-export.ts — Export PDF PC-Tac (pdf-lib)
 * ============================================
 *
 * Port TypeScript de `modules/pctac/pdfExport.js` (GStart-main, 596 LOC).
 *
 * SUPPRESSION IMPOSÉE : la section 7 « BOARD RELATIONNEL »
 * de l'original (pdfExport.js:503-538) est retirée. Elle lisait le global du
 * module « board relationnel », module mort (jamais importé, absent de
 * global.d.ts) : elle ne compilerait pas.
 *
 * Adaptations imposées par TypeScript strict (aucune ne change le comportement
 * observable — mêmes appels pdf-lib, mêmes conditions, même ordre) :
 *  - `context.currentPage` (nullable côté typage, jamais nul à l'exécution une
 *    fois `addNewPage()` appelé) est lu via l'accesseur local `pdfPage()` :
 *    TypeScript ne peut pas suivre cet invariant à travers les nombreuses
 *    fonctions imbriquées de ce fichier (narrowing perdu après tout appel de
 *    fonction intermédiaire). `pdfPage()` jette si l'invariant était violé —
 *    chemin jamais atteint en pratique, `addNewPage()` précède toujours toute
 *    utilisation, comme dans l'original.
 *  - `PageSizes.A4.slice()` (pdfExport.js:102-104, 161) : un `.slice()` sur un
 *    tuple `[number, number]` de pdf-lib est retypé `number[]` par TypeScript
 *    (perte du typage tuple), incompatible avec la signature `addPage()`. Le
 *    clone défensif — même invariant, « jamais le même tableau partagé » — est
 *    donc porté par `cloneA4()`, exportée pour test unitaire dédié.
 *  - Quelques accès indexés (`colWidths[i]`, `imgBytes[0]`, `PDF_PAX_COLORS[x]`)
 *    sont neutralisés pour `noUncheckedIndexedAccess` par un typage tuple ou un
 *    repli `?? …`, sans changer la valeur produite dans les cas réels.
 */

import * as PDFLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDF_FONT_VFS } from '@oi/pdf/fonts.js';
import { Storage } from '@pctac/storage.js';
import { ImageStore } from '@pctac/image-store.js';
import { PDF_PAX_COLORS, PHOTO_CATEGORIES, FREE_MODE_COLORS, safeHexColor } from '@pctac/config.js';
import { currentMode, currentModeId, paxChipLabel, photoCategoryLabel } from '@pctac/modes.js';
import { TYPE_MENACE_KEY, ficheCounters, ficheTitle, filledSections, sortFichesByPriority, statusChoices, statusMeta, type FicheSide } from '@pctac/fiche.js';
import { showBusy, hideBusy, setBusyMessage } from '@pctac/busy.js';
import { capturePlanForPdf, imageSizeFromDataUrl, type PlanPrintCapture } from '@pctac/plan-capture-for-pdf.js';
import { Utils } from '@pctac/utils.js';
import { toast } from '@shared/feedback.js';
import {
    PDF_IMAGE_PROFILES,
    askPdfOptions,
    formatBytes,
    loadPdfOptions,
    targetPixels,
    type PdfKindChoice,
    type PdfOptions,
    type PdfSortie,
    type PdfTheme,
} from '@shared/pdf-options.js';
import type { PdfExportContract, PlanMapPinSummary } from '@shared/types/contracts.js';

/** Rapports proposés par la fenêtre de génération (décisions 41 et 42). */
export const PCTAC_PDF_KINDS: readonly PdfKindChoice[] = [
    { id: 'complet', label: 'Rapport complet', hint: 'Toutes les pages, A4' },
    { id: 'a3', label: 'Synthèse A3', hint: 'Une page A3 paysage' },
];

// FREE_MODE_COLORS : importé pour fidélité avec l'import original (pdfExport.js:3),
// jamais consommé dans ce module (déjà le cas dans l'original). `void` évite
// l'échec `noUnusedLocals` — même pattern que `restrictWidth` dans l'original
// (pdfExport.js:576-577).
void FREE_MODE_COLORS;

/**
 * Clone défensif d'un tuple de dimensions de page A4 `[largeur, hauteur]`.
 * `PageSizes.A4` (et toute valeur qui en dérive) est un TABLEAU PARTAGÉ par
 * pdf-lib : toute mutation de l'un contaminerait tous les appels suivants.
 * On clone donc À CHAQUE `addNewPage()`, comme l'original (pdfExport.js:102-104,
 * 161), qui utilisait `.slice()` — ici remplacé par une construction de tuple
 * typée (`.slice()` sur un tuple pdf-lib perd son typage `[number, number]`).
 */
export function cloneA4(size: readonly [number, number]): [number, number] {
    return [size[0], size[1]];
}

/**
 * Export PDF pour PC TAC utilisant pdf-lib
 * Structure multi-pages ordonnée et respect du thème (clair/sombre).
 */

/** Décode une chaîne base64 (VFS pdfmake) en octets, sans Buffer. */
function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * B-3 — Polices du PDF PC-Tac, comme l'OI : corps en JetBrains Mono (400
 * normal, 700 gras, monocasse lisible en petit), titres de section en Oswald
 * 500 (condensée d'affichage). R23 — `hasGlyph` expose la couverture réelle de
 * la police de corps (lue via fontkit) : un caractère absent est translittéré
 * (grec → latin) ou remplacé par « ? » plutôt que de sortir en carré vide.
 */
export interface ReportFonts {
    font: PDFLib.PDFFont;
    fontBold: PDFLib.PDFFont;
    titleFont: PDFLib.PDFFont;
    hasGlyph: (codePoint: number) => boolean;
}

export async function embedReportFonts(pdfDoc: PDFLib.PDFDocument): Promise<ReportFonts> {
    pdfDoc.registerFontkit(fontkit);
    const bodyNormal = PDF_FONT_VFS['JetBrainsMono-400.ttf'];
    const bodyBold = PDF_FONT_VFS['JetBrainsMono-700.ttf'];
    const title = PDF_FONT_VFS['Oswald-500.ttf'];
    if (!bodyNormal || !bodyBold || !title) {
        throw new Error("Polices PDF de l'OI introuvables (JetBrainsMono/Oswald).");
    }
    const bodyBytes = base64ToBytes(bodyNormal);
    const font = await pdfDoc.embedFont(bodyBytes, { subset: true });
    const fontBold = await pdfDoc.embedFont(base64ToBytes(bodyBold), { subset: true });
    const titleFont = await pdfDoc.embedFont(base64ToBytes(title), { subset: true });
    // Couverture de la police de CORPS (celle qui porte les noms saisis).
    const kit = fontkit.create(bodyBytes) as unknown as { hasGlyphForCodePoint?: (c: number) => boolean };
    const hasGlyph = (codePoint: number): boolean =>
        typeof kit.hasGlyphForCodePoint === 'function' ? kit.hasGlyphForCodePoint(codePoint) : true;
    return { font, fontBold, titleFont, hasGlyph };
}

/** Base de translittération grecque → latine (R23), lettres isolées. */
const GREEK_BASE: Readonly<Record<string, string>> = {
    'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th',
    'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p',
    'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'u', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o',
    'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'Th',
    'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P',
    'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'U', 'Φ': 'F', 'Χ': 'Ch', 'Ψ': 'Ps', 'Ω': 'O',
};

/**
 * R23 — translittération simple du grec vers le latin. Les diacritiques
 * (tonos, tréma) sont retirés avant correspondance. Les caractères non grecs
 * sont rendus tels quels.
 */
export function transliterateGreek(str: string): string {
    return [...str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')]
        .map((ch) => GREEK_BASE[ch] ?? ch)
        .join('');
}

/** Vérificateur de glyphes actif pendant un export (R23). `null` hors export. */
let glyphChecker: ((codePoint: number) => boolean) | null = null;

/**
 * sanitizeWinAnsi(s, hasGlyph?)
 * Nettoie les caractères non dessinables : les CONTRÔLES (tabulations, sauts
 * de ligne, codes < 0x20, BOM, espaces de largeur nulle) deviennent un espace
 * ou disparaissent. Sans `hasGlyph`, tout le reste est conservé tel quel
 * (apostrophes courbes, tirets, lettres non latines) — comportement d'origine.
 *
 * R23 — avec un vérificateur de couverture (la police de corps pendant
 * l'export), un caractère ABSENT est translittéré s'il est grec, sinon
 * remplacé par « ? » (repli visible et documenté) : jamais de carré vide.
 * Ne jette jamais.
 */
export function sanitizeWinAnsi(s: unknown, hasGlyph: ((codePoint: number) => boolean) | null = glyphChecker): string {
    if (s === null || s === undefined) return '';
    let str: string;
    try {
        str = String(s);
    } catch {
        return '';
    }
    let out = '';
    for (const ch of str) {
        const code = ch.codePointAt(0) ?? -1;
        if (code === 0xFEFF || code === 0x200B || code === 0x200C || code === 0x200D) continue;
        if (code === 0x09 || code === 0x0A || code === 0x0D) { out += ' '; continue; }
        if (code < 0x20) continue;
        if (hasGlyph && !hasGlyph(code)) {
            const latin = transliterateGreek(ch);
            if (latin !== ch && [...latin].every((c) => hasGlyph(c.codePointAt(0) ?? -1))) out += latin;
            else out += '?';
            continue;
        }
        out += ch;
    }
    return out;
}

/**
 * C16 / B-3 — tronque `text` à `maxWidth` points pour la police et la taille
 * données, en terminant par « … ». Indispensable depuis le passage du corps en
 * JetBrains Mono : monospace, environ 40 % plus large que l'Oswald condensé,
 * elle fait déborder les colonnes à largeur fixe (tables Forces amies, journal,
 * liste des points). Les titres de fiche utilisaient déjà ce repli.
 */
export function fitTextToWidth(text: string, font: PDFLib.PDFFont, size: number, maxWidth: number): string {
    // Revue finale F8 : on mesure au plus quelques dizaines de caractères et
    // on cherche la coupe par dichotomie, au lieu de remesurer la chaîne
    // entière à chaque caractère retiré (coût quadratique : plusieurs secondes
    // pour un champ long venu d'une archive). Même résultat que la coupe
    // caractère par caractère : la largeur d'un préfixe croît avec sa longueur.
    // Borne haute : aucun préfixe plus long que (largeur / glyphe le plus
    // étroit + 1) ne peut tenir ; on ne mesure donc jamais au-delà.
    const narrowest = Math.min(...['i', 'l', '.', ' ', '’'].map((c) => font.widthOfTextAtSize(c, size)).filter((w) => w > 0));
    const bound = Number.isFinite(narrowest) ? Math.floor(maxWidth / narrowest) + 2 : text.length;
    const head = text.length > bound ? text.slice(0, bound) : text;
    if (head === text && font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    // Plus long préfixe `n` (au moins 1) tel que `préfixe + « … »` tienne.
    let lo = 1, hi = head.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (font.widthOfTextAtSize(`${head.slice(0, mid)}…`, size) <= maxWidth) lo = mid;
        else hi = mid - 1;
    }
    return `${head.slice(0, lo).trimEnd()}…`;
}

/**
 * Replie `text` sur `width` points. La coupe est DURE pour un mot plus large
 * que la colonne (adresse, identifiant, nom composé collé) : sans elle, le
 * jeton sort de la page, dans la main courante comme dans les fiches (M2).
 * La coupe par dichotomie évite de remesurer la chaîne entière à chaque
 * caractère retiré, même principe que `fitTextToWidth`.
 */
export function wrapText(text: unknown, width: number, font: PDFLib.PDFFont, size: number): string[] {
    const lines: string[] = [];
    // M4 — chaque paragraphe saisi est replié séparément. Les sauts de ligne
    // doivent être lus AVANT sanitizeWinAnsi, qui aplatit les contrôles en
    // espaces (même découpage que les fiches).
    const raw = typeof text === 'string' ? text : sanitizeWinAnsi(text);
    for (const paragraph of raw.split(/\r?\n/)) {
        let currentLine = '';
        const pushSplitWord = (word: string): void => {
            let rest = word;
            while (rest && font.widthOfTextAtSize(rest, size) >= width) {
                let lo = 1, hi = rest.length;
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    if (font.widthOfTextAtSize(rest.slice(0, mid), size) < width) lo = mid;
                    else hi = mid - 1;
                }
                lines.push(rest.slice(0, lo));
                rest = rest.slice(lo);
            }
            currentLine = rest;
        };
        sanitizeWinAnsi(paragraph).split(' ').forEach((word) => {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (font.widthOfTextAtSize(testLine, size) < width) {
                currentLine = testLine;
                return;
            }
            if (currentLine) {
                lines.push(currentLine);
                currentLine = '';
            }
            if (font.widthOfTextAtSize(word, size) < width) currentLine = word;
            else pushSplitWord(word);
        });
        if (currentLine) lines.push(currentLine);
    }
    return lines;
}

/**
 * Période couverte par le journal (Mo5) : première et dernière entrée, au
 * format `JJ/MM/AAAA HH:MM`. Les entrées legacy sans date n'affichent que
 * leur heure. Rend « — » si le journal est vide.
 */
export function situationPeriod(logs: readonly { date?: string | undefined; heure?: string | undefined }[]): string {
    const first = logs[0];
    const last = logs[logs.length - 1];
    if (!first || !last) return '—';
    const fmt = (e: { date?: string | undefined; heure?: string | undefined }): string => {
        const [y, m, d] = (e.date ?? '').split('-');
        const heure = e.heure ?? '';
        return (d && m && y) ? `${d}/${m}/${y} ${heure}`.trim() : heure;
    };
    const a = fmt(first);
    const b = fmt(last);
    return a === b ? a : `${a} → ${b}`;
}

/** Palette de couleurs du thème courant, calculée une fois par export (pdfExport.js:118-124). */
interface PdfThemeColors {
    background: PDFLib.RGB;
    text: PDFLib.RGB;
    line: PDFLib.RGB;
    headerBg: PDFLib.RGB;
    highlight: PDFLib.RGB;
}

/** État mutable partagé entre les fonctions utilitaires de `buildPdf` (pdfExport.js:126-139). */
interface PdfExportContext {
    pdfDoc: PDFLib.PDFDocument;
    helveticaFont: PDFLib.PDFFont;
    helveticaBoldFont: PDFLib.PDFFont;
    fontSize: number;
    lineHeight: number;
    margin: number;
    pageWidth: number;
    pageHeight: number;
    y: number;
    /** `null` avant le premier `addNewPage()`. Toujours lu via `pdfPage()` (cf. en-tête de fichier). */
    currentPage: PDFLib.PDFPage | null;
    pageNumber: number;
    colors: PdfThemeColors;
}

/**
 * Définition utile d'une image imprimée sur `printedWidthPt` points (décision
 * 42) : celle du profil de sortie (`PDF_IMAGE_PROFILES`), jamais au-delà de
 * la définition native (pas d'agrandissement). `scale` < 1 réduit encore,
 * pour tenir le budget de la sortie « Partage ».
 */
export function printPixelSize(
    nativeWidthPx: number,
    nativeHeightPx: number,
    printedWidthPt: number,
    sortie: PdfSortie,
    scale = 1,
): { widthPx: number; heightPx: number } {
    const base = Math.min(nativeWidthPx, targetPixels(printedWidthPt, sortie));
    const widthPx = Math.max(1, Math.round(base * scale));
    return { widthPx, heightPx: Math.max(1, Math.round((widthPx * nativeHeightPx) / nativeWidthPx)) };
}

/**
 * Budget de poids de la sortie « Partage » (décision 42, moins de 10 Mo pour
 * Tchap) : tant que le PDF dépasse, il est refait avec des images réduites
 * (facteur `scale`, qualité JPEG baissée à chaque essai). Au bout de
 * `maxAttempts` rendus, le dernier est gardé et signalé (`overBudget`) :
 * un PDF lourd de texte ne s'allège pas en réduisant les photos.
 */
export async function renderWithinBudget(
    render: (scale: number, attempt: number) => Promise<Uint8Array>,
    budgetBytes: number | null,
    maxAttempts = 4,
): Promise<{ bytes: Uint8Array; overBudget: boolean }> {
    let scale = 1;
    for (let attempt = 0; ; attempt++) {
        const bytes = await render(scale, attempt);
        if (budgetBytes === null || bytes.length <= budgetBytes) return { bytes, overBudget: false };
        if (attempt + 1 >= maxAttempts) return { bytes, overBudget: true };
        // Poids des images ~ nombre de pixels : réduction en racine, avec 15 %
        // de marge pour le texte et les polices, bornée pour converger vite.
        scale *= Math.min(0.9, Math.max(0.3, Math.sqrt((0.85 * budgetBytes) / bytes.length)));
    }
}

/**
 * Ré-encode une image en JPEG à la taille donnée, sur fond blanc. `null` si
 * c'est impossible (pas de canvas 2D, image illisible) : l'appelant garde
 * alors l'original.
 */
async function reencodeJpeg(dataUrl: string, widthPx: number, heightPx: number, quality: number): Promise<string | null> {
    const canvas = document.createElement('canvas');
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
    if (!ctx) return null; // contexte d'abord : sans canvas, inutile de décoder
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('image load timeout')), 10_000);
            img.onload = () => { clearTimeout(timer); resolve(); };
            img.onerror = () => { clearTimeout(timer); reject(new Error('image illisible')); };
            img.src = dataUrl;
        });
        canvas.width = widthPx;
        canvas.height = heightPx;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, widthPx, heightPx);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, widthPx, heightPx);
        const out = canvas.toDataURL('image/jpeg', quality);
        return out.startsWith('data:image/jpeg') ? out : null;
    } catch {
        return null;
    } finally {
        // Libère la mémoire du canvas tout de suite (téléphones).
        canvas.width = 0;
        canvas.height = 0;
    }
}

/** Largeur imprimée du plan tactique (A4 paysage, marges de 40 pt). */
const PLAN_PRINT_WIDTH_PT = 841.89 - 2 * 40;

/**
 * Données lues UNE fois par export (les essais du budget « Partage » les
 * réutilisent) : journal, fiches, amis, photos hydratées, capture du plan et
 * liste des points.
 */
async function loadReportData(sortie: PdfSortie) {
    // Charger les données (les photos sont stockées en IndexedDB, on les hydrate)
    const allLogs = Storage.loadLogData();
    // Les entrées automatiques (pings posés/retirés, changements de
    // statut — flag `auto`, pax 'Carte' legacy, ou remarques de statut)
    // sortent de la main courante et vont sur leur propre page, en fin
    // de document (après « PLAN TACTIQUE - LISTE DES POINTS »).
    const isAuto = (e: { auto?: boolean | undefined; pax: string; remarques?: string | undefined }): boolean => {
        if (e.auto) return true;
        if (e.pax === 'Carte') return true;
        if (typeof e.remarques === 'string') {
            const r = e.remarques.trim();
            if (/^(ADV|OTG)\b.*:\s*(actif|neutralisé|ok|préoccupant|blessé|dcd)/i.test(r)) return true;
            if (/^\[PIN\]/i.test(r)) return true;
        }
        return false;
    };
    const logData = allLogs.filter((e) => !isAuto(e));
    const carteLogs = allLogs.filter(isAuto);
    // Décision 33 — même tri par priorité qu'à l'écran (source unique).
    const adversaries = sortFichesByPriority(
        'adv', currentModeId(), await ImageStore.hydrate(Storage.loadCollection('pcTacAdversaries'), 'photo'),
    );
    const hostages = sortFichesByPriority(
        'host', currentModeId(), await ImageStore.hydrate(Storage.loadCollection('pcTacHostages'), 'photo'),
    );
    const friends = Storage.loadCollection('pcTacFriends');
    const photos = await ImageStore.hydrate(Storage.loadCollection('pcTacPhotos'), 'data');

    // Plan tactique : capture faite une seule fois (bascule de vue comprise),
    // à la définition du profil de sortie. `plan: null` = pas de module Plan.
    let plan: { capture: PlanPrintCapture | null } | null = null;
    if (window.PlanMap && typeof window.PlanMap.captureToDataUrl === 'function') {
        setBusyMessage('Génération du PDF : capture du plan…');
        // Chaîne partagée avec la synthèse A3 (`plan-capture-for-pdf.ts`) :
        // bascule temporaire sur la vue Plan, capture, vue restaurée,
        // JPEG sur fond blanc ; `null` si la carte n'a pas pu être prise.
        plan = {
            capture: await capturePlanForPdf({
                targetWidthPx: targetPixels(PLAN_PRINT_WIDTH_PT, sortie),
                jpegQuality: PDF_IMAGE_PROFILES[sortie].jpegQuality,
            }),
        };
    }
    let pins: PlanMapPinSummary[] | null = null;
    if (window.PlanMap && typeof window.PlanMap.getPinsSummary === 'function') {
        try {
            const raw = window.PlanMap.getPinsSummary();
            pins = Array.isArray(raw) ? raw : [];
        } catch (pinErr) {
            console.warn('PDF Plan getPinsSummary échouée :', pinErr);
            pins = [];
        }
    }
    return { allLogs, logData, carteLogs, adversaries, hostages, friends, photos, plan, pins };
}

type ReportData = Awaited<ReturnType<typeof loadReportData>>;

/** Réglages d'un rendu : choix de la fenêtre et essai du budget « Partage ». */
interface RenderSettings {
    theme: PdfTheme;
    sortie: PdfSortie;
    /** Réduction des images (1 = définition du profil). */
    scale: number;
    /** Numéro d'essai du budget (0 = premier rendu). */
    attempt: number;
}

/** Dessine tout le rapport et rend les octets du PDF. */
async function renderReport(data: ReportData, settings: RenderSettings): Promise<Uint8Array> {
    const { PDFDocument, rgb: pdfRgb, PageSizes } = PDFLib;
    // PageSizes.A4 est un tuple partagé : toujours cloner avant addPage
    const A4_PORTRAIT: [number, number] = cloneA4(PageSizes.A4);
    const A4_LANDSCAPE: [number, number] = cloneA4([PageSizes.A4[1], PageSizes.A4[0]]);
    const pdfDoc = await PDFDocument.create();
    // Décision 34 / B-3 — corps JetBrains Mono, titres Oswald (comme l'OI).
    const { font, fontBold, titleFont, hasGlyph } = await embedReportFonts(pdfDoc);
    // R23 — la couverture de la police de corps guide l'échappement des
    // textes saisis (translittération/« ? »), retiré en fin d'export.
    glyphChecker = hasGlyph;

    const { allLogs, logData, carteLogs, adversaries, hostages, friends, photos } = data;

    // Lot B (constat 8) — le PDF suit la situation : titres et libellés
    // de lien dérivés de la situation courante au moment de l'export.
    const mode = currentMode();
    // Mo5 — le document doit s'identifier seul (nom de fichier mis à
    // part) : nom de la situation et période figurent en tête de page 1.
    const periode = situationPeriod(allLogs);

    // Décision 42 — thème choisi dans la fenêtre de génération (clair par
    // défaut), plus celui de l'écran : un PDF sombre ne s'imprime pas.
    const isDarkMode = settings.theme === 'sombre';
    const themeColors: PdfThemeColors = {
        background: isDarkMode ? pdfRgb(0.1, 0.1, 0.1) : pdfRgb(1, 1, 1),
        text: isDarkMode ? pdfRgb(0.9, 0.9, 0.9) : pdfRgb(0, 0, 0),
        line: isDarkMode ? pdfRgb(0.3, 0.3, 0.3) : pdfRgb(0.8, 0.8, 0.8),
        headerBg: isDarkMode ? pdfRgb(0.2, 0.2, 0.2) : pdfRgb(0.95, 0.95, 0.95),
        highlight: isDarkMode ? pdfRgb(0.15, 0.15, 0.15) : pdfRgb(0.98, 0.98, 0.98)
    };

    const context: PdfExportContext = {
        pdfDoc,
        helveticaFont: font,
        helveticaBoldFont: fontBold,
        fontSize: 9,
        lineHeight: 12,
        margin: 40,
        pageWidth: 0,
        pageHeight: 0,
        y: 0,
        currentPage: null,
        pageNumber: 0,
        colors: themeColors
    };

    // Accesseur non-nul de la page courante — cf. en-tête de fichier.
    const pdfPage = (): PDFLib.PDFPage => {
        if (context.currentPage === null) {
            throw new Error('pdf-export: aucune page PDF courante (addNewPage() non appelé)');
        }
        return context.currentPage;
    };

    // --- FONCTIONS UTILITAIRES ---
    const addNewPage = (title: string, isLandscape = false): void => {
        // Cloner à chaque appel : pdf-lib peut conserver la référence
        const size = cloneA4(isLandscape ? A4_LANDSCAPE : A4_PORTRAIT);
        context.currentPage = pdfDoc.addPage(size);
        context.pageWidth = pdfPage().getWidth();
        context.pageHeight = pdfPage().getHeight();
        context.y = context.pageHeight - context.margin;
        context.pageNumber++;

        pdfPage().drawRectangle({
            x: 0, y: 0, width: context.pageWidth, height: context.pageHeight, color: themeColors.background
        });

        if (title) {
            // B-3 — titre de section en Oswald (titre d'affichage).
            pdfPage().drawText(title, {
                x: context.margin, y: context.y, size: 14, font: titleFont, color: themeColors.text
            });
            context.y -= 30;
        }
    };

    /**
     * Décision 42 — image ramenée à la définition du profil de sortie pour sa
     * taille imprimée (jamais agrandie), JPEG à la qualité du profil ; aux
     * essais suivants du budget « Partage », réduite et recompressée. Garde
     * l'original quand il est déjà plus léger ou que le canvas manque.
     */
    const printable = async (dataUrl: string, boxWidth: number, boxHeight: number): Promise<string> => {
        const size = imageSizeFromDataUrl(dataUrl);
        if (!size) return dataUrl;
        const printedWidth = Math.min(boxWidth, (boxHeight * size.widthPx) / size.heightPx);
        const { widthPx, heightPx } = printPixelSize(size.widthPx, size.heightPx, printedWidth, settings.sortie, settings.scale);
        if (widthPx >= size.widthPx && settings.attempt === 0) return dataUrl;
        const quality = Math.max(0.45, PDF_IMAGE_PROFILES[settings.sortie].jpegQuality - 0.1 * settings.attempt);
        const jpeg = await reencodeJpeg(dataUrl, widthPx, heightPx, quality);
        return jpeg && jpeg.length < dataUrl.length ? jpeg : dataUrl;
    };

    const drawImageSafe = async (page: PDFLib.PDFPage, source: unknown, x: number, y: number, maxWidth: number, maxHeight: number): Promise<number> => {
        try {
            if (!source || typeof source !== 'string' || !source.startsWith('data:image')) return y;
            const dataUrl = await printable(source, maxWidth, maxHeight);
            const ab = await fetch(dataUrl).then(res => res.arrayBuffer());
            const imgBytes = new Uint8Array(ab); // pdf-lib préfère Uint8Array

            // Validation simple du header JPEG/PNG
            const b0 = imgBytes[0] ?? 0;
            const b1 = imgBytes[1] ?? 0;
            const isPng  = b0 === 0x89 && b1 === 0x50;
            const isJpeg = b0 === 0xFF && b1 === 0xD8;

            let img: PDFLib.PDFImage;
            if (isPng) img = await pdfDoc.embedPng(imgBytes);
            else if (isJpeg) img = await pdfDoc.embedJpg(imgBytes);
            else throw new Error("Format image non supporté ou corrompu");

            const dims = img.scale(1);
            const ratio = Math.min(maxWidth / dims.width, maxHeight / dims.height);
            const finalWidth = dims.width * ratio;
            const finalHeight = dims.height * ratio;

            page.drawImage(img, { x, y: y - finalHeight, width: finalWidth, height: finalHeight });
            return y - finalHeight - 10;
        } catch (e) {
            console.error("PDF Image Embed Error:", e);
            page.drawText("[Image Erreur]", { x, y: y - 15, size: 8, font, color: pdfRgb(0.7, 0, 0) });
            return y - 20;
        }
    };

    // Progression affichée (audit : 35 s sans retour visuel sur le jeu extrême).
    const step = (what: string): void => setBusyMessage(settings.attempt === 0
        ? `Génération du PDF : ${what}…`
        : `Allègement pour le Partage (essai ${settings.attempt + 1}) : ${what}…`);

    // --- 1. MAIN COURANTE ---
    step('main courante');
    addNewPage("MAIN COURANTE - JOURNAL D'INTERVENTION");
    // Mo5 — bandeau d'identification sous le titre : situation et période.
    pdfPage().drawText(
        fitTextToWidth(sanitizeWinAnsi(`Situation : ${mode.label} — Période : ${periode}`), fontBold, 9, context.pageWidth - 2 * context.margin),
        { x: context.margin, y: context.y, size: 9, font: fontBold, color: themeColors.text }
    );
    context.y -= 18;
    const colWidths: [number, number, number, number] = [50, 70, 150, 245]; // Heure, Pax, Localisation, Remarques
    const headers = ["Heure", "Pax", "Localisation", "Remarques"];

    const drawTableHeader = (): void => {
        pdfPage().drawRectangle({
            x: context.margin, y: context.y - 5, width: context.pageWidth - 2 * context.margin, height: 20, color: themeColors.headerBg
        });
        let currentX = context.margin + 5;
        headers.forEach((h, i) => {
            pdfPage().drawText(h, { x: currentX, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
            currentX += colWidths[i] ?? 0; // colWidths a 4 entrées fixes ; neutralise noUncheckedIndexedAccess
        });
        context.y -= 25;
    };

    drawTableHeader();

    // U15 — `YYYY-MM-DD` → `JJ/MM/AAAA` (séparateur de jour du journal).
    const fmtDay = (iso: string): string => {
        const [y, m, d] = iso.split('-');
        return (d && m && y) ? `${d}/${m}/${y}` : iso;
    };

    let prevDate: string | undefined;
    for (const entry of logData) {
        // M3 — le lieu est replié (retour à la ligne) au lieu d'être
        // tronqué par « … » : la main courante fait foi, une information
        // saisie ne doit pas disparaître à l'impression. M4 — les
        // remarques respectent leurs sauts de ligne (wrapText).
        const remarksLines = wrapText(entry.remarques, colWidths[3] - 10, font, 9);
        const lieuLines = wrapText(entry.lieu, colWidths[2] - 5, font, 9);
        // La rangée prend la hauteur du plus long des deux blocs.
        const blockLines = Math.max(1, remarksLines.length, lieuLines.length);
        const rowHeight = blockLines * context.lineHeight + 10;

        // U15 — en-tête de jour quand la date change : lève l'ambiguïté
        // minuit sans colonne supplémentaire (les entrées legacy sans
        // date restent telles quelles, avant les entrées datées).
        const daySep = entry.date && entry.date !== prevDate;
        prevDate = entry.date;

        if (context.y - rowHeight - (daySep ? 18 : 0) < context.margin) {
            addNewPage("MAIN COURANTE (SUITE)");
            drawTableHeader();
        }

        if (daySep && entry.date) {
            pdfPage().drawText(sanitizeWinAnsi(`— ${fmtDay(entry.date)} —`), {
                x: context.margin + 5, y: context.y, size: 9, font: fontBold, color: themeColors.text
            });
            context.y -= 18;
        }

        // Style Pax (Couleur). Le libellé suit la situation (« Inter »
        // devient « Recherches » en Recherche de personnes) ; la clé
        // stockée, elle, ne change jamais.
        let pColor = pdfRgb(0.5, 0.5, 0.5);
        const pText = paxChipLabel(entry.pax, mode);
        let hexColor = '#888888';
        if (entry.paxMode === 'standard') {
            const cfg = PDF_PAX_COLORS[entry.pax] ?? PDF_PAX_COLORS['Autre'];
            if (cfg) hexColor = cfg.color;
        } else {
            hexColor = safeHexColor(entry.paxColor, '#888888'); // A1
        }
        const r = parseInt(hexColor.slice(1,3), 16);
        const g = parseInt(hexColor.slice(3,5), 16);
        const b = parseInt(hexColor.slice(5,7), 16);
        pColor = pdfRgb(r/255, g/255, b/255);

        // Calcul du contraste YIQ pour déterminer la couleur de police (noir ou blanc)
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        const textColor = (yiq >= 128) ? pdfRgb(0, 0, 0) : pdfRgb(1, 1, 1);

        // Colonnes à position fixe, dessinées ligne à ligne : le lieu et
        // les remarques peuvent occuper plusieurs lignes.
        const heureX = context.margin + 5;
        const paxX = heureX + colWidths[0];
        const lieuX = paxX + colWidths[1];
        const remarksX = lieuX + colWidths[2];
        let newPageHeader = false;
        for (let i = 0; i < blockLines; i++) {
            // M1 — plus de place pour la ligne : on scinde le bloc sur
            // une nouvelle page avec « (suite) », au lieu de le dessiner
            // sous le pied de page et hors de la feuille.
            if (context.y < context.margin + context.lineHeight) {
                addNewPage("MAIN COURANTE (SUITE)");
                drawTableHeader();
                pdfPage().drawText(fitTextToWidth(sanitizeWinAnsi(`${entry.heure} (suite)`), fontBold, 8, colWidths[0] + colWidths[1] - 5), { x: context.margin + 5, y: context.y, size: 8, font: fontBold, color: themeColors.text });
                context.y -= context.lineHeight;
                newPageHeader = true;
            } else if (i > 0) {
                context.y -= context.lineHeight;
            }
            if (i === 0 || newPageHeader) {
                pdfPage().drawText(fitTextToWidth(sanitizeWinAnsi(entry.heure), font, 9, colWidths[0] - 5), { x: heureX, y: context.y, size: 9, font, color: themeColors.text });
                pdfPage().drawRectangle({ x: paxX - 2, y: context.y - 2, width: colWidths[1] - 5, height: 12, color: pColor });
                pdfPage().drawText(fitTextToWidth(sanitizeWinAnsi(pText), fontBold, 8, colWidths[1] - 5), { x: paxX, y: context.y, size: 8, font: fontBold, color: textColor });
                newPageHeader = false;
            }
            const lieu = lieuLines[i];
            if (lieu) pdfPage().drawText(lieu, { x: lieuX, y: context.y, size: 9, font, color: themeColors.text });
            const remark = remarksLines[i];
            if (remark) pdfPage().drawText(remark, { x: remarksX, y: context.y, size: 9, font, color: themeColors.text });
        }

        // `context.y` est la ligne de base de la DERNIÈRE ligne dessinée :
        // le séparateur passe sous elle (jamais à travers le texte) et
        // l'entrée suivante commence une ligne plus 10 pt plus bas.
        pdfPage().drawLine({
            start: { x: context.margin, y: context.y - context.lineHeight + 2 },
            end: { x: context.pageWidth - context.margin, y: context.y - context.lineHeight + 2 },
            thickness: 0.5, color: themeColors.line, opacity: 0.3
        });

        context.y -= context.lineHeight + 10;
    }

    // --- 2 et 3. FICHES ADVERSE ET PROTÉGÉE (décisions 17 à 19) ---
    step('fiches');
    // Mêmes sections que l'écran, dans l'ordre de la situation, champs
    // remplis seuls ; texte replié sur la largeur disponible.
    const modeId = currentModeId();
    const counters = ficheCounters(modeId, adversaries, hostages);
    const hexRgb = (hex: string): PDFLib.RGB => {
        const n = parseInt(hex.replace('#', ''), 16);
        return Number.isNaN(n) ? themeColors.text : pdfRgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    };
    const drawFiches = async (side: FicheSide, items: typeof adversaries, countLine: string): Promise<void> => {
        if (items.length === 0) return;
        const chapter = `FICHIER ${mode[side].plural.toUpperCase()}`;
        addNewPage(chapter);
        if (countLine) {
            pdfPage().drawText(sanitizeWinAnsi(countLine), { x: context.margin, y: context.y, size: 9, font, color: themeColors.text });
            context.y -= 22;
        }
        const hasStatus = statusChoices(side, modeId).length > 0;
        const statusWord = side === 'host' && (modeId === 'tp' || modeId === 'evenement') ? 'Triage' : 'Statut';
        const resolveLink = (id: string): string => {
            const adv = adversaries.find((a) => a.id === id);
            return adv ? ficheTitle('adv', modeId, adv) : id;
        };
        for (const item of items) {
            if (context.y < 180) addNewPage(`${chapter} (SUITE)`);
            const status = statusMeta(side, modeId, String(item.status || ''));
            pdfPage().drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2 * context.margin, height: 20, color: themeColors.headerBg });
            const label = hasStatus && item.status ? sanitizeWinAnsi(status.label) : '';
            const labelWidth = label ? fontBold.widthOfTextAtSize(label, 10) + 12 : 0;
            // Titre tronqué (« … ») à la place restante : jamais sous le statut.
            const room = context.pageWidth - 2 * context.margin - 10 - labelWidth;
            const title = fitTextToWidth(sanitizeWinAnsi(ficheTitle(side, modeId, item)), fontBold, 11, room);
            pdfPage().drawText(title, { x: context.margin + 5, y: context.y + 2, size: 11, font: fontBold, color: themeColors.text });
            if (label) {
                const labelX = context.pageWidth - context.margin - labelWidth + 7;
                // Décision 33 — DCD : texte NOIR sur fond clair, encadré
                // d'un liseré : lisible sur thème sombre comme clair.
                const isDcd = status.key === 'dcd';
                if (isDcd) {
                    pdfPage().drawRectangle({
                        x: labelX - 4, y: context.y - 5, width: labelWidth, height: 18,
                        color: pdfRgb(0.93, 0.93, 0.93),
                        borderColor: pdfRgb(0.5, 0.5, 0.5), borderWidth: 0.8,
                    });
                }
                pdfPage().drawText(label, {
                    x: labelX, y: context.y + 2, size: 10, font: fontBold,
                    color: isDcd ? pdfRgb(0, 0, 0) : hexRgb(status.color),
                });
            }
            context.y -= 25;

            const top = context.y;
            const hasPhoto = typeof item.photo === 'string' && item.photo !== '';
            if (hasPhoto) await drawImageSafe(pdfPage(), item.photo, context.margin, context.y + 20, 120, 120);
            let x = context.margin + (hasPhoto ? 140 : 5);
            let y = context.y;
            let photoOnPage = hasPhoto;
            const line = (text: string, bold = false): void => {
                if (y < context.margin + 12) {
                    addNewPage(`${chapter} (SUITE)`);
                    x = context.margin + 5;
                    y = context.y;
                    photoOnPage = false;
                }
                pdfPage().drawText(text, { x, y, size: 9, font: bold ? fontBold : font, color: themeColors.text });
                y -= 12;
            };
            const width = (): number => context.pageWidth - context.margin - x;
            const para = (text: string, bold = false): void => {
                String(text).split(/\r?\n/).forEach((p) => wrapText(p, width(), bold ? fontBold : font, 9).forEach((l) => line(l, bold)));
            };
            // Toujours écrit en couleur de texte : la couleur du bandeau
            // seule tombe sous 2:1 en thème clair (jaune, vert).
            if (hasStatus) para(`${statusWord} : ${item.status ? status.label : 'N/C'}`);
            if (side === 'adv' && modeId === 'evenement' && item[TYPE_MENACE_KEY]) para(`Type : ${String(item[TYPE_MENACE_KEY])}`);
            filledSections(side, modeId, item, new Date(), resolveLink).forEach((sec) => {
                y -= 4;
                para(sec.title.toUpperCase(), true);
                sec.rows.forEach((r) => para(`${r.label} : ${r.value}`));
            });
            context.y = Math.min(photoOnPage ? top - 130 : y, y) - 16;
        }
    };
    await drawFiches('adv', adversaries, counters.adv);
    await drawFiches('host', hostages, counters.host);

    // --- 4. AMIS ---
    step('forces amies');
    if (friends.length > 0) {
        addNewPage("FORCES AMIES / UNITÉS");
        const fCols: [number, number, number] = [150, 150, 215];
        const fHeaders = ["Nom / Prénom", "Unité", "Mission / Contact"];

        const drawFHeader = (): void => {
            pdfPage().drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2*context.margin, height: 20, color: themeColors.headerBg });
            let cx = context.margin + 5;
            fHeaders.forEach((h, i) => {
                pdfPage().drawText(h, { x: cx, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
                cx += fCols[i] ?? 0; // fCols a 3 entrées fixes ; neutralise noUncheckedIndexedAccess
            });
            context.y -= 25;
        };
        drawFHeader();

        for (const f of friends) {
            // M3 — la mission est repliée (hauteur variable) au lieu
            // d'être tronquée par « … ».
            const missionLines = wrapText(`${f.mission || ''} ${f.tph ? '['+String(f.tph)+']':''}`, fCols[2] - 5, font, 9);
            const rowHeight = Math.max(1, missionLines.length) * context.lineHeight + 8;
            if (context.y - rowHeight < context.margin) { addNewPage("FORCES AMIES (SUITE)"); drawFHeader(); }
            let cx = context.margin + 5;
            // C16 / B-3 — nom et unité : colonnes à largeur FIXE, tronquées
            // à leur largeur (moins 5 pt de marge) au lieu de déborder.
            pdfPage().drawText(fitTextToWidth(sanitizeWinAnsi(`${f.nom || ''} ${f.prenom || ''}`), font, 9, fCols[0] - 5), { x: cx, y: context.y, size: 9, font, color: themeColors.text });
            cx += fCols[0];
            pdfPage().drawText(fitTextToWidth(sanitizeWinAnsi(f.unite), font, 9, fCols[1] - 5), { x: cx, y: context.y, size: 9, font, color: themeColors.text });
            cx += fCols[1];
            missionLines.forEach((line, i) => {
                pdfPage().drawText(line, { x: cx, y: context.y - i * context.lineHeight, size: 9, font, color: themeColors.text });
            });
            context.y -= rowHeight;
        }
    }

    // --- 5. PHOTOS PAR CATÉGORIE ---
    const categories = PHOTO_CATEGORIES.filter(c => c.id !== 'all');
    const photoTotal = photos.filter((p) => categories.some((c) => c.id === p.category)).length;
    let photoDone = 0;
    const photoStep = (): void => { photoDone++; step(`photos (${photoDone}/${photoTotal})`); };
    for (const cat of categories) {
        const catPhotos = photos.filter(p => p.category === cat.id);
        if (catPhotos.length === 0) continue;

        addNewPage(`GALERIE : ${photoCategoryLabel(cat, mode).toUpperCase()}`, true); // Mode PAYSAGE
        for (let i = 0; i < catPhotos.length; i += 2) {
            // Une page paysage par paire de photos (toute la hauteur dispo).
            if (i > 0) addNewPage(`GALERIE : ${photoCategoryLabel(cat, mode).toUpperCase()} (SUITE)`, true);

            const photoWidth = (context.pageWidth - 3 * context.margin) / 2;
            const photoHeightMax = context.pageHeight - 2 * context.margin - 40; // Presque toute la hauteur

            const p1 = catPhotos[i];
            if (!p1) continue; // invariant : i < catPhotos.length (TypeScript ne suit pas la borne de boucle)
            photoStep();
            pdfPage().drawText(sanitizeWinAnsi(p1.title), { x: context.margin, y: context.y, size: 10, font: fontBold, color: themeColors.text });
            const y1 = await drawImageSafe(pdfPage(), p1.data, context.margin, context.y - 10, photoWidth, photoHeightMax);

            let y2 = context.y;
            if (i + 1 < catPhotos.length) {
                const p2 = catPhotos[i+1];
                if (p2) {
                    photoStep();
                    pdfPage().drawText(sanitizeWinAnsi(p2.title), { x: context.margin + photoWidth + context.margin, y: context.y, size: 10, font: fontBold, color: themeColors.text });
                    y2 = await drawImageSafe(pdfPage(), p2.data, context.margin + photoWidth + context.margin, context.y - 10, photoWidth, photoHeightMax);
                }
            }
            context.y = Math.min(y1, y2) - 30;
        }
    }

    // --- 6. PLAN TACTIQUE (carte MapLibre + liste des points) ---
    step('plan');
    // Défensif de bout en bout : la capture (faite une fois, `loadReportData`)
    // peut manquer ; cela n'interrompt jamais l'export.
    try {
        if (data.plan) {
            const capture = data.plan.capture;
            addNewPage('PLAN TACTIQUE', true); // Paysage A4
            if (capture) {
                const imgMaxWidth = context.pageWidth - 2 * context.margin;
                const imgMaxHeight = context.pageHeight - 2 * context.margin - 30;
                await drawImageSafe(pdfPage(), capture.dataUrl, context.margin, context.y - 5, imgMaxWidth, imgMaxHeight);
            } else {
                // Plus JAMAIS d'absence silencieuse : on le dit dans le PDF.
                pdfPage().drawText(
                    sanitizeWinAnsi('Carte non disponible au moment de l\'export. Ouvre l\'onglet Plan puis relance l\'export PDF.'),
                    { x: context.margin, y: context.y - 10, size: 12, font, color: themeColors.text }
                );
            }
        }

        // Liste des points (pings) — indépendante de la capture image.
        if (data.pins) {
            const pins = data.pins;
            if (pins.length > 0) {
                addNewPage('PLAN TACTIQUE - LISTE DES POINTS');
                // MGRS et case du carroyage (décision Nico 2026-09-24) : ce qu'on
                // annonce à la radio ; décimal gardé pour les SIG.
                const pCols: [number, number, number, number, number, number] = [140, 130, 40, 72, 72, 61]; // Label, MGRS, Case, Latitude, Longitude, Diamètre
                const pHeaders = ['Label', 'MGRS', 'Case', 'Latitude', 'Longitude', 'Diam. (m)'];

                const drawPinHeader = (): void => {
                    pdfPage().drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2 * context.margin, height: 20, color: themeColors.headerBg });
                    let px = context.margin + 5;
                    pHeaders.forEach((h, i) => {
                        pdfPage().drawText(h, { x: px, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
                        px += pCols[i] ?? 0; // pCols a 6 entrées fixes ; neutralise noUncheckedIndexedAccess
                    });
                    context.y -= 25;
                };
                drawPinHeader();

                const fmtCoord = (n: unknown): string => (typeof n === 'number' && isFinite(n)) ? n.toFixed(6) : 'N/C';
                const fmtDiam = (n: unknown): string => (typeof n === 'number' && isFinite(n)) ? Math.round(n).toString() : '-';

                for (const pin of pins) {
                    if (!pin || typeof pin !== 'object') continue;
                    // M3 — le libellé est replié (hauteur variable) au lieu
                    // d'être tronqué par « … » : le point tel qu'annoncé à
                    // la radio ne doit pas perdre son intitulé.
                    const labelLines = wrapText(pin.label, pCols[0] - 5, font, 9);
                    const rowHeight = Math.max(1, labelLines.length) * context.lineHeight + 6;
                    if (context.y - rowHeight < context.margin) { addNewPage('PLAN TACTIQUE - LISTE DES POINTS (SUITE)'); drawPinHeader(); }
                    let px = context.margin + 5;
                    labelLines.forEach((line, i) => {
                        pdfPage().drawText(line, { x: px, y: context.y - i * context.lineHeight, size: 9, font, color: themeColors.text });
                    });
                    px += pCols[0];
                    pdfPage().drawText(fitTextToWidth(sanitizeWinAnsi(pin.mgrs || 'N/C'), font, 8, pCols[1] - 5), { x: px, y: context.y, size: 8, font, color: themeColors.text });
                    px += pCols[1];
                    pdfPage().drawText(fitTextToWidth(sanitizeWinAnsi(pin.cell || '-'), fontBold, 9, pCols[2] - 5), { x: px, y: context.y, size: 9, font: fontBold, color: themeColors.text });
                    px += pCols[2];
                    pdfPage().drawText(fitTextToWidth(fmtCoord(pin.lat), font, 8, pCols[3] - 5), { x: px, y: context.y, size: 8, font, color: themeColors.text });
                    px += pCols[3];
                    pdfPage().drawText(fitTextToWidth(fmtCoord(pin.lng), font, 8, pCols[4] - 5), { x: px, y: context.y, size: 8, font, color: themeColors.text });
                    px += pCols[4];
                    pdfPage().drawText(fitTextToWidth(fmtDiam(pin.diameterM), font, 9, pCols[5] - 5), { x: px, y: context.y, size: 9, font, color: themeColors.text });

                    pdfPage().drawLine({
                        start: { x: context.margin, y: context.y - rowHeight + 13 },
                        end: { x: context.pageWidth - context.margin, y: context.y - rowHeight + 13 },
                        thickness: 0.5, color: themeColors.line, opacity: 0.3
                    });
                    context.y -= rowHeight;
                }
            }
        }
    } catch (planErr) {
        // Section entièrement optionnelle : on log et on continue l'export.
        console.warn('PDF Plan tactique ignoré :', planErr);
    }

    // --- 7. JOURNAL DES ACTIONS PC-TAC (entrées auto, en dernier) ---
    step('journal des actions');
    if (carteLogs.length > 0) {
        addNewPage('JOURNAL DES ACTIONS PC-TAC');
        const cCols: [number, number] = [70, 445]; // Heure, Action
        const drawCarteHeader = (): void => {
            pdfPage().drawRectangle({ x: context.margin, y: context.y - 5, width: context.pageWidth - 2 * context.margin, height: 20, color: themeColors.headerBg });
            pdfPage().drawText('Heure', { x: context.margin + 5, y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
            pdfPage().drawText('Action', { x: context.margin + 5 + cCols[0], y: context.y + 2, size: 9, font: fontBold, color: themeColors.text });
            context.y -= 25;
        };
        drawCarteHeader();

        let prevCarteDate: string | undefined;
        for (const entry of carteLogs) {
            let actionText = (entry.remarques || '').trim();
            if (entry.pax && entry.pax !== 'Carte' && !actionText.toLowerCase().startsWith(entry.pax.toLowerCase())) {
                actionText = `${entry.pax} ${actionText}`;
            }

            const lines = wrapText(actionText, cCols[1] - 10, font, 9);
            const daySep = entry.date && entry.date !== prevCarteDate;
            prevCarteDate = entry.date;
            const rowHeight = Math.max(1, lines.length) * context.lineHeight + 10;

            if (context.y - rowHeight - (daySep ? 18 : 0) < context.margin) {
                addNewPage('JOURNAL DES ACTIONS PC-TAC (SUITE)');
                drawCarteHeader();
            }

            if (daySep && entry.date) {
                pdfPage().drawText(sanitizeWinAnsi(`— ${fmtDay(entry.date)} —`), {
                    x: context.margin + 5, y: context.y, size: 9, font: fontBold, color: themeColors.text
                });
                context.y -= 18;
            }

            let y = context.y;
            const blockCount = Math.max(1, lines.length);
            for (let i = 0; i < blockCount; i++) {
                // M1 — action plus haute qu'une page : on la scinde avec
                // « (suite) » au lieu de perdre sa fin sous la feuille.
                if (y < context.margin + context.lineHeight) {
                    addNewPage('JOURNAL DES ACTIONS PC-TAC (SUITE)');
                    drawCarteHeader();
                    pdfPage().drawText(sanitizeWinAnsi(entry.heure), { x: context.margin + 5, y: context.y, size: 9, font, color: themeColors.text });
                    pdfPage().drawText('(suite)', { x: context.margin + 5 + cCols[0], y: context.y, size: 9, font: fontBold, color: themeColors.text });
                    y = context.y;
                } else if (i === 0) {
                    pdfPage().drawText(sanitizeWinAnsi(entry.heure), { x: context.margin + 5, y, size: 9, font, color: themeColors.text });
                }
                const line = lines[i];
                if (line) pdfPage().drawText(sanitizeWinAnsi(line), { x: context.margin + 5 + cCols[0], y, size: 9, font, color: themeColors.text });
                y -= context.lineHeight;
            }
            // `y` est déjà une ligne sous la dernière ligne dessinée :
            // séparateur sous le texte, comme dans la main courante.
            pdfPage().drawLine({
                start: { x: context.margin, y: y + 2 },
                end: { x: context.pageWidth - context.margin, y: y + 2 },
                thickness: 0.5, color: themeColors.line, opacity: 0.3
            });
            context.y = y - 10;
        }
    }

    // --- FOOTER : pagination + DIFFUSION RESTREINTE sur toutes les pages ---
    step('assemblage');
    const allPages = pdfDoc.getPages();
    const totalPages = allPages.length;
    const exportStamp = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const footerColor = pdfRgb(0.55, 0.55, 0.55);
    const restrictColor = pdfRgb(0.7, 0.15, 0.15);

    allPages.forEach((page, idx) => {
        const w = page.getWidth();
        const pageNum = `Page ${idx + 1} / ${totalPages}`;
        const numWidth = font.widthOfTextAtSize(pageNum, 8);
        const restrict = 'DIFFUSION RESTREINTE';

        // Ligne fine au-dessus du footer
        page.drawLine({
            start: { x: context.margin, y: 22 },
            end: { x: w - context.margin, y: 22 },
            thickness: 0.3, color: themeColors.line, opacity: 0.5
        });

        // Gauche : mention DIFFUSION RESTREINTE
        page.drawText(restrict, {
            x: context.margin, y: 10, size: 8, font: fontBold, color: restrictColor
        });
        // Centre : horodatage export
        const center = sanitizeWinAnsi(`PC TAC - Export ${exportStamp}`);
        const centerWidth = font.widthOfTextAtSize(center, 8);
        page.drawText(center, {
            x: (w - centerWidth) / 2, y: 10, size: 8, font, color: footerColor
        });
        // Droite : pagination
        page.drawText(pageNum, {
            x: w - context.margin - numWidth, y: 10, size: 8, font, color: footerColor
        });
    });

    return pdfDoc.save();
}

/**
 * Verrou de génération (double clic, second bouton) : un seul PDF à la fois,
 * rapport complet ou synthèse A3. Relâché dans tous les cas (finally).
 */
let pdfGenerating = false;

function refuseWhileGenerating(): boolean {
    if (!pdfGenerating) return false;
    toast('Un PDF est déjà en cours de génération : patientez.', { kind: 'info' });
    return true;
}

export const PdfExport: PdfExportContract = {
    async buildPdf(options?: PdfOptions): Promise<void> {
        if (refuseWhileGenerating()) return;
        pdfGenerating = true;
        // Sans choix explicite (appel hors fenêtre) : derniers choix retenus.
        const opts = options ?? loadPdfOptions('pctac', PCTAC_PDF_KINDS);
        showBusy('Génération du PDF : lecture des données…');
        try {
            // pdfExport.js:97-99 — en ESM le namespace importé n'est jamais `undefined` ;
            // on vérifie donc la présence réelle de la classe utilisée, message inchangé.
            if (typeof PDFLib?.PDFDocument !== 'function') {
                toast('Librairie pdf-lib non chargée (réseau ?). Réessaie dans quelques secondes.', { kind: 'error' });
                return;
            }
            const data = await loadReportData(opts.sortie);
            const budget = PDF_IMAGE_PROFILES[opts.sortie].budgetBytes;
            const { bytes: pdfBytes, overBudget } = await renderWithinBudget(
                (scale, attempt) => renderReport(data, { theme: opts.theme, sortie: opts.sortie, scale, attempt }),
                budget,
            );
            // pdf-lib type ses .d.ts contre un `Uint8Array` non générique ; sous les lib DOM
            // récentes (générique, cf. tsconfig), `Uint8Array<ArrayBufferLike>` n'est plus
            // directement assignable à `BlobPart` (`ArrayBufferView<ArrayBuffer>` attendu).
            // Assertion de type sans impact runtime (mêmes octets).
            const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            // Décision 32/34 — nom de fichier lisible, sans nom de personne.
            link.download = Utils.readableFileName(currentMode().label, new Date(), 'pdf');
            link.click();
            // Libère le blob une fois le téléchargement amorcé (sinon fuite mémoire).
            setTimeout(() => { try { URL.revokeObjectURL(link.href); } catch { /* no-op */ } }, 30000);
            // Décision 42 — poids annoncé (Tchap refuse les fichiers trop lourds).
            const weight = formatBytes(pdfBytes.length);
            const budgetMo = budget === null ? '' : `${Math.round(budget / (1024 * 1024))} Mo`;
            if (overBudget) {
                toast(`PDF prêt : ${weight}, au-delà des ${budgetMo} visés pour le Partage malgré des photos réduites au plus juste.`, { kind: 'error', duration: 10000 });
            } else {
                toast(budget === null ? `PDF prêt : ${weight}.` : `PDF prêt : ${weight} (Partage, moins de ${budgetMo}).`, { kind: 'success' });
            }
        } catch (e) {
            console.error("PDF Export Critical Error:", e);
            const detail: unknown = (e && typeof e === 'object' && 'message' in e) ? (e as { message: unknown }).message : e;
            toast("Erreur lors de la génération du PDF : " + String(detail), { kind: 'error' });
        } finally {
            // R23 — hors export, `sanitizeWinAnsi` garde son comportement d'origine.
            glyphChecker = null;
            pdfGenerating = false;
            hideBusy();
        }
    }
};

/**
 * Bouton PDF du dock (décision 42) : fenêtre de génération (rapport, thème,
 * sortie), puis le rapport complet ou la synthèse A3. « Annuler » = rien.
 */
export async function openPdfDialog(): Promise<void> {
    if (refuseWhileGenerating()) return;
    const options = await askPdfOptions({ appKey: 'pctac', title: 'Générer le PDF', kinds: PCTAC_PDF_KINDS });
    if (!options) return;
    if (options.kind === 'a3') {
        if (refuseWhileGenerating()) return;
        pdfGenerating = true;
        try {
            const { buildA3Pdf } = await import('@pctac/pdf-a3.js');
            await buildA3Pdf(options);
        } catch (e) {
            console.error('PDF A3 :', e);
            toast(`Synthèse A3 impossible : ${e instanceof Error ? e.message : String(e)}`, { kind: 'error' });
        } finally {
            pdfGenerating = false;
        }
        return;
    }
    await PdfExport.buildPdf(options);
}

// Pose le global au scope module, comme l'original (pdfExport.js:596).
window.PdfExport = PdfExport;
