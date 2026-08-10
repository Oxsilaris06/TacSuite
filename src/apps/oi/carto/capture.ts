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
 * :1302, repli `alert` pour `toast`) → portés en `window.handleFileChange` /
 * `window.toast`, MÊMES gardes — PAS d'import de `@oi/medias.js` ni
 * `@oi/notifications.js` (`carto/*` ne dépend d'aucun paquet
 * médias/notifications, §6.5).
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
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
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
 * Repli sciemment NON porté : attente `idle`/`areTilesLoaded` (`planMap.js`
 * :103-125, dépend de `map.isMoving()`/`map.areTilesLoaded()` — présents sur
 * tout `maplibregl.Map`, mais l'original `oi_cartographie.js` ne les attendait
 * déjà pas ; ajouter cette attente changerait un comportement observable
 * (délai avant capture) hors du périmètre "durcissement anti-jank/anti-perte
 * de markers" de cette mission).
 */

import html2canvas from 'html2canvas';

import { toast } from '@shared/feedback.js';

import type { OICartoInternal, OiCartoPhotoTarget } from './types.js';

export const CaptureMethods = {
    // oi_cartographie.js:1164-1175
    _openCaptureModal(this: OICartoInternal): void {
        const modal = document.getElementById('oi_carto_capture_modal') as HTMLDialogElement | null;
        if (!modal) return;
        const sel = document.getElementById('oi_carto_capture_target') as HTMLSelectElement | null;
        if (sel) {
            const targets = this._getPhotoTargets();
            sel.innerHTML = targets.length
                ? targets.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')
                : '<option value="">Aucun champ photo disponible</option>';
        }
        if (!modal.open) modal.showModal();
    },

    // oi_cartographie.js:1177-1180
    _closeCaptureModal(): void {
        const modal = document.getElementById('oi_carto_capture_modal') as HTMLDialogElement | null;
        if (modal && modal.open) modal.close();
    },

    /** Liste des conteneurs photo de l'OI ciblables par l'export.
     *  2 champs statiques (Transport) + champs par bloc dynamique (MOICP / ZMSPCP /
     *  Effraction), chacun étiqueté avec le titre éditable de son bloc. */
    // oi_cartographie.js:1185-1210
    _getPhotoTargets(): OiCartoPhotoTarget[] {
        const targets: OiCartoPhotoTarget[] = [
            { id: 'photo_container_transport_pr_preview_container', label: 'Transport PSIG → PR' },
            { id: 'photo_container_transport_domicile_preview_container', label: 'Transport PR → Domicile / LE' },
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
            targets.push({ id: `photo_bapteme_${bid}`, label: `Baptême terrain — ${t}` });
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
            document.getElementById('oi_carto_hint'),
            this._activeWheel?.element ?? null,
            this._inlinePanel,
        ].filter((el): el is HTMLElement => !!el);
        const memo = toHide.map((el) => el.style.display);
        toHide.forEach((el) => { el.style.display = 'none'; });

        map.triggerRepaint();
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

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
            this._closeCaptureModal();
            // oi_cartographie.js:1302 — MÊME garde `typeof toast === 'function'`
            // que l'original, repli `alert` (`toast` = OiNotificationGlobals).
            if (typeof window.toast === 'function') window.toast('Capture de carte ajoutée au champ photo.');
            else toast('Capture de carte ajoutée au champ photo.', { kind: 'success' });
        } catch (e) {
            console.error('[OICarto] export champ photo échec:', e);
            toast('Export impossible : ' + (e instanceof Error ? e.message : String(e)), { kind: 'error' });
        }
    },
};
