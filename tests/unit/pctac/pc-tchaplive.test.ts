/**
 * pc-tchaplive.test.ts — Tests unitaires de TchapLive (P2.CONV).
 *
 * Contexte : `fetch`, `indexedDB` et `window.PlanMap` sont ABSENTS sous jsdom
 * → mockés explicitement ici (aucune dépendance npm nouvelle, cf.
 * SPEC-PCTAC-CONVERSION.md §8.4). `tchap-live.ts` s'auto-câble à l'import
 * (effet de bord, tchapLive.js:960-961) : chaque test réimporte le module à
 * l'état frais via `vi.resetModules()` + `import()` dynamique.
 *
 * Couverture demandée :
 *  1. wireUI() ne jette pas quand le DOM cible (#tl_toggle) est absent.
 *  2. stop() est idempotent et coupe la boucle de sync (fetch en cours abort).
 *  3. Le parsing d'une réponse /sync typique (evt geo_uri) produit la
 *     position attendue — observée via l'écriture IndexedDB (persistState),
 *     seule voie observable sans carte (window.PlanMap absent).
 *  4. L'absence de window.PlanMap ne provoque aucune exception.
 *  5. Le rafraîchissement du token OIDC est déclenché avant expiration
 *     (Date.now mocké pour franchir le seuil de marge de 60s).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Marqueurs créés par le module, tous tests confondus (vidé en beforeEach). */
const createdMarkers: Array<{ lngLat: [number, number] | null; removed: boolean }> = [];

vi.mock('maplibre-gl', () => {
  class FakeMarker {
    private readonly rec = { lngLat: null as [number, number] | null, removed: false };
    constructor() { createdMarkers.push(this.rec); }
    setLngLat(ll: [number, number]): this { this.rec.lngLat = ll; return this; }
    addTo(): this { return this; }
    remove(): this { this.rec.removed = true; return this; }
    getElement(): HTMLElement { return document.createElement('div'); }
  }
  class FakeLngLatBounds { extend(): this { return this; } }
  return { default: { Marker: FakeMarker, LngLatBounds: FakeLngLatBounds } };
});

const LS_KEY = 'pcTacTchapLive';
const HS = 'https://matrix.example.org';
const ROOM = '!room:example.org';

/* ─── helpers réponse fetch ─────────────────────────────────────────────── */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Réponse qui ne se résout jamais, sauf abort du signal transmis (simule le
 * long-poll /sync réel : sa seule façon de se terminer en test est stop()). */
function hangingResponse(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        },
        { once: true },
      );
    }
  });
}

interface CapturedCall {
  url: string;
  authorization: string | null;
}

function captureCall(input: RequestInfo | URL, init: RequestInit | undefined, calls: CapturedCall[]): void {
  const headers = init?.headers as Record<string, string> | undefined;
  calls.push({ url: String(input), authorization: headers?.Authorization ?? null });
}

async function flushMicrotasks(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/* ─── helper IndexedDB minimal (piège §8.4 : indexedDB absent sous jsdom) ──
 * Reproduit juste assez de la sémantique async réelle (résolution différée
 * via microtask APRÈS l'affectation des handlers on*) pour que
 * tlOpenDb/tlWithStore (tchap-live.ts) fonctionnent sans dépendance npm. */

interface FakePut {
  key: unknown;
  value: unknown;
}

function makeFakeIndexedDb(seed: Array<{ key: string; value: unknown }> = []): { factory: IDBFactory; puts: FakePut[] } {
  const puts: FakePut[] = [];
  const storeNames = new Set<string>();

  const db = {
    objectStoreNames: { contains: (n: string) => storeNames.has(n) },
    createObjectStore: (n: string) => {
      storeNames.add(n);
    },
    transaction: (storeName: string, mode: IDBTransactionMode) => {
      void storeName; void mode; // signature IDBDatabase.transaction, non exploités par le double
      const tx: {
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        onabort: (() => void) | null;
      } = { oncomplete: null, onerror: null, onabort: null };
      const store = {
        put: (value: unknown, key: unknown): IDBRequest => {
          puts.push({ key, value });
          queueMicrotask(() => tx.oncomplete?.());
          return {} as IDBRequest;
        },
        clear: (): IDBRequest => {
          puts.length = 0;
          queueMicrotask(() => tx.oncomplete?.());
          return {} as IDBRequest;
        },
        openCursor: (): IDBRequest => {
          // Chaîne de curseur minimale conforme à `loadAllState` : chaque
          // `continue()` republie `onsuccess` avec l'entrée suivante, puis
          // `result: null` termine l'itération.
          let i = 0;
          const req: { onsuccess: (() => void) | null; onerror: (() => void) | null; result: unknown } = {
            onsuccess: null,
            onerror: null,
            result: null,
          };
          const step = (): void => {
            const entry = seed[i];
            req.result = entry
              ? { key: entry.key, value: entry.value, continue: () => { i++; queueMicrotask(step); } }
              : null;
            req.onsuccess?.();
            // `tlWithStore` ne résout QUE sur `tx.oncomplete` : sans ce signal
            // de fin de transaction, `loadAllState` resterait en attente et
            // aucune réhydratation ne serait jamais observable.
            if (!entry) queueMicrotask(() => tx.oncomplete?.());
          };
          queueMicrotask(step);
          return req as unknown as IDBRequest;
        },
      };
      return {
        objectStore: () => store as unknown as IDBObjectStore,
        set oncomplete(fn: (() => void) | null) { tx.oncomplete = fn; },
        get oncomplete() { return tx.oncomplete; },
        set onerror(fn: (() => void) | null) { tx.onerror = fn; },
        get onerror() { return tx.onerror; },
        set onabort(fn: (() => void) | null) { tx.onabort = fn; },
        get onabort() { return tx.onabort; },
      } as unknown as IDBTransaction;
    },
  };

  const factory = {
    open: (name: string, version?: number): IDBOpenDBRequest => {
      void name; void version; // signature IDBFactory.open, non exploités par le double
      const req: {
        result: typeof db;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
      } = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return { factory, puts };
}

/* ─── setup / teardown ──────────────────────────────────────────────────── */

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  createdMarkers.length = 0;
  delete (window as unknown as { PlanMap?: unknown }).PlanMap;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ─── 1. wireUI() sans DOM cible ────────────────────────────────────────── */

describe('TchapLive.wireUI (P2.CONV)', () => {
  it('ne jette pas quand le DOM cible (#tl_toggle) est absent (vue jamais ouverte)', async () => {
    // Aucun #tl_toggle dans le document : cas réel le plus courant (la vue
    // géoloc n'a jamais été ouverte par l'utilisateur pendant la session).
    const { TchapLive } = await import('@pctac/tchap-live.js');
    expect(() => TchapLive.wireUI()).not.toThrow();
  });
});

/* ─── 2. stop() idempotent, coupe la boucle de sync ─────────────────────── */

describe('TchapLive.stop (P2.CONV)', () => {
  it('est idempotent et coupe la boucle de sync (fetch en cours interrompu)', async () => {
    document.body.innerHTML = '<input id="tl_hs"><input id="tl_token"><input id="tl_room">';
    (document.getElementById('tl_hs') as HTMLInputElement).value = HS;
    (document.getElementById('tl_token') as HTMLInputElement).value = 'tok-1';
    (document.getElementById('tl_room') as HTMLInputElement).value = ROOM;

    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      captureCall(input, init, calls);
      const url = String(input);
      if (url.includes('/account/whoami')) return jsonResponse({ user_id: '@tester:example.org' });
      if (url.includes('/sync') && !url.includes('since=')) {
        return jsonResponse({ next_batch: 'batch-1', rooms: {} });
      }
      // Long-poll (since=batch-1) : ne se termine que sur abort (stop()).
      return hangingResponse(init);
    };
    vi.stubGlobal('fetch', fetchImpl);

    const { TchapLive } = await import('@pctac/tchap-live.js');

    // Appeler stop() AVANT tout start() ne doit pas jeter (idempotence de base).
    expect(() => TchapLive.stop(true)).not.toThrow();

    const startPromise = TchapLive.startManual();
    await flushMicrotasks();

    // La boucle est bien entrée dans le long-poll (fetch since=batch-1 émis).
    expect(calls.some((c) => c.url.includes('since=batch-1'))).toBe(true);

    // stop() coupe la boucle : le fetch en cours s'aborte, runSync() se
    // termine, la promesse de startManual() se résout.
    expect(() => TchapLive.stop(true)).not.toThrow();
    await startPromise;

    // Un second stop() (déjà arrêté) est un no-op sans exception.
    expect(() => TchapLive.stop(true)).not.toThrow();
  });
});

/* ─── 3 & 4. parsing /sync → position attendue, sans window.PlanMap ─────── */

describe('TchapLive — parsing /sync et résilience sans carte (P2.CONV)', () => {
  it("parse un évènement geo_uri typique et persiste la position attendue (window.PlanMap absent, aucune exception)", async () => {
    expect((window as unknown as { PlanMap?: unknown }).PlanMap).toBeUndefined();

    const { factory: idbFactory, puts } = makeFakeIndexedDb();
    vi.stubGlobal('indexedDB', idbFactory);

    const locationEvent = {
      type: 'm.room.message',
      sender: '@alice:example.org',
      origin_server_ts: 1_700_000_000_123,
      content: { geo_uri: 'geo:48.8566,2.3522;u=5' },
    };

    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      captureCall(input, init, calls);
      const url = String(input);
      if (url.includes('/account/whoami')) return jsonResponse({ user_id: '@tester:example.org' });
      if (url.includes('/sync') && !url.includes('since=')) {
        return jsonResponse({
          next_batch: 'batch-1',
          rooms: { join: { [ROOM]: { state: { events: [] }, timeline: { events: [locationEvent] } } } },
        });
      }
      return hangingResponse(init);
    };
    vi.stubGlobal('fetch', fetchImpl);

    document.body.innerHTML = '<input id="tl_hs"><input id="tl_token"><input id="tl_room">';
    (document.getElementById('tl_hs') as HTMLInputElement).value = HS;
    (document.getElementById('tl_token') as HTMLInputElement).value = 'tok-1';
    (document.getElementById('tl_room') as HTMLInputElement).value = ROOM;

    const { TchapLive } = await import('@pctac/tchap-live.js');

    const startPromise = TchapLive.startManual();
    await flushMicrotasks();

    // window.PlanMap toujours absent à ce stade : aucune exception n'a
    // interrompu le traitement (sinon startPromise aurait rejeté / calls
    // serait resté vide après le premier /sync).
    expect(calls.some((c) => c.url.includes('since=batch-1'))).toBe(true);

    // La position est passée par la voie de résilience (carte indisponible →
    // tampon + persistState IndexedDB), seule observable ici.
    expect(puts.length).toBeGreaterThan(0);
    const rec = puts.find((p) => p.key === '@alice:example.org');
    expect(rec).toBeDefined();
    const value = rec?.value as { lat: number; lon: number };
    expect(value.lat).toBeCloseTo(48.8566, 4);
    expect(value.lon).toBeCloseTo(2.3522, 4);

    TchapLive.stop(true);
    await startPromise;
  });

  it("wireUI() explicite sans window.PlanMap ne jette pas", async () => {
    document.body.innerHTML = '<button id="tl_toggle"></button><div id="tl_panel"></div>';
    const { TchapLive } = await import('@pctac/tchap-live.js');
    expect(() => TchapLive.wireUI()).not.toThrow();
  });
});

/* ─── 5. rafraîchissement du token OIDC avant expiration ────────────────── */

describe('TchapLive — rafraîchissement token OIDC (P2.CONV)', () => {
  it('déclenche un refresh avant expiration (marge de 60s franchie)', async () => {
    // Session ProConnect déjà établie (refresh token + clientId persistés) :
    // startOidc() prend la voie "reprise", cf. tchapLive.js:830-834.
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        assign: {},
        hs: HS,
        room: ROOM,
        clientId: 'client-1',
        mode: 'oidc',
        connected: false,
        oidc: { clientId: 'client-1', refreshToken: 'refresh-1', deviceId: 'device-1' },
      }),
    );

    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    let tokenCalls = 0;
    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      captureCall(input, init, calls);
      const url = String(input);
      if (url.includes('.well-known/matrix/client')) return jsonResponse({});
      if (url.includes('.well-known/openid-configuration')) return jsonResponse({});
      if (url.includes('/oauth2/token')) {
        tokenCalls += 1;
        return jsonResponse({ access_token: `AT${tokenCalls}`, expires_in: 300 });
      }
      if (url.includes('/account/whoami')) return jsonResponse({ user_id: '@tester:example.org' });
      if (url.includes('/sync') && !url.includes('since=')) {
        // Franchit le seuil de marge (expiresAt - 60s) avant le prochain
        // appel api() de la boucle : 300s d'expiry − 241s d'écoulé < 60s.
        now += 241_000;
        return jsonResponse({ next_batch: 'batch-1', rooms: {} });
      }
      return hangingResponse(init);
    };
    vi.stubGlobal('fetch', fetchImpl);

    document.body.innerHTML = '<input id="tl_hs"><input id="tl_room">';
    (document.getElementById('tl_hs') as HTMLInputElement).value = HS;
    (document.getElementById('tl_room') as HTMLInputElement).value = ROOM;

    const { TchapLive } = await import('@pctac/tchap-live.js');

    const startPromise = TchapLive.startOidc();
    await flushMicrotasks(60);

    // 1er refresh : reprise de session (tchapLive.js:832). 2e refresh :
    // ensureToken() déclenché par la boucle avant expiration (tchapLive.js:703).
    expect(tokenCalls).toBe(2);

    // L'appel long-poll qui suit utilise bien le token renouvelé (AT2).
    const lastSyncCall = [...calls].reverse().find((c) => c.url.includes('since=batch-1'));
    expect(lastSyncCall?.authorization).toBe('Bearer AT2');

    TchapLive.stop(true);
    await startPromise;
  });
});

/* ─── 6. Péremption des « dernières positions connues » ─────────────────── */

const STALE_MAX_MS = 30 * 60 * 1000;

/** Carte factice suffisante pour getMap()/wireMapListeners/rehydrateMarker. */
function stubPlanMap(): void {
  const map = {
    on: vi.fn(),
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    getSource: vi.fn(),
    getLayer: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    getCanvas: vi.fn(() => ({ style: {} })),
  };
  (window as unknown as { PlanMap?: unknown }).PlanMap = { initialized: true, init: vi.fn(), map };
}

/** Session laissée « connectée » : exactement l'état après fermeture d'onglet sans Stop. */
function seedConnectedSession(): void {
  // `wireUI` sort immédiatement sans #tl_toggle (tchap-live.ts:1246) : le
  // panneau doit exister pour que la réhydratation au boot soit atteinte.
  document.body.innerHTML = '<button id="tl_toggle"></button><div id="tl_panel"></div><div id="tl_log"></div>';
  localStorage.setItem(LS_KEY, JSON.stringify({
    hs: HS, token: '', room: ROOM, assign: {}, mode: 'manual', connected: true,
  }));
}

function persistedRecord(sender: string, ageMs: number): { key: string; value: unknown } {
  return {
    key: sender,
    value: {
      lat: 48.8566, lon: 2.3522,
      ts: Date.now() - ageMs,
      trail: [[2.3522, 48.8566]],
      fonction: null, name: null, room: ROOM,
      savedAt: Date.now() - ageMs,
    },
  };
}

describe('TchapLive — péremption des positions réhydratées', () => {
  it("ne réaffiche PAS une position plus vieille que le plafond, mais réaffiche une position fraîche", async () => {
    // Symptôme corrigé : après une fermeture d'onglet sans Stop, `connected`
    // reste vrai et l'enregistrement IndexedDB survit. Au boot suivant,
    // rehydrateFromDisk reposait un marqueur gris QUEL QUE SOIT son âge —
    // d'où des coordonnées fantômes de plusieurs jours sur la carte.
    seedConnectedSession();
    stubPlanMap();
    const { factory } = makeFakeIndexedDb([
      persistedRecord('@fantome:example.org', 3 * 24 * 60 * 60 * 1000), // 3 jours
      persistedRecord('@fraiche:example.org', 60 * 1000),               // 1 minute
    ]);
    vi.stubGlobal('indexedDB', factory);
    vi.stubGlobal('fetch', (async (_i: RequestInfo | URL, init: RequestInit | undefined) =>
      hangingResponse(init)) as unknown as typeof fetch);

    // L'import déclenche wireUI() (auto-câblage du module), donc la
    // réhydratation au boot — le chemin exact du symptôme.
    await import('@pctac/tchap-live.js');
    await flushMicrotasks(60);

    // Un seul marqueur posé : la position fraîche. Le fantôme est écarté.
    expect(createdMarkers).toHaveLength(1);
    expect(createdMarkers[0]?.lngLat).toEqual([2.3522, 48.8566]);
  });

  it('écarte les DEUX enregistrements quand ils sont tous périmés (aucun marqueur du tout)', async () => {
    seedConnectedSession();
    stubPlanMap();
    const { factory } = makeFakeIndexedDb([
      persistedRecord('@a:example.org', STALE_MAX_MS + 60 * 1000),
      persistedRecord('@b:example.org', 5 * 60 * 60 * 1000),
    ]);
    vi.stubGlobal('indexedDB', factory);
    vi.stubGlobal('fetch', (async (_i: RequestInfo | URL, init: RequestInit | undefined) =>
      hangingResponse(init)) as unknown as typeof fetch);

    await import('@pctac/tchap-live.js');
    await flushMicrotasks(60);

    expect(createdMarkers).toHaveLength(0);
  });

  it("juste SOUS le plafond : la position est bien réaffichée (le plafond ne mord pas trop tôt)", async () => {
    seedConnectedSession();
    stubPlanMap();
    const { factory } = makeFakeIndexedDb([
      persistedRecord('@limite:example.org', STALE_MAX_MS - 60 * 1000),
    ]);
    vi.stubGlobal('indexedDB', factory);
    vi.stubGlobal('fetch', (async (_i: RequestInfo | URL, init: RequestInit | undefined) =>
      hangingResponse(init)) as unknown as typeof fetch);

    await import('@pctac/tchap-live.js');
    await flushMicrotasks(60);

    expect(createdMarkers).toHaveLength(1);
  });

  it("un marqueur réhydraté qui franchit le plafond À L'ÉCRAN finit par être retiré", async () => {
    // Sans plafond dans sweepStates, une position réhydratée juste sous le
    // seuil resterait affichée à vie : `stale` est exempté du balayage « lost ».
    vi.useFakeTimers();
    try {
      seedConnectedSession();
      // Session reprise avec un curseur persisté : `processSync` tourne alors en
      // mode incrémental (initial=false), donc SANS sa purge des « lost ». C'est
      // exactement le scénario du symptôme — après un simple rafraîchissement,
      // rien ne nettoie plus les fantômes.
      localStorage.setItem(LS_KEY, JSON.stringify({
        hs: HS, token: 'tok-1', room: ROOM, assign: {}, mode: 'manual', connected: true,
      }));
      localStorage.setItem('pcTacTchapLiveSince', 'batch-0');
      // `startManual` relit la config depuis le DOM (`saveCfg`) : sans ces
      // champs, hs/token/room repartent vides et la session ne démarre pas —
      // donc pas de `startSweep()`, donc rien à observer.
      document.body.insertAdjacentHTML('beforeend',
        `<input id="tl_hs" value="${HS}"><input id="tl_token" value="tok-1"><input id="tl_room" value="${ROOM}">`);
      stubPlanMap();
      const { factory } = makeFakeIndexedDb([
        persistedRecord('@limite:example.org', STALE_MAX_MS - 60 * 1000),
      ]);
      vi.stubGlobal('indexedDB', factory);
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init: RequestInit | undefined) => {
        const url = String(input);
        if (url.includes('/account/whoami')) return jsonResponse({ user_id: '@tester:example.org' });
        if (url.includes('since=batch-0')) return jsonResponse({ next_batch: 'batch-1', rooms: {} });
        return hangingResponse(init);
      }) as unknown as typeof fetch);

      await import('@pctac/tchap-live.js');
      await vi.advanceTimersByTimeAsync(0);
      await flushMicrotasks(60);
      expect(createdMarkers).toHaveLength(1);
      expect(createdMarkers[0]?.removed).toBe(false);

      // Le balayage tourne toutes les 5 s ; on franchit le plafond.
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

      expect(createdMarkers[0]?.removed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
