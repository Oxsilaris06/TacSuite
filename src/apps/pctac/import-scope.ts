/**
 * import-scope.ts — Choix de ce qu'on importe d'une archive, et comment.
 *
 * L'import historique était tout ou rien : l'archive remplaçait l'intégralité
 * du poste. Utile pour restaurer une sauvegarde, inutilisable pour travailler
 * à deux sur le même cas — celui qui importait écrasait son propre travail.
 *
 * Ici l'opérateur coche les CATÉGORIES à reprendre (elles suivent les onglets
 * de PC-Tac) et choisit entre :
 *
 *   - FUSIONNER (par défaut) : les éléments de l'archive s'ajoutent aux siens ;
 *     sur un conflit d'identifiant, la version la plus RÉCENTE (`updatedAt`)
 *     gagne (décision 32). Les remplacements sont récapitulés après coup.
 *   - REMPLACER : les catégories cochées sont vidées puis réécrites depuis
 *     l'archive. C'est la restauration de sauvegarde d'avant, restreinte aux
 *     catégories choisies.
 *
 * En cas de conflit d'identifiant en fusion, deux éléments non datés (ou de
 * même date) : la version LOCALE est conservée. Celui qui importe a le contexte
 * de son propre poste ; écraser sa saisie avec une version non plus récente
 * serait la surprise coûteuse.
 *
 * Repli sans interface : quand `#importScopeModal` est absent du document
 * (suite de tests, gabarit réduit), `askImportScope()` retombe sur la
 * confirmation simple d'autrefois et rend « toutes les catégories, en
 * remplacement » — exactement le comportement historique.
 */

import {
    ADVERSARIES_KEY,
    CUSTOM_PAX_KEY,
    DASHBOARD_KEY,
    FRIENDS_KEY,
    HOSTAGES_KEY,
    DELETED_KEY,
    LOCAL_STORAGE_KEY,
    PHOTOS_KEY,
    TP_ASSOC_KEY,
} from '@pctac/config.js';
import { GPX_INDEX_KEY, PINS_KEY } from '@pctac/planmap/constants.js';
import { PCTAC_MODES, currentModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';
import { confirmDialog } from '@shared/feedback.js';
import { compareLogEntries } from '@pctac/storage.js';
import { readTombstones, tombstoneMap } from '@pctac/tombstones.js';

export type ImportMode = 'merge' | 'replace';

export interface ImportCategory {
    id: string;
    /** Libellé affiché. `lex` le remplace quand la catégorie suit la situation. */
    label: string;
    /** Jeton `data-lex` (cf. mode-ui.ts) quand le nom dépend de la situation. */
    lex?: string;
    icon: string;
    /** Clés localStorage transportées par cette catégorie. */
    keys: string[];
    /** La catégorie porte des images IndexedDB (photos de fiches, galerie). */
    images?: boolean;
    /** La catégorie porte des traces GPX (dossier `gpx/` du zip). */
    gpx?: boolean;
}

/**
 * Catégories, dans l'ordre des onglets de PC-Tac. `pcTacPlanView` (position de
 * caméra) et `pcTacPlanLocked` (verrou) suivent le plan : ce sont des réglages
 * d'affichage, pas des données, et les reprendre avec le plan évite d'arriver
 * sur une carte cadrée ailleurs que les marqueurs importés.
 */
export const IMPORT_CATEGORIES: ImportCategory[] = [
    {
        id: 'journal',
        label: 'Main courante',
        icon: 'description',
        keys: [LOCAL_STORAGE_KEY, TP_ASSOC_KEY, 'pcTacLieuHistory'],
    },
    {
        id: 'adversaires',
        label: 'Adversaires',
        lex: 'adv.plural',
        icon: 'groups',
        keys: [ADVERSARIES_KEY],
        images: true,
    },
    {
        id: 'otages',
        label: 'Otages',
        lex: 'host.plural',
        icon: 'person_off',
        keys: [HOSTAGES_KEY],
        images: true,
    },
    { id: 'amis', label: 'Amis', icon: 'shield_person', keys: [FRIENDS_KEY] },
    { id: 'photos', label: 'Photos', icon: 'photo_library', keys: [PHOTOS_KEY], images: true },
    {
        id: 'plan',
        label: 'Plan',
        icon: 'map',
        keys: [PINS_KEY, 'pcTacPlanShapes', 'pcTacPlanView', 'pcTacPlanLocked', 'pcTacPlanGrid', GPX_INDEX_KEY],
        gpx: true,
    },
    { id: 'liens', label: 'Liens', icon: 'link', keys: [DASHBOARD_KEY] },
    { id: 'intervenants', label: 'Intervenants', icon: 'badge', keys: [CUSTOM_PAX_KEY] },
];

export interface ImportScope {
    /** Identifiants de catégories retenus. */
    categories: string[];
    mode: ImportMode;
    /** Vrai quand TOUT est repris en remplacement : restauration intégrale. */
    full: boolean;
}

/** Journal fusionné remis dans l'ordre (date, heure) ; texte rendu tel quel s'il n'est pas une liste. */
function sortedLogJson(json: string): string {
    try {
        const list = JSON.parse(json) as unknown;
        if (!Array.isArray(list)) return json;
        return JSON.stringify([...list].sort((a, b) => compareLogEntries(
            (a && typeof a === 'object' ? a : {}) as { date?: string; heure?: string },
            (b && typeof b === 'object' ? b : {}) as { date?: string; heure?: string },
        )));
    } catch {
        return json;
    }
}

export function scopeKeys(scope: ImportScope): string[] {
    const chosen = new Set(scope.categories);
    return IMPORT_CATEGORIES.filter((c) => chosen.has(c.id)).flatMap((c) => c.keys);
}

export function scopeCarriesImages(scope: ImportScope): boolean {
    const chosen = new Set(scope.categories);
    return IMPORT_CATEGORIES.some((c) => chosen.has(c.id) && c.images === true);
}

export function scopeCarriesGpx(scope: ImportScope): boolean {
    const chosen = new Set(scope.categories);
    return IMPORT_CATEGORIES.some((c) => chosen.has(c.id) && c.gpx === true);
}

function isFull(categories: string[], mode: ImportMode): boolean {
    return mode === 'replace' && categories.length === IMPORT_CATEGORIES.length;
}

/**
 * Fusionne deux collections sérialisées en JSON, par identifiant. Sur un
 * conflit d'identifiant, l'élément dont le `updatedAt` est le plus RÉCENT
 * gagne (décision 32) ; à égalité, ou si l'un des deux n'est pas daté, la
 * version LOCALE l'emporte — le comportement historique. Rend la valeur locale
 * inchangée si l'une des deux n'est pas une liste d'objets identifiés
 * (réglage, position de caméra, verrou…) : fusionner n'a alors aucun sens, et
 * écraser serait pire.
 */
export function mergeCollectionJson(localRaw: string | null, incomingRaw: string | undefined): string | null {
    return mergeCollectionReport(localRaw, incomingRaw).json;
}

/** Détail d'une fusion de collection, pour le récapitulatif d'import. */
export interface CollectionMergeReport {
    json: string | null;
    /** Éléments ajoutés (identifiant absent localement, ou sans identifiant). */
    added: Array<Record<string, unknown>>;
    /** Éléments qui ont REMPLACÉ un élément local (archive plus récente). */
    replaced: Array<Record<string, unknown>>;
    /** A7 — éléments supprimés ici après leur dernière modification là-bas : non repris. */
    skipped: Array<Record<string, unknown>>;
}

/** Horodatage `updatedAt` en ms, ou `NaN` si absent/illisible. */
function updatedAtMs(item: unknown): number {
    if (!item || typeof item !== 'object') return NaN;
    const raw = (item as { updatedAt?: unknown }).updatedAt;
    if (typeof raw !== 'string' || raw.trim() === '') return NaN;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : NaN;
}

/** Vrai si l'élément entrant doit remplacer l'élément local de même id. */
function incomingWins(local: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
    const lu = updatedAtMs(local);
    const iu = updatedAtMs(incoming);
    if (Number.isNaN(lu) && Number.isNaN(iu)) return false; // aucun daté : local garde
    if (Number.isNaN(iu)) return false; // entrant non daté : plus ancien que tout daté
    if (Number.isNaN(lu)) return true; // local non daté : l'entrant daté gagne
    return iu > lu; // égalité : local garde
}

/**
 * Comme {@link mergeCollectionJson}, mais rend aussi les éléments ajoutés et
 * remplacés. Ne jette jamais.
 */
export function mergeCollectionReport(
    localRaw: string | null,
    incomingRaw: string | undefined,
    /** A7 — pierres tombales locales de cette clé : `id` → date de suppression (ms). */
    tombstones?: ReadonlyMap<string, number>,
): CollectionMergeReport {
    if (incomingRaw === undefined) return { json: localRaw, added: [], replaced: [], skipped: [] };

    // Rien en local : l'archive fait foi, quelle que soit la forme de sa valeur.
    // C'est le comportement historique (`if (localRaw === null) return incomingRaw`)
    // et il est INDISPENSABLE aux valeurs qui ne sont pas des listes — carroyage
    // `pcTacPlanGrid`, tableau de liens `pcTacDashboard`, associations
    // `pcTacTpAssoc`, cadrage `pcTacPlanView`, verrou `pcTacPlanLocked` : sans
    // cette reprise, un poste neuf (ou une situation encore sans carroyage)
    // perdait ces réglages à l'import en fusion.
    if (localRaw === null) {
        let incoming: unknown;
        try {
            incoming = JSON.parse(incomingRaw);
        } catch {
            return { json: null, added: [], replaced: [], skipped: [] };
        }
        const added = Array.isArray(incoming)
            ? incoming.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
            : [];
        return { json: incomingRaw, added, replaced: [], skipped: [] };
    }

    let local: unknown;
    let incoming: unknown;
    try {
        local = JSON.parse(localRaw);
        incoming = JSON.parse(incomingRaw);
    } catch {
        return { json: localRaw, added: [], replaced: [], skipped: [] };
    }
    if (!Array.isArray(incoming)) return { json: localRaw, added: [], replaced: [], skipped: [] };
    if (!Array.isArray(local)) {
        // Pas de liste locale : l'archive fait foi, tout est « ajouté ».
        const added = incoming.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
        return { json: incomingRaw, added, replaced: [], skipped: [] };
    }

    const out: unknown[] = [...local];
    const indexById = new Map<string, number>();
    local.forEach((item, i) => {
        const id = (item && typeof item === 'object' && 'id' in item)
            ? String((item as { id: unknown }).id)
            : null;
        if (id !== null) indexById.set(id, i);
    });

    const added: Array<Record<string, unknown>> = [];
    const replaced: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    incoming.forEach((item) => {
        if (!item || typeof item !== 'object') {
            out.push(item);
            return;
        }
        const obj = item as Record<string, unknown>;
        const id = 'id' in obj ? String(obj.id) : null;
        if (id === null) {
            added.push(obj);
            out.push(obj);
            return;
        }
        const at = indexById.get(id);
        if (at === undefined) {
            // A7 — supprimé ici après sa dernière modification là-bas (ou jamais
            // daté) : il ne revient pas. Modifié là-bas après la suppression : il
            // revient (la plus récente gagne).
            const deadAt = tombstones?.get(id);
            if (deadAt !== undefined) {
                const iu = updatedAtMs(obj);
                if (Number.isNaN(iu) || iu <= deadAt) { skipped.push(obj); return; }
            }
            added.push(obj);
            indexById.set(id, out.length);
            out.push(obj);
            return;
        }
        const current = out[at];
        if (current && typeof current === 'object' && incomingWins(current as Record<string, unknown>, obj)) {
            out[at] = obj;
            replaced.push(obj);
        }
    });
    return { json: JSON.stringify(out), added, replaced, skipped };
}

/**
 * Détail d'une application de portée, pour le récapitulatif d'import.
 */
export interface ApplyScopeReport {
    written: number;
    /** Éléments ajoutés, par clé logique. */
    addedByKey: Record<string, Array<Record<string, unknown>>>;
    /** Éléments remplacés, par clé logique. */
    replacedByKey: Record<string, Array<Record<string, unknown>>>;
    /** A7 — éléments supprimés ici, non repris, par clé logique. */
    skippedByKey: Record<string, Array<Record<string, unknown>>>;
}

/**
 * Demande à l'opérateur ce qu'il veut reprendre. Rend `null` s'il renonce.
 *
 * `applyLexicon` n'est pas appelé ici : le libellé dépendant de la situation
 * est résolu par l'appelant via `data-lex`, comme partout ailleurs.
 */
export async function askImportScope(targetMode?: PctacModeId): Promise<ImportScope | null> {
    const modal = document.getElementById('importScopeModal') as HTMLDialogElement | null;
    const situationLabel = targetMode ? PCTAC_MODES[targetMode].label : '';
    const situationHint = targetMode
        ? `Archive « ${situationLabel} » → sera chargée dans la situation « ${situationLabel} ». `
        : '';
    if (!modal || typeof modal.showModal !== 'function') {
        // Repli historique : confirmation simple, restauration intégrale.
        const ok = await confirmDialog({
            title: 'Importer cette archive ?',
            message: situationHint + 'Les données actuelles seront remplacées.',
            confirmLabel: 'Importer',
            danger: true,
        });
        return ok
            ? { categories: IMPORT_CATEGORIES.map((c) => c.id), mode: 'replace', full: true }
            : null;
    }

    // Dire EN CLAIR dans la modale où l'archive atterrira : une archive TP
    // chargée alors que le poste affiche Forcené serait sinon déroutante.
    const intro = modal.querySelector<HTMLElement>('.import-scope-intro');
    if (intro) {
        if (intro.dataset.baseIntro === undefined) intro.dataset.baseIntro = intro.textContent ?? '';
        intro.textContent = situationHint + (intro.dataset.baseIntro ?? '');
    }

    return new Promise<ImportScope | null>((resolve) => {
        const confirmBtn = modal.querySelector<HTMLButtonElement>('#importScopeConfirm');
        const cancelBtn = modal.querySelector<HTMLButtonElement>('#importScopeCancel');
        const boxes = [...modal.querySelectorAll<HTMLInputElement>('input[data-import-category]')];
        const modeInputs = [...modal.querySelectorAll<HTMLInputElement>('input[name="importScopeMode"]')];

        const selected = (): string[] => boxes.filter((b) => b.checked).map((b) => b.dataset.importCategory ?? '');
        const refresh = (): void => {
            if (confirmBtn) confirmBtn.disabled = selected().length === 0;
        };
        boxes.forEach((b) => b.addEventListener('change', refresh));
        refresh();

        let settled = false;
        const finish = (value: ImportScope | null): void => {
            if (settled) return;
            settled = true;
            modal.close();
            resolve(value);
        };

        confirmBtn?.addEventListener('click', () => {
            const categories = selected();
            if (categories.length === 0) return;
            const mode: ImportMode = modeInputs.find((i) => i.checked)?.value === 'replace' ? 'replace' : 'merge';
            finish({ categories, mode, full: isFull(categories, mode) });
        }, { once: true });
        cancelBtn?.addEventListener('click', () => finish(null), { once: true });
        // Échap et clic sur le fond : un `close` non décidé vaut renoncement.
        modal.addEventListener('close', () => finish(null), { once: true });

        modal.showModal();
    });
}

/** Liste d'objets portée par une chaîne JSON, ou `[]` si illisible. */
function parseIncomingList(raw: string | undefined): Array<Record<string, unknown>> {
    if (raw === undefined) return [];
    try {
        const v: unknown = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object') : [];
    } catch {
        return [];
    }
}

/**
 * Applique les clés retenues au localStorage, selon le mode choisi. Les
 * catégories NON cochées ne sont pas touchées — c'est tout l'intérêt.
 *
 * En remplacement, une clé absente de l'archive est SUPPRIMÉE localement :
 * remplacer une catégorie, c'est adopter l'état de l'archive pour elle, y
 * compris son vide. En fusion, une clé absente laisse la valeur locale en
 * place.
 *
 * Rend un rapport : nombre de clés écrites, et éléments ajoutés/remplacés par
 * clé (pour le récapitulatif et la détection de doublons).
 */
export function applyScope(
    dataJson: Record<string, string>,
    scope: ImportScope,
    modeId: PctacModeId = currentModeId(),
): ApplyScopeReport {
    let written = 0;
    const addedByKey: Record<string, Array<Record<string, unknown>>> = {};
    const replacedByKey: Record<string, Array<Record<string, unknown>>> = {};
    const skippedByKey: Record<string, Array<Record<string, unknown>>> = {};
    // A7 — pierres tombales de la situation cible, lues une fois.
    const stones = readTombstones(modeId);
    scopeKeys(scope).forEach((key) => {
        // Clé PHYSIQUE de la situation cible : l'archive porte les clés LOGIQUES,
        // l'import les range sous le suffixe de la situation destinataire.
        const physical = scopedKey(key, modeId);
        const incoming = dataJson[key];
        if (scope.mode === 'replace') {
            if (incoming === undefined) localStorage.removeItem(physical);
            else localStorage.setItem(physical, incoming);
            written += 1;
            // Catégorie remplacée : tout ce qu'elle apporte est « ajouté » du
            // point de vue local (rien n'a été fusionné).
            const list = parseIncomingList(incoming);
            if (list.length) addedByKey[key] = list;
            return;
        }
        const report = mergeCollectionReport(localStorage.getItem(physical), incoming, tombstoneMap(stones, key));
        if (report.json !== null) {
            // A4 — écriture directe (sans saveLogData) : la main courante
            // fusionnée doit rester chronologique, l'écran et le PDF ne trient pas.
            localStorage.setItem(physical, key === LOCAL_STORAGE_KEY ? sortedLogJson(report.json) : report.json);
            written += 1;
        }
        if (report.added.length) addedByKey[key] = report.added;
        if (report.replaced.length) replacedByKey[key] = report.replaced;
        if (report.skipped.length) skippedByKey[key] = report.skipped;
    });
    // A7 — les pierres tombales de l'archive rejoignent les miennes (union, la
    // plus récente gagne), quelles que soient les catégories : un troisième
    // poste ne fera pas revenir ce que le deuxième a supprimé. Restauration
    // intégrale : l'archive fait foi.
    const incomingStones = dataJson[DELETED_KEY];
    if (incomingStones !== undefined) {
        const physical = scopedKey(DELETED_KEY, modeId);
        if (scope.full) localStorage.setItem(physical, incomingStones);
        else {
            const union = mergeCollectionReport(localStorage.getItem(physical), incomingStones);
            if (union.json !== null) localStorage.setItem(physical, union.json);
        }
    }
    return { written, addedByKey, replacedByKey, skippedByKey };
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Peuple la liste des catégories dans `#importScopeList` depuis
 * `IMPORT_CATEGORIES`. Appelé une fois au démarrage : la liste n'a pas à être
 * réécrite à chaque import, et les libellés dépendant de la situation se
 * remettent à jour tout seuls via `data-lex`.
 *
 * Sans l'élément (gabarit réduit, tests), la fonction ne fait rien et
 * `askImportScope` reste sur son repli.
 */
export function initImportScopeModal(): void {
    const list = document.getElementById('importScopeList');
    if (!list) return;
    list.innerHTML = IMPORT_CATEGORIES.map((cat) => {
        const id = `importScope_${cat.id}`;
        const label = cat.lex
            ? `<span data-lex="${escapeAttr(cat.lex)}">${escapeAttr(cat.label)}</span>`
            : escapeAttr(cat.label);
        return `<label class="import-scope-item" for="${id}">
            <input type="checkbox" id="${id}" data-import-category="${escapeAttr(cat.id)}" checked>
            <span class="material-symbols-outlined" aria-hidden="true">${escapeAttr(cat.icon)}</span>
            <span class="import-scope-item-label">${label}</span>
        </label>`;
    }).join('');
}
