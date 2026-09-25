/**
 * rb-close-draft.test.ts — R21 : fermer une fiche supprimée ailleurs ne doit
 * pas perdre la saisie ; elle est déplacée vers le brouillon « nouvelle fiche ».
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
import { installDialog, flush, setField } from './fiche-helpers.js';
beforeAll(installDialog);
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>';
  Storage.saveCollection('pcTacHostages', []);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('fiche supprimée ailleurs → Fermer (R21)', () => {
  it('déplace la saisie vers le brouillon de nouvelle fiche', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'ALPHA', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('antecedents', 'COUTEAU');
    Storage.saveCollection('pcTacAdversaries', []);
    document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: 'pcTacAdversaries', remote: true } }));
    await flush();
    document.querySelector<HTMLElement>('[data-choice="close"]')!.click();
    await flush();
    expect(document.querySelectorAll('.tac-choice-dialog').length).toBe(0);

    await openFiche('adv');
    await flush();
    document.querySelector<HTMLElement>('.fiche-draft-resume')!.click();
    await flush();
    expect((document.querySelector('#fiche_antecedents') as HTMLInputElement | HTMLTextAreaElement)?.value).toBe('COUTEAU');
  });
});
