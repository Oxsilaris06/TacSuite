/**
 * c03-live-persist.test.ts — Les réglages des suivis Tchap et OsmAnd refusés
 * par le stockage (quota plein) sont signalés à l'utilisateur au lieu de
 * disparaître en silence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => {
  class FakeMarker {
    setLngLat(): this { return this; }
    addTo(): this { return this; }
    remove(): this { return this; }
    getElement(): HTMLElement { return document.createElement('div'); }
  }
  class FakeLngLatBounds { extend(): this { return this; } }
  return { Marker: FakeMarker, LngLatBounds: FakeLngLatBounds };
});

function fillStorage() {
  return vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    const err = new Error('quota');
    err.name = 'QuotaExceededError';
    throw err;
  });
}

const toastText = (): string => Array.from(document.querySelectorAll('.tac-toast')).map((t) => t.textContent ?? '').join('|');

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="tl_panel"></div><input id="osm_url"><input id="osm_key"><span id="osm_status"></span>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('réglages de suivi et stockage plein', () => {
  it('OsmAnd : le démarrage signale des réglages non enregistrés', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    const mod = await import('../../../src/apps/pctac/osmand-live.js');
    mod.OsmandLive.wireUI();
    (document.getElementById('osm_url') as HTMLInputElement).value = 'http://127.0.0.1:9690';
    (document.getElementById('osm_key') as HTMLInputElement).value = 'read-key-test';
    fillStorage();
    mod.OsmandLive.start();
    mod.OsmandLive.stop();
    expect(toastText()).toContain('Stockage plein');
  });

  it('Tchap : l\'arrêt volontaire signale un état non enregistré', async () => {
    const mod = await import('../../../src/apps/pctac/tchap-live.js');
    fillStorage();
    mod.TchapLive.stop(true);
    expect(toastText()).toContain('Stockage plein');
  });
});
