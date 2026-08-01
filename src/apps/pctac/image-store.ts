/**
 * Stockage des images en IndexedDB pour PC TAC.
 *
 * Pourquoi : localStorage est limité à ~5-10 Mo et se sature vite avec des
 * photos base64. IndexedDB offre plusieurs centaines de Mo et survit aux
 * écritures concurrentes. Les métadonnées (titre, catégorie, statut, lien
 * adversaire/otage) restent en localStorage ; seuls les data URLs migrent.
 */

import type { ImageStoreContract } from '@shared/types/contracts.js';

const DB_NAME = 'pcTacImages';
const STORE = 'images';
const VERSION = 1;
const MIGRATION_FLAG = 'pcTacIdbMigratedV1';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Ouvre la base IndexedDB, initialisée une seule fois et mise en cache.
 * Création du store à l'`onupgradeneeded` si la base est nouvelle.
 *
 * imageStore.js:17-30
 */
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = (event): void => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = (): void => {
        resolve(req.result);
      };
      req.onerror = (): void => {
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

/**
 * Utilitaire d'exécution d'opération dans une transaction.
 * CRITIQUE : la promesse doit résoudre sur `tx.oncomplete`, PAS sur `req.onsuccess`.
 * C'est ce qui garantit la durabilité : les données sont écrites sur le disque
 * au commit de la transaction, pas au succès de l'opération locale.
 *
 * imageStore.js:32-42
 */
function withStore(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => unknown,
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        try {
          fn(store);
        } catch (e) {
          return reject(e);
        }
        tx.oncomplete = (): void => {
          resolve();
        };
        tx.onerror = (): void => {
          reject(tx.error);
        };
        tx.onabort = (): void => {
          reject(tx.error);
        };
      }),
  );
}

/**
 * Contrat public du stockage des images.
 */
export const ImageStore: ImageStoreContract = {
  /**
   * Enregistre une image par son id.
   * No-op si `id` ou `dataUrl` est falsy.
   *
   * imageStore.js:45-48
   */
  async put(id: string, dataUrl: string): Promise<void> {
    if (!id || !dataUrl) return;
    await withStore('readwrite', (store) => store.put(dataUrl, id));
  },

  /**
   * Récupère une image par son id.
   * Retourne `null` si l'id est falsy ou si la clé n'existe pas.
   *
   * imageStore.js:50-59
   */
  async get(id: string): Promise<string | null> {
    if (!id) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = (): void => {
        resolve((req.result as string | undefined) ?? null);
      };
      req.onerror = (): void => {
        reject(req.error);
      };
    });
  },

  /**
   * Récupère plusieurs images par leurs ids en parallèle.
   * Retourne un dictionnaire `id → dataUrl | null`.
   * Si `ids` est vide, retourne `{}`.
   *
   * imageStore.js:61-78
   */
  async getMany(ids: readonly string[]): Promise<Record<string, string | null>> {
    if (!ids || !ids.length) return {};
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const out: Record<string, string | null> = {};
      let pending = ids.length;
      ids.forEach((id) => {
        const req = store.get(id);
        req.onsuccess = (): void => {
          out[id] = (req.result as string | undefined) ?? null;
          if (--pending === 0) {
            resolve(out);
          }
        };
        req.onerror = (): void => {
          reject(req.error);
        };
      });
    });
  },

  /**
   * Supprime une image par son id.
   * No-op si `id` est falsy.
   *
   * imageStore.js:80-83
   */
  async delete(id: string): Promise<void> {
    if (!id) return;
    await withStore('readwrite', (store) => store.delete(id));
  },

  /**
   * Supprime plusieurs images à la fois.
   * No-op si `ids` est vide.
   *
   * imageStore.js:85-88
   */
  async deleteMany(ids: readonly string[]): Promise<void> {
    if (!ids || !ids.length) return;
    await withStore('readwrite', (store) => {
      ids.forEach((id) => store.delete(id));
      return undefined;
    });
  },

  /**
   * Vide tout le store.
   *
   * imageStore.js:90-92
   */
  async clear(): Promise<void> {
    await withStore('readwrite', (store) => store.clear());
  },

  /**
   * Migration unique : déplace les data URLs des collections localStorage
   * vers IndexedDB, en utilisant l'id de l'item comme clé.
   *
   * Effectue une migration unique, gardée par le flag 'pcTacIdbMigratedV1'.
   * Pose le flag MÊME si rien n'a migré (garantit qu'on ne refait pas la
   * tentative au prochain démarrage, même en cas d'absence totale de données).
   *
   * Les 3 collections ciblées :
   * - `pcTacPhotos` : field `data`
   * - `pcTacAdversaries` : field `photo`
   * - `pcTacHostages` : field `photo`
   *
   * imageStore.js:98-140
   */
  async migrateFromLocalStorage(): Promise<void> {
    if (localStorage.getItem(MIGRATION_FLAG)) return;

    const targets = [
      { key: 'pcTacPhotos', field: 'data' },
      { key: 'pcTacAdversaries', field: 'photo' },
      { key: 'pcTacHostages', field: 'photo' },
    ];

    for (const { key, field } of targets) {
      let list: unknown;
      try {
        const raw = localStorage.getItem(key) || '[]';
        list = JSON.parse(raw);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_parseErr) {
        continue;
      }
      if (!Array.isArray(list) || !list.length) continue;

      // Aide TypeScript : list est Array et non-vide après les gardes.
      const items = list as Array<{
        id?: unknown;
        [K: string]: unknown;
      }>;

      let changed = false;
      for (const item of items) {
        const val = (item as Record<string, unknown>)[field];
        if (typeof val === 'string' && val.startsWith('data:')) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await this.put(item.id as any, val);
            delete (item as Record<string, unknown>)[field];
            (item as Record<string, unknown>).hasImage = true;
            changed = true;
          } catch (err) {
            console.error('[ImageStore] migration échec pour', key, item.id, err);
          }
        }
      }
      if (changed) {
        try {
          localStorage.setItem(key, JSON.stringify(items));
        } catch (e) {
          console.error('[ImageStore] resave localStorage échec:', e);
        }
      }
    }

    localStorage.setItem(MIGRATION_FLAG, '1');
  },

  /**
   * Réhydrate une liste d'items en remettant le data URL dans le champ donné.
   * Retourne une NOUVELLE liste, sans muter l'originale.
   *
   * imageStore.js:146-151
   */
  async hydrate<T extends { id: string }>(
    items: T[],
    field: string = 'data',
  ): Promise<T[]> {
    if (!items || items.length === 0) return [];
    const ids = items.map((i) => i.id);
    const imgs = await this.getMany(ids);
    return items.map((i) => {
      const img = imgs[i.id];
      if (img) {
        return { ...i, [field]: img };
      }
      return i;
    });
  },
};

// Pose le global au scope module, comme l'original.
// imageStore.js:154
window.ImageStore = ImageStore;
