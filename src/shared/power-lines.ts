/**
 * power-lines.ts — Lignes électriques aériennes pour la carte (décision Nico
 * 2026-09-24, DevSYNCState §3 n° 14).
 *
 * SOURCE : OpenStreetMap via Overpass (`power=line|minor_line`, et les pylônes
 * `power=tower`). Le jeu RTE d'ODRÉ (`lignes-aeriennes-rte-nv`) a été examiné le
 * 2026-09-24 : il ne publie AUCUNE géométrie par l'API (nom et tension seulement),
 * donc rien à tracer. Les lignes RTE sont dans OSM (exploitant et tension
 * renseignés) ; la basse tension y est incomplète, ce que la couche dit.
 *
 * DISPONIBILITÉ : les serveurs Overpass publics saturent (504 mesurés le
 * 2026-09-24). D'où : chargement seulement au zoom ≥ 13, par tuiles de 0,05°
 * gardées en cache (Cache API, persistant et utilisable hors ligne), deux
 * serveurs essayés l'un après l'autre, et un état « indisponible » lisible.
 * La carte n'attend jamais cette couche.
 */

export const POWER_MIN_ZOOM = 13;
const TILE_DEG = 0.05;
const MAX_TILES = 24;
const CACHE_NAME = 'tacsuite-power-v2'; // v2 : entrées datées (v1 pouvait figer des tuiles vides)
/** Durée de vie d'une tuile en cache : le réseau électrique évolue, OSM aussi. */
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 25_000;
export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/** Classe de tension affichée : THT ≥ 200 kV, HT 50–200 kV, HTA 1–50 kV, BT < 1 kV. */
export type PowerClass = 'tht' | 'ht' | 'hta' | 'bt';

export interface PowerLineProps {
    id: number;
    cls: PowerClass;
    /** Tension la plus haute portée, en kV, arrondie (`null` si non renseignée). */
    kv: number | null;
    label: string;
    operator: string;
}

type LineFeature = GeoJSON.Feature<GeoJSON.LineString, PowerLineProps>;
type TowerFeature = GeoJSON.Feature<GeoJSON.Point, { id: number }>;

interface OverpassElement {
    type: 'way' | 'node';
    id: number;
    lat?: number;
    lon?: number;
    geometry?: Array<{ lat: number; lon: number }>;
    tags?: Record<string, string>;
}

/** Tension maximale en volts d'une valeur OSM (`"400000;225000"`, `"20000"`), `null` si illisible. */
export function parseVoltage(v: string | undefined): number | null {
    if (!v) return null;
    const vals = v.split(/[;,]/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
    return vals.length ? Math.max(...vals) : null;
}

export function classifyPower(tags: Record<string, string> | undefined): { cls: PowerClass; kv: number | null } {
    const volts = parseVoltage(tags?.voltage);
    const kv = volts === null ? null : Math.round(volts / 1000);
    if (volts !== null) {
        if (volts >= 200_000) return { cls: 'tht', kv };
        if (volts >= 50_000) return { cls: 'ht', kv };
        if (volts >= 1_000) return { cls: 'hta', kv };
        return { cls: 'bt', kv };
    }
    // Sans tension : une `line` est du transport (HT par défaut), une
    // `minor_line` de la distribution (HTA, le cas le plus fréquent en France).
    return { cls: tags?.power === 'line' ? 'ht' : 'hta', kv: null };
}

/** Réponse Overpass → GeoJSON (lignes + pylônes). Tolère une réponse partielle ou mal formée. */
export function overpassToGeoJSON(json: unknown): { lines: LineFeature[]; towers: TowerFeature[] } {
    const elements = (json as { elements?: OverpassElement[] } | null)?.elements;
    const lines: LineFeature[] = [];
    const towers: TowerFeature[] = [];
    if (!Array.isArray(elements)) return { lines, towers };
    for (const el of elements) {
        if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
            const { cls, kv } = classifyPower(el.tags);
            lines.push({
                type: 'Feature',
                properties: { id: el.id, cls, kv, label: kv ? `${kv} kV` : '', operator: el.tags?.operator ?? '' },
                geometry: { type: 'LineString', coordinates: el.geometry.map((p) => [p.lon, p.lat]) },
            });
        } else if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
            towers.push({ type: 'Feature', properties: { id: el.id }, geometry: { type: 'Point', coordinates: [el.lon, el.lat] } });
        }
    }
    return { lines, towers };
}

export interface Bounds { west: number; south: number; east: number; north: number }

/** Tuiles de 0,05° couvrant l'emprise (identifiants « x_y »), `null` si trop nombreuses. */
export function tilesFor(b: Bounds): string[] | null {
    const x0 = Math.floor(b.west / TILE_DEG), x1 = Math.floor(b.east / TILE_DEG);
    const y0 = Math.floor(b.south / TILE_DEG), y1 = Math.floor(b.north / TILE_DEG);
    const n = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!Number.isFinite(n) || n > MAX_TILES || n <= 0) return null;
    const out: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}_${y}`);
    return out;
}

function tileBounds(id: string): Bounds {
    const [x, y] = id.split('_').map(Number) as [number, number];
    return { west: x * TILE_DEG, south: y * TILE_DEG, east: (x + 1) * TILE_DEG, north: (y + 1) * TILE_DEG };
}

function overpassQuery(b: Bounds): string {
    const bb = `${b.south},${b.west},${b.north},${b.east}`;
    return `[out:json][timeout:25];(way["power"~"^(line|minor_line)$"](${bb});node["power"="tower"](${bb}););out geom tags;`;
}

interface TileData { lines: LineFeature[]; towers: TowerFeature[]; t?: number }

const memory = new Map<string, TileData>();
/** Tuiles périmées relues du cache : servies seulement si le réseau échoue. */
const stale = new Map<string, TileData>();

let oldCacheDropped = false;

async function cacheGet(id: string): Promise<TileData | null> {
    const hit = memory.get(id);
    if (hit) return hit;
    try {
        if (typeof caches === 'undefined') return null;
        if (!oldCacheDropped) {
            oldCacheDropped = true;
            // v1 pouvait contenir des tuiles vides figées : on l'abandonne.
            void caches.delete('tacsuite-power-v1').catch(() => false);
        }
        const res = await (await caches.open(CACHE_NAME)).match(`/__tacsuite-power/${id}`);
        if (!res) return null;
        const data = (await res.json()) as TileData;
        // Tuile périmée : on la redemande (mais on la garde si le réseau manque).
        if (typeof data.t !== 'number' || Date.now() - data.t > CACHE_TTL_MS) {
            stale.set(id, data);
            return null;
        }
        memory.set(id, data);
        return data;
    } catch {
        return null;
    }
}

async function cachePut(id: string, data: TileData): Promise<void> {
    data.t = Date.now();
    memory.set(id, data);
    stale.delete(id);
    try {
        if (typeof caches === 'undefined') return;
        await (await caches.open(CACHE_NAME)).put(`/__tacsuite-power/${id}`, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    } catch {
        // Quota ou Cache API indisponible : la mémoire suffit pour la session.
    }
}

function intersects(a: Bounds, bb: Bounds): boolean {
    return a.west <= bb.east && a.east >= bb.west && a.south <= bb.north && a.north >= bb.south;
}

function featureBounds(coords: number[][]): Bounds {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const [x, y] of coords) {
        west = Math.min(west, x!); east = Math.max(east, x!);
        south = Math.min(south, y!); north = Math.max(north, y!);
    }
    return { west, south, east, north };
}

async function fetchOverpass(b: Bounds, fetchImpl: typeof fetch): Promise<unknown> {
    let lastError: unknown = null;
    for (const url of OVERPASS_ENDPOINTS) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetchImpl(url, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(b) }), signal: ctrl.signal });
            if (!res.ok) throw new Error(`Overpass ${res.status}`);
            const json = (await res.json()) as { remark?: unknown };
            // Overpass saturé répond 200 avec un `remark` d'erreur et une liste
            // VIDE : c'est un échec, pas « aucune ligne ici » (qui se lirait
            // comme « pas d'obstacle » et resterait en cache).
            if (typeof json.remark === 'string' && /error|timed out|out of memory|abort/i.test(json.remark)) {
                throw new Error(`Overpass : ${json.remark}`);
            }
            return json;
        } catch (e) {
            lastError = e;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Overpass injoignable');
}

export interface PowerLinesResult {
    lines: GeoJSON.FeatureCollection<GeoJSON.LineString, PowerLineProps>;
    towers: GeoJSON.FeatureCollection<GeoJSON.Point, { id: number }>;
    /** Tuiles qui n'ont pu être chargées (réseau, serveurs saturés). */
    missing: number;
}

/**
 * Lignes de l'emprise : tuiles en cache d'abord, UNE requête Overpass pour
 * l'ensemble des tuiles manquantes, puis chaque ligne rangée dans toutes les
 * tuiles qu'elle traverse. `null` si l'emprise est trop large (dézoom).
 */
export async function loadPowerLines(b: Bounds, fetchImpl: typeof fetch = fetch): Promise<PowerLinesResult | null> {
    const ids = tilesFor(b);
    if (!ids) return null;
    const have = new Map<string, TileData>();
    const missingIds: string[] = [];
    for (const id of ids) {
        const d = await cacheGet(id);
        if (d) have.set(id, d);
        else missingIds.push(id);
    }
    let failed = 0;
    if (missingIds.length) {
        const union = missingIds.map(tileBounds).reduce((u, t) => ({
            west: Math.min(u.west, t.west), south: Math.min(u.south, t.south),
            east: Math.max(u.east, t.east), north: Math.max(u.north, t.north),
        }));
        try {
            const { lines, towers } = overpassToGeoJSON(await fetchOverpass(union, fetchImpl));
            for (const id of missingIds) {
                const tb = tileBounds(id);
                const data: TileData = {
                    lines: lines.filter((l) => intersects(featureBounds(l.geometry.coordinates), tb)),
                    towers: towers.filter((t) => intersects(featureBounds([t.geometry.coordinates]), tb)),
                };
                have.set(id, data);
                await cachePut(id, data);
            }
        } catch {
            // Réseau en échec : une tuile périmée vaut mieux que rien (hors ligne).
            for (const id of missingIds) {
                const old = stale.get(id);
                if (old) have.set(id, old);
                else failed++;
            }
        }
    }
    const seenL = new Set<number>(), seenT = new Set<number>();
    const lines: LineFeature[] = [], towers: TowerFeature[] = [];
    for (const d of have.values()) {
        for (const l of d.lines) if (!seenL.has(l.properties.id)) { seenL.add(l.properties.id); lines.push(l); }
        for (const t of d.towers) if (!seenT.has(t.properties.id)) { seenT.add(t.properties.id); towers.push(t); }
    }
    return {
        lines: { type: 'FeatureCollection', features: lines },
        towers: { type: 'FeatureCollection', features: towers },
        missing: failed,
    };
}

/** Vide le cache mémoire (tests). */
export function _resetPowerMemory(): void {
    memory.clear();
    stale.clear();
}

/** Au-delà (≈ 0,5° × 0,5°), le préchargement d'une zone est refusé : trop de requêtes Overpass. */
export const PREFETCH_MAX_TILES = 100;

/**
 * Précharge (cache) les lignes d'une zone entière, pour le pack hors ligne :
 * blocs de 4 × 4 tuiles, un à la fois (Overpass limite les requêtes
 * simultanées). `null` si la zone est trop grande ; sinon le nombre de tuiles
 * restées sans données (réseau, serveurs saturés).
 */
export async function prefetchPowerLines(b: Bounds, fetchImpl: typeof fetch = fetch): Promise<{ missing: number } | null> {
    const x0 = Math.floor(b.west / TILE_DEG), x1 = Math.floor(b.east / TILE_DEG);
    const y0 = Math.floor(b.south / TILE_DEG), y1 = Math.floor(b.north / TILE_DEG);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > PREFETCH_MAX_TILES) return null;
    let missing = 0;
    for (let x = x0; x <= x1; x += 4) {
        for (let y = y0; y <= y1; y += 4) {
            // Bloc intérieur de 4 × 4 tuiles (marge d'un centième de tuile pour
            // ne pas déborder sur la tuile voisine par arrondi).
            const e = 0.01 * TILE_DEG;
            const r = await loadPowerLines({
                west: x * TILE_DEG + e, south: y * TILE_DEG + e,
                east: Math.min(x + 4, x1 + 1) * TILE_DEG - e, north: Math.min(y + 4, y1 + 1) * TILE_DEG - e,
            }, fetchImpl);
            missing += r?.missing ?? 0;
        }
    }
    return { missing };
}
