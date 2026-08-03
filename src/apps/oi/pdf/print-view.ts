/**
 * print-view.ts — Document HTML autonome d'impression de l'OI (voie B,
 * SPEC-PDF-V3.md §2.1/§3.2/§5.3, paquet P5 « pdf-p5-print-view »).
 *
 * `buildPrintDocument()` reproduit LES 14 SECTIONS ACTUELLES de l'OI, dans
 * leur ordre actuel, mêmes titres/replis/omissions que
 * `src/apps/oi/pdf-engine-v2.ts:817-1294` (`generateHTML`) — la STRUCTURE
 * reste la nôtre ; seul le LANGAGE VISUEL (classes CSS) vient de strategica
 * (`print-style.ts`, port de `OrderPdfStyle.kt`).
 *
 * RÈGLE DE SÉCURITÉ ABSOLUE : contrairement à `generateHTML` (dont le risque
 * XSS théorique est documenté et assumé, `pdf-engine-v2.ts:22-25`), CE module
 * échappe SYSTÉMATIQUEMENT toute valeur issue du Store via `esc()`/`nl2br()`
 * (directement ou via les helpers locaux `escOr`/`nl2brOr`/`fieldOr`, et via
 * le `field()` réexporté par `print-style.ts`). Les SEULES chaînes non
 * échappées autorisées sont : les data-URL d'images (attribut `src`, déjà
 * base64 pur produit par `blobToBase64()`) et le CSS (`printCss()`).
 * Les titres de section STATIQUES (ex. « 7. ARTICULATION & ORDRES DE
 * MOUVEMENT ») sont des littéraux du code, pas des valeurs du Store : ils ne
 * passent PAS par `esc()` (qui transformerait leur « & » littéral en
 * `&amp;`) — seules les portions dynamiques qui s'y insèrent (nom
 * d'adversaire, titre de bloc…) sont échappées avant interpolation, exactement
 * comme `section()`/`OrderPdfStyle.kt` ne ré-échappent jamais un titre déjà
 * composé par l'appelant.
 */
import type {
    OiAdversary,
    OiEffractionBlock,
    OiFormData,
    OiMoicpBlock,
    OiPatracMember,
    OiPatracRow,
    OiPdfCollectedData,
    OiPhotoMeta,
    OiZmspcpBlock,
} from '@shared/types/contracts.js';
import { fontFacesCss } from './fonts.js';
import { esc, field, nl2br, printCss, section } from './print-style.js';
import {
    adaptivePagePx,
    catItemsPerPageBudget,
    documentFontPx,
    estimateCharsPerLine,
    estimateWrappedLines,
    mm,
    palette,
    pageGeometry,
    patracFontPx,
    type OiPdfFormat,
    type OiPdfPalette,
} from './theme.js';

/* ==========================================================================
 * Helpers locaux (non exportés — logique propre à CE document, distincte des
 * helpers génériques réexportés par print-style.ts).
 * ======================================================================== */

/** `value || fallback`, MAIS après conversion sûre (`null`/`undefined` -> fallback,
 * chaîne blanche -> fallback) — port du motif `formData.x || '-'` omniprésent
 * dans `pdf-engine-v2.ts` (jamais d'omission de ligne, contrairement à `field()`). */
function textOr(value: unknown, fallback = '-'): string {
    if (value == null) return fallback;
    const s = String(value);
    return s.trim() === '' ? fallback : s;
}

function isBlank(value: unknown): boolean {
    return textOr(value, '') === '';
}

/** `esc(textOr(value, fallback))` — champ toujours affiché, une seule ligne. */
function escOr(value: unknown, fallback = '-'): string {
    return esc(textOr(value, fallback));
}

/** `nl2br(textOr(value, fallback))` — champ toujours affiché, multi-ligne. */
function nl2brOr(value: unknown, fallback = '-'): string {
    return nl2br(textOr(value, fallback));
}

/**
 * Paragraphe label/valeur TOUJOURS affiché (repli `-`), à la différence du
 * `field()` réexporté (qui OMET la ligne si la valeur est vide) — la plupart
 * des champs de `pdf-engine-v2.ts` suivent ce second motif (`|| '-'`, jamais
 * omis), rule de fidélité §3.4.2 de SPEC-PDF-V3.md.
 */
function fieldOr(label: string, value: unknown, fallback = '-'): string {
    return `<p><strong>${esc(label)} :</strong> ${nl2brOr(value, fallback)}</p>`;
}

/** Ligne de table `.k` (label/valeur) — [value] est déjà passé au travers de `textOr`. */
function kvRow(label: string, value: string): string {
    return `<tr><td class="k">${esc(label)}</td><td>${nl2br(value)}</td></tr>`;
}

/** Liste de pastilles numérotées (`.pill`), repli `-` si la liste est vide —
 * port de `pdf-engine-v2.ts:1046-1054` (Ordre Rame VL / Colonne / Pénétration). */
function pillList(items: string[]): string {
    if (items.length === 0) return '-';
    return items.map((item, i) => `<span class="pill"><b>${i + 1}</b> ${esc(item)}</span>`).join(' ');
}

/** JSON tolérant `string[]` — port de `safeJsonParse` (`pdf-engine-v2.ts:52-61`). */
function parseTools(json: string): string[] {
    if (!json) return [];
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

/** Mapping trigramme -> cellule, construit depuis `patracdvr_rows` — port de
 * `pdf-engine-v2.ts:779-784` (`memberToCell`). */
function buildMemberToCellMap(rows: OiPatracRow[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of rows) {
        for (const m of row.members) {
            if (m.trigramme) map.set(m.trigramme, m.cellule || 'NON ASSIGNÉ');
        }
    }
    return map;
}

/** Regroupement de trigrammes par cellule — port de `pdf-engine-v2.ts:787-798`
 * (`regroupByCell`), rendu en `.cell-group`/`.cell-name`/`.cell-members`. */
function cellGroupsHtml(trigrammes: string[], memberToCell: Map<string, string>): string {
    const groups = new Map<string, string[]>();
    for (const t of trigrammes) {
        const cell = memberToCell.get(t) || 'SANS CELLULE';
        const list = groups.get(cell);
        if (list) list.push(t);
        else groups.set(cell, [t]);
    }
    let html = '';
    for (const [cell, members] of groups) {
        html +=
            `<div class="cell-group"><div class="cell-name">${esc(cell)}</div>` +
            `<div class="cell-members">${members.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}</div></div>`;
    }
    return html;
}

/**
 * Galeries photo — 2 photos MAX par page (écart assumé E4, SPEC-PDF-V3.md §7),
 * titre suffixé « (suite) » au-delà de la 1re page, port de
 * `pdf-engine-v2.ts:858-891` (`renderGallery`) en classes strategica.
 * [title] est un fragment déjà composé par l'appelant : les portions issues du
 * Store qu'il contient doivent être PRÉ-échappées par l'appelant (même
 * convention que `section()`) — [title] n'est PAS ré-échappé ici, pour ne pas
 * transformer les libellés statiques (ex. « 6. LOGISTIQUE & TRANSPORTS »).
 * `OiPhotoMeta` ne porte pas de largeur/hauteur (contrairement à l'`OrderPhoto`
 * de strategica) : faute de pouvoir détecter l'orientation, on retombe
 * systématiquement sur l'axe colonnes — exactement le repli strategica pour
 * une photo de dimensions inconnues (`OrderHtmlPhotos.kt:84-87`).
 */
function galleryPages(title: string, photos: OiPhotoMeta[], photosBase64: Record<string, string>): string {
    if (photos.length === 0) return '';
    const chunks: OiPhotoMeta[][] = [];
    for (let i = 0; i < photos.length; i += 2) chunks.push(photos.slice(i, i + 2));

    return chunks
        .map((chunk, i) => {
            const heading = i === 0 ? title : `${title} (suite)`;
            const figs = chunk
                .map((meta) => {
                    const src = photosBase64[meta.id] ?? '';
                    const tools = parseTools(meta.tools);
                    const caption = textOr(meta.customTitle, `${title} - Détail`);
                    const badges = [
                        ...tools.map((t) => `<span class="tool-badge">${esc(t)}</span>`),
                        ...(meta.other_tools ? [`<span class="tool-badge">${esc(meta.other_tools)}</span>`] : []),
                    ].join(' ');
                    return (
                        `<div class="page-fig">` +
                        `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;gap:4px;">` +
                        `<img src="${src}" style="max-width:100%;max-height:80%;width:auto;height:auto;object-fit:contain;"/>` +
                        `<div class="photo-caption">${esc(caption)}</div>` +
                        (badges ? `<div class="gallery">${badges}</div>` : '') +
                        `</div></div>`
                    );
                })
                .join('');
            return `<div class="adv-page"><h2>${heading}</h2><div class="photo-page-gallery photo-cols">${figs}</div></div>`;
        })
        .join('');
}

/** Volume total du document — port verbatim du barème `fontPx()` de
 * `OrderHtml.kt:86-97` (situation générale/particulière, missions, action,
 * missions MOICP/ZMSPCP), consommé par `theme.ts::documentFontPx()`. */
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
 * SCISSION PILOTÉE (mission BLIND.B, arbitrages 1/4) — transposition du
 * modèle voie A (`document-builder.ts::splitAtDashBoundaries`/
 * `chunkItemsByCost`, mission PG.IMPL/PG.REFIX, LECTURE SEULE, jamais
 * importé : fichier interdit à cette mission) pour la voie B. Contrairement
 * à la voie A, la voie B ne PERD jamais de donnée même sans ce mécanisme
 * (débordement CSS non maîtrisé plutôt qu'une suppression silencieuse,
 * cf. `regles-strategica.md` R11/R16) — cette scission sert donc à
 * ÉLIMINER LES QUEUES ORPHELINES SANS TITRE (matrice-rupture.md §1, pages
 * 7/9 de `long-case.json`), pas à éviter une perte de données : chaque
 * fragment issu de la scission reste un `.adv-page` isolé (saut avant ET
 * après, `print-style.ts:140`), donc même un fragment qui déborderait
 * encore sa propre page resterait entièrement visible quelque part dans
 * le flux imprimé (aucune classe `unbreakable`/`avoid` n'entoure jamais un
 * bloc de la taille d'une page entière dans ce module).
 * ======================================================================== */

/**
 * Découpe un texte en items aux frontières légitimes UNIQUEMENT — entre deux
 * tirets de liste (`\n- item`), jamais en milieu de phrase. Sans tiret
 * détecté, renvoie le texte INTACT en un seul élément : ce module ne scinde
 * alors JAMAIS ce bloc (un débordement CSS non piloté reste préférable à une
 * coupure arbitraire au milieu d'une phrase — même règle cible que la voie A).
 */
function splitAtDashBoundaries(text: string): string[] {
    if (!text) return [];
    const parts = text
        .split(/\n(?=-\s)/)
        .map((s) => s.trim())
        .filter((s) => s !== '');
    return parts.length > 1 ? parts : [text];
}

/**
 * Découpe `items` en tranches dont le COÛT CUMULÉ (`cost(item)`, lignes
 * réellement rendues via `estimateWrappedLines`) ne dépasse pas `budget` —
 * jamais À L'INTÉRIEUR d'un item (frontière légitime uniquement ; un item qui
 * dépasse `budget` à lui seul reste seul dans sa tranche). `budgets.first`/
 * `.rest` <= 0 -> une seule tranche, jamais de boucle infinie.
 */
function chunkItemsByCost<T>(items: T[], cost: (item: T) => number, budgets: { first: number; rest: number }): T[][] {
    if (budgets.first <= 0 && budgets.rest <= 0) return [items];
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
    if (current.length > 0) chunks.push(current);
    return chunks.length > 0 ? chunks : [items];
}

/** Hauteur utile de contenu (pt) du format 'a4' — référence d'échelle du budget
 * `catItemsPerPageBudget`, calibré à l'origine sur ce format (même raison que
 * son homologue voie A, `document-builder.ts::A4_CONTENT_HEIGHT_PT`). */
const A4_CONTENT_HEIGHT_PT = pageGeometry('a4').contentHeightPt;

/** `<li>` d'items à tiret, échappés/multi-lignes (`nl2br`). */
function dashItemsHtml(items: string[]): string {
    return `<ul>${items.map((item) => `<li>${nl2br(item)}</li>`).join('')}</ul>`;
}

/**
 * Rendu commun ZMSPCP/MOICP avec SCISSION PILOTÉE du champ « C conduite à
 * tenir » (mission BLIND.B §1) — port du modèle `buildArticulationCorePages`
 * (voie A, `document-builder.ts:786-862`, LECTURE SEULE) adapté à HTML/CSS :
 * chaque fragment est un `.adv-page` isolé (saut avant/après natif CSS) au
 * lieu d'un `stack`+`pageBreak:'before'` pdfmake. Police adaptative
 * (`adaptivePagePx`, arbitrage 4) calculée par l'appelant, partagée par TOUS
 * les fragments du bloc (un seul palier par bloc, comme la voie A).
 */
function articulationBlockPages(opts: {
    title: string;
    sectionLabel: string;
    coreFields: Array<[string, string]>;
    catLabel: string;
    catText: string;
    cellsHtml: string;
    placeChefHtml: string;
    fontPx: number;
    format: OiPdfFormat;
}): string {
    const { title, sectionLabel, coreFields, catLabel, catText, cellsHtml, placeChefHtml, fontPx, format } = opts;
    const catItems = splitAtDashBoundaries(catText || '-');
    const hasBoundary = catItems.length > 1;

    const geo = pageGeometry(format);
    const catColumnWidthPt = (geo.contentWidthPt - mm(6)) / 2;
    const catCharsPerLine = estimateCharsPerLine(fontPx, catColumnWidthPt);
    const catFirstPageOverheadLines =
        1 /* h3(sectionLabel) */ +
        coreFields.reduce((sum, [label, value]) => sum + estimateWrappedLines(`${label.toUpperCase()} : ${value}`, catCharsPerLine), 0);
    const catBudget = Math.max(1, Math.round(catItemsPerPageBudget(fontPx) * (geo.contentHeightPt / A4_CONTENT_HEIGHT_PT)));
    const catChunks = hasBoundary
        ? chunkItemsByCost(catItems, (item) => estimateWrappedLines(item, catCharsPerLine), {
              first: Math.max(1, catBudget - catFirstPageOverheadLines),
              rest: catBudget,
          })
        : [catItems];

    return catChunks
        .map((chunk, idx) => {
            let leftHtml: string;
            if (hasBoundary) {
                // Scission pilotée active : la liste C sort de la carte cœur
                // dans SA PROPRE carte insécable (titrée « (SUITE) » à partir
                // du 2e fragment) — c'est elle, jamais la carte cœur, qui se
                // scinde d'un fragment à l'autre.
                const catBoxHtml = `<div class="box avoid"><h3>${esc(idx === 0 ? catLabel : `${catLabel} (SUITE)`)}</h3>${dashItemsHtml(chunk)}</div>`;
                leftHtml =
                    idx === 0
                        ? `<div class="box"><h3>${esc(sectionLabel)}</h3>` +
                          coreFields.map(([label, value]) => fieldOr(label, value)).join('') +
                          `</div>${catBoxHtml}`
                        : catBoxHtml;
            } else {
                // Aucune frontière légitime dans C : même carte unique que
                // l'ancien rendu (jamais de scission, jamais de risque
                // d'orphelin puisqu'une seule page existe pour ce bloc).
                leftHtml =
                    `<div class="box"><h3>${esc(sectionLabel)}</h3>` +
                    coreFields.map(([label, value]) => fieldOr(label, value)).join('') +
                    fieldOr(catLabel, chunk[0] ?? '-') +
                    `</div>`;
            }
            const rightHtml =
                idx === 0
                    ? `<div class="box"><h3>Composition par Cellule</h3>${cellsHtml}${placeChefHtml}</div>`
                    : '';

            const pageTitle = idx === 0 ? title : `${title} (SUITE)`;
            return (
                `<div class="adv-page" style="font-size:${fontPx}px;"><h2>${pageTitle}</h2>` +
                `<div class="row"><div class="col">${leftHtml}</div><div class="col">${rightHtml}</div></div></div>`
            );
        })
        .join('');
}

/**
 * Surcharge de la taille physique `@page` selon NOTRE format ('a4' | '16:9').
 * `printCss()` (port verbatim de `OrderPdfStyle.kt`) fixe toujours
 * `size: A4 landscape` — strategica n'a pas de format 16:9. Cette règle
 * supplémentaire, calculée depuis `theme.ts::pageGeometry()` (mesures
 * validées au banc, SPEC-PDF-V3.md §1.4), surcharge `size` en cascade CSS
 * SANS toucher `margin` (posé par `printCss()`, non redéfini ici).
 */
function pageSizeOverrideCss(format: OiPdfFormat): string {
    const geo = pageGeometry(format);
    const widthMm = geo.widthPt / mm(1);
    const heightMm = geo.heightPt / mm(1);
    return `<style>@page { size: ${widthMm.toFixed(3)}mm ${heightMm.toFixed(3)}mm; }</style>`;
}

/* ==========================================================================
 * Sections (ordre imposé = pdf-engine-v2.ts:817-1294 / SPEC-PDF-V3.md §3.2).
 * ======================================================================== */

/** Section 1 — Page de garde « ORDRE INITIAL » (pdf-engine-v2.ts:816-855). */
function coverPage(
    formData: OiFormData,
    photosBase64: Record<string, string>,
    dynamicPhotos: Record<string, OiPhotoMeta[]>,
    p: OiPdfPalette,
): string {
    const logoId = (dynamicPhotos['photo_logo_unite'] ?? [])[0]?.id;
    const bgSrc = photosBase64['custom_pdf_background'] ?? (logoId ? photosBase64[logoId] : undefined);
    const watermark = bgSrc ? `<div class="watermark"><img src="${bgSrc}"/></div>` : '';

    const opCard =
        `<div class="op-card"><div><strong>OP :</strong> ${escOr(formData.nom_operation)}</div>` +
        `<div>DATE : ${escOr(formData.date_op)}</div></div>`;

    const situationCard =
        `<div class="box">` +
        fieldOr('Situation générale', formData.situation_generale) +
        fieldOr('Situation particulière', formData.situation_particuliere) +
        `</div>`;

    const adversaries = formData.adversaries ?? [];
    const ciblesBody =
        adversaries.length > 0
            ? adversaries
                  .map((adv) => {
                      const nom = escOr(adv.nom_adversaire, 'Inconnu');
                      const detail = [escOr(adv.stature_adversaire, ''), escOr(adv.ethnie_adversaire, '')]
                          .filter((v) => v !== '')
                          .join(' ');
                      return `<div class="cible">${nom}</div>${detail ? `<div class="muted">${detail}</div>` : ''}`;
                  })
                  .join('<hr/>')
            : '<p class="muted"><em>Aucune cible renseignée.</em></p>';
    const ciblesCard = `<div class="box">${ciblesBody}</div>`;

    return (
        `<div class="fullpage">${watermark}${opCard}` +
        `<h1 style="border:4px solid ${p.accent};padding:18px 30px;text-align:center;width:80%;">ORDRE INITIAL</h1>` +
        `<div class="row" style="width:92%;">` +
        `<div class="col">${section('1. SITUATION GLOBALE', situationCard)}</div>` +
        `<div class="col">${section('CIBLES(S)', ciblesCard)}</div>` +
        `</div></div>`
    );
}

/** Section 2 — Fiche adversaire dédiée (pdf-engine-v2.ts:894-957). */
function adversaryFiche(
    adv: OiAdversary,
    index: number,
    photosBase64: Record<string, string>,
    dynamicPhotos: Record<string, OiPhotoMeta[]>,
): string {
    const nom = textOr(adv.nom_adversaire, 'Inconnu');
    const mainPhotoId = (dynamicPhotos[`photo_main_${adv.id}`] ?? [])[0]?.id;
    const mainPhotoSrc = mainPhotoId ? photosBase64[mainPhotoId] : undefined;

    const meList = adv.me_list.filter((m) => m.trim() !== '');
    const volumeList = adv.volume_list.filter((v) => v.trim() !== '');
    const etatEspritList = adv.etat_esprit_list.filter((v) => v.trim() !== '');
    const vehiculesList = adv.vehicules_list.filter((v) => v.trim() !== '');

    // Barème identique à la fiche strategica (OrderHtmlAdversaires.ficheVolume,
    // :85-101), porté via theme.ts::adaptivePagePx (partagé avec les autres
    // pages dédiées de ce document).
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
    ].map((v) => (v == null ? '' : String(v)));
    const volume = textFields.reduce((sum, f) => sum + f.length, 0) + meList.reduce((sum, m) => sum + m.length, 0);
    const fontPx = adaptivePagePx(textFields, vehiculesList.length);
    const fillClass = volume < 1000 ? ' adv-fill' : '';

    const identityRows =
        kvRow('Naissance', `${textOr(adv.date_naissance)} @ ${textOr(adv.lieu_naissance)}`) +
        kvRow('Profession', textOr(adv.profession_adversaire)) +
        kvRow('Situation familiale', textOr(adv.situation_familiale)) +
        kvRow('Signalement', `${textOr(adv.stature_adversaire)} | ${textOr(adv.ethnie_adversaire)}`) +
        kvRow('Signes particuliers', textOr(adv.signes_particuliers, 'Ras')) +
        kvRow('Substances', textOr(adv.substances_adversaire)) +
        (meList.length > 0 ? kvRow('Moyens Employés', meList.join(' / ')) : '');

    // Photo principale : hauteur fixe (75mm) simplifiée — la voie A seule porte
    // le budget vertical exact MAX_ADV_PORTRAIT_H (75/90mm selon le format,
    // pdf-engine-v2.ts:616), non répliqué ici (l'impression navigateur ne
    // contraint pas au pixel près comme un canevas pdfmake).
    const photoHtml = mainPhotoSrc
        ? `<div class="fiche-photo"><div class="fig" style="width:100%;height:75mm;"><img src="${mainPhotoSrc}"/></div></div>`
        : '';

    const dangerHtml =
        `<div class="danger-card"><h3>DANGEROSITÉ</h3>` +
        `<p><span class="danger">Armes Connues :</span> ${nl2brOr(adv.armes_connues)}</p>` +
        `<p><strong>Dangerosité / ATCD :</strong> ${nl2brOr(adv.antecedents_adversaire)}</p>` +
        `</div>`;

    const localisationMobilite =
        `<div class="row" style="margin-top:6px;">` +
        `<div class="col"><div class="box"><h3>LOCALISATION</h3>` +
        fieldOr('Domicile', adv.domicile_adversaire) +
        fieldOr('Volume / Esprit', `${volumeList.join(', ') || '-'} | ${etatEspritList.join(', ') || '-'}`) +
        `</div></div>` +
        `<div class="col"><div class="box"><h3>MOBILITÉ</h3>` +
        `<p><strong>Véhicules / Plaques :</strong> ${vehiculesList.length > 0 ? esc(vehiculesList.join(' | ')) : '-'}</p>` +
        fieldOr('Attitude Attendue', adv.attitude_adversaire) +
        `</div></div></div>`;

    let html = `<div class="adv-page${fillClass}" style="font-size:${fontPx}px;">`;
    html += `<div class="card-head">2.${index} FICHE ADVERSAIRE : ${esc(nom)}</div>`;
    html += `<div class="fiche-head">${photoHtml}<div class="fiche-id"><table class="avoid">${identityRows}</table></div></div>`;
    html += dangerHtml;
    html += localisationMobilite;
    html += `</div>`;

    const extraPhotos = dynamicPhotos[`photo_extra_${adv.id}`] ?? [];
    const renfortPhotos = dynamicPhotos[`photo_renforts_${adv.id}`] ?? [];
    html += galleryPages(`Adversaire : ${esc(nom)} (Photos annexes)`, extraPhotos, photosBase64);
    html += galleryPages(`Adversaire : ${esc(nom)} (Renfort possible)`, renfortPhotos, photosBase64);
    return html;
}

function adversaryPages(
    formData: OiFormData,
    photosBase64: Record<string, string>,
    dynamicPhotos: Record<string, OiPhotoMeta[]>,
): string {
    const adversaries = formData.adversaries ?? [];
    return adversaries.map((adv, idx) => adversaryFiche(adv, idx + 1, photosBase64, dynamicPhotos)).join('');
}

/** Section 3 — « 3. ENVIRONNEMENT ET AMIS » (pdf-engine-v2.ts:972-996). Voie B
 * mappée explicitement sur `field()` (SPEC-PDF-V3.md §3.2, ligne 3). */
function environnementPage(formData: OiFormData): string {
    const empty = '<p class="muted"><em>Non renseigné.</em></p>';
    const left =
        field('Forces Amies / Concours', formData.amies) +
        field('Terrain / Météo', formData.terrain_info) +
        field('Éclairage', formData.eclairage) +
        field('Lever du soleil', formData.lever_soleil);
    const right =
        field('Population / Voisinage', formData.population) +
        field('Faune / Animaux', formData.faune_animaux) +
        field('Cadre Juridique', formData.cadre_juridique);
    const acces = field('Accès Principal', formData.acces_principal);
    const cheminement = field('Cheminement Initial', formData.cheminement_initial);

    return (
        `<div class="adv-page">` +
        section(
            '3. ENVIRONNEMENT ET AMIS',
            `<div class="row"><div class="col"><div class="box">${left || empty}</div></div>` +
                `<div class="col"><div class="box">${right || empty}</div></div></div>` +
                `<div class="row" style="margin-top:10px;">` +
                `<div class="col"><div class="box">${acces || empty}</div></div>` +
                `<div class="col"><div class="box">${cheminement || empty}</div></div></div>`,
        ) +
        `</div>`
    );
}

/** Section 4 — « 4. MISSION DE L'UNITÉ » (pdf-engine-v2.ts:998-1003). */
function missionPage(formData: OiFormData): string {
    return (
        `<div class="adv-page">` +
        section(
            "4. MISSION DE L'UNITÉ",
            `<div class="accent-card" style="font-weight:bold;">${nl2brOr(formData.missions_psig)}</div>`,
        ) +
        `</div>`
    );
}

/** Section 5 — « 5. EXÉCUTION » (pdf-engine-v2.ts:1007-1030). */
function executionPage(formData: OiFormData, p: OiPdfPalette): string {
    const events = formData.time_events ?? [];
    const chronoRows =
        events.length > 0
            ? events
                  .map(
                      (e) =>
                          `<tr><td style="text-align:center;">${esc(e.hour)}</td>` +
                          `<td><strong>${esc(e.type)}</strong> : ${esc(e.description)}</td></tr>`,
                  )
                  .join('')
            : '<tr><td colspan="2">N/A</td></tr>';
    const chronoBox =
        `<div class="box"><h3>Chronologie Prévisionnelle</h3>` +
        `<table class="avoid"><thead><tr><th style="width:22%;">Heure</th><th>Événement</th></tr></thead>` +
        `<tbody>${chronoRows}</tbody></table></div>`;

    const hypotheses = formData.hypotheses ?? [];
    const hypBody =
        hypotheses.length > 0
            ? hypotheses
                  .map((h, i) => `<p><strong style="color:${p.danger};">H${i + 1} :</strong> ${nl2br(h)}</p>`)
                  .join('')
            : '<p class="muted">-</p>';
    const hypBox = `<div class="box"><h3>Hypothèses d'ensemble</h3>${hypBody}</div>`;

    const top =
        `<div class="row">` +
        `<div class="col">${fieldOr("Date d'exécution", formData.date_execution)}</div>` +
        `<div class="col"><p><strong>Heure H :</strong> ` +
        `<span style="font-size:1.2em;font-weight:bold;color:${p.accent};">${escOr(formData.heure_execution)}</span></p></div>` +
        `</div>`;

    return (
        `<div class="adv-page">` +
        section(
            '5. EXÉCUTION',
            top +
                fieldOr('Idée de Manœuvre / Action', formData.action_body_text) +
                `<div class="row" style="margin-top:8px;"><div class="col">${chronoBox}</div><div class="col">${hypBox}</div></div>`,
        ) +
        `</div>`
    );
}

/** Section 6 — Galerie « 6. LOGISTIQUE & TRANSPORTS (Cheminement) »
 * (pdf-engine-v2.ts:1032-1039). Titre entièrement statique : pas de portion
 * Store, donc non pré-échappé (le « & » littéral doit survivre, cf. en-tête). */
function logisticsPhotos(dynamicPhotos: Record<string, OiPhotoMeta[]>): OiPhotoMeta[] {
    return [
        ...(dynamicPhotos['photo_container_transport_pr_preview_container'] ?? []),
        ...(dynamicPhotos['photo_container_transport_domicile_preview_container'] ?? []),
    ];
}

/** Section 7 — « 7. ARTICULATION & ORDRES DE MOUVEMENT » (pdf-engine-v2.ts:1042-1057).
 * Toujours rendue (jamais omise dans la source). */
function articulationPage(formData: OiFormData): string {
    const rameVl = formData.rame_vl_order ?? [];
    const colonne = formData.colonne_progression_order ?? [];
    const penetration = formData.ordre_penetration_order ?? [];
    return (
        `<div class="adv-page">` +
        section(
            '7. ARTICULATION & ORDRES DE MOUVEMENT',
            `<div class="row">` +
                `<div class="col"><div class="box"><h3>Ordre Rame VL</h3><div class="gallery">${pillList(rameVl)}</div></div></div>` +
                `<div class="col"><div class="box"><h3>Colonne Progression</h3><div class="gallery">${pillList(colonne)}</div></div></div>` +
                `</div>` +
                `<div class="box avoid"><h3>Ordre de Pénétration</h3><div class="gallery">${pillList(penetration)}</div>` +
                `<p><strong>PLACE DU CHEF :</strong> ${escOr(formData.place_chef)}</p></div>`,
        ) +
        `</div>`
    );
}

/** Champs texte communs ZMSPCP/MOICP mesurés pour le palier de police
 * adaptatif — même méthode que la fiche adversaire (`adaptivePagePx`),
 * transposition verbatim de `articulationBlockFontPx` (voie A, lecture
 * seule) : arbitrage 4 (police adaptative ZMSPCP/MOICP). */
function articulationBlockFontPx(fields: Array<string | undefined>, memberGroupCount: number): number {
    return adaptivePagePx(fields.map((v) => v ?? ''), memberGroupCount);
}

/** Bloc « Articulation : ZMSPCP - <titre> » (pdf-engine-v2.ts:1067-1097). */
function zmspcpPage(block: OiZmspcpBlock, memberToCell: Map<string, string>, format: OiPdfFormat): string {
    const groupCount = new Set(block.members.map((t) => memberToCell.get(t) || 'SANS CELLULE')).size;
    const cellHtml = cellGroupsHtml(block.members, memberToCell);
    const fontPx = articulationBlockFontPx(
        [block.zone, block.mission, block.secteur, block.points_particuliers, block.cat, block.place_chef],
        groupCount,
    );
    return articulationBlockPages({
        title: `Articulation : ZMSPCP - ${esc(textOr(block.title))}`,
        sectionLabel: 'ZMSPCP',
        coreFields: [
            ['Z zone', textOr(block.zone)],
            ['M mission', textOr(block.mission)],
            ['S secteur', textOr(block.secteur)],
            ['P points particuliers', textOr(block.points_particuliers)],
        ],
        catLabel: 'C conduite à tenir',
        catText: textOr(block.cat),
        cellsHtml: cellHtml || '<p class="muted">-</p>',
        placeChefHtml: `<p style="margin-top:10px;"><strong>Place du Chef :</strong> ${escOr(block.place_chef)}</p>`,
        fontPx,
        format,
    });
}

/** Bloc « Articulation : MOICP - <titre> » (pdf-engine-v2.ts:1101-1123). */
function moicpPage(block: OiMoicpBlock, memberToCell: Map<string, string>, format: OiPdfFormat): string {
    const groupCount = new Set(block.members.map((t) => memberToCell.get(t) || 'SANS CELLULE')).size;
    const cellHtml = cellGroupsHtml(block.members, memberToCell);
    const fontPx = articulationBlockFontPx(
        [block.mission, block.objectif, block.itineraire, block.points_particuliers, block.cat, block.place_chef],
        groupCount,
    );
    return articulationBlockPages({
        title: `Articulation : MOICP - ${esc(textOr(block.title))}`,
        sectionLabel: 'MOICP',
        coreFields: [
            ['M mission', textOr(block.mission)],
            ['O objectif', textOr(block.objectif)],
            ['I itinéraire', textOr(block.itineraire)],
            ['P points particuliers', textOr(block.points_particuliers)],
        ],
        catLabel: 'C conduite à tenir',
        catText: textOr(block.cat),
        cellsHtml: cellHtml || '<p class="muted">-</p>',
        placeChefHtml: `<p style="margin-top:10px;"><strong>Place du Chef :</strong> ${escOr(block.place_chef)}</p>`,
        fontPx,
        format,
    });
}

/** Bloc « Articulation : EFFRACTION - <titre> » (pdf-engine-v2.ts:1132-1187). */
function effractionPage(
    block: OiEffractionBlock,
    photosBase64: Record<string, string>,
    dynamicPhotos: Record<string, OiPhotoMeta[]>,
): string {
    const photoMeta = (dynamicPhotos[`photo_effrac_${block.id}`] ?? [])[0];
    const doorSrc = photoMeta ? photosBase64[photoMeta.id] : undefined;
    const tools = photoMeta ? parseTools(photoMeta.tools) : [];
    const toolsHtml =
        tools.length > 0
            ? tools.map((t) => `<span class="tool-badge">${esc(t)}</span>`).join(' ')
            : '<span class="tool-badge">PORTE</span>';

    const photoHtml = doorSrc
        ? `<div class="fiche-photo"><div class="fig" style="width:100%;height:75mm;"><img src="${doorSrc}"/></div>` +
          `<div class="gallery" style="margin-top:4px;">${toolsHtml}</div></div>`
        : '';

    // CHAMPS FANTÔMES (mission BLIND.B §3, champs-fantomes.md) : mission/porte/
    // prof_moulure/prof_marche aux emplacements EXACTS strategica
    // (`OrderHtmlArticulation.kt:245` : mission en paragraphe libre AVANT la
    // grille de mesures ; `:279` : type de porte en 1re ligne de la grille ;
    // `:289-290` : prof. marche puis prof. moulure en dernières lignes).
    const missionHtml = fieldOr('Mission', block.mission);
    const specs =
        `<div class="effrac-specs">` +
        `<div><span class="label">Type de Porte</span> ${nl2brOr(block.porte)}</div>` +
        `<div><span class="label">Structure</span> ${nl2brOr(block.structure)}</div>` +
        `<div><span class="label">Serrurerie</span> ${nl2brOr(block.serrurerie)}</div>` +
        `<div><span class="label">Environnement</span> ${nl2brOr(block.environnement)}</div>` +
        `<div><span class="label">Bâti à Bâti</span> ${nl2brOr(block.bati_a_bati)} mm</div>` +
        `<div><span class="label">Dormant à Dormant</span> ${nl2brOr(block.dormant_a_dormant)} mm</div>` +
        `<div><span class="label">Prof. Linteaux</span> ${nl2brOr(block.prof_linteaux)} mm</div>` +
        `<div><span class="label">Prof. Bâti</span> ${nl2brOr(block.prof_bati)}</div>` +
        `<hr style="grid-column: span 2;"/>` +
        `<div><span class="label">H. Porte</span> ${nl2brOr(block.h_porte)}</div>` +
        `<div><span class="label">H. Marche</span> ${nl2brOr(block.h_marche)}</div>` +
        `<div><span class="label">Prof. Marche</span> ${nl2brOr(block.prof_marche)} mm</div>` +
        `<div><span class="label">Prof. Moulure</span> ${nl2brOr(block.prof_moulure)} mm</div>` +
        `</div>`;

    const hypRows =
        block.hypotheses.length > 0
            ? block.hypotheses
                  .map(
                      (h) =>
                          `<tr><td><strong>${esc(h.title || h.id)}</strong></td>` +
                          `<td>${nl2brOr(h.effrac)}</td><td>${nl2brOr(h.degag)}</td><td>${nl2brOr(h.assaut)}</td></tr>`,
                  )
                  .join('')
            : '<tr><td colspan="4">Aucune hypothèse saisie</td></tr>';

    // `desc` (champ fantôme #4) : DÉROGATION anti-débordement (arbitrage 3) —
    // strategica l'insère en <br/> DANS la cellule « Hypothèse » de la table
    // (`OrderHtmlArticulation.kt:308-312`), ce qui pousse précisément la
    // cellule à 20% de largeur à déborder/orpheliniser sur un texte long
    // (cf. champs-fantomes.md, option 1 explicitement écartée). On rend donc
    // `desc` en BLOC TEXTE SOUS le tableau, une entrée par hypothèse
    // renseignée — la table garde ses 4 colonnes fixes, jamais de cellule
    // à largeur contrainte contenant un volume de texte imprévisible.
    const descEntries = block.hypotheses.filter((h) => !isBlank(h.desc));
    const descHtml =
        descEntries.length > 0
            ? `<div class="box" style="margin-top:6px;"><h3>Description des Hypothèses</h3>` +
              descEntries
                  .map((h) => `<p><strong>${esc(h.title || h.id)} :</strong> ${nl2br(h.desc)}</p>`)
                  .join('') +
              `</div>`
            : '';

    // Police adaptative (arbitrage 4, port verbatim de `effracFontPx`,
    // OrderHtmlArticulation.kt:261-274, LECTURE SEULE) : le volume cumulé
    // mission + hypothèses (title/desc/effrac/degag/assaut) fixe le palier de
    // la fiche entière, même barème que `adaptivePagePx` (theme.ts). Chaque
    // hypothèse pèse 2 lignes de plus dans le calcul (comme le Kotlin
    // `b.hypotheses.size * 2`) : place approximative de son en-tête + ses
    // trois colonnes techniques.
    const fontFields = [
        block.mission,
        ...block.hypotheses.flatMap((h) => [h.title, h.desc, h.effrac, h.degag, h.assaut]),
    ];
    const fontPx = adaptivePagePx(
        fontFields.map((v) => v ?? ''),
        block.hypotheses.length * 2,
    );

    return (
        `<div class="adv-page" style="font-size:${fontPx}px;"><h2>Articulation : EFFRACTION - ${esc(textOr(block.title))}</h2>` +
        missionHtml +
        `<div class="fiche-head">${photoHtml}<div class="fiche-id"><div class="box"><h3>Caractéristiques Techniques</h3>${specs}</div></div></div>` +
        // PAS de classe `avoid` sur cette table (contrairement au rendu
        // précédent) : `page-break-inside:avoid` est de toute façon
        // INEFFICACE au-delà d'une page pleine (R16, regles-strategica.md —
        // le navigateur rompt quand même à l'intérieur) ; on assume donc
        // explicitement la fragmentation NATIVE `<thead>` (répété sur chaque
        // page, `tr{page-break-inside:avoid}` déjà global) plutôt qu'une
        // règle « avoid » silencieusement violée. C'est ce mécanisme qui
        // garantit qu'aucune hypothèse n'est jamais perdue, quel qu'en soit
        // le nombre (contraste voie A, cf. matrice-rupture.md §2).
        `<div class="box"><h3>Hypothèses d'Effraction</h3>` +
        `<table><thead><tr><th style="width:20%;">Hypothèse</th><th style="width:30%;">Technique / Moyen</th>` +
        `<th style="width:25%;">Dégagement</th><th style="width:25%;">Assaut</th></tr></thead>` +
        `<tbody>${hypRows}</tbody></table></div>` +
        descHtml +
        `</div>`
    );
}

/**
 * Boucle des blocs d'articulation groupés par index — port de
 * `pdf-engine-v2.ts:1059-1189` : `for i < max(moicp, zmspcp, effrac)`, ordre
 * interne ZMSPCP → MOICP → EFFRACTION (rule de fidélité §3.4.4). Photos
 * « Baptême Terrain » avant chaque page ZMSPCP, « Emplacement AO » après.
 */
function articulationBlocksLoop(
    formData: OiFormData,
    photosBase64: Record<string, string>,
    dynamicPhotos: Record<string, OiPhotoMeta[]>,
    format: OiPdfFormat,
): string {
    const moicpBlocks = formData.moicp_blocks ?? [];
    const zmspcpBlocks = formData.zmspcp_blocks ?? [];
    const effracBlocks = formData.effraction_blocks ?? [];
    const maxBlocks = Math.max(moicpBlocks.length, zmspcpBlocks.length, effracBlocks.length);
    const memberToCell = buildMemberToCellMap(formData.patracdvr_rows ?? []);

    let html = '';
    for (let i = 0; i < maxBlocks; i++) {
        const zmspcp = zmspcpBlocks[i];
        if (zmspcp) {
            const bapteme = dynamicPhotos[`photo_bapteme_${zmspcp.id}`] ?? [];
            html += galleryPages(`Baptême Terrain — ${esc(textOr(zmspcp.title))}`, bapteme, photosBase64);
            html += zmspcpPage(zmspcp, memberToCell, format);
            const emplAo = dynamicPhotos[`photo_empl_ao_${zmspcp.id}`] ?? [];
            html += galleryPages(`ZMSPCP : ${esc(textOr(zmspcp.title))} (Emplacement AO)`, emplAo, photosBase64);
        }

        const moicp = moicpBlocks[i];
        if (moicp) {
            html += moicpPage(moicp, memberToCell, format);
            const ext = dynamicPhotos[`photo_itin_ext_${moicp.id}`] ?? [];
            const int_ = dynamicPhotos[`photo_itin_int_${moicp.id}`] ?? [];
            html += galleryPages(`MOICP : ${esc(textOr(moicp.title))}`, [...ext, ...int_], photosBase64);
        }

        const effrac = effracBlocks[i];
        if (effrac) {
            html += effractionPage(effrac, photosBase64, dynamicPhotos);
            const photos = dynamicPhotos[`photo_effrac_${effrac.id}`] ?? [];
            html += galleryPages(`Effraction : ${esc(textOr(effrac.title))}`, photos, photosBase64);
        }
    }
    return html;
}

/** Section 9 — « 8. CONDUITES À TENIR GÉNÉRALES » (pdf-engine-v2.ts:1195-1216),
 * OMISE si les 3 champs sont vides (rule de fidélité §3.4.1). */
function catPage(formData: OiFormData): string {
    const { cat_generales: cat, no_go: nogo, cat_liaison: liaison } = formData;
    if (isBlank(cat) && isBlank(nogo) && isBlank(liaison)) return '';

    return (
        `<div class="adv-page">` +
        section(
            '8. CONDUITES À TENIR GÉNÉRALES',
            `<div class="row">` +
                `<div class="col"><div class="accent-card"><h3>CAT Générales</h3><div>${nl2brOr(cat)}</div></div></div>` +
                `<div class="col"><div class="danger-card"><h3>Conditions de Désengagement (NO-GO)</h3><div class="danger">${nl2brOr(nogo)}</div></div></div>` +
                `</div>` +
                `<div class="warning-card" style="margin-top:10px;"><h3>Liaison</h3><div>${nl2brOr(liaison)}</div></div>`,
        ) +
        `</div>`
    );
}

/** Section 10 — « 7. RÉCAPITULATIF PATRACDVR » (pdf-engine-v2.ts:1219-1280),
 * OMISE si aucun membre. Pagination manuelle SUPPRIMÉE (écart assumé E3,
 * `headerRows`/`<thead>` répété par l'impression). NOS 8/9 colonnes
 * conservées (PAS les 12 de strategica, cf. SPEC-PDF-V3.md, note sous §3.2). */
function patracPage(formData: OiFormData, p: OiPdfPalette): string {
    const rows = formData.patracdvr_rows ?? [];
    const allRows: Array<{ vehicle: string; m: OiPatracMember }> = [];
    for (const row of rows) {
        row.members.forEach((m, idx) => {
            allRows.push({ vehicle: idx === 0 ? row.vehicle : '', m });
        });
    }
    if (allRows.length === 0) return '';

    const hasDir = allRows.some((r) => r.m.dir.trim() !== '');
    const colWidths = hasDir
        ? ['7%', '7%', '10%', '14%', '10%', '10%', '8%', '28%', '6%']
        : ['7%', '7%', '10%', '14%', '10%', '10%', '8%', '34%'];
    const colgroup = `<colgroup>${colWidths.map((w) => `<col style="width:${w};"/>`).join('')}</colgroup>`;
    const headers = ['VL', 'PAX', 'CELLULE', 'FONCTION', 'PPALE', 'SEC.', 'AFIS', 'EQPT/GREN.', ...(hasDir ? ['DIR'] : [])];
    const thead = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;

    const bodyRows = allRows
        .map(({ vehicle, m }) => {
            const eqpt = [m.equipement, m.equipement2, m.grenades, m.tenue, m.gpb].filter((v) => v && v !== 'Sans').join(', ') || '-';
            const vehicleStyle = vehicle ? ` style="font-weight:bold;background:${p.headerRow};"` : '';
            const cells = [
                `<td${vehicleStyle}>${esc(vehicle)}</td>`,
                `<td>${escOr(m.trigramme)}</td>`,
                `<td>${escOr(m.cellule)}</td>`,
                `<td>${escOr(m.fonction)}</td>`,
                `<td>${escOr(m.principales)}</td>`,
                `<td>${escOr(m.secondaires)}</td>`,
                `<td>${escOr(m.afis)}</td>`,
                `<td>${esc(eqpt)}</td>`,
            ];
            if (hasDir) cells.push(`<td>${escOr(m.dir, '')}</td>`);
            return `<tr>${cells.join('')}</tr>`;
        })
        .join('');

    const table = `<table class="patrac">${colgroup}${thead}<tbody>${bodyRows}</tbody></table>`;
    return `<div class="adv-page" style="font-size:${patracFontPx(allRows.length)}px;">${section('7. RÉCAPITULATIF PATRACDVR', table)}</div>`;
}

/** Section 11 — Page finale « AVEZ-VOUS DES QUESTIONS ? » (pdf-engine-v2.ts:1283-1294). */
function finalPage(
    formData: OiFormData,
    photosBase64: Record<string, string>,
    dynamicPhotos: Record<string, OiPhotoMeta[]>,
): string {
    const logoId = (dynamicPhotos['photo_logo_unite'] ?? [])[0]?.id;
    const bgSrc = photosBase64['custom_pdf_background'] ?? (logoId ? photosBase64[logoId] : undefined);
    const watermark = bgSrc ? `<div class="watermark"><img src="${bgSrc}"/></div>` : '';

    const footer =
        `<p class="muted">OI - ${escOr(formData.trigramme_redacteur)} - ${escOr(formData.unite_redacteur)} - ` +
        `<span class="danger">CONFIDENTIEL</span></p>`;

    return (
        `<div class="page-break"></div><div class="fullpage">${watermark}` +
        `<h1 style="text-align:center;">AVEZ-VOUS DES QUESTIONS ?</h1>` +
        `<hr style="width:60%;"/>${footer}</div>`
    );
}

/* ==========================================================================
 * API publique.
 * ======================================================================== */

/**
 * Document HTML autonome complet : `<!DOCTYPE html>` … 14 sections … `</html>`.
 * Port de `pdf-engine-v2.ts:817-1294` (structure/replis/omissions), langage
 * visuel `printCss()` (strategica). `opts.format` ne pilote QUE la taille
 * physique `@page` (`pageSizeOverrideCss`) — `printCss()` reste, lui, un port
 * verbatim indépendant du format (toujours « paysage »).
 */
export function buildPrintDocument(data: OiPdfCollectedData, opts: { format: OiPdfFormat }): string {
    const { formData, photosBase64, isDark } = data;
    const p = palette(isDark);
    const dynamicPhotos = formData.dynamic_photos ?? {};
    const fontPx = documentFontPx(documentVolume(formData));

    const titleBits = [textOr(formData.date_op, ''), textOr(formData.trigramme_redacteur, '')].filter((v) => v !== '');
    const title = esc('Ordre Initial' + (titleBits.length > 0 ? ' · ' + titleBits.join(' — ') : ''));

    let body = '';
    body += coverPage(formData, photosBase64, dynamicPhotos, p);
    body += adversaryPages(formData, photosBase64, dynamicPhotos);
    body += environnementPage(formData);
    body += missionPage(formData);
    body += executionPage(formData, p);
    body += galleryPages('6. LOGISTIQUE & TRANSPORTS (Cheminement)', logisticsPhotos(dynamicPhotos), photosBase64);
    body += articulationPage(formData);
    body += articulationBlocksLoop(formData, photosBase64, dynamicPhotos, opts.format);
    body += catPage(formData);
    body += patracPage(formData, p);
    body += finalPage(formData, photosBase64, dynamicPhotos);

    const style = printCss(p, fontPx, true, fontFacesCss());
    const pageSize = pageSizeOverrideCss(opts.format);

    return (
        `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>` +
        `${style}${pageSize}</head><body>${body}</body></html>`
    );
}

/**
 * Impression qualité maximale (voie B) — mécanique imposée par SPEC-PDF-V3.md
 * §5.3 : collecte -> document autonome -> `<iframe>` hors écran (même
 * origine, `srcdoc`) -> attente `load` + `fonts.ready` -> `window.print()` ->
 * retrait de l'iframe sur `afterprint` ou après un délai de garde (60 s),
 * jamais de fuite. `deps` est une COUTURE DE TEST (`print`/`collect`).
 */
export async function printOiHighQuality(deps?: {
    print?: (w: Window) => void;
    collect?: () => Promise<OiPdfCollectedData>;
}): Promise<void> {
    try {
        const collect =
            deps?.collect ??
            ((): Promise<OiPdfCollectedData> => import('@oi/pdf-engine-v2.js').then((m) => m.PDFEngineV2.collectAllData()));
        const data = await collect();

        // Même test que pdf-engine-v2.ts:121 et :321.
        const format: OiPdfFormat = window.pdfOutputFormat === '16:9' ? '16:9' : 'a4';
        const html = buildPrintDocument(data, { format });

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;border:0;';
        document.body.appendChild(iframe);

        await new Promise<void>((resolve) => {
            iframe.addEventListener('load', () => resolve(), { once: true });
            iframe.srcdoc = html;
        });

        const printDoc = iframe.contentDocument;
        if (printDoc?.fonts) {
            await printDoc.fonts.ready;
        }

        const win = iframe.contentWindow;
        if (!win) throw new Error('iframe.contentWindow indisponible après chargement.');
        win.focus();

        let removed = false;
        const removeIframe = (): void => {
            if (removed) return;
            removed = true;
            iframe.remove();
        };
        win.addEventListener('afterprint', removeIframe, { once: true });
        setTimeout(removeIframe, 60000);

        (deps?.print ?? ((w: Window): void => w.print()))(win);
    } catch (e) {
        console.error('[Impression qualité maximale] échec:', e);
        // RÈGLE D'OR (SPEC-PDF-V3.md §2.1) : appel cross-module par window.toast,
        // même idiome que pdf-engine-v2.ts:176-183.
        if (typeof window.toast === 'function') {
            window.toast("Erreur lors de l'impression qualité maximale.", 'error');
        } else {
            alert("Erreur lors de l'impression qualité maximale.");
        }
    }
}
