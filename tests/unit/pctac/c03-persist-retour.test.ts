/**
 * c03-persist-retour.test.ts — Un `Persist.set` refusé (quota plein) atteint
 * l'appelant ET l'utilisateur : retour `false` + toast d'erreur, jamais de
 * succès silencieux. Couvre tombstones, historique des lieux, associations TP
 * et purge des références après suppression.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PINS_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { scopedKey } from '../../../src/apps/pctac/modes.js';
import { DELETED_KEY } from '../../../src/apps/pctac/config.js';
import { LogManager } from '../../../src/apps/pctac/log-manager.js';
import { Storage } from '../../../src/apps/pctac/storage.js';
import { purgeCollectionImages } from '../../../src/apps/pctac/delete-undo.js';
import { readTombstones, recordTombstone } from '../../../src/apps/pctac/tombstones.js';
import { ADVERSARIES_KEY } from '../../../src/apps/pctac/config.js';
import { Persist } from '../../../src/shared/persist.js';

/** Stockage plein : toute écriture lève un QuotaExceededError. */
function fillStorage() {
  return vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    const err = new Error('quota');
    err.name = 'QuotaExceededError';
    throw err;
  });
}

const toastText = (): string => Array.from(document.querySelectorAll('.tac-toast')).map((t) => t.textContent ?? '').join('|');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordTombstone', () => {
  it('rend true et écrit la pierre quand le stockage répond', () => {
    expect(recordTombstone(ADVERSARIES_KEY, 'x1')).toBe(true);
    expect(readTombstones().map((t) => t.itemId)).toEqual(['x1']);
  });

  it('rend false et prévient l\'utilisateur quand le stockage est plein', () => {
    fillStorage();
    expect(recordTombstone(ADVERSARIES_KEY, 'x1')).toBe(false);
    expect(toastText()).toContain('Stockage plein');
    expect(localStorage.getItem(scopedKey(DELETED_KEY))).toBeNull();
  });
});

describe('LogManager.addLieuToHistory', () => {
  it('rend true quand le lieu est écrit', () => {
    expect(LogManager.addLieuToHistory('Paris')).toBe(true);
    expect(LogManager.getLieuHistory()).toEqual(['Paris']);
  });

  it('rend false et prévient l\'utilisateur quand le stockage est plein', () => {
    fillStorage();
    expect(LogManager.addLieuToHistory('Paris')).toBe(false);
    expect(toastText()).toContain('Stockage plein');
  });
});

describe('Storage.saveTpAssociation', () => {
  it('rend true quand l\'association est écrite', () => {
    expect(Storage.saveTpAssociation('TP1', '#ff0000')).toBe(true);
    expect(Storage.getTpAssociations()).toEqual({ '#ff0000': 'TP1' });
  });

  it('rend false quand le stockage est plein', () => {
    fillStorage();
    expect(Storage.saveTpAssociation('TP1', '#ff0000')).toBe(false);
  });
});

describe('purgeCollectionImages — références de pings', () => {
  it('prévient l\'utilisateur quand le ping nettoyé ne peut pas être réécrit', async () => {
    Persist.set(scopedKey(PINS_KEY), [{ id: 'p1', photoId: 'a1' }]);
    fillStorage();
    await purgeCollectionImages(ADVERSARIES_KEY, 'a1');
    expect(toastText()).toContain('Stockage plein');
  });
});
