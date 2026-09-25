/**
 * pc-import-open-existing.test.ts — « Ouvrir l'existante » à l'import (R9
 * point 3), revue finale F9 à F12 :
 *  F9  la demande est propre à UN import : elle ne fuit jamais dans le suivant ;
 *  F10 pas de « Ouvrir l'existante » pour un doublon d'AMI (rien à ouvrir) ;
 *  F11 l'onglet du camp est activé avant d'ouvrir la fiche ;
 *  F12 le toast de l'OI annonce les photos gardées parce que modifiées au PC.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ADVERSARIES_KEY, FRIENDS_KEY, PHOTOS_KEY } from '@pctac/config.js';

const st = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@pctac/image-store.js', () => ({
    GpxStore: { async put() {}, async get() { return null; }, async delete() {}, async clear() {} },
    ImageStore: {
        async put(id: string, d: string) { st.store.set(id, d); },
        async get(id: string) { return st.store.get(id) ?? null; },
        async getMany() { return {}; },
        async delete(id: string) { st.store.delete(id); },
        async deleteMany(ids: readonly string[]) { ids.forEach((i) => st.store.delete(i)); },
        async clear() { st.store.clear(); },
        async migrateFromLocalStorage() {},
        async hydrate<T>(items: T[]) { return items; },
    },
}));
const confirmSpy = vi.hoisted(() => vi.fn(async () => true as boolean | 'extra'));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ confirmDialog: confirmSpy, toast: toastSpy, showBanner: vi.fn(), hideBanner: vi.fn() }));
const scope = vi.hoisted(() => ({ categories: ['adversaires'] as string[] }));
vi.mock('@pctac/import-scope.js', async (orig) => ({
    ...(await orig<typeof import('@pctac/import-scope.js')>()),
    askImportScope: vi.fn(async () => ({ categories: scope.categories, mode: 'merge', full: false })),
}));

import { Archive } from '@pctac/archive.js';
import { Storage } from '@pctac/storage.js';
import { PCTAC_MODE_KEY } from '@pctac/modes.js';
import { Utils } from '@pctac/utils.js';

async function archiveZip(situation: string, key: string, items: unknown[]): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'PC TAC', version: 1, situation }));
    zip.file('data.json', JSON.stringify({ [key]: JSON.stringify(items) }));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'a.pctac.zip');
}
async function oiZip(name: string): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({ adversaries: [{ id: 'a9', nom_adversaire: name }] }) }));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
}

const opened: Array<{ side: string; id: string }> = [];
document.addEventListener('pctac:open-fiche', (e) => { opened.push((e as CustomEvent<{ side: string; id: string }>).detail); });

beforeEach(() => {
    localStorage.clear(); st.store.clear(); opened.length = 0;
    confirmSpy.mockReset(); toastSpy.mockReset();
    localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
});

describe('« Ouvrir l’existante » à l’import (F9 à F11)', () => {
    it('F9 : archive TP importée depuis Forcené, « Ouvrir l’existante » puis « pas de bascule » : rien ne fuit dans l’import d’OI suivant', async () => {
        scope.categories = ['adversaires'];
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'tpE', nom: 'Dupont', prenom: 'Jean', status: 'active' }], 'tp');
        confirmSpy
            .mockResolvedValueOnce('extra')   // doublon → « Ouvrir l'existante »
            .mockResolvedValueOnce(false);    // « Changer de situation ? » → non
        await Archive.importFile(await archiveZip('tp', ADVERSARIES_KEY, [{ id: 'tp1', nom: 'Dupont', prenom: 'Jean' }]));
        // Plus tard, import d'un OI SANS aucun doublon, dans Forcené.
        confirmSpy.mockResolvedValue(true);
        await Archive.importOiArchive(await oiZip('Paul Martin'));
        expect(opened).toEqual([]);
    });

    it('F10 : doublon d’AMI : « Ouvrir l’existante » n’est pas proposé', async () => {
        scope.categories = ['amis'];
        Storage.saveCollection(FRIENDS_KEY, [{ id: 'f1', nom: 'Martin', prenom: 'Luc' }]);
        confirmSpy.mockResolvedValueOnce(false);
        await Archive.importFile(await archiveZip('forcene', FRIENDS_KEY, [{ id: 'f2', nom: 'Martin', prenom: 'Luc' }]));
        const call = confirmSpy.mock.calls[0] as unknown as [{ extraLabel?: string; message: string }];
        expect(call[0].extraLabel).toBeUndefined();
        expect(call[0].message).not.toMatch(/ouvrir/i);
    });

    it('F11 : « Ouvrir l’existante » active d’abord l’onglet du camp', async () => {
        scope.categories = ['adversaires'];
        const switchSpy = vi.fn();
        (window as unknown as { switchMainView?: (v: string) => void }).switchMainView = switchSpy;
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'e1', nom: 'Dupont', prenom: 'Jean', status: 'active' }]);
        confirmSpy.mockResolvedValueOnce('extra');
        await Archive.importFile(await archiveZip('forcene', ADVERSARIES_KEY, [{ id: 'i1', nom: 'Dupont', prenom: 'Jean' }]));
        expect(opened).toEqual([{ side: 'adv', id: 'e1' }]);
        expect(switchSpy).toHaveBeenCalledWith('view-adversaires');
        delete (window as unknown as { switchMainView?: unknown }).switchMainView;
    });
});

describe('toast de la passerelle OI (F12)', () => {
    it('réimport : photo renommée au PC gardée ET annoncée', async () => {
        const oiPhotoZip = async (title: string, bytes: string): Promise<File> => {
            const zip = new JSZip();
            zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
            zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_itin_ext_b1: [{ id: 'img_1', customTitle: title }] } }) }));
            zip.folder('images')!.file('img_1.bin', btoa(bytes), { base64: true });
            return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
        };
        confirmSpy.mockResolvedValue(true);
        await Archive.importOiArchive(await oiPhotoZip('Porte', 'V1'));
        const list = Storage.loadCollection(PHOTOS_KEY);
        list[0]!.title = 'Porte — renommée au PC';
        Storage.saveCollection(PHOTOS_KEY, list);
        const res = await Archive.importOiArchive(await oiPhotoZip('Porte arrière', 'V2'));
        expect(res.galleryPreserved).toBe(1);
        expect(Utils.oiImportSummaryParts(res).join(', ')).toMatch(/1 photo\(s\) modifiée\(s\) au PC gardée\(s\)/);
    });
});
