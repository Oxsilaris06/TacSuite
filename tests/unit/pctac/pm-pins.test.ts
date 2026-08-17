/**
 * pm-pins.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-pins` :
 * `planmap/pins.ts` (15 méthodes PINGS, §4.6 de docs/SPEC-PLANMAP-SPLIT.md).
 * Références `planMap.js:<ligne>` en commentaire.
 *
 * ⚠ PAQUET À 3 INVARIANTS (SPEC-PLANMAP-SPLIT §5.1-§5.3) : chaque section
 * porte le test obligatoire correspondant, voir les `describe` marqués
 * « INVARIANT n ».
 *
 * `this` FACTICE : combine les VRAIES méthodes de `PinsMethods` (le groupe
 * sous test) + les VRAIES `GeoMethods`/`SafeMethods` (pures, déjà portées et
 * testées — pm-geo.test.ts / pm-core.test.ts) + des stubs `vi.fn()` pour les
 * méthodes des AUTRES paquets (chrome.ts, wheels.ts, measure.ts). Jamais
 * `new maplibregl.Map` (WebGL absent sous jsdom, SPEC-PCTAC-CONVERSION §8.4) ;
 * `maplibregl.Marker` est mocké pour `_renderPins`/`_bindPinListeners` (même
 * technique que pm-shapesrender.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapMouseEvent } from 'maplibre-gl';

import { ADVERSARIES_KEY } from '../../../src/apps/pctac/config.js';
import { Storage } from '../../../src/apps/pctac/storage.js';
import { GeoMethods } from '../../../src/apps/pctac/planmap/geo.js';
import { PINS_KEY } from '../../../src/apps/pctac/planmap/constants.js';
import { PinsMethods } from '../../../src/apps/pctac/planmap/pins.js';
import { SafeMethods, createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PinEntry, PlanMapInternal, PlanPin } from '../../../src/apps/pctac/planmap/types.js';

/** Narrowing sans `!` (interdit par la mission) : jette explicitement si null/undefined. */
function assertNonNull<T>(value: T | null | undefined, message = 'expected non-null value'): T {
    if (value === null || value === undefined) throw new Error(message);
    return value;
}

// FakeMarker : cf. pm-shapesrender.test.ts (une vraie instance maplibregl.Marker
// appelle des méthodes internes de maplibregl.Map lors de addTo(), qu'un faux
// `map` minimal ne fournit pas — vérifié : jette sous jsdom). `pins.ts` utilise
// en plus `.on()`, `.setOffset()`, `.setDraggable()` du vrai Marker.
vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        private _lngLat: { lng: number; lat: number };
        private _draggableCalls: boolean[] = [];
        private _offsetCalls: unknown[] = [];
        private _listeners = new Map<string, () => void>();
        constructor(opts: { element?: HTMLElement } = {}) {
            this._element = opts.element ?? document.createElement('div');
            this._lngLat = { lng: 0, lat: 0 };
        }
        setLngLat(ll: { lng: number; lat: number }): this { this._lngLat = ll; return this; }
        getLngLat(): { lng: number; lat: number } { return this._lngLat; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return this._element; }
        setOffset(o: unknown): this { this._offsetCalls.push(o); return this; }
        setDraggable(v: boolean): this { this._draggableCalls.push(v); return this; }
        on(type: string, cb: () => void): this { this._listeners.set(type, cb); return this; }
        // Aides de test (pas de la surface maplibre réelle) :
        _fire(type: string): void { this._listeners.get(type)?.(); }
        _lastDraggable(): boolean | undefined { return this._draggableCalls.at(-1); }
    }
    return { default: { Marker: FakeMarker } };
});

/** Construit un `this` factice conforme à `PlanMapInternal` pour `PinsMethods`. */
function makeFakeThis(overrides: Partial<PlanMapInternal> = {}): PlanMapInternal {
    const state = createPlanMapState();
    return {
        ...state,
        ...SafeMethods,
        ...GeoMethods,
        ...PinsMethods,
        // Méthodes d'AUTRES paquets, stubbées (jamais exercées ici).
        _showHint: vi.fn(),
        _hideHint: vi.fn(),
        _openPingOptionsWheel: vi.fn(),
        _measureAddVertex: vi.fn(),
        ...overrides,
    } as PlanMapInternal;
}

function makePin(overrides: Partial<PlanPin> & Pick<PlanPin, 'id'>): PlanPin {
    return { lng: 2.35, lat: 48.85, label: 'Ping', color: '#3b82f6', kind: 'libre', ...overrides };
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('_buildPinVisual — INVARIANT 1 (SPEC-PLANMAP-SPLIT §5.1) : jamais de `position` inline sur pinWrap', () => {
    function makeEntry(pin: PlanPin): PinEntry {
        return {
            pin,
            pinWrap: document.createElement('div'),
            labelEl: document.createElement('div'),
            pinMarker: null,
            labelMarker: null,
            sig: null,
            _anchor: null,
        };
    }

    it('branche icône personnalisée (customIcon) : pinWrap.style.position === \'\'', () => {
        const fake = makeFakeThis();
        const entry = makeEntry(makePin({ id: 'p1', icon: 'local_police' }));

        PinsMethods._buildPinVisual.call(fake, entry);

        expect(entry.pinWrap.style.position).toBe('');
        expect(entry.pinWrap.style.cssText).not.toMatch(/position\s*:/);
        expect(entry.pinWrap.style.cssText).not.toMatch(/inset\s*:/);
    });

    it('branche SVG par défaut (pas d\'icône, pas Vehicule) : pinWrap.style.position === \'\'', () => {
        const fake = makeFakeThis();
        const entry = makeEntry(makePin({ id: 'p2' })); // pas de icon, kind='libre'

        PinsMethods._buildPinVisual.call(fake, entry);

        expect(entry.pinWrap.style.position).toBe('');
        expect(entry.pinWrap.style.cssText).not.toMatch(/position\s*:/);
        expect(entry.pinWrap.style.cssText).not.toMatch(/inset\s*:/);
    });

    it('le badge cadenas ajouté, lui, est bien `position:absolute` (planMap.js:1266)', () => {
        const fake = makeFakeThis();
        const entry = makeEntry(makePin({ id: 'p3' }));

        PinsMethods._buildPinVisual.call(fake, entry);

        const badge = entry.pinWrap.querySelector('.plan-lock-badge');
        const badgeEl = assertNonNull(badge as HTMLElement | null);
        expect(badgeEl.style.position).toBe('absolute');
    });
});

describe('_makeLockBadge — INVARIANT 2a (SPEC-PLANMAP-SPLIT §5.2) : stopPropagation triple', () => {
    it('pointerdown sur le badge : un listener posé sur un PARENT ne le reçoit pas', () => {
        const fake = makeFakeThis();
        const onToggle = vi.fn();
        const badge = PinsMethods._makeLockBadge.call(fake, false, onToggle, 'corner');

        const parent = document.createElement('div');
        parent.appendChild(badge);
        document.body.appendChild(parent);
        const parentHandler = vi.fn();
        parent.addEventListener('pointerdown', parentHandler);

        badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

        expect(parentHandler).not.toHaveBeenCalled();
        parent.remove();
    });

    it('mousedown sur le badge : stoppé avant le parent', () => {
        const fake = makeFakeThis();
        const badge = PinsMethods._makeLockBadge.call(fake, false, vi.fn(), 'corner');
        const parent = document.createElement('div');
        parent.appendChild(badge);
        const parentHandler = vi.fn();
        parent.addEventListener('mousedown', parentHandler);

        badge.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(parentHandler).not.toHaveBeenCalled();
    });

    it('touchstart sur le badge : stoppé avant le parent (listener passive)', () => {
        const fake = makeFakeThis();
        const badge = PinsMethods._makeLockBadge.call(fake, false, vi.fn(), 'corner');
        const parent = document.createElement('div');
        parent.appendChild(badge);
        const parentHandler = vi.fn();
        parent.addEventListener('touchstart', parentHandler);

        badge.dispatchEvent(new Event('touchstart', { bubbles: true }));

        expect(parentHandler).not.toHaveBeenCalled();
    });

    it('un clic sur le badge appelle onToggle', () => {
        const fake = makeFakeThis();
        const onToggle = vi.fn();
        const badge = PinsMethods._makeLockBadge.call(fake, true, onToggle, 'corner');

        badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('variant "corner" pose position:absolute ; variant "marker" non (planMap.js:1265-1267)', () => {
        const fake = makeFakeThis();
        const corner = PinsMethods._makeLockBadge.call(fake, false, vi.fn(), 'corner');
        const marker = PinsMethods._makeLockBadge.call(fake, false, vi.fn(), 'marker');
        expect(corner.style.position).toBe('absolute');
        expect(marker.style.position).toBe('');
    });
});

describe('_pinSignature — INVARIANT 2b (SPEC-PLANMAP-SPLIT §5.3) : verrou par-ping ≠ verrou global', () => {
    it('change quand pin.locked change', () => {
        const fake = makeFakeThis();
        const pin = makePin({ id: 'p1' });
        const sigBefore = PinsMethods._pinSignature.call(fake, pin);
        const sigAfter = PinsMethods._pinSignature.call(fake, { ...pin, locked: true });
        expect(sigAfter).not.toBe(sigBefore);
    });

    it('change quand this._locked (verrou global) change, à pin identique', () => {
        const fake = makeFakeThis();
        const pin = makePin({ id: 'p1' });
        const sigUnlocked = PinsMethods._pinSignature.call({ ...fake, _locked: false }, pin);
        const sigLocked = PinsMethods._pinSignature.call({ ...fake, _locked: true }, pin);
        expect(sigLocked).not.toBe(sigUnlocked);
    });

    it('change quand la position (lng/lat) change', () => {
        const fake = makeFakeThis();
        const pin = makePin({ id: 'p1' });
        const sigA = PinsMethods._pinSignature.call(fake, pin);
        const sigB = PinsMethods._pinSignature.call(fake, { ...pin, lng: pin.lng + 0.01 });
        expect(sigB).not.toBe(sigA);
    });

    it('change quand pin.photoId change (photo↔ping, Goal.md §4 — piège 1 : sans ce champ, badge jamais redessiné)', () => {
        const fake = makeFakeThis();
        const pin = makePin({ id: 'p1' });
        const sigBefore = PinsMethods._pinSignature.call(fake, pin);
        const sigAfter = PinsMethods._pinSignature.call(fake, { ...pin, photoId: 'ph1' });
        expect(sigAfter).not.toBe(sigBefore);
    });

    it('ne change PAS pour un pin strictement identique (rendu stable, zéro jank)', () => {
        const fake = makeFakeThis();
        const pin = makePin({ id: 'p1' });
        expect(PinsMethods._pinSignature.call(fake, pin)).toBe(PinsMethods._pinSignature.call(fake, { ...pin }));
    });
});

describe('_togglePinLock — INVARIANT 2b (SPEC-PLANMAP-SPLIT §5.3) : défaut reopenWheel=true', () => {
    it('sans 2e argument, réouvre la roue (appelé depuis la roue)', () => {
        const openWheel = vi.fn();
        const fake = makeFakeThis({ _openPingOptionsWheel: openWheel });
        fake._savePins([makePin({ id: 'p1', locked: false })]);

        PinsMethods._togglePinLock.call(fake, 'p1');

        expect(openWheel).toHaveBeenCalledWith('p1');
        expect(fake._loadPins().find((p) => p.id === 'p1')?.locked).toBe(true);
    });

    it('avec reopenWheel=false explicite (cadenas direct, planMap.js:1336), ne réouvre pas', () => {
        const openWheel = vi.fn();
        const fake = makeFakeThis({ _openPingOptionsWheel: openWheel });
        fake._savePins([makePin({ id: 'p1', locked: false })]);

        PinsMethods._togglePinLock.call(fake, 'p1', false);

        expect(openWheel).not.toHaveBeenCalled();
        expect(fake._loadPins().find((p) => p.id === 'p1')?.locked).toBe(true);
    });

    it('id inconnu : no-op silencieux', () => {
        const fake = makeFakeThis();
        expect(() => PinsMethods._togglePinLock.call(fake, 'inexistant')).not.toThrow();
    });
});

describe('_resolvePin', () => {
    it('entité supprimée (collection vide) → label \'[supprimé]\'', () => {
        const pin = makePin({ id: 'p1', entityRef: { kind: 'adv', id: 'adv-inexistant' } });
        const resolved = PinsMethods._resolvePin(pin);
        expect(resolved.label).toBe('[supprimé]');
    });

    it('entité présente → nom prénom, couleur ENTITY_COLORS[kind]', () => {
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'adv-1', nom: 'Dupont', prenom: 'Jean' }]);
        const pin = makePin({ id: 'p1', entityRef: { kind: 'adv', id: 'adv-1' } });
        const resolved = PinsMethods._resolvePin(pin);
        expect(resolved.label).toBe('Dupont Jean');
        expect(resolved.color).toBe('#ef4444');
        expect(resolved.kind).toBe('adv');
    });

    it('entité sans nom/prenom, avec unite → unite ; sans rien → "(sans nom)"', () => {
        Storage.saveCollection(ADVERSARIES_KEY, [
            { id: 'adv-2', unite: 'Groupe Alpha' },
            { id: 'adv-3' },
        ]);
        expect(PinsMethods._resolvePin(makePin({ id: 'p1', entityRef: { kind: 'adv', id: 'adv-2' } })).label).toBe('Groupe Alpha');
        expect(PinsMethods._resolvePin(makePin({ id: 'p2', entityRef: { kind: 'adv', id: 'adv-3' } })).label).toBe('(sans nom)');
    });

    it('ping libre → label/color/kind du pin, kind="libre" par défaut', () => {
        const resolved = PinsMethods._resolvePin(makePin({ id: 'p1', label: 'Poste', color: '#111', kind: undefined }));
        expect(resolved).toEqual({ label: 'Poste', color: '#111', kind: 'libre' });
    });
});

describe('getPinsSummary — CONTRAT C2 : ne jette jamais, [] en cas d\'échec', () => {
    it('résumé normal (label/lat/lng/diameterM)', () => {
        const fake = makeFakeThis();
        fake._savePins([
            makePin({ id: 'p1', label: 'A', lat: 1, lng: 2, diameterM: 500 }),
            makePin({ id: 'p2', label: 'B', lat: 3, lng: 4 }),
        ]);
        const summary = PinsMethods.getPinsSummary.call(fake);
        expect(summary).toEqual([
            { label: 'A', lat: 1, lng: 2, diameterM: 500 },
            { label: 'B', lat: 3, lng: 4, diameterM: null },
        ]);
    });

    it('JSON corrompu sous PINS_KEY → [] (Persist dégrade, ne jette pas)', () => {
        localStorage.setItem(PINS_KEY, '{ceci n\'est pas du JSON');
        const fake = makeFakeThis();
        expect(() => PinsMethods.getPinsSummary.call(fake)).not.toThrow();
        expect(PinsMethods.getPinsSummary.call(fake)).toEqual([]);
    });

    it('stockage cassé au sens fort (_loadPins jette) → [] sans propager (catch externe, planMap.js:5042)', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const fake = makeFakeThis({
            _loadPins: () => { throw new Error('storage indisponible'); },
        });
        expect(() => PinsMethods.getPinsSummary.call(fake)).not.toThrow();
        expect(PinsMethods.getPinsSummary.call(fake)).toEqual([]);
        expect(errSpy).toHaveBeenCalled();
    });

    it('diameterM <= 0 ou non numérique → null', () => {
        const fake = makeFakeThis();
        fake._savePins([makePin({ id: 'p1', diameterM: 0 }), makePin({ id: 'p2', diameterM: -5 })]);
        const summary = PinsMethods.getPinsSummary.call(fake);
        expect(summary.every((s) => s.diameterM === null)).toBe(true);
    });
});

describe('_addPin / _removePin / _loadPins / _savePins — CRUD (planMap.js:1190-1214)', () => {
    it('_addPin ajoute et persiste (round-trip via _loadPins)', () => {
        const fake = makeFakeThis();
        PinsMethods._addPin.call(fake, makePin({ id: 'p1' }));
        expect(fake._loadPins().map((p) => p.id)).toEqual(['p1']);
    });

    it('_removePin retire uniquement l\'id ciblé', () => {
        const fake = makeFakeThis();
        fake._savePins([makePin({ id: 'p1' }), makePin({ id: 'p2' })]);
        PinsMethods._removePin.call(fake, 'p1');
        expect(fake._loadPins().map((p) => p.id)).toEqual(['p2']);
    });

    it('_loadPins retourne [] si la clé est absente', () => {
        const fake = makeFakeThis();
        expect(fake._loadPins()).toEqual([]);
    });
});

describe('_onMapClick (planMap.js:1156-1188)', () => {
    function makeClick(lng: number, lat: number): MapMouseEvent {
        // Fixture partielle (même idiome que pm-drawtools.test.ts) : seul
        // `e.lngLat` est lu par `_onMapClick`.
        return { lngLat: { lng, lat } } as unknown as MapMouseEvent;
    }

    it('mode mesure : délègue à _measureAddVertex et sort (pas de ping créé)', () => {
        const measureAddVertex = vi.fn();
        const fake = makeFakeThis({ drawTool: 'measure', _measureState: { vertices: [], cursor: null, reticle: false }, _measureAddVertex: measureAddVertex });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(measureAddVertex).toHaveBeenCalledWith([1, 2]);
        expect(fake._loadPins()).toEqual([]);
    });

    it('drawTool actif (hors mesure) : clic ignoré', () => {
        const fake = makeFakeThis({ drawTool: 'line', pendingFreePin: { label: 'X', color: '#fff', kind: 'libre', icon: '' } });
        PinsMethods._onMapClick.call(fake, makeClick(1, 2));
        expect(fake._loadPins()).toEqual([]);
    });

    it('pendingEntityPin : pose un ping lié-entité puis vide pendingEntityPin', () => {
        const hideHint = vi.fn();
        const fake = makeFakeThis({ pendingEntityPin: { kind: 'adv', id: 'adv-1' }, _hideHint: hideHint });
        PinsMethods._onMapClick.call(fake, makeClick(2.1, 48.1));
        const pins = fake._loadPins();
        expect(pins).toHaveLength(1);
        expect(pins[0]?.entityRef).toEqual({ kind: 'adv', id: 'adv-1' });
        expect(fake.pendingEntityPin).toBeNull();
        expect(hideHint).toHaveBeenCalled();
    });

    it('pendingFreePin : pose un ping libre puis vide pendingFreePin', () => {
        const fake = makeFakeThis({ pendingFreePin: { label: 'Poste', color: '#ef4444', kind: 'Adv', icon: 'flag' } });
        PinsMethods._onMapClick.call(fake, makeClick(2.1, 48.1));
        const pins = fake._loadPins();
        expect(pins).toHaveLength(1);
        expect(pins[0]?.label).toBe('Poste');
        expect(fake.pendingFreePin).toBeNull();
    });
});

describe('_renderPins — réconciliation par ID + INVARIANT 2b (draggable, planMap.js:1494-1565)', () => {
    it('création : draggable = !this._locked && !pin.locked (les deux faux → true)', () => {
        const map = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const fake = makeFakeThis({ map: map as unknown as PlanMapInternal['map'], _locked: false });
        fake._savePins([makePin({ id: 'p1', locked: false })]);

        PinsMethods._renderPins.call(fake);

        const pinMarkers = assertNonNull(fake._pinMarkers);
        const entry = assertNonNull(pinMarkers.get('p1'));
        expect(entry.pinMarker).not.toBeNull();
    });

    it('verrou global OU par-ping → setDraggable(false) lors d\'une mise à jour en place', () => {
        const map = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const fake = makeFakeThis({ map: map as unknown as PlanMapInternal['map'], _locked: false });
        fake._savePins([makePin({ id: 'p1', locked: false })]);
        PinsMethods._renderPins.call(fake);

        // Bascule le verrou GLOBAL puis re-rend : _pinSignature doit changer
        // (INVARIANT 2b) et déclencher la maj en place → setDraggable(false).
        fake._locked = true;
        PinsMethods._renderPins.call(fake);

        const pinMarkers = assertNonNull(fake._pinMarkers);
        const entry = assertNonNull(pinMarkers.get('p1'));
        // Accès aux aides de test du FakeMarker (cf. mock 'maplibre-gl' ci-dessus).
        const marker = entry.pinMarker as unknown as { _lastDraggable(): boolean | undefined };
        expect(marker._lastDraggable()).toBe(false);
    });

    it('id disparu du stockage → le marker est supprimé de _pinMarkers', () => {
        const map = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const fake = makeFakeThis({ map: map as unknown as PlanMapInternal['map'] });
        fake._savePins([makePin({ id: 'p1' }), makePin({ id: 'p2' })]);
        PinsMethods._renderPins.call(fake);

        fake._savePins([makePin({ id: 'p2' })]);
        PinsMethods._renderPins.call(fake);

        const pinMarkers = assertNonNull(fake._pinMarkers);
        expect(pinMarkers.has('p1')).toBe(false);
        expect(pinMarkers.has('p2')).toBe(true);
    });

    // Non-régression : `icon` fait partie de `_pinSignature` (pins.ts:183) au
    // même titre que `color`/`text`/`locked`/`photoId` — un changement d'icône
    // via la roue d'options (`_openIconCatalogPanelForEdit`, panels.ts) doit
    // repeindre le glyph du marker EN PLACE, sans recréation, sans zoom.
    it('icône modifiée : repeint pinWrap EN PLACE, garde la même référence de marker', () => {
        const map = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const fake = makeFakeThis({ map: map as unknown as PlanMapInternal['map'] });
        fake._savePins([makePin({ id: 'p1', icon: 'place' })]);
        PinsMethods._renderPins.call(fake);

        const pinMarkers = assertNonNull(fake._pinMarkers);
        const entry1 = assertNonNull(pinMarkers.get('p1'));
        expect(entry1.pinWrap.innerHTML).toContain('place');

        fake._savePins([makePin({ id: 'p1', icon: 'star' })]);
        PinsMethods._renderPins.call(fake);

        const entry2 = assertNonNull(pinMarkers.get('p1'));
        expect(entry2).toBe(entry1); // même entrée (pas de recréation)
        expect(entry2.pinMarker).toBe(entry1.pinMarker); // marker pin NON recréé
        expect(entry2.pinWrap).toBe(entry1.pinWrap); // même élément DOM
        expect(entry2.pinWrap.innerHTML).toContain('star'); // glyph actualisé
        expect(entry2.pinWrap.innerHTML).not.toContain('place');
    });

    it('sans carte (this.map === null) : ne fait rien, ne jette pas', () => {
        const fake = makeFakeThis({ map: null });
        fake._savePins([makePin({ id: 'p1' })]);
        expect(() => PinsMethods._renderPins.call(fake)).not.toThrow();
        expect(fake._pinMarkers).toBeNull();
    });

    it('optimisation mobile : pinWrap possède une taille cible tactile (44px) et déclenche _suppressDblZoom au pointerdown', () => {
        const suppressDblZoom = vi.fn();
        const map = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const fake = makeFakeThis({
            map: map as unknown as PlanMapInternal['map'],
            _suppressDblZoom: suppressDblZoom,
        });
        fake._savePins([makePin({ id: 'p-mobile' })]);
        PinsMethods._renderPins.call(fake);

        const pinMarkers = assertNonNull(fake._pinMarkers);
        const entry = assertNonNull(pinMarkers.get('p-mobile'));
        expect(entry.pinWrap.style.minWidth).toBe('44px');
        expect(entry.pinWrap.style.minHeight).toBe('44px');

        // Événement touchstart tactile
        const touch = typeof Touch !== 'undefined'
            ? new Touch({ identifier: 1, target: entry.pinWrap, clientX: 10, clientY: 10 })
            : { clientX: 10, clientY: 10, identifier: 1 } as Touch;
        entry.pinWrap.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }));
        expect(suppressDblZoom).toHaveBeenCalledTimes(1);
    });

    it('mobile : double tap sur pinWrap (2 taps < 600ms) ouvre la roue d\'édition', () => {
        const openWheel = vi.fn();
        const map = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const fake = makeFakeThis({
            map: map as unknown as PlanMapInternal['map'],
            _openPingOptionsWheel: openWheel,
        });
        fake._savePins([makePin({ id: 'p-touch' })]);
        PinsMethods._renderPins.call(fake);

        const pinMarkers = assertNonNull(fake._pinMarkers);
        const entry = assertNonNull(pinMarkers.get('p-touch'));

        const touch = typeof Touch !== 'undefined'
            ? new Touch({ identifier: 1, target: entry.pinWrap, clientX: 10, clientY: 10 })
            : { clientX: 10, clientY: 10, identifier: 1 } as Touch;

        // 1er tap : enregistre le 1er tap
        entry.pinWrap.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }));
        entry.pinWrap.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch] }));
        // 2ème tap : déclenche l'ouverture de la roue
        entry.pinWrap.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }));
        entry.pinWrap.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch] }));
        expect(openWheel).toHaveBeenCalledWith('p-touch');
    });

    it('mobile : un drag MapLibre empêche l\'ouverture de la roue au touchend', () => {
        const openWheel = vi.fn();
        const map = { getSource: vi.fn(), addSource: vi.fn(), addLayer: vi.fn() };
        const fake = makeFakeThis({
            map: map as unknown as PlanMapInternal['map'],
            _openPingOptionsWheel: openWheel,
        });
        fake._savePins([makePin({ id: 'p-drag' })]);
        PinsMethods._renderPins.call(fake);

        const pinMarkers = assertNonNull(fake._pinMarkers);
        const entry = assertNonNull(pinMarkers.get('p-drag'));

        // Début du touch
        const touch = typeof Touch !== 'undefined'
            ? new Touch({ identifier: 1, target: entry.pinWrap, clientX: 10, clientY: 10 })
            : { clientX: 10, clientY: 10, identifier: 1 } as Touch;
        entry.pinWrap.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch] }));

        // MapLibre déclenche un drag
        (entry.pinMarker as unknown as { _fire(t: string): void })._fire('dragstart');
        (entry.pinMarker as unknown as { _fire(t: string): void })._fire('dragend');

        // Fin du touch
        entry.pinWrap.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch] }));

        // La roue ne doit PAS être ouverte après un drag
        expect(openWheel).not.toHaveBeenCalled();
    });
});

