/**
 * pdf-fonts/index.ts — Polices de repli des PDF (décisions 41 et 44).
 *
 *  - Noto Sans 400/700 : corps de la synthèse A3 de PC-Tac, et repli pour le
 *    grec et le cyrillique des titres (Oswald ne les couvre pas) ;
 *  - Noto Sans Arabic 400 : noms arabes (mise en forme contextuelle gardée).
 *
 * Sous-ensembles faits avec fonttools (latin, grec, cyrillique, ponctuation,
 * flèches ; arabe complet), SANS ligatures pour Noto Sans : la panne des
 * ligatures de JetBrains Mono (02/08 → 25/09) ne peut pas revenir par là.
 * Licence OFL (`OFL-NotoSans.txt`). Régénération : `npm run gen:pdf-fonts`.
 *
 * Le module base64 (~550 Ko) est importé À LA DEMANDE : il ne pèse ni sur le
 * démarrage de l'OI ni sur celui de PC-Tac.
 */

import fontkit from '@pdf-lib/fontkit';
import type { HasGlyph } from '@shared/pdf-glyphs.js';

export const EXTRA_FONT_KEYS = {
    notoRegular: 'NotoSans-400.ttf',
    notoBold: 'NotoSans-700.ttf',
    notoArabic: 'NotoSansArabic-400.ttf',
} as const;

let pending: Promise<Record<string, string>> | null = null;

/** Charge (une seule fois) le module des polices de repli. */
export function loadExtraFontVfs(): Promise<Record<string, string>> {
    pending ??= import('./fonts-extra.generated.js')
        .then((m) => m.EXTRA_FONT_VFS)
        .catch((err: unknown) => {
            pending = null; // un échec (hors ligne sans cache) peut être retenté
            throw err;
        });
    return pending;
}

/** Décode une police base64 (VFS) en octets, sans Buffer. */
export function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** Test de couverture d'une police (table cmap), pour la chaîne de repli. */
export function glyphTester(bytes: Uint8Array): HasGlyph {
    const font = fontkit.create(bytes) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    return (cp) => font.hasGlyphForCodePoint(cp);
}
