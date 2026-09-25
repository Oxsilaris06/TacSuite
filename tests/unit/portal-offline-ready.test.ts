/**
 * portal-offline-ready.test.ts — Badge « Prêt hors ligne » (décision 28/A7).
 *
 * « Prêt » exige DEUX choses : un service worker actif qui contrôle la page,
 * ET la page présente dans le précache. Toute autre combinaison affiche
 * rien (badge masqué, décision de Nico du 09-25).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    hasIconFontCached,
    initOfflineBadges,
    isAppReadyOffline,
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

    it('sinon le badge est masqué, sans message (Nico, 09-25 : « À ouvrir une fois en ligne avant départ » supprimé)', async () => {
        document.body.innerHTML = `<span id="offline-oi" data-ready="true">
            <span class="offline-badge__label">x</span></span>`;
        await renderOfflineBadge(
            { badgeId: 'offline-oi', pageUrl: 'https://x/oi/' },
            deps(null, fakeCaches(['https://x/oi/'])),
        );
        const el = document.getElementById('offline-oi') as HTMLElement;
        expect(el.dataset.ready).toBe('false');
        expect(el.hidden).toBe(true);
        expect(document.body.textContent).not.toMatch(/ouvrir une fois/i);
    });

    it('un badge masqué réapparaît quand l’application devient prête', async () => {
        document.body.innerHTML = `<span id="offline-pctac" hidden><span class="offline-badge__label"></span></span>`;
        await renderOfflineBadge({ badgeId: 'offline-pctac', pageUrl: 'https://x/pctac/' }, deps({}, fakeCaches(['https://x/pctac/'])));
        const el = document.getElementById('offline-pctac') as HTMLElement;
        expect(el.hidden).toBe(false);
        expect(el.querySelector('.offline-badge__label')?.textContent).toBe('Prêt hors ligne');
    });
});

function cachesWithFonts(hits: readonly string[], fontKeys: readonly string[]): CachesLike {
    const base = fakeCaches(hits);
    return {
        match: base.match,
        async open(name: string) {
            if (name !== 'tacsuite-fonts') return { async keys() { return []; } };
            return { async keys() { return fontKeys.map((url) => ({ url })); } };
        },
    };
}

describe('R11 — le badge dépend de l’application, pas seulement du portail', () => {
    it('« Prêt » exige la police d’icônes en cache', async () => {
        const deps = (cache: CachesLike): OfflineCheckDeps => ({ serviceWorker: { controller: {} }, caches: cache });
        await expect(isAppReadyOffline('https://x/pctac/', deps(
            cachesWithFonts(['https://x/pctac/'], ['https://x/assets/material-symbols-outlined-abc.woff2']),
        ))).resolves.toBe(true);
        await expect(isAppReadyOffline('https://x/pctac/', deps(
            cachesWithFonts(['https://x/pctac/'], []),
        ))).resolves.toBe(false);
        // Sans possibilité d'inspecter le cache nommé, on ne conclut pas à tort.
        await expect(hasIconFontCached(deps(fakeCaches(['https://x/pctac/'])))).resolves.toBeNull();
        await expect(isAppReadyOffline('https://x/pctac/', deps(fakeCaches(['https://x/pctac/'])))).resolves.toBe(true);
    });

    it('renderOfflineBadge masque le badge quand la police manque', async () => {
        document.body.innerHTML = `<span id="offline-pctac"><span class="offline-badge__label">x</span></span>`;
        const ready = await renderOfflineBadge(
            { badgeId: 'offline-pctac', pageUrl: 'https://x/pctac/' },
            { serviceWorker: { controller: {} }, caches: cachesWithFonts(['https://x/pctac/'], []) },
        );
        expect(ready).toBe(false);
        expect((document.getElementById('offline-pctac') as HTMLElement).hidden).toBe(true);
    });

    it('réévalue les badges au controllerchange', async () => {
        document.body.innerHTML = `<span id="offline-pctac"><span class="offline-badge__label"></span></span>`;
        const listeners = new Map<string, Array<() => void>>();
        const serviceWorker = {
            controller: null as unknown,
            addEventListener(type: string, cb: () => void): void {
                listeners.set(type, [...(listeners.get(type) ?? []), cb]);
            },
        };
        const cache = cachesWithFonts(['https://x/pctac/'], ['https://x/assets/material-symbols-outlined-abc.woff2']);
        initOfflineBadges([{ badgeId: 'offline-pctac', pageUrl: 'https://x/pctac/' }], { serviceWorker, caches: cache });
        await vi.waitFor(() => expect(document.getElementById('offline-pctac')?.dataset.ready).toBe('false'));
        // Le SW prend la main : le badge doit être réévalué.
        serviceWorker.controller = {};
        listeners.get('controllerchange')?.forEach((cb) => cb());
        await vi.waitFor(() => expect(document.getElementById('offline-pctac')?.dataset.ready).toBe('true'));
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
