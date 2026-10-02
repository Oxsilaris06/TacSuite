/**
 * ign-territoires.ts — Emprises des flux IGN (Géoplateforme) : métropole + outre-mer.
 * ===========================================================================
 *
 * Décision « retours terrain 2026-10-02 » : la carto IGN sort de la métropole.
 * Périmètre : DROM (971 Guadeloupe, 972 Martinique, 973 Guyane, 974 La Réunion,
 * 976 Mayotte) + 975 Saint-Pierre-et-Miquelon, 977 Saint-Barthélemy, 978
 * Saint-Martin. Pas la Nouvelle-Calédonie ni la Polynésie (enquête séparée).
 *
 * POURQUOI UNE SOURCE PAR TERRITOIRE : MapLibre n'accepte qu'UN rectangle
 * `bounds` par source. Un rectangle unique couvrant métropole + Antilles + océan
 * Indien ferait requêter la Géoplateforme (et recevoir des tuiles blanches) sur
 * la moitié du globe. Chaque famille de couches IGN est donc déclinée en une
 * source + une couche par territoire SERVI, générées ici, une seule fois, pour
 * PC-Tac (`planmap/constants.ts`) et l'OI (`carto/constants.ts`).
 *
 * IDENTIFIANTS : la métropole garde l'id de base (`ign-ortho`, `planign`,
 * `contours`, `lidar-mnt`…), inchangé pour tout le code existant ; un territoire
 * d'outre-mer prend le suffixe `-<code>` (`ign-ortho-971`, `lidar-mnt-974`…).
 * Toute bascule de visibilité ou d'opacité doit viser TOUS les ids d'une famille
 * (`ignLayerIds`), jamais le seul id de base.
 *
 * COUVERTURE — mesurée, pas supposée. Sonde curl sans clé de data.geopf.fr le
 * 2026-10-02 : une tuile z14 sur une ville de chaque territoire, un quadrillage
 * de 36 à 56 tuiles z12 par emprise, et les zooms z8→z20 sur chaque ville :
 *   ortho    (TMS jpeg)  les 8 territoires, z8→z19.
 *   planign  (WMTS png)  les 8 territoires, z8→z19 (z18 à Saint-Pierre-et-Miquelon).
 *   contours (WMTS png)  971 972 974 976 977 978, z8→z18. NON servi en Guyane (973) ni
 *                        à Saint-Pierre-et-Miquelon (975) : 404 à tout zoom utile.
 *   lidar    (WMTS png)  971 et 974 SEULEMENT (z8→z18). Ailleurs la Géoplateforme ne rend
 *                        que la tuile vide de 722 o (z8→z11) puis 404 : rien à afficher,
 *                        donc aucune source déclarée (pas de requêtes inutiles).
 *   bdtopo   (pbf)       971 972 973 974 976 ; NON servi en 975, 977, 978 (404) — la source
 *                        `bdtopo` de PC-Tac n'a pas de `bounds` : rien à décliner ici.
 * Si l'IGN étend un jour une famille, c'est `OUTRE_MER_SERVI` qui change — une ligne.
 *
 * HORS COUVERTURE, L'ORTHO REND DU BLANC OPAQUE (200 + JPEG blanc, pas un 404), à
 * l'intérieur même de ces rectangles : tuile vide de 1651 o, ou tuile de bord mi-imagerie
 * mi-blanc. Resserrer les rectangles île par île économiserait des requêtes en pleine mer
 * mais pas ce blanc, qui entoure chaque île (la couverture colle à la terre) : il est donc
 * rendu transparent à l'affichage, dans `@shared/ign-ortho` (mesures et limites dans son
 * en-tête).
 *
 * Aucune position de l'utilisateur ne sort de l'appareil : le choix du territoire
 * est fait par MapLibre, localement, d'après le rectangle des tuiles à afficher.
 */

import type { LayerSpecification, RasterSourceSpecification } from 'maplibre-gl';

/** `[ouest, sud, est, nord]`, comme `bounds` d'une source MapLibre. */
export type IgnBounds = [number, number, number, number];

export interface IgnTerritory {
    /** Code INSEE (« 971 ») ; « FR » pour la métropole, dont l'id de base n'a pas de suffixe. */
    code: string;
    label: string;
    bounds: IgnBounds;
}

/** Familles de couches IGN dont la couverture diffère d'un territoire à l'autre. */
export type IgnFamily = 'ortho' | 'planign' | 'contours' | 'lidar';

/** Métropole et Corse, avec marge. Emprise historique des flux IGN, inchangée. */
export const IGN_METROPOLE: IgnTerritory = { code: 'FR', label: 'Métropole', bounds: [-5.6, 41.1, 9.8, 51.3] };

/**
 * Emprises d'outre-mer : rectangle serré autour des îles (marge ≈ 0,05°), SANS
 * recouvrement entre elles ni avec la métropole (testé). Plus c'est serré, moins
 * l'ortho rend de tuiles blanches sur la mer ou chez le voisin ; l'ortho étant
 * réellement servie sur Sint Maarten et le long du Maroni/Oyapock, ces zones
 * enclavées restent dans leur rectangle.
 */
export const IGN_OUTRE_MER: readonly IgnTerritory[] = [
    { code: '971', label: 'Guadeloupe', bounds: [-61.85, 15.8, -60.95, 16.55] },
    { code: '972', label: 'Martinique', bounds: [-61.25, 14.35, -60.78, 14.9] },
    { code: '973', label: 'Guyane', bounds: [-54.65, 2.1, -51.6, 5.8] },
    { code: '974', label: 'La Réunion', bounds: [55.18, -21.42, 55.87, -20.85] },
    { code: '975', label: 'Saint-Pierre-et-Miquelon', bounds: [-56.5, 46.7, -56.1, 47.15] },
    { code: '976', label: 'Mayotte', bounds: [44.95, -13.05, 45.35, -12.55] },
    { code: '977', label: 'Saint-Barthélemy', bounds: [-62.97, 17.86, -62.77, 17.99] },
    { code: '978', label: 'Saint-Martin', bounds: [-63.18, 18.0, -62.95, 18.15] },
];

/** Codes d'outre-mer où chaque famille est servie (sonde du 2026-10-02, cf. en-tête). */
const OUTRE_MER_SERVI: Record<IgnFamily, readonly string[]> = {
    ortho: ['971', '972', '973', '974', '975', '976', '977', '978'],
    planign: ['971', '972', '973', '974', '975', '976', '977', '978'],
    contours: ['971', '972', '974', '976', '977', '978'],
    lidar: ['971', '974'],
};

/** Territoires où la famille est servie : la métropole d'abord, puis l'outre-mer. */
export function ignTerritories(family: IgnFamily): IgnTerritory[] {
    const servis = OUTRE_MER_SERVI[family];
    return [IGN_METROPOLE, ...IGN_OUTRE_MER.filter((t) => servis.includes(t.code))];
}

/** Territoire (métropole comprise) dont le rectangle contient le point, ou `null` hors de tous. */
export function ignTerritoryAt(lng: number, lat: number): IgnTerritory | null {
    return [IGN_METROPOLE, ...IGN_OUTRE_MER].find(({ bounds: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n) ?? null;
}

/**
 * Libellé du territoire où la famille N'EST PAS servie au point donné ; `null` si elle l'est
 * (ou si le point est hors de tout territoire : on ne sait rien de la zone). Dit pourquoi une
 * couche activée n'affiche rien. Le LiDAR HD est déclaré servi en métropole même si sa
 * couverture y est partielle (déploiement par blocs : cf. le tutoriel).
 */
export function ignUnservedAt(family: IgnFamily, lng: number, lat: number): string | null {
    const t = ignTerritoryAt(lng, lat);
    return t && !ignTerritories(family).includes(t) ? t.label : null;
}

/** Id de source/couche d'un territoire : l'id de base en métropole, `<base>-<code>` ailleurs. */
export function ignLayerId(baseId: string, territory: IgnTerritory): string {
    return territory.code === IGN_METROPOLE.code ? baseId : `${baseId}-${territory.code}`;
}

/** Tous les ids (métropole + territoires servis) d'une famille — la cible de toute bascule. */
export function ignLayerIds(family: IgnFamily, baseId: string): string[] {
    return ignTerritories(family).map((t) => ignLayerId(baseId, t));
}

/** Paramètres d'une source raster IGN, sans le `bounds` que chaque territoire fournit. */
export type IgnSourceSpec = Omit<RasterSourceSpecification, 'type' | 'bounds' | 'tiles'> & { tiles: string[] };

/** Une source raster par territoire servi : mêmes paramètres, `bounds` du territoire. */
export function ignSources(family: IgnFamily, baseId: string, spec: IgnSourceSpec): Record<string, RasterSourceSpecification> {
    const out: Record<string, RasterSourceSpecification> = {};
    for (const t of ignTerritories(family)) {
        out[ignLayerId(baseId, t)] = { type: 'raster', ...spec, tiles: [...spec.tiles], bounds: [...t.bounds] };
    }
    return out;
}

type RasterLayer = Extract<LayerSpecification, { type: 'raster' }>;

/**
 * Une couche raster par territoire servi, dans l'ordre de `ignTerritories`. `make`
 * est appelée pour CHAQUE territoire : chacun reçoit ses propres `layout`/`paint`
 * (aucun objet partagé entre couches).
 */
export function ignLayers(family: IgnFamily, baseId: string, make: () => Omit<RasterLayer, 'id' | 'type' | 'source'>): RasterLayer[] {
    return ignTerritories(family).map((t) => {
        const id = ignLayerId(baseId, t);
        return { id, type: 'raster', source: id, ...make() };
    });
}
