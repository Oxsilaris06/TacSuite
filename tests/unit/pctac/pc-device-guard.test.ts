/**
 * pc-device-guard.test.ts — Garde-fous d'appareil PC-Tac (décision 28/A3).
 *
 * Verrouille : la demande de persistance et son repli, la détection best-effort
 * de navigation privée (quota bas ET refus), la pastille du dock, et la mesure
 * d'horloge (seuil 2 min, avance et retard, pas d'en-tête, hors ligne).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CLOCK_TOLERANCE_MS,
    PRIVATE_MODE_QUOTA_THRESHOLD_BYTES,
    STORAGE_BADGE_ID,
    checkClock,
    detectPrivateMode,
    ensurePersistence,
    measureClockSkew,
    mountStorageBadge,
    runDeviceGuard,
    type StorageManagerLike,
} from '@pctac/device-guard.js';

interface ShownCall {
    id: string;
    message: string;
    level: string;
    dismissible?: boolean | undefined;
    actions: Array<{ label: string; onClick: () => void }>;
}

function captureShow() {
    const calls: ShownCall[] = [];
    const show = vi.fn((id: string, opts: {
        message: string;
        level: string;
        dismissible?: boolean | undefined;
        actions?: Array<{ label: string; onClick: () => void }>;
    }) => {
        calls.push({
            id,
            message: opts.message,
            level: opts.level,
            dismissible: opts.dismissible,
            actions: (opts.actions ?? []).map((a) => ({ label: a.label, onClick: a.onClick })),
        });
    });
    return { calls, show: show as never };
}

function failingFetch(): typeof fetch {
    return (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('ensurePersistence', () => {
    const sm = (persisted: boolean, persist: boolean): StorageManagerLike => ({
        persisted: async () => persisted,
        persist: async () => persist,
        estimate: async () => ({ quota: 5_000_000_000 }),
    });

    it('ne demande rien si déjà persistant', async () => {
        const state = await ensurePersistence(sm(true, false));
        expect(state).toEqual({ persisted: true, refused: false });
    });

    it('demande la persistance quand elle ne l’est pas, et la retient', async () => {
        const persist = vi.fn(async () => true);
        const state = await ensurePersistence({ persisted: async () => false, persist });
        expect(persist).toHaveBeenCalledOnce();
        expect(state).toEqual({ persisted: true, refused: false });
    });

    it('signale un refus', async () => {
        expect(await ensurePersistence(sm(false, false))).toEqual({ persisted: false, refused: true });
    });

    it('traite l’API absente comme un refus', async () => {
        expect(await ensurePersistence(null)).toEqual({ persisted: false, refused: true });
        expect(await ensurePersistence({})).toEqual({ persisted: false, refused: true });
    });

    it('ne jette jamais si l’API rejette', async () => {
        const throwing: StorageManagerLike = {
            persisted: async () => { throw new Error('boom'); },
            persist: async () => { throw new Error('boom'); },
        };
        expect(await ensurePersistence(throwing)).toEqual({ persisted: false, refused: true });
    });
});

describe('detectPrivateMode — combinaison de signaux', () => {
    it('vrai seulement si quota bas ET persistance refusée', () => {
        expect(detectPrivateMode({ quota: 1_000_000, persistRefused: true })).toBe(true);
    });

    it('faux si seul le quota est bas', () => {
        expect(detectPrivateMode({ quota: 1_000_000, persistRefused: false })).toBe(false);
    });

    it('faux si seule la persistance est refusée (quota normal ou inconnu)', () => {
        expect(detectPrivateMode({ quota: 5_000_000_000, persistRefused: true })).toBe(false);
        expect(detectPrivateMode({ quota: null, persistRefused: true })).toBe(false);
    });

    it('faux au seuil ou au-dessus, et sur un quota nul/négatif', () => {
        expect(detectPrivateMode({ quota: PRIVATE_MODE_QUOTA_THRESHOLD_BYTES, persistRefused: true })).toBe(false);
        expect(detectPrivateMode({ quota: 0, persistRefused: true })).toBe(false);
    });
});

describe('pastille du dock', () => {
    it('est injectée dans le dock et reflète l’état', () => {
        const dock = document.createElement('div');
        document.body.appendChild(dock);
        const badge = mountStorageBadge(dock, false);
        expect(badge?.dataset.persisted).toBe('false');
        expect(badge?.title).toContain('NON persistant');

        mountStorageBadge(dock, true);
        const again = dock.querySelector<HTMLElement>(`#${STORAGE_BADGE_ID}`);
        expect(again?.dataset.persisted).toBe('true');
        // Pas de doublon.
        expect(dock.querySelectorAll(`#${STORAGE_BADGE_ID}`)).toHaveLength(1);
    });

    it('ne fait rien sans dock', () => {
        expect(mountStorageBadge(null, true)).toBeNull();
    });
});

describe('runDeviceGuard — persistance et navigation privée', () => {
    it('stockage persistant : aucune alerte, pastille verte', async () => {
        const dock = document.createElement('div');
        const { calls, show } = captureShow();
        await runDeviceGuard({
            storageManager: { persisted: async () => true, persist: async () => true, estimate: async () => ({ quota: 5e9 }) },
            dock,
            show,
            fetchFn: failingFetch(),
        });
        expect(calls).toHaveLength(0);
        expect(dock.querySelector<HTMLElement>(`#${STORAGE_BADGE_ID}`)?.dataset.persisted).toBe('true');
    });

    it('persistance refusée : bandeau important + action « Exporter l’archive »', async () => {
        const dock = document.createElement('div');
        const { calls, show } = captureShow();
        const exportArchive = vi.fn(async () => true);
        await runDeviceGuard({
            storageManager: { persisted: async () => false, persist: async () => false, estimate: async () => ({ quota: 5e9 }) },
            dock,
            show,
            exportArchive,
            fetchFn: failingFetch(),
        });
        expect(dock.querySelector<HTMLElement>(`#${STORAGE_BADGE_ID}`)?.dataset.persisted).toBe('false');
        const banner = calls.find((c) => c.id === 'device-persist');
        expect(banner?.level).toBe('important');
        banner?.actions[0]?.onClick();
        expect(exportArchive).toHaveBeenCalledOnce();
    });

    it('API de stockage absente : même bandeau', async () => {
        const { calls, show } = captureShow();
        await runDeviceGuard({ storageManager: null, dock: null, show, exportArchive: async () => true, fetchFn: failingFetch() });
        expect(calls.some((c) => c.id === 'device-persist')).toBe(true);
    });

    it('navigation privée (quota bas + refus) : bandeau alerte PERMANENT', async () => {
        const { calls, show } = captureShow();
        await runDeviceGuard({
            storageManager: { persisted: async () => false, persist: async () => false, estimate: async () => ({ quota: 1_000_000 }) },
            dock: null,
            show,
            fetchFn: failingFetch(),
        });
        const banner = calls.find((c) => c.id === 'device-private');
        expect(banner?.level).toBe('alert');
        expect(banner?.dismissible).toBe(false);
        expect(banner?.message).toContain('perdu à la fermeture');
    });

    it('quota bas mais persistance accordée : pas de bandeau navigation privée', async () => {
        const { calls, show } = captureShow();
        await runDeviceGuard({
            storageManager: { persisted: async () => false, persist: async () => true, estimate: async () => ({ quota: 1_000_000 }) },
            dock: null,
            show,
            fetchFn: failingFetch(),
        });
        expect(calls.some((c) => c.id === 'device-private')).toBe(false);
    });
});

describe('mesure d’horloge', () => {
    // RTT multiple de 2 s : l'en-tête HTTP `Date` n'a qu'une précision d'une
    // seconde, on reste sur des instants entiers pour une mesure exacte.
    const RTT = 2000;
    function seqNow(values: number[]): () => number {
        let i = 0;
        return () => values[Math.min(i++, values.length - 1)] as number;
    }
    function dateFetch(serverMs: number): typeof fetch {
        return (async () => ({
            ok: true,
            headers: { get: (name: string) => (name.toLowerCase() === 'date' ? new Date(serverMs).toUTCString() : null) },
        })) as unknown as typeof fetch;
    }

    it('mesure l’écart en tenant compte de la moitié de l’aller-retour', async () => {
        const t0 = 1_000_000;
        const skew = 121_000;
        // Le serveur répond à t0 + RTT ; l'en-tête Date vaut cet instant + skew.
        const fetchFn = dateFetch(t0 + RTT / 2 + skew);
        const measured = await measureClockSkew(fetchFn, 'https://x/', seqNow([t0, t0 + RTT]));
        expect(measured).toBeCloseTo(skew, 5);
    });

    it('1 min 59 s : rien', async () => {
        const t0 = 1_000_000;
        const { calls, show } = captureShow();
        await checkClock({
            fetchFn: dateFetch(t0 + RTT / 2 + (CLOCK_TOLERANCE_MS - 1000)),
            now: seqNow([t0, t0 + RTT]),
            pageUrl: 'https://x/',
            show,
        });
        expect(calls).toHaveLength(0);
    });

    it('2 min 01 s : bandeau « important » (appareil en retard)', async () => {
        const t0 = 1_000_000;
        const { calls, show } = captureShow();
        await checkClock({
            fetchFn: dateFetch(t0 + RTT / 2 + (CLOCK_TOLERANCE_MS + 1000)),
            now: seqNow([t0, t0 + RTT]),
            pageUrl: 'https://x/',
            show,
        });
        const banner = calls.find((c) => c.id === 'device-clock');
        expect(banner?.level).toBe('important');
        expect(banner?.message).toContain('2 min');
    });

    it('2 min 01 s en avance : même bandeau', async () => {
        const t0 = 1_000_000;
        const { calls, show } = captureShow();
        await checkClock({
            fetchFn: dateFetch(t0 + RTT / 2 - (CLOCK_TOLERANCE_MS + 1000)),
            now: seqNow([t0, t0 + RTT]),
            pageUrl: 'https://x/',
            show,
        });
        expect(calls.some((c) => c.id === 'device-clock')).toBe(true);
    });

    it('sans en-tête Date : rien', async () => {
        const noDate = (async () => ({ ok: true, headers: { get: () => null } })) as unknown as typeof fetch;
        const { calls, show } = captureShow();
        await checkClock({ fetchFn: noDate, now: () => 0, pageUrl: 'https://x/', show });
        expect(calls).toHaveLength(0);
    });

    it('hors ligne (fetch rejette) : rien', async () => {
        const { calls, show } = captureShow();
        await checkClock({ fetchFn: failingFetch(), now: () => 0, pageUrl: 'https://x/', show });
        expect(calls).toHaveLength(0);
    });

    it('réponse non OK : rien', async () => {
        const notOk = (async () => ({ ok: false, headers: { get: () => new Date().toUTCString() } })) as unknown as typeof fetch;
        const { calls, show } = captureShow();
        await checkClock({ fetchFn: notOk, now: () => 0, pageUrl: 'https://x/', show });
        expect(calls).toHaveLength(0);
    });
});
