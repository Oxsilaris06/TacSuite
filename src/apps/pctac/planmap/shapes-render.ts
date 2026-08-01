/**
 * shapes-render.ts — Rendu des formes, textes, diamètres, cadenas (P2.CONV,
 * paquet `pm-shapesrender`).
 * ===========================================================================
 *
 * Port TypeScript verbatim des 12 méthodes de `docs/SPEC-PLANMAP-SPLIT.md`
 * §4.10 (`planMap.js:2604-4853`, hors les groupes voisins entrelacés) :
 *   - :2604 `_renderShapes`        — synchronise la source GeoJSON `plan-shapes-src`
 *   - :2738 `_renderDiameters`     — étiquettes ⌀ des cercles (toggle global)
 *   - :2791 `_toggleLock`          — verrou GLOBAL (pings + dessins)
 *   - :2806 `_updateLockButton`    — reflète `_locked` sur le bouton dock
 *   - :2819 `_toggleGlobalDiameter`— toggle ON/OFF affichage des diamètres
 *   - :3088 `_renderShapeLocks`    — cadenas cliquables PAR FORME (réconciliation par id)
 *   - :3489 `_adjustFontSize`      — +/- taille de police d'une forme
 *   - :3503 `_adjustStrokeWidth`   — +/- épaisseur de trait d'une forme
 *   - :3516 `_toggleShapeDiameter` — toggle affichage diamètre d'UNE forme
 *   - :4319 `_toggleShapeLock`     — verrou PAR FORME (indépendant du verrou global)
 *   - :4746 `_shapePixelBounds`    — bounding-box pixels d'une forme au zoom courant
 *   - :4769 `_renderShapeTexts`    — annotations texte des formes (HTML markers)
 *
 * Corps VERBATIM (SPEC-PLANMAP-SPLIT §1.2-1.3) : seules des adaptations de
 * TYPAGE strict sont apportées (capture `const map = this.map;` après un
 * garde de non-nullité — `this.map` n'est pas re-narrowé à travers un appel
 * de méthode, cf. `draw-layers.ts` ; générique `getSource<GeoJSONSource>` ;
 * `coordAt`/`shapeCoords` de `./geo.js` en lieu d'indexation brute, cf. §6.3
 * plus bas). Aucune restructuration de logique, aucun changement d'ordre.
 *
 * ⚠ INVARIANT MARKER (SPEC-PLANMAP-SPLIT §5.1, étendu ici par la mission à ce
 * paquet) : les éléments DOM passés à `new maplibregl.Marker({ element, … })`
 * dans `_renderDiameters` et `_renderShapeTexts` ne portent JAMAIS `position:`
 * ni `inset:` dans leur `style.cssText` — c'est MapLibre qui positionne
 * l'élément via `transform`. `_renderShapeLocks` ne construit aucun style lui-
 * même (délégué à `_makeLockBadge`/`_applyLockBadgeStyle` de `pins.ts`, dont le
 * variant `'marker'` n'ajoute pas non plus `position:`, cf. planMap.js:1265-1267).
 *
 * ⚠ INVARIANT VERROU PAR-FORME (SPEC-PLANMAP-SPLIT §5.4) :
 *   - `_toggleShapeLock(shapeId, reopenWheel = true)` — le défaut `true` est
 *     REQUIS (rouvre la roue) ; le cadenas direct appelle avec `false`.
 *   - `_renderShapeLocks` réconcilie PAR ID via une `Map` (planMap.js:3090-3118) :
 *     ne JAMAIS repasser à une destruction/recréation systématique des markers
 *     (c'est ce qui causait le scintillement).
 *
 * `_toggleLock` (verrou GLOBAL) écrit directement `localStorage.setItem(
 * 'pcTacPlanLocked', …)` (planMap.js:2793) : accès direct conservé tel quel
 * (SPEC-PCTAC-CONVERSION §6 — préférence d'UI, pas une donnée opérationnelle).
 *
 * §6.3 `noUncheckedIndexedAccess` : `coordAt`/`shapeCoords` de `./geo.js`,
 * jamais `!`. Chaque site de repli neutre est commenté individuellement.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';

import { coordAt, shapeCoords } from './geo.js';
import type { PlanMapInternal, PlanShape } from './types.js';

export const ShapesRenderMethods = {
    // planMap.js:2604-2665
    _renderShapes(this: PlanMapInternal): void {
        if (!this.map) return;
        const map = this.map;
        // `this.map` déjà garanti non-null ci-dessus (capturé dans `map`) : le
        // `this.map &&` de l'original devient inutile — cf. en-tête de fichier.
        const src = map.getSource<GeoJSONSource>('plan-shapes-src');
        if (!src) return;
        const list = this._loadShapes();
        const features: GeoJSON.Feature[] = [];
        for (const s of list) {
            if (s.type === 'line') {
                features.push({ type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: shapeCoords(s) }, properties: { color: s.color, shapeId: s.id, strokeWidth: s.strokeWidth || 3 } });
            } else if (s.type === 'rectangle' || s.type === 'circle') {
                features.push({ type: 'Feature', id: s.id, geometry: { type: 'Polygon', coordinates: [shapeCoords(s)] }, properties: { color: s.color, shapeId: s.id, strokeWidth: s.strokeWidth || 3 } });
            } else if (s.type === 'text') {
                // Petite zone "hit" invisible autour du point pour rendre le clic possible.
                // Carré de ~14 px à l'écran, projeté en degrés.
                // `shapeCoords(s)[0]` : accès indexé neutralisé pour `noUncheckedIndexedAccess` ;
                // `c` peut légitimement être `undefined` (coords vide) — le garde `if (c)`
                // ci-dessous reproduit exactement le comportement de l'original
                // (`s.coords[0]` pouvait déjà valoir `undefined`). SPEC-PLANMAP-SPLIT §6.3.
                const c = shapeCoords(s)[0];
                if (c) {
                    const p = map.project({ lng: c[0], lat: c[1] });
                    const pad = 14;
                    const sw = map.unproject([p.x - pad, p.y + pad]);
                    const ne = map.unproject([p.x + pad, p.y - pad]);
                    features.push({
                        type: 'Feature', id: s.id,
                        geometry: { type: 'Polygon', coordinates: [[
                            [sw.lng, sw.lat], [ne.lng, sw.lat],
                            [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat],
                        ]] },
                        properties: { color: s.color, shapeId: s.id, isText: true },
                    });
                }
            } else if (s.type === 'measure') {
                // Mesure persistée : polyligne d'annotation. PAS de shapeId → non
                // sélectionnable (les étiquettes/le tracé sont en lecture seule ;
                // suppression via Effacer ou Annuler). Réutilise la même couche ligne.
                if (Array.isArray(s.coords) && s.coords.length >= 2) {
                    features.push({
                        type: 'Feature', id: s.id,
                        geometry: { type: 'LineString', coordinates: s.coords },
                        properties: { color: s.color || '#22d3ee', strokeWidth: s.strokeWidth || 3 },
                    });
                }
            } else if (s.type === 'measure-rings') {
                // Anneaux d'engagement : cercles concentriques (annotation lecture seule).
                if (Array.isArray(s.rings)) {
                    for (const ring of s.rings) {
                        if (!ring || !Array.isArray(ring.coords)) continue;
                        features.push({
                            type: 'Feature',
                            geometry: { type: 'Polygon', coordinates: [ring.coords] },
                            properties: { color: s.color || '#22d3ee', strokeWidth: s.strokeWidth || 2 },
                        });
                    }
                }
            }
        }
        src.setData({ type: 'FeatureCollection', features });
        // Toujours synchroniser texte / diamètres / handles / toolbar avec les formes
        this._renderShapeTexts();
        this._renderDiameters();
        this._renderCommittedMeasures();
        this._renderHandles();
        this._renderShapeLocks();
        this._updateFloatingToolbarPos();
    },

    // ============================================================
    // ====================  DIAMÈTRES CERCLE  ===================
    // ============================================================
    // planMap.js:2738-2788
    _renderDiameters(this: PlanMapInternal): void {
        if (this._diameterMarkers) this._diameterMarkers.forEach(m => { try { m.remove(); } catch { /* déjà retiré du DOM — sans effet */ } });
        this._diameterMarkers = [];
        if (!this.map) return;
        const map = this.map;
        if (!this._diameterGlobal) return;
        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type !== 'circle') continue;
            if (s.showDiameter === false) continue;
            const d = this._circleDiameter(s);
            if (!d) continue;
            // `d` non nul ⇒ `_circleDiameter` a trouvé un centre/coords[0] valide
            // (même forme `s`, même calcul `s.center || s.coords[0]`) : `coordAt`
            // ne retombe donc jamais sur `[0,0]` ici en pratique — repli neutre
            // exigé par `noUncheckedIndexedAccess`. SPEC-PLANMAP-SPLIT §6.3.
            const c = s.center || coordAt(s, 0);
            const label = `⌀ ${this._formatDistance(d)}`;
            const div = document.createElement('div');
            div.className = 'plan-diameter-label';
            div.textContent = label;
            div.style.cssText = `
                background: rgba(20,24,32,0.85);
                color: #fff;
                padding: 3px 9px;
                border-radius: 10px;
                border: 1px solid ${s.color || '#fff'};
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 12px;
                font-weight: 600;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            `;

            // Position : strictement SOUS le texte de la forme (s'il y en a), sinon centré.
            // On mesure dynamiquement la hauteur du marker texte associé pour éviter
            // tout chevauchement quelle que soit la taille du texte ou du diamètre.
            let offsetY = 14;
            const txtMarker = this._textMarkersById && this._textMarkersById[s.id];
            if (txtMarker) {
                const txtEl = txtMarker.getElement();
                if (txtEl) {
                    // hauteur réelle du bloc texte (avec wrap éventuel + padding)
                    const txtH = txtEl.offsetHeight || txtEl.getBoundingClientRect().height || 18;
                    // Le texte est centré sur le centre du cercle ; sa moitié de hauteur
                    // est sous l'ancrage. On positionne le diamètre encore en-dessous
                    // avec un padding visuel de 6 px.
                    offsetY = Math.round(txtH / 2 + 6 + 9); // + demi-hauteur diamètre (~9)
                }
            }
            const m = new maplibregl.Marker({ element: div, anchor: 'center', offset: [0, offsetY] })
                .setLngLat([c[0], c[1]]).addTo(map);
            this._diameterMarkers.push(m);
        }
    },

    /** Verrouille / déverrouille la position des pings ET des dessins. */
    // planMap.js:2791-2804
    _toggleLock(this: PlanMapInternal): void {
        this._locked = !this._locked;
        try { localStorage.setItem('pcTacPlanLocked', this._locked ? '1' : '0'); } catch { /* quota plein — ignoré, comme l'original */ }
        this._updateLockButton();
        // En verrouillant, on retire les poignées de la forme sélectionnée.
        if (this._locked) this._clearHandles();
        else this._renderHandles();
        // Recrée les pings pour appliquer le nouveau draggable.
        this._renderPins();
        this._showHint(this._locked
            ? 'Positions verrouillées : pings et dessins figés'
            : 'Positions déverrouillées : déplacement réactivé');
        setTimeout(() => this._hideHint(), 1600);
    },

    // planMap.js:2806-2816
    _updateLockButton(this: PlanMapInternal): void {
        const btn = document.getElementById('plan_draw_lock');
        if (!btn) return;
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = this._locked ? 'lock' : 'lock_open';
        btn.style.color = this._locked ? '#eab308' : 'var(--text-main)';
        btn.title = this._locked
            ? 'Positions verrouillées (cliquer pour déverrouiller)'
            : 'Verrouiller la position des pings/dessins';
        btn.classList.toggle('active', this._locked);
    },

    /** Toggle global ON/OFF (depuis la toolbar dessin). */
    // planMap.js:2819-2830
    _toggleGlobalDiameter(this: PlanMapInternal): void {
        this._diameterGlobal = !this._diameterGlobal;
        const btn = document.getElementById('plan_draw_diameter_toggle');
        if (btn) {
            btn.style.color = this._diameterGlobal ? '#22c55e' : 'var(--text-muted)';
            btn.title = this._diameterGlobal ? 'Diamètres affichés (cliquer pour masquer)' : 'Diamètres masqués (cliquer pour afficher)';
        }
        this._renderDiameters();
        if (this._activeWheel && this._selectedShapeId) {
            this._openShapeWheel(this._selectedShapeId, this._activeWheel.lngLat);
        }
    },

    /**
     * Marqueur cadenas cliquable par forme. Affiché pour toute forme VERROUILLÉE
     * (pour pouvoir la déverrouiller) ou actuellement SÉLECTIONNÉE (pour la verrouiller).
     * Ancré au centroïde, légèrement au-dessus pour ne pas gêner la poignée centrale.
     * Réconciliation par id (comme les pings) : pas de recréation inutile.
     */
    // planMap.js:3088-3120
    _renderShapeLocks(this: PlanMapInternal): void {
        if (!this.map) return;
        const map = this.map;
        if (!this._shapeLockMarkers) this._shapeLockMarkers = new Map();
        const shapeLockMarkers = this._shapeLockMarkers;
        const shapes = this._loadShapes();
        const seen = new Set<string>();
        for (const s of shapes) {
            if (!s.id) continue;                       // mesures/anneaux : non verrouillables
            const show = !!s.locked || this._selectedShapeId === s.id;
            if (!show) continue;
            seen.add(s.id);
            const c = this._shapeCentroid(s);
            let entry = shapeLockMarkers.get(s.id);
            if (!entry) {
                const shapeId = s.id;
                const el = this._makeLockBadge(!!s.locked, () => this._toggleShapeLock(shapeId, false), 'marker');
                const m = new maplibregl.Marker({ element: el, anchor: 'center', offset: [0, -20] })
                    .setLngLat(c).addTo(map);
                entry = { marker: m, el, locked: !!s.locked };
                shapeLockMarkers.set(s.id, entry);
            } else {
                entry.marker.setLngLat(c);
                if (entry.locked !== !!s.locked) {
                    this._applyLockBadgeStyle(entry.el, !!s.locked, 'marker');
                    entry.locked = !!s.locked;
                }
            }
        }
        for (const [id, entry] of shapeLockMarkers) {
            if (seen.has(id)) continue;
            try { entry.marker.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
            shapeLockMarkers.delete(id);
        }
    },

    // planMap.js:3489-3500
    _adjustFontSize(this: PlanMapInternal, shapeId: string, delta: number): void {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        this._pushHistory();
        const cur = s.fontSize || 13;
        s.fontSize = Math.max(9, Math.min(72, cur + delta));
        this._saveShapes(list);
        this._renderShapes();
        this._renderHandles();
        this._refreshUndoRedoButtons();
    },

    /** Ajuste l'épaisseur du trait d'une forme (trait / cercle / rectangle). */
    // planMap.js:3503-3514
    _adjustStrokeWidth(this: PlanMapInternal, shapeId: string, delta: number): void {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        this._pushHistory();
        const cur = s.strokeWidth || 3;
        s.strokeWidth = Math.max(1, Math.min(24, cur + delta));
        this._saveShapes(list);
        this._renderShapes();
        this._renderHandles();
        this._refreshUndoRedoButtons();
    },

    // planMap.js:3516-3527
    _toggleShapeDiameter(this: PlanMapInternal, shapeId: string): void {
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s || s.type !== 'circle') return;
        s.showDiameter = !(s.showDiameter !== false); // toggle, défaut true
        this._saveShapes(list);
        this._renderDiameters();
        if (this._activeWheel) {
            // Si la roue est ouverte, on la rafraîchit pour l'icône à jour
            this._openShapeWheel(shapeId, this._activeWheel.lngLat);
        }
    },

    /** Verrouille / déverrouille la position+taille d'UNE forme (indépendamment du verrou global). */
    // planMap.js:4319-4334
    _toggleShapeLock(this: PlanMapInternal, shapeId: string, reopenWheel = true): void {
        const anchor = this._activeWheel ? this._activeWheel.lngLat : null;
        const list = this._loadShapes();
        const s = list.find(x => x.id === shapeId);
        if (!s) return;
        s.locked = !s.locked;
        this._saveShapes(list);
        // Forme verrouillée : on retire les poignées ; sinon on les réaffiche.
        if (s.locked) this._clearHandles();
        else this._renderHandles();
        this._renderShapes();       // rafraîchit aussi les cadenas via _renderShapeLocks
        this._showHint(s.locked ? 'Dessin verrouillé' : 'Dessin déverrouillé');
        setTimeout(() => this._hideHint(), 1400);
        // Depuis la roue : la rouvre pour refléter l'état. Depuis le cadenas direct : non.
        if (reopenWheel) this._openShapeWheel(shapeId, anchor || this._shapeAnchor(s));
    },

    /** Bounding-box pixels (à zoom courant) d'une forme. */
    // planMap.js:4746-4757
    _shapePixelBounds(this: PlanMapInternal, s: PlanShape): { width: number; height: number } {
        if (!this.map) return { width: 100, height: 50 };
        const map = this.map;
        if (s.type === 'text') return { width: 240, height: 80 };
        const coords = shapeCoords(s);
        if (!coords.length) return { width: 100, height: 50 };
        const pts = coords.map(c => map.project({ lng: c[0], lat: c[1] }));
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return {
            width:  Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
        };
    },

    /**
     * Rendu des annotations texte des formes (HTML markers).
     *  - line  : centré sur le milieu du trait, légèrement au-dessus
     *  - rect  : centré dans le rectangle, max-width ~ largeur
     *  - circ  : centré, max-width ~ diamètre × 0.7 (carré inscrit)
     *  - text  : annotation libre, max-width fixe
     *
     * Tronqué visuellement par `overflow: hidden` + max-height pour
     * garantir qu'il ne dépasse jamais la forme.
     */
    // planMap.js:4769-4853
    _renderShapeTexts(this: PlanMapInternal): void {
        if (!this.map) return;
        const map = this.map;
        // Purge des markers précédents
        if (this._textMarkers) this._textMarkers.forEach(m => m.remove());
        this._textMarkers = [];
        // Index par shape ID pour que les diamètres puissent se positionner sous le texte
        this._textMarkersById = {};

        const shapes = this._loadShapes();
        for (const s of shapes) {
            if (s.type !== 'text' && !s.text) continue;          // pas de texte = rien à afficher
            if (s.type === 'text' && !s.text) continue;          // text vide = caché
            const anchor = this._shapeAnchor(s);
            if (!anchor) continue;
            const bounds = this._shapePixelBounds(s);

            // TS strict : `maxW`/`maxH` initialisés à `NaN`, valeur que produirait
            // `Math.round(undefined)` de l'original quand `s.type` n'est ni 'line',
            // 'rectangle', 'circle' ni 'text' (branche atteignable seulement si une
            // forme 'measure'/'measure-rings' porte un `.text` non vide — jamais
            // produit par l'UI en pratique) : sortie CSS strictement identique
            // ("NaNpx"). Même principe que `coordAt`, SPEC-PLANMAP-SPLIT §6.3.
            let maxW = NaN, maxH = NaN, offsetY = 0;
            if (s.type === 'line') {
                maxW = Math.max(60, bounds.width * 0.95);
                maxH = 48;
                offsetY = -18;
            } else if (s.type === 'rectangle') {
                maxW = Math.max(40, bounds.width  * 0.92);
                maxH = Math.max(20, bounds.height * 0.92);
            } else if (s.type === 'circle') {
                const d = Math.min(bounds.width, bounds.height);
                maxW = Math.max(36, d * 0.7);
                maxH = Math.max(20, d * 0.7);
            } else if (s.type === 'text') {
                maxW = 240; maxH = 120;
            }

            const div = document.createElement('div');
            div.className = 'plan-shape-text';
            div.textContent = s.text || '';
            const col = s.textColor || s.color || '#fff';
            const fontSize = Math.max(9, Math.min(72, s.fontSize || 13));
            div.style.cssText = `
                color: ${col};
                text-shadow:
                    0 0 3px rgba(0,0,0,0.95),
                    0 0 6px rgba(0,0,0,0.7),
                    0 1px 2px rgba(0,0,0,0.9);
                font-family: var(--font-ui, system-ui, sans-serif);
                font-weight: 700;
                font-size: ${fontSize}px;
                line-height: 1.18;
                text-align: center;
                max-width: ${Math.round(maxW)}px;
                max-height: ${Math.round(maxH)}px;
                white-space: pre-wrap;
                overflow: hidden;
                pointer-events: auto;          /* interactif : tap/drag */
                cursor: grab;
                padding: 1px 4px;
                box-sizing: border-box;
                user-select: none;
                -webkit-user-select: none;
                -webkit-touch-callout: none;
                touch-action: none;
            `;
            // Délégation au state-machine gestuelle commune : tap = menu, drag = déplacer
            const shapeId = s.id;
            const onTextPointerDown = (ev: PointerEvent | TouchEvent): void => {
                if (this.drawTool || this.moveState || this._gesture) return;
                ev.preventDefault();
                ev.stopPropagation();
                // Convertit la position pointeur → lngLat carte
                const rect = map.getCanvas().getBoundingClientRect();
                // `'touches' in ev` / `'clientX' in ev` = équivalent TS-safe de
                // `ev.touches`/`ev.clientX` en duck-typing (PointerEvent n'a pas
                // `touches`, TouchEvent n'a pas `clientX` — cf. draw-layers.ts).
                const touch = 'touches' in ev ? ev.touches[0] : undefined;
                const clientX = touch ? touch.clientX : (('clientX' in ev && ev.clientX) || 0);
                const clientY = touch ? touch.clientY : (('clientY' in ev && ev.clientY) || 0);
                const x = clientX - rect.left;
                const y = clientY - rect.top;
                const lngLat = map.unproject([x, y]);
                this._startShapeGesture(shapeId, lngLat, ev);
            };
            div.addEventListener('pointerdown', onTextPointerDown);
            // Fallback pour vieux iOS sans Pointer Events
            div.addEventListener('touchstart', onTextPointerDown, { passive: false });

            const m = new maplibregl.Marker({
                element: div, anchor: 'center', offset: [0, offsetY],
            }).setLngLat([anchor.lng, anchor.lat]).addTo(map);
            this._textMarkers.push(m);
            this._textMarkersById[s.id] = m;
        }
    },
};
