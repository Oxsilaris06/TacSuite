/**
 * geo-shapes.test.ts — Tests du socle carto commun `src/shared/geo-shapes.ts`
 * (mission R3-a, décision D1 : moteur PC-Tac généralisé). Port des cas
 * existants des deux côtés consommateurs :
 *   - `tests/unit/pctac/pm-geo.test.ts` (circlePolygon, rectPolygon, geoEdgeNorth)
 *   - `tests/unit/oi/oi-carto-draw.test.ts` (_circlePolygon, _rectPolygon)
 *
 * Les deux implémentations sources (`planmap/geo.ts` et `oi/carto/draw.ts`)
 * étaient bit-identiques (même formule, N=64, R=6371000) : aucun écart
 * numérique constaté à l'extraction — les valeurs de référence ci-dessous
 * couvrent donc les deux appelants sans divergence.
 */

import { describe, expect, it } from 'vitest';

import { circlePolygon, geoEdgeNorth, labelAnchorForLine, nearestTOnPath, pathLength, pointAlongPath, rectPolygon } from '../../../src/shared/geo-shapes.js';
import type { LngLatTuple } from '../../../src/shared/geo-shapes.js';

describe('geo-shapes.ts — rectPolygon — 5 points fermés', () => {
    it('polygone [a, (b.lng,a.lat), b, (a.lng,b.lat), a] (pm-geo.test.ts)', () => {
        const a: LngLatTuple = [1, 2];
        const b: LngLatTuple = [3, 4];
        expect(rectPolygon(a, b)).toEqual([
            [1, 2],
            [3, 2],
            [3, 4],
            [1, 4],
            [1, 2],
        ]);
    });

    it('produit un polygone fermé à 5 sommets, aligné carte (oi-carto-draw.test.ts)', () => {
        const a: LngLatTuple = [2.0, 48.0];
        const b: LngLatTuple = [2.01, 48.01];
        const poly = rectPolygon(a, b);
        expect(poly).toHaveLength(5);
        expect(poly).toEqual([
            [2.0, 48.0], [2.01, 48.0], [2.01, 48.01], [2.0, 48.01], [2.0, 48.0],
        ]);
        // Fermeture : premier === dernier sommet, exactement (pas d'arrondi ici).
        expect(poly[0]).toEqual(poly[poly.length - 1]);
    });
});

describe('geo-shapes.ts — circlePolygon — cercle géodésique 64 segments (Haversine)', () => {
    it('65 points (N=64 segments fermés), premier === dernier (pm-geo.test.ts)', () => {
        const center: LngLatTuple = [2.3522, 48.8566];
        const edge = geoEdgeNorth(center, 1000);
        const poly = circlePolygon(center, edge);
        expect(poly).toHaveLength(65);
        expect(poly[0]).toEqual(poly[64]);
    });

    it('rayon mesuré (Haversine) proche du rayon demandé, à toute latitude (pm-geo.test.ts)', () => {
        const center: LngLatTuple = [2.3522, 48.8566];
        const edge = geoEdgeNorth(center, 500);
        const poly = circlePolygon(center, edge);
        const p0 = poly[0];
        expect(p0).toBeDefined();
        if (!p0) return;
        expect(haversineMeters(center, p0)).toBeCloseTo(500, 3);
    });

    it('produit 65 sommets (N=64 segments + 1 point de fermeture) (oi-carto-draw.test.ts)', () => {
        const center: LngLatTuple = [2.0, 48.0];
        const edge: LngLatTuple = [2.001, 48.0];
        const poly = circlePolygon(center, edge);
        expect(poly).toHaveLength(65);
    });

    it('est approximativement fermé (premier ≈ dernier sommet) (oi-carto-draw.test.ts)', () => {
        const center: LngLatTuple = [2.0, 48.0];
        const edge: LngLatTuple = [2.001, 48.0];
        const poly = circlePolygon(center, edge);
        const first = poly[0] as LngLatTuple;
        const last = poly[poly.length - 1] as LngLatTuple;
        expect(first[0]).toBeCloseTo(last[0], 9);
        expect(first[1]).toBeCloseTo(last[1], 9);
    });

    it('les sommets sont approximativement équidistants du centre (rayon géodésique constant) (oi-carto-draw.test.ts)', () => {
        // Haversine indépendante de l'implémentation sous test, pour vérifier
        // que circlePolygon produit bien un cercle (et pas une ellipse/erreur
        // de formule) — sans réimplémenter la logique portée.
        const center: LngLatTuple = [2.0, 48.0];
        const edge: LngLatTuple = [2.001, 48.0];
        const expectedRadius = haversineMeters(center, edge);

        const poly = circlePolygon(center, edge);
        // Échantillon de 4 sommets répartis sur le cercle (0°, 90°, 180°, 270°).
        for (const idx of [0, 16, 32, 48]) {
            const pt = poly[idx] as LngLatTuple;
            expect(haversineMeters(center, pt)).toBeCloseTo(expectedRadius, 0);
        }
    });
});

describe('geo-shapes.ts — geoEdgeNorth — rayon exact à 3 latitudes', () => {
    it.each<[number]>([[0], [45], [89]])('à la latitude %s°, haversineMeters(centre, edge) === radiusM', (lat) => {
        const center: LngLatTuple = [2, lat];
        const radiusM = 1000;
        const edge = geoEdgeNorth(center, radiusM);
        // Diff mesurée en Node ~1e-10 à 1e-13 (erreur flottante pure) : le
        // rayon est exact au nanomètre près, cf. commentaire d'invariant de
        // `geoEdgeNorth` (même R que circlePolygon/haversineMeters ci-dessous).
        expect(haversineMeters(center, edge)).toBeCloseTo(radiusM, 6);
        // Déplacement plein nord uniquement (Δlng = 0).
        expect(edge[0]).toBe(center[0]);
        expect(edge[1]).toBeGreaterThan(center[1]);
    });
});

/**
 * Haversine de référence, INDÉPENDANTE de l'implémentation sous test —
 * même formule que `planmap/geo.ts` `haversineMeters` / `oi/carto/draw.ts`
 * (pas réimportée : `geo-shapes.ts` ne l'exporte pas, elle reste propre à
 * chaque appelant). Sert uniquement de mesure de vérification ci-dessus.
 */
function haversineMeters(a: LngLatTuple, b: LngLatTuple): number {
    const R = 6371000;
    const toRad = (d: number) => d * Math.PI / 180;
    const dPhi = toRad(b[1] - a[1]);
    const dLam = toRad(b[0] - a[0]);
    const phi1 = toRad(a[1]);
    const phi2 = toRad(b[1]);
    const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ============================================================
// Rail de label : abscisse curviligne le long d'une polyligne
// ============================================================
describe('geo-shapes.ts — pathLength / pointAlongPath / nearestTOnPath', () => {
    // Ligne brisée en L : deux segments de longueurs volontairement inégales,
    // pour que « milieu de la longueur » et « milieu de la corde » diffèrent.
    const L: LngLatTuple[] = [[0, 0], [0, 0.02], [0.01, 0.02]];

    it('pathLength somme les segments, pas la corde', () => {
        const parcouru = pathLength(L);
        const corde = haversineMeters([0, 0], [0.01, 0.02]);
        expect(parcouru).toBeGreaterThan(corde);
        expect(parcouru).toBeCloseTo(haversineMeters(L[0] as LngLatTuple, L[1] as LngLatTuple)
            + haversineMeters(L[1] as LngLatTuple, L[2] as LngLatTuple), 6);
    });

    it('pathLength vaut 0 pour moins de deux points', () => {
        expect(pathLength([])).toBe(0);
        expect(pathLength([[1, 2]])).toBe(0);
    });

    it('pointAlongPath : t=0 donne le premier point, t=1 le dernier', () => {
        expect(pointAlongPath(L, 0)).toEqual([0, 0]);
        const fin = pointAlongPath(L, 1);
        expect(fin[0]).toBeCloseTo(0.01, 10);
        expect(fin[1]).toBeCloseTo(0.02, 10);
    });

    it('pointAlongPath borne t hors de [0,1] au lieu d\'extrapoler', () => {
        expect(pointAlongPath(L, -5)).toEqual(pointAlongPath(L, 0));
        expect(pointAlongPath(L, 42)).toEqual(pointAlongPath(L, 1));
    });

    it('pointAlongPath : le point à mi-longueur est SUR le tracé, pas sur la corde', () => {
        const p = pointAlongPath(L, 0.5);
        // Le tracé monte en lng=0 puis part vers l'est à lat=0.02 : tout point
        // du tracé a soit lng=0, soit lat=0.02. Le milieu de la corde
        // ([0.005, 0.01]) ne vérifie ni l'un ni l'autre.
        const surLeTrace = Math.abs(p[0] - 0) < 1e-9 || Math.abs(p[1] - 0.02) < 1e-9;
        expect(surLeTrace).toBe(true);
        expect(p).not.toEqual([0.005, 0.01]);
    });

    it('pointAlongPath : polyligne dégénérée (points confondus) renvoie le premier point', () => {
        expect(pointAlongPath([[3, 4], [3, 4]], 0.7)).toEqual([3, 4]);
    });

    it('nearestTOnPath est la réciproque de pointAlongPath', () => {
        for (const t of [0, 0.15, 0.5, 0.83, 1]) {
            const p = pointAlongPath(L, t);
            expect(nearestTOnPath(L, p)).toBeCloseTo(t, 3);
        }
    });

    it('nearestTOnPath projette un point HORS du tracé sur le tracé', () => {
        // Très au nord du coude : se projette près de la jonction (t ≈ 2/3
        // ici, le 1er segment faisant deux fois la longueur du second).
        const t = nearestTOnPath(L, [0, 0.05]);
        expect(t).toBeGreaterThan(0.5);
        expect(t).toBeLessThanOrEqual(1);
    });

    it('nearestTOnPath borne toujours son résultat dans [0,1]', () => {
        expect(nearestTOnPath(L, [-9, -9])).toBeGreaterThanOrEqual(0);
        expect(nearestTOnPath(L, [9, 9])).toBeLessThanOrEqual(1);
        expect(nearestTOnPath([[1, 1]], [5, 5])).toBe(0);
    });
});

describe('geo-shapes.ts — labelAnchorForLine — compatibilité ascendante', () => {
    const L: LngLatTuple[] = [[0, 0], [0, 0.02], [0.01, 0.02]];

    it('SANS labelT : milieu de la corde premier↔dernier, comportement historique', () => {
        expect(labelAnchorForLine(L, undefined)).toEqual([0.005, 0.01]);
    });

    it('AVEC labelT : abscisse curviligne, donc un point du tracé', () => {
        expect(labelAnchorForLine(L, 0.5)).toEqual(pointAlongPath(L, 0.5));
        expect(labelAnchorForLine(L, 0)).toEqual([0, 0]);
    });

    it('polyligne à un seul point : le labelT est ignoré, pas de division par zéro', () => {
        expect(labelAnchorForLine([[2, 3]], 0.5)).toEqual([2, 3]);
    });
});
