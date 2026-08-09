/**
 * draw.ts — DESSINS (shapes) : trait / rectangle / cercle, undo/redo,
 * géométries (P3.CONV, paquet `oi-carto-draw`).
 * ===========================================================================
 *
 * Port TypeScript verbatim des 19 méthodes DRAW de `modules/oi_cartographie.js`
 * (`_initDrawingLayers` :1314, `_bindDrawUi` :1366, `_toggleDrawDock` :1390,
 * `_setTool` :1400, `_setDrawColor` :1429, `_handleDrawDown` :1437,
 * `_handleDrawMove` :1445, `_handleDrawUp` :1470, `_finishShape` :1490,
 * `_renderPreview` :1502, `_clearPreview` :1507, `_renderShapes` :1512,
 * `_onShapeClick` :1524, `_pushHistory` :1537, `_undo` :1543, `_redo` :1551,
 * `_refreshUndoRedoButtons` :1559, `_rectPolygon` :1573, `_circlePolygon`
 * :1578). Patron du découpage `carto/` : SPEC-OI-CONVERSION.md §6.2/§6.3 —
 * chaque méthode déclare `this: OICartoInternal`, corps VERBATIM, AUCUN
 * import d'un autre groupe de méthodes (`state.ts`, `map-core.ts`, …) ;
 * seules dépendances autorisées : `./types.js`, `./constants.js`,
 * `maplibre-gl`. `this._loadShapes()` / `this._saveShapes()` (groupe
 * `carto/state.ts`) et `this._hideHint()` (groupe `carto/map-core.ts`) sont
 * consommées via `this` (typé par `OICartoInternal`), jamais réimplémentées
 * ici.
 *
 * Seules des adaptations de TYPAGE strict sont apportées (chaque site est
 * marqué « Adaptation TS ») : aucune restructuration de logique, aucun
 * changement d'ordre d'instruction, aucun renommage — fidélité avant
 * élégance (règles communes §13.4.3).
 *
 * ⚠ INVARIANT UNDO/REDO (mission `oi-carto-draw`) : `history`/`redoStack`
 * (champs du littéral d'origine, gérés par `carto/state.ts`) stockent du
 * JSON sérialisé (`JSON.stringify(this._loadShapes())`, :1538,1545,1553). Un
 * cycle `_undo` puis `_redo` doit restituer un état STRUCTURELLEMENT
 * IDENTIQUE — prouvé par test (comparaison JSON avant/après un aller-retour).
 *
 * ⚠ ÉCART DE FOND vs `@pctac/planmap/draw-tools.ts` (signalé, pas corrigé) :
 * contrairement à l'équivalent PC-Tac, l'OI `_finishShape` (:1490-1500) ne
 * réinitialise PAS l'outil actif (pas de `_setTool(null)`) et ne sélectionne
 * aucune forme après création (pas de `_selectShape`) — l'original documente
 * explicitement « L'outil reste actif pour enchaîner ; Échap pour quitter. »
 * (:1499). Conservé tel quel : c'est le comportement de la source OI, pas un
 * oubli de portage.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule, lignes 1310-1603).
 */

import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

import { circlePolygon as sharedCirclePolygon, rectPolygon as sharedRectPolygon } from '@shared/geo-shapes.js';

import type { LngLatTuple, OICartoInternal, OiCartoDrawTool, OiCartoShape } from './types.js';

export const DrawMethods = {
    // oi_cartographie.js:1314-1364
    _initDrawingLayers(this: OICartoInternal): void {
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // `this.map` est garanti non-null à ce point (`_initDrawingLayers` n'est
        // appelée que depuis `_init()`, `carto/map-core.ts`, après affectation de
        // `this.map`). Capture en `const map` pour préserver le narrowing non-null
        // à travers les multiples appels ci-dessous (même principe que
        // `@pctac/planmap/draw-layers.ts`, précédent maison).
        if (!this.map) return;
        const map = this.map;

        // Bâtiments 3D (extrusion OSM via OpenFreeMap), masqués hors mode 3D.
        try {
            map.addLayer({
                id: 'buildings-3d',
                type: 'fill-extrusion',
                source: 'openfreemap',
                'source-layer': 'building',
                minzoom: 13,
                layout: { visibility: 'none' },
                paint: {
                    'fill-extrusion-color': '#c2cad2',
                    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
                    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                    'fill-extrusion-opacity': 0.85,
                },
            });
        } catch (e) {
            console.error('[OICarto] couche bâtiments 3D échec:', e);
        }

        // Source "committed" (dessins persistés)
        map.addSource('oi-carto-shapes-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'oi-carto-shapes-fill', type: 'fill', source: 'oi-carto-shapes-src',
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: { 'fill-color': ['coalesce', ['get', 'color'], '#ef4444'], 'fill-opacity': 0.18 },
        });
        map.addLayer({
            id: 'oi-carto-shapes-line', type: 'line', source: 'oi-carto-shapes-src',
            paint: { 'line-color': ['coalesce', ['get', 'color'], '#ef4444'], 'line-width': 3, 'line-opacity': 0.9 },
        });

        // Source "preview" (dessin en cours)
        map.addSource('oi-carto-preview-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'oi-carto-preview-fill', type: 'fill', source: 'oi-carto-preview-src',
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: { 'fill-color': ['coalesce', ['get', 'color'], '#ef4444'], 'fill-opacity': 0.12 },
        });
        map.addLayer({
            id: 'oi-carto-preview-line', type: 'line', source: 'oi-carto-preview-src',
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9,
            },
        });

        map.on('click', 'oi-carto-shapes-fill', (e) => this._onShapeClick(e));
        map.on('click', 'oi-carto-shapes-line', (e) => this._onShapeClick(e));
    },

    // oi_cartographie.js:1366-1388
    _bindDrawUi(this: OICartoInternal): void {
        document.querySelectorAll<HTMLElement>('.oi-carto-draw-btn[data-tool]').forEach(btn => {
            // Adaptation TS : `data-tool` est toujours présent sur ces boutons du
            // dock (markup statique, `oi/index.html`) — cast typé, aucune valeur
            // `undefined` réelle à l'exécution (règles communes §13.1.3 : `any`/`!`
            // interdits, précédent `@pctac/planmap/draw-layers.ts` `_bindDrawUi`).
            btn.onclick = () => this._setTool(btn.dataset.tool as OiCartoDrawTool);
        });
        document.querySelectorAll<HTMLElement>('.oi-carto-draw-color').forEach(btn => {
            btn.onclick = () => this._setDrawColor(btn.dataset.color ?? '');
        });
        const clearBtn = document.getElementById('oi_carto_draw_clear');
        if (clearBtn) clearBtn.onclick = () => {
            if (!this._loadShapes().length) return;
            if (!confirm('Effacer tous les dessins ?')) return;
            this._pushHistory();
            this._saveShapes([]);
            this._renderShapes();
            this._refreshUndoRedoButtons();
        };
        const undoBtn = document.getElementById('oi_carto_draw_undo');
        if (undoBtn) undoBtn.onclick = () => this._undo();
        const redoBtn = document.getElementById('oi_carto_draw_redo');
        if (redoBtn) redoBtn.onclick = () => this._redo();
        this._setDrawColor(this.drawColor);
        this._refreshUndoRedoButtons();
    },

    // oi_cartographie.js:1390-1398
    _toggleDrawDock(this: OICartoInternal, force?: boolean): void {
        const dock = document.getElementById('oi_carto_draw_dock');
        const fab = document.getElementById('oi_carto_btn_draw');
        if (!dock) return;
        const shouldOpen = force === undefined ? !dock.classList.contains('open') : force;
        dock.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        if (!shouldOpen && this.drawTool) this._setTool(null);
    },

    // oi_cartographie.js:1400-1427
    _setTool(this: OICartoInternal, tool: OiCartoDrawTool | null): void {
        if (tool && this.drawTool === tool) tool = null; // toggle
        this.drawTool = tool;
        this.drawState = null;
        this._clearPreview();
        if (tool) { this.pendingPin = null; this._hideHint(); }

        document.querySelectorAll<HTMLElement>('.oi-carto-draw-btn[data-tool]').forEach(b => {
            const active = b.dataset.tool === tool;
            b.style.background = active ? this.drawColor : 'transparent';
            b.style.color = active
                ? (['#eab308', '#ffffff', '#22c55e'].includes(this.drawColor) ? '#000' : '#fff')
                : 'var(--text-primary)';
        });

        if (this.map) {
            // Adaptation TS : capture en `const map` — évite que `this.map` perde
            // son narrowing non-null entre les appels successifs ci-dessous (même
            // principe que `@pctac/planmap/draw-tools.ts` `_setTool`).
            const map = this.map;
            map.getCanvas().style.cursor = tool ? 'crosshair' : '';
            if (tool) {
                map.dragPan.disable();
                map.doubleClickZoom.disable();
                map.boxZoom.disable();
            } else {
                map.dragPan.enable();
                map.doubleClickZoom.enable();
                map.boxZoom.enable();
            }
        }
    },

    // oi_cartographie.js:1429-1435
    _setDrawColor(this: OICartoInternal, color: string): void {
        this.drawColor = color;
        document.querySelectorAll<HTMLElement>('.oi-carto-draw-color').forEach(b => {
            b.style.borderColor = b.dataset.color === color ? '#fff' : 'transparent';
        });
        if (this.drawTool) this._setTool(this.drawTool);
    },

    // oi_cartographie.js:1437-1443
    _handleDrawDown(this: OICartoInternal, e: MapMouseEvent | MapTouchEvent): void {
        if (!this.drawTool) return;
        if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
        if (e.preventDefault) e.preventDefault();
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // sans l'annotation, le littéral `[e.lngLat.lng, e.lngLat.lat]` s'infère
        // `number[]`, incompatible avec `LngLatTuple`.
        const lngLat: LngLatTuple = [e.lngLat.lng, e.lngLat.lat];
        this.drawState = { start: lngLat, current: lngLat };
    },

    // oi_cartographie.js:1445-1468
    _handleDrawMove(this: OICartoInternal, e: MapMouseEvent | MapTouchEvent): void {
        if (!this.drawTool || !this.drawState) return;
        // Adaptation TS : capture en `const drawState` — évite toute perte de
        // narrowing non-null de `this.drawState` à travers les branches
        // ci-dessous (même principe que `@pctac/planmap/draw-tools.ts`
        // `_handleDrawMove`).
        const drawState = this.drawState;
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // idem `_handleDrawDown` — annotation requise pour `LngLatTuple`.
        const cursor: LngLatTuple = [e.lngLat.lng, e.lngLat.lat];
        drawState.current = cursor;
        if (this.drawTool === 'line') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [drawState.start, cursor] },
                properties: { color: this.drawColor },
            });
        } else if (this.drawTool === 'rectangle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._rectPolygon(drawState.start, cursor)] },
                properties: { color: this.drawColor },
            });
        } else if (this.drawTool === 'circle') {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._circlePolygon(drawState.start, cursor)] },
                properties: { color: this.drawColor },
            });
        }
    },

    // oi_cartographie.js:1470-1488
    _handleDrawUp(this: OICartoInternal, e: MapMouseEvent | MapTouchEvent): void {
        if (!this.drawTool || !this.drawState) return;
        // Adaptation TS : capture en `const drawState` — même principe que
        // `_handleDrawMove` ci-dessus.
        const drawState = this.drawState;
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // annotation requise pour `LngLatTuple` (idem `_handleDrawDown`).
        const end: LngLatTuple = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : drawState.current;
        const start = drawState.start;
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // `this.map` est garanti non-null tant qu'un outil de dessin est actif
        // (assigné par `_init()`, `carto/map-core.ts`, avant que `_setTool` ne
        // puisse être invoqué) — `map.project(...)` l'exige.
        if (!this.map) return;
        const map = this.map;
        const p1 = map.project({ lng: start[0], lat: start[1] });
        const p2 = map.project({ lng: end[0], lat: end[1] });
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 4) {
            this.drawState = null;
            this._clearPreview();
            return;
        }
        if (this.drawTool === 'line') {
            this._finishShape({ id: 'shape_' + Date.now(), type: 'line', color: this.drawColor, coords: [start, end] });
        } else if (this.drawTool === 'rectangle') {
            this._finishShape({ id: 'shape_' + Date.now(), type: 'rectangle', color: this.drawColor, coords: this._rectPolygon(start, end) });
        } else if (this.drawTool === 'circle') {
            this._finishShape({ id: 'shape_' + Date.now(), type: 'circle', color: this.drawColor, center: start, edge: end, coords: this._circlePolygon(start, end) });
        }
    },

    // oi_cartographie.js:1490-1500
    _finishShape(this: OICartoInternal, shape: OiCartoShape): void {
        this._pushHistory();
        const list = this._loadShapes().slice();
        list.push(shape);
        this._saveShapes(list);
        this.drawState = null;
        this._clearPreview();
        this._renderShapes();
        this._refreshUndoRedoButtons();
        // L'outil reste actif pour enchaîner ; Échap pour quitter.
    },

    // oi_cartographie.js:1502-1505
    _renderPreview(this: OICartoInternal, feature: GeoJSON.Feature): void {
        const src = this.map && this.map.getSource<GeoJSONSource>('oi-carto-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [feature] });
    },

    // oi_cartographie.js:1507-1510
    _clearPreview(this: OICartoInternal): void {
        const src = this.map && this.map.getSource<GeoJSONSource>('oi-carto-preview-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
    },

    // oi_cartographie.js:1512-1522
    _renderShapes(this: OICartoInternal): void {
        const src = this.map && this.map.getSource<GeoJSONSource>('oi-carto-shapes-src');
        if (!src) return;
        // Adaptation TS : annotation de retour explicite sur le callback — sans
        // elle, le littéral `type: 'Feature'` s'infère `string`, incompatible
        // avec `GeoJSON.Feature['type']` (`'Feature'` littéral).
        const features = this._loadShapes().map((s): GeoJSON.Feature => {
            if (s.type === 'line') {
                return { type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: s.coords }, properties: { color: s.color, shapeId: s.id } };
            }
            return { type: 'Feature', id: s.id, geometry: { type: 'Polygon', coordinates: [s.coords] }, properties: { color: s.color, shapeId: s.id } };
        });
        src.setData({ type: 'FeatureCollection', features });
    },

    // oi_cartographie.js:1524-1535
    _onShapeClick(this: OICartoInternal, e: MapLayerMouseEvent): void {
        if (this.drawTool) return;
        const feat = e.features && e.features[0];
        if (!feat) return;
        const id = feat.properties.shapeId;
        if (!id) return;
        if (!confirm('Supprimer ce dessin ?')) return;
        this._pushHistory();
        this._saveShapes(this._loadShapes().filter(s => s.id !== id));
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    // oi_cartographie.js:1537-1541
    _pushHistory(this: OICartoInternal): void {
        this.history.push(JSON.stringify(this._loadShapes()));
        if (this.history.length > 50) this.history.shift();
        this.redoStack = [];
    },

    // oi_cartographie.js:1543-1549
    _undo(this: OICartoInternal): void {
        if (!this.history.length) return;
        this.redoStack.push(JSON.stringify(this._loadShapes()));
        const prev = this.history.pop();
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // `Array.prototype.pop()` type le résultat `string | undefined` même si
        // la garde `if (!this.history.length) return;` ci-dessus garantit un
        // élément présent au moment du pop.
        if (prev === undefined) return;
        try { this._saveShapes(JSON.parse(prev)); } catch { /* JSON invalide : ignoré, comportement d'origine (:1546) */ }
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    // oi_cartographie.js:1551-1557
    _redo(this: OICartoInternal): void {
        if (!this.redoStack.length) return;
        this.history.push(JSON.stringify(this._loadShapes()));
        const next = this.redoStack.pop();
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // idem `_undo`.
        if (next === undefined) return;
        try { this._saveShapes(JSON.parse(next)); } catch { /* JSON invalide : ignoré, comportement d'origine (:1554) */ }
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    // oi_cartographie.js:1559-1570
    _refreshUndoRedoButtons(this: OICartoInternal): void {
        const undoBtn = document.getElementById('oi_carto_draw_undo');
        const redoBtn = document.getElementById('oi_carto_draw_redo');
        if (undoBtn) {
            undoBtn.style.opacity = this.history.length ? '1' : '0.35';
            undoBtn.style.cursor = this.history.length ? 'pointer' : 'not-allowed';
        }
        if (redoBtn) {
            redoBtn.style.opacity = this.redoStack.length ? '1' : '0.35';
            redoBtn.style.cursor = this.redoStack.length ? 'pointer' : 'not-allowed';
        }
    },

    /**
     * Rectangle aligné carte = polygone fermé à 5 points.
     * oi_cartographie.js:1572-1575 — délègue au socle commun
     * `@shared/geo-shapes.js` (R3-a, décision D1) : formule bit-identique à
     * l'original (aucun écart numérique constaté vs PC-Tac), comportement
     * inchangé.
     */
    _rectPolygon(this: OICartoInternal, a: LngLatTuple, b: LngLatTuple): LngLatTuple[] {
        return sharedRectPolygon(a, b);
    },

    /**
     * Approximation polygonale d'un cercle géodésique (64 segments).
     * oi_cartographie.js:1577-1603 — délègue au socle commun
     * `@shared/geo-shapes.js` (R3-a, décision D1) : formule NON simplifiée,
     * bit-identique à l'original (aucun écart numérique constaté vs PC-Tac),
     * comportement inchangé.
     */
    _circlePolygon(this: OICartoInternal, center: LngLatTuple, edge: LngLatTuple): LngLatTuple[] {
        return sharedCirclePolygon(center, edge);
    },
};
