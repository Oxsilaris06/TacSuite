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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachValidation, lengthRange, required } from '@oi/validation.js';
import {
    EFFRACTION_HYP_FIELD_SOFT_MAX,
    charCounter,
    fitCounter,
    showOiFitRefusal,
} from '@oi/validation.js';
import { OiPdfFitRefusalError } from '@oi/pdf/theme.js';

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

/**
 * charCounter — P3 : compteur de caractères calibré sur les capacités PDF
 * réelles (`PAGE_CAPACITY`, `pdf/document-builder.ts`). Couvre le contrat de
 * la mission P3 :
 *  - jamais d'écriture au DOM au repos (champ vide, sans focus) — gate
 *    baselines visuelles ;
 *  - apparition au focus OU dès ≥ 50 % de `softMax`, disparition sinon ;
 *  - 3 zones (normal / avertissement ≥ 85 % / dépassement > 100 %) avec le
 *    message « risque de refus PDF » et `aria-live="polite"` en zone rouge
 *    uniquement ;
 *  - PAS de blocage de saisie (`maxLength` non posé sans `hardMax` explicite) ;
 *  - fonctionne sur un champ SANS id (cas des champs dynamiques
 *    `articulation.ts`, id généré automatiquement) ;
 *  - détachement propre.
 */
describe('oi-validation — charCounter', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    function makeTextarea(id?: string): HTMLTextAreaElement {
        const ta = document.createElement('textarea');
        if (id) ta.id = id;
        document.body.appendChild(ta);
        return ta;
    }

    it('ne modifie rien au repos : champ vide, sans focus → aucun `.char-counter`', () => {
        const input = makeTextarea('c1');
        charCounter(input, { softMax: 100 });

        expect(document.getElementById('c1-charcount')).toBeNull();
        expect(input.hasAttribute('aria-describedby')).toBe(false);
    });

    it("n'apparaît PAS sous 50 % du seuil, même en cours de frappe, sans focus", () => {
        const input = makeTextarea('c2');
        charCounter(input, { softMax: 100 });

        input.value = 'x'.repeat(40);
        input.dispatchEvent(new Event('input'));

        expect(document.getElementById('c2-charcount')).toBeNull();
    });

    it('apparaît dès que la longueur atteint 50 % du seuil, sans focus', () => {
        const input = makeTextarea('c3');
        charCounter(input, { softMax: 100 });

        input.value = 'x'.repeat(50);
        input.dispatchEvent(new Event('input'));

        const el = document.getElementById('c3-charcount');
        expect(el).not.toBeNull();
        expect(el?.textContent).toBe('50/100');
        expect(el?.className).toBe('char-counter char-counter--normal');
        expect(input.getAttribute('aria-describedby')).toBe('c3-charcount');
    });

    it('apparaît au focus même très en dessous de 50 %, disparaît au blur si toujours sous 50 %', () => {
        const input = makeTextarea('c4');
        charCounter(input, { softMax: 100 });

        input.value = 'abc';
        input.dispatchEvent(new Event('focus'));
        expect(document.getElementById('c4-charcount')?.textContent).toBe('3/100');

        input.dispatchEvent(new Event('blur'));
        expect(document.getElementById('c4-charcount')).toBeNull();
    });

    it('reste affiché au blur si la longueur est déjà ≥ 50 % (le focus seul ne conditionne pas la disparition)', () => {
        const input = makeTextarea('c4b');
        charCounter(input, { softMax: 100 });

        input.value = 'x'.repeat(60);
        input.dispatchEvent(new Event('focus'));
        input.dispatchEvent(new Event('blur'));

        expect(document.getElementById('c4b-charcount')?.textContent).toBe('60/100');
    });

    it('zone avertissement (ambre) à partir de 85 % du seuil', () => {
        const input = makeTextarea('c5');
        charCounter(input, { softMax: 100 });

        input.value = 'x'.repeat(84);
        input.dispatchEvent(new Event('input'));
        expect(document.getElementById('c5-charcount')?.className).toBe('char-counter char-counter--normal');

        input.value = 'x'.repeat(85);
        input.dispatchEvent(new Event('input'));
        expect(document.getElementById('c5-charcount')?.className).toBe('char-counter char-counter--warning');
    });

    it('zone dépassement (rouge) au-delà du seuil : message « risque de refus PDF » + aria-live polite', () => {
        const input = makeTextarea('c6');
        charCounter(input, { softMax: 100 });

        input.value = 'x'.repeat(100);
        input.dispatchEvent(new Event('input'));
        const atLimit = document.getElementById('c6-charcount');
        expect(atLimit?.className).toBe('char-counter char-counter--warning');
        expect(atLimit?.hasAttribute('aria-live')).toBe(false);

        input.value = 'x'.repeat(101);
        input.dispatchEvent(new Event('input'));
        const overLimit = document.getElementById('c6-charcount');
        expect(overLimit?.className).toBe('char-counter char-counter--danger');
        expect(overLimit?.textContent).toBe('101/100 — risque de refus PDF');
        expect(overLimit?.getAttribute('aria-live')).toBe('polite');
    });

    it('ne pose PAS de `maxLength` (pas de blocage de saisie) sans `hardMax` explicite', () => {
        const input = makeTextarea('c7');
        charCounter(input, { softMax: 100 });

        expect(input.maxLength).toBe(-1);
    });

    it('pose `maxLength` si `hardMax` est fourni explicitement', () => {
        const input = makeTextarea('c8');
        charCounter(input, { softMax: 100, hardMax: 150 });

        expect(input.maxLength).toBe(150);
    });

    it('fonctionne sur un champ SANS id (cas des champs dynamiques `articulation.ts`) : id généré automatiquement', () => {
        const input = document.createElement('textarea');
        document.body.appendChild(input);
        expect(input.id).toBe('');

        charCounter(input, { softMax: 100 });
        expect(input.id).not.toBe('');

        input.value = 'x'.repeat(60);
        input.dispatchEvent(new Event('input'));
        expect(document.getElementById(`${input.id}-charcount`)?.textContent).toBe('60/100');
    });

    it("l'état initial (valeur déjà longue, ex. restauration) affiche le compteur sans attendre une frappe", () => {
        const input = makeTextarea('c9');
        input.value = 'x'.repeat(90);

        charCounter(input, { softMax: 100 });

        expect(document.getElementById('c9-charcount')?.className).toBe('char-counter char-counter--warning');
    });

    it('la fonction de détachement retire les listeners et le compteur affiché', () => {
        const input = makeTextarea('c10');
        const detach = charCounter(input, { softMax: 100 });

        input.value = 'x'.repeat(60);
        input.dispatchEvent(new Event('input'));
        expect(document.getElementById('c10-charcount')).not.toBeNull();

        detach();

        expect(document.getElementById('c10-charcount')).toBeNull();
        expect(input.hasAttribute('aria-describedby')).toBe(false);

        // Listeners retirés : une nouvelle frappe au-dessus du seuil ne doit
        // plus rien afficher.
        input.value = 'x'.repeat(95);
        input.dispatchEvent(new Event('input'));
        expect(document.getElementById('c10-charcount')).toBeNull();
    });

    it('préserve les ids déjà présents dans un `aria-describedby` existant (partagé avec `attachValidation`)', () => {
        const input = makeTextarea('c11');
        input.setAttribute('aria-describedby', 'hint-c11');

        charCounter(input, { softMax: 100 });
        input.value = 'x'.repeat(60);
        input.dispatchEvent(new Event('input'));

        expect(input.getAttribute('aria-describedby')).toBe('hint-c11 c11-charcount');
    });

    // Décision 43 : les compteurs en caractères de l'ATCD et de la CAT
    // (ADVERSAIRE_ATCD_SOFT_MAX = 1368, ARTICULATION_CAT_SOFT_MAX = 1976)
    // restaient orange ou verts au moment du refus (audit F07) : remplacés par
    // `fitCounter`, en lignes, issu du modèle du solveur. Seul le seuil des
    // champs d'hypothèse d'effraction reste en caractères.
    it('le seuil exporté des champs d’hypothèse d’effraction dérive de `PAGE_CAPACITY` et reste figé', () => {
        expect(EFFRACTION_HYP_FIELD_SOFT_MAX).toBe(148);
    });
});

describe('oi-validation — fitCounter (lignes, même modèle que le solveur, décision 43)', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    function setup(margin: { value: number }): { scope: HTMLDivElement; input: HTMLTextAreaElement; other: HTMLInputElement } {
        const scope = document.createElement('div');
        const input = document.createElement('textarea');
        input.id = 'atcd';
        const other = document.createElement('input');
        scope.append(input, other);
        document.body.appendChild(scope);
        fitCounter(input, { scope, measure: () => margin.value });
        return { scope, input, other };
    }
    const counter = (): HTMLElement | null => document.getElementById('atcd-charcount');

    it('large marge, sans focus : rien ; au focus : « 12 lignes de marge »', () => {
        const { input } = setup({ value: 12 });
        expect(counter()).toBeNull();
        input.dispatchEvent(new Event('focus'));
        expect(counter()?.textContent).toBe('12 lignes de marge sur la page');
        expect(counter()?.className).toBe('char-counter char-counter--normal');
    });

    it('marge faible : visible sans focus, en avertissement', () => {
        setup({ value: 3 });
        expect(counter()?.textContent).toBe('3 lignes de marge sur la page');
        expect(counter()?.className).toBe('char-counter char-counter--warning');
    });

    it('page pleine (marge 0) : ROUGE avant le refus', () => {
        setup({ value: 0 });
        expect(counter()?.className).toBe('char-counter char-counter--danger');
        expect(counter()?.textContent).toMatch(/page pleine/i);
    });

    it('marge négative : rouge, « 4 lignes de trop — PDF refusé », annoncé', () => {
        setup({ value: -4 });
        expect(counter()?.textContent).toBe('4 lignes de trop : le PDF sera refusé');
        expect(counter()?.getAttribute('aria-live')).toBe('polite');
    });

    it('une saisie AILLEURS dans la fiche (même portée) remet la marge à jour', () => {
        const margin = { value: 12 };
        const { other } = setup(margin);
        expect(counter()).toBeNull();
        margin.value = -1;
        other.dispatchEvent(new Event('input', { bubbles: true }));
        expect(counter()?.textContent).toBe('1 ligne de trop : le PDF sera refusé');
    });
});

describe('showOiFitRefusal — refus « une page = un usage » expliqué (décision 43)', () => {
    const ATCD = '#oi-form .adversary-entry[data-adv-id="adv1"] [data-field="antecedents_adversaire"]';
    const refusal = (): OiPdfFitRefusalError => new OiPdfFitRefusalError([
        { section: 'Fiche Adversaire 1 : MARTIN Paul', details: 'réduisez les ATCD ou les textes libres', excessRatio: 0.05, excessLines: 3, field: { selector: ATCD } },
        { section: 'Articulation : ZMSPCP - APPUI 1', details: 'allégez la conduite à tenir ou le nombre de cellules', excessRatio: 0.1, excessLines: 1, field: { selector: '#oi-form .zmspcp-block[data-block-id="z1"] .zmspcp-cat' } },
    ]);
    let goToStep: ReturnType<typeof vi.fn<(n: number) => void>>;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <dialog id="presentationModal" open></dialog>
            <form id="oi-form">
                <div class="wizard-step"></div>
                <div class="wizard-step"><div class="collapsible-container adversary-entry" data-adv-id="adv1"><div class="collapsible-content"><textarea data-field="antecedents_adversaire"></textarea></div></div></div>
            </form>`;
        goToStep = vi.fn<(n: number) => void>();
        window.goToStep = goToStep;
    });
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });
    const dialog = (): HTMLDialogElement | null => document.querySelector('dialog.tac-confirm-dialog');
    const button = (which: 'ok' | 'cancel'): HTMLButtonElement => dialog()?.querySelector(`[data-tac-confirm="${which}"]`) as HTMLButtonElement;

    it('fenêtre persistante : nomme chaque fiche ou bloc, dit combien retirer, toujours ouverte 30 s plus tard', async () => {
        void showOiFitRefusal(refusal());
        expect(dialog()?.textContent).toContain('Fiche Adversaire 1 : MARTIN Paul');
        expect(dialog()?.textContent).toContain('environ 3 lignes de trop');
        expect(dialog()?.textContent).toContain('Articulation : ZMSPCP - APPUI 1');
        expect(dialog()?.textContent).toContain('environ 1 ligne de trop');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(dialog()).not.toBeNull();
        expect(button('ok').textContent).toBe('Aller au champ');
    });

    it('« Aller au champ » : ferme l’aperçu, va à l’étape, déplie la fiche et place le curseur dans l’ATCD', async () => {
        const done = showOiFitRefusal(refusal());
        button('ok').click();
        await done;
        await vi.runAllTimersAsync();
        const field = document.querySelector<HTMLTextAreaElement>(ATCD);
        expect(dialog()).toBeNull();
        expect((document.getElementById('presentationModal') as HTMLDialogElement).hasAttribute('open')).toBe(false);
        expect(goToStep).toHaveBeenCalledWith(1);
        expect(document.querySelector('.adversary-entry')?.classList.contains('open')).toBe(true);
        expect(document.activeElement).toBe(field);
    });

    it('« Fermer » : rien ne bouge (aperçu et étape gardés)', async () => {
        const done = showOiFitRefusal(refusal());
        button('cancel').click();
        await done;
        await vi.runAllTimersAsync();
        expect(dialog()).toBeNull();
        expect(goToStep).not.toHaveBeenCalled();
        expect((document.getElementById('presentationModal') as HTMLDialogElement).hasAttribute('open')).toBe(true);
    });
});
