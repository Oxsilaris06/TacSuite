/**
 * portal-offline-ready.test.ts — Badge « Prêt hors ligne » (décision 28/A7).
 *
 * « Prêt » exige DEUX choses : un service worker actif qui contrôle la page,
 * ET la page présente dans le précache. Toute autre combinaison affiche
 * « À ouvrir une fois en ligne avant départ ».
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    initOfflineBadges,
    isPageReadyOffline,
    offlineCandidates,
    renderOfflineBadge,
    type CachesLike,
    type OfflineCheckDeps,
} from '../../src/apps/portal/offline-ready.js';

function fakeCaches(hits: readonly string[]): CachesLike & { calls: Array<[string, unknown]> } {
    const calls: Array<[string, unknown]> = [];
    return {
        calls,
        async match(request: string, options?: { ignoreSearch?: boolean }): Promise<unknown> {
            calls.push([request, options]);
            return hits.includes(request) ? { ok: true } : undefined;
        },
    };
}

function deps(controller: unknown, caches: CachesLike | null): OfflineCheckDeps {
    return { serviceWorker: controller ? { controller } : { controller: null }, caches };
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('offlineCandidates', () => {
    it('essaie le dossier puis index.html', () => {
        expect(offlineCandidates('https://x/pctac/')).toEqual(['https://x/pctac/', 'https://x/pctac/index.html']);
        expect(offlineCandidates('https://x/oi')).toEqual(['https://x/oi/', 'https://x/oi/index.html']);
    });
});

describe('isPageReadyOffline', () => {
    it('vrai quand un contrôleur existe ET que le dossier est précaché', async () => {
        const cache = fakeCaches(['https://x/pctac/']);
        expect(await isPageReadyOffline('https://x/pctac/', deps({}, cache))).toBe(true);
        // Interrogation insensible à la query de révision Workbox.
        expect(cache.calls[0]?.[1]).toEqual({ ignoreSearch: true });
    });

    it('vrai quand seul index.html est précaché', async () => {
        const cache = fakeCaches(['https://x/pctac/index.html']);
        expect(await isPageReadyOffline('https://x/pctac/', deps({}, cache))).toBe(true);
    });

    it('faux sans contrôleur, même si la page est précachée', async () => {
        const cache = fakeCaches(['https://x/pctac/']);
        expect(await isPageReadyOffline('https://x/pctac/', deps(null, cache))).toBe(false);
    });

    it('faux si la page n’est pas dans le précache', async () => {
        expect(await isPageReadyOffline('https://x/pctac/', deps({}, fakeCaches([])))).toBe(false);
    });

    it('faux si l’API caches est absente', async () => {
        expect(await isPageReadyOffline('https://x/pctac/', deps({}, null))).toBe(false);
    });

    it('faux mais sans jeter si le cache échoue', async () => {
        const throwing: CachesLike = { async match() { throw new Error('boom'); } };
        await expect(isPageReadyOffline('https://x/pctac/', deps({}, throwing))).resolves.toBe(false);
    });
});

describe('renderOfflineBadge', () => {
    it('affiche « Prêt hors ligne » et marque data-ready=true', async () => {
        document.body.innerHTML = `<span id="offline-pctac" data-ready="false">
            <span class="offline-badge__label">Vérification…</span></span>`;
        const ready = await renderOfflineBadge(
            { badgeId: 'offline-pctac', pageUrl: 'https://x/pctac/' },
            deps({}, fakeCaches(['https://x/pctac/'])),
        );
        expect(ready).toBe(true);
        const el = document.getElementById('offline-pctac') as HTMLElement;
        expect(el.dataset.ready).toBe('true');
        expect(el.querySelector('.offline-badge__label')?.textContent).toBe('Prêt hors ligne');
    });

    it('affiche « À ouvrir une fois en ligne avant départ » sinon', async () => {
        document.body.innerHTML = `<span id="offline-oi" data-ready="true">
            <span class="offline-badge__label">x</span></span>`;
        await renderOfflineBadge(
            { badgeId: 'offline-oi', pageUrl: 'https://x/oi/' },
            deps(null, fakeCaches(['https://x/oi/'])),
        );
        const el = document.getElementById('offline-oi') as HTMLElement;
        expect(el.dataset.ready).toBe('false');
        expect(el.querySelector('.offline-badge__label')?.textContent).toBe('À ouvrir une fois en ligne avant départ');
    });
});

describe('initOfflineBadges', () => {
    it('renseigne chaque application demandée', async () => {
        document.body.innerHTML = `
            <span id="a"><span class="offline-badge__label"></span></span>
            <span id="b"><span class="offline-badge__label"></span></span>`;
        const cache = fakeCaches(['https://x/pctac/']);
        initOfflineBadges(
            [
                { badgeId: 'a', pageUrl: 'https://x/pctac/' },
                { badgeId: 'b', pageUrl: 'https://x/oi/' },
            ],
            deps({}, cache),
        );
        await vi.waitFor(() => expect(document.getElementById('a')?.dataset.ready).toBe('true'));
        expect(document.getElementById('b')?.dataset.ready).toBe('false');
    });
});
