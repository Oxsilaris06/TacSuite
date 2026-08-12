/**
 * pins.ts — PINS : modale de sélection, listes, placement, markers
 * (P3.CONV, paquet `oi-carto-pins`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 20 méthodes de la section « PINS — membres
 * PATRACDVR + pins OI dédiés » de `oi_cartographie.js` (GStart-main, lecture
 * seule, lignes 614-991) : `_openPingModal` (:618), `_closePingModal` (:627),
 * `_renderPingLists` (:633-700), `_memberLabel` (:701), `_customOr` (:708),
 * `_emptyMsg` (:713), `_pinButton` (:717), `_isMemberPlaced` (:729),
 * `_renderMemberList` (:737-781), `_memberButton` (:782), `_resetMember`
 * (:817), `_goToMember` (:825), `_getPatracdvrVehicles` (:833),
 * `_getAdversaryVehicles` (:840), `_armPinPlacement` (:849), `_onMapClick`
 * (:856), `_addPin` (:880), `_removePin` (:887), `_clearAllPins` (:893),
 * `_renderPins` (:904-986, CŒUR du module). Cf.
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
 * RÉCONCILIATION PAR SIGNATURE (mission R3-e, dernière tranche carto D1) :
 * `_renderPins` d'origine (oi_cartographie.js:904-985) recrée TOUS les
 * markers à chaque appel (`this.markers.clear()` + boucle de création) — jank
 * visuel + ré-attache de la machine `pin-gestures` (R3-d) sur CHAQUE pin à
 * CHAQUE rendu. Aligné sur le patron PC-Tac (`@pctac/planmap/pins.ts`,
 * `_pinSignature` :157-169, `_renderPins` :444-526, réconciliation par ID) :
 * signature légère par pin (position, kind, label, memberTri, fonction, icon,
 * color, text) comparée entre deux rendus ; marker inchangé → AUCUNE écriture
 * DOM ni ré-attache de gestes (même référence `Marker`/élément conservée) ;
 * marker modifié → position + contenu visuel mis à jour EN PLACE
 * (`applyPinVisual`, extraction verbatim de la construction DOM d'origine,
 * appelable à la création ET à la mise à jour — même principe que
 * `_buildPinVisual`, `planmap/pins.ts` :232-317) ; pin disparu → marker détruit
 * ET `gestures.detach()` (poignée renvoyée par `attachPinGestures`,
 * `@shared/pin-gestures.ts`, JAMAIS appelée côté PC-Tac — planmap/pins.ts:398-400
 * documente pourquoi, mais OI n'a pas cette garantie de GC : `pinWrap` est
 * retiré du DOM par `Marker.remove()` mais les listeners `attachPinGestures`
 * sont posés directement sur l'élément, donc `detach()` explicite avant
 * `remove()` reste la voie sûre pour ce port).
 * `_pinSignature`/`applyPinVisual` sont des fonctions locales au module (pas
 * des méthodes `OICartoInternal`) : usage interne exclusif à `_renderPins`,
 * aucune autre méthode carto n'en a besoin (contrairement à PC-Tac où
 * `_pinSignature`/`_buildPinVisual` sont des méthodes du contrat car
 * `planmap/pins.ts` suit le patron `this`-typé uniforme sur tout le fichier).
 * L'ordre d'affichage `labelsVisible` reste HORS signature : géré exclusivement
 * par `_toggleLabels` (panels.ts, hors périmètre de ce paquet), qui bascule
 * `display` directement sur les markers existants — l'inclure forcerait une
 * mise à jour DOM de tous les pins à chaque bascule, contre l'objectif
 * anti-jank de cette mission.
 *
 * Les `innerHTML` (:648, 670, 682, 694, 738, 740, 757, 798, 803, 921, 943)
 * sont portés VERBATIM avec leur échappement d'origine (`_esc` d'origine,
 * remplacé par `esc` de `@shared/ui-platform.js` — doublon, même
 * implémentation, cf. `@pctac/planmap/constants.ts:13` — appelé seulement aux
 * sites où l'original l'appelle, :943-944) — rien d'autre n'est ajouté.
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
 *   - `#oi_carto_ping_modal` (dialog) / `#oi_carto_pin_label` (input) :
 *     `document.getElementById` renvoie `HTMLElement | null` en TS strict ;
 *     casts `as HTMLDialogElement | null` / `as HTMLInputElement | null`
 *     (éléments STATIQUES de `oi/index.html`, jamais recréés).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 */

import maplibregl from 'maplibre-gl';
import type { MapMouseEvent, MapTouchEvent, Marker, PointLike } from 'maplibre-gl';

import { confirmDialog, toast } from '@shared/feedback.js';
import { attachPinGestures, createDblZoomSuppressor } from '@shared/pin-gestures.js';
import type { PinGestureHandle } from '@shared/pin-gestures.js';
import { esc } from '@shared/ui-platform.js';

import { OI_PIN_DEFS, OI_PIN_FALLBACK, oiIconForMember } from './constants.js';
import type { LngLatObj, OICartoInternal, OiCartoPendingPin, OiCartoPin, OiCartoPinKind } from './types.js';
import { OIWheel } from './wheel.js';

/**
 * Forme du couple de markers stocké sous chaque id de `this.markers`
 * (oi_cartographie.js:275, commentaire d'origine « id -> { pin: Marker, label:
 * Marker } »). `OICartoContract.markers` (contracts.ts, contrat figé) est
 * typé `Map<string, unknown>` : ce garde de type reconstitue la forme réelle
 * à la lecture, sans `any` ni assertion non vérifiée.
 *
 * `pinWrap`/`labelEl`/`gestures`/`sig` sont AJOUTÉS par la mission R3-e
 * (réconciliation par signature, cf. en-tête de fichier) — absents du
 * commentaire d'origine `{ pin, label }`, nécessaires pour mettre à jour un
 * marker EN PLACE (élément DOM direct, sans repasser par `Marker.getElement()`)
 * et pour détacher proprement la machine `pin-gestures` à la suppression.
 */
interface OiCartoMarkerEntry {
    pin: Marker;
    label: Marker;
    pinWrap: HTMLDivElement;
    labelEl: HTMLDivElement;
    gestures: PinGestureHandle;
    sig: string;
}

function isOiCartoMarkerEntry(x: unknown): x is OiCartoMarkerEntry {
    return typeof x === 'object' && x !== null && 'pin' in x && 'label' in x;
}

/**
 * Signature légère d'un pin : tout ce qui change son rendu visuel (icône,
 * couleur, libellé) ou sa position. Si elle est identique entre deux rendus,
 * `_renderPins` ne touche PAS au DOM du marker correspondant (zéro jank, zéro
 * ré-attache de gestes) — même principe que `_pinSignature` (PC-Tac,
 * `planmap/pins.ts` :157-169), cf. en-tête de fichier pour le détail du
 * périmètre porté. `labelsVisible` est délibérément HORS signature (idem).
 */
function pinSignature(pin: OiCartoPin): string {
    return [
        pin.lng, pin.lat, pin.kind, pin.label,
        pin.memberTri || '', pin.fonction || '', pin.icon || '', pin.color || '',
        pin.text || '',
        pin.locked ? 1 : 0, // verrou : change draggable/cursor (parité PC-Tac)
    ].join('|');
}

/**
 * Construit/actualise le contenu visuel (icône colorée + libellé) d'un pin
 * SUR SES ÉLÉMENTS DOM DÉJÀ POSÉS — jamais de recréation. Extraction VERBATIM
 * des écritures DOM de la boucle de rendu d'origine (oi_cartographie.js:919-946)
 * pour être appelable à la fois à la CRÉATION et à la MISE À JOUR EN PLACE
 * (mission R3-e) — même principe que `_buildPinVisual` (PC-Tac,
 * `planmap/pins.ts` :232-317). Ne touche PAS `labelEl.style.display`
 * (`labelsVisible`, géré exclusivement par `_toggleLabels`, panels.ts, hors
 * signature — cf. en-tête de fichier).
 */
function applyPinVisual(pinWrap: HTMLDivElement, labelEl: HTMLDivElement, pin: OiCartoPin): void {
    const def = OI_PIN_DEFS[pin.kind] || OI_PIN_FALLBACK;
    const color = pin.color || def.color;   // couleur personnalisée prioritaire
    const icon = pin.icon || def.icon;       // icône auto/personnalisée prioritaire

    // --- 1) Marqueur = icône Material colorée, halo blanc, ancrée au centre --- (oi_cartographie.js:919-925)
    pinWrap.innerHTML = `
        <span class="material-symbols-outlined" style="
            font-size: 38px; color: ${color}; line-height: 1;
            text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 2px 4px rgba(0,0,0,0.6);
            font-variation-settings: 'FILL' 1;">${icon}</span>`;

    // --- 2) Marqueur libellé : trigramme + intitulé SOUS l'icône --- (oi_cartographie.js:934-946)
    // Pour un membre : trigramme (gras) sur la 1re ligne, intitulé (fonction
    // ou texte personnalisé) sur la 2e. Sinon, libellé simple.
    labelEl.style.cssText = `
        padding: 3px 8px; background: rgba(0,0,0,0.82); color: #fff;
        font-size: 13px; font-weight: 500; line-height: 1.2; border-left: 4px solid ${color};
        border-radius: 3px; white-space: nowrap; text-align: center;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 1px 4px rgba(0,0,0,0.75);
        pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.9); letter-spacing: 0.3px;`;
    if (pin.memberTri) {
        const sub = pin.text || (pin.fonction && pin.fonction !== 'Sans' ? pin.fonction : '');
        labelEl.innerHTML = `<div style="font-weight:700; font-size:13px;">${esc(pin.memberTri)}</div>` +
            (sub ? `<div style="font-size:11px; opacity:0.85;">${esc(sub)}</div>` : '');
    } else {
        labelEl.textContent = pin.text || pin.label;
    }
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
            reset.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;" aria-hidden="true">restart_alt</span> Réinitialiser';
            reset.onclick = (e) => { e.stopPropagation(); this._resetMember(tri); };
            const go = document.createElement('button');
            go.type = 'button'; go.className = 'add-btn';
            go.style.cssText = 'width:auto; padding:5px 9px; background:rgba(59,130,246,0.18); color:#93c5fd; border:1px solid #3b82f6; font-size:0.8em;';
            go.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px; vertical-align:middle;" aria-hidden="true">my_location</span> Aller à';
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

    // oi_cartographie.js:856-878 + roue de création au clic (parité PC-Tac)
    _onMapClick(this: OICartoInternal, e: MapMouseEvent): void {
        // Un clic sur le fond ferme tout panneau flottant d'édition de pin —
        // et ce clic de fermeture n'ouvre PAS de roue de création dans la foulée.
        const hadPanel = !!this._inlinePanel;
        this._closeInlinePanel();
        if (this.drawTool) return; // pendant un dessin, les clics sont gérés ailleurs
        if (this.pendingPin) {
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
            return;
        }
        // --- Nouvelle ergonomie (parité PC-Tac) : clic sur zone vide → roue
        // de création de pin aux coordonnées cliquées. ---
        if (hadPanel) return;
        if (this._activeWheel) return; // la roue gère elle-même sa fermeture
        // Le clic qui vient de FERMER une roue (clic extérieur) ne rouvre rien.
        if (this._wheelJustClosed && Date.now() - this._wheelJustClosed < 400) return;
        // Clic issu d'un marker / d'une roue / d'un panneau : géré par eux.
        const target = e.originalEvent?.target;
        if (target instanceof Element
            && target.closest('.maplibregl-marker, .oi-wheel, .oi-carto-inline-panel')) return;
        this._openCreatePinWheel(e.lngLat);
    },

    /**
     * Roue de CRÉATION d'un pin au point cliqué (parité PC-Tac
     * `_openCreatePingWheel`) : segments de pose directe pour les pins métier
     * OI génériques (cyno / rame VL / VL target / rassemblement), panneaux
     * inline pour les membres PATRACDVR et les véhicules nommés, re-pose
     * rapide du dernier type utilisé, copie de coordonnées.
     */
    _openCreatePinWheel(this: OICartoInternal, lngLat: LngLatObj): void {
        this._closeWheel();
        this._closeInlinePanel();
        const quick = (pending: OiCartoPendingPin) => () => this._quickPlacePing(lngLat, pending);
        const opts: Array<{ id?: string; icon: string; label: string; bg?: string; color?: string; action?: () => void }> = [];
        // Re-pose du dernier type utilisé (quick-place, parité PC-Tac).
        const last = this.lastQuickPin;
        if (last) {
            opts.push({
                id: 'last',
                icon: last.icon || OI_PIN_DEFS[last.kind].icon,
                label: `↻ ${last.label}`,
                bg: 'rgba(59,130,246,0.95)',
                action: quick(last),
            });
        }
        opts.push({ id: 'member', icon: 'badge', label: 'Membre', bg: OI_PIN_DEFS.member.color, action: () => this._openMemberPickerPanel(lngLat) });
        opts.push({ id: 'cyno', icon: OI_PIN_DEFS.cyno.icon, label: 'Cyno', bg: OI_PIN_DEFS.cyno.color, action: quick({ kind: 'cyno', label: 'Cyno' }) });
        opts.push({ id: 'rame_vl', icon: OI_PIN_DEFS.rame_vl.icon, label: 'Rame VL', bg: OI_PIN_DEFS.rame_vl.color, action: quick({ kind: 'rame_vl', label: 'Rame VL' }) });
        opts.push({ id: 'vl_target', icon: OI_PIN_DEFS.vl_target.icon, label: 'VL Target', bg: OI_PIN_DEFS.vl_target.color, action: quick({ kind: 'vl_target', label: 'VL Target' }) });
        opts.push({ id: 'rassemblement', icon: OI_PIN_DEFS.rassemblement.icon, label: 'Rassemblement', bg: OI_PIN_DEFS.rassemblement.color, action: quick({ kind: 'rassemblement', label: 'Rassemblement' }) });
        // Véhicules nommés (PATRACDVR + adverses) : panneau, seulement s'il y en a.
        if (this._getPatracdvrVehicles().length || this._getAdversaryVehicles().length) {
            opts.push({ id: 'vehicles', icon: 'garage', label: 'Véhicules', bg: '#475569', action: () => this._openVehiclePickerPanel(lngLat) });
        }
        opts.push({ id: 'copycoords', icon: 'my_location', label: 'Copier coords', bg: 'rgba(15,118,110,0.95)', action: () => this._copyCoords(lngLat.lng, lngLat.lat) });

        this._activeWheel = new OIWheel({
            ...(this.map ? { map: this.map } : {}),
            lngLat,
            title: 'Nouveau point',
            options: opts,
            onClose: () => { this._activeWheel = null; this._wheelJustClosed = Date.now(); },
        });
        this._activeWheel.open();
    },

    /**
     * Pose directe d'un pin (parité PC-Tac `_quickPlacePing`), mémorise le
     * type pour la re-pose rapide, puis ouvre la roue d'options du pin posé
     * pour ajustements immédiats.
     */
    _quickPlacePing(this: OICartoInternal, lngLat: LngLatObj, pending: OiCartoPendingPin): void {
        const id = 'pin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        this._addPin({
            id,
            kind: pending.kind,
            label: pending.label,
            memberTri: pending.memberTri || null,
            fonction: pending.fonction || null,
            icon: pending.icon || null,
            color: pending.color || null,
            lng: lngLat.lng,
            lat: lngLat.lat,
        });
        this.lastQuickPin = pending;
        // Rafraîchit la modale d'ajout (dormante) si encore ouverte (état "placé").
        this._renderPingLists();
        // Roue d'édition ouverte dans la foulée (parité PC-Tac, délai 80 ms).
        setTimeout(() => this._openPinWheel(id), 80);
    },

    /**
     * Panneau inline « Placer un membre » : membres PATRACDVR (fonction Cyno
     * incluse → kind `cyno`), posés directement au point de la roue. Un membre
     * déjà placé est grisé (repose possible — le retrait passe par la roue du
     * pin ou la modale dormante).
     */
    _openMemberPickerPanel(this: OICartoInternal, lngLat: LngLatObj): void {
        this._closeWheel();
        const members = Array.from(document.querySelectorAll<HTMLElement>('.patracdvr-member-btn'))
            .filter(b => b.dataset.trigramme && b.dataset.trigramme !== 'N/A');
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#60a5fa;">badge</span>
                <strong style="font-size:13px;">Placer un membre</strong>
            </div>
            <div class="oi-carto-ping-list" style="display:flex; flex-wrap:wrap; gap:6px; max-height:230px; overflow-y:auto;"></div>`;
        this._openInlinePanel(lngLat, html, (panel) => {
            const listEl = panel.querySelector<HTMLDivElement>('.oi-carto-ping-list');
            if (!listEl) return;
            if (!members.length) {
                listEl.innerHTML = this._emptyMsg('Aucun membre PATRACDVR configuré.');
                return;
            }
            members.forEach(b => {
                const tri = b.dataset.trigramme ?? '';
                const fonction = b.dataset.fonction || '';
                const kind: OiCartoPinKind = fonction === 'Cyno' ? 'cyno' : 'member';
                const label = this._memberLabel(b);
                const btn = this._pinButton(label, OI_PIN_DEFS[kind].color, () => {
                    this._closeInlinePanel();
                    this._quickPlacePing(lngLat, {
                        kind, label, memberTri: tri, fonction,
                        icon: oiIconForMember(fonction, b.dataset.cellule),
                    });
                });
                if (this._isMemberPlaced(tri)) {
                    btn.classList.add('oi-carto-member-placed');
                    btn.textContent = `✓ ${label}`;
                    btn.title = 'Déjà placé';
                }
                listEl.appendChild(btn);
            });
        });
    },

    /** Panneau inline « Véhicules » : rames VL du PATRACDVR + véhicules adverses. */
    _openVehiclePickerPanel(this: OICartoInternal, lngLat: LngLatObj): void {
        this._closeWheel();
        const html = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-symbols-outlined" style="font-size:18px; color:#60a5fa;">garage</span>
                <strong style="font-size:13px;">Placer un véhicule</strong>
            </div>
            <div class="oi-carto-ping-list" style="display:flex; flex-wrap:wrap; gap:6px; max-height:230px; overflow-y:auto;"></div>`;
        this._openInlinePanel(lngLat, html, (panel) => {
            const listEl = panel.querySelector<HTMLDivElement>('.oi-carto-ping-list');
            if (!listEl) return;
            const place = (kind: OiCartoPinKind, label: string) => () => {
                this._closeInlinePanel();
                this._quickPlacePing(lngLat, { kind, label });
            };
            this._getPatracdvrVehicles().forEach(name => {
                listEl.appendChild(this._pinButton(name, OI_PIN_DEFS.rame_vl.color, place('rame_vl', name)));
            });
            this._getAdversaryVehicles().forEach(name => {
                listEl.appendChild(this._pinButton(name, OI_PIN_DEFS.vl_target.color, place('vl_target', name)));
            });
            if (!listEl.childElementCount) {
                listEl.innerHTML = this._emptyMsg('Aucun véhicule saisi dans le formulaire.');
            }
        });
    },

    /**
     * Détecteur d'appui long façon Google Maps (port de PC-Tac
     * `_wireLongPressForPing`, draw-layers.ts:398) : 480 ms d'appui immobile
     * sur zone vide ouvre la roue de création. Annulé au moindre mouvement
     * (pan), au relâchement, ou si l'appui démarre sur un marker/une forme.
     * Feedback visuel : anneau animé pendant le décompte.
     */
    _wireLongPressForPing(this: OICartoInternal): void {
        if (this._longPressWired) return;
        const map = this.map;
        if (!map) return;
        this._longPressWired = true;

        const LP_DELAY = 480; // ms
        const LP_TOLERANCE = 8; // px de tolérance
        let lp: {
            startPx: { x: number; y: number };
            startLngLat: LngLatObj;
            ringEl: HTMLDivElement;
            timer: ReturnType<typeof setTimeout>;
        } | null = null;

        const cancel = (): void => {
            if (!lp) return;
            clearTimeout(lp.timer);
            try { lp.ringEl.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
            lp = null;
        };
        const isOnFeature = (point: PointLike): boolean => {
            try {
                return map.queryRenderedFeatures(point, {
                    layers: ['oi-carto-shapes-fill', 'oi-carto-shapes-line'],
                }).length > 0;
            } catch { return false; } // couches pas encore posées (avant _initDrawingLayers)
        };
        const showRing = (clientX: number, clientY: number): HTMLDivElement => {
            const ring = document.createElement('div');
            ring.style.cssText = `
                position: fixed; left: ${clientX}px; top: ${clientY}px;
                width: 12px; height: 12px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                border: 3px solid #3b82f6;
                box-shadow: 0 0 0 0 rgba(59,130,246,0.6);
                pointer-events: none;
                z-index: 9999;
                animation: oiCartoLpRing ${LP_DELAY}ms linear forwards;
            `;
            document.body.appendChild(ring);
            return ring;
        };
        // Keyframe injecté une fois
        if (!document.getElementById('oi-carto-lp-ring-style')) {
            const s = document.createElement('style');
            s.id = 'oi-carto-lp-ring-style';
            s.textContent = `@keyframes oiCartoLpRing {
                0%   { width: 12px; height: 12px; opacity: 0.4; }
                100% { width: 56px; height: 56px; opacity: 0.95; box-shadow: 0 0 12px 6px rgba(59,130,246,0.45); }
            }`;
            document.head.appendChild(s);
        }

        const start = (e: MapMouseEvent | MapTouchEvent): void => {
            if (this.drawTool || this.pendingPin) return;
            if (this._activeWheel || this._inlinePanel) return;
            const oe = e.originalEvent;
            // Multi-touch (pinch zoom etc.) → on annule le long-press
            if (oe && 'touches' in oe && oe.touches.length > 1) { cancel(); return; }
            if (lp) cancel(); // ne pas empiler
            // Appui démarré sur un marker / la roue / un panneau : géré par eux.
            const target = oe && oe.target instanceof Element ? oe.target : null;
            if (target && target.closest('.maplibregl-marker, .oi-wheel, .oi-carto-inline-panel')) return;
            if (isOnFeature(e.point)) return; // forme → priorité au gestionnaire de forme
            const touch = oe && 'touches' in oe ? oe.touches[0] : undefined;
            const clientX = touch ? touch.clientX : (oe && 'clientX' in oe && oe.clientX) || 0;
            const clientY = touch ? touch.clientY : (oe && 'clientY' in oe && oe.clientY) || 0;
            lp = {
                startPx: { x: e.point.x, y: e.point.y },
                startLngLat: e.lngLat,
                ringEl: showRing(clientX, clientY),
                timer: setTimeout(() => {
                    if (!lp) return;
                    const ll = lp.startLngLat;
                    cancel();
                    this._openCreatePinWheel(ll);
                }, LP_DELAY),
            };
        };
        const move = (e: MapMouseEvent | MapTouchEvent): void => {
            if (!lp) return;
            const dx = e.point.x - lp.startPx.x, dy = e.point.y - lp.startPx.y;
            if (Math.hypot(dx, dy) > LP_TOLERANCE) cancel();
        };

        map.on('mousedown', this._safe(start, 'longpress:start'));
        map.on('touchstart', this._safe(start, 'longpress:start'));
        map.on('mousemove', this._safe(move, 'longpress:move'));
        map.on('touchmove', this._safe(move, 'longpress:move'));
        map.on('mouseup', this._safe(cancel, 'longpress:cancel'));
        map.on('touchend', this._safe(cancel, 'longpress:cancel'));
        map.on('touchcancel', this._safe(cancel, 'longpress:cancel'));
        map.on('dragstart', this._safe(cancel, 'longpress:cancel'));
        map.on('movestart', this._safe(cancel, 'longpress:cancel'));
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
    // R2-T2b : signature élargie en `Promise<void>` (`confirmDialog` async) — compatible
    // avec le contrat `_clearAllPins(): void` (règle « void » TS, cf. en-tête OI R2-T2b).
    async _clearAllPins(this: OICartoInternal): Promise<void> {
        if (!this._loadPins().length) {
            toast('Aucun pin à supprimer.', { kind: 'error' });
            return;
        }
        // Pas d'historique undo pour les pins (contrairement aux dessins, cf. draw.ts) :
        // suppression irréversible ⇒ confirmation conservée (danger).
        const confirmed = await confirmDialog({
            message: 'Supprimer tous les pins de la carte ?',
            confirmLabel: 'Supprimer',
            danger: true,
        });
        if (!confirmed) return;
        this._savePins([]);
        this._renderPins();
        this._closePingModal();
    },

    // oi_cartographie.js:904-985 — CŒUR du module.
    // RÉCONCILIATION PAR SIGNATURE (mission R3-e) : cf. en-tête de fichier pour
    // le détail — patron porté de `_renderPins` (PC-Tac, `planmap/pins.ts`
    // :444-526). Le corps de création reste VERBATIM (mêmes écritures DOM,
    // même construction de marker) ; seule l'orchestration change (par-id,
    // pas de `clear()` global).
    _renderPins(this: OICartoInternal): void {
        // Capture locale de `this.map` après sa garde de non-nullité : le
        // narrowing TS sur une propriété de `this` ne survit pas aux appels de
        // méthode qui suivent (même principe que `planmap/pins.ts`, cf. son
        // en-tête).
        const map = this.map;
        if (!map) return;

        // Suppression du zoom double-clic natif partagée par tous les pins de
        // cette passe de rendu (timer annulable, cf. `createDblZoomSuppressor`
        // — remplace l'ancien `setTimeout(450)` inline sans annulation).
        const dblZoomSuppressor = createDblZoomSuppressor(() => map.doubleClickZoom);

        const pins = this._loadPins();
        const seen = new Set<string>();

        for (const pin of pins) {
            seen.add(pin.id);
            const sig = pinSignature(pin);
            const raw = this.markers.get(pin.id);
            const entry = isOiCartoMarkerEntry(raw) ? raw : undefined;

            if (!entry) {
                // --- CRÉATION (une seule fois par id) ---
                const labelOffset: [number, number] = [0, 22];

                const pinWrap = document.createElement('div');
                pinWrap.style.cssText = 'min-width:44px; min-height:44px; width:44px; height:44px; cursor:grab; display:flex; align-items:center; justify-content:center; touch-action:none;';
                const labelEl = document.createElement('div');
                applyPinVisual(pinWrap, labelEl, pin);
                pinWrap.style.cursor = pin.locked ? 'pointer' : 'grab';
                if (!this.labelsVisible) labelEl.style.display = 'none';

                // Verrou : un pin verrouillé n'est pas déplaçable (parité PC-Tac,
                // `draggable: !pin.locked` — le tap simple reste actif pour la roue).
                const pinMarker = new maplibregl.Marker({ element: pinWrap, anchor: 'center', draggable: !pin.locked })
                    .setLngLat([pin.lng, pin.lat])
                    .addTo(map);
                const labelMarker = new maplibregl.Marker({ element: labelEl, anchor: 'top', offset: labelOffset })
                    .setLngLat([pin.lng, pin.lat])
                    .addTo(map);

                pinWrap.addEventListener('mouseenter', () => { pinWrap.style.zIndex = '1000'; labelEl.style.zIndex = '1000'; });
                pinWrap.addEventListener('mouseleave', () => { pinWrap.style.zIndex = ''; labelEl.style.zIndex = ''; });

                // --- Drag : pin + libellé se déplacent ensemble ---
                // Listeners attachés UNE SEULE FOIS (mission R3-e) — plus
                // jamais ré-attachés tant que ce pin n'est pas supprimé.
                const gestures = attachPinGestures(pinWrap, {
                    suppressDblZoom: () => dblZoomSuppressor.suppress(),
                    onGestureStart: () => {
                        pinWrap.style.zIndex = '1000';
                        labelEl.style.zIndex = '1000';
                    },
                    onGestureEnd: () => {
                        pinWrap.style.zIndex = '';
                        labelEl.style.zIndex = '';
                    },
                    // OI : le tap SIMPLE ouvre la roue (comportement UX conservé,
                    // cf. mission R3-d) — pas de fenêtre de double-tap (`onDoubleTap`
                    // omis) : machine robuste pointer/touch au lieu du `click` DOM
                    // (chemin abandonné côté PC-Tac, cf. en-tête de `pin-gestures.ts`).
                    onSingleTap: () => {
                        this._openPinWheel(pin.id);
                    },
                }, {
                    safe: (fn, label) => this._safe(fn, label),
                    dragAntiBounceMs: 300,
                });

                pinMarker.on('dragstart', this._safe(() => {
                    gestures.notifyDragStart();
                    pinWrap.style.cursor = 'grabbing';
                    pinWrap.style.opacity = '0.85';
                    labelEl.style.opacity = '0.5';
                }, 'pin:dragstart'));
                pinMarker.on('drag', this._safe(() => labelMarker.setLngLat(pinMarker.getLngLat()), 'pin:drag'));
                pinMarker.on('dragend', this._safe(() => {
                    gestures.notifyDragEnd();
                    pinWrap.style.cursor = 'grab';
                    pinWrap.style.opacity = '1';
                    labelEl.style.opacity = '1';
                    const ll = pinMarker.getLngLat();
                    labelMarker.setLngLat(ll);
                    const allPins = this._loadPins().slice();
                    const target = allPins.find(p => p.id === pin.id);
                    if (target) { target.lng = ll.lng; target.lat = ll.lat; this._savePins(allPins); }
                }, 'pin:dragend'));

                this.markers.set(pin.id, { pin: pinMarker, label: labelMarker, pinWrap, labelEl, gestures, sig });
            } else if (entry.sig !== sig) {
                // --- MISE À JOUR EN PLACE (position + contenu visuel + verrou) ---
                entry.pin.setLngLat([pin.lng, pin.lat]);
                entry.label.setLngLat([pin.lng, pin.lat]);
                applyPinVisual(entry.pinWrap, entry.labelEl, pin);
                entry.pin.setDraggable(!pin.locked); // verrou (parité PC-Tac)
                entry.pinWrap.style.cursor = pin.locked ? 'pointer' : 'grab';
                entry.sig = sig;
            }
            // else : signature identique → AUCUNE écriture DOM (zéro jank).
        }

        // --- SUPPRESSION des ids disparus uniquement ---
        for (const [id, raw] of this.markers) {
            if (seen.has(id)) continue;
            if (isOiCartoMarkerEntry(raw)) {
                // Détache la machine `pin-gestures` AVANT de retirer les
                // markers du DOM (mission R3-e — cf. en-tête de fichier pour
                // le raisonnement anti-fuite mémoire).
                try { raw.gestures.detach(); } catch { /* écouteurs déjà retirés — sans effet */ }
                try { raw.pin.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
                try { raw.label.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
            }
            this.markers.delete(id);
        }
    },
};
