/**
 * coords-outre-mer.test.ts — UTM / MGRS / carroyage hors métropole
 * (décision « retours terrain 2026-10-02 » : carto IGN outre-mer).
 *
 * L'outre-mer sort du seul fuseau 31 de la métropole : fuseaux UTM 20 (Antilles,
 * Saint-Martin, Saint-Barthélemy), 21 (Saint-Pierre-et-Miquelon, ouest de la Guyane),
 * 22 (Guyane), 38 (Mayotte) et 40 (La Réunion), HÉMISPHÈRE SUD pour Mayotte et La
 * Réunion (faux nord de 10 000 km, lettres de ligne MGRS décalées, bandes K et L).
 * Une erreur ici donnerait un MGRS FAUX mais plausible, et un carroyage cassé.
 *
 * Référence INDÉPENDANTE : le paquet `mgrs` (proj4js) — l'implémentation maison de
 * `coords.ts` (série de Snyder) est comparée à lui, point par point, sur chaque
 * emprise de territoire. Les valeurs MGRS littérales ci-dessous ont été relevées
 * avec ce paquet le 2026-10-02.
 */

import { forward } from 'mgrs';
import { describe, expect, it } from 'vitest';

import { formatCoordsClipboard, latLngToMgrs, latLngToUtm, looksLikeCoordinates, parseCoordinateInput, parseMgrsCoords, shortMgrs } from '@shared/coords.js';
import { IGN_OUTRE_MER } from '@shared/ign-territoires.js';
import { gridCellAt, makeTacticalGrid, mgrsGridGeometry, mgrsOf, metersPerDegree } from '@shared/tactical-grid.js';

interface Lieu {
    nom: string;
    lon: number;
    lat: number;
    zone: number;
    band: string;
    hemisphere: 'N' | 'S';
    /** MGRS 1 m SANS espaces, relevé avec le paquet `mgrs`. */
    mgrs: string;
}

const LIEUX: Lieu[] = [
    { nom: 'Pointe-à-Pitre (971)', lon: -61.5331, lat: 16.2411, zone: 20, band: 'Q', hemisphere: 'N', mgrs: '20QPC5677096166' },
    { nom: 'Fort-de-France (972)', lon: -61.0588, lat: 14.6161, zone: 20, band: 'P', hemisphere: 'N', mgrs: '20PQB0909616759' },
    { nom: 'Cayenne (973)', lon: -52.326, lat: 4.9372, zone: 22, band: 'N', hemisphere: 'N', mgrs: '22NCL5298045868' },
    // Ouest de la Guyane : de l'autre côté de la limite de fuseau (−54°), donc zone 21.
    { nom: 'Saint-Laurent-du-Maroni (973, fuseau 21)', lon: -54.0285, lat: 5.4986, zone: 21, band: 'N', hemisphere: 'N', mgrs: '21NZG2928808597' },
    { nom: 'Saint-Denis (974)', lon: 55.4481, lat: -20.8789, zone: 40, band: 'K', hemisphere: 'S', mgrs: '40KCB3856890475' },
    { nom: 'Saint-Pierre (974)', lon: 55.4781, lat: -21.3393, zone: 40, band: 'K', hemisphere: 'S', mgrs: '40KCB4217739537' },
    { nom: 'Saint-Pierre (975)', lon: -56.1773, lat: 46.7766, zone: 21, band: 'T', hemisphere: 'N', mgrs: '21TWM6280680667' },
    { nom: 'Mamoudzou (976)', lon: 45.2278, lat: -12.7806, zone: 38, band: 'L', hemisphere: 'S', mgrs: '38LNL2472487115' },
    { nom: 'Dzaoudzi (976)', lon: 45.2631, lat: -12.7878, zone: 38, band: 'L', hemisphere: 'S', mgrs: '38LNL2855586315' },
    { nom: 'Gustavia (977)', lon: -62.8498, lat: 17.8963, zone: 20, band: 'Q', hemisphere: 'N', mgrs: '20QNE1590978719' },
    { nom: 'Marigot (978)', lon: -63.0824, lat: 18.0679, zone: 20, band: 'Q', hemisphere: 'N', mgrs: '20QME9128097699' },
];

const compact = (s: string): string => s.replace(/\s+/g, '');

describe('UTM — fuseaux, bandes et hémisphère outre-mer', () => {
    it.each(LIEUX)('$nom : fuseau $zone, bande $band, hémisphère $hemisphere', (l) => {
        const u = latLngToUtm(l.lat, l.lon);
        expect(u.zone).toBe(l.zone);
        expect(u.band).toBe(l.band);
        expect(u.hemisphere).toBe(l.hemisphere);
        // Easting dans le fuseau (166 km–834 km), northing du bon hémisphère.
        expect(u.easting).toBeGreaterThan(166_000);
        expect(u.easting).toBeLessThan(834_000);
        if (l.hemisphere === 'S') {
            // Faux nord de 10 000 km : La Réunion (≈ 21° S) et Mayotte (≈ 13° S).
            expect(u.northing).toBeGreaterThan(7_000_000);
            expect(u.northing).toBeLessThan(10_000_000);
        } else {
            expect(u.northing).toBeGreaterThan(0);
            expect(u.northing).toBeLessThan(5_300_000);
        }
    });

    it('le sud est bien décalé : Saint-Denis ≈ 7,69 Mm de nord, Mamoudzou ≈ 8,59 Mm', () => {
        // 10 000 000 − (latitude × ≈ 110,6 km/°) : contrôle grossier du faux nord.
        expect(latLngToUtm(-20.8789, 55.4481).northing).toBeCloseTo(10_000_000 - 20.8789 * 110_600, -4);
        expect(latLngToUtm(-12.7806, 45.2278).northing).toBeCloseTo(10_000_000 - 12.7806 * 110_600, -4);
    });
});

describe('MGRS — l\'implémentation maison égale le paquet `mgrs` (référence indépendante)', () => {
    it.each(LIEUX)('$nom → $mgrs', (l) => {
        expect(compact(latLngToMgrs(l.lat, l.lon))).toBe(l.mgrs);
        expect(compact(latLngToMgrs(l.lat, l.lon))).toBe(forward([l.lon, l.lat], 5));
    });

    // Quadrillage de 5 × 5 points par emprise : coins, milieux d'arêtes, centre. Couvre
    // les deux hémisphères, les lettres de ligne paires/impaires (fuseaux 20, 22, 38,
    // 40 pairs ; 21 impair) et les changements de bande (P/Q à 16° N).
    it('chaque emprise d\'outre-mer : 25 points, MGRS 1 m identique au paquet', () => {
        let n = 0;
        for (const t of IGN_OUTRE_MER) {
            const [w, s, e, nn] = t.bounds;
            for (let i = 0; i < 5; i++) {
                for (let j = 0; j < 5; j++) {
                    const lon = w + ((e - w) * i) / 4;
                    const lat = s + ((nn - s) * j) / 4;
                    expect(compact(latLngToMgrs(lat, lon)), `${t.code} ${lat},${lon}`).toBe(forward([lon, lat], 5));
                    n++;
                }
            }
        }
        expect(n).toBe(IGN_OUTRE_MER.length * 25);
    });

    it('mgrsOf (carroyage) donne la même référence, espacée', () => {
        for (const l of LIEUX) {
            const ref = mgrsOf(l.lon, l.lat);
            expect(ref).not.toBeNull();
            expect(compact(ref as string)).toBe(l.mgrs);
            expect(ref).toBe(latLngToMgrs(l.lat, l.lon));
        }
    });

    it('allers-retours : parseMgrsCoords relit la case à moins de 2 m', () => {
        for (const l of LIEUX) {
            const back = parseMgrsCoords(latLngToMgrs(l.lat, l.lon));
            expect(back, l.nom).not.toBeNull();
            // 1 m ≈ 9e-6° : on lit le CENTRE de la case de 1 m, à 0,5 m du point.
            expect(Math.abs((back as { lat: number }).lat - l.lat), l.nom).toBeLessThan(2e-5);
            expect(Math.abs((back as { lng: number }).lng - l.lon), l.nom).toBeLessThan(2e-5);
        }
    });

    it('shortMgrs et formatCoordsClipboard : MGRS juste et hémisphères S / W / E lisibles', () => {
        expect(compact(shortMgrs(55.4481, -20.8789))).toBe('40KCB3856890475');
        const reunion = formatCoordsClipboard(55.4481, -20.8789).split('\n');
        expect(reunion[0]).toBe('-20.878900, 55.448100');
        expect(reunion[1]).toMatch(/S\s+\d+°\d+′[\d.]+″E$/);
        expect(reunion[2]).toBe('MGRS 40K CB 38568 90475');

        const gp = formatCoordsClipboard(-61.5331, 16.2411).split('\n');
        expect(gp[1]).toMatch(/N\s+\d+°\d+′[\d.]+″W$/);
        expect(gp[2]).toBe('MGRS 20Q PC 56770 96166');
    });
});

// Règle de Nico (2026-09-26) : une saisie de coordonnées ne part JAMAIS au géocodage
// (la position ne se révèle pas à un tiers sans nécessité pour la carte). Les zones
// 20, 21, 22, 38, 40 et les bandes K, L, N, P, Q, T doivent donc être reconnues comme
// du MGRS, sinon « 40K CB 38568 90475 » partirait chez le géocodeur comme une adresse.
describe('saisie MGRS outre-mer — lue sur place, jamais envoyée au géocodage', () => {
    const formes = (l: Lieu): string[] => [
        latLngToMgrs(l.lat, l.lon), // « 40K CB 38568 90475 »
        l.mgrs, // « 40KCB3856890475 »
        `MGRS ${latLngToMgrs(l.lat, l.lon)}`, // étiquette devant
        latLngToMgrs(l.lat, l.lon).toLowerCase(), // minuscules
    ];

    it.each(LIEUX)('$nom : toutes les formes sont lues comme MGRS, à moins de 2 m', (l) => {
        for (const saisie of formes(l)) {
            expect(looksLikeCoordinates(saisie), saisie).toBe(true);
            const r = parseCoordinateInput(saisie);
            expect(r?.kind, saisie).toBe('point');
            if (r?.kind !== 'point') continue;
            expect(r.format, saisie).toBe('mgrs');
            expect(Math.abs(r.lat - l.lat), saisie).toBeLessThan(2e-5);
            expect(Math.abs(r.lng - l.lon), saisie).toBeLessThan(2e-5);
        }
    });

    it('coordonnées décimales d\'outre-mer (S / W) : lues sur place aussi', () => {
        const r = parseCoordinateInput('-20.8789, 55.4481');
        expect(r).toMatchObject({ kind: 'point', format: 'decimal', lat: -20.8789, lng: 55.4481 });
        const w = parseCoordinateInput('16.2411, -61.5331');
        expect(w).toMatchObject({ kind: 'point', format: 'decimal', lat: 16.2411, lng: -61.5331 });
    });
});

describe('grille MGRS — hémisphère sud et fuseaux d\'outre-mer', () => {
    /** Vue d'environ 5 km × 4 km centrée sur un point. */
    const vue = (lon: number, lat: number) => ({ west: lon - 0.025, south: lat - 0.02, east: lon + 0.025, north: lat + 0.02 });

    it.each([
        ['Saint-Denis (40K, hémisphère sud)', 55.4481, -20.8789],
        ['Mamoudzou (38L, hémisphère sud)', 45.2278, -12.7806],
        ['Pointe-à-Pitre (20Q)', -61.5331, 16.2411],
        ['Cayenne (22N, près de l\'équateur)', -52.326, 4.9372],
        ['Saint-Pierre-et-Miquelon (21T)', -56.1773, 46.7766],
    ])('%s : chaque intersection est un coin exact de case kilométrique', (_nom, lon, lat) => {
        const g = mgrsGridGeometry(vue(lon, lat), 1000);
        expect(g).not.toBeNull();
        const coins = g!.lines.features.flatMap((f) => f.geometry.coordinates);
        expect(coins.length).toBeGreaterThan(20);
        for (const [x, y] of coins) {
            // 1 cm au nord-est du coin : on est DANS la case, dont le coin est rond au km.
            const ref = forward([x! + 1e-7, y! + 1e-7], 5);
            expect(ref.slice(-10, -5).slice(-3)).toBe('000');
            expect(ref.slice(-5).slice(-3)).toBe('000');
        }
    });

    it('les lignes avancent d\'environ un pas (jamais confondues) en hémisphère sud', () => {
        for (const step of [1000, 100] as const) {
            const g = mgrsGridGeometry(step === 1000 ? vue(55.4481, -20.8789) : { west: 55.445, south: -20.882, east: 55.455, north: -20.875 }, step)!;
            expect(g).not.toBeNull();
            const m = metersPerDegree(-20.88);
            for (const f of g.lines.features) {
                const c = f.geometry.coordinates;
                expect(c.length).toBeGreaterThanOrEqual(2);
                for (let i = 1; i < c.length; i++) {
                    const d = Math.hypot((c[i]![0]! - c[i - 1]![0]!) * m.lon, (c[i]![1]! - c[i - 1]![1]!) * m.lat);
                    expect(d).toBeGreaterThan(step * 0.9);
                    expect(d).toBeLessThan(step * 1.1);
                }
            }
        }
    });

    it('limite de fuseau 21 / 22 en Guyane (−54°) : grille tracée, aucune ligne ne saute la limite', () => {
        const g = mgrsGridGeometry({ west: -54.06, south: 5.46, east: -53.98, north: 5.52 }, 1000);
        expect(g).not.toBeNull();
        expect(g!.lines.features.length).toBeGreaterThan(4);
        const m = metersPerDegree(5.5);
        for (const f of g!.lines.features) {
            const c = f.geometry.coordinates;
            for (let i = 1; i < c.length; i++) {
                const d = Math.hypot((c[i]![0]! - c[i - 1]![0]!) * m.lon, (c[i]![1]! - c[i - 1]![1]!) * m.lat);
                expect(d).toBeLessThan(1100);
            }
        }
        // Les étiquettes existent et sont des chiffres (easting/northing au km).
        expect(g!.labels.features.length).toBeGreaterThan(2);
        for (const lab of g!.labels.features) expect(lab.properties.label).toMatch(/^\d{2}$/);
    });
});

describe('carroyage tactique — latitude sud', () => {
    it('metersPerDegree est symétrique entre les hémisphères', () => {
        const nord = metersPerDegree(20.8789);
        const sud = metersPerDegree(-20.8789);
        expect(sud.lat).toBeCloseTo(nord.lat, 6);
        expect(sud.lon).toBeCloseTo(nord.lon, 6);
    });

    it('250 m × 250 m à Saint-Denis (Réunion) en mailles de 50 m : 5 × 5 cases, A1 en haut à gauche', () => {
        const m = metersPerDegree(-20.8789);
        const a: [number, number] = [55.4481, -20.8789];
        const b: [number, number] = [55.4481 + 250 / m.lon, -20.8789 - 250 / m.lat];
        const { spec, clamped } = makeTacticalGrid(a, b, 50);
        expect(clamped).toBe(false);
        expect(spec.cols).toBe(5);
        expect(spec.rows).toBe(5);
        expect(gridCellAt(spec, 55.4481 + 1 / m.lon, -20.8789 - 1 / m.lat)).toBe('A1');
        expect(gridCellAt(spec, 55.4481 + 249 / m.lon, -20.8789 - 249 / m.lat)).toBe('E5');
    });
});
