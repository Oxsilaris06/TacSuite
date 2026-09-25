import { describe, expect, it } from 'vitest';
import { forward } from 'mgrs';
import {
    columnLabel,
    geoToGrid,
    GRID_MAX_CELLS_PER_SIDE,
    gridAngle,
    gridCellAt,
    gridCellCenter,
    gridColor,
    gridLabelRotation,
    gridLabelSize,
    gridToGeo,
    isTacticalGridSpec,
    makeOrientedGrid,
    makeTacticalGrid,
    metersPerDegree,
    mgrsGridGeometry,
    mgrsOf,
    rotateTacticalGrid,
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

    it('validation : une couleur ou une taille héritée de Object (« toString », « constructor ») est refusée', () => {
        const { spec } = makeTacticalGrid([1.9, 47.9], [1.91, 47.89], 50);
        expect(isTacticalGridSpec({ ...spec, color: 'toString' })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, color: 'constructor' })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, labelSize: '__proto__' })).toBe(false);
        expect(gridColor({ ...spec, color: 'toString' as never })).toBe('yellow');
        expect(gridLabelSize({ ...spec, labelSize: 'constructor' as never })).toBe('medium');
    });
});

describe('carroyage orientable (décision 39)', () => {
    const angles = [0, 30, 90, 179, 271];

    it.each(angles)('aller-retour case ↔ point à %i°', (angle) => {
        const { spec } = makeOrientedGrid([1.9, 47.9], 200, 150, 50, angle);
        expect(spec.angle).toBe(angle);
        expect([spec.cols, spec.rows]).toEqual([4, 3]);
        for (let col = 0; col < spec.cols; col++) {
            for (let row = 0; row < spec.rows; row++) {
                const label = `${columnLabel(col)}${row + 1}`;
                const c = gridCellCenter(spec, label);
                expect(c, label).not.toBeNull();
                const [lng, lat] = c!;
                expect(gridCellAt(spec, lng, lat), label).toBe(label);
            }
        }
    });

    it('le centre d’une case est à une demi-case de chaque bord (repère tourné)', () => {
        for (const angle of angles) {
            const { spec } = makeOrientedGrid([1.9, 47.9], 200, 150, 50, angle);
            const c = gridCellCenter(spec, 'B2')!;
            const g = geoToGrid(spec, c[0], c[1]);
            expect(g.x).toBeCloseTo(1.5, 9);
            expect(g.y).toBeCloseTo(1.5, 9);
        }
    });

    it('un point juste à l’intérieur du bord d’une case y tombe, juste dehors non', () => {
        for (const angle of angles) {
            const { spec } = makeOrientedGrid([1.9, 47.9], 200, 150, 50, angle);
            const eps = 1e-9;
            const inside = gridToGeo(spec, 1 + eps, 2 + eps);
            expect(gridCellAt(spec, inside[0], inside[1]), `angle ${angle}`).toBe('B3');
            const outside = gridToGeo(spec, 1 - eps, 2 - eps);
            expect(gridCellAt(spec, outside[0], outside[1]), `angle ${angle}`).toBe('A2');
        }
    });

    it('bornage à 52 cases, angle et options conservés', () => {
        const { spec, clamped } = makeOrientedGrid([1.8, 48], 100_000, 100_000, 25, 35);
        expect(clamped).toBe(true);
        expect(spec.cols).toBe(GRID_MAX_CELLS_PER_SIDE);
        expect(spec.rows).toBe(GRID_MAX_CELLS_PER_SIDE);
        expect(spec.angle).toBe(35);
        expect(gridColor(spec)).toBe('yellow');
        expect(gridLabelSize(spec)).toBe('medium');
    });

    it('ancien JSON sans angle : accepté, vaut 0, mêmes cases qu’avant', () => {
        const { spec } = makeTacticalGrid([1.9, 47.9], [1.902, 47.899], 50);
        const legacy = { west: spec.west, north: spec.north, cellM: spec.cellM, cols: spec.cols, rows: spec.rows, dLon: spec.dLon, dLat: spec.dLat };
        expect(isTacticalGridSpec(legacy)).toBe(true);
        expect(gridAngle(legacy)).toBe(0);
        expect(gridCellAt(legacy, spec.west + 1.5 * spec.dLon, spec.north - 1.5 * spec.dLat)).toBe('B2');
        expect(gridCellAt(spec, spec.west + 1.5 * spec.dLon, spec.north - 1.5 * spec.dLat)).toBe('B2');
        expect(gridCellCenter(legacy, 'A1')).toEqual(gridCellCenter(spec, 'A1'));
    });

    it('JSON forgé refusé : angle NaN ou hors [0,360), couleur ou taille inconnues', () => {
        const { spec } = makeOrientedGrid([1.9, 47.9], 200, 100, 50, 30);
        expect(isTacticalGridSpec(spec)).toBe(true);
        expect(isTacticalGridSpec({ ...spec, angle: Number.NaN })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, angle: 360 })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, angle: -1 })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, color: 'bleu' })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, labelSize: 'enorme' })).toBe(false);
        expect(isTacticalGridSpec({ ...spec, color: 'white' })).toBe(true);
        expect(isTacticalGridSpec({ ...spec, labelSize: 'xlarge' })).toBe(true);
    });

    it('rotation autour du centre : le centre ne bouge pas, l’angle est posé, la maille survit', () => {
        const { spec } = makeOrientedGrid([1.9, 47.9], 200, 150, 50, 0);
        const cx = gridToGeo(spec, spec.cols / 2, spec.rows / 2);
        for (const angle of [35, 90, 271, 0]) {
            const turned = rotateTacticalGrid(spec, angle);
            expect(turned.angle).toBe(angle);
            expect([turned.cols, turned.rows]).toEqual([spec.cols, spec.rows]);
            const centerAfter = gridToGeo(turned, turned.cols / 2, turned.rows / 2);
            expect(centerAfter[0]).toBeCloseTo(cx[0], 12);
            expect(centerAfter[1]).toBeCloseTo(cx[1], 12);
        }
    });

    it('étiquettes jamais à l’envers : au-delà de 90° et jusqu’à 270°, retournées de 180°', () => {
        expect(gridLabelRotation(0)).toBe(0);
        expect(gridLabelRotation(90)).toBe(90);
        expect(gridLabelRotation(91)).toBe(-89);
        expect(gridLabelRotation(179)).toBe(-1);
        expect(gridLabelRotation(270)).toBe(90);
        expect(gridLabelRotation(271)).toBe(271);
        for (const a of [0, 30, 90, 179, 271, 359]) {
            const mod = ((gridLabelRotation(a) % 360) + 360) % 360;
            expect(mod <= 90 || mod > 270, `angle ${a}`).toBe(true);
        }
    });

    it('géométrie tournée : les lignes relient les coins du repère du carroyage', () => {
        const { spec } = makeOrientedGrid([1.9, 47.9], 200, 100, 50, 30);
        const g = tacticalGridGeometry(spec);
        expect(g.lines.features).toHaveLength(spec.cols + 1 + spec.rows + 1);
        const a1 = gridToGeo(spec, 0, 0);
        const first = g.lines.features[0]!.geometry.coordinates[0]!;
        expect(first[0]).toBeCloseTo(a1[0], 12);
        expect(first[1]).toBeCloseTo(a1[1], 12);
        for (const l of g.labels.features) {
            expect(typeof l.properties.rotation).toBe('number');
        }
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
