/**
 * pdf-options.test.ts — fenêtre de génération PDF commune (décision 42) :
 * type de rapport (PC-Tac), thème au choix (clair par défaut), sortie
 * Impression / Partage ; derniers choix retenus par application.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    PDF_IMAGE_PROFILES,
    askPdfOptions,
    formatBytes,
    loadPdfOptions,
    savePdfOptions,
    targetPixels,
} from '@shared/pdf-options.js';

const KINDS = [
    { id: 'complet', label: 'Rapport complet' },
    { id: 'a3', label: 'Synthèse A3 paysage' },
];

beforeEach(() => localStorage.clear());
afterEach(() => { document.body.innerHTML = ''; });

function click(selector: string): void {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`introuvable : ${selector}`);
    el.click();
}

describe('options par défaut et mémoire', () => {
    it('clair, impression et premier type par défaut', () => {
        expect(loadPdfOptions('pctac', KINDS)).toEqual({ kind: 'complet', theme: 'clair', sortie: 'impression' });
        expect(loadPdfOptions('oi')).toEqual({ kind: null, theme: 'clair', sortie: 'impression' });
    });

    it('retient les derniers choix, séparément par application', () => {
        savePdfOptions('pctac', { kind: 'a3', theme: 'sombre', sortie: 'partage' });
        expect(loadPdfOptions('pctac', KINDS)).toEqual({ kind: 'a3', theme: 'sombre', sortie: 'partage' });
        expect(loadPdfOptions('oi')).toEqual({ kind: null, theme: 'clair', sortie: 'impression' });
    });

    it('ignore une valeur enregistrée invalide ou un type qui n’existe plus', () => {
        localStorage.setItem('tacPdfOptions:pctac', JSON.stringify({ kind: 'disparu', theme: 'rose', sortie: 42 }));
        expect(loadPdfOptions('pctac', KINDS)).toEqual({ kind: 'complet', theme: 'clair', sortie: 'impression' });
        localStorage.setItem('tacPdfOptions:pctac', '{pas du json');
        expect(loadPdfOptions('pctac', KINDS)).toEqual({ kind: 'complet', theme: 'clair', sortie: 'impression' });
    });
});

describe('askPdfOptions', () => {
    it('rend les choix faits dans la fenêtre et les retient', async () => {
        const pending = askPdfOptions({ appKey: 'pctac', title: 'Générer le PDF', kinds: KINDS });
        click('input[name="tac-pdf-kind"][value="a3"]');
        click('input[name="tac-pdf-theme"][value="sombre"]');
        click('input[name="tac-pdf-sortie"][value="partage"]');
        click('[data-tac-confirm="ok"]');
        await expect(pending).resolves.toEqual({ kind: 'a3', theme: 'sombre', sortie: 'partage' });
        expect(loadPdfOptions('pctac', KINDS).kind).toBe('a3');
    });

    it('pré-coche les derniers choix', async () => {
        savePdfOptions('oi', { kind: null, theme: 'sombre', sortie: 'partage' });
        const pending = askPdfOptions({ appKey: 'oi', title: 'PDF de l’OI' });
        expect(document.querySelector<HTMLInputElement>('input[name="tac-pdf-theme"][value="sombre"]')?.checked).toBe(true);
        expect(document.querySelector('input[name="tac-pdf-kind"]')).toBeNull();
        click('[data-tac-confirm="ok"]');
        await expect(pending).resolves.toEqual({ kind: null, theme: 'sombre', sortie: 'partage' });
    });

    it('Annuler rend null et ne modifie rien', async () => {
        const pending = askPdfOptions({ appKey: 'pctac', title: 'Générer le PDF', kinds: KINDS });
        click('input[name="tac-pdf-theme"][value="sombre"]');
        click('[data-tac-confirm="cancel"]');
        await expect(pending).resolves.toBeNull();
        expect(loadPdfOptions('pctac', KINDS).theme).toBe('clair');
        expect(document.querySelector('dialog')).toBeNull();
    });
});

describe('profils d’image', () => {
    it('le partage vise moins de 10 Mo et une définition plus basse que l’impression', () => {
        expect(PDF_IMAGE_PROFILES.partage.budgetBytes).toBe(10 * 1024 * 1024);
        expect(PDF_IMAGE_PROFILES.partage.maxPpi).toBeLessThan(PDF_IMAGE_PROFILES.impression.maxPpi);
        expect(PDF_IMAGE_PROFILES.impression.budgetBytes).toBeNull();
    });

    it('targetPixels convertit une largeur imprimée en pixels utiles', () => {
        expect(targetPixels(72, 'impression')).toBe(PDF_IMAGE_PROFILES.impression.maxPpi);
        expect(targetPixels(144, 'partage')).toBe(2 * PDF_IMAGE_PROFILES.partage.maxPpi);
    });

    it('formatBytes rend un poids lisible en français', () => {
        expect(formatBytes(512)).toBe('512 o');
        expect(formatBytes(2048)).toBe('2 Ko');
        expect(formatBytes(8.4 * 1024 * 1024)).toBe('8,4 Mo');
    });
});
