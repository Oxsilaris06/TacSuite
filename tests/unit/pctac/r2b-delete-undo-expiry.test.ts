/**
 * r2b-delete-undo-expiry.test.ts — C9 / « Insuffisant R14 » (racine
 * `delete-undo.ts`) : à l'échéance d'une suppression annulable, la purge ne doit
 * RIEN effacer si l'id a été recréé entre-temps (photo, copie de galerie et
 * liens restent vivants).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, string>();
vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(id: string, d: string): Promise<void> { blobs.set(id, d); },
    async get(id: string): Promise<string | null> { return blobs.get(id) ?? null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(id: string): Promise<void> { blobs.delete(id); },
    async deleteMany(ids: string[]): Promise<void> { ids.forEach((i) => blobs.delete(i)); },
    async clear(): Promise<void> { blobs.clear(); },
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
  },
}));

import { Storage } from '@pctac/storage.js';
import { undoableDelete, purgeCollectionImages } from '@pctac/delete-undo.js';
import { ADVERSARIES_KEY, PHOTOS_KEY } from '@pctac/config.js';

beforeEach(() => {
  blobs.clear(); localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('C9 : échéance d une suppression vs recréation sous le même id', () => {
  it('id recréé : rien n est purgé (photo et galerie survivent)', async () => {
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', hasImage: true }]);
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'a1_sync' }]);
    blobs.set('a1', 'PHOTO'); blobs.set('a1_sync', 'PHOTO');
    undoableDelete({
      key: ADVERSARIES_KEY, id: 'a1', message: 'Fiche supprimée', refresh: () => {},
      onCommit: async () => { await purgeCollectionImages(ADVERSARIES_KEY, 'a1'); },
    });
    // Recréation sous le même id avant l'échéance.
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', hasImage: true }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(blobs.get('a1')).toBe('PHOTO');
    expect(Storage.loadCollection(PHOTOS_KEY).map((p) => p.id)).toContain('a1_sync');
  });

  it('id non recréé : la purge a bien lieu à l échéance', async () => {
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', hasImage: true }]);
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'a1_sync' }]);
    blobs.set('a1', 'PHOTO'); blobs.set('a1_sync', 'PHOTO');
    undoableDelete({
      key: ADVERSARIES_KEY, id: 'a1', message: 'Fiche supprimée', refresh: () => {},
      onCommit: async () => { await purgeCollectionImages(ADVERSARIES_KEY, 'a1'); },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(blobs.has('a1')).toBe(false);
    expect(Storage.loadCollection(PHOTOS_KEY).map((p) => p.id)).not.toContain('a1_sync');
  });
});
