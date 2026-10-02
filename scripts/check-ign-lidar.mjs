#!/usr/bin/env node
/**
 * check-ign-lidar.mjs — Sonde d'accès aux flux IGN/Géoplateforme de la carte PC-Tac.
 * ===========================================================================
 *
 * À lancer depuis un poste ayant un accès Internet direct :
 *
 *     node scripts/check-ign-lidar.mjs
 *
 * Vérifie, pour chaque ressource WMTS déclarée dans `RASTER_STYLE`
 * (`src/apps/pctac/planmap/constants.ts`) :
 *   1. que le service répond SANS clé d'API ;
 *   2. jusqu'à quel niveau de zoom la pyramide `PM` sert réellement des tuiles,
 *      sur un point de contrôle situé en zone couverte.
 *
 * Le zoom max observé doit correspondre aux constantes du style
 * (`LIDAR_MAX_ZOOM`, `maxzoom` des sources `planign`/`contours`) : si la sonde
 * remonte un niveau différent, ce sont ces constantes qu'il faut ajuster —
 * MapLibre sur-zoome au-delà, mais requêterait des tuiles absentes si elles
 * étaient trop hautes.
 *
 * C'est aussi le moyen de confirmer que `ELEVATION.CONTOUR.LINE` est bien le
 * nom de la ressource « courbes de niveau » : une ressource inexistante ne sert
 * AUCUNE tuile à aucun zoom, et la sonde le dit explicitement.
 *
 * Retours terrain 2026-10-02 : une seconde section compare, territoire par
 * territoire (DROM, Saint-Pierre-et-Miquelon, Saint-Martin, Saint-Barthélemy), la
 * table de couverture de `src/shared/ign-territoires.ts` à ce que la Géoplateforme
 * sert réellement. Un écart (couche servie mais absente de la table, ou l'inverse)
 * fait échouer le script : c'est le signal de mettre la table à jour (ex. le LiDAR HD
 * qui arrive en Martinique). Demande Node ≥ 22.18 (import natif du .ts).
 * Une couche est « servie » si la PLUS GROSSE des 9 tuiles z14 autour de la ville de
 * référence dépasse 1,7 Ko : une seule tuile de courbes de niveau sur une ville plate
 * peut peser moins que ce seuil sans que la couche soit absente.
 *
 * Dernière section : la tuile VIDE de l'ortho (JPEG blanc rendu hors couverture) doit
 * toujours peser `IGN_BLANK_TILE_BYTES` octets (`src/shared/ign-ortho.ts`). Si l'IGN
 * ré-encode cette tuile, le détourage reste correct mais perd son raccourci (un
 * décodage de plus par tuile vide) : le script le signale.
 */

const WMTS_LAYERS = {
    'LiDAR HD MNT (sol nu)': 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    'LiDAR HD MNS (sursol)': 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    'LiDAR HD MNH (hauteur)': 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
    'Plan IGN v2 (fond couleur)': 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
    'Courbes de niveau': 'ELEVATION.CONTOUR.LINE',
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

for (const [name, layer] of Object.entries(WMTS_LAYERS)) {
    console.log(`\n=== ${name}\n    ${layer}`);
    let maxOk = null;
    let minOk = null;
    for (let z = ZOOM_RANGE.min; z <= ZOOM_RANGE.max; z++) {
        const r = await probe(layer, z);
        const detail = r.error ? r.error : `HTTP ${r.status} ${r.type} ${r.bytes} o`;
        console.log(`  z${String(z).padStart(2)} ${r.ok ? '✔' : '✘'}  ${detail}`);
        if (r.ok) { maxOk = z; if (minOk === null) minOk = z; }
    }
    if (maxOk === null) {
        anyFailure = true;
        console.log('  → AUCUNE tuile servie : ressource inexistante, renommée, ou service injoignable.');
    } else {
        console.log(`  → tuiles servies de z${minOk} à z${maxOk} (à comparer aux minzoom/maxzoom du style).`);
    }
}

// ── Couverture par territoire ────────────────────────────────────────────────
// Une tuile z14 sur une ville de chaque territoire. « Servie » = image HTTP 200 de
// plus de 1,7 Ko : en dessous, c'est la tuile vide/blanche que la Géoplateforme rend
// hors couverture (ortho blanche 1651 o, PNG transparent 722-852 o). La métropole
// est sondée au point de contrôle ci-dessus (Chartreuse : relief, donc des courbes).
const territoires = await import('../src/shared/ign-territoires.ts').catch(() => null);
if (!territoires) {
    console.log('\n(Node trop ancien pour importer le .ts : section « territoires » ignorée.)');
} else {
    const { IGN_METROPOLE, IGN_OUTRE_MER, ignTerritories } = territoires;
    const VILLES = {
        FR: [PROBE.lon, PROBE.lat],
        '971': [-61.5331, 16.2411], // Pointe-à-Pitre
        '972': [-61.0588, 14.6161], // Fort-de-France
        '973': [-52.326, 4.9372], // Cayenne
        '974': [55.4481, -20.8789], // Saint-Denis
        '975': [-56.1773, 46.7766], // Saint-Pierre
        '976': [45.2278, -12.7806], // Mamoudzou
        '977': [-62.8498, 17.8963], // Gustavia
        '978': [-63.0824, 18.0679], // Marigot
    };
    const FAMILLES = {
        ortho: (z, x, y) => `https://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/${z}/${x}/${y}.jpeg`,
        planign: (z, x, y) => tileUrl(WMTS_LAYERS['Plan IGN v2 (fond couleur)'], z, x, y),
        contours: (z, x, y) => tileUrl(WMTS_LAYERS['Courbes de niveau'], z, x, y),
        lidar: (z, x, y) => tileUrl(WMTS_LAYERS['LiDAR HD MNT (sol nu)'], z, x, y),
    };
    const Z = 14;
    console.log(`\n=== Couverture par territoire (tuile z${Z} sur la ville de référence) ===`);
    for (const [famille, urlOf] of Object.entries(FAMILLES)) {
        const attendus = new Set(ignTerritories(famille).map((t) => t.code));
        console.log(`\n  ${famille} — table : ${[...attendus].join(' ')}`);
        for (const t of [IGN_METROPOLE, ...IGN_OUTRE_MER]) {
            const [lon, lat] = VILLES[t.code];
            let servie = false;
            let detail = '';
            try {
                // Plus grosse tuile d'un quadrillage 3×3 autour de la ville (cf. en-tête).
                let max = 0;
                const statuts = new Set();
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const res = await fetch(urlOf(Z, lon2tile(lon, Z) + dx, lat2tile(lat, Z) + dy));
                        statuts.add(res.status);
                        const type = res.headers.get('content-type') || '';
                        if (res.ok && type.startsWith('image/')) max = Math.max(max, (await res.arrayBuffer()).byteLength);
                    }
                }
                servie = max > 1700;
                detail = `HTTP ${[...statuts].join('/')} max ${max} o (9 tuiles)`;
            } catch (e) {
                detail = String(e);
            }
            const accord = servie === attendus.has(t.code);
            if (!accord) anyFailure = true;
            console.log(`    ${t.code.padEnd(3)} ${t.label.padEnd(26)} ${servie ? 'servie ' : 'absente'}  ${detail}${accord ? '' : '   ← ÉCART avec la table : mettre ign-territoires.ts à jour'}`);
        }
    }
}

// ── Tuile vide de l'ortho ────────────────────────────────────────────────────
// Une tuile z13 en mer, entre Grande-Terre et Marie-Galante (971) : hors couverture, donc
// la tuile vide. Son poids est la constante `IGN_BLANK_TILE_BYTES` du détourage.
{
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/shared/ign-ortho.ts', import.meta.url), 'utf8');
    const attendu = Number(/IGN_BLANK_TILE_BYTES\s*=\s*(\d+)/.exec(src)?.[1]);
    const z = 13;
    const res = await fetch(`https://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/${z}/${lon2tile(-61.3, z)}/${lat2tile(16.05, z)}.jpeg`).catch(() => null);
    const bytes = res && res.ok ? (await res.arrayBuffer()).byteLength : 0;
    const accord = bytes === attendu;
    if (!accord) anyFailure = true;
    console.log(`\n=== Tuile vide de l'ortho (z${z}, en mer au large de la Guadeloupe) ===`);
    console.log(`    ${bytes} o servis, IGN_BLANK_TILE_BYTES = ${attendu} ${accord ? '✔' : '   ← ÉCART : mettre ign-ortho.ts à jour (le détourage reste correct, mais sans son raccourci)'}`);
}

process.exit(anyFailure ? 1 : 0);
