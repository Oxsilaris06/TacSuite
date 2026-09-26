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
    ANNOUNCE_PILL_ID,
    MAX_FUTURE_MS,
    announcementLayout,
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

/** Carte de note de version (variante A choisie par Nico le 09-25), hors sortie en cours. */
function bannerEl(): HTMLElement | null {
    return document.querySelector(`#${ANNOUNCE_BANNER_ID}:not([data-closing])`);
}

function bannerText(): string | null {
    return bannerEl()?.querySelector('.release-card__body')?.textContent ?? null;
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

describe('carte de note de version (variante A, Nico 09-25)', () => {
    const show = async (a: Announcement): Promise<void> => {
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(a), now, storage: localStorage });
    };

    it('titre tiré de la première ligne finie par « : », puces en liste', async () => {
        await show(ann({ texte: 'Mise à jour PC-Tac et OI :\n• 4 situations\n- Fiches refondues\n• OI Express' }));
        const card = bannerEl()!;
        expect(card.querySelector('.release-card__title')?.textContent).toBe('Mise à jour PC-Tac et OI');
        expect(Array.from(card.querySelectorAll('.release-card__list li')).map((li) => li.textContent)).toEqual(['4 situations', 'Fiches refondues', 'OI Express']);
        expect(card.querySelectorAll('.release-card__body p')).toHaveLength(0);
    });

    it('texte sans titre ni puce : un paragraphe, sans titre', async () => {
        await show(ann({ texte: 'Exercice demain 08h00.' }));
        expect(bannerEl()?.querySelector('.release-card__title')).toBeNull();
        expect(bannerEl()?.querySelector('.release-card__body p')?.textContent).toBe('Exercice demain 08h00.');
    });

    it('pastille selon le niveau : Nouveautés, Important, Alerte', async () => {
        await show(ann({ niveau: 'info' }));
        expect(bannerEl()?.querySelector('.release-card__chip')?.textContent).toBe('Nouveautés');
        await show(ann({ niveau: 'important', texte: 'b' }));
        expect(bannerEl()?.querySelector('.release-card__chip')?.textContent).toBe('Important');
        await show(ann({ niveau: 'alerte', texte: 'c' }));
        expect(bannerEl()?.querySelector('.release-card__chip')?.textContent).toBe('Alerte');
        expect(document.querySelectorAll(`#${ANNOUNCE_BANNER_ID}`)).toHaveLength(1);
    });

    it('placée dans la colonne, juste sous l’en-tête du portail', async () => {
        document.body.innerHTML = '<div class="portal"><header class="portal-header"></header><main></main></div>';
        await show(ann());
        expect(document.querySelector('.portal-header')?.nextElementSibling?.id).toBe(ANNOUNCE_BANNER_ID);
    });

    it('bouton de fermeture nommé ; la sortie est animée puis la carte retirée', async () => {
        vi.useFakeTimers();
        await show(ann({ texte: 'À fermer.' }));
        const btn = bannerEl()!.querySelector<HTMLButtonElement>('.release-card__close')!;
        expect(btn.getAttribute('aria-label')).toBe('Masquer l’annonce');
        btn.click();
        expect(document.getElementById(ANNOUNCE_BANNER_ID)?.dataset.closing).toBe('true');
        vi.advanceTimersByTime(400);
        expect(document.getElementById(ANNOUNCE_BANNER_ID)).toBeNull();
    });
});

describe('refreshAnnouncement — fraîcheur (essai réel du 09-25)', () => {
    it('la requête porte un paramètre qui change chaque minute (le CDN de GitHub garde sinon l’ancienne version 5 min)', async () => {
        const urls: string[] = [];
        const fetchFn = async (url: RequestInfo | URL): Promise<Response> => { urls.push(String(url)); return jsonResponse(ann()); };
        await refreshAnnouncement({ fetchFn: fetchFn as typeof fetch, now: () => NOW, storage: localStorage });
        await refreshAnnouncement({ fetchFn: fetchFn as typeof fetch, now: () => NOW + 30_000, storage: localStorage });
        await refreshAnnouncement({ fetchFn: fetchFn as typeof fetch, now: () => NOW + 61_000, storage: localStorage });
        expect(urls[0]).toMatch(/^https:\/\/gist\.githubusercontent\.com\/.+\/raw\/annonce\.json\?v=\d+$/);
        expect(urls[0]).toBe(`${urls[0]!.split('?')[0]}?v=${Math.floor(NOW / 60_000)}`);
        expect(new Set(urls).size).toBeGreaterThanOrEqual(2);
    });
});

describe('refreshAnnouncement — réponse distante', () => {
    it('affiche une annonce valide et la met en cache', async () => {
        const a = ann({ texte: 'Réunion 14h.', niveau: 'important', expire: iso(3600_000) });
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(a), now, storage: localStorage });
        expect(bannerText()).toBe('Réunion 14h.');
        expect(bannerEl()?.dataset.level).toBe('important');
        expect(JSON.parse(localStorage.getItem(ANNOUNCE_CACHE_KEY) as string)).toEqual(a);
    });

    it('mappe le niveau « alerte » sur un bandeau d’alerte', async () => {
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ niveau: 'alerte' })), now, storage: localStorage });
        expect(bannerEl()?.dataset.level).toBe('alerte');
        expect(bannerEl()?.getAttribute('role')).toBe('alert');
    });

    it('pose le texte en textContent (jamais d’HTML, aucun lien)', async () => {
        const texte = '<b>gras</b> <a href="//x">lien</a>';
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ texte })), now, storage: localStorage });
        const body = bannerEl()?.querySelector('.release-card__body');
        expect(body?.textContent).toBe(texte);
        expect(bannerEl()?.querySelector('a')).toBeNull();
        expect(bannerEl()?.querySelector('b')).toBeNull();
        // Seul bouton : masquer.
        expect(bannerEl()?.querySelectorAll('button')).toHaveLength(1);
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
        const btn = bannerEl()?.querySelector<HTMLButtonElement>('.release-card__close');
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

describe('pastille après fermeture (Nico 09-26)', () => {
    const pill = (): HTMLButtonElement | null => document.getElementById(ANNOUNCE_PILL_ID) as HTMLButtonElement | null;
    const dismiss = (): void => {
        bannerEl()?.querySelector<HTMLButtonElement>('.release-card__close')?.click();
    };
    const header = (): void => {
        document.body.innerHTML = '<header class="portal-header"><div class="portal-status"><span id="net-status"></span></div></header>';
    };

    it('fermer la carte laisse une pastille du niveau dans la barre d’état', async () => {
        header();
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ niveau: 'important' })), now, storage: localStorage });
        expect(pill()).toBeNull();
        dismiss();
        expect(bannerEl()).toBeNull();
        expect(pill()?.textContent).toBe('Important');
        expect(pill()?.dataset.level).toBe('important');
        expect(pill()?.tagName).toBe('BUTTON');
        expect(pill()?.parentElement?.classList.contains('portal-status')).toBe(true);
    });

    it('au rechargement, une annonce déjà fermée montre la pastille seule', () => {
        const a = ann();
        localStorage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(a));
        localStorage.setItem(ANNOUNCE_DISMISS_KEY, fingerprint(a));
        applyCachedAnnouncement({ now, storage: localStorage });
        expect(bannerEl()).toBeNull();
        expect(pill()?.textContent).toBe('Nouveautés');
    });

    it('un clic sur la pastille rouvre la carte et oublie la fermeture', async () => {
        header();
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ texte: 'Rouvrable.' })), now, storage: localStorage });
        dismiss();
        pill()!.click();
        expect(bannerText()).toBe('Rouvrable.');
        expect(pill()).toBeNull();
        expect(localStorage.getItem(ANNOUNCE_DISMISS_KEY)).toBeNull();
    });

    it('une annonce retirée ou expirée efface aussi la pastille', async () => {
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann()), now, storage: localStorage });
        dismiss();
        expect(pill()).not.toBeNull();
        await refreshAnnouncement({ fetchFn: async () => jsonResponse({ texte: '' }), now, storage: localStorage });
        expect(pill()).toBeNull();
    });

    it('une nouvelle annonce remplace la pastille par sa carte', async () => {
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ texte: 'Première.' })), now, storage: localStorage });
        dismiss();
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(ann({ texte: 'Deuxième.' })), now, storage: localStorage });
        expect(bannerText()).toBe('Deuxième.');
        expect(pill()).toBeNull();
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

describe('Revue du 25/09 — carte : réemploi, mise en page, ordre du DOM, focus, sortie (C1 à C6)', () => {
    const show = async (a: Announcement): Promise<void> => {
        await refreshAnnouncement({ fetchFn: async () => jsonResponse(a), now, storage: localStorage });
    };

    it('C1 : la même annonce reçue de nouveau ne reconstruit pas la carte', async () => {
        await show(ann({ texte: 'Stable.' }));
        const first = bannerEl();
        await show(ann({ texte: 'Stable.' }));
        expect(bannerEl()).toBe(first);
        expect(document.querySelectorAll(`#${ANNOUNCE_BANNER_ID}`)).toHaveLength(1);
    });

    it('C1 : une annonce différente remplace la carte (nouvel élément)', async () => {
        await show(ann({ texte: 'Une.' }));
        const first = bannerEl();
        await show(ann({ texte: 'Deux.' }));
        expect(bannerEl()).not.toBe(first);
        expect(bannerText()).toContain('Deux.');
    });

    it('C3 : une ligne réduite à un tiret ne fait pas de puce vide ; un titre à puce perd sa puce', () => {
        expect(announcementLayout('Nouveautés :\n• a\n-\n• b')).toEqual({ title: 'Nouveautés', blocks: [{ kind: 'list', items: ['a', 'b'] }] });
        expect(announcementLayout('• Attention :\n• x').title).toBe('Attention');
    });

    it('C4 : le bouton de fermeture vient APRÈS le corps dans le DOM (ordre de lecture)', async () => {
        await show(ann({ texte: 'Ordre.' }));
        const card = bannerEl()!;
        const body = card.querySelector('.release-card__body')!;
        const close = card.querySelector('.release-card__close')!;
        expect(body.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('C5 : à la fermeture, le focus quitte la carte avant qu’elle soit masquée', async () => {
        document.body.innerHTML = '<div class="portal"><header class="portal-header"></header><main></main></div>';
        await show(ann({ texte: 'Focus.' }));
        const btn = bannerEl()!.querySelector<HTMLButtonElement>('.release-card__close')!;
        btn.focus();
        btn.click();
        const card = document.getElementById(ANNOUNCE_BANNER_ID)!;
        expect(card.getAttribute('aria-hidden')).toBe('true');
        expect(card.contains(document.activeElement)).toBe(false);
        expect(document.activeElement).toBe(document.querySelector('main'));
    });

    it('C6 : la fin de l’animation retire la carte sans attendre la minuterie de secours', async () => {
        vi.useFakeTimers();
        await show(ann({ texte: 'Sortie.' }));
        bannerEl()!.querySelector<HTMLButtonElement>('.release-card__close')!.click();
        const card = document.getElementById(ANNOUNCE_BANNER_ID)!;
        card.dispatchEvent(new Event('animationend'));
        expect(document.getElementById(ANNOUNCE_BANNER_ID)).toBeNull();
    });
});
