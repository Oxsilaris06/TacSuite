/**
 * panels.ts — Roue d'options d'un pin + panneaux inline (P3.CONV, paquet
 * `oi-carto-panels-capture`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 8 méthodes de la section « Roue d'options d'un
 * pin (système porté de pctac2) » de `oi_cartographie.js` (GStart-main,
 * lecture seule, lignes 993-1158) : `_closeWheel` (:997), `_closeInlinePanel`
 * (:1001), `_openPinWheel` (:1009), `_openInlinePanel` (:1032),
 * `_openPinIconPanel` (:1054), `_openPinColorPanel` (:1083),
 * `_openPinRenamePanel` (:1109), `_toggleLabels` (:1147). Cf.
 * `docs/SPEC-OI-CONVERSION.md` §6.2/§6.3, `PAQUETS-OI.json`
 * (`oi-carto-panels-capture`).
 *
 * Adaptations de TYPAGE PUR (aucune restructuration de logique, règle commune
 * §3/§9) :
 *   - `this.markers` (`OICartoContract.markers: Map<string, unknown>`,
 *     contrat figé — règle commune §6) : un garde de type local
 *     `isOiCartoMarkerEntry` reconstitue la forme `{ label: Marker }`
 *     (commentaire d'origine, oi_cartographie.js:275) à la LECTURE, MÊME
 *     patron que `carto/pins.ts` (paquet `oi-carto-pins`, non importable ici
 *     — frontière §6.2 : aucun groupe de méthodes n'importe un autre groupe
 *     de méthodes).
 *   - `HTMLElement.dataset` est `string | undefined` ; `data-id`/`data-c` sont
 *     toujours posés par le gabarit HTML généré juste au-dessus (jamais
 *     absents en pratique) : repli `?? null` pour satisfaire
 *     `OiCartoPin.icon`/`.color` (`string | null`).
 *   - `_openInlinePanel` : garde de typage strict sur `this.map`
 *     (`MapLibreMap | null`, `OICartoContract`) — jamais atteinte en pratique
 *     (ce panneau n'est ouvert que depuis des handlers actifs uniquement
 *     quand la carte est initialisée), retour du panneau construit mais NON
 *     attaché plutôt qu'un throw ; précédent maison :
 *     `@pctac/planmap/panels.ts` `_openInlinePanel` (SPEC-PLANMAP-SPLIT
 *     §1.2/§9).
 *   - `new OIWheel({ map: this.map ?? undefined, ... })` : `OIWheel.map`
 *     (`carto/wheel.ts`, paquet `oi-carto-wheel`, hors périmètre de ce
 *     paquet) est `MapLibreMap | undefined`, `this.map` est
 *     `MapLibreMap | null` — `?? undefined` convertit sans changement de
 *     comportement (`opts.map || null` dans `OIWheel` traite déjà `undefined`
 *     et `null` de façon identique).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 */

import { esc } from '@shared/ui-platform.js';

import { OI_ICON_CATALOG } from './constants.js';
import type { LngLatObj, OICartoInternal } from './types.js';
import { OIWheel } from './wheel.js';

/**
 * Forme du couple de markers stocké sous chaque id de `this.markers`
 * (oi_cartographie.js:275, commentaire d'origine « id -> { pin: Marker, label:
 * Marker } »). `OICartoContract.markers` (contracts.ts, contrat figé) est
 * typé `Map<string, unknown>` : ce garde de type reconstitue la forme réelle
 * à la lecture, sans `any` ni assertion non vérifiée. Seul `label` est
 * consommé par ce fichier (`_toggleLabels`) — `pin` n'est pas déclaré ici.
 */
interface OiCartoMarkerLabelEntry {
    label: { getElement(): HTMLElement };
}

function isOiCartoMarkerLabelEntry(x: unknown): x is OiCartoMarkerLabelEntry {
    return typeof x === 'object' && x !== null && 'label' in x;
}

/**
 * Forme des options passées à `OIWheel` (`carto/wheel.ts`, non exportée par ce
 * module — type local minimal). `id` est porté verbatim depuis l'original
 * (oi_cartographie.js:1016-1020) bien que jamais lu par `OIWheel`.
 */
interface OiCartoWheelOption {
    id?: string;
    icon: string;
    label: string;
    bg?: string;
    color?: string;
    action?: () => void;
}

export const PanelsMethods = {
    // oi_cartographie.js:997-999
    _closeWheel(this: OICartoInternal): void {
        if (this._activeWheel) { try { this._activeWheel.destroy(); } catch { /* ignore */ } this._activeWheel = null; }
    },

    // oi_cartographie.js:1001-1007
    _closeInlinePanel(this: OICartoInternal): void {
        if (this._inlinePanel) { try { this._inlinePanel.remove(); } catch { /* ignore */ } this._inlinePanel = null; }
        if (this._inlinePanelMove && this.map) {
            try { this.map.off('move', this._inlinePanelMove); this.map.off('zoom', this._inlinePanelMove); } catch { /* ignore */ }
            this._inlinePanelMove = null;
        }
    },

    // oi_cartographie.js:1009-1029
    _openPinWheel(this: OICartoInternal, pinId: string): void {
        const pin = this._loadPins().find((p) => p.id === pinId);
        if (!pin) return;
        this._closeWheel();
        this._closeInlinePanel();
        const ll: LngLatObj = { lng: pin.lng, lat: pin.lat };
        const opts: OiCartoWheelOption[] = [
            { id: 'icon', icon: 'category', label: 'Icône', bg: 'rgba(59,130,246,0.95)', action: () => this._openPinIconPanel(pinId) },
            { id: 'color', icon: 'palette', label: 'Couleur', bg: 'rgba(168,85,247,0.95)', action: () => this._openPinColorPanel(pinId) },
            { id: 'rename', icon: 'edit', label: 'Renommer', bg: 'rgba(234,179,8,0.95)', color: '#000', action: () => this._openPinRenamePanel(pinId) },
            { id: 'goto', icon: 'my_location', label: 'Centrer', bg: 'rgba(34,197,94,0.95)', color: '#000', action: () => this.map && this.map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(this.map.getZoom(), 17), speed: 1.2 }) },
            { id: 'delete', icon: 'delete', label: 'Supprimer', bg: 'rgba(239,68,68,0.95)', action: () => { this._removePin(pinId); this._renderPingLists(); } },
        ];
        this._activeWheel = new OIWheel({
            // `exactOptionalPropertyTypes` : `OIWheel.map` (`carto/wheel.ts`, hors
            // périmètre) est `map?: MapLibreMap` (sans `| undefined` explicite) —
            // une clé `map: undefined` est donc rejetée ; le spread conditionnel
            // OMET la clé quand `this.map` est `null`, comportement identique à
            // `opts.map || null` dans `OIWheel` (undefined et null traités pareil).
            ...(this.map ? { map: this.map } : {}),
            lngLat: ll,
            title: pin.memberTri ? `${pin.memberTri}${pin.fonction && pin.fonction !== 'Sans' ? ' · ' + pin.fonction : ''}` : (pin.text || pin.label),
            options: opts,
            onClose: () => { this._activeWheel = null; },
        });
        this._activeWheel.open();
    },

    /** Panneau flottant ancré au pin (suit la carte). */
    // oi_cartographie.js:1032-1052
    _openInlinePanel(
        this: OICartoInternal,
        lngLat: LngLatObj,
        innerHtml: string,
        onMount?: (panel: HTMLDivElement) => void,
    ): HTMLDivElement {
        this._closeInlinePanel();
        const panel = document.createElement('div');
        panel.className = 'oi-carto-inline-panel';
        panel.innerHTML = innerHtml;
        panel.addEventListener('pointerdown', (e) => e.stopPropagation());
        panel.addEventListener('click', (e) => e.stopPropagation());
        const map = this.map;
        if (!map) return panel;
        const parent = map.getContainer();
        parent.appendChild(panel);
        const place = (): void => {
            const p = map.project(lngLat);
            panel.style.left = `${p.x}px`;
            panel.style.top = `${p.y - 26}px`;
        };
        place();
        this._inlinePanelMove = place;
        map.on('move', place);
        map.on('zoom', place);
        this._inlinePanel = panel;
        if (onMount) onMount(panel);
        return panel;
    },

    // oi_cartographie.js:1054-1081
    _openPinIconPanel(this: OICartoInternal, pinId: string): void {
        const pin = this._loadPins().find((p) => p.id === pinId);
        if (!pin) return;
        const cells = OI_ICON_CATALOG.map((ic) => `
            <button type="button" class="oi-ic" data-id="${ic.id}" title="${esc(ic.label)}"
                style="display:flex; flex-direction:column; align-items:center; gap:2px; padding:7px 4px; border-radius:8px; cursor:pointer;
                       background:${(pin.icon || '') === ic.id ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.05)'};
                       border:1px solid ${(pin.icon || '') === ic.id ? '#3b82f6' : 'rgba(255,255,255,0.12)'}; color:#fff;">
                <span class="material-symbols-outlined" style="font-size:22px;">${ic.id}</span>
                <span style="font-size:0.6em; text-align:center; line-height:1.05;">${esc(ic.label)}</span>
            </button>`).join('');
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#60a5fa;">category</span>
                <strong style="font-size:13px;">Choisir une icône</strong>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; max-height:230px; overflow-y:auto;">${cells}</div>`;
        this._openInlinePanel({ lng: pin.lng, lat: pin.lat }, html, (panel) => {
            panel.querySelectorAll<HTMLButtonElement>('.oi-ic').forEach((b) => {
                b.onclick = () => {
                    const list = this._loadPins();
                    const t = list.find((p) => p.id === pinId);
                    if (t) {
                        // Adaptation TS : `HTMLElement.dataset` est `string | undefined` ;
                        // `data-id` est toujours posé par le gabarit ci-dessus. `?? null`
                        // ne change rien à l'exécution, seulement au typage strict de
                        // `OiCartoPin.icon` (`string | null`).
                        t.icon = b.dataset.id ?? null;
                        this._savePins(list);
                        this._renderPins();
                    }
                    this._closeInlinePanel();
                };
            });
        });
    },

    // oi_cartographie.js:1083-1107
    _openPinColorPanel(this: OICartoInternal, pinId: string): void {
        const pin = this._loadPins().find((p) => p.id === pinId);
        if (!pin) return;
        const colors = ['#3b82f6', '#ef4444', '#eab308', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ffffff'];
        const chips = colors.map((c) => `
            <button type="button" class="oi-col" data-c="${c}"
                style="width:30px; height:30px; border-radius:50%; cursor:pointer; background:${c};
                       border:2px solid ${(pin.color || '') === c ? '#fff' : 'rgba(255,255,255,0.25)'};"></button>`).join('');
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#c084fc;">palette</span>
                <strong style="font-size:13px;">Couleur du pin</strong>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; max-width:240px;">${chips}</div>`;
        this._openInlinePanel({ lng: pin.lng, lat: pin.lat }, html, (panel) => {
            panel.querySelectorAll<HTMLButtonElement>('.oi-col').forEach((b) => {
                b.onclick = () => {
                    const list = this._loadPins();
                    const t = list.find((p) => p.id === pinId);
                    if (t) {
                        // Même adaptation TS que `_openPinIconPanel` ci-dessus (`data-c`
                        // toujours posé par le gabarit ci-dessus).
                        t.color = b.dataset.c ?? null;
                        this._savePins(list);
                        this._renderPins();
                    }
                    this._closeInlinePanel();
                };
            });
        });
    },

    // oi_cartographie.js:1109-1144
    _openPinRenamePanel(this: OICartoInternal, pinId: string): void {
        const pin = this._loadPins().find((p) => p.id === pinId);
        if (!pin) return;
        const current = pin.text || (pin.memberTri ? (pin.fonction || '') : pin.label);
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#fcd34d;">edit</span>
                <strong style="font-size:13px;">${pin.memberTri ? 'Intitulé du membre' : 'Renommer le point'}</strong>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
                <input type="text" id="oi_pin_rename_input" value="${esc(current)}"
                    style="flex:1; min-width:170px; background:rgba(255,255,255,0.08); color:#fff; border:1px solid rgba(255,255,255,0.2);
                           border-radius:8px; padding:7px 10px; font-size:14px; outline:none;">
                <button type="button" id="oi_pin_rename_ok"
                    style="background:#22c55e; border:none; color:#000; border-radius:8px; width:38px; height:38px; cursor:pointer;">
                    <span class="material-symbols-outlined" style="font-size:20px;">check</span>
                </button>
            </div>`;
        this._openInlinePanel({ lng: pin.lng, lat: pin.lat }, html, (panel) => {
            const input = panel.querySelector<HTMLInputElement>('#oi_pin_rename_input');
            const okBtn = panel.querySelector<HTMLButtonElement>('#oi_pin_rename_ok');
            // Gardes de typage strict (`querySelector` est nullable) : ces éléments
            // existent toujours, ils viennent du HTML généré ci-dessus.
            if (!input || !okBtn) return;
            const apply = (): void => {
                const list = this._loadPins();
                const t = list.find((p) => p.id === pinId);
                if (t) {
                    const v = (input.value || '').trim();
                    t.text = v;
                    if (!t.memberTri) t.label = v || t.label;
                    this._savePins(list);
                    this._renderPins();
                }
                this._closeInlinePanel();
            };
            okBtn.onclick = apply;
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
            setTimeout(() => input.focus(), 40);
        });
    },

    /** Affiche / masque tous les libellés de pins (anti-superposition). */
    // oi_cartographie.js:1147-1158
    _toggleLabels(this: OICartoInternal): void {
        this.labelsVisible = !this.labelsVisible;
        const fab = document.getElementById('oi_carto_btn_labels');
        if (fab) {
            fab.classList.toggle('active', !this.labelsVisible);
            const icon = fab.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = this.labelsVisible ? 'label' : 'label_off';
        }
        for (const entry of this.markers.values()) {
            if (isOiCartoMarkerLabelEntry(entry) && entry.label) {
                entry.label.getElement().style.display = this.labelsVisible ? '' : 'none';
            }
        }
    },
};
