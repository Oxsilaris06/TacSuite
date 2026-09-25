/**
 * pm-azimuth.test.ts — Tests de l'azimut affiché (décision 35, lot C).
 * ===========================================================================
 *
 * Vrai / magnétique (WMM 2025 via geomagnetism) / millièmes OTAN 6400.
 * Valeur de déclinaison de référence : modèle WMM 2025 embarqué dans le
 * paquet `geomagnetism` (NOAA), à Paris (48.8566, 2.3522), début 2026.
 */
import { describe, expect, it } from 'vitest';

import {
    degreesToMils,
    formatAzimuth,
    magneticDeclination,
    normalizeAzimuthDeg,
    normalizeMils,
} from '../../../src/apps/pctac/planmap/azimuth.js';

const PARIS = { lat: 48.8566, lon: 2.3522 };

describe('azimuth — déclinaison magnétique (WMM 2025, hors ligne)', () => {
    it('Paris début 2026 : ≈ 1,97° Est (référence NOAA, tolérance 0,1°)', () => {
        const decl = magneticDeclination(PARIS.lat, PARIS.lon, new Date('2026-01-01T12:00:00Z'));
        expect(decl).not.toBeNull();
        expect(decl as number).toBeGreaterThan(1.87);
        expect(decl as number).toBeLessThan(2.07);
    });

    it('date hors période de validité du modèle (après le 13/11/2029) → null', () => {
        expect(magneticDeclination(PARIS.lat, PARIS.lon, new Date('2030-06-01T00:00:00Z'))).toBeNull();
    });

    it('coordonnées non finies → null', () => {
        expect(magneticDeclination(Number.NaN, 2)).toBeNull();
    });
});

describe('azimuth — normalisation', () => {
    it('degrés dans [0, 360)', () => {
        expect(normalizeAzimuthDeg(-10)).toBe(350);
        expect(normalizeAzimuthDeg(0)).toBe(0);
        expect(normalizeAzimuthDeg(360)).toBe(0);
        expect(normalizeAzimuthDeg(720 + 45)).toBe(45);
    });
    it('millièmes dans [0, 6400)', () => {
        expect(normalizeMils(6400)).toBe(0);
        expect(normalizeMils(-1)).toBe(6399);
    });
});

describe('azimuth — conversion en millièmes OTAN', () => {
    it.each([
        [0, 0],
        [90, 1600],
        [180, 3200],
        [270, 4800],
        [123, 2187],
        [359, 6382],
    ])('%i° → %i ‰', (deg, mils) => {
        expect(degreesToMils(deg)).toBe(mils);
    });
});

describe('azimuth — formatage lisible et constant', () => {
    it('exemple de la consigne : « 123° V · 121° M · 2187 ‰ »', () => {
        expect(formatAzimuth(123, 2)).toBe('123° V · 121° M · 2187 ‰');
    });

    it('déclinaison Est : magnétique = vrai − déclinaison', () => {
        expect(formatAzimuth(10, 3)).toContain('007° M');
    });

    it('déclinaison Ouest (négative) : magnétique = vrai + |déclinaison|', () => {
        expect(formatAzimuth(10, -3)).toContain('013° M');
    });

    it('passage par 0/360 de la composante magnétique', () => {
        expect(formatAzimuth(1, 3)).toContain('358° M');
        expect(formatAzimuth(359, -3)).toContain('002° M');
    });

    it('millième normalisé : 360° vrai → 000° V et 0000 ‰', () => {
        expect(formatAzimuth(360, 0)).toBe('000° V · 000° M · 0000 ‰');
    });

    it('hors modèle : « M indisponible », jamais une valeur fausse', () => {
        const s = formatAzimuth(123, null);
        expect(s).toBe('123° V · M indisponible · 2187 ‰');
        expect(s).not.toContain('121° M');
    });
});
