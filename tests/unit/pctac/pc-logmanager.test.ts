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
 *   - :23-40 — addEntry : toast d'erreur (R2-T2a, ex-alert()) + retour null si PAX ou heure manquants
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PctacLogEntry,
  PctacLogEntryInput,
  PctacLegacyLogJson,
} from '../../../src/shared/types/contracts.js';

import { LogManager, closestLocalDate } from '../../../src/apps/pctac/log-manager.js';
import { Storage } from '../../../src/apps/pctac/storage.js';
import { FREE_MODE_COLORS, PDF_PAX_COLORS } from '../../../src/apps/pctac/config.js';

// R2-T2a : `alert()` → `toast(..., { kind: 'error' })`. Le module partagé
// est mocké pour espionner les appels sans dépendre du DOM réel injecté par
// `feedback.ts` (cohérent avec `vi.stubGlobal('alert', ...)` qu'il remplace).
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../src/shared/feedback.js', () => ({ toast: toastSpy }));

describe('LogManager.addEntry — validation et rejet avec toast (R2-T2a, ex-alert())', () => {
  beforeEach(() => {
    localStorage.clear();
    toastSpy.mockClear();
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
    expect(toastSpy).toHaveBeenCalledWith('Veuillez sélectionner un type de PAX.', { kind: 'error' });
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
    expect(toastSpy).toHaveBeenCalledWith('Veuillez renseigner l\'heure.', { kind: 'error' });
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

  it('pose une date ISO YYYY-MM-DD (décision 30) à la création', () => {
    const result = LogManager.addEntry({
      mode: 'standard',
      pax: 'Adversaire',
      heure: '14:30',
    });

    expect(result?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

describe('closestLocalDate — occurrence la plus proche (décision 30)', () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number): Date => new Date(y, mo - 1, d, h, mi, 0, 0);

  it('23:55 saisi à 00:05 = la veille', () => {
    expect(closestLocalDate('23:55', at(2026, 1, 2, 0, 5))).toBe('2026-01-01');
  });

  it('14:00 saisi à 13:00 = aujourd\'hui', () => {
    expect(closestLocalDate('14:00', at(2026, 1, 2, 13, 0))).toBe('2026-01-02');
  });

  it('00:05 saisi à 23:55 = le lendemain', () => {
    expect(closestLocalDate('00:05', at(2026, 1, 2, 23, 55))).toBe('2026-01-03');
  });

  it('heure égale à maintenant = aujourd\'hui', () => {
    expect(closestLocalDate('13:00', at(2026, 1, 2, 13, 0))).toBe('2026-01-02');
  });

  it('passage de minuit : la même heure saisie de part et d\'autre change de jour', () => {
    expect(closestLocalDate('23:59', at(2026, 1, 2, 23, 59))).toBe('2026-01-02');
    expect(closestLocalDate('23:59', at(2026, 1, 3, 0, 1))).toBe('2026-01-02');
  });

  it('heure illisible : repli sur le jour courant, jamais de crash', () => {
    expect(closestLocalDate('pas une heure', at(2026, 1, 2, 8, 0))).toBe('2026-01-02');
    expect(closestLocalDate('', at(2026, 1, 2, 8, 0))).toBe('2026-01-02');
  });
});

describe('LogManager.addEntry — date déduite (horloge simulée, décision 30)', () => {
  beforeEach(() => {
    localStorage.clear();
    toastSpy.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('date la veille quand l\'heure saisie est proche de minuit passé', () => {
    vi.setSystemTime(new Date(2026, 0, 2, 0, 5));
    const result = LogManager.addEntry({ mode: 'standard', pax: 'Adversaire', heure: '23:55' });
    expect(result?.date).toBe('2026-01-01');
  });

  it('date le lendemain quand l\'heure saisie est proche de minuit à venir', () => {
    vi.setSystemTime(new Date(2026, 0, 2, 23, 55));
    const result = LogManager.addEntry({ mode: 'standard', pax: 'Adversaire', heure: '00:05' });
    expect(result?.date).toBe('2026-01-03');
  });

  it('changement de jour PENDANT la saisie : l\'heure figée de la veille passe sur la veille', () => {
    vi.setSystemTime(new Date(2026, 0, 2, 23, 59));
    expect(closestLocalDate('23:59')).toBe('2026-01-02');
    // Le temps avance au-delà de minuit, l'heure saisie reste 23:59.
    vi.setSystemTime(new Date(2026, 0, 3, 0, 1));
    const result = LogManager.addEntry({ mode: 'standard', pax: 'Adversaire', heure: '23:59' });
    expect(result?.date).toBe('2026-01-02');
  });
});

describe('LogManager.updateEntry — tri après édition de la date', () => {
  beforeEach(() => localStorage.clear());

  it('réordonne le journal quand la date change (tri (date, heure))', () => {
    Storage.saveLogData([
      { id: 'a', heure: '10:00', pax: 'Adversaire', paxMode: 'standard', lieu: '', remarques: '', date: '2026-01-01' },
      { id: 'b', heure: '09:00', pax: 'Otage', paxMode: 'standard', lieu: '', remarques: '', date: '2026-01-02' },
    ]);
    expect(Storage.loadLogData().map((e) => e.id)).toEqual(['a', 'b']);

    LogManager.updateEntry('a', { date: '2026-01-03' });
    expect(Storage.loadLogData().map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('LogManager.addEntry — stockage plein (correction d\'office)', () => {
  beforeEach(() => {
    localStorage.clear();
    toastSpy.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuse l\'ajout, ne date PAS l\'historique et ne vide rien (retour null)', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      (err as { name: string }).name = 'QuotaExceededError';
      throw err;
    });
    try {
      const result = LogManager.addEntry({
        mode: 'standard',
        pax: 'Adversaire',
        heure: '14:30',
        lieu: 'Paris',
      });

      expect(result).toBeNull();
      expect(toastSpy).toHaveBeenCalledWith('Stockage plein : événement NON enregistré.', { kind: 'error' });
      // Le journal reste vide (aucune écriture partielle) et l'historique des
      // lieux n'a pas été daté avec une entrée fantôme.
      expect(Storage.loadLogData()).toHaveLength(0);
      expect(LogManager.getLieuHistory()).toHaveLength(0);
    } finally {
      setItem.mockRestore();
    }
  });

  it('après restauration du stockage, l\'ajout réussit et l\'historique suit', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      (err as { name: string }).name = 'QuotaExceededError';
      throw err;
    });
    expect(LogManager.addEntry({ mode: 'standard', pax: 'Adversaire', heure: '14:30', lieu: 'Paris' })).toBeNull();
    setItem.mockRestore();

    const result = LogManager.addEntry({ mode: 'standard', pax: 'Adversaire', heure: '14:31', lieu: 'Lyon' });
    expect(result).not.toBeNull();
    expect(Storage.loadLogData()).toHaveLength(1);
    expect(LogManager.getLieuHistory()).toContain('Lyon');
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

    // R22 — `updateEntry` rend désormais le succès de l'écriture.
    expect(LogManager.updateEntry('to-update', { remarques: 'Updated' })).toBe(true);

    const result = Storage.loadLogData();
    expect(result).toHaveLength(1);
    expect(result[0]).toBeDefined();
    if (result[0]) {
      expect(result[0].remarques).toBe('Updated');
      expect(result[0].pax).toBe('Adversaire'); // autres champs inchangés
    }
  });

  it('R22 — stockage plein : updateEntry rend false et ne jette pas', () => {
    const entry: PctacLogEntry = {
      id: 'to-update', heure: '14:00', pax: 'Adversaire', paxMode: 'standard', lieu: 'Paris', remarques: 'Original',
    };
    Storage.saveLogData([entry]);
    const spy = vi.spyOn(Storage, 'saveLogData').mockReturnValue(false);
    expect(LogManager.updateEntry('to-update', { remarques: 'Updated' })).toBe(false);
    spy.mockRestore();
  });
});
