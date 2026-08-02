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
import type { Content, CustomTableLayout, TableCell } from 'pdfmake/interfaces';

import { mm, pageGeometry, photoPageGalleryHeightMm, type OiPdfPalette } from './theme.js';
import type { OiPhotoMeta } from '@shared/types/contracts.js';

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
 */
export function h2(text: string, p: OiPdfPalette, contentWidthPt: number): Content {
    return {
        stack: [
            {
                text: text.toUpperCase(),
                font: 'Oswald',
                fontSize: 17,
                color: p.accent,
                margin: [0, 0, 0, 3],
            },
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
 * `preserveLeadingSpaces` reproduit `white-space:pre-wrap`.
 */
export function labelValue(
    label: string,
    value: string,
    p: OiPdfPalette,
    opts?: { fontSize?: number; valueColor?: string; valueBold?: boolean },
): Content {
    return {
        text: [
            { text: `${label.toUpperCase()} : `, bold: true, color: p.accent },
            { text: value, color: opts?.valueColor, bold: opts?.valueBold },
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
 */
export function card(body: Content[], p: OiPdfPalette, opts?: { fillColor?: string }): Content {
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
        unbreakable: true,
    };
}

/**
 * `accentCard` — port de `.accent-card`/`.danger-card`/`.warning-card`
 * (OrderPdfStyle.kt:131-136) : liseré gauche 6 pt de la couleur du `kind`,
 * fond `p.cardAlt`, sans bordure. `title` optionnel (les cartes CAT/liaison
 * de la section 8 n'en ont pas toutes, §3.2 ligne 9).
 */
export function accentCard(
    title: string | null,
    body: Content[],
    p: OiPdfPalette,
    kind: 'accent' | 'danger' | 'warning',
): Content {
    const stripeColor = kind === 'danger' ? p.danger : kind === 'warning' ? p.warning : p.accent;
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
        unbreakable: true,
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
 * `opts.fillColor`/`opts.textColor` permettent le badge plein
 * (`badgeRow`/galeries : `.badge`/`.tool-badge`).
 */
export function pill(
    text: string,
    p: OiPdfPalette,
    opts?: { fillColor?: string; textColor?: string; index?: number },
): TableCell {
    const textValue: Content =
        opts?.index !== undefined ? [{ text: `${opts.index + 1} `, bold: true, color: p.accent }, { text }] : text;
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
 * Grille commune à `pillRow`/`badgeRow` : pdfmake ne sait pas faire
 * retourner une ligne de `columns` — les éléments sont donc DÉCOUPÉS en
 * lignes de `perRow` cellules d'une table `LAYOUT_NONE`, la dernière ligne
 * étant complétée par des cellules vides `{ text: '' }` (pdfmake exige un
 * nombre de colonnes constant par ligne).
 */
function pillGrid(
    items: string[],
    p: OiPdfPalette,
    perRow: number,
    opts: { numbered: boolean; fillColor?: string | undefined; textColor?: string | undefined },
): Content {
    if (items.length === 0) {
        return { text: '' };
    }
    const rows: TableCell[][] = [];
    for (let i = 0; i < items.length; i += perRow) {
        const rowItems = items.slice(i, i + perRow);
        const row: TableCell[] = rowItems.map((item, j) =>
            pill(item, p, {
                ...(opts.fillColor !== undefined ? { fillColor: opts.fillColor } : {}),
                ...(opts.textColor !== undefined ? { textColor: opts.textColor } : {}),
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

/**
 * `pillRow` — rangée de pilules génériques (Ordre Rame VL, Colonne
 * Progression, §3.2 ligne 7). `perRow` par défaut 4.
 */
export function pillRow(
    items: string[],
    p: OiPdfPalette,
    opts?: { perRow?: number; numbered?: boolean; fillColor?: string; textColor?: string },
): Content {
    return pillGrid(items, p, opts?.perRow ?? 4, {
        numbered: opts?.numbered ?? false,
        fillColor: opts?.fillColor,
        textColor: opts?.textColor,
    });
}

/**
 * `badgeRow` — port de `.badge` (pdf-engine-v2.ts:757) : fond `p.accent`,
 * texte blanc, jamais numéroté. `perRow` par défaut 6.
 */
export function badgeRow(items: string[], p: OiPdfPalette, opts?: { perRow?: number }): Content {
    return pillGrid(items, p, opts?.perRow ?? 6, {
        numbered: false,
        fillColor: p.accent,
        textColor: '#ffffff',
    });
}

// --- Tableau clé/valeur ------------------------------------------------------

/**
 * `kvTable` — port de `.k{font-weight:bold;width:30%;background:cardAlt}`
 * (OrderPdfStyle.kt:114) : 2 colonnes (30 % / 70 %), bordure `LAYOUT_BORDERED`.
 */
export function kvTable(rows: Array<[string, string]>, p: OiPdfPalette): Content {
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
                    text: value,
                    borderColor: [p.border, p.border, p.border, p.border],
                },
            ]),
        },
        layout: LAYOUT_BORDERED,
    };
}

// --- Figures / galeries ------------------------------------------------------

/**
 * `figure` — port de `.fig`/`.page-fig` (OrderPdfStyle.kt:143-163) : cadre
 * bordé 2 pt `p.accent`, fond `p.cardAlt`, image en `fit` (ratio préservé,
 * équivalent `object-fit:contain`). `dataUrl` null/vide -> `{ text: '' }`
 * (JAMAIS d'image vide, qui ferait échouer pdfkit — SPEC-PDF-V3.md §1.5).
 * `caption` optionnel ajoute une légende centrée grasse accent dessous
 * (port de la légende de galerie, pdf-engine-v2.ts:877-879).
 */
export function figure(dataUrl: string | null, boxPt: [number, number], p: OiPdfPalette, caption?: string): Content {
    if (dataUrl === null || dataUrl === '') {
        return { text: '' };
    }
    const [boxWidthPt, boxHeightPt] = boxPt;
    const frame: Content = {
        table: {
            widths: [boxWidthPt],
            heights: [boxHeightPt],
            body: [[{ image: dataUrl, fit: boxPt, alignment: 'center' }]],
        },
        layout: frameLayout(2, p.accent, { fillColor: p.cardAlt }),
    };
    if (caption === undefined || caption === '') {
        return frame;
    }
    return {
        stack: [frame, { text: caption, bold: true, color: p.accent, alignment: 'center', margin: [0, 4, 0, 0] }],
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

/** Contenu empilé d'UNE photo de galerie : cadre+légende (`figure`) puis,
 *  si présents, les badges d'outils (`pillRow`, fond `p.warning`, texte
 *  noir — port de `.tool-badge`, OrderPdfStyle.kt:727-733 côté v2). */
function galleryPhotoStack(
    meta: OiPhotoMeta,
    dataUrl: string,
    boxPt: [number, number],
    p: OiPdfPalette,
    baseTitle: string,
): Content[] {
    const captionText = meta.customTitle || `${baseTitle} - Détail`;
    const tools = safeJsonParseStringArray(meta.tools || '[]');
    const otherTools = meta.other_tools;
    const allTools = otherTools ? [...tools, otherTools] : tools;
    const items: Content[] = [figure(dataUrl, boxPt, p, captionText)];
    if (allTools.length > 0) {
        items.push(pillRow(allTools, p, { fillColor: p.warning, textColor: '#000000' }));
    }
    return items;
}

/**
 * `galleryPages` — port de `OrderHtmlGallery.photoPages`
 * (OrderHtmlPhotos.kt:69-92) : DEUX photos maximum par page (écart assumé
 * E4, SPEC-PDF-V3.md §3.3/§7 — langage strategica, « les images doubles
 * prennent trop peu d'espace »). `photos` vide, ou dont AUCUN `id` n'a
 * d'entrée dans `photosBase64`, -> `[]` (section omise, §3.4.1 règle 1).
 * Une photo dont l'`id` est absent de `photosBase64` est ignorée
 * silencieusement (jamais de figure vide) : le filtrage a lieu AVANT le
 * découpage en pages de 2, une photo manquante ne « décale » donc jamais
 * le pairage des suivantes.
 *
 * CONVENTION DE SAUT DE PAGE (au choix du contrat, documentée ici et
 * assertée par le test dédié) : chaque page retournée porte
 * `pageBreak: 'before'` sur son nœud racine, SAUF LA TOUTE PREMIÈRE page du
 * tableau. `galleryPages()` est ainsi autonome — quel que soit l'endroit où
 * `document-builder.ts` insère son tableau dans le document final, ses
 * propres pages ne se mélangent jamais entre elles ; c'est à l'appelant de
 * gérer, comme pour toute autre section, l'éventuel saut de page AVANT la
 * toute première page de la galerie.
 */
export function galleryPages(
    title: string,
    photos: OiPhotoMeta[],
    photosBase64: Record<string, string>,
    p: OiPdfPalette,
    geo: ReturnType<typeof pageGeometry>,
): Content[] {
    const resolved: Array<{ meta: OiPhotoMeta; dataUrl: string }> = [];
    for (const meta of photos) {
        const dataUrl = photosBase64[meta.id];
        if (dataUrl !== undefined) {
            resolved.push({ meta, dataUrl });
        }
    }
    if (resolved.length === 0) {
        return [];
    }

    const galleryHeightPt = mm(photoPageGalleryHeightMm(true));
    const pairGapPt = mm(4);
    const pairBoxWidthPt = (geo.contentWidthPt - pairGapPt) / 2;

    const pages: Content[] = [];
    for (let i = 0; i < resolved.length; i += 2) {
        const chunk = resolved.slice(i, i + 2);
        const first = chunk[0];
        if (first === undefined) {
            continue;
        }
        const second = chunk[1];
        const pageIndex = pages.length;
        const pageTitle = pageIndex === 0 ? title : `${title} (suite)`;

        const body: Content =
            second === undefined
                ? {
                      stack: galleryPhotoStack(first.meta, first.dataUrl, [geo.contentWidthPt, galleryHeightPt], p, title),
                  }
                : {
                      columns: [
                          {
                              width: pairBoxWidthPt,
                              stack: galleryPhotoStack(first.meta, first.dataUrl, [pairBoxWidthPt, galleryHeightPt], p, title),
                          },
                          {
                              width: pairBoxWidthPt,
                              stack: galleryPhotoStack(
                                  second.meta,
                                  second.dataUrl,
                                  [pairBoxWidthPt, galleryHeightPt],
                                  p,
                                  title,
                              ),
                          },
                      ],
                      columnGap: pairGapPt,
                  };

        pages.push({
            stack: [h2(pageTitle, p, geo.contentWidthPt), body],
            pageBreak: pageIndex === 0 ? undefined : 'before',
        });
    }
    return pages;
}
