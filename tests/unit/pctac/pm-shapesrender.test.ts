/**
 * pm-shapesrender.test.ts — Comportement OBSERVÉ des 12 méthodes RENDU DES
 * FORMES de `modules/pctac/planMap.js` (GStart-main, 5596 LOC, lecture seule),
 * pour le portage `src/apps/pctac/planmap/shapes-render.ts` (P2.CONV, paquet
 * `pm-shapesrender`). Références `planMap.js:<ligne>` en commentaire, cf.
 * docs/SPEC-PLANMAP-SPLIT.md §4.10, §5.1, §5.4, §9.
 *
 * `this` FACTICE portant un faux `map` (jamais `new maplibregl.Map`, WebGL
 * absent sous jsdom — SPEC-PCTAC-CONVERSION §8.4).
 *
 * `maplibregl.Marker` est mocké : sa vraie implémentation appelle des méthodes
 * internes de `maplibregl.Map` (`_getUIString`, `on`, `getCanvasContainer`…)
 * lors de `addTo()`, qu'un faux `map` minimal ne peut pas fournir (vérifié :
 * `new maplibregl.Marker(...).addTo(fakeMap)` jette `TypeError:
 * t._getUIString is not a function` sous jsdom). `shapes-render.ts` n'utilise
 * de 'maplibre-gl' QUE `Marker` au runtime (le reste est `import type`) : le
 * mock ne couvre donc que `Marker`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeoMethods } from '../../../src/apps/pctac/planmap/geo.js';
import { ShapesRenderMethods } from '../../../src/apps/pctac/planmap/shapes-render.js';
import { createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PlanMapInternal, PlanShape } from '../../../src/apps/pctac/planmap/types.js';

vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        private _lngLat: unknown = null;
        constructor(opts: { element?: HTMLElement } = {}) {
            this._element = opts.element ?? document.createElement('div');
        }
        setLngLat(ll: unknown): this { this._lngLat = ll; return this; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return this._element; }
        getLngLat(): unknown { return this._lngLat; }
    }
    return { default: { Marker: FakeMarker } };
});

function makeFakeMap() {
    return {
        getSource: vi.fn(),
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng, y: ll.lat })),
        unproject: vi.fn((p: [number, number]) => ({ lng: p[0], lat: p[1] })),
        getCanvas: vi.fn(() => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect })),
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

function makeShape(overrides: Partial<PlanShape> & Pick<PlanShape, 'id' | 'type'>): PlanShape {
    return { color: '#ef4444', ...overrides };
}

interface FakeMocks {
    loadShapes: ReturnType<typeof vi.fn>;
    saveShapes: ReturnType<typeof vi.fn>;
    pushHistory: ReturnType<typeof vi.fn>;
    refreshUndoRedoButtons: ReturnType<typeof vi.fn>;
    renderHandles: ReturnType<typeof vi.fn>;
    clearHandles: ReturnType<typeof vi.fn>;
    renderCommittedMeasures: ReturnType<typeof vi.fn>;
    updateFloatingToolbarPos: ReturnType<typeof vi.fn>;
    renderPins: ReturnType<typeof vi.fn>;
    showHint: ReturnType<typeof vi.fn>;
    hideHint: ReturnType<typeof vi.fn>;
    openShapeWheel: ReturnType<typeof vi.fn>;
    makeLockBadge: ReturnType<typeof vi.fn>;
    applyLockBadgeStyle: ReturnType<typeof vi.fn>;
    startShapeGesture: ReturnType<typeof vi.fn>;
}

/** Construit un `this` factice conforme à `PlanMapInternal` pour `ShapesRenderMethods`. */
function makeFakeThis(opts: { shapes?: PlanShape[]; withMap?: boolean } = {}): {
    fake: PlanMapInternal;
    mocks: FakeMocks;
    shapes: () => PlanShape[];
    map: FakeMap | null;
} {
    const { shapes = [], withMap = true } = opts;
    let stored: PlanShape[] = shapes;
    const state = createPlanMapState();
    const map = withMap ? makeFakeMap() : null;

    const mocks: FakeMocks = {
        loadShapes: vi.fn((): PlanShape[] => stored),
        saveShapes: vi.fn((list: readonly PlanShape[]): void => { stored = list.slice(); }),
        pushHistory: vi.fn(),
        refreshUndoRedoButtons: vi.fn(),
        renderHandles: vi.fn(),
        clearHandles: vi.fn(),
        renderCommittedMeasures: vi.fn(),
        updateFloatingToolbarPos: vi.fn(),
        renderPins: vi.fn(),
        showHint: vi.fn(),
        hideHint: vi.fn(),
        openShapeWheel: vi.fn(),
        makeLockBadge: vi.fn((locked: boolean) => {
            const el = document.createElement('span');
            el.className = 'plan-lock-badge';
            el.dataset.locked = String(locked);
            return el;
        }),
        applyLockBadgeStyle: vi.fn(),
        startShapeGesture: vi.fn(),
    };

    const base = {
        ...state,
        ...GeoMethods,
        ...ShapesRenderMethods,
        map: map as unknown as PlanMapInternal['map'],
        _loadShapes: mocks.loadShapes,
        _saveShapes: mocks.saveShapes,
        _pushHistory: mocks.pushHistory,
        _refreshUndoRedoButtons: mocks.refreshUndoRedoButtons,
        _renderHandles: mocks.renderHandles,
        _clearHandles: mocks.clearHandles,
        // `_renderShapeTexts` / `_renderDiameters` / `_renderShapeLocks` NE SONT
        // PAS mockées ici : ce sont 3 des 12 méthodes sous test de ce paquet.
        // Le `base` doit exécuter les VRAIES implémentations (déjà apportées par
        // `...ShapesRenderMethods` ci-dessus) ; seule la suite `_renderShapes`
        // les remplace ponctuellement pour isoler la délégation (cf. plus bas).
        _renderCommittedMeasures: mocks.renderCommittedMeasures,
        _updateFloatingToolbarPos: mocks.updateFloatingToolbarPos,
        _renderPins: mocks.renderPins,
        _showHint: mocks.showHint,
        _hideHint: mocks.hideHint,
        _openShapeWheel: mocks.openShapeWheel,
        _makeLockBadge: mocks.makeLockBadge,
        _applyLockBadgeStyle: mocks.applyLockBadgeStyle,
        _startShapeGesture: mocks.startShapeGesture,
    };

    const fake = base as unknown as PlanMapInternal;
    return { fake, mocks, shapes: () => stored, map };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// ============================================================
// Fumée : aucune des 12 méthodes ne jette quand le DOM / la
// source GeoJSON sont absents (SPEC-PLANMAP-SPLIT §9).
// ============================================================
describe('fumée — DOM/source absents (planMap.js:2604-4853)', () => {
    it('_renderShapes ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._renderShapes()).not.toThrow();
    });

    it('_renderShapes ne jette pas quand la source GeoJSON est absente (planMap.js:2605-2606)', () => {
        const { fake, map } = makeFakeThis({ shapes: [makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]] })] });
        map?.getSource.mockReturnValue(undefined);
        expect(() => fake._renderShapes()).not.toThrow();
        expect(map?.getSource).toHaveBeenCalledWith('plan-shapes-src');
    });

    it('_renderDiameters ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._renderDiameters()).not.toThrow();
        expect(fake._diameterMarkers).toEqual([]);
    });

    it('_toggleLock ne jette pas', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._toggleLock()).not.toThrow();
    });

    it('_updateLockButton ne jette pas quand #plan_draw_lock est absent du DOM', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._updateLockButton()).not.toThrow();
    });

    it('_toggleGlobalDiameter ne jette pas quand #plan_draw_diameter_toggle est absent du DOM', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._toggleGlobalDiameter()).not.toThrow();
    });

    it('_renderShapeLocks ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._renderShapeLocks()).not.toThrow();
    });

    it('_adjustFontSize / _adjustStrokeWidth / _toggleShapeDiameter / _toggleShapeLock ne jettent pas quand la forme est absente', () => {
        const { fake } = makeFakeThis({ shapes: [] });
        expect(() => fake._adjustFontSize('missing', 2)).not.toThrow();
        expect(() => fake._adjustStrokeWidth('missing', 2)).not.toThrow();
        expect(() => fake._toggleShapeDiameter('missing')).not.toThrow();
        expect(() => fake._toggleShapeLock('missing')).not.toThrow();
    });

    it('_shapePixelBounds ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._shapePixelBounds(makeShape({ id: 's1', type: 'line' }))).not.toThrow();
    });

    it('_renderShapeTexts ne jette pas sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._renderShapeTexts()).not.toThrow();
    });
});

// ============================================================
// _renderShapeLocks — invariant §5.4 : réconciliation PAR ID
// ============================================================
describe('_renderShapeLocks (planMap.js:3088-3120) — réconciliation par id', () => {
    it('un second appel avec la même liste RÉUTILISE les entrées (identité préservée, aucun marker recréé)', () => {
        const shape = makeShape({ id: 's1', type: 'circle', locked: true, center: [2, 48], edge: [2, 48.01] });
        const { fake, mocks } = makeFakeThis({ shapes: [shape] });

        fake._renderShapeLocks();
        expect(mocks.makeLockBadge).toHaveBeenCalledTimes(1);
        const firstEntry = fake._shapeLockMarkers?.get('s1');
        expect(firstEntry).toBeDefined();

        fake._renderShapeLocks();
        // Aucun nouveau badge fabriqué : l'entrée existante a été réutilisée.
        expect(mocks.makeLockBadge).toHaveBeenCalledTimes(1);
        const secondEntry = fake._shapeLockMarkers?.get('s1');
        expect(secondEntry).toBe(firstEntry);
        expect(secondEntry?.marker).toBe(firstEntry?.marker);
        expect(secondEntry?.el).toBe(firstEntry?.el);
    });

    it('une forme qui disparaît de la liste retire son marker de la Map (planMap.js:3115-3119)', () => {
        const shape = makeShape({ id: 's1', type: 'circle', locked: true, center: [2, 48] });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderShapeLocks();
        expect(fake._shapeLockMarkers?.has('s1')).toBe(true);

        fake._loadShapes = (): PlanShape[] => [];
        fake._renderShapeLocks();
        expect(fake._shapeLockMarkers?.has('s1')).toBe(false);
    });

    it('ignore les formes sans id (mesures/anneaux — planMap.js:3094)', () => {
        // `PlanShape.id` est typé `string` non-optionnel ; une chaîne vide (donnée
        // legacy dégradée) reste possible à l'exécution — reproduit le garde `if (!s.id)`.
        const shape = makeShape({ id: '', type: 'measure', locked: true });
        const { fake, mocks } = makeFakeThis({ shapes: [shape] });
        expect(() => fake._renderShapeLocks()).not.toThrow();
        expect(mocks.makeLockBadge).not.toHaveBeenCalled();
    });
});

// ============================================================
// _toggleShapeLock — invariant §5.4 : défaut reopenWheel = true
// ============================================================
describe('_toggleShapeLock (planMap.js:4319-4334) — défaut reopenWheel', () => {
    it('appelé SANS second argument, rouvre la roue (défaut true)', () => {
        const shape = makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]] });
        const { fake, mocks } = makeFakeThis({ shapes: [shape] });
        fake._toggleShapeLock('s1');
        expect(mocks.openShapeWheel).toHaveBeenCalledTimes(1);
        expect(mocks.openShapeWheel).toHaveBeenCalledWith('s1', expect.anything());
    });

    it('appelé avec reopenWheel=false (cadenas direct), NE rouvre PAS la roue', () => {
        const shape = makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]] });
        const { fake, mocks } = makeFakeThis({ shapes: [shape] });
        fake._toggleShapeLock('s1', false);
        expect(mocks.openShapeWheel).not.toHaveBeenCalled();
    });

    it('bascule `locked` et persiste via _saveShapes', () => {
        const shape = makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]] });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        fake._toggleShapeLock('s1', false);
        expect(shapes().find(s => s.id === 's1')?.locked).toBe(true);
        fake._toggleShapeLock('s1', false);
        expect(shapes().find(s => s.id === 's1')?.locked).toBe(false);
    });
});

// ============================================================
// _toggleLock — verrou GLOBAL, localStorage direct
// ============================================================
describe('_toggleLock (planMap.js:2791-2804) — localStorage direct', () => {
    it("bascule 'pcTacPlanLocked' dans localStorage à chaque appel", () => {
        localStorage.removeItem('pcTacPlanLocked');
        const { fake } = makeFakeThis({ withMap: false });

        fake._toggleLock();
        expect(fake._locked).toBe(true);
        expect(localStorage.getItem('pcTacPlanLocked')).toBe('1');

        fake._toggleLock();
        expect(fake._locked).toBe(false);
        expect(localStorage.getItem('pcTacPlanLocked')).toBe('0');
    });

    it('verrouiller retire les poignées ; déverrouiller les réaffiche ; les pings sont toujours re-rendus', () => {
        const { fake, mocks } = makeFakeThis({ withMap: false });

        fake._toggleLock();
        expect(mocks.clearHandles).toHaveBeenCalledTimes(1);
        expect(mocks.renderHandles).not.toHaveBeenCalled();
        expect(mocks.renderPins).toHaveBeenCalledTimes(1);

        fake._toggleLock();
        expect(mocks.renderHandles).toHaveBeenCalledTimes(1);
        expect(mocks.renderPins).toHaveBeenCalledTimes(2);
    });
});

// ============================================================
// Ajustements numériques (clamps)
// ============================================================
describe('_adjustFontSize (planMap.js:3489-3500) — clamp [9,72]', () => {
    it('clampe en haut à 72', () => {
        const shape = makeShape({ id: 's1', type: 'text', fontSize: 70 });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        fake._adjustFontSize('s1', 10);
        expect(shapes().find(s => s.id === 's1')?.fontSize).toBe(72);
    });

    it('clampe en bas à 9', () => {
        const shape = makeShape({ id: 's1', type: 'text', fontSize: 10 });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        fake._adjustFontSize('s1', -10);
        expect(shapes().find(s => s.id === 's1')?.fontSize).toBe(9);
    });

    it('part de 13 par défaut si fontSize absent', () => {
        const shape = makeShape({ id: 's1', type: 'text' });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        fake._adjustFontSize('s1', 1);
        expect(shapes().find(s => s.id === 's1')?.fontSize).toBe(14);
    });
});

describe('_adjustStrokeWidth (planMap.js:3503-3514) — clamp [1,24]', () => {
    it('clampe en haut à 24', () => {
        const shape = makeShape({ id: 's1', type: 'line', strokeWidth: 23 });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        fake._adjustStrokeWidth('s1', 5);
        expect(shapes().find(s => s.id === 's1')?.strokeWidth).toBe(24);
    });

    it('clampe en bas à 1', () => {
        const shape = makeShape({ id: 's1', type: 'line', strokeWidth: 2 });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        fake._adjustStrokeWidth('s1', -5);
        expect(shapes().find(s => s.id === 's1')?.strokeWidth).toBe(1);
    });
});

describe('_toggleShapeDiameter (planMap.js:3516-3527) — toggle défaut true', () => {
    it('sans showDiameter défini (implicitement visible), le premier appel le masque', () => {
        const shape = makeShape({ id: 's1', type: 'circle', center: [2, 48], edge: [2, 48.01] });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        fake._toggleShapeDiameter('s1');
        expect(shapes().find(s => s.id === 's1')?.showDiameter).toBe(false);
        fake._toggleShapeDiameter('s1');
        expect(shapes().find(s => s.id === 's1')?.showDiameter).toBe(true);
    });

    it('ignore les formes non-cercle', () => {
        const shape = makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]] });
        const { fake, shapes } = makeFakeThis({ shapes: [shape] });
        const renderDiameters = vi.fn();
        fake._renderDiameters = renderDiameters;
        fake._toggleShapeDiameter('s1');
        expect(shapes().find(s => s.id === 's1')?.showDiameter).toBeUndefined();
        expect(renderDiameters).not.toHaveBeenCalled();
    });
});

// ============================================================
// _updateLockButton / _toggleGlobalDiameter — reflet DOM
// ============================================================
describe('_updateLockButton (planMap.js:2806-2816)', () => {
    it('reflète `_locked` sur le bouton (icône / couleur / classe active)', () => {
        document.body.innerHTML = '<button id="plan_draw_lock"><span class="material-symbols-outlined"></span></button>';
        const { fake } = makeFakeThis({ withMap: false });
        const btn = document.getElementById('plan_draw_lock') as HTMLButtonElement;

        fake._locked = true;
        fake._updateLockButton();
        expect(btn.querySelector('.material-symbols-outlined')?.textContent).toBe('lock');
        expect(btn.classList.contains('active')).toBe(true);

        fake._locked = false;
        fake._updateLockButton();
        expect(btn.querySelector('.material-symbols-outlined')?.textContent).toBe('lock_open');
        expect(btn.classList.contains('active')).toBe(false);
    });
});

describe('_toggleGlobalDiameter (planMap.js:2819-2830)', () => {
    it('bascule `_diameterGlobal`, met à jour le bouton et re-render les diamètres', () => {
        document.body.innerHTML = '<button id="plan_draw_diameter_toggle"></button>';
        const { fake } = makeFakeThis({ withMap: false });
        const initial = fake._diameterGlobal;
        const renderDiameters = vi.fn();
        fake._renderDiameters = renderDiameters;

        fake._toggleGlobalDiameter();
        expect(fake._diameterGlobal).toBe(!initial);
        expect(renderDiameters).toHaveBeenCalledTimes(1);
    });

    it('rouvre la roue de forme si une roue est active sur la forme sélectionnée', () => {
        const { fake, mocks } = makeFakeThis({ withMap: false });
        fake._selectedShapeId = 's1';
        fake._activeWheel = { lngLat: { lng: 1, lat: 2 }, element: null, open: vi.fn(), destroy: vi.fn() };
        fake._toggleGlobalDiameter();
        expect(mocks.openShapeWheel).toHaveBeenCalledWith('s1', { lng: 1, lat: 2 });
    });
});

// ============================================================
// _shapePixelBounds
// ============================================================
describe('_shapePixelBounds (planMap.js:4746-4757)', () => {
    it('retourne 100x50 sans carte', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(fake._shapePixelBounds(makeShape({ id: 's1', type: 'line' }))).toEqual({ width: 100, height: 50 });
    });

    it('retourne 240x80 pour une forme texte, sans consulter les coordonnées', () => {
        const { fake } = makeFakeThis();
        expect(fake._shapePixelBounds(makeShape({ id: 's1', type: 'text' }))).toEqual({ width: 240, height: 80 });
    });

    it('retourne 100x50 quand les coordonnées sont vides', () => {
        const { fake } = makeFakeThis();
        expect(fake._shapePixelBounds(makeShape({ id: 's1', type: 'rectangle', coords: [] }))).toEqual({ width: 100, height: 50 });
    });

    it('calcule la bbox pixel via map.project pour un rectangle', () => {
        const { fake } = makeFakeThis();
        const bounds = fake._shapePixelBounds(makeShape({ id: 's1', type: 'rectangle', coords: [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]] }));
        expect(bounds).toEqual({ width: 10, height: 5 });
    });
});

// ============================================================
// _renderShapeTexts — filtrage + invariant marker (§5.1)
// ============================================================
describe('_renderShapeTexts (planMap.js:4769-4853)', () => {
    it('ignore les formes non-texte sans `.text`', () => {
        const shape = makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]] });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderShapeTexts();
        expect(fake._textMarkers).toHaveLength(0);
        expect(fake._textMarkersById).toEqual({});
    });

    it('ignore une forme de type texte avec `.text` vide', () => {
        const shape = makeShape({ id: 's1', type: 'text', coords: [[2, 48]], text: '' });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderShapeTexts();
        expect(fake._textMarkers).toHaveLength(0);
    });

    it('rend un marker pour une ligne annotée de `.text` et l\'indexe par id', () => {
        const shape = makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]], text: 'Objectif' });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderShapeTexts();
        expect(fake._textMarkers).toHaveLength(1);
        expect(fake._textMarkersById?.['s1']).toBe(fake._textMarkers[0]);
    });

    it("n'écrit jamais `position`/`inset` dans le style inline de l'élément du marker (INVARIANT §5.1)", () => {
        const shape = makeShape({ id: 's1', type: 'text', coords: [[2, 48]], text: 'Cible' });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderShapeTexts();
        const marker = fake._textMarkers[0];
        expect(marker).toBeDefined();
        const el = marker?.getElement();
        expect(el?.style.position).toBe('');
        expect(el?.style.getPropertyValue('inset')).toBe('');
    });
});

// ============================================================
// _renderDiameters — filtrage + invariant marker (§5.1)
// ============================================================
describe('_renderDiameters (planMap.js:2738-2788)', () => {
    it('ne rend rien quand `_diameterGlobal` est false', () => {
        const shape = makeShape({ id: 's1', type: 'circle', center: [2, 48], edge: [2, 48.01] });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._diameterGlobal = false;
        fake._renderDiameters();
        expect(fake._diameterMarkers).toHaveLength(0);
    });

    it('ignore les cercles avec showDiameter=false', () => {
        const shape = makeShape({ id: 's1', type: 'circle', center: [2, 48], edge: [2, 48.01], showDiameter: false });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderDiameters();
        expect(fake._diameterMarkers).toHaveLength(0);
    });

    it('rend un marker ⌀ pour un cercle valide', () => {
        const shape = makeShape({ id: 's1', type: 'circle', center: [2, 48], edge: [2, 48.01] });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderDiameters();
        expect(fake._diameterMarkers).toHaveLength(1);
    });

    it("n'écrit jamais `position`/`inset` dans le style inline de l'élément du marker (INVARIANT §5.1)", () => {
        const shape = makeShape({ id: 's1', type: 'circle', center: [2, 48], edge: [2, 48.01] });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderDiameters();
        const marker = fake._diameterMarkers[0];
        const el = marker?.getElement();
        expect(el?.style.position).toBe('');
        expect(el?.style.getPropertyValue('inset')).toBe('');
    });

    it('purge les markers précédents à chaque appel (remove() appelé, nouveau marker créé)', () => {
        const shape = makeShape({ id: 's1', type: 'circle', center: [2, 48], edge: [2, 48.01] });
        const { fake } = makeFakeThis({ shapes: [shape] });
        fake._renderDiameters();
        expect(fake._diameterMarkers).toHaveLength(1);
        const previous = fake._diameterMarkers;
        const removeSpy = previous[0] ? vi.spyOn(previous[0], 'remove') : null;
        fake._renderDiameters();
        expect(removeSpy).toHaveBeenCalledTimes(1);
        expect(fake._diameterMarkers).toHaveLength(1);
        expect(fake._diameterMarkers[0]).not.toBe(previous[0]);
    });
});

// ============================================================
// _renderShapes — délégation + construction GeoJSON
// ============================================================
describe('_renderShapes (planMap.js:2604-2665)', () => {
    it('appelle setData sur la source et délègue aux sous-rendus (texte/diamètres/mesures/handles/cadenas/toolbar)', () => {
        const shape = makeShape({ id: 's1', type: 'line', coords: [[2, 48], [3, 49]] });
        const { fake, mocks, map } = makeFakeThis({ shapes: [shape] });
        const src = { setData: vi.fn() };
        map?.getSource.mockReturnValue(src);

        // Isole la délégation : remplace ponctuellement les 2 autres méthodes du
        // MÊME paquet appelées par `_renderShapes` (déjà testées séparément plus bas).
        const renderShapeTexts = vi.fn();
        const renderDiameters = vi.fn();
        const renderShapeLocks = vi.fn();
        fake._renderShapeTexts = renderShapeTexts;
        fake._renderDiameters = renderDiameters;
        fake._renderShapeLocks = renderShapeLocks;

        fake._renderShapes();

        expect(src.setData).toHaveBeenCalledTimes(1);
        const arg = src.setData.mock.calls[0]?.[0] as GeoJSON.FeatureCollection;
        expect(arg.type).toBe('FeatureCollection');
        expect(arg.features).toHaveLength(1);
        expect(renderShapeTexts).toHaveBeenCalledTimes(1);
        expect(renderDiameters).toHaveBeenCalledTimes(1);
        expect(mocks.renderCommittedMeasures).toHaveBeenCalledTimes(1);
        expect(mocks.renderHandles).toHaveBeenCalledTimes(1);
        expect(renderShapeLocks).toHaveBeenCalledTimes(1);
        expect(mocks.updateFloatingToolbarPos).toHaveBeenCalledTimes(1);
    });

    it('les formes "measure" produisent une feature SANS shapeId (non sélectionnable)', () => {
        const shape = makeShape({ id: 'm1', type: 'measure', coords: [[2, 48], [3, 49]] });
        const { fake, map } = makeFakeThis({ shapes: [shape] });
        const src = { setData: vi.fn() };
        map?.getSource.mockReturnValue(src);

        fake._renderShapes();

        const arg = src.setData.mock.calls[0]?.[0] as GeoJSON.FeatureCollection;
        const feat = arg.features[0];
        expect(feat?.properties?.shapeId).toBeUndefined();
    });

    it('une forme "measure" avec moins de 2 points ne produit aucune feature', () => {
        const shape = makeShape({ id: 'm1', type: 'measure', coords: [[2, 48]] });
        const { fake, map } = makeFakeThis({ shapes: [shape] });
        const src = { setData: vi.fn() };
        map?.getSource.mockReturnValue(src);

        fake._renderShapes();

        const arg = src.setData.mock.calls[0]?.[0] as GeoJSON.FeatureCollection;
        expect(arg.features).toHaveLength(0);
    });
});
