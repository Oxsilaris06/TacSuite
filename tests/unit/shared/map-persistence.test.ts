/**
 * map-persistence.test.ts — Tests unitaires du socle carto commun
 * `src/shared/map-persistence.ts` (mission R3-c, décision D1 : interface de
 * persistance commune PC-Tac/OI, étape d'architecture avant la machine à
 * gestes commune).
 *
 * Couverture :
 *   - `createLocalStorageAdapter` : enrobe un `Persist`-compatible (mocké
 *     ici, PAS de vrai `localStorage` — le comportement de `Persist`
 *     lui-même est déjà couvert par `tests/unit/pctac/pc-storage.test.ts` et
 *     consorts) ; quota dépassé, écriture en échec, JSON/forme rejetée
 *     (fallback via le validateur), défauts `Array.isArray` pins/shapes.
 *   - `createStoreAdapter` : accesseurs qui jettent (lecture ET écriture) →
 *     capturés, jamais propagés, `onError` invoqué ; `onError` par défaut
 *     (`console.warn`) si omis ; lecture nominale inchangée.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createLocalStorageAdapter,
    createStoreAdapter,
    type MapPersistenceErrorInfo,
} from '../../../src/shared/map-persistence.js';
import type { PersistContract, PersistGetOptions, PersistWriteResult } from '../../../src/shared/types/contracts.js';

interface FakePin { id: string; label: string }
interface FakeShape { id: string; kind: string }
interface FakeView { center: [number, number]; zoom: number }

/** Mock `Persist`-compatible : un magasin en mémoire + des leviers pour
 * simuler quota dépassé / échec d'écriture / JSON corrompu, sans jamais
 * toucher le vrai `localStorage` (mission R3-c : "adapter localStorage :
 * quota/corruption via mock Persist"). */
function makeMockPersist(): PersistContract & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
        store,
        get<T = unknown>(key: string, opts: PersistGetOptions<T> = {}): T {
            if (!store.has(key)) return opts.fallback as T;
            const raw = store.get(key);
            if (opts.validator && opts.validator(raw) === false) return opts.fallback as T;
            return raw as T;
        },
        set(key: string, value: unknown): PersistWriteResult {
            store.set(key, value);
            return { ok: true };
        },
        getRaw(key: string): string | null {
            return store.has(key) ? JSON.stringify(store.get(key)) : null;
        },
        setRaw(key: string, str: string): PersistWriteResult {
            store.set(key, str);
            return { ok: true };
        },
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('createLocalStorageAdapter — lecture (loadPins/loadShapes/loadView)', () => {
    it('loadPins : délègue à persist.get(keys.pins, { validator: Array.isArray, fallback: [] })', () => {
        const persist = makeMockPersist();
        persist.store.set('pins-key', [{ id: 'p1', label: 'A' }]);
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.loadPins()).toEqual([{ id: 'p1', label: 'A' }]);
    });

    it('loadPins : clé absente ⇒ []', () => {
        const persist = makeMockPersist();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.loadPins()).toEqual([]);
    });

    it('loadPins : valeur stockée non-tableau ⇒ [] (validateur Array.isArray par défaut rejette)', () => {
        const persist = makeMockPersist();
        persist.store.set('pins-key', { not: 'an array' });
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.loadPins()).toEqual([]);
    });

    it('loadShapes : même contrat que loadPins (clé shapes)', () => {
        const persist = makeMockPersist();
        persist.store.set('shapes-key', [{ id: 's1', kind: 'line' }]);
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.loadShapes()).toEqual([{ id: 's1', kind: 'line' }]);
    });

    it('loadShapes : valeur non-tableau ⇒ []', () => {
        const persist = makeMockPersist();
        persist.store.set('shapes-key', 'corrompu');
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.loadShapes()).toEqual([]);
    });

    it('loadView : clé absente ⇒ null (PAS de défaut applicatif — laissé à l\'appelant)', () => {
        const persist = makeMockPersist();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.loadView()).toBeNull();
    });

    it('loadView : valeur présente ⇒ retournée telle quelle (aucun validateur par défaut)', () => {
        const persist = makeMockPersist();
        persist.store.set('view-key', { center: [1, 2], zoom: 8 });
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.loadView()).toEqual({ center: [1, 2], zoom: 8 });
    });

    it('loadView : validateur explicite fourni ⇒ appliqué (rejet ⇒ null)', () => {
        const persist = makeMockPersist();
        persist.store.set('view-key', { center: 'invalide', zoom: 8 });
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        }, {
            validators: { view: (v): boolean => !!v && Array.isArray((v as FakeView).center) },
        });

        expect(adapter.loadView()).toBeNull();
    });
});

describe('createLocalStorageAdapter — écriture (savePins/saveShapes/saveView)', () => {
    it('savePins : succès ⇒ true, aucun onError invoqué', () => {
        const persist = makeMockPersist();
        const onError = vi.fn();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        }, { onError });

        expect(adapter.savePins([{ id: 'p1', label: 'A' }])).toBe(true);
        expect(persist.store.get('pins-key')).toEqual([{ id: 'p1', label: 'A' }]);
        expect(onError).not.toHaveBeenCalled();
    });

    it('savePins : quota dépassé ({ok:false, quota:true}) ⇒ false + onError({ op: "savePins", error }) — ne jette jamais', () => {
        const persist = makeMockPersist();
        persist.set = vi.fn(() => ({ ok: false, quota: true }) as PersistWriteResult);
        const onError = vi.fn();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        }, { onError });

        let result: boolean | undefined;
        expect(() => { result = adapter.savePins([{ id: 'p1', label: 'A' }]); }).not.toThrow();

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
        const info = onError.mock.calls[0]?.[0] as MapPersistenceErrorInfo;
        expect(info.op).toBe('savePins');
        expect(info.error).toBeInstanceOf(Error);
    });

    it('savePins : échec avec Error explicite ⇒ false + onError reçoit CETTE erreur', () => {
        const persist = makeMockPersist();
        const boom = new Error('stockage indisponible');
        persist.set = vi.fn(() => ({ ok: false, error: boom }) as PersistWriteResult);
        const onError = vi.fn();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        }, { onError });

        expect(adapter.savePins([])).toBe(false);
        expect(onError).toHaveBeenCalledWith({ op: 'savePins', error: boom });
    });

    it('savePins : échec SANS onError fourni ⇒ ne jette pas (callback optionnel)', () => {
        const persist = makeMockPersist();
        persist.set = vi.fn(() => ({ ok: false, quota: true }) as PersistWriteResult);
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(() => adapter.savePins([])).not.toThrow();
        expect(adapter.savePins([])).toBe(false);
    });

    it('saveShapes : même contrat que savePins (clé shapes, op "saveShapes")', () => {
        const persist = makeMockPersist();
        persist.set = vi.fn(() => ({ ok: false, quota: true }) as PersistWriteResult);
        const onError = vi.fn();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        }, { onError });

        expect(adapter.saveShapes([{ id: 's1', kind: 'line' }])).toBe(false);
        expect(onError).toHaveBeenCalledWith({ op: 'saveShapes', error: expect.any(Error) });
    });

    it('saveView : succès ⇒ true, écrit sous keys.view', () => {
        const persist = makeMockPersist();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        });

        expect(adapter.saveView({ center: [1, 2], zoom: 5 })).toBe(true);
        expect(persist.store.get('view-key')).toEqual({ center: [1, 2], zoom: 5 });
    });

    it('saveView : échec ⇒ false + onError op "saveView"', () => {
        const persist = makeMockPersist();
        persist.set = vi.fn(() => ({ ok: false, quota: true }) as PersistWriteResult);
        const onError = vi.fn();
        const adapter = createLocalStorageAdapter<FakePin, FakeShape, FakeView>(persist, {
            pins: 'pins-key', shapes: 'shapes-key', view: 'view-key',
        }, { onError });

        expect(adapter.saveView({ center: [1, 2], zoom: 5 })).toBe(false);
        expect(onError).toHaveBeenCalledWith({ op: 'saveView', error: expect.any(Error) });
    });
});

describe('createStoreAdapter — lecture (loadPins/loadShapes/loadView) : filet try/catch absent côté OI avant R3-c', () => {
    it('loadPins : accesseur retourne une valeur ⇒ retournée telle quelle, pas d\'onError', () => {
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => [{ id: 'p1', label: 'A' }],
            setPins: vi.fn(),
            getShapes: () => [],
            setShapes: vi.fn(),
            getView: () => null,
            setView: vi.fn(),
        }, { onError });

        expect(adapter.loadPins()).toEqual([{ id: 'p1', label: 'A' }]);
        expect(onError).not.toHaveBeenCalled();
    });

    it('loadPins : accesseur retourne null/undefined ⇒ [] (fallback neutre, PAS une erreur)', () => {
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => undefined,
            setPins: vi.fn(),
            getShapes: () => null,
            setShapes: vi.fn(),
            getView: () => null,
            setView: vi.fn(),
        }, { onError });

        expect(adapter.loadPins()).toEqual([]);
        expect(adapter.loadShapes()).toEqual([]);
        expect(onError).not.toHaveBeenCalled();
    });

    it('loadPins : accesseur JETTE ⇒ capturé, [] retourné, onError({ op: "loadPins", error }) invoqué — NOUVEAU filet (comble l\'absence de garde côté OI)', () => {
        const boom = new Error('Store indisponible');
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => { throw boom; },
            setPins: vi.fn(),
            getShapes: () => [],
            setShapes: vi.fn(),
            getView: () => null,
            setView: vi.fn(),
        }, { onError });

        let result: FakePin[] | undefined;
        expect(() => { result = adapter.loadPins(); }).not.toThrow();

        expect(result).toEqual([]);
        expect(onError).toHaveBeenCalledWith({ op: 'loadPins', error: boom });
    });

    it('loadShapes : accesseur jette ⇒ capturé, [] retourné, onError op "loadShapes"', () => {
        const boom = new Error('proxy cassé');
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => [],
            setPins: vi.fn(),
            getShapes: () => { throw boom; },
            setShapes: vi.fn(),
            getView: () => null,
            setView: vi.fn(),
        }, { onError });

        expect(adapter.loadShapes()).toEqual([]);
        expect(onError).toHaveBeenCalledWith({ op: 'loadShapes', error: boom });
    });

    it('loadView : accesseur jette ⇒ capturé, null retourné (PAS []), onError op "loadView"', () => {
        const boom = new Error('formData absent');
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => [],
            setPins: vi.fn(),
            getShapes: () => [],
            setShapes: vi.fn(),
            getView: () => { throw boom; },
            setView: vi.fn(),
        }, { onError });

        expect(adapter.loadView()).toBeNull();
        expect(onError).toHaveBeenCalledWith({ op: 'loadView', error: boom });
    });
});

describe('createStoreAdapter — écriture (savePins/saveShapes/saveView)', () => {
    it('savePins : accesseur réussit ⇒ true, appelé avec les pins fournis, pas d\'onError', () => {
        const setPins = vi.fn();
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => [],
            setPins,
            getShapes: () => [],
            setShapes: vi.fn(),
            getView: () => null,
            setView: vi.fn(),
        }, { onError });

        const pins = [{ id: 'p1', label: 'A' }];
        expect(adapter.savePins(pins)).toBe(true);
        expect(setPins).toHaveBeenCalledWith(pins);
        expect(onError).not.toHaveBeenCalled();
    });

    it('savePins : accesseur JETTE ⇒ capturé, false retourné, onError op "savePins" — ne jette jamais', () => {
        const boom = new Error('écriture refusée');
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => [],
            setPins: () => { throw boom; },
            getShapes: () => [],
            setShapes: vi.fn(),
            getView: () => null,
            setView: vi.fn(),
        }, { onError });

        let result: boolean | undefined;
        expect(() => { result = adapter.savePins([]); }).not.toThrow();

        expect(result).toBe(false);
        expect(onError).toHaveBeenCalledWith({ op: 'savePins', error: boom });
    });

    it('saveShapes : accesseur jette ⇒ false + onError op "saveShapes"', () => {
        const boom = new Error('boom');
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => [],
            setPins: vi.fn(),
            getShapes: () => [],
            setShapes: () => { throw boom; },
            getView: () => null,
            setView: vi.fn(),
        }, { onError });

        expect(adapter.saveShapes([])).toBe(false);
        expect(onError).toHaveBeenCalledWith({ op: 'saveShapes', error: boom });
    });

    it('saveView : accesseur jette ⇒ false + onError op "saveView"', () => {
        const boom = new Error('boom');
        const onError = vi.fn();
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => [],
            setPins: vi.fn(),
            getShapes: () => [],
            setShapes: vi.fn(),
            getView: () => null,
            setView: () => { throw boom; },
        }, { onError });

        expect(adapter.saveView({ center: [1, 2], zoom: 5 })).toBe(false);
        expect(onError).toHaveBeenCalledWith({ op: 'saveView', error: boom });
    });
});

describe('createStoreAdapter — onError par défaut (aucun fourni à la fabrique)', () => {
    it('accesseur qui jette, SANS onError fourni ⇒ ne jette pas, journalise via console.warn (TODO toast futur)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const boom = new Error('Store indisponible');
        const adapter = createStoreAdapter<FakePin, FakeShape, FakeView>({
            getPins: () => { throw boom; },
            setPins: vi.fn(),
            getShapes: () => [],
            setShapes: vi.fn(),
            getView: () => null,
            setView: vi.fn(),
        });

        expect(() => adapter.loadPins()).not.toThrow();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0]?.[0])).toContain('loadPins');
    });
});
