/**
 * pc-oi-import-photos.test.ts — Import d'un OI : TOUTES les photos (A6).
 *
 * Verrouille : les photos des contenants OI (objectif, photos supplémentaires
 * d'adversaire, autres) arrivent dans la galerie Photos avec légende,
 * annotations et catégorie cohérente ; le réimport du même OI met à jour au
 * lieu d'ajouter (id stable dérivé de l'id OI) ; une photo illisible n'empêche
 * pas les autres d'arriver.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { PHOTOS_KEY } from '@pctac/config.js';

const imageStoreState = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@pctac/image-store.js', () => {
    const { store } = imageStoreState;
    return {
        GpxStore: {
            async put(): Promise<void> {},
            async get(): Promise<null> { return null; },
            async delete(): Promise<void> {},
            async clear(): Promise<void> {},
        },
        ImageStore: {
            async put(id: string, dataUrl: string): Promise<void> { if (id && dataUrl) store.set(id, dataUrl); },
            async get(id: string): Promise<string | null> { return store.has(id) ? (store.get(id) ?? null) : null; },
            async getMany(ids: readonly string[]): Promise<Record<string, string | null>> {
                const out: Record<string, string | null> = {};
                ids.forEach((id) => { out[id] = store.has(id) ? (store.get(id) ?? null) : null; });
                return out;
            },
            async delete(id: string): Promise<void> { store.delete(id); },
            async deleteMany(ids: readonly string[]): Promise<void> { ids.forEach((id) => store.delete(id)); },
            async clear(): Promise<void> { store.clear(); },
            async migrateFromLocalStorage(): Promise<void> {},
            async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
        },
    };
});

const renderSpy = vi.hoisted(() => vi.fn(async (original: string, anns: unknown[]) => `${original}+${anns.length}`));
vi.mock('@pctac/photo-annotation.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@pctac/photo-annotation.js')>()),
    renderAnnotated: renderSpy,
}));

vi.mock('@shared/feedback.js', () => ({
    confirmDialog: vi.fn(async () => true),
    toast: vi.fn(),
    showBanner: vi.fn(),
    hideBanner: vi.fn(),
}));

import { Archive, oiPhotoCategory, oiPhotoTitle, stableOiPhotoId } from '@pctac/archive.js';
import { ImageStore } from '@pctac/image-store.js';
import { Storage } from '@pctac/storage.js';

interface OiZipOptions {
    oiData: Record<string, unknown>;
    imagesMeta?: Record<string, string>;
    imageFiles?: Record<string, string>;
}

async function buildOiZip(opts: OiZipOptions): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify(opts.oiData) }));
    if (opts.imagesMeta) zip.file('images.json', JSON.stringify(opts.imagesMeta));
    if (opts.imageFiles) {
        const folder = zip.folder('images');
        if (folder) Object.entries(opts.imageFiles).forEach(([n, c]) => folder.file(n, c, { base64: true }));
    }
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return new File([buf], 'test.oi.zip');
}

const b64 = (s: string): string => Buffer.from(s).toString('base64');

function makeOi(): OiZipOptions {
    return {
        oiData: {
            dynamic_photos: {
                photo_extra_adv1: [
                    { id: 'img_a1', customTitle: 'Vue avant' },
                    { id: 'img_a2' },
                    { id: 'img_a3' },
                ],
                photo_container_express_objectif_preview_container: [
                    { id: 'img_obj1' },
                    { id: 'img_obj2', customTitle: 'Objectif nuit' },
                ],
            },
        },
        imagesMeta: {
            img_a1: 'image/png', img_a2: 'image/png', img_a3: 'image/png',
            img_obj1: 'image/png', img_obj2: 'image/png',
        },
        imageFiles: {
            'img_a1.bin': b64('A1'), 'img_a2.bin': b64('A2'), 'img_a3.bin': b64('A3'),
            'img_obj1.bin': b64('O1'), 'img_obj2.bin': b64('O2'),
        },
    };
}

beforeEach(() => {
    localStorage.clear();
    imageStoreState.store.clear();
    renderSpy.mockClear();
});

describe('helpers photo OI', () => {
    it('dérive un id stable et sûr de l’id OI', () => {
        expect(stableOiPhotoId('img 1/x')).toBe('oi_photo_img_1_x');
        expect(stableOiPhotoId('img1')).toBe(stableOiPhotoId('img1'));
    });

    it('classe adversaire en « neutralized », le reste en « location »', () => {
        expect(oiPhotoCategory('photo_extra_adv1')).toBe('neutralized');
        expect(oiPhotoCategory('photo_renforts_adv1')).toBe('neutralized');
        expect(oiPhotoCategory('photo_container_express_objectif_preview_container')).toBe('location');
    });
});

describe('légende des photos « Baptême terrain » importées', () => {
    it('champ unique sous la Mission comme ancien champ par bloc : « Baptême terrain »', () => {
        expect(oiPhotoTitle('photo_container_bapteme_terrain_preview_container', {})).toBe('Baptême terrain');
        expect(oiPhotoTitle('photo_bapteme_z1', {})).toBe('Baptême terrain');
    });
});

describe('importOiArchive — toutes les photos', () => {
    it('importe 3 photos d’adversaire et 2 d’objectif dans la galerie', async () => {
        const file = await buildOiZip(makeOi());
        const result = await Archive.importOiArchive(file);

        expect(result.galleryAdded).toBe(5);
        const photos = Storage.loadCollection(PHOTOS_KEY);
        expect(photos).toHaveLength(5);
        const byId = new Map(photos.map((p) => [p.id, p]));
        expect(byId.get(stableOiPhotoId('img_a1'))).toMatchObject({ title: 'Vue avant', category: 'neutralized' });
        expect(byId.get(stableOiPhotoId('img_a2'))).toMatchObject({ title: 'Adversaire — photo supplémentaire', category: 'neutralized' });
        expect(byId.get(stableOiPhotoId('img_obj1'))).toMatchObject({ title: 'Objectif', category: 'location' });
        expect(byId.get(stableOiPhotoId('img_obj2'))).toMatchObject({ title: 'Objectif nuit', category: 'location' });

        // Les octets sont bien dans le magasin.
        expect(await ImageStore.get(stableOiPhotoId('img_a1'))).toBe('data:image/png;base64,' + b64('A1'));
    });

    it('réimporte le même OI : mise à jour, compte inchangé', async () => {
        const file = await buildOiZip(makeOi());
        await Archive.importOiArchive(file);
        const result2 = await Archive.importOiArchive(file);

        expect(result2.galleryAdded).toBe(0);
        expect(result2.galleryUpdated).toBe(5);
        expect(Storage.loadCollection(PHOTOS_KEY)).toHaveLength(5);
    });

    it('photo annotée : original, annotation et rendu appliqué', async () => {
        const box = { id: 1, type: 'box', startX: 1, startY: 1, endX: 9, endY: 9, x: 1, y: 1, width: 8, height: 8, color: '#c0392b', thickness: 4, rotation: 0 };
        const opts: OiZipOptions = {
            oiData: {
                dynamic_photos: {
                    photo_extra_adv1: [{ id: 'img_n', annotations: JSON.stringify([box]) }],
                },
            },
            imagesMeta: { img_n: 'image/png' },
            imageFiles: { 'img_n.bin': b64('N') },
        };
        await Archive.importOiArchive(await buildOiZip(opts));

        const id = stableOiPhotoId('img_n');
        const orig = 'data:image/png;base64,' + b64('N');
        expect(await ImageStore.get(id)).toBe(orig + '+1');
        expect(await ImageStore.get(id + '_orig')).toBe(orig);
        const item = Storage.loadCollection(PHOTOS_KEY).find((p) => p.id === id);
        expect(JSON.parse(String(item?.annotations))).toEqual([box]);
    });

    it('une photo illisible n’empêche pas les autres d’arriver', async () => {
        const opts = makeOi();
        delete opts.imagesMeta?.img_a2;
        delete opts.imageFiles?.['img_a2.bin'];
        const result = await Archive.importOiArchive(await buildOiZip(opts));
        expect(result.galleryAdded).toBe(4);
        expect(Storage.loadCollection(PHOTOS_KEY).map((p) => p.id)).not.toContain(stableOiPhotoId('img_a2'));
    });
});
