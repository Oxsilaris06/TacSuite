/**
 * map-overlays.ts — Surcouches communes à la carto de l'OI et au plan de PC-Tac :
 * carroyage tactique, grille MGRS, lignes électriques (décisions Nico
 * 2026-09-24, DevSYNCState §3 n° 13 et 14).
 *
 * Un contrôleur par carte MapLibre. Il ajoute ses sources et couches (préfixe
 * `tac-`), les tient à jour au déplacement, gère le tracé du carroyage (deux
 * appuis pour deux coins opposés, aperçu entre les deux), et construit ses
 * rangées d'interrupteurs dans le panneau « Surimpressions » de l'application
 * hôte (`mountOverlayControls`). Chaque application ne fournit que la
 * persistance (PC-Tac : par situation ; OI : dans `formData.cartography`).
 *
 * Tout ce qui calcule est pur et testé ailleurs (`tactical-grid.ts`,
 * `power-lines.ts`) ; ce fichier ne fait que brancher MapLibre.
 */
import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import {
    GRID_CELL_SIZES,
    GRID_COLORS,
    GRID_DEFAULT_CELL,
    GRID_DEFAULT_COLOR,
    GRID_DEFAULT_LABEL_SIZE,
    GRID_LABEL_SIZES,
    gridCellAt,
    gridColor,
    gridLabelSize,
    gridToGeo,
    isTacticalGridSpec,
    makeOrientedGrid,
    mgrsGridGeometry,
    mgrsOf,
    orientedGridFromCorners,
    rotateTacticalGrid,
    tacticalGridGeometry,
    type GridColor,
    type GridLabelSize,
    type LngLat,
    type TacticalGridSpec,
} from '@shared/tactical-grid.js';
import { loadPowerLines, POWER_MIN_ZOOM, tilesFor } from '@shared/power-lines.js';

export interface OverlayState {
    gridOn: boolean;
    mgrsOn: boolean;
    powerOn: boolean;
    grid: TacticalGridSpec | null;
    cellM: number;
}

export type OverlayToastKind = 'info' | 'success' | 'error';

export interface OverlayOptions {
    load(): Partial<OverlayState> | null | undefined;
    save(state: OverlayState): void;
    toast?(message: string, kind?: OverlayToastKind): void;
    confirm?(message: string): Promise<boolean>;
}

export type PowerStatus = 'off' | 'zoom' | 'loading' | 'ok' | 'partial' | 'error';

export interface MapOverlays {
    readonly state: Readonly<OverlayState>;
    /** Vrai pendant le tracé du carroyage : l'hôte ignore alors ses propres clics carte. */
    isCapturing(): boolean;
    setGridOn(on: boolean): void;
    setMgrsOn(on: boolean): void;
    setPowerOn(on: boolean): void;
    setCellSize(m: number): Promise<boolean>;
    /** Couleur du carroyage (lignes, étiquettes, aperçu) ; gardée dans le spec. */
    setGridColor(c: GridColor): void;
    /** Taille des lettres et numéros (4 crans) ; gardée dans le spec. */
    setGridLabelSize(s: GridLabelSize): void;
    startGridDraw(): Promise<void>;
    /** Pose d'un seul geste un carroyage centré sur la vue (60 % de l'écran) : l'option commode au doigt. */
    placeGridOnView(): Promise<void>;
    startGridMove(): void;
    /** Affiche une poignée pour tourner le carroyage autour de son centre (décision 39). */
    startGridRotate(): Promise<void>;
    /** Remet le carroyage au nord (angle 0) autour de son centre. */
    gridNorthUp(): void;
    clearGrid(): Promise<void>;
    cancelCapture(): void;
    /** Case du carroyage (« C4 ») d'un point, `null` hors carroyage ou sans carroyage. */
    cellAt(lng: number, lat: number): string | null;
    /** Coordonnée MGRS lisible d'un point. */
    mgrsAt(lng: number, lat: number): string | null;
    onChange(listener: () => void): void;
    powerStatus(): PowerStatus;
    /** `true` si la grille MGRS est active mais trop dense pour l'emprise (zoomer). */
    mgrsNeedsZoom(): boolean;
    /** Relit l'état persisté (import d'archive, passerelle OI) et repeint. */
    reload(): void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const GRID_HALO = '#0b0d12';
const MGRS_COLOR = '#7fdcff';
// BT en blanc cassé : le gris d'origine se perdait sur l'orthophoto.
const POWER_COLORS: Record<string, string> = { tht: '#e53935', ht: '#fb8c00', hta: '#fdd835', bt: '#e6e6e6' };

/** Point d'un geste : coordonnées carte et position à l'écran (px). */
type ScreenPoint = { at: LngLat; x: number; y: number };

const BOLT_IMAGE = 'tac-power-bolt';

/**
 * Éclair dessiné sur un canevas (aucune image externe), déclaré en SDF pour
 * être teinté par tension (`icon-color`) avec un halo noir. `false` sans
 * canevas 2D (tests) : la couche d'éclairs est alors simplement omise.
 */
function addBoltImage(map: MapLibreMap): boolean {
    if (map.hasImage(BOLT_IMAGE)) return true;
    try {
        const size = 32;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return false;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(19, 2);
        ctx.lineTo(6, 18);
        ctx.lineTo(15, 18);
        ctx.lineTo(12, 30);
        ctx.lineTo(26, 13);
        ctx.lineTo(17, 13);
        ctx.lineTo(21, 2);
        ctx.closePath();
        ctx.fill();
        map.addImage(BOLT_IMAGE, ctx.getImageData(0, 0, size, size), { sdf: true, pixelRatio: 2 });
        return true;
    } catch {
        return false;
    }
}

function src(map: MapLibreMap, id: string): GeoJSONSource | undefined {
    return map.getSource(id) as GeoJSONSource | undefined;
}

function sanitize(raw: Partial<OverlayState> | null | undefined): OverlayState {
    const cell = Number(raw?.cellM);
    return {
        gridOn: !!raw?.gridOn,
        mgrsOn: !!raw?.mgrsOn,
        powerOn: !!raw?.powerOn,
        grid: isTacticalGridSpec(raw?.grid) ? raw!.grid! : null,
        cellM: (GRID_CELL_SIZES as readonly number[]).includes(cell) ? cell : GRID_DEFAULT_CELL,
    };
}

/**
 * Couches des surcouches, dans l'ordre d'empilement (les lignes électriques
 * sous les grilles). Exportées pour être VALIDÉES par le validateur de style
 * officiel de MapLibre (test) : deux expressions refusées à l'exécution
 * (`line-dasharray`, puis `symbol-spacing`) avaient échappé aux tests.
 */
export function overlayLayers(withBolt: boolean): LayerSpecification[] {
    return [
        {
            id: 'tac-power-casing', type: 'line', source: 'tac-power',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#000000', 'line-width': ['match', ['get', 'cls'], 'tht', 5.5, 'ht', 4.5, 'hta', 3.5, 3], 'line-opacity': 0.75 },
        },
        {
            id: 'tac-power-line', type: 'line', source: 'tac-power',
            filter: ['!=', ['get', 'cls'], 'bt'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': ['match', ['get', 'cls'], 'tht', POWER_COLORS.tht!, 'ht', POWER_COLORS.ht!, POWER_COLORS.hta!],
                'line-width': ['match', ['get', 'cls'], 'tht', 2.5, 'ht', 2, 1.5],
            },
        },
        {
            id: 'tac-power-line-bt', type: 'line', source: 'tac-power',
            filter: ['==', ['get', 'cls'], 'bt'],
            paint: { 'line-color': POWER_COLORS.bt!, 'line-width': 1.5, 'line-dasharray': [3, 2] },
        },
        // Éclairs le long des lignes : couche décorative, omise sans canevas 2D.
        ...(withBolt ? [{
            id: 'tac-power-bolt', type: 'symbol', source: 'tac-power',
            layout: {
                'symbol-placement': 'line',
                'symbol-spacing': 180,
                'icon-image': BOLT_IMAGE,
                'icon-size': ['match', ['get', 'cls'], 'tht', 1, 'ht', 0.9, 'hta', 0.8, 0.7],
                'icon-rotation-alignment': 'viewport',
                'icon-padding': 4,
            },
            paint: {
                'icon-color': ['match', ['get', 'cls'], 'tht', POWER_COLORS.tht!, 'ht', POWER_COLORS.ht!, 'hta', POWER_COLORS.hta!, POWER_COLORS.bt!],
                'icon-halo-color': '#000000',
                'icon-halo-width': 1.5,
            },
        }] : []),
        {
            id: 'tac-power-tower', type: 'circle', source: 'tac-power-towers', minzoom: 14,
            paint: { 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#000000', 'circle-stroke-width': 2 },
        },
        {
            id: 'tac-power-label', type: 'symbol', source: 'tac-power', minzoom: 15,
            filter: ['!=', ['get', 'label'], ''],
            layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11 },
            paint: { 'text-color': '#ffffff', 'text-halo-color': GRID_HALO, 'text-halo-width': 1.5 },
        },
        {
            id: 'tac-mgrs-casing', type: 'line', source: 'tac-mgrs',
            paint: { 'line-color': GRID_HALO, 'line-width': ['match', ['get', 'kind'], 'km', 3.2, 2.4], 'line-opacity': 0.45 },
        },
        {
            id: 'tac-mgrs-line', type: 'line', source: 'tac-mgrs',
            paint: { 'line-color': MGRS_COLOR, 'line-width': ['match', ['get', 'kind'], 'km', 1.6, 1.1], 'line-dasharray': [4, 3], 'line-opacity': 0.95 },
        },
        {
            id: 'tac-mgrs-label', type: 'symbol', source: 'tac-mgrs-labels',
            layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'bottom-left', 'text-offset': [0.2, -0.1], 'text-allow-overlap': false },
            paint: { 'text-color': MGRS_COLOR, 'text-halo-color': GRID_HALO, 'text-halo-width': 1.5 },
        },
        {
            // Liseré sombre : rend la couleur choisie lisible sur photo
            // aérienne comme sur plan clair (décision 39, G4).
            id: 'tac-grid-casing', type: 'line', source: 'tac-grid',
            paint: { 'line-color': GRID_HALO, 'line-width': ['match', ['get', 'kind'], 'edge', 4.2, 2.6], 'line-opacity': 0.7 },
        },
        {
            id: 'tac-grid-line', type: 'line', source: 'tac-grid',
            paint: { 'line-color': GRID_COLORS[GRID_DEFAULT_COLOR], 'line-width': ['match', ['get', 'kind'], 'edge', 2.5, 1.2], 'line-opacity': 0.95 },
        },
        {
            id: 'tac-grid-label', type: 'symbol', source: 'tac-grid-labels',
            // Le nom suit les axes du carroyage (rotation posée par la géométrie)
            // sans se lire à l'envers.
            layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': GRID_LABEL_SIZES[GRID_DEFAULT_LABEL_SIZE], 'text-allow-overlap': true, 'text-rotation-alignment': 'map', 'text-rotate': ['get', 'rotation'] },
            paint: { 'text-color': GRID_COLORS[GRID_DEFAULT_COLOR], 'text-halo-color': GRID_HALO, 'text-halo-width': 2 },
        },
        {
            id: 'tac-grid-preview-casing', type: 'line', source: 'tac-grid-preview',
            paint: { 'line-color': GRID_HALO, 'line-width': 4, 'line-opacity': 0.6 },
        },
        {
            id: 'tac-grid-preview-line', type: 'line', source: 'tac-grid-preview',
            paint: { 'line-color': GRID_COLORS[GRID_DEFAULT_COLOR], 'line-width': 2, 'line-dasharray': [2, 2] },
        },
    ] as LayerSpecification[];
}

/** Sources GeoJSON des surcouches. */
export const OVERLAY_SOURCES = ['tac-grid', 'tac-grid-labels', 'tac-grid-preview', 'tac-mgrs', 'tac-mgrs-labels', 'tac-power', 'tac-power-towers'] as const;

/** Aimant de la rotation (degrés) : le nord tombe pile, comme pour un tracé. */
export const GRID_ROTATE_SNAP = 5;

/** Distance en pixels entre le centre du carroyage et sa poignée de rotation. */
const ROTATE_HANDLE_PX = 90;

/**
 * Angle de carroyage (degrés depuis le nord, sens horaire) désigné par un
 * pointeur à l'écran. `center` et `pointer` sont en pixels du canevas ; l'angle
 * tient compte de l'orientation de la carte (`bearing`).
 */
export function gridAngleFromScreen(bearing: number, center: { x: number; y: number }, pointer: { x: number; y: number }): number {
    const deg = (Math.atan2(pointer.x - center.x, -(pointer.y - center.y)) * 180) / Math.PI;
    return ((deg + bearing) % 360 + 360) % 360;
}

/** Cale un angle sur le pas d'aimant (5° par défaut), dans [0, 360). */
export function snapGridAngle(angle: number, step = GRID_ROTATE_SNAP): number {
    const a = Math.round(angle / step) * step;
    return ((a % 360) + 360) % 360;
}

export function createMapOverlays(map: MapLibreMap, opts: OverlayOptions): MapOverlays {
    const state = sanitize(opts.load());
    // Interrupteur « Carroyage » actif sans carroyage (reset de situation,
    // tracé abandonné) : on le relit éteint plutôt qu'« À tracer » à vide.
    if (!state.grid) state.gridOn = false;
    let mgrsZoom = false;
    const listeners = new Set<() => void>();
    // Tracé du carroyage : `press` = appui en cours (glisser d'un coin à l'autre),
    // `first` = premier coin posé par un simple toucher (tracé en deux touchers).
    let capture: null | { mode: 'draw' | 'move'; first?: ScreenPoint; press?: ScreenPoint | undefined; last?: ScreenPoint | undefined } = null;
    // Le `click` qui suit le relâchement du doigt appartient encore au tracé :
    // l'hôte (pings, formes) doit l'ignorer quelques instants.
    let swallowUntil = 0;
    let dragPanWasOn = false;
    let power: PowerStatus = 'off';
    let powerSeq = 0;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    let ready = false;
    // Rotation en cours : poignée posée sur la carte, geste suspendu, angle
    // appliqué en direct mais enregistré seulement au relâcher (décision 39).
    let rotate: null | {
        marker: { setLngLat(ll: { lng: number; lat: number }): unknown; remove(): void };
        el: HTMLElement;
        label: HTMLElement;
        original: TacticalGridSpec;
        centerGeo: LngLat;
        centerPx: { x: number; y: number };
        dirty: boolean;
    } = null;
    let rotateCleanup: (() => void) | null = null;
    let rotateDragWasOn = true;
    let rotateActive = false;

    const toast = (m: string, k: OverlayToastKind = 'info'): void => opts.toast?.(m, k);
    const changed = (): void => {
        opts.save({ ...state });
        listeners.forEach((l) => { try { l(); } catch { /* un écouteur ne bloque pas la carte */ } });
    };

    function addLayers(): void {
        if (map.getSource('tac-grid')) return;
        for (const id of OVERLAY_SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY });
        // Chaque couche séparément : une couche refusée (style, navigateur) ne
        // doit jamais empêcher les suivantes — carroyage et MGRS compris.
        for (const layer of overlayLayers(addBoltImage(map))) {
            try {
                map.addLayer(layer);
            } catch (e) {
                console.warn(`[carte] couche ${layer.id} non ajoutée :`, e);
            }
        }
        ready = true;
        renderAll();
    }

    function renderGrid(): void {
        if (!ready) return;
        const g = state.gridOn && state.grid ? tacticalGridGeometry(state.grid) : null;
        src(map, 'tac-grid')?.setData(g ? g.lines : EMPTY);
        src(map, 'tac-grid-labels')?.setData(g ? g.labels : EMPTY);
        // Couleur et taille choisies (décision 39, G4) : elles s'appliquent aux
        // lignes, aux étiquettes et à l'aperçu, liseré sombre compris.
        const color = GRID_COLORS[state.grid ? gridColor(state.grid) : GRID_DEFAULT_COLOR];
        const size = GRID_LABEL_SIZES[state.grid ? gridLabelSize(state.grid) : GRID_DEFAULT_LABEL_SIZE];
        try {
            map.setPaintProperty('tac-grid-line', 'line-color', color);
            map.setPaintProperty('tac-grid-label', 'text-color', color);
            map.setPaintProperty('tac-grid-preview-line', 'line-color', color);
            map.setLayoutProperty('tac-grid-label', 'text-size', size);
        } catch { /* couches pas encore posées : rien à teinter */ }
    }

    function renderMgrs(): void {
        if (!ready) return;
        const z = map.getZoom();
        const step = z >= 15 ? 100 : z >= 11 ? 1000 : null;
        const b = map.getBounds();
        const g = state.mgrsOn && step ? mgrsGridGeometry({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, step) : null;
        src(map, 'tac-mgrs')?.setData(g ? g.lines : EMPTY);
        src(map, 'tac-mgrs-labels')?.setData(g ? g.labels : EMPTY);
        // Active mais non tracée (zoom trop large, ou trop dense pour un grand
        // écran) : l'interface le dit au lieu de laisser croire à une panne.
        const needsZoom = state.mgrsOn && !g;
        if (needsZoom !== mgrsZoom) { mgrsZoom = needsZoom; notifyStatus(); }
    }

    async function renderPower(): Promise<void> {
        if (!ready) return;
        const seq = ++powerSeq;
        if (!state.powerOn) {
            power = 'off';
            src(map, 'tac-power')?.setData(EMPTY);
            src(map, 'tac-power-towers')?.setData(EMPTY);
            notifyStatus();
            return;
        }
        if (map.getZoom() < POWER_MIN_ZOOM) {
            power = 'zoom';
            notifyStatus();
            return; // on garde ce qui est affiché : dézoomer ne l'efface pas
        }
        const b = map.getBounds();
        const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
        // Emprise trop grande pour la couche (grand écran au zoom 13) : « zoomez »,
        // pas « indisponible ».
        if (tilesFor(bounds) === null) {
            power = 'zoom';
            notifyStatus();
            return;
        }
        power = 'loading';
        notifyStatus();
        // Affichage progressif : chaque bloc arrivé est montré tout de suite.
        const r = await loadPowerLines(bounds, fetch, (partial) => {
            if (seq !== powerSeq) return;
            src(map, 'tac-power')?.setData(partial.lines);
            src(map, 'tac-power-towers')?.setData(partial.towers);
        }).catch(() => null);
        if (seq !== powerSeq) return; // une requête plus récente a pris la main
        if (!r) { power = 'error'; notifyStatus(); return; }
        src(map, 'tac-power')?.setData(r.lines);
        src(map, 'tac-power-towers')?.setData(r.towers);
        power = r.missing === 0 ? 'ok' : r.lines.features.length ? 'partial' : 'error';
        notifyStatus();
    }

    function notifyStatus(): void {
        listeners.forEach((l) => { try { l(); } catch { /* idem */ } });
    }

    function renderAll(): void {
        renderGrid();
        renderMgrs();
        void renderPower();
    }

    const toLngLat = (p: { lng: number; lat: number }): LngLat => [p.lng, p.lat];

    /**
     * Aperçu du rectangle À L'ÉCRAN : on reprojette les quatre coins de la
     * boîte englobante des deux appuis, si bien que le pointillé suit
     * exactement le doigt, même sur une carte tournée.
     */
    function setPreviewScreen(p: ScreenPoint, q: ScreenPoint): void {
        const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
        const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
        const ring: LngLat[] = [
            toLngLat(map.unproject([x0, y0])),
            toLngLat(map.unproject([x1, y0])),
            toLngLat(map.unproject([x1, y1])),
            toLngLat(map.unproject([x0, y1])),
            toLngLat(map.unproject([x0, y0])),
        ];
        src(map, 'tac-grid-preview')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } }] });
    }

    function beginCapture(mode: 'draw' | 'move'): void {
        if (rotate) endRotate();
        capture = { mode };
        // Au doigt, glisser déplaçait la carte au lieu de tracer (retour Nico
        // 2026-09-24) : le déplacement à un doigt est suspendu pendant le tracé.
        // Le pincement (zoom à deux doigts) reste actif.
        dragPanWasOn = map.dragPan.isEnabled();
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'crosshair';
        notifyStatus();
    }

    function endCapture(): void {
        capture = null;
        src(map, 'tac-grid-preview')?.setData(EMPTY);
        map.getCanvas().style.cursor = '';
        if (dragPanWasOn) map.dragPan.enable();
        dragPanWasOn = false;
        notifyStatus();
    }

    /**
     * Pose le carroyage depuis deux appuis ÉCRAN : A1 au coin haut-gauche de
     * la boîte englobante, colonnes et rangées tirées de ses dimensions, angle
     * = orientation de la carte au moment du tracé (décision 39).
     */
    function commitGridFromScreen(p: ScreenPoint, q: ScreenPoint): void {
        const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
        const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
        const tl = toLngLat(map.unproject([x0, y0]));
        const tr = toLngLat(map.unproject([x1, y0]));
        const bl = toLngLat(map.unproject([x0, y1]));
        const { spec, clamped } = orientedGridFromCorners(tl, tr, bl, state.cellM, map.getBearing());
        state.grid = spec;
        state.gridOn = true;
        endCapture();
        renderGrid();
        changed();
        toast(
            clamped
                ? `Carroyage borné à ${spec.cols} × ${spec.rows} cases : zone trop grande pour une maille de ${spec.cellM} m.`
                : `Carroyage posé : ${spec.cols} × ${spec.rows} cases de ${spec.cellM} m.`,
            clamped ? 'info' : 'success',
        );
    }

    type RotateMarkerCtor = new (opts: { element: HTMLElement; anchor: string }) => {
        setLngLat(ll: { lng: number; lat: number }): { addTo(m: MapLibreMap): unknown };
        addTo(m: MapLibreMap): unknown;
        remove(): void;
    };

    /** Positionne la poignée sur l'axe « haut » du carroyage, à distance fixe du centre. */
    function placeRotateHandle(): void {
        if (!rotate || !state.grid) return;
        const phi = (((state.grid.angle ?? 0) - map.getBearing()) * Math.PI) / 180;
        const hx = rotate.centerPx.x + ROTATE_HANDLE_PX * Math.sin(phi);
        const hy = rotate.centerPx.y - ROTATE_HANDLE_PX * Math.cos(phi);
        rotate.marker.setLngLat(map.unproject([hx, hy]));
        rotate.label.textContent = `${Math.round(state.grid.angle ?? 0)}°`;
    }

    function endRotate(): void {
        if (!rotate) return;
        rotateCleanup?.();
        rotateCleanup = null;
        rotateActive = false;
        rotate.marker.remove();
        rotate = null;
        map.getCanvas().style.cursor = '';
        if (rotateDragWasOn) map.dragPan.enable();
        notifyStatus();
    }

    function rotationPointerPx(e: MouseEvent | TouchEvent): { x: number; y: number } {
        const r = map.getCanvas().getBoundingClientRect();
        const t = 'touches' in e ? e.touches[0] : e;
        return { x: (t?.clientX ?? 0) - r.left, y: (t?.clientY ?? 0) - r.top };
    }

    /** Geste de la poignée : glisser fait tourner autour du centre, en direct, aimanté au 5°. */
    function beginRotateGesture(): void {
        if (!rotate) return;
        const el = rotate.el;
        const onDown = (ev: MouseEvent | TouchEvent): void => {
            ev.preventDefault();
            ev.stopPropagation();
            rotateActive = true;
            map.getCanvas().style.cursor = 'grabbing';
        };
        const onMove = (ev: MouseEvent | TouchEvent): void => {
            if (!rotate || !rotateActive) return;
            ev.preventDefault();
            const p = rotationPointerPx(ev);
            const angle = snapGridAngle(gridAngleFromScreen(map.getBearing(), rotate.centerPx, p));
            state.grid = rotateTacticalGrid(rotate.original, angle);
            rotate.dirty = true;
            renderGrid();
            placeRotateHandle();
        };
        const onUp = (): void => {
            if (!rotate || !rotateActive) return;
            const angle = state.grid ? (state.grid.angle ?? 0) : 0;
            const dirty = rotate.dirty;
            endRotate();
            if (dirty) {
                changed();
                toast(`Carroyage orienté à ${Math.round(angle)}°.`, 'success');
            }
        };
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('touchstart', onDown, { passive: false });
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
        rotateCleanup = () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('touchstart', onDown);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.removeEventListener('touchcancel', onUp);
        };
    }

    /** Point d'un évènement souris ou tactile ; `null` pour un geste à plusieurs doigts (pincement). */
    const pointOf = (e: MapMouseEvent | MapTouchEvent): ScreenPoint | null => {
        if ('points' in e && Array.isArray(e.points) && e.points.length > 1) return null;
        if (!Number.isFinite(e.lngLat?.lng) || !Number.isFinite(e.lngLat?.lat)) return null;
        return { at: [e.lngLat.lng, e.lngLat.lat], x: e.point.x, y: e.point.y };
    };
    const TAP_SLOP_PX = 12; // en deçà, un appui est un toucher, pas un glisser

    const onDown = (e: MapMouseEvent | MapTouchEvent): void => {
        if (!capture) return;
        const p = pointOf(e);
        if (!p) { capture.press = undefined; return; } // pincement : on laisse zoomer
        capture.press = p;
        capture.last = p;
    };
    const onMove = (e: MapMouseEvent | MapTouchEvent): void => {
        if (!capture || capture.mode !== 'draw') return;
        const p = pointOf(e);
        if (!p) return;
        if (capture.press) {
            capture.last = p;
            setPreviewScreen(capture.press, p);
        } else if (capture.first) {
            setPreviewScreen(capture.first, p); // souris : aperçu entre les deux clics
        }
    };
    const onUp = (): void => {
        if (!capture || !capture.press) return;
        const { press } = capture;
        const last = capture.last ?? press;
        capture.press = undefined;
        swallowUntil = Date.now() + 500;
        const moved = Math.hypot(last.x - press.x, last.y - press.y) > TAP_SLOP_PX;
        if (capture.mode === 'move') {
            if (moved || !state.grid) return;
            state.grid = { ...state.grid, west: press.at[0], north: press.at[1] };
            endCapture();
            renderGrid();
            changed();
            toast('Carroyage déplacé : A1 est maintenant au point touché.', 'success');
            return;
        }
        if (moved) { commitGridFromScreen(press, last); return; }
        if (!capture.first) {
            capture.first = press;
            setPreviewScreen(press, press);
            toast('Touchez le coin opposé (ou glissez d’un coin à l’autre).');
            return;
        }
        commitGridFromScreen(capture.first, press);
    };
    map.on('mousedown', onDown);
    map.on('touchstart', onDown);
    map.on('mousemove', onMove);
    map.on('touchmove', onMove);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    map.on('touchcancel', () => { if (capture) capture.press = undefined; });
    map.on('moveend', () => {
        if (moveTimer !== null) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => { moveTimer = null; renderMgrs(); void renderPower(); }, 350);
    });
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        if (rotate) {
            const original = rotate.original;
            endRotate();
            state.grid = original;
            renderGrid();
            toast('Rotation du carroyage annulée.');
            return;
        }
        if (capture) { endCapture(); toast('Tracé du carroyage annulé.'); }
    };
    document.addEventListener('keydown', onKey);

    if (map.loaded()) addLayers();
    else map.on('load', addLayers);

    const api: MapOverlays = {
        get state() { return state; },
        isCapturing: () => capture !== null || rotate !== null || Date.now() < swallowUntil,
        setGridOn(on) {
            state.gridOn = on;
            renderGrid();
            changed();
            if (on && !state.grid) void api.startGridDraw();
        },
        setMgrsOn(on) {
            state.mgrsOn = on;
            renderMgrs();
            changed();
            if (on && map.getZoom() < 11) toast('Grille MGRS : zoomez pour l’afficher (1 km, puis 100 m de près).');
        },
        setPowerOn(on) {
            state.powerOn = on;
            changed();
            void renderPower();
        },
        async setCellSize(m) {
            if (!(GRID_CELL_SIZES as readonly number[]).includes(m) || m === state.cellM) return false;
            // Un carroyage posé change de maille : toutes les cases changent de
            // nom (« C4 » ne désigne plus le même endroit) — même confirmation
            // que « Tracer ».
            if (state.grid && opts.confirm && !(await opts.confirm(`Passer la maille à ${m} m ? Toutes les cases changent de nom.`))) return false;
            state.cellM = m;
            // Même emprise, nouvelle maille : on repart du coin A1 existant, en
            // CONSERVANT l'angle (décision 39).
            if (state.grid) {
                const g = state.grid;
                const { spec, clamped } = makeOrientedGrid([g.west, g.north], g.cols * g.cellM, g.rows * g.cellM, m, g.angle ?? 0);
                state.grid = spec;
                renderGrid();
                if (clamped) toast(`Carroyage borné à ${spec.cols} × ${spec.rows} cases : l'emprise d'origine est trop grande pour une maille de ${m} m.`);
            }
            changed();
            return true;
        },
        setGridColor(c) {
            if (!state.grid || !(c in GRID_COLORS) || gridColor(state.grid) === c) return;
            state.grid = { ...state.grid, color: c };
            renderGrid();
            changed();
        },
        setGridLabelSize(s) {
            if (!state.grid || !(s in GRID_LABEL_SIZES) || gridLabelSize(state.grid) === s) return;
            state.grid = { ...state.grid, labelSize: s };
            renderGrid();
            changed();
        },
        async startGridDraw() {
            if (state.grid && opts.confirm && !(await opts.confirm('Remplacer le carroyage actuel ? Les cases annoncées jusqu’ici changeront de place.'))) return;
            beginCapture('draw');
            toast('Carroyage : glissez d’un coin à l’autre, ou touchez deux coins opposés (Échap pour annuler).');
        },
        async placeGridOnView() {
            if (state.grid && opts.confirm && !(await opts.confirm('Remplacer le carroyage actuel ? Les cases annoncées jusqu’ici changeront de place.'))) return;
            // 60 % central de l'écran, en pixels : juste sous les yeux, quel que
            // soit le zoom ou l'orientation de la carte (le carroyage prend
            // l'orientation de l'écran, décision 39).
            const c = map.getCanvas();
            const w = c.clientWidth || c.width, h = c.clientHeight || c.height;
            const nw = map.unproject([w * 0.2, h * 0.2]);
            const se = map.unproject([w * 0.8, h * 0.8]);
            commitGridFromScreen({ at: toLngLat(nw), x: w * 0.2, y: h * 0.2 }, { at: toLngLat(se), x: w * 0.8, y: h * 0.8 });
        },
        startGridMove() {
            if (!state.grid) return;
            beginCapture('move');
            toast('Touchez le nouvel emplacement du coin A1 (Échap pour annuler).');
        },
        async startGridRotate() {
            if (!state.grid || rotate) return;
            const g = state.grid;
            const centerGeo = gridToGeo(g, g.cols / 2, g.rows / 2);
            const el = document.createElement('div');
            el.className = 'tac-grid-rotate-handle';
            el.setAttribute('role', 'slider');
            el.setAttribute('aria-label', 'Tourner le carroyage');
            el.style.cssText = 'width:44px;height:44px;border-radius:50%;background:rgba(11,13,18,0.85);border:2px solid #fff;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;box-shadow:0 1px 6px rgba(0,0,0,0.5);font:600 11px Inter,system-ui,sans-serif;';
            const icon = document.createElement('span');
            icon.textContent = '⟳';
            icon.style.cssText = 'font-size:18px;line-height:1;';
            const label = document.createElement('span');
            label.className = 'tac-grid-rotate-deg';
            el.append(icon, label);
            let MarkerCtor: RotateMarkerCtor | undefined;
            try {
                const mod = (await import('maplibre-gl')) as { Marker?: RotateMarkerCtor; default?: { Marker?: RotateMarkerCtor } };
                MarkerCtor = mod.Marker ?? mod.default?.Marker;
            } catch {
                MarkerCtor = undefined;
            }
            if (!MarkerCtor) { toast('Rotation du carroyage indisponible sur cette carte.', 'error'); return; }
            const marker = new MarkerCtor({ element: el, anchor: 'center' });
            marker.setLngLat({ lng: centerGeo[0], lat: centerGeo[1] }).addTo(map);
            rotate = {
                marker: marker as unknown as { setLngLat(ll: { lng: number; lat: number }): unknown; remove(): void },
                el,
                label,
                original: g,
                centerGeo,
                centerPx: map.project({ lng: centerGeo[0], lat: centerGeo[1] }),
                dirty: false,
            };
            rotateDragWasOn = map.dragPan.isEnabled();
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grab';
            placeRotateHandle();
            beginRotateGesture();
            notifyStatus();
            toast('Glissez la poignée pour tourner le carroyage (Échap pour annuler).');
        },
        gridNorthUp() {
            if (!state.grid) return;
            if (rotate) endRotate();
            state.grid = rotateTacticalGrid(state.grid, 0);
            renderGrid();
            changed();
            toast('Carroyage remis au nord.', 'success');
        },
        async clearGrid() {
            if (!state.grid) return;
            if (opts.confirm && !(await opts.confirm('Effacer le carroyage ?'))) return;
            state.grid = null;
            state.gridOn = false;
            renderGrid();
            changed();
        },
        cancelCapture: endCapture,
        cellAt: (lng, lat) => (state.grid ? gridCellAt(state.grid, lng, lat) : null),
        mgrsAt: (lng, lat) => mgrsOf(lng, lat),
        onChange: (l) => { listeners.add(l); },
        powerStatus: () => power,
        mgrsNeedsZoom: () => mgrsZoom,
        reload() {
            Object.assign(state, sanitize(opts.load()));
            renderAll();
            notifyStatus();
        },
    };
    return api;
}

// ─── Interrupteurs dans le panneau « Surimpressions » de l'hôte ─────────────

export interface OverlayControlClasses {
    row: string;
    fab: string;
    label: string;
}

const GRID_COLOR_LABELS: Record<GridColor, string> = { yellow: 'Jaune', orange: 'Orange', magenta: 'Magenta', white: 'Blanc' };
const GRID_SIZE_LABELS: Record<GridLabelSize, string> = { small: 'Petit', medium: 'Moyen', large: 'Grand', xlarge: 'Très grand' };

const POWER_STATUS_TEXT: Record<PowerStatus, string> = {
    off: 'RTE (OSM) · HTA et BT (Enedis)',
    zoom: 'Zoomez pour les afficher',
    loading: 'Chargement…',
    ok: 'RTE (OSM) · HTA et BT (Enedis)',
    partial: 'Zone en partie indisponible',
    error: 'Lignes indisponibles',
};

function fab(cls: string, icon: string, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.title = label;
    b.setAttribute('aria-label', label);
    const i = document.createElement('span');
    i.className = 'material-symbols-outlined';
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    b.appendChild(i);
    return b;
}

/** Construit les rangées Carroyage / Grille MGRS / Lignes électriques à la fin de `section`. */
export function mountOverlayControls(section: HTMLElement, ov: MapOverlays, cls: OverlayControlClasses): void {
    if (section.querySelector('.tac-overlay-row')) return;
    const row = (btn: HTMLButtonElement, text: string): { el: HTMLDivElement; label: HTMLSpanElement; note: HTMLSpanElement } => {
        const el = document.createElement('div');
        el.className = `${cls.row} tac-overlay-row`;
        const label = document.createElement('span');
        label.className = cls.label;
        label.textContent = text;
        const note = document.createElement('span');
        note.className = 'tac-overlay-note';
        const wrap = document.createElement('span');
        wrap.className = 'tac-overlay-text';
        wrap.append(label, note);
        el.append(btn, wrap);
        section.appendChild(el);
        return { el, label, note };
    };

    const gridBtn = fab(cls.fab, 'grid_on', 'Afficher ou masquer le carroyage tactique');
    const grid = row(gridBtn, 'Carroyage');
    gridBtn.addEventListener('click', () => ov.setGridOn(!ov.state.gridOn));

    const tools = document.createElement('div');
    tools.className = 'tac-overlay-tools';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Maille du carroyage');
    for (const m of GRID_CELL_SIZES) {
        const o = document.createElement('option');
        o.value = String(m);
        o.textContent = `${m} m`;
        select.appendChild(o);
    }
    select.addEventListener('change', () => {
        // Refus de la confirmation : le menu revient sur la maille en place.
        void ov.setCellSize(Number(select.value)).then((done) => { if (!done) select.value = String(ov.state.cellM); });
    });
    // Couleur et taille (décision 39, G4) : contrôles accessibles (libellé
    // clavier, 44 px de haut), appliqués aussitôt et gardés avec le carroyage.
    const colorSelect = document.createElement('select');
    colorSelect.setAttribute('aria-label', 'Couleur du carroyage');
    colorSelect.style.minHeight = '44px';
    for (const id of Object.keys(GRID_COLORS) as GridColor[]) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = GRID_COLOR_LABELS[id];
        colorSelect.appendChild(o);
    }
    colorSelect.addEventListener('change', () => ov.setGridColor(colorSelect.value as GridColor));
    const sizeSelect = document.createElement('select');
    sizeSelect.setAttribute('aria-label', 'Taille des lettres du carroyage');
    sizeSelect.style.minHeight = '44px';
    for (const id of Object.keys(GRID_LABEL_SIZES) as GridLabelSize[]) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = GRID_SIZE_LABELS[id];
        sizeSelect.appendChild(o);
    }
    sizeSelect.addEventListener('change', () => ov.setGridLabelSize(sizeSelect.value as GridLabelSize));
    const onView = fab('tac-overlay-tool', 'center_focus_strong', 'Poser le carroyage sur la vue (centre de l’écran)');
    onView.append(' Sur la vue');
    onView.addEventListener('click', () => void ov.placeGridOnView());
    const draw = fab('tac-overlay-tool', 'crop_free', 'Tracer le carroyage : glisser d’un coin à l’autre, ou toucher deux coins');
    draw.append(' Tracer');
    draw.addEventListener('click', () => void ov.startGridDraw());
    const move = fab('tac-overlay-tool', 'open_with', 'Déplacer le carroyage (nouvel emplacement du coin A1)');
    move.addEventListener('click', () => ov.startGridMove());
    const rotateBtn = fab('tac-overlay-tool', 'rotate_right', 'Tourner le carroyage autour de son centre');
    rotateBtn.append(' Tourner');
    rotateBtn.addEventListener('click', () => void ov.startGridRotate());
    const northBtn = fab('tac-overlay-tool', 'explore', 'Remettre le carroyage au nord (angle 0)');
    northBtn.append(' Nord en haut');
    northBtn.addEventListener('click', () => ov.gridNorthUp());
    const clear = fab('tac-overlay-tool', 'delete', 'Effacer le carroyage');
    clear.addEventListener('click', () => void ov.clearGrid());
    tools.append(select, colorSelect, sizeSelect, onView, draw, move, rotateBtn, northBtn, clear);
    grid.el.after(tools);

    const mgrsBtn = fab(cls.fab, 'grid_4x4', 'Afficher ou masquer la grille MGRS');
    const mgrs = row(mgrsBtn, 'Grille MGRS');
    mgrsBtn.addEventListener('click', () => ov.setMgrsOn(!ov.state.mgrsOn));

    const powerBtn = fab(cls.fab, 'bolt', 'Afficher ou masquer les lignes électriques');
    const power = row(powerBtn, 'Lignes électriques');
    powerBtn.addEventListener('click', () => ov.setPowerOn(!ov.state.powerOn));

    const paint = (): void => {
        const s = ov.state;
        gridBtn.classList.toggle('active', s.gridOn);
        gridBtn.setAttribute('aria-pressed', String(s.gridOn));
        tools.hidden = !s.gridOn;
        select.value = String(s.cellM);
        colorSelect.disabled = !s.grid;
        sizeSelect.disabled = !s.grid;
        if (s.grid) {
            colorSelect.value = gridColor(s.grid);
            sizeSelect.value = gridLabelSize(s.grid);
        }
        move.disabled = !s.grid;
        rotateBtn.disabled = !s.grid;
        northBtn.disabled = !s.grid;
        clear.disabled = !s.grid;
        const angle = s.grid ? Math.round(((s.grid.angle ?? 0) % 360 + 360) % 360) : 0;
        grid.note.textContent = ov.isCapturing() ? 'Touchez la carte…' : s.grid ? `${s.grid.cols} × ${s.grid.rows} cases de ${s.grid.cellM} m${angle ? ` · orienté ${angle}°` : ''}` : s.gridOn ? 'À tracer' : '';
        mgrsBtn.classList.toggle('active', s.mgrsOn);
        mgrsBtn.setAttribute('aria-pressed', String(s.mgrsOn));
        mgrs.note.textContent = !s.mgrsOn ? '' : ov.mgrsNeedsZoom() ? 'Zoomez pour l’afficher' : '1 km, 100 m de près';
        powerBtn.classList.toggle('active', s.powerOn);
        powerBtn.setAttribute('aria-pressed', String(s.powerOn));
        const st = ov.powerStatus();
        power.note.textContent = s.powerOn ? POWER_STATUS_TEXT[st] : '';
        power.note.classList.toggle('is-error', st === 'error' || st === 'partial');
    };
    ov.onChange(paint);
    paint();
}

// ─── Légende incrustée dans les captures ─────────────────────────────────────

/**
 * Texte de légende des surcouches visibles, `null` si aucune. Le nord est
 * indiqué d'après l'orientation réelle de la carte au moment de la capture.
 */
export function overlayLegend(ov: MapOverlays | null | undefined, bearing: number): string | null {
    if (!ov) return null;
    const s = ov.state;
    const parts: string[] = [];
    if (s.gridOn && s.grid) {
        parts.push(`Carroyage ${s.grid.cellM} m (${s.grid.cols} × ${s.grid.rows}), A1 au nord-ouest : ${mgrsOf(s.grid.west, s.grid.north) ?? 'N/C'}`);
    }
    if (s.mgrsOn) parts.push('Grille MGRS');
    if (s.powerOn) parts.push('Lignes électriques : RTE (OSM), HTA et BT (Enedis)');
    if (!parts.length) return null;
    const b = ((Math.round(bearing) % 360) + 360) % 360;
    parts.push(b === 0 ? 'Nord en haut' : `Nord à ${360 - b}° (carte tournée)`);
    return parts.join('  ·  ');
}

/**
 * Bandeau de légende en bas d'une capture (canvas déjà composé). Hauteur et
 * police proportionnelles à la densité de pixels, texte réduit s'il déborde.
 */
export function drawOverlayLegend(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, text: string): void {
    const pad = 8 * dpr;
    let size = 13 * dpr;
    ctx.save();
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    while (ctx.measureText(text).width > width - 2 * pad && size > 8 * dpr) {
        size -= dpr;
        ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    }
    const band = size + 2 * pad;
    ctx.fillStyle = 'rgba(11, 13, 18, 0.82)';
    ctx.fillRect(0, height - band, width, band);
    ctx.fillStyle = '#f5f7fa';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, height - band / 2, width - 2 * pad);
    ctx.restore();
}
