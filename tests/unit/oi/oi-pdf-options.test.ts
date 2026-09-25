/**
 * oi-pdf-options.test.ts — Fenêtre de génération de l'OI (décision 42) :
 * le formulaire commun (`buildPdfOptionsForm('oi')`) est monté dans la modale
 * d'aperçu existante ; ses choix (thème clair par défaut, sortie) pilotent le
 * téléchargement, l'aperçu et « Présenter ici ».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentOiPdfOptions, mountOiPdfOptions } from '@oi/pdf/options.js';

function radio(slot: HTMLElement, name: string, value: string): HTMLInputElement {
    const input = slot.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
    if (!input) throw new Error(`radio ${name}=${value} absent`);
    return input;
}

describe('fenêtre de génération PDF de l’OI', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('thème clair et sortie Impression par défaut, sans aucun choix enregistré', () => {
        const slot = document.createElement('div');
        document.body.appendChild(slot);
        mountOiPdfOptions(slot, () => {});
        expect(radio(slot, 'tac-pdf-theme', 'clair').checked).toBe(true);
        expect(radio(slot, 'tac-pdf-sortie', 'impression').checked).toBe(true);
        expect(currentOiPdfOptions()).toEqual({ kind: null, theme: 'clair', sortie: 'impression' });
    });

    it('un changement est retenu (derniers choix) et signalé pour régénérer l’aperçu', () => {
        const slot = document.createElement('div');
        document.body.appendChild(slot);
        const onChange = vi.fn();
        mountOiPdfOptions(slot, onChange);

        const sombre = radio(slot, 'tac-pdf-theme', 'sombre');
        sombre.checked = true;
        sombre.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onChange).toHaveBeenCalledWith({ kind: null, theme: 'sombre', sortie: 'impression' });
        expect(currentOiPdfOptions().theme).toBe('sombre');
        expect(JSON.parse(localStorage.getItem('tacPdfOptions:oi') ?? 'null')).toEqual({ kind: null, theme: 'sombre', sortie: 'impression' });
    });

    it('monté deux fois (réouverture de la modale) : un seul formulaire, choix conservés', () => {
        const slot = document.createElement('div');
        document.body.appendChild(slot);
        mountOiPdfOptions(slot, () => {});
        const partage = radio(slot, 'tac-pdf-sortie', 'partage');
        partage.checked = true;
        partage.dispatchEvent(new Event('change', { bubbles: true }));

        mountOiPdfOptions(slot, () => {});

        expect(slot.querySelectorAll('.tac-pdf-options')).toHaveLength(1);
        expect(radio(slot, 'tac-pdf-sortie', 'partage').checked).toBe(true);
    });

    it('sans formulaire monté, les derniers choix enregistrés font foi', () => {
        localStorage.setItem('tacPdfOptions:oi', JSON.stringify({ kind: null, theme: 'sombre', sortie: 'partage' }));
        document.body.innerHTML = '';
        expect(currentOiPdfOptions()).toEqual({ kind: null, theme: 'sombre', sortie: 'partage' });
    });
});
