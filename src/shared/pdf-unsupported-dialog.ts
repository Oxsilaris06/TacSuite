/**
 * pdf-unsupported-dialog.ts — Avertissement AVANT la génération d'un PDF
 * quand des caractères ne pourront pas être imprimés (décision 44, audit PDF
 * du 2026-09-25) : chinois, émoji… Il nomme le champ et le caractère, puis
 * laisse le choix de continuer (émoji retirés, le reste imprimé « ? ») ou
 * d'annuler pour corriger la saisie. Aucun caractère n'est perdu en silence.
 */

import { confirmDialog } from '@shared/feedback.js';

export interface UnsupportedChars {
    /** Où se trouve le texte, dans les mots de l'écran (« Fiche DURAND Marc — Alias »). */
    where: string;
    chars: readonly string[];
}

const MAX_LISTED = 8;

/** Rend `true` s'il faut générer quand même (ou s'il n'y a rien à signaler). */
export async function confirmUnsupportedChars(items: readonly UnsupportedChars[]): Promise<boolean> {
    const list = items.filter((i) => i.chars.length > 0);
    if (list.length === 0) return true;
    const lines = list.slice(0, MAX_LISTED).map((i) => `• ${i.where} : ${i.chars.join(' ')}`);
    if (list.length > MAX_LISTED) lines.push(`… et ${list.length - MAX_LISTED} autres champs.`);
    return confirmDialog({
        title: 'Caractères non imprimables',
        message: `Ces caractères n'existent dans aucune police du PDF. Les émoji seront retirés, les autres caractères imprimés « ? ».\n\n${lines.join('\n')}`,
        confirmLabel: 'Générer quand même',
        cancelLabel: 'Corriger la saisie',
    });
}
