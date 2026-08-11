/**
 * index.ts — Façade `PlanMap` (P2.CONV, paquet `pm-index`).
 * ===========================================================================
 *
 * Réassemble les 17 groupes du découpage (l'état initial de `state.ts` + les
 * 16 groupes de méthodes `this`-typés) en l'objet unique `PlanMap`, exactement
 * comme l'était le littéral original `modules/pctac/planMap.js:301-5594`.
 *
 * L'annotation `: PlanMapInternal` sur la cible du spread est le FILET DE
 * SÉCURITÉ d'exhaustivité prescrit par SPEC-PLANMAP-SPLIT.md §1.4 : si un
 * seul des membres du littéral d'origine manque (ou change de type), `tsc`
 * fait échouer ce fichier.
 *
 * Règle du découpage (§1.2) : aucun sous-module de méthodes n'importe un
 * autre sous-module de méthodes ; SEUL `index.ts` les importe tous, et SEUL
 * `index.ts` a un `export default` dans `planmap/`.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/pctac/planMap.js`
 * (lecture seule).
 */

import { AoiMethods } from './aoi.js';
import { CaptureMethods } from './capture.js';
import { ChromeMethods } from './chrome.js';
import { DrawLayersMethods } from './draw-layers.js';
import { DrawToolsMethods } from './draw-tools.js';
import { GeoMethods } from './geo.js';
import { MapCoreMethods } from './map-core.js';
import { MeasureMethods } from './measure.js';
import { PanelsMethods } from './panels.js';
import { PinsMethods } from './pins.js';
import { createPlanMapState, SafeMethods } from './state.js';
import { ShapesGesturesMethods } from './shapes-gestures.js';
import { ShapesRenderMethods } from './shapes-render.js';
import { TextModalMethods } from './text-modal.js';
import type { PlanMapInternal } from './types.js';
import { WheelsMethods } from './wheels.js';

// planMap.js:301-5594 — réassemblage VERBATIM de l'objet littéral unique :
// l'état initial (27 propriétés déclarées + 28 ad hoc + AOI_MIN_Z/AOI_MAX_Z,
// cf. state.ts) puis les 16 groupes de méthodes, dans l'ordre de la table §2
// de SPEC-PLANMAP-SPLIT.md. Aucun nom de méthode n'est déclaré dans deux
// groupes à la fois (vérifié un par un lors du portage de chaque paquet) :
// l'ordre des spreads ci-dessous n'a donc aucune incidence observable, il
// suit simplement l'ordre du document pour rester comparable ligne à ligne.
export const PlanMap: PlanMapInternal = {
    ...createPlanMapState(),
    ...SafeMethods,
    ...GeoMethods,
    ...MapCoreMethods,
    ...ChromeMethods,
    ...PinsMethods,
    ...DrawLayersMethods,
    ...DrawToolsMethods,
    ...MeasureMethods,
    ...ShapesRenderMethods,
    ...ShapesGesturesMethods,
    ...WheelsMethods,
    ...PanelsMethods,
    ...TextModalMethods,
    ...CaptureMethods,
    ...AoiMethods,
};

// planMap.js:5596 — VERBATIM : la façade est posée au SCOPE MODULE.
// Décision opposable SPEC-PLANMAP-SPLIT.md §6.1 : NE PAS déplacer cette
// affectation dans main.ts. Dans le graphe ESM, les corps des modules
// importés s'exécutent avant celui de l'entrée ; `tchap-live.ts` s'auto-câble
// à l'import et lit `window.PlanMap` (planMap.js:5596 est déjà exécuté avant
// que `tchapLive.js` ne s'exécute, cf. `main.js:7-8`). Poser la façade au
// scope module — et non dans le handler `DOMContentLoaded` de `main.ts` —
// reproduit exactement cet ordre. `src/apps/pctac/main.ts` doit importer
// `@pctac/planmap` avant `@pctac/tchap-live` (SPEC-PCTAC-CONVERSION.md §5.2).
window.PlanMap = PlanMap;

export default PlanMap;
