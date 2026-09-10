/**
 * gpx.ts — Import de traces GPX et panneau de calques (paquet `pm-gpx`).
 * ===========================================================================
 *
 * Une trace GPX (rando OsmAnd, reconnaissance terrain…) est importée depuis un
 * fichier local, superposée à la carte, et gérée dans un panneau dédié :
 * ajouter, afficher/masquer, supprimer.
 *
 * TROIS DÉCISIONS STRUCTURANTES
 *
 * 1. AUCUNE DÉPENDANCE. Un GPX est du XML et une trace n'est qu'une suite de
 *    `<trkpt lat lon>` : `DOMParser`, natif, suffit. Pas de togeojson.
 *
 * 2. STOCKAGE SÉPARÉ des formes. Une trace compte couramment plusieurs
 *    milliers de points ; `pcTacPlanShapes` est copié intégralement dans la
 *    pile d'annulation (50 états) et réécrit à chaque glissement de forme. Les
 *    coordonnées vont donc en IndexedDB (`GpxStore`), et seul un index léger
 *    — nom, couleur, visibilité — va en localStorage. Même partage que les
 *    zones hors-ligne : `pcTacAoiIndex` d'un côté, tuiles en Cache Storage de
 *    l'autre.
 *
 * 3. COUCHE GL, PAS DES MARKERS. Les traces sont rendues par une source
 *    GeoJSON et deux couches `line`, créées PARESSEUSEMENT (patron
 *    `_ensureStreetLabelLayers`, map-core.ts) — jamais dans le style, jamais
 *    dans les couches de dessin. Elles sont insérées SOUS `plan-shapes-fill` :
 *    une trace importée ne passe jamais par-dessus les dessins de l'opérateur.
 *    Bénéfice : la capture qui alimente le PDF compose le canvas WebGL, donc
 *    les traces y apparaissent sans travail supplémentaire.
 *
 * Règle du découpage (SPEC-PLANMAP-SPLIT.md §1.2) : ce module n'importe aucun
 * autre sous-module de méthodes ; seul `index.ts` les assemble.
 */

import maplibregl from 'maplibre-gl';

import { GpxStore } from '@pctac/image-store.js';
import { confirmDialog } from '@shared/feedback.js';
import { Persist } from '@shared/persist.js';

import {
    GPX_CASING_LAYER,
    GPX_COLORS,
    GPX_DAY_BOUNDARY_DEFAULT,
    GPX_DAY_BOUNDARY_KEY,
    GPX_INDEX_KEY,
    GPX_LINE_LAYER,
    GPX_SORT_KEY,
    GPX_SRC,
} from './constants.js';
import type { GpxSegments, GpxTimes, GpxTrackData, LngLatTuple, PlanGpxTrack, PlanMapInternal } from './types.js';

// Ré-export : les types de contenu vivent dans `types.js` (state.ts en dépend),
// mais l'appelant naturel reste ce module.
export type { GpxSegments, GpxTimes, GpxTrackData };

/** Couche de dessin sous laquelle les traces sont insérées (jamais par-dessus). */
const BELOW_LAYER = 'plan-shapes-fill';

/** Résultat d'un parsing : le nom déclaré dans le fichier, et le contenu. */
export interface ParsedGpx {
    name: string | null;
    segments: GpxSegments;
    times: GpxTimes | null;
}

/**
 * Parse un GPX. PURE, sans DOM applicatif ni carte.
 *
 * Reconnaît les traces (`<trk><trkseg><trkpt>`), les routes (`<rte><rtept>`)
 * et, à défaut, les points isolés (`<wpt>`) regroupés en une polyligne. Un
 * segment de moins de deux points est écarté : il ne produirait rien de
 * visible. Renvoie `null` si le document n'est pas du XML exploitable ou ne
 * contient aucun point — jamais d'exception.
 */
export function parseGpx(text: string): ParsedGpx | null {
    if (!text || typeof text !== 'string') return null;
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(text, 'application/xml');
    } catch {
        return null;
    }
    // `parseFromString` ne jette pas sur XML invalide : il renvoie un document
    // contenant un <parsererror>. C'est le seul signal d'échec disponible.
    if (doc.getElementsByTagName('parsererror').length > 0) return null;

    const coordsOf = (nodes: HTMLCollectionOf<Element>): { coords: LngLatTuple[]; times: (number | null)[] } => {
        const coords: LngLatTuple[] = [];
        const times: (number | null)[] = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!el) continue;
            const rawLat = el.getAttribute('lat');
            const rawLon = el.getAttribute('lon');
            // Attribut ABSENT : `Number(null)` vaut 0, une latitude parfaitement
            // valide. Sans ce test, un point tronqué atterrirait au large du
            // golfe de Guinée au milieu du tracé.
            if (rawLat === null || rawLon === null) continue;
            const lat = Number(rawLat);
            const lon = Number(rawLon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
            // INVARIANT : coordonnée et temps poussés dans la MÊME itération, y
            // compris quand le temps manque. Un point rejeté par les gardes
            // ci-dessus ne produit ni l'un ni l'autre — les deux tableaux
            // restent alignés index par index.
            coords.push([lon, lat]);
            const raw = el.getElementsByTagName('time')[0]?.textContent;
            const ts = raw ? Date.parse(raw.trim()) : NaN;
            times.push(Number.isFinite(ts) ? ts : null);
        }
        return { coords, times };
    };

    const segments: GpxSegments = [];
    const times: GpxTimes = [];
    for (const tag of ['trkseg', 'rte']) {
        const blocks = doc.getElementsByTagName(tag);
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (!block) continue;
            const pts = coordsOf(block.getElementsByTagName(tag === 'trkseg' ? 'trkpt' : 'rtept'));
            if (pts.coords.length >= 2) { segments.push(pts.coords); times.push(pts.times); }
        }
    }
    // Repli : certains exports ne contiennent que des points isolés.
    if (!segments.length) {
        const wpts = coordsOf(doc.getElementsByTagName('wpt'));
        if (wpts.coords.length >= 2) { segments.push(wpts.coords); times.push(wpts.times); }
    }
    if (!segments.length) return null;

    // Aucun point daté du tout (cas d'un itinéraire `<rte>`, ou d'un export
    // nettoyé) : on ne conserve pas un tableau de `null`, on marque la trace
    // comme non datée. Le panneau et les fonctions temporelles s'en servent.
    const dated = times.some((seg) => seg.some((t) => t !== null));

    // Le nom de la trace prime sur celui des métadonnées du fichier. Les
    // sélecteurs sont essayés DANS L'ORDRE : un sélecteur unique séparé par des
    // virgules renverrait le premier match en ordre de document, et <metadata>
    // précède <trk> dans un GPX — le nom du fichier écraserait celui de la trace.
    let name: string | null = null;
    for (const sel of ['trk > name', 'rte > name', 'metadata > name']) {
        const found = doc.querySelector(sel)?.textContent?.trim();
        if (found) { name = found; break; }
    }
    return { name, segments, times: dated ? times : null };
}

/** Nom de trace lisible : celui du fichier GPX, sinon le nom de fichier nu. */
function trackNameFrom(parsed: ParsedGpx, fileName: string): string {
    const fallback = fileName.replace(/\.gpx$/i, '').trim();
    return (parsed.name || fallback || 'Trace').slice(0, 60);
}

/** Index persisté (localStorage). Ne jette jamais : renvoie `[]` si illisible. */
function loadIndex(): PlanGpxTrack[] {
    const raw = Persist.get<PlanGpxTrack[] | null>(GPX_INDEX_KEY, {
        validator: (v): v is PlanGpxTrack[] => Array.isArray(v),
        fallback: null,
    });
    return Array.isArray(raw) ? raw : [];
}

function saveIndex(list: readonly PlanGpxTrack[]): void {
    Persist.set(GPX_INDEX_KEY, list);
}

function escHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * Jours repliés dans le panneau. AU SCOPE MODULE et non dans l'état de la
 * carte : c'est du confort d'affichage, qui n'a pas à survivre au rechargement
 * ni à figurer dans l'état persisté.
 */
const foldedDays = new Set<string>();

/** Ordre de tri retenu, persisté. `true` = les plus récentes en premier. */
function newestFirst(): boolean {
    return Persist.get<boolean | null>(GPX_SORT_KEY, {
        validator: (v): v is boolean => typeof v === 'boolean',
        fallback: null,
    }) !== false;
}

/** Jour opérationnel d'une trace, chaîne vide si elle n'est pas datée. */
function dayOf(t: PlanGpxTrack, boundaryHour: number): string {
    return typeof t.startedAt === 'number' ? operationalDayKey(t.startedAt, boundaryHour) : '';
}

/**
 * Tri chronologique. Les traces non datées gardent leur ordre d'import et
 * restent en queue : aucune date ne permet de les placer parmi les autres.
 */
export function sortTracks(tracks: readonly PlanGpxTrack[]): PlanGpxTrack[] {
    const recent = newestFirst();
    const dated = tracks.filter((t) => typeof t.startedAt === 'number');
    const undated = tracks.filter((t) => typeof t.startedAt !== 'number');
    dated.sort((a, b) => {
        const d = (a.startedAt ?? 0) - (b.startedAt ?? 0);
        return recent ? -d : d;
    });
    return [...dated, ...undated];
}

/** Libellé lisible d'un jour `AAAA-MM-JJ`. Chaîne vide = traces non datées. */
export function dayLabel(day: string): string {
    if (!day) return 'Sans horodatage';
    const [y, m, d] = day.split('-').map(Number);
    if (!y || !m || !d) return day;
    return new Date(y, m - 1, d).toLocaleDateString('fr-FR', {
        weekday: 'short', day: 'numeric', month: 'short',
    });
}

/** Heure de début d'une trace, en heures et minutes locales. Vide si non datée. */
function startLabel(t: PlanGpxTrack): string {
    if (typeof t.startedAt !== 'number') return '';
    return new Date(t.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Une ligne de trace dans la liste. */
function rowHtml(t: PlanGpxTrack): string {
    const heure = startLabel(t);
    const undated = heure === '';
    return `
        <div class="plan-gpx-row" data-gpx-id="${escHtml(t.id)}">
            <button type="button" class="plan-gpx-dot" data-gpx-act="color"
                    style="background:${escHtml(t.color)}"
                    title="Changer la couleur de cette trace"
                    aria-label="Changer la couleur de la trace ${escHtml(t.name)}"></button>
            <span class="plan-gpx-name" title="${escHtml(t.name)}">${escHtml(t.name)}</span>
            ${undated
                ? '<span class="plan-gpx-undated" title="Trace sans horodatage : elle reste affichable, mais les fonctions de temps ne l\'atteignent pas. Réimporte le fichier d\'origine pour récupérer ses heures.">non datée</span>'
                : `<span class="plan-gpx-hour">${escHtml(heure)}</span>`}
            <button type="button" class="plan-gpx-btn" data-gpx-act="toggle"
                    title="${t.visible ? 'Masquer' : 'Afficher'} cette trace"
                    aria-label="${t.visible ? 'Masquer' : 'Afficher'} la trace ${escHtml(t.name)}">
                <span class="material-symbols-outlined">${t.visible ? 'visibility' : 'visibility_off'}</span>
            </button>
            <button type="button" class="plan-gpx-btn" data-gpx-act="remove"
                    title="Supprimer cette trace" aria-label="Supprimer la trace ${escHtml(t.name)}">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </div>`;
}

/** Grille de pastilles de couleur, contenu d'un sous-menu transitoire. */
function swatchesHtml(): string {
    return `<div class="plan-gpx-swatches">${GPX_COLORS.map((c) => `
        <button type="button" class="plan-gpx-swatch" data-gpx-color="${escHtml(c)}"
                style="background:${escHtml(c)}" title="${escHtml(c)}" aria-label="Couleur ${escHtml(c)}"></button>`).join('')}</div>`;
}

/**
 * Premier et dernier horodatage NON NULS d'une trace, ou `null` si aucun point
 * n'est daté. Ce sont ces deux bornes qui sont conservées dans l'index, pour
 * trier et grouper sans relire les coordonnées depuis IndexedDB.
 */
export function trackTimeBounds(times: GpxTimes | null): { startedAt: number | null; endedAt: number | null } {
    if (!times) return { startedAt: null, endedAt: null };
    let min = Infinity;
    let max = -Infinity;
    for (const seg of times) {
        for (const t of seg) {
            if (t === null || !Number.isFinite(t)) continue;
            if (t < min) min = t;
            if (t > max) max = t;
        }
    }
    if (min === Infinity) return { startedAt: null, endedAt: null };
    return { startedAt: min, endedAt: max };
}

/**
 * Clé du jour OPÉRATIONNEL auquel appartient un instant, au format AAAA-MM-JJ.
 *
 * La journée bascule à `boundaryHour` heures LOCALES, 6 h par défaut : une
 * intervention de nuit reste entière dans le même jour au lieu d'être coupée
 * en deux à minuit. Poser 0 redonne le jour civil.
 *
 * Le calcul se fait en heure locale, jamais en temps universel : les
 * horodatages GPX sont universels, et raisonner dessus scinderait une
 * opération nocturne à une ou deux heures du matin selon le fuseau.
 */
export function operationalDayKey(ts: number, boundaryHour: number): string {
    const d = new Date(ts);
    // Reculer d'autant d'heures que la bascule : tout ce qui précède l'heure
    // de bascule bascule ainsi automatiquement sur la date de la veille.
    d.setHours(d.getHours() - boundaryHour);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Heure de bascule retenue par l'utilisateur, bornée à 0..23. */
export function gpxDayBoundary(): number {
    const raw = Persist.get<number | null>(GPX_DAY_BOUNDARY_KEY, {
        validator: (v): v is number => typeof v === 'number' && Number.isFinite(v),
        fallback: null,
    });
    if (raw === null || raw === undefined) return GPX_DAY_BOUNDARY_DEFAULT;
    return Math.max(0, Math.min(23, Math.floor(raw)));
}

/**
 * Regroupe les traces par jour opérationnel, du plus récent au plus ancien.
 * Les traces NON DATÉES sont rassemblées à part, sous la clé vide : elles
 * restent visibles et manipulables, mais aucune fonction temporelle ne les
 * atteint — c'est volontaire, un filtre par date ne peut rien affirmer d'elles.
 */
export function groupByDay(
    tracks: readonly PlanGpxTrack[],
    boundaryHour: number,
): Array<{ day: string; tracks: PlanGpxTrack[] }> {
    const byDay = new Map<string, PlanGpxTrack[]>();
    for (const t of tracks) {
        const key = typeof t.startedAt === 'number' ? operationalDayKey(t.startedAt, boundaryHour) : '';
        const list = byDay.get(key);
        if (list) list.push(t); else byDay.set(key, [t]);
    }
    const dated = [...byDay.entries()].filter(([k]) => k !== '').sort((a, b) => b[0].localeCompare(a[0]));
    const undated = byDay.get('');
    const out = dated.map(([day, list]) => ({ day, tracks: list }));
    if (undated) out.push({ day: '', tracks: undated });
    return out;
}

export const GpxMethods = {
    /**
     * Crée (une seule fois) la source et les deux couches de traces.
     * Renvoie `false` tant que la carte n'est pas prête — l'appelant réessaiera
     * au prochain rendu, comme `_ensureStreetLabelLayers`.
     */
    _ensureGpxLayers(this: PlanMapInternal): boolean {
        const map = this.map;
        if (!map) return false;
        if (map.getLayer(GPX_LINE_LAYER)) return true;
        try {
            if (!map.getSource(GPX_SRC)) {
                map.addSource(GPX_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            }
            // Insérées SOUS les dessins quand ceux-ci existent déjà ; sinon en
            // haut de pile, et le prochain `_initDrawingLayers` passera devant.
            const before = map.getLayer(BELOW_LAYER) ? BELOW_LAYER : undefined;
            map.addLayer({
                id: GPX_CASING_LAYER,
                type: 'line',
                source: GPX_SRC,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.55 },
            }, before);
            map.addLayer({
                id: GPX_LINE_LAYER,
                type: 'line',
                source: GPX_SRC,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': ['coalesce', ['get', 'color'], '#a855f7'],
                    'line-width': 3.5,
                },
            }, before);
            return true;
        } catch {
            // Style pas encore chargé : on retentera au prochain rendu.
            return false;
        }
    },

    /** Repeint la source GeoJSON à partir des traces visibles en mémoire. */
    _renderGpxLayers(this: PlanMapInternal): void {
        const map = this.map;
        if (!map) return;
        if (!this._ensureGpxLayers()) return;
        const features = [];
        for (const t of this._gpxTracks) {
            if (!t.visible) continue;
            const data = this._gpxCoords[t.id];
            if (!data || !data.coords.length) continue;
            for (const seg of data.coords) {
                if (seg.length < 2) continue;
                features.push({
                    type: 'Feature' as const,
                    geometry: { type: 'LineString' as const, coordinates: seg },
                    properties: { color: t.color, gpxId: t.id },
                });
            }
        }
        const src = map.getSource(GPX_SRC);
        // `setData` n'existe que sur une GeoJSONSource ; garde de typage pure.
        if (src && 'setData' in src && typeof src.setData === 'function') {
            src.setData({ type: 'FeatureCollection', features });
        }
    },

    /**
     * Redessine la liste : les traces groupées par jour opérationnel, sous des
     * en-têtes repliables. Le tronc du panneau reste léger — chaque action de
     * groupe ouvre un sous-menu transitoire, jamais une barre permanente.
     */
    _renderGpxList(this: PlanMapInternal): void {
        const box = document.getElementById('plan_gpx_list');
        if (!box) return;
        if (!this._gpxTracks.length) {
            box.innerHTML = '<p class="plan-gpx-empty">Aucune trace importée.</p>';
            this._refreshGpxActions();
            return;
        }
        const groups = groupByDay(sortTracks(this._gpxTracks), gpxDayBoundary());
        box.innerHTML = groups.map((g) => {
            const folded = foldedDays.has(g.day);
            const shown = g.tracks.filter((t) => t.visible).length;
            return `
            <div class="plan-gpx-group" data-gpx-day="${escHtml(g.day)}">
                <div class="plan-gpx-day">
                    <button type="button" class="plan-gpx-fold" data-gpx-act="fold"
                            aria-expanded="${folded ? 'false' : 'true'}"
                            title="${folded ? 'Déplier' : 'Replier'} ce jour">
                        <span class="material-symbols-outlined">${folded ? 'chevron_right' : 'expand_more'}</span>
                        <span class="plan-gpx-day-label">${escHtml(dayLabel(g.day))}</span>
                    </button>
                    <span class="plan-gpx-day-count">${shown}/${g.tracks.length}</span>
                    <button type="button" class="plan-gpx-btn" data-gpx-act="daymenu"
                            title="Actions sur ce jour" aria-label="Actions sur ${escHtml(dayLabel(g.day))}">
                        <span class="material-symbols-outlined">more_horiz</span>
                    </button>
                </div>
                <div class="plan-gpx-day-body"${folded ? ' hidden' : ''}>
                    ${g.tracks.map((t) => rowHtml(t)).join('')}
                </div>
            </div>`;
        }).join('');
        this._refreshGpxActions();
    },

    /** Met l'icône du bouton « tout afficher / tout masquer » à l'état courant. */
    _refreshGpxActions(this: PlanMapInternal): void {
        const btn = document.getElementById('plan_gpx_all');
        if (!btn) return;
        const any = this._gpxTracks.some((t) => t.visible);
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = any ? 'visibility' : 'visibility_off';
        btn.title = any ? 'Masquer toutes les traces' : 'Afficher toutes les traces';
        btn.setAttribute('aria-label', btn.title);
        btn.toggleAttribute('disabled', this._gpxTracks.length === 0);
    },

    /** Replie ou déplie un jour. L'état ne survit pas au rechargement, c'est du confort. */
    _toggleGpxDayFold(this: PlanMapInternal, day: string): void {
        if (foldedDays.has(day)) foldedDays.delete(day); else foldedDays.add(day);
        this._renderGpxList();
    },

    /**
     * Affiche ou masque tout d'un coup. Sans argument, bascule : si au moins une
     * trace est visible on masque tout, sinon on affiche tout.
     */
    _setAllGpxVisible(this: PlanMapInternal, visible?: boolean): void {
        if (!this._gpxTracks.length) return;
        const target = typeof visible === 'boolean' ? visible : !this._gpxTracks.some((t) => t.visible);
        for (const t of this._gpxTracks) t.visible = target;
        saveIndex(this._gpxTracks);
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /** Affiche ou masque toutes les traces d'un jour opérationnel. */
    _setGpxDayVisible(this: PlanMapInternal, day: string, visible: boolean): void {
        const boundary = gpxDayBoundary();
        let touched = false;
        for (const t of this._gpxTracks) {
            if (dayOf(t, boundary) !== day) continue;
            t.visible = visible;
            touched = true;
        }
        if (!touched) return;
        saveIndex(this._gpxTracks);
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /** Applique une couleur à une trace, ou à toutes celles d'un jour. */
    _setGpxColor(this: PlanMapInternal, target: { id?: string; day?: string }, color: string): void {
        const boundary = gpxDayBoundary();
        let touched = false;
        for (const t of this._gpxTracks) {
            const match = target.id !== undefined ? t.id === target.id
                : target.day !== undefined ? dayOf(t, boundary) === target.day
                : true;
            if (!match) continue;
            t.color = color;
            touched = true;
        }
        if (!touched) return;
        saveIndex(this._gpxTracks);
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /**
     * Redonne à chaque jour sa propre couleur, prise dans la palette.
     * Au-delà de six jours la palette recycle : deux jours éloignés peuvent
     * partager une couleur. C'est assumé — l'en-tête de jour lève l'ambiguïté.
     */
    _colorGpxByDay(this: PlanMapInternal): void {
        const groups = groupByDay(this._gpxTracks, gpxDayBoundary());
        let i = 0;
        for (const g of groups) {
            const color = GPX_COLORS[i % GPX_COLORS.length] ?? '#a855f7';
            for (const t of g.tracks) t.color = color;
            i++;
        }
        saveIndex(this._gpxTracks);
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /** Supprime toutes les traces, après confirmation destructrice. */
    async _removeAllGpxTracks(this: PlanMapInternal): Promise<void> {
        const n = this._gpxTracks.length;
        if (!n) return;
        const ok = await confirmDialog({
            message: n === 1
                ? 'Supprimer la trace importée ? Cette action est irréversible.'
                : `Supprimer les ${n} traces importées ? Cette action est irréversible.`,
            confirmLabel: 'Supprimer',
            danger: true,
        });
        if (!ok) return;
        const ids = this._gpxTracks.map((t) => t.id);
        this._gpxTracks = [];
        for (const id of ids) {
            Reflect.deleteProperty(this._gpxCoords, id);
            GpxStore.delete(id).catch(() => { /* best-effort : jamais réaffichée */ });
        }
        saveIndex(this._gpxTracks);
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /** Supprime toutes les traces d'un jour opérationnel, après confirmation. */
    async _removeGpxDay(this: PlanMapInternal, day: string): Promise<void> {
        const boundary = gpxDayBoundary();
        const doomed = this._gpxTracks.filter((t) => dayOf(t, boundary) === day);
        if (!doomed.length) return;
        const label = day === '' ? 'non datées' : `du ${dayLabel(day)}`;
        const ok = await confirmDialog({
            message: doomed.length === 1
                ? `Supprimer la trace ${label} ? Cette action est irréversible.`
                : `Supprimer les ${doomed.length} traces ${label} ? Cette action est irréversible.`,
            confirmLabel: 'Supprimer',
            danger: true,
        });
        if (!ok) return;
        const ids = new Set(doomed.map((t) => t.id));
        this._gpxTracks = this._gpxTracks.filter((t) => !ids.has(t.id));
        for (const id of ids) {
            Reflect.deleteProperty(this._gpxCoords, id);
            GpxStore.delete(id).catch(() => { /* best-effort */ });
        }
        saveIndex(this._gpxTracks);
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /** Ouvre/ferme le panneau GPX (même mécanique que le panneau Calques). */
    _toggleGpxPanel(this: PlanMapInternal, force?: boolean): void {
        const panel = document.getElementById('plan_gpx_panel');
        const btn = document.getElementById('plan_btn_gpx');
        if (!panel) return;
        const open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
        panel.classList.toggle('open', open);
        if (btn) {
            btn.setAttribute('aria-expanded', String(open));
            btn.classList.toggle('active', open);
        }
        if (open) this._renderGpxList();
    },

    /**
     * Importe un ou plusieurs fichiers `.gpx`. Chaque fichier illisible est
     * signalé et ignoré : un lot n'échoue jamais en entier à cause d'un fichier.
     */
    async _importGpxFiles(this: PlanMapInternal, files: readonly File[]): Promise<void> {
        if (!files || !files.length) return;
        let added = 0;
        let rejected = 0;
        for (const file of files) {
            let parsed: ParsedGpx | null = null;
            try {
                parsed = parseGpx(await file.text());
            } catch {
                parsed = null;
            }
            if (!parsed) { rejected++; continue; }

            const id = `gpx_${Date.now()}_${this._gpxTracks.length + added}`;
            const color = GPX_COLORS[(this._gpxTracks.length + added) % GPX_COLORS.length] ?? '#a855f7';
            const bounds = trackTimeBounds(parsed.times);
            const track: PlanGpxTrack = {
                id, name: trackNameFrom(parsed, file.name), color, visible: true,
                startedAt: bounds.startedAt, endedAt: bounds.endedAt,
            };
            const data: GpxTrackData = { coords: parsed.segments, times: parsed.times };
            this._gpxCoords[id] = data;
            this._gpxTracks.push(track);
            try { await GpxStore.put(id, data); } catch { /* la trace reste en mémoire pour la séance */ }
            added++;
        }
        if (added) { saveIndex(this._gpxTracks); this._renderGpxLayers(); this._fitGpxTracks(); }
        this._renderGpxList();
        if (rejected) {
            window.alert(rejected === 1
                ? 'Fichier ignoré : ce n\'est pas un GPX exploitable (aucun point de tracé).'
                : `${rejected} fichiers ignorés : GPX non exploitables (aucun point de tracé).`);
        }
    },

    /** Bascule la visibilité d'une trace. */
    _toggleGpxTrack(this: PlanMapInternal, id: string): void {
        const t = this._gpxTracks.find((x) => x.id === id);
        if (!t) return;
        t.visible = !t.visible;
        saveIndex(this._gpxTracks);
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /** Supprime définitivement une trace (index, mémoire et IndexedDB). */
    _removeGpxTrack(this: PlanMapInternal, id: string): void {
        const i = this._gpxTracks.findIndex((x) => x.id === id);
        if (i < 0) return;
        this._gpxTracks.splice(i, 1);
        Reflect.deleteProperty(this._gpxCoords, id);
        saveIndex(this._gpxTracks);
        GpxStore.delete(id).catch(() => { /* best-effort : l'entrée devient orpheline, jamais affichée */ });
        this._renderGpxLayers();
        this._renderGpxList();
    },

    /**
     * Sous-menu transitoire : couleur d'une trace, ou d'un jour entier.
     * Réutilise `_openInlinePanel`, le mécanisme de panneau éphémère du dépôt :
     * il gère déjà la fermeture au clic extérieur, la touche Échap et le
     * nettoyage des écoutes. Rien à réinventer.
     */
    _openGpxColorMenu(this: PlanMapInternal, target: { id?: string; day?: string }): void {
        const titre = target.day !== undefined
            ? `Couleur du ${dayLabel(target.day)}`
            : 'Couleur de la trace';
        const el = this._openInlinePanel(null, `
            <p class="plan-gpx-menu-title">${escHtml(titre)}</p>
            ${swatchesHtml()}`, {
            centerScreen: true,
            onMount: (root: HTMLElement) => {
                root.querySelectorAll<HTMLElement>('[data-gpx-color]').forEach((b) => {
                    b.onclick = () => {
                        const c = b.dataset.gpxColor;
                        if (c) this._setGpxColor(target, c);
                        this._closeInlinePanel();
                    };
                });
            },
        });
        void el;
    },

    /** Sous-menu transitoire : actions portant sur un jour opérationnel. */
    _openGpxDayMenu(this: PlanMapInternal, day: string): void {
        const boundary = gpxDayBoundary();
        const list = this._gpxTracks.filter((t) => dayOf(t, boundary) === day);
        const anyVisible = list.some((t) => t.visible);
        this._openInlinePanel(null, `
            <p class="plan-gpx-menu-title">${escHtml(dayLabel(day))} — ${list.length} trace${list.length > 1 ? 's' : ''}</p>
            <div class="plan-gpx-menu-actions">
                <button type="button" class="plan-gpx-menu-btn" data-act="vis">
                    <span class="material-symbols-outlined">${anyVisible ? 'visibility_off' : 'visibility'}</span>
                    ${anyVisible ? 'Masquer ce jour' : 'Afficher ce jour'}
                </button>
                <button type="button" class="plan-gpx-menu-btn" data-act="color">
                    <span class="material-symbols-outlined">palette</span> Colorer ce jour
                </button>
                <button type="button" class="plan-gpx-menu-btn plan-gpx-menu-btn--danger" data-act="del">
                    <span class="material-symbols-outlined">delete</span> Supprimer ce jour
                </button>
            </div>`, {
            centerScreen: true,
            onMount: (root: HTMLElement) => {
                const on = (act: string, fn: () => void): void => {
                    const b = root.querySelector<HTMLElement>(`[data-act="${act}"]`);
                    if (b) b.onclick = fn;
                };
                on('vis', () => { this._closeInlinePanel(); this._setGpxDayVisible(day, !anyVisible); });
                // Le sous-menu de couleur remplace celui-ci : `_openInlinePanel`
                // ferme le précédent de lui-même.
                on('color', () => { this._openGpxColorMenu({ day }); });
                on('del', () => { this._closeInlinePanel(); void this._removeGpxDay(day); });
            },
        });
    },

    /** Sous-menu transitoire : colorer, en une couleur ou une par jour. */
    _openGpxColorAllMenu(this: PlanMapInternal): void {
        this._openInlinePanel(null, `
            <p class="plan-gpx-menu-title">Colorer les traces</p>
            <div class="plan-gpx-menu-actions">
                <button type="button" class="plan-gpx-menu-btn" data-act="byday">
                    <span class="material-symbols-outlined">calendar_month</span> Une couleur par jour
                </button>
            </div>
            <p class="plan-gpx-menu-title">Toutes de la même couleur</p>
            ${swatchesHtml()}`, {
            centerScreen: true,
            onMount: (root: HTMLElement) => {
                const byDay = root.querySelector<HTMLElement>('[data-act="byday"]');
                if (byDay) byDay.onclick = () => { this._closeInlinePanel(); this._colorGpxByDay(); };
                root.querySelectorAll<HTMLElement>('[data-gpx-color]').forEach((b) => {
                    b.onclick = () => {
                        const c = b.dataset.gpxColor;
                        this._closeInlinePanel();
                        if (c) this._setGpxColor({}, c);
                    };
                });
            },
        });
    },

    /** Sous-menu transitoire : réglages de tri et de découpage du jour. */
    _openGpxSettingsMenu(this: PlanMapInternal): void {
        const boundary = gpxDayBoundary();
        const recent = newestFirst();
        this._openInlinePanel(null, `
            <p class="plan-gpx-menu-title">Ordre de la liste</p>
            <div class="plan-gpx-menu-actions">
                <button type="button" class="plan-gpx-menu-btn" data-act="sort">
                    <span class="material-symbols-outlined">${recent ? 'arrow_downward' : 'arrow_upward'}</span>
                    ${recent ? 'Plus récentes d\'abord' : 'Plus anciennes d\'abord'}
                </button>
            </div>
            <p class="plan-gpx-menu-title">Début de la journée opérationnelle</p>
            <p class="plan-gpx-menu-hint">Une intervention de nuit reste entière dans le même jour. Mettre 0 pour retrouver le jour civil.</p>
            <div class="plan-gpx-menu-actions">
                <input type="number" id="plan_gpx_boundary" min="0" max="23" step="1" value="${boundary}"
                       class="plan-gpx-boundary" aria-label="Heure de début de la journée opérationnelle">
            </div>`, {
            centerScreen: true,
            onMount: (root: HTMLElement) => {
                const sort = root.querySelector<HTMLElement>('[data-act="sort"]');
                if (sort) sort.onclick = () => {
                    Persist.set(GPX_SORT_KEY, !recent);
                    this._closeInlinePanel();
                    this._renderGpxList();
                };
                const inp = root.querySelector<HTMLInputElement>('#plan_gpx_boundary');
                if (inp) inp.onchange = () => {
                    const h = Math.max(0, Math.min(23, Math.floor(Number(inp.value) || 0)));
                    Persist.set(GPX_DAY_BOUNDARY_KEY, h);
                    this._renderGpxList();
                };
            },
        });
    },

    /** Recadre la carte sur l'ensemble des traces visibles. */
    _fitGpxTracks(this: PlanMapInternal): void {
        const map = this.map;
        if (!map) return;
        let bounds: maplibregl.LngLatBounds | null = null;
        for (const t of this._gpxTracks) {
            if (!t.visible) continue;
            for (const seg of this._gpxCoords[t.id]?.coords ?? []) {
                for (const c of seg) {
                    if (!bounds) bounds = new maplibregl.LngLatBounds(c, c);
                    else bounds.extend(c);
                }
            }
        }
        if (!bounds) return;
        try { map.fitBounds(bounds, { padding: 60, maxZoom: 16 }); } catch { /* carte pas prête */ }
    },

    /**
     * Recharge les traces persistées. Appelé au montage de la carte : l'index
     * donne les métadonnées, IndexedDB les coordonnées. Une trace dont les
     * coordonnées ont disparu est retirée de l'index plutôt que laissée
     * fantôme dans le panneau.
     */
    async _loadGpxTracks(this: PlanMapInternal): Promise<void> {
        const index = loadIndex();
        if (!index.length) { this._renderGpxList(); return; }
        const kept: PlanGpxTrack[] = [];
        for (const t of index) {
            if (!t || typeof t.id !== 'string') continue;
            let data: GpxTrackData | null = null;
            try { data = await GpxStore.get(t.id); } catch { data = null; }
            if (!data || !data.coords.length) continue;
            this._gpxCoords[t.id] = data;
            // Les bornes sont RECALCULÉES depuis les temps réellement lus plutôt
            // que reprises de l'index : une trace enregistrée avant l'ajout des
            // horodatages n'en a pas, et une valeur d'index corrompue ne doit
            // pas survivre au rechargement.
            const bounds = trackTimeBounds(data.times);
            kept.push({
                id: t.id,
                name: String(t.name || 'Trace'),
                color: String(t.color || GPX_COLORS[0]),
                visible: t.visible !== false,
                startedAt: bounds.startedAt,
                endedAt: bounds.endedAt,
            });
        }
        this._gpxTracks = kept;
        if (kept.length !== index.length) saveIndex(kept);
        this._renderGpxLayers();
        this._renderGpxList();
    },
};
