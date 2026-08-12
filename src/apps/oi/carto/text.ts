/**
 * text.ts — TEXTE LIBRE : pose, édition, couleur, suppression sur la carto OI
 * (paquet `oi-carto-text`, port fonctionnel — pas de source `oi_cartographie.js`
 * équivalente, GStart-main n'a jamais eu de texte libre côté OI).
 * ===========================================================================
 *
 * Référence de comportement : PC-Tac `planmap/text-modal.ts` (`_addFreeText`)
 * + `planmap/shapes-render.ts` (`_renderShapeTexts`). Le texte libre est une
 * forme `type:'text'` unifiée dans `_loadShapes`/`_saveShapes` (même
 * frontière de persistance que `line`/`rectangle`/`circle`/`measure`), rendue
 * en annotation NUE (halo, pas de cadre/fond) — parité visuelle PC-Tac
 * `.plan-shape-text` — et sélectionnable/déplaçable/supprimable via le
 * chantier `shape-edit.ts` EXACTEMENT comme les autres formes : la machine
 * de gestes partagée `@shared/shape-gestures.js` gère déjà nativement le cas
 * `type === 'text'` (poignée `textresize`, translation, cf. `shapeHandles`/
 * `startHandleGesture`) — aucun code de geste dédié à écrire ici.
 *
 * Coupe la plus simple côté OI vs PC-Tac (pas de markup dédié dans
 * `oi/index.html`, pas de modale à câbler) : saisie via `promptDialog`
 * (`@shared/feedback.js`, dialog générique déjà jsdom-safe) au lieu de la
 * modale `#planTextModal` de PC-Tac — le texte est donc connu AVANT la
 * création de la forme (pas de forme fantôme à nettoyer si annulé, contraste
 * avec `_hideTextModal`/`_confirmTextModal` côté PC-Tac).
 *
 * MIGRATION : l'ANCIEN modèle (`OiCartoText`, bucket dédié
 * `cartography.texts`) est migré paresseusement vers des shapes `type:'text'`
 * par `_migrateLegacyTexts` (appelée en tête de `_renderShapeTexts`,
 * idempotente — no-op une fois le bucket vidé).
 *
 * Édition : clic simple sur l'étiquette = geste générique (tap = sélection +
 * poignées + toolbar, drag = déplacement) via `_startShapeGesture` — parité
 * PC-Tac (marker `pointerdown` → `_startShapeGesture`, `shapes-render.ts`).
 * Double-clic = édition du contenu (`_editText`, `promptDialog`) — vider le
 * champ supprime l'étiquette (parité PC-Tac `_confirmTextModal`, texte vide =
 * suppression).
 *
 * UNDO/REDO : câblé — `_startFreeText`/`_editText`/`_removeText` appellent
 * `_pushHistory()` avant mutation, comme tout autre shape (draw.ts). Écart
 * comblé vs l'ancienne version bucket-dédié (non câblée, cf. historique git).
 */

import maplibregl from 'maplibre-gl';
import type { Marker } from 'maplibre-gl';

import { promptDialog } from '@shared/feedback.js';

import type { LngLatObj, OICartoInternal, OiCartoShape, OiCartoText } from './types.js';

export const TextMethods = {
    /**
     * Lecture de l'ANCIEN bucket `cartography.texts` (migration uniquement,
     * cf. en-tête fichier). Accès direct au champ (pas d'adapter dédié,
     * bucket voué à disparaître une fois toutes les archives migrées).
     */
    _loadTexts(this: OICartoInternal): OiCartoText[] {
        const carto = this._getCartoState();
        const raw = (carto as unknown as { texts?: OiCartoText[] } | null)?.texts;
        return Array.isArray(raw) ? raw : [];
    },

    /** Écriture de l'ANCIEN bucket `cartography.texts` (migration uniquement — vidé après migration). */
    _saveTexts(this: OICartoInternal, texts: readonly OiCartoText[]): void {
        const carto = this._getCartoState();
        if (!carto) return;
        (carto as unknown as { texts: OiCartoText[] }).texts = texts.slice();
    },

    /**
     * Migre une fois pour toutes les anciennes étiquettes `cartography.texts`
     * (modèle marker dédié, pré-unification shape) en shapes `type:'text'`.
     * Idempotente : no-op si le bucket est vide/absent (déjà migré, ou
     * archive jamais passée par l'ancien modèle).
     */
    _migrateLegacyTexts(this: OICartoInternal): void {
        const legacy = this._loadTexts();
        if (!legacy.length) return;
        const shapes = this._loadShapes().slice();
        for (const t of legacy) {
            const shape: OiCartoShape = {
                id: t.id, type: 'text', color: t.color, textColor: t.color,
                coords: [[t.lng, t.lat]], text: t.text,
            };
            shapes.push(shape);
        }
        this._saveShapes(shapes);
        this._saveTexts([]); // bucket vidé : migration faite, ne se rejoue plus
    },

    /**
     * Pose un texte libre au point cliqué (couleur = couleur active du dock
     * dessin, `this.drawColor` — parité PC-Tac `this.drawColor || '#ffffff'`).
     * N'ajoute rien si annulé/vide (saisie AVANT création, cf. en-tête).
     */
    async _startFreeText(this: OICartoInternal, lngLat: LngLatObj): Promise<void> {
        const value = await promptDialog({ title: 'Texte libre', message: 'Texte à afficher sur la carte' });
        if (value === null) return; // annulé
        const text = value.trim();
        if (!text) return; // vide → rien à poser
        this._pushHistory();
        const color = this.drawColor || '#ffffff';
        const shape: OiCartoShape = {
            id: 'shape_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            type: 'text',
            color,
            textColor: color,
            coords: [[lngLat.lng, lngLat.lat]],
            text,
        };
        const list = this._loadShapes();
        list.push(shape);
        this._saveShapes(list);
        this._refreshUndoRedoButtons();
        this._renderShapes();
    },

    /**
     * Édite le contenu d'un texte existant (double-clic, parité PC-Tac).
     * Vider le champ supprime l'étiquette (parité PC-Tac `_confirmTextModal`).
     */
    async _editText(this: OICartoInternal, id: string): Promise<void> {
        const list = this._loadShapes();
        const target = list.find((s) => s.id === id && s.type === 'text');
        if (!target) return;
        const value = await promptDialog({ title: 'Modifier le texte', message: 'Texte à afficher', initial: target.text || '' });
        if (value === null) return; // annulé, inchangé
        const trimmed = value.trim();
        if (!trimmed) {
            this._removeText(id);
            return;
        }
        this._pushHistory();
        target.text = trimmed;
        this._saveShapes(list);
        this._refreshUndoRedoButtons();
        this._renderShapes();
    },

    /** Supprime une étiquette de texte (shape `type:'text'`). */
    _removeText(this: OICartoInternal, id: string): void {
        this._pushHistory();
        this._saveShapes(this._loadShapes().filter((s) => s.id !== id));
        if (this._selectedShapeId === id) this._deselectShape();
        this._refreshUndoRedoButtons();
        this._renderShapes();
    },

    /**
     * Rend les annotations texte libres : HTML markers nus (halo, pas de
     * cadre/fond — parité PC-Tac `.plan-shape-text`/`_renderShapeTexts`).
     * Recrée tout à chaque appel (nombre de textes posés sur une carte OI
     * reste faible en pratique — même angle que l'historique `pins.ts`).
     */
    _renderShapeTexts(this: OICartoInternal): void {
        this._migrateLegacyTexts();
        for (const marker of this.textMarkers.values()) {
            try { marker.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
        }
        this.textMarkers.clear();
        const map = this.map;
        if (!map) return;

        for (const s of this._loadShapes()) {
            if (s.type !== 'text' || !s.text) continue;
            const pt = s.coords[0];
            if (!pt) continue;

            const div = document.createElement('div');
            div.className = 'oi-carto-shape-text';
            div.textContent = s.text;
            const col = s.textColor || s.color || '#fff';
            const fontSize = Math.max(9, Math.min(72, s.fontSize || 13));
            div.style.color = col;
            div.style.fontSize = fontSize + 'px';

            const shapeId = s.id;
            // Délégation au state-machine gestuelle commune (parité PC-Tac
            // `onTextPointerDown`) : tap = sélection, drag = déplacement.
            const onPointerDown = (ev: PointerEvent | TouchEvent): void => {
                if (this.drawTool || this._gesture) return;
                ev.preventDefault();
                ev.stopPropagation();
                const rect = map.getCanvas().getBoundingClientRect();
                const touch = 'touches' in ev ? ev.touches[0] : undefined;
                const clientX = touch ? touch.clientX : (('clientX' in ev && ev.clientX) || 0);
                const clientY = touch ? touch.clientY : (('clientY' in ev && ev.clientY) || 0);
                const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
                this._startShapeGesture(shapeId, lngLat);
            };
            div.addEventListener('pointerdown', onPointerDown);
            div.addEventListener('touchstart', onPointerDown, { passive: false });
            div.addEventListener('dblclick', (e) => { e.stopPropagation(); void this._editText(shapeId); });

            const marker: Marker = new maplibregl.Marker({ element: div, anchor: 'center' })
                .setLngLat([pt[0], pt[1]])
                .addTo(map);
            this.textMarkers.set(shapeId, marker);
        }
    },
};
