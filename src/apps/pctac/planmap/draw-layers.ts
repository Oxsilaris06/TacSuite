/**
 * draw-layers.ts — Sources/couches GeoJSON de dessin, dock de dessin, long-press
 * création de ping (P2.CONV, paquet `pm-drawlayers`).
 * ===========================================================================
 *
 * 3 méthodes de `PlanMap` (SPEC-PLANMAP-SPLIT.md §4.7) :
 *   - `_initDrawingLayers` (planMap.js:1665) : couche bâtiments 3D + sources/
 *     couches GeoJSON "committed" (dessins persistés) et "preview" (dessin en
 *     cours), gestes pointerdown sur les formes, re-render des textes au
 *     zoom/déplacement, désélection au clic vide, câblage du long-press.
 *   - `_bindDrawUi` (planMap.js:1829) : câblage du dock de dessin (outils,
 *     couleurs, effacer, undo/redo, verrou, diamètre, boutons de précision
 *     tactique), raccourcis clavier de la vue Plan.
 *   - `_wireLongPressForPing` (planMap.js:4863) : détecteur d'appui long façon
 *     Google Maps → ouvre la roue de création de ping.
 *
 * ⚠ INVARIANT (SPEC-PLANMAP-SPLIT §1.2 piège 1) : `_initDrawingLayers` fixe
 * l'ORDRE des `addSource`/`addLayer` (empilement visuel) et la couche de
 * bâtiments 3D. NE RÉORDONNE RIEN, ne renomme aucun id de source ni de couche
 * — ils sont référencés par nom depuis 5 autres sous-modules (shapes-render,
 * shapes-gestures, draw-tools, measure, capture).
 *
 * ⚠ INVARIANT (piège 2) : `_handleDrawMove`/`_handleDrawUp` (déclarées dans
 * `draw-tools.ts`) sont appelées ici avec un OBJET SYNTHÉTIQUE `{ lngLat: … }`
 * et non un événement MapLibre (planMap.js:1908, 1916, 1943) — conservé
 * exactement tel quel.
 *
 * ⚠ Écart constaté avec la mission : contrairement à ce qu'indiquait le brief,
 * `_wireLongPressForPing` n'utilise PAS `@shared/ui-platform` (`onLongPress`).
 * Vérifié par lecture intégrale de planMap.js:4863-4951 (et de `_bindDrawUi`
 * pour le long-press du bouton mesure) : aucune référence à `UIPlatform` ni à
 * `onLongPress` dans ces deux corps — ils sont câblés à la main sur les
 * événements MapLibre / pointer avec un timer `setTimeout`. Aucun import de
 * `@shared/ui-platform.js` n'est donc ajouté ici (un import inutilisé
 * échouerait le lint). Signalé au gate.
 *
 * TypeScript strict : `this.map` est typé `MapLibreMap | null`, mais ces 3
 * méthodes ne sont appelées qu'après l'affectation de `this.map`
 * (`_initDrawingLayers`/`_bindDrawUi` : handler `map.on('load', …)` de
 * `_bindUi`, planMap.js:401-407 ; `_wireLongPressForPing` : appelée depuis
 * `_initDrawingLayers`, planMap.js:1820). Les gardes `if (!this.map) return;`
 * ajoutées ci-dessous sont des adaptations de TYPAGE PUR (absentes de
 * l'original, jamais déclenchées en pratique) — même principe que
 * `planmap/legacy.ts` (`_startTransform`, planMap.js:4350) qui ajoute la même
 * garde absente de l'original pour la même raison. La capture en `const map =
 * this.map;` sert à faire traverser le narrowing non-null aux fermetures
 * imbriquées (callbacks `map.on(...)`), où `this.map` ne serait pas re-narrowé.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import type {
    MapLayerMouseEvent,
    MapLayerTouchEvent,
    MapMouseEvent,
    MapTouchEvent,
    PointLike,
} from 'maplibre-gl';

import type { LngLatObj, LngLatTuple, PlanMapInternal, PlanMapState } from './types.js';

export const DrawLayersMethods = {
    // planMap.js:1665-1827
    _initDrawingLayers(this: PlanMapInternal): void {
        if (!this.map) return;
        const map = this.map;

        // --- Bâtiments 3D (extrusion IGN BD TOPO : emprises + hauteurs LiDAR HD) ---
        // Masqués par défaut, activés avec le mode 3D. Ajoutés en premier
        // pour rester sous les dessins/annotations.
        try {
            map.addLayer({
                id: 'buildings-3d',
                type: 'fill-extrusion',
                source: 'bdtopo',
                'source-layer': 'batiment',
                minzoom: 13,
                filter: ['!=', ['get', 'etat_de_l_objet'], 'En projet'],
                layout: { visibility: 'none' },
                paint: {
                    'fill-extrusion-color': '#c2cad2',
                    // Hauteur : priorité au delta d'altitudes LiDAR HD (toit - sol) ;
                    // sinon champ 'hauteur' (peu rempli) ; sinon étages × 3 m ; sinon 6 m.
                    'fill-extrusion-height': [
                        'case',
                        ['all', ['has', 'altitude_maximale_toit'], ['has', 'altitude_minimale_sol']],
                            ['max', 2, ['-', ['get', 'altitude_maximale_toit'], ['get', 'altitude_minimale_sol']]],
                        ['has', 'hauteur'], ['max', 2, ['get', 'hauteur']],
                        ['has', 'nombre_d_etages'], ['*', ['get', 'nombre_d_etages'], 3],
                        6,
                    ],
                    'fill-extrusion-base': 0,
                    'fill-extrusion-opacity': 0.85,
                },
            });
        } catch (e) {
            console.error('[PlanMap] couche bâtiments 3D échec:', e);
        }

        // Source "committed" (dessins persistés)
        map.addSource('plan-shapes-src', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
            id: 'plan-shapes-fill',
            type: 'fill',
            source: 'plan-shapes-src',
            // Polygones (rect/circle) mais pas les "hit zones" des annotations texte
            filter: ['all',
                ['==', ['geometry-type'], 'Polygon'],
                ['!=', ['get', 'isText'], true],
            ],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'fill-opacity': 0.18,
            },
        });
        map.addLayer({
            id: 'plan-shapes-line-hit',
            type: 'line',
            source: 'plan-shapes-src',
            filter: ['!=', ['get', 'isText'], true],
            paint: {
                'line-color': '#000',
                'line-width': 28,
                'line-opacity': 0,
            },
        });
        map.addLayer({
            id: 'plan-shapes-line',
            type: 'line',
            source: 'plan-shapes-src',
            // Lignes uniquement (pas les zones hit-test des textes)
            filter: ['!=', ['get', 'isText'], true],
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                // Épaisseur pilotée par la donnée (réglable via la roue : Épaisseur -/+)
                'line-width': ['coalesce', ['get', 'strokeWidth'], 3],
                'line-opacity': 0.9,
            },
        });
        // Hit-test invisible pour les annotations texte libres
        map.addLayer({
            id: 'plan-shapes-text-hit',
            type: 'fill',
            source: 'plan-shapes-src',
            filter: ['==', ['get', 'isText'], true],
            paint: { 'fill-color': '#000', 'fill-opacity': 0 },
        });

        // Source "preview" (dessin en cours)
        map.addSource('plan-draw-preview-src', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
            id: 'plan-draw-preview-fill',
            type: 'fill',
            source: 'plan-draw-preview-src',
            filter: ['in', ['geometry-type'], ['literal', ['Polygon']]],
            paint: {
                'fill-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'fill-opacity': 0.12,
            },
        });
        map.addLayer({
            id: 'plan-draw-preview-line',
            type: 'line',
            source: 'plan-draw-preview-src',
            paint: {
                'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.9,
            },
        });

        // Gestes sur formes : pointerdown unifié → décide tap (menu) vs drag (déplacement)
        //  - Tap court & immobile → menu contextuel (Déplacer/Redim/Texte/Suppr)
        //  - Drag (mouvement > 6px) → déplacement direct, mobile + PC
        //  - Sans hit sur une forme → la carte panote normalement (maplibre natif)
        const layers = ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit'];
        layers.forEach(layerId => {
            map.on('mousedown', layerId, this._safe((e: MapLayerMouseEvent | MapLayerTouchEvent) => this._shapePointerDown(e), 'shapeDown'));
            map.on('touchstart', layerId, this._safe((e: MapLayerMouseEvent | MapLayerTouchEvent) => this._shapePointerDown(e), 'shapeDown'));
            // Curseur indicatif au survol
            map.on('mouseenter', layerId, () => {
                if (!this.drawTool && !this.moveState && !this._gesture) map.getCanvas().style.cursor = 'grab';
            });
            map.on('mouseleave', layerId, () => {
                if (!this.drawTool && !this.moveState && !this._gesture) map.getCanvas().style.cursor = '';
            });
        });

        // Re-render des textes quand le zoom/move change (les bornes pixel évoluent)
        let textsTick: number | null = null;
        const scheduleTexts = () => {
            if (textsTick) return;
            textsTick = requestAnimationFrame(() => {
                textsTick = null;
                this._renderShapeTexts();
                this._renderDiameters();
            });
        };
        map.on('zoom', scheduleTexts);
        map.on('move', scheduleTexts);

        // Tap court sur zone vide → désélectionne uniquement.
        // Pour créer un ping : long-press (500 ms) ou FAB add_location.
        map.on('click', (e) => {
            if (this.drawTool || this.moveState || this._gesture) return;
            if (this._wheelJustClosed && Date.now() - this._wheelJustClosed < 250) return;
            // Zone de détection à tolérance tactile (±12px autour du point de clic)
            const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
                [e.point.x - 12, e.point.y - 12],
                [e.point.x + 12, e.point.y + 12],
            ];
            const hits = map.queryRenderedFeatures(bbox, {
                layers: ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit'],
            });
            if (hits.length) return;
            if (this._selectedShapeId) this._deselectShape();
        });

        // Long-press sur zone vide → ouvre la roue de création de ping (Google Maps style).
        this._wireLongPressForPing();
        // Échap → désélectionne
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._selectedShapeId && !this.moveState && !this._gesture) {
                this._deselectShape();
            }
        });
    },

    // planMap.js:1829-1961
    _bindDrawUi(this: PlanMapInternal): void {
        document.querySelectorAll<HTMLElement>('.plan-draw-btn').forEach(btn => {
            // data-tool est toujours présent sur ces boutons du dock (markup statique,
            // cf. pctac/index.html) : cast typé, aucune valeur `undefined` réelle à
            // l'exécution — cf. SPEC-PCTAC-CONVERSION.md §2.6 (any interdit, pas `!`).
            btn.onclick = () => this._setTool(btn.dataset.tool as PlanMapState['drawTool']);
        });
        // Clic long sur l'outil MESURE → anneaux d'engagement 50/100/200 m
        // (réutilise le centre de carte). N'altère pas le clic court (= outil mesure).
        const measureBtn = document.querySelector<HTMLElement>('.plan-draw-btn[data-tool="measure"]');
        if (measureBtn) {
            measureBtn.title = 'Mesurer distance / azimut — appui long : anneaux d\'engagement 50/100/200 m';
            let lpTimer: ReturnType<typeof setTimeout> | null = null, lpFired = false;
            const startLp = () => {
                lpFired = false;
                lpTimer = setTimeout(() => {
                    lpFired = true;
                    // Si une mesure est active, on la quitte pour ne pas mélanger les états.
                    if (this.drawTool === 'measure') this._setTool(null);
                    this._addEngagementRings();
                }, 550);
            };
            const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
            measureBtn.addEventListener('pointerdown', this._safe(startLp, 'measureLp:down'));
            measureBtn.addEventListener('pointerup', this._safe(cancelLp, 'measureLp:up'));
            measureBtn.addEventListener('pointerleave', this._safe(cancelLp, 'measureLp:leave'));
            measureBtn.addEventListener('pointercancel', this._safe(cancelLp, 'measureLp:cancel'));
            // Le clic court ne doit pas activer l'outil si le long-press a déjà agi.
            measureBtn.addEventListener('click', (e) => {
                if (lpFired) { e.preventDefault(); e.stopImmediatePropagation(); lpFired = false; }
            }, true);
        }
        document.querySelectorAll<HTMLElement>('.plan-draw-color').forEach(btn => {
            // data-color est toujours présent (palette statique du dock) : fallback ''
            // neutre pour satisfaire le typage strict de `_setDrawColor(color: string)`.
            btn.onclick = () => this._setDrawColor(btn.dataset.color ?? '');
        });
        const clearBtn = document.getElementById('plan_draw_clear');
        if (clearBtn) clearBtn.onclick = () => {
            if (!confirm('Effacer tous les dessins ?')) return;
            this._pushHistory();
            this._saveShapes([]);
            this._renderShapes();
            this._refreshUndoRedoButtons();
        };

        const undoBtn = document.getElementById('plan_draw_undo');
        if (undoBtn) undoBtn.onclick = () => this._undo();
        const redoBtn = document.getElementById('plan_draw_redo');
        if (redoBtn) redoBtn.onclick = () => this._redo();
        this._refreshUndoRedoButtons();

        const diamBtn = document.getElementById('plan_draw_diameter_toggle');
        if (diamBtn) diamBtn.onclick = () => this._toggleGlobalDiameter();

        const lockBtn = document.getElementById('plan_draw_lock');
        if (lockBtn) lockBtn.onclick = () => this._toggleLock();
        this._updateLockButton();

        // Raccordement des boutons de précision tactique (mobile)
        const pStart = document.getElementById('plan_draw_precision_start');
        const pConfirm = document.getElementById('plan_draw_precision_confirm');
        const pCancel = document.getElementById('plan_draw_precision_cancel');

        if (pStart) {
            pStart.onclick = () => {
                if (!this.drawTool) return;
                // TS strict : garde absente de l'original, ajoutée pour le typage
                // (this.map garanti non-null tant que la vue Plan est ouverte).
                if (!this.map) return;
                const map = this.map;
                const center = map.getCenter();
                const lngLat: LngLatTuple = [center.lng, center.lat];

                if (this.drawTool === 'text') {
                    this._addFreeText(center);
                    this._setTool(null);
                    return;
                }

                this.drawState = { start: lngLat, current: lngLat };

                // Afficher Valider / Annuler
                pStart.style.display = 'none';
                if (pConfirm) pConfirm.style.display = 'flex';
                if (pCancel) pCancel.style.display = 'flex';

                // Générer un premier aperçu
                this._handleDrawMove({ lngLat: center });
            };
        }

        if (pConfirm) {
            pConfirm.onclick = () => {
                if (!this.drawTool || !this.drawState) return;
                // TS strict : garde absente de l'original, ajoutée pour le typage.
                if (!this.map) return;
                const center = this.map.getCenter();
                this._handleDrawUp({ lngLat: center });

                // Réinitialiser les états des boutons
                if (pStart) pStart.style.display = 'flex';
                pConfirm.style.display = 'none';
                if (pCancel) pCancel.style.display = 'none';
            };
        }

        if (pCancel) {
            pCancel.onclick = () => {
                this.drawState = null;
                this._clearPreview();
                this._clearLiveDiameter();

                // Réinitialiser les états des boutons
                if (pStart) pStart.style.display = 'flex';
                if (pConfirm) pConfirm.style.display = 'none';
                pCancel.style.display = 'none';
            };
        }

        // Mettre à jour l'aperçu à chaque mouvement de la carte en mode précision
        if (this.map) {
            const map = this.map;
            map.on('move', () => {
                if (this.drawPrecisionMode && this.drawState) {
                    const center = map.getCenter();
                    this._handleDrawMove({ lngLat: center });
                }
                // Mesure au réticule : le segment élastique suit le centre de carte
                // (qui se déplace quand on panote) tant qu'au moins un sommet existe.
                if (this._measureState && this._measureState.reticle && this._measureState.vertices.length) {
                    this._renderMeasurePreview();
                }
            });
        }

        // Échap = quitte l'outil ; Ctrl+Z / Ctrl+Y raccourcis (uniquement sur la vue Plan)
        document.addEventListener('keydown', (e) => {
            const planView = document.getElementById('view-plan');
            if (!planView || !planView.classList.contains('active')) return;
            if (e.key === 'Escape' && this.drawTool) this._setTool(null);
            else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); this._redo(); }
        });
    },

    /**
     * Long-press detector (Google Maps style) : 500 ms d'appui immobile sur zone
     * vide ouvre la roue de création de ping. Annulé dès qu'on bouge (pan), qu'on
     * relâche, ou qu'on touche une forme/ping.
     *
     * Implémente un feedback haptique-visuel : pulse à l'écran quand le timer
     * atteint la moitié, full quand validé.
     */
    // planMap.js:4863-4951
    _wireLongPressForPing(this: PlanMapInternal): void {
        if (!this.map) return;
        const map = this.map;

        const LP_DELAY = 480; // ms
        const LP_TOLERANCE = 8; // px de tolérance
        let lp: {
            startPx: { x: number; y: number };
            startLngLat: LngLatObj;
            ringEl: HTMLDivElement;
            timer: ReturnType<typeof setTimeout>;
        } | null = null; // { startPx, startLngLat, timer, ringEl }

        const cancel = () => {
            if (!lp) return;
            if (lp.timer) clearTimeout(lp.timer);
            if (lp.ringEl) { try { lp.ringEl.remove(); } catch { /* déjà retiré du DOM — sans effet */ } }
            lp = null;
        };
        const isOnFeature = (point: PointLike) => {
            const hits = map.queryRenderedFeatures(point, {
                layers: ['plan-shapes-fill', 'plan-shapes-line-hit', 'plan-shapes-text-hit'],
            });
            return hits.length > 0;
        };
        const showRing = (clientX: number, clientY: number) => {
            const ring = document.createElement('div');
            ring.style.cssText = `
                position: fixed; left: ${clientX}px; top: ${clientY}px;
                width: 12px; height: 12px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                border: 3px solid #3b82f6;
                box-shadow: 0 0 0 0 rgba(59,130,246,0.6);
                pointer-events: none;
                z-index: 9999;
                animation: pctacLpRing ${LP_DELAY}ms linear forwards;
            `;
            document.body.appendChild(ring);
            return ring;
        };
        // Keyframe injecté une fois
        if (!document.getElementById('pctac-lp-ring-style')) {
            const s = document.createElement('style');
            s.id = 'pctac-lp-ring-style';
            s.textContent = `@keyframes pctacLpRing {
                0%   { width: 12px; height: 12px; opacity: 0.4; }
                100% { width: 56px; height: 56px; opacity: 0.95; box-shadow: 0 0 12px 6px rgba(59,130,246,0.45); }
            }`;
            document.head.appendChild(s);
        }

        const start = (e: MapMouseEvent | MapTouchEvent) => {
            if (this.drawTool || this.moveState || this._gesture) return;
            if (this._activeWheel || this._inlinePanel) return;
            const oe = e.originalEvent;
            // Multi-touch (pinch zoom etc.) → on annule le long-press
            // (`'touches' in oe` = équivalent TS-safe de `oe.touches` en duck-typing :
            // `MouseEvent` n'a pas cette propriété, `TouchEvent` oui — narrowing exact)
            if (oe && 'touches' in oe && oe.touches.length > 1) { cancel(); return; }
            if (lp) cancel(); // ne pas empiler
            // Si le pointerdown provient d'un marker DOM (pin, handle, label, toolbar…),
            // ne pas déclencher la création de ping — c'est le marker qui gère.
            // (`instanceof Element` = équivalent TS-safe de
            // `typeof oe.target.closest === 'function'` : seul un `Element` expose `closest`)
            const target = oe && oe.target instanceof Element ? oe.target : null;
            if (target && target.closest('.maplibregl-marker, .plan-wheel, .plan-inline-panel')) return;
            if (isOnFeature(e.point)) return; // forme/ping → priorité au gestionnaire de forme
            const touch = oe && 'touches' in oe ? oe.touches[0] : undefined;
            const clientX = touch ? touch.clientX : (oe && 'clientX' in oe && oe.clientX) || 0;
            const clientY = touch ? touch.clientY : (oe && 'clientY' in oe && oe.clientY) || 0;
            const ringEl = showRing(clientX, clientY);
            lp = {
                startPx: { x: e.point.x, y: e.point.y },
                startLngLat: e.lngLat,
                ringEl,
                timer: setTimeout(() => {
                    if (!lp) return;
                    const ll = lp.startLngLat;
                    cancel();
                    this._openCreatePingWheel(ll);
                }, LP_DELAY),
            };
        };
        const move = (e: MapMouseEvent | MapTouchEvent) => {
            if (!lp) return;
            const dx = e.point.x - lp.startPx.x, dy = e.point.y - lp.startPx.y;
            if (Math.hypot(dx, dy) > LP_TOLERANCE) cancel();
        };

        map.on('mousedown', this._safe(start, 'longpress:start'));
        map.on('touchstart', this._safe(start, 'longpress:start'));
        map.on('mousemove', this._safe(move, 'longpress:move'));
        map.on('touchmove', this._safe(move, 'longpress:move'));
        map.on('mouseup', this._safe(cancel, 'longpress:cancel'));
        map.on('touchend', this._safe(cancel, 'longpress:cancel'));
        map.on('touchcancel', this._safe(cancel, 'longpress:cancel'));
        map.on('dragstart', this._safe(cancel, 'longpress:cancel'));
        map.on('movestart', this._safe(cancel, 'longpress:cancel'));
    },
};
