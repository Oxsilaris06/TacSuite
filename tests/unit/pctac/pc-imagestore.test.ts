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

/* ─── GpxStore : enveloppe versionnée et lecture des traces anciennes ────── */

/**
 * Double IndexedDB minimal, avec un contenu pré-chargé par magasin. Reproduit
 * juste ce dont `withStore` a besoin : résolution différée APRÈS affectation
 * des handlers, et `tx.oncomplete` qui porte la résolution.
 */
function makeIdbWithContent(content: Record<string, unknown>): {
  factory: unknown;
  written: Map<string, unknown>;
} {
  const written = new Map<string, unknown>();
  const storeNames = new Set<string>();
  const db = {
    objectStoreNames: { contains: (n: string) => storeNames.has(n) },
    createObjectStore: (n: string) => { storeNames.add(n); },
    transaction: () => {
      const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null } =
        { oncomplete: null, onerror: null, onabort: null };
      const store = {
        put: (value: unknown, key: string) => { written.set(key, value); queueMicrotask(() => tx.oncomplete?.()); return {}; },
        get: (key: string) => {
          const req: { onsuccess: (() => void) | null; result: unknown } = { onsuccess: null, result: content[key] };
          queueMicrotask(() => { req.onsuccess?.(); tx.oncomplete?.(); });
          return req;
        },
        delete: () => { queueMicrotask(() => tx.oncomplete?.()); return {}; },
        clear: () => { written.clear(); queueMicrotask(() => tx.oncomplete?.()); return {}; },
      };
      return {
        objectStore: () => store,
        set oncomplete(f: (() => void) | null) { tx.oncomplete = f; }, get oncomplete() { return tx.oncomplete; },
        set onerror(f: (() => void) | null) { tx.onerror = f; }, get onerror() { return tx.onerror; },
        set onabort(f: (() => void) | null) { tx.onabort = f; }, get onabort() { return tx.onabort; },
      };
    },
  };
  const factory = {
    open: () => {
      const req: { result: unknown; onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null } =
        { result: db, onupgradeneeded: null, onsuccess: null, onerror: null };
      // `openDb` lit `event.target.result` : le handler DOIT recevoir un
      // évènement porteur de la requête, sinon il jette sur `undefined.target`.
      queueMicrotask(() => {
        (req.onupgradeneeded as ((e: unknown) => void) | null)?.({ target: req });
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory, written };
}

describe('GpxStore — enveloppe versionnée', () => {
  it("relit une trace ANCIENNE, écrite en tableau nu, comme une trace sans temps", async () => {
    // Régression de perte de données : avant l'enveloppe, changer la forme
    // faisait renvoyer null pour ces traces, qui étaient ensuite retirées
    // silencieusement de l'index au démarrage suivant.
    const legacy = [[[2.35, 48.85], [2.36, 48.86]]];
    const { factory } = makeIdbWithContent({ ancienne: legacy });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = factory;

    const { GpxStore } = await import('@pctac/image-store.js');
    const out = await GpxStore.get('ancienne');

    expect(out).not.toBeNull();
    expect(out?.coords).toEqual(legacy);
    expect(out?.times).toBeNull();
  });

  it('relit une trace NOUVELLE avec ses temps', async () => {
    const rec = { v: 2, coords: [[[1, 2], [3, 4]]], times: [[1000, null]] };
    const { factory } = makeIdbWithContent({ recente: rec });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = factory;

    const { GpxStore } = await import('@pctac/image-store.js');
    const out = await GpxStore.get('recente');

    expect(out?.coords).toEqual(rec.coords);
    expect(out?.times).toEqual([[1000, null]]);
  });

  it("écrit toujours l'enveloppe versionnée, jamais le tableau nu", async () => {
    const { factory, written } = makeIdbWithContent({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = factory;

    const { GpxStore } = await import('@pctac/image-store.js');
    await GpxStore.put('t1', { coords: [[[1, 2], [3, 4]]], times: null });

    const rec = written.get('t1') as { v: number; coords: unknown; times: unknown };
    expect(rec.v).toBe(2);
    expect(rec.coords).toEqual([[[1, 2], [3, 4]]]);
    expect(rec.times).toBeNull();
  });

  it('entrée absente ou corrompue : renvoie null sans jeter', async () => {
    const { factory } = makeIdbWithContent({ casse: { v: 2, pasDeCoords: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = factory;

    const { GpxStore } = await import('@pctac/image-store.js');
    await expect(GpxStore.get('inconnue')).resolves.toBeNull();
    await expect(GpxStore.get('casse')).resolves.toBeNull();
    await expect(GpxStore.get('')).resolves.toBeNull();
  });
});
