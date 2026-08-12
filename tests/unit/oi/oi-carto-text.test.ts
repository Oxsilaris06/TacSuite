/**
 * oi-carto-text.test.ts — Comportement du paquet `oi-carto-text`
 * (`carto/text.ts` : pose, édition, couleur, suppression de texte libre sur
 * la carto OI). Pas de source `oi_cartographie.js` équivalente — port
 * fonctionnel, cf. en-tête de `text.ts`.
 *
 * Depuis l'unification shape (parité PC-Tac `text-modal.ts`) : le texte est
 * une shape `type:'text'` dans `_loadShapes`/`_saveShapes` — le double
 * `_getCartoState` in-memory porte donc `shapes` (+ `texts` pour couvrir la
 * migration de l'ANCIEN bucket, cf. `_migrateLegacyTexts`).
 *
 * `this` FACTICE minimal : vraies méthodes de `TextMethods` (sous test) +
 * double in-memory pour `_getCartoState`/`_loadShapes`/`_saveShapes` (hors
 * `dependsOn` de ce paquet, propriétés de `carto/state.ts`) + `promptDialog`
 * mocké (`@shared/feedback.js`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const promptDialogSpy = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));
vi.mock('@shared/feedback.js', () => ({
    promptDialog: promptDialogSpy,
}));

vi.mock('maplibre-gl', () => {
    class FakeMarker {
        private _element: HTMLElement;
        private _lngLat: { lng: number; lat: number };
        constructor(opts: { element?: HTMLElement } = {}) {
            this._element = opts.element ?? document.createElement('div');
            this._lngLat = { lng: 0, lat: 0 };
        }
        setLngLat(ll: { lng: number; lat: number }): this { this._lngLat = ll; return this; }
        getLngLat(): { lng: number; lat: number } { return this._lngLat; }
        addTo(): this { return this; }
        remove(): this { return this; }
        getElement(): HTMLElement { return this._element; }
    }
    return { default: { Marker: FakeMarker } };
});

import { TextMethods } from '../../../src/apps/oi/carto/text.js';
import type { OICartoInternal, OiCartoShape, OiCartoText } from '../../../src/apps/oi/carto/types.js';

function safeImpl<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
    return (...args: A) => {
        try { return fn(...args); } catch { return undefined; }
    };
}

/** Double minimal de `_getCartoState`/`_loadShapes`/`_saveShapes` (state.ts, hors `dependsOn`). */
function makeFakeThis(overrides: Partial<OICartoInternal> = {}): OICartoInternal {
    const cartoState: { shapes: OiCartoShape[]; texts: OiCartoText[] } = { shapes: [], texts: [] };
    const base = {
        map: { getCanvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }), unproject: () => ({ lng: 0, lat: 0 }) } as unknown as OICartoInternal['map'],
        textMarkers: new Map(),
        drawColor: '#ffffff',
        drawTool: null,
        _gesture: null,
        _selectedShapeId: null,
        _safe: safeImpl,
        _getCartoState: vi.fn(() => cartoState as unknown as ReturnType<OICartoInternal['_getCartoState']>),
        _loadShapes: vi.fn(() => cartoState.shapes),
        _saveShapes: vi.fn((list: readonly OiCartoShape[]) => { cartoState.shapes = list.slice(); }),
        _pushHistory: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
        _renderShapes: vi.fn(),
        _startShapeGesture: vi.fn(),
        _deselectShape: vi.fn(),
        ...TextMethods,
        ...overrides,
    };
    return base as unknown as OICartoInternal;
}

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.restoreAllMocks();
    promptDialogSpy.mockReset();
    promptDialogSpy.mockImplementation(async () => null);
});

describe('_startFreeText — pose', () => {
    it('saisie valide : ajoute une shape type:text (couleur = drawColor)', async () => {
        promptDialogSpy.mockResolvedValueOnce('Objectif');
        const fake = makeFakeThis({ drawColor: '#3b82f6' });

        await TextMethods._startFreeText.call(fake, { lng: 2.1, lat: 48.1 });

        const shapes = fake._loadShapes();
        expect(shapes).toHaveLength(1);
        expect(shapes[0]).toMatchObject({
            type: 'text', text: 'Objectif', color: '#3b82f6', textColor: '#3b82f6',
            coords: [[2.1, 48.1]],
        });
        expect(fake._pushHistory).toHaveBeenCalled();
        expect(fake._renderShapes).toHaveBeenCalled();
    });

    it('annulé (null) : ne pose rien', async () => {
        promptDialogSpy.mockResolvedValueOnce(null);
        const fake = makeFakeThis();

        await TextMethods._startFreeText.call(fake, { lng: 2.1, lat: 48.1 });

        expect(fake._loadShapes()).toHaveLength(0);
    });

    it('saisie vide (espaces) : ne pose rien', async () => {
        promptDialogSpy.mockResolvedValueOnce('   ');
        const fake = makeFakeThis();

        await TextMethods._startFreeText.call(fake, { lng: 2.1, lat: 48.1 });

        expect(fake._loadShapes()).toHaveLength(0);
    });
});

describe('_editText — édition', () => {
    it('nouvelle valeur : met à jour le texte en place', async () => {
        const fake = makeFakeThis();
        fake._saveShapes([{ id: 't1', type: 'text', color: '#fff', textColor: '#fff', coords: [[1, 1]], text: 'Ancien' }]);
        promptDialogSpy.mockResolvedValueOnce('Nouveau');

        await TextMethods._editText.call(fake, 't1');

        expect(fake._loadShapes()[0]?.text).toBe('Nouveau');
        expect(fake._pushHistory).toHaveBeenCalled();
    });

    it('valeur vidée : supprime la shape (parité PC-Tac)', async () => {
        const fake = makeFakeThis();
        fake._saveShapes([{ id: 't1', type: 'text', color: '#fff', textColor: '#fff', coords: [[1, 1]], text: 'Ancien' }]);
        promptDialogSpy.mockResolvedValueOnce('   ');

        await TextMethods._editText.call(fake, 't1');

        expect(fake._loadShapes()).toHaveLength(0);
    });

    it('annulé (null) : inchangé', async () => {
        const fake = makeFakeThis();
        fake._saveShapes([{ id: 't1', type: 'text', color: '#fff', textColor: '#fff', coords: [[1, 1]], text: 'Ancien' }]);
        promptDialogSpy.mockResolvedValueOnce(null);

        await TextMethods._editText.call(fake, 't1');

        expect(fake._loadShapes()[0]?.text).toBe('Ancien');
    });
});

describe('_removeText — suppression', () => {
    it('retire uniquement l\'id ciblé', () => {
        const fake = makeFakeThis();
        fake._saveShapes([
            { id: 't1', type: 'text', color: '#fff', coords: [[1, 1]], text: 'A' },
            { id: 't2', type: 'text', color: '#fff', coords: [[2, 2]], text: 'B' },
        ]);

        TextMethods._removeText.call(fake, 't1');

        expect(fake._loadShapes().map((s) => s.id)).toEqual(['t2']);
    });

    it('désélectionne si la shape supprimée était sélectionnée', () => {
        const fake = makeFakeThis({ _selectedShapeId: 't1' });
        fake._saveShapes([{ id: 't1', type: 'text', color: '#fff', coords: [[1, 1]], text: 'A' }]);

        TextMethods._removeText.call(fake, 't1');

        expect(fake._deselectShape).toHaveBeenCalled();
    });
});

describe('_migrateLegacyTexts — migration bucket legacy', () => {
    it('convertit `cartography.texts` en shapes type:text puis vide le bucket', () => {
        const fake = makeFakeThis();
        fake._saveTexts([{ id: 'legacy1', lng: 5, lat: 6, text: 'Vieux', color: '#eab308' }]);

        TextMethods._migrateLegacyTexts.call(fake);

        expect(fake._loadShapes()).toEqual([
            { id: 'legacy1', type: 'text', color: '#eab308', textColor: '#eab308', coords: [[5, 6]], text: 'Vieux' },
        ]);
        expect(fake._loadTexts()).toHaveLength(0);
    });

    it('idempotente : no-op si le bucket est déjà vide', () => {
        const fake = makeFakeThis();

        expect(() => TextMethods._migrateLegacyTexts.call(fake)).not.toThrow();
        expect(fake._loadShapes()).toHaveLength(0);
    });
});

describe('_renderShapeTexts — rendu', () => {
    it('sans carte : ne jette pas, aucun marker', () => {
        const fake = makeFakeThis({ map: null });
        fake._saveShapes([{ id: 't1', type: 'text', color: '#fff', coords: [[1, 1]], text: 'X' }]);

        expect(() => TextMethods._renderShapeTexts.call(fake)).not.toThrow();
        expect(fake.textMarkers.size).toBe(0);
    });

    it('rend un marker par shape type:text non vide, migre le bucket legacy', () => {
        const fake = makeFakeThis();
        fake._saveShapes([{ id: 't1', type: 'text', color: '#fff', coords: [[1, 1]], text: 'X' }]);
        fake._saveTexts([{ id: 'legacy1', lng: 5, lat: 6, text: 'Vieux', color: '#eab308' }]);

        TextMethods._renderShapeTexts.call(fake);

        expect(fake.textMarkers.size).toBe(2);
        expect(fake._loadTexts()).toHaveLength(0); // migré
    });

    it('ignore les shapes non-text et les shapes text sans texte', () => {
        const fake = makeFakeThis();
        fake._saveShapes([
            { id: 'l1', type: 'line', color: '#fff', coords: [[0, 0], [1, 1]] },
            { id: 't1', type: 'text', color: '#fff', coords: [[1, 1]], text: '' },
        ]);

        TextMethods._renderShapeTexts.call(fake);

        expect(fake.textMarkers.size).toBe(0);
    });
});
