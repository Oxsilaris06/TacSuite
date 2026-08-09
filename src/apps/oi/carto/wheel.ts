import type { Map as MapLibreMap } from 'maplibre-gl';

import { RadialMenu } from '@shared/radial-menu.js';
import type { RadialMenuHost, RadialMenuOption } from '@shared/radial-menu.js';

/**
 * Roue contextuelle (radial menu) — adaptateur OI. Portée depuis pctac2
 * (wheel.js) en script global, puis EXTRAITE (R3-b, décision D1 : PC-Tac =
 * socle) vers `@shared/radial-menu.js` (`RadialMenu`) : `OIWheel` délègue
 * désormais au même moteur que `Wheel` (`@pctac/wheel.js`) par composition,
 * en gardant son type d'options et ses classes CSS (`.oi-wheel`) propres.
 *
 * Durcissements résorbés par cette extraction (alignement sur la version
 * PC-Tac, la plus mûre — commit 75dc04d puis affinages ultérieurs) :
 *  - fenêtre d'ignore tactile du clic extérieur : 300ms → 400ms ;
 *  - sélecteurs exclus de la fermeture extérieure : `.plan-pin`/`.oi-carto-pin`
 *    → liste élargie (`.plan-pin-label`, `.plan-wheel`, `.plan-inline-panel`,
 *    `.plan-lock-badge` en plus) ;
 *  - `_position()` ne se contentait pas de `map.project()` : ferme désormais
 *    la roue quand l'ancre sort de la vue (pan/zoom) et clampe la position
 *    dans le conteneur près des bords (`_extent`), comme PC-Tac ;
 *  - sous-menus (`children`) désormais disponibles au niveau moteur (non
 *    exposés par le type d'options public `OiCartoWheelOption`, inchangé).
 * Écart mineur, cosmétique, accepté par cette unification de socle : le
 * clamp de rayon "desktop" passe de 98 à 96px (bornes PC-Tac).
 *
 * Ouvre un menu radial à un point lng/lat ; suit la carte ; se ferme
 * sur clic extérieur / Échap / bouton central / choix d'une option.
 */
export class OIWheel {
    map: MapLibreMap | null;

    private readonly _menu: RadialMenu;

    constructor(opts: {
        map?: MapLibreMap;
        lngLat?: { lng: number; lat: number };
        title?: string;
        centerIcon?: string;
        options?: Array<{ label: string; icon: string; action?: (wheel: OIWheel) => void; keepOpen?: boolean; bg?: string; color?: string }>;
        radius?: number;
        onClose?: () => void;
    }) {
        this.map = opts.map || null;
        this._menu = new RadialMenu({
            host: toHost(this.map),
            lngLat: opts.lngLat || null,
            ...(opts.title !== undefined ? { title: opts.title } : {}),
            ...(opts.centerIcon !== undefined ? { centerIcon: opts.centerIcon } : {}),
            options: adaptOptions(opts.options || [], this),
            radius: opts.radius || 80,
            ...(opts.onClose ? { onClose: opts.onClose } : {}),
            wrapperClassName: 'oi-wheel',
        });
    }

    get lngLat(): { lng: number; lat: number } | null {
        return this._menu.lngLat;
    }

    get title(): string | null {
        return this._menu.title ?? null;
    }

    get centerIcon(): string {
        return this._menu.centerIcon;
    }

    get radius(): number {
        return this._menu.radius;
    }

    get onClose(): (() => void) | null {
        return this._menu.onClose ?? null;
    }

    get element(): HTMLElement | null {
        return this._menu.element;
    }

    get options(): Array<{ label: string; icon: string; action?: (wheel: OIWheel) => void; keepOpen?: boolean; bg?: string; color?: string }> {
        // Reflète la forme publique d'origine (pas de `children`/`id`) — usage
        // lecture seule (tests : valeur par défaut `[]`).
        return this._menu.options as unknown as Array<{ label: string; icon: string; action?: (wheel: OIWheel) => void; keepOpen?: boolean; bg?: string; color?: string }>;
    }

    open(): void {
        this._menu.open();
    }

    destroy(): void {
        this._menu.destroy();
    }
}

/** Adapte un `maplibre-gl.Map` en `RadialMenuHost` minimal. */
function toHost(map: MapLibreMap | null): RadialMenuHost | null {
    if (!map) return null;
    return {
        getContainer: () => map.getContainer(),
        project: (lngLat) => map.project(lngLat),
        on: (event, handler) => { map.on(event, handler); },
        off: (event, handler) => { map.off(event, handler); },
    };
}

/**
 * Adapte les options publiques OI en `RadialMenuOption[]` : `action` reçoit
 * `self` (l'`OIWheel` public), pas le `RadialMenu` interne — comportement
 * identique à l'ancien `OIWheel` monolithique où `opt.action(this)` recevait
 * l'instance `OIWheel`.
 */
function adaptOptions(
    options: Array<{ label: string; icon: string; action?: (wheel: OIWheel) => void; keepOpen?: boolean; bg?: string; color?: string }>,
    self: OIWheel,
): RadialMenuOption[] {
    return options.map((opt) => {
        const adapted: RadialMenuOption = {
            icon: opt.icon,
            label: opt.label,
        };
        if (opt.color !== undefined) adapted.color = opt.color;
        if (opt.bg !== undefined) adapted.bg = opt.bg;
        if (opt.keepOpen !== undefined) adapted.keepOpen = opt.keepOpen;
        if (opt.action) {
            const action = opt.action;
            adapted.action = () => action(self);
        }
        return adapted;
    });
}

// Injection CSS du style #oi-wheel-style
if (typeof document !== 'undefined' && !document.getElementById('oi-wheel-style')) {
    const s = document.createElement('style');
    s.id = 'oi-wheel-style';
    s.textContent = `
        .oi-wheel.open { opacity:1 !important; transform:translate(-50%,-50%) scale(1) !important; }
        .oi-wheel button:active { filter:brightness(0.82); box-shadow:0 1px 4px rgba(0,0,0,0.75) inset, 0 1px 5px rgba(0,0,0,0.45); }
        .oi-wheel-center:active { transform:translate(-50%,-50%) scale(0.94) !important; }
        .oi-carto-inline-panel { position:absolute; z-index:62; transform:translate(-50%,-100%);
            background:rgba(20,24,32,0.97); border:1px solid rgba(255,255,255,0.18); border-radius:12px;
            padding:10px; box-shadow:0 8px 28px rgba(0,0,0,0.6); pointer-events:auto;
            font-family:var(--font-ui,sans-serif); color:#fff; max-width:min(92vw,340px); }
        .oi-carto-member-placed { opacity:0.5; filter:grayscale(0.7); }
        .oi-carto-fn-group-title { font-size:0.72em; text-transform:uppercase; letter-spacing:0.5px;
            color:var(--text-muted,#9aa4b2); margin:8px 0 4px; font-weight:700; }
    `;
    document.head.appendChild(s);
}
