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
 * ÉVOLUTION « retours terrain 2026-10-02 » (décisions de Nico) : le « corps
 * VERBATIM, aucune restructuration » ci-dessus décrit le PORTAGE d'origine ; il
 * ne fige pas l'outil, qui a changé sur quatre points. Les méthodes touchées
 * portent la mention « retours terrain 2026-10-02 » ; les trois nouvelles
 * (`_measureSnapTarget`, `_measureClick`, `_measureShowInfo`) n'ont pas de
 * contrepartie dans `planMap.js`.
 *   1. « Valider la ligne » (`_finishMeasure`) fige la ligne (shape 'measure',
 *      une entrée d'historique) et l'outil RESTE actif : le toucher suivant en
 *      démarre une nouvelle, de n'importe où. Seul « Quitter » (`_cancelMeasure`)
 *      en sort, et abandonne la ligne en cours. Une ligne de moins de 2 points
 *      est abandonnée sans rien persister. Le 2e clic d'un double-clic (MapLibre :
 *      click, click, dblclick) ne pose pas de sommet (`MEASURE_DUP_PX`) : sinon
 *      le dblclick validerait une ligne de ~0 m.
 *   2. Aimant (`_measureSnapTarget`, `MEASURE_SNAP_PX`) : un point posé près
 *      d'un sommet de dessin ou d'un pion s'y accroche exactement ; en mode
 *      réticule, c'est le point du réticule qui s'accroche. Bouton « Aimant »
 *      (actif par défaut). Un trait n'accroche que par ses deux extrémités
 *      (`snapCandidates`, geo.ts) : ses points intermédiaires, un tous les 4 px,
 *      accrocheraient partout et interdiraient d'en lire la longueur.
 *   3. Lecture d'un dessin (`_measureClick`) : sans ligne en cours, toucher le
 *      CONTOUR d'un trait, d'un rectangle ou d'un cercle (zone de touche du trait,
 *      jamais le remplissage : l'intérieur d'une zone dessinée doit rester un
 *      endroit où poser un point) affiche sa longueur, ou son périmètre et sa
 *      surface, dans la barre, sans poser de point.
 *   4. Dessins inertes : `_startMeasure` désélectionne la forme active ; les
 *      gardes `drawTool` de shapes-gestures.ts et de shapes-render.ts font le
 *      reste, cadenas des formes compris (`_renderShapeLocks`, rafraîchi à
 *      l'entrée et à la sortie de la mesure : ils laissent passer le toucher).
 *
 * Source : `GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { PointLike } from 'maplibre-gl';

import { formatAzimuth, magneticDeclination } from './azimuth.js';
import { shapeMeasureText, snapCandidates } from './geo.js';
import type { LngLatTuple, PlanMapInternal, PlanShape } from './types.js';

/**
 * Rayon d'accroche de l'aimant, en pixels ÉCRAN (retours terrain 2026-10-02 :
 * 16 à 20 px, le doigt ou le gant ne vise pas un sommet au pixel près).
 */
export const MEASURE_SNAP_PX = 18;

/**
 * Un point posé à moins de ce nombre de pixels ÉCRAN du dernier sommet n'en pose
 * pas un autre (retours terrain 2026-10-02) : c'est le 2e clic d'un double-clic,
 * que le système tolère à quelques pixels du 1er. Moitié du rayon de l'aimant.
 */
export const MEASURE_DUP_PX = MEASURE_SNAP_PX / 2;

export const MeasureMethods = {
    /** Démarre une nouvelle mesure (réinitialise l'état + UI). */
    // planMap.js:2297-2312 — retours terrain 2026-10-02 : `snap`, désélection, hint
    _startMeasure(this: PlanMapInternal, isMobile: boolean): void {
        this._clearMeasureState();
        this._measureState = {
            vertices: [],
            cursor: null,
            // Réticule de précision sous les gants : présent dès qu'il y a du tactile.
            reticle: !!(isMobile || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)),
            // Aimant actif par défaut ; le bouton « Aimant » de la barre le coupe.
            snap: true,
        };
        // Les dessins ne captent plus le toucher pendant la mesure : une forme
        // restée sélectionnée garderait ses poignées, sa roue et son pincement.
        this._deselectShape();
        // Leurs cadenas (marqueurs DOM posés sur la carte) captent aussi le toucher :
        // inertes tant que `_measureState` existe (`_renderShapeLocks`).
        this._renderShapeLocks();
        // Réticule central réutilisé (le même que le mode précision dessin).
        const crosshair = document.getElementById('plan_draw_crosshair');
        if (crosshair) crosshair.classList.toggle('active', this._measureState.reticle);
        const viewPlan = document.getElementById('view-plan');
        if (viewPlan && this._measureState.reticle) viewPlan.classList.add('drawing-active');
        this._buildMeasureControls();
        this._renderMeasurePreview();
        this._showHint('Mesure : touche la carte pour poser des points. « Valider la ligne » la fige.');
    },

    /** Ajoute un sommet à la mesure en cours. */
    // planMap.js:2316-2327 — retours terrain 2026-10-02 : un point posé efface la lecture d'un dessin ;
    // le 2e clic d'un double-clic n'en pose pas
    _measureAddVertex(this: PlanMapInternal, lngLat: LngLatTuple): void {
        const st = this._measureState;
        if (!st) return;
        // Évite les doublons exacts (double-événement tactile).
        const last = st.vertices[st.vertices.length - 1];
        if (last && last[0] === lngLat[0] && last[1] === lngLat[1]) return;
        // Double-clic : MapLibre envoie click, click, dblclick, et le 2e clic tombe à quelques
        // pixels du 1er. Il poserait un 2e sommet, et le dblclick validerait alors une ligne de
        // ~0 m (shape persistée, entrée d'historique, étiquette « 0 m »). La proximité se juge
        // ICI, à la pose, au zoom où le point est visé : à la validation, un dézoom aurait
        // rapproché des sommets voulus et la ligne se serait perdue en silence.
        if (last && this.map) {
            const map = this.map;
            const a = map.project({ lng: last[0], lat: last[1] });
            const b = map.project({ lng: lngLat[0], lat: lngLat[1] });
            if (Math.hypot(a.x - b.x, a.y - b.y) < MEASURE_DUP_PX) return;
        }
        // `.slice()` sur un tuple élargit en `number[]` (TS) : cast déjà pratiqué
        // pour la même raison dans legacy.ts (SPEC-PLANMAP-SPLIT §6.3).
        st.vertices.push(lngLat.slice() as LngLatTuple);
        st.cursor = lngLat.slice() as LngLatTuple;
        this._measureShowInfo('');
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** Met à jour le segment élastique vers le curseur (preview live). */
    // planMap.js:2329-2335 — retours terrain 2026-10-02 : le curseur s'accroche
    _measureUpdateCursor(this: PlanMapInternal, lngLat: LngLatTuple): void {
        const st = this._measureState;
        if (!st || !st.vertices.length) return;
        st.cursor = this._measureSnapTarget(lngLat) ?? (lngLat.slice() as LngLatTuple);
        this._renderMeasurePreview();
    },

    /** Position courante du réticule (centre de carte) pour la pose mobile. */
    // planMap.js:2337-2340 — retours terrain 2026-10-02 : le réticule s'accroche
    _measureReticlePoint(this: PlanMapInternal): LngLatTuple {
        // TS strict : garde absente de l'original, ajoutée pour le typage
        // (`this.map` garanti non-null pendant tout le cycle de vie d'une
        // mesure — seuls des appelants ayant déjà vérifié `this.map`, ou
        // exécutant dans une session de mesure active, invoquent cette
        // méthode ; même principe que draw-layers.ts:301-302). Repli neutre
        // en observable : ce chemin n'est jamais emprunté en pratique.
        if (!this.map) return [0, 0];
        const c = this.map.getCenter();
        const center: LngLatTuple = [c.lng, c.lat];
        // Aimant : en mode réticule, c'est CE point (aperçu, « Point », sommet
        // implicite de « Valider la ligne ») qui s'accroche, comme un clic.
        return this._measureSnapTarget(center) ?? center;
    },

    /**
     * Sommet de dessin ou pion à moins de `MEASURE_SNAP_PX` pixels écran de
     * `lngLat`, le plus proche, rendu en COPIE exacte de ses coordonnées ; sinon
     * `null` (aucun candidat assez près, aimant coupé, pas de carte). Candidats :
     * cf. `snapCandidates` (geo.ts). Retours terrain 2026-10-02, décision 2.
     */
    // ponytail: relit formes et pions dans le stockage et projette chaque candidat à
    // chaque appel (souris : à chaque `mousemove`, réticule : à chaque `move`). Les
    // traits n'offrent que leurs 2 extrémités, donc le coût suit le nombre de
    // formes, pas de points ; au-delà de quelques centaines de formes, mettre la
    // liste en cache (invalidée par `_renderShapes`) et la préfiltrer par boîte lng/lat.
    _measureSnapTarget(this: PlanMapInternal, lngLat: LngLatTuple): LngLatTuple | null {
        const st = this._measureState;
        if (!st || !this.map || st.snap === false) return null;
        const candidates = snapCandidates(this._loadShapes(), this._loadPins());
        if (!candidates.length) return null;
        const map = this.map;
        const here = map.project({ lng: lngLat[0], lat: lngLat[1] });
        let best: LngLatTuple | null = null;
        let bestPx = MEASURE_SNAP_PX;
        for (const c of candidates) {
            const p = map.project({ lng: c[0], lat: c[1] });
            const d = Math.hypot(p.x - here.x, p.y - here.y);
            if (d <= bestPx) { best = c; bestPx = d; }
        }
        return best ? [best[0], best[1]] : null;
    },

    /**
     * Toucher ou clic carte en mode mesure (câblé par `_onMapClick`, pins.ts).
     * L'aimant passe d'abord : près d'un sommet de dessin ou d'un pion, le point
     * s'y accroche et démarre ou prolonge la ligne. Sinon, SANS ligne en cours,
     * toucher le CONTOUR d'un trait, d'un rectangle ou d'un cercle affiche sa
     * mesure dans la barre sans poser de point (aimant coupé : lecture sur tout
     * le contour). Tout le reste pose un sommet, l'intérieur d'une zone dessinée
     * compris. Retours terrain 2026-10-02, décisions 1, 2 et 3.
     */
    _measureClick(this: PlanMapInternal, lngLat: LngLatTuple, point: PointLike): void {
        const st = this._measureState;
        if (!st) return;
        const snapped = this._measureSnapTarget(lngLat);
        if (!snapped && !st.vertices.length && this.map) {
            let text = '';
            try {
                // Le contour seulement : la couche 'plan-shapes-line-hit' borde aussi les rectangles et les
                // cercles. Le remplissage ('plan-shapes-fill') couvre TOUT l'intérieur d'une zone dessinée
                // (bouclage, périmètre) : s'il valait lecture, on n'y poserait plus jamais de point.
                const hits = this.map.queryRenderedFeatures(point, { layers: ['plan-shapes-line-hit'] });
                const shapes = this._loadShapes();
                // Les mesures posées et les anneaux n'ont pas de `shapeId` : ils ne se lisent pas.
                for (const f of hits) {
                    const shape = shapes.find((x) => x.id === f.properties?.shapeId);
                    text = shape ? shapeMeasureText(shape) : '';
                    if (text) break;
                }
            } catch { /* style pas encore chargé : on retombe sur la pose d'un point */ }
            if (text) { this._measureShowInfo(text); return; }
        }
        this._measureAddVertex(snapped ?? lngLat);
    },

    /** Affiche (ou, texte vide, masque) la lecture d'un dessin dans la barre de mesure. */
    _measureShowInfo(this: PlanMapInternal, text: string): void {
        const info = this._measureControls?.querySelector<HTMLElement>('[data-measure="info"]');
        if (!info) return;
        info.textContent = text;
        info.hidden = !text;
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

        // Déclinaison calculée UNE fois au point de départ (décision 35) :
        // le WMM varie trop lentement pour justifier un calcul par segment.
        const start = pts[0];
        const decl = start ? magneticDeclination(start[1], start[0]) : null;

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
            const segTxt = `${this._formatDistance(dist)} · ${formatAzimuth(az, decl)}`;
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
    // planMap.js:2437-2483 — retours terrain 2026-10-02 : lecture d'un dessin, « Valider la ligne », « Aimant »
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
            position: absolute; left: 8px; right: 8px; bottom: 18px;
            width: fit-content; margin-inline: auto;
            display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; z-index: 12;
            background: rgba(10,12,16,0.82);
            padding: 6px; border-radius: 14px;
            box-shadow: 0 4px 18px rgba(0,0,0,0.55);
            backdrop-filter: blur(4px);
        `;
        const mkBtn = (label: string, icon: string, bg: string, fg: string, onClick: () => void, key: string): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            // Repère stable : `_updateMeasureControls` y retrouve les boutons dont l'état change.
            b.dataset.measure = key;
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
        // Lecture d'un dessin touché : une ligne pleine largeur au-dessus des
        // boutons, masquée tant que rien n'est lu (`_measureShowInfo`).
        const info = document.createElement('div');
        info.dataset.measure = 'info';
        info.setAttribute('role', 'status');
        info.hidden = true;
        info.style.cssText = `
            flex: 1 0 100%; text-align: center; padding: 2px 8px;
            color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.9);
            font-family: var(--font-data, ui-monospace, monospace);
            font-size: 13px; font-weight: 700;
        `;
        bar.appendChild(info);
        // Bouton « Point » : ne s'affiche qu'avec réticule (pose sous gants).
        if (st && st.reticle) {
            this._measurePointBtn = mkBtn('Point', 'add_location_alt', '#3b82f6', '#fff',
                () => this._measureAddVertex(this._measureReticlePoint()), 'point');
            bar.appendChild(this._measurePointBtn);
        }
        this._measureUndoBtn = mkBtn('Annuler dernier', 'undo', 'rgba(120,120,120,0.95)', '#fff',
            () => this._measureUndoVertex(), 'undo');
        bar.appendChild(this._measureUndoBtn);
        bar.appendChild(mkBtn('Valider la ligne', 'check', '#22c55e', '#000', () => this._finishMeasure(), 'finish'));
        bar.appendChild(mkBtn('Aimant', 'filter_center_focus', '#f59e0b', '#000', () => {
            const cur = this._measureState;
            if (!cur) return;
            cur.snap = cur.snap === false;   // absent ou actif → coupé ; coupé → actif
            this._renderMeasurePreview();    // le point vivant (réticule) se recale aussitôt
            this._updateMeasureControls();
        }, 'snap'));
        bar.appendChild(mkBtn('Quitter', 'close', 'rgba(239,68,68,0.95)', '#fff', () => this._cancelMeasure(), 'quit'));
        parent.appendChild(bar);
        this._measureControls = bar;
        // Le dock de dessin passait sous la barre : masqué le temps de la
        // mesure (la barre porte Valider la ligne et Quitter), rendu par _removeMeasureControls.
        const dock = document.getElementById('plan_draw_dock');
        if (dock) dock.hidden = true;
        this._updateMeasureControls();
    },

    // planMap.js:2484-2489 — retours terrain 2026-10-02 : « Valider la ligne », état de « Aimant »
    _updateMeasureControls(this: PlanMapInternal): void {
        const st = this._measureState;
        const n = st ? st.vertices.length : 0;
        // « Annuler dernier » et « Valider la ligne » ne servent qu'avec une ligne en cours.
        const withLine = n >= 1 ? 'inline-flex' : 'none';
        if (this._measureUndoBtn) this._measureUndoBtn.style.display = withLine;
        const part = (key: string): HTMLElement | null | undefined => this._measureControls?.querySelector<HTMLElement>(`[data-measure="${key}"]`);
        const finish = part('finish');
        if (finish) finish.style.display = withLine;
        // « Aimant » : actif tant que le champ n'a pas été coupé (mesure ouverte sans `snap` = actif).
        const snap = part('snap');
        if (snap) {
            const on = !st || st.snap !== false;
            snap.setAttribute('aria-pressed', String(on));
            snap.title = on
                ? 'Aimant actif : les points s\'accrochent aux sommets des dessins et aux pions'
                : 'Aimant coupé : les points se posent là où tu touches';
            snap.style.background = on ? '#f59e0b' : 'rgba(120,120,120,0.95)';
            snap.style.color = on ? '#000' : '#fff';
            // Pas la couleur seule (plein soleil, gants) : « Aimant » est barré une fois coupé.
            snap.style.textDecoration = on ? 'none' : 'line-through';
        }
    },

    // planMap.js:2490-2496
    _removeMeasureControls(this: PlanMapInternal): void {
        if (this._measureControls) { try { this._measureControls.remove(); } catch { /* déjà retiré du DOM — sans effet */ } this._measureControls = null; }
        this._measurePointBtn = null;
        this._measureUndoBtn = null;
        const dock = document.getElementById('plan_draw_dock');
        if (dock) dock.hidden = false;
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

    /**
     * Valide la ligne en cours : persiste un shape type:'measure' s'il y a >= 2
     * sommets, puis repart d'une ligne vide. L'outil RESTE actif (retours terrain
     * 2026-10-02) : le toucher suivant démarre une nouvelle ligne, de n'importe où ;
     * seul « Quitter » (`_cancelMeasure`) en sort.
     */
    // planMap.js:2506-2537 — retours terrain 2026-10-02 : ne quitte plus le mode
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
        // La ligne est figée (ou abandonnée si < 2 points) : l'état repart à vide,
        // et une lecture de dessin restée affichée n'a plus lieu d'être.
        st.vertices = [];
        st.cursor = null;
        this._measureShowInfo('');
        if (verts.length >= 2) {
            const total = this._measureTotalMeters(verts);
            const shape: PlanShape = {
                id: 'shape_' + Date.now(),
                type: 'measure',
                color: this.drawColor,
                coords: verts,
                totalM: total,
            };
            // Persiste sans passer par _finishShape (qui sélectionne la forme et
            // déclencherait des handles ; la mesure est une annotation non sélectionnable).
            // Une ligne validée = UNE entrée d'historique.
            this._pushHistory();
            const list = this._loadShapes();
            list.push(shape);
            this._saveShapes(list);
            this._renderShapes();
            this._refreshUndoRedoButtons();
        }
        // Efface la preview pointillée et les étiquettes live (vertices vides) ;
        // le tracé plein et ses étiquettes viennent de `_renderShapes`.
        this._renderMeasurePreview();
        this._updateMeasureControls();
    },

    /** « Quitter » : abandonne la ligne en cours (rien de persisté) et revient au mode contrôle carte. */
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
        // `_measureState` est vidé (et `drawTool` change juste après, dans `_setTool`) : les
        // cadenas des formes reprennent le toucher (`_renderShapeLocks`).
        this._renderShapeLocks();
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
