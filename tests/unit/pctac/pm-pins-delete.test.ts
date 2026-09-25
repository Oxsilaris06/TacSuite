/**
 * pm-pins-delete.test.ts — Suppression d'un point du plan (décision 31, C7).
 * ===========================================================================
 *
 * Confirmation PUIS retrait immédiat PUIS toast d'annulation 10 s ; « Annuler »
 * remet le point à l'identique (même id, mêmes propriétés). `confirmDialog` et
 * `undoableToast` sont simulés pour piloter le scénario.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirmMock = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const undoableMock = vi.fn<(message: string, opts: { onUndo: () => void; onCommit?: () => void }) => void>();

vi.mock('@shared/feedback.js', () => ({
    confirmDialog: (...args: unknown[]): Promise<boolean> => confirmMock(...args),
    undoableToast: (message: string, opts: { onUndo: () => void; onCommit?: () => void }): void => { undoableMock(message, opts); },
}));

import { ADVERSARIES_KEY } from '../../../src/apps/pctac/config.js';
import { Storage } from '../../../src/apps/pctac/storage.js';
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

afterEach(() => {
    vi.unstubAllGlobals();
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

    it('« Annuler » journalise le rétablissement d’un ping d’entité (R27)', async () => {
        const addEntry = vi.fn<(entry: { remarques: string; auto?: boolean }) => void>();
        vi.stubGlobal('LogManager', { addEntry });
        confirmMock.mockResolvedValue(true);
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'ALPHA', prenom: '' }]);
        const fake = makeFakeThis();
        fake._savePins([makePin({ id: 'p1', label: 'ALPHA', entityRef: { kind: 'adv', id: 'a1' } })]);

        await fake._requestRemovePin('p1');
        // Retrait journalisé immédiatement, une seule fois.
        expect(addEntry).toHaveBeenCalledTimes(1);
        expect(String(addEntry.mock.calls[0]?.[0]?.remarques)).toContain('Ping retiré');

        addEntry.mockClear();
        undoableMock.mock.calls[0]?.[1]?.onUndo();

        expect(fake._loadPins()).toHaveLength(1);
        // Le retrait n'a finalement pas eu lieu : la main courante le dit.
        expect(addEntry).toHaveBeenCalledTimes(1);
        expect(String(addEntry.mock.calls[0]?.[0]?.remarques)).toContain('Ping rétabli');
    });
});

describe('Revue neuve du 25/09 — V5 : un point supprimé reçoit sa pierre à l’échéance', () => {
    it('onCommit du toast pose pcTacPlanPins:<id>', async () => {
        const { readTombstones } = await import('../../../src/apps/pctac/tombstones.js');
        confirmMock.mockResolvedValue(true);
        const fake = makeFakeThis();
        fake._savePins([makePin({ id: 'pin1' })]);
        await fake._requestRemovePin('pin1');
        const call = undoableMock.mock.calls.at(-1) as unknown as [string, { onUndo: () => void; onCommit?: () => void }];
        expect(call?.[1].onCommit).toBeTypeOf('function');
        call[1].onCommit?.();
        expect(readTombstones('forcene').map((t) => `${t.key}:${t.itemId}`)).toEqual(['pcTacPlanPins:pin1']);
    });
});
