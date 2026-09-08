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

/* ---------------------------------------------------------------------------
 * Position d'un label le long d'une polyligne (« rail »).
 *
 * Le paramètre `t` est une abscisse curviligne normalisée : 0 = premier point,
 * 1 = dernier point, 0.5 = milieu de la LONGUEUR PARCOURUE — et non milieu de
 * la corde. La distinction compte pour un cheminement tracé à main levée qui
 * revient sur lui-même : la corde y place un label hors du tracé.
 * ------------------------------------------------------------------------ */

/** Distance géodésique en mètres (même R que `circlePolygon`). */
function hav(a: LngLatTuple, b: LngLatTuple): number {
    const R = 6371000;
    const toRad = (d: number): number => d * Math.PI / 180;
    const phi1 = toRad(a[1]), phi2 = toRad(b[1]);
    const dPhi = toRad(b[1] - a[1]);
    const dLambda = toRad(b[0] - a[0]);
    const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Longueurs cumulées le long de `coords` ; `[0]` vaut toujours 0. */
function cumulative(coords: LngLatTuple[]): number[] {
    const acc: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1], cur = coords[i];
        acc.push((acc[i - 1] ?? 0) + (prev && cur ? hav(prev, cur) : 0));
    }
    return acc;
}

/** Longueur totale parcourue par la polyligne, en mètres. */
export function pathLength(coords: LngLatTuple[]): number {
    if (coords.length < 2) return 0;
    const acc = cumulative(coords);
    return acc[acc.length - 1] ?? 0;
}

/**
 * Point situé à l'abscisse curviligne `t` (0..1) le long de `coords`.
 * `t` est borné à [0,1]. Une polyligne de longueur nulle renvoie son 1er point.
 */
export function pointAlongPath(coords: LngLatTuple[], t: number): LngLatTuple {
    const first = coords[0];
    if (!first) return [0, 0];
    if (coords.length < 2) return [first[0], first[1]];

    const acc = cumulative(coords);
    const total = acc[acc.length - 1] ?? 0;
    if (total <= 0) return [first[0], first[1]];

    const target = Math.max(0, Math.min(1, t)) * total;
    for (let i = 1; i < coords.length; i++) {
        const d0 = acc[i - 1] ?? 0, d1 = acc[i] ?? 0;
        if (target <= d1 || i === coords.length - 1) {
            const a = coords[i - 1], b = coords[i];
            if (!a || !b) break;
            const seg = d1 - d0;
            const u = seg > 0 ? (target - d0) / seg : 0;
            return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        }
    }
    const last = coords[coords.length - 1] ?? first;
    return [last[0], last[1]];
}

/**
 * Abscisse curviligne (0..1) du point de `coords` le plus proche de `target`.
 * Projette sur chaque segment ; réciproque de `pointAlongPath` au bruit
 * numérique près. Utilisé pour convertir un glissement de doigt en `labelT`.
 */
export function nearestTOnPath(coords: LngLatTuple[], target: LngLatTuple): number {
    if (coords.length < 2) return 0;
    const acc = cumulative(coords);
    const total = acc[acc.length - 1] ?? 0;
    if (total <= 0) return 0;

    // Métrique planaire corrigée en longitude : suffisante pour choisir le
    // segment le plus proche à l'échelle d'un tracé, et sans trigonométrie
    // dans la boucle de glissement.
    const kx = Math.cos((target[1] * Math.PI) / 180);
    let bestD2 = Infinity;
    let bestT = 0;

    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i];
        if (!a || !b) continue;
        const ax = a[0] * kx, ay = a[1];
        const bx = b[0] * kx, by = b[1];
        const px = target[0] * kx, py = target[1];
        const vx = bx - ax, vy = by - ay;
        const len2 = vx * vx + vy * vy;
        const u = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
        const cx = ax + vx * u, cy = ay + vy * u;
        const d2 = (px - cx) ** 2 + (py - cy) ** 2;
        if (d2 < bestD2) {
            bestD2 = d2;
            const d0 = acc[i - 1] ?? 0, d1 = acc[i] ?? 0;
            bestT = (d0 + (d1 - d0) * u) / total;
        }
    }
    return Math.max(0, Math.min(1, bestT));
}

/**
 * Ancrage du label d'une polyligne.
 *
 * `labelT` absent = comportement HISTORIQUE conservé au mot près (milieu de la
 * corde premier↔dernier point) : les formes déjà enregistrées ne bougent pas
 * d'un pixel et aucune migration n'est nécessaire.
 */
export function labelAnchorForLine(coords: LngLatTuple[], labelT?: number | undefined): LngLatTuple {
    if (typeof labelT === 'number' && coords.length > 1) return pointAlongPath(coords, labelT);
    const a = coords[0] ?? [0, 0];
    const b = coords[coords.length - 1] ?? a;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
