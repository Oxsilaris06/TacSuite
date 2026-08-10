/**
 * main.ts — Point d'entrée Générateur d'OI (P3B.C, câblage).
 * ===========================================================================
 * Port TypeScript des `<script>` inline de `GStart-main/4.html` :
 *   - L.14-23     : filet error/unhandledrejection
 *   - L.43-111    : intercepteur de logs persistant (OiInlineGlobals)
 *   - L.4536-4814 : câblage DOMContentLoaded (~278 lignes, 18 étapes)
 *   - L.4795-4812 : window.setPdfFormat + restauration du format PDF
 * Ordre imposé par docs/SPEC-OI-CONVERSION.md §12 (aucune étape fusionnée,
 * réordonnée ni « optimisée » — même discipline que
 * src/apps/pctac/main.ts / docs/SPEC-PCTAC-CONVERSION.md §5).
 *
 * RÈGLE D'OR DU PORTAGE OI (SPEC-OI-CONVERSION.md §2.2) : main.ts est un
 * CONSOMMATEUR de tous les modules OI, jamais consommé par eux — aucun risque
 * de cycle. Par fidélité et simplicité de vérification, ce fichier suit
 * NÉANMOINS la même discipline que les modules de la bibliothèque : tout
 * appel vers une fonction que l'original résolvait en global implicite
 * (bare identifier OU `window.X` explicite dans 4.html) passe ici par
 * `window.X`, avec exactement la même garde `typeof … === 'function'` que
 * l'original quand elle existe. La SEULE exception est `oiState`
 * (src/apps/oi/state.ts) : fichier NOUVEAU introduit par le port (§3.2),
 * sans équivalent `window` dans l'original — importé nommément, seule façon
 * légale d'écrire dans ses propriétés depuis un autre module ESM.
 *
 * ÉCARTS TRANCHÉS EN P3B.C :
 *
 * 1. Manifest dynamique (4.html:5-13) — OMIS (VALIDÉ, directive orchestrateur
 *    P3B.C). L'original injectait `<link rel="manifest" href="manifest.json">`
 *    en JS, sous garde `location.protocol.startsWith('http')`, pour éviter
 *    une erreur CORS en contexte `file://`. `oi/index.html:8` porte déjà, de
 *    façon STATIQUE, `<link rel="manifest" href="/manifest.webmanifest">`
 *    (décision P0.A5, chemins d'assets réécrits en absolu). Rejouer le bloc
 *    dynamique verbatim ajouterait un DEUXIÈME `<link rel="manifest">`
 *    pointant vers un chemin relatif `manifest.json` inexistant dans
 *    l'arborescence Vite (404) : régression, pas fidélité. Seul le filet
 *    error/unhandledrejection (L.14-23) est repris ci-dessous. Documenté
 *    comme écart assumé dans `docs/DECISIONS-DOM-ECARTS.md`.
 * 2. Enregistrement Service Worker (4.html:4505-4507, HORS de la plage
 *    4536-4814 assignée mais partie du même point d'entrée) — même
 *    traitement que src/apps/pctac/main.ts §5.3 étape 1 : `registerServiceWorker`
 *    (module `@shared/register-sw.js`, P4.B) sur `sw.js` buildé par
 *    vite-plugin-pwa (cf. docs/PLAN.md §6 Phase 4 / public/sw.ts).
 * 3. `window.open(...)` dans l'intercepteur de logs (4.html:105) : l'original
 *    déréférence `logWindow.document` sans vérifier `logWindow` (bloqueur de
 *    popup ⇒ TypeError non typé). Garde `if (logWindow)` ajoutée — adaptation
 *    de TYPAGE PUR (même principe que src/apps/pctac/ui.ts, aucun changement
 *    de comportement observable hors blocage popup, cas où l'original
 *    plantait déjà silencieusement en console).
 * 4. Délégation `data-action` (SPEC-OI-CONVERSION.md §12.4, décision identique
 *    à SPEC-PCTAC-CONVERSION.md §3.2) : posée ICI en trois listeners délégués
 *    (`click`, `input`, `change`) sur `document`, table `action → handler`
 *    définie ci-dessous. Portée : UNIQUEMENT les 63 attributs statiques de
 *    `oi/index.html` (37 onclick + 19 oninput + 7 onchange), cf.
 *    `docs/DECISIONS-DOM-ECARTS.md`. Les `onclick` GÉNÉRÉS en `innerHTML` par
 *    formulaires.ts/patrac.ts/articulation.ts/medias.ts/dessin.ts restent
 *    VERBATIM (§12.4 : retrait différé, hors périmètre).
 * 5. Correctif `importSession` (SPEC-OI-CONVERSION.md §9, `window.isFormLoading
 *    = true` avant `location.reload()`) — VÉRIFIÉ DÉJÀ PRÉSENT dans le paquet
 *    `oi-formulaires` livré (`src/apps/oi/formulaires.ts:1194-1198`, commentaire
 *    « CORRECTIF DE PORTAGE (SPEC-OI-CONVERSION §9) » verbatim). Aucune action
 *    requise dans main.ts : le correctif vit entièrement dans `formulaires.ts`,
 *    jamais dans le câblage d'entrée.
 * 6. Asymétrie avec PC-Tac — TRANCHÉE : la lettre de SPEC-OI-CONVERSION.md
 *    §12.4 scope explicitement cette délégation à P3.C/P3B.C pour l'OI (elle
 *    est donc faite ICI), alors que `src/apps/pctac/main.ts` (§3.2 en tête)
 *    documente sa PROPRE délégation `data-action` comme différée au-delà de
 *    P2.D (5 onclick statiques encore présents dans `pctac/index.html`).
 *    Asymétrie de calendrier ASSUMÉE et documentée (pas d'alignement rétroactif
 *    de PC-Tac dans cette mission) — cf. `docs/DECISIONS-DOM-ECARTS.md`.
 */

// ── §12.1 étape 0 — Filet global d'erreurs, VERBATIM de 4.html:14-23. La
// partie « manifest dynamique » (4.html:5-13) est omise — cf. écart assumé
// n°1 ci-dessus. ──────────────────────────────────────────────────────────
window.addEventListener('error', (e) => {
    console.error('[OI] Erreur non capturée:',
        e.message, (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || ''), e.error || '');
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[OI] Promesse rejetée non gérée:', e.reason);
});

// ── §12.1 étape 1 — Intercepteur de logs persistant, VERBATIM de
// 4.html:44-110 (IIFE). Pose `window.openLogs` et `window.__capturedLogs`
// (OiInlineGlobals, déjà typés dans global.d.ts). ──────────────────────────
(function () {
    const STORAGE_KEY = 'gstart_captured_logs';
    const MAX_LOGS = 500;

    const getStoredLogs = (): string[] => {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
            return [];
        }
    };

    window.__capturedLogs = getStoredLogs();

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    // Écriture localStorage débounce : cf. commentaire d'origine 4.html:64-66
    // (coûteux à chaque appel console, catastrophique pendant la génération PDF).
    let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushCapturedLogs = (): void => {
        logFlushTimer = null;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(window.__capturedLogs)); } catch { /* quota */ }
    };
    const scheduleLogFlush = (): void => {
        if (logFlushTimer) return;
        logFlushTimer = setTimeout(flushCapturedLogs, 1500);
    };
    const safeStringify = (a: unknown): string => {
        if (typeof a !== 'object' || a === null) return String(a);
        try { return JSON.stringify(a); } catch { return '[objet non sérialisable]'; }
    };
    const formatLog = (args: unknown[], type: string): void => {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${args.map(safeStringify).join(' ')}`;
        window.__capturedLogs.push(logEntry);
        if (window.__capturedLogs.length > MAX_LOGS) window.__capturedLogs.shift();
        scheduleLogFlush();
    };
    // Flush garanti avant fermeture / mise en arrière-plan de la page (4.html:91-92).
    window.addEventListener('pagehide', flushCapturedLogs);
    window.addEventListener('beforeunload', flushCapturedLogs);

    console.log = (...args: unknown[]): void => { formatLog(args, 'log'); originalLog.apply(console, args); };
    console.warn = (...args: unknown[]): void => { formatLog(args, 'warn'); originalWarn.apply(console, args); };
    console.error = (...args: unknown[]): void => { formatLog(args, 'error'); originalError.apply(console, args); };

    window.openLogs = function () {
        const html = `<html><head><title>Console Logs - GStart</title><style>body { font-family: monospace; background: #000; color: #fff; padding: 20px; line-height: 1.5; } h2 { color: #3b82f6; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; } .log { color: #fff; border-bottom: 1px solid #1a1a1a; padding: 4px 0; } .warn { color: #fbbf24; border-bottom: 1px solid #1a1a1a; padding: 4px 0; } .error { color: #f87171; font-weight: bold; border-left: 3px solid red; padding: 4px 0 4px 10px; border-bottom: 1px solid #1a1a1a; } .btn-clear { background: #ef4444; color: white; border: none; padding: 5px 15px; border-radius: 4px; cursor: pointer; font-size: 14px; }</style></head><body><h2>GStart Mobile Console <button type="button" class="btn-clear" onclick="localStorage.removeItem('gstart_captured_logs'); location.reload();">Vider les logs</button></h2>${window.__capturedLogs.map((l) => {
            const cls = l.includes('[ERROR]') ? 'error' : l.includes('[WARN]') ? 'warn' : 'log';
            return `<div class="${cls}">${l}</div>`;
        }).reverse().join('')}</body></html>`;

        const logWindow = window.open('', 'GStartLogs', 'width=800,height=600');
        // Garde ajoutée (window.open peut renvoyer null, ex. bloqueur de popup) —
        // adaptation de typage pur, cf. écart assumé n°3 en tête de fichier.
        if (logWindow) {
            logWindow.document.open();
            logWindow.document.write(html);
            logWindow.document.close();
        }
    };
})();

// ── §12.1 étape 1bis — Service Worker (PWA). Voir écart assumé n°2 : même
// traitement que src/apps/pctac/main.ts §5.3 étape 1 (P4.B). ──────────────
import { registerServiceWorker } from '@shared/register-sw.js';
registerServiceWorker('oi');

// ── §12.1 étape 2 — Polices auto-hébergées (zéro CDN Google Fonts, P0.FIX). ─
import '@shared/fonts.js';

// ── §12.1 étape 3 — CSS MapLibre GL (cartographie OI, carto/*). ────────────
import 'maplibre-gl/dist/maplibre-gl.css';

// ── §12.1 étape 4 — UIPlatform, posé en 1er comme 4.html:28. ───────────────
import { UIPlatform } from '@shared/ui-platform.js';
window.UIPlatform = UIPlatform;

// ── §12.1 étape 5 — PocheTuto. `tuto-engine.ts` s'auto-assigne déjà sur
// `window.PocheTuto` (idempotent) : l'import suffit. ────────────────────────
import '@shared/tuto-engine.js';

// ── §12.1 étape 6 — Données du tutoriel + montage. ORDRE 4→5→6 OBLIGATOIRE :
// la garde ci-dessous désactiverait silencieusement le tutoriel si inversée. ─
import { oiTutoData } from '@oi/tuto-data.js';
if (!window.PocheTuto || !window.PocheTuto.mount) {
    console.warn('[Tuto] moteur tuto-engine.js absent — tutoriel désactivé.');
} else {
    window.PocheTuto.mount({
        appId: 'oi',
        appName: "Générateur d'OI",
        accent: '#4f8dff',
        buttonLabel: 'Tuto',
        dock: {
            selector: '#dockMenu',
            itemTag: 'div',
            itemClass: 'dock-menu-item',
            icon: 'menu_book',
            title: "Tutoriel interactif — Générateur d'OI",
            insertAfter: '#dockToggleBtn',
        },
        data: oiTutoData,
    });
}

// ── §3.2 — État lexical partagé (src/apps/oi/state.ts). Fichier NOUVEAU
// introduit par le port (aucun équivalent `window` dans l'original) : seul
// import nommé de ce fichier, nécessaire pour écrire les 14 refs DOM du
// wizard (§12.3 étapes 4-5). ────────────────────────────────────────────────
import { oiState } from '@oi/state.js';
// R2-T4 — infrastructure de validation inline (nouveau module, pas un port
// verbatim ; import nommé au même titre que `oiState` ci-dessus).
import { attachValidation, required, lengthRange } from '@oi/validation.js';
// P3 — compteurs de caractères calibrés PDF (nouveau module, cf. son en-tête).
import { ARTICULATION_CAT_SOFT_MAX, EFFRACTION_HYP_FIELD_SOFT_MAX, charCounter } from '@oi/validation.js';

// ── §12.2 — Imports applicatifs, ordre de 4.html:4517-4534 à la ligne près.
// Tous en side-effect only : chaque module pose ses globales `window.*` à
// l'exécution (règle d'or §2.2) ; main.ts les consomme ensuite via `window.X`
// ci-dessous, jamais par import nommé (sauf oiState, cf. supra). ───────────
import '@oi/notifications.js';
import '@oi/init.js';
import '@oi/outils.js';
import '@oi/pdf-engine-v2.js';
import '@oi/presentation.js';
import '@oi/navigation.js';
import '@oi/medias.js';
import '@oi/formulaires.js';
import '@oi/patrac.js';
import '@oi/articulation.js';
import '@oi/drag-drop.js';
import '@oi/dessin.js';
// `modules/shared.js` (4.html:4529) omis — module exclu du portage
// (SPEC-CONTRATS.md §4.2, SPEC-OI-CONVERSION.md §1.2). Seul écart d'ordre,
// déjà couvert, zéro action ici.
import '@oi/carto/index.js'; // pose window.OICarto + auto-câble #cartographyBtn (carto/index.ts:61-71)

/**
 * ─────────────────────────────────────────────────────────────────────────
 * §12.4 — Délégation `data-action` (décision identique à PC-Tac,
 * SPEC-PCTAC-CONVERSION.md §3.2). Trois listeners délégués sur `document`
 * (click / input / change), posés une fois, table `action → handler` ici.
 * Portée : les 63 attributs statiques retirés de `oi/index.html` — détail
 * exact dans `.tacsuite-prep/draft-oi-index-diff.md`.
 * ─────────────────────────────────────────────────────────────────────────
 */

type OiActionHandler = (el: HTMLElement) => void;

const oiClickActions: Record<string, OiActionHandler> = {
    // index.html:28-29 — oi/index.html:4795 (window.setPdfFormat, posé §12.3 étape 18)
    'set-pdf-format': (el) => {
        const fmt = el.dataset.format;
        if (fmt === 'a4' || fmt === '16:9') window.setPdfFormat(fmt);
    },
    // index.html:44 — doublon volontaire avec le listener explicite de §12.3
    // étape 16 (closePBtn) : l'original avait DÉJÀ les deux (onclick statique
    // + addEventListener), reproduit à l'identique (fidélité, pas de
    // dédoublonnage non demandé).
    'close-presentation-modal': () => {
        const m = document.getElementById('presentationModal') as HTMLDialogElement | null;
        if (m) {
            if (typeof m.close === 'function') m.close();
            else m.style.display = 'none';
        }
    },
    // index.html:83
    'close-quick-edit-modal': () => {
        (document.getElementById('quickEditModal') as HTMLDialogElement | null)?.close();
        document.body.classList.remove('modal-open');
    },
    // index.html:108, 122 (même action, 2 sites : header X + footer Retour)
    'close-unite-config-modal': () => {
        (document.getElementById('uniteConfigModal') as HTMLDialogElement | null)?.close();
        document.body.classList.remove('modal-open');
    },
    // index.html:170, 173
    'close-annotation-modal': () => { void window.closeAnnotationModal(); },
    // index.html:179
    'toggle-mobile-dock': () => { window.toggleMobileDock(); },
    // index.html:200
    'close-mobile-sheet': () => { window.closeMobileSheet(); },
    // index.html:231-235 — `this` de l'original = l'élément cliqué = `el`
    'set-annotation-color': (el) => {
        const color = el.dataset.color;
        if (color) window.setAnnotationColor(color, el);
    },
    // index.html:257
    'open-logs': () => { window.openLogs(); },
    // index.html:263-277 — 8 sites, data-step="0".."7"
    'go-to-step': (el) => {
        const step = el.dataset.step;
        if (step !== undefined) window.goToStep(Number(step));
    },
    // index.html:294
    'add-adversary': () => { window.addAdversary(); },
    // index.html:337
    'add-time-event': () => { window.addTimeEvent(); },
    // index.html:340
    'add-hypothesis': () => { window.addHypothesis(); },
    // index.html:348, 356, 582 — 3 sites, data-target = id de l'<input type=file> caché
    'trigger-file-input': (el) => {
        const targetId = el.dataset.target;
        if (targetId) (document.getElementById(targetId) as HTMLElement | null)?.click();
    },
    // index.html:584
    'remove-custom-background': () => { void window.removeCustomBackground(); },
    // index.html:697, 737 (même action, 2 sites : header X + footer Retour)
    'close-effraction-tools-modal': () => {
        (document.getElementById('effractionToolsModal') as HTMLDialogElement | null)?.close();
        document.body.classList.remove('modal-open');
    },
    // index.html:740
    'save-effraction-tools': () => { window.saveEffractionTools(); },
    // index.html:760 — PAS de retrait de `modal-open` ici (verbatim de l'original)
    'close-member-selection-modal': () => {
        (document.getElementById('memberSelectionModalCanvas') as HTMLDialogElement | null)?.close();
    },
    // index.html:765
    'clone-member-from-context': () => { window.cloneMemberFromContext(); },
    // index.html:768
    'delete-member-from-context': () => { window.deleteMemberFromContext(); },
    // R4-a (D2, « une seule voie d'output PDF ») : `print-oi-high-quality`
    // (#printHqBtn → printOiHighQuality() → print-view.ts/print-style.ts,
    // voie B) RETIRÉE. On imprime désormais le PDF vectoriel (téléchargé ou
    // affiché dans l'aperçu/la présentation) via le bouton natif du
    // visualiseur PDF du navigateur.
};

const oiInputActions: Record<string, OiActionHandler> = {
    // 18 sites (formulaire texte/textarea) — index.html:286-370, 599-617
    'sync-dom-to-store': () => { window.syncDomToStore(); },
    // index.html:206 — `this` de l'original = le slider = `el`
    'sync-rotation-slider': (el) => {
        const rotationInput = document.getElementById('rotation_input') as HTMLInputElement | null;
        if (rotationInput) {
            rotationInput.value = (el as HTMLInputElement).value;
            rotationInput.dispatchEvent(new Event('change'));
        }
    },
};

const oiChangeActions: Record<string, OiActionHandler> = {
    // 4 sites — index.html:285, 305, 327, 329 (même action que oiInputActions,
    // événement `change` au lieu de `input` selon le champ dans l'original)
    'sync-dom-to-store': () => { window.syncDomToStore(); },
    // index.html:353, 361 — data-preview-container + data-single (littéral
    // "false" aux 2 sites dans l'original, porté explicitement plutôt que
    // supposé)
    'handle-file-change': (el) => {
        const previewContainer = el.dataset.previewContainer;
        const single = el.dataset.single === 'true';
        if (previewContainer) void window.handleFileChange(el as HTMLInputElement, previewContainer, single);
    },
    // index.html:588
    'handle-custom-background-change': (el) => {
        void window.handleCustomBackgroundChange(el as HTMLInputElement);
    },
};

function dispatchOiAction(table: Record<string, OiActionHandler>, e: Event): void {
    const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!el) return;
    const action = el.dataset.action;
    if (action && table[action]) table[action](el);
}

document.addEventListener('click', (e) => dispatchOiAction(oiClickActions, e));
document.addEventListener('input', (e) => dispatchOiAction(oiInputActions, e));
document.addEventListener('change', (e) => dispatchOiAction(oiChangeActions, e));

/**
 * Point d'entrée principal du Générateur d'OI.
 * §12.3 — Corps DOMContentLoaded, 18 étapes, ordre de 4.html:4537-4791.
 * Aucune étape fusionnée, réordonnée ni « optimisée ».
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // §12.3 étape 1 — Initialiser IndexedDB. 4.html:4540
        if (window.dbManager) await window.dbManager.init();

        // §12.3 étape 2 — Charger les données. 4.html:4543
        if (typeof window.loadFormData === 'function') await window.loadFormData();

        // §12.3 étape 3 — Store.checkIntegrity(), try/catch conservé. 4.html:4548-4550
        if (window.Store && typeof window.Store.checkIntegrity === 'function') {
            try { await window.Store.checkIntegrity(); } catch (e) { console.warn('checkIntegrity:', e); }
        }

        // §12.3 étape 4 — Initialisation du wizard. 4.html:4553-4572
        oiState.steps = Array.from(document.querySelectorAll<HTMLElement>('.wizard-step'));
        oiState.progressSteps = Array.from(document.querySelectorAll<HTMLElement>('.wizard-progress-step'));

        // T13 (a11y) — puces d'étape pilotables au clavier. 4.html:4559-4571
        const progressBar = document.querySelector('.wizard-progress') as HTMLElement | null;
        if (progressBar) {
            oiState.progressSteps.forEach((li, i) => {
                li.setAttribute('role', 'tab');
                li.setAttribute('tabindex', '0');
                li.setAttribute('aria-label', 'Étape ' + (i + 1));
                li.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.goToStep(i); }
                });
            });
            if (window.UIPlatform && typeof UIPlatform.makeTablist === 'function') {
                UIPlatform.makeTablist(progressBar, { tabSelector: '.wizard-progress-step' });
            }
        }

        // §12.3 étape 5 — Affectation des 14 refs DOM dans oiState. 4.html:4574-4590
        oiState.prevBtn = document.getElementById('prevBtn');
        oiState.nextBtn = document.getElementById('nextBtn');
        oiState.previewBtn = document.getElementById('previewBtn');

        oiState.patracdvrContainer = document.getElementById('patracdvr_container');
        oiState.unassignedContainer = document.getElementById('unassigned_members_container');
        oiState.resetPatracdvrBtn = document.getElementById('resetPatracdvrBtn');
        oiState.presentationModal = document.getElementById('presentationModal') as HTMLDialogElement | null;
        oiState.downloadPdfBtn = document.getElementById('downloadPdfBtn');
        oiState.coherenceAlertsContainer = document.getElementById('coherence_alerts_container');
        oiState.recapFinalisation = document.getElementById('recap_finalisation');

        // Drawing context. 4.html:4587-4593
        oiState.annotationModal = document.getElementById('annotationModal') as HTMLDialogElement | null;
        oiState.canvas = document.getElementById('annotationCanvas') as HTMLCanvasElement | null;
        if (oiState.canvas) oiState.ctx = oiState.canvas.getContext('2d');
        oiState.rotationInput = document.getElementById('rotation_input') as HTMLInputElement | null;
        if (typeof window.initAnnotationWorkspace === 'function') {
            window.initAnnotationWorkspace();
        }

        // §12.3 étape 6/7 — listeners prevBtn/nextBtn → changeStep(±1). 4.html:4596-4597
        if (oiState.prevBtn) oiState.prevBtn.addEventListener('click', () => window.changeStep(-1));
        if (oiState.nextBtn) oiState.nextBtn.addEventListener('click', () => window.changeStep(1));

        // §12.3 étape 8 — PATRAC & Quick Edit. 4.html:4600-4602
        window.initializeDragDropListeners();
        if (typeof window.initDocumentDragTransfer === 'function') window.initDocumentDragTransfer();
        if (typeof window.initPatracQuickEditUi === 'function') window.initPatracQuickEditUi();

        // §12.3 étape 9 — Thème initial. 4.html:4605-4611
        const isDarkMode = localStorage.getItem('theme') === 'dark' || !localStorage.getItem('theme');
        if (!isDarkMode) {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
        }
        const darkModeIcon = document.getElementById('darkModeIcon');
        if (darkModeIcon) darkModeIcon.textContent = isDarkMode ? 'nightlight' : 'clear_day';

        // §12.3 étape 10 — Dock. 4.html:4614-4633
        const darkModeToggleBtn = document.getElementById('darkModeToggle');
        const dockToggleBtn = document.getElementById('dockToggleBtn');
        const dock = document.getElementById('dockMenu');

        if (darkModeToggleBtn) {
            darkModeToggleBtn.addEventListener('click', window.handleThemeToggle);
        }

        if (dockToggleBtn && dock) {
            dockToggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof window.toggleDock === 'function') window.toggleDock();
            });

            if (localStorage.getItem('dockCollapsed') === 'true') {
                dock.classList.add('collapsed');
                const icon = document.querySelector('#dockToggleBtn .material-symbols-outlined');
                if (icon) icon.textContent = 'expand_less';
            }
        }

        // §12.3 étape 11 — Collapsibles, délégation sur .collapsible-header. 4.html:4636-4646
        document.querySelectorAll('.collapsible-container').forEach((c) => c.classList.remove('open'));
        const cont = document.querySelector('.container');
        if (cont) {
            cont.addEventListener('click', (event) => {
                const header = (event.target as HTMLElement).closest('.collapsible-header');
                if (header) {
                    const parent = header.parentElement;
                    if (parent && parent.classList.contains('collapsible-container')) parent.classList.toggle('open');
                }
            });
        }

        // §12.3 étape 12 — Reset / Import / Export. 4.html:4649-4689
        const resetMenuBtn = document.getElementById('resetMenuBtn');
        const resetOptionsModal = document.getElementById('resetOptionsModal') as HTMLDialogElement | null;
        const cancelResetBtn = document.getElementById('cancelResetBtn');
        const resetAllBtn = document.getElementById('resetAllBtn');
        const resetPageBtn = document.getElementById('resetPageBtn');

        if (resetMenuBtn && resetOptionsModal) {
            resetMenuBtn.addEventListener('click', () => {
                document.body.classList.add('modal-open');
                resetOptionsModal.showModal();
            });
        }
        if (cancelResetBtn && resetOptionsModal) {
            cancelResetBtn.addEventListener('click', () => {
                document.body.classList.remove('modal-open');
                if (typeof resetOptionsModal.close === 'function') resetOptionsModal.close();
                else resetOptionsModal.style.display = 'none';
            });
        }
        if (resetAllBtn && typeof window.resetAllData === 'function') {
            resetAllBtn.addEventListener('click', () => { void window.resetAllData(true); });
        }
        if (resetPageBtn && typeof window.resetActivePage === 'function') {
            resetPageBtn.addEventListener('click', () => { void window.resetActivePage(); });
        }

        // Import/export JSON de session retirés du dock (archive .oi.zip uniquement).

        const exportArchiveBtn = document.getElementById('exportArchiveBtn');
        if (exportArchiveBtn && typeof window.exportArchive === 'function') {
            exportArchiveBtn.addEventListener('click', () => { void window.exportArchive(); });
        }

        const importArchiveBtn = document.getElementById('importArchiveBtn');
        const archiveFileInput = document.getElementById('archiveFileInput') as HTMLInputElement | null;
        if (importArchiveBtn && archiveFileInput) {
            importArchiveBtn.addEventListener('click', () => archiveFileInput.click());
            archiveFileInput.addEventListener('change', (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                // Garde `file` ajoutée (typage pur) : `importArchive` attend un `File`,
                // pas `File | undefined` (annulation de la boîte de dialogue).
                if (file && typeof window.importArchive === 'function') void window.importArchive(file);
                (e.target as HTMLInputElement).value = '';
            });
        }

        // §12.3 étape 14 — Boutons PATRACDVR. 4.html:4691-4751
        const openUniteConfigBtn = document.getElementById('openUniteConfigBtn');
        if (openUniteConfigBtn) openUniteConfigBtn.addEventListener('click', () => {
            if (typeof window.openUniteConfigModal === 'function') window.openUniteConfigModal();
        });
        const uniteConfigSaveBtn = document.getElementById('unite_config_saveBtn');
        if (uniteConfigSaveBtn) uniteConfigSaveBtn.addEventListener('click', () => {
            if (typeof window.saveUniteConfig === 'function') window.saveUniteConfig();
        });
        const patracdvrPdfBtn = document.getElementById('patracdvrPdfBtn');
        if (patracdvrPdfBtn) patracdvrPdfBtn.addEventListener('click', () => {
            if (typeof window.generatePatracdvrPdf === 'function') void window.generatePatracdvrPdf();
        });

        if (oiState.resetPatracdvrBtn && typeof window.resetPatracdvrUI === 'function') {
            oiState.resetPatracdvrBtn.addEventListener('click', window.resetPatracdvrUI);
        }

        const addManualVehicleBtn = document.getElementById('addManualVehicleBtn');
        if (addManualVehicleBtn) addManualVehicleBtn.addEventListener('click', window.addManualVehicle);

        const addManualMemberBtn = document.getElementById('addManualMemberBtn');
        if (addManualMemberBtn) addManualMemberBtn.addEventListener('click', window.addManualMember);

        // Création de cellule en batch (India / AO / Effraction). 4.html:4716-4720
        document.querySelectorAll<HTMLElement>('.cell-batch-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                // Cast pur : data-cell est toujours présent sur .cell-batch-btn (markup statique).
                if (typeof window.addCellBatch === 'function') window.addCellBatch(btn.dataset.cell as string);
            });
        });

        // Déplacement en lot (batch). 4.html:4723-4742
        const patracBatchToggleBtn = document.getElementById('patracBatchToggleBtn');
        if (patracBatchToggleBtn) patracBatchToggleBtn.addEventListener('click', () => {
            if (typeof window.togglePatracBatchMode === 'function') window.togglePatracBatchMode();
        });
        const patracBatchMoveBtn = document.getElementById('patracBatchMove');
        if (patracBatchMoveBtn) patracBatchMoveBtn.addEventListener('click', () => {
            if (typeof window.patracBatchShowTargets === 'function') window.patracBatchShowTargets();
        });
        const patracBatchCellBtn = document.getElementById('patracBatchSelectCell');
        if (patracBatchCellBtn) patracBatchCellBtn.addEventListener('click', () => {
            if (typeof window.patracBatchSelectWholeCell === 'function') window.patracBatchSelectWholeCell();
        });
        const patracBatchUnassignBtn = document.getElementById('patracBatchUnassign');
        if (patracBatchUnassignBtn) patracBatchUnassignBtn.addEventListener('click', () => {
            if (typeof window.patracBatchUnassign === 'function') window.patracBatchUnassign();
        });
        const patracBatchClearBtn = document.getElementById('patracBatchClear');
        if (patracBatchClearBtn) patracBatchClearBtn.addEventListener('click', () => {
            if (typeof window.patracBatchClear === 'function') window.patracBatchClear();
        });

        // §12.3 étape 15 — MOICP/ZMSPCP/Effraction. 4.html:4744-4751
        const addMoicpBtn = document.getElementById('addMoicpBtn');
        if (addMoicpBtn) addMoicpBtn.addEventListener('click', () => { if (typeof window.addMoicp === 'function') window.addMoicp(); });

        const addZmspcpBtn = document.getElementById('addZmspcpBtn');
        if (addZmspcpBtn) addZmspcpBtn.addEventListener('click', () => { if (typeof window.addZmspcp === 'function') window.addZmspcp(); });

        const addEffractionBtn = document.getElementById('addEffractionBtn');
        if (addEffractionBtn) addEffractionBtn.addEventListener('click', () => { if (typeof window.addEffraction === 'function') window.addEffraction(); });

        // §12.3 étape 16 — Présentation / PDF / fermeture modale. 4.html:4753-4772
        if (oiState.previewBtn) oiState.previewBtn.addEventListener('click', window.openPresentationMode);
        // PDF.INTEG (SPEC-PDF-V3.md §5.1) — bascule silencieuse : le libellé/id/
        // position du bouton NE CHANGENT PAS, seule la fonction câblée change,
        // de l'ancien `window.downloadOiPdf` (rastérisation html2canvas+jsPDF,
        // retirée) vers `downloadOiPdfV3()` (moteur vectoriel pdfmake,
        // `@oi/pdf/engine-v3.js`). Import dynamique : même raison que le bouton
        // d'impression ci-dessus (chunk pdfmake jamais chargé sans clic).
        const dlPdfBtn = document.getElementById('downloadPdfBtn');
        if (dlPdfBtn) dlPdfBtn.addEventListener('click', () => {
            void import('@oi/pdf/engine-v3.js').then((m) => m.downloadOiPdfV3());
        });

        const presentHereBtn = document.getElementById('presentHereBtn');
        if (presentHereBtn) presentHereBtn.addEventListener('click', () => {
            if (typeof window.openPresentInPlace === 'function') window.openPresentInPlace();
        });

        const closePBtn = document.getElementById('closePresentationModalBtn');
        if (closePBtn) {
            closePBtn.addEventListener('click', () => {
                const m = document.getElementById('presentationModal') as HTMLDialogElement | null;
                if (m) {
                    if (typeof m.close === 'function') m.close();
                    else m.style.display = 'none';
                }
            });
        }

        // §12.3 étape 17 — Restauration étape + étapes visitées (OI4). 4.html:4774-4787
        try {
            const savedVisitedRaw: unknown = JSON.parse(localStorage.getItem('oiVisitedSteps') || '[]');
            if (Array.isArray(savedVisitedRaw) && window.visitedSteps) {
                (savedVisitedRaw as unknown[]).forEach((i) => { if (typeof i === 'number') window.visitedSteps.add(i); });
            }
        } catch { /* ignore */ }
        const stepCount = oiState.steps.length ? oiState.steps.length : 8;
        let savedStep = parseInt(localStorage.getItem('oiWizardStep') || '', 10);
        if (!Number.isInteger(savedStep) || savedStep < 0 || savedStep >= stepCount) {
            savedStep = (window.Store && window.Store.state.currentStep) || 0;
        }
        if (window.Store) window.Store.state.currentStep = savedStep;
        window.showStep(savedStep);

        // R2-T4 — validation inline des champs statiques à contrainte réelle.
        // Hors des 18 étapes §12.3 (ajout de la tranche, pas du portage verbatim).
        initOiStaticFieldValidation();

        // P3 — compteurs de caractères calibrés PDF sur les champs ZMSPCP/
        // MOICP (CAT) et effraction, créés dynamiquement par `articulation.ts`.
        initOiDynamicCharCounters();

    } catch (err) {
        console.error("Erreur d'initialisation OI:", err);
    }
});

/**
 * R2-T4 — branche la validation inline sur les champs STATIQUES (présents
 * dans `oi/index.html`, jamais recréés). Les champs dynamiques (fiches
 * adversaire) sont branchés à la création, dans `formulaires.ts`
 * (`addAdversary`) — cf. SPEC R2-T4.
 *
 * Cible : uniquement les champs à contrainte métier RÉELLE et déjà établie
 * ailleurs dans l'app (pas d'invention) :
 *  - `date_op` : requis — seul champ signalé « manquant » par
 *    `checkCoherence()` (formulaires.ts) hors listes dynamiques.
 *  - `quick_edit_trigramme_input` : 2 à 4 caractères — même règle que
 *    `addManualMember`/`addCellBatch` (patrac.ts), jusqu'ici non appliquée à
 *    l'édition rapide d'un trigramme existant.
 */
function initOiStaticFieldValidation(): void {
    const dateOp = document.getElementById('date_op') as HTMLInputElement | null;
    if (dateOp) {
        attachValidation(dateOp, [required("La date de l'opération est requise.")]);
    }

    const quickEditTrigramme = document.getElementById('quick_edit_trigramme_input') as HTMLInputElement | null;
    if (quickEditTrigramme) {
        attachValidation(quickEditTrigramme, [
            lengthRange(2, 4, 'Le trigramme doit contenir entre 2 et 4 caractères.'),
        ]);
    }
}

/**
 * P3 — sélecteurs (classes CSS, sans id) des champs ZMSPCP/MOICP (CAT) et
 * effraction (technique/dégagement/assaut par hypothèse) alimentant des
 * sections PDF à refus possible, avec le seuil `charCounter` associé.
 * `articulation.ts` (création de ces blocs) est HORS PÉRIMÈTRE de cette
 * tranche (fichiers autorisés P3 : `validation.ts`/`formulaires.ts`/
 * `main.ts`) : le branchement se fait donc ICI, par observation des 3
 * conteneurs statiques (`oi/index.html`) où ces champs sont insérés, plutôt
 * qu'à la création dans `articulation.ts` — même résultat fonctionnel
 * (« compteur branché à la création »), sans toucher un fichier hors
 * périmètre.
 */
const CHAR_COUNTER_DYNAMIC_FIELDS: ReadonlyArray<{ selector: string; softMax: number }> = [
    { selector: '.moicp-cat', softMax: ARTICULATION_CAT_SOFT_MAX },
    { selector: '.zmspcp-cat', softMax: ARTICULATION_CAT_SOFT_MAX },
    { selector: '.effrac-hyp-effrac', softMax: EFFRACTION_HYP_FIELD_SOFT_MAX },
    { selector: '.effrac-hyp-degag', softMax: EFFRACTION_HYP_FIELD_SOFT_MAX },
    { selector: '.effrac-hyp-assaut', softMax: EFFRACTION_HYP_FIELD_SOFT_MAX },
];

/** Branche `charCounter` sur `el` s'il correspond à l'un des sélecteurs ci-dessus (l'élément lui-même OU un de ses descendants — un bloc MOICP/ZMSPCP/hypothèse entier est inséré d'un coup). */
function attachDynamicCharCounters(root: ParentNode): void {
    for (const { selector, softMax } of CHAR_COUNTER_DYNAMIC_FIELDS) {
        const targets: Element[] = [];
        if (root instanceof Element && root.matches(selector)) targets.push(root);
        targets.push(...Array.from(root.querySelectorAll(selector)));
        for (const target of targets) {
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
                charCounter(target, { softMax });
            }
        }
    }
}

/**
 * P3 — observe les 3 conteneurs où `articulation.ts` insère ses blocs
 * (MOICP/ZMSPCP/effraction) et branche `charCounter` sur les champs cibles
 * dès leur insertion dans le DOM (`childList`+`subtree` : un bloc, ou une
 * carte hypothèse ajoutée à l'intérieur d'un bloc effraction déjà présent,
 * déclenchent la même détection).
 */
function initOiDynamicCharCounters(): void {
    const containerIds = ['moicp_container', 'zmspcp_container', 'effraction_container'];
    for (const containerId of containerIds) {
        const container = document.getElementById(containerId);
        if (!container) continue;
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof Element) attachDynamicCharCounters(node);
                });
            }
        });
        observer.observe(container, { childList: true, subtree: true });
    }
}

// ── §12.3 étape 18 — Toggle Format PDF, VERBATIM de 4.html:4794-4812. Hors
// du handler DOMContentLoaded dans l'original (script de fin de body, exécuté
// après le parsing du DOM) : reproduit ICI hors du handler ci-dessus, à la
// racine du module — même position relative, `type="module"` étant lui aussi
// exécuté après le parsing complet du document. ────────────────────────────
window.setPdfFormat = function (fmt) {
    window.pdfOutputFormat = fmt;
    localStorage.setItem('pdfOutputFormat', fmt);

    const btnA4 = document.getElementById('btnFormatA4');
    const btn169 = document.getElementById('btnFormat169');
    const dims = document.getElementById('pdfFormatDims');

    if (btnA4) btnA4.classList.toggle('active', fmt === 'a4');
    if (btn169) btn169.classList.toggle('active', fmt === '16:9');
    if (dims) dims.textContent = fmt === '16:9' ? '338×190 mm' : '297×210 mm';
};

// Restaurer le choix au chargement. 4.html:4809-4812
(function initPdfFormatToggle() {
    const saved = (localStorage.getItem('pdfOutputFormat') || 'a4') as 'a4' | '16:9';
    window.setPdfFormat(saved);
})();
