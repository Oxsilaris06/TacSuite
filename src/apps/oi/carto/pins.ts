/**
 * pins.ts — PINS : modale de sélection, listes, placement, markers
 * (P3.CONV, paquet `oi-carto-pins`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 21 méthodes de la section « PINS — membres
 * PATRACDVR + pins OI dédiés » de `oi_cartographie.js` (GStart-main, lecture
 * seule, lignes 614-991) : `_openPingModal` (:618), `_closePingModal` (:627),
 * `_renderPingLists` (:633-700), `_memberLabel` (:701), `_customOr` (:708),
 * `_emptyMsg` (:713), `_pinButton` (:717), `_isMemberPlaced` (:729),
 * `_renderMemberList` (:737-781), `_memberButton` (:782), `_resetMember`
 * (:817), `_goToMember` (:825), `_getPatracdvrVehicles` (:833),
 * `_getAdversaryVehicles` (:840), `_armPinPlacement` (:849), `_onMapClick`
 * (:856), `_addPin` (:880), `_removePin` (:887), `_clearAllPins` (:893),
 * `_renderPins` (:904-986, CŒUR du module), `_esc` (:987). Cf.
 * `docs/SPEC-OI-CONVERSION.md` §6.2/§6.3, `PAQUETS-OI.json` (`oi-carto-pins`).
 *
 * COUPLAGE DOM ASSUMÉ (mission, à préserver) : ce groupe scrute directement le
 * DOM du formulaire OI — `.patracdvr-member-btn` (:635), `#patracdvr_container
 * .patracdvr-vehicle-row` (:834), `[id^="vehicules_"] .dynamic-input` (:841) —
 * volontairement, PAS un import de `patrac.ts` : ce ne sont pas des globaux
 * `window` (règle d'or SPEC §2.2), ce sont des lectures DOM directes déjà
 * présentes dans l'original, portées telles quelles.
 *
 * INVARIANT MARKERS (PLAN.md §4.7, transposé de PC-Tac `planmap/pins.ts`) :
 * `_renderPins` (:927, :949) ne pose JAMAIS de `position` inline sur
 * l'élément d'un `maplibregl.Marker` — la création des markers est portée
 * EXACTEMENT comme l'original (halo icône + label séparé, drag groupé).
 *
 * Les `innerHTML` (:648, 670, 682, 694, 738, 740, 757, 798, 803, 921, 943)
 * sont portés VERBATIM avec leur échappement d'origine (`_esc`, appelé
 * seulement aux sites où l'original l'appelle, :943-944) — rien n'est ajouté.
 *
 * Adaptations de TYPAGE PUR (aucune restructuration de logique, cf. règle
 * commune §3/§9) :
 *   - `this.markers` (`OICartoContract.markers: Map<string, unknown>`,
 *     contrat figé — règle commune §6) : un garde de type local
 *     `isOiCartoMarkerEntry` reconstitue la forme `{ pin: Marker; label:
 *     Marker }` (commentaire d'origine, oi_cartographie.js:275) à la LECTURE ;
 *     l'ÉCRITURE (`this.markers.set`) est déjà valide (`unknown` accepte
 *     toute valeur).
 *   - `_memberLabel`/`_renderPingLists`/`_renderMemberList` : `HTMLElement.dataset`
 *     est `string | undefined` ; dans les branches où l'original suppose une
 *     valeur déjà garantie (le trigramme est filtré non vide en amont, :636),
 *     un repli `?? ''` pur est ajouté, jamais emprunté en pratique.
 *   - `_getPatracdvrVehicles` (:836) : `.filter(Boolean)` → prédicat de type
 *     explicite (`(name): name is string => Boolean(name)`), même filtrage,
 *     retour bien `string[]`.
 *   - `_esc` (:988) : le littéral d'échappement est typé `Record<string,
 *     string>` (l'original n'a que des clés fixes, `c` n'est pas un type
 *     littéral pour TS) ; le repli `?? c` n'est jamais emprunté (la regex ne
 *     capture que les 5 caractères présents dans le littéral).
 *   - `#oi_carto_ping_modal` (dialog) / `#oi_carto_pin_label` (input) :
 *     `document.getElementById` renvoie `HTMLElement | null` en TS strict ;
 *     casts `as HTMLDialogElement | null` / `as HTMLInputElement | null`
 *     (éléments STATIQUES de `oi/index.html`, jamais recréés).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { MapMouseEvent, Marker } from 'maplibre-gl';

import { OI_PIN_DEFS, OI_PIN_FALLBACK, oiIconForMember } from './constants.js';
import type { OICartoInternal, OiCartoPendingPin, OiCartoPin, OiCartoPinKind } from './types.js';

/**
 * Forme du couple de markers stocké sous chaque id de `this.markers`
 * (oi_cartographie.js:275, commentaire d'origine « id -> { pin: Marker, label:
 * Marker } »). `OICartoContract.markers` (contracts.ts, contrat figé) est
 * typé `Map<string, unknown>` : ce garde de type reconstitue la forme réelle
 * à la lecture, sans `any` ni assertion non vérifiée.
 */
interface OiCartoMarkerEntry {
    pin: Marker;
    label: Marker;
}

function isOiCartoMarkerEntry(x: unknown): x is OiCartoMarkerEntry {
    return typeof x === 'object' && x !== null && 'pin' in x && 'label' in x;
}

export const PinsMethods = {
    // oi_cartographie.js:618-625
    _openPingModal(this: OICartoInternal): void {
        const modal = document.getElementById('oi_carto_ping_modal') as HTMLDialogElement | null;
        if (!modal) return;
        const labelInput = document.getElementById('oi_carto_pin_label') as HTMLInputElement | null;
        if (labelInput) labelInput.value = '';
        this._renderPingLists();
        if (!modal.open) modal.showModal();
    },

    // oi_cartographie.js:627-630
    _closePingModal(): void {
        const modal = document.getElementById('oi_carto_ping_modal') as HTMLDialogElement | null;
        if (modal && modal.open) modal.close();
    },

    /** Construit toutes les sections de la modale d'ajout de point. */
    // oi_cartographie.js:633-698
    _renderPingLists(this: OICartoInternal): void {
        // Membres PATRACDVR — même source que l'outil d'annotation photo.
        const members = Array.from(document.querySelectorAll<HTMLElement>('.patracdvr-member-btn'))
            .filter(b => b.dataset.trigramme && b.dataset.trigramme !== 'N/A');

        // 1) Membres (hors fonction Cyno) — triés par fonction, icône auto par fonction.
        const memberList = document.getElementById('oi_carto_member_list');
        if (memberList) {
            const regular = members.filter(b => b.dataset.fonction !== 'Cyno');
            this._renderMemberList(memberList, regular, 'member');
        }

        // 2) Cyno — pin générique + membres de fonction "Cyno" — icône chien
        const cynoList = document.getElementById('oi_carto_cyno_list');
        if (cynoList) {
            cynoList.innerHTML = '';
            cynoList.appendChild(this._pinButton('Cyno (générique)', OI_PIN_DEFS.cyno.color,
                () => this._armPinPlacement({ kind: 'cyno', label: this._customOr('Cyno') })));
            const cynoMembers = members.filter(b => b.dataset.fonction === 'Cyno');
            cynoMembers.forEach(b => {
                const tri = b.dataset.trigramme ?? '';
                const fonction = b.dataset.fonction || '';
                const label = this._memberLabel(b);
                const placed = this._isMemberPlaced(tri);
                cynoList.appendChild(this._memberButton({
                    text: label, color: OI_PIN_DEFS.cyno.color, placed, tri,
                    onPlace: () => this._armPinPlacement({
                        kind: 'cyno', label, memberTri: tri, fonction,
                        icon: oiIconForMember(fonction, b.dataset.cellule),
                    }),
                }));
            });
        }

        // 3) Rame VL — pin générique + véhicules du PATRACDVR — icône véhicule, bleu
        const rameList = document.getElementById('oi_carto_ramevl_list');
        if (rameList) {
            rameList.innerHTML = '';
            rameList.appendChild(this._pinButton('Rame VL (générique)', OI_PIN_DEFS.rame_vl.color,
                () => this._armPinPlacement({ kind: 'rame_vl', label: this._customOr('Rame VL') })));
            this._getPatracdvrVehicles().forEach(name => {
                rameList.appendChild(this._pinButton(name, OI_PIN_DEFS.rame_vl.color,
                    () => this._armPinPlacement({ kind: 'rame_vl', label: name })));
            });
        }

        // 4) VL Target — pin générique + véhicules adverses du formulaire — icône véhicule, rouge
        const vltList = document.getElementById('oi_carto_vltarget_list');
        if (vltList) {
            vltList.innerHTML = '';
            vltList.appendChild(this._pinButton('VL Target (générique)', OI_PIN_DEFS.vl_target.color,
                () => this._armPinPlacement({ kind: 'vl_target', label: this._customOr('VL Target') })));
            this._getAdversaryVehicles().forEach(name => {
                vltList.appendChild(this._pinButton(name, OI_PIN_DEFS.vl_target.color,
                    () => this._armPinPlacement({ kind: 'vl_target', label: name })));
            });
        }

        // 5) Rassemblement — pin générique — icône rassemblement
        const rasList = document.getElementById('oi_carto_rassemblement_list');
        if (rasList) {
            rasList.innerHTML = '';
            rasList.appendChild(this._pinButton('Rassemblement', OI_PIN_DEFS.rassemblement.color,
                () => this._armPinPlacement({ kind: 'rassemblement', label: this._customOr('Rassemblement') })));
        }
    },

    /** Libellé d'un pin membre : "TRI · Fonction" (ou juste le trigramme). */
    // oi_cartographie.js:701-705
    _memberLabel(btn: HTMLElement): string {
        const tri = btn.dataset.trigramme;
        const fonc = btn.dataset.fonction;
        // Adaptation de TYPAGE PUR (`tri` toujours défini en pratique : seuls
        // des boutons avec trigramme non vide atteignent cette méthode, filtré
        // en amont par `_renderPingLists`, oi_cartographie.js:636) — repli `?? ''`
        // jamais emprunté.
        return (fonc && fonc !== 'Sans') ? `${tri} · ${fonc}` : (tri ?? '');
    },

    /** Valeur du champ libellé personnalisé, sinon le libellé générique fourni. */
    // oi_cartographie.js:708-711
    _customOr(fallback: string): string {
        const input = document.getElementById('oi_carto_pin_label') as HTMLInputElement | null;
        const v = (input?.value || '').trim();
        return v || fallback;
    },

    // oi_cartographie.js:713-715
    _emptyMsg(txt: string): string {
        return `<p style="color:var(--text-muted); font-size:0.85em; margin:0;">${txt}</p>`;
    },

    // oi_cartographie.js:717-726
    _pinButton(text: string, color: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'add-btn';
        const darkText = ['#eab308', '#d4af37', '#22c55e', '#94a3b8', '#a1a1aa'].includes(color);
        b.style.cssText = `width:auto; padding:6px 10px; background:${color}; color:${darkText ? '#000' : '#fff'}; border:none;`;
        b.textContent = text;
        b.onclick = onClick;
        return b;
    },

    /** Un membre est-il déjà posé sur la carte ? (clé = trigramme). */
    // oi_cartographie.js:729-731
    _isMemberPlaced(this: OICartoInternal, tri: string): boolean {
        return this._loadPins().some(p => p.memberTri && p.memberTri === tri);
    },

    /**
     * Rend la liste des membres triée par Fonction (groupes), chaque membre placé
     * étant grisé. Un clic sur un membre grisé propose : Réinitialiser / Aller à.
     */
    // oi_cartographie.js:737-776
    _renderMemberList(this: OICartoInternal, container: HTMLElement, memberBtns: readonly HTMLElement[], kind: OiCartoPinKind): void {
        container.innerHTML = '';
        if (!memberBtns.length) {
            container.innerHTML = this._emptyMsg('Aucun membre PATRACDVR configuré.');
            return;
        }
        // Regroupement par fonction (tri alpha, "Sans" en dernier).
        const groups: Record<string, HTMLElement[]> = {};
        memberBtns.forEach(b => {
            const fonc = (b.dataset.fonction && b.dataset.fonction !== 'Sans') ? b.dataset.fonction : 'Autres';
            (groups[fonc] = groups[fonc] || []).push(b);
        });
        const keys = Object.keys(groups).sort((a, c) => {
            if (a === 'Autres') return 1; if (c === 'Autres') return -1;
            return a.localeCompare(c, 'fr');
        });
        keys.forEach(fonc => {
            const title = document.createElement('div');
            title.className = 'oi-carto-fn-group-title';
            // `groups[fonc]` est TOUJOURS un tableau non vide ici (`keys` vient de
            // `Object.keys(groups)` juste au-dessus, `noUncheckedIndexedAccess`) —
            // garde de typage pur, jamais empruntée en pratique (même principe que
            // `planmap/pins.ts`, cf. son en-tête).
            const list = groups[fonc] ?? [];
            const first = list[0];
            const ic = first ? oiIconForMember(first.dataset.fonction, first.dataset.cellule) : 'badge';
            title.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;">${ic}</span> ${fonc}`;
            container.appendChild(title);
            const row = document.createElement('div');
            row.className = 'oi-carto-ping-list';
            list.forEach(b => {
                const tri = b.dataset.trigramme ?? '';
                const fonction = b.dataset.fonction || '';
                const cellule = b.dataset.cellule || '';
                const label = this._memberLabel(b);
                row.appendChild(this._memberButton({
                    text: label, color: OI_PIN_DEFS.member.color, placed: this._isMemberPlaced(tri), tri,
                    onPlace: () => this._armPinPlacement({
                        kind, label, memberTri: tri, fonction,
                        icon: oiIconForMember(fonction, cellule),
                    }),
                }));
            });
            container.appendChild(row);
        });
    },

    /**
     * Bouton membre. Non placé → arme le placement. Placé → grisé ; un clic
     * déplie deux actions : Réinitialiser (retire le pin) ou Aller à la position.
     */
    // oi_cartographie.js:782-814
    _memberButton(this: OICartoInternal, { text, color, placed, tri, onPlace }: {
        text: string;
        color: string;
        placed: boolean;
        tri: string;
        onPlace: () => void;
    }): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:inline-flex; flex-direction:column; gap:4px;';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'add-btn' + (placed ? ' oi-carto-member-placed' : '');
        const darkText = ['#eab308', '#d4af37', '#22c55e', '#94a3b8', '#a1a1aa'].includes(color);
        b.style.cssText = `width:auto; padding:6px 10px; background:${color}; color:${darkText ? '#000' : '#fff'}; border:none;`;
        b.textContent = placed ? `✓ ${text}` : text;
        b.title = placed ? 'Déjà placé — cliquer pour les options' : 'Cliquer puis toucher la carte pour placer';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:none; gap:6px;';
        if (placed) {
            const reset = document.createElement('button');
            reset.type = 'button'; reset.className = 'add-btn';
            reset.style.cssText = 'width:auto; padding:5px 9px; background:rgba(239,68,68,0.18); color:#fca5a5; border:1px solid #ef4444; font-size:0.8em;';
            reset.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;">restart_alt</span> Réinitialiser';
            reset.onclick = (e) => { e.stopPropagation(); this._resetMember(tri); };
            const go = document.createElement('button');
            go.type = 'button'; go.className = 'add-btn';
            go.style.cssText = 'width:auto; padding:5px 9px; background:rgba(59,130,246,0.18); color:#93c5fd; border:1px solid #3b82f6; font-size:0.8em;';
            go.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;">my_location</span> Aller à';
            go.onclick = (e) => { e.stopPropagation(); this._goToMember(tri); };
            actions.appendChild(reset);
            actions.appendChild(go);
            b.onclick = () => { actions.style.display = actions.style.display === 'flex' ? 'none' : 'flex'; };
        } else {
            b.onclick = onPlace;
        }
        wrap.appendChild(b);
        wrap.appendChild(actions);
        return wrap;
    },

    /** Retire de la carte le(s) pin(s) d'un membre puis rafraîchit la modale. */
    // oi_cartographie.js:817-822
    _resetMember(this: OICartoInternal, tri: string): void {
        const pins = this._loadPins().filter(p => !(p.memberTri && p.memberTri === tri));
        this._savePins(pins);
        this._renderPins();
        this._renderPingLists();
    },

    /** Centre la carte sur le pin du membre (ferme la modale d'ajout). */
    // oi_cartographie.js:825-830
    _goToMember(this: OICartoInternal, tri: string): void {
        const pin = this._loadPins().find(p => p.memberTri && p.memberTri === tri);
        if (!pin) return;
        this._closePingModal();
        // Capture locale de `this.map` après sa garde de non-nullité : le
        // narrowing TS sur une propriété de `this` ne survit pas à l'appel de
        // méthode `getZoom()` qui suit (même principe que `planmap/pins.ts`,
        // cf. son en-tête).
        const map = this.map;
        if (map) map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 17), speed: 1.4 });
    },

    /** Véhicules créés dans le PATRACDVR (lignes .patracdvr-vehicle-row). */
    // oi_cartographie.js:833-837
    _getPatracdvrVehicles(): string[] {
        return Array.from(document.querySelectorAll<HTMLElement>('#patracdvr_container .patracdvr-vehicle-row'))
            .map(r => r.dataset.vehicleName)
            // oi_cartographie.js:836 — `.filter(Boolean)` dans l'original : adaptation
            // de TYPAGE PUR (aucun changement de logique), `dataset.vehicleName` est
            // `string | undefined` ; un prédicat de type explicite remplace le
            // filtre positionnel pour que le retour soit bien `string[]`.
            .filter((name): name is string => Boolean(name));
    },

    /** Véhicules adverses saisis dans le formulaire (champ Véhicules de chaque Adversaire). */
    // oi_cartographie.js:840-847
    _getAdversaryVehicles(): string[] {
        const vals: string[] = [];
        document.querySelectorAll<HTMLInputElement>('[id^="vehicules_"] .dynamic-input').forEach(inp => {
            const v = (inp.value || '').trim();
            if (v) vals.push(v);
        });
        return Array.from(new Set(vals));
    },

    // oi_cartographie.js:849-854
    _armPinPlacement(this: OICartoInternal, pending: OiCartoPendingPin): void {
        if (this.drawTool) this._setTool(null);
        this.pendingPin = pending;
        this._closePingModal();
        this._showHint(`Cliquez sur la carte pour placer « ${pending.label} »`);
    },

    // oi_cartographie.js:856-878
    _onMapClick(this: OICartoInternal, e: MapMouseEvent): void {
        // Un clic sur le fond ferme tout panneau flottant d'édition de pin.
        this._closeInlinePanel();
        if (this.drawTool) return; // pendant un dessin, les clics sont gérés ailleurs
        if (!this.pendingPin) return;
        const p = this.pendingPin;
        this._addPin({
            id: 'pin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            kind: p.kind,
            label: p.label,
            // Métadonnées membre + icône auto/personnalisée (placement OI).
            memberTri: p.memberTri || null,
            fonction: p.fonction || null,
            icon: p.icon || null,
            color: p.color || null,
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
        });
        this.pendingPin = null;
        this._hideHint();
        // Rafraîchit la modale d'ajout si encore ouverte (état "placé").
        this._renderPingLists();
    },

    // oi_cartographie.js:880-885
    _addPin(this: OICartoInternal, pin: OiCartoPin): void {
        const pins = this._loadPins().slice();
        pins.push(pin);
        this._savePins(pins);
        this._renderPins();
    },

    // oi_cartographie.js:887-891
    _removePin(this: OICartoInternal, id: string): void {
        const pins = this._loadPins().filter(p => p.id !== id);
        this._savePins(pins);
        this._renderPins();
    },

    // oi_cartographie.js:893-902
    _clearAllPins(this: OICartoInternal): void {
        if (!this._loadPins().length) {
            alert('Aucun pin à supprimer.');
            return;
        }
        if (!confirm('Supprimer tous les pins de la carte ?')) return;
        this._savePins([]);
        this._renderPins();
        this._closePingModal();
    },

    // oi_cartographie.js:904-985 — CŒUR du module.
    _renderPins(this: OICartoInternal): void {
        // Capture locale de `this.map` après sa garde de non-nullité : le
        // narrowing TS sur une propriété de `this` ne survit pas aux appels de
        // méthode qui suivent (même principe que `planmap/pins.ts`, cf. son
        // en-tête).
        const map = this.map;
        if (!map) return;
        for (const raw of this.markers.values()) {
            if (!isOiCartoMarkerEntry(raw)) continue;
            if (raw.pin) raw.pin.remove();
            if (raw.label) raw.label.remove();
        }
        this.markers.clear();

        for (const pin of this._loadPins()) {
            const def = OI_PIN_DEFS[pin.kind] || OI_PIN_FALLBACK;
            const color = pin.color || def.color;          // couleur personnalisée prioritaire
            const icon = pin.icon || def.icon;              // icône auto/personnalisée prioritaire
            const labelOffset: [number, number] = [0, 22];

            // --- 1) Marqueur = icône Material colorée, halo blanc, ancrée au centre ---
            const pinWrap = document.createElement('div');
            pinWrap.style.cssText = 'width:38px; height:38px; cursor:grab; display:flex; align-items:center; justify-content:center;';
            pinWrap.innerHTML = `
                <span class="material-symbols-outlined" style="
                    font-size: 38px; color: ${color}; line-height: 1;
                    text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 2px 4px rgba(0,0,0,0.6);
                    font-variation-settings: 'FILL' 1;">${icon}</span>`;

            const pinMarker = new maplibregl.Marker({ element: pinWrap, anchor: 'center', draggable: true })
                .setLngLat([pin.lng, pin.lat])
                .addTo(map);

            // --- 2) Marqueur libellé : trigramme + intitulé SOUS l'icône ---
            // Pour un membre : trigramme (gras) sur la 1re ligne, intitulé (fonction
            // ou texte personnalisé) sur la 2e. Sinon, libellé simple.
            const labelEl = document.createElement('div');
            labelEl.style.cssText = `
                padding: 3px 8px; background: rgba(0,0,0,0.82); color: #fff;
                font-size: 13px; font-weight: 500; line-height: 1.2; border-left: 4px solid ${color};
                border-radius: 3px; white-space: nowrap; text-align: center;
                box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 1px 4px rgba(0,0,0,0.75);
                pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.9); letter-spacing: 0.3px;`;
            if (pin.memberTri) {
                const sub = pin.text || (pin.fonction && pin.fonction !== 'Sans' ? pin.fonction : '');
                labelEl.innerHTML = `<div style="font-weight:700; font-size:13px;">${this._esc(pin.memberTri)}</div>` +
                    (sub ? `<div style="font-size:11px; opacity:0.85;">${this._esc(sub)}</div>` : '');
            } else {
                labelEl.textContent = pin.text || pin.label;
            }
            if (!this.labelsVisible) labelEl.style.display = 'none';
            const labelMarker = new maplibregl.Marker({ element: labelEl, anchor: 'top', offset: labelOffset })
                .setLngLat([pin.lng, pin.lat])
                .addTo(map);

            pinWrap.addEventListener('mouseenter', () => { pinWrap.style.zIndex = '1000'; labelEl.style.zIndex = '1000'; });
            pinWrap.addEventListener('mouseleave', () => { pinWrap.style.zIndex = ''; labelEl.style.zIndex = ''; });

            // --- Drag : pin + libellé se déplacent ensemble ---
            let lastDragEnd = 0;
            pinMarker.on('dragstart', this._safe(() => {
                pinWrap.style.cursor = 'grabbing';
                pinWrap.style.opacity = '0.85';
                labelEl.style.opacity = '0.5';
            }, 'pin:dragstart'));
            pinMarker.on('drag', this._safe(() => labelMarker.setLngLat(pinMarker.getLngLat()), 'pin:drag'));
            pinMarker.on('dragend', this._safe(() => {
                pinWrap.style.cursor = 'grab';
                pinWrap.style.opacity = '1';
                labelEl.style.opacity = '1';
                lastDragEnd = Date.now();
                const ll = pinMarker.getLngLat();
                labelMarker.setLngLat(ll);
                const allPins = this._loadPins().slice();
                const target = allPins.find(p => p.id === pin.id);
                if (target) { target.lng = ll.lng; target.lat = ll.lat; this._savePins(allPins); }
            }, 'pin:dragend'));

            // --- Tap (sans drag) → roue d'options portée (Icône / Couleur / Renommer / Aller à / Supprimer) ---
            pinWrap.addEventListener('click', this._safe((ev: MouseEvent) => {
                if (Date.now() - lastDragEnd < 300) return; // clic qui suit un drag : ignoré
                ev.stopPropagation();
                this._openPinWheel(pin.id);
            }, 'pin:click'));

            this.markers.set(pin.id, { pin: pinMarker, label: labelMarker });
        }
    },

    // oi_cartographie.js:987-991
    _esc(s: string | null | undefined): string {
        // oi_cartographie.js:988 — le littéral `{ '&':…, '<':…, … }` n'a que des
        // clés littérales (pas de signature d'index) : `c` (issu du replacer de
        // la regex) est un `string` non littéral, TS ne peut pas l'indexer sans
        // signature d'index explicite. Adaptation de TYPAGE PUR (aucun
        // changement de logique) : le littéral est typé `Record<string,
        // string>` ; le repli `?? c` n'est JAMAIS emprunté en pratique car la
        // regex ne capture que les 5 caractères présents dans le littéral.
        const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => map[c] ?? c);
    },
};
