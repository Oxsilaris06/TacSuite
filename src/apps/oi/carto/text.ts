/**
 * text.ts — TEXTE LIBRE : pose, édition, couleur, suppression sur la carto OI
 * (paquet `oi-carto-text`, port fonctionnel — pas de source `oi_cartographie.js`
 * équivalente, GStart-main n'a jamais eu de texte libre côté OI).
 * ===========================================================================
 *
 * Référence de comportement : PC-Tac `planmap/text-modal.ts` (`_addFreeText`,
 * `_confirmTextModal` — texte vidé = suppression). Coupe la plus simple côté
 * OI (pas de markup dédié dans `oi/index.html`, pas de modale à câbler) :
 * saisie via `promptDialog` (`@shared/feedback.js`, dialog générique déjà
 * jsdom-safe) au lieu de la modale `#planTextModal` de PC-Tac.
 *
 * Modèle de données : `OiCartoText` (types.ts), persisté sous
 * `Store.state.formData.cartography.texts` via `_loadTexts`/`_saveTexts`
 * (state.ts) — même schéma de frontière que `pins`/`shapes`.
 *
 * Rendu : un `maplibregl.Marker` draggable par texte (même famille que
 * `pins.ts`), indexé dans `this.textMarkers` (Map dédiée, state.ts) — PAS
 * `this.markers` (partagé pins/shapes, collision d'id à éviter).
 *
 * ponytail: `_renderTexts` recrée TOUS les markers à chaque appel (pas de
 * réconciliation par signature façon `pins.ts` R3-e) — nombre de textes posés
 * sur une carte OI reste faible en pratique (contrairement aux pins). Si le
 * jank devient sensible, porter le même patron `_pinSignature`/réutilisation
 * par id que `pins.ts`.
 *
 * UNDO/REDO — SIGNALÉ, non câblé : `_pushHistory`/`_undo`/`_redo` (draw.ts,
 * hors périmètre de ce paquet) empilent `JSON.stringify(this._loadShapes())`
 * — un format propre aux formes dessinées, pas aux textes libres (bucket de
 * persistance distinct, `cartography.texts`). Les brancher correctement
 * demanderait d'étendre le format de pile d'historique dans `draw.ts`
 * (fichier interdit à ce paquet). Suppression/édition de texte restent donc
 * SANS undo/redo pour l'instant.
 */

import maplibregl from 'maplibre-gl';
import type { Marker } from 'maplibre-gl';

import { promptDialog } from '@shared/feedback.js';

import type { LngLatObj, OICartoInternal, OiCartoText } from './types.js';

/** Palette cycle simple (roue de couleur = trop pour cette coupe) — réutilise les teintes `OI_PIN_DEFS` + blanc/jaune lisibles sur fond carte. */
export const OI_TEXT_COLORS: readonly string[] = ['#ffffff', '#facc15', '#3b82f6', '#ef4444', '#22c55e'];

export const TextMethods = {
    /**
     * Persistance — délègue à `_getCartoState()` (state.ts, `PersistMethods`)
     * comme `pins`/`shapes`. Pas d'adapter dédié (scope minimal, cf. en-tête) :
     * lecture/écriture directe du champ `texts` du conteneur carto.
     */
    _loadTexts(this: OICartoInternal): OiCartoText[] {
        const carto = this._getCartoState();
        // ÉCART SIGNALÉ (même angle que state.ts) : `OiCartographyState`
        // (contracts.ts, contrat figé, hors périmètre de ce paquet) n'a pas de
        // champ `texts` — accès via cast local, comportement runtime identique
        // (lit `undefined` → tableau vide si absent).
        const raw = (carto as unknown as { texts?: OiCartoText[] } | null)?.texts;
        return Array.isArray(raw) ? raw : [];
    },

    _saveTexts(this: OICartoInternal, texts: readonly OiCartoText[]): void {
        const carto = this._getCartoState();
        if (!carto) return;
        (carto as unknown as { texts: OiCartoText[] }).texts = texts.slice();
    },

    /**
     * Câblage attendu (agent d'intégration) : appelé avec les coordonnées du
     * point cliqué/de la roue (ex. bouton toolbar « Texte » armant un
     * placement au clic suivant, ou action directe de roue de création —
     * même ergonomie que `_quickPlacePing`, `pins.ts`). Prompt la saisie,
     * n'ajoute rien si annulé/vide.
     */
    async _startFreeText(this: OICartoInternal, lngLat: LngLatObj): Promise<void> {
        const value = await promptDialog({ title: 'Texte libre', message: 'Texte à afficher sur la carte' });
        if (value === null) return; // annulé
        const text = value.trim();
        if (!text) return; // vide → rien à poser
        const texts = this._loadTexts().slice();
        texts.push({
            id: 'text_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            lng: lngLat.lng,
            lat: lngLat.lat,
            text,
            color: OI_TEXT_COLORS[0] ?? '#ffffff',
        });
        this._saveTexts(texts);
        this._renderTexts();
    },

    /**
     * Édite le texte d'une étiquette existante. Vider le champ supprime
     * l'étiquette (parité PC-Tac `_confirmTextModal`, texte vide = suppression).
     */
    async _editText(this: OICartoInternal, id: string): Promise<void> {
        const texts = this._loadTexts();
        const target = texts.find((t) => t.id === id);
        if (!target) return;
        const value = await promptDialog({ title: 'Modifier le texte', message: 'Texte à afficher', initial: target.text });
        if (value === null) return; // annulé, inchangé
        const trimmed = value.trim();
        if (!trimmed) {
            this._removeText(id);
            return;
        }
        target.text = trimmed;
        this._saveTexts(texts);
        this._renderTexts();
    },

    /** Supprime une étiquette de texte. */
    _removeText(this: OICartoInternal, id: string): void {
        const texts = this._loadTexts().filter((t) => t.id !== id);
        this._saveTexts(texts);
        this._renderTexts();
    },

    /** Cycle simple à travers `OI_TEXT_COLORS` (pas de roue de couleur complète pour cette coupe). */
    _cycleTextColor(this: OICartoInternal, id: string): void {
        const texts = this._loadTexts();
        const target = texts.find((t) => t.id === id);
        if (!target) return;
        const idx = OI_TEXT_COLORS.indexOf(target.color);
        target.color = OI_TEXT_COLORS[(idx + 1) % OI_TEXT_COLORS.length] ?? (OI_TEXT_COLORS[0] ?? '#ffffff');
        this._saveTexts(texts);
        this._renderTexts();
    },

    /**
     * Rend toutes les étiquettes de texte en markers draggables. Recrée tout
     * à chaque appel (cf. `ponytail:` en-tête de fichier).
     */
    _renderTexts(this: OICartoInternal): void {
        const map = this.map;
        // Nettoyage systématique, y compris sans carte (état cohérent).
        for (const marker of this.textMarkers.values()) {
            try { marker.remove(); } catch { /* déjà retiré du DOM — sans effet */ }
        }
        this.textMarkers.clear();
        if (!map) return;

        for (const t of this._loadTexts()) {
            const el = document.createElement('div');
            el.className = 'oi-carto-text-label';
            el.style.borderLeftColor = t.color;
            el.style.cursor = 'grab';

            const span = document.createElement('span');
            span.className = 'oi-carto-text-content';
            span.textContent = t.text;
            span.title = 'Cliquer pour modifier';
            span.addEventListener('click', (e) => { e.stopPropagation(); void this._editText(t.id); });
            el.appendChild(span);

            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'oi-carto-text-swatch';
            swatch.style.background = t.color;
            swatch.title = 'Changer la couleur';
            swatch.addEventListener('click', (e) => { e.stopPropagation(); this._cycleTextColor(t.id); });
            el.appendChild(swatch);

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'oi-carto-text-delete material-symbols-outlined';
            del.textContent = 'close';
            del.title = 'Supprimer';
            del.addEventListener('click', (e) => { e.stopPropagation(); this._removeText(t.id); });
            el.appendChild(del);

            const marker: Marker = new maplibregl.Marker({ element: el, anchor: 'left', draggable: true })
                .setLngLat([t.lng, t.lat])
                .addTo(map);

            marker.on('dragend', this._safe(() => {
                const ll = marker.getLngLat();
                const all = this._loadTexts().slice();
                const found = all.find((x) => x.id === t.id);
                if (found) { found.lng = ll.lng; found.lat = ll.lat; this._saveTexts(all); }
            }, 'text:dragend'));

            this.textMarkers.set(t.id, marker);
        }
    },
};
