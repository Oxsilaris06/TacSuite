/**
 * merge-image.test.ts — R3 : en fusion, une fiche locale plus récente garde
 * AUSSI sa photo ; l'image ancienne de l'archive ne l'écrase pas.
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

beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); });

describe('fusion : la fiche locale plus récente gagne… mais sa photo ?', () => {
    it('garde la photo de la fiche locale plus récente', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([{ id: 'a1', nom: 'Dupont', hasImage: true, updatedAt: '2026-09-25T12:00:00.000Z' }]));
        imageStoreState.store.set('a1', 'data:image/png;base64,LOCAL_RECENTE=');
        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({ appName: 'PC TAC', version: 1, situation: 'forcene' }));
        zip.file('data.json', JSON.stringify({ [ADVERSARIES_KEY]: JSON.stringify([{ id: 'a1', nom: 'Dupont', hasImage: true, updatedAt: '2026-09-25T08:00:00.000Z' }]) }));
        zip.file('images/a1.txt', 'data:image/png;base64,ARCHIVE_ANCIENNE=');
        const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'a.pctac.zip');
        await Archive.importFile(file);
        expect(imageStoreState.store.get('a1')).toBe('data:image/png;base64,LOCAL_RECENTE=');
    });
});
