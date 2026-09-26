/**
 * oi-archive-import-rollback.test.ts — audit du 26/09 (skills trailofbits-
 * sharp-edges) : l'import .oi.zip effaçait les photos de l'OI en cours AVANT
 * de valider l'archive, sans les rendre si l'import échouait ensuite.
 */
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
    confirmDialog: vi.fn(async () => true),
}));
vi.mock('@oi/outils.js', async (orig) => ({
    ...(await orig<typeof import('@oi/outils.js')>()),
    reencodeSansExif: vi.fn(async (b: Blob): Promise<Blob> => b),
}));

/** Base d'images en mémoire, branchée sur le vrai dbManager. */
async function fakeImageDb(initial: Record<string, string>): Promise<Map<string, Blob>> {
    const { dbManager } = await import('@oi/init.js');
    const store = new Map<string, Blob>(Object.entries(initial).map(([k, v]) => [k, new Blob([v])]));
    Object.assign(dbManager, { db: {} });
    vi.spyOn(dbManager, 'clearAllImages').mockImplementation(async () => { store.clear(); });
    vi.spyOn(dbManager, 'putItem').mockImplementation(async (k: string, b: Blob) => { store.set(k, b); });
    vi.spyOn(dbManager, 'getItem').mockImplementation(async (k: string) => store.get(k));
    vi.spyOn(dbManager, 'getAllKeys').mockImplementation(async () => [...store.keys()]);
    vi.spyOn(dbManager, 'deleteItem').mockImplementation(async (k: string) => { store.delete(k); });
    return store;
}

async function archive(images: Record<string, string>): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI', version: 1 }));
    zip.file('data.json', JSON.stringify({
        tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_situation: [{ id: 'img_new' }] } }),
    }));
    for (const [name, body] of Object.entries(images)) zip.folder('images')!.file(name, body);
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'x.oi.zip');
}

async function runImport(file: File): Promise<void> {
    const done = window.importArchive(file);
    await vi.waitFor(() => expect(document.querySelectorAll('.import-cat-cb').length).toBeGreaterThan(0));
    document.getElementById('importSelectConfirmBtn')!.click();
    await done;
}

beforeEach(async () => {
    document.body.innerHTML = `<dialog id="importSelectModal"><div id="importSelectList"></div>
        <input id="importSelectAll" type="checkbox"><button id="importSelectConfirmBtn"></button></dialog>`;
    localStorage.clear();
    toastSpy.mockClear();
    await import('@oi/formulaires.js');
    vi.spyOn(window, 'setTimeout').mockImplementation((() => 0) as unknown as typeof setTimeout);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
    const { dbManager } = await import('@oi/init.js');
    Object.assign(dbManager, { db: null });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('import .oi.zip : les photos en place ne sont jamais perdues sur un échec', () => {
    it('un nom d’image mal encodé (« %E0 ») est ignoré et compté, l’import aboutit', async () => {
        const store = await fakeImageDb({ img_old: 'ancienne' });
        await runImport(await archive({ '%E0.bin': 'x', 'img_new.bin': 'nouvelle' }));
        expect([...store.keys()]).toEqual(['img_new']);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('1 photo(s) ignorée(s)'), expect.anything());
    });

    it('photos en place illisibles : import annulé, rien n’est effacé', async () => {
        const store = await fakeImageDb({ img_old: 'ancienne' });
        const { dbManager } = await import('@oi/init.js');
        vi.spyOn(dbManager, 'getAllKeys').mockRejectedValue(new Error('base fermée'));
        await runImport(await archive({ 'img_new.bin': 'nouvelle' }));
        expect([...store.keys()]).toEqual(['img_old']);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('rien n’a été modifié'), expect.anything());
    });

    it('stockage plein à l’écriture du formulaire : les photos d’origine sont remises', async () => {
        const store = await fakeImageDb({ img_old: 'ancienne' });
        localStorage.setItem('tactical_oi_data', JSON.stringify({ dynamic_photos: { photo_situation: [{ id: 'img_old' }] } }));
        const realSet = localStorage.setItem.bind(localStorage);
        vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
            if (k === 'tactical_oi_data' && v.includes('img_new')) throw new DOMException('plein', 'QuotaExceededError');
            realSet(k, v);
        });
        await runImport(await archive({ 'img_new.bin': 'nouvelle' }));
        expect([...store.keys()]).toEqual(['img_old']);
        expect(await store.get('img_old')!.text()).toBe('ancienne');
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("Erreur d'import"), expect.anything());
    });
});
