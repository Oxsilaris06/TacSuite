/**
 * oi-persist-startup.test.ts — l'OI demande la persistance du stockage.
 *
 * Verrouille : la persistance vaut pour toute l'origine, donc l'OI la demande
 * au démarrage comme le fait PC-Tac (décision 28).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initStorageGuard } from '@oi/init.js';

beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
});

describe('initStorageGuard — démarrage de l’OI', () => {
    it('demande persist() quand le stockage n’est pas persistant', async () => {
        const persist = vi.fn(async () => true);
        initStorageGuard({
            storageManager: { persisted: async () => false, persist },
            show: vi.fn() as never,
            dock: null,
            exportArchive: vi.fn(),
        });
        await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    });
});
