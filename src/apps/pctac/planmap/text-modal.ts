/**
 * text-modal.ts — Modale `#planTextModal` + reparentage plein écran (P2.CONV, paquet `pm-textmodal`).
 * =====================================================================================================
 *
 * 7 méthodes de `planMap.js:4546 → 4719` (cf. `docs/SPEC-PLANMAP-SPLIT.md` §4.14) :
 *   - `_openTextModal`             (:4546) — ouvre la modale d'édition de texte
 *   - `_mountModalInFullscreen`    (:4583) — reparente modal+backdrop dans l'élément fullscreen
 *   - `_restoreModalFromFullscreen`(:4597) — restaure modal+backdrop à leur emplacement d'origine
 *   - `_hideTextModal`             (:4607) — ferme la modale (purge la forme fantôme si texte vide)
 *   - `_confirmTextModal`          (:4629) — applique la saisie sur la forme cible
 *   - `_bindTextModalOnce`         (:4670) — câble les listeners (idempotent via `_textModalBound`)
 *   - `_addFreeText`               (:4705) — place une nouvelle forme `text` libre
 *
 * Cœur du module : le reparentage plein écran mémorise SIX références dans
 * `this._modalReparent` (modal, backdrop, modalParent, modalNext, bdParent,
 * bdNext) — `_restoreModalFromFullscreen` les réinsère via `insertBefore(node,
 * next)`. Perdre `modalNext`/`bdNext` ferait réapparaître la modale au mauvais
 * endroit du DOM après la sortie du plein écran.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule). Port VERBATIM (typage uniquement, cf. §8.3 SPEC-PCTAC-CONVERSION.md).
 */

import type { LngLatObj, PlanMapInternal } from './types.js';

export const TextModalMethods = {
    /**
     * Ouvre la modale d'édition de texte pour la forme `targetId`.
     * Si `targetId` correspond à une forme `text` existante, on l'édite.
     * Sinon, on ajoute / modifie l'annotation `text` d'une forme dessinée.
     */
    // planMap.js:4546
    _openTextModal(this: PlanMapInternal, targetId: string): void {
        this._bindTextModalOnce(); // défensif : assure que les listeners sont en place
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (!modal || !backdrop) return;
        const target = this._loadShapes().find((s) => s.id === targetId);
        const input = document.getElementById('plan_text_input') as HTMLInputElement | null;
        const idHidden = document.getElementById('plan_text_target_id') as HTMLInputElement | null;
        const colorVal = document.getElementById('plan_text_color_val') as HTMLInputElement | null;
        const sizeVal = document.getElementById('plan_text_size_input') as HTMLInputElement | null;
        const sizeDisp = document.getElementById('plan_text_size_val');
        const titleEl = document.getElementById('planTextModalTitle');
        if (titleEl) titleEl.textContent = target?.type === 'text' ? 'Texte libre' : 'Annoter le dessin';
        if (idHidden) idHidden.value = targetId;
        if (input) input.value = target?.text || '';
        const col = target?.textColor || target?.color || '#ffffff';
        if (colorVal) colorVal.value = col;
        const sz = Math.max(9, Math.min(72, target?.fontSize || 13));
        if (sizeVal) sizeVal.value = String(sz);
        if (sizeDisp) sizeDisp.textContent = String(sz);
        document.querySelectorAll<HTMLElement>('#plan_text_color_palette .plan-text-color').forEach((b) => {
            b.style.borderColor = (b.dataset.color === col) ? '#fff' : 'transparent';
        });
        // En plein écran, le modal (enfant de <body>) n'est pas rendu : seul le
        // sous-arbre de l'élément fullscreen l'est. On le déplace donc dans cet
        // élément le temps de l'édition, puis on le restaure à la fermeture.
        this._mountModalInFullscreen(modal, backdrop);
        backdrop.style.display = 'block';
        modal.style.display = 'block';
        setTimeout(() => input && input.focus(), 50);
    },

    /**
     * Si un élément est en plein écran et que le modal n'en fait pas partie,
     * on réinsère modal + backdrop dans l'élément fullscreen (sinon invisibles).
     * Mémorise l'emplacement d'origine pour pouvoir restaurer.
     */
    // planMap.js:4583
    _mountModalInFullscreen(this: PlanMapInternal, modal: HTMLElement, backdrop: HTMLElement | null): void {
        // `webkitFullscreenElement` : vendor-prefix absent du lib DOM standard TS (planMap.js:4584).
        const fsEl = document.fullscreenElement || (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
        if (!fsEl || !modal) return;
        if (fsEl.contains(modal)) return; // déjà dedans
        this._modalReparent = {
            modal, backdrop,
            modalParent: modal.parentNode, modalNext: modal.nextSibling,
            bdParent: backdrop ? backdrop.parentNode : null, bdNext: backdrop ? backdrop.nextSibling : null,
        };
        if (backdrop) fsEl.appendChild(backdrop);
        fsEl.appendChild(modal);
    },

    /** Restaure modal + backdrop à leur emplacement d'origine (post-plein écran). */
    // planMap.js:4597
    _restoreModalFromFullscreen(this: PlanMapInternal): void {
        const r = this._modalReparent;
        if (!r) return;
        try {
            if (r.modalParent) r.modalParent.insertBefore(r.modal, r.modalNext);
            if (r.bdParent && r.backdrop) r.bdParent.insertBefore(r.backdrop, r.bdNext);
        } catch {
            // MapLibre/DOM peut jeter selon l'état du document — catch vide intentionnel (planMap.js:4603).
        }
        this._modalReparent = null;
    },

    // planMap.js:4607
    _hideTextModal(this: PlanMapInternal): void {
        // Si l'utilisateur ferme la modale d'un texte libre vide jamais validé,
        // on retire la forme fantôme du store (évite les invisibles persistants).
        const id = (document.getElementById('plan_text_target_id') as HTMLInputElement | null)?.value;
        if (id) {
            const list = this._loadShapes();
            const idx = list.findIndex((s) => s.id === id);
            const shape = idx !== -1 ? list[idx] : undefined;
            // Garde de typage (noUncheckedIndexedAccess) : idx !== -1 garantit `shape`
            // défini, branche `!shape` inatteignable — neutre en observable, cf.
            // SPEC-PLANMAP-SPLIT.md §6.3.
            if (shape && shape.type === 'text' && !shape.text) {
                list.splice(idx, 1);
                this._saveShapes(list);
                if (this._selectedShapeId === id) this._deselectShape();
                this._renderShapes();
            }
        }
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        this._restoreModalFromFullscreen();
    },

    /** Confirme la saisie de texte : applique sur la forme cible. */
    // planMap.js:4629
    _confirmTextModal(this: PlanMapInternal): void {
        const id = (document.getElementById('plan_text_target_id') as HTMLInputElement | null)?.value;
        const text = ((document.getElementById('plan_text_input') as HTMLInputElement | null)?.value || '').trim();
        const color = (document.getElementById('plan_text_color_val') as HTMLInputElement | null)?.value || '#ffffff';
        // String(...) reproduit la coercion native de `parseInt(undefined, 10)` (ToString → "undefined" → NaN).
        const size = parseInt(String((document.getElementById('plan_text_size_input') as HTMLInputElement | null)?.value), 10) || 13;
        if (!id) return this._hideTextModal();
        const list = this._loadShapes();
        const idx = list.findIndex((s) => s.id === id);
        if (idx === -1) return this._hideTextModal();
        this._pushHistory();
        const shape = list[idx];
        // Garde de typage (noUncheckedIndexedAccess) : idx !== -1 garantit `shape`
        // défini, branche inatteignable — cf. SPEC-PLANMAP-SPLIT.md §6.3.
        if (!shape) return this._hideTextModal();
        if (shape.type === 'text') {
            if (!text) {
                // Suppression d'un texte libre
                list.splice(idx, 1);
                if (this._selectedShapeId === id) this._deselectShape();
            } else {
                shape.text = text;
                shape.textColor = color;
                shape.color = color;
                shape.fontSize = Math.max(9, Math.min(72, size));
            }
        } else {
            shape.text = text;
            shape.textColor = color;
            shape.fontSize = Math.max(9, Math.min(72, size));
        }
        this._saveShapes(list);
        this._renderShapes();
        this._refreshUndoRedoButtons();
        // Garde la forme sélectionnée pour permettre l'édition immédiate (handles + toolbar)
        const stillExists = this._loadShapes().some((s) => s.id === id);
        if (stillExists) this._selectShape(id);
        // Ferme la modale (sans retrigger le cleanup vide)
        const modal = document.getElementById('planTextModal');
        const backdrop = document.getElementById('modalBackdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        this._restoreModalFromFullscreen();
    },

    /** Initialise (une seule fois) les listeners de la modale de texte. */
    // planMap.js:4670
    _bindTextModalOnce(this: PlanMapInternal): void {
        if (this._textModalBound) return;
        this._textModalBound = true;
        const ok = document.getElementById('planTextConfirmBtn');
        const ko = document.getElementById('planTextCancelBtn');
        if (ok) ok.onclick = () => this._confirmTextModal();
        if (ko) ko.onclick = () => this._hideTextModal();
        document.querySelectorAll<HTMLElement>('#plan_text_color_palette .plan-text-color').forEach((b) => {
            b.onclick = () => {
                document.querySelectorAll<HTMLElement>('#plan_text_color_palette .plan-text-color').forEach((o) => { o.style.borderColor = 'transparent'; });
                b.style.borderColor = '#fff';
                // data-color est posé par le markup de la palette ; String() reproduit la
                // coercion native de l'assignation `.value = undefined` (ToString → "undefined").
                (document.getElementById('plan_text_color_val') as HTMLInputElement).value = String(b.dataset.color);
            };
        });
        const minusBtn = document.getElementById('plan_text_size_minus');
        const plusBtn  = document.getElementById('plan_text_size_plus');
        const sizeInput = document.getElementById('plan_text_size_input') as HTMLInputElement | null;
        const sizeDisp = document.getElementById('plan_text_size_val');
        const setSize = (n: number): void => {
            const v = Math.max(9, Math.min(72, n));
            if (sizeInput) sizeInput.value = String(v);
            if (sizeDisp)  sizeDisp.textContent = String(v);
        };
        if (minusBtn) minusBtn.onclick = () => setSize(parseInt((sizeInput as HTMLInputElement).value, 10) - 2);
        if (plusBtn)  plusBtn.onclick  = () => setSize(parseInt((sizeInput as HTMLInputElement).value, 10) + 2);
        // Échap / Ctrl-Entrée dans la modale
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('planTextModal');
            if (!modal || modal.style.display !== 'block') return;
            if (e.key === 'Escape') this._hideTextModal();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this._confirmTextModal();
        });
    },

    /** Place une nouvelle forme `text` libre à la position cliquée. */
    // planMap.js:4705
    _addFreeText(this: PlanMapInternal, lngLat: LngLatObj): void {
        const id = 'shape_' + Date.now();
        const list = this._loadShapes();
        this._pushHistory();
        list.push({
            id, type: 'text',
            color: this.drawColor || '#ffffff',
            textColor: this.drawColor || '#ffffff',
            coords: [[lngLat.lng, lngLat.lat]],
            text: '',
        });
        this._saveShapes(list);
        this._refreshUndoRedoButtons();
        // Ouvre immédiatement la modale pour saisir le texte
        this._openTextModal(id);
    },
};
