/**
 * Types des DONNÉES de tutoriel interactif (moteur `window.PocheTuto`).
 *
 * Déduits de la structure RÉELLE des deux jeux de données de GStart-main
 * (lecture seule) :
 *   - `modules/tuto_oi_data.js`      → appId 'oi'   : 1 intro, 8 chapitres, 56 steps
 *   - `modules/pctac/tuto_data.js`   → appId 'pctac': 1 intro, 9 chapitres, 73 steps
 *
 * Relevé exhaustif des champs (comptage `grep` sur les deux fichiers) :
 *   intro    : { title, text }                        (`text` n'est PAS lu par le moteur,
 *                                                       mais présent dans les 2 jeux de données)
 *   chapitre : { id, icon, title, summary, steps }    (5 champs, toujours présents)
 *   step     : { title, body, terms, selector, tip }  (5 champs, toujours présents)
 *              → `selector` vaut `null` 5 fois (oi) / 36 fois (pctac)
 *              → `tip`      vaut `null` 6 fois (oi) / 20 fois (pctac)
 *              → `terms`    est un `string[]`, parfois vide (4 fois côté pctac)
 *              → aucun `""` : l'absence est TOUJOURS encodée par `null`
 *
 * Ces fichiers sont marqués « généré, ne pas éditer à la main » et « VERBATIM
 * (repris exactement de l'interface) » : leur fidélité textuelle est un contrat
 * (cf. P1.A4). Les types ci-dessous sont donc STRICTS (aucun champ optionnel) —
 * un champ manquant dans une future donnée est une erreur de génération, pas un
 * cas nominal.
 */

/** Bloc d'accueil affiché en tête de panneau. */
export interface TutoIntro {
    /** Titre affiché sous l'en-tête du panneau (`tuto-engine.js:463`). */
    title: string;
    /** Texte d'accueil. Présent dans les deux jeux de données ; non lu par le moteur actuel. */
    text: string;
}

/** Une étape (« step ») du tutoriel. */
export interface TutoStep {
    /** Titre de l'étape (`tuto-engine.js:614`). */
    title: string;
    /** Corps de l'étape ; mini-markdown `**gras**` (`tuto-engine.js:615`, `mdBold`). */
    body: string;
    /** Libellés VERBATIM de l'UI. Non affichés — servent uniquement à la recherche (`tuto-engine.js:659`). */
    terms: string[];
    /** Sélecteur CSS de l'élément réel à surligner, ou `null` si l'étape n'en cible aucun. */
    selector: string | null;
    /** Astuce optionnelle affichée en encart, ou `null`. Mini-markdown accepté. */
    tip: string | null;
}

/** Un chapitre = un groupe d'étapes. */
export interface TutoChapter {
    /** Identifiant stable : sert de clé de progression (`<id>:<index>` dans `ptuto_<appId>_seen`). */
    id: string;
    /** Nom d'icône Material Symbols Outlined. */
    icon: string;
    /** Titre du chapitre. */
    title: string;
    /** Résumé affiché en tête de chapitre. */
    summary: string;
    /** Étapes du chapitre, dans l'ordre de parcours. */
    steps: TutoStep[];
}

/** Jeu de données complet passé à `PocheTuto.mount({ data })`. */
export interface TutoData {
    intro: TutoIntro;
    chapters: TutoChapter[];
}

/**
 * Entrée de la liste plate construite par le moteur au montage
 * (`tuto-engine.js:301-306`) : un index global sur tous les steps.
 */
export interface TutoFlatStep {
    /** Index du chapitre. */
    ci: number;
    /** Index du step dans son chapitre. */
    si: number;
    step: TutoStep;
    chapter: TutoChapter;
    /** Index global (position dans `flat`). */
    gi: number;
}
