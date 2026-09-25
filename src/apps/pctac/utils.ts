/**
 * utils.ts — Utilitaires globaux pour PC-Tac
 * ==========================================
 *
 * Port TypeScript de `modules/pctac/utils.js` (GStart-main, 52 LOC).
 */

import { confirmDialog } from '@shared/feedback.js';

type ImageSource = File | Blob | string;

/** HEIC/HEIF par type MIME, ou par extension quand le type est vide. */
function looksLikeHeic(source: ImageSource): boolean {
    if (typeof source === 'string') return false;
    const type = (source.type || '').toLowerCase();
    if (type === 'image/heic' || type === 'image/heif') return true;
    if (type) return false; // un type MIME explicite non-HEIC tranche
    const name = source instanceof File ? source.name.toLowerCase() : '';
    return name.endsWith('.heic') || name.endsWith('.heif');
}

/** Cœur de la compression : charge la source (Blob/File OU dataURL) puis encode en JPEG. */
function compressViaCanvas(
    source: ImageSource,
    maxWidth: number,
    maxHeight: number,
    quality: number,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // Calcul des dimensions en conservant l'aspect ratio (utils.js:22-31)
            if (width > height) {
                if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
            } else if (height > maxHeight) {
                width *= maxHeight / height; height = maxHeight;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Failed to get canvas context')); return; }
            ctx.drawImage(img, 0, 0, width, height);
            // Sortie TOUJOURS en image/jpeg ; le canvas retire l'EXIF (aucune
            // position GPS ne survit donc dans l'image enregistrée).
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Image illisible'));

        if (typeof source === 'string') {
            img.src = source;
            return;
        }
        // Blob/File : passer par une URL objet (pas de base64 intermédiaire).
        let url = '';
        try {
            url = URL.createObjectURL(source);
        } catch {
            // Repli FileReader (environnements sans URL.createObjectURL).
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result;
                if (typeof result === 'string') img.src = result;
                else reject(new Error('FileReader did not return a string'));
            };
            reader.onerror = reject;
            reader.readAsDataURL(source);
            return;
        }
        img.addEventListener('load', () => { try { URL.revokeObjectURL(url); } catch { /* no-op */ } }, { once: true });
        img.src = url;
    });
}

/** Conversion HEIC/HEIF → JPEG par `heic-to`, chargé À LA DEMANDE (décision 34). */
async function heicToJpeg(source: Blob): Promise<Blob> {
    const { heicTo } = await import('heic-to');
    return heicTo({ blob: source, type: 'image/jpeg', quality: 0.9 });
}

export const Utils = {
    /**
     * Nom de fichier lisible pour une exportation (décision 32) :
     * `PC-Tac_<Situation>_<AAAA-MM-JJ>_<HHhMM>.<ext>`, en heure LOCALE.
     *
     * L'ASCII d'abord (accents retirés par NFD), puis les caractères interdits
     * sous Windows (`\ / : * ? " < > |`) et les espaces remplacés par des tirets,
     * les tirets répétés réduits. Le nom ne porte JAMAIS de nom de personne.
     *
     * @param situationLabel Libellé de situation (« Forcené », « Tuerie planifiée »…)
     * @param date           Date d'export (heure locale)
     * @param ext            Extension, gardée telle quelle (`pdf`, `pctac.zip`…)
     */
    readableFileName(situationLabel: string, date: Date, ext: string): string {
        const situation = situationLabel
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
        const pad = (n: number): string => String(n).padStart(2, '0');
        const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
            + `_${pad(date.getHours())}h${pad(date.getMinutes())}`;
        return `PC-Tac_${situation}_${stamp}.${ext}`;
    },

    /**
     * Compresse une image (redimensionnement et qualité JPEG).
     *
     * Accepte un File, un Blob OU une dataURL. HEIC/HEIF (décision 34) : on
     * essaie d'abord le décodage NATIF (Safari sait), puis on convertit via
     * `heic-to` chargé à la demande. Échec (hors ligne sans convertisseur,
     * fichier corrompu) : on jette une erreur claire, RIEN n'est enregistré.
     *
     * La sortie est TOUJOURS 'image/jpeg' ; le canvas retire l'EXIF (la position
     * GPS éventuelle n'est donc jamais conservée dans l'image enregistrée).
     */
    async compressImage(
        source: ImageSource,
        maxWidth: number = 1024,
        maxHeight: number = 1024,
        quality: number = 0.7,
    ): Promise<string> {
        if (source instanceof Blob && looksLikeHeic(source)) {
            try {
                return await compressViaCanvas(source, maxWidth, maxHeight, quality);
            } catch {
                try {
                    const jpeg = await heicToJpeg(source);
                    return await compressViaCanvas(jpeg, maxWidth, maxHeight, quality);
                } catch {
                    throw new Error('Photo HEIC illisible : conversion impossible (hors ligne ou fichier corrompu).');
                }
            }
        }
        return compressViaCanvas(source, maxWidth, maxHeight, quality);
    },

    /**
     * Lit la position GPS EXIF du fichier D'ORIGINE (avant conversion/compression)
     * via `exifr`, puis propose de poser un point sur le plan (décision 34).
     * `label` : légende de la photo ou nom de la fiche. La position n'est jamais
     * gardée dans l'image (le canvas retire l'EXIF). Ne jette jamais.
     */
    async promptGpsPoint(source: ImageSource, label: string): Promise<void> {
        if (typeof source === 'string') return;
        let position: { latitude: number; longitude: number } | null = null;
        try {
            const { gps } = await import('exifr');
            position = (await gps(source)) ?? null;
        } catch {
            return; // pas d'EXIF lisible : aucune question
        }
        if (!position || typeof position.latitude !== 'number' || typeof position.longitude !== 'number') return;
        const place = await confirmDialog({
            message: 'Cette photo contient une position GPS. Placer un point sur le plan ?',
            confirmLabel: 'Placer un point',
            cancelLabel: 'Non',
        });
        if (!place) return;
        document.dispatchEvent(new CustomEvent('pctac:add-point', {
            detail: { lat: position.latitude, lon: position.longitude, label },
        }));
    },

    /**
     * R10 — récapitulatif du toast de la passerelle OI → PC-Tac. Un OI qui
     * n'apporte que des photos (A6) doit le dire, sinon l'opérateur lit
     * « 0 adversaire(s), 0 intervenant(s) » et croit que rien n'est passé.
     *
     * C14 / K2 — les fiches FUSIONNÉES avec une existante sont désormais
     * comptées à part (`advMerged`) : elles ne sont ni des adversaires ajoutés,
     * ni des doublons ignorés.
     */
    oiImportSummaryParts(res: {
        advAdded: number;
        advPhotos: number;
        paxAdded: number;
        gridImported?: boolean | undefined;
        galleryAdded?: number | undefined;
        galleryUpdated?: number | undefined;
        advMerged?: number | undefined;
        galleryPreserved?: number | undefined;
    }): string[] {
        const parts = [`${res.advAdded} adversaire(s)`];
        if (res.advPhotos) parts.push(`${res.advPhotos} photo(s)`);
        parts.push(`${res.paxAdded} intervenant(s)`);
        if (res.advMerged) parts.push(`${res.advMerged} fiche(s) fusionnée(s)`);
        if (res.gridImported) parts.push('le carroyage');
        if (res.galleryAdded) parts.push(`${res.galleryAdded} photo(s) de l'OI`);
        if (res.galleryUpdated) parts.push(`${res.galleryUpdated} photo(s) mise(s) à jour`);
        // F12 : une photo modifiée au PC (légende, annotation) n'est pas écrasée
        // par le réimport ; on le dit, sinon l'opérateur croit avoir la dernière
        // version de l'OI.
        if (res.galleryPreserved) parts.push(`${res.galleryPreserved} photo(s) modifiée(s) au PC gardée(s)`);
        return parts;
    },

    /**
     * R accord (double toast d'import) — `Archive.importFile` affiche DÉJÀ son
     * récapitulatif quand il y a des fiches remplacées/fusionnées ou des clés
     * ignorées. `main.ts` ne doit alors PAS ajouter « Archive importée avec
     * succès. » : un seul message, le récapitulatif.
     *
     * C13 / K1 — `warned` est posé par `archive.ts` quand il a DÉJÀ affiché un
     * toast d'échec partiel (photos/GPX non restaurés) : le succès générique
     * doit être supprimé dans ce cas aussi.
     */
    archiveImportHasRecap(summary: {
        replacedFiches: readonly string[];
        mergedFiches: readonly string[];
        unknownKeys: number;
        warned?: boolean | undefined;
    }): boolean {
        return summary.warned === true
            || summary.replacedFiches.length > 0
            || summary.mergedFiches.length > 0
            || summary.unknownKeys > 0;
    },
};
