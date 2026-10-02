/**
 * pm-measure.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-measure` :
 * `planmap/measure.ts` (15 méthodes MESURE, planMap.js:2297-2704,
 * SPEC-PLANMAP-SPLIT.md §4.9, §5.9, §9 ; + 3 méthodes d'évolution, cf. ci-dessous).
 *
 * `this` FACTICE, jamais `new maplibregl.Map` (SPEC-PCTAC-CONVERSION §8.4) :
 * `createPlanMapState()` fournit les 57 clés par défaut ; `GeoMethods` (réel,
 * paquet `pm-geo` déjà vert) est composé pour que les calculs géodésiques
 * (`_haversineMeters`, `_trueBearing`, `_circlePolygon`, `_geoEdgeNorth`…)
 * soient authentiques plutôt que re-mockés ; `MeasureMethods` sous test est
 * réel. Les dépendances CROISÉES (draw-tools.ts, shapes-render.ts, chrome.ts)
 * sont mockées via `vi.fn()`, comme dans pm-drawlayers.test.ts.
 *
 * Évolution « retours terrain 2026-10-02 » (mesure du PC-Tac) : les blocs
 * « rester en mode », « aimant », « lecture d'un dessin », « double-clic » et
 * « dessins inertes » en bas de fichier ne sont plus des comportements de
 * `planMap.js` mais les décisions de Nico du 02/10 (et les corrections de la
 * revue neuve : lecture sur le contour seul, tracé à main levée, double-clic,
 * cadenas) ; les tests de `_finishMeasure` et du libellé de la barre ont été
 * recalés en conséquence.
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

import { GeoMethods, haversineMeters, shapeMeasureText } from '../../../src/apps/pctac/planmap/geo.js';
import { MEASURE_DUP_PX, MEASURE_SNAP_PX, MeasureMethods } from '../../../src/apps/pctac/planmap/measure.js';
import { createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { LngLatTuple, PlanMapInternal, PlanPin, PlanShape } from '../../../src/apps/pctac/planmap/types.js';

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
    deselectShape: ReturnType<typeof vi.fn>;
    renderShapeLocks: ReturnType<typeof vi.fn>;
}

/** Construit un `this` factice conforme à `PlanMapInternal` pour `MeasureMethods`. */
function makeFakeThis(opts: { shapes?: PlanShape[]; pins?: PlanPin[]; map?: unknown } = {}): { fake: PlanMapInternal; mocks: FakeMocks; shapes: () => PlanShape[] } {
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
        deselectShape: vi.fn(),
        renderShapeLocks: vi.fn(),
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
        _loadPins: (): PlanPin[] => opts.pins ?? [],
        _deselectShape: mocks.deselectShape,
        _renderShapeLocks: mocks.renderShapeLocks,
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

    it('l\'aimant démarre actif et le hint annonce « Valider la ligne » (plus « Terminer »)', () => {
        const { fake, mocks } = makeFakeThis();
        fake._startMeasure(false);
        expect(fake._measureState?.snap).toBe(true);
        const hint = String(mocks.showHint.mock.calls[0]?.[0]);
        expect(hint).toContain('Valider la ligne');
        expect(hint).not.toContain('Terminer');
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
        expect(labels.some((t) => t.includes('Valider la ligne'))).toBe(true);
        expect(labels.some((t) => t.includes('Aimant'))).toBe(true);
        expect(labels.some((t) => t.includes('Quitter'))).toBe(true);
        expect(labels.some((t) => t.includes('Terminer'))).toBe(false);
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

describe('dock de dessin pendant la mesure (atelier UI-1, capture fix-measure390)', () => {
    it('masqué tant que la barre de mesure est posée (elle le recouvrait), rendu à la sortie', () => {
        document.body.innerHTML = '<div><div id="plan_map"></div><div id="plan_draw_dock" class="open"></div></div>';
        const { fake } = makeFakeThis();
        const dock = document.getElementById('plan_draw_dock')!;
        fake._buildMeasureControls();
        expect(dock.hidden).toBe(true);
        fake._removeMeasureControls();
        expect(dock.hidden).toBe(false);
        expect(dock.classList.contains('open')).toBe(true);
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

describe('_finishMeasure — valide la ligne et RESTE en mode mesure (décision « retours terrain 2026-10-02 »)', () => {
    it('sans _measureState : appelle _setTool(null) et ne jette pas', () => {
        const { fake, mocks } = makeFakeThis();
        expect(() => fake._finishMeasure()).not.toThrow();
        expect(mocks.setTool).toHaveBeenCalledWith(null);
    });

    it('avec 1 seul sommet (sans réticule) : abandonne la ligne SANS persister, l\'outil reste actif', () => {
        const { fake, mocks, shapes } = makeFakeThis();
        fake._measureState = { vertices: [[2.35, 48.85]], cursor: null, reticle: false };

        fake._finishMeasure();

        expect(mocks.pushHistory).not.toHaveBeenCalled();
        expect(mocks.saveShapes).not.toHaveBeenCalled();
        expect(shapes()).toEqual([]);
        expect(fake._measureState).not.toBeNull();
        expect(fake._measureState?.vertices).toEqual([]);
        expect(mocks.setTool).not.toHaveBeenCalled();
    });

    it('avec 2+ sommets : persiste une shape "measure" (totalM Haversine réelle) et l\'outil reste actif', () => {
        const { fake, mocks, shapes } = makeFakeThis({ map: {} });
        fake._renderMeasureLabels = vi.fn();
        const a: LngLatTuple = [2.35, 48.85];
        const b: LngLatTuple = [2.36, 48.86];
        fake._measureState = { vertices: [a, b], cursor: [2.4, 48.9], reticle: false };
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
        // L'outil reste actif : l'état survit, la ligne repart de zéro.
        expect(fake._measureState).not.toBeNull();
        expect(fake._measureState?.vertices).toEqual([]);
        expect(fake._measureState?.cursor).toBeNull();
        expect(mocks.setTool).not.toHaveBeenCalled();
        expect(mocks.renderShapes).toHaveBeenCalledTimes(1);
        expect(mocks.refreshUndoRedoButtons).toHaveBeenCalledTimes(1);
        // La preview pointillée et les étiquettes live de la ligne figée sont effacées
        // (le tracé plein et les étiquettes persistées prennent le relais).
        expect(mocks.clearPreview).toHaveBeenCalled();
        expect(fake._renderMeasureLabels).toHaveBeenLastCalledWith([], false);
    });

    it('la barre, le hint et le réticule survivent à la validation (seul « Quitter » ferme l\'outil)', () => {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const { fake, mocks } = makeFakeThis();
        fake._startMeasure(false);
        fake._measureAddVertex([2.35, 48.85]);
        fake._measureAddVertex([2.36, 48.86]);
        mocks.hideHint.mockClear();

        fake._finishMeasure();

        expect(document.getElementById('plan_measure_controls')).not.toBeNull();
        expect(mocks.hideHint).not.toHaveBeenCalled();
    });

    it('une ligne validée = UNE entrée d\'historique ; la suivante repart de n\'importe où et en ajoute une seconde', () => {
        const { fake, mocks, shapes } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        let t = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => (t += 1000));

        fake._measureAddVertex([2.35, 48.85]);
        fake._measureAddVertex([2.36, 48.86]);
        fake._finishMeasure();
        // Nouvelle ligne : aucun lien avec la première (autre endroit, autre longueur).
        fake._measureAddVertex([5, 45]);
        fake._measureAddVertex([5.1, 45]);
        fake._measureAddVertex([5.1, 45.1]);
        fake._finishMeasure();

        expect(mocks.pushHistory).toHaveBeenCalledTimes(2);
        expect(shapes().map((x) => x.coords?.length)).toEqual([2, 3]);
        expect(new Set(shapes().map((x) => x.id)).size).toBe(2);
        expect(mocks.setTool).not.toHaveBeenCalled();
    });

    it('valider une ligne vide ne persiste rien et ne jette pas (double-clic sans point)', () => {
        const { fake, mocks } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        expect(() => fake._finishMeasure()).not.toThrow();
        expect(mocks.saveShapes).not.toHaveBeenCalled();
        expect(fake._measureState).not.toBeNull();
    });

    it('en mode réticule, le centre de carte courant complète un sommet unique déjà posé', () => {
        // Carte complète (`project`) : la ligne figée devient aussitôt candidate de l'aimant.
        const { fake, shapes } = makeFakeThis({ map: makeMap({ center: [3, 46] }) });
        fake._measureState = { vertices: [[2, 45]], cursor: null, reticle: true };

        fake._finishMeasure();

        const shape = shapes()[0];
        expect(shape).toBeDefined();
        if (!shape) return;
        expect(shape.coords).toEqual([[2, 45], [3, 46]]);
        expect(fake._measureState?.vertices).toEqual([]);
    });

    it('en mode réticule, un sommet unique et un centre inchangé : abandon, l\'outil reste actif', () => {
        const { fake, mocks } = makeFakeThis({ map: makeMap({ center: [2, 45] }) });
        fake._measureState = { vertices: [[2, 45]], cursor: null, reticle: true };

        fake._finishMeasure();

        expect(mocks.saveShapes).not.toHaveBeenCalled();
        expect(fake._measureState).not.toBeNull();
        expect(mocks.setTool).not.toHaveBeenCalled();
    });
});

describe('_cancelMeasure (planMap.js:2539-2543) — « Quitter »', () => {
    it('nettoie _measureState et appelle _setTool(null)', () => {
        const { fake, mocks } = makeFakeThis();
        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: false };
        fake._cancelMeasure();
        expect(fake._measureState).toBeNull();
        expect(mocks.setTool).toHaveBeenCalledWith(null);
    });

    it('Quitter avec une ligne de 2+ points l\'ABANDONNE (rien de persisté, pas d\'historique)', () => {
        const { fake, mocks, shapes } = makeFakeThis();
        fake._measureState = { vertices: [[0, 0], [1, 1], [2, 2]], cursor: null, reticle: false };
        fake._cancelMeasure();
        expect(shapes()).toEqual([]);
        expect(mocks.saveShapes).not.toHaveBeenCalled();
        expect(mocks.pushHistory).not.toHaveBeenCalled();
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

/* ─────────────────────────────────────────────────────────────────────────
 * Évolution « retours terrain 2026-10-02 » : aimant, lecture d'un dessin,
 * barre (Valider la ligne / Aimant), dessins inertes.
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Carte factice : 1° = 1000 px (0,01° = 10 px), pour des écarts lisibles en
 * pixels ; `queryRenderedFeatures` rend `hits` quel que soit le point et le
 * filtre de couches. Avec `layerHits`, elle se comporte comme la vraie : seules
 * les entités des couches DEMANDÉES sont rendues (le remplissage d'un
 * rectangle n'est pas la zone de touche de son contour).
 */
function makeMap(opts: { center?: LngLatTuple; hits?: unknown[]; layerHits?: Record<string, unknown[]> } = {}) {
    const center = opts.center ?? [0, 0];
    const { layerHits } = opts;
    return {
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng * 1000, y: ll.lat * 1000 })),
        getCenter: vi.fn(() => ({ lng: center[0], lat: center[1] })),
        queryRenderedFeatures: vi.fn((_point?: unknown, query?: { layers?: string[] }): unknown[] =>
            layerHits ? (query?.layers ?? []).flatMap((l) => layerHits[l] ?? []) : (opts.hits ?? [])),
    };
}

/** Pixels écran → degrés de la carte factice. */
const deg = (px: number): number => px / 1000;

const SNAP_LINE: PlanShape = { id: 'l1', type: 'line', color: '#ef4444', coords: [[10, 20], [10.1, 20.1]] };
const SNAP_RECT: PlanShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: [[1, 1], [1.1, 1], [1.1, 1.1], [1, 1.1], [1, 1]] };
const SNAP_CIRCLE: PlanShape = {
    id: 'c1', type: 'circle', color: '#ef4444', center: [5, 5], edge: [5.1, 5],
    coords: [[5.1, 5], [5, 5.1], [4.9, 5], [5, 4.9], [5.1, 5]],
};
const SNAP_MEASURE: PlanShape = { id: 'm1', type: 'measure', color: '#22d3ee', coords: [[7, 7], [7.5, 7.5]], totalM: 1 };
const SNAP_RINGS: PlanShape = {
    id: 'g1', type: 'measure-rings', color: '#22d3ee', center: [8, 8],
    rings: [{ radiusM: 50, coords: [[8.05, 8], [8, 8.05], [8.05, 8]] }],
};
const SNAP_TEXT: PlanShape = { id: 't1', type: 'text', color: '#fff', text: 'x', coords: [[9, 9]] };
const SNAP_PIN: PlanPin = { id: 'p1', lng: 3, lat: 4 };

/** `this` factice en mode mesure sur la carte factice (étiquettes live neutralisées). */
function snapFake(opts: { shapes?: PlanShape[]; pins?: PlanPin[]; center?: LngLatTuple; snap?: boolean; reticle?: boolean } = {}) {
    const mapOpts: { center?: LngLatTuple } = {};
    if (opts.center) mapOpts.center = opts.center;
    const made = makeFakeThis({ shapes: opts.shapes ?? [], pins: opts.pins ?? [], map: makeMap(mapOpts) });
    made.fake._measureState = { vertices: [], cursor: null, reticle: opts.reticle ?? false, snap: opts.snap ?? true };
    made.fake._renderMeasureLabels = vi.fn();
    return made;
}

describe('aimant — _measureSnapTarget (retours terrain 2026-10-02, décision 2)', () => {
    const inside = MEASURE_SNAP_PX - 2;
    const outside = MEASURE_SNAP_PX + 2;

    it('le seuil est une constante nommée de 16 à 20 px', () => {
        expect(MEASURE_SNAP_PX).toBeGreaterThanOrEqual(16);
        expect(MEASURE_SNAP_PX).toBeLessThanOrEqual(20);
    });

    it('un point sous le seuil d\'un sommet de trait s\'y accroche EXACTEMENT (copie des coordonnées)', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE] });
        const r = fake._measureSnapTarget([10 + deg(inside), 20]);
        expect(r).toEqual([10, 20]);
        expect(r).not.toBe(SNAP_LINE.coords?.[0]);
    });

    it('au-delà du seuil : aucun accrochage', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE] });
        expect(fake._measureSnapTarget([10 + deg(outside), 20])).toBeNull();
    });

    it('la distance se mesure en pixels écran dans les deux axes', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE] });
        // 14 px en x et 14 px en y : 19,8 px de distance, au-dessus du seuil.
        expect(fake._measureSnapTarget([10 + deg(14), 20 + deg(14)])).toBeNull();
        expect(fake._measureSnapTarget([10 + deg(8), 20 + deg(8)])).toEqual([10, 20]);
    });

    it('choisit le sommet le plus proche parmi plusieurs candidats', () => {
        const near: PlanShape = { id: 'l2', type: 'line', color: '#ef4444', coords: [[10, 20], [10.01, 20]] };
        const { fake } = snapFake({ shapes: [near] });
        expect(fake._measureSnapTarget([10.008, 20])).toEqual([10.01, 20]);
    });

    it('accroche les sommets de rectangle, le centre des cercles, les sommets de mesure posée, le centre des anneaux et les pions', () => {
        const { fake } = snapFake({ shapes: [SNAP_RECT, SNAP_CIRCLE, SNAP_MEASURE, SNAP_RINGS], pins: [SNAP_PIN] });
        const targets: LngLatTuple[] = [[1.1, 1.1], [1, 1.1], [5, 5], [7.5, 7.5], [8, 8], [3, 4]];
        for (const t of targets) {
            expect(fake._measureSnapTarget([t[0] + deg(3), t[1] - deg(3)]), `cible ${t.join(',')}`).toEqual(t);
        }
    });

    it('cercle : seul le CENTRE accroche (ni le point de bord, ni le contour)', () => {
        const { fake } = snapFake({ shapes: [SNAP_CIRCLE] });
        expect(fake._measureSnapTarget([5.1 + deg(2), 5])).toBeNull();
        expect(fake._measureSnapTarget([5 + deg(2), 5])).toEqual([5, 5]);
    });

    it('anneaux d\'engagement : seul le centre accroche, pas le contour des anneaux', () => {
        const { fake } = snapFake({ shapes: [SNAP_RINGS] });
        expect(fake._measureSnapTarget([8.05 + deg(2), 8])).toBeNull();
        expect(fake._measureSnapTarget([8 + deg(2), 8])).toEqual([8, 8]);
    });

    it('texte : pas d\'aimant', () => {
        const { fake } = snapFake({ shapes: [SNAP_TEXT] });
        expect(fake._measureSnapTarget([9 + deg(2), 9])).toBeNull();
    });

    it('aimant coupé (bouton « Aimant ») : aucun accrochage', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE], snap: false });
        expect(fake._measureSnapTarget([10, 20])).toBeNull();
    });

    it('aimant jamais touché (champ absent, mesure ouverte avant la décision) : actif', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE] });
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        expect(fake._measureSnapTarget([10, 20])).toEqual([10, 20]);
    });

    it('sans carte ou sans mesure en cours : null, sans jeter', () => {
        const noMap = makeFakeThis({ shapes: [SNAP_LINE] }).fake;
        noMap._measureState = { vertices: [], cursor: null, reticle: false };
        expect(noMap._measureSnapTarget([10, 20])).toBeNull();
        const noState = makeFakeThis({ shapes: [SNAP_LINE], map: makeMap() }).fake;
        expect(noState._measureSnapTarget([10, 20])).toBeNull();
    });

    it('aucun candidat : la carte n\'est même pas interrogée', () => {
        const map = makeMap();
        const { fake } = makeFakeThis({ map });
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        expect(fake._measureSnapTarget([0, 0])).toBeNull();
        expect(map.project).not.toHaveBeenCalled();
    });

    it('données forgées (archive) : coordonnées non numériques, centre incomplet, latitude hors bornes : ignorés sans jeter', () => {
        const forged = [
            { id: 'f1', type: 'measure', coords: [null, [Number.NaN, 1], 'x', [10, 20], [10, 200]] },
            { id: 'f2', type: 'circle', center: ['a', 'b'] },
            { id: 'f3', type: 'rectangle' },
        ] as unknown as PlanShape[];
        const { fake } = snapFake({ shapes: forged, pins: [{ id: 'p', lng: Number.NaN, lat: 1 }] });
        // La carte réelle jette sur une latitude hors de [-90 ; 90] : le point forgé ne doit jamais lui parvenir.
        const map = fake.map as unknown as ReturnType<typeof makeMap>;
        map.project.mockImplementation((ll: { lng: number; lat: number }) => {
            if (Math.abs(ll.lat) > 90) throw new RangeError('Invalid LngLat latitude value: must be between -90 and 90');
            return { x: ll.lng * 1000, y: ll.lat * 1000 };
        });
        expect(fake._measureSnapTarget([10 + deg(1), 20])).toEqual([10, 20]);
    });
});

describe('aimant — réticule, curseur et pose (retours terrain 2026-10-02, décision 2)', () => {
    it('_measureReticlePoint : le centre de carte voisin d\'un sommet s\'y accroche', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE], center: [10.005, 20], reticle: true });
        expect(fake._measureReticlePoint()).toEqual([10, 20]);
    });

    it('_measureReticlePoint : aimant coupé, le centre reste exact', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE], center: [10.005, 20], reticle: true, snap: false });
        expect(fake._measureReticlePoint()).toEqual([10.005, 20]);
    });

    it('le bouton « Point » pose le point du réticule accroché', () => {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const { fake } = snapFake({ shapes: [SNAP_LINE], center: [10.005, 20], reticle: true });
        fake._buildMeasureControls();
        const point = Array.from(document.querySelectorAll('#plan_measure_controls button')).find((b) => b.textContent?.includes('Point'));
        point?.dispatchEvent(new MouseEvent('click'));
        expect(fake._measureState?.vertices).toEqual([[10, 20]]);
    });

    it('« Valider la ligne » complète la ligne avec le centre accroché (sommet implicite du réticule)', () => {
        const { fake, shapes } = snapFake({ shapes: [SNAP_LINE], center: [10.005, 20], reticle: true });
        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: true, snap: true };
        fake._finishMeasure();
        expect(shapes().at(-1)?.coords).toEqual([[0, 0], [10, 20]]);
    });

    it('l\'aperçu du réticule s\'arrête sur le sommet accroché', () => {
        const { fake, mocks } = snapFake({ shapes: [SNAP_LINE], center: [10.005, 20], reticle: true });
        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: true, snap: true };
        fake._renderMeasurePreview();
        expect(mocks.renderPreview).toHaveBeenCalledWith(expect.objectContaining({
            geometry: { type: 'LineString', coordinates: [[0, 0], [10, 20]] },
        }));
    });

    it('le segment élastique de la souris suit l\'aimant', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE] });
        fake._measureState = { vertices: [[0, 0]], cursor: null, reticle: false, snap: true };
        fake._measureUpdateCursor([10 + deg(6), 20 + deg(2)]);
        expect(fake._measureState.cursor).toEqual([10, 20]);
        fake._measureUpdateCursor([50, 50]);
        expect(fake._measureState.cursor).toEqual([50, 50]);
    });

    it('un clic carte près d\'un sommet pose EXACTEMENT ce sommet', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE], pins: [SNAP_PIN] });
        fake._measureClick([10.1 + deg(5), 20.1 - deg(5)], [0, 0]);
        fake._measureClick([3 - deg(4), 4], [0, 0]);
        expect(fake._measureState?.vertices).toEqual([[10.1, 20.1], [3, 4]]);
    });

    it('aimant coupé : le clic garde sa position', () => {
        const { fake } = snapFake({ shapes: [SNAP_LINE], snap: false });
        fake._measureClick([10 + deg(5), 20], [0, 0]);
        expect(fake._measureState?.vertices).toEqual([[10.005, 20]]);
    });
});

describe('lecture d\'un dessin au toucher (retours terrain 2026-10-02, décision 3)', () => {
    const TAP: [number, number] = [120, 80];
    const hit = (id: string): unknown[] => [{ properties: { shapeId: id } }];
    const LINE: PlanShape = { id: 'l1', type: 'line', color: '#ef4444', coords: [[0, 0], [0.1, 0]] };
    const RECT: PlanShape = { id: 'r1', type: 'rectangle', color: '#ef4444', coords: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]] };
    const CIRCLE: PlanShape = { id: 'c1', type: 'circle', color: '#ef4444', center: [5, 5], edge: [5.05, 5], coords: [[5.05, 5], [5, 5.05], [4.95, 5], [5, 4.95], [5.05, 5]] };

    function readFake(shapes: PlanShape[], hits: unknown[], extra: { vertices?: LngLatTuple[]; snap?: boolean; layerHits?: Record<string, unknown[]> } = {}) {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const map = makeMap(extra.layerHits ? { hits, layerHits: extra.layerHits } : { hits });
        const made = makeFakeThis({ shapes, map });
        made.fake._renderMeasureLabels = vi.fn();
        made.fake._measureState = { vertices: extra.vertices ?? [], cursor: null, reticle: false, snap: extra.snap ?? true };
        made.fake._buildMeasureControls();
        const info = (): HTMLElement => {
            const el = document.querySelector<HTMLElement>('#plan_measure_controls [data-measure="info"]');
            if (!el) throw new Error('indicateur absent de la barre');
            return el;
        };
        return { ...made, map, info };
    }

    it('un trait touché, sans ligne en cours : affiche sa longueur et ne pose AUCUN point', () => {
        const { fake, info } = readFake([LINE], hit('l1'));
        fake._measureClick([0.05, 0.0002], TAP);
        expect(info().hidden).toBe(false);
        expect(info().textContent).toBe(shapeMeasureText(LINE));
        expect(info().textContent).toContain('Longueur');
        expect(fake._measureState?.vertices).toEqual([]);
    });

    it('un rectangle touché affiche son périmètre et sa surface', () => {
        const { fake, info } = readFake([RECT], hit('r1'));
        fake._measureClick([0.05, 0.05], TAP);
        expect(info().textContent).toBe(shapeMeasureText(RECT));
        expect(info().textContent).toContain('Périmètre');
        expect(info().textContent).toContain('Surface');
        expect(fake._measureState?.vertices).toEqual([]);
    });

    it('un cercle touché affiche son périmètre et sa surface', () => {
        const { fake, info } = readFake([CIRCLE], hit('c1'));
        fake._measureClick([5.03, 5], TAP);
        expect(info().textContent).toBe(shapeMeasureText(CIRCLE));
        expect(info().textContent).toContain('Surface');
        expect(fake._measureState?.vertices).toEqual([]);
    });

    it('interroge la seule zone de touche du contour (jamais le remplissage) au point touché', () => {
        const { fake, map } = readFake([LINE], hit('l1'));
        fake._measureClick([0.05, 0], TAP);
        expect(map.queryRenderedFeatures).toHaveBeenCalledWith(TAP, { layers: ['plan-shapes-line-hit'] });
    });

    it('un toucher À L\'INTÉRIEUR d\'un rectangle ou d\'un cercle (remplissage seul, hors contour) démarre une ligne', () => {
        // Décision 1 : « le toucher suivant démarre une NOUVELLE ligne depuis n'importe quel point ».
        // Le remplissage couvre tout l'intérieur d'une zone dessinée (bouclage, périmètre) : s'il valait
        // lecture, on ne pourrait plus y poser de point, ni au toucher ni à la souris.
        const { fake, info } = readFake([RECT, CIRCLE], [], { layerHits: { 'plan-shapes-fill': [...hit('r1'), ...hit('c1')] } });
        fake._measureClick([0.05, 0.05], TAP);
        expect(fake._measureState?.vertices).toEqual([[0.05, 0.05]]);
        expect(info().hidden).toBe(true);
    });

    it('le même rectangle touché SUR son contour se lit toujours (zone de touche du trait)', () => {
        const { fake, info } = readFake([RECT], [], { layerHits: { 'plan-shapes-fill': hit('r1'), 'plan-shapes-line-hit': hit('r1') } });
        fake._measureClick([0.05, 0.0002], TAP);
        expect(info().textContent).toBe(shapeMeasureText(RECT));
        expect(fake._measureState?.vertices).toEqual([]);
    });

    describe('tracé à main levée (un point tous les 4 px, draw-tools.ts)', () => {
        const FREEHAND: PlanShape = { id: 'lf', type: 'line', color: '#ef4444', coords: Array.from({ length: 51 }, (_, i): LngLatTuple => [deg(4 * i), 0]) };

        it('touché en son milieu, aimant actif : se lit (ses points intermédiaires n\'accrochent pas)', () => {
            // S'ils accrochaient (18 px), le moindre toucher sur le trait démarrerait une ligne
            // et sa longueur ne se lirait qu'aimant coupé : la décision 3 serait lettre morte.
            const { fake, info } = readFake([FREEHAND], hit('lf'));
            fake._measureClick([deg(101), 0], TAP);
            expect(info().textContent).toBe(shapeMeasureText(FREEHAND));
            expect(info().textContent).toContain('Longueur');
            expect(fake._measureState?.vertices).toEqual([]);
        });

        it('ses deux extrémités accrochent toujours : la ligne démarre à son bout', () => {
            const { fake } = readFake([FREEHAND], hit('lf'));
            fake._measureClick([deg(200 + 3), 0], TAP);
            fake._measureClick([deg(-3), 0], TAP);
            expect(fake._measureState?.vertices).toEqual([[deg(200), 0], [0, 0]]);
        });
    });

    it('avec une ligne en cours, le toucher pose un sommet : aucune lecture', () => {
        const { fake, info } = readFake([LINE], hit('l1'), { vertices: [[0.2, 0.2]] });
        fake._measureClick([0.05, 0.0002], TAP);
        expect(fake._measureState?.vertices).toEqual([[0.2, 0.2], [0.05, 0.0002]]);
        expect(info().hidden).toBe(true);
    });

    it('l\'aimant prime : près d\'un sommet du dessin, le toucher démarre la ligne à ce sommet', () => {
        const { fake, info } = readFake([LINE], hit('l1'));
        fake._measureClick([deg(5), 0], TAP);
        expect(fake._measureState?.vertices).toEqual([[0, 0]]);
        expect(info().hidden).toBe(true);
    });

    it('aimant coupé : le même toucher près d\'un sommet lit le dessin', () => {
        const { fake, info } = readFake([LINE], hit('l1'), { snap: false });
        fake._measureClick([deg(5), 0], TAP);
        expect(info().textContent).toBe(shapeMeasureText(LINE));
        expect(fake._measureState?.vertices).toEqual([]);
    });

    it('une mesure posée ou un anneau (aucun shapeId) ne se lit pas : le toucher pose un sommet', () => {
        const { fake, info } = readFake([SNAP_MEASURE, SNAP_RINGS], [{ properties: {} }, { properties: null }]);
        fake._measureClick([0.5, 0.5], TAP);
        expect(fake._measureState?.vertices).toEqual([[0.5, 0.5]]);
        expect(info().hidden).toBe(true);
    });

    it('un texte ne se lit pas : le toucher pose un sommet', () => {
        const { fake } = readFake([SNAP_TEXT], hit('t1'));
        fake._measureClick([0.5, 0.5], TAP);
        expect(fake._measureState?.vertices).toEqual([[0.5, 0.5]]);
    });

    it('une forme absente du stockage (relecture distante en cours) : le toucher pose un sommet', () => {
        const { fake } = readFake([LINE], hit('fantome'));
        fake._measureClick([0.5, 0.5], TAP);
        expect(fake._measureState?.vertices).toEqual([[0.5, 0.5]]);
    });

    it('la première forme lisible sous le doigt gagne (un anneau sans id ne la masque pas)', () => {
        const { fake, info } = readFake([LINE], [{ properties: {} }, ...hit('l1')]);
        fake._measureClick([0.05, 0.0002], TAP);
        expect(info().textContent).toBe(shapeMeasureText(LINE));
    });

    it('« Valider la ligne » efface une lecture restée affichée', () => {
        const { fake, info } = readFake([LINE], hit('l1'));
        fake._measureClick([0.05, 0.0002], TAP);
        expect(info().hidden).toBe(false);
        fake._finishMeasure();
        expect(info().hidden).toBe(true);
        expect(info().textContent).toBe('');
    });

    it('le point suivant efface la lecture', () => {
        const { fake, map, info } = readFake([LINE], hit('l1'));
        fake._measureClick([0.05, 0.0002], TAP);
        expect(info().hidden).toBe(false);
        map.queryRenderedFeatures.mockImplementation((): unknown[] => []);
        fake._measureClick([0.5, 0.5], TAP);
        expect(info().hidden).toBe(true);
        expect(fake._measureState?.vertices).toEqual([[0.5, 0.5]]);
    });

    it('une carte dont le style n\'est pas chargé (queryRenderedFeatures jette) retombe sur la pose d\'un sommet', () => {
        const { fake, map } = readFake([LINE], hit('l1'));
        map.queryRenderedFeatures.mockImplementation(() => { throw new Error('Style is not done loading'); });
        expect(() => fake._measureClick([0.5, 0.5], TAP)).not.toThrow();
        expect(fake._measureState?.vertices).toEqual([[0.5, 0.5]]);
    });

    it('sans mesure en cours ni barre : ne jette pas', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._measureClick([0, 0], TAP)).not.toThrow();
        expect(() => fake._measureShowInfo('x')).not.toThrow();
    });
});

describe('double-clic : le 2e clic ne pose pas de sommet (retours terrain 2026-10-02, décision 1)', () => {
    // MapLibre envoie click, click, dblclick : `_measureClick` voit deux clics à quelques pixels
    // l'un de l'autre, puis map-core.ts valide la ligne (`_finishMeasure`) sur le dblclick.
    const TAP: [number, number] = [0, 0];

    it('sur un point vide, sans ligne en cours : aucune ligne de ~0 m n\'est persistée (ni entrée d\'historique)', () => {
        const { fake, mocks, shapes } = snapFake();
        fake._measureClick([2, 3], TAP);
        fake._measureClick([2 + deg(1), 3 - deg(1)], TAP);
        expect(fake._measureState?.vertices).toEqual([[2, 3]]);
        fake._finishMeasure();
        expect(mocks.pushHistory).not.toHaveBeenCalled();
        expect(mocks.saveShapes).not.toHaveBeenCalled();
        expect(shapes()).toEqual([]);
        expect(fake._measureState?.vertices).toEqual([]);
        expect(mocks.setTool).not.toHaveBeenCalled();
    });

    it('au bout d\'une ligne en cours : elle est validée SANS dernier tronçon de ~0 m', () => {
        const { fake, mocks, shapes } = snapFake();
        fake._measureClick([2, 3], TAP);
        fake._measureClick([2.1, 3], TAP);
        fake._measureClick([2.1, 3.1], TAP);
        fake._measureClick([2.1 + deg(2), 3.1], TAP);
        fake._finishMeasure();
        expect(shapes()[0]?.coords).toEqual([[2, 3], [2.1, 3], [2.1, 3.1]]);
        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
    });

    it('un point posé à MEASURE_DUP_PX ou plus du précédent est un vrai sommet', () => {
        expect(MEASURE_DUP_PX).toBeLessThan(MEASURE_SNAP_PX);
        const { fake } = snapFake();
        fake._measureAddVertex([0, 0]);
        fake._measureAddVertex([deg(MEASURE_DUP_PX - 1), 0]);
        expect(fake._measureState?.vertices).toHaveLength(1);
        fake._measureAddVertex([deg(MEASURE_DUP_PX + 1), 0]);
        expect(fake._measureState?.vertices).toHaveLength(2);
    });

    it('le bouton « Point » du réticule est concerné aussi : la carte à quelques pixels du dernier sommet n\'en pose pas un second', () => {
        const { fake } = snapFake({ center: [deg(3), 0], reticle: true });
        fake._measureAddVertex([0, 0]);
        fake._measureAddVertex(fake._measureReticlePoint());
        expect(fake._measureState?.vertices).toEqual([[0, 0]]);
    });

    it('la proximité se juge au moment de la POSE : un dézoom avant « Valider la ligne » ne fait perdre aucun sommet', () => {
        const { fake, shapes } = snapFake();
        fake._measureAddVertex([0, 0]);
        fake._measureAddVertex([0.05, 0]);   // 50 px à ce zoom : un vrai tronçon
        const map = fake.map as unknown as ReturnType<typeof makeMap>;
        map.project.mockImplementation((ll: { lng: number; lat: number }) => ({ x: ll.lng * 10, y: ll.lat * 10 }));   // zoom arrière : 0,5 px
        fake._finishMeasure();
        expect(shapes()[0]?.coords).toEqual([[0, 0], [0.05, 0]]);
    });

    it('sans carte, seul le doublon exact est écarté (rien à projeter)', () => {
        const { fake } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        fake._measureAddVertex([2, 3]);
        fake._measureAddVertex([2 + deg(1), 3]);
        expect(fake._measureState.vertices).toHaveLength(2);
    });
});

describe('barre de mesure — « Valider la ligne » et « Aimant » (retours terrain 2026-10-02)', () => {
    const btn = (key: string): HTMLButtonElement => {
        const el = document.querySelector<HTMLButtonElement>(`#plan_measure_controls button[data-measure="${key}"]`);
        if (!el) throw new Error(`bouton ${key} absent de la barre`);
        return el;
    };

    function barFake() {
        document.body.innerHTML = '<div><div id="plan_map"></div></div>';
        const made = makeFakeThis({ map: makeMap() });
        made.fake._renderMeasureLabels = vi.fn();
        made.fake._measureState = { vertices: [], cursor: null, reticle: false, snap: true };
        made.fake._buildMeasureControls();
        return made;
    }

    it('« Valider la ligne » et « Annuler dernier » n\'apparaissent qu\'avec une ligne en cours', () => {
        const { fake } = barFake();
        expect(btn('finish').style.display).toBe('none');
        expect(btn('finish').textContent).toContain('Valider la ligne');
        fake._measureAddVertex([1, 1]);
        expect(btn('finish').style.display).toBe('inline-flex');
        fake._measureUndoVertex();
        expect(btn('finish').style.display).toBe('none');
    });

    it('« Valider la ligne » fige la ligne : persistée, outil actif, bouton masqué', () => {
        const { fake, mocks, shapes } = barFake();
        fake._measureAddVertex([1, 1]);
        fake._measureAddVertex([1.1, 1]);
        btn('finish').click();
        expect(shapes()).toHaveLength(1);
        expect(mocks.pushHistory).toHaveBeenCalledTimes(1);
        expect(mocks.setTool).not.toHaveBeenCalled();
        expect(fake._measureState?.vertices).toEqual([]);
        expect(btn('finish').style.display).toBe('none');
    });

    it('« Annuler dernier » ne retire que le dernier point de la ligne en cours (jamais une ligne figée)', () => {
        const { fake, shapes } = barFake();
        fake._measureAddVertex([1, 1]);
        fake._measureAddVertex([1.1, 1]);
        fake._finishMeasure();
        fake._measureAddVertex([2, 2]);
        fake._measureAddVertex([2.1, 2]);
        btn('undo').click();
        expect(fake._measureState?.vertices).toEqual([[2, 2]]);
        expect(shapes()).toHaveLength(1);
        btn('undo').click();
        expect(fake._measureState?.vertices).toEqual([]);
        expect(shapes()).toHaveLength(1);
    });

    it('« Aimant » démarre actif (aria-pressed) et bascule l\'aimant à chaque appui', () => {
        const { fake } = barFake();
        expect(btn('snap').getAttribute('aria-pressed')).toBe('true');
        expect(btn('snap').style.textDecoration).toBe('none');
        btn('snap').click();
        expect(fake._measureState?.snap).toBe(false);
        expect(btn('snap').getAttribute('aria-pressed')).toBe('false');
        // Coupé : barré, pas seulement grisé (plein soleil, gants), et le titre le dit.
        expect(btn('snap').style.textDecoration).toBe('line-through');
        expect(btn('snap').title).toContain('coupé');
        btn('snap').click();
        expect(fake._measureState?.snap).toBe(true);
        expect(btn('snap').getAttribute('aria-pressed')).toBe('true');
        expect(btn('snap').style.textDecoration).toBe('none');
        expect(btn('snap').title).toContain('actif');
    });

    it('« Aimant » ne ferme pas la barre ni ne pose de point', () => {
        const { fake, mocks } = barFake();
        btn('snap').click();
        expect(fake._measureState?.vertices).toEqual([]);
        expect(mocks.setTool).not.toHaveBeenCalled();
        expect(document.getElementById('plan_measure_controls')).not.toBeNull();
    });

    it('l\'indicateur de lecture est masqué à l\'ouverture et annoncé aux lecteurs d\'écran', () => {
        barFake();
        const info = document.querySelector<HTMLElement>('#plan_measure_controls [data-measure="info"]');
        expect(info?.hidden).toBe(true);
        expect(info?.getAttribute('role')).toBe('status');
    });

    it('_measureShowInfo affiche puis masque la lecture', () => {
        const { fake } = barFake();
        fake._measureShowInfo('Longueur : 12 m');
        const info = document.querySelector<HTMLElement>('#plan_measure_controls [data-measure="info"]');
        expect(info?.hidden).toBe(false);
        expect(info?.textContent).toBe('Longueur : 12 m');
        fake._measureShowInfo('');
        expect(info?.hidden).toBe(true);
    });
});

describe('dessins inertes pendant la mesure (retours terrain 2026-10-02, décision 4)', () => {
    it('démarrer la mesure désélectionne la forme (poignées, roue, pincement) pour qu\'aucune ne reste active', () => {
        const { fake, mocks } = makeFakeThis();
        fake._selectedShapeId = 's1';
        fake._startMeasure(false);
        expect(mocks.deselectShape).toHaveBeenCalledTimes(1);
    });

    // Le cadenas d'une forme verrouillée est un marqueur DOM au-dessus de la carte : il capterait le
    // toucher. `_renderShapeLocks` (shapes-render.ts) le rend inerte tant que `_measureState` existe ;
    // encore faut-il le rafraîchir à l'entrée et à la sortie, l'état ayant alors déjà changé.
    it('démarrer la mesure rafraîchit les cadenas des formes APRÈS avoir posé l\'état (ils laissent passer le toucher)', () => {
        const { fake, mocks } = makeFakeThis();
        const seen: boolean[] = [];
        mocks.renderShapeLocks.mockImplementation(() => { seen.push(fake._measureState !== null); });
        fake._startMeasure(false);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.at(-1)).toBe(true);
    });

    it('quitter la mesure rafraîchit les cadenas APRÈS avoir vidé l\'état (ils reprennent le toucher)', () => {
        const { fake, mocks } = makeFakeThis();
        fake._measureState = { vertices: [], cursor: null, reticle: false };
        const seen: boolean[] = [];
        mocks.renderShapeLocks.mockImplementation(() => { seen.push(fake._measureState !== null); });
        fake._cancelMeasure();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.at(-1)).toBe(false);
    });
});
