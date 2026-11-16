/**
 * oi-archive-photos-references.test.ts — audit du 15/11 (A-ARC-01) : une
 * archive qui contient `images/` mais aucun `dynamic_photos` ne doit pas
 * faire supprimer les photos encore référencées par la session.
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

const KEY = 'tactical_oi_data';

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

async function archiveWithoutPhotoRefs(): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI', version: 1 }));
    zip.file('data.json', JSON.stringify({
        tactical_oi_data: JSON.stringify({ situation: 'archive sans photos' }),
    }));
    zip.folder('images')!.file('img_new.bin', 'nouvelle');
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'x.oi.zip');
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

describe('import .oi.zip — archive sans références photo', () => {
    it('une archive sans dynamic_photos ne supprime aucune photo référencée', async () => {
        const store = await fakeImageDb({ img_old: 'ancienne' });
        localStorage.setItem(KEY, JSON.stringify({
            situation: 'session en cours',
            dynamic_photos: { photo_situation: [{ id: 'img_old' }] },
        }));

        const done = window.importArchive(await archiveWithoutPhotoRefs());
        await vi.waitFor(() => expect(document.querySelectorAll('.import-cat-cb').length).toBeGreaterThan(0));
        document.getElementById('importSelectConfirmBtn')!.click();
        await done;

        const session = JSON.parse(localStorage.getItem(KEY) || '{}') as { dynamic_photos?: { photo_situation?: Array<{ id: string }> } };
        expect(session.dynamic_photos?.photo_situation?.[0]?.id).toBe('img_old');
        expect(store.has('img_old')).toBe(true);
    });
});
