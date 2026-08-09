/**
 * wheel.ts — Roue contextuelle (radial menu) — adaptateur PC-Tac.
 * =====================================================================
 *
 * Port TypeScript de `modules/pctac/wheel.js` (GStart-main, 351 LOC),
 * vérifié ligne à ligne, puis EXTRAIT (R3-b, décision D1 : PC-Tac = socle)
 * vers `@shared/radial-menu.js` (`RadialMenu`). `Wheel` est désormais un
 * adaptateur mince : il garde exactement les types publics et le
 * comportement d'origine (options, sous-menus, positionnement, fermeture
 * extérieure, clavier, durcissement anti-clics-fantômes du commit 75dc04d)
 * en déléguant à `RadialMenu` par composition — `map: MaplibreMap | null`
 * est adapté en `RadialMenuHost` minimal (project/getContainer/on/off),
 * `WheelOption.action`/`children` sont adaptés pour continuer à recevoir
 * `this` (le `Wheel`, pas le `RadialMenu` interne) comme avant.
 *
 * Design : verre dépoli sombre, icônes Material, label au survol, animé.
 */
import type { Map as MaplibreMap } from 'maplibre-gl';

import { RadialMenu } from '@shared/radial-menu.js';
import type { RadialMenuHost, RadialMenuOption } from '@shared/radial-menu.js';

/** Point {lng,lat} — même forme que `LngLatObj` (SPEC-PLANMAP-SPLIT §3.1). */
export interface WheelLngLat {
  lng: number;
  lat: number;
}

/** Une option de la roue (wheel.js:24-27). */
export interface WheelOption {
  id?: string;
  icon: string;
  label: string;
  color?: string;
  bg?: string;
  action?: (wheel: Wheel) => void;
  children?: () => WheelOption[];
  keepOpen?: boolean;
}

/** Options du constructeur (wheel.js:18-30). */
export interface WheelOptions {
  map: MaplibreMap | null;
  /** Position carte (null = centre écran). */
  lngLat: WheelLngLat | null;
  title?: string;
  /** Icône du bouton central (défaut 'close'). */
  centerIcon?: string;
  options?: WheelOption[];
  /** Rayon de l'arc (défaut 78). */
  radius?: number;
  onClose?: () => void;
}

/** Adapte un `maplibre-gl.Map` en `RadialMenuHost` minimal. */
function toHost(map: MaplibreMap | null): RadialMenuHost | null {
  if (!map) return null;
  return {
    getContainer: () => map.getContainer(),
    project: (lngLat) => map.project(lngLat),
    on: (event, handler) => {
      map.on(event, handler);
    },
    off: (event, handler) => {
      map.off(event, handler);
    },
  };
}

/**
 * Adapte `WheelOption[]` en `RadialMenuOption[]` : les callbacks
 * `action`/`children` déclarés par l'appelant reçoivent `self` (le `Wheel`
 * public), pas le `RadialMenu` interne — comportement identique à l'ancien
 * `Wheel` monolithique où `opt.action(this)` recevait l'instance `Wheel`.
 */
function adaptOptions(options: WheelOption[], self: Wheel): RadialMenuOption[] {
  return options.map((opt) => {
    const adapted: RadialMenuOption = {
      icon: opt.icon,
      label: opt.label,
    };
    if (opt.id !== undefined) adapted.id = opt.id;
    if (opt.color !== undefined) adapted.color = opt.color;
    if (opt.bg !== undefined) adapted.bg = opt.bg;
    if (opt.keepOpen !== undefined) adapted.keepOpen = opt.keepOpen;
    if (opt.action) {
      const action = opt.action;
      adapted.action = () => action(self);
    }
    if (opt.children) {
      const children = opt.children;
      adapted.children = () => adaptOptions(children(), self);
    }
    return adapted;
  });
}

export class Wheel {
  map: MaplibreMap | null;

  private readonly _menu: RadialMenu;

  constructor(opts: WheelOptions) {
    this.map = opts.map;
    this._menu = new RadialMenu({
      host: toHost(opts.map),
      lngLat: opts.lngLat,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.centerIcon !== undefined ? { centerIcon: opts.centerIcon } : {}),
      options: adaptOptions(opts.options || [], this),
      ...(opts.radius !== undefined ? { radius: opts.radius } : {}),
      ...(opts.onClose ? { onClose: opts.onClose } : {}),
      wrapperClassName: 'plan-wheel',
    });
  }

  get lngLat(): WheelLngLat | null {
    return this._menu.lngLat;
  }

  get title(): string | undefined {
    return this._menu.title;
  }

  get centerIcon(): string {
    return this._menu.centerIcon;
  }

  get radius(): number {
    return this._menu.radius;
  }

  get onClose(): (() => void) | undefined {
    return this._menu.onClose;
  }

  get element(): HTMLElement | null {
    return this._menu.element;
  }

  open(): void {
    this._menu.open();
  }

  destroy(): void {
    this._menu.destroy();
  }

  /** Remplace dynamiquement les options et redéploie la roue. */
  setOptions(
    options: WheelOption[] | null | undefined,
    opts: { title?: string | undefined; centerIcon?: string | undefined } = {},
  ): void {
    this._menu.setOptions(adaptOptions(options || [], this), opts);
  }
}

// CSS de l'animation d'ouverture (injecté une fois)
//
// IMPORTANT : on NE TOUCHE PAS au `transform` des boutons radiaux en :active.
// Leur transform encode leur position radiale ([translate ... + position]); le
// modifier ferait sauter le bouton (ex : vers le centre). Feedback visuel par
// filter/box-shadow uniquement, jamais par transform.
if (typeof document !== 'undefined' && !document.getElementById('plan-wheel-style')) {
  const s = document.createElement('style');
  s.id = 'plan-wheel-style';
  s.textContent = `
        .plan-wheel.open { opacity: 1 !important; transform: translate(-50%, -50%) scale(1) !important; }
        /* Feedback de clic SANS toucher au transform (qui contient la position) */
        .plan-wheel button:active {
            filter: brightness(0.82);
            box-shadow: 0 1px 4px rgba(0,0,0,0.75) inset, 0 1px 5px rgba(0,0,0,0.45);
        }
        /* Centre : centré sur le point d'ancrage, scale ok sans déplacement */
        .plan-wheel-center:active {
            transform: translate(-50%, -50%) scale(0.94) !important;
        }
    `;
  document.head.appendChild(s);
}
