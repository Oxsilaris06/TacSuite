/**
 * pc-ui.test.ts — Tests unitaires de UI (P2.CONV).
 *
 * Port TypeScript testé : src/apps/pctac/ui.ts (UI: UIContract), port de
 * modules/pctac/ui.js (GStart-main, 890 LOC) — cf. docs/SPEC-PCTAC-CONVERSION.md
 * §9 (pièges ui.ts) et §3 (stratégie onclick — VERBATIM dans ce paquet).
 *
 * Contexte : `@pctac/image-store.js` est mocké (IndexedDB absent sous jsdom,
 * SPEC-PCTAC-CONVERSION.md §8.4).
 *
 * Couverture exigée par la mission P2.CONV :
 *  - switchMainView('view-dashboard') : branche supprimée (ui.js:110-113,
 *    window.Dashboard code mort prouvé) — ne jette pas, ne fait rien de
 *    particulier.
 *  - renderPhotos() sans argument applique lastPhotoFilter (ui.js:517-519).
 *  - handlePhotoDrop avec un index introuvable NE MODIFIE PAS l'ordre des
 *    photos — protection contre splice(-1,1) (ui.js:598, PIÈGE VITAL).
 *  - renderLogTable appelé deux fois ne double pas les handlers de drag
 *    (ui.js:246-250, drapeau `_logDndBound` — porté en variable de MODULE
 *    `logDndBound`, cf. en-tête de ui.ts pour la justification).
 *  - toutes les méthodes de rendu ne jettent pas quand leur conteneur DOM est
 *    absent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PctacCollectionItem } from '@shared/types/contracts.js';

// --- Mock ImageStore : indexedDB absent sous jsdom (SPEC-PCTAC-CONVERSION.md
// §8.4). `hydrate` en identité : les tests posent déjà `data`/`photo` en clair
// dans les collections localStorage, aucune vraie hydratation IDB requise ici.
vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(): Promise<void> {},
    async get(): Promise<string | null> { return null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(): Promise<void> {},
    async deleteMany(): Promise<void> {},
    async clear(): Promise<void> {},
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
  },
}));

// Imports APRÈS vi.mock (hissé de toute façon, mais garde l'ordre lisible).
import { UI } from '@pctac/ui.js';
import { Storage } from '@pctac/storage.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('switchMainView — branche view-dashboard supprimée (ui.js:110-113)', () => {
  it('ne jette pas pour view-dashboard et ne fait rien de spécifique (window.Dashboard code mort)', () => {
    document.body.innerHTML = `
      <button class="tab-btn" data-view="view-plan"></button>
      <div class="tab-content-view" id="view-plan"></div>
    `;

    expect(() => UI.switchMainView('view-dashboard')).not.toThrow();

    // Aucun onglet/vue existant n'est activé par erreur : 'view-dashboard' ne
    // correspond à aucun data-view/id du DOM porté.
    expect(document.querySelector('.tab-btn')?.classList.contains('active')).toBe(false);
    expect(document.querySelector('.tab-content-view')?.classList.contains('active')).toBe(false);

    // La préférence de vue est tout de même persistée (ui.js:116, comportement
    // générique conservé — seule la branche dashboard a été retirée).
    expect(localStorage.getItem('lastView')).toBe('view-dashboard');
  });
});

describe('renderPhotos — sans argument reprend lastPhotoFilter (ui.js:517-519)', () => {
  it('applique le filtre mémorisé (pas "all") et ne rend que les photos de cette catégorie', async () => {
    localStorage.setItem('lastPhotoFilter', 'trap');
    const photos: PctacCollectionItem[] = [
      { id: 'p1', title: 'Photo 1', category: 'trap', data: 'data:image/png;base64,AAA' },
      { id: 'p2', title: 'Photo 2', category: 'hostage', data: 'data:image/png;base64,BBB' },
    ];
    localStorage.setItem('pcTacPhotos', JSON.stringify(photos));
    document.body.innerHTML = `
      <div id="photo-filter-container"></div>
      <div id="photo-board"></div>
    `;

    await UI.renderPhotos();

    // Le bouton de filtre actif correspond à 'trap' ("Piégeages"), pas "Toutes".
    const activeBtn = document.querySelector('#photo-filter-container .tab-btn.active');
    expect(activeBtn?.textContent?.trim()).toBe('Piégeages');

    // Seule la photo de catégorie 'trap' est rendue (le filtre a bien filtré).
    const cards = document.querySelectorAll('#photo-board .photo-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute('data-id')).toBe('p1');

    // localStorage.lastPhotoFilter reste 'trap' (ui.js:535).
    expect(localStorage.getItem('lastPhotoFilter')).toBe('trap');
  });

  it('reprend "all" quand aucun filtre n\'a jamais été mémorisé', async () => {
    const photos: PctacCollectionItem[] = [
      { id: 'p1', title: 'Photo 1', category: 'trap', data: 'data:image/png;base64,AAA' },
      { id: 'p2', title: 'Photo 2', category: 'hostage', data: 'data:image/png;base64,BBB' },
    ];
    localStorage.setItem('pcTacPhotos', JSON.stringify(photos));
    document.body.innerHTML = `
      <div id="photo-filter-container"></div>
      <div id="photo-board"></div>
    `;

    await UI.renderPhotos();

    const cards = document.querySelectorAll('#photo-board .photo-card');
    expect(cards).toHaveLength(2); // les deux catégories sont rendues
    expect(localStorage.getItem('lastPhotoFilter')).toBe('all');
  });
});

describe('handlePhotoDrop — garde contre splice(-1,1) (ui.js:598, PIÈGE VITAL)', () => {
  it("ne modifie PAS l'ordre des photos si draggedId est introuvable (drag externe / id inconnu)", () => {
    const photos: PctacCollectionItem[] = [
      { id: 'p1', title: 'Photo 1', category: 'trap' },
      { id: 'p2', title: 'Photo 2', category: 'trap' },
      { id: 'p3', title: 'Photo 3', category: 'trap' },
    ];
    Storage.saveCollection('pcTacPhotos', photos);

    // Carte cible VALIDE (p2) — seul draggedId est introuvable.
    const targetCard = document.createElement('div');
    targetCard.className = 'photo-card';
    targetCard.dataset.id = 'p2';

    const fakeEvent = {
      preventDefault: () => {},
      dataTransfer: { getData: () => 'id-inconnu-drag-externe' },
      target: targetCard,
    } as unknown as DragEvent;

    expect(() => UI.handlePhotoDrop(fakeEvent)).not.toThrow();

    // Sans la garde `draggedIdx === -1 || targetIdx === -1`, splice(-1, 1)
    // aurait déplacé silencieusement la DERNIÈRE photo (p3).
    const after = Storage.loadCollection('pcTacPhotos');
    expect(after.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('réordonne normalement quand les deux id sont connus (non-régression du cas nominal)', () => {
    const photos: PctacCollectionItem[] = [
      { id: 'p1', title: 'Photo 1', category: 'trap' },
      { id: 'p2', title: 'Photo 2', category: 'trap' },
      { id: 'p3', title: 'Photo 3', category: 'trap' },
    ];
    Storage.saveCollection('pcTacPhotos', photos);

    const targetCard = document.createElement('div');
    targetCard.className = 'photo-card';
    targetCard.dataset.id = 'p1'; // déposé sur p1

    const fakeEvent = {
      preventDefault: () => {},
      dataTransfer: { getData: () => 'p3' }, // p3 glissée vers la position de p1
      target: targetCard,
    } as unknown as DragEvent;

    UI.handlePhotoDrop(fakeEvent);

    const after = Storage.loadCollection('pcTacPhotos');
    expect(after.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });
});

describe('U15 — séparateurs de jour dans le tableau du journal', () => {
  it('insère une ligne .log-day-sep quand la date change, aucune pour les legacy sans date', () => {
    document.body.innerHTML = '<table id="logTable"><tbody></tbody></table>';
    UI.initElements();
    UI.logSortDesc = false;
    UI.renderLogTable([
      { id: 'l', heure: '09:00', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: '' },
      { id: 'a', heure: '23:50', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: '', date: '2026-08-10' },
      { id: 'b', heure: '00:10', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: '', date: '2026-08-11' },
    ]);

    const seps = document.querySelectorAll('#logTable tbody tr.log-day-sep');
    expect(seps).toHaveLength(2); // un par changement de jour, rien avant l'entrée legacy
    expect(seps[0]?.textContent).toContain('10/08/2026');
    expect(seps[1]?.textContent).toContain('11/08/2026');
    // Les lignes d'entrée restent au nombre de 3.
    expect(document.querySelectorAll('#logTable tbody tr:not(.log-day-sep)')).toHaveLength(3);
  });
});

describe('U16/C1 — setItemStatus : fiche source de vérité, photo _sync suit, journal auto', () => {
  it('écrit la fiche, propage vers la photo _sync et ajoute une entrée de main courante', () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'adv1', nom: 'MARTIN', prenom: 'Paul', status: 'active' }]);
    Storage.saveCollection('pcTacPhotos', [{ id: 'adv1_sync', title: 'MARTIN Paul', category: 'neutralized', status: 'active' }]);

    UI.setItemStatus('pcTacAdversaries', 'adv1', 'neutralized');

    expect(Storage.loadCollection('pcTacAdversaries')[0]?.status).toBe('neutralized');
    expect(Storage.loadCollection('pcTacPhotos')[0]?.status).toBe('neutralized');
    const logs = Storage.loadLogData();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.remarques).toBe('ADV MARTIN Paul : neutralisé');
    expect(logs[0]?.pax).toBe('Adversaire');
  });

  it('statut inchangé : aucune entrée de journal ajoutée', () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'adv1', nom: 'MARTIN', status: 'active' }]);
    UI.setItemStatus('pcTacAdversaries', 'adv1', 'active');
    expect(Storage.loadLogData()).toHaveLength(0);
  });

  it('updateAdversaryStatus depuis une carte photo _sync remonte à la fiche', () => {
    Storage.saveCollection('pcTacHostages', [{ id: 'h1', nom: 'DURAND', prenom: 'Zoé', status: 'ok' }]);
    Storage.saveCollection('pcTacPhotos', [{ id: 'h1_sync', title: 'DURAND Zoé', category: 'hostage', status: 'ok' }]);

    UI.updateAdversaryStatus('h1_sync', 'blesse');

    expect(Storage.loadCollection('pcTacHostages')[0]?.status).toBe('blesse');
    expect(Storage.loadCollection('pcTacPhotos')[0]?.status).toBe('blesse');
    expect(Storage.loadLogData()[0]?.remarques).toBe('OTG DURAND Zoé : blessé');
  });
});


describe('UI — les méthodes de rendu ne jettent pas quand leur conteneur DOM est absent', () => {
  it('renderAdversaries résout sans jeter si #adversary-table-body est absent', async () => {
    await expect(UI.renderAdversaries()).resolves.toBeUndefined();
  });

  it('renderHostages résout sans jeter si #hostage-table-body est absent', async () => {
    await expect(UI.renderHostages()).resolves.toBeUndefined();
  });

  it('renderFriends ne jette pas si #friend-table-body est absent', () => {
    expect(() => UI.renderFriends()).not.toThrow();
  });

  it('renderPhotos résout sans jeter si #photo-board est absent', async () => {
    await expect(UI.renderPhotos('all')).resolves.toBeUndefined();
  });

  it('renderLogTable ne jette pas si #logTable est absent (this.elements.logTableBody null)', () => {
    UI.initElements(); // body vide → tous les éléments résolvent à null
    expect(() => UI.renderLogTable([
      { id: '1', heure: '10:00', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: '' },
    ])).not.toThrow();
  });

  it('renderCustomPaxOptions ne jette pas si #pax_select_container est absent', () => {
    UI.initElements();
    expect(() => UI.renderCustomPaxOptions()).not.toThrow();
  });

  it('initPaxModeAndColors ne jette pas quand le DOM est absent', () => {
    UI.initElements();
    expect(() => UI.initPaxModeAndColors()).not.toThrow();
  });

  it('openLightbox/closeLightbox ne jettent pas si la modale lightbox est absente', () => {
    expect(() => UI.openLightbox('data:image/png;base64,AAA', 'Titre')).not.toThrow();
    expect(() => UI.closeLightbox()).not.toThrow();
  });
});
