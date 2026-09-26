/**
 * capture.ts — CAPTURE : téléchargement ou export vers un champ photo de l'OI
 * (P3.CONV, paquet `oi-carto-panels-capture`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM des 6 méthodes de la section « CAPTURE » de
 * `oi_cartographie.js` (GStart-main, lecture seule, lignes 1160-1308) :
 * `_openCaptureModal` (:1164), `_closeCaptureModal` (:1177),
 * `_getPhotoTargets` (:1185), `_captureCanvas` (:1215), `_downloadCapture`
 * (:1262), `_exportToField` (:1281). Cf. `docs/SPEC-OI-CONVERSION.md`
 * §6.2/§6.3/§6.5, `PAQUETS-OI.json` (`oi-carto-panels-capture`).
 *
 * RÈGLE D'OR (SPEC §2.2/§6.5) : `handleFileChange` et `toast` sont résolus
 * globalement dans l'original AVEC gardes (`typeof ... === 'function'` :1283,
 * :1302) → portés en `window.handleFileChange`, MÊME garde — PAS d'import de
 * `@oi/medias.js` (`carto/*` ne dépend d'aucun paquet médias, §6.5). `toast`
 * vient de `@shared/feedback.js` (U19 — système de toast unique).
 *
 * Adaptations de TYPAGE PUR (aucune restructuration de logique, règle commune
 * §3/§9) :
 *   - `typeof html2canvas` (:1216) réécrit en test de forme
 *     (`!== 'function'` au lieu de `=== 'undefined'`) : `html2canvas` est
 *     désormais un import npm statique (SPEC §6.5) et non plus un global de
 *     script classique — branchement inchangé.
 *   - `this.map` capturé en `const map` dès la garde d'entrée de
 *     `_captureCanvas` : une propriété (par opposition à une variable locale)
 *     perd son narrowing TS après tout appel de fonction intermédiaire ;
 *     idiome déjà en place dans `@pctac/planmap/capture.ts`.
 *   - `[...].filter(Boolean)` (:1223-1228) → prédicat de type explicite
 *     `(el): el is HTMLElement => !!el` (`Boolean` référencé nu ne fait pas
 *     narrower `(HTMLElement|null)[]` → `HTMLElement[]`), même filtrage ;
 *     même adaptation que `@pctac/planmap/capture.ts`.
 *   - `getContext('2d')` (:1249) est nullable côté TS (jsdom ne l'implémente
 *     d'ailleurs pas, paquet `canvas` absent des dépendances) : un `throw`
 *     réutilise le MÊME chemin d'erreur que le `catch` de la méthode (alerte
 *     + `outCanvas = null` + restauration `toHide` dans le `finally`) —
 *     comportement observable identique à toute autre panne de capture.
 *   - `catch (e)` : `unknown` (`useUnknownInCatchVariables`, inclus dans
 *     `strict`), narrowing `e instanceof Error` avant `.message` (idiome déjà
 *     en place, `src/shared/ui-platform.ts`).
 *
 * Source : `GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 *
 * DURCISSEMENTS PORTÉS DE `@pctac/planmap/capture.ts` (mission R3-e, dernière
 * tranche carto) — cette chaîne y a été fiabilisée par ~35 correctifs
 * successifs (« épinglage px des conteneurs = cause n°1 des markers amputés »,
 * `planmap/capture.ts` :6-9). `_captureCanvas` (ci-dessous) porte les
 * correctifs génériques (applicables à tout pipeline html2canvas + markers
 * MapLibre) SANS les features PC-Tac absentes d'OI (poignées de dessin,
 * boussole, attente `idle`/tuiles, contrôles de précision) :
 *   1. Vue masquée (`offsetWidth` nul) → retour franc AVANT de toucher au DOM
 *      (`planmap/capture.ts:41`).
 *   2. Canvas WebGL transitoirement à 0 (entrée/sortie plein écran) → un
 *      re-test après un cycle de rAF, sinon retour `null` (`:44-51`).
 *   3. Verrou anti-concurrence `_captureBusy` (`:55-56`, cf. `types.ts`) :
 *      une 2e capture pendant la 1re snapshoterait des styles déjà
 *      masqués/aplatis comme « originaux » et gèlerait l'UI au restore.
 *   4. UI flottante transitoire (roue active, panneau inline) ajoutée à
 *      `toHide` (`:79`, `:78` — adapté à l'architecture OI : instance unique
 *      `this._activeWheel`/`this._inlinePanel`, pas de sélecteurs de classe).
 *   5. Épinglage PIXEL des marqueurs (`transform`→`position:absolute` figé
 *      AVANT html2canvas, restauré au `finally`) + épinglage PIXEL de la
 *      chaîne de conteneurs (`data-h2c-pin` + `onclone`) — LE durcissement
 *      cité en tête de `planmap/capture.ts` (`:132-163`, `:188-231`).
 *   6. Garde-fou `dpr` (fini, positif) replié sur `devicePixelRatio` (`:171-173`).
 *
 * CAPTURE D'IMPRESSION (audit PDF du 2026-09-25, F12, point 10) : attente de
 * l'événement `idle` (au plus `CAPTURE_IDLE_TIMEOUT_MS`, message si dépassé),
 * refus d'une carte vide, uniforme ou trouée (hors ligne compris), boutons et
 * échelle de MapLibre masqués, attribution dépliée, définition doublée bornée
 * par la carte graphique (4096 px de côté au plus, limite d'iOS), flèche du
 * nord et échelle incrustées.
 */

import html2canvas from 'html2canvas';

import { toast } from '@shared/feedback.js';
import { legacyCaptureColors } from '@shared/h2c-colors.js';
import { drawOverlayLegend, overlayLegend } from '@shared/map-overlays.js';

import { OI_BAPTEME_CONTAINER } from '@oi/sections.js';
import type { OICartoInternal, OiCartoPhotoTarget } from './types.js';
import { esc } from '@shared/ui-platform.js';

/** Attente maximale du rendu de la carte avant capture (tuiles, nouvelle définition). */
export const CAPTURE_IDLE_TIMEOUT_MS = 8000;
/** Côté maximal du canvas : `maxCanvasSize` par défaut de MapLibre, limite des canvas d'iOS. */
const CAPTURE_MAX_SIDE_PX = 4096;

/**
 * Densité de pixels de la capture : au moins le double de l'écran (ou la
 * densité réelle si elle est plus forte), sans dépasser 4096 px de côté (iOS)
 * ni la taille de texture de la carte graphique.
 */
export function capturePixelRatio(cssW: number, cssH: number, dpr: number, maxTextureSize: number): number {
    const maxSide = Math.min(CAPTURE_MAX_SIDE_PX, maxTextureSize > 0 ? maxTextureSize : CAPTURE_MAX_SIDE_PX);
    return Math.min(Math.max(2, dpr), maxSide / Math.max(cssW, cssH, 1));
}

/** `MAX_TEXTURE_SIZE` du contexte WebGL déjà ouvert par MapLibre (aucun contexte créé), 4096 à défaut. */
function maxTextureSize(canvas: HTMLCanvasElement): number {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    const v: unknown = gl?.getParameter?.(0x0d33 /* MAX_TEXTURE_SIZE */);
    return typeof v === 'number' && v > 0 ? v : CAPTURE_MAX_SIDE_PX;
}

/**
 * Verdict sur un échantillon RGBA du canvas de la carte. Sans couche de fond,
 * une tuile absente (hors ligne, pas encore chargée) laisse le canvas
 * TRANSPARENT à sa place (audit F12 : capture hors ligne « entièrement
 * noire »). Vide : presque tout transparent, ou image uniforme ; incomplète :
 * plus de 2 % de trous.
 */
export function mapSampleVerdict(rgba: Uint8ClampedArray): 'vide' | 'incomplete' | 'ok' {
    const n = rgba.length / 4;
    let holes = 0;
    const lo = [255, 255, 255, 255];
    const hi = [0, 0, 0, 0];
    for (let i = 0; i < rgba.length; i += 4) {
        if ((rgba[i + 3] ?? 0) < 128) holes++;
        for (let c = 0; c < 4; c++) {
            const v = rgba[i + c] ?? 0;
            if (v < (lo[c] ?? 0)) lo[c] = v;
            if (v > (hi[c] ?? 0)) hi[c] = v;
        }
    }
    const uniform = lo.every((v, c) => (hi[c] ?? 0) - v <= 8);
    if (n === 0 || uniform || holes / n >= 0.98) return 'vide';
    return holes / n > 0.02 ? 'incomplete' : 'ok';
}

/** Barre d'échelle ronde (1, 2 ou 5 × 10ⁿ m) la plus longue tenant dans `maxPx`. */
export function niceScale(metersPerPx: number, maxPx: number): { meters: number; px: number; label: string } | null {
    if (!(metersPerPx > 0) || !Number.isFinite(metersPerPx) || !(maxPx > 0)) return null;
    const maxM = metersPerPx * maxPx;
    const pow = 10 ** Math.floor(Math.log10(maxM));
    const meters = [5, 2, 1].map((k) => k * pow).find((m) => m <= maxM) ?? pow;
    return { meters, px: meters / metersPerPx, label: meters >= 1000 ? `${meters / 1000} km` : `${meters} m` };
}

/** Échantillon RGBA réduit (`size`²) d'un canvas, ou null sans contexte 2D. */
function sampleCanvas(source: HTMLCanvasElement, size = 64): Uint8ClampedArray | null {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size).data;
}

/** Attend l'événement `idle` (rendu fini, tuiles visibles chargées), au plus `ms` ; false si le délai est dépassé. */
function waitForIdle(map: NonNullable<OICartoInternal['map']>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
        const onIdle = (): void => { clearTimeout(timer); resolve(true); };
        const timer = setTimeout(() => { map.off('idle', onIdle); resolve(false); }, ms);
        map.once('idle', onIdle);
        map.triggerRepaint();
    });
}

/** Message de refus d'une capture sans fond de carte, selon la connexion. */
function captureRefusal(verdict: 'vide' | 'incomplete'): string {
    const offline = navigator.onLine === false;
    if (verdict === 'vide') {
        return offline
            ? "Capture refusée : hors ligne, le fond de carte de cette zone n'a jamais été chargé. Revenez sur une zone déjà affichée en ligne."
            : 'Capture refusée : la carte est vide (fond de carte non chargé). Attendez son affichage, puis recommencez.';
    }
    return offline
        ? 'Capture refusée : hors ligne, une partie du fond de carte manque (zones vides).'
        : "Capture refusée : une partie du fond de carte n'est pas encore chargée. Attendez quelques secondes, puis recommencez.";
}

/**
 * Ligne d'état de la fenêtre de capture. Un toast serait CACHÉ ici : la carte
 * et cette fenêtre sont des `<dialog>` modales (couche supérieure du
 * navigateur), au-dessus du conteneur des toasts. Message vide : ligne masquée.
 */
function setCaptureStatus(message: string, kind: 'info' | 'error' = 'info'): void {
    const modal = document.getElementById('oi_carto_capture_modal');
    if (!modal) return;
    let line = modal.querySelector<HTMLElement>('.oi-carto-capture-status');
    if (!line) {
        line = document.createElement('p');
        line.className = 'oi-carto-capture-status';
        line.style.cssText = 'margin: 12px 0; line-height: 1.4;';
        const hint = modal.querySelector('.hint-text-top');
        if (hint) hint.after(line);
        else (modal.querySelector('.modal-content') ?? modal).appendChild(line);
    }
    line.textContent = message;
    line.hidden = !message;
    line.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    line.style.color = kind === 'error' ? 'var(--danger-red, #ef4444)' : 'var(--text-secondary, inherit)';
}

/**
 * Flèche du nord (tournée avec la carte) et, dessous, barre d'échelle,
 * toujours incrustées en haut à gauche, à la place des boutons masqués : une
 * carte tournée ne sort plus sans nord (audit F12). Le bas de l'image reste à
 * l'attribution (dépliée sur deux lignes sur téléphone) et à la légende.
 */
function drawNorthAndScale(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    bearingDeg: number,
    scale: { px: number; label: string } | null,
): void {
    const m = 10 * dpr;
    // Tailles pensées pour l'impression : l'image (2 880 px) occupe ~275 mm,
    // soit ~10 px/mm ; texte de 15 px CSS ≈ 8 pt sur le papier.
    const r = 22 * dpr;
    ctx.save();
    ctx.translate(m + r, m + r);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.rotate((-bearingDeg * Math.PI) / 180);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.5);
    ctx.lineTo(r * 0.3, r * 0.45);
    ctx.lineTo(0, r * 0.25);
    ctx.lineTo(-r * 0.3, r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.font = `700 ${Math.round(12 * dpr)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -r * 0.74);
    ctx.restore();
    if (!scale) return;
    ctx.save();
    const pad = 6 * dpr;
    const bar = 4 * dpr;
    const fontPx = Math.round(15 * dpr);
    ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
    const boxW = Math.max(scale.px, ctx.measureText(scale.label).width) + 2 * pad;
    const boxH = fontPx + bar + 3 * pad;
    const x = m;
    const y = 2 * m + 2 * r;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(scale.label, x + pad, y + pad);
    const barY = y + boxH - pad - bar;
    ctx.fillRect(x + pad, barY, scale.px, bar);
    ctx.fillRect(x + pad, barY - bar, dpr * 1.5, 2 * bar);
    ctx.fillRect(x + pad + scale.px - dpr * 1.5, barY - bar, dpr * 1.5, 2 * bar);
    ctx.restore();
}

export const CaptureMethods = {
    // oi_cartographie.js:1164-1175
    _openCaptureModal(this: OICartoInternal): void {
        const modal = document.getElementById('oi_carto_capture_modal') as HTMLDialogElement | null;
        if (!modal) return;
        const sel = document.getElementById('oi_carto_capture_target') as HTMLSelectElement | null;
        if (sel) {
            const targets = this._getPhotoTargets();
            sel.innerHTML = targets.length
                ? targets.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')
                : '<option value="">Aucun champ photo disponible</option>';
        }
        setCaptureStatus('');
        if (!modal.open) modal.showModal();
    },

    // oi_cartographie.js:1177-1180
    _closeCaptureModal(): void {
        const modal = document.getElementById('oi_carto_capture_modal') as HTMLDialogElement | null;
        if (modal && modal.open) modal.close();
    },

    /** Liste des conteneurs photo de l'OI ciblables par l'export.
     *  Champs statiques (Transport ×2, et « Baptême terrain » sous la Mission en
     *  OI Complet) + champs par bloc dynamique (MOICP, ZMSPCP pour l'Emplacement
     *  AO seulement, Effraction), étiquetés avec le titre éditable du bloc. */
    // oi_cartographie.js:1185-1210
    _getPhotoTargets(): OiCartoPhotoTarget[] {
        const targets: OiCartoPhotoTarget[] = [
            // OI express : photo « Carte » de l'étape Situation, proposée EN PREMIER
            // (donc par défaut) seulement en mode express.
            ...(document.body.classList.contains('oi-express')
                ? [{ id: 'photo_container_express_carte_preview_container', label: 'OI Express — Carte' }]
                : []),
            { id: 'photo_container_transport_pr_preview_container', label: 'Transport PSIG → PR' },
            { id: 'photo_container_transport_domicile_preview_container', label: 'Transport PR → Domicile / LE' },
            // Champ unique sous la Mission (Nico 09-26), OI Complet seulement.
            ...(document.body.classList.contains('oi-express') ? [] : [{ id: OI_BAPTEME_CONTAINER, label: 'Baptême terrain' }]),
        ];
        const titleOf = (block: HTMLElement, fallback: string): string =>
            (block.querySelector<HTMLInputElement>('.block-title-input')?.value || fallback).trim();
        document.querySelectorAll<HTMLElement>('.moicp-block').forEach((b) => {
            const bid = b.dataset.blockId;
            const t = titleOf(b, 'MOICP');
            targets.push({ id: `photo_itin_ext_${bid}`, label: `Cheminement extérieur — ${t}` });
            targets.push({ id: `photo_itin_int_${bid}`, label: `Cheminement intérieur — ${t}` });
        });
        document.querySelectorAll<HTMLElement>('.zmspcp-block').forEach((b) => {
            const bid = b.dataset.blockId;
            const t = titleOf(b, 'ZMSPCP');
            targets.push({ id: `photo_empl_ao_${bid}`, label: `Emplacement AO — ${t}` });
        });
        document.querySelectorAll<HTMLElement>('.effraction-block').forEach((b) => {
            const bid = b.dataset.blockId;
            const t = titleOf(b, 'Effraction');
            targets.push({ id: `photo_effrac_${bid}`, label: `Photo effraction — ${t}` });
        });
        return targets.filter((t) => document.getElementById(t.id));
    },

    /** Capture composite : canvas WebGL MapLibre + overlay DOM (UI flottante exclue).
     *  Fonctionne aussi en plein écran — on ne passe jamais html2canvas sur tout
     *  le conteneur (ce qui produirait un canvas démesuré). */
    // oi_cartographie.js:1215-1260
    async _captureCanvas(this: OICartoInternal): Promise<HTMLCanvasElement | null> {
        if (typeof html2canvas !== 'function') {
            toast('Librairie html2canvas indisponible (réseau ?).', { kind: 'error' });
            return null;
        }
        const mapContainer = document.getElementById('oi_carto_map_wrap');
        const map = this.map;
        if (!mapContainer || !map) return null;

        // DURCISSEMENT 1 (porté de `@pctac/planmap/capture.ts:41`) : vue cachée
        // (display:none / autre onglet) → `offsetWidth` reste à 0, capture
        // impossible. On le dit franchement AVANT de toucher au DOM (masquage
        // toolbar, etc.).
        if (!mapContainer.offsetWidth) return null;

        // DURCISSEMENT 2 (porté de `@pctac/planmap/capture.ts:44-51`) : canvas
        // WebGL transitoirement à 0 (entrée/sortie plein écran) — on laisse le
        // layout se poser puis on re-teste, au lieu de calculer un `dpr` infini
        // (`w / clientWidth` avec `clientWidth` nul) ou d'échouer inutilement.
        if (!map.getCanvas().clientWidth) {
            // Adaptation TS : `requestAnimationFrame` appelle son callback avec un
            // timestamp `number` ; le résolveur d'un `Promise<void>` n'accepte que
            // `void` — `() => r()` ignore l'argument, comportement identique.
            await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
            if (!map.getCanvas().clientWidth) return null;
        }

        // DURCISSEMENT 3 (porté de `@pctac/planmap/capture.ts:55-56`) : verrou
        // anti-concurrence — une 2e capture pendant la 1re snapshoterait les
        // styles déjà masqués/aplatis comme « originaux » et gèlerait l'UI au
        // restore (cf. commentaire `_captureBusy`, `types.ts`).
        if (this._captureBusy) return null;
        this._captureBusy = true;

        // DURCISSEMENT 4 (porté de `@pctac/planmap/capture.ts:78-79`) : l'UI
        // flottante transitoire (roue d'options active, panneau inline) ne doit
        // pas apparaître dans la capture — adapté à l'architecture OI (instance
        // UNIQUE `this._activeWheel`/`this._inlinePanel`, pas de sélecteurs de
        // classe multi-instances comme côté PC-Tac).
        const toHide = [
            document.querySelector<HTMLElement>('.oi-carto-toolbar'),
            document.getElementById('oi_carto_draw_dock'),
            document.getElementById('oi_carto_search_panel'),
            document.getElementById('oi_carto_layers_panel'),
            document.getElementById('oi_carto_hint'),
            this._activeWheel?.element ?? null,
            this._inlinePanel,
            // Boutons (zoom, boussole) et échelle de MapLibre : l'échelle et le
            // nord sont redessinés à la définition de l'image (audit F12).
            ...Array.from(mapContainer.querySelectorAll<HTMLElement>('.maplibregl-ctrl-group, .maplibregl-ctrl-scale')),
        ].filter((el): el is HTMLElement => !!el);
        const memo = toHide.map((el) => el.style.display);
        toHide.forEach((el) => { el.style.display = 'none'; });
        // Attribution (© IGN, © Esri) dépliée le temps de la capture : repliée
        // (écran étroit), elle ne laisserait qu'un bouton « i » dans l'image.
        const attrib = mapContainer.querySelector<HTMLElement>('.maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show)');
        attrib?.classList.add('maplibregl-compact-show');
        // Définition doublée le temps de la capture, bornée par la carte graphique.
        const prevRatio = map.getPixelRatio();
        const ratio = capturePixelRatio(map.getCanvas().clientWidth, map.getCanvas().clientHeight, prevRatio, maxTextureSize(map.getCanvas()));
        const boosted = ratio > prevRatio;

        // DURCISSEMENT 5 (porté de `@pctac/planmap/capture.ts:132-163`) :
        // aplatir temporairement en position/left/top ABSOLUS tous les
        // marqueurs MapLibre visibles (état `transform` mémorisé pour
        // restauration) AVANT le passage html2canvas — LE durcissement cité en
        // tête de `planmap/capture.ts` (« épinglage px des conteneurs = cause
        // n°1 des markers amputés ») : sans lui, le clone DOM produit par
        // html2canvas perd/décale les `transform` CSS des marqueurs.
        const markersToRestore: {
            el: HTMLElement;
            position: string;
            left: string;
            top: string;
            transform: string;
            width: string;
            height: string;
        }[] = [];
        // DURCISSEMENT 5 bis (porté de `:188-199`, `:213-231`) : épingler en
        // PIXELS la chaîne de conteneurs (#oi_carto_map_wrap + jusqu'à 2
        // parents) pour que le CLONE html2canvas garde exactement la taille
        // écran — sans ça, les unités relatives (%, vh) sont recalculées dans
        // le viewport du clone et un `overflow:hidden` hérité ampute une bande
        // de markers.
        const pinnedEls: HTMLElement[] = [];

        let outCanvas: HTMLCanvasElement | null = null;
        try {
            if (boosted) map.setPixelRatio(ratio);
            // Rendu fini et tuiles visibles chargées (audit F12 : capture juste
            // après un déplacement floue, capture hors ligne noire), au plus
            // CAPTURE_IDLE_TIMEOUT_MS.
            setCaptureStatus('Chargement de la carte avant capture…');
            const idle = await waitForIdle(map, CAPTURE_IDLE_TIMEOUT_MS);
            const sample = sampleCanvas(map.getCanvas());
            const verdict = sample ? mapSampleVerdict(sample) : 'ok';
            if (verdict !== 'ok') {
                const refusal = captureRefusal(verdict);
                setCaptureStatus(refusal, 'error');
                toast(refusal, { kind: 'error' });
                return null;
            }
            setCaptureStatus('');

            const parentRect = mapContainer.getBoundingClientRect();
            const markerElements = Array.from(mapContainer.querySelectorAll<HTMLElement>('.maplibregl-marker, .mapboxgl-marker'));
            for (const el of markerElements) {
                // Ignorer si l'élément est déjà masqué ou a des dimensions nulles.
                if (el.style.display === 'none' || el.offsetWidth === 0 || el.offsetHeight === 0) continue;
                const rect = el.getBoundingClientRect();
                const left = rect.left - parentRect.left;
                const top = rect.top - parentRect.top;
                markersToRestore.push({
                    el,
                    position: el.style.position,
                    left: el.style.left,
                    top: el.style.top,
                    transform: el.style.transform,
                    width: el.style.width,
                    height: el.style.height,
                });
                el.style.position = 'absolute';
                el.style.left = left + 'px';
                el.style.top = top + 'px';
                el.style.transform = 'none';
                el.style.width = rect.width + 'px';
                el.style.height = rect.height + 'px';
            }

            const glCanvas = map.getCanvas();
            const w = glCanvas.width;
            const h = glCanvas.height;
            const cssW = glCanvas.clientWidth;
            const cssH = glCanvas.clientHeight;
            // DURCISSEMENT 6 (porté de `:171-173`) : garde-fou plein écran —
            // `clientWidth` peut être transitoirement nul malgré les gardes
            // ci-dessus (fenêtre de course), replié sur `devicePixelRatio`.
            let dpr = cssW > 0 ? (w / cssW) : (window.devicePixelRatio || 1);
            if (!isFinite(dpr) || dpr <= 0) dpr = window.devicePixelRatio || 1;

            let chainEl: HTMLElement | null = mapContainer;
            for (let depth = 0; chainEl && depth < 3; depth++, chainEl = chainEl.parentElement) {
                const r = chainEl.getBoundingClientRect();
                chainEl.setAttribute('data-h2c-pin', JSON.stringify({ w: r.width, h: r.height }));
                pinnedEls.push(chainEl);
            }

            const overlay = await html2canvas(mapContainer, {
                useCORS: true, allowTaint: false, backgroundColor: null, logging: false,
                scale: dpr, width: cssW, height: cssH,
                // PAS de windowWidth/windowHeight : le viewport du clone doit
                // rester celui de la vraie fenêtre pour que les vh se résolvent
                // à l'identique (`planmap/capture.ts:209-210`).
                scrollX: 0, scrollY: 0,
                ignoreElements: (n) => n.tagName === 'CANVAS',
                onclone: (clonedDoc) => {
                    // `color-mix()` calculé en `color(srgb …)`, illisible pour html2canvas.
                    legacyCaptureColors(mapContainer.id ? clonedDoc.getElementById(mapContainer.id) : clonedDoc.body);
                    clonedDoc.querySelectorAll<HTMLElement>('[data-h2c-pin]').forEach((node) => {
                        try {
                            const r = JSON.parse(node.getAttribute('data-h2c-pin') ?? '');
                            node.style.width = r.w + 'px';
                            node.style.height = r.h + 'px';
                            node.style.maxWidth = 'none';
                            node.style.maxHeight = 'none';
                            node.style.minHeight = '0';
                        } catch { /* ignore */ }
                    });
                },
            });
            outCanvas = document.createElement('canvas');
            outCanvas.width = w;
            outCanvas.height = h;
            const ctx = outCanvas.getContext('2d');
            if (!ctx) throw new Error('Contexte de dessin 2D indisponible.');
            ctx.drawImage(glCanvas, 0, 0, w, h);
            ctx.drawImage(overlay, 0, 0, w, h);
            // Carroyage / MGRS / lignes visibles : leur légende voyage avec
            // l'image (PDF, téléchargement), incrustée en bandeau.
            const legend = this.overlays ? overlayLegend(this.overlays, map.getBearing()) : null;
            if (legend) drawOverlayLegend(ctx, w, h, dpr, legend);
            // Échelle mesurée au centre de l'image, sur un quart de sa largeur.
            const a = map.unproject([(cssW * 3) / 8, cssH / 2]);
            const b = map.unproject([(cssW * 5) / 8, cssH / 2]);
            const scale = niceScale(a.distanceTo(b) / (cssW / 4) / dpr, w * 0.2);
            drawNorthAndScale(ctx, dpr, map.getBearing(), scale);
            if (!idle) {
                const warning = `La carte n'avait pas fini de charger après ${CAPTURE_IDLE_TIMEOUT_MS / 1000} s : l'image peut être floue par endroits.`;
                setCaptureStatus(warning);
                toast(warning, { kind: 'info' });
                // Lu par `_exportToField` : la fenêtre reste ouverte, l'avertissement lisible.
                outCanvas.dataset.chargementIncomplet = '1';
            }
        } catch (e) {
            console.error('[OICarto] capture échec:', e);
            toast('Erreur lors de la capture : ' + (e instanceof Error ? e.message : String(e)), { kind: 'error' });
            outCanvas = null;
        } finally {
            for (const item of markersToRestore) {
                item.el.style.position = item.position;
                item.el.style.left = item.left;
                item.el.style.top = item.top;
                item.el.style.transform = item.transform;
                item.el.style.width = item.width;
                item.el.style.height = item.height;
            }
            pinnedEls.forEach((n) => { try { n.removeAttribute('data-h2c-pin'); } catch { /* ignore */ } });
            toHide.forEach((el, i) => { el.style.display = memo[i] || ''; });
            attrib?.classList.remove('maplibregl-compact-show');
            // `null` rend la main à `devicePixelRatio` (documenté par MapLibre, absent de son typage).
            if (boosted) map.setPixelRatio(prevRatio === window.devicePixelRatio ? (null as unknown as number) : prevRatio);
            this._captureBusy = false;
        }
        return outCanvas;
    },

    // oi_cartographie.js:1262-1277
    async _downloadCapture(this: OICartoInternal): Promise<void> {
        const canvas = await this._captureCanvas();
        if (!canvas) return;
        canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.href = url;
            a.download = `carte-oi-${stamp}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    },

    /** Capture la carte et l'injecte dans un conteneur photo via le pipeline OI
     *  existant (handleFileChange → compression + IndexedDB + dynamic_photos). */
    // oi_cartographie.js:1281-1308
    async _exportToField(this: OICartoInternal, containerId: string): Promise<void> {
        if (!containerId) return;
        // oi_cartographie.js:1283 — RÈGLE D'OR (§2.2/§6.5) : MÊME garde que
        // l'original, résolue sur `window` (OiMediaGlobals, non importée).
        if (typeof window.handleFileChange !== 'function') {
            toast('Pipeline photo indisponible.', { kind: 'error' });
            return;
        }
        const canvas = await this._captureCanvas();
        if (!canvas) return;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
        if (!blob) { toast('Capture échouée.', { kind: 'error' }); return; }

        // On réutilise handleFileChange via un <input> détaché alimenté par DataTransfer.
        try {
            const file = new File([blob], `carte_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const dt = new DataTransfer();
            dt.items.add(file);
            const fakeInput = document.createElement('input');
            fakeInput.type = 'file';
            fakeInput.files = dt.files;
            await window.handleFileChange(fakeInput, containerId, false);
            if (canvas.dataset.chargementIncomplet !== '1') this._closeCaptureModal();
            // U19 — toast unique (@shared/feedback.js).
            toast('Capture de carte ajoutée au champ photo.', { kind: 'success' });
        } catch (e) {
            console.error('[OICarto] export champ photo échec:', e);
            toast('Export impossible : ' + (e instanceof Error ? e.message : String(e)), { kind: 'error' });
        }
    },
};
