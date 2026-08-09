/**
 * types.ts — Modèle de données + surface interne de `oi_cartographie.js`
 * (P3.CONV, paquet `oi-carto-base`).
 * ===========================================================================
 *
 * SOCLE du découpage `carto/` (SPEC-OI-CONVERSION.md §6.2/§6.3) : une FEUILLE
 * absolue — n'importe aucun autre fichier de `carto/` ni de `@oi/`, aucune
 * valeur d'exécution ici. Les 5 autres paquets `oi-carto-*` (state, map-core,
 * pins, panels/capture, draw) importent `OICartoInternal` en `import type`
 * pour typer leur `this`, à l'identique de `PlanMapInternal` côté PC-Tac
 * (`@pctac/planmap/types.ts`, patron SPEC-PLANMAP-SPLIT.md §1.2).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule, objet littéral `const OICarto = {...}`, lignes 269-1667).
 */

import type {
    MapLayerMouseEvent,
    MapMouseEvent,
    MapTouchEvent,
} from 'maplibre-gl';
import type {
    OICartoContract,
    OiCartographyState,
    OiCartoView,
} from '@shared/types/contracts.js';

/** Couple `[lng, lat]` tel que persisté dans les tracés (oi_cartographie.js:1482-1486,1573-1602). */
export type LngLatTuple = [number, number];

/** Point `{lng,lat}` — forme utilisée par les panneaux flottants (oi_cartographie.js:1014,1071,1097,1127). */
export interface LngLatObj {
    lng: number;
    lat: number;
}

/**
 * Surface de `OIWheel` (oi_cartographie.js:117-249, portée dans `carto/wheel.ts`
 * par le paquet `oi-carto-wheel`) RÉELLEMENT utilisée par les méthodes de
 * `OICarto` (`_closeWheel` :997-999, `_openPinWheel` :1022-1028). Déclarée
 * structurellement ICI, et NON importée de `./wheel.js`, pour que `types.ts`
 * reste une feuille sans dépendance de fichier `carto/` — précédent maison :
 * `PlanWheel` dans `@pctac/planmap/types.ts`.
 */
export interface OiCartoWheelHandle {
    open(): void;
    destroy(): void;
}

/**
 * Les 5 « kinds » de pin (clés de `OI_PIN_DEFS`, oi_cartographie.js:56-62) —
 * seules valeurs jamais construites par `_armPinPlacement` (:649-696).
 */
export type OiCartoPinKind = 'member' | 'cyno' | 'rame_vl' | 'vl_target' | 'rassemblement';

/** Point posé sur la carte, persisté par `_savePins` (oi_cartographie.js:862-873). */
export interface OiCartoPin {
    id: string;
    kind: OiCartoPinKind;
    label: string;
    memberTri: string | null;
    fonction: string | null;
    icon: string | null;
    color: string | null;
    lng: number;
    lat: number;
    /**
     * Libellé personnalisé, posé par `_openPinRenamePanel` (:1134) — prioritaire
     * sur `label`/`fonction` à l'affichage (oi_cartographie.js:942,946,1112).
     */
    text?: string | undefined;
}

/**
 * Placement en attente d'un clic carte, armé par `_armPinPlacement`
 * (oi_cartographie.js:849-854) et consommé par `_onMapClick` (:862-873).
 * `color` n'est posé par AUCUN site d'appel de `_armPinPlacement` de la source
 * actuelle mais reste lu (`p.color || null`, :870) : conservé optionnel pour
 * fidélité à la forme dynamique de l'objet d'origine.
 */
export interface OiCartoPendingPin {
    kind: OiCartoPinKind;
    label: string;
    memberTri?: string | undefined;
    fonction?: string | undefined;
    icon?: string | undefined;
    color?: string | undefined;
}

/** Cible d'export d'une capture de carte vers un champ photo (oi_cartographie.js:1185-1210). */
export interface OiCartoPhotoTarget {
    id: string;
    label: string;
}

/** Les 3 outils de tracé (oi_cartographie.js:278, `data-tool` des `.oi-carto-draw-btn`). */
export type OiCartoDrawTool = 'line' | 'rectangle' | 'circle';

/** État temporaire pendant un tracé (`_handleDrawDown`/`_handleDrawMove`, oi_cartographie.js:1442,1448). */
export interface OiCartoDrawState {
    start: LngLatTuple;
    current: LngLatTuple;
}

/** Type d'une forme persistée (oi_cartographie.js:1482-1486). */
export type OiCartoShapeType = 'line' | 'rectangle' | 'circle';

/** Une forme (dessin) persistée par `_saveShapes` (oi_cartographie.js:1482-1486). */
export interface OiCartoShape {
    id: string;
    type: OiCartoShapeType;
    color: string;
    /** Séquence de points `[lng, lat]` du tracé (segment, polygone rectangle fermé, ou approx. cercle). */
    coords: LngLatTuple[];
    /** `circle` uniquement : centre du tracé (oi_cartographie.js:1486). */
    center?: LngLatTuple | undefined;
    /** `circle` uniquement : point de bord ayant fixé le rayon (oi_cartographie.js:1486). */
    edge?: LngLatTuple | undefined;
}

/**
 * Vue caméra vécue en interne par `_loadView`/`_saveView`
 * (oi_cartographie.js:374-393) : sur-ensemble de `OiCartoView` (contracts.ts)
 * avec `is3D`.
 *
 * ÉCART SIGNALÉ (règle commune §6, "écart de signature constaté ⇒ signaler au
 * gate, ne pas corriger") : `OiCartoView` importé de `@shared/types/contracts.js`
 * n'a PAS de champ `is3D`, alors que la source le persiste
 * (`carto.view = {..., is3D: this.is3D}`, :391) et le relit à l'init
 * (`if (savedView.is3D) this._enable3D(false);`, :351). `OiCartoView` n'est
 * pas modifiable par ce paquet (règle commune §2/§6) ; `OiCartoViewState`
 * l'étend localement pour rester fidèle au comportement de la source.
 */
export interface OiCartoViewState extends OiCartoView {
    is3D?: boolean | undefined;
}

/**
 * `OICartoInternal` — surface INTERNE complète de l'objet littéral `OICarto`
 * (oi_cartographie.js:269-1667) : les 8 champs d'état propres (les 5 autres —
 * `map`, `initialized`, `is3D`, `markers`, `labelsVisible` — viennent déjà de
 * `OICartoContract`, hérité, NON redéclarés) + 1 champ ad hoc
 * (`_inlinePanelMove`, jamais dans le littéral mais assigné/lu par
 * `_openInlinePanel`/`_closeInlinePanel`, :1003-1005,1047) + la signature des
 * 76 méthodes, dans l'ordre du fichier source (SPEC-OI-CONVERSION.md §6.3).
 * `OICartoContract` n'est PAS redéfinie ici (règle commune §6/§7).
 */
export interface OICartoInternal extends OICartoContract {
    // --- 8 champs d'état propres (oi_cartographie.js:270-282, hors les 5 hérités) ---
    _activeWheel: OiCartoWheelHandle | null; // :270
    _inlinePanel: HTMLDivElement | null; // :271
    pendingPin: OiCartoPendingPin | null; // :277
    drawTool: OiCartoDrawTool | null; // :278
    drawColor: string; // :279
    drawState: OiCartoDrawState | null; // :280
    history: string[]; // :281 — pile JSON (`JSON.stringify(this._loadShapes())`)
    redoStack: string[]; // :282

    // --- champ ad hoc (jamais dans le littéral, cf. commentaire ci-dessus) ---
    _inlinePanelMove: (() => void) | null;

    /** Enveloppe un handler : capture toute exception (log) — oi_cartographie.js:284-291. */
    _safe<A extends unknown[], R>(fn: (...args: A) => R, label?: string): (...args: A) => R | undefined;

    // --- Cycle de vie carte (map-core.ts) ---
    _init(): void; // :318

    // --- Persistance — Store.state.formData.cartography (state.ts) ---
    _getCartoState(): OiCartographyState | null; // :366
    _loadView(): OiCartoViewState; // :374
    _saveView(): void; // :381
    _loadPins(): OiCartoPin[]; // :395
    _savePins(pins: readonly OiCartoPin[]): void; // :400
    _loadShapes(): OiCartoShape[]; // :405
    _saveShapes(list: readonly OiCartoShape[]): void; // :410

    // --- UI générale (map-core.ts) ---
    _bindUi(): void; // :419
    _toggleSearchPanel(force?: boolean): void; // :502
    _toggleFullscreen(): void; // :515
    _updateFullscreenIcon(): void; // :528
    _showHint(msg: string): void; // :540
    _hideHint(): void; // :547

    // --- Recherche adresse / GPS Nominatim (map-core.ts) ---
    _parseGps(str: string): { lat: number; lng: number } | null; // :557
    _searchAddress(): Promise<void>; // :567

    // --- PINS — membres PATRACDVR + pins OI dédiés (pins.ts) ---
    _openPingModal(): void; // :618
    _closePingModal(): void; // :627
    _renderPingLists(): void; // :633
    _memberLabel(btn: HTMLElement): string; // :701
    _customOr(fallback: string): string; // :708
    _emptyMsg(txt: string): string; // :713
    _pinButton(text: string, color: string, onClick: () => void): HTMLButtonElement; // :717
    _isMemberPlaced(tri: string): boolean; // :729
    _renderMemberList(container: HTMLElement, memberBtns: readonly HTMLElement[], kind: OiCartoPinKind): void; // :737
    _memberButton(opts: {
        text: string;
        color: string;
        placed: boolean;
        tri: string;
        onPlace: () => void;
    }): HTMLDivElement; // :782
    _resetMember(tri: string): void; // :817
    _goToMember(tri: string): void; // :825
    _getPatracdvrVehicles(): string[]; // :833
    _getAdversaryVehicles(): string[]; // :840
    _armPinPlacement(pending: OiCartoPendingPin): void; // :849
    _onMapClick(e: MapMouseEvent): void; // :856
    _addPin(pin: OiCartoPin): void; // :880
    _removePin(id: string): void; // :887
    _clearAllPins(): void; // :893
    _renderPins(): void; // :904

    // --- Roue d'options d'un pin + panneaux inline (panels.ts) ---
    _closeWheel(): void; // :997
    _closeInlinePanel(): void; // :1001
    _openPinWheel(pinId: string): void; // :1009
    _openInlinePanel(
        lngLat: LngLatObj,
        innerHtml: string,
        onMount?: (panel: HTMLDivElement) => void,
    ): HTMLDivElement; // :1032
    _openPinIconPanel(pinId: string): void; // :1054
    _openPinColorPanel(pinId: string): void; // :1083
    _openPinRenamePanel(pinId: string): void; // :1109
    _toggleLabels(): void; // :1147

    // --- CAPTURE — téléchargement / export vers un champ photo (capture.ts) ---
    _openCaptureModal(): void; // :1164
    _closeCaptureModal(): void; // :1177
    _getPhotoTargets(): OiCartoPhotoTarget[]; // :1185
    _captureCanvas(): Promise<HTMLCanvasElement | null>; // :1215
    _downloadCapture(): Promise<void>; // :1262
    _exportToField(containerId: string): Promise<void>; // :1281

    // --- DESSINS (shapes) — trait / rectangle / cercle, undo/redo (draw.ts) ---
    _initDrawingLayers(): void; // :1314
    _bindDrawUi(): void; // :1366
    _toggleDrawDock(force?: boolean): void; // :1390
    _setTool(tool: OiCartoDrawTool | null): void; // :1400
    _setDrawColor(color: string): void; // :1429
    _handleDrawDown(e: MapMouseEvent | MapTouchEvent): void; // :1437
    _handleDrawMove(e: MapMouseEvent | MapTouchEvent): void; // :1445
    _handleDrawUp(e: MapMouseEvent | MapTouchEvent): void; // :1470
    _finishShape(shape: OiCartoShape): void; // :1490
    _renderPreview(feature: GeoJSON.Feature): void; // :1502
    _clearPreview(): void; // :1507
    _renderShapes(): void; // :1512
    _onShapeClick(e: MapLayerMouseEvent): void; // :1524
    _pushHistory(): void; // :1537
    _undo(): void; // :1543
    _redo(): void; // :1551
    _refreshUndoRedoButtons(): void; // :1559
    _rectPolygon(a: LngLatTuple, b: LngLatTuple): LngLatTuple[]; // :1573
    _circlePolygon(center: LngLatTuple, edge: LngLatTuple): LngLatTuple[]; // :1578

    // --- Relief 3D + bâtiments (map-core.ts) ---
    _toggle3D(): void; // :1609
    _enable3D(animate?: boolean): void; // :1614
    _disable3D(): void; // :1652
}
