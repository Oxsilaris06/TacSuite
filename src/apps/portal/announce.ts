/**
 * announce.ts — Bandeau d'annonce du portail (décision 27).
 * =========================================================
 *
 * Le Gist secret `annonce.json` est le seul contenu du portail qui vient
 * d'Internet. Il est donc traité comme une donnée NON FIABLE :
 *
 *   - validé strictement avant tout affichage (longueur, niveau, expiration
 *     future bornée à 30 jours) ;
 *   - affiché dans une carte de note de version (`renderAnnouncementCard`), texte
 *     posé ligne par ligne en `textContent` — jamais
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


/** Gist secret, CORS ouvert (décision 27). Lu avec un paramètre à la minute : voir `fetchAnnouncement`. */
export const ANNOUNCE_URL =
    'https://gist.githubusercontent.com/Oxsilaris06/074ec5651eef3daa592905ea25ce76a7/raw/annonce.json';

/** Dernière annonce valide connue (affichée hors ligne). */
export const ANNOUNCE_CACHE_KEY = 'tacsuite.portal.announce';
/** Empreinte de l'annonce fermée par l'utilisateur (reste masquée tant qu'elle ne change pas). */
export const ANNOUNCE_DISMISS_KEY = 'tacsuite.portal.announce.dismissed';
/** Identifiant du bandeau (un seul : un nouvel appel remplace en place). */
export const ANNOUNCE_BANNER_ID = 'portal-announce';
/** Pastille laissée dans la barre d'état quand la carte est fermée (Nico, 09-26). */
export const ANNOUNCE_PILL_ID = 'portal-announce-pill';

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

/** Libellé de la pastille de la carte selon le niveau. */
const CHIP_LABEL: Record<AnnounceLevel, string> = {
    info: 'Nouveautés',
    important: 'Important',
    alerte: 'Alerte',
};

/**
 * Retrait de la carte : à la fin de l'animation de sortie (`animationend`,
 * voir `styles/portal.css`), avec une minuterie de secours (C6) au cas où
 * l'évènement ne vient pas (mouvement réduit sans animation, environnement
 * sans moteur d'animation).
 */
const CARD_EXIT_FALLBACK_MS = 320;

/**
 * Découpe le texte en titre, liste et paragraphes (note de version) : une
 * première ligne finie par « : » est le titre ; une ligne qui commence par
 * « • », « - » ou « – » est un point de liste ; les autres, des paragraphes.
 * Texte seul : pure mise en forme, rien n'est interprété comme HTML.
 */
export function announcementLayout(texte: string): { title: string | null; blocks: Array<{ kind: 'list'; items: string[] } | { kind: 'p'; text: string }> } {
    const lines = texte.split('\n').map((l) => l.trim()).filter(Boolean);
    let title: string | null = null;
    // C3 — un titre écrit avec une puce (« • Attention : ») perd sa puce.
    if (lines.length > 1 && /:\s*$/.test(lines[0] ?? '')) title = (lines.shift() ?? '').replace(/^[•\-–]\s*/, '').replace(/\s*:\s*$/, '');
    const blocks: Array<{ kind: 'list'; items: string[] } | { kind: 'p'; text: string }> = [];
    for (const line of lines) {
        const bullet = /^[•\-–]\s*/.exec(line);
        if (bullet) {
            const last = blocks[blocks.length - 1];
            const item = line.slice(bullet[0].length).trim();
            if (!item) continue; // C3 — un tiret oublié ne fait pas de puce vide
            if (last && last.kind === 'list') last.items.push(item);
            else blocks.push({ kind: 'list', items: [item] });
        } else {
            blocks.push({ kind: 'p', text: line });
        }
    }
    return { title, blocks };
}

function removeAnnouncementCard(animate: boolean): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(ANNOUNCE_BANNER_ID);
    if (!el) return;
    if (!animate) { el.remove(); return; }
    // C5 — le focus quitte la carte AVANT qu'elle soit masquée : sinon un
    // élément focalisé se retrouve sous aria-hidden, puis le focus tombe sur
    // <body> et la tabulation repart du haut de la page.
    if (el.contains(document.activeElement)) {
        const main = document.querySelector<HTMLElement>('main');
        if (main) {
            if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
            try { main.focus({ preventScroll: true }); } catch { /* environnement sans focus */ }
        } else {
            (document.activeElement as HTMLElement | null)?.blur?.();
        }
    }
    // Sortie par le même chemin que l'entrée (fondu, léger retrait), puis retrait.
    el.dataset.closing = 'true';
    el.setAttribute('aria-hidden', 'true');
    const done = (): void => { el.remove(); };
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, CARD_EXIT_FALLBACK_MS);
}

function removeAnnouncementPill(): void {
    if (typeof document === 'undefined') return;
    document.getElementById(ANNOUNCE_PILL_ID)?.remove();
}

/** Retire carte et pastille : annonce expirée, retirée ou invalide. */
function clearAnnouncement(): void {
    removeAnnouncementCard(false);
    removeAnnouncementPill();
}

/**
 * Carte fermée : seule reste la pastille du niveau (« Nouveautés »…), à côté
 * de « En ligne ». Un clic rouvre la carte.
 */
function renderAnnouncementPill(a: Announcement, onOpen: () => void): void {
    if (typeof document === 'undefined') return;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = ANNOUNCE_PILL_ID;
    pill.className = 'release-pill';
    pill.dataset.level = a.niveau;
    pill.setAttribute('aria-label', `Afficher l’annonce : ${CHIP_LABEL[a.niveau]}`);
    pill.textContent = CHIP_LABEL[a.niveau];
    pill.addEventListener('click', onOpen);
    const previous = document.getElementById(ANNOUNCE_PILL_ID);
    if (previous) { previous.replaceWith(pill); return; }
    const status = document.querySelector('.portal-status');
    if (status) status.prepend(pill);
    else document.body.prepend(pill);
}

/**
 * Carte de note de version (variante A choisie par Nico le 09-25) : même
 * grammaire que les cartes d'application du portail, placée dans la colonne
 * sous l'en-tête. DOM construit à la main, texte en `textContent`.
 */
function renderAnnouncementCard(a: Announcement, onDismiss: () => void): void {
    if (typeof document === 'undefined') return;
    const previous = document.getElementById(ANNOUNCE_BANNER_ID);
    const card = document.createElement('section');
    card.id = ANNOUNCE_BANNER_ID;
    card.className = 'release-card';
    card.dataset.level = a.niveau;
    card.setAttribute('role', a.niveau === 'alerte' ? 'alert' : 'status');

    const head = document.createElement('div');
    head.className = 'release-card__head';
    const chip = document.createElement('span');
    chip.className = 'release-card__chip';
    chip.textContent = CHIP_LABEL[a.niveau];
    head.appendChild(chip);

    const { title, blocks } = announcementLayout(a.texte);
    if (title) {
        const h = document.createElement('h2');
        h.className = 'release-card__title';
        h.id = `${ANNOUNCE_BANNER_ID}-title`;
        h.textContent = title;
        head.appendChild(h);
        card.setAttribute('aria-labelledby', h.id);
    } else {
        card.setAttribute('aria-label', CHIP_LABEL[a.niveau]);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'release-card__close';
    close.setAttribute('aria-label', 'Masquer l’annonce');
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    svg.appendChild(path);
    close.appendChild(svg);
    close.addEventListener('click', () => {
        removeAnnouncementCard(true);
        try {
            onDismiss();
        } catch {
            // Un raccord en échec ne doit jamais remonter jusqu'à l'utilisateur.
        }
    });

    const body = document.createElement('div');
    body.className = 'release-card__body';
    for (const block of blocks) {
        if (block.kind === 'p') {
            const p = document.createElement('p');
            p.textContent = block.text;
            body.appendChild(p);
        } else {
            const ul = document.createElement('ul');
            ul.className = 'release-card__list';
            for (const item of block.items) {
                const li = document.createElement('li');
                li.textContent = item;
                ul.appendChild(li);
            }
            body.appendChild(ul);
        }
    }

    // C4 — ordre de lecture : pastille, titre, corps, puis le bouton qui
    // masque (la grille CSS le place en haut à droite quoi qu'il en soit).
    card.append(head, body, close);
    card.dataset.fp = fingerprint(a);
    if (previous) {
        // Annonce différente déjà affichée : remplacée en place.
        previous.replaceWith(card);
        return;
    }
    const header = document.querySelector('.portal-header');
    if (header) header.after(card);
    else document.body.prepend(card);
}

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

function eraseDismissed(storage: AnnounceStorage | null): void {
    if (!storage) return;
    try {
        storage.removeItem(ANNOUNCE_DISMISS_KEY);
    } catch {
        /* ignore */
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
    const showPill = (): void => renderAnnouncementPill(a, () => {
        eraseDismissed(storage);
        removeAnnouncementPill();
        renderAnnouncementCard(a, dismiss);
        const card = document.getElementById(ANNOUNCE_BANNER_ID);
        if (card) {
            card.setAttribute('tabindex', '-1');
            try { card.focus({ preventScroll: true }); } catch { /* environnement sans focus */ }
        }
    });
    const dismiss = (): void => {
        writeDismissed(storage, fp);
        showPill();
    };
    if (readDismissed(storage) === fp) {
        removeAnnouncementCard(false);
        showPill();
        return;
    }
    removeAnnouncementPill();
    // C1 — même annonce déjà à l'écran (cache puis réseau, évènement `online`) :
    // rien à reconstruire, l'entrée animée n'est pas coupée et un lecteur
    // d'écran n'entend pas l'alerte une seconde fois.
    const shown = typeof document === 'undefined' ? null : document.getElementById(ANNOUNCE_BANNER_ID);
    if (shown && shown.dataset.fp === fp && shown.dataset.closing !== 'true') return;
    renderAnnouncementCard(a, dismiss);
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
        clearAnnouncement();
        return;
    }
    applyAnnouncement(fresh, opts);
}

type FetchOutcome = { kind: 'valid'; ann: Announcement } | { kind: 'invalid' } | { kind: 'failure' };

async function fetchAnnouncement(fetchFn: typeof fetch, nowMs: number): Promise<FetchOutcome> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
    try {
        // Le CDN de GitHub garde la version brute jusqu'à 5 min, nœud par nœud
        // (essai réel du 09-25 : ancienne annonce servie après publication). Un
        // paramètre qui change chaque minute force un contenu frais en moins
        // d'une minute, et laisse le CDN mettre en cache le reste du temps.
        const res = await fetchFn(`${ANNOUNCE_URL}?v=${Math.floor(nowMs / 60_000)}`, {
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
        clearAnnouncement();
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
