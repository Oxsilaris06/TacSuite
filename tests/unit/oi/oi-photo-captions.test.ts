/**
 * Légendes des photos de l'OI (Nico 2026-09-26) :
 *  - par défaut, le nom du bouton du champ puis le rang sur le nombre de
 *    photos du champ : « Baptême terrain (1/2) », « (2/2) » ;
 *  - la saisie est bloquée au nombre de caractères que le PDF imprime en
 *    entier, dans toutes ses mises en page (A4 et 16:9, 1 à 4 photos par page).
 */
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

describe(`PDF : une légende de ${OI_PHOTO_CAPTION_MAX} caractères (limite du formulaire) est imprimée en entier`, () => {
    const text = 'Portail vert, digicode 4521B, chien signalé dans la cour arrière, accès garage. '.repeat(20).slice(0, OI_PHOTO_CAPTION_MAX).trim();
    const SHAPES: Record<string, [number, number]> = { paysage: [4000, 3000], portrait: [3000, 4000], ecran: [1080, 2340], panorama: [8000, 2000] };
    const TOOLS = '["Bélier","Pied de biche","Hooligan","Disqueuse","Écarteur","Coupe-boulon"]';

    it.each(['a4', '16:9'] as const)('%s : toutes les formes, 1 à 4 photos par page, sans outil ou avec 6 outils d’effraction', (format) => {
        const geo = pageGeometry(format);
        for (const [shape, [w, h]] of Object.entries(SHAPES)) {
            for (const tools of ['[]', TOOLS]) {
                const metas = [1, 2, 3, 4].map((i) => meta(`p${i}`, text, tools));
                const base64 = Object.fromEntries(metas.map((m) => [m.id, 'img']));
                const sizeOf = (): { widthPx: number; heightPx: number } => ({ widthPx: w, heightPx: h });
                const pages: Content[] = [...galleryPages('G', metas, base64, PDF_LIGHT, geo, sizeOf), ...splitGalleryPages('B', metas.slice(0, 2), base64, PDF_LIGHT, geo, sizeOf), ...splitGalleryPages('B', metas.slice(0, 1), base64, PDF_LIGHT, geo, sizeOf)];
                // 4 (galerie) + 2 + 1 (page Baptême) légendes entières ; les badges d'outils sont à part.
                expect({ shape, tools, entieres: captionsOf(pages).filter((c) => c === text).length }).toEqual({ shape, tools, entieres: 7 });
            }
        }
    });
});
