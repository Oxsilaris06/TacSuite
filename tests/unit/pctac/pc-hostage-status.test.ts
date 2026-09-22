/**
 * pc-hostage-status.test.ts — Lot B (constat 3) : le choix humain prime.
 *
 * Deux chemins, verrouillés ici :
 *   - statut NON touché par l'opérateur → `hostageStatusFromBlessures()`
 *     recalcule le statut quand les blessures changent ;
 *   - statut TOUCHÉ (change sur le sélecteur) → la valeur choisie est
 *     conservée, même si les blessures changent dans le même enregistrement.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// IndexedDB absent sous jsdom : ImageStore mocké (même motif que pc-ui.test.ts).
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

import { UI } from '@pctac/ui.js';
import { Storage } from '@pctac/storage.js';

const HOST = {
  id: 'h1',
  nom: 'Martin',
  prenom: 'Lucie',
  dob: '01/01/1980',
  lien: '',
  etat: '',
  blessures: '',
  status: 'ok',
};

function buildDom(): { modal: HTMLDialogElement; status: HTMLSelectElement; blessures: HTMLTextAreaElement } {
  document.body.innerHTML = `
    <dialog id="editHostageModal"></dialog>
    <div id="editHostModeBlocks"></div>
    <div id="edit_host_preview"></div>
    <input type="hidden" id="edit_host_id">
    <input type="text" id="edit_host_nom">
    <input type="text" id="edit_host_prenom">
    <input type="text" id="edit_host_dob">
    <select id="edit_host_lien"></select>
    <input type="text" id="edit_host_etat">
    <textarea id="edit_host_blessures"></textarea>
    <select id="edit_host_status">
      <option value="ok">OK</option>
      <option value="preoccupant">Préoccupant</option>
      <option value="blesse">Blessé</option>
      <option value="dcd">DCD</option>
    </select>
    <div id="hostage-table-body"></div>
    <datalist id="otages_suggestions"></datalist>
  `;
  const modal = document.getElementById('editHostageModal') as HTMLDialogElement;
  modal.showModal = vi.fn();
  modal.close = vi.fn();
  return {
    modal,
    status: document.getElementById('edit_host_status') as HTMLSelectElement,
    blessures: document.getElementById('edit_host_blessures') as HTMLTextAreaElement,
  };
}

function storedStatus(): string {
  const list = Storage.loadCollection('pcTacHostages');
  return String(list.find((h) => h.id === 'h1')?.status ?? '');
}

describe('statut otage — le choix humain prime (constat 3)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    Storage.saveCollection('pcTacHostages', [HOST]);
    Storage.saveCollection('pcTacAdversaries', []);
  });

  it('statut non touché : recalculé depuis les blessures', async () => {
    const { status, blessures } = buildDom();
    await UI.showEditHostageModal('h1');

    // L'opérateur ne touche PAS au sélecteur, mais corrige les blessures.
    blessures.value = 'Blessé grave';
    status.value = 'ok';
    await UI.handleHostageUpdate();

    expect(storedStatus()).toBe('blesse');
  });

  it('statut touché : conservé malgré un changement de blessures', async () => {
    const { status, blessures } = buildDom();
    await UI.showEditHostageModal('h1');

    // L'opérateur touche explicitement au sélecteur…
    status.value = 'dcd';
    status.dispatchEvent(new Event('change'));
    // …puis modifie les blessures dans le même passage.
    blessures.value = 'Indemne';
    await UI.handleHostageUpdate();

    expect(storedStatus()).toBe('dcd');
  });
});
