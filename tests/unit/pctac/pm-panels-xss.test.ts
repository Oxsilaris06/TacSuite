/**
 * pm-panels-xss.test.ts — V1 (revue neuve du 25/09) : le panneau « Changer
 * icône » injectait la couleur et l'icône d'un point tels quels dans un
 * innerHTML. Un point forgé dans une archive exécutait du JavaScript. La
 * couleur et le glyphe passent par les mêmes gardes que le marqueur
 * (`safePinColor`, `safePinGlyph`), et l'import d'archive les normalise.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/feedback.js', () => ({ toast: vi.fn(), confirmDialog: vi.fn(async () => true), undoableToast: vi.fn(), promptDialog: vi.fn() }));

import { PanelsMethods } from '@pctac/planmap/panels.js';
import { safePinColor, safePinGlyph } from '@pctac/planmap/pin-safe.js';
import { sanitizeImportColors } from '@pctac/archive.js';
import type { PlanMapInternal, PlanPin } from '@pctac/planmap/types.js';

const PAYLOAD = '#fff"><img id="pwn" src=x onerror="1">';

function fakeThis(pin: PlanPin): PlanMapInternal {
  return {
    map: { easeTo: vi.fn() },
    _loadPins: () => [pin],
    _openPingOptionsWheel: vi.fn(),
    ...PanelsMethods,
    // Après la propagation : le panneau réel est remplacé par un montage direct.
    _openInlinePanel: (_ll: unknown, html: string, opts: { onMount?: (root: HTMLElement) => void }) => {
      const root = document.createElement('div');
      root.id = 'panel-root';
      root.innerHTML = html;
      document.body.appendChild(root);
      opts.onMount?.(root);
    },
  } as unknown as PlanMapInternal;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('safePinColor / safePinGlyph (exportés)', () => {
  it('couleur hex ou rgb seulement, glyphe du catalogue seulement', () => {
    expect(safePinColor('#ff0000')).toBe('#ff0000');
    expect(safePinColor(PAYLOAD)).not.toContain('<');
    expect(safePinGlyph('flag', false)).toBe('flag');
    expect(safePinGlyph('', false)).toBeNull();
    expect(safePinGlyph(PAYLOAD, false)).toBe('flag'); // repli, jamais la valeur forgée
    expect(safePinGlyph(PAYLOAD, true)).toBe('directions_car');
  });
});

describe('_openIconCatalogPanelForEdit — point forgé', () => {
  it('n’insère aucune balise venue de la couleur ou de l’icône du point', () => {
    const pin = { id: 'p1', lng: 2.35, lat: 48.85, label: 'X', color: PAYLOAD, icon: PAYLOAD, kind: 'libre' } as unknown as PlanPin;
    fakeThis(pin)._openIconCatalogPanelForEdit('p1');
    expect(document.getElementById('pwn')).toBeNull();
    expect(document.querySelectorAll('#panel-root img')).toHaveLength(0);
    const current = document.querySelector<HTMLElement>('#panel-root .material-symbols-outlined');
    expect(current?.textContent).toBe('flag');
    expect(current?.style.color).not.toBe('');
    expect(document.querySelectorAll('#cat-edit-grid button').length).toBeGreaterThan(0);
  });
});

describe('sanitizeImportColors — points du plan', () => {
  it('normalise la couleur et retire une icône hors catalogue', () => {
    const out = sanitizeImportColors({
      pcTacPlanPins: JSON.stringify([
        { id: 'p1', lng: 2, lat: 48, label: 'A', color: PAYLOAD, icon: PAYLOAD },
        { id: 'p2', lng: 2, lat: 48, label: 'B', color: '#00ff00', icon: 'flag' },
      ]),
    });
    const pins = JSON.parse(out.pcTacPlanPins ?? '[]') as Array<{ color?: string; icon?: string }>;
    expect(pins[0]?.color).not.toContain('<');
    expect(pins[0]?.icon).toBeUndefined();
    expect(pins[1]).toMatchObject({ color: '#00ff00', icon: 'flag' });
  });
});
