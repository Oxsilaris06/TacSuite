/**
 * pm-wheels.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-wheels` :
 * `planmap/wheels.ts` (7 méthodes « ROUES CONTEXTUELLES », §4.12 de
 * docs/SPEC-PLANMAP-SPLIT.md). Références `planMap.js:<ligne>` en commentaire.
 *
 * `this` est TOUJOURS factice (jamais `new maplibregl.Map`, cf. §8.4 de
 * docs/SPEC-PCTAC-CONVERSION.md) : `makeFakeThis()` construit un objet
 * combinant les 7 VRAIES méthodes de `WheelsMethods` (le groupe sous test —
 * leurs appels croisés `this._closeWheel()`, `this._otanColors()` doivent
 * s'exécuter pour de vrai) et des stubs `vi.fn()` pour les méthodes des
 * AUTRES paquets (pins.ts, shapes-render.ts, panels.ts, text-modal.ts,
 * chrome.ts, draw-tools.ts). `_loadPins`/`_addPin`/`_removePin` et
 * `_loadShapes` partagent un tableau en mémoire pour permettre un test
 * d'intégration réaliste de `_quickPlacePing` → `_openPingOptionsWheel`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatCoordsClipboard, shortMgrs } from '../../../src/shared/coords.js';
import { WheelsMethods } from '../../../src/apps/pctac/planmap/wheels.js';
import type { PlanMapInternal, PlanPin, PlanShape, PlanWheel } from '../../../src/apps/pctac/planmap/types.js';

/** Narrowing sans `!` (interdit par la mission) : jette explicitement si null/undefined. */
function assertNonNull<T>(value: T | null | undefined, message = 'expected non-null value'): T {
    if (value === null || value === undefined) throw new Error(message);
    return value;
}

function makeFakeThis() {
    const pins: PlanPin[] = [];
    const shapes: PlanShape[] = [];

    const showHint = vi.fn();
    const hideHint = vi.fn();
    const addPin = vi.fn((pin: PlanPin) => { pins.push(pin); });
    const removePin = vi.fn((id: string) => {
        const i = pins.findIndex((p) => p.id === id);
        if (i >= 0) pins.splice(i, 1);
    });
    const loadPins = vi.fn((): PlanPin[] => pins);
    const loadShapes = vi.fn((): PlanShape[] => shapes);
    const saveShapes = vi.fn();
    const pushHistory = vi.fn();
    const deselectShape = vi.fn();
    const renderShapes = vi.fn();
    const refreshUndoRedoButtons = vi.fn();
    const openTextModal = vi.fn();
    const adjustFontSize = vi.fn();
    const adjustStrokeWidth = vi.fn();
    const toggleShapeDiameter = vi.fn();
    const toggleShapeLock = vi.fn();
    const openIconCatalogPanel = vi.fn();
    const openIconCatalogPanelForEdit = vi.fn();
    const openPinColorPanel = vi.fn();
    const editPinText = vi.fn();
    const editPinDiameter = vi.fn();
    const togglePinLock = vi.fn();

    const base = {
        map: null,
        _activeWheel: null,
        _wheelJustClosed: 0,
        _diameterGlobal: true,
        _showHint: showHint,
        _hideHint: hideHint,
        _addPin: addPin,
        _removePin: removePin,
        _loadPins: loadPins,
        _loadShapes: loadShapes,
        _saveShapes: saveShapes,
        _pushHistory: pushHistory,
        _deselectShape: deselectShape,
        _renderShapes: renderShapes,
        _refreshUndoRedoButtons: refreshUndoRedoButtons,
        _openTextModal: openTextModal,
        _adjustFontSize: adjustFontSize,
        _adjustStrokeWidth: adjustStrokeWidth,
        _toggleShapeDiameter: toggleShapeDiameter,
        _toggleShapeLock: toggleShapeLock,
        _openIconCatalogPanel: openIconCatalogPanel,
        _openIconCatalogPanelForEdit: openIconCatalogPanelForEdit,
        _openPinColorPanel: openPinColorPanel,
        _editPinText: editPinText,
        _editPinDiameter: editPinDiameter,
        _togglePinLock: togglePinLock,
        // Les 7 vraies méthodes du groupe sous test : appels croisés réels
        // (`this._closeWheel()`, `this._otanColors()`, etc.).
        ...WheelsMethods,
    };
    // Cast légitime this-factice (cf. docs/SPEC-PLANMAP-SPLIT.md §1.2 point 4 et
    // tests/unit/pctac/pm-core.test.ts : `{} as PlanMapInternal`) : `base` ne
    // porte que le sous-ensemble de `PlanMapInternal` réellement exercé par les
    // 7 méthodes de wheels.ts, jamais `new maplibregl.Map`. Passage par
    // `unknown` requis (recommandation TS2352) : trop peu des ~100 membres de
    // `PlanMapInternal` sont présents pour un simple `as` — ni `any` ni `!`.
    const fake = base as unknown as PlanMapInternal;

    return {
        fake, pins, shapes,
        showHint, hideHint, addPin, removePin, loadPins, loadShapes, saveShapes,
        pushHistory, deselectShape, renderShapes, refreshUndoRedoButtons,
        openTextModal, adjustFontSize, adjustStrokeWidth, toggleShapeDiameter, toggleShapeLock,
        openIconCatalogPanel, openIconCatalogPanelForEdit, openPinColorPanel,
        editPinText, editPinDiameter, togglePinLock,
    };
}

function makeFakeWheel(): { wheel: PlanWheel; destroy: ReturnType<typeof vi.fn> } {
    const destroy = vi.fn();
    const wheel: PlanWheel = {
        lngLat: null,
        element: null,
        open: vi.fn(),
        destroy,
    };
    return { wheel, destroy };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('wheels.ts — smoke : les 7 méthodes ne jettent pas sans DOM applicatif', () => {
    it('_closeWheel, _copyCoords, _otanColors, _openCreatePingWheel, _quickPlacePing, _openPingOptionsWheel, _openShapeWheel', () => {
        vi.stubGlobal('navigator', {});
        const { fake, pins, shapes } = makeFakeThis();
        pins.push({ id: 'p1', lng: 2.35, lat: 48.85, label: 'Sentinelle' });
        shapes.push({ id: 's1', type: 'line', coords: [[0, 0], [1, 1]] });

        expect(() => WheelsMethods._closeWheel.call(fake)).not.toThrow();
        expect(() => WheelsMethods._copyCoords.call(fake, 2.35, 48.85)).not.toThrow();
        expect(() => WheelsMethods._otanColors()).not.toThrow();
        expect(() => WheelsMethods._openCreatePingWheel.call(fake, { lng: 2.35, lat: 48.85 })).not.toThrow();
        expect(() => WheelsMethods._quickPlacePing.call(fake, { lng: 2.35, lat: 48.85 }, { kind: 'Adv', color: '#ef4444' }, 'person_alert')).not.toThrow();
        expect(() => WheelsMethods._openPingOptionsWheel.call(fake, 'p1')).not.toThrow();
        expect(() => WheelsMethods._openShapeWheel.call(fake, 's1', { lng: 0, lat: 0 })).not.toThrow();
    });
});

describe('wheels.ts — _closeWheel (planMap.js:3532-3536)', () => {
    it('détruit la roue active, la met à null, pose _wheelJustClosed', () => {
        const { fake } = makeFakeThis();
        const { wheel, destroy } = makeFakeWheel();
        fake._activeWheel = wheel;
        const before = Date.now();

        WheelsMethods._closeWheel.call(fake);

        expect(destroy).toHaveBeenCalledTimes(1);
        expect(fake._activeWheel).toBeNull();
        expect(fake._wheelJustClosed).toBeGreaterThanOrEqual(before);
    });

    it('aucune roue active : ne jette pas, pose quand même _wheelJustClosed', () => {
        const { fake } = makeFakeThis();
        expect(fake._activeWheel).toBeNull();

        expect(() => WheelsMethods._closeWheel.call(fake)).not.toThrow();

        expect(fake._activeWheel).toBeNull();
        expect(fake._wheelJustClosed).toBeGreaterThan(0);
    });

    it('destroy() qui jette est absorbé par le try/catch (planMap.js:3534)', () => {
        const { fake } = makeFakeThis();
        const { wheel, destroy } = makeFakeWheel();
        destroy.mockImplementation(() => { throw new Error('boom'); });
        fake._activeWheel = wheel;

        expect(() => WheelsMethods._closeWheel.call(fake)).not.toThrow();
        expect(fake._activeWheel).toBeNull();
    });
});

describe('wheels.ts — _copyCoords (planMap.js:3538-3570)', () => {
    it('clipboard résout → hint de succès contenant shortMgrs (planMap.js:3546-3548)', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const { fake, showHint } = makeFakeThis();

        WheelsMethods._copyCoords.call(fake, 2.3522, 48.8566);

        expect(writeText).toHaveBeenCalledWith(formatCoordsClipboard(2.3522, 48.8566));
        await vi.waitFor(() => expect(showHint).toHaveBeenCalled());
        expect(showHint).toHaveBeenCalledWith(expect.stringContaining('copiées'));
        expect(showHint).toHaveBeenCalledWith(expect.stringContaining(shortMgrs(2.3522, 48.8566)));
    });

    it('clipboard rejette → repli execCommand (indisponible sous jsdom) → hint d\'échec (planMap.js:3549-3563)', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const { fake, showHint } = makeFakeThis();

        WheelsMethods._copyCoords.call(fake, 2.3522, 48.8566);

        await vi.waitFor(() => expect(showHint).toHaveBeenCalled());
        expect(showHint).toHaveBeenCalledWith(expect.stringContaining('impossible'));
        expect(showHint).toHaveBeenCalledWith(expect.stringContaining(shortMgrs(2.3522, 48.8566)));
    });

    it('navigator.clipboard absent (cas réel jsdom) → repli direct, synchrone, sans throw (planMap.js:3565-3569)', () => {
        vi.stubGlobal('navigator', {});
        const { fake, showHint } = makeFakeThis();

        expect(() => WheelsMethods._copyCoords.call(fake, 2.3522, 48.8566)).not.toThrow();

        expect(showHint).toHaveBeenCalledWith(expect.stringContaining('impossible'));
    });
});

describe('wheels.ts — _otanColors (planMap.js:3572-3583)', () => {
    it('retourne les 5 couleurs OTAN attendues, dans l\'ordre, avec defaultLabel sur Oscar seulement', () => {
        const list = WheelsMethods._otanColors();

        expect(list).toHaveLength(5);
        expect(list.map((o) => o.kind)).toEqual(['Adv', 'Otage', 'Inter', 'Oscar', 'Inconnu']);
        expect(list.map((o) => o.color)).toEqual(['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#94a3b8']);
        expect(list.map((o) => o.icon)).toEqual(['person_alert', 'person_off', 'local_police', 'military_tech', 'help']);
        expect(list.find((o) => o.kind === 'Oscar')?.defaultLabel).toBe('Oscar');
        expect(list.filter((o) => o.defaultLabel !== undefined)).toHaveLength(1);
    });
});

describe('wheels.ts — _openCreatePingWheel (planMap.js:3591-3626)', () => {
    it('ouvre une roue avec titre "Nouveau ping" et 8 options (5 OTAN + entité + catalogue + copier coords)', () => {
        const { fake } = makeFakeThis();

        WheelsMethods._openCreatePingWheel.call(fake, { lng: 2.35, lat: 48.85 });

        const activeWheel = assertNonNull(fake._activeWheel);
        expect(activeWheel.element).not.toBeNull();
        const wrap = document.body.querySelector('.plan-wheel');
        expect(wrap).not.toBeNull();
        expect(assertNonNull(wrap).querySelectorAll('button').length).toBe(1 + 8); // bouton central + 8 options
    });

    it('un second appel ferme la roue précédente avant d\'en ouvrir une nouvelle (via le vrai _closeWheel)', () => {
        const { fake } = makeFakeThis();

        WheelsMethods._openCreatePingWheel.call(fake, { lng: 0, lat: 0 });
        const first = assertNonNull(fake._activeWheel);

        WheelsMethods._openCreatePingWheel.call(fake, { lng: 1, lat: 1 });

        expect(first.element).toBeNull(); // détruit par _closeWheel
        expect(fake._activeWheel).not.toBe(first);
        expect(fake._activeWheel).not.toBeNull();
    });
});

describe('wheels.ts — _quickPlacePing (planMap.js:3628-3645)', () => {
    it('defaultLabel OTAN prioritaire (Oscar, planMap.js:3633)', () => {
        const { fake, pins } = makeFakeThis();
        const otan = assertNonNull(WheelsMethods._otanColors().find((o) => o.kind === 'Oscar'));

        WheelsMethods._quickPlacePing.call(fake, { lng: 2.35, lat: 48.85 }, otan, otan.icon);

        expect(pins).toHaveLength(1);
        expect(pins[0]).toMatchObject({
            label: 'Oscar',
            color: '#22c55e',
            kind: 'Oscar',
            icon: 'military_tech',
            lng: 2.35,
            lat: 48.85,
        });
    });

    it('à défaut de defaultLabel, repli sur le label PIN_ICONS (Adv → "Adversaire", planMap.js:3632-3633)', () => {
        const { fake, pins } = makeFakeThis();
        const otan = assertNonNull(WheelsMethods._otanColors().find((o) => o.kind === 'Adv'));
        expect(otan.defaultLabel).toBeUndefined();

        WheelsMethods._quickPlacePing.call(fake, { lng: 0, lat: 0 }, otan, 'person_alert');

        expect(pins[0]?.label).toBe('Adversaire');
    });

    it('icône absente de PIN_ICONS (Inconnu → "help") : repli final sur otan.kind (planMap.js:3633)', () => {
        const { fake, pins } = makeFakeThis();
        const otan = assertNonNull(WheelsMethods._otanColors().find((o) => o.kind === 'Inconnu'));
        expect(otan.icon).toBe('help');

        WheelsMethods._quickPlacePing.call(fake, { lng: 0, lat: 0 }, otan, 'help');

        expect(pins[0]?.label).toBe('Inconnu');
    });

    it('planifie la réouverture de la roue d\'options ~80 ms après la pose (planMap.js:3644, intégration avec le vrai _openPingOptionsWheel)', () => {
        vi.useFakeTimers();
        const { fake } = makeFakeThis();
        const otan = assertNonNull(WheelsMethods._otanColors().find((o) => o.kind === 'Inter'));

        WheelsMethods._quickPlacePing.call(fake, { lng: 3, lat: 4 }, otan, 'local_police');
        expect(fake._activeWheel).toBeNull();

        vi.advanceTimersByTime(80);

        expect(fake._activeWheel).not.toBeNull();
    });
});

describe('wheels.ts — _openPingOptionsWheel (planMap.js:3648-3724)', () => {
    it('ping introuvable → ne fait rien, ne jette pas (planMap.js:3649-3650)', () => {
        const { fake } = makeFakeThis();

        expect(() => WheelsMethods._openPingOptionsWheel.call(fake, 'missing')).not.toThrow();

        expect(fake._activeWheel).toBeNull();
    });

    it('ping trouvé → ouvre la roue, titre = label||kind||\'Ping\', 7 options (planMap.js:3656-3723)', () => {
        const { fake, pins } = makeFakeThis();
        pins.push({ id: 'p1', lng: 1, lat: 2, label: 'Sentinelle', locked: false });

        WheelsMethods._openPingOptionsWheel.call(fake, 'p1');

        expect(fake._activeWheel).not.toBeNull();
        const wrap = document.body.querySelector('.plan-wheel');
        expect(wrap?.textContent).toContain('Sentinelle');
        expect(wrap?.querySelectorAll('button').length).toBe(1 + 7);
    });

    it('titre replié sur kind puis "Ping" quand label absent (planMap.js:3719)', () => {
        const { fake, pins } = makeFakeThis();
        pins.push({ id: 'p2', lng: 1, lat: 2, kind: 'Otage' });

        WheelsMethods._openPingOptionsWheel.call(fake, 'p2');

        expect(document.body.querySelector('.plan-wheel')?.textContent).toContain('Otage');
    });

    it('icône du cadenas reflète pin.locked (planMap.js:3690-3696)', () => {
        const { fake, pins } = makeFakeThis();
        pins.push({ id: 'p3', lng: 1, lat: 2, label: 'X', locked: true });

        WheelsMethods._openPingOptionsWheel.call(fake, 'p3');

        expect(document.body.querySelector('.plan-wheel')?.textContent).toContain('Déverrouiller');
    });
});

describe('wheels.ts — _openShapeWheel (planMap.js:4243-4316)', () => {
    it('forme introuvable → ne fait rien, ne jette pas (planMap.js:4244-4245)', () => {
        const { fake } = makeFakeThis();

        expect(() => WheelsMethods._openShapeWheel.call(fake, 'missing', null)).not.toThrow();

        expect(fake._activeWheel).toBeNull();
    });

    it('forme "text" → titre "Texte", boutons de taille de police (planMap.js:4255-4264, 4311)', () => {
        const { fake, shapes } = makeFakeThis();
        shapes.push({ id: 's1', type: 'text', text: 'Objectif' });

        WheelsMethods._openShapeWheel.call(fake, 's1', { lng: 1, lat: 2 });

        expect(fake._activeWheel).not.toBeNull();
        expect(document.body.querySelector('.plan-wheel')?.textContent).toContain('Texte');
    });

    it('forme "measure" (absente de la table des titres) → repli "Forme" sans throw (planMap.js:4311, piège d\'indexation TS)', () => {
        const { fake, shapes } = makeFakeThis();
        shapes.push({ id: 's2', type: 'measure', coords: [[0, 0], [1, 1]] });

        expect(() => WheelsMethods._openShapeWheel.call(fake, 's2', null)).not.toThrow();

        expect(fake._activeWheel).not.toBeNull();
        expect(document.body.querySelector('.plan-wheel')?.textContent).toContain('Forme');
    });

    it('forme "circle" avec diamètre affiché → option "Masquer diamètre" (planMap.js:4276-4285)', () => {
        const { fake, shapes } = makeFakeThis();
        fake._diameterGlobal = true;
        shapes.push({ id: 's3', type: 'circle', center: [0, 0], edge: [0, 1], showDiameter: true });

        WheelsMethods._openShapeWheel.call(fake, 's3', null);

        expect(document.body.querySelector('.plan-wheel')?.textContent).toContain('Masquer diamètre');
    });

    it('option "Supprimer" retire la forme, désélectionne, ré-rend et rafraîchit undo/redo (planMap.js:4294-4305)', () => {
        const { fake, shapes, pushHistory, saveShapes, deselectShape, renderShapes, refreshUndoRedoButtons } = makeFakeThis();
        shapes.push({ id: 's4', type: 'line', coords: [[0, 0], [1, 1]] });

        WheelsMethods._openShapeWheel.call(fake, 's4', null);
        const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.plan-wheel button'));
        const deleteBtn = assertNonNull(buttons.find((b) => b.title === 'Supprimer'));
        deleteBtn.click();

        expect(pushHistory).toHaveBeenCalled();
        expect(saveShapes).toHaveBeenCalledWith([]);
        expect(deselectShape).toHaveBeenCalled();
        expect(renderShapes).toHaveBeenCalled();
        expect(refreshUndoRedoButtons).toHaveBeenCalled();
    });
});
