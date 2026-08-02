/**
 * theme.ts — Thème PDF v3 de l'OI : palettes strategica, géométrie de page et
 * barèmes de police adaptative (SPEC-PDF-V3.md §2.1, paquet P2 « pdf-p2-theme »).
 *
 * Module PUR : zéro DOM, zéro pdfmake, zéro import applicatif. Toutes les
 * valeurs sont un port VERBATIM de `OrderPdfStyle.kt`/`OrderHtml.kt`
 * (Praxis-Rust, lecture seule) — chaque export renvoie vers sa source exacte
 * en commentaire. Consommé par `blocks.ts`, `document-builder.ts`
 * (voie A pdfmake) et `print-style.ts` (voie B impression HTML).
 */

/** Format de page de l'OI (les deux sont TOUJOURS en paysage, cf. pdf-engine-v2.ts:322-324). */
export type OiPdfFormat = 'a4' | '16:9';

/**
 * Palette de couleurs strategica. Port de `OrderPdfStyle.Palette`
 * (OrderPdfStyle.kt:14-26).
 */
export interface OiPdfPalette {
    bg: string;
    text: string;
    accent: string;
    danger: string;
    warning: string;
    border: string;
    headerRow: string;
    cardAlt: string;
    muted: string;
    watermarkOpacity: string;
    dark: boolean;
}

/** Palette claire strategica — port verbatim de `OrderPdfStyle.kt:30-42` (LIGHT). */
export const PDF_LIGHT: OiPdfPalette = {
    bg: '#ffffff',
    text: '#111111',
    accent: '#0033a0',
    danger: '#c0392b',
    warning: '#b45309',
    border: '#999999',
    headerRow: '#dddddd',
    cardAlt: '#f5f5f5',
    muted: '#555555',
    watermarkOpacity: '0.9',
    dark: false,
};

/** Palette sombre strategica — port verbatim de `OrderPdfStyle.kt:43-56` (DARK). */
export const PDF_DARK: OiPdfPalette = {
    bg: '#000000',
    text: '#e0e0e0',
    accent: '#5b9bd5',
    danger: '#ef4444',
    warning: '#eab308',
    border: '#666666',
    headerRow: '#333333',
    cardAlt: '#1c1c1c',
    muted: '#a1a1aa',
    watermarkOpacity: '0.6',
    dark: true,
};

/** Sélectionne la palette selon le thème — port de `OrderPdfStyle.kt:58` (`palette(theme)`). */
export function palette(isDark: boolean): OiPdfPalette {
    return isDark ? PDF_DARK : PDF_LIGHT;
}

/** 1 mm en points PDF (72 pt / 25.4 mm par pouce) — conversion utilisée par `pageGeometry`. */
const PT_PER_MM = 2.834645669291339;

/** Convertit une mesure en millimètres vers des points PDF (mm → pt, ×2.834645669291339). */
export function mm(valueMm: number): number {
    return valueMm * PT_PER_MM;
}

/**
 * Géométrie de page A4 paysage ou 16:9 (338 × 190,125 mm). Les dimensions en
 * points sont les valeurs MESURÉES au banc (`pdfinfo`, cf. SPEC-PDF-V3.md §1.4
 * et §3, `oi-reference/reference.pdf` pour 'a4', banc pdfmake pour '16:9') —
 * elles ne sont volontairement PAS recalculées via `mm()` : la conversion
 * mm→pt de 190,125 mm ne redonne pas exactement 539,01 pt (écart d'arrondi),
 * alors que 539,01 pt est la valeur littéralement renvoyée par `pdfinfo` sur
 * le PDF produit — c'est cette valeur mesurée qui fait foi.
 *
 * Marges = `[mm(11), mm(8), mm(11), mm(11)]` (gauche, haut, droite, bas),
 * identiques dans les deux formats — port des marges strategica
 * `OrderPdfStyle.kt:90` (`@page { margin: 8mm 0 11mm 0 }`, clair) et
 * `OrderPdfStyle.kt:95` (`padding: 0 11mm`, marges horizontales du body).
 */
export function pageGeometry(format: OiPdfFormat): {
    widthPt: number;
    heightPt: number;
    marginsPt: [number, number, number, number];
    contentWidthPt: number;
    contentHeightPt: number;
    landscape: true;
} {
    const widthPt = format === 'a4' ? 841.89 : 958.11;
    const heightPt = format === 'a4' ? 595.28 : 539.01;
    const marginLeft = mm(11);
    const marginTop = mm(8);
    const marginRight = mm(11);
    const marginBottom = mm(11);
    const marginsPt: [number, number, number, number] = [marginLeft, marginTop, marginRight, marginBottom];
    return {
        widthPt,
        heightPt,
        marginsPt,
        contentWidthPt: widthPt - marginLeft - marginRight,
        contentHeightPt: heightPt - marginTop - marginBottom,
        landscape: true,
    };
}

/**
 * Barème de police du corps de document — port verbatim de `fontPx()`
 * (OrderHtml.kt:87-97, commentaire ligne 86 : « legacy computeTotalTextLength :
 * <800=14, <1500=12, sinon 10 »). `volume` = somme des longueurs des champs
 * texte du document (situation générale/particulière, missions, blocs MOICP/
 * ZMSPCP…), calculée par l'appelant.
 */
export function documentFontPx(volume: number): number {
    if (volume < 800) return 14;
    if (volume < 1500) return 12;
    return 10;
}

/**
 * Barème de police adaptative d'une page dédiée — port verbatim de
 * `adaptivePagePx()` (OrderPdfStyle.kt:230-245). `total` = somme des
 * longueurs de `fields` + (nombre total de '\n' dans `fields` + `extraLines`)
 * × 60 — chaque retour-ligne « pèse » comme 60 caractères (approxime la place
 * verticale qu'il consomme).
 */
export function adaptivePagePx(fields: string[], extraLines = 0): number {
    const chars = fields.reduce((sum, field) => sum + field.length, 0);
    const lines =
        fields.reduce((sum, field) => sum + (field.match(/\n/g)?.length ?? 0), 0) + extraLines;
    const total = chars + lines * 60;
    if (total < 500) return 14;
    if (total < 1000) return 12;
    if (total < 1800) return 10;
    return 9;
}

/**
 * Barème de police du tableau PATRACDVR sur page dédiée — port verbatim de
 * `patracFontPx` (OrderHtml.kt:318-327, commentaire ligne 318-319 : « la
 * police suit le nombre de LIGNES du tableau »). `rowCount` = nombre total de
 * lignes affichées (véhicules + membres + non-affectés).
 */
export function patracFontPx(rowCount: number): number {
    if (rowCount <= 14) return 14;
    if (rowCount <= 22) return 12;
    if (rowCount <= 32) return 10;
    return 9;
}

/**
 * Budget approximatif d'items « à tiret » (ex. conduite à tenir ZMSPCP/MOICP,
 * `\n- item`) tenant sur UNE page dédiée à un palier de police donné —
 * modèle de pagination v2 (docs/SPEC-PDF-V3.md § Pagination v2, correctif
 * PG.IMPL). Mesure grossière par NOMBRE D'ITEMS plutôt que par caractère :
 * `document-builder.ts` reste un module PUR (zéro pdfmake en valeur, cf.
 * son en-tête) donc sans accès à la mesure réelle `pageSize:{height:Infinity}`
 * du banc (`pdfmake-pagination-bench` q5) — seule une heuristique est
 * possible ici, dans le même esprit que `adaptivePagePx`/`patracFontPx`
 * ci-dessus. Calibré empiriquement contre `tests/pdf/fixtures/long-case.json`
 * (bloc ZMSPCP à 20 items, `adaptivePagePx` le réduit au palier 9 → tient
 * largement sous ce budget, aucune scission nécessaire — vérifié guardrail
 * B1/B3). Sert de GARDE-FOU DE DERNIER RECOURS : la police adaptative
 * absorbe déjà l'immense majorité des volumes réels ; `document-builder.ts`
 * ne scinde un bloc à tirets en pages « (suite) » que si son nombre d'items
 * dépasse encore ce budget au palier choisi.
 */
export function catItemsPerPageBudget(fontPx: number): number {
    if (fontPx >= 14) return 12;
    if (fontPx >= 12) return 16;
    if (fontPx >= 10) return 20;
    return 26;
}

/**
 * Nombre approximatif de caractères qui tiennent sur UNE LIGNE d'une colonne
 * de `columnWidthPt` points de large au palier de police `fontPx` — police
 * monospace JetBrainsMono, chasse fixe approximée à 0,62 × la taille de
 * police (mesure grossière, même esprit qu'`adaptivePagePx`/`patracFontPx` :
 * aucune mesure de rendu réelle, cf. contrainte module pur
 * `document-builder.ts`). Correctif PG.REFIX round 1 : `catItemsPerPageBudget`
 * ci-dessus comptait chaque item « à tiret » pour 1 UNITÉ, quelle que soit sa
 * longueur — un item de 73-88 caractères dans une colonne `grid2` à demi-
 * largeur (~381 pt à 9 px) occupe en réalité 2 LIGNES rendues (jamais
 * comptabilisées, cause du défaut « queue orpheline sans (suite) » constaté
 * sur `tests/pdf/fixtures/long-case.json`). Combiné à `estimateWrappedLines`
 * ci-dessous, un item est désormais compté pour son coût RÉEL en lignes
 * (unité commune avec `catItemsPerPageBudget`, calibrée à l'origine sur des
 * items d'UNE ligne).
 */
export function estimateCharsPerLine(fontPx: number, columnWidthPt: number): number {
    return Math.max(1, Math.floor(columnWidthPt / (fontPx * 0.62)));
}

/**
 * Nombre de lignes réelles qu'occupera `item` une fois rendu à `charsPerLine`
 * caractères par ligne (`estimateCharsPerLine`) — arrondi au SUPÉRIEUR,
 * jamais 0 (même un item vide occupe au moins 1 ligne). Cf. JSDoc
 * `estimateCharsPerLine` pour le contexte du correctif.
 */
export function estimateWrappedLines(item: string, charsPerLine: number): number {
    return Math.max(1, Math.ceil(item.length / charsPerLine));
}

/**
 * Hauteur utile (mm) d'une page pleine (garde/finale) selon l'orientation,
 * marges verticales `@page` déduites (8 + 11 mm) — port verbatim de
 * `fullPageHeightMm()` (OrderPdfStyle.kt:60-62).
 */
export function fullPageHeightMm(landscape: boolean): number {
    return landscape ? 186 : 272;
}

/**
 * Hauteur utile (mm) de la galerie d'une page photo dédiée : la page pleine
 * moins la place du titre `<h2>` (~14 mm, marges comprises) — port verbatim
 * de `photoPageGalleryHeightMm()` (OrderPdfStyle.kt:64-68).
 */
export function photoPageGalleryHeightMm(landscape: boolean): number {
    return fullPageHeightMm(landscape) - 14;
}
