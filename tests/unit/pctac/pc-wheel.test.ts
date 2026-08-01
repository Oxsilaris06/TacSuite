/**
 * pc-wheel.test.ts — Comportement OBSERVÉ de `modules/pctac/wheel.js`
 * (GStart-main, 351 LOC, aucun import), roue contextuelle radiale.
 *
 * Écrit pour le portage `src/apps/pctac/wheel.ts` (P2.CONV). Chaque cas
 * reproduit un comportement RÉEL relevé sur le code source original
 * (références `wheel.js:<ligne>` en commentaire).
 *
 * Le DOM existe sous jsdom mais pas la mise en page (`getBoundingClientRect`
 * renvoie des zéros) : les tests ci-dessous n'exercent pas `_position()`
 * (aucun `map` fourni — `this.map` reste `null`, donc `_position()` est un
 * no-op, wheel.js:125), seule la géométrie non liée à la carte est utilisée.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Wheel, type WheelLngLat, type WheelOption } from '../../../src/apps/pctac/wheel.js';

const STYLE_ID = 'plan-wheel-style';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Wheel — injection CSS (wheel.js:335-351)', () => {
  it('la feuille de style #plan-wheel-style reste unique même après deux instanciations + open()', () => {
    // wheel.js injecte le <style> en garde de module (`!document.getElementById(...)`),
    // AU CHARGEMENT du fichier — pas dans open(). Il est donc déjà présent dès
    // l'import de ce module (comportement d'origine, wheel.js:335-351). Ce que
    // le garde-fou protège : ouvrir plusieurs roues ne le duplique jamais.
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);

    const w1 = new Wheel({ map: null, lngLat: null, options: [] });
    w1.open();
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);

    const w2 = new Wheel({ map: null, lngLat: null, options: [] });
    w2.open();
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);

    w1.destroy();
    w2.destroy();
  });
});

describe('Wheel — destroy() (wheel.js:70-87)', () => {
  it("retire l'élément et les listeners : un clic extérieur après destroy ne jette pas", () => {
    const w = new Wheel({ map: null, lngLat: null, options: [] });
    w.open();
    expect(document.body.contains(w.element)).toBe(true);

    w.destroy();
    expect(w.element).toBeNull();
    expect(document.body.querySelector('.plan-wheel')).toBeNull();

    expect(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }).not.toThrow();

    // Un second destroy() est un no-op sûr (garde `_destroyed`, wheel.js:71).
    expect(() => w.destroy()).not.toThrow();
  });
});

describe("Wheel — _onOutside : fenêtre d'ignore de 120ms (wheel.js:111-118)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("le clic extérieur AVANT 120ms ne ferme pas, APRÈS 120ms ferme", () => {
    const w = new Wheel({ map: null, lngLat: null, options: [] });
    w.open();
    expect(w.element).not.toBeNull();

    // Cible extérieure à la roue : la roue est montée dans document.body.
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    vi.advanceTimersByTime(80);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(w.element).not.toBeNull();

    vi.advanceTimersByTime(60); // total 140ms depuis le montage
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(w.element).toBeNull();
  });
});

describe('Wheel — keepOpen (wheel.js:316)', () => {
  it("keepOpen: true laisse la roue ouverte après l'action", () => {
    let called = 0;
    const options: WheelOption[] = [
      {
        icon: 'star',
        label: 'Option',
        keepOpen: true,
        action: () => {
          called += 1;
        },
      },
    ];
    const w = new Wheel({ map: null, lngLat: null, options });
    w.open();
    const btn = w.element?.querySelector('button:not(.plan-wheel-center)');
    expect(btn).toBeTruthy();
    (btn as HTMLButtonElement).click();

    expect(called).toBe(1);
    expect(w.element).not.toBeNull();

    w.destroy();
  });

  it('sans keepOpen, un clic sur une option ferme la roue', () => {
    const options: WheelOption[] = [{ icon: 'star', label: 'Option', action: () => {} }];
    const w = new Wheel({ map: null, lngLat: null, options });
    w.open();
    const btn = w.element?.querySelector('button:not(.plan-wheel-center)');
    (btn as HTMLButtonElement).click();

    expect(w.element).toBeNull();
  });
});

describe('Wheel — surface PlanWheel (SPEC-PLANMAP-SPLIT §3.1)', () => {
  it('une instance est structurellement assignable à { lngLat, element, open, destroy }', () => {
    interface PlanWheelLike {
      lngLat: WheelLngLat | null;
      element: HTMLElement | null;
      open(): void;
      destroy(): void;
    }
    const w = new Wheel({ map: null, lngLat: null, options: [] });
    const asPlanWheel: PlanWheelLike = w;
    expect(asPlanWheel.element).toBeNull();
    w.destroy();
  });
});
