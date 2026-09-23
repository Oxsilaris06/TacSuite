/**
 * tactical-grid.ts — Quadrillages de carte, calcul PUR (aucun DOM, aucune carte).
 * Partagé par la carto de l'OI et le plan de PC-Tac (décisions Nico 2026-09-24,
 * DevSYNCState §3 n° 13).
 *
 * 1. CARROYAGE TACTIQUE : rectangle posé sur l'objectif, nord en haut, maille
 *    carrée en mètres ; colonnes lettrées de gauche à droite (A, B… Z, AA…),
 *    rangées numérotées de haut en bas (1, 2…). Sert à désigner « C4 » à la
 *    radio. Le rectangle est calé sur un nombre ENTIER de mailles à partir de
 *    son coin nord-ouest (A1 est toujours une maille complète).
 *
 * 2. GRILLE MGRS : lignes à 1 km ou 100 m dans l'emprise affichée. Chaque
 *    intersection est le coin sud-ouest EXACT d'une case MGRS, donné par le
 *    paquet `mgrs` (`inverse`) : aucune formule de projection écrite ici. Les
 *    lignes relient ces coins ; entre deux coins distants de 100 m à 1 km,
 *    l'écart à la vraie ligne UTM est invisible.
 */
import { forward, inverse } from 'mgrs';

export type LngLat = [number, number];

export interface TacticalGridSpec {
    /** Coin nord-ouest (A1). */
    west: number;
    north: number;
    /** Maille en mètres. */
    cellM: number;
    cols: number;
    rows: number;
    /** Pas en degrés, calculés à la latitude du rectangle. */
    dLon: number;
    dLat: number;
}

export const GRID_CELL_SIZES = [25, 50, 100, 250] as const;
export const GRID_DEFAULT_CELL = 50;
/** A…Z puis AA…AZ : au-delà, la désignation devient illisible à la radio. */
export const GRID_MAX_CELLS_PER_SIDE = 52;

/** Mètres par degré de latitude / longitude à la latitude `lat` (séries WGS84 usuelles). */
export function metersPerDegree(lat: number): { lat: number; lon: number } {
    const r = (lat * Math.PI) / 180;
    return {
        lat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
        lon: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r),
    };
}

/** Lettres de colonne : 0 → A, 25 → Z, 26 → AA, 51 → AZ. */
export function columnLabel(i: number): string {
    const A = 65;
    if (i < 26) return String.fromCharCode(A + i);
    return String.fromCharCode(A + Math.floor(i / 26) - 1) + String.fromCharCode(A + (i % 26));
}

/**
 * Carroyage à partir de deux coins opposés (dans n'importe quel ordre) et
 * d'une maille. Le rectangle est étendu vers l'est et le sud jusqu'à un nombre
 * entier de mailles, puis borné à `GRID_MAX_CELLS_PER_SIDE` de côté (`clamped`
 * signale ce bornage, pour que l'interface le dise).
 */
export function makeTacticalGrid(a: LngLat, b: LngLat, cellM: number): { spec: TacticalGridSpec; clamped: boolean } {
    const west = Math.min(a[0], b[0]);
    const east = Math.max(a[0], b[0]);
    const south = Math.min(a[1], b[1]);
    const north = Math.max(a[1], b[1]);
    const m = metersPerDegree((north + south) / 2);
    const dLon = cellM / m.lon;
    const dLat = cellM / m.lat;
    // Tolérance d'un millième de maille (5 cm à 50 m) : un rectangle tracé sur
    // un nombre entier de mailles ne gagne pas une colonne pour un arrondi.
    const rawCols = Math.max(1, Math.ceil((east - west) / dLon - 1e-3));
    const rawRows = Math.max(1, Math.ceil((north - south) / dLat - 1e-3));
    const cols = Math.min(rawCols, GRID_MAX_CELLS_PER_SIDE);
    const rows = Math.min(rawRows, GRID_MAX_CELLS_PER_SIDE);
    return { spec: { west, north, cellM, cols, rows, dLon, dLat }, clamped: cols !== rawCols || rows !== rawRows };
}

/** Validation d'un carroyage relu du stockage (JSON manipulé ou ancien). */
export function isTacticalGridSpec(v: unknown): v is TacticalGridSpec {
    if (!v || typeof v !== 'object') return false;
    const g = v as Record<string, unknown>;
    const finite = (k: string): boolean => typeof g[k] === 'number' && Number.isFinite(g[k]);
    return (
        ['west', 'north', 'cellM', 'cols', 'rows', 'dLon', 'dLat'].every(finite) &&
        (g.cols as number) >= 1 && (g.cols as number) <= GRID_MAX_CELLS_PER_SIDE &&
        (g.rows as number) >= 1 && (g.rows as number) <= GRID_MAX_CELLS_PER_SIDE &&
        (g.dLon as number) > 0 && (g.dLat as number) > 0 &&
        Math.abs(g.north as number) <= 85 && Math.abs(g.west as number) <= 180 &&
        // Maille connue, et pas cohérents avec elle à la latitude du carroyage
        // (± 10 %) : un JSON forgé ne donne ni « carroyage -5 m » ni des cases
        // démesurées.
        (GRID_CELL_SIZES as readonly number[]).includes(g.cellM as number) &&
        Math.abs((g.dLat as number) * metersPerDegree(g.north as number).lat - (g.cellM as number)) <= (g.cellM as number) * 0.1 &&
        Math.abs((g.dLon as number) * metersPerDegree(g.north as number).lon - (g.cellM as number)) <= (g.cellM as number) * 0.1
    );
}

/** Case contenant le point (« C4 »), ou `null` hors du carroyage. */
export function gridCellAt(spec: TacticalGridSpec, lng: number, lat: number): string | null {
    const col = Math.floor((lng - spec.west) / spec.dLon);
    const row = Math.floor((spec.north - lat) / spec.dLat);
    if (col < 0 || row < 0 || col >= spec.cols || row >= spec.rows) return null;
    return `${columnLabel(col)}${row + 1}`;
}

type LineFeature = GeoJSON.Feature<GeoJSON.LineString, { kind: string }>;
type LabelFeature = GeoJSON.Feature<GeoJSON.Point, { label: string; kind: string }>;

export interface GridGeometry {
    lines: GeoJSON.FeatureCollection<GeoJSON.LineString, { kind: string }>;
    labels: GeoJSON.FeatureCollection<GeoJSON.Point, { label: string; kind: string }>;
}

function fc<T extends GeoJSON.Feature>(features: T[]): GeoJSON.FeatureCollection<T['geometry'], T['properties']> {
    return { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection<T['geometry'], T['properties']>;
}

/** Lignes et étiquettes du carroyage : lettres au-dessus de chaque colonne, numéros à gauche de chaque rangée. */
export function tacticalGridGeometry(spec: TacticalGridSpec): GridGeometry {
    const { west, north, cols, rows, dLon, dLat } = spec;
    const east = west + cols * dLon;
    const south = north - rows * dLat;
    const lines: LineFeature[] = [];
    for (let i = 0; i <= cols; i++) {
        const x = west + i * dLon;
        lines.push({ type: 'Feature', properties: { kind: i === 0 || i === cols ? 'edge' : 'inner' }, geometry: { type: 'LineString', coordinates: [[x, north], [x, south]] } });
    }
    for (let j = 0; j <= rows; j++) {
        const y = north - j * dLat;
        lines.push({ type: 'Feature', properties: { kind: j === 0 || j === rows ? 'edge' : 'inner' }, geometry: { type: 'LineString', coordinates: [[west, y], [east, y]] } });
    }
    const labels: LabelFeature[] = [];
    for (let i = 0; i < cols; i++) {
        labels.push({ type: 'Feature', properties: { label: columnLabel(i), kind: 'col' }, geometry: { type: 'Point', coordinates: [west + (i + 0.5) * dLon, north + dLat * 0.25] } });
    }
    for (let j = 0; j < rows; j++) {
        labels.push({ type: 'Feature', properties: { label: String(j + 1), kind: 'row' }, geometry: { type: 'Point', coordinates: [west - dLon * 0.25, north - (j + 0.5) * dLat] } });
    }
    return { lines: fc(lines), labels: fc(labels) };
}

// ─── Grille MGRS ────────────────────────────────────────────────────────────

export type MgrsStep = 1000 | 100;

/** Nombre maximal de cases calculées : au-delà (dézoom), la grille n'est pas tracée. */
export const MGRS_MAX_CELLS = 2500;

const EPS = 1e-7; // ≈ 1 cm : juste au-delà d'un bord de case

interface Corner { ref: string; sw: LngLat; box: [number, number, number, number]; exact: boolean }

function cellOf(lng: number, lat: number, digits: number): Corner | null {
    try {
        const ref = forward([lng, lat], digits);
        const box = inverse(ref);
        // Coin EXACT : juste au nord-est du coin, les chiffres fins (1 m) sont
        // ronds au pas. Une case tronquée par la limite de fuseau a son coin
        // rabattu sur le méridien de limite : ce n'est pas un nœud de la grille.
        const fine = forward([box[0] + EPS, box[1] + EPS], 5);
        const e = fine.slice(-10, -5), n = fine.slice(-5);
        const zeros = 5 - digits;
        const exact = e.slice(-zeros) === '0'.repeat(zeros) && n.slice(-zeros) === '0'.repeat(zeros);
        return { ref, sw: [box[0], box[1]], box, exact };
    } catch {
        return null; // hors du domaine MGRS (pôles) ou coordonnée invalide
    }
}

/**
 * Case voisine à l'est / au nord. `inverse` rend l'emprise des coins sud-ouest
 * et nord-est ; la case UTM étant légèrement TOURNÉE par rapport aux méridiens
 * (convergence du quadrillage), son bord est, à mi-hauteur, dépasse le coin
 * nord-est : un point juste après ce coin retombe dans la MÊME case (régression
 * du 2026-09-24, lignes réduites à un point). On vise donc le milieu de la case
 * voisine (une demi-case au-delà), bien plus loin que l'effet de la rotation.
 * `EPS` garde un pas minimal pour une case tronquée en bord de fuseau.
 */
function eastOf(c: Corner, digits: number): Corner | null {
    const w = Math.max(c.box[2] - c.box[0], EPS);
    return cellOf(c.box[2] + w / 2 + EPS, (c.box[1] + c.box[3]) / 2, digits);
}

function northOf(c: Corner, digits: number): Corner | null {
    const h = Math.max(c.box[3] - c.box[1], EPS);
    return cellOf((c.box[0] + c.box[2]) / 2, c.box[3] + h / 2 + EPS, digits);
}

/**
 * Numéro de fuseau UTM d'une référence (« 31 »). La lettre de BANDE n'en fait
 * pas partie : easting et northing sont continus d'une bande à l'autre, une
 * ligne ne doit se couper qu'au changement de fuseau (régression 48° N).
 */
function zoneOf(ref: string): string {
    return /^\d{1,2}/.exec(ref)?.[0] ?? '';
}

/**
 * Identité de la colonne d'une case : fuseau + lettre de colonne 100 km +
 * chiffres d'easting. Deux coins de même identité sont sur la MÊME ligne
 * « est », quel que soit leur rang dans leur rangée (en limite de fuseau, le
 * nombre de cases du premier fuseau varie d'une rangée à l'autre).
 */
function columnKey(ref: string, digits: number): string {
    const m = /^(\d{1,2})[C-X]([A-Z])[A-Z](\d+)$/.exec(ref);
    return m ? `${m[1]}|${m[2]}|${(m[3] ?? '').slice(0, digits)}` : ref;
}

/**
 * Grille MGRS dans l'emprise, au pas donné. `null` si l'emprise demanderait
 * plus de `MGRS_MAX_CELLS` cases (zoom trop large pour ce pas) ou sort du
 * domaine MGRS.
 */
export function mgrsGridGeometry(
    bounds: { west: number; south: number; east: number; north: number },
    step: MgrsStep,
): GridGeometry | null {
    const digits = step === 1000 ? 2 : 3;
    const m = metersPerDegree((bounds.north + bounds.south) / 2);
    const estimate = (((bounds.east - bounds.west) * m.lon) / step + 2) * (((bounds.north - bounds.south) * m.lat) / step + 2);
    if (!Number.isFinite(estimate) || estimate > MGRS_MAX_CELLS) return null;

    const rowsOfCorners: Corner[][] = [];
    let rowStart = cellOf(bounds.west, bounds.south, digits);
    let guard = 0;
    while (rowStart && rowStart.sw[1] <= bounds.north && guard++ < 200) {
        const row: Corner[] = [];
        let cell: Corner | null = rowStart;
        let g2 = 0;
        // Une case de plus que l'emprise à l'est : ferme la dernière colonne.
        while (cell && g2++ < 200) {
            row.push(cell);
            if (cell.sw[0] > bounds.east) break;
            cell = eastOf(cell, digits);
        }
        rowsOfCorners.push(row);
        rowStart = northOf(rowStart, digits);
    }
    // Rangée de fermeture au nord (coins sud-ouest de la rangée suivante).
    if (rowStart) {
        const row: Corner[] = [];
        let cell: Corner | null = rowStart;
        let g3 = 0;
        while (cell && g3++ < 200) {
            row.push(cell);
            if (cell.sw[0] > bounds.east) break;
            cell = eastOf(cell, digits);
        }
        rowsOfCorners.push(row);
    }
    if (rowsOfCorners.length < 2) return null;

    const lines: LineFeature[] = [];
    const labels: LabelFeature[] = [];
    const kind = step === 1000 ? 'km' : 'hm';
    const pushLine = (coords: LngLat[]): void => {
        if (coords.length >= 2) lines.push({ type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates: coords } });
    };
    // Lignes « nord » (northing constant) : chaque rangée, coupée au changement
    // de fuseau ; les coins non exacts (cases tronquées) coupent aussi la ligne.
    for (const row of rowsOfCorners) {
        let seg: LngLat[] = [];
        let zone = '';
        for (const c of row) {
            if (!c.exact) { pushLine(seg); seg = []; continue; }
            const z = zoneOf(c.ref);
            if (seg.length && z !== zone) { pushLine(seg); seg = []; }
            zone = z;
            seg.push(c.sw);
        }
        pushLine(seg);
    }
    // Lignes « est » (easting constant) : coins regroupés par IDENTITÉ de
    // colonne (`columnKey`), rangée après rangée, du sud au nord.
    const columns = new Map<string, LngLat[][]>();
    const maxGapDeg = (step * 1.5) / m.lat; // une rangée manquante coupe la ligne
    for (const row of rowsOfCorners) {
        for (const c of row) {
            if (!c.exact) continue;
            const key = columnKey(c.ref, digits);
            const segs = columns.get(key) ?? [];
            const last = segs[segs.length - 1];
            const prev = last?.[last.length - 1];
            if (last && prev && c.sw[1] - prev[1] <= maxGapDeg) last.push(c.sw);
            else segs.push([c.sw]);
            columns.set(key, segs);
        }
    }
    for (const segs of columns.values()) segs.forEach(pushLine);
    // Étiquettes : chiffres d'easting en bas de chaque ligne verticale, de
    // northing à gauche de chaque ligne horizontale (km : 2 chiffres, 100 m : 3).
    const first = rowsOfCorners[0] ?? [];
    for (const c of first) {
        if (!c.exact) continue;
        const digitsPart = c.ref.slice(-2 * digits);
        labels.push({ type: 'Feature', properties: { label: digitsPart.slice(0, digits), kind: 'easting' }, geometry: { type: 'Point', coordinates: c.sw } });
    }
    for (const row of rowsOfCorners) {
        const c = row.find((x) => x.exact);
        if (!c) continue;
        const digitsPart = c.ref.slice(-2 * digits);
        labels.push({ type: 'Feature', properties: { label: digitsPart.slice(digits), kind: 'northing' }, geometry: { type: 'Point', coordinates: c.sw } });
    }
    return { lines: fc(lines), labels: fc(labels) };
}

/** Coordonnée MGRS lisible d'un point (« 31U DP 12345 67890 »), `null` hors domaine. */
export function mgrsOf(lng: number, lat: number): string | null {
    try {
        const ref = forward([lng, lat], 5);
        const m = /^(\d{1,2}[C-X])([A-Z]{2})(\d{5})(\d{5})$/.exec(ref);
        return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : ref;
    } catch {
        return null;
    }
}
