/**
 * oi-pdf-fonts-ponctuation.test.ts — Garde de l'incident de production du
 * 2026-08-02 (audit PDF du 2026-09-25).
 *
 * Les polices embarquées dans `PDF_FONT_VFS` (`fonts.generated.ts`, produit par
 * `npm run gen:pdf-fonts`) étaient deux copies d'une fonte JetBrains Mono issue
 * de la lignée Google Fonts. Cette fonte porte des tables `GSUB` (`calt`,
 * ligatures) qui font jeter le moteur de rendu DÈS QUE le texte contient une
 * suite de ponctuation de programmeur :
 *
 *   `...`  `??`  `->`  `=>`  `---`  `::`  `!=`  `<=`  `###`  `||`  `&&` ...
 *
 * Conséquences constatées : l'OI ne sortait plus du tout (pdfmake, en production
 * depuis le 02/08 : un seul « RAS... » dans la situation générale suffisait,
 * l'utilisateur voyait « Erreur de génération » pendant 4 s) ; PC-Tac partageait
 * le défaut depuis qu'il a reçu cette police (décision 34) — pdf-lib jetait
 * « Trying to access beyond buffer length ».
 *
 * Ce fichier reproduit la panne HORS APPLICATION, avec les deux moteurs de
 * rendu réellement utilisés, et sur les octets réellement embarqués :
 *
 *  - `layout()` de fontkit — c'est la couche que pdfmake (OI) traverse ;
 *  - `embedFont()` + `drawText()` de pdf-lib — c'est le chemin de PC-Tac.
 *
 * Les polices doivent rester SANS ligature (variante officielle `NL`). Les
 * agents du 2026-09-25 ont mesuré que désactiver les ligatures par option
 * répare pdf-lib mais pas pdfmake : la seule garde fiable porte sur la police
 * elle-même, d'où ce test.
 */

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { PDF_FONT_VFS } from '@oi/pdf/fonts.js';

/**
 * Suites de ponctuation qui font jeter les moteurs. La liste est celle de
 * l'audit, plus les exemples réels cités par les agents (« RAS... », « Qui ?? »)
 * et des variantes courtes/longues des mêmes suites.
 */
const SUITES = [
    // Suites isolées
    '...',
    '..',
    '....',
    '??',
    '?',
    '->',
    '=>',
    '---',
    '--',
    '::',
    ':',
    '!=',
    '<=',
    '>=',
    '===',
    '###',
    '#',
    '||',
    '&&',
    '<->',
    '<=>',
    '/* */',
    '\\\\',
    '<<',
    '>>',
    '~~',
    'www',
    // Textes réels du terrain
    'RAS...',
    'Qui ??',
    'Contact ?',
    'Rien à signaler...',
    'Statut : RAS... suite au contrôle.',
    'Position -> carrefour D951/::',
    'Effectif :: 4 || 6',
    'Doute ?? => vérifier',
    'SITUATION ### RAS...',
    'Accents : éàùçœ€ ’ « »',
];

/** Décode le base64 du VFS en octets de police. */
function octets(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Base64 de la police `cle` — échoue explicitement si la clé manque. */
function base64(cle: string): string {
    const valeur = PDF_FONT_VFS[cle] as string | undefined;
    if (!valeur) throw new Error(`police absente du VFS : ${cle}`);
    return valeur;
}

describe('polices PDF embarquées — suites de ponctuation', () => {
    const cles = Object.keys(PDF_FONT_VFS);

    it('embarque les trois polices attendues', () => {
        expect(cles).toEqual(
            expect.arrayContaining(['Oswald-500.ttf', 'JetBrainsMono-400.ttf', 'JetBrainsMono-700.ttf']),
        );
    });

    describe.each(cles)('%s', (cle) => {
        it('se met en page sans jeter (fontkit, la couche de pdfmake)', () => {
            const police = fontkit.create(octets(base64(cle)));
            for (const suite of SUITES) {
                expect(() => police.layout(suite), `suite « ${suite} »`).not.toThrow();
            }
        });

        it('rend chaque suite avec un glyphe réel (aucun .notdef)', () => {
            const police = fontkit.create(octets(base64(cle)));
            for (const suite of SUITES) {
                const glyphes = police.layout(suite).glyphs;
                const manquants = glyphes.filter((g) => g.id === 0).length;
                expect(manquants, `suite « ${suite} »`).toBe(0);
            }
        });

        it('produit un PDF pdf-lib (le chemin de PC-Tac)', async () => {
            const doc = await PDFDocument.create();
            doc.registerFontkit(fontkit);
            const police = await doc.embedFont(octets(base64(cle)), { subset: true });
            const page = doc.addPage([595.28, 841.89]);

            let y = 800;
            for (const suite of SUITES) {
                expect(() => page.drawText(suite, { x: 40, y, size: 12, font: police }), `suite « ${suite} »`).not.toThrow();
                y -= 16;
            }

            const octetsPdf = await doc.save();
            expect(octetsPdf.byteLength).toBeGreaterThan(1000);
            expect(String.fromCharCode(...octetsPdf.slice(0, 4))).toBe('%PDF');
        });
    });
});
