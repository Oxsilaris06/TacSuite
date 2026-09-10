/**
 * gpx-play.ts — Rejeu animé des traces GPX (paquet `pm-gpxplay`).
 * ===========================================================================
 *
 * DEUX MODES, une seule mécanique.
 *   - « temps réel » : toutes les traces défilent sur la MÊME horloge. Une
 *     trace de 8 h à 9 h et une de 14 h à 15 h sont séparées par cinq heures
 *     de vide, et une équipe arrêtée reste immobile. C'est la chronologie
 *     réelle, ce qu'il faut pour reconstituer un engagement.
 *   - « progression » : chaque trace se dessine de son début à sa fin sur la
 *     même durée. Aucun temps mort, mais cela ment sur la simultanéité. Ne
 *     demande aucun horodatage : c'est le mode de repli des traces non datées.
 *
 * COMMENT LE RENDU TIENT 60 IMAGES PAR SECONDE — établi par prototype mesuré
 * dans le vrai navigateur, pas déduit :
 *   - Réécrire la géométrie à chaque image est ÉLIMINÉ : chaque `setData`
 *     réindexe tout le jeu et invalide toutes les tuiles. Avec dix traces de
 *     vingt mille points, les passes s'annulent et rien ne s'affiche.
 *   - `line-gradient` révèle la ligne côté GPU, sans jamais retoucher la
 *     géométrie : le nombre de points n'entre pas dans le coût par image.
 *     Mesuré : 120 changements de dégradé coûtent 2 ms de JavaScript.
 *   - Le dégradé ÉCRASE `line-color` (mesuré : une ligne rouge passe au bleu),
 *     et il REFUSE les expressions pilotées par la donnée. La couleur propre à
 *     chaque trace doit donc vivre DANS l'expression du dégradé, ce qui impose
 *     une couche par trace pendant la lecture. Ces couches sont créées au
 *     démarrage et détruites à l'arrêt : l'affichage normal, lui, garde sa
 *     couche unique colorée par la donnée.
 *   - `interpolate` et jamais `step` : `step` fait exploser la résolution de
 *     la texture de dégradé. Un front net s'obtient avec deux bornes très
 *     rapprochées.
 *   - `{ validate: false }` : sans lui la validation de style tourne à chaque
 *     image.
 *
 * La tête de lecture est un Marker DOM, comme les trajectoires du suivi Tchap :
 * un `transform` par image, zéro trafic worker.
 *
 * Règle du découpage (SPEC-PLANMAP-SPLIT.md §1.2) : ce module n'importe aucun
 * autre sous-module de méthodes ; seul `index.ts` les assemble.
 */

import maplibregl from 'maplibre-gl';

import { GPX_CASING_LAYER, GPX_LINE_LAYER, GPX_PLAY_SRC } from './constants.js';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { LngLatTuple, PlanGpxTrack, PlanMapInternal } from './types.js';

/** Durée de référence d'une lecture complète, en millisecondes, à vitesse 1. */
const BASE_DURATION_MS = 30_000;

/** Une trace préparée pour la lecture : segments raboutés + table de conversion. */
interface PlayTrack {
    id: string;
    color: string;
    /** Segments raboutés en UNE polyligne : `line-progress` est par feature. */
    coords: LngLatTuple[];
    /** Longueurs cumulées, même longueur que `coords`. */
    cum: number[];
    total: number;
    /** Table (instant, longueur parcourue) construite sur les seuls points datés. */
    table: Array<{ t: number; d: number }>;
    startedAt: number | null;
    endedAt: number | null;
}

interface PlayState {
    raf: number | null;
    playing: boolean;
    /** Progression globale, 0 à 1. */
    t: number;
    mode: 'real' | 'norm';
    speed: number;
    /** Horloge murale au dernier départ, et progression à cet instant. */
    wallAtResume: number;
    tAtResume: number;
    tracks: PlayTrack[];
    span: { from: number; to: number } | null;
    layerIds: string[];
    markers: Map<string, maplibregl.Marker>;
}

let state: PlayState | null = null;
/** Écoute d'occultation d'onglet posée une seule fois. */
let visibilityWired = false;

/** Distance géodésique en mètres. Même rayon que le reste du socle carto. */
function hav(a: LngLatTuple, b: LngLatTuple): number {
    const R = 6371000;
    const toRad = (d: number): number => (d * Math.PI) / 180;
    const phi1 = toRad(a[1]);
    const phi2 = toRad(b[1]);
    const dPhi = toRad(b[1] - a[1]);
    const dLambda = toRad(b[0] - a[0]);
    const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Prépare une trace : raboute ses segments, calcule les longueurs cumulées, et
 * construit la table (instant, longueur) sur les seuls points datés.
 *
 * Le raboutage trace un segment droit entre deux tronçons — le prix à payer
 * pour que `line-progress`, qui est une fraction de la longueur d'UNE feature,
 * désigne bien la progression sur TOUTE la trace. L'affichage normal, lui,
 * garde les tronçons séparés.
 */
export function buildPlayTrack(
    track: PlanGpxTrack,
    coordSegs: readonly LngLatTuple[][],
    timeSegs: readonly (number | null)[][] | null,
): PlayTrack | null {
    const coords: LngLatTuple[] = [];
    const times: (number | null)[] = [];
    coordSegs.forEach((seg, si) => {
        seg.forEach((c, pi) => {
            coords.push(c);
            times.push(timeSegs?.[si]?.[pi] ?? null);
        });
    });
    if (coords.length < 2) return null;

    const cum: number[] = [0];
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        cum.push((cum[i - 1] ?? 0) + (a && b ? hav(a, b) : 0));
    }
    const total = cum[cum.length - 1] ?? 0;
    if (total <= 0) return null;

    // Table strictement croissante en temps : un horodatage qui recule (pause
    // GPS, fusion de fichiers) casserait la recherche dichotomique.
    const table: Array<{ t: number; d: number }> = [];
    for (let i = 0; i < coords.length; i++) {
        const t = times[i];
        if (t === null || t === undefined) continue;
        const last = table[table.length - 1];
        if (last && t <= last.t) continue;
        table.push({ t, d: cum[i] ?? 0 });
    }

    return {
        id: track.id,
        color: track.color,
        coords,
        cum,
        total,
        table,
        startedAt: table[0]?.t ?? null,
        endedAt: table[table.length - 1]?.t ?? null,
    };
}

/**
 * Fraction de longueur parcourue par une trace à l'instant `now`.
 * Avant son début : 0, la trace n'est pas encore apparue. Après sa fin : 1.
 */
export function progressAtTime(track: PlayTrack, now: number): number {
    const { table, total } = track;
    const first = table[0];
    const last = table[table.length - 1];
    if (!first || !last || total <= 0) return 0;
    if (now <= first.t) return 0;
    if (now >= last.t) return 1;

    let lo = 0;
    let hi = table.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const m = table[mid];
        if (!m) break;
        if (m.t <= now) lo = mid; else hi = mid;
    }
    const a = table[lo];
    const b = table[hi];
    if (!a || !b) return 0;
    const span = b.t - a.t;
    const u = span > 0 ? (now - a.t) / span : 0;
    return (a.d + (b.d - a.d) * u) / total;
}

/** Point situé à la fraction `p` de la longueur, via les cumuls précalculés. */
export function pointAtFraction(track: PlayTrack, p: number): LngLatTuple {
    const first = track.coords[0] ?? [0, 0];
    const target = Math.max(0, Math.min(1, p)) * track.total;
    let lo = 0;
    let hi = track.cum.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if ((track.cum[mid] ?? 0) <= target) lo = mid; else hi = mid;
    }
    const a = track.coords[lo];
    const b = track.coords[hi];
    const da = track.cum[lo] ?? 0;
    const db = track.cum[hi] ?? 0;
    if (!a || !b) return first;
    const seg = db - da;
    const u = seg > 0 ? (target - da) / seg : 0;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** Identifiant de la couche de lecture d'une trace. */
function playLayerId(id: string): string {
    return `plan-gpx-play-${id}`;
}

/**
 * Expression de dégradé révélant la trace jusqu'à `p`.
 * `interpolate` et JAMAIS `step` : `step` fait exploser la résolution de la
 * texture. Le front net vient de deux bornes très rapprochées.
 */
function gradientFor(color: string, p: number): ExpressionSpecification {
    const cut = Math.max(0.0001, Math.min(0.9999, p));
    return [
        'interpolate', ['linear'], ['line-progress'],
        0, color,
        cut, color,
        Math.min(1, cut + 0.001), 'rgba(0,0,0,0)',
        1, 'rgba(0,0,0,0)',
    ] as ExpressionSpecification;
}

/** Libellé d'horodatage affiché sous le curseur, ou progression en pourcentage. */
export function playClockLabel(s: { mode: 'real' | 'norm'; span: { from: number; to: number } | null; t: number }): string {
    if (s.mode === 'real' && s.span) {
        const now = s.span.from + (s.span.to - s.span.from) * s.t;
        return new Date(now).toLocaleString('fr-FR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }
    return `${Math.round(s.t * 100)} %`;
}

export const GpxPlayMethods = {
    /** La lecture est-elle en cours ou en pause, c'est-à-dire les couches posées ? */
    _isGpxPlaying(this: PlanMapInternal): boolean {
        return state !== null;
    },

    /**
     * Prépare la lecture : source dédiée, une couche par trace, tête de lecture.
     * Les couches d'affichage normal sont masquées le temps du rejeu — le
     * dégradé écrasant `line-color`, on ne peut pas faire les deux sur la même.
     */
    _startGpxPlayback(this: PlanMapInternal, mode: 'real' | 'norm'): void {
        const map = this.map;
        if (!map) return;
        this._stopGpxPlayback();

        const tracks: PlayTrack[] = [];
        for (const t of this._gpxTracks) {
            if (!t.visible) continue;
            const data = this._gpxCoords[t.id];
            if (!data) continue;
            const built = buildPlayTrack(t, data.coords, data.times);
            if (built) tracks.push(built);
        }
        if (!tracks.length) return;

        // Le mode « temps réel » exige au moins une trace datée : sans horloge
        // commune, il n'aurait rien à raconter. On retombe alors sur la
        // progression, plutôt que de refuser la lecture.
        const dated = tracks.filter((t) => t.table.length >= 2);
        const effective: 'real' | 'norm' = mode === 'real' && dated.length ? 'real' : 'norm';
        const span = effective === 'real'
            ? {
                from: Math.min(...dated.map((t) => t.startedAt ?? Infinity)),
                to: Math.max(...dated.map((t) => t.endedAt ?? -Infinity)),
            }
            : null;

        try {
            if (!map.getSource(GPX_PLAY_SRC)) {
                map.addSource(GPX_PLAY_SRC, {
                    type: 'geojson',
                    // Indispensable à `line-progress` : sans métriques de ligne,
                    // le dégradé n'a aucune abscisse à interpoler.
                    lineMetrics: true,
                    data: { type: 'FeatureCollection', features: [] },
                });
            }
            const src = map.getSource(GPX_PLAY_SRC);
            if (src && 'setData' in src && typeof src.setData === 'function') {
                src.setData({
                    type: 'FeatureCollection',
                    features: tracks.map((t) => ({
                        type: 'Feature' as const,
                        geometry: { type: 'LineString' as const, coordinates: t.coords },
                        properties: { gpxId: t.id },
                    })),
                });
            }
        } catch {
            return;
        }

        const layerIds: string[] = [];
        const markers = new Map<string, maplibregl.Marker>();
        for (const t of tracks) {
            const id = playLayerId(t.id);
            try {
                if (!map.getLayer(id)) {
                    map.addLayer({
                        id,
                        type: 'line',
                        source: GPX_PLAY_SRC,
                        filter: ['==', ['get', 'gpxId'], t.id],
                        layout: { 'line-cap': 'round', 'line-join': 'round' },
                        paint: { 'line-width': 4, 'line-gradient': gradientFor(t.color, 0) },
                    }, map.getLayer(GPX_LINE_LAYER) ? GPX_LINE_LAYER : undefined);
                }
                layerIds.push(id);
            } catch { /* style pas prêt : la trace ne sera pas rejouée */ }

            const el = document.createElement('div');
            el.className = 'plan-gpx-head-marker';
            el.style.background = t.color;
            const head = t.coords[0] ?? [0, 0];
            try {
                markers.set(t.id, new maplibregl.Marker({ element: el, anchor: 'center' })
                    .setLngLat(head).addTo(map));
            } catch { /* idem */ }
        }

        // Masquer l'affichage normal : le dégradé écrase `line-color`, les deux
        // rendus ne peuvent pas coexister sur la même couche.
        for (const l of [GPX_LINE_LAYER, GPX_CASING_LAYER]) {
            try { if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'none'); } catch { /* idem */ }
        }

        state = {
            raf: null, playing: false, t: 0, mode: effective, speed: 1,
            wallAtResume: 0, tAtResume: 0, tracks, span, layerIds, markers,
        };
        this._renderGpxPlayFrame();
        this._toggleGpxPlayer(true);
        this._resumeGpxPlayback();
    },

    /** Coupe la lecture, retire couches, marqueurs et source, rend l'affichage normal. */
    _stopGpxPlayback(this: PlanMapInternal): void {
        const map = this.map;
        if (!state) { this._toggleGpxPlayer(false); return; }
        if (state.raf !== null) cancelAnimationFrame(state.raf);
        for (const m of state.markers.values()) {
            try { m.remove(); } catch { /* déjà retiré */ }
        }
        if (map) {
            for (const id of state.layerIds) {
                try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* idem */ }
            }
            try { if (map.getSource(GPX_PLAY_SRC)) map.removeSource(GPX_PLAY_SRC); } catch { /* idem */ }
            for (const l of [GPX_LINE_LAYER, GPX_CASING_LAYER]) {
                try { if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'visible'); } catch { /* idem */ }
            }
        }
        state = null;
        this._toggleGpxPlayer(false);
    },

    /** Reprend la lecture depuis la position courante. */
    _resumeGpxPlayback(this: PlanMapInternal): void {
        if (!state || state.playing) return;
        // Arrivé au bout, un nouveau départ rembobine plutôt que de ne rien faire.
        if (state.t >= 1) state.t = 0;
        state.playing = true;
        state.wallAtResume = Date.now();
        state.tAtResume = state.t;
        // Suspension à l'occultation de l'onglet. Le navigateur ralentit déjà
        // les images, mais l'horloge murale, elle, continue d'avancer : sans
        // pause explicite la lecture saute de plusieurs minutes au retour.
        if (!visibilityWired && typeof document !== 'undefined') {
            visibilityWired = true;
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && state?.playing) this._pauseGpxPlayback();
            });
        }
        const tick = (): void => {
            if (!state || !state.playing) return;
            const elapsed = Date.now() - state.wallAtResume;
            const duration = BASE_DURATION_MS / state.speed;
            state.t = Math.min(1, state.tAtResume + elapsed / duration);
            this._renderGpxPlayFrame();
            if (state.t >= 1) { this._pauseGpxPlayback(); return; }
            state.raf = requestAnimationFrame(tick);
        };
        state.raf = requestAnimationFrame(tick);
        this._refreshGpxPlayer();
    },

    /** Bascule lecture / pause. */
    _toggleGpxPlayPause(this: PlanMapInternal): void {
        if (!state) return;
        if (state.playing) this._pauseGpxPlayback(); else this._resumeGpxPlayback();
    },

    /** Met la lecture en pause sans démonter quoi que ce soit. */
    _pauseGpxPlayback(this: PlanMapInternal): void {
        if (!state || !state.playing) return;
        if (state.raf !== null) cancelAnimationFrame(state.raf);
        state.raf = null;
        state.playing = false;
        this._refreshGpxPlayer();
    },

    /** Positionne la lecture à une progression donnée, 0 à 1. */
    _seekGpxPlayback(this: PlanMapInternal, t: number): void {
        if (!state) return;
        state.t = Math.max(0, Math.min(1, t));
        state.tAtResume = state.t;
        state.wallAtResume = Date.now();
        this._renderGpxPlayFrame();
        this._refreshGpxPlayer();
    },

    /** Change la vitesse sans interrompre la lecture. */
    _setGpxPlaySpeed(this: PlanMapInternal, speed: number): void {
        if (!state) return;
        state.tAtResume = state.t;
        state.wallAtResume = Date.now();
        state.speed = speed;
        this._refreshGpxPlayer();
    },

    /** Bascule entre horloge partagée et progression normalisée. */
    _setGpxPlayMode(this: PlanMapInternal, mode: 'real' | 'norm'): void {
        if (!state) return;
        if (mode === 'real' && !state.span) return; // aucune trace datée
        state.mode = mode;
        this._renderGpxPlayFrame();
        this._refreshGpxPlayer();
    },

    /**
     * Une image : le dégradé de chaque trace, et sa tête de lecture.
     * Le dégradé est la seule écriture par image ; la géométrie ne bouge pas.
     */
    _renderGpxPlayFrame(this: PlanMapInternal): void {
        const map = this.map;
        if (!map || !state) return;
        const s = state;
        const now = s.span ? s.span.from + (s.span.to - s.span.from) * s.t : 0;
        for (const t of s.tracks) {
            const p = s.mode === 'real' && s.span ? progressAtTime(t, now) : s.t;
            try {
                if (map.getLayer(playLayerId(t.id))) {
                    // `validate: false` : sans lui la validation de style
                    // tournerait à chaque image.
                    map.setPaintProperty(playLayerId(t.id), 'line-gradient',
                        gradientFor(t.color, p), { validate: false });
                }
            } catch { /* style en cours de rechargement */ }
            const m = s.markers.get(t.id);
            if (m) {
                try {
                    m.setLngLat(pointAtFraction(t, p));
                    const el = m.getElement();
                    // Une trace pas encore commencée, ou déjà finie, n'a pas de
                    // tête de lecture à montrer.
                    el.style.opacity = p <= 0 || p >= 1 ? '0' : '1';
                } catch { /* marqueur retiré entre-temps */ }
            }
        }
        this._refreshGpxPlayer();
    },

    /** Affiche ou masque la barre de lecture. */
    _toggleGpxPlayer(this: PlanMapInternal, show: boolean): void {
        const bar = document.getElementById('plan_gpx_player');
        if (bar) bar.hidden = !show;
    },

    /** Remet la barre de lecture à l'état courant : bouton, curseur, horloge. */
    _refreshGpxPlayer(this: PlanMapInternal): void {
        const bar = document.getElementById('plan_gpx_player');
        if (!bar || !state) return;
        const s = state;
        const icon = bar.querySelector<HTMLElement>('#plan_gpx_playpause .material-symbols-outlined');
        if (icon) icon.textContent = s.playing ? 'pause' : 'play_arrow';
        const range = bar.querySelector<HTMLInputElement>('#plan_gpx_seek');
        // Ne pas réécrire pendant que l'utilisateur fait glisser le curseur.
        if (range && document.activeElement !== range) range.value = String(Math.round(s.t * 1000));
        const clock = bar.querySelector<HTMLElement>('#plan_gpx_clock');
        if (clock) clock.textContent = playClockLabel(s);
        const modeBtn = bar.querySelector<HTMLElement>('#plan_gpx_mode');
        if (modeBtn) {
            modeBtn.textContent = s.mode === 'real' ? 'Temps réel' : 'Progression';
            modeBtn.title = s.mode === 'real'
                ? 'Horloge partagée : les traces défilent à leur heure réelle. Cliquer pour passer en progression.'
                : 'Progression : chaque trace se dessine sur la même durée. Cliquer pour passer en temps réel.';
            modeBtn.toggleAttribute('disabled', s.span === null);
        }
        const speedBtn = bar.querySelector<HTMLElement>('#plan_gpx_speed');
        if (speedBtn) speedBtn.textContent = `×${s.speed}`;
    },
};

/** Réinitialise l'état du module. Réservé aux tests. */
export function __resetGpxPlayState(): void {
    state = null;
    visibilityWired = false;
}
