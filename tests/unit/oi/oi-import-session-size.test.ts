/**
 * oi-import-session-size.test.ts — audit du 15/11 (A-IMPORT-01) :
 * un fichier de session démesuré est refusé avant toute lecture.
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
    toastSpy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('A-IMPORT-01 : borne de taille', () => {
    it('un fichier de 2 Go est refusé avant FileReader', async () => {
        await import('@oi/formulaires.js');
        const read = vi.spyOn(FileReader.prototype, 'readAsText');
        const file = { name: 'session.json', size: 2 * 1024 * 1024 * 1024 } as unknown as File;

        window.importSession(file);

        expect(read).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/trop volumineux|20 Mo/i), expect.anything());
    });
});
