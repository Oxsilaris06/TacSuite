/**
 * measure.ts — Mesure distance/azimut + anneaux d'engagement (P2.CONV, paquet
 * `pm-measure`).
 * ===========================================================================
 *
 * Port TypeScript verbatim des 15 méthodes MESURE de `planMap.js`
 * (`_startMeasure`, `_measureAddVertex`, `_measureUpdateCursor`,
 * `_measureReticlePoint`, `_renderMeasurePreview`, `_renderMeasureLabels`,
 * `_buildMeasureControls`, `_updateMeasureControls`, `_removeMeasureControls`,
 * `_measureUndoVertex`, `_finishMeasure`, `_cancelMeasure`,
 * `_clearMeasureState`, `_addEngagementRings`, `_renderCommittedMeasures`
 * — planMap.js:2297-2704, SPEC-PLANMAP-SPLIT.md §4.9). Corps VERBATIM :
 * seules des adaptations de TYPAGE strict sont apportées (annotations,
 * gardes `noUncheckedIndexedAccess` neutres en observable, casts `as` sur les
 * conversions `.slice()` de tuple déjà pratiquées ailleurs dans `planmap/`,
 * cf. `legacy.ts`) ; aucune restructuration de logique, aucun renommage,
 * aucune extraction de fonction.
 *
 * Machine d'états (SPEC-PLANMAP-SPLIT §1.2 piège 5) : `_startMeasure` ↔
 * `_clearMeasureState` ↔ `_cancelMeasure`/`_finishMeasure` s'appellent
 * mutuellement via `this.`, ainsi que `_setTool` (draw-tools.ts, hors de ce
 * fichier) qui appelle `_startMeasure`/`_clearMeasureState` en retour. C'est
 * voulu : le découpage en groupes de méthodes `this`-typés permet ces cycles
 * sans cycle ESM (aucun sous-module de méthodes n'en importe un autre).
 *
 * ⚠ INVARIANT (§5.9) : `_renderCommittedMeasures` (planMap.js:2681-2684)
 * SAUVEGARDE `this.drawColor`, le remplace par `s.color`, appelle
 * `_renderMeasureLabels` (qui LIT `this.drawColor`), puis RESTAURE la valeur
 * sauvegardée. Ce hack est nécessaire car `_renderMeasureLabels` n'accepte
 * pas de paramètre couleur — porté tel quel, sans « nettoyage ».
 *
 * ⚠ PIÈGE (§1.2 piège 2) : une shape `type: 'measure-rings'` N'A PAS de
 * `coords` (`PlanShape.coords` optionnel, cf. types.ts). `_addEngagementRings`
 * ne doit JAMAIS écrire `coords: []` sur cette shape — elle a `center`/`rings`
 * uniquement, exactement comme l'original (planMap.js:2576-2582).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';

import type { LngLatTuple, PlanMapInternal, PlanShape } from './types.js';

export const MeasureMethods = {
    /** Démarre une nouvelle mesure (réinitialise l'état + UI). */
    // planMap.js:2297-2312
    _startMeasure(this: PlanMapInternal, isMobile: boolean): void {
        this._clearMeasureState();
        this._measureState = {
            vertices: [],
            cursor: null,
            // Réticule de précision sous les gants : présent dès qu'il y a du tactile.
            reticle: !!(isMobile || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)),
        };
        // Réticule central réutilisé (le même que le mode précision dessin).
        const crosshair = document.getElementById('plan_draw_crosshair');
        if (crosshair) crosshair.classList.toggle('active', this._measureState.reticle);
        const viewPlan = document.getElementById('view-plan');
        if (viewPlan && this._measureState.reticle) viewPlan.classList.add('drawing-active');
        this._buildMeasureControls();
        this._renderMeasurePreview();
        this._showHint('Mesure : touche la carte pour poser des points. Double-clic ou « Terminer » pour finir.');
    },

    /** Ajoute un sommet à la mesure en cours. */
    // planMap.js:2316-2327
    _measureAddVertex(this: PlanMapInternal, lngLat: LngLatTuple): void {
        const st = this._measureState;
        if (!st) return;
        // Évite les doublons exacts (double-événement tactile).
        const last = st.vertices[st.vertices.length - 1];
        if (last && last[0] === lngLat[0] && last[1] === lngLat[1]) return;
        // `.slice()` sur un tuple élargit en `number[]` (TS) : cast déjà pratiqué
        // pour la même raison dans legacy.ts (SPEC-PLANMAP-SPLIT §6.3).
        st.vertices.push(lngLat.slice() as LngLatTuple);
        st.cursor = lngLat.slice() as LngLatTuple;
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** Met à jour le segment élastique vers le curseur (preview live). */
    // planMap.js:2329-2335
    _measureUpdateCursor(this: PlanMapInternal, lngLat: LngLatTuple): void {
        const st = this._measureState;
        if (!st || !st.vertices.length) return;
        st.cursor = lngLat.slice() as LngLatTuple;
        this._renderMeasurePreview();
    },

    /** Position courante du réticule (centre de carte) pour la pose mobile. */
    // planMap.js:2337-2340
    _measureReticlePoint(this: PlanMapInternal): LngLatTuple {
        // TS strict : garde absente de l'original, ajoutée pour le typage
        // (`this.map` garanti non-null pendant tout le cycle de vie d'une
        // mesure — seuls des appelants ayant déjà vérifié `this.map`, ou
        // exécutant dans une session de mesure active, invoquent cette
        // méthode ; même principe que draw-layers.ts:301-302). Repli neutre
        // en observable : ce chemin n'est jamais emprunté en pratique.
        if (!this.map) return [0, 0];
        const c = this.map.getCenter();
        return [c.lng, c.lat];
    },

    /**
     * Trace la preview live de la mesure (polyligne pointillée) + étiquettes
     * par segment (distance + azimut) + cumul total à l'extrémité courante.
     * Réutilise la source GeoJSON de preview de dessin et des HTML markers.
     */
    // planMap.js:2356-2380
    _renderMeasurePreview(this: PlanMapInternal): void {
        const st = this._measureState;
        if (!st || !this.map) return;
        // Sommets + (éventuel) point courant (curseur desktop OU réticule mobile).
        const live = st.vertices.slice();
        let cursorPt = st.cursor;
        if (st.reticle) cursorPt = this._measureReticlePoint();
        const drawPts = cursorPt && live.length ? live.concat([cursorPt]) : live;

        if (drawPts.length >= 2) {
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: drawPts },
                properties: { color: this.drawColor },
            });
        } else {
            this._clearPreview();
        }
        this._renderMeasureLabels(drawPts, false);
    },

    /**
     * Rend les étiquettes de segment (HTML markers) le long de `pts`.
     * @param pts        sommets [lng,lat]
     * @param committed  true = mesure persistée (sinon preview live)
     */
    // planMap.js:2382-2436
    _renderMeasureLabels(this: PlanMapInternal, pts: readonly LngLatTuple[], committed: boolean): void {
        // Purge des labels live précédents (les labels committed sont gérés
        // séparément, voir _renderCommittedMeasureLabels).
        if (!committed) {
            if (this._measureLabelMarkers) this._measureLabelMarkers.forEach((m) => { try { m.remove(); } catch { /* déjà retiré du DOM — sans effet */ } });
            this._measureLabelMarkers = [];
        }
        if (!this.map || !pts || pts.length < 2) return;
        const sink = committed ? this._committedMeasureMarkers : this._measureLabelMarkers;
        const color = this.drawColor || '#22d3ee';

        let cumul = 0;
        for (let i = 1; i < pts.length; i++) {
            // Bornes de la boucle garantissent `a`/`b` définis ; `noUncheckedIndexedAccess`
            // les type néanmoins `| undefined` — garde neutre en observable
            // (même principe que geo.ts `measureTotalMeters`, SPEC-PLANMAP-SPLIT §6.3).
            const a = pts[i - 1];
            const b = pts[i];
            if (!a || !b) continue;
            const dist = this._haversineMeters(a, b);
            const az = this._trueBearing(a, b);
            cumul += dist;
            const mid: LngLatTuple = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const isLast = i === pts.length - 1;
            const segTxt = `${this._formatDistance(dist)} · ${this._formatBearing(az)}`;
            const totTxt = (pts.length > 2 && isLast) ? `Σ ${this._formatDistance(cumul)}` : '';
            const div = document.createElement('div');
            div.className = 'plan-measure-label';
            div.style.cssText = `
                display: flex; flex-direction: column; align-items: center; gap: 1px;
                background: rgba(10,12,16,0.86);
                color: #fff;
                padding: 2px 8px;
                border-radius: 10px;
                border: 1px solid ${color};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 12px;
                font-weight: 700;
                line-height: 1.15;
                white-space: nowrap;
                pointer-events: none;
                text-shadow: 0 1px 2px rgba(0,0,0,0.9);
                box-shadow: 0 2px 8px rgba(0,0,0,0.55);
            `;
            const seg = document.createElement('span');
            seg.textContent = segTxt;
            div.appendChild(seg);
            if (totTxt) {
                const tot = document.createElement('span');
                tot.textContent = totTxt;
                tot.style.cssText = `color:${color}; font-size: 11px;`;
                div.appendChild(tot);
            }
            const m = new maplibregl.Marker({ element: div, anchor: 'center', offset: [0, -12] })
                .setLngLat(mid).addTo(this.map);
            sink.push(m);
        }
    },

    /** Construit la barre flottante de contrôle de la mesure (créée dynamiquement). */
    // planMap.js:2437-2483
    _buildMeasureControls(this: PlanMapInternal): void {
        this._removeMeasureControls();
        // TS strict : capture locale de l'élément (au lieu des deux appels
        // `document.getElementById('plan_map')` juxtaposés de l'original) —
        // narrowing pur, un seul lookup DOM comme avant, pas de mise en cache
        // persistante (§6.6 : chaque appel de méthode relit le DOM).
        const mapEl = document.getElementById('plan_map');
        const parent = mapEl && mapEl.parentElement;
        if (!parent) return;
        const bar = document.createElement('div');
        bar.id = 'plan_measure_controls';
        bar.style.cssText = `
            position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
            display: flex; gap: 8px; z-index: 12;
            background: rgba(10,12,16,0.82);
            padding: 6px; border-radius: 14px;
            box-shadow: 0 4px 18px rgba(0,0,0,0.55);
            backdrop-filter: blur(4px);
        `;
        const mkBtn = (label: string, icon: string, bg: string, fg: string, onClick: () => void): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.style.cssText = `
                display: inline-flex; align-items: center; gap: 6px;
                min-height: 48px; padding: 0 16px;
                border: none; border-radius: 10px;
                background: ${bg}; color: ${fg};
                font-family: var(--font-ui, system-ui, sans-serif);
                font-size: 14px; font-weight: 700; cursor: pointer;
                touch-action: manipulation; -webkit-tap-highlight-color: transparent;
            `;
            b.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true" style="font-size:22px;">${icon}</span><span>${label}</span>`;
            b.onclick = this._safe(onClick, 'measureCtl:' + label);
            return b;
        };
        const st = this._measureState;
        // Bouton « Point » : ne s'affiche qu'avec réticule (pose sous gants).
        if (st && st.reticle) {
            this._measurePointBtn = mkBtn('Point', 'add_location_alt', '#3b82f6', '#fff',
                () => this._measureAddVertex(this._measureReticlePoint()));
            bar.appendChild(this._measurePointBtn);
        }
        this._measureUndoBtn = mkBtn('Annuler dernier', 'undo', 'rgba(120,120,120,0.95)', '#fff',
            () => this._measureUndoVertex());
        bar.appendChild(this._measureUndoBtn);
        bar.appendChild(mkBtn('Terminer', 'check', '#22c55e', '#000', () => this._finishMeasure()));
        bar.appendChild(mkBtn('Quitter', 'close', 'rgba(239,68,68,0.95)', '#fff', () => this._cancelMeasure()));
        parent.appendChild(bar);
        this._measureControls = bar;
        this._updateMeasureControls();
    },

    // planMap.js:2484-2489
    _updateMeasureControls(this: PlanMapInternal): void {
        const st = this._measureState;
        const n = st ? st.vertices.length : 0;
        if (this._measureUndoBtn) this._measureUndoBtn.style.display = n >= 1 ? 'inline-flex' : 'none';
    },

    // planMap.js:2490-2496
    _removeMeasureControls(this: PlanMapInternal): void {
        if (this._measureControls) { try { this._measureControls.remove(); } catch { /* déjà retiré du DOM — sans effet */ } this._measureControls = null; }
        this._measurePointBtn = null;
        this._measureUndoBtn = null;
    },

    /** Retire le dernier sommet posé (correction sous stress). */
    // planMap.js:2497-2504
    _measureUndoVertex(this: PlanMapInternal): void {
        const st = this._measureState;
        if (!st || !st.vertices.length) return;
        st.vertices.pop();
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** Valide la mesure : persiste un shape type:'measure' s'il y a >= 2 sommets. */
    // planMap.js:2506-2537
    _finishMeasure(this: PlanMapInternal): void {
        const st = this._measureState;
        if (!st) { this._setTool(null); return; }
        const verts = st.vertices.slice();
        // En mode réticule, le centre courant compte comme dernier sommet implicite
        // s'il diffère du précédent (l'utilisateur a visé sans valider « Point »).
        if (st.reticle) {
            const ret = this._measureReticlePoint();
            const last = verts[verts.length - 1];
            if (!last || last[0] !== ret[0] || last[1] !== ret[1]) verts.push(ret);
        }
        if (verts.length < 2) { this._cancelMeasure(); return; }
        const total = this._measureTotalMeters(verts);
        const shape: PlanShape = {
            id: 'shape_' + Date.now(),
            type: 'measure',
            color: this.drawColor,
            coords: verts,
            totalM: total,
        };
        this._clearMeasureState();
        // Persiste sans passer par _finishShape (qui sélectionne la forme et
        // déclencherait des handles ; la mesure est une annotation non sélectionnable).
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this._setTool(null);
        this._renderShapes();
        this._refreshUndoRedoButtons();
    },

    /** Annule la mesure en cours et revient au mode contrôle carte. */
    // planMap.js:2539-2543
    _cancelMeasure(this: PlanMapInternal): void {
        this._clearMeasureState();
        this._setTool(null);
    },

    /** Nettoie l'état + l'UI de mesure (markers, réticule, barre, hint). */
    // planMap.js:2545-2565
    _clearMeasureState(this: PlanMapInternal): void {
        this._measureState = null;
        if (this._measureLabelMarkers) {
            this._measureLabelMarkers.forEach((m) => { try { m.remove(); } catch { /* déjà retiré du DOM — sans effet */ } });
        }
        this._measureLabelMarkers = [];
        this._removeMeasureControls();
        this._clearPreview();
        const crosshair = document.getElementById('plan_draw_crosshair');
        if (crosshair) crosshair.classList.remove('active');
        const viewPlan = document.getElementById('view-plan');
        if (viewPlan && !this.drawPrecisionMode) viewPlan.classList.remove('drawing-active');
        this._hideHint();
    },

    // ----- ANNEAUX D'ENGAGEMENT (50/100/200 m) -----
    /**
     * Pose des cercles concentriques d'engagement autour du centre de carte
     * courant. Persisté comme un shape type:'measure-rings' (réutilise
     * _circlePolygon). Exposé via clic long sur le bouton mesure.
     * @param center  [lng,lat] ; défaut = centre de la vue
     */
    // planMap.js:2567-2591
    _addEngagementRings(this: PlanMapInternal, center?: LngLatTuple): void {
        if (!this.map) return;
        const c: LngLatTuple = (center && center.length === 2) ? center.slice() as LngLatTuple
                : (() => { const ctr = this.map.getCenter(); return [ctr.lng, ctr.lat] as LngLatTuple; })();
        const radii = [50, 100, 200];
        const rings = radii.map((r) => ({
            radiusM: r,
            coords: this._circlePolygon(c, this._geoEdgeNorth(c, r)),
        }));
        // ⚠ Pas de `coords` sur cette shape (piège §1.2/§6.3) : `measure-rings`
        // porte `center`/`rings`, jamais `coords` — cf. types.ts `PlanShape`.
        const shape: PlanShape = {
            id: 'shape_' + Date.now(),
            type: 'measure-rings',
            color: this.drawColor,
            center: c,
            rings,
        };
        this._pushHistory();
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this._renderShapes();
        this._refreshUndoRedoButtons();
        this._showHint('Anneaux d\'engagement posés : 50 / 100 / 200 m.');
        setTimeout(() => this._hideHint(), 2200);
    },

    /**
     * Étiquettes des mesures persistées (distance/azimut par segment + total)
     * et libellés de rayon des anneaux d'engagement. Recalculées à chaque rendu
     * et à chaque zoom/déplacement (positions le long de la ligne).
     */
    // planMap.js:2672-2704
    _renderCommittedMeasures(this: PlanMapInternal): void {
        if (this._committedMeasureMarkers) {
            this._committedMeasureMarkers.forEach((m) => { try { m.remove(); } catch { /* déjà retiré du DOM — sans effet */ } });
        }
        this._committedMeasureMarkers = [];
        if (!this.map) return;
        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type === 'measure' && Array.isArray(s.coords) && s.coords.length >= 2) {
                // ⚠ INVARIANT §5.9 : sauvegarde/remplace/restaure `this.drawColor`
                // — `_renderMeasureLabels` LIT `this.drawColor` (pas de paramètre
                // couleur). Hack nécessaire, porté tel quel (ne pas « nettoyer »).
                const savedColor = this.drawColor;
                this.drawColor = s.color || '#22d3ee';
                this._renderMeasureLabels(s.coords, true);
                this.drawColor = savedColor;
            } else if (s.type === 'measure-rings' && Array.isArray(s.rings)) {
                const color = s.color || '#22d3ee';
                for (const ring of s.rings) {
                    if (!ring || !s.center) continue;
                    // Libellé du rayon placé au nord du cercle.
                    const top = this._geoEdgeNorth(s.center, ring.radiusM);
                    const div = document.createElement('div');
                    div.className = 'plan-measure-ring-label';
                    div.textContent = `${ring.radiusM} m`;
                    div.style.cssText = `
                        background: rgba(10,12,16,0.86); color: #fff;
                        padding: 1px 7px; border-radius: 9px; border: 1px solid ${color};
                        font-family: var(--font-data, ui-monospace, monospace);
                        font-size: 11px; font-weight: 700; white-space: nowrap;
                        pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.9);
                    `;
                    const m = new maplibregl.Marker({ element: div, anchor: 'center' })
                        .setLngLat(top).addTo(this.map);
                    this._committedMeasureMarkers.push(m);
                }
            }
        }
    },
};
