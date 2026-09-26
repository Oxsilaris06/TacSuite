/**
 * oi-xss-archive-ids.test.ts — revue adversariale neuve (2026-09-26) : des
 * identifiants et valeurs venus d'une archive .oi.zip forgée atteignaient des
 * gestionnaires en ligne (`onclick`) ou du HTML sans échappement.
 *
 * Chaque charge est bénigne : elle ne fait que poser `window.__oiXss`.
 */
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastSpy, reencodeSpy } = vi.hoisted(() => ({
    toastSpy: vi.fn(),
    reencodeSpy: vi.fn(async (b: Blob): Promise<Blob> => b),
}));
vi.mock('@shared/feedback.js', async (orig) => ({
    ...(await orig<typeof import('@shared/feedback.js')>()),
    toast: toastSpy,
    confirmDialog: vi.fn(async () => true),
}));
vi.mock('@oi/outils.js', async (orig) => ({
    ...(await orig<typeof import('@oi/outils.js')>()),
    reencodeSansExif: reencodeSpy,
}));

const EVIL_ID = `x');window.__oiXss=1;('`;

/** Aucun gestionnaire en ligne ne porte la charge, aucun élément injecté. */
function expectNoInjection(): void {
    expect(document.body.querySelector('img:not(.image-preview)')).toBeNull();
    const inline = Array.from(document.body.querySelectorAll('*'))
        .flatMap((el) => Array.from(el.attributes).filter((a) => a.name.startsWith('on')).map((a) => a.value))
        .join('\n');
    expect(inline).not.toContain('__oiXss');
}

function stubCrossModuleWindow(): void {
    window.initializePatracdvr = vi.fn();
    window.updateArticulationDisplay = vi.fn();
    window.addMoicp = vi.fn();
    window.addZmspcp = vi.fn();
    window.addEffraction = vi.fn();
    window.refreshRameVL = vi.fn();
    window.refreshColonneProgression = vi.fn();
    window.refreshOrdrePenetration = vi.fn();
    window.syncAllThumbnails = vi.fn();
    window.updateCustomBgPreview = vi.fn(async () => { /* stub */ });
}

beforeEach(() => {
    document.body.innerHTML = `
        <div id="adversaries_container"></div><div id="time_events_container"></div>
        <div id="hypotheses_container"></div><div id="photo_situation" class="image-preview-container"></div>
        <dialog id="importSelectModal"><div id="importSelectList"></div>
            <input id="importSelectAll" type="checkbox"><button id="importSelectConfirmBtn"></button></dialog>`;
    localStorage.clear();
    Reflect.deleteProperty(window, '__oiXss');
    toastSpy.mockClear();
    reencodeSpy.mockClear();
});
afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('SEC-1 — identifiant de photo restaurée', () => {
    it('loadFormData écarte une photo dont l’id n’a pas une forme sûre, aucun onclick ne porte l’id', async () => {
        await import('@oi/formulaires.js');
        const { dbManager } = await import('@oi/init.js');
        stubCrossModuleWindow();
        vi.spyOn(dbManager, 'getItem').mockImplementation(async () => new Blob(['x'], { type: 'image/jpeg' }));
        localStorage.setItem('tactical_oi_data', JSON.stringify({
            dynamic_photos: { photo_situation: [{ id: EVIL_ID }, { id: 'img_ok_1' }] },
        }));

        await window.loadFormData();

        expectNoInjection();
        const ids = Array.from(document.querySelectorAll('#photo_situation .image-preview')).map((i) => i.id);
        expect(ids).toEqual(['img_ok_1']);
        // Les boutons retrouvent l’id par le DOM, jamais par interpolation.
        const onclicks = Array.from(document.querySelectorAll('#photo_situation [onclick]')).map((b) => b.getAttribute('onclick') ?? '');
        expect(onclicks.join('\n')).not.toContain('img_ok_1');
    });

    it('import d’archive : image et référence de photo à id forgé ignorées', async () => {
        await import('@oi/formulaires.js');
        const { dbManager } = await import('@oi/init.js');
        const stored: string[] = [];
        Object.assign(dbManager, { db: {} });
        vi.spyOn(dbManager, 'clearAllImages').mockResolvedValue();
        vi.spyOn(dbManager, 'getAllKeys').mockResolvedValue([]);
        vi.spyOn(dbManager, 'putItem').mockImplementation(async (k: string) => { stored.push(k); });
        vi.spyOn(window, 'setTimeout').mockImplementation((() => 0) as unknown as typeof setTimeout);

        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({ appName: 'OI', version: 1 }));
        zip.file('data.json', JSON.stringify({
            tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_situation: [{ id: EVIL_ID }, { id: 'img_ok_1' }] } }),
        }));
        zip.folder('images')!.file(encodeURIComponent(EVIL_ID) + '.bin', new Uint8Array([1]));
        zip.folder('images')!.file('img_ok_1.bin', new Uint8Array([1]));
        const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'x.oi.zip');

        const done = window.importArchive(file);
        await vi.waitFor(() => expect(document.querySelectorAll('.import-cat-cb').length).toBeGreaterThan(0));
        document.getElementById('importSelectConfirmBtn')!.click();
        await done;

        expect(stored).toEqual(['img_ok_1']);
        const saved = JSON.parse(localStorage.getItem('tactical_oi_data') ?? '{}') as { dynamic_photos?: Record<string, { id: string }[]> };
        expect(saved.dynamic_photos?.photo_situation?.map((p) => p.id)).toEqual(['img_ok_1']);
        Object.assign(dbManager, { db: null });
    });
});

describe('SEC-2 — fiche adversaire rechargée', () => {
    it('addAdversary : id forgé remplacé, date de naissance échappée, aucun onclick piégé', async () => {
        await import('@oi/formulaires.js');
        window.addAdversary({ id: EVIL_ID, nom_adversaire: 'X', date_naissance: '"><img src=x onerror="window.__oiXss=1">', me_list: ['a'] } as never);

        expectNoInjection();
        const entry = document.querySelector<HTMLElement>('.adversary-entry')!;
        expect(entry.id).toMatch(/^[\w-]{1,128}$/);
        expect(document.querySelector<HTMLInputElement>('[data-field="date_naissance"]')!.getAttribute('value'))
            .toBe('"><img src=x onerror="window.__oiXss=1">');
        // La liste ME de la fiche suit l'id assaini.
        expect(document.querySelectorAll(`#me_${entry.id} .me-input`).length).toBe(1);
    });

    it('addAdversary garde un id sûr tel quel (rechargement fidèle)', async () => {
        await import('@oi/formulaires.js');
        window.addAdversary({ id: 'adv_1', nom_adversaire: 'X' } as never);
        expect(document.querySelector('.adversary-entry')!.id).toBe('adv_1');
    });
});

describe('SEC-3 — cibles du déplacement groupé du PATRACDVR', () => {
    it('le nom du véhicule est posé comme du texte', async () => {
        const TAG = '<img src=x onerror="window.__oiXss=1">';
        document.body.innerHTML = `<div id="patracdvr_container"></div><div id="unassigned_members_container"></div>
            <div id="rame_vl_container"></div><div id="patracBatchTargets" style="display:none"></div>`;
        await import('@oi/articulation.js');
        await import('@oi/patrac.js');
        window.addPatracdvrRow(TAG, [{ trigramme: 'ABC', cellule: 'India 1', fonction: 'Chef', dir: '' }]);
        window.togglePatracBatchMode(true);
        document.querySelector<HTMLElement>('.patracdvr-member-btn')!.click();

        window.patracBatchShowTargets();

        const wrap = document.getElementById('patracBatchTargets')!;
        expect(wrap.querySelector('img')).toBeNull();
        expect(wrap.querySelector('.patrac-batch-target-btn')!.textContent).toContain(TAG);
        window.togglePatracBatchMode(false);
    });
});

describe('R7 — image importée sans nettoyage des métadonnées', () => {
    it('le nombre d’images gardées brutes est dit à l’utilisateur', async () => {
        await import('@oi/formulaires.js');
        const { dbManager } = await import('@oi/init.js');
        Object.assign(dbManager, { db: {} });
        vi.spyOn(dbManager, 'clearAllImages').mockResolvedValue();
        vi.spyOn(dbManager, 'getAllKeys').mockResolvedValue([]);
        vi.spyOn(dbManager, 'putItem').mockResolvedValue();
        vi.spyOn(window, 'setTimeout').mockImplementation((() => 0) as unknown as typeof setTimeout);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        reencodeSpy.mockRejectedValueOnce(new Error('canvas indisponible'));

        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify({ appName: 'OI', version: 1 }));
        zip.file('data.json', JSON.stringify({
            tactical_oi_data: JSON.stringify({ dynamic_photos: { photo_situation: [{ id: 'img_a' }, { id: 'img_b' }] } }),
        }));
        zip.folder('images')!.file('img_a.bin', new Uint8Array([1]));
        zip.folder('images')!.file('img_b.bin', new Uint8Array([1]));
        const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'x.oi.zip');

        const done = window.importArchive(file);
        await vi.waitFor(() => expect(document.querySelectorAll('.import-cat-cb').length).toBeGreaterThan(0));
        document.getElementById('importSelectConfirmBtn')!.click();
        await done;

        expect(toastSpy).toHaveBeenCalledWith(
            expect.stringContaining('1 image(s) importée(s) sans nettoyage des métadonnées (position possible)'),
            expect.anything(),
        );
        Object.assign(dbManager, { db: null });
    });
});
