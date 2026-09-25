/**
 * rb-photoxss.test.ts — R7/R18 (défense en profondeur côté affichage) : un
 * contenu d'image venu d'une archive ne doit jamais créer d'attribut HTML.
 * La validation à l'import est du ressort de RA.
 */

import { describe, expect, it, vi } from 'vitest';
const blobs = new Map<string, string>();
vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(id: string, d: string): Promise<void> { blobs.set(id, d); },
    async get(id: string): Promise<string | null> { return blobs.get(id) ?? null; },
    async getMany(ids: string[]): Promise<Record<string, string | null>> { return Object.fromEntries(ids.map((i) => [i, blobs.get(i) ?? null])); },
    async delete(): Promise<void> {}, async deleteMany(): Promise<void> {}, async clear(): Promise<void> {},
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[], field = 'data'): Promise<T[]> {
      return items.map((i) => (blobs.get(i.id) ? { ...i, [field]: blobs.get(i.id) } : i));
    },
  },
}));
import { UI } from '@pctac/ui.js';
import { Storage } from '@pctac/storage.js';

describe('galerie Photos : contenu d image venu d une archive (R7/R18)', () => {
  it('une image dont le texte contient un guillemet n ajoute pas d attribut', async () => {
    document.body.innerHTML = '<div id="photo-filter-container"></div><div id="photo-board"></div><div id="photos-grid"></div>';
    // Ce qu'écrit Archive.importZip : ImageStore.put(id, <contenu brut du fichier images/<id>.txt>)
    blobs.set('p1', 'x" onerror="window.__xss=1');
    Storage.saveCollection('pcTacPhotos', [{ id: 'p1', title: 'T', category: 'trap', hasImage: true }]);
    UI.initElements?.();
    await UI.renderPhotos('all');
    const img = document.querySelector('.photo-card img');
    expect(img?.hasAttribute('onerror')).toBe(false);
  });

  it('les attributs dupliqués (catégorie, statut) sont échappés aussi', async () => {
    document.body.innerHTML = '<div id="photo-filter-container"></div><div id="photo-board"></div>';
    blobs.set('p2', 'data:image/png;base64,AAA');
    Storage.saveCollection('pcTacPhotos', [{ id: 'p2', title: 'T', category: 'x" onmouseover="1', status: 'y" onfocus="2', hasImage: true }]);
    UI.initElements?.();
    await UI.renderPhotos('all');
    const card = document.querySelector('.photo-card');
    expect(card?.hasAttribute('onmouseover')).toBe(false);
  });
});
