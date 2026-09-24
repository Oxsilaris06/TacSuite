/**
 * pc-hostage-status.test.ts — Statut et triage de la fiche protégée, dans la
 * fiche unique (décisions 17 et 19 ; Lot B constat 3 conservé).
 *
 *   - Forcené, statut NON touché : `hostageStatusFromBlessures()` recalcule le
 *     statut quand les blessures changent ;
 *   - Forcené, statut TOUCHÉ : la valeur choisie tient, même si les blessures
 *     changent dans le même enregistrement ;
 *   - TP et Ampleur : triage, « Non triée » par défaut, jamais déduit.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { PCTAC_MODE_KEY } from '@pctac/modes.js';
import { installDialog, flush, setField, clickSave, storedFiche } from './fiche-helpers.js';

const HOST = { id: 'h1', nom: 'Martin', prenom: 'Lucie', blessures: '', status: 'ok' };

beforeAll(installDialog);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="hostage-table-body"></div>';
  Storage.saveCollection('pcTacAdversaries', []);
});

describe('Forcené — le choix humain prime (constat 3)', () => {
  beforeEach(() => { Storage.saveCollection('pcTacHostages', [HOST]); });

  it('statut non touché : recalculé depuis les blessures', async () => {
    await openFiche('host', 'h1');
    setField('blessures', 'Blessé grave');
    await clickSave();
    expect(storedFiche('pcTacHostages', 'h1')?.status).toBe('blesse');
  });

  it('statut touché : conservé malgré un changement de blessures', async () => {
    await openFiche('host', 'h1');
    document.querySelector<HTMLElement>('.fiche-status-chip[data-status="dcd"]')!.click();
    setField('blessures', 'Indemne');
    await clickSave();
    expect(storedFiche('pcTacHostages', 'h1')?.status).toBe('dcd');
  });

  it('création : le statut suit les blessures tant qu’on n’y a pas touché', async () => {
    Storage.saveCollection('pcTacHostages', []);
    await openFiche('host');
    setField('nom', 'Durand');
    setField('blessures', 'blessé au bras');
    await clickSave();
    expect(Storage.loadCollection('pcTacHostages')[0]?.status).toBe('blesse');
  });
});

describe('TP et Ampleur — triage', () => {
  beforeEach(() => {
    localStorage.setItem(PCTAC_MODE_KEY, 'tp');
    Storage.saveCollection('pcTacHostages', []);
  });

  it('« Non triée » par défaut, jamais déduite des blessures', async () => {
    await openFiche('host');
    setField('nom', 'Leroy');
    setField('blessures', 'grave, hémorragie');
    await clickSave();
    expect(Storage.loadCollection('pcTacHostages')[0]?.status).toBe('nt');
  });

  it('le triage choisi est enregistré', async () => {
    await openFiche('host');
    setField('nom', 'Petit');
    document.querySelector<HTMLElement>('.fiche-status-chip[data-status="ua"]')!.click();
    await clickSave();
    expect(Storage.loadCollection('pcTacHostages')[0]?.status).toBe('ua');
    await flush();
  });
});
