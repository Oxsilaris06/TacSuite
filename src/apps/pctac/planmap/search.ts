/**
 * search.ts — Géocodage d'adresse du plan (décision 35, lot C).
 * ===========================================================================
 *
 * Ordre imposé (Nico, 2026-10-28) : d'abord Nominatim (OpenStreetMap), qui
 * connaît les lieux nommés (gendarmerie, gare, commerce) et l'étranger ; la
 * Base Adresse Nationale de la Géoplateforme IGN
 * (`https://data.geopf.fr/geocodage/search`, CORS ouvert, réponse GeoJSON)
 * SEULEMENT si Nominatim ne rend rien ou échoue (réseau, délai de 5 s, statut
 * non 200, quota 429). La BAN ne connaît que des adresses : sur un nom de
 * lieu, elle rendait des homonymes jugés imprécis. La recherche de coordonnées (décimal, DMS, MGRS, case) est
 * traitée EN AMONT par `parseCoordinateInput` (@shared/coords.ts) : aucun
 * appel réseau dans ce cas.
 *
 * Module PUR au sens DOM/carte (fetch injectable pour les tests), aucune
 * dépendance PC-Tac. `fetch` est injecté avec `globalThis.fetch` par défaut.
 */

import { looksLikeCoordinates } from '@shared/coords.js';

/** Endpoint de repli BAN (Géoplateforme IGN). */
export const BAN_ENDPOINT = 'https://data.geopf.fr/geocodage/search';
/** Endpoint principal (Nominatim, OpenStreetMap). */
export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
/** Délai maximal par requête avant repli (exigence : 5 s). */
export const GEOCODE_TIMEOUT_MS = 5000;
/**
 * B4 (revue du 25/09) — en dessous de ce score, la BAN rend des homonymes
 * français d'une adresse étrangère (« Genève gare Cornavin » → Vierzon, 0,4) :
 * ce n'est pas une réponse sûre. Ces résultats sont marqués `weak` et classés
 * après les autres.
 */
export const BAN_MIN_SCORE = 0.5;

export type GeocodeSource = 'ban' | 'nominatim';

export interface GeocodeHit {
    label: string;
    lng: number;
    lat: number;
    source: GeocodeSource;
    /** Score BAN (0 à 1) quand la BAN le fournit. */
    score?: number;
    /** Correspondance approximative (score sous {@link BAN_MIN_SCORE}) : l'hôte ne s'y rend pas d'office. */
    weak?: boolean;
}

export function banSearchUrl(q: string): string {
    return `${BAN_ENDPOINT}?q=${encodeURIComponent(q)}&limit=5`;
}

export function nominatimSearchUrl(q: string): string {
    return `${NOMINATIM_ENDPOINT}?format=json&limit=5&q=${encodeURIComponent(q)}`;
}

/** Une entrée brute BAN (GeoJSON Feature) — seuls les champs lus. */
interface BanFeature {
    properties?: { label?: unknown; score?: unknown } | undefined;
    geometry?: { coordinates?: unknown } | undefined;
}

/** Extrait les résultats d'une réponse BAN GeoJSON. Ne jette jamais. */
export function parseBanResults(json: unknown): GeocodeHit[] {
    const features = (json as { features?: unknown } | null)?.features;
    if (!Array.isArray(features)) return [];
    const out: GeocodeHit[] = [];
    for (const f of features as BanFeature[]) {
        const label = f?.properties?.label;
        const coords = f?.geometry?.coordinates;
        if (typeof label !== 'string' || !Array.isArray(coords)) continue;
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const score = Number(f?.properties?.score);
        out.push(Number.isFinite(score) ? { label, lng, lat, source: 'ban', score } : { label, lng, lat, source: 'ban' });
    }
    return out;
}

/** Extrait les résultats d'une réponse Nominatim (tableau). Ne jette jamais. */
export function parseNominatimResults(json: unknown): GeocodeHit[] {
    if (!Array.isArray(json)) return [];
    const out: GeocodeHit[] = [];
    for (const item of json as Array<{ display_name?: unknown; lon?: unknown; lat?: unknown }>) {
        const label = item?.display_name;
        const lng = Number(item?.lon);
        const lat = Number(item?.lat);
        if (typeof label !== 'string' || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        out.push({ label, lng, lat, source: 'nominatim' });
    }
    return out;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `fetch` borné par un délai (AbortController). Le chronomètre est toujours
 * annulé en sortie : aucune requête abandonnée ne fuit. Un `timeoutMs` ≤ 0 ou
 * l'absence d'`AbortController` (test, vieux navigateur) → appel direct.
 */
export async function fetchWithTimeout(
    url: string,
    fetchImpl: FetchLike,
    timeoutMs: number,
    headers?: Record<string, string>,
): Promise<Response> {
    if (timeoutMs <= 0 || typeof AbortController !== 'function') {
        return headers ? fetchImpl(url, { headers }) : fetchImpl(url);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const init: RequestInit = { signal: ctrl.signal };
        if (headers) init.headers = headers;
        return await fetchImpl(url, init);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Géocode une adresse : Nominatim d'abord, BAN en repli. Retourne `[]` si les
 * deux ne rendent rien. JETTE seulement si Nominatim échoue ET que la BAN ne
 * rend rien : l'appelant affiche alors l'erreur de Nominatim (« HTTP 429 »…).
 */
export async function geocodeAddress(
    q: string,
    fetchImpl: FetchLike = globalThis.fetch as FetchLike,
    timeoutMs: number = GEOCODE_TIMEOUT_MS,
): Promise<GeocodeHit[]> {
    const query = q.trim();
    // Des coordonnées ne partent jamais au géocodage : la position ne serait
    // révélée à l'IGN ou à Nominatim sans nécessité (Nico 2026-09-26).
    if (!query || looksLikeCoordinates(query)) return [];
    let nominatimError: unknown = null;
    try {
        const r = await fetchWithTimeout(nominatimSearchUrl(query), fetchImpl, timeoutMs, { 'Accept-Language': 'fr' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const hits = parseNominatimResults(await r.json());
        if (hits.length) return hits;
    } catch (e) {
        nominatimError = e;
    }
    let ban: GeocodeHit[] = [];
    try {
        const r2 = await fetchWithTimeout(banSearchUrl(query), fetchImpl, timeoutMs, { 'Accept-Language': 'fr' });
        if (r2.ok) ban = parseBanResults(await r2.json());
    } catch {
        // BAN injoignable aussi : seule l'erreur de Nominatim compte.
    }
    if (!ban.length) {
        if (nominatimError) throw nominatimError;
        return [];
    }
    // B4 — sous le seuil, marqué faible et classé après les résultats sûrs.
    const sure = ban.filter((h) => (h.score ?? 1) >= BAN_MIN_SCORE);
    const weak = ban.filter((h) => (h.score ?? 1) < BAN_MIN_SCORE).map((h) => ({ ...h, weak: true }));
    return [...sure, ...weak];
}
