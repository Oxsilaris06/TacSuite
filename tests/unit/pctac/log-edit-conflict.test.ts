/**
 * log-edit-conflict.test.ts — A5 (revue du 25/09) : « Modifier l'entrée » de
 * main courante face à un autre onglet (décision 29 appliquée au journal).
 *   - n'écrit que les champs modifiés (une modification distante d'un autre
 *     champ survit) ;
 *   - même champ modifié des deux côtés : choix, comme les fiches ;
 *   - entrée supprimée entre-temps : message, saisie gardée, rien d'écrit ;
 *   - LogManager.updateEntry ne rend plus « succès » sur un id introuvable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const choiceSpy = vi.hoisted(() => vi.fn(async () => 'theirs' as string | null));
vi.mock('@pctac/choice-dialog.js', () => ({ choiceDialog: choiceSpy }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/feedback.js')>()),
  toast: toastSpy,
}));

import { UI } from '@pctac/ui.js';
import { LogManager } from '@pctac/log-manager.js';
import { Storage } from '@pctac/storage.js';
import type { PctacLogEntry } from '@shared/types/contracts.js';

const ENTRY: PctacLogEntry = { id: 'e1', date: '2026-09-25', heure: '10:00', pax: 'Inter', paxMode: 'standard', paxColor: '', lieu: 'L1', remarques: 'R1' };

function seedModal(): void {
  document.body.innerHTML = `
    <dialog id="editModal">
      <input id="edit_id"><input id="edit_date"><input id="edit_heure"><input id="edit_lieu"><textarea id="edit_remarques"></textarea>
    </dialog>`;
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  if (typeof proto.showModal !== 'function') proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  if (typeof proto.close !== 'function') proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}
const stored = (): PctacLogEntry | undefined => Storage.loadLogData().find((e) => e.id === 'e1');
const setInput = (id: string, value: string): void => { (document.getElementById(id) as HTMLInputElement).value = value; };

beforeEach(() => {
  localStorage.clear();
  choiceSpy.mockClear();
  choiceSpy.mockResolvedValue('theirs');
  toastSpy.mockClear();
  seedModal();
  Storage.saveLogData([{ ...ENTRY }]);
  UI.openEditModal('e1');
});

describe('LogManager.updateEntry', () => {
  it('rend false sur un id introuvable, sans rien écrire', () => {
    expect(LogManager.updateEntry('absent', { lieu: 'x' })).toBe(false);
    expect(Storage.loadLogData()).toHaveLength(1);
  });
});

describe('UI.confirmEditLog — champs modifiés seulement', () => {
  it('une modification distante d’un autre champ survit', async () => {
    // L'autre onglet corrige les remarques pendant que la fenêtre est ouverte.
    Storage.saveLogData([{ ...ENTRY, remarques: 'R2' }]);
    setInput('edit_heure', '10:05');
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ heure: '10:05', remarques: 'R2', lieu: 'L1' });
    expect(choiceSpy).not.toHaveBeenCalled();
  });

  it('même champ modifié des deux côtés : choix, « Prendre l’autre » garde la version distante', async () => {
    Storage.saveLogData([{ ...ENTRY, remarques: 'R2' }]);
    setInput('edit_remarques', 'R-mienne');
    await UI.confirmEditLog();
    expect(choiceSpy).toHaveBeenCalledTimes(1);
    expect(stored()?.remarques).toBe('R2');
  });

  it('« Garder la mienne » écrit ma version', async () => {
    choiceSpy.mockResolvedValue('mine');
    Storage.saveLogData([{ ...ENTRY, remarques: 'R2' }]);
    setInput('edit_remarques', 'R-mienne');
    await UI.confirmEditLog();
    expect(stored()?.remarques).toBe('R-mienne');
  });

  it('entrée supprimée entre-temps : message, fenêtre ouverte, rien d’écrit', async () => {
    Storage.saveLogData([]);
    setInput('edit_lieu', 'Ailleurs');
    await UI.confirmEditLog();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('supprimée'), expect.objectContaining({ kind: 'error' }));
    expect(toastSpy).not.toHaveBeenCalledWith(expect.stringContaining('mise à jour'), expect.anything());
    expect(document.getElementById('editModal')?.hasAttribute('open')).toBe(true);
    expect(Storage.loadLogData()).toHaveLength(0);
    expect((document.getElementById('edit_lieu') as HTMLInputElement).value).toBe('Ailleurs');
  });
});

describe('Revue neuve du 25/09 — V7', () => {
  it('un favori retiré ailleurs n’ouvre pas de conflit fantôme', async () => {
    Storage.saveLogData([{ ...ENTRY, favori: true }]);
    UI.openEditModal('e1');
    Storage.saveLogData([{ ...ENTRY, favori: false }]);
    setInput('edit_lieu', 'L2');
    await UI.confirmEditLog();
    expect(choiceSpy).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ lieu: 'L2', favori: false });
  });

  it('entrée supprimée pendant la fenêtre de conflit : message « supprimée », pas « stockage plein »', async () => {
    Storage.saveLogData([{ ...ENTRY, remarques: 'R2' }]);
    choiceSpy.mockImplementationOnce(async () => { Storage.saveLogData([]); return 'mine'; });
    setInput('edit_remarques', 'R-mienne');
    await UI.confirmEditLog();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('supprimée'), expect.objectContaining({ kind: 'error' }));
    expect(toastSpy).not.toHaveBeenCalledWith(expect.stringContaining('Stockage plein'), expect.anything());
  });
});
