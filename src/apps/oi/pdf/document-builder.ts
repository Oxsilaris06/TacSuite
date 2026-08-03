/**
 * document-builder.ts — Construit la `TDocumentDefinitions` pdfmake des 14
 * sections de l'OI (SPEC-PDF-V3.md §2.1 « contrat document-builder.ts », §3.2
 * table de mapping exhaustive, §3.4 règles de fidélité ; paquet P4
 * « pdf-p4-document-builder »).
 *
 * Module PUR : zéro DOM, zéro IndexedDB, zéro pdfmake en VALEUR (uniquement
 * ses TYPES, `pdfmake/interfaces`). Port de `pdf-engine-v2.ts:608-1304`
 * (`generateHTML`) — la STRUCTURE (ordre, replis, omissions) reste la nôtre,
 * le LANGAGE VISUEL vient des primitives strategica de `blocks.ts`/`theme.ts`.
 *
 * RÈGLE DE SAUT DE PAGE (convention interne, cf. `blocks.ts::galleryPages`
 * dont c'est le contrat d'origine) : chaque page de contenu est empilée via
 * `pushPage`/`pushPages`, qui posent `pageBreak:'before'` sur toute page
 * SAUF LA TOUTE PREMIÈRE de tout le document (la page de garde). Cela évite
 * les doubles sauts de page (page blanche) quand un bloc auto-cohérent comme
 * `galleryPages()` est composé au milieu du document.
 *
 * `h2()` (blocks.ts) MAJUSCULE le texte qu'on lui passe (pas de CSS
 * `text-transform` possible sous pdfmake, contrairement à la voie B) : les
 * titres dynamiques passés à `h2` ('Articulation : ZMSPCP - <titre>', etc.)
 * apparaissent donc ici en MAJUSCULES dans le document final, à la
 * différence du HTML de `print-view.ts` où seule la CSS uppercase le rendu
 * sans toucher le texte — divergence assumée entre les deux voies, chacune
 * fidèle à son propre mécanisme de langage visuel.
 *
 * Valeurs du Store : `OiFormData` porte une signature d'index `unknown` pour
 * tout champ texte libre — converties via le helper local `str()`
 * (`String(v ?? '')`). Les sous-structures typées (`OiZmspcpBlock`,
 * `OiMoicpBlock`, `OiEffractionBlock`, `OiPatracMember`, `OiPhotoMeta`…) ont
 * des champs `string` déjà concrets : accès direct, `str()` inutile.
 */
import type {
    Content,
    ContextPageSize,
    CustomTableLayout,
    DynamicContent,
    Size,
    TableCell,
    TDocumentDefinitions,
} from 'pdfmake/interfaces';

import {
    accentCard,
    card,
    figure,
    galleryPages,
    grid2,
    h1,
    h2,
    h3,
    kvTable,
    labelValue,
    LAYOUT_BORDERED,
    LAYOUT_NONE,
    pillRow,
} from './blocks.js';
import {
    documentFontPx,
    mm,
    pageGeometry,
    palette,
    patracFontPx,
    adaptivePagePx,
    catItemsPerPageBudget,
    effracFontPx,
    estimateCharsPerLine,
    estimateWrappedLines,
    type OiPdfFormat,
    type OiPdfPalette,
} from './theme.js';
import { breakLongTokens } from './text-utils.js';
import type {
    OiAdversary,
    OiEffractionBlock,
    OiEffractionHypothesis,
    OiFormData,
    OiMoicpBlock,
    OiPatracMember,
    OiPatracRow,
    OiPdfCollectedData,
    OiPhotoMeta,
    OiZmspcpBlock,
} from '@shared/types/contracts.js';

/* ==========================================================================
 * Helpers génériques (fidélité, saut de page, valeurs Store).
 * ======================================================================== */

/**
 * Hauteur utile de page `a4` — référence de calibration du budget
 * `catItemsPerPageBudget` (theme.ts, table d'origine mission PG.IMPL) : voir
 * son usage dans `buildArticulationCorePages` (correctif PG.REFIX round 1,
 * mise à l'échelle pour `16:9`).
 */
const A4_CONTENT_HEIGHT_PT = pageGeometry('a4').contentHeightPt;

/**
 * Conversion sûre d'un champ `unknown` du Store (mission #4) — jamais de
 * validation absente de l'original. Traverse `breakLongTokens()` (blindage
 * BLIND.A #2, `text-utils.ts`) : point de passage de la quasi-totalité des
 * champs texte libres du Store (`strOr`, `labelValue`/`kvTable` via
 * `blocks.ts` portent leur propre filet identique pour les champs déjà
 * typés `string` qui ne transitent jamais par `str()`, cf. leur JSDoc).
 */
function str(v: unknown): string {
    return breakLongTokens(String(v ?? ''));
}

/** `str(v) || fallback` — port exact du motif `formData.x || '-'` de `pdf-engine-v2.ts` (aucun trim, fidèle à l'original). */
function strOr(v: unknown, fallback = '-'): string {
    return str(v) || fallback;
}

/**
 * Bordure `p.border` sur les 4 côtés d'une cellule — port de
 * `td,th{border:1px solid p.border}` (print-style.ts:67-68), posée par
 * CELLULE et jamais dans `LAYOUT_BORDERED` (cf. tête de `blocks.ts`), pour
 * que les tableaux de données restent palette-dépendants au lieu de retomber
 * sur le noir par défaut de pdfmake (D3, `pdfv3-design-fix/DEFAUTS.md`).
 */
function cellBorder(p: OiPdfPalette): [string, string, string, string] {
    return [p.border, p.border, p.border, p.border];
}

/**
 * Empile une page UNIQUE : pose `pageBreak:'before'` sauf si `acc` est
 * encore vide (première page du document, ou premier élément d'un bloc
 * composable qu'un appelant plus haut se chargera lui-même de précéder d'un
 * saut — même convention que `galleryPages()`).
 */
function pushPage(acc: Content[], node: Content): void {
    acc.push(acc.length === 0 ? node : { stack: [node], pageBreak: 'before' });
}

/**
 * Empile un bloc MULTI-PAGES déjà auto-cohérent (`galleryPages()` : sa
 * première page est nue, les suivantes portent déjà `pageBreak:'before'`) —
 * `pushPage` gère le saut AVANT sa première page, les suivantes sont
 * poussées telles quelles.
 */
function pushPages(acc: Content[], nodes: Content[]): void {
    nodes.forEach((node, i) => {
        if (i === 0) {
            pushPage(acc, node);
        } else {
            acc.push(node);
        }
    });
}

/** Bloc de contexte partagé par tous les constructeurs de section — évite l'explosion de paramètres. */
interface BuildCtx {
    formData: OiFormData;
    photosBase64: Record<string, string>;
    dynamicPhotos: Record<string, OiPhotoMeta[]>;
    p: OiPdfPalette;
    geo: ReturnType<typeof pageGeometry>;
    is169: boolean;
    baseFontSize: number;
}

/** Fond/filigrane — port de `pdf-engine-v2.ts:772-776`. */
function resolveBgSrc(ctx: BuildCtx): string | undefined {
    const logoId = ctx.dynamicPhotos['photo_logo_unite']?.[0]?.id;
    return ctx.photosBase64['custom_pdf_background'] ?? (logoId ? ctx.photosBase64[logoId] : undefined);
}

/** Filigrane T15 (SPEC-PDF-V3.md §3.1) — port de `pdf-engine-v2.ts:738-742`/`:819`. */
function buildWatermark(bgSrc: string, ctx: BuildCtx): Content {
    return {
        image: bgSrc,
        fit: [ctx.geo.contentWidthPt, ctx.geo.contentHeightPt],
        opacity: Number(ctx.p.watermarkOpacity),
        absolutePosition: { x: 0, y: 0 },
    };
}

/** JSON.parse tolérant vers `string[]` — port de `safeJsonParse` (`pdf-engine-v2.ts:52-61`), même précédent que `blocks.ts::safeJsonParseStringArray`. */
function parseTools(json: string): string[] {
    if (!json) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

/** Mapping trigramme → cellule — port de `memberToCell` (`pdf-engine-v2.ts:779-784`), repli `'NON ASSIGNÉ'`. */
function buildMemberToCellMap(rows: OiPatracRow[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of rows) {
        for (const m of row.members) {
            if (m.trigramme) {
                map.set(m.trigramme, m.cellule || 'NON ASSIGNÉ');
            }
        }
    }
    return map;
}

/** Regroupement ORDONNÉ (1re apparition) par cellule — port de `regroupByCell` (`pdf-engine-v2.ts:787-798`), repli `'SANS CELLULE'`. */
function regroupByCellOrdered(trigrammes: string[], memberToCell: Map<string, string>): Array<[string, string[]]> {
    const order: string[] = [];
    const groups = new Map<string, string[]>();
    for (const t of trigrammes) {
        const cell = memberToCell.get(t) || 'SANS CELLULE';
        const list = groups.get(cell);
        if (list) {
            list.push(t);
        } else {
            groups.set(cell, [t]);
            order.push(cell);
        }
    }
    return order.map((cell) => [cell, groups.get(cell) ?? []]);
}

/**
 * Bloc « cellule » — port de `.cell-group`/`.cell-name`/`.cell-members`
 * (print-style.ts:175-184, commentaire :175-179 : la palette strategica
 * n'expose pas l'accent en RGB décomposable, la référence retombe donc sur un
 * fond `p.cardAlt` PLEIN plutôt que le voile `rgba(accent,.05)` de l'original
 * Kotlin). Fond PLEIN `p.cardAlt` (D5) + trigrammes en pastille CONTOUR
 * `pillRow` (même primitive que « Ordre Rame VL »), jamais en badge plein
 * (D6) — `pdfv3-design-fix/DEFAUTS.md`.
 */
function cellGroupBox(cellName: string, trigrammes: string[], p: OiPdfPalette): Content {
    return {
        table: {
            widths: ['*'],
            body: [
                [
                    {
                        stack: [
                            // Blindage BLIND.A #2 : `cellName` vient du roster PATRACDVR
                            // (`OiPatracMember.cellule`, texte libre non typé `str()`).
                            { text: breakLongTokens(cellName), bold: true, color: p.accent, decoration: 'underline', fontSize: 8, margin: [0, 0, 0, 4] },
                            pillRow(trigrammes, p, { perRow: 6 }),
                        ],
                        fillColor: p.cardAlt,
                        borderColor: [p.accent, p.accent, p.accent, p.accent],
                    },
                ],
            ],
        },
        layout: LAYOUT_BORDERED,
        margin: [0, 0, 0, 8],
    };
}

/**
 * Ligne « hypothèse d'ensemble » (§3.2 ligne 5) — liseré gauche 4pt (au lieu
 * des 6pt figés de `blocks.accentCard`, d'où une construction locale),
 * libellé `H<i> :` en `p.danger` gras (port du libellé spec, distinct de la
 * couleur `textMuted` de `pdf-engine-v2.ts:1023` — la SPEC prime).
 */
function hypothesisLine(index: number, text: string, p: OiPdfPalette): Content {
    return {
        table: {
            widths: [4, '*'],
            body: [
                [
                    { text: '', fillColor: p.accent },
                    {
                        text: [
                            { text: `H${index + 1} : `, bold: true, color: p.danger },
                            // Blindage BLIND.A #2 (`text-utils.ts`) : `formData.hypotheses`
                            // est du texte libre non typé, non couvert par `str()` ici.
                            { text: breakLongTokens(text) },
                        ],
                        fillColor: p.cardAlt,
                        margin: [6, 4, 4, 4],
                    },
                ],
            ],
        },
        layout: LAYOUT_NONE,
        margin: [0, 0, 0, 4],
    };
}

/** Bandeau de titre « 2.<i> FICHE ADVERSAIRE : <nom> » — fond accent plein, texte blanc (aucun équivalent `blocks.ts` : `h2` majusculerait le nom, non souhaité ici). */
function ficheAdversaireTitleBar(text: string, p: OiPdfPalette): Content {
    const layout: CustomTableLayout = { ...LAYOUT_BORDERED, hLineWidth: () => 0, vLineWidth: () => 0 };
    return {
        table: { widths: ['*'], body: [[{ text, color: '#ffffff', bold: true, fillColor: p.accent }]] },
        layout,
        margin: [0, 0, 0, 6],
    };
}

/**
 * Palier de police adaptatif de `situationCard`/`ciblesCard` (correctif
 * PG.REFIX round 1) — MÊME méthode que `adaptivePagePx()` (theme.ts,
 * elle-même un port verbatim de `OrderPdfStyle.kt`, jamais modifiée par ce
 * correctif) mais avec des seuils propres, environ MOITIÉ de ceux
 * d'`adaptivePagePx` : `grid2()` pose ces deux cartes en COLONNE ÉTROITE
 * (demi-largeur de page), alors qu'`adaptivePagePx` est calibrée pour un
 * contenu qui occupe la largeur de page ENTIÈRE (fiche adversaire, blocs
 * ZMSPCP/MOICP) — un volume qui tiendrait à son palier plancher (9 px) en
 * pleine largeur ne tient pas forcément en demi-largeur (mesuré au banc
 * `tests/pdf/generate-from-fixture.mjs` contre
 * `tests/pdf/fixtures/long-case.json` : palier 9 encore insuffisant, palier
 * 8 requis pour que les 2 colonnes tiennent sur la page 1 — défaut « carte
 * esseulée » du retour utilisateur). Repose sur la même formule volume =
 * caractères + (retours-ligne × 60), cf. JSDoc `adaptivePagePx`.
 */
function coverCardFontPx(fields: string[], extraLines = 0): number {
    const chars = fields.reduce((sum, field) => sum + field.length, 0);
    const lines = fields.reduce((sum, field) => sum + (field.match(/\n/g)?.length ?? 0), 0) + extraLines;
    const total = chars + lines * 60;
    if (total < 150) return 14;
    if (total < 300) return 12;
    if (total < 500) return 10;
    if (total < 700) return 9;
    return 8;
}

/* ==========================================================================
 * Section 1 — Page de garde « ORDRE INITIAL » (pdf-engine-v2.ts:816-855, §3.2 ligne 1).
 * ======================================================================== */
function buildCover(ctx: BuildCtx): Content {
    const { formData, p, geo } = ctx;
    const bgSrc = resolveBgSrc(ctx);
    const watermark: Content[] = bgSrc !== undefined ? [buildWatermark(bgSrc, ctx)] : [];

    const opCard: Content = {
        table: {
            widths: [mm(60)],
            body: [
                [
                    {
                        stack: [
                            { text: `OP : ${strOr(formData.nom_operation)}` },
                            { text: `DATE : ${strOr(formData.date_op)}`, fontSize: 9 },
                        ],
                        bold: true,
                        fillColor: p.cardAlt,
                    },
                ],
            ],
        },
        layout: LAYOUT_BORDERED,
        absolutePosition: { x: geo.widthPt - mm(60), y: mm(2) },
    };

    // Palier de police adaptatif de la couverture (correctif PG.REFIX,
    // addendum § Pagination v2) — même mécanique que `adaptivePagePx` ailleurs
    // (fiche adversaire, blocs ZMSPCP/MOICP) : `situationCard`/`ciblesCard`
    // sont posées côte à côte par `grid2` en DEMI-largeur de page, sous un
    // budget vertical déjà réduit par les marges du `h1` (35mm haut/15mm
    // bas, ligne ci-dessous) — un `situation_generale`/`situation_particuliere`
    // volumineux au palier de police DOCUMENT (`baseFontSize`, jusqu'à 14 px)
    // peut ne plus tenir sur la page 1 : pdfmake, `columns` n'étant PAS
    // synchronisées entre elles pour la pagination, reporte alors la colonne
    // entière en page 2 (« carte esseulée », défaut prouvé PG.REFIX round 1)
    // au lieu de scinder proprement. Calculé sur les mêmes champs que le
    // rendu (situation générale/particulière + un texte par cible) : réduit
    // le palier AVANT que `card()` (insécable) ne soit mis en présence d'un
    // contenu trop grand pour la place restante.
    const adversaries = formData.adversaries ?? [];
    const coverTextFields = [formData.situation_generale, formData.situation_particuliere].map(str);
    const coverFontPx = coverCardFontPx(coverTextFields, adversaries.length);

    const situationCard = card(
        [
            h3('1. SITUATION GLOBALE', p),
            labelValue('Situation générale', strOr(formData.situation_generale), p, { valueBold: true }),
            labelValue('Situation particulière', strOr(formData.situation_particuliere), p, { valueBold: true }),
        ],
        p,
        // Sécable (cf. JSDoc `card()`, blocks.ts) : filet de sécurité si même
        // le palier de police le plus bas ne suffit pas à faire tenir un
        // `situation_generale`/`situation_particuliere` très volumineux sur
        // la page 1 — la carte se scinde alors normalement plutôt que d'être
        // reportée EN BLOC (défaut « carte esseulée »).
        { unbreakable: false },
    );

    const ciblesBody: Content[] =
        adversaries.length > 0
            ? adversaries.map((adv): Content => {
                  const nom = strOr(adv.nom_adversaire, 'Inconnu');
                  const detail = [strOr(adv.stature_adversaire, ''), strOr(adv.ethnie_adversaire, '')]
                      .filter((v) => v !== '')
                      .join(' ');
                  return {
                      stack: [
                          { text: nom, bold: true, color: p.accent, fontSize: 13 },
                          ...(detail !== '' ? [{ text: detail, color: p.muted, bold: true } as Content] : []),
                          {
                              canvas: [{ type: 'line', x1: 0, y1: 6, x2: mm(55), y2: 6, lineWidth: 0.5, lineColor: p.border }],
                          },
                      ],
                      margin: [0, 0, 0, 6],
                  };
              })
            : [{ text: 'Aucune cible renseignée.', color: p.muted }];
    // Blindage BLIND.A (audit « tout unbreakable a un filet ») : `ciblesCard`
    // reste par défaut `unbreakable:true` (JUSTIFICATION, pas un correctif) —
    // chaque entrée y est bornée à 2-3 lignes (nom/détail/filet), un volume
    // qui ne peut réalistement pas dépasser une page entière ; la rendre
    // sécable a été essayé et RETIRÉ : posée en `grid2` à côté de
    // `situationCard` (elle-même sécable, filet ci-dessus), la rendre
    // sécable AUSSI fait interférer ses fragments avec ceux de la colonne
    // voisine sur plusieurs pages (`columns` pdfmake non synchronisées pour
    // la pagination, même limite documentée que le défaut « carte esseulée »
    // — constaté avec la fixture `adv-5-atcd40.json`, guardrail B1/B4 FAIL).
    const ciblesCard = card([h3('CIBLES(S)', p), ...ciblesBody], p);

    return {
        stack: [
            ...watermark,
            opCard,
            { stack: [h1('ORDRE INITIAL', p, { boxed: true })], margin: [0, mm(35), 0, mm(15)] },
            { stack: [grid2([situationCard], [ciblesCard])], fontSize: coverFontPx },
        ],
    };
}

/**
 * Découpe un texte en lignes légitimes — généralisation de `splitAtDashBoundaries`
 * (mission BLIND.A, scission pilotée universelle) à la carte DANGEROSITÉ/ATCD :
 * chaque entrée y est déjà préfixée d'un tiret (`- ATCD n : …`, même convention
 * que la conduite à tenir ZMSPCP/MOICP) — réutilise donc directement
 * `splitAtDashBoundaries` telle quelle. Sans frontière légitime (aucun tiret),
 * `splitAtDashBoundaries` renvoie le texte intact en un seul élément (R10) :
 * `buildDangerPages` retombe alors sur le filet minimal `unbreakable:false`.
 *
 * Bloc « DANGEROSITÉ » d'une fiche adversaire — police adaptative (`fontPx`,
 * déjà calculée par l'appelant sur l'ensemble de la fiche) PUIS scission
 * pilotée d'un `antecedents_adversaire` volumineux (mission BLIND.A,
 * généralisation R10 : matrice-rupture.md §3 — carte ENTIÈREMENT disparue,
 * silencieusement, au-delà de ~30 lignes d'ATCD, `card()` par défaut
 * `unbreakable:true`). `columnWidthPt` = largeur réelle de la colonne où la
 * carte est posée (demi-page avec photo, pleine largeur sans) — sert à
 * estimer le nombre de lignes réellement occupées par chaque entrée ATCD
 * (`estimateWrappedLines`, même méthode que ZMSPCP/MOICP).
 */
function buildDangerPages(opts: {
    advTitle: string;
    armesConnues: string;
    atcd: string;
    fontPx: number;
    columnWidthPt: number;
    p: OiPdfPalette;
    geo: ReturnType<typeof pageGeometry>;
    /**
     * Coût EN LIGNES du contenu qui partage la MÊME colonne que `dangerCard`
     * SUR LA PREMIÈRE PAGE — `identityCard` (h3 + `identityRows`) est
     * empilée AU-DESSUS dans `rightColumn` (`buildAdversaryFiche`) — jamais
     * comptabilisé avant ce correctif (défaut constaté : `firstPageBudget`
     * trop généreux, le débordement pdfmake NATUREL survenait alors AVANT le
     * point de scission prévu, désynchronisant le titre « (SUITE) » de la
     * coupure réelle — guardrail B4, fixture `adv-5-atcd40.json`).
     */
    siblingColumnOverheadLines: number;
}): { card: Content; extraPages: Content[] } {
    const { advTitle, armesConnues, atcd, fontPx, columnWidthPt, p, geo, siblingColumnOverheadLines } = opts;
    const items = splitAtDashBoundaries(atcd);
    const hasBoundary = items.length > 1;

    if (!hasBoundary) {
        // Filet minimal (R11/R16, mission BLIND.A « audit toi-même tout
        // unbreakable restant ») : aucune frontière légitime pour scinder
        // proprement — carte SÉCABLE (comme `situationCard` de la couverture,
        // `document-builder.ts::buildCover`) plutôt qu'insécable : jamais de
        // perte silencieuse, quel que soit le volume.
        return {
            card: card(
                [
                    h3('DANGEROSITÉ', p, { color: p.danger }),
                    labelValue('Armes Connues', armesConnues, p, { valueColor: p.danger, valueBold: true }),
                    labelValue('Dangerosité / ATCD', atcd, p),
                ],
                p,
                { unbreakable: false },
            ),
            extraPages: [],
        };
    }

    const charsPerLine = estimateCharsPerLine(fontPx, columnWidthPt);
    const overheadLines =
        1 /* h3 */ +
        estimateWrappedLines(`ARMES CONNUES : ${armesConnues}`, charsPerLine) +
        1 /* fieldLabel ATCD */ +
        siblingColumnOverheadLines;
    // Marge de sécurité 0,75 (calibrée empiriquement contre `adv-5-atcd40.json`,
    // guardrail B1/B4) : `catItemsPerPageBudget`/`estimateCharsPerLine`
    // (theme.ts) sont calibrés sur la colonne `grid2` à demi-largeur de
    // `buildArticulationCorePages` — la carte DANGEROSITÉ, elle, partage sa
    // page avec BEAUCOUP plus de contenu voisin (identité, localisation,
    // mobilité) dont le coût réel en hauteur reste, comme documenté partout
    // ailleurs dans ce fichier, une approximation grossière (aucune mesure de
    // rendu réelle possible dans ce module PUR) — une marge conservatrice
    // évite un débordement pdfmake NATUREL qui désynchroniserait le titre
    // « (SUITE) » de la coupure réelle (préférable à une scission au plus
    // juste qui échoue silencieusement à protéger le titre).
    const DANGER_BUDGET_SAFETY_FACTOR = 0.75;
    const budget = Math.max(
        1,
        Math.round(catItemsPerPageBudget(fontPx) * (geo.contentHeightPt / A4_CONTENT_HEIGHT_PT) * DANGER_BUDGET_SAFETY_FACTOR),
    );
    // BLIND.REFIX round 1 — SCISSION TROP AGRESSIVE À FAIBLE VOLUME (régression
    // vs baseline 4f630a6) : soustraire `overheadLines`/`DANGER_BUDGET_SAFETY_FACTOR`
    // du budget de la PREMIÈRE page, INCONDITIONNELLEMENT, ramenait `first` à 1
    // seul item dès que l'overhead (bandeau identité/localisation voisin,
    // marge conservatrice) dépassait le budget — y compris pour un volume
    // ATCD ORDINAIRE qui tenait entièrement sur une page au baseline (5 ATCD
    // d'une ligne chacun, `adv-atcd5.json` : `budget=12`, `overheadLines=18`,
    // `totalCost=5` → scission dès le 1er item alors que les 5 tiennent
    // largement). Correctif : ne consulter `overheadLines`/le facteur de
    // sécurité QUE si le coût TOTAL de la liste dépasse déjà le budget de
    // page NORMAL (sans marge conservatrice) — la marge conservatrice est un
    // filet contre le désébordement pdfmake NATUREL lors d'une VRAIE
    // scission, pas une pénalité à payer par les fiches qui n'ont jamais
    // besoin de scinder.
    const itemCosts = items.map((item) => estimateWrappedLines(item, charsPerLine));
    const totalCost = itemCosts.reduce((a, b) => a + b, 0);
    const normalBudget = Math.max(1, Math.round(catItemsPerPageBudget(fontPx) * (geo.contentHeightPt / A4_CONTENT_HEIGHT_PT)));
    const fitsWithoutSplit = totalCost <= normalBudget;
    const chunks = fitsWithoutSplit
        ? [items]
        : chunkItemsByCost(items, (item) => estimateWrappedLines(item, charsPerLine), {
              first: Math.max(1, budget - overheadLines),
              rest: budget,
          });

    const firstCard = card(
        [
            h3('DANGEROSITÉ', p, { color: p.danger }),
            labelValue('Armes Connues', armesConnues, p, { valueColor: p.danger, valueBold: true }),
            fieldLabel('Dangerosité / ATCD', p),
            ...dashItemList(chunks[0] ?? [], p),
        ],
        p,
        { unbreakable: false },
    );
    const extraPages: Content[] = chunks.slice(1).map(
        (chunk): Content => ({
            stack: [
                h2(`${advTitle} (SUITE)`, p, geo.contentWidthPt),
                card([fieldLabel('Dangerosité / ATCD (suite)', p), ...dashItemList(chunk, p)], p, { unbreakable: false }),
            ],
            fontSize: fontPx,
            pageBreak: 'before',
        }),
    );
    return { card: firstCard, extraPages };
}

/* ==========================================================================
 * Section 2 — Fiche adversaire dédiée (pdf-engine-v2.ts:894-958, §3.2 ligne 2).
 * ======================================================================== */
function buildAdversaryFiche(ctx: BuildCtx, adv: OiAdversary, index: number): Content[] {
    const { photosBase64, dynamicPhotos, p, geo, is169 } = ctx;
    const nom = strOr(adv.nom_adversaire, 'Inconnu');
    const mainPhotoId = dynamicPhotos[`photo_main_${adv.id}`]?.[0]?.id;
    const mainPhotoSrc = mainPhotoId ? photosBase64[mainPhotoId] : undefined;
    const maxPortraitHMm = is169 ? 75 : 90;

    const meList = adv.me_list.filter((m) => m.trim() !== '');
    const volumeList = adv.volume_list.filter((v) => v.trim() !== '');
    const etatEspritList = adv.etat_esprit_list.filter((v) => v.trim() !== '');
    const vehiculesList = adv.vehicules_list.filter((v) => v.trim() !== '');

    // Barème adaptatif — même liste de champs que `print-view.ts::adversaryFiche`
    // (port de `OrderHtmlAdversaires.ficheVolume`, référence commune aux 2 voies).
    const textFields = [
        adv.antecedents_adversaire,
        adv.armes_connues,
        adv.domicile_adversaire,
        adv.signes_particuliers,
        adv.substances_adversaire,
        adv.profession_adversaire,
        adv.situation_familiale,
        adv.attitude_adversaire,
        adv.stature_adversaire,
    ].map(str);
    const fontPx = adaptivePagePx(textFields, vehiculesList.length);

    // Tableau bordé (référence B : `kvRow()`, print-view.ts:89-90/303-310, la
    // MÊME classe `.k` que toute la fiche), pas des lignes de texte nues (D4,
    // `pdfv3-design-fix/DEFAUTS.md`) — `kvTable()` existait déjà, jamais appelée.
    const identityRows: Array<[string, string]> = [
        ['Naissance', `${strOr(adv.date_naissance)} @ ${strOr(adv.lieu_naissance)}`],
        ['Profession', strOr(adv.profession_adversaire)],
        ['Situation familiale', strOr(adv.situation_familiale)],
        ['Signalement', `${strOr(adv.stature_adversaire)} | ${strOr(adv.ethnie_adversaire)}`],
        ['Signes particuliers', strOr(adv.signes_particuliers, 'Ras')],
        ['Substances', strOr(adv.substances_adversaire)],
        ...(meList.length > 0 ? ([['Moyens Employés', meList.join(' / ')]] as Array<[string, string]>) : []),
    ];
    // Blindage BLIND.A (audit « tout unbreakable a un filet ») : `identityCard`
    // reste `unbreakable:true` (JUSTIFICATION) — nombre de lignes BORNÉ (6-7
    // `identityRows` fixes), ne peut réalistement pas dépasser une page ; son
    // coût EN LIGNES est en revanche réservé dans le budget de `dangerCard`
    // (`siblingColumnOverheadLines` ci-dessous, même colonne).
    const identityCard = card([h3('IDENTITÉ', p), kvTable(identityRows, p)], p);

    const advTitle = `2.${index} FICHE ADVERSAIRE : ${nom}`;
    // Largeur réelle de la colonne DANGEROSITÉ (demi-page avec photo, pleine
    // largeur sans — mission BLIND.A, cf. JSDoc `buildDangerPages`).
    const dangerColumnWidthPt = mainPhotoSrc !== undefined ? ctx.geo.contentWidthPt - mm(70) - mm(6) : ctx.geo.contentWidthPt;
    const { card: dangerCard, extraPages: dangerExtraPages } = buildDangerPages({
        advTitle,
        armesConnues: strOr(adv.armes_connues),
        atcd: strOr(adv.antecedents_adversaire),
        fontPx,
        columnWidthPt: dangerColumnWidthPt,
        p,
        geo,
        // `identityCard` (h3 + une ligne par `identityRows`) est empilée
        // AU-DESSUS de `dangerCard` dans `rightColumn` — et, SANS photo
        // (`head` en simple `stack` pleine largeur, pas de `columns`),
        // `localisationCard`/`mobiliteCard` (`grid2`, 2×(h3 + 2 lignes))
        // ainsi que le bandeau de titre partagent la MÊME page 1 — cf. JSDoc
        // `buildDangerPages::siblingColumnOverheadLines`. Constante `+8`
        // calibrée empiriquement (même méthode que `catItemsPerPageBudget`,
        // theme.ts) contre `adv-5-atcd40.json` (guardrail B1/B4).
        siblingColumnOverheadLines: 1 + identityRows.length + 8,
    });

    // Blindage BLIND.A : `domicile_adversaire`/`attitude_adversaire`/listes
    // véhicules sont non bornés — filet `unbreakable:false`.
    const localisationCard = card(
        [
            h3('LOCALISATION', p),
            labelValue('Domicile', strOr(adv.domicile_adversaire), p),
            labelValue('Volume / Esprit', `${volumeList.join(', ') || '-'} | ${etatEspritList.join(', ') || '-'}`, p),
        ],
        p,
        { unbreakable: false },
    );

    const mobiliteCard = card(
        [
            h3('MOBILITÉ', p),
            labelValue('Véhicules / Plaques', vehiculesList.join(' | ') || '-', p),
            labelValue('Attitude Attendue', strOr(adv.attitude_adversaire), p),
        ],
        p,
        { unbreakable: false },
    );

    const rightColumn: Content[] = [identityCard, dangerCard];
    const head: Content =
        mainPhotoSrc !== undefined
            ? {
                  columns: [
                      { width: mm(70), stack: [figure(mainPhotoSrc, [mm(70), mm(maxPortraitHMm)], p)] },
                      { width: '*', stack: rightColumn },
                  ],
                  columnGap: mm(6),
              }
            : { stack: rightColumn };

    const firstPage: Content = {
        stack: [
            ficheAdversaireTitleBar(advTitle, p),
            head,
            { text: '', margin: [0, 6, 0, 0] },
            grid2([localisationCard], [mobiliteCard]),
        ],
        fontSize: fontPx,
    };
    return [firstPage, ...dangerExtraPages];
}

/** Fiche adversaire + ses galeries « Photos annexes »/« Renfort possible » (pdf-engine-v2.ts:959-969). */
function buildAdversaryPages(ctx: BuildCtx): Content[] {
    const { formData, photosBase64, dynamicPhotos, p, geo } = ctx;
    const adversaries = formData.adversaries ?? [];
    const acc: Content[] = [];
    adversaries.forEach((adv, idx) => {
        pushPages(acc, buildAdversaryFiche(ctx, adv, idx + 1));
        const nom = strOr(adv.nom_adversaire, 'Inconnu');
        const extra = dynamicPhotos[`photo_extra_${adv.id}`] ?? [];
        const renfort = dynamicPhotos[`photo_renforts_${adv.id}`] ?? [];
        pushPages(acc, galleryPages(`Adversaire : ${nom} (Photos annexes)`, extra, photosBase64, p, geo));
        pushPages(acc, galleryPages(`Adversaire : ${nom} (Renfort possible)`, renfort, photosBase64, p, geo));
    });
    return acc;
}

/* ==========================================================================
 * Section 3 — « 3. ENVIRONNEMENT ET AMIS » (pdf-engine-v2.ts:972-996).
 * ======================================================================== */
function buildEnvironnement(ctx: BuildCtx): Content {
    const { formData, p, geo } = ctx;
    const left = [
        labelValue('Forces Amies / Concours', strOr(formData.amies), p),
        labelValue('Terrain / Météo', strOr(formData.terrain_info), p),
        labelValue('Éclairage', strOr(formData.eclairage), p),
        labelValue('Lever du soleil', strOr(formData.lever_soleil), p),
    ];
    const right = [
        labelValue('Population / Voisinage', strOr(formData.population), p),
        labelValue('Faune / Animaux', strOr(formData.faune_animaux), p),
        labelValue('Cadre Juridique', strOr(formData.cadre_juridique), p),
    ];
    // Blindage BLIND.A (audit « tout `unbreakable` restant a un filet ») :
    // champs texte libres non bornés (`amies`/`terrain_info`/…) — même filet
    // minimal `unbreakable:false` que `situationCard` (`buildCover`), jamais
    // de perte silencieuse si l'un d'eux dépasse la page.
    return {
        stack: [
            h2('3. ENVIRONNEMENT ET AMIS', p, geo.contentWidthPt),
            grid2([card(left, p, { unbreakable: false })], [card(right, p, { unbreakable: false })]),
            { text: '', margin: [0, 5, 0, 0] },
            grid2(
                [card([labelValue('Accès Principal', strOr(formData.acces_principal), p)], p, { unbreakable: false })],
                [card([labelValue('Cheminement Initial', strOr(formData.cheminement_initial), p)], p, { unbreakable: false })],
            ),
        ],
    };
}

/* ==========================================================================
 * Section 4 — « 4. MISSION DE L'UNITÉ » (pdf-engine-v2.ts:998-1003).
 * ======================================================================== */
function buildMission(ctx: BuildCtx): Content {
    const { formData, p, geo, baseFontSize } = ctx;
    return {
        stack: [
            h2("4. MISSION DE L'UNITÉ", p, geo.contentWidthPt),
            // Blindage BLIND.A : `missions_psig` est un champ texte libre non
            // borné — filet `unbreakable:false` (audit « tout unbreakable a un filet »).
            accentCard(
                null,
                [{ text: strOr(formData.missions_psig), bold: true, fontSize: Math.round(baseFontSize * 1.6), preserveLeadingSpaces: true }],
                p,
                'accent',
                { unbreakable: false },
            ),
        ],
    };
}

/* ==========================================================================
 * Section 5 — « 5. EXÉCUTION » (pdf-engine-v2.ts:1007-1030).
 * ======================================================================== */
function buildExecution(ctx: BuildCtx): Content {
    const { formData, p, geo, baseFontSize } = ctx;
    const events = formData.time_events ?? [];
    const chronoRows: TableCell[][] =
        events.length > 0
            ? events.map((e): TableCell[] => [
                  { text: e.hour, alignment: 'center', borderColor: cellBorder(p) },
                  {
                      // Blindage BLIND.A #2 : `e.type`/`e.description` (`OiTimeEvent`, texte
                      // libre non typé `str()`) traversent `breakLongTokens()` au point d'entrée.
                      text: [{ text: breakLongTokens(e.type), bold: true }, { text: ` : ${breakLongTokens(e.description)}` }],
                      borderColor: cellBorder(p),
                  },
              ])
            : [[{ text: 'N/A', colSpan: 2, alignment: 'center', borderColor: cellBorder(p) }, {}]];
    const chronoTable: Content = {
        table: {
            widths: ['22%', '*'],
            headerRows: 1,
            body: [
                [
                    { text: 'Heure', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
                    { text: 'Événement', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
                ],
                ...chronoRows,
            ],
        },
        layout: LAYOUT_BORDERED,
    };
    // Blindage BLIND.A : `time_events` (chronologie) est une liste non bornée
    // — filet `unbreakable:false` (audit « tout unbreakable a un filet »).
    const chronoCard = card([h3('Chronologie Prévisionnelle', p), chronoTable], p, { unbreakable: false });

    const hypotheses = formData.hypotheses ?? [];
    const hypBody: Content[] =
        hypotheses.length > 0 ? hypotheses.map((h, i) => hypothesisLine(i, h, p)) : [{ text: '-', color: p.muted }];
    // Blindage BLIND.A : `formData.hypotheses` (liste libre, MÊME classe de
    // risque que la conduite à tenir ZMSPCP/MOICP, matrice-rupture.md §2/§3)
    // — filet `unbreakable:false`.
    const hypCard = card([h3("Hypothèses d'ensemble", p), ...hypBody], p, { unbreakable: false });

    return {
        stack: [
            h2('5. EXÉCUTION', p, geo.contentWidthPt),
            grid2(
                [labelValue("Date d'exécution", strOr(formData.date_execution), p)],
                [
                    labelValue('Heure H', strOr(formData.heure_execution), p, {
                        fontSize: Math.round(baseFontSize * 1.2),
                        valueColor: p.accent,
                        valueBold: true,
                    }),
                ],
            ),
            { text: '', margin: [0, 4, 0, 0] },
            labelValue('Idée de Manœuvre / Action', strOr(formData.action_body_text), p),
            { text: '', margin: [0, 4, 0, 0] },
            grid2([chronoCard], [hypCard]),
        ],
    };
}

/** Section 6 — Galerie « 6. LOGISTIQUE & TRANSPORTS (Cheminement) » (pdf-engine-v2.ts:1032-1039) : PR avant domicile, ordre conservé (§3.4 règle 3). */
function logisticsPhotos(dynamicPhotos: Record<string, OiPhotoMeta[]>): OiPhotoMeta[] {
    return [
        ...(dynamicPhotos['photo_container_transport_pr_preview_container'] ?? []),
        ...(dynamicPhotos['photo_container_transport_domicile_preview_container'] ?? []),
    ];
}

/* ==========================================================================
 * Section 7 — « 7. ARTICULATION & ORDRES DE MOUVEMENT » (pdf-engine-v2.ts:1042-1057).
 * Toujours rendue (jamais omise dans la source).
 * ======================================================================== */
function buildArticulationOverview(ctx: BuildCtx): Content {
    const { formData, p, geo } = ctx;
    const rameVl = formData.rame_vl_order ?? [];
    const colonne = formData.colonne_progression_order ?? [];
    const penetration = formData.ordre_penetration_order ?? [];

    // Blindage BLIND.A : les 3 listes de pastilles sont non bornées (filet
    // `unbreakable:false`, audit « tout unbreakable a un filet »).
    const rameCard = card(
        [h3('Ordre Rame VL', p), rameVl.length > 0 ? pillRow(rameVl, p, { numbered: true }) : { text: '-' }],
        p,
        { unbreakable: false },
    );
    const colonneCard = card(
        [h3('Colonne Progression', p), colonne.length > 0 ? pillRow(colonne, p, { numbered: true }) : { text: '-' }],
        p,
        { unbreakable: false },
    );
    // Même pastille inline numérotée que « Ordre Rame VL »/« Colonne Progression »
    // (référence B : `pillList()`, print-view.ts:93-98, rend les 3 rangées à
    // l'identique) — D7, `pdfv3-design-fix/DEFAUTS.md`.
    const penetrationCard = card(
        [
            h3('Ordre de Pénétration', p),
            penetration.length > 0 ? pillRow(penetration, p, { numbered: true }) : { text: '-' },
            { text: '', margin: [0, 6, 0, 0] },
            labelValue('PLACE DU CHEF', strOr(formData.place_chef), p, { valueColor: p.accent }),
        ],
        p,
        { unbreakable: false },
    );

    return {
        stack: [
            h2('7. ARTICULATION & ORDRES DE MOUVEMENT', p, geo.contentWidthPt),
            grid2([rameCard], [colonneCard]),
            { text: '', margin: [0, 5, 0, 0] },
            penetrationCard,
        ],
    };
}

/* ==========================================================================
 * Blocs d'articulation groupés par index (ZMSPCP[i] / MOICP[i] / EFFRAC[i])
 * (pdf-engine-v2.ts:1059-1189, §3.2 lignes 8a-8g, §3.4 règle 4).
 *
 * MODÈLE DE PAGINATION v2 (correctif PG.IMPL, docs/SPEC-PDF-V3.md § Pagination
 * v2) : constat terrain (banc `pdfmake-pagination-bench`, contre-épreuve
 * `tests/pdf/fixtures/long-case.json`) — un champ « C conduite à tenir » long
 * (liste à tirets) débordait de sa page SANS que `document-builder.ts` ne le
 * sache jamais : pdfmake le rompt alors n'importe où dans le flux de texte,
 * abandonnant une QUEUE ORPHELINE sur la page suivante (« - Se tenir prêt...
 * pour fixer l'adversaire. » seule sur une page, guardrail B1). Corrigé en 2
 * temps, dans l'ordre de priorité de la mission : (1) POLICE ADAPTATIVE —
 * `adaptivePagePx` (déjà utilisée par la fiche adversaire) réduit le palier
 * du bloc entier selon son volume AVANT toute scission ; (2) SCISSION aux
 * frontières légitimes SEULEMENT si le nombre d'items à tiret dépasse encore
 * `catItemsPerPageBudget(fontPx)` au palier choisi (garde-fou de dernier
 * recours, cf. sa JSDoc `theme.ts`) — jamais en milieu de phrase, le
 * fragment suivant porte alors `(suite)` (règle cible strategica).
 * ======================================================================== */

/**
 * Découpe un texte en items aux frontières légitimes UNIQUEMENT — entre deux
 * tirets de liste (`\n- item`), jamais en milieu de phrase. Sans tiret
 * détecté (aucune frontière légitime disponible dans ce champ), renvoie le
 * texte INTACT en un seul élément : `document-builder.ts` ne scinde alors
 * JAMAIS ce bloc (un débordement pdfmake non contrôlé reste préférable à une
 * coupure arbitraire au milieu d'une phrase, cf. règle cible mission).
 */
function splitAtDashBoundaries(text: string): string[] {
    if (!text) {
        return [];
    }
    const parts = text
        .split(/\n(?=-\s)/)
        .map((s) => s.trim())
        .filter((s) => s !== '');
    return parts.length > 1 ? parts : [text];
}

/**
 * Découpe `items` en tranches dont le COÛT CUMULÉ (`cost(item)`, cf.
 * `estimateWrappedLines`) ne dépasse pas `budget` — jamais à l'intérieur
 * d'un item (frontière légitime uniquement, un item qui dépasse `budget` à
 * lui seul reste seul dans sa propre tranche plutôt que de bloquer la
 * boucle). `budget` <= 0 -> une seule tranche, jamais de boucle infinie.
 * Correctif PG.REFIX round 1 : remplace l'ancien `chunkItems(items, size)`
 * par NOMBRE D'ITEMS (`size` = `catItemsPerPageBudget(fontPx)`, 1 unité par
 * item quelle que soit sa longueur) — un item « à tiret » qui s'enroule sur
 * plusieurs lignes (colonne `grid2` à demi-largeur) coûtait toujours 1 unité,
 * jamais 2+, la scission ne se déclenchait donc jamais pour un bloc dont
 * seuls quelques items longs débordaient déjà la page (cf. JSDoc
 * `estimateCharsPerLine`, `theme.ts`). Unité commune préservée (`budget`
 * reste `catItemsPerPageBudget(fontPx)`, calibré à l'origine sur des items
 * d'UNE ligne) : pour un jeu d'items COURTS (1 ligne chacun), le comportement
 * est inchangé — coût 1 par item, comme avant.
 */
function chunkItemsByCost<T>(items: T[], cost: (item: T) => number, budgets: { first: number; rest: number }): T[][] {
    if (budgets.first <= 0 && budgets.rest <= 0) {
        return [items];
    }
    const chunks: T[][] = [];
    let current: T[] = [];
    let currentCost = 0;
    let budget = budgets.first > 0 ? budgets.first : Infinity;
    for (const item of items) {
        const c = cost(item);
        if (current.length > 0 && currentCost + c > budget) {
            chunks.push(current);
            current = [];
            currentCost = 0;
            budget = budgets.rest > 0 ? budgets.rest : Infinity;
        }
        current.push(item);
        currentCost += c;
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks.length > 0 ? chunks : [items];
}

/**
 * Rend une liste d'items à tiret comme une pile d'éléments INDIVIDUELLEMENT
 * insécables — pdfmake ne rompt donc jamais un item en milieu de phrase.
 * Chaque item reste très en-deçà de la hauteur d'une page (finding #1 du
 * banc : un bloc `unbreakable` DÉPASSANT une page est SILENCIEUSEMENT
 * SUPPRIMÉ par pdfmake — jamais appliqué ici à un bloc de la taille d'une
 * page, seulement à chaque item pris isolément).
 */
function dashItemList(items: string[], p: OiPdfPalette): Content[] {
    return items.map(
        (item, i): Content => ({
            // Blindage BLIND.A #2 (`text-utils.ts`) : c'est ICI, un item `unbreakable`
            // dans une colonne étroite, qu'un token sans espace ≥ ~76-80 caractères
            // faisait CRASHER tout le rendu pdfmake (matrice-rupture.md §4) — filet posé
            // au plus près du point de crash.
            text: breakLongTokens(item),
            color: p.text,
            margin: [0, i === 0 ? 0 : 2, 0, 0],
            unbreakable: true,
        }),
    );
}

/** Libellé de champ seul (port du préfixe `LABEL :` de `labelValue`, sans valeur inline) — utilisé devant une `dashItemList` scindée sur plusieurs pages. */
function fieldLabel(label: string, p: OiPdfPalette): Content {
    return { text: `${label.toUpperCase()} :`, bold: true, color: p.accent, margin: [0, 0, 0, 2] };
}

/** Champs texte communs ZMSPCP/MOICP mesurés pour le palier de police adaptatif (même méthode que `buildAdversaryFiche::fontPx`, `adaptivePagePx`). */
function articulationBlockFontPx(fields: Array<string | undefined>, memberGroupCount: number): number {
    return adaptivePagePx(fields.map(str), memberGroupCount);
}

/**
 * Rendu commun ZMSPCP/MOICP (mutualisé, mission PG.IMPL — les deux blocs
 * partagent exactement la même mécanique de pagination, seuls les champs
 * « cœur » [Z/M/S/P ou M/O/I/P] et le libellé de la 1re colonne diffèrent).
 * `catText` est TOUJOURS rendu en liste d'items INDIVIDUELLEMENT insécables
 * dès qu'une frontière légitime (tiret) existe — même sur une seule page,
 * pas seulement en cas de scission — pour que pdfmake ne puisse JAMAIS
 * couper en milieu de phrase (rule cible mission), y compris quand un item
 * wrappé sur 2 lignes tombe near d'une frontière de page : seul un
 * débordement pdfmake NON contrôlé (au niveau d'un item unique, jamais du
 * bloc entier — finding #1 du banc, cf. JSDoc `dashItemList`) reste possible.
 * Sans frontière légitime (`catText` sans tiret), repli sur un simple
 * `labelValue` (comportement identique à avant ce correctif).
 */
function buildArticulationCorePages(opts: {
    title: string;
    sectionLabel: string;
    coreFields: Array<[string, string]>;
    catLabel: string;
    catText: string;
    cellsContent: Content[];
    placeChef: string;
    fontPx: number;
    p: OiPdfPalette;
    geo: ReturnType<typeof pageGeometry>;
}): Content[] {
    const { title, sectionLabel, coreFields, catLabel, catText, cellsContent, placeChef, fontPx, p, geo } = opts;
    const catItems = splitAtDashBoundaries(catText || '-');
    const hasBoundary = catItems.length > 1;
    // Garde-fou de dernier recours (JSDoc `catItemsPerPageBudget`/
    // `estimateWrappedLines`, theme.ts) : scission uniquement si le COÛT EN
    // LIGNES cumulé des items dépasse le budget d'UNE page au palier choisi
    // — sinon (immense majorité des cas réels) tout tient sur la page unique
    // du bloc, `chunkItemsByCost` renvoie alors `[catItems]`. Le coût d'un
    // item est son nombre de lignes RÉELLEMENT rendues (`estimateWrappedLines`,
    // colonne `grid2` à demi-largeur de page) — pas 1 unité fixe par item
    // (correctif PG.REFIX round 1, cf. JSDoc `chunkItemsByCost`).
    const catColumnWidthPt = (geo.contentWidthPt - mm(6)) / 2;
    const catCharsPerLine = estimateCharsPerLine(fontPx, catColumnWidthPt);
    // La PREMIÈRE page du bloc partage sa colonne gauche avec `h3(sectionLabel)`
    // + les champs cœur (Z/M/S/P ou M/O/I/P, avec leur libellé — même texte
    // que le rendu réel `labelValue`) AVANT les items : leur place, mesurée
    // en lignes via `estimateWrappedLines`, n'était PAS déduite du budget
    // (correctif PG.REFIX round 1 — cause du défaut « queue orpheline sans
    // titre » constaté sur `long-case.json` : le premier chunk débordait
    // quand même de la page 1, faute d'avoir réservé la place de ce
    // gabarit). Les pages « (suite) » n'ont, elles, que `h2`+`fieldLabel` —
    // déjà couverts par le budget `catItemsPerPageBudget` d'origine, inchangé.
    const catFirstPageOverheadLines =
        1 /* h3(sectionLabel) */ +
        coreFields.reduce((sum, [label, value]) => sum + estimateWrappedLines(`${label.toUpperCase()} : ${value}`, catCharsPerLine), 0);
    // `catItemsPerPageBudget(fontPx)` (theme.ts) est calibré pour la hauteur
    // utile de page `a4` (montage d'origine, mission PG.IMPL) — le format
    // `16:9` a une page plus BASSE (539,01 pt vs 595,28 pt de hauteur totale,
    // cf. `pageGeometry`) : appliqué tel quel, le budget de la page « (suite) »
    // reste surdimensionné pour `16:9` et débordait encore (correctif
    // PG.REFIX round 1 — 2e occurrence du défaut « queue orpheline sans
    // titre », cette fois en format `16:9`). Mis à l'échelle de la hauteur
    // utile RÉELLE de `geo` relative à celle d'`a4` — 1 en `a4` (aucun
    // changement, budget table d'origine préservé à l'identique).
    const catBudget = Math.max(1, Math.round(catItemsPerPageBudget(fontPx) * (geo.contentHeightPt / A4_CONTENT_HEIGHT_PT)));
    const catChunks = hasBoundary
        ? chunkItemsByCost(catItems, (item) => estimateWrappedLines(item, catCharsPerLine), {
              first: Math.max(1, catBudget - catFirstPageOverheadLines),
              rest: catBudget,
          })
        : [catItems];

    return catChunks.map((chunk, idx): Content => {
        const catNode: Content[] = hasBoundary
            ? [fieldLabel(idx === 0 ? catLabel : `${catLabel} (suite)`, p), ...dashItemList(chunk, p)]
            : [labelValue(catLabel, chunk[0] ?? '-', p)];
        const left: Content[] =
            idx === 0
                ? [h3(sectionLabel, p), ...coreFields.map(([label, value]) => labelValue(label, value, p)), ...catNode]
                : catNode;
        const right: Content[] =
            idx === 0
                ? [h3('Composition par Cellule', p), ...cellsContent, labelValue('Place du Chef', placeChef, p)]
                : [{ text: '' }];
        return {
            stack: [h2(idx === 0 ? title : `${title} (suite)`, p, geo.contentWidthPt), grid2(left, right)],
            fontSize: fontPx,
            // Convention `galleryPages()` (cf. en-tête de fichier) : bloc
            // multi-pages auto-cohérent, seule la 1re page reste nue, les
            // suivantes portent déjà leur propre saut — `pushPages` ne
            // rajoute rien après la première.
            pageBreak: idx === 0 ? undefined : 'before',
        };
    });
}

function buildZmspcpPage(ctx: BuildCtx, block: OiZmspcpBlock, memberToCell: Map<string, string>): Content[] {
    const { p, geo } = ctx;
    const groups = regroupByCellOrdered(block.members, memberToCell);
    const cellsContent: Content[] =
        groups.length > 0 ? groups.map(([cell, members]) => cellGroupBox(cell, members, p)) : [{ text: '-', color: p.muted }];
    const fontPx = articulationBlockFontPx(
        [block.zone, block.mission, block.secteur, block.points_particuliers, block.cat, block.place_chef],
        groups.length,
    );
    return buildArticulationCorePages({
        title: `Articulation : ZMSPCP - ${block.title || '-'}`,
        sectionLabel: 'ZMSPCP',
        coreFields: [
            ['Z zone', block.zone || '-'],
            ['M mission', block.mission || '-'],
            ['S secteur', block.secteur || '-'],
            ['P points particuliers', block.points_particuliers || '-'],
        ],
        catLabel: 'C conduite à tenir',
        catText: block.cat || '-',
        cellsContent,
        placeChef: block.place_chef || '-',
        fontPx,
        p,
        geo,
    });
}

function buildMoicpPage(ctx: BuildCtx, block: OiMoicpBlock, memberToCell: Map<string, string>): Content[] {
    const { p, geo } = ctx;
    const groups = regroupByCellOrdered(block.members, memberToCell);
    const cellsContent: Content[] =
        groups.length > 0 ? groups.map(([cell, members]) => cellGroupBox(cell, members, p)) : [{ text: '-', color: p.muted }];
    const fontPx = articulationBlockFontPx(
        [block.mission, block.objectif, block.itineraire, block.points_particuliers, block.cat, block.place_chef],
        groups.length,
    );
    return buildArticulationCorePages({
        title: `Articulation : MOICP - ${block.title || '-'}`,
        sectionLabel: 'MOICP',
        coreFields: [
            ['M mission', block.mission || '-'],
            ['O objectif', block.objectif || '-'],
            ['I itinéraire', block.itineraire || '-'],
            ['P points particuliers', block.points_particuliers || '-'],
        ],
        catLabel: 'C conduite à tenir',
        catText: block.cat || '-',
        cellsContent,
        placeChef: block.place_chef || '-',
        fontPx,
        p,
        geo,
    });
}

/** En-tête à 4 colonnes du tableau Hypothèses d'Effraction (R21 — répétée sur chaque page « (suite) », cf. `buildEffractionPages`). */
function hypothesesTableHeader(p: OiPdfPalette): TableCell[] {
    return [
        { text: 'Hypothèse', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
        { text: 'Technique / Moyen', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
        { text: 'Dégagement', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
        { text: 'Assaut', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
    ];
}

/** Une ligne du tableau Hypothèses d'Effraction — `h.desc` en est délibérément ABSENT (dérogation arbitrage #3 : rendu en bloc texte à part, cf. `hypothesesDescBlock`, jamais concaténé dans la cellule comme strategica, source du risque de débordement §4 `champs-fantomes.md`). */
function hypothesisTableRow(h: OiEffractionHypothesis, p: OiPdfPalette): TableCell[] {
    return [
        { text: breakLongTokens(h.title || h.id), bold: true, color: p.accent, borderColor: cellBorder(p) },
        { text: breakLongTokens(h.effrac || '-'), borderColor: cellBorder(p) },
        { text: breakLongTokens(h.degag || '-'), borderColor: cellBorder(p) },
        { text: breakLongTokens(h.assaut || '-'), borderColor: cellBorder(p) },
    ];
}

/** Fraction de `geo.contentWidthPt` occupée par chacune des 4 colonnes du tableau (mêmes largeurs que `widths` ci-dessous) — sert à estimer le nombre de lignes réellement occupées par une hypothèse (mission BLIND.A, scission pilotée). */
const HYP_TABLE_COLUMN_FRACTIONS = [0.2, 0.3, 0.25, 0.25];

/**
 * Coût EN LIGNES d'une hypothèse (mission BLIND.A, généralisation R10/scission
 * pilotée à la table Hypothèses d'Effraction, cf. `chunkItemsByCost` déjà
 * utilisé pour ZMSPCP/MOICP) — le MAX des 4 colonnes (celle qui déborde le
 * plus dicte la hauteur réelle de la ligne de tableau), jamais leur somme.
 * `h.desc` n'entre PAS dans ce coût (rendu à part, cf. `hypothesisTableRow`).
 */
function hypothesisRowCost(h: OiEffractionHypothesis, fontPx: number, contentWidthPt: number): number {
    const charsPerLineCols = HYP_TABLE_COLUMN_FRACTIONS.map((f) => estimateCharsPerLine(fontPx, contentWidthPt * f));
    const cols = [h.title || h.id, h.effrac || '-', h.degag || '-', h.assaut || '-'];
    return Math.max(...cols.map((text, i) => estimateWrappedLines(text, charsPerLineCols[i] as number)));
}

/**
 * Bloc « HE<n> — <titre> : <desc> » sous le tableau (arbitrage #3, dérogation
 * anti-débordement — `champs-fantomes.md` §4, option 2) : une hypothèse SANS
 * `desc` non-vide n'y figure pas. Chaque paragraphe rendu `unbreakable`
 * (`dashItemList`, réutilisé tel quel — filet R11 identique aux items ZMSPCP/
 * MOICP), le conteneur `unbreakable:false` (jamais de perte silencieuse si le
 * bloc entier dépasse la place restante).
 *
 * COSMÉTIQUE BLIND.REFIX round 1 : titre `h3` « Description des Hypothèses »
 * ajouté EN TÊTE — la voie B (`print-view.ts`, `<h3>Description des
 * Hypothèses</h3>`) titrait déjà ce bloc, la voie A le rendait sans titre
 * (juste la liste `HE1 — …`), ce qui cassait le repère visuel lors d'une
 * comparaison A/B côte à côte. Harmonisé sur le MÊME libellé ; le format par
 * item (`HE<n> — <titre> : <desc>` en liste à tiret) reste INCHANGÉ, c'est la
 * dérogation anti-débordement déjà actée (§4 ci-dessus), pas une divergence
 * à corriger.
 */
function hypothesesDescBlock(hypotheses: OiEffractionHypothesis[], p: OiPdfPalette): Content | null {
    const lines = hypotheses
        .map((h, i) => (h.desc && h.desc.trim() !== '' ? `HE${i + 1} — ${h.title || h.id} : ${h.desc}` : null))
        .filter((s): s is string => s !== null);
    if (lines.length === 0) {
        return null;
    }
    return {
        stack: [h3('Description des Hypothèses', p), ...dashItemList(lines, p)],
        unbreakable: false,
        margin: [0, 6, 0, 0],
    };
}

/**
 * Un bloc EFFRACTION est VIDE (§3.4 règle 1, correctif PG.REFIX round 1) si
 * AUCUNE mesure technique n'est saisie (les 9 champs rendus par `specs`
 * ci-dessous), AUCUNE hypothèse d'effraction, ET aucune photo de porte
 * résolue — constat terrain : une page pleine « STRUCTURE/SERRURERIE/
 * ENVIRONNEMENT/H. PORTE/PROF. BÂTI/BÂTI À BÂTI/DORMANT/PROF. LINTEAUX »
 * tous à `-` et « Aucune hypothèse saisie », pour un bloc créé mais jamais
 * renseigné (même défaut de principe que `buildCatPage`/`buildPatracPage`,
 * jusqu'ici jamais porté aux blocs effraction). Une SEULE mesure saisie,
 * une hypothèse, ou une photo de porte suffit à rendre la page (jamais de
 * perte de données saisies). Volontairement INCHANGÉ par le blindage BLIND.A
 * (champs fantômes #3, ci-dessous).
 *
 * CORRECTIF BLIND.REFIX round 1 — PERTE SILENCIEUSE D'UN CHAMP FANTÔME
 * NOUVELLEMENT RENDU : cette liste ne testait QUE les 9 mesures historiques
 * ci-dessus — elle ignorait `mission`/`porte`/`prof_marche`/`prof_moulure`,
 * pourtant rendus depuis le champ fantôme #3 (`OrderHtmlArticulation.kt:245,
 * 279, 289-290`). Reproduit sur `tests/pdf/fixtures/long-case.json` (ET
 * `adv-atcd5.json`/`adv-atcd10.json`) : un bloc où SEUL `mission` est saisi
 * (« FRANCHISSEMENT DE LA PORTE D'ENTREE. », les 9 mesures + hypothèses +
 * porte/prof_marche/prof_moulure tous vides) était donc entièrement
 * SUPPRIMÉ — perte totale d'une donnée saisie, contraire à l'arbitrage
 * « zéro perte de données quel que soit le volume ». L'ancienne
 * justification (« `mission: '-'` comme simple valeur de repli sur des
 * fixtures par ailleurs vides ») ne tient pas à l'examen : ce repli `'-'`
 * n'existe QU'au rendu (`labelValue('Mission', block.mission || '-', p)`
 * ci-dessous), jamais dans la donnée `block.mission` elle-même testée ici —
 * un `block.mission` réellement vide (`''`/`undefined`) reste `''` après
 * `str().trim()`, aucun risque de faux positif « bloc non vide ».
 */
function isEffractionBlockEmpty(block: OiEffractionBlock, doorSrc: string | undefined): boolean {
    const measures = [
        block.mission,
        block.porte,
        block.structure,
        block.serrurerie,
        block.environnement,
        block.bati_a_bati,
        block.dormant_a_dormant,
        block.prof_linteaux,
        block.prof_bati,
        block.h_porte,
        block.h_marche,
        block.prof_marche,
        block.prof_moulure,
    ];
    const hasMeasure = measures.some((v) => str(v).trim() !== '');
    return !hasMeasure && block.hypotheses.length === 0 && doorSrc === undefined;
}

/**
 * Bloc « Articulation : EFFRACTION - <titre> » (pdf-engine-v2.ts:1132-1187,
 * §3.2 ligne 8f, POINT DE VIGILANCE §1). `[]` si `isEffractionBlockEmpty`
 * (§3.4 règle 1, correctif PG.REFIX round 1) — section omise, jamais de page
 * à titre seul pour un bloc créé mais non renseigné.
 *
 * Blindage PDF OI, mission BLIND.A : (1) champs fantômes #3 — `mission`
 * rendue en tête (port `OrderHtmlArticulation.kt:245`), `porte` en 1re ligne
 * des mesures (`:279`), `prof_marche`/`prof_moulure` en fin de mesures
 * (`:289-290`), `hypotheses[].desc` en bloc texte SOUS le tableau (dérogation
 * anti-débordement, cf. `hypothesesDescBlock`) ; (2) `effracFontPx` (R7,
 * jusqu'ici non portée) réduit le palier de police AVANT toute scission ;
 * (3) scission pilotée de la table (aucune perte silencieuse au-delà de 8
 * hypothèses, matrice-rupture.md §2 : `card()` par défaut `unbreakable:true`
 * était SILENCIEUSEMENT SUPPRIMÉE par pdfmake au-delà d'une page).
 */
function buildEffractionPages(ctx: BuildCtx, block: OiEffractionBlock): Content[] {
    const { photosBase64, dynamicPhotos, p, geo, is169 } = ctx;
    const doorMeta = dynamicPhotos[`photo_effrac_${block.id}`]?.[0];
    const doorSrc = doorMeta ? photosBase64[doorMeta.id] : undefined;
    if (isEffractionBlockEmpty(block, doorSrc)) {
        return [];
    }
    const tools = doorMeta ? parseTools(doorMeta.tools) : [];
    const topHMm = is169 ? 65 : 75;
    const title = `Articulation : EFFRACTION - ${block.title || '-'}`;

    const hypotheses = block.hypotheses;
    const fontPx = effracFontPx(
        [block.mission, ...hypotheses.flatMap((h) => [h.title, h.desc, h.effrac, h.degag, h.assaut])].map(str),
        hypotheses.length,
    );

    // Bandeau d'outils : port simplifié en empilement SOUS la photo plutôt
    // qu'en `absolutePosition` exact (aucune assertion de coordonnées côté
    // test ; le contenu/ordre visuel — repli 'PORTE' si aucun outil — est
    // préservé, seule la mécanique de positionnement est simplifiée).
    const toolsBadges: Content =
        tools.length > 0
            ? pillRow(tools, p, { fillColor: p.warning, textColor: '#000000' })
            : pillRow(['PORTE'], p, { fillColor: p.warning, textColor: '#000000' });

    const rightColWidthPt = doorSrc !== undefined ? geo.contentWidthPt - mm(70) - mm(6) : geo.contentWidthPt;

    const specs = card(
        [
            h3('Caractéristiques Techniques', p),
            // Champ fantôme #3 (`porte`, `OrderHtmlArticulation.kt:279`) : 1re ligne,
            // AVANT Structure — même ordre que strategica (`champs-fantomes.md` #2).
            labelValue('Type de Porte', block.porte || '-', p),
            grid2(
                [
                    labelValue('Structure', block.structure || '-', p),
                    labelValue('Serrurerie', block.serrurerie || '-', p),
                    labelValue('Environnement', block.environnement || '-', p),
                ],
                [
                    labelValue('Bâti à Bâti', `${block.bati_a_bati || '-'} mm`, p),
                    labelValue('Dormant à Dormant', `${block.dormant_a_dormant || '-'} mm`, p),
                    labelValue('Prof. Linteaux', `${block.prof_linteaux || '-'} mm`, p),
                ],
            ),
            {
                // Filet pointillé pleine largeur (§3.2 ligne 8f) — largeur approximée
                // à la colonne droite moins le padding de carte (2×8pt), non testée
                // au pixel près (aucune assertion géométrique côté test).
                canvas: [
                    { type: 'line', x1: 0, y1: 0, x2: Math.max(0, rightColWidthPt - 16), y2: 0, lineWidth: 1, lineColor: p.border, dash: { length: 2 } },
                ],
                margin: [0, 6, 0, 6],
            },
            grid2([labelValue('H. Porte', block.h_porte || '-', p)], [labelValue('H. Marche', block.h_marche || '-', p)]),
            // Champ fantôme #3 (`prof_marche`/`prof_moulure`, `OrderHtmlArticulation.kt:289-290`)
            // — dernières lignes des mesures, même ordre que strategica.
            grid2([labelValue('Prof. Marche', `${block.prof_marche || '-'} mm`, p)], [labelValue('Prof. Bâti', block.prof_bati || '-', p)]),
            labelValue('Prof. Moulure', `${block.prof_moulure || '-'} mm`, p),
        ],
        p,
        // Blindage BLIND.A : champs texte libres non bornés (`structure`,
        // `serrurerie`, `environnement`…) — filet `unbreakable:false`.
        { unbreakable: false },
    );

    const head: Content =
        doorSrc !== undefined
            ? {
                  columns: [
                      { width: mm(70), stack: [figure(doorSrc, [mm(70), mm(topHMm)], p), { text: '', margin: [0, 2, 0, 0] }, toolsBadges] },
                      { width: '*', stack: [specs] },
                  ],
                  columnGap: mm(6),
              }
            : { stack: [specs] };

    // Champ fantôme #3 (`mission`, `OrderHtmlArticulation.kt:245`) : sa propre
    // ligne EN TÊTE de page, AVANT le bloc photo/mesures — même ordre que
    // strategica (les fiches MOICP/ZMSPCP montrent déjà « Mission » en tête).
    const missionLine = labelValue('Mission', block.mission || '-', p);

    const descBlock = hypothesesDescBlock(hypotheses, p);

    // Scission pilotée (mission BLIND.A, généralisation R10 à la table
    // Hypothèses d'Effraction) : chaque hypothèse est une frontière légitime
    // (jamais de coupure en milieu de ligne), le budget est le MÊME barème
    // `catItemsPerPageBudget`/mise à l'échelle `geo` que ZMSPCP/MOICP
    // (`buildArticulationCorePages`). Page 1 réserve un overhead pour le
    // bandeau photo/specs (heuristique : ~la moitié du budget, ce bloc
    // occupant grossièrement la moitié de la hauteur utile de page).
    const budget = Math.max(1, Math.round(catItemsPerPageBudget(fontPx) * (geo.contentHeightPt / A4_CONTENT_HEIGHT_PT)));
    const firstPageBudget = Math.max(1, Math.round(budget / 2));
    const hypChunks: OiEffractionHypothesis[][] =
        hypotheses.length > 0
            ? chunkItemsByCost(hypotheses, (h) => hypothesisRowCost(h, fontPx, geo.contentWidthPt), {
                  first: firstPageBudget,
                  rest: budget,
              })
            : [[]];

    return hypChunks.map((chunk, idx): Content => {
        const rows: TableCell[][] =
            chunk.length > 0
                ? chunk.map((h) => hypothesisTableRow(h, p))
                : [[{ text: 'Aucune hypothèse saisie', colSpan: 4, alignment: 'center', borderColor: cellBorder(p) }, {}, {}, {}]];
        const hypTable: Content = {
            table: {
                widths: ['20%', '30%', '25%', '25%'],
                headerRows: 1,
                // BLIND.REFIX round 1 — QUEUE ORPHELINE : `hypothesisRowCost`/
                // `chunkItemsByCost` ci-dessus n'assignent les hypothèses aux
                // pages qu'à partir d'une ESTIMATION heuristique de la place
                // encore disponible (`firstPageBudget` ne connaît pas la
                // hauteur RÉELLE du bandeau photo/specs qui précède la table
                // en page 1) — reproduit sur `effrac-n4.json` : l'estimation
                // plaçait 3 hypothèses en page 1 alors que seules 2,x
                // tenaient réellement, et SANS ce filet pdfmake scindait la
                // 3e ligne PAR LE MILIEU entre page 1 et sa continuation
                // automatique (page portant SEULEMENT l'en-tête répétée + les
                // queues de cellules, sans libellé « Hypothese 3 » ni titre
                // « (SUITE) », guardrail B1 FAIL). `dontBreakRows` interdit à
                // pdfmake de couper une ligne de table en deux, quelle que
                // soit la précision de l'estimation en amont : si une ligne
                // ne tient plus, elle bascule ENTIÈRE sur la continuation
                // automatique (en-tête répétée + libellé intact) plutôt que
                // tronquée — filet robuste indépendant du budget heuristique.
                dontBreakRows: true,
                body: [hypothesesTableHeader(p), ...rows],
            },
            layout: LAYOUT_BORDERED,
        };
        const isLastChunk = idx === hypChunks.length - 1;
        const hypCardBody: Content[] = [
            h3(idx === 0 ? "Hypothèses d'Effraction" : "Hypothèses d'Effraction (suite)", p),
            hypTable,
            ...(isLastChunk && descBlock !== null ? [descBlock] : []),
        ];
        const pageBody: Content[] =
            idx === 0
                ? [head, { text: '', margin: [0, 6, 0, 0] }, card(hypCardBody, p, { unbreakable: false })]
                : [card(hypCardBody, p, { unbreakable: false })];
        return {
            stack: [h2(idx === 0 ? title : `${title} (SUITE)`, p, geo.contentWidthPt), ...(idx === 0 ? [missionLine, { text: '', margin: [0, 4, 0, 0] } as Content] : []), ...pageBody],
            fontSize: fontPx,
            pageBreak: idx === 0 ? undefined : 'before',
        };
    });
}

/**
 * Boucle des blocs d'articulation groupés par index — port de
 * `pdf-engine-v2.ts:1059-1189` : `for i < max(moicp, zmspcp, effrac)`, ordre
 * interne ZMSPCP → MOICP → EFFRACTION (§3.4 règle 4). Photos « Baptême
 * Terrain » avant chaque page ZMSPCP, « Emplacement AO » après (§3.4 règle 3).
 */
function buildArticulationBlocksLoop(ctx: BuildCtx): Content[] {
    const { formData, photosBase64, dynamicPhotos, p, geo } = ctx;
    const moicpBlocks = formData.moicp_blocks ?? [];
    const zmspcpBlocks = formData.zmspcp_blocks ?? [];
    const effracBlocks = formData.effraction_blocks ?? [];
    const maxBlocks = Math.max(moicpBlocks.length, zmspcpBlocks.length, effracBlocks.length);
    const memberToCell = buildMemberToCellMap(formData.patracdvr_rows ?? []);
    const acc: Content[] = [];

    for (let i = 0; i < maxBlocks; i++) {
        const zmspcp = zmspcpBlocks[i];
        if (zmspcp) {
            const bapteme = dynamicPhotos[`photo_bapteme_${zmspcp.id}`] ?? [];
            pushPages(acc, galleryPages(`Baptême Terrain — ${zmspcp.title || '-'}`, bapteme, photosBase64, p, geo));
            pushPages(acc, buildZmspcpPage(ctx, zmspcp, memberToCell));
            const emplAo = dynamicPhotos[`photo_empl_ao_${zmspcp.id}`] ?? [];
            pushPages(acc, galleryPages(`ZMSPCP : ${zmspcp.title || '-'} (Emplacement AO)`, emplAo, photosBase64, p, geo));
        }

        const moicp = moicpBlocks[i];
        if (moicp) {
            pushPages(acc, buildMoicpPage(ctx, moicp, memberToCell));
            const ext = dynamicPhotos[`photo_itin_ext_${moicp.id}`] ?? [];
            const int_ = dynamicPhotos[`photo_itin_int_${moicp.id}`] ?? [];
            pushPages(acc, galleryPages(`MOICP : ${moicp.title || '-'}`, [...ext, ...int_], photosBase64, p, geo));
        }

        const effrac = effracBlocks[i];
        if (effrac) {
            pushPages(acc, buildEffractionPages(ctx, effrac));
            const photos = dynamicPhotos[`photo_effrac_${effrac.id}`] ?? [];
            pushPages(acc, galleryPages(`Effraction : ${effrac.title || '-'}`, photos, photosBase64, p, geo));
        }
    }
    return acc;
}

/**
 * Section 9 — « 8. CONDUITES À TENIR GÉNÉRALES » (pdf-engine-v2.ts:1195-1216),
 * OMISE si `cat_generales`/`no_go`/`cat_liaison` sont TOUS vides (§3.4 règle 1,
 * condition exacte `:1195`).
 */
function buildCatPage(ctx: BuildCtx): Content | null {
    const { formData, p, geo } = ctx;
    const cat = formData.cat_generales;
    const nogo = formData.no_go;
    const liaison = formData.cat_liaison;
    if (!cat && !nogo && !liaison) {
        return null;
    }

    // Blindage BLIND.A : `cat_generales`/`no_go`/`cat_liaison` sont des champs
    // texte libres non bornés — filet `unbreakable:false` (audit « tout
    // unbreakable a un filet »).
    return {
        stack: [
            h2('8. CONDUITES À TENIR GÉNÉRALES', p, geo.contentWidthPt),
            grid2(
                [accentCard('CAT Générales', [{ text: strOr(cat), preserveLeadingSpaces: true }], p, 'accent', { unbreakable: false })],
                [
                    accentCard(
                        'Conditions de Désengagement (NO-GO)',
                        [{ text: strOr(nogo), color: p.danger, bold: true, preserveLeadingSpaces: true }],
                        p,
                        'danger',
                        { unbreakable: false },
                    ),
                ],
            ),
            { text: '', margin: [0, 6, 0, 0] },
            accentCard('Liaison', [{ text: strOr(liaison), preserveLeadingSpaces: true }], p, 'warning', { unbreakable: false }),
        ],
    };
}

/**
 * Section 10 — « 7. RÉCAPITULATIF PATRACDVR » (pdf-engine-v2.ts:1219-1280),
 * OMISE si aucun membre (§3.4 règle 1, condition `:1224`). UNE seule table
 * `headerRows:1` (POINT DE VIGILANCE §1 — pagination manuelle `MAX_MEMBERS_PER_PAGE`
 * et suffixe `(Partie n)` supprimés, écart assumé E3). Nos 8/9 colonnes
 * (PAS les 12 de strategica) ; colonne DIR seulement si ≥1 membre a un `dir`
 * non vide (`:1227`).
 */
function buildPatracPage(ctx: BuildCtx): Content | null {
    const { formData, p, geo } = ctx;
    const rows = formData.patracdvr_rows ?? [];
    const allRows: Array<{ vehicle: string; m: OiPatracMember }> = [];
    for (const row of rows) {
        row.members.forEach((m, idx) => {
            allRows.push({ vehicle: idx === 0 ? row.vehicle : '', m });
        });
    }
    if (allRows.length === 0) {
        return null;
    }

    const hasDir = allRows.some((r) => r.m.dir.trim() !== '');
    // Largeurs adaptées (modèle pagination v2, mission PG.IMPL point 5 — banc
    // `pdfmake-pagination-bench` q3 : une colonne à largeur FIXE trop étroite
    // SANS `noWrap` casse un mot sans espace lettre à lettre ("KODIA Q BANA",
    // "SHARA N", "PSIG GILE TTE" constatés sur `long-case.json` p.15 avant ce
    // correctif). Toutes les colonnes « code court » (VL, PAX, CELLULE,
    // FONCTION, PPALE, SEC., AFIS, DIR) passent donc en `auto` + `noWrap` sur
    // leurs cellules (largeur = celle du plus long libellé RENCONTRÉ, jamais
    // coupée) ; seule EQPT/GREN. (texte combiné potentiellement long) reste
    // `*` et garde son retour à la ligne normal.
    const widths: Size[] = hasDir
        ? ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*', 'auto']
        : ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'];
    const headers = ['VL', 'PAX', 'CELLULE', 'FONCTION', 'PPALE', 'SEC.', 'AFIS', 'EQPT/GREN.', ...(hasDir ? ['DIR'] : [])];
    const headerRow: TableCell[] = headers.map((h) => ({
        text: h,
        bold: true,
        fillColor: p.headerRow,
        alignment: 'center',
        borderColor: cellBorder(p),
    }));

    const bodyRows: TableCell[][] = allRows.map(({ vehicle, m }) => {
        const eqpt = [m.equipement, m.equipement2, m.grenades, m.tenue, m.gpb].filter((v) => v && v !== 'Sans').join(', ') || '-';
        const cells: TableCell[] = [
            { text: vehicle, bold: true, fillColor: vehicle ? p.headerRow : undefined, alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
            { text: m.trigramme || '-', bold: true, alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
            { text: m.cellule || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
            { text: m.fonction || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
            { text: m.principales || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
            { text: m.secondaires || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
            { text: m.afis || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
            { text: eqpt, fontSize: 8, alignment: 'center', borderColor: cellBorder(p) },
        ];
        if (hasDir) {
            cells.push({ text: m.dir || '', bold: true, alignment: 'center', noWrap: true, borderColor: cellBorder(p) });
        }
        return cells;
    });

    const table: Content = {
        table: { widths, headerRows: 1, body: [headerRow, ...bodyRows] },
        layout: LAYOUT_BORDERED,
    };

    return {
        stack: [h2('7. RÉCAPITULATIF PATRACDVR', p, geo.contentWidthPt), table],
        fontSize: patracFontPx(allRows.length),
    };
}

/**
 * Section 11 — Page finale « AVEZ-VOUS DES QUESTIONS ? » (pdf-engine-v2.ts:1283-1294).
 * La bande de pied confidentiel de la source (`:1292`, `footerHtml`) est
 * PORTÉE dans le callback `footer` document-wide (écart assumé E2, cf.
 * `buildFooter` ci-dessous) — non dupliquée ici pour éviter un double
 * rendu sur cette page.
 */
function buildFinalPage(ctx: BuildCtx): Content {
    const { p, geo } = ctx;
    const bgSrc = resolveBgSrc(ctx);
    const watermark: Content[] = bgSrc !== undefined ? [buildWatermark(bgSrc, ctx)] : [];

    return {
        stack: [
            ...watermark,
            { text: '', margin: [0, mm(55), 0, 0] },
            h1('AVEZ-VOUS DES QUESTIONS ?', p, { fontSize: 44 }),
            {
                canvas: [
                    {
                        type: 'line',
                        x1: geo.contentWidthPt / 2 - mm(80),
                        y1: 0,
                        x2: geo.contentWidthPt / 2 + mm(80),
                        y2: 0,
                        lineWidth: 4,
                        lineColor: p.accent,
                        strokeOpacity: 0.15,
                    },
                ],
                margin: [0, mm(12), 0, 0],
            },
        ],
    };
}

/**
 * Pied de page document-wide — port du contenu de `pdf-engine-v2.ts:807-813`
 * (`footerHtml`), désormais répété sur TOUTES les pages sauf la garde (écart
 * assumé E2, SPEC-PDF-V3.md §3.1 T14/§7) au lieu de la seule page finale.
 */
function buildFooter(formData: OiFormData, p: OiPdfPalette): DynamicContent {
    return (currentPage: number, pageCount: number): Content | null => {
        if (currentPage === 1) {
            return null;
        }
        return {
            stack: [
                {
                    text: [
                        { text: `OI - ${strOr(formData.trigramme_redacteur, 'N/A')} - ${strOr(formData.unite_redacteur, 'N/A')} - ` },
                        { text: 'CONFIDENTIEL', color: p.danger, bold: true },
                    ],
                    alignment: 'center',
                    fontSize: 9,
                },
                { text: `${currentPage} / ${pageCount}`, alignment: 'center', fontSize: 8 },
            ],
            margin: [0, 4, 0, 0],
        };
    };
}

/** Volume total du document — port verbatim du barème `fontPx()` (`OrderHtml.kt:87-97`), même formule que `print-view.ts::documentVolume` (duplication assumée, indépendance des 2 voies). */
function documentVolume(formData: OiFormData): number {
    const textLen = (v: unknown): number => (v == null ? 0 : String(v).length);
    const moicp = formData.moicp_blocks ?? [];
    const zmspcp = formData.zmspcp_blocks ?? [];
    return (
        textLen(formData.situation_generale) +
        textLen(formData.situation_particuliere) +
        textLen(formData.missions_psig) +
        textLen(formData.action_body_text) +
        moicp.reduce((sum, b) => sum + b.mission.length, 0) +
        zmspcp.reduce((sum, b) => sum + b.mission.length, 0)
    );
}

/* ==========================================================================
 * API publique.
 * ======================================================================== */

/**
 * Nom de fichier — port EXACT de `pdf-engine-v2.ts:442-444` (contrat E2E,
 * `tests/e2e/oi.spec.ts:968` attend `/^OI_.*\.pdf$/`). Replis `SANS_DATE`/`RED`.
 */
export function oiPdfFileName(formData: OiFormData): string {
    const dateOp = (formData.date_op as string | undefined) || 'SANS_DATE';
    const trigramme = (formData.trigramme_redacteur as string | undefined) || 'RED';
    return `OI_${dateOp.replace(/\//g, '-')}_${trigramme}.pdf`;
}

/**
 * Construit la `TDocumentDefinitions` complète des 14 sections de l'OI, dans
 * l'ordre imposé par SPEC-PDF-V3.md §3.2. Port de `pdf-engine-v2.ts:608-1304`
 * (`generateHTML`) — structure/replis/omissions identiques, langage visuel
 * `blocks.ts`/`theme.ts` (strategica).
 */
export function buildOiDocDefinition(data: OiPdfCollectedData, opts: { format: OiPdfFormat }): TDocumentDefinitions {
    const { formData, photosBase64, isDark } = data;
    const p = palette(isDark);
    const geo = pageGeometry(opts.format);
    const dynamicPhotos = formData.dynamic_photos ?? {};
    const volume = documentVolume(formData);
    const baseFontSize = documentFontPx(volume);

    const ctx: BuildCtx = {
        formData,
        photosBase64,
        dynamicPhotos,
        p,
        geo,
        is169: opts.format === '16:9',
        baseFontSize,
    };

    const pages: Content[] = [];
    pushPage(pages, buildCover(ctx));
    pushPages(pages, buildAdversaryPages(ctx));
    pushPage(pages, buildEnvironnement(ctx));
    pushPage(pages, buildMission(ctx));
    pushPage(pages, buildExecution(ctx));
    pushPages(pages, galleryPages('6. LOGISTIQUE & TRANSPORTS (Cheminement)', logisticsPhotos(dynamicPhotos), photosBase64, p, geo));
    pushPage(pages, buildArticulationOverview(ctx));
    pushPages(pages, buildArticulationBlocksLoop(ctx));
    const catPage = buildCatPage(ctx);
    if (catPage !== null) {
        pushPage(pages, catPage);
    }
    const patracPage = buildPatracPage(ctx);
    if (patracPage !== null) {
        pushPage(pages, patracPage);
    }
    pushPage(pages, buildFinalPage(ctx));

    return {
        content: pages,
        pageSize: opts.format === 'a4' ? 'A4' : { width: geo.widthPt, height: geo.heightPt },
        pageOrientation: 'landscape',
        pageMargins: geo.marginsPt,
        // D2 (`pdfv3-design-fix/DEFAUTS.md`) : encre de corps par défaut jamais
        // recolorée — port de `body{color:${p.text}}` (print-style.ts:49).
        defaultStyle: { font: 'JetBrainsMono', fontSize: baseFontSize, lineHeight: 1.45, color: p.text },
        footer: buildFooter(formData, p),
        // D1 (`pdfv3-design-fix/DEFAUTS.md`) : fond de page jamais peint — sans ce
        // callback, pdfmake retombe sur SON propre blanc par défaut quel que soit
        // `isDark`. Port de `body{background:${p.bg}}` (print-style.ts:49), même
        // mécanique `canvas` que `buildWatermark()` (ci-dessus) pour l'image de fond.
        background: (_currentPage: number, pageSize: ContextPageSize): Content => ({
            canvas: [{ type: 'rect', x: 0, y: 0, w: pageSize.width, h: pageSize.height, color: p.bg, lineWidth: 0 }],
        }),
    };
}
