/**
 * rb-conflict2.test.ts — R20 : deux écritures distantes rapprochées ne
 * doivent pas empiler deux fenêtres de conflit pour le même champ.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { installDialog, flush, setField } from './fiche-helpers.js';
beforeAll(installDialog);
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>';
});
const remote = (): void => { document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: 'pcTacAdversaries', remote: true } })); };
describe('conflit : deux écritures distantes rapprochées (R20)', () => {
  it('une seule fenêtre de choix par champ', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'ALPHA', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('antecedents', 'LOCAL');
    // Autre onglet : « Enregistrer » avec changement de statut = deux écritures.
    const l = Storage.loadCollection('pcTacAdversaries'); l[0]!.antecedents = 'AUTRE'; Storage.saveCollection('pcTacAdversaries', l);
    remote();
    const l2 = Storage.loadCollection('pcTacAdversaries'); l2[0]!.status = 'neutralized'; Storage.saveCollection('pcTacAdversaries', l2);
    remote();
    await flush();
    const n = document.querySelectorAll('.tac-choice-dialog').length;
    expect(n).toBe(1);
  });
});
