/**
 * ping-modal.ts — Modale « Ping » (entités liées + picker d'icônes)
 * (P2.CONV, paquet `pm-pingmodal`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 8 méthodes de `modules/pctac/planMap.js`
 * (GStart-main, lecture seule) :
 * `_openPingModal` (:957), `_closePingModal` (:972), `_renderPingEntities`
 * (:978), `_setSelectedIcon` (:1030), `_refreshIconSuggestions` (:1040),
 * `_renderIconCatalog` (:1070), `_bindIconPickerOnce` (:1114),
 * `_armFreePinPlacement` (:1142).
 *
 * Cf. docs/SPEC-PLANMAP-SPLIT.md §4.5 (signatures), §1.3 (règle `this`), §6.3
 * (typage sur données `dataset`), §6.6 (ne pas mémoriser les
 * `getElementById`, ne pas convertir `el.onclick =` en `addEventListener`).
 *
 * ⚠ Adaptations de TYPAGE PUR (absentes de l'original, jamais déclenchées en
 * pratique) : les accès directs `document.getElementById(id).prop = …` de
 * `_openPingModal`, `_closePingModal` et `_armFreePinPlacement` sont
 * réécrits avec une variable intermédiaire + `if (el) …`, comme le fait déjà
 * l'original pour `veh`/`cat` dans `_openPingModal`. Justification : (a)
 * `getElementById` renvoie `HTMLElement | null` en TypeScript strict — un
 * accès direct ne compile pas ; (b) `#modalBackdrop`/`#pingModal`/
 * `#free_pin_label`/`#free_pin_color`/`#free_pin_kind` sont des éléments
 * STATIQUES de `pctac/index.html` (jamais recréés par vue, jamais retirés du
 * DOM) : en pratique ces gardes ne sont jamais empruntées, exactement comme
 * les gardes ajoutées dans `planmap/draw-layers.ts` (cf. SPEC-PLANMAP-SPLIT
 * §6.6 et son commentaire d'en-tête). Aucun changement d'observable.
 *
 * ⚠ Écart constaté avec la mission : `escHtml` (`./constants.js`) n'est PAS
 * importé ici. Vérifié par lecture intégrale de `planMap.js:957-1154` : aucun
 * appel à `escHtml` dans ces 8 méthodes (les seuls usages du fichier sont aux
 * lignes 868 et 933, dans `_searchAddress`/`_placeSearchMarker` — hors
 * périmètre de ce paquet, cf. `chrome.ts`). Un import inutilisé aurait
 * échoué le lint (`noUnusedLocals`/`no-unused-vars`). Signalé au gate : les
 * libellés d'entités (`it.nom`/`it.prenom`/`it.unite`) et les résultats
 * `PIN_ICONS`/`suggestPinIcons` sont donc injectés en `innerHTML` SANS
 * échappement, à l'identique de l'original (comportement porté verbatim, pas
 * une régression introduite par ce portage).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import { Storage } from '@pctac/storage.js';
import { ADVERSARIES_KEY, FRIENDS_KEY, HOSTAGES_KEY, PIN_ICONS, suggestPinIcons } from '@pctac/config.js';

import { ENTITY_COLORS } from './constants.js';
import type { PlanEntityKind, PlanMapInternal } from './types.js';

export const PingModalMethods = {
    // planMap.js:957-970
    // R2-T1 : `<dialog>` natif — `.showModal()` remplace le fond partagé
    // `#modalBackdrop` (disparu) + `style.display`.
    _openPingModal(this: PlanMapInternal): void {
        const modal = document.getElementById('pingModal') as HTMLDialogElement | null;
        if (modal) modal.showModal();
        const labelInput = document.getElementById('free_pin_label') as HTMLInputElement | null;
        if (labelInput) labelInput.value = '';
        const veh = document.getElementById('free_pin_is_vehicle') as HTMLInputElement | null;
        if (veh) veh.checked = false;
        // Réinit icône
        this._setSelectedIcon('', 'Pin par défaut');
        this._refreshIconSuggestions('');
        const cat = document.getElementById('pin_icon_catalog');
        if (cat) cat.style.display = 'none';
        this._renderPingEntities();
        this._bindIconPickerOnce();
    },

    // planMap.js:972-975
    _closePingModal(this: PlanMapInternal): void {
        const modal = document.getElementById('pingModal') as HTMLDialogElement | null;
        if (modal) modal.close();
    },

    /** Rend la liste des entités existantes (Adv/Otage/Ami) dans la modale Ping */
    // planMap.js:977-1027
    _renderPingEntities(this: PlanMapInternal): void {
        const list = document.getElementById('ping_entities_list');
        if (!list) return;

        const pins = this._loadPins();
        const placedIds = new Set(pins.filter((p) => p.entityRef).map((p) => `${p.entityRef?.kind}:${p.entityRef?.id}`));

        const adversaries = Storage.loadCollection(ADVERSARIES_KEY);
        const hostages = Storage.loadCollection(HOSTAGES_KEY);
        const friends = Storage.loadCollection(FRIENDS_KEY);

        const block = (title: string, items: ReturnType<typeof Storage.loadCollection>, kind: PlanEntityKind, color: string): string => {
            if (!items.length) return '';
            return `
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">${title}</div>
                    ${items.map(it => {
                        const placed = placedIds.has(`${kind}:${it.id}`);
                        const label = `${it.nom || ''} ${it.prenom || ''}`.trim() || it.unite || '(sans nom)';
                        return `
                            <div class="plan-entity-item" data-kind="${kind}" data-id="${it.id}"
                                 style="display: flex; align-items: center; gap: 6px; padding: 8px 8px; border-radius: 4px; cursor: ${placed ? 'default' : 'pointer'}; background: ${placed ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)'}; border-left: 3px solid ${color}; opacity: ${placed ? 0.6 : 1};">
                                <span style="flex: 1; font-size: 0.9em;">${label}</span>
                                <span style="font-size: 0.7em; color: var(--text-muted);">${placed ? 'placé' : 'à placer'}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        };

        const html =
            block('Adversaires', adversaries, 'adv', ENTITY_COLORS.adv) +
            block('Otages', hostages, 'host', ENTITY_COLORS.host) +
            block('Amis / Unités', friends, 'friend', ENTITY_COLORS.friend);

        list.innerHTML = html || '<div style="color: var(--text-muted); font-size: 0.85em; padding: 6px;">Aucune entité créée. Ajoute des adversaires/otages/amis dans leurs onglets respectifs, ou crée un point libre ci-dessous.</div>';

        list.querySelectorAll<HTMLElement>('.plan-entity-item').forEach(el => {
            el.onclick = () => {
                // dataset.kind/.id sont TOUJOURS définis ici : posés juste au-dessus
                // par `block()` via `data-kind="${kind}"` / `data-id="${it.id}"` —
                // cast/repli de typage pur (jamais observés en pratique), cf.
                // SPEC-PLANMAP-SPLIT §6.3.
                const kind = el.dataset.kind as PlanEntityKind;
                const id = el.dataset.id ?? '';
                if (placedIds.has(`${kind}:${id}`)) return;
                this.pendingFreePin = null;
                this.pendingEntityPin = { kind, id };
                this._closePingModal();
                const span = el.querySelector('span');
                this._showHint(`Clique sur la carte pour placer "${(span?.textContent ?? '').trim()}"`);
            };
        });
    },

    /** Met à jour l'aperçu (glyphe + label) et le champ caché pour l'icône choisie. */
    // planMap.js:1029-1037
    _setSelectedIcon(this: PlanMapInternal, iconId: string, iconLabel: string): void {
        const hidden = document.getElementById('free_pin_icon') as HTMLInputElement | null;
        const glyph = document.getElementById('pin_icon_current_glyph');
        const label = document.getElementById('pin_icon_current_label');
        if (hidden) hidden.value = iconId || '';
        if (glyph) glyph.textContent = iconId || 'place';
        if (label) label.textContent = iconLabel || (iconId ? iconId : 'Pin par défaut');
    },

    /** Liste les icônes les plus pertinentes pour le libellé courant. */
    // planMap.js:1039-1067
    _refreshIconSuggestions(this: PlanMapInternal, labelText: string): void {
        const wrap = document.getElementById('pin_icon_suggestions_wrap');
        const box = document.getElementById('pin_icon_suggestions');
        if (!wrap || !box) return;
        const list = suggestPinIcons(labelText, 6);
        if (!list.length) {
            wrap.style.display = 'none';
            box.innerHTML = '';
            return;
        }
        wrap.style.display = 'block';
        box.innerHTML = list.map(ic => `
            <button type="button" class="pin-icon-suggest"
                data-id="${ic.id}" data-label="${ic.label}"
                title="${ic.label}"
                style="display: inline-flex; align-items: center; gap: 6px;
                       padding: 6px 10px; border-radius: 6px;
                       background: rgba(59,130,246,0.12);
                       border: 1px solid rgba(59,130,246,0.4);
                       color: var(--text-main); cursor: pointer; font-size: 0.85em;">
                <span class="material-symbols-outlined" style="font-size: 20px;">${ic.id}</span>
                ${ic.label}
            </button>
        `).join('');
        box.querySelectorAll<HTMLButtonElement>('.pin-icon-suggest').forEach(btn => {
            btn.onclick = () => this._setSelectedIcon(btn.dataset.id ?? '', btn.dataset.label ?? '');
        });
    },

    /** Construit la grille complète du catalogue (groupée par catégorie). */
    // planMap.js:1069-1111
    _renderIconCatalog(this: PlanMapInternal, filterText: string): void {
        const grid = document.getElementById('pin_icon_grid');
        if (!grid) return;
        const q = (filterText || '').toLowerCase().trim();
        const filtered = PIN_ICONS.filter(ic => {
            if (!q) return true;
            const hay = (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase();
            return hay.includes(q);
        });
        // Groupage par catégorie
        const byCat = filtered.reduce<Record<string, typeof filtered>>((acc, ic) => {
            (acc[ic.cat] = acc[ic.cat] || []).push(ic);
            return acc;
        }, {});
        const html = Object.entries(byCat).map(([cat, items]) => `
            <div style="margin-bottom: 10px;">
                <div style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">${cat}</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px;">
                    ${items.map(ic => `
                        <button type="button" class="pin-icon-cell" data-id="${ic.id}" data-label="${ic.label}"
                            title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; gap: 4px;
                                   padding: 8px 4px; border-radius: 6px;
                                   background: rgba(255,255,255,0.04);
                                   border: 1px solid var(--border-glass);
                                   color: var(--text-main); cursor: pointer; font-size: 0.7em;">
                            <span class="material-symbols-outlined" style="font-size: 24px;">${ic.id}</span>
                            <span style="text-align: center; line-height: 1.1;">${ic.label}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `).join('') || '<div style="color: var(--text-muted); font-size: 0.85em;">Aucune icône.</div>';
        grid.innerHTML = html;
        grid.querySelectorAll<HTMLButtonElement>('.pin-icon-cell').forEach(btn => {
            btn.onclick = () => {
                this._setSelectedIcon(btn.dataset.id ?? '', btn.dataset.label ?? '');
                const cat = document.getElementById('pin_icon_catalog');
                if (cat) cat.style.display = 'none';
            };
        });
    },

    /** Branche les listeners du picker (une seule fois par session). */
    // planMap.js:1113-1140
    _bindIconPickerOnce(this: PlanMapInternal): void {
        if (this._iconPickerBound) {
            // À chaque ouverture on rafraîchit juste le catalogue (au cas où)
            this._renderIconCatalog('');
            return;
        }
        this._iconPickerBound = true;

        const labelInput = document.getElementById('free_pin_label');
        if (labelInput) {
            labelInput.addEventListener('input', (e) => this._refreshIconSuggestions((e.target as HTMLInputElement).value));
        }
        const toggle = document.getElementById('pin_icon_picker_toggle');
        const catalog = document.getElementById('pin_icon_catalog');
        if (toggle && catalog) {
            toggle.onclick = () => {
                const open = catalog.style.display !== 'none';
                catalog.style.display = open ? 'none' : 'block';
                if (!open) this._renderIconCatalog((document.getElementById('pin_icon_search') as HTMLInputElement | null)?.value || '');
            };
        }
        const search = document.getElementById('pin_icon_search');
        if (search) {
            search.addEventListener('input', (e) => this._renderIconCatalog((e.target as HTMLInputElement).value));
        }
        this._renderIconCatalog('');
    },

    // planMap.js:1142-1154
    _armFreePinPlacement(this: PlanMapInternal): void {
        const labelInput = document.getElementById('free_pin_label') as HTMLInputElement | null;
        const label = (labelInput ? labelInput.value : '').trim();
        const colorInput = document.getElementById('free_pin_color') as HTMLInputElement | null;
        const color = colorInput ? colorInput.value : '';
        const kindInput = document.getElementById('free_pin_kind') as HTMLInputElement | null;
        let kind = kindInput ? kindInput.value : '';
        const isVehicle = (document.getElementById('free_pin_is_vehicle') as HTMLInputElement | null)?.checked;
        if (isVehicle) kind = 'Vehicule';
        const icon = ((document.getElementById('free_pin_icon') as HTMLInputElement | null)?.value || '').trim();
        if (!label) return alert('Libellé requis');
        this.pendingEntityPin = null;
        this.pendingFreePin = { label, color, kind, icon };
        this._closePingModal();
        this._showHint(`Clique sur la carte pour placer "${label}"`);
    },
};
