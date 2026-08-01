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
 */

import html2canvas from 'html2canvas';

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
            alert('Librairie html2canvas indisponible (réseau ?).');
            return null;
        }
        const mapContainer = document.getElementById('oi_carto_map_wrap');
        const map = this.map;
        if (!mapContainer || !map) return null;

        const toHide = [
            document.querySelector<HTMLElement>('.oi-carto-toolbar'),
            document.getElementById('oi_carto_draw_dock'),
            document.getElementById('oi_carto_search_panel'),
            document.getElementById('oi_carto_hint'),
        ].filter((el): el is HTMLElement => !!el);
        const memo = toHide.map((el) => el.style.display);
        toHide.forEach((el) => { el.style.display = 'none'; });

        map.triggerRepaint();
        // Adaptation TS : `requestAnimationFrame` appelle son callback avec un
        // timestamp `number` ; le résolveur d'un `Promise<void>` n'accepte que
        // `void` — `() => r()` ignore l'argument, comportement identique.
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

        let outCanvas: HTMLCanvasElement | null = null;
        try {
            const glCanvas = map.getCanvas();
            const w = glCanvas.width;
            const h = glCanvas.height;
            const dpr = w / glCanvas.clientWidth;
            const overlay = await html2canvas(mapContainer, {
                useCORS: true, allowTaint: false, backgroundColor: null, logging: false,
                scale: dpr, width: glCanvas.clientWidth, height: glCanvas.clientHeight,
                ignoreElements: (el) => el.tagName === 'CANVAS',
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
            alert('Erreur lors de la capture : ' + (e instanceof Error ? e.message : String(e)));
            outCanvas = null;
        } finally {
            toHide.forEach((el, i) => { el.style.display = memo[i] || ''; });
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
            alert('Pipeline photo indisponible.');
            return;
        }
        const canvas = await this._captureCanvas();
        if (!canvas) return;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
        if (!blob) { alert('Capture échouée.'); return; }

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
            else alert('Capture de carte ajoutée au champ photo.');
        } catch (e) {
            console.error('[OICarto] export champ photo échec:', e);
            alert('Export impossible : ' + (e instanceof Error ? e.message : String(e)));
        }
    },
};
