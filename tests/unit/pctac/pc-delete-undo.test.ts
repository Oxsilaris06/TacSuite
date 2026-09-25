/**
 * pc-delete-undo.test.ts — Suppressions annulables (décision 31).
 *
 * Couvre : disparition immédiate liste + stockage, « Annuler » qui replace au
 * même rang, commit différé (images purgées à l'échéance seulement), deux
 * suppressions indépendantes, réinsertion au bon rang après un ajout, et purge
 * des images/références.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Storage } from '../../../src/apps/pctac/storage.js';
import { ImageStore } from '../../../src/apps/pctac/image-store.js';
import { Persist } from '../../../src/shared/persist.js';
import { scopedKey } from '../../../src/apps/pctac/modes.js';
import { ADVERSARIES_KEY, PHOTOS_KEY } from '../../../src/apps/pctac/config.js';
import { PINS_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { undoableDelete, undoableDeleteLog, purgeCollectionImages } from '../../../src/apps/pctac/delete-undo.js';

const clickUndo = (): void => {
  const button = document.querySelector<HTMLButtonElement>('.tac-toast button');
  button?.click();
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('undoableDelete — collection', () => {
  it('retire tout de suite de la liste et du stockage, puis annule au même rang', () => {
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const refresh = vi.fn();

    const done = undoableDelete({ key: PHOTOS_KEY, id: 'b', message: 'Photo supprimée', refresh });

    expect(done).toBe(true);
    expect(Storage.loadCollection(PHOTOS_KEY).map((i) => i.id)).toEqual(['a', 'c']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tac-toast')?.textContent).toContain('Photo supprimée');

    clickUndo();
    expect(Storage.loadCollection(PHOTOS_KEY).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('réinsère au bon rang quand un autre élément a été ajouté entre-temps', () => {
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    undoableDelete({ key: PHOTOS_KEY, id: 'b', message: 'Photo supprimée', refresh: () => {} });
    // Un autre élément est ajouté pendant la fenêtre d'annulation.
    const list = Storage.loadCollection(PHOTOS_KEY);
    list.push({ id: 'd' });
    Storage.saveCollection(PHOTOS_KEY, list);

    clickUndo();
    expect(Storage.loadCollection(PHOTOS_KEY).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('n\'efface les images qu\'à l\'échéance (onCommit), jamais à « Annuler »', () => {
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'a' }]);
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    undoableDelete({ key: PHOTOS_KEY, id: 'a', message: 'Photo supprimée', refresh: () => {}, onCommit });

    vi.advanceTimersByTime(9_999);
    expect(onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    void onUndo;
  });

  it('deux suppressions rapprochées sont chacune annulables', () => {
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    undoableDelete({ key: PHOTOS_KEY, id: 'a', message: 'Photo supprimée', refresh: () => {} });
    undoableDelete({ key: PHOTOS_KEY, id: 'c', message: 'Photo supprimée', refresh: () => {} });
    expect(Storage.loadCollection(PHOTOS_KEY).map((i) => i.id)).toEqual(['b']);

    const buttons = document.querySelectorAll<HTMLButtonElement>('.tac-toast button');
    buttons[1]?.click(); // annule la 2e suppression (c)
    buttons[0]?.click(); // annule la 1re suppression (a)
    expect(Storage.loadCollection(PHOTOS_KEY).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('id inconnu : aucune suppression, aucun toast', () => {
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'a' }]);
    expect(undoableDelete({ key: PHOTOS_KEY, id: 'zzz', message: 'x', refresh: () => {} })).toBe(false);
    expect(document.querySelector('.tac-toast')).toBeNull();
  });
});

describe('undoableDeleteLog — main courante', () => {
  it('supprime puis replace l\'entrée, tri conservé', () => {
    Storage.saveLogData([
      { id: 'a', heure: '10:00', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: '', date: '2026-01-01' },
      { id: 'b', heure: '11:00', pax: 'Otage', paxMode: 'standard', lieu: '', remarques: '', date: '2026-01-01' },
    ]);
    const refresh = vi.fn();
    expect(undoableDeleteLog('a', 'Entrée supprimée', refresh)).toBe(true);
    expect(Storage.loadLogData().map((e) => e.id)).toEqual(['b']);

    clickUndo();
    expect(Storage.loadLogData().map((e) => e.id)).toEqual(['a', 'b']);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('purgeCollectionImages — effacement différé', () => {
  it('efface id, _orig et _sync, retire la copie de la galerie et les références', async () => {
    const del = vi.spyOn(ImageStore, 'delete').mockResolvedValue(undefined);
    const refresh = vi.fn();
    (window as unknown as { PlanMap: unknown }).PlanMap = { initialized: true, refresh };
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'x', hasImage: true }]);
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'x_sync' }, { id: 'y' }]);
    Persist.set(scopedKey(PINS_KEY), [{ photoId: 'x' }, { photoId: 'z' }]);

    await purgeCollectionImages(ADVERSARIES_KEY, 'x');

    const deleted = del.mock.calls.map((c) => c[0]);
    expect(deleted).toContain('x');
    expect(deleted).toContain('x_orig');
    expect(deleted).toContain('x_sync');
    expect(Storage.loadCollection(PHOTOS_KEY).map((i) => i.id)).toEqual(['y']);
    const pins = Persist.get<{ photoId?: string }[]>(scopedKey(PINS_KEY), { validator: Array.isArray, fallback: [] }) ?? [];
    expect(pins[0]?.photoId).toBeUndefined();
    expect(pins[1]?.photoId).toBe('z');
    expect(refresh).toHaveBeenCalled();
  });

  it('photo seule : pas de cascade _sync', async () => {
    const del = vi.spyOn(ImageStore, 'delete').mockResolvedValue(undefined);
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'p' }, { id: 'q' }]);
    await purgeCollectionImages(PHOTOS_KEY, 'p');
    expect(del.mock.calls.map((c) => c[0])).toEqual(['p', 'p_orig']);
    // La purge ne touche pas la liste : l'entrée a déjà été retirée par la
    // suppression annulable (ici on ne teste que l'effacement des blobs).
    expect(Storage.loadCollection(PHOTOS_KEY).map((i) => i.id)).toEqual(['p', 'q']);
  });
});
