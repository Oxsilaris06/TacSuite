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
  latLngToUtm,
  shortMgrs,
} from '../../src/shared/coords';
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
