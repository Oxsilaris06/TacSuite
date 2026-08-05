/**
 * pins.ts — Pings : CRUD, persistance, réconciliation des markers, cadenas,
 * décorations (P2.CONV, paquet `pm-pins`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 15 méthodes PINGS de `modules/pctac/planMap.js`
 * (GStart-main, lecture seule) — `_onMapClick` (:1156), `_addPin` (:1190),
 * `_removePin` (:1197), `_loadPins` (:1203), `_savePins` (:1209),
 * `_resolvePin` (:1216), `_pinSignature` (:1231), `_applyLockBadgeStyle` (:1253),
 * `_makeLockBadge` (:1275), `_buildPinVisual` (:1291), `_bindPinListeners` (:1376),
 * `_renderPins` (:1494), `_renderPinDecorations` (:1570), `_togglePinLock` (:3727),
 * `getPinsSummary` (:5025). Cf. `docs/SPEC-PLANMAP-SPLIT.md` §4.6, §1.2-1.3
 * (forme `this`-typée), §3.1 (types), §6.2, §6.5, §6.6 (interdits).
 *
 * ⚠ PAQUET À 3 INVARIANTS (SPEC-PLANMAP-SPLIT §5.1-§5.3), tous documentés au
 * point d'application ci-dessous :
 *   1. `_buildPinVisual` — JAMAIS de `position`/`inset` inline sur `pinWrap`
 *      (l'élément d'un Marker MapLibre) : dérive au zoom + décalage du label.
 *   2a. `_makeLockBadge` — les 3 `stopPropagation` (pointerdown/mousedown/
 *      touchstart) + `{ passive: true }` sur touchstart sont OBLIGATOIRES.
 *   2b. Verrou par-ping ≠ verrou global : `draggable`/`setDraggable` combinent
 *      `!this._locked && !pin.locked` ; `_pinSignature` inclut les DEUX ;
 *      `_togglePinLock(pinId, reopenWheel = true)` — défaut `true` requis.
 *
 * Adaptations de TYPAGE (aucune restructuration de logique, cf. §6.6) :
 *   - `PinEntry.pinMarker`/`labelMarker` sont typés `Marker | null` (réconciliation
 *     par ID) alors qu'ils sont TOUJOURS non-null au moment où `_bindPinListeners`
 *     les utilise (posés juste avant, `_renderPins` :1522-1530) — gardes locales
 *     ajoutées, jamais déclenchées en pratique.
 *   - Les propriétés `this.map` / `this._pinMarkers` / `this._pinCircleFeatures` /
 *     `this._pinDiameterLabels` / `this._pinDecoMarkers` sont capturées dans des
 *     `const` locales après leur garde de non-nullité : le narrowing TS sur une
 *     propriété de `this` ne survit pas aux appels de méthode qui suivent (même
 *     principe que `planmap/draw-layers.ts`, cf. son en-tête).
 *   - `getSource<GeoJSONSource>(...)` (générique explicite, comme
 *     `planmap/draw-tools.ts`) pour appeler `.setData(...)`.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLat, MapMouseEvent } from 'maplibre-gl';

import { Persist } from '@shared/persist.js';
import { Storage } from '@pctac/storage.js';
import { ADVERSARIES_KEY, FRIENDS_KEY, HOSTAGES_KEY } from '@pctac/config.js';

import { ENTITY_COLORS, PINS_KEY } from './constants.js';
import type {
    LngLatTuple,
    PinCircleFeature,
    PinEntry,
    PlanMapInternal,
    PlanMapPinSummary,
    PlanPin,
    ResolvedPin,
} from './types.js';

export const PinsMethods = {
    // planMap.js:1156-1188
    _onMapClick(this: PlanMapInternal, e: MapMouseEvent): void {
        // Outil mesure : chaque clic/tap pose un sommet (machine d'états dédiée).
        // On le traite AVANT la garde drawTool ci-dessous.
        if (this.drawTool === 'measure') {
            if (this._measureState) this._measureAddVertex([e.lngLat.lng, e.lngLat.lat]);
            return;
        }
        // Pendant le drawing, les clics sont gérés par mousedown/up
        if (this.drawTool) return;
        if (this.pendingEntityPin) {
            const { kind, id } = this.pendingEntityPin;
            this._addPin({
                id: `${kind}_${id}_${Date.now()}`,
                entityRef: { kind, id },
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
            this.pendingEntityPin = null;
            this._hideHint();
            return;
        }
        if (this.pendingFreePin) {
            const { label, color, kind, icon } = this.pendingFreePin;
            this._addPin({
                id: 'free_' + Date.now(),
                label, color, kind, icon,
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
            this.pendingFreePin = null;
            this._hideHint();
        }
    },

    // planMap.js:1190-1195
    _addPin(this: PlanMapInternal, pin: PlanPin): void {
        const pins = this._loadPins();
        pins.push(pin);
        this._savePins(pins);
        this._renderPins();
    },

    // planMap.js:1197-1201
    _removePin(this: PlanMapInternal, id: string): void {
        const pins = this._loadPins().filter(p => p.id !== id);
        this._savePins(pins);
        this._renderPins();
    },

    // planMap.js:1203-1207
    _loadPins(): PlanPin[] {
        // Persist.get tolère localStorage indisponible, JSON corrompu (→ .bak) et
        // valide que c'est bien un tableau ; fallback [] dans tous les cas.
        return Persist.get<PlanPin[]>(PINS_KEY, { validator: Array.isArray, fallback: [] }) || [];
    },

    // planMap.js:1209-1214
    _savePins(pins: readonly PlanPin[]): void {
        // Via Persist → garde QuotaExceededError (événement 'pctac:quota' non bloquant,
        // ne jette jamais). Pas d'alert ici : la persistance des pings ne doit pas
        // bloquer le déplacement tactile sur le terrain.
        Persist.set(PINS_KEY, pins);
    },

    // planMap.js:1216-1226
    _resolvePin(pin: PlanPin): ResolvedPin {
        // Calcule label + couleur effectifs (entité ou libre)
        if (pin.entityRef) {
            const { kind, id } = pin.entityRef;
            const map = { adv: ADVERSARIES_KEY, host: HOSTAGES_KEY, friend: FRIENDS_KEY };
            const item = Storage.loadCollection(map[kind]).find(i => i.id === id);
            // `item.nom`/`prenom`/`unite` : champs de `PctacCollectionItem`, typé en
            // dictionnaire ouvert `[key: string]: unknown` (contracts.ts) — toujours
            // des chaînes en pratique (saisies des formulaires adversaire/otage/ami).
            // Garde de type neutre en observable, même principe que `coordAt`
            // (SPEC-PLANMAP-SPLIT.md §6.3).
            const nom = item && typeof item.nom === 'string' ? item.nom : '';
            const prenom = item && typeof item.prenom === 'string' ? item.prenom : '';
            const unite = item && typeof item.unite === 'string' ? item.unite : '';
            const label = item ? (`${nom} ${prenom}`.trim() || unite || '(sans nom)') : '[supprimé]';
            return { label, color: ENTITY_COLORS[kind], kind };
        }
        // `pin.label`/`pin.color` sont optionnels dans `PlanPin` (données historiques
        // + `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`) mais toujours
        // renseignés pour un ping libre (posé par `_armFreePinPlacement`/
        // `_quickPlacePing`) — repli `''` neutre en observable (même principe que
        // `coordAt`, SPEC-PLANMAP-SPLIT.md §6.3).
        return { label: pin.label ?? '', color: pin.color ?? '', kind: pin.kind || 'libre' };
    },

    // Signature légère d'un ping : tout ce qui change le rendu visuel ou le binding.
    // Si elle est identique entre deux rendus, on ne touche pas au DOM (zéro jank).
    // La position (lng/lat) est incluse pour repositionner via setLngLat sans recréer.
    // planMap.js:1231-1243
    _pinSignature(this: PlanMapInternal, pin: PlanPin): string {
        const { label, color, kind } = this._resolvePin(pin);
        const text = (pin.text && pin.text.trim()) ? pin.text : label;
        return [
            pin.lng, pin.lat,
            color, kind,
            pin.icon || '',
            pin.kind || '',
            text,
            pin.locked ? 1 : 0,
            this._locked ? 1 : 0,
        ].join('|');
    },

    // (Re)construit le contenu visuel d'un ping (pinWrap + labelEl) à partir de
    // entry.pin (toujours à jour). Renvoie le labelOffset pour le marker label.
    /**
     * Applique le style visuel d'un cadenas (verrouillé = jaune plein, sinon gris translucide).
     * @param {HTMLElement} badge
     * @param {boolean} locked
     * @param {'corner'|'marker'} variant  'corner' = coin d'un ping ; 'marker' = marqueur centré d'une forme
     */
    // planMap.js:1253-1268
    _applyLockBadgeStyle(badge: HTMLElement, locked: boolean, variant: 'corner' | 'marker'): void {
        badge.textContent = locked ? 'lock' : 'lock_open';
        badge.title = locked
            ? 'Verrouillé — cliquer pour déverrouiller'
            : 'Cliquer pour verrouiller (fige la position)';
        badge.setAttribute('aria-label', badge.title);
        badge.classList.toggle('locked', locked);
        const common = `line-height:1; cursor:pointer; pointer-events:auto; user-select:none;`
            + ` color:${locked ? '#eab308' : '#e5e7eb'};`
            + ` background:rgba(15,18,24,${locked ? '0.95' : '0.7'});`
            + ` box-shadow:0 1px 3px rgba(0,0,0,0.6); border-radius:50%;`
            + ` opacity:${locked ? '1' : '0.82'}; z-index:3;`;
        badge.style.cssText = (variant === 'corner')
            ? common + ` position:absolute; top:-7px; right:-7px; font-size:13px; padding:2px;`
            : common + ` font-size:16px; padding:4px; display:flex; align-items:center; justify-content:center;`;
    },

    /**
     * Fabrique un cadenas cliquable (élément span Material Symbols). Le clic bascule
     * le verrou via `onToggle` ; les pointerdown/mousedown/touchstart sont stoppés pour
     * ne PAS déclencher le drag natif du marker ni la sélection de la forme sous-jacente.
     */
    // planMap.js:1275-1289 — INVARIANT 2a (SPEC-PLANMAP-SPLIT §5.2) : les 3
    // `stopPropagation` (pointerdown/mousedown/touchstart) + le `{ passive: true }`
    // sur touchstart sont OBLIGATOIRES, sans eux le drag natif du marker et la
    // sélection de la forme sous-jacente se déclenchent.
    _makeLockBadge(this: PlanMapInternal, locked: boolean, onToggle: () => void, variant: 'corner' | 'marker'): HTMLSpanElement {
        const badge = document.createElement('span');
        badge.className = 'plan-lock-badge material-symbols-outlined';
        this._applyLockBadgeStyle(badge, locked, variant);
        const stop = (e: Event): void => { e.stopPropagation(); };
        badge.addEventListener('pointerdown', stop);
        badge.addEventListener('mousedown', stop);
        badge.addEventListener('touchstart', stop, { passive: true });
        badge.addEventListener('click', this._safe((e: MouseEvent) => {
            e.stopPropagation();
            // planMap.js:1286 — `if (e.preventDefault) e.preventDefault();` dans
            // l'original : garde défensive contre un événement non standard.
            // Typé `MouseEvent`, `.preventDefault` est une méthode TOUJOURS
            // définie (TS2774 : « this condition will always return true ») ;
            // l'appel direct est neutre en observable.
            e.preventDefault();
            onToggle();
        }, 'lockBadge:click'));
        return badge;
    },

    // planMap.js:1291-1371 — INVARIANT 1 (SPEC-PLANMAP-SPLIT §5.1), LE PLUS
    // IMPORTANT DU PROJET : le `cssText` de `pinWrap` ci-dessous NE DOIT CONTENIR
    // NI `position:` NI `inset:` (cf. commentaire d'origine reporté tel quel juste
    // en dessous). Le badge cadenas (`position:absolute`, cf. `_applyLockBadgeStyle`)
    // dépend de ce contrat.
    _buildPinVisual(this: PlanMapInternal, entry: PinEntry): [number, number] {
        const pin = entry.pin;
        const { label, color, kind } = this._resolvePin(pin);
        // planMap.js:1293 — `kind` déstructuré mais jamais lu dans l'original
        // (code mort local) ; conservé pour fidélité, neutralisé pour
        // `noUnusedLocals` (même traitement que `restrictWidth` dans
        // pdf-export.ts / `otanColor` dans wheels.ts, cf. SPEC-PCTAC-CONVERSION.md §9).
        void kind;
        const isVehicle = (pin.kind === 'Vehicule');
        const customIcon = pin.icon && pin.icon.trim();
        const pinWrap = entry.pinWrap;
        let labelOffset: [number, number];

        const locked = !!pin.locked;
        const cursor = (locked || this._locked) ? 'pointer' : 'grab';
        if (customIcon || isVehicle) {
            const glyph = customIcon || 'directions_car';
            // NB : pas de `position` inline ici — l'élément du marqueur est déjà
            // `position:absolute` via la classe .maplibregl-marker. L'écraser (relative)
            // casse le positionnement carte (dérive au zoom + décalage du label).
            // Le badge cadenas (position:absolute) s'ancre donc déjà sur ce wrap.
            pinWrap.style.cssText = `min-width: 44px; min-height: 44px; width: 44px; height: 44px; cursor: ${cursor}; display: flex; align-items: center; justify-content: center; touch-action: none;`;
            pinWrap.innerHTML = `
                <span class="material-symbols-outlined" style="
                    font-size: 36px;
                    color: ${color};
                    text-shadow:
                        0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff,
                        0 2px 4px rgba(0,0,0,0.6);
                    line-height: 1;
                    font-variation-settings: 'FILL' 1;
                ">${glyph}</span>
            `;
            labelOffset = [0, 22]; // sous l'icône
        } else {
            pinWrap.style.cssText = `min-width: 44px; min-height: 44px; width: 44px; height: 44px; cursor: ${cursor}; display: flex; align-items: center; justify-content: center; touch-action: none;`;
            pinWrap.innerHTML = `
                <svg width="26" height="36" viewBox="0 0 22 30" style="display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));">
                    <path d="M11,0 C5,0 0,5 0,11 C0,18 11,30 11,30 C11,30 22,18 22,11 C22,5 17,0 11,0 Z"
                          fill="${color}" stroke="#fff" stroke-width="2"/>
                    <circle cx="11" cy="11" r="4" fill="#fff"/>
                </svg>
            `;
            labelOffset = [0, 5];
        }

        // Cadenas cliquable TOUJOURS visible : verrouille/déverrouille CE ping.
        // Verrouillé = position figée (le drag natif est désactivé côté marker).
        const pinId = pin.id;
        pinWrap.appendChild(
            this._makeLockBadge(locked, () => this._togglePinLock(pinId, false), 'corner'),
        );

        // L'ancre dépend du type → si elle change, on doit la réappliquer.
        const anchor = (customIcon || isVehicle) ? 'center' : 'bottom';
        if (entry.pinMarker && entry._anchor !== anchor) {
            try { entry.pinMarker.setOffset([0, 0]); } catch { /* API MapLibre selon état du style */ }
            // maplibre n'expose pas setAnchor ; l'ancre est figée à la création.
            // Pour rester robuste sans recréer le marker (et perdre les listeners),
            // on compense via l'offset du label seulement ; le pin reste à son ancre
            // d'origine. _anchor est mémorisé pour info.
            entry._anchor = anchor;
        } else if (entry.pinMarker) {
            entry._anchor = anchor;
        }

        // Label : texte custom prioritaire sur le label kind.
        const displayLabel = pin.text && pin.text.trim() ? pin.text : label;
        entry.labelEl.textContent = displayLabel;
        entry.labelEl.style.cssText = `
            padding: 3px 8px;
            background: rgba(0,0,0,0.78);
            color: #fff;
            font-family: var(--font-ui);
            font-size: 13px;
            line-height: 1.2;
            border-left: 4px solid ${color};
            border-radius: 3px;
            white-space: nowrap;
            box-shadow: 0 1px 3px rgba(0,0,0,0.6);
            pointer-events: none;
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            letter-spacing: 0.3px;
        `;
        return labelOffset;
    },

    // Attache UNE SEULE FOIS les listeners (tap/double-tap/drag) sur l'entry.
    // Tous lisent entry.pin (mis à jour à chaque réconciliation) → pas de closure
    // stale, pas de listeners orphelins, pas de jank tactile.
    // planMap.js:1376-1488
    _bindPinListeners(this: PlanMapInternal, entry: PinEntry): void {
        const pinWrap = entry.pinWrap;
        const pinMarker = entry.pinMarker;
        const labelMarker = entry.labelMarker;
        // Adaptation TS (absente de l'original, jamais déclenchée en pratique) :
        // `PinEntry.pinMarker`/`labelMarker` sont typés `Marker | null` pour la
        // réconciliation par ID, mais `_bindPinListeners` n'est appelée
        // qu'immédiatement après leur création dans `_renderPins` (:1522-1530).
        // Capture locale + garde pour que le narrowing survive aux fermetures
        // ci-dessous (cf. en-tête de fichier).
        if (!pinMarker || !labelMarker) return;
        let pdStart: { x: number; y: number; t: number; isTouch: boolean } | null = null;
        let originalLngLat: LngLat | null = null;

        // Cercle de diamètre live pendant le drag (lit entry.pin courant).
        const updateLiveCircle = (ll: LngLat): void => {
            const pin = entry.pin;
            if (!(pin.diameterM && pin.diameterM > 0)) return;
            const src = this.map && this.map.getSource<GeoJSONSource>('plan-pin-circles-src');
            if (!src || !this._pinCircleFeatures) return;
            const feats = this._pinCircleFeatures;
            const center: LngLatTuple = [ll.lng, ll.lat];
            const radiusM = pin.diameterM / 2;
            const edge = this._geoEdgeNorth(center, radiusM);
            const coords = this._circlePolygon(center, edge);
            const idx = feats.findIndex(f =>
                f.properties && f.properties._pinId === pin.id,
            );
            if (idx === -1) return;
            const cur = feats[idx];
            // Garde de typage (noUncheckedIndexedAccess) : `idx` vient de `findIndex`
            // sur ce même tableau, `idx !== -1` garantit `cur` défini — neutre en
            // observable, cf. SPEC-PLANMAP-SPLIT.md §6.3.
            if (!cur) return;
            feats[idx] = {
                ...cur,
                geometry: { type: 'Polygon', coordinates: [coords] },
            };
            src.setData({ type: 'FeatureCollection', features: feats });
        };
        entry._updateLiveCircle = updateLiveCircle;

        const onDown = (clientX: number, clientY: number, isTouch: boolean): void => {
            pdStart = { x: clientX, y: clientY, t: Date.now(), isTouch };
            originalLngLat = pinMarker.getLngLat();
            // Desactiver temporairement le zoom double-clic natif de MapLibre (fenêtre double-tap)
            this._suppressDblZoom();
        };

        const onUp = (clientX: number, clientY: number, ev: PointerEvent): void => {
            if (!pdStart) return;
            const dx = clientX - pdStart.x, dy = clientY - pdStart.y;
            const moved = Math.hypot(dx, dy);
            const dt = Date.now() - pdStart.t;
            const threshold = pdStart.isTouch ? 24 : 6;
            const maxTime = pdStart.isTouch ? 450 : 500;
            const isTap = moved < threshold && dt < maxTime;
            pdStart = null;
            if (!isTap) return;

            ev.stopPropagation();
            ev.preventDefault();

            const pinId = entry.pin.id;
            if (originalLngLat) {
                pinMarker.setLngLat(originalLngLat);
                labelMarker.setLngLat(originalLngLat);
                const dm = this._pinDiameterLabels && this._pinDiameterLabels[pinId];
                if (dm) dm.setLngLat(originalLngLat);
                updateLiveCircle(originalLngLat);
            }

            const now = Date.now();
            const prev = this._lastPinTap;
            const doubleTapWindow = 450; // 450 ms adaptes au tactile mobile
            if (prev && prev.id === pinId && (now - prev.t) < doubleTapWindow) {
                this._lastPinTap = null;
                this._openPingOptionsWheel(pinId);
            } else {
                this._lastPinTap = { id: pinId, t: now };
            }
        };

        // (`instanceof Element` = équivalent TS-safe de `ev.target && ev.target.closest`
        // de l'original : seul un `Element` expose `closest`, même duck-typing que
        // draw-layers.ts.)
        const onLockBadge = (ev: PointerEvent): boolean => !!(ev.target instanceof Element && ev.target.closest('.plan-lock-badge'));
        pinWrap.addEventListener('pointerdown', this._safe((ev: PointerEvent) => {
            if (onLockBadge(ev)) return;   // clic sur le cadenas : ne pas amorcer un geste de ping
            pinWrap.style.zIndex = '1000';
            entry.labelEl.style.zIndex = '1000';
            onDown(ev.clientX, ev.clientY, ev.pointerType === 'touch');
        }, 'pin:pointerdown'), { capture: true });
        pinWrap.addEventListener('pointermove', this._safe(() => {
            /* le drag natif maplibre gère le déplacement */
        }, 'pin:pointermove'), { capture: true });
        pinWrap.addEventListener('pointerup', this._safe((ev: PointerEvent) => {
            if (onLockBadge(ev)) return;   // idem au relâchement (évite un faux tap)
            onUp(ev.clientX, ev.clientY, ev);
        }, 'pin:pointerup'), { capture: true });
        pinWrap.addEventListener('pointerleave', this._safe(() => {
            pinWrap.style.zIndex = '';
            entry.labelEl.style.zIndex = '';
        }, 'pin:pointerleave'));
        pinWrap.addEventListener('pointercancel', this._safe(() => {
            pdStart = null;
            pinWrap.style.zIndex = '';
            entry.labelEl.style.zIndex = '';
        }, 'pin:pointercancel'), { capture: true });

        pinMarker.on('dragstart', this._safe(() => {
            pinWrap.style.cursor = 'grabbing';
            pinWrap.style.opacity = '0.85';
            entry.labelEl.style.opacity = '0.5';
        }, 'pin:dragstart'));
        pinMarker.on('drag', this._safe(() => {
            const ll = pinMarker.getLngLat();
            labelMarker.setLngLat(ll);
            updateLiveCircle(ll);
            const dm = this._pinDiameterLabels && this._pinDiameterLabels[entry.pin.id];
            if (dm) dm.setLngLat(ll);
        }, 'pin:drag'));
        pinMarker.on('dragend', this._safe(() => {
            pinWrap.style.cursor = 'grab';
            pinWrap.style.opacity = '1';
            entry.labelEl.style.opacity = '1';
            const ll = pinMarker.getLngLat();
            labelMarker.setLngLat(ll);
            const pinId = entry.pin.id;
            const allPins = this._loadPins();
            const target = allPins.find(p => p.id === pinId);
            if (target) {
                target.lng = ll.lng;
                target.lat = ll.lat;
                this._savePins(allPins);
                // Maintient entry.pin cohérent avec la nouvelle position.
                entry.pin = target;
            }
            this._renderPinDecorations();
        }, 'pin:dragend'));
    },

    // Réconciliation par ID : on ne détruit/recrée QUE le strict nécessaire.
    //  - nouveau ping        → création + binding des listeners (une seule fois)
    //  - signature changée   → maj EN PLACE (position + contenu DOM)
    //  - id disparu          → suppression du marker
    // planMap.js:1494-1565
    _renderPins(this: PlanMapInternal): void {
        if (!this.map) return;
        const map = this.map;
        if (!this._pinMarkers) this._pinMarkers = new Map(); // id -> entry
        // Capture locale : cf. en-tête de fichier (narrowing de `this._pinMarkers`
        // invalidé par les appels de méthode qui suivent).
        const pinMarkers = this._pinMarkers;

        const pins = this._loadPins();
        const seen = new Set<string>();

        for (const pin of pins) {
            seen.add(pin.id);
            const sig = this._pinSignature(pin);
            let entry = pinMarkers.get(pin.id);

            if (!entry) {
                // --- CRÉATION ---
                const pinWrap = document.createElement('div');
                // Marqueur identifiable : permet à _shapePointerDown d'ignorer un geste
                // qui démarre sur un ping (évite de déplacer la forme sous-jacente).
                pinWrap.classList.add('plan-pin');
                const labelEl = document.createElement('div');
                entry = { pin, pinWrap, labelEl, pinMarker: null, labelMarker: null, sig: null, _anchor: null };

                const isVehicle = (pin.kind === 'Vehicule');
                const customIcon = pin.icon && pin.icon.trim();
                const anchor = (customIcon || isVehicle) ? 'center' : 'bottom';

                const labelOffset = this._buildPinVisual(entry);
                entry._anchor = anchor;

                // INVARIANT 2b (SPEC-PLANMAP-SPLIT §5.3) : verrou par-ping ≠ verrou
                // global — les deux conditions sont combinées à la création…
                entry.pinMarker = new maplibregl.Marker({ element: pinWrap, anchor, draggable: !this._locked && !pin.locked })
                    .setLngLat([pin.lng, pin.lat])
                    .addTo(map);
                entry.labelMarker = new maplibregl.Marker({ element: labelEl, anchor: 'top', offset: labelOffset })
                    .setLngLat([pin.lng, pin.lat])
                    .addTo(map);

                // Listeners attachés UNE SEULE FOIS.
                this._bindPinListeners(entry);

                entry.sig = sig;
                pinMarkers.set(pin.id, entry);
            } else if (entry.sig !== sig) {
                // --- MAJ EN PLACE ---
                entry.pin = pin;
                // Position (toujours sûr de la resync, peu coûteux).
                entry.pinMarker?.setLngLat([pin.lng, pin.lat]);
                entry.labelMarker?.setLngLat([pin.lng, pin.lat]);
                // Contenu visuel + offset du label.
                const labelOffset = this._buildPinVisual(entry);
                try { entry.labelMarker?.setOffset(labelOffset); } catch { /* API MapLibre selon état du style */ }
                // État draggable (verrou global OU individuel) sans recréer le marker.
                // …et à la mise à jour (INVARIANT 2b, §5.3).
                try {
                    entry.pinMarker?.setDraggable(!this._locked && !pin.locked);
                } catch { /* API MapLibre selon état du style */ }
                entry.sig = sig;
            } else {
                // Signature identique : on garde entry.pin pointé sur l'objet courant
                // (les coords peuvent être référentiellement neuves après reload).
                entry.pin = pin;
            }
        }

        // --- SUPPRESSION des ids disparus uniquement ---
        for (const [id, entry] of pinMarkers) {
            if (seen.has(id)) continue;
            // planMap.js:1558-1559 — `entry.pinMarker && entry.pinMarker.remove();` dans
            // l'original ; réécrit en `if` pour satisfaire `no-unused-expressions`
            // (ESLint), même sémantique (appel conditionnel, sous try/catch).
            try { if (entry.pinMarker) entry.pinMarker.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
            try { if (entry.labelMarker) entry.labelMarker.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
            pinMarkers.delete(id);
        }

        // Re-render des cercles de diamètre & texte des pings.
        this._renderPinDecorations();
    },

    // ============================================================
    // ============  PINGS : décorations (diamètre + texte) =======
    // ============================================================
    // planMap.js:1570-1659
    _renderPinDecorations(this: PlanMapInternal): void {
        if (this._pinDecoMarkers) this._pinDecoMarkers.forEach(m => { try { m.remove(); } catch { /* déjà retiré du DOM — sans effet */ } });
        this._pinDecoMarkers = [];
        // Capture locale : cf. en-tête de fichier.
        const pinDecoMarkers = this._pinDecoMarkers;
        if (this._pinDiameterSrc) {
            try {
                const src = this.map && this.map.getSource<GeoJSONSource>('plan-pin-circles-src');
                if (src) src.setData({ type: 'FeatureCollection', features: [] });
            } catch { /* API MapLibre selon état du style */ }
        }
        if (!this.map) return;
        const map = this.map;

        // Cercles géodésiques pour les pings avec diameterM
        // On garde une copie locale `_pinCircleFeatures` pour pouvoir mettre à jour
        // une feature individuelle live pendant le drag (par _pinId dans properties).
        // `pin.showDiameter === false` permet de masquer le cercle sans perdre la valeur.
        const circleFeatures: PinCircleFeature[] = [];
        for (const pin of this._loadPins()) {
            if (pin.diameterM && pin.diameterM > 0 && pin.showDiameter !== false) {
                const center: LngLatTuple = [pin.lng, pin.lat];
                const radiusM = pin.diameterM / 2;
                // Arête géodésique due nord (rayon terrestre R unifié) plutôt que
                // l'approximation 111320 m/° : cercle exact = diameterM à toute latitude.
                const edge = this._geoEdgeNorth(center, radiusM);
                const coords = this._circlePolygon(center, edge);
                circleFeatures.push({
                    type: 'Feature',
                    geometry: { type: 'Polygon', coordinates: [coords] },
                    properties: { color: pin.color || '#3b82f6', _pinId: pin.id },
                });
            }
        }
        this._pinCircleFeatures = circleFeatures;
        // Labels textuels du diamètre pour chaque ping concerné
        this._pinDiameterLabels = {};
        // Capture locale : cf. en-tête de fichier.
        const diameterLabels = this._pinDiameterLabels;
        if (this._diameterGlobal) {
            for (const pin of this._loadPins()) {
                if (!(pin.diameterM && pin.diameterM > 0 && pin.showDiameter !== false)) continue;
                const div = document.createElement('div');
                div.className = 'plan-diameter-label';
                div.textContent = `⌀ ${this._formatDistance(pin.diameterM)}`;
                div.style.cssText = `
                    background: rgba(20,24,32,0.85);
                    color: #fff;
                    padding: 3px 9px;
                    border-radius: 10px;
                    border: 1px solid ${pin.color || '#3b82f6'};
                    font-family: var(--font-data, ui-monospace, monospace);
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                    pointer-events: none;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                `;
                const m = new maplibregl.Marker({ element: div, anchor: 'top', offset: [0, 56] })
                    .setLngLat([pin.lng, pin.lat]).addTo(map);
                pinDecoMarkers.push(m);
                diameterLabels[pin.id] = m;
            }
        }
        // Source/layer pour les cercles de ping
        // planMap.js:1627 — `this.map.getSource && …` dans l'original : garde
        // défensive de présence de méthode. `map` est ici un `MapLibreMap` typé
        // (capturé après `if (!this.map) return;`), `.getSource` y est une
        // méthode TOUJOURS définie (TS2774 : « this condition will always
        // return true ») ; l'omission de cette clause est neutre en observable.
        if (!this._pinDiameterSrc && circleFeatures.length) {
            try {
                map.addSource('plan-pin-circles-src', {
                    type: 'geojson', data: { type: 'FeatureCollection', features: circleFeatures },
                });
                map.addLayer({
                    id: 'plan-pin-circles-fill',
                    type: 'fill',
                    source: 'plan-pin-circles-src',
                    paint: {
                        'fill-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                        'fill-opacity': 0.10,
                    },
                });
                map.addLayer({
                    id: 'plan-pin-circles-line',
                    type: 'line',
                    source: 'plan-pin-circles-src',
                    paint: {
                        'line-color': ['coalesce', ['get', 'color'], '#3b82f6'],
                        'line-width': 2,
                        'line-dasharray': [3, 3],
                        'line-opacity': 0.8,
                    },
                });
                this._pinDiameterSrc = true;
            } catch (e) {
                console.error('[PlanMap] couche cercles ping échec:', e);
            }
        } else if (this._pinDiameterSrc) {
            try {
                const src = map.getSource<GeoJSONSource>('plan-pin-circles-src');
                if (src) src.setData({ type: 'FeatureCollection', features: circleFeatures });
            } catch { /* API MapLibre selon état du style */ }
        }
    },

    /** Verrouille / déverrouille la position d'UN ping (indépendamment du verrou global). */
    // planMap.js:3727-3738 — INVARIANT 2b (SPEC-PLANMAP-SPLIT §5.3) : le défaut
    // `reopenWheel = true` est REQUIS (la roue rouvre après un toggle depuis elle-même) ;
    // le cadenas direct (`_buildPinVisual`) appelle avec `false` explicite.
    _togglePinLock(this: PlanMapInternal, pinId: string, reopenWheel = true): void {
        const list = this._loadPins();
        const pin = list.find(p => p.id === pinId);
        if (!pin) return;
        pin.locked = !pin.locked;
        this._savePins(list);
        this._renderPins();
        this._showHint(pin.locked ? 'Ping verrouillé' : 'Ping déverrouillé');
        setTimeout(() => this._hideHint(), 1400);
        // Depuis la roue : la rouvre pour refléter l'état. Depuis le cadenas direct : non.
        if (reopenWheel) this._openPingOptionsWheel(pinId);
    },

    /**
     * Résumé des pings courants pour l'export PDF (CONTRAT C2).
     * @returns {Array<{label:string, lat:number, lng:number, diameterM:(number|null)}>}
     *          [] si aucun ping. Réutilise _loadPins (même source que _renderPins)
     *          et _resolvePin pour le libellé effectif (entité ou libre).
     */
    // planMap.js:5025-5046 — CONTRAT PUBLIC C2 : ne doit JAMAIS jeter.
    getPinsSummary(this: PlanMapInternal): PlanMapPinSummary[] {
        try {
            const pins = this._loadPins();
            if (!Array.isArray(pins)) return [];
            return pins.map(pin => {
                let label: string;
                try { label = this._resolvePin(pin).label; }
                catch { label = pin.label || pin.text || ''; }
                const dia = (typeof pin.diameterM === 'number' && pin.diameterM > 0)
                    ? pin.diameterM : null;
                return {
                    label: label || '',
                    lat: pin.lat,
                    lng: pin.lng,
                    diameterM: dia,
                };
            });
        } catch (e) {
            console.error('[PlanMap] getPinsSummary échec:', e);
            return [];
        }
    },
};
