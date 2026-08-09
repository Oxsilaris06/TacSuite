/**
 * geo-shapes.ts — Helpers géodésiques PURS communs au socle carto TacSuite
 * (mission R3-a, décision D1 : moteur PC-Tac généralisé). Zéro dépendance
 * DOM/MapLibre/état.
 *
 * Extraits VERBATIM de la version PC-Tac (la plus mûre) — duplication établie
 * par audit entre `src/apps/pctac/planmap/geo.ts` (`_circlePolygon`,
 * `_rectPolygon`) et `src/apps/oi/carto/draw.ts` (`_circlePolygon`,
 * `_rectPolygon`) : les deux implémentations sont bit-identiques (même
 * formule, même N=64, même R=6371000) — aucun écart numérique constaté entre
 * PC-Tac et OI, alignement direct sans paramétrage.
 *
 * `LngLatTuple` : forme commune la plus simple — `[number, number]` (lng,
 * lat) — structurellement identique des deux côtés consommateurs
 * (`pctac/planmap/types.ts` et `oi/carto/types.ts` déclarent la même chose),
 * donc aucun adaptateur n'est nécessaire aux appels.
 */

export type LngLatTuple = [number, number];

/** Rectangle aligné carte = polygone fermé à 5 points. */
// planMap.js:4964-4972 (méthode _rectPolygon) ≈ oi_cartographie.js:1572-1575
export function rectPolygon(a: LngLatTuple, b: LngLatTuple): LngLatTuple[] {
    return [
        [a[0], a[1]],
        [b[0], a[1]],
        [b[0], b[1]],
        [a[0], b[1]],
        [a[0], a[1]],
    ];
}

/** Approximation polygonale d'un cercle géodésique (Haversine inverse).
 *  64 segments, calcul exact en mètres pour rester rond à toute latitude. */
// planMap.js:4976-5004 (méthode _circlePolygon) ≈ oi_cartographie.js:1577-1603
export function circlePolygon(center: LngLatTuple, edge: LngLatTuple): LngLatTuple[] {
    const R = 6371000; // rayon Terre en m
    const toRad = (d: number) => d * Math.PI / 180;
    const toDeg = (r: number) => r * 180 / Math.PI;

    const [lng1, lat1] = center;
    const [lng2, lat2] = edge;
    const phi1 = toRad(lat1), phi2 = toRad(lat2);
    const dPhi = toRad(lat2 - lat1);
    const dLambda = toRad(lng2 - lng1);
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    const radiusMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const N = 64;
    const coords: LngLatTuple[] = [];
    for (let i = 0; i <= N; i++) {
        const brg = (2 * Math.PI * i) / N;
        const sinPhi = Math.sin(phi1) * Math.cos(radiusMeters / R) +
            Math.cos(phi1) * Math.sin(radiusMeters / R) * Math.cos(brg);
        const phi = Math.asin(sinPhi);
        const lambda = toRad(lng1) + Math.atan2(
            Math.sin(brg) * Math.sin(radiusMeters / R) * Math.cos(phi1),
            Math.cos(radiusMeters / R) - Math.sin(phi1) * sinPhi
        );
        coords.push([toDeg(lambda), toDeg(phi)]);
    }
    return coords;
}

/**
 * Point d'arête situé à exactement `radiusM` mètres DUE NORD du centre.
 * Utilise le MÊME rayon terrestre R (6371000 m) que `circlePolygon`, de
 * sorte que `circlePolygon(center, edge)` mesure géodésiquement radiusM. Le
 * déplacement étant plein nord (Δlng = 0), la latitude varie de radiusM/R
 * rad ; cos(lat) n'intervient que sur la composante est-ouest, ici nulle,
 * donc le rayon est exact à toute latitude.
 *
 * PC-Tac seul (pas d'équivalent côté OI au moment de l'extraction).
 */
// planMap.js:5006-5017 (méthode _geoEdgeNorth)
export function geoEdgeNorth(center: LngLatTuple, radiusM: number): LngLatTuple {
    const R = 6371000;
    const deltaLatDeg = (radiusM / R) * (180 / Math.PI);
    return [center[0], center[1] + deltaLatDeg];
}
