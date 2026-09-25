/**
 * xss-paxcolor.test.ts — A1 (revue du 25/09) : la couleur d'un intervenant
 * (`paxColor` d'une entrée de main courante, `color` d'un intervenant
 * personnalisé) ne doit jamais atteindre un attribut HTML. Elle est posée par
 * l'API DOM au rendu et validée `#rrggbb` aux deux frontières : la saisie
 * (LogManager.addEntry) et l'import d'archive (sanitizeImportColors).
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
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({
  toast: toastSpy,
  confirmDialog: vi.fn(async () => true),
  showBanner: vi.fn(),
  hideBanner: vi.fn(),
}));

import { UI } from '@pctac/ui.js';
import { LogManager } from '@pctac/log-manager.js';
import { CUSTOM_PAX_KEY, FREE_MODE_COLORS, LOCAL_STORAGE_KEY, safeHexColor } from '@pctac/config.js';
import { sanitizeImportColors } from '@pctac/archive.js';

const PAYLOAD = '#fff"><img id="pwn" src=x onerror="1">';
const DEFAULT_HEX = FREE_MODE_COLORS[0]?.hex ?? '';

describe('safeHexColor', () => {
  it('accepte #rrggbb et #rgb, normalisés en minuscules sur 6 chiffres', () => {
    expect(safeHexColor('#7C3AED', '#000000')).toBe('#7c3aed');
    expect(safeHexColor('#abc', '#000000')).toBe('#aabbcc');
    expect(safeHexColor(' #ff69b4 ', '#000000')).toBe('#ff69b4');
  });

  it('rend le repli pour tout le reste', () => {
    for (const bad of [PAYLOAD, 'red', 'url(x)', '#12345', '#ggg', '', undefined, null, 42]) {
      expect(safeHexColor(bad, '#000000')).toBe('#000000');
    }
  });
});

describe('renderLogTable — couleur posée par l’API DOM, jamais dans le HTML', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<table id="logTable"><tbody></tbody></table>';
    UI.initElements();
  });

  it('n’insère aucune balise venue de paxColor et retombe sur la couleur par défaut', () => {
    UI.renderLogTable([
      { id: 'x1', heure: '10:00', pax: 'Libre', paxMode: 'free', paxColor: PAYLOAD, lieu: '', remarques: '' },
    ]);
    expect(document.getElementById('pwn')).toBeNull();
    expect(document.querySelectorAll('#logTable img')).toHaveLength(0);
    const cell = document.querySelector<HTMLElement>('#logTable .pax-cell');
    expect(cell).not.toBeNull();
    expect(cell?.style.backgroundColor).toBe('rgb(124, 58, 237)'); // FREE_MODE_COLORS[0] = #7c3aed
  });

  it('garde une couleur valide', () => {
    UI.renderLogTable([
      { id: 'x2', heure: '10:00', pax: 'Libre', paxMode: 'free', paxColor: '#ff69b4', lieu: '', remarques: '' },
    ]);
    const cell = document.querySelector<HTMLElement>('#logTable .pax-cell');
    expect(cell?.style.backgroundColor).toBe('rgb(255, 105, 180)');
    expect(cell?.style.color).toBe('rgb(0, 0, 0)');
  });
});

describe('LogManager.addEntry — frontière de saisie', () => {
  beforeEach(() => { localStorage.clear(); toastSpy.mockClear(); });

  it('remplace une couleur hors format par la couleur par défaut', () => {
    const entry = LogManager.addEntry({
      mode: 'free', pax: 'Bob', freePax: '', paxColor: PAYLOAD, heure: '10:00', lieu: '', remarques: '',
    });
    expect(entry?.paxColor).toBe(DEFAULT_HEX);
  });

  it('normalise une couleur valide', () => {
    const entry = LogManager.addEntry({
      mode: 'free', pax: 'Bob', freePax: '', paxColor: '#ABCDEF', heure: '10:00', lieu: '', remarques: '',
    });
    expect(entry?.paxColor).toBe('#abcdef');
  });
});

describe('sanitizeImportColors — frontière d’archive', () => {
  it('normalise paxColor des entrées et color des intervenants, sans toucher au reste', () => {
    const data: Record<string, string> = {
      [LOCAL_STORAGE_KEY]: JSON.stringify([
        { id: 'a1', paxMode: 'free', pax: 'X', paxColor: PAYLOAD, heure: '10:00' },
        { id: 'a2', paxMode: 'free', pax: 'Y', paxColor: '#ABCDEF', heure: '10:01' },
        { id: 'a3', paxMode: 'standard', pax: 'Adversaire', paxColor: '', heure: '10:02' },
      ]),
      [CUSTOM_PAX_KEY]: JSON.stringify([{ id: 'p1', name: 'Z', color: PAYLOAD }]),
      autre: 'inchangé',
    };
    const out = sanitizeImportColors(data);
    const log = JSON.parse(out[LOCAL_STORAGE_KEY] ?? '[]') as Array<{ paxColor?: string }>;
    expect(log[0]?.paxColor).toBe(DEFAULT_HEX);
    expect(log[1]?.paxColor).toBe('#abcdef');
    expect(log[2]?.paxColor).toBe('');
    expect((JSON.parse(out[CUSTOM_PAX_KEY] ?? '[]') as Array<{ color?: string }>)[0]?.color).toBe(DEFAULT_HEX);
    expect(out.autre).toBe('inchangé');
  });

  it('laisse passer une valeur qui n’est pas un tableau JSON (la liste blanche fait le reste)', () => {
    expect(sanitizeImportColors({ [LOCAL_STORAGE_KEY]: 'pas du json' })[LOCAL_STORAGE_KEY]).toBe('pas du json');
  });
});
