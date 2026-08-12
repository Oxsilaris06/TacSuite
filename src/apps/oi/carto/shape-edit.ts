/**
 * shape-edit.ts — ÉDITION des formes dessinées : sélection, poignées, drag,
 * pinch, toolbar flottante (chantier shape-edit, parité PC-Tac).
 * ===========================================================================
 *
 * ADAPTATEUR MINCE de la machine à gestes partagée `@shared/shape-gestures.js`
 * (même patron que `@pctac/planmap/shapes-gestures.ts`) : le NOYAU (drag de
 * forme, pinch 2 doigts, calcul/rendu/drag des poignées) vit dans le socle
 * commun ; ce module fournit l'injection OI (`gestureDeps`) et l'orchestration
 * sélection/désélection/toolbar.
 *
 * Écarts assumés vs PC-Tac (formes OI plus simples : line/rectangle/circle,
 * pas de texte, pas de verrous, pas de roue contextuelle) :
 *   - `isLocked: () => false` — aucun verrou global côté OI ;
 *   - pas de fenêtre double-tap : un tap = sélection + toolbar directes ;
 *   - la roue d'options PC-Tac est remplacée par une toolbar flottante
 *     minimale (supprimer + couleur), portée par un Marker MapLibre.
 *
 * ⚠ INVARIANT MARKER (SPEC-PLANMAP-SPLIT §5.1, repris ici) : poignées et
 * toolbar sont portées par des Markers carte — JAMAIS de `position:`/`inset:`
 * inline sur leurs éléments.
 *
 * Patron du découpage `carto/` (SPEC-OI-CONVERSION.md §6.2) : chaque méthode
 * déclare `this: OICartoInternal`, AUCUN import d'un autre groupe de méthodes ;
 * dépendances autorisées : `./types.js`, `@shared/*`, `maplibre-gl`.
 */

import maplibregl from 'maplibre-gl';
import type {
    Map as MapLibreMap,
    MapLayerMouseEvent,
    MapLayerTouchEvent,
    MapMouseEvent,
    MapTouchEvent,
    Marker,
    MarkerOptions,
} from 'maplibre-gl';

import { toast } from '@shared/feedback.js';
// Le drag de poignée (`startHandleGesture`) est câblé en interne par
// `renderShapeHandles` (via l'injection) : pas d'import direct nécessaire.
import {
    renderShapeHandles,
    startPinchGesture,
    startShapeDragGesture,
} from '@shared/shape-gestures.js';
import type { ShapeGestureDeps } from '@shared/shape-gestures.js';

import type { LngLatObj, LngLatTuple, OICartoInternal, OiCartoShape } from './types.js';

/** Les 5 couleurs du dock dessin OI (oi/index.html, `.oi-carto-draw-color`). */
const TOOLBAR_COLORS: { color: string; label: string; cls: string }[] = [
    { color: '#ef4444', label: 'Rouge', cls: 'oi-carto-draw-color-red' },
    { color: '#eab308', label: 'Jaune', cls: 'oi-carto-draw-color-yellow' },
    { color: '#3b82f6', label: 'Bleu', cls: 'oi-carto-draw-color-blue' },
    { color: '#22c55e', label: 'Vert', cls: 'oi-carto-draw-color-green' },
    { color: '#ffffff', label: 'Blanc', cls: 'oi-carto-draw-color-white' },
];

/** Centroïde d'une forme OI (pivot du pinch + ancre de la toolbar). */
function shapeCentroid(s: OiCartoShape): LngLatTuple {
    if (s.type === 'circle' && s.center) return s.center;
    // `measure-rings` n'a pas de `coords` (délibéré, cf. types.ts) — le
    // centre du geste/toolbar est `s.center` (posé par `_addEngagementRings`).
    if (s.type === 'measure-rings' && s.center) return s.center;
    const pts = s.coords;
    if (!pts.length) return [0, 0];
    let lng = 0, lat = 0;
    for (const [x, y] of pts) { lng += x; lat += y; }
    return [lng / pts.length, lat / pts.length];
}

/** Point le plus haut (lat max) de la forme — la toolbar s'affiche au-dessus. */
function shapeAnchor(s: OiCartoShape): LngLatTuple {
    const c = shapeCentroid(s);
    let top = c[1];
    for (const [, y] of s.coords) { if (y > top) top = y; }
    return [c[0], top];
}

/**
 * Injection OI de la machine partagée : accès formes/persistance/rendu via
 * `this`, sélection au tap, fabrique de Markers pour les poignées. Construite
 * à chaque amorce de geste (fermetures sur `self`, aucun état propre).
 */
function gestureDeps(self: OICartoInternal, map: MapLibreMap): ShapeGestureDeps<OiCartoShape, Marker> {
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
        isLocked: () => false, // pas de verrou global côté OI
        getSelectedShapeId: () => self._selectedShapeId,
        // Fin de drag : garde la forme sélectionnée pour l'édition immédiate.
        onDragEnd: shapeId => {
            self._refreshUndoRedoButtons();
            self._selectShape(shapeId);
        },
        // Tap sans drag : sélection directe (poignées + toolbar) — pas de
        // double-tap côté OI, la toolbar remplace la roue contextuelle PC-Tac.
        onTap: shapeId => { self._selectShape(shapeId); },
        shapeCentroid,
        deselectShape: () => self._deselectShape(),
        canStartHandleGesture: () => !(self.drawTool || self._gesture),
        createHandleMarker: (el, lngLat, offset) => {
            const markerOpts: MarkerOptions = { element: el, anchor: 'center' };
            if (offset) markerOpts.offset = offset;
            return new maplibregl.Marker(markerOpts).setLngLat([lngLat.lng, lngLat.lat]).addTo(map);
        },
        afterHandleDrag: () => {
            self._renderHandles();          // les poignées suivent la forme
            self._updateShapeToolbarPos();  // la toolbar aussi
        },
    };
}

export const ShapeEditMethods = {
    /**
     * Câblage unique (appelé par `_initDrawingLayers`, draw.ts, une fois les
     * couches formes créées) : entrée gestes par couches, désélection au clic
     * ailleurs et à Échap.
     */
    _bindShapeEditGestures(this: OICartoInternal): void {
        if (!this.map) return;
        const map = this.map;

        // Amorce tap/drag sur les couches formes (souris + tactile)
        for (const layer of ['oi-carto-shapes-fill', 'oi-carto-shapes-line'] as const) {
            map.on('mousedown', layer, this._safe((e: MapLayerMouseEvent) => this._shapePointerDown(e), 'shapeDown'));
            map.on('touchstart', layer, this._safe((e: MapLayerTouchEvent) => this._shapePointerDown(e), 'shapeDown'));
        }

        // Clic ailleurs (aucune forme sous le pointeur) → désélection
        map.on('click', this._safe((e: MapMouseEvent) => {
            if (!this._selectedShapeId || this._gesture) return;
            let hits: unknown[] = [];
            try {
                hits = map.queryRenderedFeatures(e.point, { layers: ['oi-carto-shapes-fill', 'oi-carto-shapes-line'] });
            } catch { /* couches pas encore prêtes : on désélectionne quand même */ }
            if (!hits.length) this._deselectShape();
        }, 'shapeDeselectClick'));

        // Échap → désélection (preventDefault : ne pas fermer la modale carto)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._selectedShapeId) {
                e.preventDefault();
                this._deselectShape();
            }
        });
    },

    /** Entrée par couches formes : garde outils/gestes puis amorce le geste (parité PC-Tac :2846). */
    _shapePointerDown(this: OICartoInternal, e: MapLayerMouseEvent | MapLayerTouchEvent): void {
        if (this.drawTool) return;   // outil de dessin actif : priorité au tracé
        if (this._gesture) return;   // déjà un geste en cours
        if (this.pendingPin) return; // placement de pin armé : priorité au pin
        // Pointeur parti d'un marker DOM (pin, poignée, toolbar) : ne pas
        // déplacer la forme sous-jacente en même temps.
        const oe = e.originalEvent;
        const target = oe && oe.target instanceof Element ? oe.target : null;
        if (target && target.closest('.maplibregl-marker')) return;
        const feat = e.features && e.features[0];
        if (!feat || !feat.properties) return;
        const id = feat.properties.shapeId as string | undefined;
        if (!id) return;
        // Mesures/anneaux commités (parité PC-Tac : annotation lecture seule,
        // pas de move/resize générique) : clic-sélection uniquement, via le
        // `map.on('click', …)` déjà câblé (draw.ts::_initDrawingLayers →
        // `_onShapeClick`) — on NE démarre PAS la machine tap/drag ici, pour
        // ne pas translater `center` sans re-projeter `rings[].coords`
        // (`startShapeDragGesture`, @shared/shape-gestures.js, ne connaît que
        // `coords`/`center`/`edge`, pas la géométrie dérivée des anneaux).
        const shape = this._loadShapes().find((s) => s.id === id);
        if (shape && (shape.type === 'measure' || shape.type === 'measure-rings')) return;
        if (e.preventDefault) e.preventDefault();
        if (oe && oe.preventDefault) oe.preventDefault();
        this._startShapeGesture(id, e.lngLat);
    },

    /** Machine tap/drag — noyau partagé (`startShapeDragGesture`, seuil 6 px). */
    _startShapeGesture(this: OICartoInternal, shapeId: string, startLngLat: LngLatObj): void {
        if (!this.map) return;
        startShapeDragGesture(gestureDeps(this, this.map), shapeId, startLngLat);
    },

    _selectShape(this: OICartoInternal, shapeId: string): void {
        if (this._selectedShapeId === shapeId) {
            this._renderHandles();
            this._updateShapeToolbarPos();
            return;
        }
        this._selectedShapeId = shapeId;
        this._renderHandles();
        this._renderShapeToolbar();
        this._attachPinchListeners();
    },

    _deselectShape(this: OICartoInternal): void {
        if (!this._selectedShapeId) return;
        this._selectedShapeId = null;
        this._clearHandles();
        this._clearShapeToolbar();
        this._detachPinchListeners();
    },

    _clearHandles(this: OICartoInternal): void {
        if (this._handleMarkers) this._handleMarkers.forEach(m => { try { m.remove(); } catch { /* déjà retiré du DOM — sans effet */ } });
        this._handleMarkers = [];
    },

    /** Poignées de la forme sélectionnée — noyau partagé (`renderShapeHandles`). */
    _renderHandles(this: OICartoInternal): void {
        this._clearHandles();
        if (!this.map || !this._selectedShapeId) return;
        this._handleMarkers = renderShapeHandles(gestureDeps(this, this.map));
    },

    /**
     * Forme sélectionnée + 2 doigts sur la carte = pinch-resize (parité
     * PC-Tac). Le pinch-zoom natif est désactivé le temps du geste.
     */
    _attachPinchListeners(this: OICartoInternal): void {
        if (this._pinchListener) return;
        if (!this.map) return;
        const map = this.map;
        const onTouchStart = this._safe((e: MapTouchEvent) => {
            if (!this._selectedShapeId || this.drawTool || this._gesture) return;
            const oe = e.originalEvent || e;
            if (oe.touches && oe.touches.length === 2) {
                oe.preventDefault();
                this._startPinchGesture();
            }
        }, 'pinch:touchstart');
        map.on('touchstart', onTouchStart);
        this._pinchListener = onTouchStart;
    },

    _detachPinchListeners(this: OICartoInternal): void {
        if (!this._pinchListener) return;
        if (this.map) {
            try { this.map.off('touchstart', this._pinchListener); } catch { /* API MapLibre peut jeter selon l'état du style */ }
        }
        this._pinchListener = null;
    },

    /** Pinch-resize — noyau partagé (`startPinchGesture`). */
    _startPinchGesture(this: OICartoInternal): void {
        if (!this.map) return;
        startPinchGesture(gestureDeps(this, this.map));
    },

    /**
     * Toolbar flottante minimale de la forme sélectionnée : supprimer + les 5
     * couleurs du dock. Portée par un Marker MapLibre ancré au-dessus de la
     * forme (invariant §5.1 : aucun position/inset inline).
     */
    _renderShapeToolbar(this: OICartoInternal): void {
        this._clearShapeToolbar();
        if (!this.map || !this._selectedShapeId) return;
        const map = this.map;
        const shapeId = this._selectedShapeId;
        const s = this._loadShapes().find(x => x.id === shapeId);
        if (!s) return;

        const el = document.createElement('div');
        el.className = 'oi-carto-shape-toolbar';
        // Ne pas laisser le pointerdown atteindre la carte (pan/désélection)
        el.addEventListener('pointerdown', ev => ev.stopPropagation());
        el.addEventListener('touchstart', ev => ev.stopPropagation());

        for (const c of TOOLBAR_COLORS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `oi-carto-draw-color ${c.cls}`;
            btn.title = c.label;
            btn.setAttribute('aria-label', `Couleur ${c.label.toLowerCase()}`);
            btn.style.borderColor = s.color === c.color ? '#fff' : 'transparent';
            btn.onclick = this._safe(() => {
                this._pushHistory();
                const list = this._loadShapes();
                const t = list.find(x => x.id === shapeId);
                if (!t) return;
                t.color = c.color;
                if (t.type === 'text') t.textColor = c.color; // parité PC-Tac `_confirmTextModal` (color === textColor)
                this._saveShapes(list);
                this._renderShapes();
                this._refreshUndoRedoButtons();
                this._renderShapeToolbar(); // re-surligne la couleur active
            }, 'shapeToolbar:color');
            el.appendChild(btn);
        }

        const sep = document.createElement('div');
        sep.className = 'oi-carto-shape-toolbar-sep';
        el.appendChild(sep);

        if (s.type === 'text') {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'oi-carto-shape-toolbar-edit';
            edit.title = 'Modifier le texte';
            edit.setAttribute('aria-label', 'Modifier le texte');
            edit.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">edit</span>';
            edit.onclick = this._safe(() => { void this._editText(shapeId); }, 'shapeToolbar:editText');
            el.appendChild(edit);
        }

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'oi-carto-shape-toolbar-delete';
        del.title = 'Supprimer ce dessin';
        del.setAttribute('aria-label', 'Supprimer ce dessin');
        del.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span>';
        del.onclick = this._safe(() => {
            this._pushHistory();
            this._saveShapes(this._loadShapes().filter(x => x.id !== shapeId));
            this._deselectShape();
            this._renderShapes();
            this._refreshUndoRedoButtons();
            toast('Dessin supprimé — Annuler pour revenir en arrière.', { kind: 'success' });
        }, 'shapeToolbar:delete');
        el.appendChild(del);

        const a = shapeAnchor(s);
        this._shapeToolbarMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] })
            .setLngLat(a)
            .addTo(map);
    },

    _clearShapeToolbar(this: OICartoInternal): void {
        if (this._shapeToolbarMarker) {
            try { this._shapeToolbarMarker.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
            this._shapeToolbarMarker = null;
        }
    },

    /** Repositionne la toolbar (suit la forme pendant drag/resize). */
    _updateShapeToolbarPos(this: OICartoInternal): void {
        if (!this._shapeToolbarMarker || !this._selectedShapeId) return;
        const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
        if (!s) return;
        this._shapeToolbarMarker.setLngLat(shapeAnchor(s));
    },
};
