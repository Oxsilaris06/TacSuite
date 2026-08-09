/**
 * oi-validation.test.ts — Tests unitaires de l'infrastructure de validation
 * inline (R2-T4, `src/apps/oi/validation.ts`, module NOUVEAU — pas un port
 * verbatim, donc pas de référence `modules/*.js:<ligne>`).
 *
 * Couvre le contrat de la mission R2-T4 :
 *  - jamais de validation à la frappe AVANT la première erreur ;
 *  - validation au `blur` ;
 *  - après une première erreur, re-validation à chaque `input` pour effacer
 *    dès correction (cycle erreur → correction) ;
 *  - `<p class="field-error" id="<inputId>-error">` + `aria-describedby` +
 *    `aria-invalid="true"` posés/retirés proprement ;
 *  - rien n'est ajouté au DOM tant qu'aucune erreur n'a été déclenchée (pas
 *    d'impact sur l'état de repos, cf. baselines visuelles) ;
 *  - `required` / `lengthRange` ;
 *  - la fonction de détachement retourne un état propre (listeners +
 *    erreur affichée retirés).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attachValidation, lengthRange, required } from '@oi/validation.js';

function makeInput(id: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    document.body.appendChild(input);
    return input;
}

describe('oi-validation — attachValidation', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('ne modifie rien au repos : aucun `.field-error` tant que rien ne se passe', () => {
        const input = makeInput('f1');
        attachValidation(input, [required('Requis.')]);

        expect(document.getElementById('f1-error')).toBeNull();
        expect(input.hasAttribute('aria-invalid')).toBe(false);
        expect(input.hasAttribute('aria-describedby')).toBe(false);
    });

    it("ne valide PAS à la frappe avant la première erreur (input seul, sans blur)", () => {
        const input = makeInput('f2');
        attachValidation(input, [required('Requis.')]);

        // Frappe puis effacement, SANS blur : aucune erreur ne doit apparaître,
        // même si la valeur est invalide au moment du dernier `input`.
        input.value = 'x';
        input.dispatchEvent(new Event('input'));
        input.value = '';
        input.dispatchEvent(new Event('input'));

        expect(document.getElementById('f2-error')).toBeNull();
        expect(input.getAttribute('aria-invalid')).toBeNull();
    });

    it('valide au blur : champ vide + `required` → erreur affichée avec aria-invalid + aria-describedby', () => {
        const input = makeInput('f3');
        attachValidation(input, [required('Ce champ est requis.')]);

        input.dispatchEvent(new Event('blur'));

        const errorEl = document.getElementById('f3-error');
        expect(errorEl).not.toBeNull();
        expect(errorEl?.tagName).toBe('P');
        expect(errorEl?.className).toBe('field-error');
        expect(errorEl?.textContent).toBe('Ce champ est requis.');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toBe('f3-error');
    });

    it('blur avec une valeur valide ne pose aucune erreur', () => {
        const input = makeInput('f4');
        attachValidation(input, [required('Requis.')]);

        input.value = 'ABC';
        input.dispatchEvent(new Event('blur'));

        expect(document.getElementById('f4-error')).toBeNull();
        expect(input.hasAttribute('aria-invalid')).toBe(false);
    });

    it("cycle erreur → correction : après une 1ère erreur au blur, l'erreur s'efface DÈS la frappe qui corrige (sans nouveau blur)", () => {
        const input = makeInput('f5');
        attachValidation(input, [required('Requis.')]);

        // 1er blur, champ vide → erreur.
        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f5-error')).not.toBeNull();

        // Correction en cours de frappe (input, pas blur) : doit effacer l'erreur.
        input.value = 'Valeur valide';
        input.dispatchEvent(new Event('input'));

        expect(document.getElementById('f5-error')).toBeNull();
        expect(input.hasAttribute('aria-invalid')).toBe(false);
        expect(input.hasAttribute('aria-describedby')).toBe(false);
    });

    it("après la 1ère erreur, re-devenir invalide à la frappe remet l'erreur (message à jour si la règle change)", () => {
        const input = makeInput('f6');
        attachValidation(input, [lengthRange(2, 4, 'Entre 2 et 4 caractères.')]);

        input.value = 'A';
        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f6-error')?.textContent).toBe('Entre 2 et 4 caractères.');

        // Correction valide → efface.
        input.value = 'AB';
        input.dispatchEvent(new Event('input'));
        expect(document.getElementById('f6-error')).toBeNull();

        // Re-dégradation en cours de frappe (déjà "hasErrored") → réaffiche sans nouveau blur.
        input.value = 'ABCDE';
        input.dispatchEvent(new Event('input'));
        expect(document.getElementById('f6-error')?.textContent).toBe('Entre 2 et 4 caractères.');
    });

    it('lengthRange rejette une valeur vide (contrairement à un simple minLength permissif)', () => {
        const input = makeInput('f7');
        attachValidation(input, [lengthRange(2, 4, 'Entre 2 et 4 caractères.')]);

        input.value = '';
        input.dispatchEvent(new Event('blur'));

        expect(document.getElementById('f7-error')?.textContent).toBe('Entre 2 et 4 caractères.');
    });

    it('lengthRange accepte les bornes 2 et 4 inclusivement', () => {
        const input = makeInput('f8');
        attachValidation(input, [lengthRange(2, 4, 'Entre 2 et 4 caractères.')]);

        input.value = 'AB';
        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f8-error')).toBeNull();

        input.value = 'ABCD';
        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f8-error')).toBeNull();

        input.value = 'ABCDE';
        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f8-error')?.textContent).toBe('Entre 2 et 4 caractères.');
    });

    it('préserve les ids déjà présents dans un `aria-describedby` existant', () => {
        const input = makeInput('f9');
        input.setAttribute('aria-describedby', 'hint-f9');
        attachValidation(input, [required('Requis.')]);

        input.dispatchEvent(new Event('blur'));
        expect(input.getAttribute('aria-describedby')).toBe('hint-f9 f9-error');

        input.value = 'ok';
        input.dispatchEvent(new Event('input'));
        expect(input.getAttribute('aria-describedby')).toBe('hint-f9');
    });

    it('la première règle en échec fournit le message (ordre respecté)', () => {
        const input = makeInput('f10');
        attachValidation(input, [
            required('Requis en premier.'),
            lengthRange(2, 4, 'Longueur invalide.'),
        ]);

        input.value = '';
        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f10-error')?.textContent).toBe('Requis en premier.');
    });

    it('la fonction de détachement retire les listeners et l\'erreur affichée', () => {
        const input = makeInput('f11');
        const detach = attachValidation(input, [required('Requis.')]);

        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f11-error')).not.toBeNull();

        detach();

        expect(document.getElementById('f11-error')).toBeNull();
        expect(input.hasAttribute('aria-invalid')).toBe(false);

        // Les listeners sont retirés : un nouveau blur sur champ vide ne doit
        // plus produire d'erreur.
        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('f11-error')).toBeNull();
    });

    it('fonctionne aussi sur un `<textarea>`', () => {
        const textarea = document.createElement('textarea');
        textarea.id = 'ta1';
        document.body.appendChild(textarea);

        attachValidation(textarea, [required('Requis.')]);
        textarea.dispatchEvent(new Event('blur'));

        expect(document.getElementById('ta1-error')?.textContent).toBe('Requis.');
        expect(textarea.getAttribute('aria-invalid')).toBe('true');
    });

    it('lève une erreur explicite si le champ n\'a pas d\'id (aria-describedby impossible à construire)', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);

        expect(() => attachValidation(input, [required('Requis.')])).toThrow();
    });
});

describe('oi-validation — insertion DOM du message d\'erreur', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it("insère le `<p class=\"field-error\">` juste après le champ (sibling suivant)", () => {
        const wrapper = document.createElement('div');
        const input = document.createElement('input');
        input.id = 'f12';
        const after = document.createElement('span');
        after.textContent = 'après';
        wrapper.appendChild(input);
        wrapper.appendChild(after);
        document.body.appendChild(wrapper);

        attachValidation(input, [required('Requis.')]);
        input.dispatchEvent(new Event('blur'));

        expect(input.nextElementSibling?.id).toBe('f12-error');
        expect(input.nextElementSibling?.nextElementSibling).toBe(after);
    });
});
