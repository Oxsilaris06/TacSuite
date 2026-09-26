/**
 * chrome.ts — Toolbar 8 FABs, plein écran, recherche Nominatim, marqueur de
 * recherche, dock de dessin, hint (P2.CONV, paquet `pm-chrome`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 9 méthodes « CHROME » de `modules/pctac/planMap.js`
 * (GStart-main, lecture seule) :
 *   - `_bindUi`               (:695)  — câblage des 8 FABs et du bandeau de
 *     recherche
 *   - `_toggleFullscreen`     (:769)
 *   - `_updateFullscreenIcon` (:782)
 *   - `_toggleSearchPanel`    (:798)
 *   - `_searchAddress`        (:824)  — GPS direct ou géocodage Nominatim
 *   - `_placeSearchMarker`    (:894)
 *   - `_toggleDrawDock`       (:946)
 *   - `_showHint`             (:5566)
 *   - `_hideHint`             (:5590)
 *
 * Cf. `docs/SPEC-PLANMAP-SPLIT.md` §4.4 (signatures exactes), §1.3 (règle
 * `this: PlanMapInternal`), §5.7 (INVARIANT jeton de séquence Nominatim —
 * voir `_searchAddress`), §6.2 (import npm `maplibregl` au lieu du global),
 * §6.5, §6.6 (interdits : ne pas convertir `el.onclick =` en
 * `addEventListener` — l'original s'appuie sur l'écrasement idempotent pour
 * que `_bindUi` soit rejouable).
 *
 * Adaptations de TYPAGE PUR appliquées (aucun changement de comportement
 * observable ; même principe déjà en place dans draw-layers.ts / text-modal.ts) :
 *  - `document.getElementById(...)?.parentElement` (optional chaining) là où
 *    l'original enchaîne `.parentElement`/`.appendChild` sans garde
 *    intermédiaire (`_toggleFullscreen`, `_showHint`) — jamais déclenché en
 *    pratique (`#plan_map` existe toujours quand ces méthodes sont câblées) ;
 *  - `document.fullscreenElement || (document as {...}).webkitFullscreenElement`
 *    et `container.requestFullscreen || (container as {...}).webkitRequestFullscreen` :
 *    vendor-prefixes absents du lib DOM standard TS — même cast que
 *    `text-modal.ts` (`_mountModalInFullscreen`, planMap.js:4584) ;
 *  - gardes `if (this.map)` / capture `const map = this.map;` avant les
 *    fermetures imbriquées : `this.map` est nullable dans le typage strict
 *    (`MapLibreMap | null`), jamais `null` en pratique (ces méthodes ne sont
 *    câblées/appelables qu'après l'initialisation de la carte) ;
 *  - `(await r.json()) as NominatimResult[]` : typage du JSON externe
 *    (SPEC-CONTRATS.md §0.1 — `any` interdit), même idiome que `tchap-live.ts` ;
 *  - gardes `if (!first) return;` / `if (!item) return;` : `noUncheckedIndexedAccess`
 *    sur `list[0]`/`list[idx]`, branches inatteignables (longueur/`data-idx`
 *    déjà garantis par le code juste au-dessus), cf. SPEC-PLANMAP-SPLIT.md §6.3 ;
 *  - `String(btn.dataset.color)` / `String(btn.dataset.kind)` : reproduit la
 *    coercion native `ToString` d'une assignation `.value = undefined`, même
 *    idiome que `text-modal.ts` (`_bindTextModalOnce`).
 *
 * Source : `GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';

import { escHtml, GPX_PLAY_SPEEDS } from './constants.js';
import { showBusy, hideBusy } from '@pctac/busy.js';
import { parseCoordinateInput } from '@shared/coords.js';
import { geocodeAddress, type GeocodeHit } from './search.js';
import type { PlanMapInternal } from './types.js';

/** Ferme le tiroir « Plus » (#plan_more_tools) s'il est ouvert. Fonction de
 *  module (pas de `this`) : appelée à la fois depuis `_bindUi` (clic extérieur,
 *  Échap, ouverture du panneau Calques) et depuis `_toggleSearchPanel`
 *  (exclusion mutuelle des 3 panneaux flottants de la carte). */
function closeMoreDrawer(): void {
    const moreTools = document.getElementById('plan_more_tools');
    const btnMore = document.getElementById('plan_btn_more');
    if (!moreTools || moreTools.hidden) return;
    moreTools.hidden = true;
    if (btnMore) btnMore.setAttribute('aria-expanded', 'false');
}

/** Ferme le panneau « Traces GPX » (#plan_gpx_panel) s'il est ouvert. Même
 *  logique que `closeMoreDrawer` : les panneaux flottants de la carte
 *  s'excluent mutuellement, jamais deux superposés. */
function closeGpxPanel(): void {
    const panel = document.getElementById('plan_gpx_panel');
    const btn = document.getElementById('plan_btn_gpx');
    if (!panel || !panel.classList.contains('open')) return;
    panel.classList.remove('open');
    btn?.setAttribute('aria-expanded', 'false');
    btn?.classList.remove('active');
}

/** Ferme le panneau « Calques » (#plan_layers_panel) s'il est ouvert. Même
 *  logique que `closeMoreDrawer` (exclusion mutuelle des panneaux). */
function closeLayersPanel(): void {
    const panel = document.getElementById('plan_layers_panel');
    const btn = document.getElementById('plan_btn_layers');
    if (!panel || !panel.classList.contains('open')) return;
    panel.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

export const ChromeMethods = {
    // planMap.js:695-766
    _bindUi(this: PlanMapInternal): void {
        const searchInput = document.getElementById('plan_address_input');
        const searchBtn = document.getElementById('plan_search_btn');
        const searchClose = document.getElementById('plan_search_close');

        if (searchBtn) searchBtn.onclick = () => this._searchAddress();
        if (searchInput) searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._searchAddress(); }
        });
        if (searchClose) searchClose.onclick = () => this._toggleSearchPanel(false);

        // --- Toolbar unifiée : 4 FABs primaires + tiroir « Plus » (U24) ---
        const btnSearch = document.getElementById('plan_btn_search');
        if (btnSearch) btnSearch.onclick = () => this._toggleSearchPanel();

        const btnMore = document.getElementById('plan_btn_more');
        const moreTools = document.getElementById('plan_more_tools');
        if (btnMore && moreTools) btnMore.onclick = () => {
            const open = moreTools.hidden;
            // Exclusion mutuelle : ouvrir « Plus » ferme le panneau Calques et
            // le bandeau de recherche (jamais deux panneaux superposés).
            if (open) { closeLayersPanel(); this._toggleSearchPanel(false); }
            moreTools.hidden = !open;
            btnMore.setAttribute('aria-expanded', String(open));
        };

        // Panneau « Calques » (fond de carte + surimpressions + vue) — même
        // mécanique que le tiroir « Plus » ci-dessus (U24).
        const btnLayers = document.getElementById('plan_btn_layers');
        const layersPanel = document.getElementById('plan_layers_panel');
        if (btnLayers && layersPanel) btnLayers.onclick = () => {
            const open = !layersPanel.classList.contains('open');
            if (open) { closeMoreDrawer(); this._toggleSearchPanel(false); }
            layersPanel.classList.toggle('open', open);
            btnLayers.setAttribute('aria-expanded', String(open));
        };

        // Panneau « Traces GPX » — même mécanique, avec en plus le sélecteur de
        // fichier et la délégation des actions par ligne (afficher / supprimer).
        const btnGpx = document.getElementById('plan_btn_gpx');
        if (btnGpx) btnGpx.onclick = () => {
            const panel = document.getElementById('plan_gpx_panel');
            const open = !panel?.classList.contains('open');
            if (open) { closeLayersPanel(); closeMoreDrawer(); this._toggleSearchPanel(false); }
            this._toggleGpxPanel(open);
        };

        const gpxImport = document.getElementById('plan_gpx_import');
        const gpxFile = document.getElementById('plan_gpx_file');
        if (gpxImport && gpxFile instanceof HTMLInputElement) {
            gpxImport.onclick = () => { gpxFile.value = ''; gpxFile.click(); };
            gpxFile.onchange = () => {
                const files = Array.from(gpxFile.files ?? []);
                if (files.length) this._importGpxFiles(files).catch(() => { /* déjà signalé à l'utilisateur */ });
            };
        }

        // Barre d'actions du panneau. Chacune ouvre un SOUS-MENU TRANSITOIRE
        // plutôt qu'une barre permanente : le tronc du panneau reste lisible.
        const gpxAll = document.getElementById('plan_gpx_all');
        if (gpxAll) gpxAll.onclick = (e) => { e.stopPropagation(); this._setAllGpxVisible(); };
        const gpxColor = document.getElementById('plan_gpx_color');
        if (gpxColor) gpxColor.onclick = (e) => { e.stopPropagation(); this._openGpxColorAllMenu(); };
        const gpxDelete = document.getElementById('plan_gpx_delete');
        if (gpxDelete) gpxDelete.onclick = (e) => { e.stopPropagation(); void this._removeAllGpxTracks(); };
        const gpxSettings = document.getElementById('plan_gpx_settings');
        if (gpxSettings) gpxSettings.onclick = (e) => { e.stopPropagation(); this._openGpxSettingsMenu(); };
        const gpxPlay = document.getElementById('plan_gpx_play');
        if (gpxPlay) gpxPlay.onclick = (e) => {
            e.stopPropagation();
            // On démarre toujours en temps réel : le module retombe de lui-même
            // sur la progression si aucune trace visible n'est datée.
            if (this._isGpxPlaying()) this._stopGpxPlayback(); else this._startGpxPlayback('real');
        };

        // Barre de lecture : PERSISTANTE, donc câblée une fois pour toutes.
        const playPause = document.getElementById('plan_gpx_playpause');
        if (playPause) playPause.onclick = () => this._toggleGpxPlayPause();
        const seek = document.getElementById('plan_gpx_seek');
        if (seek instanceof HTMLInputElement) {
            seek.oninput = () => {
                // Faire glisser le curseur met en pause : sinon la lecture
                // reprendrait la main et arracherait le curseur des doigts.
                this._pauseGpxPlayback();
                this._seekGpxPlayback(Number(seek.value) / 1000);
            };
        }
        const speedBtn = document.getElementById('plan_gpx_speed');
        if (speedBtn) speedBtn.onclick = () => {
            const cur = Number((speedBtn.textContent ?? '×1').replace('×', '')) || 1;
            const i = GPX_PLAY_SPEEDS.indexOf(cur);
            this._setGpxPlaySpeed(GPX_PLAY_SPEEDS[(i + 1) % GPX_PLAY_SPEEDS.length] ?? 1);
        };
        const modeBtn = document.getElementById('plan_gpx_mode');
        if (modeBtn) modeBtn.onclick = () => {
            this._setGpxPlayMode(modeBtn.textContent?.trim() === 'Temps réel' ? 'norm' : 'real');
        };
        const closePlayer = document.getElementById('plan_gpx_close');
        if (closePlayer) closePlayer.onclick = () => this._stopGpxPlayback();

        // Délégation : une seule écoute pour toutes les lignes et tous les
        // en-têtes de jour, y compris ceux rendus plus tard par `_renderGpxList`.
        const gpxList = document.getElementById('plan_gpx_list');
        if (gpxList) gpxList.onclick = (e) => {
            const btn = (e.target as Element | null)?.closest('[data-gpx-act]');
            if (!(btn instanceof HTMLElement)) return;
            // Indispensable : ces actions re-rendent la liste, donc la cible du
            // clic est DÉTACHÉE avant que l'écoute « clic extérieur » posée sur
            // `document` ne l'examine. Sans cet arrêt, `panel.contains(target)`
            // serait faux et le panneau se refermerait à chaque action.
            e.stopPropagation();
            const act = btn.dataset.gpxAct;
            const day = btn.closest<HTMLElement>('[data-gpx-day]')?.dataset.gpxDay;
            if (act === 'fold') { if (day !== undefined) this._toggleGpxDayFold(day); return; }
            if (act === 'daymenu') { if (day !== undefined) this._openGpxDayMenu(day); return; }
            const id = btn.closest<HTMLElement>('[data-gpx-id]')?.dataset.gpxId;
            if (!id) return;
            if (act === 'toggle') this._toggleGpxTrack(id);
            else if (act === 'remove') this._removeGpxTrack(id);
            else if (act === 'color') this._openGpxColorMenu({ id });
        };

        // Fermeture au clic extérieur : tiroir « Plus » et panneau « Calques ».
        if ((btnMore && moreTools) || (btnLayers && layersPanel)) {
            document.addEventListener('click', (e) => {
                const t = e.target as Node;
                if (moreTools && !moreTools.hidden && btnMore && !moreTools.contains(t) && !btnMore.contains(t)) closeMoreDrawer();
                if (layersPanel && layersPanel.classList.contains('open') && btnLayers && !layersPanel.contains(t) && !btnLayers.contains(t)) closeLayersPanel();
                const gpxPanel = document.getElementById('plan_gpx_panel');
                if (gpxPanel && gpxPanel.classList.contains('open') && btnGpx && !gpxPanel.contains(t) && !btnGpx.contains(t)) closeGpxPanel();
            });
            // Échap : ferme le tiroir « Plus », le panneau « Calques » ou le
            // panneau « Traces GPX » si l'un d'eux est ouvert.
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (moreTools && !moreTools.hidden) closeMoreDrawer();
                else if (layersPanel && layersPanel.classList.contains('open')) closeLayersPanel();
                else closeGpxPanel();
            });
        }

        const btnFs = document.getElementById('plan_btn_fullscreen');
        if (btnFs) btnFs.onclick = () => this._toggleFullscreen();
        // Maintenir l'icône à jour quel que soit le déclencheur (FAB ou touche Échap)
        ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) =>
            document.addEventListener(ev, () => this._updateFullscreenIcon()));

        const btn3d = document.getElementById('plan_btn_3d');
        if (btn3d) btn3d.onclick = () => this._toggle3D();

        const captureBtn = document.getElementById('plan_btn_capture');
        // Indicateur de chargement autour du SEUL appel (pas de la logique de capture
        // elle-même, cf. src/apps/pctac/planmap/capture.ts — fichier verbatim sensible).
        if (captureBtn) captureBtn.onclick = () => {
            showBusy('Capture de la carte…');
            void this._takeScreenshot().finally(hideBusy);
        };

        const pingBtn = document.getElementById('plan_btn_ping');
        if (pingBtn) pingBtn.onclick = () => {
            // Roue centrée sur la vue actuelle
            // planMap.js:725 — garde de typage (`this.map` nullable), cf. note
            // générale en tête de fichier ; jamais null en pratique.
            if (!this.map) return;
            const center = this.map.getCenter();
            this._openCreatePingWheel({ lng: center.lng, lat: center.lat });
        };

        const drawBtn = document.getElementById('plan_btn_draw');
        if (drawBtn) drawBtn.onclick = () => this._toggleDrawDock();

        const labelsBtn = document.getElementById('plan_btn_labels');
        if (labelsBtn) labelsBtn.onclick = () => this._toggleStreetLabels();

        // Ombrages LiDAR HD (IGN) : un seul bouton, cyclage MNT → MNS → MNH → off.
        const lidarBtn = document.getElementById('plan_btn_lidar');
        if (lidarBtn) lidarBtn.onclick = () => this._cycleLidarLayer();

        // Fond topo couleur (Plan IGN v2) et courbes de niveau : deux bascules
        // indépendantes, composables avec l'ombrage LiDAR.
        const topoBtn = document.getElementById('plan_btn_topo');
        if (topoBtn) topoBtn.onclick = () => this._togglePlanIgn();

        const contoursBtn = document.getElementById('plan_btn_contours');
        if (contoursBtn) contoursBtn.onclick = () => this._toggleContours();

        // Téléchargement carte d'une zone d'opération (AOI) hors-ligne (CONTRAT C4).
        const aoiBtn = document.getElementById('plan_btn_aoi');
        if (aoiBtn) aoiBtn.onclick = () => this._startAoiFraming();

    },

    /** Passe le conteneur de carte en plein écran (ou en sort) */
    // planMap.js:769-780
    _toggleFullscreen(this: PlanMapInternal): void {
        // planMap.js:770 — `getElementById(...)?.parentElement` : cf. note
        // générale en tête de fichier (adaptation de TYPAGE PUR).
        const container = document.getElementById('plan_map')?.parentElement;
        if (!container) return;
        // `webkitFullscreenElement` : vendor-prefix absent du lib DOM standard TS.
        const fsEl = document.fullscreenElement || (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
        if (!fsEl) {
            const req = container.requestFullscreen || (container as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
            if (req) req.call(container);
        } else {
            const exit = document.exitFullscreen || (document as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen;
            if (exit) exit.call(document);
        }
    },

    // planMap.js:782-795
    _updateFullscreenIcon(this: PlanMapInternal): void {
        const fsEl = document.fullscreenElement || (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
        const active = !!fsEl;
        // Sortie de plein écran avec un modal déplacé → on le restaure à sa place.
        if (!active) this._restoreModalFromFullscreen();
        const btn = document.getElementById('plan_btn_fullscreen');
        if (btn) {
            btn.classList.toggle('active', active);
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = active ? 'fullscreen_exit' : 'fullscreen';
        }
        // La taille du conteneur a changé → MapLibre doit recalculer
        if (this.map) {
            // planMap.js:794 — capture en const : fait traverser le narrowing
            // non-null de `this.map` à la fermeture du `setTimeout` (même
            // principe que draw-layers.ts, SPEC-PLANMAP-SPLIT §1.2).
            const map = this.map;
            setTimeout(() => map.resize(), 60);
        }
    },

    /** Ouvre/ferme le bandeau de recherche */
    // planMap.js:798-809
    _toggleSearchPanel(this: PlanMapInternal, force?: boolean): void {
        const panel = document.getElementById('plan_search_panel');
        const fab = document.getElementById('plan_btn_search');
        if (!panel) return;
        const shouldOpen = force === undefined ? !panel.classList.contains('open') : force;
        panel.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        if (shouldOpen) {
            // Exclusion mutuelle : ouvrir la recherche ferme le tiroir « Plus »
            // et le panneau Calques (jamais deux panneaux superposés).
            closeMoreDrawer();
            closeLayersPanel();
            const input = document.getElementById('plan_address_input');
            if (input) input.focus();
        }
    },

    // planMap.js:824-889 — INVARIANT §5.7 : jeton de séquence. `seq` est
    // incrémenté AVANT toute branche (coordonnées comprises), et le double test
    // `if (seq !== this._searchSeq) return;` reste posé aux DEUX endroits
    // (succès, échec) — une réponse réseau lente ne doit jamais écraser une
    // recherche plus récente.
    //
    // Décision 35 (lot C) : la saisie est d'abord essayée comme COORDONNÉES
    // (décimal, DMS, MGRS, case du carroyage actif) — aucun appel réseau dans
    // ce cas ; sinon géocodage BAN puis Nominatim (`./search.js`).
    async _searchAddress(this: PlanMapInternal): Promise<void> {
        const input = document.getElementById('plan_address_input') as HTMLInputElement | null;
        const resultsBox = document.getElementById('plan_search_results');
        if (!input || !resultsBox) return;
        const q = input.value.trim();
        if (!q) return;

        // Jeton de séquence incrémenté AVANT toute branche : une réponse réseau
        // en vol d'une recherche précédente ne doit écraser NI un résultat plus
        // récent NI un centrage direct de coordonnées.
        const seq = (this._searchSeq = (this._searchSeq || 0) + 1);

        // 1) Coordonnées directes (décimal, DMS, MGRS, case) → centre immédiat.
        // C17 : une saisie qui RESSEMBLE à une case mais tombe HORS du rectangle
        // du carroyage est très probablement un nom de route / d'axe (« D951 »,
        // « N7 ») : on ne bloque plus le géocodage, on garde l'indication « hors
        // du carroyage » en tête des résultats.
        let gridHint: string | null = null;
        const coord = parseCoordinateInput(q, this.overlays?.state?.grid ?? null);
        if (coord && coord.kind === 'cell-out-of-grid') {
            gridHint = `<em style="color: var(--text-muted);">Case ${escHtml(coord.cell)} hors du carroyage.</em>`;
        } else if (coord) {
            const centered = (lng: number, lat: number, label: string | null): void => {
                if (this.map) this.map.flyTo({ center: [lng, lat], zoom: 17, speed: 1.4 });
                this._placeSearchMarker(lng, lat, label);
            };
            if (coord.kind === 'bad-range') {
                resultsBox.innerHTML = '<em style="color: var(--danger-red);">Coordonnées hors plage (latitude ±90°, longitude ±180°).</em>';
                return;
            }
            if (coord.kind === 'cell-no-grid') {
                resultsBox.innerHTML = '<em style="color: var(--text-muted);">Aucun carroyage actif : tracez-en un pour saisir une case.</em>';
                return;
            }
            if (coord.kind === 'cell') {
                centered(coord.lng, coord.lat, `Case ${coord.cell}`);
                resultsBox.innerHTML = `
                    <div class="plan-search-result" style="padding: 8px; border-bottom: 1px solid var(--border-glass); display: flex; align-items: center; gap: 6px;">
                        <span class="material-symbols-outlined" style="font-size: 16px; color: var(--ao-green);">grid_on</span>
                        Case du carroyage : ${escHtml(coord.cell)}
                    </div>`;
                return;
            }
            // Point (décimal, DMS ou MGRS)
            const label = coord.format === 'decimal'
                ? `GPS ${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`
                : coord.label;
            centered(coord.lng, coord.lat, label);
            const word = coord.format === 'mgrs' ? 'MGRS' : coord.format === 'dms' ? 'DMS' : 'GPS';
            resultsBox.innerHTML = `
                <div class="plan-search-result" style="padding: 8px; border-bottom: 1px solid var(--border-glass); display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 16px; color: var(--ao-green);">my_location</span>
                    Point ${word} centré : ${escHtml(label)}
                </div>`;
            return;
        }

        // 2) Géocodage d'adresse : BAN d'abord, Nominatim en repli.
        resultsBox.innerHTML = '<em style="color: var(--text-muted);">Recherche…</em>';
        try {
            const hits = await geocodeAddress(q);
            if (seq !== this._searchSeq) return; // réponse périmée : ignorer
            if (!hits.length) {
                resultsBox.innerHTML = (gridHint ?? '') + '<em style="color: var(--text-muted);">Aucun résultat.</em>';
                return;
            }
            const first = hits[0];
            if (!first) return;
            // B4 (revue du 25/09) — correspondance approximative (score BAN
            // faible, Nominatim muet) : on ne s'y rend pas d'office, l'opérateur
            // choisit dans la liste.
            if (!first.weak) {
                if (this.map) this.map.flyTo({ center: [first.lng, first.lat], zoom: 17, speed: 1.4 });
                this._placeSearchMarker(first.lng, first.lat, first.label);
            }
            const weakNote = first.weak
                ? '<em style="color: var(--text-muted); display: block; padding: 6px 8px;">Aucune correspondance sûre : choisissez un résultat.</em>'
                : '';
            resultsBox.innerHTML = (gridHint ?? '') + weakNote + hits.map((item: GeocodeHit, i: number) => `
                <div class="plan-search-result" data-idx="${i}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--border-glass);">
                    ${escHtml(item.label)}${item.weak ? ' <span style="color: var(--text-muted);">(approximatif)</span>' : ''}
                </div>
            `).join('');
            resultsBox.querySelectorAll<HTMLDivElement>('.plan-search-result').forEach((div) => {
                div.onclick = () => {
                    const idx = parseInt(String(div.dataset.idx), 10);
                    const item = hits[idx];
                    if (!item) return;
                    if (this.map) this.map.flyTo({ center: [item.lng, item.lat], zoom: 17, speed: 1.4 });
                    this._placeSearchMarker(item.lng, item.lat, item.label);
                    resultsBox.innerHTML = '';
                };
                div.onmouseover = () => { div.style.background = 'rgba(59, 130, 246, 0.15)'; };
                div.onmouseout = () => { div.style.background = ''; };
            });
        } catch (e) {
            if (seq !== this._searchSeq) return; // échec d'une requête périmée : ignorer
            console.error('[PlanMap] Géocodage échec:', e);
            resultsBox.innerHTML = (gridHint ?? '') + '<em style="color: var(--danger-red);">Erreur réseau. Vérifie ta connexion.</em>';
            // On purge le pointeur précédent pour éviter une localisation périmée
            if (this.searchMarker) { this.searchMarker.remove(); this.searchMarker = null; }
        }
    },

    /** Pose (ou déplace) un pointeur précis sur l'adresse cherchée.
     *  Pulse animé pour attirer l'œil. Le marker reste jusqu'à la prochaine
     *  recherche ; on le retire si l'utilisateur clique dessus. */
    // planMap.js:894-943
    _placeSearchMarker(this: PlanMapInternal, lng: number, lat: number, label?: string | null): void {
        if (!this.map) return;
        // planMap.js:895 — capture en const : fait traverser le narrowing
        // non-null de `this.map` à la fermeture `el.onclick` plus bas (même
        // principe que draw-layers.ts, SPEC-PLANMAP-SPLIT §1.2).
        const map = this.map;
        if (this.searchMarker) {
            this.searchMarker.remove();
            this.searchMarker = null;
        }
        const el = document.createElement('div');
        el.style.cssText = `
            position: relative; width: 32px; height: 32px; cursor: pointer;
        `;
        el.innerHTML = `
            <div style="
                position: absolute; inset: 0;
                border-radius: 50%;
                background: rgba(59,130,246,0.35);
                animation: pctacPulse 1.6s ease-out infinite;
            "></div>
            <div style="
                position: absolute; left: 50%; top: 50%;
                transform: translate(-50%, -50%);
                width: 14px; height: 14px;
                background: #3b82f6;
                border: 3px solid #fff;
                border-radius: 50%;
                box-shadow: 0 0 6px rgba(0,0,0,0.6);
            "></div>
        `;
        // Injecte le keyframe une seule fois
        if (!document.getElementById('pctac-pulse-style')) {
            const s = document.createElement('style');
            s.id = 'pctac-pulse-style';
            s.textContent = `@keyframes pctacPulse {
                0% { transform: scale(0.6); opacity: 0.9; }
                100% { transform: scale(2.2); opacity: 0; }
            }`;
            document.head.appendChild(s);
        }
        const popup = label
            ? new maplibregl.Popup({ offset: 18, closeButton: true }).setHTML(
                `<div style="font-family: var(--font-ui); font-size: 0.9em; max-width: 260px;">${escHtml(label)}</div>`)
            : null;
        const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]);
        if (popup) m.setPopup(popup);
        m.addTo(map);
        el.onclick = (ev) => {
            ev.stopPropagation();
            if (popup) popup.addTo(map);
        };
        this.searchMarker = m;
    },

    /** Ouvre/ferme le dock de dessin réductible */
    // planMap.js:946-955
    _toggleDrawDock(this: PlanMapInternal, force?: boolean): void {
        const dock = document.getElementById('plan_draw_dock');
        const fab = document.getElementById('plan_btn_draw');
        if (!dock) return;
        const shouldOpen = force === undefined ? !dock.classList.contains('open') : force;
        dock.classList.toggle('open', shouldOpen);
        if (fab) fab.classList.toggle('active', shouldOpen);
        // Fermer le dock désactive l'outil de dessin en cours
        if (!shouldOpen && this.drawTool) this._setTool(null);
    },

    // planMap.js:5566-5588
    _showHint(this: PlanMapInternal, msg: string): void {
        let hint = document.getElementById('plan_hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'plan_hint';
            hint.style.cssText = `
                position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
                background: var(--accent-blue); color: white; padding: 8px 16px;
                border-radius: var(--radius-sm); font-family: var(--font-ui); font-size: 0.85em;
                z-index: 11; box-shadow: 0 4px 15px rgba(59,130,246,0.4);
                cursor: pointer;
            `;
            hint.title = 'Cliquer pour annuler';
            hint.onclick = () => {
                this.pendingEntityPin = null;
                this.pendingFreePin = null;
                this._hideHint();
            };
            // planMap.js:5584 — `getElementById(...)?.parentElement?.appendChild(...)` :
            // cf. note générale en tête de fichier (adaptation de TYPAGE PUR).
            document.getElementById('plan_map')?.parentElement?.appendChild(hint);
        }
        hint.textContent = msg + ' (clic ici pour annuler)';
        // Téléphone, carte plein écran : la barre d'onglets collante recouvre
        // le haut de la carte ; la bulle se pose sous elle. Masquée (écran
        // scindé) ou au-dessus de la carte : 10 px comme avant.
        const bar = document.querySelector('.main-tab-bar');
        const wrap = hint.parentElement;
        const covered = bar && wrap ? bar.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top : 0;
        hint.style.top = `${Math.max(0, covered) + 10}px`;
        hint.style.display = 'block';
    },

    // planMap.js:5590-5593
    _hideHint(this: PlanMapInternal): void {
        const hint = document.getElementById('plan_hint');
        if (hint) hint.style.display = 'none';
    },
};
