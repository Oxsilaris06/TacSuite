/**
 * r2a-open-existing.test.ts — CONTROLE R9 point 3 : le dialogue de doublon, à
 * l'import d'archive COMME à l'import d'OI, propose aussi « Ouvrir l'existante »
 * (garder les deux fiches, puis ouvrir l'existante une fois l'import fini).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ADVERSARIES_KEY } from '@pctac/config.js';

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
// Le dialogue rend 'extra' quand l'opérateur choisit « Ouvrir l'existante ».
const confirmSpy = vi.hoisted(() => vi.fn(async () => true as boolean | 'extra'));
vi.mock('@shared/feedback.js', () => ({ confirmDialog: confirmSpy, toast: vi.fn(), showBanner: vi.fn(), hideBanner: vi.fn() }));
vi.mock('@pctac/import-scope.js', async (orig) => ({
    ...(await orig<typeof import('@pctac/import-scope.js')>()),
    askImportScope: vi.fn(async () => ({ categories: ['adversaires'], mode: 'merge', full: false })),
}));

import { Archive } from '@pctac/archive.js';
import { Storage } from '@pctac/storage.js';
import { PCTAC_MODE_KEY } from '@pctac/modes.js';

async function archiveZip(): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'PC TAC', version: 1, situation: 'forcene' }));
    zip.file('data.json', JSON.stringify({ [ADVERSARIES_KEY]: JSON.stringify([{ id: 'tp1', nom: 'Dupont', prenom: 'Jean' }]) }));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'a.pctac.zip');
}

async function oiZip(): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({ adversaries: [{ id: 'a1', nom_adversaire: 'Jean Dupont' }] }) }));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
}

beforeEach(() => {
    localStorage.clear();
    st.store.clear();
    confirmSpy.mockReset();
    confirmSpy.mockResolvedValue(true);
    localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', status: 'active' }]);
});

describe('R9 point 3 — « Ouvrir l’existante » à l’import', () => {
    it('import d’archive : le dialogue propose la 3e voie, garde les deux fiches et demande l’ouverture', async () => {
        confirmSpy.mockResolvedValueOnce('extra');
        const opened: Array<{ side: string; id: string }> = [];
        const onOpen = (e: Event): void => { opened.push((e as CustomEvent<{ side: string; id: string }>).detail); };
        document.addEventListener('pctac:open-fiche', onOpen);
        await Archive.importFile(await archiveZip());
        document.removeEventListener('pctac:open-fiche', onOpen);
        const firstCall = confirmSpy.mock.calls[0] as unknown as [ { extraLabel?: string } ];
        expect(firstCall[0].extraLabel).toBe("Ouvrir l'existante");
        // Les DEUX fiches sont gardées (aucune fusion).
        expect(Storage.loadCollection(ADVERSARIES_KEY)).toHaveLength(2);
        expect(opened.at(-1)).toEqual({ side: 'adv', id: 'fc1' });
    });

    it('import d’OI : le dialogue propose la 3e voie, garde les deux fiches et demande l’ouverture', async () => {
        confirmSpy.mockResolvedValueOnce('extra');
        const opened: Array<{ side: string; id: string }> = [];
        const onOpen = (e: Event): void => { opened.push((e as CustomEvent<{ side: string; id: string }>).detail); };
        document.addEventListener('pctac:open-fiche', onOpen);
        const res = await Archive.importOiArchive(await oiZip());
        document.removeEventListener('pctac:open-fiche', onOpen);
        expect(res.advAdded).toBe(1);
        expect(res.advMerged).toBe(0);
        expect(Storage.loadCollection(ADVERSARIES_KEY)).toHaveLength(2);
        expect(opened.at(-1)).toEqual({ side: 'adv', id: 'fc1' });
    });
});
