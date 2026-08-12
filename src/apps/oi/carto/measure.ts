/**
 * measure.ts — Mesure distance/azimut vrai + anneaux d'engagement (paquet
 * `oi-carto-measure`, hors littéral `oi_cartographie.js` — introduit par ce
 * chantier, portage de l'UX PC-Tac).
 * ===========================================================================
 *
 * Port de l'UX de `@pctac/planmap/measure.ts` (414 l., lecture seule) vers la
 * carto OI, adapté au patron `carto/*.ts` (`this: OICartoInternal`, AUCUN
 * import d'un autre groupe de méthodes `carto/`). Différences volontaires vs
 * PC-Tac (documentées, pas des oublis) :
 *  - Pas de mode réticule/précision mobile ("Point" au centre de carte) : OI
 *    n'a pas ce besoin exprimé, `_handleDrawMove` synthétique de `draw.ts`
 *    n'est pas réutilisable ici (groupe séparé). Clic carte uniquement.
 *  - Pas de `#plan_draw_crosshair`/`#view-plan` (contrôles dédiés PC-Tac,
 *    absents d'OI) : la barre de contrôle mesure est un panneau flottant
 *    100% DOM-en-code, ajouté au conteneur `#oi_carto_map` (pattern
 *    `panels.ts`/`draw.ts::_buildMeasureControls`), PAS de markup index.html.
 *  - Rendu géométrie (ligne + anneaux) : source/couche GeoJSON DÉDIÉES
 *    (`oi-carto-measure-src`), PAS la source partagée `oi-carto-shapes-src`
 *    (`draw.ts`, hors périmètre de ce paquet) — `_renderShapes` (draw.ts)
 *    construit ses Features en supposant `s.coords` un anneau de polygone
 *    valide pour tout type non-`line` ; les shapes `measure`/`measure-rings`
 *    y transiteraient avec une géométrie dégradée. On persiste quand même via
 *    `_loadShapes`/`_saveShapes` (seule frontière de persistance carto,
 *    parité PC-Tac `_finishMeasure`/`_addEngagementRings`), mais on rend
 *    NOUS-MÊMES la géométrie dans notre propre source — `_renderShapes`
 *    (draw.ts) continuera par ailleurs à pousser une Feature dégradée pour ces
 *    shapes dans `oi-carto-shapes-src` (polygone non fermé pour `measure`,
 *    anneau vide `[[]]` pour `measure-rings`, `OiCartoShape.coords: []`
 *    délibéré — cf. types.ts) : sans conséquence visuelle grave (géométrie
 *    vide ou fill superposé discret), mais à corriger côté `draw.ts` par
 *    l'agent d'intégration (cf. rapport de câblage) en excluant ces deux
 *    types de son `.map()`.
 *
 * Helpers géométriques : `circlePolygon`/`geoEdgeNorth` réutilisés depuis
 * `@shared/geo-shapes.js` (déjà consommé par `draw.ts`/PC-Tac `geo.ts`) ;
 * `trueBearing`/`haversineMeters`/`formatDistance`/`formatBearing` n'existent
 * QUE côté PC-Tac (`@pctac/planmap/geo.ts`, module non partagé) — copie locale
 * fonctions pures, verbatim, sans modifier PC-Tac.
 *
 * Source de l'UX portée : `@pctac/planmap/measure.ts` (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';

import { circlePolygon, geoEdgeNorth } from '@shared/geo-shapes.js';

import type { LngLatTuple, OICartoInternal, OiCartoShape } from './types.js';

// ----- Helpers géodésiques purs (copie locale, cf. en-tête) -----
// @pctac/planmap/geo.ts:2276-2284 (_trueBearing) — azimut vrai [0,360), 0°=Nord.
function trueBearing(a: LngLatTuple, b: LngLatTuple): number {
    const toRad = (d: number) => d * Math.PI / 180;
    const phi1 = toRad(a[1]), phi2 = toRad(b[1]);
    const dLam = toRad(b[0] - a[0]);
    const y = Math.sin(dLam) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

// @pctac/planmap/geo.ts:2712-2720 (_haversineMeters)
function haversineMeters(a: LngLatTuple, b: LngLatTuple): number {
    const R = 6371000;
    const toRad = (d: number) => d * Math.PI / 180;
    const dPhi = toRad(b[1] - a[1]);
    const dLam = toRad(b[0] - a[0]);
    const phi1 = toRad(a[1]); const phi2 = toRad(b[1]);
    const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function measureTotalMeters(vertices: readonly LngLatTuple[]): number {
    let total = 0;
    for (let i = 1; i < vertices.length; i++) {
        const prev = vertices[i - 1];
        const cur = vertices[i];
        if (prev && cur) total += haversineMeters(prev, cur);
    }
    return total;
}

// @pctac/planmap/geo.ts:2292-2294
function formatBearing(deg: number): string {
    return `${Math.round(deg).toString().padStart(3, '0')}°`;
}

// @pctac/planmap/geo.ts:2723-2728
function formatDistance(m: number): string {
    if (!isFinite(m) || m <= 0) return '';
    if (m < 1) return `${(m * 100).toFixed(0)} cm`;
    if (m < 1000) return `${Math.round(m)} m`;
    if (m < 10000) return `${(m / 1000).toFixed(2)} km`;
    return `${(m / 1000).toFixed(1)} km`;
}

const RING_RADII_M = [50, 100, 200];

export const MeasureMethods = {
    /**
     * Crée (une seule fois) la source/couche GeoJSON dédiée à la mesure —
     * ligne(s) + cercles d'anneaux persistés. Idempotent : appelable
     * plusieurs fois sans dupliquer (garde `getSource`). À appeler depuis
     * `_init()` (map-core.ts, hors périmètre — cf. rapport de câblage).
     */
    _initMeasureLayers(this: OICartoInternal): void {
        if (!this.map) return;
        const map = this.map;
        if (map.getSource('oi-carto-measure-src')) return;
        map.addSource('oi-carto-measure-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'oi-carto-measure-line',
            type: 'line',
            source: 'oi-carto-measure-src',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 1] },
        });
        map.addLayer({
            id: 'oi-carto-measure-rings',
            type: 'line',
            source: 'oi-carto-measure-src',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.85 },
        });
    },

    /** Bascule le mode mesure (parité PC-Tac `_startMeasure`/`_cancelMeasure`). */
    _toggleMeasure(this: OICartoInternal): void {
        if (this._measureState) {
            this._cancelMeasure();
            return;
        }
        this._measureState = { vertices: [], cursor: null };
        this._buildMeasureControls();
        this._renderMeasurePreview();
        this._showHint('Mesure : touche la carte pour poser des points. « Terminer » pour finir.');
    },

    /** Ajoute un sommet à la mesure en cours (clic carte). */
    _measureAddVertex(this: OICartoInternal, lngLat: LngLatTuple): void {
        const st = this._measureState;
        if (!st) return;
        const last = st.vertices[st.vertices.length - 1];
        if (last && last[0] === lngLat[0] && last[1] === lngLat[1]) return;
        st.vertices.push(lngLat.slice() as LngLatTuple);
        st.cursor = lngLat.slice() as LngLatTuple;
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** Met à jour le segment élastique vers le curseur (preview live desktop). */
    _measureUpdateCursor(this: OICartoInternal, lngLat: LngLatTuple): void {
        const st = this._measureState;
        if (!st || !st.vertices.length) return;
        st.cursor = lngLat.slice() as LngLatTuple;
        this._renderMeasurePreview();
    },

    /** Trace la preview live (source dédiée) + étiquettes segment/cumul. */
    _renderMeasurePreview(this: OICartoInternal): void {
        const st = this._measureState;
        if (!st || !this.map) return;
        const drawPts = st.cursor && st.vertices.length ? st.vertices.concat([st.cursor]) : st.vertices;
        const src = this.map.getSource<GeoJSONSource>('oi-carto-measure-src');
        if (src) {
            const features: GeoJSON.Feature[] = drawPts.length >= 2
                ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: drawPts }, properties: { color: this.drawColor } }]
                : [];
            src.setData({ type: 'FeatureCollection', features });
        }
        this._renderMeasureLabels(drawPts, false);
    },

    /**
     * Rend les étiquettes de segment (HTML markers) le long de `pts`.
     * @param committed  true = mesure persistée (sinon preview live).
     */
    _renderMeasureLabels(this: OICartoInternal, pts: readonly LngLatTuple[], committed: boolean): void {
        if (!committed) {
            this._measureLabelMarkers.forEach((m) => { try { m.remove(); } catch { /* déjà retiré */ } });
            this._measureLabelMarkers = [];
        }
        if (!this.map || !pts || pts.length < 2) return;
        const sink = committed ? this._committedMeasureMarkers : this._measureLabelMarkers;
        const color = this.drawColor || '#ef4444';

        let cumul = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            if (!a || !b) continue;
            const dist = haversineMeters(a, b);
            const az = trueBearing(a, b);
            cumul += dist;
            const mid: LngLatTuple = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const isLast = i === pts.length - 1;
            const segTxt = `${formatDistance(dist)} · ${formatBearing(az)}`;
            const totTxt = (pts.length > 2 && isLast) ? `Σ ${formatDistance(cumul)}` : '';
            const div = document.createElement('div');
            div.className = 'oi-carto-measure-label';
            div.style.borderColor = color;
            const seg = document.createElement('span');
            seg.textContent = segTxt;
            div.appendChild(seg);
            if (totTxt) {
                const tot = document.createElement('span');
                tot.textContent = totTxt;
                tot.className = 'oi-carto-measure-label-total';
                tot.style.color = color;
                div.appendChild(tot);
            }
            const m = new maplibregl.Marker({ element: div, anchor: 'center', offset: [0, -12] })
                .setLngLat(mid).addTo(this.map);
            sink.push(m);
        }
    },

    /** Construit la barre flottante de contrôle de la mesure (DOM créé en code). */
    _buildMeasureControls(this: OICartoInternal): void {
        this._removeMeasureControls();
        const mapEl = document.getElementById('oi_carto_map');
        const parent = mapEl && mapEl.parentElement;
        if (!parent) return;
        const bar = document.createElement('div');
        bar.id = 'oi_carto_measure_controls';
        bar.className = 'oi-carto-measure-controls';
        const mkBtn = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `oi-carto-measure-btn ${cls}`;
            b.textContent = label;
            b.onclick = this._safe(onClick, 'measureCtl:' + label);
            return b;
        };
        this._measureUndoBtn = mkBtn('Annuler dernier', 'oi-carto-measure-btn-undo', () => this._measureUndoVertex());
        bar.appendChild(this._measureUndoBtn);
        bar.appendChild(mkBtn('Terminer', 'oi-carto-measure-btn-finish', () => this._finishMeasure()));
        bar.appendChild(mkBtn('Quitter', 'oi-carto-measure-btn-cancel', () => this._cancelMeasure()));
        parent.appendChild(bar);
        this._measureControls = bar;
        this._updateMeasureControls();
    },

    _updateMeasureControls(this: OICartoInternal): void {
        const st = this._measureState;
        const n = st ? st.vertices.length : 0;
        if (this._measureUndoBtn) this._measureUndoBtn.style.display = n >= 1 ? 'inline-flex' : 'none';
    },

    _removeMeasureControls(this: OICartoInternal): void {
        if (this._measureControls) { try { this._measureControls.remove(); } catch { /* déjà retiré */ } this._measureControls = null; }
        this._measureUndoBtn = null;
    },

    /** Retire le dernier sommet posé. */
    _measureUndoVertex(this: OICartoInternal): void {
        const st = this._measureState;
        if (!st || !st.vertices.length) return;
        st.vertices.pop();
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** Valide la mesure : persiste un shape type:'measure' s'il y a >= 2 sommets. */
    _finishMeasure(this: OICartoInternal): void {
        const st = this._measureState;
        if (!st || st.vertices.length < 2) { this._cancelMeasure(); return; }
        const verts = st.vertices.slice();
        const total = measureTotalMeters(verts);
        const shape: OiCartoShape = {
            id: 'shape_' + Date.now(),
            type: 'measure',
            color: this.drawColor,
            coords: verts,
            totalM: total,
        };
        this._clearMeasureState();
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this._renderCommittedMeasures();
        this._refreshUndoRedoButtons();
    },

    /** Annule la mesure en cours. */
    _cancelMeasure(this: OICartoInternal): void {
        this._clearMeasureState();
    },

    /** Nettoie l'état + l'UI de mesure (markers, barre, preview, hint). */
    _clearMeasureState(this: OICartoInternal): void {
        this._measureState = null;
        this._measureLabelMarkers.forEach((m) => { try { m.remove(); } catch { /* déjà retiré */ } });
        this._measureLabelMarkers = [];
        this._removeMeasureControls();
        const src = this.map && this.map.getSource<GeoJSONSource>('oi-carto-measure-src');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        this._hideHint();
    },

    /**
     * Pose des anneaux d'engagement concentriques (50/100/200 m, parité
     * PC-Tac) autour de `center` (défaut = centre de vue).
     */
    _addEngagementRings(this: OICartoInternal, center?: LngLatTuple): void {
        if (!this.map) return;
        const c: LngLatTuple = (center && center.length === 2) ? center.slice() as LngLatTuple
                : (() => { const ctr = this.map.getCenter(); return [ctr.lng, ctr.lat] as LngLatTuple; })();
        const rings = RING_RADII_M.map((r) => ({
            radiusM: r,
            coords: circlePolygon(c, geoEdgeNorth(c, r)),
        }));
        // ⚠ `coords: []` délibéré (cf. en-tête fichier + types.ts) : cette
        // shape porte `center`/`rings`, jamais de tracé `coords` réel — champ
        // requis par `OiCartoShape` (contrat partagé avec `draw.ts`, hors
        // périmètre) donc rempli vide plutôt qu'omis.
        const shape: OiCartoShape = {
            id: 'shape_' + Date.now(),
            type: 'measure-rings',
            color: this.drawColor,
            coords: [],
            center: c,
            rings,
        };
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this._renderCommittedMeasures();
        this._refreshUndoRedoButtons();
        this._showHint('Anneaux d\'engagement posés : 50 / 100 / 200 m.');
        setTimeout(() => this._hideHint(), 2200);
    },

    /**
     * Rend la géométrie + étiquettes des mesures/anneaux persistés (source
     * dédiée `oi-carto-measure-src`). À rejouer à chaque `_renderShapes`
     * (draw.ts, hors périmètre) — cf. rapport de câblage.
     */
    _renderCommittedMeasures(this: OICartoInternal): void {
        this._committedMeasureMarkers.forEach((m) => { try { m.remove(); } catch { /* déjà retiré */ } });
        this._committedMeasureMarkers = [];
        if (!this.map) return;
        const shapes = this._loadShapes();
        const features: GeoJSON.Feature[] = [];
        for (const s of shapes) {
            if (s.type === 'measure' && Array.isArray(s.coords) && s.coords.length >= 2) {
                features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.coords }, properties: { color: s.color || '#ef4444' } });
                const savedColor = this.drawColor;
                this.drawColor = s.color || '#ef4444';
                this._renderMeasureLabels(s.coords, true);
                this.drawColor = savedColor;
            } else if (s.type === 'measure-rings' && Array.isArray(s.rings) && s.center) {
                const color = s.color || '#ef4444';
                for (const ring of s.rings) {
                    if (!ring || !Array.isArray(ring.coords) || !ring.coords.length) continue;
                    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring.coords] }, properties: { color } });
                    const top = geoEdgeNorth(s.center, ring.radiusM);
                    const div = document.createElement('div');
                    div.className = 'oi-carto-measure-ring-label';
                    div.textContent = `${ring.radiusM} m`;
                    div.style.borderColor = color;
                    const m = new maplibregl.Marker({ element: div, anchor: 'center' }).setLngLat(top).addTo(this.map);
                    this._committedMeasureMarkers.push(m);
                }
            }
        }
        const src = this.map.getSource<GeoJSONSource>('oi-carto-measure-src');
        if (src && !this._measureState) src.setData({ type: 'FeatureCollection', features });
    },
};
