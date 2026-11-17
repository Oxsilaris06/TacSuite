/**
 * fullscreen.test.ts — plein écran de la carte sur iPhone : Safari n'y expose
 * pas l'API Fullscreen (iPad seulement), le bouton ne faisait rien. Le repli
 * agrandit le conteneur à la taille de l'écran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FULLSCREEN_CHANGE_EVENT, exitFullscreen, fullscreenElement, toggleFullscreen } from '@shared/fullscreen.js';

function container(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    vi.restoreAllMocks();
});

describe('toggleFullscreen sans API Fullscreen (iPhone)', () => {
    it('agrandit le conteneur, le signale, puis le rend', async () => {
        const el = container();
        Object.assign(el, { requestFullscreen: undefined, webkitRequestFullscreen: undefined });
        const onChange = vi.fn();
        document.addEventListener(FULLSCREEN_CHANGE_EVENT, onChange);

        await toggleFullscreen(el);
        expect(fullscreenElement()).toBe(el);
        expect(el.classList.contains('tac-pseudo-fullscreen')).toBe(true);
        expect(document.documentElement.classList.contains('tac-pseudo-fullscreen-open')).toBe(true);

        await toggleFullscreen(el);
        expect(fullscreenElement()).toBeNull();
        expect(el.classList.contains('tac-pseudo-fullscreen')).toBe(false);
        expect(document.documentElement.classList.contains('tac-pseudo-fullscreen-open')).toBe(false);
        expect(onChange).toHaveBeenCalledTimes(2);
        document.removeEventListener(FULLSCREEN_CHANGE_EVENT, onChange);
    });

    it('exitFullscreen sort aussi du repli (la visionneuse photo passerait dessous)', async () => {
        const el = container();
        Object.assign(el, { requestFullscreen: undefined, webkitRequestFullscreen: undefined });
        await toggleFullscreen(el);

        await exitFullscreen();

        expect(fullscreenElement()).toBeNull();
        expect(document.documentElement.classList.contains('tac-pseudo-fullscreen-open')).toBe(false);
    });

    it('API présente mais refusée : le repli prend le relais', async () => {
        const el = container();
        Object.assign(el, { requestFullscreen: vi.fn().mockRejectedValue(new TypeError('not supported')) });

        await toggleFullscreen(el);

        expect(fullscreenElement()).toBe(el);
    });

    it('API disponible : le plein écran natif est demandé, sans repli', async () => {
        const el = container();
        const req = vi.fn().mockResolvedValue(undefined);
        Object.assign(el, { requestFullscreen: req });

        await toggleFullscreen(el);

        expect(req).toHaveBeenCalledOnce();
        expect(el.classList.contains('tac-pseudo-fullscreen')).toBe(false);
    });
});
