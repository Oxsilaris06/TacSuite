/**
 * Configuration et constantes globales pour PC TAC
 *
 * Port TypeScript verbatim de `modules/pctac/config.js` (GStart-main, 317 LOC,
 * aucun import). Cf. docs/SPEC-PCTAC-CONVERSION.md §1.1 (exports attendus) et
 * §9 (piège regex de diacritiques / PIN_ICONS verbatim).
 */
import type {
    PctacNamedColor,
    PctacPaxColorEntry,
    PctacPhotoCategory,
    PctacPinIcon,
} from '@shared/types/contracts.js';
// PIN_ICONS vit désormais dans @shared (partagé avec la roue de création de
// ping OI, chantier roue OI, parité de présentation) — redirection d'import
// pure, valeurs et API strictement identiques. Réexporté ET importé (usage
// local dans `suggestPinIcons`/`window.PIN_ICONS` ci-dessous).
import { PIN_ICONS } from '@shared/pin-icons.js';
export { PIN_ICONS } from '@shared/pin-icons.js';

// Clés de stockage
export const LOCAL_STORAGE_KEY = 'pcTacLogData';
export const TP_ASSOC_KEY = 'pcTacTpAssociations';
export const ADVERSARIES_KEY = 'pcTacAdversaries';
export const HOSTAGES_KEY = 'pcTacHostages';
export const FRIENDS_KEY = 'pcTacFriends';
export const PHOTOS_KEY = 'pcTacPhotos';
export const CUSTOM_PAX_KEY = 'pcTacCustomPax';
// Clé de persistance du tableau de liens (board "Dashboard")
// Forme : { positions:{[nodeId]:{x,y}}, links:[{id,from,to,comment}], locked:boolean, layout:'auto'|'manual' }
export const DASHBOARD_KEY = 'pcTacDashboard';

// Catégories de photos
export const PHOTO_CATEGORIES: PctacPhotoCategory[] = [
    { id: 'hostage', label: 'Otages' },
    { id: 'location', label: 'Lieu' },
    { id: 'trap', label: 'Piégeages' },
    { id: 'neutralized', label: 'Adversaire' },
    { id: 'target', label: 'VL target' },
    { id: 'all', label: 'Toutes' },
];

// Couleurs pour le mode libre (Pax Libre) - Couleurs distinctes des boutons natifs
// 12 couleurs NETTEMENT distinctes entre elles (familles perceptives maximales,
// principe Kelly/Boynton) et SANS équivoque avec les 4 boutons par défaut :
// rouge Adversaire #be1b09, jaune Otage/Civil #f1c40f, bleu Inter #3498db,
// verts Nego/Oscar #2ecc71/#10b981 (et gris sombre Autre #2d2d2d).
// NB : les entrées déjà saisies gardent leur hex stocké — aucune migration.
export const FREE_MODE_COLORS: PctacNamedColor[] = [
    { hex: '#7c3aed', name: 'Violet' }, // violet profond (≠ lavande, ≠ rose)
    { hex: '#c084fc', name: 'Lavande' }, // lilas clair (écart de clarté fort avec Violet)
    { hex: '#ff69b4', name: 'Rose' }, // rose bonbon (seul rose de la palette)
    { hex: '#ff7f00', name: 'Orange' }, // orange vif (≠ rouge sombre, ≠ jaune citron)
    { hex: '#8b4513', name: 'Marron' }, // brun selle
    { hex: '#d2b48c', name: 'Beige' }, // sable clair
    { hex: '#808000', name: 'Olive' }, // vert-jaune sombre (≠ verts vifs par défaut)
    { hex: '#0f766e', name: 'Pétrole' }, // bleu-vert sombre (≠ émeraude, ≠ cyan)
    { hex: '#22d3ee', name: 'Cyan' }, // cyan clair électrique (≠ bleu Inter)
    { hex: '#1e3a8a', name: 'Bleu nuit' }, // marine très sombre (≠ bleu Inter moyen)
    { hex: '#94a3b8', name: 'Gris' }, // gris moyen (≠ Autre sombre, ≠ Blanc)
    { hex: '#ffffff', name: 'Blanc' },
];

// Couleurs statiques pour le PDF et l'affichage (Mode Standard)
export const PDF_PAX_COLORS: Record<string, PctacPaxColorEntry> = {
    Adversaire: { text: 'Adversaire', color: '#be1b09', fontColor: '#ffffff' },
    Otage: { text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' },
    Civil: { text: 'Civil/Otage', color: '#f1c40f', fontColor: '#000000' },
    Inter: { text: 'Inter', color: '#3498db', fontColor: '#ffffff' },
    Nego: { text: 'Nego', color: '#2ecc71', fontColor: '#000000' },
    Oscar: { text: 'Oscar', color: '#10b981', fontColor: '#000000' },
    Autre: { text: 'Autre', color: '#2d2d2d', fontColor: '#e0e0e0' },
};

// Paramètres QR Code
/* U16/C1 — Statuts des fiches adversaire/otage (source de vérité : la FICHE).
 * Badge symbole+couleur (pas couleur seule — daltonisme). */
export interface PctacStatusMeta { label: string; symbol: string; color: string }

export const ADV_STATUS: Record<string, PctacStatusMeta> = {
    active: { label: 'Actif', symbol: '▲', color: '#ef4444' },
    neutralized: { label: 'Neutralisé', symbol: '✔', color: '#22c55e' },
};

export const HOST_STATUS: Record<string, PctacStatusMeta> = {
    ok: { label: 'OK', symbol: '✔', color: '#22c55e' },
    preoccupant: { label: 'Préoccupant', symbol: '!', color: '#eab308' },
    blesse: { label: 'Blessé', symbol: '✚', color: '#ef4444' },
    dcd: { label: 'DCD', symbol: '✝', color: '#94a3b8' },
};

/**
 * Heuristique blessures → statut otage (U16, extraite de main.ts:312-319 :
 * partagée entre création de fiche et recalcul à l'édition).
 */
export function hostageStatusFromBlessures(blessures: unknown): string {
    const b = String(blessures ?? '').toLowerCase().trim();
    const rasTerms = ['ras', '-', '/', 'rien', 'neant', 'néant', 'idemne', 'indemne', 'aucune', '0', 'ok'];
    const isRas = b === '' || rasTerms.some((term) => b === term || b === term + '.');
    let status = 'ok';
    if ((b !== '' && !isRas) || b.includes('inconnu') || b === '?') status = 'preoccupant';
    if (b.includes('blesse') || b.includes('blessé') || b.includes('grave')) status = 'blesse';
    if (b.includes('mort') || b.includes('dcd') || b.includes('decede') || b.includes('décédé')) status = 'dcd';
    return status;
}

export const QR_BATCH_SIZE = 5;
export const LONG_PRESS_DELAY = 700;

/**
 * Normalise un texte pour matching (sans accents, lowercase, trim).
 */
export function normalizeForMatch(s: string | null | undefined): string {
    return (s || '').toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim();
}

/**
 * Renvoie les icônes les plus pertinentes pour un libellé donné.
 * Score = somme des correspondances de tokens (label ∩ tags).
 */
export function suggestPinIcons(label: string, max = 6): PctacPinIcon[] {
    const txt = normalizeForMatch(label);
    if (!txt) return [];
    const tokens = txt.split(/\s+/).filter((t) => t.length >= 2);
    if (!tokens.length) return [];

    const scored = PIN_ICONS.map((ic) => {
        let score = 0;
        const haystacks = [normalizeForMatch(ic.label), ...ic.tags.map((t) => normalizeForMatch(t))];
        tokens.forEach((tok) => {
            for (const h of haystacks) {
                if (h.includes(tok)) { score += (h === tok ? 3 : 1); break; }
            }
        });
        return { ic, score };
    }).filter((x) => x.score > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map((x) => x.ic);
}

/**
 * Mapping catégorie de photo → métadonnées de nœud pour le board "Dashboard".
 *
 * Chaque entrée décrit comment représenter un nœud :
 *  - type  : identifiant logique du type de nœud
 *  - icon  : nom d'icône Material Symbols Outlined
 *  - label : libellé d'affichage
 *  - role  : 'hub' (centre de cluster) | 'satellite' (gravite autour du hub)
 *
 * Le 'Lieu' (location) est le HUB central de son cluster ; tous les autres
 * acteurs (adversaire, otage, véhicule, piégeage) sont des satellites.
 * La catégorie 'all' n'a pas de représentation board (ignorée).
 */
export interface PctacBoardNodeType {
    type: string;
    icon: string;
    label: string;
    role: 'hub' | 'satellite';
}

export const BOARD_NODE_TYPES: Record<string, PctacBoardNodeType> = {
    neutralized: { type: 'adversary', icon: 'person_alert', label: 'Adversaire', role: 'satellite' },
    target: { type: 'vehicle', icon: 'directions_car', label: 'Véhicule', role: 'satellite' },
    location: { type: 'location', icon: 'maps_home_work', label: 'Lieu', role: 'hub' },
    hostage: { type: 'hostage', icon: 'person_off', label: 'Otage', role: 'satellite' },
    trap: { type: 'trap', icon: 'dangerous', label: 'Piégeage', role: 'satellite' },
};

/**
 * Découpe un intitulé de photo en tokens normalisés (trim + UPPER).
 *
 * - Normalise : suppression des diacritiques, passage en MAJUSCULES, trim.
 * - Split sur les espaces et la ponctuation courante (tokens = mots entiers).
 * - Cas particulier "lettres de façade" : si un token est une courte suite de
 *   lettres de façade A–F uniquement (ex 'AB'), on renvoie AUSSI chacune de ses
 *   lettres comme tokens individuels (ex 'AB' → 'AB','A','B'). Cela permet à un
 *   libellé de façade composé de matcher les façades unitaires.
 *   On NE déstructure PAS les vrais mots (ex 'RENAULT' reste un seul token)
 *   afin d'éviter les faux positifs lors d'un match par token (cf. C-MATCH cas 2).
 *
 * Défensif : title null/undefined → [].
 *
 * @param title
 * @returns tokens normalisés, dédupliqués, sans vide.
 */
export function labelTokens(title: string | null | undefined): string[] {
    if (title == null) return [];
    const norm = title.toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
        .toUpperCase()
        .trim();
    if (!norm) return [];

    // Split sur espaces / ponctuation : ne conserve que [A-Z0-9]
    const rawTokens = norm.split(/[^A-Z0-9]+/).filter(Boolean);

    const out = new Set<string>();
    for (const tok of rawTokens) {
        out.add(tok);
        // Lettres de façade uniquement (A–F, suite courte ≤ 6) → exploser en
        // lettres individuelles. Borne longueur pour ne pas éclater un mot.
        if (tok.length > 1 && tok.length <= 6 && /^[A-F]+$/.test(tok)) {
            for (const ch of tok) out.add(ch);
        }
    }
    return Array.from(out);
}

/** Sous-ensemble de champs d'une photo requis par `matchPhotosByLabel`. */
export interface PctacMatchablePhoto {
    title?: string | null | undefined;
    category?: string | null | undefined;
}

/**
 * Matche un libellé (lettre(s) de façade ou token quelconque) contre une
 * liste de photos, selon le CONTRAT C-MATCH.
 *
 * Normalisation : trim + UPPER (via labelTokens / regex internes).
 *
 * Règles :
 *  1. Si le label est une/deux lettre(s) de façade (/^[A-F]{1,2}$/ après
 *     normalisation) → on ne considère que les photos de catégorie 'location',
 *     et on les retient si l'ENSEMBLE des lettres du titre INTERSECTE
 *     l'ensemble des lettres du label.
 *       ex : label 'A'  matche titres 'A','AB','BA'
 *            label 'AB' matche 'A','B','AB','BC' (via 'B')
 *  2. Sinon → égalité de token normalisé sur le titre (toutes catégories) :
 *     la photo matche si l'un de ses tokens (labelTokens du titre) est
 *     strictement égal au label normalisé.
 *
 * Pure, sans I/O. Défensif : label/photos null → [].
 *
 * @param label
 * @param photos
 * @returns sous-ensemble de `photos` correspondant.
 */
export function matchPhotosByLabel<T extends PctacMatchablePhoto>(
    label: string | null | undefined,
    photos: readonly T[] | null | undefined,
): T[] {
    if (label == null || !Array.isArray(photos)) return [];

    // Normalisation du label : trim + UPPER + sans accents
    const normLabel = label.toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
    if (!normLabel) return [];

    // --- Cas 1 : lettres de façade A–F (1 ou 2 lettres) ---
    if (/^[A-F]{1,2}$/.test(normLabel)) {
        const labelLetters = new Set(normLabel.split(''));
        return photos.filter((p) => {
            if (!p || p.category !== 'location') return false;
            // Ensemble des lettres (A-Z) présentes dans le titre de la photo
            const titleLetters = new Set(
                (p.title == null ? '' : p.title.toString())
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .toUpperCase()
                    .replace(/[^A-Z]/g, '')
                    .split(''),
            );
            // Intersection non vide ?
            for (const ch of labelLetters) {
                if (titleLetters.has(ch)) return true;
            }
            return false;
        });
    }

    // --- Cas 2 : égalité de token normalisé (toutes catégories) ---
    return photos.filter((p) => {
        if (!p) return false;
        return labelTokens(p.title).includes(normLabel);
    });
}

window.PIN_ICONS = PIN_ICONS;
window.suggestPinIcons = suggestPinIcons;

// Exposition globale
window.LOCAL_STORAGE_KEY = LOCAL_STORAGE_KEY;
window.PHOTO_CATEGORIES = PHOTO_CATEGORIES;
window.FREE_MODE_COLORS = FREE_MODE_COLORS;
window.PDF_PAX_COLORS = PDF_PAX_COLORS;
