/**
 * r2a-archive-result.test.ts — CONTROLES K1 et K3 :
 *   - K1 : `importFile` rend `warned:true` quand un toast d'échec partiel a
 *     déjà été affiché (photos non restaurées), pour que `main.ts` n'ajoute pas
 *     de succès générique qui le contredirait.
 *   - K3 : `lastExportFileName()` rend le nom RÉELLEMENT téléchargé.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ADVERSARIES_KEY } from '@pctac/config.js';

const io = vi.hoisted(() => ({ failIds: new Set<string>(), store: new Map<string, string>() }));
vi.mock('@pctac/image-store.js', () => ({
    GpxStore: { async put() {}, async get() { return null; }, async delete() {}, async clear() {} },
    ImageStore: {
        async put(id: string, d: string) { if (io.failIds.has(id)) throw new Error('quota'); io.store.set(id, d); },
        async get(id: string) { return io.store.get(id) ?? null; },
        async getMany() { return {}; },
        async delete(id: string) { io.store.delete(id); },
        async deleteMany(ids: readonly string[]) { ids.forEach((i) => io.store.delete(i)); },
        async clear() { io.store.clear(); },
        async migrateFromLocalStorage() {},
        async hydrate<T>(items: T[]) { return items; },
    },
}));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ confirmDialog: vi.fn(async () => true), toast: toastSpy, showBanner: vi.fn(), hideBanner: vi.fn() }));
vi.mock('@pctac/import-scope.js', async (orig) => ({
    ...(await orig<typeof import('@pctac/import-scope.js')>()),
    askImportScope: vi.fn(async () => ({ categories: ['adversaires'], mode: 'merge', full: false })),
}));

import { Archive } from '@pctac/archive.js';
import { PCTAC_MODE_KEY } from '@pctac/modes.js';

async function makeZip(images: Record<string, string>): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'PC TAC', version: 1, situation: 'forcene' }));
    zip.file('data.json', JSON.stringify({ [ADVERSARIES_KEY]: JSON.stringify([{ id: 'a1', nom: 'X', hasImage: true }]) }));
    Object.entries(images).forEach(([id, url]) => zip.file(`images/${id}.txt`, url));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'a.pctac.zip');
}

beforeEach(() => {
    localStorage.clear();
    io.failIds.clear();
    io.store.clear();
    toastSpy.mockClear();
    localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
});

describe('K1 : warned sur échec partiel des photos', () => {
    it('photo non restaurée → warned:true (un seul message, celui d’archive.ts)', async () => {
        io.failIds.add('a1');
        const res = await Archive.importFile(await makeZip({ a1: 'data:image/png;base64,QUJD' }));
        expect(res.ok).toBe(true);
        expect(res.ok && res.warned).toBe(true);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("certaines photos n'ont pas pu être restaurées"), expect.anything());
    });
    it('import propre → warned:false', async () => {
        const res = await Archive.importFile(await makeZip({ a1: 'data:image/png;base64,QUJD' }));
        expect(res.ok).toBe(true);
        expect(res.ok && res.warned).toBe(false);
    });
});

describe('K3 : lastExportFileName', () => {
    it('null avant tout export, puis le nom réellement téléchargé', async () => {
        expect(Archive.lastExportFileName()).toBeNull();
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        let download = '';
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            download = this.download;
        });
        await expect(Archive.exportZip()).resolves.toBe(true);
        expect(Archive.lastExportFileName()).toBe(download);
        expect(Archive.lastExportFileName()).toMatch(/\.pctac\.zip$/);
        vi.restoreAllMocks();
    });
});
