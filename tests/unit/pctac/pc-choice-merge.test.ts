/**
 * pc-choice-merge.test.ts — Fenêtre de choix et fusion de personnes (B5).
 *
 * Couvre : choix à 3 boutons (résolution, fond = null), et la fusion d'images
 * du piège `mergeFicheFields` : l'existante garde ses images, reprendre la
 * photo de l'entrante recopie ses blobs vers l'id gardé AVANT l'écriture, et
 * l'invariant `<id>_orig` ⇔ `annotations` tient.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { choiceDialog } from '../../../src/apps/pctac/choice-dialog.js';
import { mergePersonIntoExisting } from '../../../src/apps/pctac/fiche-merge.js';
import { diffOpenFiche } from '../../../src/apps/pctac/fiche-conflict.js';
import { ImageStore } from '../../../src/apps/pctac/image-store.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('choiceDialog', () => {
  it('résout la valeur du bouton cliqué', async () => {
    const p = choiceDialog({
      title: 'Une fiche existe déjà',
      message: 'Pour Dupont Jean',
      options: [
        { value: 'open', label: "Ouvrir l'existante" },
        { value: 'merge', label: 'Fusionner' },
        { value: 'create', label: 'Créer quand même' },
      ],
    });
    const merge = document.querySelector<HTMLButtonElement>('[data-choice="merge"]');
    expect(merge?.textContent).toBe('Fusionner');
    merge?.click();
    await expect(p).resolves.toBe('merge');
    expect(document.querySelector('.tac-choice-dialog')).toBeNull();
  });

  it('résout null au clic sur le fond', async () => {
    const p = choiceDialog({ message: 'x', options: [{ value: 'a', label: 'A' }] });
    document.querySelector<HTMLElement>('.tac-choice-dialog')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(p).resolves.toBeNull();
  });

  it('résout null sur Échap (événement cancel)', async () => {
    const p = choiceDialog({ message: 'x', options: [{ value: 'a', label: 'A' }] });
    document.querySelector<HTMLElement>('.tac-choice-dialog')?.dispatchEvent(new Event('cancel'));
    await expect(p).resolves.toBeNull();
  });

  it('le message passe par textContent (jamais innerHTML)', () => {
    choiceDialog({ message: '<img src=x onerror=alert(1)>', options: [{ value: 'a', label: 'A' }] });
    const dlg = document.querySelector('.tac-choice-dialog');
    expect(dlg?.querySelector('img')).toBeNull();
    expect(dlg?.querySelector('.tac-choice-message')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('mergePersonIntoExisting', () => {
  const ctx = (obj: Record<string, string>): void => {
    vi.spyOn(ImageStore, 'get').mockImplementation(async (id: string) => obj[id] ?? null);
    vi.spyOn(ImageStore, 'put').mockResolvedValue(undefined);
    vi.spyOn(ImageStore, 'delete').mockResolvedValue(undefined);
  };

  it('reprend la photo de l\'entrante : copie vers l\'id gardé, annotations incluses', async () => {
    ctx({ b: 'DATA', b_orig: 'ORIG' });
    const put = vi.spyOn(ImageStore, 'put');
    const { merged } = await mergePersonIntoExisting(
      { id: 'a', nom: 'Dupont', prenom: '', telephone: '' },
      { id: 'b', nom: 'Dupont', prenom: 'Jean', hasImage: true, annotations: 'tracé', telephone: '06' },
    );
    expect(merged.id).toBe('a');
    expect(merged.prenom).toBe('Jean');
    expect(merged.hasImage).toBe(true);
    expect(merged.annotations).toBe('tracé');
    const calls = put.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining(['a', 'a_sync', 'a_orig']));
  });

  it('l\'existante garde sa photo : aucune copie, annotations de l\'entrante ignorées', async () => {
    ctx({ b: 'DATA', b_orig: 'ORIG' });
    const put = vi.spyOn(ImageStore, 'put');
    const { merged } = await mergePersonIntoExisting(
      { id: 'a', nom: 'Dupont', hasImage: true, annotations: 'existant' },
      { id: 'b', nom: 'Dupont', hasImage: true, annotations: 'entrant', prenom: 'Jean' },
    );
    expect(merged.hasImage).toBe(true);
    expect(merged.annotations).toBe('existant');
    expect(put).not.toHaveBeenCalled();
  });

  it('ni l\'une ni l\'autre n\'a de photo : aucune trace d\'image', async () => {
    ctx({});
    const { merged } = await mergePersonIntoExisting(
      { id: 'a', nom: 'Dupont' },
      { id: 'b', nom: 'Dupont', prenom: 'Jean' },
    );
    expect(merged.hasImage).toBeUndefined();
    expect(merged.annotations).toBeUndefined();
  });

  it('photo copiée sans original : pas d\'annotations, `_orig` retiré de la cible', async () => {
    ctx({ b: 'DATA' });
    const del = vi.spyOn(ImageStore, 'delete');
    const { merged } = await mergePersonIntoExisting(
      { id: 'a', nom: 'Dupont' },
      { id: 'b', nom: 'Dupont', hasImage: true, annotations: 'sans original' },
    );
    expect(merged.hasImage).toBe(true);
    expect(merged.annotations).toBeUndefined();
    expect(del).toHaveBeenCalledWith('a_orig');
  });
});

describe('diffOpenFiche — conflits d\'une fiche ouverte (décision 29)', () => {
  it('champ changé ailleurs et pas ici : silencieux', () => {
    const diff = diffOpenFiche({ prenom: '', telephone: '' }, { prenom: '', telephone: '' }, { prenom: '', telephone: '06' });
    expect(diff.silent).toEqual({ telephone: '06' });
    expect(diff.conflicts).toEqual([]);
  });

  it('champ changé des deux côtés différemment : conflit', () => {
    const diff = diffOpenFiche({ prenom: 'A' }, { prenom: 'Jean' }, { prenom: 'Paul' });
    expect(diff.conflicts).toEqual([{ key: 'prenom', mine: 'Jean', theirs: 'Paul' }]);
  });

  it('même changement des deux côtés : aucun bruit', () => {
    const diff = diffOpenFiche({ prenom: '' }, { prenom: 'Jean' }, { prenom: 'Jean' });
    expect(diff.silent).toEqual({});
    expect(diff.conflicts).toEqual([]);
  });

  it('le statut est ignoré (géré par statusTouched)', () => {
    const diff = diffOpenFiche({ status: 'active' }, { status: 'active' }, { status: 'neutralized' });
    expect(diff.conflicts).toEqual([]);
  });

  it('aucun changement ailleurs : rien à faire', () => {
    const diff = diffOpenFiche({ prenom: 'A' }, { prenom: 'B' }, { prenom: 'A' });
    expect(diff.silent).toEqual({});
    expect(diff.conflicts).toEqual([]);
  });
});
