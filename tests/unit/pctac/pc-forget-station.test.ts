/**
 * pc-forget-station.test.ts — « Oublier ce poste » (Nico, 26/09, après l'audit
 * par les skills : « Arrêter » et le RESET laissaient sur l'appareil le jeton
 * Tchap, le refresh token ProConnect et la clé de lecture du relais OsmAnd).
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
  return { default: { Marker: FakeMarker, LngLatBounds: FakeLngLatBounds } };
});
const h = vi.hoisted(() => ({ confirm: true, toasts: [] as string[] }));
vi.mock('@shared/feedback.js', async (orig) => ({
  ...(await orig<typeof import('@shared/feedback.js')>()),
  confirmDialog: vi.fn(async () => h.confirm),
  toast: vi.fn((m: string) => { h.toasts.push(m); }),
}));

const HS = 'https://matrix.example.gouv.fr';
const ISSUER = 'https://auth.example.gouv.fr';
const REVOKE = ISSUER + '/oauth2/revoke';

function res(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

let calls: { url: string; init?: RequestInit | undefined }[] = [];

function seed(tchap: Record<string, unknown>): void {
  localStorage.setItem('pcTacTchapLive', JSON.stringify({ hs: HS, room: '!salon:example', assign: {}, ...tchap }));
  localStorage.setItem('pcTacTchapLiveSince', 's123');
  localStorage.setItem('pcTacOsmandRelay', JSON.stringify({ url: 'https://relais.example/osmand', key: 'cle-lecture-secrete' }));
  document.body.innerHTML = `
    <button id="tl_toggle"></button><div id="tl_panel"></div><div id="tl_ops"></div><div id="tl_log"></div><span id="tl_count"></span><div id="tl_device"></div>
    <input id="tl_hs"><input id="tl_room"><input id="tl_token"><input id="tl_clientid">
    <button id="tl_oidc"></button><button id="tl_connect"></button><button id="tl_stop"></button>
    <div id="tl_status"></div>
    <input id="osm_url"><input id="osm_key"><button id="osm_start"></button><button id="osm_stop"></button>
    <span id="osm_status"></span>
    <button id="station_forget"></button>`;
}

async function clickForget(): Promise<void> {
  await import('@pctac/osmand-live.js');
  (document.getElementById('station_forget') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(h.toasts.length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  calls = [];
  h.confirm = true;
  h.toasts = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Oublier ce poste', () => {
  it('ProConnect : révoque le refresh token, puis efface Tchap et OsmAnd de l’appareil', async () => {
    seed({ mode: 'oidc', clientId: 'cid', oidc: { clientId: 'cid', refreshToken: 'rt-secret' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/.well-known/matrix/client')) return res({ 'm.authentication': { issuer: ISSUER } });
      if (url.endsWith('/.well-known/openid-configuration')) return res({ revocation_endpoint: REVOKE });
      return res({});
    }));
    await clickForget();

    const revoke = calls.find((c) => c.url === REVOKE);
    expect(revoke?.init?.method).toBe('POST');
    expect(String(revoke?.init?.body)).toContain('token=rt-secret');
    expect(localStorage.getItem('pcTacTchapLive')).toBeNull();
    expect(localStorage.getItem('pcTacTchapLiveSince')).toBeNull();
    expect(localStorage.getItem('pcTacOsmandRelay')).toBeNull();
    expect((document.getElementById('osm_key') as HTMLInputElement).value).toBe('');
    expect(h.toasts.join()).toContain('Révocation demandée');
  });

  it('jeton manuel : déconnexion Matrix (/logout) avec ce jeton', async () => {
    seed({ mode: 'manual', token: 'syt_secret' });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return res({}); }));
    await clickForget();

    const logout = calls.find((c) => c.url === HS + '/_matrix/client/v3/logout');
    expect(logout?.init?.method).toBe('POST');
    expect(JSON.stringify(logout?.init?.headers)).toContain('Bearer syt_secret');
    expect(localStorage.getItem('pcTacTchapLive')).toBeNull();
  });

  it('hors réseau : tout est effacé quand même, et l’opérateur sait que la session reste ouverte côté Tchap', async () => {
    seed({ mode: 'oidc', clientId: 'cid', oidc: { clientId: 'cid', refreshToken: 'rt-secret' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await clickForget();

    expect(localStorage.getItem('pcTacTchapLive')).toBeNull();
    expect(localStorage.getItem('pcTacOsmandRelay')).toBeNull();
    expect(h.toasts.join()).toContain('Tchap');
    expect(h.toasts.join()).not.toContain('Révocation demandée');
  });

  it('annulé à la confirmation : rien n’est effacé, rien ne part', async () => {
    seed({ mode: 'manual', token: 'syt_secret' });
    h.confirm = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await import('@pctac/osmand-live.js');
    (document.getElementById('station_forget') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => /logout|revoke/.test(u))).toEqual([]);
    expect(localStorage.getItem('pcTacTchapLive')).not.toBeNull();
    expect(localStorage.getItem('pcTacOsmandRelay')).not.toBeNull();
  });
});

describe('Oublier ce poste : revue de sécurité du 26/09', () => {
  it('C1 : un renouvellement de jeton en cours ne réécrit rien après l’oubli, et aucun jeton ne part vers l’origine de l’app', async () => {
    seed({ mode: 'oidc', connected: true, clientId: 'cid', oidc: { clientId: 'cid', refreshToken: 'rt-old' } });
    let releaseToken: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/.well-known/matrix/client')) return res({ 'm.authentication': { issuer: ISSUER } });
      if (url.endsWith('/.well-known/openid-configuration')) return res({ token_endpoint: ISSUER + '/oauth2/token', revocation_endpoint: REVOKE });
      if (url === ISSUER + '/oauth2/token') return new Promise<Response>((r) => { releaseToken = r; });
      return res({});
    }));
    await import('@pctac/osmand-live.js');
    await import('@pctac/tchap-live.js');
    await vi.waitFor(() => expect(calls.some((c) => c.url === ISSUER + '/oauth2/token')).toBe(true));

    (document.getElementById('station_forget') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(h.toasts.length).toBeGreaterThan(0));
    releaseToken(res({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 300 }));
    await new Promise((r) => setTimeout(r, 50));

    expect(localStorage.getItem('pcTacTchapLive')).toBeNull();
    // Aucun jeton vers une URL relative (« undefined/_matrix/… ») sur l'origine de l'app.
    expect(calls.filter((c) => JSON.stringify(c.init?.headers ?? {}).includes('Bearer') && !/^https:/.test(c.url))).toEqual([]);
    expect(calls.some((c) => c.url.startsWith('undefined'))).toBe(false);
  });

  it('C2 : jeton manuel ET refresh token présents : les deux sont révoqués', async () => {
    seed({ mode: 'manual', token: 'syt_secret', clientId: 'cid', oidc: { clientId: 'cid', refreshToken: 'rt-secret' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/.well-known/matrix/client')) return res({ 'm.authentication': { issuer: ISSUER } });
      if (url.endsWith('/.well-known/openid-configuration')) return res({ revocation_endpoint: REVOKE });
      return res({});
    }));
    await clickForget();
    expect(calls.some((c) => c.url === REVOKE)).toBe(true);
    expect(calls.some((c) => c.url === HS + '/_matrix/client/v3/logout')).toBe(true);
  });
});
