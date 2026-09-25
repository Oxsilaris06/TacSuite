/**
 * pc-wakelock.test.ts — Écran allumé pendant un suivi (décision 28, C5).
 * ===========================================================================
 *
 * `navigator.wakeLock.request('screen')` tant qu'un suivi (Tchap ou OsmAnd)
 * est actif ; verrou partagé (compteur), relâché au Stop du dernier ; repris
 * au retour de visibilité ; API absente ou refusée → UN toast, jamais d'erreur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSentinel { release: ReturnType<typeof vi.fn>; addEventListener: (t: string, cb: () => void) => void; released: boolean; _releaseCb?: () => void }

function makeSentinel(): FakeSentinel {
  const s: FakeSentinel = {
    released: false,
    release: vi.fn(() => { s.released = true; }),
    addEventListener: (_t, cb) => { s._releaseCb = cb; },
  };
  return s;
}

async function freshModule(): Promise<typeof import('../../../src/apps/pctac/tchap-live.js')> {
  vi.resetModules();
  return import('../../../src/apps/pctac/tchap-live.js');
}

function hide(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

function toastCount(): number {
  return Array.from(document.querySelectorAll('.tac-toast')).filter((el) => (el.textContent ?? '').includes('peut se mettre en veille')).length;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  hide(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('C5 — verrou d’écran partagé entre suivis', () => {
  it('deux suivis, un seul verrou ; un arrêt le garde ; le dernier le relâche', async () => {
    const sentinels: FakeSentinel[] = [];
    const request = vi.fn(() => { const s = makeSentinel(); sentinels.push(s); return Promise.resolve(s); });
    vi.stubGlobal('navigator', { wakeLock: { request } });

    const mod = await freshModule();
    mod.acquireScreenWakeLock();
    mod.acquireScreenWakeLock();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');

    mod.releaseScreenWakeLock(); // un seul suivi arrêté
    expect(sentinels[0]?.released).toBe(false);

    mod.releaseScreenWakeLock(); // dernier suivi arrêté
    expect(sentinels[0]?.released).toBe(true);
  });

  it('onglet caché (verrou relâché par le navigateur) puis visible : verrou repris', async () => {
    const sentinels: FakeSentinel[] = [];
    const request = vi.fn(() => { const s = makeSentinel(); sentinels.push(s); return Promise.resolve(s); });
    vi.stubGlobal('navigator', { wakeLock: { request } });

    const mod = await freshModule();
    mod.acquireScreenWakeLock();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    // Le navigateur relâche le verrou en passant l'onglet en arrière-plan.
    sentinels[0]?._releaseCb?.();
    hide(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1);

    // Retour au premier plan : reprise.
    hide(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('API absente : UN toast, sans erreur, même après plusieurs suivis', async () => {
    vi.stubGlobal('navigator', {});
    const mod = await freshModule();
    expect(() => {
      mod.acquireScreenWakeLock();
      mod.acquireScreenWakeLock();
    }).not.toThrow();
    expect(toastCount()).toBe(1);
  });

  it('API refusée : UN toast, sans erreur', async () => {
    const request = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    vi.stubGlobal('navigator', { wakeLock: { request } });
    const mod = await freshModule();
    expect(() => { mod.acquireScreenWakeLock(); }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(toastCount()).toBe(1);
  });

  // R19 : `startOidc` pose `running = true` AVANT tout await ; si la session
  // échoue (réseau, Stop pendant l'autorisation) avant `runSync`, `stop()` ne
  // doit PAS relâcher une référence qu'elle n'a jamais prise — sinon le verrou
  // d'un suivi OsmAnd simultané tombe et l'écran se met en veille.
  it('un démarrage ProConnect en échec ne coupe pas le verrou d’un suivi OsmAnd', async () => {
    document.body.innerHTML = '<input id="tl_hs" value="https://hs.example"><input id="tl_room" value="!r:hs"><input id="tl_token" value="">';
    const release = vi.fn();
    const sentinel = { release, addEventListener: (): void => {}, released: false };
    vi.stubGlobal('navigator', { wakeLock: { request: vi.fn(async () => sentinel) } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const mod = await freshModule();
    mod.acquireScreenWakeLock(); // suivi OsmAnd déjà actif (un seul verrou pris)
    await Promise.resolve();
    await mod.TchapLive.startOidc(); // échoue avant `runSync`
    await Promise.resolve();

    expect(release).not.toHaveBeenCalled();
  });
});
