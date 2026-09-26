/**
 * feedback-ui.test.ts — Défauts d'interface constatés en navigateur réel
 * (atelier UI-1, 25-26/09) sur `src/shared/feedback.ts`.
 *
 * jsdom ne calcule aucune mise en page : les exigences de disposition sont
 * vérifiées sur la feuille injectée elle-même (même méthode que
 * `feedback.test.ts`, F-1), les comportements par événements et rectangles
 * simulés. La preuve visuelle (captures téléphone 390 × 844) est dans le
 * rapport de l'atelier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmDialog, promptDialog, showBanner, toast, undoableToast } from '../../../src/shared/feedback.js';

function feedbackCss(): string {
  return document.getElementById('tac-feedback-styles')?.textContent ?? '';
}

/** Corps de la PREMIÈRE règle dont le sélecteur est exactement `selector`. */
function rule(selector: string): string {
  const css = feedbackCss();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

/** Pose un faux `matchMedia` qui répond `matches(query)`. */
function stubMatchMedia(matches: (query: string) => boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('#tac-feedback-styles').forEach((el) => el.remove());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('toasts sur téléphone', () => {
  it('le conteneur a une largeur propre et centrée (left: 50% le bridait à la moitié de l’écran)', () => {
    toast('Entrée supprimée.');
    const body = rule('.tac-toast-container');
    // Constat 390 × 844 : « Entrée supprimée. Ctrl+Z pour annuler. » écrit une
    // syllabe par ligne, le conteneur calé à left: 50% ne disposant que de
    // 195 px. Centré par left/right: 0 + margin auto, il garde toute sa largeur.
    expect(body).not.toMatch(/left:\s*50%/);
    expect(body).toMatch(/left:\s*0/);
    expect(body).toMatch(/right:\s*0/);
    expect(body).toMatch(/margin-inline:\s*auto/);
    expect(body).toMatch(/width:\s*min\(92vw,\s*420px\)/);
  });

  it('ne recouvre pas le dock flottant des applications (#dockMenu en bas d’écran)', () => {
    // Constat 390 × 844 : les toasts (bas 24 px) recouvraient le bouton du dock
    // (bas 20 px, 50 px de haut) de PC-Tac, et le dock de l'OI de même.
    const dock = document.createElement('div');
    dock.id = 'dockMenu';
    document.body.appendChild(dock);
    const top = window.innerHeight - 70;
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 50, left: 170, right: 220, width: 50, height: 50, x: 170, y: top, toJSON: () => ({}) });
    toast('Archive importée');
    const container = document.getElementById('tac-toast-container');
    // 70 px occupés par le dock et sa marge : le toast se pose au-dessus.
    expect(parseFloat(container?.style.bottom ?? '0')).toBeGreaterThanOrEqual(78);
  });

  it('sans dock, la position par défaut de la feuille s’applique (aucun style en ligne)', () => {
    toast('Enregistré');
    expect(document.getElementById('tac-toast-container')?.style.bottom).toBe('');
  });

  it('sans pointeur fin (téléphone, tablette), l’annonce ne cite pas Ctrl+Z', () => {
    // Constat 390 × 844 : « Fiche supprimée. Ctrl+Z pour annuler. » sur un
    // téléphone, sans clavier : la moitié du message ne sert à rien.
    stubMatchMedia(() => false);
    undoableToast('Fiche supprimée.', { onUndo: () => {} });
    const text = document.querySelector('.tac-toast')?.textContent ?? '';
    expect(text).toContain('Fiche supprimée.');
    expect(text).not.toContain('Ctrl+Z');
    expect(text).not.toContain('Cmd+Z');
    // Le bouton « Annuler » reste la voie d'annulation.
    expect(document.querySelector('.tac-toast button')?.textContent).toBe('Annuler');
  });

  it('avec un pointeur fin (poste, tablette à clavier et pavé), le raccourci reste annoncé', () => {
    stubMatchMedia((q) => q.includes('any-pointer: fine'));
    undoableToast('Fiche supprimée.', { onUndo: () => {} });
    expect(document.querySelector('.tac-toast')?.textContent).toMatch(/(Ctrl|Cmd)\+Z pour annuler/);
  });

  it('un même message répété ne s’empile pas : un seul toast, décompte relancé', () => {
    // Constat 390 × 844 : trois saisies rapides empilaient trois « Événement
    // ajouté » par-dessus le bouton d'ajout et les cartes du journal.
    vi.useFakeTimers();
    toast('Événement ajouté', { kind: 'success' });
    vi.advanceTimersByTime(3000);
    toast('Événement ajouté', { kind: 'success' });
    toast('Événement ajouté', { kind: 'success' });
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(1);
    // Relancé au dernier appel : encore là 3,9 s après, parti après 4 s.
    vi.advanceTimersByTime(3900);
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(0);
  });

  it('messages ou genres différents : empilés comme avant', () => {
    toast('Événement ajouté', { kind: 'success' });
    toast('Événement ajouté', { kind: 'error' });
    toast('Fiche enregistrée', { kind: 'success' });
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(3);
  });

  it('les toasts d’annulation ne sont jamais fusionnés (chacun porte sa suppression)', () => {
    undoableToast('Photo supprimée.', { onUndo: () => {} });
    undoableToast('Photo supprimée.', { onUndo: () => {} });
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(2);
  });

  it('dock masqué (fiche plein écran, rien de rendu) : position par défaut', () => {
    const dock = document.createElement('div');
    dock.id = 'dockMenu';
    document.body.appendChild(dock);
    toast('Fiche enregistrée');
    expect(document.getElementById('tac-toast-container')?.style.bottom).toBe('');
  });
});

describe('fenêtres de confirmation et de saisie', () => {
  it('les boutons font au moins 44 px de haut (mesuré : 38 px sur téléphone)', () => {
    void confirmDialog({ message: 'Supprimer ?' });
    expect(rule('.tac-confirm-btn')).toMatch(/min-height:\s*44px/);
  });

  it('pas de raccourci `font` invalide (`… inherit` en famille annule toute la déclaration)', () => {
    void confirmDialog({ message: 'Supprimer ?' });
    expect(rule('.tac-confirm-btn')).not.toMatch(/font:[^;]*\binherit\s*;/);
  });

  it('le champ de saisie fait 44 px de haut (mesuré : 38 px dans PC-Tac)', () => {
    void promptDialog({ message: 'Nouveau titre :' });
    expect(rule('.tac-confirm-input')).toMatch(/min-height:\s*44px/);
  });

  function withBox(dialog: HTMLElement): void {
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 500, left: 16, right: 374, width: 358, height: 200, x: 16, y: 300, toJSON: () => ({}) });
  }

  it('un toucher dans le remplissage de la fenêtre ne l’annule pas ; un toucher sur le fond, si', async () => {
    // Constat Chromium 390 × 844 : un toucher 8 px sous le bord haut de la
    // fenêtre (son remplissage, cible = le <dialog> comme pour le fond)
    // l'annulait.
    const p = confirmDialog({ message: 'Supprimer cette entrée du journal ?', danger: true });
    const dialog = document.querySelector<HTMLElement>('.tac-confirm-dialog')!;
    withBox(dialog);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 190, clientY: 308 }));
    expect(document.querySelector('.tac-confirm-dialog')).not.toBeNull();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 190, clientY: 700 }));
    await expect(p).resolves.toBe(false);
  });

  it('même règle pour la saisie : le texte tapé n’est pas perdu sur un toucher à côté du champ', async () => {
    const p = promptDialog({ message: 'Nouveau titre :', initial: 'Façade nord' });
    const dialog = document.querySelector<HTMLElement>('.tac-confirm-dialog')!;
    withBox(dialog);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 400 }));
    expect(document.querySelector('.tac-confirm-dialog')).not.toBeNull();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
    await expect(p).resolves.toBeNull();
  });
});

describe('saisie validée par Entrée', () => {
  it('Entrée dans le champ annule l’action par défaut : sinon le focus rendu au bouton déclencheur le réactive et rouvre la fenêtre', async () => {
    // Constat (atelier UI-2, dbg-enter) : « KODIAQ » + Entrée crée le VL puis
    // la fenêtre de saisie se rouvre, au bureau comme au téléphone.
    const p = promptDialog({ message: 'Nom du VL :' });
    const input = document.querySelector<HTMLInputElement>('.tac-confirm-input')!;
    input.value = 'KODIAQ';
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await expect(p).resolves.toBe('KODIAQ');
  });
});

describe('bandeaux', () => {
  it('pas de liseré latéral coloré épais (règle du projet) : le niveau se lit à la pastille et au fond', () => {
    showBanner('b1', { message: 'Nouvelle version prête.', level: 'info' });
    const css = feedbackCss();
    expect(css).not.toMatch(/border-left-width/);
    expect(css).not.toMatch(/border-left-color/);
    expect(rule('.tac-banner-message::before')).toMatch(/border-radius:\s*50%/);
  });
});
