/**
 * oi-reset-partial-failure.test.ts — audit du 15/11 (A-RESET-01) : si la purge
 * IndexedDB rejette, la réinitialisation ne doit ni vider localStorage ni
 * laisser l'autosave mort (`isFormLoading` vrai).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
    confirmDialog: vi.fn(async () => true),
}));

const KEY = 'tactical_oi_data';

beforeEach(async () => {
    document.body.innerHTML = `
        <form id="oi-form"><input id="situation" type="text"></form>
        <dialog id="resetOptionsModal"></dialog>
        <div id="time_events_container"></div><div id="adversaries_container"></div>
        <div id="hypotheses_container"></div><div id="moicp_container"></div>
        <div id="zmspcp_container"></div><div id="effraction_container"></div>
        <div id="unassigned_members_container"></div><div id="patracdvr_container"></div>
    `;
    localStorage.clear();
    toastSpy.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('@oi/formulaires.js');
});

afterEach(async () => {
    const { dbManager } = await import('@oi/init.js');
    Object.assign(dbManager, { db: null });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('resetAllData — purge IndexedDB en échec', () => {
    it('clearAllImages rejette : localStorage et isFormLoading restent cohérents', async () => {
        localStorage.setItem(KEY, JSON.stringify({ situation: 'à conserver' }));
        const { dbManager } = await import('@oi/init.js');
        Object.assign(dbManager, { db: {} });
        vi.spyOn(dbManager, 'clearAllImages').mockRejectedValue(new Error('transaction avortée'));

        await window.resetAllData(true);

        expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ situation: 'à conserver' }));
        expect(window.isFormLoading).toBe(false);
        expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('Réinitialisation impossible'), expect.objectContaining({ kind: 'error' }));
    });
});
