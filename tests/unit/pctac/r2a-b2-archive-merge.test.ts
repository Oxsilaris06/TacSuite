/**
 * r2a-b2-archive-merge.test.ts — CONTROLE C12 (B-2) : la fusion à l'import
 * d'archive doit laisser une entrée de galerie `<existante>_sync` et retirer
 * l'entrée `<entrante>_sync` devenue morte.
 *
 * Porté du contrôleur /tmp/claude-1000/controle-ecrans-plan/b2-archive-merge.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const st = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@pctac/image-store.js', () => ({
  GpxStore: { async put() {}, async get() { return null; }, async delete() {}, async clear() {} },
  ImageStore: {
    async put(id: string, d: string) { st.store.set(id, d); },
    async get(id: string) { return st.store.get(id) ?? null; },
    async getMany(ids: readonly string[]) { const o: Record<string, string | null> = {}; ids.forEach((i) => { o[i] = st.store.get(i) ?? null; }); return o; },
    async delete(id: string) { st.store.delete(id); },
    async deleteMany(ids: readonly string[]) { ids.forEach((i) => st.store.delete(i)); },
    async clear() { st.store.clear(); }, async migrateFromLocalStorage() {}, async hydrate<T>(i: T[]) { return i; },
  },
}));
const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@shared/feedback.js', () => ({ confirmDialog: confirmSpy, toast: vi.fn(), showBanner: vi.fn(), hideBanner: vi.fn(), undoableToast: vi.fn() }));
import { resolveDuplicateFiches } from '@pctac/archive.js';
import { Storage } from '@pctac/storage.js';
beforeEach(() => { localStorage.clear(); st.store.clear(); confirmSpy.mockReset(); confirmSpy.mockResolvedValue(true); });
describe('B-2 contrôle : fusion à l import d archive', () => {
  it('la photo reprise de l entrante a une entrée de galerie, sans entrée orpheline', async () => {
    const existing = { id: 'e1', nom: 'Dupont', prenom: 'Jean', status: 'active' };
    const incoming = { id: 'i1', nom: 'Dupont', prenom: 'Jean', status: 'active', hasImage: true };
    Storage.saveCollection('pcTacAdversaries', [existing, incoming]);
    Storage.saveCollection('pcTacPhotos', [{ id: 'i1_sync', title: 'Dupont Jean', category: 'neutralized', status: 'active', hasImage: true }]);
    st.store.set('i1', 'PHOTO_I'); st.store.set('i1_sync', 'PHOTO_I');
    await resolveDuplicateFiches({ pcTacAdversaries: [incoming] }, 'forcene');
    const gal = Storage.loadCollection('pcTacPhotos').map((p) => `${p.id}:${st.store.has(String(p.id)) ? 'blob' : 'SANS BLOB'}`);
    const fiches = Storage.loadCollection('pcTacAdversaries').map((f) => `${f.id}:${f.hasImage}`);
    process.stdout.write(`\nFICHES ${fiches.join(' ')} GALERIE ${gal.join(' ')} BLOBS ${[...st.store.keys()].join(',')}\n`);
    expect(gal).toEqual(['e1_sync:blob']);
  });
});
