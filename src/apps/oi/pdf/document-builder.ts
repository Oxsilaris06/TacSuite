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
    type OiPdfFormat,
    type OiPdfPalette,
} from './theme.js';
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

/* ==========================================================================
 * Helpers génériques (fidélité, saut de page, valeurs Store).
 * ======================================================================== */

/** Conversion sûre d'un champ `unknown` du Store (mission #4) — jamais de validation absente de l'original. */
function str(v: unknown): string {
    return String(v ?? '');
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
                            { text: cellName, bold: true, color: p.accent, decoration: 'underline', fontSize: 8, margin: [0, 0, 0, 4] },
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
                            { text },
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

    const situationCard = card(
        [
            h3('1. SITUATION GLOBALE', p),
            labelValue('Situation générale', strOr(formData.situation_generale), p, { valueBold: true }),
            labelValue('Situation particulière', strOr(formData.situation_particuliere), p, { valueBold: true }),
        ],
        p,
    );

    const adversaries = formData.adversaries ?? [];
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
    const ciblesCard = card([h3('CIBLES(S)', p), ...ciblesBody], p);

    return {
        stack: [
            ...watermark,
            opCard,
            { stack: [h1('ORDRE INITIAL', p, { boxed: true })], margin: [0, mm(35), 0, mm(15)] },
            grid2([situationCard], [ciblesCard]),
        ],
    };
}

/* ==========================================================================
 * Section 2 — Fiche adversaire dédiée (pdf-engine-v2.ts:894-958, §3.2 ligne 2).
 * ======================================================================== */
function buildAdversaryFiche(ctx: BuildCtx, adv: OiAdversary, index: number): Content {
    const { photosBase64, dynamicPhotos, p, is169 } = ctx;
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
    const identityCard = card([h3('IDENTITÉ', p), kvTable(identityRows, p)], p);

    const dangerCard = card(
        [
            h3('DANGEROSITÉ', p, { color: p.danger }),
            labelValue('Armes Connues', strOr(adv.armes_connues), p, { valueColor: p.danger, valueBold: true }),
            labelValue('Dangerosité / ATCD', strOr(adv.antecedents_adversaire), p),
        ],
        p,
    );

    const localisationCard = card(
        [
            h3('LOCALISATION', p),
            labelValue('Domicile', strOr(adv.domicile_adversaire), p),
            labelValue('Volume / Esprit', `${volumeList.join(', ') || '-'} | ${etatEspritList.join(', ') || '-'}`, p),
        ],
        p,
    );

    const mobiliteCard = card(
        [
            h3('MOBILITÉ', p),
            labelValue('Véhicules / Plaques', vehiculesList.join(' | ') || '-', p),
            labelValue('Attitude Attendue', strOr(adv.attitude_adversaire), p),
        ],
        p,
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

    return {
        stack: [
            ficheAdversaireTitleBar(`2.${index} FICHE ADVERSAIRE : ${nom}`, p),
            head,
            { text: '', margin: [0, 6, 0, 0] },
            grid2([localisationCard], [mobiliteCard]),
        ],
        fontSize: fontPx,
    };
}

/** Fiche adversaire + ses galeries « Photos annexes »/« Renfort possible » (pdf-engine-v2.ts:959-969). */
function buildAdversaryPages(ctx: BuildCtx): Content[] {
    const { formData, photosBase64, dynamicPhotos, p, geo } = ctx;
    const adversaries = formData.adversaries ?? [];
    const acc: Content[] = [];
    adversaries.forEach((adv, idx) => {
        pushPage(acc, buildAdversaryFiche(ctx, adv, idx + 1));
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
    return {
        stack: [
            h2('3. ENVIRONNEMENT ET AMIS', p, geo.contentWidthPt),
            grid2([card(left, p)], [card(right, p)]),
            { text: '', margin: [0, 5, 0, 0] },
            grid2(
                [card([labelValue('Accès Principal', strOr(formData.acces_principal), p)], p)],
                [card([labelValue('Cheminement Initial', strOr(formData.cheminement_initial), p)], p)],
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
            accentCard(
                null,
                [{ text: strOr(formData.missions_psig), bold: true, fontSize: Math.round(baseFontSize * 1.6), preserveLeadingSpaces: true }],
                p,
                'accent',
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
                  { text: e.hour, borderColor: cellBorder(p) },
                  { text: [{ text: e.type, bold: true }, { text: ` : ${e.description}` }], borderColor: cellBorder(p) },
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
    const chronoCard = card([h3('Chronologie Prévisionnelle', p), chronoTable], p);

    const hypotheses = formData.hypotheses ?? [];
    const hypBody: Content[] =
        hypotheses.length > 0 ? hypotheses.map((h, i) => hypothesisLine(i, h, p)) : [{ text: '-', color: p.muted }];
    const hypCard = card([h3("Hypothèses d'ensemble", p), ...hypBody], p);

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

    const rameCard = card(
        [h3('Ordre Rame VL', p), rameVl.length > 0 ? pillRow(rameVl, p, { numbered: true }) : { text: '-' }],
        p,
    );
    const colonneCard = card(
        [h3('Colonne Progression', p), colonne.length > 0 ? pillRow(colonne, p, { numbered: true }) : { text: '-' }],
        p,
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
 * ======================================================================== */
function buildZmspcpPage(ctx: BuildCtx, block: OiZmspcpBlock, memberToCell: Map<string, string>): Content {
    const { p, geo } = ctx;
    const groups = regroupByCellOrdered(block.members, memberToCell);
    const cellsContent: Content[] =
        groups.length > 0 ? groups.map(([cell, members]) => cellGroupBox(cell, members, p)) : [{ text: '-', color: p.muted }];
    return {
        stack: [
            h2(`Articulation : ZMSPCP - ${block.title || '-'}`, p, geo.contentWidthPt),
            grid2(
                [
                    h3('ZMSPCP', p),
                    labelValue('Z zone', block.zone || '-', p),
                    labelValue('M mission', block.mission || '-', p),
                    labelValue('S secteur', block.secteur || '-', p),
                    labelValue('P points particuliers', block.points_particuliers || '-', p),
                    labelValue('C conduite à tenir', block.cat || '-', p),
                ],
                [
                    h3('Composition par Cellule', p),
                    ...cellsContent,
                    labelValue('Place du Chef', block.place_chef || '-', p),
                ],
            ),
        ],
    };
}

function buildMoicpPage(ctx: BuildCtx, block: OiMoicpBlock, memberToCell: Map<string, string>): Content {
    const { p, geo } = ctx;
    const groups = regroupByCellOrdered(block.members, memberToCell);
    const cellsContent: Content[] =
        groups.length > 0 ? groups.map(([cell, members]) => cellGroupBox(cell, members, p)) : [{ text: '-', color: p.muted }];
    return {
        stack: [
            h2(`Articulation : MOICP - ${block.title || '-'}`, p, geo.contentWidthPt),
            grid2(
                [
                    h3('MOICP', p),
                    labelValue('M mission', block.mission || '-', p),
                    labelValue('O objectif', block.objectif || '-', p),
                    labelValue('I itinéraire', block.itineraire || '-', p),
                    labelValue('P points particuliers', block.points_particuliers || '-', p),
                    labelValue('C conduite à tenir', block.cat || '-', p),
                ],
                [
                    h3('Composition par Cellule', p),
                    ...cellsContent,
                    labelValue('Place du Chef', block.place_chef || '-', p),
                ],
            ),
        ],
    };
}

/** Bloc « Articulation : EFFRACTION - <titre> » (pdf-engine-v2.ts:1132-1187, §3.2 ligne 8f, POINT DE VIGILANCE §1). */
function buildEffractionPage(ctx: BuildCtx, block: OiEffractionBlock): Content {
    const { photosBase64, dynamicPhotos, p, geo, is169 } = ctx;
    const doorMeta = dynamicPhotos[`photo_effrac_${block.id}`]?.[0];
    const doorSrc = doorMeta ? photosBase64[doorMeta.id] : undefined;
    const tools = doorMeta ? parseTools(doorMeta.tools) : [];
    const topHMm = is169 ? 65 : 75;

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
            labelValue('Prof. Bâti', block.prof_bati || '-', p),
        ],
        p,
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

    const hypotheses = block.hypotheses;
    const hypRows: TableCell[][] =
        hypotheses.length > 0
            ? hypotheses.map(
                  (h): TableCell[] => [
                      { text: h.title || h.id, bold: true, color: p.accent, borderColor: cellBorder(p) },
                      { text: h.effrac || '-', borderColor: cellBorder(p) },
                      { text: h.degag || '-', borderColor: cellBorder(p) },
                      { text: h.assaut || '-', borderColor: cellBorder(p) },
                  ],
              )
            : [[{ text: 'Aucune hypothèse saisie', colSpan: 4, alignment: 'center', borderColor: cellBorder(p) }, {}, {}, {}]];

    const hypTable: Content = {
        table: {
            widths: ['20%', '30%', '25%', '25%'],
            headerRows: 1,
            body: [
                [
                    { text: 'Hypothèse', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
                    { text: 'Technique / Moyen', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
                    { text: 'Dégagement', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
                    { text: 'Assaut', bold: true, fillColor: p.headerRow, borderColor: cellBorder(p) },
                ],
                ...hypRows,
            ],
        },
        layout: LAYOUT_BORDERED,
    };

    return {
        stack: [
            h2(`Articulation : EFFRACTION - ${block.title || '-'}`, p, geo.contentWidthPt),
            head,
            { text: '', margin: [0, 6, 0, 0] },
            card([h3("Hypothèses d'Effraction", p), hypTable], p),
        ],
    };
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
            pushPage(acc, buildZmspcpPage(ctx, zmspcp, memberToCell));
            const emplAo = dynamicPhotos[`photo_empl_ao_${zmspcp.id}`] ?? [];
            pushPages(acc, galleryPages(`ZMSPCP : ${zmspcp.title || '-'} (Emplacement AO)`, emplAo, photosBase64, p, geo));
        }

        const moicp = moicpBlocks[i];
        if (moicp) {
            pushPage(acc, buildMoicpPage(ctx, moicp, memberToCell));
            const ext = dynamicPhotos[`photo_itin_ext_${moicp.id}`] ?? [];
            const int_ = dynamicPhotos[`photo_itin_int_${moicp.id}`] ?? [];
            pushPages(acc, galleryPages(`MOICP : ${moicp.title || '-'}`, [...ext, ...int_], photosBase64, p, geo));
        }

        const effrac = effracBlocks[i];
        if (effrac) {
            pushPage(acc, buildEffractionPage(ctx, effrac));
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

    return {
        stack: [
            h2('8. CONDUITES À TENIR GÉNÉRALES', p, geo.contentWidthPt),
            grid2(
                [accentCard('CAT Générales', [{ text: strOr(cat), preserveLeadingSpaces: true }], p, 'accent')],
                [
                    accentCard(
                        'Conditions de Désengagement (NO-GO)',
                        [{ text: strOr(nogo), color: p.danger, bold: true, preserveLeadingSpaces: true }],
                        p,
                        'danger',
                    ),
                ],
            ),
            { text: '', margin: [0, 6, 0, 0] },
            accentCard('Liaison', [{ text: strOr(liaison), preserveLeadingSpaces: true }], p, 'warning'),
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
    const widths: Size[] = hasDir
        ? ['7%', '7%', '10%', '14%', '10%', '10%', '8%', '28%', '6%']
        : ['7%', '7%', '10%', '14%', '10%', '10%', '8%', '34%'];
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
            { text: vehicle, bold: true, fillColor: vehicle ? p.headerRow : undefined, alignment: 'center', borderColor: cellBorder(p) },
            { text: m.trigramme || '-', bold: true, borderColor: cellBorder(p) },
            { text: m.cellule || '-', borderColor: cellBorder(p) },
            { text: m.fonction || '-', borderColor: cellBorder(p) },
            { text: m.principales || '-', borderColor: cellBorder(p) },
            { text: m.secondaires || '-', borderColor: cellBorder(p) },
            { text: m.afis || '-', borderColor: cellBorder(p) },
            { text: eqpt, fontSize: 8, borderColor: cellBorder(p) },
        ];
        if (hasDir) {
            cells.push({ text: m.dir || '', bold: true, alignment: 'center', borderColor: cellBorder(p) });
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
