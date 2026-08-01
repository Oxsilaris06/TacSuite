/**
 * pc-logmanager.test.ts — Comportement OBSERVÉ de `modules/pctac/logManager.js`
 * (GStart-main, 139 LOC).
 *
 * Écrit pour le portage en TS :
 *   - src/apps/pctac/log-manager.ts (LogManager: LogManagerContract)
 *
 * Pièges couverts (logManager.js):
 *   - :107-112 — importJson : `paxMode` recalculé d'ABORD, puis sert au fallback couleur
 *   - :123-126 — déduplication des entrées importées par `id`
 *   - :64-73 — historique des lieux : LRU borné à 30, insensible à la casse
 *   - :23-40 — addEntry : alert() + retour null si PAX ou heure manquants
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PctacLogEntry,
  PctacLogEntryInput,
  PctacLegacyLogJson,
} from '../../../src/shared/types/contracts.js';

import { LogManager } from '../../../src/apps/pctac/log-manager.js';
import { Storage } from '../../../src/apps/pctac/storage.js';
import { FREE_MODE_COLORS, PDF_PAX_COLORS } from '../../../src/apps/pctac/config.js';

describe('LogManager.addEntry — validation et rejet avec alert()', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
  });

  it('rejette si PAX manque en mode standard et retourne null', () => {
    const input: PctacLogEntryInput = {
      mode: 'standard',
      pax: '', // vide
      heure: '14:30',
      lieu: 'Paris',
    };

    const result = LogManager.addEntry(input);

    expect(result).toBeNull();
    expect(alert).toHaveBeenCalledWith('Veuillez sélectionner un type de PAX.');
  });

  it('rejette si heure manque et retourne null', () => {
    const input: PctacLogEntryInput = {
      mode: 'standard',
      pax: 'Adversaire',
      heure: '', // vide
      lieu: 'Paris',
    };

    const result = LogManager.addEntry(input);

    expect(result).toBeNull();
    expect(alert).toHaveBeenCalledWith('Veuillez renseigner l\'heure.');
  });

  it('accepte en mode libre avec fallback « Pax Libre » quand pax et freePax vides', () => {
    const input: PctacLogEntryInput = {
      mode: 'free',
      pax: '',
      freePax: '', // et freePax aussi vide
      heure: '14:30',
    };

    const result = LogManager.addEntry(input);

    expect(result).not.toBeNull();
    expect(result?.pax).toBe('Pax Libre'); // fallback
    expect(result?.paxMode).toBe('free');
  });

  it('accepte et crée une entrée valide en mode standard', () => {
    const input: PctacLogEntryInput = {
      mode: 'standard',
      pax: 'Adversaire',
      heure: '14:30',
      lieu: 'Paris',
      remarques: 'Test',
    };

    const result = LogManager.addEntry(input);

    expect(result).not.toBeNull();
    expect(result?.pax).toBe('Adversaire');
    expect(result?.paxMode).toBe('standard');
    expect(result?.paxColor).toBe('');
    expect(result?.heure).toBe('14:30');
    expect(result?.lieu).toBe('Paris');
  });

  it('accepte et crée une entrée valide en mode libre', () => {
    const input: PctacLogEntryInput = {
      mode: 'free',
      pax: '',
      freePax: 'Intervenant Custom',
      paxColor: '#ff0000',
      heure: '15:45',
    };

    const result = LogManager.addEntry(input);

    expect(result).not.toBeNull();
    expect(result?.pax).toBe('Intervenant Custom');
    expect(result?.paxMode).toBe('free');
    expect(result?.paxColor).toBe('#ff0000');
  });

  it('persiste l\'entrée acceptée dans Storage', () => {
    const input: PctacLogEntryInput = {
      mode: 'standard',
      pax: 'Adversaire',
      heure: '14:30',
    };

    LogManager.addEntry(input);
    const stored = Storage.loadLogData();

    expect(stored).toHaveLength(1);
    expect(stored[0]).toBeDefined();
    if (stored[0]) {
      expect(stored[0].pax).toBe('Adversaire');
    }
  });
});

describe('LogManager — historique des lieux (LRU, max 30, insensible à la casse)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ajoute un lieu à l\'historique', () => {
    LogManager.addLieuToHistory('Paris');

    const hist = LogManager.getLieuHistory();
    expect(hist).toContain('Paris');
  });

  it('empêche les doublons insensibles à la casse (« Lyon » ≠ « lyon »)', () => {
    LogManager.addLieuToHistory('Lyon');
    LogManager.addLieuToHistory('lyon'); // même lieu, casse différente

    const hist = LogManager.getLieuHistory();
    const matches = hist.filter((l) => l && l.toLowerCase() === 'lyon');
    expect(matches).toHaveLength(1);
  });

  it('conserve la dernière casse entrée lors du doublonnage', () => {
    LogManager.addLieuToHistory('Lyon');
    LogManager.addLieuToHistory('LYON');

    const hist = LogManager.getLieuHistory();
    expect(hist[0]).toBe('LYON'); // la dernière casse est conservée
  });

  it('respecte l\'ordre LRU : le plus récent d\'abord', () => {
    LogManager.addLieuToHistory('Paris');
    LogManager.addLieuToHistory('Marseille');
    LogManager.addLieuToHistory('Paris'); // réutilisation, doit remonter

    const hist = LogManager.getLieuHistory();
    expect(hist[0]).toBe('Paris');
    expect(hist[1]).toBe('Marseille');
  });

  it('borne l\'historique à 30 entrées', () => {
    for (let i = 0; i < 35; i++) {
      LogManager.addLieuToHistory(`Lieu${i}`);
    }

    const hist = LogManager.getLieuHistory();
    expect(hist).toHaveLength(30);
  });

  it('ignore les lieux vides ou composés uniquement d\'espaces', () => {
    LogManager.addLieuToHistory('');
    LogManager.addLieuToHistory('   ');

    const hist = LogManager.getLieuHistory();
    expect(hist).toHaveLength(0);
  });
});

describe('LogManager.importJson — déduplication par id', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('déduplique les entrées importées par id', () => {
    // Charger une première entrée
    const existingEntry: PctacLogEntry = {
      id: 'entry-1',
      heure: '10:00',
      pax: 'Alice',
      paxMode: 'standard',
      lieu: 'Paris',
      remarques: 'Première',
    };
    Storage.saveLogData([existingEntry]);

    // Importer un JSON contenant la même id + une nouvelle
    const importJson: PctacLegacyLogJson = {
      metadata: { appName: 'PC Tac Log' },
      logEntries: [
        {
          id: 'entry-1',
          heure: '10:00',
          pax: 'Alice',
          paxMode: 'standard' as const,
        },
        {
          id: 'entry-2',
          heure: '11:00',
          pax: 'Bob',
          paxMode: 'standard' as const,
        },
      ],
    };

    const result = LogManager.importJson(importJson);

    expect(result.count).toBe(1); // seule entry-2 est ajoutée
    expect(result.logs).toHaveLength(2); // total : 2 entrées
    expect(result.logs.map((e) => e.id)).toContain('entry-1');
    expect(result.logs.map((e) => e.id)).toContain('entry-2');
  });
});

describe('LogManager.importJson — fallback couleur (paxMode recalculé d\'ABORD)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('recalcule paxMode AVANT d\'appliquer le fallback couleur', () => {
    // Construction : une entrée sans paxMode qui doit être détectée comme
    // mode 'free' (pas de couleur PDF standard), donc reçoit une couleur libre
    const importJson: PctacLegacyLogJson = {
      metadata: { appName: 'PC Tac Log' },
      logEntries: [
        {
          id: 'custom-1',
          heure: '10:00',
          pax: 'Custom Name (pas de couleur PDF)', // pas dans PDF_PAX_COLORS
          // paxMode absent, doit être recalculé
          // paxColor absent
        },
      ],
    };

    const result = LogManager.importJson(importJson);

    const imported = result.logs[0];
    expect(imported).toBeDefined();
    if (imported) {
      // paxMode doit être recalculé comme 'free'
      expect(imported.paxMode).toBe('free');
      // paxColor doit recevoir un fallback depuis FREE_MODE_COLORS[0]
      const fallbackColor = FREE_MODE_COLORS[0];
      expect(fallbackColor).toBeDefined();
      if (fallbackColor) {
        expect(imported.paxColor).toBe(fallbackColor.hex);
      }
    }
  });

  it('n\'applique pas le fallback couleur pour un PAX en mode standard', () => {
    // Un PAX standard (dans PDF_PAX_COLORS) ne doit pas reçevoir de couleur libre
    const standardPaxList = Object.keys(PDF_PAX_COLORS);
    if (standardPaxList.length === 0) {
      // Skip si aucun PAX standard trouvé
      expect(true).toBe(true);
      return;
    }
    const standardPax = standardPaxList[0]; // ex. 'Adversaire'
    if (!standardPax) {
      // Type guard pour TypeScript
      expect(true).toBe(true);
      return;
    }

    const importJson: PctacLegacyLogJson = {
      metadata: { appName: 'PC Tac Log' },
      logEntries: [
        {
          id: 'std-1',
          heure: '10:00',
          pax: standardPax,
          // paxMode absent
          // paxColor absent
        },
      ],
    };

    const result = LogManager.importJson(importJson);

    const imported = result.logs[0];
    expect(imported).toBeDefined();
    if (imported) {
      // paxMode doit être 'standard'
      expect(imported.paxMode).toBe('standard');
      // paxColor doit rester undefined (pas de fallback libre)
      expect(imported.paxColor).toBeUndefined();
    }
  });
});

describe('LogManager.importJson — validation du format JSON', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rejette un JSON sans metadata.appName', () => {
    const badJson: PctacLegacyLogJson = {
      metadata: { appName: 'Wrong App' },
      logEntries: [],
    };

    expect(() => LogManager.importJson(badJson)).toThrow('Fichier JSON invalide.');
  });

  it('rejette un JSON sans logEntries', () => {
    const badJson: PctacLegacyLogJson = {
      metadata: { appName: 'PC Tac Log' },
      // logEntries absent
    };

    expect(() => LogManager.importJson(badJson)).toThrow('Fichier JSON invalide.');
  });

  it('rejette un JSON où logEntries n\'est pas un tableau', () => {
    const badJson = {
      metadata: { appName: 'PC Tac Log' },
      logEntries: { foo: 'bar' }, // objet, pas tableau
    };

    expect(() => LogManager.importJson(badJson as unknown as PctacLegacyLogJson)).toThrow(
      'Fichier JSON invalide.',
    );
  });

  it('accepte et importe un JSON valide', () => {
    const goodJson: PctacLegacyLogJson = {
      metadata: { appName: 'PC Tac Log' },
      logEntries: [
        {
          id: 'test-1',
          heure: '14:00',
          pax: 'Adversaire',
          paxMode: 'standard' as const,
        },
      ],
    };

    const result = LogManager.importJson(goodJson);

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.logs).toHaveLength(1);
  });
});

describe('LogManager.deleteEntry et updateEntry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('supprime une entrée par id', () => {
    const entry: PctacLogEntry = {
      id: 'to-delete',
      heure: '14:00',
      pax: 'Adversaire',
      paxMode: 'standard',
      lieu: 'Paris',
      remarques: '',
    };
    Storage.saveLogData([entry]);

    const result = LogManager.deleteEntry('to-delete');

    expect(result).toHaveLength(0);
  });

  it('met à jour une entrée existante', () => {
    const entry: PctacLogEntry = {
      id: 'to-update',
      heure: '14:00',
      pax: 'Adversaire',
      paxMode: 'standard',
      lieu: 'Paris',
      remarques: 'Original',
    };
    Storage.saveLogData([entry]);

    const result = LogManager.updateEntry('to-update', { remarques: 'Updated' });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeDefined();
    if (result[0]) {
      expect(result[0].remarques).toBe('Updated');
      expect(result[0].pax).toBe('Adversaire'); // autres champs inchangés
    }
  });
});
