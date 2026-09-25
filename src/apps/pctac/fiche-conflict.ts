/**
 * fiche-conflict.ts — Conflits d'une fiche OUVERTE avec un autre onglet
 * (décision 29).
 *
 * Quand la même fiche change dans un autre onglet pendant qu'elle est ouverte :
 *   - champ changé LÀ-BAS et pas ICI → mis à jour silencieusement ;
 *   - champ changé des DEUX côtés avec des valeurs différentes → conflit, à
 *     trancher champ par champ (« Garder la mienne » / « Prendre l'autre »).
 *
 * `status` est exclu : son suivi est géré par `statusTouched` (le statut changé
 * depuis la carte pendant la saisie ne doit pas produire de conflit artificiel).
 */

export interface FicheConflict {
    key: string;
    mine: unknown;
    theirs: unknown;
}

export interface FicheDiff {
    /** Champs changés ailleurs, non touchés ici : à appliquer sans bruit. */
    silent: Record<string, unknown>;
    /** Champs changés des deux côtés avec des valeurs différentes. */
    conflicts: FicheConflict[];
}

const IGNORED = new Set(['id', 'updatedAt', 'photo', 'hasImage', 'annotations', 'status']);

const norm = (value: unknown): string => String(value ?? '');

/**
 * Compare `theirs` (fiche relue du stockage) à `base` (fiche à l'ouverture) et
 * à `mine` (valeurs du formulaire).
 */
export function diffOpenFiche(
    base: Record<string, unknown> | null,
    mine: Record<string, unknown>,
    theirs: Record<string, unknown>,
): FicheDiff {
    const silent: Record<string, unknown> = {};
    const conflicts: FicheConflict[] = [];
    const keys = new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base ?? {})]);
    for (const key of keys) {
        if (IGNORED.has(key)) continue;
        const baseVal = base ? base[key] : undefined;
        const mineVal = mine[key];
        const theirsVal = theirs[key];
        // Rien n'a changé là-bas : rien à faire de ce côté.
        if (norm(theirsVal) === norm(baseVal)) continue;
        // Changé ici exactement pareil : déjà d'accord.
        if (norm(mineVal) === norm(theirsVal)) continue;
        // Pas touché ici : on prend la version de l'autre, sans bruit.
        if (norm(mineVal) === norm(baseVal)) { silent[key] = theirsVal; continue; }
        // Changé des deux côtés autrement : conflit.
        conflicts.push({ key, mine: mineVal, theirs: theirsVal });
    }
    return { silent, conflicts };
}
