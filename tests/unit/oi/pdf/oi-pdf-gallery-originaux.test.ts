/**
 * R2 (revue neuve du 2026-09-26) : en sortie Partage, la galerie adaptative
 * mesurait les photos APRÈS leur réduction pour le budget de 10 Mo. Chaque
 * passe de réduction rapetissait donc les photos sur la page (au lieu de
 * baisser seulement la définition embarquée), et sous 75 ppi toutes
 * portaient « basse définition ».
 *
 * La mise en page se fait sur les dimensions des photos d'ORIGINE ; la
 * réduction ne change que la définition embarquée.
 */
import { describe, expect, it } from 'vitest';

import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';
import type { OiFormData } from '@shared/types/contracts.js';

/** En-tête JPEG suffisant pour `imageSizeFromDataUrl` (SOI + SOF0). */
function jpegHeader(w: number, h: number): string {
    return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xff, 0xd9));
}

const FORM: OiFormData = {
    date_op: '2026-09-26',
    dynamic_photos: { photo_container_transport_pr_preview_container: [{ id: 'img_t1' }] },
} as unknown as OiFormData;

const text = (dd: unknown): string => JSON.stringify(dd);

describe('Galerie : tailles des photos d’origine (R2)', () => {
    it('photo réduite pour le budget : sans les tailles d’origine, elle passe pour « basse définition »', () => {
        const dd = buildOiDocDefinition({ formData: FORM, photosBase64: { img_t1: jpegHeader(300, 225) }, isDark: false }, { format: 'a4' });
        expect(text(dd.content)).toContain('basse définition');
    });

    it('avec les tailles d’origine, même mise en page qu’à pleine définition', () => {
        const pleine = buildOiDocDefinition({ formData: FORM, photosBase64: { img_t1: jpegHeader(4000, 3000) }, isDark: false }, { format: 'a4' });
        const reduite = buildOiDocDefinition(
            { formData: FORM, photosBase64: { img_t1: jpegHeader(300, 225) }, isDark: false },
            { format: 'a4', photoSizes: { img_t1: { widthPx: 4000, heightPx: 3000 } } },
        );
        expect(text(reduite.content)).not.toContain('basse définition');
        expect(text(reduite.content)).toBe(text(pleine.content).replace(jpegHeader(4000, 3000), jpegHeader(300, 225)));
    });
});
