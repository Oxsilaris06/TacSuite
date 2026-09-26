/**
 * sw-nav-timeout.test.ts — audit du 26/09 (skill addyosmani-performance) : sur
 * un réseau qui répond à peine, la navigation attendait le réseau jusqu'au
 * délai du navigateur, écran blanc, alors que la page était au précache.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NAV_NETWORK_TIMEOUT_MS, withTimeout } from '../../src/shared/sw-routes';

afterEach(() => { vi.useRealTimers(); });

describe('withTimeout (navigation du service worker)', () => {
  it('rend la réponse réseau quand elle arrive à temps', async () => {
    await expect(withTimeout(Promise.resolve('page'), NAV_NETWORK_TIMEOUT_MS)).resolves.toBe('page');
  });

  it('échoue au bout du délai si le réseau traîne (la copie précachée prend le relais)', async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>(() => { /* ne répond jamais */ });
    const raced = withTimeout(slow, NAV_NETWORK_TIMEOUT_MS);
    const check = expect(raced).rejects.toThrow(/délai/);
    await vi.advanceTimersByTimeAsync(NAV_NETWORK_TIMEOUT_MS);
    await check;
  });

  it('un délai raisonnable pour une page déjà en cache : entre 2 et 5 s', () => {
    expect(NAV_NETWORK_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(NAV_NETWORK_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});
