/**
 * pc-reset-flow.test.ts — Voies du RESET (décision 28).
 *
 * « Exporter l'archive puis effacer » n'efface que si l'export a réussi ;
 * un export en échec (`false`) n'efface RIEN. La voie « sans archive » est un
 * simple appel direct à performReset.
 */

import { describe, expect, it, vi } from 'vitest';

import { resetWithArchive } from '../../../src/apps/pctac/reset-flow.js';

describe('resetWithArchive', () => {
  it('export réussi : l\'effacement a lieu et rend true', async () => {
    const exportZip = vi.fn().mockResolvedValue(true);
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset)).resolves.toBe(true);
    expect(performReset).toHaveBeenCalledTimes(1);
    // L'export passe AVANT l'effacement.
    expect(exportZip.mock.invocationCallOrder[0]).toBeLessThan(performReset.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('export en échec : RIEN n\'est effacé et rend false', async () => {
    const exportZip = vi.fn().mockResolvedValue(false);
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset)).resolves.toBe(false);
    expect(performReset).not.toHaveBeenCalled();
  });

  it('export qui jette : la promesse rejette, rien n\'est effacé', async () => {
    const exportZip = vi.fn().mockRejectedValue(new Error('boom'));
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset)).rejects.toThrow('boom');
    expect(performReset).not.toHaveBeenCalled();
  });
});
