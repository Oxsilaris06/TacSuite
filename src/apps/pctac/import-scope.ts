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
 *     un élément déjà présent, reconnu à son identifiant, est ignoré. Rien de
 *     local n'est perdu, et l'on peut importer plusieurs fois de suite sans
 *     accumuler de doublons.
 *   - REMPLACER : les catégories cochées sont vidées puis réécrites depuis
 *     l'archive. C'est la restauration de sauvegarde d'avant, restreinte aux
 *     catégories choisies.
 *
 * En cas de conflit d'identifiant en fusion, c'est la version LOCALE qui est
 * conservée. Celui qui importe a le contexte de son propre poste ; écraser sa
 * saisie avec une version venue d'ailleurs serait la surprise coûteuse.
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
    LOCAL_STORAGE_KEY,
    PHOTOS_KEY,
    TP_ASSOC_KEY,
} from '@pctac/config.js';
import { GPX_INDEX_KEY, PINS_KEY } from '@pctac/planmap/constants.js';
import { PCTAC_MODES, currentModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';
import { confirmDialog } from '@shared/feedback.js';

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
 * Fusionne deux collections sérialisées en JSON, par identifiant, la version
 * LOCALE l'emportant sur un conflit. Rend la valeur locale inchangée si l'une
 * des deux n'est pas une liste d'objets identifiés (réglage, position de
 * caméra, verrou…) : fusionner n'a alors aucun sens, et écraser serait pire.
 */
export function mergeCollectionJson(localRaw: string | null, incomingRaw: string | undefined): string | null {
    if (incomingRaw === undefined) return localRaw;
    if (localRaw === null) return incomingRaw;
    let local: unknown;
    let incoming: unknown;
    try {
        local = JSON.parse(localRaw);
        incoming = JSON.parse(incomingRaw);
    } catch {
        return localRaw;
    }
    if (!Array.isArray(local) || !Array.isArray(incoming)) return localRaw;

    const seen = new Set<string>();
    const out: unknown[] = [];
    const push = (item: unknown): void => {
        const id = (item && typeof item === 'object' && 'id' in item)
            ? String((item as { id: unknown }).id)
            : null;
        if (id !== null) {
            if (seen.has(id)) return;
            seen.add(id);
        }
        out.push(item);
    };
    local.forEach(push);
    incoming.forEach(push);
    return JSON.stringify(out);
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

/**
 * Applique les clés retenues au localStorage, selon le mode choisi. Les
 * catégories NON cochées ne sont pas touchées — c'est tout l'intérêt.
 *
 * En remplacement, une clé absente de l'archive est SUPPRIMÉE localement :
 * remplacer une catégorie, c'est adopter l'état de l'archive pour elle, y
 * compris son vide. En fusion, une clé absente laisse la valeur locale en
 * place.
 *
 * Rend le nombre de clés effectivement écrites (diagnostic, message de fin).
 */
export function applyScope(dataJson: Record<string, string>, scope: ImportScope, modeId: PctacModeId = currentModeId()): number {
    let written = 0;
    scopeKeys(scope).forEach((key) => {
        // Clé PHYSIQUE de la situation cible : l'archive porte les clés LOGIQUES,
        // l'import les range sous le suffixe de la situation destinataire.
        const physical = scopedKey(key, modeId);
        const incoming = dataJson[key];
        if (scope.mode === 'replace') {
            if (incoming === undefined) localStorage.removeItem(physical);
            else localStorage.setItem(physical, incoming);
            written += 1;
            return;
        }
        const merged = mergeCollectionJson(localStorage.getItem(physical), incoming);
        if (merged !== null) {
            localStorage.setItem(physical, merged);
            written += 1;
        }
    });
    return written;
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
