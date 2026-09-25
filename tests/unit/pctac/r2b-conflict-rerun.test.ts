/**
 * r2b-conflict-rerun.test.ts — C10 / « Insuffisant R20 » : après « Garder la
 * mienne », la base de comparaison n'est pas mise à jour ; la relance (puis
 * toute écriture distante suivante) repose la même question déjà tranchée.
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

describe('R20 contrôle : « Garder la mienne » puis relance', () => {
  it('la même question n est pas reposée après la réponse', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'ALPHA', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('antecedents', 'LOCAL');
    const l = Storage.loadCollection('pcTacAdversaries'); l[0]!.antecedents = 'AUTRE'; Storage.saveCollection('pcTacAdversaries', l);
    remote();
    const l2 = Storage.loadCollection('pcTacAdversaries'); l2[0]!.status = 'neutralized'; Storage.saveCollection('pcTacAdversaries', l2);
    remote();
    await flush();
    const first = document.querySelector('.tac-choice-dialog');
    (first!.querySelector('[data-choice="mine"]') as HTMLElement).click();
    await flush();
    const again = document.querySelectorAll('.tac-choice-dialog');
    expect(again.length).toBe(0);
  });

  it('un 3e changement distant d un AUTRE champ ne repose pas la question tranchée', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'ALPHA', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('antecedents', 'LOCAL');
    const l = Storage.loadCollection('pcTacAdversaries'); l[0]!.antecedents = 'AUTRE'; Storage.saveCollection('pcTacAdversaries', l);
    remote(); await flush();
    (document.querySelector('.tac-choice-dialog [data-choice="mine"]') as HTMLElement).click();
    await flush();
    const l3 = Storage.loadCollection('pcTacAdversaries'); l3[0]!.alias = 'LE GRAND'; Storage.saveCollection('pcTacAdversaries', l3);
    remote(); await flush();
    const again = document.querySelectorAll('.tac-choice-dialog');
    expect(again.length).toBe(0);
  });
});
