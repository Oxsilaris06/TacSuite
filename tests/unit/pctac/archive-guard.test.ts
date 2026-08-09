/**
 * archive-guard.test.ts — Verrou de non-régression sur la garde de sécurité
 * de `Archive.importFile` (archive.js:129-147 → archive.ts:219-237).
 *
 * Contexte : mission P2BIS.FIX (clôture Phase 2 du portage TacSuite). Point
 * de contrôle demandé séparément de tests/unit/pctac/pc-archive.test.ts,
 * qui couvre déjà ce cas parmi d'autres — ce fichier isole SPÉCIFIQUEMENT
 * la garde « manifest.appName !== 'PC TAC' » pour qu'une régression future
 * (ex. re-neutralisation accidentelle pendant un refactor) échoue vite et
 * clairement, sans dépendre du reste de la suite archive.
 *
 * Garde vérifiée (archive.ts:230-237, identique à archive.js:140-147) :
 *   const appName = manifest && manifest.appName;
 *   if (appName !== 'PC TAC') { throw new Error(...); }
 * → rejet AVANT toute écriture localStorage/IndexedDB (aucun wipe partiel).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { ADVERSARIES_KEY } from '@pctac/config.js';

// ImageStore : indexedDB absent sous jsdom → mock en mémoire (même pattern
// que pc-archive.test.ts).
const imageStoreState = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@pctac/image-store.js', () => {
  const { store } = imageStoreState;
  return {
    ImageStore: {
      async put(id: string, dataUrl: string): Promise<void> { if (id && dataUrl) store.set(id, dataUrl); },
      async get(id: string): Promise<string | null> { return store.has(id) ? (store.get(id) ?? null) : null; },
      async getMany(ids: readonly string[]): Promise<Record<string, string | null>> {
        const out: Record<string, string | null> = {};
        ids.forEach((id) => { out[id] = store.has(id) ? (store.get(id) ?? null) : null; });
        return out;
      },
      async delete(id: string): Promise<void> { store.delete(id); },
      async deleteMany(ids: readonly string[]): Promise<void> { ids.forEach((id) => store.delete(id)); },
      async clear(): Promise<void> { store.clear(); },
      async migrateFromLocalStorage(): Promise<void> {},
      async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
    },
  };
});

// R2-T2a : `confirm()`/`alert()` natifs → `confirmDialog`/`toast`
// (`@shared/feedback.js`, mocké). `confirmSpy` résout `true` par défaut
// (équivalent de l'ancien `vi.stubGlobal('confirm', vi.fn(() => true))`).
const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({
  confirmDialog: confirmSpy,
  toast: toastSpy,
}));

import { Archive } from '@pctac/archive.js';
import { ImageStore } from '@pctac/image-store.js';
import { Storage } from '@pctac/storage.js';

function dumpLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k != null) out[k] = localStorage.getItem(k) ?? '';
  }
  return out;
}

async function buildZip(manifest: Record<string, unknown> | null, data: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  if (manifest !== null) zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('data.json', JSON.stringify(data));
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buf], 'test.pctac.zip');
}

beforeEach(() => {
  localStorage.clear();
  imageStoreState.store.clear();
  confirmSpy.mockClear();
  confirmSpy.mockImplementation(async () => true);
  toastSpy.mockClear();
});

describe('Archive.importFile — garde de sécurité manifest.appName (archive.js:140-147)', () => {
  it('REJETTE une archive dont le manifest.appName est différent de "PC TAC", sans écrire quoi que ce soit', async () => {
    // État "terrain" avant tentative d'import — doit rester intact.
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'field1', nom: 'Existant' }]);
    await ImageStore.put('field1', 'data:image/png;base64,ZZZZ');
    const beforeLs = dumpLocalStorage();

    const file = await buildZip({ appName: 'OI', version: 1 }, { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'intruder' }]) });

    await expect(Archive.importFile(file)).rejects.toThrow(/OI/);

    // Aucune écriture : ni localStorage, ni IndexedDB.
    expect(dumpLocalStorage()).toEqual(beforeLs);
    expect(await ImageStore.get('field1')).toBe('data:image/png;base64,ZZZZ');
    expect(Storage.loadCollection(ADVERSARIES_KEY)).toEqual([{ id: 'field1', nom: 'Existant' }]);
  });

  it('REJETTE une archive sans manifest.appName (champ absent), sans écrire quoi que ce soit', async () => {
    const beforeLs = dumpLocalStorage();
    const file = await buildZip({ version: 1 }, { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'intruder' }]) });

    await expect(Archive.importFile(file)).rejects.toThrow(/appName/);
    expect(dumpLocalStorage()).toEqual(beforeLs);
  });

  it('ACCEPTE une archive dont le manifest.appName vaut exactement "PC TAC" et importe les données', async () => {
    const file = await buildZip(
      { appName: 'PC TAC', version: 1, createdAt: new Date().toISOString() },
      { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'from-archive', nom: 'Importé' }]) }
    );

    const result = await Archive.importFile(file);

    expect(result).toEqual({ ok: true });
    expect(Storage.loadCollection(ADVERSARIES_KEY)).toEqual([{ id: 'from-archive', nom: 'Importé' }]);
  });
});
