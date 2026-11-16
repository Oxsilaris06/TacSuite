/**
 * oi-archive-photos-idb-unavailable.test.ts — audit du 15/11 (A-ARC-03) :
 * quand IndexedDB ne s'ouvre pas, l'import photos ne doit pas écrire les
 * références puis annoncer un succès.
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

async function archive(): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI', version: 1 }));
    zip.file('data.json', JSON.stringify({
        tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_situation: [{ id: 'img_new' }] } }),
    }));
    zip.folder('images')!.file('img_new.bin', 'nouvelle');
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
    vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
    vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });
});

afterEach(async () => {
    const { dbManager } = await import('@oi/init.js');
    Object.assign(dbManager, { db: null });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('A-ARC-03 : IndexedDB indisponible', () => {
    it('l’import photos échoue sans écrire de références', async () => {
        const { dbManager } = await import('@oi/init.js');
        localStorage.setItem('tactical_oi_data', JSON.stringify({
            dynamic_photos: { photo_situation: [{ id: 'img_old' }] },
        }));
        Object.assign(dbManager, { db: null });
        vi.spyOn(dbManager, 'init').mockRejectedValue(new Error('IndexedDB bloquée'));

        await runImport(await archive());

        const stored = JSON.parse(localStorage.getItem('tactical_oi_data') ?? '{}') as {
            dynamic_photos?: { photo_situation?: Array<{ id: string }> };
        };
        expect(stored.dynamic_photos?.photo_situation?.map((p) => p.id)).toEqual(['img_old']);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/IndexedDB|photos/i), expect.anything());
        expect(toastSpy).not.toHaveBeenCalledWith(expect.stringContaining('Import effectué'), expect.anything());
    });
});
