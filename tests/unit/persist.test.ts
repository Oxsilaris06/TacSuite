/**
 * persist.test.ts — Comportement OBSERVÉ de `modules/pctac/persist.js`
 * (GStart-main, 258 LOC), couche de persistance localStorage transactionnelle
 * et standalone (zéro import) qui sert de socle "Fondations" à PC-Tac.
 *
 * Écrit AVANT `src/shared/persist.ts` (TDD, mission P1.A1). Chaque cas
 * reproduit un comportement RÉEL relevé sur le code source original
 * (références `persist.js:<ligne>` en commentaire), pas une supposition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Persist from '../../src/shared/persist.js';
import type { PersistWriteResult } from '../../src/shared/types/contracts.js';

/** Objet avec une référence circulaire : fait jeter `JSON.stringify`. */
function circular(): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  o.self = o;
  return o;
}

/**
 * Simule un `window.localStorage` totalement inaccessible (mode privé,
 * stockage désactivé, sandbox) : la simple LECTURE de `window.localStorage`
 * jette, comme documenté par `getStore()` (persist.js:34-44).
 */
function withUnavailableStorage(run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get(): Storage {
      throw new Error('SecurityError: localStorage indisponible');
    },
  });
  try {
    run();
  } finally {
    if (descriptor) {
      Object.defineProperty(window, 'localStorage', descriptor);
    }
  }
}

/** Extrait `error` d'un `PersistWriteResult` en échec non-quota, ou échoue le test. */
function expectErrorResult(result: PersistWriteResult): Error {
  if (result.ok) throw new Error('résultat attendu en échec (ok:false)');
  if ('quota' in result) throw new Error('résultat attendu en erreur, pas en quota');
  return result.error;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Persist.getRaw', () => {
  it('retourne null si la clé est absente (persist.js:221-229)', () => {
    expect(Persist.getRaw('inconnue')).toBeNull();
  });

  it('retourne la chaîne brute exacte, sans tenter de JSON.parse', () => {
    window.localStorage.setItem('k', 'pas-du-json-{{{');
    expect(Persist.getRaw('k')).toBe('pas-du-json-{{{');
  });

  it('retourne null si localStorage est totalement indisponible', () => {
    withUnavailableStorage(() => {
      expect(Persist.getRaw('k')).toBeNull();
    });
  });

  it('retourne null si getItem jette (quota/permissions)', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(Persist.getRaw('k')).toBeNull();
  });
});

describe('Persist.setRaw', () => {
  it('écrit la chaîne telle quelle (pas de JSON.stringify) et renvoie {ok:true}', () => {
    const result = Persist.setRaw('k', 'valeur-brute');
    expect(result).toEqual({ ok: true });
    expect(window.localStorage.getItem('k')).toBe('valeur-brute');
  });

  it('renvoie {ok:false, error} si localStorage est indisponible, sans écrire', () => {
    withUnavailableStorage(() => {
      const result = Persist.setRaw('k', 'v');
      const error = expectErrorResult(result);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('localStorage indisponible');
    });
  });

  const quotaShapes: Array<[string, Record<string, unknown>]> = [
    ['QuotaExceededError (name, DOMException standard)', { name: 'QuotaExceededError' }],
    ['NS_ERROR_DOM_QUOTA_REACHED (name, Firefox)', { name: 'NS_ERROR_DOM_QUOTA_REACHED' }],
    ['code 22 (legacy)', { code: 22 }],
    ['code 1014 (ancien Firefox)', { code: 1014 }],
  ];

  it.each(quotaShapes)(
    'détecte le quota dépassé — %s — sans jeter (persist.js:53-61)',
    (_label, shape) => {
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw Object.assign(new Error('quota'), shape);
      });
      const result = Persist.setRaw('k', 'v');
      expect(result).toEqual({ ok: false, quota: true });
    },
  );

  it("émet un CustomEvent window 'pctac:quota' avec detail.key à la clé concernée (persist.js:91-105)", () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    const handler = vi.fn();
    window.addEventListener('pctac:quota', handler);

    Persist.setRaw('ma-cle', 'v');

    expect(handler).toHaveBeenCalledTimes(1);
    const call = handler.mock.calls[0] as [CustomEvent<{ key: string; estimate: unknown }>];
    expect(call[0].detail.key).toBe('ma-cle');
    expect(call[0].detail.estimate).toBeNull();

    window.removeEventListener('pctac:quota', handler);
  });

  it("une erreur d'écriture NON liée au quota renvoie {ok:false, error} sans émettre 'pctac:quota'", () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('disque plein, pas un quota navigateur');
    });
    const handler = vi.fn();
    window.addEventListener('pctac:quota', handler);

    const result = Persist.setRaw('k', 'v');

    expect(result.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('pctac:quota', handler);
  });

  it("complète detail.estimate a posteriori si navigator.storage.estimate répond (persist.js:70-83)", async () => {
    const fakeEstimate = { usage: 123, quota: 456 } as StorageEstimate;
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: (): Promise<StorageEstimate> => Promise.resolve(fakeEstimate) },
    });

    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });

    const handler = vi.fn();
    window.addEventListener('pctac:quota', handler);

    Persist.setRaw('k', 'v');
    // Laisse la micro/macrotâche de navigator.storage.estimate() se résoudre.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const call = handler.mock.calls[0] as [CustomEvent<{ key: string; estimate: unknown }>];
    expect(call[0].detail.estimate).toEqual(fakeEstimate);

    window.removeEventListener('pctac:quota', handler);
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'storage', originalDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'storage');
    }
  });
});

describe('Persist.set', () => {
  it('sérialise en JSON et stocke, renvoie {ok:true} (persist.js:200-214)', () => {
    const value = { a: 1, b: ['x', 'y'], c: null };
    const result = Persist.set('obj', value);
    expect(result).toEqual({ ok: true });
    expect(window.localStorage.getItem('obj')).toBe(JSON.stringify(value));
  });

  it('valeur non sérialisable (référence circulaire) : {ok:false, error}, rien n’est écrit', () => {
    const result = Persist.set('circ', circular());
    const error = expectErrorResult(result);
    expect(error).toBeInstanceOf(Error);
    expect(window.localStorage.getItem('circ')).toBeNull();
  });

  it('set(key, undefined) ne jette pas : localStorage stocke la chaîne "undefined" (JSON.stringify(undefined) === undefined)', () => {
    const result = Persist.set('k', undefined);
    expect(result).toEqual({ ok: true });
    expect(window.localStorage.getItem('k')).toBe('undefined');
  });

  it('délègue à setRaw pour la détection de quota (même contrat, persist.js:213)', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    const result = Persist.set('k', { any: 'value' });
    expect(result).toEqual({ ok: false, quota: true });
  });

  it("renvoie {ok:false, error:'localStorage indisponible'} si le storage est indisponible", () => {
    withUnavailableStorage(() => {
      const result = Persist.set('k', { a: 1 });
      const error = expectErrorResult(result);
      expect(error.message).toBe('localStorage indisponible');
    });
  });
});

describe('Persist.get', () => {
  it('clé absente sans opts → null (fallback par défaut, persist.js:147)', () => {
    expect(Persist.get('absente')).toBeNull();
  });

  it('clé absente avec fallback fourni → fallback, sans backup (persist.js:160)', () => {
    const result = Persist.get<number[]>('absente', { fallback: [] });
    expect(result).toEqual([]);
    expect(window.localStorage.getItem('absente.bak')).toBeNull();
  });

  it('JSON valide sans validateur → valeur désérialisée', () => {
    window.localStorage.setItem('k', JSON.stringify({ x: 1 }));
    expect(Persist.get('k')).toEqual({ x: 1 });
  });

  it('validateur qui accepte (ex: Array.isArray) → valeur désérialisée', () => {
    window.localStorage.setItem('k', JSON.stringify([1, 2, 3]));
    const result = Persist.get<number[]>('k', { validator: Array.isArray, fallback: [] });
    expect(result).toEqual([1, 2, 3]);
  });

  it("JSON corrompu → fallback + sauvegarde brute dans '<clé>.bak' (persist.js:162-169)", () => {
    window.localStorage.setItem('k', '{corrompu');
    const result = Persist.get('k', { fallback: 'x' });
    expect(result).toBe('x');
    expect(window.localStorage.getItem('k.bak')).toBe('{corrompu');
  });

  it("validateur retourne strictement false → fallback + '<clé>.bak' (persist.js:174-186)", () => {
    window.localStorage.setItem('k', JSON.stringify({ notAnArray: true }));
    const result = Persist.get('k', { validator: Array.isArray, fallback: [] });
    expect(result).toEqual([]);
    expect(window.localStorage.getItem('k.bak')).toBe(JSON.stringify({ notAnArray: true }));
  });

  it('validateur retourne undefined (pas strictement false) → PAS un rejet, valeur conservée (persist.js:171-173)', () => {
    window.localStorage.setItem('k', JSON.stringify({ x: 1 }));
    const result = Persist.get('k', {
      validator: () => undefined as unknown as boolean,
      fallback: 'fallback',
    });
    expect(result).toEqual({ x: 1 });
    expect(window.localStorage.getItem('k.bak')).toBeNull();
  });

  it('validateur qui jette → traité comme un rejet (backup + fallback, persist.js:176-181)', () => {
    window.localStorage.setItem('k', JSON.stringify({ x: 1 }));
    const result = Persist.get('k', {
      validator: () => {
        throw new Error('validateur cassé');
      },
      fallback: 'fallback',
    });
    expect(result).toBe('fallback');
    expect(window.localStorage.getItem('k.bak')).toBe(JSON.stringify({ x: 1 }));
  });

  it('localStorage indisponible → fallback, sans jeter', () => {
    withUnavailableStorage(() => {
      const result = Persist.get('k', { fallback: 'x' });
      expect(result).toBe('x');
    });
  });

  it('getItem jette → fallback, sans jeter', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    const result = Persist.get('k', { fallback: 'x' });
    expect(result).toBe('x');
  });
});

describe('Persist — export', () => {
  it('expose un export nommé ET un export par défaut identiques (persist.js:130,258)', async () => {
    const mod = await import('../../src/shared/persist.js');
    expect(mod.Persist).toBe(mod.default);
    expect(Persist).toBe(mod.Persist);
  });
});
