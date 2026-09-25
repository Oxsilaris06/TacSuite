/**
 * rb-merge-gallery.test.ts — B-2 : après une fusion qui REPREND la photo de
 * l'entrante, l'entrée de galerie `<id>_sync` doit exister (le blob seul ne
 * suffit pas à l'afficher dans l'onglet Photos).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import '@pctac/ui.js';
import { openFiche } from '@pctac/fiche-sheet.js';
import { Storage } from '@pctac/storage.js';
import { Utils } from '@pctac/utils.js';
import { installDialog, flush, setField, clickSave } from './fiche-helpers.js';

beforeAll(installDialog);
beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div><div id="photo-board"></div>';
  Storage.saveCollection('pcTacHostages', []);
  Storage.saveCollection('pcTacPhotos', []);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('fusion qui reprend la photo (B-2)', () => {
  it('crée l’entrée de galerie `_sync` de la fiche gardée', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'Dupont', prenom: 'Jean', status: 'active' }]);
    vi.spyOn(Utils, 'compressImage').mockResolvedValue('data:image/jpeg;base64,PHOTO');
    vi.spyOn(Utils, 'promptGpsPoint').mockResolvedValue(undefined as never);
    await openFiche('adv');
    setField('nom', 'Dupont');
    setField('prenom', 'Jean');
    const input = document.querySelector<HTMLInputElement>('#ficheSheet .fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await clickSave();
    document.querySelector<HTMLElement>('[data-choice="merge"]')!.click();
    await flush();

    const gallery = Storage.loadCollection('pcTacPhotos');
    const entry = gallery.find((p) => p.id === 'a1_sync');
    expect(entry).toBeDefined();
    expect(entry?.hasImage).toBe(true);
    expect(blobs.get('a1_sync')).toBe('data:image/jpeg;base64,PHOTO');
  });
});
