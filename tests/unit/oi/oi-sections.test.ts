import { beforeEach, describe, expect, it } from 'vitest';
import type { OiFormData } from '@shared/types/contracts.js';
import {
    applySectionRemovals,
    currentOiMode,
    formSectionTitle,
    isSectionRemoved,
    OI_SECTION_TITLE_MAX,
    OI_UNIT_TITLES_KEY,
    pdfSectionTitle,
    sectionPrefs,
    seedFromUnitTemplate,
    withSectionPrefs,
    writeUnitTitles,
} from '@oi/sections.js';

beforeEach(() => localStorage.clear());

describe('sections OI — retrait et titres, par mode', () => {
    it("une OI ancienne (sans réglages) est complète, rien de retiré, titres d'origine", () => {
        const fd: OiFormData = {};
        expect(currentOiMode(fd)).toBe('complete');
        expect(isSectionRemoved(fd, 'colonne')).toBe(false);
        expect(formSectionTitle(fd, 'colonne')).toBe('Ordre de la colonne de progression');
        expect(pdfSectionTitle(fd, 'colonne')).toBe('Colonne Progression');
    });

    it('le retrait vaut pour le mode où il a été fait, pas pour l’autre', () => {
        const fd: OiFormData = { oi_sections: { complete: { removed: ['colonne'], titles: {} } } };
        expect(isSectionRemoved(fd, 'colonne')).toBe(true);
        expect(isSectionRemoved({ ...fd, oi_mode: 'express' }, 'colonne')).toBe(false);
    });

    it('retirer une étape retire ses sous-sections', () => {
        const fd: OiFormData = { oi_sections: { complete: { removed: ['articulation'], titles: {} } } };
        expect(isSectionRemoved(fd, 'penetration')).toBe(true);
        expect(isSectionRemoved(fd, 'moicp')).toBe(true);
    });

    it('une section du socle ne peut pas être retirée, même si le stockage le prétend', () => {
        const fd: OiFormData = { oi_sections: { complete: { removed: ['mission', 'inconnue'], titles: {} } } };
        expect(isSectionRemoved(fd, 'mission')).toBe(false);
        expect(sectionPrefs(fd).removed).toEqual([]);
    });

    it('titre personnalisé : rogné, borné, vide = titre d’origine', () => {
        const long = 'x'.repeat(OI_SECTION_TITLE_MAX + 20);
        const fd: OiFormData = { oi_sections: { complete: { removed: [], titles: { rame: '  Ordre des VL  ', uda: '   ', colonne: long } } } };
        expect(formSectionTitle(fd, 'rame')).toBe('Ordre des VL');
        expect(formSectionTitle(fd, 'uda')).toBe('UDA');
        expect(formSectionTitle(fd, 'colonne')).toHaveLength(OI_SECTION_TITLE_MAX);
    });

    it('PDF : le titre personnalisé suit la casse du titre d’origine', () => {
        const fd: OiFormData = { oi_sections: { complete: { removed: [], titles: { environnement: 'Terrain et amis', rame: 'Ordre des VL' } } } };
        expect(pdfSectionTitle(fd, 'environnement')).toBe('TERRAIN ET AMIS');
        expect(pdfSectionTitle(fd, 'rame')).toBe('Ordre des VL');
    });

    it("modèle d'unité : recopié dans une OI qui n'a encore aucun réglage pour ce mode, jamais dans une OI déjà réglée", () => {
        expect(writeUnitTitles('complete', { mission: 'But' })).toBe(true);
        expect(seedFromUnitTemplate({}, 'complete')).toEqual({ removed: [], titles: { mission: 'But' } });
        expect(seedFromUnitTemplate({ oi_sections: { complete: { removed: [], titles: {} } } }, 'complete')).toBeNull();
        expect(seedFromUnitTemplate({}, 'express')).toBeNull();
    });

    it("titre vidé = titre d'origine, même quand un modèle d'unité existe (le modèle n'est plus un repli d'affichage)", () => {
        writeUnitTitles('complete', { mission: 'But' });
        const fd: OiFormData = { oi_sections: { complete: { removed: [], titles: {} } } };
        expect(formSectionTitle(fd, 'mission')).toBe("Mission de l'unité");
    });

    it("modèle d'unité corrompu : ignoré sans exception", () => {
        localStorage.setItem(OI_UNIT_TITLES_KEY, '{pas du json');
        expect(formSectionTitle({}, 'mission')).toBe("Mission de l'unité");
    });

    it('withSectionPrefs ne touche que le mode visé', () => {
        const fd: OiFormData = { oi_sections: { express: { removed: ['uda'], titles: {} } } };
        const next = withSectionPrefs(fd, { removed: ['rame'], titles: {} });
        expect(next.complete?.removed).toEqual(['rame']);
        expect(next.express?.removed).toEqual(['uda']);
    });
});

describe('applySectionRemovals — données masquées pour le PDF, jamais effacées', () => {
    it('masque les données des sections retirées dans une COPIE', () => {
        const fd: OiFormData = {
            oi_sections: { complete: { removed: ['chronologie', 'penetration', 'moicp', 'uda', 'cheminement'], titles: {} } },
            time_events: [{ type: 'H', hour: '06:00', description: 'x' }],
            ordre_penetration_order: ['ABC'],
            colonne_progression_order: ['ABC'],
            moicp_blocks: [{ id: 'm1' }] as unknown as OiFormData['moicp_blocks'],
            uda: 'L435-1',
            dynamic_photos: { photo_container_transport_pr_preview_container: [], autre: [] },
        };
        const out = applySectionRemovals(fd);
        expect(out.time_events).toEqual([]);
        expect(out.ordre_penetration_order).toEqual([]);
        expect(out.colonne_progression_order).toEqual(['ABC']);
        expect(out.moicp_blocks).toEqual([]);
        expect(out.uda).toBe('');
        expect(Object.keys(out.dynamic_photos ?? {})).toEqual(['autre']);
        // L'original est intact : « Rétablir » rend tout.
        expect(fd.uda).toBe('L435-1');
        expect(fd.ordre_penetration_order).toEqual(['ABC']);
    });

    it('retirer Articulation masque aussi ses blocs', () => {
        const fd: OiFormData = {
            oi_sections: { complete: { removed: ['articulation'], titles: {} } },
            effraction_blocks: [{ id: 'e1' }] as unknown as OiFormData['effraction_blocks'],
        };
        expect(applySectionRemovals(fd).effraction_blocks).toEqual([]);
    });
});
