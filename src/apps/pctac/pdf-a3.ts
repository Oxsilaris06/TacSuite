/**
 * pdf-a3.ts — Synthèse PC-Tac sur UNE page A3 paysage (décision 41).
 *
 * Point d'entrée posé par le CTO avant les ateliers : le bouton PDF (fenêtre
 * de génération, `kind === 'a3'`) appelle `buildA3Pdf(options)` par import
 * dynamique. Le moteur est écrit dans ce fichier par le CTO ; aucun autre
 * atelier n'y touche.
 */

import type { PdfOptions } from '@shared/pdf-options.js';
import { toast } from '@shared/feedback.js';

/** Génère et télécharge la synthèse A3. Rend `false` si rien n'a été produit. */
export async function buildA3Pdf(options: PdfOptions): Promise<boolean> {
    void options;
    toast('Synthèse A3 : en cours de construction.', { kind: 'info' });
    return false;
}
