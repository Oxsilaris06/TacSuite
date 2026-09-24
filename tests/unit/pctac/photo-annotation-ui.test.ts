/**
 * photo-annotation-ui.test.ts — Points d'entrée de l'annotation dans le PC-Tac
 * (décision 25) : bouton « Annoter » sur chaque photo de la galerie, dans la
 * visionneuse et dans la fiche. Aucun id dans un gestionnaire en ligne.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const annotateSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@pctac/photo-annotation.js', () => ({ annotatePhoto: annotateSpy }));
vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(): Promise<void> {},
    async get(id: string): Promise<string | null> { return id === 'a1' ? 'data:image/jpeg;base64,A1' : null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(): Promise<void> {},
    async deleteMany(): Promise<void> {},
    async clear(): Promise<void> {},
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
  },
}));

import { UI } from '@pctac/ui.js';
import { openFiche } from '@pctac/fiche-sheet.js';
import { Storage } from '@pctac/storage.js';
import { flush, installDialog } from './fiche-helpers.js';

beforeAll(installDialog);

beforeEach(() => {
  localStorage.clear();
  annotateSpy.mockClear();
  document.body.innerHTML = `
    <div id="photo-filter-container"></div><div id="photo-board"></div>
    <dialog id="lightboxModal"><img id="lightboxImage" alt=""><div id="lightboxTitle"></div>
      <button type="button" id="lightboxAnnotateBtn" hidden>Annoter</button></dialog>
    <dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>`;
  Storage.saveCollection('pcTacPhotos', [{ id: 'p1', title: 'Porte', category: 'other', data: 'data:image/png;base64,P1' }]);
});

describe('galerie Photos', () => {
  it('chaque photo a un bouton « Annoter », qui ouvre l’annotation de CETTE photo', async () => {
    await UI.renderPhotos('all');
    const btn = document.querySelector<HTMLElement>('#photo-board .photo-card [data-photo-action="annotate"]');
    expect(btn).not.toBeNull();
    expect(document.getElementById('photo-board')!.innerHTML).not.toMatch(/annotatePhoto\(/);
    btn!.click();
    await flush();
    expect(annotateSpy).toHaveBeenCalledWith('p1');
  });

  it('la visionneuse ouverte depuis une carte propose « Annoter » pour cette photo', async () => {
    await UI.renderPhotos('all');
    document.querySelector<HTMLElement>('#photo-board .photo-card img')!.click();
    const lb = document.getElementById('lightboxModal') as HTMLDialogElement;
    expect(lb.open).toBe(true);
    const annotate = document.getElementById('lightboxAnnotateBtn')!;
    expect(annotate.hidden).toBe(false);
    annotate.click();
    await flush();
    expect(annotateSpy).toHaveBeenCalledWith('p1');
  });

  it('visionneuse ouverte sans photo de la galerie (autre appelant) : pas de bouton « Annoter »', () => {
    UI.openLightbox('data:image/png;base64,X', 'Titre');
    expect(document.getElementById('lightboxAnnotateBtn')!.hidden).toBe(true);
  });
});

describe('fiche', () => {
  it('photo enregistrée : bouton « Annoter » ; fiche nouvelle : aucun', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'X', hasImage: true, status: 'active' }]);
    await openFiche('adv', 'a1');
    const btn = document.querySelector<HTMLElement>('#ficheSheet .fiche-annotate');
    expect(btn).not.toBeNull();
    btn!.click();
    await flush();
    expect(annotateSpy).toHaveBeenCalledWith('a1');
    await openFiche('adv');
    expect(document.querySelector('#ficheSheet .fiche-annotate')).toBeNull();
  });
});
