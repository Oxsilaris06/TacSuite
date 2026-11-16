/**
 * oi-autosave-indicator.test.ts — audit du 15/11 (A-AUTOSAVE-01) :
 * le badge « Enregistré » ne s'affiche qu'après une écriture réussie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
    confirmDialog: vi.fn(async () => true),
}));

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="appAutosave"></div>';
    toastSpy.mockClear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.isFormLoading = false;
    document.body.innerHTML = '';
});

describe('A-AUTOSAVE-01 : badge après écriture réelle', () => {
    it('quota plein : le badge ne dit pas Enregistré', async () => {
        await import('@oi/formulaires.js');
        const { Store } = await import('@oi/init.js');
        Store.state.formData = {} as typeof Store.state.formData;
        const realSet = localStorage.setItem.bind(localStorage);
        vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
            if (k === 'tactical_oi_data') throw new DOMException('plein', 'QuotaExceededError');
            realSet(k, v);
        });
        vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });
        window.isFormLoading = false;

        window.flushFormData();
        vi.advanceTimersByTime(400);

        const badge = document.getElementById('appAutosave');
        expect(badge?.textContent ?? '').not.toContain('Enregistré');
        expect(badge?.textContent ?? '').toContain('Non enregistré');
    });
});
