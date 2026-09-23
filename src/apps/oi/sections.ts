/**
 * sections.ts — Sections de l'OI : retrait (×), titres personnalisés (crayon),
 * par mode (complète / express). Décisions Nico 2026-09-24 (DevSYNCState §3,
 * n° 10 à 12).
 *
 * Ce module est PUR (aucun DOM) : il décrit les sections et calcule, à partir
 * de `formData`, ce qui est retiré et comment chaque section s'intitule. Le
 * formulaire (`sections-ui.ts`) et le PDF (`pdf/document-builder.ts`) lisent la
 * MÊME source, pour qu'une section retirée à l'écran ne réapparaisse jamais
 * dans le PDF, et qu'un titre renommé soit le même aux deux endroits.
 *
 * Une section retirée n'est PAS effacée : son contenu reste dans `formData`
 * (« Rétablir » le rend intact). Seul le PDF l'ignore, via
 * `applySectionRemovals`, qui en masque les données dans une COPIE.
 */
import type { OiFormData, OiMode, OiSectionPrefs } from '@shared/types/contracts.js';

export interface OiSectionDef {
    id: string;
    /** Libellé par défaut dans le formulaire (sans numéro d'étape). */
    label: string;
    /** Libellé par défaut dans le PDF, tel que le PDF l'écrivait avant ce lot. */
    pdf: string;
    /** `false` : socle de l'ordre (Situation, Mission, Exécution, PATRACDVR…), jamais retirable. */
    removable: boolean;
    /** Index de l'étape du formulaire (0-based) si la section EST une étape. */
    step?: number;
    /** Section mère si la section est une sous-partie d'une étape. */
    parent?: string;
}

export const OI_SECTIONS: readonly OiSectionDef[] = [
    { id: 'situation', label: 'Situation', pdf: 'SITUATION GLOBALE', removable: false, step: 0 },
    { id: 'adversaires', label: 'Adversaire(s)', pdf: 'CIBLES(S)', removable: true, step: 1 },
    { id: 'environnement', label: 'Environnement', pdf: 'ENVIRONNEMENT ET AMIS', removable: true, step: 2 },
    { id: 'mission', label: "Mission de l'unité", pdf: "MISSION DE L'UNITÉ", removable: false, step: 3 },
    { id: 'execution', label: 'Exécution', pdf: 'EXÉCUTION', removable: false, step: 4 },
    { id: 'chronologie', label: 'Chronologie', pdf: 'Chronologie Prévisionnelle', removable: true, parent: 'execution' },
    { id: 'hypotheses', label: 'Hypothèses', pdf: "Hypothèses d'ensemble", removable: true, parent: 'execution' },
    { id: 'cheminement', label: 'Cheminement', pdf: 'TRANSPORT', removable: true, parent: 'execution' },
    { id: 'articulation', label: 'Articulation (MOIPC/ZMSPCP)', pdf: 'ARTICULATION & ORDRES DE MOUVEMENT', removable: true, step: 5 },
    { id: 'rame', label: 'Ordre de la rame VL', pdf: 'Ordre Rame VL', removable: true, parent: 'articulation' },
    { id: 'colonne', label: 'Ordre de la colonne de progression', pdf: 'Colonne Progression', removable: true, parent: 'articulation' },
    { id: 'penetration', label: 'Ordre de pénétration', pdf: 'Ordre de Pénétration', removable: true, parent: 'articulation' },
    { id: 'moicp', label: "MOICP — Équipes d'Intervention", pdf: 'MOICP', removable: true, parent: 'articulation' },
    { id: 'zmspcp', label: 'ZMSPCP — Appui / Observation', pdf: 'ZMSPCP', removable: true, parent: 'articulation' },
    { id: 'effraction', label: 'Cellule Effraction', pdf: 'EFFRACTION', removable: true, parent: 'articulation' },
    { id: 'patracdvr', label: 'PATRACDVR', pdf: 'RÉCAPITULATIF PATRACDVR', removable: false, step: 6 },
    { id: 'finalisation', label: 'Finalisation & Conduites à tenir', pdf: 'CONDUITES À TENIR GÉNÉRALES', removable: false, step: 7 },
    { id: 'cat_generales', label: 'Conduites à tenir (CAT) Générales', pdf: 'CAT Générales', removable: true, parent: 'finalisation' },
    { id: 'no_go', label: 'NO GO', pdf: 'Conditions de Désengagement (NO-GO)', removable: true, parent: 'finalisation' },
    { id: 'uda', label: 'UDA', pdf: 'UDA', removable: true, parent: 'finalisation' },
    { id: 'liaison', label: 'Liaison', pdf: 'Liaison', removable: true, parent: 'finalisation' },
];

const BY_ID = new Map(OI_SECTIONS.map((s) => [s.id, s]));

/** Longueur maximale d'un titre personnalisé : au-delà, le PDF le replie sur plusieurs lignes, rien n'est coupé. */
export const OI_SECTION_TITLE_MAX = 80;

/** Clé du modèle d'unité : titres gardés « pour mes prochaines OI », par mode. Hors de l'OI : survit à un reset. */
export const OI_UNIT_TITLES_KEY = 'oiUnitSectionTitles';

export function sectionDef(id: string): OiSectionDef | undefined {
    return BY_ID.get(id);
}

export function currentOiMode(fd: OiFormData | null | undefined): OiMode {
    return fd?.oi_mode === 'express' ? 'express' : 'complete';
}

function emptyPrefs(): OiSectionPrefs {
    return { removed: [], titles: {} };
}

/** Préférences du mode demandé (courant par défaut), toujours bien formées même sur une OI ancienne ou corrompue. */
export function sectionPrefs(fd: OiFormData | null | undefined, mode: OiMode = currentOiMode(fd)): OiSectionPrefs {
    const raw = fd?.oi_sections?.[mode];
    if (!raw || typeof raw !== 'object') return emptyPrefs();
    const removed = Array.isArray(raw.removed) ? raw.removed.filter((id) => typeof id === 'string' && BY_ID.get(id)?.removable) : [];
    const titles: Record<string, string> = {};
    if (raw.titles && typeof raw.titles === 'object') {
        for (const [id, t] of Object.entries(raw.titles)) {
            if (BY_ID.has(id) && typeof t === 'string' && t.trim()) titles[id] = t.trim().slice(0, OI_SECTION_TITLE_MAX);
        }
    }
    return { removed, titles };
}

/**
 * Retirée si elle-même OU sa section mère l'est (retirer « Articulation » retire
 * ses ordres et ses blocs). Une section non retirable ne l'est jamais.
 */
export function isSectionRemoved(fd: OiFormData | null | undefined, id: string, mode?: OiMode): boolean {
    const def = BY_ID.get(id);
    if (!def) return false;
    const { removed } = sectionPrefs(fd, mode);
    if (def.removable && removed.includes(id)) return true;
    return def.parent !== undefined && isSectionRemoved(fd, def.parent, mode);
}

/** Modèle d'unité lu depuis le stockage local ; jamais d'exception (stockage bloqué, JSON corrompu). */
export function readUnitTitles(mode: OiMode): Record<string, string> {
    try {
        const all = JSON.parse(localStorage.getItem(OI_UNIT_TITLES_KEY) || '{}') as Partial<Record<OiMode, Record<string, string>>>;
        const titles = all?.[mode];
        if (!titles || typeof titles !== 'object') return {};
        return Object.fromEntries(
            Object.entries(titles).filter(([id, t]) => BY_ID.has(id) && typeof t === 'string' && t.trim()),
        );
    } catch {
        return {};
    }
}

/** Enregistre les titres du mode comme modèle d'unité. `false` si le stockage refuse (quota, navigation privée). */
export function writeUnitTitles(mode: OiMode, titles: Record<string, string>): boolean {
    try {
        const all = JSON.parse(localStorage.getItem(OI_UNIT_TITLES_KEY) || '{}') as Record<string, unknown>;
        all[mode] = titles;
        localStorage.setItem(OI_UNIT_TITLES_KEY, JSON.stringify(all));
        return true;
    } catch {
        return false;
    }
}

/**
 * Titre personnalisé de l'OI, ou `undefined` (titre d'origine). Le modèle
 * d'unité n'est PAS un repli d'affichage : il est recopié dans l'OI à sa
 * première ouverture dans un mode (`seedFromUnitTemplate`), pour qu'un titre
 * vidé revienne bien au titre d'origine, et que l'archive porte ses titres
 * (le poste qui la reçoit n'a pas le modèle de l'émetteur).
 */
export function customTitle(fd: OiFormData | null | undefined, id: string, mode: OiMode = currentOiMode(fd)): string | undefined {
    return sectionPrefs(fd, mode).titles[id];
}

/**
 * Réglages initiaux d'un mode tirés du modèle d'unité, pour une OI qui n'a
 * encore AUCUN réglage dans ce mode ; `null` sinon (une OI déjà réglée garde
 * les siens) ou si le modèle est vide.
 */
export function seedFromUnitTemplate(fd: OiFormData | null | undefined, mode: OiMode): OiSectionPrefs | null {
    if (fd?.oi_sections?.[mode]) return null;
    const titles = readUnitTitles(mode);
    return Object.keys(titles).length ? { removed: [], titles } : null;
}

/** Libellé affiché dans le formulaire. */
export function formSectionTitle(fd: OiFormData | null | undefined, id: string): string {
    return customTitle(fd, id) ?? BY_ID.get(id)?.label ?? id;
}

/**
 * Libellé écrit dans le PDF. Un titre personnalisé suit la casse du titre
 * d'origine : en capitales là où le PDF écrit en capitales (titres de page),
 * tel que saisi ailleurs (titres de carte).
 */
export function pdfSectionTitle(fd: OiFormData | null | undefined, id: string, fallback?: string): string {
    const def = BY_ID.get(id);
    const base = fallback ?? def?.pdf ?? id;
    const custom = customTitle(fd, id);
    if (!custom) return base;
    return base === base.toUpperCase() ? custom.toLocaleUpperCase('fr-FR') : custom;
}

/** Nouvel état de sections avec les préférences du mode remplacées (immutabilité : le `Store` détecte l'affectation). */
export function withSectionPrefs(fd: OiFormData, prefs: OiSectionPrefs, mode: OiMode = currentOiMode(fd)): NonNullable<OiFormData['oi_sections']> {
    return { ...(fd.oi_sections ?? {}), [mode]: prefs };
}

const TRANSPORT_PHOTO_CONTAINERS = ['photo_container_transport_pr_preview_container', 'photo_container_transport_domicile_preview_container'];

/**
 * COPIE de `formData` où les données des sections retirées sont masquées, pour
 * le PDF. Les constructeurs du PDF omettent déjà une section vide : masquer les
 * données suffit à la faire disparaître, sans toucher à leurs calculs de place.
 * Les cartes qui s'afficheraient vides (« - ») sont, elles, écartées par le
 * constructeur via `isSectionRemoved`.
 */
export function applySectionRemovals(fd: OiFormData): OiFormData {
    const gone = (id: string): boolean => isSectionRemoved(fd, id);
    const out: OiFormData = { ...fd };
    if (gone('adversaires')) out.adversaries = [];
    if (gone('chronologie')) out.time_events = [];
    if (gone('hypotheses')) out.hypotheses = [];
    if (gone('cheminement') && fd.dynamic_photos) {
        out.dynamic_photos = Object.fromEntries(
            Object.entries(fd.dynamic_photos).filter(([k]) => !TRANSPORT_PHOTO_CONTAINERS.includes(k)),
        );
    }
    if (gone('rame')) out.rame_vl_order = [];
    if (gone('colonne')) out.colonne_progression_order = [];
    if (gone('penetration')) out.ordre_penetration_order = [];
    if (gone('moicp')) out.moicp_blocks = [];
    if (gone('zmspcp')) out.zmspcp_blocks = [];
    if (gone('effraction')) out.effraction_blocks = [];
    if (gone('cat_generales')) out.cat_generales = '';
    if (gone('no_go')) out.no_go = '';
    if (gone('uda')) out.uda = '';
    if (gone('liaison')) out.cat_liaison = '';
    return out;
}

// ─── Mode express (décision Nico 2026-09-24, DevSYNCState §3 n° 12) ─────────

/** Étapes (0-based) de l'OI express : Situation, Mission, Exécution, PATRACDVR. */
export const OI_EXPRESS_STEPS: readonly number[] = [0, 3, 4, 6];

/** Emplacements photo propres à l'express (étape Situation), dans l'ordre du PDF. */
export const OI_EXPRESS_PHOTO_CONTAINERS = [
    { id: 'photo_container_express_objectif_preview_container', label: 'Objectif' },
    { id: 'photo_container_express_adversaire_preview_container', label: 'Adversaire' },
    { id: 'photo_container_express_carte_preview_container', label: 'Carte' },
] as const;

/** Une étape est visible en complète, ou si elle fait partie du socle express. */
export function isStepVisible(fd: OiFormData | null | undefined, index: number): boolean {
    return currentOiMode(fd) === 'complete' || OI_EXPRESS_STEPS.includes(index);
}

/**
 * Étape visible la plus proche dans le sens `dir` (+1 suivant, −1 précédent)
 * à partir de `from` inclus ; `null` s'il n'y en a pas dans ce sens.
 */
export function nearestVisibleStep(fd: OiFormData | null | undefined, from: number, dir: 1 | -1, count: number): number | null {
    for (let i = from; i >= 0 && i < count; i += dir) {
        if (isStepVisible(fd, i)) return i;
    }
    return null;
}
