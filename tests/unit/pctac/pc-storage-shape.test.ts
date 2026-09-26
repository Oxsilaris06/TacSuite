/**
 * pc-storage-shape.test.ts — revue de sécurité côté client du 2026-09-26, C-3.
 *
 * Une archive forgée (import en remplacement) ou une simple corruption
 * pouvait poser `pcTacLogData = [null]` ou `pcTacLieuHistory = [42]` : au
 * démarrage, le rendu du journal levait, et l'onglet, l'export et le RESET
 * n'étaient jamais câblés (coffre « mort »). Les lecteurs partagés du
 * stockage ne rendent plus que des éléments de la bonne forme.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        put: async (): Promise<void> => {}, get: async (): Promise<string | null> => null,
        getMany: async (): Promise<Record<string, string | null>> => ({}), delete: async (): Promise<void> => {},
        deleteMany: async (): Promise<void> => {}, clear: async (): Promise<void> => {},
        migrateFromLocalStorage: async (): Promise<void> => {}, hydrate: async <T,>(items: T[]): Promise<T[]> => items,
    },
}));

beforeEach(() => { localStorage.clear(); vi.resetModules(); });

describe('lecteurs du stockage : éléments de la bonne forme seulement', () => {
    it('loadLogData ignore les entrées qui ne sont pas des objets', async () => {
        localStorage.setItem('pcTacLogData', JSON.stringify([null, 42, 'x', [1], { id: 'a', heure: '08:00', pax: 'Otage', remarques: 'ok' }]));
        const { Storage } = await import('@pctac/storage.js');
        expect(Storage.loadLogData().map((e) => e.id)).toEqual(['a']);
    });

    it('loadCollection ignore les éléments qui ne sont pas des objets', async () => {
        localStorage.setItem('pcTacAdversaries', JSON.stringify([null, { id: 'b', nom: 'DURAND' }, 7]));
        const { Storage } = await import('@pctac/storage.js');
        expect(Storage.loadCollection('pcTacAdversaries').map((e) => e.id)).toEqual(['b']);
    });

    it('getLieuHistory ne rend que des chaînes', async () => {
        localStorage.setItem('pcTacLieuHistory', JSON.stringify([42, null, 'Garage', { x: 1 }]));
        const { LogManager } = await import('@pctac/log-manager.js');
        expect(LogManager.getLieuHistory()).toEqual(['Garage']);
    });

    it('le journal se rend malgré une entrée nulle (plus de démarrage bloqué)', async () => {
        document.body.innerHTML = '<table><tbody id="logTableBody"></tbody></table><datalist id="lieu_suggestions"></datalist>';
        localStorage.setItem('pcTacLogData', JSON.stringify([null, { id: 'a', heure: '08:00', pax: 'Otage', paxMode: 'standard', remarques: 'ok' }]));
        localStorage.setItem('pcTacLieuHistory', JSON.stringify([42, 'Garage']));
        const { Storage } = await import('@pctac/storage.js');
        const { UI } = await import('@pctac/ui.js');
        expect(() => UI.renderLogTable(Storage.loadLogData())).not.toThrow();
        expect(() => UI.refreshLieuSuggestions()).not.toThrow();
    });
});
