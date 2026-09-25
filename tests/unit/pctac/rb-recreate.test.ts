/**
 * rb-recreate.test.ts — R14 : « Recréer en enregistrant » garde les champs non
 * modifiés, le statut et l'id d'origine de la fiche supprimée ailleurs.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(): Promise<void> {},
    async get(): Promise<string | null> { return null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(): Promise<void> {},
    async deleteMany(): Promise<void> {},
    async clear(): Promise<void> {},
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
  },
}));

import '@pctac/ui.js';
import { openFiche } from '@pctac/fiche-sheet.js';
import { Storage } from '@pctac/storage.js';
import { installDialog, flush, setField, clickSave } from './fiche-helpers.js';

beforeAll(installDialog);
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>';
  Storage.saveCollection('pcTacAdversaries', []);
  Storage.saveCollection('pcTacHostages', []);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Recréer en enregistrant (R14)', () => {
  it('garde les champs non modifiés, le statut et l’id de la fiche supprimée ailleurs', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'ALPHA', prenom: 'Alain', antecedents: 'Fiché S', status: 'neutralized' }]);
    await openFiche('adv', 'a1');
    setField('alias', 'Le Grand'); // une seule modification locale
    Storage.saveCollection('pcTacAdversaries', []); // supprimée dans l'autre onglet
    document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: 'pcTacAdversaries', remote: true } }));
    await flush();
    document.querySelector<HTMLElement>('[data-choice="recreate"]')!.click();
    await flush();
    await clickSave();
    const list = Storage.loadCollection('pcTacAdversaries');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a1', nom: 'ALPHA', prenom: 'Alain', antecedents: 'Fiché S', alias: 'Le Grand', status: 'neutralized' });
  });
});
