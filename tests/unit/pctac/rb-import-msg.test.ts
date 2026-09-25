/**
 * rb-import-msg.test.ts — R10 (photos d'OI annoncées) et double toast d'import
 * (un seul message : le récapitulatif quand il existe).
 */

import { describe, expect, it } from 'vitest';
import { Utils } from '@pctac/utils.js';

describe('Utils.oiImportSummaryParts (R10)', () => {
  it('annonce les photos de galerie ajoutées et mises à jour', () => {
    const parts = Utils.oiImportSummaryParts({
      advAdded: 0, advPhotos: 0, paxAdded: 0, galleryAdded: 2, galleryUpdated: 1,
    });
    expect(parts.join(', ')).toContain('2 photo(s) de l\'OI');
    expect(parts.join(', ')).toContain('1 photo(s) mise(s) à jour');
  });

  it('garde le récapitulatif d\'origine sans galerie', () => {
    expect(Utils.oiImportSummaryParts({ advAdded: 2, advPhotos: 1, paxAdded: 3, gridImported: true }))
      .toEqual(['2 adversaire(s)', '1 photo(s)', '3 intervenant(s)', 'le carroyage']);
  });
});

describe('Utils.archiveImportHasRecap', () => {
  it('vrai dès qu\'il y a quelque chose à dire', () => {
    expect(Utils.archiveImportHasRecap({ replacedFiches: ['A'], mergedFiches: [], unknownKeys: 0 })).toBe(true);
    expect(Utils.archiveImportHasRecap({ replacedFiches: [], mergedFiches: [], unknownKeys: 2 })).toBe(true);
  });

  it('faux quand il n\'y a ni remplacement, ni fusion, ni clé ignorée', () => {
    expect(Utils.archiveImportHasRecap({ replacedFiches: [], mergedFiches: [], unknownKeys: 0 })).toBe(false);
  });
});
