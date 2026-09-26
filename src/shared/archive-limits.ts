/**
 * Bornes de taille des archives importées (.pctac.zip, .oi.zip).
 *
 * Audit du 26/09 : aucune borne ; une « zip bomb » de quelques Mo se
 * décompressait en plusieurs Go et faisait planter l'onglet. Consigne de Nico :
 * laisser passer les grosses archives réalistes. Une vraie archive est faite
 * surtout de photos, déjà compressées : décompressée, elle pèse à peu près son
 * poids de fichier. Une bombe gonfle des centaines de fois. D'où un refus sur
 * le TAUX de compression au-delà d'un volume, plus deux plafonds larges.
 *
 * Taux jugé globalement au-delà de 512 Mo, et par entrée au-delà de 32 Mo
 * (revue du 26/09 : une bombe de 1 Mo gonflée à 511 Mo passait).
 *
 * Limite connue : les tailles lues sont celles que l'archive DÉCLARE. JSZip
 * vérifie la taille réelle après décompression ; une archive forgée qui ment
 * sur ses tailles passe ce contrôle, comme avant.
 */
import type JSZip from 'jszip';

const MB = 1024 * 1024;
/** En dessous, aucune archive n'est refusée pour son taux de compression. */
const RATIO_FLOOR = 512 * MB;
/** Taux de compression global au-delà duquel un gros contenu est refusé. */
const MAX_RATIO = 20;
/** Plafond absolu du contenu décompressé. */
const TOTAL_MAX = 4 * 1024 * MB;
/** Un fichier JSON (data.json, trace GPX) est lu en entier comme texte. */
const JSON_MAX = 128 * MB;
/** Revue du 26/09 : au-delà de ce poids, une entrée est aussi jugée à son taux. */
const ENTRY_RATIO_FLOOR = 32 * MB;
/** Taux par entrée : un JSON ordinaire se compresse 5 à 20 fois, une bombe des centaines. */
const ENTRY_MAX_RATIO = 50;

const REFUSED = 'Aucune donnée modifiée.';

function fmt(bytes: number): string {
    return bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(1)} Go` : `${Math.round(bytes / MB)} Mo`;
}

/** Message de refus, ou `null` si l'archive peut être ouverte. */
export function archiveSizeVerdict(entries: ReadonlyArray<{ name: string; size: number; compressed?: number }>, fileSize: number): string | null {
    let total = 0;
    for (const e of entries) {
        if (e.name.endsWith('.json') && e.size > JSON_MAX) {
            return `Archive refusée : le fichier JSON « ${e.name.slice(0, 60)} » est trop gros (${fmt(e.size)}, limite ${fmt(JSON_MAX)}). ${REFUSED}`;
        }
        if (e.compressed !== undefined && e.size > ENTRY_RATIO_FLOOR && e.size > ENTRY_MAX_RATIO * Math.max(e.compressed, 1)) {
            return `Archive refusée : contenu décompressé trop volumineux (« ${e.name.slice(0, 60)} » : ${fmt(e.size)} pour ${fmt(e.compressed)} compressés). ${REFUSED}`;
        }
        total += e.size;
    }
    if (total > TOTAL_MAX || (total > RATIO_FLOOR && total > MAX_RATIO * Math.max(fileSize, 1))) {
        return `Archive refusée : contenu décompressé trop volumineux (${fmt(total)} pour un fichier de ${fmt(fileSize)}). ${REFUSED}`;
    }
    return null;
}

/** Tailles décompressées déclarées par les entrées d'une archive JSZip. */
export function zipEntrySizes(zip: JSZip): Array<{ name: string; size: number; compressed?: number }> {
    const out: Array<{ name: string; size: number; compressed?: number }> = [];
    zip.forEach((name, entry) => {
        if (entry.dir) return;
        // JSZip ne publie pas ces tailles : champs internes, lus au plus près
        // (0 si absents, l'entrée ne compte alors pas).
        const data = (entry as unknown as { _data?: { uncompressedSize?: unknown; compressedSize?: unknown } })._data;
        const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
        const compressed = num(data?.compressedSize);
        out.push(compressed === undefined ? { name, size: num(data?.uncompressedSize) ?? 0 } : { name, size: num(data?.uncompressedSize) ?? 0, compressed });
    });
    return out;
}
