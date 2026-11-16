/**
 * oi-export-session-fresh.test.ts — audit du 15/11 (A-SESSION-01) :
 * l'export JSON doit contenir la dernière frappe, pas la copie débouncée.
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
    document.body.innerHTML = '<form id="oi-form"><input id="situation" value=""></form>';
    toastSpy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    window.isFormLoading = false;
    document.body.innerHTML = '';
});

describe('A-SESSION-01 : export de session', () => {
    it('la dernière frappe est dans le JSON exporté', async () => {
        await import('@oi/formulaires.js');
        const { Store } = await import('@oi/init.js');
        Store.state.formData = {} as typeof Store.state.formData;
        window.isFormLoading = false;
        const input = document.getElementById('situation') as HTMLInputElement;
        input.value = 'Dernière frappe';

        let exported: Blob | null = null;
        vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
            exported = blob as Blob;
            return 'blob:x';
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { /* silence */ });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* silence */ });

        window.exportSession();

        expect(exported).not.toBeNull();
        const data = JSON.parse(await (exported as unknown as Blob).text()) as { situation?: string };
        expect(data.situation).toBe('Dernière frappe');
    });
});
