/**
 * capture.ts — Chaîne `captureToDataUrl` / `_takeScreenshot` de `planMap.js`
 * (P2.CONV, paquet `pm-capture`).
 * ===========================================================================
 *
 * ⚠ PORT QUASI VERBATIM (invariant 3, SPEC-PLANMAP-SPLIT.md §5.5). Cette
 * chaîne a été fiabilisée par ~35 correctifs successifs (épinglage px des
 * conteneurs = cause n°1 des markers amputés). Aucune refactorisation, aucune
 * extraction de sous-fonction, aucun changement d'ordre d'instruction, aucun
 * renommage de variable locale. Les commentaires FR d'origine sont recopiés
 * mot pour mot : ils portent les invariants.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js:5054-5291`
 * (lecture seule).
 */

import html2canvas from 'html2canvas';

import { toast } from '@shared/feedback.js';
import type { PlanMapInternal } from './types.js';

export const CaptureMethods = {
    /**
     * Compose le canvas WebGL + overlays (markers/libellés/boussole via
     * html2canvas) et RETOURNE le PNG en dataURL (CONTRAT C2).
     * @returns {Promise<string|null>} dataURL PNG, ou null si carte non initialisée
     *          ou html2canvas indisponible (dégradation propre, hors-ligne).
     */
    // planMap.js:5054-5241
    async captureToDataUrl(this: PlanMapInternal): Promise<string | null> {
        if (!this.map) return null;
        // planMap.js:5056 — `typeof html2canvas === 'undefined'` devient un test de
        // forme : html2canvas est désormais un import statique (SPEC-PCTAC-CONVERSION §1.4).
        if (typeof html2canvas !== 'function') return null;

        const mapContainer = this.map.getContainer();
        if (!mapContainer) return null;

        // Vue Plan cachée (export PDF depuis un autre onglet) : capture impossible,
        // on le dit franchement AVANT de toucher au DOM (l'appelant peut basculer la vue).
        if (!mapContainer.offsetWidth) return null;
        // Vue VISIBLE mais canvas transitoirement 0 (entrée/sortie plein écran) :
        // on laisse le layout se poser puis on re-teste, au lieu d'échouer.
        if (!this.map.getCanvas().clientWidth) {
            // Adaptation TS nécessaire (non listée au §5.5) : `requestAnimationFrame`
            // appelle son callback avec un timestamp `number` ; `r` (résolveur d'un
            // `Promise<void>`) n'accepte que `void`. `() => r()` ignore l'argument,
            // comportement identique (la valeur de résolution n'est jamais lue).
            await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
            if (!this.map.getCanvas().clientWidth) return null;
        }

        // Verrou anti-concurrence : une 2e capture pendant la 1re snapshoterait les
        // styles déjà aplatis/masqués comme « originaux » et gèlerait l'UI au restore.
        if (this._captureBusy) return null;
        this._captureBusy = true;

        // Masquer l'UI superposée (on garde la boussole MapLibre) — y compris les
        // éléments d'édition transitoires (roue, panneaux inline, poignées, toolbar
        // flottante, viseur/contrôles du mode précision, marqueur de dessin en cours).
        const toHide = [
            document.getElementById('plan_unified_toolbar'),
            document.getElementById('plan_draw_dock'),
            document.getElementById('plan_search_panel'),
            document.getElementById('plan_legend'),
            document.getElementById('plan_hint'),
            document.getElementById('plan_draw_crosshair'),
            document.getElementById('plan_draw_precision_controls')
            // Adaptation TS nécessaire (non listée au §5.5, mais requise pour un
            // `tsc --noEmit` vide) : `Boolean` référencé nu ne fait PAS narrower
            // `(HTMLElement|null)[]` → `HTMLElement[]` ; la forme fléchée `!!el`
            // produit le même filtrage à l'exécution et permet l'inférence.
        ].filter((el) => !!el);
        // Les cadenas de verrouillage (pings + dessins) et badges photo ne doivent pas apparaître à l'export.
        Array.prototype.push.apply(toHide,
            Array.prototype.slice.call(document.querySelectorAll('.plan-lock-badge, .plan-photo-badge')));
        Array.prototype.push.apply(toHide,
            Array.prototype.slice.call(document.querySelectorAll('.plan-inline-panel')));
        if (this._activeWheel && this._activeWheel.element) toHide.push(this._activeWheel.element);
        if (Array.isArray(this._handleMarkers)) {
            for (const m of this._handleMarkers) {
                try { const el = m.getElement(); if (el) toHide.push(el); } catch { /* ignore */ }
            }
        }
        try { if (this._toolbarMarker) toHide.push(this._toolbarMarker.getElement()); } catch { /* ignore */ }
        try { if (this._drawingDiameterMarker) toHide.push(this._drawingDiameterMarker.getElement()); } catch { /* ignore */ }
        const memo = toHide.map(el => el.style.display);
        toHide.forEach(el => { el.style.display = 'none'; });

        // À partir d'ici, TOUT est sous try/finally : une exception pendant
        // l'attente des tuiles ou le repaint ne doit jamais laisser l'UI masquée
        // ni le verrou _captureBusy posé.
        const markersToRestore: {
            el: HTMLElement;
            position: string;
            left: string;
            top: string;
            transform: string;
            width: string;
            height: string;
        }[] = [];
        const pinnedEls: HTMLElement[] = [];
        try {
            // Attendre la fin d'un mouvement caméra et le chargement des tuiles
            // visibles (borné à 2,5 s pour ne jamais bloquer hors-ligne : les tuiles
            // absentes du cache ne viendront pas, on capture l'état réel).
            if (this.map.isMoving() || !this.map.areTilesLoaded()) {
                await new Promise<void>((res) => {
                    let done = false;
                    const fin = () => {
                        if (done) return; done = true;
                        // Adaptation TS nécessaire (non listée au §5.5) : à l'intérieur
                        // de cette closure, TS ne conserve pas le narrowing de `this.map`
                        // établi par la garde `if (!this.map) return null;` en tête de
                        // méthode (accès via `this`, pas une const locale). `?.` est un
                        // pur artifice de typage : `this.map` reste non-null à l'exécution
                        // (invariant de la méthode, jamais réassigné ici).
                        try { this.map?.off('idle', fin); } catch { /* ignore */ }
                        clearTimeout(t);
                        res();
                    };
                    const t = setTimeout(fin, 2500);
                    this.map?.once('idle', fin);
                });
            }

            // Forcer un repaint pour que le canvas WebGL contienne la frame actuelle
            this.map.triggerRepaint();
            // Adaptation TS nécessaire (même motif que ci-dessus, §5.5 point 5).
            await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

            // Aplatir temporairement les positions 3D/2D transformées de tous les marqueurs visibles
            const parentRect = mapContainer.getBoundingClientRect();
            // Adaptation TS nécessaire (non listée au §5.5) : generic explicite
            // `<HTMLElement>` sur querySelectorAll — sans lui le type par défaut
            // `Element` n'expose ni `.style` ni `.offsetWidth/offsetHeight`.
            const markerElements = Array.from(mapContainer.querySelectorAll<HTMLElement>('.maplibregl-marker, .mapboxgl-marker'));

            for (const el of markerElements) {
                // Ignorer si l'élément est déjà masqué ou a des dimensions nulles
                if (el.style.display === 'none' || el.offsetWidth === 0 || el.offsetHeight === 0) continue;

                const rect = el.getBoundingClientRect();
                const left = rect.left - parentRect.left;
                const top = rect.top - parentRect.top;

                markersToRestore.push({
                    el: el,
                    position: el.style.position,
                    left: el.style.left,
                    top: el.style.top,
                    transform: el.style.transform,
                    width: el.style.width,
                    height: el.style.height
                });

                el.style.position = 'absolute';
                el.style.left = left + 'px';
                el.style.top = top + 'px';
                el.style.transform = 'none';
                el.style.width = rect.width + 'px';
                el.style.height = rect.height + 'px';
            }

            const glCanvas = this.map.getCanvas();
            const w = glCanvas.width;   // pixels réels (déjà × devicePixelRatio)
            const h = glCanvas.height;
            const cssW = glCanvas.clientWidth;
            const cssH = glCanvas.clientHeight;

            // Garde-fou plein écran : clientWidth peut être transitoirement 0.
            let dpr = cssW > 0 ? (w / cssW) : (window.devicePixelRatio || 1);
            if (!isFinite(dpr) || dpr <= 0) dpr = window.devicePixelRatio || 1;

            // Snapshot du fond WebGL AVANT le passage html2canvas (long) : sinon toute
            // animation caméra pendant la rasterisation désaligne fond et markers.
            const baseCanvas = document.createElement('canvas');
            baseCanvas.width = w;
            baseCanvas.height = h;
            // Adaptation (d) du §5.5 : garde `if (!ctx)` ajoutée (TS exige un
            // narrowing explicite sur `getContext('2d')`, nullable dans le DOM lib) ;
            // en cas de null on retourne `null` DEPUIS le `try` — le `finally`
            // restaure quand même markers/toHide/_captureBusy.
            const ctx = baseCanvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(glCanvas, 0, 0, w, h);

            // Épingler en PIXELS la chaîne conteneur (#plan_map, wrapper 78vh, #view-plan)
            // pour que le CLONE html2canvas garde exactement la taille écran. Sans ça,
            // les unités vh sont recalculées dans le viewport du clone et :fullscreen ne
            // s'y applique pas → le conteneur cloné rétrécit et overflow:hidden AMPUTE
            // une bande des markers à chaque capture (cause n°1 des éléments manquants).
            // Adaptation (c) du §5.5 : `el` de la boucle d'épinglage typé `HTMLElement | null`.
            let el: HTMLElement | null = mapContainer;
            for (let depth = 0; el && depth < 3; depth++, el = el.parentElement) {
                const r = el.getBoundingClientRect();
                el.setAttribute('data-h2c-pin', JSON.stringify({ w: r.width, h: r.height }));
                pinnedEls.push(el);
            }

            const overlay = await html2canvas(mapContainer, {
                useCORS: true,
                allowTaint: false,
                backgroundColor: null,
                logging: false,
                scale: dpr,
                width: cssW,
                height: cssH,
                // PAS de windowWidth/windowHeight : le viewport du clone doit rester
                // celui de la vraie fenêtre pour que les vh se résolvent à l'identique.
                scrollX: 0,
                scrollY: 0,
                ignoreElements: (n) => n.tagName === 'CANVAS',
                onclone: (clonedDoc) => {
                    // Adaptation TS nécessaire (non listée au §5.5) : generic explicite
                    // `<HTMLElement>` (même motif que markerElements ci-dessus).
                    clonedDoc.querySelectorAll<HTMLElement>('[data-h2c-pin]').forEach((node) => {
                        try {
                            // Adaptation TS nécessaire (non listée au §5.5) : `getAttribute`
                            // est typé `string | null` ; l'attribut vient d'être posé par la
                            // boucle d'épinglage ci-dessus donc ce repli `''` est mort par
                            // construction (même statut que le repli documenté §6.3).
                            const r = JSON.parse(node.getAttribute('data-h2c-pin') ?? '');
                            node.style.width = r.w + 'px';
                            node.style.height = r.h + 'px';
                            node.style.maxWidth = 'none';
                            node.style.maxHeight = 'none';
                            node.style.minHeight = '0';
                        } catch { /* ignore */ }
                    });
                }
            });

            const outCanvas = document.createElement('canvas');
            outCanvas.width = w;
            outCanvas.height = h;
            // Même adaptation (d) que pour `baseCanvas` ci-dessus : `getContext('2d')`
            // est nullable côté TS. `ctx` est ici un NOUVEAU nom de variable local à ce
            // bloc (le `ctx` de `baseCanvas` est sorti de portée après son usage
            // ci-dessus) — aucune variable existante n'est renommée.
            const outCtx = outCanvas.getContext('2d');
            if (!outCtx) return null;
            outCtx.drawImage(baseCanvas, 0, 0, w, h);
            outCtx.drawImage(overlay, 0, 0, w, h);
            return outCanvas.toDataURL('image/png');
        } catch (e) {
            console.error('[PlanMap] capture échec:', e);
            return null;
        } finally {
            // Restaurer les positions d'origine des marqueurs
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
    },

    /**
     * Capture haute qualité de la carte avec ses annotations.
     *
     * Approche robuste (plein écran 2D ET 3D, après défilement) :
     *  1. Base = canvas WebGL natif de MapLibre (tuiles, relief 3D, bâtiments,
     *     dessins) — toujours aux dimensions pixel correctes quel que soit l'état.
     *  2. Overlay = markers DOM (pins + libellés + boussole) via html2canvas sur
     *     le conteneur #plan_map (même repère que le canvas), en IGNORANT tout
     *     <canvas>, avec fenêtre/scroll figés pour ne pas dépendre du viewport.
     *  3. Composition des deux dans un canvas final w×h → PNG.
     *
     * Clés anti-régression plein écran : on capture #plan_map (pas le cadre parent
     * qui se redimensionne), on fixe windowWidth/Height + scrollX/Y, et on borne le
     * scale (DPR) contre un clientWidth transitoirement nul.
     */
    // planMap.js:5258-5291
    async _takeScreenshot(this: PlanMapInternal): Promise<void> {
        // planMap.js:5259 — même adaptation (a) que captureToDataUrl.
        if (typeof html2canvas !== 'function') {
            toast('Librairie html2canvas indisponible (réseau ?)', { kind: 'error' });
            return;
        }
        if (!this.map) return;
        // Capture déjà en cours (double-clic) : no-op silencieux — sans cette garde,
        // captureToDataUrl renvoie null et l'alerte « Capture impossible » mentirait.
        if (this._captureBusy) return;

        // Composition (canvas WebGL + overlays) déléguée à la méthode publique
        // captureToDataUrl (CONTRAT C2) ; ici on ne fait que déclencher le
        // téléchargement, comportement inchangé du bouton plan_btn_capture.
        let dataUrl;
        try {
            dataUrl = await this.captureToDataUrl();
        } catch (e) {
            console.error('[PlanMap] screenshot échec:', e);
            // Adaptation TS nécessaire (non listée au §5.5, hors chaîne
            // captureToDataUrl) : `catch (e)` typé `unknown` (useUnknownInCatchVariables,
            // inclus dans `strict`) — `e.message` exige un narrowing. Idiome déjà en
            // place dans le projet (src/shared/ui-platform.ts:100).
            toast('Erreur lors de la capture : ' + (e instanceof Error ? e.message : String(e)), { kind: 'error' });
            return;
        }
        if (!dataUrl) {
            toast('Capture impossible (carte non initialisée ?)', { kind: 'error' });
            return;
        }

        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = dataUrl;
        a.download = `pctac-plan-${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },
};
