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

import { toast } from '../../../src/shared/feedback.js';

function feedbackCss(): string {
  return document.getElementById('tac-feedback-styles')?.textContent ?? '';
}

/** Corps de la PREMIÈRE règle dont le sélecteur est exactement `selector`. */
function rule(selector: string): string {
  const css = feedbackCss();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
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
});
