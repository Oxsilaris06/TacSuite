/**
 * map-core.ts — Cycle de vie de la carte, toolbar, recherche adresse/GPS
 * (Nominatim), relief 3D + bâtiments (P3.CONV, paquet `oi-carto-map-core`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM de 13 méthodes de `modules/oi_cartographie.js`
 * (GStart-main, lecture seule), table §6.3 de `SPEC-OI-CONVERSION.md` :
 * `open` (:294), `close` (:313), `_init` (:318), `_bindUi` (:419), `_toggleSearchPanel`
 * (:502), `_toggleFullscreen` (:515), `_updateFullscreenIcon` (:528), `_showHint`
 * (:540), `_hideHint` (:547), `_parseGps` (:557), `_searchAddress` (:567),
 * `_toggle3D` (:1609), `_enable3D` (:1614), `_disable3D` (:1652).
 *
 * PATRON DE DÉCOUPAGE imposé (SPEC-OI-CONVERSION.md §6.2, identique à
 * `docs/SPEC-PLANMAP-SPLIT.md` §1.2, déjà éprouvé côté PC-Tac sur 5596 LOC) :
 * un objet `MapCoreMethods` dont chaque méthode déclare `this: OICartoInternal`.
 * AUCUN import d'un autre groupe de méthodes `carto/*` : les appels
 * `this._renderPins()`, `this._initDrawingLayers()`, `this._bindDrawUi()`,
 * `this._renderShapes()`, `this._onMapClick()`, `this._handleDrawDown/Move/Up()`,
 * `this._wireLongPressForPing()`, `this._toggleDrawDock()`, `this._openCaptureModal()`,
 * `this._toggleLabels()`, `this._closeWheel()`, `this._closeInlinePanel()`,
 * `this._saveView()`/`this._loadView()`, `this._setTool()`, `this._undo()`,
 * `this._redo()`, `this._exportToField()`, `this._closePingModal()`,
 * `this._clearAllPins()`, `this._downloadCapture()`, `this._closeCaptureModal()`
 * sont NORMAUX et VOULUS : typés par `OICartoInternal`, résolus à l'assemblage
 * par `carto/index.ts`.
 *
 * Garde MapLibre (§1.5 SPEC-OI-CONVERSION, règle « gardes lib absente ») :
 * `typeof maplibregl === 'undefined'` (oi_cartographie.js:297) devient
 * `typeof maplibregl?.Map !== 'function'` — en ESM `maplibregl` est un import
 * STATIQUE, donc jamais littéralement `undefined` ; le test devient un test de
 * FORME sur `.Map`. Le message utilisateur (`alert(...)`) est conservé mot pour
 * mot. Même adaptation pour `typeof this.map.setSky === 'function'`
 * (oi_cartographie.js:1624,1655) : ici `.setSky` PEUT réellement être absent
 * (fonctionnalité optionnelle d'une version de MapLibre), la garde est donc
 * portée telle quelle (pas une adaptation de typage, un test métier réel).
 *
 * Adaptations de TYPAGE PUR (aucun changement de comportement observable,
 * même principe que `@pctac/planmap/{map-core,chrome}.ts`, précédent déjà
 * validé par un `tsc --noEmit` vide sur 5596 LOC) :
 *  - `document.getElementById('oi_carto_capture_target') as HTMLSelectElement | null`,
 *    `'cartographyModal') as HTMLDialogElement | null`,
 *    `'oi_carto_address_input') as HTMLInputElement | null` : les IDs DOM
 *    n'ont qu'UN type HTML possible dans `4.html` (vérifié :4898 `<dialog>`,
 *    :4908 `<input>`, :5072 `<select>`) — cast au type réel, aucun comportement
 *    changé ;
 *  - `document.fullscreenElement || (document as {...}).webkitFullscreenElement`
 *    et `container.requestFullscreen || (container as {...}).webkitRequestFullscreen` /
 *    `document.exitFullscreen || (document as {...}).webkitExitFullscreen` :
 *    vendor-prefixes absents du lib DOM standard TS — même cast que le
 *    précédent PC-Tac (`@pctac/planmap/chrome.ts`, `_toggleFullscreen`) ;
 *  - `this.map.setSky(null as unknown as SkySpecification)` (`_disable3D`,
 *    oi_cartographie.js:1655) : le typage `maplibre-gl` déclare
 *    `setSky(sky: SkySpecification): this` (paramètre requis, sans `null`),
 *    alors que l'implémentation JS accepte `null` pour retirer le ciel — c'est
 *    le comportement documenté et utilisé par l'original. Seul le typage
 *    change, le runtime reçoit `null` à l'identique (même idiome que
 *    `@pctac/planmap/map-core.ts`, `_disable3D`) ;
 *  - `(m[1] ?? '').replace(...)` / `(m[2] ?? '')` dans `_parseGps` : la regex a
 *    exactement 2 groupes capturants NON optionnels, donc toujours renseignés
 *    à l'exécution — `noUncheckedIndexedAccess` les type `string | undefined`.
 *    Repli `''` neutre en observable (`parseFloat('')` → `NaN` → `return null`
 *    juste après, branche déjà présente dans l'original). Algorithme identique
 *    au jumeau PC-Tac `@pctac/planmap/geo.ts` (`parseGps`) ;
 *  - `if (!item) return;` dans le handler de clic d'un résultat de recherche
 *    (`_searchAddress`) : `noUncheckedIndexedAccess` sur `list[idx]` —
 *    `data-idx` est posé par nous-mêmes sur les indices valides de `list`,
 *    branche inatteignable en pratique (même idiome que
 *    `@pctac/planmap/chrome.ts`, `_searchAddress`) ;
 *  - `(await r.json()) as NominatimResult[]` : typage du JSON externe (`any`
 *    interdit) — même idiome que `@pctac/planmap/chrome.ts` ;
 *  - `e instanceof Error && e.message === 'QUOTA'` (catch de `_searchAddress`,
 *    oi_cartographie.js:607) : `useUnknownInCatchVariables` type la variable de
 *    `catch` en `unknown` ; l'original teste `e && e.message === 'QUOTA'` sans
 *    narrowing — la seule façon d'obtenir `e.message === 'QUOTA'` est le
 *    `throw new Error('QUOTA')` du bloc `try` juste au-dessus (:586), donc
 *    strictement équivalent en observable ;
 *  - `const map = this.map;` avant `setTimeout(() => map.resize(), 60)` dans
 *    `_updateFullscreenIcon` : la narrowing non-null de `this.map` (garde
 *    `if (this.map)` juste avant) ne traverse PAS une fermeture DIFFÉRÉE
 *    (`setTimeout`) — même principe que `@pctac/planmap/chrome.ts`. Les DEUX
 *    autres `setTimeout(() => this.map && this.map.resize(), 60)` (`open`,
 *    `_init`) n'ont PAS besoin de cette capture : le garde `this.map &&` est
 *    réévalué À L'INTÉRIEUR de la fermeture elle-même (narrowing d'expression,
 *    pas de CFA inter-instructions) — porté identique à l'original.
 *  - `this.map.xxx()` répétés SANS capture locale dans `_enable3D`/`_disable3D`
 *    (aucune fermeture différée n'y accède, contrairement à `_pinCamera` côté
 *    PC-Tac) : TypeScript conserve le narrowing d'une propriété `this.x` à
 *    travers des appels de méthode successifs tant qu'aucune fermeture
 *    différée n'y accède (vérifié par `tsc --noEmit`, même principe que
 *    `@pctac/planmap/map-core.ts`, note de tête de fichier).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { AddLayerObject, MapMouseEvent, MapTouchEvent, SkySpecification } from 'maplibre-gl';

import { toast } from '@shared/feedback.js';

import { OI_CARTO_RASTER_STYLE } from './constants.js';
import type { OICartoInternal } from './types.js';

/** Résultat Nominatim (endpoint `/search`) — seuls les champs lus par `_searchAddress`. */
interface NominatimResult {
    display_name: string;
    lon: string;
    lat: string;
}

export const MapCoreMethods = {
    /** Ouvre la modale cartographie (init paresseuse de la carte au 1er appel). */
    // oi_cartographie.js:294-311
    open(this: OICartoInternal): void {
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement | null;
        if (!modal) return;
        // oi_cartographie.js:297-300 — garde MapLibre, test de forme (cf. note
        // de tête de fichier), message VERBATIM.
        if (typeof maplibregl?.Map !== 'function') {
            toast('Librairie cartographique indisponible (réseau ?). Réessayez en ligne.', { kind: 'error' });
            return;
        }
        if (!modal.open) {
            document.body.classList.add('modal-open');
            modal.showModal();
        }
        if (!this.initialized) {
            this._init();
        } else {
            // La modale était masquée → MapLibre doit recalculer ses dimensions
            setTimeout(() => this.map && this.map.resize(), 60);
        }
    },

    // oi_cartographie.js:313-316
    close(this: OICartoInternal): void {
        const modal = document.getElementById('cartographyModal') as HTMLDialogElement | null;
        if (modal && modal.open) modal.close();
    },

    // oi_cartographie.js:318-360
    _init(this: OICartoInternal): void {
        const mapEl = document.getElementById('oi_carto_map');
        if (!mapEl) return;

        const savedView = this._loadView();
        this.map = new maplibregl.Map({
            container: 'oi_carto_map',
            style: OI_CARTO_RASTER_STYLE,
            center: savedView.center,
            zoom: savedView.zoom,
            pitch: savedView.pitch || 0,
            bearing: savedView.bearing || 0,
            preserveDrawingBuffer: true, // requis pour la future capture (Lot A3)
        });
        this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

        this.map.on('moveend', this._safe(() => this._saveView(), 'moveend'));
        this.map.on('pitchend', this._safe(() => this._saveView(), 'pitchend'));
        this.map.on('rotateend', this._safe(() => this._saveView(), 'rotateend'));

        this.map.on('click', this._safe((e: MapMouseEvent) => this._onMapClick(e), 'mapClick'));

        // Drag-to-draw — souris ET tactile
        this.map.on('mousedown', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('mousemove', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('mousemove', this._safe((e: MapMouseEvent | MapTouchEvent) => {
            if (this._measureState) this._measureUpdateCursor([e.lngLat.lng, e.lngLat.lat]);
        }, 'measureMove'));
        this.map.on('mouseup', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawUp(e), 'drawUp'));
        this.map.on('touchstart', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawDown(e), 'drawDown'));
        this.map.on('touchmove', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawMove(e), 'drawMove'));
        this.map.on('touchend', this._safe((e: MapMouseEvent | MapTouchEvent) => this._handleDrawUp(e), 'drawUp'));

        this.map.on('load', this._safe(() => {
            this._initDrawingLayers();
            this._initMeasureLayers();
            if (savedView.is3D) this._enable3D(false);
            // Restauration de l'overlay noms de rues (persisté avec la vue,
            // même patron que `is3D` ci-dessus — alignement PC-Tac).
            this.streetLabelsOn = !!savedView.streetLabelsOn;
            if (this.streetLabelsOn) this._ensureStreetLabelLayers();
            this._renderShapes();
            this._renderCommittedMeasures();
            this._renderTexts();
            setTimeout(() => this.map && this.map.resize(), 60);
        }, 'load'));

        this._bindUi();
        this._bindDrawUi();
        this._renderPins();
        this.initialized = true;
    },

    // ------------------------------------------------------------------
    // UI générale
    // ------------------------------------------------------------------

    // oi_cartographie.js:419-500
    _bindUi(this: OICartoInternal): void {
        this._wireLongPressForPing();

        const btnClose = document.getElementById('oi_carto_btn_close');
        if (btnClose) btnClose.onclick = () => this.close();

        const btnSearch = document.getElementById('oi_carto_btn_search');
        if (btnSearch) btnSearch.onclick = () => this._toggleSearchPanel();

        const btnPing = document.getElementById('oi_carto_btn_ping');
        if (btnPing) btnPing.onclick = () =>
            toast('Touchez la carte pour placer un point (appui long sur mobile)');

        const btnDraw = document.getElementById('oi_carto_btn_draw');
        if (btnDraw) btnDraw.onclick = () => this._toggleDrawDock();

        const btnCapture = document.getElementById('oi_carto_btn_capture');
        if (btnCapture) btnCapture.onclick = () => this._openCaptureModal();

        const btnLabels = document.getElementById('oi_carto_btn_labels');
        if (btnLabels) btnLabels.onclick = () => this._toggleLabels();

        // --- Tiroir « Plus » (pattern PC-Tac U24, planmap/chrome.ts:83-89) ---
        const btnMore = document.getElementById('oi_carto_btn_more');
        const moreTools = document.getElementById('oi_carto_more_tools');
        const closeMore = (): void => {
            if (!moreTools || moreTools.hidden) return;
            moreTools.hidden = true;
            if (btnMore) btnMore.setAttribute('aria-expanded', 'false');
        };
        if (btnMore && moreTools) {
            btnMore.onclick = () => {
                const open = moreTools.hidden;
                moreTools.hidden = !open;
                btnMore.setAttribute('aria-expanded', String(open));
            };
            // Fermeture au clic extérieur (les FABs du tiroir passent d'abord)
            document.addEventListener('click', (e) => {
                if (moreTools.hidden) return;
                const t = e.target as Node;
                if (!moreTools.contains(t) && !btnMore.contains(t)) closeMore();
            });
        }

        const btnStreets = document.getElementById('oi_carto_btn_streets');
        if (btnStreets) btnStreets.onclick = () => {
            this._toggleStreetLabels();
            btnStreets.classList.toggle('active', this.streetLabelsOn);
        };

        const btnMeasure = document.getElementById('oi_carto_btn_measure');
        if (btnMeasure) btnMeasure.onclick = () => this._toggleMeasure();

        const btnRings = document.getElementById('oi_carto_btn_rings');
        if (btnRings) btnRings.onclick = () => this._addEngagementRings();

        const btnLegend = document.getElementById('oi_carto_btn_legend');
        const legend = document.getElementById('oi_carto_legend');
        if (btnLegend && legend) {
            btnLegend.classList.toggle('active', !legend.hidden);
            btnLegend.onclick = () => {
                legend.hidden = !legend.hidden;
                btnLegend.classList.toggle('active', !legend.hidden);
            };
        }

        const btn3d = document.getElementById('oi_carto_btn_3d');
        if (btn3d) btn3d.onclick = () => this._toggle3D();

        const btnFs = document.getElementById('oi_carto_btn_fullscreen');
        if (btnFs) btnFs.onclick = () => this._toggleFullscreen();
        ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) =>
            document.addEventListener(ev, () => this._updateFullscreenIcon()));

        const searchInput = document.getElementById('oi_carto_address_input');
        const searchBtn = document.getElementById('oi_carto_search_btn');
        const searchClose = document.getElementById('oi_carto_search_close');
        if (searchBtn) searchBtn.onclick = () => this._searchAddress();
        if (searchInput) searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._searchAddress(); }
        });
        if (searchClose) searchClose.onclick = () => this._toggleSearchPanel(false);

        // Modale d'ajout de point
        const pingCancel = document.getElementById('oi_carto_ping_cancel');
        if (pingCancel) pingCancel.onclick = () => this._closePingModal();
        const clearPins = document.getElementById('oi_carto_clear_pins');
        if (clearPins) clearPins.onclick = () => this._clearAllPins();

        // Modale de capture
        const capDownload = document.getElementById('oi_carto_capture_download');
        if (capDownload) capDownload.onclick = () => this._downloadCapture();
        const capExport = document.getElementById('oi_carto_capture_export');
        if (capExport) capExport.onclick = () => {
            const sel = document.getElementById('oi_carto_capture_target') as HTMLSelectElement | null;
            if (sel && sel.value) this._exportToField(sel.value);
        };
        const capCancel = document.getElementById('oi_carto_capture_cancel');
        if (capCancel) capCancel.onclick = () => this._closeCaptureModal();

        // Hint : clic = annulation du placement en attente
        const hint = document.getElementById('oi_carto_hint');
        if (hint) hint.onclick = () => { this.pendingPin = null; this._hideHint(); };

        const modal = document.getElementById('cartographyModal') as HTMLDialogElement | null;
        if (modal) {
            // Sauvegarde de la vue à la fermeture (croix, Échap, bouton)
            modal.addEventListener('close', () => {
                document.body.classList.remove('modal-open');
                this._closeWheel();
                this._closeInlinePanel();
                this._saveView();
            });
            // Échap : si le tiroir « Plus », un outil de dessin ou un placement
            // est actif, on l'annule au lieu de fermer la modale.
            modal.addEventListener('cancel', (e) => {
                if (moreTools && !moreTools.hidden) { e.preventDefault(); closeMore(); }
                else if (this.drawTool) { e.preventDefault(); this._setTool(null); }
                else if (this.pendingPin) { e.preventDefault(); this.pendingPin = null; this._hideHint(); }
            });
        }

        // Raccourcis undo/redo quand la modale est ouverte
        document.addEventListener('keydown', (e) => {
            const m = document.getElementById('cartographyModal') as HTMLDialogElement | null;
            if (!m || !m.open) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); this._redo(); }
        });
    },

    // oi_cartographie.js:502-513
    _toggleSearchPanel(this: OICartoInternal, force?: boolean): void {
        const panel = document.getElementById('oi_carto_search_panel');
        const fab = document.getElementById('oi_carto_btn_search');
        if (!panel) return;
        const shouldOpen = force === undefined ? !panel.classList.contains('open') : force;
        panel.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        if (shouldOpen) {
            const input = document.getElementById('oi_carto_address_input');
            if (input) input.focus();
        }
    },

    /** Passe le conteneur de carte en plein écran (ou en sort). */
    // oi_cartographie.js:515-526
    _toggleFullscreen(this: OICartoInternal): void {
        const container = document.getElementById('oi_carto_map_wrap');
        if (!container) return;
        // `webkitFullscreenElement` : vendor-prefix absent du lib DOM standard TS
        // (cf. note de tête de fichier).
        const fsEl = document.fullscreenElement || (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
        if (!fsEl) {
            const req = container.requestFullscreen || (container as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
            if (req) req.call(container);
        } else {
            const exit = document.exitFullscreen || (document as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen;
            if (exit) exit.call(document);
        }
    },

    // oi_cartographie.js:528-538
    _updateFullscreenIcon(this: OICartoInternal): void {
        const fsEl = document.fullscreenElement || (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
        const active = !!fsEl;
        const btn = document.getElementById('oi_carto_btn_fullscreen');
        if (btn) {
            btn.classList.toggle('active', active);
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = active ? 'fullscreen_exit' : 'fullscreen';
        }
        if (this.map) {
            // oi_cartographie.js:537 — capture en const : la narrowing non-null
            // de `this.map` ne traverse pas la fermeture différée du
            // `setTimeout` (cf. note de tête de fichier).
            const map = this.map;
            setTimeout(() => map.resize(), 60);
        }
    },

    // oi_cartographie.js:540-545
    _showHint(this: OICartoInternal, msg: string): void {
        const hint = document.getElementById('oi_carto_hint');
        if (!hint) return;
        hint.textContent = msg + ' (clic ici pour annuler)';
        hint.classList.add('show');
    },

    // oi_cartographie.js:547-550
    _hideHint(this: OICartoInternal): void {
        const hint = document.getElementById('oi_carto_hint');
        if (hint) hint.classList.remove('show');
    },

    // ------------------------------------------------------------------
    // Recherche adresse / GPS (Nominatim, sans clé API)
    // ------------------------------------------------------------------

    /** Détecte des coordonnées GPS décimales "lat, lng". Retourne {lat,lng} ou null. */
    // oi_cartographie.js:557-565
    _parseGps(this: OICartoInternal, str: string): { lat: number; lng: number } | null {
        const m = str.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
        if (!m) return null;
        // oi_cartographie.js:560-561 — la regex a exactement 2 groupes
        // capturants NON optionnels, donc toujours renseignés ici (cf. note de
        // tête de fichier).
        const lat = parseFloat((m[1] ?? '').replace(',', '.'));
        const lng = parseFloat((m[2] ?? '').replace(',', '.'));
        if (isNaN(lat) || isNaN(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { lat, lng };
    },

    // oi_cartographie.js:567-612
    async _searchAddress(this: OICartoInternal): Promise<void> {
        const input = document.getElementById('oi_carto_address_input') as HTMLInputElement | null;
        const resultsBox = document.getElementById('oi_carto_search_results');
        if (!input || !resultsBox) return;
        const q = input.value.trim();
        if (!q) return;

        const gps = this._parseGps(q);
        if (gps) {
            if (this.map) this.map.flyTo({ center: [gps.lng, gps.lat], zoom: 17, speed: 1.4 });
            resultsBox.innerHTML = `<div class="oi-carto-search-result">Point GPS centré : ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}</div>`;
            return;
        }

        resultsBox.innerHTML = '<em style="color: var(--text-muted);">Recherche…</em>';
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
            const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
            if (!r.ok) {
                if (r.status === 429 || r.status === 403) throw new Error('QUOTA');
                throw new Error('HTTP ' + r.status);
            }
            // oi_cartographie.js:589 — typage du JSON externe (`any` interdit).
            const list = (await r.json()) as NominatimResult[];
            if (!list.length) {
                resultsBox.innerHTML = '<em style="color: var(--text-muted);">Aucun résultat.</em>';
                return;
            }
            const esc = (s: string): string => (window.UIPlatform ? window.UIPlatform.esc(s) : s);
            resultsBox.innerHTML = list.map((item, i) =>
                `<div class="oi-carto-search-result" data-idx="${i}">${esc(item.display_name)}</div>`,
            ).join('');
            resultsBox.querySelectorAll<HTMLDivElement>('.oi-carto-search-result').forEach((div) => {
                div.onclick = () => {
                    // oi_cartographie.js:600 — `String(...)` reproduit la coercion
                    // native de `parseInt(undefined, 10)` (ToString → "undefined" →
                    // NaN), cf. note de tête de fichier.
                    const item = list[parseInt(String(div.dataset.idx), 10)];
                    // Garde de typage (`noUncheckedIndexedAccess`) : `data-idx` est
                    // posé par nous-mêmes juste au-dessus sur les indices valides de
                    // `list` — branche inatteignable en pratique.
                    if (!item) return;
                    if (this.map) this.map.flyTo({ center: [parseFloat(item.lon), parseFloat(item.lat)], zoom: 17, speed: 1.4 });
                    resultsBox.innerHTML = '';
                };
            });
        } catch (e) {
            console.error('[OICarto] Nominatim échec:', e);
            // oi_cartographie.js:607-609 — `e` typé `unknown` (catch strict) ;
            // la seule façon d'obtenir `e.message === 'QUOTA'` est le
            // `throw new Error('QUOTA')` du bloc `try` ci-dessus (cf. note de
            // tête de fichier).
            const msg = (e instanceof Error && e.message === 'QUOTA')
                ? 'Quota de recherche atteint. Réessayez dans un instant.'
                : 'Erreur réseau. Vérifiez la connexion.';
            resultsBox.innerHTML = `<em style="color: var(--danger-red);">${msg}</em>`;
        }
    },

    /* ----- OVERLAY NOMS DE RUES (vectoriel OpenFreeMap, keyless) -----
     * Alignement fond de carte PC-Tac (@pctac/planmap/map-core.ts, hors
     * `oi_cartographie.js`). Réutilise la source vectorielle 'openfreemap'
     * déjà déclarée dans le style (schéma OpenMapTiles). Couches ajoutées
     * paresseusement (1er affichage) → aucune tuile vectorielle téléchargée
     * tant que l'overlay reste masqué. Couleur jaune vif + halo sombre pour
     * ressortir nettement sur l'imagerie satellite. Persistance via la vue
     * (`_saveView`), pas localStorage : seule frontière de persistance OI. */
    _ensureStreetLabelLayers(this: OICartoInternal): boolean {
        if (!this.map || this.map.getLayer('street-labels')) return true;
        // NB : NE PAS gater sur isStyleLoaded() — la source vectorielle 'openfreemap'
        // n'ayant aucune couche active, son TileJSON n'est pas encore chargé, donc
        // isStyleLoaded() reste false et les couches ne seraient jamais ajoutées.
        // La source est déclarée dans le style (sync) ; si absente, on diffère.
        if (!this.map.getSource('openfreemap')) { this.map.once('idle', () => this._ensureStreetLabelLayers()); return false; }
        const vis = this.streetLabelsOn ? 'visible' : 'none';
        const paint = { 'text-color': '#ffe14d', 'text-halo-color': '#0a0c10', 'text-halo-width': 1.6 };
        try {
            // `as unknown as AddLayerObject` : même adaptation de typage pur que
            // PC-Tac (`@pctac/planmap/map-core.ts`, `_ensureStreetLabelLayers`) —
            // valeurs `paint`/`layout` GL valides, comportement runtime inchangé.
            // Villes / quartiers
            this.map.addLayer({
                id: 'place-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'place',
                layout: {
                    visibility: vis,
                    'text-field': ['get', 'name'],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 15, 16, 18],
                    'text-max-width': 8,
                },
                paint,
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
                    'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 13],
                },
                paint,
            } as unknown as AddLayerObject);
            return true;
        } catch (e) { console.warn('[OICarto] couches noms de rues indisponibles:', e); return false; }
    },

    _applyStreetLabelsVisibility(this: OICartoInternal): void {
        if (!this.map) return;
        const vis = this.streetLabelsOn ? 'visible' : 'none';
        for (const id of ['street-labels', 'place-labels']) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', vis);
        }
    },

    /** Bascule l'overlay noms de rues (câblé sur #oi_carto_btn_streets, cf. _bindUi). */
    _toggleStreetLabels(this: OICartoInternal): void {
        if (!this.map) return;
        this.streetLabelsOn = !this.streetLabelsOn;
        if (this.streetLabelsOn) this._ensureStreetLabelLayers();
        this._applyStreetLabelsVisibility();
        this._saveView(); // persiste le flag avec la vue (cf. state.ts)
    },

    // ------------------------------------------------------------------
    // Relief 3D + bâtiments
    // ------------------------------------------------------------------

    // oi_cartographie.js:1609-1612
    _toggle3D(this: OICartoInternal): void {
        if (this.is3D) this._disable3D();
        else this._enable3D(true);
    },

    // oi_cartographie.js:1614-1650
    _enable3D(this: OICartoInternal, animate = true): void {
        if (!this.map) return;
        try {
            this.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });
        } catch (e) {
            console.error('[OICarto] setTerrain échec:', e);
            toast('Relief 3D indisponible (réseau ?). Les tuiles d\'élévation AWS sont peut-être bloquées.', { kind: 'error' });
            return;
        }
        try {
            if (typeof this.map.setSky === 'function') {
                this.map.setSky({
                    'sky-color': '#7ab8e6',
                    'sky-horizon-blend': 0.6,
                    'horizon-color': '#dfeefc',
                    'horizon-fog-blend': 0.6,
                    'fog-color': '#cfd8e0',
                    'fog-ground-blend': 0.4,
                });
            }
        } catch { /* ciel optionnel */ }
        try {
            if (this.map.getLayer('buildings-3d')) {
                this.map.setLayoutProperty('buildings-3d', 'visibility', 'visible');
            }
        } catch { /* couche absente si init échouée */ }

        this.is3D = true;
        const fab = document.getElementById('oi_carto_btn_3d');
        if (fab) fab.classList.add('active');

        if (animate) {
            const targetPitch = this.map.getPitch() < 20 ? 60 : this.map.getPitch();
            this.map.easeTo({ pitch: targetPitch, duration: 900 });
        }
        this._saveView();
    },

    // oi_cartographie.js:1652-1666
    _disable3D(this: OICartoInternal): void {
        if (!this.map) return;
        try { this.map.setTerrain(null); } catch { /* déjà retiré */ }
        try {
            if (typeof this.map.setSky === 'function') {
                // oi_cartographie.js:1655 — `setSky(null)` : cf. note de tête de
                // fichier (adaptation de typage pur, comportement runtime inchangé).
                this.map.setSky(null as unknown as SkySpecification);
            }
        } catch { /* ciel optionnel */ }
        try {
            if (this.map.getLayer('buildings-3d')) {
                this.map.setLayoutProperty('buildings-3d', 'visibility', 'none');
            }
        } catch { /* couche absente si init échouée */ }
        this.is3D = false;
        const fab = document.getElementById('oi_carto_btn_3d');
        if (fab) fab.classList.remove('active');
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
        this._saveView();
    },
};
