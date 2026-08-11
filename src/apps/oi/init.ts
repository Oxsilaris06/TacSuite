/**
 * init.ts — Constantes globales et Store réactif (Proxy) du Générateur d'OI.
 * Port from: modules/init.js (394 LOC, intégral).
 * Fonctions principales : createDeepProxy, Store (Proxy réactif profond),
 * dbManager (IndexedDB), LOCAL_STORAGE_KEY, DEFAULTS.
 *
 * RÉPARTITION (SPEC-OI-CONVERSION.md §3.4) : les 29 liaisons `let`/`const` de
 * premier niveau de init.js qui sont RÉASSIGNÉES par d'autres fichiers ont
 * migré dans src/apps/oi/state.ts (paquet oi-state). Ce fichier ne porte que
 * ce qui n'est JAMAIS réassigné hors de init.js — export nommé classique.
 */
import { toast } from '@shared/feedback.js';

import type {
    OiDbManagerContract,
    OiDefaults,
    OiMemberConfig,
    OiStoreContract,
    OiStoreState,
} from '@shared/types/contracts.js';

// ==================== Constants.js ====================
export const LOCAL_STORAGE_KEY = 'tactical_oi_data'; // init.js:7
window.LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY; // init.js:8

export const INDEXED_DB_NAME = 'OI_GeneratorLiteDB'; // init.js:9 — jamais référencée ailleurs dans le fichier (dbManager.dbName est un littéral distinct, :223) ; conservé verbatim, export obligatoire (noUnusedLocals).

// init.js:10 — code mort : seul consommateur = presentation_legacy.js (module exclu du portage). Asset absent de la source. Cf. SPEC-OI-CONVERSION §10.
export const BACKGROUND_IMAGE_ID = 'pdf_background';
// init.js:11 — code mort : seul consommateur = presentation_legacy.js (module exclu du portage). Asset absent de la source. Cf. SPEC-OI-CONVERSION §10.
export const BACKGROUND_IMAGE_LIGHT = 'assets/img/fond_oi_light.png';
// init.js:12 — code mort : seul consommateur = presentation_legacy.js (module exclu du portage). Asset absent de la source. Cf. SPEC-OI-CONVERSION §10.
export const BACKGROUND_IMAGE_DARK = 'assets/img/fond_oi_dark.png';

// --- Globals --- init.js:15-26
export const DEFAULTS: OiDefaults = {
    missions: {
        moicp: 'RECONNAÎTRE LE DOMICILE EN VUE D\'APPRÉHENDER L\'OBJECTIF',
        zmspcp: 'BOUCLER - SURVEILLER - INTERDIRE TOUTE FUITE',
        effraction: `SOUTENIR L'ÉLÉMENT D'INTERVENTION\nL'objectif premier de la cellule est d'effectuer une effraction rapide et sécurisée sur la porte principale façade ALPHA afin de permettre la progression fluide de l'équipe d'assaut. En mesure de se rearticuler sur ordre.`,
    },
    cat: {
        moicp: `- Si décelé, dynamiser jusqu'au domicile.\n- Si présence tierce personne lors de la progression, contrôler.\n- Si fuite, CR direction fuite + interpellation.\n- Si rébellion, usage du strict niveau de force nécessaire.\n- Si retranchement, CR + réarticulation pour fixer l'adversaire.`,
        zmspcp: `- Compte rendu de mise en place.\n- Renseigner régulièrement.\n- Si décelé, CR.\n- Si fuite, CR direction fuite + interpellation si rapport de force favorable.\n- Si rébellion, usage du strict minimum de force nécessaire.\n- Si retranchement, CR + réarticulation pour fixer l'adversaire.`,
        generales: `- Pas d'initiative individuelle hors cadre légitime défense.\n- Discipline radio stricte.\n- CR systématique de tout changement de situation.`,
    },
};

// init.js:29-40 — mutée en place par Object.assign (autres modules), jamais réaffectée.
export const memberConfig: OiMemberConfig = {
    fonctions: ['Chef inter', 'Chef dispo', 'Chef Oscar', 'Conducteur', 'Chef de bord', 'DE', 'Cyno', 'Inter', 'Effrac', 'AO', 'Sans'],
    cellules: ['AO1', 'AO2', 'AO3', 'AO4', 'AO5', 'AO6', 'AO7', 'AO8', 'India 1', 'India 2', 'India 3', 'India 4', 'India 5', 'Effrac', 'Sans'],
    principales: ['UMP9', 'G36', 'FAP', 'Sans'],
    afis: ['PIE', 'LBD40', 'LBD44', 'Sans'],
    secondaires: ['PSA'],
    grenades: ['GENL', 'MP7', 'Sans'],
    equipements: ['Sans', 'BBAL', 'Bouclier MO', 'Belier', 'Lacry', 'IL', 'Lot 5.11', 'HDR 50', 'OP71', 'DoorRaider', 'Cintreuse'],
    equipements2: ['Sans', 'Cam pieton', 'Échelle', 'Stop stick', 'Lacry', 'Cale', 'IL', 'Pass'],
    tenues: ['UBAS', '4S', 'Bleu', 'Civile', 'Ghillie', 'Treillis'],
    gpbs: ['GPBL', 'GPBPD', 'Casque Lourd', 'Casque MO', 'Sans'],
};

// --- Wizard State & DOM --- init.js:43 (visitedSteps reste ici, Set muté en place)
export const visitedSteps: Set<number> = new Set();

// Canvases for annotations — init.js:52-53
export const tempCanvas: HTMLCanvasElement = document.createElement('canvas');
export const tempCtx: CanvasRenderingContext2D | null = tempCanvas.getContext('2d');

/** init.js:54 — attributs à sélection multiple (case à cocher, valeurs séparées par virgule). */
export const multiSelectAttributes: string[] = ['fonction', 'equipement', 'equipement2', 'afis', 'gpb'];

/** init.js:55-66 — mapping du panneau d'édition rapide PATRACDVR. Type local : aucun contrat partagé ne le couvre. */
interface OiQuickEditFieldMapping {
    key: keyof OiMemberConfig;
    attribute: string;
}
export const quickEditMapping: Record<string, OiQuickEditFieldMapping> = {
    'Cellule': { key: 'cellules', attribute: 'cellule' },
    'Fonction': { key: 'fonctions', attribute: 'fonction' },
    'Arme P.': { key: 'principales', attribute: 'principales' },
    'Arme S.': { key: 'secondaires', attribute: 'secondaires' },
    'A.F.I.': { key: 'afis', attribute: 'afis' },
    'Grenades': { key: 'grenades', attribute: 'grenades' },
    'Équip. 1': { key: 'equipements', attribute: 'equipement' },
    'Équip. 2': { key: 'equipements2', attribute: 'equipement2' },
    'Tenue': { key: 'tenues', attribute: 'tenue' },
    'GPB': { key: 'gpbs', attribute: 'gpb' },
};

// ==================== Store.js (Advanced Proxy Implementation) ====================

const initialState: OiStoreState = {
    formData: {},
    annotations: [],
    currentStep: 0,
    compressedImages: {},
    objectUrlsCache: {},
};

const listeners = new Set<(state: OiStoreState) => void>();

/**
 * Crée un proxy récursif pour surveiller les changements de propriétés,
 * même dans les objets imbriqués (ex: Store.state.formData.nom = '...')
 *
 * Cache WeakMap : sans cela, CHAQUE accès (Store.state.formData.x) recréait
 * une cascade de Proxy neufs — gaspillage majeur sur les accès fréquents
 * (navigation, syncDomToStore, collecte PDF). Le cache réutilise le proxy
 * d'un même objet cible ; le comportement des traps reste identique.
 */
const _proxyCache = new WeakMap<object, object>();

// Signature imposée par SPEC-OI-CONVERSION.md §4.3.
function createDeepProxy<T extends object>(target: T, notifyCallback: () => void): T {
    const cached = _proxyCache.get(target);
    // Le WeakMap<object, object> ne peut pas exprimer que la valeur cachée est
    // du même type T que `target` (perte de type inhérente à WeakMap<object,
    // object>) — assertion nécessaire, pas de `any`.
    if (cached) return cached as T;

    const proxy = new Proxy(target, {
        get(obj, prop) {
            // Reflect.get n'est pas typé (retour `any` dans lib.es2015.reflect) :
            // on le fait transiter par `unknown` pour ne jamais introduire de
            // `any` explicite dans ce fichier, puis on le rétrécit ci-dessous.
            const val: unknown = Reflect.get(obj, prop);

            // On ne proxyfie PAS les types binaires (Blob, ArrayBuffer, TypedArrays)
            // car cela corrompt l'accès aux données internes pour pdf-lib et URL.createObjectURL
            if (val !== null && typeof val === 'object') {
                const isBinary = (val instanceof Blob) ||
                    (val instanceof ArrayBuffer) ||
                    (ArrayBuffer.isView(val)) ||
                    (val instanceof File);

                if (!isBinary) {
                    return createDeepProxy(val, notifyCallback);
                }
            }
            return val;
        },
        set(obj, prop, value) {
            const result = Reflect.set(obj, prop, value);
            notifyCallback(); // Déclenche la notification à chaque modification
            return result;
        },
    });
    _proxyCache.set(target, proxy);
    // TS ne peut pas prouver que le trap `get` d'un Proxy<T> récursif renvoie
    // structurellement T (le trap est typé `unknown` par ProxyHandler<T>)
    // — assertion mandatée par SPEC-OI-CONVERSION.md §4.3, pas de `any`.
    return proxy as T;
}

const StoreBase: OiStoreContract = {
    state: initialState,

    subscribe(listener: (state: OiStoreState) => void): () => boolean {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    notify(): void {
        for (const listener of listeners) {
            listener(this.state);
        }
        this.saveToStorage();
    },

    saveToStorage(): void {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.state.formData));
        } catch (e) {
            console.error('LocalStorage Error:', e);
            // init.js:154 — `useUnknownInCatchVariables` impose de vérifier le
            // type avant d'accéder à `.name` ; QuotaExceededError est un
            // DOMException dans tous les moteurs — comportement identique.
            if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
                // U19 — toast unique (@shared/feedback.js).
                toast('Mémoire de sauvegarde saturée ! Exportez votre session puis réinitialisez les données.', { kind: 'error' });
            }
        }
    },

    async checkIntegrity(): Promise<void> {
        // init.js:163-166 — capture locale pour préserver le rétrécissement de
        // type (`this.state.formData.dynamic_photos` non-undefined) à travers
        // les `await` de la boucle ; même référence vivante (le Proxy renvoie
        // toujours le même wrapper caché par cible), comportement identique.
        const dynamicPhotos = this.state.formData.dynamic_photos;
        if (!dynamicPhotos) return;
        let changed = false;

        for (const containerId in dynamicPhotos) {
            // noUncheckedIndexedAccess : containerId provient d'un for...in sur
            // ce même objet, donc toujours défini — assertion de type, aucune
            // garde ajoutée (fidélité).
            const photos = dynamicPhotos[containerId] as (typeof dynamicPhotos)[string];
            const validPhotos = [];

            for (const photo of photos) {
                // init.js:171 — RÈGLE D'OR (SPEC §2.2) : dbManager est déjà exposé
                // sur window à ce point de l'exécution (init.js:341) ; conservé
                // verbatim (l'original utilise window.dbManager ici alors même
                // que `dbManager` est une const du même fichier).
                const exists = await window.dbManager.getItem(photo.id);
                if (exists) {
                    validPhotos.push(photo);
                } else {
                    console.warn(`Photo ${photo.id} introuvable dans IDB, suppression de la référence.`);
                    changed = true;
                }
            }

            if (changed) {
                dynamicPhotos[containerId] = validPhotos;
            }
        }

        if (changed) {
            this.notify();
            if (typeof window.syncAllThumbnails === 'function') window.syncAllThumbnails();
        }
    },

    loadFromStorage(): void {
        const data = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (data) {
            try {
                // On peuple directement pour éviter le Proxy set() récursif lors de l'init
                // JUSTIFICATION unknown : JSON.parse renvoie `any` dans lib.es5 ;
                // OiFormData n'a qu'un index signature `unknown` ⇒ la valeur parsée
                // est structurellement compatible sans validation de forme
                // supplémentaire (identique à l'original, qui ne valide rien non plus).
                this.state.formData = JSON.parse(data) as typeof this.state.formData;
                console.log('✅ Store initialisé depuis le stockage');
            } catch (e) {
                console.error('Invalid JSON in localStorage', e);
            }
        }
    },
};

// L'objet Store final expose les méthodes de StoreBase
// ET un état 'state' qui est lui-même un proxy profond.
// Exporté (en plus de window.Store, RÈGLE D'OR §2.2 pour les AUTRES modules) :
// même précédent que notifications.ts, pour la testabilité de ce fichier lui-même.
export const Store = new Proxy(StoreBase, {
    get(target, prop) {
        if (prop === 'state') {
            return createDeepProxy(target.state, () => target.notify());
        }
        return Reflect.get(target, prop);
    },
});

// --- INITIALISATION DU STORE ---
Store.loadFromStorage();


// ==================== DBManager.js ====================

// Exporté (en plus de window.dbManager, RÈGLE D'OR §2.2 pour les AUTRES
// modules) : même précédent que notifications.ts, pour la testabilité.
export const dbManager: OiDbManagerContract = {
    dbName: 'OI_GeneratorLiteDB',
    storeName: 'images',
    db: null,

    init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            // init.js:230-243 — conversion de typage : `event.target.result`
            // n'est pas exploitable sans assertion sous lib.dom (Event.target
            // est `EventTarget | null`, non affiné vers IDBOpenDBRequest) ;
            // `request.result`/`request.error` désignent exactement la même
            // valeur (ces évènements ne « bubblent » jamais), comportement
            // identique.
            request.onupgradeneeded = () => {
                this.db = request.result;
                if (!this.db.objectStoreNames.contains(this.storeName)) {
                    this.db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };
        });
    },

    putItem(key: string, blob: Blob): Promise<void> {
        return new Promise((resolve, reject) => {
            // init.js:249 — assertion : ces méthodes présupposent que init()
            // a déjà résolu `this.db` (jamais vérifié dans la source non plus,
            // qui appelle `this.db.transaction` sans garde) ; aucune garde
            // ajoutée, fidélité au comportement d'origine (TypeError identique
            // si `db` est encore `null`).
            const db = this.db as IDBDatabase;
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(blob, key);
            request.onerror = () => reject(request.error);
            // On résout sur le COMMIT de la transaction (oncomplete), pas sur onsuccess :
            // garantit que l'écriture est persistée avant un éventuel location.reload().
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error ?? new Error('transaction abort'));
        });
    },

    getItem(key: string): Promise<Blob | undefined> {
        return new Promise((resolve, reject) => {
            const db = this.db as IDBDatabase; // cf. putItem
            const transaction = db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            // request.result est `any` (IDBRequest<any>) : le contrat impose
            // `Blob | undefined` ⇒ assertion de type, valeur inchangée.
            request.onsuccess = () => resolve(request.result as Blob | undefined);
            request.onerror = () => reject(request.error);
        });
    },

    // Retourne toutes les clés d'images stockées (utilisé par l'archive tout-en-un).
    getAllKeys(): Promise<IDBValidKey[]> {
        return new Promise((resolve, reject) => {
            const db = this.db as IDBDatabase; // cf. putItem
            const transaction = db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    deleteItem(key: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const db = this.db as IDBDatabase; // cf. putItem
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);
            request.onsuccess = () => {
                // noUncheckedIndexedAccess : capture locale pour rétrécir
                // `string | undefined` avant l'appel à URL.revokeObjectURL
                // (comportement identique à la garde d'origine).
                const cachedUrl = Store.state.objectUrlsCache[key];
                if (Store.state.objectUrlsCache && cachedUrl) {
                    URL.revokeObjectURL(cachedUrl);
                    delete Store.state.objectUrlsCache[key];
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    },

    clearAllImages(): Promise<void> {
        return new Promise((resolve, reject) => {
            const db = this.db as IDBDatabase; // cf. putItem
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            request.onsuccess = () => {
                // init.js:304 — résolution globale tardive (`typeof cleanupObjectUrls
                // === 'function'`) → RÈGLE D'OR (SPEC §2.2) : appel cross-module vers
                // un symbole exposé sur window (OiToolsGlobals.cleanupObjectUrls)
                // ⇒ window.cleanupObjectUrls, même garde.
                if (typeof window.cleanupObjectUrls === 'function') window.cleanupObjectUrls();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    },
};


// ==================== Unified Initialization ===================
// --- Styles Dynamiques ---
const style = document.createElement('style');
style.textContent = `
    textarea { resize: both !important; }
    .draggable.dragging { opacity: 0.5; border: 2px dashed var(--accent-blue); }
    .patracdvr-member-btn { transition: all 0.2s ease; cursor: pointer; }
    .patracdvr-member-btn:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
    .container { scroll-behavior: smooth; }

    /* Context Menu Styles */
    .context-menu button:hover {
        background-color: var(--bg-interactive-hover) !important;
    }

    /* FIX: Photo Upload Visibility & Interaction */
    .file-upload-label {
        display: flex !important;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        cursor: pointer;
    }
`;
document.head.appendChild(style);

// --- GLOBAL EXPOSURE (PHASE 1) --- init.js:339-343
window.Store = Store;
window.dbManager = dbManager;
window.visitedSteps = visitedSteps;
window.memberConfig = memberConfig;

// Aliases pour la compatibilité — init.js:346-351
// saveToStorage/saveFormData seront ÉCRASÉS par formulaires.js (formulaires.js:841-844).
window.saveToStorage = () => {
    // init.js:347 — résolution globale tardive (`typeof syncDomToStore === 'function'`)
    // → RÈGLE D'OR (SPEC §2.2) : appel cross-module vers un symbole exposé sur
    // window (OiFormGlobals.syncDomToStore, version DÉBOUNCÉE) ⇒ window.syncDomToStore,
    // même garde. JAMAIS par import (capturerait la mauvaise version).
    if (typeof window.syncDomToStore === 'function') {
        return window.syncDomToStore();
    }
    return Store.saveToStorage();
};

window.saveFormData = window.saveToStorage; // init.js:353

// Export DEFAULTS — init.js:356
window.DEFAULTS = DEFAULTS;

// --- Vérification de disponibilité du stockage local --- init.js:359-394
(function checkStorageAvailability() {
    let storageAvailable = false;

    // Test localStorage
    try {
        const testKey = '__storage_test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);
        storageAvailable = true;
        console.log('✅ LocalStorage disponible');
    } catch {
        // init.js:369 — `e` non utilisé dans l'original ⇒ liaison de catch omise
        // (`noUnusedLocals`), comportement identique.
        console.warn('⚠️ LocalStorage non disponible - Mode local détecté');
        console.warn('ℹ️ En mode file://, le navigateur peut bloquer localStorage pour des raisons de sécurité.');
        console.warn('💡 Solution: Utilisez un serveur HTTP local (ex: python3 -m http.server 8000)');
    }

    // Test IndexedDB
    try {
        const testDb = indexedDB.open('test_db', 1);
        testDb.onsuccess = () => {
            console.log('✅ IndexedDB disponible');
            testDb.result.close();
            indexedDB.deleteDatabase('test_db');
        };
        testDb.onerror = () => {
            console.warn('⚠️ IndexedDB non disponible');
        };
    } catch {
        // init.js:386 — `e` non utilisé dans l'original ⇒ liaison de catch omise.
        console.warn('⚠️ IndexedDB non disponible');
    }

    if (!storageAvailable) {
        console.warn('\n🔴 ATTENTION: Le stockage local est bloqué en mode file://');
        console.warn('ℹ️ Les données ne seront PAS conservées entre les rechargements de page.');
        console.warn('💡 Pour utiliser toutes les fonctionnalités, lancez un serveur HTTP local:\n   python3 -m http.server 8000\n   puis ouvrez: http://localhost:8000/4.html');
    }
})();
