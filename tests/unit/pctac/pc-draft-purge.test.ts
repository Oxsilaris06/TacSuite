/**
 * pc-draft-purge.test.ts — Photos de brouillon effacées au RESET (revue finale,
 * F14, décision 33 « effacée avec le brouillon »). Un blob de photo de personne
 * dont le créneau de brouillon a disparu (effacement non attendu, onglet fermé
 * aussitôt) survivait au RESET, qui ne listait que les créneaux présents.
 * Désormais : effacement par PRÉFIXE de clé, en une transaction IndexedDB.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
});
afterEach(() => {
    vi.restoreAllMocks();
});

/** Faux IndexedDB minimal : ouverture, transaction, `delete` enregistré. */
function installFakeIdb(): unknown[] {
    const deleted: unknown[] = [];
    const db = {
        objectStoreNames: { contains: () => true },
        transaction() {
            const tx: any = { objectStore: () => ({ delete: (k: unknown) => { deleted.push(k); } }) };
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
        },
    };
    (globalThis as any).indexedDB = {
        open() {
            const req: any = {};
            setTimeout(() => { req.result = db; req.onsuccess?.(); }, 0);
            return req;
        },
    };
    (globalThis as any).IDBKeyRange = { bound: (lower: string, upper: string) => ({ lower, upper }) };
    return deleted;
}

describe('photos de brouillon et RESET (F14)', () => {
    it('ImageStore.deleteByPrefix efface toute la plage de clés du préfixe, en une fois', async () => {
        const deleted = installFakeIdb();
        const { ImageStore } = await import('@pctac/image-store.js');
        await ImageStore.deleteByPrefix('pcTacFicheDraft-img:');
        expect(deleted).toEqual([{ lower: 'pcTacFicheDraft-img:', upper: 'pcTacFicheDraft-img:￿' }]);
    });

    it('préfixe vide : rien n’est effacé (jamais tout le magasin)', async () => {
        const deleted = installFakeIdb();
        const { ImageStore } = await import('@pctac/image-store.js');
        await ImageStore.deleteByPrefix('');
        expect(deleted).toEqual([]);
    });

    it('purgeDraftImages vise le préfixe des brouillons de la SITUATION courante', async () => {
        const deleteByPrefix = vi.fn(async () => {});
        vi.doMock('@pctac/image-store.js', () => ({ ImageStore: { deleteByPrefix, get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
        localStorage.setItem('pcTacMode', 'tp');
        const { purgeDraftImages } = await import('@pctac/fiche-sheet.js');
        await purgeDraftImages();
        expect(deleteByPrefix).toHaveBeenCalledWith('pcTacFicheDraft@tp-img:');
    });
});
