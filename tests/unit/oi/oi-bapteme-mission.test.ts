/**
 * oi-bapteme-mission.test.ts — photos « Baptême terrain » (Nico, 2026-09-26) :
 * un seul champ, juste sous la zone de saisie de la Mission (étape 4), et
 * plus dans chaque bloc ZMSPCP de l'articulation. Les photos déjà rangées par
 * bloc (`photo_bapteme_<bloc>`) sont reprises dans ce champ, jamais perdues.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeLegacyBaptemePhotos, OI_BAPTEME_CONTAINER, OI_PHOTO_CAPTION_MAX } from '@oi/sections.js';

const html = readFileSync(path.resolve(__dirname, '../../../oi/index.html'), 'utf8');

beforeEach(() => {
    localStorage.clear();
});
afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('page de l’OI', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    it('le bouton « Baptême terrain » suit immédiatement la zone de saisie de la Mission (étape 4)', () => {
        const mission = doc.getElementById('missions_psig')!;
        const block = mission.nextElementSibling as HTMLElement | null;
        expect(block).not.toBeNull();
        expect(block!.closest('[data-oi-section="mission"]')).not.toBeNull();
        const button = block!.querySelector('button[data-action="trigger-file-input"]')!;
        expect(button.textContent).toContain('Baptême terrain');
        const input = doc.getElementById(button.getAttribute('data-target')!)!;
        expect(input.getAttribute('data-preview-container')).toBe(OI_BAPTEME_CONTAINER);
        expect(block!.querySelector(`#${OI_BAPTEME_CONTAINER}.image-preview-container`)).not.toBeNull();
    });

    it('le champ est limité à 2 photos', () => {
        expect(doc.getElementById(OI_BAPTEME_CONTAINER)!.dataset.maxPhotos).toBe('2');
    });

    it('masqué en OI Express (comme les autres photos de l’OI Complet)', () => {
        const block = doc.getElementById('missions_psig')!.nextElementSibling as HTMLElement;
        expect(block.classList.contains('oi-express-hidden')).toBe(true);
    });
});

describe('bloc ZMSPCP', () => {
    it('ne propose plus « Baptême Terrain », garde « Emplacement AO »', async () => {
        document.body.innerHTML = '<div id="zmspcp_container"></div>';
        await import('@oi/articulation.js');
        window.addZmspcp({ id: 'z1', title: 'ALPHA' });
        const block = document.querySelector('.zmspcp-block')!;
        expect(block.textContent).not.toMatch(/Bapt[êe]me/i);
        expect(block.querySelector('[id^="photo_bapteme_"]')).toBeNull();
        expect(block.querySelector('#photo_empl_ao_z1')).not.toBeNull();
    });
});

describe('mergeLegacyBaptemePhotos', () => {
    it('reprend les photos par bloc à la suite du champ unique, dans l’ordre des blocs', () => {
        const before = {
            [OI_BAPTEME_CONTAINER]: [{ id: 'a' }],
            photo_bapteme_z2: [{ id: 'c' }],
            photo_bapteme_z1: [{ id: 'b' }],
            photo_empl_ao_z1: [{ id: 'ao' }],
        };
        const out = mergeLegacyBaptemePhotos(before, ['z1', 'z2']);
        expect(out[OI_BAPTEME_CONTAINER]!.map((m) => m.id)).toEqual(['a', 'b', 'c']);
        expect(Object.keys(out).filter((k) => k.startsWith('photo_bapteme_'))).toEqual([]);
        expect(out.photo_empl_ao_z1).toEqual([{ id: 'ao' }]);
        // Copie : l’objet d’origine est intact.
        expect(before.photo_bapteme_z1).toEqual([{ id: 'b' }]);
    });

    it('sans ancienne donnée, rend l’objet tel quel', () => {
        const same = { photo_empl_ao_z1: [{ id: 'ao' }] };
        expect(mergeLegacyBaptemePhotos(same)).toBe(same);
    });
});

describe('chargement d’un OI ancien', () => {
    it('les photos « Baptême Terrain » d’un bloc ZMSPCP apparaissent dans le champ sous la Mission', async () => {
        document.body.innerHTML = `<div id="adversaries_container"></div><div id="time_events_container"></div>
            <div id="hypotheses_container"></div><div id="${OI_BAPTEME_CONTAINER}" class="image-preview-container"></div>`;
        await import('@oi/formulaires.js');
        const { dbManager } = await import('@oi/init.js');
        for (const fn of ['initializePatracdvr', 'updateArticulationDisplay', 'addMoicp', 'addZmspcp', 'addEffraction',
            'refreshRameVL', 'refreshColonneProgression', 'refreshOrdrePenetration', 'syncAllThumbnails'] as const) {
            Reflect.set(window, fn, vi.fn());
        }
        window.updateCustomBgPreview = vi.fn(async () => { /* stub */ });
        vi.spyOn(dbManager, 'getItem').mockImplementation(async () => new Blob(['x'], { type: 'image/jpeg' }));
        localStorage.setItem('tactical_oi_data', JSON.stringify({
            zmspcp_blocks: [{ id: 'z1', title: 'ALPHA' }],
            dynamic_photos: { photo_bapteme_z1: [{ id: 'img_bapt_1', customTitle: 'Portail' }] },
        }));

        await window.loadFormData();

        const ids = Array.from(document.querySelectorAll(`#${OI_BAPTEME_CONTAINER} .image-preview`)).map((i) => i.id);
        expect(ids).toEqual(['img_bapt_1']);
        // Légende restaurée : bornée à la limite du PDF, nom par défaut affiché.
        const input = document.querySelector<HTMLInputElement>(`#${OI_BAPTEME_CONTAINER} .photo-title-input`)!;
        expect(input.value).toBe('Portail');
        expect(input.maxLength).toBe(OI_PHOTO_CAPTION_MAX);
        expect(input.placeholder).toBe('Baptême terrain (1/1)');
    });

    it('après suppression d’une photo, les noms par défaut sont renumérotés', async () => {
        vi.useFakeTimers();
        try {
            document.body.innerHTML = `<form id="oi-form"><div id="${OI_BAPTEME_CONTAINER}" class="image-preview-container">
                <div class="image-preview-item"><img id="a" class="image-preview"><input class="photo-title-input"></div>
                <div class="image-preview-item"><img id="b" class="image-preview"><input class="photo-title-input"></div>
            </div></form>`;
            await import('@oi/formulaires.js');
            window.isFormLoading = false;
            document.querySelector('.image-preview-item')!.remove();
            window.syncDomToStore();
            vi.advanceTimersByTime(600);
            expect(document.querySelector<HTMLInputElement>('.photo-title-input')!.placeholder).toBe('Baptême terrain (1/1)');
        } finally {
            vi.useRealTimers();
        }
    });
});
