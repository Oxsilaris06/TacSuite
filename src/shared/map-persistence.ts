/**
 * map-persistence.ts — Interface commune de persistance carto (PC-Tac / OI).
 * ===========================================================================
 *
 * Mission R3-c (décision D1) : étape d'ARCHITECTURE avant la machine à gestes
 * commune — abstrait la persistance des pings/formes/vue derrière une
 * interface unique, `MapPersistenceAdapter<TPin, TShape, TView>`, pour que
 * les deux apps cartographiques (PC-Tac `planmap/`, OI `carto/`) exposent le
 * même contrat malgré des back-ends radicalement différents :
 *   - PC-Tac : `localStorage` via `Persist` (@shared/persist.ts) — garde
 *     quota + fallback `.bak` sur JSON corrompu.
 *   - OI     : `Store.state.formData.cartography` — AUCUNE garde native
 *     (fragilité n°5 de l'audit) ; comblée ici par le try/catch de
 *     `createStoreAdapter`.
 *
 * CONTRAT D'ERREUR (les deux fabriques ci-dessous le respectent) : un adapter
 * NE JETTE JAMAIS, à l'image de `Persist` (persist.ts, doc de tête). Un échec
 * de lecture dégrade vers un fallback neutre ([] pour pins/shapes, `null`
 * pour la vue) ; un échec d'écriture retourne `false` et — si fourni — invoque
 * `onError({ op, error })`. Aucune dépendance vers `feedback.ts` / toast ici :
 * `onError` est un point de branchement pour la couche appelante (TODO
 * explicite dans `createStoreAdapter`).
 *
 * Ce module est un socle PUR : aucune dépendance vers `pctac/` ni `oi/`,
 * seul `PersistContract`/`PersistWriteResult` (contrats déjà partagés,
 * `@shared/types/contracts.js`) sont importés en `import type`.
 */

import type { PersistContract, PersistWriteResult } from './types/contracts.js';

/* ------------------------------------------------------------------------- *
 * Interface commune
 * ------------------------------------------------------------------------- */

/** Les 6 opérations couvertes par le contrat d'erreur (`onError`/valeur de retour). */
export type MapPersistenceOp = 'loadPins' | 'savePins' | 'loadShapes' | 'saveShapes' | 'loadView' | 'saveView';

/** Détail transmis à `onError` lors d'un échec de lecture ou d'écriture. */
export interface MapPersistenceErrorInfo {
    readonly op: MapPersistenceOp;
    readonly error: unknown;
}

/** Callback branchable, appelé UNIQUEMENT sur échec (jamais sur succès). */
export type MapPersistenceOnError = (info: MapPersistenceErrorInfo) => void;

/**
 * Interface commune de persistance carto. `TPin`/`TShape`/`TView` sont les
 * types de données propres à chaque app (`PlanPin`/`PlanShape`/`PlanView`
 * côté PC-Tac ; `OiCartoPin`/`OiCartoShape`/`OiCartoViewState` côté OI).
 *
 * Contrat, identique aux deux fabriques ci-dessous :
 *  - `loadPins`/`loadShapes` : ne jettent jamais, `[]` en cas d'absence,
 *    de corruption ou d'erreur.
 *  - `loadView` : ne jette jamais, `null` en cas d'absence/corruption/erreur
 *    — la valeur de repli (ex. "Paris par défaut") reste un choix de l'app
 *    appelante, PAS de ce module (les deux apps ont des défauts différents
 *    en pratique, cf. `_loadView` de chacune).
 *  - `savePins`/`saveShapes`/`saveView` : ne jettent jamais, retournent
 *    `true`/`false` (succès/échec) et signalent l'échec via `onError` si un
 *    callback a été fourni à la fabrique.
 */
export interface MapPersistenceAdapter<TPin, TShape, TView> {
    loadPins(): TPin[];
    savePins(pins: readonly TPin[]): boolean;
    loadShapes(): TShape[];
    saveShapes(shapes: readonly TShape[]): boolean;
    loadView(): TView | null;
    saveView(view: TView): boolean;
}

/* ------------------------------------------------------------------------- *
 * Fabrique 1 : adapter localStorage (enrobe `Persist`, PC-Tac)
 * ------------------------------------------------------------------------- */

/** Les 3 clés localStorage sous lesquelles pins/formes/vue sont persistés. */
export interface LocalStorageAdapterKeys {
    pins: string;
    shapes: string;
    view: string;
}

/**
 * Validateurs métier optionnels, transmis tels quels à `Persist.get` (même
 * contrat que `PersistGetOptions.validator` : seul un retour STRICTEMENT
 * `false`, ou une exception, vaut rejet). Par défaut : `Array.isArray` pour
 * pins/shapes (comportement PC-Tac actuel, `_loadPins`/`_loadShapes`) ; aucun
 * validateur pour `view` (comportement PC-Tac actuel : `_loadView` ne
 * délègue pas à `Persist`, cf. note de tête de fichier).
 */
export interface LocalStorageAdapterValidators {
    pins?: ((value: unknown) => boolean) | undefined;
    shapes?: ((value: unknown) => boolean) | undefined;
    view?: ((value: unknown) => boolean) | undefined;
}

export interface CreateLocalStorageAdapterOptions {
    validators?: LocalStorageAdapterValidators | undefined;
    /** Invoqué sur échec d'écriture (quota dépassé, stockage indisponible, valeur non sérialisable…). */
    onError?: MapPersistenceOnError | undefined;
}

/**
 * Enrobe une instance de `Persist` (ou tout objet structurellement compatible
 * — utile en test) sous le contrat `MapPersistenceAdapter`. Comportement
 * BIT-IDENTIQUE à l'usage actuel de `Persist.get`/`Persist.set` dans
 * `planmap/pins.ts` et `planmap/draw-tools.ts` (mêmes clés, même validateur
 * `Array.isArray`, même fallback `[]`) — ce n'est qu'un point de délégation
 * supplémentaire, `Persist` reste l'unique couche qui touche `localStorage`.
 */
export function createLocalStorageAdapter<TPin, TShape, TView>(
    persist: PersistContract,
    keys: LocalStorageAdapterKeys,
    options: CreateLocalStorageAdapterOptions = {},
): MapPersistenceAdapter<TPin, TShape, TView> {
    const validators = options.validators ?? {};
    const onError = options.onError;

    const reportWriteFailure = (op: 'savePins' | 'saveShapes' | 'saveView', result: PersistWriteResult): void => {
        if (result.ok || !onError) return;
        const error = 'error' in result ? result.error : new Error(`Persist: écriture refusée (quota, clé "${keys.pins}"/"${keys.shapes}"/"${keys.view}")`);
        onError({ op, error });
    };

    return {
        loadPins(): TPin[] {
            return persist.get<TPin[]>(keys.pins, { validator: validators.pins ?? Array.isArray, fallback: [] }) || [];
        },
        savePins(pins: readonly TPin[]): boolean {
            const result = persist.set(keys.pins, pins);
            reportWriteFailure('savePins', result);
            return result.ok;
        },
        loadShapes(): TShape[] {
            return persist.get<TShape[]>(keys.shapes, { validator: validators.shapes ?? Array.isArray, fallback: [] }) || [];
        },
        saveShapes(shapes: readonly TShape[]): boolean {
            const result = persist.set(keys.shapes, shapes);
            reportWriteFailure('saveShapes', result);
            return result.ok;
        },
        loadView(): TView | null {
            return persist.get<TView | null>(keys.view, { validator: validators.view, fallback: null });
        },
        saveView(view: TView): boolean {
            const result = persist.set(keys.view, view);
            reportWriteFailure('saveView', result);
            return result.ok;
        },
    };
}

/* ------------------------------------------------------------------------- *
 * Fabrique 2 : adapter Store (enrobe un accès `Store.state.formData…`, OI)
 * ------------------------------------------------------------------------- */

/**
 * Accès bas niveau à confier à `createStoreAdapter` — c'est ICI, et
 * UNIQUEMENT ici, que doivent vivre les casts « ÉCART SIGNALÉ » propres à OI
 * (`OiCartographyState.pins`/`.shapes` typés `Record<string, unknown>[]`
 * dans `@shared/types/contracts.ts`, alors que `OICartoInternal` veut des
 * `OiCartoPin[]`/`OiCartoShape[]` typés) : un seul endroit de cast, au lieu
 * des 4 sites précédents dans `oi/carto/state.ts`.
 *
 * Chaque accesseur peut jeter (accès Store non garanti, proxy...) :
 * `createStoreAdapter` capture l'exception, ne la laisse jamais remonter.
 */
export interface StoreAdapterAccessors<TPin, TShape, TView> {
    getPins(): TPin[] | null | undefined;
    setPins(pins: readonly TPin[]): void;
    getShapes(): TShape[] | null | undefined;
    setShapes(shapes: readonly TShape[]): void;
    getView(): TView | null | undefined;
    setView(view: TView): void;
}

export interface CreateStoreAdapterOptions {
    /**
     * Invoqué sur toute lecture/écriture en échec. Par défaut : `console.warn`
     * (comble l'absence de filet côté OI, cf. audit fragilité n°5) — PAS de
     * dépendance vers `feedback.ts`/toast ici, volontairement : c'est un point
     * de branchement laissé pour une couche UI future (TODO explicite).
     */
    onError?: MapPersistenceOnError | undefined;
}

/** Filet par défaut : journalise, ne fait rien d'autre (aucun effet UI). */
const defaultOnError: MapPersistenceOnError = (info) => {
    // TODO(feedback) : brancher un toast utilisateur ici (@shared/feedback.js)
    // une fois la remontée UI des échecs de sauvegarde carto spécifiée côté OI.
    // Volontairement absent pour l'instant (mission R3-c : architecture pure).
    console.warn(`[map-persistence] ${info.op} a échoué:`, info.error);
};

/**
 * Enrobe un accès `Store.state.formData.cartography` (ou tout backend
 * structurellement équivalent) sous le contrat `MapPersistenceAdapter`, AVEC
 * un filet try/catch que l'original (`oi/carto/state.ts` avant ce paquet)
 * n'avait pas : une lecture/écriture qui jette est capturée, journalisée via
 * `onError` (défaut `console.warn`), et dégrade vers le fallback neutre
 * plutôt que de propager. Comportement de LECTURE inchangé dans le cas
 * nominal (Store disponible, données bien formées) — seul le cas d'erreur,
 * auparavant non couvert, est désormais absorbé.
 */
export function createStoreAdapter<TPin, TShape, TView>(
    accessors: StoreAdapterAccessors<TPin, TShape, TView>,
    options: CreateStoreAdapterOptions = {},
): MapPersistenceAdapter<TPin, TShape, TView> {
    const onError = options.onError ?? defaultOnError;

    const safeLoad = <T>(op: 'loadPins' | 'loadShapes' | 'loadView', read: () => T | null | undefined, fallback: T): T => {
        try {
            const value = read();
            return value ?? fallback;
        } catch (error) {
            onError({ op, error });
            return fallback;
        }
    };

    const safeSave = (op: 'savePins' | 'saveShapes' | 'saveView', write: () => void): boolean => {
        try {
            write();
            return true;
        } catch (error) {
            onError({ op, error });
            return false;
        }
    };

    return {
        loadPins: (): TPin[] => safeLoad('loadPins', accessors.getPins, []),
        savePins: (pins: readonly TPin[]): boolean => safeSave('savePins', () => accessors.setPins(pins)),
        loadShapes: (): TShape[] => safeLoad('loadShapes', accessors.getShapes, []),
        saveShapes: (shapes: readonly TShape[]): boolean => safeSave('saveShapes', () => accessors.setShapes(shapes)),
        loadView: (): TView | null => safeLoad('loadView', accessors.getView, null),
        saveView: (view: TView): boolean => safeSave('saveView', () => accessors.setView(view)),
    };
}
