/**
 * r2a-oi-counters.test.ts — CONTROLE K2 (C5/C14) : les compteurs de la
 * passerelle OI doivent dire la VÉRITÉ — une fusion n'est pas un doublon
 * ignoré (`advMerged`), `advSkipped` ne compte plus que les vrais ignorés, et
 * `advPhotos` ne compte qu'une photo réellement gardée.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ADVERSARIES_KEY, PHOTOS_KEY } from '@pctac/config.js';

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
const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@shared/feedback.js', () => ({ confirmDialog: confirmSpy, toast: vi.fn(), showBanner: vi.fn(), hideBanner: vi.fn() }));

import { Archive } from '@pctac/archive.js';
import { Storage } from '@pctac/storage.js';

async function oiZip(oi: unknown, images: Record<string, string>): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify(oi) }));
    Object.entries(images).forEach(([id, bytes]) => zip.folder('images')!.file(`${id}.bin`, Buffer.from(bytes).toString('base64'), { base64: true }));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
}

const OI_DUP = {
    adversaries: [{ id: 'a1', nom_adversaire: 'Jean Dupont' }],
    dynamic_photos: { photo_main_a1: [{ id: 'img_9' }] },
};

beforeEach(() => {
    localStorage.clear();
    imageStoreState.store.clear();
    confirmSpy.mockReset();
    confirmSpy.mockResolvedValue(true);
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', status: 'active' }]);
    Storage.saveCollection(PHOTOS_KEY, []);
});

describe('K2 : compteurs de la passerelle OI', () => {
    it('fusion dans une fiche SANS photo : 1 fiche fusionnée, 1 photo réellement gardée, 0 ignoré', async () => {
        const res = await Archive.importOiArchive(await oiZip(OI_DUP, { img_9: 'PHOTO' }));
        expect(res.advMerged).toBe(1);
        expect(res.advPhotos).toBe(1);
        expect(res.advSkipped).toBe(0);
        expect(res.advAdded).toBe(0);
        const gallery = Storage.loadCollection(PHOTOS_KEY);
        expect(gallery.map((p) => p.id)).toContain('fc1_sync');
        expect(imageStoreState.store.get('fc1_sync')).toBeTruthy();
    });

    it('fusion dans une fiche AVEC photo : 1 fusion, 0 photo gardée (celle de l’existante reste)', async () => {
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', status: 'active', hasImage: true }]);
        imageStoreState.store.set('fc1', 'PHOTO_EXISTANTE');
        const res = await Archive.importOiArchive(await oiZip(OI_DUP, { img_9: 'PHOTO_OI' }));
        expect(res.advMerged).toBe(1);
        expect(res.advPhotos).toBe(0);
        expect(res.advSkipped).toBe(0);
        expect(imageStoreState.store.get('fc1')).toBe('PHOTO_EXISTANTE');
    });

    it('sans doublon : 1 ajout, 1 photo', async () => {
        Storage.saveCollection(ADVERSARIES_KEY, []);
        const res = await Archive.importOiArchive(await oiZip(OI_DUP, { img_9: 'PHOTO' }));
        expect(res.advAdded).toBe(1);
        expect(res.advPhotos).toBe(1);
        expect(res.advMerged).toBe(0);
        expect(res.advSkipped).toBe(0);
    });

    it('fusion + autres photos de galerie : l’entrée `_sync` de la fusion survit à la sauvegarde des photos OI', async () => {
        const res = await Archive.importOiArchive(await oiZip({
            ...OI_DUP,
            dynamic_photos: {
                ...OI_DUP.dynamic_photos,
                photo_itin_ext_b1: [{ id: 'img_2' }],
            },
        }, { img_9: 'PHOTO', img_2: 'CHEMIN' }));
        expect(res.advMerged).toBe(1);
        const gallery = Storage.loadCollection(PHOTOS_KEY).map((p) => p.id);
        expect(gallery).toContain('fc1_sync');
        expect(gallery.some((id) => id.startsWith('oi_photo'))).toBe(true);
    });
});
