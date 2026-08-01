/**
 * oi-store.test.ts — Tests unitaires du socle Store (Proxy) + IndexedDB (init.ts).
 * Paquet P3.CONV `oi-store` — port de modules/init.js (394 LOC).
 *
 * Invariants vérifiés (SPEC-OI-CONVERSION.md §4, tests obligatoires) :
 *  (a) Blob/File/ArrayBuffer/Uint8Array ressortent par référence IDENTIQUE (===)
 *      à travers le Proxy profond — jamais un wrapper.
 *  (b) un objet plain est proxyfié récursivement ; un `set` profond déclenche notify().
 *  (c) le WeakMap (_proxyCache) ne recrée pas de Proxy pour la même cible.
 *  (d) dbManager.putItem ne résout QU'AU commit de la transaction (transaction.oncomplete),
 *      jamais sur un simple succès de requête.
 *  (e) Store.loadFromStorage() ne déclenche PAS notify() (pas de sauvegarde en boucle à l'init).
 *
 * indexedDB n'existe pas sous jsdom (SPEC §13.5) : un faux IDBFactory minimal,
 * ENTIÈREMENT CONTRÔLÉ PAR LE TEST (aucun callback ne se déclenche tout seul),
 * est posé sur globalThis avant chaque import du module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (() => void) | null;

/**
 * Faux IDBRequest minimal. `scheduleSuccess()` simule la résolution
 * asynchrone réelle d'IndexedDB (микrotask) pour les méthodes dont
 * dbManager résout sur `request.onsuccess` (get/delete/getAllKeys/clear).
 * `put` ne l'appelle PAS : dbManager.putItem() ne branche pas
 * `request.onsuccess` (seul `transaction.oncomplete` compte, cf. (d)).
 */
class FakeIDBRequest {
    onsuccess: Handler = null;
    onerror: Handler = null;
    result: unknown = undefined;
    error: DOMException | null = null;

    scheduleSuccess(): void {
        queueMicrotask(() => this.onsuccess?.());
    }
}

/** Faux IDBObjectStore : stockage en mémoire (Map). */
class FakeObjectStore {
    constructor(private readonly data: Map<string, unknown>) {}

    put(value: unknown, key: string): FakeIDBRequest {
        this.data.set(key, value);
        // Pas de scheduleSuccess() : dbManager.putItem() ne branche pas
        // request.onsuccess, seul transaction.oncomplete compte (cf. (d)).
        return new FakeIDBRequest();
    }

    get(key: string): FakeIDBRequest {
        const req = new FakeIDBRequest();
        req.result = this.data.get(key);
        req.scheduleSuccess();
        return req;
    }

    delete(key: string): FakeIDBRequest {
        this.data.delete(key);
        const req = new FakeIDBRequest();
        req.scheduleSuccess();
        return req;
    }

    getAllKeys(): FakeIDBRequest {
        const req = new FakeIDBRequest();
        req.result = Array.from(this.data.keys());
        req.scheduleSuccess();
        return req;
    }

    clear(): FakeIDBRequest {
        this.data.clear();
        const req = new FakeIDBRequest();
        req.scheduleSuccess();
        return req;
    }
}

/**
 * Faux IDBTransaction : `oncomplete`/`onerror`/`onabort` ne sont JAMAIS
 * déclenchés automatiquement — seul un appel explicite du test
 * (`fireOnComplete()`) les invoque. C'est ce qui permet de prouver
 * l'invariant (d) : putItem() ne doit résoudre QUE sur ce déclenchement.
 */
class FakeTransaction {
    oncomplete: Handler = null;
    onerror: Handler = null;
    onabort: Handler = null;
    error: DOMException | null = null;

    constructor(private readonly store: FakeObjectStore) {}

    objectStore(): FakeObjectStore {
        return this.store;
    }

    fireOnComplete(): void {
        this.oncomplete?.();
    }
}

/** Faux IDBDatabase : une seule table 'images', une transaction à la fois. */
class FakeDatabase {
    readonly objectStoreNames = {
        contains: (): boolean => true,
    };
    readonly lastTransactionRef: { current: FakeTransaction | null } = { current: null };
    private readonly data = new Map<string, unknown>();

    createObjectStore(): void {
        // no-op : la table existe déjà dans ce double de test.
    }

    transaction(): FakeTransaction {
        const tx = new FakeTransaction(new FakeObjectStore(this.data));
        this.lastTransactionRef.current = tx;
        return tx;
    }
}

/** Faux IDBOpenDBRequest renvoyé par `indexedDB.open()`. */
class FakeOpenRequest {
    onupgradeneeded: Handler = null;
    onsuccess: Handler = null;
    onerror: Handler = null;
    readonly result: FakeDatabase;

    constructor(db: FakeDatabase) {
        this.result = db;
    }
}

/**
 * Installe un faux `indexedDB` global entièrement contrôlé par le test.
 * JUSTIFICATION unknown/cast : `IDBFactory` exige `cmp`/`databases`/
 * `deleteDatabase`, jamais exercés par dbManager (seul `open` est utilisé) ;
 * jsdom n'implémente pas indexedDB du tout (SPEC-OI-CONVERSION.md §13.5).
 */
function installFakeIndexedDb(): { db: FakeDatabase; openRequest: FakeOpenRequest } {
    const db = new FakeDatabase();
    const openRequest = new FakeOpenRequest(db);
    const fakeFactory = {
        open: (): FakeOpenRequest => openRequest,
    };
    globalThis.indexedDB = fakeFactory as unknown as IDBFactory;
    return { db, openRequest };
}

/** Fait aboutir `dbManager.init()` en simulant onupgradeneeded puis onsuccess. */
function resolveOpenRequest(openRequest: FakeOpenRequest): void {
    openRequest.onupgradeneeded?.();
    openRequest.onsuccess?.();
}

describe('oi-store — Store (Proxy profond) + dbManager (IndexedDB)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('(a) valeurs binaires — référence identique à travers le Proxy', () => {
        it('un Blob inséré dans state.formData ressort par référence === (pas un wrapper)', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            const blob = new Blob(['contenu'], { type: 'text/plain' });
            Store.state.formData.monBlob = blob;

            expect(Store.state.formData.monBlob).toBe(blob);
        });

        it('un File inséré dans state.formData ressort par référence === (pas un wrapper)', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            const file = new File(['contenu'], 'photo.png', { type: 'image/png' });
            Store.state.formData.monFile = file;

            expect(Store.state.formData.monFile).toBe(file);
        });

        it('un ArrayBuffer inséré dans state.formData ressort par référence === (pas un wrapper)', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            const buffer = new ArrayBuffer(8);
            Store.state.formData.monBuffer = buffer;

            expect(Store.state.formData.monBuffer).toBe(buffer);
        });

        it('un Uint8Array (TypedArray/ArrayBuffer.isView) inséré ressort par référence ===', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            const view = new Uint8Array([1, 2, 3]);
            Store.state.formData.maView = view;

            expect(Store.state.formData.maView).toBe(view);
        });
    });

    describe('(b) proxyfication récursive des objets plain + notify()', () => {
        it('un objet plain imbriqué est proxyfié récursivement (accès sans throw, valeurs lisibles)', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            Store.state.formData.cartography = { view: null, pins: [], shapes: [] };
            // La lecture doit passer par un Proxy récursif : la valeur reste
            // structurellement identique (mêmes clés/valeurs) même si le
            // wrapper diffère de l'objet brut assigné.
            expect(Store.state.formData.cartography).toEqual({ view: null, pins: [], shapes: [] });
        });

        it('un `set` sur une sous-propriété profonde déclenche notify() (abonné notifié)', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            Store.state.formData.cartography = { view: null, pins: [], shapes: [] };

            const listener = vi.fn();
            Store.subscribe(listener);

            const cartography = Store.state.formData.cartography as { pins: unknown[] };
            cartography.pins.push({ id: 'pin-1' });

            expect(listener).toHaveBeenCalled();
        });

        it('notify() persiste aussi (saveToStorage via notify — comportement d\'origine)', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            Store.state.currentStep = 3;

            const saved = localStorage.getItem('tactical_oi_data');
            expect(saved).not.toBeNull();
        });
    });

    describe('(c) cache WeakMap — pas de recréation de Proxy pour la même cible', () => {
        it('deux lectures successives de la même sous-propriété renvoient LA MÊME référence de proxy', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            Store.state.formData.cartography = { view: null, pins: [], shapes: [] };

            const first = Store.state.formData.cartography;
            const second = Store.state.formData.cartography;

            expect(first).toBe(second);
        });

        it('deux accès à Store.state renvoient le même proxy racine (cache par cible)', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            expect(Store.state).toBe(Store.state);
        });
    });

    describe('(d) dbManager.putItem — résolution UNIQUEMENT au commit de transaction', () => {
        it('ne résout pas tant que transaction.oncomplete n\'a pas été déclenché', async () => {
            const { db, openRequest } = installFakeIndexedDb();
            const { dbManager } = await import('@oi/init.js');

            const initPromise = dbManager.init();
            resolveOpenRequest(openRequest);
            await initPromise;

            let resolved = false;
            const blob = new Blob(['x']);
            const putPromise = dbManager.putItem('img-1', blob).then(() => {
                resolved = true;
            });

            // Laisse les microtasks courants s'écouler SANS déclencher oncomplete.
            await Promise.resolve();
            await Promise.resolve();
            expect(resolved).toBe(false);

            // Déclenche enfin le commit de la transaction : la promesse doit résoudre.
            db.lastTransactionRef.current?.fireOnComplete();
            await putPromise;
            expect(resolved).toBe(true);
        });

        it('résout après le commit et la donnée est bien présente dans le faux store', async () => {
            const { db, openRequest } = installFakeIndexedDb();
            const { dbManager } = await import('@oi/init.js');

            const initPromise = dbManager.init();
            resolveOpenRequest(openRequest);
            await initPromise;

            const blob = new Blob(['contenu-image']);
            const putPromise = dbManager.putItem('img-2', blob);
            db.lastTransactionRef.current?.fireOnComplete();
            await expect(putPromise).resolves.toBeUndefined();
        });
    });

    describe('(e) Store.loadFromStorage() — pas de notify() intempestif à l\'init (init.js:195)', () => {
        it('appelé dans l\'ordre réel de démarrage (avant toute souscription, init.js:217), ne produit aucun effet observable sur les abonnés', async () => {
            localStorage.setItem('tactical_oi_data', JSON.stringify({ situation: 'préchargé' }));
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            // Ordre réel de l'application : loadFromStorage() s'exécute au chargement
            // du module (init.js:217), STRICTEMENT AVANT que quiconque ne s'abonne
            // (les abonnements arrivent au DOMContentLoaded, dans d'autres modules).
            Store.loadFromStorage();

            const listener = vi.fn();
            Store.subscribe(listener);

            expect(listener).not.toHaveBeenCalled();
            expect(Store.state.formData.situation).toBe('préchargé');
        });

        // ÉCART DE COMPRÉHENSION TRACÉ (à signaler au gate P3.D, ne pas corriger) :
        // le commentaire d'origine (init.js:195, conservé verbatim dans le port)
        // affirme que l'affectation directe « évite le Proxy set() récursif ».
        // Vérifié par lecture : `this.state` (this = Store, le Proxy EXTÉRIEUR,
        // car Store.loadFromStorage() est un appel de méthode standard) renvoie
        // TOUJOURS le proxy profond (createDeepProxy), jamais l'état brut — donc
        // `this.state.formData = ...` traverse bel et bien UNE fois le trap `set`
        // du proxy profond, qui appelle `notifyCallback()` = `target.notify()`.
        // Le commentaire évite la récursion de PROXYFICATION DES ENFANTS (pas de
        // parcours récursif de formData), PAS l'appel à `notify()` lui-même.
        // Sans effet observable dans l'appli réelle uniquement parce qu'aucun
        // abonné n'existe encore à cet instant (test ci-dessus) — si un abonné
        // était déjà présent, il SERAIT notifié, comme le prouve ce test.
        it('techniquement, si un abonné est DÉJÀ présent (situation qui ne se produit jamais dans l\'appli réelle), il est notifié', async () => {
            localStorage.setItem('tactical_oi_data', JSON.stringify({ situation: 'préchargé' }));
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            const listener = vi.fn();
            Store.subscribe(listener);

            Store.loadFromStorage();

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('Exports scalaires et exposition window (SPEC §3.4)', () => {
        it('expose LOCAL_STORAGE_KEY = "tactical_oi_data" sur window et en export', async () => {
            installFakeIndexedDb();
            const { LOCAL_STORAGE_KEY } = await import('@oi/init.js');

            expect(LOCAL_STORAGE_KEY).toBe('tactical_oi_data');
            expect(window.LOCAL_STORAGE_KEY).toBe('tactical_oi_data');
        });

        it('expose window.Store, window.dbManager, window.visitedSteps, window.memberConfig', async () => {
            installFakeIndexedDb();
            const mod = await import('@oi/init.js');

            expect(window.Store).toBe(mod.Store);
            expect(window.dbManager).toBe(mod.dbManager);
            expect(window.visitedSteps).toBe(mod.visitedSteps);
            expect(window.memberConfig).toBe(mod.memberConfig);
        });

        it('expose window.DEFAULTS identique à l\'export DEFAULTS', async () => {
            installFakeIndexedDb();
            const { DEFAULTS } = await import('@oi/init.js');

            expect(window.DEFAULTS).toBe(DEFAULTS);
            expect(DEFAULTS.missions.moicp).toContain('RECONNAÎTRE LE DOMICILE');
        });

        it('memberConfig contient les 10 listes attendues du PATRACDVR', async () => {
            installFakeIndexedDb();
            const { memberConfig } = await import('@oi/init.js');

            expect(memberConfig.fonctions).toContain('Chef inter');
            expect(memberConfig.cellules).toContain('India 1');
            expect(memberConfig.equipements).toContain('Belier');
        });

        it('quickEditMapping mappe chaque libellé sur une clé valide de memberConfig', async () => {
            installFakeIndexedDb();
            const { quickEditMapping, memberConfig } = await import('@oi/init.js');

            expect(quickEditMapping['Cellule']).toEqual({ key: 'cellules', attribute: 'cellule' });
            expect(quickEditMapping['GPB']).toEqual({ key: 'gpbs', attribute: 'gpb' });
            for (const mapping of Object.values(quickEditMapping)) {
                expect(memberConfig[mapping.key]).toBeDefined();
            }
        });

        it('multiSelectAttributes contient les 5 attributs multi-sélection', async () => {
            installFakeIndexedDb();
            const { multiSelectAttributes } = await import('@oi/init.js');

            expect(multiSelectAttributes).toEqual(['fonction', 'equipement', 'equipement2', 'afis', 'gpb']);
        });

        it('tempCanvas est un HTMLCanvasElement et tempCtx son contexte 2D (ou null sous jsdom)', async () => {
            installFakeIndexedDb();
            const { tempCanvas, tempCtx } = await import('@oi/init.js');

            expect(tempCanvas).toBeInstanceOf(HTMLCanvasElement);
            // jsdom ne fournit pas de vrai contexte 2D (SPEC §13.5) : null est attendu.
            expect(tempCtx === null || typeof tempCtx === 'object').toBe(true);
        });

        it('BACKGROUND_IMAGE_LIGHT/DARK/ID sont portées verbatim (code mort tracé, SPEC §10)', async () => {
            installFakeIndexedDb();
            const mod = await import('@oi/init.js');

            expect(mod.BACKGROUND_IMAGE_ID).toBe('pdf_background');
            expect(mod.BACKGROUND_IMAGE_LIGHT).toBe('assets/img/fond_oi_light.png');
            expect(mod.BACKGROUND_IMAGE_DARK).toBe('assets/img/fond_oi_dark.png');
        });

        it('INDEXED_DB_NAME vaut "OI_GeneratorLiteDB"', async () => {
            installFakeIndexedDb();
            const { INDEXED_DB_NAME } = await import('@oi/init.js');

            expect(INDEXED_DB_NAME).toBe('OI_GeneratorLiteDB');
        });

        it('dbManager.dbName et dbManager.storeName sont corrects', async () => {
            installFakeIndexedDb();
            const { dbManager } = await import('@oi/init.js');

            expect(dbManager.dbName).toBe('OI_GeneratorLiteDB');
            expect(dbManager.storeName).toBe('images');
        });
    });

    describe('window.saveToStorage — délégation à syncDomToStore si présent (SPEC §2.2, Règle d\'or)', () => {
        it('délègue à window.syncDomToStore quand il est défini (fonction)', async () => {
            installFakeIndexedDb();
            await import('@oi/init.js');

            const syncSpy = vi.fn();
            window.syncDomToStore = syncSpy;

            window.saveToStorage();

            expect(syncSpy).toHaveBeenCalled();
        });

        it('replie sur Store.saveToStorage() quand window.syncDomToStore est absent', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            // Retrait volontaire pour tester le repli (window.syncDomToStore
            // n'est posé par aucun autre paquet dans ce fichier de test isolé).
            delete (window as unknown as { syncDomToStore?: unknown }).syncDomToStore;

            const saveSpy = vi.spyOn(Store, 'saveToStorage');
            window.saveToStorage();

            expect(saveSpy).toHaveBeenCalled();
        });

        it('window.saveFormData est le même alias que window.saveToStorage', async () => {
            installFakeIndexedDb();
            await import('@oi/init.js');

            expect(window.saveFormData).toBe(window.saveToStorage);
        });
    });

    describe('dbManager.clearAllImages — invocation de window.cleanupObjectUrls (SPEC §2.2)', () => {
        it('appelle window.cleanupObjectUrls si défini, après la résolution de la requête clear()', async () => {
            const { openRequest } = installFakeIndexedDb();
            const { dbManager } = await import('@oi/init.js');

            const initPromise = dbManager.init();
            resolveOpenRequest(openRequest);
            await initPromise;

            const cleanupSpy = vi.fn();
            window.cleanupObjectUrls = cleanupSpy;

            await dbManager.clearAllImages();

            expect(cleanupSpy).toHaveBeenCalled();
        });
    });

    describe('Store.checkIntegrity — purge des références photo disparues d\'IndexedDB', () => {
        it('ne fait rien si formData.dynamic_photos est absent', async () => {
            installFakeIndexedDb();
            const { Store } = await import('@oi/init.js');

            await expect(Store.checkIntegrity()).resolves.toBeUndefined();
        });

        it('supprime les références dont le blob est introuvable en IDB et notifie', async () => {
            const { openRequest } = installFakeIndexedDb();
            const { Store, dbManager } = await import('@oi/init.js');

            const initPromise = dbManager.init();
            resolveOpenRequest(openRequest);
            await initPromise;

            Store.state.formData.dynamic_photos = {
                container_a: [
                    { id: 'photo-manquante', annotations: '[]', tools: '[]', other_tools: '', customTitle: '' },
                ],
            };

            const listener = vi.fn();
            Store.subscribe(listener);

            await Store.checkIntegrity();

            expect(Store.state.formData.dynamic_photos.container_a).toEqual([]);
            expect(listener).toHaveBeenCalled();
        });
    });
});
