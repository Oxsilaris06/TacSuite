// tests/unit/ui-platform.test.ts
// TDD (P1.A5) — écrit AVANT src/shared/ui-platform.ts, depuis le comportement
// OBSERVÉ de GStart-main/shared/ui-platform.js (319 LOC, lu intégralement).
// Références `ui-platform.js:<ligne>` = fichier original (LECTURE SEULE).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UIPlatform } from '../../src/shared/ui-platform';

/** Construit un PointerEvent avec un `timeStamp` figé (jsdom l'autorise via defineProperty). */
function pointerEvent(
    type: string,
    init: PointerEventInit & { timeStamp?: number } = {},
): PointerEvent {
    const { timeStamp, ...rest } = init;
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, ...rest });
    if (timeStamp !== undefined) {
        Object.defineProperty(ev, 'timeStamp', { value: timeStamp, configurable: true });
    }
    return ev;
}

/** DOMRect minimal, tel que retourné par `Element.getBoundingClientRect()`. */
function rect(top: number, height: number, left = 0, width = 100): DOMRect {
    return {
        top,
        bottom: top + height,
        left,
        right: left + width,
        width,
        height,
        x: left,
        y: top,
        toJSON() {
            return this;
        },
    } as DOMRect;
}

describe('UIPlatform.esc / escAttr (ui-platform.js:13-22)', () => {
    it('échappe & < > " \'', () => {
        expect(UIPlatform.esc(`<a href="x">T&'o</a>`)).toBe(
            '&lt;a href=&quot;x&quot;&gt;T&amp;&#39;o&lt;/a&gt;',
        );
    });

    it('renvoie "" pour null et undefined', () => {
        expect(UIPlatform.esc(null)).toBe('');
        expect(UIPlatform.esc(undefined)).toBe('');
    });

    it('convertit les non-chaînes via String()', () => {
        expect(UIPlatform.esc(42)).toBe('42');
        expect(UIPlatform.esc(true)).toBe('true');
    });

    it('escAttr est un alias strict de esc', () => {
        expect(UIPlatform.escAttr('<x>')).toBe(UIPlatform.esc('<x>'));
    });
});

describe('UIPlatform.loadState / saveState / persistState (ui-platform.js:25-46)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('loadState renvoie le fallback si la clé est absente', () => {
        expect(UIPlatform.loadState('missing', 'fallback')).toBe('fallback');
        expect(UIPlatform.loadState('missing')).toBeUndefined();
    });

    it('loadState parse le JSON valide', () => {
        localStorage.setItem('k', JSON.stringify({ a: 1 }));
        expect(UIPlatform.loadState('k')).toEqual({ a: 1 });
    });

    it('loadState renvoie la chaîne brute si le JSON est invalide', () => {
        localStorage.setItem('k', 'not-json{');
        expect(UIPlatform.loadState('k', 'fb')).toBe('not-json{');
    });

    it('loadState renvoie le fallback si localStorage lève', () => {
        // NB : l'environnement jsdom de vitest fournit `localStorage` comme un
        // shim maison (constructor === Object), PAS une instance de la classe DOM
        // `Storage` — `vi.spyOn(Storage.prototype, …)` ne l'intercepterait pas
        // (vérifié empiriquement). On spy directement l'instance globale.
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new DOMException('unavailable');
        });
        expect(UIPlatform.loadState('k', 'fb')).toBe('fb');
    });

    it('saveState stringifie sauf si la valeur est déjà une chaîne', () => {
        expect(UIPlatform.saveState('k1', { a: 1 })).toBe(true);
        expect(localStorage.getItem('k1')).toBe('{"a":1}');
        expect(UIPlatform.saveState('k2', 'raw')).toBe(true);
        expect(localStorage.getItem('k2')).toBe('raw');
    });

    it('saveState renvoie false et logue un warning si localStorage lève', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new DOMException('quota');
        });
        expect(UIPlatform.saveState('k', 'v')).toBe(false);
        expect(warn).toHaveBeenCalled();
    });

    it('persistState applique la valeur chargée au boot puis renvoie un setter qui persiste', () => {
        localStorage.setItem('k', JSON.stringify(7));
        const applier = vi.fn();
        const setter = UIPlatform.persistState('k', applier, 0);
        expect(applier).toHaveBeenCalledWith(7);
        setter(99);
        expect(localStorage.getItem('k')).toBe('99');
    });

    it('persistState est non-bloquant si applier lève', () => {
        const applier = vi.fn(() => {
            throw new Error('boom');
        });
        expect(() => UIPlatform.persistState('k', applier, 'fb')).not.toThrow();
    });

    it('persistState fonctionne sans applier (undefined)', () => {
        localStorage.setItem('k', JSON.stringify('v'));
        const setter = UIPlatform.persistState('k');
        expect(typeof setter).toBe('function');
    });
});

describe('UIPlatform.lockScroll / unlockScroll (ui-platform.js:49-65, réf-comptés)', () => {
    beforeEach(() => {
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // avant reset (silence jsdom)
        UIPlatform.unlockScroll(true); // reset dur du compteur module-level entre tests
        document.body.className = '';
        document.body.style.top = '';
        Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('lockScroll pose la classe up-scroll-locked et fige body.style.top sur -scrollY', () => {
        UIPlatform.lockScroll();
        expect(document.body.classList.contains('up-scroll-locked')).toBe(true);
        expect(document.body.style.top).toBe('-240px');
    });

    it('unlockScroll ne déverrouille pas tant que le compteur > 0 (réf-compté)', () => {
        UIPlatform.lockScroll();
        UIPlatform.lockScroll();
        UIPlatform.unlockScroll();
        expect(document.body.classList.contains('up-scroll-locked')).toBe(true);
        UIPlatform.unlockScroll();
        expect(document.body.classList.contains('up-scroll-locked')).toBe(false);
    });

    it('unlockScroll(true) force le déverrouillage immédiat et restaure le scroll', () => {
        UIPlatform.lockScroll();
        UIPlatform.lockScroll();
        UIPlatform.lockScroll();
        UIPlatform.unlockScroll(true);
        expect(document.body.classList.contains('up-scroll-locked')).toBe(false);
        expect(document.body.style.top).toBe('');
        expect(window.scrollTo).toHaveBeenCalledWith(0, 240);
    });

    it('le compteur ne descend jamais sous 0 (unlock surnuméraire sans effet)', () => {
        UIPlatform.unlockScroll();
        UIPlatform.unlockScroll();
        UIPlatform.lockScroll();
        // Si le compteur était devenu négatif, ce lock ne remonterait pas à 1
        // et la classe resterait absente.
        expect(document.body.classList.contains('up-scroll-locked')).toBe(true);
    });
});

describe('UIPlatform.clampToViewport (ui-platform.js:68-82)', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    });

    it('ne fait rien si el est null/undefined', () => {
        expect(() => UIPlatform.clampToViewport(null)).not.toThrow();
        expect(() => UIPlatform.clampToViewport(undefined)).not.toThrow();
    });

    it("n'écrit pas de transform si l'élément est déjà dans le viewport", () => {
        const el = document.createElement('div');
        el.getBoundingClientRect = () => rect(10, 20, 10, 20);
        UIPlatform.clampToViewport(el);
        expect(el.style.transform).toBe('');
    });

    it('recadre (translate négatif) un élément qui déborde à droite/en bas, marge par défaut 8px', () => {
        const el = document.createElement('div');
        // right = 380+50 = 430 > 400-8=392 → dx = 392-430 = -38
        // bottom = 280+40 = 320 > 300-8=292 → dy = 292-320 = -28
        el.getBoundingClientRect = () => rect(280, 40, 380, 50);
        UIPlatform.clampToViewport(el);
        expect(el.style.transform).toBe('translate(-38px,-28px)');
    });

    it('cumule avec un transform déjà présent et respecte une marge personnalisée', () => {
        const el = document.createElement('div');
        el.style.transform = 'scale(1.1)';
        // top=50/height=20 → bottom=70, loin sous vh-margin=296 (dy reste 0).
        // left=-30 → dx = margin - left = 4-(-30) = 34.
        el.getBoundingClientRect = () => rect(50, 20, -30, 50);
        UIPlatform.clampToViewport(el, 4);
        expect(el.style.transform).toBe('scale(1.1) translate(34px,0px)');
    });
});

describe('UIPlatform.onLongPress (ui-platform.js:85-103)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('déclenche cb après le délai et isFired() reflète l’état', () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        const handle = UIPlatform.onLongPress(el, cb, { delay: 100, moveTol: 5 });
        el.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
        expect(handle.isFired()).toBe(false);
        vi.advanceTimersByTime(99);
        expect(cb).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(handle.isFired()).toBe(true);
    });

    it('annule si le pointeur bouge au-delà de moveTol avant le délai', () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        UIPlatform.onLongPress(el, cb, { delay: 100, moveTol: 5 });
        el.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
        el.dispatchEvent(pointerEvent('pointermove', { clientX: 10, clientY: 0 }));
        vi.advanceTimersByTime(200);
        expect(cb).not.toHaveBeenCalled();
    });

    it('annule sur pointerup/cancel/leave avant le délai', () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        UIPlatform.onLongPress(el, cb, { delay: 100 });
        el.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
        el.dispatchEvent(pointerEvent('pointerup'));
        vi.advanceTimersByTime(200);
        expect(cb).not.toHaveBeenCalled();
    });

    it('utilise les valeurs par défaut (delay 450, moveTol 10) si opts omis', () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        UIPlatform.onLongPress(el, cb);
        el.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
        vi.advanceTimersByTime(449);
        expect(cb).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

describe('UIPlatform.onDoubleTap (ui-platform.js:104-114)', () => {
    it('déclenche cb sur deux pointerup proches en temps ET en position', () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        UIPlatform.onDoubleTap(el, cb, { window: 320 });
        el.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0, timeStamp: 1000 }));
        el.dispatchEvent(pointerEvent('pointerup', { clientX: 5, clientY: 5, timeStamp: 1200 }));
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it("ne déclenche pas si le 2e tap est hors fenêtre temporelle", () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        UIPlatform.onDoubleTap(el, cb, { window: 320 });
        el.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0, timeStamp: 1000 }));
        el.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0, timeStamp: 1400 }));
        expect(cb).not.toHaveBeenCalled();
    });

    it('ne déclenche pas si le 2e tap est trop loin (>= 24px)', () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        UIPlatform.onDoubleTap(el, cb);
        el.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0, timeStamp: 1000 }));
        el.dispatchEvent(pointerEvent('pointerup', { clientX: 30, clientY: 0, timeStamp: 1100 }));
        expect(cb).not.toHaveBeenCalled();
    });

    it('un simple tap isolé ne déclenche jamais cb', () => {
        const el = document.createElement('div');
        const cb = vi.fn();
        UIPlatform.onDoubleTap(el, cb);
        el.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0, timeStamp: 1000 }));
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('UIPlatform.sortable (ui-platform.js:122-228, tri tactile Pointer Events)', () => {
    let container: HTMLDivElement;
    let a: HTMLDivElement;
    let b: HTMLDivElement;
    let c: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        a = document.createElement('div');
        b = document.createElement('div');
        c = document.createElement('div');
        a.className = 'sort-item';
        b.className = 'sort-item';
        c.className = 'sort-item';
        a.dataset.id = 'a';
        b.dataset.id = 'b';
        c.dataset.id = 'c';
        a.getBoundingClientRect = () => rect(0, 50);
        b.getBoundingClientRect = () => rect(50, 50);
        c.getBoundingClientRect = () => rect(100, 50);
        container.append(a, b, c);
        document.body.appendChild(container);
    });
    afterEach(() => {
        container.remove();
    });

    // NB : itemSelector explicite ('.sort-item'), comme le font TOUS les appelants
    // réels (articulation.js:443 : '.articulation-member' / '.rame-vl-chip' /
    // '.<type>-chip'). Le défaut ':scope > *' documenté (ui-platform.js:124) est
    // un piège avec `.closest()` : `:scope` reste lié à `e.target` (l'élément sur
    // lequel `.closest()` est invoqué), donc ':scope > *' ne peut matcher qu'un
    // DESCENDANT de e.target, jamais e.target lui-même ni un de ses ancêtres —
    // `elt.closest(':scope > *')` renvoie donc TOUJOURS `null` en pratique. Vérifié
    // empiriquement en jsdom ET conforme au comportement spécifié de `:scope`.
    // Aucun appelant réel n'omet `itemSelector`, ce chemin par défaut n'est donc
    // jamais exercé en production — porté verbatim (fidélité), non testé isolément.
    it('réordonne au drag au-delà du seuil et appelle onReorder(orderedItems, toIndex) — 2 arguments', () => {
        const onReorder = vi.fn();
        UIPlatform.sortable(container, { itemSelector: '.sort-item', threshold: 8, onReorder });

        // pointerdown SUR l'item "a" (e.target doit être l'item, pas le conteneur,
        // car onDown résout l'item via `e.target.closest(itemSelector)`), sous le
        // seuil : pas encore de drag.
        a.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 10, pointerId: 1 }));
        expect(container.classList.contains('up-sorting')).toBe(false);

        // Franchit le seuil (delta 9 > 8) → démarre le drag ("a" devient actif).
        container.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: 19, pointerId: 1 }));
        expect(container.classList.contains('up-sorting')).toBe(true);
        expect(a.classList.contains('up-sort-dragging')).toBe(true);

        // Déplace au-delà du milieu de "c" (mid=125) → le placeholder se positionne avant "c".
        container.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: 120, pointerId: 1 }));

        container.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 120, pointerId: 1 }));

        expect(onReorder).toHaveBeenCalledTimes(1);
        const call = onReorder.mock.calls[0] as [Element[], number];
        expect(call).toHaveLength(2); // le code n'en passe QUE deux (SPEC-CONTRATS §1.1)
        const [orderedItems, toIndex] = call;
        expect(orderedItems.map((el) => (el as HTMLElement).dataset.id)).toEqual(['b', 'a', 'c']);
        // Piège vérifié sur le code réel (ui-platform.js:206-211) : `ordered` vient
        // de `items()` = `container.querySelectorAll(itemSelector)`, qui EXCLUT le
        // placeholder (classe 'up-sort-placeholder', ne matche aucun itemSelector à
        // base de classe réellement utilisé par les appelants — articulation.js:443
        // passe toujours '.articulation-member' / '.rame-vl-chip' / '.<type>-chip').
        // `ordered.indexOf(placeholder)` vaut donc TOUJOURS -1 en usage réel : le
        // 2e argument transmis à onReorder est un index inexploitable. Sans
        // conséquence car les 3 callbacks réels (articulation.js:358,476,645)
        // l'ignorent et relisent le DOM déjà réordonné. Porté verbatim (fidélité).
        expect(toIndex).toBe(-1);

        // Nettoyage : le placeholder ne doit pas persister dans le DOM.
        expect(container.querySelectorAll('.up-sort-placeholder')).toHaveLength(0);
        expect(container.classList.contains('up-sorting')).toBe(false);
        expect(a.classList.contains('up-sort-dragging')).toBe(false);
    });

    it("respecte handleSelector : un drag démarré hors de la poignée ne déclenche rien", () => {
        const handleEl = document.createElement('span');
        handleEl.className = 'handle';
        a.appendChild(handleEl);
        const onReorder = vi.fn();
        UIPlatform.sortable(container, {
            itemSelector: '.sort-item',
            threshold: 8,
            handleSelector: '.handle',
            onReorder,
        });

        // Cible = "a" lui-même (pas la poignée) : closest('.handle') échoue → ignoré.
        a.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 10, pointerId: 2 }));
        a.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: 19, pointerId: 2 }));
        expect(container.classList.contains('up-sorting')).toBe(false);

        // Cible = la poignée : démarre bien le drag.
        handleEl.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 10, pointerId: 3 }));
        handleEl.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: 19, pointerId: 3 }));
        expect(container.classList.contains('up-sorting')).toBe(true);
    });

    it('destroy() retire les écouteurs : plus aucun drag ni onReorder après destruction', () => {
        const onReorder = vi.fn();
        const handle = UIPlatform.sortable(container, {
            itemSelector: '.sort-item',
            threshold: 8,
            onReorder,
        });
        handle.destroy();

        a.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 10, pointerId: 1 }));
        container.dispatchEvent(pointerEvent('pointermove', { clientX: 0, clientY: 19, pointerId: 1 }));
        container.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 19, pointerId: 1 }));

        expect(container.classList.contains('up-sorting')).toBe(false);
        expect(onReorder).not.toHaveBeenCalled();
    });
});

describe('UIPlatform.makeDialog (ui-platform.js:230-265, modale accessible)', () => {
    let trigger: HTMLButtonElement;
    let dialog: HTMLDivElement;
    let first: HTMLButtonElement;
    let last: HTMLButtonElement;

    function makeVisible(el: HTMLElement): void {
        Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
    }

    beforeEach(() => {
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // avant reset (silence jsdom)
        UIPlatform.unlockScroll(true);
        document.body.className = '';
        trigger = document.createElement('button');
        trigger.textContent = 'ouvrir';
        dialog = document.createElement('div');
        first = document.createElement('button');
        first.textContent = 'premier';
        last = document.createElement('button');
        last.textContent = 'dernier';
        dialog.append(first, last);
        document.body.append(trigger, dialog);
        makeVisible(first);
        makeVisible(last);
        trigger.focus();
    });
    afterEach(() => {
        trigger.remove();
        dialog.remove();
        vi.restoreAllMocks();
    });

    it('pose role=dialog et aria-modal=true (sans écraser un role déjà présent)', () => {
        UIPlatform.makeDialog(dialog);
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');

        const alertdialog = document.createElement('div');
        alertdialog.setAttribute('role', 'alertdialog');
        UIPlatform.makeDialog(alertdialog);
        expect(alertdialog.getAttribute('role')).toBe('alertdialog');
    });

    it('open() verrouille le scroll, ajoute up-kb-aware et focus le premier élément focusable', () => {
        const handle = UIPlatform.makeDialog(dialog);
        handle.open();
        expect(document.body.classList.contains('up-scroll-locked')).toBe(true);
        expect(dialog.classList.contains('up-kb-aware')).toBe(true);
        expect(document.activeElement).toBe(first);
    });

    it('close() déverrouille le scroll et restaure le focus au déclencheur', () => {
        const handle = UIPlatform.makeDialog(dialog);
        handle.open();
        handle.close();
        expect(document.body.classList.contains('up-scroll-locked')).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });

    it('Escape appelle onClose si fourni', () => {
        const onClose = vi.fn();
        const handle = UIPlatform.makeDialog(dialog, { onClose });
        handle.open();
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("Escape ne fait rien (ne lève pas) si onClose n'est pas fourni", () => {
        const dialog2 = document.createElement('div');
        document.body.appendChild(dialog2);
        const h2 = UIPlatform.makeDialog(dialog2);
        h2.open();
        expect(() =>
            dialog2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        ).not.toThrow();
        h2.close();
        dialog2.remove();
    });

    it('Tab piège le focus : boucle de dernier vers premier et inversement (Shift+Tab)', () => {
        const handle = UIPlatform.makeDialog(dialog);
        handle.open();

        last.focus();
        const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        dialog.dispatchEvent(tabEvent);
        expect(tabEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);

        first.focus();
        const shiftTabEvent = new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        dialog.dispatchEvent(shiftTabEvent);
        expect(shiftTabEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
    });
});

describe('UIPlatform.makeTablist (ui-platform.js:268-283, navigation clavier)', () => {
    let container: HTMLDivElement;
    let tabs: HTMLButtonElement[];

    beforeEach(() => {
        container = document.createElement('div');
        tabs = ['t0', 't1', 't2'].map((label) => {
            const t = document.createElement('button');
            t.setAttribute('role', 'tab');
            t.textContent = label;
            return t;
        });
        container.append(...tabs);
        document.body.appendChild(container);
    });
    afterEach(() => {
        container.remove();
    });

    it('pose role=tablist sur le conteneur', () => {
        UIPlatform.makeTablist(container);
        expect(container.getAttribute('role')).toBe('tablist');
    });

    it('ArrowRight/ArrowDown avance au suivant (avec bouclage), appelle activate', () => {
        const activate = vi.fn();
        UIPlatform.makeTablist(container, { activate });
        (tabs[0] as HTMLButtonElement).focus();
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(tabs[1]);
        expect(activate).toHaveBeenCalledWith(tabs[1]);

        (tabs[2] as HTMLButtonElement).focus();
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]); // bouclage
    });

    it('ArrowLeft/ArrowUp recule (avec bouclage négatif)', () => {
        UIPlatform.makeTablist(container);
        (tabs[0] as HTMLButtonElement).focus();
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(document.activeElement).toBe(tabs[2]); // bouclage négatif
    });

    it('Home va au premier, End va au dernier', () => {
        UIPlatform.makeTablist(container);
        (tabs[1] as HTMLButtonElement).focus();
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(document.activeElement).toBe(tabs[2]);
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);
    });

    it("ignore les touches non gérées et n'agit pas si le focus est hors tablist", () => {
        UIPlatform.makeTablist(container);
        (tabs[0] as HTMLButtonElement).focus();
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);

        const outsider = document.createElement('button');
        document.body.appendChild(outsider);
        outsider.focus();
        expect(document.activeElement).toBe(outsider);
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        // i < 0 (activeElement absent de tabs()) → retour anticipé, aucun effet.
        expect(document.activeElement).toBe(outsider);
        outsider.remove();
    });

    it('respecte un tabSelector personnalisé', () => {
        const other = document.createElement('div');
        other.className = 'custom-tab';
        other.setAttribute('tabindex', '0');
        container.appendChild(other);
        UIPlatform.makeTablist(container, { tabSelector: '.custom-tab' });
        // Un seul "tab" reconnu (other) : ArrowRight boucle sur lui-même.
        other.focus();
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(other);
    });
});
