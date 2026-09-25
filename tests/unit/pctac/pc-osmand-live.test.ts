/**
 * pc-osmand-live.test.ts — Tests de la source OsmAnd (§B du LOT E).
 *
 * On exerce l'INTÉGRATION réelle osmand-live → tchap-live.upsert : `maplibre-gl`
 * et `window.PlanMap` sont mockés (absents sous jsdom), comme dans
 * pc-tchaplive.test.ts. `fetch` est scripté. Les marqueurs créés sont observés
 * via le double de Marker (coordonnées + libellé).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MarkerRec { element: HTMLElement | null; lngLat: [number, number] | null; removed: boolean }

const h = vi.hoisted(() => ({ markers: [] as MarkerRec[] }));

vi.mock('maplibre-gl', () => {
  class FakeMarker {
    rec: MarkerRec = { element: null, lngLat: null, removed: false };
    constructor(options?: { element?: HTMLElement }) {
      this.rec.element = options?.element ?? null;
      h.markers.push(this.rec);
    }
    setLngLat(ll: [number, number]): this { this.rec.lngLat = ll; return this; }
    addTo(): this { return this; }
    remove(): this { this.rec.removed = true; return this; }
    getElement(): HTMLElement { return this.rec.element ?? document.createElement('div'); }
  }
  class FakeLngLatBounds { extend(): this { return this; } }
  return { default: { Marker: FakeMarker, LngLatBounds: FakeLngLatBounds } };
});

const OP_A = { ts: 1_700_000_000_000, rx: 1_700_000_000_000, lat: 48.1, lon: 2.1 };
const OP_B = { ts: 1_700_000_000_000, rx: 1_700_000_000_000, lat: 48.2, lon: 2.2 };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

interface Call { url: string; authorization: string | null }

let calls: Call[] = [];
let responses: Array<(url: string) => Response | Promise<Response>> = [];

function nextResponse(url: string): Promise<Response> {
  const fn = responses.shift();
  if (!fn) return Promise.resolve(jsonResponse({ now: 0, operators: [] }));
  return Promise.resolve(fn(url));
}

async function flush(times = 40): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function stubPlanMap(): void {
  const map = {
    on: vi.fn(), flyTo: vi.fn(), easeTo: vi.fn(), fitBounds: vi.fn(),
    getSource: vi.fn(), getLayer: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(),
    project: vi.fn(() => ({ x: 0, y: 0 })), getCanvas: vi.fn(() => ({ style: {} })),
    isStyleLoaded: vi.fn(() => true), getZoom: vi.fn(() => 10), setLayoutProperty: vi.fn(),
  };
  (window as unknown as { PlanMap?: unknown }).PlanMap = { initialized: true, init: vi.fn(), map };
}

function seedDom(): void {
  document.body.innerHTML = `
    <div id="tl_panel"></div>
    <input id="osm_url">
    <input id="osm_key">
    <button id="osm_start"></button>
    <button id="osm_stop"></button>
    <span id="osm_status"></span>`;
}

async function boot(): Promise<typeof import('@pctac/osmand-live.js')> {
  const mod = await import('@pctac/osmand-live.js');
  // wireUI() rappelle les valeurs persistées (vides ici) : on saisit APRÈS,
  // comme le ferait l'opérateur, puis on démarre.
  mod.OsmandLive.wireUI();
  (document.getElementById('osm_url') as HTMLInputElement).value = 'http://127.0.0.1:9690';
  (document.getElementById('osm_key') as HTMLInputElement).value = 'read-key-test';
  return mod;
}

function statusText(): string {
  return document.getElementById('osm_status')?.textContent ?? '';
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  h.markers.length = 0;
  calls = [];
  responses = [];
  delete (window as unknown as { PlanMap?: unknown }).PlanMap;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const url = String(input);
    calls.push({ url, authorization: headers?.Authorization ?? null });
    return nextResponse(url);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('@pctac/tchap-live.js');
  delete (window as unknown as { PlanMap?: unknown }).PlanMap;
});

describe('OsmandLive — sondage du relais', () => {
  it('pousse chaque point par upsert(osmand:<id>) avec nom, fonction et libellé, puis avance `since`', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OP_A.ts);
    seedDom();
    stubPlanMap();
    responses = [
      () => jsonResponse({
        now: 1000,
        operators: [
          { id: 'a1', nom: 'Dupont', fonction: 'Inter', points: [OP_A] },
          { id: 'b2', nom: 'Martin', fonction: 'Medic', points: [OP_B] },
        ],
      }),
      () => jsonResponse({ now: 2000, operators: [] }),
    ];

    const mod = await boot();
    mod.OsmandLive.start();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    // En-tête Authorization + premier `since` à 0.
    expect(calls[0]?.url).toContain('/positions?since=0');
    expect(calls[0]?.authorization).toBe('Bearer read-key-test');

    // Deux marqueurs, libellés « [FONCTION] Nom » issus de l'injection.
    expect(h.markers).toHaveLength(2);
    const labels = h.markers.map((m) => m.element?.querySelector('.tl-label')?.textContent ?? '');
    expect(labels).toContain('[INTER] Dupont');
    expect(labels).toContain('[MEDIC] Martin');
    expect(statusText()).toContain('Suivi actif');
    expect(statusText()).toContain('2 opérateur(s)');

    // Le sondage suivant repart du `now` de la réponse précédente.
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[1]?.url).toContain('/positions?since=1000');
  });

  it('clé refusée (401) : état explicite et arrêt du sondage', async () => {
    vi.useFakeTimers();
    seedDom();
    stubPlanMap();
    responses = [() => jsonResponse({ error: 'nope' }, 401)];

    const mod = await boot();
    mod.OsmandLive.start();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(statusText()).toContain('refusée');
    expect(calls).toHaveLength(1);

    // Plus aucun sondage, même après plusieurs cadences.
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('échec réseau : recul (5 s) puis reprise, marqueurs conservés', async () => {
    vi.useFakeTimers();
    seedDom();
    stubPlanMap();
    responses = [
      () => { throw new Error('réseau'); },
      () => jsonResponse({ now: 42, operators: [] }),
    ];

    const mod = await boot();
    mod.OsmandLive.start();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(statusText()).toContain('injoignable');
    expect(calls).toHaveLength(1);

    // Avant 5 s : pas de nouvel essai. Le recul est bien de 5 s.
    await vi.advanceTimersByTimeAsync(4000);
    await flush();
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(calls).toHaveLength(2);
    expect(statusText()).toContain('Suivi actif');
  });

  it("point en retard : entre dans la trace mais ne déplace PAS le marqueur", async () => {
    vi.useFakeTimers();
    seedDom();
    stubPlanMap();
    responses = [
      () => jsonResponse({
        now: 1000,
        operators: [{ id: 'a1', nom: 'Dupont', fonction: 'Inter', points: [{ ts: 2000, rx: 1000, lat: 48.5, lon: 2.5 }] }],
      }),
      () => jsonResponse({
        now: 2000,
        operators: [{ id: 'a1', nom: 'Dupont', fonction: 'Inter', points: [{ ts: 1500, rx: 2000, lat: 48.9, lon: 2.9 }] }],
      }),
    ];

    const mod = await boot();
    mod.OsmandLive.start();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(h.markers).toHaveLength(1);
    expect(h.markers[0]?.lngLat).toEqual([2.5, 48.5]);

    await vi.advanceTimersByTimeAsync(5000);
    await flush();

    // Le point tardif (ts 1500 < dernière position ts 2000) n'a pas bougé le
    // marqueur, qui reste sur la position la plus récente.
    expect(h.markers[0]?.lngLat).toEqual([2.5, 48.5]);
  });

  it('ignore un point déjà vu (même opérateur, même ts) : une seule entrée (D-6)', async () => {
    vi.useFakeTimers();
    seedDom();
    stubPlanMap();
    // Le relais, avec `rx >= since`, rejoue le point de bordure au sondage
    // suivant. On compte les upsert : il ne doit y en avoir qu'un.
    const upserts: Array<{ sender: string; ts: number }> = [];
    vi.doMock('@pctac/tchap-live.js', () => ({
      upsert: (sender: string, _lat: number, _lon: number, ts: number): void => { upserts.push({ sender, ts }); },
      registerRemoteOperator: (): void => { /* sans effet */ },
    }));
    const dup = { ts: 5000, rx: 5000, lat: 48.1, lon: 2.1 };
    responses = [
      () => jsonResponse({ now: 5000, operators: [{ id: 'a1', nom: 'Dupont', fonction: 'Inter', points: [dup] }] }),
      () => jsonResponse({ now: 6000, operators: [{ id: 'a1', nom: 'Dupont', fonction: 'Inter', points: [dup] }] }),
    ];

    const mod = await boot();
    mod.OsmandLive.start();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(upserts).toEqual([{ sender: 'osmand:a1', ts: 5000 }]);

    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    // Deuxième sondage : le même point est rejoué par le relais, mais dédoublonné.
    expect(upserts).toEqual([{ sender: 'osmand:a1', ts: 5000 }]);
  });
});
