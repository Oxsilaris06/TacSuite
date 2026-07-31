/**
 * setup.ts — Configuration globale Vitest (environnement jsdom).
 * =================================================================
 *
 * Polyfill `localStorage` / `sessionStorage`.
 *
 * Contexte : Node ≥22 expose un `localStorage` NATIF sur `globalThis` (getter
 * paresseux nécessitant le flag CLI `--localstorage-file` ; sans lui, l'accès
 * renvoie `undefined` + un warning expérimental). La fonction interne de
 * Vitest qui recopie les globals de jsdom vers `globalThis`
 * (`populateGlobal`) ne réécrit QUE les clés déjà connues d'une liste fixe —
 * qui n'inclut PAS `localStorage`/`sessionStorage`. Résultat : le getter natif
 * (non fonctionnel ici) masque l'implémentation jsdom (fonctionnelle) au lieu
 * d'être remplacé par elle.
 *
 * On installe donc un `Storage` minimal, en mémoire, conforme à l'interface
 * DOM `Storage`, pour que `window.localStorage`/`window.sessionStorage`
 * soient utilisables par tous les tests unitaires (persist.ts et suivants).
 */

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  const storage = {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) ?? null) : null;
    },
    key(index: number): string | null {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(key, String(value));
    },
  };
  return storage as Storage;
}

function installMemoryStorage(name: 'localStorage' | 'sessionStorage'): void {
  Object.defineProperty(globalThis, name, {
    value: createMemoryStorage(),
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

installMemoryStorage('localStorage');
installMemoryStorage('sessionStorage');
