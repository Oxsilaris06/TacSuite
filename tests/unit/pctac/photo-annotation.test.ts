/**
 * photo-annotation.test.ts — Annotation des photos du PC-Tac (décision 25),
 * non destructive comme l'OI : original gardé sous `<base>_orig`, image
 * affichée réécrite, annotations dans la fiche (photo de fiche) ou la photo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const images = new Map<string, string>();
vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(id: string, data: string): Promise<void> { images.set(id, data); },
    async get(id: string): Promise<string | null> { return images.get(id) ?? null; },
    async getMany(ids: string[]): Promise<Record<string, string | null>> { return Object.fromEntries(ids.map((i) => [i, images.get(i) ?? null])); },
    async delete(id: string): Promise<void> { images.delete(id); },
    async deleteMany(ids: string[]): Promise<void> { ids.forEach((i) => images.delete(i)); },
    async clear(): Promise<void> { images.clear(); },
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T>(items: T[]): Promise<T[]> { return items; },
  },
}));

import { Storage } from '@pctac/storage.js';
import { resolvePhotoTarget, saveAnnotations } from '@pctac/photo-annotation.js';
import type { OiAnnotation } from '@shared/types/contracts.js';

const box: OiAnnotation = { id: 1, type: 'box', startX: 1, startY: 1, endX: 5, endY: 5, color: '#c0392b', thickness: 4 } as unknown as OiAnnotation;
const rendered: string[] = [];
const render = async (original: string, anns: OiAnnotation[]): Promise<string> => {
  rendered.push(original);
  return `${original}+${anns.length}`;
};

beforeEach(() => {
  localStorage.clear();
  images.clear();
  rendered.length = 0;
  Storage.saveCollection('pcTacAdversaries', [{ id: 'f1', nom: 'X', hasImage: true }]);
  Storage.saveCollection('pcTacHostages', []);
  Storage.saveCollection('pcTacPhotos', [
    { id: 'p1', title: 'Porte', category: 'other', hasImage: true },
    { id: 'f1_sync', title: 'X', category: 'neutralized', hasImage: true },
  ]);
  images.set('p1', 'P1');
  images.set('f1', 'F1');
  images.set('f1_sync', 'F1');
});

describe('cible d’une photo', () => {
  it('photo de galerie seule : elle-même', () => {
    expect(resolvePhotoTarget('p1')).toEqual({ base: 'p1', keys: ['p1'], owner: { key: 'pcTacPhotos', id: 'p1' } });
  });

  it('copie galerie d’une photo de fiche, ou la fiche : la fiche porte les annotations, les deux images suivent', () => {
    const t = { base: 'f1', keys: ['f1', 'f1_sync'], owner: { key: 'pcTacAdversaries', id: 'f1' } };
    expect(resolvePhotoTarget('f1_sync')).toEqual(t);
    expect(resolvePhotoTarget('f1')).toEqual(t);
  });

  it('inconnue : rien', () => {
    expect(resolvePhotoTarget('zz')).toBeNull();
  });
});

describe('enregistrement', () => {
  it('première annotation : original gardé, image affichée annotée, annotations sur la fiche', async () => {
    await saveAnnotations(resolvePhotoTarget('f1_sync')!, [box], render);
    expect(images.get('f1_orig')).toBe('F1');
    expect(images.get('f1')).toBe('F1+1');
    expect(images.get('f1_sync')).toBe('F1+1');
    const fiche = Storage.loadCollection('pcTacAdversaries')[0]!;
    expect(JSON.parse(String(fiche.annotations))).toEqual([box]);
  });

  it('nouvelle annotation : rendue depuis l’ORIGINAL, jamais depuis l’image déjà annotée', async () => {
    const t = resolvePhotoTarget('p1')!;
    await saveAnnotations(t, [box], render);
    await saveAnnotations(t, [box, { ...box, id: 2 } as unknown as OiAnnotation], render);
    expect(rendered).toEqual(['P1', 'P1']);
    expect(images.get('p1')).toBe('P1+2');
    expect(images.get('p1_orig')).toBe('P1');
  });

  it('plus aucune annotation : l’original revient, `_orig` et les annotations disparaissent', async () => {
    const t = resolvePhotoTarget('p1')!;
    await saveAnnotations(t, [box], render);
    await saveAnnotations(t, [], render);
    expect(images.get('p1')).toBe('P1');
    expect(images.has('p1_orig')).toBe(false);
    expect(Storage.loadCollection('pcTacPhotos')[0]!.annotations).toBeUndefined();
  });

  it('photo jamais annotée, rien dessiné : rien n’est écrit', async () => {
    await saveAnnotations(resolvePhotoTarget('p1')!, [], render);
    expect(images.has('p1_orig')).toBe(false);
    expect(images.get('p1')).toBe('P1');
    expect(rendered).toEqual([]);
  });
});
