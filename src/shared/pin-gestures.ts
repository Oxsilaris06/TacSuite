/**
 * pin-gestures.ts — Machine tactile partagée pour les pins de carte (PC-Tac +
 * OI), extraite VERBATIM de `pctac/planmap/pins.ts` (`_bindPinListeners`,
 * ~:361-502) : détection tap simple / double-clic desktop / double-tap mobile
 * sur un pin MapLibre, avec suppression du zoom double-clic natif et
 * anti-rebond après un drag.
 * ===========================================================================
 *
 * ⚠ ZONE À REVERTS (R3-d) : cette machine a été durcie par 8 commits + 2
 * reverts sur PC-Tac (804d5c0→c9c2cb0). Ce qui a échoué avant :
 *   - 6708973 (revert f5cfe9d) : "touch simple = édition" en un seul
 *     événement — trop de faux positifs (tout tap, y compris ceux qui
 *     démarrent un drag, ouvrait la roue).
 *   - d79708a (revert a74282e) : `click` DOM comme chemin PRIMAIRE de tap
 *     mobile — cause racine, cf. 02dd968 : `pointerup` ET `click` sont
 *     ANNULÉS par MapLibre quand `touchstart` appelle `preventDefault()` sur
 *     un marker `draggable: true`. Aucun `click`/`pointerup` mobile fiable
 *     n'arrive jamais sur `pinWrap` dans ce cas → il FAUT un chemin
 *     `touchstart`/`touchend` dédié, jamais un fallback `click` sur mobile.
 *   - 02dd968 a résolu la cause racine (chemin touch dédié) ; 1f4e393/c9c2cb0
 *     ont ensuite ajusté les seuils (tolérance de position au 2e tap, fenêtre
 *     650 ms, anti-rebond drag 250 ms) sans jamais revenir au `click`.
 *
 * Conséquence directe pour cette extraction : AUCUN fallback `click`/
 * `pointerup` mobile n'est réintroduit ici, y compris pour OI (qui utilisait
 * jusqu'ici un simple `click` DOM — bug mobile latent, cf. mission).
 *
 * API :
 *   - PC-Tac (`planmap/pins.ts`) : double-clic desktop (fenêtre 500 ms) /
 *     double-tap mobile (fenêtre 650 ms, tolérance 40 px) → `onDoubleTap`
 *     ouvre la roue ; `onSingleTap` ne fait que mémoriser (comportement
 *     interne au module, cf. plus bas).
 *   - OI (`carto/pins.ts`) : `onDoubleTap` omis → CHAQUE tap reconnu (desktop
 *     ou mobile) déclenche `onSingleTap` immédiatement (pas de fenêtre
 *     d'attente) — conserve le geste "tap simple = roue" d'OI, mais via les
 *     chemins pointer/touch fiables (suppression de zoom incluse), au lieu
 *     du `click` DOM + `setTimeout` inline abandonnés.
 */

export interface PinGestureInfo {
    x: number;
    y: number;
    isTouch: boolean;
}

export interface PinGestureCallbacks {
    /**
     * Tap reconnu qui n'est PAS apparié à un tap précédent dans la fenêtre de
     * double-tap (ou : si `onDoubleTap` n'est pas fourni, TOUT tap reconnu —
     * cas OI, "tap simple = action immédiate").
     */
    onSingleTap?: (info: PinGestureInfo) => void;
    /**
     * Double-clic desktop OU double-tap mobile reconnu (dans la fenêtre +
     * tolérance de position). Si omis, la machine ne mémorise/attend jamais
     * de second tap : `onSingleTap` est appelé pour chaque tap (cas OI).
     */
    onDoubleTap?: (info: PinGestureInfo) => void;
    /**
     * Neutralise le zoom double-clic natif de la carte (ex: MapLibre
     * `doubleClickZoom`) — appelé au tout début d'un geste valide
     * (pointerdown souris / touchstart), avant tout autre callback.
     */
    suppressDblZoom?: () => void;
    /**
     * Amorce d'un geste valide (post-exclusion, un seul doigt en tactile) —
     * équivalent du `onDown`/`handleTouchStart` original : le point d'accroche
     * pour capturer un état de départ (ex: position d'origine d'un marker) ou
     * une mise en avant visuelle (z-index).
     */
    onGestureStart?: (info: PinGestureInfo) => void;
    /**
     * Fin de geste SANS résolution en tap (pointerleave/pointercancel
     * desktop, ou inconditionnellement en tête de touchend/touchcancel
     * mobile — cf. `_bindPinListeners` original, asymétrie volontaire entre
     * desktop et mobile reproduite ici à l'identique). Aucun argument : ne
     * préjuge pas d'un tap.
     */
    onGestureEnd?: () => void;
}

export interface PinGestureOptions {
    /**
     * Cible(s) tactiles additionnelles (ex: le libellé d'un pin) : reçoivent
     * les MÊMES listeners touchstart/touchend/touchcancel, partageant le même
     * état interne (un tap sur `element` suivi d'un tap sur une cible annexe
     * compte comme double-tap, comme `pinWrap`/`labelEl` sur PC-Tac).
     */
    extraTouchTargets?: readonly HTMLElement[];
    /** Zone à exclure (ex: cadenas de verrouillage) : aucun geste ne s'amorce dessus. */
    isExcluded?: (target: EventTarget | null) => boolean;
    /** Enrobage optionnel des handlers (ex: `_safe` maison, garde d'erreurs + label). */
    safe?: <A extends unknown[], R>(fn: (...args: A) => R, label?: string) => (...args: A) => R | undefined;

    /** Anti-rebond : ignore le tap tactile qui suit un `notifyDragEnd()` dans cette fenêtre (ms). Défaut 250. */
    dragAntiBounceMs?: number;
    /** Fenêtre du double-clic desktop (ms). Défaut 500. */
    desktopDoubleClickWindowMs?: number;
    /** Seuil de mouvement (px) pour qu'un pointer desktop compte comme tap. Défaut 6. */
    desktopTapMoveThreshold?: number;
    /** Durée max (ms) pour qu'un pointer desktop compte comme tap. Défaut 500. */
    desktopTapMaxDurationMs?: number;
    /** Seuil de mouvement (px) pour qu'un touch mobile compte comme tap "propre". Défaut 30. */
    mobileTapMoveThreshold?: number;
    /** Durée max (ms) pour qu'un touch mobile compte comme tap "propre". Défaut 500. */
    mobileTapMaxDurationMs?: number;
    /** Fenêtre (ms) pour apparier un second tap mobile au premier. Défaut 650. */
    mobileDoubleTapWindowMs?: number;
    /** Tolérance de distance (px) entre les deux taps mobiles d'un double-tap. Défaut 40. */
    mobileDoubleTapTolerancePx?: number;
}

export interface PinGestureHandle {
    /** Retire tous les listeners posés par `attachPinGestures`. */
    detach(): void;
    /** À appeler depuis le `dragstart` externe (ex: `marker.on('dragstart', ...)`) qui pilote le déplacement réel du pin. */
    notifyDragStart(): void;
    /** À appeler depuis le `dragend` externe — arme l'anti-rebond tactile. */
    notifyDragEnd(): void;
}

const noop = (): void => { /* no-op */ };
const identitySafe = <A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined => fn;

/** Contrôle de zoom double-clic minimal (sous-ensemble de `maplibregl.Map['doubleClickZoom']`). */
export interface DblZoomControl {
    enable(): void;
    disable(): void;
}

/**
 * Neutralise le zoom double-clic natif de la carte le temps d'un geste sur un
 * pin, avec un timer de réactivation ANNULABLE : un second appel avant
 * l'expiration du premier reporte la réactivation au lieu de réarmer le zoom
 * prématurément (bug latent de l'ancien `setTimeout` inline d'OI — deux taps
 * rapprochés laissaient le premier timer réactiver le zoom pendant que la
 * suppression du second était censée encore courir). Même intention que
 * `PlanMapInternal._suppressDblZoom` (PC-Tac, `planmap/shapes-gestures.ts`,
 * hors périmètre de cette extraction), reformulée ici sans état sur `this`
 * pour rester réutilisable par n'importe quel appelant de `attachPinGestures`.
 */
export function createDblZoomSuppressor(
    getControl: () => DblZoomControl | null | undefined,
    delayMs = 450,
): { suppress: () => void } {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
        suppress(): void {
            const control = getControl();
            if (!control) return;
            try { control.disable(); } catch { /* API selon l'état courant de la carte */ }
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                try { control.enable(); } catch { /* idem */ }
            }, delayMs);
        },
    };
}

/**
 * Attache la machine de gestes tap/double-tap/double-clic à un élément de pin
 * (et, en option, à des cibles tactiles additionnelles partageant le même
 * état — ex: le libellé). Reprend VERBATIM le control-flow de
 * `_bindPinListeners` (PC-Tac, planmap/pins.ts ~:361-502) — cf. commentaire
 * d'en-tête pour l'historique des reverts qui ont mené à cette forme.
 */
export function attachPinGestures(
    element: HTMLElement,
    callbacks: PinGestureCallbacks,
    options: PinGestureOptions = {},
): PinGestureHandle {
    const isExcluded = options.isExcluded ?? (() => false);
    const safe = options.safe ?? identitySafe;
    const dragAntiBounceMs = options.dragAntiBounceMs ?? 250;
    const desktopDoubleClickWindowMs = options.desktopDoubleClickWindowMs ?? 500;
    const desktopTapMoveThreshold = options.desktopTapMoveThreshold ?? 6;
    const desktopTapMaxDurationMs = options.desktopTapMaxDurationMs ?? 500;
    const mobileTapMoveThreshold = options.mobileTapMoveThreshold ?? 30;
    const mobileTapMaxDurationMs = options.mobileTapMaxDurationMs ?? 500;
    const mobileDoubleTapWindowMs = options.mobileDoubleTapWindowMs ?? 650;
    const mobileDoubleTapTolerancePx = options.mobileDoubleTapTolerancePx ?? 40;

    const onSingleTap = callbacks.onSingleTap ?? noop;
    const onDoubleTap = callbacks.onDoubleTap;
    const suppressDblZoom = callbacks.suppressDblZoom ?? noop;
    const onGestureStart = callbacks.onGestureStart ?? noop;
    const onGestureEnd = callbacks.onGestureEnd ?? noop;

    // ─── État partagé (fermetures, comme l'original `_bindPinListeners`) ───
    let pdStart: { x: number; y: number; t: number } | null = null;
    let touchStart: { x: number; y: number; t: number } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let isDragging = false;
    let lastDragEnd = 0;

    // Résout un tap (single vs double) et notifie l'appelant. Si `onDoubleTap`
    // n'est pas fourni, chaque tap reconnu est un `onSingleTap` immédiat (cas
    // OI : pas de fenêtre d'attente, cf. commentaire d'en-tête).
    const resolveDoubleTapWindow = (
        info: PinGestureInfo,
        windowMs: number,
        tolerancePx: number,
    ): boolean => {
        if (!onDoubleTap) {
            onSingleTap(info);
            return false;
        }
        const now = Date.now();
        const prev = lastTap;
        const matched = !!prev && (now - prev.t) < windowMs
            && Math.hypot(info.x - prev.x, info.y - prev.y) < tolerancePx;
        if (matched) {
            lastTap = null;
            onDoubleTap(info);
            return true;
        }
        lastTap = { t: now, x: info.x, y: info.y };
        onSingleTap(info);
        return false;
    };

    // ─── DESKTOP POINTER EVENTS (souris uniquement) ───
    const onPointerDown = (ev: PointerEvent): void => {
        if (ev.pointerType === 'touch') return; // Mobile géré par touch* ci-dessous
        if (isExcluded(ev.target)) return;
        pdStart = { x: ev.clientX, y: ev.clientY, t: Date.now() };
        suppressDblZoom();
        onGestureStart({ x: ev.clientX, y: ev.clientY, isTouch: false });
    };

    const onPointerUp = (ev: PointerEvent): void => {
        if (ev.pointerType === 'touch') return;
        if (isExcluded(ev.target)) return;
        if (!pdStart) return;
        const dx = ev.clientX - pdStart.x, dy = ev.clientY - pdStart.y;
        const moved = Math.hypot(dx, dy);
        const dt = Date.now() - pdStart.t;
        const isTap = moved < desktopTapMoveThreshold && dt < desktopTapMaxDurationMs;
        pdStart = null;
        if (!isTap) return;

        ev.stopPropagation();
        ev.preventDefault();

        resolveDoubleTapWindow({ x: ev.clientX, y: ev.clientY, isTouch: false }, desktopDoubleClickWindowMs, Infinity);
    };

    const onPointerLeave = (): void => {
        onGestureEnd();
    };

    const onPointerCancel = (): void => {
        pdStart = null;
        onGestureEnd();
    };

    const onDblClick = (ev: MouseEvent): void => {
        // Neutralise le zoom double-clic natif de la carte au contact d'un pin.
        ev.stopPropagation();
        ev.preventDefault();
    };

    // ─── MOBILE TOUCH EVENTS (double-tap / tap mobile) ───
    const handleTouchStart = (ev: TouchEvent): void => {
        if (isExcluded(ev.target)) return;
        if (ev.touches && ev.touches.length > 1) return;
        const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
        if (!t) return;

        suppressDblZoom();
        touchStart = { x: t.clientX, y: t.clientY, t: Date.now() };
        onGestureStart({ x: t.clientX, y: t.clientY, isTouch: true });
    };

    const handleTouchEnd = (ev: TouchEvent): void => {
        onGestureEnd();
        if (isExcluded(ev.target)) return;
        if (!touchStart) return;

        const t = (ev.changedTouches && ev.changedTouches[0]) || (ev.touches && ev.touches[0]);
        const clientX = t ? t.clientX : touchStart.x;
        const clientY = t ? t.clientY : touchStart.y;
        const dx = clientX - touchStart.x;
        const dy = clientY - touchStart.y;
        const moved = Math.hypot(dx, dy);
        const dt = Date.now() - touchStart.t;
        touchStart = null;

        // Ignorer si un drag externe (ex: MapLibre) vient d'avoir lieu ou est en cours.
        if (isDragging || (Date.now() - lastDragEnd < dragAntiBounceMs)) return;

        // Touch propre (mouvement < seuil, durée < seuil).
        if (moved < mobileTapMoveThreshold && dt < mobileTapMaxDurationMs) {
            const info: PinGestureInfo = { x: clientX, y: clientY, isTouch: true };
            const matched = resolveDoubleTapWindow(info, mobileDoubleTapWindowMs, mobileDoubleTapTolerancePx);
            if (matched) {
                ev.stopPropagation();
                ev.preventDefault();
            }
        }
    };

    const handleTouchCancel = (): void => {
        touchStart = null;
        onGestureEnd();
    };

    const wrappedPointerDown = safe(onPointerDown, 'pin-gesture:pointerdown');
    const wrappedPointerUp = safe(onPointerUp, 'pin-gesture:pointerup');
    const wrappedPointerLeave = safe(onPointerLeave, 'pin-gesture:pointerleave');
    const wrappedPointerCancel = safe(onPointerCancel, 'pin-gesture:pointercancel');
    const wrappedDblClick = safe(onDblClick, 'pin-gesture:dblclick');
    const wrappedTouchStart = safe(handleTouchStart, 'pin-gesture:touchstart');
    const wrappedTouchEnd = safe(handleTouchEnd, 'pin-gesture:touchend');
    const wrappedTouchCancel = safe(handleTouchCancel, 'pin-gesture:touchcancel');

    element.addEventListener('pointerdown', wrappedPointerDown as EventListener, { capture: true });
    element.addEventListener('pointerup', wrappedPointerUp as EventListener, { capture: true });
    element.addEventListener('pointerleave', wrappedPointerLeave as EventListener);
    element.addEventListener('pointercancel', wrappedPointerCancel as EventListener, { capture: true });
    element.addEventListener('dblclick', wrappedDblClick as EventListener, { capture: true });

    const touchTargets = [element, ...(options.extraTouchTargets ?? [])];
    for (const target of touchTargets) {
        target.addEventListener('touchstart', wrappedTouchStart as EventListener, { passive: true });
        target.addEventListener('touchend', wrappedTouchEnd as EventListener);
        target.addEventListener('touchcancel', wrappedTouchCancel as EventListener);
    }

    return {
        detach(): void {
            element.removeEventListener('pointerdown', wrappedPointerDown as EventListener, { capture: true });
            element.removeEventListener('pointerup', wrappedPointerUp as EventListener, { capture: true });
            element.removeEventListener('pointerleave', wrappedPointerLeave as EventListener);
            element.removeEventListener('pointercancel', wrappedPointerCancel as EventListener, { capture: true });
            element.removeEventListener('dblclick', wrappedDblClick as EventListener, { capture: true });
            for (const target of touchTargets) {
                target.removeEventListener('touchstart', wrappedTouchStart as EventListener);
                target.removeEventListener('touchend', wrappedTouchEnd as EventListener);
                target.removeEventListener('touchcancel', wrappedTouchCancel as EventListener);
            }
        },
        notifyDragStart(): void {
            isDragging = true;
        },
        notifyDragEnd(): void {
            isDragging = false;
            lastDragEnd = Date.now();
        },
    };
}
