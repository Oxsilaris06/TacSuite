/**
 * oi-carto-draw.test.ts — Comportement OBSERVÉ de `modules/oi_cartographie.js`
 * (GStart-main, 1681 LOC, lecture seule) pour le paquet `oi-carto-draw` :
 * `carto/draw.ts` (19 méthodes, oi_cartographie.js:1314-1603). Écrit AVANT le
 * port (TDD, mission P3.CONV). Références `oi_cartographie.js:<ligne>` en
 * commentaire, cf. SPEC-OI-CONVERSION.md §6.2, §6.3.
 *
 * `this` FACTICE : un faux `map` (project/getCanvas/dragPan/doubleClickZoom/
 * boxZoom/getSource/addSource/addLayer/on/off en `vi.fn()`), jamais
 * `new maplibregl.Map` (WebGL absent sous jsdom — SPEC-OI-CONVERSION §13.5).
 * Les 19 méthodes sous test sont les VRAIES implémentations de `DrawMethods`
 * (elles s'appellent mutuellement, cf. `_finishShape` → `_pushHistory` /
 * `_saveShapes` / `_renderShapes`) ; seules les dépendances EXTERNES au groupe
 * `draw.ts` sont mockées : `_loadShapes`/`_saveShapes` (groupe `carto/state.ts`,
 * simulées ici par un tableau en mémoire fermé sur les mocks — persistance non
 * réimplémentée, cf. §6.2) et `_hideHint` (groupe `carto/map-core.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { MapLayerMouseEvent, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

import { DrawMethods } from '../../../src/apps/oi/carto/draw.js';
import type { LngLatTuple, OICartoInternal, OiCartoShape } from '../../../src/apps/oi/carto/types.js';

function makeFakeMap() {
    return {
        // Mise à l'échelle x1000 déterministe : un écart de coordonnées de 0.01°
        // ⇒ 10 px, suffisant pour dépasser le seuil de 4 px de `_handleDrawUp`
        // sans dépendre d'une vraie projection Web Mercator.
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng * 1000, y: ll.lat * 1000 })),
        getCanvas: vi.fn(() => ({ style: {} as { cursor: string } })),
        dragPan: { enable: vi.fn(), disable: vi.fn() },
        doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
        boxZoom: { enable: vi.fn(), disable: vi.fn() },
        getSource: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

/** Simule la persistance de `carto/state.ts` (`_loadShapes`/`_saveShapes`) par un tableau en mémoire — non réimplémentée ici (§6.2). */
function makeFakeState(map: FakeMap | null): OICartoInternal {
    let shapesStore: OiCartoShape[] = [];
    const state = {
        map,
        drawTool: null,
        drawColor: '#ef4444',
        drawState: null,
        pendingPin: null,
        history: [],
        redoStack: [],

        // Les 19 méthodes sous test — implémentations réelles.
        ...DrawMethods,

        // Dépendances externes mockées (groupes `state.ts` / `map-core.ts`).
        _loadShapes: vi.fn((): OiCartoShape[] => shapesStore),
        _saveShapes: vi.fn((list: readonly OiCartoShape[]) => { shapesStore = [...list]; }),
        _hideHint: vi.fn(),
    };
    return state as unknown as OICartoInternal;
}

beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('_rectPolygon (oi_cartographie.js:1572-1575)', () => {
    it('produit un polygone fermé à 5 sommets (aligné carte)', () => {
        const state = makeFakeState(null);
        const a: LngLatTuple = [2.0, 48.0];
        const b: LngLatTuple = [2.01, 48.01];

        const poly = state._rectPolygon(a, b);

        expect(poly).toHaveLength(5);
        expect(poly).toEqual([
            [2.0, 48.0], [2.01, 48.0], [2.01, 48.01], [2.0, 48.01], [2.0, 48.0],
        ]);
        // Fermeture : premier === dernier sommet, exactement (pas d'arrondi ici).
        expect(poly[0]).toEqual(poly[poly.length - 1]);
    });
});

describe('_circlePolygon (oi_cartographie.js:1577-1603) — formule géodésique NON simplifiée', () => {
    it('produit 65 sommets (N=64 segments + 1 point de fermeture)', () => {
        const state = makeFakeState(null);
        const center: LngLatTuple = [2.0, 48.0];
        const edge: LngLatTuple = [2.001, 48.0];

        const poly = state._circlePolygon(center, edge);

        expect(poly).toHaveLength(65);
    });

    it('est approximativement fermé (premier ≈ dernier sommet)', () => {
        const state = makeFakeState(null);
        const center: LngLatTuple = [2.0, 48.0];
        const edge: LngLatTuple = [2.001, 48.0];

        const poly = state._circlePolygon(center, edge);
        const first = poly[0] as LngLatTuple;
        const last = poly[poly.length - 1] as LngLatTuple;

        expect(first[0]).toBeCloseTo(last[0], 9);
        expect(first[1]).toBeCloseTo(last[1], 9);
    });

    it('les sommets sont approximativement équidistants du centre (rayon géodésique constant)', () => {
        // Haversine indépendante de l'implémentation sous test, pour vérifier
        // que _circlePolygon produit bien un cercle (et pas une ellipse/erreur
        // de formule) — sans réimplémenter la logique portée.
        const haversine = (a: LngLatTuple, b: LngLatTuple): number => {
            const R = 6371000;
            const toRad = (d: number) => (d * Math.PI) / 180;
            const [lng1, lat1] = a;
            const [lng2, lat2] = b;
            const phi1 = toRad(lat1), phi2 = toRad(lat2);
            const dPhi = toRad(lat2 - lat1);
            const dLambda = toRad(lng2 - lng1);
            const x = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
        };

        const state = makeFakeState(null);
        const center: LngLatTuple = [2.0, 48.0];
        const edge: LngLatTuple = [2.001, 48.0];
        const expectedRadius = haversine(center, edge);

        const poly = state._circlePolygon(center, edge);
        // Échantillon de 4 sommets répartis sur le cercle (0°, 90°, 180°, 270°).
        for (const idx of [0, 16, 32, 48]) {
            const pt = poly[idx] as LngLatTuple;
            expect(haversine(center, pt)).toBeCloseTo(expectedRadius, 0);
        }
    });
});

describe('_pushHistory (oi_cartographie.js:1537-1541)', () => {
    it('empile un snapshot JSON des formes courantes et vide redoStack', () => {
        const state = makeFakeState(null);
        state._saveShapes([{ id: 's1', type: 'line', color: '#fff', coords: [[0, 0], [1, 1]] }]);
        state.redoStack = ['stale'];

        state._pushHistory();

        expect(state.history).toHaveLength(1);
        expect(JSON.parse(state.history[0] as string)).toEqual([{ id: 's1', type: 'line', color: '#fff', coords: [[0, 0], [1, 1]] }]);
        expect(state.redoStack).toEqual([]);
    });

    it("borne l'historique à 50 entrées (oi_cartographie.js:1539)", () => {
        const state = makeFakeState(null);
        state.history = Array.from({ length: 50 }, (_, i) => `snap-${i}`);

        state._pushHistory();

        expect(state.history).toHaveLength(50);
        expect(state.history[0]).toBe('snap-1');
        expect(state.history[49]).toBe(JSON.stringify([]));
    });
});

describe('_undo / _redo (oi_cartographie.js:1543-1557) — invariant structurel aller-retour', () => {
    it('_undo : restaure le snapshot précédent, empile dans redoStack, ré-appelle _saveShapes', () => {
        const state = makeFakeState(null);
        state._saveShapes([{ id: 'current', type: 'line', color: '#fff', coords: [] }]);
        state.history = [JSON.stringify([{ id: 'previous', type: 'line', color: '#fff', coords: [] }])];
        const renderSpy = vi.spyOn(state, '_renderShapes');

        state._undo();

        expect(state._loadShapes()).toEqual([{ id: 'previous', type: 'line', color: '#fff', coords: [] }]);
        expect(state.history).toEqual([]);
        expect(state.redoStack).toEqual([JSON.stringify([{ id: 'current', type: 'line', color: '#fff', coords: [] }])]);
        expect(renderSpy).toHaveBeenCalledTimes(1);
    });

    it('_undo : no-op si history est vide', () => {
        const state = makeFakeState(null);
        state._saveShapes([{ id: 'x', type: 'line', color: '#fff', coords: [] }]);
        const renderSpy = vi.spyOn(state, '_renderShapes');

        state._undo();

        expect(state._loadShapes()).toEqual([{ id: 'x', type: 'line', color: '#fff', coords: [] }]);
        expect(renderSpy).not.toHaveBeenCalled();
    });

    it('_redo : symétrique de _undo — restaure depuis redoStack, ré-empile dans history', () => {
        const state = makeFakeState(null);
        state._saveShapes([{ id: 'previous', type: 'line', color: '#fff', coords: [] }]);
        state.redoStack = [JSON.stringify([{ id: 'next', type: 'line', color: '#fff', coords: [] }])];

        state._redo();

        expect(state._loadShapes()).toEqual([{ id: 'next', type: 'line', color: '#fff', coords: [] }]);
        expect(state.redoStack).toEqual([]);
        expect(state.history).toEqual([JSON.stringify([{ id: 'previous', type: 'line', color: '#fff', coords: [] }])]);
    });

    it('_redo : no-op si redoStack est vide', () => {
        const state = makeFakeState(null);
        expect(() => state._redo()).not.toThrow();
    });

    it('INVARIANT : un cycle undo puis redo restitue un état structurellement identique (hash JSON)', () => {
        const state = makeFakeState(null);
        const original: OiCartoShape[] = [
            { id: 'A', type: 'rectangle', color: '#ef4444', coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] },
        ];
        const modified: OiCartoShape[] = [
            { id: 'A', type: 'rectangle', color: '#ef4444', coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] },
            { id: 'B', type: 'circle', color: '#3b82f6', center: [2, 2], edge: [2.1, 2], coords: [[2.1, 2], [2, 2.1]] },
        ];
        state._saveShapes(modified);
        state.history = [JSON.stringify(original)];
        const hashBefore = JSON.stringify(modified);

        state._undo();
        expect(JSON.stringify(state._loadShapes())).toBe(JSON.stringify(original));

        state._redo();
        expect(JSON.stringify(state._loadShapes())).toBe(hashBefore);
        expect(state.history).toEqual([JSON.stringify(original)]);
        expect(state.redoStack).toEqual([]);
    });

    it('_undo : JSON corrompu dans history → catch silencieux, ne jette pas (comportement d\'origine :1546)', () => {
        const state = makeFakeState(null);
        state.history = ['{not valid json'];

        expect(() => state._undo()).not.toThrow();
    });
});

describe('_refreshUndoRedoButtons (oi_cartographie.js:1559-1570)', () => {
    it('ne jette pas quand les boutons sont absents du DOM', () => {
        const state = makeFakeState(null);
        expect(() => state._refreshUndoRedoButtons()).not.toThrow();
    });

    it('active/désactive visuellement undo/redo selon la profondeur des piles', () => {
        document.body.innerHTML = `
            <button id="oi_carto_draw_undo"></button>
            <button id="oi_carto_draw_redo"></button>
        `;
        const state = makeFakeState(null);
        state.history = ['a'];
        state.redoStack = [];

        state._refreshUndoRedoButtons();

        const undoBtn = document.getElementById('oi_carto_draw_undo') as HTMLButtonElement;
        const redoBtn = document.getElementById('oi_carto_draw_redo') as HTMLButtonElement;
        expect(undoBtn.style.opacity).toBe('1');
        expect(undoBtn.style.cursor).toBe('pointer');
        expect(redoBtn.style.opacity).toBe('0.35');
        expect(redoBtn.style.cursor).toBe('not-allowed');
    });
});

describe('_setTool (oi_cartographie.js:1400-1427) — TOGGLE', () => {
    it('active un outil puis le désactive au second appel avec le même outil (toggle)', () => {
        const state = makeFakeState(null);

        state._setTool('line');
        expect(state.drawTool).toBe('line');

        state._setTool('line');
        expect(state.drawTool).toBeNull();
    });

    it("changer d'outil (différent du courant) ne bascule pas à null", () => {
        const state = makeFakeState(null);
        state._setTool('line');
        state._setTool('rectangle');
        expect(state.drawTool).toBe('rectangle');
    });

    it('active un outil : efface pendingPin et appelle _hideHint', () => {
        const state = makeFakeState(null);
        state.pendingPin = { kind: 'member', label: 'X' };

        state._setTool('circle');

        expect(state.pendingPin).toBeNull();
        expect(state._hideHint).toHaveBeenCalledTimes(1);
    });

    it('ne jette pas quand this.map est absent (carto jamais ouverte)', () => {
        const state = makeFakeState(null);
        expect(() => state._setTool('circle')).not.toThrow();
    });

    it('avec une carte : un outil actif désactive dragPan/doubleClickZoom/boxZoom', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);

        state._setTool('line');

        expect(map.dragPan.disable).toHaveBeenCalled();
        expect(map.doubleClickZoom.disable).toHaveBeenCalled();
        expect(map.boxZoom.disable).toHaveBeenCalled();
    });

    it('désactiver l\'outil (null) réactive dragPan/doubleClickZoom/boxZoom', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state._setTool('line');

        state._setTool(null);

        expect(map.dragPan.enable).toHaveBeenCalled();
        expect(map.doubleClickZoom.enable).toHaveBeenCalled();
        expect(map.boxZoom.enable).toHaveBeenCalled();
    });
});

describe('_setDrawColor (oi_cartographie.js:1429-1435)', () => {
    it("met à jour drawColor et re-style l'outil actif si un outil est sélectionné", () => {
        const state = makeFakeState(null);
        state.drawTool = 'line';
        const setToolSpy = vi.spyOn(state, '_setTool');

        state._setDrawColor('#22c55e');

        expect(state.drawColor).toBe('#22c55e');
        expect(setToolSpy).toHaveBeenCalledWith('line');
    });

    it("ne re-style rien si aucun outil n'est actif", () => {
        const state = makeFakeState(null);
        const setToolSpy = vi.spyOn(state, '_setTool');

        state._setDrawColor('#3b82f6');

        expect(setToolSpy).not.toHaveBeenCalled();
    });
});

describe('_handleDrawDown / _handleDrawMove / _handleDrawUp — cycle complet down→move→up', () => {
    it('outil "line" : down amorce drawState, move met à jour current, up produit une shape "line"', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state._setTool('line');

        const down = { lngLat: { lng: 2.0, lat: 48.0 } } as unknown as MapMouseEvent;
        state._handleDrawDown(down);
        expect(state.drawState).toEqual({ start: [2.0, 48.0], current: [2.0, 48.0] });

        const move = { lngLat: { lng: 2.01, lat: 48.01 } } as unknown as MapMouseEvent;
        state._handleDrawMove(move);
        expect(state.drawState?.current).toEqual([2.01, 48.01]);

        const finishSpy = vi.spyOn(state, '_finishShape');
        const up = { lngLat: { lng: 2.01, lat: 48.01 } } as unknown as MapMouseEvent;
        state._handleDrawUp(up);

        expect(finishSpy).toHaveBeenCalledTimes(1);
        const shape = finishSpy.mock.calls[0]?.[0] as OiCartoShape;
        expect(shape.type).toBe('line');
        expect(shape.color).toBe(state.drawColor);
        expect(shape.coords).toEqual([[2.0, 48.0], [2.01, 48.01]]);
    });

    it('_finishShape appelle _pushHistory puis _saveShapes puis _renderShapes puis _refreshUndoRedoButtons (ordre)', () => {
        const state = makeFakeState(null);
        const pushSpy = vi.spyOn(state, '_pushHistory');
        const renderSpy = vi.spyOn(state, '_renderShapes').mockImplementation(() => {});
        const refreshSpy = vi.spyOn(state, '_refreshUndoRedoButtons').mockImplementation(() => {});
        // `_saveShapes` est déjà un `vi.fn()` posé par `makeFakeState` (persistance
        // en mémoire, cf. en-tête de fichier) : pas besoin de re-spy, `.mock` est
        // directement accessible.
        const saveMock = state._saveShapes as unknown as Mock;

        const shape: OiCartoShape = { id: 'shape_1', type: 'line', color: '#ef4444', coords: [[0, 0], [1, 1]] };
        state._finishShape(shape);

        // Ordre d'appel prouvé par le rang d'invocation global de chaque spy
        // (`invocationCallOrder`), plutôt que par restructuration du code sous
        // test — fidélité au corps VERBATIM de `_finishShape`.
        const pushOrder = pushSpy.mock.invocationCallOrder[0] as number;
        const saveOrder = saveMock.mock.invocationCallOrder[0] as number;
        const renderOrder = renderSpy.mock.invocationCallOrder[0] as number;
        const refreshOrder = refreshSpy.mock.invocationCallOrder[0] as number;
        expect(pushOrder).toBeLessThan(saveOrder);
        expect(saveOrder).toBeLessThan(renderOrder);
        expect(renderOrder).toBeLessThan(refreshOrder);
        expect(state._loadShapes()).toEqual([shape]);
        // Écart de fond assumé (oi_cartographie.js:1499) : l'outil actif n'est PAS
        // réinitialisé après une forme créée (contrairement à @pctac) — non testé
        // ici par une assertion négative car `drawTool` n'a jamais été positionné
        // dans ce cas ; couvert par le test "cycle complet" ci-dessus qui laisse
        // `drawTool` à 'line' après `_handleDrawUp`.
    });

    it('outil "rectangle" : down→move→up produit une shape "rectangle" via _rectPolygon', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state._setTool('rectangle');
        state._handleDrawDown({ lngLat: { lng: 2.0, lat: 48.0 } } as unknown as MapMouseEvent);
        state._handleDrawMove({ lngLat: { lng: 2.01, lat: 48.01 } } as unknown as MapMouseEvent);
        const finishSpy = vi.spyOn(state, '_finishShape');

        state._handleDrawUp({ lngLat: { lng: 2.01, lat: 48.01 } } as unknown as MapMouseEvent);

        const shape = finishSpy.mock.calls[0]?.[0] as OiCartoShape;
        expect(shape.type).toBe('rectangle');
        expect(shape.coords).toEqual([[2.0, 48.0], [2.01, 48.0], [2.01, 48.01], [2.0, 48.01], [2.0, 48.0]]);
    });

    it('outil "circle" : down→move→up produit une shape "circle" avec center/edge/coords', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state._setTool('circle');
        state._handleDrawDown({ lngLat: { lng: 2.0, lat: 48.0 } } as unknown as MapMouseEvent);
        state._handleDrawMove({ lngLat: { lng: 2.01, lat: 48.01 } } as unknown as MapMouseEvent);
        const finishSpy = vi.spyOn(state, '_finishShape');

        state._handleDrawUp({ lngLat: { lng: 2.01, lat: 48.01 } } as unknown as MapMouseEvent);

        const shape = finishSpy.mock.calls[0]?.[0] as OiCartoShape;
        expect(shape.type).toBe('circle');
        expect(shape.center).toEqual([2.0, 48.0]);
        expect(shape.edge).toEqual([2.01, 48.01]);
        expect(shape.coords).toHaveLength(65);
    });

    it('clic trop court (<4px) : annule la preview sans committer de shape', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state._setTool('rectangle');
        state._handleDrawDown({ lngLat: { lng: 2.0, lat: 48.0 } } as unknown as MapMouseEvent);
        const finishSpy = vi.spyOn(state, '_finishShape');

        state._handleDrawUp({ lngLat: { lng: 2.0, lat: 48.0 } } as unknown as MapMouseEvent);

        expect(finishSpy).not.toHaveBeenCalled();
        expect(state.drawState).toBeNull();
    });

    it('_handleDrawDown : sans outil actif, ne fait rien', () => {
        const state = makeFakeState(null);
        state._handleDrawDown({ lngLat: { lng: 1, lat: 1 } } as unknown as MapMouseEvent);
        expect(state.drawState).toBeNull();
    });

    it('_handleDrawMove : sans drawState actif, ne fait rien (ne jette pas)', () => {
        const state = makeFakeState(null);
        state.drawTool = 'line';
        expect(() => state._handleDrawMove({ lngLat: { lng: 1, lat: 1 } } as unknown as MapMouseEvent)).not.toThrow();
    });

    it('_handleDrawUp : sans map (garde de typage), ne jette pas', () => {
        const state = makeFakeState(null);
        state.drawTool = 'rectangle';
        state.drawState = { start: [2.0, 48.0], current: [2.01, 48.01] };
        expect(() => state._handleDrawUp({ lngLat: { lng: 2.01, lat: 48.01 } } as unknown as MapMouseEvent)).not.toThrow();
    });

    it('_handleDrawUp : accepte aussi un MapTouchEvent (tactile)', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);
        state._setTool('line');
        state._handleDrawDown({ lngLat: { lng: 2.0, lat: 48.0 } } as unknown as MapTouchEvent);
        const finishSpy = vi.spyOn(state, '_finishShape');

        state._handleDrawUp({ lngLat: { lng: 2.02, lat: 48.02 } } as unknown as MapTouchEvent);

        expect(finishSpy).toHaveBeenCalledTimes(1);
    });
});

describe('_renderPreview / _clearPreview (oi_cartographie.js:1502-1510)', () => {
    it('_renderPreview : pousse la feature dans la source de preview', () => {
        const map = makeFakeMap();
        const setDataFn = vi.fn();
        map.getSource.mockReturnValue({ setData: setDataFn });
        const state = makeFakeState(map);
        const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} } as GeoJSON.Feature;

        state._renderPreview(feature);

        expect(map.getSource).toHaveBeenCalledWith('oi-carto-preview-src');
        expect(setDataFn).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [feature] });
    });

    it('_renderPreview : ne jette pas quand this.map est absent', () => {
        const state = makeFakeState(null);
        const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} } as GeoJSON.Feature;
        expect(() => state._renderPreview(feature)).not.toThrow();
    });

    it('_renderPreview : ne jette pas quand la source est absente (carto pas encore montée)', () => {
        const map = makeFakeMap();
        map.getSource.mockReturnValue(undefined);
        const state = makeFakeState(map);
        const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} } as GeoJSON.Feature;
        expect(() => state._renderPreview(feature)).not.toThrow();
    });

    it('_clearPreview : vide la source de preview', () => {
        const map = makeFakeMap();
        const setDataFn = vi.fn();
        map.getSource.mockReturnValue({ setData: setDataFn });
        const state = makeFakeState(map);

        state._clearPreview();

        expect(setDataFn).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] });
    });

    it('_clearPreview : ne jette pas sans map', () => {
        const state = makeFakeState(null);
        expect(() => state._clearPreview()).not.toThrow();
    });
});

describe('_renderShapes (oi_cartographie.js:1512-1522)', () => {
    it('convertit les lignes en Feature LineString et les rectangles/cercles en Feature Polygon', () => {
        const map = makeFakeMap();
        const setDataFn = vi.fn();
        map.getSource.mockReturnValue({ setData: setDataFn });
        const state = makeFakeState(map);
        state._saveShapes([
            { id: 'l1', type: 'line', color: '#fff', coords: [[0, 0], [1, 1]] },
            { id: 'r1', type: 'rectangle', color: '#000', coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] },
        ]);

        state._renderShapes();

        expect(map.getSource).toHaveBeenCalledWith('oi-carto-shapes-src');
        expect(setDataFn).toHaveBeenCalledWith({
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', id: 'l1', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { color: '#fff', shapeId: 'l1' } },
                { type: 'Feature', id: 'r1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, properties: { color: '#000', shapeId: 'r1' } },
            ],
        });
    });

    it('ne jette pas quand la source est absente', () => {
        const map = makeFakeMap();
        map.getSource.mockReturnValue(undefined);
        const state = makeFakeState(map);
        expect(() => state._renderShapes()).not.toThrow();
    });
});

describe('_onShapeClick (oi_cartographie.js:1524-1535)', () => {
    it('sur confirmation : supprime la forme, ré-render, rafraîchit les boutons', () => {
        const state = makeFakeState(null);
        state._saveShapes([
            { id: 'keep', type: 'line', color: '#fff', coords: [] },
            { id: 'del', type: 'line', color: '#fff', coords: [] },
        ]);
        const renderSpy = vi.spyOn(state, '_renderShapes');
        const refreshSpy = vi.spyOn(state, '_refreshUndoRedoButtons');
        const e = { features: [{ properties: { shapeId: 'del' } }] } as unknown as MapLayerMouseEvent;

        state._onShapeClick(e);

        expect(state._loadShapes()).toEqual([{ id: 'keep', type: 'line', color: '#fff', coords: [] }]);
        expect(renderSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('sans confirmation : ne supprime rien', () => {
        vi.stubGlobal('confirm', vi.fn(() => false));
        const state = makeFakeState(null);
        state._saveShapes([{ id: 'del', type: 'line', color: '#fff', coords: [] }]);
        const e = { features: [{ properties: { shapeId: 'del' } }] } as unknown as MapLayerMouseEvent;

        state._onShapeClick(e);

        expect(state._loadShapes()).toEqual([{ id: 'del', type: 'line', color: '#fff', coords: [] }]);
    });

    it('un outil de dessin actif bloque la suppression au clic (priorité au tracé)', () => {
        const state = makeFakeState(null);
        state.drawTool = 'line';
        state._saveShapes([{ id: 'del', type: 'line', color: '#fff', coords: [] }]);
        const e = { features: [{ properties: { shapeId: 'del' } }] } as unknown as MapLayerMouseEvent;

        state._onShapeClick(e);

        expect(state._loadShapes()).toEqual([{ id: 'del', type: 'line', color: '#fff', coords: [] }]);
    });

    it('aucune feature au clic : ne jette pas', () => {
        const state = makeFakeState(null);
        const e = { features: [] } as unknown as MapLayerMouseEvent;
        expect(() => state._onShapeClick(e)).not.toThrow();
    });
});

describe('_initDrawingLayers (oi_cartographie.js:1314-1364)', () => {
    it('ajoute la couche bâtiments 3D + 2 sources (shapes, preview) + 6 couches, câble le clic', () => {
        const map = makeFakeMap();
        const state = makeFakeState(map);

        state._initDrawingLayers();

        expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'buildings-3d', type: 'fill-extrusion' }));
        expect(map.addSource).toHaveBeenCalledWith('oi-carto-shapes-src', expect.objectContaining({ type: 'geojson' }));
        expect(map.addSource).toHaveBeenCalledWith('oi-carto-preview-src', expect.objectContaining({ type: 'geojson' }));
        expect(map.addLayer).toHaveBeenCalledTimes(5); // buildings-3d + shapes-fill + shapes-line + preview-fill + preview-line
        expect(map.on).toHaveBeenCalledWith('click', 'oi-carto-shapes-fill', expect.any(Function));
        expect(map.on).toHaveBeenCalledWith('click', 'oi-carto-shapes-line', expect.any(Function));
    });

    it('ne jette pas quand this.map est absent (garde de typage)', () => {
        const state = makeFakeState(null);
        expect(() => state._initDrawingLayers()).not.toThrow();
    });

    it('un échec de addLayer (bâtiments 3D) est capturé, la suite continue (sources + couches shapes/preview)', () => {
        const map = makeFakeMap();
        map.addLayer.mockImplementationOnce(() => { throw new Error('layer boom'); });
        const state = makeFakeState(map);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => state._initDrawingLayers()).not.toThrow();
        expect(consoleSpy).toHaveBeenCalled();
        expect(map.addSource).toHaveBeenCalledWith('oi-carto-shapes-src', expect.anything());
    });
});

describe('_bindDrawUi (oi_cartographie.js:1366-1388)', () => {
    function setupDrawDock(): void {
        document.body.innerHTML = `
            <div class="oi-carto-draw-btn" data-tool="line"></div>
            <div class="oi-carto-draw-color" data-color="#22c55e"></div>
            <button id="oi_carto_draw_clear"></button>
            <button id="oi_carto_draw_undo"></button>
            <button id="oi_carto_draw_redo"></button>
        `;
    }

    it("câble le clic d'un bouton outil sur _setTool(tool)", () => {
        setupDrawDock();
        const state = makeFakeState(null);
        const setToolSpy = vi.spyOn(state, '_setTool');

        state._bindDrawUi();
        document.querySelector<HTMLElement>('.oi-carto-draw-btn')?.click();

        expect(setToolSpy).toHaveBeenCalledWith('line');
    });

    it("câble le clic d'un swatch couleur sur _setDrawColor(color)", () => {
        setupDrawDock();
        const state = makeFakeState(null);
        const setColorSpy = vi.spyOn(state, '_setDrawColor');

        state._bindDrawUi();
        document.querySelector<HTMLElement>('.oi-carto-draw-color')?.click();

        expect(setColorSpy).toHaveBeenCalledWith('#22c55e');
    });

    it("le bouton effacer confirme, purge les formes et rafraîchit l'affichage", () => {
        setupDrawDock();
        const state = makeFakeState(null);
        state._saveShapes([{ id: 'a', type: 'line', color: '#fff', coords: [] }]);
        const renderSpy = vi.spyOn(state, '_renderShapes');

        state._bindDrawUi();
        document.getElementById('oi_carto_draw_clear')?.click();

        expect(state._loadShapes()).toEqual([]);
        expect(renderSpy).toHaveBeenCalledTimes(1);
    });

    it("le bouton effacer ne fait rien s'il n'y a déjà aucune forme", () => {
        setupDrawDock();
        const state = makeFakeState(null);
        const pushSpy = vi.spyOn(state, '_pushHistory');

        state._bindDrawUi();
        document.getElementById('oi_carto_draw_clear')?.click();

        expect(pushSpy).not.toHaveBeenCalled();
    });

    it('les boutons undo/redo appellent _undo/_redo', () => {
        setupDrawDock();
        const state = makeFakeState(null);
        const undoSpy = vi.spyOn(state, '_undo');
        const redoSpy = vi.spyOn(state, '_redo');

        state._bindDrawUi();
        document.getElementById('oi_carto_draw_undo')?.click();
        document.getElementById('oi_carto_draw_redo')?.click();

        expect(undoSpy).toHaveBeenCalledTimes(1);
        expect(redoSpy).toHaveBeenCalledTimes(1);
    });

    it('ne jette pas quand le dock est absent du DOM', () => {
        const state = makeFakeState(null);
        expect(() => state._bindDrawUi()).not.toThrow();
    });
});

describe('_toggleDrawDock (oi_cartographie.js:1390-1398)', () => {
    it('ouvre/ferme le dock (toggle implicite) et synchronise le FAB', () => {
        document.body.innerHTML = `
            <div id="oi_carto_draw_dock"></div>
            <button id="oi_carto_btn_draw"></button>
        `;
        const state = makeFakeState(null);
        const dock = document.getElementById('oi_carto_draw_dock') as HTMLElement;
        const fab = document.getElementById('oi_carto_btn_draw') as HTMLElement;

        state._toggleDrawDock();
        expect(dock.classList.contains('open')).toBe(true);
        expect(fab.classList.contains('active')).toBe(true);

        state._toggleDrawDock();
        expect(dock.classList.contains('open')).toBe(false);
        expect(fab.classList.contains('active')).toBe(false);
    });

    it('force=true ouvre explicitement même si déjà ouvert', () => {
        document.body.innerHTML = `<div id="oi_carto_draw_dock" class="open"></div>`;
        const state = makeFakeState(null);

        state._toggleDrawDock(true);

        expect(document.getElementById('oi_carto_draw_dock')?.classList.contains('open')).toBe(true);
    });

    it("fermer le dock désactive l'outil de dessin actif", () => {
        document.body.innerHTML = `<div id="oi_carto_draw_dock" class="open"></div>`;
        const state = makeFakeState(null);
        state.drawTool = 'line';
        const setToolSpy = vi.spyOn(state, '_setTool');

        state._toggleDrawDock(false);

        expect(setToolSpy).toHaveBeenCalledWith(null);
    });

    it('ne jette pas quand le dock est absent du DOM', () => {
        const state = makeFakeState(null);
        expect(() => state._toggleDrawDock()).not.toThrow();
    });
});
