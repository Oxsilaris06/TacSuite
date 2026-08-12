/**
 * state.ts — État du littéral `OICarto` (13 champs) + persistance
 * `Store.state.formData.cartography` (P3.CONV, paquet `oi-carto-state`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM de `modules/oi_cartographie.js` (GStart-main,
 * lecture seule), SPEC-OI-CONVERSION.md §6.2/§6.3 :
 *  - `createOICartoState()` : les 13 champs du littéral `const OICarto = {…}`
 *    (:270-282), avec leurs valeurs initiales exactes ;
 *  - `SafeMethods` : `_safe` (:284-291, wrapper try/catch des handlers) ;
 *  - `PersistMethods` : `_getCartoState` (:366-373), `_loadView` (:374-380),
 *    `_saveView` (:381-393), `_loadPins` (:395-398), `_savePins` (:400-403),
 *    `_loadShapes` (:405-408), `_saveShapes` (:410-413).
 *
 * SEULE FRONTIÈRE DE PERSISTANCE de `carto/` : 100 % de la persistance passe
 * par `Store.state.formData.cartography` (view / pins / shapes) — grep négatif
 * vérifié sur tout `oi_cartographie.js`, aucune clé localStorage/IndexedDB
 * propre (SPEC §6, `PAQUETS-OI.json` id="oi-carto-state").
 *
 * PATRON DE DÉCOUPAGE imposé (SPEC-OI-CONVERSION.md §6.2, identique à
 * `docs/SPEC-PLANMAP-SPLIT.md` §1.2) : chaque groupe de méthodes déclare
 * `this: OICartoInternal` ; AUCUN import d'un autre groupe de méthodes
 * `carto/*`. `carto/index.ts` (autre paquet) assemble `createOICartoState()` +
 * `SafeMethods` + `PersistMethods` + les autres groupes en `OICarto`.
 *
 * RÈGLE D'OR (SPEC §2.2) : `Store` est importé directement depuis `@oi/init.js`
 * (PAS `window.Store`) — contrairement à `syncDomToStore`/`toast` (réassignés
 * après coup par d'autres modules), `Store` lui-même n'est JAMAIS réassigné :
 * l'objet exporté par `init.ts` et `window.Store` (init.ts:412) sont la MÊME
 * référence. Import direct = comportement identique, sans risque de capturer
 * une version obsolète. Cf. graphe d'import §2.3 : `carto/state.ts ← init`.
 *
 * ÉCART DE TYPAGE SIGNALÉ (règles communes §6, "écart de signature constaté ⇒
 * signaler au gate, ne pas corriger") : `OiCartographyState.pins`/`.shapes`
 * (`@shared/types/contracts.js`) sont typés `Record<string, unknown>[]`, alors
 * que `OICartoInternal` (`./types.ts`, paquet `oi-carto-base`) déclare
 * `_loadPins(): OiCartoPin[]` / `_savePins(pins: readonly OiCartoPin[])` (et
 * l'équivalent pour les shapes). Aucun des deux contrats partagés n'est
 * modifiable par ce paquet ⇒ assertion `as unknown as …`, comportement runtime
 * strictement identique à l'original (qui ne valide aucune forme non plus).
 * Précédent déjà établi dans ce projet : `@pctac/planmap/map-core.ts`,
 * `@pctac/tchap-live.ts`.
 *
 * DEPUIS mission R3-c (décision D1, `@shared/map-persistence.ts`) : les 4
 * sites de cast sont CONSOLIDÉS en un seul endroit — les accesseurs passés à
 * `createStoreAdapter()` dans `buildCartoPersistenceAdapter()` ci-dessous.
 * `_loadPins`/`_savePins`/`_loadShapes`/`_saveShapes`/`_loadView`/`_saveView`
 * délèguent désormais à `this.persistence` (l'adapter posé par
 * `createOICartoState()`) au lieu de lire/écrire `Store.state.formData`
 * directement — NOUVEAU par rapport à l'original : ces 6 méthodes sont
 * maintenant enveloppées d'un try/catch (côté adapter) qui comble l'absence
 * de filet native de cette frontière (audit fragilité n°5 : Store peut jeter,
 * rien ne le retenait avant), avec un `onError` par défaut journalisant en
 * `console.warn` (TODO explicite dans map-persistence.ts pour brancher un
 * jour un toast). Comportement de LECTURE en cas nominal inchangé.
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/oi_cartographie.js`
 * (lecture seule).
 */

import { Store } from '@oi/init.js';
import type { OiCartographyState } from '@shared/types/contracts.js';
import { createStoreAdapter, type MapPersistenceAdapter } from '@shared/map-persistence.js';

import type { OICartoInternal, OiCartoPin, OiCartoShape, OiCartoViewState } from './types.js';

/**
 * Accès bas niveau à `Store.state.formData.cartography`, créant le conteneur
 * si absent (oi_cartographie.js:366-373, VERBATIM). Extrait en fonction de
 * MODULE (indépendante de `this`) car l'original ne lit jamais `this` dans ce
 * corps malgré son typage `this: OICartoInternal` — c'est le SEUL point de
 * vérité réutilisé à la fois par `PersistMethods._getCartoState` (méthode
 * publique, interface inchangée) ET par les accesseurs de
 * `buildCartoPersistenceAdapter()` ci-dessous.
 */
function getCartoState(): OiCartographyState | null {
    // Garde VERBATIM de l'original. `Store` est un import ESM statique (RÈGLE
    // D'OR §2.2, cf. note de tête de fichier) : cette branche est
    // structurellement inatteignable dans le port (un import qui échoue est
    // une erreur de résolution de module, pas un `Store` `undefined` à
    // l'exécution) — conservée pour fidélité au fichier source, comme pour
    // les gardes « lib absente » de map-core.ts.
    if (typeof Store === 'undefined' || !Store.state || !Store.state.formData) return null;
    // Capture locale : une expression `Store.state.formData.cartography`
    // répétée ré-évaluerait la chaîne de Proxy à chaque accès ; `formData`
    // capturé une fois désigne le MÊME proxy caché (cf. `_proxyCache`,
    // init.ts) — comportement identique, et permet à TypeScript de suivre
    // l'affinement de type entre l'affectation et le `return` (même procédé
    // que `map-core.ts`, `_updateFullscreenIcon`).
    const formData = Store.state.formData;
    if (!formData.cartography) {
        formData.cartography = { view: null, pins: [], shapes: [] };
    }
    return formData.cartography;
}

/**
 * Construit l'adapter de persistance carto OI (mission R3-c) : enrobe
 * `getCartoState()` sous le contrat `MapPersistenceAdapter`, AVEC un filet
 * try/catch que l'original n'avait pas (`createStoreAdapter`,
 * `@shared/map-persistence.ts`). SEUL endroit du paquet où vivent les casts
 * « ÉCART SIGNALÉ » (cf. commentaire de tête de fichier) pins/shapes.
 */
function buildCartoPersistenceAdapter(): MapPersistenceAdapter<OiCartoPin, OiCartoShape, OiCartoViewState> {
    return createStoreAdapter<OiCartoPin, OiCartoShape, OiCartoViewState>({
        getPins: () => {
            const carto = getCartoState();
            // ÉCART SIGNALÉ : cf. commentaire de tête de fichier.
            return carto && Array.isArray(carto.pins) ? (carto.pins as unknown as OiCartoPin[]) : [];
        },
        setPins: (pins) => {
            const carto = getCartoState();
            // ÉCART SIGNALÉ : cf. commentaire de tête de fichier.
            if (carto) carto.pins = pins as unknown as Record<string, unknown>[];
        },
        getShapes: () => {
            const carto = getCartoState();
            // ÉCART SIGNALÉ : cf. commentaire de tête de fichier.
            return carto && Array.isArray(carto.shapes) ? (carto.shapes as unknown as OiCartoShape[]) : [];
        },
        setShapes: (shapes) => {
            const carto = getCartoState();
            // ÉCART SIGNALÉ : cf. commentaire de tête de fichier.
            if (carto) carto.shapes = shapes as unknown as Record<string, unknown>[];
        },
        getView: () => {
            const carto = getCartoState();
            return carto ? carto.view : null;
        },
        setView: (view) => {
            const carto = getCartoState();
            if (carto) carto.view = view;
        },
    });
}

/**
 * Les 13 champs d'état propres du littéral `OICarto` (oi_cartographie.js:270-282),
 * avec leurs valeurs initiales exactes. `map`/`initialized`/`is3D`/`markers`/
 * `labelsVisible` viennent de `OICartoContract` (hérité par `OICartoInternal`,
 * non redéclaré) ; les 8 autres sont propres à `OICartoInternal`.
 * `persistence` (mission R3-c) : hors littéral `oi_cartographie.js`, introduit
 * par le port — cf. commentaire de `OICartoInternal.persistence` (types.ts).
 */
export function createOICartoState(): Pick<
    OICartoInternal,
    | '_activeWheel'
    | '_inlinePanel'
    | 'map'
    | 'initialized'
    | 'is3D'
    | 'markers'
    | 'labelsVisible'
    | 'pendingPin'
    | 'drawTool'
    | 'drawColor'
    | 'drawState'
    | 'history'
    | 'redoStack'
    | 'streetLabelsOn'
    | 'lastQuickPin'
    | '_wheelJustClosed'
    | 'persistence'
    | 'drawPrecisionMode'
    | '_gesture'
    | '_selectedShapeId'
    | '_handleMarkers'
    | '_shapeToolbarMarker'
    | '_pinchListener'
    | '_measureState'
    | '_measureLabelMarkers'
    | '_committedMeasureMarkers'
    | '_measureControls'
    | '_measureUndoBtn'
    | 'textMarkers'
> {
    return {
        _activeWheel: null, // :270
        _inlinePanel: null, // :271
        map: null, // :272
        initialized: false, // :273
        is3D: false, // :274
        markers: new Map(), // :275 — id -> { pin: Marker, label: Marker }
        labelsVisible: true, // :276 — affichage des libellés de pins (toggle anti-superposition)
        pendingPin: null, // :277 — { kind, label } en attente d'un clic carte
        drawTool: null, // :278 — 'line' | 'rectangle' | 'circle' | null
        drawColor: '#ef4444', // :279
        drawState: null, // :280 — état temporaire pendant un tracé
        history: [], // :281 — pile JSON des shapes avant chaque modif
        redoStack: [], // :282
        streetLabelsOn: false, // overlay noms de rues (alignement PC-Tac, hors littéral — cf. types.ts)
        lastQuickPin: null, // dernier type posé par la roue de création (hors littéral — cf. types.ts)
        _wheelJustClosed: 0, // anti-réouverture de roue au clic de fermeture (parité PC-Tac)
        persistence: buildCartoPersistenceAdapter(), // R3-c, hors littéral (cf. ci-dessus)
        // --- Édition de formes + précision (chantier shape-edit, hors littéral — cf. types.ts) ---
        drawPrecisionMode: false,
        _gesture: null,
        _selectedShapeId: null,
        _handleMarkers: [],
        _shapeToolbarMarker: null,
        _pinchListener: null,
        // --- Mesure (chantier measure, hors littéral — cf. types.ts) ---
        _measureState: null,
        _measureLabelMarkers: [],
        _committedMeasureMarkers: [],
        _measureControls: null,
        _measureUndoBtn: null,
        // --- Texte libre (chantier text, hors littéral — cf. types.ts) : Map dédiée
        // (pas `markers`, partagé pins/shapes, collision d'id à éviter). ---
        textMarkers: new Map(),
    };
}

/** Enveloppe un handler : capture toute exception (log) — oi_cartographie.js:284-291. */
export const SafeMethods = {
    _safe<A extends unknown[], R>(
        this: OICartoInternal,
        fn: (...args: A) => R,
        label?: string,
    ): (...args: A) => R | undefined {
        return (...args: A) => {
            try {
                return fn(...args);
            } catch (e) {
                console.error('[OICarto] ' + (label || 'handler') + ' a échoué:', e);
            }
        };
    },
};

/**
 * Persistance — `Store.state.formData.cartography`. SEULE frontière de
 * persistance de `carto/` (cf. note de tête de fichier).
 */
export const PersistMethods = {
    // oi_cartographie.js:366-373 — délègue à la fonction de module `getCartoState()`
    // ci-dessus (extraction pure, corps VERBATIM, comportement identique).
    _getCartoState(this: OICartoInternal): OiCartographyState | null {
        return getCartoState();
    },

    // oi_cartographie.js:374-380
    // R3-c : délègue à `this.persistence.loadView()` (adapter posé par
    // createOICartoState()) — la validation `Array.isArray(v.center)` et le
    // repli France entière par défaut restent ICI (logique métier propre à
    // l'app, comme côté PC-Tac `map-core.ts::_loadView`), l'adapter ne fait
    // que lire la valeur brute (ou `null`) sans jeter.
    _loadView(this: OICartoInternal): OiCartoViewState {
        const v = this.persistence.loadView();
        if (v && Array.isArray(v.center)) return v;
        return { center: [2.3522, 48.8566], zoom: 5 }; // France entière par défaut
    },

    // oi_cartographie.js:381-393
    // R3-c : construit la vue (logique métier, inchangée) puis délègue
    // l'écriture à `this.persistence.saveView()`.
    _saveView(this: OICartoInternal): void {
        if (!this.map) return;
        const c = this.map.getCenter();
        // ÉCART SIGNALÉ (cf. note de tête de fichier, `OiCartoViewState`) :
        // `is3D` absent de `OiCartoView` (contracts.ts). Variable
        // intermédiaire (pas un littéral direct à l'affectation) : la
        // vérification des propriétés en excès de TypeScript ne s'applique
        // qu'aux littéraux affectés directement, pas à une variable typée
        // `OiCartoViewState` (sur-ensemble structurel de `OiCartoView`)
        // affectée ensuite à `saveView` — aucune assertion nécessaire.
        const view: OiCartoViewState = {
            center: [c.lng, c.lat],
            zoom: this.map.getZoom(),
            pitch: this.map.getPitch(),
            bearing: this.map.getBearing(),
            is3D: this.is3D,
            streetLabelsOn: this.streetLabelsOn,
        };
        this.persistence.saveView(view);
    },

    // oi_cartographie.js:395-398
    // R3-c : délègue à `this.persistence.loadPins()` — les casts « ÉCART
    // SIGNALÉ » sont désormais dans `buildCartoPersistenceAdapter()` (ci-dessus).
    _loadPins(this: OICartoInternal): OiCartoPin[] {
        return this.persistence.loadPins();
    },

    // oi_cartographie.js:400-403
    _savePins(this: OICartoInternal, pins: readonly OiCartoPin[]): void {
        this.persistence.savePins(pins);
    },

    // oi_cartographie.js:405-408
    _loadShapes(this: OICartoInternal): OiCartoShape[] {
        return this.persistence.loadShapes();
    },

    // oi_cartographie.js:410-413
    _saveShapes(this: OICartoInternal, list: readonly OiCartoShape[]): void {
        this.persistence.saveShapes(list);
    },
};
