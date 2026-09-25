/**
 * pc-readmodify.test.ts — Audit lecture-modification-écriture (B6, décision 29).
 *
 * Toute écriture doit relire le stockage JUSTE AVANT d'écrire : une copie
 * gardée en mémoire pendant une attente (fenêtre de saisie) ne doit jamais
 * écraser l'ajout d'un autre onglet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/feedback.js', () => ({
  toast: vi.fn(),
  confirmDialog: vi.fn(async () => true),
  promptDialog: vi.fn(),
}));

import { UI } from '../../../src/apps/pctac/ui.js';
import { Storage } from '../../../src/apps/pctac/storage.js';
import { promptDialog } from '../../../src/shared/feedback.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('editPhotoTitle — relecture avant écriture', () => {
  it('préserve une photo ajoutée par un autre onglet pendant la saisie', async () => {
    Storage.saveCollection('pcTacPhotos', [{ id: 'a', title: 'A', category: 'location', data: 'x' }]);
    vi.mocked(promptDialog).mockImplementation(async () => {
      // Fenêtre ouverte : un autre onglet ajoute une photo.
      const list = Storage.loadCollection('pcTacPhotos');
      list.push({ id: 'c', title: 'C', category: 'location', data: 'x' });
      Storage.saveCollection('pcTacPhotos', list);
      return 'A renommée';
    });

    await UI.editPhotoTitle('a');

    const byId = new Map(Storage.loadCollection('pcTacPhotos').map((p) => [p.id, p]));
    expect(byId.has('a')).toBe(true);
    expect(byId.get('a')?.title).toBe('A renommée');
    expect(byId.has('c')).toBe(true); // l'ajout distant n'a pas été écrasé
  });
});
