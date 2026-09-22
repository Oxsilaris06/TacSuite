/**
 * orb.test.ts — Sphère d'attente partagée.
 *
 * Ce qui est verrouillé ici :
 *   - RIEN NE TOURNE APRÈS `stop()`. Une boucle `requestAnimationFrame`
 *     oubliée derrière un overlay masqué tourne jusqu'au rechargement de la
 *     page et vide la batterie d'une tablette en intervention.
 *   - `prefers-reduced-motion` ne lance AUCUNE boucle : une seule image.
 *   - un canvas absent ou sans contexte 2D rend `null` sans jeter — c'est le
 *     cas sous jsdom, et le chargeur doit rester utilisable sans la sphère.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountOrb } from '@shared/orb.js';

interface FakeCtx {
    calls: number;
    setTransform: () => void;
    clearRect: () => void;
    beginPath: () => void;
    arc: () => void;
    fill: () => void;
    globalAlpha: number;
    fillStyle: string;
}

function fakeCanvas(): { canvas: HTMLCanvasElement; ctx: FakeCtx } {
    const ctx: FakeCtx = {
        calls: 0,
        setTransform: () => { ctx.calls += 1; },
        clearRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        globalAlpha: 1,
        fillStyle: '',
    };
    const canvas = {
        clientWidth: 72,
        width: 0,
        height: 0,
        getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    return { canvas, ctx };
}

/** Pilote `requestAnimationFrame` à la main : pas d'attente réelle. */
let pending: ((t: number) => void)[] = [];

beforeEach(() => {
    pending = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
        pending.push(cb);
        return pending.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending[id - 1] = () => {}; });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function avancer(): void {
    const dus = pending.splice(0, pending.length);
    dus.forEach((cb, i) => cb(1000 + i * 16));
}

describe('cycle de vie', () => {
    it('dessine tant qu\'elle tourne, et plus rien après stop()', () => {
        const { canvas, ctx } = fakeCanvas();
        const handle = mountOrb(canvas);
        expect(handle).not.toBeNull();

        avancer();
        const apresUnTour = ctx.calls;
        expect(apresUnTour).toBeGreaterThan(0);

        avancer();
        expect(ctx.calls).toBeGreaterThan(apresUnTour);

        handle?.stop();
        const gele = ctx.calls;
        avancer();
        avancer();
        expect(ctx.calls).toBe(gele);
    });

    it('supporte un stop() répété', () => {
        const { canvas } = fakeCanvas();
        const handle = mountOrb(canvas);
        expect(() => { handle?.stop(); handle?.stop(); }).not.toThrow();
    });

    it('dimensionne le canvas d\'après sa taille affichée et le ratio de pixels', () => {
        vi.stubGlobal('devicePixelRatio', 2);
        const { canvas } = fakeCanvas();
        mountOrb(canvas)?.stop();
        expect(canvas.width).toBe(144);
        expect(canvas.height).toBe(144);
    });
});

describe('mouvement réduit', () => {
    it('dessine une seule image et ne lance aucune boucle', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        const { canvas, ctx } = fakeCanvas();

        const handle = mountOrb(canvas);

        expect(ctx.calls).toBe(1);
        expect(pending).toHaveLength(0);
        expect(() => handle?.stop()).not.toThrow();
    });
});

describe('absence de contexte', () => {
    it('rend null sans canvas', () => {
        expect(mountOrb(null)).toBeNull();
    });

    it('rend null quand le contexte 2D est indisponible', () => {
        const canvas = { clientWidth: 72, getContext: () => null } as unknown as HTMLCanvasElement;
        expect(mountOrb(canvas)).toBeNull();
    });
});
