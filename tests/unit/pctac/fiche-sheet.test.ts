/**
 * fiche-sheet.test.ts — La fiche unique à l'écran (décision 17) : brouillon,
 * saisie en rafale, champs masqués jamais effacés, retour arrière.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import '@pctac/ui.js';
import { openFiche } from '@pctac/fiche-sheet.js';
import { Storage } from '@pctac/storage.js';
import { PCTAC_MODE_KEY } from '@pctac/modes.js';
import { installDialog, flush, setField, clickSave, storedFiche } from './fiche-helpers.js';

const dialog = (): HTMLDialogElement => document.getElementById('ficheSheet') as HTMLDialogElement;
const drafts = (mode = 'forcene'): Record<string, unknown> =>
  JSON.parse(localStorage.getItem(mode === 'forcene' ? 'pcTacFicheDraft' : `pcTacFicheDraft@${mode}`) ?? '{}') as Record<string, unknown>;

beforeAll(installDialog);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<dialog id="ficheSheet"></dialog><div id="adversary-table-body"></div><div id="hostage-table-body"></div>';
  Storage.saveCollection('pcTacAdversaries', []);
  Storage.saveCollection('pcTacHostages', []);
});

describe('création et modification', () => {
  it('fiche entièrement vide : refusée, rien n’est écrit', async () => {
    await openFiche('adv');
    await clickSave();
    expect(Storage.loadCollection('pcTacAdversaries')).toHaveLength(0);
    expect(dialog().open).toBe(true);
  });

  it('pastilles + précision stockées dans la clé historique ; un champ vidé retire sa clé', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'DUPONT', attitude: 'Calme, nerveux', status: 'active' }]);
    await openFiche('adv', 'a1');
    document.querySelector<HTMLElement>('[data-key="attitude"] .fiche-chip[data-chip="Menaçant"]')!.click();
    setField('nom', '');
    await clickSave();
    const a = storedFiche('pcTacAdversaries', 'a1')!;
    expect(a.attitude).toBe('Calme, Menaçant, nerveux');
    expect('nom' in a).toBe(false);
    expect(dialog().open).toBe(false);
  });

  it('« Enregistrer et suivante » : fiche enregistrée, une fiche vide reste ouverte', async () => {
    await openFiche('host');
    setField('nom', 'Un');
    await clickSave(true);
    expect(Storage.loadCollection('pcTacHostages')).toHaveLength(1);
    expect(dialog().open).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#fiche_nom')?.value).toBe('');
  });
});

describe('champs masqués : jamais effacés', () => {
  it('Recherche (témoin) : l’état saisi ailleurs survit à une modification', async () => {
    localStorage.setItem(PCTAC_MODE_KEY, 'recherche');
    Storage.saveCollection('pcTacHostages', [{ id: 'h1', nom: 'Roux', etat: 'Choqué', status: 'ok' }]);
    await openFiche('host', 'h1');
    expect(document.querySelector('[data-key="etat"]')).toBeNull();
    expect(document.querySelector('.fiche-status-chip')).toBeNull();
    setField('temoignage', 'Vu vers la gare');
    await clickSave();
    const h = storedFiche('pcTacHostages', 'h1')!;
    expect(h.etat).toBe('Choqué');
    expect(h.temoignage).toBe('Vu vers la gare');
  });

  it('Ampleur : passer en Phénomène masque le prénom saisi, sans le perdre', async () => {
    localStorage.setItem(PCTAC_MODE_KEY, 'evenement');
    await openFiche('adv');
    setField('prenom', 'Jean');
    document.querySelector<HTMLElement>('[data-key="type_menace"] .fiche-chip[data-chip="Phénomène"]')!.click();
    expect(document.querySelector('[data-key="prenom"]')).toBeNull();
    expect(document.querySelector('label[for="fiche_nom"]')?.textContent).toBe('Désignation');
    setField('nom', 'Fuite de chlore');
    await clickSave();
    const m = Storage.loadCollection('pcTacAdversaries')[0]!;
    expect(m).toMatchObject({ type_menace: 'Phénomène', nom: 'Fuite de chlore', prenom: 'Jean' });
  });
});

describe('brouillon', () => {
  it('gardé à la frappe, proposé à la réouverture, repris, puis effacé à l’enregistrement', async () => {
    await openFiche('adv');
    setField('nom', 'MARTIN');
    expect(Object.keys(drafts())).toEqual(['adv:new']);
    dialog().close();
    await openFiche('adv');
    expect(document.querySelector('.fiche-draft')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('#fiche_nom')?.value).toBe('');
    document.querySelector<HTMLElement>('.fiche-draft-resume')!.click();
    expect(document.querySelector<HTMLInputElement>('#fiche_nom')?.value).toBe('MARTIN');
    await clickSave();
    expect(drafts()).toEqual({});
    expect(Storage.loadCollection('pcTacAdversaries')[0]?.nom).toBe('MARTIN');
  });

  it('« Effacer » supprime le brouillon', async () => {
    await openFiche('adv');
    setField('nom', 'X');
    dialog().close();
    await openFiche('adv');
    document.querySelector<HTMLElement>('.fiche-draft-drop')!.click();
    expect(drafts()).toEqual({});
    expect(document.querySelector('.fiche-draft')).toBeNull();
  });

  it('modification : brouillon écarté si la fiche a changé entre-temps', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('nom', 'B');
    dialog().close();
    // Import QR ou autre vue : la fiche change sous le brouillon.
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'C', status: 'active' }]);
    await openFiche('adv', 'a1');
    expect(document.querySelector('.fiche-draft')).toBeNull();
    expect(drafts()).toEqual({});
    expect(document.querySelector<HTMLInputElement>('#fiche_nom')?.value).toBe('C');
  });
});

describe('retour arrière', () => {
  it('le geste retour ferme la fiche, pas la page', async () => {
    await openFiche('adv');
    expect(dialog().open).toBe(true);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await flush();
    expect(dialog().open).toBe(false);
  });
});
