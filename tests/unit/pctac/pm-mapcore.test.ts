/**
 * pm-mapcore.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-mapcore` :
 * `planmap/map-core.ts` (15 méthodes, table §4.3 de docs/SPEC-PLANMAP-SPLIT.md :
 * cycle de vie carte, vue persistée, 3D/relief, overlay noms de rues, pré-cache
 * France). Références `planMap.js:<ligne>` en commentaire.
 *
 * `this` FACTICE (jamais `new maplibregl.Map`, WebGL absent sous jsdom —
 * SPEC-PCTAC-CONVERSION §8.4) : `makeFakeMap()` fournit un faux `map` ne
 * portant que la surface réellement appelée par map-core.ts (`on`, `once`,
 * `off`, `stop`, `jumpTo`, `setTerrain`, `setSky`, `getLayer`,
 * `setLayoutProperty`, `getSource`, `addLayer`, `getCenter`, `getZoom`,
 * `getPitch`, `getBearing`, `resize`), tous en `vi.fn()`. `makeFakeThis()`
 * combine cet état avec des stubs `vi.fn()` pour les méthodes des AUTRES
 * paquets (chrome.ts, pins.ts, draw-layers.ts, draw-tools.ts, measure.ts,
 * shapes-render.ts, text-modal.ts) — seules les méthodes RÉELLEMENT sous test
 * ici viennent de `MapCoreMethods`.
 *
 * `./tiles.js` est mocké (`prefetchFranceTiles`) pour isoler `_initOfflineCache`
 * (la logique de tuiles elle-même est déjà couverte par pm-geo.test.ts).
 *
 * Couverture MANDATÉE par la mission (5 scénarios) :
 *  1. `_loadView` sur JSON corrompu ⇒ défaut Paris [2.3522, 48.8566] zoom 5.
 *  2. `_saveView` écrit bien VIEW_KEY (center/zoom/pitch/bearing/is3D).
 *  3. `_initOfflineCache` ne pose le flag `pcTacFranceTilesCached` que si
 *     `fail === 0` (mock `prefetchFranceTiles` dans les deux sens).
 *  4. `_pinCamera` (invariant SPEC-PLANMAP-SPLIT §5.6) déclenche EXACTEMENT
 *     7 recadrages aux délais [0,120,280,500,850,1300,1900] (`vi.useFakeTimers`)
 *     et un second appel annule le premier.
 *  5. `_toggleStreetLabels` bascule la clé 'pcTacStreetLabels'.
 * (+ un socle de tests de fumée sur les 10 autres méthodes : ne jettent pas
 * quand le DOM/la carte attendus sont absents ou minimalement fournis.)
 *
 * §6 (HORS planMap.js) — overlays LiDAR HD (IGN/Géoplateforme) : les 5 méthodes
 * `_applyLidarVisibility` / `_setLidarLayer` / `_cycleLidarLayer` / `_initLidar`
 * / `_updateLidarBtn`, ajoutées à map-core.ts. Le point sensible couvert ici est
 * l'EXCLUSIVITÉ (une seule des 3 couches visible) et le cyclage bouclant sur
 * « aucun ».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pctac/planmap/tiles.js', () => ({
    prefetchFranceTiles: vi.fn(),
}));

// R2-T2a : `alert()` → `toast(..., { kind: 'error' })` (`_enable3D`).
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ toast: toastSpy }));

import { LIDAR_KEY, VIEW_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { MapCoreMethods } from '../../../src/apps/pctac/planmap/map-core.js';
import { prefetchFranceTiles } from '../../../src/apps/pctac/planmap/tiles.js';
import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';
import type { LngLat } from 'maplibre-gl';

const prefetchFranceTilesMock = vi.mocked(prefetchFranceTiles);

// ---------------------------------------------------------------------------
// Fabriques de `map`/`this` factices
// ---------------------------------------------------------------------------

/** Sous-ensemble RÉELLEMENT appelé de `maplibregl.Map` par map-core.ts. */
function makeFakeMap(overrides: Record<string, unknown> = {}) {
    return {
        getCenter: vi.fn(() => ({ lng: 2.3522, lat: 48.8566 })),
        getZoom: vi.fn(() => 5),
        getPitch: vi.fn(() => 0),
        getBearing: vi.fn(() => 0),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        stop: vi.fn(),
        jumpTo: vi.fn(),
        setTerrain: vi.fn(),
        setSky: vi.fn(),
        getLayer: vi.fn(),
        setLayoutProperty: vi.fn(),
        getSource: vi.fn(),
        addLayer: vi.fn(),
        resize: vi.fn(),
        ...overrides,
    };
}

/** `this` factice — cast `unknown` car `PlanMapInternal` (159 méthodes) ne
 * "chevauche" pas suffisamment un littéral partiel pour un `as` direct (même
 * procédé que pm-capture.test.ts / pm-drawlayers.test.ts). Seules les 15
 * méthodes de `MapCoreMethods` (le groupe sous test) sont RÉELLES si
 * explicitement passées en `overrides` ; les collaborateurs des AUTRES
 * paquets sont des stubs `vi.fn()` neutres. */
function makeFakeThis(overrides: Record<string, unknown> = {}): PlanMapInternal {
    return {
        map: null,
        initialized: false,
        is3D: false,
        streetLabelsOn: false,
        lidarLayer: null,
        _locked: false,
        _pinCancel: null,
        drawTool: null,
        _measureState: null,

        // Enveloppe `_safe` neutre : n'attrape rien, retourne `fn` telle quelle
        // (même procédé que pm-drawlayers.test.ts / pm-chrome.test.ts).
        _safe: vi.fn((fn: (...a: never[]) => unknown) => fn),

        // Collaborateurs des AUTRES paquets, appelés depuis `init()` — stubs
        // neutres : ce fichier teste map-core.ts, pas leur contenu.
        _onMapClick: vi.fn(),
        _handleDrawDown: vi.fn(),
        _handleDrawMove: vi.fn(),
        _handleDrawUp: vi.fn(),
        _finishMeasure: vi.fn(),
        _bindUi: vi.fn(),
        _initDrawingLayers: vi.fn(),
        _bindDrawUi: vi.fn(),
        _bindTextModalOnce: vi.fn(),
        _renderShapes: vi.fn(),
        _renderShapeTexts: vi.fn(),
        _renderPins: vi.fn(),

        // Méthodes de map-core.ts elles-mêmes : par défaut des stubs (pour
        // isoler la méthode sous test des autres), écrasés par `overrides`
        // avec l'implémentation RÉELLE quand le test exerce l'intégration.
        // Pure/sans effet de bord : l'implémentation RÉELLE sert de défaut, les
        // autres méthodes de map-core.ts sous test l'appellent (`_ensureStreetLabelLayers`).
        _streetLabelPaint: MapCoreMethods._streetLabelPaint,
        _ensureStreetLabelLayers: vi.fn(),
        _applyStreetLabelsVisibility: vi.fn(),
        _updateStreetLabelsBtn: vi.fn(),
        _saveView: vi.fn(),
        _loadView: vi.fn(() => ({ center: [2.3522, 48.8566], zoom: 5 })),
        _enable3D: vi.fn(),
        _disable3D: vi.fn(),
        _pinCamera: vi.fn(),
        _initOfflineCache: vi.fn(),

        // Overlays LiDAR HD (hors planMap.js) — mêmes conventions que ci-dessus.
        _applyLidarVisibility: vi.fn(),
        _setLidarLayer: vi.fn(),
        _updateLidarBtn: vi.fn(),
        _initLidar: vi.fn(),

        ...overrides,
    } as unknown as PlanMapInternal;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. _loadView (planMap.js:451-457)
// ---------------------------------------------------------------------------

describe('_loadView (planMap.js:451-457)', () => {
    it('retourne la vue persistée quand le JSON est valide', () => {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [3.05, 45.76], zoom: 12, pitch: 10, bearing: 20, is3D: true }));
        const fake = makeFakeThis();
        const v = MapCoreMethods._loadView.call(fake);
        expect(v).toEqual({ center: [3.05, 45.76], zoom: 12, pitch: 10, bearing: 20, is3D: true });
    });

    it('JSON corrompu ⇒ défaut Paris [2.3522, 48.8566] zoom 5', () => {
        localStorage.setItem(VIEW_KEY, '{ ceci n\'est pas du JSON valide');
        const fake = makeFakeThis();
        const v = MapCoreMethods._loadView.call(fake);
        expect(v).toEqual({ center: [2.3522, 48.8566], zoom: 5 });
    });

    it('clé absente (localStorage.getItem → null) ⇒ défaut Paris zoom 5, ne jette pas', () => {
        localStorage.removeItem(VIEW_KEY);
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._loadView.call(fake)).not.toThrow();
        expect(MapCoreMethods._loadView.call(fake)).toEqual({ center: [2.3522, 48.8566], zoom: 5 });
    });

    it('objet JSON valide mais sans `center` ⇒ défaut Paris zoom 5', () => {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ zoom: 8 }));
        const fake = makeFakeThis();
        const v = MapCoreMethods._loadView.call(fake);
        expect(v).toEqual({ center: [2.3522, 48.8566], zoom: 5 });
    });

    it('`center` non tableau ⇒ défaut Paris zoom 5', () => {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ center: 'pas-un-tableau', zoom: 8 }));
        const fake = makeFakeThis();
        const v = MapCoreMethods._loadView.call(fake);
        expect(v).toEqual({ center: [2.3522, 48.8566], zoom: 5 });
    });
});

// ---------------------------------------------------------------------------
// 2. _saveView (planMap.js:459-469)
// ---------------------------------------------------------------------------

describe('_saveView (planMap.js:459-469)', () => {
    it('écrit VIEW_KEY avec center/zoom/pitch/bearing/is3D', () => {
        const map = makeFakeMap({
            getCenter: vi.fn(() => ({ lng: 3.05, lat: 45.76 })),
            getZoom: vi.fn(() => 14),
            getPitch: vi.fn(() => 55),
            getBearing: vi.fn(() => 30),
        });
        const fake = makeFakeThis({ map, is3D: true });

        MapCoreMethods._saveView.call(fake);

        const raw = localStorage.getItem(VIEW_KEY) ?? '';
        expect(JSON.parse(raw)).toEqual({ center: [3.05, 45.76], zoom: 14, pitch: 55, bearing: 30, is3D: true });
    });

    it('is3D=false persisté tel quel (pas de valeur par défaut qui l\'écraserait)', () => {
        const map = makeFakeMap();
        const fake = makeFakeThis({ map, is3D: false });

        MapCoreMethods._saveView.call(fake);

        const raw = localStorage.getItem(VIEW_KEY) ?? '';
        expect(JSON.parse(raw).is3D).toBe(false);
    });

    it('map absente ⇒ no-op (ne jette pas, n\'écrit rien)', () => {
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._saveView.call(fake)).not.toThrow();
        expect(localStorage.getItem(VIEW_KEY)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 3. _initOfflineCache (planMap.js:424-438) — piège #4 : flag posé UNIQUEMENT
//    si `fail === 0` (planMap.js:432-433)
// ---------------------------------------------------------------------------

describe('_initOfflineCache (planMap.js:424-438)', () => {
    beforeEach(() => {
        // `vi.restoreAllMocks()` (afterEach global) ne vide pas l'historique
        // d'appels d'un `vi.fn()` créé par une factory `vi.mock(...)` — réinitialisé
        // explicitement pour que chaque test reparte d'un mock vierge.
        prefetchFranceTilesMock.mockReset();
        vi.stubGlobal('navigator', { onLine: true });
        vi.stubGlobal('caches', {} as CacheStorage);
    });

    it('fail === 0 ⇒ pose le flag pcTacFranceTilesCached à \'1\'', async () => {
        prefetchFranceTilesMock.mockResolvedValue({ total: 10, ok: 10, fail: 0, aborted: false });
        const fake = makeFakeThis();

        MapCoreMethods._initOfflineCache.call(fake);

        await vi.waitFor(() => {
            expect(localStorage.getItem('pcTacFranceTilesCached')).toBe('1');
        });
        expect(prefetchFranceTilesMock).toHaveBeenCalledWith(0, 8);
    });

    it('fail > 0 ⇒ NE pose PAS le flag (retentera au prochain lancement)', async () => {
        prefetchFranceTilesMock.mockResolvedValue({ total: 10, ok: 7, fail: 3, aborted: false });
        const fake = makeFakeThis();

        MapCoreMethods._initOfflineCache.call(fake);

        await vi.waitFor(() => {
            expect(prefetchFranceTilesMock).toHaveBeenCalled();
        });
        expect(localStorage.getItem('pcTacFranceTilesCached')).toBeNull();
    });

    it('flag déjà posé ⇒ ne relance pas prefetchFranceTiles', () => {
        localStorage.setItem('pcTacFranceTilesCached', '1');
        const fake = makeFakeThis();

        MapCoreMethods._initOfflineCache.call(fake);

        expect(prefetchFranceTilesMock).not.toHaveBeenCalled();
    });

    it('hors-ligne (navigator.onLine=false) ⇒ ne lance pas le pré-cache', () => {
        vi.stubGlobal('navigator', { onLine: false });
        const fake = makeFakeThis();

        MapCoreMethods._initOfflineCache.call(fake);

        expect(prefetchFranceTilesMock).not.toHaveBeenCalled();
    });

    it('`caches` indisponible ⇒ ne jette pas, ne lance pas le pré-cache', () => {
        vi.stubGlobal('caches', undefined);
        const fake = makeFakeThis();

        expect(() => MapCoreMethods._initOfflineCache.call(fake)).not.toThrow();
        expect(prefetchFranceTilesMock).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// 4. _pinCamera (planMap.js:551-595) — INVARIANT SPEC-PLANMAP-SPLIT §5.6
// ---------------------------------------------------------------------------

describe('_pinCamera (planMap.js:551-595) — invariant §5.6', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('réimpose la cible aux 7 délais [0,120,280,500,850,1300,1900] exactement, quand la caméra dérive', () => {
        // Caméra figée loin de la cible (drift toujours vrai) → chaque `apply`
        // appelle `jumpTo` : le compte de `jumpTo` mesure directement le nombre
        // de recadrages déclenchés par les timers.
        const map = makeFakeMap({
            getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
            getZoom: vi.fn(() => 1),
            getPitch: vi.fn(() => 0),
            getBearing: vi.fn(() => 0),
        });
        const fake = makeFakeThis({ map, is3D: true });
        const target = {
            center: { lng: 2.3522, lat: 48.8566 } as unknown as LngLat,
            zoom: 12,
            bearing: 0,
            pitch: 60,
        };

        MapCoreMethods._pinCamera.call(fake, target);

        const delays = [0, 120, 280, 500, 850, 1300, 1900];
        let elapsed = 0;
        delays.forEach((d, i) => {
            vi.advanceTimersByTime(d - elapsed);
            elapsed = d;
            expect(map.jumpTo).toHaveBeenCalledTimes(i + 1);
        });

        // Au-delà du 7e délai, plus AUCUN recadrage (le désabonnement `idle`
        // à 2400ms coupe tout réimpositionnement ultérieur).
        vi.advanceTimersByTime(10_000);
        expect(map.jumpTo).toHaveBeenCalledTimes(7);
    });

    it('un second appel annule le premier : aucun recadrage résiduel du 1er épinglage', () => {
        const map = makeFakeMap({
            getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
            getZoom: vi.fn(() => 1),
            getPitch: vi.fn(() => 0),
            getBearing: vi.fn(() => 0),
        });
        const fake = makeFakeThis({ map, is3D: true });
        const target1 = { center: { lng: 1, lat: 1 } as unknown as LngLat, zoom: 5, bearing: 0, pitch: 40 };
        const target2 = { center: { lng: 9, lat: 9 } as unknown as LngLat, zoom: 8, bearing: 0, pitch: 50 };

        MapCoreMethods._pinCamera.call(fake, target1);
        // Avant toute avancée d'horloge : le 2e appel doit annuler le 1er via
        // `this._pinCancel` (planMap.js:555) et effacer ses 8 timers en attente
        // (7 réimpositions + le désabonnement idle à 2400ms).
        MapCoreMethods._pinCamera.call(fake, target2);

        vi.advanceTimersByTime(2000);

        // Exactement 7 recadrages au total (ceux du 2e épinglage uniquement) —
        // si le 1er n'avait pas été annulé, on en verrait jusqu'à 14.
        expect(map.jumpTo).toHaveBeenCalledTimes(7);
        for (const call of map.jumpTo.mock.calls) {
            expect(call[0]).toMatchObject({ center: target2.center, zoom: target2.zoom, pitch: target2.pitch });
        }
    });

    it('geste utilisateur (originalEvent présent) sur dragstart ⇒ annule l\'épinglage, plus aucun recadrage', () => {
        const handlers: Record<string, (e: unknown) => void> = {};
        const map = makeFakeMap({
            getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
            on: vi.fn((type: string, cb: (e: unknown) => void) => { handlers[type] = cb; }),
        });
        const fake = makeFakeThis({ map, is3D: true });
        const target = { center: { lng: 5, lat: 5 } as unknown as LngLat, zoom: 10, bearing: 0, pitch: 30 };

        MapCoreMethods._pinCamera.call(fake, target);
        vi.advanceTimersByTime(0); // 1er recadrage (délai 0)
        expect(map.jumpTo).toHaveBeenCalledTimes(1);

        // Simule un VRAI geste utilisateur (originalEvent présent, planMap.js:575).
        handlers['dragstart']?.({ originalEvent: {} });

        vi.advanceTimersByTime(10_000);
        expect(map.jumpTo).toHaveBeenCalledTimes(1); // aucun recadrage après l'annulation
    });

    it('événement dragstart SANS originalEvent (synthétique) ⇒ N\'annule PAS (planMap.js:575)', () => {
        const handlers: Record<string, (e: unknown) => void> = {};
        const map = makeFakeMap({
            getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
            on: vi.fn((type: string, cb: (e: unknown) => void) => { handlers[type] = cb; }),
        });
        const fake = makeFakeThis({ map, is3D: true });
        const target = { center: { lng: 5, lat: 5 } as unknown as LngLat, zoom: 10, bearing: 0, pitch: 30 };

        MapCoreMethods._pinCamera.call(fake, target);
        // Événement sans `originalEvent` (déclenchement programmatique) : ne doit
        // PAS annuler l'épinglage — piège #1 de la mission.
        handlers['dragstart']?.({});

        vi.advanceTimersByTime(10_000);
        expect(map.jumpTo).toHaveBeenCalledTimes(7);
    });

    it('map absente ⇒ no-op (ne jette pas)', () => {
        const fake = makeFakeThis({ map: null });
        const target = { center: { lng: 5, lat: 5 } as unknown as LngLat, zoom: 10, bearing: 0, pitch: 30 };
        expect(() => MapCoreMethods._pinCamera.call(fake, target)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// 5. _toggleStreetLabels (planMap.js:675-681)
// ---------------------------------------------------------------------------

describe('_toggleStreetLabels (planMap.js:675-681)', () => {
    it('bascule pcTacStreetLabels + this.streetLabelsOn (false → true), construit les couches', () => {
        const ensure = vi.fn();
        const applyVis = vi.fn();
        const fake = makeFakeThis({
            map: makeFakeMap(),
            streetLabelsOn: false,
            _ensureStreetLabelLayers: ensure,
            _applyStreetLabelsVisibility: applyVis,
        });

        MapCoreMethods._toggleStreetLabels.call(fake);

        expect(fake.streetLabelsOn).toBe(true);
        expect(ensure).toHaveBeenCalledTimes(1);
        expect(applyVis).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('pcTacStreetLabels')).toBe('1');
    });

    it('bascule (true → false), NE reconstruit PAS les couches (déjà en place)', () => {
        const ensure = vi.fn();
        const applyVis = vi.fn();
        const fake = makeFakeThis({
            map: makeFakeMap(),
            streetLabelsOn: true,
            _ensureStreetLabelLayers: ensure,
            _applyStreetLabelsVisibility: applyVis,
        });

        MapCoreMethods._toggleStreetLabels.call(fake);

        expect(fake.streetLabelsOn).toBe(false);
        expect(ensure).not.toHaveBeenCalled();
        expect(applyVis).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('pcTacStreetLabels')).toBe('0');
    });

    it('rebascule deux fois de suite ⇒ revient à l\'état initial et à la dernière valeur écrite', () => {
        const fake = makeFakeThis({ map: makeFakeMap(), streetLabelsOn: false });

        MapCoreMethods._toggleStreetLabels.call(fake);
        expect(fake.streetLabelsOn).toBe(true);
        MapCoreMethods._toggleStreetLabels.call(fake);
        expect(fake.streetLabelsOn).toBe(false);

        expect(localStorage.getItem('pcTacStreetLabels')).toBe('0');
    });

    it('map absente ⇒ no-op (ne jette pas, ne bascule rien, n\'écrit rien)', () => {
        const ensure = vi.fn();
        const fake = makeFakeThis({ map: null, streetLabelsOn: false, _ensureStreetLabelLayers: ensure });

        expect(() => MapCoreMethods._toggleStreetLabels.call(fake)).not.toThrow();

        expect(fake.streetLabelsOn).toBe(false);
        expect(ensure).not.toHaveBeenCalled();
        expect(localStorage.getItem('pcTacStreetLabels')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Fumée — les 10 méthodes restantes ne jettent pas (DOM/carte minimaux ou absents)
// ---------------------------------------------------------------------------

describe('smoke — méthodes restantes de map-core.ts', () => {
    it('init() sans #plan_map dans le DOM ⇒ retourne sans jeter, reste non initialisé', () => {
        document.body.innerHTML = '';
        const fake = makeFakeThis();
        expect(() => MapCoreMethods.init.call(fake)).not.toThrow();
        expect(fake.initialized).toBe(false);
    });

    it('init() déjà initialisé ⇒ sort immédiatement (idempotent)', () => {
        const fake = makeFakeThis({ initialized: true });
        expect(() => MapCoreMethods.init.call(fake)).not.toThrow();
    });

    it('refresh() non initialisé ⇒ délègue à init()', () => {
        const init = vi.fn();
        const renderPins = vi.fn();
        const fake = makeFakeThis({ initialized: false, init, _renderPins: renderPins });
        MapCoreMethods.refresh.call(fake);
        expect(init).toHaveBeenCalledTimes(1);
        expect(renderPins).not.toHaveBeenCalled();
    });

    it('refresh() initialisé ⇒ resize (différé) + re-rendu des pings immédiat', () => {
        vi.useFakeTimers();
        const map = makeFakeMap();
        const renderPins = vi.fn();
        const fake = makeFakeThis({ initialized: true, map, _renderPins: renderPins });

        MapCoreMethods.refresh.call(fake);
        expect(renderPins).toHaveBeenCalledTimes(1);
        expect(map.resize).not.toHaveBeenCalled();

        vi.advanceTimersByTime(50);
        expect(map.resize).toHaveBeenCalledTimes(1);
    });

    it('_toggle3D() délègue à _enable3D/_disable3D selon this.is3D', () => {
        const enable3D = vi.fn();
        const disable3D = vi.fn();
        const fakeOff = makeFakeThis({ is3D: false, _enable3D: enable3D, _disable3D: disable3D });
        MapCoreMethods._toggle3D.call(fakeOff);
        expect(enable3D).toHaveBeenCalledWith(true);
        expect(disable3D).not.toHaveBeenCalled();

        const fakeOn = makeFakeThis({ is3D: true, _enable3D: enable3D, _disable3D: disable3D });
        MapCoreMethods._toggle3D.call(fakeOn);
        expect(disable3D).toHaveBeenCalledTimes(1);
    });

    it('_enable3D() sans carte ⇒ no-op', () => {
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._enable3D.call(fake)).not.toThrow();
        expect(fake.is3D).toBe(false);
    });

    it('_enable3D() avec carte factice : pose le terrain, active is3D, épingle la caméra', () => {
        const pinCamera = vi.fn();
        const saveView = vi.fn();
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map, is3D: false, _pinCamera: pinCamera, _saveView: saveView });

        MapCoreMethods._enable3D.call(fake, true);

        expect(map.setTerrain).toHaveBeenCalledWith({ source: 'terrain-dem', exaggeration: 1.4 });
        expect(fake.is3D).toBe(true);
        expect(pinCamera).toHaveBeenCalledTimes(1);
        expect(saveView).toHaveBeenCalledTimes(1);
        // couche buildings-3d absente au boot ⇒ re-tente à l'idle (planMap.js:524-528)
        expect(map.once).toHaveBeenCalledWith('idle', expect.any(Function));
    });

    it('_enable3D() : setTerrain qui jette ⇒ toast d\'erreur (R2-T2a, ex-alert()) et sort sans activer is3D', () => {
        const map = makeFakeMap({ setTerrain: vi.fn(() => { throw new Error('DEM indisponible'); }) });
        const fake = makeFakeThis({ map, is3D: false });

        expect(() => MapCoreMethods._enable3D.call(fake)).not.toThrow();
        expect(fake.is3D).toBe(false);
    });

    it('_disable3D() sans carte ⇒ no-op', () => {
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._disable3D.call(fake)).not.toThrow();
    });

    it('_disable3D() avec carte factice : retire le terrain, désactive is3D, aplatit la vue', () => {
        const saveView = vi.fn();
        const map = makeFakeMap({ getLayer: vi.fn(() => ({})) });
        const fake = makeFakeThis({ map, is3D: true, _saveView: saveView });

        MapCoreMethods._disable3D.call(fake);

        expect(map.setTerrain).toHaveBeenCalledWith(null);
        expect(map.setLayoutProperty).toHaveBeenCalledWith('buildings-3d', 'visibility', 'none');
        expect(fake.is3D).toBe(false);
        expect(map.jumpTo).toHaveBeenCalledTimes(1);
        expect(saveView).toHaveBeenCalledTimes(1);
    });

    it('_streetLabelPaint() renvoie les 3 propriétés de peinture attendues', () => {
        const fake = makeFakeThis();
        expect(MapCoreMethods._streetLabelPaint.call(fake)).toEqual({
            'text-color': '#ffe14d',
            'text-halo-color': '#0a0c10',
            'text-halo-width': 1.6,
        });
    });

    it('_ensureStreetLabelLayers() sans carte ⇒ retourne true (rien à construire)', () => {
        const fake = makeFakeThis({ map: null });
        expect(MapCoreMethods._ensureStreetLabelLayers.call(fake)).toBe(true);
    });

    it('_ensureStreetLabelLayers() source openfreemap absente ⇒ diffère à l\'idle, retourne false', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined), getSource: vi.fn(() => undefined) });
        const fake = makeFakeThis({ map });
        expect(MapCoreMethods._ensureStreetLabelLayers.call(fake)).toBe(false);
        expect(map.once).toHaveBeenCalledWith('idle', expect.any(Function));
    });

    it('_ensureStreetLabelLayers() source prête ⇒ ajoute 2 couches, retourne true', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => undefined), getSource: vi.fn(() => ({})) });
        const fake = makeFakeThis({ map });
        expect(MapCoreMethods._ensureStreetLabelLayers.call(fake)).toBe(true);
        expect(map.addLayer).toHaveBeenCalledTimes(2);
    });

    it('_applyStreetLabelsVisibility() sans carte ⇒ no-op (adaptation TS, jamais atteint en pratique)', () => {
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._applyStreetLabelsVisibility.call(fake)).not.toThrow();
    });

    it('_applyStreetLabelsVisibility() applique la visibilité aux 2 couches présentes', () => {
        const updateBtn = vi.fn();
        const map = makeFakeMap({ getLayer: vi.fn(() => ({})) });
        const fake = makeFakeThis({ map, streetLabelsOn: true, _updateStreetLabelsBtn: updateBtn });

        MapCoreMethods._applyStreetLabelsVisibility.call(fake);

        expect(map.setLayoutProperty).toHaveBeenCalledWith('street-labels', 'visibility', 'visible');
        expect(map.setLayoutProperty).toHaveBeenCalledWith('place-labels', 'visibility', 'visible');
        expect(updateBtn).toHaveBeenCalledTimes(1);
    });

    it('_initStreetLabels() restaure l\'état persisté et applique la visibilité', () => {
        localStorage.setItem('pcTacStreetLabels', '1');
        const ensure = vi.fn();
        const applyVis = vi.fn();
        const fake = makeFakeThis({ _ensureStreetLabelLayers: ensure, _applyStreetLabelsVisibility: applyVis });

        MapCoreMethods._initStreetLabels.call(fake);

        expect(fake.streetLabelsOn).toBe(true);
        expect(ensure).toHaveBeenCalledTimes(1);
        expect(applyVis).toHaveBeenCalledTimes(1);
    });

    it('_updateStreetLabelsBtn() sans bouton dans le DOM ⇒ ne jette pas', () => {
        document.body.innerHTML = '';
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._updateStreetLabelsBtn.call(fake)).not.toThrow();
    });

    it('_updateStreetLabelsBtn() avec bouton présent : classe + titre reflètent l\'état', () => {
        document.body.innerHTML = '<button id="plan_btn_labels"></button>';
        const fake = makeFakeThis({ streetLabelsOn: true });

        MapCoreMethods._updateStreetLabelsBtn.call(fake);

        const btn = document.getElementById('plan_btn_labels');
        expect(btn?.classList.contains('active')).toBe(true);
        expect(btn?.title).toBe('Masquer les noms de rues');
    });
});

// ---------------------------------------------------------------------------
// 6. Overlays LiDAR HD (hors planMap.js — cf. constants.ts LIDAR_HD_LAYERS)
// ---------------------------------------------------------------------------

describe('Overlays LiDAR HD — _applyLidarVisibility / _setLidarLayer / _cycleLidarLayer / _initLidar', () => {
    it('_applyLidarVisibility() n\'affiche QUE la couche active, masque les deux autres', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => ({})) });
        const updateBtn = vi.fn();
        const fake = makeFakeThis({ map, lidarLayer: 'mns', _updateLidarBtn: updateBtn });

        MapCoreMethods._applyLidarVisibility.call(fake);

        expect(map.setLayoutProperty).toHaveBeenCalledWith('lidar-mnt', 'visibility', 'none');
        expect(map.setLayoutProperty).toHaveBeenCalledWith('lidar-mns', 'visibility', 'visible');
        expect(map.setLayoutProperty).toHaveBeenCalledWith('lidar-mnh', 'visibility', 'none');
        expect(updateBtn).toHaveBeenCalledTimes(1);
    });

    it('_applyLidarVisibility() avec lidarLayer=null masque les trois couches', () => {
        const map = makeFakeMap({ getLayer: vi.fn(() => ({})) });
        const fake = makeFakeThis({ map, lidarLayer: null });

        MapCoreMethods._applyLidarVisibility.call(fake);

        for (const id of ['lidar-mnt', 'lidar-mns', 'lidar-mnh']) {
            expect(map.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none');
        }
    });

    it('_applyLidarVisibility() sans carte ⇒ ne jette pas', () => {
        const fake = makeFakeThis({ map: null });
        expect(() => MapCoreMethods._applyLidarVisibility.call(fake)).not.toThrow();
    });

    it('_setLidarLayer() écrit LIDAR_KEY, et l\'efface quand on éteint', () => {
        const applyVis = vi.fn();
        const fake = makeFakeThis({ map: makeFakeMap(), _applyLidarVisibility: applyVis });

        MapCoreMethods._setLidarLayer.call(fake, 'mnt');
        expect(fake.lidarLayer).toBe('mnt');
        expect(localStorage.getItem(LIDAR_KEY)).toBe('mnt');

        MapCoreMethods._setLidarLayer.call(fake, null);
        expect(fake.lidarLayer).toBeNull();
        expect(localStorage.getItem(LIDAR_KEY)).toBeNull();
        expect(applyVis).toHaveBeenCalledTimes(2);
    });

    it('_cycleLidarLayer() cycle aucun → mnt → mns → mnh → aucun', () => {
        const fake = makeFakeThis({ map: makeFakeMap(), _setLidarLayer: MapCoreMethods._setLidarLayer });

        const seen: (string | null)[] = [];
        for (let i = 0; i < 4; i++) {
            MapCoreMethods._cycleLidarLayer.call(fake);
            seen.push(fake.lidarLayer);
        }
        expect(seen).toEqual(['mnt', 'mns', 'mnh', null]);
    });

    it('_cycleLidarLayer() sans carte ⇒ ne change rien', () => {
        const setLayer = vi.fn();
        const fake = makeFakeThis({ map: null, _setLidarLayer: setLayer });

        MapCoreMethods._cycleLidarLayer.call(fake);

        expect(setLayer).not.toHaveBeenCalled();
    });

    it('_initLidar() restaure la couche persistée', () => {
        localStorage.setItem(LIDAR_KEY, 'mnh');
        const applyVis = vi.fn();
        const fake = makeFakeThis({ _applyLidarVisibility: applyVis });

        MapCoreMethods._initLidar.call(fake);

        expect(fake.lidarLayer).toBe('mnh');
        expect(applyVis).toHaveBeenCalledTimes(1);
    });

    it('_initLidar() sur valeur inconnue en storage ⇒ aucun overlay (pas de couche fantôme)', () => {
        localStorage.setItem(LIDAR_KEY, 'mnx');
        const fake = makeFakeThis();

        MapCoreMethods._initLidar.call(fake);

        expect(fake.lidarLayer).toBeNull();
    });

    it('_updateLidarBtn() reflète la couche active sur le bouton (classe, titre, pastille)', () => {
        document.body.innerHTML = '<button id="plan_btn_lidar"><span class="plan-fab-badge"></span></button>';
        const fake = makeFakeThis({ lidarLayer: 'mnt' });

        MapCoreMethods._updateLidarBtn.call(fake);

        const btn = document.getElementById('plan_btn_lidar');
        expect(btn?.classList.contains('active')).toBe(true);
        expect(btn?.title).toContain('MNT');
        expect(btn?.querySelector('.plan-fab-badge')?.textContent).toBe('MNT');
    });

    it('_updateLidarBtn() à l\'arrêt : bouton inactif et pastille vide', () => {
        document.body.innerHTML = '<button id="plan_btn_lidar" class="active"><span class="plan-fab-badge">MNH</span></button>';
        const fake = makeFakeThis({ lidarLayer: null });

        MapCoreMethods._updateLidarBtn.call(fake);

        const btn = document.getElementById('plan_btn_lidar');
        expect(btn?.classList.contains('active')).toBe(false);
        expect(btn?.querySelector('.plan-fab-badge')?.textContent).toBe('');
    });

    it('_updateLidarBtn() sans bouton dans le DOM ⇒ ne jette pas', () => {
        document.body.innerHTML = '';
        const fake = makeFakeThis();
        expect(() => MapCoreMethods._updateLidarBtn.call(fake)).not.toThrow();
    });
});
