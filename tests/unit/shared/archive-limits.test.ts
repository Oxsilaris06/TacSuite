/**
 * archive-limits.test.ts — audit du 26/09 (skill getsentry-security-review) :
 * aucune borne sur les archives importées ; une « zip bomb » de quelques Mo
 * faisait planter l'onglet. Consigne de Nico : laisser passer les grosses
 * archives réalistes.
 */
import { describe, expect, it } from 'vitest';

import { archiveSizeVerdict } from '@shared/archive-limits.js';

const MB = 1024 * 1024;

describe('archiveSizeVerdict', () => {
  it('laisse passer une grosse archive réaliste : 400 photos de 4 Mo, déjà compressées', () => {
    const entries = [{ name: 'data.json', size: 8 * MB }, ...Array.from({ length: 400 }, (_, i) => ({ name: `images/p${i}.bin`, size: 4 * MB }))];
    expect(archiveSizeVerdict(entries, 1560 * MB)).toBeNull();
  });

  it('laisse passer une petite archive très compressible (JSON seul)', () => {
    expect(archiveSizeVerdict([{ name: 'data.json', size: 40 * MB }], 2 * MB)).toBeNull();
  });

  it('refuse une zip bomb : 5 Go décompressés depuis 5 Mo', () => {
    expect(archiveSizeVerdict([{ name: 'images/x.bin', size: 5 * 1024 * MB }], 5 * MB)).toMatch(/trop volumineux/);
    expect(archiveSizeVerdict([{ name: 'images/x.bin', size: 600 * MB }], 5 * MB)).toMatch(/trop volumineux/);
  });

  it('refuse un JSON démesuré, même peu compressé', () => {
    expect(archiveSizeVerdict([{ name: 'gpx/t1.json', size: 300 * MB }], 290 * MB)).toMatch(/JSON/);
  });

  it('refuse au-delà du plafond absolu', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ name: `images/p${i}.bin`, size: 1024 * MB }));
    expect(archiveSizeVerdict(entries, 5 * 1024 * MB)).toMatch(/trop volumineux/);
  });

  it('revue du 26/09 : une bombe sous 512 Mo est refusée par son taux PAR ENTRÉE', () => {
    expect(archiveSizeVerdict([{ name: 'images/a.bin', size: 511 * MB, compressed: 1 * MB }], 1 * MB)).toMatch(/trop volumineux/);
    // Une photo (déjà compressée) ou un JSON ordinaire passent.
    expect(archiveSizeVerdict([{ name: 'images/p.bin', size: 40 * MB, compressed: 39 * MB }], 39 * MB)).toBeNull();
    expect(archiveSizeVerdict([{ name: 'data.json', size: 40 * MB, compressed: 2 * MB }], 2 * MB)).toBeNull();
  });
});
