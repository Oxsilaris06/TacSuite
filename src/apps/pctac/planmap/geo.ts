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
 * Retours terrain 2026-10-02 (mesure) : `formatArea`/`polygonAreaM2` (déplacés
 * de pdf-export.ts, qui les gardait en privé), `snapCandidates` et
 * `shapeMeasureText`. Fonctions pures hors table §4.2 : pas de `GeoMethods`.
 *
 * Source : `GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import { circlePolygon as sharedCirclePolygon, geoEdgeNorth as sharedGeoEdgeNorth, labelAnchorForLine, rectPolygon as sharedRectPolygon } from '@shared/geo-shapes.js';
import { parseDecimalCoords } from '@shared/coords.js';

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
    // Parseur partagé (virgule française, « 48,85 » refusé : audit du 26/09).
    const r = parseDecimalCoords(str);
    return r && r !== 'bad-range' ? r : null;
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

/**
 * Surface lisible : m² jusqu'à 1 ha, puis ha, puis km². Point décimal de
 * l'écran, comme `formatDistance` ; le PDF la met à la française (pdf-export.ts).
 */
export function formatArea(m2: number): string {
    if (!isFinite(m2) || m2 <= 0) return '';
    if (m2 < 10_000) return `${String(Math.round(m2)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} m²`;
    return m2 < 1_000_000 ? `${(m2 / 10_000).toFixed(2)} ha` : `${(m2 / 1_000_000).toFixed(2)} km²`;
}

/**
 * Surface d'un polygone [lng, lat] en m², projection locale équirectangulaire
 * (sphère de `haversineMeters`). ponytail: exacte à l'échelle d'un plan
 * tactique ; au-delà de quelques kilomètres, passer à une aire géodésique.
 */
export function polygonAreaM2(coords: readonly LngLatTuple[]): number {
    if (coords.length < 3) return 0;
    const rad = Math.PI / 180;
    const k = Math.cos((coords.reduce((s, c) => s + c[1], 0) / coords.length) * rad);
    let twice = 0;
    coords.forEach(([x1, y1], i) => {
        const [x2, y2] = coords[(i + 1) % coords.length] ?? [x1, y1];
        twice += x1 * k * y2 - x2 * k * y1;
    });
    return (Math.abs(twice) / 2) * (6371000 * rad) ** 2;
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

/**
 * Points d'accroche de l'aimant de la mesure (retours terrain 2026-10-02) :
 * les DEUX EXTRÉMITÉS des traits (celles de leurs poignées), tous les sommets
 * des rectangles et des mesures posées, le centre des cercles et des anneaux
 * d'engagement, puis les pions. Les textes n'en offrent pas. Donnée persistée,
 * donc possiblement forgée par une archive : tout ce qui n'est pas un couple
 * de nombres finis, latitude comprise entre -90 et 90, est écarté
 * (`map.project` jette sur une latitude hors bornes).
 */
export function snapCandidates(shapes: readonly PlanShape[], pins: readonly { lng: number; lat: number }[]): LngLatTuple[] {
    const out: LngLatTuple[] = [];
    const add = (c: unknown): void => {
        if (!Array.isArray(c)) return;
        const [lng, lat] = c as unknown[];
        if (typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90) out.push([lng, lat]);
    };
    for (const s of shapes) {
        if (s.type === 'line') {
            // L'outil Trait échantillonne un point tous les 4 px d'écran (draw-tools.ts) : si chacun
            // accrochait (18 px), le moindre toucher sur le trait s'y accrocherait et sa longueur ne
            // se lirait jamais. Seules les extrémités accrochent ; un trait droit n'en a que deux.
            const pts = Array.isArray(s.coords) ? s.coords : [];
            add(pts[0]);
            if (pts.length > 1) add(pts[pts.length - 1]);
        } else if (s.type === 'rectangle' || s.type === 'measure') {
            for (const c of Array.isArray(s.coords) ? s.coords : []) add(c);
        } else if (s.type === 'circle' || s.type === 'measure-rings') {
            add(s.center);
        }
    }
    for (const p of pins) add([p.lng, p.lat]);
    return out;
}

/**
 * Lecture d'un dessin touché pendant la mesure (retours terrain 2026-10-02) :
 * longueur d'un trait, périmètre et surface d'un rectangle ou d'un cercle ;
 * chaîne vide pour le reste (texte, mesure posée, anneaux : rien à lire).
 */
export function shapeMeasureText(s: PlanShape): string {
    const dist = (m: number): string => formatDistance(m) || '0 m';
    const area = (m2: number): string => formatArea(m2) || '0 m²';
    if (s.type === 'line') return `Longueur : ${dist(measureTotalMeters(shapeCoords(s)))}`;
    if (s.type === 'rectangle') {
        const ring = shapeCoords(s);
        return `Périmètre : ${dist(measureTotalMeters(ring))} · Surface : ${area(polygonAreaM2(ring))}`;
    }
    if (s.type === 'circle') {
        const d = circleDiameter(s);
        return `Périmètre : ${dist(Math.PI * d)} · Surface : ${area(Math.PI * (d / 2) ** 2)}`;
    }
    return '';
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
        // `labelT` absent → milieu de la corde premier↔dernier point, exactement
        // comme avant. Présent → abscisse curviligne le long du tracé, ce qui
        // suit aussi un cheminement à main levée revenu sur lui-même.
        const p = labelAnchorForLine(shapeCoords(s), s.labelT);
        return { lng: p[0], lat: p[1] };
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
