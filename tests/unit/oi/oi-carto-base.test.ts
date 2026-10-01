/**
 * oi-carto-base.test.ts — Comportement OBSERVÉ de `modules/oi_cartographie.js`
 * (GStart-main, 1681 LOC, lecture seule) pour le paquet `oi-carto-base` :
 * `carto/types.ts` (types uniquement, pas de test direct possible) +
 * `carto/constants.ts`. Écrit AVANT le port (TDD, mission P3.CONV).
 * Références `oi_cartographie.js:<ligne>` en commentaire, cf.
 * SPEC-OI-CONVERSION.md §6.2, §6.3.
 */
import { describe, expect, it } from 'vitest';

import {
	CONTOURS_MIN_ZOOM,
	CONTOURS_WMTS_LAYER,
	FRANCE_TILE_BOUNDS,
	LIDAR_HD_LAYERS,
	LIDAR_LAYER_IDS,
	LIDAR_MAX_ZOOM,
	LIDAR_MIN_ZOOM,
	LIDAR_OPACITY_OVER_IMAGERY,
	OI_CARTO_RASTER_STYLE,
	OI_FONCTION_ICONS,
	OI_ICON_CATALOG,
	OI_PIN_DEFS,
	OI_PIN_FALLBACK,
	PLANIGN_WMTS_LAYER,
	geopfWmtsTileUrl,
	oiIconForMember,
	oiNormalize,
} from '@oi/carto/constants.js';
import { ignLayerId, ignLayerIds, ignTerritories } from '@shared/ign-territoires.js';

describe('constants.ts — OI_CARTO_RASTER_STYLE (oi_cartographie.js:23-48 + overlays IGN hors littéral)', () => {
	// Les ids de la MÉTROPOLE sont le contrat historique ; l'outre-mer (retours
	// terrain 2026-10-02) s'y ajoute en `<id>-<code>` (cf. @shared/ign-territoires).
	const LIDAR_IDS = ['lidar-mnt', 'lidar-mns', 'lidar-mnh'];

	it('version 8, sources planMap.js + fonds/overlays IGN (un jeu par territoire servi), glyphs OpenFreeMap', () => {
		expect(OI_CARTO_RASTER_STYLE.version).toBe(8);
		expect(OI_CARTO_RASTER_STYLE.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
		expect(Object.keys(OI_CARTO_RASTER_STYLE.sources)).toEqual([
			'satellite',
			...ignLayerIds('ortho', 'ign-ortho'),
			'terrain-dem',
			'openfreemap',
			...ignLayerIds('planign', 'planign'),
			...ignLayerIds('contours', 'contours'),
			...LIDAR_IDS.flatMap((id) => ignLayerIds('lidar', id)),
		]);
		// Couches : satellite, ortho, fond topo, 3 ombrages, courbes — familles contiguës.
		expect(OI_CARTO_RASTER_STYLE.layers.map((l) => l.id)).toEqual([
			'satellite',
			...ignLayerIds('ortho', 'ign-ortho'),
			...ignLayerIds('planign', 'planign'),
			...LIDAR_IDS.flatMap((id) => ignLayerIds('lidar', id)),
			...ignLayerIds('contours', 'contours'),
		]);
		expect(OI_CARTO_RASTER_STYLE.layers[0]).toEqual({ id: 'satellite', type: 'raster', source: 'satellite' });
		expect(OI_CARTO_RASTER_STYLE.layers[1]).toEqual({
			id: 'ign-ortho',
			type: 'raster',
			source: 'ign-ortho',
			paint: {
				'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 1],
				'raster-fade-duration': 500,
			},
		});
	});

	it('même carte des couvertures que PC-Tac : servi là où la sonde l\'a vu, rien ailleurs', () => {
		const ids = Object.keys(OI_CARTO_RASTER_STYLE.sources);
		for (const id of ['ign-ortho-971', 'ign-ortho-973', 'planign-975', 'contours-974', 'contours-978', 'lidar-mnt-971', 'lidar-mnh-974']) {
			expect(ids, id).toContain(id);
		}
		for (const id of ['contours-973', 'contours-975', 'lidar-mnt-972', 'lidar-mns-976', 'lidar-mnt-978']) {
			expect(ids, id).not.toContain(id);
		}
	});

	it('chaque couche vise sa source, et chaque source IGN a exactement sa couche', () => {
		const sources = OI_CARTO_RASTER_STYLE.sources as Record<string, { bounds?: number[] }>;
		for (const l of OI_CARTO_RASTER_STYLE.layers) expect(sources['source' in l ? l.source : ''], l.id).toBeDefined();
		const layerSources = OI_CARTO_RASTER_STYLE.layers.map((l) => ('source' in l ? l.source : ''));
		for (const id of Object.keys(sources)) {
			if (!sources[id]?.bounds) continue;
			expect(layerSources.filter((x) => x === id), id).toHaveLength(1);
		}
	});

	// PIÈGE des tuiles blanches : traité PAR TERRITOIRE comme en métropole (minzoom
	// 11 + fondu 11→13 — une ortho plein pot à bas zoom masquerait Esri en blanc).
	it('ortho outre-mer : bounds du territoire, minzoom 11, maxzoom 19, fondu 11→13 comme la métropole', () => {
		const metro = OI_CARTO_RASTER_STYLE.sources['ign-ortho'] as { tiles: string[]; tileSize: number; attribution: string };
		const metroLayer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === 'ign-ortho') as { paint?: unknown };
		for (const t of ignTerritories('ortho')) {
			const id = ignLayerId('ign-ortho', t);
			const src = OI_CARTO_RASTER_STYLE.sources[id] as { tiles: string[]; tileSize: number; minzoom: number; maxzoom: number; bounds: number[]; attribution: string };
			expect(src.bounds, id).toEqual(t.bounds);
			expect(src.minzoom, id).toBe(11);
			expect(src.maxzoom, id).toBe(19);
			expect(src.tiles, id).toEqual(metro.tiles);
			expect(src.tileSize, id).toBe(metro.tileSize);
			expect(src.attribution, id).toBe(metro.attribution);
			const layer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === id) as { source: string; paint?: unknown };
			expect(layer.source, id).toBe(id);
			expect(layer.paint, id).toEqual(metroLayer.paint);
		}
	});

	it('source satellite : tuiles ArcGIS World_Imagery, tileSize 256, maxzoom 19', () => {
		const sat = OI_CARTO_RASTER_STYLE.sources.satellite as {
			type: string;
			tiles: string[];
			tileSize: number;
			maxzoom: number;
			attribution: string;
		};
		expect(sat.type).toBe('raster');
		expect(sat.tiles).toEqual([
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		]);
		expect(sat.tileSize).toBe(256);
		expect(sat.maxzoom).toBe(19);
		expect(sat.attribution).toBe('Tiles © Esri');
	});

	it('source terrain-dem : encoding terrarium, tuiles AWS elevation, maxzoom 15', () => {
		const dem = OI_CARTO_RASTER_STYLE.sources['terrain-dem'] as {
			type: string;
			tiles: string[];
			encoding: string;
			tileSize: number;
			maxzoom: number;
			attribution: string;
		};
		expect(dem.type).toBe('raster-dem');
		expect(dem.tiles).toEqual(['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png']);
		expect(dem.encoding).toBe('terrarium');
		expect(dem.tileSize).toBe(256);
		expect(dem.maxzoom).toBe(15);
		expect(dem.attribution).toBe('Elevation © AWS Terrain Tiles');
	});

	it('source openfreemap : vector, url tiles.openfreemap.org/planet', () => {
		const ofm = OI_CARTO_RASTER_STYLE.sources.openfreemap as { type: string; url: string; attribution: string };
		expect(ofm.type).toBe('vector');
		expect(ofm.url).toBe('https://tiles.openfreemap.org/planet');
		expect(ofm.attribution).toBe('© OpenFreeMap © OpenStreetMap');
	});

	it('les 3 sources LiDAR HD : bounds FRANCE_TILE_BOUNDS, minzoom/maxzoom, opacité initiale', () => {
		for (const id of LIDAR_LAYER_IDS) {
			const def = LIDAR_HD_LAYERS[id];
			const src = OI_CARTO_RASTER_STYLE.sources[def.sourceId] as {
				type: string; tiles: string[]; bounds?: number[]; minzoom?: number; maxzoom?: number;
			};
			expect(src.type).toBe('raster');
			expect(src.tiles).toEqual([geopfWmtsTileUrl(def.wmtsLayer)]);
			expect(src.bounds).toEqual(FRANCE_TILE_BOUNDS);
			expect(src.minzoom).toBe(LIDAR_MIN_ZOOM);
			expect(src.maxzoom).toBe(LIDAR_MAX_ZOOM);

			const layer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === def.sourceId) as {
				layout?: { visibility?: string }; paint?: { 'raster-opacity'?: number };
			};
			expect(layer.layout?.visibility).toBe('none');
			expect(layer.paint?.['raster-opacity']).toBe(LIDAR_OPACITY_OVER_IMAGERY);
		}
	});

	// Sonde 2026-10-02 : l'IGN sert le LiDAR HD en Guadeloupe et à La Réunion (et
	// nulle part ailleurs outre-mer). Même service, mêmes zooms, même opacité.
	it('LiDAR HD outre-mer : Guadeloupe et La Réunion seulement, mêmes zooms et même opacité', () => {
		for (const id of LIDAR_LAYER_IDS) {
			const def = LIDAR_HD_LAYERS[id];
			expect(ignLayerIds('lidar', def.sourceId)).toEqual([def.sourceId, def.sourceId + '-971', def.sourceId + '-974']);
			for (const t of ignTerritories('lidar')) {
				const sid = ignLayerId(def.sourceId, t);
				const src = OI_CARTO_RASTER_STYLE.sources[sid] as { tiles: string[]; bounds?: number[]; minzoom?: number; maxzoom?: number };
				expect(src.tiles, sid).toEqual([geopfWmtsTileUrl(def.wmtsLayer)]);
				expect(src.bounds, sid).toEqual(t.bounds);
				expect(src.minzoom, sid).toBe(LIDAR_MIN_ZOOM);
				expect(src.maxzoom, sid).toBe(LIDAR_MAX_ZOOM);
				const layer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === sid) as {
					source: string; layout?: { visibility?: string }; paint?: { 'raster-opacity'?: number };
				};
				expect(layer.source, sid).toBe(sid);
				expect(layer.layout?.visibility, sid).toBe('none');
				expect(layer.paint?.['raster-opacity'], sid).toBe(LIDAR_OPACITY_OVER_IMAGERY);
			}
		}
	});

	it('source planign : Plan IGN v2, masquée par défaut', () => {
		const src = OI_CARTO_RASTER_STYLE.sources.planign as { type: string; tiles: string[]; bounds?: number[] };
		expect(src.type).toBe('raster');
		expect(src.tiles).toEqual([geopfWmtsTileUrl(PLANIGN_WMTS_LAYER)]);
		expect(src.bounds).toEqual(FRANCE_TILE_BOUNDS);
		const layer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === 'planign') as { layout?: { visibility?: string } };
		expect(layer.layout?.visibility).toBe('none');
	});

	it('Plan IGN outre-mer : une source et une couche masquée par territoire (les 8)', () => {
		expect(ignTerritories('planign')).toHaveLength(9);
		for (const t of ignTerritories('planign')) {
			const id = ignLayerId('planign', t);
			const src = OI_CARTO_RASTER_STYLE.sources[id] as { tiles: string[]; bounds?: number[]; maxzoom?: number };
			expect(src.tiles, id).toEqual([geopfWmtsTileUrl(PLANIGN_WMTS_LAYER)]);
			expect(src.bounds, id).toEqual(t.bounds);
			expect(src.maxzoom, id).toBe(19);
			const layer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === id) as { source: string; layout?: { visibility?: string } };
			expect(layer.source, id).toBe(id);
			expect(layer.layout?.visibility, id).toBe('none');
		}
	});

	it('source contours : RGE ALTI vectorisé, minzoom CONTOURS_MIN_ZOOM, masquée par défaut', () => {
		const src = OI_CARTO_RASTER_STYLE.sources.contours as { type: string; tiles: string[]; minzoom?: number };
		expect(src.type).toBe('raster');
		expect(src.tiles).toEqual([geopfWmtsTileUrl(CONTOURS_WMTS_LAYER)]);
		expect(src.minzoom).toBe(CONTOURS_MIN_ZOOM);
		const layer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === 'contours') as { layout?: { visibility?: string } };
		expect(layer.layout?.visibility).toBe('none');
	});

	it('courbes outre-mer : servies sauf en Guyane et à Saint-Pierre-et-Miquelon, mêmes zooms et même opacité', () => {
		expect(ignTerritories('contours').map((t) => t.code).sort()).toEqual(['971', '972', '974', '976', '977', '978', 'FR']);
		for (const t of ignTerritories('contours')) {
			const id = ignLayerId('contours', t);
			const src = OI_CARTO_RASTER_STYLE.sources[id] as { tiles: string[]; bounds?: number[]; minzoom?: number; maxzoom?: number };
			expect(src.tiles, id).toEqual([geopfWmtsTileUrl(CONTOURS_WMTS_LAYER)]);
			expect(src.bounds, id).toEqual(t.bounds);
			expect(src.minzoom, id).toBe(CONTOURS_MIN_ZOOM);
			expect(src.maxzoom, id).toBe(18);
			const layer = OI_CARTO_RASTER_STYLE.layers.find((l) => l.id === id) as {
				source: string; layout?: { visibility?: string }; paint?: { 'raster-opacity'?: number };
			};
			expect(layer.source, id).toBe(id);
			expect(layer.layout?.visibility, id).toBe('none');
			expect(layer.paint?.['raster-opacity'], id).toBe(0.9);
		}
	});
});

describe('constants.ts — OI_PIN_DEFS (oi_cartographie.js:56-62)', () => {
	it('exactement 6 entrées (+ `generic`, roue de création → Catalogue → Génériques)', () => {
		expect(Object.keys(OI_PIN_DEFS)).toHaveLength(6);
		expect(Object.keys(OI_PIN_DEFS).sort()).toEqual(
			['member', 'cyno', 'rame_vl', 'vl_target', 'rassemblement', 'generic'].sort(),
		);
	});

	it('valeurs exactes (icône, couleur, libellé)', () => {
		expect(OI_PIN_DEFS.member).toEqual({ icon: 'local_police', color: '#3b82f6', label: 'Membre' });
		expect(OI_PIN_DEFS.cyno).toEqual({ icon: 'pets', color: '#3b82f6', label: 'Cyno' });
		expect(OI_PIN_DEFS.rame_vl).toEqual({ icon: 'directions_car', color: '#3b82f6', label: 'Rame VL' });
		expect(OI_PIN_DEFS.vl_target).toEqual({ icon: 'directions_car', color: '#ef4444', label: 'VL Target' });
		expect(OI_PIN_DEFS.rassemblement).toEqual({ icon: 'groups', color: '#22c55e', label: 'Rassemblement' });
	});
});

describe('constants.ts — OI_PIN_FALLBACK (oi_cartographie.js:63)', () => {
	it('icon place, couleur #a1a1aa, libellé Point', () => {
		expect(OI_PIN_FALLBACK).toEqual({ icon: 'place', color: '#a1a1aa', label: 'Point' });
	});
});

describe('constants.ts — OI_FONCTION_ICONS (oi_cartographie.js:65-80)', () => {
	it('présence des 11 clés attendues avec leurs icônes', () => {
		expect(OI_FONCTION_ICONS).toEqual({
			'chef de dispo': 'stars',
			'chef dispo': 'stars',
			'chef inter': 'support_agent',
			effrac: 'hardware',
			inter: 'chess',
			india: 'chess',
			'chef oscar': 'visibility',
			ao: 'visibility',
			conducteur: 'search_hands_free',
			de: 'saved_search',
			cyno: 'pets',
		});
	});
});

describe('constants.ts — OI_ICON_CATALOG (oi_cartographie.js:94-110)', () => {
	it('27 entrées (doublon eye_tracking/visibility fusionné, décision Nico 2026-08-17), {id,label}, présence des extrêmes (1re et dernière)', () => {
		// 27 d'origine, +2 : local_parking (Parking), person_pin_circle (Dernière position connue).
		// `groups` (Rassemblement) y figurait déjà — pas de doublon ajouté.
		expect(OI_ICON_CATALOG).toHaveLength(29);
		expect(OI_ICON_CATALOG[0]).toEqual({ id: 'stars', label: 'Chef dispo' });
		expect(OI_ICON_CATALOG[OI_ICON_CATALOG.length - 1]).toEqual({ id: 'videocam', label: 'Caméra' });
	});

	it('tous les id sont uniques', () => {
		const ids = OI_ICON_CATALOG.map((ic) => ic.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('contient bien les icônes véhicule/rassemblement/adversaire citées ailleurs', () => {
		const ids = OI_ICON_CATALOG.map((ic) => ic.id);
		expect(ids).toContain('directions_car');
		expect(ids).toContain('groups');
		expect(ids).toContain('person_alert');
	});
});

describe('constants.ts — oiNormalize (oi_cartographie.js:82-84)', () => {
	it('minuscule + trim', () => {
		expect(oiNormalize('  Chef Dispo  ')).toBe('chef dispo');
	});

	it('retire les diacritiques (NFD + suppression des marques combinantes)', () => {
		expect(oiNormalize('Négociateur')).toBe('negociateur');
		expect(oiNormalize('Éléphant')).toBe('elephant');
	});

	it('null/undefined/chaîne vide → chaîne vide', () => {
		expect(oiNormalize(null)).toBe('');
		expect(oiNormalize(undefined)).toBe('');
		expect(oiNormalize('')).toBe('');
	});
});

describe('constants.ts — oiIconForMember (oi_cartographie.js:86-92)', () => {
	it('mapping direct par fonction normalisée (ex. "Chef Dispo" → stars)', () => {
		expect(oiIconForMember('Chef Dispo', '')).toBe('stars');
	});

	it('mapping insensible à la casse/accents (ex. "Négociateur" absent → repli membre)', () => {
		// "Négociateur" n'a pas d'entrée dans OI_FONCTION_ICONS et sa cellule ne
		// commence pas par "india" → repli sur l'icône par défaut du membre.
		expect(oiIconForMember('Négociateur', '')).toBe(OI_PIN_DEFS.member.icon);
	});

	it('cellule "India *" bascule sur l\'icône pion d\'échecs si la fonction n\'a pas de mapping', () => {
		expect(oiIconForMember('Sans', 'India 1')).toBe('chess');
		expect(oiIconForMember('Sans', 'india 1')).toBe('chess');
	});

	it('la fonction prévaut sur la cellule India quand les deux matchent', () => {
		expect(oiIconForMember('Chef Dispo', 'India 1')).toBe('stars');
	});

	it('aucun mapping (fonction et cellule) → icône par défaut du membre (local_police)', () => {
		expect(oiIconForMember('Sans', '')).toBe('local_police');
		expect(oiIconForMember(null, undefined)).toBe('local_police');
	});

	it('fonction "Cyno" → icône pets (utilisée par la liste Cyno de la modale)', () => {
		expect(oiIconForMember('Cyno', '')).toBe('pets');
	});
});
