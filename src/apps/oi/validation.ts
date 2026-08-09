/**
 * validation.ts — R2-T4 : infrastructure de validation inline pour les
 * formulaires OI (SPEC R2-T4, nouveau module — pas un port verbatim).
 * ===========================================================================
 *
 * But : ajouter un retour visuel accessible (message sous le champ,
 * `aria-invalid`, `aria-describedby`) SANS retirer les `alert()` existants
 * (tranche T2 séparée) et SANS rien changer à l'état de repos des champs
 * (aucun DOM ajouté tant qu'aucune erreur n'est déclenchée — impératif pour
 * les baselines visuelles capturées sans état d'erreur, cf. gate (c)).
 *
 * Politique de déclenchement (imposée par la mission) :
 *  - AU BLUR uniquement, tant qu'aucune erreur n'a encore été montrée
 *    (jamais à la frappe avant la première erreur — évite l'agressivité
 *    d'une validation « live » sur un champ que l'utilisateur est encore
 *    en train de remplir) ;
 *  - après une première erreur, re-validation À CHAQUE frappe (`input`)
 *    pour effacer le message dès que la correction rend le champ valide.
 */

/** Une règle de validation : `test` renvoie `true` si la valeur est valide. */
export interface FieldRule {
    test: (value: string) => boolean;
    message: string;
}

/** Détache un `attachValidation` : retire les listeners et l'erreur affichée. */
export type DetachValidation = () => void;

/** Champ requis (non vide après trim). */
export function required(message = 'Ce champ est requis.'): FieldRule {
    return { test: (v) => v.trim().length > 0, message };
}

/**
 * Longueur bornée, y compris pour une valeur vide (contrairement à
 * `minLength`/`maxLength` « best effort » qui tolèrent un champ vide libre) —
 * utile pour un format à taille fixe comme un trigramme (2 à 4 caractères,
 * règle déjà appliquée ailleurs dans l'app : `patrac.ts` `addManualMember`/
 * `addCellBatch`).
 */
export function lengthRange(min: number, max: number, message: string): FieldRule {
    return {
        test: (v) => {
            const len = v.trim().length;
            return len >= min && len <= max;
        },
        message,
    };
}

/** Construit l'id de l'élément d'erreur associé à un champ. */
function errorIdFor(input: HTMLInputElement | HTMLTextAreaElement): string {
    return `${input.id}-error`;
}

function showError(input: HTMLInputElement | HTMLTextAreaElement, message: string): void {
    input.setAttribute('aria-invalid', 'true');
    const errorId = errorIdFor(input);
    let errorEl = document.getElementById(errorId);
    if (!errorEl) {
        errorEl = document.createElement('p');
        errorEl.className = 'field-error';
        errorEl.id = errorId;
        input.insertAdjacentElement('afterend', errorEl);
    }
    errorEl.textContent = message;

    const describedBy = input.getAttribute('aria-describedby');
    const ids = describedBy ? describedBy.split(/\s+/).filter(Boolean) : [];
    if (!ids.includes(errorId)) {
        ids.push(errorId);
        input.setAttribute('aria-describedby', ids.join(' '));
    }
}

function clearError(input: HTMLInputElement | HTMLTextAreaElement): void {
    input.removeAttribute('aria-invalid');
    const errorId = errorIdFor(input);

    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy) {
        const ids = describedBy.split(/\s+/).filter((id) => id && id !== errorId);
        if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
        else input.removeAttribute('aria-describedby');
    }

    const errorEl = document.getElementById(errorId);
    if (errorEl) errorEl.remove();
}

/**
 * Branche la validation inline sur un champ. Les règles sont évaluées dans
 * l'ordre ; la première règle en échec fournit le message affiché.
 *
 * Retourne une fonction de détachement (retire les listeners + l'erreur
 * affichée) — utile pour les champs créés dynamiquement et retirés du DOM
 * (ex. fiches adversaire supprimées) afin d'éviter toute fuite de listener.
 */
export function attachValidation(
    input: HTMLInputElement | HTMLTextAreaElement,
    rules: FieldRule[],
): DetachValidation {
    if (!input.id) {
        throw new Error('attachValidation: le champ doit avoir un id (requis pour aria-describedby).');
    }

    let hasErrored = false;

    function validate(): boolean {
        const value = input.value;
        for (const rule of rules) {
            if (!rule.test(value)) {
                showError(input, rule.message);
                hasErrored = true;
                return false;
            }
        }
        clearError(input);
        return true;
    }

    function onBlur(): void {
        validate();
    }

    function onInput(): void {
        // Jamais de validation à la frappe avant la première erreur : on ne
        // veut pas gêner la saisie d'un champ encore incomplet.
        if (hasErrored) validate();
    }

    input.addEventListener('blur', onBlur);
    input.addEventListener('input', onInput);

    return () => {
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('input', onInput);
        clearError(input);
        hasErrored = false;
    };
}
