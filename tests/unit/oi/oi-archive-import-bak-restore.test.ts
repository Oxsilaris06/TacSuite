/**
 * oi-archive-import-bak-restore.test.ts — audit du 15/11 (A-ARC-02) : une copie
 * `<id>.bak-import` laissée par un onglet tué en plein import est remise à la
 * place de la photo qu'elle sauvegardait, puis supprimée, au démarrage suivant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
}));

vi.mock('maplibre-gl', () => ({ default: {}, Marker: class {}, LngLatBounds: class {}, Map: class {} }));
vi.mock('@shared/maplibre-worker.js', () => ({}));

/** Base d'images en mémoire, branchée sur le vrai dbManager. */
async function fakeImageDb(initial: Record<string, string>): Promise<Map<string, Blob>> {
    const { dbManager } = await import('@oi/init.js');
    const store = new Map<string, Blob>(Object.entries(initial).map(([k, v]) => [k, new Blob([v])]));
    Object.assign(dbManager, { db: {} });
    vi.spyOn(dbManager, 'putItem').mockImplementation(async (k: string, b: Blob) => { store.set(k, b); });
    vi.spyOn(dbManager, 'getItem').mockImplementation(async (k: string) => store.get(k));
    vi.spyOn(dbManager, 'getAllKeys').mockImplementation(async () => [...store.keys()]);
    vi.spyOn(dbManager, 'deleteItem').mockImplementation(async (k: string) => { store.delete(k); });
    return store;
}

beforeEach(() => {
    localStorage.clear();
    toastSpy.mockClear();
    vi.resetModules();
});

afterEach(async () => {
    const { dbManager } = await import('@oi/init.js');
    Object.assign(dbManager, { db: null });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('restoreInterruptedImport', () => {
    it('onglet tué après l\'écriture du formulaire : la copie est jetée, la nouvelle photo reste', async () => {
        const store = await fakeImageDb({ img_a: 'nouvelle-importee', 'img_a.bak-import': 'ancienne' });
        const { restoreInterruptedImport } = await import('@oi/formulaires.js');

        await restoreInterruptedImport();

        expect(await store.get('img_a')!.text()).toBe('nouvelle-importee');
        expect(store.has('img_a.bak-import')).toBe(false);
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('onglet tué avant l\'écriture du formulaire : la copie remplace la photo écrasée, puis elle est supprimée', async () => {
        localStorage.setItem('oi.import-en-cours', '1');
        const store = await fakeImageDb({ img_a: 'ecrasee-par-import', 'img_a.bak-import': 'originale', img_b: 'intacte' });
        const { restoreInterruptedImport } = await import('@oi/formulaires.js');

        await restoreInterruptedImport();

        expect(await store.get('img_a')!.text()).toBe('originale');
        expect(store.has('img_a.bak-import')).toBe(false);
        expect(await store.get('img_b')!.text()).toBe('intacte');
        expect(localStorage.getItem('oi.import-en-cours')).toBeNull();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('1 photo'), expect.anything());
    });

    it('cas normal : sans copie, rien ne bouge et aucun message', async () => {
        const store = await fakeImageDb({ img_a: 'actuelle', img_b: 'intacte' });
        const { restoreInterruptedImport } = await import('@oi/formulaires.js');

        await restoreInterruptedImport();

        expect([...store.keys()].sort()).toEqual(['img_a', 'img_b']);
        expect(await store.get('img_a')!.text()).toBe('actuelle');
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('échec d\'écriture : la copie reste pour le démarrage suivant', async () => {
        localStorage.setItem('oi.import-en-cours', '1');
        const store = await fakeImageDb({ img_a: 'ecrasee', 'img_a.bak-import': 'originale' });
        const { dbManager } = await import('@oi/init.js');
        vi.spyOn(dbManager, 'putItem').mockRejectedValue(new Error('quota IndexedDB'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { restoreInterruptedImport } = await import('@oi/formulaires.js');

        await restoreInterruptedImport();

        expect(store.has('img_a.bak-import')).toBe(true);
        expect(localStorage.getItem('oi.import-en-cours')).toBe('1');
    });

    it('IndexedDB fermée : ne jette pas', async () => {
        const { dbManager } = await import('@oi/init.js');
        Object.assign(dbManager, { db: null });
        const { restoreInterruptedImport } = await import('@oi/formulaires.js');

        await expect(restoreInterruptedImport()).resolves.toBeUndefined();
    });
});

describe('démarrage OI', () => {
    it('une copie orpheline est restaurée avant le chargement du formulaire', async () => {
        document.body.innerHTML = `
            <div id="appAutosave"></div>
            <form id="oi-form"><input id="situation" type="text"></form>
            <div class="wizard-progress"></div>`;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorage.setItem('oi.import-en-cours', '1');
        const store = await fakeImageDb({ img_a: 'ecrasee', 'img_a.bak-import': 'originale' });
        const { dbManager } = await import('@oi/init.js');
        vi.spyOn(dbManager, 'init').mockResolvedValue(undefined);
        await import('@oi/main.js');
        window.loadFormData = vi.fn(async () => { /* remplacé par le test */ });
        window.showStep = vi.fn();

        document.dispatchEvent(new Event('DOMContentLoaded'));

        await vi.waitFor(() => expect(window.loadFormData).toHaveBeenCalled());
        expect(await store.get('img_a')!.text()).toBe('originale');
        expect(store.has('img_a.bak-import')).toBe(false);
    });
});
