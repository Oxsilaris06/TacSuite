/**
 * oi-id-cross-situation.test.ts — R5 : le magasin d'images est PARTAGÉ entre
 * situations ; l'id stable d'une photo d'OI doit donc inclure la situation,
 * sinon supprimer/annoter dans l'une casse la photo de l'autre.
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
import { ImageStore } from '@pctac/image-store.js';
import { PCTAC_MODE_KEY, resetModePinForTests } from '@pctac/modes.js';

async function oiZip(): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1', customTitle: 'Porte' }] } }) }));
    zip.folder('images')!.file('img_1.bin', Buffer.from('JPEG').toString('base64'), { base64: true });
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
}

beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); });

describe('A6/R5 : id stable de photo d’OI et magasin d’images PARTAGÉ entre situations', () => {
    it('effacer la photo dans TP ne doit pas casser celle de Forcené', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene'); resetModePinForTests();
        await Archive.importOiArchive(await oiZip());
        localStorage.setItem(PCTAC_MODE_KEY, 'tp'); resetModePinForTests();
        await Archive.importOiArchive(await oiZip());
        const fc = JSON.parse(localStorage.getItem(PHOTOS_KEY) ?? '[]');
        const tp = JSON.parse(localStorage.getItem(PHOTOS_KEY + '@tp') ?? '[]');
        // RESET de TP (main.ts:420-446) : supprime les images référencées par TP.
        await ImageStore.deleteMany(tp.map((p: { id: string }) => p.id));
        expect(fc).toHaveLength(1);
        expect(tp).toHaveLength(1);
        expect(fc[0].id).not.toBe(tp[0].id);
        expect(imageStoreState.store.get(fc[0].id)).toBeDefined();
    });
});
