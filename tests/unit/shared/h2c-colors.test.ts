/**
 * h2c-colors.test.ts — html2canvas 1.4 ne lit pas `color(srgb …)` (forme
 * calculée de `color-mix(in srgb, …)`) : la capture de carte échouait.
 */
import { describe, expect, it } from 'vitest';
import { srgbToRgba } from '@shared/h2c-colors.js';

describe('srgbToRgba', () => {
  it('opaque et translucide, arrondi à l’entier', () => {
    expect(srgbToRgba('color(srgb 0.0784314 0.0784314 0.0862745 / 0.92)')).toBe('rgba(20, 20, 22, 0.92)');
    expect(srgbToRgba('color(srgb 1 0 0.5)')).toBe('rgba(255, 0, 128, 1)');
  });

  it('dans une valeur composée (ombre, dégradé), toutes les occurrences', () => {
    expect(srgbToRgba('color(srgb 0 0 0 / 0.5) 0px 2px 4px 0px, color(srgb 1 1 1) 0px 0px 1px 0px'))
      .toBe('rgba(0, 0, 0, 0.5) 0px 2px 4px 0px, rgba(255, 255, 255, 1) 0px 0px 1px 0px');
  });

  it('alpha en pourcentage, valeurs hors bornes ramenées dans [0, 255]', () => {
    expect(srgbToRgba('color(srgb 1.2 -0.1 0.5 / 50%)')).toBe('rgba(255, 0, 128, 0.5)');
  });

  it('valeur sans color() : inchangée', () => {
    expect(srgbToRgba('rgba(1, 2, 3, 0.4)')).toBe('rgba(1, 2, 3, 0.4)');
  });
});
