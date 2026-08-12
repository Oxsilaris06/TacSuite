/**
 * oi-carto-pins.test.ts — Comportement OBSERVÉ de `modules/oi_cartographie.js`
 * (GStart-main, 1681 LOC, lecture seule) pour le paquet `oi-carto-pins` :
 * `carto/pins.ts` (20 méthodes PINS, oi_cartographie.js:614-991). Écrit AVANT
 * le port (TDD, mission P3.CONV). Références `oi_cartographie.js:<ligne>` en
 * commentaire, cf. SPEC-OI-CONVERSION.md §6.2/§6.3, PAQUETS-OI.json
 * (`oi-carto-pins`).
 *
 * `this` FACTICE : combine les VRAIES méthodes de `PinsMethods` (le groupe
 * sous test, appelées par cross-référence interne — ex. `_renderPingLists`
 * appelle `this._pinButton`/`this._memberButton`/…, tous dans ce même
 * fichier) + des doubles pour les AUTRES groupes carto (`map-core.ts`,
 * `panels.ts`, `draw.ts` — hors `dependsOn` de ce paquet, qui n'est que
 * `oi-carto-base`) + un double minimal in-memory pour `_loadPins`/`_savePins`
 * (propriété de `carto/state.ts`, également hors `dependsOn`). `_renderPins`/
 * `_renderPingLists` sont redéfinies en espions par défaut dans `makeFakeThis`
 * pour isoler les tests CRUD (`_addPin`/`_removePin`/`_clearAllPins`/
 * `_resetMember`) — les describe dédiés ci-dessous invoquent directement
 * `PinsMethods._renderPins`/`_renderPingLists` (bypass du stub, cf. leurs
 * commentaires). Jamais `new maplibregl.Map` (WebGL absent sous jsdom,
 * SPEC-PCTAC-CONVERSION §8.4) ; `maplibregl.Marker` est mocké pour
 * `_renderPins` (même technique que `pm-pins.test.ts`, PC-Tac).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapMouseEvent } from 'maplibre-gl';

// R2-T2b : `alert()`/`confirm()` natifs → `toast`/`confirmDialog`
// (`@shared/feedback.js`) mockés, même pattern que `pc-archive.test.ts`.
const toastSpy = vi.hoisted(() => vi.fn());
const confirmDialogSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@shared/feedback.js', () => ({
    toast: toastSpy,
    confirmDialog: confirmDialogSpy,
}));

import { PinsMethods } from '../../../src/apps/oi/carto/pins.js';
import type { OiCartoPendingPin, OiCartoPin } from '../../../src/apps/oi/carto/types.js';
import type { OICartoInternal } from '../../../src/apps/oi/carto/types.js';

/** Narrowing sans `!` (interdit par la mission) : jette explicitement si null/undefined. */
function assertNonNull<T>(value: T | null | undefined, message = 'expected non-null value'): T {
    if (value === null || value === undefined) throw new Error(message);
    return value;
}

// FakeMarker : une vraie instance `maplibregl.Marker` appelle des méthodes
// internes de `maplibregl.Map` lors de `addTo()`, qu'un faux `map` minimal ne
// fournit pas (vérifié dans les paquets pctac équivalents : jette sous
// jsdom). `pins.ts` (OI) n'utilise que `.setLngLat`/`.getLngLat`/`.addTo`/
// `.remove`/`.on`/`.getElement`/`.setDraggable` du vrai Marker (`setDraggable`
// ajouté par le chantier « verrou de pin », parité PC-Tac).
vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        private _lngLat: { lng: number; lat: number };
        private _listeners = new Map<string, () => void>();
        _draggable: boolean | undefined;
        constructor(opts: { element?: HTMLElement; draggable?: boolean } = {}) {
            this._element = opts.element ?? document.createElement('div');
            this._lngLat = { lng: 0, lat: 0 };
            this._draggable = opts.draggable;
        }
        setLngLat(ll: { lng: number; lat: number }): this { this._lngLat = ll; return this; }
        getLngLat(): { lng: number; lat: number } { return this._lngLat; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return this._element; }
        setDraggable(v: boolean): this { this._draggable = v; return this; }
        on(type: string, cb: () => void): this { this._listeners.set(type, cb); return this; }
        // Aide de test (pas de la surface maplibre réelle) :
        _fire(type: string): void { this._listeners.get(type)?.(); }
    }
    return { default: { Marker: FakeMarker } };
});

// Capture des options passées à `OIWheel` (groupe `wheel.ts`, hors périmètre
// de ce paquet) pour vérifier le contenu de la roue de création sans DOM réel.
const wheelOptsSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../src/apps/oi/carto/wheel.js', () => ({
    OIWheel: class {
        constructor(opts: unknown) { wheelOptsSpy(opts); }
        open(): void { /* no-op */ }
    },
}));

/** Double de `_safe` (carto/state.ts — `SafeMethods`, hors `dependsOn` de ce
 *  paquet) reproduisant le comportement de l'original (oi_cartographie.js:286-291)
 *  pour que les handlers posés par `_renderPins` s'exécutent normalement. */
function safeImpl<A extends unknown[], R>(fn: (...args: A) => R, label?: string): (...args: A) => R | undefined {
    return (...args: A) => {
        try { return fn(...args); }
        catch (e) { console.error('[OICarto] ' + (label || 'handler') + ' a échoué:', e); return undefined; }
    };
}

function makePin(overrides: Partial<OiCartoPin> & Pick<OiCartoPin, 'id'>): OiCartoPin {
    return {
        kind: 'rassemblement',
        label: 'Point',
        memberTri: null,
        fonction: null,
        icon: null,
        color: null,
        lng: 2.35,
        lat: 48.85,
        ...overrides,
    };
}

/** Construit un `this` factice conforme à `OICartoInternal` pour `PinsMethods`. */
function makeFakeThis(overrides: Partial<OICartoInternal> = {}): OICartoInternal {
    let pins: OiCartoPin[] = [];
    const base = {
        // --- État propre de OICarto (oi_cartographie.js:270-282) ---
        _activeWheel: null,
        _inlinePanel: null,
        map: null,
        initialized: false,
        is3D: false,
        markers: new Map<string, unknown>(),
        labelsVisible: true,
        pendingPin: null,
        drawTool: null,
        drawColor: '#ef4444',
        drawState: null,
        history: [],
        redoStack: [],
        _inlinePanelMove: null,
        _safe: safeImpl,
        // --- Persistance (carto/state.ts — PersistMethods, hors dependsOn) :
        // double minimal in-memory, spié pour vérifier les appels attendus par
        // la mission du paquet. ---
        _loadPins: vi.fn((): OiCartoPin[] => pins),
        _savePins: vi.fn((p: readonly OiCartoPin[]): void => { pins = p.slice(); }),
        // --- Autres groupes carto (map-core.ts, panels.ts, draw.ts) — stubs,
        // hors périmètre de ce paquet. ---
        lastQuickPin: null,
        _wheelJustClosed: 0,
        // Câblage appui long neutralisé par défaut : les fausses cartes `{}`
        // de ces tests n'exposent pas `.on` (describe dédié plus bas).
        _longPressWired: true,
        _showHint: vi.fn(),
        _hideHint: vi.fn(),
        _closeInlinePanel: vi.fn(),
        _closeWheel: vi.fn(),
        _openPinWheel: vi.fn(),
        _openPinPhotoViewer: vi.fn(),
        _openInlinePanel: vi.fn(),
        _copyCoords: vi.fn(),
        _setTool: vi.fn(),
        // --- Groupe sous test : VRAIES méthodes (cross-appels internes). ---
        ...PinsMethods,
        // `_renderPins`/`_renderPingLists`/`_closePingModal` redéfinis en
        // espions par défaut (bien que membres de ce même groupe) : isole les
        // tests CRUD/placement, qui vérifient seulement l'APPEL (cf.
        // instructions du paquet, « _addPin → _savePins appelé + _renderPins
        // appelé »). Les describe dédiés ci-dessous invoquent directement
        // `PinsMethods._renderPins`/`_renderPingLists` (bypass du stub).
        _renderPins: vi.fn(),
        _renderPingLists: vi.fn(),
        _closePingModal: vi.fn(),
        // Roue de création stubée par défaut (comme `_renderPins`) : isole les
        // tests du flux clic-carte ; describe dédié plus bas pour le flux réel.
        _openCreatePinWheel: vi.fn(),
        // --- Groupe carto/measure.ts, hors périmètre de ce paquet — stubs. ---
        _measureState: null,
        _measureAddVertex: vi.fn(),
        // --- Groupe carto/text.ts, hors périmètre de ce paquet — stub. ---
        _startFreeText: vi.fn(),
        ...overrides,
    };
    return base as unknown as OICartoInternal;
}

/** DOM minimal : modale de ping + un PATRACDVR peuplé de 2 boutons membres +
 *  un véhicule PATRACDVR + un champ véhicule adverse (`_getPatracdvrVehicles`/
 *  `_getAdversaryVehicles` sur un DOM de référence, cf. instructions du paquet). */
function setupDom(): void {
    document.body.innerHTML = `
        <dialog id="oi_carto_ping_modal">
            <input type="text" id="oi_carto_pin_label" value="">
            <div id="oi_carto_member_list"></div>
            <div id="oi_carto_cyno_list"></div>
            <div id="oi_carto_ramevl_list"></div>
            <div id="oi_carto_vltarget_list"></div>
            <div id="oi_carto_rassemblement_list"></div>
        </dialog>
        <div id="patracdvr_container">
            <div class="patracdvr-vehicle-row" data-vehicle-name="VL Alpha">
                <button type="button" class="patracdvr-member-btn" data-trigramme="ABC" data-fonction="Chef Dispo" data-cellule="India 1"></button>
                <button type="button" class="patracdvr-member-btn" data-trigramme="DEF" data-fonction="Sans" data-cellule="Sans"></button>
                <button type="button" class="patracdvr-member-btn" data-trigramme="N/A" data-fonction="Sans" data-cellule="Sans"></button>
            </div>
        </div>
        <div id="vehicules_adv1">
            <input type="text" class="dynamic-input" value="Clio grise">
            <input type="text" class="dynamic-input" value="  ">
        </div>
    `;
}

beforeEach(() => {
    setupDom();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    toastSpy.mockClear();
    confirmDialogSpy.mockClear();
    confirmDialogSpy.mockImplementation(async () => true);
});

describe('_getPatracdvrVehicles (oi_cartographie.js:833-837)', () => {
    it('lit dataset.vehicleName des .patracdvr-vehicle-row du PATRACDVR', () => {
        expect(PinsMethods._getPatracdvrVehicles()).toEqual(['VL Alpha']);
    });

    it('aucun véhicule → []', () => {
        document.getElementById('patracdvr_container')?.replaceChildren();
        expect(PinsMethods._getPatracdvrVehicles()).toEqual([]);
    });
});

describe('_getAdversaryVehicles (oi_cartographie.js:840-847)', () => {
    it('lit .dynamic-input sous [id^="vehicules_"], dédoublonne, ignore le vide', () => {
        expect(PinsMethods._getAdversaryVehicles()).toEqual(['Clio grise']);
    });

    it('déduplique deux valeurs identiques', () => {
        document.getElementById('vehicules_adv1')!.innerHTML +=
            '<input type="text" class="dynamic-input" value="Clio grise">';
        expect(PinsMethods._getAdversaryVehicles()).toEqual(['Clio grise']);
    });
});

describe('_isMemberPlaced (oi_cartographie.js:729-731)', () => {
    it('true si un pin porte ce memberTri', () => {
        const fake = makeFakeThis({ _loadPins: () => [makePin({ id: 'p1', memberTri: 'ABC' })] });
        expect(PinsMethods._isMemberPlaced.call(fake, 'ABC')).toBe(true);
    });

    it('false si aucun pin ne porte ce memberTri', () => {
        const fake = makeFakeThis({ _loadPins: () => [makePin({ id: 'p1', memberTri: 'ABC' })] });
        expect(PinsMethods._isMemberPlaced.call(fake, 'ZZZ')).toBe(false);
    });

    it('aucun pin → false', () => {
        const fake = makeFakeThis({ _loadPins: () => [] });
        expect(PinsMethods._isMemberPlaced.call(fake, 'ABC')).toBe(false);
    });
});

describe('_renderPingLists (oi_cartographie.js:633-698) — nombre d\'entrées, message vide', () => {
    it('rend les membres réguliers (hors Cyno) groupés par fonction, trigramme N/A exclu', () => {
        const fake = makeFakeThis();
        PinsMethods._renderPingLists.call(fake);
        const memberList = assertNonNull(document.getElementById('oi_carto_member_list'));
        // ABC (Chef Dispo) + DEF (Sans → groupe "Autres") ; le bouton "N/A" est
        // filtré en amont (oi_cartographie.js:636) : 2 boutons, pas 3.
        expect(memberList.querySelectorAll('button.add-btn').length).toBe(2);
        expect(memberList.textContent).toContain('ABC');
        expect(memberList.textContent).toContain('DEF');
    });

    it('message vide quand aucun membre PATRACDVR configuré', () => {
        document.getElementById('patracdvr_container')?.replaceChildren();
        const fake = makeFakeThis();
        PinsMethods._renderPingLists.call(fake);
        const memberList = assertNonNull(document.getElementById('oi_carto_member_list'));
        expect(memberList.innerHTML).toContain('Aucun membre PATRACDVR configuré.');
    });

    it('liste Cyno : bouton générique seul quand aucun membre de fonction Cyno', () => {
        const fake = makeFakeThis();
        PinsMethods._renderPingLists.call(fake);
        const cynoList = assertNonNull(document.getElementById('oi_carto_cyno_list'));
        expect(cynoList.querySelectorAll('button.add-btn').length).toBe(1);
        expect(cynoList.textContent).toContain('Cyno (générique)');
    });

    it('liste Rame VL : générique + 1 véhicule PATRACDVR (DOM de référence)', () => {
        const fake = makeFakeThis();
        PinsMethods._renderPingLists.call(fake);
        const rameList = assertNonNull(document.getElementById('oi_carto_ramevl_list'));
        const labels = Array.from(rameList.querySelectorAll('button.add-btn')).map(b => b.textContent);
        expect(labels).toEqual(['Rame VL (générique)', 'VL Alpha']);
    });

    it('liste VL Target : générique + 1 véhicule adverse (DOM de référence)', () => {
        const fake = makeFakeThis();
        PinsMethods._renderPingLists.call(fake);
        const vltList = assertNonNull(document.getElementById('oi_carto_vltarget_list'));
        const labels = Array.from(vltList.querySelectorAll('button.add-btn')).map(b => b.textContent);
        expect(labels).toEqual(['VL Target (générique)', 'Clio grise']);
    });

    it('liste Rassemblement : un seul bouton générique', () => {
        const fake = makeFakeThis();
        PinsMethods._renderPingLists.call(fake);
        const rasList = assertNonNull(document.getElementById('oi_carto_rassemblement_list'));
        expect(rasList.querySelectorAll('button.add-btn').length).toBe(1);
    });

    it('clic sur un membre non placé arme le placement (this.pendingPin) puis ferme la modale', () => {
        const fake = makeFakeThis();
        PinsMethods._renderPingLists.call(fake);
        const memberList = assertNonNull(document.getElementById('oi_carto_member_list'));
        const btn = assertNonNull(memberList.querySelector<HTMLButtonElement>('button.add-btn'));
        btn.click();
        expect(fake.pendingPin).not.toBeNull();
        expect(fake._closePingModal).toHaveBeenCalled();
    });
});

describe('_addPin (oi_cartographie.js:880-885)', () => {
    it('persiste le pin (_savePins) puis rafraîchit les markers (_renderPins)', () => {
        const fake = makeFakeThis({ _loadPins: () => [] });
        const pin = makePin({ id: 'p1' });

        PinsMethods._addPin.call(fake, pin);

        expect(fake._savePins).toHaveBeenCalledWith([pin]);
        expect(fake._renderPins).toHaveBeenCalledTimes(1);
    });

    it('conserve les pins existants (push, pas de remplacement)', () => {
        const existing = makePin({ id: 'p0' });
        const fake = makeFakeThis({ _loadPins: () => [existing] });
        const pin = makePin({ id: 'p1' });

        PinsMethods._addPin.call(fake, pin);

        expect(fake._savePins).toHaveBeenCalledWith([existing, pin]);
    });
});

describe('_removePin (oi_cartographie.js:887-891)', () => {
    it('retire uniquement l\'id ciblé, persiste et rafraîchit', () => {
        const fake = makeFakeThis({
            _loadPins: () => [makePin({ id: 'p1' }), makePin({ id: 'p2' })],
        });

        PinsMethods._removePin.call(fake, 'p1');

        expect(fake._savePins).toHaveBeenCalledWith([makePin({ id: 'p2' })]);
        expect(fake._renderPins).toHaveBeenCalledTimes(1);
    });
});

describe('_clearAllPins (oi_cartographie.js:893-902)', () => {
    it('aucun pin → alerte, ne persiste rien, ne demande pas confirmation', async () => {
        const fake = makeFakeThis({ _loadPins: () => [] });

        await PinsMethods._clearAllPins.call(fake);

        expect(toastSpy).toHaveBeenCalledWith('Aucun pin à supprimer.', { kind: 'error' });
        expect(confirmDialogSpy).not.toHaveBeenCalled();
        expect(fake._savePins).not.toHaveBeenCalled();
    });

    it('confirmation refusée → ne supprime rien', async () => {
        confirmDialogSpy.mockResolvedValueOnce(false);
        const fake = makeFakeThis({ _loadPins: () => [makePin({ id: 'p1' })] });

        await PinsMethods._clearAllPins.call(fake);

        expect(fake._savePins).not.toHaveBeenCalled();
        expect(fake._renderPins).not.toHaveBeenCalled();
    });

    it('confirmation acceptée → vide les pins, rafraîchit les markers, ferme la modale', async () => {
        confirmDialogSpy.mockResolvedValueOnce(true);
        const fake = makeFakeThis({ _loadPins: () => [makePin({ id: 'p1' })] });

        await PinsMethods._clearAllPins.call(fake);

        expect(fake._savePins).toHaveBeenCalledWith([]);
        expect(fake._renderPins).toHaveBeenCalledTimes(1);
        expect(fake._closePingModal).toHaveBeenCalledTimes(1);
    });
});

describe('_resetMember (oi_cartographie.js:817-822)', () => {
    it('retire le(s) pin(s) du membre puis rafraîchit markers + modale', () => {
        const fake = makeFakeThis({
            _loadPins: () => [makePin({ id: 'p1', memberTri: 'ABC' }), makePin({ id: 'p2', memberTri: 'DEF' })],
        });

        PinsMethods._resetMember.call(fake, 'ABC');

        expect(fake._savePins).toHaveBeenCalledWith([makePin({ id: 'p2', memberTri: 'DEF' })]);
        expect(fake._renderPins).toHaveBeenCalledTimes(1);
        expect(fake._renderPingLists).toHaveBeenCalledTimes(1);
    });
});

describe('_onMapClick (oi_cartographie.js:856-878)', () => {
    function makeClick(lng: number, lat: number): MapMouseEvent {
        // Fixture partielle (même idiome que pm-drawtools.test.ts, PC-Tac) :
        // seul `e.lngLat` est lu par `_onMapClick`.
        return { lngLat: { lng, lat } } as unknown as MapMouseEvent;
    }

    it('sans placement en attente : ne crée aucun pin, ouvre la roue de création (parité PC-Tac)', () => {
        const fake = makeFakeThis({ _loadPins: () => [] });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(fake._savePins).not.toHaveBeenCalled();
        expect(fake._openCreatePinWheel).toHaveBeenCalledWith({ lng: 1, lat: 2 });
    });

    it('roue active : le clic carte n\'ouvre PAS de roue de création (la roue gère sa fermeture)', () => {
        const fake = makeFakeThis({
            _loadPins: () => [],
            _activeWheel: { open: vi.fn(), destroy: vi.fn(), element: null },
        });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(fake._openCreatePinWheel).not.toHaveBeenCalled();
    });

    it('roue fermée à l\'instant (_wheelJustClosed < 400 ms) : pas de réouverture', () => {
        const fake = makeFakeThis({ _loadPins: () => [], _wheelJustClosed: Date.now() });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(fake._openCreatePinWheel).not.toHaveBeenCalled();
    });

    it('clic qui ferme un panneau inline : ferme le panneau sans ouvrir la roue de création', () => {
        const fake = makeFakeThis({ _loadPins: () => [], _inlinePanel: document.createElement('div') });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(fake._closeInlinePanel).toHaveBeenCalledTimes(1);
        expect(fake._openCreatePinWheel).not.toHaveBeenCalled();
    });

    it('mesure active (_measureState) : ajoute un sommet de mesure, n\'ouvre pas la roue de création', () => {
        const measureAddVertex = vi.fn();
        const fake = makeFakeThis({
            _loadPins: () => [],
            _measureState: { vertices: [], cursor: null },
            _measureAddVertex: measureAddVertex,
        });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(measureAddVertex).toHaveBeenCalledWith([1, 2]);
        expect(fake._openCreatePinWheel).not.toHaveBeenCalled();
        expect(fake._savePins).not.toHaveBeenCalled();
    });

    it('pendant un dessin (drawTool actif) : le clic est ignoré', () => {
        const pending: OiCartoPendingPin = { kind: 'rassemblement', label: 'Point' };
        const fake = makeFakeThis({ drawTool: 'line', pendingPin: pending, _loadPins: () => [] });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(fake._savePins).not.toHaveBeenCalled();
        expect(fake.pendingPin).toBe(pending);
    });

    it('placement en attente : pose le pin aux coordonnées du clic puis vide pendingPin', () => {
        const pending: OiCartoPendingPin = { kind: 'member', label: 'ABC · Chef Dispo', memberTri: 'ABC', fonction: 'Chef Dispo', icon: 'stars' };
        const fake = makeFakeThis({ pendingPin: pending, _loadPins: () => [] });

        PinsMethods._onMapClick.call(fake, makeClick(2.1, 48.1));

        expect(fake._savePins).toHaveBeenCalledTimes(1);
        const saved = (fake._savePins as unknown as { mock: { calls: [OiCartoPin[]][] } }).mock.calls[0]?.[0];
        const created = assertNonNull(saved)[0];
        expect(created).toMatchObject({ kind: 'member', label: 'ABC · Chef Dispo', memberTri: 'ABC', fonction: 'Chef Dispo', icon: 'stars', lng: 2.1, lat: 48.1 });
        expect(fake.pendingPin).toBeNull();
        expect(fake._hideHint).toHaveBeenCalledTimes(1);
        expect(fake._renderPingLists).toHaveBeenCalledTimes(1);
    });
});

describe('_armPinPlacement (oi_cartographie.js:849-854)', () => {
    it('arme this.pendingPin, ferme la modale, affiche le hint', () => {
        const fake = makeFakeThis();
        const pending: OiCartoPendingPin = { kind: 'cyno', label: 'Cyno' };

        PinsMethods._armPinPlacement.call(fake, pending);

        expect(fake.pendingPin).toBe(pending);
        expect(fake._closePingModal).toHaveBeenCalledTimes(1);
        expect(fake._showHint).toHaveBeenCalledWith('Cliquez sur la carte pour placer « Cyno »');
    });

    it('annule un outil de dessin actif avant d\'armer le placement', () => {
        const fake = makeFakeThis({ drawTool: 'line' });
        PinsMethods._armPinPlacement.call(fake, { kind: 'cyno', label: 'Cyno' });
        expect(fake._setTool).toHaveBeenCalledWith(null);
    });
});

describe('_quickPlacePing (roue de création, parité PC-Tac)', () => {
    it('pose le pin aux coordonnées, mémorise lastQuickPin, puis ouvre la roue d\'options', () => {
        vi.useFakeTimers();
        try {
            const fake = makeFakeThis({ _loadPins: () => [] });
            const pending: OiCartoPendingPin = { kind: 'cyno', label: 'Cyno' };

            PinsMethods._quickPlacePing.call(fake, { lng: 2.1, lat: 48.1 }, pending);

            expect(fake._savePins).toHaveBeenCalledTimes(1);
            const saved = (fake._savePins as unknown as { mock: { calls: [OiCartoPin[]][] } }).mock.calls[0]?.[0];
            const created = assertNonNull(saved)[0];
            expect(created).toMatchObject({ kind: 'cyno', label: 'Cyno', lng: 2.1, lat: 48.1 });
            expect(fake.lastQuickPin).toBe(pending);
            expect(fake._renderPingLists).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(100);
            expect(fake._openPinWheel).toHaveBeenCalledWith(assertNonNull(created).id);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('_openCreatePinWheel — option « Texte » (paquet carto/text.ts)', () => {
    it('propose une option Texte qui appelle _startFreeText aux coordonnées du clic', () => {
        wheelOptsSpy.mockClear();
        const fake = makeFakeThis({ _loadPins: () => [] });

        PinsMethods._openCreatePinWheel.call(fake, { lng: 2.1, lat: 48.1 });

        const opts = (wheelOptsSpy.mock.calls[0]?.[0] as { options: Array<{ id?: string; action?: () => void }> }).options;
        const textOpt = opts.find((o) => o.id === 'text');
        expect(textOpt).toBeDefined();
        textOpt?.action?.();
        expect(fake._startFreeText).toHaveBeenCalledWith({ lng: 2.1, lat: 48.1 });
    });
});

describe('_wireLongPressForPing — câblé depuis _bindUi (map-core.ts)', () => {
    it('câble l\'appui long UNE seule fois (garde _longPressWired)', () => {
        const on = vi.fn();
        const fake = makeFakeThis({
            map: { on } as unknown as OICartoInternal['map'],
            _loadPins: () => [],
            _longPressWired: undefined,
        });

        PinsMethods._wireLongPressForPing.call(fake);
        expect(fake._longPressWired).toBe(true);
        const callsAfterFirst = on.mock.calls.length;
        expect(callsAfterFirst).toBeGreaterThan(0); // mousedown/touchstart/… posés

        PinsMethods._wireLongPressForPing.call(fake);
        expect(on.mock.calls.length).toBe(callsAfterFirst); // pas de ré-attache
    });
});

describe('_renderPins — CŒUR du module (oi_cartographie.js:904-985)', () => {
    it('sans carte (this.map === null) : ne fait rien, ne jette pas', () => {
        const fake = makeFakeThis({ map: null, _loadPins: () => [makePin({ id: 'p1' })] });
        expect(() => PinsMethods._renderPins.call(fake)).not.toThrow();
        expect(fake.markers.size).toBe(0);
    });

    it('crée un couple de markers (pin + label) par pin et les indexe par id', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1', kind: 'rassemblement', label: 'RDV' })],
        });

        PinsMethods._renderPins.call(fake);

        expect(fake.markers.size).toBe(1);
        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement }; label: { getElement(): HTMLElement } };
        expect(entry.pin.getElement().querySelector('.material-symbols-outlined')?.textContent).toBe('groups');
        expect(entry.label.getElement().textContent).toBe('RDV');
    });

    // INVARIANT MARKERS (PLAN.md §4.7, transposé de PC-Tac) : jamais de
    // `position`/`inset` inline sur l'élément d'un Marker (dérive au zoom +
    // décalage du label) — oi_cartographie.js:919-925 ne pose que
    // width/height/cursor/display/align/justify, jamais position.
    it('INVARIANT MARKERS : aucun `position` inline sur l\'élément du pin', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
        });

        PinsMethods._renderPins.call(fake);

        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };
        const pinEl = entry.pin.getElement();
        expect(pinEl.style.position).toBe('');
        expect(pinEl.style.cssText).not.toMatch(/position\s*:/);
    });

    it('efface les anciens markers avant de re-rendre (this.markers.clear())', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
        });
        PinsMethods._renderPins.call(fake);
        expect(fake.markers.has('p1')).toBe(true);

        fake._loadPins = () => [makePin({ id: 'p2' })];
        PinsMethods._renderPins.call(fake);

        expect(fake.markers.has('p1')).toBe(false);
        expect(fake.markers.has('p2')).toBe(true);
    });

    // R3-d : le `click` DOM (chemin abandonné côté PC-Tac, cf. `pin-gestures.ts`
    // en-tête — annulé par MapLibre lors du `preventDefault` touchstart sur un
    // marker `draggable: true`) est remplacé par la machine partagée
    // `attachPinGestures` (pointer desktop + touch mobile). OI conserve un
    // "tap simple" (pas de double-tap) : desktop = pointerdown+pointerup,
    // mobile = touchstart+touchend.
    it('tap desktop (pointerdown+pointerup) sur le pin ouvre la roue via _openPinWheel(pin.id)', () => {
        const openPinWheel = vi.fn();
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
            _openPinWheel: openPinWheel,
        });

        PinsMethods._renderPins.call(fake);
        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };
        const el = entry.pin.getElement();
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, pointerType: 'mouse' }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, pointerType: 'mouse' }));

        expect(openPinWheel).toHaveBeenCalledWith('p1');
    });

    it('tap mobile (touchstart+touchend) sur le pin ouvre la roue via _openPinWheel(pin.id)', () => {
        const openPinWheel = vi.fn();
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
            _openPinWheel: openPinWheel,
        });

        PinsMethods._renderPins.call(fake);
        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };
        const el = entry.pin.getElement();
        const touch = typeof Touch !== 'undefined'
            ? new Touch({ identifier: 1, target: el, clientX: 10, clientY: 10 })
            : { clientX: 10, clientY: 10, identifier: 1 } as Touch;
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }));
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch] }));

        expect(openPinWheel).toHaveBeenCalledWith('p1');
    });

    it('tap mobile : un drag MapLibre récent empêche l\'ouverture de la roue au touchend', () => {
        const openPinWheel = vi.fn();
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
            _openPinWheel: openPinWheel,
        });

        PinsMethods._renderPins.call(fake);
        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement; _fire(type: string): void } };
        const el = entry.pin.getElement();
        const touch = typeof Touch !== 'undefined'
            ? new Touch({ identifier: 1, target: el, clientX: 10, clientY: 10 })
            : { clientX: 10, clientY: 10, identifier: 1 } as Touch;

        el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }));
        entry.pin._fire('dragstart');
        entry.pin._fire('dragend');
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch] }));

        expect(openPinWheel).not.toHaveBeenCalled();
    });

    it('pointerdown déclenche la suppression du zoom double-clic natif (doubleClickZoom.disable)', () => {
        const disable = vi.fn();
        const enable = vi.fn();
        const fake = makeFakeThis({
            map: { doubleClickZoom: { disable, enable } } as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
        });

        PinsMethods._renderPins.call(fake);
        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };
        const el = entry.pin.getElement();
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, pointerType: 'mouse' }));

        expect(disable).toHaveBeenCalledTimes(1);
    });

    it('dragend : recalcule lng/lat depuis le marker et persiste (_savePins)', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1', lng: 1, lat: 1 })],
        });

        PinsMethods._renderPins.call(fake);
        const entry = fake.markers.get('p1') as { pin: { setLngLat(ll: { lng: number; lat: number }): void; _fire(type: string): void } };
        entry.pin.setLngLat({ lng: 9, lat: 8 });
        entry.pin._fire('dragend');

        const saved = (fake._savePins as unknown as { mock: { calls: [OiCartoPin[]][] } }).mock.calls;
        const lastCall = assertNonNull(saved[saved.length - 1]);
        const updated = assertNonNull(lastCall[0]).find(p => p.id === 'p1');
        expect(updated).toMatchObject({ lng: 9, lat: 8 });
    });
});

// Mission R3-e — réconciliation par signature (cf. en-tête de `pins.ts`) :
// un marker inchangé n'est JAMAIS recréé (même référence, gestes NON
// ré-attachés) ; un marker modifié est mis à jour EN PLACE ; un pin disparu
// détruit son marker ET détache la machine `pin-gestures` (`gestures.detach()`).
describe('_renderPins — réconciliation par signature (mission R3-e)', () => {
    it('signature identique entre deux rendus : conserve la MÊME référence de marker (pas de recréation)', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1', label: 'RDV' })],
        });

        PinsMethods._renderPins.call(fake);
        const entry1 = fake.markers.get('p1');

        // 2e rendu, pins ÉQUIVALENTS (mêmes valeurs, nouvel objet — comme un
        // reload depuis le stockage) : la signature ne change pas.
        fake._loadPins = () => [makePin({ id: 'p1', label: 'RDV' })];
        PinsMethods._renderPins.call(fake);
        const entry2 = fake.markers.get('p1');

        expect(entry2).toBe(entry1); // même entrée, même couple de markers
    });

    it('label modifié : met à jour le contenu du libellé EN PLACE, garde la même référence de marker', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1', label: 'Ancien nom' })],
        });

        PinsMethods._renderPins.call(fake);
        const entry1 = fake.markers.get('p1') as { pin: { getElement(): HTMLElement }; label: { getElement(): HTMLElement } };
        expect(entry1.label.getElement().textContent).toBe('Ancien nom');

        fake._loadPins = () => [makePin({ id: 'p1', label: 'Nouveau nom' })];
        PinsMethods._renderPins.call(fake);
        const entry2 = fake.markers.get('p1') as { pin: { getElement(): HTMLElement }; label: { getElement(): HTMLElement } };

        expect(entry2).toBe(fake.markers.get('p1')); // toujours la même entrée
        expect(entry2.pin).toBe(entry1.pin); // marker pin NON recréé
        expect(entry2.label).toBe(entry1.label); // marker label NON recréé
        expect(entry2.label.getElement().textContent).toBe('Nouveau nom'); // contenu actualisé
    });

    it('pin supprimé : détruit le marker ET détache les gestes (plus de tap → roue après suppression)', () => {
        const openPinWheel = vi.fn();
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
            _openPinWheel: openPinWheel,
        });

        PinsMethods._renderPins.call(fake);
        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };
        const el = entry.pin.getElement();

        fake._loadPins = () => [];
        PinsMethods._renderPins.call(fake);

        expect(fake.markers.has('p1')).toBe(false);
        // Les gestes doivent être détachés (`gestures.detach()`) : un tap sur
        // l'élément retiré ne doit plus déclencher `_openPinWheel`.
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, pointerType: 'mouse' }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, pointerType: 'mouse' }));
        expect(openPinWheel).not.toHaveBeenCalled();
    });

    // Photo↔pin (parité PC-Tac) : `photoId` fait partie de la signature —
    // l'attache/le retrait d'une photo doit actualiser le marker EN PLACE
    // (badge photo), sans recréation.
    it('pin avec photoId : badge photo rendu ; clic sur le badge → _openPinPhotoViewer(pin.id)', () => {
        const openViewer = vi.fn();
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1', photoId: 'img_1' })],
            _openPinPhotoViewer: openViewer,
        });

        PinsMethods._renderPins.call(fake);

        const entry = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };
        const badge = assertNonNull(
            entry.pin.getElement().querySelector<HTMLElement>('.oi-carto-photo-badge'),
            'badge photo absent',
        );
        badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(openViewer).toHaveBeenCalledWith('p1');
    });

    it('photoId ajouté entre deux rendus : signature changée → badge ajouté EN PLACE (marker NON recréé)', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' })],
        });

        PinsMethods._renderPins.call(fake);
        const entry1 = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };
        expect(entry1.pin.getElement().querySelector('.oi-carto-photo-badge')).toBeNull();

        fake._loadPins = () => [makePin({ id: 'p1', photoId: 'img_1' })];
        PinsMethods._renderPins.call(fake);
        const entry2 = fake.markers.get('p1') as { pin: { getElement(): HTMLElement } };

        expect(entry2.pin).toBe(entry1.pin); // pas de recréation (réconciliation)
        expect(entry2.pin.getElement().querySelector('.oi-carto-photo-badge')).not.toBeNull();
    });

    it('un pin conservé et un pin supprimé dans le même rendu : le conservé garde sa référence, le supprimé disparaît', () => {
        const fake = makeFakeThis({
            map: {} as unknown as OICartoInternal['map'],
            _loadPins: () => [makePin({ id: 'p1' }), makePin({ id: 'p2' })],
        });

        PinsMethods._renderPins.call(fake);
        const entryP1 = fake.markers.get('p1');
        expect(fake.markers.size).toBe(2);

        fake._loadPins = () => [makePin({ id: 'p1' })];
        PinsMethods._renderPins.call(fake);

        expect(fake.markers.size).toBe(1);
        expect(fake.markers.get('p1')).toBe(entryP1);
        expect(fake.markers.has('p2')).toBe(false);
    });
});
