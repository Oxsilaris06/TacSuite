/**
 * ui-platform.ts — Port TypeScript de `shared/ui-platform.js` (GStart-main, 319 LOC).
 * =====================================================================================
 *
 * Socle transverse « native-quality » partagé OI + PC-Tac : échappement HTML,
 * persistance d'état UI, verrou de scroll réf-compté, recadrage viewport,
 * gestes (long-press / double-tap), tri tactile unifié (Pointer Events),
 * dialogs et tablists accessibles, suivi du clavier virtuel.
 *
 * Port QUASI VERBATIM (fidélité comportementale > élégance, cf. PLAN.md §4.7).
 * Références `ui-platform.js:<ligne>` = fichier original (GStart-main, LECTURE SEULE).
 *
 * Stratégie de façade (docs/SPEC-CONTRATS.md §1.1) : ce module exporte l'objet
 * `UIPlatform` ; c'est l'entrée de chaque app (`src/apps/<app>/main.ts`, phases
 * P2/P3) qui pose `window.UIPlatform = UIPlatform`. Les consommateurs internes
 * futurs (esc, sortable, makeTablist…) importent directement les fonctions
 * nommées exportées ci-dessous plutôt que de repasser par `window`.
 *
 * Écart de comportement RELEVÉ (à préserver verbatim, pas à corriger) :
 * `sortable().onReorder` reçoit en second argument un `toIndex` calculé via
 * `items().indexOf(placeholder)` (ui-platform.js:206-211). Or `items()` filtre
 * par `itemSelector`, et le placeholder (classe `up-sort-placeholder`) ne
 * matche JAMAIS un `itemSelector` à base de classe — soit la totalité des
 * appels réels (`modules/articulation.js:443` : toujours `.articulation-member`
 * / `.rame-vl-chip` / `.<type>-chip`, jamais le défaut `':scope > *'`). En
 * usage réel, `toIndex` vaut donc TOUJOURS `-1`. Sans conséquence observable :
 * les 3 callbacks réels (`articulation.js:358,476,645`) ignorent les deux
 * paramètres et relisent le DOM (déjà réordonné avant l'appel). Voir
 * `tests/unit/ui-platform.test.ts` pour la démonstration détaillée.
 *
 * Écart supplémentaire relevé (même zone) : le défaut `itemSelector` du JSDoc
 * (`':scope > *'`) est un piège combiné à `e.target.closest(itemSelector)`
 * dans `onDown` — `:scope` reste lié à l'élément sur lequel `.closest()` est
 * invoqué (`e.target`), donc `':scope > *'` ne peut matcher qu'un DESCENDANT
 * de `e.target`, jamais `e.target` lui-même ni un de ses ancêtres :
 * `elt.closest(':scope > *')` renvoie donc TOUJOURS `null`. Le chemin par
 * défaut ne peut donc jamais démarrer de drag ; aucun appelant réel ne s'y
 * fie (tous passent un `itemSelector` explicite). Porté verbatim.
 *
 * Non porté ici : l'auto-init (`init()`, ui-platform.js:299-306) — patch
 * `viewport-fit=cover` + suivi du clavier virtuel (`--kb-inset`, classe
 * `up-kb-open`) — s'exécute comme effet de bord au chargement du module,
 * exactement comme le script classique original s'exécutait immédiatement.
 */

import type {
    UIPlatformContract,
    UIPlatformDialogHandle,
    UIPlatformDialogOptions,
    UIPlatformDoubleTapOptions,
    UIPlatformLongPressHandle,
    UIPlatformLongPressOptions,
    UIPlatformSortableHandle,
    UIPlatformSortableOptions,
    UIPlatformTablistOptions,
} from './types/contracts.js';

/* =========================================================================
 * Échappement HTML (ui-platform.js:12-22)
 * ========================================================================= */

export function esc(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Alias strict de {@link esc} (ui-platform.js:22). */
export function escAttr(value: unknown): string {
    return esc(value);
}

/* =========================================================================
 * Persistance d'état UI (ui-platform.js:24-46)
 * ========================================================================= */

export function loadState(key: string, fallback?: unknown): unknown {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    } catch {
        return fallback;
    }
}

export function saveState(key: string, value: unknown): boolean {
    try {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn('[UIPlatform] saveState échec', key, error instanceof Error ? error.name : error);
        return false;
    }
}

/** Lit au boot (applier) ET renvoie un setter qui persiste à chaque changement. */
export function persistState(
    key: string,
    applier?: ((value: unknown) => void) | null,
    fallback?: unknown,
): (value: unknown) => void {
    const initial = loadState(key, fallback);
    try {
        if (typeof applier === 'function') applier(initial);
    } catch {
        /* non bloquant, cf. ui-platform.js:44 */
    }
    return (value: unknown) => {
        saveState(key, value);
    };
}

/* =========================================================================
 * Verrou de scroll réf-compté (ui-platform.js:48-65)
 * ========================================================================= */

let scrollLockCount = 0;
let savedScrollY = 0;

export function lockScroll(): void {
    scrollLockCount++;
    if (scrollLockCount > 1) return;
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.classList.add('up-scroll-locked');
}

export function unlockScroll(force?: boolean): void {
    if (force) scrollLockCount = 0;
    else scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount > 0) return;
    document.body.classList.remove('up-scroll-locked');
    document.body.style.top = '';
    window.scrollTo(0, savedScrollY);
}

/* =========================================================================
 * Recadrage popover dans le viewport (ui-platform.js:67-82)
 * ========================================================================= */

export function clampToViewport(el: HTMLElement | null | undefined, margin?: number | null): void {
    if (!el) return;
    const m = margin == null ? 8 : margin;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (r.right > vw - m) dx = vw - m - r.right;
    if (r.left + dx < m) dx = m - r.left;
    if (r.bottom > vh - m) dy = vh - m - r.bottom;
    if (r.top + dy < m) dy = m - r.top;
    if (dx || dy) {
        const prev = el.style.transform || '';
        el.style.transform = prev + ' translate(' + Math.round(dx) + 'px,' + Math.round(dy) + 'px)';
    }
}

/* =========================================================================
 * Gestes (ui-platform.js:84-114)
 * ========================================================================= */

export function onLongPress(
    el: HTMLElement,
    cb: (e: PointerEvent) => void,
    opts: UIPlatformLongPressOptions = {},
): UIPlatformLongPressHandle {
    const delay = opts.delay || 450;
    const moveTol = opts.moveTol || 10;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sx = 0;
    let sy = 0;
    let fired = false;

    function cancel(): void {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    el.addEventListener('pointerdown', (e: PointerEvent) => {
        fired = false;
        sx = e.clientX;
        sy = e.clientY;
        cancel();
        timer = setTimeout(() => {
            fired = true;
            cb(e);
        }, delay);
    });
    el.addEventListener('pointermove', (e: PointerEvent) => {
        if (timer && (Math.abs(e.clientX - sx) > moveTol || Math.abs(e.clientY - sy) > moveTol)) cancel();
    });
    (['pointerup', 'pointercancel', 'pointerleave'] as const).forEach((ev) => {
        el.addEventListener(ev, cancel);
    });

    return {
        isFired: () => fired,
    };
}

export function onDoubleTap(
    el: HTMLElement,
    cb: (e: PointerEvent) => void,
    opts: UIPlatformDoubleTapOptions = {},
): void {
    const win = opts.window || 320;
    let last = 0;
    let lx = 0;
    let ly = 0;
    el.addEventListener('pointerup', (e: PointerEvent) => {
        const now = e.timeStamp || performance.now();
        if (now - last < win && Math.abs(e.clientX - lx) < 24 && Math.abs(e.clientY - ly) < 24) {
            last = 0;
            cb(e);
        } else {
            last = now;
            lx = e.clientX;
            ly = e.clientY;
        }
    });
}

/* =========================================================================
 * Tri tactile unifié — Pointer Events (ui-platform.js:116-228)
 * =========================================================================
 * sortable(container, { itemSelector, handleSelector?, longPress?(ms|false),
 * threshold?, axis?, pointerTypes?, onReorder(orderedItems, toIndex) })
 * → { destroy() }
 * Souris + tactile + stylet d'un seul code. Sous le seuil/délai, le scroll de
 * la liste reste possible. touch-action:none uniquement pendant le drag.
 */

export function sortable(
    container: HTMLElement,
    opts: UIPlatformSortableOptions = {},
): UIPlatformSortableHandle {
    const itemSelector = opts.itemSelector || ':scope > *';
    const handleSel = opts.handleSelector ?? null;
    const longPressMs = opts.longPress === undefined ? 0 : opts.longPress;
    const threshold = opts.threshold == null ? 8 : opts.threshold;
    const axis = opts.axis === 'x' ? 'x' : 'y'; // 'y' = liste verticale (défaut), 'x' = horizontale

    let active: HTMLElement | null = null;
    let placeholder: HTMLElement | null = null;
    let startY = 0;
    let startX = 0;
    let lpTimer: ReturnType<typeof setTimeout> | null = null;
    let armed = false;
    let pointerId: number | null = null;
    // Original : `container.__pendingItem` (propriété ad hoc sur l'élément DOM).
    // Ici : simple variable de fermeture, purement interne au module — aucun
    // consommateur externe ne lit `.__pendingItem` (comportement identique).
    let pendingItem: HTMLElement | null = null;

    function items(): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    }

    function cleanup(): void {
        if (lpTimer) {
            clearTimeout(lpTimer);
            lpTimer = null;
        }
        if (active) {
            active.classList.remove('up-sort-dragging');
            active.style.transform = '';
            active.style.position = '';
            active.style.width = '';
            active.style.pointerEvents = '';
        }
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        container.classList.remove('up-sorting');
        active = null;
        placeholder = null;
        armed = false;
        pointerId = null;
    }

    function begin(item: HTMLElement, e: PointerEvent): void {
        armed = true;
        active = item;
        const r = item.getBoundingClientRect();
        placeholder = document.createElement(item.tagName);
        placeholder.className = 'up-sort-placeholder';
        placeholder.style.height = r.height + 'px';
        item.parentNode?.insertBefore(placeholder, item.nextSibling);
        item.classList.add('up-sort-dragging');
        item.style.width = r.width + 'px';
        container.classList.add('up-sorting');
        try {
            item.setPointerCapture(pointerId ?? -1);
        } catch {
            /* capture non supportée/déjà relâchée — non bloquant, cf. original */
        }
        moveTo(e.clientX, e.clientY);
    }

    function moveTo(clientX: number, clientY: number): void {
        if (!active) return;
        active.style.transform =
            axis === 'x' ? 'translateX(' + (clientX - startX) + 'px)' : 'translateY(' + (clientY - startY) + 'px)';
        const sibs = items().filter((el) => el !== active && el !== placeholder);
        let placed = false;
        for (const sib of sibs) {
            const r = sib.getBoundingClientRect();
            const pos = axis === 'x' ? clientX : clientY;
            const mid = axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
            if (pos < mid) {
                if (placeholder) container.insertBefore(placeholder, sib);
                placed = true;
                break;
            }
        }
        if (!placed && placeholder) container.appendChild(placeholder);
    }

    function onDown(e: PointerEvent): void {
        if (e.button != null && e.button !== 0) return;
        // Filtre optionnel par type de pointeur (ex. ['touch'] pour laisser la
        // souris au drag&drop HTML5 natif sur desktop).
        if (opts.pointerTypes && opts.pointerTypes.indexOf(e.pointerType) === -1) return;
        const target = e.target instanceof Element ? e.target : null;
        const item = target ? (target.closest(itemSelector) as HTMLElement | null) : null;
        if (!item || item.parentNode !== container) return;
        if (handleSel && !(target && target.closest(handleSel))) return;
        pointerId = e.pointerId;
        startY = e.clientY;
        startX = e.clientX;
        if (longPressMs) {
            lpTimer = setTimeout(() => begin(item, e), longPressMs);
        } else {
            pendingItem = item; // démarre au seuil de déplacement
        }
    }

    function onMove(e: PointerEvent): void {
        if (e.pointerId !== pointerId && pointerId !== null) return;
        if (armed) {
            e.preventDefault();
            moveTo(e.clientX, e.clientY);
            return;
        }
        if (lpTimer && (Math.abs(e.clientY - startY) > threshold || Math.abs(e.clientX - startX) > threshold)) {
            clearTimeout(lpTimer);
            lpTimer = null; // mouvement avant long-press = scroll
        }
        const primaryDelta = axis === 'x' ? Math.abs(e.clientX - startX) : Math.abs(e.clientY - startY);
        if (!longPressMs && pendingItem && primaryDelta > threshold) {
            const it = pendingItem;
            pendingItem = null;
            begin(it, e);
        }
    }

    function onUp(): void {
        pendingItem = null;
        if (armed && active && placeholder) {
            const ordered = items().filter((el) => el !== active);
            const toIdx = ordered.indexOf(placeholder);
            placeholder.parentNode?.insertBefore(active, placeholder);
            cleanup();
            if (typeof opts.onReorder === 'function') {
                opts.onReorder(items(), toIdx);
            }
        } else {
            cleanup();
        }
    }

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', cleanup);

    return {
        destroy(): void {
            container.removeEventListener('pointerdown', onDown);
            container.removeEventListener('pointermove', onMove);
            container.removeEventListener('pointerup', onUp);
            container.removeEventListener('pointercancel', cleanup);
            cleanup();
        },
    };
}

/* =========================================================================
 * Modale accessible (ui-platform.js:230-265)
 * ========================================================================= */

function getFocusable(root: HTMLElement): HTMLElement[] {
    return Array.from(
        root.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function makeDialog(el: HTMLElement, opts: UIPlatformDialogOptions = {}): UIPlatformDialogHandle {
    el.setAttribute('role', el.getAttribute('role') || 'dialog');
    el.setAttribute('aria-modal', 'true');
    let lastFocus: Element | null = null;

    function onKey(e: KeyboardEvent): void {
        if (e.key === 'Escape' && opts.onClose) {
            opts.onClose(e);
            return;
        }
        if (e.key !== 'Tab') return;
        const f = getFocusable(el);
        if (!f.length) return;
        const first = f[0] as HTMLElement;
        const last = f[f.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    return {
        open(): void {
            lastFocus = document.activeElement;
            el.classList.add('up-kb-aware');
            lockScroll();
            el.addEventListener('keydown', onKey);
            const f = getFocusable(el);
            if (f.length) (f[0] as HTMLElement).focus();
        },
        close(): void {
            el.removeEventListener('keydown', onKey);
            unlockScroll();
            if (lastFocus instanceof HTMLElement) {
                try {
                    lastFocus.focus();
                } catch {
                    /* non bloquant, cf. original */
                }
            }
        },
    };
}

/* =========================================================================
 * Onglets accessibles (ui-platform.js:267-283)
 * ========================================================================= */

export function makeTablist(container: HTMLElement, opts: UIPlatformTablistOptions = {}): void {
    const tabSel = opts.tabSelector || '[role="tab"]';
    container.setAttribute('role', 'tablist');

    function tabs(): HTMLElement[] {
        return Array.from(container.querySelectorAll<HTMLElement>(tabSel));
    }

    container.addEventListener('keydown', (e: KeyboardEvent) => {
        const t = tabs();
        const active = document.activeElement;
        const i = active instanceof HTMLElement ? t.indexOf(active) : -1;
        if (i < 0) return;
        let n = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % t.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + t.length) % t.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = t.length - 1;
        if (n >= 0) {
            e.preventDefault();
            const target = t[n];
            if (target) {
                target.focus();
                if (opts.activate) opts.activate(target);
            }
        }
    });
}

/* =========================================================================
 * Suivi du clavier virtuel + safe-area (ui-platform.js:285-306)
 * =========================================================================
 * Effet de bord au chargement du module, à l'identique du script classique
 * original (exécuté dès l'évaluation du fichier, pas derrière une action
 * utilisateur). Purement additif : n'altère aucun comportement existant.
 */

function initKeyboardTracking(): void {
    const raw = window.visualViewport;
    if (!raw) return;
    const vv = raw; // capture non-null : la narrowing de `raw` ne traverse pas `update`
    function update(): void {
        const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty('--kb-inset', inset + 'px');
        document.body.classList.toggle('up-kb-open', inset > 80);
    }
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
}

function initPlatform(): void {
    const vp = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (vp && !/viewport-fit/.test(vp.content)) {
        vp.content = vp.content + ', viewport-fit=cover';
    }
    initKeyboardTracking();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlatform);
} else {
    initPlatform();
}

/* =========================================================================
 * Façade agrégée — posée sur `window.UIPlatform` par l'entrée de chaque app
 * =========================================================================
 */

export const UIPlatform: UIPlatformContract = {
    esc,
    escAttr,
    loadState,
    saveState,
    persistState,
    lockScroll,
    unlockScroll,
    clampToViewport,
    onLongPress,
    onDoubleTap,
    sortable,
    makeDialog,
    makeTablist,
};
