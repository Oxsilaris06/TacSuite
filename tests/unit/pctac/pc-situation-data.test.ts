/**
 * pc-situation-data.test.ts — Remplissage d'une situation et confirmation de
 * changement (décision 28/A4).
 *
 * Une situation vide se quitte sans question ; une situation qui porte des
 * fiches, de la main courante, des photos ou un plan demande confirmation en
 * nommant ce qu'elle contient. Les comptes sont par situation (cloisonnement).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, LOCAL_STORAGE_KEY, PHOTOS_KEY } from '@pctac/config.js';
import { GPX_INDEX_KEY, PINS_KEY, SHAPES_KEY } from '@pctac/planmap/constants.js';
import { PCTAC_MODE_KEY, currentModeId, scopedKey } from '@pctac/modes.js';
import { describeSituationData, hasSituationData, situationData } from '@pctac/storage.js';

const confirmSpy = vi.hoisted(() => vi.fn<(_opts?: { message?: string }) => Promise<boolean>>(async () => true));
vi.mock('@shared/feedback.js', () => ({
    confirmDialog: confirmSpy,
    toast: vi.fn(),
    showBanner: vi.fn(),
    hideBanner: vi.fn(),
}));

const { setMode } = await import('@pctac/mode-ui.js');

function seed(key: string, value: unknown, mode = 'forcene'): void {
    localStorage.setItem(scopedKey(key, mode as 'forcene'), JSON.stringify(value));
}

beforeEach(() => {
    localStorage.clear();
    confirmSpy.mockClear();
    confirmSpy.mockResolvedValue(true);
    document.body.innerHTML = '';
});

describe('situationData', () => {
    it('compte une situation vide à zéro', () => {
        const counts = situationData();
        expect(counts).toEqual({ fiches: 0, journal: 0, photos: 0, plan: false });
        expect(hasSituationData(counts)).toBe(false);
        expect(describeSituationData(counts)).toBe('');
    });

    it('compte fiches, main courante, photos et plan', () => {
        seed(ADVERSARIES_KEY, [{ id: 'a1' }, { id: 'a2' }]);
        seed(HOSTAGES_KEY, [{ id: 'h1' }]);
        seed(FRIENDS_KEY, []);
        seed(LOCAL_STORAGE_KEY, [{ id: 'l1' }]);
        seed(PHOTOS_KEY, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
        seed(PINS_KEY, [{ id: 'pin1' }]);
        const counts = situationData();
        expect(counts).toEqual({ fiches: 3, journal: 1, photos: 3, plan: true });
        expect(hasSituationData(counts)).toBe(true);
        expect(describeSituationData(counts)).toBe('3 fiches, 1 entrée de main courante, 3 photos, un plan');
    });

    it('un plan seul (dessin) suffit', () => {
        seed(SHAPES_KEY, [{ id: 's1' }]);
        expect(hasSituationData(situationData())).toBe(true);
    });

    it('cloisonne par situation : les données de TP ne comptent pas pour Forcené', () => {
        seed(ADVERSARIES_KEY, [{ id: 'a1' }], 'tp');
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        expect(hasSituationData(situationData())).toBe(false);
        expect(hasSituationData(situationData('tp'))).toBe(true);
    });

    it('singularise au bon nombre', () => {
        expect(describeSituationData({ fiches: 1, journal: 1, photos: 1, plan: false }))
            .toBe('1 fiche, 1 entrée de main courante, 1 photo');
    });

    it('ignore les clés de plan sans rapport (index GPX)', () => {
        seed(GPX_INDEX_KEY, [{ id: 'g1' }]);
        expect(hasSituationData(situationData())).toBe(false);
    });
});

describe('setMode — confirmation', () => {
    function reducedMotion(): void {
        window.matchMedia = vi.fn().mockReturnValue({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }) as unknown as typeof window.matchMedia;
    }

    it('ne demande rien pour une situation vide', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        reducedMotion();
        setMode('tp');
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(currentModeId()).toBe('tp');
    });

    it('demande confirmation et nomme le contenu quand il y en a', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        seed(ADVERSARIES_KEY, [{ id: 'a1' }, { id: 'a2' }]);
        seed(LOCAL_STORAGE_KEY, [{ id: 'l1' }]);
        reducedMotion();

        setMode('tp');
        await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledOnce());
        const opts = confirmSpy.mock.calls[0]?.[0] as { message: string };
        expect(opts.message).toContain('2 fiches');
        expect(opts.message).toContain('1 entrée de main courante');
        expect(opts.message).toContain('restent enregistrées');
        expect(currentModeId()).toBe('tp');
    });

    it('ne change pas de situation si l’opérateur renonce, et rétablit le sélecteur', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        seed(ADVERSARIES_KEY, [{ id: 'a1' }]);
        document.body.innerHTML = `<div id="modeSelector">
            <span class="mode-selector-current"><span class="material-symbols-outlined">x</span></span>
            <select class="mode-selector-select"><option value="forcene">Forcené</option><option value="tp">TP</option></select>
        </div>`;
        const select = document.querySelector<HTMLSelectElement>('.mode-selector-select')!;
        select.value = 'tp';
        confirmSpy.mockResolvedValue(false);
        reducedMotion();

        setMode('tp');
        await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledOnce());
        expect(currentModeId()).toBe('forcene');
        expect(select.value).toBe('forcene');
    });
});
