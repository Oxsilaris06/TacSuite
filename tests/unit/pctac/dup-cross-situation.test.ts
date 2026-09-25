/**
 * dup-cross-situation.test.ts — R1 : la fusion de doublons lit/écrit la
 * situation CIBLE de l'archive, jamais celle affichée.
 *
 * Scénario : le poste affiche Forcené (qui contient fc1), on importe une
 * archive TP qui porte tp1 « Jean Dupont ». La fusion ne doit toucher AUCUNE
 * fiche Forcené et ne doit pas effacer la photo de tp1.
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
            async getMany(ids: readonly string[]) { const o: Record<string, string | null> = {}; ids.forEach((i) => { o[i] = store.get(i) ?? null; }); return o; },
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
vi.mock('@pctac/import-scope.js', async (orig) => ({
    ...(await orig<typeof import('@pctac/import-scope.js')>()),
    askImportScope: vi.fn(async () => ({ categories: ['adversaires'], mode: 'merge', full: false })),
}));

import { Archive } from '@pctac/archive.js';
import { PCTAC_MODE_KEY } from '@pctac/modes.js';

beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); confirmSpy.mockClear(); });

describe('resolveDuplicateFiches — situation cible ≠ situation affichée', () => {
    it('une archive TP importée depuis Forcené ne doit jamais toucher les fiches Forcené', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        // Forcené (clé nue) : une fiche Jean Dupont.
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', domicile: '' }]));
        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({ appName: 'PC TAC', version: 1, situation: 'tp' }));
        zip.file('data.json', JSON.stringify({ [ADVERSARIES_KEY]: JSON.stringify([{ id: 'tp1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue TP', hasImage: true }]) }));
        zip.file('images/tp1.txt', 'data:image/png;base64,TP=');
        const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'a.pctac.zip');
        confirmSpy.mockResolvedValueOnce(true); // « Basculer ? » non pertinent
        confirmSpy.mockResolvedValueOnce(false);
        await Archive.importFile(file);
        const forcene = JSON.parse(localStorage.getItem(ADVERSARIES_KEY) ?? '[]');
        const tp = JSON.parse(localStorage.getItem(ADVERSARIES_KEY + '@tp') ?? '[]');
        expect(forcene).toEqual([{ id: 'fc1', nom: 'Dupont', prenom: 'Jean', domicile: '' }]);
        expect(tp).toHaveLength(1);
        expect(imageStoreState.store.get('tp1')).toBe('data:image/png;base64,TP=');
    });
});
