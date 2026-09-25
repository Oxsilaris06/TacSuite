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
import { Utils } from '@pctac/utils.js';
import { ImageStore } from '@pctac/image-store.js';
import { persistModeId } from '@pctac/modes.js';
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
    persistModeId('recherche');
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
    persistModeId('evenement');
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

  it('B2 — brouillon en attente : formulaire inerte, saisie refusée, rien de perdu', async () => {
    await openFiche('adv');
    setField('nom', 'PREMIER');
    dialog().close();
    await openFiche('adv');
    expect(document.querySelector('.fiche-draft')).not.toBeNull();
    expect(document.querySelector('.fiche-top')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.fiche-foot')?.hasAttribute('inert')).toBe(true);
    const sections = document.querySelectorAll('.fiche-section');
    expect(sections.length).toBeGreaterThan(0);
    sections.forEach((s) => expect(s.hasAttribute('inert')).toBe(true));
    setField('nom', 'SECOND');
    expect((drafts()['adv:new'] as { values: Record<string, string> }).values.nom).toBe('PREMIER');
    // Effacer : le formulaire redevient saisissable, la frappe suivante est protégée.
    document.querySelector<HTMLElement>('.fiche-draft-drop')!.click();
    expect(document.querySelector('.fiche-top')?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('.fiche-foot')?.hasAttribute('inert')).toBe(false);
    setField('nom', 'TROISIEME');
    expect((drafts()['adv:new'] as { values: Record<string, string> }).values.nom).toBe('TROISIEME');
  });

  it('B2 — Reprendre rend le formulaire saisissable', async () => {
    await openFiche('adv');
    setField('nom', 'PREMIER');
    dialog().close();
    await openFiche('adv');
    document.querySelector<HTMLElement>('.fiche-draft-resume')!.click();
    expect(document.querySelector('.fiche-top')?.hasAttribute('inert')).toBe(false);
    setField('nom', 'REPRIS');
    expect((drafts()['adv:new'] as { values: Record<string, string> }).values.nom).toBe('REPRIS');
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
    persistModeId('recherche');
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
    const spy = vi.spyOn(Storage, 'saveCollection').mockImplementation(() => false);
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
    persistModeId('tp');
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

describe('revue neuve de la fiche dans la page (e5791e0)', () => {
  const layouts = (): void => {
    document.body.innerHTML = `
      <div id="view-adversaires"><div class="fiche-layout" id="advLayout"><div id="adversary-table-body"></div></div></div>
      <div id="view-otages"><div class="fiche-layout" id="hostLayout"><div id="hostage-table-body"></div></div></div>
      <dialog id="ficheSheet"></dialog>`;
  };
  const two = (): void => {
    Storage.saveCollection('pcTacAdversaries', [
      { id: 'a1', nom: 'ALPHA', prenom: 'Alain', alias: 'Le Grand', status: 'active' },
      { id: 'b2', nom: 'BRAVO', prenom: 'Bruno', status: 'active' },
    ]);
  };
  const scroll = vi.fn();

  beforeEach(() => {
    layouts();
    two();
    scroll.mockClear();
    // jsdom n'implémente pas scrollIntoView.
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
  });

  afterEach(() => {
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    vi.restoreAllMocks();
  });

  it('statut changé depuis la carte pendant la modification : gardé, aucune entrée de main courante ajoutée', async () => {
    await openFiche('adv', 'a1');
    UI.setItemStatus('pcTacAdversaries', 'a1', 'neutralized');
    const logs = Storage.loadLogData().length;
    setField('prenom', 'Jean');
    await clickSave();
    expect(storedFiche('pcTacAdversaries', 'a1')).toMatchObject({ prenom: 'Jean', status: 'neutralized' });
    expect(Storage.loadLogData()).toHaveLength(logs);
  });

  it('champ changé ailleurs pendant la modification (import, autre vue) : pas écrasé par la copie d’ouverture', async () => {
    await openFiche('adv', 'a1');
    const list = Storage.loadCollection('pcTacAdversaries');
    list[0]!.alias = 'Le Petit';
    Storage.saveCollection('pcTacAdversaries', list);
    setField('prenom', 'Jean');
    await clickSave();
    expect(storedFiche('pcTacAdversaries', 'a1')).toMatchObject({ alias: 'Le Petit', prenom: 'Jean' });
  });

  it('photo en compression pendant « Enregistrer » : une autre fiche ne s’ouvre pas, la première est enregistrée intacte', async () => {
    let finish: (v: string) => void = () => {};
    vi.spyOn(Utils, 'compressImage').mockReturnValue(new Promise<string>((r) => { finish = r; }));
    await openFiche('adv', 'a1');
    const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    setField('prenom', 'Alan');
    dialog().querySelector<HTMLElement>('.fiche-save')!.click();
    await openFiche('adv', 'b2');
    finish('data:image/jpeg;base64,eA==');
    await flush();
    expect(storedFiche('pcTacAdversaries', 'a1')).toMatchObject({ nom: 'ALPHA', prenom: 'Alan' });
    expect(storedFiche('pcTacAdversaries', 'b2')).toMatchObject({ nom: 'BRAVO', prenom: 'Bruno' });
  });

  it('« Enregistrer et suivante » : la fiche vierge revient en vue, curseur dans le premier champ', async () => {
    await openFiche('adv');
    setField('nom', 'Un');
    scroll.mockClear();
    await clickSave(true);
    expect(scroll.mock.contexts).toContain(dialog());
    expect(document.activeElement?.id).toBe('fiche_nom');
  });

  it('passer à une autre fiche : le focus entre dans la fiche, le titre la nomme', async () => {
    await openFiche('adv', 'a1');
    const outside = document.body.appendChild(document.createElement('button'));
    outside.focus();
    await openFiche('adv', 'b2');
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(dialog().querySelector('h2')?.textContent).toBe('Modifier cet adversaire : BRAVO Bruno');
  });

  it('la fiche précède la liste dans le document (tabulation dans l’ordre affiché)', async () => {
    await openFiche('adv');
    expect(dialog().nextElementSibling?.id).toBe('adversary-table-body');
  });

  it('fermer une fiche modifiée rend le focus à son bouton « Modifier »', async () => {
    await UI.renderAdversaries();
    await openFiche('adv', 'b2');
    dialog().querySelector<HTMLElement>('.fiche-close')!.click();
    await flush();
    expect(document.activeElement?.closest<HTMLElement>('.fiche-card')?.dataset.id).toBe('b2');
    expect(document.activeElement?.getAttribute('data-fiche-action')).toBe('edit');
  });

  it('enregistrer une nouvelle fiche rend le focus à sa carte', async () => {
    await openFiche('adv');
    setField('nom', 'CHARLIE');
    await clickSave();
    const card = document.activeElement?.closest<HTMLElement>('.fiche-card');
    expect(card?.textContent).toContain('CHARLIE');
  });
});

describe('photo annotée (décision 25)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('nouvelle photo : l’annotation de l’ancienne est effacée (original et annotations)', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'X', hasImage: true, annotations: '[{"id":1}]', status: 'active' }]);
    const del = vi.spyOn(ImageStore, 'delete');
    vi.spyOn(Utils, 'compressImage').mockResolvedValue('data:image/jpeg;base64,NEW');
    await openFiche('adv', 'a1');
    const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await clickSave();
    expect(del).toHaveBeenCalledWith('a1_orig');
    expect(storedFiche('pcTacAdversaries', 'a1')?.annotations).toBeUndefined();
  });

  it('revue : nouvelle photo, un original orphelin (sans annotations) est effacé aussi', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'X', hasImage: true, status: 'active' }]);
    const del = vi.spyOn(ImageStore, 'delete');
    vi.spyOn(Utils, 'compressImage').mockResolvedValue('data:image/jpeg;base64,NEW');
    await openFiche('adv', 'a1');
    const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await clickSave();
    expect(del).toHaveBeenCalledWith('a1_orig');
  });

  it('revue : une nouvelle photo choisie retire « Annoter » (qui annoterait l’ancienne)', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'X', hasImage: true, status: 'active' }]);
    vi.spyOn(ImageStore, 'get').mockResolvedValue('data:image/jpeg;base64,OLD');
    vi.spyOn(Utils, 'compressImage').mockResolvedValue('data:image/jpeg;base64,NEW');
    await openFiche('adv', 'a1');
    expect(dialog().querySelector('.fiche-annotate')).not.toBeNull();
    const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(dialog().querySelector('.fiche-annotate')).toBeNull();
  });

  it('revue : une annotation enregistrée ne fait pas jeter le brouillon de la fiche', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', hasImage: true, status: 'active' }]);
    await openFiche('adv', 'a1');
    setField('antecedents', 'Fiché S');
    dialog().close();
    // Annotation de la photo (fiche ou galerie) : le moteur écrit `annotations`.
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', hasImage: true, status: 'active', annotations: '[{"id":1}]' }]);
    await openFiche('adv', 'a1');
    expect(document.querySelector('.fiche-draft-resume')).not.toBeNull();
  });
});


describe('brouillon : la photo choisie est gardée (décision 33)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('la photo du brouillon est stockée sous une clé propre et remontrée à la REPRISE (R13)', async () => {
    const put = vi.spyOn(ImageStore, 'put').mockResolvedValue(undefined);
    vi.spyOn(Utils, 'compressImage').mockResolvedValue('data:image/jpeg;base64,DRAFT');
    await openFiche('adv');
    const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const draftKey = put.mock.calls.map((c) => c[0]).find((k) => k.includes('FicheDraft') || k.includes('Draft'));
    expect(draftKey).toBeTruthy();

    dialog().close();
    vi.spyOn(ImageStore, 'get').mockResolvedValue('data:image/jpeg;base64,DRAFT');
    await openFiche('adv');
    await flush();
    // R13 — brouillon NON repris : sa photo ne s'affiche pas...
    expect(dialog().querySelector('.fiche-photo img')).toBeNull();
    // ...elle revient sur reprise explicite.
    dialog().querySelector<HTMLElement>('.fiche-draft-resume')!.click();
    await flush();
    expect(dialog().querySelector<HTMLImageElement>('.fiche-photo img')?.getAttribute('src'))
      .toBe('data:image/jpeg;base64,DRAFT');
  });

  it('« Effacer » le brouillon efface aussi sa photo', async () => {
    vi.spyOn(Utils, 'compressImage').mockResolvedValue('data:image/jpeg;base64,DRAFT');
    const del = vi.spyOn(ImageStore, 'delete').mockResolvedValue(undefined);
    await openFiche('adv');
    const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    dialog().close();
    await openFiche('adv');
    dialog().querySelector<HTMLElement>('.fiche-draft-drop')!.click();
    await flush();
    expect(del.mock.calls.some((c) => String(c[0]).includes('Draft'))).toBe(true);
  });
});

describe('quitter l\'onglet ferme la fiche (décision 33)', () => {
  it('la fiche est refermée et la saisie reste en brouillon', async () => {
    await openFiche('adv');
    setField('nom', 'MARTIN');
    expect(dialog().open).toBe(true);

    UI.switchMainView('view-photos');

    expect(dialog().open).toBe(false);
    expect(drafts()).toHaveProperty('adv:new');
  });
});

describe('doublon de personne à la création (décision 32)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const seed = (): void => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'Dupont', prenom: 'Jean', status: 'active' }]);
  };

  it('propose « Ouvrir l\'existante », « Fusionner », « Créer quand même »', async () => {
    seed();
    await openFiche('adv');
    setField('nom', 'Dupont');
    setField('prenom', 'Jean');
    await clickSave();
    const labels = [...document.querySelectorAll('.tac-choice-dialog [data-choice]')].map((b) => b.textContent);
    expect(labels).toEqual(["Ouvrir l'existante", 'Fusionner', 'Créer quand même']);
    document.querySelector<HTMLElement>('[data-choice="create"]')!.click();
    await flush();
    expect(Storage.loadCollection('pcTacAdversaries')).toHaveLength(2);
  });

  it('« Fusionner » : la nouvelle n\'est pas créée, les champs vides sont complétés', async () => {
    // Doublon par NOM + DATE DE NAISSANCE (prénom vide dans l'existante).
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'Dupont', dob: '01/01/1990', status: 'active' }]);
    await openFiche('adv');
    setField('nom', 'Dupont');
    setField('dob', '01/01/1990');
    setField('prenom', 'Jean');
    setField('alias', 'Le Petit');
    await clickSave();
    document.querySelector<HTMLElement>('[data-choice="merge"]')!.click();
    await flush();
    const list = Storage.loadCollection('pcTacAdversaries');
    expect(list).toHaveLength(1);
    expect(storedFiche('pcTacAdversaries', 'a1')).toMatchObject({ prenom: 'Jean', alias: 'Le Petit' });
  });

  it('« Ouvrir l\'existante » : referme la saisie et ouvre la fiche existante', async () => {
    seed();
    await openFiche('adv');
    setField('nom', 'Dupont');
    setField('prenom', 'Jean');
    await clickSave();
    document.querySelector<HTMLElement>('[data-choice="open"]')!.click();
    await flush();
    expect(Storage.loadCollection('pcTacAdversaries')).toHaveLength(1);
    expect(dialog().open).toBe(true);
    expect(dialog().querySelector<HTMLInputElement>('#fiche_nom')?.value).toBe('Dupont');
  });

  it('aucun doublon : la fiche est créée directement, sans fenêtre', async () => {
    Storage.saveCollection('pcTacAdversaries', []);
    await openFiche('adv');
    setField('nom', 'Unique');
    await clickSave();
    expect(document.querySelector('.tac-choice-dialog')).toBeNull();
    expect(Storage.loadCollection('pcTacAdversaries')).toHaveLength(1);
  });
});

describe('fiche ouverte changée dans un autre onglet (décision 29)', () => {
  const seedOne = (): void => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'ALPHA', prenom: 'Alain', status: 'active' }]);
  };
  const remoteData = (): void => {
    document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: 'pcTacAdversaries', remote: true } }));
  };
  afterEach(() => { vi.restoreAllMocks(); });

  it('champ changé ailleurs et pas ici : mis à jour sans bruit', async () => {
    seedOne();
    await openFiche('adv', 'a1');
    const list = Storage.loadCollection('pcTacAdversaries');
    list[0]!.antecedents = 'Fiché S';
    Storage.saveCollection('pcTacAdversaries', list);

    remoteData();
    await flush();
    expect(document.querySelector<HTMLInputElement>('#ficheSheet [data-key="antecedents"]')?.value).toBe('Fiché S');
    expect(document.querySelector('.tac-choice-dialog')).toBeNull();
  });

  it('champ changé des deux côtés différemment : fenêtre de choix, « Prendre l\'autre » applique', async () => {
    seedOne();
    await openFiche('adv', 'a1');
    setField('antecedents', 'LOCAL');
    const list = Storage.loadCollection('pcTacAdversaries');
    list[0]!.antecedents = 'AUTRE ONGLET';
    Storage.saveCollection('pcTacAdversaries', list);

    remoteData();
    await flush();
    const dialogChoice = document.querySelector('.tac-choice-dialog');
    expect(dialogChoice).not.toBeNull();
    document.querySelector<HTMLElement>('[data-choice="theirs"]')!.click();
    await flush();
    expect(document.querySelector<HTMLInputElement>('#ficheSheet [data-key="antecedents"]')?.value).toBe('AUTRE ONGLET');
  });

  it('fiche supprimée ailleurs : propose « Recréer en enregistrant » ou « Fermer »', async () => {
    seedOne();
    await openFiche('adv', 'a1');
    Storage.saveCollection('pcTacAdversaries', []);

    remoteData();
    await flush();
    const labels = [...document.querySelectorAll('.tac-choice-dialog [data-choice]')].map((b) => b.textContent);
    expect(labels).toEqual(['Recréer en enregistrant', 'Fermer']);
    document.querySelector<HTMLElement>('[data-choice="close"]')!.click();
    await flush();
    expect(dialog().open).toBe(false);
  });

  it('« Recréer en enregistrant » : enregistrer recrée la fiche', async () => {
    seedOne();
    await openFiche('adv', 'a1');
    Storage.saveCollection('pcTacAdversaries', []);

    remoteData();
    await flush();
    document.querySelector<HTMLElement>('[data-choice="recreate"]')!.click();
    await flush();
    await clickSave();
    expect(Storage.loadCollection('pcTacAdversaries')).toHaveLength(1);
  });
});

describe('Revue du 25/09 — modification distante silencieuse appliquée en place (B5)', () => {
  it('valeur appliquée dans le champ, focus et section ouverte gardés, pas de re-rendu', async () => {
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', status: 'active' }]);
    await openFiche('adv', 'a1');
    const antecedents = document.querySelector<HTMLTextAreaElement>('#ficheSheet [data-key="antecedents"]');
    const domicile = document.querySelector<HTMLInputElement>('#ficheSheet [data-key="domicile"]');
    expect(antecedents).not.toBeNull();
    expect(domicile).not.toBeNull();
    const section = antecedents!.closest<HTMLDetailsElement>('.fiche-section')!;
    section.open = true;
    antecedents!.focus();
    setField('antecedents', 'Fiché S');
    const formBefore = document.querySelector('#ficheSheet form');

    // L'autre onglet renseigne le domicile (champ non touché ici).
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', status: 'active', domicile: '3 rue TP' }]);
    document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: 'pcTacAdversaries', remote: true } }));
    await flush();

    expect(document.querySelector<HTMLInputElement>('#ficheSheet [data-key="domicile"]')!.value).toBe('3 rue TP');
    expect(document.activeElement).toBe(antecedents);
    expect(section.open).toBe(true);
    expect(document.querySelector('#ficheSheet form')).toBe(formBefore);
    expect(antecedents!.value).toBe('Fiché S');
    await clickSave();
    expect(storedFiche('pcTacAdversaries', 'a1')).toMatchObject({ antecedents: 'Fiché S', domicile: '3 rue TP' });
  });
});

describe('Revue du 25/09 — remplacer la photo date la fiche (A6)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  async function attach(data: string): Promise<void> {
    vi.spyOn(Utils, 'compressImage').mockResolvedValue(data);
    vi.spyOn(Utils, 'promptGpsPoint').mockResolvedValue(undefined as never);
    const input = dialog().querySelector<HTMLInputElement>('.fiche-photo-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  }

  it('updatedAt change quand seule la photo est remplacée (la fusion d’archive la reprendra)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
    Storage.saveCollection('pcTacAdversaries', [{ id: 'a1', nom: 'A', status: 'active' }]);
    await openFiche('adv', 'a1');
    await attach('data:image/jpeg;base64,AAA');
    await clickSave();
    const first = storedFiche('pcTacAdversaries', 'a1') as { updatedAt?: string; hasImage?: boolean };
    expect(first.hasImage).toBe(true);

    vi.setSystemTime(new Date('2026-09-25T10:05:00Z'));
    await openFiche('adv', 'a1');
    await attach('data:image/jpeg;base64,BBB');
    await clickSave();
    const second = storedFiche('pcTacAdversaries', 'a1') as { updatedAt?: string };
    expect(second.updatedAt).not.toBe(first.updatedAt);
  });
});
