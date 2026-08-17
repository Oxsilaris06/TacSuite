/**
 * map-core.ts — Cycle de vie carte, vue persistée, 3D/relief, overlay noms de
 * rues, pré-cache France (P2.CONV, paquet `pm-mapcore`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 15 méthodes de `modules/pctac/planMap.js`
 * (GStart-main, lecture seule), table §4.3 de `docs/SPEC-PLANMAP-SPLIT.md` :
 * `init` (:342), `_initOfflineCache` (:424), `refresh` (:441), `_loadView`
 * (:451), `_saveView` (:459), `_toggle3D` (:472), `_enable3D` (:479),
 * `_pinCamera` (:551), `_disable3D` (:597), `_streetLabelPaint` (:628),
 * `_ensureStreetLabelLayers` (:631), `_applyStreetLabelsVisibility` (:668),
 * `_toggleStreetLabels` (:675), `_initStreetLabels` (:683),
 * `_updateStreetLabelsBtn` (:688).
 *
 * ⚠ INVARIANT (SPEC-PLANMAP-SPLIT §5.6) — épinglage caméra 3D dans
 * `_pinCamera` : les SEPT délais `[0, 120, 280, 500, 850, 1300, 1900]` + le
 * `setTimeout(…, 2400)` de désabonnement `idle`, et l'annulation sur
 * `dragstart`/`zoomstart`/`rotatestart` UNIQUEMENT SI `e.originalEvent` est
 * présent (planMap.js:575). Un nouvel appel annule le précédent via
 * `this._pinCancel`. Aucune de ces valeurs n'est modifiée : elles compensent
 * le réglage progressif du terrain 3D (chargement asynchrone du DEM).
 *
 * ⚠ Garde MapLibre (SPEC-PLANMAP-SPLIT §6.2, piège #2 de la mission) :
 * `typeof maplibregl === 'undefined'` (planMap.js:349) devient
 * `typeof maplibregl?.Map !== 'function'` — en ESM `maplibregl` est un
 * import STATIQUE, donc jamais littéralement `undefined` ; le test devient
 * un test de FORME sur `.Map`. Le bloc DOM d'erreur qui suit (message
 * utilisateur) est conservé MOT POUR MOT.
 *
 * TypeScript strict : `this.map` est typé `MapLibreMap | null`. Les accès
 * `this.map.xxx()` restent VERBATIM (sans capture locale) partout où ils
 * restent au niveau séquentiel de la méthode (vérifié : TypeScript conserve
 * le narrowing d'une propriété `this.x` à travers des appels de méthode
 * successifs tant qu'aucune fermeture différée n'y accède). Les DEUX
 * méthodes où l'original capture déjà `const map = this.map;`
 * (`_enable3D`, `_pinCamera`, planMap.js:553, 481) sont portées telles
 * quelles : cette capture est nécessaire ici parce que des fermetures
 * DIFFÉRÉES (`map.once('idle', …)`, `map.on('dragstart', …)`) accèdent à
 * `map` bien après le passage de la garde `if (!this.map) return;` — le
 * narrowing de `this.map` ne traverse PAS une fermeture définie après coup.
 * `_applyStreetLabelsVisibility` (planMap.js:668-674) n'a AUCUNE garde dans
 * l'original ; `if (!this.map) return;` y est ajouté en tête comme pure
 * adaptation de TYPAGE (jamais déclenchée en pratique : les 2 appelants,
 * `_toggleStreetLabels` et `_initStreetLabels`, ne l'invoquent qu'après
 * `init()` réussi) — même principe que draw-layers.ts.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type {
    AddLayerObject,
    LngLat,
    MapLibreEvent,
    MapMouseEvent,
    MapTouchEvent,
    SkySpecification,
} from 'maplibre-gl';

import {
    CONTOURS_KEY,
    LIDAR_HD_LAYERS,
    LIDAR_KEY,
    LIDAR_LAYER_IDS,
    LIDAR_OPACITY_OVER_IMAGERY,
    LIDAR_OPACITY_OVER_TOPO,
    PLANIGN_KEY,
    RASTER_STYLE,
    VIEW_KEY,
} from './constants.js';
import { prefetchFranceTiles } from './tiles.js';
import type { LidarLayerId, PlanMapInternal, PlanView } from './types.js';
import { toast } from '@shared/feedback.js';

export const MapCoreMethods = {
    // planMap.js:342-415
    init(this: PlanMapInternal): void {
        if (this.initialized) return;
        const mapEl = document.getElementById('plan_map');
        if (!mapEl) return;

        // planMap.js:349-354 — garde MapLibre, cf. note de tête de fichier
        // (piège #2) : le bloc DOM d'erreur est conservé mot pour mot.
        if (typeof maplibregl?.Map !== 'function') {
            console.error('[PlanMap] MapLibre indisponible (CDN ?).');
            mapEl.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; padding:24px; text-align:center; color:var(--text-muted,#9aa4b2); font-family:var(--font-ui,sans-serif);">'
                + 'Carte indisponible : la librairie cartographique n\'a pas pu être chargée (réseau ?).<br>Reconnecte-toi puis recharge la page.</div>';
            return;
        }

        // Restaure l'état de verrouillage (position des pings/dessins figée).
        try { this._locked = localStorage.getItem('pcTacPlanLocked') === '1'; } catch { this._locked = false; }

        const savedView = this._loadView();
        this.map = new maplibregl.Map({
            container: 'plan_map',
            style: RASTER_STYLE,
            center: savedView.center,
            zoom: savedView.zoom,
            pitch: savedView.pitch || 0,
            bearing: savedView.bearing || 0,
            preserveDrawingBuffer: true // requis pour la capture screenshot
        });
        // NavigationControl avec boussole + bouton pitch visualisé
        this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

        this.map.on('moveend', this._safe(() => this._saveView(), 'moveend'));
        this.map.on('pitchend', this._safe(() => this._saveView(), 'pitchend'));
        this.map.on('rotateend', this._safe(() => this._saveView(), 'rotateend'));

        // Restaurer le relief 3D si la vue sauvegardée était inclinée
        if (savedView.is3D) {
            this.map.on('load', this._safe(() => this._enable3D(false), 'load:3D'));
        }
        this.map.on('click', this._safe((e: MapMouseEvent) => this._onMapClick(e), 'mapClick'));
        // Double-clic : termine une mesure en cours (sinon comportement zoom natif).
        this.map.on('dblclick', this._safe((e: MapMouseEvent) => {
            if (this.drawTool === 'measure' && this._measureState) {
                if (e.preventDefault) e.preventDefault();
                if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
                this._finishMeasure();
            }
        }, 'mapDblClick'));

        // Drag-to-draw (mousedown / move / up) — souris ET tactile
        this.map.on('mousedown', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('mousemove', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('mouseup',   this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawUp(e), 'drawUp'));
        this.map.on('touchstart',this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('touchmove', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('touchend',  this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawUp(e), 'drawUp'));

        this._bindUi();

        this.map.on('load', () => {
            this._initDrawingLayers();
            this._bindDrawUi();
            this._bindTextModalOnce();
            this._renderShapes();
            this._renderShapeTexts();
            this._initStreetLabels();
            // Le fond AVANT l'ombrage : `_applyLidarVisibility` lit `planIgnOn`
            // pour choisir l'opacité, il doit donc déjà être restauré.
            this._initTopoLayers();
            this._initLidar();
        });

        this._renderPins();
        this.initialized = true;

        // Cache cartographique hors-ligne : pré-chargement automatique en tâche de fond.
        this._initOfflineCache();
    },

    /* ----- CACHE CARTOGRAPHIQUE HORS-LIGNE (Proposition 3) ----- */

    /**
     * Chargement cartographique hors-ligne EN TÂCHE DE FOND (aucun bouton).
     * Au premier passage en ligne, met en cache la pyramide France (zoom 0→8 :
     * vue nationale + détail régional opérationnel), silencieusement et une seule fois.
     */
    // planMap.js:424-438
    _initOfflineCache(this: PlanMapInternal): void {
        try {
            const cached = localStorage.getItem('pcTacFranceTilesCached') === '1';
            if (cached || !navigator.onLine || typeof caches === 'undefined') return;
            prefetchFranceTiles(0, 8).then(r => {
                // Ne marquer "complet" que si AUCUNE tuile n'a échoué : sinon on
                // retentera au prochain lancement (correction de la pose
                // inconditionnelle qui figeait un cache partiel/cassé).
                if (r && r.fail === 0) {
                    try { localStorage.setItem('pcTacFranceTilesCached', '1'); } catch {}
                }
                console.log('[PlanMap] Carte France pré-cache (tâche de fond) :', r);
            }).catch(e => console.warn('[PlanMap] auto-cache France échoué:', e));
        } catch { /* localStorage / caches indispo : non bloquant */ }
    },

    /** Appelé à chaque switch sur la vue Plan (resize quand le conteneur devient visible) */
    // planMap.js:441-449
    refresh(this: PlanMapInternal): void {
        if (!this.initialized) {
            this.init();
            return;
        }
        // Quand la vue passe de display:none → block, maplibre a besoin d'un resize
        setTimeout(() => this.map && this.map.resize(), 50);
        this._renderPins();
    },

    // planMap.js:451-457
    _loadView(this: PlanMapInternal): PlanView {
        try {
            // Adaptation TS nécessaire (non listée aux pièges de la mission, requise
            // pour un `tsc --noEmit` vide) : `JSON.parse` exige un argument `string`,
            // `localStorage.getItem` renvoie `string | null`. `JSON.parse(null)`
            // coercerait `null` en la chaîne "null" au runtime et retournerait `null`
            // — valeur absorbée par la garde `if (v && v.center...)` ci-dessous, donc
            // neutraliser ce cas AVANT l'appel produit exactement le même
            // comportement observable (même principe que `coordAt`, SPEC-PLANMAP-SPLIT §6.3).
            const raw = localStorage.getItem(VIEW_KEY);
            const v = raw === null ? null : JSON.parse(raw);
            if (v && v.center && Array.isArray(v.center)) return v;
        } catch {}
        return { center: [2.3522, 48.8566], zoom: 5 }; // Paris par défaut, vue France
    },

    // planMap.js:459-469
    _saveView(this: PlanMapInternal): void {
        if (!this.map) return;
        const c = this.map.getCenter();
        localStorage.setItem(VIEW_KEY, JSON.stringify({
            center: [c.lng, c.lat],
            zoom: this.map.getZoom(),
            pitch: this.map.getPitch(),
            bearing: this.map.getBearing(),
            is3D: this.is3D
        }));
    },

    /** Bascule 2D <-> 3D relief */
    // planMap.js:472-475
    _toggle3D(this: PlanMapInternal): void {
        if (this.is3D) this._disable3D();
        else this._enable3D(true);
    },

    /** Active le relief 3D (terrain DEM + ciel + inclinaison caméra).
     *  @param animate - true = incline à 60° si à plat, false = garde le pitch courant */
    // planMap.js:479-542
    _enable3D(this: PlanMapInternal, animate = true): void {
        if (!this.map) return;
        const map = this.map;

        // CIBLE caméra figée AVANT toute modif. C'est le contrat : la vue 3D doit
        // rester EXACTEMENT sur cette zone de focus.
        const target = {
            center:  map.getCenter(),
            zoom:    map.getZoom(),
            bearing: map.getBearing(),
            pitch:   animate ? (map.getPitch() < 20 ? 60 : map.getPitch()) : map.getPitch()
        };

        // Anti-collision : tue toute animation caméra en cours (un easeTo précédent,
        // un double-clic sur le bouton…) avant de toucher au terrain.
        try { map.stop(); } catch {}

        try {
            map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });
        } catch (e) {
            console.error('[PlanMap] setTerrain échec:', e);
            toast('Relief 3D indisponible (réseau ?). Les tuiles d\'élévation AWS sont peut-être bloquées.', { kind: 'error' });
            return;
        }
        // Ciel atmosphérique (si supporté par la version MapLibre)
        try {
            if (typeof map.setSky === 'function') {
                map.setSky({
                    'sky-color': '#7ab8e6',
                    'sky-horizon-blend': 0.6,
                    'horizon-color': '#dfeefc',
                    'horizon-fog-blend': 0.6,
                    'fog-color': '#cfd8e0',
                    'fog-ground-blend': 0.4
                });
            }
        } catch { /* ciel optionnel, on ignore */ }

        // Afficher les bâtiments 3D
        try {
            if (map.getLayer('buildings-3d')) {
                map.setLayoutProperty('buildings-3d', 'visibility', 'visible');
            } else {
                // Restauration 3D au boot : la couche buildings-3d est créée par le
                // handler 'load' suivant (_initDrawingLayers) — on re-tente à l'idle.
                map.once('idle', this._safe(() => {
                    if (this.is3D && map.getLayer('buildings-3d')) {
                        map.setLayoutProperty('buildings-3d', 'visibility', 'visible');
                    }
                }, '3d:deferredBuildings'));
            }
        } catch { /* couche absente si init échouée */ }

        this.is3D = true;
        const fab = document.getElementById('plan_btn_3d');
        if (fab) fab.classList.add('active');

        // ÉPINGLAGE : on impose la cible immédiatement (jumpTo instantané, donc rien
        // à "bousculer"), puis on la ré-impose pendant que le DEM se charge en async
        // (c'est lui qui, en arrivant, reframe/recule la vue). Annulé dès interaction.
        this._pinCamera(target);

        this._saveView();
    },

    /**
     * Maintient la caméra EXACTEMENT sur `target` (center/zoom/bearing/pitch) malgré le
     * reframe asynchrone provoqué par le chargement du terrain (DEM). On réimpose la
     * cible à plusieurs reprises (le DEM arrive surtout dans la 1ʳᵉ seconde) jusqu'à
     * stabilisation. Tout est annulé à la PREMIÈRE interaction utilisateur, et un nouvel
     * appel annule l'épinglage précédent (pas de handlers qui s'accumulent).
     */
    // planMap.js:551-595 — INVARIANT § 5.6 : ne modifier NI les 7 délais, NI le
    // délai de désabonnement 2400ms, NI la garde `e.originalEvent` sur l'annulation.
    _pinCamera(this: PlanMapInternal, target: { center: LngLat; zoom: number; bearing: number; pitch: number }): void {
        if (!this.map) return;
        const map = this.map;
        // Annule un épinglage en cours (toggle rapide / réactivation).
        if (this._pinCancel) { try { this._pinCancel(); } catch {} }

        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const apply = () => {
            if (cancelled || !this.is3D) return;
            const c = map.getCenter();
            const drift = Math.abs(c.lng - target.center.lng) > 1e-7
                       || Math.abs(c.lat - target.center.lat) > 1e-7
                       || Math.abs(map.getZoom()  - target.zoom)  > 0.005
                       || Math.abs(map.getPitch() - target.pitch) > 0.4
                       || Math.abs(map.getBearing() - target.bearing) > 0.4;
            if (drift) {
                map.jumpTo({
                    center: target.center, zoom: target.zoom,
                    bearing: target.bearing, pitch: target.pitch
                });
            }
        };
        // Gestes utilisateur uniquement (originalEvent présent) → on rend la main.
        const onUser = (e: MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => { if (e && e.originalEvent) cancel(); };
        const cancel = () => {
            if (cancelled) return;
            cancelled = true;
            try { map.off('dragstart', onUser); } catch {}
            try { map.off('zoomstart', onUser); } catch {}
            try { map.off('rotatestart', onUser); } catch {}
            try { map.off('idle', apply); } catch {}
            timers.forEach(clearTimeout);
            this._pinCancel = null;
        };
        this._pinCancel = cancel;

        map.on('dragstart', onUser);
        map.on('zoomstart', onUser);
        map.on('rotatestart', onUser);
        map.on('idle', apply);                 // corrige chaque stabilisation du DEM
        // Réimpositions précoces et rapprochées (le DEM arrive tôt), puis on relâche.
        [0, 120, 280, 500, 850, 1300, 1900].forEach(d => timers.push(setTimeout(apply, d)));
        timers.push(setTimeout(() => { try { map.off('idle', apply); } catch {} }, 2400));
    },

    // planMap.js:597-621
    _disable3D(this: PlanMapInternal): void {
        if (!this.map) return;
        const map = this.map;
        // Stoppe l'épinglage 3D et toute animation en cours (anti-collision).
        if (this._pinCancel) { try { this._pinCancel(); } catch {} }
        try { map.stop(); } catch {}

        // CIBLE : même zone de focus, remise à plat (pitch 0, nord en haut).
        const target = { center: map.getCenter(), zoom: map.getZoom(), bearing: 0, pitch: 0 };

        try { map.setTerrain(null); } catch {}
        try {
            if (typeof map.setSky === 'function') {
                // Adaptation TS nécessaire (non listée aux pièges de la mission, requise
                // pour un `tsc --noEmit` vide) : le typage `maplibre-gl` déclare
                // `setSky(sky: SkySpecification): this` (paramètre requis, sans `null`),
                // alors que l'implémentation JS accepte `null` pour retirer le ciel —
                // c'est le comportement documenté et utilisé par l'original
                // (planMap.js:608). Assertion `as unknown as SkySpecification` : seul
                // le typage change, le runtime reçoit `null` à l'identique.
                map.setSky(null as unknown as SkySpecification);
            }
        } catch {}
        try {
            if (map.getLayer('buildings-3d')) {
                map.setLayoutProperty('buildings-3d', 'visibility', 'none');
            }
        } catch {}
        this.is3D = false;
        const fab = document.getElementById('plan_btn_3d');
        if (fab) fab.classList.remove('active');
        // Retrait du terrain : la vue se ré-aplatit (élévation → 0, prévisible). On
        // impose la cible d'un coup pour éviter tout recul, sans animation à bousculer.
        map.jumpTo(target);
        this._saveView();
    },

    /* ----- OVERLAY NOMS DE RUES (vectoriel OpenFreeMap, keyless) -----
     * Réutilise la source vectorielle 'openfreemap' déjà chargée (schéma OpenMapTiles).
     * Couches ajoutées paresseusement (1er affichage) → aucune tuile vectorielle
     * téléchargée tant que l'overlay reste masqué. Couleur jaune vif + halo sombre
     * pour ressortir nettement sur l'imagerie satellite. */
    // planMap.js:628-630
    _streetLabelPaint(this: PlanMapInternal): Record<string, unknown> {
        return { 'text-color': '#ffe14d', 'text-halo-color': '#0a0c10', 'text-halo-width': 1.6 };
    },
    // planMap.js:631-667
    _ensureStreetLabelLayers(this: PlanMapInternal): boolean {
        if (!this.map || this.map.getLayer('street-labels')) return true;
        // NB : NE PAS gater sur isStyleLoaded() — la source vectorielle 'openfreemap'
        // n'ayant aucune couche active, son TileJSON n'est pas encore chargé, donc
        // isStyleLoaded() reste false et les couches ne seraient jamais ajoutées.
        // La source est déclarée dans le style (sync) ; si absente, on diffère.
        if (!this.map.getSource('openfreemap')) { this.map.once('idle', () => this._ensureStreetLabelLayers()); return false; }
        const vis = this.streetLabelsOn ? 'visible' : 'none';
        try {
            // Adaptation TS nécessaire (non listée aux pièges de la mission, requise
            // pour un `tsc --noEmit` vide) : `_streetLabelPaint()` renvoie
            // `Record<string, unknown>` (signature imposée par `PlanMapInternal`,
            // planmap/types.ts) — trop large pour le champ `paint` très strictement
            // typé (spécifique par type de couche) de `AddLayerObject`. Les valeurs
            // portées sont des `paint`/`layout` GL valides (relevé identique à
            // l'original) : `as unknown as AddLayerObject` neutralise uniquement la
            // vérification structurelle du typage, comportement runtime inchangé.
            // Villes / quartiers
            this.map.addLayer({
                id: 'place-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'place',
                layout: {
                    visibility: vis,
                    'text-field': ['get', 'name'],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 15, 16, 18],
                    'text-max-width': 8
                },
                paint: this._streetLabelPaint()
            } as unknown as AddLayerObject);
            // Noms de rues / routes (placés le long de la voie)
            this.map.addLayer({
                id: 'street-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'transportation_name',
                layout: {
                    visibility: vis,
                    'text-field': ['get', 'name'],
                    'text-font': ['Noto Sans Regular'],
                    'symbol-placement': 'line',
                    'text-rotation-alignment': 'map',
                    'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 13]
                },
                paint: this._streetLabelPaint()
            } as unknown as AddLayerObject);
            return true;
        } catch (e) { console.warn('[PlanMap] couches noms de rues indisponibles:', e); return false; }
    },
    // planMap.js:668-674 — `if (!this.map) return;` AJOUTÉ : adaptation de pur
    // typage (l'original n'a aucune garde ici), cf. note de tête de fichier.
    _applyStreetLabelsVisibility(this: PlanMapInternal): void {
        if (!this.map) return;
        const vis = this.streetLabelsOn ? 'visible' : 'none';
        for (const id of ['street-labels', 'place-labels']) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
        }
        this._updateStreetLabelsBtn();
    },
    // planMap.js:675-681
    _toggleStreetLabels(this: PlanMapInternal): void {
        if (!this.map) return;
        this.streetLabelsOn = !this.streetLabelsOn;
        if (this.streetLabelsOn) this._ensureStreetLabelLayers();
        this._applyStreetLabelsVisibility();
        try { localStorage.setItem('pcTacStreetLabels', this.streetLabelsOn ? '1' : '0'); } catch {}
    },
    /** Restaure l'état persistant au chargement de la carte. */
    // planMap.js:683-687
    _initStreetLabels(this: PlanMapInternal): void {
        try { this.streetLabelsOn = localStorage.getItem('pcTacStreetLabels') === '1'; } catch { this.streetLabelsOn = false; }
        if (this.streetLabelsOn) this._ensureStreetLabelLayers();
        this._applyStreetLabelsVisibility();
    },
    // planMap.js:688-693
    _updateStreetLabelsBtn(this: PlanMapInternal): void {
        const btn = document.getElementById('plan_btn_labels');
        if (!btn) return;
        btn.classList.toggle('active', !!this.streetLabelsOn);
        btn.title = this.streetLabelsOn ? 'Masquer les noms de rues' : 'Afficher les noms de rues';
    },

    /* ----- OVERLAY LiDAR HD (ombrages IGN/Géoplateforme, keyless) -----
     * HORS planMap.js. Les 3 couches raster sont déclarées MASQUÉES dans
     * `RASTER_STYLE` (constants.ts) : aucune tuile n'est requêtée tant qu'aucune
     * n'est visible, et leur position dans le style les place au-dessus de
     * l'imagerie mais SOUS tout ce qui est ajouté après `load` (dessins, pings,
     * bâtiments 3D, noms de rues). Basculer se réduit donc à une visibilité. */

    /** Applique la visibilité des 3 couches (une seule active au plus) + le bouton.
     *  L'opacité suit le FOND : sur l'imagerie l'ombrage domine, sur le Plan IGN
     *  il s'efface pour laisser lire les couleurs et les figurés de la carte. */
    _applyLidarVisibility(this: PlanMapInternal): void {
        if (!this.map) return;
        const opacity = this.planIgnOn ? LIDAR_OPACITY_OVER_TOPO : LIDAR_OPACITY_OVER_IMAGERY;
        for (const id of LIDAR_LAYER_IDS) {
            const layerId = LIDAR_HD_LAYERS[id].sourceId;
            if (!this.map.getLayer(layerId)) continue;
            this.map.setLayoutProperty(layerId, 'visibility', this.lidarLayer === id ? 'visible' : 'none');
            this.map.setPaintProperty(layerId, 'raster-opacity', opacity);
        }
        this._updateLidarBtn();
    },

    /** Sélectionne un overlay (ou `null` pour tout éteindre) et le persiste. */
    _setLidarLayer(this: PlanMapInternal, id: LidarLayerId | null): void {
        this.lidarLayer = id;
        this._applyLidarVisibility();
        try {
            if (id) localStorage.setItem(LIDAR_KEY, id);
            else localStorage.removeItem(LIDAR_KEY);
        } catch { /* stockage indispo : non bloquant */ }
    },

    /** Bouton unique : aucun → MNT → MNS → MNH → aucun. */
    _cycleLidarLayer(this: PlanMapInternal): void {
        if (!this.map) return;
        const cur = this.lidarLayer;
        const idx = cur === null ? -1 : LIDAR_LAYER_IDS.indexOf(cur);
        // `idx + 1 === length` → retour à « aucun » (undefined via l'accès borné).
        const next = LIDAR_LAYER_IDS[idx + 1] ?? null;
        this._setLidarLayer(next);
        if (next) {
            const def = LIDAR_HD_LAYERS[next];
            toast(def.label + ' — ' + def.hint, { kind: 'info' });
        } else {
            toast('Ombrage LiDAR HD masqué', { kind: 'info' });
        }
    },

    /** Restaure l'overlay persisté au chargement de la carte. */
    _initLidar(this: PlanMapInternal): void {
        let saved: string | null = null;
        try { saved = localStorage.getItem(LIDAR_KEY); } catch { saved = null; }
        // Valeur inconnue (clé corrompue / ancienne version) → aucun overlay.
        this.lidarLayer = LIDAR_LAYER_IDS.find((id) => id === saved) ?? null;
        this._applyLidarVisibility();
    },

    _updateLidarBtn(this: PlanMapInternal): void {
        const btn = document.getElementById('plan_btn_lidar');
        if (!btn) return;
        const cur = this.lidarLayer;
        btn.classList.toggle('active', cur !== null);
        btn.title = cur
            ? LIDAR_HD_LAYERS[cur].label + ' — ' + LIDAR_HD_LAYERS[cur].hint + ' (toucher : couche suivante)'
            : 'Ombrage LiDAR HD (relief sous la végétation)';
        // Repère textuel du mode courant sur la pastille du FAB.
        const badge = btn.querySelector('.plan-fab-badge');
        if (badge) badge.textContent = cur ? cur.toUpperCase() : '';
    },

    /* ----- FOND TOPO COULEUR + COURBES DE NIVEAU (IGN, keyless) -----
     * HORS planMap.js. Deux bascules INDÉPENDANTES, déclarées masquées dans
     * `RASTER_STYLE` comme les ombrages : le Plan IGN v2 apporte la couleur que
     * le LiDAR HD n'a pas (l'IGN ne publie que des ombrages gris), les courbes
     * apportent la cote altimétrique. Les trois se composent librement — le
     * trio « Plan IGN + ombrage MNT + courbes » donne la carte de terrain
     * ombrée classique, mais les courbes seules sur l'ortho marchent aussi. */

    _applyTopoVisibility(this: PlanMapInternal): void {
        if (!this.map) return;
        if (this.map.getLayer('planign')) {
            this.map.setLayoutProperty('planign', 'visibility', this.planIgnOn ? 'visible' : 'none');
        }
        if (this.map.getLayer('contours')) {
            this.map.setLayoutProperty('contours', 'visibility', this.contoursOn ? 'visible' : 'none');
        }
        // Le fond conditionne l'opacité de l'ombrage LiDAR (cf. _applyLidarVisibility).
        this._applyLidarVisibility();
        this._updateTopoBtns();
    },

    _togglePlanIgn(this: PlanMapInternal): void {
        if (!this.map) return;
        this.planIgnOn = !this.planIgnOn;
        this._applyTopoVisibility();
        try { localStorage.setItem(PLANIGN_KEY, this.planIgnOn ? '1' : '0'); } catch { /* non bloquant */ }
        toast(this.planIgnOn ? 'Fond Plan IGN (couleur)' : 'Fond imagerie satellite', { kind: 'info' });
    },

    _toggleContours(this: PlanMapInternal): void {
        if (!this.map) return;
        this.contoursOn = !this.contoursOn;
        this._applyTopoVisibility();
        try { localStorage.setItem(CONTOURS_KEY, this.contoursOn ? '1' : '0'); } catch { /* non bloquant */ }
        toast(this.contoursOn ? 'Courbes de niveau affichées' : 'Courbes de niveau masquées', { kind: 'info' });
    },

    /** Restaure les deux bascules persistées au chargement de la carte. */
    _initTopoLayers(this: PlanMapInternal): void {
        try { this.planIgnOn = localStorage.getItem(PLANIGN_KEY) === '1'; } catch { this.planIgnOn = false; }
        try { this.contoursOn = localStorage.getItem(CONTOURS_KEY) === '1'; } catch { this.contoursOn = false; }
        this._applyTopoVisibility();
    },

    _updateTopoBtns(this: PlanMapInternal): void {
        const topoBtn = document.getElementById('plan_btn_topo');
        if (topoBtn) {
            topoBtn.classList.toggle('active', this.planIgnOn);
            topoBtn.title = this.planIgnOn
                ? 'Revenir au fond imagerie satellite'
                : 'Fond Plan IGN (carte topographique couleur)';
        }
        const contoursBtn = document.getElementById('plan_btn_contours');
        if (contoursBtn) {
            contoursBtn.classList.toggle('active', this.contoursOn);
            contoursBtn.title = this.contoursOn
                ? 'Masquer les courbes de niveau'
                : 'Afficher les courbes de niveau';
        }
    },
};
