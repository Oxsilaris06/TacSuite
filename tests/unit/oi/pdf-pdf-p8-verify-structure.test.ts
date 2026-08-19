/**
 * pdf-pdf-p8-verify-structure.test.ts — Tests unitaires de la LOGIQUE PURE de
 * `tests/pdf/verify-structure.mjs` (paquet `pdf-p8-verify-structure`,
 * SPEC-PDF-V3.md §7). Le script est un outil CLI (appelle `pdfinfo`/
 * `pdftotext`/`pdffonts`/`pdfimages` via `child_process`, se termine par
 * `process.exit()`) — ce fichier ne teste PAS l'exécution des binaires
 * poppler (couverte par la vérification manuelle documentée dans
 * `tests/pdf/README.md`, section « Démonstration »), mais les fonctions
 * PURES exportées : normalisation de texte, parsing des sorties tabulaires
 * `pdffonts`/`pdfimages`, et les 8 fonctions `assertA1..A8` (aucun DOM,
 * aucun accès disque/réseau, aucun `process.exit`).
 *
 * `main()` n'est PAS appelée par cet import : le fichier source garde son
 * exécution CLI derrière `if (isMainModule)` précisément pour permettre cet
 * import de test sans déclencher `process.exit()` (cf. commentaire au point
 * d'usage dans `verify-structure.mjs`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    assertA1_geometry,
    assertA2_realText,
    assertA3_sectionOrder,
    assertA4_duplicateSevenPreserved,
    assertA5_embeddedFonts,
    assertA6_noRasterization,
    assertA7_weight,
    assertA8_sampleData,
    assertB1_noOrphanPage,
    assertB2_noVerticalWordSplit,
    assertB5_noEmptyFieldDominatedPage,
    assertB6_verticalFillRatio,
    assertB9_noTrailingTitle,
    assertC1_zeroSuiteFragment,
    assertC2_adversaryFicheSinglePage,
    assertC3_articulationBlockSinglePage,
    assertC4_effractionAutonomousPages,
    assertC5_fixtureIntegrity,
    MARKERS,
    normalize,
    PAGE_DIMENSIONS_PT,
    parsePdfFonts,
    parsePdfImages,
    // @ts-expect-error — module .mjs sans déclaration de types ; les fonctions
    // exportées sont exercées via leur comportement runtime, pas leur typage.
} from '../../pdf/verify-structure.mjs';

/** Assemble des pages `pdftotext -layout` séparées par form feed `\f` (même convention que `splitPages`, verify-structure.mjs). */
const joinPages = (pages: string[]) => pages.join('\f') + '\f';

// ===========================================================================
// MARKERS / PAGE_DIMENSIONS_PT — sanity sur les constantes verbatim SPEC §7
// ===========================================================================
describe('MARKERS (SPEC-PDF-V3.md §7, liste des 15 marqueurs)', () => {
    it('contient exactement 15 marqueurs, numérotés 1..15 dans l\'ordre', () => {
        expect(MARKERS).toHaveLength(15);
        expect(MARKERS.map((m: { n: number }) => m.n)).toEqual(
            Array.from({ length: 15 }, (_, i) => i + 1)
        );
    });

    it('les indices conditionnels sont exactement 4, 6, 10, 11, 12, 13, 14 (renumérotation continue, SPEC-2026-08-18-pdf-et-champs.md §6 — TRANSPORT en #6, PATRACDVR en #14 alignée sur `buildPatracPage` qui omet la section si `patracdvr_rows` est vide)', () => {
        const conditionalIndices = MARKERS.filter((m: { conditional: boolean }) => m.conditional).map(
            (m: { n: number }) => m.n
        );
        expect(conditionalIndices).toEqual([4, 6, 10, 11, 12, 13, 14]);
    });

    it('le doublon historique « 7. » a disparu : #9 ARTICULATION reste « 7. », #14 PATRACDVR devient « 9. » (fix §6)', () => {
        expect(MARKERS[8]).toMatchObject({ n: 9, text: '7. ARTICULATION & ORDRES DE MOUVEMENT' });
        expect(MARKERS[13]).toMatchObject({ n: 14, text: '9. RÉCAPITULATIF PATRACDVR' });
    });
});

describe('PAGE_DIMENSIONS_PT (SPEC-PDF-V3.md §7, A1)', () => {
    it('a4 = 841.89 x 595.28 pts, 16:9 = 958.11 x 539.01 pts', () => {
        expect(PAGE_DIMENSIONS_PT.a4).toEqual({ w: 841.89, h: 595.28 });
        expect(PAGE_DIMENSIONS_PT['16:9']).toEqual({ w: 958.11, h: 539.01 });
    });
});

// ===========================================================================
// normalize() — NFC, collapse d'espaces, apostrophes typographiques
// ===========================================================================
describe('normalize()', () => {
    it('réduit les espaces/retours à la ligne consécutifs à un seul espace', () => {
        expect(normalize('7.   ARTICULATION\n\n&  ORDRES')).toBe('7. ARTICULATION & ORDRES');
    });

    it('convertit les apostrophes typographiques ’ en apostrophe droite \'', () => {
        expect(normalize('L’UNITÉ')).toBe("L'UNITÉ");
    });

    it('conserve les tirets – et — tels quels (aucune substitution)', () => {
        expect(normalize('avant – après — fin')).toBe('avant – après — fin');
    });

    it('rogne les espaces de tête/fin après collapse', () => {
        expect(normalize('   texte   ')).toBe('texte');
    });

    it('normalise en NFC (formes composées/décomposées équivalentes)', () => {
        const nfc = 'É'; // U+00C9, forme précomposée
        const nfd = 'É'; // E + accent combinant, forme décomposée
        expect(normalize(nfd)).toBe(normalize(nfc));
    });
});

// ===========================================================================
// parsePdfFonts() — sortie tabulaire réelle de `pdffonts` (poppler 26.07.0),
// mesurée au banc sur l'étalon raster ET sur un PDF pdfmake réel (3 polices
// CID TrueType embarquées Oswald/JetBrainsMono, cf. tests/pdf/README.md).
// ===========================================================================
describe('parsePdfFonts()', () => {
    it('parse les 3 polices embarquées attendues du moteur v3 (colonne "type" à espace interne)', () => {
        const output = [
            'name                                 type              encoding         emb sub uni object ID',
            '------------------------------------ ----------------- ---------------- --- --- --- ---------',
            'BZZZZZ+Oswald-Medium                 CID TrueType      Identity-H       yes yes yes      9  0',
            'CZZZZZ+JetBrainsMono-Regular         CID TrueType      Identity-H       yes yes yes     10  0',
            'DZZZZZ+JetBrainsMono-Bold            CID TrueType      Identity-H       yes yes yes     11  0',
        ].join('\n');

        const fonts = parsePdfFonts(output);

        expect(fonts).toHaveLength(3);
        expect(fonts[0]).toEqual({
            name: 'BZZZZZ+Oswald-Medium',
            type: 'CID TrueType',
            encoding: 'Identity-H',
            emb: 'yes',
            sub: 'yes',
            uni: 'yes',
        });
        expect(fonts.every((f: { emb: string; sub: string }) => f.emb === 'yes' && f.sub === 'yes')).toBe(true);
    });

    it('parse les 14 polices standard NON embarquées de l\'étalon raster (emb=no sub=no)', () => {
        const output = [
            'name                                 type              encoding         emb sub uni object ID',
            '------------------------------------ ----------------- ---------------- --- --- --- ---------',
            'Helvetica                            Type 1            WinAnsi          no  no  no      31  0',
            'ZapfDingbats                         Type 1            ZapfDingbats     no  no  no      43  0',
        ].join('\n');

        const fonts = parsePdfFonts(output);

        expect(fonts).toHaveLength(2);
        expect(fonts.every((f: { emb: string }) => f.emb === 'no')).toBe(true);
    });

    it('ignore l\'en-tête et la ligne de tirets (0 police pour une sortie vide)', () => {
        const output = [
            'name                                 type              encoding         emb sub uni object ID',
            '------------------------------------ ----------------- ---------------- --- --- --- ---------',
        ].join('\n');

        expect(parsePdfFonts(output)).toEqual([]);
    });
});

// ===========================================================================
// parsePdfImages() — sortie tabulaire réelle de `pdfimages -list` (14
// images de l'étalon raster, mesurée au banc).
// ===========================================================================
describe('parsePdfImages()', () => {
    it('parse une ligne d\'image (largeur/hauteur/ppi) telle que mesurée sur reference.pdf', () => {
        const output = [
            'page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio',
            '--------------------------------------------------------------------------------------------',
            '   1     0 image    1750  1389  rgb     3   8  jpeg   no        45  0   150   168  182K 2.6%',
        ].join('\n');

        const images = parsePdfImages(output);

        expect(images).toEqual([{ page: 1, type: 'image', width: 1750, height: 1389, xppi: 150, yppi: 168 }]);
    });

    it('ignore l\'en-tête et la ligne de tirets (0 image pour une sortie vide)', () => {
        const output = [
            'page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio',
            '--------------------------------------------------------------------------------------------',
        ].join('\n');

        expect(parsePdfImages(output)).toEqual([]);
    });

    it('parse plusieurs pages (une image par page, comme les 14 pages de l\'étalon)', () => {
        const lines = [
            'page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio',
            '--------------------------------------------------------------------------------------------',
        ];
        for (let p = 1; p <= 14; p++) {
            lines.push(`  ${p}     0 image    1750  1389  rgb     3   8  jpeg   no        ${44 + p}  0   150   168  182K 2.6%`);
        }
        const images = parsePdfImages(lines.join('\n'));
        expect(images).toHaveLength(14);
        expect(images.map((i: { page: number }) => i.page)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    });
});

// ===========================================================================
// assertA1_geometry — pages ≥ 12, dimensions homogènes ±0.5pt
// ===========================================================================
describe('assertA1_geometry()', () => {
    const homogeneousA4 = (pageCount: number) => ({
        pageCount,
        pageSizes: Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, width: 841.89, height: 595.28 })),
    });

    it('PASS : 14 pages A4 homogènes', () => {
        const r = assertA1_geometry(homogeneousA4(14), 'a4');
        expect(r.ok).toBe(true);
    });

    it('FAIL : moins de 8 pages (plancher recalibré mission P4, layout « une page = un usage »)', () => {
        const r = assertA1_geometry(homogeneousA4(7), 'a4');
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/7/);
    });

    it('PASS : exactement 8 pages (plancher recalibré)', () => {
        expect(assertA1_geometry(homogeneousA4(8), 'a4').ok).toBe(true);
    });

    it('FAIL : une page hors tolérance ±0.5pt', () => {
        const data = homogeneousA4(12);
        data.pageSizes[5] = { page: 6, width: 900, height: 600 };
        const r = assertA1_geometry(data, 'a4');
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/page 6/);
    });

    it('PASS : format 16:9 avec les dimensions cibles correspondantes', () => {
        const data = {
            pageCount: 12,
            pageSizes: Array.from({ length: 12 }, (_, i) => ({ page: i + 1, width: 958.11, height: 539.01 })),
        };
        expect(assertA1_geometry(data, '16:9').ok).toBe(true);
    });

    it('tolère exactement ±0.5pt (limite incluse)', () => {
        const data = homogeneousA4(12);
        data.pageSizes[0] = { page: 1, width: 841.89 + 0.5, height: 595.28 - 0.5 };
        expect(assertA1_geometry(data, 'a4').ok).toBe(true);
    });

    it('FAIL : au-delà de ±0.5pt', () => {
        const data = homogeneousA4(12);
        data.pageSizes[0] = { page: 1, width: 841.89 + 0.51, height: 595.28 };
        expect(assertA1_geometry(data, 'a4').ok).toBe(false);
    });
});

// ===========================================================================
// assertA2_realText — ≥ 1500 caractères non blancs
// ===========================================================================
describe('assertA2_realText()', () => {
    it('FAIL : texte vide (signature de l\'étalon raster)', () => {
        expect(assertA2_realText('\n\n\n').ok).toBe(false);
    });

    it('PASS : ≥ 1500 caractères non blancs', () => {
        expect(assertA2_realText('a'.repeat(1500)).ok).toBe(true);
    });

    it('FAIL : 1499 caractères non blancs (juste sous le seuil)', () => {
        expect(assertA2_realText('a'.repeat(1499)).ok).toBe(false);
    });

    it('ne compte pas les espaces/retours à la ligne', () => {
        const text = `a `.repeat(1500); // 1500 'a' non blancs + 1500 espaces ignorés
        expect(assertA2_realText(text).ok).toBe(true);
    });
});

// ===========================================================================
// assertA3_sectionOrder — ordre strictement croissant, strict vs --lenient
// ===========================================================================
describe('assertA3_sectionOrder()', () => {
    const buildFullText = () => MARKERS.map((m: { text: string }) => m.text).join('\n\n--- texte de remplissage ---\n\n');

    it('PASS strict : les 15 marqueurs présents dans l\'ordre', () => {
        const r = assertA3_sectionOrder(buildFullText(), { lenient: false });
        expect(r.ok).toBe(true);
    });

    it('FAIL strict : un marqueur conditionnel manquant fait échouer', () => {
        const text = MARKERS.filter((m: { n: number }) => m.n !== 4)
            .map((m: { text: string }) => m.text)
            .join('\n');
        const r = assertA3_sectionOrder(text, { lenient: false });
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/2\.1 FICHE ADVERSAIRE/);
    });

    it('PASS --lenient : un marqueur conditionnel manquant devient SKIP, pas un FAIL', () => {
        const text = MARKERS.filter((m: { n: number }) => m.n !== 4)
            .map((m: { text: string }) => m.text)
            .join('\n');
        const r = assertA3_sectionOrder(text, { lenient: true });
        expect(r.ok).toBe(true);
        expect(r.detail).toMatch(/SKIP/);
        expect(r.detail).toMatch(/#4/);
    });

    it('FAIL --lenient : un marqueur NON conditionnel manquant fait quand même échouer', () => {
        const text = MARKERS.filter((m: { n: number }) => m.n !== 1)
            .map((m: { text: string }) => m.text)
            .join('\n');
        const r = assertA3_sectionOrder(text, { lenient: true });
        expect(r.ok).toBe(false);
    });

    it('FAIL : ordre inversé (marqueur présent mais avant son prédécesseur)', () => {
        const swapped = [...MARKERS];
        [swapped[0], swapped[1]] = [swapped[1], swapped[0]]; // #1 et #2 échangés
        const text = swapped.map((m: { text: string }) => m.text).join('\n');
        const r = assertA3_sectionOrder(text, { lenient: false });
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/ordre rompu/);
    });

    it('applique normalize() avant recherche (espaces multiples/apostrophe typographique tolérés)', () => {
        const text = MARKERS.map((m: { text: string }) => m.text.replace(/'/g, '’').replace(/ /g, '  ')).join(
            '\n\n'
        );
        const r = assertA3_sectionOrder(text, { lenient: false });
        expect(r.ok).toBe(true);
    });

    // Défaut 1 (balayage 2026-08-19) : `document-builder.ts::makeSectionNumberer`
    // applique une renumérotation CONTINUE dérivée de l'ordre effectif — une
    // section omise (TRANSPORT sans photo, CAT/PATRACDVR sans donnée) ne
    // consomme pas de numéro, donc les sections suivantes REMONTENT d'un rang.
    // Les 2 tests ci-dessous simulent un texte pdftotext RÉALISTE (numéros
    // DÉCALÉS, pas les numéros canoniques de `buildFullText()`), ce que
    // l'ancienne liste figée de libellés numérotés ne pouvait pas valider.
    it('PASS : TRANSPORT (#6) omis et sections suivantes décalées d\'un rang (5.→4., 6.→5., 7.→6., 8.→7., 9.→8., renumérotation continue attendue)', () => {
        const text = [
            'ORDRE INITIAL',
            '1. SITUATION GLOBALE',
            'CIBLES(S)',
            '3. ENVIRONNEMENT ET AMIS',
            "4. MISSION DE L'UNITÉ",
            '5. EXÉCUTION',
            '6. ARTICULATION & ORDRES DE MOUVEMENT',
            '7. CONDUITES À TENIR GÉNÉRALES',
            '8. RÉCAPITULATIF PATRACDVR',
            'AVEZ-VOUS DES QUESTIONS ?',
        ].join('\n\n');
        const r = assertA3_sectionOrder(text, { lenient: true });
        expect(r.ok).toBe(true);
        expect(r.detail).toMatch(/numérotation dérivée continue/);
    });

    it('FAIL : TRANSPORT omis mais MISSION reste à "5." (trou de numérotation, ancien bug reproduit) — numérotation rompue détectée', () => {
        const text = [
            'ORDRE INITIAL',
            '1. SITUATION GLOBALE',
            'CIBLES(S)',
            '3. ENVIRONNEMENT ET AMIS',
            "5. MISSION DE L'UNITÉ", // devrait être « 4. » — TRANSPORT (#6) est absent
            '6. EXÉCUTION',
            '7. ARTICULATION & ORDRES DE MOUVEMENT',
            '8. CONDUITES À TENIR GÉNÉRALES',
            '9. RÉCAPITULATIF PATRACDVR',
            'AVEZ-VOUS DES QUESTIONS ?',
        ].join('\n\n');
        const r = assertA3_sectionOrder(text, { lenient: true });
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/numérotation rompue/);
    });
});

// ===========================================================================
// assertA4_duplicateSevenPreserved — exactement 2 titres « 7. »
// ===========================================================================
describe('assertA4_duplicateSevenPreserved()', () => {
    it('PASS : exactement 2 titres « 7. XXX »', () => {
        const text = '7. ARTICULATION & ORDRES DE MOUVEMENT\n...\n7. RÉCAPITULATIF PATRACDVR';
        expect(assertA4_duplicateSevenPreserved(text).ok).toBe(true);
    });

    it('FAIL : 0 titre « 7. » (texte vide, cf. étalon raster)', () => {
        expect(assertA4_duplicateSevenPreserved('').ok).toBe(false);
    });

    it('FAIL : 1 seul titre « 7. » (section perdue/renumérotée)', () => {
        expect(assertA4_duplicateSevenPreserved('7. ARTICULATION & ORDRES DE MOUVEMENT').ok).toBe(false);
    });

    it('FAIL : 3 titres « 7. » (renumérotation accidentelle en trop)', () => {
        const text = '7. UN\n7. DEUX\n7. TROIS';
        expect(assertA4_duplicateSevenPreserved(text).ok).toBe(false);
    });

    it('ne matche pas un numéro de liste « 7. » suivi de minuscule (pas un TITRE)', () => {
        const text = '7. article suivant\n7. autre ligne';
        expect(assertA4_duplicateSevenPreserved(text).ok).toBe(false);
    });
});

// ===========================================================================
// assertA5_embeddedFonts
// ===========================================================================
describe('assertA5_embeddedFonts()', () => {
    const embeddedTrio = [
        { name: 'AAA+Oswald-Medium', type: 'CID TrueType', encoding: 'Identity-H', emb: 'yes', sub: 'yes', uni: 'yes' },
        { name: 'BBB+JetBrainsMono-Regular', type: 'CID TrueType', encoding: 'Identity-H', emb: 'yes', sub: 'yes', uni: 'yes' },
        { name: 'CCC+JetBrainsMono-Bold', type: 'CID TrueType', encoding: 'Identity-H', emb: 'yes', sub: 'yes', uni: 'yes' },
    ];

    it('PASS : 3 polices embarquées, Oswald + JetBrainsMono présentes', () => {
        expect(assertA5_embeddedFonts(embeddedTrio).ok).toBe(true);
    });

    it('FAIL : moins de 3 polices', () => {
        expect(assertA5_embeddedFonts(embeddedTrio.slice(0, 2)).ok).toBe(false);
    });

    it('FAIL : une police non embarquée (signature de l\'étalon raster jsPDF)', () => {
        const fonts = [
            ...embeddedTrio,
            { name: 'Helvetica', type: 'Type 1', encoding: 'WinAnsi', emb: 'no', sub: 'no', uni: 'no' },
        ];
        const r = assertA5_embeddedFonts(fonts);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/Helvetica/);
    });

    it('FAIL : famille Oswald absente', () => {
        const fonts = embeddedTrio.filter((f) => !f.name.includes('Oswald'));
        const r = assertA5_embeddedFonts(fonts.concat(fonts)); // ≥3 lignes, toujours 0 Oswald
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/Oswald/);
    });

    it('FAIL : famille JetBrainsMono absente', () => {
        // 3 polices (≥3, ne déclenche pas le garde « moins de 3 »), toutes
        // Oswald, aucune JetBrainsMono.
        const fonts = [embeddedTrio[0], embeddedTrio[0], embeddedTrio[0]];
        const r = assertA5_embeddedFonts(fonts);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/JetBrainsMono/);
    });
});

// ===========================================================================
// assertA6_noRasterization
// ===========================================================================
describe('assertA6_noRasterization()', () => {
    const a4PdfInfo = (pageCount: number) => ({
        pageCount,
        pageSizes: Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, width: 841.89, height: 595.28 })),
    });

    it('PASS : 0 image, limite --photos=0', () => {
        expect(assertA6_noRasterization([], a4PdfInfo(14), 0).ok).toBe(true);
    });

    it('FAIL : nombre d\'images dépasse la limite --photos', () => {
        const images = [{ page: 1, type: 'image', width: 100, height: 100, xppi: 150, yppi: 150 }];
        expect(assertA6_noRasterization(images, a4PdfInfo(14), 0).ok).toBe(false);
    });

    it('FAIL : signature html2canvas+jsPDF (nb_images == nb_pages, une image pleine page)', () => {
        // Reproduit exactement la mesure de l'étalon raster : 1750x1389px
        // @150x168ppi sur une page A4 paysage (841.89 x 595.28 pts) ≈ 99.8%.
        const images = [{ page: 1, type: 'image', width: 1750, height: 1389, xppi: 150, yppi: 168 }];
        const r = assertA6_noRasterization(images, a4PdfInfo(1), 14);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/signature de rastérisation/);
    });

    it('PASS : nb_images == nb_pages mais AUCUNE image ne couvre ≥80% (vraies photos, pas une capture pleine page)', () => {
        // Petite vignette 200x150px sur une page A4 paysage : couverture négligeable.
        const images = [{ page: 1, type: 'image', width: 200, height: 150, xppi: 150, yppi: 150 }];
        const r = assertA6_noRasterization(images, a4PdfInfo(1), 1);
        expect(r.ok).toBe(true);
    });

    it('ignore une image sans ppi exploitable (0/NaN) plutôt que de planter', () => {
        const images = [{ page: 1, type: 'image', width: 1750, height: 1389, xppi: 0, yppi: 0 }];
        expect(() => assertA6_noRasterization(images, a4PdfInfo(1), 1)).not.toThrow();
    });
});

// ===========================================================================
// assertA7_weight — inconditionnel (cf. commentaire dans verify-structure.mjs
// et tests/pdf/README.md : la mention SPEC « avec --photos=0 » décrit le
// scénario nominal de calibrage du seuil, pas une garde d'exécution).
// ===========================================================================
describe('assertA7_weight()', () => {
    it('PASS : taille ≤ 1 Mio', () => {
        expect(assertA7_weight(1_048_576).ok).toBe(true);
    });

    it('FAIL : taille > 1 Mio (ex. 2,53 Mo de l\'étalon raster)', () => {
        expect(assertA7_weight(2_530_347).ok).toBe(false);
    });

    it('FAIL : 1 048 577 octets (juste au-dessus du seuil)', () => {
        expect(assertA7_weight(1_048_577).ok).toBe(false);
    });
});

// ===========================================================================
// assertA8_sampleData
// ===========================================================================
describe('assertA8_sampleData()', () => {
    it('SKIP (ok=true) si aucun --sample fourni', () => {
        const r = assertA8_sampleData('texte quelconque', undefined);
        expect(r.ok).toBe(true);
        expect(r.skip).toBe(true);
    });

    it('FAIL si le fichier d\'échantillon est introuvable', () => {
        const r = assertA8_sampleData('texte', '/chemin/inexistant.json');
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/introuvable/);
    });
});

// ===========================================================================
// B1/B2/B5/B6/B9 — guardrail pagination CONSERVÉ/ADAPTÉ (mission P4)
// ===========================================================================
describe('assertB1_noOrphanPage()', () => {
    it('PASS : aucune page orpheline (garde/finale/photo exclues, contenu suffisant ailleurs)', () => {
        const text = joinPages(['GARDE', 'a'.repeat(200), 'FINALE']);
        expect(assertB1_noOrphanPage(text, []).ok).toBe(true);
    });

    it('FAIL : une page intermédiaire sous 120 caractères non blancs', () => {
        const text = joinPages(['GARDE', 'trop court', 'FINALE']);
        const r = assertB1_noOrphanPage(text, []);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/page 2/);
    });

    it('PASS : une page orpheline exemptée car elle porte une image (page photo)', () => {
        const text = joinPages(['GARDE', 'légende courte', 'FINALE']);
        const images = [{ page: 2, type: 'image', width: 100, height: 100, xppi: 150, yppi: 150 }];
        expect(assertB1_noOrphanPage(text, images).ok).toBe(true);
    });
});

describe('assertB2_noVerticalWordSplit()', () => {
    it('SKIP si aucun tableau PATRACDVR dans le document', () => {
        const r = assertB2_noVerticalWordSplit('texte sans marqueur PATRACDVR');
        expect(r.ok).toBe(true);
        expect(r.skip).toBe(true);
    });

    it('FAIL : mot capitalisé scindé sur 2 lignes adjacentes à la même colonne', () => {
        // '9.' (pas '7.') : MARKERS[13] porte désormais la numérotation
        // continue post-fix (SPEC-2026-08-18-pdf-et-champs.md §6).
        const text = `9. RÉCAPITULATIF PATRACDVR\nSHARA\nN reste\nAVEZ-VOUS DES QUESTIONS ?`;
        const r = assertB2_noVerticalWordSplit(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/SHARAN/);
    });

    it('PASS : aucun mot cassé dans la section PATRACDVR', () => {
        const text = `9. RÉCAPITULATIF PATRACDVR\nSHARAN complet\nAVEZ-VOUS DES QUESTIONS ?`;
        expect(assertB2_noVerticalWordSplit(text).ok).toBe(true);
    });

    // Défaut 1 (balayage 2026-08-19) : PATRACDVR ne porte « 9. » que si RIEN
    // n'est omis en amont — sans TRANSPORT il devient « 8. » (renumérotation
    // continue, document-builder.ts::makeSectionNumberer). `numberedMarkerSuffix`
    // doit donc localiser la section par SUFFIXE, pas par le texte canonique
    // complet, sous peine de SKIP à tort (la garde anti-césure ne tournerait
    // alors plus jamais sur ce cas, pourtant réel — ex. long-case.json).
    it('FAIL : localise la section PATRACDVR même renumérotée "8." (TRANSPORT omis) et détecte le mot cassé', () => {
        const text = `8. RÉCAPITULATIF PATRACDVR\nSHARA\nN reste\nAVEZ-VOUS DES QUESTIONS ?`;
        const r = assertB2_noVerticalWordSplit(text);
        expect(r.ok).toBe(false);
        expect(r.skip).toBeFalsy();
        expect(r.detail).toMatch(/SHARAN/);
    });
});

describe('assertB5_noEmptyFieldDominatedPage()', () => {
    it('FAIL : page dominée par ≥4 libellés vides "LABEL : -" et peu de contenu', () => {
        const page = ['STRUCTURE : -', 'SERRURERIE : -', 'ENVIRONNEMENT : -', 'H. PORTE : -'].join('\n');
        const r = assertB5_noEmptyFieldDominatedPage(page);
        expect(r.ok).toBe(false);
    });

    it('PASS : moins de 4 libellés vides sur la page', () => {
        const page = ['STRUCTURE : -', 'SERRURERIE : -'].join('\n');
        expect(assertB5_noEmptyFieldDominatedPage(page).ok).toBe(true);
    });
});

describe('assertB6_verticalFillRatio()', () => {
    const bboxPages = (ratios: number[], height = 100) =>
        ratios.map((r) => ({ width: 200, height, maxYMax: r * height }));

    it('FAIL : page composite (hors usage à contrat dur) sous 35% de remplissage', () => {
        const text = joinPages(['3. ENVIRONNEMENT ET AMIS', 'AVEZ-VOUS DES QUESTIONS ?']);
        const r = assertB6_verticalFillRatio(bboxPages([0.1, 0.5]), text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/page 1/);
    });

    it('PASS : fiche adversaire (usage à contrat dur) exemptée même peu remplie', () => {
        const text = joinPages(['2.1 FICHE ADVERSAIRE : X', 'AVEZ-VOUS DES QUESTIONS ?']);
        expect(assertB6_verticalFillRatio(bboxPages([0.1, 0.5]), text).ok).toBe(true);
    });

    it('FAIL : page effraction "MISSION & CARACTÉRISTIQUES" clairsemée SUIVIE d\'une page "HYPOTHÈSES" du même bloc (continuation suspecte)', () => {
        const text = joinPages([
            'ARTICULATION : EFFRACTION - X — MISSION & CARACTÉRISTIQUES',
            'ARTICULATION : EFFRACTION - X — HYPOTHÈSES 1-2',
            'AVEZ-VOUS DES QUESTIONS ?',
        ]);
        const r = assertB6_verticalFillRatio(bboxPages([0.1, 0.9, 0.5]), text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/page 1/);
    });

    it('PASS : dernière page effraction du groupe exemptée (rien ne suit)', () => {
        const text = joinPages(['ARTICULATION : EFFRACTION - X — HYPOTHÈSES 3-4', 'AVEZ-VOUS DES QUESTIONS ?']);
        expect(assertB6_verticalFillRatio(bboxPages([0.1, 0.5]), text).ok).toBe(true);
    });
});

describe('assertB9_noTrailingTitle()', () => {
    it('FAIL : page se terminant par un titre/en-tête orphelin', () => {
        const text = joinPages(['contenu\nDANGEROSITÉ', 'FINALE']);
        const r = assertB9_noTrailingTitle(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/page 1/);
    });

    it('PASS : titre suivi de contenu sur la même page', () => {
        const text = joinPages(['DANGEROSITÉ\ndonnées ici', 'FINALE']);
        expect(assertB9_noTrailingTitle(text).ok).toBe(true);
    });
});

// ===========================================================================
// C1..C5 — gardes de CONTRAT mission P4 (« une page = un usage »)
// ===========================================================================
describe('assertC1_zeroSuiteFragment()', () => {
    it('FAIL : "(SUITE)" sur une page SANS image (usage à contrat dur)', () => {
        const text = joinPages(['ARTICULATION : ZMSPCP - X (SUITE)']);
        const r = assertC1_zeroSuiteFragment(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/: 1$/);
    });

    it('FAIL : "(SUITE)" interdit même sur une page de galerie photo (mission R6, plus aucune exemption)', () => {
        const text = joinPages(['ADVERSAIRE : X (PHOTOS ANNEXES) (SUITE)']);
        const r = assertC1_zeroSuiteFragment(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/: 1$/);
    });

    it('PASS : aucune occurrence de "(SUITE)"', () => {
        expect(assertC1_zeroSuiteFragment(joinPages(['rien à signaler'])).ok).toBe(true);
    });

    it('PASS : compteur de galerie "PHOTO i/N" ne matche pas SUITE_RE', () => {
        const text = joinPages(['TITRE GALERIE — PHOTO 2/5']);
        expect(assertC1_zeroSuiteFragment(text).ok).toBe(true);
    });
});

describe('assertC2_adversaryFicheSinglePage()', () => {
    it('PASS : contenu de fiche uniquement sur des pages portant son titre', () => {
        const text = joinPages(['2.1 FICHE ADVERSAIRE : X\nIDENTITÉ\nDANGEROSITÉ', 'autre page']);
        expect(assertC2_adversaryFicheSinglePage(text).ok).toBe(true);
    });

    it('FAIL : signature de contenu fiche (ex. ATCD) sur une page SANS titre "N.M FICHE ADVERSAIRE"', () => {
        const text = joinPages(['2.1 FICHE ADVERSAIRE : X\nIDENTITÉ', 'ATCD débordant ici sans titre']);
        const r = assertC2_adversaryFicheSinglePage(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/page 2/);
    });
});

describe('assertC3_articulationBlockSinglePage()', () => {
    it('PASS : "Composition par Cellule" uniquement sur la page titrée', () => {
        const text = joinPages(['ARTICULATION : ZMSPCP - X\nComposition par Cellule', 'autre page']);
        expect(assertC3_articulationBlockSinglePage(text).ok).toBe(true);
    });

    it('FAIL : "Composition par Cellule" sur une page sans titre ZMSPCP/MOICP', () => {
        const text = joinPages(['ARTICULATION : MOICP - X', 'Composition par Cellule débordante']);
        const r = assertC3_articulationBlockSinglePage(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/: 2$/);
    });
});

describe('assertC4_effractionAutonomousPages()', () => {
    it('PASS : pages autonomes à plages non chevauchantes', () => {
        const text = joinPages([
            'ARTICULATION : EFFRACTION - X — MISSION & CARACTÉRISTIQUES\nHypothèses d\'Effraction',
            'ARTICULATION : EFFRACTION - X — HYPOTHÈSES 3-4\nHypothèses d\'Effraction',
        ]);
        expect(assertC4_effractionAutonomousPages(text).ok).toBe(true);
    });

    it('FAIL : contenu Hypothèses d\'Effraction sur une page sans titre effraction (spillover)', () => {
        const text = joinPages(['ARTICULATION : EFFRACTION - X\nHypothèses d\'Effraction', 'Technique / Moyen débordant']);
        const r = assertC4_effractionAutonomousPages(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/spillover|débordement/);
    });

    it('FAIL : plages "HYPOTHÈSES" chevauchantes pour le même titre de base', () => {
        const text = joinPages([
            'ARTICULATION : EFFRACTION - X — MISSION & CARACTÉRISTIQUES',
            'ARTICULATION : EFFRACTION - X — HYPOTHÈSES 1-2',
            'ARTICULATION : EFFRACTION - X — HYPOTHÈSES 2-3',
        ]);
        const r = assertC4_effractionAutonomousPages(text);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/chevauche/);
    });
});

describe('assertC5_fixtureIntegrity()', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pdf-p8-c5-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('SKIP si --fixture non fourni', () => {
        const r = assertC5_fixtureIntegrity('texte', undefined);
        expect(r.ok).toBe(true);
        expect(r.skip).toBe(true);
    });

    it('FAIL si le fichier fixture est introuvable', () => {
        const r = assertC5_fixtureIntegrity('texte', '/chemin/inexistant.json');
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/introuvable/);
    });

    it('PASS : chaîne saisie (≥ 12 car.) intégralement présente dans le texte extrait', () => {
        const fixturePath = join(dir, 'fixture.json');
        writeFileSync(fixturePath, JSON.stringify({ formData: { situation_generale: 'Une situation suffisamment longue pour compter.' } }));
        const r = assertC5_fixtureIntegrity('SITUATION GÉNÉRALE : Une situation suffisamment longue pour compter.', fixturePath);
        expect(r.ok).toBe(true);
    });

    it('FAIL : chaîne saisie absente du texte extrait (troncature)', () => {
        const fixturePath = join(dir, 'fixture.json');
        writeFileSync(fixturePath, JSON.stringify({ formData: { situation_generale: 'Ce texte ne sera jamais présent dans le rendu final.' } }));
        const r = assertC5_fixtureIntegrity('texte totalement différent, sans rapport', fixturePath);
        expect(r.ok).toBe(false);
        expect(r.detail).toMatch(/manquante/);
    });

    it('ignore les clés id/annotations/tools/title/options (jamais rendues verbatim) — seul le champ non filtré compte', () => {
        const fixturePath = join(dir, 'fixture.json');
        writeFileSync(
            fixturePath,
            JSON.stringify({
                formData: {
                    id: 'identifiant-jamais-rendu-1234567890',
                    tools: '["PORTE","BELIER-DE-DEMOLITION"]',
                    options: { fonctions: ['Une fonction jamais choisie mais listée'] },
                    missions_psig: 'Mission réellement rendue dans le document final.',
                },
            }),
        );
        const r = assertC5_fixtureIntegrity('MISSION : Mission réellement rendue dans le document final.', fixturePath);
        expect(r.ok).toBe(true);
    });
});
