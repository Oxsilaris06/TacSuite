/**
 * merge-annot.test.ts — R4 : fusionner ne doit pas marier la photo de la fiche
 * gardée avec l'original et les annotations de la fiche entrante.
 *
 * Depuis A-4, la seule recopie d'images de fusion vit dans `fiche-merge.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
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
import { mergePersonIntoExisting } from '@pctac/fiche-merge.js';

describe('fusion : photo existante + annotations de l’entrante', () => {
    it('ne doit pas marier la photo de l’existante avec l’original et les annotations de l’entrante', async () => {
        const s = imageStoreState.store;
        s.set('L', 'PHOTO_EXISTANTE');
        s.set('R', 'PHOTO_ENTRANTE_ANNOTEE'); s.set('R_orig', 'ORIGINAL_ENTRANT');
        const existing = { id: 'L', nom: 'Dupont', prenom: 'Jean', hasImage: true };
        const incoming = { id: 'R', nom: 'Dupont', prenom: 'Jean', hasImage: true, annotations: '[{"type":"box"}]' };
        const { merged } = await mergePersonIntoExisting(existing, incoming);
        // Invariant : L_orig est l'original de la photo L — ici, il n'y en a pas.
        expect(merged.hasImage).toBe(true);
        expect(merged.annotations).toBeUndefined();
        expect(s.get('L_orig') ?? null).toBeNull();
        expect(s.get('L')).toBe('PHOTO_EXISTANTE');
    });
});
