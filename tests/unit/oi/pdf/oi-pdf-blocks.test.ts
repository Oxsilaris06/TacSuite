/**
 * oi-pdf-blocks.test.ts — Tests unitaires de `src/apps/oi/pdf/blocks.ts`
 * (SPEC-PDF-V3.md §2.1 « contrat blocks.ts », §3.1 tableau T4-T15, §3.3
 * galeries ; paquet P3 « pdf-p3-blocks »). Module PUR : aucun rendu PDF réel,
 * uniquement des assertions sur la STRUCTURE des objets `Content`/`TableCell`
 * pdfmake retournés.
 *
 * TDD : ce fichier est écrit AVANT `blocks.ts` — il doit échouer (module
 * introuvable) avant l'implémentation.
 *
 * Notes de résolution d'ambiguïtés (documentées ici, pas dans le code de
 * production, pour ne pas polluer blocks.ts de méta-commentaire) :
 * - `badgeRow` n'a PAS d'option `numbered` dans son contrat d'export exact
 *   (seulement `{ perRow?: number }`). La consigne « badgeRow numérote
 *   correctement quand numbered » ne peut donc viser que `pillRow(..., {
 *   numbered: true })` — c'est ce que ce fichier teste sous ce libellé.
 * - `emptyLine` figure dans SPEC-PDF-V3.md §2.1 mais PAS dans la liste
 *   « EXPORTS ATTENDUS » donnée explicitement par le contremaître pour ce
 *   paquet : non implémenté, non testé ici (le contrat du paquet prime).
 */
import { describe, expect, it } from 'vitest';
import type { Content, ContentCanvas, ContentColumns, ContentImage, ContentStack, ContentTable, ContentText } from 'pdfmake/interfaces';

import {
    accentCard,
    badgeRow,
    card,
    figure,
    galleryAllTools,
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
    LAYOUT_PILL,
    pill,
    pillRow,
} from '@oi/pdf/blocks.js';
import { mm, pageGeometry, PDF_LIGHT, photoPageGalleryHeightMm } from '@oi/pdf/theme.js';
import type { OiPhotoMeta } from '@shared/types/contracts.js';

const p = PDF_LIGHT;
const geo = pageGeometry('a4');

function makePhoto(overrides: Partial<OiPhotoMeta> = {}): OiPhotoMeta {
    return {
        id: 'photo-1',
        annotations: '[]',
        tools: '[]',
        other_tools: '',
        customTitle: '',
        ...overrides,
    };
}

describe('h1 (OrderHtml.kt:118, T4)', () => {
    it('rend un texte Oswald 36pt couleur accent, non encadré par défaut', () => {
        const result = h1('ORDRE INITIAL', p) as ContentText;
        expect(result.text).toBe('ORDRE INITIAL');
        expect(result.font).toBe('Oswald');
        expect(result.fontSize).toBe(36);
        expect(result.color).toBe(p.accent);
        expect('table' in result).toBe(false);
    });

    it('respecte opts.fontSize', () => {
        const result = h1('AVEZ-VOUS DES QUESTIONS ?', p, { fontSize: 44 }) as ContentText;
        expect(result.fontSize).toBe(44);
    });

    it('opts.boxed encadre le titre dans une table 1x1 à bordure 4pt', () => {
        const result = h1('ORDRE INITIAL', p, { boxed: true }) as ContentTable;
        expect(result.table).toBeDefined();
        expect(result.table.body).toHaveLength(1);
        expect(result.table.body[0]).toHaveLength(1);
        const layout = result.layout;
        if (typeof layout === 'object' && layout !== null) {
            expect(layout.hLineWidth?.(0, {} as never)).toBe(4);
        } else {
            throw new Error('layout attendu: CustomTableLayout');
        }
    });
});

describe('h2 (OrderPdfStyle.kt:98-101, T5)', () => {
    it('produit un stack : texte Oswald 17pt majuscule couleur accent + filet 2pt sur toute la largeur', () => {
        const result = h2('5. exécution', p, geo.contentWidthPt) as ContentStack;
        expect(result.stack).toHaveLength(2);
        const [titleNode, lineNode] = result.stack as [ContentText, ContentCanvas];
        expect(titleNode.text).toBe('5. EXÉCUTION');
        expect(titleNode.font).toBe('Oswald');
        expect(titleNode.fontSize).toBe(17);
        expect(titleNode.color).toBe(p.accent);
        expect(lineNode.canvas).toHaveLength(1);
        expect(lineNode.canvas[0]).toMatchObject({
            type: 'line',
            x1: 0,
            y1: 0,
            x2: geo.contentWidthPt,
            y2: 0,
            lineWidth: 2,
            lineColor: p.accent,
        });
    });

    it('est insécable (unbreakable, équivalent page-break-after:avoid)', () => {
        const result = h2('titre', p, 500) as ContentStack;
        expect(result.unbreakable).toBe(true);
    });
});

describe('h3 (OrderPdfStyle.kt:102-103, T6)', () => {
    it('12pt, gras, souligné, couleur accent par défaut', () => {
        const result = h3('Identité', p) as ContentText;
        expect(result.fontSize).toBe(12);
        expect(result.bold).toBe(true);
        expect(result.decoration).toBe('underline');
        expect(result.color).toBe(p.accent);
    });

    it('opts.color override (ex: filet danger de la fiche adversaire)', () => {
        const result = h3('Dangerosité', p, { color: p.danger }) as ContentText;
        expect(result.color).toBe(p.danger);
    });
});

describe('labelValue (pdf-engine-v2.ts:709-710, T9)', () => {
    it('label en majuscules gras accent suivi de " : ", valeur en pre-wrap', () => {
        const result = labelValue('naissance', 'Paris, 01/01/1990', p) as ContentText;
        expect(Array.isArray(result.text)).toBe(true);
        const [labelSpan, valueSpan] = result.text as [ContentText, ContentText];
        expect(labelSpan.text).toBe('NAISSANCE : ');
        expect(labelSpan.bold).toBe(true);
        expect(labelSpan.color).toBe(p.accent);
        expect(valueSpan.text).toBe('Paris, 01/01/1990');
        expect(result.preserveLeadingSpaces).toBe(true);
    });

    it('opts (fontSize/valueColor/valueBold) répercutés', () => {
        const result = labelValue('heure h', '08:00', p, {
            fontSize: 14,
            valueColor: p.accent,
            valueBold: true,
        }) as ContentText;
        expect(result.fontSize).toBe(14);
        const valueSpan = (result.text as ContentText[])[1] as ContentText;
        expect(valueSpan.color).toBe(p.accent);
        expect(valueSpan.bold).toBe(true);
    });
});

describe('card (OrderPdfStyle.kt:121-122, T8 — D8 pdfv3-design-fix/DEFAUTS.md)', () => {
    it('est une table 1x1 SANS fillColor par défaut (transparente, comme .box qui ne porte aucun `background`, print-style.ts:73-74)', () => {
        const result = card([{ text: 'contenu' }], p) as ContentTable;
        expect(result.table.body).toHaveLength(1);
        expect(result.table.body[0]).toHaveLength(1);
        const cell = result.table.body[0]?.[0] as ContentStack & { fillColor?: string };
        expect(cell.fillColor).toBeUndefined();
        expect(cell.stack).toEqual([{ text: 'contenu' }]);
    });

    it('opts.fillColor pose explicitement une couleur de fond', () => {
        const result = card([{ text: 'x' }], p, { fillColor: '#123456' }) as ContentTable;
        const cell = result.table.body[0]?.[0] as { fillColor?: string };
        expect(cell.fillColor).toBe('#123456');
    });

    it('la bordure reste toujours p.border, indépendamment de opts.fillColor', () => {
        const result = card([{ text: 'x' }], p) as ContentTable;
        const cell = result.table.body[0]?.[0] as { borderColor?: string[] };
        expect(cell.borderColor).toEqual([p.border, p.border, p.border, p.border]);
    });
});

describe('accentCard (OrderPdfStyle.kt:131-136, T4 section 4/9)', () => {
    it.each([
        ['accent', () => p.accent],
        ['danger', () => p.danger],
        ['warning', () => p.warning],
    ] as const)('la couleur du liseré suit kind=%s', (kind, expected) => {
        const result = accentCard('Titre', [{ text: 'corps' }], p, kind) as ContentTable;
        const stripeCell = result.table.body[0]?.[0] as { fillColor?: string };
        expect(stripeCell.fillColor).toBe(expected());
    });

    it('title=null n\'ajoute pas de ligne de titre', () => {
        const withTitle = accentCard('Titre', [{ text: 'corps' }], p, 'accent') as ContentTable;
        const withoutTitle = accentCard(null, [{ text: 'corps' }], p, 'accent') as ContentTable;
        const bodyCellWith = withTitle.table.body[0]?.[1] as ContentStack;
        const bodyCellWithout = withoutTitle.table.body[0]?.[1] as ContentStack;
        expect(bodyCellWith.stack.length).toBeGreaterThan(bodyCellWithout.stack.length);
    });
});

describe('grid2 (OrderPdfStyle.kt:115-116, T7)', () => {
    it('deux colonnes de largeur "*" séparées par columnGap', () => {
        const result = grid2([{ text: 'gauche' }], [{ text: 'droite' }]) as ContentColumns;
        expect(result.columns).toHaveLength(2);
        expect(result.columns[0]).toMatchObject({ width: '*' });
        expect(result.columns[1]).toMatchObject({ width: '*' });
        expect(result.columnGap).toBeGreaterThan(0);
    });

    it('gapPt explicite prioritaire sur mm(6)', () => {
        const result = grid2([], [], 12) as ContentColumns;
        expect(result.columnGap).toBe(12);
    });
});

describe('pill (OrderPdfStyle.kt:137-139, T11/T12)', () => {
    it('table 1x1 avec bordure accent', () => {
        const result = pill('MHX', p) as ContentTable;
        expect(result.table.body).toHaveLength(1);
        expect(result.layout).toBe(LAYOUT_PILL);
    });

    it('opts.index préfixe un numéro gras accent (port pdf-engine-v2.ts:1047)', () => {
        const result = pill('Alpha', p, { index: 0 }) as ContentTable;
        const cell = result.table.body[0]?.[0] as ContentText;
        const spans = cell.text as ContentText[];
        expect(spans[0]?.text).toBe('1 ');
        expect(spans[0]?.bold).toBe(true);
        expect(spans[1]?.text).toBe('Alpha');
    });

    it('opts.fillColor/textColor répercutés sur la cellule', () => {
        const result = pill('Outil', p, { fillColor: p.warning, textColor: '#000000' }) as ContentTable;
        const cell = result.table.body[0]?.[0] as { fillColor?: string; color?: string };
        expect(cell.fillColor).toBe(p.warning);
        expect(cell.color).toBe('#000000');
    });
});

describe('pillRow (T7, T11)', () => {
    it('découpe en lignes de perRow, complète la dernière avec une cellule vide', () => {
        const result = pillRow(['a', 'b', 'c', 'd', 'e'], p, { perRow: 2 }) as ContentTable;
        expect(result.layout).toBe(LAYOUT_NONE);
        expect(result.table.body).toHaveLength(3);
        result.table.body.forEach((row) => expect(row).toHaveLength(2));
        expect(result.table.body[2]?.[1]).toEqual({ text: '' });
    });

    it('perRow par défaut = 4', () => {
        const result = pillRow(['a', 'b', 'c', 'd', 'e'], p) as ContentTable;
        expect(result.table.body[0]).toHaveLength(4);
        expect(result.table.body).toHaveLength(2);
    });

    it('numbered=true numérote correctement (0-based -> "1 ", "2 "...) — voir note en tête de fichier sur badgeRow/numbered', () => {
        const result = pillRow(['x', 'y', 'z'], p, { perRow: 2, numbered: true }) as ContentTable;
        const firstCell = result.table.body[0]?.[0] as ContentTable;
        const secondCell = result.table.body[0]?.[1] as ContentTable;
        const thirdCell = result.table.body[1]?.[0] as ContentTable;
        const numberOf = (cell: ContentTable): string | undefined => {
            const inner = cell.table.body[0]?.[0] as ContentText;
            const spans = inner.text as ContentText[];
            return spans[0]?.text as string | undefined;
        };
        expect(numberOf(firstCell)).toBe('1 ');
        expect(numberOf(secondCell)).toBe('2 ');
        expect(numberOf(thirdCell)).toBe('3 ');
    });

    it('items vide -> Content neutre (pas de table)', () => {
        const result = pillRow([], p);
        expect(result).toEqual({ text: '' });
    });
});

describe('badgeRow (pdf-engine-v2.ts:757, T11)', () => {
    it('fillColor accent, texte blanc, perRow par défaut = 6', () => {
        const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        const result = badgeRow(items, p) as ContentTable;
        expect(result.table.body[0]).toHaveLength(6);
        expect(result.table.body).toHaveLength(2);
        const firstCell = result.table.body[0]?.[0] as ContentTable;
        const inner = firstCell.table.body[0]?.[0] as { fillColor?: string; color?: string };
        expect(inner.fillColor).toBe(p.accent);
        expect(inner.color).toBe('#ffffff');
    });

    it('opts.perRow override le regroupement', () => {
        const result = badgeRow(['A', 'B', 'C'], p, { perRow: 2 }) as ContentTable;
        expect(result.table.body[0]).toHaveLength(2);
        expect(result.table.body).toHaveLength(2);
    });
});

describe('kvTable (.k strategica, OrderPdfStyle.kt:114)', () => {
    it('une ligne par entrée, label gras fillColor cardAlt', () => {
        const result = kvTable(
            [
                ['Statut', 'Confirmé'],
                ['Cellule', 'Alpha'],
            ],
            p,
        ) as ContentTable;
        expect(result.table.body).toHaveLength(2);
        const labelCell = result.table.body[0]?.[0] as { text?: string; bold?: boolean; fillColor?: string };
        expect(labelCell.text).toBe('Statut');
        expect(labelCell.bold).toBe(true);
        expect(labelCell.fillColor).toBe(p.cardAlt);
        expect(result.layout).toBe(LAYOUT_BORDERED);
    });
});

describe('figure (fit préserve le ratio, T15/§3.3)', () => {
    it('dataUrl valide -> table 1x1 bordée 2pt accent contenant { image, fit }', () => {
        const result = figure('data:image/jpeg;base64,AAA', [100, 80], p) as ContentTable;
        expect(result.table.body).toHaveLength(1);
        const cell = result.table.body[0]?.[0] as ContentImage;
        expect(cell.image).toBe('data:image/jpeg;base64,AAA');
        expect(cell.fit).toEqual([100, 80]);
    });

    it('dataUrl null -> AUCUNE clé image (jamais de <img> vide qui ferait échouer pdfkit)', () => {
        const result = figure(null, [100, 80], p);
        expect('image' in (result as object)).toBe(false);
        expect('table' in (result as object)).toBe(false);
        expect(result).toEqual({ text: '' });
    });

    it('dataUrl vide ("") traité comme absent', () => {
        const result = figure('', [100, 80], p);
        expect(result).toEqual({ text: '' });
    });

    it('caption ajoute une légende centrée grasse accent sous le cadre', () => {
        const result = figure('data:image/jpeg;base64,AAA', [100, 80], p, 'Détail') as ContentStack;
        expect(result.stack).toHaveLength(2);
        const captionNode = result.stack[1] as ContentText;
        expect(captionNode.text).toBe('Détail');
        expect(captionNode.bold).toBe(true);
        expect(captionNode.color).toBe(p.accent);
        expect(captionNode.alignment).toBe('center');
    });
});

describe('galleryPages (OrderHtmlPhotos.kt:69-92, SPEC-PDF-V3.md §3.3)', () => {
    const photosBase64 = {
        'photo-1': 'data:image/jpeg;base64,AAA',
        'photo-2': 'data:image/jpeg;base64,BBB',
        'photo-3': 'data:image/jpeg;base64,CCC',
    };

    it('photos=[] -> [] (section omise, §3.4.1)', () => {
        expect(galleryPages('Titre', [], {}, p, geo)).toEqual([]);
    });

    it('3 photos -> 2 pages (2 puis 1), la 2e titrée "(suite)"', () => {
        const photos = [makePhoto({ id: 'photo-1' }), makePhoto({ id: 'photo-2' }), makePhoto({ id: 'photo-3' })];
        const pages = galleryPages('Galerie test', photos, photosBase64, p, geo);
        expect(pages).toHaveLength(2);

        const page1 = pages[0] as ContentStack;
        const page2 = pages[1] as ContentStack;
        const h2Page1 = page1.stack[0] as ContentStack;
        const h2Page2 = page2.stack[0] as ContentStack;
        const titleText1 = (h2Page1.stack[0] as ContentText).text;
        const titleText2 = (h2Page2.stack[0] as ContentText).text;
        expect(titleText1).toBe('GALERIE TEST');
        expect(titleText2).toBe('GALERIE TEST (SUITE)');

        // Page 1 = 2 photos côte à côte (columns), page 2 = 1 photo pleine largeur (stack).
        const body1 = page1.stack[1] as ContentColumns;
        expect(body1.columns).toHaveLength(2);
        const body2 = page2.stack[1] as ContentStack;
        expect(Array.isArray(body2.stack)).toBe(true);
    });

    it('convention de saut de page : pageBreak "before" sur toutes sauf la première', () => {
        const photos = [makePhoto({ id: 'photo-1' }), makePhoto({ id: 'photo-2' }), makePhoto({ id: 'photo-3' })];
        const pages = galleryPages('Galerie', photos, photosBase64, p, geo);
        expect((pages[0] as { pageBreak?: string }).pageBreak).toBeUndefined();
        expect((pages[1] as { pageBreak?: string }).pageBreak).toBe('before');
    });

    it('une photo absente de photosBase64 est ignorée (pas de figure vide)', () => {
        const photos = [makePhoto({ id: 'photo-1' }), makePhoto({ id: 'photo-missing' })];
        const pages = galleryPages('Galerie', photos, { 'photo-1': photosBase64['photo-1'] }, p, geo);
        expect(pages).toHaveLength(1);
        // Une seule photo restante -> mise en page pleine largeur (stack), pas columns.
        const page1 = pages[0] as ContentStack;
        const body = page1.stack[1] as ContentStack;
        expect(Array.isArray(body.stack)).toBe(true);
    });

    it('tools JSON corrompu ("{{") ne lève pas et ne produit aucun badge', () => {
        const photos = [makePhoto({ id: 'photo-1', tools: '{{' })];
        expect(() => galleryPages('Galerie', photos, photosBase64, p, geo)).not.toThrow();
        const pages = galleryPages('Galerie', photos, photosBase64, p, geo);
        const page1 = pages[0] as ContentStack;
        const body = page1.stack[1] as ContentStack;
        // figure() seul, sans ligne de pillRow de badges en plus.
        expect(body.stack).toHaveLength(1);
    });

    it('tools valides + other_tools ajoutent une ligne de badges (pillRow fillColor warning)', () => {
        const photos = [makePhoto({ id: 'photo-1', tools: '["Pied de biche"]', other_tools: 'Bélier' })];
        const pages = galleryPages('Galerie', photos, photosBase64, p, geo);
        const page1 = pages[0] as ContentStack;
        const body = page1.stack[1] as ContentStack;
        expect(body.stack).toHaveLength(2);
        const badgesRow = body.stack[1] as ContentTable;
        expect(badgesRow.table.body[0]).toHaveLength(4); // perRow par défaut de pillRow = 4, 2 items -> 1 ligne complétée
        const firstBadgeCell = badgesRow.table.body[0]?.[0] as ContentTable;
        const inner = firstBadgeCell.table.body[0]?.[0] as { fillColor?: string; color?: string };
        expect(inner.fillColor).toBe(p.warning);
        expect(inner.color).toBe('#000000');
    });

    it('customTitle utilisé comme légende si renseigné, sinon repli "<titre> - Détail"', () => {
        const withCustom = [makePhoto({ id: 'photo-1', customTitle: 'Vue de face' })];
        const withoutCustom = [makePhoto({ id: 'photo-1' })];

        const pagesCustom = galleryPages('Porte principale', withCustom, photosBase64, p, geo);
        const pagesDefault = galleryPages('Porte principale', withoutCustom, photosBase64, p, geo);

        const captionOf = (pages: Content[]): string => {
            const page1 = pages[0] as ContentStack;
            const body = page1.stack[1] as ContentStack;
            const fig = body.stack[0] as ContentStack;
            const captionNode = fig.stack[1] as ContentText;
            return captionNode.text as string;
        };
        expect(captionOf(pagesCustom)).toBe('Vue de face');
        expect(captionOf(pagesDefault)).toBe('Porte principale - Détail');
    });
});

describe('galleryToolsReservePt (SPEC-PDF-DEFINITIF §5, axe A3 — correctif D3)', () => {
    const boxWidthPt = 400;
    const fontPt = 14;

    it('réserve NULLE sans outil (non-régression stricte des galeries sans outil)', () => {
        expect(galleryToolsReservePt([], boxWidthPt, fontPt)).toBe(0);
    });

    it('réserve croissante avec le nombre de rangées', () => {
        const one = galleryToolsReservePt(['A'], boxWidthPt, fontPt);
        const four = galleryToolsReservePt(['A', 'B', 'C', 'D'], boxWidthPt, fontPt);
        const five = galleryToolsReservePt(['A', 'B', 'C', 'D', 'E'], boxWidthPt, fontPt);
        expect(one).toBeGreaterThan(0);
        // 4 outils tiennent sur la même rangée (perRow=4) que 1 seul.
        expect(four).toBe(one);
        expect(five).toBeGreaterThan(four);
    });

    it('5 outils => 2 rangées exactement (grille perRow=4)', () => {
        const one = galleryToolsReservePt(['A'], boxWidthPt, fontPt);
        const five = galleryToolsReservePt(['A', 'B', 'C', 'D', 'E'], boxWidthPt, fontPt);
        const oneRowHeight = one - mm(2);
        expect(five - mm(2)).toBeCloseTo(2 * oneRowHeight, 6);
    });

    it('un libellé très long (repli intra-cellule) réserve plus qu\'un libellé court', () => {
        const short = galleryToolsReservePt(['HDR50'], boxWidthPt, fontPt);
        const long = galleryToolsReservePt(['Bélier hydraulique lourd de dernière génération à double poignée'], boxWidthPt, fontPt);
        expect(long).toBeGreaterThan(short);
    });

    it('galleryAllTools combine tools JSON et other_tools (même assemblage que le rendu)', () => {
        expect(galleryAllTools(makePhoto({ tools: '["A","B"]', other_tools: 'C' }))).toEqual(['A', 'B', 'C']);
        expect(galleryAllTools(makePhoto({ tools: '{{', other_tools: '' }))).toEqual([]);
    });

    it('galleryPages : le cadre photo est RÉDUIT de la réserve quand des outils existent, jamais sous le plancher mm(40)', () => {
        const photosBase64 = { 'photo-1': 'data:image/jpeg;base64,AAA' };
        const frameHeightOf = (photos: OiPhotoMeta[]): number => {
            const pages = galleryPages('Galerie', photos, photosBase64, p, geo);
            const page1 = pages[0] as ContentStack;
            const body = page1.stack[1] as ContentStack;
            const fig = body.stack[0] as ContentStack; // figure avec légende = stack [frame, caption]
            const frame = fig.stack[0] as ContentTable;
            return (frame.table.heights as number[])[0] as number;
        };

        const without = frameHeightOf([makePhoto({ id: 'photo-1' })]);
        const withTools = frameHeightOf([makePhoto({ id: 'photo-1', tools: '["HDR50","Bélier lourd","VIGIK"]', other_tools: 'Bfldkngnfl' })]);
        // Sans outil : hauteur historique inchangée (base - réserve légende).
        expect(without).toBeCloseTo(mm(photoPageGalleryHeightMm(true)) - mm(12), 6);
        expect(withTools).toBeLessThan(without);
        expect(withTools).toBeGreaterThanOrEqual(mm(40));

        // Plancher jamais franchi, même avec un déluge d'outils.
        const many = Array.from({ length: 40 }, (_, i) => `Outil numéro ${i} très long pour replier`);
        const flooded = frameHeightOf([makePhoto({ id: 'photo-1', tools: JSON.stringify(many) })]);
        expect(flooded).toBe(mm(40));
    });
});

describe('LAYOUT_BORDERED / LAYOUT_PILL / LAYOUT_NONE — géométrie de base', () => {
    it('LAYOUT_BORDERED : bordure 1pt', () => {
        expect(LAYOUT_BORDERED.hLineWidth?.(0, {} as never)).toBe(1);
        expect(LAYOUT_BORDERED.vLineWidth?.(0, {} as never)).toBe(1);
    });

    it('LAYOUT_PILL : bordure 1pt, marges 2/9', () => {
        expect(LAYOUT_PILL.hLineWidth?.(0, {} as never)).toBe(1);
        expect(LAYOUT_PILL.paddingLeft?.(0, {} as never)).toBe(9);
        expect(LAYOUT_PILL.paddingTop?.(0, {} as never)).toBe(2);
    });

    it('LAYOUT_NONE : aucune bordure', () => {
        expect(LAYOUT_NONE.hLineWidth?.(0, {} as never)).toBe(0);
        expect(LAYOUT_NONE.vLineWidth?.(0, {} as never)).toBe(0);
    });
});
