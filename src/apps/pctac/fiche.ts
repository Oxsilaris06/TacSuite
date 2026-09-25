/**
 * fiche.ts — Modèle des fiches adverse et protégée (décisions 16 à 20).
 *
 * Une seule fiche par camp, dont les SECTIONS répondent aux questions de
 * QQOCQPC et de PNAVSA sans jamais les poser : Identité et Signalement disent
 * « qui », Position « où » (le P), Armement « comment » (le A), Comportement
 * les A, S, N, V, Faits et mobile « quoi, quand, pourquoi ». « Combien » se
 * compte en fiches (`ficheCounters`), jamais en saisie.
 *
 * Fichier de DONNÉES et de fonctions pures : l'écran (`fiche-sheet.ts`), les
 * cartes (`ui.ts`) et le PDF lisent tous ce même modèle. Un libellé se corrige
 * ici, une seule fois.
 *
 * Les clés sont posées À PLAT sur la fiche. Les clés historiques (`nom`,
 * `attitude`, `armes`, `etat`, `blessures`…) ne changent pas : les fiches déjà
 * enregistrées se relisent sans migration. Un champ à pastilles écrit dans sa
 * clé historique « pastille, pastille, précision » (format de la décision 9) :
 * un ancien texte libre se relit comme une précision.
 */

import { PCTAC_MODES, type PctacModeId } from '@pctac/modes.js';
import { ADV_STATUS, HOST_STATUS } from '@pctac/config.js';
import type { PctacCollectionItem } from '@shared/types/contracts.js';

export type FicheSide = 'adv' | 'host';

/** Situation, ou Ampleur quand la menace est un phénomène (NRBC, foule…). */
export type FicheVariant = PctacModeId | 'phenomene';

export type FieldKind = 'text' | 'long' | 'chips' | 'time' | 'tel' | 'dob' | 'link';

export interface FicheField {
    key: string;
    label: string;
    kind: FieldKind;
    /** Aide dans le champ ; pour les pastilles, celle de la précision. */
    placeholder?: string;
    chips?: readonly string[];
    /** Une seule pastille à la fois. */
    single?: boolean;
    /** Pastilles qui excluent toutes les autres (« Aucune connue »). */
    exclusive?: readonly string[];
    /** Précision numérique (clavier à chiffres). */
    numeric?: boolean;
}

export interface FicheSection {
    id: string;
    title: string;
    fields: FicheField[];
}

interface FieldDef extends FicheField {
    /** Variantes où le champ apparaît (toutes si absent). */
    only?: readonly FicheVariant[];
    /** Variantes où il n'apparaît pas. */
    except?: readonly FicheVariant[];
    labels?: Partial<Record<FicheVariant, string>>;
    placeholders?: Partial<Record<FicheVariant, string>>;
}

interface SectionDef {
    id: string;
    title: string;
    titles?: Partial<Record<FicheVariant, string>>;
    fields: FieldDef[];
}

const PHENOMENE: readonly FicheVariant[] = ['phenomene'];
const RECHERCHE: readonly FicheVariant[] = ['recherche'];

export const TYPE_MENACE_KEY = 'type_menace';

/** Type de la menace, en tête de fiche en Ampleur. */
export const TYPE_MENACE_FIELD: FicheField = {
    key: TYPE_MENACE_KEY,
    label: 'Type de menace',
    kind: 'chips',
    chips: ['Personne', 'Groupe', 'Phénomène'],
    single: true,
};

const ADV_SECTIONS: readonly SectionDef[] = [
    {
        id: 'identite',
        title: 'Identité',
        titles: { phenomene: 'Désignation' },
        fields: [
            { key: 'nom', label: 'Nom', kind: 'text', placeholder: 'Nom',
                labels: { phenomene: 'Désignation' }, placeholders: { phenomene: 'Fuite de chlore, effondrement…' } },
            { key: 'prenom', label: 'Prénom', kind: 'text', placeholder: 'Prénom', except: PHENOMENE },
            { key: 'alias', label: 'Alias, surnom', kind: 'text', except: PHENOMENE },
            { key: 'dob', label: 'D.N. ou âge', kind: 'dob', placeholder: 'JJ/MM/AAAA ou ~40 ans', except: PHENOMENE },
            { key: 'telephone', label: 'Téléphone', kind: 'tel', only: RECHERCHE },
            { key: 'domicile', label: 'Domicile', kind: 'text', placeholder: 'Adresse', except: PHENOMENE },
            { key: 'profession', label: 'Profession', kind: 'text', except: PHENOMENE },
            { key: 'antecedents', label: 'Antécédents', kind: 'long', placeholder: 'Fichage, judiciaire, psychiatrique…', except: PHENOMENE },
        ],
    },
    {
        id: 'signalement',
        title: 'Signalement',
        fields: [
            { key: 'signalement', label: 'Physique', kind: 'long', placeholder: 'Taille, corpulence, cheveux, signes distinctifs…', except: PHENOMENE },
            { key: 'tenue', label: 'Tenue', kind: 'text', placeholder: 'Vêtements, couleurs…', except: PHENOMENE },
            { key: 'vehicule', label: 'Véhicule', kind: 'text', placeholder: 'Marque, modèle, couleur, immatriculation', except: PHENOMENE },
        ],
    },
    {
        id: 'position',
        title: 'Position',
        titles: { recherche: 'Dernière localisation', phenomene: 'Épicentre' },
        fields: [
            { key: 'position', label: 'Position', kind: 'text', placeholder: 'Étage, pièce, retranchement…',
                labels: { recherche: 'Dernier lieu connu', phenomene: 'Épicentre, emprise' },
                placeholders: { recherche: 'Adresse, secteur…', phenomene: 'Foyer, zones exposées, périmètre…' } },
            { key: 'position_heure', label: 'Repérée à', kind: 'time',
                labels: { recherche: 'Dernière vue certaine', phenomene: 'Constatée à' } },
            { key: 'mouvement', label: 'Mouvement', kind: 'chips', single: true,
                chips: ['Retranché', 'En mouvement', 'En fuite', 'Inconnu'], placeholder: 'Direction, destination', except: PHENOMENE },
        ],
    },
    {
        id: 'sante',
        title: 'Santé et entourage',
        fields: [
            { key: 'sante', label: 'Santé, vulnérabilité', kind: 'chips', only: RECHERCHE,
                chips: ['Mineur', 'Traitement vital', 'Trouble cognitif', 'Idées suicidaires', 'Aucune connue'],
                exclusive: ['Aucune connue'], placeholder: 'Traitement, pathologie…' },
            { key: 'requerant', label: 'Requérant, contact', kind: 'text', placeholder: 'Nom, lien, téléphone', only: RECHERCHE },
        ],
    },
    {
        id: 'armement',
        title: 'Armement et moyens',
        titles: { phenomene: 'Vecteur' },
        fields: [
            { key: 'armes', label: 'Armes', kind: 'chips', except: PHENOMENE,
                chips: ['Arme de poing', 'Arme longue', 'Arme blanche', 'Explosif / piège', 'Par destination', 'Aucune connue'],
                exclusive: ['Aucune connue'], placeholder: 'Type, calibre, nombre, position' },
            { key: 'armes', label: 'Vecteur, agent', kind: 'long', only: PHENOMENE, placeholder: 'Agent chimique, feu, structure, foule…' },
            { key: 'protection', label: 'Protection', kind: 'chips', except: PHENOMENE,
                chips: ['Gilet', 'Casque', 'Barricadé', 'Aucune connue'], exclusive: ['Aucune connue'], placeholder: 'Précision' },
            { key: 'evolution', label: 'Risques évolutifs', kind: 'long', only: PHENOMENE, placeholder: 'Sur-accident, propagation, effondrement…' },
        ],
    },
    {
        id: 'comportement',
        title: 'Comportement',
        fields: [
            { key: 'attitude', label: 'Attitude', kind: 'chips', except: PHENOMENE,
                chips: ['Calme', 'Agité', 'Menaçant', 'Suicidaire', 'Négocie', 'Mutique', 'Imprévisible'], placeholder: 'Précision' },
            { key: 'substance', label: 'Substance', kind: 'chips', except: PHENOMENE,
                chips: ['Alcool', 'Stupéfiants', 'Médicaments', 'Aucune', 'Inconnue'], exclusive: ['Aucune', 'Inconnue'], placeholder: 'Précision' },
            { key: 'nature', label: 'Profil', kind: 'chips', except: PHENOMENE,
                chips: ['Isolé', 'Groupe organisé', 'Sympathisant', 'Trouble psychique'], placeholder: 'Précision' },
            { key: 'volume', label: 'Nombre', kind: 'chips', single: true, numeric: true, except: PHENOMENE,
                chips: ['Certain', 'Estimé'], placeholder: 'Nombre d’individus' },
        ],
    },
    {
        id: 'faits',
        title: 'Faits et mobile',
        fields: [
            { key: 'quoi', label: 'Faits constatés', kind: 'long', placeholder: 'Tirs, menaces, séquestration…',
                placeholders: { recherche: 'Disparition, fugue, évasion…', phenomene: 'Ce qui s’est produit…' } },
            { key: 'quand', label: 'Début des faits', kind: 'time' },
            { key: 'pourquoi', label: 'Mobile, revendication', kind: 'long', placeholder: 'Familial, judiciaire, idéologique…',
                labels: { recherche: 'Contexte', phenomene: 'Cause' } },
            { key: 'lien', label: 'Relation aux victimes', kind: 'text', placeholder: 'Ex-conjoint, employeur…', except: PHENOMENE,
                labels: { recherche: 'Relation aux témoins' } },
        ],
    },
];

const HOST_SECTIONS: readonly SectionDef[] = [
    {
        id: 'identite',
        title: 'Identité',
        fields: [
            { key: 'nom', label: 'Nom', kind: 'text', placeholder: 'Nom' },
            { key: 'prenom', label: 'Prénom', kind: 'text', placeholder: 'Prénom' },
            { key: 'dob', label: 'D.N. ou âge', kind: 'dob', placeholder: 'JJ/MM/AAAA ou ~40 ans' },
            { key: 'telephone', label: 'Téléphone', kind: 'tel', only: RECHERCHE },
            { key: 'vulnerabilite', label: 'Vulnérabilité', kind: 'chips', except: RECHERCHE,
                chips: ['Enfant', 'Personne âgée', 'PMR', 'Enceinte', 'Traitement'], placeholder: 'Précision' },
            { key: 'contact', label: 'Personne à prévenir', kind: 'text', placeholder: 'Nom, lien, téléphone', except: RECHERCHE },
        ],
    },
    {
        id: 'etat',
        title: 'État',
        fields: [
            { key: 'etat', label: 'État', kind: 'chips', except: RECHERCHE,
                chips: ['Conscient', 'Inconscient', 'Choqué', 'Paniqué', 'Coopérant'], placeholder: 'Précision' },
            { key: 'blessures', label: 'Blessures', kind: 'long', placeholder: 'Localisation, gravité', except: RECHERCHE },
        ],
    },
    {
        id: 'position',
        title: 'Position',
        fields: [
            { key: 'position', label: 'Position', kind: 'text', placeholder: 'Étage, pièce…', except: RECHERCHE },
            { key: 'position_heure', label: 'Repérée à', kind: 'time', except: RECHERCHE },
            // Libellé : vocabulaire de la situation (« Lien ennemi »…), cf. hostLinkLabel.
            { key: 'lien', label: 'Lien', kind: 'link', except: RECHERCHE },
        ],
    },
    {
        id: 'prise_en_charge',
        title: 'Prise en charge',
        fields: [
            { key: 'prise_en_charge', label: 'Pris en charge par', kind: 'chips', only: ['tp', 'evenement'],
                chips: ['SAMU', 'SDIS', 'Forces', 'Aucun'], exclusive: ['Aucun'], placeholder: 'Précision' },
            { key: 'evacuation', label: 'Destination', kind: 'text', placeholder: 'PRV, PMA, hôpital', only: ['tp', 'evenement'] },
            { key: 'evacuation_heure', label: 'Évacuée à', kind: 'time', only: ['tp', 'evenement'] },
        ],
    },
    {
        id: 'temoignage',
        title: 'Témoignage',
        fields: [
            { key: 'temoignage', label: 'Ce qu’il a vu', kind: 'long', placeholder: 'Personne, direction, véhicule…', only: RECHERCHE },
            { key: 'position', label: 'Lieu observé', kind: 'text', only: RECHERCHE },
            { key: 'position_heure', label: 'Heure observée', kind: 'time', only: RECHERCHE },
            { key: 'fiabilite', label: 'Fiabilité', kind: 'chips', single: true, chips: ['Certaine', 'Probable', 'Douteuse'], only: RECHERCHE },
            { key: 'lien', label: 'Lien', kind: 'link', only: RECHERCHE },
        ],
    },
    {
        id: 'signalement',
        title: 'Signalement',
        fields: [
            { key: 'signalement', label: 'Physique', kind: 'long', placeholder: 'Taille, corpulence, cheveux, signes distinctifs…', except: RECHERCHE },
            { key: 'tenue', label: 'Tenue', kind: 'text', placeholder: 'Vêtements, couleurs…', except: RECHERCHE },
        ],
    },
];

/** Ordre des sections : ce qui sauve des vies d'abord. La 1re s'ouvre d'office. */
const ORDER: Record<FicheSide, Record<FicheVariant, readonly string[]>> = {
    adv: {
        forcene: ['identite', 'position', 'armement', 'comportement', 'signalement', 'faits'],
        tp: ['position', 'armement', 'signalement', 'identite', 'comportement', 'faits'],
        recherche: ['identite', 'signalement', 'position', 'sante', 'comportement', 'armement', 'faits'],
        evenement: ['position', 'armement', 'identite', 'signalement', 'comportement', 'faits'],
        phenomene: ['position', 'armement', 'identite', 'faits'],
    },
    host: {
        forcene: ['identite', 'etat', 'position', 'signalement'],
        tp: ['etat', 'position', 'prise_en_charge', 'identite', 'signalement'],
        recherche: ['identite', 'temoignage'],
        evenement: ['etat', 'position', 'prise_en_charge', 'identite', 'signalement'],
        phenomene: ['etat', 'position', 'prise_en_charge', 'identite', 'signalement'],
    },
};

/** Trois faits clés de la carte résumé, dans cet ordre. */
const SUMMARY: Record<FicheSide, Partial<Record<FicheVariant, readonly string[]>> & { default: readonly string[] }> = {
    adv: { default: ['position', 'armes', 'attitude'], phenomene: ['position', 'armes', 'evolution'] },
    host: { default: ['etat', 'blessures', 'position'], recherche: ['temoignage', 'position', 'fiabilite'] },
};

export function ficheVariant(side: FicheSide, modeId: PctacModeId, item: Record<string, unknown> = {}): FicheVariant {
    if (side === 'adv' && modeId === 'evenement' && item[TYPE_MENACE_KEY] === 'Phénomène') return 'phenomene';
    return modeId;
}

/** Champs posés en tête de fiche, au-dessus des sections. */
export function headerFields(side: FicheSide, modeId: PctacModeId): FicheField[] {
    return side === 'adv' && modeId === 'evenement' ? [TYPE_MENACE_FIELD] : [];
}

function visibleIn(def: FieldDef, variant: FicheVariant): boolean {
    if (def.only && !def.only.includes(variant)) return false;
    if (def.except?.includes(variant)) return false;
    return true;
}

function resolveField(def: FieldDef, side: FicheSide, modeId: PctacModeId, variant: FicheVariant): FicheField {
    const out: FicheField = { key: def.key, kind: def.kind, label: def.labels?.[variant] ?? def.label };
    if (def.chips) out.chips = def.chips;
    if (def.single) out.single = true;
    if (def.exclusive) out.exclusive = def.exclusive;
    if (def.numeric) out.numeric = true;
    const placeholder = def.placeholders?.[variant] ?? def.placeholder;
    if (placeholder !== undefined) out.placeholder = placeholder;
    if (side === 'host' && def.kind === 'link') out.label = PCTAC_MODES[modeId].host.linkLabel;
    return out;
}

/** Sections visibles de la fiche, dans l'ordre de la situation, sans section vide. */
export function ficheSections(side: FicheSide, modeId: PctacModeId, item: Record<string, unknown> = {}): FicheSection[] {
    const variant = ficheVariant(side, modeId, item);
    const defs = side === 'adv' ? ADV_SECTIONS : HOST_SECTIONS;
    return ORDER[side][variant]
        .map((id) => defs.find((d) => d.id === id))
        .filter((d): d is SectionDef => d !== undefined)
        .map((d) => ({
            id: d.id,
            title: d.titles?.[variant] ?? d.title,
            fields: d.fields.filter((f) => visibleIn(f, variant)).map((f) => resolveField(f, side, modeId, variant)),
        }))
        .filter((s) => s.fields.length > 0);
}

// --- Pastilles ---------------------------------------------------------------

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Relit une valeur stockée : pastilles en tête, puis la précision MOT POUR MOT.
 * `serializeChips` écrit les pastilles d'abord, dans l'ordre de la liste : on
 * ne lit donc comme pastilles que les jetons de tête qui respectent cet ordre
 * (et l'exclusivité, le choix unique). Tout le reste est rendu tel quel, sans
 * redécoupage : « Fusil 7,62 mm » garde sa virgule décimale, et une précision
 * « aucune connue » écrite après « Arme de poing » reste du texte.
 */
export function parseChips(
    value: unknown,
    chips: readonly string[],
    rules: { single?: boolean; exclusive?: readonly string[] } = {},
): { selected: string[]; precision: string } {
    const text = String(value ?? '');
    const selected: string[] = [];
    let rest = text;
    let lastIndex = -1;
    for (;;) {
        const comma = rest.indexOf(',');
        const token = (comma < 0 ? rest : rest.slice(0, comma)).trim();
        const index = chips.findIndex((c) => norm(c) === norm(token));
        if (index <= lastIndex) break;
        const chip = chips[index] as string;
        const exclusive = rules.exclusive?.includes(chip) ?? false;
        const blocked = selected.length > 0 && (rules.single || exclusive || selected.some((c) => rules.exclusive?.includes(c)));
        if (blocked) break;
        selected.push(chip);
        lastIndex = index;
        rest = comma < 0 ? '' : rest.slice(comma + 1);
        if (comma < 0) break;
    }
    return { selected, precision: rest.trim() };
}

export function serializeChips(selected: readonly string[], precision: string, chips: readonly string[]): string {
    const ordered = chips.filter((c) => selected.includes(c));
    const p = precision.trim();
    return [...ordered, ...(p ? [p] : [])].join(', ');
}

/** Bascule une pastille, en tenant choix unique et pastilles exclusives. */
export function toggleChip(selected: readonly string[], chip: string, field: FicheField): string[] {
    if (selected.includes(chip)) return selected.filter((c) => c !== chip);
    if (field.single || field.exclusive?.includes(chip)) return [chip];
    return [...selected.filter((c) => !field.exclusive?.includes(c)), chip];
}

// --- Statuts -----------------------------------------------------------------

export interface StatusChoice {
    key: string;
    label: string;
    symbol: string;
    color: string;
}

const STATUS_KEYS: Record<FicheSide, Record<PctacModeId, readonly string[]>> = {
    adv: {
        forcene: ['active', 'neutralized'],
        tp: ['active', 'neutralized'],
        recherche: ['active', 'located', 'neutralized'],
        evenement: ['active', 'located', 'neutralized'],
    },
    host: {
        forcene: ['ok', 'preoccupant', 'blesse', 'dcd'],
        tp: ['nt', 'eu', 'ua', 'ur', 'impl', 'dcd'],
        // Témoin : pas de statut.
        recherche: [],
        evenement: ['nt', 'eu', 'ua', 'ur', 'impl', 'dcd'],
    },
};

const STATUS_LABELS: Partial<Record<PctacModeId, Record<string, string>>> = {
    recherche: { active: 'Recherchée', located: 'Localisée', neutralized: 'Retrouvée' },
    evenement: { active: 'Active', located: 'Contenue', neutralized: 'Levée' },
};

function baseMeta(side: FicheSide, key: string): StatusChoice | null {
    const meta = (side === 'adv' ? ADV_STATUS : HOST_STATUS)[key];
    return meta ? { key, ...meta } : null;
}

export function statusChoices(side: FicheSide, modeId: PctacModeId): StatusChoice[] {
    return STATUS_KEYS[side][modeId]
        .map((key) => {
            const meta = baseMeta(side, key);
            if (!meta) return null;
            const label = side === 'adv' ? STATUS_LABELS[modeId]?.[key] : undefined;
            return label ? { ...meta, label } : meta;
        })
        .filter((c): c is StatusChoice => c !== null);
}

/** Statut lisible, même venu d'une autre situation ou inconnu. */
export function statusMeta(side: FicheSide, modeId: PctacModeId, key: string): StatusChoice {
    return statusChoices(side, modeId).find((c) => c.key === key)
        ?? baseMeta(side, key)
        ?? { key, label: key, symbol: '', color: '#64748b' };
}

export function defaultStatus(side: FicheSide, modeId: PctacModeId): string {
    if (side === 'adv') return 'active';
    return modeId === 'tp' || modeId === 'evenement' ? 'nt' : 'ok';
}

// --- Lecture -----------------------------------------------------------------

/** Âge révolu d'une date JJ/MM/AAAA valide ; `null` pour une estimation. */
export function ageFromDob(dob: unknown, now: Date = new Date()): number | null {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dob ?? '').trim());
    if (!m) return null;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    let age = now.getFullYear() - y;
    if (now.getMonth() < mo - 1 || (now.getMonth() === mo - 1 && now.getDate() < d)) age--;
    return age >= 0 && age <= 130 ? age : null;
}

export interface FicheRow { label: string; value: string }

function displayValue(field: FicheField, raw: unknown, now: Date, resolveLink?: (id: string) => string): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    if (field.kind === 'dob') {
        const age = ageFromDob(value, now);
        return age === null ? value : `${value} (${age} ans)`;
    }
    if (field.kind === 'link' && resolveLink) return resolveLink(value);
    return value;
}

/** Sections remplies seulement, dans la variante de la fiche (écran et PDF). */
export function filledSections(
    side: FicheSide,
    modeId: PctacModeId,
    item: Record<string, unknown>,
    now: Date = new Date(),
    resolveLink?: (id: string) => string,
): { title: string; rows: FicheRow[] }[] {
    return ficheSections(side, modeId, item)
        .map((s) => ({
            title: s.title,
            rows: s.fields
                .map((f) => ({ label: f.label, value: displayValue(f, item[f.key], now, resolveLink) }))
                .filter((r) => r.value !== ''),
        }))
        .filter((s) => s.rows.length > 0);
}

/** Trois faits clés au plus, remplis seulement. */
export function summaryRows(side: FicheSide, modeId: PctacModeId, item: Record<string, unknown>, now: Date = new Date()): FicheRow[] {
    const variant = ficheVariant(side, modeId, item);
    const wanted = SUMMARY[side][variant] ?? SUMMARY[side].default;
    const fields = ficheSections(side, modeId, item).flatMap((s) => s.fields);
    return wanted
        .map((key) => fields.find((f) => f.key === key))
        .filter((f): f is FicheField => f !== undefined)
        .map((f) => ({ label: f.label, value: displayValue(f, item[f.key], now) }))
        .filter((r) => r.value !== '');
}

export function ficheTitle(side: FicheSide, modeId: PctacModeId, item: Record<string, unknown>): string {
    const nom = String(item.nom ?? '').trim();
    if (ficheVariant(side, modeId, item) === 'phenomene') return nom || '(sans nom)';
    return `${nom} ${String(item.prenom ?? '').trim()}`.trim() || '(sans nom)';
}

/** Ordre des compteurs : du plus grave au plus léger, « Non triée » en dernier. */
const COUNTER_ORDER = ['active', 'located', 'neutralized', 'eu', 'ua', 'ur', 'blesse', 'preoccupant', 'impl', 'ok', 'dcd', 'nt'];

function countLine(side: FicheSide, modeId: PctacModeId, items: readonly Record<string, unknown>[]): string {
    if (items.length === 0) return '';
    const counts = new Map<string, number>();
    items.forEach((it) => {
        const k = String(it.status || defaultStatus(side, modeId));
        counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    const rank = (k: string): number => { const i = COUNTER_ORDER.indexOf(k); return i < 0 ? COUNTER_ORDER.length : i; };
    const parts = [...counts.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]))
        .map(([k, n]) => `${statusMeta(side, modeId, k).label} ${n}`);
    const noun = PCTAC_MODES[modeId][side].plural;
    // Témoin (pas de statut) : le total suffit.
    return statusChoices(side, modeId).length === 0 ? `${noun} ${items.length}` : [`${noun} ${items.length}`, ...parts].join(' · ');
}

/**
 * Ordre de PRIORITÉ d'affichage/tri (décision 33) : une seule source pour
 * l'écran et le PDF.
 *   - Protégés triage (TP, Ampleur) : Non triée → EU → UA → UR → Impliqué → DCD.
 *   - Protégés Forcené (hors triage) : Blessé → Préoccupant → OK → DCD.
 *   - Témoins (Recherche) : pas de statut, l'ordre de création tient.
 *   - Adversaires : actifs d'abord, puis l'ordre de `statusChoices`.
 */
const HOST_PRIORITY: Partial<Record<PctacModeId, readonly string[]>> = {
    forcene: ['blesse', 'preoccupant', 'ok', 'dcd'],
    tp: ['nt', 'eu', 'ua', 'ur', 'impl', 'dcd'],
    evenement: ['nt', 'eu', 'ua', 'ur', 'impl', 'dcd'],
};

function priorityKeys(side: FicheSide, modeId: PctacModeId): readonly string[] {
    if (side === 'adv') return statusChoices('adv', modeId).map((c) => c.key);
    return HOST_PRIORITY[modeId] ?? [];
}

/**
 * Trie une liste de fiches par priorité de statut, à priorité égale par ordre
 * de création (le tri est STABLE, l'ordre d'entrée est conservé). Ne mute pas
 * l'entrée. Un statut inconnu (fiche d'une autre situation) passe en dernier.
 */
export function sortFichesByPriority<T extends Record<string, unknown>>(
    side: FicheSide,
    modeId: PctacModeId,
    items: readonly T[],
): T[] {
    const keys = priorityKeys(side, modeId);
    if (keys.length === 0) return [...items];
    const rank = (item: T): number => {
        const status = String(item.status || defaultStatus(side, modeId));
        const index = keys.indexOf(status);
        return index < 0 ? keys.length : index;
    };
    return items
        .map((item, index) => ({ item, index, key: rank(item) }))
        .sort((a, b) => (a.key - b.key) || (a.index - b.index))
        .map((entry) => entry.item);
}

/** « Combien » : calculé depuis les fiches, jamais saisi. */
export function ficheCounters(
    modeId: PctacModeId,
    advs: readonly Record<string, unknown>[],
    hosts: readonly Record<string, unknown>[],
): { adv: string; host: string } {
    return { adv: countLine('adv', modeId, advs), host: countLine('host', modeId, hosts) };
}

// --- Doublons et fusion (décision 32) ----------------------------------------

/** Normalisation d'une identité : casse, accents et espaces réduits. */
function normalizePerson(value: unknown): string {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Une fiche « Phénomène » (Ampleur) n'est jamais une personne. */
function isPhenomene(item: Record<string, unknown>): boolean {
    return item[TYPE_MENACE_KEY] === 'Phénomène';
}

/**
 * Cherche, parmi `items`, une fiche désignant la MÊME personne que `candidate` :
 *   - même nom ET même prénom (les deux non vides et égaux), OU
 *   - même nom ET même date de naissance (`dob`, les deux non vides et égaux),
 * comparaison normalisée (casse, accents, espaces). Jamais `candidate` lui-même
 * (même `id`). Une fiche « Phénomène » n'est jamais un doublon.
 */
export function findDuplicatePerson(
    items: readonly PctacCollectionItem[],
    candidate: PctacCollectionItem,
): PctacCollectionItem | null {
    if (isPhenomene(candidate)) return null;
    const nom = normalizePerson(candidate.nom);
    const prenom = normalizePerson(candidate.prenom);
    const dob = normalizePerson(candidate.dob);
    for (const item of items) {
        if (item.id === candidate.id) continue;
        if (isPhenomene(item)) continue;
        const otherNom = normalizePerson(item.nom);
        if (!nom || !otherNom || nom !== otherNom) continue;
        const otherPrenom = normalizePerson(item.prenom);
        if (prenom && otherPrenom && prenom === otherPrenom) return item;
        const otherDob = normalizePerson(item.dob);
        if (dob && otherDob && dob === otherDob) return item;
    }
    return null;
}

/** Champ vide : absent, `null`, chaîne vide (espaces compris) ou tableau vide. */
function isEmptyField(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/**
 * Fusionne `incoming` dans `existing` : chaque champ VIDE d'`existing` (absent,
 * `''`, tableau vide) est complété par `incoming` ; aucun champ rempli n'est
 * écrasé. `id` et `updatedAt` d'`existing` sont gardés. `filled` liste les clés
 * complétées. Ne mute aucun des deux objets.
 */
export function mergeFicheFields(
    existing: PctacCollectionItem,
    incoming: PctacCollectionItem,
): { merged: PctacCollectionItem; filled: string[] } {
    const merged: PctacCollectionItem = { ...existing };
    const filled: string[] = [];
    for (const key of Object.keys(incoming)) {
        if (key === 'id' || key === 'updatedAt') continue;
        const value = incoming[key];
        if (isEmptyField(value)) continue;
        if (isEmptyField(merged[key])) {
            merged[key] = value;
            filled.push(key);
        }
    }
    return { merged, filled };
}
