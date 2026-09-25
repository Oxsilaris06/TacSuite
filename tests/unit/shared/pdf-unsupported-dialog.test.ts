/**
 * pdf-unsupported-dialog.test.ts — avertissement AVANT génération quand des
 * caractères ne pourront pas être imprimés (décision 44) : il nomme le champ
 * et le caractère, et laisse le choix de continuer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { confirmUnsupportedChars } from '@shared/pdf-unsupported-dialog.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('confirmUnsupportedChars', () => {
    it('rien à signaler : continue sans rien afficher', async () => {
        await expect(confirmUnsupportedChars([])).resolves.toBe(true);
        expect(document.querySelector('dialog')).toBeNull();
    });

    it('nomme chaque champ et ses caractères, puis continue si l’utilisateur confirme', async () => {
        const pending = confirmUnsupportedChars([
            { where: 'Fiche DURAND Marc — Alias', chars: ['王', '明'] },
            { where: 'Main courante 10:30', chars: ['😀'] },
        ]);
        const text = document.querySelector('dialog')?.textContent ?? '';
        expect(text).toContain('Fiche DURAND Marc — Alias : 王 明');
        expect(text).toContain('Main courante 10:30 : 😀');
        document.querySelector<HTMLElement>('[data-tac-confirm="ok"]')!.click();
        await expect(pending).resolves.toBe(true);
    });

    it('Annuler interrompt la génération', async () => {
        const pending = confirmUnsupportedChars([{ where: 'Fiche X', chars: ['中'] }]);
        document.querySelector<HTMLElement>('[data-tac-confirm="cancel"]')!.click();
        await expect(pending).resolves.toBe(false);
    });

    it('au-delà de 8 champs, résume le reste', async () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ where: `Champ ${i + 1}`, chars: ['中'] }));
        const pending = confirmUnsupportedChars(many);
        const text = document.querySelector('dialog')?.textContent ?? '';
        expect(text).toContain('Champ 8 : 中');
        expect(text).not.toContain('Champ 9 :');
        expect(text).toContain('et 4 autres champs');
        document.querySelector<HTMLElement>('[data-tac-confirm="cancel"]')!.click();
        await pending;
    });
});
