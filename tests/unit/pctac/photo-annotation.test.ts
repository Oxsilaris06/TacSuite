/**
 * photo-annotation.test.ts — Annotation des photos du PC-Tac (décision 25),
 * non destructive comme l'OI : original gardé sous `<base>_orig`, image
 * affichée réécrite, annotations dans la fiche (photo de fiche) ou la photo.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Moteur : rendu sans canvas (jsdom) ; la recompression passe par Utils (espionné).
vi.mock('@oi/dessin.js', () => ({ createAnnotatedImageBlob: vi.fn(async () => new Blob(['png'])) }));

import { Storage } from '@pctac/storage.js';
import { Utils } from '@pctac/utils.js';
import { annotatePhoto, resolvePhotoTarget, saveAnnotations } from '@pctac/photo-annotation.js';
import { annotationHost } from '@shared/annotation-host.js';
import type { OiAnnotation } from '@shared/types/contracts.js';
import { flush, installDialog } from './fiche-helpers.js';

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

describe('revue : original et écriture', () => {
  it('un `_orig` sans annotations sur le propriétaire est périmé : ignoré et retiré', async () => {
    images.set('f1', 'ROUGE');
    images.set('f1_sync', 'ROUGE');
    images.set('f1_orig', 'BLEU'); // import partiel ou écriture interrompue
    await saveAnnotations(resolvePhotoTarget('f1')!, [], render);
    expect(images.get('f1')).toBe('ROUGE');
    expect(images.has('f1_orig')).toBe(false);
    await saveAnnotations(resolvePhotoTarget('f1')!, [box], render);
    expect(rendered).toEqual(['ROUGE']);
  });

  it('stockage plein : l’annotation n’est pas enregistrée, rien de visible ne change', async () => {
    const setItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === 'pcTacPhotos') throw new DOMException('plein', 'QuotaExceededError');
      setItem(k, v);
    });
    await expect(saveAnnotations(resolvePhotoTarget('p1')!, [box], render)).rejects.toThrow();
    vi.restoreAllMocks();
    expect(images.get('p1')).toBe('P1');
    expect(images.has('p1_orig')).toBe(false);
  });
});

describe('fenêtre', () => {
  const opened: string[] = [];
  const preview = (): HTMLImageElement => document.getElementById('pctacAnnotationPreview') as HTMLImageElement;
  const modal = (): HTMLDialogElement => document.getElementById('annotationModal') as HTMLDialogElement;
  const closeModal = (): void => { modal().open = true; modal().close(); };

  beforeAll(() => {
    installDialog();
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = vi.fn();
    // jsdom ne décode rien : une image « MAUVAISE » est illisible.
    HTMLImageElement.prototype.decode = function decode(this: HTMLImageElement) {
      return this.src.includes('TUFVVkFJU0U') ? Promise.reject(new Error('illisible')) : Promise.resolve();
    };
  });

  beforeEach(() => {
    opened.length = 0;
    window.openAnnotationModal = vi.fn(async (id: string) => { opened.push(preview()?.dataset.annotations ?? id); });
    images.set('p1', 'data:image/png;base64,UDE=');
    vi.spyOn(Utils, 'compressImage').mockResolvedValue('data:image/jpeg;base64,QU5O');
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('Annuler (annotations revenues à l’ouverture) : rien n’est réécrit, la promesse dit « non enregistré »', async () => {
    const done = annotatePhoto('p1');
    await flush();
    annotationHost.annotations = [];
    closeModal();
    expect(await done).toBe(false);
    expect(images.get('p1')).toBe('data:image/png;base64,UDE=');
    expect(images.has('p1_orig')).toBe(false);
  });

  it('chaque changement est gardé aussitôt (comme l’OI) : un rechargement ne perd pas le tracé', async () => {
    void annotatePhoto('p1');
    await flush();
    annotationHost.annotations = [box];
    annotationHost.save();
    await flush();
    expect(JSON.parse(String(Storage.loadCollection('pcTacPhotos')[0]!.annotations))).toEqual([box]);
    expect(images.get('p1_orig')).toBe('data:image/png;base64,UDE=');
    annotationHost.annotations = [];
    annotationHost.save(); // Annuler : le moteur remet l’état d’ouverture
    await flush();
    closeModal();
    await flush();
    expect(Storage.loadCollection('pcTacPhotos')[0]!.annotations).toBeUndefined();
    expect(images.has('p1_orig')).toBe(false);
  });

  it('réouverture pendant l’écriture de la précédente : elle attend, puis s’ouvre avec les annotations', async () => {
    let release!: (v: string) => void;
    vi.mocked(Utils.compressImage).mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = annotatePhoto('p1');
    await flush();
    annotationHost.annotations = [box];
    closeModal();
    await flush();
    const second = annotatePhoto('p1');
    await flush();
    expect(opened).toHaveLength(1);
    release('data:image/jpeg;base64,QU5O');
    expect(await first).toBe(true);
    await flush();
    expect(opened).toEqual(['[]', JSON.stringify([box])]);
    closeModal();
    await second;
  });

  it('revue : après une annotation enregistrée depuis la galerie, le focus revient sur « Annoter » de la même carte', async () => {
    const card = (id: string): string => `<div class="photo-card" data-id="${id}"><button type="button" data-photo-action="annotate">Annoter</button></div>`;
    const board = document.createElement('div');
    board.innerHTML = card('p0') + card('p1');
    document.body.append(board);
    const ui = { renderPhotos: vi.fn(async () => { board.innerHTML = card('p0') + card('p1'); }) };
    Object.assign(window, { UI: ui });
    board.querySelectorAll<HTMLElement>('[data-photo-action]')[1]!.focus();
    const done = annotatePhoto('p1');
    await flush();
    annotationHost.annotations = [box];
    closeModal();
    expect(await done).toBe(true);
    expect(document.activeElement).toBe(board.querySelectorAll('[data-photo-action]')[1]);
    // Rien d'enregistré : pas de nouveau rendu (le focus reste où la fenêtre le rend).
    ui.renderPhotos.mockClear();
    const again = annotatePhoto('p1');
    await flush();
    closeModal();
    expect(await again).toBe(false);
    expect(ui.renderPhotos).not.toHaveBeenCalled();
    board.remove();
  });

  it('photo illisible : refusée d’emblée, les autres restent annotables', async () => {
    images.set('p1', 'data:image/png;base64,TUFVVkFJU0U=');
    expect(await annotatePhoto('p1')).toBe(false);
    images.set('p1', 'data:image/png;base64,UDE=');
    const done = annotatePhoto('p1');
    await flush();
    expect(opened).toHaveLength(1);
    closeModal();
    await done;
  });
});
