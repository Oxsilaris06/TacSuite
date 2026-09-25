/**
 * rb-purge-sync.test.ts — B-1 : `purgeCollectionImages` fait le nettoyage
 * synchrone (galerie `_sync`, références) AVANT les `await` IndexedDB, pour
 * qu'un `pagehide` l'exécute en entier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeCollectionImages } from '@pctac/delete-undo.js';
import { Storage } from '@pctac/storage.js';
import { ImageStore } from '@pctac/image-store.js';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('purgeCollectionImages (B-1)', () => {
  it('retire l’entrée de galerie `_sync` AVANT la première attente IndexedDB', () => {
    Storage.saveCollection('pcTacPhotos', [{ id: 'a1_sync', title: 'A1', hasImage: true }]);
    // Les écritures IndexedDB ne rendent jamais la main : seul le synchrone compte.
    vi.spyOn(ImageStore, 'delete').mockReturnValue(new Promise<void>(() => { /* jamais */ }));
    void purgeCollectionImages('pcTacAdversaries', 'a1');
    expect(Storage.loadCollection('pcTacPhotos').some((p) => p.id === 'a1_sync')).toBe(false);
  });

  it('efface bien les trois blobs à l’échéance', async () => {
    Storage.saveCollection('pcTacPhotos', [{ id: 'a1_sync', title: 'A1', hasImage: true }]);
    const del = vi.spyOn(ImageStore, 'delete').mockResolvedValue(undefined);
    await purgeCollectionImages('pcTacAdversaries', 'a1');
    expect(del.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['a1', 'a1_orig', 'a1_sync']));
  });
});
