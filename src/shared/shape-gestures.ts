/**
 * shape-gestures.ts — Machine à gestes partagée pour les FORMES de carte
 * (PC-Tac aujourd'hui, OI dans un chantier ultérieur), extraite VERBATIM du
 * cœur de `pctac/planmap/shapes-gestures.ts` (même précédent que
 * `@shared/pin-gestures.js`, extrait de `pctac/planmap/pins.ts`).
 * ===========================================================================
 *
 * Noyau extrait (drag / pinch / poignées) :
 *   - `startShapeDragGesture`  — drag de forme + résolution tap vs drag
 *     (ex `_startShapeGesture`, planMap.js:2865-2988) ;
 *   - `startPinchGesture`      — pinch-resize 2 doigts sur la forme
 *     sélectionnée (ex `_startPinchGesture`, planMap.js:3122-3180) ;
 *   - `shapeHandles`           — calcul PUR des poignées par type de forme
 *     (ex `_shapeHandles`, planMap.js:3203-3231) ;
 *   - `renderShapeHandles`     — création des éléments de poignée + binding
 *     pointerdown/touchstart (ex `_renderHandles`, planMap.js:3233-3282) ;
 *   - `startHandleGesture`     — drag d'une poignée, pivot par rôle
 *     (ex `_startHandleGesture`, planMap.js:3284-3395).
 *
 * RESTE côté app (adaptateur) : l'orchestration sélection/roue/verrous
 * (`_selectShape`, `_deselectShape`, `_openShapeContextMenu`), l'entrée par
 * couches carte (`_shapePointerDown`), l'attache/détache du listener pinch,
 * la suppression du zoom double-clic, la fenêtre de double-tap (350 ms,
 * état `_lastShapeTap`), la toolbar flottante et le stockage des markers.
 *
 * AUCUN import de contrat PC-Tac : types locaux POJO + objet d'injection
 * `ShapeGestureDeps` fourni par l'app (accès formes, persistance, re-render,
 * état de geste partagé, conversion via la carte, fabrique de markers).
 * Helpers géométriques : `circlePolygon`/`rectPolygon`/`LngLatTuple` importés
 * du socle commun `./geo-shapes.js` (jamais dupliqués).
 *
 * ⚠ INVARIANT §5.4 (SPEC-PLANMAP-SPLIT.md) — verrou par-forme : les gardes
 * `deps.isLocked()` (verrou GLOBAL) et `shape.locked` (verrou PAR-FORME) sont
 * DISTINCTES : ne pas les fusionner, ne pas en supprimer une.
 *
 * ⚠ INVARIANT §5.1 — les éléments de poignée sont portés par des Markers
 * carte : JAMAIS de `position:`/`inset:` inline sur leur élément.
 */

import { circlePolygon, rectPolygon } from './geo-shapes.js';
import type { LngLatTuple } from './geo-shapes.js';

/** Point {lng,lat} — forme utilisée par MapLibre et par les callbacks app. */
export interface ShapeGestureLngLat { lng: number; lat: number }

/** Rôle d'une poignée de manipulation (planMap.js:3203-3231). */
export type ShapeHandleRole = 'move' | 'corner' | 'edge' | 'endpoint' | 'textresize';

/** Poignée calculée : où la rendre, quel curseur, quel geste au drag. */
export interface ShapeHandleSpec { role: ShapeHandleRole; index: number; lngLat: ShapeGestureLngLat; cursor: string }

/**
 * Sous-ensemble POJO d'une forme persistée, suffisant pour la machine à
 * gestes. Chaque app fournit son propre type concret (`S extends
 * ShapeGestureShape`) — PC-Tac : `PlanShape`.
 */
export interface ShapeGestureShape {
    id: string;
    type: string;
    coords?: LngLatTuple[] | undefined;
    center?: LngLatTuple | undefined;
    edge?: LngLatTuple | undefined;
    fontSize?: number | undefined;
    locked?: boolean | undefined;
}

/**
 * État d'un geste en cours (drag de forme / pinch / poignée) — structurellement
 * identique au `ShapeGestureState` de PC-Tac (planMap.js:2882), stocké PAR
 * L'APP (un seul slot par carte) via `getGesture`/`setGesture` : les gardes
 * croisées de l'app (`_shapePointerDown`, pinch, poignées) continuent de le
 * voir.
 */
export interface ShapeGestureState<S extends ShapeGestureShape = ShapeGestureShape> {
    type?: 'pinch' | 'handle' | undefined;
    shapeId?: string | undefined;
    startLngLat?: ShapeGestureLngLat | undefined;
    isDrag?: boolean | undefined;
    original?: S | null | undefined;
    role?: ShapeHandleRole | undefined;
    index?: number | undefined;
    startPx?: { x: number; y: number } | undefined;
}

/**
 * Événements carte utilisés par la machine — union FERMÉE (et non `string`) :
 * les overloads de `maplibregl.Map['on']` sont génériques sur
 * `keyof MapEventType`, un `type: string` ne leur serait pas assignable.
 */
export type ShapeGestureMapEventName = 'mousemove' | 'mouseup' | 'touchmove' | 'touchend' | 'touchcancel';

/** Sous-ensemble structurel de `maplibregl.Map` réellement utilisé par la machine. */
export interface ShapeGestureMap {
    project(lngLat: ShapeGestureLngLat): { x: number; y: number };
    unproject(point: [number, number]): { lng: number; lat: number };
    getCanvas(): { style: { cursor: string }; getBoundingClientRect(): { left: number; top: number } };
    // `(ev: any)` et non `(ev: never)` : les overloads génériques de
    // `maplibregl.Map['on']` ne sont structurellement assignables qu'à un
    // listener bivariant "large" (vérifié sous la config stricte du repo).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(type: ShapeGestureMapEventName, listener: (ev: any) => void): unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(type: ShapeGestureMapEventName, listener: (ev: any) => void): unknown;
    dragPan: { enable(): void; disable(): void };
    touchZoomRotate: { enable(): void; disable(): void };
}

/** Enrobage des handlers (ex: `_safe` maison, garde d'erreurs + label) — même contrat que pin-gestures. */
export type ShapeGestureSafe = <A extends unknown[], R>(fn: (...args: A) => R, label?: string) => (...args: A) => R | undefined;

/**
 * Injection app-spécifique : accès aux formes, persistance, re-render, état
 * de geste, résolution tap/drag et fabrique de markers de poignée.
 * `M` = type opaque du marker créé par l'app (PC-Tac : `maplibregl.Marker`) —
 * la machine ne fait que le retourner, le retrait reste à l'app.
 */
export interface ShapeGestureDeps<S extends ShapeGestureShape, M = unknown> {
    /** Carte non-nulle : l'app garde `if (!map) return;` AVANT d'appeler. */
    map: ShapeGestureMap;
    loadShapes(): S[];
    saveShapes(list: S[]): void;
    renderShapes(): void;
    pushHistory(): void;
    refreshUndoRedoButtons(): void;
    safe: ShapeGestureSafe;
    /** Slot unique d'état de geste (lu par identité ET par `type`). */
    getGesture(): ShapeGestureState<S> | null;
    setGesture(gesture: ShapeGestureState<S> | null): void;
    /** Verrou GLOBAL — le verrou PAR-FORME (`shape.locked`) est lu ici aussi, invariant §5.4. */
    isLocked(): boolean;
    getSelectedShapeId(): string | null;
    /** Fin de drag de forme (ex-branche `isDrag` de l'onUp : refresh undo/redo + re-sélection). */
    onDragEnd(shapeId: string): void;
    /** Tap (pas de drag) : l'app y garde sa fenêtre de double-tap + suppression du zoom double-clic. */
    onTap(shapeId: string, startLngLat: ShapeGestureLngLat): void;
    /** Centroïde de forme (pivot du pinch) — helper app (PC-Tac : `_shapeCentroid`). */
    shapeCentroid(shape: S): LngLatTuple;
    /** Forme sélectionnée introuvable au rendu des poignées → désélection (planMap.js:3238-3239). */
    deselectShape(): void;
    /** Garde d'amorce d'un drag de poignée (ex `drawTool || moveState || _gesture`, planMap.js:3269). */
    canStartHandleGesture(): boolean;
    /** Crée le marker carte portant l'élément de poignée (anchor centre ; `offset` : cas textresize). */
    createHandleMarker(el: HTMLElement, lngLat: ShapeGestureLngLat, offset?: [number, number]): M;
    /** Après chaque move de poignée (ex : re-rendre les poignées + repositionner la toolbar flottante). */
    afterHandleDrag(): void;
}

/**
 * Événement de déplacement/relâchement : le MÊME handler est posé via
 * `map.on(...)` (événements carte, forme structurelle `{ lngLat, point? }`)
 * ET via `document.addEventListener(...)` (PointerEvent/TouchEvent natifs),
 * pour couvrir les mouvements qui sortent du canvas (planMap.js:2976-2987,
 * 3385-3394).
 */
export interface MapGestureEventLike {
    lngLat: ShapeGestureLngLat;
    point?: { x: number; y: number } | undefined;
}
export type ShapeGestureMoveEvent = MapGestureEventLike | PointerEvent | TouchEvent;

/** Événement touch de carte (pinch) : `originalEvent` porte le TouchEvent natif. */
export interface MapTouchEventLike { originalEvent: TouchEvent }

/** `pointerdown`/`touchstart` posé directement sur l'élément DOM d'une poignée (planMap.js:3278-3279). */
type HandleDownEvent = PointerEvent | TouchEvent;

/** `s.coords ?? []` — mêmes replis que `pctac/planmap/geo.ts` (SPEC-PLANMAP-SPLIT.md §6.3). */
function shapeCoords(s: ShapeGestureShape): LngLatTuple[] {
    return s.coords ?? [];
}
function coordAt(s: ShapeGestureShape, i: number): LngLatTuple {
    return shapeCoords(s)[i] ?? [0, 0];
}

/**
 * Machine d'états du geste sur une forme : détection drag (seuil px), drag
 * live (translation + persistance + re-render), sinon tap remis à l'app.
 * L'app appelle `deps.onDragEnd` / `deps.onTap` à la résolution.
 */
// planMap.js:2865-2988 (ex `_startShapeGesture` — le preventDefault d'entrée reste côté app)
export function startShapeDragGesture<S extends ShapeGestureShape, M>(
    deps: ShapeGestureDeps<S, M>,
    shapeId: string,
    startLngLat: ShapeGestureLngLat,
    options: { dragThresholdPx?: number } = {},
): void {
    const DRAG_PX = options.dragThresholdPx ?? 6;
    const map = deps.map;
    const startPt = map.project(startLngLat);

    // Désactive le pan le temps du geste (réactivé au pointerup)
    try { map.dragPan.disable(); } catch { /* API carte peut jeter selon l'état du style */ }
    map.getCanvas().style.cursor = 'grabbing';

    const state: ShapeGestureState<S> = { shapeId, startLngLat, isDrag: false, original: null };
    deps.setGesture(state);

    // Verrou individuel : si la forme est figée, on n'autorisera pas le drag
    // (le tap → menu contextuel reste possible, pour pouvoir la déverrouiller).
    const lockedShape = (() => {
        const sh = deps.loadShapes().find(s => s.id === shapeId);
        return !!(sh && sh.locked);
    })();

    // Convertit un événement DOM (clientX/Y) en lngLat carte
    const clientToLngLat = (clientX: number, clientY: number): ShapeGestureLngLat => {
        const rect = map.getCanvas().getBoundingClientRect();
        return map.unproject([clientX - rect.left, clientY - rect.top]);
    };

    // Récupère lngLat depuis un événement carte OU DOM
    const extractLngLat = (ev: ShapeGestureMoveEvent): ShapeGestureLngLat | null => {
        if ('lngLat' in ev && ev.lngLat) return ev.lngLat;
        if ('touches' in ev && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
        if ('clientX' in ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
        return null;
    };

    const onMove = deps.safe((ev: ShapeGestureMoveEvent) => {
        if (deps.getGesture() !== state) return;
        const cur = extractLngLat(ev);
        if (!cur) return;
        // Détection drag : seuil franchi ? (jamais en mode verrouillé → position figée)
        if (!state.isDrag && !deps.isLocked() && !lockedShape) {
            const p = map.project(cur);
            if (Math.hypot(p.x - startPt.x, p.y - startPt.y) > DRAG_PX) {
                // Bascule en mode drag : snapshot + history
                const list = deps.loadShapes();
                const shape = list.find(s => s.id === shapeId);
                if (!shape) return;
                state.original = JSON.parse(JSON.stringify(shape)) as S;
                deps.pushHistory();
                state.isDrag = true;
            }
        }
        // Drag actif : translation = curseur - point de départ
        const original = state.original;
        if (state.isDrag && original) {
            const dLng = cur.lng - startLngLat.lng;
            const dLat = cur.lat - startLngLat.lat;
            const list = deps.loadShapes();
            const target = list.find(s => s.id === shapeId);
            if (!target) return;
            // Écritures via le type de base (les propriétés d'un `S` générique
            // ne sont pas assignables directement) — mêmes objets, même effet.
            const tb: ShapeGestureShape = target;
            tb.coords = shapeCoords(original).map(([x, y]): LngLatTuple => [x + dLng, y + dLat]);
            if (original.center) tb.center = [original.center[0] + dLng, original.center[1] + dLat];
            if (original.edge)   tb.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
            deps.saveShapes(list);
            deps.renderShapes();
        }
    }, 'shapeGesture:move');

    const onUp = deps.safe((ev: ShapeGestureMoveEvent) => {
        // `ev` n'est jamais lu (planMap.js:2938-2974) ; `void` neutralise
        // `noUnusedParameters` sans changer position ni type du paramètre.
        void ev;
        if (deps.getGesture() !== state) return;
        // Cleanup listeners
        try { map.off('mousemove', onMove); } catch { /* API carte peut jeter selon l'état du style */ }
        try { map.off('touchmove', onMove); } catch { /* idem */ }
        try { map.off('mouseup', onUp); } catch { /* idem */ }
        try { map.off('touchend', onUp); } catch { /* idem */ }
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
        try { map.dragPan.enable(); } catch { /* idem */ }
        map.getCanvas().style.cursor = '';
        deps.setGesture(null);

        if (state.isDrag) {
            deps.onDragEnd(shapeId);
        } else {
            // Pas de drag → un tap : résolution simple/double remise à l'app
            // (fenêtre 350 ms + suppression du zoom double-clic, état app).
            deps.onTap(shapeId, startLngLat);
        }
    }, 'shapeGesture:up');

    // Listeners sur la carte (couvre les events sur le canvas)
    map.on('mousemove', onMove);
    map.on('touchmove', onMove);
    map.on('mouseup',   onUp);
    map.on('touchend',  onUp);
    // ET sur le document (couvre les events qui sortent du canvas, p.ex. drag rapide)
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
}

/**
 * Pinch-resize 2 doigts de la forme sélectionnée (style Canva). L'app a déjà
 * gardé sélection/verrous/outil et désactivera son listener touchstart ;
 * ici : snapshot + scaling live autour du centroïde + restitution des
 * contrôles natifs à la fin.
 */
// planMap.js:3122-3180 (ex `_startPinchGesture`)
export function startPinchGesture<S extends ShapeGestureShape, M>(deps: ShapeGestureDeps<S, M>): void {
    const list = deps.loadShapes();
    const selectedId = deps.getSelectedShapeId();
    const shape = list.find(s => s.id === selectedId);
    if (!shape) return;
    const map = deps.map;
    try { map.touchZoomRotate.disable(); } catch { /* API carte peut jeter selon l'état du style */ }
    try { map.dragPan.disable(); } catch { /* idem */ }
    deps.setGesture({ type: 'pinch' });
    deps.pushHistory();
    const original = JSON.parse(JSON.stringify(shape)) as S;
    const center = deps.shapeCentroid(shape);
    let initDist: number | null = null;

    const getDist = (touches: TouchList): number => {
        // `touches[0]`/`touches[1]` toujours présents ici (l'appelant garde
        // `oe.touches.length >= 2`) : repli à 0 neutre, jamais atteint.
        const t0 = touches[0];
        const t1 = touches[1];
        if (!t0 || !t1) return 0;
        return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    };

    const onMove = deps.safe((e: MapTouchEventLike) => {
        const oe = e.originalEvent || e;
        if (!oe.touches || oe.touches.length < 2) return;
        oe.preventDefault();
        const dist = getDist(oe.touches);
        if (initDist === null) { initDist = dist; return; }
        if (initDist < 1) return;
        const scale = Math.max(0.1, Math.min(20, dist / initDist));
        const list2 = deps.loadShapes();
        const t = list2.find(s => s.id === shape.id);
        if (!t) return;
        const tb: ShapeGestureShape = t;
        const scalePt = ([x, y]: LngLatTuple): LngLatTuple => [center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale];
        if (t.type === 'circle') {
            tb.center = original.center ? (original.center.slice() as LngLatTuple) : (center.slice() as LngLatTuple);
            tb.edge = scalePt(original.edge || coordAt(original, 0));
            tb.coords = circlePolygon(tb.center, tb.edge);
        } else {
            tb.coords = shapeCoords(original).map(scalePt);
            if (original.center) tb.center = scalePt(original.center);
            if (original.edge)   tb.edge   = scalePt(original.edge);
        }
        if (t.type === 'text') {
            tb.fontSize = Math.max(9, Math.min(72, Math.round((original.fontSize || 13) * scale)));
        }
        deps.saveShapes(list2);
        deps.renderShapes();
    }, 'pinch:move');

    const onEnd = deps.safe((e: MapTouchEventLike) => {
        const oe = e.originalEvent || e;
        if (oe.touches && oe.touches.length >= 2) return;
        try { map.off('touchmove', onMove); } catch { /* API carte peut jeter selon l'état du style */ }
        try { map.off('touchend', onEnd); } catch { /* idem */ }
        try { map.off('touchcancel', onEnd); } catch { /* idem */ }
        try { map.touchZoomRotate.enable(); } catch { /* idem */ }
        try { map.dragPan.enable(); } catch { /* idem */ }
        deps.setGesture(null);
        deps.refreshUndoRedoButtons();
    }, 'pinch:end');

    map.on('touchmove', onMove);
    map.on('touchend', onEnd);
    map.on('touchcancel', onEnd);
}

/**
 * Calcule, pour chaque type de forme, la liste des poignées à rendre. PURE.
 */
// planMap.js:3198-3231 (ex `_shapeHandles`)
export function shapeHandles(s: ShapeGestureShape): ShapeHandleSpec[] {
    const handles: ShapeHandleSpec[] = [];
    if (s.type === 'line') {
        // Trait simple OU cheminement libre multi-points : poignées au 1er et au DERNIER point.
        const coords = shapeCoords(s);
        const last = coords.length - 1;
        const first = coordAt(s, 0);
        const lastPt = coordAt(s, last);
        handles.push({ role: 'endpoint', index: 0, lngLat: { lng: first[0], lat: first[1] }, cursor: 'grab' });
        handles.push({ role: 'endpoint', index: last, lngLat: { lng: lastPt[0], lat: lastPt[1] }, cursor: 'grab' });
    } else if (s.type === 'rectangle') {
        // coords est un polygone fermé à 5 points (le 5e === le 1er)
        for (let i = 0; i < 4; i++) {
            const p = coordAt(s, i);
            handles.push({
                role: 'corner', index: i,
                lngLat: { lng: p[0], lat: p[1] },
                cursor: (i === 0 || i === 2) ? 'nwse-resize' : 'nesw-resize',
            });
        }
    } else if (s.type === 'circle') {
        const coords = shapeCoords(s);
        const c = s.center || coordAt(s, 0);
        const e = s.edge   || coords[Math.floor(coords.length / 4)] || c;
        handles.push({ role: 'edge', index: 0, lngLat: { lng: e[0], lat: e[1] }, cursor: 'ew-resize' });
        // poignée "centre" pour visualiser, drag = move
        handles.push({ role: 'move', index: -1, lngLat: { lng: c[0], lat: c[1] }, cursor: 'move' });
    } else if (s.type === 'text') {
        // une seule poignée bottom-right pour ajuster la taille de la police
        const c = coordAt(s, 0);
        handles.push({ role: 'textresize', index: 0, lngLat: { lng: c[0], lat: c[1] }, cursor: 'nwse-resize' });
    }
    return handles;
}

/**
 * Crée les markers de poignées de la forme sélectionnée et y attache le drag
 * (`startHandleGesture`). Retourne les markers créés — leur stockage et leur
 * retrait (clear) restent à l'app, qui a fait son `clearHandles()` AVANT.
 */
// planMap.js:3233-3282 (ex `_renderHandles`)
export function renderShapeHandles<S extends ShapeGestureShape, M>(deps: ShapeGestureDeps<S, M>): M[] {
    const markers: M[] = [];
    const selectedId = deps.getSelectedShapeId();
    if (!selectedId) return markers;
    // Verrou global : pas de poignées (ni déplacement, ni redimensionnement).
    if (deps.isLocked()) return markers;
    const map = deps.map;
    const s = deps.loadShapes().find(x => x.id === selectedId);
    if (!s) { deps.deselectShape(); return markers; }
    if (s.locked) return markers; // verrou individuel : forme figée
    const handles = shapeHandles(s);
    for (const h of handles) {
        const el = document.createElement('div');
        const isMove = h.role === 'move';
        const size = isMove ? 14 : 16;
        // INVARIANT MARKER (SPEC-PLANMAP-SPLIT §5.1) : NI `position:` NI
        // `inset:` inline ici — l'élément est porté par un Marker carte,
        // qui le positionne lui-même via `transform`.
        el.style.cssText = `
            width: ${size}px; height: ${size}px;
            background: ${isMove ? '#3b82f6' : '#ffffff'};
            border: 2px solid ${isMove ? '#ffffff' : '#3b82f6'};
            border-radius: ${h.role === 'edge' || isMove ? '50%' : '3px'};
            box-shadow: 0 1px 4px rgba(0,0,0,0.45);
            cursor: ${h.cursor};
            pointer-events: auto;
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
        `;
        // offset bottom-right pour la poignée textresize
        let offset: [number, number] | undefined;
        if (h.role === 'textresize') {
            el.title = 'Glisser pour ajuster la taille du texte';
            offset = [60, 30];
        }
        const m = deps.createHandleMarker(el, h.lngLat, offset);
        const shapeId = s.id;
        const role = h.role;
        const index = h.index;
        const onDown = deps.safe((ev: HandleDownEvent) => {
            if (!deps.canStartHandleGesture()) return;
            ev.preventDefault();
            ev.stopPropagation();
            const rect = map.getCanvas().getBoundingClientRect();
            const touch = 'touches' in ev ? ev.touches[0] : undefined;
            const cx = (touch ? touch.clientX : (('clientX' in ev && ev.clientX) || 0)) - rect.left;
            const cy = (touch ? touch.clientY : (('clientY' in ev && ev.clientY) || 0)) - rect.top;
            const lngLat = map.unproject([cx, cy]);
            startHandleGesture(deps, shapeId, role, index, lngLat);
        }, 'handle:down');
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('touchstart', onDown, { passive: false });
        markers.push(m);
    }
    return markers;
}

/**
 * Geste de manipulation d'une poignée. Le pivot dépend du rôle :
 *   - endpoint (line)  : pivot = autre endpoint
 *   - corner (rect)    : pivot = coin opposé
 *   - edge (circle)    : pivot = centre, rayon redimensionné
 *   - move (circle ctr): translation de toute la forme
 *   - textresize       : ajuste shape.fontSize selon le delta px du pointeur
 */
// planMap.js:3284-3395 (ex `_startHandleGesture` — le paramètre `originalEvent`,
// jamais lu dans le corps d'origine, reste sur l'adaptateur app)
export function startHandleGesture<S extends ShapeGestureShape, M>(
    deps: ShapeGestureDeps<S, M>,
    shapeId: string,
    role: ShapeHandleRole,
    index: number,
    startLngLat: ShapeGestureLngLat,
): void {
    const list = deps.loadShapes();
    const shape = list.find(s => s.id === shapeId);
    if (!shape) return;
    deps.pushHistory();
    const original = JSON.parse(JSON.stringify(shape)) as S;
    const map = deps.map;
    const startPx = map.project(startLngLat);

    try { map.dragPan.disable(); } catch { /* API carte peut jeter selon l'état du style */ }
    map.getCanvas().style.cursor = 'grabbing';
    deps.setGesture({ type: 'handle', shapeId, role, index, original, startPx });

    const clientToLngLat = (cx: number, cy: number): ShapeGestureLngLat => {
        const r = map.getCanvas().getBoundingClientRect();
        return map.unproject([cx - r.left, cy - r.top]);
    };
    const extract = (ev: ShapeGestureMoveEvent): ShapeGestureLngLat | null => {
        if ('lngLat' in ev && ev.lngLat) return ev.lngLat;
        if ('touches' in ev && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
        if ('clientX' in ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
        return null;
    };
    const extractPx = (ev: ShapeGestureMoveEvent): { x: number; y: number } | null => {
        if ('point' in ev && ev.point) return ev.point;
        if ('touches' in ev && ev.touches[0]) {
            const r = map.getCanvas().getBoundingClientRect();
            return { x: ev.touches[0].clientX - r.left, y: ev.touches[0].clientY - r.top };
        }
        if ('clientX' in ev && ev.clientX !== undefined) {
            const r = map.getCanvas().getBoundingClientRect();
            return { x: ev.clientX - r.left, y: ev.clientY - r.top };
        }
        return null;
    };

    const onMove = deps.safe((ev: ShapeGestureMoveEvent) => {
        const g = deps.getGesture();
        if (!g || g.type !== 'handle') return;
        const cur = extract(ev);
        if (!cur) return;
        const list2 = deps.loadShapes();
        const t = list2.find(s => s.id === shapeId);
        if (!t) return;
        const tb: ShapeGestureShape = t;
        const curArr: LngLatTuple = [cur.lng, cur.lat];

        if (t.type === 'line' && role === 'endpoint') {
            const coords = shapeCoords(original).slice();
            coords[index] = curArr;
            tb.coords = coords;
        } else if (t.type === 'rectangle' && role === 'corner') {
            // pivot = coin diagonalement opposé
            const opposite = coordAt(original, (index + 2) % 4);
            tb.coords = rectPolygon(opposite, curArr);
        } else if (t.type === 'circle' && role === 'edge') {
            const center = (original.center || coordAt(original, 0)).slice() as LngLatTuple;
            tb.center = center;
            tb.edge = curArr;
            tb.coords = circlePolygon(center, curArr);
        } else if (t.type === 'circle' && role === 'move') {
            const dLng = cur.lng - startLngLat.lng;
            const dLat = cur.lat - startLngLat.lat;
            tb.coords = shapeCoords(original).map(([x, y]): LngLatTuple => [x + dLng, y + dLat]);
            if (original.center) tb.center = [original.center[0] + dLng, original.center[1] + dLat];
            if (original.edge)   tb.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
        } else if (t.type === 'text' && role === 'textresize') {
            const px = extractPx(ev);
            if (!px) return;
            const dy = px.y - startPx.y;
            // ~1px souris = ~0.4pt de police, plage 9-72
            const base = original.fontSize || 13;
            tb.fontSize = Math.max(9, Math.min(72, Math.round(base + dy * 0.4)));
        }
        deps.saveShapes(list2);
        deps.renderShapes();
        deps.afterHandleDrag(); // suit la forme (poignées + décorations app)
    }, 'handle:move');

    const onUp = deps.safe(() => {
        try { map.off('mousemove', onMove); } catch { /* API carte peut jeter selon l'état du style */ }
        try { map.off('touchmove', onMove); } catch { /* idem */ }
        try { map.off('mouseup', onUp); } catch { /* idem */ }
        try { map.off('touchend', onUp); } catch { /* idem */ }
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
        try { map.dragPan.enable(); } catch { /* idem */ }
        map.getCanvas().style.cursor = '';
        deps.setGesture(null);
        deps.refreshUndoRedoButtons();
    }, 'handle:up');

    map.on('mousemove', onMove);
    map.on('touchmove', onMove);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
}
