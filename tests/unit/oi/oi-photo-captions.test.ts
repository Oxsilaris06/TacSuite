/**
 * Légendes des photos de l'OI (Nico 2026-09-26) :
 *  - par défaut, le nom du bouton du champ puis le rang sur le nombre de
 *    photos du champ : « Baptême terrain (1/2) », « (2/2) » ;
 *  - la saisie est bloquée au nombre de caractères que le PDF imprime en
 *    entier, dans toutes ses mises en page (A4 et 16:9, 1 à 4 photos par page).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Content } from 'pdfmake/interfaces';
import { OI_PHOTO_CAPTION_MAX, photoFieldLabel, withDefaultCaptions } from '@oi/sections.js';
import { galleryPages, splitGalleryPages } from '@oi/pdf/blocks.js';
import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';
import { pageGeometry, PDF_LIGHT } from '@oi/pdf/theme.js';
import type { OiPhotoMeta } from '@shared/types/contracts.js';

const meta = (id: string, customTitle = '', tools = '[]'): OiPhotoMeta => ({ id, annotations: '[]', tools, other_tools: '', customTitle });

/** Légendes imprimées (texte sous les images, `characterSpacing` de `figure`). */
function captionsOf(node: unknown): string[] {
    const out: string[] = [];
    JSON.stringify(node, (_k, v: unknown) => {
        if (v && typeof v === 'object' && 'characterSpacing' in v && 'text' in v) out.push(String((v as { text: unknown }).text));
        return v;
    });
    return out;
}

describe('nom par défaut d’un champ photo = libellé de son bouton', () => {
    it.each([
        ['photo_container_bapteme_terrain_preview_container', 'Baptême terrain'],
        ['photo_bapteme_z1', 'Baptême terrain'],
        ['photo_container_transport_pr_preview_container', 'Transport PSIG → PR'],
        ['photo_container_transport_domicile_preview_container', 'Transport PR → Domicile/LE'],
        ['photo_itin_ext_m1', 'Extérieur'],
        ['photo_itin_int_m1', 'Intérieur'],
        ['photo_empl_ao_z1', 'Emplacement AO'],
        ['photo_effrac_e1', 'Effraction'],
        ['photo_main_a1', 'Photo principale'],
        ['photo_extra_a1', 'Photos supplémentaires'],
        ['photo_renforts_a1', 'Renforts'],
        ['photo_container_express_objectif_preview_container', 'Objectif'],
        ['photo_container_express_adversaire_preview_container', 'Adversaire'],
        ['photo_container_express_carte_preview_container', 'Carte'],
        ['champ_inconnu', 'Photo'],
    ])('%s -> %s', (id, label) => {
        expect(photoFieldLabel(id)).toBe(label);
    });
});

describe('withDefaultCaptions', () => {
    it('légende vide ou blanche : « nom (rang/total) » ; légende saisie gardée ; copie', () => {
        const before = { photo_container_bapteme_terrain_preview_container: [meta('a'), meta('b', 'Portail'), meta('c', '   ')] };
        const out = withDefaultCaptions(before);
        expect(out.photo_container_bapteme_terrain_preview_container!.map((m) => m.customTitle))
            .toEqual(['Baptême terrain (1/3)', 'Portail', 'Baptême terrain (3/3)']);
        expect(before.photo_container_bapteme_terrain_preview_container[0]!.customTitle).toBe('');
    });
});

describe('PDF : légendes par défaut', () => {
    it('Baptême terrain (1/2), (2/2) ; MOICP : Extérieur puis Intérieur, chacun compté dans son champ ; plus de « - Détail »', () => {
        const dd = buildOiDocDefinition({
            formData: {
                missions_psig: 'X.',
                moicp_blocks: [{ id: 'm1', title: 'BRAVO', mission: '-', objectif: '-', itineraire: '-', points_particuliers: '-', cat: '-', place_chef: '-', members: [] }],
                dynamic_photos: {
                    photo_container_bapteme_terrain_preview_container: [meta('b1'), meta('b2')],
                    photo_itin_ext_m1: [meta('e1')],
                    photo_itin_int_m1: [meta('i1'), meta('i2', 'Couloir')],
                },
            },
            photosBase64: { b1: 'data:image/jpeg;base64,B1', b2: 'data:image/jpeg;base64,B2', e1: 'data:image/jpeg;base64,E1', i1: 'data:image/jpeg;base64,I1', i2: 'data:image/jpeg;base64,I2' },
            isDark: false,
        }, { format: 'a4' });
        const captions = captionsOf(dd.content);
        expect(captions).toEqual(expect.arrayContaining(['Baptême terrain (1/2)', 'Baptême terrain (2/2)', 'Extérieur (1/1)', 'Intérieur (1/2)', 'Couloir']));
        expect(JSON.stringify(dd.content)).not.toContain('- Détail');
    });
});

describe('PDF : numérotation sur les photos imprimées', () => {
    it('une photo sans image (absente de la base) ne compte pas : (1/2), (2/2) sous « PHOTOS 1-2/2 »', () => {
        const dd = buildOiDocDefinition({
            formData: { missions_psig: 'X.', dynamic_photos: { photo_container_bapteme_terrain_preview_container: [meta('b1'), meta('perdue'), meta('b3')] } },
            photosBase64: { b1: 'data:image/jpeg;base64,B1', b3: 'data:image/jpeg;base64,B3' },
            isDark: false,
        }, { format: 'a4' });
        expect(captionsOf(dd.content)).toEqual(['Baptême terrain (1/2)', 'Baptême terrain (2/2)']);
    });
});

const html = readFileSync(path.resolve(__dirname, '../../../oi/index.html'), 'utf8');

describe(`PDF : toute légende de ${OI_PHOTO_CAPTION_MAX} caractères au plus (limite du formulaire) est imprimée en entier`, () => {
    // Pire cas que le formulaire permet : les 12 outils du catalogue plus
    // « Outil Nouveau / Autre » à sa longueur maximale, sur la mise en page la
    // plus étroite (4 captures de téléphone par page), trois styles de texte
    // dont des mots longs (revue du 26/09 : 450 était coupé avec des outils).
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const catalog = Array.from(doc.querySelectorAll('.effrac-tool-btn')).map((b) => (b.textContent ?? '').trim());
    const otherMax = Number(doc.getElementById('effrac_other_tools')?.getAttribute('maxlength'));
    const TEXTS = [
        'Portail vert, digicode 4521B, chien signalé dans la cour arrière, accès garage. ',
        'Porte blindée, serrure multipoints, cornières renforcées, gonds invisibles. ',
        "Porte d'entrée en bois massif, serrure trois points, ouverture vers l'intérieur, judas optique, rez-de-chaussée, volets roulants électriques fermés la nuit. ",
    ];
    const SHAPES: [number, number][] = [[4000, 3000], [3000, 4000], [1080, 2340], [8000, 2000]];

    it('le formulaire borne « Outil Nouveau / Autre », le catalogue compte 12 outils', () => {
        expect(otherMax).toBeGreaterThan(0);
        expect(catalog).toHaveLength(12);
    });

    it.each(['a4', '16:9'] as const)('%s : toutes les formes, 1 à 4 photos par page, sans outil ou avec tous les outils', (format) => {
        const geo = pageGeometry(format);
        const toolSets: [string[], string][] = [[[], ''], [catalog, 'x'.repeat(otherMax)]];
        for (const base of TEXTS) {
            for (let n = 120; n <= OI_PHOTO_CAPTION_MAX; n += 10) {
                const text = base.repeat(10).slice(0, n).trim();
                for (const [w, h] of SHAPES) {
                    for (const [tools, other] of toolSets) {
                        const metas = [1, 2, 3, 4].map((i) => ({ ...meta(`p${i}`, text, JSON.stringify(tools)), other_tools: other }));
                        const base64 = Object.fromEntries(metas.map((m) => [m.id, 'img']));
                        const sizeOf = (): { widthPx: number; heightPx: number } => ({ widthPx: w, heightPx: h });
                        const pages: Content[] = [...galleryPages('G', metas, base64, PDF_LIGHT, geo, sizeOf), ...splitGalleryPages('B', metas.slice(0, 2), base64, PDF_LIGHT, geo, sizeOf), ...splitGalleryPages('B', metas.slice(0, 1), base64, PDF_LIGHT, geo, sizeOf)];
                        // 4 (galerie) + 2 + 1 (page Baptême) légendes entières ; les badges d'outils sont à part.
                        expect({ n, w, h, outils: tools.length, entieres: captionsOf(pages).filter((c) => c === text).length }).toEqual({ n, w, h, outils: tools.length, entieres: 7 });
                    }
                }
            }
        }
    });
});
