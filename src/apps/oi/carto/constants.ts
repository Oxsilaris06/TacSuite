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

/**
 * Style satellite ESRI World Imagery + DEM AWS (relief 3D) + tuiles
 * vectorielles OpenFreeMap (uniquement la couche "building" pour l'extrusion).
 * Tout sans clé API, sans tracking. oi_cartographie.js:23-48 — VERBATIM.
 */
export const OI_CARTO_RASTER_STYLE: StyleSpecification = {
    version: 8,
    sources: {
        satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Tiles © Esri',
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
    },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
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
    'member' | 'cyno' | 'rame_vl' | 'vl_target' | 'rassemblement',
    { icon: string; color: string; label: string }
> = {
    member: { icon: 'local_police', color: '#3b82f6', label: 'Membre' },
    cyno: { icon: 'pets', color: '#3b82f6', label: 'Cyno' },
    rame_vl: { icon: 'directions_car', color: '#3b82f6', label: 'Rame VL' },
    vl_target: { icon: 'directions_car', color: '#ef4444', label: 'VL Target' },
    rassemblement: { icon: 'groups', color: '#22c55e', label: 'Rassemblement' },
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
