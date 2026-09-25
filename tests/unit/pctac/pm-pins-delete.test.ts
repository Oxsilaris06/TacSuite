/**
 * pm-pins-delete.test.ts — Suppression d'un point du plan (décision 31, C7).
 * ===========================================================================
 *
 * Confirmation PUIS retrait immédiat PUIS toast d'annulation 10 s ; « Annuler »
 * remet le point à l'identique (même id, mêmes propriétés). `confirmDialog` et
 * `undoableToast` sont simulés pour piloter le scénario.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmMock = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const undoableMock = vi.fn<(message: string, opts: { onUndo: () => void; onCommit?: () => void }) => void>();

vi.mock('@shared/feedback.js', () => ({
    confirmDialog: (...args: unknown[]): Promise<boolean> => confirmMock(...args),
    undoableToast: (message: string, opts: { onUndo: () => void; onCommit?: () => void }): void => { undoableMock(message, opts); },
}));

import { PinsMethods } from '../../../src/apps/pctac/planmap/pins.js';
import { SafeMethods, createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PlanMapInternal, PlanPin } from '../../../src/apps/pctac/planmap/types.js';

function makePin(over: Partial<PlanPin> = {}): PlanPin {
    return { id: 'p1', lng: 2.35, lat: 48.85, label: 'Point A', color: '#f55', kind: 'libre', icon: 'flag', text: 'objectif', ...over };
}

function makeFakeThis(): PlanMapInternal {
    const state = createPlanMapState();
    return {
        ...state,
        ...SafeMethods,
        ...PinsMethods,
        map: null,
        _renderPins: vi.fn(),
    } as unknown as PlanMapInternal;
}

beforeEach(() => {
    localStorage.clear();
    confirmMock.mockReset();
    undoableMock.mockReset();
});

describe('_requestRemovePin — décision 31', () => {
    it('confirmation refusée : le point reste, aucun toast', async () => {
        confirmMock.mockResolvedValue(false);
        const fake = makeFakeThis();
        fake._savePins([makePin()]);

        await fake._requestRemovePin('p1');

        expect(fake._loadPins().map((p) => p.id)).toEqual(['p1']);
        expect(undoableMock).not.toHaveBeenCalled();
    });

    it('confirmation acceptée : le point disparaît TOUT DE SUITE et un toast « Point supprimé » avec Annuler est posé', async () => {
        confirmMock.mockResolvedValue(true);
        const fake = makeFakeThis();
        fake._savePins([makePin(), makePin({ id: 'p2', label: 'Autre' })]);

        await fake._requestRemovePin('p1');

        expect(fake._loadPins().map((p) => p.id)).toEqual(['p2']);
        expect(undoableMock).toHaveBeenCalledTimes(1);
        expect(undoableMock.mock.calls[0]?.[0]).toBe('Point supprimé');
        expect(typeof undoableMock.mock.calls[0]?.[1]?.onUndo).toBe('function');
    });

    it('« Annuler » remet le point avec le même id et les mêmes propriétés', async () => {
        confirmMock.mockResolvedValue(true);
        const fake = makeFakeThis();
        fake._savePins([makePin()]);

        await fake._requestRemovePin('p1');
        expect(fake._loadPins()).toHaveLength(0);

        undoableMock.mock.calls[0]?.[1]?.onUndo();

        const restored = fake._loadPins();
        expect(restored).toHaveLength(1);
        expect(restored[0]).toEqual(makePin());
    });

    it('id inconnu : aucune confirmation, aucun toast', async () => {
        const fake = makeFakeThis();
        await fake._requestRemovePin('inconnu');
        expect(confirmMock).not.toHaveBeenCalled();
        expect(undoableMock).not.toHaveBeenCalled();
    });
});
