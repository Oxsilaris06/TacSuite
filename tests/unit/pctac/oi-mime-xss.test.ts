/**
 * oi-mime-xss.test.ts — R7 : le type MIME d'`images.json` vient de l'archive,
 * donc du réseau. Un MIME hors liste est ramené à `image/jpeg`, jamais
 * concaténé tel quel dans `data:${mime};base64,…`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

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
vi.mock('@shared/feedback.js', () => ({ confirmDialog: vi.fn(async () => true), toast: vi.fn(), showBanner: vi.fn(), hideBanner: vi.fn() }));

import { Archive, sanitizeImageDataUrl, stableOiPhotoId } from '@pctac/archive.js';

beforeEach(() => { localStorage.clear(); imageStoreState.store.clear(); });

describe('OI → galerie : type MIME venu de images.json', () => {
    it('ne doit pas stocker un data URL portant un guillemet (rendu dans src="${item.data}")', async () => {
        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({ appName: 'OI' }));
        zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_objectif: [{ id: 'img_1' }] } }) }));
        zip.file('images.json', JSON.stringify({ img_1: 'image/png" onerror="window.__pwn=1' }));
        zip.folder('images')!.file('img_1.bin', Buffer.from('x').toString('base64'), { base64: true });
        const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 't.oi.zip');
        await Archive.importOiArchive(file);
        const stored = imageStoreState.store.get(stableOiPhotoId('img_1')) ?? '';
        // Même gabarit que ui.ts renderPhotos : <img src="${item.data}">
        const host = document.createElement('div');
        host.innerHTML = `<img src="${stored}" alt="x">`;
        expect(host.querySelector('img')!.hasAttribute('onerror')).toBe(false);
        expect(stored.startsWith('data:image/jpeg;base64,')).toBe(true);
    });

    it('sanitizeImageDataUrl : type hors liste ramené à jpeg, contenu non-image rejeté', () => {
        expect(sanitizeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe('data:image/jpeg;base64,PHN2Zz4=');
        expect(sanitizeImageDataUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(sanitizeImageDataUrl('x" onerror="1')).toBeNull();
        expect(sanitizeImageDataUrl('data:text/html;base64,AAAA')).toBeNull();
    });
});
