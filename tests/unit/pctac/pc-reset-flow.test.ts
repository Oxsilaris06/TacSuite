/**
 * pc-reset-flow.test.ts — Voies du RESET (décision 28) et confirmation après
 * export (R17).
 *
 * « Exporter l'archive puis effacer » n'efface que si l'export a réussi
 * (`'reset'`) ; un export en échec (`'export-failed'`) n'efface RIEN ; une
 * confirmation refusée (`'cancelled'`) n'efface RIEN non plus. La voie « sans
 * archive » est un simple appel direct à performReset.
 */

import { describe, expect, it, vi } from 'vitest';

import { resetWithArchive } from '../../../src/apps/pctac/reset-flow.js';

describe('resetWithArchive', () => {
  it('export réussi : l\'effacement a lieu et rend \'reset\'', async () => {
    const exportZip = vi.fn().mockResolvedValue(true);
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset)).resolves.toBe('reset');
    expect(performReset).toHaveBeenCalledTimes(1);
    // L'export passe AVANT l'effacement.
    expect(exportZip.mock.invocationCallOrder[0]).toBeLessThan(performReset.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('export en échec : RIEN n\'est effacé et rend \'export-failed\'', async () => {
    const exportZip = vi.fn().mockResolvedValue(false);
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset)).resolves.toBe('export-failed');
    expect(performReset).not.toHaveBeenCalled();
  });

  it('export qui jette : la promesse rejette, rien n\'est effacé', async () => {
    const exportZip = vi.fn().mockRejectedValue(new Error('boom'));
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset)).rejects.toThrow('boom');
    expect(performReset).not.toHaveBeenCalled();
  });

  it('R17 — confirmation refusée : RIEN n\'est effacé', async () => {
    const exportZip = vi.fn().mockResolvedValue(true);
    const confirm = vi.fn().mockResolvedValue(false);
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset, confirm)).resolves.toBe('cancelled');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(performReset).not.toHaveBeenCalled();
  });

  it('R17 — confirmation acceptée : export → confirmation → effacement', async () => {
    const exportZip = vi.fn().mockResolvedValue(true);
    const confirm = vi.fn().mockResolvedValue(true);
    const performReset = vi.fn();
    await expect(resetWithArchive(exportZip, performReset, confirm)).resolves.toBe('reset');
    expect(exportZip.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0] ?? Infinity);
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(performReset.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('R17 — le rechargement attend le délai de révocation de l\'URL blob', async () => {
    vi.useFakeTimers();
    try {
      const exportZip = vi.fn().mockResolvedValue(true);
      const confirm = vi.fn().mockResolvedValue(true);
      const performReset = vi.fn();
      const p = resetWithArchive(exportZip, performReset, confirm, 2000);
      await vi.advanceTimersByTimeAsync(0);
      expect(performReset).not.toHaveBeenCalled(); // le délai court encore
      await vi.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toBe('reset');
      expect(performReset).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
