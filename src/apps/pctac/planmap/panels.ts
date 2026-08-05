/**
 * panels.ts — Mini-panneaux flottants inline (P2.CONV, paquet `pm-panels`).
 * ===========================================================================
 *
 * Port TypeScript verbatim des 7 méthodes MINI-PANELS de `planMap.js`
 * (`_closeInlinePanel`, `_openInlinePanel`, `_editPinText`, `_editPinDiameter`,
 * `_openIconCatalogPanel`, `_openPinColorPanel`, `_openIconCatalogPanelForEdit`
 * — planMap.js:3745-4240). Corps VERBATIM (cf. docs/SPEC-PLANMAP-SPLIT.md
 * §1.2-1.3, §4.13) : seules des adaptations de TYPAGE strict sont apportées
 * (générique `querySelector<T>`, gardes de non-nullité imposées par
 * `noUncheckedIndexedAccess`/`strictNullChecks`, `catch {}` sans binding pour
 * `@typescript-eslint/no-unused-vars`) ; aucune restructuration de logique,
 * aucun changement d'échappement HTML, aucun `addEventListener` en lieu et
 * place des affectations `el.onclick = …` (§6.6).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import type { InlinePanelElement, InlinePanelOptions, LngLatObj, PlanMapInternal } from './types.js';
import { PIN_ICONS, suggestPinIcons } from '@pctac/config.js';

export const PanelsMethods = {
    // ============================================================
    // =======  MINI-PANELS INLINE (sans prompt natif)  ===========
    // ============================================================

    /** Ferme le mini-panel actif s'il y en a un. */
    // planMap.js:3745
    _closeInlinePanel(this: PlanMapInternal): void {
        if (this._inlinePanel) {
            try { if (this._inlinePanel.__cleanup) this._inlinePanel.__cleanup(); } catch { /* best-effort */ }
            try { this._inlinePanel.remove(); } catch { /* best-effort */ }
            this._inlinePanel = null;
            this._wheelJustClosed = Date.now(); // évite la réouverture par tap juste après
        }
    },

    /**
     * Crée un mini-panel flottant ancré à une position lng/lat sur la carte.
     * Le panel suit le pan/zoom. Auto-ferme sur outside tap (capture phase).
     * @returns {HTMLElement} l'élément à remplir
     */
    // planMap.js:3759
    _openInlinePanel(this: PlanMapInternal, lngLat: LngLatObj | null, contentHtml: string, opts?: InlinePanelOptions): InlinePanelElement {
        const { onMount, anchorOffsetY = -56, centerScreen = false, onBack = null } = opts ?? {};
        this._closeInlinePanel();
        this._closeWheel();
        const map = this.map;
        // Garde de typage strict (`this.map: MapLibreMap | null`) : ce panneau n'est
        // ouvert que depuis des handlers actifs uniquement quand la vue Plan/la carte
        // sont initialisées (invariant de l'original, jamais vérifié explicitement) —
        // jamais atteint en pratique ; retour d'un élément détaché plutôt qu'un throw
        // (les méthodes de ce module ne doivent pas jeter, cf. SPEC-PLANMAP-SPLIT §9).
        if (!map) return document.createElement('div') as InlinePanelElement;
        const parent = map.getContainer();
        const el = document.createElement('div') as InlinePanelElement;
        el.className = 'plan-inline-panel';
        el.style.cssText = `
            position: absolute;
            transform: translate(-50%, -50%) scale(0.92);
            opacity: 0;
            transition: transform 140ms cubic-bezier(.34,1.56,.64,1), opacity 120ms ease-out;
            background: rgba(20,24,32,0.96);
            backdrop-filter: blur(10px);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 12px;
            padding: 10px 12px;
            box-shadow: 0 10px 28px rgba(0,0,0,0.6);
            font-family: var(--font-ui, sans-serif);
            z-index: 70;
            display: flex; align-items: center; gap: 8px;
            max-width: min(94vw, 420px);
        `;
        // Bouton retour optionnel (← roue précédente) ajouté avant le contenu
        const backHtml = onBack ? `
            <button type="button" data-panel-back="1" title="Retour"
                style="min-width: 38px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);
                       color: #fff; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;">
                <span class="material-symbols-outlined" style="font-size: 20px;">arrow_back</span>
            </button>
        ` : '';
        el.innerHTML = backHtml + contentHtml;
        // Empêche les events de la map sur ce panel
        el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        el.addEventListener('mousedown',   (ev) => ev.stopPropagation());
        el.addEventListener('touchstart',  (ev) => ev.stopPropagation(), { passive: true });
        if (onBack) {
            const backBtn = el.querySelector('[data-panel-back="1"]');
            if (backBtn instanceof HTMLElement) {
                backBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    this._closeInlinePanel();
                    setTimeout(() => onBack(), 60);
                };
            }
        }
        parent.appendChild(el);

        const clampToParent = (): void => {
            // Garantit que le panel reste entièrement visible dans la carte.
            if (!el || !el.isConnected) return;
            const r = el.getBoundingClientRect();
            const pr = parent.getBoundingClientRect();
            const pad = 8;
            let dx = 0, dy = 0;
            if (r.left   < pr.left   + pad) dx = pr.left   + pad - r.left;
            if (r.right  > pr.right  - pad) dx = pr.right  - pad - r.right;
            if (r.top    < pr.top    + pad) dy = pr.top    + pad - r.top;
            if (r.bottom > pr.bottom - pad) dy = pr.bottom - pad - r.bottom;
            if (dx || dy) {
                const left = parseFloat(el.style.left) || 0;
                const top  = parseFloat(el.style.top)  || 0;
                el.style.left = `${left + dx}px`;
                el.style.top  = `${top  + dy}px`;
            }
        };
        const reposition = (): void => {
            if (!lngLat || centerScreen) {
                const r = parent.getBoundingClientRect();
                el.style.left = `${r.width / 2}px`;
                el.style.top  = `${r.height / 2}px`;
            } else {
                const p = map.project(lngLat);
                el.style.left = `${p.x}px`;
                el.style.top  = `${p.y + anchorOffsetY}px`;
            }
            // Clamp immédiat puis encore après layout (au cas où contenu changé)
            requestAnimationFrame(clampToParent);
        };
        reposition();
        map.on('move', reposition);
        map.on('zoom', reposition);

        // Outside tap closes
        const mountedAt = Date.now();
        const onOutside = (ev: PointerEvent): void => {
            if (Date.now() - mountedAt < 300) return;
            const target = ev.target instanceof Element ? ev.target : null;
            if (target && (target.closest('.plan-inline-panel') || target.closest('.plan-pin') || target.closest('.plan-wheel'))) return;
            if (!el.contains(target)) {
                this._closeInlinePanel();
            }
        };
        document.addEventListener('pointerdown', onOutside, { capture: true });
        const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') this._closeInlinePanel(); };
        document.addEventListener('keydown', onKey);

        this._inlinePanel = el;
        el.__cleanup = () => {
            try { map.off('move', reposition); } catch { /* API MapLibre selon état du style */ }
            try { map.off('zoom', reposition); } catch { /* API MapLibre selon état du style */ }
            document.removeEventListener('pointerdown', onOutside, { capture: true });
            document.removeEventListener('keydown', onKey);
        };
        // Hook personnalisé pour wiring après mount
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%, -50%) scale(1)';
            if (onMount) onMount(el);
        });
        return el;
    },

    /** Édite (ou ajoute) le texte d'un ping via un mini-panel flottant. */
    // planMap.js:3870
    _editPinText(this: PlanMapInternal, pinId: string): void {
        const list = this._loadPins();
        const p = list.find((x) => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const initialRaw = p.text || '';
        const initial = initialRaw.replace(/"/g, '&quot;');
        // Champ intitulé + rangée d'icônes suggérées (recherche auto selon le texte tapé).
        const html = `
            <div style="display:flex; flex-direction:column; gap:8px; flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="material-symbols-outlined" style="font-size: 20px; color: #eab308;">text_fields</span>
                    <input type="text" value="${initial}" placeholder="Intitulé du ping…" autocomplete="off"
                        style="flex:1; min-width: 140px; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                               border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 15px;
                               outline: none;" />
                    <button type="button" data-act="save" title="Enregistrer"
                        style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer; flex:0 0 auto;
                               background: #22c55e; border: 1px solid #16a34a; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                        <span class="material-symbols-outlined" style="font-size: 20px;">check</span>
                    </button>
                    <button type="button" data-act="clear" title="Effacer le texte"
                        style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer; flex:0 0 auto;
                               background: rgba(239,68,68,0.18); border: 1px solid #ef4444; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                        <span class="material-symbols-outlined" style="font-size: 20px;">delete</span>
                    </button>
                </div>
                <div data-suggest style="display:none; align-items:center; flex-wrap:wrap; gap:6px; max-width:340px;"></div>
            </div>
        `;
        this._openInlinePanel(ll, html, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const input = root.querySelector('input');
                const suggest = root.querySelector<HTMLElement>('[data-suggest]');
                const saveBtn = root.querySelector<HTMLButtonElement>('[data-act="save"]');
                const clearBtn = root.querySelector<HTMLButtonElement>('[data-act="clear"]');
                // Gardes de typage strict (`querySelector` est nullable) : ces éléments
                // existent toujours, ils viennent du HTML généré ci-dessus.
                if (!input || !saveBtn || !clearBtn) return;
                if (input) { input.focus(); input.select(); }

                // Applique une icône au ping (clic sur une suggestion), en direct.
                const applyIcon = (iconId: string | undefined): void => {
                    const list2 = this._loadPins();
                    const p2 = list2.find((x) => x.id === pinId);
                    if (!p2) return;
                    if (iconId) p2.icon = iconId; else delete p2.icon;
                    this._savePins(list2);
                    this._renderPins();
                    renderSuggest(input ? input.value : ''); // rafraîchit la surbrillance
                };

                // Recherche auto : propose les icônes en rapport avec l'intitulé.
                const renderSuggest = (text: string): void => {
                    if (!suggest) return;
                    const found = suggestPinIcons(text, 6);
                    if (!found.length) { suggest.style.display = 'none'; suggest.innerHTML = ''; return; }
                    const curPin = this._loadPins().find((x) => x.id === pinId);
                    const curIcon = (curPin && curPin.icon) || '';
                    suggest.style.display = 'flex';
                    suggest.innerHTML =
                        `<span style="font-size:0.68em; color:var(--text-muted); width:100%; letter-spacing:.5px; text-transform:uppercase;">Icônes suggérées</span>`
                        + found.map((ic) => {
                            const on = ic.id === curIcon;
                            return `<button type="button" class="pin-suggest" data-id="${ic.id}" title="${ic.label}"
                                style="display:inline-flex; align-items:center; gap:5px; padding:5px 9px; border-radius:7px; cursor:pointer;
                                       background:${on ? 'rgba(34,197,94,0.22)' : 'rgba(59,130,246,0.12)'};
                                       border:1px solid ${on ? '#22c55e' : 'rgba(59,130,246,0.4)'};
                                       color:#fff; font-size:0.82em;">
                                <span class="material-symbols-outlined" style="font-size:19px;">${ic.id}</span>${ic.label}
                            </button>`;
                        }).join('');
                    suggest.querySelectorAll<HTMLButtonElement>('.pin-suggest').forEach((btn) => {
                        btn.onclick = () => {
                            const id = btn.dataset.id;
                            const curPin2 = this._loadPins().find((x) => x.id === pinId);
                            const isOn = curPin2 && curPin2.icon === id;
                            applyIcon(isOn ? '' : id); // reclic sur l'icône active → pin par défaut
                        };
                    });
                };

                renderSuggest(initialRaw);
                if (input) input.addEventListener('input', () => renderSuggest(input.value));

                saveBtn.onclick = () => {
                    const v = (input.value || '').trim();
                    const list2 = this._loadPins();
                    const p2 = list2.find((x) => x.id === pinId);
                    if (p2) { p2.text = v; this._savePins(list2); this._renderPins(); }
                    this._closeInlinePanel();
                };
                clearBtn.onclick = () => {
                    const list2 = this._loadPins();
                    const p2 = list2.find((x) => x.id === pinId);
                    if (p2) { delete p2.text; this._savePins(list2); this._renderPins(); }
                    this._closeInlinePanel();
                };
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') saveBtn.click();
                });
            }
        });
    },

    /**
     * Mini-panel diamètre — combine MODIFIER la valeur ET TOGGLE on/off l'affichage.
     *  - Toggle visibilité : conserve la valeur, masque/affiche le cercle
     *  - Presets / custom  : changent la valeur
     *  - Bouton ✕          : retire complètement le diamètre
     */
    // planMap.js:3977
    _editPinDiameter(this: PlanMapInternal, pinId: string): void {
        const list = this._loadPins();
        const p = list.find((x) => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const current = p.diameterM || 0;
        const visible = (p.diameterM ?? 0) > 0 && p.showDiameter !== false;
        const presets = [50, 100, 250, 500, 1000];
        const preBtn = (v: number): string => `
            <button type="button" data-preset="${v}"
                style="min-width: 56px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: ${current === v ? '#22c55e' : 'rgba(255,255,255,0.08)'};
                       border: 1px solid ${current === v ? '#16a34a' : 'rgba(255,255,255,0.18)'};
                       color: #fff; font-weight: 600; font-size: 13px; padding: 0 10px;">
                ${v < 1000 ? v + ' m' : (v/1000) + ' km'}
            </button>`;
        const toggleIcon = visible ? 'visibility' : 'visibility_off';
        const toggleColor = visible ? '#22c55e' : '#94a3b8';
        const toggleTitle = visible ? 'Cercle visible (cliquer pour masquer)' : 'Cercle masqué (cliquer pour afficher)';
        this._openInlinePanel(ll, `
            <button type="button" data-act="toggle" title="${toggleTitle}"
                style="min-width: 44px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(255,255,255,0.06); border: 1px solid ${toggleColor};
                       color: ${toggleColor}; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 22px;">${toggleIcon}</span>
            </button>
            <span class="material-symbols-outlined" style="font-size: 20px; color: #22c55e;">straighten</span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                ${presets.map(preBtn).join('')}
                <input type="number" min="1" step="1" placeholder="custom (m)" value="${current && !presets.includes(current) ? current : ''}"
                    style="width: 100px; min-height: 38px; background: rgba(255,255,255,0.08); color: #fff;
                           border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px;
                           outline: none;" />
            </div>
            <button type="button" data-act="clear" title="Retirer complètement"
                style="min-width: 40px; min-height: 38px; border-radius: 8px; cursor: pointer;
                       background: rgba(239,68,68,0.18); border: 1px solid #ef4444; color: #fff; display: inline-flex; align-items: center; justify-content: center;">
                <span class="material-symbols-outlined" style="font-size: 20px;">close</span>
            </button>
        `, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const setDiameter = (n: number): void => {
                    const list2 = this._loadPins();
                    const p2 = list2.find((x) => x.id === pinId);
                    if (!p2) return;
                    if (!isFinite(n) || n <= 0) {
                        delete p2.diameterM;
                        delete p2.showDiameter;
                    } else {
                        p2.diameterM = n;
                        p2.showDiameter = true; // forcer affichage à l'assignation d'une valeur
                    }
                    this._savePins(list2);
                    this._renderPins();
                    this._closeInlinePanel();
                };
                const toggleVisibility = (): void => {
                    const list2 = this._loadPins();
                    const p2 = list2.find((x) => x.id === pinId);
                    if (!p2) return;
                    if (!p2.diameterM || p2.diameterM <= 0) {
                        // pas de diamètre défini → on ne peut pas toggler ; ouvre direct la saisie
                        return;
                    }
                    p2.showDiameter = !(p2.showDiameter !== false);
                    this._savePins(list2);
                    this._renderPins();
                    this._closeInlinePanel();
                };
                const toggleBtn = root.querySelector<HTMLButtonElement>('[data-act="toggle"]');
                const clearBtn = root.querySelector<HTMLButtonElement>('[data-act="clear"]');
                const input = root.querySelector<HTMLInputElement>('input[type="number"]');
                // Gardes de typage strict (`querySelector` est nullable) : ces éléments
                // existent toujours, ils viennent du HTML généré ci-dessus.
                if (!toggleBtn || !clearBtn || !input) return;
                toggleBtn.onclick = toggleVisibility;
                root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
                    b.onclick = () => {
                        setDiameter(parseFloat(b.dataset.preset ?? ''));
                    };
                });
                clearBtn.onclick = () => setDiameter(NaN);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') setDiameter(parseFloat(input.value));
                });
                input.addEventListener('blur', () => {
                    const v = parseFloat(input.value);
                    if (isFinite(v) && v > 0) setDiameter(v);
                });
            }
        });
    },

    /**
     * Panneau flottant catalogue d'icônes (remplace l'ancien sous-menu wheel).
     * Recentre la carte sur lngLat pour garantir la visibilité complète du panel
     * (sinon il peut déborder hors écran sur petits viewports).
     */
    // planMap.js:4069
    _openIconCatalogPanel(this: PlanMapInternal, lngLat: LngLatObj): void {
        this._closeWheel();
        // Recentrage : easeTo immédiat pour que le panel apparaisse au centre visible
        try { if (this.map) this.map.easeTo({ center: [lngLat.lng, lngLat.lat], duration: 300 }); } catch { /* best-effort */ }
        // Construction HTML
        const colorChips = this._otanColors().map((o) => `
            <button type="button" class="cat-col" data-color="${o.color}" data-kind="${o.kind}" title="${o.kind}"
                style="min-width: 38px; min-height: 38px; border-radius: 50%;
                       background: ${o.color}; border: 3px solid ${o.color === '#94a3b8' ? '#fff' : 'transparent'};
                       cursor: pointer; flex: 0 0 auto;"></button>
        `).join('');
        const html = `
            <div style="display: flex; flex-direction: column; gap: 8px; width: min(92vw, 360px); max-width: 100%;">
                <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="material-symbols-outlined" style="font-size: 20px; color: #fff;">palette</span>
                        <strong style="font-size: 13px;">Couleur</strong>
                    </div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto;">${colorChips}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="text" id="cat-filter" placeholder="Filtrer (police, pompier…)" autocomplete="off"
                        style="flex: 1; min-height: 40px; background: rgba(255,255,255,0.08); color: #fff;
                               border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px; outline: none;" />
                </div>
                <div id="cat-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
                     gap: 6px; max-height: min(50vh, 260px); overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; padding-right: 2px;"></div>
            </div>
        `;
        this._openInlinePanel(lngLat, html, {
            centerScreen: true,
            onBack: () => this._openCreatePingWheel(lngLat),
            onMount: (root) => {
                let selectedColor = '#3b82f6';
                let selectedKind  = 'Inter';
                const grid = root.querySelector<HTMLElement>('#cat-grid');
                const filterInput = root.querySelector<HTMLInputElement>('#cat-filter');
                // Gardes de typage strict (`querySelector` est nullable) : ces éléments
                // existent toujours, ils viennent du HTML généré ci-dessus.
                if (!grid || !filterInput) return;
                // Sélection initiale
                root.querySelectorAll<HTMLElement>('.cat-col').forEach((c) => {
                    c.style.borderColor = (c.dataset.color === selectedColor) ? '#fff' : 'transparent';
                });
                root.querySelectorAll<HTMLElement>('.cat-col').forEach((c) => {
                    c.onclick = () => {
                        selectedColor = c.dataset.color ?? selectedColor;
                        selectedKind  = c.dataset.kind ?? selectedKind;
                        root.querySelectorAll<HTMLElement>('.cat-col').forEach((o) => { o.style.borderColor = 'transparent'; });
                        c.style.borderColor = '#fff';
                    };
                });

                const renderGrid = (filter = ''): void => {
                    const q = filter.toLowerCase().trim();
                    const filtered = PIN_ICONS.filter((ic) => {
                        if (!q) return true;
                        return (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes(q);
                    });
                    grid.innerHTML = filtered.map((ic) => `
                        <button type="button" class="cat-ic" data-id="${ic.id}" data-label="${ic.label}" title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
                                   min-height: 52px; padding: 6px 4px; border-radius: 8px;
                                   background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18);
                                   color: #fff; cursor: pointer;">
                            <span class="material-symbols-outlined" style="font-size: 22px;">${ic.id}</span>
                            <span style="font-size: 0.68em; text-align: center; line-height: 1.05; word-break: break-word;">${ic.label}</span>
                        </button>
                    `).join('');
                    grid.querySelectorAll<HTMLButtonElement>('.cat-ic').forEach((b) => {
                        b.onclick = () => {
                            const ic = { id: b.dataset.id ?? '', label: b.dataset.label ?? '' };
                            const otan = { kind: selectedKind, color: selectedColor };
                            this._closeInlinePanel();
                            this._quickPlacePing(lngLat, otan, ic.id);
                        };
                    });
                };
                renderGrid('');
                filterInput.addEventListener('input', () => renderGrid(filterInput.value));
            }
        });
    },

    /** Mini-panel inline pour changer la couleur OTAN d'un ping (sans sous-wheel). */
    // planMap.js:4149
    _openPinColorPanel(this: PlanMapInternal, pinId: string): void {
        const p = this._loadPins().find((x) => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        const chips = this._otanColors().map((o) => `
            <button type="button" data-color="${o.color}" data-kind="${o.kind}" title="${o.kind}"
                style="min-width: 44px; min-height: 44px; border-radius: 50%;
                       background: ${o.color}; cursor: pointer;
                       border: 3px solid ${p.color === o.color ? '#fff' : 'transparent'};
                       box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></button>
        `).join('');
        this._openInlinePanel(ll, `
            <span class="material-symbols-outlined" style="font-size: 20px;">palette</span>
            <strong style="font-size: 13px;">Couleur :</strong>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">${chips}</div>
        `, {
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                root.querySelectorAll<HTMLButtonElement>('button[data-color]').forEach((b) => {
                    b.onclick = () => {
                        const list = this._loadPins();
                        const p2 = list.find((x) => x.id === pinId);
                        if (p2) { p2.color = b.dataset.color; p2.kind = b.dataset.kind; this._savePins(list); this._renderPins(); }
                        this._closeInlinePanel();
                    };
                });
            }
        });
    },

    /** Catalogue d'icônes pour MODIFIER un ping existant (préserve la couleur). */
    // planMap.js:4180
    _openIconCatalogPanelForEdit(this: PlanMapInternal, pinId: string): void {
        const p = this._loadPins().find((x) => x.id === pinId);
        if (!p) return;
        const ll = { lng: p.lng, lat: p.lat };
        try { if (this.map) this.map.easeTo({ center: [ll.lng, ll.lat], duration: 300 }); } catch { /* best-effort */ }
        const html = `
            <div style="display: flex; flex-direction: column; gap: 8px; width: min(92vw, 360px); max-width: 100%;">
                <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="material-symbols-outlined" style="font-size: 20px; color: ${p.color || '#fff'};">${p.icon || 'place'}</span>
                        <strong style="font-size: 13px;">Icône actuelle</strong>
                    </div>
                    <input type="text" id="cat-edit-filter" placeholder="Filtrer…" autocomplete="off"
                        style="flex: 1; min-width: 110px; min-height: 40px; background: rgba(255,255,255,0.08); color: #fff;
                               border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 10px; font-size: 14px; outline: none;" />
                </div>
                <div id="cat-edit-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
                     gap: 6px; max-height: min(50vh, 260px); overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; padding-right: 2px;"></div>
            </div>
        `;
        this._openInlinePanel(ll, html, {
            centerScreen: true,
            onBack: () => this._openPingOptionsWheel(pinId),
            onMount: (root) => {
                const grid = root.querySelector<HTMLElement>('#cat-edit-grid');
                const fi = root.querySelector<HTMLInputElement>('#cat-edit-filter');
                // Gardes de typage strict (`querySelector` est nullable) : ces éléments
                // existent toujours, ils viennent du HTML généré ci-dessus.
                if (!grid || !fi) return;
                const renderGrid = (filter = ''): void => {
                    const q = filter.toLowerCase().trim();
                    const filtered = PIN_ICONS.filter((ic) =>
                        !q || (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes(q)
                    );
                    grid.innerHTML = filtered.map((ic) => `
                        <button type="button" class="cat-edit-ic" data-id="${ic.id}" title="${ic.label}"
                            style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
                                   min-height: 52px; padding: 6px 4px; border-radius: 8px;
                                   background: ${ic.id === p.icon ? p.color + '40' : 'rgba(255,255,255,0.06)'};
                                   border: 1px solid ${ic.id === p.icon ? p.color : 'rgba(255,255,255,0.18)'};
                                   color: #fff; cursor: pointer;">
                            <span class="material-symbols-outlined" style="font-size: 22px;">${ic.id}</span>
                            <span style="font-size: 0.68em; text-align: center; line-height: 1.05; word-break: break-word;">${ic.label}</span>
                        </button>
                    `).join('');
                    grid.querySelectorAll<HTMLButtonElement>('.cat-edit-ic').forEach((b) => {
                        b.onclick = () => {
                            const list = this._loadPins();
                            const tgt = list.find((x) => x.id === pinId);
                            if (tgt) {
                                tgt.icon = b.dataset.id;
                                // Met à jour le label par défaut au nom de la nouvelle icône
                                const ic = PIN_ICONS.find((i) => i.id === b.dataset.id);
                                if (ic) tgt.label = ic.label;
                                this._savePins(list);
                                this._renderPins();
                            }
                            this._closeInlinePanel();
                        };
                    });
                };
                renderGrid('');
                fi.addEventListener('input', () => renderGrid(fi.value));
            }
        });
    },
};
