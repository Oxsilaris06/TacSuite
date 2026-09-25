/**
 * announce.ts — Bandeau d'annonce du portail (décision 27).
 * =========================================================
 *
 * Le Gist secret `annonce.json` est le seul contenu du portail qui vient
 * d'Internet. Il est donc traité comme une donnée NON FIABLE :
 *
 *   - validé strictement avant tout affichage (longueur, niveau, expiration
 *     future bornée à 30 jours) ;
 *   - affiché par `showBanner`, qui pose le texte en `textContent` — jamais
 *     d'HTML, et AUCUNE action cliquable : le niveau « alerte » ne doit pas
 *     pouvoir transformer le portail en vecteur de lien ;
 *   - lu avec `cache: 'no-store'` et un délai de garde de 5 s, pour ne pas
 *     bloquer le portail sur un réseau qui traîne.
 *
 * Le service worker (`public/sw.ts`) ne route QUE le précache, les tuiles
 * cartographiques (`TILE_HOSTS`) et les polices de même origine : cette
 * requête vers `gist.githubusercontent.com` n'est interceptée par aucune
 * route et n'est donc jamais mise en cache par lui. Le `no-store` ci-dessus
 * couvre le cache HTTP du navigateur.
 *
 * Hors ligne (ou en échec réseau), la DERNIÈRE annonce valide connue reste
 * affichée jusqu'à son expiration. Une réponse lue mais invalide ou expirée
 * l'efface : mieux vaut ne rien montrer qu'une consigne périmée.
 */

import { hideBanner, showBanner } from '@shared/feedback.js';
import type { BannerLevel } from '@shared/feedback.js';

/** Gist secret, CORS ouvert, cache CDN 5 min (décision 27). */
export const ANNOUNCE_URL =
    'https://gist.githubusercontent.com/Oxsilaris06/074ec5651eef3daa592905ea25ce76a7/raw/annonce.json';

/** Dernière annonce valide connue (affichée hors ligne). */
export const ANNOUNCE_CACHE_KEY = 'tacsuite.portal.announce';
/** Empreinte de l'annonce fermée par l'utilisateur (reste masquée tant qu'elle ne change pas). */
export const ANNOUNCE_DISMISS_KEY = 'tacsuite.portal.announce.dismissed';
/** Identifiant du bandeau (un seul : un nouvel appel remplace en place). */
export const ANNOUNCE_BANNER_ID = 'portal-announce';

export const MAX_TEXT_LEN = 280;
/** Validité maximale d'une annonce : 30 jours après maintenant. */
export const MAX_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;
/** Délai de garde du `fetch` : au-delà, on renonce (le cache prend le relais). */
export const FETCH_TIMEOUT_MS = 5_000;

/** Niveaux produits par le Gist (note : « alerte », pas « alert »). */
export const ANNOUNCE_LEVELS = ['info', 'important', 'alerte'] as const;
export type AnnounceLevel = (typeof ANNOUNCE_LEVELS)[number];

export interface Announcement {
    texte: string;
    niveau: AnnounceLevel;
    expire: string;
}

/** Correspondance niveau du Gist → niveau de bandeau partagé. */
const BANNER_LEVEL: Record<AnnounceLevel, BannerLevel> = {
    info: 'info',
    important: 'important',
    alerte: 'alert',
};

/** Interface minimale de stockage (injectable en test). */
export interface AnnounceStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface AnnounceOptions {
    /** `fetch` injectable (tests, ou politique réseau particulière). */
    fetchFn?: typeof fetch;
    /** Horloge injectable (tests). */
    now?: () => number;
    /** Stockage injectable (tests) ; `null` désactive toute mémorisation. */
    storage?: AnnounceStorage | null;
}

function defaultStorage(): AnnounceStorage | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        // localStorage indisponible (mode privé, politique) : on dégrade.
        return null;
    }
}

/**
 * Vrai si `iso` porte un fuseau horaire explicite. Le format attendu est un
 * ISO 8601 AVEC fuseau ; une date nue (`2026-10-01T08:00:00`) est refusée,
 * car l'heure d'expiration doit être sans ambiguïté.
 */
export function hasTimezone(iso: string): boolean {
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
}

/**
 * Valide une valeur brute (objet désérialisé) et rend l'annonce normalisée,
 * ou `null`. Ne jette jamais. `nowMs` est l'heure courante en millisecondes.
 *
 * Règles (décision 27) : texte non vide après `trim`, 280 caractères AU PLUS
 * (au-delà : invalide, jamais tronqué), niveau connu, expiration parsable,
 * `nowMs < expire <= nowMs + 30 j`.
 */
export function parseAnnouncement(raw: unknown, nowMs: number): Announcement | null {
    const shape = parseAnnouncementShape(raw);
    if (!shape) return null;
    const expireMs = Date.parse(shape.expire);
    if (expireMs <= nowMs) return null;
    if (expireMs > nowMs + MAX_FUTURE_MS) return null;
    return shape;
}

/**
 * Valide la FORME d'une annonce (texte, niveau, expiration parsable avec
 * fuseau) SANS contrôler la fenêtre d'expiration. Sert à relire le cache :
 * c'est l'horloge courante, appliquée plus tard, qui décidera s'il est encore
 * valable. Ne jette jamais.
 */
export function parseAnnouncementShape(raw: unknown): Announcement | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;

    const texteRaw = obj.texte;
    if (typeof texteRaw !== 'string') return null;
    const texte = texteRaw.trim();
    if (texte.length === 0 || texte.length > MAX_TEXT_LEN) return null;

    const niveau = obj.niveau;
    if (typeof niveau !== 'string' || !(ANNOUNCE_LEVELS as readonly string[]).includes(niveau)) return null;

    const expire = obj.expire;
    if (typeof expire !== 'string' || !hasTimezone(expire)) return null;
    if (!Number.isFinite(Date.parse(expire))) return null;

    return { texte, niveau: niveau as AnnounceLevel, expire };
}

/** Empreinte d'une annonce : texte + niveau + expiration. */
export function fingerprint(a: Announcement): string {
    return `${a.texte}\n${a.niveau}\n${a.expire}`;
}

function readCache(storage: AnnounceStorage | null): Announcement | null {
    if (!storage) return null;
    let raw: string | null = null;
    try {
        raw = storage.getItem(ANNOUNCE_CACHE_KEY);
    } catch {
        return null;
    }
    if (raw === null) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        // Le cache n'est pas « validé » vis-à-vis de l'expiration ici : c'est
        // `parseAnnouncement` (avec l'horloge courante) qui tranche à l'affichage.
        return parseAnnouncementShape(parsed);
    } catch {
        return null;
    }
}

function writeCache(storage: AnnounceStorage | null, a: Announcement): void {
    if (!storage) return;
    try {
        storage.setItem(ANNOUNCE_CACHE_KEY, JSON.stringify(a));
    } catch {
        /* stockage indisponible : l'annonce reste valable pour la session. */
    }
}

function eraseCache(storage: AnnounceStorage | null): void {
    if (!storage) return;
    try {
        storage.removeItem(ANNOUNCE_CACHE_KEY);
    } catch {
        /* ignore */
    }
}

function readDismissed(storage: AnnounceStorage | null): string | null {
    if (!storage) return null;
    try {
        return storage.getItem(ANNOUNCE_DISMISS_KEY);
    } catch {
        return null;
    }
}

function writeDismissed(storage: AnnounceStorage | null, fp: string): void {
    if (!storage) return;
    try {
        storage.setItem(ANNOUNCE_DISMISS_KEY, fp);
    } catch {
        /* ignore */
    }
}

/**
 * Affiche (ou masque) `a` selon l'empreinte déjà fermée par l'utilisateur.
 * `dismissible` reste vrai : l'annonce est toujours fermable, et le bouton
 * × mémorise l'empreinte pour ne pas la revoir tant qu'elle ne change pas.
 */
function applyAnnouncement(a: Announcement, opts: AnnounceOptions): void {
    const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    const fp = fingerprint(a);
    if (readDismissed(storage) === fp) {
        hideBanner(ANNOUNCE_BANNER_ID);
        return;
    }
    showBanner(ANNOUNCE_BANNER_ID, {
        message: a.texte,
        level: BANNER_LEVEL[a.niveau],
        dismissible: true,
        onDismiss: () => writeDismissed(storage, fp),
    });
}

/** Affiche la dernière annonce valide connue, si elle n'est pas expirée. */
export function applyCachedAnnouncement(opts: AnnounceOptions = {}): void {
    const now = (opts.now ?? Date.now)();
    const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    const cached = readCache(storage);
    if (!cached) return;
    const fresh = parseAnnouncement(cached, now);
    if (!fresh) {
        // Expirée : on l'efface pour ne jamais la remontrer.
        eraseCache(storage);
        hideBanner(ANNOUNCE_BANNER_ID);
        return;
    }
    applyAnnouncement(fresh, opts);
}

type FetchOutcome = { kind: 'valid'; ann: Announcement } | { kind: 'invalid' } | { kind: 'failure' };

async function fetchAnnouncement(fetchFn: typeof fetch, nowMs: number): Promise<FetchOutcome> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetchFn(ANNOUNCE_URL, {
            cache: 'no-store',
            ...(controller ? { signal: controller.signal } : {}),
        });
        // Une erreur HTTP n'est PAS une annonce invalide : on garde le cache.
        if (!res || !res.ok) return { kind: 'failure' };
        let json: unknown;
        try {
            json = await res.json();
        } catch {
            return { kind: 'invalid' };
        }
        const ann = parseAnnouncement(json, nowMs);
        return ann ? { kind: 'valid', ann } : { kind: 'invalid' };
    } catch {
        // Réseau indisponible, CORS, délai dépassé (abort) : échec réseau.
        return { kind: 'failure' };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Relit l'annonce distante. Une réponse valide remplace le cache ; une
 * réponse lue mais invalide ou expirée efface cache et bandeau ; un échec
 * réseau laisse le cache prendre le relais.
 */
export async function refreshAnnouncement(opts: AnnounceOptions = {}): Promise<void> {
    const fetchFn = opts.fetchFn ?? (typeof fetch === 'function' ? fetch : null);
    const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    if (!fetchFn) {
        applyCachedAnnouncement(opts);
        return;
    }
    const now = (opts.now ?? Date.now)();
    const outcome = await fetchAnnouncement(fetchFn, now);
    if (outcome.kind === 'failure') {
        applyCachedAnnouncement(opts);
        return;
    }
    if (outcome.kind === 'invalid') {
        eraseCache(storage);
        hideBanner(ANNOUNCE_BANNER_ID);
        return;
    }
    writeCache(storage, outcome.ann);
    applyAnnouncement(outcome.ann, opts);
}

/**
 * Branche l'annonce au chargement du portail et à chaque retour en ligne.
 * Sans réseau au départ, la dernière annonce connue s'affiche tout de suite.
 */
export function initAnnouncement(opts: AnnounceOptions = {}): void {
    applyCachedAnnouncement(opts);
    void refreshAnnouncement(opts);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('online', () => {
            void refreshAnnouncement(opts);
        });
    }
}
