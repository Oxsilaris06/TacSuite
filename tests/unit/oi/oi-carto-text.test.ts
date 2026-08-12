/**
 * oi-carto-text.test.ts — Comportement du paquet `oi-carto-text`
 * (`carto/text.ts` : pose, édition, couleur, suppression de texte libre sur
 * la carto OI). Pas de source `oi_cartographie.js` équivalente — port
 * fonctionnel, cf. en-tête de `text.ts`. Écrit AVANT le port (TDD).
 *
 * `this` FACTICE minimal : vraies méthodes de `TextMethods` (sous test) +
 * double in-memory pour `_getCartoState` (propriété de `carto/state.ts`,
 * hors `dependsOn` de ce paquet) + `promptDialog` mocké (`@shared/feedback.js`).
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
        on(type: string, cb: () => void): this { this._listeners.set(type, cb); return this; }
        _fire(type: string): void { this._listeners.get(type)?.(); }
    }
    return { default: { Marker: FakeMarker } };
});

import { TextMethods } from '../../../src/apps/oi/carto/text.js';
import type { OICartoInternal, OiCartoText } from '../../../src/apps/oi/carto/types.js';

function safeImpl<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
    return (...args: A) => {
        try { return fn(...args); } catch { return undefined; }
    };
}

/** Double minimal de `_getCartoState` (state.ts, hors `dependsOn`) : conteneur in-memory avec `texts`. */
function makeFakeThis(overrides: Partial<OICartoInternal> = {}): OICartoInternal {
    const cartoState: { texts: OiCartoText[] } = { texts: [] };
    const base = {
        map: {} as unknown as OICartoInternal['map'],
        textMarkers: new Map(),
        _safe: safeImpl,
        _getCartoState: vi.fn(() => cartoState as unknown as ReturnType<OICartoInternal['_getCartoState']>),
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
    it('saisie valide : ajoute un texte persisté puis rend les markers', async () => {
        promptDialogSpy.mockResolvedValueOnce('Objectif');
        const fake = makeFakeThis();

        await TextMethods._startFreeText.call(fake, { lng: 2.1, lat: 48.1 });

        const texts = fake._loadTexts();
        expect(texts).toHaveLength(1);
        expect(texts[0]).toMatchObject({ text: 'Objectif', lng: 2.1, lat: 48.1 });
        expect(fake.textMarkers.size).toBe(1);
    });

    it('annulé (null) : ne pose rien', async () => {
        promptDialogSpy.mockResolvedValueOnce(null);
        const fake = makeFakeThis();

        await TextMethods._startFreeText.call(fake, { lng: 2.1, lat: 48.1 });

        expect(fake._loadTexts()).toHaveLength(0);
    });

    it('saisie vide (espaces) : ne pose rien', async () => {
        promptDialogSpy.mockResolvedValueOnce('   ');
        const fake = makeFakeThis();

        await TextMethods._startFreeText.call(fake, { lng: 2.1, lat: 48.1 });

        expect(fake._loadTexts()).toHaveLength(0);
    });
});

describe('_editText — édition', () => {
    it('nouvelle valeur : met à jour le texte en place', async () => {
        const fake = makeFakeThis();
        fake._saveTexts([{ id: 't1', lng: 1, lat: 1, text: 'Ancien', color: '#ffffff' }]);
        promptDialogSpy.mockResolvedValueOnce('Nouveau');

        await TextMethods._editText.call(fake, 't1');

        expect(fake._loadTexts()[0]?.text).toBe('Nouveau');
    });

    it('valeur vidée : supprime le texte (parité PC-Tac)', async () => {
        const fake = makeFakeThis();
        fake._saveTexts([{ id: 't1', lng: 1, lat: 1, text: 'Ancien', color: '#ffffff' }]);
        promptDialogSpy.mockResolvedValueOnce('   ');

        await TextMethods._editText.call(fake, 't1');

        expect(fake._loadTexts()).toHaveLength(0);
    });
});

describe('_cycleTextColor — couleur', () => {
    it('avance à la couleur suivante de la palette', () => {
        const fake = makeFakeThis();
        fake._saveTexts([{ id: 't1', lng: 1, lat: 1, text: 'X', color: '#ffffff' }]);

        TextMethods._cycleTextColor.call(fake, 't1');

        expect(fake._loadTexts()[0]?.color).not.toBe('#ffffff');
    });
});

describe('_removeText — suppression', () => {
    it('retire uniquement l\'id ciblé', () => {
        const fake = makeFakeThis();
        fake._saveTexts([
            { id: 't1', lng: 1, lat: 1, text: 'A', color: '#ffffff' },
            { id: 't2', lng: 2, lat: 2, text: 'B', color: '#ffffff' },
        ]);

        TextMethods._removeText.call(fake, 't1');

        expect(fake._loadTexts().map((t) => t.id)).toEqual(['t2']);
    });
});

describe('_renderTexts — persistance / rendu', () => {
    it('sans carte : ne jette pas, aucun marker', () => {
        const fake = makeFakeThis({ map: null });
        fake._saveTexts([{ id: 't1', lng: 1, lat: 1, text: 'X', color: '#ffffff' }]);

        expect(() => TextMethods._renderTexts.call(fake)).not.toThrow();
        expect(fake.textMarkers.size).toBe(0);
    });

    it('dragend recalcule lng/lat et persiste', () => {
        const fake = makeFakeThis();
        fake._saveTexts([{ id: 't1', lng: 1, lat: 1, text: 'X', color: '#ffffff' }]);

        TextMethods._renderTexts.call(fake);
        const marker = fake.textMarkers.get('t1') as unknown as {
            setLngLat(ll: { lng: number; lat: number }): void;
            _fire(type: string): void;
        };
        marker.setLngLat({ lng: 9, lat: 8 });
        marker._fire('dragend');

        expect(fake._loadTexts()[0]).toMatchObject({ lng: 9, lat: 8 });
    });
});
