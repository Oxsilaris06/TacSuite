/**
 * index.ts — Façade `OICarto` (P3.CONV, paquet `oi-carto-index`).
 * ===========================================================================
 *
 * Réassemble les 5 groupes du découpage `carto/` (l'état initial de
 * `state.ts` + les 4 groupes de méthodes `this`-typés) en l'objet unique
 * `OICarto`, exactement comme l'était le littéral original
 * `modules/oi_cartographie.js:269-1667`.
 *
 * L'annotation `: OICartoInternal` sur la cible du spread est le FILET DE
 * SÉCURITÉ d'exhaustivité prescrit par SPEC-OI-CONVERSION.md §6.2 : si un
 * seul des membres du littéral d'origine manque (ou change de type), `tsc`
 * fait échouer ce fichier.
 *
 * Règle du découpage (§6.2) : aucun sous-module de méthodes n'importe un
 * autre sous-module de méthodes ; SEUL `index.ts` les importe tous, et SEUL
 * `index.ts` a un `export default` dans `carto/`.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 */

import { CaptureMethods } from './capture.js';
import { DrawMethods } from './draw.js';
import { MapCoreMethods } from './map-core.js';
import { PanelsMethods } from './panels.js';
import { PinsMethods } from './pins.js';
import { createOICartoState, PersistMethods, SafeMethods } from './state.js';
import type { OICartoInternal } from './types.js';

// oi_cartographie.js:269-1667 — réassemblage VERBATIM de l'objet littéral
// unique : l'état initial (13 champs déclarés, cf. state.ts) puis les 5 groupes
// de méthodes. Aucun nom de méthode n'est déclaré dans deux groupes à la fois
// (vérifié lors du portage de chaque paquet) : l'ordre des spreads ci-dessous
// n'a donc aucune incidence observable, il suit simplement l'ordre du document
// pour rester comparable ligne à ligne.
//
// NOTE — `_inlinePanelMove` est déclaré dans l'interface `OICartoInternal`
// (types.ts, ligne 160) mais jamais initialisé dans le littéral de l'original
// (oi_cartographie.js:269-282) — c'est un champ assigné dynamiquement par
// `_openInlinePanel` (:1047). Le paquet `oi-carto-state` aurait dû l'inclure
// dans son retour `createOICartoState()` ; il a été oublié. Correction locale :
// initialiser à null ici pour satisfaire le type `OICartoInternal`.
export const OICarto: OICartoInternal = {
    ...createOICartoState(),
    _inlinePanelMove: null,
    ...SafeMethods,
    ...PersistMethods,
    ...MapCoreMethods,
    ...PinsMethods,
    ...PanelsMethods,
    ...CaptureMethods,
    ...DrawMethods,
};

// oi_cartographie.js:1669 — VERBATIM : la façade est posée au SCOPE MODULE.
// Décision opposable SPEC-OI-CONVERSION.md §6.3 : poser la façade ici (et non
// dans main.ts) reproduit exactement l'ordre d'initialisation de l'original
// (les corps des modules importés s'exécutent avant celui de l'entrée ; certains
// module de carto/ s'auto-câblent à l'import et lisent `window.OICarto`).
window.OICarto = OICarto;

// oi_cartographie.js:1671-1681 — IIFE de câblage auto-invoquée au chargement
// du module, VERBATIM. Câble le bouton dock #cartographyBtn pour appeler
// OICarto.open().
(function () {
    function bindDockButton() {
        const btn = document.getElementById('cartographyBtn');
        if (btn) btn.addEventListener('click', () => OICarto.open());
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindDockButton);
    } else {
        bindDockButton();
    }
})();

export default OICarto;
