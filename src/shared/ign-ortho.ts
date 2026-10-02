/**
 * ign-ortho.ts — Ortho IGN (BD ORTHO, Géoplateforme) : le blanc « hors couverture »
 * devient transparent, pour les territoires d'outre-mer.
 * ===========================================================================
 *
 * Décision « retours terrain 2026-10-02 » (carto IGN outre-mer). Constat de revue :
 * « le piège des tuiles blanches hors couverture doit rester traité ».
 *
 * LE PIÈGE. Hors couverture, la Géoplateforme ne répond pas 404 : elle répond 200 et
 * un JPEG BLANC OPAQUE (pas de canal alpha) qui masque l'imagerie Esri placée dessous.
 * Deux formes, mesurées le 2026-10-02 (sonde curl sans clé, tuiles z11→z19) :
 *   - la tuile VIDE : 1651 o, identique à l'octet près dans les 8 territoires et à tout
 *     zoom (28 tuiles sur 28) ;
 *   - la tuile de BORD : de l'imagerie réelle et du blanc. L'ortho est livrée par dalles
 *     rectangulaires, le reste du carreau est rempli de blanc.
 * En métropole la couverture déborde en mer : c'est rare. Outre-mer elle colle à la
 * terre. À z13, sur un échantillon de 49 tuiles par rectangle (20 et 24 à Saint-Barthélemy
 * et Saint-Martin), 22 à 55 % des tuiles sont vides et 24 à 65 % sont des tuiles de bord
 * (2 % en Guyane, où 57 % des tuiles sont absentes : 404, qui laissent Esri visible) ; une
 * tuile de Saint-Denis à z15 est blanche à 88 %. Sans traitement, ce blanc recouvre Esri
 * de z13 à z19, et dès z12 en voile à 50 % (le fondu 11→13). L'hypothèse historique
 * « à z11 la vue est dominée par du sol, donc pas de blanc » est fausse hors métropole.
 * Les couches ORTHOIMAGERY.ORTHOPHOTOS et ...BDORTHO rendent les mêmes octets au même
 * endroit : changer de couche n'y fait rien.
 *
 * LE TRAITEMENT, par tuile et à l'AFFICHAGE :
 *   1. tuile vide (1651 o) : PNG 1×1 transparent, sans décoder ;
 *   2. sinon : on décode, et le blanc RELIÉ AU BORD du carreau devient transparent
 *      (remplissage depuis le bord). Un blanc enclavé dans l'imagerie (toit blanc,
 *      marais salant, écume) n'est pas relié au bord : il reste opaque.
 * « Blanc » : les trois canaux ≥ 250 et un écart ≤ 3 entre eux. Le 250 absorbe les
 * pixels à 250-252 que la compression JPEG laisse à la lisière d'une dalle ; l'écart
 * écarte le sable, le ciel et les teintes.
 * GARDE : un composant blanc qui fait moins de 1 % de la tuile ET touche le bord sur moins
 * de 64 px n'est pas du « hors couverture » mais un toit blanc ou un pixel écrêté. Mesuré
 * sur 175 composants de tuiles de villes d'outre-mer : ces faux positifs font 1 à 469 px et
 * touchent le bord sur 23 px au plus ; les zones sans couverture font au moins 1348 px, ou
 * touchent le bord sur au moins 84 px (liseré fin collé au bord de la tuile). Sur 90 tuiles
 * urbaines z17-z19, aucune n'est touchée.
 * FRANGE : le JPEG sous-échantillonne les couleurs par blocs ; autour d'un blanc franc, une
 * bande de blancs TEINTÉS ((251,255,255), (255,255,250)…) large de 2 à 8 px échappe au test
 * « neutre » et dessinait un liseré blanc autour de chaque dalle (vu sur une carte MapLibre
 * réelle). On la mange en largeur depuis le détourage, 8 pixels au plus, sur les pixels
 * dont le plus sombre des canaux reste ≥ 225 : le sombre (mer, terre) touche le détourage
 * sans être entamé (mesuré sur 239 tuiles : 4731 pixels clairs résiduels au contact du
 * détourage avec 2 px de profondeur, 79 avec 8).
 *
 * POURQUOI PAS EN MÉTROPOLE. La neige et les glaciers alpins sont du blanc neutre
 * LÉGITIME : 52 % de blanc neutre sur une tuile du Vignemale à z13, 83 % sur la Barre des
 * Écrins à z17. Détourer la métropole y percerait l'ortho. Elle garde donc son
 * comportement d'avant (minzoom 11 et fondu 11→13, rien d'autre). Les images des
 * territoires d'outre-mer n'ont ni neige ni glacier.
 *
 * BRANCHEMENT. `ignOrthoMapOptions` (à fusionner dans `new maplibregl.Map({...})`)
 * enregistre le protocole `ignortho` et réécrit, via `transformRequest`, l'URL des
 * seules tuiles qui touchent un territoire d'outre-mer. Le style garde ses URL https :
 * le service worker, le préchargement hors ligne (AOI) et les tests voient la vraie
 * URL, et une carte construite sans ces options retombe sur le comportement d'avant
 * au lieu de casser. Le préchargement stocke les octets BRUTS de l'IGN : le détourage
 * se fait à l'affichage, donc aussi hors ligne et sur les copies déjà en cache.
 *
 * LIMITES. Un blanc enclavé n'est pas détouré (trou de couverture au milieu d'une
 * tuile : rare). Un petit coin sans couverture (moins de 1 % de la tuile et moins de 64 px
 * de contact avec le bord) reste blanc, de même que quelques pixels de liseré bruité :
 * 1 100 px résiduels sur 158 tuiles de bord. Un toit parfaitement neutre ≥ 250, d'au moins
 * 1 % de la tuile et coupé par le bord du carreau, serait détouré (aucun cas sur 90 tuiles
 * urbaines). Sans `createImageBitmap` ni canvas, la tuile part brute (comportement
 * d'avant), sauf la tuile vide, reconnue sans décoder.
 *
 * `IGN_BLANK_TILE_BYTES` n'est qu'un raccourci de performance : s'il dérivait (l'IGN
 * ré-encodant sa tuile vide), le chemin général détourerait quand même, plus lentement.
 * `scripts/check-ign-lidar.mjs` le revérifie.
 *
 * Aucune position de l'utilisateur ne sort de l'appareil : la tuile à détourer est
 * choisie par MapLibre, localement ; le détourage est un calcul local.
 */

import type { AddProtocolAction, GetResourceResponse, RequestParameters, RequestTransformFunction } from 'maplibre-gl';
import { IGN_METROPOLE, ignTerritories } from './ign-territoires.js';
import type { IgnBounds } from './ign-territoires.js';

/** Schéma MapLibre des tuiles d'ortho d'outre-mer (`ignortho://data.geopf.fr/tms/…`). */
export const IGN_ORTHO_SCHEME = 'ignortho';

/** Octets de la tuile vide de la Géoplateforme (JPEG 256×256 blanc), mesurés le 2026-10-02. */
export const IGN_BLANK_TILE_BYTES = 1651;

/** Seuil de « blanc » sur chacun des trois canaux (0-255) : cf. l'en-tête. */
const WHITE_MIN = 250;
/** Écart maximal entre les trois canaux d'un pixel blanc : écarte sable, ciel et teintes. */
const WHITE_SPREAD = 3;
/** Part minimale de la tuile (1 %) pour qu'un blanc relié au bord soit du « hors couverture »… */
const MIN_REGION_SHARE = 0.01;
/** … ou, à défaut, longueur minimale de son contact avec le bord de la tuile (un liseré fin). */
const MIN_BORDER_CONTACT = 64;
/** Canal le plus sombre minimal d'un pixel de frange (blanc teinté par le JPEG) mangé au contact du détourage. */
const FRINGE_MIN = 225;
/** Épaisseur maximale de la frange mangée, en pixels (mesuré : 2 à 8 px selon la dalle). */
const FRINGE_DEPTH = 8;

/** PNG 1×1 transparent (le même que celui de MapLibre pour ses tuiles vides). */
const EMPTY_TILE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';

/** Tuile d'ortho 20 cm de la Géoplateforme (TMS) : seul flux qui rend du blanc opaque. */
const ORTHO_TILE_URL = /^https:\/\/data\.geopf\.fr\/tms\/1\.0\.0\/HR\.ORTHOIMAGERY\.ORTHOPHOTOS\/(\d+)\/(\d+)\/(\d+)\.jpeg$/;

/** Territoires où l'ortho est servie, métropole exclue (cf. « pourquoi pas en métropole »). */
const OUTRE_MER_ORTHO = ignTerritories('ortho').filter((t) => t.code !== IGN_METROPOLE.code);

/** `[ouest, sud, est, nord]` de la tuile z/x/y (Web Mercator, schéma XYZ). */
function tileBounds(z: number, x: number, y: number): IgnBounds {
    const n = 2 ** z;
    const lat = (row: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
    return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/** Vrai si la tuile z/x/y recouvre (même en partie) un territoire d'outre-mer. */
function touchesOutreMer(z: number, x: number, y: number): boolean {
    const [w, s, e, n] = tileBounds(z, x, y);
    return OUTRE_MER_ORTHO.some(({ bounds: [bw, bs, be, bn] }) => w < be && e > bw && s < bn && n > bs);
}

/**
 * `transformRequest` de MapLibre : fait passer par le protocole `ignortho` les seules
 * tuiles d'ortho d'outre-mer ; toute autre requête reste inchangée (`undefined`).
 */
export function ignOrthoRequest(url: string): RequestParameters | undefined {
    const m = ORTHO_TILE_URL.exec(url);
    if (!m || !touchesOutreMer(Number(m[1]), Number(m[2]), Number(m[3]))) return undefined;
    return { url: IGN_ORTHO_SCHEME + url.slice('https'.length) };
}

/**
 * Rend transparent le blanc relié au bord de la tuile RGBA `w`×`h`, plus sa frange claire
 * (modifie `rgba` sur place : seul l'alpha change). Retourne le nombre de pixels rendus
 * transparents ; 0 = tuile intacte (terre, ou aucune zone blanche assez grande ou assez collée
 * au bord).
 */
export function keyBorderWhite(rgba: Uint8ClampedArray, w: number, h: number): number {
    const n = w * h;
    const chan = (p: number, c: number): number => rgba[p * 4 + c] ?? 0;
    const darkest = (p: number): number => Math.min(chan(p, 0), chan(p, 1), chan(p, 2));
    const isWhite = (p: number): boolean => darkest(p) >= WHITE_MIN && Math.max(chan(p, 0), chan(p, 1), chan(p, 2)) - darkest(p) <= WHITE_SPREAD;
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    // Pixels des composants retenus, à la suite : un composant refusé est réécrit par le suivant.
    const region = new Int32Array(n);
    let keyed = 0;

    // 1. Composants de blanc franc reliés au bord, retenus s'ils sont assez grands ou assez collés au bord.
    const flood = (seed: number): void => {
        if (seen[seed]) return;
        seen[seed] = 1;
        if (!isWhite(seed)) return;
        let size = keyed;
        let top = 0;
        let contact = 0;
        stack[top++] = seed;
        while (top > 0) {
            const p = stack[--top] ?? 0;
            region[size++] = p;
            const x = p % w;
            if (x === 0 || x === w - 1 || p < w || p >= n - w) contact++;
            if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; if (isWhite(p - 1)) stack[top++] = p - 1; }
            if (x < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; if (isWhite(p + 1)) stack[top++] = p + 1; }
            if (p >= w && !seen[p - w]) { seen[p - w] = 1; if (isWhite(p - w)) stack[top++] = p - w; }
            if (p < n - w && !seen[p + w]) { seen[p + w] = 1; if (isWhite(p + w)) stack[top++] = p + w; }
        }
        if (size - keyed < n * MIN_REGION_SHARE && contact < MIN_BORDER_CONTACT) return;
        for (let i = keyed; i < size; i++) rgba[(region[i] ?? 0) * 4 + 3] = 0;
        keyed = size;
    };
    for (let x = 0; x < w; x++) { flood(x); flood(n - w + x); }
    for (let y = 1; y < h - 1; y++) { flood(y * w); flood(y * w + w - 1); }
    if (keyed === 0) return 0;

    // 2. Frange : on mange en largeur, depuis le détourage, les pixels clairs (couche par couche).
    let layer: number[] = Array.from(region.subarray(0, keyed));
    for (let depth = 0; depth < FRINGE_DEPTH && layer.length > 0; depth++) {
        const next: number[] = [];
        for (const p of layer) {
            const x = p % w;
            for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1]) {
                if (q >= 0 && rgba[q * 4 + 3] !== 0 && darkest(q) >= FRINGE_MIN) {
                    rgba[q * 4 + 3] = 0;
                    next.push(q);
                }
            }
        }
        keyed += next.length;
        layer = next;
    }
    return keyed;
}

/**
 * Décode la tuile et détoure son blanc de bord. `null` = impossible ici (navigateur
 * sans `createImageBitmap`, décodage en échec) : l'appelant rend alors les octets bruts.
 */
async function keyTile(bytes: ArrayBuffer): Promise<ImageBitmap | null> {
    try {
        if (typeof createImageBitmap !== 'function') return null;
        const decoded = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const canvas = document.createElement('canvas');
        canvas.width = decoded.width;
        canvas.height = decoded.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return decoded;
        ctx.drawImage(decoded, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (keyBorderWhite(img.data, canvas.width, canvas.height) === 0) return decoded;
        decoded.close();
        ctx.putImageData(img, 0, 0);
        return await createImageBitmap(canvas);
    } catch {
        return null;
    }
}

/**
 * Chargeur du protocole `ignortho` (`maplibregl.addProtocol`). Récupère la VRAIE URL
 * https, comme MapLibre l'aurait fait (donc via le service worker et son cache), puis
 * neutralise le blanc. Un statut HTTP d'erreur lève une erreur portant `status`, comme
 * l'`AJAXError` de MapLibre : un 404 (tuile hors pyramide) reste silencieux.
 */
export async function loadIgnOrthoTile(params: RequestParameters, abort: AbortController): Promise<GetResourceResponse<ArrayBuffer | ImageBitmap>> {
    const resp = await fetch(`https${params.url.slice(IGN_ORTHO_SCHEME.length)}`, { signal: abort.signal });
    if (!resp.ok) {
        throw Object.assign(new Error(`AJAXError: ${resp.statusText} (${resp.status}): ${params.url}`), { status: resp.status });
    }
    const bytes = await resp.arrayBuffer();
    const expiry = { cacheControl: resp.headers.get('Cache-Control'), expires: resp.headers.get('Expires') };
    if (bytes.byteLength === IGN_BLANK_TILE_BYTES) {
        return { data: Uint8Array.from(atob(EMPTY_TILE_PNG), (c) => c.charCodeAt(0)).buffer, ...expiry };
    }
    return { data: (await keyTile(bytes)) ?? bytes, ...expiry };
}

/**
 * Options à fusionner dans `new maplibregl.Map({...})` : enregistre le protocole et
 * réécrit les tuiles d'ortho d'outre-mer. Sans `addProtocol` (MapLibre factice ou
 * absent), aucune réécriture : l'URL https reste chargeable telle quelle.
 */
export function ignOrthoMapOptions(ml: { addProtocol?: (scheme: string, load: AddProtocolAction) => void }): { transformRequest?: RequestTransformFunction } {
    if (typeof ml.addProtocol !== 'function') return {};
    ml.addProtocol(IGN_ORTHO_SCHEME, loadIgnOrthoTile);
    return { transformRequest: ignOrthoRequest };
}
