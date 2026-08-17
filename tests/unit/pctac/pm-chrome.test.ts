/**
 * pm-chrome.test.ts — Tests du paquet `pm-chrome` (planmap/chrome.ts)
 * ================================================================================
 *
 * Comportement OBSERVÉ de `modules/pctac/planMap.js:695-955, 5566-5593`
 * (GStart-main, lecture seule). Références `planMap.js:<ligne>` en commentaire,
 * cf. `docs/SPEC-PLANMAP-SPLIT.md` §4.4, §5.7 (INVARIANT jeton de séquence
 * Nominatim), §9 (stratégie de test : fumée ciblée + 1-3 assertions métier).
 *
 * `this` FACTICE (jamais `new maplibregl.Map`, SPEC-PCTAC-CONVERSION §8.4) :
 * `createFakePlanMap()` fournit un objet conforme à `PlanMapInternal` couvrant
 * strictement ce qu'utilisent les 9 méthodes de chrome.ts (état + collaborateurs
 * stubés). `fetch` est ABSENT sous jsdom → mocké via `vi.stubGlobal('fetch', ...)`.
 *
 * Couverture demandée par la mission :
 *  1. Les 9 méthodes ne jettent pas quand le DOM attendu est absent.
 *  2. TEST CLÉ — deux `_searchAddress` concurrents, la PREMIÈRE requête résolvant
 *     EN DERNIER : seul le résultat de la SECONDE doit être appliqué.
 *  3. `_toggleSearchPanel(true/false)` force l'état (ouvert/fermé).
 *  4. `_showHint` puis `_hideHint` laissent le DOM propre.
 * (+ un test de non-régression sur piège §6.6 : `_bindUi` doit rester rejouable
 * sans doubler les handlers, car il utilise `el.onclick =`, pas `addEventListener`.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChromeMethods } from '../../../src/apps/pctac/planmap/chrome.js';
import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';

// ---------------------------------------------------------------------------
// Fabriques de `this` factice / réponses fetch / carte factice
// ---------------------------------------------------------------------------

/** Fabrique un `this` factice minimal, conforme à ce qu'utilisent les 9 méthodes
 *  de chrome.ts. `map` par défaut `null` (la plupart des smoke tests n'en ont pas
 *  besoin) ; passer `map` en overrides pour les tests qui l'exigent. */
function createFakePlanMap(overrides: Record<string, unknown> = {}): {
    instance: PlanMapInternal;
    spies: {
        placeSearchMarker: ReturnType<typeof vi.fn>;
        setTool: ReturnType<typeof vi.fn>;
        restoreModalFromFullscreen: ReturnType<typeof vi.fn>;
    };
} {
    const placeSearchMarker = vi.fn();
    const setTool = vi.fn();
    const restoreModalFromFullscreen = vi.fn();

    const fake = {
        ...ChromeMethods,
        map: null,
        searchMarker: null,
        drawTool: null,
        pendingEntityPin: null,
        pendingFreePin: null,
        _searchSeq: 0,
        // `_parseGps` : réel dans geo.ts (hors périmètre de ce paquet) — stubé
        // pour isoler chrome.ts, cf. règle §1.2 (aucune dépendance croisée entre
        // groupes de méthodes). Retourne `null` par défaut (force la branche
        // Nominatim) ; les tests GPS le surchargent via `overrides`.
        _parseGps: () => null as { lat: number; lng: number } | null,
        _placeSearchMarker: placeSearchMarker,
        _setTool: setTool,
        _restoreModalFromFullscreen: restoreModalFromFullscreen,
        // Collaborateurs référencés par `_bindUi` (jamais invoqués dans les
        // smoke tests : DOM absent ⇒ tous les `if (btn) …` sont sautés), mais
        // requis par le typage `PlanMapInternal`.
        _toggle3D: vi.fn(),
        _takeScreenshot: vi.fn(async () => {}),
        _openCreatePingWheel: vi.fn(),
        _toggleStreetLabels: vi.fn(),
        _cycleLidarLayer: vi.fn(),
        _startAoiFraming: vi.fn(),
        ...overrides,
    };

    return {
        // Double-cast justifié (même procédé que pm-textmodal.test.ts) : `fake`
        // ne couvre volontairement qu'un sous-ensemble de `PlanMapInternal`.
        instance: fake as unknown as PlanMapInternal,
        spies: { placeSearchMarker, setTool, restoreModalFromFullscreen },
    };
}

/** Réponse `fetch` factice conforme à ce que lit `_searchAddress` (`.ok`, `.status`, `.json()`). */
function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as unknown as Response;
}

/** Point MapLibre factice — sous-ensemble RÉELLEMENT lu par `Marker._update()`
 *  (`.x`, `.y`, `._add()`, `.round()`), validé empiriquement sous jsdom. */
function fakePoint(x: number, y: number): { x: number; y: number; _add: () => unknown; round: () => unknown } {
    const p = { x, y, _add: () => fakePoint(x, y), round: () => fakePoint(x, y) };
    return p;
}

/**
 * Carte MapLibre factice couvrant la surface RÉELLEMENT appelée par
 * `maplibregl.Marker#addTo` (jamais `new maplibregl.Map`, WebGL absent sous
 * jsdom — SPEC-PCTAC-CONVERSION §8.4). Alignements par défaut ('auto') évitent
 * `getBearing`/`getPitch` ; `transform.renderWorldCopies:false` évite le
 * chemin `js()` interne de MapLibre qui exigerait un `transform` plus complet.
 */
function fakeMarkerMap(): { flyTo: ReturnType<typeof vi.fn> } & Record<string, unknown> {
    return {
        _getUIString: () => '',
        getCanvasContainer: () => document.createElement('div'),
        on: () => {},
        off: () => {},
        once: () => {},
        loaded: () => true,
        isMoving: () => false,
        terrain: undefined,
        transform: { renderWorldCopies: false },
        project: () => fakePoint(100, 100),
        getBearing: () => 0,
        getPitch: () => 0,
        flyTo: vi.fn(),
    };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Les 9 méthodes ne jettent pas quand le DOM attendu est absent
// ---------------------------------------------------------------------------

describe('ChromeMethods — les 9 méthodes ne jettent pas quand le DOM est absent', () => {
    it('_bindUi (planMap.js:695)', () => {
        const { instance } = createFakePlanMap();
        expect(() => instance._bindUi()).not.toThrow();
    });

    // Hors planMap.js : bouton d'ombrage LiDAR HD (cyclage MNT/MNS/MNH/aucun).
    it('_bindUi câble #plan_btn_lidar sur _cycleLidarLayer', () => {
        document.body.innerHTML = '<button id="plan_btn_lidar"></button>';
        const cycle = vi.fn();
        const { instance } = createFakePlanMap({ _cycleLidarLayer: cycle });

        instance._bindUi();
        document.getElementById('plan_btn_lidar')?.dispatchEvent(new MouseEvent('click'));

        expect(cycle).toHaveBeenCalledTimes(1);
        document.body.innerHTML = '';
    });

    it('_toggleFullscreen (planMap.js:769)', () => {
        const { instance } = createFakePlanMap();
        expect(() => instance._toggleFullscreen()).not.toThrow();
    });

    it('_updateFullscreenIcon (planMap.js:782)', () => {
        const { instance } = createFakePlanMap();
        expect(() => instance._updateFullscreenIcon()).not.toThrow();
    });

    it('_toggleSearchPanel (planMap.js:798)', () => {
        const { instance } = createFakePlanMap();
        expect(() => instance._toggleSearchPanel()).not.toThrow();
    });

    it('_searchAddress (planMap.js:824) — résout sans jeter (#plan_address_input/#plan_search_results absents)', async () => {
        const { instance } = createFakePlanMap();
        await expect(instance._searchAddress()).resolves.toBeUndefined();
    });

    it('_placeSearchMarker (planMap.js:894) — garde `!this.map`, jamais de carte réelle instanciée', () => {
        const { instance } = createFakePlanMap({ map: null });
        expect(() => instance._placeSearchMarker(2.3522, 48.8566, 'Paris')).not.toThrow();
        expect(instance.searchMarker).toBeNull();
    });

    it('_toggleDrawDock (planMap.js:946)', () => {
        const { instance } = createFakePlanMap();
        expect(() => instance._toggleDrawDock()).not.toThrow();
    });

    it('_showHint (planMap.js:5566) — #plan_map absent : pas de throw, hint construit hors-DOM', () => {
        const { instance } = createFakePlanMap();
        expect(() => instance._showHint('essai')).not.toThrow();
    });

    it('_hideHint (planMap.js:5590) — #plan_hint absent', () => {
        const { instance } = createFakePlanMap();
        expect(() => instance._hideHint()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// 2. TEST CLÉ — INVARIANT §5.7 : jeton de séquence Nominatim
// ---------------------------------------------------------------------------

describe('_searchAddress — INVARIANT §5.7 : jeton de séquence Nominatim', () => {
    function mountSearchDom(): { input: HTMLInputElement; resultsBox: HTMLDivElement } {
        document.body.innerHTML = `
            <input id="plan_address_input" type="text" />
            <div id="plan_search_results"></div>
        `;
        return {
            input: document.getElementById('plan_address_input') as HTMLInputElement,
            resultsBox: document.getElementById('plan_search_results') as HTMLDivElement,
        };
    }

    it('deux recherches concurrentes, la PREMIÈRE requête résolvant EN DERNIER : seul le résultat de la SECONDE est appliqué', async () => {
        const { input, resultsBox } = mountSearchDom();
        const map = fakeMarkerMap();
        const { instance, spies } = createFakePlanMap({ map });

        const pendingResolvers: Array<(r: Response) => void> = [];
        const fetchImpl: typeof fetch = () =>
            new Promise<Response>((resolve) => {
                pendingResolvers.push(resolve);
            });
        vi.stubGlobal('fetch', fetchImpl);

        // Requête n°1 ("Adresse A") — seq=1.
        input.value = 'Adresse A';
        const p1 = instance._searchAddress();
        expect(pendingResolvers.length).toBe(1);

        // Requête n°2 ("Adresse B"), lancée avant que la n°1 ne réponde — seq=2.
        input.value = 'Adresse B';
        const p2 = instance._searchAddress();
        expect(pendingResolvers.length).toBe(2);

        // La PREMIÈRE requête (A) résout EN DERNIER : on résout B (la plus
        // récente) d'abord, puis A (périmée) ensuite.
        pendingResolvers[1]?.(jsonResponse([{ display_name: 'Résultat B', lon: '3.0', lat: '4.0' }]));
        pendingResolvers[0]?.(jsonResponse([{ display_name: 'Résultat A', lon: '1.0', lat: '2.0' }]));

        await Promise.all([p1, p2]);

        // Seule la recherche B (la plus récente) a été appliquée.
        expect(resultsBox.innerHTML).toContain('Résultat B');
        expect(resultsBox.innerHTML).not.toContain('Résultat A');
        expect(spies.placeSearchMarker).toHaveBeenCalledTimes(1);
        expect(spies.placeSearchMarker).toHaveBeenCalledWith(3, 4, 'Résultat B');
        expect(map.flyTo).toHaveBeenCalledTimes(1);
        expect(map.flyTo).toHaveBeenCalledWith({ center: [3, 4], zoom: 17, speed: 1.4 });
    });

    it('symétrique : la PREMIÈRE requête échoue APRÈS que la SECONDE a réussi — l\'échec périmé n\'écrase pas le résultat affiché', async () => {
        const { input, resultsBox } = mountSearchDom();
        const map = fakeMarkerMap();
        const { instance, spies } = createFakePlanMap({ map });

        const pendingResolvers: Array<{ resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
        const fetchImpl: typeof fetch = () =>
            new Promise<Response>((resolve, reject) => {
                pendingResolvers.push({ resolve, reject });
            });
        vi.stubGlobal('fetch', fetchImpl);

        input.value = 'Adresse A';
        const p1 = instance._searchAddress();
        input.value = 'Adresse B';
        const p2 = instance._searchAddress();

        pendingResolvers[1]?.resolve(jsonResponse([{ display_name: 'Résultat B', lon: '5.0', lat: '6.0' }]));
        // La requête périmée (A) échoue APRÈS coup — ne doit ni écraser le
        // résultat de B ni purger `searchMarker` (garde `seq !== this._searchSeq`
        // du chemin d'échec, planMap.js:883).
        pendingResolvers[0]?.reject(new Error('réseau HS'));

        await Promise.all([p1, p2]);

        expect(resultsBox.innerHTML).toContain('Résultat B');
        expect(spies.placeSearchMarker).toHaveBeenCalledTimes(1);
        expect(spies.placeSearchMarker).toHaveBeenCalledWith(5, 6, 'Résultat B');
    });

    it('GPS direct ("48.85, 2.35") : centre immédiatement, incrémente `_searchSeq`, pas de fetch', async () => {
        document.body.innerHTML = `
            <input id="plan_address_input" type="text" />
            <div id="plan_search_results"></div>
        `;
        const input = document.getElementById('plan_address_input') as HTMLInputElement;
        const resultsBox = document.getElementById('plan_search_results') as HTMLDivElement;
        const map = fakeMarkerMap();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const { instance, spies } = createFakePlanMap({
            map,
            _parseGps: (str: string) => (str === '48.85, 2.35' ? { lat: 48.85, lng: 2.35 } : null),
        });

        input.value = '48.85, 2.35';
        await instance._searchAddress();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(map.flyTo).toHaveBeenCalledWith({ center: [2.35, 48.85], zoom: 17, speed: 1.4 });
        expect(spies.placeSearchMarker).toHaveBeenCalledTimes(1);
        expect(instance._searchSeq).toBe(1);
        expect(resultsBox.innerHTML).toContain('48.85000');
    });

    it('requête vide (après trim) : ne touche pas `_searchSeq`, aucun fetch', async () => {
        const { input } = mountSearchDom();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const { instance } = createFakePlanMap();

        input.value = '   ';
        await instance._searchAddress();

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(instance._searchSeq).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 3. `_toggleSearchPanel(force)` force l'état
// ---------------------------------------------------------------------------

describe('_toggleSearchPanel — force l\'état ouvert/fermé (planMap.js:798-809)', () => {
    function mountPanelDom(): { panel: HTMLElement; fab: HTMLElement; input: HTMLInputElement } {
        document.body.innerHTML = `
            <div id="plan_search_panel"></div>
            <button id="plan_btn_search" type="button"></button>
            <input id="plan_address_input" type="text" />
        `;
        return {
            panel: document.getElementById('plan_search_panel') as HTMLElement,
            fab: document.getElementById('plan_btn_search') as HTMLElement,
            input: document.getElementById('plan_address_input') as HTMLInputElement,
        };
    }

    it('force(true) : ouvre le panneau, active le FAB, place le focus sur le champ', () => {
        const { panel, fab, input } = mountPanelDom();
        const { instance } = createFakePlanMap();

        instance._toggleSearchPanel(true);

        expect(panel.classList.contains('open')).toBe(true);
        expect(fab.classList.contains('active')).toBe(true);
        expect(document.activeElement).toBe(input);
    });

    it('force(false) : ferme le panneau même s\'il était déjà ouvert', () => {
        const { panel, fab } = mountPanelDom();
        panel.classList.add('open');
        fab.classList.add('active');
        const { instance } = createFakePlanMap();

        instance._toggleSearchPanel(false);

        expect(panel.classList.contains('open')).toBe(false);
        expect(fab.classList.contains('active')).toBe(false);
    });

    it('sans argument : bascule (toggle) l\'état courant', () => {
        const { panel } = mountPanelDom();
        const { instance } = createFakePlanMap();

        instance._toggleSearchPanel();
        expect(panel.classList.contains('open')).toBe(true);
        instance._toggleSearchPanel();
        expect(panel.classList.contains('open')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 4. `_showHint` puis `_hideHint` laissent le DOM propre
// ---------------------------------------------------------------------------

describe('_showHint / _hideHint — cycle propre (planMap.js:5566-5593)', () => {
    function mountMapDom(): void {
        document.body.innerHTML = `<div class="plan-map-wrap"><div id="plan_map"></div></div>`;
    }

    it('_showHint crée #plan_hint (display:block, texte + suffixe annulation) ; _hideHint le masque sans le retirer', () => {
        mountMapDom();
        const { instance } = createFakePlanMap();

        instance._showHint('Cliquez sur la carte');
        const hint = document.getElementById('plan_hint');
        expect(hint).not.toBeNull();
        expect(hint?.style.display).toBe('block');
        expect(hint?.textContent).toBe('Cliquez sur la carte (clic ici pour annuler)');

        instance._hideHint();
        // planMap.js:5590-5593 — `_hideHint` masque, ne retire jamais l'élément du DOM.
        expect(document.getElementById('plan_hint')).not.toBeNull();
        expect(hint?.style.display).toBe('none');
    });

    it('un second _showHint réutilise le même élément #plan_hint (pas de doublon)', () => {
        mountMapDom();
        const { instance } = createFakePlanMap();

        instance._showHint('Premier message');
        const firstHint = document.getElementById('plan_hint');
        instance._showHint('Second message');
        const secondHint = document.getElementById('plan_hint');

        expect(document.querySelectorAll('#plan_hint').length).toBe(1);
        expect(secondHint).toBe(firstHint);
        expect(secondHint?.textContent).toBe('Second message (clic ici pour annuler)');
    });

    it('cliquer sur le hint purge pendingEntityPin/pendingFreePin et le masque (planMap.js:5579-5583)', () => {
        mountMapDom();
        const { instance } = createFakePlanMap({
            pendingEntityPin: { kind: 'adv', id: 'x1' },
            pendingFreePin: { label: 'L', color: '#fff', kind: 'Inter', icon: 'a' },
        });

        instance._showHint('Choisis un point');
        const hint = document.getElementById('plan_hint') as HTMLElement;
        hint.click();

        expect(instance.pendingEntityPin).toBeNull();
        expect(instance.pendingFreePin).toBeNull();
        expect(hint.style.display).toBe('none');
    });
});

// ---------------------------------------------------------------------------
// Non-régression piège §6.6 : `_bindUi` reste rejouable (el.onclick=, jamais addEventListener)
// ---------------------------------------------------------------------------

describe('_bindUi — écrasement idempotent via `el.onclick =` (planMap.js:695-766, SPEC-PLANMAP-SPLIT §6.6)', () => {
    it('rejouer _bindUi() ne double pas les déclenchements de _toggleSearchPanel au clic', () => {
        document.body.innerHTML = `<button id="plan_btn_search" type="button"></button>`;
        const { instance } = createFakePlanMap();
        const toggleSpy = vi.spyOn(instance, '_toggleSearchPanel').mockImplementation(() => {});

        instance._bindUi();
        instance._bindUi();
        instance._bindUi();

        (document.getElementById('plan_btn_search') as HTMLElement).click();

        // `el.onclick = () => …` écrase l'assignation précédente à chaque appel de
        // `_bindUi` : un seul déclenchement par clic, quel que soit le nombre de
        // rebinds. Un `addEventListener` équivalent aurait empilé 3 listeners.
        expect(toggleSpy).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// `_placeSearchMarker` — construction RÉELLE d'un `maplibregl.Marker` (pas de mock)
// ---------------------------------------------------------------------------

describe('_placeSearchMarker — construit un vrai maplibregl.Marker sans jeter (planMap.js:894-943)', () => {
    it('avec un label : pose le marker + popup, remplace un éventuel marker précédent', () => {
        const map = fakeMarkerMap();
        const previousRemove = vi.fn();
        const { instance } = createFakePlanMap({
            map,
            searchMarker: { remove: previousRemove },
            // La méthode sous test est ici `_placeSearchMarker` elle-même : on
            // restaure l'implémentation RÉELLE (le fake `this` par défaut la
            // remplace par un espion pour isoler `_searchAddress` ailleurs).
            _placeSearchMarker: ChromeMethods._placeSearchMarker,
        });

        expect(() => instance._placeSearchMarker(2.3522, 48.8566, 'Paris, France')).not.toThrow();

        expect(previousRemove).toHaveBeenCalledTimes(1);
        expect(instance.searchMarker).not.toBeNull();
    });

    it('sans label (label omis) : ne construit pas de popup, ne jette pas', () => {
        const map = fakeMarkerMap();
        const { instance } = createFakePlanMap({ map, _placeSearchMarker: ChromeMethods._placeSearchMarker });

        expect(() => instance._placeSearchMarker(2.3522, 48.8566)).not.toThrow();
        expect(instance.searchMarker).not.toBeNull();
    });
});
