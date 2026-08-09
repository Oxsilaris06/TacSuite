/**
 * draw-tools.ts — Outils de tracé, undo/redo, persistance des formes
 * (P2.CONV, paquet `pm-drawtools`).
 * ===========================================================================
 *
 * Port TypeScript verbatim des 16 méthodes DRAW-TOOLS de `planMap.js`
 * (`_pushHistory`, `_undo`, `_redo`, `_refreshUndoRedoButtons`, `_setTool`,
 * `_setDrawColor`, `_handleDrawDown`, `_handleDrawMove`, `_renderLiveDiameter`,
 * `_clearLiveDiameter`, `_handleDrawUp`, `_finishShape`, `_renderPreview`,
 * `_clearPreview`, `_loadShapes`, `_saveShapes` — planMap.js:1963-2264,
 * 2593-2602, 4953-4961). Corps VERBATIM (cf. docs/SPEC-PLANMAP-SPLIT.md
 * §1.2-1.3, §4.8) : seules des adaptations de TYPAGE strict sont apportées
 * (voir chaque site marqué « Adaptation TS ») ; aucune restructuration de
 * logique, aucun changement d'ordre d'instruction, aucun renommage.
 *
 * ⚠ TYPE ÉLARGI OBLIGATOIRE (SPEC-PLANMAP-SPLIT §4.8, note de la table) :
 * `_handleDrawMove` et `_handleDrawUp` sont appelées AUSSI BIEN avec un
 * événement MapLibre qu'avec un OBJET SYNTHÉTIQUE `{ lngLat: center }` depuis
 * `draw-layers.ts` (planMap.js:1908, 1916, 1943) → signatures élargies,
 * NE PAS restreindre au seul type MapLibre.
 *
 * ⚠ INVARIANT (§5.8) : `_undo`/`_redo` écrivent DIRECTEMENT
 * `localStorage.setItem(SHAPES_KEY, …)` (planMap.js:1975, 1985), PAS via
 * `Persist` — volontaire (la chaîne sérialisée est déjà connue). `_loadShapes`/
 * `_saveShapes` passent EN REVANCHE par `Persist` (planMap.js:4954, 4960),
 * DEPUIS mission R3-c via `this.persistence` (adapter posé par
 * `createPlanMapState()`, state.ts — cf. `@shared/map-persistence.ts`),
 * qui enrobe `Persist` sans en changer le comportement : la différence
 * `_undo`/`_redo` vs `_loadShapes`/`_saveShapes` reste délibérée, ne pas
 * uniformiser (SPEC-PCTAC-CONVERSION §6).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

import { SHAPES_KEY } from './constants.js';
import type { LngLatObj, LngLatTuple, PlanMapInternal, PlanMapState, PlanShape } from './types.js';

export const DrawToolsMethods = {
    // planMap.js:1963-1968
    _pushHistory(this: PlanMapInternal): void {
        // Snapshot avant modification — appelé par toute opération qui change les shapes
        this.history.push(JSON.stringify(this._loadShapes()));
        if (this.history.length > 50) this.history.shift();
        this.redoStack = []; // toute nouvelle action invalide le redo
    },

    // planMap.js:1970-1978
    _undo(this: PlanMapInternal): void {
        if (!this.history.length) return;
        const current = JSON.stringify(this._loadShapes());
        this.redoStack.push(current);
        const prev = this.history.pop();
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // `Array.prototype.pop()` type le résultat `string | undefined` même si la
        // garde `if (!this.history.length) return;` ci-dessus garantit un élément
        // présent au moment du pop — `localStorage.setItem` exige `string`.
        if (prev === undefined) return;
        // §5.8 : écriture DIRECTE (pas via Persist), volontaire — la chaîne est déjà connue.
        try { localStorage.setItem(SHAPES_KEY, prev); } catch { /* volontaire, cf. SPEC-PLANMAP-SPLIT §5.8 */ }
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    // planMap.js:1980-1988
    _redo(this: PlanMapInternal): void {
        if (!this.redoStack.length) return;
        const current = JSON.stringify(this._loadShapes());
        this.history.push(current);
        const next = this.redoStack.pop();
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) : idem `_undo`.
        if (next === undefined) return;
        try { localStorage.setItem(SHAPES_KEY, next); } catch { /* volontaire, cf. SPEC-PLANMAP-SPLIT §5.8 */ }
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    // planMap.js:1990-2001
    _refreshUndoRedoButtons(this: PlanMapInternal): void {
        const undoBtn = document.getElementById('plan_draw_undo');
        const redoBtn = document.getElementById('plan_draw_redo');
        if (undoBtn) {
            undoBtn.style.opacity = this.history.length ? '1' : '0.35';
            undoBtn.style.cursor = this.history.length ? 'pointer' : 'not-allowed';
        }
        if (redoBtn) {
            redoBtn.style.opacity = this.redoStack.length ? '1' : '0.35';
            redoBtn.style.cursor = this.redoStack.length ? 'pointer' : 'not-allowed';
        }
    },

    // planMap.js:2003-2080
    _setTool(this: PlanMapInternal, tool: PlanMapState['drawTool']): void {
        // Toggle : re-cliquer sur l'outil actif le désactive
        if (tool && this.drawTool === tool) tool = null;
        // Quitter proprement une mesure en cours si on change/désactive d'outil.
        if (this._measureState && tool !== 'measure') this._clearMeasureState();
        this.drawTool = tool;
        this.drawState = null;
        this._clearPreview();
        this._clearLiveDiameter();

        // Détecter si on est sur mobile/tactile pour le mode précision.
        // Exception : l'outil TRAIT se trace au doigt (cheminement libre), sans
        // réticule ni boutons Valider/Annuler → mode précision désactivé pour lui.
        // L'outil MESURE pose des sommets successifs au clic/réticule (pas un drag)
        // → il a sa propre machine d'états, traitée plus bas.
        const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        this.drawPrecisionMode = !!(tool && isMobile && tool !== 'line' && tool !== 'measure');

        // Outil mesure : démarre/arrête sa propre machine d'états (sommets au clic).
        if (tool === 'measure') {
            this._startMeasure(isMobile);
        }

        // Style des boutons
        document.querySelectorAll<HTMLElement>('.plan-draw-btn').forEach(b => {
            const active = b.dataset.tool === tool;
            b.style.background = active ? this.drawColor : 'transparent';
            b.style.color = active ? (['#eab308', '#ffffff', '#22c55e'].includes(this.drawColor) ? '#000' : '#fff') : 'var(--text-main)';
        });

        // Contrôles du réticule et des boutons de précision mobile
        const crosshair = document.getElementById('plan_draw_crosshair');
        const precControls = document.getElementById('plan_draw_precision_controls');
        const viewPlan = document.getElementById('view-plan');

        // Le réticule est partagé : mode précision dessin OU mesure avec réticule.
        const reticleOn = !!this.drawPrecisionMode || !!(this._measureState && this._measureState.reticle);
        if (crosshair) {
            crosshair.classList.toggle('active', reticleOn);
        }
        if (precControls) {
            // Les boutons Viser/Valider/Annuler ne servent QU'au dessin précision,
            // pas à la mesure (qui a sa propre barre flottante).
            precControls.style.display = this.drawPrecisionMode ? 'flex' : 'none';
            // Réinitialiser l'état visuel des boutons de visée
            const pStart = document.getElementById('plan_draw_precision_start');
            const pConfirm = document.getElementById('plan_draw_precision_confirm');
            const pCancel = document.getElementById('plan_draw_precision_cancel');
            if (pStart) pStart.style.display = 'flex';
            if (pConfirm) pConfirm.style.display = 'none';
            if (pCancel) pCancel.style.display = 'none';
        }
        if (viewPlan) {
            viewPlan.classList.toggle('drawing-active', reticleOn);
        }

        // Curseur + désactive le pan de la carte tant qu'un outil est actif (sauf en
        // mode précision mobile, et sauf MESURE qui pose des sommets au clic : on
        // garde le pan actif pour pouvoir se déplacer entre deux sommets).
        if (this.map) {
            // Capture typée : évite que `this.map` perde son narrowing non-null entre
            // les appels successifs ci-dessous (adaptation TS pure, même principe que
            // `const map = this.map;` dans draw-layers.ts).
            const map = this.map;
            map.getCanvas().style.cursor = tool ? 'crosshair' : '';
            if (tool && !this.drawPrecisionMode && tool !== 'measure') {
                map.dragPan.disable();
                map.doubleClickZoom.disable();
                map.boxZoom.disable();
            } else if (tool === 'measure') {
                // Mesure : on garde le pan (déplacement entre sommets) mais on coupe
                // le zoom double-clic, réservé à la VALIDATION de la mesure.
                map.dragPan.enable();
                map.doubleClickZoom.disable();
                map.boxZoom.enable();
            } else {
                map.dragPan.enable();
                map.doubleClickZoom.enable();
                map.boxZoom.enable();
            }
        }
    },

    // planMap.js:2082-2089
    _setDrawColor(this: PlanMapInternal, color: string): void {
        this.drawColor = color;
        document.querySelectorAll<HTMLElement>('.plan-draw-color').forEach(b => {
            b.style.borderColor = b.dataset.color === color ? '#fff' : 'transparent';
        });
        // Re-style du bouton actif si un outil est sélectionné
        if (this.drawTool) this._setTool(this.drawTool);
    },

    /** Drag-to-draw : démarrage */
    // planMap.js:2092-2113
    _handleDrawDown(this: PlanMapInternal, e: MapMouseEvent | MapTouchEvent): void {
        // La mesure n'est pas un drag : elle est pilotée par _onMapClick / réticule.
        if (this.drawTool === 'measure') return;
        if (!this.drawTool || this.drawPrecisionMode) return;
        // Outil texte : un seul clic suffit (pas de drag)
        if (this.drawTool === 'text') {
            if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
            this._addFreeText(e.lngLat);
            // Désactive l'outil après usage pour éviter les ajouts involontaires
            this._setTool(null);
            return;
        }
        // Bloquer le pan/zoom natif
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
        }
        if (e.preventDefault) e.preventDefault();
        // Annotation de type explicite : sans elle, un littéral `[number, number]`
        // s'infère `number[]`, incompatible avec `LngLatTuple` (drawState ci-dessous).
        const lngLat: LngLatTuple = [e.lngLat.lng, e.lngLat.lat];
        // `points` sert au tracé libre (cheminement) de l'outil trait.
        this.drawState = { start: lngLat, current: lngLat, points: [lngLat] };
    },

    /** Drag-to-draw : déplacement (live preview) */
    // planMap.js:2116-2160 — TYPE ÉLARGI (objet synthétique OU événement MapLibre, cf. §4.8 note)
    _handleDrawMove(this: PlanMapInternal, e: { lngLat: LngLatObj; originalEvent?: Event }): void {
        // Outil mesure : la souris/le doigt fait varier le segment "élastique"
        // entre le dernier sommet posé et le curseur (desktop & tap mobile direct).
        if (this.drawTool === 'measure') {
            if (this._measureState && e.lngLat) {
                this._measureUpdateCursor([e.lngLat.lng, e.lngLat.lat]);
            }
            return;
        }
        if (!this.drawTool || !this.drawState) return;
        // Ignorer les glissements de doigt directs sur l'écran en mode précision mobile
        if (this.drawPrecisionMode && e.originalEvent) return;

        // Capture typée : `this.drawState` reste narrowé non-null pour tout le corps
        // de la méthode malgré les appels `map.project(...)` plus bas (adaptation TS
        // pure, même principe que `map` capturé dans draw-layers.ts).
        const drawState = this.drawState;
        const cursor: LngLatTuple = [e.lngLat.lng, e.lngLat.lat];
        drawState.current = cursor;
        if (this.drawTool === 'line') {
            // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
            // `this.map` est garanti non-null tant qu'un outil de dessin est actif —
            // `map.project(...)` l'exige.
            if (!this.map) return;
            const map = this.map;
            // Tracé libre : on accumule les points le long du glissement (cheminement).
            const pts = drawState.points || (drawState.points = [drawState.start]);
            const last = pts[pts.length - 1];
            // `noUncheckedIndexedAccess` type cet accès `LngLatTuple | undefined` ; `pts`
            // contient toujours au moins `drawState.start` (initialisation ci-dessus) donc
            // `last` est toujours défini en pratique — garde neutre en observable, même
            // principe que `coordAt` (SPEC-PLANMAP-SPLIT.md §6.3).
            if (!last) return;
            const lp = map.project({ lng: last[0], lat: last[1] });
            const cp = map.project({ lng: cursor[0], lat: cursor[1] });
            if (Math.hypot(cp.x - lp.x, cp.y - lp.y) >= 4) pts.push(cursor);
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: pts.length > 1 ? pts : [drawState.start, cursor] },
                properties: { color: this.drawColor }
            });
        } else if (this.drawTool === 'rectangle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._rectPolygon(drawState.start, cursor)] },
                properties: { color: this.drawColor }
            });
        } else if (this.drawTool === 'circle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._circlePolygon(drawState.start, cursor)] },
                properties: { color: this.drawColor }
            });
            // Label de diamètre live (si toggle global ON)
            if (this._diameterGlobal) {
                this._renderLiveDiameter(drawState.start, cursor);
            }
        }
    },

    /** Affiche le diamètre live pendant le tracé d'un cercle. */
    // planMap.js:2163-2189
    _renderLiveDiameter(this: PlanMapInternal, center: LngLatTuple, edge: LngLatTuple): void {
        const d = this._haversineMeters(center, edge) * 2;
        const label = `⌀ ${this._formatDistance(d)}`;
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) : `this.map`
        // est garanti non-null pendant le tracé d'un cercle (seul contexte d'appel, depuis
        // `_handleDrawMove`) — `.addTo(map)` l'exige.
        if (!this.map) return;
        const map = this.map;
        if (!this._drawingDiameterMarker) {
            const div = document.createElement('div');
            div.className = 'plan-diameter-label live';
            div.style.cssText = `
                background: rgba(20,24,32,0.92);
                color: #fff;
                padding: 3px 10px;
                border-radius: 12px;
                border: 1px solid ${this.drawColor || '#fff'};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 13px;
                font-weight: 700;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.6);
            `;
            this._drawingDiameterMarker = new maplibregl.Marker({
                element: div, anchor: 'center', offset: [0, 16]
            }).setLngLat(center).addTo(map);
        }
        const el = this._drawingDiameterMarker.getElement();
        if (el) el.textContent = label;
        this._drawingDiameterMarker.setLngLat(center);
    },

    // planMap.js:2191-2196
    _clearLiveDiameter(this: PlanMapInternal): void {
        if (this._drawingDiameterMarker) {
            try { this._drawingDiameterMarker.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
            this._drawingDiameterMarker = null;
        }
    },

    /** Drag-to-draw : relâchement → commit (si le drag a été significatif) */
    // planMap.js:2199-2248 — TYPE ÉLARGI (objet synthétique OU événement MapLibre, cf. §4.8 note)
    _handleDrawUp(this: PlanMapInternal, e: { lngLat?: LngLatObj; originalEvent?: Event }): void {
        if (!this.drawTool || !this.drawState) return;
        // Ignorer les relâchements de doigt directs sur l'écran en mode précision mobile
        if (this.drawPrecisionMode && e.originalEvent) return;

        // Capture typée : `this.drawState` reste narrowé non-null pour tout le corps
        // de la méthode malgré les appels `map.project(...)` plus bas (adaptation TS
        // pure, même principe que `map` capturé dans draw-layers.ts).
        const drawState = this.drawState;
        // Annotation de type explicite : sans elle, le littéral `[number, number]`
        // de la branche `e.lngLat` s'infère `number[]`, incompatible avec `LngLatTuple`.
        const end: LngLatTuple = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : drawState.current;
        const start = drawState.start;
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) : `this.map`
        // est garanti non-null tant qu'un outil de dessin est actif — `map.project(...)` l'exige.
        if (!this.map) return;
        const map = this.map;
        // Distance pixel pour filtrer les "clics" non-drag
        const p1 = map.project({ lng: start[0], lat: start[1] });
        const p2 = map.project({ lng: end[0], lat: end[1] });
        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        // Un trait libre (cheminement) peut revenir près de son départ : on le
        // commit dès qu'il compte plusieurs points, même si start≈end en pixels.
        const freehandLine = this.drawTool === 'line' && drawState.points && drawState.points.length > 2;
        if (!this.drawPrecisionMode && distPx < 4 && !freehandLine) {
            // Clic trop court, on annule la preview
            this.drawState = null;
            this._clearPreview();
            this._clearLiveDiameter();
            return;
        }

        if (this.drawTool === 'line') {
            const pts = (drawState.points && drawState.points.length > 1)
                ? drawState.points.slice()
                : [start, end];
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'line',
                color: this.drawColor,
                coords: pts
            });
        } else if (this.drawTool === 'rectangle') {
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'rectangle',
                color: this.drawColor,
                coords: this._rectPolygon(start, end)
            });
        } else if (this.drawTool === 'circle') {
            this._finishShape({
                id: 'shape_' + Date.now(),
                type: 'circle',
                color: this.drawColor,
                center: start,
                edge: end,
                coords: this._circlePolygon(start, end)
            });
        }
    },

    // planMap.js:2250-2264
    _finishShape(this: PlanMapInternal, shape: PlanShape): void {
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this.drawState = null;
        this._clearPreview();
        // Désactive l'outil de dessin et repasse en mode contrôle carte
        // (le dock reste ouvert pour permettre un nouveau tracé immédiat).
        this._setTool(null);
        // Sélectionne la forme fraîchement créée → handles + toolbar immédiats
        this._selectShape(shape.id);
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    // planMap.js:2593-2596
    _renderPreview(this: PlanMapInternal, feature: GeoJSON.Feature): void {
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) : `this.map`
        // est garanti non-null pendant un tracé actif (seul contexte d'appel).
        if (!this.map) return;
        const src = this.map.getSource<GeoJSONSource>('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [feature] });
    },

    // planMap.js:2598-2602
    _clearPreview(this: PlanMapInternal): void {
        const src = this.map && this.map.getSource<GeoJSONSource>('plan-draw-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        this._clearLiveDiameter();
    },

    // planMap.js:4953-4955
    // R3-c : délègue à `this.persistence` (adapter posé par createPlanMapState(),
    // state.ts) — enrobe Persist.get sur SHAPES_KEY, comportement bit-identique.
    // NB : `_undo`/`_redo` ci-dessus restent volontairement en écriture DIRECTE
    // localStorage (§5.8), PAS via l'adapter — divergence délibérée, inchangée.
    _loadShapes(this: PlanMapInternal): PlanShape[] {
        return this.persistence.loadShapes();
    },

    // planMap.js:4957-4961
    // R3-c : idem, délègue à `this.persistence.saveShapes` — garde QuotaExceededError
    // (dispatch 'pctac:quota' sans jeter ni bloquer, plus d'alert() synchrone qui
    // figerait l'UI sur le terrain).
    _saveShapes(this: PlanMapInternal, list: readonly PlanShape[]): void {
        this.persistence.saveShapes(list);
    },
};
