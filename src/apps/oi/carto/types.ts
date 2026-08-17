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
    MapLayerTouchEvent,
    MapMouseEvent,
    MapTouchEvent,
    Marker,
} from 'maplibre-gl';
import type { ShapeGestureState } from '@shared/shape-gestures.js';
import type {
    OICartoContract,
    OiCartographyState,
    OiCartoView,
} from '@shared/types/contracts.js';
import type { MapPersistenceAdapter } from '@shared/map-persistence.js';

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
 * `OICarto` (`_closeWheel` :997-999, `_openPinWheel` :1022-1028, + `element`
 * lu par `_captureCanvas` depuis la mission R3-e — masquage de la roue active
 * pendant une capture, durcissement porté de `@pctac/planmap/capture.ts:79`).
 * Déclarée structurellement ICI, et NON importée de `./wheel.js`, pour que
 * `types.ts` reste une feuille sans dépendance de fichier `carto/` —
 * précédent maison : `PlanWheel` dans `@pctac/planmap/types.ts`.
 */
export interface OiCartoWheelHandle {
    open(): void;
    destroy(): void;
    element: HTMLElement | null;
}

/**
 * Les 5 « kinds » de pin (clés de `OI_PIN_DEFS`, oi_cartographie.js:56-62) —
 * seules valeurs jamais construites par `_armPinPlacement` (:649-696).
 */
/**
 * `generic` (roue de création → Catalogue → Génériques, chantier roue OI,
 * parité PC-Tac `PIN_ICONS`) : pin d'icône libre, hors les 5 kinds métier —
 * `OiCartoPin.icon` porte alors l'id d'icône choisi dans `@shared/pin-icons.js`.
 */
export type OiCartoPinKind = 'member' | 'cyno' | 'rame_vl' | 'vl_target' | 'rassemblement' | 'generic';

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
    /**
     * Position verrouillée (parité PC-Tac, `PlanPin.locked`) : bloque le drag
     * du marker (`draggable: !pin.locked`, cf. `_renderPins`). Basculé par
     * `_togglePinLock` (panels.ts). Absent = déverrouillé.
     */
    locked?: boolean | undefined;
    /**
     * Photo attachée (photo↔pin, parité PC-Tac `PlanPin.photoId`) : id d'une
     * image du formulaire OI (`img_…`, IndexedDB `OI_GeneratorLiteDB`/`images`,
     * valeur Blob). Orphelin toléré : nettoyé paresseusement par
     * `_openPinPhotoViewer` (panels.ts) si l'image n'existe plus. Absent = pas
     * de photo. Voyage dans `Store.state.formData.cartography.pins` (donc
     * présent dans le data.json d'archive → l'export d'images embarque l'id,
     * formulaires.ts `dataStr.includes`).
     */
    photoId?: string | undefined;
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
export type OiCartoDrawTool = 'line' | 'rectangle' | 'circle' | 'text' | 'measure';

/** État temporaire pendant un tracé (`_handleDrawDown`/`_handleDrawMove`, oi_cartographie.js:1442,1448). */
export interface OiCartoDrawState {
    start: LngLatTuple;
    current: LngLatTuple;
}

/** Type d'une forme persistée (oi_cartographie.js:1482-1486). `'text'` : hors littéral
 * d'origine — texte libre unifié dans le modèle shape (parité PC-Tac `PlanShapeType`,
 * cf. `carto/text.ts`), sélectionnable/déplaçable/supprimable via shape-edit comme les
 * autres formes, au lieu d'un bucket `cartography.texts` dédié non éditable. */
export type OiCartoShapeType = 'line' | 'rectangle' | 'circle' | 'text';
/**
 * Types de forme MESURE (paquet `oi-carto-measure`, hors littéral
 * `oi_cartographie.js` — introduit par ce chantier, parité PC-Tac
 * `@pctac/planmap/measure.ts`). Union séparée (pas fusionnée dans
 * `OiCartoShapeType` : `_setTool`/`draw.ts`, hors périmètre de ce paquet,
 * n'accepte que les 3 outils de tracé) — `OiCartoShape.type` accepte les deux
 * unions.
 */
export type OiCartoMeasureShapeType = 'measure' | 'measure-rings';

/** Une forme (dessin) persistée par `_saveShapes` (oi_cartographie.js:1482-1486). */
export interface OiCartoShape {
    id: string;
    type: OiCartoShapeType | OiCartoMeasureShapeType;
    color: string;
    /** Séquence de points `[lng, lat]` du tracé (segment, polygone rectangle fermé, ou approx. cercle). */
    coords: LngLatTuple[];
    /** `circle` uniquement : centre du tracé (oi_cartographie.js:1486). */
    center?: LngLatTuple | undefined;
    /** `circle` uniquement : point de bord ayant fixé le rayon (oi_cartographie.js:1486). */
    edge?: LngLatTuple | undefined;
    /**
     * `measure` uniquement : distance cumulée en mètres (parité PC-Tac
     * `PlanShape.totalM`, `@pctac/planmap/measure.ts`). Absent sur les autres
     * types.
     */
    totalM?: number | undefined;
    /**
     * `measure-rings` uniquement : anneaux d'engagement concentriques (parité
     * PC-Tac `PlanShape.rings`). `coords` reste requis (`[]` pour ce type,
     * cf. `carto/measure.ts` — `_renderShapes`/`draw.ts`, hors périmètre de
     * ce paquet, consomme `s.coords` inconditionnellement).
     */
    rings?: { radiusM: number; coords: LngLatTuple[] }[] | undefined;
    /** `text` uniquement : contenu de l'annotation libre (parité PC-Tac `PlanShape.text`). */
    text?: string | undefined;
    /** `text` uniquement : couleur du texte (distincte de `color`, parité PC-Tac `PlanShape.textColor`). */
    textColor?: string | undefined;
    /** `text` uniquement : taille de police en px, 9-72 (parité PC-Tac `PlanShape.fontSize`, poignée `textresize`). */
    fontSize?: number | undefined;
    /** Verrou par-forme (lu par `@shared/shape-gestures.js` — jamais posé côté OI, cf. `isLocked`/pas de toggle dédié). */
    locked?: boolean | undefined;
}

/** État en cours d'une mesure (mode togglable, non encore validée). */
export interface OiCartoMeasureState {
    vertices: LngLatTuple[];
    cursor: LngLatTuple | null;
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
    /** Overlay noms de rues actif (alignement fond de carte PC-Tac) — persisté avec la vue. */
    streetLabelsOn?: boolean | undefined;
    /** Overlay LiDAR HD actif (alignement PC-Tac) — persisté avec la vue. */
    lidarLayer?: OiCartoLidarLayerId | null | undefined;
    /** Fond topographique couleur Plan IGN v2 (alignement PC-Tac) — persisté avec la vue. */
    planIgnOn?: boolean | undefined;
    /** Overlay courbes de niveau (alignement PC-Tac) — persisté avec la vue. */
    contoursOn?: boolean | undefined;
}

/**
 * Overlay LiDAR HD sélectionné (alignement `@pctac/planmap/types.ts`,
 * `LidarLayerId`), hors littéral `oi_cartographie.js` — introduit par ce
 * chantier. `mnt` = sol nu, `mns` = sursol, `mnh` = hauteur de végétation.
 * Union structurellement identique (mais déclarée indépendamment, cf. en-tête
 * de fichier) à celle utilisée dans `constants.ts` (`LIDAR_LAYER_IDS`) — les
 * deux fichiers restent des feuilles, sans import croisé.
 */
export type OiCartoLidarLayerId = 'mnt' | 'mns' | 'mnh';

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
    /**
     * Overlay noms de rues (vectoriel OpenFreeMap) actif — alignement fond de
     * carte PC-Tac (hors littéral `oi_cartographie.js`, introduit par le port ;
     * jumeau de `PlanMapInternal.streetLabelsOn`). Persisté via la vue
     * (`OiCartoViewState.streetLabelsOn`), pas en localStorage : la SEULE
     * frontière de persistance de `carto/` est `Store.state.formData.cartography`.
     */
    streetLabelsOn: boolean;
    /**
     * Overlay LiDAR HD actif (hors littéral `oi_cartographie.js`, alignement
     * `@pctac/planmap/map-core.ts`) — `null` = aucun. Persisté avec la vue
     * (`OiCartoViewState.lidarLayer`), pas en localStorage : seule frontière
     * de persistance `carto/`.
     */
    lidarLayer: OiCartoLidarLayerId | null;
    /**
     * Fond topographique couleur Plan IGN v2 (hors littéral, alignement
     * PC-Tac). Persisté avec la vue (`OiCartoViewState.planIgnOn`).
     */
    planIgnOn: boolean;
    /**
     * Overlay courbes de niveau (hors littéral, alignement PC-Tac). Persisté
     * avec la vue (`OiCartoViewState.contoursOn`).
     */
    contoursOn: boolean;
    /**
     * Dernier type de pin posé par la roue de création (`_quickPlacePing`) —
     * proposé en « re-pose » rapide au sommet de la roue suivante (parité
     * quick-place PC-Tac). Jamais persisté (mémoire de session uniquement).
     */
    lastQuickPin: OiCartoPendingPin | null;
    /**
     * Horodatage de la dernière fermeture de roue (parité PC-Tac
     * `_wheelJustClosed`) : le clic carte qui FERME une roue ne doit pas en
     * rouvrir une autre dans la foulée (fenêtre 400 ms, cf. `_onMapClick`).
     */
    _wheelJustClosed: number;

    // --- champ ad hoc (jamais dans le littéral, cf. commentaire ci-dessus) ---
    _inlinePanelMove: (() => void) | null;

    /**
     * Câblage appui long effectué (garde du câblage paresseux depuis
     * `_renderPins` — le site propre serait `_bindUi`, map-core.ts, hors
     * périmètre de ce chantier). Optionnel comme `_captureBusy` : `undefined`
     * se comporte comme `false`.
     */
    _longPressWired?: boolean | undefined;

    /**
     * Verrou anti-concurrence de capture (mission R3-e, hors littéral
     * `oi_cartographie.js` — introduit par le port, aucune contrepartie
     * source directe). Porté de `PlanMapInternal._captureBusy`
     * (`@pctac/planmap/types.ts`, origine `planMap.js:55-56` : « une 2e
     * capture pendant la 1re snapshoterait les styles déjà aplatis/masqués
     * comme "originaux" et gèlerait l'UI au restore »). Consommé par
     * `_captureCanvas` (capture.ts). Optionnel (`?`) et non `false` par
     * défaut : `index.ts`/`state.ts` (hors périmètre de ce paquet, mission
     * R3-e limitée à `{pins,capture,types}.ts`) n'ont pas été touchés pour
     * l'initialiser dans `createOICartoState()` — `undefined` se comporte
     * comme `false` (garde `if (this._captureBusy) …`), même filet de
     * sécurité d'exhaustivité que `_inlinePanelMove` (cf. commentaire
     * `index.ts` sur ce même angle mort).
     */
    _captureBusy?: boolean | undefined;

    /** Enveloppe un handler : capture toute exception (log) — oi_cartographie.js:284-291. */
    _safe<A extends unknown[], R>(fn: (...args: A) => R, label?: string): (...args: A) => R | undefined;

    // --- Cycle de vie carte (map-core.ts) ---
    _init(): void; // :318

    // --- Persistance — Store.state.formData.cartography (state.ts) ---
    /**
     * Adapter de persistance carto (mission R3-c, décision D1, hors littéral
     * `oi_cartographie.js` — introduit par le port, aucune contrepartie
     * source). Posé par `createOICartoState()` (state.ts) avec un
     * `createStoreAdapter` enrobant `Store.state.formData.cartography` — SEUL
     * endroit où vivent les casts « ÉCART SIGNALÉ » pins/shapes (cf.
     * commentaire de tête de `state.ts`). Consommé par `_loadPins`/`_savePins`/
     * `_loadShapes`/`_saveShapes`/`_loadView`/`_saveView` ci-dessous.
     */
    persistence: MapPersistenceAdapter<OiCartoPin, OiCartoShape, OiCartoViewState>;
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

    // --- Roue de CRÉATION de pin au clic/appui long carte (pins.ts, parité
    // PC-Tac `_openCreatePingWheel`/`_quickPlacePing`/`_wireLongPressForPing`,
    // hors source oi_cartographie.js — introduit par ce chantier) ---
    _openCreatePinWheel(lngLat: LngLatObj): void;
    _quickPlacePing(lngLat: LngLatObj, pending: OiCartoPendingPin): void;
    /**
     * Panneau inline unifié « Ajouter entité » (parité PC-Tac `_openEntityPickerPanel`,
     * fusion des ex- `_openMemberPickerPanel`/`_openVehiclePickerPanel`) : membres
     * PATRACDVR (grisés si déjà placés), Cyno, véhicules (rame VL + VL target),
     * rassemblement.
     */
    _openEntityPickerPanel(lngLat: LngLatObj): void;
    /**
     * Panneau inline « Catalogue » (même emplacement/présentation que PC-Tac
     * `_openIconCatalogPanel`) : deux onglets — Génériques (`@shared/pin-icons.js`,
     * pin `kind: 'generic'`) et Personnalisés (pins métier OI : cyno, rame VL,
     * VL target, rassemblement).
     */
    _openIconCatalogPanel(lngLat: LngLatObj): void;
    _wireLongPressForPing(): void;

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
    // --- Parité roue d'options PC-Tac (hors source, introduit par ce chantier) ---
    /** Copie MGRS + GPS dans le presse-papier, toast de confirmation (@shared/coords + @shared/feedback). */
    _copyCoords(lng: number, lat: number): void;
    /** Verrouille/déverrouille la position d'un pin (bloque le drag) — parité PC-Tac `_togglePinLock`. */
    _togglePinLock(pinId: string, reopenWheel?: boolean): void;
    /** Panneau d'attache d'une photo du formulaire au pin (photo↔pin, parité PC-Tac `_openPinPhotoPanel`). */
    _openPinPhotoPanel(pinId: string): void;
    /** Viewer de la photo attachée : miniature + plein écran (PhotoSwipe) / changer / retirer (parité PC-Tac). */
    _openPinPhotoViewer(pinId: string): void;

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

    // --- Overlay noms de rues (map-core.ts, alignement PC-Tac, hors source) ---
    _ensureStreetLabelLayers(): boolean;
    _applyStreetLabelsVisibility(): void;
    _toggleStreetLabels(): void;

    // --- Overlays LiDAR HD (map-core.ts, alignement PC-Tac, hors source) ---
    _applyLidarVisibility(): void;
    _setLidarLayer(id: OiCartoLidarLayerId | null): void;
    _cycleLidarLayer(): void;
    _initLidar(): void;
    _updateLidarBtn(): void;

    // --- Fond topo couleur (Plan IGN v2) + courbes de niveau (map-core.ts,
    // alignement PC-Tac, hors source) ---
    _applyTopoVisibility(): void;
    _togglePlanIgn(): void;
    _toggleContours(): void;
    _initTopoLayers(): void;
    _updateTopoBtns(): void;

    // --- Relief 3D + bâtiments (map-core.ts) ---
    _toggle3D(): void; // :1609
    _enable3D(animate?: boolean): void; // :1614
    _disable3D(): void; // :1652

    // --- ÉDITION DE FORMES (shape-edit.ts, parité PC-Tac `shapes-gestures.ts`,
    // hors source oi_cartographie.js — introduit par ce chantier) ---
    /** Mode précision de tracé (mobile) : points posés au réticule central (parité PC-Tac `drawPrecisionMode`). */
    drawPrecisionMode: boolean;
    /** Slot unique d'état de geste en cours (drag/pinch/poignée) — lu par la machine partagée `@shared/shape-gestures.js`. */
    _gesture: ShapeGestureState<OiCartoShape> | null;
    /** Forme actuellement sélectionnée (poignées + toolbar visibles), sinon null. */
    _selectedShapeId: string | null;
    /** Markers MapLibre portant les poignées de la forme sélectionnée. */
    _handleMarkers: Marker[];
    /** Marker MapLibre portant la toolbar flottante (supprimer + couleur). */
    _shapeToolbarMarker: Marker | null;
    /** Listener touchstart posé pendant une sélection (pinch 2 doigts), sinon null. */
    _pinchListener: ((e: MapTouchEvent) => void) | null;
    /** Câble sélection/gestes/désélection (appelé par `_initDrawingLayers`, draw.ts). */
    _bindShapeEditGestures(): void;
    /** Entrée par couches formes : amorce tap/drag (parité PC-Tac `_shapePointerDown`). */
    _shapePointerDown(e: MapLayerMouseEvent | MapLayerTouchEvent): void;
    /** Machine tap/drag d'une forme — délègue à `startShapeDragGesture` (machine partagée). */
    _startShapeGesture(shapeId: string, startLngLat: LngLatObj): void;
    _selectShape(shapeId: string): void;
    _deselectShape(): void;
    _clearHandles(): void;
    _renderHandles(): void;
    _attachPinchListeners(): void;
    _detachPinchListeners(): void;
    _startPinchGesture(): void;
    /** Toolbar flottante minimale de la forme sélectionnée : supprimer + couleurs. */
    _renderShapeToolbar(): void;
    _clearShapeToolbar(): void;
    _updateShapeToolbarPos(): void;

    // --- MESURE — distance/azimut + anneaux d'engagement (measure.ts, parité
    // PC-Tac `@pctac/planmap/measure.ts`, hors littéral oi_cartographie.js —
    // introduit par ce chantier) ---
    /** État de la mesure en cours (`null` = mode mesure inactif). */
    _measureState: OiCartoMeasureState | null;
    /** HTML markers des étiquettes de la mesure en cours (preview live). */
    _measureLabelMarkers: Marker[];
    /** HTML markers des étiquettes des mesures/anneaux persistés. */
    _committedMeasureMarkers: Marker[];
    /** Barre flottante de contrôle (Annuler dernier / Terminer / Quitter). */
    _measureControls: HTMLDivElement | null;
    _measureUndoBtn: HTMLButtonElement | null;
    /** Bascule le mode mesure (parité PC-Tac `_startMeasure`/`_cancelMeasure`). */
    _toggleMeasure(): void;
    _measureAddVertex(lngLat: LngLatTuple): void;
    _measureUpdateCursor(lngLat: LngLatTuple): void;
    _renderMeasurePreview(): void;
    _renderMeasureLabels(pts: readonly LngLatTuple[], committed: boolean): void;
    _buildMeasureControls(): void;
    _updateMeasureControls(): void;
    _removeMeasureControls(): void;
    _measureUndoVertex(): void;
    _finishMeasure(): void;
    _cancelMeasure(): void;
    _clearMeasureState(): void;
    /** Pose des anneaux d'engagement concentriques (50/100/200 m) autour de `center` (défaut = centre de vue). */
    _addEngagementRings(center?: LngLatTuple): void;
    /** Étiquettes des mesures/anneaux persistés (rejouée à chaque `_renderShapes`, cf. rapport de câblage). */
    _renderCommittedMeasures(): void;
    /** Crée la source/couche GeoJSON dédiée à la preview de mesure (idempotent). Cf. rapport de câblage. */
    _initMeasureLayers(): void;

    // --- TEXTE LIBRE (text.ts, paquet `oi-carto-text`, hors source
    // oi_cartographie.js — port fonctionnel introduit par ce chantier,
    // cf. en-tête de `text.ts`). Depuis l'unification shape (parité PC-Tac
    // `text-modal.ts`) : le texte est une forme `type:'text'` persistée dans
    // `_loadShapes`/`_saveShapes`, sélectionnable/déplaçable/supprimable via
    // shape-edit comme les autres formes. `_loadTexts`/`_saveTexts` restent
    // pour lire/vider une seule fois l'ANCIEN bucket `cartography.texts`
    // (migration paresseuse, cf. `_migrateLegacyTexts`). ---
    /** Markers MapLibre des étiquettes de texte libre, indexés par shape id (dédié — pas `markers`, partagé pins/shapes). */
    textMarkers: Map<string, Marker>;
    /** Lecture de l'ANCIEN bucket `cartography.texts` (migration uniquement, cf. `_migrateLegacyTexts`). */
    _loadTexts(): OiCartoText[];
    /** Écriture de l'ANCIEN bucket `cartography.texts` (migration uniquement — vidé après migration). */
    _saveTexts(texts: readonly OiCartoText[]): void;
    /** Migre une fois pour toutes les anciennes étiquettes `cartography.texts` en shapes `type:'text'`. Idempotent (no-op si bucket vide). */
    _migrateLegacyTexts(): void;
    _startFreeText(lngLat: LngLatObj): Promise<void>;
    _editText(id: string): Promise<void>;
    _removeText(id: string): void;
    /** Rend les annotations texte libres (shapes `type:'text'`) — HTML markers nus, halo, PAS de cadre (parité PC-Tac `_renderShapeTexts`). */
    _renderShapeTexts(): void;
}

/**
 * Étiquette de texte libre — ANCIEN modèle (pré-unification shape), persisté
 * sous `Store.state.formData.cartography.texts`. Conservé uniquement pour
 * typer la migration paresseuse d'archives existantes vers `OiCartoShape`
 * (`type:'text'`, cf. `_migrateLegacyTexts`) — plus jamais écrit par la pose
 * (`_startFreeText`).
 */
export interface OiCartoText {
    id: string;
    lng: number;
    lat: number;
    text: string;
    color: string;
}
