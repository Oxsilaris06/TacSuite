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
import { isTacticalGridSpec } from '@shared/tactical-grid.js';
import { PCTAC_MODES, SHARED_KEYS, currentModeId, persistModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';
import { findDuplicatePerson, mergeFicheFields } from '@pctac/fiche.js';
import { Utils } from '@pctac/utils.js';
import {
    LOCAL_STORAGE_KEY, TP_ASSOC_KEY,
    ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY,
    FREE_MODE_COLORS,
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

/** Entrée `dynamic_photos['photo_main_<advId>']` : images liées à un adversaire. */
interface OiDynamicPhotoEntry {
    id?: string;
    /** JSON du moteur d'annotation (`formulaires.ts`), commun au PC-Tac. */
    annotations?: unknown;
}

/** Sous-ensemble utile de `tactical_oi_data` désérialisé (structure best-effort). */
interface OiData {
    adversaries?: OiAdversaryEntry[];
    dynamic_photos?: Record<string, OiDynamicPhotoEntry[]>;
    patracdvr_rows?: OiPatracdvrRow[];
    patracdvr_unassigned?: OiPatracdvrMember[];
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

const COLLECTION_KEYS = [
    LOCAL_STORAGE_KEY, TP_ASSOC_KEY,
    ADVERSARIES_KEY, HOSTAGES_KEY, FRIENDS_KEY, PHOTOS_KEY, CUSTOM_PAX_KEY,
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

/** Vrai si une fiche porte réellement des annotations (non vide). */
function hasAnnotations(item: Record<string, unknown>): boolean {
    const raw = item.annotations;
    if (typeof raw !== 'string') return Array.isArray(raw) ? raw.length > 0 : false;
    const trimmed = raw.trim();
    return trimmed !== '' && trimmed !== '[]' && trimmed !== 'null';
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
 * Recopie vers l'id GARDÉ les images de la fiche entrante reprises par la
 * fusion (décision 32). `mergeFicheFields` complète aussi `hasImage` et
 * `annotations`, alors que les images de l'entrante vivent dans `ImageStore`
 * sous l'id ENTRANT : sans cette recopie, la fiche gardée pointerait vers des
 * blobs absents (photo cassée) — et l'invariant « `<id>_orig` seulement si la
 * fiche porte `annotations` » doit tenir (revue G9). Si l'image manque, on
 * retire le champ plutôt que de laisser un pointeur mort.
 */
export async function transferMergedImages(
    keptId: string,
    incomingId: string,
    merged: PctacCollectionItem,
    filled: readonly string[],
): Promise<void> {
    if (filled.includes('hasImage')) {
        const base = await ImageStore.get(incomingId);
        if (base) {
            await ImageStore.put(keptId, base);
            const sync = await ImageStore.get(incomingId + '_sync');
            if (sync) await ImageStore.put(keptId + '_sync', sync);
        } else {
            delete merged.hasImage;
        }
    }
    let annotated = hasAnnotations(merged as Record<string, unknown>);
    if (filled.includes('annotations') && annotated) {
        const orig = await ImageStore.get(incomingId + '_orig');
        if (orig) await ImageStore.put(keptId + '_orig', orig);
        else {
            // `annotations` sans original ferait dessiner sur l'image affichée :
            // on retire l'annotation plutôt que de conserver l'incohérence.
            delete merged.annotations;
            annotated = false;
        }
    }
    if (!annotated) {
        try { await ImageStore.delete(keptId + '_orig'); } catch { /* best-effort */ }
    }
}

/**
 * Signale et traite les doublons de personnes parmi les fiches AJOUTÉES par
 * l'import (id différent mais `findDuplicatePerson` positive). Pour chacune,
 * « Fusionner » complète la fiche existante (`mergeFicheFields`, champs vides
 * seulement) et retire l'importée — images recopiées vers l'id gardé —,
 * « Garder les deux » ne touche à rien. Rend les noms des fiches fusionnées.
 */
export async function resolveDuplicateFiches(
    addedByKey: Record<string, Array<Record<string, unknown>>>,
): Promise<string[]> {
    const mergedNames: string[] = [];
    for (const key of FICHE_KEYS) {
        const added = addedByKey[key] ?? [];
        if (!added.length) continue;
        let list = Storage.loadCollection(key);
        for (const incoming of added) {
            if (!incoming || typeof incoming.id !== 'string') continue;
            const candidate = incoming as PctacCollectionItem;
            const existing = findDuplicatePerson(list, candidate);
            if (!existing) continue;
            const name = ficheDisplayName(incoming);
            const merge = await confirmDialog({
                title: 'Fiche en double',
                message:
                    `La fiche « ${name} » semble déjà exister. ` +
                    "Fusionner les deux fiches (les champs vides de l'existante seront complétés), ou garder les deux ?",
                confirmLabel: 'Fusionner',
                cancelLabel: 'Garder les deux',
            });
            if (!merge) continue;
            const { merged, filled } = mergeFicheFields(existing, candidate);
            try {
                await transferMergedImages(existing.id, candidate.id, merged, filled);
            } catch (e) {
                console.warn('[Archive] copie des images fusionnées échouée:', e);
            }
            list = list
                .filter((it) => it.id !== candidate.id)
                .map((it) => (it.id === existing.id ? merged : it));
            Storage.saveCollection(key, list);
            try { await ImageStore.deleteMany([candidate.id, candidate.id + '_sync', candidate.id + '_orig']); }
            catch { /* best-effort */ }
            mergedNames.push(name);
        }
    }
    return mergedNames;
}

/** Noms lisibles des fiches remplacées par l'archive (fusion). */
function replacedFicheNames(replacedByKey: Record<string, Array<Record<string, unknown>>>): string[] {
    const names: string[] = [];
    FICHE_KEYS.forEach((key) => {
        (replacedByKey[key] ?? []).forEach((item) => names.push(ficheDisplayName(item)));
    });
    return names;
}

/** Message du récapitulatif d'import, ou `null` s'il n'y a rien à dire. */
export function importSummaryMessage(
    replacedFiches: readonly string[],
    mergedFiches: readonly string[],
    unknownKeys: number,
): string | null {
    const parts: string[] = [];
    if (replacedFiches.length) {
        parts.push(`${replacedFiches.length} fiche${replacedFiches.length > 1 ? 's' : ''} remplacée${replacedFiches.length > 1 ? 's' : ''} : ${replacedFiches.join(', ')}`);
    }
    if (mergedFiches.length) {
        parts.push(`${mergedFiches.length} fiche${mergedFiches.length > 1 ? 's' : ''} fusionnée${mergedFiches.length > 1 ? 's' : ''} : ${mergedFiches.join(', ')}`);
    }
    if (unknownKeys > 0) {
        parts.push(`${unknownKeys} élément${unknownKeys > 1 ? 's' : ''} inconnu${unknownKeys > 1 ? 's' : ''} ignoré${unknownKeys > 1 ? 's' : ''}`);
    }
    return parts.length ? `${parts.join('. ')}.` : null;
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

            const imagesFolder = zip.folder('images');
            // Garde ajoutée pour le typage strict : `folder(name: string)` est typé
            // `JSZip | null` bien qu'il ne renvoie jamais null pour un nom simple
            // (aucun changement de comportement observable).
            if (imagesFolder) {
                for (const id of imgIds) {
                    try {
                        const dataUrl = await ImageStore.get(id);
                        if (dataUrl) imagesFolder.file(`${id}.txt`, dataUrl);
                    } catch {
                        console.warn('[Archive] image absente:', id);
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
            }, null, 2));

            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            // Décision 32 : nom de fichier lisible, sans nom de personne.
            a.download = Utils.readableFileName(PCTAC_MODES[currentModeId()].label, new Date(), 'pctac.zip');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            return true;
        } catch (e) {
            console.error('[Archive] export échec:', e);
            toast('Erreur d\'export : ' + (e instanceof Error ? e.message : String(e)), { kind: 'error' });
            return false;
        }
    },

    async importFile(file: File): Promise<ArchiveImportResult> {
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
        const { allowed: dataJson, unknownKeys } = filterImportKeys(rawData);

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
        let scopeReport: ApplyScopeReport = { written: 0, addedByKey: {}, replacedByKey: {} };
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
        const imagesFolder = scopeCarriesImages(scope) ? zip.folder('images') : null;
        if (imagesFolder) {
            const tasks: Promise<void>[] = [];
            imagesFolder.forEach((relPath, entry) => {
                if (entry.dir) return;
                // archive.js:218 — l'import accepte .txt ET .bin (l'export n'écrit que .txt).
                const id = relPath.replace(/\.txt$/, '').replace(/\.bin$/, '');
                tasks.push(
                    entry.async('string')
                        .then((dataUrl) => ImageStore.put(id, dataUrl))
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
        const mergedFiches = await resolveDuplicateFiches(scopeReport.addedByKey);
        const replacedFiches = replacedFicheNames(scopeReport.replacedByKey);

        // 5) Récapitulatif : fiches remplacées/fusionnées, clés ignorées.
        const summary = importSummaryMessage(replacedFiches, mergedFiches, unknownKeys);
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

        return { ok: true, replacedFiches, mergedFiches, unknownKeys };
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
            const logEntries = o.logEntries as PctacLogEntry[]; // structure best-effort, comme l'original
            const key = scopedKey(LOCAL_STORAGE_KEY, 'forcene');
            const current: PctacLogEntry[] = readCollectionList(localStorage.getItem(key)) as unknown as PctacLogEntry[];
            const ids = new Set(current.map((l) => l.id));
            logEntries.forEach((e) => { if (!ids.has(e.id)) current.push(e); });
            try {
                localStorage.setItem(key, JSON.stringify(current));
            } catch {
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

        if (!adversaries.length && !paxMembers.length && !oiGrid) {
            throw new Error('Aucun adversaire, membre PATRACDVR ni carroyage trouvé dans ce fichier OI.');
        }

        // Récupère le data URL de la photo principale d'un adversaire depuis l'archive.
        // OI stocke la photo dans dynamic_photos['photo_main_<advId>'][0].id (clé img_…),
        // dont les octets sont dans images/<encodeURIComponent(id)>.bin (type via images.json).
        const photoDataUrlForAdv = async (advId: string | undefined): Promise<string | null> => {
            if (!zip || !advId) return null;
            const entries = dynPhotos['photo_main_' + advId];
            const first = entries ? entries[0] : undefined;
            const imgId = first ? first.id : undefined;
            if (!imgId) return null;
            // archive.js:369-370 — repli sur le nom d'image NON encodé.
            const zipEntry = zip.file('images/' + encodeURIComponent(imgId) + '.bin')
                || zip.file('images/' + imgId + '.bin');
            if (!zipEntry) return null;
            try {
                const b64 = await zipEntry.async('base64');
                const mime = imageMeta[imgId] || 'image/jpeg';
                return `data:${mime};base64,${b64}`;
            } catch (e) { console.warn('[OI→PCTAC] photo illisible:', imgId, e); return null; }
        };

        // Annotations de cette photo dans l'OI : tableau d'objets, sinon aucune.
        const photoAnnotationsForAdv = (advId: string | undefined): OiAnnotation[] => {
            const raw = advId ? dynPhotos['photo_main_' + advId]?.[0]?.annotations : undefined;
            try {
                const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return Array.isArray(parsed) ? parsed.filter((a): a is OiAnnotation => !!a && typeof a === 'object') : [];
            } catch { return []; }
        };

        // --- 1) Adversaires → pcTacAdversaries (+ photo + galerie Photos) ---
        const advList = Storage.loadCollection(ADVERSARIES_KEY);
        const photoList = Storage.loadCollection(PHOTOS_KEY);
        // a.nom / a.prenom : champs dynamiques de PctacCollectionItem, non typés (archive.js:382).
        const existingAdvNames = new Set(
            advList.map((a) => _normName(((a.nom as string | undefined) || '') + ' ' + ((a.prenom as string | undefined) || '')))
        );
        let advAdded = 0, advPhotos = 0, advSkipped = 0;
        let seq = 0;

        for (const oa of adversaries) {
            const nom = (oa.nom_adversaire || '').toString().trim();
            const key = _normName(nom);
            if (key && existingAdvNames.has(key)) { advSkipped++; continue; }
            if (key) existingAdvNames.add(key);

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
                    advPhotos++;
                    // Copie automatique vers la galerie Photos (catégorie « Adversaire »),
                    // exactement comme une saisie manuelle PC TAC (id + "_sync").
                    const syncId = itemId + '_sync';
                    await ImageStore.put(syncId, shown);
                    photoList.push({ id: syncId, title: nom || 'Adversaire OI', category: 'neutralized', status: 'active', hasImage: true });
                } catch (e) { console.warn('[OI→PCTAC] enregistrement photo échoué:', e); }
            }
            advList.push(item);
            advAdded++;
        }
        if (advAdded) Storage.saveCollection(ADVERSARIES_KEY, advList);
        if (advPhotos) Storage.saveCollection(PHOTOS_KEY, photoList);

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

        return { ok: true, advAdded, advPhotos, advSkipped, paxAdded, paxSkipped, gridImported };
    },
};

// archive.js:459 — exposition globale, au scope MODULE (SPEC-PCTAC-CONVERSION.md §4).
window.Archive = Archive;
