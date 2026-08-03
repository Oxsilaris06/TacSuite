/**
 * oi-pdf-theme.test.ts — Tests unitaires de `src/apps/oi/pdf/theme.ts`
 * (SPEC-PDF-V3.md §2.1, paquet P2 « pdf-p2-theme »). Module PUR (zéro DOM,
 * zéro pdfmake) : port verbatim des barèmes/palettes de
 * `OrderPdfStyle.kt`/`OrderHtml.kt` (Praxis-Rust, lecture seule). Références
 * `OrderPdfStyle.kt:<ligne>` / `OrderHtml.kt:<ligne>` en commentaire pour
 * chaque groupe de tests, comme demandé par le contremaître.
 *
 * TDD : ce fichier est écrit AVANT `theme.ts` — il doit échouer (module
 * introuvable) avant l'implémentation.
 */
import { describe, expect, it } from 'vitest';

import {
    adaptivePagePx,
    documentFontPx,
    effracFontPx,
    fullPageHeightMm,
    mm,
    palette,
    patracFontPx,
    pageGeometry,
    photoPageGalleryHeightMm,
    PDF_DARK,
    PDF_LIGHT,
} from '@oi/pdf/theme.js';

describe('palettes (OrderPdfStyle.kt:30-56)', () => {
    it('PDF_LIGHT contient exactement les 11 champs strategica clairs (OrderPdfStyle.kt:30-42)', () => {
        expect(PDF_LIGHT).toEqual({
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
        });
    });

    it('PDF_DARK contient exactement les 11 champs strategica sombres (OrderPdfStyle.kt:43-56)', () => {
        expect(PDF_DARK).toEqual({
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
        });
    });

    it('palette(true) === PDF_DARK et palette(false) === PDF_LIGHT (OrderPdfStyle.kt:58)', () => {
        expect(palette(true)).toBe(PDF_DARK);
        expect(palette(false)).toBe(PDF_LIGHT);
    });
});

describe('mm — conversion mm → points PDF (1 mm = 2.834645669291339 pt)', () => {
    it('mm(0) === 0', () => {
        expect(mm(0)).toBe(0);
    });

    it('mm(1) === 2.834645669291339', () => {
        expect(mm(1)).toBeCloseTo(2.834645669291339, 12);
    });

    it('mm(210) ≈ 595.28 à 0.01 près (largeur A4 portrait)', () => {
        expect(mm(210)).toBeCloseTo(595.28, 2);
    });

    it('mm(297) ≈ 841.89 à 0.01 près (hauteur A4 portrait / largeur A4 paysage)', () => {
        expect(mm(297)).toBeCloseTo(841.89, 2);
    });
});

describe('pageGeometry — géométrie de page (OrderPdfStyle.kt:90,95 ; banc pdfinfo)', () => {
    it("format 'a4' : 841.89 × 595.28 pt, landscape true", () => {
        const geo = pageGeometry('a4');
        expect(geo.widthPt).toBeCloseTo(841.89, 2);
        expect(geo.heightPt).toBeCloseTo(595.28, 2);
        expect(geo.landscape).toBe(true);
    });

    it("format '16:9' : 958.11 × 539.01 pt (338 × 190.125 mm, valeur vérifiée au banc)", () => {
        const geo = pageGeometry('16:9');
        expect(geo.widthPt).toBeCloseTo(958.11, 2);
        expect(geo.heightPt).toBeCloseTo(539.01, 2);
        expect(geo.landscape).toBe(true);
    });

    it('marginsPt = [mm(11), mm(8), mm(11), mm(11)] (gauche, haut, droite, bas)', () => {
        const geo = pageGeometry('a4');
        expect(geo.marginsPt[0]).toBeCloseTo(mm(11), 6);
        expect(geo.marginsPt[1]).toBeCloseTo(mm(8), 6);
        expect(geo.marginsPt[2]).toBeCloseTo(mm(11), 6);
        expect(geo.marginsPt[3]).toBeCloseTo(mm(11), 6);
    });

    it('marginsPt est identique entre les deux formats', () => {
        expect(pageGeometry('a4').marginsPt).toEqual(pageGeometry('16:9').marginsPt);
    });

    it('contentWidthPt/contentHeightPt cohérents avec widthPt/heightPt et les marges (format a4)', () => {
        const geo = pageGeometry('a4');
        const [left, top, right, bottom] = geo.marginsPt;
        expect(geo.contentWidthPt).toBeCloseTo(geo.widthPt - left - right, 6);
        expect(geo.contentHeightPt).toBeCloseTo(geo.heightPt - top - bottom, 6);
    });

    it('contentWidthPt/contentHeightPt cohérents avec widthPt/heightPt et les marges (format 16:9)', () => {
        const geo = pageGeometry('16:9');
        const [left, top, right, bottom] = geo.marginsPt;
        expect(geo.contentWidthPt).toBeCloseTo(geo.widthPt - left - right, 6);
        expect(geo.contentHeightPt).toBeCloseTo(geo.heightPt - top - bottom, 6);
    });
});

describe('documentFontPx — barème corps de document (port OrderHtml.kt:87-97)', () => {
    it('volume 0 → 14 (palier bas)', () => {
        expect(documentFontPx(0)).toBe(14);
    });

    it('volume 799 → 14 (borne juste sous 800)', () => {
        expect(documentFontPx(799)).toBe(14);
    });

    it('volume 800 → 12 (borne exacte du 2e palier)', () => {
        expect(documentFontPx(800)).toBe(12);
    });

    it('volume 1499 → 12 (borne juste sous 1500)', () => {
        expect(documentFontPx(1499)).toBe(12);
    });

    it('volume 1500 → 10 (borne exacte du 3e palier)', () => {
        expect(documentFontPx(1500)).toBe(10);
    });

    it('volume 5000 → 10 (bien au-delà)', () => {
        expect(documentFontPx(5000)).toBe(10);
    });
});

describe('adaptivePagePx — barème police adaptative de page (port OrderPdfStyle.kt:232-245)', () => {
    it('tableau vide → 14 (total = 0)', () => {
        expect(adaptivePagePx([])).toBe(14);
    });

    it('total 499 (chaîne de 499 caractères, sans retour-ligne) → 14', () => {
        expect(adaptivePagePx(['a'.repeat(499)])).toBe(14);
    });

    it('total 500 (chaîne de 500 caractères, sans retour-ligne) → 12', () => {
        expect(adaptivePagePx(['a'.repeat(500)])).toBe(12);
    });

    it('total 999 → 12', () => {
        expect(adaptivePagePx(['a'.repeat(999)])).toBe(12);
    });

    it('total 1000 → 10', () => {
        expect(adaptivePagePx(['a'.repeat(1000)])).toBe(10);
    });

    it('total 1799 → 10', () => {
        expect(adaptivePagePx(['a'.repeat(1799)])).toBe(10);
    });

    it('total 1800 → 9', () => {
        expect(adaptivePagePx(['a'.repeat(1800)])).toBe(9);
    });

    it('pondération ×60 par retour-ligne : une chaîne de 10 caractères avec 8 « \\n » compte pour 10 + 8*60 = 490 → 14, +1 caractère (491) reste 14, mais 9 « \\n » (550) passe à 12', () => {
        // 10 caractères "utiles" + 8 '\n' = 18 caractères au total dans la chaîne,
        // total pondéré = 18 + 8*60 = 498 < 500 → 14.
        const huitRetours = 'a'.repeat(10) + '\n'.repeat(8);
        expect(adaptivePagePx([huitRetours])).toBe(14);

        // 10 caractères + 9 '\n' : longueur de chaîne 19, total = 19 + 9*60 = 559 → 12.
        const neufRetours = 'a'.repeat(10) + '\n'.repeat(9);
        expect(adaptivePagePx([neufRetours])).toBe(12);
    });

    it('extraLines pondère comme les retours-ligne des chaînes : 3 extraLines sur un champ de 300 caractères sans \\n → 300 + 3*60 = 480 → 14, 4 extraLines → 540 → 12', () => {
        const champ = 'a'.repeat(300);
        expect(adaptivePagePx([champ], 3)).toBe(14);
        expect(adaptivePagePx([champ], 4)).toBe(12);
    });

    it('somme sur plusieurs champs (longueurs + retours-ligne cumulés)', () => {
        // champA : 200 caractères (longueur 200, 0 '\n'). champB : 200 caractères + 1
        // '\n' (longueur 201, 1 '\n'). total = (200+201) + 1*60 = 461 < 500 → 14.
        // champC (50 caractères) porte le total à 461+50 = 511, toujours 1 '\n' → 12.
        const champA = 'a'.repeat(200);
        const champB = 'b'.repeat(200) + '\n';
        expect(adaptivePagePx([champA, champB])).toBe(14);
        const champC = 'c'.repeat(50);
        expect(adaptivePagePx([champA, champB, champC])).toBe(12);
    });
});

describe('patracFontPx — barème PATRACDVR (port OrderHtml.kt:321-327)', () => {
    it('rowCount 1 → 14', () => {
        expect(patracFontPx(1)).toBe(14);
    });

    it('rowCount 14 → 14 (borne exacte du 1er palier)', () => {
        expect(patracFontPx(14)).toBe(14);
    });

    it('rowCount 15 → 12 (borne juste au-dessus)', () => {
        expect(patracFontPx(15)).toBe(12);
    });

    it('rowCount 22 → 12 (borne exacte du 2e palier)', () => {
        expect(patracFontPx(22)).toBe(12);
    });

    it('rowCount 23 → 10 (borne juste au-dessus)', () => {
        expect(patracFontPx(23)).toBe(10);
    });

    it('rowCount 32 → 10 (borne exacte du 3e palier)', () => {
        expect(patracFontPx(32)).toBe(10);
    });

    it('rowCount 33 → 9 (borne juste au-dessus)', () => {
        expect(patracFontPx(33)).toBe(9);
    });

    it('rowCount 100 → 9 (bien au-delà)', () => {
        expect(patracFontPx(100)).toBe(9);
    });
});

describe('fullPageHeightMm / photoPageGalleryHeightMm (OrderPdfStyle.kt:62,68)', () => {
    it('fullPageHeightMm(true) === 186 (paysage)', () => {
        expect(fullPageHeightMm(true)).toBe(186);
    });

    it('fullPageHeightMm(false) === 272 (portrait)', () => {
        expect(fullPageHeightMm(false)).toBe(272);
    });

    it('photoPageGalleryHeightMm(true) === 172 (186 - 14, paysage)', () => {
        expect(photoPageGalleryHeightMm(true)).toBe(172);
    });

    it('photoPageGalleryHeightMm(false) === 258 (272 - 14, portrait)', () => {
        expect(photoPageGalleryHeightMm(false)).toBe(258);
    });
});

// ===========================================================================
// effracFontPx (OrderHtmlArticulation.kt:261-274) — blindage PDF OI, mission
// BLIND.A (R7 `regles-strategica.md`, non portée avant ce correctif).
// ===========================================================================
describe('effracFontPx (OrderHtmlArticulation.kt:261-274)', () => {
    it('même barème qu’adaptivePagePx : volume < 500 → 14', () => {
        expect(effracFontPx(['court'], 0)).toBe(14);
    });

    it('0 hypothèse, mission seule : 14 (plancher haut)', () => {
        expect(effracFontPx(['FRANCHISSEMENT DE LA PORTE.'], 0)).toBe(14);
    });

    it('12 hypothèses volumineuses (fixture effrac-12-hypotheses) : palier réduit sous 14', () => {
        const fields = Array.from({ length: 12 }, (_, i) => [
            `Hypothese ${i + 1}`,
            '',
            `Technique effraction ${i + 1} : pied de biche + verin hydraulique, description detaillee de la manoeuvre a executer.`,
            `Degagement ${i + 1} : evacuation par le couloir principal vers le point de regroupement Alpha.`,
            `Assaut ${i + 1} : penetration en Y inverse, binome de tete puis binome de couverture.`,
        ]).flat();
        expect(effracFontPx(fields, 12)).toBeLessThan(14);
    });

    it('lines = extraLines (hypothesesCount*2) pèsent comme adaptivePagePx(fields, hypothesesCount*2) — délégation directe', () => {
        const fields = ['a', 'b', 'c'];
        expect(effracFontPx(fields, 5)).toBe(adaptivePagePx(fields, 10));
    });
});
