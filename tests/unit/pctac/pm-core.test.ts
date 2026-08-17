/**
 * pm-core.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-core` :
 * `planmap/types.ts` + `planmap/constants.ts` + `planmap/state.ts`.
 * Écrit AVANT le port (TDD, mission P2.CONV). Références `planMap.js:<ligne>`
 * en commentaire, cf. docs/SPEC-PLANMAP-SPLIT.md §4.0, §4.1, §3.2, §9.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    AOI_INDEX_KEY,
    AOI_MAX_TILES,
    ENTITY_COLORS,
    FRANCE_BBOX,
    OFFLINE_MAP_CACHE,
    PINS_KEY,
    RASTER_STYLE,
    SAT_TILE_TEMPLATE,
    SHAPES_KEY,
    VIEW_KEY,
    escHtml,
} from '../../../src/apps/pctac/planmap/constants.js';
import { SafeMethods, createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';

describe('state.ts — createPlanMapState() (planMap.js:301-328 + ad hoc §3.2)', () => {
    it('retourne exactement les 58 clés attendues, avec les bonnes valeurs initiales', () => {
        const s = createPlanMapState();

        // Décompte exhaustif : 27 (littéral, planMap.js:302-328 — vérifié par lecture
        // directe et par `grep -c` : SPEC-PLANMAP-SPLIT.md §0/§9 annonce « 28 » et
        // « 58 clés », mais le littéral source n'a que 27 propriétés ; écart de
        // comptage du document, signalé au gate, source de vérité = planMap.js)
        // + 28 (ad hoc, §3.2) + 2 (AOI_MIN_Z/MAX_Z) + 1 (`persistence`, mission
        // R3-c, hors littéral `planMap.js` — cf. commentaire de
        // `PlanMapState.persistence`, types.ts) = 58.
        expect(Object.keys(s).sort()).toEqual(
            [
                // 28 propriétés du littéral (planMap.js:302-328)
                'map',
                '_pinMarkers',
                'pendingFreePin',
                'searchMarker',
                'initialized',
                'drawTool',
                'drawColor',
                'drawState',
                'drawPreviewLayerIds',
                'history',
                'redoStack',
                'is3D',
                '_pinCancel',
                'streetLabelsOn',
                '_selectedShapeId',
                '_handleMarkers',
                '_textMarkers',
                '_diameterMarkers',
                '_toolbarMarker',
                '_contextPopup',
                '_gesture',
                '_diameterGlobal',
                '_drawingDiameterMarker',
                '_locked',
                '_measureState',
                '_measureLabelMarkers',
                '_committedMeasureMarkers',
                // 28 propriétés ad hoc
                '_searchSeq',
                'pendingEntityPin',
                '_pinCircleFeatures',
                '_pinDiameterLabels',
                '_pinDecoMarkers',
                '_pinDiameterSrc',
                '_lastPinTap',
                'drawPrecisionMode',
                'moveState',
                '_measureControls',
                '_measurePointBtn',
                '_measureUndoBtn',
                '_textMarkersById',
                '_activeWheel',
                '_wheelJustClosed',
                '_lastShapeTap',
                '_dblZoomTimer',
                '_pinchListener',
                '_shapeLockMarkers',
                '_inlinePanel',
                '_moveHandlers',
                '_modalReparent',
                '_textModalBound',
                '_captureBusy',
                '_aoiFraming',
                '_aoiFramingHandlers',
                '_aoiDownloadBusy',
                // 2 constantes publiques
                'AOI_MIN_Z',
                'AOI_MAX_Z',
                // 1 adapter de persistance (mission R3-c, hors littéral)
                'persistence',
                // 1 overlay LiDAR HD actif (hors littéral planMap.js)
                'lidarLayer',
            ].sort(),
        );
        expect(Object.keys(s)).toHaveLength(58);
    });

    it('`persistence` : adapter fonctionnel posé par défaut (mission R3-c) — round-trip pins/shapes via localStorage', () => {
        localStorage.clear();
        const s = createPlanMapState();

        expect(s.persistence.loadPins()).toEqual([]);
        expect(s.persistence.savePins([{ id: 'p1', lng: 1, lat: 2 }])).toBe(true);
        expect(s.persistence.loadPins()).toEqual([{ id: 'p1', lng: 1, lat: 2 }]);

        expect(s.persistence.loadShapes()).toEqual([]);
        expect(s.persistence.saveShapes([{ id: 's1', type: 'line', coords: [[1, 2]] }])).toBe(true);
        expect(s.persistence.loadShapes()).toEqual([{ id: 's1', type: 'line', coords: [[1, 2]] }]);

        expect(s.persistence.loadView()).toBeNull();
        localStorage.clear();
    });

    it('valeurs littérales exactes des 28 propriétés du littéral (planMap.js:302-328)', () => {
        const s = createPlanMapState();
        expect(s.map).toBeNull();
        expect(s._pinMarkers).toBeNull();
        expect(s.pendingFreePin).toBeNull();
        expect(s.searchMarker).toBeNull();
        expect(s.initialized).toBe(false);
        expect(s.drawTool).toBeNull();
        expect(s.drawColor).toBe('#ef4444');
        expect(s.drawState).toBeNull();
        expect(s.drawPreviewLayerIds).toEqual(['plan-draw-preview-fill', 'plan-draw-preview-line']);
        expect(s.history).toEqual([]);
        expect(s.redoStack).toEqual([]);
        expect(s.is3D).toBe(false);
        expect(s._pinCancel).toBeNull();
        expect(s.streetLabelsOn).toBe(false);
        // Hors littéral planMap.js : aucun ombrage LiDAR HD au premier lancement.
        expect(s.lidarLayer).toBeNull();
        expect(s._selectedShapeId).toBeNull();
        expect(s._handleMarkers).toEqual([]);
        expect(s._textMarkers).toEqual([]);
        expect(s._diameterMarkers).toEqual([]);
        expect(s._toolbarMarker).toBeNull();
        expect(s._contextPopup).toBeNull();
        expect(s._gesture).toBeNull();
        // planMap.js:323 — défaut ON, PAS false.
        expect(s._diameterGlobal).toBe(true);
        expect(s._drawingDiameterMarker).toBeNull();
        expect(s._locked).toBe(false);
        expect(s._measureState).toBeNull();
        expect(s._measureLabelMarkers).toEqual([]);
        expect(s._committedMeasureMarkers).toEqual([]);
    });

    it('règle d\'initialisation opposable sur les 28 propriétés ad hoc (§3.2) : null / false / 0', () => {
        const s = createPlanMapState();
        // 0 pour _searchSeq et _wheelJustClosed
        expect(s._searchSeq).toBe(0);
        expect(s._wheelJustClosed).toBe(0);
        // false pour tout booléen
        expect(s._pinDiameterSrc).toBe(false);
        expect(s.drawPrecisionMode).toBe(false);
        expect(s._textModalBound).toBe(false);
        expect(s._captureBusy).toBe(false);
        expect(s._aoiFraming).toBe(false);
        expect(s._aoiDownloadBusy).toBe(false);
        // null pour tout objet/marker/handler
        expect(s.pendingEntityPin).toBeNull();
        expect(s._pinCircleFeatures).toBeNull();
        expect(s._pinDiameterLabels).toBeNull();
        expect(s._pinDecoMarkers).toBeNull();
        expect(s._lastPinTap).toBeNull();
        expect(s.moveState).toBeNull();
        expect(s._measureControls).toBeNull();
        expect(s._measurePointBtn).toBeNull();
        expect(s._measureUndoBtn).toBeNull();
        expect(s._textMarkersById).toBeNull();
        expect(s._activeWheel).toBeNull();
        expect(s._lastShapeTap).toBeNull();
        expect(s._dblZoomTimer).toBeNull();
        expect(s._pinchListener).toBeNull();
        expect(s._shapeLockMarkers).toBeNull();
        expect(s._inlinePanel).toBeNull();
        expect(s._moveHandlers).toBeNull();
        expect(s._modalReparent).toBeNull();
        expect(s._aoiFramingHandlers).toBeNull();
    });

    it('AOI_MIN_Z / AOI_MAX_Z (planMap.js:5303-5304)', () => {
        const s = createPlanMapState();
        expect(s.AOI_MIN_Z).toBe(13);
        expect(s.AOI_MAX_Z).toBe(18);
    });

    it('createPlanMapState() retourne un nouvel objet à chaque appel (pas de partage de référence)', () => {
        const s1 = createPlanMapState();
        const s2 = createPlanMapState();
        expect(s1).not.toBe(s2);
        expect(s1.history).not.toBe(s2.history);
    });
});

describe('state.ts — SafeMethods._safe (planMap.js:330-340)', () => {
    it('retourne la valeur de fn en cas de succès', () => {
        const fake = {} as PlanMapInternal;
        const wrapped = SafeMethods._safe.call<PlanMapInternal, [(a: number, b: number) => number, string?], (a: number, b: number) => number | undefined>(
            fake,
            (a: number, b: number) => a + b,
        );
        expect(wrapped(2, 3)).toBe(5);
    });

    it('capture l\'exception sans la propager, journalise, et retourne undefined en cas d\'erreur', () => {
        const fake = {} as PlanMapInternal;
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = (): never => { throw new Error('boom'); };
        const wrapped = SafeMethods._safe.call(fake, boom, 'monHandler');

        expect(() => wrapped()).not.toThrow();
        expect(wrapped()).toBeUndefined();
        expect(errSpy).toHaveBeenCalled();
        expect(String(errSpy.mock.calls[0]?.[0])).toContain('[PlanMap] monHandler a échoué:');

        errSpy.mockRestore();
    });

    it('utilise le libellé par défaut "handler" quand `label` est omis', () => {
        const fake = {} as PlanMapInternal;
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = (): never => { throw new Error('boom'); };
        const wrapped = SafeMethods._safe.call(fake, boom);

        wrapped();
        expect(String(errSpy.mock.calls[0]?.[0])).toContain('[PlanMap] handler a échoué:');

        errSpy.mockRestore();
    });
});

describe('constants.ts — clés localStorage littérales (planMap.js:29-31, 123, 128)', () => {
    it('expose les 5 clés attendues, valeurs exactes', () => {
        expect(PINS_KEY).toBe('pcTacPlanPins');
        expect(VIEW_KEY).toBe('pcTacPlanView');
        expect(SHAPES_KEY).toBe('pcTacPlanShapes');
        expect(OFFLINE_MAP_CACHE).toBe('pctac-map-v2');
        expect(AOI_INDEX_KEY).toBe('pcTacAoiIndex');
    });
});

describe('constants.ts — AOI_MAX_TILES, FRANCE_BBOX, SAT_TILE_TEMPLATE (planMap.js:124-130)', () => {
    it('AOI_MAX_TILES === 60000', () => {
        expect(AOI_MAX_TILES).toBe(60000);
    });

    it('FRANCE_BBOX = métropole + marge', () => {
        expect(FRANCE_BBOX).toEqual({ west: -5.6, south: 41.1, east: 9.8, north: 51.3 });
    });

    it('SAT_TILE_TEMPLATE pointe vers ArcGIS World_Imagery avec {z}/{y}/{x}', () => {
        expect(SAT_TILE_TEMPLATE).toBe(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        );
    });
});

describe('constants.ts — ENTITY_COLORS (planMap.js:35-39)', () => {
    it('3 clés, couleurs exactes', () => {
        expect(ENTITY_COLORS).toEqual({ adv: '#ef4444', host: '#eab308', friend: '#3b82f6' });
    });
});

describe('constants.ts — RASTER_STYLE (planMap.js:43-113 + overlays LiDAR HD)', () => {
    it('5 sources planMap.js + les 3 sources LiDAR HD', () => {
        expect(Object.keys(RASTER_STYLE.sources)).toEqual([
            'satellite',
            'ign-ortho',
            'terrain-dem',
            'openfreemap',
            'bdtopo',
            // Ajout hors planMap.js : ombrages LiDAR HD (constants.ts).
            'lidar-mnt',
            'lidar-mns',
            'lidar-mnh',
        ]);
    });

    it('2 couches planMap.js + les 3 couches LiDAR HD, dans cet ordre', () => {
        expect(RASTER_STYLE.layers).toHaveLength(5);
        expect(RASTER_STYLE.layers.map((l) => l.id)).toEqual([
            'satellite', 'ign-ortho', 'lidar-mnt', 'lidar-mns', 'lidar-mnh',
        ]);
    });

    it('glyphs OpenFreeMap', () => {
        expect(RASTER_STYLE.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    });

    it('bounds IGN [-5.6,41.1,9.8,51.3], minzoom 11', () => {
        const ign = RASTER_STYLE.sources['ign-ortho'] as { bounds?: number[]; minzoom?: number };
        expect(ign.bounds).toEqual([-5.6, 41.1, 9.8, 51.3]);
        expect(ign.minzoom).toBe(11);
    });
});

describe('constants.ts — escHtml (planMap.js:23-27, délégué à @shared/ui-platform.esc)', () => {
    it('échappe les 5 caractères HTML sensibles', () => {
        expect(escHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });

    it('null/undefined → chaîne vide', () => {
        expect(escHtml(null)).toBe('');
        expect(escHtml(undefined)).toBe('');
    });
});
