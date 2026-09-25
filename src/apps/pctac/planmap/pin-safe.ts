/**
 * pin-safe.ts — gardes des champs d'un point du plan (R18 ; V1 de la revue
 * neuve du 25/09).
 *
 * Module PUR (aucune dépendance carte), partagé par le rendu du marqueur
 * (`pins.ts`), le panneau « Changer icône » (`panels.ts`) et l'import
 * d'archive (`archive.ts`) : une valeur forgée dans une archive ne doit
 * atteindre ni un `style`, ni un `innerHTML`, ni le stockage.
 */

import { PIN_ICONS } from '@pctac/config.js';

/** Couleur de repli d'un pin quand la donnée est absente ou invalide. */
export const DEFAULT_PIN_COLOR = '#3b82f6';

/**
 * Icônes hors catalogue produites par le code : la roue OTAN pose le segment
 * « Inconnu » avec `help`, absent de `PIN_ICONS`. On les garde pour ne pas
 * changer l'aspect d'un pin légitime.
 */
export const EXTRA_PIN_GLYPHS: readonly string[] = ['help'];

/**
 * R18 — n'accepte qu'une couleur CSS simple (hex ou rgb/rgba). Toute autre
 * valeur (forgée dans une archive) retombe sur la couleur par défaut. La
 * couleur est toujours posée par `style`/attribut, jamais via `innerHTML`.
 */
export function safePinColor(color: string | undefined): string {
    const c = (color ?? '').trim();
    if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c)) return c;
    if (/^rgba?\(\s*\d{1,3}%?(?:\s*,\s*\d{1,3}%?){2}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(c)) return c;
    return DEFAULT_PIN_COLOR;
}

/**
 * R18 — glyph Material Symbols d'un pin : `icon` n'est retenu que s'il est un
 * id du catalogue `PIN_ICONS` (donc choisi par la roue), sinon `EXTRA_PIN_GLYPHS`.
 * À défaut on retombe sur l'icône par défaut (voiture pour un véhicule, repère
 * sinon) ; `null` quand le pin n'a pas d'icône du tout (rendu en goutte SVG).
 */
export function safePinGlyph(icon: string | undefined, isVehicle: boolean): string | null {
    const raw = icon && icon.trim();
    if (!raw) return isVehicle ? 'directions_car' : null;
    if (PIN_ICONS.some((i) => i.id === raw) || EXTRA_PIN_GLYPHS.includes(raw)) return raw;
    return isVehicle ? 'directions_car' : 'flag';
}

/**
 * Icône telle qu'on peut la STOCKER (frontière d'import) : id du catalogue ou
 * glyphe produit par le code, sinon `undefined` (le pin n'a plus d'icône).
 */
export function safePinIcon(icon: unknown): string | undefined {
    const raw = typeof icon === 'string' ? icon.trim() : '';
    if (!raw) return undefined;
    return PIN_ICONS.some((i) => i.id === raw) || EXTRA_PIN_GLYPHS.includes(raw) ? raw : undefined;
}
