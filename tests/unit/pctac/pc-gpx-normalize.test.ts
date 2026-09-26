/**
 * pc-gpx-normalize.test.ts — audit du 26/09 (skills getsentry-security-review,
 * trailofbits-sharp-edges) : une trace GPX malformée venue d'une archive était
 * stockée telle quelle, puis faisait échouer le chargement de TOUTES les traces
 * de la situation, en silence, jusqu'au RESET.
 */
import { describe, expect, it } from 'vitest';

// GpxStore.put et GpxStore.get passent tous deux par normalizeGpxTrack
// (IndexedDB absent sous jsdom : la fonction pure porte le contrat).
import { normalizeGpxTrack } from '@pctac/image-store.js';

describe('normalizeGpxTrack', () => {
  it('garde une trace saine telle quelle', () => {
    expect(normalizeGpxTrack([[[2.35, 48.85], [2.36, 48.86]]], [[1000, 2000]]))
      .toEqual({ coords: [[[2.35, 48.85], [2.36, 48.86]]], times: [[1000, 2000]] });
    expect(normalizeGpxTrack([[[2.35, 48.85]]], null)).toEqual({ coords: [[[2.35, 48.85]]], times: null });
  });

  it('écarte les points invalides en gardant les temps alignés', () => {
    const out = normalizeGpxTrack(
      [[[2.35, 48.85], ['x', 1], [500, 48], [2.36, 48.86, 120]], 'pas un segment', []],
      [[1000, 2000, 3000, 'z']],
    );
    expect(out).toEqual({ coords: [[[2.35, 48.85], [2.36, 48.86]]], times: [[1000, null]] });
  });

  it('temps de forme fausse (« times: [5] ») : ignorés, la trace reste lisible', () => {
    expect(normalizeGpxTrack([[[1, 2], [3, 4]]], [5])).toEqual({ coords: [[[1, 2], [3, 4]]], times: [[null, null]] });
  });

  it('rien d’exploitable : null', () => {
    expect(normalizeGpxTrack('x', null)).toBeNull();
    expect(normalizeGpxTrack([[['a', 'b']]], null)).toBeNull();
    expect(normalizeGpxTrack([], null)).toBeNull();
  });
});

