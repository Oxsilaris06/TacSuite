/**
 * r2b-reset-filename.test.ts — C15 (K3, R17) : la confirmation du RESET doit
 * nommer le fichier RÉELLEMENT téléchargé, demandé à `Archive` APRÈS l'export.
 */

import { describe, expect, it, vi } from 'vitest';

import { resetWithArchive } from '../../../src/apps/pctac/reset-flow.js';

describe('C15 / K3 — nom réellement téléchargé dans la confirmation', () => {
  it('la confirmation reçoit le nom rendu par lastFileName', async () => {
    const seen: (string | null)[] = [];
    await resetWithArchive(
      async () => true,
      () => {},
      (fileName) => { seen.push(fileName); return true; },
      0,
      () => 'PC-Tac_Forcene_2026-09-25_13h43.pctac.zip',
    );
    expect(seen).toEqual(['PC-Tac_Forcene_2026-09-25_13h43.pctac.zip']);
  });

  it('le nom est demandé APRÈS l export et AVANT la confirmation', async () => {
    const order: string[] = [];
    await resetWithArchive(
      async () => { order.push('export'); return true; },
      () => { order.push('reset'); },
      () => { order.push('confirm'); return true; },
      0,
      () => { order.push('name'); return 'X.pctac.zip'; },
    );
    expect(order).toEqual(['export', 'name', 'confirm', 'reset']);
  });

  it('sans lastFileName, la confirmation reçoit null (repli laissé à l appelant)', async () => {
    const seen: (string | null)[] = [];
    await resetWithArchive(async () => true, () => {}, (fileName) => { seen.push(fileName); return true; });
    expect(seen).toEqual([null]);
  });

  it('export en échec : lastFileName n est pas demandé', async () => {
    const lastFileName = vi.fn().mockReturnValue('X.pctac.zip');
    await expect(resetWithArchive(async () => false, () => {}, () => true, 0, lastFileName)).resolves.toBe('export-failed');
    expect(lastFileName).not.toHaveBeenCalled();
  });
});
