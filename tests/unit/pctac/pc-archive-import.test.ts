/**
 * pc-archive-import.test.ts — Import d'archive : liste blanche, version, fusion
 * par date, doublons et récapitulatif (décision 32/A5).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { ADVERSARIES_KEY, LOCAL_STORAGE_KEY } from '@pctac/config.js';

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

const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({
    confirmDialog: confirmSpy,
    toast: toastSpy,
    showBanner: vi.fn(),
    hideBanner: vi.fn(),
}));

vi.mock('@pctac/photo-annotation.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@pctac/photo-annotation.js')>()),
    renderAnnotated: vi.fn(async (original: string) => original),
}));

import {
    Archive,
    filterImportKeys,
    importSummaryMessage,
    resolveDuplicateFiches,
} from '@pctac/archive.js';
import { mergePersonIntoExisting } from '@pctac/fiche-merge.js';
import { ImageStore } from '@pctac/image-store.js';
import { Storage } from '@pctac/storage.js';
import { PCTAC_MODE_KEY } from '@pctac/modes.js';

async function buildZip(manifest: Record<string, unknown> | null, data: Record<string, unknown>): Promise<File> {
    const zip = new JSZip();
    if (manifest !== null) zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('data.json', JSON.stringify(data));
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return new File([buf], 'test.pctac.zip');
}

function dumpLocalStorage(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k != null) out[k] = localStorage.getItem(k) ?? '';
    }
    return out;
}

beforeEach(() => {
    localStorage.clear();
    imageStoreState.store.clear();
    confirmSpy.mockClear();
    confirmSpy.mockResolvedValue(true);
    toastSpy.mockClear();
    document.body.innerHTML = '';
});

describe('filterImportKeys — liste blanche', () => {
    it('ne garde que les clés qu’un export produit, et compte le reste', () => {
        const { allowed, unknownKeys } = filterImportKeys({
            [LOCAL_STORAGE_KEY]: '[]',
            cleInconnue: '"x"',
            pcTacTchapLive: '"secret"',
        });
        expect(Object.keys(allowed)).toEqual([LOCAL_STORAGE_KEY]);
        expect(unknownKeys).toBe(2);
    });

    it('ignore une clé connue portant une valeur non textuelle', () => {
        const { allowed, unknownKeys } = filterImportKeys({ [LOCAL_STORAGE_KEY]: 42 });
        expect(allowed).toEqual({});
        expect(unknownKeys).toBe(1);
    });
});

describe('importSummaryMessage', () => {
    it('compose le récapitulatif (remplacées, fusionnées, ignorées)', () => {
        expect(importSummaryMessage(['Dupont'], ['Martin'], 3))
            .toBe('1 fiche remplacée : Dupont. 1 fiche fusionnée : Martin. 3 éléments inconnus ignorés.');
        expect(importSummaryMessage([], [], 0)).toBeNull();
    });
});

describe('importFile — version (décision 32)', () => {
    it('refuse une archive de version 2 AVANT toute écriture', async () => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: '1' }]));
        const before = dumpLocalStorage();
        const file = await buildZip({ appName: 'PC TAC', version: 2 }, { [LOCAL_STORAGE_KEY]: '[]' });
        await expect(Archive.importFile(file)).rejects.toThrow(/version plus récente/);
        expect(dumpLocalStorage()).toEqual(before);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('refuse une version 2 écrite en chaîne', async () => {
        const file = await buildZip({ appName: 'PC TAC', version: '2' }, {});
        await expect(Archive.importFile(file)).rejects.toThrow(/version plus récente/);
    });

    it('accepte une archive sans version (traitée comme 1)', async () => {
        const file = await buildZip({ appName: 'PC TAC' }, { [LOCAL_STORAGE_KEY]: '[]' });
        await expect(Archive.importFile(file)).resolves.toMatchObject({ ok: true });
    });
});

describe('importFile — liste blanche et récapitulatif', () => {
    it('ignore une clé inconnue et la compte, sans l’écrire', async () => {
        const file = await buildZip(
            { appName: 'PC TAC', version: 1 },
            { [LOCAL_STORAGE_KEY]: '[]', cleInconnue: '"x"' },
        );
        const result = await Archive.importFile(file);
        expect(result).toMatchObject({ ok: true, unknownKeys: 1 });
        expect(localStorage.getItem('cleInconnue')).toBeNull();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('1 élément inconnu ignoré'), expect.anything());
    });

    it('n’écrit JAMAIS une clé commune forgée', async () => {
        const file = await buildZip(
            { appName: 'PC TAC', version: 1 },
            { [LOCAL_STORAGE_KEY]: '[]', pcTacTchapLive: '"jeton-forge"' },
        );
        const result = await Archive.importFile(file);
        expect(result).toMatchObject({ ok: true, unknownKeys: 1 });
        expect(localStorage.getItem('pcTacTchapLive')).toBeNull();
    });
});

describe('exportZip — nom de fichier lisible (décision 32)', () => {
    it('nomme l’archive d’après le libellé de la situation, sans nom de personne', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        let download = '';
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            download = this.download;
        });
        await expect(Archive.exportZip()).resolves.toBe(true);
        expect(download).toMatch(/^PC-Tac_Forcene_\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.pctac\.zip$/);
        vi.restoreAllMocks();
    });
});

describe('mergePersonIntoExisting — recopie UNIQUE des images de fusion (A-4/R4)', () => {
    it('recopie la photo entrante vers l’id gardé quand l’existante n’en a pas', async () => {
        await ImageStore.put('remote1', 'data:image/png;base64,AAA=');
        await ImageStore.put('remote1_sync', 'data:image/png;base64,BBB=');
        const { merged } = await mergePersonIntoExisting(
            { id: 'local1', nom: 'X' },
            { id: 'remote1', nom: 'X', hasImage: true },
        );
        expect(merged.hasImage).toBe(true);
        expect(await ImageStore.get('local1')).toBe('data:image/png;base64,AAA=');
        expect(await ImageStore.get('local1_sync')).toBe('data:image/png;base64,BBB=');
    });

    it('garde la photo de l’existante et ne prend NI l’original NI les annotations de l’entrante (R4)', async () => {
        await ImageStore.put('local2', 'PHOTO_LOCALE');
        await ImageStore.put('remote2', 'PHOTO_ENTRANTE');
        await ImageStore.put('remote2_orig', 'ORIG_ENTRANT');
        const { merged } = await mergePersonIntoExisting(
            { id: 'local2', nom: 'X', hasImage: true },
            { id: 'remote2', nom: 'X', hasImage: true, annotations: '[{"type":"box"}]' },
        );
        expect(merged.hasImage).toBe(true);
        expect(merged.annotations).toBeUndefined();
        expect(await ImageStore.get('local2')).toBe('PHOTO_LOCALE');
        expect(await ImageStore.get('local2_orig')).toBeNull();
    });

    it('retire hasImage si la photo entrante est introuvable', async () => {
        const { merged } = await mergePersonIntoExisting(
            { id: 'local4', nom: 'X' },
            { id: 'remote4', nom: 'X', hasImage: true },
        );
        expect(merged.hasImage).toBeUndefined();
    });
});

describe('resolveDuplicateFiches — doublon fusionné (décision 32)', () => {
    it('fusionne une fiche importée avec l’existante, champs vides complétés, et la retire', async () => {
        // État APRÈS applyScope : la fiche importée a déjà été ajoutée.
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'local1', nom: 'Dupont', prenom: 'Jean', domicile: '' }]);
        Storage.saveCollection(ADVERSARIES_KEY, [
            ...Storage.loadCollection(ADVERSARIES_KEY),
            { id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue', hasImage: true },
        ]);
        await ImageStore.put('remote1', 'data:image/png;base64,AAA=');
        await ImageStore.put('remote1_sync', 'data:image/png;base64,BBB=');

        const merged = await resolveDuplicateFiches({
            [ADVERSARIES_KEY]: [{ id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue', hasImage: true }],
        });

        expect(merged).toEqual(['Jean Dupont']);
        const list = Storage.loadCollection(ADVERSARIES_KEY);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ id: 'local1', domicile: '3 rue', hasImage: true });
        // La photo de l'entrante a suivi vers l'id gardé, les blobs entrants sont nettoyés.
        expect(await ImageStore.get('local1')).toBe('data:image/png;base64,AAA=');
        expect(await ImageStore.get('local1_sync')).toBe('data:image/png;base64,BBB=');
        expect(await ImageStore.get('remote1')).toBeNull();
    });

    it('« Garder les deux » : rien n’est fusionné ni retiré', async () => {
        Storage.saveCollection(ADVERSARIES_KEY, [
            { id: 'local1', nom: 'Dupont', prenom: 'Jean', domicile: '' },
            { id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue' },
        ]);
        confirmSpy.mockResolvedValue(false);
        const merged = await resolveDuplicateFiches({
            [ADVERSARIES_KEY]: [{ id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue' }],
        });
        expect(merged).toEqual([]);
        expect(Storage.loadCollection(ADVERSARIES_KEY)).toHaveLength(2);
    });
});
