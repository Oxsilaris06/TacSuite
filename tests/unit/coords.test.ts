// Tests TDD pour src/shared/coords.ts — écrits AVANT l'implémentation.
//
// Les valeurs de référence viennent de tests/unit/fixtures/coords.fixtures.json,
// généré en exécutant l'ORIGINAL (modules/pctac/coords.js, GStart-main,
// strictement en lecture seule) dans Node : voir le script utilisé,
// /tmp/.../scratchpad/gen-fixtures.mjs (copie jetable, jamais dans GStart-main).
// 24 points de référence : hémisphères N/S, longitudes E/W, bords de fuseaux
// UTM, exceptions Norvège/Svalbard, bornes du domaine MGRS (lat [-80, 84)),
// wraparound de longitude (±190°, ±180°), arrondi DMS avec retenue,
// paramètre `digits` de latLngToMgrs, et cas hors-domaine (MGRS omis).
import { describe, expect, it } from 'vitest';
import {
  formatCoordsClipboard,
  latLngToMgrs,
  looksLikeCoordinates,
  latLngToUtm,
  parseCoordinateInput,
  parseDecimalCoords,
  parseDmsCoords,
  parseGridCell,
  parseMgrsCoords,
  shortMgrs,
} from '../../src/shared/coords';
import { gridCellAt } from '../../src/shared/tactical-grid';
import fixtures from './fixtures/coords.fixtures.json';

interface UtmFixture {
  zone: number;
  band: string;
  easting: number;
  northing: number;
  hemisphere: 'N' | 'S';
}

interface MgrsFixture {
  value: string | null;
  threw: boolean;
  errorName?: string;
  errorMessage?: string;
}

interface CoordsFixture {
  name: string;
  lat: number;
  lon: number;
  digits?: number;
  utm: UtmFixture;
  mgrs: MgrsFixture;
  clipboard: string;
  short: string;
}

const points = fixtures as CoordsFixture[];

describe('coords — valeur canonique « null island »', () => {
  it('(0,0) → "31N AA 66021 00000"', () => {
    expect(latLngToMgrs(0, 0)).toBe('31N AA 66021 00000');
  });
});

describe.each(points)('coords — $name (lat=$lat, lon=$lon)', (p) => {
  it('latLngToUtm reproduit zone/band/hemisphere/easting/northing', () => {
    const utm = latLngToUtm(p.lat, p.lon);
    expect(utm.zone).toBe(p.utm.zone);
    expect(utm.band).toBe(p.utm.band);
    expect(utm.hemisphere).toBe(p.utm.hemisphere);
    expect(utm.easting).toBeCloseTo(p.utm.easting, 6);
    expect(utm.northing).toBeCloseTo(p.utm.northing, 6);
  });

  it('latLngToMgrs reproduit la chaîne ou lève RangeError hors domaine', () => {
    if (p.mgrs.threw) {
      expect(() => latLngToMgrs(p.lat, p.lon, p.digits)).toThrow(RangeError);
      expect(() => latLngToMgrs(p.lat, p.lon, p.digits)).toThrow(p.mgrs.errorMessage);
    } else {
      expect(latLngToMgrs(p.lat, p.lon, p.digits)).toBe(p.mgrs.value);
    }
  });

  it('formatCoordsClipboard reproduit le bloc presse-papier (lng, lat)', () => {
    expect(formatCoordsClipboard(p.lon, p.lat)).toBe(p.clipboard);
  });

  it('shortMgrs reproduit la version courte ou le repli décimal (lng, lat)', () => {
    expect(shortMgrs(p.lon, p.lat)).toBe(p.short);
  });
});

describe('coords — paramètre digits par défaut', () => {
  it('latLngToMgrs(lat, lon) sans digits équivaut à digits=5', () => {
    expect(latLngToMgrs(48.856614, 2.352222)).toBe('31U DQ 52484 11718');
  });
});

describe('coords — normalisation de longitude', () => {
  it('180° et -180° produisent le même résultat (repli sur -180)', () => {
    expect(latLngToUtm(10, 180)).toEqual(latLngToUtm(10, -180));
    expect(formatCoordsClipboard(180, 10)).toBe(formatCoordsClipboard(-180, 10));
  });
});

// ---------------------------------------------------------------------------
// SAISIE DE COORDONNÉES (décision 35, lot C) — parseurs purs
// ---------------------------------------------------------------------------

describe('coords — parseDecimalCoords', () => {
  it('virgule décimale française', () => {
    expect(parseDecimalCoords('48,8566 ; 2,3522')).toEqual({ lat: 48.8566, lng: 2.3522 });
  });
  it('séparateur virgule et espace', () => {
    expect(parseDecimalCoords('48.85, 2.35')).toEqual({ lat: 48.85, lng: 2.35 });
    expect(parseDecimalCoords('48.85 2.35')).toEqual({ lat: 48.85, lng: 2.35 });
  });
  it('négatifs (S/W)', () => {
    expect(parseDecimalCoords('-33.9, 18.4')).toEqual({ lat: -33.9, lng: 18.4 });
  });
  it('hors bornes → bad-range', () => {
    expect(parseDecimalCoords('95.0, 2.35')).toBe('bad-range');
    expect(parseDecimalCoords('48.85, 200')).toBe('bad-range');
  });
  it('non décimal → null', () => {
    expect(parseDecimalCoords('Paris')).toBeNull();
    expect(parseDecimalCoords('48.85')).toBeNull();
  });
});

describe('coords — parseDmsCoords', () => {
  it('DMS classique avec symboles', () => {
    const r = parseDmsCoords(`48°51'24"N 2°21'03"E`);
    expect(r).not.toBeNull();
    expect(r).not.toBe('bad-range');
    const v = r as { lat: number; lng: number };
    expect(v.lat).toBeCloseTo(48.856666, 5);
    expect(v.lng).toBeCloseTo(2.350833, 5);
  });

  it('DMS sans symboles (nombres séparés) et hémisphères en queue', () => {
    const r = parseDmsCoords('48 51 24 N 2 21 03 E');
    const v = r as { lat: number; lng: number };
    expect(v.lat).toBeCloseTo(48.856666, 5);
    expect(v.lng).toBeCloseTo(2.350833, 5);
  });

  it('symboles prime/double-prime typographiques et hémisphères en tête', () => {
    const r = parseDmsCoords('N48°51.4′ E2°21.05′');
    const v = r as { lat: number; lng: number };
    expect(v.lat).toBeCloseTo(48 + 51.4 / 60, 5);
    expect(v.lng).toBeCloseTo(2 + 21.05 / 60, 5);
  });

  it('hémisphères S et W → négatifs', () => {
    const r = parseDmsCoords(`33°52'00"S 18°25'00"W`);
    const v = r as { lat: number; lng: number };
    expect(v.lat).toBeCloseTo(-33.866666, 5);
    expect(v.lng).toBeCloseTo(-18.416666, 5);
  });

  it('minutes/secondes ≥ 60 → non reconnu', () => {
    expect(parseDmsCoords(`48°75'00"N 2°21'03"E`)).toBeNull();
  });

  it('hors bornes → bad-range', () => {
    expect(parseDmsCoords(`95°00'00"N 2°21'03"E`)).toBe('bad-range');
  });

  it('sans lettre d’hémisphère → null (ambigu avec le décimal)', () => {
    expect(parseDmsCoords('48 51 24 2 21 3')).toBeNull();
  });
});

describe('coords — parseMgrsCoords', () => {
  it('avec espaces, centre de case', () => {
    const r = parseMgrsCoords('31U DQ 52 12');
    expect(r).not.toBeNull();
    expect(r?.lat).toBeCloseTo(48.8636, 3);
    expect(r?.lng).toBeCloseTo(2.3523, 3);
  });

  it('sans espaces, précision 1 m', () => {
    const r = parseMgrsCoords('31UDQ5248411718');
    expect(r).not.toBeNull();
    expect(r?.lat).toBeCloseTo(48.8566, 3);
    expect(r?.lng).toBeCloseTo(2.3522, 3);
  });

  it('coordonnées décimales → null (pas du MGRS)', () => {
    expect(parseMgrsCoords('48.85, 2.35')).toBeNull();
  });
});

describe('coords — parseGridCell', () => {
  const grid = { west: 2.0, north: 49.0, dLon: 0.001, dLat: 0.001, cols: 10, rows: 10 };

  it('case valide → centre', () => {
    const r = parseGridCell('C4', grid);
    expect(r?.kind).toBe('cell');
    if (r?.kind === 'cell') {
      expect(r.cell).toBe('C4');
      expect(r.lat).toBeCloseTo(48.9965, 9);
      expect(r.lng).toBeCloseTo(2.0025, 9);
    }
  });

  it('sans carroyage → cell-no-grid', () => {
    expect(parseGridCell('A1', null)).toEqual({ kind: 'cell-no-grid' });
  });

  it('hors du carroyage → cell-out-of-grid', () => {
    expect(parseGridCell('Z9', grid)).toEqual({ kind: 'cell-out-of-grid', cell: 'Z9' });
  });

  it('carroyage TOURNÉ : le centre renvoyé retombe sur la bonne case (décision 39)', () => {
    const turned = { ...grid, angle: 90 };
    const r = parseGridCell('C4', turned);
    expect(r?.kind).toBe('cell');
    if (r?.kind === 'cell') {
      expect(gridCellAt(turned, r.lng, r.lat)).toBe('C4');
      const flat = parseGridCell('C4', grid);
      expect(flat?.kind).toBe('cell');
      if (flat?.kind === 'cell') {
        expect(Math.hypot(r.lng - flat.lng, r.lat - flat.lat)).toBeGreaterThan(0.001);
      }
    }
  });
});

describe('coords — parseCoordinateInput (avant tout géocodage)', () => {
  const grid = { west: 2.0, north: 49.0, dLon: 0.001, dLat: 0.001, cols: 10, rows: 10 };

  it('décimal prioritaire : « 48.85, 2.35 » n’est PAS une case', () => {
    const r = parseCoordinateInput('48.85, 2.35', grid);
    expect(r).toEqual({ kind: 'point', lat: 48.85, lng: 2.35, format: 'decimal', label: '48.85000, 2.35000' });
  });

  it('« 31U DQ 52 12 » est du MGRS', () => {
    const r = parseCoordinateInput('31U DQ 52 12', grid);
    expect(r?.kind).toBe('point');
    if (r?.kind === 'point') expect(r.format).toBe('mgrs');
  });

  it('« A1 » est une case', () => {
    const r = parseCoordinateInput('A1', grid);
    expect(r?.kind).toBe('cell');
    if (r?.kind === 'cell') {
      expect(r.cell).toBe('A1');
      expect(r.lat).toBeCloseTo(48.9995, 9);
      expect(r.lng).toBeCloseTo(2.0005, 9);
    }
  });

  it('case sans carroyage actif → null (la route « D951 » part au géocodage)', () => {
    expect(parseCoordinateInput('C4', null)).toBeNull();
    expect(parseCoordinateInput('D951', null)).toBeNull();
    expect(parseCoordinateInput('A7', null)).toBeNull();
  });

  it('latitude hors bornes → bad-range', () => {
    expect(parseCoordinateInput('95.0, 2.35', grid)).toEqual({ kind: 'bad-range' });
  });

  it('adresse ordinaire → null (géocodage)', () => {
    expect(parseCoordinateInput('12 rue de Rivoli, Paris', grid)).toBeNull();
    expect(parseCoordinateInput('', grid)).toBeNull();
  });
});

// R16 — le pré-analyseur DMS avalait toute adresse contenant un n/s/e/w
// (« rue », « des », « Nantes »…), court-circuitant le géocodage BAN/Nominatim.
describe('coords — adresses ordinaires jamais prises pour des coordonnées (R16)', () => {
  const addresses = [
    '12 rue des Lilas 45000 Orléans',
    '8 avenue Foch Paris 75008',
    '2 rue des Écoles 75',
    '5 rue de Nantes 44000',
    '1 place de la Mairie 45',
  ];
  for (const q of addresses) {
    it(`« ${q} » → null (géocodage)`, () => {
      expect(parseCoordinateInput(q, null)).toBeNull();
    });
  }
});

describe('coords — formes de coordonnées légitimes préservées (R16)', () => {
  const grid = { west: 2.0, north: 49.0, dLon: 0.001, dLat: 0.001, cols: 10, rows: 10 };

  it('DMS avec symboles reste un point DMS', () => {
    const r = parseCoordinateInput(`48°51'24"N 2°21'03"E`, grid);
    expect(r?.kind).toBe('point');
    if (r?.kind === 'point') expect(r.format).toBe('dms');
  });

  it('DMS sans symboles (hémisphères isolés) reste un point DMS', () => {
    const r = parseCoordinateInput('48 51 24 N 2 21 03 E', grid);
    expect(r?.kind).toBe('point');
    if (r?.kind === 'point') expect(r.format).toBe('dms');
  });

  it('MGRS reste un point MGRS', () => {
    const r = parseCoordinateInput('31U DQ 52 12', grid);
    expect(r?.kind).toBe('point');
    if (r?.kind === 'point') expect(r.format).toBe('mgrs');
  });

  it('case du carroyage actif reste une case (même hors du rectangle)', () => {
    expect(parseCoordinateInput('A1', grid)?.kind).toBe('cell');
    expect(parseCoordinateInput('D951', grid)?.kind).toBe('cell-out-of-grid');
  });
});

// Nico 2026-09-26 : une position n'est jamais révélée sans nécessité pour la
// carte. Une saisie qui ressemble à des coordonnées sans être lisible ne part
// pas au géocodage (IGN, Nominatim).
describe('coords — looksLikeCoordinates', () => {
  it.each([
    '48.8566 2.3522',
    "48°51'N 2°21'E",
    '48 51 30 N 2 21 08 E',
    'N 48.85 E 2.35',
    'lat 48.85 lon 2.35',
    '31U DQ 5223 1234',
    '31UDQ522',
    '48°99 N 2',
  ])('« %s » : coordonnées', (q) => {
    expect(looksLikeCoordinates(q)).toBe(true);
  });

  it.each([
    '12 rue de la Paix Paris',
    '75001',
    'D951',
    'N7',
    'A7 12',
    'Genève gare Cornavin',
    '3 rue 12',
  ])('« %s » : adresse', (q) => {
    expect(looksLikeCoordinates(q)).toBe(false);
  });
});
