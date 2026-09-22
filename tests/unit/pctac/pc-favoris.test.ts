/**
 * pc-favoris.test.ts — Favoris de la main courante.
 *
 * Ce qui est verrouillé ici :
 *   - le STOCKAGE reste strictement chronologique. La remontée des favoris est
 *     un choix d'affichage ; si elle contaminait `Storage.saveLogData`, une
 *     archive relue ailleurs, ou un PDF, sortirait les faits dans le désordre.
 *   - à l'intérieur de chaque groupe (favoris, puis le reste), l'ordre
 *     chronologique est PRÉSERVÉ.
 *   - le filtre « favoris seuls » a son propre état vide : un journal filtré
 *     sans favori ne doit pas se lire comme un journal vide.
 *   - les séparateurs de jour disparaissent dès que l'ordre affiché n'est plus
 *     chronologique, sans quoi ils annonceraient un regroupement faux.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PctacLogEntry } from '@shared/types/contracts.js';

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
import { Storage } from '@pctac/storage.js';

function entry(id: string, heure: string, date: string, favori?: boolean): PctacLogEntry {
  return {
    id, heure, date, pax: 'Adversaire', paxMode: 'standard', paxColor: '',
    lieu: `lieu ${id}`, remarques: `remarque ${id}`,
    ...(favori === undefined ? {} : { favori }),
  };
}

function montrerLeTableau(): void {
  document.body.innerHTML = '<table id="logTable"><tbody></tbody></table>'
    + '<button id="favorisLogBtn"></button>';
  UI.initElements();
}

/** Identifiants des lignes réellement peintes, dans l'ordre affiché. */
function lignesAffichees(): string[] {
  return [...document.querySelectorAll<HTMLElement>('#logTable tbody tr[data-id]')]
    .map((tr) => tr.dataset.id ?? '');
}

beforeEach(() => {
  localStorage.clear();
  UI.logSortDesc = false;
  UI.logFavorisOnly = false;
  montrerLeTableau();
});

describe('marquage', () => {
  it('bascule le favori et le persiste sans toucher à l\'ordre du stockage', () => {
    Storage.saveLogData([entry('a', '08:00', '2026-09-22'), entry('b', '09:00', '2026-09-22')]);

    UI.toggleLogFavori('b');
    const apres = Storage.loadLogData();
    expect(apres.map((e) => e.id)).toEqual(['a', 'b']);
    expect(apres.find((e) => e.id === 'b')?.favori).toBe(true);

    UI.toggleLogFavori('b');
    expect(Storage.loadLogData().find((e) => e.id === 'b')?.favori).toBe(false);
  });

  it('ignore un identifiant inconnu au lieu de jeter', () => {
    Storage.saveLogData([entry('a', '08:00', '2026-09-22')]);
    expect(() => UI.toggleLogFavori('inexistant')).not.toThrow();
    expect(Storage.loadLogData()).toHaveLength(1);
  });
});

describe('affichage', () => {
  it('remonte les favoris en tête en gardant l\'ordre chronologique dans chaque groupe', () => {
    UI.renderLogTable([
      entry('a', '08:00', '2026-09-22'),
      entry('b', '09:00', '2026-09-22', true),
      entry('c', '10:00', '2026-09-22'),
      entry('d', '11:00', '2026-09-22', true),
    ]);
    expect(lignesAffichees()).toEqual(['b', 'd', 'a', 'c']);
  });

  it('laisse l\'ordre intact quand tout est favori', () => {
    UI.renderLogTable([
      entry('a', '08:00', '2026-09-22', true),
      entry('b', '09:00', '2026-09-22', true),
    ]);
    expect(lignesAffichees()).toEqual(['a', 'b']);
  });

  it('remonte les favoris APRÈS l\'inversion par heure, pas avant', () => {
    UI.logSortDesc = true;
    UI.renderLogTable([
      entry('a', '08:00', '2026-09-22'),
      entry('b', '09:00', '2026-09-22', true),
      entry('c', '10:00', '2026-09-22'),
    ]);
    // Inversion : c, b, a → puis remontée du favori : b, c, a.
    expect(lignesAffichees()).toEqual(['b', 'c', 'a']);
  });

  it('retire les séparateurs de jour dès qu\'un favori remonte', () => {
    const avecSeparateurs = (): number => document.querySelectorAll('#logTable tbody tr.log-day-sep').length;

    UI.renderLogTable([entry('a', '08:00', '2026-09-21'), entry('b', '09:00', '2026-09-22')]);
    expect(avecSeparateurs()).toBe(2);

    UI.renderLogTable([entry('a', '08:00', '2026-09-21'), entry('b', '09:00', '2026-09-22', true)]);
    expect(avecSeparateurs()).toBe(0);
  });
});

describe('filtre « favoris seuls »', () => {
  it('n\'affiche que les favoris et se lève proprement', () => {
    Storage.saveLogData([
      entry('a', '08:00', '2026-09-22'),
      entry('b', '09:00', '2026-09-22', true),
    ]);

    UI.toggleLogFavorisFilter();
    expect(UI.logFavorisOnly).toBe(true);
    expect(lignesAffichees()).toEqual(['b']);
    expect(document.getElementById('favorisLogBtn')?.getAttribute('aria-pressed')).toBe('true');

    // Filtre levé : tout revient, mais le favori reste en tête (remontée).
    UI.toggleLogFavorisFilter();
    expect(lignesAffichees()).toEqual(['b', 'a']);
    expect(document.getElementById('favorisLogBtn')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('distingue « aucun favori » de « journal vide »', () => {
    Storage.saveLogData([entry('a', '08:00', '2026-09-22')]);
    UI.toggleLogFavorisFilter();
    const texte = document.querySelector('#logTable tbody .empty-state')?.textContent ?? '';
    expect(texte).toContain('favori');
    expect(texte).not.toBe('Aucun événement enregistré');
  });
});
