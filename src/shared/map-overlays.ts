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
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import {
    GRID_CELL_SIZES,
    GRID_DEFAULT_CELL,
    gridCellAt,
    isTacticalGridSpec,
    makeTacticalGrid,
    mgrsGridGeometry,
    mgrsOf,
    tacticalGridGeometry,
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
    startGridDraw(): Promise<void>;
    startGridMove(): void;
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

const GRID_COLOR = '#f5f7fa';
const GRID_HALO = '#0b0d12';
const MGRS_COLOR = '#7fdcff';
const POWER_COLORS: Record<string, string> = { tht: '#e53935', ht: '#fb8c00', hta: '#fdd835', bt: '#9e9e9e' };

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

export function createMapOverlays(map: MapLibreMap, opts: OverlayOptions): MapOverlays {
    const state = sanitize(opts.load());
    // Interrupteur « Carroyage » actif sans carroyage (reset de situation,
    // tracé abandonné) : on le relit éteint plutôt qu'« À tracer » à vide.
    if (!state.grid) state.gridOn = false;
    let mgrsZoom = false;
    const listeners = new Set<() => void>();
    let capture: null | { mode: 'draw' | 'move'; first?: LngLat } = null;
    let power: PowerStatus = 'off';
    let powerSeq = 0;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    let ready = false;

    const toast = (m: string, k: OverlayToastKind = 'info'): void => opts.toast?.(m, k);
    const changed = (): void => {
        opts.save({ ...state });
        listeners.forEach((l) => { try { l(); } catch { /* un écouteur ne bloque pas la carte */ } });
    };

    function addLayers(): void {
        if (map.getSource('tac-grid')) return;
        for (const id of ['tac-grid', 'tac-grid-labels', 'tac-grid-preview', 'tac-mgrs', 'tac-mgrs-labels', 'tac-power', 'tac-power-towers']) {
            map.addSource(id, { type: 'geojson', data: EMPTY });
        }
        // Lignes électriques sous les grilles : les grilles restent lisibles par-dessus.
        // `line-dasharray` n'accepte pas d'expression de données : la basse
        // tension (pointillée) a sa propre couche.
        map.addLayer({
            id: 'tac-power-line', type: 'line', source: 'tac-power',
            filter: ['!=', ['get', 'cls'], 'bt'],
            paint: {
                'line-color': ['match', ['get', 'cls'], 'tht', POWER_COLORS.tht!, 'ht', POWER_COLORS.ht!, POWER_COLORS.hta!],
                'line-width': ['match', ['get', 'cls'], 'tht', 3.5, 'ht', 2.5, 1.8],
                'line-opacity': 0.9,
            },
        });
        map.addLayer({
            id: 'tac-power-line-bt', type: 'line', source: 'tac-power',
            filter: ['==', ['get', 'cls'], 'bt'],
            paint: { 'line-color': POWER_COLORS.bt!, 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
        });
        map.addLayer({
            id: 'tac-power-tower', type: 'circle', source: 'tac-power-towers', minzoom: 14,
            paint: { 'circle-radius': 3, 'circle-color': '#ffffff', 'circle-stroke-color': POWER_COLORS.tht!, 'circle-stroke-width': 1.5 },
        });
        map.addLayer({
            id: 'tac-power-label', type: 'symbol', source: 'tac-power', minzoom: 15,
            filter: ['!=', ['get', 'label'], ''],
            layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11 },
            paint: { 'text-color': '#ffffff', 'text-halo-color': GRID_HALO, 'text-halo-width': 1.5 },
        });
        // Liseré sombre sous le trait : la grille reste lisible sur une
        // orthophoto claire comme sur un fond sombre.
        map.addLayer({
            id: 'tac-mgrs-casing', type: 'line', source: 'tac-mgrs',
            paint: { 'line-color': GRID_HALO, 'line-width': ['match', ['get', 'kind'], 'km', 3.2, 2.4], 'line-opacity': 0.45 },
        });
        map.addLayer({
            id: 'tac-mgrs-line', type: 'line', source: 'tac-mgrs',
            paint: { 'line-color': MGRS_COLOR, 'line-width': ['match', ['get', 'kind'], 'km', 1.6, 1.1], 'line-dasharray': [4, 3], 'line-opacity': 0.95 },
        });
        map.addLayer({
            id: 'tac-mgrs-label', type: 'symbol', source: 'tac-mgrs-labels',
            layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'bottom-left', 'text-offset': [0.2, -0.1], 'text-allow-overlap': false },
            paint: { 'text-color': MGRS_COLOR, 'text-halo-color': GRID_HALO, 'text-halo-width': 1.5 },
        });
        map.addLayer({
            id: 'tac-grid-line', type: 'line', source: 'tac-grid',
            paint: { 'line-color': GRID_COLOR, 'line-width': ['match', ['get', 'kind'], 'edge', 2.5, 1.2], 'line-opacity': 0.95 },
        });
        map.addLayer({
            id: 'tac-grid-label', type: 'symbol', source: 'tac-grid-labels',
            layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-allow-overlap': true },
            paint: { 'text-color': GRID_COLOR, 'text-halo-color': GRID_HALO, 'text-halo-width': 2 },
        });
        map.addLayer({
            id: 'tac-grid-preview-line', type: 'line', source: 'tac-grid-preview',
            paint: { 'line-color': GRID_COLOR, 'line-width': 2, 'line-dasharray': [2, 2] },
        });
        ready = true;
        renderAll();
    }

    function renderGrid(): void {
        if (!ready) return;
        const g = state.gridOn && state.grid ? tacticalGridGeometry(state.grid) : null;
        src(map, 'tac-grid')?.setData(g ? g.lines : EMPTY);
        src(map, 'tac-grid-labels')?.setData(g ? g.labels : EMPTY);
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
        const r = await loadPowerLines(bounds).catch(() => null);
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

    function setPreview(a: LngLat, b: LngLat): void {
        const ring: LngLat[] = [a, [b[0], a[1]], b, [a[0], b[1]], a];
        src(map, 'tac-grid-preview')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } }] });
    }

    function endCapture(): void {
        capture = null;
        src(map, 'tac-grid-preview')?.setData(EMPTY);
        map.getCanvas().style.cursor = '';
        notifyStatus();
    }

    map.on('mousemove', (e: MapMouseEvent) => {
        if (capture?.mode === 'draw' && capture.first) setPreview(capture.first, [e.lngLat.lng, e.lngLat.lat]);
    });
    map.on('click', (e: MapMouseEvent) => {
        if (!capture) return;
        const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
        if (capture.mode === 'move' && state.grid) {
            state.grid = { ...state.grid, west: p[0], north: p[1] };
            endCapture();
            renderGrid();
            changed();
            toast('Carroyage déplacé : A1 est maintenant au point touché.', 'success');
            return;
        }
        if (!capture.first) {
            capture.first = p;
            setPreview(p, p);
            toast('Touchez le coin opposé.');
            return;
        }
        const { spec, clamped } = makeTacticalGrid(capture.first, p, state.cellM);
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
    });
    map.on('moveend', () => {
        if (moveTimer !== null) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => { moveTimer = null; renderMgrs(); void renderPower(); }, 350);
    });
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && capture) { endCapture(); toast('Tracé du carroyage annulé.'); }
    };
    document.addEventListener('keydown', onKey);

    if (map.loaded()) addLayers();
    else map.on('load', addLayers);

    const api: MapOverlays = {
        get state() { return state; },
        isCapturing: () => capture !== null,
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
            // Même emprise, nouvelle maille : on repart du coin A1 existant.
            if (state.grid) {
                const g = state.grid;
                const se: LngLat = [g.west + g.cols * g.dLon, g.north - g.rows * g.dLat];
                const { spec, clamped } = makeTacticalGrid([g.west, g.north], se, m);
                state.grid = spec;
                renderGrid();
                if (clamped) toast(`Carroyage borné à ${spec.cols} × ${spec.rows} cases : l'emprise d'origine est trop grande pour une maille de ${m} m.`);
            }
            changed();
            return true;
        },
        async startGridDraw() {
            if (state.grid && opts.confirm && !(await opts.confirm('Remplacer le carroyage actuel ? Les cases annoncées jusqu’ici changeront de place.'))) return;
            capture = { mode: 'draw' };
            map.getCanvas().style.cursor = 'crosshair';
            toast('Carroyage : touchez un premier coin de la zone (Échap pour annuler).');
            notifyStatus();
        },
        startGridMove() {
            if (!state.grid) return;
            capture = { mode: 'move' };
            map.getCanvas().style.cursor = 'crosshair';
            toast('Touchez le nouvel emplacement du coin A1 (Échap pour annuler).');
            notifyStatus();
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

const POWER_STATUS_TEXT: Record<PowerStatus, string> = {
    off: 'Basse tension incomplète (OSM)',
    zoom: 'Zoomez pour les afficher',
    loading: 'Chargement…',
    ok: 'Basse tension incomplète (OSM)',
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
    const draw = fab('tac-overlay-tool', 'crop_free', 'Tracer le carroyage (deux coins opposés)');
    draw.append(' Tracer');
    draw.addEventListener('click', () => void ov.startGridDraw());
    const move = fab('tac-overlay-tool', 'open_with', 'Déplacer le carroyage (nouvel emplacement du coin A1)');
    move.addEventListener('click', () => ov.startGridMove());
    const clear = fab('tac-overlay-tool', 'delete', 'Effacer le carroyage');
    clear.addEventListener('click', () => void ov.clearGrid());
    tools.append(select, draw, move, clear);
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
        move.disabled = !s.grid;
        clear.disabled = !s.grid;
        grid.note.textContent = ov.isCapturing() ? 'Touchez la carte…' : s.grid ? `${s.grid.cols} × ${s.grid.rows} cases de ${s.grid.cellM} m` : s.gridOn ? 'À tracer' : '';
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
    if (s.powerOn) parts.push('Lignes électriques OSM (basse tension incomplète)');
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
