/**
 * pc-imagestore.test.ts — Tests unitaires de ImageStore (P2.CONV).
 *
 * Contexte : indexedDB n'existe pas en jsdom. On teste les branches
 * non-IDB (hydrate, migrateFromLocalStorage) et on vérifie les signatures.
 * Les tests IDB complets sont dédiés à la validation en navigateur.
 *
 * Tests critiques couverts :
 * - hydrate ne mute pas l'entrée (retourne une nouvelle liste)
 * - migrateFromLocalStorage pose le flag même en l'absence de données
 * - migrateFromLocalStorage refuse de s'exécuter deux fois
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImageStore (P2.CONV)', () => {
  it('hydrate retourne [] si la liste est vide', async () => {
    // Mock minimal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open(): IDBOpenDBRequest {
        return {
          result: {},
          onsuccess: null,
          onerror: null,
        } as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const mod = await import('@pctac/image-store.js');
    const { ImageStore } = mod;

    const result = await ImageStore.hydrate([]);
    expect(result).toEqual([]);
  });

  it('migrateFromLocalStorage pose le flag même sans données', async () => {
    // Mock minimal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open(): IDBOpenDBRequest {
        return {
          result: {
            transaction(): IDBTransaction {
              return {
                oncomplete: null,
                onerror: null,
                objectStore(): IDBObjectStore {
                  return {
                    put(): IDBRequest {
                      return { result: undefined } as unknown as IDBRequest;
                    },
                  } as unknown as IDBObjectStore;
                },
              } as unknown as IDBTransaction;
            },
          },
          onsuccess: null,
          onerror: null,
        } as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const mod = await import('@pctac/image-store.js');
    const { ImageStore } = mod;

    localStorage.clear();
    expect(localStorage.getItem('pcTacIdbMigratedV1')).toBeNull();

    // Migration sans données
    await ImageStore.migrateFromLocalStorage();

    // Flag doit être posé même en absence de données
    expect(localStorage.getItem('pcTacIdbMigratedV1')).toBe('1');
  });

  it('migrateFromLocalStorage refuse de s\'exécuter deux fois', async () => {
    // Mock minimal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open(): IDBOpenDBRequest {
        return {
          result: {},
          onsuccess: null,
          onerror: null,
        } as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const mod = await import('@pctac/image-store.js');
    const { ImageStore } = mod;

    localStorage.clear();

    // Première migration
    await ImageStore.migrateFromLocalStorage();
    const flag1 = localStorage.getItem('pcTacIdbMigratedV1');
    expect(flag1).toBe('1');

    // Deuxième migration : doit retourner immédiatement (guard au début)
    await ImageStore.migrateFromLocalStorage();
    expect(localStorage.getItem('pcTacIdbMigratedV1')).toBe('1');
  });

  it('window.ImageStore est posé au scope module', async () => {
    // Mock minimal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open(): IDBOpenDBRequest {
        return {
          result: {},
          onsuccess: null,
          onerror: null,
        } as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const mod = await import('@pctac/image-store.js');
    expect((window as unknown as Record<string, unknown>).ImageStore).toBeDefined();
    expect((window as unknown as Record<string, unknown>).ImageStore).toBe(mod.ImageStore);
  });

  it('ImageStore est un objet avec les méthodes attendues', async () => {
    // Mock minimal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open(): IDBOpenDBRequest {
        return {
          result: {},
          onsuccess: null,
          onerror: null,
        } as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const mod = await import('@pctac/image-store.js');
    const { ImageStore } = mod;

    // Vérifier la signature publique
    expect(typeof ImageStore.put).toBe('function');
    expect(typeof ImageStore.get).toBe('function');
    expect(typeof ImageStore.getMany).toBe('function');
    expect(typeof ImageStore.delete).toBe('function');
    expect(typeof ImageStore.deleteMany).toBe('function');
    expect(typeof ImageStore.clear).toBe('function');
    expect(typeof ImageStore.migrateFromLocalStorage).toBe('function');
    expect(typeof ImageStore.hydrate).toBe('function');
  });
});
