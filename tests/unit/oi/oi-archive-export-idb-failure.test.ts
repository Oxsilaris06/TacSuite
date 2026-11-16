/**
 * oi-archive-export-idb-failure.test.ts — audit du 15/11 (A-ARC-05) :
 * un export dont la base d'images est illisible ne doit pas produire une
 * archive annoncée complète, avec des références vers des blobs absents.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
    confirmDialog: vi.fn(async () => true),
}));

beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    toastSpy.mockClear();
});

afterEach(() => {
    window.isFormLoading = false;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('A-ARC-05 : export sans les photos attendues', () => {
    it('getAllKeys échoue : l’export n’annonce pas une archive complète', async () => {
        await import('@oi/formulaires.js');
        const { dbManager } = await import('@oi/init.js');
        Object.assign(dbManager, { db: {} });
        vi.spyOn(dbManager, 'getAllKeys').mockRejectedValue(new Error('base fermée'));
        vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
        vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { /* silence */ });
        let downloaded = false;
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { downloaded = true; });

        localStorage.setItem('tactical_oi_data', JSON.stringify({
            dynamic_photos: { photo_situation: [{ id: 'img_ref' }] },
        }));
        window.isFormLoading = true;

        await window.exportArchive();

        expect(downloaded).toBe(false);
        expect(toastSpy).not.toHaveBeenCalledWith(expect.stringContaining('Archive exportée'), expect.anything());
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/incomplète|manquante/i), expect.anything());
    });
});
