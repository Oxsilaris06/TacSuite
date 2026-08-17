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
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';

import { escHtml } from './constants.js';
import { showBusy, hideBusy } from '@pctac/busy.js';
import type { PlanMapInternal } from './types.js';

/** Résultat Nominatim (endpoint `/search`) — seuls les champs lus par `_searchAddress`. */
interface NominatimResult {
    display_name: string;
    lon: string;
    lat: string;
}

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

        // Fermeture au clic extérieur : tiroir « Plus » et panneau « Calques ».
        if ((btnMore && moreTools) || (btnLayers && layersPanel)) {
            document.addEventListener('click', (e) => {
                const t = e.target as Node;
                if (moreTools && !moreTools.hidden && btnMore && !moreTools.contains(t) && !btnMore.contains(t)) closeMoreDrawer();
                if (layersPanel && layersPanel.classList.contains('open') && btnLayers && !layersPanel.contains(t) && !btnLayers.contains(t)) closeLayersPanel();
            });
            // Échap : ferme le tiroir « Plus » ou le panneau « Calques » si ouvert.
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (moreTools && !moreTools.hidden) closeMoreDrawer();
                else if (layersPanel && layersPanel.classList.contains('open')) closeLayersPanel();
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

    // planMap.js:824-889 — INVARIANT §5.7 : jeton de séquence Nominatim. `seq`
    // est incrémenté AVANT toute branche (GPS comprise), et le double test
    // `if (seq !== this._searchSeq) return;` reste posé aux DEUX endroits
    // (succès :856, échec :883) — une réponse Nominatim lente ne doit jamais
    // écraser une recherche plus récente.
    async _searchAddress(this: PlanMapInternal): Promise<void> {
        const input = document.getElementById('plan_address_input') as HTMLInputElement | null;
        const resultsBox = document.getElementById('plan_search_results');
        if (!input || !resultsBox) return;
        const q = input.value.trim();
        if (!q) return;

        // Jeton de séquence incrémenté AVANT toute branche (GPS comprise) : une
        // réponse Nominatim en vol d'une recherche précédente ne doit écraser NI un
        // résultat d'adresse plus récent NI un centrage GPS direct.
        const seq = (this._searchSeq = (this._searchSeq || 0) + 1);

        // 1) Coordonnées GPS directes → on centre immédiatement
        const gps = this._parseGps(q);
        if (gps) {
            // planMap.js:839 — garde de typage (`this.map` nullable), cf. note
            // générale en tête de fichier ; jamais null en pratique.
            if (this.map) this.map.flyTo({ center: [gps.lng, gps.lat], zoom: 17, speed: 1.4 });
            this._placeSearchMarker(gps.lng, gps.lat, `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`);
            resultsBox.innerHTML = `
                <div class="plan-search-result" style="padding: 8px; border-bottom: 1px solid var(--border-glass); display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 16px; color: var(--ao-green);">my_location</span>
                    Point GPS centré : ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}
                </div>`;
            return;
        }

        // 2) Sinon, géocodage d'adresse via Nominatim
        resultsBox.innerHTML = '<em style="color: var(--text-muted);">Recherche…</em>';
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
            const r = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            // planMap.js:855 — typage du JSON externe (`any` interdit, SPEC-CONTRATS.md §0.1).
            const list = (await r.json()) as NominatimResult[];
            if (seq !== this._searchSeq) return; // réponse périmée : ignorer
            if (!list.length) {
                resultsBox.innerHTML = '<em style="color: var(--text-muted);">Aucun résultat.</em>';
                return;
            }
            // Centrage + pointeur sur le 1er résultat (le plus probable)
            const first = list[0];
            // Garde de typage (noUncheckedIndexedAccess) : `list.length` déjà
            // vérifié > 0 juste au-dessus, branche `!first` inatteignable —
            // cf. SPEC-PLANMAP-SPLIT.md §6.3.
            if (!first) return;
            const flng = parseFloat(first.lon), flat = parseFloat(first.lat);
            if (this.map) this.map.flyTo({ center: [flng, flat], zoom: 17, speed: 1.4 });
            this._placeSearchMarker(flng, flat, first.display_name);
            resultsBox.innerHTML = list.map((item, i) => `
                <div class="plan-search-result" data-idx="${i}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--border-glass);">
                    ${escHtml(item.display_name)}
                </div>
            `).join('');
            resultsBox.querySelectorAll<HTMLDivElement>('.plan-search-result').forEach((div) => {
                div.onclick = () => {
                    // planMap.js:873 — `String(...)` reproduit la coercion native de
                    // `parseInt(undefined, 10)` (ToString → "undefined" → NaN), même
                    // idiome que text-modal.ts (`_confirmTextModal`).
                    const idx = parseInt(String(div.dataset.idx), 10);
                    const item = list[idx];
                    // Garde de typage (noUncheckedIndexedAccess) : `data-idx` est posé
                    // par nous-mêmes juste au-dessus sur les indices valides de `list`
                    // — branche inatteignable, cf. SPEC-PLANMAP-SPLIT.md §6.3.
                    if (!item) return;
                    const lng = parseFloat(item.lon), lat = parseFloat(item.lat);
                    if (this.map) this.map.flyTo({ center: [lng, lat], zoom: 17, speed: 1.4 });
                    this._placeSearchMarker(lng, lat, item.display_name);
                    resultsBox.innerHTML = '';
                };
                div.onmouseover = () => { div.style.background = 'rgba(59, 130, 246, 0.15)'; };
                div.onmouseout = () => { div.style.background = ''; };
            });
        } catch (e) {
            if (seq !== this._searchSeq) return; // échec d'une requête périmée : ignorer
            console.error('[PlanMap] Nominatim échec:', e);
            resultsBox.innerHTML = '<em style="color: var(--danger-red);">Erreur réseau. Vérifie ta connexion.</em>';
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
        hint.style.display = 'block';
    },

    // planMap.js:5590-5593
    _hideHint(this: PlanMapInternal): void {
        const hint = document.getElementById('plan_hint');
        if (hint) hint.style.display = 'none';
    },
};
