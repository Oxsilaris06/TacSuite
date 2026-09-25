/**
 * portal-announce.test.ts — Bandeau d'annonce du portail (décision 27).
 *
 * Ce qui est verrouillé :
 *   - la validation stricte (longueur, niveau, fuseau, expiration future
 *     bornée) : un contenu distant douteux ne doit rien pouvoir afficher ;
 *   - le repli hors ligne sur la dernière annonce valide connue, jusqu'à son
 *     expiration — et l'effacement d'une annonce lue mais invalide/expirée ;
 *   - la mémoire de fermeture : une annonce fermée reste masquée tant que son
 *     empreinte (texte + niveau + expiration) ne change pas ;
 *   - le délai de garde de 5 s : un réseau qui traîne ne bloque rien.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ANNOUNCE_BANNER_ID,
    ANNOUNCE_CACHE_KEY,
    ANNOUNCE_DISMISS_KEY,
    MAX_FUTURE_MS,
    applyCachedAnnouncement,
    fingerprint,
    hasTimezone,
    initAnnouncement,
    parseAnnouncement,
    refreshAnnouncement,
    type Announcement,
} from '../../src/apps/portal/announce.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const now = (): number => NOW;
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

function ann(over: Partial<Announcement> = {}): Announcement {
    return { texte: 'Exercice demain 08h00.', niveau: 'info', expire: iso(24 * 3600 * 1000), ...over };
}

function jsonResponse(body: unknown, ok = true): Response {
    return { ok, json: async () => body } as unknown as Response;
}

function bannerEl(): HTMLElement | null {
    return document.querySelector(`[data-banner-id="${ANNOUNCE_BANNER_ID}"]`);
}

function bannerText(): string | null {
    return bannerEl()?.querySelector('.tac-banner-message')?.textContent ?? null;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
});

describe('parseAnnouncement — validation stricte', () => {
    it('accepte une annonce valide', () => {
        expect(parseAnnouncement(ann(), NOW)).toEqual(ann());
    });

    it('refuse un texte vide après trim', () => {
        expect(parseAnnouncement(ann({ texte: '   ' }), NOW)).toBeNull();
    });

    it('refuse un texte de plus de 280 caractères, sans le tronquer', () => {
        expect(parseAnnouncement(ann({ texte: 'a'.repeat(281) }), NOW)).toBeNull();
        expect(parseAnnouncement(ann({ texte: 'a'.repeat(280) }), NOW)?.texte).toHaveLength(280);
    });

    it('refuse un niveau inconnu', () => {
        expect(parseAnnouncement({ ...ann(), niveau: 'critique' }, NOW)).toBeNull();
        expect(parseAnnouncement({ ...ann(), niveau: 'alert' }, NOW)).toBeNull();
    });

    it('refuse une expiration sans fuseau', () => {
        expect(hasTimezone('2026-09-26T12:00:00')).toBe(false);
        expect(hasTimezone('2026-09-26T12:00:00Z')).toBe(true);
        expect(hasTimezone('2026-09-26T14:00:00+02:00')).toBe(true);
        expect(parseAnnouncement(ann({ expire: '2026-09-26T12:00:00' }), NOW)).toBeNull();
    });

    it('refuse une expiration à plus de 30 jours', () => {
        expect(parseAnnouncement(ann({ expire: iso(MAX_FUTURE_MS + 1) }), NOW)).toBeNull();
        expect(parseAnnouncement(ann({ expire: iso(MAX_FUTURE_MS) }), NOW)).not.toBeNull();
    });

    it('refuse une expiration passée ou maintenant', () => {
        expect(parseAnnouncement(ann({ expire: iso(-1000) }), NOW)).toBeNull();
        expect(parseAnnouncement(ann({ expire: iso(0) }), NOW)).toBeNull();
    });

    it('refuse une expiration illisible', () => {
        expect(parseAnnouncement(ann({ expire: 'pas une date' }), NOW)).toBeNull();
    });
});

describe('fingerprint', () => {
    it('distingue un changement de texte, de niveau ou d’expiration', () => {
        const base = ann();
        const fp = fingerprint(base);
        expect(fingerprint(ann({ texte: 'Autre' }))).not.toBe(fp);
        expect(fingerprint(ann({ niveau: 'important' }))).not.toBe(fp);
        expect(fingerprint(ann({ expire: iso(2 * 24 * 3600 * 1000) }))).not.toBe(fp);
        expect(fingerprint(ann())).toBe(fp);
    });
});

describe('refreshAnnouncement — réponse distante', () => {
    it('affiche une annonce valide et la met en cache', async () => {
        const a = ann({ texte: 'Réunion 14h.', niveau: 'important', expire: iso(3600_000) });
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(a), now, storage: localStorage });
        expect(bannerText()).toBe('Réunion 14h.');
        expect(bannerEl()?.className).toContain('tac-banner--important');
        expect(JSON.parse(localStorage.getItem(ANNOUNCE_CACHE_KEY) as string)).toEqual(a);
    });

    it('mappe le niveau « alerte » sur un bandeau d’alerte', async () => {
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ niveau: 'alerte' })), now, storage: localStorage });
        expect(bannerEl()?.className).toContain('tac-banner--alert');
        expect(bannerEl()?.getAttribute('role')).toBe('alert');
    });

    it('pose le texte en textContent (jamais d’HTML, aucun lien)', async () => {
        const texte = '<b>gras</b> <a href="//x">lien</a>';
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ texte })), now, storage: localStorage });
        const span = bannerEl()?.querySelector('.tac-banner-message');
        expect(span?.textContent).toBe(texte);
        expect(span?.querySelector('a')).toBeNull();
        expect(span?.querySelector('b')).toBeNull();
        expect(bannerEl()?.querySelectorAll('button.tac-banner-action')).toHaveLength(0);
    });

    it('n’affiche rien et efface le cache sur une réponse non JSON', async () => {
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(ann()));
        const bad = { ok: true, json: async () => { throw new SyntaxError('pas du json'); } } as unknown as Response;
        await refreshAnnouncement({ fetchFn: async () => bad, now, storage: localStorage });
        expect(bannerEl()).toBeNull();
        expect(localStorage.getItem(ANNOUNCE_CACHE_KEY)).toBeNull();
    });

    it('n’affiche rien et efface le cache sur une réponse invalide', async () => {
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(ann()));
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ expire: iso(31 * 24 * 3600 * 1000) })), now, storage: localStorage });
        expect(bannerEl()).toBeNull();
        expect(localStorage.getItem(ANNOUNCE_CACHE_KEY)).toBeNull();
    });

    it('n’affiche rien et efface le cache sur une annonce expirée', async () => {
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(ann()));
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ expire: iso(-1) })), now, storage: localStorage });
        expect(bannerEl()).toBeNull();
        expect(localStorage.getItem(ANNOUNCE_CACHE_KEY)).toBeNull();
    });
});

describe('repli hors ligne', () => {
    it('affiche la dernière annonce valide connue si le fetch échoue', async () => {
        const cached = ann({ texte: 'Consigne hors ligne.' });
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(cached));
        await refreshAnnouncement({ fetchFn: async () => { throw new Error('offline'); }, now, storage: localStorage });
        expect(bannerText()).toBe('Consigne hors ligne.');
        expect(localStorage.getItem(ANNOUNCE_CACHE_KEY)).not.toBeNull();
    });

    it('n’affiche rien hors ligne sans cache', async () => {
        await refreshAnnouncement({ fetchFn: async () => { throw new Error('offline'); }, now, storage: localStorage });
        expect(bannerEl()).toBeNull();
    });

    it('n’affiche pas une annonce en cache expirée, et l’efface', () => {
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(ann({ expire: iso(-1) })));
        applyCachedAnnouncement({ now, storage: localStorage });
        expect(bannerEl()).toBeNull();
        expect(localStorage.getItem(ANNOUNCE_CACHE_KEY)).toBeNull();
    });

    it('un échec HTTP n’est pas une annonce invalide : le cache reste', async () => {
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(ann({ texte: 'Cache gardé.' })));
        await refreshAnnouncement({ fetchFn: async () => jsonResponse({}, false), now, storage: localStorage });
        expect(bannerText()).toBe('Cache gardé.');
    });
});

describe('mémoire de fermeture', () => {
    const dismiss = (): void => {
        const btn = bannerEl()?.querySelector<HTMLButtonElement>('.tac-banner-close');
        btn?.click();
    };

    it('une annonce fermée reste masquée tant qu’elle ne change pas', async () => {
        const a = ann({ texte: 'Fermable.' });
        const fetchFn = async (): Promise<Response> => jsonResponse(a);
        await refreshAnnouncement({ fetchFn, now, storage: localStorage });
        expect(bannerEl()).not.toBeNull();
        dismiss();
        expect(bannerEl()).toBeNull();
        expect(localStorage.getItem(ANNOUNCE_DISMISS_KEY)).toBe(fingerprint(a));

        // Même annonce relue : re-masquée, y compris depuis le cache hors ligne.
        await refreshAnnouncement({ fetchFn, now, storage: localStorage });
        expect(bannerEl()).toBeNull();
        applyCachedAnnouncement({ now, storage: localStorage });
        expect(bannerEl()).toBeNull();
    });

    it('une nouvelle annonce se montre même après fermeture de la précédente', async () => {
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ texte: 'Première.' })), now, storage: localStorage });
        dismiss();
        expect(bannerEl()).toBeNull();

        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ texte: 'Deuxième.' })), now, storage: localStorage });
        expect(bannerText()).toBe('Deuxième.');
    });
});

describe('délai de garde', () => {
    it('renonce au bout de 5 s et laisse le cache prendre le relais', async () => {
        vi.useFakeTimers();
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(ann({ texte: 'Cache lent.' })));
        const fetchFn = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        const p = refreshAnnouncement({ fetchFn: fetchFn as typeof fetch, now, storage: localStorage });
        await vi.advanceTimersByTimeAsync(5000);
        await p;
        expect(bannerText()).toBe('Cache lent.');
    });

    it('sans cache, un délai dépassé n’affiche rien', async () => {
        vi.useFakeTimers();
        const fetchFn = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        const p = refreshAnnouncement({ fetchFn: fetchFn as typeof fetch, now, storage: localStorage });
        await vi.advanceTimersByTimeAsync(5000);
        await p;
        expect(bannerEl()).toBeNull();
    });
});

describe('initAnnouncement', () => {
    it('affiche le cache immédiatement puis rafraîchit', async () => {
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(ann({ texte: 'Au chargement.' })));
        const fetchFn = async (): Promise<Response> => jsonResponse(ann({ texte: 'Fraîche.' }));
        initAnnouncement({ fetchFn, now, storage: localStorage });
        expect(bannerText()).toBe('Au chargement.');
        await vi.waitFor(() => expect(bannerText()).toBe('Fraîche.'));
    });
});
