/**
 * legacy.ts — Code mort interne du cluster « transform » de `planMap.js` (P2.CONV, paquet `pm-legacy`).
 * ====================================================================================================
 *
 * Contient les 10 méthodes orphelines jamais appelées depuis le code vivant
 * (cf. `docs/SPEC-PLANMAP-SPLIT.md` §7 : verrou par-annotation, gardes defensives, etc.).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js` (lecture seule).
 * Port VERBATIM de planMap.js :
 *   - :3192 `_onShapeClick`
 *   - :3398 `_renderFloatingToolbar`
 *   - :4350 `_startTransform`
 *   - :4394 `_startMoveShape`
 *   - :4414 `_startResizeShape`
 *   - :4444 `_endMoveShape`
 *   - :4450 `_cancelMoveShape`
 *   - :4467 `_teardownMove`
 *   - :4480 `_showTransformToolbar`
 *   - :4532 `_hideTransformToolbar`
 *
 * Règle : Aucune simplification, aucun refactor. Fidélité avant élégance.
 */

import type { PlanMapInternal, TransformOptions } from './types.js';
import type { MapLayerMouseEvent } from 'maplibre-gl';

/**
 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
 */
export const LegacyMethods = {
	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * planMap.js:3192
	 */
	_onShapeClick(this: PlanMapInternal, e: MapLayerMouseEvent): void {
		const feat = e.features && e.features[0];
		const id = feat && feat.properties && feat.properties.shapeId;
		if (id) this._selectShape(id);
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * planMap.js:3398
	 */
	_renderFloatingToolbar(this: PlanMapInternal): void {
		this._clearFloatingToolbar();
		if (!this.map || !this._selectedShapeId) return;
		const s = this._loadShapes().find(x => x.id === this._selectedShapeId);
		if (!s) return;
		const anchor = this._shapeAnchor(s);
		if (!anchor) return;

		const el = document.createElement('div');
		el.className = 'plan-floating-toolbar';
		el.style.cssText = `
			display: flex; gap: 4px; align-items: center;
			background: rgba(20,24,32,0.95);
			backdrop-filter: blur(8px);
			color: #fff;
			padding: 4px 6px;
			border-radius: 8px;
			border: 1px solid rgba(255,255,255,0.15);
			box-shadow: 0 6px 18px rgba(0,0,0,0.5);
			font-family: var(--font-ui, sans-serif);
			white-space: nowrap;
			pointer-events: auto;
			touch-action: none;
			user-select: none;
			-webkit-user-select: none;
		`;
		const btn = (icon: string, title: string, color?: string | undefined) => `
			<button type="button" data-act="${icon}" title="${title}"
				style="background: transparent; border: 0; color: ${color || '#fff'};
				       padding: 6px; min-width: 34px; min-height: 34px;
				       border-radius: 6px; cursor: pointer; display: inline-flex;
				       align-items: center; justify-content: center;">
				<span class="material-symbols-outlined" style="font-size: 20px;">${icon}</span>
			</button>`;

		let html = '';
		html += btn('text_fields', s.text ? 'Modifier le texte' : 'Ajouter du texte', '#eab308');
		if (s.text || s.type === 'text') {
			html += btn('text_decrease', 'Réduire la taille', '#fff');
			html += btn('text_increase', 'Agrandir la taille', '#fff');
		}
		if (s.type === 'circle') {
			const diaOn = (s.showDiameter !== false) && this._diameterGlobal;
			html += btn(diaOn ? 'straighten' : 'visibility_off', diaOn ? 'Masquer le diamètre' : 'Afficher le diamètre', diaOn ? '#22c55e' : '#94a3b8');
		}
		html += `<span style="width:1px; height: 22px; background: rgba(255,255,255,0.18); margin: 0 2px;"></span>`;
		html += btn('delete', 'Supprimer', '#ef4444');
		html += btn('close',  'Désélectionner', '#94a3b8');
		el.innerHTML = html;
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * planMap.js:4350
	 */
	_startTransform(this: PlanMapInternal, opts: TransformOptions): void {
		// Si une transformation est déjà en cours, on l'annule proprement.
		if (this.moveState) this._cancelMoveShape();

		const { mode, shapeId, applyMove, cursor, hintText } = opts;

		if (!this.map) return;
		const list = this._loadShapes();
		const shape = list.find(s => s.id === shapeId);
		if (!shape) return;

		this._pushHistory();
		const original = JSON.parse(JSON.stringify(shape));
		this.moveState = { shapeId, mode, original, applyMove };

		const onMove = (e: unknown) => {
			if (!this.moveState) return;
			const evt = e as { lngLat: { lng: number; lat: number } };
			const cur: [number, number] = [evt.lngLat.lng, evt.lngLat.lat];
			const list2 = this._loadShapes();
			const target = list2.find(s => s.id === shapeId);
			if (!target) return;
			try {
				applyMove(cur, original, target);
			} catch (err) {
				console.error('[PlanMap] applyMove échec:', err);
				return;
			}
			this._saveShapes(list2);
			this._renderShapes();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') this._cancelMoveShape();
			else if (e.key === 'Enter') this._endMoveShape();
		};

		this._moveHandlers = { onMove, onKey };
		this.map.on('mousemove', onMove);
		this.map.on('touchmove', onMove);
		document.addEventListener('keydown', onKey);
		this.map.getCanvas().style.cursor = cursor || 'move';

		this._showTransformToolbar(hintText);
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * Déplacement : translation par delta du curseur depuis l'ancre (point cliqué).
	 * planMap.js:4394
	 */
	_startMoveShape(this: PlanMapInternal, shapeId: string, anchorLngLat: [number, number]): void {
		this._startTransform({
			mode: 'move',
			shapeId,
			cursor: 'move',
			hintText: 'Déplacement : bouge le curseur, ✓ pour valider, ✕ pour annuler',
			applyMove: (cur: [number, number], _original, target) => {
				const dLng = cur[0] - anchorLngLat[0];
				const dLat = cur[1] - anchorLngLat[1];
				if (_original.coords) {
					target.coords = _original.coords.map(([x, y]: [number, number]) => [x + dLng, y + dLat] as [number, number]);
				}
				if (_original.center) target.center = [_original.center[0] + dLng, _original.center[1] + dLat] as [number, number];
				if (_original.edge)   target.edge   = [_original.edge[0]   + dLng, _original.edge[1]   + dLat] as [number, number];
			}
		});
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * Redimensionnement : pivot fixe (start / coin / centre selon le type),
	 * point mobile = curseur. Régénère la géométrie de la forme.
	 * planMap.js:4414
	 */
	_startResizeShape(this: PlanMapInternal, shapeId: string): void {
		const list = this._loadShapes();
		const shape = list.find(s => s.id === shapeId);
		if (!shape) return;
		const orig = JSON.parse(JSON.stringify(shape));
		let pivot: [number, number];
		if (shape.type === 'line')           pivot = orig.coords[0].slice() as [number, number];
		else if (shape.type === 'rectangle') pivot = orig.coords[0].slice() as [number, number];
		else if (shape.type === 'circle')    pivot = (orig.center || orig.coords[0]).slice() as [number, number];
		else return; // pas de resize pour text

		this._startTransform({
			mode: 'resize',
			shapeId,
			cursor: 'nwse-resize',
			hintText: 'Redimensionnement : bouge le curseur, ✓ pour valider, ✕ pour annuler',
			applyMove: (cur: [number, number], _original, target) => {
				if (target.type === 'line') {
					target.coords = [pivot.slice() as [number, number], cur];
				} else if (target.type === 'rectangle') {
					target.coords = this._rectPolygon(pivot, cur);
				} else if (target.type === 'circle') {
					target.coords = this._circlePolygon(pivot, cur);
					target.center = pivot.slice() as [number, number];
					target.edge = cur;
				}
			}
		});
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * planMap.js:4444
	 */
	_endMoveShape(this: PlanMapInternal): void {
		if (!this.moveState) return;
		this._teardownMove();
		this._refreshUndoRedoButtons();
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * planMap.js:4450
	 */
	_cancelMoveShape(this: PlanMapInternal): void {
		if (!this.moveState) return;
		// Restaure l'original
		const { shapeId, original } = this.moveState;
		const list = this._loadShapes();
		const idx = list.findIndex(s => s.id === shapeId);
		if (idx !== -1) {
			list[idx] = original;
			this._saveShapes(list);
			this._renderShapes();
		}
		// Annule le snapshot d'historique poussé au démarrage
		this.history.pop();
		this._teardownMove();
		this._refreshUndoRedoButtons();
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * planMap.js:4467
	 */
	_teardownMove(this: PlanMapInternal): void {
		if (this._moveHandlers) {
			if (this.map) {
				// MapLibre peut jeter selon l'état du style — catch vide intentionnel
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				try { this.map.off('mousemove', this._moveHandlers.onMove); } catch (e) {}
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				try { this.map.off('touchmove', this._moveHandlers.onMove); } catch (e) {}
			}
			document.removeEventListener('keydown', this._moveHandlers.onKey);
			this._moveHandlers = null;
		}
		this.moveState = null;
		if (this.map) this.map.getCanvas().style.cursor = '';
		this._hideTransformToolbar();
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * Barre flottante de validation (Valider / Annuler) pour move/resize.
	 * planMap.js:4480
	 */
	_showTransformToolbar(this: PlanMapInternal, message: string): void {
		this._hideTransformToolbar();
		const parent = document.getElementById('plan_map')?.parentElement;
		if (!parent) return;
		const bar = document.createElement('div');
		bar.id = 'plan_transform_toolbar';
		bar.style.cssText = `
			position: absolute; top: 10px; left: 50%;
			transform: translateX(-50%);
			display: flex; align-items: center; gap: 10px;
			background: rgba(20,24,32,0.95);
			backdrop-filter: blur(10px);
			color: #fff;
			padding: 8px 12px;
			border-radius: 10px;
			border: 1px solid rgba(255,255,255,0.15);
			box-shadow: 0 8px 24px rgba(0,0,0,0.5);
			font-family: var(--font-ui, sans-serif);
			font-size: 0.88em;
			z-index: 50;
			max-width: calc(100% - 20px);
			flex-wrap: wrap;
			justify-content: center;
		`;
		bar.innerHTML = `
			<span style="opacity: 0.9;">${message}</span>
			<button type="button" data-act="ok" style="
				display: inline-flex; align-items: center; gap: 4px;
				background: rgba(34,197,94,0.2); border: 1px solid #22c55e;
				color: #22c55e; padding: 6px 12px; border-radius: 6px;
				cursor: pointer; font-weight: 600; min-height: 36px;">
				<span class="material-symbols-outlined" style="font-size: 18px;">check</span>Valider
			</button>
			<button type="button" data-act="cancel" style="
				display: inline-flex; align-items: center; gap: 4px;
				background: rgba(239,68,68,0.2); border: 1px solid #ef4444;
				color: #ef4444; padding: 6px 12px; border-radius: 6px;
				cursor: pointer; font-weight: 600; min-height: 36px;">
				<span class="material-symbols-outlined" style="font-size: 18px;">close</span>Annuler
			</button>
		`;
		const okBtn = bar.querySelector('[data-act="ok"]') as HTMLButtonElement | null;
		const cancelBtn = bar.querySelector('[data-act="cancel"]') as HTMLButtonElement | null;
		if (okBtn) {
			okBtn.onclick = (ev: MouseEvent) => {
				ev.stopPropagation();
				this._endMoveShape();
			};
		}
		if (cancelBtn) {
			cancelBtn.onclick = (ev: MouseEvent) => {
				ev.stopPropagation();
				this._cancelMoveShape();
			};
		}
		parent.appendChild(bar);
	},

	/**
	 * @deprecated — Code mort interne, cf. SPEC-PLANMAP-SPLIT §7 ; ne pas rebrancher
	 * planMap.js:4532
	 */
	_hideTransformToolbar(this: PlanMapInternal): void {
		const bar = document.getElementById('plan_transform_toolbar');
		if (bar) bar.remove();
	},
};
