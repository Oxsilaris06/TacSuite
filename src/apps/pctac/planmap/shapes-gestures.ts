/**
 * shapes-gestures.ts — Gestes sur formes : tap/drag/pinch, sélection, poignées
 * (P2.CONV, paquet `pm-shapesgestures`).
 * ===========================================================================
 *
 * ADAPTATEUR MINCE depuis l'extraction R3 : le NOYAU de la machine à gestes
 * (drag de forme, pinch, calcul/rendu/drag des poignées) vit désormais dans
 * `@shared/shape-gestures.js` (même précédent que `@shared/pin-gestures.js`,
 * extrait de `pins.ts`). Ce module fournit l'injection PC-Tac
 * (`gestureDeps`) et conserve STRICTEMENT la même API publique — les 15
 * méthodes `ShapesGesturesMethods` de la table §4.11 de
 * docs/SPEC-PLANMAP-SPLIT.md (port VERBATIM de `modules/pctac/planMap.js`,
 * GStart-main, lecture seule) :
 *   - :2846 `_shapePointerDown`        (ICI — entrée par couches carte)
 *   - :2871 `_startShapeGesture`       (délègue à `startShapeDragGesture`)
 *   - :2991 `_suppressDblZoom`         (ICI)
 *   - :3007 `_openShapeContextMenu`    (ICI)
 *   - :3017 `_selectShape`             (ICI)
 *   - :3029 `_deselectShape`           (ICI)
 *   - :3044 `_attachPinchListeners`    (ICI — gardes + état `_pinchListener`)
 *   - :3061 `_detachPinchListeners`    (ICI)
 *   - :3122 `_startPinchGesture`       (délègue à `startPinchGesture`)
 *   - :3182 `_clearHandles`            (ICI)
 *   - :3187 `_clearFloatingToolbar`    (ICI — toolbar = PC-Tac uniquement)
 *   - :3203 `_shapeHandles`            (délègue à `shapeHandles`, pure)
 *   - :3233 `_renderHandles`           (délègue à `renderShapeHandles`)
 *   - :3292 `_startHandleGesture`      (délègue à `startHandleGesture`)
 *   - :3481 `_updateFloatingToolbarPos` (ICI)
 *
 * Restent aussi côté PC-Tac : la fenêtre de double-tap 350 ms (état
 * `this._lastShapeTap`, callback `onTap` de l'injection) et la suppression du
 * zoom double-clic (`_suppressDblZoom`, couplée à `drawTool`/
 * `drawPrecisionMode`).
 *
 * ⚠ INVARIANT §5.4 (SPEC-PLANMAP-SPLIT.md) — verrou par-forme : le rendu des
 * poignées sort si verrou GLOBAL (`this._locked`, via `deps.isLocked`) **OU**
 * verrou PAR-FORME (`s.locked`, lu dans le module shared) ;
 * `_attachPinchListeners` sort AUSSI sur les deux (planMap.js:3048, 3050).
 * Les deux conditions sont DISTINCTES : ne pas les fusionner, ne pas en
 * supprimer une.
 *
 * ⚠ INVARIANT §5.1 — les poignées sont des Markers MapLibre : JAMAIS de
 * `position:`/`inset:` inline sur leur élément (même invariant que `pins.ts`).
 *
 * ⚠ Les gardes `if (this.moveState) return;` (planMap.js:2848, 3008, 3269)
 * sont TOUJOURS FAUSSES en pratique (`moveState` n'est assigné QUE par le
 * cluster mort `legacy.ts`, cf. SPEC-PLANMAP-SPLIT.md §7) : portées À
 * L'IDENTIQUE, non supprimées (la 3e via `canStartHandleGesture`).
 *
 * Dépendances autorisées (SPEC-PLANMAP-SPLIT.md §1.2, étendues par R3 au
 * socle commun) : `./types.js` (types uniquement), `@shared/shape-gestures.js`,
 * `maplibre-gl`. Aucune autre.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type {
    Map as MapLibreMap,
    MapLayerMouseEvent,
    MapLayerTouchEvent,
    MapTouchEvent,
    Marker,
    MarkerOptions,
} from 'maplibre-gl';

import {
    renderShapeHandles,
    shapeHandles,
    startHandleGesture,
    startPinchGesture,
    startShapeDragGesture,
} from '@shared/shape-gestures.js';
import type { ShapeGestureDeps } from '@shared/shape-gestures.js';

import type {
    HandleRole,
    LngLatObj,
    PlanMapInternal,
    PlanShape,
    ShapeHandle,
} from './types.js';

/**
 * Injection PC-Tac de la machine partagée : accès formes/persistance/rendu
 * via `this`, résolution tap (fenêtre double-tap 350 ms sur
 * `this._lastShapeTap` + roue contextuelle) et fabrique de Markers MapLibre
 * pour les poignées. Construite à chaque amorce de geste (fermetures sur
 * `self`, aucun état propre).
 */
function gestureDeps(self: PlanMapInternal, map: MapLibreMap): ShapeGestureDeps<PlanShape, Marker> {
    return {
        map,
        loadShapes: () => self._loadShapes(),
        saveShapes: list => self._saveShapes(list),
        renderShapes: () => self._renderShapes(),
        pushHistory: () => self._pushHistory(),
        refreshUndoRedoButtons: () => self._refreshUndoRedoButtons(),
        safe: <A extends unknown[], R>(fn: (...args: A) => R, label?: string) => self._safe(fn, label),
        getGesture: () => self._gesture,
        setGesture: gesture => { self._gesture = gesture; },
        isLocked: () => self._locked,
        getSelectedShapeId: () => self._selectedShapeId,
        // Fin de drag : garde la forme sélectionnée pour l'édition immédiate (planMap.js:2944-2947).
        onDragEnd: shapeId => {
            self._refreshUndoRedoButtons();
            self._selectShape(shapeId);
        },
        // Pas de drag → un tap. Simple tap = sélection (poignées, déplaçable).
        // Double tap / double-clic = ouverture de la roue d'options.
        // On neutralise le zoom double-clic natif de MapLibre le temps de la fenêtre.
        // (planMap.js:2948-2970 — fenêtre 350 ms, état `_lastShapeTap`)
        onTap: (shapeId, startLngLat) => {
            self._suppressDblZoom();
            const now = Date.now();
            const prev = self._lastShapeTap;
            if (prev && prev.id === shapeId && (now - prev.t) < 350) {
                self._lastShapeTap = null;
                self._openShapeContextMenu(shapeId, startLngLat);
            } else {
                self._lastShapeTap = { id: shapeId, t: now };
                self._selectShape(shapeId);
            }
        },
        shapeCentroid: s => self._shapeCentroid(s),
        deselectShape: () => self._deselectShape(),
        canStartHandleGesture: () => !(self.drawTool || self.moveState || self._gesture),
        createHandleMarker: (el, lngLat, offset) => {
            const markerOpts: MarkerOptions = { element: el, anchor: 'center' };
            if (offset) markerOpts.offset = offset;
            return new maplibregl.Marker(markerOpts).setLngLat([lngLat.lng, lngLat.lat]).addTo(map);
        },
        afterHandleDrag: () => {
            self._renderHandles();          // suit la forme
            self._updateFloatingToolbarPos(); // suit aussi
        },
    };
}

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
        const features = e.features;
        if (!features || !features.length) return;

        // Sélection cyclique sur écran tactile lorsque plusieurs formes sont superposées ou proches :
        // Si la forme supérieure est DÉJÀ sélectionnée, choisir la suivante sous le pointeur.
        let targetFeat = features[0];
        if (features.length > 1 && targetFeat && targetFeat.properties && targetFeat.properties.shapeId === this._selectedShapeId) {
            const nextFeat = features.find(f => f.properties && f.properties.shapeId && f.properties.shapeId !== this._selectedShapeId);
            if (nextFeat) targetFeat = nextFeat;
        }

        if (!targetFeat || !targetFeat.properties) return;
        const id = targetFeat.properties.shapeId;
        if (!id) return;
        // Empêche maplibre de démarrer le pan natif sur cette pression
        if (e.preventDefault) e.preventDefault();
        if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
        this._startShapeGesture(id, e.lngLat, e.originalEvent);
    },

    /**
     * Machine d'états du geste sur une forme — noyau partagé
     * (`startShapeDragGesture`) : détection drag (seuil 6 px), translation
     * live, résolution tap/drag via l'injection `gestureDeps`.
     */
    // planMap.js:2865-2988
    _startShapeGesture(this: PlanMapInternal, shapeId: string, startLngLat: LngLatObj, originalEvent: Event | null): void {
        if (originalEvent && originalEvent.preventDefault) originalEvent.preventDefault();
        // TS strict : garde absente de l'original (jamais déclenchée en pratique —
        // ce geste ne démarre que depuis `_shapePointerDown`, appelé une fois la
        // carte initialisée).
        if (!this.map) return;
        startShapeDragGesture(gestureDeps(this, this.map), shapeId, startLngLat);
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

    // planMap.js:3122-3180 — noyau partagé (`startPinchGesture`)
    _startPinchGesture(this: PlanMapInternal): void {
        // TS strict : garde absente de l'original (jamais déclenchée en pratique —
        // n'est appelée que depuis `_attachPinchListeners`, carte déjà initialisée).
        if (!this.map) return;
        startPinchGesture(gestureDeps(this, this.map));
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
    // planMap.js:3198-3231 — pas d'usage de `this` : pas de paramètre `this`
    // (SPEC-PLANMAP-SPLIT §1.3). Délégation pure au module partagé.
    _shapeHandles(s: PlanShape): ShapeHandle[] {
        return shapeHandles(s);
    },

    // planMap.js:3233-3282 — noyau partagé (`renderShapeHandles`) : création
    // des markers + binding du drag de poignée ; le clear et le stockage dans
    // `_handleMarkers` restent ici.
    _renderHandles(this: PlanMapInternal): void {
        this._clearHandles();
        if (!this.map || !this._selectedShapeId) return;
        this._handleMarkers = renderShapeHandles(gestureDeps(this, this.map));
    },

    /**
     * Geste de manipulation d'une poignée — noyau partagé
     * (`startHandleGesture`). Le pivot dépend du rôle :
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
        // position ni type du paramètre (signature publique inchangée).
        void originalEvent;
        // TS strict : garde absente de l'original (jamais déclenchée en pratique —
        // n'est appelée que depuis `_renderHandles`, carte déjà initialisée).
        if (!this.map) return;
        startHandleGesture(gestureDeps(this, this.map), shapeId, role, index, startLngLat);
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
