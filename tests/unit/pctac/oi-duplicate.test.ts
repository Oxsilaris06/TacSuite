/**
 * oi-duplicate.test.ts — R9 : la passerelle OI doit signaler les doublons de
 * personnes (décision 32), pas créer une seconde fiche en silence.
 *
 * L'OI ne porte qu'un champ nom unique : on compare le nom complet aux deux
 * ordres de `nom`/`prenom`, avec repli sur `nom + date de naissance`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ADVERSARIES_KEY } from '@pctac/config.js';

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

import { Archive, findOiDuplicatePerson } from '@pctac/archive.js';
import { Storage } from '@pctac/storage.js';

async function buildOiZip(oiData: Record<string, unknown>): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
    zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify(oiData) }));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
}

beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); confirmSpy.mockClear(); });

describe('findOiDuplicatePerson', () => {
    it('reconnaît le nom complet dans les deux ordres, et le repli nom + date de naissance', () => {
        const list = [
            { id: 'a', nom: 'Dupont', prenom: 'Jean', dob: '01/01/1980' },
            { id: 'b', nom: 'Martin', prenom: '', dob: '02/02/1990' },
        ];
        expect(findOiDuplicatePerson(list, 'Jean Dupont', '')?.id).toBe('a');
        expect(findOiDuplicatePerson(list, 'Dupont Jean', '01/01/1980')?.id).toBe('a');
        expect(findOiDuplicatePerson(list, 'Jean Martin', '02/02/1990')?.id).toBe('b');
        expect(findOiDuplicatePerson(list, 'Inconnu', '01/01/1980')).toBeNull();
    });
});

describe('importOiArchive — doublon signalé et fusionnable (R9)', () => {
    it('ne crée pas une seconde fiche quand nom inversé + même date de naissance', async () => {
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'field1', nom: 'Dupont', prenom: 'Jean', dob: '01/01/1980' }]);
        const file = await buildOiZip({
            adversaries: [{ id: 'adv1', nom_adversaire: 'Jean Dupont', date_naissance: '01/01/1980', domicile_adversaire: '3 rue TP' }],
        });
        const result = await Archive.importOiArchive(file);

        expect(confirmSpy).toHaveBeenCalled();
        const firstCall = confirmSpy.mock.calls[0] as unknown as [{ title?: string }] | undefined;
        expect(firstCall?.[0].title).toBe('Fiche en double');
        expect(result.advAdded).toBe(0);
        const list = Storage.loadCollection(ADVERSARIES_KEY);
        expect(list).toHaveLength(1);
        // La fiche existante garde son id et reçoit le domicile manquant.
        expect(list[0]).toMatchObject({ id: 'field1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue TP' });
    });
});
