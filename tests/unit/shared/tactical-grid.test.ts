import { describe, expect, it } from 'vitest';
import { forward } from 'mgrs';
import {
    columnLabel,
    GRID_MAX_CELLS_PER_SIDE,
    gridCellAt,
    isTacticalGridSpec,
    makeTacticalGrid,
    metersPerDegree,
    mgrsGridGeometry,
    mgrsOf,
    tacticalGridGeometry,
} from '@shared/tactical-grid.js';
import { latLngToMgrs } from '@shared/coords.js';

describe('carroyage tactique', () => {
    it('lettres de colonne : A…Z puis AA…AZ', () => {
        expect(columnLabel(0)).toBe('A');
        expect(columnLabel(25)).toBe('Z');
        expect(columnLabel(26)).toBe('AA');
        expect(columnLabel(51)).toBe('AZ');
    });

    it('rectangle de 200 m × 100 m à 50 m : 4 colonnes × 2 rangées, coins dans n’importe quel ordre', () => {
        const m = metersPerDegree(47.9);
        const nw: [number, number] = [1.9, 47.9];
        const se: [number, number] = [1.9 + 200 / m.lon, 47.9 - 100 / m.lat];
        const { spec, clamped } = makeTacticalGrid(se, nw, 50);
        expect([spec.cols, spec.rows, clamped]).toEqual([4, 2, false]);
        expect(spec.west).toBeCloseTo(1.9, 9);
        expect(spec.north).toBeCloseTo(47.9, 9);
    });

    it('A1 est au nord-ouest, les lettres vont vers l’est, les chiffres vers le sud', () => {
        const { spec } = makeTacticalGrid([1.9, 47.9], [1.91, 47.89], 50);
        const eps = 1e-7;
        expect(gridCellAt(spec, spec.west + eps, spec.north - eps)).toBe('A1');
        expect(gridCellAt(spec, spec.west + 2.5 * spec.dLon, spec.north - 3.5 * spec.dLat)).toBe('C4');
        expect(gridCellAt(spec, spec.west - eps, spec.north - eps)).toBeNull();
        expect(gridCellAt(spec, spec.west + eps, spec.north + eps)).toBeNull();
    });

    it('un rectangle trop grand est borné et le signale', () => {
        const { spec, clamped } = makeTacticalGrid([1.8, 48], [2.2, 47.7], 25);
        expect(clamped).toBe(true);
        expect(spec.cols).toBe(GRID_MAX_CELLS_PER_SIDE);
        expect(spec.rows).toBe(GRID_MAX_CELLS_PER_SIDE);
    });

    it('géométrie : cols+1 et rows+1 lignes, une étiquette par colonne et par rangée', () => {
        const { spec } = makeTacticalGrid([1.9, 47.9], [1.902, 47.899], 50);
        const g = tacticalGridGeometry(spec);
        expect(g.lines.features).toHaveLength(spec.cols + 1 + spec.rows + 1);
        expect(g.labels.features.filter((f) => f.properties.kind === 'col').map((f) => f.properties.label)[0]).toBe('A');
        expect(g.labels.features.filter((f) => f.properties.kind === 'row')).toHaveLength(spec.rows);
    });

    it('validation : un carroyage relu corrompu est refusé', () => {
        const { spec } = makeTacticalGrid([1.9, 47.9], [1.91, 47.89], 50);
        expect(isTacticalGridSpec(spec)).toBe(true);
        expect(isTacticalGridSpec({ ...spec, cols: 0 })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, dLat: Number.NaN })).toBe(false);
        expect(isTacticalGridSpec('x')).toBe(false);
        // JSON forgé : maille inconnue, ou pas incohérents avec la maille.
        expect(isTacticalGridSpec({ ...spec, cellM: -5 })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, dLat: spec.dLat * 20 })).toBe(false);
    });
});

describe('grille MGRS', () => {
    const view = { west: 1.88, south: 47.88, east: 1.93, north: 47.92 };

    it('chaque intersection est un coin exact de case kilométrique (easting et northing ronds au km)', () => {
        const g = mgrsGridGeometry(view, 1000);
        expect(g).not.toBeNull();
        const corners = g!.lines.features.flatMap((f) => f.geometry.coordinates);
        expect(corners.length).toBeGreaterThan(20);
        for (const [lng, lat] of corners) {
            // 1 cm au nord-est du coin : on est DANS la case, dont le coin est rond.
            const ref = forward([lng! + 1e-7, lat! + 1e-7], 5);
            const e = ref.slice(-10, -5);
            const n = ref.slice(-5);
            expect(e.slice(-3)).toBe('000');
            expect(n.slice(-3)).toBe('000');
        }
    });

    it('les lignes avancent : deux coins consécutifs sont distants d’environ un pas (jamais confondus)', () => {
        // Régression 2026-09-24 : la case voisine était cherchée juste après le
        // coin nord-est ; la case UTM étant tournée (convergence), ce point
        // retombait dans la MÊME case et chaque ligne se réduisait à un point.
        const view = { west: 1.895, south: 47.895, east: 1.925, north: 47.91 };
        for (const step of [1000, 100] as const) {
            const g = mgrsGridGeometry(step === 1000 ? { west: 1.85, south: 47.87, east: 1.95, north: 47.93 } : view, step)!;
            const m = metersPerDegree(47.9);
            for (const f of g.lines.features) {
                const c = f.geometry.coordinates;
                expect(c.length).toBeGreaterThanOrEqual(2);
                for (let i = 1; i < c.length; i++) {
                    const dx = (c[i]![0]! - c[i - 1]![0]!) * m.lon;
                    const dy = (c[i]![1]! - c[i - 1]![1]!) * m.lat;
                    const d = Math.hypot(dx, dy);
                    expect(d).toBeGreaterThan(step * 0.9);
                    expect(d).toBeLessThan(step * 1.1);
                }
            }
        }
    });

    // Régression (revue 2026-09-24) : les lignes « est » reliaient les coins
    // par RANG dans la rangée ; en limite de fuseau (0°, 6° E), dès que le
    // nombre de cases du premier fuseau variait d'une rangée à l'autre, tout
    // le second fuseau zigzaguait d'une colonne.
    const verticalSegmentsAreStraight = (g: NonNullable<ReturnType<typeof mgrsGridGeometry>>, step: number): void => {
        const m = metersPerDegree(47);
        for (const f of g.lines.features) {
            const c = f.geometry.coordinates;
            for (let i = 1; i < c.length; i++) {
                const dx = Math.abs((c[i]![0]! - c[i - 1]![0]!) * m.lon);
                const dy = Math.abs((c[i]![1]! - c[i - 1]![1]!) * m.lat);
                // Segment « nord » : quasi vertical (convergence < 5 %) ; « est » : quasi horizontal.
                if (dy > dx) expect(dx).toBeLessThan(step * 0.1);
                else expect(dy).toBeLessThan(step * 0.1);
            }
        }
    };

    it('limite de fuseau 6° E (Annecy) à 1 km : aucune ligne en zigzag', () => {
        verticalSegmentsAreStraight(mgrsGridGeometry({ west: 5.8, south: 45.85, east: 6.2, north: 46.05 }, 1000)!, 1000);
    });

    it('limite de fuseau 0° (Caen, Le Mans) à 100 m : aucune ligne en zigzag', () => {
        verticalSegmentsAreStraight(mgrsGridGeometry({ west: -0.012, south: 49.18, east: 0.012, north: 49.19 }, 100)!, 100);
    });

    it('limite de bande 48° N : les lignes « nord » traversent sans coupure', () => {
        const g = mgrsGridGeometry({ west: 2.3, south: 47.98, east: 2.33, north: 48.02 }, 1000)!;
        const m = metersPerDegree(48);
        const longest = Math.max(...g.lines.features.map((f) => {
            const c = f.geometry.coordinates;
            return Math.abs((c[c.length - 1]![1]! - c[0]![1]!) * m.lat);
        }));
        // L'emprise fait ~4,4 km de haut : une ligne continue dépasse 4 km ;
        // coupée à 48° N, aucune ne dépassait ~2,5 km.
        expect(longest).toBeGreaterThan(4000);
    });

    it('à 100 m, les coins sont ronds à 100 m', () => {
        const small = { west: 1.9, south: 47.9, east: 1.905, north: 47.903 };
        const g = mgrsGridGeometry(small, 100)!;
        for (const [lng, lat] of g.lines.features.flatMap((f) => f.geometry.coordinates)) {
            const ref = forward([lng! + 1e-7, lat! + 1e-7], 5);
            expect(ref.slice(-10, -5).slice(-2)).toBe('00');
            expect(ref.slice(-2)).toBe('00');
        }
    });

    it('trop large pour le pas : pas de grille (null) plutôt que des milliers de lignes', () => {
        expect(mgrsGridGeometry({ west: 1, south: 47, east: 3, north: 48.5 }, 100)).toBeNull();
    });

    it('hors du domaine MGRS : null, jamais d’exception', () => {
        expect(mgrsOf(0, 89.9)).toBeNull();
    });

    it('le convertisseur MGRS déjà en service dans PC-Tac (coords.ts) concorde avec la référence `mgrs` au mètre près', () => {
        const pts: Array<[number, number, string]> = [
            [2.352222, 48.856614, 'Paris'],
            [1.909251, 47.902964, 'Orléans'],
            [7.261953, 43.710173, 'Nice'],
            [-4.486076, 48.390394, 'Brest'],
            [55.448611, -20.878889, 'Saint-Denis (La Réunion)'],
            [-52.326, 4.9372, 'Cayenne'],
        ];
        for (const [lng, lat, name] of pts) {
            const ref = forward([lng, lat], 5);
            const ours = latLngToMgrs(lat, lng, 5).replace(/\s+/g, '');
            const e1 = Number(ref.slice(-10, -5)), n1 = Number(ref.slice(-5));
            const e2 = Number(ours.slice(-10, -5)), n2 = Number(ours.slice(-5));
            expect(ours.slice(0, -10), name).toBe(ref.slice(0, -10));
            expect(Math.abs(e1 - e2), name).toBeLessThanOrEqual(1);
            expect(Math.abs(n1 - n2), name).toBeLessThanOrEqual(1);
        }
    });
});
