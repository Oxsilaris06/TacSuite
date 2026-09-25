/**
 * pm-ctrlz-plan.test.ts — C3 (K4) : le Ctrl+Z global de `feedback.ts` et le
 * Ctrl+Z du dessin de `planmap/draw-layers.ts` ne doivent pas s'exécuter tous
 * les deux sur une même frappe. Quand un toast d'annulation est OUVERT, la
 * touche lui revient (le plan laisse passer, sans `preventDefault`) ; toast
 * fermé, le plan annule le dessin comme avant.
 *
 * Chemin réel : `_bindDrawUi` (planMap.js:1829) pose l'écouteur `document` ;
 * `undoableToast` (`@shared/feedback.ts`, réel) pose l'écouteur `window`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DrawLayersMethods } from '../../../src/apps/pctac/planmap/draw-layers.js';
import type { PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';
import { undoableToast } from '@shared/feedback.js';

function makeState(): { state: PlanMapInternal; undo: ReturnType<typeof vi.fn> } {
    const undo = vi.fn();
    const fake = {
        map: null,
        drawTool: null,
        _setTool: vi.fn(),
        _setDrawColor: vi.fn(),
        _pushHistory: vi.fn(),
        _saveShapes: vi.fn(),
        _renderShapes: vi.fn(),
        _refreshUndoRedoButtons: vi.fn(),
        _undo: undo,
        _redo: vi.fn(),
        _toggleGlobalDiameter: vi.fn(),
        _toggleLock: vi.fn(),
        _updateLockButton: vi.fn(),
        _safe: (fn: (...a: never[]) => unknown) => fn,
    };
    return { state: fake as unknown as PlanMapInternal, undo };
}

function pressCtrlZ(): void {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('C3/K4 — Ctrl+Z sur la vue Plan face à un toast d’annulation', () => {
    it('toast ouvert : Ctrl+Z rétablit le point SANS annuler la zone ; toast fermé : Ctrl+Z annule la zone', () => {
        document.body.innerHTML = '<div id="view-plan" class="active"></div>';
        const { state, undo } = makeState();
        DrawLayersMethods._bindDrawUi.call(state);

        const onUndo = vi.fn();
        undoableToast('Point supprimé', { onUndo, onCommit: vi.fn() });

        // 1) Le toast « Point supprimé » est ouvert : Ctrl+Z lui revient.
        pressCtrlZ();
        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(undo).not.toHaveBeenCalled();

        // 2) Le toast est fermé (retiré du DOM) : Ctrl+Z revient au plan.
        document.querySelector('.tac-toast')?.remove();
        pressCtrlZ();
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it('sans toast : Ctrl+Z annule le dessin comme avant (non-régression)', () => {
        document.body.innerHTML = '<div id="view-plan" class="active"></div>';
        const { state, undo } = makeState();
        DrawLayersMethods._bindDrawUi.call(state);

        pressCtrlZ();
        expect(undo).toHaveBeenCalledTimes(1);
    });
});
