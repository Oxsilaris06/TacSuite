/**
 * options.ts — Fenêtre de génération PDF de l'OI (décision 42).
 *
 * Le formulaire commun (`buildPdfOptionsForm('oi')` : thème clair par défaut
 * ou sombre, sortie Impression ou Partage < 10 Mo) est monté UNE fois dans la
 * modale d'aperçu existante. Ses choix pilotent les trois sorties (aperçu,
 * téléchargement, « Présenter ici ») et sont retenus d'une fois sur l'autre.
 * Le thème du PDF ne suit donc plus le thème de l'application (audit F02).
 */

import {
    buildPdfOptionsForm,
    loadPdfOptions,
    savePdfOptions,
    type PdfOptions,
    type PdfOptionsForm,
} from '@shared/pdf-options.js';

export const OI_PDF_OPTIONS_KEY = 'oi';

let form: PdfOptionsForm | null = null;

/** Choix courants : le formulaire affiché, sinon les derniers choix retenus. */
export function currentOiPdfOptions(): PdfOptions {
    return form?.element.isConnected ? form.read() : loadPdfOptions(OI_PDF_OPTIONS_KEY);
}

/**
 * Monte le formulaire dans `slot` (idempotent : une réouverture de la modale
 * garde le formulaire en place). `onChange` reçoit les nouveaux choix, déjà
 * retenus, pour régénérer l'aperçu.
 */
export function mountOiPdfOptions(slot: HTMLElement, onChange: (options: PdfOptions) => void): void {
    if (form && slot.contains(form.element)) return;
    const mounted = buildPdfOptionsForm(OI_PDF_OPTIONS_KEY);
    form = mounted;
    slot.replaceChildren(mounted.element);
    mounted.element.addEventListener('change', () => {
        const options = mounted.read();
        savePdfOptions(OI_PDF_OPTIONS_KEY, options);
        onChange(options);
    });
}
