/**
 * pm-measure-locks.test.ts — Entrée et sortie de la mesure face aux cadenas des
 * formes (retours terrain 2026-10-02, décision 4 : les dessins ne captent plus
 * le toucher, leur cadenas non plus).
 *
 * Les tests unitaires de chaque groupe (pm-measure, pm-shapesrender) mockent
 * leurs voisins. Celui-ci enchaîne les VRAIES méthodes — `_setTool`
 * (draw-tools.ts), `_startMeasure` / `_clearMeasureState` / `_cancelMeasure`
 * (measure.ts), `_renderShapeLocks` / `_toggleShapeLock` (shapes-render.ts),
 * `_makeLockBadge` (pins.ts) — pour garder l'ORDRE réel : `_setTool` vide
 * `_measureState` AVANT de changer `drawTool`, et c'est `_clearMeasureState` qui
 * rend leur cadenas aux formes. Seul ce qui est étranger au sujet (poignées,
 * bulles d'aide, sélection) est mocké ; `maplibregl.Marker` aussi (cf.
 * pm-shapesrender.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHAPES_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { DrawToolsMethods } from '../../../src/apps/pctac/planmap/draw-tools.js';
import { GeoMethods } from '../../../src/apps/pctac/planmap/geo.js';
import { MeasureMethods } from '../../../src/apps/pctac/planmap/measure.js';
import { PinsMethods } from '../../../src/apps/pctac/planmap/pins.js';
import { ShapesRenderMethods } from '../../../src/apps/pctac/planmap/shapes-render.js';
import { SafeMethods, createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PlanMapInternal, PlanShape } from '../../../src/apps/pctac/planmap/types.js';

vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        constructor(opts: { element?: HTMLElement } = {}) {
            this._element = opts.element ?? document.createElement('div');
        }
        setLngLat(): this { return this; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return this._element; }
    }
    return { default: { Marker: FakeMarker } };
});

/** Plan au repos : une forme verrouillée en stockage, son cadenas déjà posé sur la carte. */
function makeApp() {
    const shape: PlanShape = { id: 's1', type: 'circle', color: '#ef4444', locked: true, center: [2, 48], edge: [2, 48.01] };
    localStorage.setItem(SHAPES_KEY, JSON.stringify([shape]));
    const map = {
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng * 1000, y: ll.lat * 1000 })),
        getCenter: vi.fn(() => ({ lng: 2, lat: 48 })),
        getCanvas: vi.fn(() => ({ style: {} as { cursor: string } })),
        dragPan: { enable: vi.fn(), disable: vi.fn() },
        doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
        boxZoom: { enable: vi.fn(), disable: vi.fn() },
        // Source des formes présente : `_renderShapes` va jusqu'au bout (donc jusqu'à `_renderShapeLocks`).
        getSource: vi.fn(() => ({ setData: vi.fn() })),
    };
    const app = {
        ...createPlanMapState(),
        ...SafeMethods,
        ...GeoMethods,
        ...DrawToolsMethods,
        ...MeasureMethods,
        ...ShapesRenderMethods,
        _loadPins: PinsMethods._loadPins,
        _makeLockBadge: PinsMethods._makeLockBadge,
        _applyLockBadgeStyle: PinsMethods._applyLockBadgeStyle,
        map,
        _deselectShape: vi.fn(),
        _clearHandles: vi.fn(),
        _renderHandles: vi.fn(),
        _renderShapeTexts: vi.fn(),
        _renderDiameters: vi.fn(),
        _renderCommittedMeasures: vi.fn(),
        _updateFloatingToolbarPos: vi.fn(),
        _showHint: vi.fn(),
        _hideHint: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
    } as unknown as PlanMapInternal;
    app._renderShapeLocks();
    const badge = (): HTMLElement => {
        const el = app._shapeLockMarkers?.get('s1')?.el;
        if (!el) throw new Error('cadenas de la forme absent');
        return el;
    };
    const clickBadge = (): void => { badge().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
    const isLocked = (): boolean | undefined => (JSON.parse(localStorage.getItem(SHAPES_KEY) ?? '[]') as PlanShape[])[0]?.locked;
    return { app, badge, clickBadge, isLocked };
}

beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('cadenas des formes — entrée et sortie de la mesure (ordre réel de _setTool)', () => {
    it('au repos : le cadenas est cliquable et un clic verrouille / déverrouille la forme', () => {
        const { app, badge, clickBadge, isLocked } = makeApp();
        expect(app.drawTool).toBeNull();
        expect(badge().style.pointerEvents).toBe('auto');
        clickBadge();
        expect(isLocked()).toBe(false);
    });

    it('ouvrir la mesure rend le cadenas inerte : le toucher traverse et un clic ne bascule rien', () => {
        const { app, badge, clickBadge, isLocked } = makeApp();
        app._setTool('measure');
        expect(app.drawTool).toBe('measure');
        expect(badge().style.pointerEvents).toBe('none');
        clickBadge();
        expect(isLocked()).toBe(true);
    });

    it('« Quitter » rend son cadenas à la forme (_clearMeasureState avant le changement d\'outil)', () => {
        const { app, badge, clickBadge, isLocked } = makeApp();
        app._setTool('measure');
        app._cancelMeasure();
        expect(app.drawTool).toBeNull();
        expect(badge().style.pointerEvents).toBe('auto');
        clickBadge();
        expect(isLocked()).toBe(false);
    });

    it('re-cliquer l\'outil mesure (bascule) ou passer à un autre outil rend aussi le cadenas', () => {
        const { app, badge } = makeApp();
        app._setTool('measure');
        app._setTool('measure');
        expect(app.drawTool).toBeNull();
        expect(badge().style.pointerEvents).toBe('auto');

        app._setTool('measure');
        expect(badge().style.pointerEvents).toBe('none');
        app._setTool('rectangle');
        expect(app.drawTool).toBe('rectangle');
        expect(badge().style.pointerEvents).toBe('auto');
    });

    it('une ligne validée pendant la mesure relance le rendu des formes : l\'outil reste ouvert, le cadenas reste inerte', () => {
        const { app, badge } = makeApp();
        app._setTool('measure');
        const rendered = vi.spyOn(app, '_renderShapeLocks');
        app._measureAddVertex([2, 48]);
        app._measureAddVertex([2.1, 48]);
        app._finishMeasure();
        expect(rendered).toHaveBeenCalled();   // `_finishMeasure` → `_renderShapes` → `_renderShapeLocks`
        expect(app.drawTool).toBe('measure');
        expect(badge().style.pointerEvents).toBe('none');
    });
});
