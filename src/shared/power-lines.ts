/**
 * power-lines.ts — Lignes électriques aériennes pour la carte (décisions Nico
 * 2026-09-24, DevSYNCState §3 n° 14 ; sources revues le 2026-09-24 au soir
 * après son retour « très peu de lignes RTE / basse tension »).
 *
 * SOURCES, par tension :
 *  - HTB (RTE, ≥ 63 kV) : OpenStreetMap via Overpass (`power=line`) et ses
 *    pylônes (`power=tower`). OSM est bien renseigné sur ce réseau (128 lignes
 *    et 704 pylônes mesurés autour d'Orléans). Le jeu RTE d'ODRÉ, lui, ne
 *    publie AUCUNE géométrie (vérifié, API et export GeoJSON).
 *  - HTA et BT aériennes : jeux nationaux Enedis (Licence Ouverte Etalab 2.0),
 *    `opendata.enedis.fr` (data-fair), filtre par emprise, CORS ouvert. Ils
 *    sont complets là où OSM ne l'est pas (1 040 tronçons BT sur une seule
 *    tuile du centre d'Orléans).
 *  - Hors métropole, Enedis ne couvre pas : OSM `power=minor_line` y prend le
 *    relais de la distribution.
 *
 * DISPONIBILITÉ : Overpass sature (504, ou 200 avec un `remark` d'erreur et un
 * résultat partiel). D'où des requêtes PETITES (blocs de 2 × 2 tuiles de
 * 0,05°), deux serveurs, une tuile mise en cache SEULEMENT si toutes ses
 * sources ont répondu, et un affichage progressif bloc par bloc. La carte
 * n'attend jamais cette couche.
 */

export const POWER_MIN_ZOOM = 13;
const TILE_DEG = 0.05;
const BLOCK_TILES = 2; // requêtes par blocs de 2 × 2 tuiles
const MAX_TILES = 24;
const CACHE_NAME = 'tacsuite-power-v3'; // v3 : sources OSM (HTB) + Enedis (HTA, BT)
/** Durée de vie d'une tuile en cache : le réseau électrique évolue, les sources aussi. */
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 45_000;
export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ENEDIS_API = 'https://opendata.enedis.fr/data-fair/api/v1/datasets';
/** Jeux Enedis nationaux (métropole) : lignes AÉRIENNES seulement (les souterraines ne sont pas un obstacle). */
export const ENEDIS_DATASETS = [
    { id: '7p9-paqaf6cckipnjiubcncw', cls: 'hta' as const, source: 'Enedis HTA' },
    { id: 'hxx7-ja0txok7ipb5tgsz4kv', cls: 'bt' as const, source: 'Enedis BT' },
];
/** Emprise de la métropole et de la Corse, couverte par Enedis. */
const METROPOLE = { west: -5.5, south: 41.2, east: 9.8, north: 51.2 };

/** Classe de tension affichée : THT ≥ 200 kV, HT 50–200 kV, HTA 1–50 kV, BT < 1 kV. */
export type PowerClass = 'tht' | 'ht' | 'hta' | 'bt';

export interface PowerLineProps {
    id: string;
    cls: PowerClass;
    /** Tension la plus haute portée, en kV, arrondie (`null` si non renseignée). */
    kv: number | null;
    label: string;
    operator: string;
}

type LineFeature = GeoJSON.Feature<GeoJSON.LineString, PowerLineProps>;
type TowerFeature = GeoJSON.Feature<GeoJSON.Point, { id: string }>;

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
                properties: { id: `osm:${el.id}`, cls, kv, label: kv ? `${kv} kV` : '', operator: el.tags?.operator ?? '' },
                geometry: { type: 'LineString', coordinates: el.geometry.map((p) => [p.lon, p.lat]) },
            });
        } else if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
            towers.push({ type: 'Feature', properties: { id: `osm:${el.id}` }, geometry: { type: 'Point', coordinates: [el.lon, el.lat] } });
        }
    }
    return { lines, towers };
}

/**
 * Réponse GeoJSON Enedis → lignes de la classe du jeu. Les `MultiLineString`
 * sont éclatées ; toute géométrie illisible est ignorée (jamais d'exception).
 */
export function enedisToGeoJSON(json: unknown, cls: PowerClass, source: string): LineFeature[] {
    const features = (json as { features?: unknown[] } | null)?.features;
    if (!Array.isArray(features)) return [];
    const out: LineFeature[] = [];
    const kv = cls === 'hta' ? 20 : null;
    // Pas d'étiquette répétée « HTA »/« BT » le long des lignes : elles
    // masquaient les éclairs (collision) ; la classe se lit à la couleur.
    const label = '';
    const valid = (c: unknown): c is number[][] =>
        Array.isArray(c) && c.length >= 2 && c.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    features.forEach((f, i) => {
        const g = (f ?? {}) as { geometry?: { type?: string; coordinates?: unknown }; id?: unknown; properties?: { _id?: unknown } };
        const baseId = String(g.properties?._id ?? g.id ?? i);
        const parts: unknown[] = g.geometry?.type === 'LineString' ? [g.geometry.coordinates]
            : g.geometry?.type === 'MultiLineString' && Array.isArray(g.geometry.coordinates) ? g.geometry.coordinates : [];
        parts.forEach((coords, j) => {
            if (!valid(coords)) return;
            out.push({
                type: 'Feature',
                properties: { id: `enedis:${cls}:${baseId}:${j}`, cls, kv, label, operator: source },
                geometry: { type: 'LineString', coordinates: coords.map((p) => [p[0] as number, p[1] as number]) },
            });
        });
    });
    return out;
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

function tileXY(id: string): [number, number] {
    return id.split('_').map(Number) as [number, number];
}

function tileBounds(id: string): Bounds {
    const [x, y] = tileXY(id);
    return { west: x * TILE_DEG, south: y * TILE_DEG, east: (x + 1) * TILE_DEG, north: (y + 1) * TILE_DEG };
}

function inMetropole(b: Bounds): boolean {
    return b.west >= METROPOLE.west && b.east <= METROPOLE.east && b.south >= METROPOLE.south && b.north <= METROPOLE.north;
}

function overpassQuery(b: Bounds, withDistribution: boolean): string {
    const bb = `${b.south},${b.west},${b.north},${b.east}`;
    const ways = withDistribution ? 'way["power"~"^(line|minor_line)$"]' : 'way["power"="line"]';
    return `[out:json][timeout:40];(${ways}(${bb});node["power"="tower"](${bb}););out geom tags;`;
}

interface TileData { lines: LineFeature[]; towers: TowerFeature[]; t?: number }

const memory = new Map<string, TileData>();
/** Tuiles périmées relues du cache : servies seulement si le réseau échoue. */
const stale = new Map<string, TileData>();
let oldCachesDropped = false;

async function cacheGet(id: string): Promise<TileData | null> {
    const hit = memory.get(id);
    if (hit) return hit;
    try {
        if (typeof caches === 'undefined') return null;
        if (!oldCachesDropped) {
            oldCachesDropped = true;
            // v1 pouvait figer des tuiles vides, v2 n'avait ni HTA ni BT Enedis.
            for (const old of ['tacsuite-power-v1', 'tacsuite-power-v2']) void caches.delete(old).catch(() => false);
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

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchOverpass(b: Bounds, withDistribution: boolean, fetchImpl: typeof fetch): Promise<unknown> {
    let lastError: unknown = null;
    for (const url of OVERPASS_ENDPOINTS) {
        try {
            const res = await fetchWithTimeout(fetchImpl, url, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(b, withDistribution) }) });
            if (!res.ok) throw new Error(`Overpass ${res.status}`);
            const json = (await res.json()) as { remark?: unknown };
            // Overpass saturé répond 200 avec un `remark` d'erreur et un résultat
            // PARTIEL ou vide : c'est un échec, pas « aucune ligne ici » (qui se
            // lirait « pas d'obstacle » et resterait en cache).
            if (typeof json.remark === 'string' && /error|timed out|out of memory|abort/i.test(json.remark)) {
                throw new Error(`Overpass : ${json.remark}`);
            }
            return json;
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Overpass injoignable');
}

/** Lignes d'un jeu Enedis dans l'emprise, pages suivies jusqu'au bout (`next`, 10 pages au plus). */
async function fetchEnedis(b: Bounds, ds: (typeof ENEDIS_DATASETS)[number], fetchImpl: typeof fetch): Promise<LineFeature[]> {
    let url: string | null = `${ENEDIS_API}/${ds.id}/lines?bbox=${b.west},${b.south},${b.east},${b.north}&format=geojson&size=10000&select=_id`;
    const out: LineFeature[] = [];
    for (let page = 0; url && page < 10; page++) {
        const res = await fetchWithTimeout(fetchImpl, url);
        if (!res.ok) throw new Error(`Enedis ${res.status}`);
        const json = (await res.json()) as { next?: unknown };
        out.push(...enedisToGeoJSON(json, ds.cls, ds.source));
        // Page suivante : seulement si elle pointe vers la même API (jamais une URL tierce).
        url = typeof json.next === 'string' && json.next.startsWith(`${ENEDIS_API}/`) ? json.next : null;
    }
    return out;
}

/** Charge un bloc : toutes les sources en parallèle ; `complete` si toutes ont répondu. */
async function loadBlock(b: Bounds, fetchImpl: typeof fetch): Promise<{ lines: LineFeature[]; towers: TowerFeature[]; complete: boolean }> {
    const metro = inMetropole(b);
    const [osm, ...enedis] = await Promise.allSettled([
        fetchOverpass(b, !metro, fetchImpl).then(overpassToGeoJSON),
        ...(metro ? ENEDIS_DATASETS.map((ds) => fetchEnedis(b, ds, fetchImpl)) : []),
    ]);
    const lines: LineFeature[] = [];
    const towers: TowerFeature[] = [];
    let complete = true;
    if (osm && osm.status === 'fulfilled') {
        const v = osm.value as { lines: LineFeature[]; towers: TowerFeature[] };
        lines.push(...v.lines);
        towers.push(...v.towers);
    } else {
        complete = false;
    }
    for (const r of enedis) {
        if (r.status === 'fulfilled') lines.push(...(r.value as LineFeature[]));
        else complete = false;
    }
    return { lines, towers, complete };
}

export interface PowerLinesResult {
    lines: GeoJSON.FeatureCollection<GeoJSON.LineString, PowerLineProps>;
    towers: GeoJSON.FeatureCollection<GeoJSON.Point, { id: string }>;
    /** Tuiles dont au moins une source n'a pas répondu (réseau, serveurs saturés). */
    missing: number;
}

function merge(tiles: Iterable<TileData>, missing: number): PowerLinesResult {
    const seenL = new Set<string>(), seenT = new Set<string>();
    const lines: LineFeature[] = [], towers: TowerFeature[] = [];
    for (const d of tiles) {
        for (const l of d.lines) if (!seenL.has(l.properties.id)) { seenL.add(l.properties.id); lines.push(l); }
        for (const t of d.towers) if (!seenT.has(t.properties.id)) { seenT.add(t.properties.id); towers.push(t); }
    }
    return { lines: { type: 'FeatureCollection', features: lines }, towers: { type: 'FeatureCollection', features: towers }, missing };
}

/**
 * Lignes de l'emprise : tuiles en cache d'abord, puis les tuiles manquantes par
 * blocs de 2 × 2 (deux blocs à la fois). `onProgress` reçoit le résultat
 * cumulé après chaque bloc, pour un affichage progressif. `null` si l'emprise
 * est trop large (dézoom).
 */
export async function loadPowerLines(
    b: Bounds,
    fetchImpl: typeof fetch = fetch,
    onProgress?: (partial: PowerLinesResult) => void,
): Promise<PowerLinesResult | null> {
    const ids = tilesFor(b);
    if (!ids) return null;
    const have = new Map<string, TileData>();
    const missingIds: string[] = [];
    for (const id of ids) {
        const d = await cacheGet(id);
        if (d) have.set(id, d);
        else missingIds.push(id);
    }
    // Regroupement des tuiles manquantes en blocs de 2 × 2.
    const blocks = new Map<string, string[]>();
    for (const id of missingIds) {
        const [x, y] = tileXY(id);
        const key = `${Math.floor(x / BLOCK_TILES)}_${Math.floor(y / BLOCK_TILES)}`;
        blocks.set(key, [...(blocks.get(key) ?? []), id]);
    }
    let failed = 0;
    const queue = [...blocks.values()];
    const worker = async (): Promise<void> => {
        for (let blockIds = queue.shift(); blockIds; blockIds = queue.shift()) {
            const union = blockIds.map(tileBounds).reduce((u, t) => ({
                west: Math.min(u.west, t.west), south: Math.min(u.south, t.south),
                east: Math.max(u.east, t.east), north: Math.max(u.north, t.north),
            }));
            const r = await loadBlock(union, fetchImpl);
            for (const id of blockIds) {
                const tb = tileBounds(id);
                const data: TileData = {
                    lines: r.lines.filter((l) => intersects(featureBounds(l.geometry.coordinates), tb)),
                    towers: r.towers.filter((t) => intersects(featureBounds([t.geometry.coordinates]), tb)),
                };
                if (r.complete) {
                    have.set(id, data);
                    await cachePut(id, data);
                } else {
                    // Source manquante : on montre ce qui est arrivé (ou la copie
                    // périmée si rien n'est arrivé) SANS le mettre en cache.
                    const old = stale.get(id);
                    have.set(id, old && data.lines.length === 0 ? old : data);
                    failed++;
                }
            }
            onProgress?.(merge(have.values(), failed));
        }
    };
    // Deux blocs à la fois : Overpass n'accorde que deux requêtes simultanées par poste.
    await Promise.all([worker(), worker()]);
    return merge(have.values(), failed);
}

/** Vide le cache mémoire (tests). */
export function _resetPowerMemory(): void {
    memory.clear();
    stale.clear();
}

/** Au-delà (≈ 0,5° × 0,5°), le préchargement d'une zone est refusé : trop de requêtes. */
export const PREFETCH_MAX_TILES = 100;

/**
 * Précharge (cache) les lignes d'une zone entière, pour le pack hors ligne :
 * blocs de 4 × 4 tuiles, un à la fois. `null` si la zone est trop grande ;
 * sinon le nombre de tuiles restées incomplètes.
 */
export async function prefetchPowerLines(b: Bounds, fetchImpl: typeof fetch = fetch): Promise<{ missing: number } | null> {
    const x0 = Math.floor(b.west / TILE_DEG), x1 = Math.floor(b.east / TILE_DEG);
    const y0 = Math.floor(b.south / TILE_DEG), y1 = Math.floor(b.north / TILE_DEG);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > PREFETCH_MAX_TILES) return null;
    let missing = 0;
    for (let x = x0; x <= x1; x += 4) {
        for (let y = y0; y <= y1; y += 4) {
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
