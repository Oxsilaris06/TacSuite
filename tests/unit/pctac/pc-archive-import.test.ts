/**
 * pc-archive-import.test.ts — Import d'archive : liste blanche, version, fusion
 * par date, doublons et récapitulatif (décision 32/A5).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { ADVERSARIES_KEY, FREE_MODE_COLORS, LOCAL_STORAGE_KEY } from '@pctac/config.js';

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

    it('nomme les fiches ajoutées et les éléments supprimés ici non repris (A7)', () => {
        expect(importSummaryMessage([], [], 0, ['Durand'], { fiches: ['Dupont'], others: 2 }))
            .toBe('1 fiche ajoutée : Durand. 1 fiche supprimée ici, non reprise : Dupont. 2 éléments supprimés ici, non repris.');
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

    it('normalise une couleur forgée (paxColor du journal, color des intervenants) — A1', async () => {
        const payload = '#fff"><img id="pwn" src=x onerror="1">';
        const file = await buildZip(
            { appName: 'PC TAC', version: 1 },
            {
                [LOCAL_STORAGE_KEY]: JSON.stringify([{ id: 'l1', heure: '10:00', pax: 'X', paxMode: 'free', paxColor: payload, lieu: '', remarques: '' }]),
                pcTacCustomPax: JSON.stringify([{ id: 'p1', name: 'Z', color: payload }]),
            },
        );
        const result = await Archive.importFile(file);
        expect(result).toMatchObject({ ok: true });
        expect(Storage.loadLogData()[0]?.paxColor).toBe(FREE_MODE_COLORS[0]?.hex);
        expect(Storage.loadCollection('pcTacCustomPax')[0]?.color).toBe(FREE_MODE_COLORS[0]?.hex);
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

describe('Revue du 25/09 — écriture concurrente pendant un dialogue de doublon (A3)', () => {
    it('une fiche créée dans un autre onglet pendant le dialogue survit à la fusion', async () => {
        Storage.saveCollection(ADVERSARIES_KEY, [
            { id: 'local1', nom: 'Dupont', prenom: 'Jean' },
            { id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue' },
        ]);
        confirmSpy.mockImplementationOnce(async () => {
            // L'autre onglet crée une fiche pendant que l'opérateur réfléchit.
            Storage.saveCollection(ADVERSARIES_KEY, [...Storage.loadCollection(ADVERSARIES_KEY), { id: 'other-tab', nom: 'Autre' }]);
            return true;
        });
        await resolveDuplicateFiches({ [ADVERSARIES_KEY]: [{ id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue' }] });
        const list = Storage.loadCollection(ADVERSARIES_KEY);
        const ids = list.map((f) => f.id);
        expect(ids).toContain('other-tab');
        expect(ids).toContain('local1');
        expect(ids).not.toContain('remote1');
        expect(list.find((f) => f.id === 'local1')).toMatchObject({ domicile: '3 rue' });
    });
});

describe('Revue du 25/09 — export incomplet (A10)', () => {
    it('une photo illisible fait échouer l’export (rien ne sera effacé) et le dit', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'X', hasImage: true }]);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        vi.spyOn(ImageStore, 'get').mockRejectedValue(new Error('IndexedDB perdu'));
        await expect(Archive.exportZip()).resolves.toBe(false);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('illisible'), expect.objectContaining({ kind: 'error' }));
        // V4 : l'archive PARTIELLE est quand même téléchargée (main courante, fiches).
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('V4 : une base d’images en panne sans aucune photo attendue n’empêche pas l’export', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'X' }]);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        vi.spyOn(ImageStore, 'get').mockRejectedValue(new Error('IndexedDB perdu'));
        await expect(Archive.exportZip()).resolves.toBe(true);
    });

    it('V5 : une fiche entrante fusionnée dans une existante reçoit une pierre (réimport sans doublon)', async () => {
        const { readTombstones } = await import('@pctac/tombstones.js');
        Storage.saveCollection(ADVERSARIES_KEY, [
            { id: 'local1', nom: 'Dupont', prenom: 'Jean' },
            { id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue' },
        ]);
        await resolveDuplicateFiches({ [ADVERSARIES_KEY]: [{ id: 'remote1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue' }] });
        expect(readTombstones('forcene').map((t) => t.itemId)).toEqual(['remote1']);
    });
});

describe('import d’un journal .json ancien format (revue client D-2)', () => {
    const legacy = (logEntries: unknown[]): File => new File(
        [JSON.stringify({ metadata: { appName: 'PC Tac Log' }, logEntries })],
        'journal.json', { type: 'application/json' },
    );

    it('refuse un identifiant hors format ou une entrée qui n’est pas un objet, sans rien modifier', async () => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: 'l0', heure: '08:00', pax: 'Inter', remarques: 'avant' }]));
        const before = localStorage.getItem(LOCAL_STORAGE_KEY);
        await expect(Archive.importFile(legacy([{ id: `x');alert(1);('`, heure: '09:00' }]))).rejects.toThrow(/identifiant/);
        await expect(Archive.importFile(legacy(['texte', null]))).rejects.toThrow(/entrée/);
        expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(before);
    });

    it('importe un journal sain', async () => {
        await Archive.importFile(legacy([{ id: 'l1', heure: '09:00', pax: 'Inter', remarques: 'RAS' }]));
        expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toContain('RAS');
    });
});
