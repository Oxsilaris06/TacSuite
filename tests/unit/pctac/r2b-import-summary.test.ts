/**
 * r2b-import-summary.test.ts — C13 (K1, double toast d'import) et C14 (K2,
 * fiches fusionnées annoncées à la passerelle OI).
 */

import { describe, expect, it } from 'vitest';
import { Utils } from '@pctac/utils.js';

describe('C13 / K1 — archiveImportHasRecap tient compte de warned', () => {
  it('vrai quand archive.ts a déjà affiché un échec partiel', () => {
    expect(Utils.archiveImportHasRecap({ replacedFiches: [], mergedFiches: [], unknownKeys: 0, warned: true })).toBe(true);
  });

  it('faux quand il n y a rien à dire et aucune alerte', () => {
    expect(Utils.archiveImportHasRecap({ replacedFiches: [], mergedFiches: [], unknownKeys: 0, warned: false })).toBe(false);
  });

  it('garde la détection historique (remplacement, fusion, clé ignorée)', () => {
    expect(Utils.archiveImportHasRecap({ replacedFiches: ['A'], mergedFiches: [], unknownKeys: 0 })).toBe(true);
    expect(Utils.archiveImportHasRecap({ replacedFiches: [], mergedFiches: ['B'], unknownKeys: 0 })).toBe(true);
    expect(Utils.archiveImportHasRecap({ replacedFiches: [], mergedFiches: [], unknownKeys: 1 })).toBe(true);
  });
});

describe('C14 / K2 — oiImportSummaryParts annonce les fiches fusionnées', () => {
  it('compte les fiches fusionnées à part', () => {
    const parts = Utils.oiImportSummaryParts({ advAdded: 0, advPhotos: 0, paxAdded: 0, advMerged: 2 });
    expect(parts.join(', ')).toContain('2 fiche(s) fusionnée(s)');
  });

  it('reste muet sur les fusions quand il n y en a pas', () => {
    const parts = Utils.oiImportSummaryParts({ advAdded: 1, advPhotos: 0, paxAdded: 0 });
    expect(parts.join(', ')).not.toContain('fusionnée');
  });
});
