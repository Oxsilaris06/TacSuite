/**
 * pc-ui-fullscreen.test.ts — le bouton général de plein écran de PC-Tac sur
 * iPhone : Safari n'expose pas l'API Fullscreen (iPad seulement), l'ancien code
 * ne faisait rien. Le bouton passe par le module partagé, qui pose le repli
 * `tac-pseudo-fullscreen` sur `document.documentElement` quand l'API manque.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UI } from '@pctac/ui.js';
import { FULLSCREEN_CHANGE_EVENT } from '@shared/fullscreen.js';

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    UI.elements = {};
});

afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    delete (document as unknown as { fullscreenElement?: Element | null }).fullscreenElement;
    vi.restoreAllMocks();
});

describe('UI.toggleFullscreen sans API Fullscreen (iPhone)', () => {
    it('pose le repli sur documentElement, le signale, puis le rend', async () => {
        const docEl = document.documentElement;
        const onChange = vi.fn();
        document.addEventListener(FULLSCREEN_CHANGE_EVENT, onChange);

        UI.toggleFullscreen();
        await Promise.resolve();
        expect(docEl.classList.contains('tac-pseudo-fullscreen')).toBe(true);
        expect(docEl.classList.contains('tac-pseudo-fullscreen-open')).toBe(true);
        expect(onChange).toHaveBeenCalledTimes(1);

        UI.toggleFullscreen();
        await Promise.resolve();
        expect(docEl.classList.contains('tac-pseudo-fullscreen')).toBe(false);
        expect(onChange).toHaveBeenCalledTimes(2);

        document.removeEventListener(FULLSCREEN_CHANGE_EVENT, onChange);
    });

    it('updateFullscreenIcon reflète le repli, dans les deux sens', async () => {
        const icon = document.createElement('span');
        UI.elements.fullscreenIcon = icon;

        UI.toggleFullscreen();
        await Promise.resolve();
        UI.updateFullscreenIcon();
        expect(icon.textContent).toBe('fullscreen_exit');

        UI.toggleFullscreen();
        await Promise.resolve();
        UI.updateFullscreenIcon();
        expect(icon.textContent).toBe('fullscreen');
    });
});
