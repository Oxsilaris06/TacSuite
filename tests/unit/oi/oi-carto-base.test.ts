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
	OI_CARTO_RASTER_STYLE,
	OI_FONCTION_ICONS,
	OI_ICON_CATALOG,
	OI_PIN_DEFS,
	OI_PIN_FALLBACK,
	oiIconForMember,
	oiNormalize,
} from '@oi/carto/constants.js';

describe('constants.ts — OI_CARTO_RASTER_STYLE (oi_cartographie.js:23-48)', () => {
	it('version 8, 4 sources (satellite, ign-ortho, terrain-dem, openfreemap), 2 couches, glyphs OpenFreeMap', () => {
		expect(OI_CARTO_RASTER_STYLE.version).toBe(8);
		expect(OI_CARTO_RASTER_STYLE.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
		expect(Object.keys(OI_CARTO_RASTER_STYLE.sources)).toEqual([
			'satellite',
			'ign-ortho',
			'terrain-dem',
			'openfreemap',
		]);
		expect(OI_CARTO_RASTER_STYLE.layers).toHaveLength(2);
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
			'chef oscar': 'eye_tracking',
			ao: 'visibility',
			conducteur: 'search_hands_free',
			de: 'saved_search',
			cyno: 'pets',
		});
	});
});

describe('constants.ts — OI_ICON_CATALOG (oi_cartographie.js:94-110)', () => {
	it('28 entrées, {id,label}, présence des extrêmes (1re et dernière)', () => {
		expect(OI_ICON_CATALOG).toHaveLength(28);
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
