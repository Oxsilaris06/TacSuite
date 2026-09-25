/**
 * r2a-undo-toast.test.ts — CONTROLE C7 (« Insuffisant R12 ») : la pause du toast
 * d'annulation doit tenir DEUX drapeaux (survol, focus) et ne retrancher le
 * temps écoulé qu'UNE fois, au passage de « aucun » à « au moins un ».
 *
 * Porté du contrôleur /tmp/claude-1000/controle-socle/undo-toast.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { undoableToast } from '@shared/feedback.js';

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

describe('R12 : pause du toast d’annulation', () => {
    it('focus clavier dans le toast + survol puis sortie du pointeur : le toast ne doit pas expirer tant que le focus y reste', () => {
        const onCommit = vi.fn();
        const onUndo = vi.fn();
        undoableToast('Fiche supprimée', { onUndo, onCommit });
        const el = document.querySelector<HTMLElement>('.tac-toast')!;
        const btn = el.querySelector<HTMLButtonElement>('button')!;
        vi.advanceTimersByTime(3000);
        btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));   // Tab jusqu'à « Annuler »
        vi.advanceTimersByTime(2000);
        el.dispatchEvent(new Event('pointerenter'));                         // la souris passe dessus
        el.dispatchEvent(new Event('pointerleave'));                         // …et repart ; le focus reste sur « Annuler »
        vi.advanceTimersByTime(10_000);
        console.log('commit', onCommit.mock.calls.length, 'toast présent', document.contains(el));
        expect(onCommit).not.toHaveBeenCalled();
    });
    it('deux reprises (pointerleave puis focusout) : un seul décompte, pas de minuteur orphelin', () => {
        const onCommit = vi.fn();
        undoableToast('Fiche supprimée', { onUndo: vi.fn(), onCommit });
        const el = document.querySelector<HTMLElement>('.tac-toast')!;
        el.dispatchEvent(new Event('pointerenter'));
        el.querySelector('button')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        el.dispatchEvent(new Event('pointerleave'));
        el.querySelector('button')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        // Au total : 10 s de délai, dont 0 écoulée → le commit ne doit pas tomber avant ~10 s.
        vi.advanceTimersByTime(9_000);
        console.log('commit à 9 s', onCommit.mock.calls.length);
        expect(onCommit).not.toHaveBeenCalled();
    });
});
