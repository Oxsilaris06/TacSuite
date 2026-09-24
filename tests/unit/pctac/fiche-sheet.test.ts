/**
 * fiche-sheet.test.ts — La fiche unique à l'écran (décision 17) : brouillon,
 * saisie en rafale, champs masqués jamais effacés, retour arrière.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { UI } from '@pctac/ui.js';
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

describe('revue neuve (398b11e)', () => {
  it('Entrée dans un champ passe au suivant, sans enregistrer ni fermer', async () => {
    await openFiche('adv');
    setField('nom', 'DUPONT');
    const nom = document.querySelector<HTMLInputElement>('#fiche_nom')!;
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    nom.dispatchEvent(ev);
    await flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(Storage.loadCollection('pcTacAdversaries')).toHaveLength(0);
    expect(dialog().open).toBe(true);
    expect(document.activeElement?.id).toBe('fiche_prenom');
  });

  it('brouillon repris en Forcené : la déduction blessures → statut tient toujours', async () => {
    await openFiche('host');
    setField('nom', 'Durand');
    setField('blessures', 'balle abdomen, grave');
    dialog().close();
    await openFiche('host');
    document.querySelector<HTMLElement>('.fiche-draft-resume')!.click();
    await clickSave();
    expect(Storage.loadCollection('pcTacHostages')[0]?.status).toBe('blesse');
  });

  it('statut posé depuis la carte : pas écrasé par une modification des blessures', async () => {
    // DCD posé plus tôt par l'opérateur (hors fiche) ; blessures inchangées depuis.
    Storage.saveCollection('pcTacHostages', [{ id: 'h1', nom: 'Roux', blessures: '', status: 'dcd' }]);
    await openFiche('host', 'h1');
    setField('blessures', 'plaie légère');
    await clickSave();
    expect(storedFiche('pcTacHostages', 'h1')?.status).toBe('dcd');
  });

  it('brouillon non repris : jamais écrasé par une nouvelle frappe', async () => {
    await openFiche('adv');
    setField('nom', 'PREMIER');
    dialog().close();
    await openFiche('adv');
    setField('nom', 'SECOND');
    const d = drafts()['adv:new'] as { values: Record<string, string> };
    expect(d.values.nom).toBe('PREMIER');
    expect(document.querySelector('.fiche-draft')).not.toBeNull();
  });

  it('un changement de statut depuis la carte ne fait pas jeter le brouillon de modification', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('antecedents', 'Fiché S');
    dialog().close();
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', status: 'neutralized' }]);
    await openFiche('adv', 'a1');
    document.querySelector<HTMLElement>('.fiche-draft-resume')!.click();
    await clickSave();
    // Saisie reprise, statut de la carte conservé.
    expect(storedFiche('pcTacAdversaries', 'a1')).toMatchObject({ antecedents: 'Fiché S', status: 'neutralized' });
  });

  it('valeur illisible par le widget : jamais effacée par un enregistrement', async () => {
    localStorage.setItem(PCTAC_MODE_KEY, 'recherche');
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', quand: 'vers 14h', position_heure: '09:15', status: 'active' }]);
    Storage.saveCollection('pcTacHostages', [{ id: 'h1', nom: 'T', fiabilite: 'Moyenne', status: 'ok' }]);
    await openFiche('adv', 'a1');
    await clickSave();
    expect(storedFiche('pcTacAdversaries', 'a1')).toMatchObject({ quand: 'vers 14h', position_heure: '09:15' });
    await openFiche('host', 'h1');
    await clickSave();
    expect(storedFiche('pcTacHostages', 'h1')?.fiabilite).toBe('Moyenne');
  });

  it('fiche supprimée pendant la modification : la saisie devient un brouillon de nouvelle fiche', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('antecedents', 'Fiché S');
    Storage.saveCollection('pcTacAdversaries', []);
    await clickSave();
    expect(dialog().open).toBe(false);
    const d = drafts()['adv:new'] as { values: Record<string, string> } | undefined;
    expect(d?.values.antecedents).toBe('Fiché S');
    expect(drafts()['adv:a1']).toBeUndefined();
  });
});

describe('stockage plein (revue neuve)', () => {
  it('écriture refusée : rien n’est jeté, la fiche reste ouverte, la saisie part en brouillon', async () => {
    await openFiche('adv');
    setField('nom', 'QUOTA');
    const spy = vi.spyOn(Storage, 'saveCollection').mockImplementation(() => undefined);
    try {
      await clickSave();
    } finally {
      spy.mockRestore();
    }
    expect(dialog().open).toBe(true);
    expect(Storage.loadCollection('pcTacAdversaries')).toHaveLength(0);
    const d = drafts()['adv:new'] as { values: Record<string, string> } | undefined;
    expect(d?.values.nom).toBe('QUOTA');
  });
});

describe('cartes (revue neuve)', () => {
  it('aucun id dans du JavaScript en ligne ; « Modifier » lit data-id au clic', async () => {
    const evil = "1');window.__pwn=1;('";
    Storage.saveCollection('pcTacAdversaries', [{ id: evil, nom: 'Piège', status: 'active' }]);
    await UI.renderAdversaries();
    const box = document.getElementById('adversary-table-body')!;
    expect(box.innerHTML).not.toMatch(/on(click|change)=/);
    box.querySelector<HTMLElement>('[data-fiche-action="edit"]')!.click();
    await flush();
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
    expect(dialog().open).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#fiche_nom')?.value).toBe('Piège');
  });

  it('triage changé depuis la carte : sigle intact dans la main courante', async () => {
    localStorage.setItem(PCTAC_MODE_KEY, 'tp');
    Storage.saveCollection('pcTacHostages', [{ id: 'h1', nom: 'Roux', status: 'nt' }]);
    await UI.renderHostages();
    const sel = document.querySelector<HTMLSelectElement>('#hostage-table-body [data-fiche-action="status"]')!;
    sel.value = 'ua';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(storedFiche('pcTacHostages', 'h1')?.status).toBe('ua');
    const log = Storage.loadLogData();
    expect(log.at(-1)?.remarques).toBe('OTG Roux : UA');
  });
});


describe('bureau et tablette : fiche dans la page (décision 21)', () => {
  // Gabarit réel : chaque liste est dans un `.fiche-layout`, la fiche au bout du document.
  const layouts = (): void => {
    document.body.innerHTML = `
      <div id="view-adversaires"><div class="fiche-layout" id="advLayout"><div id="adversary-table-body"></div></div></div>
      <div id="view-otages"><div class="fiche-layout" id="hostLayout"><div id="hostage-table-body"></div></div></div>
      <dialog id="ficheSheet"></dialog>`;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('s’ouvre à côté de la liste de son camp, sans modale', async () => {
    layouts();
    const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    await openFiche('adv');
    expect(dialog().open).toBe(true);
    expect(dialog().parentElement?.id).toBe('advLayout');
    expect(dialog().classList.contains('fiche-inline')).toBe(true);
    expect(modal).not.toHaveBeenCalled();
  });

  it('téléphone : plein écran modal, hors de l’onglet', async () => {
    layouts();
    vi.stubGlobal('matchMedia', (media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} }));
    const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    await openFiche('adv');
    expect(modal).toHaveBeenCalled();
    expect(dialog().parentElement).toBe(document.body);
    expect(dialog().classList.contains('fiche-inline')).toBe(false);
  });

  it('un otage ouvert pendant un adversaire : la fiche passe dans l’onglet Otages, la saisie adverse reste en brouillon', async () => {
    layouts();
    await openFiche('adv');
    setField('nom', 'Dupont');
    await openFiche('host');
    expect(dialog().parentElement?.id).toBe('hostLayout');
    expect(dialog().querySelector('h2')?.textContent).toBe('Nouvel otage');
    expect(Object.keys(drafts())).toContain('adv:new');
  });

  it('création : le premier champ reçoit le focus, on tape tout de suite', async () => {
    layouts();
    await openFiche('adv');
    expect(document.activeElement?.id).toBe('fiche_nom');
  });

  it('Échap dans la fiche la ferme sans remonter à la page (écran scindé, raccourcis)', async () => {
    layouts();
    await openFiche('adv');
    const page = vi.fn();
    document.addEventListener('keydown', page);
    document.getElementById('fiche_nom')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', page);
    expect(dialog().open).toBe(false);
    expect(page).not.toHaveBeenCalled();
  });
});
