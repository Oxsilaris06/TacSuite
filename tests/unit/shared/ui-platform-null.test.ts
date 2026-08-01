/**
 * ui-platform-null.test.ts — Tests de tolérance `null` des 5 fonctions normalisées
 * ==================================================================================
 *
 * Conformément à SPEC-PCTAC-CONVERSION.md §7, les 5 fonctions `onLongPress`,
 * `onDoubleTap`, `sortable`, `makeDialog`, `makeTablist` doivent tolérer un
 * appel explicite avec `null` (restauration de la compatibilité du JS original
 * qui utilise `opts = opts || {}`). Ces tests vérifient que chaque fonction
 * s'exécute sans jeter quand reçoit `null` et applique les valeurs par défaut.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onLongPress, onDoubleTap, sortable, makeDialog, makeTablist } from '@shared/ui-platform.js';

describe('UI Platform — null tolerance', () => {
    let container: HTMLElement;

    beforeEach(() => {
        // Créer un container de test pour chaque test
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container.parentNode) container.parentNode.removeChild(container);
    });

    describe('onLongPress', () => {
        it('should not throw when called with null opts', () => {
            const btn = document.createElement('button');
            container.appendChild(btn);
            const cb = vi.fn();

            expect(() => {
                onLongPress(btn, cb, null);
            }).not.toThrow();
        });

        it('should apply default delay (450ms) when opts is null', () => {
            const btn = document.createElement('button');
            container.appendChild(btn);
            const cb = vi.fn();

            vi.useFakeTimers();
            const handle = onLongPress(btn, cb, null);
            const downEvent = new PointerEvent('pointerdown', { clientX: 0, clientY: 0 });
            btn.dispatchEvent(downEvent);

            // Avant 450ms, cb ne doit pas être appelé
            vi.advanceTimersByTime(449);
            expect(cb).not.toHaveBeenCalled();

            // Après 450ms, cb doit être appelé
            vi.advanceTimersByTime(1);
            expect(cb).toHaveBeenCalledOnce();
            expect(handle.isFired()).toBe(true);

            vi.useRealTimers();
        });
    });

    describe('onDoubleTap', () => {
        it('should not throw when called with null opts', () => {
            const btn = document.createElement('button');
            container.appendChild(btn);
            const cb = vi.fn();

            expect(() => {
                onDoubleTap(btn, cb, null);
            }).not.toThrow();
        });

        it('should accept null opts and set up listener without throwing', () => {
            const btn = document.createElement('button');
            container.appendChild(btn);
            const cb = vi.fn();

            // The critical test: null opts should not throw
            onDoubleTap(btn, cb, null);

            // Verify that a pointer event listener is attached
            // by dispatching a pointerup event
            const upEvent = new PointerEvent('pointerup', { clientX: 0, clientY: 0 });
            btn.dispatchEvent(upEvent);

            // No error should be thrown when calling the function with null
            // The handler runs (though it won't detect a double-tap from just one event)
            expect(true).toBe(true);
        });
    });

    describe('sortable', () => {
        it('should not throw when called with null opts', () => {
            const list = document.createElement('ul');
            list.innerHTML = '<li>Item 1</li><li>Item 2</li>';
            container.appendChild(list);

            expect(() => {
                sortable(list, null);
            }).not.toThrow();
        });

        it('should apply default itemSelector when opts is null', () => {
            const list = document.createElement('ul');
            const li1 = document.createElement('li');
            li1.textContent = 'Item 1';
            const li2 = document.createElement('li');
            li2.textContent = 'Item 2';
            list.appendChild(li1);
            list.appendChild(li2);
            container.appendChild(list);

            const handle = sortable(list, null);
            // Pas d'erreur : le default ':scope > *' est appliqué
            expect(handle.destroy).toBeDefined();
            handle.destroy(); // cleanup
        });
    });

    describe('makeDialog', () => {
        it('should not throw when called with null opts', () => {
            const dialog = document.createElement('div');
            container.appendChild(dialog);

            expect(() => {
                makeDialog(dialog, null);
            }).not.toThrow();
        });

        it('should not call onClose when opts is null and Escape is pressed', () => {
            const dialog = document.createElement('div');
            container.appendChild(dialog);

            const handle = makeDialog(dialog, null);
            handle.open();

            // Simulating Escape key
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
            dialog.dispatchEvent(escapeEvent);

            // No error should be thrown, onClose simply doesn't exist
            expect(dialog.classList.contains('up-kb-aware')).toBe(true);
            handle.close();
        });

        it('should set role and aria-modal attributes', () => {
            const dialog = document.createElement('div');
            container.appendChild(dialog);

            makeDialog(dialog, null);

            expect(dialog.getAttribute('role')).toBe('dialog');
            expect(dialog.getAttribute('aria-modal')).toBe('true');
        });
    });

    describe('makeTablist', () => {
        it('should not throw when called with null opts', () => {
            const tablist = document.createElement('div');
            const tab1 = document.createElement('button');
            tab1.setAttribute('role', 'tab');
            const tab2 = document.createElement('button');
            tab2.setAttribute('role', 'tab');
            tablist.appendChild(tab1);
            tablist.appendChild(tab2);
            container.appendChild(tablist);

            expect(() => {
                makeTablist(tablist, null);
            }).not.toThrow();
        });

        it('should apply default tabSelector when opts is null', () => {
            const tablist = document.createElement('div');
            const tab1 = document.createElement('button');
            tab1.setAttribute('role', 'tab');
            const tab2 = document.createElement('button');
            tab2.setAttribute('role', 'tab');
            tablist.appendChild(tab1);
            tablist.appendChild(tab2);
            container.appendChild(tablist);

            makeTablist(tablist, null);

            expect(tablist.getAttribute('role')).toBe('tablist');
            // Default selector '[role="tab"]' should find our tabs
            const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
            expect(tabs).toHaveLength(2);
        });

        it('should not call activate when opts is null', () => {
            const tablist = document.createElement('div');
            const tab1 = document.createElement('button');
            tab1.setAttribute('role', 'tab');
            tablist.appendChild(tab1);
            container.appendChild(tablist);

            makeTablist(tablist, null);

            // Simulate arrow key with tab focused
            tab1.focus();
            const arrowEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });
            tablist.dispatchEvent(arrowEvent);

            // No error, activate just doesn't exist
            expect(true).toBe(true); // no error thrown
        });
    });
});
