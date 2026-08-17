/**
 * aoi.ts — Zone d'opération hors-ligne : cadrage, quota, téléchargement
 * (P2.CONV, paquet `pm-aoi`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 5 méthodes « ZONE D'OPÉRATION HORS-LIGNE (AOI) »
 * de `modules/pctac/planMap.js` (GStart-main, lecture seule) :
 *   - `_startAoiFraming`      (planMap.js:5307)
 *   - `_endAoiFraming`        (planMap.js:5383)
 *   - `_confirmAoi`           (planMap.js:5414)
 *   - `_runAoiDownload`       (planMap.js:5454)
 *   - `_createAoiProgressBar` (planMap.js:5508)
 *
 * Cf. docs/SPEC-PLANMAP-SPLIT.md §4.16 (signatures), §5.10 (INVARIANT : un
 * seul téléchargement à la fois — `_aoiDownloadBusy` remis à `false` sur les
 * 4 chemins de sortie), §1.2-1.3 (forme du groupe de méthodes `this`-typé),
 * §6.6 (ne pas mémoriser les lookups DOM entre APPELS).
 *
 * NB — `AOI_MIN_Z`/`AOI_MAX_Z` sont des DONNÉES posées par `createPlanMapState()`
 * (state.ts, planMap.js:5303-5304) : lues ici via `this.AOI_MIN_Z`/`this.AOI_MAX_Z`
 * comme l'original (planMap.js:5417), et NON redéclarées dans `AoiMethods`
 * (SPEC-PLANMAP-SPLIT.md §4.16, note).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

import { AOI_INDEX_KEY, AOI_MAX_TILES, LIDAR_HD_LAYERS } from './constants.js';
import { estimateTileCount, prefetchTiles, styleTileTemplates } from './tiles.js';
import type {
    AoiFramingHandlers,
    AoiIndexEntry,
    AoiProgressUi,
    GeoBBox,
    LngLatTuple,
    PlanMapInternal,
    TileTemplate,
} from './types.js';
import { Persist } from '@shared/persist.js';
import { confirmDialog, toast } from '@shared/feedback.js';

export const AoiMethods = {
    // ============================================================
    // ===========  ZONE D'OPÉRATION HORS-LIGNE (AOI)  ============
    //  Le bouton #plan_btn_aoi arme un cadrage rectangle one-shot sur
    //  l'objectif ; à la validation on estime tuiles + volume, on vérifie
    //  storage.estimate(), on demande confirmation, puis on télécharge dans
    //  le MAP_CACHE (mêmes templates réels que la carte) avec backoff/réessai
    //  et une barre de progression annulable injectée dynamiquement.
    //  Bornes : z13→z18 par défaut, emprise plafonnée à AOI_MAX_TILES tuiles.
    // ============================================================

    /** Arme le mode de cadrage rectangle pour définir l'AOI (one-shot). */
    // planMap.js:5307-5380
    _startAoiFraming(this: PlanMapInternal): void {
        if (!this.map) return;
        if (typeof caches === 'undefined') {
            toast('Cache hors-ligne indisponible sur ce navigateur (Cache Storage absent).', { kind: 'error' });
            return;
        }
        if (this._aoiFraming) return; // déjà en cours
        // On quitte tout outil de dessin/mesure pour ne pas mélanger les états.
        if (this.drawTool) this._setTool(null);
        // Un ping armé (placement en attente) serait posé par le premier tap du
        // cadrage : on le désarme, son hint serait de toute façon écrasé.
        this.pendingFreePin = null;
        this.pendingEntityPin = null;
        this._aoiFraming = true;
        const aoiBtn = document.getElementById('plan_btn_aoi');
        if (aoiBtn) aoiBtn.classList.add('active');

        // planMap.js:5324 — capture narrowée de `this.map` : les fermetures
        // down/move/up ci-dessous (invoquées bien plus tard, sur un vrai
        // événement carte) accèdent ainsi à la carte sans re-garde de
        // nullabilité. Même principe que `const map = this.map;` dans
        // draw-layers.ts `_initDrawingLayers` (adaptation de TYPAGE PUR,
        // aucun changement de comportement).
        const map = this.map;
        const canvas = map.getCanvas();
        canvas.style.cursor = 'crosshair';
        map.dragPan.disable();
        map.boxZoom.disable();
        map.doubleClickZoom.disable();
        this._showHint('Trace un rectangle sur la zone à télécharger (glisser-déposer). Échap ou touche ce message pour annuler.');

        let start: LngLatTuple | null = null;
        // planMap.js:5332 `const st = {}` puis assignations progressives —
        // ici les 5 handlers sont définis d'abord (mêmes corps, même ordre),
        // et `st` assemblé en un seul littéral juste avant l'enregistrement
        // des listeners : adaptation de TYPAGE PUR (`AoiFramingHandlers`
        // exige ses 5 champs non optionnels), comportement identique — la
        // fermeture de `down` référence `st._start` mais celui-ci n'est
        // résolu qu'au premier événement réel, bien après l'initialisation
        // de `st` (aucun risque de "used before declaration" : la référence
        // est dans un corps de fonction, pas dans le flux d'exécution direct).
        //
        // Annulation TACTILE : pas de touche Échap sur mobile — un tap sur le
        // hint annule. Garde : n'annule que si le cadrage est TOUJOURS actif
        // (un autre flux peut réutiliser le hint entre-temps).
        const hintClick = this._safe(() => { if (this._aoiFraming) this._endAoiFraming(); }, 'aoi:hintCancel');
        const hintEl = document.getElementById('plan_hint');
        if (hintEl) hintEl.addEventListener('click', hintClick);
        const down = this._safe((e: MapMouseEvent | MapTouchEvent) => {
            if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
            start = [e.lngLat.lng, e.lngLat.lat];
            st._start = start;
        }, 'aoi:down');
        const move = this._safe((e: MapMouseEvent | MapTouchEvent) => {
            if (!start) return;
            const cur: LngLatTuple = [e.lngLat.lng, e.lngLat.lat];
            this._renderPreview({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [this._rectPolygon(start, cur)] },
                properties: { color: '#22c55e' }
            });
        }, 'aoi:move');
        const up = this._safe((e: MapMouseEvent | MapTouchEvent) => {
            if (!start) return;
            const end: LngLatTuple = e.lngLat ? [e.lngLat.lng, e.lngLat.lat] : start;
            const p1 = map.project({ lng: start[0], lat: start[1] });
            const p2 = map.project({ lng: end[0], lat: end[1] });
            const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const s = start; start = null;
            if (distPx < 8) { return; } // simple clic : on attend un vrai rectangle
            this._endAoiFraming();
            const bbox: GeoBBox = {
                west: Math.min(s[0], end[0]),
                east: Math.max(s[0], end[0]),
                south: Math.min(s[1], end[1]),
                north: Math.max(s[1], end[1])
            };
            this._confirmAoi(bbox);
        }, 'aoi:up');
        const key = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') this._endAoiFraming(); };

        const st: AoiFramingHandlers = { down, move, up, key, hintClick };

        map.on('mousedown', st.down);
        map.on('mousemove', st.move);
        map.on('mouseup', st.up);
        map.on('touchstart', st.down);
        map.on('touchmove', st.move);
        map.on('touchend', st.up);
        document.addEventListener('keydown', st.key);
        this._aoiFramingHandlers = st;
    },

    /** Désarme le cadrage AOI et restaure les interactions de carte. */
    // planMap.js:5383-5411
    _endAoiFraming(this: PlanMapInternal): void {
        if (!this._aoiFraming) return;
        this._aoiFraming = false;
        const st = this._aoiFramingHandlers;
        if (st && this.map) {
            this.map.off('mousedown', st.down);
            this.map.off('mousemove', st.move);
            this.map.off('mouseup', st.up);
            this.map.off('touchstart', st.down);
            this.map.off('touchmove', st.move);
            this.map.off('touchend', st.up);
            document.removeEventListener('keydown', st.key);
        }
        if (st && st.hintClick) {
            const hintEl = document.getElementById('plan_hint');
            if (hintEl) hintEl.removeEventListener('click', st.hintClick);
        }
        this._aoiFramingHandlers = null;
        this._clearPreview();
        if (this.map) {
            this.map.getCanvas().style.cursor = '';
            this.map.dragPan.enable();
            this.map.boxZoom.enable();
            this.map.doubleClickZoom.enable();
        }
        const aoiBtn = document.getElementById('plan_btn_aoi');
        if (aoiBtn) aoiBtn.classList.remove('active');
        this._hideHint();
    },

    /** Estime tuiles + volume, vérifie le quota, demande confirmation, lance. */
    // planMap.js:5414-5451
    async _confirmAoi(this: PlanMapInternal, bbox: GeoBBox): Promise<void> {
        // L'ombrage LiDAR HD affiché au moment du téléchargement part AVEC l'AOI :
        // sans ça, la couche disparaîtrait hors ligne alors qu'elle est justement
        // celle qui sert sur le terrain (relief sous couvert). Hors planMap.js.
        const lidarSourceId = this.lidarLayer ? LIDAR_HD_LAYERS[this.lidarLayer].sourceId : null;
        const templates: TileTemplate[] = styleTileTemplates(lidarSourceId ? [lidarSourceId] : []);
        if (!templates.length) { toast('Aucune source cartographique disponible.', { kind: 'error' }); return; }
        const minZ = this.AOI_MIN_Z, maxZ = this.AOI_MAX_Z;
        const tileCount = estimateTileCount(bbox, minZ, maxZ, templates);
        if (tileCount === 0) { toast('Zone hors couverture des sources cartographiques.', { kind: 'error' }); return; }
        if (tileCount > AOI_MAX_TILES) {
            toast(`Zone trop vaste : ${tileCount.toLocaleString('fr-FR')} tuiles (max ${AOI_MAX_TILES.toLocaleString('fr-FR')}). `
                + 'Réduis l\'emprise ou refais un rectangle plus petit.', { kind: 'error' });
            return;
        }
        // Estimation volume : ~22 Ko/tuile satellite/ortho, ~12 Ko/tuile DEM (ordre de grandeur).
        const approxBytes = tileCount * 22 * 1024;
        const mb = (approxBytes / (1024 * 1024));

        // Vérification du quota disponible (best-effort).
        let quotaWarn = '';
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                if (est && typeof est.quota === 'number' && typeof est.usage === 'number') {
                    const freeMb = (est.quota - est.usage) / (1024 * 1024);
                    if (freeMb < mb) {
                        quotaWarn = `\n\nATTENTION : espace libre estimé ${freeMb.toFixed(0)} Mo < besoin ${mb.toFixed(0)} Mo. Le téléchargement risque d'être incomplet.`;
                    }
                }
            }
        } catch { /* estimate indispo : on tente quand même */ }

        const ok = await confirmDialog({
            title: 'Télécharger la carte de cette zone pour usage hors-ligne ?',
            message: `Zoom ${minZ} → ${maxZ}\n`
                + `Tuiles : ~${tileCount.toLocaleString('fr-FR')}\n`
                + `Volume estimé : ~${mb < 1 ? '<1' : mb.toFixed(0)} Mo${quotaWarn}`,
            confirmLabel: 'Télécharger',
        });
        if (!ok) return;
        this._runAoiDownload(bbox, minZ, maxZ, templates, tileCount);
    },

    /** Lance le téléchargement avec barre de progression annulable. */
    // planMap.js:5454-5505
    async _runAoiDownload(
        this: PlanMapInternal,
        bbox: GeoBBox,
        minZ: number,
        maxZ: number,
        templates: readonly TileTemplate[],
        estTotal: number,
    ): Promise<void> {
        // Un seul téléchargement AOI à la fois : sinon deux barres de progression
        // (même id DOM) se superposent et les requêtes de tuiles se cumulent.
        if (this._aoiDownloadBusy) {
            toast('Un téléchargement de zone est déjà en cours. Attends la fin (ou annule-le) avant d\'en lancer un autre.', { kind: 'error' });
            return;
        }
        this._aoiDownloadBusy = true;
        const ui = this._createAoiProgressBar(estTotal);
        const signal = { aborted: false };
        ui.cancelBtn.onclick = () => { signal.aborted = true; ui.setLabel('Annulation…'); };

        let result;
        try {
            result = await prefetchTiles(bbox, minZ, maxZ, templates, (done, total, okC, failC) => {
                ui.update(done, total, okC, failC);
            }, { signal });
        } catch (e) {
            console.error('[PlanMap] AOI téléchargement échec:', e);
            // `catch (e)` typé `unknown` (useUnknownInCatchVariables, inclus dans
            // `strict`) — `e.message` exige un narrowing. Idiome déjà en place
            // dans le projet (planmap/capture.ts, src/shared/ui-platform.ts:100).
            ui.setLabel('Erreur : ' + (e instanceof Error && e.message ? e.message : 'cache indisponible'));
            setTimeout(() => ui.remove(), 3500);
            this._aoiDownloadBusy = false;
            return;
        }

        if (result.aborted) {
            ui.setLabel('Annulé. Tuiles déjà mises en cache conservées.');
            setTimeout(() => ui.remove(), 2500);
            this._aoiDownloadBusy = false;
            return;
        }

        // Persiste un INDEX des AOI confirmées (pas un flag binaire) avec son statut.
        try {
            const index = Persist.get<AoiIndexEntry[]>(AOI_INDEX_KEY, { validator: Array.isArray, fallback: [] }) || [];
            index.push({
                bbox, minZ, maxZ,
                total: result.total, ok: result.ok, fail: result.fail,
                complete: result.fail === 0,
                ts: Date.now()
            });
            Persist.set(AOI_INDEX_KEY, index);
        } catch { /* persistance non bloquante */ }

        if (result.fail === 0) {
            ui.setLabel(`Zone téléchargée : ${result.ok.toLocaleString('fr-FR')} tuiles en cache hors-ligne.`);
        } else {
            ui.setLabel(`Terminé avec ${result.fail.toLocaleString('fr-FR')} tuile(s) manquante(s) (réseau). Relance pour compléter.`);
        }
        setTimeout(() => ui.remove(), 3500);
        this._aoiDownloadBusy = false;
    },

    /** Crée dynamiquement (PAS dans le HTML) la barre de progression AOI. */
    // planMap.js:5508-5564
    _createAoiProgressBar(this: PlanMapInternal, estTotal: number): AoiProgressUi {
        // planMap.js:5509-5511 — un seul appel à getElementById (au lieu de
        // deux dans l'original) : adaptation de TYPAGE PUR pour permettre le
        // narrowing sans `!` (même principe que `const map = this.map;` dans
        // draw-layers.ts). Le repli `?? document.body` couvre un cas de
        // nullabilité que le typage strict expose mais que l'original ne
        // gardait pas (`parentElement` null) : jamais atteint en pratique
        // (le conteneur #plan_map est toujours attaché au DOM avec un parent).
        const planMapEl = document.getElementById('plan_map');
        const host: HTMLElement = planMapEl ? (planMapEl.parentElement ?? document.body) : document.body;
        const wrap = document.createElement('div');
        wrap.id = 'plan_aoi_progress';
        wrap.style.cssText = `
            position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
            z-index: 30; min-width: 260px; max-width: 92%;
            background: rgba(16,20,28,0.95); color: #fff;
            border: 1px solid var(--border-glass, rgba(255,255,255,0.15));
            border-radius: 10px; padding: 12px 14px;
            font-family: var(--font-ui, sans-serif); font-size: 13px;
            box-shadow: 0 6px 24px rgba(0,0,0,0.5);
        `;
        const label = document.createElement('div');
        label.style.cssText = 'margin-bottom: 8px; line-height: 1.3;';
        label.textContent = `Préparation du téléchargement (~${estTotal.toLocaleString('fr-FR')} tuiles)…`;
        const barOuter = document.createElement('div');
        barOuter.style.cssText = 'height: 8px; border-radius: 5px; background: rgba(255,255,255,0.12); overflow: hidden;';
        const barInner = document.createElement('div');
        barInner.style.cssText = 'height: 100%; width: 0%; background: #22c55e; transition: width 0.15s linear;';
        barOuter.appendChild(barInner);
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px;';
        const stat = document.createElement('span');
        stat.style.cssText = 'font-family: var(--font-data, ui-monospace, monospace); font-size: 12px; color: var(--text-muted, #9aa4b2);';
        stat.textContent = '0 %';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Annuler';
        cancelBtn.style.cssText = `
            background: rgba(239,68,68,0.18); color: #fff;
            border: 1px solid rgba(239,68,68,0.5); border-radius: 6px;
            padding: 5px 12px; cursor: pointer; font-size: 12px;
        `;
        row.appendChild(stat);
        row.appendChild(cancelBtn);
        wrap.appendChild(label);
        wrap.appendChild(barOuter);
        wrap.appendChild(row);
        host.appendChild(wrap);

        return {
            cancelBtn,
            setLabel: (txt: string): void => { label.textContent = txt; cancelBtn.style.display = 'none'; },
            // planMap.js:5554-5561 — `okC` (3ᵉ paramètre) n'est déjà pas lu dans le
            // corps d'origine ; préfixé `_` pour satisfaire `noUnusedParameters`
            // (TS strict) sans changer la forme `AoiProgressUi.update` (typage
            // structurel : le nom de paramètre n'est pas contractuel).
            update: (done: number, total: number, _okC: number, failC: number): void => {
                const pct = total ? Math.round((done / total) * 100) : 0;
                barInner.style.width = pct + '%';
                const remaining = total - done;
                stat.textContent = `${pct} % · ${remaining.toLocaleString('fr-FR')} restantes`
                    + (failC ? ` · ${failC} échec(s)` : '');
                label.textContent = `Téléchargement de la zone d'opération… (${done.toLocaleString('fr-FR')}/${total.toLocaleString('fr-FR')})`;
            },
            remove: (): void => { try { wrap.remove(); } catch { /* déjà retiré du DOM — sans effet */ } }
        };
    },
};
