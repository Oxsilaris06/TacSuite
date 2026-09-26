/**
 * photo-bilan.ts — Bilan des photos non intégrées au PDF de l'OI (point 11,
 * audit PDF du 2026-09-25, F25).
 *
 * Une photo absente de la base était omise, une annotation qui ne se
 * fusionnait pas donnait la photo brute, une image illisible disparaissait à
 * la préparation des images — chaque fois avec un simple `console.warn`. Les
 * pertes sont relevées là où elles se produisent (collecte `pdf-engine-v2.ts`,
 * préparation `pdf/engine-v3.ts`) et montrées AVANT le téléchargement :
 * « N photos non intégrées : … », puis « Télécharger quand même » ou « Annuler ».
 */

import { photoFieldLabel } from '@oi/sections.js';
import { confirmDialog } from '@shared/feedback.js';
import type { OiFormData } from '@shared/types/contracts.js';

export type PhotoIssue = 'annotation' | 'illisible' | 'absente';

const REASONS: Record<PhotoIssue, string> = {
    annotation: 'annotations non fusionnées (photo brute)',
    illisible: 'image illisible',
    absente: 'absente de la base',
};
/** Une perte totale l'emporte sur des annotations perdues. */
const RANK: Record<PhotoIssue, number> = { annotation: 1, illisible: 2, absente: 3 };

/** Section du formulaire d'après l'identifiant du champ photo (préfixe). */
const SECTIONS: ReadonlyArray<[RegExp, string]> = [
    [/^photo_(main|extra|renforts)_|^adversary_/, 'Adversaire'],
    [/^photo_itin_|itineraire/, 'Cheminement'],
    // « Baptême terrain » : sous la Mission (Nico 09-26), ancien champ par bloc compris.
    [/bapteme/, 'Mission'],
    [/^photo_empl_ao_|emplacement_ao/, 'ZMSPCP'],
    [/effrac/, 'Effraction'],
    [/transport/, 'Transport'],
    [/^photo_container_express_/, 'OI Express'],
];

const issues = new Map<string, PhotoIssue>();

/** Nouvelle génération : bilan vide. */
export function resetPhotoBilan(): void {
    issues.clear();
}

/** Relève un problème sur la photo `id`. */
export function notePhotoIssue(id: string, issue: PhotoIssue): void {
    const known = issues.get(id);
    if (!known || RANK[issue] > RANK[known]) issues.set(id, issue);
}

function photoLabel(formData: OiFormData, id: string): string {
    if (id === 'custom_pdf_background') return 'Fond personnalisé';
    for (const [field, metas] of Object.entries(formData.dynamic_photos ?? {})) {
        const index = metas.findIndex((m) => m.id === id);
        const meta = metas[index];
        if (!meta) continue;
        const section = SECTIONS.find(([re]) => re.test(field))?.[1] ?? 'OI';
        // Sans légende : le nom par défaut que le formulaire affiche (Nico 09-26).
        const name = meta.customTitle.trim() || `${photoFieldLabel(field)} (${index + 1}/${metas.length})`;
        return `« ${name} » (${section})`;
    }
    return 'Photo';
}

/** « N photos non intégrées : » puis une ligne par photo, ou null s'il n'y a rien à dire. */
export function photoBilanText(formData: OiFormData): string | null {
    if (!issues.size) return null;
    const n = issues.size;
    const lines = [...issues].map(([id, issue]) => `• ${photoLabel(formData, id)} : ${REASONS[issue]}`);
    return `${n} photo${n > 1 ? 's' : ''} non intégrée${n > 1 ? 's' : ''} :\n${lines.join('\n')}`;
}

/** Avant téléchargement : true s'il n'y a rien à signaler, sinon le choix de l'utilisateur. */
export async function confirmPhotoBilan(formData: OiFormData): Promise<boolean> {
    const text = photoBilanText(formData);
    if (!text) return true;
    return confirmDialog({
        title: 'Photos manquantes dans le PDF',
        message: `${text}\n\n${issues.size > 1
            ? 'Rajoutez-les depuis leur champ photo, ou téléchargez le PDF sans elles.'
            : 'Rajoutez-la depuis son champ photo, ou téléchargez le PDF sans elle.'}`,
        confirmLabel: 'Télécharger quand même',
        cancelLabel: 'Annuler',
    });
}
