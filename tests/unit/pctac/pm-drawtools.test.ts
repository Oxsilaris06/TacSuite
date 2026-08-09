/**
 * pm-drawtools.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-drawtools` :
 * `planmap/draw-tools.ts` (16 méthodes, planMap.js:1963, 1970, 1980, 1990,
 * 2003, 2082, 2092, 2116, 2163, 2191, 2199, 2250, 2593, 2598, 4953, 4957).
 * Références `planMap.js:<ligne>` en commentaire, cf.
 * docs/SPEC-PLANMAP-SPLIT.md §4.8, §5.8, §9.
 *
 * `this` FACTICE : un faux `map` (project/getCanvas/dragPan/doubleClickZoom/
 * boxZoom/getSource/getCenter en `vi.fn()`), jamais `new maplibregl.Map`
 * (WebGL absent sous jsdom — SPEC-PCTAC-CONVERSION §8.4). Les 16 méthodes sous
 * test sont les VRAIES implémentations de `DrawToolsMethods` (elles s'appellent
 * mutuellement, cf. `_finishShape` → `_pushHistory`/`_setTool`/…) ; seules les
 * dépendances EXTERNES au module (autres paquets planmap) sont mockées.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapMouseEvent } from 'maplibre-gl';

import { SHAPES_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { DrawToolsMethods } from '../../../src/apps/pctac/planmap/draw-tools.js';
import { createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { LngLatTuple, PlanMapInternal, PlanShape } from '../../../src/apps/pctac/planmap/types.js';

function makeFakeMap() {
    return {
        // Mise à l'échelle x1000 déterministe : un écart de coordonnées de
        // 0.01° ⇒ 10 px, suffisant pour dépasser le seuil de 4 px de
        // `_handleDrawUp` sans dépendre d'une vraie projection Web Mercator.
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng * 1000, y: ll.lat * 1000 })),
        getCanvas: vi.fn(() => ({ style: {} as { cursor: string } })),
        dragPan: { enable: vi.fn(), disable: vi.fn() },
        doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
        boxZoom: { enable: vi.fn(), disable: vi.fn() },
        getSource: vi.fn(),
        getCenter: vi.fn(() => ({ lng: 2.35, lat: 48.85 })),
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

// `this` factice : les 16 méthodes réellement portées (`...DrawToolsMethods`)
// s'appellent entre elles comme dans l'original ; seules les méthodes
// d'AUTRES sous-modules (measure.ts, shapes-render.ts, shapes-gestures.ts,
// text-modal.ts, geo.ts) sont mockées.
function makeFakeState(map: FakeMap | null): PlanMapInternal {
    return {
        map,
        drawTool: null,
        drawColor: '#ef4444',
        drawState: null,
        drawPrecisionMode: false,
        history: [],
        redoStack: [],
        _measureState: null,
        _diameterGlobal: false,
        _drawingDiameterMarker: null,
        _selectedShapeId: null,
        // R3-c : `_loadShapes`/`_saveShapes` délèguent à `this.persistence`
        // (adapter posé par `createPlanMapState()`, cf. state.ts) — même
        // instance que la production, enrobe `Persist` sur les vraies clés
        // localStorage (comportement bit-identique aux tests existants).
        persistence: createPlanMapState().persistence,

        // Les 16 méthodes sous test — implémentations réelles.
        ...DrawToolsMethods,

        // Dépendances externes mockées (autres sous-modules de planmap/).
        _renderShapes: vi.fn(),
        _selectShape: vi.fn(),
        _clearMeasureState: vi.fn(),
        _startMeasure: vi.fn(),
        _measureUpdateCursor: vi.fn(),
        _addFreeText: vi.fn(),
        _rectPolygon: vi.fn((a: LngLatTuple, b: LngLatTuple) => [a, b]),
        _circlePolygon: vi.fn((c: LngLatTuple, e: LngLatTuple) => [c, e]),
        _haversineMeters: vi.fn(() => 10),
        _formatDistance: vi.fn((m: number) => `${m} m`),
    } as unknown as PlanMapInternal;
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('_pushHistory (planMap.js:1963-1968)', () => {
    it('empile un snapshot JSON des formes courantes et vide redoStack', () => {
        const state = makeFakeState(null);
        state.redoStack = ['stale'];
        localStorage.setItem(SHAPES_KEY, JSON.stringify([{ id: 's1', type: 'line' }]));

        state._pushHistory();

        expect(state.history).toHaveLength(1);
        expect(JSON.parse(state.history[0] ?? '[]')).toEqual([{ id: 's1', type: 'line' }]);
        expect(state.redoStack).toEqual([]);
    });

    it('borne l\'historique à 50 entrées (planMap.js:1966)', () => {
        const state = makeFakeState(null);
        state.history = Array.from({ length: 50 }, (_, i) => `snap-${i}`);

        state._pushHistory();

        expect(state.history).toHaveLength(50);
        // Le plus ancien (`snap-0`) a été éjecté par `.shift()`, le nouveau est en queue.
        expect(state.history[0]).toBe('snap-1');
        expect(state.history[49]).toBe(JSON.stringify([]));
    });
});

describe('_undo / _redo (planMap.js:1970-1988) — symétrie + écriture directe SHAPES_KEY (§5.8)', () => {
    it('_undo : restaure le snapshot précédent, l\'empile dans redoStack, écrit SHAPES_KEY', () => {
        const state = makeFakeState(null);
        localStorage.setItem(SHAPES_KEY, JSON.stringify([{ id: 'current' }]));
        state.history = [JSON.stringify([{ id: 'previous' }])];

        state._undo();

        expect(localStorage.getItem(SHAPES_KEY)).toBe(JSON.stringify([{ id: 'previous' }]));
        expect(state.history).toEqual([]);
        expect(state.redoStack).toEqual([JSON.stringify([{ id: 'current' }])]);
        expect(state._renderShapes).toHaveBeenCalledTimes(1);
        expect((state._refreshUndoRedoButtons as ReturnType<typeof vi.fn>)).toBeDefined();
    });

    it('_undo : no-op si l\'historique est vide', () => {
        const state = makeFakeState(null);
        localStorage.setItem(SHAPES_KEY, JSON.stringify([{ id: 'x' }]));

        state._undo();

        expect(localStorage.getItem(SHAPES_KEY)).toBe(JSON.stringify([{ id: 'x' }]));
        expect(state._renderShapes).not.toHaveBeenCalled();
    });

    it('_redo : symétrique de _undo — restaure depuis redoStack, réempile dans history, écrit SHAPES_KEY', () => {
        const state = makeFakeState(null);
        localStorage.setItem(SHAPES_KEY, JSON.stringify([{ id: 'previous' }]));
        state.redoStack = [JSON.stringify([{ id: 'next' }])];

        state._redo();

        expect(localStorage.getItem(SHAPES_KEY)).toBe(JSON.stringify([{ id: 'next' }]));
        expect(state.redoStack).toEqual([]);
        expect(state.history).toEqual([JSON.stringify([{ id: 'previous' }])]);
    });

    it('_redo : no-op si redoStack est vide', () => {
        const state = makeFakeState(null);

        expect(() => state._redo()).not.toThrow();
        expect(state._renderShapes).not.toHaveBeenCalled();
    });

    it('undo puis redo restitue exactement l\'état d\'origine (aller-retour)', () => {
        const state = makeFakeState(null);
        const original = JSON.stringify([{ id: 'A' }]);
        const modified = JSON.stringify([{ id: 'B' }]);
        localStorage.setItem(SHAPES_KEY, modified);
        state.history = [original];

        state._undo();
        expect(localStorage.getItem(SHAPES_KEY)).toBe(original);

        state._redo();
        expect(localStorage.getItem(SHAPES_KEY)).toBe(modified);
        expect(state.history).toEqual([original]);
        expect(state.redoStack).toEqual([]);
    });
});

describe('_refreshUndoRedoButtons (planMap.js:1990-2001)', () => {
    it('ne jette pas quand les boutons sont absents du DOM', () => {
        const state = makeFakeState(null);
        expect(() => state._refreshUndoRedoButtons()).not.toThrow();
    });

    it('active/désactive visuellement undo/redo selon la longueur des piles', () => {
        document.body.innerHTML = `
            <button id="plan_draw_undo"></button>
            <button id="plan_draw_redo"></button>
        `;
        const state = makeFakeState(null);
        state.history = ['a'];
        state.redoStack = [];

        state._refreshUndoRedoButtons();

        const undoBtn = document.getElementById('plan_draw_undo') as HTMLButtonElement;
        const redoBtn = document.getElementById('plan_draw_redo') as HTMLButtonElement;
        expect(undoBtn.style.opacity).toBe('1');
        expect(undoBtn.style.cursor).toBe('pointer');
        expect(redoBtn.style.opacity).toBe('0.35');
        expect(redoBtn.style.cursor).toBe('not-allowed');
    });
});

describe('_setTool (planMap.js:2003-2080) — TOGGLE', () => {
    it('active un outil puis le désactive au second appel avec le même outil (toggle)', () => {
        const state = makeFakeState(null);

        state._setTool('line');
        expect(state.drawTool).toBe('line');

        state._setTool('line');
        expect(state.drawTool).toBeNull();
    });

    it('changer d\'outil (différent du courant) ne bascule pas à null', () => {
        const state = makeFakeState(null);
        state._setTool('line');
        state._setTool('rectangle');
        expect(state.drawTool).toBe('rectangle');
    });

    it('quitte proprement une mesure en cours quand on change vers un autre outil', () => {
        const state = makeFakeState(null);
        state._measureState = { vertices: [], cursor: null, reticle: false };

        state._setTool('line');

        expect(state._clearMeasureState).toHaveBeenCalledTimes(1);
    });

    it('sélectionner l\'outil mesure démarre la machine d\'états dédiée', () => {
        const state = makeFakeState(null);
        state._setTool('measure');
        expect(state._startMeasure).toHaveBeenCalledTimes(1);
    });

    it('ne jette pas quand this.map est absent (vue Plan jamais ouverte)', () => {
        const state = makeFakeState(null);
        expect(() => state._setTool('circle')).not.toThrow();
    });

    it('avec une carte : désactive dragPan/zoom double-clic/boxZoom pour un outil de tracé classique', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);

        // Outil 'line' : seul outil dont `drawPrecisionMode` est TOUJOURS false
        // (exception documentée, planMap.js:2014-2017 : le trait se trace au doigt)
        // — indépendant de la détection tactile de jsdom (`'ontouchstart' in window`
        // y est vraie par défaut, cf. GlobalEventHandlers), donc déterministe ici.
        state._setTool('line');

        expect(map.dragPan.disable).toHaveBeenCalled();
        expect(map.doubleClickZoom.disable).toHaveBeenCalled();
        expect(map.boxZoom.disable).toHaveBeenCalled();
    });

    it('avec une carte : l\'outil mesure garde le pan actif mais coupe le zoom double-clic', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);

        state._setTool('measure');

        expect(map.dragPan.enable).toHaveBeenCalled();
        expect(map.doubleClickZoom.disable).toHaveBeenCalled();
        expect(map.boxZoom.enable).toHaveBeenCalled();
    });

    it('désactiver l\'outil (null) réactive dragPan/zoom/boxZoom', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state._setTool('line');

        state._setTool(null);

        expect(map.dragPan.enable).toHaveBeenCalled();
        expect(map.doubleClickZoom.enable).toHaveBeenCalled();
        expect(map.boxZoom.enable).toHaveBeenCalled();
    });
});

describe('_setDrawColor (planMap.js:2082-2089)', () => {
    it('met à jour drawColor et re-style le bouton actif si un outil est sélectionné', () => {
        const state = makeFakeState(null);
        state.drawTool = 'line';
        const setToolSpy = vi.spyOn(state, '_setTool');

        state._setDrawColor('#22c55e');

        expect(state.drawColor).toBe('#22c55e');
        expect(setToolSpy).toHaveBeenCalledWith('line');
    });

    it('ne re-style rien si aucun outil n\'est actif', () => {
        const state = makeFakeState(null);
        const setToolSpy = vi.spyOn(state, '_setTool');

        state._setDrawColor('#3b82f6');

        expect(setToolSpy).not.toHaveBeenCalled();
    });
});

describe('_handleDrawDown (planMap.js:2092-2113)', () => {
    it('outil texte : ajoute le texte libre puis désactive l\'outil (pas de drag)', () => {
        const state = makeFakeState(null);
        state.drawTool = 'text';
        const fakeEvent = { lngLat: { lng: 2.3, lat: 48.8 }, originalEvent: undefined } as unknown as MapMouseEvent;

        state._handleDrawDown(fakeEvent);

        expect(state._addFreeText).toHaveBeenCalledWith({ lng: 2.3, lat: 48.8 });
        expect(state.drawTool).toBeNull();
    });

    it('outil trait : amorce drawState avec le point de départ', () => {
        const state = makeFakeState(null);
        state.drawTool = 'line';
        const fakeEvent = { lngLat: { lng: 2.3, lat: 48.8 }, originalEvent: undefined } as unknown as MapMouseEvent;

        state._handleDrawDown(fakeEvent);

        expect(state.drawState).toEqual({ start: [2.3, 48.8], current: [2.3, 48.8], points: [[2.3, 48.8]] });
    });

    it('mesure : ne démarre aucun drag (piloté par le réticule/clic)', () => {
        const state = makeFakeState(null);
        state.drawTool = 'measure';
        const fakeEvent = { lngLat: { lng: 2.3, lat: 48.8 } } as unknown as MapMouseEvent;

        state._handleDrawDown(fakeEvent);

        expect(state.drawState).toBeNull();
    });

    it('aucun outil actif : ne fait rien', () => {
        const state = makeFakeState(null);
        const fakeEvent = { lngLat: { lng: 2.3, lat: 48.8 } } as unknown as MapMouseEvent;

        state._handleDrawDown(fakeEvent);

        expect(state.drawState).toBeNull();
    });
});

describe('_handleDrawMove (planMap.js:2116-2160) — accepte un objet synthétique {lngLat}', () => {
    it('accepte un objet synthétique { lngLat: {lng, lat} } (sans map, sans originalEvent) sans jeter', () => {
        const state = makeFakeState(null);
        state.drawTool = 'rectangle';
        state.drawState = { start: [2.3, 48.8], current: [2.3, 48.8] };

        expect(() => state._handleDrawMove({ lngLat: { lng: 2.31, lat: 48.81 } })).not.toThrow();
        expect(state.drawState.current).toEqual([2.31, 48.81]);
    });

    it('outil mesure : délègue à _measureUpdateCursor et ne touche pas drawState', () => {
        const state = makeFakeState(null);
        state.drawTool = 'measure';
        state._measureState = { vertices: [[0, 0]], cursor: null, reticle: false };

        state._handleDrawMove({ lngLat: { lng: 1, lat: 2 } });

        expect(state._measureUpdateCursor).toHaveBeenCalledWith([1, 2]);
        expect(state.drawState).toBeNull();
    });

    it('sans drawTool actif : ne fait rien (pas de drawState)', () => {
        const state = makeFakeState(null);
        expect(() => state._handleDrawMove({ lngLat: { lng: 1, lat: 2 } })).not.toThrow();
    });

    it('mode précision mobile + originalEvent (glissement doigt direct) : ignore le mouvement', () => {
        const state = makeFakeState(null);
        state.drawTool = 'rectangle';
        state.drawPrecisionMode = true;
        state.drawState = { start: [2.3, 48.8], current: [2.3, 48.8] };

        state._handleDrawMove({ lngLat: { lng: 9, lat: 9 }, originalEvent: new Event('touchmove') });

        expect(state.drawState.current).toEqual([2.3, 48.8]);
    });

    it('outil cercle avec diamètre global actif : appelle _renderLiveDiameter', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state.drawTool = 'circle';
        state.drawState = { start: [2.3, 48.8], current: [2.3, 48.8] };
        state._diameterGlobal = true;
        const liveDiamSpy = vi.spyOn(state, '_renderLiveDiameter').mockImplementation(() => {});

        state._handleDrawMove({ lngLat: { lng: 2.31, lat: 48.81 } });

        expect(liveDiamSpy).toHaveBeenCalledWith([2.3, 48.8], [2.31, 48.81]);
    });

    it('outil trait sans map (garde de typage) : ne jette pas', () => {
        const state = makeFakeState(null);
        state.drawTool = 'line';
        state.drawState = { start: [2.3, 48.8], current: [2.3, 48.8] };

        expect(() => state._handleDrawMove({ lngLat: { lng: 2.31, lat: 48.81 } })).not.toThrow();
    });
});

describe('_renderLiveDiameter / _clearLiveDiameter (planMap.js:2163-2196)', () => {
    it('_renderLiveDiameter : ne jette pas quand this.map est absent (garde de typage)', () => {
        const state = makeFakeState(null);
        expect(() => state._renderLiveDiameter([2.3, 48.8], [2.31, 48.81])).not.toThrow();
        expect(state._drawingDiameterMarker).toBeNull();
    });

    it('_clearLiveDiameter : retire le marker existant et le remet à null', () => {
        const state = makeFakeState(null);
        const removeFn = vi.fn();
        // Double factice minimal : seul `.remove()` est appelé par `_clearLiveDiameter`.
        state._drawingDiameterMarker = { remove: removeFn } as unknown as PlanMapInternal['_drawingDiameterMarker'];

        state._clearLiveDiameter();

        expect(removeFn).toHaveBeenCalledTimes(1);
        expect(state._drawingDiameterMarker).toBeNull();
    });

    it('_clearLiveDiameter : no-op silencieux quand il n\'y a pas de marker', () => {
        const state = makeFakeState(null);
        expect(() => state._clearLiveDiameter()).not.toThrow();
    });

    it('_clearLiveDiameter : tolère un `.remove()` qui jette (catch vide)', () => {
        const state = makeFakeState(null);
        state._drawingDiameterMarker = {
            remove: () => { throw new Error('déjà retiré'); },
        } as unknown as PlanMapInternal['_drawingDiameterMarker'];

        expect(() => state._clearLiveDiameter()).not.toThrow();
        expect(state._drawingDiameterMarker).toBeNull();
    });
});

describe('_handleDrawUp (planMap.js:2199-2248)', () => {
    it('drag significatif (>=4px) sur outil rectangle : commit via _finishShape', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state.drawTool = 'rectangle';
        state.drawState = { start: [2.30, 48.80], current: [2.31, 48.81] };
        const finishSpy = vi.spyOn(state, '_finishShape').mockImplementation(() => {});

        state._handleDrawUp({ lngLat: { lng: 2.31, lat: 48.81 } });

        expect(finishSpy).toHaveBeenCalledTimes(1);
        const shape = finishSpy.mock.calls[0]?.[0] as PlanShape;
        expect(shape.type).toBe('rectangle');
        expect(shape.color).toBe(state.drawColor);
    });

    it('clic trop court (<4px, pas de tracé libre) : annule la preview sans committer', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state.drawTool = 'rectangle';
        state.drawState = { start: [2.30, 48.80], current: [2.30, 48.80] };
        const finishSpy = vi.spyOn(state, '_finishShape');

        state._handleDrawUp({ lngLat: { lng: 2.30, lat: 48.80 } });

        expect(finishSpy).not.toHaveBeenCalled();
        expect(state.drawState).toBeNull();
    });

    it('trait libre (cheminement, >2 points) : commit même si start≈end en pixels', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state.drawTool = 'line';
        state.drawState = {
            start: [2.30, 48.80],
            current: [2.30, 48.80],
            points: [[2.30, 48.80], [2.305, 48.805], [2.30, 48.80]],
        };
        const finishSpy = vi.spyOn(state, '_finishShape').mockImplementation(() => {});

        state._handleDrawUp({ lngLat: { lng: 2.30, lat: 48.80 } });

        expect(finishSpy).toHaveBeenCalledTimes(1);
        const shape = finishSpy.mock.calls[0]?.[0] as PlanShape;
        expect(shape.type).toBe('line');
        expect(shape.coords).toEqual([[2.30, 48.80], [2.305, 48.805], [2.30, 48.80]]);
    });

    it('outil cercle : construit un shape avec center/edge/coords', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state.drawTool = 'circle';
        state.drawState = { start: [2.30, 48.80], current: [2.31, 48.81] };
        const finishSpy = vi.spyOn(state, '_finishShape').mockImplementation(() => {});

        state._handleDrawUp({ lngLat: { lng: 2.31, lat: 48.81 } });

        const shape = finishSpy.mock.calls[0]?.[0] as PlanShape;
        expect(shape.type).toBe('circle');
        expect(shape.center).toEqual([2.30, 48.80]);
        expect(shape.edge).toEqual([2.31, 48.81]);
    });

    it('sans drawState : ne fait rien', () => {
        const state = makeFakeState(makeFakeMap());
        expect(() => state._handleDrawUp({ lngLat: { lng: 1, lat: 1 } })).not.toThrow();
    });

    it('sans map (garde de typage) : ne jette pas', () => {
        const state = makeFakeState(null);
        state.drawTool = 'rectangle';
        state.drawState = { start: [2.30, 48.80], current: [2.31, 48.81] };
        expect(() => state._handleDrawUp({ lngLat: { lng: 2.31, lat: 48.81 } })).not.toThrow();
    });
});

describe('_finishShape (planMap.js:2250-2264)', () => {
    it('persiste la forme, réinitialise l\'outil et sélectionne la forme créée', () => {
        const state = makeFakeState(null);
        state.history = [];
        const shape: PlanShape = { id: 'shape_1', type: 'line', color: '#ef4444', coords: [[0, 0], [1, 1]] };

        state._finishShape(shape);

        expect(state._loadShapes()).toEqual([shape]);
        expect(state.drawState).toBeNull();
        expect(state.drawTool).toBeNull();
        expect(state._selectShape).toHaveBeenCalledWith('shape_1');
        expect(state._renderShapes).toHaveBeenCalledTimes(1);
    });
});

describe('_renderPreview / _clearPreview (planMap.js:2593-2602)', () => {
    it('_renderPreview : pousse la feature dans la source de preview', () => {
        const map = makeFakeMap();
        const setDataFn = vi.fn();
        map.getSource.mockReturnValue({ setData: setDataFn });
        const state = makeFakeState(map);
        const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} } as GeoJSON.Feature;

        state._renderPreview(feature);

        expect(map.getSource).toHaveBeenCalledWith('plan-draw-preview-src');
        expect(setDataFn).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [feature] });
    });

    it('_renderPreview : ne jette pas quand this.map est absent (garde de typage)', () => {
        const state = makeFakeState(null);
        const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} } as GeoJSON.Feature;
        expect(() => state._renderPreview(feature)).not.toThrow();
    });

    it('_renderPreview : ne jette pas quand la source est absente (vue Plan pas encore montée)', () => {
        const map = makeFakeMap();
        map.getSource.mockReturnValue(undefined);
        const state = makeFakeState(map);
        const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} } as GeoJSON.Feature;
        expect(() => state._renderPreview(feature)).not.toThrow();
    });

    it('_clearPreview : vide la source de preview et efface le diamètre live', () => {
        const map = makeFakeMap();
        const setDataFn = vi.fn();
        map.getSource.mockReturnValue({ setData: setDataFn });
        const state = makeFakeState(map);
        const clearDiamSpy = vi.spyOn(state, '_clearLiveDiameter');

        state._clearPreview();

        expect(setDataFn).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] });
        expect(clearDiamSpy).toHaveBeenCalledTimes(1);
    });

    it('_clearPreview : ne jette pas sans map', () => {
        const state = makeFakeState(null);
        expect(() => state._clearPreview()).not.toThrow();
    });
});

describe('_loadShapes / _saveShapes (planMap.js:4953-4961) — via Persist', () => {
    it('_loadShapes : retourne [] sur stockage corrompu (JSON invalide)', () => {
        localStorage.setItem(SHAPES_KEY, '{not valid json');
        const state = makeFakeState(null);

        expect(state._loadShapes()).toEqual([]);
    });

    it('_loadShapes : retourne [] quand la clé est absente', () => {
        const state = makeFakeState(null);
        expect(state._loadShapes()).toEqual([]);
    });

    it('_loadShapes : retourne [] quand la valeur stockée n\'est pas un tableau (validator Array.isArray)', () => {
        localStorage.setItem(SHAPES_KEY, JSON.stringify({ not: 'an array' }));
        const state = makeFakeState(null);
        expect(state._loadShapes()).toEqual([]);
    });

    it('_loadShapes : relit exactement les formes stockées valides', () => {
        const shapes: PlanShape[] = [{ id: 's1', type: 'circle', center: [1, 2], edge: [1, 3] }];
        localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes));
        const state = makeFakeState(null);
        expect(state._loadShapes()).toEqual(shapes);
    });

    it('_saveShapes : sérialise et écrit sous SHAPES_KEY (via Persist)', () => {
        const state = makeFakeState(null);
        const shapes: PlanShape[] = [{ id: 's1', type: 'text', text: 'hello' }];

        state._saveShapes(shapes);

        expect(JSON.parse(localStorage.getItem(SHAPES_KEY) ?? 'null')).toEqual(shapes);
    });

    it('aller-retour _saveShapes → _loadShapes préserve les données', () => {
        const state = makeFakeState(null);
        const shapes: PlanShape[] = [{ id: 's1', type: 'rectangle', coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] }];

        state._saveShapes(shapes);

        expect(state._loadShapes()).toEqual(shapes);
    });
});
