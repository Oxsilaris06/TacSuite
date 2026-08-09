/**
 * radial-menu.test.ts — Tests du socle roue radiale commun
 * `src/shared/radial-menu.ts` (mission R3-b, décision D1 : PC-Tac = socle).
 *
 * Couvre le comportement générique partagé par les deux adaptateurs
 * (`src/apps/pctac/wheel.ts` `Wheel`, `src/apps/oi/carto/wheel.ts`
 * `OIWheel`) : ouverture/options, sous-menu (`children`) + retour,
 * fermeture extérieure (délai anti-clics-fantômes + sélecteurs exclus),
 * Échap, `keepOpen`, et le clamp/fermeture sur sortie de vue carte
 * (`_position`, durcissement porté depuis PC-Tac).
 *
 * Les suites `tests/unit/pctac/pc-wheel.test.ts` / `pm-wheels.test.ts` et
 * `tests/unit/oi/oi-carto-wheel.test.ts` couvrent déjà chaque adaptateur ;
 * ce fichier teste le moteur lui-même, découplé de MapLibre, via un
 * `RadialMenuHost` factice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RadialMenu, type RadialMenuHost, type RadialMenuOption } from '../../../src/shared/radial-menu.js';

function makeHost(overrides: Partial<RadialMenuHost> = {}): RadialMenuHost & { container: HTMLElement } {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 1024, height: 768, left: 0, top: 0, right: 1024, bottom: 768, x: 0, y: 0, toJSON() { return {}; } }),
  });
  document.body.appendChild(container);
  return {
    container,
    getContainer: () => container,
    project: () => ({ x: 400, y: 300 }),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('RadialMenu — open()', () => {
  it('monte le wrapper dans le conteneur de host, avec la classe passée en wrapperClassName', () => {
    const host = makeHost();
    const menu = new RadialMenu({ host, lngLat: null, options: [], wrapperClassName: 'oi-wheel' });
    menu.open();

    expect(menu.element).not.toBeNull();
    expect(host.container.contains(menu.element)).toBe(true);
    expect(menu.element?.className).toBe('oi-wheel');
    expect(host.on).toHaveBeenCalledWith('move', expect.any(Function));
    expect(host.on).toHaveBeenCalledWith('zoom', expect.any(Function));
  });

  it("open() sans host monte dans document.body (centre écran, pas de crash)", () => {
    const menu = new RadialMenu({ host: null, lngLat: null, options: [] });
    menu.open();

    expect(menu.element).not.toBeNull();
    expect(document.body.contains(menu.element)).toBe(true);
    menu.destroy();
  });

  it('un second open() sur une instance déjà ouverte est un no-op (élément déjà monté)', () => {
    const host = makeHost();
    const menu = new RadialMenu({ host, lngLat: null, options: [] });
    menu.open();
    const first = menu.element;
    menu.open();
    expect(menu.element).toBe(first);
    menu.destroy();
  });
});

describe('RadialMenu — options', () => {
  it('crée un bouton central + un bouton par option', () => {
    const host = makeHost();
    const options: RadialMenuOption[] = [
      { icon: 'add', label: 'Un' },
      { icon: 'remove', label: 'Deux' },
      { icon: 'star', label: 'Trois' },
    ];
    const menu = new RadialMenu({ host, lngLat: null, options });
    menu.open();

    const buttons = menu.element!.querySelectorAll('button');
    expect(buttons.length).toBe(1 + 3);
  });

  it("sans keepOpen, cliquer une option ferme la roue après avoir appelé action(menu)", () => {
    const host = makeHost();
    let received: RadialMenu | null = null;
    const menu = new RadialMenu({
      host,
      lngLat: null,
      options: [{ icon: 'star', label: 'Option', action: (m) => { received = m; } }],
    });
    menu.open();

    const btn = menu.element!.querySelector('button:not(.plan-wheel-center)') as HTMLButtonElement;
    btn.click();

    expect(received).toBe(menu);
    expect(menu.element).toBeNull();
  });

  it('keepOpen: true laisse la roue ouverte après action', () => {
    const host = makeHost();
    let calls = 0;
    const menu = new RadialMenu({
      host,
      lngLat: null,
      options: [{ icon: 'star', label: 'Option', keepOpen: true, action: () => { calls += 1; } }],
    });
    menu.open();

    const btn = menu.element!.querySelector('button:not(.plan-wheel-center)') as HTMLButtonElement;
    btn.click();

    expect(calls).toBe(1);
    expect(menu.element).not.toBeNull();
    menu.destroy();
  });

  it('le bouton central ferme toujours la roue', () => {
    const host = makeHost();
    const menu = new RadialMenu({ host, lngLat: null, options: [] });
    menu.open();

    const center = menu.element!.querySelector('.plan-wheel-center') as HTMLButtonElement;
    center.click();

    expect(menu.element).toBeNull();
  });
});

describe('RadialMenu — sous-menus (children)', () => {
  it("cliquer une option avec children reconstruit la roue avec le sous-menu, titre = label, centre = back", () => {
    const host = makeHost();
    const menu = new RadialMenu({
      host,
      lngLat: null,
      options: [
        {
          icon: 'folder', label: 'Parent',
          children: () => [{ icon: 'child', label: 'Enfant' }],
        },
      ],
    });
    menu.open();

    const parentBtn = menu.element!.querySelector('button:not(.plan-wheel-center)') as HTMLButtonElement;
    parentBtn.click();

    // Toujours ouverte, reconstruite avec 1 option enfant
    expect(menu.element).not.toBeNull();
    expect(menu.title).toBe('Parent');
    expect(menu.centerIcon).toBe('arrow_back');
    const buttons = menu.element!.querySelectorAll<HTMLButtonElement>('button:not(.plan-wheel-center)');
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.title).toBe('Enfant');
  });

  it('le bouton central "back" restaure les options/le titre initiaux, puis redevient close', () => {
    const host = makeHost();
    const menu = new RadialMenu({
      host,
      lngLat: null,
      title: 'Racine',
      options: [
        { icon: 'folder', label: 'Parent', children: () => [{ icon: 'child', label: 'Enfant' }] },
      ],
    });
    menu.open();

    (menu.element!.querySelector('button:not(.plan-wheel-center)') as HTMLButtonElement).click();
    expect(menu.centerIcon).toBe('arrow_back');

    // Retour
    (menu.element!.querySelector('.plan-wheel-center') as HTMLButtonElement).click();
    expect(menu.element).not.toBeNull();
    expect(menu.title).toBe('Racine');
    expect(menu.centerIcon).toBe('close');

    // Le centre ferme maintenant la roue (plus de "back")
    (menu.element!.querySelector('.plan-wheel-center') as HTMLButtonElement).click();
    expect(menu.element).toBeNull();
  });
});

describe('RadialMenu — fermeture extérieure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("clic souris extérieur AVANT 120ms ne ferme pas, APRÈS 120ms ferme", () => {
    const menu = new RadialMenu({ host: null, lngLat: null, options: [] });
    menu.open();
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    vi.advanceTimersByTime(80);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.element).not.toBeNull();

    vi.advanceTimersByTime(60); // total 140ms
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.element).toBeNull();
  });

  it("clic tactile extérieur : fenêtre d'ignore élargie à 400ms (durcissement porté de PC-Tac)", () => {
    const menu = new RadialMenu({ host: null, lngLat: null, options: [] });
    menu.open();
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    vi.advanceTimersByTime(300);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    expect(menu.element).not.toBeNull(); // encore dans la fenêtre 400ms tactile

    vi.advanceTimersByTime(150); // total 450ms
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    expect(menu.element).toBeNull();
  });

  it('un clic sur un élément exclu (pin/roue/panneau) ne ferme jamais la roue', () => {
    const menu = new RadialMenu({ host: null, lngLat: null, options: [] });
    menu.open();
    vi.advanceTimersByTime(200);

    const pin = document.createElement('div');
    pin.className = 'plan-pin';
    document.body.appendChild(pin);
    pin.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(menu.element).not.toBeNull();
  });

  it('un clic à l\'intérieur de la roue elle-même ne la ferme pas', () => {
    const menu = new RadialMenu({ host: null, lngLat: null, options: [{ icon: 'x', label: 'X', keepOpen: true }] });
    menu.open();
    vi.advanceTimersByTime(200);

    const bg = menu.element!.firstElementChild as HTMLElement; // le cercle de fond, sans handler
    bg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(menu.element).not.toBeNull();
  });
});

describe('RadialMenu — Échap', () => {
  it('la touche Échap détruit la roue', () => {
    const menu = new RadialMenu({ host: null, lngLat: null, options: [] });
    menu.open();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(menu.element).toBeNull();
  });
});

describe('RadialMenu — destroy()', () => {
  it('retire les listeners host (move/zoom) et appelle onClose', () => {
    const host = makeHost();
    const onClose = vi.fn();
    const menu = new RadialMenu({ host, lngLat: null, options: [], onClose });
    menu.open();

    menu.destroy();

    expect(menu.element).toBeNull();
    expect(host.off).toHaveBeenCalledWith('move', expect.any(Function));
    expect(host.off).toHaveBeenCalledWith('zoom', expect.any(Function));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('un second destroy() est un no-op sûr', () => {
    const menu = new RadialMenu({ host: null, lngLat: null, options: [] });
    menu.open();
    menu.destroy();
    expect(() => menu.destroy()).not.toThrow();
  });
});

describe('RadialMenu — _position() : sortie de vue et clamp (durcissement porté de PC-Tac)', () => {
  it('ferme la roue quand le point projeté sort largement du conteneur (pan/zoom)', () => {
    const host = makeHost({ project: () => ({ x: -9999, y: 300 }) });
    const menu = new RadialMenu({ host, lngLat: { lng: 0, lat: 0 }, options: [] });
    menu.open();

    expect(menu.element).toBeNull();
  });

  it('clampe la position près des bords plutôt que de laisser la roue rognée', () => {
    const host = makeHost({ project: () => ({ x: 5, y: 5 }) });
    const menu = new RadialMenu({ host, lngLat: { lng: 0, lat: 0 }, options: [] });
    menu.open();

    expect(menu.element).not.toBeNull();
    const left = parseFloat(menu.element!.style.left);
    const top = parseFloat(menu.element!.style.top);
    expect(left).toBeGreaterThan(5);
    expect(top).toBeGreaterThan(5);
  });
});
