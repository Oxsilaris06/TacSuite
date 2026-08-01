/**
 * pc-archive.test.ts — Tests unitaires de Archive (P2.CONV).
 *
 * Port TypeScript testé : src/apps/pctac/archive.ts (Archive: ArchiveContract),
 * port de modules/pctac/archive.js (GStart-main, 459 LOC).
 *
 * Contexte : indexedDB n'existe pas en jsdom (SPEC-PCTAC-CONVERSION.md §8.4) —
 * `@pctac/image-store.js` est mocké par un store en mémoire (`vi.mock`).
 * `confirm`/`alert` sont stubés (`vi.stubGlobal`).
 *
 * Couverture exigée par la mission P2.CONV :
 *  - manifest invalide (absent / mauvaise appName) ⇒ refus ET localStorage
 *    strictement inchangé (archive.js:129-147).
 *  - échec en cours d'import ⇒ rollback complet, localStorage ET images
 *    IndexedDB restaurés à l'identique (archive.js:160-232).
 *  - l'import accepte une image nommée .txt COMME .bin (archive.js:218).
 *  - passerelle OI : dédoublonnage par nom normalisé (existant + intra-batch,
 *    trigrammes) et repli sur le nom d'image non encodé (archive.js:369-370).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { ADVERSARIES_KEY, LOCAL_STORAGE_KEY } from '@pctac/config.js';

// --- Mock ImageStore : indexedDB absent sous jsdom. Store en mémoire, avec un
// interrupteur `failClearOnce` pour simuler un échec ponctuel de clear() (test
// de rollback). `vi.hoisted` : la factory de vi.mock est hissée en tête de
// module, elle ne peut référencer que des valeurs elles-mêmes hissées.
const imageStoreState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failClearOnce: false,
}));

vi.mock('@pctac/image-store.js', () => {
  const { store } = imageStoreState;
  return {
    ImageStore: {
      async put(id: string, dataUrl: string): Promise<void> {
        if (!id || !dataUrl) return;
        store.set(id, dataUrl);
      },
      async get(id: string): Promise<string | null> {
        if (!id) return null;
        return store.has(id) ? (store.get(id) ?? null) : null;
      },
      async getMany(ids: readonly string[]): Promise<Record<string, string | null>> {
        const out: Record<string, string | null> = {};
        ids.forEach((id) => { out[id] = store.has(id) ? (store.get(id) ?? null) : null; });
        return out;
      },
      async delete(id: string): Promise<void> {
        store.delete(id);
      },
      async deleteMany(ids: readonly string[]): Promise<void> {
        ids.forEach((id) => store.delete(id));
      },
      async clear(): Promise<void> {
        if (imageStoreState.failClearOnce) {
          imageStoreState.failClearOnce = false;
          throw new Error('IDB indisponible (simulation de test)');
        }
        store.clear();
      },
      async migrateFromLocalStorage(): Promise<void> {
        // no-op : non exercé par ces tests.
      },
      async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> {
        return items;
      },
    },
  };
});

// Imports APRÈS vi.mock (hissé de toute façon, mais garde l'ordre lisible).
import { Archive } from '@pctac/archive.js';
import { ImageStore } from '@pctac/image-store.js';
import { Storage } from '@pctac/storage.js';

/** Dump complet de localStorage (toutes clés), pour comparaison avant/après. */
function dumpLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k != null) out[k] = localStorage.getItem(k) ?? '';
  }
  return out;
}

interface PctacZipOptions {
  /** `undefined` = manifest PC TAC valide par défaut ; `null` = OMET manifest.json. */
  manifest?: Record<string, unknown> | null;
  data?: Record<string, string>;
  /** nom de fichier (sous `images/`) → contenu texte (dataURL brut, comme l'export). */
  images?: Record<string, string>;
}

/** Construit un `.pctac.zip` de test (même structure que Archive.exportZip). */
async function buildPctacZip(opts: PctacZipOptions = {}): Promise<File> {
  const zip = new JSZip();
  if (opts.manifest !== null) {
    const manifest = opts.manifest ?? { appName: 'PC TAC', version: 1, createdAt: new Date().toISOString() };
    zip.file('manifest.json', JSON.stringify(manifest));
  }
  zip.file('data.json', JSON.stringify(opts.data ?? {}));
  if (opts.images) {
    const folder = zip.folder('images');
    if (folder) {
      Object.entries(opts.images).forEach(([relName, content]) => {
        folder.file(relName, content);
      });
    }
  }
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buf], 'test.pctac.zip');
}

interface OiZipOptions {
  /** `undefined` = manifest OI valide par défaut ; `null` = OMET manifest.json. */
  manifest?: Record<string, unknown> | null;
  oiData: Record<string, unknown>;
  imagesMeta?: Record<string, string>;
  /** nom de fichier (sous `images/`) → contenu BASE64 des octets de l'image. */
  imageFiles?: Record<string, string>;
}

/** Construit un `.oi.zip` de test (data.json.tactical_oi_data = JSON.stringify(oiData)). */
async function buildOiZip(opts: OiZipOptions): Promise<File> {
  const zip = new JSZip();
  if (opts.manifest !== null) {
    const manifest = opts.manifest ?? { appName: 'OI' };
    zip.file('manifest.json', JSON.stringify(manifest));
  }
  zip.file('data.json', JSON.stringify({ tactical_oi_data: JSON.stringify(opts.oiData) }));
  if (opts.imagesMeta) zip.file('images.json', JSON.stringify(opts.imagesMeta));
  if (opts.imageFiles) {
    const folder = zip.folder('images');
    if (folder) {
      Object.entries(opts.imageFiles).forEach(([relName, content]) => {
        folder.file(relName, content, { base64: true });
      });
    }
  }
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buf], 'test.oi.zip');
}

beforeEach(() => {
  localStorage.clear();
  imageStoreState.store.clear();
  imageStoreState.failClearOnce = false;
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Archive — window.Archive posé au scope module (archive.js:459)', () => {
  it('window.Archive est défini et référence la même instance', () => {
    expect((window as unknown as Record<string, unknown>).Archive).toBe(Archive);
  });
});

describe('importFile — validation du manifest AVANT toute modification (archive.js:129-147)', () => {
  it('refuse une archive sans manifest.json et ne modifie pas localStorage', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: '1', heure: '10:00', pax: 'X', paxMode: 'standard', lieu: '', remarques: '' }]));
    localStorage.setItem('pcTacPlanLocked', 'true');
    const before = dumpLocalStorage();

    const file = await buildPctacZip({ manifest: null, data: { [LOCAL_STORAGE_KEY]: JSON.stringify([{ id: 'x' }]) } });

    await expect(Archive.importFile(file)).rejects.toThrow(/manifest\.json/);
    expect(dumpLocalStorage()).toEqual(before);
  });

  it('refuse une archive dont le manifest appName n\'est pas "PC TAC" et ne modifie pas localStorage', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: '1' }]));
    const before = dumpLocalStorage();

    const file = await buildPctacZip({ manifest: { appName: 'OI' }, data: { [LOCAL_STORAGE_KEY]: JSON.stringify([{ id: 'y' }]) } });

    await expect(Archive.importFile(file)).rejects.toThrow(/OI/);
    expect(dumpLocalStorage()).toEqual(before);
  });

  it('annule proprement si l\'utilisateur refuse la confirmation : aucune modification', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: '1' }]));
    const before = dumpLocalStorage();
    vi.stubGlobal('confirm', vi.fn(() => false));

    const file = await buildPctacZip({ data: { [LOCAL_STORAGE_KEY]: JSON.stringify([{ id: 'z' }]) } });

    const result = await Archive.importFile(file);
    expect(result).toEqual({ ok: false, cancelled: true });
    expect(dumpLocalStorage()).toEqual(before);
  });
});

describe('importFile — double snapshot + rollback intégral sur échec (archive.js:160-232)', () => {
  it('restaure localStorage ET les images IndexedDB si ImageStore.clear() échoue après l\'écriture localStorage', async () => {
    // État "terrain" avant import.
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'Existant', hasImage: true }]);
    await ImageStore.put('a1', 'data:image/png;base64,AAA=');
    await ImageStore.put('a1_sync', 'data:image/png;base64,BBB=');
    const before = dumpLocalStorage();

    imageStoreState.failClearOnce = true;

    const file = await buildPctacZip({
      data: { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'zzz', nom: 'Archive' }]) },
    });

    const result = await Archive.importFile(file);
    expect(result.ok).toBe(false);

    // localStorage restauré à l'identique (y compris ADVERSARIES_KEY écrasé
    // puis rollback).
    expect(dumpLocalStorage()).toEqual(before);
    // Images IndexedDB restaurées (double snapshot, archive.js:160-166).
    expect(await ImageStore.get('a1')).toBe('data:image/png;base64,AAA=');
    expect(await ImageStore.get('a1_sync')).toBe('data:image/png;base64,BBB=');
  });

  it('restaure localStorage si l\'écriture localStorage elle-même échoue (quota)', async () => {
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'field1', nom: 'Original' }]);
    const before = dumpLocalStorage();

    const file = await buildPctacZip({
      data: { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'from-archive' }]) },
    });

    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError (simulation)');
    });

    const result = await Archive.importFile(file);
    expect(result.ok).toBe(false);
    expect(dumpLocalStorage()).toEqual(before);

    setItemSpy.mockRestore();
  });
});

describe('importFile — accepte les images .txt ET .bin (archive.js:218)', () => {
  it('restaure une image nommée <id>.txt ET une nommée <id>.bin, extension retirée', async () => {
    const file = await buildPctacZip({
      images: {
        'idtxt.txt': 'data:image/png;base64,AAAA',
        'idbin.bin': 'data:image/png;base64,BBBB',
      },
    });

    const result = await Archive.importFile(file);
    expect(result).toEqual({ ok: true });

    expect(await ImageStore.get('idtxt')).toBe('data:image/png;base64,AAAA');
    expect(await ImageStore.get('idbin')).toBe('data:image/png;base64,BBBB');
  });
});

describe('importOiArchive — passerelle OI → PC-Tac (archive.js:279-456)', () => {
  it('dédoublonne les adversaires par nom normalisé (existant + intra-batch) et les trigrammes PATRACDVR', async () => {
    // Adversaire déjà saisi sur le terrain (accents/casse différents de l'OI).
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'field1', nom: 'dupont', prenom: '' }]);

    const oiData = {
      adversaries: [
        { id: 'adv1', nom_adversaire: 'Dupont' }, // doublon avec l'existant (accents/casse)
        { id: 'adv2', nom_adversaire: 'Martin' },
        { id: 'adv3', nom_adversaire: 'Martin' }, // doublon intra-batch
      ],
      patracdvr_rows: [
        { members: [{ trigramme: 'ABC' }, { trigramme: 'N/A' }] },
      ],
      patracdvr_unassigned: [{ trigramme: 'abc' }], // doublon (casse) avec ABC
    };

    const file = await buildOiZip({ oiData });
    const result = await Archive.importOiArchive(file);

    expect(result.ok).toBe(true);
    expect(result.advAdded).toBe(1); // seul "Martin" est ajouté
    expect(result.advSkipped).toBe(2); // Dupont (déjà présent) + Martin (doublon intra-batch)
    expect(result.paxAdded).toBe(1); // ABC
    expect(result.paxSkipped).toBe(2); // N/A + abc (doublon de ABC)

    const finalAdv = Storage.loadCollection(ADVERSARIES_KEY);
    expect(finalAdv).toHaveLength(2);
  });

  it('lit la photo via images/<encodeURIComponent(id)>.bin, avec repli sur le nom NON encodé', async () => {
    const oiData = {
      adversaries: [{ id: 'adv1', nom_adversaire: 'Sans Photo Encodee' }],
      dynamic_photos: { photo_main_adv1: [{ id: 'img 1' }] }, // id avec espace → nécessite encodage
    };

    const file = await buildOiZip({
      oiData,
      imagesMeta: { 'img 1': 'image/png' },
      // Stocké SOUS LE NOM NON ENCODÉ : 'images/img 1.bin' (pas 'images/img%201.bin').
      imageFiles: { 'img 1.bin': Buffer.from('hello').toString('base64') },
    });

    const result = await Archive.importOiArchive(file);
    expect(result.ok).toBe(true);
    expect(result.advPhotos).toBe(1);

    const advList = Storage.loadCollection(ADVERSARIES_KEY);
    const added = advList.find((a) => a.nom === 'Sans Photo Encodee');
    expect(added).toBeDefined();
    if (!added) return;
    expect(added.hasImage).toBe(true);
    expect(await ImageStore.get(added.id)).toBe('data:image/png;base64,' + Buffer.from('hello').toString('base64'));
  });
});
