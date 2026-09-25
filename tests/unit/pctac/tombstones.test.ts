/**
 * tombstones.test.ts — Pierres tombales des suppressions (revue du 25/09, A7,
 * décision de Nico) : par situation, datées, dédoublonnées, bornées.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { DELETED_KEY, ADVERSARIES_KEY, PHOTOS_KEY } from '@pctac/config.js';
import { scopedKey } from '@pctac/modes.js';
import { TOMBSTONES_MAX, readTombstones, recordTombstone, tombstoneMap } from '@pctac/tombstones.js';

beforeEach(() => { localStorage.clear(); });

describe('recordTombstone / readTombstones', () => {
  it('écrit une pierre tombale datée sous la clé de la situation', () => {
    recordTombstone(ADVERSARIES_KEY, 'a1', 'forcene', new Date('2026-09-25T10:00:00Z'));
    const list = readTombstones('forcene');
    expect(list).toEqual([{ id: `${ADVERSARIES_KEY}:a1`, key: ADVERSARIES_KEY, itemId: 'a1', deletedAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z' }]);
    expect(localStorage.getItem(scopedKey(DELETED_KEY, 'forcene'))).not.toBeNull();
    expect(localStorage.getItem(scopedKey(DELETED_KEY, 'tp'))).toBeNull();
  });

  it('même élément supprimé deux fois : une seule pierre, la plus récente', () => {
    recordTombstone(ADVERSARIES_KEY, 'a1', 'forcene', new Date('2026-09-25T10:00:00Z'));
    recordTombstone(ADVERSARIES_KEY, 'a1', 'forcene', new Date('2026-09-25T11:00:00Z'));
    const list = readTombstones('forcene');
    expect(list).toHaveLength(1);
    expect(list[0]?.deletedAt).toBe('2026-09-25T11:00:00.000Z');
  });

  it('bornée : au-delà du plafond, les plus anciennes sortent', () => {
    for (let i = 0; i < TOMBSTONES_MAX + 5; i++) recordTombstone(PHOTOS_KEY, `p${i}`, 'forcene', new Date(1_700_000_000_000 + i));
    const list = readTombstones('forcene');
    expect(list).toHaveLength(TOMBSTONES_MAX);
    expect(list[0]?.itemId).toBe('p5');
  });

  it('ignore une valeur illisible ou des entrées malformées', () => {
    localStorage.setItem(scopedKey(DELETED_KEY, 'forcene'), JSON.stringify([{ id: 'x' }, null, { id: 'k:a', key: 'k', itemId: 'a', deletedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]));
    expect(readTombstones('forcene')).toHaveLength(1);
    localStorage.setItem(scopedKey(DELETED_KEY, 'forcene'), 'pas du json');
    expect(readTombstones('forcene')).toEqual([]);
  });
});

describe('tombstoneMap', () => {
  it('rend id → date (ms) pour la clé demandée seulement', () => {
    recordTombstone(ADVERSARIES_KEY, 'a1', 'forcene', new Date('2026-09-25T10:00:00Z'));
    recordTombstone(PHOTOS_KEY, 'p1', 'forcene', new Date('2026-09-25T10:00:00Z'));
    const map = tombstoneMap(readTombstones('forcene'), ADVERSARIES_KEY);
    expect([...map.keys()]).toEqual(['a1']);
    expect(map.get('a1')).toBe(Date.parse('2026-09-25T10:00:00Z'));
  });
});

describe('Revue neuve du 25/09 — V6 : normalisation des pierres reçues', () => {
  it('borne une date future à maintenant, écarte les entrées invalides, plafonne', async () => {
    const { normalizeTombstones } = await import('@pctac/tombstones.js');
    const now = Date.parse('2026-09-25T12:00:00Z');
    const list = [
      { id: 'k:a', key: 'k', itemId: 'a', deletedAt: '9999-01-01T00:00:00Z', updatedAt: '9999-01-01T00:00:00Z' },
      { id: 'k:b', key: 'k', itemId: 'b', deletedAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z' },
      { id: 'k:c', key: 'k', itemId: 'c', deletedAt: 'pas une date', updatedAt: 'x' },
      null,
    ];
    const out = normalizeTombstones(list, now);
    expect(out.map((t) => t.itemId)).toEqual(['b', 'a']);
    expect(out[1]?.deletedAt).toBe('2026-09-25T12:00:00.000Z');
    expect(out[1]?.updatedAt).toBe('2026-09-25T12:00:00.000Z');
    const many = Array.from({ length: TOMBSTONES_MAX + 3 }, (_, i) => ({ id: `k:${i}`, key: 'k', itemId: `${i}`, deletedAt: new Date(1_700_000_000_000 + i).toISOString(), updatedAt: new Date(1_700_000_000_000 + i).toISOString() }));
    expect(normalizeTombstones(many, now)).toHaveLength(TOMBSTONES_MAX);
  });
});
