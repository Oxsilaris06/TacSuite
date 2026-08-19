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
    galleryToolsReservePt,
    grid2,
    h1,
    h2,
    h3,
    kvTable,
    labelValue,
    LAYOUT_BORDERED,
    LAYOUT_NONE,
    pillRow,
    registerPdfEditAnchor,
    type PdfFieldAnchor,
} from './blocks.js';
import {
    documentFontPx,
    mm,
    pageGeometry,
    palette,
    estimateCharsPerLine,
    estimateWrappedLines,
    fitUsageToPage,
    FIT_FONT_FLOOR,
    FIT_FONT_STEPS,
    OiPdfFitRefusalError,
    type OiPdfFitError,
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
    OiPdfEditAnchor,
    OiPhotoMeta,
    OiZmspcpBlock,
} from '@shared/types/contracts.js';

/* ==========================================================================
 * Helpers génériques (fidélité, saut de page, valeurs Store).
 * ======================================================================== */

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
 * Une valeur est VIDE (blanche OU réduite au repli littéral `'-'`) —
 * définition PARTAGÉE, port du filtre strategica (`.filter { it.isNotBlank()
 * }`, `OrderHtmlArticulation.kt:275-295`/`OrderHtmlAdversaires.kt:172-174`) :
 * un tiret seul n'est jamais une DONNÉE saisie, seulement un repli
 * d'affichage historique de ce module (`strOr`/`|| '-'`). Utilisée pour
 * décider qu'UNE LIGNE/CARTE entière doit être OMISE plutôt que rendue avec
 * son repli — jamais pour le texte affiché lui-même (`strOr` reste le repli
 * de RENDU une fois la carte confirmée non vide par ailleurs).
 */
function isBlankOrDash(v: unknown): boolean {
    const t = str(v).trim();
    return t === '' || t === '-';
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
    /**
     * Collecteur mutable des dépassements fit-to-page (mission P1, directive
     * Nico 2026-08-10) — chaque constructeur d'usage (fiche adversaire, page
     * ZMSPCP/MOICP, cellule effraction) y pousse une entrée quand
     * `fitUsageToPage` refuse même au palier plancher 7 px (`FIT_FONT_FLOOR`).
     * `buildOiDocDefinition` lève `OiPdfFitRefusalError(ctx.fitErrors)` en fin
     * de construction si non vide — REFUS DE GÉNÉRATION explicite, jamais de
     * document partiel/tronqué renvoyé à l'appelant.
     */
    fitErrors: OiPdfFitError[];
    /**
     * Index d'ancrage texte → champ source (mission « régression édition »,
     * SPEC-2026-08-18-pdf-et-champs.md §2) — collecteur mutable, ADDITIF
     * SEULEMENT (`blocks.ts::registerPdfEditAnchor`, `push` uniquement,
     * jamais lu ni réordonné pendant la construction) : chaque helper/site
     * d'appel qui émet une valeur `#oi-form` y ajoute une entrée, dans
     * l'ORDRE D'ÉMISSION du document — `buildOiDocDefinition` l'expose au
     * final sous `pdfEditAnchors`, `pdf-preview-edit.ts` le consomme dans ce
     * MÊME ordre pour rapprocher les fragments RÉELS de pdf.js.
     */
    anchors: OiPdfEditAnchor[];
}

/* --------------------------------------------------------------------------
 * Constructeurs de sélecteur d'ancrage (édition en place) — CHAÎNES SEULES,
 * jamais une opération DOM (module PUR, cf. en-tête de fichier) : résolues
 * côté navigateur par `pdf-preview-edit.ts` (`document.querySelectorAll`).
 * Les identifiants injectés (`advId`/`blockId`/`hypId`) sont TOUJOURS générés
 * par `formulaires.ts`/`articulation.ts` au format `<prefixe>_<timestamp>_
 * <alea36>` (alphanumérique + `_` seulement, jamais de guillemet ni de
 * caractère spécial CSS) — sûrs à interpoler tels quels dans un sélecteur
 * d'attribut `[data-x="..."]`, aucun échappement requis.
 * ------------------------------------------------------------------------ */

/** Champ `#oi-form` simple, valeur libre (mission, no_go, situation_generale…) — sélecteur = l'`id` DOM du champ, IDENTIQUE à la clé `formData[id]` (`formulaires.ts::syncDomToStoreCore`). */
function fieldAnchor(id: string): PdfFieldAnchor {
    return { selector: `#oi-form #${id}` };
}

/** Champ `.adv-field[data-field]` d'une fiche adversaire (`formulaires.ts:501-555`) — `field` = la clé `OiAdversary` lue (`nom_adversaire`, `domicile_adversaire`…), IDENTIQUE à l'attribut `data-field` posé côté DOM. */
function advFieldAnchor(advId: string, field: string): PdfFieldAnchor {
    return { selector: `#oi-form .adversary-entry[data-adv-id="${advId}"] [data-field="${field}"]` };
}

/**
 * Champ d'un bloc répété (MOICP/ZMSPCP/Effraction, `articulation.ts`) —
 * `blockKind` préfixe les classes de CHAQUE champ (`.moicp-mission`,
 * `.zmspcp-zone`, `.effrac-porte`…) ET, pour MOICP/ZMSPCP SEULEMENT, la
 * classe du CONTENEUR de bloc (`.moicp-block`/`.zmspcp-block`,
 * `articulation.ts:125`/`:226`). Le conteneur Effraction déroge à cette
 * convention : `articulation.ts:943` lui donne la classe `.effraction-block`
 * (mot complet), jamais `.effrac-block` — un préfixe unique pour les deux ne
 * matchait donc AUCUN élément DOM pour AUCUN champ Effraction (sélecteur
 * toujours vide, `resolveEditCandidates` sans candidat), constat mesure
 * navigateur réelle (page EFFRACTION : 100 fragments de texte, 0 zone
 * éditable posée, alors que les ancres étaient bien enregistrées).
 */
function blockFieldAnchor(blockKind: 'moicp' | 'zmspcp' | 'effrac', blockId: string, fieldClass: string): PdfFieldAnchor {
    const wrapperClass = blockKind === 'effrac' ? 'effraction-block' : `${blockKind}-block`;
    return { selector: `#oi-form .${wrapperClass}[data-block-id="${blockId}"] .${blockKind}-${fieldClass}` };
}

/** Champ d'une liste à plat SANS identifiant propre (hypothèses, chronologie — `formulaires.ts:772-778`) — `index` désambiguïse entre les N éléments que `containerSelector` retourne, dans le MÊME ordre que `querySelectorAll` (ordre DOM = ordre de construction de `formData`, cf. sites d'appel). */
function indexedFieldAnchor(containerSelector: string, index: number): PdfFieldAnchor {
    return { selector: `#oi-form ${containerSelector}`, index };
}

/**
 * Champ d'une liste répétée PROPRE À une fiche adversaire (Modes d'action,
 * `formulaires.ts:742` — `advData.ma_list = […].map(i => i.value).filter(Boolean)`)
 * — combine le scope `advFieldAnchor` (un seul adversaire, potentiellement
 * plusieurs sur le document) et l'index `indexedFieldAnchor` (plusieurs MA par
 * adversaire). `.filter(Boolean)` À LA SAUVEGARDE COMPACTE `ma_list` (un MA
 * vidé de son texte, mais dont le `<textarea>` n'a pas été retiré via le
 * bouton de suppression, disparaît du tableau SANS décaler les DOM suivants)
 * — un index brut sur `.ma-container .ma-input` désynchroniserait alors
 * `maList[i]` de son `<textarea>` réel dès qu'un MA intermédiaire est vidé
 * sans être supprimé. `:not(:placeholder-shown)` (pseudo-classe CSS4 native,
 * jamais de filtrage ad hoc côté `pdf-preview-edit.ts`) exclut du
 * `querySelectorAll` tout `<textarea>` actuellement VIDE (montrant son
 * `placeholder`, cf. `formulaires.ts:338`) — restaure la correspondance 1:1
 * avec `ma_list`, qui exclut les mêmes éléments par construction.
 */
function advIndexedFieldAnchor(advId: string, containerSelector: string, index: number): PdfFieldAnchor {
    return { selector: `#oi-form .adversary-entry[data-adv-id="${advId}"] ${containerSelector}`, index };
}

/**
 * Échappement minimal d'une valeur insérée dans un sélecteur d'attribut CSS
 * `[attr="..."]` — seuls `\` et `"` casseraient la chaîne déjà quotée
 * (`CSS.escape` échappe un IDENTIFIANT/NOM DE CLASSE entier, pas une valeur
 * DÉJÀ entre guillemets : outil inadapté ici). Nécessaire pour `trigramme`/
 * `vehicleName` (contrairement à `advId`/`blockId`, toujours alphanumériques
 * machine, cf. JSDoc `advFieldAnchor`) : ce sont des CHAMPS LIBRES, déjà
 * éditables tels quels par l'utilisateur (panneau Édition Rapide / renommage
 * véhicule) AVANT ce chantier.
 */
function escAttr(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Occurrences de chaque trigramme PATRACDVR dans le document ENTIER
 * (véhicules affectés + non affectés, mission « tout le texte modifiable »)
 * — un trigramme dupliqué (anomalie rare : renommage manuel via le panneau
 * Édition Rapide, SANS garde d'unicité contrairement à la CRÉATION,
 * `addManualMember`/`addCellBatch`, `patrac.ts`) rend `[data-trigramme="X"]`
 * AMBIGU (plusieurs boutons DOM potentiels). `patracMemberDatasetAnchor`
 * ci-dessous refuse alors d'ancrer TOUT champ de CE trigramme plutôt que de
 * risquer d'écrire dans le mauvais membre — même philosophie que la garde
 * d'ambiguïté de `pdf-preview-edit.ts` (« mieux vaut sous-couvrir qu'écrire
 * dans le mauvais champ »).
 */
function countPatracTrigrammes(formData: OiFormData): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (t: string): void => {
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    };
    for (const row of formData.patracdvr_rows ?? []) for (const m of row.members) bump(m.trigramme);
    for (const m of formData.patracdvr_unassigned ?? []) bump(m.trigramme);
    return counts;
}

/** Occurrences de chaque nom de véhicule PATRACDVR — même garde d'ambiguïté que `countPatracTrigrammes` (`addManualVehicle` ne contraint pas non plus l'unicité). */
function countPatracVehicleNames(formData: OiFormData): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of formData.patracdvr_rows ?? []) if (row.vehicle) counts.set(row.vehicle, (counts.get(row.vehicle) ?? 0) + 1);
    return counts;
}

/**
 * Ancrage `dataset` (mission « tout le texte modifiable ») d'un membre
 * PATRACDVR — désigne le `.patracdvr-member-btn` source par TRIGRAMME
 * (identité visible, même motif que `articulation.ts:386`), `datasetKey`
 * la clé de son `dataset` réellement affichée à cet endroit (`'trigramme'`
 * pour la colonne PAX/les pastilles Colonne-Progression/Ordre-Pénétration,
 * `'dir'` pour la colonne DIR du récapitulatif). `null` si le trigramme est
 * vide OU non unique dans le document (cf. `countPatracTrigrammes`) — dans
 * les deux cas, `registerPdfEditAnchor` no-op silencieusement (repli sûr).
 * SEULS ces 2 champs sont couverts : `fonction`/`cellule`/`principales`/
 * `secondaires`/`afis`/`grenades`/`equipement`/`equipement2`/`tenue`/`gpb`
 * restent des pastilles à CHOIX FERMÉ (panneau Édition Rapide), même
 * catégorie que la décision `<select>` documentée en tête de
 * `pdf-preview-edit.ts` — une saisie libre y romprait la cohérence avec
 * l'énumération contrainte, jamais couverte ici.
 */
function patracMemberDatasetAnchor(trigramme: string, datasetKey: 'trigramme' | 'dir', trigUniq: Map<string, number>): PdfFieldAnchor | null {
    if (!trigramme || (trigUniq.get(trigramme) ?? 0) !== 1) return null;
    return { selector: `#oi-form .patracdvr-member-btn[data-trigramme="${escAttr(trigramme)}"]`, kind: 'dataset', datasetKey };
}

/**
 * Ancrage `dataset` d'un véhicule PATRACDVR — désigne la `.patracdvr-vehicle-row`
 * source par NOM (identité visible), `datasetKey` toujours `'vehicleName'`
 * (seule valeur libre du véhicule). `null` si le nom est vide OU non unique
 * dans le document (cf. `countPatracVehicleNames`) — même repli sûr que
 * `patracMemberDatasetAnchor`.
 */
function patracVehicleDatasetAnchor(vehicleName: string, vehicleUniq: Map<string, number>): PdfFieldAnchor | null {
    if (!vehicleName || (vehicleUniq.get(vehicleName) ?? 0) !== 1) return null;
    return { selector: `#oi-form .patracdvr-vehicle-row[data-vehicle-name="${escAttr(vehicleName)}"]`, kind: 'dataset', datasetKey: 'vehicleName' };
}

/**
 * `labelValue(label, strOr(formData[key]), p, opts)` + ancrage `fieldAnchor(key)`
 * — raccourci pour le très grand nombre de champs `#oi-form` simples de
 * niveau racine rendus tels quels (mission « régression édition »), tous de
 * la même forme. N'introduit AUCUN comportement de rendu nouveau (`strOr`
 * inchangé) — strictement le même texte qu'un `labelValue` non ancré.
 */
function fv(ctx: BuildCtx, label: string, key: string, opts?: { fontSize?: number; valueColor?: string; valueBold?: boolean }): Content {
    return labelValue(label, strOr(ctx.formData[key]), ctx.p, opts, { anchors: ctx.anchors, ref: fieldAnchor(key) });
}

/* --------------------------------------------------------------------------
 * MODÈLE PHYSIQUE (POINTS) partagé par TOUS les solveurs fit-to-page de ce
 * module (mission P1, directive Nico 2026-08-10 : « une page = un usage »,
 * réutilisation du modèle physique existant `PDF_LINE_ADVANCE_EM`/budgets pt
 * hérité du correctif D2 EFFRACTION, désormais généralisé à la fiche
 * adversaire et aux blocs ZMSPCP/MOICP). Toutes les grandeurs ci-dessous sont
 * des POINTS, MESURÉS sur rendu réel (pdftotext -bbox, JetBrainsMono) :
 *   - avance de ligne réelle = fontPx × 1,914 (lineHeight 1,45 ×
 *     (ascender − descender)/1000 ≈ 1,32 em) ;
 *   - ligne de table = lignes de texte × avance + 9 pt (paddings verticaux +
 *     bordure) ; h2 de page 47,5 pt ; h3 + marges 27,9 pt.
 * ------------------------------------------------------------------------ */

/** Avance de ligne réelle pdfmake pour JetBrainsMono (voir bloc ci-dessus). */
const PDF_LINE_ADVANCE_EM = 1.914;
/** Paddings verticaux + bordure d'UNE ligne de table (mesuré). */
const EFFRAC_ROW_VPAD_PT = 9;
/** Bloc titre `h2` de page (texte + filet souligné + marges — mesuré 47,5). */
const EFFRAC_H2_PT = 48;
/** Titre `h3` + ses marges (mesuré 27,9). */
const EFFRAC_H3_PT = 28;
/** Paddings verticaux d'une carte (`card()`, haut + bas). */
const EFFRAC_CARD_VPAD_PT = 16;
/**
 * Marge de sécurité globale soustraite de la hauteur utile de page avant
 * toute décision fit-to-page (imprécision résiduelle du repli des mots,
 * marges inter-blocs non modélisées) — direction SÛRE : trop grande déclenche
 * un palier plus petit (ou un refus) un peu tôt, jamais un débordement
 * silencieux non détecté par le solveur.
 */
const EFFRAC_FITS_SAFETY_PT = 40;

/**
 * Lignes rendues d'un texte pouvant contenir des RETOURS À LA LIGNE saisis —
 * `estimateWrappedLines` seul les ignore : chaque segment replie
 * indépendamment, la somme fait la hauteur réelle.
 */
function wrappedLinesWithNewlines(text: string, charsPerLine: number): number {
    return text.split('\n').reduce((sum, seg) => sum + estimateWrappedLines(seg, charsPerLine), 0);
}

/** Avance de ligne réelle (pt) au palier `fontPx`. */
function effracLinePt(fontPx: number): number {
    return fontPx * PDF_LINE_ADVANCE_EM;
}

/** Coût (pt) d'un texte replié dans une colonne de `columnWidthPt` au palier `fontPx` — une seule mesure incluant les retours à la ligne saisis. */
function textLinePt(text: string, fontPx: number, columnWidthPt: number): number {
    const cpl = estimateCharsPerLine(fontPx, columnWidthPt);
    return wrappedLinesWithNewlines(text, cpl) * effracLinePt(fontPx);
}

/** Hauteur (pt) d'une carte (`card()`, blocks.ts) dont le CORPS (hors h3) coûte `bodyPt` — h3 + corps + paddings verticaux. */
function cardWithTitlePt(bodyPt: number): number {
    return EFFRAC_H3_PT + bodyPt + EFFRAC_CARD_VPAD_PT;
}

/**
 * Hauteur (pt) d'une grille de pilules (`pillRow`/`pillGrid`, blocks.ts) au
 * palier `fontPx` — `pillGrid` empile un nombre FIXE de 4 pilules par
 * rangée, INDÉPENDANT de la largeur de colonne (chaque rangée = une ligne de
 * table `LAYOUT_PILL`, paddings verticaux 2+2 pt, cf. sa JSDoc `blocks.ts`) :
 * coût = nombre de rangées × (avance de ligne + paddings). `itemCount === 0`
 * : une seule ligne de secours (`{ text: '-' }`). Réutilisé par
 * `buildArticulationOverview` (anomalie D).
 */
function pillGridPt(itemCount: number, fontPx: number): number {
    if (itemCount === 0) {
        return effracLinePt(fontPx);
    }
    return Math.ceil(itemCount / 4) * (effracLinePt(fontPx) + 4);
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
/**
 * PAS d'édition en place ici — décision DÉLIBÉRÉE (mission « tout le texte
 * modifiable »), pas un oubli. Mesure navigateur réelle : ancrer aussi CE
 * texte (trigrammes de la « Composition par Cellule », MOICP/ZMSPCP) au
 * MÊME mécanisme que `buildArticulationOverview` semblait initialement
 * corriger une collision (texte identique non ancré interceptant à tort un
 * ancrage lointain du récapitulatif PATRACDVR, cf. JSDoc `pdf-preview-edit.ts`
 * § SECOND CHEMIN D'ÉCRITURE) — mais AUGMENTE en réalité le volume total
 * d'ancrages `dataset` répartis sur les pages ZMSPCP/MOICP (9-13, chacune
 * pouvant lister PLUSIEURS cellules), ce qui a fait déborder
 * `STALE_FRAGMENT_BUDGET`/`WINDOW_AHEAD` avant d'atteindre le récapitulatif
 * : CONSTATÉ, mesure réelle — anchorsResolved 120→99, hitZonesPlaced
 * 394→336, la page RÉCAPITULATIF PATRACDVR ENTIÈRE retombant à 0 zone
 * (régression bien pire que le défaut ponctuel corrigé). Le VRAI risque de
 * sûreté (une zone DIR ouvrant l'éditeur TRIGRAMME) était en fait résolu
 * SÉPARÉMENT par `anchorKey` (`pdf-preview-edit.ts`, inclusion de
 * `datasetKey`) — cette collision de valeur restante (une zone « GHI »
 * pouvant apparaître sur une page ZMSPCP/MOICP au lieu du récapitulatif)
 * reste bénigne : elle pointe TOUJOURS vers le BON candidat (même élément,
 * même `datasetKey`), seule sa POSITION visuelle diffère de l'attendu —
 * jamais un risque d'écriture au mauvais endroit. Revert délibéré au profit
 * de la couverture mesurée la plus large et la plus sûre.
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
function hypothesisLine(index: number, text: string, p: OiPdfPalette, anchors: OiPdfEditAnchor[]): Content {
    // Édition en place : `formData.hypotheses` est une liste À PLAT sans
    // identifiant propre — `indexedFieldAnchor` désambiguïse par RANG parmi
    // les `.hypothese-input` du DOM, même ordre que `hypotheses.map` ci-dessus
    // (identique à l'ordre de construction de `formData.hypotheses`,
    // `formulaires.ts:778`).
    registerPdfEditAnchor(anchors, indexedFieldAnchor('#hypotheses_container .hypothese-input', index), text);
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

/** Taille de police FIXE (indépendante de `coverFontPx`) du nom d'une entrée CIBLES(S) — port verbatim du rendu ci-dessous. */
const CIBLES_NAME_FONT_PX = 13;
/**
 * Écart (pt) entre le bas du texte d'UNE entrée CIBLES(S) et le haut de la
 * suivante — mesuré (`pdftotext -bbox`, `adv30-a4.pdf`, mission « carte
 * CIBLES(S) qui disparaît ») : filet `canvas` + marge basse `[0,0,0,6]` du
 * bloc (rendu ci-dessous). N'est PAS un simple `+6` : la mesure réelle
 * (52,2 pt de pas entre deux noms consécutifs au palier plancher 8 px)
 * confirme ~12 pt une fois nom+détail soustraits.
 */
const CIBLES_ENTRY_GAP_PT = 12;
/**
 * Distance (pt) entre le haut de la zone de contenu de page 1 et le haut de
 * la ligne `h3('1. SITUATION GLOBALE')`/`h3('CIBLES(S)')` du `grid2` —
 * mesurée (`pdftotext -bbox`) : fixe, indépendante du format (`marginsPt`
 * identiques A4/16:9, `pageGeometry`) et du volume de texte (déterminée par
 * `h1('ORDRE INITIAL', {boxed:true})` fontSize 36 fixe + marges
 * `[0, mm(35), 0, mm(15)]` ci-dessous, elles-mêmes fixes).
 */
const CIBLES_GRID_ROW_TOP_PT = 260.5;

/** Nom/détail affichés d'UNE cible — PARTAGÉ entre le rendu (`renderCiblesEntry`) et son coût (`ciblesEntryPt`) : une seule source, jamais deux calculs divergents. */
function ciblesEntryText(adv: OiAdversary): { nom: string; detail: string } {
    const nom = strOr(adv.nom_adversaire, 'Inconnu');
    const detail = [strOr(adv.stature_adversaire, ''), strOr(adv.ethnie_adversaire, '')].filter((v) => v !== '').join(' ');
    return { nom, detail };
}

/** Coût (pt) d'UNE entrée CIBLES(S) (nom `CIBLES_NAME_FONT_PX` fixe + détail au palier `detailFontPx`) dans une colonne `columnWidthPt`. */
function ciblesEntryPt(adv: OiAdversary, detailFontPx: number, columnWidthPt: number): number {
    const { nom, detail } = ciblesEntryText(adv);
    const namePt = textLinePt(nom, CIBLES_NAME_FONT_PX, columnWidthPt);
    const detailPt = detail !== '' ? textLinePt(detail, detailFontPx, columnWidthPt) : 0;
    return namePt + detailPt + CIBLES_ENTRY_GAP_PT;
}

/** Coût (pt) d'un SOUS-ENSEMBLE d'entrées CIBLES(S) empilées — somme des coûts individuels moins UN écart de fin (`CIBLES_ENTRY_GAP_PT` sépare deux entrées, la DERNIÈRE d'une page n'en a pas besoin après elle). */
function ciblesRegionCostPt(subset: OiAdversary[], detailFontPx: number, columnWidthPt: number): number {
    if (subset.length === 0) {
        return 0;
    }
    return subset.reduce((sum, adv) => sum + ciblesEntryPt(adv, detailFontPx, columnWidthPt), 0) - CIBLES_ENTRY_GAP_PT;
}

/** Rendu d'UNE entrée CIBLES(S) — port verbatim (nom/détail/filet séparateur/marge) du rendu historique, factorisé pour être partagé par la page 1 (`grid2`) et les pages « CIBLES(S) — <plage> » de débordement. */
function renderCiblesEntry(adv: OiAdversary, p: OiPdfPalette): Content {
    const { nom, detail } = ciblesEntryText(adv);
    return {
        stack: [
            { text: nom, bold: true, color: p.accent, fontSize: CIBLES_NAME_FONT_PX },
            ...(detail !== '' ? [{ text: detail, color: p.muted, bold: true } as Content] : []),
            { canvas: [{ type: 'line', x1: 0, y1: 6, x2: mm(55), y2: 6, lineWidth: 0.5, lineColor: p.border }] },
        ],
        margin: [0, 0, 0, 6],
    };
}

/** Étiquette de plage « 3-4 »/« 3 » d'un sous-groupe de cibles CONTIGU au sein de l'ensemble complet — même idiome que `hypRangeLabel` (identité d'objet, groupes = slices de l'array d'origine). */
function ciblesRangeLabel(group: OiAdversary[], all: OiAdversary[]): string {
    const first = all.indexOf(group[0] as OiAdversary) + 1;
    const last = all.indexOf(group[group.length - 1] as OiAdversary) + 1;
    return first === last ? `${first}` : `${first}-${last}`;
}

/**
 * `packHypotheses` empaquette en GLOUTON (remplit une page au maximum avant
 * de passer à la suivante) : le tout DERNIER groupe hérite mécaniquement du
 * reliquat, parfois UNE SEULE entrée alors que les pages précédentes en
 * portent 6 (ex. 15 cibles pleine page → groupes 6/6/1, guardrail B1
 * anti-page-orpheline FAIL sur la page à 1 entrée). Rééquilibre les DEUX
 * DERNIERS groupes en une passe (jamais plus — reliquat borné par
 * construction à < 1 page pleine, un seul rééquilibrage suffit toujours à
 * l'éliminer) : fusionne puis coupe en deux moitiés d'effectif égal.
 * Vérifie `costPt` sur les deux nouvelles moitiés AVANT de les retenir —
 * direction sûre : un débordement (jamais observé en pratique, entrées
 * CIBLES(S) de taille quasi uniforme) fait simplement conserver
 * l'empaquetage glouton d'origine plutôt que d'introduire un dépassement.
 */
function rebalanceLastGroup<T>(groups: T[][], costPt: (subset: T[]) => number, budgetPt: number): T[][] {
    if (groups.length < 2) {
        return groups;
    }
    const last = groups[groups.length - 1] as T[];
    const prev = groups[groups.length - 2] as T[];
    if (last.length >= prev.length) {
        return groups;
    }
    const combined = [...prev, ...last];
    const half = Math.ceil(combined.length / 2);
    const newPrev = combined.slice(0, half);
    const newLast = combined.slice(half);
    if (costPt(newPrev) > budgetPt || costPt(newLast) > budgetPt) {
        return groups;
    }
    return [...groups.slice(0, -2), newPrev, newLast];
}

function buildCover(ctx: BuildCtx): Content[] {
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
            labelValue('Situation générale', strOr(formData.situation_generale), p, { valueBold: true }, {
                anchors: ctx.anchors,
                ref: fieldAnchor('situation_generale'),
            }),
            labelValue('Situation particulière', strOr(formData.situation_particuliere), p, { valueBold: true }, {
                anchors: ctx.anchors,
                ref: fieldAnchor('situation_particuliere'),
            }),
        ],
        p,
        // Sécable (cf. JSDoc `card()`, blocks.ts) : filet de sécurité si même
        // le palier de police le plus bas ne suffit pas à faire tenir un
        // `situation_generale`/`situation_particuliere` très volumineux sur
        // la page 1 — la carte se scinde alors normalement plutôt que d'être
        // reportée EN BLOC (défaut « carte esseulée »).
        { unbreakable: false },
    );

    // CORRECTIF (carte CIBLES(S) qui disparaît, anomalie CRITIQUE) — l'ancien
    // `ciblesCard` restait `unbreakable:true` par défaut (JUSTIFICATION
    // fausse : « bornée à 2-3 lignes par entrée, ne peut réalistement pas
    // dépasser une page » — mesure prouvée : dépassée dès 7-8 adversaires,
    // pdfmake SUPPRIME alors la carte SANS AUCUNE erreur, page 2 restant
    // blanche). Un simple `unbreakable:false` (comme `situationCard`) suffit
    // à éliminer la disparition et la page blanche, mais laisse pdfmake
    // couper le flux de caractères À N'IMPORTE QUEL ENDROIT (y compris EN
    // PLEIN MILIEU d'une entrée, entre son nom et son détail) et peut semer
    // une page de continuation quasi-VIDE (1 seule entrée orpheline, guardrail
    // B1 anti-page-orpheline) — défaut mesuré à l'identique de celui qui avait
    // fait RETIRER `unbreakable:false` lors d'une tentative antérieure
    // (fixture `adv-5-atcd40.json`).
    //
    // Nouvelle mécanique, RÉUTILISE le paqueteur déjà éprouvé pour EXACTEMENT
    // cette même classe de problème ailleurs dans ce module (`packHypotheses`,
    // « une frontière légitime = un item, jamais coupé en son milieu ») :
    // chaque ADVERSAIRE est une frontière légitime. La 1re page (grid2,
    // demi-largeur, budget réduit par le titre `h1` au-dessus —
    // `CIBLES_GRID_ROW_TOP_PT`, mesuré) reçoit autant d'entrées que son
    // budget le permet, MÊME ZÉRO si `situationCard` occupe déjà toute la
    // hauteur — jamais de carte esseulée. Le reste devient des pages
    // « CIBLES(S) — <plage> » AUTONOMES pleine largeur (jamais « (SUITE) »,
    // guardrail C1), MÊME titre distinct que `buildEffractionPages::hypRangeLabel`.
    // `packHypotheses` ne peut renvoyer `null` que si une SEULE entrée, prise
    // seule, ne tient pas sur une page dédiée pleine — pathologique pour une
    // entrée de 2-3 lignes ; filet de repli conservé quand même (une seule
    // carte insécable regroupant tout, JAMAIS de perte de cible).
    const columnWidthPt = (geo.contentWidthPt - mm(6)) / 2;
    const firstBudgetPt = Math.max(0, geo.contentHeightPt - CIBLES_GRID_ROW_TOP_PT - EFFRAC_H3_PT - EFFRAC_CARD_VPAD_PT - EFFRAC_FITS_SAFETY_PT);
    const restBudgetPt = Math.max(0, geo.contentHeightPt - EFFRAC_H2_PT - EFFRAC_H3_PT - EFFRAC_CARD_VPAD_PT - EFFRAC_FITS_SAFETY_PT);
    const regionCostPt = (subset: OiAdversary[]): number => ciblesRegionCostPt(subset, coverFontPx, columnWidthPt);
    const ciblesGroups: OiAdversary[][] =
        adversaries.length > 0 ? (packHypotheses(adversaries, regionCostPt, firstBudgetPt, restBudgetPt) ?? [adversaries]) : [[]];

    const ciblesFirstBody: Content[] =
        adversaries.length > 0
            ? ciblesGroups[0]?.map((adv) => renderCiblesEntry(adv, p)) ?? []
            : [{ text: 'Aucune cible renseignée.', color: p.muted }];
    const ciblesCard = card([h3('CIBLES(S)', p), ...ciblesFirstBody], p, { unbreakable: false });

    // Rééquilibre les deux DERNIERS groupes de débordement (jamais le groupe
    // 0, page 1/grid2 — colonne et budget distincts) : évite le reliquat
    // « dernière page à 1 seule cible » du paqueteur glouton (cf. JSDoc
    // `rebalanceLastGroup`, guardrail B1 anti-page-orpheline).
    const overflowGroups = adversaries.length > 0 ? rebalanceLastGroup(ciblesGroups.slice(1), regionCostPt, restBudgetPt) : [];
    const overflowPages: Content[] = overflowGroups.map((group) => ({
        stack: [
            h2(`CIBLES(S) — ${ciblesRangeLabel(group, adversaries)}`, p, geo.contentWidthPt),
            card([h3('CIBLES(S)', p), ...group.map((adv) => renderCiblesEntry(adv, p))], p, { unbreakable: false }),
        ],
        fontSize: coverFontPx,
        pageBreak: 'before',
    }));

    const coverPage: Content = {
        stack: [
            ...watermark,
            opCard,
            { stack: [h1('ORDRE INITIAL', p, { boxed: true })], margin: [0, mm(35), 0, mm(15)] },
            { stack: [grid2([situationCard], [ciblesCard])], fontSize: coverFontPx },
        ],
    };
    return [coverPage, ...overflowPages];
}

/**
 * Découpe un texte en lignes légitimes — généralisation de `splitAtDashBoundaries`
 * (mission BLIND.A, scission pilotée universelle) à la carte DANGEROSITÉ/ATCD,
 * via `splitAtcdBoundaries` (correctif D1) : entrées à tiret (`- ATCD n : …`)
 * OU, à défaut, RETOURS À LA LIGNE saisis (`2024 : USAGE…\n2022 : …`, format
 * réel constaté sur `cas-reel-01` — cf. JSDoc `splitAtcdBoundaries`). Sans
 * frontière légitime (ni tiret ni retour à la ligne), le texte reste intact en
 * un seul élément (R10) : `buildDangerPages` retombe alors sur le filet
 * minimal `unbreakable:false`.
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
/**
 * Répartit `items` en `cols` colonnes round-robin (item `i` → colonne `i %
 * cols`) — PARTAGÉ entre le coût (`adversaryAtcdListPt`) et le rendu
 * (`buildAdversaryFiche`) de la liste ATCD dense multi-colonnes : les deux
 * DOIVENT compter/rendre exactement la même répartition, jamais deux
 * logiques dupliquées qui divergeraient.
 */
function splitRoundRobin<T>(items: T[], cols: number): T[][] {
    const buckets: T[][] = Array.from({ length: cols }, () => []);
    items.forEach((item, i) => buckets[i % cols]?.push(item));
    return buckets;
}

/** Bandeau de titre « 2.<i> FICHE ADVERSAIRE » — hauteur physique (pt), texte + marge basse. */
const ADV_TITLE_BAR_PT = 34;

/**
 * Borne plancher (pt) de la photo d'identité de la fiche adversaire — mission
 * P1 bis (correctif Nico 2026-08-10, « la fiche adversaire déborde encore
 * malgré `photoPt` compté ») : le solveur peut réduire la photo jusqu'à cette
 * hauteur (au lieu de la hauteur nominale `maxPortraitHMm`) pour faire tenir
 * la fiche sur UNE page avant/en plus de réduire la police — jamais en-deçà
 * (photo illisible).
 */
const ADV_PHOTO_H_FLOOR_PT = 120;

/**
 * Coût (pt) d'UNE rangée de `kvTable` (label/valeur, blocks.ts) — mesure
 * ligne-par-ligne réelle du LIBELLÉ et de la VALEUR (les deux colonnes
 * peuvent s'enrouler : un libellé à 2 mots comme « Situation familiale »/
 * « Signes particuliers » s'enroule dans la colonne étroite `30%`, tout
 * comme une valeur longue dans la colonne `70%`) dans leur largeur RÉELLE de
 * rendu (`blocks.ts::kvTable` `widths:['30%','*']`, moins le padding de
 * cellule `LAYOUT_BORDERED` 4+4 pt), la hauteur de rangée suivant la colonne
 * la plus haute (jamais leur somme) ; plus le padding/bordure d'UNE ligne de
 * table déjà mesurés ailleurs (`EFFRAC_ROW_VPAD_PT`) — remplace l'ancien
 * repli `line + 6` (constante magique divergente de la mesure réelle, et qui
 * supposait le libellé toujours sur 1 ligne) qui sous-évaluait chaque
 * rangée, cause du débordement de la fiche adversaire (DANGEROSITÉ éjectée
 * seule en page orpheline) malgré la photo déjà comptée dans `leftPt`.
 */
export function identityRowPt(label: string, value: string, fontPx: number, columnWidthPt: number): number {
    const labelColWidthPt = columnWidthPt * 0.3 - 8;
    const valueColWidthPt = columnWidthPt * 0.7 - 8;
    // Le LIBELLÉ (`kvTable`, colonne `30%`) n'est PAS toujours court : « Situation
    // familiale »/« Signes particuliers » (2 mots) s'enroulent eux-mêmes sur 2
    // lignes dans cette colonne étroite au palier 11 px — sous-estimé par le
    // modèle précédent (label supposé toujours 1 ligne), cause résiduelle du
    // débordement de la fiche adversaire même une fois la photo comptée.
    return Math.max(textLinePt(label, fontPx, labelColWidthPt), textLinePt(value, fontPx, valueColWidthPt)) + EFFRAC_ROW_VPAD_PT;
}

/**
 * Hauteur (pt) de la liste ATCD dense (mission P1, directive Nico
 * 2026-08-10 : « ATCD en liste dense multi-colonnes si volumineuse ») au
 * palier `fontPx` — au-delà de `ADV_ATCD_DENSE_COLS_THRESHOLD` items, la
 * liste passe de 1 à 2 colonnes (même répartition que le rendu,
 * `splitRoundRobin`) : chaque colonne porte alors la MOITIÉ des items, la
 * hauteur totale suit la colonne la plus chargée (jamais leur somme).
 */
const ADV_ATCD_DENSE_COLS_THRESHOLD = 8;

function adversaryAtcdColumnCount(itemCount: number): 1 | 2 {
    return itemCount > ADV_ATCD_DENSE_COLS_THRESHOLD ? 2 : 1;
}

function adversaryAtcdListPt(items: string[], hasBoundary: boolean, atcdText: string, fontPx: number, columnWidthPt: number): number {
    const line = effracLinePt(fontPx);
    if (!hasBoundary) {
        return line + textLinePt(atcdText, fontPx, columnWidthPt);
    }
    const cols = adversaryAtcdColumnCount(items.length);
    const perColWidthPt = cols === 1 ? columnWidthPt : (columnWidthPt - mm(4)) / 2;
    const cpl = estimateCharsPerLine(fontPx, perColWidthPt);
    const colTotalsLines = splitRoundRobin(items, cols).map((bucket) => bucket.reduce((sum, item) => sum + estimateWrappedLines(item, cpl), 0));
    const maxColLines = Math.max(...colTotalsLines, 0);
    return line /* fieldLabel */ + maxColLines * line;
}

/* ==========================================================================
 * Section 2 — Fiche adversaire dédiée (pdf-engine-v2.ts:894-958, §3.2 ligne 2).
 *
 * MISSION P1 (directive Nico 2026-08-10, « une page = un usage ») — refonte
 * totale : UNE SEULE page par fiche adversaire, INTERDICTION ABSOLUE de
 * continuation « (SUITE) » (l'ancien `buildDangerPages`/`splitAtcdBoundaries`-
 * en-tant-que-scission-de-pages a été retiré). Structure « 2 colonnes pleine
 * hauteur » (design strategica) : colonne GAUCHE = photo (si présente) +
 * IDENTITÉ + DANGEROSITÉ (armes connues) ; colonne DROITE = LOCALISATION +
 * MOBILITÉ + ATCD en liste dense (1 ou 2 sous-colonnes selon le volume,
 * `adversaryAtcdListPt`/`splitRoundRobin`). Le palier de police est choisi
 * par le solveur fit-to-page PUR `fitUsageToPage` (theme.ts) : coût réel (pt)
 * recalculé à CHAQUE palier 11→7, jamais une simple estimation figée. Si
 * MÊME le palier plancher 7 px ne suffit pas, l'erreur est collectée dans
 * `ctx.fitErrors` (REFUS DE GÉNÉRATION global, cf. `buildOiDocDefinition`) —
 * la fiche est alors quand même rendue au palier plancher (le document entier
 * ne sera jamais renvoyé à l'appelant si `fitErrors` n'est pas vide).
 * ======================================================================== */
function buildAdversaryFiche(ctx: BuildCtx, adv: OiAdversary, index: number): Content {
    const { photosBase64, dynamicPhotos, p, geo, is169 } = ctx;
    const nom = strOr(adv.nom_adversaire, 'Inconnu');
    const mainPhotoId = dynamicPhotos[`photo_main_${adv.id}`]?.[0]?.id;
    const mainPhotoSrc = mainPhotoId ? photosBase64[mainPhotoId] : undefined;
    const maxPortraitHMm = is169 ? 55 : 65;

    const meList = adv.me_list.filter((m) => m.trim() !== '');
    const volumeList = adv.volume_list.filter((v) => v.trim() !== '');
    const etatEspritList = adv.etat_esprit_list.filter((v) => v.trim() !== '');
    const vehiculesList = adv.vehicules_list.filter((v) => v.trim() !== '');

    const advTitle = `2.${index} FICHE ADVERSAIRE : ${nom}`;
    // Nom affiché dans le bandeau de titre (`ficheAdversaireTitleBar`
    // ci-dessous) — texte libre non typé (`str()`), ancré séparément : ce
    // helper ne prend ni valeur ni référence isolée (`text` déjà composé),
    // cf. JSDoc `registerPdfEditAnchor`. Repli `'Inconnu'` de `nom`
    // délibérément NON ancré (`str(adv.nom_adversaire)` brut) — un champ
    // vide n'a aucune valeur SAISIE à corriger.
    registerPdfEditAnchor(ctx.anchors, advFieldAnchor(adv.id, 'nom_adversaire'), str(adv.nom_adversaire));
    const armesConnues = strOr(adv.armes_connues);
    const atcdText = strOr(adv.antecedents_adversaire);
    const atcdItems = splitAtcdBoundaries(atcdText);
    const hasAtcdBoundary = atcdItems.length > 1;
    const atcdRef: PdfFieldAnchor = advFieldAnchor(adv.id, 'antecedents_adversaire');

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
    // Ancrage PAR LIGNE (même index que `identityRows`) — `null` pour
    // « Naissance »/« Signalement » (DEUX champs source concaténés dans une
    // seule valeur rendue, ex. `"1995-06-12 @ TESTVILLE"`) et « Moyens
    // Employés » (agrégat `meList.join(' / ')` de PLUSIEURS `.me-input` —
    // aucun élément DOM unique n'en porte la valeur complète) : catégories de
    // contenu qui ne peuvent pas être ancrées de façon fiable à UN champ,
    // restriction explicite (spec « restreins-la, dis-le ») plutôt que de
    // risquer d'écrire une correction dans le mauvais champ.
    const identityRefs: Array<PdfFieldAnchor | null> = [
        null,
        advFieldAnchor(adv.id, 'profession_adversaire'),
        advFieldAnchor(adv.id, 'situation_familiale'),
        null,
        advFieldAnchor(adv.id, 'signes_particuliers'),
        advFieldAnchor(adv.id, 'substances_adversaire'),
        ...(meList.length > 0 ? [null] : []),
    ];
    const identityCard = card(
        [h3('IDENTITÉ', p), kvTable(identityRows, p, { anchors: ctx.anchors, refs: identityRefs })],
        p,
        { unbreakable: false },
    );
    const dangerHeaderCard = card(
        [
            h3('DANGEROSITÉ', p, { color: p.danger }),
            labelValue('Armes Connues', armesConnues, p, { valueColor: p.danger, valueBold: true }, {
                anchors: ctx.anchors,
                ref: advFieldAnchor(adv.id, 'armes_connues'),
            }),
        ],
        p,
        { unbreakable: false },
    );

    // Blindage BLIND.A (préservé) : `localisationCard`/`mobiliteCard` sont
    // OMISES si tous leurs champs sont vides — jamais de page saturée de
    // libellés « LABEL : - » (cf. BLIND.REFIX round 2, préservé par ce
    // correctif P1, seul le DÉCOUPAGE EN PAGES change).
    const domicileValue = str(adv.domicile_adversaire).trim();
    const volumeEspritValue = [volumeList.join(', '), etatEspritList.join(', ')].filter((s) => s !== '').join(' | ');
    const localisationRows: Content[] = [
        !isBlankOrDash(domicileValue)
            ? labelValue('Domicile', domicileValue, p, undefined, { anchors: ctx.anchors, ref: advFieldAnchor(adv.id, 'domicile_adversaire') })
            : null,
        // `volumeEspritValue` : agrégat de 2 listes DOM (`volume_list`/`etat_esprit_list`) — non ancrable (cf. JSDoc `identityRefs`).
        !isBlankOrDash(volumeEspritValue) ? labelValue('Volume / Esprit', volumeEspritValue, p) : null,
    ].filter((c): c is Content => c !== null);
    const localisationCard: Content | null =
        localisationRows.length > 0 ? card([h3('LOCALISATION', p), ...localisationRows], p, { unbreakable: false }) : null;

    const vehiculesValue = vehiculesList.join(' | ');
    const attitudeValue = str(adv.attitude_adversaire).trim();
    const mobiliteRows: Content[] = [
        // `vehiculesValue` : agrégat `vehicules_list.join(' | ')` — non ancrable (cf. JSDoc `identityRefs`).
        !isBlankOrDash(vehiculesValue) ? labelValue('Véhicules / Plaques', vehiculesValue, p) : null,
        !isBlankOrDash(attitudeValue)
            ? labelValue('Attitude Attendue', attitudeValue, p, undefined, { anchors: ctx.anchors, ref: advFieldAnchor(adv.id, 'attitude_adversaire') })
            : null,
    ].filter((c): c is Content => c !== null);
    const mobiliteCard: Content | null =
        mobiliteRows.length > 0 ? card([h3('MOBILITÉ', p), ...mobiliteRows], p, { unbreakable: false }) : null;

    const columnGapMm = 6;
    const columnWidthPt = (geo.contentWidthPt - mm(columnGapMm)) / 2;

    // Modèle de coût (pt) — solveur fit-to-page à DEUX degrés de liberté
    // (correctif Nico 2026-08-10, « la photo n'est pas comptée par le modèle
    // de coût ») : `fitUsageToPage` (theme.ts) ne fait varier QUE `fontPx` —
    // insuffisant ici, la photo d'identité est un élément NON TEXTUEL dont la
    // hauteur ne rétrécit pas avec la police. `computeCostPt` prend donc aussi
    // `portraitHPt` (hauteur RÉELLE du cadre photo passé à `figure()`, même
    // valeur au coût et au rendu — jamais deux modèles divergents) ; le
    // solveur ci-dessous essaie chaque palier de police PUIS, à défaut, réduit
    // la photo jusqu'à `ADV_PHOTO_H_FLOOR_PT` avant de redescendre encore la
    // police — colonnes GAUCHE/DROITE en PARALLÈLE (`columns` pdfmake), le
    // coût total suit la plus haute des deux, jamais leur somme.
    const computeCostPt = (fontPx: number, portraitHPt: number): number => {
        const photoPt = mainPhotoSrc !== undefined ? portraitHPt + 6 : 0;
        const identityRowsPt = identityRows.reduce((sum, [label, value]) => sum + identityRowPt(label, value, fontPx, columnWidthPt), 0);
        const identityCardPt = cardWithTitlePt(identityRowsPt);
        const dangerCardPt = cardWithTitlePt(textLinePt(`Armes Connues : ${armesConnues}`, fontPx, columnWidthPt));
        const leftPt = photoPt + identityCardPt + 6 + dangerCardPt;

        const localPt = localisationCard !== null ? cardWithTitlePt(textLinePt(`Domicile : ${domicileValue} Volume/Esprit : ${volumeEspritValue}`, fontPx, columnWidthPt)) : 0;
        const mobilePt = mobiliteCard !== null ? cardWithTitlePt(textLinePt(`Véhicules : ${vehiculesValue} Attitude : ${attitudeValue}`, fontPx, columnWidthPt)) : 0;
        const atcdCardPt = cardWithTitlePt(adversaryAtcdListPt(atcdItems, hasAtcdBoundary, atcdText, fontPx, columnWidthPt));
        const rightPt = (localPt > 0 ? localPt + 6 : 0) + (mobilePt > 0 ? mobilePt + 6 : 0) + atcdCardPt;

        return ADV_TITLE_BAR_PT + Math.max(leftPt, rightPt);
    };

    const maxPortraitHPt = mm(maxPortraitHMm);
    // Paliers de hauteur photo essayés à CHAQUE palier de police, du plus
    // large (nominal) au plancher de lisibilité — dédoublonnés si le plancher
    // dépasse déjà le nominal (formats très compacts).
    const portraitHStepsPt = mainPhotoSrc !== undefined ? [...new Set([maxPortraitHPt, ADV_PHOTO_H_FLOOR_PT])] : [maxPortraitHPt];
    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;
    let resolvedFontPx: number | undefined;
    let resolvedPortraitHPt = portraitHStepsPt[portraitHStepsPt.length - 1] as number;
    let worstCost = 0;
    outer: for (const fontPx of FIT_FONT_STEPS) {
        for (const portraitHPt of portraitHStepsPt) {
            const cost = computeCostPt(fontPx, portraitHPt);
            worstCost = cost;
            if (cost <= availablePt) {
                resolvedFontPx = fontPx;
                resolvedPortraitHPt = portraitHPt;
                break outer;
            }
        }
    }
    if (resolvedFontPx === undefined) {
        const excessRatio = availablePt > 0 ? worstCost / availablePt - 1 : Number.POSITIVE_INFINITY;
        ctx.fitErrors.push({
            section: `Fiche Adversaire ${index} : ${nom}`,
            details: 'contenu (identité/dangerosité/localisation/mobilité/ATCD) trop volumineux — réduisez les ATCD ou les textes libres',
            excessRatio,
        });
    }
    const fontPx = resolvedFontPx ?? FIT_FONT_FLOOR;
    const portraitHPt = resolvedPortraitHPt;

    // Rendu de la liste ATCD dense (1 ou 2 sous-colonnes selon le volume,
    // MÊME répartition `splitRoundRobin` que le coût ci-dessus).
    const atcdBody: Content[] = hasAtcdBoundary
        ? adversaryAtcdColumnCount(atcdItems.length) === 2
            ? [
                  grid2(
                      dashItemList(splitRoundRobin(atcdItems, 2)[0] ?? [], p, { anchors: ctx.anchors, ref: atcdRef }),
                      dashItemList(splitRoundRobin(atcdItems, 2)[1] ?? [], p, { anchors: ctx.anchors, ref: atcdRef }),
                      mm(4),
                  ),
              ]
            : dashItemList(atcdItems, p, { anchors: ctx.anchors, ref: atcdRef })
        : [labelValue('Dangerosité / ATCD', atcdText, p, undefined, { anchors: ctx.anchors, ref: atcdRef })];
    const atcdCard = card([h3('ATCD', p, { color: p.danger }), ...atcdBody], p, { unbreakable: false });

    const leftColumn: Content[] = [
        ...(mainPhotoSrc !== undefined ? [figure(mainPhotoSrc, [columnWidthPt, portraitHPt], p), { text: '', margin: [0, 6, 0, 0] } as Content] : []),
        identityCard,
        { text: '', margin: [0, 6, 0, 0] },
        dangerHeaderCard,
    ];
    const rightColumn: Content[] = [
        ...(localisationCard !== null ? [localisationCard, { text: '', margin: [0, 6, 0, 0] } as Content] : []),
        ...(mobiliteCard !== null ? [mobiliteCard, { text: '', margin: [0, 6, 0, 0] } as Content] : []),
        atcdCard,
    ];

    // Correctif revue (2026-08-10, point 2) : le titre reste COLLÉ à sa règle
    // (jamais de marge de tête artificielle) — le contenu démarre juste
    // dessous, l'espace résiduel éventuel (fiche peu renseignée) reste
    // naturellement en PIED de page, jamais un vide béant sous le titre.
    return {
        stack: [ficheAdversaireTitleBar(advTitle, p), grid2(leftColumn, rightColumn, mm(columnGapMm))],
        fontSize: fontPx,
    };
}

/**
 * Gap (pt) entre deux cartes empilées pleine largeur (`margin:[0,6,0,0]`,
 * motif déjà utilisé partout dans ce fichier, ex. colonnes de la fiche
 * adversaire) — mesure PARTAGÉE par le coût et le rendu de
 * `buildAdversaryModesActionPage`/`buildCatPage` (repli continuation à titre
 * distinct des deux, jamais « (SUITE) », cf. `packCardsByBudget`).
 */
const STACKED_CARD_GAP_PT = 6;

/**
 * Gap (pt) entre deux RANGÉES de grille empilées (`margin:[0,5,0,0]`, motif
 * déjà utilisé par « ENVIRONNEMENT ET AMIS »/« ARTICULATION & ORDRES DE
 * MOUVEMENT » avant leur correctif budget réel, anomalies C/D) — mesure
 * PARTAGÉE par le coût et le rendu de `buildEnvironnement`/
 * `buildArticulationOverview`, jamais recalculée différemment entre les deux.
 */
const GRID_ROW_GAP_PT = 5;

/**
 * Coût (pt) d'UNE carte `card()` SANS titre `h3` (juste des lignes
 * `LABEL : valeur`, `fv()`/`labelValue`) au palier `fontPx`, dans une colonne
 * de `columnWidthPt` — paddings verticaux `card()` (`EFFRAC_CARD_VPAD_PT`),
 * AUCUN `h3` (à la différence de `cardWithTitlePt`, réservé aux cartes à
 * titre). Réutilisé par `buildEnvironnement` (anomalie C) et
 * `buildArticulationOverview` (PLACE DU CHEF, anomalie D).
 */
function fieldsCardPt(fields: ReadonlyArray<readonly [string, string]>, fontPx: number, columnWidthPt: number): number {
    const bodyPt = fields.reduce((sum, [label, value]) => sum + textLinePt(`${label} : ${value}`, fontPx, columnWidthPt), 0);
    return bodyPt + EFFRAC_CARD_VPAD_PT;
}

/**
 * Empaquette des coûts (pt) déjà résolus À UN PALIER de police en 1+ groupes
 * dont le total ne dépasse jamais `budgetPt` (correctif régressions
 * débordement Modes d'action/CAT, directive Nico « une page = un contenu,
 * aucun débordement, jamais, aucune page vide ») — chaque groupe devient une
 * page de continuation AUTONOME à titre distinct (jamais « (SUITE) », garde
 * C1 ; cf. `maRangeLabel`/`slotRangeLabel` pour la fabrique de ces titres) —
 * contrairement à `packHypotheses` ci-dessus, aucun budget n'est partagé
 * avec un bloc voisin : les deux appelants de ce paquetage,
 * `buildAdversaryModesActionPage`/`buildCatPage`, consacrent TOUTE page —
 * 1re incluse — au même contenu, jamais à un bloc distinct.
 * Frontière = item, jamais coupé en son milieu. Un item SEUL déjà plus grand
 * que `budgetPt` (MA/champ de plusieurs milliers de caractères) reste
 * néanmoins SEUL dans son groupe plutôt que de bloquer l'empaquetage — CE
 * MODULE NE REFUSE JAMAIS pour ces deux pages (directive explicite : « ne
 * refuse pas, ne tronque pas », à la différence de la fiche
 * adversaire/ZMSPCP/MOICP/effraction qui, elles, refusent au palier
 * plancher) : le nœud qui le porte reste `unbreakable:false` au rendu,
 * pdfmake le laisse alors déborder NATURELLEMENT sur une/des page(s)
 * suivante(s) SANS titre — seul recours accepté pour un champ unique trop
 * long (« coupé entre deux pages, jamais rogné »).
 */
function packCardsByBudget(costs: number[], budgetPt: number): number[][] {
    const groups: number[][] = [];
    let current: number[] = [];
    let currentCost = 0;
    costs.forEach((cost, i) => {
        const additional = current.length === 0 ? cost : cost + STACKED_CARD_GAP_PT;
        if (current.length > 0 && currentCost + additional > budgetPt) {
            groups.push(current);
            current = [i];
            currentCost = cost;
        } else {
            current.push(i);
            currentCost += additional;
        }
    });
    if (current.length > 0) {
        groups.push(current);
    }
    return groups;
}

/**
 * Étiquette de plage de rubriques « <premier libellé> À <dernier libellé> »/
 * « <libellé> » d'un groupe d'indices CONTIGU produit par `packCardsByBudget`
 * — titre autonome de page de continuation (jamais « (SUITE) », garde C1),
 * même esprit que `ciblesRangeLabel`/`hypRangeLabel` mais par LIBELLÉ : les
 * rubriques empaquetées ici (ENVIRONNEMENT, CAT, ARTICULATION) sont
 * hétérogènes, sans ordre numérique naturel pour le lecteur — le nom de la
 * rubrique rend la page autoportante, pas son rang.
 */
function slotRangeLabel(indices: number[], labels: readonly string[]): string {
    const first = labels[indices[0] as number] as string;
    const last = labels[indices[indices.length - 1] as number] as string;
    return first === last ? first : `${first} À ${last}`;
}

/** Coût (pt) d'UNE carte MA (h3 « MAn » + texte intégral, `cardWithTitlePt`) au palier `fontPx`, pleine largeur de page. */
function maCardPt(ma: string, fontPx: number, contentWidthPt: number): number {
    return cardWithTitlePt(textLinePt(str(ma), fontPx, contentWidthPt));
}

/**
 * Étiquette de plage « MA3 À MA5 »/« MA3 » (1-based, même numérotation que
 * les cartes `h3` rendues, `renderCards`) d'un groupe d'indices CONTIGU de
 * `packCardsByBudget` — titre autonome de page de continuation (jamais
 * « (SUITE) », garde C1).
 */
function maRangeLabel(indices: number[]): string {
    const first = (indices[0] as number) + 1;
    const last = (indices[indices.length - 1] as number) + 1;
    return first === last ? `MA${first}` : `MA${first} À MA${last}`;
}

/**
 * Page « MODES D'ACTION — <nom> » (SPEC-2026-08-18-pdf-et-champs.md §3) — émise
 * immédiatement après la fiche de l'adversaire concerné, JAMAIS dans la fiche
 * elle-même (verrouillée à une page, refus de génération au-delà du palier
 * plancher 7 px, `buildAdversaryFiche` ci-dessus).
 *
 * CORRECTIF RÉGRESSION (directive Nico « une page = un contenu, aucun
 * débordement, jamais ; aucune page vide ») : l'ancienne version rendait
 * TOUJOURS au palier de police du document (`unbreakable:false` par carte,
 * AUCUN essai de palier, AUCUNE pagination contrôlée) — un adversaire à
 * plusieurs MA débordait alors sur autant de pages « fantômes » que
 * nécessaire, sans titre. Nouvelle mécanique, MÊME patron que
 * `buildAdversaryFiche`/`buildArticulationPage` (`fitUsageToPage`, theme.ts) :
 * 1) essaie chaque palier 11→7 pour tenir la TOTALITÉ des cartes MA sur UNE
 * SEULE page ; 2) si même le palier plancher ne suffit pas (cas limite —
 * beaucoup de MA, ou un MA de plusieurs milliers de caractères), empaquette
 * les cartes sur des pages « MODES D'ACTION — <nom> — MA<plage> » AUTONOMES
 * à titre distinct (jamais « (SUITE) », garde C1 ; `maRangeLabel`)
 * (`packCardsByBudget`, palier retenu = celui qui produit le MOINS de pages,
 * même esprit que `buildEffractionPages::bestPacking`) plutôt que de refuser
 * ou tronquer — un MA unique trop long pour tenir SEUL sur sa page (au
 * palier plancher) reste rendu `unbreakable:false` : pdfmake le laisse alors
 * déborder naturellement sur une page suivante sans titre, seul recours
 * accepté (`ctx.fitErrors` n'est jamais alimenté par cette page).
 *
 * `null` si `ma_list` est absente/vide ou ne contient que des entrées blanches
 * (adversaire enregistré avant l'ajout du champ, ou aucun MA saisi) — aucune
 * page émise dans ce cas (jamais de page vide).
 */
function buildAdversaryModesActionPage(ctx: BuildCtx, adv: OiAdversary, nom: string): Content | null {
    const { p, geo } = ctx;
    const maList = (adv.ma_list ?? []).filter((ma) => ma.trim() !== '');
    if (maList.length === 0) {
        return null;
    }

    // `fontSize` du palier retenu est posé sur le `stack` racine (hérité par
    // ces cartes, aucune n'a de `fontSize` propre) — `renderCards` n'a donc
    // pas besoin du palier en paramètre.
    // Édition en place (mission « tout le texte modifiable ») — MA rendu via
    // un nœud `{ text }` brut (jamais `labelValue`/`kvTable`), l'ancre est
    // donc posée EXPLICITEMENT ici, cf. JSDoc `advIndexedFieldAnchor`.
    // `renderCards` peut être appelée plusieurs fois (pagination
    // `packCardsByBudget`, cas limite) mais chaque `i` n'est couvert que par
    // UN SEUL appel (groupes disjoints) — aucun double enregistrement.
    const renderCards = (indices: number[]): Content[] => {
        const cards = indices.map((i) => {
            const value = str(maList[i] as string);
            registerPdfEditAnchor(ctx.anchors, advIndexedFieldAnchor(adv.id, '.ma-container .ma-input:not(:placeholder-shown)', i), value);
            return card([h3(`MA${i + 1}`, p), { text: value, preserveLeadingSpaces: true }], p, { unbreakable: false });
        });
        return cards.flatMap((c, i) => (i === 0 ? [c] : [{ text: '', margin: [0, STACKED_CARD_GAP_PT, 0, 0] } as Content, c]));
    };

    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;
    const allIndices = maList.map((_, i) => i);

    // 1) UNE SEULE page, paliers 11→7 (mission P1, même solveur que la fiche adversaire).
    const computeCostPt = (fontPx: number): number =>
        EFFRAC_H2_PT + maList.reduce((sum, ma, i) => sum + maCardPt(ma, fontPx, geo.contentWidthPt) + (i > 0 ? STACKED_CARD_GAP_PT : 0), 0);
    const fit = fitUsageToPage(computeCostPt, availablePt);
    if ('fontPx' in fit) {
        return { stack: [h2(`MODES D'ACTION — ${nom}`, p, geo.contentWidthPt), ...renderCards(allIndices)], fontSize: fit.fontPx };
    }

    // 2) Cas limite : pages de continuation à titre distinct (jamais
    // « (SUITE) », garde C1), palier retenu = celui qui produit le MOINS de
    // pages (à égalité, le plus lisible/premier rencontré l'emporte,
    // `FIT_FONT_STEPS` trié décroissant).
    const budgetPt = availablePt - EFFRAC_H2_PT;
    let best: { groups: number[][]; fontPx: number } | null = null;
    for (const fontPx of FIT_FONT_STEPS) {
        const costs = maList.map((ma) => maCardPt(ma, fontPx, geo.contentWidthPt));
        const groups = packCardsByBudget(costs, budgetPt);
        if (best === null || groups.length < best.groups.length) {
            best = { groups, fontPx };
        }
    }
    const { groups, fontPx } = best as { groups: number[][]; fontPx: number };
    return {
        stack: groups.map((indices, idx): Content => {
            if (idx === 0) {
                return { stack: [h2(`MODES D'ACTION — ${nom}`, p, geo.contentWidthPt), ...renderCards(indices)], fontSize: fontPx };
            }
            return {
                stack: [h2(`MODES D'ACTION — ${nom} — ${maRangeLabel(indices)}`, p, geo.contentWidthPt), ...renderCards(indices)],
                fontSize: fontPx,
                pageBreak: 'before',
            };
        }),
    };
}

/** Fiche adversaire + page « Modes d'action » + ses galeries « Photos annexes »/« Renfort possible » (pdf-engine-v2.ts:959-969). */
function buildAdversaryPages(ctx: BuildCtx): Content[] {
    const { formData, photosBase64, dynamicPhotos, p, geo } = ctx;
    const adversaries = formData.adversaries ?? [];
    const acc: Content[] = [];
    adversaries.forEach((adv, idx) => {
        pushPage(acc, buildAdversaryFiche(ctx, adv, idx + 1));
        const nom = strOr(adv.nom_adversaire, 'Inconnu');
        const maPage = buildAdversaryModesActionPage(ctx, adv, nom);
        if (maPage !== null) {
            pushPage(acc, maPage);
        }
        const extra = dynamicPhotos[`photo_extra_${adv.id}`] ?? [];
        const renfort = dynamicPhotos[`photo_renforts_${adv.id}`] ?? [];
        pushPages(acc, galleryPages(`Adversaire : ${nom} (Photos annexes)`, extra, photosBase64, p, geo));
        pushPages(acc, galleryPages(`Adversaire : ${nom} (Renfort possible)`, renfort, photosBase64, p, geo));
    });
    return acc;
}

/* ==========================================================================
 * Section 3 — « 3. ENVIRONNEMENT ET AMIS » (pdf-engine-v2.ts:972-996).
 *
 * CORRECTIF ANOMALIE C (campagne de mesure 2026-08-18, directive Nico « une
 * page = un contenu, aucun débordement, jamais ; aucune page vide ») :
 * l'ancienne version rendait TOUJOURS au palier de police du document,
 * `unbreakable:false` sur chaque carte SANS AUCUN essai de palier ni budget
 * réel — mesuré : `amies`/`terrain_info`/`population`/`cadre_juridique`
 * longs ⇒ 9 pages orphelines sans titre. Même mécanique que
 * `buildCatPage`/`buildAdversaryModesActionPage` (`fitUsageToPage`,
 * `packCardsByBudget`) : 1) essaie la disposition VALIDÉE (grille 2 colonnes)
 * aux paliers 11→7 ; 2) SEULEMENT si même le palier plancher ne suffit pas,
 * abandonne la grille au profit d'un empilement PLEINE LARGEUR (une carte par
 * champ) paginé sur des pages « <titre> — <plage de rubriques> » autonomes
 * (jamais « (SUITE) », garde C1 ; `slotRangeLabel`) — jamais de refus,
 * jamais de troncature (section toujours rendue, `ctx.fitErrors` jamais
 * alimenté par cette page).
 * ======================================================================== */
const ENV_FIELD_SLOTS: ReadonlyArray<readonly [string, string]> = [
    ['Forces Amies / Concours', 'amies'],
    ['Terrain / Météo', 'terrain_info'],
    ['Éclairage', 'eclairage'],
    ['Lever du soleil', 'lever_soleil'],
    ['Population / Voisinage', 'population'],
    ['Faune / Animaux', 'faune_animaux'],
    ['Cadre Juridique', 'cadre_juridique'],
    ['Accès Principal', 'acces_principal'],
    ['Cheminement Initial', 'cheminement_initial'],
] as const;

function buildEnvironnement(ctx: BuildCtx, num: () => number): Content {
    const { formData, p, geo } = ctx;
    const sectionNum = num();
    const title = `${sectionNum}. ENVIRONNEMENT ET AMIS`;
    const columnWidthPt = (geo.contentWidthPt - mm(6)) / 2;
    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;

    const leftKeys = ENV_FIELD_SLOTS.slice(0, 4);
    const rightKeys = ENV_FIELD_SLOTS.slice(4, 7);
    const accesKeys = ENV_FIELD_SLOTS.slice(7, 8);
    const cheminKeys = ENV_FIELD_SLOTS.slice(8, 9);
    const textFieldsOf = (keys: ReadonlyArray<readonly [string, string]>): Array<[string, string]> =>
        keys.map(([label, key]): [string, string] => [label, strOr(formData[key])]);

    // 1) Disposition VALIDÉE (grille 2 colonnes), paliers 11→7 — couvre
    // l'immense majorité des cas réels (champs courts).
    const computeGridCostPt = (fontPx: number): number => {
        const row1Pt = Math.max(fieldsCardPt(textFieldsOf(leftKeys), fontPx, columnWidthPt), fieldsCardPt(textFieldsOf(rightKeys), fontPx, columnWidthPt));
        const row2Pt = Math.max(fieldsCardPt(textFieldsOf(accesKeys), fontPx, columnWidthPt), fieldsCardPt(textFieldsOf(cheminKeys), fontPx, columnWidthPt));
        return EFFRAC_H2_PT + row1Pt + GRID_ROW_GAP_PT + row2Pt;
    };
    const gridFit = fitUsageToPage(computeGridCostPt, availablePt);
    if ('fontPx' in gridFit) {
        // Blindage BLIND.A (audit « tout `unbreakable` restant a un filet ») :
        // champs texte libres non bornés (`amies`/`terrain_info`/…) — même
        // filet minimal `unbreakable:false` que `situationCard` (`buildCover`),
        // jamais de perte silencieuse si l'un d'eux dépasse malgré tout la page.
        const left = leftKeys.map(([label, key]) => fv(ctx, label, key));
        const right = rightKeys.map(([label, key]) => fv(ctx, label, key));
        const acces = accesKeys.map(([label, key]) => fv(ctx, label, key));
        const chemin = cheminKeys.map(([label, key]) => fv(ctx, label, key));
        return {
            stack: [
                h2(title, p, geo.contentWidthPt),
                grid2([card(left, p, { unbreakable: false })], [card(right, p, { unbreakable: false })]),
                { text: '', margin: [0, GRID_ROW_GAP_PT, 0, 0] },
                grid2([card(acces, p, { unbreakable: false })], [card(chemin, p, { unbreakable: false })]),
            ],
            fontSize: gridFit.fontPx,
        };
    }

    // 2) Cas limite : grille abandonnée, une carte PLEINE LARGEUR par champ,
    // empaquetées par budget de hauteur réel sur des pages à titre distinct
    // (jamais « (SUITE) », garde C1) autonomes — même mécanique que
    // `buildCatPage`/`buildAdversaryModesActionPage`.
    const budgetPt = availablePt - EFFRAC_H2_PT;
    let best: { groups: number[][]; fontPx: number } | null = null;
    for (const fontPx of FIT_FONT_STEPS) {
        const costs = ENV_FIELD_SLOTS.map(([label, key]) => fieldsCardPt([[label, strOr(formData[key])]], fontPx, geo.contentWidthPt));
        const groups = packCardsByBudget(costs, budgetPt);
        if (best === null || groups.length < best.groups.length) {
            best = { groups, fontPx };
        }
    }
    const { groups, fontPx } = best as { groups: number[][]; fontPx: number };
    const fieldNodes = ENV_FIELD_SLOTS.map(([label, key]) => card([fv(ctx, label, key)], p, { unbreakable: false }));
    const renderSlots = (indices: number[]): Content[] => {
        const nodes = indices.map((i) => fieldNodes[i] as Content);
        return nodes.flatMap((n, i) => (i === 0 ? [n] : [{ text: '', margin: [0, STACKED_CARD_GAP_PT, 0, 0] } as Content, n]));
    };
    return {
        stack: groups.map((indices, idx): Content => {
            if (idx === 0) {
                return { stack: [h2(title, p, geo.contentWidthPt), ...renderSlots(indices)], fontSize: fontPx };
            }
            const label = slotRangeLabel(
                indices,
                ENV_FIELD_SLOTS.map(([fieldLabel]) => fieldLabel),
            );
            return { stack: [h2(`${title} — ${label}`, p, geo.contentWidthPt), ...renderSlots(indices)], fontSize: fontPx, pageBreak: 'before' };
        }),
    };
}

/* ==========================================================================
 * Sections 4+5 — « 4. MISSION DE L'UNITÉ » + « 5. EXÉCUTION »
 * (pdf-engine-v2.ts:998-1030).
 *
 * CORRECTIF REVUE (2026-08-10, point 1) — découpage Standard validé par
 * Nico : « 4. MISSION DE L'UNITÉ » (souvent 2-3 lignes) ne doit jamais rester
 * seule sur une page (constaté : page quasi vide) — REGROUPÉE densément avec
 * « 5. EXÉCUTION » sur UNE SEULE page (deux titres, séparateur clair) quand
 * le couple tient à la police nominale du document (`baseFontSize`). Si le
 * couple dépasse la page à ce palier, le solveur fit-to-page (`fitUsageToPage`,
 * même mécanique que les usages P1) tente les paliers 11→7 ; si MÊME le
 * palier plancher ne suffit pas, repli NATUREL sur les 2 pages historiques
 * séparées (`buildMission`/`buildExecution`) — jamais un refus, cette paire
 * n'est pas un « usage » à contrat dur comme la fiche adversaire/ZMSPCP/MOICP/
 * effraction.
 *
 * CORRECTIF ANOMALIE A (campagne de mesure 2026-08-18) : ce repli était
 * cassé sur deux points — (1) `buildExecution()` ne portait aucun
 * `pageBreak` propre, EXÉCUTION s'enchaînait donc SANS saut derrière MISSION
 * (seul `pushPages` pose le saut sur le PREMIER élément du tableau retourné,
 * jamais les suivants — même contrat que `galleryPages()`, cf. JSDoc
 * `pushPages`) ; (2) `buildMission`/`buildExecution` rendaient leur corps
 * inconditionnellement au palier nominal du document, `unbreakable:false`
 * SANS aucun budget — désormais chacune est protégée par son propre
 * `fitUsageToPage` (11→7, `missionPagePt`/`executionPagePt`), toujours sans
 * jamais refuser.
 * ======================================================================== */

/** Corps de « 4. MISSION DE L'UNITÉ » (sans le `h2`) — `fontPx` paramétrable pour le rendu fusionné (`buildMissionExecutionPages`) comme pour le repli standalone (`buildMission`, `baseFontSize`). */
function missionBodyContent(ctx: BuildCtx, fontPx: number): Content {
    const { formData, p } = ctx;
    // Blindage BLIND.A : `missions_psig` est un champ texte libre non
    // borné — filet `unbreakable:false` (audit « tout unbreakable a un filet »).
    // Ancrage direct (édition en place) : `accentCard` reçoit un `Content[]`
    // déjà composé, aucune valeur/référence isolée à lui passer (cf. JSDoc
    // `registerPdfEditAnchor`).
    registerPdfEditAnchor(ctx.anchors, fieldAnchor('missions_psig'), strOr(formData.missions_psig));
    return accentCard(
        null,
        [{ text: strOr(formData.missions_psig), bold: true, fontSize: Math.round(fontPx * 1.6), preserveLeadingSpaces: true }],
        p,
        'accent',
        { unbreakable: false },
    );
}

/**
 * Corps de « 5. EXÉCUTION » (sans le `h2`) — `fontPx` paramétrable, cf. JSDoc
 * `missionBodyContent`.
 *
 * ANOMALIE B (campagne de mesure 2026-08-18) : l'ORDRE D'ENREGISTREMENT des
 * ancrages d'édition (`registerPdfEditAnchor`, `ctx.anchors`) DOIT suivre
 * L'ORDRE D'AFFICHAGE du tableau `Content` retourné ci-dessous — jamais
 * l'ordre de CONSTRUCTION des variables locales. `pdf-preview-edit.ts`
 * aligne ses ancrages sur les fragments de texte RÉELS (pdf.js) dans l'ordre
 * d'APPARITION visuelle ; un décalage désynchronise son curseur (34/74
 * ancrages perdus, ZMSPCP/MOICP/Effraction/CAT). Le tableau retourné affiche
 * D'ABORD date/heure d'exécution + action, PUIS la chronologie/les
 * hypothèses — les champs `fv(...)` de date/heure/action sont donc construits
 * (et leurs ancrages enregistrés) EN PREMIER ci-dessous, avant la chronologie
 * (`events.forEach`) et les hypothèses (`hypothesisLine`), même si ces
 * dernières restent affectées à des `const` utilisées plus bas dans le
 * fichier — seul l'ORDRE D'APPEL compte, `registerPdfEditAnchor` étant un
 * simple `push` synchrone (cf. JSDoc `BuildCtx.anchors`).
 */
function executionBodyContent(ctx: BuildCtx, fontPx: number): Content[] {
    const { formData, p } = ctx;

    // Affichés EN PREMIER (cf. JSDoc ci-dessus) : construits ici, avant la
    // chronologie/les hypothèses, pour que leurs ancrages s'enregistrent
    // dans l'ordre d'affichage.
    const dateExecutionField = fv(ctx, "Date d'exécution", 'date_execution');
    const heureExecutionField = fv(ctx, 'Heure H', 'heure_execution', {
        fontSize: Math.round(fontPx * 1.2),
        valueColor: p.accent,
        valueBold: true,
    });
    const actionField = fv(ctx, 'Idée de Manœuvre / Action', 'action_body_text');

    const events = formData.time_events ?? [];
    // Édition en place — chronologie : liste À PLAT sans identifiant propre,
    // même mécanique que `hypothesisLine` (`indexedFieldAnchor`, rang =
    // ordre de construction de `formData.time_events`, `formulaires.ts:772-776`).
    // `e.type` (repli `<select>`) N'EST PAS ancré (valeur contrainte, cf.
    // JSDoc de fichier `pdf-preview-edit.ts` : un `<select>` n'est jamais un
    // candidat d'édition en place).
    events.forEach((e, i) => {
        registerPdfEditAnchor(ctx.anchors, indexedFieldAnchor('#time_events_container .time-item .time-hour-input', i), e.hour);
        registerPdfEditAnchor(ctx.anchors, indexedFieldAnchor('#time_events_container .time-item .time-description-input', i), e.description);
    });
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
        hypotheses.length > 0 ? hypotheses.map((h, i) => hypothesisLine(i, h, p, ctx.anchors)) : [{ text: '-', color: p.muted }];
    // Blindage BLIND.A : `formData.hypotheses` (liste libre, MÊME classe de
    // risque que la conduite à tenir ZMSPCP/MOICP, matrice-rupture.md §2/§3)
    // — filet `unbreakable:false`.
    const hypCard = card([h3("Hypothèses d'ensemble", p), ...hypBody], p, { unbreakable: false });

    return [
        grid2([dateExecutionField], [heureExecutionField]),
        { text: '', margin: [0, 4, 0, 0] },
        actionField,
        { text: '', margin: [0, 4, 0, 0] },
        grid2([chronoCard], [hypCard]),
    ];
}

/**
 * Coût (pt) de « <N>. MISSION DE L'UNITÉ » SEULE (h2 + corps) au palier
 * `fontPx` — factorisé hors de `missionExecutionCostPt` pour être réutilisé
 * TEL QUEL par `buildMission` (repli standalone, anomalie A) : même modèle
 * physique, jamais recalculé différemment entre le rendu fusionné et le
 * rendu séparé.
 */
function missionPagePt(ctx: BuildCtx, fontPx: number): number {
    const { formData, geo } = ctx;
    const missionFontPx = Math.round(fontPx * 1.6);
    const missionCpl = estimateCharsPerLine(missionFontPx, geo.contentWidthPt - 16);
    const missionPt = wrappedLinesWithNewlines(strOr(formData.missions_psig), missionCpl) * effracLinePt(missionFontPx) + 12;
    return EFFRAC_H2_PT + missionPt;
}

/**
 * Coût (pt) de « <N>. EXÉCUTION » SEULE (h2 + corps) au palier `fontPx» —
 * factorisé hors de `missionExecutionCostPt`, cf. JSDoc `missionPagePt`
 * (réutilisé TEL QUEL par `buildExecution`, anomalie A).
 */
function executionPagePt(ctx: BuildCtx, fontPx: number): number {
    const { formData, geo } = ctx;
    const line = effracLinePt(fontPx);
    const halfColumnWidthPt = (geo.contentWidthPt - mm(6)) / 2;

    const actionPt = textLinePt(`Idée de Manœuvre / Action : ${strOr(formData.action_body_text)}`, fontPx, geo.contentWidthPt);

    // Chronologie : colonne « Événement » ≈ 78 % de la demi-largeur de carte (widths ['22%','*']).
    const events = formData.time_events ?? [];
    const chronoEventColWidthPt = halfColumnWidthPt * 0.78;
    const chronoRowsPt =
        events.length > 0
            ? events.reduce((sum, e) => sum + textLinePt(`${e.type} : ${e.description}`, fontPx, chronoEventColWidthPt) + EFFRAC_ROW_VPAD_PT, 0)
            : line + EFFRAC_ROW_VPAD_PT;
    const chronoPt = cardWithTitlePt(line /* thead */ + chronoRowsPt);

    // Hypothèses d'ensemble : chaque entrée peut s'enrouler sur plusieurs lignes (`H<i> : <texte>`).
    const hypotheses = formData.hypotheses ?? [];
    const hypRowsPt =
        hypotheses.length > 0
            ? hypotheses.reduce((sum, h, i) => sum + textLinePt(`H${i + 1} : ${h}`, fontPx, halfColumnWidthPt) + 4, 0)
            : line;
    const hypPt = cardWithTitlePt(hypRowsPt);

    return EFFRAC_H2_PT + line + 4 + actionPt + 4 + Math.max(chronoPt, hypPt);
}

/**
 * Page standalone « <N>. MISSION DE L'UNITÉ » — repli si la fusion avec
 * « EXÉCUTION » ne tient sur aucun palier (`buildMissionExecutionPages`).
 * `num` déjà résolu par l'appelant, jamais recalculé ici.
 *
 * CORRECTIF ANOMALIE A (campagne de mesure 2026-08-18) : protégée par le
 * MÊME solveur `fitUsageToPage` (paliers 11→7) que ZMSPCP/MOICP, plutôt que
 * rendue inconditionnellement au palier nominal du document — cette page
 * n'est PAS un usage à contrat dur (JSDoc `buildMissionExecutionPages`) :
 * si même le palier plancher déborde (cas limite non observé en pratique, le
 * corps de MISSION tient toujours largement), `ctx.fitErrors` n'est JAMAIS
 * alimenté ici — rendue au plancher, jamais de refus pour ce couple.
 */
function buildMission(ctx: BuildCtx, num: number): Content {
    const { p, geo } = ctx;
    const fit = fitUsageToPage((fontPx) => missionPagePt(ctx, fontPx), geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT);
    const fontPx = 'fontPx' in fit ? fit.fontPx : FIT_FONT_FLOOR;
    return { stack: [h2(`${num}. MISSION DE L'UNITÉ`, p, geo.contentWidthPt), missionBodyContent(ctx, fontPx)], fontSize: fontPx };
}

/** Page standalone « <N>. EXÉCUTION » — repli, cf. JSDoc `buildMission` (même protection fit-to-page, anomalie A, jamais de refus). */
function buildExecution(ctx: BuildCtx, num: number): Content {
    const { p, geo } = ctx;
    const fit = fitUsageToPage((fontPx) => executionPagePt(ctx, fontPx), geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT);
    const fontPx = 'fontPx' in fit ? fit.fontPx : FIT_FONT_FLOOR;
    return { stack: [h2(`${num}. EXÉCUTION`, p, geo.contentWidthPt), ...executionBodyContent(ctx, fontPx)], fontSize: fontPx };
}

/**
 * Coût (pt) du couple MISSION+EXÉCUTION fusionné au palier `fontPx» —
 * modèle physique partagé (mêmes primitives que les solveurs fit-to-page P1 :
 * `effracLinePt`/`textLinePt`/`cardWithTitlePt`), somme de `missionPagePt`/
 * `executionPagePt` (ci-dessus) + le séparateur visuel entre les deux titres.
 * Chaque ENTRÉE de la Chronologie/des Hypothèses est mesurée INDIVIDUELLEMENT
 * (lignes réellement enroulées dans sa colonne, `textLinePt` — jamais une
 * estimation moyenne à 1 ligne/entrée) : correctif revue (2026-08-10) — une
 * estimation grossière « 1 ligne par entrée » sous-évaluait la table
 * Chronologie/Hypothèses dès que leurs textes s'enroulent sur 2+ lignes, ce
 * qui laissait `long-case.json` fusionner PUIS déborder silencieusement sur
 * une page 2 non voulue (titre « 5. EXÉCUTION » en bas de page 1, table
 * Chronologie tronquée en plein milieu SANS marqueur — exactement le défaut
 * que la mission P1 combat).
 */
function missionExecutionCostPt(ctx: BuildCtx, fontPx: number): number {
    return missionPagePt(ctx, fontPx) + 20 /* séparateur */ + executionPagePt(ctx, fontPx);
}

/**
 * Fusionne « 4. MISSION DE L'UNITÉ » + « 5. EXÉCUTION » sur UNE SEULE page
 * (deux titres, séparateur visuel net) quand le couple tient, en essayant
 * D'ABORD le palier NOMINAL du document (`baseFontSize`) puis, s'il déborde,
 * les paliers fit-to-page 11→7 (mêmes paliers que `FIT_FONT_STEPS`, filtrés
 * à `<= baseFontSize` pour ne jamais AGRANDIR la police du document) — même
 * marge de sécurité (`EFFRAC_FITS_SAFETY_PT`) que les solveurs P1, appliquée
 * ICI AUSSI au palier nominal (jamais un « ça passe tout juste » qui déborde
 * réellement sous pdfmake). En dernier recours (même le palier plancher
 * déborde), repli NATUREL sur les 2 pages historiques SÉPARÉES (`buildMission`/
 * `buildExecution`, chacune protégée par son propre `fitUsageToPage`) — jamais
 * de refus pour ce couple (à la différence des usages P1 stricts fiche
 * adversaire/ZMSPCP/MOICP/effraction).
 *
 * ANOMALIE A (campagne de mesure 2026-08-18) : le tableau retourné par ce
 * repli DOIT porter le même contrat que `pushPages`/`galleryPages` — seul le
 * PREMIER élément (MISSION) reçoit son saut de page de l'appelant
 * (`pushPages`, `buildOiDocDefinition`), le SECOND (EXÉCUTION) doit porter le
 * SIEN lui-même, sous peine de s'enchaîner sans saut derrière MISSION puis de
 * déborder sur une page sans titre.
 */
function buildMissionExecutionPages(ctx: BuildCtx, num: () => number): Content[] {
    const { p, geo, baseFontSize } = ctx;
    // Toujours rendue (jamais omise) : les 2 numéros sont consommés
    // INCONDITIONNELLEMENT, une fois chacun, avant de choisir la mise en
    // page (fusionnée ou repli 2 pages) — les deux rendus doivent porter
    // exactement les mêmes numéros.
    const missionNum = num();
    const execNum = num();
    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;
    const steps = Array.from(new Set<number>([baseFontSize, ...FIT_FONT_STEPS]))
        .filter((f) => f <= baseFontSize)
        .sort((a, b) => b - a);

    const mergedPage = (fontPx: number): Content => ({
        stack: [
            h2(`${missionNum}. MISSION DE L'UNITÉ`, p, geo.contentWidthPt),
            missionBodyContent(ctx, fontPx),
            {
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: geo.contentWidthPt, y2: 0, lineWidth: 1, lineColor: p.border }],
                margin: [0, 14, 0, 14],
            },
            h2(`${execNum}. EXÉCUTION`, p, geo.contentWidthPt),
            ...executionBodyContent(ctx, fontPx),
        ],
        fontSize: fontPx,
    });

    for (const fontPx of steps) {
        if (missionExecutionCostPt(ctx, fontPx) <= availablePt) {
            return [mergedPage(fontPx)];
        }
    }

    // Repli naturel (jamais un refus) : les 2 pages historiques séparées.
    // EXÉCUTION porte SON PROPRE `pageBreak:'before'` (même contrat que
    // `pushPage`) — sans ce wrapper, `pushPages` (appelant) ne le pose que
    // sur MISSION (1er élément), EXÉCUTION s'enchaînait alors SANS saut
    // derrière MISSION puis débordait sur une page sans titre (anomalie A).
    return [buildMission(ctx, missionNum), { stack: [buildExecution(ctx, execNum)], pageBreak: 'before' }];
}

/** Photos de la section « TRANSPORT » (pdf-engine-v2.ts:1032-1039) : PR avant domicile, ordre conservé (§3.4 règle 3). Titre NU et numéro portés par le registre de sections (`OI_PDF_SECTIONS`, §5/§6 SPEC-2026-08-18-pdf-et-champs.md) — plus aucune mention de « logistique ». */
function transportPhotos(dynamicPhotos: Record<string, OiPhotoMeta[]>): OiPhotoMeta[] {
    return [
        ...(dynamicPhotos['photo_container_transport_pr_preview_container'] ?? []),
        ...(dynamicPhotos['photo_container_transport_domicile_preview_container'] ?? []),
    ];
}

/* ==========================================================================
 * Section 7 — « 7. ARTICULATION & ORDRES DE MOUVEMENT » (pdf-engine-v2.ts:1042-1057).
 * Toujours rendue (jamais omise dans la source).
 *
 * CORRECTIF ANOMALIE D (campagne de mesure 2026-08-18, directive Nico « une
 * page = un contenu, aucun débordement, jamais ; aucune page vide ») :
 * `rame_vl_order`/`colonne_progression_order`/`ordre_penetration_order`
 * rendus en `pillRow` dans des cartes `unbreakable:false` SANS AUCUNE
 * limite — mesuré : 40 éléments par liste ⇒ 1 page orpheline. Même mécanique
 * que `buildCatPage`/`buildEnvironnement` (`fitUsageToPage`,
 * `packCardsByBudget`) : les 3 cartes sont construites UNE SEULE FOIS
 * (l'ancrage `place_chef` y est enregistré) puis réutilisées TELLES QUELLES
 * par la disposition retenue — jamais reconstruites par palier (aucune
 * n'a de `fontSize` propre, héritent de celui posé sur le `stack` racine).
 * ======================================================================== */
function buildArticulationOverview(ctx: BuildCtx, num: () => number): Content {
    const { formData, p, geo, anchors } = ctx;
    const rameVl = formData.rame_vl_order ?? [];
    const colonne = formData.colonne_progression_order ?? [];
    const penetration = formData.ordre_penetration_order ?? [];
    const placeChef = strOr(formData.place_chef);

    // Édition en place (mission « tout le texte modifiable ») — chaque
    // pastille des 3 listes affiche soit un NOM DE VÉHICULE (Rame VL) soit un
    // TRIGRAMME (Colonne/Pénétration), tous deux des CHAMPS LIBRES déjà
    // éditables ailleurs dans le formulaire (renommage véhicule, panneau
    // Édition Rapide) — cf. JSDoc `patracVehicleDatasetAnchor`/
    // `patracMemberDatasetAnchor`. Enregistré AVANT `pillRow` (même motif que
    // `dashItemList` : un ancrage par item de la liste rendue, tous résolvant
    // au MÊME élément DOM canonique).
    const vehicleUniq = countPatracVehicleNames(formData);
    const trigUniq = countPatracTrigrammes(formData);
    rameVl.forEach((name) => registerPdfEditAnchor(anchors, patracVehicleDatasetAnchor(name, vehicleUniq), name));
    colonne.forEach((trig) => registerPdfEditAnchor(anchors, patracMemberDatasetAnchor(trig, 'trigramme', trigUniq), trig));
    penetration.forEach((trig) => registerPdfEditAnchor(anchors, patracMemberDatasetAnchor(trig, 'trigramme', trigUniq), trig));

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
            fv(ctx, 'PLACE DU CHEF', 'place_chef', { valueColor: p.accent }),
        ],
        p,
        { unbreakable: false },
    );

    const sectionNum = num();
    const title = `${sectionNum}. ARTICULATION & ORDRES DE MOUVEMENT`;
    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;
    const penetrationPt = (fontPx: number): number =>
        EFFRAC_H3_PT +
        pillGridPt(penetration.length, fontPx) +
        6 +
        textLinePt(`PLACE DU CHEF : ${placeChef}`, fontPx, geo.contentWidthPt) +
        EFFRAC_CARD_VPAD_PT;

    // 1) Disposition VALIDÉE (grille), paliers 11→7.
    const computeGridCostPt = (fontPx: number): number => {
        const row1Pt = Math.max(cardWithTitlePt(pillGridPt(rameVl.length, fontPx)), cardWithTitlePt(pillGridPt(colonne.length, fontPx)));
        return EFFRAC_H2_PT + row1Pt + GRID_ROW_GAP_PT + penetrationPt(fontPx);
    };
    const gridFit = fitUsageToPage(computeGridCostPt, availablePt);
    if ('fontPx' in gridFit) {
        return {
            stack: [
                h2(title, p, geo.contentWidthPt),
                grid2([rameCard], [colonneCard]),
                { text: '', margin: [0, GRID_ROW_GAP_PT, 0, 0] },
                penetrationCard,
            ],
            fontSize: gridFit.fontPx,
        };
    }

    // 2) Cas limite (listes très longues) : grille abandonnée, empilement
    // pleine largeur paginé sur des pages « <titre> — <plage de rubriques> »
    // (jamais « (SUITE) », garde C1 ; `slotRangeLabel`) — même mécanique que
    // `buildCatPage`/`buildAdversaryModesActionPage` (`packCardsByBudget`).
    const slotLabels = ['Ordre Rame VL', 'Colonne Progression', 'Ordre de Pénétration'] as const;
    const slots: Content[] = [rameCard, colonneCard, penetrationCard];
    const budgetPt = availablePt - EFFRAC_H2_PT;
    let best: { groups: number[][]; fontPx: number } | null = null;
    for (const fontPx of FIT_FONT_STEPS) {
        const costs = [cardWithTitlePt(pillGridPt(rameVl.length, fontPx)), cardWithTitlePt(pillGridPt(colonne.length, fontPx)), penetrationPt(fontPx)];
        const groups = packCardsByBudget(costs, budgetPt);
        if (best === null || groups.length < best.groups.length) {
            best = { groups, fontPx };
        }
    }
    const { groups, fontPx } = best as { groups: number[][]; fontPx: number };
    const renderSlots = (indices: number[]): Content[] => {
        const nodes = indices.map((i) => slots[i] as Content);
        return nodes.flatMap((n, i) => (i === 0 ? [n] : [{ text: '', margin: [0, STACKED_CARD_GAP_PT, 0, 0] } as Content, n]));
    };
    return {
        stack: groups.map((indices, idx): Content => {
            if (idx === 0) {
                return { stack: [h2(title, p, geo.contentWidthPt), ...renderSlots(indices)], fontSize: fontPx };
            }
            const label = slotRangeLabel(indices, slotLabels);
            return { stack: [h2(`${title} — ${label}`, p, geo.contentWidthPt), ...renderSlots(indices)], fontSize: fontPx, pageBreak: 'before' };
        }),
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
 * Frontières légitimes d'un champ ATCD (`antecedents_adversaire`) — correctif
 * D1 (SPEC-PDF-DEFINITIF, gate ROUND0) : la JSDoc historique de
 * `buildDangerPages` supposait « chaque entrée préfixée d'un tiret », or le
 * PDF réel fautif (`cas-reel-01`) saisit ses ATCD en LIGNES nues
 * (`2024 : USAGE ILLICITE…\n    DETENTION…`) — aucun tiret, donc
 * `splitAtDashBoundaries` renvoyait le texte INTACT, `buildDangerPages`
 * retombait sur le filet `unbreakable:false` et pdfmake scindait NATURELLEMENT
 * p2→p3 (queue de 3 lignes + LOCALISATION orphelines, p3 à ~85 % vide, sans
 * « (SUITE) » — FAIL B10/B11). Un RETOUR À LA LIGNE saisi est une frontière
 * aussi légitime qu'un tiret (jamais de coupure en milieu de phrase) : repli
 * sur les lignes non vides quand aucun tiret n'existe. `trimEnd()` seul —
 * l'indentation de tête (lignes de continuation « ␣␣␣␣DETENTION… ») est une
 * mise en forme SAISIE, préservée au rendu (`dashItemList`,
 * `preserveLeadingSpaces`). Sans tiret NI retour à la ligne : texte intact en
 * un seul élément, même filet minimal qu'avant (R10 inchangée).
 */
export function splitAtcdBoundaries(text: string): string[] {
    const dashItems = splitAtDashBoundaries(text);
    if (dashItems.length > 1) {
        return dashItems;
    }
    if (!text) {
        return dashItems;
    }
    const lines = text
        .split('\n')
        .map((s) => s.trimEnd())
        .filter((s) => s.trim() !== '');
    return lines.length > 1 ? lines : dashItems;
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
/**
 * Rend une liste d'items à tiret comme une pile d'éléments INDIVIDUELLEMENT
 * insécables — pdfmake ne rompt donc jamais un item en milieu de phrase.
 * Chaque item reste très en-deçà de la hauteur d'une page (finding #1 du
 * banc : un bloc `unbreakable` DÉPASSANT une page est SILENCIEUSEMENT
 * SUPPRIMÉ par pdfmake — jamais appliqué ici à un bloc de la taille d'une
 * page, seulement à chaque item pris isolément).
 */
function dashItemList(
    items: string[],
    p: OiPdfPalette,
    /** Édition en place (mission « régression édition ») — UN ancrage PAR ITEM, tous sur le MÊME `ref` (ils résolvent au même `<textarea>` source) : un clic sur N'IMPORTE QUELLE ligne ouvre l'éditeur avec la valeur COMPLÈTE du champ (lue live sur le DOM, jamais reconstruite depuis les items), cf. JSDoc `pdf-preview-edit.ts`. */
    edit?: { anchors: OiPdfEditAnchor[]; ref: PdfFieldAnchor },
): Content[] {
    if (edit) {
        items.forEach((item) => registerPdfEditAnchor(edit.anchors, edit.ref, item));
    }
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
            // Correctif D1 : les items ATCD scindés aux retours à la ligne
            // (`splitAtcdBoundaries`) peuvent porter une indentation SAISIE
            // (lignes de continuation « ␣␣␣␣DETENTION… ») — préservée telle
            // quelle. Sans effet sur les items à tiret (jamais indentés).
            preserveLeadingSpaces: true,
        }),
    );
}

/** Libellé de champ seul (port du préfixe `LABEL :` de `labelValue`, sans valeur inline) — utilisé devant une `dashItemList` scindée sur plusieurs pages. */
function fieldLabel(label: string, p: OiPdfPalette): Content {
    return { text: `${label.toUpperCase()} :`, bold: true, color: p.accent, margin: [0, 0, 0, 2] };
}

/**
 * Hauteur (pt) d'UNE boîte « cellule » (`cellGroupBox`, composition par
 * cellule ZMSPCP/MOICP) au palier `fontPx` — libellé de cellule (1 ligne) +
 * pastilles `pillRow` (6 par rangée, cf. `cellGroupBox`) + paddings/marge.
 * Approximation volontaire (même philosophie que le reste du modèle
 * physique de ce module : aucune mesure de rendu réelle possible).
 */
function cellGroupPt(memberCount: number, fontPx: number): number {
    const line = effracLinePt(fontPx);
    const rows = Math.max(1, Math.ceil(memberCount / 6));
    return line + 4 + rows * (line + 4) + 8 + 8;
}

/**
 * Hauteur totale (pt) de « Composition par Cellule » (h3 + une boîte par
 * cellule + libellé Place du Chef) au palier `fontPx`. `placeChefLabel` DOIT
 * être le MÊME libellé que celui passé au `labelValue` de rendu
 * (`buildArticulationPage`) — sinon le calcul de fit se décale (§4.3
 * SPEC-2026-08-18-pdf-et-champs.md : le libellé diffère désormais entre
 * MOICP et ZMSPCP).
 */
function cellsContentPt(groups: Array<[string, string[]]>, placeChef: string, fontPx: number, columnWidthPt: number, placeChefLabel: string): number {
    const boxesPt =
        groups.length > 0 ? groups.reduce((sum, [, members]) => sum + cellGroupPt(members.length, fontPx) + 8, 0) : effracLinePt(fontPx);
    return EFFRAC_H3_PT + boxesPt + textLinePt(`${placeChefLabel} : ${placeChef}`, fontPx, columnWidthPt);
}

/**
 * Page unique ZMSPCP/MOICP (mutualisé, les deux blocs partagent exactement
 * la même mécanique — seuls les champs « cœur » [Z/M/S/P ou M/O/I/P] et le
 * libellé de la 1re colonne diffèrent).
 *
 * MISSION P1 (directive Nico 2026-08-10, « une page = un usage », «
 * interdiction absolue des continuations (SUITE) ») — refonte totale :
 * `chunkItemsByCost`/pages « (SUITE) » ont été RETIRÉES ; le bloc est
 * TOUJOURS rendu sur une seule page, au palier de police choisi par le
 * solveur `fitUsageToPage` (theme.ts, coût réel pt recalculé à chaque
 * palier 11→7). `catText` reste rendu en liste d'items INDIVIDUELLEMENT
 * insécables dès qu'une frontière légitime (tiret) existe (pdfmake ne
 * coupe alors jamais en milieu de phrase) ; sans frontière, repli sur un
 * simple `labelValue`. Si même le palier plancher 7 px ne suffit pas,
 * l'erreur est collectée dans `ctx.fitErrors` (REFUS DE GÉNÉRATION global) —
 * le bloc est quand même rendu au palier plancher (le document entier ne
 * sera jamais renvoyé si `fitErrors` n'est pas vide).
 */
function buildArticulationPage(
    ctx: BuildCtx,
    opts: {
        title: string;
        sectionLabel: string;
        /** Édition en place : 3e élément = ancrage du champ (`null` si non ancrable — aucun cas à ce jour), cf. `blockFieldAnchor`. */
        coreFields: Array<[string, string, PdfFieldAnchor | null]>;
        catLabel: string;
        catText: string;
        catRef: PdfFieldAnchor;
        groups: Array<[string, string[]]>;
        cellsContent: Content[];
        placeChef: string;
        placeChefRef: PdfFieldAnchor;
        /** Libellé du champ Place du Chef — diffère entre MOICP/ZMSPCP (§4.3 SPEC-2026-08-18-pdf-et-champs.md). */
        placeChefLabel: string;
    },
): Content {
    const { p, geo } = ctx;
    const { title, sectionLabel, coreFields, catLabel, catText, catRef, groups, cellsContent, placeChef, placeChefRef, placeChefLabel } = opts;
    const catItems = splitAtDashBoundaries(catText || '-');
    const hasBoundary = catItems.length > 1;
    const columnWidthPt = (geo.contentWidthPt - mm(6)) / 2;

    const computeCostPt = (fontPx: number): number => {
        const line = effracLinePt(fontPx);
        const coreFieldsPt = coreFields.reduce((sum, [label, value]) => sum + textLinePt(`${label} : ${value}`, fontPx, columnWidthPt), 0);
        const catPt = hasBoundary
            ? line /* fieldLabel */ + catItems.reduce((sum, item) => sum + textLinePt(item, fontPx, columnWidthPt), 0)
            : textLinePt(`${catLabel} : ${catText}`, fontPx, columnWidthPt);
        const leftPt = EFFRAC_H3_PT + coreFieldsPt + catPt;
        const rightPt = cellsContentPt(groups, placeChef, fontPx, columnWidthPt, placeChefLabel);
        return EFFRAC_H2_PT + Math.max(leftPt, rightPt);
    };

    const fit = fitUsageToPage(computeCostPt, geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT);
    if ('error' in fit) {
        ctx.fitErrors.push({
            section: title,
            details: `${catLabel} et/ou composition par cellule trop volumineux — allégez le texte ou le nombre de cellules`,
            excessRatio: fit.error.excessRatio,
        });
    }
    const fontPx = 'fontPx' in fit ? fit.fontPx : FIT_FONT_FLOOR;

    // Ordre d'ENREGISTREMENT des ancrages aligné sur l'ordre RÉEL de rendu
    // (mesure navigateur réelle, page ZMSPCP/MOICP : Z/M/S/P puis C, jamais
    // l'inverse) — `coreFieldsNode` DOIT donc être calculé (et ses ancres
    // enregistrées via `labelValue`) AVANT `catNode`, qui suivait
    // auparavant `left` en position mais était construit en PREMIER (`const`
    // évalué avant `coreFields.map`), décalant son ancre de ~4-5 rangs devant
    // Z/M/S/P dans l'index — seule la fenêtre `WINDOW_AHEAD` de
    // `pdf-preview-edit.ts` absorbait ce décalage jusqu'ici. Pur
    // réordonnancement : `left` prend exactement le même contenu final.
    const coreFieldsNode: Content[] = coreFields.map(([label, value, ref]) => labelValue(label, value, p, undefined, ref ? { anchors: ctx.anchors, ref } : undefined));
    const catNode: Content[] = hasBoundary
        ? [fieldLabel(catLabel, p), ...dashItemList(catItems, p, { anchors: ctx.anchors, ref: catRef })]
        : [labelValue(catLabel, catText, p, undefined, { anchors: ctx.anchors, ref: catRef })];
    const left: Content[] = [
        h3(sectionLabel, p),
        ...coreFieldsNode,
        ...catNode,
    ];
    const right: Content[] = [
        h3('Composition par Cellule', p),
        ...cellsContent,
        labelValue(placeChefLabel, placeChef, p, undefined, { anchors: ctx.anchors, ref: placeChefRef }),
    ];

    // Correctif revue (2026-08-10, point 2) : le titre reste COLLÉ à sa règle
    // — le contenu démarre juste dessous, l'espace résiduel (bloc peu
    // volumineux) reste naturellement en PIED de page.
    return {
        stack: [h2(title, p, geo.contentWidthPt), grid2(left, right)],
        fontSize: fontPx,
    };
}

function buildZmspcpPage(ctx: BuildCtx, block: OiZmspcpBlock, memberToCell: Map<string, string>): Content {
    const { p } = ctx;
    const groups = regroupByCellOrdered(block.members, memberToCell);
    const cellsContent: Content[] =
        groups.length > 0 ? groups.map(([cell, members]) => cellGroupBox(cell, members, p)) : [{ text: '-', color: p.muted }];
    return buildArticulationPage(ctx, {
        title: `Articulation : ZMSPCP - ${block.title || '-'}`,
        sectionLabel: 'ZMSPCP',
        coreFields: [
            ['Z zone', block.zone || '-', blockFieldAnchor('zmspcp', block.id, 'zone')],
            ['M mission', block.mission || '-', blockFieldAnchor('zmspcp', block.id, 'mission')],
            ['S secteur', block.secteur || '-', blockFieldAnchor('zmspcp', block.id, 'secteur')],
            ['P points particuliers', block.points_particuliers || '-', blockFieldAnchor('zmspcp', block.id, 'pp')],
        ],
        catLabel: 'C conduite à tenir',
        catText: block.cat || '-',
        catRef: blockFieldAnchor('zmspcp', block.id, 'cat'),
        groups,
        cellsContent,
        placeChef: block.place_chef || '-',
        placeChefRef: blockFieldAnchor('zmspcp', block.id, 'place-chef'),
        placeChefLabel: 'Place du chef AO',
    });
}

function buildMoicpPage(ctx: BuildCtx, block: OiMoicpBlock, memberToCell: Map<string, string>): Content {
    const { p } = ctx;
    const groups = regroupByCellOrdered(block.members, memberToCell);
    const cellsContent: Content[] =
        groups.length > 0 ? groups.map(([cell, members]) => cellGroupBox(cell, members, p)) : [{ text: '-', color: p.muted }];
    return buildArticulationPage(ctx, {
        title: `Articulation : MOICP - ${block.title || '-'}`,
        sectionLabel: 'MOICP',
        coreFields: [
            ['M mission', block.mission || '-', blockFieldAnchor('moicp', block.id, 'mission')],
            ['O objectif', block.objectif || '-', blockFieldAnchor('moicp', block.id, 'objectif')],
            ['I itinéraire', block.itineraire || '-', blockFieldAnchor('moicp', block.id, 'itineraire')],
            ['P points particuliers', block.points_particuliers || '-', blockFieldAnchor('moicp', block.id, 'pp')],
        ],
        catLabel: 'C conduite à tenir',
        catText: block.cat || '-',
        catRef: blockFieldAnchor('moicp', block.id, 'cat'),
        groups,
        cellsContent,
        placeChef: block.place_chef || '-',
        placeChefRef: blockFieldAnchor('moicp', block.id, 'place-chef'),
        placeChefLabel: 'Place du chef inter',
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
 * Marge de sécurité appliquée à `estimateCharsPerLine` avant de mesurer une
 * cellule d'hypothèse (BLIND.REFIX round 2, même esprit que
 * `DANGER_BUDGET_SAFETY_FACTOR` ci-dessus). `estimateCharsPerLine` mesure une
 * chasse fixe par CARACTÈRE alors que pdfmake enveloppe le texte aux
 * frontières de MOT — un texte plein de mots de 8-10 lettres n'utilise
 * jamais la pleine largeur de colonne jusqu'au dernier caractère avant de
 * passer à la ligne suivante. Constat mesuré (`effrac-n6.json`, hyp. 1,
 * colonne « Technique / Moyen » à `fontPx = 9` : 78 caractères, largeur
 * calculée pour 41 caractères/ligne → coût estimé 2 lignes, rendu RÉEL 3
 * lignes, cf. `A-effrac12L-11.png`/pdftotext) : sans cette marge, la 4e
 * hypothèse d'`effrac-n6` débordait sa page SANS titre « (SUITE) ».
 */
const HYP_ROW_COST_SAFETY_FACTOR = 0.8;

/**
 * Hauteur RÉELLE (pt) d'une ligne de la table d'hypothèses — le MAX des 4
 * colonnes (celle qui replie le plus dicte la hauteur), jamais leur somme ;
 * `h.desc` n'entre pas dans ce coût (rendu à part, `hypothesesDescBlock`).
 * Même repli par colonne que l'ancien `hypothesisRowCost` (fractions
 * `HYP_TABLE_COLUMN_FRACTIONS`, marge `HYP_ROW_COST_SAFETY_FACTOR`), converti
 * en points (avance × lignes + paddings).
 */
export function hypothesisRowHeightPt(h: OiEffractionHypothesis, fontPx: number, contentWidthPt: number): number {
    const charsPerLineCols = HYP_TABLE_COLUMN_FRACTIONS.map((f) =>
        Math.max(1, Math.floor(estimateCharsPerLine(fontPx, contentWidthPt * f) * HYP_ROW_COST_SAFETY_FACTOR)),
    );
    const cols = [h.title || h.id, h.effrac || '-', h.degag || '-', h.assaut || '-'];
    const lines = Math.max(...cols.map((text, i) => wrappedLinesWithNewlines(text, charsPerLineCols[i] as number)));
    return lines * effracLinePt(fontPx) + EFFRAC_ROW_VPAD_PT;
}

/**
 * Une valeur de mesure technique (§3.4/BLIND.REFIX round 2) est VIDE si
 * blanche OU réduite au repli littéral `-` — port du filtre strategica
 * `mesures()` (`OrderHtmlArticulation.kt:275-295`, `.filter { it.second.
 * isNotBlank() }`), cf. `isBlankOrDash` ci-dessus. N'agit QUE sur les 12
 * mesures techniques ci-dessous — `mission` (champ fantôme #3, toujours
 * rendu en tête de page indépendamment de ce filtre) n'en fait PAS partie.
 */
function isEffractionMeasureBlank(v: string | undefined): boolean {
    return isBlankOrDash(v);
}

/**
 * Corps de la carte « Caractéristiques Techniques » (§3.4 règle 1, BLIND.A
 * champs fantômes #3) — BLINDAGE round 2 : port du filtrage strategica
 * `mesures()` (cf. `isEffractionMeasureBlank`). RÉGRESSION CORRIGÉE (B5,
 * guardrail `verify-structure.mjs`) : avant ce correctif, les 12 mesures
 * étaient TOUJOURS rendues avec leur repli `'-'` (`labelValue(label,
 * block.x || '-', p)`) — un bloc dont `isEffractionBlockEmpty` ne permettait
 * plus l'omission (dès qu'`mission`/une hypothèse/une photo était saisie,
 * cf. sa JSDoc) affichait alors une page « saturée de libellés vides »
 * (12 × `LABEL : -`, ~169 car. de contenu utile, preuve
 * `A-effracvide-10.png`) — strategica ne fait JAMAIS cela (`mesures()`
 * filtre les lignes vides, rend « Aucune mesure renseignée. » si tout est
 * vide). Les 3 groupes `grid2` sont filtrés INDÉPENDAMMENT (une colonne peut
 * rester seule si l'autre est entièrement vide) ; le filet pointillé
 * (`canvas`) n'est posé QUE s'il sépare deux groupes non vides.
 */
function effractionMeasuresBody(ctx: BuildCtx, block: OiEffractionBlock, rightColWidthPt: number): Content[] {
    const { p } = ctx;
    /** Édition en place — `labelValue(label, value, p, undefined, edit)` pour une mesure d'effraction (`fieldClass` = suffixe DOM `.effrac-<fieldClass>`, cf. `blockFieldAnchor`). */
    const mv = (label: string, value: string, fieldClass: string): Content =>
        labelValue(label, value, p, undefined, { anchors: ctx.anchors, ref: blockFieldAnchor('effrac', block.id, fieldClass) });
    const allBlank = [
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
    ].every(isEffractionMeasureBlank);
    if (allBlank) {
        return [h3('Caractéristiques Techniques', p), { text: 'Aucune mesure renseignée.', color: p.muted }];
    }

    // Champ fantôme #3 (`porte`, `OrderHtmlArticulation.kt:279`) : 1re ligne,
    // AVANT Structure — même ordre que strategica (`champs-fantomes.md` #2).
    const typePorte: Content[] = !isEffractionMeasureBlank(block.porte) ? [mv('Type de Porte', block.porte, 'porte')] : [];

    const leftItems: Content[] = [
        !isEffractionMeasureBlank(block.structure) ? mv('Structure', block.structure, 'structure') : null,
        !isEffractionMeasureBlank(block.serrurerie) ? mv('Serrurerie', block.serrurerie, 'serrurerie') : null,
        !isEffractionMeasureBlank(block.environnement) ? mv('Environnement', block.environnement, 'environnement') : null,
    ].filter((c): c is Content => c !== null);
    const rightItems: Content[] = [
        !isEffractionMeasureBlank(block.bati_a_bati) ? mv('Bâti à Bâti', `${block.bati_a_bati} mm`, 'bati-bati') : null,
        !isEffractionMeasureBlank(block.dormant_a_dormant) ? mv('Dormant à Dormant', `${block.dormant_a_dormant} mm`, 'dormant-dormant') : null,
        !isEffractionMeasureBlank(block.prof_linteaux) ? mv('Prof. Linteaux', `${block.prof_linteaux} mm`, 'prof-linteaux') : null,
    ].filter((c): c is Content => c !== null);
    const gridTop: Content[] = leftItems.length > 0 || rightItems.length > 0 ? [grid2(leftItems, rightItems)] : [];

    const hPorteItem: Content[] = !isEffractionMeasureBlank(block.h_porte) ? [mv('H. Porte', block.h_porte, 'h-porte')] : [];
    const hMarcheItem: Content[] = !isEffractionMeasureBlank(block.h_marche) ? [mv('H. Marche', block.h_marche, 'h-marche')] : [];
    const gridH: Content[] = hPorteItem.length > 0 || hMarcheItem.length > 0 ? [grid2(hPorteItem, hMarcheItem)] : [];

    // Champ fantôme #3 (`prof_marche`/`prof_moulure`, `OrderHtmlArticulation.kt:289-290`)
    // — dernières lignes des mesures, même ordre que strategica.
    const profMarcheItem: Content[] = !isEffractionMeasureBlank(block.prof_marche) ? [mv('Prof. Marche', `${block.prof_marche} mm`, 'prof-marche')] : [];
    const profBatiItem: Content[] = !isEffractionMeasureBlank(block.prof_bati) ? [mv('Prof. Bâti', block.prof_bati, 'prof-bati')] : [];
    const gridProf: Content[] = profMarcheItem.length > 0 || profBatiItem.length > 0 ? [grid2(profMarcheItem, profBatiItem)] : [];

    const profMoulure: Content[] = !isEffractionMeasureBlank(block.prof_moulure) ? [mv('Prof. Moulure', `${block.prof_moulure} mm`, 'prof-moulure')] : [];

    const before = [...typePorte, ...gridTop];
    const after = [...gridH, ...gridProf, ...profMoulure];
    const separator: Content[] =
        before.length > 0 && after.length > 0
            ? [
                  {
                      // Filet pointillé pleine largeur (§3.2 ligne 8f) — largeur approximée
                      // à la colonne droite moins le padding de carte (2×8pt), non testée
                      // au pixel près (aucune assertion géométrique côté test).
                      canvas: [
                          { type: 'line', x1: 0, y1: 0, x2: Math.max(0, rightColWidthPt - 16), y2: 0, lineWidth: 1, lineColor: p.border, dash: { length: 2 } },
                      ],
                      margin: [0, 6, 0, 6],
                  } as Content,
              ]
            : [];

    return [h3('Caractéristiques Techniques', p), ...before, ...separator, ...after];
}

/**
 * Hauteur RÉELLE (pt) de tout ce qui précède la PREMIÈRE ligne de données de
 * la table d'hypothèses sur la page 1 du bloc EFFRACTION — titre `h2` de
 * page, ligne MISSION, bandeau photo/mesures (`head`), titre `h3`
 * « Hypothèses d'Effraction » et thead. Correctif D2 (gate ROUND0), deux
 * sous-évaluations corrigées :
 *   1. le bandeau photo de porte (`figure` à `mm(topHMm)` + badges
 *      `pillRow`) n'entrait NULLE PART dans l'ancien `headCost` — or ses
 *      ~242 pt dominent la carte specs dès que la photo existe (cause D2 du
 *      PDF réel `cas-reel-01` : titre + thead seuls en bas de p11, données
 *      p12 via `headerRows` sans « (SUITE) ») — `Math.max(specs, photo)`,
 *      les deux étant côte à côte en `columns` ;
 *   2. les mesures techniques étaient mesurées à la largeur PLEINE de page
 *      alors qu'avec photo elles vivent dans la colonne réduite
 *      (`specsColWidthPt` = `contentWidthPt - mm(70) - mm(6)`).
 */
/**
 * Hauteur (pt) de la carte « Caractéristiques Techniques » (mesures
 * filtrées, mêmes seuils/filtrage que le rendu réel `effractionMeasuresBody`
 * — une mesure blanche/`-` ne coûte aucune ligne fantôme) — factorisée hors
 * d'`effractionFirstOverheadPt` (D2) pour être réutilisée telle quelle par le
 * solveur fit-to-page de la page unique EFFRACTION (mission P1).
 */
function effractionSpecsCardPt(block: OiEffractionBlock, fontPx: number, specsColWidthPt: number): number {
    const line = effracLinePt(fontPx);
    const specsCpl = estimateCharsPerLine(fontPx, specsColWidthPt);
    const specsHalfCpl = estimateCharsPerLine(fontPx, specsColWidthPt / 2);

    const rowLines = (label: string, value: string | undefined, cpl: number): number =>
        isEffractionMeasureBlank(value) ? 0 : estimateWrappedLines(`${label} : ${value}`, cpl);

    const typePorteRows = rowLines('Type de Porte', block.porte, specsCpl);
    const leftColRows =
        rowLines('Structure', block.structure, specsHalfCpl) +
        rowLines('Serrurerie', block.serrurerie, specsHalfCpl) +
        rowLines('Environnement', block.environnement, specsHalfCpl);
    const rightColRows =
        rowLines('Bâti à Bâti', block.bati_a_bati, specsHalfCpl) +
        rowLines('Dormant à Dormant', block.dormant_a_dormant, specsHalfCpl) +
        rowLines('Prof. Linteaux', block.prof_linteaux, specsHalfCpl);
    const grid2TopRows = Math.max(leftColRows, rightColRows);
    const hRows = Math.max(rowLines('H. Porte', block.h_porte, specsHalfCpl), rowLines('H. Marche', block.h_marche, specsHalfCpl));
    const profRows = Math.max(rowLines('Prof. Marche', block.prof_marche, specsHalfCpl), rowLines('Prof. Bâti', block.prof_bati, specsHalfCpl));
    const profMoulureRows = rowLines('Prof. Moulure', block.prof_moulure, specsCpl);

    const specsRows = typePorteRows + grid2TopRows + hRows + profRows + profMoulureRows;
    return EFFRAC_H3_PT + specsRows * line + EFFRAC_CARD_VPAD_PT;
}

/**
 * Hauteur RÉELLE (pt) de tout ce qui précède la PREMIÈRE ligne de données de
 * la table d'hypothèses (mission, bandeau photo/mesures, titre + en-tête de
 * table) — modèle physique D2, préservé pour ses propres tests unitaires
 * (`effractionFirstOverheadPt`) ; réutilisé en interne par
 * `effractionSpecsCardPt` (factorisée, cf. JSDoc ci-dessus).
 */
export function effractionFirstOverheadPt(
    block: OiEffractionBlock,
    fontPx: number,
    contentWidthPt: number,
    specsColWidthPt: number,
    photoBandPt: number,
): number {
    const line = effracLinePt(fontPx);
    const fullCpl = estimateCharsPerLine(fontPx, contentWidthPt);
    const missionPt = wrappedLinesWithNewlines(`Mission : ${block.mission || '-'}`, fullCpl) * line + 10;
    const specsCardPt = effractionSpecsCardPt(block, fontPx, specsColWidthPt);
    const headPt = Math.max(specsCardPt, photoBandPt);
    const theadPt = line + EFFRAC_ROW_VPAD_PT;
    return EFFRAC_H2_PT + missionPt + 6 + headPt + 6 + EFFRAC_H3_PT + theadPt + EFFRAC_CARD_VPAD_PT;
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
 * Hauteur RÉELLE (pt, même unité que `hypothesisRowHeightPt`/
 * `effractionFirstOverheadPt` — modèle physique D2)
 * du bloc « Description des Hypothèses » (`hypothesesDescBlock`) — BF.REFIX
 * (round 1, point 3) : ce bloc n'était couvert par AUCUNE garde de budget,
 * contrairement à la table qui le précède — `fitsWithoutSplit`/
 * `chunkItemsByCost` ci-dessous ne mesuraient que le coût des LIGNES de
 * table, jamais celui de ce bloc texte ajouté SOUS la dernière tranche
 * (arbitrage #3). Reproduit sur `sentinel-champs.json` (2 hypothèses, table
 * tenant confortablement sur la page 1, mais la 2e description — plus
 * longue — débordait SEULE sur une page nue sans titre, guardrail B1). Même
 * méthode ligne par ligne que `hypothesesDescBlock` : titre `h3` (1 ligne) +
 * marge inter-blocs (1 ligne) + chaque entrée `HE<n> — … : …` mesurée à la
 * largeur PLEINE de la carte (`contentWidthPt`, pas la demi-largeur des
 * colonnes de la table).
 */
function descBlockHeightPt(hypotheses: OiEffractionHypothesis[], fontPx: number, contentWidthPt: number): number {
    const lines = hypotheses
        .map((h, i) => (h.desc && h.desc.trim() !== '' ? `HE${i + 1} — ${h.title || h.id} : ${h.desc}` : null))
        .filter((s): s is string => s !== null);
    if (lines.length === 0) {
        return 0;
    }
    const cpl = estimateCharsPerLine(fontPx, contentWidthPt);
    const textLines = lines.reduce((sum, line) => sum + wrappedLinesWithNewlines(line, cpl), 0);
    // h3 « Description des Hypothèses » + marge inter-blocs (6) + lignes.
    return EFFRAC_H3_PT + 6 + textLines * effracLinePt(fontPx);
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
 * « zéro perte de données quel que soit le volume ».
 *
 * CORRECTIF BLIND.REFIX round 2 — LA JUSTIFICATION CI-DESSUS ÉTAIT
 * INCOMPLÈTE, DÉMENTIE PAR UN CAS RÉEL : round 1 écartait le risque de faux
 * positif au motif que le repli `'-'` (`strOr`/`labelValue(..., block.x ||
 * '-', p)`) « n'existe QU'au rendu, jamais dans la donnée testée ici » — vrai
 * pour un `block.mission` réellement `''`/`undefined`, MAIS un `block.mission`
 * dont la valeur SAISIE est littéralement le caractère `'-'` (repli déjà
 * appliqué en amont par l'appelant/le Store, ou saisie volontaire d'un
 * tiret) traverse `str().trim() !== ''` sans jamais être reconnue comme
 * « vide » — un bloc SANS AUCUNE mesure technique, SANS hypothèse, SANS
 * photo, dont seul `mission` vaut `'-'`, n'était donc PLUS omis (test
 * dédié : « un bloc effraction SANS AUCUNE mesure technique… est OMIS »).
 * Un tiret seul n'est jamais une DONNÉE saisie utile à l'utilisateur (même
 * filtre que `isEffractionMeasureBlank`/`effractionMeasuresBody` ci-dessous,
 * port strategica `mesures()` : `.filter { it.second.isNotBlank() }`) —
 * `mission` rejoint donc ce filtre ici aussi, uniquement pour cette décision
 * de VIDE/NON-VIDE (la ligne « Mission » elle-même reste rendue avec son
 * repli `'-'` habituel dès que le bloc n'est pas vide par ailleurs, champ
 * fantôme #3 inchangé).
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
    const hasMeasure = measures.some((v) => !isEffractionMeasureBlank(v));
    return !hasMeasure && block.hypotheses.length === 0 && doorSrc === undefined;
}

/** Nombre max d'hypothèses rendues en CARTES (directive Nico 2026-08-10 : « cartes empilées ou 2 colonnes selon le nombre ») — au-delà, repli sur la table dense historique (plus compacte à volume élevé). */
const EFFRAC_HYP_CARDS_MAX = 4;

/**
 * Ratio d'interlignage RESSERRÉ (« densité tight ») vs NOMINAL (1,45, cf.
 * `PDF_LINE_ADVANCE_EM`) des cartes hypothèses — directive Nico 2026-08-10,
 * dernière passe effraction, point 1a : « interlignage 1.45→1.25, paddings
 * resserrés AVANT de toucher la police ». Escalade DENSITÉ PUIS police à
 * chaque palier (`EFFRAC_HYP_LEVELS` ci-dessous) : jamais l'inverse.
 */
const EFFRAC_HYP_TIGHT_RATIO = 1.25 / 1.45;

/** Avance de ligne (pt) d'une carte hypothèse au palier `fontPx`, densité `tight` ou nominale. */
function hypLinePt(fontPx: number, tight: boolean): number {
    return tight ? effracLinePt(fontPx) * EFFRAC_HYP_TIGHT_RATIO : effracLinePt(fontPx);
}

/** Coût (pt) d'un texte replié à densité `tight`/nominale — même modèle que `textLinePt`, avance de ligne resserrée. */
function textLinePtDensity(text: string, fontPx: number, columnWidthPt: number, tight: boolean): number {
    const cpl = estimateCharsPerLine(fontPx, columnWidthPt);
    return wrappedLinesWithNewlines(text, cpl) * hypLinePt(fontPx, tight);
}

/** Padding interne (pt) d'une carte hypothèse — resserré en densité `tight`. */
function hypCardPadPt(tight: boolean): number {
    return tight ? 6 : 12;
}

/** Marge (pt) entre deux cartes hypothèses empilées/côte à côte — resserrée en densité `tight`. */
function hypCardGapPt(tight: boolean): number {
    return tight ? 4 : 8;
}

/**
 * Paliers d'escalade DENSITÉ×POLICE des cartes hypothèses — DENSITÉ testée
 * AVANT police à chaque palier (`[11,normal]`, `[11,tight]`, `[10,normal]`,
 * `[10,tight]`, …, `[7,normal]`, `[7,tight]`), conformément à la directive
 * « densité réduite d'abord AVANT de toucher la police ».
 */
const EFFRAC_HYP_LEVELS: ReadonlyArray<{ fontPx: number; tight: boolean }> = FIT_FONT_STEPS.flatMap((fontPx) => [
    { fontPx, tight: false },
    { fontPx, tight: true },
]);

/**
 * Champs non vides d'une hypothèse (Technique/Moyen, Dégagement, Assaut) —
 * `desc` est traité À PART (ligne dédiée, jamais mélangée au tri par
 * longueur des 3 champs « techniques »).
 */
function hypothesisFields(h: OiEffractionHypothesis): Array<{ label: string; value: string }> {
    return (
        [
            { label: 'Technique / Moyen', value: h.effrac },
            { label: 'Dégagement', value: h.degag },
            { label: 'Assaut', value: h.assaut },
        ] as Array<{ label: string; value: string | undefined }>
    ).filter((f): f is { label: string; value: string } => !isBlankOrDash(f.value));
}

/**
 * Colonnes internes ADAPTATIVES d'une carte hypothèse (directive Nico
 * 2026-08-10, point 1a) : les DEUX champs les plus COURTS côte à côte (2
 * colonnes), le(s) champ(s) restant(s) — le(s) plus LONG(s) — pleine largeur
 * de carte en dessous. Purement DATA-DRIVEN (jamais une affectation fixe
 * « Technique/Moyen = court » : dépend du texte réellement saisi) — PARTAGÉ
 * entre coût (`hypothesisAdaptiveCardPt`) et rendu (`renderHypothesisCard`).
 */
function hypothesisAdaptiveRows(h: OiEffractionHypothesis): Array<Array<{ label: string; value: string }>> {
    const fields = hypothesisFields(h);
    if (fields.length === 0) {
        return [];
    }
    if (fields.length === 1) {
        return [[fields[0] as { label: string; value: string }]];
    }
    const sorted = [...fields].sort((a, b) => a.value.length - b.value.length);
    const rows: Array<Array<{ label: string; value: string }>> = [[sorted[0] as { label: string; value: string }, sorted[1] as { label: string; value: string }]];
    for (let i = 2; i < sorted.length; i++) {
        rows.push([sorted[i] as { label: string; value: string }]);
    }
    return rows;
}

/** Hauteur (pt) d'UNE carte hypothèse (colonnes internes adaptatives + densité) au palier `fontPx`/`tight`, dans une colonne de `cardWidthPt`. */
function hypothesisAdaptiveCardPt(h: OiEffractionHypothesis, fontPx: number, tight: boolean, cardWidthPt: number): number {
    const rows = hypothesisAdaptiveRows(h);
    const rowsPt = rows.reduce((sum, row) => {
        if (row.length === 2) {
            const halfWidthPt = (cardWidthPt - mm(4)) / 2;
            const c0 = textLinePtDensity(`${row[0]!.label} : ${row[0]!.value}`, fontPx, halfWidthPt, tight);
            const c1 = textLinePtDensity(`${row[1]!.label} : ${row[1]!.value}`, fontPx, halfWidthPt, tight);
            return sum + Math.max(c0, c1);
        }
        return sum + textLinePtDensity(`${row[0]!.label} : ${row[0]!.value}`, fontPx, cardWidthPt, tight);
    }, 0);
    const descPt = !isBlankOrDash(h.desc) ? textLinePtDensity(`Description : ${h.desc}`, fontPx, cardWidthPt, tight) : 0;
    // RECALIBRAGE (revue 2026-08-10, mesure au rendu réel plutôt qu'un facteur
    // de sécurité empilé) : une carte hypothèse isolée (`effraction-heavy.json`,
    // H1, police 11 normale, pleine largeur) mesurée par pixels sur le PDF
    // rendu (`pdftoppm -r 60`, bornes de la table bordée détectées par
    // couleur) fait 150 px de haut, soit 150 × 72/60 = 180 pt de CORPS (hors
    // h3 « Hypothèses d'Effraction » de la carte englobante, compté à part par
    // l'appelant). Le modèle SANS aucun facteur (titre + lignes + paddings
    // ci-dessous) donne ~192 pt pour ce même cas — à ~7 % de la mesure réelle,
    // dans le sens SÛR (légèrement au-dessus). Aucun facteur multiplicatif
    // supplémentaire n'est donc nécessaire ; le bug qui faisait déborder les
    // pages « (SUITE) » n'était PAS un sous-dimensionnement du modèle mais
    // l'absence de `pageBreak:'before'` sur les pages 2+ (corrigé à part), et
    // le vide résiduel constaté ensuite venait du solveur qui retenait le
    // PREMIER palier « qui rentre » plutôt que celui qui REMPLIT le mieux
    // (corrigé ci-dessous, sélection au nombre de pages minimal).
    return hypLinePt(fontPx, tight) /* titre */ + rowsPt + descPt + hypCardPadPt(tight) * 2;
}

/** Rend UNE carte hypothèse (colonnes internes adaptatives + densité) — même contenu que `hypothesisAdaptiveCardPt`. */
function renderHypothesisCard(h: OiEffractionHypothesis, p: OiPdfPalette, tight: boolean): Content {
    const rows = hypothesisAdaptiveRows(h);
    const rowNodes: Content[] = rows.map((row) =>
        row.length === 2
            ? {
                  columns: [
                      { width: '*', text: breakLongTokens(`${row[0]!.label} : ${row[0]!.value}`) },
                      { width: '*', text: breakLongTokens(`${row[1]!.label} : ${row[1]!.value}`) },
                  ],
                  columnGap: mm(4),
              }
            : { text: breakLongTokens(`${row[0]!.label} : ${row[0]!.value}`) },
    );
    // `italics:true` PROSCRIT ici : la police `JetBrainsMono` n'a pas de variante
    // italique enregistrée côté pdfmake (`PDF_FONTS`) — testé au rendu réel
    // (crash `PDFDocument.provideFont`), jamais détecté par les tests JSON purs
    // de ce module (aucune assertion de rendu pdfmake réel). `color: p.muted`
    // porte la même distinction visuelle sans dépendre d'une variante absente.
    const descNode: Content[] = !isBlankOrDash(h.desc) ? [{ text: breakLongTokens(`Description : ${h.desc}`), color: p.muted }] : [];
    return {
        table: {
            widths: ['*'],
            body: [
                [
                    {
                        stack: [
                            { text: breakLongTokens(h.title || h.id), bold: true, color: p.accent, margin: [0, 0, 0, 4] },
                            ...rowNodes,
                            ...descNode,
                        ],
                        fillColor: p.cardAlt,
                        lineHeight: tight ? EFFRAC_HYP_TIGHT_RATIO : undefined,
                    },
                ],
            ],
        },
        layout: LAYOUT_BORDERED,
        margin: [0, 0, 0, hypCardGapPt(tight)],
    };
}

/** Nombre de colonnes de la grille de cartes hypothèses (directive Nico : « cartes empilées ou 2 colonnes selon le nombre »). */
function hypCardsColumnCount(count: number): 1 | 2 {
    // Correctif revue (2026-08-10, « le refus doit devenir l'ultime recours ») :
    // dès 2 hypothèses, les poser CÔTE À CÔTE (1 rangée) coûte TOUJOURS moins
    // cher en hauteur que les empiler (2 rangées), quelle que soit la longueur
    // du texte — direction sûre pour la DENSITÉ de page (« remplis chaque page
    // avec autant d'hypothèses complètes que possible »). Seul un groupe d'UNE
    // hypothèse reste en 1 colonne (rien à côté d'elle).
    return count >= 2 ? 2 : 1;
}

/** Hauteur (pt) de la région « Hypothèses d'Effraction » rendue en CARTES uniformes (grille régulière) à densité/police donnée — utilisée pour le test « tient sur 1 page » ET pour l'empaquetage multi-pages (`packHypotheses`, sous-ensembles quelconques). */
function hypothesesCardsUniformRegionPt(hypotheses: OiEffractionHypothesis[], fontPx: number, tight: boolean, fullWidthPt: number): number {
    if (hypotheses.length === 0) {
        return hypLinePt(fontPx, tight);
    }
    const cols = hypCardsColumnCount(hypotheses.length);
    const cardWidthPt = cols === 1 ? fullWidthPt : (fullWidthPt - mm(6)) / 2;
    const cardPts = hypotheses.map((h) => hypothesisAdaptiveCardPt(h, fontPx, tight, cardWidthPt));
    const maxCardPt = Math.max(...cardPts, 0);
    const rows = Math.ceil(hypotheses.length / cols);
    return rows * (maxCardPt + hypCardGapPt(tight));
}

/** Rend la grille UNIFORME de cartes hypothèses (1 ou 2 colonnes régulières). */
function renderHypCardsUniform(hypotheses: OiEffractionHypothesis[], p: OiPdfPalette, tight: boolean): Content[] {
    if (hypotheses.length === 0) {
        return [{ text: 'Aucune hypothèse saisie.', color: p.muted }];
    }
    const cols = hypCardsColumnCount(hypotheses.length);
    if (cols === 1) {
        return hypotheses.map((h) => renderHypothesisCard(h, p, tight));
    }
    const rows: Content[] = [];
    for (let i = 0; i < hypotheses.length; i += 2) {
        const left = [renderHypothesisCard(hypotheses[i] as OiEffractionHypothesis, p, tight)];
        const rightItem = hypotheses[i + 1];
        const right = rightItem !== undefined ? [renderHypothesisCard(rightItem, p, tight)] : [{ text: '' } as Content];
        rows.push(grid2(left, right));
    }
    return rows;
}

/** Longueur totale saisie d'une hypothèse (3 champs + description) — sert à détecter une CONCENTRATION du volume sur 1-2 hypothèses (directive point 1c). */
function hypothesisTotalLen(h: OiEffractionHypothesis): number {
    return (h.effrac?.length ?? 0) + (h.degag?.length ?? 0) + (h.assaut?.length ?? 0) + (h.desc?.length ?? 0);
}

/**
 * Détecte une CONCENTRATION du volume sur 1-2 hypothèses « longues » parmi
 * un ensemble par ailleurs « court » (directive Nico 2026-08-10, point 1c) —
 * `null` si le profil n'est pas concentré (aucune longue, ou trop de longues,
 * ou toutes longues) : dans ce cas la disposition ASYMÉTRIQUE n'apporte rien
 * de plus que la grille uniforme, inutile de l'essayer.
 */
function detectHypConcentration(
    hypotheses: OiEffractionHypothesis[],
): { longs: OiEffractionHypothesis[]; shorts: OiEffractionHypothesis[] } | null {
    if (hypotheses.length < 2) {
        return null;
    }
    const lens = hypotheses.map(hypothesisTotalLen);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const longs = hypotheses.filter((_, i) => (lens[i] as number) > avg * 1.4 && (lens[i] as number) > 150);
    if (longs.length === 0 || longs.length > 2 || longs.length === hypotheses.length) {
        return null;
    }
    const shorts = hypotheses.filter((h) => !longs.includes(h));
    return { longs, shorts };
}

/** Hauteur (pt) de la disposition ASYMÉTRIQUE (shorts en grille 2 colonnes compacte au-dessus, longs pleine largeur empilés dessous). */
function hypothesesCardsAsymmetricRegionPt(
    longs: OiEffractionHypothesis[],
    shorts: OiEffractionHypothesis[],
    fontPx: number,
    tight: boolean,
    fullWidthPt: number,
): number {
    const shortsPt = shorts.length === 0 ? 0 : hypothesesCardsUniformRegionPt(shorts, fontPx, tight, fullWidthPt);
    const longsPt = longs.reduce((sum, h) => sum + hypothesisAdaptiveCardPt(h, fontPx, tight, fullWidthPt) + hypCardGapPt(tight), 0);
    return shortsPt + longsPt;
}

/** Rend la disposition ASYMÉTRIQUE — shorts en grille compacte, longs pleine largeur dessous. */
function renderHypCardsAsymmetric(longs: OiEffractionHypothesis[], shorts: OiEffractionHypothesis[], p: OiPdfPalette, tight: boolean): Content[] {
    return [...(shorts.length > 0 ? renderHypCardsUniform(shorts, p, tight) : []), ...longs.map((h) => renderHypothesisCard(h, p, tight))];
}

/** Hauteur (pt) de la région « Hypothèses d'Effraction » rendue en TABLE dense (> `EFFRAC_HYP_CARDS_MAX`) — thead + une rangée par hypothèse du sous-ensemble + description sous le tableau (utilisée aussi pour l'empaquetage multi-pages, sous-ensembles quelconques). */
function hypothesesTableRegionPt(hypotheses: OiEffractionHypothesis[], fontPx: number, contentWidthPt: number): number {
    const theadPt = effracLinePt(fontPx) + EFFRAC_ROW_VPAD_PT;
    const rowsPt = hypotheses.reduce((sum, h) => sum + hypothesisRowHeightPt(h, fontPx, contentWidthPt), 0);
    const descPt = descBlockHeightPt(hypotheses, fontPx, contentWidthPt);
    return theadPt + rowsPt + descPt;
}

/** Rend la table dense d'un sous-ensemble d'hypothèses (en-tête + rangées + description). */
function renderHypTable(hypotheses: OiEffractionHypothesis[], p: OiPdfPalette): Content[] {
    const rows: TableCell[][] =
        hypotheses.length > 0
            ? hypotheses.map((h) => hypothesisTableRow(h, p))
            : [[{ text: 'Aucune hypothèse saisie', colSpan: 4, alignment: 'center', borderColor: cellBorder(p) }, {}, {}, {}]];
    const hypTable: Content = {
        table: { widths: ['20%', '30%', '25%', '25%'], headerRows: 1, body: [hypothesesTableHeader(p), ...rows] },
        layout: LAYOUT_BORDERED,
    };
    const descBlock = hypothesesDescBlock(hypotheses, p);
    return [hypTable, ...(descBlock !== null ? [descBlock] : [])];
}

/**
 * Empaquette `hyps` en 1+ PAGES AUTONOMES (directive Nico 2026-08-10, point
 * 1d — « ultime astuce avant refus ») : chaque hypothèse est une frontière
 * légitime, JAMAIS coupée en son milieu. La 1re page partage son budget avec
 * MISSION+CARACTÉRISTIQUES (`firstBudgetPt`, peut rester VIDE — 0 hypothèse
 * — si même la 1re n'y tient pas) ; chaque page SUIVANTE dispose d'un budget
 * de PAGE DÉDIÉE PLEINE (`restBudgetPt`) et DOIT accueillir AU MOINS 1
 * hypothèse — sinon `null` (aucun empaquetage possible à ce palier : au
 * moins une hypothèse, prise seule, ne tient même pas sur une page dédiée
 * complète — cf. `buildEffractionPages`, condition de REFUS point 1e).
 */
function packHypotheses<T>(hyps: T[], regionCostPt: (subset: T[]) => number, firstBudgetPt: number, restBudgetPt: number): T[][] | null {
    const groups: T[][] = [];
    let end = 0;
    while (end < hyps.length && regionCostPt(hyps.slice(0, end + 1)) <= firstBudgetPt) {
        end++;
    }
    groups.push(hyps.slice(0, end));
    let idx = end;
    while (idx < hyps.length) {
        let e = idx;
        while (e < hyps.length && regionCostPt(hyps.slice(idx, e + 1)) <= restBudgetPt) {
            e++;
        }
        if (e === idx) {
            return null;
        }
        groups.push(hyps.slice(idx, e));
        idx = e;
    }
    return groups;
}

/** Étiquette de plage « 3-4 »/« 3 » d'un sous-groupe d'hypothèses CONTIGU au sein de l'ensemble complet — pour le titre autonome des pages de continuation (jamais « (SUITE) »). */
function hypRangeLabel(group: OiEffractionHypothesis[], all: OiEffractionHypothesis[]): string {
    const first = all.indexOf(group[0] as OiEffractionHypothesis) + 1;
    const last = all.indexOf(group[group.length - 1] as OiEffractionHypothesis) + 1;
    return first === last ? `${first}` : `${first}-${last}`;
}

/**
 * Bloc « Articulation : EFFRACTION - <titre> » (pdf-engine-v2.ts:1132-1187,
 * §3.2 ligne 8f, POINT DE VIGILANCE §1). `[]` si `isEffractionBlockEmpty`
 * (§3.4 règle 1) — section omise, jamais de page à titre seul pour un bloc
 * créé mais non renseigné.
 *
 * DERNIÈRE PASSE (directive Nico 2026-08-10, « le refus doit devenir
 * l'ultime recours pour l'effraction ») — ESCALADE DE DISPOSITIONS, dans
 * l'ordre, avant tout refus :
 *   a. Cartes à colonnes internes ADAPTATIVES (`hypothesisAdaptiveRows` — 2
 *      champs courts côte à côte, le(s) long(s) pleine largeur) + DENSITÉ
 *      resserrée (interlignage 1,45→1,25, paddings resserrés) testée AVANT
 *      chaque palier de police (`EFFRAC_HYP_LEVELS`, 11→7 × densité) ;
 *   b. paliers de police 11→7 (inclus dans la même boucle) ;
 *   c. si le volume se CONCENTRE sur 1-2 hypothèses (`detectHypConcentration`) :
 *      disposition ASYMÉTRIQUE (courtes en grille compacte, longue(s) pleine
 *      largeur dessous) — mêmes paliers densité×police ;
 *   d. ultime recours avant refus : la cellule s'étend sur PLUSIEURS PAGES
 *      AUTONOMES (`packHypotheses`) — jamais de coupure en milieu
 *      d'hypothèse, jamais de titre « (SUITE) » (chaque page porte un titre
 *      DISTINCT et se suffit : « … — MISSION & CARACTÉRISTIQUES » pour la
 *      1re, « … — HYPOTHÈSES <plage> » pour les suivantes) ;
 *   e. REFUS seulement si UNE hypothèse, prise SEULE, ne tient pas sur une
 *      page entière dédiée même au palier plancher 7 px/densité resserrée
 *      (`ctx.fitErrors`, message explicite « hypothèse unique »).
 * Les hypothèses sont rendues en CARTES (`EFFRAC_HYP_CARDS_MAX` = 4 max au
 * total) ou, au-delà, en TABLE dense (plus compacte à volume élevé) — les
 * étapes b/d/e s'appliquent aux DEUX modes, a/c sont spécifiques aux cartes
 * (densité/asymétrie, directive P1c).
 */
function buildEffractionPages(ctx: BuildCtx, block: OiEffractionBlock): Content[] {
    const { photosBase64, dynamicPhotos, p, geo, is169 } = ctx;
    const doorMeta = dynamicPhotos[`photo_effrac_${block.id}`]?.[0];
    const doorSrc = doorMeta ? photosBase64[doorMeta.id] : undefined;
    if (isEffractionBlockEmpty(block, doorSrc)) {
        return [];
    }
    const tools = doorMeta ? parseTools(doorMeta.tools) : [];
    const topHMm = is169 ? 45 : 55;
    const title = `Articulation : EFFRACTION - ${block.title || '-'}`;
    // Titre systématiquement présent (jamais de carte « Hypothèse N » vide) — même filet que `hypNumberFallback` ailleurs dans ce module.
    const hypotheses = block.hypotheses.map((h, i) => ({ ...h, title: h.title || h.id || `Hypothèse ${i + 1}` }));
    const useCards = hypotheses.length <= EFFRAC_HYP_CARDS_MAX;

    const toolsBadges: Content =
        tools.length > 0
            ? pillRow(tools, p, { fillColor: p.warning, textColor: '#000000' })
            : pillRow(['PORTE'], p, { fillColor: p.warning, textColor: '#000000' });

    const rightColWidthPt = doorSrc !== undefined ? geo.contentWidthPt - mm(70) - mm(6) : geo.contentWidthPt;
    // Correctif revue (2026-08-10, point 2) : `EFFRAC_BADGES_PT` (constante
    // figée, périmée par la nouvelle géométrie de badges livrée par P2,
    // `blocks.ts::packToolBadgeRows`/`galleryToolsReservePt`) est remplacée
    // par un calcul RÉEL sur le même modèle flow que le rendu (`pillRow`
    // reste le rendu effectif ici, distinct du badge premium de galerie —
    // seule la RÉSERVE de hauteur est recalibrée sur le modèle P2, direction
    // sûre : jamais sous-évaluée).
    const photoBandPt = doorSrc !== undefined ? mm(topHMm) + galleryToolsReservePt(tools.length > 0 ? tools : ['PORTE'], mm(70)) : 0;

    const missionLine = labelValue('Mission', block.mission || '-', p, undefined, {
        anchors: ctx.anchors,
        ref: blockFieldAnchor('effrac', block.id, 'mission'),
    });
    const specs = card(effractionMeasuresBody(ctx, block, rightColWidthPt), p, { unbreakable: false });
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

    const missionOverheadPt = (fontPx: number): number => {
        const missionPt = textLinePt(`Mission : ${block.mission || '-'}`, fontPx, geo.contentWidthPt) + 10;
        const specsCardPt = effractionSpecsCardPt(block, fontPx, rightColWidthPt);
        const headPt = Math.max(specsCardPt, photoBandPt);
        return EFFRAC_H2_PT + missionPt + 6 + headPt + 6;
    };
    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;

    const regionCostPt = (subset: OiEffractionHypothesis[], fontPx: number, tight: boolean): number =>
        useCards ? hypothesesCardsUniformRegionPt(subset, fontPx, tight, geo.contentWidthPt) : hypothesesTableRegionPt(subset, fontPx, geo.contentWidthPt);
    const renderRegion = (subset: OiEffractionHypothesis[], tight: boolean): Content[] =>
        useCards ? renderHypCardsUniform(subset, p, tight) : renderHypTable(subset, p);

    const page1Head: Content[] = [missionLine, { text: '', margin: [0, 4, 0, 0] }, head, { text: '', margin: [0, 6, 0, 0] }];
    const hypSectionCard = (body: Content[]): Content => card([h3("Hypothèses d'Effraction", p), ...body], p, { unbreakable: false });

    // ── a/b : grille UNIFORME, densité × police (cartes) ou police seule (table) ──
    const levels = useCards ? EFFRAC_HYP_LEVELS : FIT_FONT_STEPS.map((fontPx) => ({ fontPx, tight: false }));
    for (const { fontPx, tight } of levels) {
        const total = missionOverheadPt(fontPx) + EFFRAC_H3_PT + regionCostPt(hypotheses, fontPx, tight) + EFFRAC_CARD_VPAD_PT;
        if (total <= availablePt) {
            return [
                {
                    stack: [h2(title, p, geo.contentWidthPt), ...page1Head, hypSectionCard(renderRegion(hypotheses, tight))],
                    fontSize: fontPx,
                },
            ];
        }
    }

    // ── c : disposition ASYMÉTRIQUE (cartes uniquement, volume concentré) ──
    if (useCards) {
        const concentration = detectHypConcentration(hypotheses);
        if (concentration) {
            for (const { fontPx, tight } of EFFRAC_HYP_LEVELS) {
                const regionPt = hypothesesCardsAsymmetricRegionPt(concentration.longs, concentration.shorts, fontPx, tight, geo.contentWidthPt);
                const total = missionOverheadPt(fontPx) + EFFRAC_H3_PT + regionPt + EFFRAC_CARD_VPAD_PT;
                if (total <= availablePt) {
                    return [
                        {
                            stack: [
                                h2(title, p, geo.contentWidthPt),
                                ...page1Head,
                                hypSectionCard(renderHypCardsAsymmetric(concentration.longs, concentration.shorts, p, tight)),
                            ],
                            fontSize: fontPx,
                        },
                    ];
                }
            }
        }
    }

    // ── d : PAGES AUTONOMES (ultime recours avant refus) ──
    //
    // Correctif revue (2026-08-10, « symptôme inverse : pages aux 3/4 vides ») :
    // le PREMIER niveau qui produit un empaquetage VALIDE n'est pas forcément
    // le plus DENSE — au palier nominal (11 px, normal), 1 seule hypothèse
    // suffit déjà à remplir le budget d'une page dédiée (empaquetage « valide »
    // dès le 1er niveau essayé), alors qu'un palier plus petit/plus resserré
    // en ferait tenir 3-4 sur la MÊME page. Le seuil de bascule vers une page
    // supplémentaire doit être « ça ne tient réellement pas », jamais « le
    // premier palier qui marche, même très en-deçà de la capacité réelle » —
    // on essaie donc TOUS les niveaux et on retient celui qui produit le
    // MOINS de pages (à égalité, le niveau le plus lisible = le premier
    // rencontré, `levels` étant trié police/densité décroissantes).
    let bestPacking: { groups: OiEffractionHypothesis[][]; fontPx: number; tight: boolean } | null = null;
    for (const { fontPx, tight } of levels) {
        const firstBudgetPt = Math.max(0, availablePt - missionOverheadPt(fontPx) - EFFRAC_H3_PT - EFFRAC_CARD_VPAD_PT);
        const restBudgetPt = Math.max(0, availablePt - EFFRAC_H2_PT - EFFRAC_H3_PT - EFFRAC_CARD_VPAD_PT);
        const groups = packHypotheses(hypotheses, (subset) => regionCostPt(subset, fontPx, tight), firstBudgetPt, restBudgetPt);
        if (groups !== null && (bestPacking === null || groups.length < bestPacking.groups.length)) {
            bestPacking = { groups, fontPx, tight };
        }
    }
    if (bestPacking !== null) {
        const { groups, fontPx, tight } = bestPacking;
        return groups.map((group, idx): Content => {
            // Correctif (dernière passe effraction, 2026-08-10) : `pushPages`
            // (document-builder.ts, convention `galleryPages()`) ne pose
            // `pageBreak:'before'` QUE sur le tout premier élément qu'on lui
            // passe — les pages SUIVANTES d'un bloc auto-cohérent doivent le
            // porter ELLES-MÊMES, sinon elles s'enchaînent SANS saut de page
            // (défaut constaté : « HYPOTHÈSES 1 » collée à la suite de
            // « MISSION & CARACTÉRISTIQUES » sur la MÊME page physique).
            if (idx === 0) {
                const body: Content[] = group.length > 0 ? [hypSectionCard(renderRegion(group, tight))] : [];
                return {
                    stack: [h2(`${title} — MISSION & CARACTÉRISTIQUES`, p, geo.contentWidthPt), ...page1Head, ...body],
                    fontSize: fontPx,
                };
            }
            return {
                stack: [
                    h2(`${title} — HYPOTHÈSES ${hypRangeLabel(group, hypotheses)}`, p, geo.contentWidthPt),
                    hypSectionCard(renderRegion(group, tight)),
                ],
                fontSize: fontPx,
                pageBreak: 'before',
            };
        });
    }

    // ── e : REFUS — même en pages autonomes, AU MOINS une hypothèse (seule
    // sur sa propre page dédiée) ne tient pas au palier plancher 7 px / densité
    // resserrée. Identifie la/les hypothèse(s) fautive(s) pour un message
    // explicite (directive : « le message de refus explique qu'une hypothèse
    // unique dépasse une page »).
    const floorLevel = useCards ? { fontPx: FIT_FONT_FLOOR, tight: true } : { fontPx: FIT_FONT_FLOOR, tight: false };
    const dedicatedPageBudgetPt = Math.max(1, availablePt - EFFRAC_H2_PT - EFFRAC_H3_PT - EFFRAC_CARD_VPAD_PT);
    const worstHyp = hypotheses.reduce((worst, h) => {
        const cost = regionCostPt([h], floorLevel.fontPx, floorLevel.tight);
        const worstCost = regionCostPt([worst], floorLevel.fontPx, floorLevel.tight);
        return cost > worstCost ? h : worst;
    }, hypotheses[0] as OiEffractionHypothesis);
    const worstCostPt = regionCostPt([worstHyp], floorLevel.fontPx, floorLevel.tight);
    ctx.fitErrors.push({
        section: title,
        details: `l'hypothèse « ${worstHyp.title} » dépasse à elle seule une page complète, même au palier plancher 7 px — réduisez son texte (technique/dégagement/assaut/description)`,
        excessRatio: worstCostPt / dedicatedPageBudgetPt - 1,
    });
    // Rendu de repli (jamais renvoyé à l'appelant : `ctx.fitErrors` non vide déclenche `OiPdfFitRefusalError` en fin de `buildOiDocDefinition`) au palier plancher, disposition uniforme.
    return [
        {
            stack: [
                h2(title, p, geo.contentWidthPt),
                ...page1Head,
                hypSectionCard(renderRegion(hypotheses, floorLevel.tight)),
            ],
            fontSize: FIT_FONT_FLOOR,
        },
    ];
}

/**
 * Boucle des blocs d'articulation groupés par index — port de
 * `pdf-engine-v2.ts:1059-1189` : `for i < max(moicp, zmspcp, effrac)`, ordre
 * interne ZMSPCP → MOICP → EFFRACTION (§3.4 règle 4). Photos « Baptême
 * Terrain » avant chaque page ZMSPCP, « Emplacement AO » après (§3.4 règle 3).
 *
 * CORRECTIF (rupture « premier bloc sans saut de page ») : le SEUL appelant
 * (`OI_PDF_SECTIONS['articulation'].build`) compose TOUJOURS ce résultat
 * `...spread` juste après `buildArticulationOverview(ctx, num)`, jamais en
 * tête de document — ce sous-bloc n'est donc JAMAIS la « toute première
 * page » au sens de `pushPage`/`pushPages` (module-level, convention
 * document ENTIER). Utiliser ces deux helpers module-level ici serait donc
 * FAUX : leur test `acc.length === 0`, évalué sur cet `acc` LOCAL à la
 * fonction, prend systématiquement le tout premier push de la boucle pour la
 * page 1 du document et lui RETIRE son `pageBreak:'before'` — quel que soit
 * le contenu qui le déclenche (page ZMSPCP/MOICP/effraction elle-même
 * quand aucune photo de galerie ne précède, ou la première page de galerie
 * sinon) — cause exacte de « S SECTEUR »/« P POINTS PARTICULIERS » écrasés
 * sous `buildArticulationOverview` en 16:9. Contrat local ci-dessous, calqué
 * sur `galleryPages()`/`buildEffractionPages` (bloc auto-cohérent composé au
 * milieu du document) mais SANS le cas particulier « premier élément » —
 * ici la toute première page du sous-bloc porte ELLE AUSSI son propre
 * `pageBreak:'before'`, inconditionnellement ; les pages SUIVANTES d'un
 * même appel `galleryPages()`/`buildEffractionPages()` le portent déjà
 * elles-mêmes (contrat d'origine, inchangé) — poussées telles quelles pour
 * ne jamais doubler le saut (page blanche).
 */
function buildArticulationBlocksLoop(ctx: BuildCtx): Content[] {
    const { formData, photosBase64, dynamicPhotos, p, geo } = ctx;
    const moicpBlocks = formData.moicp_blocks ?? [];
    const zmspcpBlocks = formData.zmspcp_blocks ?? [];
    const effracBlocks = formData.effraction_blocks ?? [];
    const maxBlocks = Math.max(moicpBlocks.length, zmspcpBlocks.length, effracBlocks.length);
    const memberToCell = buildMemberToCellMap(formData.patracdvr_rows ?? []);
    const acc: Content[] = [];
    const pushArticPage = (node: Content): void => {
        acc.push({ stack: [node], pageBreak: 'before' });
    };
    const pushArticPages = (nodes: Content[]): void => {
        nodes.forEach((node, i) => (i === 0 ? pushArticPage(node) : acc.push(node)));
    };

    for (let i = 0; i < maxBlocks; i++) {
        const zmspcp = zmspcpBlocks[i];
        if (zmspcp) {
            const bapteme = dynamicPhotos[`photo_bapteme_${zmspcp.id}`] ?? [];
            pushArticPages(galleryPages(`Baptême Terrain — ${zmspcp.title || '-'}`, bapteme, photosBase64, p, geo));
            pushArticPage(buildZmspcpPage(ctx, zmspcp, memberToCell));
            const emplAo = dynamicPhotos[`photo_empl_ao_${zmspcp.id}`] ?? [];
            pushArticPages(galleryPages(`ZMSPCP : ${zmspcp.title || '-'} (Emplacement AO)`, emplAo, photosBase64, p, geo));
        }

        const moicp = moicpBlocks[i];
        if (moicp) {
            pushArticPage(buildMoicpPage(ctx, moicp, memberToCell));
            const ext = dynamicPhotos[`photo_itin_ext_${moicp.id}`] ?? [];
            const int_ = dynamicPhotos[`photo_itin_int_${moicp.id}`] ?? [];
            pushArticPages(galleryPages(`MOICP : ${moicp.title || '-'}`, [...ext, ...int_], photosBase64, p, geo));
        }

        const effrac = effracBlocks[i];
        if (effrac) {
            pushArticPages(buildEffractionPages(ctx, effrac));
            const photos = dynamicPhotos[`photo_effrac_${effrac.id}`] ?? [];
            pushArticPages(galleryPages(`Effraction : ${effrac.title || '-'}`, photos, photosBase64, p, geo));
        }
    }
    return acc;
}

/**
 * Coût (pt) d'UNE `accentCard` À TITRE (blocks.ts) au palier `fontPx`, dans
 * une colonne de `columnWidthPt` — port du même modèle physique que
 * `cardWithTitlePt`/`textLinePt` (ci-dessus), calibré sur la géométrie
 * PROPRE à `accentCard` (conteneur interne `margin:[8,6,6,6]`, `LAYOUT_NONE`
 * — 6 pt de marge haute + 6 pt basse, JAMAIS de padding de table, à la
 * différence de `card()`/`cardWithTitlePt`) : libellé (toujours présent sur
 * les 5 cartes de `buildCatPage`) + sa marge basse 4 pt + corps + 12 pt de
 * marge verticale fixe.
 */
const CAT_CARD_TITLE_GAP_PT = 4;
const CAT_CARD_VPAD_PT = 12;
function accentCardPt(title: string, text: string, fontPx: number, columnWidthPt: number): number {
    return textLinePt(title, fontPx, columnWidthPt) + CAT_CARD_TITLE_GAP_PT + textLinePt(text, fontPx, columnWidthPt) + CAT_CARD_VPAD_PT;
}

/**
 * Section 9 — « 8. CONDUITES À TENIR GÉNÉRALES » (pdf-engine-v2.ts:1195-1216),
 * OMISE si `cat_generales`/`no_go`/`cat_liaison`/`uda`/`place_chef_dispo` sont
 * TOUS vides (§3.4 règle 1, condition exacte `:1195`, étendue aux deux
 * nouveaux champs §4 SPEC-2026-08-18-pdf-et-champs.md pour éviter qu'un OI ne
 * portant QUE l'un d'eux perde silencieusement la section).
 *
 * CORRECTIF RÉGRESSION (directive Nico « une page = un contenu, aucun
 * débordement, jamais ; aucune page vide ») : l'ajout des cartes UDA/Place
 * du Chef de Dispo (§4.1/§4.2) a fait déborder la page — AUCUN essai de
 * palier de police n'existait (`unbreakable:false` partout, même défaut que
 * `buildAdversaryModesActionPage` avant son propre correctif). Nouvelle
 * mécanique :
 * 1) essaie de tenir la disposition VALIDÉE (ligne 1 CAT/NO-GO, ligne 2
 *    UDA/Place du chef — si renseignés, Liaison en pied) sur UNE SEULE page
 *    aux paliers 11→7 (`fitUsageToPage`, MÊME patron que
 *    `buildArticulationPage`) ;
 * 2) SEULEMENT si même le palier plancher ne suffit pas (cas limite — les 5
 *    champs remplis au maximum), abandonne la disposition en grille (elle
 *    suppose systématiquement DEUX cartes côte à côte, jamais scindable
 *    proprement par carte) au profit d'un empilement PLEINE LARGEUR paginé
 *    sur des pages « <titre> — <plage de rubriques> » autonomes (jamais
 *    « (SUITE) », garde C1 ; `slotRangeLabel`, même mécanique que
 *    `buildAdversaryModesActionPage`, `packCardsByBudget`) — jamais de
 *    refus, jamais de troncature (`ctx.fitErrors` n'est jamais alimenté par
 *    cette page, directive explicite).
 */
function buildCatPage(ctx: BuildCtx, num: () => number): Content | null {
    const { formData, p, geo } = ctx;
    const cat = formData.cat_generales;
    const nogo = formData.no_go;
    const liaison = formData.cat_liaison;
    const uda = formData.uda;
    const placeChefDispo = formData.place_chef_dispo;
    if (!cat && !nogo && !liaison && !uda && !placeChefDispo) {
        return null;
    }
    // Numéro consommé ICI seulement (jamais dans le repli `null` ci-dessus) :
    // une section omise ne consomme jamais de numéro (§6 SPEC-2026-08-18-pdf-et-champs.md).
    const sectionNum = num();

    // Blindage BLIND.A : `cat_generales`/`no_go`/`cat_liaison`/`uda`/
    // `place_chef_dispo` sont des champs texte libres non bornés — filet
    // `unbreakable:false` (audit « tout unbreakable a un filet »). Cartes
    // construites une seule fois : réutilisées TELLES QUELLES par les deux
    // dispositions (grille §1, empilement §2) — jamais reconstruites par
    // palier (elles n'ont pas de `fontSize` propre, elles héritent de celui
    // posé sur le `stack` racine choisi par le solveur).
    // Ancrage direct (édition en place) : `accentCard` reçoit un `Content[]`
    // déjà composé, aucune valeur/référence isolée à lui passer (cf. JSDoc
    // `registerPdfEditAnchor`).
    registerPdfEditAnchor(ctx.anchors, fieldAnchor('cat_generales'), strOr(cat));
    registerPdfEditAnchor(ctx.anchors, fieldAnchor('no_go'), strOr(nogo));
    registerPdfEditAnchor(ctx.anchors, fieldAnchor('uda'), strOr(uda));
    registerPdfEditAnchor(ctx.anchors, fieldAnchor('place_chef_dispo'), strOr(placeChefDispo));
    registerPdfEditAnchor(ctx.anchors, fieldAnchor('cat_liaison'), strOr(liaison));
    const catCard = accentCard('CAT Générales', [{ text: strOr(cat), preserveLeadingSpaces: true }], p, 'accent', { unbreakable: false });
    const nogoCard = accentCard(
        'Conditions de Désengagement (NO-GO)',
        [{ text: strOr(nogo), color: p.danger, bold: true, preserveLeadingSpaces: true }],
        p,
        'danger',
        { unbreakable: false },
    );
    const udaCard: Content | null = uda
        ? accentCard('UDA', [{ text: strOr(uda), preserveLeadingSpaces: true }], p, 'uda', { unbreakable: false })
        : null;
    const placeChefDispoCard: Content | null = placeChefDispo
        ? accentCard('Place du Chef de Dispo', [{ text: strOr(placeChefDispo) }], p, 'accent', { unbreakable: false })
        : null;
    const liaisonCard = accentCard('Liaison', [{ text: strOr(liaison), preserveLeadingSpaces: true }], p, 'warning', { unbreakable: false });

    // UDA et Place du chef de dispo (§4.1/§4.2) sont rendus APRÈS le bloc
    // NO-GO : nouvelle ligne grid2 sous la ligne CAT Générales/NO-GO existante
    // (préserve ce pairage historique plutôt que d'y insérer l'UDA), les deux
    // nouvelles cartes posées côte à côte ENTRE ELLES (deux cartes courtes,
    // rendu plus lisible qu'empilées) quand les deux sont renseignées.
    let extraRow: Content | null = null;
    if (udaCard && placeChefDispoCard) {
        extraRow = grid2([udaCard], [placeChefDispoCard]);
    } else if (udaCard) {
        extraRow = udaCard;
    } else if (placeChefDispoCard) {
        extraRow = placeChefDispoCard;
    }

    const title = `${sectionNum}. CONDUITES À TENIR GÉNÉRALES`;
    const catColWidthPt = (geo.contentWidthPt - mm(6)) / 2;
    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;

    // 1) Disposition VALIDÉE (grille), paliers 11→7.
    const computeGridCostPt = (fontPx: number): number => {
        const row1Pt = Math.max(
            accentCardPt('CAT Générales', strOr(cat), fontPx, catColWidthPt),
            accentCardPt('Conditions de Désengagement (NO-GO)', strOr(nogo), fontPx, catColWidthPt),
        );
        const row2Pt =
            udaCard && placeChefDispoCard
                ? Math.max(
                      accentCardPt('UDA', strOr(uda), fontPx, catColWidthPt),
                      accentCardPt('Place du Chef de Dispo', strOr(placeChefDispo), fontPx, catColWidthPt),
                  )
                : udaCard
                  ? accentCardPt('UDA', strOr(uda), fontPx, geo.contentWidthPt)
                  : placeChefDispoCard
                    ? accentCardPt('Place du Chef de Dispo', strOr(placeChefDispo), fontPx, geo.contentWidthPt)
                    : 0;
        const row3Pt = accentCardPt('Liaison', strOr(liaison), fontPx, geo.contentWidthPt);
        return EFFRAC_H2_PT + row1Pt + (extraRow !== null ? STACKED_CARD_GAP_PT + row2Pt : 0) + STACKED_CARD_GAP_PT + row3Pt;
    };
    const gridFit = fitUsageToPage(computeGridCostPt, availablePt);
    if ('fontPx' in gridFit) {
        return {
            stack: [
                h2(title, p, geo.contentWidthPt),
                grid2([catCard], [nogoCard]),
                ...(extraRow !== null ? [{ text: '', margin: [0, STACKED_CARD_GAP_PT, 0, 0] } as Content, extraRow] : []),
                { text: '', margin: [0, STACKED_CARD_GAP_PT, 0, 0] },
                liaisonCard,
            ],
            fontSize: gridFit.fontPx,
        };
    }

    // 2) Cas limite : grille abandonnée, empilement pleine largeur paginé sur
    // des pages à titre distinct (jamais « (SUITE) », garde C1) — palier
    // retenu = celui qui produit le MOINS de pages (à égalité, le plus
    // lisible/premier rencontré l'emporte, `FIT_FONT_STEPS` trié
    // décroissant), même mécanique que `buildAdversaryModesActionPage`.
    const slots: Array<{ title: string; text: string; node: Content }> = [
        { title: 'CAT Générales', text: strOr(cat), node: catCard },
        { title: 'Conditions de Désengagement (NO-GO)', text: strOr(nogo), node: nogoCard },
        ...(udaCard ? [{ title: 'UDA', text: strOr(uda), node: udaCard }] : []),
        ...(placeChefDispoCard ? [{ title: 'Place du Chef de Dispo', text: strOr(placeChefDispo), node: placeChefDispoCard }] : []),
        { title: 'Liaison', text: strOr(liaison), node: liaisonCard },
    ];
    const renderSlots = (indices: number[]): Content[] => {
        const nodes = indices.map((i) => (slots[i] as (typeof slots)[number]).node);
        return nodes.flatMap((n, i) => (i === 0 ? [n] : [{ text: '', margin: [0, STACKED_CARD_GAP_PT, 0, 0] } as Content, n]));
    };
    const budgetPt = availablePt - EFFRAC_H2_PT;
    let best: { groups: number[][]; fontPx: number } | null = null;
    for (const fontPx of FIT_FONT_STEPS) {
        const costs = slots.map((s) => accentCardPt(s.title, s.text, fontPx, geo.contentWidthPt));
        const groups = packCardsByBudget(costs, budgetPt);
        if (best === null || groups.length < best.groups.length) {
            best = { groups, fontPx };
        }
    }
    const { groups, fontPx } = best as { groups: number[][]; fontPx: number };
    return {
        stack: groups.map((indices, idx): Content => {
            if (idx === 0) {
                return { stack: [h2(title, p, geo.contentWidthPt), ...renderSlots(indices)], fontSize: fontPx };
            }
            const label = slotRangeLabel(
                indices,
                slots.map((s) => s.title),
            );
            return {
                stack: [h2(`${title} — ${label}`, p, geo.contentWidthPt), ...renderSlots(indices)],
                fontSize: fontPx,
                pageBreak: 'before',
            };
        }),
    };
}

/** Texte combiné de la colonne EQPT/GREN. (`join`) — extrait pour être mesuré (coût pt) ET rendu par le MÊME code (`buildPatracPage`, anomalie E). */
function patracEqptText(m: OiPatracMember): string {
    return [m.equipement, m.equipement2, m.grenades, m.tenue, m.gpb].filter((v) => v && v !== 'Sans').join(', ') || '-';
}

/**
 * Cellules d'UNE rangée du tableau PATRACDVR — extrait pour être partagé par
 * toutes les pages de continuation à titre distinct (`buildPatracPage`,
 * anomalie E ; jamais « (SUITE) », garde C1).
 *
 * `edit` (mission « tout le texte modifiable ») ancre les 3 SEULES colonnes
 * libres — VL, PAX (trigramme), DIR : `CELLULE`/`FONCTION`/`PPALE`/`SEC.`/
 * `AFIS` restent des pastilles à choix fermé (jamais ancrées, cf. JSDoc
 * `patracMemberDatasetAnchor`) et `EQPT/GREN.` (`patracEqptText`) reste
 * exclue car AGRÉGEANT 5 champs distincts en une seule chaîne jointe — même
 * catégorie que les valeurs composées déjà exclues ailleurs (cf. JSDoc
 * `pdf-preview-edit.ts`, « PÉRIMÈTRE EXACT »).
 */
function patracRowCells(
    r: { vehicle: string; m: OiPatracMember },
    hasDir: boolean,
    p: OiPdfPalette,
    edit?: { anchors: OiPdfEditAnchor[]; vehicleUniq: Map<string, number>; trigUniq: Map<string, number> },
): TableCell[] {
    if (edit) {
        registerPdfEditAnchor(edit.anchors, patracVehicleDatasetAnchor(r.vehicle, edit.vehicleUniq), r.vehicle);
        registerPdfEditAnchor(edit.anchors, patracMemberDatasetAnchor(r.m.trigramme, 'trigramme', edit.trigUniq), r.m.trigramme);
        if (hasDir) registerPdfEditAnchor(edit.anchors, patracMemberDatasetAnchor(r.m.trigramme, 'dir', edit.trigUniq), r.m.dir);
    }
    const cells: TableCell[] = [
        { text: r.vehicle, bold: true, fillColor: r.vehicle ? p.headerRow : undefined, alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
        { text: r.m.trigramme || '-', bold: true, alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
        { text: r.m.cellule || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
        { text: r.m.fonction || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
        { text: r.m.principales || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
        { text: r.m.secondaires || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
        { text: r.m.afis || '-', alignment: 'center', noWrap: true, borderColor: cellBorder(p) },
        { text: patracEqptText(r.m), fontSize: 8, alignment: 'center', borderColor: cellBorder(p) },
    ];
    if (hasDir) {
        cells.push({ text: r.m.dir || '', bold: true, alignment: 'center', noWrap: true, borderColor: cellBorder(p) });
    }
    return cells;
}

/**
 * Coût (pt) d'UNE rangée du tableau PATRACDVR au palier `fontPx` — modèle
 * physique partagé (`EFFRAC_ROW_VPAD_PT`, `effracLinePt`). Les colonnes
 * « code court » sont `noWrap` (toujours 1 ligne, cf. JSDoc `buildPatracPage`) ;
 * seule EQPT/GREN. peut s'envelopper, à une taille FIXE 8 px (`patracRowCells`,
 * indépendante de `fontPx`) — la rangée prend donc la hauteur du plus grand
 * des deux. `eqptColWidthPt` reste une approximation (largeur RÉELLE de la
 * colonne `*` inconnue avant la mise en page pdfmake, les autres colonnes
 * étant `auto`) — direction SÛRE (sous-estimer la largeur, comme
 * `EFFRAC_FITS_SAFETY_PT`) plutôt qu'un calcul exact hors de portée d'un
 * module PUR sans pdfmake en valeur.
 */
function patracRowPt(fontPx: number, eqptText: string, eqptColWidthPt: number): number {
    const eqptLines = wrappedLinesWithNewlines(eqptText, estimateCharsPerLine(8, eqptColWidthPt));
    const linePt = Math.max(effracLinePt(fontPx), eqptLines * effracLinePt(8));
    return linePt + EFFRAC_ROW_VPAD_PT;
}

/** Coût (pt) de la rangée d'en-tête (libellés courts, toujours 1 ligne, au palier `fontPx`). */
function patracHeaderRowPt(fontPx: number): number {
    return effracLinePt(fontPx) + EFFRAC_ROW_VPAD_PT;
}

/**
 * Étiquette de plage « MEMBRES 21-40 »/« MEMBRE 21 » (1-based, position dans
 * le tableau aplati `allRows`) d'un groupe d'indices CONTIGU de
 * `packCardsByBudget` — titre autonome de page de continuation du tableau
 * PATRACDVR (jamais « (SUITE) », garde C1).
 */
function patracRangeLabel(indices: number[]): string {
    const first = (indices[0] as number) + 1;
    const last = (indices[indices.length - 1] as number) + 1;
    return first === last ? `MEMBRE ${first}` : `MEMBRES ${first}-${last}`;
}

/**
 * Section 10 — « 7. RÉCAPITULATIF PATRACDVR » (pdf-engine-v2.ts:1219-1280),
 * OMISE si aucun membre (§3.4 règle 1, condition `:1224`). Nos 8/9 colonnes
 * (PAS les 12 de strategica) ; colonne DIR seulement si ≥1 membre a un `dir`
 * non vide (`:1227`).
 *
 * CORRECTIF ANOMALIE E (campagne de mesure 2026-08-18) : `patracFontPx`
 * réduisait la police par PALIERS DE NOMBRE DE LIGNES sans jamais calculer
 * de budget de hauteur réel — mesuré : 60 membres ⇒ table sur 3 pages
 * physiques, AUCUNE ne portant le titre (seul `headerRows:1` faisait filet).
 * Stratégie retenue : MULTI-PAGE ASSUMÉ plutôt qu'un budget de hauteur à
 * police dégressive sur une page unique — à ~22 pt/rangée même au palier
 * plancher 7 px, une seule page ne peut physiquement contenir qu'environ
 * 20-22 rangées (A4) avant de heurter `contentHeightPt` (541/485 pt),
 * largement en-deçà d'unités réelles de plusieurs dizaines de membres.
 * 1) essaie D'ABORD la table ENTIÈRE sur UNE SEULE page, paliers 11→7
 * (`fitUsageToPage`, remplace `patracFontPx`) — couvre les unités réalistes ;
 * 2) SEULEMENT si même le palier plancher ne suffit pas, pagine par budget
 * de hauteur réel (`packCardsByBudget`, réserve la place de l'en-tête —
 * répété sur CHAQUE page, `headerRows:1` par table) sur des pages
 * « RÉCAPITULATIF PATRACDVR — MEMBRES <plage> » (`patracRangeLabel`) —
 * chaque page porte SON TITRE distinct (jamais « (SUITE) », garde C1 ;
 * règle Nico « une page = un contenu »), aucune ligne omise ni tronquée.
 */
function buildPatracPage(ctx: BuildCtx, num: () => number): Content | null {
    const { formData, p, geo, anchors } = ctx;
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
    // Numéro consommé ICI seulement — jamais dans le repli `null` ci-dessus
    // (§6 SPEC-2026-08-18-pdf-et-champs.md, section omise = pas de numéro).
    const sectionNum = num();
    const title = `${sectionNum}. RÉCAPITULATIF PATRACDVR`;

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
    // Édition en place (mission « tout le texte modifiable ») — cf. JSDoc `patracRowCells`.
    const editCtx = { anchors, vehicleUniq: countPatracVehicleNames(formData), trigUniq: countPatracTrigrammes(formData) };
    const renderTable = (subset: Array<{ vehicle: string; m: OiPatracMember }>): Content => ({
        table: { widths, headerRows: 1, body: [headerRow, ...subset.map((r) => patracRowCells(r, hasDir, p, editCtx))] },
        layout: LAYOUT_BORDERED,
    });

    // Approximation SÛRE (direction : sous-estimer) de la largeur réelle de la
    // seule colonne à largeur `*`, cf. JSDoc `patracRowPt`.
    const eqptColWidthPt = geo.contentWidthPt * 0.3;
    const availablePt = geo.contentHeightPt - EFFRAC_FITS_SAFETY_PT;

    // 1) UNE SEULE page, paliers 11→7 (budget de hauteur réel).
    const computeCostPt = (fontPx: number): number =>
        EFFRAC_H2_PT +
        patracHeaderRowPt(fontPx) +
        allRows.reduce((sum, r) => sum + patracRowPt(fontPx, patracEqptText(r.m), eqptColWidthPt), 0);
    const fit = fitUsageToPage(computeCostPt, availablePt);
    if ('fontPx' in fit) {
        return { stack: [h2(title, p, geo.contentWidthPt), renderTable(allRows)], fontSize: fit.fontPx };
    }

    // 2) Multi-page assumé (cf. JSDoc de fonction) : chaque page répète l'en-tête
    // de colonnes ET porte son titre — jamais de refus, jamais de perte de ligne.
    const budgetPt = availablePt - EFFRAC_H2_PT;
    let best: { groups: number[][]; fontPx: number } | null = null;
    for (const fontPx of FIT_FONT_STEPS) {
        const rowBudgetPt = budgetPt - patracHeaderRowPt(fontPx);
        const costs = allRows.map((r) => patracRowPt(fontPx, patracEqptText(r.m), eqptColWidthPt));
        const groups = packCardsByBudget(costs, rowBudgetPt);
        if (best === null || groups.length < best.groups.length) {
            best = { groups, fontPx };
        }
    }
    const { groups, fontPx } = best as { groups: number[][]; fontPx: number };
    return {
        stack: groups.map((indices, idx): Content => {
            const subset = indices.map((i) => allRows[i] as (typeof allRows)[number]);
            if (idx === 0) {
                return { stack: [h2(title, p, geo.contentWidthPt), renderTable(subset)], fontSize: fontPx };
            }
            return {
                stack: [h2(`${title} — ${patracRangeLabel(indices)}`, p, geo.contentWidthPt), renderTable(subset)],
                fontSize: fontPx,
                pageBreak: 'before',
            };
        }),
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

/** Réexports du modèle de refus fit-to-page (theme.ts) — commodité d'import côté `engine-v3.ts`/tests, une seule vérité (mission P1). */
export type { OiPdfFitError };
export { OiPdfFitRefusalError };

/**
 * Capacités calibrées par champ/section (mission P1, directive Nico
 * 2026-08-10 : « exporte les CAPACITÉS calibrées par champ/section… la
 * tranche P3 (compteurs UI) les consommera. Calcule-les depuis le même
 * modèle de coût (une seule vérité) »). Dérivées du MÊME modèle physique (pt,
 * `PDF_LINE_ADVANCE_EM`/`estimateCharsPerLine`) que les solveurs
 * `fitUsageToPage` ci-dessus — approximations (même philosophie que le reste
 * de ce module PUR : aucune mesure de rendu réelle possible ici), au palier
 * de police demandé par l'appelant (P3 pourra ainsi afficher « il vous reste
 * N caractères au palier actuel » pendant la saisie).
 */
export const PAGE_CAPACITY = {
    /**
     * Nombre max de caractères ATCD tenant sur la fiche adversaire au palier
     * `fontPx`, colonne droite, APRÈS réservation de LOCALISATION/MOBILITÉ
     * (approximées à leur coût maximal — capacité MINORÉE, jamais surestimée :
     * direction sûre pour un compteur UI, mieux vaut prévenir tôt qu'annoncer
     * une marge qui n'existe pas réellement).
     */
    adversaireAtcdMaxChars(fontPx: number, geo: ReturnType<typeof pageGeometry> = pageGeometry('a4')): number {
        const columnWidthPt = (geo.contentWidthPt - mm(6)) / 2;
        const cpl = estimateCharsPerLine(fontPx, columnWidthPt);
        const reservedPt = ADV_TITLE_BAR_PT + 3 * cardWithTitlePt(2 * effracLinePt(fontPx));
        const availableLines = Math.max(0, Math.floor((geo.contentHeightPt - reservedPt) / effracLinePt(fontPx)));
        return availableLines * cpl;
    },
    /** Nombre max de caractères du champ « C conduite à tenir » tenant sur une page ZMSPCP/MOICP au palier `fontPx` (colonne gauche, après réservation des 4 champs cœur + h3). */
    articulationCatMaxChars(fontPx: number, geo: ReturnType<typeof pageGeometry> = pageGeometry('a4')): number {
        const columnWidthPt = (geo.contentWidthPt - mm(6)) / 2;
        const cpl = estimateCharsPerLine(fontPx, columnWidthPt);
        const reservedPt = EFFRAC_H2_PT + EFFRAC_H3_PT + 4 * effracLinePt(fontPx);
        const availableLines = Math.max(0, Math.floor((geo.contentHeightPt - reservedPt) / effracLinePt(fontPx)));
        return availableLines * cpl;
    },
    /** Nombre max d'hypothèses d'effraction rendues en CARTES (au-delà, repli automatique sur la table dense — jamais de refus pour ce seul motif). */
    effractionHypothesesCardsMax(): number {
        return EFFRAC_HYP_CARDS_MAX;
    },
};

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
 * Correctif D4 (gate ROUND0, poids du PDF) — INTERNEMENT des images : pdfmake
 * (`DocMeasure.convertIfBase64Image`) attribue un label `$$pdfmake$$<n>`
 * FRAIS à chaque NŒUD `image:` portant une dataURL inline — deux usages de la
 * MÊME photo (ex. porte d'effraction : bandeau `buildEffractionPages` + page
 * détail `galleryPages`) étaient donc embarqués en DEUX objets PDF distincts
 * (mesuré : 2 × 2074 K = 82 % du poids de `cas-reel-01`). Le dictionnaire
 * `images` de la docDefinition, lui, est résolu par CLÉ
 * (`PDFDocument.provideImage` : `_imageRegistry[src]`, un seul `embed` par
 * clé) : chaque photo est donc référencée par son ID, la dataURL ne vivant
 * qu'UNE fois dans `images`. Deux IDs portant une dataURL IDENTIQUE sont de
 * surcroît fusionnés sur la première clé rencontrée (dédup par CONTENU).
 * Les valeurs vides restent telles quelles (les gardes `figure('')`/
 * `photosBase64[id] === undefined` en aval conservent leur sémantique).
 */
export function internPhotoImages(photosBase64: Record<string, string>): {
    photoRefs: Record<string, string>;
    images: Record<string, string>;
} {
    const keyByDataUrl = new Map<string, string>();
    const images: Record<string, string> = {};
    const photoRefs: Record<string, string> = {};
    for (const [id, dataUrl] of Object.entries(photosBase64)) {
        if (!dataUrl) {
            photoRefs[id] = dataUrl;
            continue;
        }
        const existing = keyByDataUrl.get(dataUrl);
        if (existing !== undefined) {
            photoRefs[id] = existing;
        } else {
            keyByDataUrl.set(dataUrl, id);
            images[id] = dataUrl;
            photoRefs[id] = id;
        }
    }
    return { photoRefs, images };
}

/**
 * Compteur de numéro de section PARTAGÉ (§6 SPEC-2026-08-18-pdf-et-champs.md)
 * — chaque section NUMÉROTÉE appelle `next()` UNE SEULE FOIS, juste avant de
 * composer son `h2`, et SEULEMENT une fois établi qu'elle n'est PAS omise
 * (jamais dans un repli `null`/tableau vide en amont) : une section absente
 * ne consomme donc jamais de numéro, et la numérotation reste CONTINUE quel
 * que soit l'ordre effectif des sections (`resolveOiPdfSectionOrder`
 * ci-dessous). Baseline documentée sur `OI_PDF_SECTIONS`.
 */
function makeSectionNumberer(start: number): () => number {
    let n = start;
    return () => n++;
}

/**
 * Descripteur d'une section RÉORDONNABLE du registre `OI_PDF_SECTIONS`.
 * `title` est le libellé NU (SANS numéro) — le numéro est calculé à la
 * composition (`makeSectionNumberer`), jamais codé en dur dans un `h2()`.
 * `build` retourne les pages de la section, ÉVENTUELLEMENT VIDES (section
 * omise, cf. `pushPages` : un tableau vide ne pousse rien et ne casse pas le
 * `pageBreak:'before'` de la section suivante).
 */
interface OiPdfSectionDef {
    id: string;
    title: string;
    build(ctx: BuildCtx, num: () => number): Content[];
}

/**
 * Registre déclaratif des sections RÉORDONNABLES du PDF OI (§1/§2/§6
 * SPEC-2026-08-18-pdf-et-champs.md) — remplace l'ancienne suite d'appels
 * impératifs de `buildOiDocDefinition` (`pushPage`/`pushPages` en cascade) :
 * l'assemblage devient une boucle sur `resolveOiPdfSectionOrder(...)`.
 *
 * La page de garde (`buildCover`) reste HORS registre, verrouillée par
 * construction : toujours rendue en PREMIER, en dehors de toute
 * réconciliation d'ordre (jamais numérotée, jamais réordonnée).
 *
 * `'adversaires'` (`OI_PDF_LOCKED_SECTION_ID`) EST dans le registre (son
 * libellé alimente l'IHM de réordonnancement, `pdf-section-order.ts`) mais
 * reste VERROUILLÉE EN POSITION juste après la garde — exclue du
 * glisser-déposer/boutons de cette IHM ET épinglée en tête par
 * `resolveOiPdfSectionOrder` ci-dessous, quel que soit l'ordre persisté.
 * Choix retenu (§2 SPEC-2026-08-18-pdf-et-champs.md, limite connue
 * documentée) plutôt qu'une numérotation dérivée : la section porte SA
 * PROPRE numérotation fixe « 2.<index> » (`buildAdversaryFiche`, fichier
 * verrouillé pour ce chantier — un autre agent y insère en parallèle les
 * pages « Modes d'action ») et ignore délibérément le compteur `num` ;
 * rendre cette numérotation dérivée aurait exigé de toucher ce builder, hors
 * périmètre autorisé. La baseline de `makeSectionNumberer` (3, cf.
 * `buildOiDocDefinition`) réserve ainsi les slots 1 (garde, non numérotée)
 * et 2 (adversaires, numérotation fixe hors compteur) avant que les sections
 * DÉRIVÉES ci-dessous ne commencent à 3 — reproduit exactement la
 * numérotation historique par défaut, quel que soit l'ordre choisi pour les
 * AUTRES sections.
 */
const OI_PDF_SECTIONS: OiPdfSectionDef[] = [
    { id: 'adversaires', title: 'Adversaires', build: (ctx) => buildAdversaryPages(ctx) },
    { id: 'environnement', title: 'Environnement et amis', build: (ctx, num) => [buildEnvironnement(ctx, num)] },
    {
        id: 'transport',
        title: 'Transport',
        build: (ctx, num) => {
            const { dynamicPhotos, photosBase64, p, geo } = ctx;
            const photos = transportPhotos(dynamicPhotos);
            // Même condition d'omission que `galleryPages()` (résolu = 0 photo)
            // — vérifiée EN AMONT pour ne consommer un numéro que si la section
            // sera bien rendue (§6 : section omise = pas de numéro).
            if (!photos.some((meta) => photosBase64[meta.id] !== undefined)) {
                return [];
            }
            return galleryPages(`${num()}. TRANSPORT`, photos, photosBase64, p, geo);
        },
    },
    { id: 'mission-execution', title: "Mission de l'unité / Exécution", build: (ctx, num) => buildMissionExecutionPages(ctx, num) },
    {
        id: 'articulation',
        title: 'Articulation & ordres de mouvement',
        build: (ctx, num) => [buildArticulationOverview(ctx, num), ...buildArticulationBlocksLoop(ctx)],
    },
    {
        id: 'cat',
        title: 'Conduites à tenir générales',
        build: (ctx, num) => {
            const page = buildCatPage(ctx, num);
            return page !== null ? [page] : [];
        },
    },
    {
        id: 'patracdvr',
        title: 'Récapitulatif PATRACDVR',
        build: (ctx, num) => {
            const page = buildPatracPage(ctx, num);
            return page !== null ? [page] : [];
        },
    },
    { id: 'final', title: 'Page finale', build: (ctx) => [buildFinalPage(ctx)] },
];

/** Ordre par défaut des sections réordonnables (ids `OI_PDF_SECTIONS`, dans l'ordre) — `'transport'` déplacée juste après `'environnement'` (§5 SPEC-2026-08-18-pdf-et-champs.md). Exporté pour l'IHM de réordonnancement (`pdf-section-order.ts` — repli/réinitialisation). */
export const OI_PDF_DEFAULT_SECTION_ORDER: string[] = OI_PDF_SECTIONS.map((s) => s.id);

/** Libellés humains NUS par id de section — affichés par l'IHM de réordonnancement (`pdf-section-order.ts`). */
export const OI_PDF_SECTION_LABELS: Record<string, string> = Object.fromEntries(OI_PDF_SECTIONS.map((s) => [s.id, s.title]));

/**
 * Id de la section verrouillée en position, juste après la garde (cf. JSDoc
 * `OI_PDF_SECTIONS`) — `'adversaires'` porte sa propre numérotation fixe
 * « 2.<index> » (`buildAdversaryFiche`) qui suppose ce créneau. Exportée
 * pour que l'IHM de réordonnancement (`pdf-section-order.ts`) l'exclue du
 * glisser-déposer/boutons monter-descendre.
 */
export const OI_PDF_LOCKED_SECTION_ID = 'adversaires';

/**
 * Réconcilie l'ordre PERSISTÉ (`formData.pdf_section_order`) avec le registre
 * (§2 SPEC-2026-08-18-pdf-et-champs.md) : les ids persistés d'abord, DANS
 * LEUR ORDRE (dédupliqués, ids inconnus du registre ignorés), puis les ids
 * par défaut ABSENTS de cette liste, dans leur ordre par défaut mutuel — un
 * id inconnu ou une liste PARTIELLE (voire absente) ne fait donc JAMAIS
 * disparaître ni dupliquer une section. `OI_PDF_LOCKED_SECTION_ID` est
 * ENSUITE ÉPINGLÉ en première position quel que soit l'ordre persisté —
 * défense en profondeur : l'IHM ne le propose jamais au réordonnancement,
 * mais un `pdf_section_order` corrompu/écrit à la main ne doit jamais faire
 * dériver sa numérotation fixe (cf. JSDoc `OI_PDF_SECTIONS`).
 */
export function resolveOiPdfSectionOrder(persisted?: string[] | undefined): string[] {
    const known = new Set(OI_PDF_DEFAULT_SECTION_ORDER);
    const seen = new Set<string>();
    const order: string[] = [];
    for (const id of persisted ?? []) {
        if (known.has(id) && !seen.has(id)) {
            order.push(id);
            seen.add(id);
        }
    }
    for (const id of OI_PDF_DEFAULT_SECTION_ORDER) {
        if (!seen.has(id)) {
            order.push(id);
        }
    }
    const lockedIdx = order.indexOf(OI_PDF_LOCKED_SECTION_ID);
    if (lockedIdx > 0) {
        order.splice(lockedIdx, 1);
        order.unshift(OI_PDF_LOCKED_SECTION_ID);
    }
    return order;
}

/**
 * Construit la `TDocumentDefinitions` complète des 14 sections de l'OI, dans
 * l'ordre imposé par SPEC-PDF-V3.md §3.2 (par défaut — réordonnable depuis
 * `formData.pdf_section_order`, cf. `resolveOiPdfSectionOrder`/
 * `OI_PDF_SECTIONS` ci-dessus, §2 SPEC-2026-08-18-pdf-et-champs.md). Port de
 * `pdf-engine-v2.ts:608-1304` (`generateHTML`) — structure/replis/omissions
 * identiques, langage visuel `blocks.ts`/`theme.ts` (strategica).
 */
/**
 * `TDocumentDefinitions` ADDITIVEMENT enrichi de `pdfEditAnchors` (édition en
 * place, mission « régression édition ») — sur-ensemble STRICT du type
 * attendu par `engine-v3.ts::buildOiPdfBlob`/`pdfMake.createPdf` (assignable
 * à `TDocumentDefinitions` sans changement côté appelant, propriété EXTRA
 * simplement ignorée par pdfmake) : évite d'exposer un second point d'entrée
 * dupliquant toute la construction de `ctx`/`pages` (`engine-v3.ts` est HORS
 * périmètre de cette mission) — `pdf-engine-v2.ts` appelle CETTE MÊME
 * fonction séparément (side-effect-free, résultat PDF jeté) pour récupérer
 * `pdfEditAnchors` avant de peindre l'aperçu.
 */
export interface OiPdfDocDefinitionWithAnchors extends TDocumentDefinitions {
    pdfEditAnchors: OiPdfEditAnchor[];
}

export function buildOiDocDefinition(data: OiPdfCollectedData, opts: { format: OiPdfFormat }): OiPdfDocDefinitionWithAnchors {
    const { formData, isDark } = data;
    const p = palette(isDark);
    const geo = pageGeometry(opts.format);
    const dynamicPhotos = formData.dynamic_photos ?? {};
    const volume = documentVolume(formData);
    const baseFontSize = documentFontPx(volume);
    // D4 : en aval de cette ligne, « photosBase64 » ne porte plus les dataURL
    // mais des CLÉS du dictionnaire `images` ci-dessous — mêmes IDs, mêmes
    // tests de présence (`!== undefined`), `figure()`/`image:` reçoivent la
    // clé et pdfmake n'embarque chaque image qu'UNE seule fois.
    const { photoRefs: photosBase64, images } = internPhotoImages(data.photosBase64);

    const fitErrors: OiPdfFitError[] = [];
    const anchors: OiPdfEditAnchor[] = [];
    const ctx: BuildCtx = {
        formData,
        photosBase64,
        dynamicPhotos,
        p,
        geo,
        is169: opts.format === '16:9',
        baseFontSize,
        fitErrors,
        anchors,
    };

    const pages: Content[] = [];
    // Page de garde : verrouillée en première position, HORS registre —
    // jamais numérotée, jamais réordonnée (cf. JSDoc `OI_PDF_SECTIONS`).
    // `buildCover` renvoie désormais 1..N pages (couverture + pages « CIBLES(S)
    // — <plage> » de débordement au-delà du seuil de la page 1, cf. sa JSDoc) —
    // `pushPages` (même contrat que `galleryPages()`) pose le saut de page sur
    // la 1re SEULEMENT, les suivantes portent déjà le leur.
    pushPages(pages, buildCover(ctx));
    // Baseline 3 : slots 1 (garde) et 2 (adversaires, numérotation fixe
    // « 2.<index> » hors compteur) réservés — cf. JSDoc `OI_PDF_SECTIONS`.
    const num = makeSectionNumberer(3);
    const sectionOrder = resolveOiPdfSectionOrder(formData.pdf_section_order);
    for (const id of sectionOrder) {
        const section = OI_PDF_SECTIONS.find((s) => s.id === id);
        if (section) {
            pushPages(pages, section.build(ctx, num));
        }
    }

    // MISSION P1 (directive Nico 2026-08-10) — REFUS DE GÉNÉRATION explicite :
    // si AU MOINS un usage (fiche adversaire, bloc ZMSPCP/MOICP, cellule
    // effraction) ne tient pas sur sa page unique même au palier plancher
    // 7 px, le document COMPLET est refusé (jamais de PDF partiel/tronqué
    // renvoyé à l'appelant) — `fitErrors` liste TOUTES les sections en
    // dépassement, remontée par `engine-v3.ts`/affichée par `main.ts`.
    if (fitErrors.length > 0) {
        throw new OiPdfFitRefusalError(fitErrors);
    }

    return {
        content: pages,
        // D4 : dictionnaire d'images par CLÉ — une seule incorporation par
        // image, quel que soit le nombre de nœuds qui la référencent.
        images,
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
        // Édition en place (mission « régression édition ») — cf. JSDoc
        // `OiPdfDocDefinitionWithAnchors`. Ordre d'émission PRÉSERVÉ tel quel
        // (`ctx.anchors`, jamais trié/dédupliqué ici) : `pdf-preview-edit.ts`
        // en dépend pour désambiguïser les valeurs partagées par 2+ champs.
        pdfEditAnchors: anchors,
    };
}
