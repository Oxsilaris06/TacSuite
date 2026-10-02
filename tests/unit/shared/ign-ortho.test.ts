/**
 * ign-ortho.test.ts — Ortho IGN d'outre-mer : le blanc « hors couverture »
 * devient transparent (décision « retours terrain 2026-10-02 », constat de
 * revue : « le piège des tuiles blanches doit rester traité »).
 *
 * Hors couverture la Géoplateforme répond 200 + un JPEG BLANC opaque, soit une
 * tuile entière de 1651 o, soit une tuile de bord mi-imagerie mi-blanc. Sans
 * traitement ce blanc masque l'imagerie Esri de z13 à z19. Les mesures
 * (sonde curl du 2026-10-02) figent la règle : voir l'en-tête de
 * `src/shared/ign-ortho.ts`.
 *
 * Le rendu réel (canvas, WebGL) est hors de portée de jsdom : la logique de
 * pixels est une fonction pure (`keyBorderWhite`), le reste est testé avec un
 * décodeur et un canvas factices.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OI_CARTO_RASTER_STYLE } from '@oi/carto/constants.js';
import { RASTER_STYLE } from '@pctac/planmap/constants.js';
import {
    IGN_BLANK_TILE_BYTES,
    IGN_ORTHO_SCHEME,
    ignOrthoMapOptions,
    ignOrthoRequest,
    keyBorderWhite,
    loadIgnOrthoTile,
} from '@shared/ign-ortho.js';
import { IGN_METROPOLE, ignLayerId, ignTerritories } from '@shared/ign-territoires.js';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const SEA: Rgb = [30, 60, 90];

/** Tuile RGBA w×h, alpha 255 partout, couleur donnée par `paint(x, y)`. */
function rgbaTile(w: number, h: number, paint: (x: number, y: number) => Rgb): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [r, g, b] = paint(x, y);
            const i = (y * w + x) * 4;
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        }
    }
    return d;
}
const alphaAt = (d: Uint8ClampedArray, w: number, x: number, y: number): number => d[(y * w + x) * 4 + 3] ?? -1;

const lon2tile = (lon: number, z: number): number => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat: number, z: number): number => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const ORTHO = 'https://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS';
const orthoAt = (lon: number, lat: number, z: number): string => `${ORTHO}/${z}/${lon2tile(lon, z)}/${lat2tile(lat, z)}.jpeg`;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// keyBorderWhite — le blanc relié au bord de la tuile devient transparent
// ---------------------------------------------------------------------------

describe('keyBorderWhite — détourage du blanc « hors couverture »', () => {
    it('tuile entièrement blanche : tout devient transparent', () => {
        const d = rgbaTile(8, 8, () => WHITE);
        expect(keyBorderWhite(d, 8, 8)).toBe(64);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(alphaAt(d, 8, x, y)).toBe(0);
    });

    it('bloc d\'imagerie dans un cadre blanc (tuile de bord) : seul le blanc est transparent', () => {
        // Anneau blanc d'1 px autour d'un bloc de mer 6×6 : 64 - 36 = 28 pixels blancs.
        const d = rgbaTile(8, 8, (x, y) => (x === 0 || y === 0 || x === 7 || y === 7 ? WHITE : SEA));
        expect(keyBorderWhite(d, 8, 8)).toBe(28);
        expect(alphaAt(d, 8, 0, 0)).toBe(0);
        expect(alphaAt(d, 8, 7, 3)).toBe(0);
        expect(alphaAt(d, 8, 3, 3)).toBe(255);
        expect(alphaAt(d, 8, 1, 1)).toBe(255);
    });

    it('moitié blanche, moitié imagerie (coupure franche, cas réel des tuiles de bord)', () => {
        const d = rgbaTile(16, 16, (x) => (x < 8 ? WHITE : SEA));
        expect(keyBorderWhite(d, 16, 16)).toBe(8 * 16);
        expect(alphaAt(d, 16, 7, 9)).toBe(0);
        expect(alphaAt(d, 16, 8, 9)).toBe(255);
    });

    it('un blanc ENCLAVÉ dans l\'imagerie (toit blanc, sel, écume) reste opaque : il n\'est pas relié au bord', () => {
        const d = rgbaTile(8, 8, (x, y) => (x >= 3 && x <= 4 && y >= 3 && y <= 4 ? WHITE : SEA));
        expect(keyBorderWhite(d, 8, 8)).toBe(0);
        expect(alphaAt(d, 8, 3, 3)).toBe(255);
        expect(alphaAt(d, 8, 4, 4)).toBe(255);
    });

    it('une bande blanche d\'1 px le long du bord est détourée (zone sans couverture qui effleure la tuile)', () => {
        const d = rgbaTile(8, 8, (x) => (x === 7 ? WHITE : SEA));
        expect(keyBorderWhite(d, 8, 8)).toBe(8);
        expect(alphaAt(d, 8, 7, 0)).toBe(0);
        expect(alphaAt(d, 8, 6, 0)).toBe(255);
    });

    it('lisière JPEG quasi blanche (250-252, écart ≤ 3) : détourée comme le blanc franc, et propage', () => {
        // Colonne 0 : blanc franc (graine) ; 1 : 252 ; 2 : 250 ; reste : mer.
        const cols: Rgb[] = [WHITE, [252, 252, 252], [250, 251, 250]];
        const d = rgbaTile(8, 4, (x) => cols[x] ?? SEA);
        expect(keyBorderWhite(d, 8, 4)).toBe(3 * 4);
        expect(alphaAt(d, 8, 2, 1)).toBe(0);
        expect(alphaAt(d, 8, 3, 1)).toBe(255);
    });

    // Sur une carte réelle, chaque dalle gardait un liseré clair : le JPEG sous-échantillonne
    // les couleurs par blocs, donc autour d'un blanc franc il reste une bande de blancs TEINTÉS
    // (251,255,255), (255,255,250)… large de 2 à 8 px, qui échappe au test « neutre ».
    it('bande de blancs teintés (bruit de chrominance du JPEG) de 8 px : mangée ; le 9e pixel et la mer restent', () => {
        // Aucun de ces pixels n'est un blanc franc (≥ 250 et écart ≤ 3) : seule la frange les atteint.
        const bande: Rgb[] = [[255, 255, 250], [251, 255, 251], [254, 255, 248], [255, 251, 255], [249, 255, 255], [255, 255, 251], [250, 255, 255], [255, 255, 249]];
        const cols: Rgb[] = [WHITE, ...bande, [250, 252, 255]];
        const d = rgbaTile(16, 4, (x) => cols[x] ?? SEA);
        // 4 lignes × (1 blanc franc + 8 pixels de bande).
        expect(keyBorderWhite(d, 16, 4)).toBe(9 * 4);
        expect(alphaAt(d, 16, 8, 2)).toBe(0);
        expect(alphaAt(d, 16, 9, 2)).toBe(255);
        expect(alphaAt(d, 16, 10, 2)).toBe(255);
    });

    it('un grand aplat clair TEINTÉ relié au bord n\'est pas du hors-couverture (toit clair, sel, ciel) : conservé', () => {
        const d = rgbaTile(40, 40, (x) => (x >= 30 ? [250, 255, 255] : SEA));
        expect(keyBorderWhite(d, 40, 40)).toBe(0);
        expect(alphaAt(d, 40, 35, 5)).toBe(255);
    });

    it('le sombre et les teintes (mer, terre, sable) touchent le détourage sans être entamés', () => {
        const cols: Rgb[] = [WHITE, [255, 250, 200], SEA];
        const d = rgbaTile(8, 4, (x) => cols[x] ?? SEA);
        expect(keyBorderWhite(d, 8, 4)).toBe(4);
        expect(alphaAt(d, 8, 1, 0)).toBe(255);
        expect(alphaAt(d, 8, 2, 0)).toBe(255);
    });

    it('un clair éloigné du détourage n\'est pas une frange : il reste opaque', () => {
        // Bande blanche à gauche, mer, puis un toit clair (245,248,250) isolé à droite.
        const d = rgbaTile(12, 4, (x) => (x === 0 ? WHITE : x === 9 ? [245, 248, 250] : SEA));
        expect(keyBorderWhite(d, 12, 4)).toBe(4);
        expect(alphaAt(d, 12, 9, 1)).toBe(255);
    });

    // Mesuré sur 177 tuiles de villes d'outre-mer : un toit blanc ou un pixel écrêté qui touche
    // le bord fait 1 à 469 px ; les vraies zones sans couverture, au moins 1348 px. Garde : 1 %.
    describe('garde de taille (1 % de la tuile)', () => {
        const roof = (x: number, y: number): boolean => x < 2 && y >= 10 && y < 13;

        it('petit blanc relié au bord (toit blanc, pixel écrêté) : conservé', () => {
            const d = rgbaTile(40, 40, (x, y) => (roof(x, y) ? WHITE : SEA));
            expect(keyBorderWhite(d, 40, 40)).toBe(0);
            expect(alphaAt(d, 40, 0, 11)).toBe(255);
        });

        it('zone sans couverture détourée, toit blanc de la même tuile conservé : la garde est par composant', () => {
            const d = rgbaTile(40, 40, (x, y) => (x >= 30 || roof(x, y) ? WHITE : SEA));
            expect(keyBorderWhite(d, 40, 40)).toBe(10 * 40);
            expect(alphaAt(d, 40, 35, 5)).toBe(0);
            expect(alphaAt(d, 40, 0, 11)).toBe(255);
        });

        // Un liseré blanc d'1 px collé au bord est fin (moins de 1 % de la tuile) mais long : c'est
        // la signature d'une coupure de dalle, pas d'un toit (≤ 23 px de contact mesurés).
        it('liseré fin collé au bord sur 64 px : retenu ; sur 63 px : refusé', () => {
            const long = rgbaTile(100, 100, (x, y) => (y === 0 && x < 64 ? WHITE : SEA));
            expect(keyBorderWhite(long, 100, 100)).toBe(64);
            const court = rgbaTile(100, 100, (x, y) => (y === 0 && x < 63 ? WHITE : SEA));
            expect(keyBorderWhite(court, 100, 100)).toBe(0);
        });

        it('le seuil est 1 % pile : 16 px sur 1600 retenus, 15 refusés', () => {
            const seize = rgbaTile(40, 40, (x, y) => (x < 2 && y < 8 ? WHITE : SEA));
            expect(keyBorderWhite(seize, 40, 40)).toBe(16);
            const quinze = rgbaTile(40, 40, (x, y) => (x < 2 && y < 8 && !(x === 1 && y === 7) ? WHITE : SEA));
            expect(keyBorderWhite(quinze, 40, 40)).toBe(0);
        });
    });

    it('aucun blanc au bord : rien n\'est modifié (une tuile de terre n\'est jamais touchée)', () => {
        const d = rgbaTile(8, 8, () => SEA);
        const avant = d.slice();
        expect(keyBorderWhite(d, 8, 8)).toBe(0);
        expect(d).toEqual(avant);
    });

    it('ne touche pas aux canaux de couleur : seul l\'alpha change', () => {
        const d = rgbaTile(4, 4, () => WHITE);
        keyBorderWhite(d, 4, 4);
        expect(Array.from(d.slice(0, 4))).toEqual([255, 255, 255, 0]);
    });
});

// ---------------------------------------------------------------------------
// ignOrthoRequest — quelles tuiles passent par le détourage
// ---------------------------------------------------------------------------

const VILLES_OUTRE_MER: [string, number, number][] = [
    ['971 Pointe-à-Pitre', -61.5331, 16.2411],
    ['972 Fort-de-France', -61.0588, 14.6161],
    ['973 Cayenne', -52.326, 4.9372],
    ['974 Saint-Denis', 55.4481, -20.8789],
    ['975 Saint-Pierre', -56.1773, 46.7766],
    ['976 Mamoudzou', 45.2278, -12.7806],
    ['977 Gustavia', -62.8498, 17.8963],
    ['978 Marigot', -63.0824, 18.0679],
];

describe('ignOrthoRequest — réécriture des seules tuiles d\'ortho d\'outre-mer', () => {
    it.each(VILLES_OUTRE_MER)('%s : l\'URL passe par le protocole `ignortho`, à tout zoom de la source (z11 à z19)', (_nom, lon, lat) => {
        for (const z of [11, 13, 15, 17, 19]) {
            const https = orthoAt(lon, lat, z);
            expect(ignOrthoRequest(https), `z${z}`).toEqual({ url: https.replace('https://', `${IGN_ORTHO_SCHEME}://`) });
        }
    });

    it('la métropole n\'est JAMAIS touchée : la neige alpine est du « blanc » légitime (52 à 83 % de blanc neutre mesuré)', () => {
        const metropole: [string, number, number][] = [
            ['Paris', 2.3522, 48.8566],
            ['Mont Blanc', 6.8651, 45.8326],
            ['Barre des Écrins', 6.359, 44.927],
            ['Vignemale', -0.145, 42.773],
            ['Marseille, large', 5.2, 43.0],
            ['Ajaccio', 8.7386, 41.9192],
            ['Lille', 3.06, 50.63],
        ];
        for (const [nom, lon, lat] of metropole) {
            for (const z of [11, 14, 17, 19]) expect(ignOrthoRequest(orthoAt(lon, lat, z)), `${nom} z${z}`).toBeUndefined();
        }
    });

    it('les autres flux et les autres hôtes ne sont pas touchés', () => {
        expect(ignOrthoRequest('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/14/7442/5391')).toBeUndefined();
        expect(ignOrthoRequest('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&TILEMATRIX=14&TILECOL=5391&TILEROW=7442')).toBeUndefined();
        expect(ignOrthoRequest('https://data.geopf.fr/geocodage/search?q=Pointe-%C3%A0-Pitre')).toBeUndefined();
        expect(ignOrthoRequest('https://example.com/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/14/5391/7442.jpeg')).toBeUndefined();
        // Un autre produit TMS de la Géoplateforme (pas l'ortho 20 cm) : hors sujet.
        expect(ignOrthoRequest('https://data.geopf.fr/tms/1.0.0/PLAN.IGN/14/5391/7442.png')).toBeUndefined();
    });

    it('en pleine mer, hors de tout territoire : inchangé', () => {
        expect(ignOrthoRequest(orthoAt(-40, 30, 12))).toBeUndefined();
    });

    it('les styles PC-Tac et OI déclarent des URL que le prédicat reconnaît, territoire par territoire', () => {
        // Lie trois choses qui doivent rester d'accord : l'URL du style, la table des
        // emprises et le prédicat. Le centre de chaque rectangle d'outre-mer est
        // réécrit, celui de la métropole non.
        for (const [nom, style] of [['PC-Tac', RASTER_STYLE], ['OI', OI_CARTO_RASTER_STYLE]] as const) {
            for (const t of ignTerritories('ortho')) {
                const id = ignLayerId('ign-ortho', t);
                const src = style.sources[id] as { tiles: string[]; bounds: number[] };
                const [w, s, e, n] = src.bounds as [number, number, number, number];
                const z = 12;
                const x = lon2tile((w + e) / 2, z), y = lat2tile((s + n) / 2, z);
                const url = (src.tiles[0] ?? '').replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
                const req = ignOrthoRequest(url);
                if (t.code === IGN_METROPOLE.code) expect(req, `${nom} ${id}`).toBeUndefined();
                else expect(req?.url, `${nom} ${id}`).toBe(url.replace('https://', `${IGN_ORTHO_SCHEME}://`));
            }
        }
    });

    it('les styles gardent des URL https : préchargement hors ligne et service worker voient la vraie URL', () => {
        for (const style of [RASTER_STYLE, OI_CARTO_RASTER_STYLE]) {
            for (const [id, src] of Object.entries(style.sources)) {
                if (!id.startsWith('ign-ortho')) continue;
                for (const u of (src as { tiles: string[] }).tiles) expect(u, id).toMatch(/^https:\/\/data\.geopf\.fr\/tms\//);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// loadIgnOrthoTile — le chargeur du protocole
// ---------------------------------------------------------------------------

const TILE_URL = `${IGN_ORTHO_SCHEME}://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/14/5391/7442.jpeg`;
const HTTPS_URL = `${ORTHO}/14/5391/7442.jpeg`;
const bytesOf = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(n).fill(7);

function stubFetch(body: Uint8Array<ArrayBuffer> | string, init: ResponseInit = { status: 200 }): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => new Response(body, init));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** Décodeur + canvas factices : `rgba` est ce que « lit » le canvas après décodage. */
function stubDecoding(width: number, height: number, rgba: Uint8ClampedArray) {
    const decoded = { width, height, close: vi.fn(), name: 'décodée' };
    const keyed = { width, height, close: vi.fn(), name: 'détourée' };
    const createImageBitmap = vi.fn().mockResolvedValueOnce(decoded).mockResolvedValueOnce(keyed);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const ctx = {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: rgba, width, height })),
        putImageData: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
    return { decoded, keyed, createImageBitmap, ctx };
}

describe('loadIgnOrthoTile — chargeur du protocole `ignortho`', () => {
    it('interroge la VRAIE URL https (le service worker la met en cache) avec le signal d\'annulation', async () => {
        const fetchMock = stubFetch(bytesOf(9000));
        const ac = new AbortController();
        await loadIgnOrthoTile({ url: TILE_URL }, ac);
        expect(fetchMock).toHaveBeenCalledWith(HTTPS_URL, { signal: ac.signal });
    });

    it('404 (tuile hors pyramide) : erreur portant status 404, que MapLibre traite en silence', async () => {
        stubFetch('<ExceptionReport/>', { status: 404, statusText: 'Not Found' });
        await expect(loadIgnOrthoTile({ url: TILE_URL }, new AbortController())).rejects.toMatchObject({ status: 404 });
    });

    it('autre statut HTTP : erreur portant ce statut (MapLibre la remonte comme avant)', async () => {
        stubFetch('oups', { status: 503, statusText: 'Service Unavailable' });
        await expect(loadIgnOrthoTile({ url: TILE_URL }, new AbortController())).rejects.toMatchObject({ status: 503 });
    });

    it('réseau en panne (hors ligne) : l\'erreur du fetch est relayée telle quelle', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        await expect(loadIgnOrthoTile({ url: TILE_URL }, new AbortController())).rejects.toThrow('Failed to fetch');
    });

    it('tuile vide de la Géoplateforme (1651 o) : PNG 1×1 transparent, sans décodage ni canvas', async () => {
        expect(IGN_BLANK_TILE_BYTES).toBe(1651);
        stubFetch(bytesOf(IGN_BLANK_TILE_BYTES));
        const createImageBitmap = vi.fn();
        vi.stubGlobal('createImageBitmap', createImageBitmap);
        const res = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect(createImageBitmap).not.toHaveBeenCalled();
        const png = new Uint8Array(res.data as ArrayBuffer);
        expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        // Chaque appel rend un tampon neuf : MapLibre peut le consommer sans effet de bord.
        const again = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect(again.data).not.toBe(res.data);
    });

    it('tuile de bord (imagerie + blanc relié au bord) : bitmap détouré, l\'intermédiaire est libéré', async () => {
        stubFetch(bytesOf(2100));
        const rgba = rgbaTile(8, 8, (x) => (x < 4 ? WHITE : SEA));
        const { decoded, keyed, ctx, createImageBitmap } = stubDecoding(8, 8, rgba);
        const res = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect(res.data).toBe(keyed);
        expect(decoded.close).toHaveBeenCalled();
        expect(ctx.putImageData).toHaveBeenCalledTimes(1);
        // Le pixel blanc est devenu transparent dans le tableau relu puis réécrit.
        expect(alphaAt(rgba, 8, 0, 0)).toBe(0);
        expect(alphaAt(rgba, 8, 7, 0)).toBe(255);
        expect(createImageBitmap).toHaveBeenCalledTimes(2);
    });

    it('tuile de terre (aucun blanc au bord) : le bitmap décodé est rendu tel quel, sans réécriture', async () => {
        stubFetch(bytesOf(18000));
        const { decoded, ctx } = stubDecoding(8, 8, rgbaTile(8, 8, () => SEA));
        const res = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect(res.data).toBe(decoded);
        expect(ctx.putImageData).not.toHaveBeenCalled();
    });

    it('navigateur sans décodage d\'image : octets bruts, MapLibre décode comme avant', async () => {
        stubFetch(bytesOf(18000));
        vi.stubGlobal('createImageBitmap', undefined);
        const res = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect(res.data).toBeInstanceOf(ArrayBuffer);
        expect((res.data as ArrayBuffer).byteLength).toBe(18000);
    });

    it('décodage en échec : octets bruts, jamais d\'erreur ajoutée par le détourage', async () => {
        stubFetch(bytesOf(18000));
        vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('image corrompue')));
        const res = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect((res.data as ArrayBuffer).byteLength).toBe(18000);
    });

    it('canvas indisponible : bitmap décodé rendu tel quel (pas de détourage, pas d\'erreur)', async () => {
        stubFetch(bytesOf(18000));
        const decoded = { width: 8, height: 8, close: vi.fn() };
        vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(decoded));
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
        const res = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect(res.data).toBe(decoded);
    });

    it('transmet les en-têtes de cache à MapLibre (rafraîchissement des tuiles expirées)', async () => {
        stubFetch(bytesOf(9000), { status: 200, headers: { 'Cache-Control': 'max-age=3600', Expires: 'Fri, 02 Oct 2026 12:00:00 GMT' } });
        const res = await loadIgnOrthoTile({ url: TILE_URL }, new AbortController());
        expect(res.cacheControl).toBe('max-age=3600');
        expect(res.expires).toBe('Fri, 02 Oct 2026 12:00:00 GMT');
    });
});

// ---------------------------------------------------------------------------
// ignOrthoMapOptions — branchement dans `new maplibregl.Map({...})`
// ---------------------------------------------------------------------------

describe('ignOrthoMapOptions — options à fusionner dans la construction de la carte', () => {
    it('enregistre le protocole `ignortho` et fournit la réécriture des requêtes', () => {
        const addProtocol = vi.fn();
        const opts = ignOrthoMapOptions({ addProtocol });
        expect(addProtocol).toHaveBeenCalledTimes(1);
        expect(addProtocol).toHaveBeenCalledWith(IGN_ORTHO_SCHEME, loadIgnOrthoTile);
        expect(opts.transformRequest).toBe(ignOrthoRequest);
    });

    it('sans addProtocol (MapLibre absent ou factice) : aucune réécriture, donc aucune URL inchargeable', () => {
        expect(ignOrthoMapOptions({})).toEqual({});
    });
});
