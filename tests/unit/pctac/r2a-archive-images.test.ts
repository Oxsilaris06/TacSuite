/**
 * r2a-archive-images.test.ts — CONTROLE C1 (régression R3) et C4 (fusion de
 * doublon à l'import) : les entrées de galerie `<fiche>_sync` doivent avoir
 * leur image, et une fusion ne doit laisser ni vignette morte ni photo reprise
 * hors galerie.
 *
 * Porté du contrôleur /tmp/claude-1000/controle-socle/archive-images.test.ts.
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
const scopeState = vi.hoisted(() => ({ scope: { categories: ['adversaires'], mode: 'merge', full: false } as { categories: string[]; mode: string; full: boolean } }));
vi.mock('@pctac/import-scope.js', async (orig) => ({
    ...(await orig<typeof import('@pctac/import-scope.js')>()),
    askImportScope: vi.fn(async () => scopeState.scope),
}));

import { Archive } from '@pctac/archive.js';
import { PCTAC_MODE_KEY } from '@pctac/modes.js';

// Base64 VALIDE (le sanitizer R7 rejette « _ ») : sinon un test R3 passe à vide.
const LOCAL = 'data:image/png;base64,TE9DQUw=';
const OLD = 'data:image/png;base64,T0xE';
const SYNC = 'data:image/png;base64,U1lOQw==';

async function makeZip(situation: string, data: Record<string, unknown>, images: Record<string, string>): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'PC TAC', version: 1, situation }));
    const d: Record<string, string> = {};
    Object.entries(data).forEach(([k, v]) => { d[k] = JSON.stringify(v); });
    zip.file('data.json', JSON.stringify(d));
    Object.entries(images).forEach(([id, url]) => zip.file(`images/${id}.txt`, url));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'a.pctac.zip');
}

beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); confirmSpy.mockReset(); confirmSpy.mockResolvedValue(true); localStorage.setItem(PCTAC_MODE_KEY, 'forcene'); });

describe('R3 rejoué avec un base64 valide', () => {
    it('fiche locale plus récente : sa photo n’est pas écrasée', async () => {
        scopeState.scope = { categories: ['adversaires'], mode: 'merge', full: false };
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([{ id: 'a1', nom: 'X', hasImage: true, updatedAt: '2026-09-25T12:00:00.000Z' }]));
        imageStoreState.store.set('a1', LOCAL);
        await Archive.importFile(await makeZip('forcene', { [ADVERSARIES_KEY]: [{ id: 'a1', nom: 'X', hasImage: true, updatedAt: '2026-09-25T08:00:00.000Z' }] }, { a1: OLD, a1_sync: OLD }));
        expect(imageStoreState.store.get('a1')).toBe(LOCAL);
    });
});

describe('Régression R3 : entrées de galerie `<fiche>_sync`', () => {
    it('import « Photos » seul en fusion : la vignette `a1_sync` ajoutée a son image', async () => {
        scopeState.scope = { categories: ['photos'], mode: 'merge', full: false };
        await Archive.importFile(await makeZip('forcene', {
            [PHOTOS_KEY]: [{ id: 'a1_sync', title: 'Dupont', category: 'neutralized', status: 'active', hasImage: true }],
        }, { a1_sync: SYNC }));
        const gallery = JSON.parse(localStorage.getItem(PHOTOS_KEY) ?? '[]');
        console.log('GALLERY', JSON.stringify(gallery), 'BLOB a1_sync', imageStoreState.store.get('a1_sync'));
        expect(gallery.map((p: { id: string }) => p.id)).toContain('a1_sync');
        expect(imageStoreState.store.get('a1_sync')).toBe(SYNC);
    });
    it('import « Photos » seul en REMPLACEMENT : idem', async () => {
        scopeState.scope = { categories: ['photos'], mode: 'replace', full: false };
        await Archive.importFile(await makeZip('forcene', {
            [PHOTOS_KEY]: [{ id: 'a1_sync', title: 'Dupont', category: 'neutralized', status: 'active', hasImage: true }],
        }, { a1_sync: SYNC }));
        expect(imageStoreState.store.get('a1_sync')).toBe(SYNC);
    });
});

describe('Fusion de doublon à l’import (R1/A-4) et galerie', () => {
    it('après « Fusionner », pas de vignette morte ni de photo reprise hors galerie', async () => {
        scopeState.scope = { categories: ['adversaires', 'photos'], mode: 'merge', full: false };
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([{ id: 'fc1', nom: 'Dupont', prenom: 'Jean' }]));
        localStorage.setItem(PHOTOS_KEY, JSON.stringify([]));
        confirmSpy.mockResolvedValueOnce(true); // Fusionner
        await Archive.importFile(await makeZip('forcene', {
            [ADVERSARIES_KEY]: [{ id: 'tp1', nom: 'Dupont', prenom: 'Jean', hasImage: true }],
            [PHOTOS_KEY]: [{ id: 'tp1_sync', title: 'Dupont', category: 'neutralized', status: 'active', hasImage: true }],
        }, { tp1: SYNC, tp1_sync: SYNC }));
        const adv = JSON.parse(localStorage.getItem(ADVERSARIES_KEY) ?? '[]');
        const gallery = JSON.parse(localStorage.getItem(PHOTOS_KEY) ?? '[]');
        const s = imageStoreState.store;
        console.log('ADV', JSON.stringify(adv));
        console.log('GALLERY', JSON.stringify(gallery.map((p: { id: string }) => p.id)), 'blobs', [...s.keys()]);
        const dead = gallery.filter((p: { id: string; hasImage?: boolean }) => p.hasImage && !s.has(p.id)).map((p: { id: string }) => p.id);
        expect(dead).toEqual([]);
        expect(gallery.map((p: { id: string }) => p.id)).toContain('fc1_sync');
    });
});

describe('D-1 (revue de sécurité du 2026-09-26) : noms d’entrées d’images validés', () => {
    it('import complet : une entrée au nom hors format n’est jamais stockée, les autres oui', async () => {
        scopeState.scope = { categories: ['adversaires', 'photos'], mode: 'replace', full: true };
        await Archive.importFile(await makeZip('forcene', {
            [ADVERSARIES_KEY]: [{ id: 'a9', nom: 'X', hasImage: true }],
        }, { a9: SYNC, 'x"><img src=y': SYNC, ['b'.repeat(200)]: SYNC }));
        expect(imageStoreState.store.get('a9')).toBe(SYNC);
        expect([...imageStoreState.store.keys()].every((k) => /^[A-Za-z0-9_.:-]{1,128}$/.test(k))).toBe(true);
    });
});
