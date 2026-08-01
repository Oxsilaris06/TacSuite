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
import type { GeoBBox, PlanEntityKind } from './types.js';

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

// Code couleur — strictement aligné sur la légende affichée
// (--danger-red, --civil-yellow, --inter-blue, --ao-green dans pctac2.html)
// planMap.js:35-39
export const ENTITY_COLORS: Record<PlanEntityKind, string> = {
    adv: '#ef4444',    // Adv  / rouge
    host: '#eab308',   // Otage / jaune
    friend: '#3b82f6'  // Inter / bleu
};

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
        }
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
        }
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
