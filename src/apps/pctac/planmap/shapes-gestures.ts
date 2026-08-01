/**
 * shapes-gestures.ts — Gestes sur formes : tap/drag/pinch, sélection, poignées
 * (P2.CONV, paquet `pm-shapesgestures`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 15 méthodes de `modules/pctac/planMap.js`
 * (GStart-main, lecture seule), table §4.11 de docs/SPEC-PLANMAP-SPLIT.md :
 *   - :2846 `_shapePointerDown`
 *   - :2871 `_startShapeGesture`
 *   - :2991 `_suppressDblZoom`
 *   - :3007 `_openShapeContextMenu`
 *   - :3017 `_selectShape`
 *   - :3029 `_deselectShape`
 *   - :3044 `_attachPinchListeners`
 *   - :3061 `_detachPinchListeners`
 *   - :3122 `_startPinchGesture`
 *   - :3182 `_clearHandles`
 *   - :3187 `_clearFloatingToolbar`
 *   - :3203 `_shapeHandles`
 *   - :3233 `_renderHandles`
 *   - :3292 `_startHandleGesture`
 *   - :3481 `_updateFloatingToolbarPos`
 *
 * ⚠ INVARIANT §5.4 (SPEC-PLANMAP-SPLIT.md) — verrou par-forme : `_renderHandles`
 * sort si `this._locked` **OU** `s.locked` (planMap.js:3237, 3240) ;
 * `_attachPinchListeners` sort AUSSI sur les deux (planMap.js:3048, 3050). Les
 * deux conditions sont DISTINCTES (verrou global vs verrou par-forme) : ne pas
 * les fusionner, ne pas en supprimer une.
 *
 * ⚠ INVARIANT §5.1 — les poignées sont des Markers MapLibre : JAMAIS de
 * `position:`/`inset:` inline sur leur élément (même invariant que `pins.ts`).
 *
 * ⚠ Les gardes `if (this.moveState) return;` (planMap.js:2848, 3008, 3269)
 * sont TOUJOURS FAUSSES en pratique (`moveState` n'est assigné QUE par le
 * cluster mort `legacy.ts`, cf. SPEC-PLANMAP-SPLIT.md §7) : portées À
 * L'IDENTIQUE, non supprimées.
 *
 * Adaptations TS pures (jamais déclenchées en pratique, mêmes principes que
 * `planmap/legacy.ts`, `planmap/draw-layers.ts` et `planmap/shapes-render.ts`) :
 *   - gardes `if (!this.map) return;` ajoutées là où l'original suppose `map`
 *     déjà initialisé (`_startShapeGesture`, `_attachPinchListeners`,
 *     `_startPinchGesture`, `_startHandleGesture`) ;
 *   - capture `const map = this.map;` juste après ces gardes pour que le
 *     narrowing TS traverse les fermetures (callbacks `map.on(...)`, timers) ;
 *   - `JSON.parse(JSON.stringify(shape)) as PlanShape` (clonage profond typé,
 *     même principe que `legacy.ts`) ;
 *   - `coordAt`/`shapeCoords` de `./geo.js` sur les accès à `PlanShape.coords`
 *     (`noUncheckedIndexedAccess`, SPEC-PLANMAP-SPLIT.md §6.3) ;
 *   - narrowing par `'prop' in ev` sur les événements DOM/MapLibre unifiés — un
 *     même handler sert à la fois `map.on(...)` ET
 *     `document.addEventListener(...)` (SPEC-PLANMAP-SPLIT.md §6.5) — même
 *     principe que `oe.target instanceof Element` dans `draw-layers.ts` et
 *     `'touches' in ev` dans `shapes-render.ts`.
 *
 * Dépendances autorisées (SPEC-PLANMAP-SPLIT.md §1.2) : `./types.js` (types
 * uniquement), `./geo.js`, `maplibre-gl`. Aucune autre.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type {
    MapLayerMouseEvent,
    MapLayerTouchEvent,
    MapMouseEvent,
    MapTouchEvent,
    MarkerOptions,
} from 'maplibre-gl';

import { coordAt, shapeCoords } from './geo.js';
import type {
    HandleRole,
    LngLatObj,
    LngLatTuple,
    PlanMapInternal,
    PlanShape,
    ShapeGestureState,
    ShapeHandle,
} from './types.js';

/**
 * Événement de déplacement/relâchement d'un geste de forme ou de poignée : le
 * MÊME handler est posé à la fois via `map.on('mousemove'|'touchmove'
 * |'mouseup'|'touchend', …)` (événements MapLibre) ET via
 * `document.addEventListener('pointermove'|'pointerup'|'pointercancel'
 * |'touchmove'|'touchend'|'touchcancel', …)` (événements DOM natifs), pour
 * couvrir les mouvements qui sortent du canvas (planMap.js:2976-2987,
 * 3385-3394). SPEC-PLANMAP-SPLIT.md §6.5 : un même paramètre en union est
 * assignable aux 4 signatures d'enregistrement (contravariance), aucun
 * enrobage n'est donc requis ici (contrairement au cas `map.on` par COUCHE de
 * `_shapePointerDown`, cf. draw-layers.ts:186-187).
 */
type ShapeGestureDomEvent = MapMouseEvent | MapTouchEvent | PointerEvent | TouchEvent;

/** Événement `pointerdown`/`touchstart` posé directement sur l'élément DOM d'une poignée (planMap.js:3278-3279). */
type HandleDownEvent = PointerEvent | TouchEvent;

export const ShapesGesturesMethods = {
    // ============================================================
    // ===============  GESTES SUR FORMES (tap/drag)  =============
    // ============================================================
    //
    // Implémentation : pointerdown sur les couches `plan-shapes-*` désactive
    // le pan tant que le geste est en cours, écoute mousemove/touchmove pour
    // déterminer s'il s'agit d'un drag, et au pointerup soit applique le drag
    // (déjà rendu live), soit ouvre le menu contextuel.

    // planMap.js:2846-2863
    _shapePointerDown(this: PlanMapInternal, e: MapLayerMouseEvent | MapLayerTouchEvent): void {
        if (this.drawTool) return;          // outil de dessin actif : on ignore
        if (this.moveState) return;         // déjà une transformation en cours
        if (this._gesture) return;          // déjà un geste en cours
        // Le pointeur a démarré sur un PING (marker DOM au-dessus de la carte) ?
        // Alors l'utilisateur manipule ce ping : ne PAS démarrer un geste de forme,
        // sinon la forme sous-jacente se déplacerait en même temps que le ping.
        const oe = e.originalEvent;
        // `oe.target instanceof Element` = équivalent TS-safe de
        // `oe.target && oe.target.closest` (duck-typing : seul un `Element`
        // expose `closest`), même principe que draw-layers.ts:453.
        const target = oe && oe.target instanceof Element ? oe.target : null;
        if (target && target.closest('.plan-pin')) return;
        const feat = e.features && e.features[0];
        if (!feat) return;
        const id = feat.properties.shapeId;
        if (!id) return;
        // Empêche maplibre de démarrer le pan natif sur cette pression
        if (e.preventDefault) e.preventDefault();
        if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
        this._startShapeGesture(id, e.lngLat, e.originalEvent);
    },

    /**
     * Machine d'états du geste sur une forme.
     */
    // planMap.js:2865-2988
    _startShapeGesture(this: PlanMapInternal, shapeId: string, startLngLat: LngLatObj, originalEvent: Event | null): void {
        if (originalEvent && originalEvent.preventDefault) originalEvent.preventDefault();

        const DRAG_PX = 6;
        // TS strict : garde absente de l'original (jamais déclenchée en pratique —
        // ce geste ne démarre que depuis `_shapePointerDown`, appelé une fois la
        // carte initialisée). Capture en const pour que le narrowing traverse les
        // fermetures ci-dessous (même principe que draw-layers.ts).
        if (!this.map) return;
        const map = this.map;
        const startPt = map.project(startLngLat);

        // Désactive le pan le temps du geste (réactivé au pointerup)
        try { map.dragPan.disable(); } catch { /* API MapLibre peut jeter selon l'état du style */ }
        map.getCanvas().style.cursor = 'grabbing';

        const state: ShapeGestureState = { shapeId, startLngLat, isDrag: false, original: null };
        this._gesture = state;

        // Verrou individuel : si la forme est figée, on n'autorisera pas le drag
        // (le tap → menu contextuel reste possible, pour pouvoir la déverrouiller).
        const lockedShape = (() => {
            const sh = this._loadShapes().find(s => s.id === shapeId);
            return !!(sh && sh.locked);
        })();

        // Convertit un événement DOM (clientX/Y) en lngLat carte
        const clientToLngLat = (clientX: number, clientY: number): LngLatObj => {
            const rect = map.getCanvas().getBoundingClientRect();
            return map.unproject([clientX - rect.left, clientY - rect.top]);
        };

        // Récupère lngLat depuis un événement maplibre OU DOM
        const extractLngLat = (ev: ShapeGestureDomEvent): LngLatObj | null => {
            if ('lngLat' in ev && ev.lngLat) return ev.lngLat;
            if ('touches' in ev && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
            if ('clientX' in ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
            return null;
        };

        const onMove = this._safe((ev: ShapeGestureDomEvent) => {
            if (this._gesture !== state) return;
            const cur = extractLngLat(ev);
            if (!cur) return;
            // Détection drag : seuil franchi ? (jamais en mode verrouillé → position figée)
            if (!state.isDrag && !this._locked && !lockedShape) {
                const p = map.project(cur);
                if (Math.hypot(p.x - startPt.x, p.y - startPt.y) > DRAG_PX) {
                    // Bascule en mode drag : snapshot + history
                    const list = this._loadShapes();
                    const shape = list.find(s => s.id === shapeId);
                    if (!shape) return;
                    state.original = JSON.parse(JSON.stringify(shape)) as PlanShape;
                    this._pushHistory();
                    state.isDrag = true;
                }
            }
            // Drag actif : translation = curseur - point de départ
            // Capture locale pour que le narrowing (`original` non-null) traverse
            // les appels `_loadShapes()`/`.find()` ci-dessous (cf. draw-layers.ts).
            const original = state.original;
            if (state.isDrag && original) {
                const dLng = cur.lng - startLngLat.lng;
                const dLat = cur.lat - startLngLat.lat;
                const list = this._loadShapes();
                const target = list.find(s => s.id === shapeId);
                if (!target) return;
                target.coords = shapeCoords(original).map(([x, y]): LngLatTuple => [x + dLng, y + dLat]);
                if (original.center) target.center = [original.center[0] + dLng, original.center[1] + dLat];
                if (original.edge)   target.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
                this._saveShapes(list);
                this._renderShapes();
            }
        }, 'shapeGesture:move');

        const onUp = this._safe((ev: ShapeGestureDomEvent) => {
            // `ev` n'est jamais lu dans le corps d'origine (planMap.js:2938-2974) ;
            // `void` neutralise `noUnusedParameters`/`no-unused-vars` sans changer
            // position ni type du paramètre (même principe que `otanColor` de
            // wheels.ts, SPEC-PCTAC-CONVERSION.md §9).
            void ev;
            if (this._gesture !== state) return;
            // Cleanup listeners
            try { map.off('mousemove', onMove); } catch { /* API MapLibre peut jeter selon l'état du style */ }
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
            this._gesture = null;

            if (state.isDrag) {
                this._refreshUndoRedoButtons();
                // Garde la forme sélectionnée pour l'édition immédiate après drag
                this._selectShape(shapeId);
            } else {
                // Pas de drag → un tap. Simple tap = sélection (poignées, déplaçable).
                // Double tap / double-clic = ouverture de la roue d'options.
                // On neutralise le zoom double-clic natif de MapLibre le temps de la fenêtre.
                this._suppressDblZoom();
                const now = Date.now();
                const prev = this._lastShapeTap;
                if (prev && prev.id === shapeId && (now - prev.t) < 350) {
                    this._lastShapeTap = null;
                    this._openShapeContextMenu(shapeId, startLngLat);
                } else {
                    this._lastShapeTap = { id: shapeId, t: now };
                    this._selectShape(shapeId);
                }
            }
        }, 'shapeGesture:up');

        // Listeners sur maplibre (couvre les events sur le canvas)
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
    },

    /** Neutralise temporairement le zoom double-clic natif (fenêtre double-tap). */
    // planMap.js:2991-3002
    _suppressDblZoom(this: PlanMapInternal): void {
        if (!this.map || !this.map.doubleClickZoom) return;
        // Capture pour que le narrowing traverse la fermeture `setTimeout` ci-dessous.
        const map = this.map;
        try { map.doubleClickZoom.disable(); } catch { /* API MapLibre peut jeter selon l'état du style */ }
        if (this._dblZoomTimer) clearTimeout(this._dblZoomTimer);
        this._dblZoomTimer = setTimeout(() => {
            this._dblZoomTimer = null;
            // Ne pas réactiver si un outil de dessin l'a volontairement désactivé.
            if (!this.drawTool || this.drawPrecisionMode) {
                try { map.doubleClickZoom.enable(); } catch { /* idem */ }
            }
        }, 450);
    },

    /**
     * Sélectionne une forme + ouvre la roue contextuelle (style Canva).
     */
    // planMap.js:3004-3015
    _openShapeContextMenu(this: PlanMapInternal, shapeId: string, lngLat: LngLatObj | null): void {
        if (this.drawTool || this.moveState) return;
        this._selectShape(shapeId);
        // Ouvre la roue à proximité du tap (ou au centroïde si non fourni)
        const s = this._loadShapes().find(x => x.id === shapeId);
        if (!s) return;
        const anchor = lngLat || this._shapeAnchor(s);
        if (anchor) this._openShapeWheel(shapeId, anchor);
    },

    // planMap.js:3017-3027
    _selectShape(this: PlanMapInternal, shapeId: string): void {
        if (this._selectedShapeId === shapeId) {
            this._renderHandles();
            return;
        }
        this._selectedShapeId = shapeId;
        this._renderHandles();
        this._renderShapeLocks();   // fait apparaître le cadenas de la forme sélectionnée
        this._attachPinchListeners();
        // La barre flottante est remplacée par la roue éphémère (_openShapeWheel).
    },

    // planMap.js:3029-3037
    _deselectShape(this: PlanMapInternal): void {
        if (!this._selectedShapeId) return;
        this._selectedShapeId = null;
        this._clearHandles();
        this._clearFloatingToolbar();
        this._detachPinchListeners();
        this._closeWheel();
        this._renderShapeLocks();   // retire le cadenas si la forme n'est pas verrouillée
    },

    /**
     * Quand une forme est sélectionnée, 2 doigts sur la carte = pinch-resize
     * (style Canva). On désactive le pinch-zoom natif maplibre pendant le geste.
     * Hors sélection, le pinch-zoom maplibre fonctionne normalement.
     */
    // planMap.js:3039-3059
    _attachPinchListeners(this: PlanMapInternal): void {
        if (this._pinchListener) return;
        // TS strict : garde absente de l'original (jamais déclenchée en pratique —
        // n'est appelée que depuis `_selectShape`, donc carte déjà initialisée).
        if (!this.map) return;
        const map = this.map;
        const onTouchStart = this._safe((e: MapTouchEvent) => {
            if (!this._selectedShapeId || this.drawTool || this.moveState || this._gesture) return;
            if (this._locked) return; // verrou global : pas de redimensionnement au pinch
            const selShape = this._loadShapes().find(s => s.id === this._selectedShapeId);
            if (selShape && selShape.locked) return; // verrou individuel
            const oe = e.originalEvent || e;
            if (oe.touches && oe.touches.length === 2) {
                oe.preventDefault();
                this._startPinchGesture();
            }
        }, 'pinch:touchstart');
        map.on('touchstart', onTouchStart);
        this._pinchListener = onTouchStart;
    },

    // planMap.js:3061-3065
    _detachPinchListeners(this: PlanMapInternal): void {
        if (!this._pinchListener) return;
        // TS strict : garde absente de l'original (le `try/catch` d'origine
        // absorbait un éventuel appel sur `map` nul ; ici on évite l'appel plutôt
        // que de le laisser jeter — même observable : `_pinchListener` reset dans
        // tous les cas).
        if (this.map) {
            try { this.map.off('touchstart', this._pinchListener); } catch { /* API MapLibre peut jeter selon l'état du style */ }
        }
        this._pinchListener = null;
    },

    // planMap.js:3122-3180
    _startPinchGesture(this: PlanMapInternal): void {
        const list = this._loadShapes();
        const shape = list.find(s => s.id === this._selectedShapeId);
        if (!shape) return;
        // TS strict : garde absente de l'original (jamais déclenchée en pratique —
        // n'est appelée que depuis `_attachPinchListeners`, carte déjà initialisée).
        if (!this.map) return;
        const map = this.map;
        try { map.touchZoomRotate.disable(); } catch { /* API MapLibre peut jeter selon l'état du style */ }
        try { map.dragPan.disable(); } catch { /* idem */ }
        this._gesture = { type: 'pinch' };
        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape)) as PlanShape;
        const center = this._shapeCentroid(shape);
        let initDist: number | null = null;

        const getDist = (touches: TouchList): number => {
            // `touches[0]`/`touches[1]` toujours présents ici (l'appelant garde
            // `oe.touches.length >= 2` avant d'appeler `getDist`) : repli à 0
            // neutre, jamais atteint en pratique — même principe que `coordAt`
            // (SPEC-PLANMAP-SPLIT.md §6.3).
            const t0 = touches[0];
            const t1 = touches[1];
            if (!t0 || !t1) return 0;
            return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        };

        const onMove = this._safe((e: MapTouchEvent) => {
            const oe = e.originalEvent || e;
            if (!oe.touches || oe.touches.length < 2) return;
            oe.preventDefault();
            const dist = getDist(oe.touches);
            if (initDist === null) { initDist = dist; return; }
            if (initDist < 1) return;
            const scale = Math.max(0.1, Math.min(20, dist / initDist));
            const list2 = this._loadShapes();
            const t = list2.find(s => s.id === shape.id);
            if (!t) return;
            const scalePt = ([x, y]: LngLatTuple): LngLatTuple => [center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale];
            if (t.type === 'circle') {
                t.center = original.center ? (original.center.slice() as LngLatTuple) : (center.slice() as LngLatTuple);
                t.edge = scalePt(original.edge || coordAt(original, 0));
                t.coords = this._circlePolygon(t.center, t.edge);
            } else {
                t.coords = shapeCoords(original).map(scalePt);
                if (original.center) t.center = scalePt(original.center);
                if (original.edge)   t.edge   = scalePt(original.edge);
            }
            if (t.type === 'text') {
                t.fontSize = Math.max(9, Math.min(72, Math.round((original.fontSize || 13) * scale)));
            }
            this._saveShapes(list2);
            this._renderShapes();
        }, 'pinch:move');

        const onEnd = this._safe((e: MapTouchEvent) => {
            const oe = e.originalEvent || e;
            if (oe.touches && oe.touches.length >= 2) return;
            try { map.off('touchmove', onMove); } catch { /* API MapLibre peut jeter selon l'état du style */ }
            try { map.off('touchend', onEnd); } catch { /* idem */ }
            try { map.off('touchcancel', onEnd); } catch { /* idem */ }
            try { map.touchZoomRotate.enable(); } catch { /* idem */ }
            try { map.dragPan.enable(); } catch { /* idem */ }
            this._gesture = null;
            this._refreshUndoRedoButtons();
        }, 'pinch:end');

        map.on('touchmove', onMove);
        map.on('touchend', onEnd);
        map.on('touchcancel', onEnd);
    },

    // planMap.js:3182-3185
    _clearHandles(this: PlanMapInternal): void {
        if (this._handleMarkers) this._handleMarkers.forEach(m => { try { m.remove(); } catch { /* déjà retiré du DOM — sans effet */ } });
        this._handleMarkers = [];
    },

    // planMap.js:3187-3189
    _clearFloatingToolbar(this: PlanMapInternal): void {
        if (this._toolbarMarker) { try { this._toolbarMarker.remove(); } catch { /* déjà retiré du DOM — sans effet */ } this._toolbarMarker = null; }
    },

    /**
     * Calcule, pour chaque type de forme, la liste des poignées à rendre.
     * Chaque poignée : { role: 'move'|'corner'|'edge'|'endpoint'|'textresize',
     *                    index, lngLat: {lng, lat}, cursor }
     */
    // planMap.js:3198-3231 — pas d'usage de `this` : pas de paramètre `this` (SPEC-PLANMAP-SPLIT §1.3).
    _shapeHandles(s: PlanShape): ShapeHandle[] {
        const handles: ShapeHandle[] = [];
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
    },

    // planMap.js:3233-3282
    _renderHandles(this: PlanMapInternal): void {
        this._clearHandles();
        if (!this.map || !this._selectedShapeId) return;
        // Verrou global : pas de poignées (ni déplacement, ni redimensionnement).
        if (this._locked) return;
        // Capture pour que le narrowing traverse la boucle/les fermetures ci-dessous.
        const map = this.map;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) { this._deselectShape(); return; }
        if (s.locked) return; // verrou individuel : forme figée
        const handles = this._shapeHandles(s);
        for (const h of handles) {
            const el = document.createElement('div');
            const isMove = h.role === 'move';
            const size = isMove ? 14 : 16;
            // INVARIANT MARKER (SPEC-PLANMAP-SPLIT §5.1) : NI `position:` NI
            // `inset:` inline ici — l'élément est porté par un Marker MapLibre,
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
            const markerOpts: MarkerOptions = { element: el, anchor: 'center' };
            if (h.role === 'textresize') {
                el.title = 'Glisser pour ajuster la taille du texte';
                markerOpts.offset = [60, 30];
            }
            const m = new maplibregl.Marker(markerOpts).setLngLat([h.lngLat.lng, h.lngLat.lat]).addTo(map);
            const shapeId = s.id;
            const role = h.role;
            const index = h.index;
            const onDown = this._safe((ev: HandleDownEvent) => {
                if (this.drawTool || this.moveState || this._gesture) return;
                ev.preventDefault();
                ev.stopPropagation();
                const rect = map.getCanvas().getBoundingClientRect();
                // `'touches' in ev` = équivalent TS-safe de `ev.touches` en
                // duck-typing (PointerEvent n'a pas `touches`, TouchEvent n'a pas
                // `clientX`), même idiome que shapes-render.ts/draw-layers.ts.
                const touch = 'touches' in ev ? ev.touches[0] : undefined;
                const cx = (touch ? touch.clientX : (('clientX' in ev && ev.clientX) || 0)) - rect.left;
                const cy = (touch ? touch.clientY : (('clientY' in ev && ev.clientY) || 0)) - rect.top;
                const lngLat = map.unproject([cx, cy]);
                this._startHandleGesture(shapeId, role, index, lngLat, ev);
            }, 'handle:down');
            el.addEventListener('pointerdown', onDown);
            el.addEventListener('touchstart', onDown, { passive: false });
            this._handleMarkers.push(m);
        }
    },

    /**
     * Geste de manipulation d'une poignée. Le pivot dépend du rôle :
     *   - endpoint (line)  : pivot = autre endpoint
     *   - corner (rect)    : pivot = coin opposé
     *   - edge (circle)    : pivot = centre, rayon redimensionné
     *   - move (circle ctr): translation de toute la forme
     *   - textresize       : ajuste shape.fontSize selon le delta px du pointeur
     */
    // planMap.js:3284-3395
    _startHandleGesture(this: PlanMapInternal, shapeId: string, role: HandleRole, index: number, startLngLat: LngLatObj, originalEvent: Event): void {
        // `originalEvent` n'est JAMAIS lu dans le corps d'origine (planMap.js:3292-3395) ;
        // `void` neutralise `noUnusedParameters`/`no-unused-vars` sans changer
        // position ni type du paramètre (même principe que `onUp` ci-dessus et
        // `otanColor` de wheels.ts, SPEC-PCTAC-CONVERSION.md §9).
        void originalEvent;
        const list = this._loadShapes();
        const shape = list.find(s => s.id === shapeId);
        if (!shape) return;
        this._pushHistory();
        const original = JSON.parse(JSON.stringify(shape)) as PlanShape;
        // TS strict : garde absente de l'original (jamais déclenchée en pratique —
        // n'est appelée que depuis `_renderHandles`, carte déjà initialisée).
        if (!this.map) return;
        const map = this.map;
        const startPx = map.project(startLngLat);

        try { map.dragPan.disable(); } catch { /* API MapLibre peut jeter selon l'état du style */ }
        map.getCanvas().style.cursor = 'grabbing';
        this._gesture = { type: 'handle', shapeId, role, index, original, startPx };

        const clientToLngLat = (cx: number, cy: number): LngLatObj => {
            const r = map.getCanvas().getBoundingClientRect();
            return map.unproject([cx - r.left, cy - r.top]);
        };
        const extract = (ev: ShapeGestureDomEvent): LngLatObj | null => {
            if ('lngLat' in ev && ev.lngLat) return ev.lngLat;
            if ('touches' in ev && ev.touches[0]) return clientToLngLat(ev.touches[0].clientX, ev.touches[0].clientY);
            if ('clientX' in ev && ev.clientX !== undefined) return clientToLngLat(ev.clientX, ev.clientY);
            return null;
        };
        const extractPx = (ev: ShapeGestureDomEvent): { x: number; y: number } | null => {
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

        const onMove = this._safe((ev: ShapeGestureDomEvent) => {
            if (!this._gesture || this._gesture.type !== 'handle') return;
            const cur = extract(ev);
            if (!cur) return;
            const list2 = this._loadShapes();
            const t = list2.find(s => s.id === shapeId);
            if (!t) return;
            const curArr: LngLatTuple = [cur.lng, cur.lat];

            if (t.type === 'line' && role === 'endpoint') {
                const coords = shapeCoords(original).slice();
                coords[index] = curArr;
                t.coords = coords;
            } else if (t.type === 'rectangle' && role === 'corner') {
                // pivot = coin diagonalement opposé
                const opposite = coordAt(original, (index + 2) % 4);
                t.coords = this._rectPolygon(opposite, curArr);
            } else if (t.type === 'circle' && role === 'edge') {
                const center = (original.center || coordAt(original, 0)).slice() as LngLatTuple;
                t.center = center;
                t.edge = curArr;
                t.coords = this._circlePolygon(center, curArr);
            } else if (t.type === 'circle' && role === 'move') {
                const dLng = cur.lng - startLngLat.lng;
                const dLat = cur.lat - startLngLat.lat;
                t.coords = shapeCoords(original).map(([x, y]): LngLatTuple => [x + dLng, y + dLat]);
                if (original.center) t.center = [original.center[0] + dLng, original.center[1] + dLat];
                if (original.edge)   t.edge   = [original.edge[0]   + dLng, original.edge[1]   + dLat];
            } else if (t.type === 'text' && role === 'textresize') {
                const px = extractPx(ev);
                if (!px) return;
                const dy = px.y - startPx.y;
                // ~1px souris = ~0.4pt de police, plage 9-72
                const base = original.fontSize || 13;
                t.fontSize = Math.max(9, Math.min(72, Math.round(base + dy * 0.4)));
            }
            this._saveShapes(list2);
            this._renderShapes();
            this._renderHandles();          // suit la forme
            this._updateFloatingToolbarPos(); // suit aussi
        }, 'handle:move');

        const onUp = this._safe(() => {
            try { map.off('mousemove', onMove); } catch { /* API MapLibre peut jeter selon l'état du style */ }
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
            this._gesture = null;
            this._refreshUndoRedoButtons();
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
    },

    /** Met à jour la position de la barre flottante (suit la forme). */
    // planMap.js:3481-3487
    _updateFloatingToolbarPos(this: PlanMapInternal): void {
        if (!this._toolbarMarker || !this._selectedShapeId) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) return;
        const a = this._shapeAnchor(s);
        if (a) this._toolbarMarker.setLngLat([a.lng, a.lat]);
    },
};
