/**
 * log-manager.ts — Gestionnaire de la logique métier des logs
 * (Port de modules/pctac/logManager.js:139 LOC)
 *
 * Contrat : LogManagerContract (src/shared/types/contracts.ts:450-462)
 * Imports obligatoires (alias + .js) : @pctac/storage.js, @shared/persist.js, @shared/feedback.js, @pctac/config.js
 *
 * Pièges critiques (logManager.js:107-112) :
 *   - importJson : paxMode recalculé D'ABORD (ligne 111), puis sert au repli couleur (ligne 117)
 *   - Ordre = correctif volontaire : historique des imports avait perdu les couleurs
 * - Déduplication des entrées importées par id (logManager.js:123-126)
 * - Historique des lieux : LRU max 30, insensible à la casse (logManager.js:64-73)
 * - addEntry : toast d'erreur (R2-T2a, ex-alert()) + retour null en cas de refus (logManager.js:23-40)
 * - window.LogManager = LogManager (logManager.js:139)
 */

import type {
  PctacLogEntry,
  PctacLogEntryInput,
  PctacLegacyLogJson,
  PctacImportJsonResult,
  LogManagerContract,
  PctacPaxMode,
} from '@shared/types/contracts.js';
import { Storage } from '@pctac/storage.js';
import { Persist } from '@shared/persist.js';
import { toast } from '@shared/feedback.js';
import { FREE_MODE_COLORS, PDF_PAX_COLORS } from '@pctac/config.js';

/**
 * Gestionnaire du journal (main courante) : création, import/export, historique des lieux.
 * logManager.js:9-134
 */
export const LogManager: LogManagerContract = {
  /**
   * Ajoute une nouvelle entrée au journal.
   * logManager.js:15-59
   *
   * @param data Données du formulaire
   * @returns La nouvelle entrée créée, ou null si PAX/heure invalide
   *
   * Comportement : valide mode+pax+heure, sinon toast d'erreur (R2-T2a, ex-alert()) + retour null.
   */
  addEntry(data: PctacLogEntryInput): PctacLogEntry | null {
    const { mode, pax, freePax, paxColor, heure, lieu, remarques, auto } = data;

    let paxName: string;
    let paxColorHex: string | undefined;

    if (mode === 'standard') {
      paxName = pax;
      paxColorHex = '';
      if (!paxName) {
        toast('Veuillez sélectionner un type de PAX.', { kind: 'error' });
        return null;
      }
    } else {
      // mode === 'free'
      // logManager.js:29 — repli : pax || freePax.trim() || 'Pax Libre'
      paxName = pax || (freePax || '').trim() || 'Pax Libre';
      paxColorHex = paxColor;
      if (!paxName) {
        toast('Veuillez donner un nom à l\'intervenant.', { kind: 'error' });
        return null;
      }
    }

    if (!heure) {
      toast('Veuillez renseigner l\'heure.', { kind: 'error' });
      return null;
    }

    // logManager.js:42-50 — construction de l'entrée
    const newEntry: PctacLogEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      // U15 — date d'opération auto (jour de saisie, local, ISO YYYY-MM-DD).
      date: new Date().toLocaleDateString('sv-SE'),
      heure: heure,
      pax: paxName,
      paxMode: mode,
      paxColor: paxColorHex,
      lieu: (lieu || '').trim(),
      remarques: (remarques || '').trim(),
      ...(auto ? { auto: true } : {}),
    };

    // logManager.js:52-54 — persistance
    const logData = Storage.loadLogData();
    logData.push(newEntry);
    Storage.saveLogData(logData);

    // logManager.js:56 — ajout à l'historique des lieux
    if (newEntry.lieu) this.addLieuToHistory(newEntry.lieu);

    return newEntry;
  },

  /**
   * Mémorise une localisation dans l'historique de suggestions (LRU, max 30).
   * logManager.js:64-74
   *
   * Comparaison de doublons : INSENSIBLE À LA CASSE.
   * Via Persist (contrat projet) : jamais d'exception sur quota plein.
   */
  addLieuToHistory(lieu: string): void {
    const trimmed = (lieu || '').trim();
    if (!trimmed) return;

    // logManager.js:69 — Persist.get, fallback []
    const raw = Persist.get('pcTacLieuHistory', { validator: Array.isArray, fallback: [] }) || [];
    // Explicitement typé comme string[] : l'historique des lieux est un tableau de chaînes
    let hist: string[] = Array.isArray(raw) ? raw.map((l) => String(l)) : [];

    // logManager.js:70 — filtre insensible à la casse, puis insère à l'index 0 (LRU)
    hist = hist.filter((l) => l.toLowerCase() !== trimmed.toLowerCase());
    hist.unshift(trimmed);

    // logManager.js:72 — borne à 30
    if (hist.length > 30) hist = hist.slice(0, 30);

    // logManager.js:73 — persiste (tolère quota plein)
    Persist.set('pcTacLieuHistory', hist);
  },

  /**
   * Récupère l'historique des lieux.
   * logManager.js:76-78
   */
  getLieuHistory(): string[] {
    return Persist.get('pcTacLieuHistory', { validator: Array.isArray, fallback: [] }) || [];
  },

  /**
   * Supprime une entrée par son ID.
   * logManager.js:83-87
   */
  deleteEntry(id: string): PctacLogEntry[] {
    const logData = Storage.loadLogData().filter((entry) => entry.id !== id);
    Storage.saveLogData(logData);
    return logData;
  },

  /**
   * Met à jour une entrée existante.
   * logManager.js:92-100
   *
   * @returns le journal APRÈS mise à jour (inchangé si id introuvable)
   */
  updateEntry(id: string, updatedData: Partial<PctacLogEntry>): PctacLogEntry[] {
    const logData = Storage.loadLogData();
    const index = logData.findIndex((e) => e.id === id);
    if (index !== -1) {
      const entry = logData[index];
      if (entry) {
        logData[index] = { ...entry, ...updatedData };
        Storage.saveLogData(logData);
      }
    }
    return logData;
  },

  /**
   * Valide et importe des données JSON.
   * logManager.js:105-133
   *
   * PIÈGE CRITIQUE (logManager.js:107-112) : paxMode recalculé D'ABORD
   * (ligne 111 : `const paxMode = entry.paxMode || (PDF_PAX_COLORS[entry.pax] ? 'standard' : 'free')`)
   * puis utilisé pour le fallback couleur (ligne 117).
   * Cet ordre est un correctif volontaire : sans lui, les importations legacy
   * perdaient les couleurs attribuées aux PAX libres.
   *
   * Déduplication (logManager.js:125-126) : seules les nouveaux id sont ajoutées.
   */
  importJson(jsonContent: PctacLegacyLogJson): PctacImportJsonResult {
    // logManager.js:106 — validation du format
    if (
      jsonContent.metadata &&
      jsonContent.metadata.appName === 'PC Tac Log' &&
      Array.isArray(jsonContent.logEntries)
    ) {
      // logManager.js:107-121 — normalisation des entrées
      const validatedEntries: PctacLogEntry[] = jsonContent.logEntries.map((entry) => {
        // logManager.js:108-111 — ORDRE CRITIQUE : paxMode d'ABORD, puis utilisé pour fallback
        // C'est le différentiel clé par rapport à une logique « paxMode || free »
        let paxMode: PctacPaxMode = 'free';
        if (entry.paxMode) {
          paxMode = entry.paxMode;
        } else if (entry.pax && entry.pax in PDF_PAX_COLORS) {
          paxMode = 'standard';
        }

        const fallbackColor =
          paxMode === 'free' && FREE_MODE_COLORS[0] ? FREE_MODE_COLORS[0].hex : undefined;

        return {
          id: entry.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          heure: entry.heure || '00:00',
          pax: entry.pax || '',
          paxMode,
          // logManager.js:117 — fallback couleur utilise paxMode recalculé
          paxColor: entry.paxColor || fallbackColor,
          lieu: entry.lieu || '',
          remarques: entry.remarques || '',
        };
      });

      // logManager.js:122-127 — déduplication par id
      const currentLogs = Storage.loadLogData();
      const knownIds = new Set(currentLogs.map((l) => l.id));
      const newEntries = validatedEntries.filter((e) => !knownIds.has(e.id));
      const mergedLogs = [...currentLogs, ...newEntries];

      // logManager.js:128 — persistance du journal fusionné
      Storage.saveLogData(mergedLogs);

      // logManager.js:129 — résultat
      return { success: true, count: newEntries.length, logs: mergedLogs };
    } else {
      throw new Error('Fichier JSON invalide.');
    }
  },
};

// logManager.js:139 — affectation sur window au scope module
window.LogManager = LogManager;
