/**
 * blocks.ts — Primitives visuelles strategica exprimées en `Content` pdfmake
 * (SPEC-PDF-V3.md §2.1 « contrat blocks.ts », §3.1 tableau T4-T15, §3.3
 * galeries ; paquet P3 « pdf-p3-blocks »). Module PUR : zéro DOM, zéro
 * IndexedDB, zéro accès pdfmake en VALEUR (uniquement ses TYPES).
 *
 * pdfmake n'a NI `border-radius` NI `box-shadow` (écart E1, SPEC-PDF-V3.md
 * §7). Toute « carte » est donc une table 1×1 à bordure nette, et toute
 * « pilule » un cadre 1×1 séparé (jamais un fond arrondi). Les couleurs
 * (bordure/fond) sont TOUJOURS posées au niveau de la CELLULE (propriétés
 * `Style`/`TableCellProperties` : `fillColor`, `borderColor`, `color`) et
 * jamais figées dans les `CustomTableLayout` exportés (`LAYOUT_BORDERED`,
 * `LAYOUT_PILL`, `LAYOUT_NONE`) : ces trois constantes ne portent QUE la
 * géométrie (épaisseur de trait, remplissage/padding), pour rester
 * réutilisables telles quelles entre palette claire et sombre.
 *
 * Sources strategica (Praxis-Rust, lecture seule) : `OrderPdfStyle.kt`
 * (CSS, cf. renvois de ligne en commentaire par fonction), `OrderHtml.kt`
 * (page de garde/finale), `OrderHtmlPhotos.kt` (galeries `photoPages`,
 * lignes 69-92). Port du langage visuel : la STRUCTURE (14 sections de
 * l'OI TacSuite) reste la nôtre, portée par `document-builder.ts`.
 */
import type { Column, Content, CustomTableLayout, TableCell } from 'pdfmake/interfaces';

import { mm, pageGeometry, PDF_H2_BLOCK_PT, type OiPdfPalette } from './theme.js';
import { breakLongTokens } from './text-utils.js';
import type { ImageSize } from './image-size.js';
import { layoutGallery, layoutSplitPage, photoShape, type GalleryPhoto, type GallerySlot, type PhotoShape } from '@shared/photo-layout.js';
import type { OiPdfEditAnchor, OiPhotoMeta } from '@shared/types/contracts.js';

// --- Édition en place depuis l'aperçu PDF (index d'ancrage, mission ---------
// « régression édition »/SPEC-2026-08-18-pdf-et-champs.md §2) --------------

/**
 * Référence d'ancrage qu'un SITE D'APPEL fournit à `labelValue`/`kvTable`
 * (et, dans `document-builder.ts`, à `dashItemList`/aux call-sites directs
 * `accentCard`) pour désigner le champ `#oi-form` SOURCE d'une valeur émise —
 * `document-builder.ts` construit ces sélecteurs (helpers `fieldAnchor`/
 * `advFieldAnchor`/`blockFieldAnchor`/`indexedFieldAnchor`), CE FICHIER reste
 * agnostique de leur forme exacte (simple chaîne CSS + rang optionnel).
 */
export interface PdfFieldAnchor {
    selector: string;
    /** Défaut 0 — cf. `OiPdfEditAnchor.index`. */
    index?: number;
    /** Transmis tel quel à `OiPdfEditAnchor.kind` — cf. sa JSDoc (`contracts.ts`). */
    kind?: 'field' | 'dataset';
    /** Transmis tel quel à `OiPdfEditAnchor.datasetKey` — requis si `kind === 'dataset'`. */
    datasetKey?: string;
}

/**
 * Enregistre une valeur émise dans l'index d'ancrage `anchors` (porté par
 * `BuildCtx.anchors`, `document-builder.ts`) — SEUL point d'écriture de cet
 * index, appelé par `labelValue`/`kvTable` ci-dessous ET directement par les
 * quelques sites de `document-builder.ts` dont le texte ne transite par
 * aucun des deux (ex. `accentCard`, dont le corps est un `Content[]`
 * arbitraire construit par l'appelant — aucune valeur unique à intercepter).
 * No-op si `anchors`/`ref` est absent (opt-in : la plupart des call-sites de
 * ce module ne portent aucune donnée `#oi-form`, titres/libellés/valeurs
 * dérivées) OU si `value` est vide/repli `'-'` — même définition « valeur
 * vide » que `document-builder.ts::isBlankOrDash` (un tiret seul n'est
 * jamais une donnée SAISIE, seulement un repli d'affichage : l'ancrer
 * n'apporterait aucune correction utile et gonflerait l'index pour rien).
 */
export function registerPdfEditAnchor(anchors: OiPdfEditAnchor[] | undefined, ref: PdfFieldAnchor | null | undefined, value: string): void {
    if (!anchors || !ref) return;
    const v = value.trim();
    if (v === '' || v === '-') return;
    // `exactOptionalPropertyTypes` : `kind`/`datasetKey` ne sont ajoutés QUE
    // s'ils sont réellement définis sur `ref` (jamais une propriété présente
    // valant explicitement `undefined`, que le type cible n'accepte pas).
    const anchor: OiPdfEditAnchor = { selector: ref.selector, index: ref.index ?? 0, value };
    if (ref.kind !== undefined) anchor.kind = ref.kind;
    if (ref.datasetKey !== undefined) anchor.datasetKey = ref.datasetKey;
    anchors.push(anchor);
}

// --- Layouts de table génériques (géométrie seule, cf. en-tête de fichier). ---

/**
 * « Carte » / tableau bordé générique — port de `.box`/`.k`
 * (OrderPdfStyle.kt:114, :121-122) : bordure 1 pt, padding 4 pt (aligné sur
 * `td,th{padding:4px}`, OrderPdfStyle.kt:110-111). Couleur de bordure/fond
 * posée par l'appelant (`card`, `kvTable`) via les propriétés de cellule.
 */
export const LAYOUT_BORDERED: CustomTableLayout = {
    hLineWidth: () => 1,
    vLineWidth: () => 1,
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: () => 4,
    paddingBottom: () => 4,
};

/**
 * « Pilule » — port de `.pill` (OrderPdfStyle.kt:137-139) : bordure 1 pt,
 * marges 2 pt (haut/bas) / 9 pt (gauche/droite), verbatim `padding:2px 9px`.
 * Couleur de bordure/fond posée par `pill()` via `borderColor`/`fillColor`
 * de cellule (palette-dépendante, non figeable dans cette constante).
 */
export const LAYOUT_PILL: CustomTableLayout = {
    hLineWidth: () => 1,
    vLineWidth: () => 1,
    paddingLeft: () => 9,
    paddingRight: () => 9,
    paddingTop: () => 2,
    paddingBottom: () => 2,
};

/** Table sans bordure ni padding — grille de pilules (`pillRow`/`badgeRow`)
 *  et conteneur 2 colonnes des `accentCard` (le liseré doit affleurer). */
export const LAYOUT_NONE: CustomTableLayout = {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: () => 0,
    paddingBottom: () => 0,
};

/**
 * Cadre à bordure/remplissage arbitraires (largeur de trait + couleur ne
 * correspondant à AUCUNE des trois constantes ci-dessus) — utilisé en
 * interne par `h1` (encadré 4 pt, OrderHtml.kt:118) et `figure` (encadré
 * 2 pt, OrderPdfStyle.kt:143-144), toutes deux palette-dépendantes.
 */
function frameLayout(
    borderWidthPt: number,
    borderColor: string,
    opts?: { fillColor?: string | undefined; paddingPt?: number | undefined },
): CustomTableLayout {
    const paddingPt = opts?.paddingPt ?? 0;
    return {
        hLineWidth: () => borderWidthPt,
        vLineWidth: () => borderWidthPt,
        hLineColor: () => borderColor,
        vLineColor: () => borderColor,
        paddingLeft: () => paddingPt,
        paddingRight: () => paddingPt,
        paddingTop: () => paddingPt,
        paddingBottom: () => paddingPt,
        fillColor: opts?.fillColor,
    };
}

// --- Titres --------------------------------------------------------------

/**
 * `h1` — port de `h1{font-family:Oswald;color:accent}` (OrderPdfStyle.kt:96-97)
 * et de l'encadré 4 pt de la page de garde (`OrderHtml.kt:118`).
 */
export function h1(text: string, p: OiPdfPalette, opts?: { fontSize?: number; boxed?: boolean }): Content {
    const fontSize = opts?.fontSize ?? 36;
    const label: Content = {
        text,
        font: 'Oswald',
        fontSize,
        color: p.accent,
        alignment: 'center',
    };
    if (!opts?.boxed) {
        return label;
    }
    return {
        table: { widths: ['*'], body: [[label]] },
        // mm(5) ≈ le padding généreux de OrderHtml.kt:118 (18px/30px CSS),
        // approximation assumée — aucune valeur pt exacte n'est imposée.
        layout: frameLayout(4, p.accent, { paddingPt: mm(5) }),
    };
}

/**
 * `h2` — port de `h2{border-bottom:2px solid accent;page-break-after:avoid}`
 * (OrderPdfStyle.kt:98-101) : titre Oswald 17 pt MAJUSCULES + filet 2 pt
 * pleine largeur en lieu et place du `border-bottom` CSS. `unbreakable`
 * reproduit `page-break-after:avoid`.
 *
 * `text` traverse `breakLongTokens()` (blindage BLIND.A #2, `text-utils.ts`)
 * AVANT `.toUpperCase()` — les titres dynamiques (`Articulation : ZMSPCP -
 * <titre>`, etc.) peuvent embarquer un titre saisi arbitrairement long/sans
 * espace ; le SOFT HYPHEN de coupure inséré (round 1 BLIND.REFIX, cf.
 * `text-utils.ts`) n'est pas une lettre, `.toUpperCase()` le laisse intact.
 *
 * `opts.suffix` (mission R6, titrage galeries photo) — fragment discret
 * accolé au titre (ex. « PHOTO 2/5 ») : rendu dans le MÊME run Oswald 17 pt
 * mais en `p.muted` (au lieu de `p.accent`), jamais en gras — signale
 * visuellement un COMPTEUR de page, pas une continuation de titre (bannie,
 * cf. interdiction absolue « (SUITE) », `verify-structure.mjs` garde C1).
 * `text` seul traverse `.toUpperCase()` ; `suffix` est fourni DÉJÀ dans la
 * casse voulue par l'appelant (`galleryPages` le fournit majuscule).
 */
export function h2(text: string, p: OiPdfPalette, contentWidthPt: number, opts?: { suffix?: string }): Content {
    const titleRun: Content = {
        text: breakLongTokens(text).toUpperCase(),
        font: 'Oswald',
        fontSize: 17,
        color: p.accent,
    };
    const titleLine: Content =
        opts?.suffix !== undefined && opts.suffix !== ''
            ? {
                  text: [titleRun, { text: ` ${opts.suffix}`, font: 'Oswald', fontSize: 17, color: p.muted }],
                  margin: [0, 0, 0, 3],
              }
            : { ...titleRun, margin: [0, 0, 0, 3] };
    return {
        stack: [
            titleLine,
            {
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidthPt, y2: 0, lineWidth: 2, lineColor: p.accent }],
                margin: [0, 0, 0, 8],
            },
        ],
        unbreakable: true,
    };
}

/**
 * `h3` — port de `h3{font-weight:bold;text-decoration:underline;color:accent;
 * page-break-after:avoid}` (OrderPdfStyle.kt:102-103). `opts.color` permet le
 * filet DANGEROSITÉ en `p.danger` (fiche adversaire, §3.2 ligne 2).
 */
export function h3(text: string, p: OiPdfPalette, opts?: { color?: string }): Content {
    return {
        text,
        fontSize: 12,
        bold: true,
        decoration: 'underline',
        color: opts?.color ?? p.accent,
    };
}

// --- Champs ----------------------------------------------------------------

/**
 * `labelValue` — port de `.label`/`.value` (pdf-engine-v2.ts:709-710) :
 * libellé MAJUSCULE gras accent suivi de « : », valeur en texte simple.
 * `preserveLeadingSpaces` reproduit `white-space:pre-wrap`. `value` traverse
 * `breakLongTokens()` (blindage BLIND.A #2, `text-utils.ts`) — `label` ne
 * porte jamais de donnée du Store (libellé métier fixe), non concerné.
 */
export function labelValue(
    label: string,
    value: string,
    p: OiPdfPalette,
    opts?: { fontSize?: number; valueColor?: string; valueBold?: boolean },
    /** Édition en place (mission « régression édition ») — cf. `registerPdfEditAnchor`. Omis : `value` n'est pas ancrée (titre/libellé fixe ou valeur dérivée). */
    edit?: { anchors: OiPdfEditAnchor[]; ref: PdfFieldAnchor },
): Content {
    if (edit) registerPdfEditAnchor(edit.anchors, edit.ref, value);
    return {
        text: [
            { text: `${label.toUpperCase()} : `, bold: true, color: p.accent },
            { text: breakLongTokens(value), color: opts?.valueColor, bold: opts?.valueBold },
        ],
        fontSize: opts?.fontSize,
        preserveLeadingSpaces: true,
    };
}

// --- Cartes ------------------------------------------------------------------

/**
 * `card` — port de `.box{border:1px solid border;padding:8px;
 * page-break-inside:avoid}` (OrderPdfStyle.kt:121-122). Rayon/ombre CSS
 * abandonnés (écart E1, aucun équivalent pdfmake). SANS `opts.fillColor`,
 * transparente (aucune clé `fillColor` posée) : `.box` n'a **aucune**
 * propriété `background` (print-style.ts:73-74), elle montre le fond de PAGE
 * à travers son cadre — un fond `p.cardAlt` systématique était un défaut
 * (D8, `pdfv3-design-fix/DEFAUTS.md`), corrigé ici. `opts.fillColor` reste le
 * seul moyen d'obtenir un fond plein (ex. `accentCard`/`kvTable` posent le
 * leur eux-mêmes, hors de `card`).
 *
 * `opts.unbreakable` (défaut `true`, comportement historique préservé
 * partout ailleurs) — correctif PG.REFIX round 1 : pour une carte posée en
 * COLONNE ÉTROITE (`grid2`, ex. `situationCard` de la couverture), `columns`
 * pdfmake ne SYNCHRONISE PAS ses colonnes pour la pagination — un contenu
 * `unbreakable` qui ne tient plus dans la place restante de la page COURANTE
 * est reporté EN BLOC sur la page suivante (défaut « carte esseulée » : la
 * colonne voisine, plus courte, reste seule sur la première page, 2/3 vide).
 * `unbreakable:false` laisse la carte se scinder normalement au fil du texte
 * — seul recours quand même le palier de police le plus bas ne suffit pas à
 * la faire tenir intégralement sur la page courante.
 */
export function card(body: Content[], p: OiPdfPalette, opts?: { fillColor?: string; unbreakable?: boolean }): Content {
    return {
        table: {
            widths: ['*'],
            body: [
                [
                    {
                        stack: body,
                        ...(opts?.fillColor !== undefined ? { fillColor: opts.fillColor } : {}),
                        borderColor: [p.border, p.border, p.border, p.border],
                    },
                ],
            ],
        },
        layout: LAYOUT_BORDERED,
        unbreakable: opts?.unbreakable ?? true,
    };
}

/**
 * `accentCard` — port de `.accent-card`/`.danger-card`/`.warning-card`
 * (OrderPdfStyle.kt:131-136) : liseré gauche 6 pt de la couleur du `kind`,
 * fond `p.cardAlt`, sans bordure. `title` optionnel (les cartes CAT/liaison
 * de la section 8 n'en ont pas toutes, §3.2 ligne 9).
 *
 * `opts.unbreakable` (défaut `true`, comportement historique préservé) —
 * blindage BLIND.A (audit « tout `unbreakable` restant a un filet ») : un
 * champ de texte libre non borné (`missions_psig`, `cat_generales`, `no_go`,
 * `cat_liaison`…) posé dans un `accentCard` insécable est exposé au MÊME
 * risque de suppression silencieuse par pdfmake que R11 (`document-builder.ts`,
 * matrice-rupture.md §2/§3) s'il dépasse une page. `unbreakable:false`
 * (posé par les appelants concernés, `document-builder.ts::buildMission`/
 * `buildCatPage`) est le même filet minimal que `card({unbreakable:false})`.
 */
export function accentCard(
    title: string | null,
    body: Content[],
    p: OiPdfPalette,
    kind: 'accent' | 'danger' | 'warning' | 'uda',
    opts?: { unbreakable?: boolean },
): Content {
    const stripeColor = kind === 'danger' ? p.danger : kind === 'warning' ? p.warning : kind === 'uda' ? p.uda : p.accent;
    const titleNode: Content[] =
        title !== null && title !== '' ? [{ text: title, bold: true, color: p.accent, margin: [0, 0, 0, 4] }] : [];
    return {
        table: {
            widths: [6, '*'],
            body: [
                [
                    { text: '', fillColor: stripeColor },
                    { stack: [...titleNode, ...body], fillColor: p.cardAlt, margin: [8, 6, 6, 6] },
                ],
            ],
        },
        layout: LAYOUT_NONE,
        unbreakable: opts?.unbreakable ?? true,
    };
}

// --- Mise en page --------------------------------------------------------

/** `grid2` — port de `.row/.col` en paysage (OrderPdfStyle.kt:115-116). */
export function grid2(left: Content[], right: Content[], gapPt?: number): Content {
    return {
        columns: [
            { width: '*', stack: left },
            { width: '*', stack: right },
        ],
        columnGap: gapPt ?? mm(6),
    };
}

// --- Pilules / badges ------------------------------------------------------

/**
 * `pill` — port de `.pill` (OrderPdfStyle.kt:137-139) : cadre 1×1 bordé
 * `LAYOUT_PILL`, bordure `p.accent` posée par cellule. `opts.index` produit
 * le préfixe numéroté `"N "` en gras accent (port verbatim de la pastille
 * `pdf-engine-v2.ts:1047`, ex. Ordre Rame VL/Colonne Progression).
 * `opts.fillColor`/`opts.textColor` restent utilisables directement par un
 * appelant qui veut une pilule pleine à CADRE NET (bordure/fond de cellule
 * classique) — `pillRow`/`badgeRow` ne passent plus par ce chemin pour le
 * badge outil premium (fond translucide + coins arrondis), cf.
 * `layoutToolBadges` ci-dessous.
 */
export function pill(
    text: string,
    p: OiPdfPalette,
    opts?: { fillColor?: string; textColor?: string; index?: number },
): TableCell {
    // Blindage BLIND.A #2 (`text-utils.ts`) : un trigramme/outil/URL saisi
    // sans espace au-delà du seuil est cassé au rendu, jamais en amont.
    const brokenText = breakLongTokens(text);
    const textValue: Content =
        opts?.index !== undefined
            ? [{ text: `${opts.index + 1} `, bold: true, color: p.accent }, { text: brokenText }]
            : brokenText;
    return {
        table: {
            widths: ['auto'],
            body: [
                [
                    {
                        text: textValue,
                        color: opts?.textColor,
                        fillColor: opts?.fillColor,
                        borderColor: [p.accent, p.accent, p.accent, p.accent],
                        alignment: 'center',
                    },
                ],
            ],
        },
        layout: LAYOUT_PILL,
    };
}

/**
 * Grille commune à `pillRow`/`badgeRow` pour les pilules GÉNÉRIQUES (cadre
 * net `LAYOUT_PILL`, jamais de fond translucide) : pdfmake ne sait pas faire
 * retourner une ligne de `columns` — les éléments sont donc DÉCOUPÉS en
 * lignes de `perRow` cellules d'une table `LAYOUT_NONE`, la dernière ligne
 * étant complétée par des cellules vides `{ text: '' }` (pdfmake exige un
 * nombre de colonnes constant par ligne).
 */
function pillGrid(
    items: string[],
    p: OiPdfPalette,
    perRow: number,
    opts: { numbered: boolean },
): Content {
    if (items.length === 0) {
        return { text: '' };
    }
    const rows: TableCell[][] = [];
    for (let i = 0; i < items.length; i += perRow) {
        const rowItems = items.slice(i, i + perRow);
        const row: TableCell[] = rowItems.map((item, j) =>
            pill(item, p, {
                ...(opts.numbered ? { index: i + j } : {}),
            }),
        );
        while (row.length < perRow) {
            row.push({ text: '' });
        }
        rows.push(row);
    }
    return {
        table: { widths: new Array(perRow).fill('*') as Array<'*'>, body: rows },
        layout: LAYOUT_NONE,
    };
}

// --- Badges outils (redesign premium, directive Nico 2026-08-10) -----------

/**
 * Petite conversion hexadécimale (`#rrggbb` -> `[r,g,b]`) — support pur du
 * mélange de couleur ci-dessous, zéro DOM/canvas (module PUR, cf. en-tête).
 */
function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    const value = parseInt(clean, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Mélange `fg` sur `bg` à l'opacité `alpha` (0-1) — pdfmake/pdfkit ne
 * composite pas de couleur translucide fiable sur un remplissage de
 * cellule/canvas ; on précalcule donc le résultat en un hex OPAQUE
 * équivalent (« fond or translucide ~12-16 % » = ce mélange contre le fond
 * de PAGE réel, `p.bg`).
 */
function blendHex(fg: string, bg: string, alpha: number): string {
    const [fr, fgg, fb] = hexToRgb(fg);
    const [br, bgg, bb] = hexToRgb(bg);
    return rgbToHex(fr * alpha + br * (1 - alpha), fgg * alpha + bgg * (1 - alpha), fb * alpha + bb * (1 - alpha));
}

/**
 * Badge « outil d'effraction » — redesign premium (directive Nico
 * 2026-08-10) : remplace l'ancien `.tool-badge` plein-jaune. pdfmake n'a NI
 * `border-radius` NI opacité de remplissage fiable sur cellule de table (cf.
 * en-tête de fichier) : le fond or translucide est donc PRÉCALCULÉ
 * (`blendHex`, ~14 % de `baseColor` sur `p.bg`) et les coins arrondis
 * réellement dessinés en `canvas` (`CanvasRect.r`, seul primitif pdfmake qui
 * les supporte) — un rectangle arrondi dimensionné exactement au texte, la
 * légende étant SUPERPOSÉE dessus via une marge négative (`stack` : chaque
 * élément peut remonter sur le précédent avec un `margin` top négatif,
 * technique standard pdfmake pour émuler un fond derrière du texte).
 * `baseColor` sert à la fois de teinte de fond (mélangée) ET de couleur de
 * texte : `p.warning` est DÉJÀ calibré par palette (ambre foncé lisible sur
 * fond clair PDF_LIGHT, jaune clair lisible sur fond noir PDF_DARK,
 * `theme.ts`), donc le contraste sur les DEUX palettes est déjà résolu sans
 * introduire de nouveau token.
 */
const TOOL_BADGE_FONT_PT = 8;
/** Plancher de police (pt) — dernier recours quand un MOT SEUL (aucun
 *  espace pour couper) excède la largeur disponible : réduit la police du
 *  badge concerné plutôt que de jamais couper le mot (revue design
 *  2026-08-10, défaut #1 « coupure de mots interdite »). */
const TOOL_BADGE_MIN_FONT_PT = 7;
const TOOL_BADGE_TRACKING_PT = 0.6;
const TOOL_BADGE_PAD_X_PT = 8;
const TOOL_BADGE_PAD_Y_PT = 4;
const TOOL_BADGE_RADIUS_PT = 3.5;
const TOOL_BADGE_BORDER_PT = 0.5;
const TOOL_BADGE_LINE_HEIGHT_FACTOR = 1.35;
/** Gouttière (pt) entre badges — appliquée horizontalement (`columnGap`
 *  d'une rangée `layoutToolBadges`) ET verticalement (marge basse de chaque
 *  rangée) pour une grille régulière. */
const TOOL_BADGE_GUTTER_PT = mm(2);
/** Cap de design (pt) — une puce reste un « chip » compact : même dans un
 *  conteneur très large (galerie pleine page), un libellé multi-mots ne
 *  s'étire pas sur toute la largeur disponible, il s'enveloppe à ce budget
 *  (mesure/ligne). N'entre en jeu que pour les libellés vraiment longs — la
 *  plupart des noms d'outils du catalogue (HDR50, VIGIK, Pied de biche…)
 *  tiennent largement en dessous sur une seule ligne. */
const TOOL_BADGE_MAX_WIDTH_PT = 140;

/** Largeur (pt) d'une chaîne à `fontSizePt` — police JetBrainsMono (chasse
 *  fixe, `defaultStyle.font` de `document-builder.ts`), même facteur 0,62
 *  que `estimateCharsPerLine` (theme.ts), directement applicable ici (pas
 *  une approximation supplémentaire). */
function measureTextWidthPt(text: string, fontSizePt: number): number {
    const chars = Math.max(1, text.length);
    return chars * fontSizePt * 0.62 + Math.max(0, chars - 1) * TOOL_BADGE_TRACKING_PT;
}

/**
 * Choisit la plus grande police entre `TOOL_BADGE_FONT_PT` et
 * `TOOL_BADGE_MIN_FONT_PT` (pas de 0,5 pt) à laquelle `longestWord` tient
 * dans `maxTextWidthPt` — revue design 2026-08-10, défaut #1 : la coupure de
 * mots (mi-mot) est INTERDITE, le seul levier pour un mot unique trop large
 * est de réduire SA police jusqu'au plancher. Aucun palier ne suffit (mot
 * pathologiquement long, hors tout catalogue d'outils réel) -> le plancher
 * est retenu quand même (dépassement résiduel accepté plutôt qu'une
 * coupure).
 */
function pickFontSizeForLongestWord(longestWord: string, maxTextWidthPt: number): number {
    for (let fontSizePt = TOOL_BADGE_FONT_PT; fontSizePt >= TOOL_BADGE_MIN_FONT_PT; fontSizePt -= 0.5) {
        if (measureTextWidthPt(longestWord, fontSizePt) <= maxTextWidthPt) {
            return fontSizePt;
        }
    }
    return TOOL_BADGE_MIN_FONT_PT;
}

/** Dimensions + contenu d'UN badge (fonction PURE, testée isolément). */
interface ToolBadgeDims {
    /** Lignes déjà réparties AUX ESPACES (jamais de coupure mi-mot). */
    lines: string[];
    fontSizePt: number;
    /** Largeur du badge = largeur de sa ligne la plus large (+ padding) —
     *  « la largeur de puce s'adapte au mot le plus long de son libellé ». */
    widthPt: number;
    /** Hauteur NATURELLE de ce badge SEUL (avant mise à niveau de rangée,
     *  cf. `layoutToolBadges`/défaut #2 « hauteur uniforme par rangée »). */
    contentHeightPt: number;
}

/**
 * Dimensions d'UN badge une fois son texte mis en petites capitales —
 * fonction PURE, réutilisée par `toolBadgeChip` (rendu) ET
 * `galleryToolsReservePt` (réserve verticale). `maxWidthPt` est la largeur
 * TOTALE disponible pour la rangée courante (largeur de page/colonne) : un
 * libellé multi-mots s'enveloppe à la largeur de son PROPRE mot le plus
 * long (jamais plus étroit — aucun mot n'a donc jamais besoin d'être coupé),
 * sauf si CE mot dépasse déjà `maxWidthPt` à lui seul, auquel cas la police
 * du badge est réduite (`pickFontSizeForLongestWord`) — jamais de coupure de
 * mot (revue design 2026-08-10).
 */
function toolBadgeDims(rawText: string, maxWidthPt: number): ToolBadgeDims {
    const label = rawText.toUpperCase().trim();
    const words = label.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
        words.push('');
    }
    const usableContainerWidthPt = Math.max(TOOL_BADGE_FONT_PT, maxWidthPt - TOOL_BADGE_PAD_X_PT * 2);
    const longestWord = words.reduce((a, b) => (b.length > a.length ? b : a), words[0] as string);
    // Budget de repli d'UNE ligne : le plus PETIT entre le cap de design
    // `TOOL_BADGE_MAX_WIDTH_PT` (une puce reste un « chip » compact, jamais
    // une phrase qui s'étire sur toute la largeur dispo) et la largeur RÉELLE
    // du conteneur — jamais plus étroit que le mot le plus long (sinon
    // coupure mi-mot), quitte à réduire la police (`pickFontSizeForLongestWord`).
    const capPt = Math.min(TOOL_BADGE_MAX_WIDTH_PT, usableContainerWidthPt);
    const fontSizePt = pickFontSizeForLongestWord(longestWord, capPt);
    const wrapWidthPt = Math.max(capPt, measureTextWidthPt(longestWord, fontSizePt));

    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        if (current === '') {
            current = word;
            continue;
        }
        const candidate = `${current} ${word}`;
        if (measureTextWidthPt(candidate, fontSizePt) <= wrapWidthPt) {
            current = candidate;
        } else {
            lines.push(current);
            current = word;
        }
    }
    lines.push(current);

    const widestLinePt = Math.max(...lines.map((l) => measureTextWidthPt(l, fontSizePt)));
    const lineHeightPt = fontSizePt * TOOL_BADGE_LINE_HEIGHT_FACTOR;
    return {
        lines,
        fontSizePt,
        widthPt: widestLinePt + TOOL_BADGE_PAD_X_PT * 2,
        contentHeightPt: lines.length * lineHeightPt + TOOL_BADGE_PAD_Y_PT * 2,
    };
}

/**
 * Rendu d'UN badge — fond arrondi (`canvas`) + légende superposée (marge
 * négative, cf. JSDoc `TOOL_BADGE_*` plus haut). `rowHeightPt` (défaut #2,
 * revue design 2026-08-10) est la hauteur RETENUE POUR TOUTE LA RANGÉE (le
 * badge le plus haut fait foi, cf. `layoutToolBadges`) : le rectangle de
 * fond est dessiné à CETTE hauteur (jamais `dims.contentHeightPt` seul), le
 * texte étant centré verticalement dans cet espace — plus de rangée aux
 * hauteurs chaotiques. Le rectangle épouse EXACTEMENT `dims.widthPt`
 * (mesurée du texte réel + padding, jamais une largeur de colonne théorique
 * plus étroite) — défaut #3 (filet qui débordait) : plus aucun écart entre
 * la boîte dessinée et le texte qu'elle encadre.
 */
function toolBadgeChip(dims: ToolBadgeDims, rowHeightPt: number, p: OiPdfPalette, baseColor: string): Content {
    const bg = blendHex(baseColor, p.bg, 0.14);
    const border = blendHex(baseColor, p.border, 0.5);
    const textBlockHeightPt = dims.lines.length * dims.fontSizePt * TOOL_BADGE_LINE_HEIGHT_FACTOR;
    const verticalPadPt = Math.max(TOOL_BADGE_PAD_Y_PT, (rowHeightPt - textBlockHeightPt) / 2);
    return {
        stack: [
            {
                canvas: [
                    {
                        type: 'rect',
                        x: 0,
                        y: 0,
                        w: dims.widthPt,
                        h: rowHeightPt,
                        r: TOOL_BADGE_RADIUS_PT,
                        color: bg,
                        lineColor: border,
                        lineWidth: TOOL_BADGE_BORDER_PT,
                    },
                ],
            },
            {
                // `\n` EST honoré par pdfmake comme saut de ligne FORCÉ mais
                // invisible au rendu (`TextBreaker.js::splitWords`, cf.
                // `text-utils.ts` en-tête) — les lignes ont déjà été réparties
                // AUX ESPACES par `toolBadgeDims`, jamais mi-mot.
                text: dims.lines.join('\n'),
                fontSize: dims.fontSizePt,
                characterSpacing: TOOL_BADGE_TRACKING_PT,
                color: baseColor,
                alignment: 'center',
                lineHeight: TOOL_BADGE_LINE_HEIGHT_FACTOR,
                // Marge haut négative = remonte ce texte SUR le canvas dessiné
                // juste avant (technique standard pdfmake de superposition en
                // `stack`) ; centrage vertical via `verticalPadPt`.
                margin: [TOOL_BADGE_PAD_X_PT, verticalPadPt - rowHeightPt, TOOL_BADGE_PAD_X_PT, 0],
            },
        ],
    };
}

/**
 * Empaquetage en rangées (flow-wrap classique, revue design 2026-08-10) :
 * chaque badge garde SA largeur propre (`toolBadgeDims`, jamais de grille à
 * colonnes fixes), une rangée se referme dès que le badge suivant ne
 * tiendrait plus dans `containerWidthPt`. Fonction PURE partagée entre
 * `layoutToolBadges` (rendu) ET `galleryToolsReservePt` (réserve verticale)
 * pour que les deux ne divergent JAMAIS sur le nombre de rangées produites.
 */
function packToolBadgeRows(items: readonly string[], containerWidthPt: number): ToolBadgeDims[][] {
    const dimsList = items.map((item) => toolBadgeDims(item, containerWidthPt));
    const rows: ToolBadgeDims[][] = [];
    let currentRow: ToolBadgeDims[] = [];
    let currentRowWidthPt = 0;
    for (const dims of dimsList) {
        const addedWidthPt = dims.widthPt + (currentRow.length > 0 ? TOOL_BADGE_GUTTER_PT : 0);
        if (currentRow.length > 0 && currentRowWidthPt + addedWidthPt > containerWidthPt) {
            rows.push(currentRow);
            currentRow = [];
            currentRowWidthPt = 0;
        }
        currentRow.push(dims);
        currentRowWidthPt += dims.widthPt + (currentRow.length > 1 ? TOOL_BADGE_GUTTER_PT : 0);
    }
    if (currentRow.length > 0) {
        rows.push(currentRow);
    }
    return rows;
}

/**
 * Empile les badges d'outils en FLOW (revue design 2026-08-10) : gouttières
 * régulières (`TOOL_BADGE_GUTTER_PT`) horizontalement ET verticalement,
 * hauteur d'une rangée = celle de son badge le plus haut (défaut #2 —
 * hauteur uniforme). `containerWidthPt` doit être la largeur RÉELLE
 * disponible (connue de l'appelant) — cf. `galleryPhotoStack` (largeur de la
 * photo) ; à défaut (appelant hors blocks.ts sans le contexte de largeur,
 * ex. `document-builder.ts` colonne photo de porte d'effraction, `mm(70)`
 * fixe), `pillRow`/`badgeRow` retiennent `TOOL_BADGE_DEFAULT_WIDTH_PT` en
 * repli — SEUL call-site externe concerné à ce jour
 * (`document-builder.ts::buildEffractionPages`, bandeau photo `mm(70)`).
 */
function layoutToolBadges(items: string[], p: OiPdfPalette, baseColor: string, containerWidthPt: number): Content {
    if (items.length === 0) {
        return { text: '' };
    }
    const rows = packToolBadgeRows(items, containerWidthPt);
    const rowNodes: Content[] = rows.map((row, rowIndex) => {
        const rowHeightPt = Math.max(...row.map((d) => d.contentHeightPt));
        return {
            columns: row.map((dims) => ({ width: dims.widthPt, stack: [toolBadgeChip(dims, rowHeightPt, p, baseColor)] })),
            columnGap: TOOL_BADGE_GUTTER_PT,
            margin: [0, 0, 0, rowIndex === rows.length - 1 ? 0 : TOOL_BADGE_GUTTER_PT],
        };
    });
    return { stack: rowNodes };
}

/** Largeur (pt) de repli pour un `pillRow`/`badgeRow` en mode badge appelé
 *  SANS connaître la largeur réelle du conteneur — calée sur l'unique
 *  call-site externe actuel (`document-builder.ts::buildEffractionPages`,
 *  bandeau photo de porte `width: mm(70)`, cf. JSDoc `layoutToolBadges`). */
const TOOL_BADGE_DEFAULT_WIDTH_PT = mm(70);

/**
 * `pillRow` — rangée de pilules génériques (Ordre Rame VL, Colonne
 * Progression, §3.2 ligne 7) SANS `opts.fillColor` -> cadre net `LAYOUT_PILL`
 * inchangé. AVEC `opts.fillColor` -> badge outil premium (`layoutToolBadges`,
 * fond or translucide + coins arrondis, largeur variable en flow) — c'est le
 * cas des badges d'outils d'effraction (`document-builder.ts`, sous la photo
 * de porte, MÊME page). `opts.perRow` n'a plus d'effet en mode badge (flow
 * automatique, cf. `layoutToolBadges`) — conservé dans la signature pour
 * compatibilité, ignoré silencieusement dans ce cas.
 */
export function pillRow(
    items: string[],
    p: OiPdfPalette,
    opts?: { perRow?: number; numbered?: boolean; fillColor?: string; textColor?: string },
): Content {
    if (opts?.fillColor !== undefined) {
        return layoutToolBadges(items, p, opts.fillColor, TOOL_BADGE_DEFAULT_WIDTH_PT);
    }
    return pillGrid(items, p, opts?.perRow ?? 4, { numbered: opts?.numbered ?? false });
}

/**
 * `badgeRow` — port de `.badge` (pdf-engine-v2.ts:757), même redesign badge
 * premium que `pillRow({fillColor})` (`layoutToolBadges`) : fond `p.accent`
 * translucide, jamais numéroté. `opts.perRow` n'a plus d'effet (flow
 * automatique) — conservé pour compatibilité.
 */
export function badgeRow(items: string[], p: OiPdfPalette, opts?: { perRow?: number }): Content {
    void opts?.perRow;
    return layoutToolBadges(items, p, p.accent, TOOL_BADGE_DEFAULT_WIDTH_PT);
}

// --- Tableau clé/valeur ------------------------------------------------------

/**
 * `kvTable` — port de `.k{font-weight:bold;width:30%;background:cardAlt}`
 * (OrderPdfStyle.kt:114) : 2 colonnes (30 % / 70 %), bordure `LAYOUT_BORDERED`.
 * `value` traverse `breakLongTokens()` (blindage BLIND.A #2) — `label` est
 * toujours un libellé métier fixe, jamais une donnée du Store.
 */
export function kvTable(
    rows: Array<[string, string]>,
    p: OiPdfPalette,
    /** Édition en place, UNE entrée par ligne de `rows` (même index), `null` pour une ligne non ancrable (ex. deux champs source concaténés dans une même valeur — cf. JSDoc `document-builder.ts::buildAdversaryFiche`). */
    edit?: { anchors: OiPdfEditAnchor[]; refs: ReadonlyArray<PdfFieldAnchor | null> },
): Content {
    if (edit) {
        rows.forEach(([, value], i) => registerPdfEditAnchor(edit.anchors, edit.refs[i] ?? null, value));
    }
    return {
        table: {
            widths: ['30%', '*'],
            body: rows.map(([label, value]) => [
                {
                    text: label,
                    bold: true,
                    fillColor: p.cardAlt,
                    borderColor: [p.border, p.border, p.border, p.border],
                },
                {
                    text: breakLongTokens(value),
                    borderColor: [p.border, p.border, p.border, p.border],
                },
            ]),
        },
        layout: LAYOUT_BORDERED,
    };
}

// --- Figures / galeries ------------------------------------------------------

/**
 * `figure` — port de `.fig`/`.page-fig` (OrderPdfStyle.kt:143-163), DÉCADRÉ
 * (directive Nico 2026-08-10, mission P2 « photos et badges outils ») :
 * l'ancien encadré 2 pt `p.accent`/fond `p.cardAlt` (`frameLayout`) est
 * retiré du chemin photo — l'image occupe SEULE l'espace, ratio préservé
 * (`fit`, équivalent `object-fit:contain`), sans cadre ni fond plaqué
 * derrière (la « boîte » disparaît, décision D8-like pour les photos : le
 * fond de PAGE transparaît). `dataUrl` null/vide -> `{ text: '' }` (JAMAIS
 * d'image vide, qui ferait échouer pdfkit — SPEC-PDF-V3.md §1.5).
 *
 * `caption` optionnel ajoute une légende SOUS la photo, typographie fine et
 * discrète (petite taille, non grasse, `p.muted`, tracking léger) — plus la
 * légende grasse couleur accent d'avant (trop lourde pour un rendu « pleine
 * page, une photo » premium).
 */
export function figure(dataUrl: string | null, boxPt: [number, number], p: OiPdfPalette, caption?: string): Content {
    if (dataUrl === null || dataUrl === '') {
        return { text: '' };
    }
    const image: Content = { image: dataUrl, fit: boxPt, alignment: 'center' };
    if (caption === undefined || caption === '') {
        return image;
    }
    return {
        stack: [
            image,
            // `breakLongTokens()` (BLIND.A #2) : `caption` peut porter un `customTitle`
            // de photo saisi librement, sans espace, au-delà du seuil de coupure.
            {
                text: breakLongTokens(caption),
                fontSize: 9,
                color: p.muted,
                characterSpacing: 0.3,
                alignment: 'center',
                margin: [0, 5, 0, 0],
            },
        ],
        // BF.REFIX (round 1, point 6) — sans ce filet, pdfmake peut scinder ce
        // `stack` entre la photo (qui tient dans la page) et la légende
        // (repoussée SEULE sur la page suivante, orpheline) : constaté sur
        // `recipe-data.json` (page « 6. LOGISTIQUE & TRANSPORTS », légende
        // « Transport PSIG -> PR » seule en haut de la page suivante, cf.
        // `galleryHeightPt`/`GALLERY_CAPTION_RESERVE_PT` ci-dessous qui
        // réservent déjà la place normale — ce filet garantit qu'un cas
        // borderline (légende plus longue qu'anticipé) bascule le bloc
        // ENTIER d'un seul tenant plutôt que de le couper.
        unbreakable: true,
    };
}

/** JSON.parse tolérant vers `string[]` — port de `safeJsonParse`
 *  (pdf-engine-v2.ts:52-61) restreint au cas d'usage `tools` des galeries :
 *  chaîne corrompue ou de forme inattendue -> repli `[]`, jamais d'exception. */
function safeJsonParseStringArray(raw: string): string[] {
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

/** Liste COMPLÈTE des outils d'une photo de galerie (`tools` JSON + repli
 *  texte libre `other_tools`) — même assemblage que le rendu réel
 *  (`galleryPhotoStack`), partagé avec `galleryToolsReservePt` pour que la
 *  RÉSERVE soit calculée sur exactement ce qui sera rendu. */
export function galleryAllTools(meta: OiPhotoMeta): string[] {
    const tools = safeJsonParseStringArray(meta.tools || '[]');
    const otherTools = meta.other_tools;
    return otherTools ? [...tools, otherTools] : tools;
}

/**
 * Hauteur (pt) à RÉSERVER sous le cadre photo d'une galerie pour la grille de
 * badges d'outils empilée par `galleryPhotoStack` (SPEC-PDF-DEFINITIF §5,
 * axe A3, correctif D3 — modèle physique repris pour le badge premium,
 * directive Nico 2026-08-10) : `GALLERY_CAPTION_RESERVE_PT` réservait la
 * légende mais RIEN pour les badges — le cadre photo étant dimensionné à la
 * hauteur utile quasi entière de la page, les badges débordaient
 * SYSTÉMATIQUEMENT sur une page orpheline dès qu'un outil existait (défaut
 * D3, p14 du PDF réel : page ne portant QUE « HDR50 / Bélier lourd / VIGIK /
 * … »).
 *
 * Le nombre de RANGÉES est celui produit par le MÊME empaquetage en flow que
 * le rendu réel (`packToolBadgeRows`, partagée, aucune divergence de modèle
 * possible entre réserve et rendu) ; la hauteur de chaque rangée = son badge
 * le plus haut ; plus `mm(2)` de gouttière globale. `0` si `tools` est vide
 * (non-régression stricte des galeries sans outil). `fontSizePt`/`perRow` ont
 * disparu de la signature (le badge outil a désormais sa PROPRE taille fixe
 * `TOOL_BADGE_FONT_PT`/repli `TOOL_BADGE_MIN_FONT_PT`, indépendante de la
 * police adaptative du document, et l'empaquetage est un FLOW automatique —
 * plus de grille à colonnes fixes, revue design 2026-08-10) : fonction non
 * consommée par `document-builder.ts` (seulement `galleryPages` en interne +
 * tests), donc libre de signature.
 */
export function galleryToolsReservePt(tools: readonly string[], boxWidthPt: number): number {
    if (tools.length === 0) {
        return 0;
    }
    const rows = packToolBadgeRows(tools, boxWidthPt);
    let total = 0;
    for (const row of rows) {
        const rowHeightPt = Math.max(...row.map((d) => d.contentHeightPt));
        total += rowHeightPt + TOOL_BADGE_GUTTER_PT;
    }
    return total + mm(2);
}

/** Espace entre deux images d'une page de galerie (pt). */
const GALLERY_GAP_PT = 12;
const GALLERY_CAPTION_FONT_PT = 9;
/** Avance de ligne d'une légende (JetBrains Mono : 1,32 em × interligne 1,45). */
const GALLERY_CAPTION_LINE_PT = GALLERY_CAPTION_FONT_PT * 1.32 * 1.45;
const GALLERY_LOW_RES_FONT_PT = 8;
/** Mention imprimée sous une image que sa définition empêche d'agrandir (décision 44). */
export const LOW_RES_MENTION = 'basse définition';

/** Id des captures de carte (`medias.ts`, fichier `carte_…`) : un plan est toujours seul sur sa page. */
export function isPlanPhotoId(id: string): boolean {
    return id.startsWith('img_plan_');
}

/** Une image de galerie, prête à placer. */
export interface GalleryEntry {
    id: string;
    /** Clé du dictionnaire d'images pdfmake (ou data URL). */
    ref: string;
    caption: string;
    tools: readonly string[];
    /** Dimensions lues dans l'image ; `null` : forme inconnue (repli 4:3, jamais déformée). */
    size: ImageSize | null;
    isPlan: boolean;
}

/** Largeur d'une cellule selon la forme (mêmes règles que `layoutGallery`,
 *  pages OI toujours paysage) : sert seulement à réserver la légende. */
function galleryCellWidthPt(shape: PhotoShape, widthPt: number): number {
    if (shape === 'portrait') return (widthPt - GALLERY_GAP_PT) / 2;
    if (shape === 'ecran') return (widthPt - 3 * GALLERY_GAP_PT) / 4;
    return widthPt;
}

/** Interlettrage des légendes (`characterSpacing` de `figure`). */
const GALLERY_CAPTION_SPACING_PT = 0.3;

/** Lignes d'une légende repliée au mot, comme pdfmake (chasse fixe,
 *  interlettrage compris ; un mot trop long est coupé). Compter les
 *  caractères sans les mots sous-estimait d'une ligne ou plus : une photo
 *  qui remplit la hauteur passait alors seule sur une page sans titre. */
function wrapCaption(text: string, widthPt: number): string[] {
    const perLine = Math.max(1, Math.floor(widthPt / (GALLERY_CAPTION_FONT_PT * 0.62 + GALLERY_CAPTION_SPACING_PT)));
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (next.length <= perLine) {
            line = next;
            continue;
        }
        if (line) lines.push(line);
        line = word;
        while (line.length > perLine) {
            lines.push(line.slice(0, perLine));
            line = line.slice(perLine);
        }
    }
    if (line || lines.length === 0) lines.push(line);
    return lines;
}

/** Hauteur réservée sous une image, hors légende : marge, mention « basse
 *  définition » (inconnue avant la mise en page, toujours réservée) et badges. */
function galleryCaptionFixedPt(entry: GalleryEntry, cellWidthPt: number): number {
    return 5 + GALLERY_LOW_RES_FONT_PT * 1.32 * 1.45 + galleryToolsReservePt(entry.tools, cellWidthPt);
}

/** Hauteur réservée sous une image : légende repliée, mention « basse
 *  définition » et badges. */
function galleryCaptionReservePt(entry: GalleryEntry, cellWidthPt: number): number {
    return galleryCaptionFixedPt(entry, cellWidthPt) + wrapCaption(entry.caption, cellWidthPt).length * GALLERY_CAPTION_LINE_PT;
}

/** Légende raccourcie (« … ») pour que sa réserve tienne dans `maxPt` :
 *  au-delà, la photo et sa légende (bloc insécable) ne tiendraient plus sur
 *  une page et pdfmake ne dessinerait pas la photo. Le formulaire garde le
 *  texte entier. */
function fitCaption(entry: GalleryEntry, cellWidthPt: number, maxPt: number): GalleryEntry {
    const lines = wrapCaption(entry.caption, cellWidthPt);
    const maxLines = Math.max(1, Math.floor((maxPt - galleryCaptionFixedPt(entry, cellWidthPt)) / GALLERY_CAPTION_LINE_PT));
    if (lines.length <= maxLines) return entry;
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${(kept[maxLines - 1] ?? '').slice(0, -1)}…`;
    return { ...entry, caption: kept.join(' ') };
}

function galleryInput(e: GalleryEntry): GalleryPhoto {
    return { id: e.id, widthPx: e.size?.widthPx ?? 0, heightPx: e.size?.heightPx ?? 0, isPlan: e.isPlan };
}

/** Contenu d'une cellule : photo et légende (`figure`), mention « basse
 *  définition », badges d'outils. Tout est composé à la largeur de la CELLULE
 *  (celle qui a servi à réserver la légende), l'image centrée dedans : une
 *  image basse définition peut ne mesurer que quelques points, sa légende
 *  reste repliée sur quelques lignes lisibles, jamais un caractère par ligne. */
function galleryCell(e: GalleryEntry, slot: GallerySlot, cellWidthPt: number, p: OiPdfPalette): Content[] {
    const items: Content[] = [figure(e.ref, [slot.width, slot.height], p, e.caption)];
    if (slot.lowRes) {
        items.push({ text: LOW_RES_MENTION, fontSize: GALLERY_LOW_RES_FONT_PT, color: p.warning, alignment: 'center' });
    }
    if (e.tools.length > 0) {
        items.push(layoutToolBadges([...e.tools], p, p.warning, cellWidthPt));
    }
    return items;
}

/** Corps d'une page : les rangées de `layoutGallery` (une rangée = même `y`),
 *  chaque image dans une colonne à sa largeur exacte, décalée comme calculé. */
function galleryPageBody(slots: GallerySlot[], byId: Map<string, GalleryEntry>, p: OiPdfPalette, W: number): Content {
    const rows: GallerySlot[][] = [];
    for (const slot of slots) {
        const last = rows[rows.length - 1];
        if (last && last[0]?.y === slot.y) last.push(slot);
        else rows.push([slot]);
    }
    return {
        stack: rows.map((row, i): Content => {
            const columns: Column[] = [];
            let x = 0;
            for (const slot of row) {
                const entry = byId.get(slot.id);
                if (!entry) continue;
                // Cellule de `layoutGallery` : l'image y est centrée.
                const cellWidth = Math.max(slot.width, galleryCellWidthPt(photoShape(galleryInput(entry)), W));
                const cellX = slot.x + slot.width / 2 - cellWidth / 2;
                if (cellX - x > 0.5) columns.push({ width: cellX - x, text: '' });
                columns.push({ width: cellWidth, stack: galleryCell(entry, slot, cellWidth, p) });
                x = cellX + cellWidth;
            }
            return { columns, columnGap: 0, unbreakable: true, margin: [0, i === 0 ? 0 : GALLERY_GAP_PT, 0, 0] };
        }),
    };
}

/**
 * Galerie ADAPTATIVE (décision 44, audit A7) : `layoutGallery`
 * (`shared/photo-layout.ts`, commune à PC-Tac) place les images page par page
 * — plan ou paysage seul, 2 portraits côte à côte, 4 captures de téléphone,
 * panoramas empilés, ordre de saisie gardé, jamais agrandie au-delà de
 * 150 ppi (« basse définition » dessous). Chaque page porte le titre `h2`
 * suivi de « PHOTO i/N » ou « PHOTOS i-j/N » (jamais « (SUITE) », mission R6).
 *
 * CONVENTION DE SAUT DE PAGE (inchangée) : `pageBreak: 'before'` sur toutes
 * les pages SAUF la première ; l'appelant gère le saut avant la galerie.
 */
export function adaptiveGalleryPages(
    title: string,
    input: readonly GalleryEntry[],
    p: OiPdfPalette,
    geo: ReturnType<typeof pageGeometry>,
): Content[] {
    if (input.length === 0) {
        return [];
    }
    const W = geo.contentWidthPt;
    const box = { width: W, height: geo.contentHeightPt - PDF_H2_BLOCK_PT };
    const entries = input.map((e) => fitCaption(e, galleryCellWidthPt(photoShape(galleryInput(e)), W), box.height - mm(40)));
    // Une réserve de légende par suite d'images de même forme (une page ne
    // mélange jamais deux formes) : la place des badges d'une photo de porte
    // ne rétrécit pas les portraits voisins. Plancher : l'image garde mm(40).
    const slotsPages: GallerySlot[][] = [];
    let i = 0;
    while (i < entries.length) {
        const shape = photoShape(galleryInput(entries[i] as GalleryEntry));
        const run: GalleryEntry[] = [];
        while (i < entries.length && photoShape(galleryInput(entries[i] as GalleryEntry)) === shape) {
            run.push(entries[i] as GalleryEntry);
            i++;
        }
        const cellWidth = galleryCellWidthPt(shape, W);
        const reserve = Math.min(box.height - mm(40), Math.max(...run.map((e) => galleryCaptionReservePt(e, cellWidth))));
        slotsPages.push(...layoutGallery(run.map(galleryInput), box, { gap: GALLERY_GAP_PT, captionHeight: reserve }));
    }
    const byId = new Map(entries.map((e) => [e.id, e]));
    let shown = 0;
    return slotsPages.map((slots, pageIndex) => {
        const first = shown + 1;
        shown += slots.length;
        const suffix = slots.length === 1 ? `— PHOTO ${first}/${entries.length}` : `— PHOTOS ${first}-${shown}/${entries.length}`;
        return {
            stack: [h2(title, p, W, { suffix }), galleryPageBody(slots, byId, p, W)],
            pageBreak: pageIndex === 0 ? undefined : 'before',
        };
    });
}

/**
 * Galerie d'un champ photo de l'OI Complet (légende = titre saisi, sinon
 * « <titre> - Détail » ; badges d'outils d'effraction) — cf.
 * `adaptiveGalleryPages`. `photos` vide, ou dont AUCUN `id` n'a d'entrée dans
 * `photosBase64`, -> `[]` (section omise, §3.4.1 règle 1) ; une photo absente
 * de `photosBase64` est ignorée (jamais de figure vide). `sizeOf` donne les
 * dimensions lues dans chaque image (`image-size.ts`).
 */
export function galleryPages(
    title: string,
    photos: OiPhotoMeta[],
    photosBase64: Record<string, string>,
    p: OiPdfPalette,
    geo: ReturnType<typeof pageGeometry>,
    sizeOf: (id: string) => ImageSize | null = () => null,
): Content[] {
    return adaptiveGalleryPages(title, galleryEntries(title, photos, photosBase64, sizeOf), p, geo);
}

function galleryEntries(
    title: string,
    photos: OiPhotoMeta[],
    photosBase64: Record<string, string>,
    sizeOf: (id: string) => ImageSize | null,
): GalleryEntry[] {
    const entries: GalleryEntry[] = [];
    for (const meta of photos) {
        const ref = photosBase64[meta.id];
        if (ref === undefined) continue;
        entries.push({
            id: meta.id,
            ref,
            caption: meta.customTitle || `${title} - Détail`,
            tools: galleryAllTools(meta),
            size: sizeOf(meta.id),
            isPlan: isPlanPhotoId(meta.id),
        });
    }
    return entries;
}

/**
 * Pages d'un champ limité à deux photos (« Baptême terrain », Nico
 * 2026-09-26) : une photo prend toute la page, deux se la partagent à parts
 * égales (`layoutSplitPage`). Un ancien OI qui en porte davantage (anciens
 * champs par bloc ZMSPCP) les imprime toutes, deux par page, jamais perdues.
 * `[]` si aucune photo n'a d'image. Chaque page porte `pageBreak: 'before'`.
 */
export function splitGalleryPages(
    title: string,
    photos: OiPhotoMeta[],
    photosBase64: Record<string, string>,
    p: OiPdfPalette,
    geo: ReturnType<typeof pageGeometry>,
    sizeOf: (id: string) => ImageSize | null = () => null,
): Content[] {
    const all = galleryEntries(title, photos, photosBase64, sizeOf);
    const W = geo.contentWidthPt;
    const box = { width: W, height: geo.contentHeightPt - PDF_H2_BLOCK_PT };
    const halfPt = (W - GALLERY_GAP_PT) / 2;
    const pages: Content[] = [];
    for (let k = 0; k < all.length; k += 2) {
        const cellWidth = all.length - k >= 2 ? halfPt : W;
        const entries = all.slice(k, k + 2).map((e) => fitCaption(e, cellWidth, box.height - mm(40)));
        const reserve = Math.max(...entries.map((e) => galleryCaptionReservePt(e, cellWidth)));
        const slots = layoutSplitPage(entries.map(galleryInput), box, { gap: GALLERY_GAP_PT, captionHeight: reserve });
        const cell = (slot: GallerySlot, i: number, widthPt: number): Content[] => galleryCell(entries[i] as GalleryEntry, slot, widthPt, p);
        // Côte à côte (la 2e image commence au-dessus du bas de la 1re) :
        // chaque colonne descend à la hauteur calculée, images alignées sur
        // leur milieu. L'une sous l'autre : l'ensemble descend au centre.
        const [first, second] = slots;
        const body: Content = first && second && second.y < first.y + first.height
            ? { columns: slots.map((slot, i) => ({ width: halfPt, stack: cell(slot, i, halfPt), margin: [0, slot.y, 0, 0] })), columnGap: GALLERY_GAP_PT, unbreakable: true }
            : { stack: slots.map((slot, i) => ({ stack: cell(slot, i, W), margin: [0, i === 0 ? slot.y : GALLERY_GAP_PT, 0, 0], unbreakable: true })) };
        const suffix = entries.length === 1 ? `— PHOTO ${k + 1}/${all.length}` : `— PHOTOS ${k + 1}-${k + 2}/${all.length}`;
        pages.push({ stack: [h2(title, p, W, { suffix }), body], pageBreak: 'before' });
    }
    return pages;
}
