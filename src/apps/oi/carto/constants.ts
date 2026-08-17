/**
 * constants.ts — Constantes de MODULE de `oi_cartographie.js`
 * (P3.CONV, paquet `oi-carto-base`).
 * ===========================================================================
 *
 * `OI_CARTO_RASTER_STYLE`, `OI_PIN_DEFS`, `OI_PIN_FALLBACK`,
 * `OI_FONCTION_ICONS`, `OI_ICON_CATALOG` (oi_cartographie.js:23-110) et les
 * 2 fonctions pures `oiNormalize`/`oiIconForMember` (:82-92), portées VERBATIM
 * (aucune URL, aucun paramètre, aucun libellé modifié). FEUILLE : n'importe
 * aucun autre fichier de `carto/` ni de `@oi/` (SPEC-OI-CONVERSION.md §6.2).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 */

import type { StyleSpecification } from 'maplibre-gl';

/* =====================================================================
 * OVERLAYS IGN — LiDAR HD (ombrages) + fond Plan IGN couleur + courbes de
 * niveau — HORS oi_cartographie.js, alignement `@pctac/planmap/constants.ts`
 * (mêmes services Géoplateforme, mêmes URLs/paramètres, verbatim).
 *
 * FEUILLE (cf. en-tête de fichier) : aucun type importé de `./types.js` —
 * les unions de string ci-dessous sont réécrites localement (structurellement
 * identiques à `OiCartoLidarLayerId`, `types.ts`), pas de dépendance croisée.
 *
 * Empilement contractuel (ordre dans `OI_CARTO_RASTER_STYLE.layers`) :
 *   satellite -> ign-ortho -> planign -> ombrages LiDAR -> contours
 * la couleur en bas, le relief au milieu, les lignes toujours lisibles au-dessus.
 * ===================================================================== */

/** Emprise commune des flux IGN métropolitains. */
export const FRANCE_TILE_BOUNDS: [number, number, number, number] = [-5.6, 41.1, 9.8, 51.3];

/** Zoom max de la pyramide WMTS des ombrages LiDAR HD (grille PM). */
export const LIDAR_MAX_ZOOM = 18;
/** En deçà, l'ombrage n'apporte rien et coûte des tuiles inutiles. */
export const LIDAR_MIN_ZOOM = 8;
/** En deçà, les courbes se chevauchent en un aplat illisible. */
export const CONTOURS_MIN_ZOOM = 11;

/** Opacité de l'ombrage LiDAR SUR L'IMAGERIE : il domine, on lit le micro-relief. */
export const LIDAR_OPACITY_OVER_IMAGERY = 0.85;
/** Opacité de l'ombrage LiDAR SUR LE FOND TOPO : baissée pour laisser lire les
 *  couleurs et les figurés du Plan IGN sous l'ombrage. */
export const LIDAR_OPACITY_OVER_TOPO = 0.45;

/** Identifiants des trois overlays LiDAR HD, dans l'ordre de cyclage du bouton. */
export const LIDAR_LAYER_IDS = ['mnt', 'mns', 'mnh'] as const;

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

export const LIDAR_HD_LAYERS: Record<(typeof LIDAR_LAYER_IDS)[number], LidarLayerDef> = {
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

/** Plan IGN v2 — cartographie topographique couleur, WMTS keyless. */
export const PLANIGN_WMTS_LAYER = 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2';
/** Courbes de niveau (RGE ALTI vectorisé), PNG transparent. */
export const CONTOURS_WMTS_LAYER = 'ELEVATION.CONTOUR.LINE';

/** URL de tuile WMTS Géoplateforme (grille PM = XYZ) pour une ressource donnée.
 *  PNG imposé : seul format à canal alpha, donc seul qui permette la SUPERPOSITION. */
export function geopfWmtsTileUrl(wmtsLayer: string): string {
    return 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
        + '&LAYER=' + wmtsLayer
        + '&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM'
        + '&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}';
}

/** Les 3 sources raster LiDAR HD, prêtes à être fusionnées dans `OI_CARTO_RASTER_STYLE`. */
function lidarSources(): StyleSpecification['sources'] {
    const out: StyleSpecification['sources'] = {};
    for (const id of LIDAR_LAYER_IDS) {
        const def = LIDAR_HD_LAYERS[id];
        out[def.sourceId] = {
            type: 'raster',
            tiles: [geopfWmtsTileUrl(def.wmtsLayer)],
            tileSize: 256,
            minzoom: LIDAR_MIN_ZOOM,
            maxzoom: LIDAR_MAX_ZOOM,
            bounds: FRANCE_TILE_BOUNDS,
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
            'raster-opacity': LIDAR_OPACITY_OVER_IMAGERY,
            'raster-fade-duration': 300,
        },
    }));
}

/**
 * Style satellite ESRI World Imagery + DEM AWS (relief 3D) + tuiles
 * vectorielles OpenFreeMap (uniquement la couche "building" pour l'extrusion).
 * Tout sans clé API, sans tracking. oi_cartographie.js:23-48 — VERBATIM.
 */
export const OI_CARTO_RASTER_STYLE: StyleSpecification = {
    version: 8,
    // Polices keyless servies par OpenFreeMap (même origine que les tuiles vectorielles)
    // — requises pour le rendu texte des noms de rues. NB : fonts.openmaptiles.org
    // renvoie du text/html (cassé) ; tiles.openfreemap.org/fonts renvoie le protobuf.
    // Aligné sur PC-Tac (@pctac/planmap/constants.ts, RASTER_STYLE).
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
        satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Tiles © Esri',
        },
        // Ortho HD IGN 20 cm (BD ORTHO, Géoplateforme, SANS clé, schéma XYZ vérifié).
        // PIÈGE : hors couverture (étranger/mer dans la grille) l'IGN renvoie une tuile
        // JPEG BLANCHE OPAQUE (~1.6 Ko), pas un 404 → elle masquerait Esri. Comme on ne
        // peut pas filtrer une tuile raster blanche, on n'affiche l'IGN qu'à partir du
        // z11 (cf. raster-opacity) — là la vue est dominée par du sol FR, donc pas de
        // blanc ; à plus bas zoom Esri reste seul (et le 20 cm ne se voit pas avant ~z13).
        // `bounds` évite en plus de requêter l'IGN loin hors de France.
        // Aligné sur PC-Tac (@pctac/planmap/constants.ts, RASTER_STYLE).
        'ign-ortho': {
            type: 'raster',
            tiles: ['https://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/{z}/{x}/{y}.jpeg'],
            tileSize: 256,
            minzoom: 11,
            maxzoom: 19,
            bounds: [-5.6, 41.1, 9.8, 51.3],
            attribution: 'BD ORTHO © IGN / Géoplateforme',
        },
        'terrain-dem': {
            type: 'raster-dem',
            tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
            attribution: 'Elevation © AWS Terrain Tiles',
        },
        openfreemap: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
            attribution: '© OpenFreeMap © OpenStreetMap',
        },
        // Fond topographique COULEUR de l'IGN — recouvre l'imagerie quand actif.
        planign: {
            type: 'raster',
            tiles: [geopfWmtsTileUrl(PLANIGN_WMTS_LAYER)],
            tileSize: 256,
            maxzoom: 19,
            bounds: FRANCE_TILE_BOUNDS,
            attribution: 'Plan IGN v2 © IGN / Géoplateforme',
        },
        // Courbes de niveau — PNG transparent, superposable à n'importe quel fond.
        contours: {
            type: 'raster',
            tiles: [geopfWmtsTileUrl(CONTOURS_WMTS_LAYER)],
            tileSize: 256,
            minzoom: CONTOURS_MIN_ZOOM,
            maxzoom: 18,
            bounds: FRANCE_TILE_BOUNDS,
            attribution: 'Courbes de niveau © IGN / Géoplateforme',
        },
        // Ombrages LiDAR HD (WMTS Géoplateforme, sans clé) — cf. bloc ci-dessus.
        ...lidarSources(),
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
                'raster-fade-duration': 500,
            },
        },
        // Fond topo COULEUR : au-dessus de l'imagerie (il la remplace), sous les
        // ombrages LiDAR (qui viennent l'ombrer) — masqué par défaut.
        {
            id: 'planign', type: 'raster', source: 'planign',
            layout: { visibility: 'none' },
            paint: { 'raster-fade-duration': 300 },
        },
        // Overlays LiDAR HD : AU-DESSUS de l'imagerie, mais déclarés ICI (dans le
        // style) donc SOUS toutes les couches ajoutées après `load` — dessins,
        // formes, bâtiments 3D, noms de rues (cf. draw.ts, map-core.ts).
        ...lidarLayers(),
        // Courbes de niveau : au-dessus des ombrages, pour rester lisibles quel
        // que soit le fond — masquées par défaut.
        {
            id: 'contours', type: 'raster', source: 'contours',
            layout: { visibility: 'none' },
            paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 300 },
        },
    ],
};

/**
 * Définitions des pins : icône Material + couleur + libellé générique.
 *  - member        : membre PATRACDVR (libellé = trigramme · fonction)
 *  - cyno          : équipe cynophile (membre de fonction "Cyno" ou pin générique)
 *  - rame_vl       : véhicule de la force (générique ou véhicule du PATRACDVR)
 *  - vl_target     : véhicule adverse (générique ou véhicule saisi côté Adversaire)
 *  - rassemblement : point de rassemblement
 * oi_cartographie.js:50-62 — VERBATIM.
 */
export const OI_PIN_DEFS: Record<
    'member' | 'cyno' | 'rame_vl' | 'vl_target' | 'rassemblement' | 'generic',
    { icon: string; color: string; label: string }
> = {
    member: { icon: 'local_police', color: '#3b82f6', label: 'Membre' },
    cyno: { icon: 'pets', color: '#3b82f6', label: 'Cyno' },
    rame_vl: { icon: 'directions_car', color: '#3b82f6', label: 'Rame VL' },
    vl_target: { icon: 'directions_car', color: '#ef4444', label: 'VL Target' },
    rassemblement: { icon: 'groups', color: '#22c55e', label: 'Rassemblement' },
    // Roue de création → Catalogue → Génériques (chantier roue OI, parité
    // PC-Tac `PIN_ICONS`) : `pin.icon` porte toujours l'icône choisie, cette
    // entrée n'est qu'un repli visuel (icône/couleur par défaut si absent).
    generic: { icon: 'place', color: '#94a3b8', label: 'Point' },
};

/** oi_cartographie.js:63 — VERBATIM. */
export const OI_PIN_FALLBACK: { icon: string; color: string; label: string } = {
    icon: 'place',
    color: '#a1a1aa',
    label: 'Point',
};

/**
 * Mapping fonction OI → icône Material (placement automatique des membres).
 * La cellule "India *" bascule aussi sur l'icône pion d'échecs si la fonction
 * n'a pas de mapping plus spécifique. oi_cartographie.js:65-80 — VERBATIM.
 */
export const OI_FONCTION_ICONS: Record<string, string> = {
    'chef de dispo': 'stars',
    'chef dispo': 'stars',
    'chef inter': 'support_agent',
    effrac: 'hardware',
    inter: 'chess',
    india: 'chess',
    'chef oscar': 'eye_tracking',
    ao: 'visibility',
    conducteur: 'search_hands_free',
    de: 'saved_search',
    cyno: 'pets',
};

// oi_cartographie.js:82-84 — VERBATIM, y compris les caractères combinants
// littéraux U+0300 (̀) à U+036F (ͯ) de la plage de la regex (marques
// diacritiques combinantes) : recopiés tels quels depuis la source, vérifiés
// codepoint par codepoint (0x300..0x36f) — invisibles à l'affichage mais
// présents dans le fichier.
export function oiNormalize(s: string | null | undefined): string {
    return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Icône Material auto pour un membre, d'après sa fonction puis sa cellule. oi_cartographie.js:86-92 — VERBATIM
 *  (adapté : accès `OI_FONCTION_ICONS[f]` capturé dans une const locale pour
 *  satisfaire `noUncheckedIndexedAccess` — comportement strictement identique). */
export function oiIconForMember(fonction: string | null | undefined, cellule: string | null | undefined): string {
    const f = oiNormalize(fonction);
    const icon = OI_FONCTION_ICONS[f];
    if (icon) return icon;
    if (oiNormalize(cellule).startsWith('india')) return 'chess';
    return OI_PIN_DEFS.member.icon; // défaut : gendarme
}

/** Catalogue d'icônes pour la sélection libre (roue → Icône). oi_cartographie.js:94-110 — VERBATIM. */
export const OI_ICON_CATALOG: { id: string; label: string }[] = [
    { id: 'stars', label: 'Chef dispo' },
    { id: 'support_agent', label: 'Chef inter' },
    { id: 'hardware', label: 'Effrac' },
    { id: 'chess', label: 'Inter / India' },
    { id: 'eye_tracking', label: 'Chef Oscar' },
    { id: 'visibility', label: 'AO' },
    { id: 'search_hands_free', label: 'Conducteur' },
    { id: 'saved_search', label: 'DE' },
    { id: 'pets', label: 'Cyno' },
    { id: 'local_police', label: 'Membre' },
    { id: 'military_tech', label: 'Gendarmerie' },
    { id: 'shield_person', label: 'Inter armé' },
    { id: 'record_voice_over', label: 'Négociateur' },
    { id: 'medical_services', label: 'Médecin' },
    { id: 'local_fire_department', label: 'Pompier' },
    { id: 'directions_car', label: 'Véhicule' },
    { id: 'local_shipping', label: 'Camion' },
    { id: 'two_wheeler', label: 'Moto' },
    { id: 'groups', label: 'Rassemblement' },
    { id: 'person_alert', label: 'Adversaire' },
    { id: 'person_off', label: 'Otage' },
    { id: 'target', label: 'Objectif' },
    { id: 'home', label: 'Domicile' },
    { id: 'door_front', label: 'Accès' },
    { id: 'flag', label: 'Repère' },
    { id: 'dvr', label: 'PC op' },
    { id: 'crisis_alert', label: 'Menace' },
    { id: 'videocam', label: 'Caméra' },
];
