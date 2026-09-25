/**
 * document-meta.ts — Finitions du PDF de l'OI (audit PDF du 2026-09-25, F24
 * et F28) : dates au format français et métadonnées du document. Module pur.
 */

import { currentOiMode } from '@oi/sections.js';
import type { OiFormData } from '@shared/types/contracts.js';

/** Valeur d'un champ date (« 2026-09-25 ») au format français (« 25/09/2026 ») ; toute autre valeur rendue telle quelle. */
export function dateFr(value: unknown): string {
    const v = String(value ?? '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** « Complet » ou « Express » : nom du type d'OI dans les titres et les noms de fichier. */
export function oiModeLabel(formData: OiFormData): 'Complet' | 'Express' {
    return currentOiMode(formData) === 'express' ? 'Express' : 'Complet';
}

/**
 * Métadonnées du PDF (propriétés du fichier, visibles sans l'ouvrir : aperçu
 * de messagerie, index de recherche). Elles ne portent AUCUN nom de personne
 * (ni cible, ni rédacteur) ni le nom de l'opération : seulement le type d'OI,
 * sa date et la mention de protection.
 */
export function oiPdfInfo(formData: OiFormData): { title: string; subject: string; creator: string } {
    const date = dateFr(formData.date_op);
    return {
        title: `OI ${oiModeLabel(formData)}${date ? ` du ${date}` : ''}`,
        subject: 'Ordre initial — CONFIDENTIEL',
        creator: "TacSuite — Générateur d'OI",
    };
}
