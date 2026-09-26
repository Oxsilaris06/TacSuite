/**
 * Pastilles de couleur de l'annotation photo (atelier UI-2, 2026-09-26) :
 * des <div> cliquables, hors de portée du clavier et muettes au lecteur
 * d'écran. Ce sont maintenant des boutons nommés, l'active annoncée.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountAnnotationModal } from '@shared/annotation-modal.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('pastilles de couleur de l’annotation', () => {
    it('sont des boutons nommés, une seule pressée', () => {
        const modal = mountAnnotationModal({ memberTool: false });
        const circles = Array.from(modal.querySelectorAll<HTMLElement>('.color-circle'));
        expect(circles.length).toBe(5);
        for (const c of circles) {
            expect(c.tagName).toBe('BUTTON');
            expect(c.getAttribute('type')).toBe('button');
            expect(c.getAttribute('aria-label')).toBeTruthy();
        }
        expect(circles.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    });

    it('choisir une couleur déplace l’état pressé', async () => {
        await import('@oi/dessin.js');
        const modal = mountAnnotationModal({ memberTool: false });
        const blue = modal.querySelector<HTMLElement>('.color-circle-blue')!;
        window.setAnnotationColor('#3498db', blue);
        const pressed = Array.from(modal.querySelectorAll('.color-circle[aria-pressed="true"]'));
        expect(pressed).toEqual([blue]);
    });
});

describe('en-tête et réglages de l’annotation', () => {
    it('une seule façon de fermer : « Annuler » (plus de × qui la double)', () => {
        const modal = mountAnnotationModal({ memberTool: false });
        expect(modal.querySelector('.annotation-close-btn')).toBeNull();
        expect(modal.querySelectorAll('[data-action="close-annotation-modal"]')).toHaveLength(1);
    });

    it('chaque curseur porte un nom accessible', () => {
        const modal = mountAnnotationModal({ memberTool: false });
        const sliders = Array.from(modal.querySelectorAll<HTMLInputElement>('input[type="range"]'));
        expect(sliders.length).toBe(4);
        for (const s of sliders) expect(s.getAttribute('aria-label'), s.id).toBeTruthy();
    });
});
