/**
 * pc-tchaplive-lost.test.ts — Opérateur perdu gardé sur la carte (décision 35, C4).
 * ===========================================================================
 *
 * Aujourd'hui un opérateur passe « lost » après FB_LOST_MS (6 min) puis est
 * retiré par le balayage. Désormais il RESTE, grisé, avec « perdu depuis N min »
 * mis à jour chaque minute ; il n'est retiré que par Stop ou l'action « Retirer ».
 * Horloge simulée.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createdMarkers: Array<{ element: HTMLElement; lngLat: [number, number] | null; removed: boolean }> = [];

vi.mock('maplibre-gl', () => {
  class FakeMarker {
    private readonly rec: { element: HTMLElement; lngLat: [number, number] | null; removed: boolean };
    constructor(opts: { element?: HTMLElement } = {}) {
      this.rec = { element: opts.element ?? document.createElement('div'), lngLat: null, removed: false };
      createdMarkers.push(this.rec);
    }
    setLngLat(ll: [number, number]): this { this.rec.lngLat = ll; return this; }
    addTo(): this { return this; }
    remove(): this { this.rec.removed = true; return this; }
    getElement(): HTMLElement { return this.rec.element; }
  }
  class FakeLngLatBounds { extend(): this { return this; } }
  return { default: { Marker: FakeMarker, LngLatBounds: FakeLngLatBounds } };
});

const LS_KEY = 'pcTacTchapLive';
const HS = 'https://matrix.example.org';
const ROOM = '!room:example.org';
const SENDER = '@alice:example.org';
const T0 = new Date('2026-09-25T10:00:00Z').getTime();

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) } as unknown as Response;
}
function hangingResponse(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
}
async function flushMicrotasks(times = 40): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function stubPlanMap(): void {
  const map = {
    on: vi.fn(), flyTo: vi.fn(), fitBounds: vi.fn(),
    getSource: vi.fn(), getLayer: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(),
    project: vi.fn(() => ({ x: 0, y: 0 })), getCanvas: vi.fn(() => ({ style: {} })),
  };
  (window as unknown as { PlanMap?: unknown }).PlanMap = { initialized: true, init: vi.fn(), map };
}

/** Monte la session et injecte une première position live à T0. */
async function mountLive(now = T0): Promise<{ mod: typeof import('../../../src/apps/pctac/tchap-live.js'); el: HTMLElement }> {
  vi.setSystemTime(now);
  document.body.innerHTML = '<button id="tl_toggle"></button><div id="tl_panel"></div><div id="tl_log"></div><div id="tl_ops"></div><input id="tl_hs"><input id="tl_token"><input id="tl_room">';
  (document.getElementById('tl_hs') as HTMLInputElement).value = HS;
  (document.getElementById('tl_token') as HTMLInputElement).value = 'tok-1';
  (document.getElementById('tl_room') as HTMLInputElement).value = ROOM;
  localStorage.setItem(LS_KEY, JSON.stringify({ assign: {}, hs: HS, room: ROOM, token: 'tok-1', mode: 'manual' }));
  stubPlanMap();

  const memberEvent = { type: 'm.room.member', sender: SENDER, state_key: SENDER, origin_server_ts: T0, content: { displayname: 'Alice' } };
  const locationEvent = { type: 'm.room.message', sender: SENDER, origin_server_ts: T0, content: { geo_uri: 'geo:48.8566,2.3522;u=5' } };
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init: RequestInit | undefined) => {
    const url = String(input);
    if (url.includes('/account/whoami')) return jsonResponse({ user_id: '@tester:example.org' });
    if (url.includes('/sync') && !url.includes('since=')) {
      return jsonResponse({ next_batch: 'batch-1', rooms: { join: { [ROOM]: { state: { events: [memberEvent] }, timeline: { events: [locationEvent] } } } } });
    }
    return hangingResponse(init);
  }) as unknown as typeof fetch);

  const mod = await import('../../../src/apps/pctac/tchap-live.js');
  void mod.TchapLive.startManual();
  await vi.advanceTimersByTimeAsync(0);
  await flushMicrotasks(60);
  const el = createdMarkers[0]?.element ?? document.createElement('div');
  return { mod, el };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '';
  createdMarkers.length = 0;
  delete (window as unknown as { PlanMap?: unknown }).PlanMap;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('opérateur perdu gardé sur la carte (décision 35)', () => {
  it('5 min 59 s : pas encore perdu (état « déco imminente »), étiquette sans « perdu »', async () => {
    const { el } = await mountLive();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 59 * 1000);
    expect(createdMarkers[0]?.removed).toBe(false);
    expect(el.querySelector('.tl-label')?.textContent ?? '').toContain('Alice');
    expect(el.querySelector('.tl-label')?.textContent ?? '').not.toContain('perdu');
    expect(el.querySelector('.tl-retire')).toBeNull();
  });

  it('6 min 01 s : perdu, grisé, « perdu depuis 6 min », toujours sur la carte - pas de retrait', async () => {
    const { el } = await mountLive();
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000 + 10 * 1000);
    expect(createdMarkers[0]?.removed).toBe(false);
    expect(el.querySelector('.tl-label')?.textContent ?? '').toContain('perdu depuis 6 min');
    expect(el.querySelector('.tl-retire')).not.toBeNull();
    expect(el.querySelector('.tl-icon')?.getAttribute('style') ?? (el.querySelector('.tl-icon') as HTMLElement | null)?.style.opacity).toBeTruthy();
  });

  it('45 min : toujours là, mise à jour du libellé', async () => {
    const { el } = await mountLive();
    await vi.advanceTimersByTimeAsync(45 * 60 * 1000 + 10 * 1000);
    expect(createdMarkers[0]?.removed).toBe(false);
    expect(el.querySelector('.tl-label')?.textContent ?? '').toContain('perdu depuis 45 min');
  });

  it('une nouvelle position le rend normal', async () => {
    const { mod, el } = await mountLive();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(el.querySelector('.tl-label')?.textContent ?? '').toContain('perdu depuis');

    mod.TchapLive.upsert(SENDER, 48.9, 2.4, Date.now());
    expect(el.querySelector('.tl-label')?.textContent ?? '').not.toContain('perdu depuis');
    expect(el.querySelector('.tl-retire')).toBeNull();
  });

  it('Stop : tous les marqueurs sont retirés', async () => {
    const { mod } = await mountLive();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(createdMarkers[0]?.removed).toBe(false);
    mod.TchapLive.stop(true);
    expect(createdMarkers[0]?.removed).toBe(true);
  });

  it('« Retirer » sur le marqueur retire l’opérateur', async () => {
    const { el } = await mountLive();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    const btn = el.querySelector<HTMLButtonElement>('.tl-retire');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(createdMarkers[0]?.removed).toBe(true);
  });
});
