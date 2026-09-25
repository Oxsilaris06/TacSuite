/**
 * radial-menu-ui.test.ts — Défauts d'interface de la roue constatés en
 * navigateur réel (atelier UI-1, 25-26/09) sur `src/shared/radial-menu.ts`.
 *
 * jsdom ne met rien en page : la position de chaque bouton est lue dans son
 * `transform` en ligne (`translate(calc(-50% + Xpx), calc(-50% + Ypx))`), où
 * la roue l'écrit elle-même.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { RadialMenu, type RadialMenuHost, type RadialMenuOption } from '../../../src/shared/radial-menu.js';

function makeHost(): RadialMenuHost {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 358, height: 656, left: 0, top: 0, right: 358, bottom: 656, x: 0, y: 0, toJSON() { return {}; } }),
  });
  document.body.appendChild(container);
  return { getContainer: () => container, project: () => ({ x: 179, y: 328 }), on: () => {}, off: () => {} };
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

/** Rayon effectif : distance du centre au premier bouton d'option. */
function optionRadius(menu: RadialMenu): number {
  const btn = menu.element?.querySelectorAll<HTMLButtonElement>('button')[1];
  const m = btn?.style.transform.match(/calc\(-50% \+ (-?[\d.e-]+)px\), calc\(-50% \+ (-?[\d.e-]+)px\)/);
  if (!m) return NaN;
  return Math.hypot(Number(m[1]), Number(m[2]));
}

const LABELS = ['Adv', 'Otage', 'Inter', 'Oscar', 'Inconnu', 'Entité', 'Catalogue', 'Copier coords'];
const options = (n: number): RadialMenuOption[] => LABELS.slice(0, n).map((label) => ({ icon: 'add', label }));

afterEach(() => {
  document.body.innerHTML = '';
  setViewportWidth(1024);
});

describe('RadialMenu — étiquettes lisibles sur téléphone', () => {
  it('8 options sur 390 px : rayon assez grand pour qu’aucune étiquette ne passe sous le bouton voisin', () => {
    // Constat 390 × 844 (roue de création de point, 8 options, rayon 78) :
    // « Inter » sous le bouton Oscar, « Catalogue » sous Entité, « Copier
    // coords » sous Adv. Étiquette posée 32 px sous le centre de son bouton,
    // 16 px de haut ; le voisin à 45° doit commencer plus bas :
    // r·sin(45°) − 26 ≥ 48, soit r ≥ 105.
    setViewportWidth(390);
    const menu = new RadialMenu({ host: makeHost(), lngLat: { lng: 0, lat: 0 }, options: options(8) });
    menu.open();
    expect(optionRadius(menu)).toBeGreaterThanOrEqual(104.6);
    menu.destroy();
  });

  it('peu d’options sur téléphone : la roue garde son rayon compact', () => {
    setViewportWidth(390);
    const menu = new RadialMenu({ host: makeHost(), lngLat: { lng: 0, lat: 0 }, options: options(4) });
    menu.open();
    expect(optionRadius(menu)).toBeCloseTo(78, 0);
    menu.destroy();
  });

  it('la roue élargie tient toujours dans une carte de téléphone (358 px)', () => {
    setViewportWidth(390);
    const menu = new RadialMenu({ host: makeHost(), lngLat: { lng: 0, lat: 0 }, options: options(8) });
    menu.open();
    expect(parseFloat(menu.element?.style.width ?? '0')).toBeLessThanOrEqual(358);
    menu.destroy();
  });
});
