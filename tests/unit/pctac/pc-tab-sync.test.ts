/**
 * pc-tab-sync.test.ts — Synchronisation entre onglets (décision 29).
 *
 * `initTabSync()` écoute les `storage` events, les traduit en clés LOGIQUES
 * pour la situation FIGÉE de la page (une clé d'une autre situation est
 * ignorée), annonce un changement de situation distant par un toast sans
 * réorienter l'onglet, et relaie les changements d'image via BroadcastChannel.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ toast: toastSpy }));

import { PCTAC_MODE_KEY, currentModeId, persistModeId } from '@pctac/modes.js';
import { initTabSync, publishImageChange } from '@pctac/tab-sync.js';

/** BroadcastChannel factice : jsdom n'en fournit pas, et on doit pouvoir
 *  déclencher `onmessage` à la main. */
class FakeChannel {
    static instances: FakeChannel[] = [];
    onmessage: ((ev: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    constructor(public name: string) { FakeChannel.instances.push(this); }
    close(): void { /* no-op */ }
}

beforeAll(() => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
});

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    toastSpy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Collecte les `pctac:data` émis pendant le test. */
function collectData(): string[] {
    const keys: string[] = [];
    document.addEventListener('pctac:data', (e) => keys.push(e.detail.key));
    return keys;
}

describe('tab-sync — relais des données', () => {
    it('relaie une clé de la situation courante avec remote:true', () => {
        persistModeId('tp');
        initTabSync();
        const keys = collectData();
        window.dispatchEvent(new StorageEvent('storage', { key: 'pcTacAdversaries@tp', newValue: '[]' }));
        expect(keys).toContain('pcTacAdversaries');
    });

    it('ignore la clé d’une autre situation', () => {
        persistModeId('tp');
        initTabSync();
        const keys = collectData();
        window.dispatchEvent(new StorageEvent('storage', { key: 'pcTacAdversaries@recherche', newValue: '[]' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'pcTacAdversaries', newValue: '[]' }));
        expect(keys).toEqual([]);
    });

    it('relaie une clé commune', () => {
        persistModeId('tp');
        initTabSync();
        const keys = collectData();
        window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'light' }));
        expect(keys).toEqual(['theme']);
    });

    it('en Forcené, relaie la clé nue et ignore une clé suffixée', () => {
        persistModeId('forcene');
        initTabSync();
        const keys = collectData();
        window.dispatchEvent(new StorageEvent('storage', { key: 'pcTacAdversaries', newValue: '[]' }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'pcTacAdversaries@tp', newValue: '[]' }));
        expect(keys).toEqual(['pcTacAdversaries']);
    });

    it('vidage complet (key === null) : un événement par clé logique connue, sans doublon', () => {
        persistModeId('tp');
        initTabSync();
        const keys = collectData();
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
        expect(keys).toContain('pcTacAdversaries');
        expect(keys).toContain('theme');
        expect(keys).toContain(PCTAC_MODE_KEY);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('initTabSync est idempotent (un seul écouteur)', () => {
        persistModeId('tp');
        initTabSync();
        initTabSync();
        const keys = collectData();
        window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }));
        expect(keys.filter((k) => k === 'theme')).toHaveLength(1);
    });
});

describe('tab-sync — changement de situation distant', () => {
    it('toast le libellé distant et ne change PAS la situation de la page', () => {
        persistModeId('forcene');
        initTabSync();
        window.dispatchEvent(new StorageEvent('storage', { key: PCTAC_MODE_KEY, newValue: 'recherche' }));
        expect(currentModeId()).toBe('forcene');
        expect(toastSpy).toHaveBeenCalledTimes(1);
        const message = String(toastSpy.mock.calls[0]?.[0] ?? '');
        expect(message).toContain('Recherche de personnes');
        expect(message).toContain('Forcené');
    });

    it('même situation que la nôtre : aucun toast', () => {
        persistModeId('forcene');
        initTabSync();
        window.dispatchEvent(new StorageEvent('storage', { key: PCTAC_MODE_KEY, newValue: 'forcene' }));
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('valeur distante invalide : aucun toast', () => {
        persistModeId('forcene');
        initTabSync();
        window.dispatchEvent(new StorageEvent('storage', { key: PCTAC_MODE_KEY, newValue: 'inventée' }));
        expect(toastSpy).not.toHaveBeenCalled();
    });
});

describe('tab-sync — images (BroadcastChannel)', () => {
    it('un message reçu est relayé en `pctac:image` avec remote:true', () => {
        initTabSync();
        const channel = FakeChannel.instances[0];
        expect(channel).toBeDefined();
        const seen: unknown[] = [];
        document.addEventListener('pctac:image', (e) => seen.push(e.detail));
        channel?.onmessage?.({ data: { id: 'p1', op: 'put' } } as MessageEvent);
        expect(seen).toContainEqual({ id: 'p1', op: 'put', remote: true });
    });

    it('publishImageChange publie après succès sur le canal unique', () => {
        initTabSync();
        const channel = FakeChannel.instances[0]!;
        publishImageChange('p2', 'delete');
        expect(channel.postMessage).toHaveBeenCalledWith({ id: 'p2', op: 'delete' });
    });
});
