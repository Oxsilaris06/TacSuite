/**
 * tiles.ts — Énumération/estimation/pré-téléchargement de tuiles XYZ de
 * `planMap.js` (P2.CONV, paquet `pm-geo`).
 * ===========================================================================
 *
 * Les 9 fonctions de `docs/SPEC-PLANMAP-SPLIT.md` §4.0 (planMap.js:140-299),
 * portées VERBATIM (mêmes noms sans underscore, mêmes signatures, mêmes
 * boucles). `tileUrl` est du code mort interne (0 appelant) : conservé avec
 * son en-tête `@deprecated`.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import { FRANCE_BBOX, OFFLINE_MAP_CACHE, RASTER_STYLE, SAT_TILE_TEMPLATE } from './constants.js';
import type { GeoBBox, PrefetchOptions, PrefetchProgress, PrefetchResult, TileTemplate } from './types.js';

/**
 * Construit la LISTE des templates XYZ réellement actifs, lue depuis RASTER_STYLE.
 * On ne code en dur aucune URL : on extrait l'imagerie Esri (satellite), l'IGN BD
 * ORTHO (ign-ortho) et le DEM (terrain-dem) tels que déclarés dans le style. Chaque
 * template porte ses bornes de zoom (minzoom/maxzoom) et son `bounds` éventuel afin
 * de ne pas requêter une source hors de sa couverture (ex. IGN hors métropole).
 */
// planMap.js:132-155 (fonction _styleTileTemplates)
export function styleTileTemplates(): TileTemplate[] {
    const out: TileTemplate[] = [];
    const src = RASTER_STYLE.sources || {};
    for (const id of ['satellite', 'ign-ortho', 'terrain-dem'] as const) {
        const s = src[id];
        // `'tiles' in s` écarte les variantes de `SourceSpecification` qui n'ont
        // ni `tiles` ni `minzoom`/`maxzoom`/`bounds` (GeoJSON/Video/Image) — les
        // 3 sources ici déclarées dans RASTER_STYLE (raster/raster-dem/vector)
        // les ont toutes. Équivalent structurel du duck-typing JS d'origine.
        if (!s || !('tiles' in s) || !Array.isArray(s.tiles) || !s.tiles.length) continue;
        // `s.tiles[0]` est garanti défini par `s.tiles.length` ci-dessus ;
        // `noUncheckedIndexedAccess` le type `string | undefined` — neutralisé
        // comme `coordAt` (SPEC-PLANMAP-SPLIT.md §6.3).
        const firstTile = s.tiles[0];
        if (firstTile === undefined) continue;
        out.push({
            id,
            url: firstTile,
            minzoom: (typeof s.minzoom === 'number') ? s.minzoom : 0,
            maxzoom: (typeof s.maxzoom === 'number') ? s.maxzoom : 19,
            bounds: Array.isArray(s.bounds) ? s.bounds : null,  // [west, south, east, north]
        });
    }
    return out;
}

// planMap.js:157-159
export function lon2tile(lon: number, z: number): number {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}
// planMap.js:160-163
export function lat2tile(lat: number, z: number): number {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
/** Remplit un template XYZ ({z}/{x}/{y}, ordre quelconque) avec z/x/y. */
// planMap.js:165-167
export function fillTileTemplate(tpl: string, z: number, x: number, y: number): string {
    return tpl.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
}
/**
 * @deprecated — code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher.
 */
// planMap.js:168-170 (fonction _tileUrl) — jamais appelée
export function tileUrl(z: number, x: number, y: number): string {
    return fillTileTemplate(SAT_TILE_TEMPLATE, z, x, y);
}

/**
 * Énumère les requêtes de tuiles XYZ couvrant `bbox` sur [minZ, maxZ] pour CHAQUE
 * template fourni, en respectant les bornes de zoom et le `bounds` de chaque source.
 */
// planMap.js:172-208 (fonction _enumerateTiles)
export function enumerateTiles(bbox: GeoBBox, minZ: number, maxZ: number, templates: readonly TileTemplate[]): { url: string }[] {
    const out: { url: string }[] = [];
    for (const tpl of templates) {
        const zMin = Math.max(minZ, tpl.minzoom);
        const zMax = Math.min(maxZ, tpl.maxzoom);
        // Intersection de l'emprise demandée avec le `bounds` de la source.
        let w = bbox.west, s = bbox.south, e = bbox.east, n = bbox.north;
        if (tpl.bounds) {
            // `tpl.bounds` est toujours un quadruplet [west,south,east,north]
            // par construction (`styleTileTemplates`) ; `number[]` (non-tuple)
            // type chaque index `number | undefined` sous `noUncheckedIndexedAccess`.
            // Repli sur la valeur courante = no-op garanti si jamais absent
            // (neutre en observable, cf. `coordAt`, SPEC-PLANMAP-SPLIT.md §6.3).
            const [bw, bs, be, bn] = tpl.bounds;
            w = Math.max(w, bw ?? w); s = Math.max(s, bs ?? s);
            e = Math.min(e, be ?? e); n = Math.min(n, bn ?? n);
        }
        if (w > e || s > n) continue; // pas d'intersection
        for (let z = zMin; z <= zMax; z++) {
            const nbT = Math.pow(2, z);
            const clamp = (v: number) => Math.max(0, Math.min(nbT - 1, v));
            const x0 = clamp(lon2tile(w, z));
            const x1 = clamp(lon2tile(e, z));
            const y0 = clamp(lat2tile(n, z)); // nord = y le plus petit
            const y1 = clamp(lat2tile(s, z));
            for (let x = x0; x <= x1; x++) {
                for (let y = y0; y <= y1; y++) {
                    out.push({ url: fillTileTemplate(tpl.url, z, x, y) });
                }
            }
        }
    }
    return out;
}

/** Estime le nombre de tuiles d'une AOI sans construire le tableau (rapide). */
// planMap.js:210-233 (fonction _estimateTileCount)
export function estimateTileCount(bbox: GeoBBox, minZ: number, maxZ: number, templates: readonly TileTemplate[]): number {
    let total = 0;
    for (const tpl of templates) {
        const zMin = Math.max(minZ, tpl.minzoom);
        const zMax = Math.min(maxZ, tpl.maxzoom);
        let w = bbox.west, s = bbox.south, e = bbox.east, n = bbox.north;
        if (tpl.bounds) {
            // cf. commentaire identique dans `enumerateTiles` ci-dessus.
            const [bw, bs, be, bn] = tpl.bounds;
            w = Math.max(w, bw ?? w); s = Math.max(s, bs ?? s);
            e = Math.min(e, be ?? e); n = Math.min(n, bn ?? n);
        }
        if (w > e || s > n) continue;
        for (let z = zMin; z <= zMax; z++) {
            const nbT = Math.pow(2, z);
            const clamp = (v: number) => Math.max(0, Math.min(nbT - 1, v));
            const x0 = clamp(lon2tile(w, z));
            const x1 = clamp(lon2tile(e, z));
            const y0 = clamp(lat2tile(n, z));
            const y1 = clamp(lat2tile(s, z));
            total += (x1 - x0 + 1) * (y1 - y0 + 1);
        }
    }
    return total;
}

/**
 * Pré-télécharge et met en cache une pyramide de tuiles XYZ pour une emprise et
 * une liste de sources réelles. Backoff exponentiel + RÉESSAI des tuiles
 * manquantes (pas de bypass WAF : on respecte un délai croissant sur échec).
 * @param onProgress  (done, total, ok, fail) — facultatif
 * @param opts  signal.aborted = true → arrêt coopératif
 */
// planMap.js:235-287 (fonction _prefetchTiles)
export async function prefetchTiles(
    bbox: GeoBBox,
    minZ: number,
    maxZ: number,
    templates: readonly TileTemplate[],
    onProgress?: PrefetchProgress | null,
    opts: PrefetchOptions = {}
): Promise<PrefetchResult> {
    if (typeof caches === 'undefined') throw new Error('Cache Storage indisponible.');
    const signal = opts.signal || null;
    const tiles = enumerateTiles(bbox, minZ, maxZ, templates);
    const cache = await caches.open(OFFLINE_MAP_CACHE);
    let done = 0, ok = 0, fail = 0, cursor = 0;
    const CONCURRENCY = 6;
    const MAX_RETRY = 3;

    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    async function fetchOne(url: string): Promise<boolean> {
        // Backoff exponentiel normal (pas d'évasion WAF) : 400ms, 800ms, 1600ms…
        for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
            if (signal && signal.aborted) return false;
            try {
                const already = await cache.match(url);
                if (already) return true;
                const resp = await fetch(url, { mode: 'cors', cache: 'force-cache' });
                if (resp && (resp.ok || resp.type === 'opaque')) {
                    await cache.put(url, resp.clone());
                    return true;
                }
            } catch { /* réseau/CORS : on réessaie après backoff */ }
            if (attempt < MAX_RETRY) await sleep(400 * Math.pow(2, attempt));
        }
        return false;
    }

    async function worker(): Promise<void> {
        while (cursor < tiles.length) {
            if (signal && signal.aborted) return;
            // `cursor` est strictement borné par `tiles.length` juste au-dessus ;
            // `noUncheckedIndexedAccess` type néanmoins l'accès `| undefined` —
            // neutralisé comme `coordAt` (SPEC-PLANMAP-SPLIT.md §6.3).
            const t = tiles[cursor++];
            if (!t) continue;
            const okTile = await fetchOne(t.url);
            if (okTile) ok++; else fail++;
            done++;
            if (onProgress) { try { onProgress(done, tiles.length, ok, fail); } catch { /* noop */ } }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { total: tiles.length, ok, fail, aborted: !!(signal && signal.aborted) };
}

/**
 * Compat : pré-cache léger de la France (imagerie satellite uniquement, bas zoom)
 * en arrière-plan. Réutilise prefetchTiles avec le seul template Esri.
 * @param onProgress  (done, total, ok, fail) — facultatif
 */
// planMap.js:289-299 (fonction _prefetchFranceTiles)
export async function prefetchFranceTiles(minZ: number, maxZ: number, onProgress?: PrefetchProgress | null): Promise<PrefetchResult> {
    const satTpl = styleTileTemplates().filter(t => t.id === 'satellite');
    return prefetchTiles(FRANCE_BBOX, minZ, maxZ, satTpl, onProgress);
}
