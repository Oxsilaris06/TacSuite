/**
 * r2a-ctrlz-plan.test.ts — CONTROLE C3 (K4) : sur la vue Plan, un Ctrl+Z déjà
 * traité (`preventDefault` par le gestionnaire de dessin) ne doit PAS annuler
 * aussi la dernière suppression : une frappe = une action.
 *
 * Porté du contrôleur /tmp/claude-1000/controle-socle/ctrlz-plan.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { undoableToast } from '@shared/feedback.js';

describe('Ctrl+Z sur la vue Plan : deux annulations pour une touche', () => {
    it('le gestionnaire du plan (document, preventDefault) ET l’annulation du toast (window) s’exécutent', () => {
        // Réplique exacte de draw-layers.ts:380-385 (écouteur document, vue Plan active).
        document.body.innerHTML = '<div id="view-plan" class="active"></div>';
        const shapeUndo = vi.fn();
        document.addEventListener('keydown', (e) => {
            const planView = document.getElementById('view-plan');
            if (!planView || !planView.classList.contains('active')) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); shapeUndo(); }
        });
        const onUndo = vi.fn();
        undoableToast('Point supprimé', { onUndo, onCommit: vi.fn() }); // pins.ts:188
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
        console.log('shapeUndo', shapeUndo.mock.calls.length, 'pinUndo', onUndo.mock.calls.length, 'texte', document.querySelector('.tac-toast')?.textContent);
        expect(shapeUndo.mock.calls.length + onUndo.mock.calls.length).toBe(1);
    });
});
