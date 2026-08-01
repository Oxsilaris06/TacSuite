/**
 * pm-measure.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-measure` :
 * `planmap/measure.ts` (15 méthodes MESURE, planMap.js:2297-2704,
 * SPEC-PLANMAP-SPLIT.md §4.9, §5.9, §9).
 *
 * `this` FACTICE, jamais `new maplibregl.Map` (SPEC-PCTAC-CONVERSION §8.4) :
 * `createPlanMapState()` fournit les 57 clés par défaut ; `GeoMethods` (réel,
 * paquet `pm-geo` déjà vert) est composé pour que les calculs géodésiques
 * (`_haversineMeters`, `_trueBearing`, `_circlePolygon`, `_geoEdgeNorth`…)
 * soient authentiques plutôt que re-mockés ; `MeasureMethods` sous test est
 * réel. Les dépendances CROISÉES (draw-tools.ts, shapes-render.ts, chrome.ts)
 * sont mockées via `vi.fn()`, comme dans pm-drawlayers.test.ts.
 *
 * Marker MapLibre : `this.map` reste `null` (ou un objet minimal sans
 * `getCanvasContainer`) dans la plupart des tests pour ne JAMAIS traverser le
 * chemin `new maplibregl.Marker(...).addTo(this.map)` (fragile à faire sous
 * jsdom sans une carte réelle) — chaque méthode qui crée des markers a une
 * garde `if (!this.map) return;` empruntée par ces tests. Pour isoler
 * `_renderMeasurePreview`/`_renderCommittedMeasures` de leur création de
 * marker, `_renderMeasureLabels` est ponctuellement remplacée par un mock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Marker } from 'maplibre-gl';

import { GeoMethods, haversineMeters } from '../../../src/apps/pctac/planmap/geo.js';
import { MeasureMethods } from '../../../src/apps/pctac/planmap/measure.js';
import { createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { LngLatTuple, PlanMapInternal, PlanShape } from '../../../src/apps/pctac/planmap/types.js';

interface FakeMocks {
    setTool: ReturnType<typeof vi.fn>;
    pushHistory: ReturnType<typeof vi.fn>;
    saveShapes: ReturnType<typeof vi.fn>;
    renderShapes: ReturnType<typeof vi.fn>;
    refreshUndoRedoButtons: ReturnType<typeof vi.fn>;
    showHint: ReturnType<typeof vi.fn>;
    hideHint: ReturnType<typeof vi.fn>;
    renderPreview: ReturnType<typeof vi.fn>;
    clearPreview: ReturnType<typeof vi.fn>;
}

/** Construit un `this` factice conforme à `PlanMapInternal` pour `MeasureMethods`. */
function makeFakeThis(opts: { shapes?: PlanShape[]; map?: unknown } = {}): { fake: PlanMapInternal; mocks: FakeMocks; shapes: () => PlanShape[] } {
    const state = createPlanMapState();
    let stored: PlanShape[] = opts.shapes ?? [];

    const mocks: FakeMocks = {
        setTool: vi.fn(),
        pushHistory: vi.fn(),
        saveShapes: vi.fn((list: readonly PlanShape[]) => { stored = list.slice(); }),
        renderShapes: vi.fn(),
        refreshUndoRedoButtons: vi.fn(),
        showHint: vi.fn(),
        hideHint: vi.fn(),
        renderPreview: vi.fn(),
        clearPreview: vi.fn(),
    };

    const base = {
        ...state,
        ...GeoMethods,
        ...MeasureMethods,
        map: (opts.map ?? null) as PlanMapInternal['map'],
        // Enveloppe `_safe` neutre : n'attrape rien, retourne `fn` telle quelle
        // (même idiome que pm-drawlayers.test.ts).
        _safe: vi.fn((fn: (...a: never[]) => unknown) => fn),
        _setTool: mocks.setTool,
        _pushHistory: mocks.pushHistory,
        _loadShapes: (): PlanShape[] => stored,
        _saveShapes: mocks.saveShapes,
        _renderShapes: mocks.renderShapes,
        _refreshUndoRedoButtons: mocks.refreshUndoRedoButtons,
        _showHint: mocks.showHint,
        _hideHint: mocks.hideHint,
        _renderPreview: mocks.renderPreview,
        _clearPreview: mocks.clearPreview,
    };

    const fake = base as unknown as PlanMapInternal;
    return { fake, mocks, shapes: () => stored };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('_startMeasure (planMap.js:2297-2312)', () => {
    it('ne jette pas sans DOM (#plan_draw_crosshair / #view-plan / #plan_map absents)', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._startMeasure(false)).not.toThrow();
    });

    it('réinitialise _measureState (vertices vides, reticle selon isMobile) et affiche le hint', () => {
        const { fake, mocks } = makeFakeThis();
        fake._startMeasure(true);
        expect(fake._measureState).not.toBeNull();
        expect(fake._measureState?.vertices).toEqual([]);
        expect(fake._measureState?.cursor).toBeNull();
        expect(fake._measureState?.reticle).toBe(true);
        expect(mocks.showHint).toHaveBeenCalledTimes(1);
    });

    it('active la classe "active" du réticule et "drawing-active" sur la vue quand reticle=true', () => {
        document.body.innerHTML = `
            <div id="plan_draw_crosshair"></div>
            <div id="view-plan"></div>
        `;
        const { fake } = makeFakeThis();
        fake._startMeasure(true);
        expect(document.getElementById('plan_draw_crosshair')?.classList.contains('active')).toBe(true);
        expect(document.getElementById('view-plan')?.classList.contains('drawing-active')).toBe(true);
    });
});

describe('_measureAddVertex (planMap.js:2316-2327)', () => {
    it('ne jette pas quand _measureState est null (pas de mesure en cours)', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._measureAddVertex([0, 0])).not.toThrow();
    });

    it('ajoute un sommet et met à jour le curseur', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        fake._measureAddVertex([2.35, 48.85]);
        expect(fake._measureState.vertices).toEqual([[2.35, 48.85]]);
        expect(fake._measureState.cursor).toEqual([2.35, 48.85]);
    });

    it('refuse le doublon exact du dernier sommet (double-événement tactile)', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [[2.35, 48.85]], cursor: null, reticle: false };
        fake._measureAddVertex([2.35, 48.85]);
        expect(fake._measureState.vertices).toHaveLength(1);
    });

    it("n'est pas gêné par un doublon non-exact (coordonnée légèrement différente)", () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [[2.35, 48.85]], cursor: null, reticle: false };
        fake._measureAddVertex([2.36, 48.85]);
        expect(fake._measureState.vertices).toHaveLength(2);
    });
});

describe('_measureUpdateCursor (planMap.js:2329-2335)', () => {
    it('ne jette pas quand _measureState est null', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._measureUpdateCursor([1, 1])).not.toThrow();
    });

    it('ne fait rien si aucun sommet posé (vertices vide)', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        fake._measureUpdateCursor([1, 1]);
        expect(fake._measureState.cursor).toBeNull();
    });

    it('met à jour le curseur dès qu\'un sommet est posé', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: false };
        fake._measureUpdateCursor([1, 1]);
        expect(fake._measureState.cursor).toEqual([1, 1]);
    });
});

describe('_measureReticlePoint (planMap.js:2337-2340)', () => {
    it('retourne [0,0] quand this.map est absent (garde de typage, jamais empruntée en pratique)', () => {
        const { fake } = makeFakeThis();
        expect(fake._measureReticlePoint()).toEqual([0, 0]);
    });

    it('retourne le centre de la carte quand this.map est présent', () => {
        const getCenter = vi.fn(() => ({ lng: 2.5, lat: 48.5 }));
        const { fake } = makeFakeThis({ map: { getCenter } });
        expect(fake._measureReticlePoint()).toEqual([2.5, 48.5]);
    });
});

describe('_renderMeasurePreview (planMap.js:2356-2380)', () => {
    it('ne jette pas sans _measureState ni carte', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._renderMeasurePreview()).not.toThrow();
    });

    it('moins de 2 points de tracé : efface la preview (pas de _renderPreview)', () => {
        const { fake, mocks } = makeFakeThis({ map: {} });
        fake._renderMeasureLabels = vi.fn();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        fake._renderMeasurePreview();
        expect(mocks.clearPreview).toHaveBeenCalledTimes(1);
        expect(mocks.renderPreview).not.toHaveBeenCalled();
    });

    it('2+ points : dessine la polyligne live avec la couleur de tracé courante', () => {
        const { fake, mocks } = makeFakeThis({ map: {} });
        fake._renderMeasureLabels = vi.fn();
        fake.drawColor = '#3b82f6';
        fake._measureState = { vertices: [[2.35, 48.85]], cursor: [2.36, 48.86], reticle: false };
        fake._renderMeasurePreview();
        expect(mocks.renderPreview).toHaveBeenCalledWith({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[2.35, 48.85], [2.36, 48.86]] },
            properties: { color: '#3b82f6' },
        });
        expect(mocks.clearPreview).not.toHaveBeenCalled();
    });

    it('en mode réticule, ajoute le centre de carte courant comme point live', () => {
        const getCenter = vi.fn(() => ({ lng: 5, lat: 45 }));
        const { fake, mocks } = makeFakeThis({ map: { getCenter } });
        fake._renderMeasureLabels = vi.fn();
        fake._measureState = { vertices: [[2.35, 48.85]], cursor: null, reticle: true };
        fake._renderMeasurePreview();
        expect(mocks.renderPreview).toHaveBeenCalledWith(expect.objectContaining({
            geometry: { type: 'LineString', coordinates: [[2.35, 48.85], [5, 45]] },
        }));
    });
});

describe('_renderMeasureLabels (planMap.js:2382-2436)', () => {
    it('ne jette pas sans carte (retourne avant toute création de marker)', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._renderMeasureLabels([[0, 0], [1, 1]], false)).not.toThrow();
    });

    it('committed=false : purge les labels live précédents avant de retourner (sans carte)', () => {
        const { fake } = makeFakeThis();
        const removeSpy = vi.fn();
        fake._measureLabelMarkers = [{ remove: removeSpy } as unknown as Marker];
        fake._renderMeasureLabels([], false);
        expect(removeSpy).toHaveBeenCalledTimes(1);
        expect(fake._measureLabelMarkers).toEqual([]);
    });

    it('committed=true : ne touche pas au sink des labels live (sink séparé)', () => {
        const { fake } = makeFakeThis();
        const removeSpy = vi.fn();
        fake._measureLabelMarkers = [{ remove: removeSpy } as unknown as Marker];
        fake._renderMeasureLabels([[0, 0], [1, 1]], true);
        expect(removeSpy).not.toHaveBeenCalled();
        expect(fake._measureLabelMarkers).toHaveLength(1);
    });
});

describe('_buildMeasureControls / _updateMeasureControls / _removeMeasureControls (planMap.js:2437-2496)', () => {
    it('ne jette pas quand #plan_map est absent du DOM', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._buildMeasureControls()).not.toThrow();
        expect(document.getElementById('plan_measure_controls')).toBeNull();
    });

    it('monte la barre de contrôle avec le bouton "Point" seulement si reticle=true', () => {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: true };
        fake._buildMeasureControls();

        const bar = document.getElementById('plan_measure_controls');
        expect(bar).not.toBeNull();
        const labels = Array.from(bar?.querySelectorAll('button') ?? []).map((b) => b.textContent ?? '');
        expect(labels.some((t) => t.includes('Point'))).toBe(true);
        expect(labels.some((t) => t.includes('Terminer'))).toBe(true);
        expect(labels.some((t) => t.includes('Quitter'))).toBe(true);
    });

    it('sans reticle, pas de bouton "Point"', () => {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        fake._buildMeasureControls();
        const bar = document.getElementById('plan_measure_controls');
        const labels = Array.from(bar?.querySelectorAll('button') ?? []).map((b) => b.textContent ?? '');
        expect(labels.some((t) => t.includes('Point'))).toBe(false);
    });

    it('_updateMeasureControls affiche/masque le bouton "Annuler dernier" selon le nombre de sommets', () => {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        fake._buildMeasureControls();
        expect(fake._measureUndoBtn?.style.display).toBe('none');

        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: false };
        fake._updateMeasureControls();
        expect(fake._measureUndoBtn?.style.display).toBe('inline-flex');
    });

    it('_removeMeasureControls retire la barre du DOM et réinitialise les références de boutons', () => {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const { fake } = makeFakeThis();
        fake._buildMeasureControls();
        expect(document.getElementById('plan_measure_controls')).not.toBeNull();

        fake._removeMeasureControls();
        expect(document.getElementById('plan_measure_controls')).toBeNull();
        expect(fake._measureControls).toBeNull();
        expect(fake._measurePointBtn).toBeNull();
        expect(fake._measureUndoBtn).toBeNull();
    });
});

describe('_measureUndoVertex (planMap.js:2497-2504)', () => {
    it('ne jette pas sans _measureState', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._measureUndoVertex()).not.toThrow();
    });

    it('retire le dernier sommet posé', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [[0, 0], [1, 1]], cursor: null, reticle: false };
        fake._measureUndoVertex();
        expect(fake._measureState.vertices).toEqual([[0, 0]]);
    });

    it('ne fait rien si aucun sommet posé', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        expect(() => fake._measureUndoVertex()).not.toThrow();
        expect(fake._measureState.vertices).toEqual([]);
    });
});

describe('_finishMeasure (planMap.js:2506-2537)', () => {
    it('sans _measureState : appelle _setTool(null) et ne jette pas', () => {
        const { fake, mocks } = makeFakeThis();
        expect(() => fake._finishMeasure()).not.toThrow();
        expect(mocks.setTool).toHaveBeenCalledWith(null);
    });

    it('avec 1 seul sommet (sans réticule) : ANNULE, aucune shape écrite, état remis à zéro', () => {
        const { fake, mocks, shapes } = makeFakeThis();
        fake._measureState = { vertices: [[2.35, 48.85]], cursor: null, reticle: false };

        fake._finishMeasure();

        expect(mocks.saveShapes).not.toHaveBeenCalled();
        expect(shapes()).toEqual([]);
        expect(fake._measureState).toBeNull();
        expect(mocks.setTool).toHaveBeenCalledWith(null);
    });

    it('avec 2+ sommets : persiste une shape "measure" avec un totalM cohérent (Haversine réelle)', () => {
        const { fake, mocks, shapes } = makeFakeThis();
        const a: LngLatTuple = [2.35, 48.85];
        const b: LngLatTuple = [2.36, 48.86];
        fake._measureState = { vertices: [a, b], cursor: null, reticle: false };
        fake.drawColor = '#3b82f6';

        fake._finishMeasure();

        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
        expect(mocks.saveShapes).toHaveBeenCalledTimes(1);
        const persisted = shapes();
        expect(persisted).toHaveLength(1);
        const shape = persisted[0];
        expect(shape).toBeDefined();
        if (!shape) return;
        expect(shape.type).toBe('measure');
        expect(shape.color).toBe('#3b82f6');
        expect(shape.coords).toEqual([a, b]);
        expect(shape.totalM).toBeCloseTo(haversineMeters(a, b), 6);
        expect(fake._measureState).toBeNull();
        expect(mocks.setTool).toHaveBeenCalledWith(null);
        expect(mocks.renderShapes).toHaveBeenCalledTimes(1);
        expect(mocks.refreshUndoRedoButtons).toHaveBeenCalledTimes(1);
    });

    it('en mode réticule, le centre de carte courant complète un sommet unique déjà posé', () => {
        const getCenter = vi.fn(() => ({ lng: 3, lat: 46 }));
        const { fake, shapes } = makeFakeThis({ map: { getCenter } });
        fake._measureState = { vertices: [[2, 45]], cursor: null, reticle: true };

        fake._finishMeasure();

        const shape = shapes()[0];
        expect(shape).toBeDefined();
        if (!shape) return;
        expect(shape.coords).toEqual([[2, 45], [3, 46]]);
    });
});

describe('_cancelMeasure (planMap.js:2539-2543)', () => {
    it('nettoie _measureState et appelle _setTool(null)', () => {
        const { fake, mocks } = makeFakeThis();
        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: false };
        fake._cancelMeasure();
        expect(fake._measureState).toBeNull();
        expect(mocks.setTool).toHaveBeenCalledWith(null);
    });
});

describe('_clearMeasureState (planMap.js:2545-2565)', () => {
    it('ne jette pas sans DOM et remet _measureState à null', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: true };
        expect(() => fake._clearMeasureState()).not.toThrow();
        expect(fake._measureState).toBeNull();
        expect(fake._measureLabelMarkers).toEqual([]);
    });

    it('appelle _clearPreview et _hideHint (délégation cross-groupe)', () => {
        const { fake, mocks } = makeFakeThis();
        fake._clearMeasureState();
        expect(mocks.clearPreview).toHaveBeenCalledTimes(1);
        expect(mocks.hideHint).toHaveBeenCalledTimes(1);
    });

    it('retire la classe "active" du réticule et "drawing-active" de la vue (hors mode précision dessin)', () => {
        document.body.innerHTML = `
            <div id="plan_draw_crosshair" class="active"></div>
            <div id="view-plan" class="drawing-active"></div>
        `;
        const { fake } = makeFakeThis();
        fake.drawPrecisionMode = false;
        fake._clearMeasureState();
        expect(document.getElementById('plan_draw_crosshair')?.classList.contains('active')).toBe(false);
        expect(document.getElementById('view-plan')?.classList.contains('drawing-active')).toBe(false);
    });

    it('conserve "drawing-active" sur la vue si le mode précision dessin est actif', () => {
        document.body.innerHTML = `<div id="view-plan" class="drawing-active"></div>`;
        const { fake } = makeFakeThis();
        fake.drawPrecisionMode = true;
        fake._clearMeasureState();
        expect(document.getElementById('view-plan')?.classList.contains('drawing-active')).toBe(true);
    });
});

describe('_addEngagementRings (planMap.js:2567-2591)', () => {
    it('ne jette pas quand this.map est absent, et ne persiste rien', () => {
        const { fake, mocks } = makeFakeThis();
        expect(() => fake._addEngagementRings([2.35, 48.85])).not.toThrow();
        expect(mocks.saveShapes).not.toHaveBeenCalled();
    });

    it('produit une shape "measure-rings" SANS propriété coords, avec 3 rayons 50/100/200', () => {
        const { fake, mocks, shapes } = makeFakeThis({ map: {} });
        const center: LngLatTuple = [2.35, 48.85];

        fake._addEngagementRings(center);

        expect(mocks.saveShapes).toHaveBeenCalledTimes(1);
        const persisted = shapes();
        expect(persisted).toHaveLength(1);
        const shape = persisted[0];
        expect(shape).toBeDefined();
        if (!shape) return;
        expect(shape.type).toBe('measure-rings');
        expect('coords' in shape).toBe(false);
        expect(shape.center).toEqual(center);
        expect(shape.rings?.map((r) => r.radiusM)).toEqual([50, 100, 200]);
        // Chaque anneau est un polygone géodésique fermé (65 points, cf. geo.ts circlePolygon).
        for (const ring of shape.rings ?? []) {
            expect(ring.coords).toHaveLength(65);
            expect(ring.coords[0]).toEqual(ring.coords[ring.coords.length - 1]);
        }
        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
        expect(mocks.renderShapes).toHaveBeenCalledTimes(1);
        expect(mocks.refreshUndoRedoButtons).toHaveBeenCalledTimes(1);
        expect(mocks.showHint).toHaveBeenCalledTimes(1);
    });

    it('sans center explicite, lit this.map.getCenter()', () => {
        const getCenter = vi.fn(() => ({ lng: 1.5, lat: 45.5 }));
        const { fake, shapes } = makeFakeThis({ map: { getCenter } });

        fake._addEngagementRings();

        expect(getCenter).toHaveBeenCalledTimes(1);
        const shape = shapes()[0];
        expect(shape).toBeDefined();
        if (!shape) return;
        expect(shape.center).toEqual([1.5, 45.5]);
    });
});

describe('_renderCommittedMeasures (planMap.js:2672-2704)', () => {
    it('ne jette pas quand this.map est absent', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._renderCommittedMeasures()).not.toThrow();
    });

    it('vide sans jeter quand aucune shape mesure/anneaux n\'est persistée', () => {
        const { fake } = makeFakeThis({ map: {}, shapes: [] });
        expect(() => fake._renderCommittedMeasures()).not.toThrow();
        expect(fake._committedMeasureMarkers).toEqual([]);
    });

    it('RESTAURE this.drawColor à sa valeur d\'entrée après le rendu (invariant §5.9)', () => {
        const measureShape: PlanShape = {
            id: 'shape_1',
            type: 'measure',
            color: '#22d3ee',
            coords: [[2.35, 48.85], [2.36, 48.86]],
            totalM: 100,
        };
        const { fake } = makeFakeThis({ shapes: [measureShape], map: {} });
        fake.drawColor = '#ef4444';
        // Isole _renderCommittedMeasures de son appel réel à _renderMeasureLabels
        // (qui construirait un vrai maplibregl.Marker via `this.map`, cf. §8.4) :
        // le mock capture SEULEMENT la couleur observée pendant l'appel — c'est
        // exactement l'observable du hack sauvegarde/remplace/restaure §5.9.
        const seenColors: string[] = [];
        fake._renderMeasureLabels = vi.fn(function (this: PlanMapInternal) {
            seenColors.push(this.drawColor);
        });

        fake._renderCommittedMeasures();

        expect(seenColors).toEqual(['#22d3ee']);
        expect(fake.drawColor).toBe('#ef4444');
    });

    it('ignore les shapes measure dont coords a moins de 2 points (garde Array.isArray + length)', () => {
        const measureShape: PlanShape = { id: 'shape_1', type: 'measure', color: '#22d3ee', coords: [[0, 0]] };
        const { fake } = makeFakeThis({ shapes: [measureShape], map: {} });
        fake._renderMeasureLabels = vi.fn();
        fake._renderCommittedMeasures();
        expect(fake._renderMeasureLabels).not.toHaveBeenCalled();
    });
});
