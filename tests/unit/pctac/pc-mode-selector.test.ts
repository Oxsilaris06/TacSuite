/**
 * pc-mode-selector.test.ts — Sélecteur de situation en menu déroulant (mobile).
 *
 * Ce qui est verrouillé ici :
 *   - sous 520 px, `#modeSelector` rend un `<select>` natif à quatre options,
 *     avec pour valeur la situation courante (pas quatre boutons serrés) ;
 *   - le `change` du `<select>` passe par `setMode()` : un seul chemin de
 *     vérité, la situation courante suit réellement ;
 *   - au-dessus de 520 px, les quatre boutons radio sont rendus comme avant.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PCTAC_MODE_KEY, PCTAC_MODES, currentModeId } from '@pctac/modes.js';
import { initModeSelector } from '@pctac/mode-ui.js';

/** Simule le résultat de `matchMedia` sans toucher au reste de l'environnement. */
function setViewportMatches(matches: boolean): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="modeSelector" class="mode-selector"></div>';
});

describe('sélecteur de situation mobile', () => {
    it('rend un <select> à quatre options dont la valeur est la situation courante', () => {
        setViewportMatches(true);
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        initModeSelector();

        const select = document.querySelector<HTMLSelectElement>('#modeSelector select');
        expect(select).not.toBeNull();
        expect(select!.querySelectorAll('option')).toHaveLength(4);
        expect(select!.value).toBe('tp');
        // Jamais les deux rendus à la fois.
        expect(document.querySelectorAll('#modeSelector [role="radio"]')).toHaveLength(0);
        // Icône de la situation active à gauche du menu.
        expect(document.querySelector('#modeSelector .mode-selector-current')?.textContent)
            .toBe(PCTAC_MODES.tp.icon);
    });

    it('le change appelle setMode : la situation courante suit', () => {
        setViewportMatches(true);
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        initModeSelector();

        const select = document.querySelector<HTMLSelectElement>('#modeSelector select')!;
        select.value = 'evenement';
        select.dispatchEvent(new Event('change'));

        expect(currentModeId()).toBe('evenement');
        expect(document.querySelector('#modeSelector .mode-selector-current')?.textContent)
            .toBe(PCTAC_MODES.evenement.icon);
    });

    it('garde les quatre boutons radio au-dessus de 520 px', () => {
        setViewportMatches(false);
        initModeSelector();

        expect(document.querySelectorAll('#modeSelector [role="radio"]')).toHaveLength(4);
        expect(document.querySelector('#modeSelector select')).toBeNull();
    });
});
