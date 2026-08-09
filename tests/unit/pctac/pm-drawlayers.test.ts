/**
 * pm-drawlayers.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-drawlayers` :
 * `planmap/draw-layers.ts` (`_initDrawingLayers` planMap.js:1665, `_bindDrawUi`
 * planMap.js:1829, `_wireLongPressForPing` planMap.js:4863). Références
 * `planMap.js:<ligne>` en commentaire, cf. docs/SPEC-PLANMAP-SPLIT.md §4.7, §9.
 *
 * `this` FACTICE : un faux `map` (addSource/addLayer/getSource/on en `vi.fn()`),
 * jamais `new maplibregl.Map` (WebGL absent sous jsdom — SPEC-PCTAC-CONVERSION §8.4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// R2-T2a (design-taste) : le bouton "Effacer" n'ouvre plus de confirm() —
// action directe (réversible par Ctrl+Z, _pushHistory() posé avant le vidage)
// + toast de confirmation. Module mocké pour isoler le test du DOM réel
// injecté par feedback.ts.
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ toast: toastSpy }));

import { DrawLayersMethods } from '../../../src/apps/pctac/planmap/draw-layers.js';
import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';

function makeFakeMap() {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getCanvas: vi.fn(() => ({ style: {} as { cursor: string } })),
        queryRenderedFeatures: vi.fn(() => [] as unknown[]),
        getCenter: vi.fn(() => ({ lng: 2.3522, lat: 48.8566 })),
    };
}

type FakeMap = ReturnType<typeof makeFakeMap>;

// `this` factice : seuls les membres réellement lus/appelés par les 3 méthodes
// de draw-layers.ts sont fournis (cf. pm-core.test.ts `{} as PlanMapInternal`
// pour le même procédé de cast).
function makeFakeState(map: FakeMap | null): PlanMapInternal {
    return {
        map,
        drawTool: null,
        drawColor: '#ef4444',
        drawState: null,
        drawPrecisionMode: false,
        history: [],
        redoStack: [],
        moveState: null,
        _gesture: null,
        _wheelJustClosed: 0,
        _selectedShapeId: null,
        _activeWheel: null,
        _inlinePanel: null,
        _measureState: null,

        // Enveloppe `_safe` neutre : n'attrape rien, retourne `fn` telle quelle
        // (suffisant ici, aucun de ces tests n'exerce le chemin d'erreur de `_safe`,
        // déjà couvert par pm-core.test.ts).
        _safe: vi.fn((fn: (...a: never[]) => unknown) => fn),

        _shapePointerDown: vi.fn(),
        _renderShapeTexts: vi.fn(),
        _renderDiameters: vi.fn(),
        _deselectShape: vi.fn(),
        _openCreatePingWheel: vi.fn(),
        _setTool: vi.fn(),
        _setDrawColor: vi.fn(),
        _pushHistory: vi.fn(),
        _saveShapes: vi.fn(),
        _renderShapes: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
        _undo: vi.fn(),
        _redo: vi.fn(),
        _toggleGlobalDiameter: vi.fn(),
        _toggleLock: vi.fn(),
        _updateLockButton: vi.fn(),
        _addFreeText: vi.fn(),
        _handleDrawMove: vi.fn(),
        _handleDrawUp: vi.fn(),
        _clearPreview: vi.fn(),
        _clearLiveDiameter: vi.fn(),
        _renderMeasurePreview: vi.fn(),
        _addEngagementRings: vi.fn(),

        // `_wireLongPressForPing` est la véritable méthode portée : `_initDrawingLayers`
        // l'appelle réellement (planMap.js:1820), on vérifie donc l'intégration, pas un mock.
        _wireLongPressForPing: DrawLayersMethods._wireLongPressForPing,
    } as unknown as PlanMapInternal;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('_initDrawingLayers (planMap.js:1665-1827)', () => {
    it('ne jette pas quand this.map est absent (vue Plan jamais ouverte)', () => {
        const state = makeFakeState(null);
        expect(() => DrawLayersMethods._initDrawingLayers.call(state)).not.toThrow();
    });

    it('addSource/addLayer sont appelés avec les ids attendus DANS L\'ORDRE (empilement visuel, invariant §1.2)', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);

        DrawLayersMethods._initDrawingLayers.call(state);

        const sourceIds = map.addSource.mock.calls.map(c => c[0]);
        expect(sourceIds).toEqual(['plan-shapes-src', 'plan-draw-preview-src']);

        const layerIds = map.addLayer.mock.calls.map(c => (c[0] as { id: string }).id);
        expect(layerIds).toEqual([
            'buildings-3d',
            'plan-shapes-fill',
            'plan-shapes-line-hit',
            'plan-shapes-line',
            'plan-shapes-text-hit',
            'plan-draw-preview-fill',
            'plan-draw-preview-line',
        ]);
    });

    it('un échec de la couche bâtiments 3D (try/catch, planMap.js:1669-1696) n\'interrompt pas le reste', () => {
        const map = makeFakeMap();
        map.addLayer.mockImplementationOnce(() => { throw new Error('boom'); });
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const state = makeFakeState(map);

        expect(() => DrawLayersMethods._initDrawingLayers.call(state)).not.toThrow();
        expect(errSpy).toHaveBeenCalledWith('[PlanMap] couche bâtiments 3D échec:', expect.any(Error));
        // 7 tentatives d'addLayer au total (buildings-3d qui jette est comptée,
        // + les 6 couches shapes/preview qui suivent, non interrompues).
        expect(map.addLayer).toHaveBeenCalledTimes(7);
        expect(map.addSource).toHaveBeenCalledTimes(2);
    });

    it('câble le long-press (délègue à _wireLongPressForPing, planMap.js:1820) : map.on reçoit les 9 types d\'événements attendus', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);

        DrawLayersMethods._initDrawingLayers.call(state);

        const onTypes = map.on.mock.calls.map(c => c[0]);
        for (const t of ['mousedown', 'touchstart', 'mousemove', 'touchmove', 'mouseup', 'touchend', 'touchcancel', 'dragstart', 'movestart']) {
            expect(onTypes).toContain(t);
        }
    });
});

describe('_bindDrawUi (planMap.js:1829-1961)', () => {
    it('ne jette pas quand le DOM du dock est absent (aucun bouton dans le document)', () => {
        const state = makeFakeState(null);
        expect(() => DrawLayersMethods._bindDrawUi.call(state)).not.toThrow();
    });

    it('rejoué deux fois ne double aucun handler onclick (écrasement idempotent, SPEC §6.6)', () => {
        document.body.innerHTML = `
            <button class="plan-draw-btn" data-tool="line"></button>
            <button id="plan_draw_clear"></button>
        `;
        const state = makeFakeState(null);

        DrawLayersMethods._bindDrawUi.call(state);
        DrawLayersMethods._bindDrawUi.call(state);

        const toolBtn = document.querySelector<HTMLButtonElement>('.plan-draw-btn[data-tool="line"]');
        expect(toolBtn).not.toBeNull();
        toolBtn?.click();
        // Un seul appel malgré les deux (re)câblages : l'onclick a été écrasé, pas empilé.
        expect(state._setTool).toHaveBeenCalledTimes(1);
        expect(state._setTool).toHaveBeenCalledWith('line');

        // Idem pour le bouton "Effacer" (R2-T2a : action directe, plus de confirm()).
        const clearBtn = document.getElementById('plan_draw_clear') as HTMLButtonElement;
        clearBtn.click();
        expect(state._pushHistory).toHaveBeenCalledTimes(1);
    });

    it('le bouton couleur appelle _setDrawColor avec la couleur data-color', () => {
        document.body.innerHTML = `<button class="plan-draw-color" data-color="#3b82f6"></button>`;
        const state = makeFakeState(null);

        DrawLayersMethods._bindDrawUi.call(state);
        document.querySelector<HTMLButtonElement>('.plan-draw-color')?.click();

        expect(state._setDrawColor).toHaveBeenCalledWith('#3b82f6');
    });

    it('le bouton undo/redo appellent _undo/_redo, le bouton verrou/diamètre appellent _toggleLock/_toggleGlobalDiameter', () => {
        document.body.innerHTML = `
            <button id="plan_draw_undo"></button>
            <button id="plan_draw_redo"></button>
            <button id="plan_draw_lock"></button>
            <button id="plan_draw_diameter_toggle"></button>
        `;
        const state = makeFakeState(null);
        DrawLayersMethods._bindDrawUi.call(state);

        (document.getElementById('plan_draw_undo') as HTMLButtonElement).click();
        (document.getElementById('plan_draw_redo') as HTMLButtonElement).click();
        (document.getElementById('plan_draw_lock') as HTMLButtonElement).click();
        (document.getElementById('plan_draw_diameter_toggle') as HTMLButtonElement).click();

        expect(state._undo).toHaveBeenCalledTimes(1);
        expect(state._redo).toHaveBeenCalledTimes(1);
        expect(state._toggleLock).toHaveBeenCalledTimes(1);
        expect(state._toggleGlobalDiameter).toHaveBeenCalledTimes(1);
        // Appelé une fois à la fin du câblage, comme dans l'original (planMap.js:1874, 1881).
        expect(state._refreshUndoRedoButtons).toHaveBeenCalled();
        expect(state._updateLockButton).toHaveBeenCalled();
    });

    it('le bouton de précision "start" lit le centre de carte et appelle _handleDrawMove avec un objet synthétique {lngLat} (invariant §1.2 piège 2)', () => {
        document.body.innerHTML = `
            <button id="plan_draw_precision_start"></button>
            <button id="plan_draw_precision_confirm" style="display:none"></button>
            <button id="plan_draw_precision_cancel" style="display:none"></button>
        `;
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state.drawTool = 'line';

        DrawLayersMethods._bindDrawUi.call(state);
        (document.getElementById('plan_draw_precision_start') as HTMLButtonElement).click();

        expect(map.getCenter).toHaveBeenCalled();
        expect(state._handleDrawMove).toHaveBeenCalledWith({ lngLat: { lng: 2.3522, lat: 48.8566 } });
        expect((document.getElementById('plan_draw_precision_confirm') as HTMLButtonElement).style.display).toBe('flex');
    });

    it('ne jette pas quand this.map est absent pour le bouton de précision "start" (garde de typage ajoutée)', () => {
        document.body.innerHTML = `<button id="plan_draw_precision_start"></button>`;
        const state = makeFakeState(null);
        state.drawTool = 'line';
        DrawLayersMethods._bindDrawUi.call(state);
        expect(() => (document.getElementById('plan_draw_precision_start') as HTMLButtonElement).click()).not.toThrow();
        expect(state._handleDrawMove).not.toHaveBeenCalled();
    });
});

describe('_wireLongPressForPing (planMap.js:4863-4951)', () => {
    it('ne jette pas quand this.map est absent', () => {
        const state = makeFakeState(null);
        expect(() => DrawLayersMethods._wireLongPressForPing.call(state)).not.toThrow();
    });

    it('câble les 9 événements attendus sur la carte (mousedown/touchstart/mousemove/touchmove/mouseup/touchend/touchcancel/dragstart/movestart)', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);

        DrawLayersMethods._wireLongPressForPing.call(state);

        const onTypes = map.on.mock.calls.map(c => c[0]);
        expect(onTypes).toEqual([
            'mousedown', 'touchstart', 'mousemove', 'touchmove',
            'mouseup', 'touchend', 'touchcancel', 'dragstart', 'movestart',
        ]);
    });

    it('un appui long immobile (480 ms) sur zone vide ouvre la roue de création de ping avec les coordonnées de départ', () => {
        vi.useFakeTimers();
        const map = makeFakeMap();
        const state = makeFakeState(map);

        DrawLayersMethods._wireLongPressForPing.call(state);
        const start = map.on.mock.calls.find(c => c[0] === 'mousedown')?.[1] as (e: unknown) => void;
        expect(typeof start).toBe('function');

        const fakeEvent = {
            point: { x: 100, y: 100 },
            lngLat: { lng: 2.3, lat: 48.8 },
            originalEvent: { clientX: 100, clientY: 100, target: document.body },
        };
        start(fakeEvent);
        vi.advanceTimersByTime(480);

        expect(state._openCreatePingWheel).toHaveBeenCalledWith({ lng: 2.3, lat: 48.8 });
        vi.useRealTimers();
    });

    it('un déplacement au-delà de la tolérance (8px) pendant l\'appui annule le long-press (pas d\'ouverture de roue)', () => {
        vi.useFakeTimers();
        const map = makeFakeMap();
        const state = makeFakeState(map);

        DrawLayersMethods._wireLongPressForPing.call(state);
        const start = map.on.mock.calls.find(c => c[0] === 'mousedown')?.[1] as (e: unknown) => void;
        const move = map.on.mock.calls.find(c => c[0] === 'mousemove')?.[1] as (e: unknown) => void;

        start({
            point: { x: 100, y: 100 },
            lngLat: { lng: 2.3, lat: 48.8 },
            originalEvent: { clientX: 100, clientY: 100, target: document.body },
        });
        move({ point: { x: 120, y: 100 }, originalEvent: {} });
        vi.advanceTimersByTime(480);

        expect(state._openCreatePingWheel).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('un pointerdown sur un marker DOM existant (.maplibregl-marker) n\'ouvre pas la roue', () => {
        vi.useFakeTimers();
        const map = makeFakeMap();
        const state = makeFakeState(map);

        DrawLayersMethods._wireLongPressForPing.call(state);
        const start = map.on.mock.calls.find(c => c[0] === 'mousedown')?.[1] as (e: unknown) => void;

        const markerEl = document.createElement('div');
        markerEl.className = 'maplibregl-marker';
        document.body.appendChild(markerEl);

        start({
            point: { x: 10, y: 10 },
            lngLat: { lng: 0, lat: 0 },
            originalEvent: { clientX: 10, clientY: 10, target: markerEl },
        });
        vi.advanceTimersByTime(480);

        expect(state._openCreatePingWheel).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
