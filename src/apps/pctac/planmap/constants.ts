/**
 * constants.ts — Constantes de MODULE de `planMap.js` (P2.CONV, paquet `pm-core`).
 * ===========================================================================
 *
 * Les 11 exports de SPEC-PLANMAP-SPLIT.md §4.0 (planMap.js:23-130), recopiés
 * VERBATIM (aucune URL, aucun nombre modifié).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import type { StyleSpecification } from 'maplibre-gl';
import { esc } from '@shared/ui-platform.js';
import type { GeoBBox, LidarLayerId, PlanEntityKind } from './types.js';

// Échappement HTML pour toute donnée externe injectée en innerHTML/setHTML
// (résultats Nominatim contributifs, libellés). Aligné sur ui.js.
// planMap.js:23-27 — la branche de repli (window.UIPlatform absent) est morte
// par construction en ESM (l'import ne peut pas manquer) → supprimée,
// comportement identique (SPEC-PLANMAP-SPLIT §6.4).
export const escHtml = esc;

// planMap.js:29-31
export const PINS_KEY = 'pcTacPlanPins';
export const VIEW_KEY = 'pcTacPlanView';
export const SHAPES_KEY = 'pcTacPlanShapes';
// Overlay LiDAR HD actif (hors planMap.js — cf. LIDAR_HD_LAYERS ci-dessous).
export const LIDAR_KEY = 'pcTacPlanLidar';

// Code couleur — strictement aligné sur la légende affichée
// (--danger-red, --civil-yellow, --inter-blue, --ao-green dans pctac2.html)
// planMap.js:35-39
export const ENTITY_COLORS: Record<PlanEntityKind, string> = {
    adv: '#ef4444',    // Adv  / rouge
    host: '#eab308',   // Otage / jaune
    friend: '#3b82f6'  // Inter / bleu
};

/* =====================================================================
 * OVERLAYS LiDAR HD (IGN / Géoplateforme) — HORS planMap.js
 *
 * Les trois ombrages dérivés du programme LiDAR HD, diffusés SANS CLÉ par la
 * Géoplateforme en WMTS (même hôte `data.geopf.fr` que la BD ORTHO et la BD
 * TOPO déjà utilisées ci-dessous, donc déjà couvert par le cache tuiles du
 * Service Worker, `public/sw.ts:TILE_HOSTS`) :
 *   - MNT = sol nu     → relief réel SOUS la végétation (chemins, talus, fossés,
 *                        anciennes traces) : le plus utile en tactique.
 *   - MNS = sursol     → relief de la surface vue du ciel (bâti + canopée).
 *   - MNH = hauteur    → hauteur de végétation (MNS − MNT) : densité du couvert.
 *
 * Le TileMatrixSet `PM` est la grille Web Mercator standard : `TILEMATRIX={z}`,
 * `TILECOL={x}`, `TILEROW={y}` se substituent donc directement au schéma XYZ
 * attendu par une source raster MapLibre.
 *
 * COUVERTURE : le programme est déployé par blocs ; hors zone volée le WMTS ne
 * renvoie PAS de tuile (contrairement à la BD ORTHO qui renvoie du JPEG blanc
 * opaque — cf. le piège documenté sur `ign-ortho`). Un trou de couverture laisse
 * donc simplement l'imagerie en dessous visible : l'overlay est sûr à tout zoom.
 * ===================================================================== */

/** Zoom max de la pyramide WMTS des ombrages LiDAR HD (grille PM).
 *  z18 ≈ 0,6 m/px, cohérent avec un produit à 50 cm. Au-delà MapLibre
 *  sur-zoome la tuile z18 (pas de trou). Vérifiable via
 *  `node scripts/check-ign-lidar.mjs` (sonde le GetCapabilities réel). */
export const LIDAR_MAX_ZOOM = 18;
/** En deçà, l'ombrage n'apporte rien et coûte des tuiles inutiles. */
export const LIDAR_MIN_ZOOM = 8;

/** Identifiants des trois overlays LiDAR HD, dans l'ordre de cyclage du bouton.
 *  Le type `LidarLayerId` vit dans `types.ts` (feuille du découpage, §3). */
export const LIDAR_LAYER_IDS: readonly LidarLayerId[] = ['mnt', 'mns', 'mnh'];

export interface LidarLayerDef {
    /** Identifiant de la source ET de la couche dans le style MapLibre. */
    sourceId: string;
    /** Nom de la ressource WMTS Géoplateforme (paramètre `LAYER`). */
    wmtsLayer: string;
    /** Libellé court affiché (toast / title du bouton). */
    label: string;
    /** Une phrase : ce que la couche montre. */
    hint: string;
}

export const LIDAR_HD_LAYERS: Record<LidarLayerId, LidarLayerDef> = {
    mnt: {
        sourceId: 'lidar-mnt',
        wmtsLayer: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
        label: 'LiDAR HD — MNT (sol nu)',
        hint: 'Relief du sol sous la végétation',
    },
    mns: {
        sourceId: 'lidar-mns',
        wmtsLayer: 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
        label: 'LiDAR HD — MNS (sursol)',
        hint: 'Relief de la surface : bâti + canopée',
    },
    mnh: {
        sourceId: 'lidar-mnh',
        wmtsLayer: 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
        label: 'LiDAR HD — MNH (hauteur)',
        hint: 'Hauteur de végétation (densité du couvert)',
    },
};

/** URL de tuile WMTS Géoplateforme (grille PM = XYZ) pour une ressource donnée. */
export function lidarTileUrl(wmtsLayer: string): string {
    return 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
        + '&LAYER=' + wmtsLayer
        + '&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM'
        + '&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}';
}

/** Les 3 sources raster LiDAR HD, prêtes à être fusionnées dans `RASTER_STYLE`. */
function lidarSources(): StyleSpecification['sources'] {
    const out: StyleSpecification['sources'] = {};
    for (const id of LIDAR_LAYER_IDS) {
        const def = LIDAR_HD_LAYERS[id];
        out[def.sourceId] = {
            type: 'raster',
            tiles: [lidarTileUrl(def.wmtsLayer)],
            tileSize: 256,
            minzoom: LIDAR_MIN_ZOOM,
            maxzoom: LIDAR_MAX_ZOOM,
            bounds: [-5.6, 41.1, 9.8, 51.3],
            attribution: 'LiDAR HD © IGN / Géoplateforme',
        };
    }
    return out;
}

/** Les 3 couches raster LiDAR HD, MASQUÉES par défaut : tant qu'aucune n'est
 *  visible, MapLibre ne requête aucune tuile (coût réseau nul à l'arrêt). */
function lidarLayers(): StyleSpecification['layers'] {
    return LIDAR_LAYER_IDS.map((id) => ({
        id: LIDAR_HD_LAYERS[id].sourceId,
        type: 'raster' as const,
        source: LIDAR_HD_LAYERS[id].sourceId,
        layout: { visibility: 'none' as const },
        paint: {
            // 0.85 : l'ombrage domine (lecture du micro-relief) tout en laissant
            // transparaître l'imagerie pour garder les repères visuels.
            'raster-opacity': 0.85,
            'raster-fade-duration': 300,
        },
    }));
}

// Style satellite ESRI World Imagery + modèle d'élévation (DEM) AWS Open Data
// Tout sans clé API, sans tracking. Le DEM ne sert qu'au relief 3D (setTerrain).
// planMap.js:43-113
export const RASTER_STYLE: StyleSpecification = {
    version: 8,
    // Polices keyless servies par OpenFreeMap (même origine que les tuiles vectorielles)
    // — requises pour le rendu texte des noms de rues. NB : fonts.openmaptiles.org
    // renvoie du text/html (cassé) ; tiles.openfreemap.org/fonts renvoie le protobuf.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
        satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Tiles © Esri'
        },
        // Ortho HD IGN 20 cm (BD ORTHO, Géoplateforme, SANS clé, schéma XYZ vérifié).
        // PIÈGE : hors couverture (étranger/mer dans la grille) l'IGN renvoie une tuile
        // JPEG BLANCHE OPAQUE (~1.6 Ko), pas un 404 → elle masquerait Esri. Comme on ne
        // peut pas filtrer une tuile raster blanche, on n'affiche l'IGN qu'à partir du
        // z11 (cf. raster-opacity) — là la vue est dominée par du sol FR, donc pas de
        // blanc ; à plus bas zoom Esri reste seul (et le 20 cm ne se voit pas avant ~z13).
        // `bounds` évite en plus de requêter l'IGN loin hors de France.
        'ign-ortho': {
            type: 'raster',
            tiles: ['https://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/{z}/{x}/{y}.jpeg'],
            tileSize: 256,
            minzoom: 11,
            maxzoom: 19,
            bounds: [-5.6, 41.1, 9.8, 51.3],
            attribution: 'BD ORTHO © IGN / Géoplateforme'
        },
        'terrain-dem': {
            type: 'raster-dem',
            tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
            attribution: 'Elevation © AWS Terrain Tiles'
        },
        // Tuiles vectorielles OpenFreeMap — sans clé API. On n'en exploite que
        // la couche "building" pour l'extrusion 3D ; le reste n'est pas rendu.
        openfreemap: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
            attribution: '© OpenFreeMap © OpenStreetMap'
        },
        // BD TOPO IGN (tuiles vectorielles, SANS clé, XYZ) — bâtiments officiels
        // français + hauteurs dérivées LiDAR HD (extrusion 3D bien plus précise que l'OSM).
        bdtopo: {
            type: 'vector',
            tiles: ['https://data.geopf.fr/tms/1.0.0/BDTOPO/{z}/{x}/{y}.pbf'],
            minzoom: 0,
            maxzoom: 16,
            attribution: 'BD TOPO © IGN / Géoplateforme'
        },
        // Ombrages LiDAR HD (WMTS Géoplateforme, sans clé) — cf. bloc ci-dessus.
        ...lidarSources()
    },
    layers: [
        { id: 'satellite', type: 'raster', source: 'satellite' },
        {
            id: 'ign-ortho', type: 'raster', source: 'ign-ortho',
            paint: {
                // Fusion seamless Esri → IGN : fondu progressif au zoom sur la bande
                // z11→z13 (l'IGN monte en transparence par-dessus Esri puis devient
                // opaque). Volontairement HAUT : à <z11 (vues régionales où mer/étranger
                // sont dans le champ) on reste sur Esri → pas de tuiles blanches IGN ;
                // l'IGN HD prend le relais une fois zoomé sur une zone française.
                'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 1],
                'raster-fade-duration': 500
            }
        },
        // Overlays LiDAR HD : AU-DESSUS de l'imagerie, mais déclarés ICI (dans le
        // style) donc SOUS toutes les couches ajoutées après `load` — dessins,
        // formes, bâtiments 3D, noms de rues (cf. draw-layers.ts, map-core.ts).
        ...lidarLayers()
    ]
};

/* =====================================================================
 * CACHE CARTOGRAPHIQUE FORCÉ & HORS-LIGNE (Proposition 3 de l'audit)
 *
 * Objectif : disposer EN PERMANENCE d'une vue satellite de la France, même sans
 * réseau (zone rurale, sous-sol). On pré-télécharge la pyramide de tuiles de la
 * métropole à bas niveaux de zoom et on la stocke via la Cache Storage API ; le
 * Service Worker (sw.js) la sert ensuite en « cache-first » en mode déconnecté.
 * ===================================================================== */
// planMap.js:123 — doit correspondre à MAP_CACHE dans sw.js
export const OFFLINE_MAP_CACHE = 'pctac-map-v2';
// planMap.js:124
export const SAT_TILE_TEMPLATE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Métropole + marge (DOM-TOM exclus du cache de base, trop dispersés).
// planMap.js:126
export const FRANCE_BBOX: GeoBBox = { west: -5.6, south: 41.1, east: 9.8, north: 51.3 };
// Clé de l'index des AOI confirmées (Persist) : remplace le flag binaire.
// planMap.js:128
export const AOI_INDEX_KEY = 'pcTacAoiIndex';
// Garde-fou : nombre max de tuiles d'une AOI (évite d'exploser le volume / le WAF).
// planMap.js:130
export const AOI_MAX_TILES = 60000;
