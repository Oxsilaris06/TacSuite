/**
 * r2a-oi-import.test.ts — CONTROLE C2/R6 (réimport d'un OI modifié) et C5/R9
 * (fusion d'un adversaire OI dans une fiche existante), + R7 (MIME forgé).
 *
 * Porté du contrôleur /tmp/claude-1000/controle-socle/oi-import.test.ts.
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
// jsdom n'a pas de canvas : on simule le rendu d'annotation de l'OI.
vi.mock('@pctac/photo-annotation.js', async (orig) => ({
    ...(await orig<typeof import('@pctac/photo-annotation.js')>()),
    renderAnnotated: vi.fn(async () => 'data:image/png;base64,QU5OT1Q='),
}));

import { Archive } from '@pctac/archive.js';
import { Storage } from '@pctac/storage.js';

async function oiZip(oi: unknown, images: Record<string, string>, meta?: Record<string, string>): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify(oi) }));
    Object.entries(images).forEach(([id, bytes]) => zip.folder('images')!.file(`${id}.bin`, Buffer.from(bytes).toString('base64'), { base64: true }));
    if (meta) zip.file('images.json', JSON.stringify(meta));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
}

beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); confirmSpy.mockReset(); confirmSpy.mockResolvedValue(true); });

describe('R6 : détection « modifiée dans PC-Tac »', () => {
    it('OI mis à jour (légende ET image changées dans l’OI), rien touché dans PC-Tac : le réimport met à jour', async () => {
        await Archive.importOiArchive(await oiZip({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1', customTitle: 'Porte' }] } }, { img_1: 'V1' }));
        const before = Storage.loadCollection(PHOTOS_KEY)[0]!;
        const imgBefore = imageStoreState.store.get(before.id);
        await Archive.importOiArchive(await oiZip({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1', customTitle: 'Porte arrière' }] } }, { img_1: 'V2-NOUVELLE' }));
        const after = Storage.loadCollection(PHOTOS_KEY);
        console.log('AFTER', JSON.stringify(after), 'IMG avant', imgBefore, 'IMG après', imageStoreState.store.get(before.id));
        expect(after[0]!.title).toBe('Porte arrière');
        expect(imageStoreState.store.get(before.id)).not.toBe(imgBefore);
    });
    it('photo annotée DANS L’OI, jamais touchée dans PC-Tac : le réimport d’un OI modifié la met à jour', async () => {
        await Archive.importOiArchive(await oiZip({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1', customTitle: 'Porte', annotations: '[{"type":"arrow"}]' }] } }, { img_1: 'V1' }));
        const before = Storage.loadCollection(PHOTOS_KEY)[0]!;
        console.log('BEFORE', JSON.stringify(before), 'ORIG', imageStoreState.store.get(before.id + '_orig'));
        await Archive.importOiArchive(await oiZip({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1', customTitle: 'Porte', annotations: '[{"type":"box"}]' }] } }, { img_1: 'V2-NOUVELLE' }));
        const after = Storage.loadCollection(PHOTOS_KEY)[0]!;
        console.log('AFTER', JSON.stringify(after), 'ORIG', imageStoreState.store.get(before.id + '_orig'));
        expect(after.annotations).toBe('[{"type":"box"}]');
    });
});

describe('R9 : fusion d’un adversaire OI dans une fiche existante', () => {
    it('la photo reprise a son entrée de galerie `<id>_sync` (comme B-2 côté fiche)', async () => {
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', status: 'active' }]);
        Storage.saveCollection(PHOTOS_KEY, []);
        const res = await Archive.importOiArchive(await oiZip({
            adversaries: [{ id: 'a1', nom_adversaire: 'Jean Dupont' }],
            dynamic_photos: { photo_main_a1: [{ id: 'img_9' }] },
        }, { img_9: 'PHOTO' }));
        const adv = Storage.loadCollection(ADVERSARIES_KEY);
        const gallery = Storage.loadCollection(PHOTOS_KEY);
        console.log('RES', JSON.stringify(res), 'ADV', JSON.stringify(adv), 'GALLERY', JSON.stringify(gallery), 'blobs', [...imageStoreState.store.keys()]);
        expect(adv).toHaveLength(1);
        expect(adv[0]!.hasImage).toBe(true);
        expect(gallery.map((p) => p.id)).toContain('fc1_sync');
    });
});

describe('R7 : MIME forgé dans images.json', () => {
    it('ne produit jamais d’attribut injectable', async () => {
        await Archive.importOiArchive(await oiZip({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1' }] } }, { img_1: 'x' }, { img_1: 'image/png" onerror="window.__pwn=1' }));
        const p = Storage.loadCollection(PHOTOS_KEY)[0]!;
        const v = imageStoreState.store.get(p.id)!;
        console.log('STORED', v);
        expect(v).toMatch(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/);
    });
});
