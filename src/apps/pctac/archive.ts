/**
 * archive.ts — Export/import `.pctac.zip`, snapshot+rollback, passerelle OI.
 * ============================================================================
 *
 * Port TypeScript de `modules/pctac/archive.js` (GStart-main, 459 LOC).
 *
 * PIÈGES CRITIQUES — ce module peut DÉTRUIRE les données de l'utilisateur :
 *  1. Validation du manifest AVANT toute modification (archive.js:129-147) :
 *     une archive invalide est refusée SANS RIEN EFFACER.
 *  2. Double snapshot (localStorage + images IndexedDB) et `rollback()`
 *     INTÉGRAL sur échec (archive.js:160-232).
 *  3. Les images sont écrites en `.txt` à l'export mais l'import ACCEPTE
 *     `.txt` ET `.bin` (archive.js:218).
 *  4. Passerelle OI : dédoublonnage par `_normName` ; repli sur le nom
 *     d'image non encodé (archive.js:369-370).
 */

import JSZip from 'jszip';

import type {
    ArchiveContract,
    ArchiveImportResult,
    ArchiveOiImportResult,
    OiAnnotation,
    PctacCollectionItem,
    PctacLogEntry,
} from '@shared/types/contracts.js';
import { Storage, clearSituationData } from '@pctac/storage.js';
import { GpxStore, ImageStore } from '@pctac/image-store.js';
import { origId, renderAnnotated } from '@pctac/photo-annotation.js';
import { confirmDialog, toast } from '@shared/feedback.js';
import {
    applyScope,
    askImportScope,
    scopeCarriesGpx,
    scopeCarriesImages,
    type ApplyScopeReport,
} from '@pctac/import-scope.js';
import { GPX_INDEX_KEY, GRID_KEY, OVERLAYS_KEY, PINS_KEY } from '@pctac/planmap/constants.js';
import { safePinColor, safePinIcon } from '@pctac/planmap/pin-safe.js';
import { recordTombstone } from '@pctac/tombstones.js';
import { archiveSizeVerdict, zipEntrySizes } from '@shared/archive-limits.js';
import { isTacticalGridSpec } from '@shared/tactical-grid.js';
import { PCTAC_MODES, SHARED_KEYS, currentModeId, persistModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';
import { findDuplicatePerson, normalizeDob } from '@pctac/fiche.js';
import { mergePersonIntoExisting, syncMergedGallery, type MergeGallerySide } from '@pctac/fiche-merge.js';
import { Utils } from '@pctac/utils.js';
import { mergeLegacyBaptemePhotos, photoFieldLabel } from '@oi/sections.js';
import {
    LOCAL_STORAGE_KEY, TP_ASSOC_KEY,
    ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY,
    FREE_MODE_COLORS, safeHexColor, DELETED_KEY,
} from '@pctac/config.js';

// Clé localStorage de l'Ordre Initial (générateur 4.html). L'archive .oi.zip
// contient { data.json: { 'tactical_oi_data': "<JSON>" }, images/<id>.bin, images.json }.
// archive.js:11
const OI_LOCAL_STORAGE_KEY = 'tactical_oi_data';

/**
 * Manifest d'archive (`manifest.json`), commun aux deux formats PC TAC / OI.
 * Contenu JSON désérialisé → interface locale + gardes (aucun `any`).
 */
interface ArchiveManifest {
    appName?: string;
    version?: number | string;
    createdAt?: string;
    /** Situation d'origine de l'archive (absent = ancien format → Forcené). */
    situation?: unknown;
}

/** Vrai si `value` désigne une situation connue. */
function isModeIdValue(value: unknown): value is PctacModeId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PCTAC_MODES, value);
}

/** Lit une clé localStorage et rend la liste d'objets qu'elle porte (best-effort). */
function readCollectionList(raw: string | null | undefined): Array<Record<string, unknown>> {
    if (!raw) return [];
    try {
        const v: unknown = JSON.parse(raw);
        return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
    } catch {
        return [];
    }
}

/**
 * Ids d'images IndexedDB référencés par une situation, relus dans un snapshot
 * localStorage BRUT (donc avant tout effacement). Sert au remplacement
 * intégral : retirer exactement ces blobs, sans toucher au magasin partagé.
 */
function collectImageIds(snapshot: Record<string, string | null>): string[] {
    const ids = new Set<string>();
    [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach((k) => {
        readCollectionList(snapshot[k]).forEach((item) => {
            const id = typeof item.id === 'string' ? item.id : '';
            if (!id) return;
            if (item.hasImage === true || k === PHOTOS_KEY) ids.add(id);
            ids.add(id + '_sync');
            ids.add(id + '_orig'); // original d'une photo annotée (décision 25)
        });
    });
    readCollectionList(snapshot[PINS_KEY]).forEach((pin) => {
        const pid = typeof pin.photoId === 'string' ? pin.photoId : '';
        if (pid) ids.add(pid);
    });
    return [...ids];
}

/** Sous-ensemble utile d'un adversaire du Générateur d'OI (structure best-effort, 4.html). */
interface OiAdversaryEntry {
    id?: string;
    nom_adversaire?: string;
    date_naissance?: string;
    antecedents_adversaire?: string;
    attitude_adversaire?: string;
    substances_adversaire?: string;
    armes_connues?: string;
    domicile_adversaire?: string;
    profession_adversaire?: string;
    stature_adversaire?: string;
    ethnie_adversaire?: string;
}

/** Membre PATRACDVR (trigramme) du Générateur d'OI. */
interface OiPatracdvrMember {
    trigramme?: string;
}

interface OiPatracdvrRow {
    members?: OiPatracdvrMember[];
}

/** Entrée `dynamic_photos[<clé>]` : image liée à un contenant de l'OI. */
interface OiDynamicPhotoEntry {
    id?: string;
    /** JSON du moteur d'annotation (`formulaires.ts`), commun au PC-Tac. */
    annotations?: unknown;
    /** Légende saisie dans l'OI (formulaires « Photos HD »). */
    customTitle?: string;
}

/** Sous-ensemble utile de `tactical_oi_data` désérialisé (structure best-effort). */
interface OiData {
    adversaries?: OiAdversaryEntry[];
    dynamic_photos?: Record<string, OiDynamicPhotoEntry[]>;
    patracdvr_rows?: OiPatracdvrRow[];
    patracdvr_unassigned?: OiPatracdvrMember[];
    /** Ordre des blocs ZMSPCP : numérote les anciennes photos « Baptême Terrain » par bloc. */
    zmspcp_blocks?: { id?: unknown }[];
    /** Seul le carroyage est repris de la carto OI (`grid`, `@shared/tactical-grid`). */
    cartography?: { grid?: unknown };
}

/** Normalise un nom/trigramme pour la déduplication (sans accents, casse, espaces). */
// archive.js:13-18
function _normName(s: unknown): string {
    // (s || '').toString() de l'original : tout falsy devient chaîne vide.
    const str = s ? String(s) : '';
    // Forme échappée (plage U+0300-U+036F, combinantes NFD) — strictement
    // équivalente aux caractères bruts de l'original, robuste au
    // copier-coller/diff (cf. SPEC-PCTAC-CONVERSION.md §9, même piège que config.js:159).
    return str
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Archive tout-en-un (.pctac.zip) — remplace l'ancien transfert QR code.
 *
 * Contenu du zip :
 *   - manifest.json (version + horodatage)
 *   - data.json   (toutes les collections localStorage)
 *   - images/<id>.bin  (data URL bruts pour chaque image IndexedDB)
 *
 * Pourquoi : un seul fichier portable, taille indéterminée, dezippable
 * par le navigateur via JSZip. Aucun besoin de scanner plusieurs QR codes.
 */

/**
 * Identifiant de fiche admissible. Les ids générés ici (horodatage, `oi_adv_…`,
 * `…_sync`, pions `kind_id_date`) n'emploient que ces caractères ; un id venu
 * d'ailleurs finit dans des gestionnaires en ligne (photos, journal) où un
 * guillemet deviendrait du code exécuté (revue neuve 398b11e, constat XSS).
 */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Collections d'une archive dont les ids sont rendus dans la page. */
const ID_BEARING_KEYS = [LOCAL_STORAGE_KEY, ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY, 'pcTacPlanPins'];

/** Premier identifiant hors format dans `data.json`, ou `null`. */
export function findUnsafeId(dataJson: Record<string, unknown>): string | null {
    for (const key of ID_BEARING_KEYS) {
        const raw = dataJson[key];
        if (typeof raw !== 'string') continue;
        let list: unknown;
        try { list = JSON.parse(raw); } catch { continue; }
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (item && typeof item === 'object' && 'id' in item) {
                const id = String((item as { id: unknown }).id);
                if (!SAFE_ID.test(id)) return id;
            }
        }
    }
    return null;
}

/**
 * A1 — frontière d'import : `paxColor` des entrées de main courante et `color`
 * des intervenants personnalisés sont normalisés (`#rrggbb`, sinon couleur par
 * défaut). Le rendu pose déjà la couleur par l'API DOM ; ici, on évite qu'une
 * valeur forgée vive dans le stockage et reparte dans un export. Les valeurs
 * qui ne sont pas un tableau JSON sont laissées à la liste blanche.
 */
export function sanitizeImportColors(dataJson: Record<string, string>): Record<string, string> {
    const fallback = FREE_MODE_COLORS[0]?.hex ?? '';
    const fix = (key: string, field: string): void => {
        const raw = dataJson[key];
        if (typeof raw !== 'string') return;
        let list: unknown;
        try { list = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(list)) return;
        let changed = false;
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const rec = item as Record<string, unknown>;
            const value = rec[field];
            if (value === undefined || value === '') continue;
            const safe = safeHexColor(value, fallback);
            if (safe !== value) { rec[field] = safe; changed = true; }
        }
        if (changed) dataJson[key] = JSON.stringify(list);
    };
    fix(LOCAL_STORAGE_KEY, 'paxColor');
    fix(CUSTOM_PAX_KEY, 'color');
    // V1 (revue neuve du 25/09) — points du plan : couleur hex/rgb, icône du
    // catalogue seulement (sinon retirée) ; le panneau « Changer icône » les
    // insérait tels quels dans un innerHTML.
    const rawPins = dataJson[PINS_KEY];
    if (typeof rawPins === 'string') {
        try {
            const list = JSON.parse(rawPins) as unknown;
            if (Array.isArray(list)) {
                let changed = false;
                for (const item of list) {
                    if (!item || typeof item !== 'object') continue;
                    const rec = item as Record<string, unknown>;
                    if (rec.color !== undefined) {
                        const safe = safePinColor(typeof rec.color === 'string' ? rec.color : undefined);
                        if (safe !== rec.color) { rec.color = safe; changed = true; }
                    }
                    if (rec.icon !== undefined) {
                        const safe = safePinIcon(rec.icon);
                        if (safe !== rec.icon) { if (safe === undefined) delete rec.icon; else rec.icon = safe; changed = true; }
                    }
                }
                if (changed) dataJson[PINS_KEY] = JSON.stringify(list);
            }
        } catch { /* liste illisible : la liste blanche et findUnsafeId font le reste */ }
    }
    return dataJson;
}

/**
 * A3 — applique des deltas (fusions par id, ajouts) à une liste RELUE du
 * stockage, juste avant l'écriture : ce qu'un autre onglet a écrit entre la
 * lecture initiale et l'écriture est conservé. Une fiche fusionnée qui a été
 * supprimée ailleurs entre-temps est réécrite (l'import l'apporte).
 */
function applyDeltas(
    fresh: readonly PctacCollectionItem[],
    mergedById: ReadonlyMap<string, PctacCollectionItem>,
    adds: readonly PctacCollectionItem[],
): PctacCollectionItem[] {
    const out = fresh.map((it) => mergedById.get(String(it.id)) ?? it);
    const present = new Set(out.map((it) => String(it.id)));
    for (const [id, it] of mergedById) if (!present.has(id)) { out.push(it); present.add(id); }
    for (const it of adds) if (!present.has(String(it.id))) { out.push(it); present.add(String(it.id)); }
    return out;
}

const COLLECTION_KEYS = [
    LOCAL_STORAGE_KEY, TP_ASSOC_KEY,
    ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY,
    // A7 : pierres tombales des suppressions, voyagent avec l'archive.
    DELETED_KEY,
    'pcTacPlanPins', 'pcTacPlanShapes', 'pcTacPlanView',
    // Carroyage tactique : désigne les cases à la radio, doit voyager avec le plan.
    'pcTacPlanGrid',
    // Tableau de liens (dashboard.js) : positions des nœuds + liens manuels.
    // C-KEY : clé localStorage 'pcTacDashboard' (constante DASHBOARD_KEY de config.js).
    // Littéral assumé volontairement — le board ne stocke aucune image propre, juste
    // des positions/liens — pour garder archive.js indépendant de l'ordre de mise à
    // jour de config.js (un import nommé manquant casserait tout le graphe ESM).
    'pcTacDashboard',
    // Historique des lieux de la main courante : il est EFFACÉ par clearAllData à
    // l'import — sans cette clé il était perdu à chaque restauration d'archive.
    'pcTacLieuHistory',
    // Verrou global du plan : clearAllData l'efface désormais — il doit voyager
    // dans l'archive (et être couvert par le snapshot de rollback).
    'pcTacPlanLocked',
    // Index des traces GPX (nom, couleur, visibilité, bornes de temps). Les
    // COORDONNÉES, elles, voyagent dans le dossier `gpx/` du zip, comme les
    // images : elles pèsent trop pour localStorage.
    // ⚠ Cette clé est volontairement ABSENTE de `clearSituationData()` (que
    // l'import utilise) : un import ne doit jamais effacer les traces locales
    // (décision Nico : fusion). Elle est en revanche effacée par la
    // réinitialisation totale via `Storage.clearAllData()`.
    GPX_INDEX_KEY,
];

/** Version de format d'archive écrite par `exportZip` (`manifest.version`). */
export const ARCHIVE_VERSION = 1;

/**
 * K3 : nom RÉELLEMENT donné au dernier téléchargement d'archive réussi. Sert à
 * la confirmation du RESET, qui nommait un fichier calculé avant l'export alors
 * que le zip n'est écrit qu'après lecture des images et compression DEFLATE.
 */
let lastExportedName: string | null = null;

/**
 * R9 point 3 : fiche existante à OUVRIR une fois l'import terminé, quand
 * l'opérateur a choisi « Ouvrir l'existante » dans le dialogue de doublon.
 */
let pendingOpenFiche: { side: MergeGallerySide; id: string } | null = null;

function requestOpenFiche(side: MergeGallerySide, id: string): void {
    pendingOpenFiche = { side, id };
}

/**
 * Ouvre, une seule fois, la fiche demandée pendant l'import. Diffusé aussi en
 * événement `pctac:open-fiche` pour tout observateur (UI, tests) ; l'import
 * dynamique évite de lier `archive.ts` à l'écran des fiches au chargement.
 */
async function flushPendingOpenFiche(): Promise<void> {
    const pending = pendingOpenFiche;
    if (!pending) return;
    pendingOpenFiche = null;
    try {
        document.dispatchEvent(new CustomEvent('pctac:open-fiche', { detail: pending }));
    } catch { /* hors DOM : seul l'import ci-dessous compte */ }
    // F11 : l'import part du dock, depuis n'importe quelle vue ; sur tablette
    // et bureau la fiche s'ouvre DANS la vue de son camp : on l'active d'abord.
    try {
        const sw = (window as unknown as { switchMainView?: (v: string) => void }).switchMainView;
        if (typeof sw === 'function') sw(pending.side === 'adv' ? 'view-adversaires' : 'view-otages');
    } catch { /* vue indisponible : la fiche s'ouvre quand même */ }
    try {
        const mod = await import('@pctac/fiche-sheet.js');
        await mod.openFiche(pending.side, pending.id);
    } catch (e) {
        console.warn('[Archive] ouverture de la fiche existante impossible:', e);
    }
}

/** Clés qu'un import a le DROIT d'écrire : exactement celles que `exportZip` produit. */
const IMPORT_WHITELIST: ReadonlySet<string> = new Set(COLLECTION_KEYS);

/** Collections de fiches : récapitulatif de remplacement et doublons. */
const FICHE_KEYS: readonly string[] = [ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY];

/**
 * Filtre les clés de `data.json` : ne garde que la liste blanche, ignore et
 * compte le reste. Une clé COMMUNE (`SHARED_KEYS`, ex. `pcTacTchapLive`) n'est
 * JAMAIS écrite par un import : elle appartient au poste, pas à une archive.
 */
export function filterImportKeys(dataJson: Record<string, unknown>): {
    allowed: Record<string, string>;
    unknownKeys: number;
} {
    const allowed: Record<string, string> = {};
    let unknownKeys = 0;
    Object.entries(dataJson).forEach(([key, value]) => {
        if (SHARED_KEYS.has(key) || !IMPORT_WHITELIST.has(key) || typeof value !== 'string') {
            unknownKeys += 1;
            return;
        }
        allowed[key] = value;
    });
    return { allowed, unknownKeys };
}

/** Nom lisible d'une fiche (« Prénom Nom »), pour le récapitulatif. */
export function ficheDisplayName(item: Record<string, unknown>): string {
    const prenom = typeof item.prenom === 'string' ? item.prenom.trim() : '';
    const nom = typeof item.nom === 'string' ? item.nom.trim() : '';
    return [prenom, nom].filter(Boolean).join(' ') || 'Sans nom';
}

/**
 * Signature d'annotations, pour comparer ce que l'OI a FOURNI (champ
 * `oiAnnotations` mémorisé) à ce que porte l'entrée (C2/R6). Une valeur vide,
 * `[]`, `null` ou absente vaut « aucune annotation ».
 */
function annotationSignature(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    if (Array.isArray(raw)) return raw.length ? JSON.stringify(raw) : '';
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    return trimmed === '' || trimmed === '[]' || trimmed === 'null' ? '' : trimmed;
}

/**
 * Fusionne l'index des traces de l'archive avec celui déjà présent.
 * JAMAIS de remplacement : une archive ancienne, sans traces, laisse les
 * traces locales intactes ; une archive qui en contient les ajoute. À id égal,
 * l'entrée de l'archive gagne, puisque ses coordonnées viennent d'être
 * réécrites par-dessus.
 * Ne jette jamais : un index illisible d'un côté ou de l'autre est ignoré.
 */
export function mergeGpxIndex(localRaw: string | null, archiveRaw: string | undefined): string | null {
    const parse = (raw: string | null | undefined): Array<{ id?: unknown }> => {
        if (!raw) return [];
        try {
            const v: unknown = JSON.parse(raw);
            return Array.isArray(v) ? (v as Array<{ id?: unknown }>) : [];
        } catch {
            return [];
        }
    };
    const local = parse(localRaw);
    const fromArchive = parse(archiveRaw);
    if (!fromArchive.length) return localRaw ?? null;

    const byId = new Map<string, { id?: unknown }>();
    for (const t of local) { if (t && typeof t.id === 'string') byId.set(t.id, t); }
    for (const t of fromArchive) { if (t && typeof t.id === 'string') byId.set(t.id, t); }
    return JSON.stringify([...byId.values()]);
}

/** Ids des traces déclarées dans l'index localStorage. Ne jette jamais. */
function gpxTrackIds(): string[] {
    try {
        const raw = localStorage.getItem(scopedKey(GPX_INDEX_KEY));
        if (!raw) return [];
        const v: unknown = JSON.parse(raw);
        if (!Array.isArray(v)) return [];
        return v.map((t) => (t && typeof (t as { id?: unknown }).id === 'string' ? (t as { id: string }).id : ''))
            .filter((id) => id !== '');
    } catch {
        return [];
    }
}

/**
 * Signale et traite les doublons de personnes parmi les fiches AJOUTÉES par
 * l'import (id différent mais `findDuplicatePerson` positive). Pour chacune,
 * « Fusionner » complète la fiche existante (`mergePersonIntoExisting`, champs
 * vides seulement, images recopiées vers l'id gardé) et retire l'importée,
 * « Garder les deux » ne touche à rien. Rend les noms des fiches fusionnées.
 *
 * `modeId` est la situation CIBLE de l'archive : elle peut différer de celle
 * affichée (décision 2). Lire ou écrire via la situation courante fusionnerait
 * dans la mauvaise situation et effacerait les photos de la fiche importée
 * (R1). La recopie d'images est UNIQUE (`fiche-merge.ts`, A-4).
 */
export async function resolveDuplicateFiches(
    addedByKey: Record<string, Array<Record<string, unknown>>>,
    modeId: PctacModeId = currentModeId(),
): Promise<string[]> {
    const mergedNames: string[] = [];
    for (const key of FICHE_KEYS) {
        const added = addedByKey[key] ?? [];
        if (!added.length) continue;
        // Seules les fiches adversaire/protégée ont une copie galerie `_sync`.
        const side: MergeGallerySide | null = key === ADVERSARIES_KEY ? 'adv'
            : key === HOSTAGES_KEY ? 'host'
            : null;
        let list = Storage.loadCollection(key, modeId);
        for (const incoming of added) {
            if (!incoming || typeof incoming.id !== 'string') continue;
            const candidate = incoming as PctacCollectionItem;
            const existing = findDuplicatePerson(list, candidate);
            if (!existing) continue;
            const name = ficheDisplayName(incoming);
            // F10 : une fiche d'ami n'a pas d'écran de fiche à ouvrir : pas de
            // troisième choix qui ne ferait rien.
            const ask = {
                title: 'Fiche en double',
                confirmLabel: 'Fusionner',
                cancelLabel: 'Garder les deux',
            };
            const choice: boolean | 'extra' = side
                ? await confirmDialog({
                    ...ask,
                    message: `La fiche « ${name} » semble déjà exister. Fusionner les deux fiches (les champs vides de l'existante seront complétés), garder les deux, ou ouvrir l'existante ?`,
                    extraLabel: "Ouvrir l'existante",
                })
                : await confirmDialog({
                    ...ask,
                    message: `La fiche « ${name} » semble déjà exister. Fusionner les deux fiches (les champs vides de l'existante seront complétés), ou garder les deux ?`,
                });
            // R9 point 3 : garder les deux fiches ET demander l'ouverture de
            // l'existante une fois l'import fini.
            if (choice === 'extra') {
                if (side) requestOpenFiche(side, String(existing.id));
                continue;
            }
            if (choice !== true) continue;
            const { merged, photoTaken } = await mergePersonIntoExisting(existing, candidate);
            // A3 — relecture juste avant l'écriture : un autre onglet a pu
            // écrire pendant le dialogue ; seul le delta est appliqué.
            list = Storage.loadCollection(key, modeId)
                .filter((it) => it.id !== candidate.id)
                .map((it) => (it.id === existing.id ? merged : it));
            if (!list.some((it) => it.id === existing.id)) list.push(merged);
            Storage.saveCollection(key, list, modeId);
            // V5 — la fiche entrante fondue dans l'existante ne doit pas revenir
            // au réimport de la même archive (ni reposer la question du doublon).
            recordTombstone(key, String(candidate.id), modeId);
            // C4/C12 : la galerie suit la fusion (vignette morte retirée, photo
            // reprise visible) — même fonction commune que l'import d'OI.
            if (side) syncMergedGallery(side, candidate.id, merged, { photoTaken, modeId });
            try { await ImageStore.deleteMany([candidate.id, candidate.id + '_sync', candidate.id + '_orig']); }
            catch { /* best-effort */ }
            mergedNames.push(name);
        }
    }
    return mergedNames;
}

/** Noms lisibles des fiches remplacées par l'archive (fusion). */
function ficheNamesByKey(byKey: Record<string, Array<Record<string, unknown>>>): string[] {
    const names: string[] = [];
    FICHE_KEYS.forEach((key) => {
        (byKey[key] ?? []).forEach((item) => names.push(ficheDisplayName(item)));
    });
    return names;
}

/** Message du récapitulatif d'import, ou `null` s'il n'y a rien à dire. */
export function importSummaryMessage(
    replacedFiches: readonly string[],
    mergedFiches: readonly string[],
    unknownKeys: number,
    /** A7 — fiches ajoutées par l'import (hors fusions, déjà nommées). */
    addedFiches: readonly string[] = [],
    /** A7 — supprimés ici, non repris : fiches nommées, autres éléments comptés. */
    skipped: { fiches: readonly string[]; others: number } = { fiches: [], others: 0 },
): string | null {
    const parts: string[] = [];
    const pl = (n: number): string => (n > 1 ? 's' : '');
    const names = (list: readonly string[]): string => (list.length > 6 ? `${list.slice(0, 6).join(', ')}…` : list.join(', '));
    if (replacedFiches.length) {
        parts.push(`${replacedFiches.length} fiche${pl(replacedFiches.length)} remplacée${pl(replacedFiches.length)} : ${names(replacedFiches)}`);
    }
    if (mergedFiches.length) {
        parts.push(`${mergedFiches.length} fiche${pl(mergedFiches.length)} fusionnée${pl(mergedFiches.length)} : ${names(mergedFiches)}`);
    }
    if (addedFiches.length) {
        parts.push(`${addedFiches.length} fiche${pl(addedFiches.length)} ajoutée${pl(addedFiches.length)} : ${names(addedFiches)}`);
    }
    if (skipped.fiches.length) {
        parts.push(`${skipped.fiches.length} fiche${pl(skipped.fiches.length)} supprimée${pl(skipped.fiches.length)} ici, non reprise${pl(skipped.fiches.length)} : ${names(skipped.fiches)}`);
    }
    if (skipped.others > 0) {
        parts.push(`${skipped.others} élément${pl(skipped.others)} supprimé${pl(skipped.others)} ici, non repris`);
    }
    if (unknownKeys > 0) {
        parts.push(`${unknownKeys} élément${unknownKeys > 1 ? 's' : ''} inconnu${unknownKeys > 1 ? 's' : ''} ignoré${unknownKeys > 1 ? 's' : ''}`);
    }
    return parts.length ? `${parts.join('. ')}.` : null;
}

/**
 * Identifiant PC-Tac STABLE d'une photo d'OI, dérivé de son id OI (A6) ET de
 * la situation (R5). Un réimport du même OI dans la MÊME situation retrouve la
 * même entrée et la met à jour au lieu d'en ajouter une seconde ; la même
 * photo importée dans une autre situation reçoit une clé DISTINCTE, car le
 * magasin d'images est partagé entre situations : sans ce suffixe, un RESET,
 * une suppression ou une annotation dans l'une cassait la photo de l'autre
 * (décisions 1 et 3). Reste sous `SAFE_ID` (128 caractères).
 */
export function stableOiPhotoId(imgId: string, modeId: PctacModeId = currentModeId()): string {
    const safe = imgId.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 100);
    const suffix = modeId === 'forcene' ? '' : `_${modeId}`;
    return `oi_photo${suffix}_${safe || 'sans_id'}`;
}

/** Type MIME d'image accepté à la frontière de confiance. */
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Assainit un data URL d'image venu d'une archive (R7). N'accepte QUE
 * `data:image/<type>;base64,<base64>`. Un type hors liste blanche
 * (`image/svg+xml`, `image/png" onerror=…`) est remplacé par `image/jpeg` :
 * la charge utile reste une image inerte, jamais un attribut injecté dans
 * `src="…"`. Rend `null` si le contenu n'est pas un data URL d'image valide.
 */
export function sanitizeImageDataUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    // Le préfixe DOIT être `data:image/…` ; le type déclaré peut contenir
    // n'importe quoi (guillemet, espace) et mène alors à `image/jpeg`.
    const m = /^data:(image\/[^;,]*);base64,([A-Za-z0-9+/=]+)$/i.exec(raw.trim());
    if (!m) return null;
    const declared = (m[1] ?? '').toLowerCase();
    const b64 = m[2] ?? '';
    return ALLOWED_IMAGE_MIMES.has(declared) ? `data:${declared};base64,${b64}` : `data:image/jpeg;base64,${b64}`;
}

/**
 * Cherche dans `items` la fiche qui désigne la personne d'un adversaire OI.
 * L'OI ne porte qu'un champ nom (`nom_adversaire`), alors que PC-Tac garde
 * `nom` et `prenom` séparés : on compare donc le nom complet aux deux ordres
 * possibles. Faute de certitude sur le découpage, on retombe sur `nom +
 * date de naissance` (décision 32) quand la date est identique et que le nom
 * ou le prénom de la fiche apparaît dans le champ unique.
 */
export function findOiDuplicatePerson(
    items: readonly PctacCollectionItem[],
    fullName: string,
    dob: string,
): PctacCollectionItem | null {
    const full = _normName(fullName);
    if (!full) return null;
    const dobN = normalizeDob(dob);
    for (const item of items) {
        const n = _normName(item.nom);
        const p = _normName(item.prenom);
        const nameMatch = full === [n, p].filter(Boolean).join(' ')
            || full === [p, n].filter(Boolean).join(' ');
        const dobMatch = !!dobN && normalizeDob(item.dob) === dobN
            && ((n !== '' && full.includes(n)) || (p !== '' && full.includes(p)));
        if (nameMatch || dobMatch) return item;
    }
    return null;
}

/** Catégorie de l'onglet Photos la plus cohérente pour un contenant OI. */
export function oiPhotoCategory(key: string): string {
    if (/advers|renfort|photo_extra_/.test(key)) return 'neutralized';
    if (/logo/.test(key)) return 'other';
    return 'location';
}

/** Légende d'une photo d'OI importée : la légende saisie, sinon le nom par
 *  défaut de l'OI, « nom du bouton (rang/total) » (Nico 2026-09-26). */
export function oiPhotoTitle(key: string, entry: OiDynamicPhotoEntry, rank: number, total: number): string {
    const custom = typeof entry.customTitle === 'string' ? entry.customTitle.trim() : '';
    return custom || `${photoFieldLabel(key)} (${rank}/${total})`;
}

export const Archive: ArchiveContract = {
    async exportZip(): Promise<boolean> {
        // archive.js:52-55 — garde « lib absente » (SPEC-PCTAC-CONVERSION.md §1.4) :
        // le branchement (alerte + retour) est conservé mot pour mot, la condition
        // devient un test de forme puisque JSZip est désormais un import statique.
        if (typeof JSZip !== 'function') {
            toast('JSZip indisponible (réseau ?). Impossible de générer l\'archive.', { kind: 'error' });
            return false;
        }
        try {
            const zip = new JSZip();

            // 1) Données localStorage
            // archive.js:60-65
            const data: Record<string, string> = {};
            COLLECTION_KEYS.forEach((k) => {
                const raw = localStorage.getItem(scopedKey(k));
                if (raw !== null) data[k] = raw;
            });
            zip.file('data.json', JSON.stringify(data, null, 2));

            // 2) Images : on collecte les ids depuis les collections + sync
            // archive.js:67-79
            const imgIds = new Set<string>();
            [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach((k) => {
                const list = Storage.loadCollection(k);
                list.forEach((item) => {
                    if (item.hasImage) imgIds.add(item.id);
                });
            });
            // Sync photos (id + "_sync")
            [ADVERSARIES_KEY, HOSTAGES_KEY].forEach((k) => {
                const list = Storage.loadCollection(k);
                list.forEach((item) => imgIds.add(item.id + '_sync'));
            });
            // Originaux des photos annotées (décision 25) : l'annotation reste
            // modifiable après import.
            [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach((k) => {
                Storage.loadCollection(k).forEach((item) => { if (item.annotations) imgIds.add(item.id + '_orig'); });
            });

            // V4 (revue neuve du 25/09) — seules les images ATTENDUES (fiche ou photo
            // avec `hasImage`) comptent comme illisibles : une base d'images en
            // panne sans aucune photo ne doit pas bloquer l'export.
            const expectedIds = new Set<string>();
            [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach((k) => {
                Storage.loadCollection(k).forEach((item) => {
                    if (!item.hasImage) return;
                    expectedIds.add(String(item.id));
                    if (k !== PHOTOS_KEY) expectedIds.add(`${item.id}_sync`);
                    if (item.annotations) expectedIds.add(`${item.id}_orig`);
                });
            });
            const imagesFolder = zip.folder('images');
            // Garde ajoutée pour le typage strict : `folder(name: string)` est typé
            // `JSZip | null` bien qu'il ne renvoie jamais null pour un nom simple
            // (aucun changement de comportement observable).
            let unreadable = 0;
            if (imagesFolder) {
                for (const id of imgIds) {
                    try {
                        const dataUrl = await ImageStore.get(id);
                        if (dataUrl) imagesFolder.file(`${id}.txt`, dataUrl);
                    } catch (e) {
                        if (expectedIds.has(id)) unreadable += 1;
                        console.warn('[Archive] image illisible:', id, e);
                    }
                }
            }

            // 2 bis) Traces GPX : même mécanique que les images, les coordonnées
            // vivant en IndexedDB. Les ids viennent de l'index localStorage,
            // déjà embarqué dans data.json ci-dessus.
            const gpxFolder = zip.folder('gpx');
            if (gpxFolder) {
                for (const id of gpxTrackIds()) {
                    try {
                        const track = await GpxStore.get(id);
                        if (track) gpxFolder.file(`${id}.json`, JSON.stringify(track));
                    } catch {
                        console.warn('[Archive] trace GPX absente:', id);
                    }
                }
            }

            // 3) Manifest
            // archive.js:92-96
            zip.file('manifest.json', JSON.stringify({
                appName: 'PC TAC',
                version: 1,
                situation: currentModeId(),
                createdAt: new Date().toISOString(),
                // V4 — archive PARTIELLE (photos illisibles) : marquée, l'opérateur garde tout le reste.
                ...(unreadable > 0 ? { incomplete: unreadable } : {}),
            }, null, 2));

            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            // Décision 32 : nom de fichier lisible, sans nom de personne.
            a.download = Utils.readableFileName(PCTAC_MODES[currentModeId()].label, new Date(), 'pctac.zip');
            // K3 : mémoriser le nom RÉELLEMENT téléchargé (calculé ici, après la
            // lecture des images et la compression), et non un nom anticipé.
            lastExportedName = a.download;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            // A10/V4 — une photo ILLISIBLE (base d'images perdue ou corrompue) n'est
            // pas une photo absente : l'archive partielle est téléchargée (main
            // courante, fiches, autres photos), mais l'export est déclaré incomplet,
            // et le RESET n'efface rien sur cette foi.
            if (unreadable > 0) {
                toast(`Archive INCOMPLÈTE téléchargée : ${unreadable} photo${unreadable > 1 ? 's' : ''} illisible${unreadable > 1 ? 's' : ''}. Rien n'a été effacé.`, { kind: 'error', duration: 8000 });
                return false;
            }
            return true;
        } catch (e) {
            console.error('[Archive] export échec:', e);
            toast('Erreur d\'export : ' + (e instanceof Error ? e.message : String(e)), { kind: 'error' });
            return false;
        }
    },

    /** K3 : nom réellement téléchargé au dernier export réussi (ou `null`). */
    lastExportFileName(): string | null {
        return lastExportedName;
    },

    async importFile(file: File): Promise<ArchiveImportResult> {
        // F9 : une demande « Ouvrir l'existante » restée d'un import interrompu
        // (exception) ne doit jamais s'exécuter dans celui-ci.
        pendingOpenFiche = null;
        // archive.js:114
        if (typeof JSZip !== 'function') throw new Error('JSZip indisponible');
        const name = (file.name || '').toLowerCase();

        // Compat : fichier JSON legacy
        // archive.js:118-122
        if (name.endsWith('.json')) {
            const text = await file.text();
            const obj: unknown = JSON.parse(text); // JSON désérialisé, gardé par _importLegacyJson
            const legacy = await this._importLegacyJson(obj);
            return { ...legacy, replacedFiches: [], mergedFiches: [], unknownKeys: 0 };
        }

        const buf = await file.arrayBuffer();
        let zip: JSZip;
        try { zip = await JSZip.loadAsync(buf); }
        catch { throw new Error("Archive illisible : ce n'est pas un fichier .pctac.zip valide (ou il est corrompu)."); }
        // Audit du 26/09 : une « zip bomb » est refusée avant toute décompression.
        const tooBig = archiveSizeVerdict(zipEntrySizes(zip), file.size);
        if (tooBig) throw new Error(tooBig);

        // PC1.a — VALIDATION DU MANIFEST AVANT TOUTE MODIFICATION.
        // L'export écrit manifest.json { appName: 'PC TAC', version, createdAt }.
        // On refuse proprement (sans wipe) toute archive d'une autre app : importer
        // une archive « OI » ou autre effacerait l'opérationnel sans rien restaurer.
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) {
            throw new Error("Archive invalide : « manifest.json » manquant. Cette archive n'a pas été produite par PC TAC.");
        }
        let manifest: ArchiveManifest;
        try { manifest = JSON.parse(await manifestFile.async('string')) as ArchiveManifest; }
        catch { throw new Error('Archive corrompue : « manifest.json » illisible.'); }
        const appName = manifest && manifest.appName;
        if (appName !== 'PC TAC') {
            throw new Error(
                appName
                    ? `Cette archive provient de « ${appName} », pas de PC TAC. Import refusé (aucune donnée modifiée).`
                    : "Manifest invalide : champ « appName » absent. Import refusé (aucune donnée modifiée)."
            );
        }

        // Version de format (décision 32) : une archive produite par une version
        // PLUS RÉCENTE est refusée AVANT toute écriture — ses données peuvent
        // employer des champs que cette version ne sait pas relire. Version
        // absente : traitée comme 1 (anciens formats).
        const versionRaw = manifest.version;
        const archiveVersion = typeof versionRaw === 'number'
            ? versionRaw
            : (typeof versionRaw === 'string' && versionRaw.trim() !== '' && Number.isFinite(Number(versionRaw))
                ? Number(versionRaw)
                : 1);
        if (archiveVersion > ARCHIVE_VERSION) {
            throw new Error(
                "Archive produite par une version plus récente de PC-Tac : mettez l'appli à jour avant d'importer."
            );
        }

        // Lire data.json
        const dataFile = zip.file('data.json');
        if (!dataFile) throw new Error('Archive invalide : data.json manquant');
        let rawData: Record<string, unknown>;
        try { rawData = JSON.parse(await dataFile.async('string')) as Record<string, unknown>; }
        catch { throw new Error('Archive corrompue : « data.json » illisible.'); }

        // Liste blanche (décision 32) : seules les clés qu'un export produit
        // sont écrites ; le reste est ignoré et compté. Une clé commune n'est
        // JAMAIS écrite par un import.
        const { allowed, unknownKeys } = filterImportKeys(rawData);
        // A1 — les couleurs d'intervenant sont normalisées avant toute écriture.
        const dataJson = sanitizeImportColors(allowed);

        // Frontière de confiance : un id hors format refuse l'archive entière,
        // AVANT tout effacement (rien n'est modifié).
        const unsafe = findUnsafeId(dataJson);
        if (unsafe !== null) {
            throw new Error(`Archive refusée : identifiant de fiche invalide (« ${unsafe.slice(0, 40)} »). Aucune donnée modifiée.`);
        }

        // Situation CIBLE : celle déclarée par l'archive, sinon Forcené
        // (ancien format). Une archive TP s'importe donc dans la situation TP
        // même si le poste en affiche une autre.
        const targetMode: PctacModeId = isModeIdValue(manifest.situation) ? manifest.situation : 'forcene';

        // Portée de l'import : quelles catégories, et fusion ou remplacement
        // (cf. `import-scope.ts`). Sans interface de choix dans le document,
        // `askImportScope` retombe sur la confirmation simple d'autrefois et
        // rend « tout, en remplacement » — comportement historique intact.
        const scope = await askImportScope(targetMode);
        if (!scope) {
            return { ok: false, cancelled: true };
        }

        // PC1.b — Import ATOMIQUE avec rollback COMPLET (localStorage + images IndexedDB).
        // clearAllData() ne touche QUE le localStorage ; les images vivent dans IndexedDB.
        // On prend donc un double snapshot AVANT tout effacement :
        //   1) localStorage (tout ce que clearAllData efface),
        //   2) images IndexedDB (collectées par id, comme à l'export).
        // En cas d'échec à n'importe quelle étape APRÈS clearAllData, on restaure
        // intégralement les deux — l'état terrain n'est jamais laissé à moitié effacé.
        const SNAPSHOT_KEYS = COLLECTION_KEYS.concat(['pcTacLieuHistory', 'lastView', 'lastPhotoFilter']);
        const snapshot: Record<string, string | null> = {};
        SNAPSHOT_KEYS.forEach((k) => { snapshot[k] = localStorage.getItem(scopedKey(k, targetMode)); });

        // Snapshot des images existantes (best-effort) : on collecte les ids depuis
        // les collections + leurs photos « _sync », exactement comme exportZip.
        const imgSnapshot = await this._snapshotImages(targetMode);

        // Ids d'images déjà référencés par la situation cible, relus dans le
        // snapshot AVANT toute écriture. Le magasin d'images est PARTAGÉ entre
        // les situations : on ne retire que ceux-ci en remplacement intégral.
        const priorImageIds = collectImageIds(snapshot);

        // Restaure l'état précédent (localStorage de la situation cible + images).
        const rollback = async (): Promise<void> => {
            try { clearSituationData(targetMode); } catch { /* best-effort */ }
            Object.entries(snapshot).forEach(([k, v]) => {
                try { if (v !== null) localStorage.setItem(scopedKey(k, targetMode), v); } catch { /* best-effort */ }
            });
            // Pas de `ImageStore.clear()` global : il effacerait les images des
            // trois autres situations. On repose les blobs snapshotés.
            for (const [id, dataUrl] of Object.entries(imgSnapshot)) {
                try { await ImageStore.put(id, dataUrl); } catch { /* best-effort */ }
            }
        };

        // 1) localStorage (rollback intégral si une écriture jette, ex. quota).
        let scopeReport: ApplyScopeReport = { written: 0, addedByKey: {}, replacedByKey: {}, skippedByKey: {} };
        try {
            if (scope.full) {
                // Restauration intégrale : on repart d'une situation vide.
                clearSituationData(targetMode);
                Object.entries(dataJson).forEach(([k, v]) => {
                    localStorage.setItem(scopedKey(k, targetMode), v);
                });
            } else {
                // Import partiel : RIEN n'est effacé hors des catégories cochées.
                scopeReport = applyScope(dataJson, scope, targetMode);
            }
        } catch (e) {
            await rollback();
            console.error('[Archive] import localStorage échec, rollback effectué:', e);
            toast("Échec de l'import (stockage insuffisant). Vos données précédentes ont été conservées.", { kind: 'error' });
            return { ok: false, error: e };
        }

        // 2) Images. En restauration intégrale on retire d'abord les images de
        // la situation cible (celles des trois autres restent). En import
        // partiel on n'efface RIEN : les photos des catégories non cochées
        // doivent survivre. Quelques images orphelines peuvent alors rester en
        // base — invisibles et sans autre coût que de la place.
        let imgError: unknown = null;
        if (scope.full && priorImageIds.length) {
            try {
                await ImageStore.deleteMany(priorImageIds);
            } catch (e) {
                await rollback();
                console.error('[Archive] clear images échec, rollback effectué:', e);
                toast("Échec de l'import (impossible de réinitialiser les photos). Vos données précédentes ont été conservées.", { kind: 'error' });
                return { ok: false, error: e };
            }
        }
        // R3 : en import partiel, n'écrire une image que si son propriétaire a
        // été AJOUTÉ ou REMPLACÉ par la fusion. Les images des fiches locales
        // gardées (plus récentes) ne doivent jamais être écrasées par la
        // version ancienne de l'archive. En restauration intégrale, tout est
        // repris (l'état local vient d'être remplacé).
        const acceptedBaseIds = new Set<string>();
        if (!scope.full) {
            const accept = (items: Array<Record<string, unknown>>): void => {
                items.forEach((it) => { if (it && typeof it.id === 'string') acceptedBaseIds.add(it.id); });
            };
            Object.values(scopeReport.addedByKey).forEach(accept);
            Object.values(scopeReport.replacedByKey).forEach(accept);
        }
        const baseImageId = (id: string): string => id.replace(/_(sync|orig)$/, '');

        const imagesFolder = scopeCarriesImages(scope) ? zip.folder('images') : null;
        if (imagesFolder) {
            const tasks: Promise<void>[] = [];
            imagesFolder.forEach((relPath, entry) => {
                if (entry.dir) return;
                // archive.js:218 — l'import accepte .txt ET .bin (l'export n'écrit que .txt).
                const id = relPath.replace(/\.txt$/, '').replace(/\.bin$/, '');
                // D-1 (revue de sécurité du 2026-09-26) : le nom d'entrée devient
                // une clé du magasin d'images COMMUN aux quatre situations ; même
                // format que les identifiants des collections (findUnsafeId).
                if (!SAFE_ID.test(id)) return;
                // C1 : accepter l'image quand son id EXACT (ex. une entrée de
                // galerie `a1_sync` importée seule) ou son id de base a été
                // ajouté/remplacé. Ne regarder que l'id de base retirait le
                // suffixe `_sync` et perdait la vignette des photos d'adversaire.
                if (!scope.full && !acceptedBaseIds.has(id) && !acceptedBaseIds.has(baseImageId(id))) return;
                tasks.push(
                    entry.async('string')
                        .then((dataUrl) => {
                            // R7 : frontière de confiance — l'archive peut être forgée.
                            const safe = sanitizeImageDataUrl(dataUrl);
                            if (safe) return ImageStore.put(id, safe);
                            return undefined;
                        })
                        .catch((err: unknown) => { imgError = err; })
                );
            });
            await Promise.all(tasks);
        }
        if (imgError) {
            // Les photos sont best-effort : un échec partiel ne justifie pas de jeter
            // l'import du localStorage déjà validé. On prévient sans rollback.
            console.warn('[Archive] certaines images non restaurées:', imgError);
            toast("Import terminé, mais certaines photos n'ont pas pu être restaurées (stockage). Les fiches sont intactes.", { kind: 'error' });
        }

        // 3) Traces GPX — FUSION, jamais de remplacement (décision Nico). À la
        // différence des images, on n'efface RIEN : une archive ancienne, sans
        // traces, laisse les traces locales intactes. Une trace supprimée à
        // tort n'est pas récupérable, alors qu'on peut toujours en supprimer
        // une de trop.
        let gpxError: unknown = null;
        const gpxFolder = scopeCarriesGpx(scope) ? zip.folder('gpx') : null;
        if (gpxFolder) {
            const tasks: Promise<void>[] = [];
            gpxFolder.forEach((relPath, entry) => {
                if (entry.dir) return;
                const id = relPath.replace(/\.json$/, '');
                if (!SAFE_ID.test(id)) return; // D-1 : même règle pour les traces
                tasks.push(
                    entry.async('string')
                        .then((raw) => {
                            const track: unknown = JSON.parse(raw);
                            if (!track || typeof track !== 'object') return;
                            const t = track as { coords?: unknown; times?: unknown };
                            if (!Array.isArray(t.coords)) return;
                            return GpxStore.put(id, {
                                coords: t.coords as Array<Array<[number, number]>>,
                                times: Array.isArray(t.times) ? (t.times as Array<Array<number | null>>) : null,
                            });
                        })
                        .catch((err: unknown) => { gpxError = err; })
                );
            });
            await Promise.all(tasks);
        }
        // L'index est fusionné APRÈS l'écriture des coordonnées : une entrée
        // d'index ne doit jamais désigner une trace dont le contenu manque.
        try {
            if (scopeCarriesGpx(scope)) {
                const merged = mergeGpxIndex(snapshot[GPX_INDEX_KEY] ?? null, dataJson[GPX_INDEX_KEY]);
                if (merged !== null) localStorage.setItem(scopedKey(GPX_INDEX_KEY, targetMode), merged);
            }
        } catch (e) {
            gpxError = e;
        }
        if (gpxError) {
            console.warn('[Archive] certaines traces GPX non restaurées:', gpxError);
            toast("Import terminé, mais certaines traces GPX n'ont pas pu être restaurées. Le reste est intact.", { kind: 'error' });
        }

        // 4) Doublons de personnes parmi les fiches AJOUTÉES par l'import
        // (décision 32) : signalés et fusionnables un par un.
        const mergedFiches = await resolveDuplicateFiches(scopeReport.addedByKey, targetMode);
        const replacedFiches = ficheNamesByKey(scopeReport.replacedByKey);
        // A7 — ajouts nommés (hors restauration intégrale et hors fiches déjà
        // fusionnées), et éléments supprimés ici, non repris.
        const addedFiches = scope.full ? [] : ficheNamesByKey(scopeReport.addedByKey).filter((n) => !mergedFiches.includes(n));
        const skippedFiches = ficheNamesByKey(scopeReport.skippedByKey);
        const skippedOthers = Object.entries(scopeReport.skippedByKey)
            .filter(([k]) => !FICHE_KEYS.includes(k))
            .reduce((n, [, list]) => n + list.length, 0);

        // 5) Récapitulatif : fiches remplacées/fusionnées/ajoutées, non reprises, clés ignorées.
        const summary = importSummaryMessage(replacedFiches, mergedFiches, unknownKeys, addedFiches, { fiches: skippedFiches, others: skippedOthers });
        if (summary !== null) toast(summary, { kind: 'info', duration: 8000 });

        // Si l'archive visait une AUTRE situation que celle affichée, on
        // propose d'y basculer : l'opérateur voit ce qu'il vient d'importer.
        if (targetMode !== currentModeId()) {
            const label = PCTAC_MODES[targetMode].label;
            const go = await confirmDialog({
                title: 'Changer de situation ?',
                message: `Archive « ${label} » importée dans la situation « ${label} ». Y basculer maintenant ?`,
                confirmLabel: 'Basculer',
            });
            if (go) {
                persistModeId(targetMode);
                try { location.reload(); } catch { /* environnement sans navigation */ }
            }
        }

        // R9 point 3 : « Ouvrir l'existante » n'a de sens que si l'archive a
        // atterri dans la situation AFFICHÉE (sinon on ouvrirait une fiche
        // d'une autre situation, ou le rechargement ci-dessus a déjà eu lieu).
        if (targetMode === currentModeId()) await flushPendingOpenFiche();
        else pendingOpenFiche = null; // F9 : jamais de fuite vers l'import suivant

        // K1 : `archive.ts` a parlé (avertissement d'échec partiel) — `main.ts`
        // ne doit pas ajouter un succès générique qui le contredirait.
        const warned = imgError !== null || gpxError !== null;
        return { ok: true, replacedFiches, mergedFiches, unknownKeys, warned };
    },

    /**
     * Snapshot best-effort des images IndexedDB liées aux collections d'UNE
     * situation (courante par défaut). Même logique de collecte d'ids que
     * exportZip (fiches + photos « _sync ») ; la situation cible peut différer
     * de celle affichée, d'où la lecture par `scopedKey`.
     */
    async _snapshotImages(modeId: PctacModeId = currentModeId()): Promise<Record<string, string>> {
        const out: Record<string, string> = {};
        try {
            const imgIds = new Set<string>();
            [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach((k) => {
                readCollectionList(localStorage.getItem(scopedKey(k, modeId))).forEach((item) => {
                    if (item.hasImage === true && typeof item.id === 'string') imgIds.add(item.id);
                });
            });
            [ADVERSARIES_KEY, HOSTAGES_KEY].forEach((k) => {
                readCollectionList(localStorage.getItem(scopedKey(k, modeId))).forEach((item) => {
                    if (typeof item.id === 'string') imgIds.add(item.id + '_sync');
                });
            });
            // Originaux des photos annotées (décision 25).
            [ADVERSARIES_KEY, HOSTAGES_KEY, PHOTOS_KEY].forEach((k) => {
                readCollectionList(localStorage.getItem(scopedKey(k, modeId))).forEach((item) => {
                    if (typeof item.id === 'string') imgIds.add(item.id + '_orig');
                });
            });
            for (const id of imgIds) {
                try {
                    const dataUrl = await ImageStore.get(id);
                    if (dataUrl) out[id] = dataUrl;
                } catch { /* image absente : on ignore */ }
            }
        } catch (e) {
            console.warn('[Archive] snapshot images partiel:', e);
        }
        return out;
    },

    /**
     * Compat : ancien export PC-TAC JSON (logs uniquement). Sans champ
     * `situation`, il vise Forcené — le mode historique.
     */
    async _importLegacyJson(obj: unknown): Promise<{ ok: true }> {
        // Contenu JSON désérialisé : interface locale + gardes (archive.js:268-276).
        const o = (obj && typeof obj === 'object')
            ? obj as { metadata?: { appName?: string }; logEntries?: unknown }
            : null;
        if (o && o.metadata && o.metadata.appName === 'PC Tac Log' && Array.isArray(o.logEntries)) {
            // Frontière de confiance, comme l'archive .pctac.zip : une entrée qui
            // n'est pas un objet ou un id hors format refuse le fichier entier,
            // avant toute écriture.
            // Une entrée sans id (très ancien export) en reçoit un.
            for (const e of o.logEntries as unknown[]) {
                if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('Journal refusé : entrée illisible. Aucune donnée modifiée.');
                const entry = e as { id?: unknown };
                if (entry.id === undefined || entry.id === null || entry.id === '') entry.id = `legacy_${Math.random().toString(36).slice(2, 10)}`;
                const id = String(entry.id);
                if (!SAFE_ID.test(id)) throw new Error(`Journal refusé : identifiant d'entrée invalide (« ${id.slice(0, 40)} »). Aucune donnée modifiée.`);
            }
            const logEntries = o.logEntries as PctacLogEntry[];
            const fallback = FREE_MODE_COLORS[0]?.hex ?? '';
            logEntries.forEach((e) => { if (e && e.paxColor) e.paxColor = safeHexColor(e.paxColor, fallback); }); // A1
            const key = scopedKey(LOCAL_STORAGE_KEY, 'forcene');
            const current: PctacLogEntry[] = readCollectionList(localStorage.getItem(key)) as unknown as PctacLogEntry[];
            const ids = new Set(current.map((l) => l.id));
            // Audit du 26/09 : champs texte par défaut, puis écriture par
            // saveLogData, qui trie par (date, heure) ; l'écran et le PDF ne
            // trient pas, un ajout en queue restait dans le désordre.
            logEntries.forEach((e) => {
                if (ids.has(e.id)) return;
                current.push({ ...e, heure: e.heure || '00:00', pax: e.pax || '', lieu: e.lieu || '', remarques: e.remarques || '' });
            });
            if (!Storage.saveLogData(current, 'forcene')) {
                throw new Error("Import du journal impossible (stockage insuffisant).");
            }
            return { ok: true };
        }
        throw new Error('Format JSON non reconnu.');
    },

    /**
     * PASSERELLE D'INTÉGRATION OI → PC TAC (Proposition 1, ROI maximal).
     *
     * Importe directement l'équipe (PATRACDVR) et les adversaires saisis dans le
     * Générateur d'Ordre Initial (4.html) à partir d'une archive « .oi.zip » (ou
     * d'une session « .json » legacy). Objectif : ZÉRO double saisie sur le terrain.
     *
     *   - Adversaires (étape 2) → pcTacAdversaries (+ photo IndexedDB + galerie Photos)
     *   - Membres PATRACDVR (trigrammes) → pcTacCustomPax (couleurs distinctes par défaut)
     *
     * On FUSIONNE sans jamais écraser : les fiches déjà saisies sur le terrain sont
     * conservées, les doublons (même nom / même trigramme) sont ignorés.
     */
    async importOiArchive(file: File): Promise<ArchiveOiImportResult> {
        pendingOpenFiche = null; // F9 : demande propre à CET import
        if (!file) throw new Error('Aucun fichier sélectionné.');
        const name = (file.name || '').toLowerCase();

        let oi: OiData | null = null;                 // objet tactical_oi_data
        let zip: JSZip | null = null;                  // archive JSZip (uniquement pour .oi.zip)
        let imageMeta: Record<string, string> = {};    // images.json : { imgId -> mimeType }

        // --- Lecture & validation de la source ---
        if (name.endsWith('.json')) {
            // Session OI legacy : champs uniquement (les photos vivent dans IndexedDB,
            // hors du .json — elles ne peuvent donc pas être transférées par ce format).
            let txt: string;
            try { txt = await file.text(); } catch { throw new Error('Fichier illisible.'); }
            let parsed: unknown;
            try { parsed = JSON.parse(txt); } catch { throw new Error('Session OI (.json) illisible : JSON invalide.'); }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Format de session OI non reconnu.');
            oi = parsed as OiData; // JSON désérialisé, structure best-effort (archive.js:310)
        } else {
            if (typeof JSZip !== 'function') throw new Error('JSZip indisponible (réseau ?). Impossible de lire l\'archive.');
            try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
            catch { throw new Error('Ce n\'est pas une archive .oi.zip valide (ou elle est corrompue).'); }
            const tooBig = archiveSizeVerdict(zipEntrySizes(zip), file.size);
            if (tooBig) throw new Error(tooBig);

            const dataFile = zip.file('data.json');
            if (!dataFile) throw new Error('Archive invalide : « data.json » introuvable.');

            let dataJson: Record<string, unknown>;
            try { dataJson = JSON.parse(await dataFile.async('string')) as Record<string, unknown>; }
            catch { throw new Error('Archive corrompue : « data.json » illisible.'); }

            // Garde-fou : refuser une archive d'une AUTRE app (best-effort sur le manifest).
            const manifestFile = zip.file('manifest.json');
            if (manifestFile) {
                try {
                    const man = JSON.parse(await manifestFile.async('string')) as ArchiveManifest;
                    if (man && man.appName && man.appName !== 'OI') {
                        throw new Error(`Cette archive provient de « ${man.appName} », pas du Générateur d'OI.`);
                    }
                } catch (e) {
                    if (e instanceof Error && e.message.startsWith('Cette archive')) throw e; // re-propage notre refus
                    // sinon : manifest illisible, on tolère
                }
            }

            const raw: unknown = (dataJson[OI_LOCAL_STORAGE_KEY] != null)
                ? dataJson[OI_LOCAL_STORAGE_KEY]
                : Object.values(dataJson).find((v) => typeof v === 'string');
            if (raw == null) throw new Error('Aucune donnée OI (tactical_oi_data) dans l\'archive.');
            try { oi = JSON.parse(raw as string) as OiData; } // archive.js:9-11 — la valeur attendue est une chaîne JSON
            catch { throw new Error('Données OI illisibles dans l\'archive.'); }

            const metaFile = zip.file('images.json');
            if (metaFile) { try { imageMeta = JSON.parse(await metaFile.async('string')) as Record<string, string>; } catch { imageMeta = {}; } }
        }

        // --- Extraction des données OI ---
        const adversaries = Array.isArray(oi.adversaries) ? oi.adversaries : [];
        const dynPhotos: Record<string, OiDynamicPhotoEntry[] | undefined> =
            (oi.dynamic_photos && typeof oi.dynamic_photos === 'object') ? oi.dynamic_photos : {};

        const paxMembers: OiPatracdvrMember[] = [];
        (Array.isArray(oi.patracdvr_rows) ? oi.patracdvr_rows : []).forEach((r) => {
            (r && Array.isArray(r.members) ? r.members : []).forEach((m) => paxMembers.push(m));
        });
        (Array.isArray(oi.patracdvr_unassigned) ? oi.patracdvr_unassigned : []).forEach((m) => paxMembers.push(m));

        const oiGrid = isTacticalGridSpec(oi.cartography?.grid) ? oi.cartography.grid : null;

        // Le fichier est-il porteur de quelque chose d'exploitable ? Les photos
        // de `dynamic_photos` comptent autant que les fiches : un OI « photos
        // seules » doit pouvoir être importé (A6).
        const hasDynPhotos = Object.values(dynPhotos).some((e) => Array.isArray(e) && e.length > 0);
        if (!adversaries.length && !paxMembers.length && !oiGrid && !hasDynPhotos) {
            throw new Error('Aucun adversaire, membre PATRACDVR, photo ni carroyage trouvé dans ce fichier OI.');
        }

        // Lit les octets d'une photo de l'OI depuis l'archive. OI stocke la clé
        // `img_…` dans `dynamic_photos`, les octets dans
        // `images/<encodeURIComponent(id)>.bin` (type via images.json).
        const readPhotoDataUrl = async (imgId: string | undefined): Promise<string | null> => {
            if (!zip || !imgId) return null;
            // archive.js:369-370 — repli sur le nom d'image NON encodé.
            const zipEntry = zip.file('images/' + encodeURIComponent(imgId) + '.bin')
                || zip.file('images/' + imgId + '.bin');
            if (!zipEntry) return null;
            try {
                const b64 = await zipEntry.async('base64');
                // R7 : `images.json` vient de l'archive, donc du réseau. Seul un
                // vrai type d'image passe ; tout le reste est ramené à JPEG.
                const rawMime = imageMeta[imgId];
                const mime = typeof rawMime === 'string' && rawMime.trim() !== '' ? rawMime.trim() : 'image/jpeg';
                return sanitizeImageDataUrl(`data:${mime};base64,${b64}`);
            } catch (e) { console.warn('[OI→PCTAC] photo illisible:', imgId, e); return null; }
        };

        // Data URL de la photo PRINCIPALE d'un adversaire (première entrée).
        const photoDataUrlForAdv = (advId: string | undefined): Promise<string | null> => {
            const first = advId ? dynPhotos['photo_main_' + advId]?.[0] : undefined;
            return readPhotoDataUrl(first?.id);
        };

        // Annotations d'une photo dans l'OI : tableau d'objets, sinon aucune.
        const parseAnnotations = (raw: unknown): OiAnnotation[] => {
            try {
                const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return Array.isArray(parsed) ? parsed.filter((a): a is OiAnnotation => !!a && typeof a === 'object') : [];
            } catch { return []; }
        };
        const photoAnnotationsForAdv = (advId: string | undefined): OiAnnotation[] =>
            advId ? parseAnnotations(dynPhotos['photo_main_' + advId]?.[0]?.annotations) : [];

        // --- 1) Adversaires → pcTacAdversaries (+ photo + galerie Photos) ---
        // A3 — aucune liste n'est gardée à travers un await (dialogue de
        // doublon, photos) : un autre onglet peut écrire pendant ce temps. La
        // détection de doublon relit le stockage, et l'écriture n'applique que
        // les deltas (fusions par id, ajouts) à la liste relue.
        const advAdds: PctacCollectionItem[] = [];
        const advMergedById = new Map<string, PctacCollectionItem>();
        const advView = (): PctacCollectionItem[] => [
            ...Storage.loadCollection(ADVERSARIES_KEY).map((a) => advMergedById.get(String(a.id)) ?? a),
            ...advAdds,
        ];
        const photoAdds: PctacCollectionItem[] = [];
        let advAdded = 0, advPhotos = 0, advMerged = 0;
        // C5/C12 : les fusions sont traitées APRÈS l'écriture de `photoList`, pour
        // que la galerie lue par `syncMergedGallery` soit à jour.
        const merges: Array<{ incomingId: string; merged: PctacCollectionItem; photoTaken: boolean }> = [];
        let seq = 0;

        for (const oa of adversaries) {
            const nom = (oa.nom_adversaire || '').toString().trim();
            const itemId = 'oi_adv_' + Date.now().toString(36) + '_' + (seq++);
            const item: PctacCollectionItem = {
                id: itemId,
                nom: nom,
                prenom: '',                                   // OI fusionne nom+prénom dans un seul champ
                dob: (oa.date_naissance || '').toString(),
                lien: '',
                antecedents: (oa.antecedents_adversaire || '').toString(),
                attitude: (oa.attitude_adversaire || '').toString(),
                substance: (oa.substances_adversaire || '').toString(),
                armes: (oa.armes_connues || '').toString(),
            };
            // Décision 20 : domicile, profession, et stature + ethnie versées
            // au signalement (« Physique »). Rien de vide n'est posé.
            const stature = (oa.stature_adversaire || '').toString().trim();
            const ethnie = (oa.ethnie_adversaire || '').toString().trim();
            const extra: Record<string, string> = {
                domicile: (oa.domicile_adversaire || '').toString().trim(),
                profession: (oa.profession_adversaire || '').toString().trim(),
                signalement: [stature, ethnie ? `type ${ethnie}` : ''].filter(Boolean).join(', '),
            };
            Object.entries(extra).forEach(([k, v]) => { if (v) item[k] = v; });

            const dataUrl = await photoDataUrlForAdv(oa.id);
            let photoStored = false;
            if (dataUrl) {
                try {
                    // Décision 26 : la photo annotée dans l'OI arrive annotée,
                    // original et annotations gardés comme une annotation faite
                    // ici (modifiable). Rendu impossible : la photo seule.
                    let shown = dataUrl;
                    const annotations = photoAnnotationsForAdv(oa.id);
                    if (annotations.length) {
                        try {
                            shown = await renderAnnotated(dataUrl, annotations);
                            await ImageStore.put(origId(itemId), dataUrl);
                            item.annotations = JSON.stringify(annotations);
                        } catch (e) {
                            shown = dataUrl;
                            console.warn('[OI→PCTAC] annotations non appliquées:', e);
                        }
                    }
                    await ImageStore.put(itemId, shown);
                    item.hasImage = true;
                    // Copie automatique vers la galerie Photos (catégorie « Adversaire »),
                    // exactement comme une saisie manuelle PC TAC (id + "_sync").
                    await ImageStore.put(itemId + '_sync', shown);
                    photoStored = true;
                } catch (e) { console.warn('[OI→PCTAC] enregistrement photo échoué:', e); }
            }

            // R9 : doublon signalé et fusionnable, comme à l'import d'archive
            // (décision 32). L'OI ne porte qu'un champ nom, d'où la comparaison
            // du nom complet aux deux ordres de `nom`/`prenom`, et le repli sur
            // `nom + date de naissance`.
            const existing = findOiDuplicatePerson(advView(), nom, (oa.date_naissance || '').toString());
            if (existing) {
                const choice = await confirmDialog({
                    title: 'Fiche en double',
                    message:
                        `La fiche « ${nom} » semble déjà exister. ` +
                        "Fusionner les deux fiches (les champs vides de l'existante seront complétés), garder les deux, ou ouvrir l'existante ?",
                    confirmLabel: 'Fusionner',
                    cancelLabel: 'Garder les deux',
                    extraLabel: "Ouvrir l'existante",
                });
                // R9 point 3 : garder les deux fiches et ouvrir l'existante.
                if (choice === 'extra') requestOpenFiche('adv', String(existing.id));
                if (choice === true) {
                    const { merged, photoTaken } = await mergePersonIntoExisting(existing, item);
                    advMergedById.set(String(existing.id), merged);
                    // K2 : une photo n'est comptée que réellement GARDÉE — pas de
                    // fusion dans une existante qui avait déjà la sienne.
                    if (photoStored && !existing.hasImage && merged.hasImage) advPhotos++;
                    merges.push({ incomingId: itemId, merged, photoTaken });
                    try { await ImageStore.deleteMany([itemId, itemId + '_sync', itemId + '_orig']); }
                    catch { /* best-effort */ }
                    advMerged++;
                    continue;
                }
            }

            if (photoStored) {
                photoAdds.push({ id: itemId + '_sync', title: nom || 'Adversaire OI', category: 'neutralized', status: 'active', hasImage: true });
                advPhotos++;
            }
            advAdds.push(item);
            advAdded++;
        }
        if (advAdded || advMerged) Storage.saveCollection(ADVERSARIES_KEY, applyDeltas(Storage.loadCollection(ADVERSARIES_KEY), advMergedById, advAdds));
        if (photoAdds.length) Storage.saveCollection(PHOTOS_KEY, applyDeltas(Storage.loadCollection(PHOTOS_KEY), new Map(), photoAdds));

        // --- 2) Équipe PATRACDVR → pcTacCustomPax (couleurs distinctes) ---
        const paxList = Storage.loadCollection(CUSTOM_PAX_KEY);
        const existingPax = new Set(paxList.map((p) => _normName(p.name)));
        const usedColors = new Set(paxList.map((p) => ((p.color as string | undefined) || '').toLowerCase()));
        const palette: ReadonlyArray<{ hex: string }> = (Array.isArray(FREE_MODE_COLORS) && FREE_MODE_COLORS.length) ? FREE_MODE_COLORS : [{ hex: '#a855f7' }];
        let colorIdx = 0;
        const nextColor = (): string => {
            // Privilégie une couleur encore libre pour garder des intervenants visuellement distincts.
            for (let i = 0; i < palette.length; i++) {
                const entry = palette[(colorIdx + i) % palette.length];
                const c = entry ? entry.hex : '#a855f7';
                if (!usedColors.has(c.toLowerCase())) {
                    colorIdx = (colorIdx + i + 1) % palette.length;
                    usedColors.add(c.toLowerCase());
                    return c;
                }
            }
            const fallbackEntry = palette[colorIdx % palette.length];
            const c = fallbackEntry ? fallbackEntry.hex : '#a855f7';
            colorIdx++;
            return c;
        };

        let paxAdded = 0, paxSkipped = 0;
        paxMembers.forEach((m, i) => {
            const trig = (m && m.trigramme || '').toString().trim().toUpperCase();
            if (!trig || trig === 'N/A') { paxSkipped++; return; }
            const key = _normName(trig);
            if (existingPax.has(key)) { paxSkipped++; return; }
            existingPax.add(key);
            paxList.push({ id: 'oi_pax_' + Date.now().toString(36) + '_' + i, name: trig, color: nextColor() });
            paxAdded++;
        });
        if (paxAdded) Storage.saveCollection(CUSTOM_PAX_KEY, paxList);

        // --- 2 bis) TOUTES les photos de l'OI → galerie Photos (A6) ---
        // La photo PRINCIPALE de chaque adversaire est déjà passée par la fiche
        // (id `_sync`), on ne la réimporte pas ici : les autres contenants
        // (objectif, carte, transport, cheminement, effraction, photos
        // supplémentaires d'adversaire…) arrivent avec leur légende, leurs
        // annotations et une catégorie cohérente. L'id PC-Tac est DÉRIVÉ de
        // l'id OI de la photo : réimporter le même OI met à jour l'entrée au
        // lieu d'en ajouter une seconde.
        const photoById = new Map(Storage.loadCollection(PHOTOS_KEY).map((p) => [p.id, p]));
        // A3 — entrées mises à jour ou ajoutées, appliquées à la liste relue à l'écriture.
        const galleryChanges = new Map<string, PctacCollectionItem>();
        let galleryAdded = 0, galleryUpdated = 0, galleryPreserved = 0;
        // Anciennes photos « Baptême Terrain » par bloc ZMSPCP : un seul champ,
        // numéroté comme dans l'OI.
        const zmspcpIds = (Array.isArray(oi.zmspcp_blocks) ? oi.zmspcp_blocks : []).map((b) => (typeof b?.id === 'string' ? b.id : ''));
        const galleryPhotos = mergeLegacyBaptemePhotos(
            Object.fromEntries(Object.entries(dynPhotos).filter((e): e is [string, OiDynamicPhotoEntry[]] => Array.isArray(e[1]))),
            zmspcpIds,
        );
        for (const [key, entries] of Object.entries(galleryPhotos)) {
            if (key.startsWith('photo_main_')) continue;
            // Rang compté sur les photos importées, comme l'OI (une image absente
            // ou illisible est écartée, les autres passent).
            const readable: { entry: OiDynamicPhotoEntry; imgId: string; dataUrl: string }[] = [];
            for (const entry of entries) {
                const imgId = entry && typeof entry.id === 'string' ? entry.id : '';
                const dataUrl = imgId ? await readPhotoDataUrl(imgId) : null;
                if (dataUrl) readable.push({ entry, imgId, dataUrl });
            }
            for (const [index, { entry, imgId, dataUrl }] of readable.entries()) {
                const pcId = stableOiPhotoId(imgId);
                const existing = photoById.get(pcId);
                const derivedTitle = oiPhotoTitle(key, entry, index + 1, readable.length);
                const annotations = parseAnnotations(entry.annotations);
                const importedAnnotationSig = annotations.length ? JSON.stringify(annotations) : '';

                // R6/C2 : le travail fait dans PC-Tac (annotation — décisions
                // 25/26 — ou légende renommée) est NON destructif. On ne tient
                // une entrée pour modifiée localement QUE si son titre diffère
                // de ce que l'OI avait FOURNI (`oiTitle`) ou si ses annotations
                // diffèrent de celles fournies par l'OI (`oiAnnotations`) : une
                // annotation posée par l'OI n'est PAS une édition locale.
                const oiTitleRef = existing && typeof existing.oiTitle === 'string' ? existing.oiTitle : derivedTitle;
                const titleEdited = !!existing
                    && typeof existing.title === 'string' && existing.title.trim() !== ''
                    && existing.title !== oiTitleRef;
                const annotationsEdited = !!existing
                    && annotationSignature(existing.annotations) !== annotationSignature(existing.oiAnnotations);
                if (titleEdited || annotationsEdited) {
                    // Édition locale : on ne touche à rien, mais on le DIT.
                    galleryPreserved++;
                    continue;
                }

                let shown = dataUrl;
                let annotated = false;
                if (annotations.length) {
                    try {
                        shown = await renderAnnotated(dataUrl, annotations);
                        annotated = true;
                    } catch (e) {
                        shown = dataUrl;
                        console.warn('[OI→PCTAC] annotations non appliquées:', e);
                    }
                }
                try {
                    await ImageStore.put(pcId, shown);
                    if (annotated) await ImageStore.put(pcId + '_orig', dataUrl);
                    else { try { await ImageStore.delete(pcId + '_orig'); } catch { /* best-effort */ } }
                } catch (e) {
                    console.warn('[OI→PCTAC] photo de galerie non enregistrée:', imgId, e);
                    continue;
                }

                const item: PctacCollectionItem = existing ?? { id: pcId };
                item.title = derivedTitle;
                item.oiTitle = derivedTitle;
                item.category = oiPhotoCategory(key);
                item.hasImage = true;
                if (annotated) {
                    item.annotations = importedAnnotationSig;
                    item.oiAnnotations = importedAnnotationSig;
                } else {
                    delete item.annotations;
                    delete item.oiAnnotations;
                }
                galleryChanges.set(pcId, item);
                if (existing) galleryUpdated++;
                else { photoById.set(pcId, item); galleryAdded++; }
            }
        }
        if (galleryChanges.size) Storage.saveCollection(PHOTOS_KEY, applyDeltas(Storage.loadCollection(PHOTOS_KEY), galleryChanges, []));
        // C5/C12 : la photo reprise d'une fusion a son entrée de galerie. Traité
        // APRÈS la dernière écriture de `photoList` : `syncMergedGallery` relit
        // le stockage et ne doit pas être écrasé par un `photoList` périmé.
        for (const m of merges) syncMergedGallery('adv', m.incomingId, m.merged, { photoTaken: m.photoTaken });

        // --- 3) Carroyage de la carto OI → plan de la situation courante ---
        // L'OI fait foi (décision Nico 2026-09-24) : tout le monde doit appeler
        // « C4 » la même case, donc le carroyage de l'OI REMPLACE celui du plan,
        // et il est affiché d'office.
        let gridImported = false;
        if (oiGrid) {
            try {
                localStorage.setItem(scopedKey(GRID_KEY), JSON.stringify(oiGrid));
                let settings: Record<string, unknown> = {};
                try { settings = (JSON.parse(localStorage.getItem(scopedKey(OVERLAYS_KEY)) || '{}') as Record<string, unknown>) || {}; } catch { settings = {}; }
                localStorage.setItem(scopedKey(OVERLAYS_KEY), JSON.stringify({ ...settings, gridOn: true }));
                gridImported = true;
                document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: GRID_KEY } }));
            } catch (e) { console.warn('[OI→PCTAC] carroyage non enregistré:', e); }
        }

        // R9 point 3 : ouvrir la fiche existante choisie pendant l'import.
        await flushPendingOpenFiche();

        // K2/C14 : plus AUCUN adversaire n'est « ignoré » — une fusion n'est pas
        // un doublon ignoré (elle est comptée `advMerged`), et « garder les
        // deux »/« ouvrir l'existante » conservent la fiche. Le champ reste à 0
        // pour ne pas casser le message de `main.ts` (paxSkipped, lui, compte).
        return { ok: true, advAdded, advPhotos, advSkipped: 0, advMerged, paxAdded, paxSkipped, gridImported, galleryAdded, galleryUpdated, galleryPreserved };
    },
};

// archive.js:459 — exposition globale, au scope MODULE (SPEC-PCTAC-CONVERSION.md §4).
window.Archive = Archive;
