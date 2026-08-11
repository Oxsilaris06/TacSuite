/**
 * wheels.ts — Roues contextuelles (ping/forme) + copie de coordonnées
 * (P2.CONV, paquet `pm-wheels`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 7 méthodes « ROUES CONTEXTUELLES » de
 * `modules/pctac/planMap.js` (GStart-main, lecture seule) :
 * `_closeWheel` (:3533), `_copyCoords` (:3543), `_otanColors` (:3575),
 * `_openCreatePingWheel` (:3591), `_quickPlacePing` (:3630),
 * `_openPingOptionsWheel` (:3648), `_openShapeWheel` (:4243).
 *
 * Cf. docs/SPEC-PLANMAP-SPLIT.md §4.12 (signatures), §1.3 (règle `this`),
 * §5.1 pièges (PlanWheel structurel : la roue `Wheel` de @pctac/wheel.js est
 * assignable à `PlanWheel` par typage structurel, SANS import de son type).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import { Wheel } from '@pctac/wheel.js';
import type { WheelOption } from '@pctac/wheel.js';
import { PIN_ICONS } from '@pctac/config.js';
import { formatCoordsClipboard, shortMgrs } from '@shared/coords.js';

import type { LngLatObj, OtanColor, PlanMapInternal, PlanShapeType } from './types.js';

export const WheelsMethods = {
    // ============================================================
    // =================  ROUES CONTEXTUELLES  ===================
    // ============================================================
    /** Ferme la roue active s'il y en a une. */
    // planMap.js:3532-3536
    _closeWheel(this: PlanMapInternal): void {
        if (this._activeWheel) { try { this._activeWheel.destroy(); } catch { /* ignore */ } this._activeWheel = null; }
        this._wheelJustClosed = Date.now();
    },

    /**
     * Copie les coordonnées d'un point dans le presse-papier (décimal + DMS + MGRS).
     * Utilisé par l'option « Copier coordonnées » des roues. Fallback execCommand si
     * l'API Clipboard est absente (contexte non sécurisé / navigateur ancien).
     */
    // planMap.js:3538-3570
    _copyCoords(this: PlanMapInternal, lng: number, lat: number): void {
        const text = formatCoordsClipboard(lng, lat);
        const done = (): void => {
            this._showHint('Coordonnées copiées — ' + shortMgrs(lng, lat));
            setTimeout(() => this._hideHint(), 2000);
        };
        const fallback = (): void => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                done();
            } catch {
                // Dernier recours : on affiche les coordonnées pour copie manuelle.
                this._showHint('Copie impossible — ' + shortMgrs(lng, lat));
                setTimeout(() => this._hideHint(), 3500);
            }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
            fallback();
        }
    },

    /** Couleurs OTAN (référencées partout).
     *  `defaultLabel` (optionnel) force le libellé quand on pose en quick-place,
     *  même si l'icône par défaut s'appelle autrement dans PIN_ICONS. */
    // planMap.js:3572-3583 — pas d'usage de `this` : pas de paramètre `this` (SPEC-PLANMAP-SPLIT §1.3).
    _otanColors(): OtanColor[] {
        return [
            { kind: 'Adv',     color: '#ef4444', icon: 'person_alert' },
            { kind: 'Otage',   color: '#eab308', icon: 'person_off' },
            { kind: 'Inter',   color: '#3b82f6', icon: 'local_police' },
            { kind: 'Oscar',   color: '#22c55e', icon: 'military_tech', defaultLabel: 'Oscar' },
            { kind: 'Inconnu', color: '#94a3b8', icon: 'help' },
        ];
    },

    /**
     * Roue de CRÉATION d'un ping — 1 SEUL niveau, simple :
     *  - 5 segments couleur : tap = ping placé directement (icône par défaut)
     *  - 1 segment "Catalogue" : ouvre un panneau d'icônes (color + icon)
     * Après placement, ouvre la roue d'options sur le ping.
     */
    // planMap.js:3591-3626
    _openCreatePingWheel(this: PlanMapInternal, lngLat: LngLatObj): void {
        this._closeWheel();
        const opts: WheelOption[] = this._otanColors().map((o) => ({
            id: 'kind_' + o.kind,
            icon: o.icon,
            label: o.kind,
            color: '#fff',
            bg: o.color,
            action: () => this._quickPlacePing(lngLat, o, o.icon),
        }));
        opts.push({
            id: 'entity',
            icon: 'groups',
            label: 'Entité',
            color: '#fff',
            bg: '#7c3aed',
            action: () => this._openEntityPickerPanel(lngLat),
        });
        opts.push({
            id: 'catalog',
            icon: 'apps',
            label: 'Catalogue',
            color: '#fff',
            bg: '#475569',
            action: () => this._openIconCatalogPanel(lngLat),
        });
        opts.push({
            id: 'copycoords',
            icon: 'my_location',
            label: 'Copier coords',
            color: '#fff',
            bg: '#0f766e',
            action: () => this._copyCoords(lngLat.lng, lngLat.lat),
        });

        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: 'Nouveau ping',
            options: opts,
            onClose: () => { this._activeWheel = null; },
        });
        this._activeWheel.open();
    },

    /** Pose un ping rapide. Le label par défaut = label override OTAN s'il existe,
     *  sinon le nom de l'icône (PIN_ICONS), sinon le kind. */
    // planMap.js:3628-3645
    _quickPlacePing(
        this: PlanMapInternal,
        lngLat: LngLatObj,
        otan: Pick<OtanColor, 'kind' | 'color'> & Partial<OtanColor>,
        iconId: string,
    ): void {
        const id = `free_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const iconDef = PIN_ICONS.find((i) => i.id === iconId);
        const defaultLabel = otan.defaultLabel || (iconDef ? iconDef.label : otan.kind);
        this._addPin({
            id,
            label: defaultLabel,
            color: otan.color,
            kind: otan.kind,
            icon: iconId,
            lng: lngLat.lng,
            lat: lngLat.lat,
        });
        // Ouvre la roue d'édition à proximité pour ajustements rapides
        setTimeout(() => this._openPingOptionsWheel(id), 80);
    },

    /** Roue d'options pour un ping existant (texte, diamètre, icône, suppr). */
    // planMap.js:3648-3724
    _openPingOptionsWheel(this: PlanMapInternal, pinId: string): void {
        const pin = this._loadPins().find((p) => p.id === pinId);
        if (!pin) return;
        const lngLat = { lng: pin.lng, lat: pin.lat };
        const otanColor = pin.color || '#3b82f6';
        // planMap.js:3652 — variable calculée mais jamais lue dans l'original
        // (code mort local) ; conservée pour fidélité, neutralisée pour
        // `noUnusedLocals` (même traitement que `restrictWidth` dans
        // pdf-export.ts, cf. SPEC-PCTAC-CONVERSION.md §9).
        void otanColor;
        const hasText = !!pin.text;
        // planMap.js:3654 — `pin.diameterM` est optionnel (`number | undefined`) :
        // `?? 0` neutralise strictNullChecks sans changer le résultat (`undefined > 0`
        // et `(undefined ?? 0) > 0` valent tous deux `false`, comme pour toute valeur
        // numérique réelle).
        const hasDiameter = (pin.diameterM ?? 0) > 0;

        const opts: WheelOption[] = [
            {
                id: 'text',
                icon: 'text_fields',
                label: hasText ? 'Modifier texte' : 'Ajouter texte',
                color: '#fff',
                bg: 'rgba(234,179,8,0.95)',
                action: () => this._editPinText(pinId),
            },
            {
                id: 'diameter',
                icon: 'straighten',
                label: hasDiameter ? 'Modifier diamètre' : 'Ajouter diamètre',
                color: '#fff',
                bg: 'rgba(34,197,94,0.95)',
                action: () => this._editPinDiameter(pinId),
            },
            {
                id: 'icon',
                icon: 'palette',
                label: 'Changer icône',
                color: '#fff',
                bg: 'rgba(99,102,241,0.95)',
                action: () => this._openIconCatalogPanelForEdit(pinId),
            },
            {
                id: 'color',
                icon: 'palette',
                label: 'Couleur',
                color: '#fff',
                bg: 'rgba(168,85,247,0.95)',
                action: () => this._openPinColorPanel(pinId),
            },
            {
                id: 'lock',
                icon: pin.locked ? 'lock' : 'lock_open',
                label: pin.locked ? 'Déverrouiller' : 'Verrouiller',
                color: '#fff',
                bg: pin.locked ? 'rgba(234,179,8,0.95)' : 'rgba(100,116,139,0.95)',
                action: () => this._togglePinLock(pinId),
            },
            {
                id: 'copycoords',
                icon: 'my_location',
                label: 'Copier coords',
                color: '#fff',
                bg: 'rgba(15,118,110,0.95)',
                action: () => this._copyCoords(pin.lng, pin.lat),
            },
            {
                id: 'delete',
                icon: 'delete',
                label: 'Supprimer',
                color: '#fff',
                bg: 'rgba(239,68,68,0.95)',
                action: () => this._removePin(pinId),
            },
        ];

        this._closeWheel();
        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            title: pin.label || pin.kind || 'Ping',
            options: opts,
            onClose: () => { this._activeWheel = null; },
        });
        this._activeWheel.open();
    },

    /** Roue contextuelle pour modifier une FORME existante. */
    // planMap.js:4243-4316
    _openShapeWheel(this: PlanMapInternal, shapeId: string, lngLat: LngLatObj | null): void {
        const s = this._loadShapes().find((x) => x.id === shapeId);
        if (!s) return;
        const opts: WheelOption[] = [
            {
                id: 'text',
                icon: 'text_fields',
                label: s.text ? 'Modifier texte' : 'Ajouter texte',
                color: '#fff', bg: 'rgba(234,179,8,0.95)',
                action: () => this._openTextModal(s.id),
            },
        ];
        if (s.type === 'text') {
            // Texte libre : les boutons taille agissent sur la police.
            opts.push(
                { id: 'minus', icon: 'text_decrease', label: 'Taille -',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustFontSize(s.id, -2), keepOpen: true },
                { id: 'plus', icon: 'text_increase', label: 'Taille +',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustFontSize(s.id, +2), keepOpen: true },
            );
        } else {
            // Trait / Cercle / Rectangle : les boutons taille règlent l'épaisseur du trait.
            opts.push(
                { id: 'thin', icon: 'remove', label: 'Épaisseur -',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustStrokeWidth(s.id, -1), keepOpen: true },
                { id: 'thick', icon: 'add', label: 'Épaisseur +',
                  color: '#fff', bg: 'rgba(120,120,120,0.95)',
                  action: () => this._adjustStrokeWidth(s.id, +1), keepOpen: true },
            );
        }
        if (s.type === 'circle') {
            const diaOn = (s.showDiameter !== false) && this._diameterGlobal;
            opts.push({
                id: 'diameter',
                icon: diaOn ? 'visibility_off' : 'straighten',
                label: diaOn ? 'Masquer diamètre' : 'Afficher diamètre',
                color: '#fff', bg: 'rgba(34,197,94,0.95)',
                action: () => this._toggleShapeDiameter(s.id),
            });
        }
        opts.push({
            id: 'lock',
            icon: s.locked ? 'lock' : 'lock_open',
            label: s.locked ? 'Déverrouiller' : 'Verrouiller',
            color: '#fff',
            bg: s.locked ? 'rgba(234,179,8,0.95)' : 'rgba(100,116,139,0.95)',
            action: () => this._toggleShapeLock(s.id),
        });
        opts.push({
            id: 'delete', icon: 'delete', label: 'Supprimer',
            color: '#fff', bg: 'rgba(239,68,68,0.95)',
            action: () => {
                this._pushHistory();
                const list = this._loadShapes().filter((x) => x.id !== s.id);
                this._saveShapes(list);
                this._deselectShape();
                this._renderShapes();
                this._refreshUndoRedoButtons();
            },
        });

        this._closeWheel();
        this._activeWheel = new Wheel({
            map: this.map,
            lngLat,
            // planMap.js:4311 — `s.type` couvre PlanShapeType (dont 'measure'/'measure-rings',
            // absents de la table) ; le cast neutralise l'indexation sous `noImplicitAny`
            // sans changer le résultat (`|| 'Forme'` couvrait déjà ces cas dans l'original).
            title: ({ line: 'Trait', rectangle: 'Rectangle', circle: 'Cercle', text: 'Texte' } as Partial<Record<PlanShapeType, string>>)[s.type] || 'Forme',
            options: opts,
            onClose: () => { this._activeWheel = null; },
        });
        this._activeWheel.open();
    },
};
