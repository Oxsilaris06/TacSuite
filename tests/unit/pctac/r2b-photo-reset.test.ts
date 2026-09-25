/**
 * r2b-photo-reset.test.ts — C11 / « Insuffisant R21 » : « Fermer » après une
 * suppression ailleurs transfère les VALEURS du brouillon, pas sa PHOTO ; le
 * blob `…-img:adv:<id>` devient orphelin et échappe à la collecte du RESET.
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
import { openFiche, draftImageIds } from '@pctac/fiche-sheet.js';
import { Storage } from '@pctac/storage.js';
import { Utils } from '@pctac/utils.js';
import { installDialog, flush, setField } from './fiche-helpers.js';

const dialog = (): HTMLDialogElement => document.getElementById('ficheSheet') as HTMLDialogElement;
beforeAll(installDialog);
beforeEach(() => {
  blobs.clear(); localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>';
});
afterEach(() => { vi.restoreAllMocks(); });

async function pickPhoto(data: string): Promise<void> {
  vi.spyOn(Utils, 'compressImage').mockResolvedValue(data);
  vi.spyOn(Utils, 'promptGpsPoint').mockResolvedValue(undefined as never);
  const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

describe('R21 contrôle : « Fermer » après suppression ailleurs, photo choisie', () => {
  it('la photo suit la saisie vers le créneau « nouvelle fiche » et reste collectable au RESET', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'ALPHA', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('alias', 'Le Grand');
    await pickPhoto('data:image/jpeg;base64,PHOTO_P1');
    Storage.saveCollection('pcTacAdversaries', []);
    document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: 'pcTacAdversaries', remote: true } }));
    await flush();
    document.querySelector<HTMLElement>('[data-choice="close"]')!.click();
    await flush();
    const collectable = draftImageIds();
    // Reprise dans une nouvelle fiche
    await openFiche('adv'); await flush();
    document.querySelector<HTMLElement>('.fiche-draft-resume')!.click(); await flush();
    const shown = dialog().querySelector<HTMLImageElement>('.fiche-photo img')?.getAttribute('src') ?? null;
    expect(document.querySelector<HTMLInputElement>('#fiche_alias')?.value).toBe('Le Grand');
    expect(shown).toBe('data:image/jpeg;base64,PHOTO_P1');
    const orphans = [...blobs.keys()].filter((k) => k.includes('-img:') && !collectable.includes(k));
    expect(orphans).toEqual([]);
  });
});
