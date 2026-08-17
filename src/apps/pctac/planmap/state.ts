/**
 * state.ts — État initial de `PlanMap` (P2.CONV, paquet `pm-core`).
 * ===========================================================================
 *
 * `createPlanMapState()` : les 28 propriétés du littéral (planMap.js:302-328,
 * valeurs littérales inchangées) + les 28 propriétés créées à l'exécution
 * (règle d'initialisation opposable, SPEC-PLANMAP-SPLIT.md §3.2) + les 2
 * constantes publiques AOI_MIN_Z/AOI_MAX_Z (planMap.js:5303-5304). Total 58.
 *
 * `SafeMethods` : la garde `_safe` (planMap.js:335), corps VERBATIM.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import { Persist } from '@shared/persist.js';
import { createLocalStorageAdapter } from '@shared/map-persistence.js';

import { PINS_KEY, SHAPES_KEY, VIEW_KEY } from './constants.js';
import type { PlanMapInternal, PlanMapState, PlanPin, PlanShape, PlanView } from './types.js';

// planMap.js:301-328
export function createPlanMapState(): PlanMapState {
    return {
        /* --- 28 propriétés du littéral (planMap.js:302-328) --- */
        map: null,
        _pinMarkers: null,  // id -> entry réconcilié (pinMarker/labelMarker/pinWrap/labelEl/sig/pin)
        pendingFreePin: null, // { label, color, kind } en attente d'un clic carte
        searchMarker: null,  // pointeur précis sur l'adresse cherchée
        initialized: false,
        drawTool: null, // 'line' | 'rectangle' | 'circle' | null
        drawColor: '#ef4444',
        drawState: null, // état temporaire pendant un tracé en cours
        drawPreviewLayerIds: ['plan-draw-preview-fill', 'plan-draw-preview-line'],
        history: [],     // pile d'états {shapes} avant chaque modif
        redoStack: [],   // états annulés réutilisables via redo
        is3D: false,     // mode relief 3D actif
        _pinCancel: null, // annule l'épinglage caméra 3D en cours (anti-dérive DEM)
        streetLabelsOn: false, // overlay noms de rues (vectoriel OpenFreeMap)
        lidarLayer: null,      // overlay LiDAR HD actif : 'mnt' | 'mns' | 'mnh' | null
        _selectedShapeId: null,  // forme actuellement sélectionnée (handles visibles)
        _handleMarkers: [],      // poignées HTML rendues pour la forme sélectionnée
        _textMarkers: [],        // labels HTML pour annotations texte
        _diameterMarkers: [],    // labels HTML pour diamètres de cercle
        _toolbarMarker: null,    // barre flottante (HTML marker) attachée à la forme
        _contextPopup: null,     // popup maplibre actuel (legacy, conservé pour compat)
        _gesture: null,          // état du geste en cours (tap/drag/resize/pinch)
        _diameterGlobal: true,   // toggle global : afficher diamètres (défaut ON)
        _drawingDiameterMarker: null,  // label live pendant le tracé d'un cercle
        _locked: false,          // verrou global : fige la position des pings ET dessins
        _measureState: null,     // état de la mesure en cours {vertices, cursor, reticle}
        _measureLabelMarkers: [],     // labels HTML live de la mesure en cours
        _committedMeasureMarkers: [], // labels HTML des mesures persistées

        /* --- 28 propriétés créées à l'exécution (hors littéral) ---
         * Règle d'initialisation opposable (SPEC-PLANMAP-SPLIT §3.2) : `null`
         * pour tout objet/marker/handler, `false` pour tout booléen, `0` pour
         * `_searchSeq` et `_wheelJustClosed` (reproduit exactement la première
         * lecture de l'original : `undefined` → falsy). */
        _searchSeq: 0,                     // :834
        pendingEntityPin: null,            // :1022, 1150, 1165
        _pinCircleFeatures: null,          // :1386-1400, 1598
        _pinDiameterLabels: null,          // :1427, 1600, 1623
        _pinDecoMarkers: null,             // :1571-1572, 1622
        _pinDiameterSrc: false,            // :1573, 1627, 1652
        _lastPinTap: null,                 // :1433-1438
        drawPrecisionMode: false,          // :1941, 2019
        moveState: null,                   // :2848, 4360 (toujours null — §7)
        _measureControls: null,            // :2480, 2491
        _measurePointBtn: null,            // :2470, 2492
        _measureUndoBtn: null,             // :2474, 2493
        _textMarkersById: null,            // :2772, 4775, 4851
        _activeWheel: null,                // :3523-3534, 3618, 4308
        _wheelJustClosed: 0,               // :1811, 3535, 3750
        _lastShapeTap: null,               // :2965-2970
        _dblZoomTimer: null,               // :2994-2996
        _pinchListener: null,              // :3045-3064
        _shapeLockMarkers: null,           // :3090-3118
        _inlinePanel: null,                // :3746-3853
        _moveHandlers: null,               // :4382-4472
        _modalReparent: null,              // :4587-4604
        _textModalBound: false,            // :4671-4672
        _captureBusy: false,               // :5073-5074, 5239
        _aoiFraming: false,                // :5313-5385
        _aoiFramingHandlers: null,         // :5379-5400
        _aoiDownloadBusy: false,           // :5457-5504

        /* --- 2 constantes publiques (planMap.js:5303-5304) --- */
        AOI_MIN_Z: 13,
        AOI_MAX_Z: 18,

        /**
         * Adapter de persistance (mission R3-c, hors littéral `planMap.js` —
         * cf. commentaire de `PlanMapState.persistence`, types.ts). Enrobe
         * `Persist` sur les 3 clés localStorage existantes : comportement
         * bit-identique à l'usage direct de `Persist.get`/`Persist.set` qu'il
         * remplace dans `pins.ts` (_loadPins/_savePins) et `draw-tools.ts`
         * (_loadShapes/_saveShapes). `view` est câblé pour cohérence de
         * l'interface mais n'est pas encore consommé : `_loadView`/`_saveView`
         * (map-core.ts) écrivent aujourd'hui `localStorage` en direct, hors
         * périmètre de ce paquet.
         */
        persistence: createLocalStorageAdapter<PlanPin, PlanShape, PlanView>(Persist, {
            pins: PINS_KEY,
            shapes: SHAPES_KEY,
            view: VIEW_KEY,
        }),
    };
}

/**
 * Enveloppe un handler d'événement : capture toute exception et la journalise,
 * pour qu'une erreur dans UN callback (drag, pointer, geste…) ne casse pas
 * silencieusement l'interaction ni n'interrompe les autres listeners MapLibre.
 */
// planMap.js:330-340
export const SafeMethods = {
    _safe<A extends unknown[], R>(this: PlanMapInternal, fn: (...args: A) => R, label?: string): (...args: A) => R | undefined {
        return (...args: A) => {
            try { return fn(...args); }
            catch (e) { console.error('[PlanMap] ' + (label || 'handler') + ' a échoué:', e); }
        };
    },
};
