#!/usr/bin/env node
/**
 * check-ign-lidar.mjs — Sonde d'accès aux ombrages LiDAR HD (IGN/Géoplateforme).
 * ===========================================================================
 *
 * À lancer depuis un poste ayant un accès Internet direct :
 *
 *     node scripts/check-ign-lidar.mjs
 *
 * Vérifie, pour chacune des 3 ressources WMTS utilisées par la carte PC-Tac
 * (`src/apps/pctac/planmap/constants.ts` → `LIDAR_HD_LAYERS`) :
 *   1. que le service répond SANS clé d'API ;
 *   2. jusqu'à quel niveau de zoom la pyramide `PM` sert réellement des tuiles,
 *      sur un point de contrôle situé en zone couverte.
 *
 * Le zoom max observé doit correspondre à `LIDAR_MAX_ZOOM` (constants.ts) :
 * si la sonde remonte un niveau différent, c'est cette constante qu'il faut
 * ajuster — MapLibre sur-zoome au-delà, mais requêterait des tuiles absentes
 * si la constante était trop haute.
 */

const WMTS_LAYERS = {
    mnt: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    mns: 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    mnh: 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
};

// Point de contrôle en zone couverte (massif de la Chartreuse, relief marqué).
const PROBE = { lon: 5.8, lat: 45.35 };
const ZOOM_RANGE = { min: 8, max: 20 };

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const tileUrl = (layer, z, x, y) =>
    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
    + `&LAYER=${layer}&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM`
    + `&TILEMATRIX=${z}&TILECOL=${x}&TILEROW=${y}`;

async function probe(layer, z) {
    const x = lon2tile(PROBE.lon, z);
    const y = lat2tile(PROBE.lat, z);
    try {
        const res = await fetch(tileUrl(layer, z, x, y));
        const type = res.headers.get('content-type') || '';
        const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
        // La Géoplateforme répond en XML (ExceptionReport) quand le niveau
        // demandé n'existe pas : un 200 ne suffit pas, on exige une image.
        return { ok: res.ok && type.startsWith('image/'), status: res.status, type, bytes };
    } catch (e) {
        return { ok: false, status: 0, type: '', bytes: 0, error: String(e) };
    }
}

let anyFailure = false;

for (const [id, layer] of Object.entries(WMTS_LAYERS)) {
    console.log(`\n=== ${id.toUpperCase()} — ${layer}`);
    let maxOk = null;
    for (let z = ZOOM_RANGE.min; z <= ZOOM_RANGE.max; z++) {
        const r = await probe(layer, z);
        const detail = r.error ? r.error : `HTTP ${r.status} ${r.type} ${r.bytes} o`;
        console.log(`  z${String(z).padStart(2)} ${r.ok ? '✔' : '✘'}  ${detail}`);
        if (r.ok) maxOk = z;
    }
    if (maxOk === null) {
        anyFailure = true;
        console.log('  → AUCUNE tuile servie : service inaccessible depuis ce poste.');
    } else {
        console.log(`  → zoom max servi : z${maxOk} (à comparer à LIDAR_MAX_ZOOM).`);
    }
}

process.exit(anyFailure ? 1 : 0);
