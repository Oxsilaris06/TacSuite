/**
 * geo.ts — Géodésie, formats et géométrie de forme de `planMap.js`
 * (P2.CONV, paquet `pm-geo`). Module PUR : aucun DOM, aucune carte.
 * ===========================================================================
 *
 * Les 12 méthodes de `docs/SPEC-PLANMAP-SPLIT.md` §4.2, portées VERBATIM comme
 * fonctions pures exportées sous leur nom sans underscore, plus `GeoMethods`
 * (délégation one-liner, sans `this` : ces méthodes n'en ont pas besoin) et
 * les deux helpers `shapeCoords`/`coordAt` imposés par §6.3.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import { circlePolygon as sharedCirclePolygon, geoEdgeNorth as sharedGeoEdgeNorth, rectPolygon as sharedRectPolygon } from '@shared/geo-shapes.js';

import type { LngLatObj, LngLatTuple, PlanShape } from './types.js';

/**
 * `s.coords ?? []` — les shapes `measure-rings` n'ont pas de `coords`
 * (types.ts : `PlanShape.coords` est optionnel, cf. commentaire d'invariant
 * sur `PlanShape`). SPEC-PLANMAP-SPLIT.md §6.3.
 */
export function shapeCoords(s: PlanShape): LngLatTuple[] {
    return s.coords ?? [];
}

/**
 * `shapeCoords(s)[i] ?? [0, 0]` — neutralise `noUncheckedIndexedAccess`.
 * Le repli `[0, 0]` n'est atteignable que sur donnée persistée malformée
 * (coords manquant/trop court pour un type de forme qui en exige), cas où
 * l'original levait un `TypeError` capté par `_safe` (interaction morte,
 * aucun état corrompu en pratique) : la normalisation est neutre en
 * observable. SPEC-PLANMAP-SPLIT.md §6.3.
 */
export function coordAt(s: PlanShape, i: number): LngLatTuple {
    return shapeCoords(s)[i] ?? [0, 0];
}

/**
 * Détecte une saisie de coordonnées GPS décimales "lat, lng" (sép. , ; ou espace).
 * Retourne {lat, lng} ou null.
 */
// planMap.js:811-822 (méthode _parseGps)
export function parseGps(str: string): { lat: number; lng: number } | null {
    const m = str.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (!m) return null;
    // Gère la virgule décimale française : on remplace seulement si pas de séparateur ambigu.
    // m[1]/m[2] : la regex a exactement 2 groupes capturants NON optionnels, donc
    // toujours renseignés ici — `noUncheckedIndexedAccess` les type `string | undefined` ;
    // repli '' neutre en observable (parseFloat('') → NaN → `return null` juste après,
    // branche déjà présente dans l'original pour toute entrée non numérique).
    const lat = parseFloat((m[1] ?? '').replace(',', '.'));
    const lng = parseFloat((m[2] ?? '').replace(',', '.'));
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

/**
 * Azimut vrai (relèvement initial / forward azimuth) de `a` vers `b`,
 * en degrés [0,360). Même modèle sphérique que _circlePolygon (R commun,
 * trigo cohérente) → l'azimut affiché correspond au cap suivi par les arcs
 * que l'on dessine. 0° = Nord, 90° = Est.
 */
// planMap.js:2276-2284 (méthode _trueBearing)
export function trueBearing(a: LngLatTuple, b: LngLatTuple): number {
    const toRad = (d: number) => d * Math.PI / 180;
    const phi1 = toRad(a[1]), phi2 = toRad(b[1]);
    const dLam = toRad(b[0] - a[0]);
    const y = Math.sin(dLam) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

// planMap.js:2292-2294
export function formatBearing(deg: number): string {
    return `${Math.round(deg).toString().padStart(3, '0')}°`;
}

/** Longueur cumulée (m) de la polyligne de mesure (sommets posés). */
// planMap.js:2343-2349 (méthode _measureTotalMeters)
export function measureTotalMeters(vertices: readonly LngLatTuple[]): number {
    let total = 0;
    for (let i = 1; i < vertices.length; i++) {
        // Les deux index sont garantis dans les bornes du tableau par la
        // condition de boucle (`i` va de 1 à `vertices.length - 1`) ;
        // `noUncheckedIndexedAccess` type néanmoins l'accès `| undefined`.
        // La garde ci-dessous est donc toujours vraie en pratique — neutre
        // en observable (cf. `coordAt`, SPEC-PLANMAP-SPLIT.md §6.3).
        const prev = vertices[i - 1];
        const cur = vertices[i];
        if (prev && cur) total += haversineMeters(prev, cur);
    }
    return total;
}

/** Distance Haversine en mètres entre deux [lng,lat]. */
// planMap.js:2712-2720 (méthode _haversineMeters)
export function haversineMeters(a: LngLatTuple, b: LngLatTuple): number {
    const R = 6371000;
    const toRad = (d: number) => d * Math.PI / 180;
    const dPhi = toRad(b[1] - a[1]);
    const dLam = toRad(b[0] - a[0]);
    const phi1 = toRad(a[1]); const phi2 = toRad(b[1]);
    const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// planMap.js:2723-2728
export function formatDistance(m: number): string {
    if (!isFinite(m) || m <= 0) return '';
    if (m < 1) return `${(m * 100).toFixed(0)} cm`;
    if (m < 1000) return `${Math.round(m)} m`;
    if (m < 10000) return `${(m / 1000).toFixed(2)} km`;
    return `${(m / 1000).toFixed(1)} km`;
}

// planMap.js:2731-2735 (méthode _circleDiameter)
// ⚠ `!c || !e` est de la logique VIVANTE de l'original (pas une garde de
// corruption) : accès indexés bruts `coords[0]`/`coords[idx]` (typés
// `LngLatTuple | undefined` par `noUncheckedIndexedAccess`), volontairement
// SANS repli `coordAt`, pour préserver le cas réel « edge absent » → 0.
export function circleDiameter(s: PlanShape): number {
    const coords = shapeCoords(s);
    const c = s.center || coords[0];
    const e = s.edge || coords[Math.floor(coords.length / 4)];
    if (!c || !e) return 0;
    return haversineMeters(c, e) * 2;
}

// planMap.js:3067-3077 (méthode _shapeCentroid)
export function shapeCentroid(s: PlanShape): LngLatTuple {
    if (s.type === 'line') {
        const a = coordAt(s, 0), b = coordAt(s, shapeCoords(s).length - 1);
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    if (s.type === 'rectangle') {
        const coords = shapeCoords(s);
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    }
    if (s.type === 'circle') {
        const c = s.center || coordAt(s, 0);
        return [c[0], c[1]];
    }
    if (s.type === 'text') {
        const c = coordAt(s, 0);
        return [c[0], c[1]];
    }
    return [0, 0];
}

/** Point d'ancrage d'une forme pour positionner son texte. */
// planMap.js:4722-4741 (méthode _shapeAnchor)
export function shapeAnchor(s: PlanShape): LngLatObj | null {
    if (s.type === 'line') {
        const a = coordAt(s, 0), b = coordAt(s, shapeCoords(s).length - 1);
        return { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 };
    }
    if (s.type === 'rectangle') {
        const coords = shapeCoords(s);
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        return {
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        };
    }
    if (s.type === 'circle') {
        const c = s.center || coordAt(s, 0);
        return { lng: c[0], lat: c[1] };
    }
    if (s.type === 'text') {
        const c = coordAt(s, 0);
        return { lng: c[0], lat: c[1] };
    }
    return null;
}

/**
 * Rectangle aligné carte = polygone à 5 points (fermé).
 * Délègue au socle commun `@shared/geo-shapes.js` (R3-a, décision D1) —
 * comportement bit-identique, VERBATIM PC-Tac déplacé tel quel.
 */
// planMap.js:4964-4972 (méthode _rectPolygon)
export function rectPolygon(a: LngLatTuple, b: LngLatTuple): LngLatTuple[] {
    return sharedRectPolygon(a, b);
}

/**
 * Approximation polygonale d'un cercle géodésique (Haversine inverse).
 * 64 segments, calcul exact en mètres pour rester rond à toute latitude.
 * Délègue au socle commun `@shared/geo-shapes.js` (R3-a, décision D1) —
 * comportement bit-identique, VERBATIM PC-Tac déplacé tel quel.
 */
// planMap.js:4976-5004 (méthode _circlePolygon)
export function circlePolygon(center: LngLatTuple, edge: LngLatTuple): LngLatTuple[] {
    return sharedCirclePolygon(center, edge);
}

/**
 * Point d'arête situé à exactement `radiusM` mètres DUE NORD du centre.
 * Utilise le MÊME rayon terrestre R (6371000 m) que circlePolygon et
 * haversineMeters, de sorte que circlePolygon(center, edge) mesure
 * géodésiquement radiusM. Le déplacement étant plein nord (Δlng = 0), la
 * latitude varie de radiusM/R rad ; cos(lat) n'intervient que sur la
 * composante est-ouest, ici nulle, donc le rayon est exact à toute latitude.
 * Délègue au socle commun `@shared/geo-shapes.js` (R3-a, décision D1).
 */
// planMap.js:5006-5017 (méthode _geoEdgeNorth)
export function geoEdgeNorth(center: LngLatTuple, radiusM: number): LngLatTuple {
    return sharedGeoEdgeNorth(center, radiusM);
}

/**
 * Les 12 méthodes de `PlanMapInternal`, en one-liners délégant à la fonction
 * pure homonyme. Pas de paramètre `this` : ces méthodes n'en ont pas besoin
 * (SPEC-PLANMAP-SPLIT.md §1.3, §4.2).
 */
export const GeoMethods = {
    _parseGps(str: string): { lat: number; lng: number } | null {
        return parseGps(str);
    },
    _trueBearing(a: LngLatTuple, b: LngLatTuple): number {
        return trueBearing(a, b);
    },
    _formatBearing(deg: number): string {
        return formatBearing(deg);
    },
    _measureTotalMeters(vertices: readonly LngLatTuple[]): number {
        return measureTotalMeters(vertices);
    },
    _haversineMeters(a: LngLatTuple, b: LngLatTuple): number {
        return haversineMeters(a, b);
    },
    _formatDistance(m: number): string {
        return formatDistance(m);
    },
    _circleDiameter(s: PlanShape): number {
        return circleDiameter(s);
    },
    _shapeCentroid(s: PlanShape): LngLatTuple {
        return shapeCentroid(s);
    },
    _shapeAnchor(s: PlanShape): LngLatObj | null {
        return shapeAnchor(s);
    },
    _rectPolygon(a: LngLatTuple, b: LngLatTuple): LngLatTuple[] {
        return rectPolygon(a, b);
    },
    _circlePolygon(center: LngLatTuple, edge: LngLatTuple): LngLatTuple[] {
        return circlePolygon(center, edge);
    },
    _geoEdgeNorth(center: LngLatTuple, radiusM: number): LngLatTuple {
        return geoEdgeNorth(center, radiusM);
    },
};
