/**
 * generation-lock.ts — Une génération PDF à la fois dans l'OI (audit F23).
 *
 * Un double clic sur « Télécharger » lançait deux générations et deux
 * téléchargements, et doublait le pic mémoire sur téléphone. Le verrou est
 * pris de façon SYNCHRONE au clic, avant toute attente : un second clic (ou
 * un « Présenter ici », un PDF PATRAC…) pendant une génération est refusé avec
 * un message. Seul l'aperçu peut remplacer un aperçu en cours (le plus récent
 * l'emporte, cf. `cancelPendingPreviewRender`, `pdf-engine-v2.ts`).
 */

import { toast } from '@shared/feedback.js';

export type PdfJob = 'telechargement' | 'apercu' | 'presentation' | 'patrac';

let current: { job: PdfJob; token: number } | null = null;
let seq = 0;

/** Prend le verrou (jeton à rendre par `releasePdfLock`), ou `null` si une
 *  autre génération est en cours (message affiché). */
export function acquirePdfLock(job: PdfJob): number | null {
    if (current && !(current.job === 'apercu' && job === 'apercu')) {
        toast('Un PDF est déjà en cours de génération : patientez quelques secondes.', { kind: 'info' });
        return null;
    }
    seq += 1;
    current = { job, token: seq };
    return seq;
}

/** Rend le verrou, seulement s'il est encore tenu par ce jeton (un aperçu
 *  remplacé ne libère pas celui qui l'a remplacé). */
export function releasePdfLock(token: number): void {
    if (current?.token === token) current = null;
}
