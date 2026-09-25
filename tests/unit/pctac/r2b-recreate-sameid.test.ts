/**
 * r2b-recreate-sameid.test.ts — C9 / « Insuffisant R14 » : « Recréer en
 * enregistrant » garde l'id d'origine, qui entre en collision avec la
 * suppression annulable encore armée dans l'autre onglet.
 *
 * (1) « Annuler » dans B ne doit pas créer deux fiches au même id.
 * (2) L'échéance de B ne doit pas purger la photo de la fiche recréée.
 * (3) La photo lue à l'ouverture est réécrite si le blob a été purgé.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, string>();
vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(id: string, d: string): Promise<void> { blobs.set(id, d); },
    async get(id: string): Promise<string | null> { return blobs.get(id) ?? null; },
    async getMany(ids: string[]): Promise<Record<string, string | null>> { return Object.fromEntries(ids.map((i) => [i, blobs.get(i) ?? null])); },
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
import { undoableDelete, purgeCollectionImages } from '@pctac/delete-undo.js';
import { installDialog, flush, setField, clickSave } from './fiche-helpers.js';

beforeAll(installDialog);
const K = 'pcTacAdversaries';
beforeEach(() => {
  blobs.clear(); localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>';
  Storage.saveCollection(K, [{ id: 'a1', nom: 'ALPHA', prenom: 'Alain', hasImage: true, status: 'active' }]);
  Storage.saveCollection('pcTacPhotos', [{ id: 'a1_sync', title: 'ALPHA', category: 'neutralized', status: 'active', hasImage: true }]);
  blobs.set('a1', 'PHOTO_ALPHA'); blobs.set('a1_sync', 'PHOTO_ALPHA');
});

async function recreateInA(): Promise<void> {
  await openFiche('adv', 'a1');
  setField('alias', 'Le Grand');
  // Onglet B : suppression annulable (même code que main.ts deleteCollectionItem).
  undoableDelete({ key: K, id: 'a1', message: 'Fiche supprimée', refresh: () => {}, onCommit: async () => { await purgeCollectionImages(K, 'a1'); } });
  document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: K, remote: true } }));
  await flush();
  document.querySelector<HTMLElement>('[data-choice="recreate"]')!.click();
  await flush();
  await clickSave();
}

describe('R14 contrôle : id conservé vs suppression différée de l autre onglet', () => {
  it('« Annuler » dans B après la recréation dans A : pas deux fiches au même id', async () => {
    await recreateInA();
    const undo = [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Annuler');
    undo!.click(); await flush();
    const ids = Storage.loadCollection(K).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('blob déjà purgé avant la recréation : la photo lue à l ouverture est réécrite', async () => {
    await openFiche('adv', 'a1');
    setField('alias', 'Le Grand');
    blobs.delete('a1'); blobs.delete('a1_sync');
    Storage.saveCollection(K, []);
    Storage.saveCollection('pcTacPhotos', []);
    document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: K, remote: true } }));
    await flush();
    document.querySelector<HTMLElement>('[data-choice="recreate"]')!.click();
    await flush();
    await clickSave();
    expect(blobs.get('a1')).toBe('PHOTO_ALPHA');
  });
});
