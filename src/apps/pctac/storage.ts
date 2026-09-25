/**
 * storage.ts — Gestion du stockage LocalStorage pour PC-Tac
 * ============================================================
 *
 * Port TypeScript de `modules/pctac/storage.js` (GStart-main, 117 LOC).
 *
 * Toutes les lectures/écritures localStorage transitent par la couche `Persist`
 * (persist.ts) :
 *  - écriture : ne jette JAMAIS sur dépassement de quota ; un évènement window
 *    'pctac:quota' (non bloquant) est émis par Persist.
 *  - lecture : si le JSON est corrompu ou rejeté par le validateur, la chaîne
 *    brute est sauvegardée dans `<key>.bak` et un fallback sûr ([] ou {})
 *    est retourné — aucune donnée opérationnelle perdue en silence.
 */

import type { PctacStorageContract, PctacLogEntry, PctacCollectionItem } from '@shared/types/contracts.js';
import {
  LOCAL_STORAGE_KEY,
  TP_ASSOC_KEY,
  ADVERSARIES_KEY,
  HOSTAGES_KEY,
  FRIENDS_KEY,
  PHOTOS_KEY,
  CUSTOM_PAX_KEY,
  FICHE_DRAFT_KEY,
} from '@pctac/config.js';
import { currentModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';
import { GPX_INDEX_KEY, PINS_KEY, SHAPES_KEY } from '@pctac/planmap/constants.js';
import { Persist } from '@shared/persist.js';

/**
 * Clés opérationnelles effacées par une réinitialisation. Elles appartiennent
 * TOUTES à une situation (cf. `scopedKey`) : on ne supprime donc jamais que
 * celles de la situation visée, jamais celles des trois autres.
 */
/**
 * Ordre de la main courante : (date, heure). Les entrées legacy sans date
 * passent AVANT toute entrée datée, dans un ordre stable entre elles (heure
 * ASC). Partagé avec la fusion d'archive (A4) : toute écriture du journal
 * doit le respecter, l'écran et le PDF ne trient pas.
 */
export function compareLogEntries(a: { date?: string | undefined; heure?: string | undefined }, b: { date?: string | undefined; heure?: string | undefined }): number {
  const da = a.date ?? '';
  const db = b.date ?? '';
  if (da !== db) return da < db ? -1 : 1;
  const ha = a.heure ?? '';
  const hb = b.heure ?? '';
  if (ha === hb) return 0;
  return ha < hb ? -1 : 1;
}

export const SITUATION_KEYS: readonly string[] = [
  LOCAL_STORAGE_KEY,
  TP_ASSOC_KEY,
  ADVERSARIES_KEY,
  HOSTAGES_KEY,
  FRIENDS_KEY,
  PHOTOS_KEY,
  CUSTOM_PAX_KEY,
  'pcTacPlanPins',
  'pcTacPlanView',
  'pcTacPlanShapes',
  'pcTacPlanGrid',
  'pcTacLieuHistory',
  'pcTacPlanLocked',
  'pcTacDashboard',
];

/**
 * État de remplissage d'une situation (décision 28). Sert à ne POSER la
 * question « Changer de situation ? » que lorsqu'il y a quelque chose à
 * perdre de vue : une situation vide se quitte sans confirmation.
 */
export interface SituationDataCounts {
  /** Fiches : adversaires (ou équivalents) + otages + amis. */
  fiches: number;
  /** Entrées de la main courante. */
  journal: number;
  /** Photos de la galerie. */
  photos: number;
  /** Vrai dès qu'un point ou un dessin existe sur le plan. */
  plan: boolean;
}

/** Vrai si `counts` décrit une situation non vide. */
export function hasSituationData(counts: SituationDataCounts): boolean {
  return counts.fiches > 0 || counts.journal > 0 || counts.photos > 0 || counts.plan;
}

/**
 * Compte ce que porte une situation (celle passée en argument, courante par
 * défaut). Lecture best-effort : un stockage illisible compte pour vide.
 */
export function situationData(modeId: PctacModeId = currentModeId()): SituationDataCounts {
  const list = (key: string): number =>
    Persist.get<unknown[]>(scopedKey(key, modeId), { validator: isArray, fallback: [] }).length;
  const nonEmpty = (key: string): boolean =>
    Persist.get<unknown[]>(scopedKey(key, modeId), { validator: isArray, fallback: [] }).length > 0;
  return {
    fiches: list(ADVERSARIES_KEY) + list(HOSTAGES_KEY) + list(FRIENDS_KEY),
    journal: list(LOCAL_STORAGE_KEY),
    photos: list(PHOTOS_KEY),
    plan: nonEmpty(PINS_KEY) || nonEmpty(SHAPES_KEY),
  };
}

/**
 * Décrit en français ce que contient une situation, pour la confirmation de
 * changement. Rend une chaîne vide si la situation est vide.
 */
export function describeSituationData(counts: SituationDataCounts): string {
  const parts: string[] = [];
  if (counts.fiches > 0) parts.push(`${counts.fiches} fiche${counts.fiches > 1 ? 's' : ''}`);
  if (counts.journal > 0) parts.push(`${counts.journal} entrée${counts.journal > 1 ? 's' : ''} de main courante`);
  if (counts.photos > 0) parts.push(`${counts.photos} photo${counts.photos > 1 ? 's' : ''}`);
  if (counts.plan) parts.push('un plan');
  return parts.join(', ');
}

/**
 * Efface les données opérationnelles d'UNE situation (celle passée en
 * argument). Utilisé par le reset (situation courante) et par le rollback
 * d'import (situation cible, qui peut différer de celle affichée).
 */
export function clearSituationData(modeId: PctacModeId): void {
  SITUATION_KEYS.forEach((k) => {
    try {
      localStorage.removeItem(scopedKey(k, modeId));
    } catch {
      // localStorage indisponible : on dégrade proprement (offline-first).
    }
  });
}

// Validateurs simples pour Persist
// (storage.js:16-17)
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Évènement `pctac:data` — annonce qu'une zone de données vient d'être écrite.
 *
 * Existe pour l'écran scindé : deux vues affichées côte à côte doivent rester
 * à jour l'une comme l'autre, alors que le rendu de PC-Tac est déclenché par
 * l'action de l'utilisateur, donc seulement dans la vue où il travaille.
 * Plutôt que d'appeler le rafraîchissement depuis chaque point d'écriture (et
 * d'en oublier un), on annonce l'écriture ici, au SEUL endroit par lequel
 * toutes passent, et l'écran scindé décide de ce qu'il repeint.
 *
 * Volontairement silencieux hors navigateur (tests Node) et jamais bloquant :
 * une écriture de données ne doit pas échouer parce qu'un écouteur a levé.
 */
function announceChange(key: string): void {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
  try {
    document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key } }));
  } catch {
    // Un écouteur en échec ne doit jamais remonter jusqu'à l'appelant.
  }
}

/* -------------------------------------------------------------------------
 * Date de modification (décision 32)
 *
 * `updatedAt` arbitre la fusion à l'import : la fiche la plus récente gagne.
 * On ne redate QUE ce qui a réellement changé, en comparant la valeur stockée
 * sous le même `id` à la valeur entrante, `updatedAt` exclu. Un élément
 * inchangé garde la date déjà stockée — même si l'appelant, qui garde une
 * référence ancienne, le repasse sans ce champ.
 * ------------------------------------------------------------------------- */

/** Sérialisation stable d'une valeur, `updatedAt` (récursivement) exclu. */
function stableWithoutUpdatedAt(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableWithoutUpdatedAt).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => k !== 'updatedAt' && obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableWithoutUpdatedAt(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

interface StampedItem {
  id: string;
  updatedAt?: string | undefined;
}

/**
 * Pose `updatedAt` sur les éléments nouveaux ou modifiés, EN PLACE sur chaque
 * élément (jamais sur le tableau : ni tri, ni ajout/retrait). La mutation des
 * éléments est voulue : les appelants gardent des références vers ces objets et
 * comparent ce qu'ils relisent (ex. `fiche-sheet.ts` détecte un stockage plein
 * en comparant la fiche relue à la sienne) — les garder synchronisés évite de
 * fausses alertes de quota. Un élément inchangé reçoit la date DÉJÀ stockée.
 */
function stampUpdatedAt<T extends StampedItem>(items: readonly T[], stored: readonly T[]): void {
  const byId = new Map<string, T>();
  stored.forEach((it) => {
    if (it && typeof it.id === 'string') byId.set(it.id, it);
  });
  const now = new Date().toISOString();
  items.forEach((item) => {
    const previous = byId.get(item.id);
    if (previous && stableWithoutUpdatedAt(item) === stableWithoutUpdatedAt(previous)) {
      if (previous.updatedAt !== undefined) item.updatedAt = previous.updatedAt;
      else delete item.updatedAt;
      return;
    }
    item.updatedAt = now;
  });
}

export const Storage: PctacStorageContract = {
  /**
   * Sauvegarde les données du journal.
   * PIÈGE : trie le tableau EN PLACE (mutation), puis persiste via Persist.
   * (storage.js:24-31)
   */
  saveLogData(logData: PctacLogEntry[]): boolean {
    // U15 — tri par (date, heure) avant de sauvegarder (mutation en place).
    // Les entrées legacy sans date (date ?? '') passent AVANT toute entrée
    // datée, dans un ordre stable entre elles (heure ASC comme avant).
    logData.sort(compareLogEntries);
    const stored = Persist.get<PctacLogEntry[]>(scopedKey(LOCAL_STORAGE_KEY), { validator: isArray, fallback: [] });
    stampUpdatedAt(logData, stored);
    // Persist ne jette jamais sur quota : il émet 'pctac:quota' (non bloquant).
    const result = Persist.set(scopedKey(LOCAL_STORAGE_KEY), logData);
    announceChange(LOCAL_STORAGE_KEY);
    return result.ok;
  },

  /**
   * Charge les données du journal.
   * (storage.js:37-39)
   */
  loadLogData(): PctacLogEntry[] {
    return Persist.get(scopedKey(LOCAL_STORAGE_KEY), { validator: isArray, fallback: [] });
  },

  /**
   * Récupère les associations TP (Pax Libre).
   * PIÈGE : la map est indexée par COULEUR, pas par libellé.
   * (storage.js:45-47)
   */
  getTpAssociations(): Record<string, string> {
    return Persist.get(scopedKey(TP_ASSOC_KEY), { validator: isObject, fallback: {} });
  },

  /**
   * Sauvegarde une association TP.
   * PIÈGE : écrit assoc[color] = label (indexé par couleur).
   * (storage.js:54-58)
   */
  saveTpAssociation(label: string, color: string): void {
    const assoc = this.getTpAssociations();
    assoc[color] = label; // Clé = couleur, pas label
    Persist.set(scopedKey(TP_ASSOC_KEY), assoc);
  },

  /**
   * Sauvegarde une collection générique.
   * (storage.js:62-68)
   */
  saveCollection(key: string, data: readonly PctacCollectionItem[], modeId: PctacModeId = currentModeId()): boolean {
    const stored = Persist.get<PctacCollectionItem[]>(scopedKey(key, modeId), { validator: isArray, fallback: [] });
    // `data` est en lecture seule : on ne touche jamais au tableau (ni tri, ni
    // copie). Les éléments, eux, reçoivent leur date de modification.
    stampUpdatedAt(data, stored);
    // Quota géré par Persist via l'évènement 'pctac:quota'.
    const result = Persist.set(scopedKey(key, modeId), data);
    announceChange(key);
    return result.ok;
  },

  /**
   * Charge une collection générique.
   * (storage.js:71-77)
   *
   * `modeId` (optionnel) permet de lire une AUTRE situation que celle
   * affichée : l'import d'archive vise la situation qu'il déclare (décision 2),
   * et la fusion de doublons doit lire/écrire cette CIBLE, pas l'écran.
   */
  loadCollection(key: string, modeId: PctacModeId = currentModeId()): PctacCollectionItem[] {
    return Persist.get(scopedKey(key, modeId), { validator: isArray, fallback: [] });
  },

  /**
   * Réinitialise les données de la situation COURANTE (et d'elle seule) : les
   * trois autres situations gardent intactes leurs fiches, leur journal, leur
   * plan et leurs photos. `lastView`/`lastPhotoFilter` sont des préférences de
   * poste communes : elles sont reposées à leur valeur par défaut.
   *
   * L'index GPX de la situation est retiré ICI et non dans `clearSituationData`
   * (que l'import utilise) : une réinitialisation efface les traces de la
   * situation visée, alors qu'un import doit les conserver (décision de fusion).
   * Même règle pour les brouillons de fiche : un import (même raté, donc
   * annulé) ne doit pas emporter une saisie non enregistrée.
   */
  clearAllData(): void {
    clearSituationData(currentModeId());
    try {
      localStorage.removeItem(scopedKey(GPX_INDEX_KEY));
      localStorage.removeItem(scopedKey(FICHE_DRAFT_KEY));
    } catch {
      // localStorage indisponible : on dégrade proprement (offline-first).
    }
    // Préférences de vue : communes, remises à zéro avec le reset demandé.
    ['lastView', 'lastPhotoFilter'].forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        // localStorage indisponible : on dégrade proprement (offline-first).
      }
    });
  },
};

// Exposition globale pour compatibilité (storage.js:114-117)
// ATTENTION : au scope MODULE, pas dans main.ts (cf. SPEC-PCTAC-CONVERSION.md §4)
window.saveLogData = Storage.saveLogData.bind(Storage);
window.loadLogData = Storage.loadLogData.bind(Storage);
window.getTpAssociations = Storage.getTpAssociations.bind(Storage);
window.saveTpAssociation = Storage.saveTpAssociation.bind(Storage);
