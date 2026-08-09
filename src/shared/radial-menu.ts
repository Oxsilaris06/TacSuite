/**
 * radial-menu.ts — Roue contextuelle (radial menu) — socle commun.
 * =====================================================================
 *
 * Extrait de `src/apps/pctac/wheel.ts` (R3-b, décision D1 : PC-Tac = socle —
 * la version la plus mûre, elle a reçu le durcissement anti-clics-fantômes
 * du commit 75dc04d puis son affinage 300ms→400ms tactile + liste élargie de
 * sélecteurs exclus). `src/apps/pctac/wheel.ts` (adaptateur `Wheel`) et
 * `src/apps/oi/carto/wheel.ts` (adaptateur `OIWheel`) délèguent tous deux à
 * `RadialMenu` par composition — chacun garde ses noms de classes CSS et son
 * type d'options public propre, mais partage la même logique de
 * positionnement/fermeture/sous-menus/clavier.
 *
 * Découplage MapLibre : le constructeur n'accepte PAS `maplibre-gl.Map` mais
 * `RadialMenuHost`, la surface minimale réellement consommée par la roue
 * (`getContainer()`, `project()`, `on`/`off` de 'move'/'zoom') — déterminée
 * par lecture de `Wheel`/`OIWheel` et confirmée par le mock de test
 * `oi-carto-wheel.test.ts` (`MockMap`), qui a exactement cette forme.
 *
 * Ouvre un menu radial à un point lng/lat (ou centre écran si `lngLat` est
 * `null`). Les options sont disposées sur un arc, la roue suit la carte
 * (pan/zoom). Fermée par : tap sur le bouton central (close/back), tap sur
 * une option (sauf `keepOpen`), tap en dehors, touche Échap, `destroy()`
 * programmatique, ou sortie de la vue carte (anti clamp-au-bord).
 *
 * Support sous-menus : une option peut renvoyer une nouvelle liste d'options
 * via `children: () => [...]` → la roue se reconstruit, bouton central
 * devient "Retour".
 */

/** Point {lng,lat} — même forme que `LngLatObj` (SPEC-PLANMAP-SPLIT §3.1). */
export interface RadialMenuLngLat {
  lng: number;
  lat: number;
}

/**
 * Surface minimale de la carte réellement utilisée par la roue : monter
 * l'élément dans son conteneur, le positionner (`project`), suivre les
 * mouvements (`on`/`off` 'move'/'zoom'). Découple `RadialMenu` de
 * `maplibre-gl` — les adaptateurs (`Wheel`, `OIWheel`) restent, eux, typés
 * sur `maplibre-gl.Map` pour leurs consommateurs.
 */
export interface RadialMenuHost {
  getContainer(): HTMLElement;
  project(lngLat: RadialMenuLngLat): { x: number; y: number };
  on(event: 'move' | 'zoom', handler: () => void): void;
  off(event: 'move' | 'zoom', handler: () => void): void;
}

/** Une option de la roue. */
export interface RadialMenuOption {
  id?: string;
  icon: string;
  label: string;
  color?: string;
  bg?: string;
  action?: (menu: RadialMenu) => void;
  children?: () => RadialMenuOption[];
  keepOpen?: boolean;
}

/** Options du constructeur. */
export interface RadialMenuOptions {
  host: RadialMenuHost | null;
  /** Position carte (null = centre écran). */
  lngLat: RadialMenuLngLat | null;
  title?: string;
  /** Icône du bouton central (défaut 'close'). */
  centerIcon?: string;
  options?: RadialMenuOption[];
  /** Rayon de l'arc (défaut 78). */
  radius?: number;
  onClose?: () => void;
  /**
   * Classe CSS du conteneur racine (défaut 'plan-wheel'). Détermine aussi la
   * classe du bouton central (`${wrapperClassName}-center`) et l'auto-
   * exclusion de la fermeture extérieure. Chaque app injecte sa propre
   * feuille de style pour cette classe (comportement inchangé, non pris en
   * charge ici pour rester découplé du CSS applicatif).
   */
  wrapperClassName?: string;
}

const DEFAULT_WRAPPER_CLASS = 'plan-wheel';

/**
 * Sélecteurs exclus de la fermeture extérieure. Liste historiquement déjà
 * partagée entre PC-Tac et OI (`wheel.ts` pctac référençait déjà
 * `.oi-carto-pin` avant cette extraction, wheel.js:186) : un clic sur un pin,
 * une roue ou un panneau — de l'une ou l'autre app — ne doit jamais fermer la
 * roue active. Statique plutôt que dérivée de `wrapperClassName` car ces
 * classes désignent des ÉLÉMENTS TIERS (pins, panneaux), pas le wrapper de la
 * roue elle-même (qui est, lui, ajouté dynamiquement ci-dessous).
 */
const OUTSIDE_EXCLUDE_SELECTORS = [
  '.plan-pin',
  '.plan-pin-label',
  '.oi-carto-pin',
  '.plan-wheel',
  '.plan-inline-panel',
  '.plan-lock-badge',
];

export class RadialMenu {
  host: RadialMenuHost | null;
  lngLat: RadialMenuLngLat | null;
  title: string | undefined;
  centerIcon: string;
  options: RadialMenuOption[];
  radius: number;
  onClose: (() => void) | undefined;
  element: HTMLElement | null;

  private readonly wrapperClassName: string;
  private readonly centerClassName: string;
  private readonly outsideExcludeSelector: string;

  private _destroyed: boolean;
  private _mountedAt: number;
  /** Rayon utile total (bouton compris) pour le clamp de `_position()`. */
  private _extent: number | undefined;
  /** Mémorise l'état initial pour le "back". */
  private _initialOptions: RadialMenuOption[] | undefined;
  private _initialTitle: string | undefined;

  constructor(opts: RadialMenuOptions) {
    this.host = opts.host;
    this.lngLat = opts.lngLat;
    this.title = opts.title;
    this.centerIcon = opts.centerIcon || 'close';
    this.options = opts.options || [];
    this.radius = opts.radius || 78;
    this.onClose = opts.onClose;
    this.wrapperClassName = opts.wrapperClassName || DEFAULT_WRAPPER_CLASS;
    this.centerClassName = `${this.wrapperClassName}-center`;
    this.outsideExcludeSelector = Array.from(
      new Set([...OUTSIDE_EXCLUDE_SELECTORS, `.${this.wrapperClassName}`]),
    ).join(', ');
    this.element = null;
    this._onMove = this._onMove.bind(this);
    this._onOutside = this._onOutside.bind(this);
    this._onKey = this._onKey.bind(this);
    this._destroyed = false;
    this._mountedAt = 0;
  }

  open(): void {
    if (this.element) return;
    this.element = this._buildElement();
    // On monte dans le container de la carte (positionnement absolute)
    const parent = this.host ? this.host.getContainer() : document.body;
    parent.appendChild(this.element);
    this._position();
    if (this.host) {
      this.host.on('move', this._onMove);
      this.host.on('zoom', this._onMove);
    }
    // Ignore le 1er pointerdown (celui qui a ouvert la roue)
    this._mountedAt = Date.now();
    // Capture pour intercepter avant que le map handler ne réagisse
    document.addEventListener('pointerdown', this._onOutside, { capture: true });
    document.addEventListener('touchstart', this._onOutside, { capture: true, passive: true });
    document.addEventListener('keydown', this._onKey);
    // Anim d'apparition
    requestAnimationFrame(() => {
      if (this.element) this.element.classList.add('open');
    });
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.element) {
      try {
        this.element.remove();
      } catch {
        /* ignore */
      }
      this.element = null;
    }
    if (this.host) {
      try {
        this.host.off('move', this._onMove);
      } catch {
        /* ignore */
      }
      try {
        this.host.off('zoom', this._onMove);
      } catch {
        /* ignore */
      }
    }
    document.removeEventListener('pointerdown', this._onOutside, { capture: true });
    document.removeEventListener('touchstart', this._onOutside, { capture: true });
    document.removeEventListener('keydown', this._onKey);
    if (this.onClose) {
      try {
        this.onClose();
      } catch {
        /* ignore */
      }
    }
  }

  /** Remplace dynamiquement les options et redéploie la roue. */
  setOptions(
    options: RadialMenuOption[] | null | undefined,
    {
      title,
      centerIcon,
    }: { title?: string | undefined; centerIcon?: string | undefined } = {},
  ): void {
    this.options = options || [];
    if (title !== undefined) this.title = title;
    if (centerIcon !== undefined) this.centerIcon = centerIcon;
    if (!this.element) return;
    // Reconstruction
    const parent = this.element.parentElement;
    const oldEl = this.element;
    this.element = this._buildElement();
    if (parent) {
      parent.insertBefore(this.element, oldEl);
      oldEl.remove();
    }
    this._position();
    requestAnimationFrame(() => {
      if (this.element) this.element.classList.add('open');
    });
  }

  private _onMove(): void {
    this._position();
  }

  private _onOutside(ev: Event): void {
    if (!this.element) return;
    const isTouch = ('pointerType' in ev && (ev as PointerEvent).pointerType === 'touch') || ev.type === 'touchstart';
    const minDelay = isTouch ? 400 : 120;
    if (Date.now() - this._mountedAt < minDelay) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (target && target.closest(this.outsideExcludeSelector)) {
      return;
    }
    if (!this.element.contains(target)) {
      this.destroy();
    }
  }

  private _onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') this.destroy();
  }

  private _position(): void {
    if (!this.element || !this.host) return;
    const r = this.host.getContainer().getBoundingClientRect();
    if (!this.lngLat) {
      // Centre écran
      this.element.style.left = `${r.width / 2}px`;
      this.element.style.top = `${r.height / 2}px`;
      return;
    }
    const p = this.host.project(this.lngLat);
    const ext = this._extent || 150;
    // Ancre sortie de la vue (pan/zoom) : on FERME la roue plutôt que de la
    // laisser collée au bord, cliquable mais détachée de son point d'ancrage.
    if (p.x < -ext || p.x > r.width + ext || p.y < -ext || p.y > r.height + ext) {
      this.destroy();
      return;
    }
    // Clamp DANS le conteneur (overflow:hidden du wrapper carte) : près d'un
    // bord, une partie des options de la roue était rognée et inatteignable.
    const cx = Math.max(ext, Math.min(r.width - ext, p.x));
    const cy = Math.max(ext, Math.min(r.height - ext, p.y));
    this.element.style.left = `${cx}px`;
    this.element.style.top = `${cy}px`;
  }

  private _buildElement(): HTMLElement {
    const n = this.options.length;
    // Rayon adaptatif : plus compact sur mobile (< 480px de largeur écran)
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const radius = vw < 480 ? Math.min(this.radius, 86) : Math.max(this.radius, 96);
    // Pour 1-2 options, on étale en arc semi-circulaire pour éviter les superpositions.
    const arcSpan = n <= 2 ? Math.PI : 2 * Math.PI;
    const arcStart = n <= 2 ? -Math.PI / 2 - arcSpan / 2 : -Math.PI / 2; // 12h
    const btnSize = vw < 480 ? 52 : 58;
    // Rayon utile total (bouton compris) pour le clamp de _position().
    this._extent = radius + btnSize / 2 + 10;
    const wrap = document.createElement('div');
    wrap.className = this.wrapperClassName;
    wrap.style.cssText = `
            position: absolute;
            width: ${radius * 2 + btnSize + 36}px;
            height: ${radius * 2 + btnSize + 36}px;
            transform: translate(-50%, -50%) scale(0.85);
            opacity: 0;
            transition: transform 160ms cubic-bezier(.34,1.56,.64,1), opacity 140ms ease-out;
            z-index: 60;
            pointer-events: none;
        `;

    // Cercle de fond (verre dépoli)
    const bg = document.createElement('div');
    bg.style.cssText = `
            position: absolute; inset: 0;
            border-radius: 50%;
            background: radial-gradient(circle at center, rgba(20,24,32,0.55) 0%, rgba(20,24,32,0.10) 70%, transparent 100%);
            pointer-events: none;
        `;
    wrap.appendChild(bg);

    // Bouton central (close ou back) - plus grand et explicite
    const center = document.createElement('button');
    center.type = 'button';
    center.className = this.centerClassName;
    const isBack = this.centerIcon === 'arrow_back';
    center.title = isBack ? 'Retour' : 'Fermer';
    center.style.cssText = `
            position: absolute;
            left: 50%; top: 50%;
            transform: translate(-50%, -50%);
            width: 54px; height: 54px;
            border-radius: 50%;
            background: ${isBack ? 'rgba(59,130,246,0.95)' : 'rgba(20,24,32,0.95)'};
            border: 2px solid ${isBack ? '#60a5fa' : 'rgba(255,255,255,0.35)'};
            color: #fff;
            cursor: pointer;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 1px;
            pointer-events: auto;
            box-shadow: 0 4px 16px rgba(0,0,0,0.55);
            transition: transform 100ms ease;
            touch-action: none;
            font-family: var(--font-ui, sans-serif);
        `;
    center.innerHTML = `
            <span class="material-symbols-outlined" aria-hidden="true" style="font-size: 22px; line-height: 1;">${this.centerIcon}</span>
            <span style="font-size: 9px; font-weight: 700; letter-spacing: 0.5px; opacity: 0.85;">${isBack ? 'RETOUR' : 'FERMER'}</span>
        `;
    center.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    center.onclick = (ev) => {
      ev.stopPropagation();
      this.destroy();
    };
    wrap.appendChild(center);

    // Titre optionnel (sous la roue)
    if (this.title) {
      const t = document.createElement('div');
      t.style.cssText = `
                position: absolute;
                left: 50%; bottom: -28px;
                transform: translateX(-50%);
                background: rgba(20,24,32,0.92);
                color: #fff;
                padding: 3px 10px;
                border-radius: 12px;
                font-family: var(--font-ui, sans-serif);
                font-size: 0.78em;
                font-weight: 600;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            `;
      t.textContent = this.title;
      wrap.appendChild(t);
    }

    // Boutons en arc avec labels TOUJOURS visibles (mobile-friendly)
    this.options.forEach((opt, i) => {
      const angle =
        arcStart +
        (n === 1 ? 0 : (i / Math.max(1, n - (arcSpan >= 2 * Math.PI ? 0 : 1))) * arcSpan);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const b = document.createElement('button');
      b.type = 'button';
      b.title = opt.label;
      const bg2 = opt.bg || 'rgba(20,24,32,0.92)';
      const col = opt.color || '#fff';
      const border = opt.color || (opt.bg ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)');
      b.style.cssText = `
                position: absolute;
                left: 50%; top: 50%;
                transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px));
                width: ${btnSize}px; height: ${btnSize}px;
                border-radius: 50%;
                background: ${bg2};
                border: 2px solid ${border};
                color: ${col};
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                pointer-events: auto;
                box-shadow: 0 3px 12px rgba(0,0,0,0.55);
                transition: transform 100ms ease, box-shadow 100ms ease;
                touch-action: none;
                padding: 0;
            `;
      b.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true" style="font-size: ${btnSize >= 56 ? 26 : 22}px; line-height: 1;">${opt.icon}</span>`;

      // LABEL TOUJOURS VISIBLE en dessous du bouton, sur fond foncé
      // Position : ajustée selon l'angle pour éviter la superposition avec d'autres
      const labelBelow = y > -radius * 0.3; // si bouton dans la moitié basse/centre → label dessous
      const labelOffset = labelBelow ? btnSize / 2 + 6 : -(btnSize / 2 + 16);
      const tip = document.createElement('span');
      tip.textContent = opt.label;
      tip.style.cssText = `
                position: absolute;
                top: calc(50% + ${labelOffset}px);
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.85);
                color: #fff;
                font-family: var(--font-ui, sans-serif);
                font-size: 0.7em;
                font-weight: 700;
                letter-spacing: 0.3px;
                padding: 2px 7px;
                border-radius: 8px;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 1px 4px rgba(0,0,0,0.5);
                max-width: 110px;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
      b.appendChild(tip);

      b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      b.onclick = (ev) => {
        ev.stopPropagation();
        if (opt.children) {
          const childOpts = typeof opt.children === 'function' ? opt.children() : opt.children;
          this.setOptions(childOpts, { title: opt.label, centerIcon: 'arrow_back' });
          // Quand on est dans un sous-menu, le bouton central revient au précédent
          const center2 = this.element ? this.element.querySelector(`.${this.centerClassName}`) : null;
          if (center2 instanceof HTMLElement) {
            (center2 as HTMLButtonElement).onclick = (e) => {
              e.stopPropagation();
              this.setOptions(this._initialOptions || this.options, {
                title: this._initialTitle,
                centerIcon: 'close',
              });
              const c3 = this.element ? this.element.querySelector(`.${this.centerClassName}`) : null;
              if (c3 instanceof HTMLElement) {
                (c3 as HTMLButtonElement).onclick = (ee) => {
                  ee.stopPropagation();
                  this.destroy();
                };
              }
            };
          }
          return;
        }
        if (opt.action) {
          try {
            opt.action(this);
          } catch (e) {
            console.error('[RadialMenu] action erreur:', e);
          }
        }
        if (!opt.keepOpen) this.destroy();
      };
      wrap.appendChild(b);
    });

    // Mémorise l'état initial pour le "back"
    this._initialOptions = this._initialOptions || this.options;
    this._initialTitle = this._initialTitle || this.title;

    return wrap;
  }
}

// IMPORTANT : on NE TOUCHE PAS au `transform` des boutons radiaux en :active.
// Leur transform encode leur position radiale ([translate ... + position]); le
// modifier ferait sauter le bouton (ex : vers le centre). Feedback visuel par
// filter/box-shadow uniquement, jamais par transform. Chaque adaptateur
// (`Wheel`, `OIWheel`) injecte sa PROPRE feuille de style (classes CSS
// distinctes `.plan-wheel`/`.oi-wheel`), inchangé par cette extraction.
