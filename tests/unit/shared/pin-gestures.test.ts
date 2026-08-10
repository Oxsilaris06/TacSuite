/**
 * pin-gestures.test.ts — Tests du socle tactile partagé `src/shared/pin-gestures.ts`
 * (mission R3-d, D1 : PC-Tac = socle, extraction VERBATIM de
 * `pctac/planmap/pins.ts` `_bindPinListeners`, historique 804d5c0→c9c2cb0,
 * 2 reverts).
 *
 * Matrice couverte : double-clic desktop (fenêtre), double-tap mobile
 * (dans/hors fenêtre, hors tolérance de position), anti-rebond drag,
 * tap simple (mode "pas de double-tap", cf. usage OI), détachement.
 *
 * `tests/unit/pctac/pm-pins.test.ts` (PC-Tac) et
 * `tests/unit/oi/oi-carto-pins.test.ts` (OI) couvrent déjà chaque
 * consommateur bout-en-bout ; ce fichier teste le moteur lui-même, isolé de
 * MapLibre.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachPinGestures, createDblZoomSuppressor } from '../../../src/shared/pin-gestures.js';

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
});

function makeEl(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function pointerDown(el: HTMLElement, x: number, y: number, pointerType: 'mouse' | 'touch' = 'mouse'): void {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType }));
}
function pointerUp(el: HTMLElement, x: number, y: number, pointerType: 'mouse' | 'touch' = 'mouse'): void {
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType }));
}
function makeTouch(el: HTMLElement, x: number, y: number): Touch {
    return typeof Touch !== 'undefined'
        ? new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
        : { clientX: x, clientY: y, identifier: 1 } as Touch;
}
function touchStart(el: HTMLElement, x: number, y: number): void {
    const t = makeTouch(el, x, y);
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t] }));
}
function touchEnd(el: HTMLElement, x: number, y: number): void {
    const t = makeTouch(el, x, y);
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t] }));
}

describe('attachPinGestures — desktop double-clic (fenêtre)', () => {
    it('deux clics dans la fenêtre (défaut 500ms) déclenchent onDoubleTap, pas onSingleTap au 2e', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap });

        pointerDown(el, 10, 10); pointerUp(el, 10, 10);
        pointerDown(el, 10, 10); pointerUp(el, 10, 10);

        expect(onSingleTap).toHaveBeenCalledTimes(1);
        expect(onDoubleTap).toHaveBeenCalledTimes(1);
        expect(onDoubleTap).toHaveBeenCalledWith({ x: 10, y: 10, isTouch: false });
    });

    it('un clic isolé n\'appelle que onSingleTap', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap });

        pointerDown(el, 10, 10); pointerUp(el, 10, 10);

        expect(onSingleTap).toHaveBeenCalledTimes(1);
        expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('mouvement > seuil (6px défaut) entre down/up : pas un tap, aucun callback', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap });

        pointerDown(el, 10, 10); pointerUp(el, 50, 50);

        expect(onSingleTap).not.toHaveBeenCalled();
        expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('fenêtre personnalisée (desktopDoubleClickWindowMs) : hors fenêtre → 2 onSingleTap', async () => {
        vi.useFakeTimers();
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap }, { desktopDoubleClickWindowMs: 100 });

        pointerDown(el, 10, 10); pointerUp(el, 10, 10);
        vi.advanceTimersByTime(150);
        pointerDown(el, 10, 10); pointerUp(el, 10, 10);

        expect(onSingleTap).toHaveBeenCalledTimes(2);
        expect(onDoubleTap).not.toHaveBeenCalled();
    });
});

describe('attachPinGestures — double-tap mobile', () => {
    it('deux taps propres dans la fenêtre (650ms) et sous la tolérance (40px) → onDoubleTap', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap });

        touchStart(el, 10, 10); touchEnd(el, 10, 10);
        touchStart(el, 15, 12); touchEnd(el, 15, 12);

        expect(onSingleTap).toHaveBeenCalledTimes(1);
        expect(onDoubleTap).toHaveBeenCalledTimes(1);
        expect(onDoubleTap).toHaveBeenCalledWith({ x: 15, y: 12, isTouch: true });
    });

    it('hors fenêtre (> 650ms) : 2 onSingleTap, pas de onDoubleTap', () => {
        vi.useFakeTimers();
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap });

        touchStart(el, 10, 10); touchEnd(el, 10, 10);
        vi.advanceTimersByTime(700);
        touchStart(el, 10, 10); touchEnd(el, 10, 10);

        expect(onSingleTap).toHaveBeenCalledTimes(2);
        expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('dans la fenêtre mais hors tolérance de position (> 40px) : pas de double-tap', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap });

        touchStart(el, 10, 10); touchEnd(el, 10, 10);
        touchStart(el, 100, 100); touchEnd(el, 100, 100);

        expect(onSingleTap).toHaveBeenCalledTimes(2);
        expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('mouvement > seuil (30px défaut) pendant le tap : geste ignoré (ni single ni double)', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap, onDoubleTap });

        touchStart(el, 10, 10); touchEnd(el, 60, 60);

        expect(onSingleTap).not.toHaveBeenCalled();
        expect(onDoubleTap).not.toHaveBeenCalled();
    });
});

describe('attachPinGestures — anti-rebond drag', () => {
    it('notifyDragStart puis touchend pendant le drag : geste ignoré', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const handle = attachPinGestures(el, { onSingleTap });

        touchStart(el, 10, 10);
        handle.notifyDragStart();
        touchEnd(el, 10, 10);

        expect(onSingleTap).not.toHaveBeenCalled();
    });

    it('notifyDragEnd puis tap dans la fenêtre d\'anti-rebond (250ms défaut) : ignoré', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const handle = attachPinGestures(el, { onSingleTap });

        handle.notifyDragStart();
        handle.notifyDragEnd();
        touchStart(el, 10, 10); touchEnd(el, 10, 10);

        expect(onSingleTap).not.toHaveBeenCalled();
    });

    it('tap après expiration de l\'anti-rebond : reconnu normalement', () => {
        vi.useFakeTimers();
        const el = makeEl();
        const onSingleTap = vi.fn();
        const handle = attachPinGestures(el, { onSingleTap }, { dragAntiBounceMs: 100 });

        handle.notifyDragStart();
        handle.notifyDragEnd();
        vi.advanceTimersByTime(150);
        touchStart(el, 10, 10); touchEnd(el, 10, 10);

        expect(onSingleTap).toHaveBeenCalledTimes(1);
    });
});

describe('attachPinGestures — tap simple sans double-tap (mode OI : onDoubleTap omis)', () => {
    it('chaque tap desktop reconnu appelle onSingleTap immédiatement, même rapproché', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        attachPinGestures(el, { onSingleTap });

        pointerDown(el, 10, 10); pointerUp(el, 10, 10);
        pointerDown(el, 10, 10); pointerUp(el, 10, 10);

        expect(onSingleTap).toHaveBeenCalledTimes(2);
    });

    it('chaque tap mobile reconnu appelle onSingleTap immédiatement, même rapproché', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        attachPinGestures(el, { onSingleTap });

        touchStart(el, 10, 10); touchEnd(el, 10, 10);
        touchStart(el, 10, 10); touchEnd(el, 10, 10);

        expect(onSingleTap).toHaveBeenCalledTimes(2);
    });
});

describe('attachPinGestures — exclusion, suppression de zoom, cycle de vie', () => {
    it('isExcluded bloque un pointerdown/touchstart ciblant la zone exclue', () => {
        const el = makeEl();
        const excluded = document.createElement('span');
        excluded.className = 'lock-badge';
        el.appendChild(excluded);
        const onSingleTap = vi.fn();
        const suppressDblZoom = vi.fn();
        attachPinGestures(el, { onSingleTap, suppressDblZoom }, {
            isExcluded: (target) => !!(target instanceof Element && target.closest('.lock-badge')),
        });

        excluded.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, pointerType: 'mouse' }));
        excluded.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, pointerType: 'mouse' }));

        expect(onSingleTap).not.toHaveBeenCalled();
        expect(suppressDblZoom).not.toHaveBeenCalled();
    });

    it('suppressDblZoom est appelé au pointerdown desktop et au touchstart mobile', () => {
        const el = makeEl();
        const suppressDblZoom = vi.fn();
        attachPinGestures(el, { onSingleTap: vi.fn(), suppressDblZoom });

        pointerDown(el, 10, 10);
        expect(suppressDblZoom).toHaveBeenCalledTimes(1);

        touchStart(el, 20, 20);
        expect(suppressDblZoom).toHaveBeenCalledTimes(2);
    });

    it('onGestureStart/onGestureEnd encadrent un geste desktop (down → leave)', () => {
        const el = makeEl();
        const onGestureStart = vi.fn();
        const onGestureEnd = vi.fn();
        attachPinGestures(el, { onSingleTap: vi.fn(), onGestureStart, onGestureEnd });

        pointerDown(el, 10, 10);
        expect(onGestureStart).toHaveBeenCalledTimes(1);
        el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
        expect(onGestureEnd).toHaveBeenCalledTimes(1);
    });

    it('dblclick sur l\'élément est neutralisé (stopPropagation + preventDefault)', () => {
        const el = makeEl();
        attachPinGestures(el, { onSingleTap: vi.fn() });
        const parent = document.createElement('div');
        el.parentElement?.replaceChild(parent, el);
        parent.appendChild(el);
        const parentHandler = vi.fn();
        parent.addEventListener('dblclick', parentHandler);

        const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
        el.dispatchEvent(ev);

        expect(parentHandler).not.toHaveBeenCalled();
        expect(ev.defaultPrevented).toBe(true);
    });

    it('extraTouchTargets : un tap sur la cible annexe compte pour le double-tap de `element`', () => {
        const el = makeEl();
        const label = document.createElement('div');
        document.body.appendChild(label);
        const onDoubleTap = vi.fn();
        attachPinGestures(el, { onSingleTap: vi.fn(), onDoubleTap }, { extraTouchTargets: [label] });

        touchStart(el, 10, 10); touchEnd(el, 10, 10);
        touchStart(label, 12, 11); touchEnd(label, 12, 11);

        expect(onDoubleTap).toHaveBeenCalledTimes(1);
    });

    it('detach() retire tous les listeners : plus aucun callback après', () => {
        const el = makeEl();
        const onSingleTap = vi.fn();
        const handle = attachPinGestures(el, { onSingleTap });

        handle.detach();
        pointerDown(el, 10, 10); pointerUp(el, 10, 10);
        touchStart(el, 10, 10); touchEnd(el, 10, 10);

        expect(onSingleTap).not.toHaveBeenCalled();
    });

    it('safe() enrobe les handlers (ex: `_safe` maison) et reçoit un label', () => {
        const el = makeEl();
        const labels: string[] = [];
        const safe = <A extends unknown[], R>(fn: (...args: A) => R, label?: string) => {
            if (label) labels.push(label);
            return fn;
        };
        attachPinGestures(el, { onSingleTap: vi.fn() }, { safe });

        expect(labels).toContain('pin-gesture:pointerdown');
        expect(labels).toContain('pin-gesture:touchstart');
    });
});

describe('createDblZoomSuppressor — timer annulable', () => {
    it('un appel isolé désactive puis réactive après delayMs', () => {
        vi.useFakeTimers();
        const disable = vi.fn();
        const enable = vi.fn();
        const suppressor = createDblZoomSuppressor(() => ({ disable, enable }), 450);

        suppressor.suppress();
        expect(disable).toHaveBeenCalledTimes(1);
        expect(enable).not.toHaveBeenCalled();

        vi.advanceTimersByTime(450);
        expect(enable).toHaveBeenCalledTimes(1);
    });

    it('deux appels rapprochés reportent la réactivation (pas de réactivation prématurée)', () => {
        vi.useFakeTimers();
        const disable = vi.fn();
        const enable = vi.fn();
        const suppressor = createDblZoomSuppressor(() => ({ disable, enable }), 450);

        suppressor.suppress();
        vi.advanceTimersByTime(300);
        suppressor.suppress(); // reporte le timer

        vi.advanceTimersByTime(300); // t=600 depuis le 1er appel, mais 300 depuis le 2e
        expect(enable).not.toHaveBeenCalled();

        vi.advanceTimersByTime(150); // t=450 depuis le 2e appel
        expect(enable).toHaveBeenCalledTimes(1);
    });

    it('getControl() renvoyant null/undefined : aucun appel, ne jette pas', () => {
        const suppressor = createDblZoomSuppressor(() => null);
        expect(() => suppressor.suppress()).not.toThrow();
    });
});
