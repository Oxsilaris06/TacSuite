/**
 * rb-draftphoto.test.ts — R13 (BLOQUANT) : la photo du brouillon ne doit
 * jamais partir sur une autre personne, revenir après un RESET, ni être
 * écrasée par la photo d'une autre saisie.
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

const dialog = (): HTMLDialogElement => document.getElementById('ficheSheet') as HTMLDialogElement;
beforeAll(installDialog);
beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>';
  Storage.saveCollection('pcTacAdversaries', []);
  Storage.saveCollection('pcTacHostages', []);
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

describe('photo de brouillon (R13)', () => {
  it('brouillon en attente NON repris : sa photo ne doit pas partir sur une autre personne', async () => {
    await openFiche('adv');
    setField('nom', 'PERSONNE_A');
    await pickPhoto('data:image/jpeg;base64,PHOTO_A');
    dialog().close();

    await openFiche('adv'); // bandeau « Saisie non enregistrée », non repris
    await flush();
    expect(document.querySelector('.fiche-draft')).not.toBeNull();
    const shown = dialog().querySelector<HTMLImageElement>('.fiche-photo img')?.getAttribute('src');
    setField('nom', 'PERSONNE_B');
    await clickSave();
    const b = Storage.loadCollection('pcTacAdversaries').find((i) => i.nom === 'PERSONNE_B')!;
    expect(shown ?? null).toBeNull();
    expect(b.hasImage).toBeFalsy();
  });

  it('après RESET, la photo du brouillon ne doit pas revenir sur une fiche neuve', async () => {
    await openFiche('adv');
    setField('nom', 'PERSONNE_A');
    await pickPhoto('data:image/jpeg;base64,PHOTO_A');
    dialog().close();
    Storage.clearAllData();
    await openFiche('adv');
    await flush();
    expect(document.querySelector('.fiche-draft')).toBeNull();
    const shown = dialog().querySelector<HTMLImageElement>('.fiche-photo img')?.getAttribute('src');
    expect(shown ?? null).toBeNull();
  });

  it('brouillon en attente : choisir une photo pour une AUTRE saisie écrase celle du brouillon', async () => {
    await openFiche('adv');
    setField('nom', 'PERSONNE_A');
    await pickPhoto('data:image/jpeg;base64,PHOTO_A');
    dialog().close();
    await openFiche('adv');
    await flush();
    await pickPhoto('data:image/jpeg;base64,PHOTO_B');
    dialog().close();
    await openFiche('adv');
    await flush();
    document.querySelector<HTMLElement>('.fiche-draft-resume')!.click();
    await flush();
    const shown = dialog().querySelector<HTMLImageElement>('.fiche-photo img')?.getAttribute('src');
    expect(shown).toBe('data:image/jpeg;base64,PHOTO_A');
  });
});
