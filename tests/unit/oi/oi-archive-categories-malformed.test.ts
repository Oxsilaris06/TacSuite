/**
 * oi-archive-categories-malformed.test.ts — audit du 15/11 (A-ARC-04) :
 * une archive au JSON valide mais aux listes mal typées doit produire un
 * message d'erreur, pas un rejet non géré.
 */
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
    confirmDialog: vi.fn(async () => true),
}));

beforeEach(() => {
    document.body.innerHTML = '<dialog id="importSelectModal"><div id="importSelectList"></div>'
        + '<input id="importSelectAll" type="checkbox"><button id="importSelectConfirmBtn"></button></dialog>';
    localStorage.clear();
    toastSpy.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

async function malformedArchive(): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ appName: 'OI', version: 1 }));
    zip.file('data.json', JSON.stringify({
        tactical_oi_data: JSON.stringify({ patracdvr_rows: 5 }),
    }));
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'x.oi.zip');
}

describe('A-ARC-04 : listes mal typées', () => {
    it('patracdvr_rows numérique : message d’erreur, pas de rejet non géré', async () => {
        await import('@oi/formulaires.js');
        vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });

        await expect(window.importArchive(await malformedArchive())).resolves.toBeUndefined();

        expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/archive invalide/i), expect.anything());
    });
});
