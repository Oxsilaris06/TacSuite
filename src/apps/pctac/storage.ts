/**
 * storage.ts — Gestion du stockage LocalStorage pour PC-Tac
 * ============================================================
 *
 * Port TypeScript de `modules/pctac/storage.js` (GStart-main, 117 LOC).
 * Cf. docs/SPEC-PCTAC-CONVERSION.md §1.1 et §9 (pièges).
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
import { Persist } from '@shared/persist.js';

// Validateurs simples pour Persist
// (storage.js:16-17)
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const Storage: PctacStorageContract = {
  /**
   * Sauvegarde les données du journal.
   * PIÈGE : trie le tableau EN PLACE (mutation), puis persiste via Persist.
   * (storage.js:24-31)
   */
  saveLogData(logData: PctacLogEntry[]): void {
    // Tri par heure avant de sauvegarder (mutation en place)
    logData.sort((a, b) => {
      if (a.heure === b.heure) return 0;
      return a.heure < b.heure ? -1 : 1;
    });
    // Persist ne jette jamais sur quota : il émet 'pctac:quota' (non bloquant).
    Persist.set(LOCAL_STORAGE_KEY, logData);
  },

  /**
   * Charge les données du journal.
   * (storage.js:37-39)
   */
  loadLogData(): PctacLogEntry[] {
    return Persist.get(LOCAL_STORAGE_KEY, { validator: isArray, fallback: [] });
  },

  /**
   * Récupère les associations TP (Pax Libre).
   * PIÈGE : la map est indexée par COULEUR, pas par libellé.
   * (storage.js:45-47)
   */
  getTpAssociations(): Record<string, string> {
    return Persist.get(TP_ASSOC_KEY, { validator: isObject, fallback: {} });
  },

  /**
   * Sauvegarde une association TP.
   * PIÈGE : écrit assoc[color] = label (indexé par couleur).
   * (storage.js:54-58)
   */
  saveTpAssociation(label: string, color: string): void {
    const assoc = this.getTpAssociations();
    assoc[color] = label; // Clé = couleur, pas label
    Persist.set(TP_ASSOC_KEY, assoc);
  },

  /**
   * Sauvegarde une collection générique.
   * (storage.js:62-68)
   */
  saveCollection(key: string, data: readonly PctacCollectionItem[]): void {
    // Quota géré par Persist via l'évènement 'pctac:quota'.
    Persist.set(key, data);
  },

  /**
   * Charge une collection générique.
   * (storage.js:71-77)
   */
  loadCollection(key: string): PctacCollectionItem[] {
    return Persist.get(key, { validator: isArray, fallback: [] });
  },

  /**
   * Réinitialise toutes les données.
   * Supprime exactement 14 clés (liste de storage.js:84-109).
   */
  clearAllData(): void {
    const keys = [
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
      'pcTacLieuHistory',
      'lastView',
      'lastPhotoFilter',
      // Sans ces deux clés, le verrou du plan et l'état du board relationnel
      // survivaient à la réinitialisation complète. (storage.js:98-99)
      'pcTacPlanLocked',
      'pcTacDashboard',
    ];
    keys.forEach((k) => {
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
