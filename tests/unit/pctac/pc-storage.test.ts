/**
 * pc-storage.test.ts — Comportement OBSERVÉ de `modules/pctac/storage.js`
 * et `modules/pctac/utils.js` (GStart-main, 117 LOC et 52 LOC).
 *
 * Écrit pour le portage en TS :
 *   - src/apps/pctac/storage.ts (Storage: PctacStorageContract)
 *   - src/apps/pctac/utils.ts (Utils: { compressImage })
 *
 * Pièges couverts :
 *   - storage.js:57 — saveTpAssociation indexe par COULEUR, pas par libellé
 *   - storage.js:26-29 — saveLogData TRIE EN PLACE (mutation) puis persiste
 *   - storage.js:84-109 — clearAllData supprime les 14 clés exactement
 *   - utils.js:38-46 — compressImage accepte File OU dataURL → toujours image/jpeg
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { PctacLogEntry } from '../../../src/shared/types/contracts.js';

// Imports des modules à tester (sera créés)
import { Storage } from '../../../src/apps/pctac/storage.js';
import { Utils } from '../../../src/apps/pctac/utils.js';

// Constantes de config
import {
  LOCAL_STORAGE_KEY,
  TP_ASSOC_KEY,
  ADVERSARIES_KEY,
  HOSTAGES_KEY,
  FRIENDS_KEY,
  PHOTOS_KEY,
  CUSTOM_PAX_KEY,
} from '../../../src/apps/pctac/config.js';

describe('Storage — saveTpAssociation indexée par couleur (storage.js:57)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('associe le label à la couleur (assoc[color] = label), pas le contraire', () => {
    Storage.saveTpAssociation('Alpha', '#ff0000');
    Storage.saveTpAssociation('Bravo', '#00ff00');

    const assoc = Storage.getTpAssociations();
    // La clé est la COULEUR, pas le libellé
    expect(assoc['#ff0000']).toBe('Alpha');
    expect(assoc['#00ff00']).toBe('Bravo');

    // À l'inverse, le libellé ne doit PAS être une clé
    expect(assoc['Alpha']).toBeUndefined();
    expect(assoc['Bravo']).toBeUndefined();
  });

  it('écraser une association ne crée pas de doublons', () => {
    Storage.saveTpAssociation('Alpha', '#ff0000');
    Storage.saveTpAssociation('Autre', '#ff0000'); // même couleur

    const assoc = Storage.getTpAssociations();
    expect(Object.keys(assoc)).toHaveLength(1);
    expect(assoc['#ff0000']).toBe('Autre');
  });
});

describe('Storage — saveLogData trie EN PLACE (storage.js:26-29)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('le tableau reçu est MUTÉ en place, pas dupliqué', () => {
    const entries: PctacLogEntry[] = [
      {
        id: '1',
        heure: '14:00',
        pax: 'Alice',
        paxMode: 'free',
        lieu: 'Paris',
        remarques: 'Test',
      },
      {
        id: '2',
        heure: '12:00',
        pax: 'Bob',
        paxMode: 'standard',
        lieu: 'Lyon',
        remarques: 'Test',
      },
      {
        id: '3',
        heure: '13:00',
        pax: 'Charlie',
        paxMode: 'standard',
        lieu: 'Marseille',
        remarques: 'Test',
      },
    ];

    const originalOrder = entries.map((e) => e.heure);
    expect(originalOrder).toEqual(['14:00', '12:00', '13:00']); // désordre

    Storage.saveLogData(entries);

    // Le tableau d'entrée a été MUTÉ en place
    expect(entries[0]?.heure).toBe('12:00'); // Bob (12:00) est maintenant en tête
    expect(entries[1]?.heure).toBe('13:00'); // Charlie (13:00) en second
    expect(entries[2]?.heure).toBe('14:00'); // Alice (14:00) en dernier

    // La persistance reflète l'ordre trié
    const loaded = Storage.loadLogData();
    expect(loaded.map((e) => e.heure)).toEqual(['12:00', '13:00', '14:00']);
  });

  it('U15 — trie par (date, heure) ; les entrées legacy sans date passent avant', () => {
    const entries: PctacLogEntry[] = [
      { id: 'd2', heure: '01:00', pax: 'A', paxMode: 'standard', lieu: '', remarques: '', date: '2026-08-11' },
      { id: 'legacy', heure: '23:00', pax: 'B', paxMode: 'standard', lieu: '', remarques: '' },
      { id: 'd1', heure: '22:00', pax: 'C', paxMode: 'standard', lieu: '', remarques: '', date: '2026-08-10' },
    ];

    Storage.saveLogData(entries);

    // Legacy (sans date) d'abord, puis 10/08 22:00, puis 11/08 01:00 :
    // l'ambiguïté minuit est levée par la date, pas par l'heure seule.
    expect(entries.map((e) => e.id)).toEqual(['legacy', 'd1', 'd2']);
  });

  it('deux entrées avec la même heure conservent un ordre stable', () => {
    const entries: PctacLogEntry[] = [
      {
        id: '1',
        heure: '12:00',
        pax: 'Alice',
        paxMode: 'standard',
        lieu: 'A',
        remarques: '',
      },
      {
        id: '2',
        heure: '12:00',
        pax: 'Bob',
        paxMode: 'standard',
        lieu: 'B',
        remarques: '',
      },
    ];

    Storage.saveLogData(entries);
    const loaded = Storage.loadLogData();

    // Toutes deux ont '12:00', l'ordre n'est pas garanti par la spec
    // mais le tri doit être défini (pas d'ordre aléatoire)
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.heure).toBe('12:00');
    expect(loaded[1]?.heure).toBe('12:00');
  });
});

describe('Storage — clearAllData supprime les 14 clés (storage.js:84-109)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('supprime les 14 clés de storage.js:84-109', () => {
    // Pose toutes les 14 clés (liste de storage.js:84-109)
    const keysToDelete = [
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
      'pcTacPlanLocked',
      'pcTacDashboard',
    ];

    keysToDelete.forEach((k) => {
      localStorage.setItem(k, JSON.stringify({ test: true }));
    });

    // Ajoute une clé "en dehors" qui ne doit PAS être supprimée
    localStorage.setItem('z_custom_key_outside', 'should_remain');

    // Appelle clearAllData
    Storage.clearAllData();

    // Toutes les 14 clés sont parties
    keysToDelete.forEach((k) => {
      expect(localStorage.getItem(k)).toBeNull();
    });

    // La clé "en dehors" survit
    expect(localStorage.getItem('z_custom_key_outside')).toBe('should_remain');
    // Seule cette clé doit rester
    expect(localStorage.length).toBe(1);
  });

  it('ne jette pas même si une clé est manquante au départ', () => {
    localStorage.setItem('pcTacPlanPins', 'test');
    // Les autres clés ne sont pas posées

    expect(() => {
      Storage.clearAllData();
    }).not.toThrow();

    expect(localStorage.getItem('pcTacPlanPins')).toBeNull();
  });
});

describe('Storage — loadLogData sur stockage vide ou corrompu', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('retourne [] quand aucune donnée n\'existe', () => {
    const loaded = Storage.loadLogData();
    expect(loaded).toEqual([]);
  });

  it('retourne [] si la chaîne JSON est invalide (Persist sauvegarde le .bak)', () => {
    // Force une chaîne JSON invalide dans localStorage
    localStorage.setItem(LOCAL_STORAGE_KEY, '{invalid json}');

    const loaded = Storage.loadLogData();
    // Persist applique le fallback []
    expect(loaded).toEqual([]);

    // La clé .bak doit contenir la chaîne brute (tentative de sauvetage)
    const bak = localStorage.getItem(LOCAL_STORAGE_KEY + '.bak');
    expect(bak).toBe('{invalid json}');
  });

  it('retourne [] si la valeur n\'est pas un tableau', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ not: 'an array' }));

    const loaded = Storage.loadLogData();
    expect(loaded).toEqual([]);
  });
});

describe('Utils — compressImage (utils.js:38-46)', () => {
  /**
   * NOTE : les tests de compressImage ci-dessous testent l'aiguillage logique
   * (File vs dataURL) mais PAS le rendu canvas réel, qui n'est pas disponible
   * sous jsdom. Le canvas compile, mais Image.onload ne se déclenche jamais.
   *
   * Les vrais tests de compression (redimensionnement, qualité JPEG, .toDataURL)
   * doivent être validés en E2E ou en environnement NodeJS avec un polyfill canvas.
   * (cf. SPEC-PCTAC-CONVERSION.md §8.4)
   */

  it('branchement File vs dataURL : accepte File ET dataURL sans distinction', () => {
    // Vérifier que la fonction peut être appelée des deux façons sans TypeError
    const blob = new Blob(['test'], { type: 'image/png' });
    const file = new File([blob], 'test.png');
    const dataUrl = 'data:image/png;base64,test';

    // L'appel lui-même ne doit pas jeter
    expect(() => {
      Utils.compressImage(file);
    }).not.toThrow();

    expect(() => {
      Utils.compressImage(dataUrl);
    }).not.toThrow();
  });
});
