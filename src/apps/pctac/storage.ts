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
} from '@pctac/config.js';
import { currentModeId, scopedKey, type PctacModeId } from '@pctac/modes.js';
import { GPX_INDEX_KEY } from '@pctac/planmap/constants.js';
import { Persist } from '@shared/persist.js';

/**
 * Clés opérationnelles effacées par une réinitialisation. Elles appartiennent
 * TOUTES à une situation (cf. `scopedKey`) : on ne supprime donc jamais que
 * celles de la situation visée, jamais celles des trois autres.
 */
const SITUATION_KEYS: readonly string[] = [
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

export const Storage: PctacStorageContract = {
  /**
   * Sauvegarde les données du journal.
   * PIÈGE : trie le tableau EN PLACE (mutation), puis persiste via Persist.
   * (storage.js:24-31)
   */
  saveLogData(logData: PctacLogEntry[]): void {
    // U15 — tri par (date, heure) avant de sauvegarder (mutation en place).
    // Les entrées legacy sans date (date ?? '') passent AVANT toute entrée
    // datée, dans un ordre stable entre elles (heure ASC comme avant).
    logData.sort((a, b) => {
      const da = a.date ?? '';
      const db = b.date ?? '';
      if (da !== db) return da < db ? -1 : 1;
      if (a.heure === b.heure) return 0;
      return a.heure < b.heure ? -1 : 1;
    });
    // Persist ne jette jamais sur quota : il émet 'pctac:quota' (non bloquant).
    Persist.set(scopedKey(LOCAL_STORAGE_KEY), logData);
    announceChange(LOCAL_STORAGE_KEY);
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
  saveCollection(key: string, data: readonly PctacCollectionItem[]): void {
    // Quota géré par Persist via l'évènement 'pctac:quota'.
    Persist.set(scopedKey(key), data);
    announceChange(key);
  },

  /**
   * Charge une collection générique.
   * (storage.js:71-77)
   */
  loadCollection(key: string): PctacCollectionItem[] {
    return Persist.get(scopedKey(key), { validator: isArray, fallback: [] });
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
   */
  clearAllData(): void {
    clearSituationData(currentModeId());
    try {
      localStorage.removeItem(scopedKey(GPX_INDEX_KEY));
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
