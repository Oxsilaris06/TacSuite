/**
 * pc-merge-gallery.test.ts — Galerie après une fusion de fiches (revue finale,
 * F13). `syncMergedGallery` ne CRÉE l'entrée `<gardée>_sync` que si la photo
 * vient d'être reprise de la fiche entrante ; sinon il n'actualise qu'une entrée
 * existante. Sans quoi une copie de galerie supprimée volontairement revenait,
 * sans image, à la fusion suivante.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        async put(id: string, v: string): Promise<void> { store.set(id, v); },
        async get(id: string): Promise<string | null> { return store.get(id) ?? null; },
        async delete(id: string): Promise<void> { store.delete(id); },
        async deleteMany(ids: readonly string[]): Promise<void> { ids.forEach((i) => store.delete(i)); },
    },
}));

import { PHOTOS_KEY } from '@pctac/config.js';
import { Storage } from '@pctac/storage.js';
import { mergePersonIntoExisting, syncMergedGallery } from '@pctac/fiche-merge.js';

beforeEach(() => {
    localStorage.clear();
    store.clear();
});

describe('syncMergedGallery (F13)', () => {
    it('existante avec photo dont la copie de galerie a été supprimée : la fusion ne la fait pas revenir', async () => {
        store.set('e1', 'data:image/png;base64,RQ==');
        const existing = { id: 'e1', nom: 'Dupont', prenom: 'Jean', hasImage: true };
        const incoming = { id: 'i1', nom: 'Dupont', prenom: 'Jean', domicile: '3 rue X' };
        const { merged, photoTaken } = await mergePersonIntoExisting(existing, incoming);
        expect(photoTaken).toBe(false);
        syncMergedGallery('adv', 'i1', merged, { photoTaken });
        expect(Storage.loadCollection(PHOTOS_KEY).map((p) => p.id)).toEqual([]);
    });

    it('existante sans photo, entrante avec photo : l’entrée de galerie est créée', async () => {
        store.set('i1', 'data:image/png;base64,SQ==');
        const existing = { id: 'e1', nom: 'Dupont', prenom: 'Jean' };
        const incoming = { id: 'i1', nom: 'Dupont', prenom: 'Jean', hasImage: true };
        const { merged, photoTaken } = await mergePersonIntoExisting(existing, incoming);
        expect(photoTaken).toBe(true);
        syncMergedGallery('adv', 'i1', merged, { photoTaken });
        expect(Storage.loadCollection(PHOTOS_KEY).map((p) => p.id)).toEqual(['e1_sync']);
    });

    it('entrée de galerie existante : elle est actualisée, l’entrée de l’entrante retirée', () => {
        Storage.saveCollection(PHOTOS_KEY, [
            { id: 'e1_sync', title: 'ancien', hasImage: true },
            { id: 'i1_sync', title: 'entrante', hasImage: true },
        ]);
        syncMergedGallery('adv', 'i1', { id: 'e1', nom: 'Dupont', prenom: 'Jean', hasImage: true }, { photoTaken: false });
        const photos = Storage.loadCollection(PHOTOS_KEY);
        expect(photos.map((p) => p.id)).toEqual(['e1_sync']);
        expect(photos[0]?.title).not.toBe('ancien');
    });
});
