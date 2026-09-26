/**
 * Pastilles PAX de la main courante (atelier UI-1, capture
 * tablet-light-03-p8-mc) : « Inter », blanc sur bleu clair, ~3:1. Le texte
 * de chaque pastille, intervenant standard ou couleur libre, atteint 4,5:1
 * (WCAG AA) : noir ou blanc, le plus contrasté des deux.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(): Promise<void> {},
    async get(): Promise<string | null> { return null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(): Promise<void> {},
    async deleteMany(): Promise<void> {},
    async clear(): Promise<void> {},
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
  },
}));

import { UI } from '@pctac/ui.js';
import { FREE_MODE_COLORS, PDF_PAX_COLORS } from '@pctac/config.js';

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<table id="logTable"><tbody></tbody></table>';
  UI.initElements();
});

describe('pastilles PAX : texte lisible à 4,5:1', () => {
  it('intervenants standard (dont « Inter ») et couleurs libres', () => {
    const entries = [
      ...Object.keys(PDF_PAX_COLORS).map((pax, i) => ({ id: `s${i}`, heure: '10:00', pax, paxMode: 'standard', lieu: '', remarques: '' })),
      ...FREE_MODE_COLORS.map((c, i) => ({ id: `f${i}`, heure: '10:00', pax: c.name, paxMode: 'free', paxColor: c.hex, lieu: '', remarques: '' })),
    ];
    UI.renderLogTable(entries as Parameters<typeof UI.renderLogTable>[0]);
    const low = Array.from(document.querySelectorAll<HTMLElement>('#logTable .pax-cell'))
      .map((c) => ({ text: c.textContent, r: ratio(c.style.backgroundColor, c.style.color) }))
      .filter((x) => x.r < 4.5)
      .map((x) => `${x.text} ${x.r.toFixed(2)}`);
    expect(low).toEqual([]);
  });
});
