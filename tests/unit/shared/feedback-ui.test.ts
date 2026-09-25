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

import { confirmDialog, promptDialog, toast, undoableToast } from '../../../src/shared/feedback.js';

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
});
