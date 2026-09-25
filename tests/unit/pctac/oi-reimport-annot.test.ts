/**
 * oi-reimport-annot.test.ts — R6 : le réimport du même OI ne doit pas effacer
 * l'annotation et la légende faites dans PC-Tac (décisions 25/26).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PHOTOS_KEY } from '@pctac/config.js';

const imageStoreState = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@pctac/image-store.js', () => {
    const { store } = imageStoreState;
    return {
        GpxStore: { async put() {}, async get() { return null; }, async delete() {}, async clear() {} },
        ImageStore: {
            async put(id: string, d: string) { if (id && d) store.set(id, d); },
            async get(id: string) { return store.get(id) ?? null; },
            async getMany() { return {}; },
            async delete(id: string) { store.delete(id); },
            async deleteMany(ids: readonly string[]) { ids.forEach((i) => store.delete(i)); },
            async clear() { store.clear(); },
            async migrateFromLocalStorage() {},
            async hydrate<T>(items: T[]) { return items; },
        },
    };
});
vi.mock('@shared/feedback.js', () => ({ confirmDialog: vi.fn(async () => true), toast: vi.fn(), showBanner: vi.fn(), hideBanner: vi.fn() }));

import { Archive } from '@pctac/archive.js';
import { Storage } from '@pctac/storage.js';

async function oiZip(): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1', customTitle: 'Porte' }] } }) }));
    zip.folder('images')!.file('img_1.bin', Buffer.from('JPEG').toString('base64'), { base64: true });
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
}
beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); });

describe('A6/R6 : réimport du même OI après annotation dans PC-Tac', () => {
    it('garde l’annotation et la légende faites dans PC-Tac', async () => {
        await Archive.importOiArchive(await oiZip());
        // L'opérateur annote (décision 25) et renomme la photo dans PC-Tac.
        const list = Storage.loadCollection(PHOTOS_KEY);
        const p = list[0]!;
        imageStoreState.store.set(p.id + '_orig', imageStoreState.store.get(p.id)!);
        imageStoreState.store.set(p.id, 'data:image/jpeg;base64,ANNOTEE_PCTAC=');
        p.annotations = '[{"type":"arrow"}]';
        p.title = 'Porte d’entrée — bélier ici';
        Storage.saveCollection(PHOTOS_KEY, list);
        await Archive.importOiArchive(await oiZip());
        const after = Storage.loadCollection(PHOTOS_KEY)[0]!;
        expect(after.annotations).toBe('[{"type":"arrow"}]');
        expect(after.title).toBe('Porte d’entrée — bélier ici');
        expect(imageStoreState.store.get(p.id)).toBe('data:image/jpeg;base64,ANNOTEE_PCTAC=');
    });
});
