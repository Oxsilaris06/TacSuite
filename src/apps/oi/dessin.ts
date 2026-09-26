/**
 * dessin.ts — Système d'annotation et de dessin sur les photos (outils,
 * sélection, historique undo/redo) — P3.CONV, paquet `oi-dessin` (CRITIQUE).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM de `modules/dessin.js` (GStart-main, lecture
 * seule, 1348 LOC intégral) : 36 fonctions top-level, de
 * `pushAnnotationHistory` (:23) à `initAnnotationWorkspace` (:1189). FICHIER
 * UNIQUE imposé (structure plate, pas d'objet littéral : le patron de
 * découpage `carto/` ne s'applique pas ici). Cf. `docs/SPEC-OI-CONVERSION.md`
 * §11.6 et §3, `PAQUETS-OI.json` (`oi-dessin`).
 *
 * Implémente `OiAnnotationGlobals` (`@shared/types/contracts.js`), posé au
 * scope module aux lignes correspondantes de l'original (:84-85, :254,
 * :449-450, :1103, :1143-1150, :1170, :1182, :1348).
 *
 * ÉTAT PARTAGÉ (SPEC §3) : les 12 variables d'annotation (annotationModal,
 * canvas, ctx, rotationInput [SAUF quand l'original le réinterroge en LOCAL
 * via `document.getElementById('rotation_input')`, cf. `setContextualTools`/
 * `updateAnnotationRotation` — ce n'est PAS `oiState.rotationInput`], baseImage,
 * currentTool, isDrawing, isDragging, startX, startY, currentAnnotation,
 * selectedAnnotation, dragOffsetX, dragOffsetY, isMovingAnnotation,
 * currentAnnotationColor) étaient déclarées dans `init.js` et réassignées
 * ici : elles vivent dans `@oi/state.js` → transformation MÉCANIQUE identifiant
 * nu `X` → `oiState.X`, rien d'autre ne change. `isDragging`/`dragOffsetX`/
 * `dragOffsetY` ne sont PAS lues/écrites par `dessin.js` (vérifié) : non
 * référencées dans ce fichier.
 *
 * ÉTAT LOCAL (reste dans ce fichier, jamais partagé) : longPressTimer (:7),
 * LONG_PRESS_DURATION (:8), currentAnnotationZoom (:9), annotationHistory /
 * annotationRedoStack (:12-13), ANNOTATION_HISTORY_MAX (:14), isResizing /
 * isRotating (:17-18), gestureSnapshot / gestureStart (:19-20),
 * annotationWorkspaceInitialized (:1188).
 *
 * RÈGLE D'OR (SPEC §2.2) : `syncDomToStore`/`saveToStorage` sont résolus
 * globalement dans l'original (`typeof … === 'function'` QUAND l'original a
 * cette garde, appel NU sinon — reproduit site par site, pas de garde ajoutée
 * ni retirée) → `window.syncDomToStore`/`window.saveToStorage`, PAS d'import.
 * `populateMemberCanvasModal` est exposée sur `window` (contrat
 * `OiAnnotationGlobals`) : les appels internes à ce fichier (handleDrawStart)
 * passent donc aussi par `window.populateMemberCanvasModal`.
 *
 * INVARIANT EXPLICITE (`recon-oi.md` §9 « cohérence rendu interactif / export »)
 * : `drawAnnotationOnContext` (:992) est LA SEULE fonction de rendu, partagée
 * entre l'aperçu canvas interactif (`redrawCanvas` → `drawAnnotation`, ctx
 * partagé) ET l'aplatissement final (`createAnnotatedImageBlob`, contexte
 * local) — les deux implémentations ne sont PAS fusionnées (l'original ne le
 * fait pas non plus : `drawAnnotation` et `drawAnnotationOnContext` restent
 * deux fonctions distinctes, `drawAnnotationOnContext` dupliquant même sa
 * propre variante locale de `drawArrow`, verbatim).
 *
 * ÉCART DE CONTRAT SIGNALÉ AU GATE (règle commune (6), SPEC §2.2) — même
 * élargissement que `@oi/outils.js` (`OiShapeAnnotationWithBounds`) : ce
 * fichier lit ET écrit, pour les annotations 'location'/'box' (et,
 * ponctuellement sans discriminer par `type`, pour n'importe quelle
 * sélection — `handleDrawStart` box0/arrow0, `updateStrokeWidth`), des champs
 * `x`/`y`/`radius`/`width`/`height` que `OiShapeAnnotation` (contracts.ts) ne
 * déclare pas (seuls `startX/startY/endX/endY/thickness` y figurent). Voir le
 * commentaire détaillé au-dessus de `OiShapeAnnotationWithBounds` plus bas.
 * `contracts.ts` n'est PAS modifié (hors périmètre de ce paquet, interdiction
 * commune (2)).
 *
 * ÉCART ASSUMÉ — `cleanupObjectUrls` : listée dans SPEC §2.1 comme dépendance
 * de `dessin.js` vers `outils.js`, mais AUCUN appel réel n'existe dans la
 * source actuelle (`closeAnnotationModal`, :936, porte le commentaire
 * `// REMOVED: cleanupObjectUrls() - Trop agressif, révoque tout le cache
 * UI.` — c'est un commentaire, pas du code). L'importer sans l'appeler
 * échouerait `noUnusedLocals` et ajouterait une capacité absente de
 * l'original : NON importée. Signalé au gate.
 *
 * ÉCARTS ASSUMÉS DE TYPAGE (« jamais pris en défaut en pratique », mêmes
 * garde-fous que `@oi/outils.js`/`@oi/patrac.ts`/`@oi/navigation.ts`) : `!`
 * étant interdit, plusieurs lectures non gardées de l'original
 * (`canvas`/`ctx`/`annotationModal`/`annotationModal.dataset.targetPreviewId`
 * potentiellement `null`/`undefined` côté TypeScript alors que l'invariant
 * applicatif — modale déjà ouverte, refs déjà résolues par `main.ts` — les
 * garantit non nulles) reçoivent une capture + un retour anticipé documenté
 * localement au premier site rencontré par fonction.
 */

import type {
    OiAnnotation,
    OiAnnotationTool,
    OiPointAnnotation,
    OiShapeAnnotation,
} from '@shared/types/contracts.js';
import { annotationHost } from '@shared/annotation-host.js';
import { oiState } from '@oi/state.js';
import { confirmDialog, promptDialog, toast } from '@shared/feedback.js';

// ---------------------------------------------------------------------------
// Écart de contrat (cf. en-tête) — vue élargie locale, en lecture ET écriture.
// ---------------------------------------------------------------------------

/**
 * ÉCART DE CONTRAT SIGNALÉ AU GATE (règle commune (6), SPEC §2.2) — même
 * élargissement que `@oi/outils.js` (`OiShapeAnnotationWithBounds`) :
 * `dessin.js` lit ET écrit, pour les annotations 'location'/'box' (et,
 * ponctuellement sans discriminer par `type` — `handleDrawStart` :694-700,
 * `updateStrokeWidth` :207-209 — pour n'importe quelle sélection), des champs
 * `x`/`y`/`radius`/`width`/`height` que `OiShapeAnnotation` (contracts.ts) ne
 * déclare pas (seuls `startX/startY/endX/endY/thickness` y figurent). Ces
 * champs sont pourtant bien posés à l'exécution par ce même fichier
 * (`final.width`/`final.height` :899-900, `final.radius` :909). Élargissement
 * LOCAL à ce fichier, EN LECTURE ET ÉCRITURE : n'ajoute aucune contrainte aux
 * appelants, ne redéfinit pas `OiShapeAnnotation`/`OiAnnotation` (exports
 * canoniques de `contracts.ts`, inchangés). `contracts.ts` est hors périmètre
 * de ce paquet (`src/shared/**`, interdiction commune (2)) : à corriger au
 * gate, en même temps que l'écart déjà signalé côté `@oi/outils.js` (même
 * cause).
 */
type OiShapeAnnotationWithBounds = OiShapeAnnotation & {
    x: number;
    y: number;
    radius: number;
    width: number;
    height: number;
};

/**
 * Vue élargie utilisée par les fonctions qui discriminent explicitement par
 * `annotation.type` (`getSelectionBBox`, `getSelectionHandles`,
 * `hitSelectionHandle`, `getAnnotationMetric`, `drawAnnotation`,
 * `drawAnnotationOnContext`, `drawSelectionBorder`) : cf. le commentaire
 * d'écart de contrat ci-dessus.
 */
type OiAnnotationWithBounds = OiPointAnnotation | OiShapeAnnotationWithBounds;

/**
 * Cast utilitaire centralisant l'écart de contrat ci-dessus (un seul point de
 * justification `unknown`, réutilisé à chaque lecture d'une annotation déjà
 * stockée dont on doit lire des champs géométriques spécifiques au type).
 * Identité à l'exécution (aucune copie) : les mutations à travers la valeur
 * retournée s'appliquent bien à l'objet d'origine, comme dans l'original.
 */
function withBounds(a: OiAnnotation): OiAnnotationWithBounds {
    return a as unknown as OiAnnotationWithBounds;
}

// --- Annotation / Drawing Globals --- dessin.js:7-20
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
const LONG_PRESS_DURATION = 500; // ms
let currentAnnotationZoom = 1.0;

// ===== Historique annotation — undo / redo (Lot B1) =====
let annotationHistory: string[] = [];
let annotationRedoStack: string[] = [];
const ANNOTATION_HISTORY_MAX = 50;

// ===== Manipulation directe — poignées resize / rotation (Lot B2) =====
let isResizing = false;
let isRotating = false;
let gestureSnapshot: string | null = null; // snapshot JSON pris au début d'un geste move/resize/rotate

/** { cx, cy, dist0, metric0 } pour le redimensionnement (dessin.js:20). */
interface OiResizeGestureStart {
    cx: number;
    cy: number;
    dist0: number;
    metric0: number;
    box0: { width: number; height: number };
    arrow0: { startX: number; startY: number; endX: number; endY: number };
}
interface OiRotateGestureStart {
    cx: number;
    cy: number;
}
let gestureStart: OiResizeGestureStart | OiRotateGestureStart | null = null;

// ---------------------------------------------------------------------------
// Géométrie (venue de `@oi/outils.js`, décision 25) : le moteur n'importe plus
// `outils`, qui charge le Store de l'OI.
// ---------------------------------------------------------------------------

// outils.js:8-15
/**
 * Opacité de remplissage d'une zone, toujours un nombre dans [0, 1] (audit du
 * 26/09 : `opacity || 0.5` changeait un 0 voulu, contour seul, en 50 %, et la
 * création stockait la chaîne du curseur). Illisible : 0,5 par défaut.
 */
export function fillOpacity(v: unknown): number {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0.5;
    return Math.min(1, Math.max(0, n));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    // outils.js:10-14 — noUncheckedIndexedAccess : la regex a exactement 3
    // groupes capturants NON optionnels, donc toujours renseignés quand
    // `result` est non nul (même idiome que `carto/map-core.ts` `_parseGps`) ;
    // `?? ''` ne change rien en pratique (jamais atteint), `parseInt('', 16)`
    // vaut `NaN` comme `parseInt(undefined, 16)` dans l'original.
    return result
        ? {
              r: parseInt(result[1] ?? '', 16),
              g: parseInt(result[2] ?? '', 16),
              b: parseInt(result[3] ?? '', 16),
          }
        : null;
}

// outils.js:27-38
export function getEventPos(canvas: HTMLCanvasElement, evt: MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    // Utiliser une vérification plus robuste pour l'événement tactile
    // outils.js:30-31 — `'touches' in evt` distingue MouseEvent/TouchEvent
    // (même test que le duck-typing `evt.touches && …` de l'original) ;
    // noUncheckedIndexedAccess impose une capture locale de `touches[0]`
    // (`TouchList[0]` est `Touch | undefined`) avant lecture.
    const touch = 'touches' in evt && evt.touches.length > 0 ? evt.touches[0] : undefined;
    // outils.js:30-31 — dans la branche « pas de touch », l'original lit
    // `evt.clientX` sans discriminer le type (y compris si `evt` est un
    // TouchEvent à `touches` vide, où `.clientX` vaut `undefined` — même
    // issue avec ce cast, comportement identique).
    const clientX = touch ? touch.clientX : (evt as MouseEvent).clientX;
    const clientY = touch ? touch.clientY : (evt as MouseEvent).clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
}

// outils.js:40-49
export function getRotatedPoint(
    x: number,
    y: number,
    centerX: number,
    centerY: number,
    angle: number,
): { x: number; y: number } {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const translatedX = x - centerX;
    const translatedY = y - centerY;
    return {
        x: translatedX * cos - translatedY * sin + centerX,
        y: translatedX * sin + translatedY * cos + centerY,
    };
}

/**
 * outils.js:51-119 — lit les annotations de l'hôte (`annotationHost.annotations`) (parcours en ordre
 * inverse : la dernière annotation dessinée est testée en premier) et
 * `oiState.ctx` (mesure de texte pour 'text'/'member'). NE PAS simplifier la
 * trigonométrie ni les tolérances (PAQUETS-OI.json `oi-outils`).
 */
export function getAnnotationAtPosition(x: number, y: number): OiAnnotation | null {
    // outils.js:80,87 — `ctx` capturé une seule fois : le `const` narrowé par
    // les gardes ci-dessous reste non nul pour le reste de la fonction (même
    // idiome que `carto/map-core.ts`, capture locale dès l'entrée).
    const ctx = oiState.ctx;

    for (let i = annotationHost.annotations.length - 1; i >= 0; i--) {
        // outils.js:53 — noUncheckedIndexedAccess (index toujours valide par
        // construction de la boucle, jamais vérifié dans l'original) combiné
        // à l'élargissement de contrat ci-dessus : passage par `unknown`,
        // aucun sous-typage direct n'exprime les deux écarts à la fois.
        const annotation = annotationHost.annotations[i] as unknown as OiAnnotationWithBounds;
        const angle = annotation.rotation || 0;
        // outils.js:55 — TypeScript exige une valeur initiale (analyse de
        // définite assignment) : le if/else if ci-dessous couvre
        // exhaustivement les 5 types d'annotation (aucun `else` dans
        // l'original) ; ces valeurs par défaut ne sont donc jamais lues en
        // pratique — écart de typage assumé, comportement identique
        // (l'original laissait `undefined`, jamais lu non plus dans ce cas).
        let centerX = 0;
        let centerY = 0;

        if (annotation.type === 'location' || annotation.type === 'text' || annotation.type === 'member') {
            centerX = annotation.x;
            centerY = annotation.y;
        } else if (annotation.type === 'box') {
            centerX = annotation.x + annotation.width / 2;
            centerY = annotation.y + annotation.height / 2;
        } else if (annotation.type === 'arrow') {
            centerX = (annotation.startX + annotation.endX) / 2;
            centerY = (annotation.startY + annotation.endY) / 2;
        }

        // Pour des annotationHost.annotations simples, le centre de rotation est le centre de l'objet
        const rotatedPos = getRotatedPoint(x, y, centerX, centerY, angle);
        const testX = rotatedPos.x;
        const testY = rotatedPos.y;

        const tolerance = 15;
        let isInside = false;

        switch (annotation.type) {
            case 'location':
                isInside = Math.sqrt(Math.pow(testX - annotation.x, 2) + Math.pow(testY - annotation.y, 2)) <= annotation.radius + tolerance / 2;
                break;
            case 'box':
                isInside = testX >= annotation.x - tolerance && testX <= annotation.x + annotation.width + tolerance &&
                    testY >= annotation.y - tolerance && testY <= annotation.y + annotation.height + tolerance;
                break;
            case 'text': {
                // Simple bounding box approx
                const size = annotation.size || 30;
                // outils.js:80 — `ctx` potentiellement `null` côté TS (jamais
                // en pratique, cf. capture ci-dessus) ; `!` interdit ⇒ un
                // `break` laisse `isInside` à `false`, même issue observable
                // que l'exception que l'original aurait levée ici (annotation
                // ignorée par ce test de position).
                if (!ctx) break;
                ctx.font = `bold ${size}px Oswald`;
                const w = ctx.measureText(annotation.text).width;
                const h = size;
                isInside = testX >= annotation.x && testX <= annotation.x + w && testY >= annotation.y - h && testY <= annotation.y;
                break;
            }
            case 'member': {
                const mSize = annotation.size || 20;
                if (!ctx) break;
                ctx.font = `bold ${mSize}px Oswald`;
                const mPadX = mSize * 0.8;
                const mPadY = mSize * 0.4;
                const mW = ctx.measureText(annotation.text).width + mPadX * 2;
                const mH = mSize + mPadY * 2;
                isInside = testX >= annotation.x - mW / 2 && testX <= annotation.x + mW / 2 && testY >= annotation.y - mH / 2 && testY <= annotation.y + mH / 2;
                break;
            }
            case 'arrow': {
                const dx = annotation.endX - annotation.startX;
                const dy = annotation.endY - annotation.startY;
                const lenSq = dx * dx + dy * dy;
                if (lenSq === 0) break;
                const t = ((testX - annotation.startX) * dx + (testY - annotation.startY) * dy) / lenSq;
                const projX = annotation.startX + t * dx;
                const projY = annotation.startY + t * dy;
                if (t >= 0 && t <= 1) {
                    // Vérification de la distance au carré de la position du clic à la ligne projetée
                    const distSq = Math.pow(testX - projX, 2) + Math.pow(testY - projY, 2);
                    // outils.js:105,110 — `thickness` est optionnel dans
                    // `OiShapeAnnotation` ; `?? NaN` reproduit exactement la
                    // coercion `undefined + tolerance → NaN` de l'original
                    // (comparaisons `<=`/`||` avec NaN toujours fausses, même
                    // résultat observable).
                    isInside = distSq <= Math.pow((annotation.thickness ?? NaN) + tolerance, 2);
                } else {
                    // Vérification si l'on est proche des extrémités (pour les flèches courtes)
                    const distStartSq = Math.pow(testX - annotation.startX, 2) + Math.pow(testY - annotation.startY, 2);
                    const distEndSq = Math.pow(testX - annotation.endX, 2) + Math.pow(testY - annotation.endY, 2);
                    const maxDistSq = Math.pow((annotation.thickness ?? NaN) + tolerance, 2);
                    isInside = distStartSq <= maxDistSq || distEndSq <= maxDistSq;
                }
                break;
            }
        }

        if (isInside) return annotation;
    }
    return null;
}

/** Empile l'état courant des annotations (à appeler AVANT une mutation discrète). */
function pushAnnotationHistory(): void {
    annotationHistory.push(JSON.stringify(annotationHost.annotations));
    if (annotationHistory.length > ANNOTATION_HISTORY_MAX) annotationHistory.shift();
    annotationRedoStack = [];
    refreshAnnotationUndoRedo();
}

/** Valide un snapshot pré-geste dans l'historique (uniquement si l'état a changé). */
function commitAnnotationHistory(snapshot: string | null): void {
    if (!snapshot || snapshot === JSON.stringify(annotationHost.annotations)) return;
    annotationHistory.push(snapshot);
    if (annotationHistory.length > ANNOTATION_HISTORY_MAX) annotationHistory.shift();
    annotationRedoStack = [];
    refreshAnnotationUndoRedo();
}

function undoAnnotation(): void {
    if (!annotationHistory.length) return;
    annotationRedoStack.push(JSON.stringify(annotationHost.annotations));
    const snapshot = annotationHistory.pop();
    // dessin.js:42 — `pop()` ne peut renvoyer `undefined` ici (garde de
    // longueur ci-dessus) ; TS ne le déduit pas de `.length`, jamais pris en
    // défaut en pratique.
    if (snapshot !== undefined) {
        try {
            annotationHost.annotations = JSON.parse(snapshot) as OiAnnotation[];
        } catch {
            /* JSON invalide : état inchangé, comme l'original (dessin.js:42) */
        }
    }
    oiState.selectedAnnotation = null;
    setContextualTools(null);
    redrawCanvas();
    persistAnnotationsToPreview();
    refreshAnnotationUndoRedo();
}

function redoAnnotation(): void {
    if (!annotationRedoStack.length) return;
    annotationHistory.push(JSON.stringify(annotationHost.annotations));
    const snapshot = annotationRedoStack.pop();
    // dessin.js:53 — même garde que undoAnnotation (jamais `undefined` ici).
    if (snapshot !== undefined) {
        try {
            annotationHost.annotations = JSON.parse(snapshot) as OiAnnotation[];
        } catch {
            /* JSON invalide : état inchangé, comme l'original (dessin.js:53) */
        }
    }
    oiState.selectedAnnotation = null;
    setContextualTools(null);
    redrawCanvas();
    persistAnnotationsToPreview();
    refreshAnnotationUndoRedo();
}

function refreshAnnotationUndoRedo(): void {
    const u = document.getElementById('annotation_undo') as HTMLButtonElement | null;
    const r = document.getElementById('annotation_redo') as HTMLButtonElement | null;
    if (u) {
        u.disabled = !annotationHistory.length;
        u.style.opacity = annotationHistory.length ? '1' : '0.4';
    }
    if (r) {
        r.disabled = !annotationRedoStack.length;
        r.style.opacity = annotationRedoStack.length ? '1' : '0.4';
    }
}

function resetAnnotationHistory(): void {
    annotationHistory = [];
    annotationRedoStack = [];
    refreshAnnotationUndoRedo();
}

/** Snapshot avant / commit après pour les sliders contextuels (input continu). */
function bindHistorySlider(el: HTMLElement | null): void {
    if (!el) return;
    let snap: string | null = null;
    const take = () => {
        snap = JSON.stringify(annotationHost.annotations);
    };
    el.addEventListener('pointerdown', take);
    el.addEventListener('keydown', take);
    el.addEventListener('change', () => {
        commitAnnotationHistory(snap);
        snap = null;
    });
}

window.undoAnnotation = undoAnnotation;
window.redoAnnotation = redoAnnotation;

/** Boîte englobante non pivotée d'une annotation : {x, y, width, height, centerX, centerY}. */
function getSelectionBBox(annotation: OiAnnotationWithBounds): {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
} {
    let x: number;
    let y: number;
    let width: number;
    let height: number;
    if (annotation.type === 'location') {
        x = annotation.x - annotation.radius;
        y = annotation.y - annotation.radius;
        width = annotation.radius * 2;
        height = annotation.radius * 2;
    } else if (annotation.type === 'box') {
        x = annotation.x;
        y = annotation.y;
        width = annotation.width;
        height = annotation.height;
    } else if (annotation.type === 'arrow') {
        const minX = Math.min(annotation.startX, annotation.endX);
        const minY = Math.min(annotation.startY, annotation.endY);
        const maxX = Math.max(annotation.startX, annotation.endX);
        const maxY = Math.max(annotation.startY, annotation.endY);
        x = minX - 10;
        y = minY - 10;
        width = maxX - minX + 20;
        height = maxY - minY + 20;
    } else {
        // text / member
        // dessin.js:102 — narrowing du discriminant `type` non résolu par TS à
        // travers l'intersection `OiShapeAnnotationWithBounds` dans cette
        // dernière branche `else` (constaté à la compilation) ; cast direct
        // vers OiPointAnnotation (seul membre restant par élimination).
        const size = (annotation as OiPointAnnotation).size || 30;
        let tw = 0;
        const ctx = oiState.ctx;
        // dessin.js:103-106 — ctx toujours non-null ici en pratique (jamais
        // appelé avant l'ouverture de la modale d'annotation) ; `!` interdit ⇒
        // repli tw=0, jamais pris en défaut.
        if (ctx) {
            ctx.save();
            ctx.font = `bold ${size}px Oswald`;
            tw = ctx.measureText(annotation.text || '').width;
            ctx.restore();
        }
        if (annotation.type === 'member') {
            const padX = size * 0.8;
            const padY = size * 0.4;
            width = tw + padX * 2;
            height = size + padY * 2;
            x = annotation.x - width / 2;
            y = annotation.y - height / 2;
        } else {
            width = tw + 20;
            height = size + 10;
            x = annotation.x - 10;
            y = annotation.y - size;
        }
    }
    return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}

/** Positions des poignées (repère canvas non pivoté) de la sélection. */
function getSelectionHandles(annotation: OiAnnotationWithBounds): {
    bbox: { x: number; y: number; width: number; height: number; centerX: number; centerY: number };
    rotate: { x: number; y: number };
    resize: { x: number; y: number };
} {
    const bb = getSelectionBBox(annotation);
    const rotOffset = 34 / currentAnnotationZoom;
    return {
        bbox: bb,
        rotate: { x: bb.centerX, y: bb.y - rotOffset },
        resize: { x: bb.x + bb.width, y: bb.y + bb.height },
    };
}

/** Teste si (ux,uy) — déjà ramené dans le repère non pivoté — touche une poignée.
 *  Retourne 'rotate' | 'resize' | null. */
function hitSelectionHandle(annotation: OiAnnotationWithBounds, ux: number, uy: number): 'rotate' | 'resize' | null {
    const h = getSelectionHandles(annotation);
    const tol = 18 / currentAnnotationZoom;
    if (Math.hypot(ux - h.rotate.x, uy - h.rotate.y) <= tol) return 'rotate';
    if (Math.hypot(ux - h.resize.x, uy - h.resize.y) <= tol) return 'resize';
    return null;
}

/** Métrique de taille d'une annotation, utilisée pour le redimensionnement uniforme. */
function getAnnotationMetric(a: OiAnnotationWithBounds): number {
    if (a.type === 'location') return a.radius || 1;
    if (a.type === 'box') return Math.max(a.width || 1, a.height || 1);
    if (a.type === 'arrow') return Math.hypot(a.endX - a.startX, a.endY - a.startY) || 1;
    // dessin.js:145 — même limite de narrowing que getSelectionBBox (cf. son
    // commentaire) ; cast direct vers OiPointAnnotation.
    return (a as OiPointAnnotation).size || 30; // text / member
}

function setContextualTools(selection: OiAnnotation | null): void {
    const contextualTools = document.getElementById('contextual_tools');
    if (!contextualTools) return;

    if (!selection) {
        contextualTools.classList.remove('active');
        return;
    }
    contextualTools.classList.add('active');

    // Rotation : refléter l'angle dans le slider visible + l'input caché.
    let deg = Math.round(((selection.rotation || 0) * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const rotationInput = document.getElementById('rotation_input') as HTMLInputElement | null;
    const rotationSlider = document.getElementById('rotation_input_slider') as HTMLInputElement | null;
    if (rotationInput) rotationInput.value = String(deg);
    if (rotationSlider) rotationSlider.value = String(deg);

    // Épaisseur de trait (box / arrow)
    const strokeSlider = document.getElementById('stroke_width_edit') as HTMLInputElement | null;
    if (strokeSlider) {
        // dessin.js:170 — écrit .thickness sans discriminer le type (l'affichage
        // est conditionné juste après, pas la lecture) ; .thickness appartient
        // à OiShapeAnnotation, narrowing direct (pas d'élargissement).
        const withThickness = selection as OiShapeAnnotation;
        strokeSlider.value = String(withThickness.thickness || 5);
        const parent = strokeSlider.parentElement;
        if (parent) parent.style.display = selection.type === 'box' || selection.type === 'arrow' ? 'flex' : 'none';
    }

    // Taille de texte (text / member)
    const textSizeControl = document.getElementById('text_size_control');
    if (textSizeControl) {
        const isText = selection.type === 'text' || selection.type === 'member';
        textSizeControl.style.display = isText ? 'flex' : 'none';
        if (isText) {
            const textSizeSlider = document.getElementById('text_size_edit') as HTMLInputElement | null;
            // dessin.js:182 — `isText` re-teste `selection.type` : narrowing non
            // propagé via la variable booléenne intermédiaire (fidèle à
            // l'original), cast direct vers OiPointAnnotation ici.
            if (textSizeSlider) textSizeSlider.value = String((selection as OiPointAnnotation).size || 30);
        }
    }

    // Réglages de zone (location)
    const zoneSettings = document.getElementById('zone_settings');
    if (zoneSettings) {
        zoneSettings.style.display = selection.type === 'location' ? 'flex' : 'none';
        if (selection.type === 'location') {
            const co = document.getElementById('circle_opacity') as HTMLInputElement | null;
            if (co) co.value = String(fillOpacity(selection.opacity));
        }
    }
}

function persistAnnotationsToPreview(): void {
    const modal = oiState.annotationModal;
    if (!modal || !modal.dataset.targetPreviewId) return;
    const previewEl = document.getElementById(modal.dataset.targetPreviewId);
    if (!previewEl) return;
    previewEl.dataset.annotations = JSON.stringify(annotationHost.annotations);
    annotationHost.save();
}

function updateStrokeWidth(val: string): void {
    const selected = oiState.selectedAnnotation;
    if (selected) {
        // dessin.js:207-209 — écrit .thickness sans discriminer le type ;
        // .thickness appartient à OiShapeAnnotation, narrowing direct.
        const sel = selected as OiShapeAnnotation;
        sel.thickness = parseInt(val, 10);
        redrawCanvas();
        // dessin.js:211 — l'original lit `annotationModal.dataset.targetPreviewId`
        // sans garde (modale assumée déjà résolue) ; `!` interdit ⇒ capture +
        // garde, jamais pris en défaut en pratique.
        const targetId = oiState.annotationModal?.dataset.targetPreviewId;
        if (targetId) {
            const previewEl = document.getElementById(targetId);
            if (previewEl) previewEl.dataset.annotations = JSON.stringify(annotationHost.annotations);
        }
        annotationHost.save();
    }
}

function updateTextSize(val: string): void {
    const selected = oiState.selectedAnnotation;
    if (selected && (selected.type === 'text' || selected.type === 'member')) {
        selected.size = parseInt(val, 10);
        redrawCanvas();
        const targetId = oiState.annotationModal?.dataset.targetPreviewId;
        if (targetId) {
            const previewEl = document.getElementById(targetId);
            if (previewEl) previewEl.dataset.annotations = JSON.stringify(annotationHost.annotations);
        }
        annotationHost.save();
    }
}

function updateZoneText(val: string): void {
    const selected = oiState.selectedAnnotation;
    if (selected && selected.type === 'location') {
        selected.text = val;
        redrawCanvas();
        const targetId = oiState.annotationModal?.dataset.targetPreviewId;
        if (targetId) {
            const previewEl = document.getElementById(targetId);
            if (previewEl) previewEl.dataset.annotations = JSON.stringify(annotationHost.annotations);
        }
        annotationHost.save();
    }
}

function updateZoneOpacity(val: string): void {
    const selected = oiState.selectedAnnotation;
    if (selected && selected.type === 'location') {
        selected.opacity = fillOpacity(val);
        redrawCanvas();
        const targetId = oiState.annotationModal?.dataset.targetPreviewId;
        if (targetId) {
            const previewEl = document.getElementById(targetId);
            if (previewEl) previewEl.dataset.annotations = JSON.stringify(annotationHost.annotations);
        }
        annotationHost.save();
    }
}

function updateAnnotationRotation(): void {
    const selected = oiState.selectedAnnotation;
    if (selected) {
        const rotationInput = document.getElementById('rotation_input') as HTMLInputElement | null;
        // dessin.js:245-246 — l'original lit `rotationInput.value` sans garde
        // (élément statique de la modale) ; `!` interdit ⇒ capture + repli 0,
        // jamais pris en défaut en pratique.
        const degrees = rotationInput ? parseFloat(rotationInput.value) || 0 : 0;
        selected.rotation = (degrees * Math.PI) / 180;
        redrawCanvas();
        // CONFORMITÉ: Sauvegarde après rotation
        const targetId = oiState.annotationModal?.dataset.targetPreviewId;
        if (targetId) {
            const previewEl = document.getElementById(targetId);
            if (previewEl) previewEl.dataset.annotations = JSON.stringify(annotationHost.annotations);
        }
        annotationHost.save();
    }
}
window.updateAnnotationRotation = updateAnnotationRotation; // dessin.js:254

function setActiveTool(toolId: OiAnnotationTool): void {
    oiState.currentTool = toolId;
    document.querySelectorAll('.tool-btn.active, .tool-controls.active').forEach((el) => el.classList.remove('active'));
    const toolButton = document.getElementById(`tool_${toolId}`);
    if (toolButton) toolButton.classList.add('active');
    const toolControls = document.getElementById(`controls_${toolId}`);
    if (toolControls) toolControls.classList.add('active');

    // Gestion du curseur et du touch-action
    const canvas = oiState.canvas;
    // dessin.js:265-271 — l'original écrit `canvas.style...` sans garde
    // (canvas assumé déjà résolu) ; `!` interdit ⇒ capture + garde.
    if (canvas) {
        canvas.style.cursor = toolId === 'move' ? 'grab' : 'crosshair';

        // Sur mobile, l'outil 'move' autorise le zoom/pan natif
        if (window.innerWidth <= 768) {
            canvas.style.touchAction = toolId === 'move' ? 'manipulation' : 'none';
        } else {
            canvas.style.touchAction = 'none';
        }
    }

    oiState.selectedAnnotation = null;
    setContextualTools(null);

    const activeToolDisplay = document.getElementById('active_tool_display');
    if (activeToolDisplay) activeToolDisplay.innerText = 'Outil: ' + (toolId === 'move' ? 'Déplacer' : toolId);
}

function setAnnotationColor(color: string, element: HTMLElement): void {
    oiState.currentAnnotationColor = color;
    document.querySelectorAll('.color-circle').forEach((el) => {
        el.classList.remove('active');
        el.setAttribute('aria-pressed', 'false');
    });
    if (element) {
        element.classList.add('active');
        element.setAttribute('aria-pressed', 'true');
    }
    const selected = oiState.selectedAnnotation;
    if (selected && selected.color !== color) {
        pushAnnotationHistory();
        selected.color = color; // Appliquer la couleur à la sélection
        redrawCanvas();
        persistAnnotationsToPreview();
    }
}

async function openAnnotationModal(previewImgId: string): Promise<void> {
    // Robust initialization — dessin.js:294-297
    if (!oiState.canvas) oiState.canvas = document.getElementById('annotationCanvas') as HTMLCanvasElement | null;
    if (!oiState.ctx && oiState.canvas) oiState.ctx = oiState.canvas.getContext('2d');
    if (!oiState.annotationModal) oiState.annotationModal = document.getElementById('annotationModal') as HTMLDialogElement | null;

    const previewImg = document.getElementById(previewImgId) as HTMLImageElement | null;
    if (!previewImg) return;

    let objectURL = annotationHost.objectUrlsCache[previewImgId];
    const modal = oiState.annotationModal;
    // dessin.js:303 — l'original écrit `annotationModal.dataset...` sans garde
    // (assume la modale déjà résolue par la ligne 297, élément statique de
    // 4.html) ; `!` interdit ⇒ retour anticipé, jamais pris en défaut.
    if (!modal) return;
    modal.dataset.targetPreviewId = previewImgId;

    if (!objectURL) {
        // Fallback: Essayer de récupérer l'URL depuis l'élément img s'il s'agit d'un blob existant
        if (previewImg.src && previewImg.src.startsWith('blob:')) {
            objectURL = previewImg.src;
            annotationHost.objectUrlsCache[previewImgId] = objectURL;
        } else {
            // Tenter de recharger le blob depuis la DB
            try {
                const imageBlob = await annotationHost.getImage(previewImgId);
                if (imageBlob) {
                    objectURL = URL.createObjectURL(imageBlob);
                    annotationHost.objectUrlsCache[previewImgId] = objectURL;
                    previewImg.src = objectURL;
                } else {
                    toast("Impossible de charger l'image pour l'annotation. Données non trouvées.", { kind: 'error' });
                    return;
                }
            } catch (e) {
                console.error('Erreur DB:', e);
                toast("Erreur lors de la récupération de l'image.", { kind: 'error' });
                return;
            }
        }
    }

    // Reset baseImage to ensure onload fires every time
    oiState.baseImage = new Image();

    oiState.baseImage.onload = () => {
        console.log('Image d\'annotation chargée (onload):', oiState.baseImage.naturalWidth, 'x', oiState.baseImage.naturalHeight);

        // Rafraîchir les références DOM pour éviter les éléments détachés
        oiState.canvas = document.getElementById('annotationCanvas') as HTMLCanvasElement | null;
        const canvas = oiState.canvas;
        // dessin.js:337-338 — élément statique de 4.html, jamais nul en
        // pratique ; `!` interdit ⇒ retour anticipé.
        if (!canvas) return;
        oiState.ctx = canvas.getContext('2d');

        // AFFICHER LA MODALE D'ABORD (Sinon drawImage peut échouer sur un canevas masqué sur PC)
        if (!modal.open) {
            document.body.classList.add('modal-open');
            modal.showModal();
        }

        // Fermer les accordéons sur mobile par défaut
        if (window.innerWidth <= 767) {
            document.querySelectorAll('.mobile-accordion').forEach((details) => {
                details.removeAttribute('open');
            });
        }

        // Attendre que le navigateur ait calculé le layout de la modale montrée
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                console.log('Layout modale prêt, initialisation canevas. offsetWidth:', canvas.offsetWidth);

                // Fixer dimensions du buffer de dessin
                canvas.width = oiState.baseImage.naturalWidth;
                canvas.height = oiState.baseImage.naturalHeight;

                try {
                    const rawAnnotations = previewImg.dataset.annotations;
                    annotationHost.annotations = rawAnnotations ? (JSON.parse(rawAnnotations) as OiAnnotation[]) : [];
                } catch (e) {
                    console.error('Erreur parsing annotations:', e);
                    annotationHost.annotations = [];
                }
                annotationHost.annotations.forEach((a) => {
                    if (!a.color) a.color = '#c0392b';
                });
                openedAnnotations = JSON.stringify(annotationHost.annotations);

                // Nouvelle session d'édition : on repart d'un historique vierge.
                resetAnnotationHistory();

                // GESTION AFFICHAGE INITIAL (RESET ZOOM / FIT)
                resetZoom();

                modal.dataset.targetPreviewId = previewImgId;

                // Sécurité : Ré-initialiser l'espace de travail si nécessaire
                if (typeof initAnnotationWorkspace === 'function') {
                    initAnnotationWorkspace();
                }
            });
        });
    };

    oiState.baseImage.onerror = async (e) => {
        console.warn('Erreur de chargement baseImage, tentative de regénération du blob...', e);
        // Si l'URL a expiré ou a été révoquée, on tente de la recréer
        try {
            const imageBlob = await annotationHost.getImage(previewImgId);
            if (imageBlob) {
                const newUrl = URL.createObjectURL(imageBlob);
                annotationHost.objectUrlsCache[previewImgId] = newUrl;
                previewImg.src = newUrl;
                oiState.baseImage.src = newUrl; // Ré-essayer
            } else {
                toast("Impossible de charger l'image. Données corrompues.", { kind: 'error' });
            }
        } catch (err) {
            console.error('Échec définitif du chargement image:', err);
            toast("Erreur critique de chargement d'image.", { kind: 'error' });
        }
    };

    oiState.baseImage.src = objectURL;
}

/**
 * Calcule et applique le zoom 'Fit' pour que l'image soit entièrement visible
 */
function resetZoom(): void {
    const canvas = oiState.canvas;
    const baseImage = oiState.baseImage;
    if (!canvas || !baseImage) return;

    const container = document.querySelector('.annotation-canvas-container');
    if (!container) return;

    // Dimensions disponibles
    const availableW = container.clientWidth - 40; // padding
    const availableH = container.clientHeight - 40;

    // Calcul du scale pour fitter
    const scaleW = availableW / baseImage.naturalWidth;
    const scaleH = availableH / baseImage.naturalHeight;
    const fitScale = Math.min(scaleW, scaleH, 1.0); // Pas plus de 100% par défaut

    currentAnnotationZoom = fitScale;
    applyCanvasTransform();

    // S'assurer que les dimensions de rendu CSS correspondent à l'image
    canvas.style.width = baseImage.naturalWidth + 'px';
    canvas.style.height = baseImage.naturalHeight + 'px';

    setActiveTool('move');
    redrawCanvas();
}

function changeZoom(delta: number): void {
    currentAnnotationZoom = Math.max(0.1, Math.min(5, currentAnnotationZoom + delta));
    applyCanvasTransform();
}

function applyCanvasTransform(): void {
    const canvas = oiState.canvas;
    if (canvas) {
        canvas.style.transform = `scale(${currentAnnotationZoom})`;
    }
}

window.changeZoom = changeZoom;
window.resetZoom = resetZoom;

function redrawCanvas(): void {
    const ctx = oiState.ctx;
    const canvas = oiState.canvas;
    if (!ctx || !canvas) return;
    const baseImage = oiState.baseImage;
    if (!baseImage || !baseImage.complete || baseImage.naturalWidth === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    annotationHost.annotations.forEach((a) => drawAnnotation(withBounds(a)));
    const currentAnnotation = oiState.currentAnnotation;
    if (oiState.isDrawing && currentAnnotation) {
        drawAnnotation(withBounds(currentAnnotation));
    }
    const selectedAnnotation = oiState.selectedAnnotation;
    if (selectedAnnotation) {
        drawSelectionBorder(withBounds(selectedAnnotation));
    }
}

function drawSelectionBorder(annotation: OiAnnotationWithBounds): void {
    const ctx = oiState.ctx;
    // dessin.js:467 — ctx toujours non-null ici en pratique (seul appelant :
    // redrawCanvas, qui garde déjà) ; `!` interdit ⇒ retour anticipé.
    if (!ctx) return;
    const bb = getSelectionBBox(annotation);
    const angle = annotation.rotation || 0;
    // Tailles constantes à l'écran : on divise par le zoom courant du canvas.
    const z = currentAnnotationZoom || 1;
    const lw = 2 / z;
    const hr = 9 / z; // demi-côté / rayon des poignées
    const rotOffset = 34 / z;

    ctx.save();
    if (angle) {
        ctx.translate(bb.centerX, bb.centerY);
        ctx.rotate(angle);
        ctx.translate(-bb.centerX, -bb.centerY);
    }

    // Cadre pointillé
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.strokeRect(bb.x, bb.y, bb.width, bb.height);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // Tige + poignée de rotation (au-dessus du cadre)
    const rotX = bb.centerX;
    const rotY = bb.y - rotOffset;
    ctx.beginPath();
    ctx.moveTo(bb.centerX, bb.y);
    ctx.lineTo(rotX, rotY);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rotX, rotY, hr, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Poignée de redimensionnement (coin bas-droit)
    const rsX = bb.x + bb.width;
    const rsY = bb.y + bb.height;
    ctx.beginPath();
    ctx.rect(rsX - hr, rsY - hr, hr * 2, hr * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lw;
    ctx.stroke();

    ctx.restore();
}

function drawAnnotation(annotation: OiAnnotationWithBounds): void {
    const ctx = oiState.ctx;
    // dessin.js:522 — ctx toujours non-null ici en pratique (seul appelant :
    // redrawCanvas, qui garde déjà) ; `!` interdit ⇒ retour anticipé.
    if (!ctx) return;
    ctx.save();
    // Utilisation de la couleur stockée ou rouge par défaut
    const color = annotation.color || '#c0392b';

    let centerX = 0;
    let centerY = 0;
    if (annotation.type === 'location' || annotation.type === 'text' || annotation.type === 'member') {
        centerX = annotation.x;
        centerY = annotation.y;
    } else if (annotation.type === 'box') {
        centerX = annotation.x + annotation.width / 2;
        centerY = annotation.y + annotation.height / 2;
    } else if (annotation.type === 'arrow') {
        centerX = (annotation.startX + annotation.endX) / 2;
        centerY = (annotation.startY + annotation.endY) / 2;
    }

    if (annotation.rotation) {
        ctx.translate(centerX, centerY);
        ctx.rotate(annotation.rotation);
        ctx.translate(-centerX, -centerY);
    }

    switch (annotation.type) {
        case 'location': {
            const radius = annotation.radius || 0;
            if (radius < 2) {
                ctx.restore();
                return;
            }
            ctx.beginPath();
            ctx.arc(annotation.x, annotation.y, radius, 0, 2 * Math.PI);
            const rgb = hexToRgb(color) || { r: 91, g: 155, b: 213 };
            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${fillOpacity(annotation.opacity)})`;
            ctx.fill();
            ctx.strokeStyle = color; // Couleur personnalisée pour le bord
            ctx.lineWidth = 3;
            ctx.stroke();
            if (annotation.text) {
                ctx.fillStyle = 'black';
                ctx.font = `bold ${Math.max(12, radius / 2)}px Oswald, Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'black';
                ctx.fillText(annotation.text, annotation.x, annotation.y);
            }
            break;
        }
        case 'arrow': {
            drawArrow(annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.thickness || 5, color);
            break;
        }
        case 'box': {
            ctx.strokeStyle = color;
            ctx.lineWidth = annotation.thickness || 5;
            ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
            break;
        }
        case 'text': {
            const size = annotation.size || 30;
            ctx.font = `bold ${size}px Oswald, Arial, sans-serif`;
            ctx.fillStyle = color;
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.strokeText(annotation.text, annotation.x, annotation.y);
            ctx.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
        case 'member': {
            const size = annotation.size || 30;
            ctx.font = `bold ${size}px Oswald, Arial, sans-serif`;
            const paddingX = size * 0.8;
            const paddingY = size * 0.4;
            const textWidth = ctx.measureText(annotation.text).width;
            const boxW = textWidth + paddingX * 2;
            const boxH = size + paddingY * 2;

            const rectX = annotation.x - boxW / 2;
            const rectY = annotation.y - boxH / 2;
            const radius = boxH / 3;

            ctx.beginPath();
            ctx.moveTo(rectX + radius, rectY);
            ctx.lineTo(rectX + boxW - radius, rectY);
            ctx.quadraticCurveTo(rectX + boxW, rectY, rectX + boxW, rectY + radius);
            ctx.lineTo(rectX + boxW, rectY + boxH - radius);
            ctx.quadraticCurveTo(rectX + boxW, rectY + boxH, rectX + boxW - radius, rectY + boxH);
            ctx.lineTo(rectX + radius, rectY + boxH);
            ctx.quadraticCurveTo(rectX, rectY + boxH, rectX, rectY + boxH - radius);
            ctx.lineTo(rectX, rectY + radius);
            ctx.quadraticCurveTo(rectX, rectY, rectX + radius, rectY);
            ctx.closePath();

            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = Math.max(2, size / 15);
            ctx.stroke();

            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
    }
    ctx.restore();
}

function drawArrow(fromx: number, fromy: number, tox: number, toy: number, lineWidth: number, color: string): void {
    if (fromx === tox && fromy === toy) return;

    const ctx = oiState.ctx;
    // dessin.js:628 — jamais nul ici en pratique (seul appelant : drawAnnotation,
    // déjà gardé) ; `!` interdit ⇒ retour anticipé.
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;

    const dx = tox - fromx;
    const dy = toy - fromy;
    const angle = Math.atan2(dy, dx);
    const headlen = Math.max(lineWidth * 3, 10);
    const arrowLength = Math.sqrt(dx * dx + dy * dy);

    const lineToX = tox - headlen * 0.7 * Math.cos(angle);
    const lineToY = toy - headlen * 0.7 * Math.sin(angle);

    if (arrowLength < headlen * 1.5) {
        ctx.beginPath();
        ctx.moveTo(fromx, fromy);
        ctx.lineTo(tox, toy);
        ctx.stroke();
        return;
    }

    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.lineTo(lineToX, lineToY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7), toy - headlen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 7), toy - headlen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
}

function handleDrawStart(e: MouseEvent | TouchEvent): void {
    // Multi-touch sur mobile : on laisse le navigateur gérer le zoom natif
    if ('touches' in e && e.touches.length > 1) {
        cancelLongPress();
        return;
    }

    const canvas = oiState.canvas;
    // dessin.js:672 — canvas toujours résolu ici en pratique (écouteur posé
    // sur canvas lui-même par initAnnotationWorkspace) ; `!` interdit.
    if (!canvas) return;
    const pos = getEventPos(canvas, e);
    oiState.startX = pos.x;
    oiState.startY = pos.y;

    // --- Poignées de manipulation directe (resize / rotation) — Lot B2 ---
    // Prioritaire sur tout le reste : si une annotation est sélectionnée et qu'on
    // saisit une de ses poignées, on entre en mode redimensionnement ou rotation.
    const selectedAnnotation = oiState.selectedAnnotation;
    if (selectedAnnotation) {
        const sel = withBounds(selectedAnnotation);
        const bb = getSelectionBBox(sel);
        const angle = selectedAnnotation.rotation || 0;
        const u = getRotatedPoint(pos.x, pos.y, bb.centerX, bb.centerY, angle);
        const handle = hitSelectionHandle(sel, u.x, u.y);
        if (handle) {
            e.preventDefault();
            cancelLongPress();
            gestureSnapshot = JSON.stringify(annotationHost.annotations);
            if (handle === 'resize') {
                isResizing = true;
                // dessin.js:694-700 — box0/arrow0 lisent des champs
                // potentiellement absents du type réel de la sélection (ex.
                // .width sur un 'text' : `undefined` à l'exécution, jamais
                // consulté hors de sa branche propre par handleDrawMove).
                // Écart de contrat, cf. en-tête de fichier.
                const wide = selectedAnnotation as unknown as OiShapeAnnotationWithBounds;
                gestureStart = {
                    cx: bb.centerX,
                    cy: bb.centerY,
                    dist0: Math.hypot(u.x - bb.centerX, u.y - bb.centerY) || 1,
                    metric0: getAnnotationMetric(sel),
                    box0: { width: wide.width, height: wide.height },
                    arrow0: { startX: wide.startX, startY: wide.startY, endX: wide.endX, endY: wide.endY },
                };
            } else {
                isRotating = true;
                gestureStart = { cx: bb.centerX, cy: bb.centerY };
            }
            lockScroll();
            return;
        }
    }

    // Détection d'appui long pour éditer une annotation existante (comportement d'app de retouche)
    if ('touches' in e && e.touches.length === 1) {
        const hit = getAnnotationAtPosition(pos.x, pos.y);
        if (hit) {
            longPressTimer = setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate(50);
                setActiveTool('move');
                oiState.selectedAnnotation = hit;
                oiState.isMovingAnnotation = true;
                gestureSnapshot = JSON.stringify(annotationHost.annotations);
                setContextualTools(oiState.selectedAnnotation);
                redrawCanvas();
            }, LONG_PRESS_DURATION);
        }
    }

    const tool = oiState.currentTool;
    if (tool === 'move') {
        e.preventDefault();
        oiState.selectedAnnotation = getAnnotationAtPosition(pos.x, pos.y);
        setContextualTools(oiState.selectedAnnotation);
        if (oiState.selectedAnnotation) {
            oiState.isMovingAnnotation = true;
            gestureSnapshot = JSON.stringify(annotationHost.annotations);
            lockScroll();
            redrawCanvas();
        }
    } else if (tool === 'text') {
        e.preventDefault();
        // U25 — `prompt()` natif → `promptDialog` ; le handler reste synchrone,
        // l'insertion se fait à la résolution (rien après n'en dépend).
        void promptDialog({ message: 'Texte à insérer :' }).then((text) => {
            if (text) {
                const sizeInput = document.getElementById('text_size_tool') as HTMLInputElement | null;
                const size = sizeInput ? parseInt(sizeInput.value, 10) : 30;
                pushAnnotationHistory();
                annotationHost.annotations.push({
                    id: Date.now() + Math.random(),
                    type: 'text',
                    x: oiState.startX,
                    y: oiState.startY,
                    text: text,
                    color: oiState.currentAnnotationColor,
                    rotation: 0,
                    size: size,
                });
                redrawCanvas();
            }
        });
    } else if (tool === 'member') {
        e.preventDefault();
        window.populateMemberCanvasModal(oiState.startX, oiState.startY);
    } else {
        oiState.isDrawing = true;
        oiState.selectedAnnotation = null;
        setContextualTools(null);
        oiState.currentAnnotation = {
            id: Date.now() + Math.random(),
            type: tool,
            startX: oiState.startX,
            startY: oiState.startY,
            endX: oiState.startX,
            endY: oiState.startY,
            rotation: 0,
            color: oiState.currentAnnotationColor, // Store color
        };
    }
}

function handleDrawMove(e: MouseEvent | TouchEvent): void {
    if ('touches' in e && e.touches.length > 1) return; // Zoom natif en cours

    const canvas = oiState.canvas;
    // cf. handleDrawStart:672 — même garde.
    if (!canvas) return;
    const pos = getEventPos(canvas, e);

    // Si on bouge trop, on annule l'appui long
    if (longPressTimer && (Math.abs(pos.x - oiState.startX) > 10 || Math.abs(pos.y - oiState.startY) > 10)) {
        cancelLongPress();
    }

    // --- Redimensionnement uniforme via la poignée (Lot B2) ---
    const selectedAnnotation = oiState.selectedAnnotation;
    if (isResizing && selectedAnnotation && gestureStart && 'dist0' in gestureStart) {
        e.preventDefault();
        const a = withBounds(selectedAnnotation);
        const angle = a.rotation || 0;
        const u = getRotatedPoint(pos.x, pos.y, gestureStart.cx, gestureStart.cy, angle);
        let scale = Math.hypot(u.x - gestureStart.cx, u.y - gestureStart.cy) / gestureStart.dist0;
        if (!isFinite(scale) || scale <= 0) scale = 0.01;
        if (a.type === 'box') {
            a.width = Math.max(5, gestureStart.box0.width * scale);
            a.height = Math.max(5, gestureStart.box0.height * scale);
            a.x = gestureStart.cx - a.width / 2;
            a.y = gestureStart.cy - a.height / 2;
        } else if (a.type === 'location') {
            a.radius = Math.max(3, gestureStart.metric0 * scale);
        } else if (a.type === 'arrow') {
            const g = gestureStart.arrow0;
            a.startX = gestureStart.cx + (g.startX - gestureStart.cx) * scale;
            a.startY = gestureStart.cy + (g.startY - gestureStart.cy) * scale;
            a.endX = gestureStart.cx + (g.endX - gestureStart.cx) * scale;
            a.endY = gestureStart.cy + (g.endY - gestureStart.cy) * scale;
        } else {
            // text / member — dessin.js:807-808 — même limite de narrowing que
            // getSelectionBBox (cf. son commentaire) ; cast direct vers
            // OiPointAnnotation pour l'écriture (même référence sous-jacente).
            (a as OiPointAnnotation).size = Math.max(8, Math.min(400, gestureStart.metric0 * scale));
        }
        redrawCanvas();
        return;
    }

    // --- Rotation via la poignée (Lot B2) ---
    if (isRotating && selectedAnnotation && gestureStart) {
        e.preventDefault();
        selectedAnnotation.rotation = Math.atan2(pos.y - gestureStart.cy, pos.x - gestureStart.cx) + Math.PI / 2;
        redrawCanvas();
        return;
    }

    if (!oiState.isDrawing && !oiState.isMovingAnnotation) return;

    // On bloque le scroll natif SEULEMENT si on est en train de dessiner ou bouger une annotation
    e.preventDefault();

    if (oiState.isMovingAnnotation && selectedAnnotation) {
        const deltaX = pos.x - oiState.startX;
        const deltaY = pos.y - oiState.startY;

        const sel = withBounds(selectedAnnotation);
        if (sel.type === 'arrow') {
            sel.startX += deltaX;
            sel.startY += deltaY;
            sel.endX += deltaX;
            sel.endY += deltaY;
        } else {
            // Pour box, location et text
            sel.x += deltaX;
            sel.y += deltaY;
        }

        oiState.startX = pos.x;
        oiState.startY = pos.y;
        redrawCanvas();
    } else if (oiState.isDrawing && oiState.currentAnnotation) {
        // dessin.js:847 — currentAnnotation est toujours une forme ici (créée
        // par la branche 'else' de handleDrawStart), jamais 'text'/'member' ;
        // narrowing direct (endX/endY appartiennent à OiShapeAnnotation, pas
        // d'élargissement de contrat nécessaire ici).
        const draft = oiState.currentAnnotation as OiShapeAnnotation;
        draft.endX = pos.x;
        draft.endY = pos.y;
        redrawCanvas();
    }
}

/**
 * Verrou de défilement le temps d'un geste. La valeur d'avant revient à la
 * fin : un hôte peut déjà bloquer la page (visionneuse du PC-Tac), et la
 * souris qui sort de la toile sans geste ne touche à rien.
 */
let overflowBeforeGesture: string | null = null;
function lockScroll(): void {
    if (overflowBeforeGesture === null) overflowBeforeGesture = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
}
function unlockScroll(): void {
    if (overflowBeforeGesture === null) return;
    document.body.style.overflow = overflowBeforeGesture;
    overflowBeforeGesture = null;
}

function handleDrawEnd(e: MouseEvent | TouchEvent): void {
    cancelLongPress();
    if ('touches' in e && e.touches.length > 0) return; // Toujours un doigt posé

    unlockScroll();

    // Fin d'un geste de redimensionnement / rotation via poignée
    if (isResizing || isRotating) {
        isResizing = false;
        isRotating = false;
        gestureStart = null;
        commitAnnotationHistory(gestureSnapshot);
        gestureSnapshot = null;
        setContextualTools(oiState.selectedAnnotation);
        const targetId = oiState.annotationModal?.dataset.targetPreviewId;
        const targetPreview = targetId ? document.getElementById(targetId) : null;
        if (targetPreview) targetPreview.dataset.annotations = JSON.stringify(annotationHost.annotations);
        annotationHost.save();
        redrawCanvas();
        return;
    }

    if (oiState.isMovingAnnotation) {
        oiState.isMovingAnnotation = false;
        // Historique : on valide le snapshot pris au début du déplacement.
        commitAnnotationHistory(gestureSnapshot);
        gestureSnapshot = null;
        // CONFORMITÉ: Sauvegarde après déplacement/modification d'une annotation
        const targetId = oiState.annotationModal?.dataset.targetPreviewId;
        const targetPreview = targetId ? document.getElementById(targetId) : null;
        if (targetPreview) targetPreview.dataset.annotations = JSON.stringify(annotationHost.annotations);
        annotationHost.save();
        redrawCanvas();
    } else if (oiState.isDrawing) {
        oiState.isDrawing = false;
        const currentDraft = oiState.currentAnnotation;
        if (!currentDraft) return;

        // dessin.js:891 — currentAnnotation est toujours une forme ici (créée
        // par la branche 'else' de handleDrawStart) ; élargissement x/y/radius/
        // width/height nécessaire pour les écritures ci-dessous, cf. écart de
        // contrat en tête de fichier.
        const final: OiShapeAnnotationWithBounds = { ...(currentDraft as unknown as OiShapeAnnotationWithBounds) };
        const strokeWidthInput = document.getElementById('stroke_width_edit') as HTMLInputElement | null;
        const thickness = strokeWidthInput ? parseInt(strokeWidthInput.value, 10) : 5;

        if (final.type === 'box') {
            // Normaliser les coordonnées pour la boîte
            final.x = Math.min(final.startX, final.endX);
            final.y = Math.min(final.startY, final.endY);
            final.width = Math.abs(final.startX - final.endX);
            final.height = Math.abs(final.startY - final.endY);
            final.thickness = thickness;
            if (final.width < 5 || final.height < 5) return;
        } else if (final.type === 'arrow') {
            final.thickness = thickness;
            if (Math.abs(final.startX - final.endX) < 5 && Math.abs(final.startY - final.endY) < 5) return;
        } else if (final.type === 'location') {
            final.x = final.startX;
            final.y = final.startY;
            final.radius = Math.sqrt(Math.pow(final.endX - final.startX, 2) + Math.pow(final.endY - final.startY, 2));
            final.text = oiState.zoneText;
            const circleOpacityEl = document.getElementById('circle_opacity') as HTMLInputElement | null;
            // Nombre dans [0, 1], 0 compris (audit du 26/09 ; l'original
            // stockait la chaîne du curseur, dessin.js:911).
            final.opacity = fillOpacity(circleOpacityEl?.value);
            final.color = oiState.currentAnnotationColor;
            if (final.radius < 5) return;
        }

        // Historique : on empile l'état AVANT l'ajout (après les retours anticipés
        // pour ne pas créer d'entrée pour un tracé trop petit, ignoré).
        pushAnnotationHistory();
        // dessin.js:919 — `final.type` ne vaut jamais 'text' ici (forme créée
        // par handleDrawStart) : garde de l'original conservée telle quelle
        // (code mort assumé) ; `as string` neutralise l'erreur TS de
        // comparaison de littéraux disjoints, comportement runtime inchangé.
        if ((final.type as string) !== 'text') annotationHost.annotations.push(final);

        oiState.currentAnnotation = null;
        oiState.selectedAnnotation = final;
        setContextualTools(oiState.selectedAnnotation);
        redrawCanvas();
        persistAnnotationsToPreview();
    }
}

/** Annotations à l'ouverture de la séance : « Annuler » y revient (décision 26). */
let openedAnnotations: string | null = null;
let confirmingCancel = false;

function discardAnnotationChanges(): void {
    if (openedAnnotations === null) return;
    annotationHost.annotations = JSON.parse(openedAnnotations) as OiAnnotation[];
    oiState.selectedAnnotation = null;
    persistAnnotationsToPreview();
}

/** Ferme la fenêtre en gardant les annotations en cours (Enregistrer). */
function hideAnnotationModal(): void {
    const modal = oiState.annotationModal;
    if (modal) {
        openedAnnotations = null;
        document.body.classList.remove('modal-open');
        if (typeof modal.close === 'function') modal.close();
        else modal.style.display = 'none';

        persistAnnotationsToPreview();
        // REMOVED: cleanupObjectUrls() - Trop agressif, révoque tout le cache UI.
    }
}

/**
 * Annuler, croix et Échap : rien de ce qui a été tracé depuis l'ouverture
 * n'est gardé. Une confirmation d'abord, s'il y a des tracés à perdre.
 */
async function closeAnnotationModal(): Promise<void> {
    // Annuler est câblé deux fois (délégation de la fenêtre et bouton) : une seule question.
    if (confirmingCancel) return;
    if (openedAnnotations !== null && JSON.stringify(annotationHost.annotations) !== openedAnnotations) {
        confirmingCancel = true;
        try {
            const discard = await confirmDialog({
                message: 'Abandonner les annotations non enregistrées ?',
                confirmLabel: 'Abandonner',
                cancelLabel: 'Continuer',
                danger: true,
            });
            if (!discard) return;
        } finally {
            confirmingCancel = false;
        }
        discardAnnotationChanges();
    }
    hideAnnotationModal();
}
// ÉCART NÉCESSAIRE (ESM vs script classique, RÈGLE D'OR §2.2) : dans
// dessin.js, `closeAnnotationModal` n'a JAMAIS de ligne explicite
// `window.closeAnnotationModal = …` — mais en script classique, TOUTE
// déclaration de fonction top-level est automatiquement une propriété de
// `window` (contrairement à un module ESM). C'est cette résolution implicite
// que consomme `4.html:3988,3991` (`onclick="closeAnnotationModal()"`,
// toujours en place en P3.B — cf. SPEC §12.4) et qu'exige le contrat
// `OiAnnotationGlobals` (contracts.ts). Sans cette ligne, `window.
// closeAnnotationModal` serait `undefined` en ESM alors qu'il existait de
// fait dans l'original : pose EXPLICITE requise pour l'iso-comportement,
// PAS un ajout de confort.
window.closeAnnotationModal = closeAnnotationModal;

function cancelLongPress(): void {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

export async function createAnnotatedImageBlob(imageBlob: Blob, annotationsData: OiAnnotation[]): Promise<Blob> {
    if (!imageBlob || !(imageBlob instanceof Blob) || imageBlob.size === 0) {
        console.warn('createAnnotatedImageBlob: Blob invalide ou manquant, contournement.');
        return imageBlob;
    }

    return new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        const objectURL = URL.createObjectURL(imageBlob);
        img.src = objectURL;

        img.onload = () => {
            URL.revokeObjectURL(objectURL);

            // On crée un canvas local pour éviter les race conditions lors de la génération parallèle
            const localCanvas = document.createElement('canvas');
            const localCtx = localCanvas.getContext('2d');
            // dessin.js:963 — l'original ne garde jamais `localCtx` nul (jamais
            // observé en pratique, même famille de garde que `compressImage`
            // côté `@oi/outils.js`) ; `!` interdit ⇒ rejet dédié, jamais pris en
            // défaut en pratique.
            if (!localCtx) {
                reject(new Error("Impossible d'obtenir le contexte 2D du canvas local."));
                return;
            }

            localCanvas.width = img.naturalWidth;
            localCanvas.height = img.naturalHeight;
            localCtx.clearRect(0, 0, localCanvas.width, localCanvas.height);
            localCtx.drawImage(img, 0, 0);

            // Appliquer chaque annotation sur le contexte local
            annotationsData.forEach((annotation) =>
                drawAnnotationOnContext(localCtx, localCanvas.width, localCanvas.height, withBounds(annotation)),
            );

            // Exportation en PNG pour conserver la qualité et la transparence des annotations
            localCanvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('La conversion du canevas en Blob a échoué.'));
                }
            }, 'image/png');
        };

        img.onerror = (e) => {
            console.error('createAnnotatedImageBlob: Erreur de chargement d\'image pour annotation', e);
            URL.revokeObjectURL(objectURL);
            // Retourne le blob original au lieu de rejeter pour éviter de bloquer tout le PDF
            resolve(imageBlob);
        };
    });
}

function drawAnnotationOnContext(
    context: CanvasRenderingContext2D,
    _canvasWidth: number,
    _canvasHeight: number,
    annotation: OiAnnotationWithBounds,
): void {
    // dessin.js:992 — `canvasWidth`/`canvasHeight` sont déjà inutilisés dans
    // l'original (aucune référence dans le corps de la fonction source) ;
    // `noUnusedParameters` impose le préfixe `_`, signature autrement
    // inchangée (fidélité).
    context.save();
    const color = annotation.color || '#c0392b';
    let centerX = 0;
    let centerY = 0;
    if (annotation.type === 'location' || annotation.type === 'text' || annotation.type === 'member') {
        centerX = annotation.x;
        centerY = annotation.y;
    } else if (annotation.type === 'box') {
        centerX = annotation.x + annotation.width / 2;
        centerY = annotation.y + annotation.height / 2;
    } else if (annotation.type === 'arrow') {
        centerX = (annotation.startX + annotation.endX) / 2;
        centerY = (annotation.startY + annotation.endY) / 2;
    }

    if (annotation.rotation) {
        context.translate(centerX, centerY);
        context.rotate(annotation.rotation);
        context.translate(-centerX, -centerY);
    }

    switch (annotation.type) {
        case 'location': {
            const radius = annotation.radius || 0;
            if (radius < 2) {
                context.restore();
                return;
            }
            context.beginPath();
            context.arc(annotation.x, annotation.y, radius, 0, 2 * Math.PI);
            const rgb = hexToRgb(color) || { r: 91, g: 155, b: 213 };
            context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${fillOpacity(annotation.opacity)})`;
            context.fill();
            context.strokeStyle = color;
            context.lineWidth = 3;
            context.stroke();
            if (annotation.text) {
                context.fillStyle = 'black';
                context.font = `bold ${Math.max(12, radius / 2)}px Oswald, Arial, sans-serif`;
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillText(annotation.text, annotation.x, annotation.y);
            }
            break;
        }
        case 'arrow': {
            const drawArrowLocal = (fromx: number, fromy: number, tox: number, toy: number, lineWidth: number) => {
                if (fromx === tox && fromy === toy) return;
                context.strokeStyle = color;
                context.fillStyle = color;
                context.lineWidth = lineWidth;
                const headlen = Math.max(lineWidth * 3, 10);
                const dx = tox - fromx;
                const dy = toy - fromy;
                const angle = Math.atan2(dy, dx);
                const lineToX = tox - headlen * 0.7 * Math.cos(angle);
                const lineToY = toy - headlen * 0.7 * Math.sin(angle);

                context.beginPath();
                context.moveTo(fromx, fromy);
                context.lineTo(lineToX, lineToY);
                context.stroke();
                context.beginPath();
                context.moveTo(tox, toy);
                context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7), toy - headlen * Math.sin(angle - Math.PI / 7));
                context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 7), toy - headlen * Math.sin(angle + Math.PI / 7));
                context.closePath();
                context.fill();
            };
            drawArrowLocal(annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.thickness || 5);
            break;
        }
        case 'box': {
            context.strokeStyle = color;
            context.lineWidth = annotation.thickness || 5;
            context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
            break;
        }
        case 'text': {
            const size = annotation.size || 30;
            context.font = `bold ${size}px Oswald, Arial, sans-serif`;
            context.fillStyle = color;
            context.strokeStyle = 'black';
            context.lineWidth = 2;
            context.strokeText(annotation.text, annotation.x, annotation.y);
            context.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
        case 'member': {
            const size = annotation.size || 30;
            context.font = `bold ${size}px Oswald, Arial, sans-serif`;
            const paddingX = size * 0.8;
            const paddingY = size * 0.4;
            const textWidth = context.measureText(annotation.text).width;
            const boxW = textWidth + paddingX * 2;
            const boxH = size + paddingY * 2;

            const rectX = annotation.x - boxW / 2;
            const rectY = annotation.y - boxH / 2;
            const radius = boxH / 3;

            context.beginPath();
            context.moveTo(rectX + radius, rectY);
            context.lineTo(rectX + boxW - radius, rectY);
            context.quadraticCurveTo(rectX + boxW, rectY, rectX + boxW, rectY + radius);
            context.lineTo(rectX + boxW, rectY + boxH - radius);
            context.quadraticCurveTo(rectX + boxW, rectY + boxH, rectX + boxW - radius, rectY + boxH);
            context.lineTo(rectX + radius, rectY + boxH);
            context.quadraticCurveTo(rectX, rectY + boxH, rectX, rectY + boxH - radius);
            context.lineTo(rectX, rectY + radius);
            context.quadraticCurveTo(rectX, rectY, rectX + radius, rectY);
            context.closePath();

            context.fillStyle = color;
            context.fill();
            context.strokeStyle = 'white';
            context.lineWidth = Math.max(2, size / 15);
            context.stroke();

            context.fillStyle = 'white';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(annotation.text, annotation.x, annotation.y);
            break;
        }
    }
    context.restore();
}

window.populateMemberCanvasModal = function (x: number, y: number): void {
    const listContainer = document.getElementById('member_canvas_list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const patracBtn = document.querySelectorAll<HTMLElement>('.patracdvr-member-btn');
    const validBtns = Array.from(patracBtn).filter((b) => b.dataset.trigramme && b.dataset.trigramme !== 'N/A');
    if (validBtns.length === 0) {
        listContainer.innerHTML = '<p style="color:var(--text-muted)">Aucun membre configuré.</p>';
    } else {
        validBtns.forEach((btn) => {
            const tri = btn.dataset.trigramme;
            // dessin.js:1114 — l'original ne re-vérifie pas ici (déjà filtré par
            // .filter() ci-dessus ; TS ne propage pas ce narrowing au callback
            // .forEach) ; jamais pris en défaut en pratique.
            if (!tri) return;
            const fonc = btn.dataset.fonction && btn.dataset.fonction !== 'Sans' ? ` - ${btn.dataset.fonction}` : '';
            const button = document.createElement('button');
            button.className = 'add-btn';
            button.style.background = 'var(--bg-container)';
            button.style.color = 'var(--text-primary)';
            button.style.border = '1px solid var(--border-color)';
            button.textContent = tri + fonc;
            button.onclick = () => {
                const modalCanvas = document.getElementById('memberSelectionModalCanvas') as HTMLDialogElement | null;
                // dessin.js:1123 — l'original appelle `.close()` sans garde
                // (élément statique de 4.html) ; `!` interdit ⇒ garde ajoutée.
                if (modalCanvas) modalCanvas.close();
                // Taille un peu plus petite par défaut pour les puces membres
                const sizeEl = document.getElementById('text_size_edit') as HTMLInputElement | null;
                const size = sizeEl ? parseInt(sizeEl.value, 10) : 20;
                pushAnnotationHistory();
                annotationHost.annotations.push({
                    id: Date.now() + Math.random(),
                    type: 'member',
                    x,
                    y,
                    text: tri,
                    color: oiState.currentAnnotationColor,
                    rotation: 0,
                    size,
                });
                redrawCanvas();
                annotationHost.syncDom(); // Optionnel : Déclencher manuellement saveFormData si nécessaire
                // Remettre l'outil sur deplacement
                setActiveTool('move');
            };
            listContainer.appendChild(button);
        });
    }
    const modalCanvas = document.getElementById('memberSelectionModalCanvas') as HTMLDialogElement | null;
    // dessin.js:1138 — même garde ajoutée qu'au-dessus (`.showModal()` sans
    // garde dans l'original).
    if (modalCanvas) modalCanvas.showModal();
};

// --- GLOBAL EXPOSURE ---
window.setActiveTool = setActiveTool;
window.updateStrokeWidth = updateStrokeWidth;
window.updateTextSize = updateTextSize;
window.updateZoneText = updateZoneText;
window.updateZoneOpacity = updateZoneOpacity;
window.updateAnnotationRotation = updateAnnotationRotation;
window.setAnnotationColor = setAnnotationColor;
window.openAnnotationModal = openAnnotationModal;

function toggleMobileDock(): void {
    const fab = document.getElementById('mobile-dock-fab');
    const panel = document.getElementById('annotation-toolbar-panel');
    const wrapper = document.querySelector('.annotation-wrapper');
    if (!fab || !panel || !wrapper) return;

    if (wrapper.classList.contains('show-triple-dock')) {
        wrapper.classList.remove('show-triple-dock');
        panel.classList.remove('expanded');
        fab.style.display = 'flex';
    } else {
        wrapper.classList.add('show-triple-dock');
        panel.classList.add('expanded');
        fab.style.display = 'none';
    }
    // Recadrage immédiat (lire les dimensions force la mise en page ; aucune
    // transition CSS sur ces classes). L'ancien minuteur de 50 ms survivait à
    // la fenêtre, et à jsdom en test : ReferenceError intermittente.
    resetZoom();
}
window.toggleMobileDock = toggleMobileDock;

/**
 * Ferme le bottom-sheet contextuel mobile : désélectionne l'annotation courante
 * et masque les réglages. Le sheet se referme via la classe .active de
 * #contextual_tools (cf. setContextualTools), pilotée par le CSS mobile.
 */
function closeMobileSheet(): void {
    oiState.selectedAnnotation = null;
    setContextualTools(null);
    if (typeof redrawCanvas === 'function') redrawCanvas();
}
window.closeMobileSheet = closeMobileSheet;

/**
 * Branche le canvas et la barre d'outils d'annotation (équivalent monolithique 4.html).
 * À appeler une fois le canvas initialisé (ex. après getElementById dans presentation.js).
 */
let annotationWorkspaceInitialized = false;
function initAnnotationWorkspace(): void {
    const canvas = oiState.canvas;
    const ctx = oiState.ctx;
    const modal = oiState.annotationModal;
    if (annotationWorkspaceInitialized || !canvas || !ctx || !modal) return;
    annotationWorkspaceInitialized = true;

    // Initialiser le workspace (le triple dock mobile est géré via CSS Grid et toggleMobileDock)

    // Enveloppe : une exception dans un handler canvas ne doit pas casser
    // silencieusement l'annotation (le filet global de 4.html journalise aussi).
    const safeAnnot =
        (fn: (ev: MouseEvent | TouchEvent) => void, label: string) =>
        (ev: MouseEvent | TouchEvent): void => {
            try {
                fn(ev);
            } catch (e) {
                console.error('[Annotation] ' + label + ' a échoué:', e);
            }
        };
    canvas.addEventListener('mousedown', safeAnnot(handleDrawStart, 'drawStart'));
    canvas.addEventListener('mousemove', safeAnnot(handleDrawMove, 'drawMove'));
    canvas.addEventListener('mouseup', safeAnnot(handleDrawEnd, 'drawEnd'));
    canvas.addEventListener('mouseout', safeAnnot(handleDrawEnd, 'drawEnd'));
    canvas.addEventListener('touchstart', safeAnnot(handleDrawStart, 'drawStart'), { passive: false });
    canvas.addEventListener('touchmove', safeAnnot(handleDrawMove, 'drawMove'), { passive: false });
    canvas.addEventListener('touchend', safeAnnot(handleDrawEnd, 'drawEnd'));

    const drawingTools = ['tool_move', 'tool_location', 'tool_arrow', 'tool_box', 'tool_text', 'tool_member'];
    drawingTools.forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', async () => {
                // dessin.js:1214 — les 6 ids de `drawingTools` sont figés ci-dessus :
                // le résultat de `.replace` correspond toujours à un `OiAnnotationTool`.
                const toolId = id.replace(/^tool_/, '') as OiAnnotationTool;
                setActiveTool(toolId);
                if (toolId === 'location') {
                    // U25 — `prompt()` natif → `promptDialog`. Le texte vit dans
                    // l'état (aucun champ `circle_text` dans la page) : sinon
                    // toute zone sortait « Zone ».
                    const txt = await promptDialog({ message: 'Texte personnalisé de la zone :', initial: oiState.zoneText });
                    if (txt !== null) oiState.zoneText = txt;
                }
            });
        }
    });

    const toolReset = document.getElementById('tool_reset');
    if (toolReset) {
        toolReset.addEventListener('click', () => {
            if (annotationHost.annotations.length) pushAnnotationHistory();
            annotationHost.annotations = [];
            oiState.selectedAnnotation = null;
            setContextualTools(null);
            redrawCanvas();
            const targetId = modal.dataset.targetPreviewId;
            if (targetId) {
                const previewImg = document.getElementById(targetId);
                if (previewImg) previewImg.dataset.annotations = JSON.stringify(annotationHost.annotations);
            }
            annotationHost.save();
        });
    }

    const annCancel = document.querySelectorAll('#annotation_cancel, #annotation_cancel_header');
    annCancel.forEach((btn) => btn.addEventListener('click', closeAnnotationModal));
    // Échap vaut Annuler. Chrome force la fermeture sur un Échap répété sans
    // autre geste : l'événement n'est alors pas annulable, le tracé est jeté
    // sans question, avant l'événement `close` que l'hôte écoute.
    modal.addEventListener('cancel', (e) => {
        if (e.cancelable) {
            e.preventDefault();
            void closeAnnotationModal();
            return;
        }
        discardAnnotationChanges();
        openedAnnotations = null;
        document.body.classList.remove('modal-open');
    });

    const annSave = document.querySelectorAll('#annotation_save, #annotation_save_header');
    annSave.forEach((btn) => {
        btn.addEventListener('click', async () => {
            const targetId = modal.dataset.targetPreviewId;
            const previewImg = targetId ? (document.getElementById(targetId) as HTMLImageElement | null) : null;
            if (previewImg) {
                // dessin.js:1250 — `previewImg` non-null implique `targetId`
                // non-vide (dérivé par le ternaire ci-dessus) ; TS ne relie pas
                // les deux variables, cast de narrowing direct pour l'indexation
                // de `objectUrlsCache` ci-dessous.
                const cachedKey = targetId as string;
                previewImg.dataset.annotations = JSON.stringify(annotationHost.annotations);
                if (annotationHost.renderPreview === false) {
                    // Décision 25 (PC-Tac) : image annotée rendue par l'hôte.
                } else if (annotationHost.annotations.length > 0) {
                    oiState.selectedAnnotation = null;
                    setContextualTools(null);
                    redrawCanvas();
                    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
                    if (blob) {
                        const newUrl = URL.createObjectURL(blob);
                        if (previewImg.src.startsWith('blob:') && previewImg.src !== annotationHost.objectUrlsCache[cachedKey]) {
                            URL.revokeObjectURL(previewImg.src);
                        }
                        previewImg.src = newUrl;
                    }
                } else {
                    const cachedUrl = annotationHost.objectUrlsCache[cachedKey];
                    if (cachedUrl) previewImg.src = cachedUrl;
                }
            }
            annotationHost.save();
            hideAnnotationModal();
        });
    });

    const rotInput = document.getElementById('rotation_input');
    if (rotInput) {
        rotInput.addEventListener('change', updateAnnotationRotation);
        rotInput.addEventListener('input', updateAnnotationRotation);
    }

    const delBtn = document.getElementById('delete_btn');
    if (delBtn) {
        delBtn.addEventListener('click', () => {
            const selected = oiState.selectedAnnotation;
            if (!selected) return;
            pushAnnotationHistory();
            // Support backward compatibility if old annotations don't have an ID
            if (selected.id) {
                annotationHost.annotations = annotationHost.annotations.filter((ann) => ann.id !== selected.id);
            } else {
                annotationHost.annotations = annotationHost.annotations.filter((ann) => ann !== selected);
            }
            oiState.selectedAnnotation = null;
            setContextualTools(null);
            redrawCanvas();
            persistAnnotationsToPreview();
        });
    }

    const editTextBtn = document.getElementById('edit_text_btn');
    if (editTextBtn) {
        editTextBtn.addEventListener('click', async () => {
            const selected = oiState.selectedAnnotation;
            if (!selected) return;
            if (selected.type !== 'location' && selected.type !== 'text' && selected.type !== 'member') {
                return;
            }
            const cur = selected.text != null ? String(selected.text) : '';
            // U25 — `prompt()` natif → `promptDialog`.
            const newText = await promptDialog({ message: 'Modifier texte :', initial: cur });
            if (newText !== null && newText !== cur) {
                pushAnnotationHistory();
                selected.text = newText;
                redrawCanvas();
                persistAnnotationsToPreview();
            }
        });
    }

    // Boutons Annuler / Rétablir (Lot B1)
    const undoBtn = document.getElementById('annotation_undo');
    if (undoBtn) undoBtn.addEventListener('click', undoAnnotation);
    const redoBtn = document.getElementById('annotation_redo');
    if (redoBtn) redoBtn.addEventListener('click', redoAnnotation);
    refreshAnnotationUndoRedo();

    // Raccourcis clavier Ctrl+Z / Ctrl+Y (uniquement quand la modale est ouverte)
    document.addEventListener('keydown', (e) => {
        if (!modal.open) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoAnnotation();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            redoAnnotation();
        }
    });

    const strokeSlider = document.getElementById('stroke_width_edit') as HTMLInputElement | null;
    if (strokeSlider) strokeSlider.addEventListener('input', (e) => updateStrokeWidth((e.target as HTMLInputElement).value));
    const textSizeEdit = document.getElementById('text_size_edit') as HTMLInputElement | null;
    if (textSizeEdit) textSizeEdit.addEventListener('input', (e) => updateTextSize((e.target as HTMLInputElement).value));

    const circleOpacity = document.getElementById('circle_opacity') as HTMLInputElement | null;
    if (circleOpacity) circleOpacity.addEventListener('input', (e) => updateZoneOpacity((e.target as HTMLInputElement).value));

    // Historique : snapshot avant / commit après pour les sliders contextuels
    bindHistorySlider(strokeSlider);
    bindHistorySlider(textSizeEdit);
    bindHistorySlider(circleOpacity);
    bindHistorySlider(document.getElementById('rotation_input_slider'));
}

window.initAnnotationWorkspace = initAnnotationWorkspace;
