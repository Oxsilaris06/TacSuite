/**
 * pc-live-coords-bounds.test.ts — revue de sécurité côté client du 2026-09-26,
 * D-3 : une position Matrix hors bornes (latitude 95°) faisait lever MapLibre
 * dans la boucle de synchronisation ; `since` n'avançait plus et l'évènement
 * fautif était rejoué à chaque reprise : un membre du salon gelait le suivi.
 */
import { describe, expect, it } from 'vitest';
import { isWgs84 } from '@shared/coords.js';

describe('isWgs84', () => {
    it('accepte une position valide, bornes comprises', () => {
        expect(isWgs84(48.85, 2.35)).toBe(true);
        expect(isWgs84(-90, 180)).toBe(true);
        expect(isWgs84(90, -180)).toBe(true);
    });
    it('refuse hors bornes, infini ou NaN', () => {
        expect(isWgs84(95, 2)).toBe(false);
        expect(isWgs84(45, 181)).toBe(false);
        expect(isWgs84(Number.NaN, 2)).toBe(false);
        expect(isWgs84(45, Number.POSITIVE_INFINITY)).toBe(false);
    });
});

describe('geoFromUri (Tchap)', () => {
    it('ignore une position hors bornes au lieu de la rendre', async () => {
        const { geoFromUri } = await import('@pctac/tchap-live.js');
        expect(geoFromUri('geo:48.85,2.35;u=10')).toEqual({ lat: 48.85, lon: 2.35 });
        expect(geoFromUri('geo:95,2')).toBeNull();
        expect(geoFromUri('geo:45,999')).toBeNull();
    });
});
