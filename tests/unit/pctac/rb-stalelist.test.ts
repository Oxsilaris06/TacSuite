/**
 * rb-stalelist.test.ts — R15 : la liste est relue après la fenêtre de doublon,
 * pour ne pas jeter une fiche ajoutée entre-temps par un autre onglet.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(): Promise<void> {}, async get(): Promise<string | null> { return null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(): Promise<void> {}, async deleteMany(): Promise<void> {}, async clear(): Promise<void> {},
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
  Storage.saveCollection('pcTacHostages', []);
});
afterEach(() => { vi.restoreAllMocks(); });
describe('doublon : liste relue après la fenêtre (R15)', () => {
  for (const choice of ['create', 'merge']) {
    it(`« ${choice} » ne jette pas une fiche ajoutée par un autre onglet pendant la fenêtre`, async () => {
      Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'Dupont', prenom: 'Jean', status: 'active' }]);
      await openFiche('adv');
      setField('nom', 'Dupont');
      setField('prenom', 'Jean');
      await clickSave();
      expect(document.querySelector('.tac-choice-dialog')).not.toBeNull();
      // Autre onglet : ajoute MARTIN pendant que la fenêtre attend.
      const other = Storage.loadCollection('pcTacAdversaries');
      other.push({ id: 'm1', nom: 'MARTIN', status: 'active' });
      Storage.saveCollection('pcTacAdversaries', other);
      document.querySelector<HTMLElement>(`[data-choice="${choice}"]`)!.click();
      await flush();
      const ids = Storage.loadCollection('pcTacAdversaries').map((i) => i.nom);
      expect(ids).toContain('MARTIN');
    });
  }
});
