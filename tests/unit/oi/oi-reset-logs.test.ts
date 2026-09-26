/**
 * oi-reset-logs.test.ts — audit du 26/09 (skill openai-security-threat-model) :
 * le journal de l'OI (`gstart_captured_logs`), gardé sur l'appareil, survivait
 * à la réinitialisation complète.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: vi.fn(),
    confirmDialog: vi.fn(async () => true),
}));

beforeEach(async () => {
    localStorage.clear();
    await import('@oi/formulaires.js');
    const { dbManager } = await import('@oi/init.js');
    vi.spyOn(dbManager, 'clearAllImages').mockResolvedValue();
    vi.spyOn(window, 'setTimeout').mockImplementation((() => 0) as unknown as typeof setTimeout);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('réinitialisation de l’OI', () => {
    it.each([true, false])('efface aussi le journal gardé sur l’appareil (keepPatrac=%s)', async (keepPatrac) => {
        localStorage.setItem('gstart_captured_logs', JSON.stringify(['[log] DUPONT Jean']));
        window.__capturedLogs = ['[log] DUPONT Jean'];
        await window.resetAllData(keepPatrac);
        expect(localStorage.getItem('gstart_captured_logs')).toBeNull();
        expect(window.__capturedLogs).toEqual([]);
    });
});
