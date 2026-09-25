/**
 * pc-situation-cloison.test.ts — Cloisonnement des données par situation (D1).
 *
 * Verrouille la règle métier : chaque situation (Forcené, TP, Recherche,
 * Événement) est un espace de travail INDÉPENDANT. Ces tests couvrent le
 * point d'entrée unique `scopedKey`, l'isolement des collections, l'export et
 * l'import d'archive par situation, et la réinitialisation d'une seule
 * situation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { ADVERSARIES_KEY, LOCAL_STORAGE_KEY } from '@pctac/config.js';
import { GPX_INDEX_KEY } from '@pctac/planmap/constants.js';
import { PCTAC_MODE_KEY, SHARED_KEYS, persistModeId, scopedKey } from '@pctac/modes.js';
import { Storage, clearSituationData } from '@pctac/storage.js';

// --- Mock ImageStore : indexedDB absent sous jsdom.
vi.mock('@pctac/image-store.js', () => ({
    GpxStore: {
        async put(): Promise<void> { /* no-op */ },
        async get(): Promise<null> { return null; },
        async delete(): Promise<void> { /* no-op */ },
        async clear(): Promise<void> { /* no-op */ },
    },
    ImageStore: {
        async put(): Promise<void> { /* no-op */ },
        async get(): Promise<null> { return null; },
        async getMany(): Promise<Record<string, null>> { return {}; },
        async delete(): Promise<void> { /* no-op */ },
        async deleteMany(): Promise<void> { /* no-op */ },
        async clear(): Promise<void> { /* no-op */ },
        async migrateFromLocalStorage(): Promise<void> { /* no-op */ },
        async hydrate<T>(items: T[]): Promise<T[]> { return items; },
    },
}));

const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@shared/feedback.js', () => ({
    confirmDialog: confirmSpy,
    toast: vi.fn(),
}));

import { Archive } from '@pctac/archive.js';

/** Construit un `.pctac.zip` minimal (même forme que Archive.exportZip). */
async function buildZip(manifest: Record<string, unknown>, data: Record<string, string>): Promise<File> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('data.json', JSON.stringify(data));
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return new File([buf], 'test.pctac.zip');
}

beforeEach(() => {
    localStorage.clear();
    confirmSpy.mockClear();
    confirmSpy.mockResolvedValue(true);
    document.body.innerHTML = '';
});

describe('scopedKey — point d entrée unique du cloisonnement', () => {
    it('rend la clé nue en Forcené (zéro migration pour les postes existants)', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        expect(scopedKey('pcTacAdversaries')).toBe('pcTacAdversaries');
        expect(scopedKey(LOCAL_STORAGE_KEY)).toBe(LOCAL_STORAGE_KEY);
    });

    it('suffixe @<situation> hors Forcené, pour une situation explicite', () => {
        expect(scopedKey('pcTacAdversaries', 'tp')).toBe('pcTacAdversaries@tp');
        expect(scopedKey('pcTacLogData', 'recherche')).toBe('pcTacLogData@recherche');
    });

    it('ne suffixe JAMAIS une clé commune', () => {
        ['theme', 'lastView', 'lastPhotoFilter', 'pcTacMode', 'pcTacSplit'].forEach((k) => {
            expect(SHARED_KEYS.has(k)).toBe(true);
            expect(scopedKey(k, 'tp')).toBe(k);
            expect(scopedKey(k, 'evenement')).toBe(k);
        });
    });
});

describe('isolement des collections par situation', () => {
    it('une fiche TP est absente en Forcené et présente en TP', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'tp1', nom: 'Ennemi' }]);

        // Changement de situation DANS la page (autre onglet interdit) : c'est
        // `persistModeId` qui réoriente les écritures.
        persistModeId('forcene');
        expect(Storage.loadCollection(ADVERSARIES_KEY)).toEqual([]);

        persistModeId('tp');
        expect(Storage.loadCollection(ADVERSARIES_KEY).map((i) => i.id)).toEqual(['tp1']);
    });
});

describe('export — situation courante seule', () => {
    it('embarque le champ situation et exclut les données des autres situations', async () => {
        // Une donnée Forcené (clé nue) qui ne doit PAS partir dans l'export TP.
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([{ id: 'forcene1', nom: 'Adversaire' }]));
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 'tp1', nom: 'Ennemi' }]);

        // Capture du Blob produit par l'export (jsdom ne crée pas d'URL blob).
        let captured: Blob | null = null;
        const createUrl = vi.fn((b: Blob) => { captured = b; return 'blob:test'; });
        const revokeUrl = vi.fn();
        vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });

        try {
            await Archive.exportZip();
        } finally {
            vi.unstubAllGlobals();
        }

        expect(captured).not.toBeNull();
        const zip = await JSZip.loadAsync(await (captured as unknown as Blob).arrayBuffer());
        const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { situation?: string };
        const data = JSON.parse(await zip.file('data.json')!.async('string')) as Record<string, string>;

        expect(manifest.situation).toBe('tp');
        // Clés LOGIQUES dans data.json (portables), valeurs de la situation TP.
        expect(data[ADVERSARIES_KEY]).toContain('tp1');
        expect(data[ADVERSARIES_KEY]).not.toContain('forcene1');
    });
});

describe('import — l archive atterrit dans SA situation', () => {
    it('une archive situation:"recherche" écrit sous @recherche, pas dans la situation courante', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'forcene');
        confirmSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // import puis refus de basculer

        const file = await buildZip(
            { appName: 'PC TAC', version: 1, situation: 'recherche' },
            { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'r1', nom: 'Recherché' }]) },
        );
        const result = await Archive.importFile(file);

        expect(result.ok).toBe(true);
        expect(localStorage.getItem(ADVERSARIES_KEY + '@recherche')).toContain('r1');
        // La situation courante (Forcené) n a pas été touchée.
        expect(localStorage.getItem(ADVERSARIES_KEY)).toBeNull();
        expect(localStorage.getItem(PCTAC_MODE_KEY)).toBe('forcene');
    });

    it('une archive SANS situation va en Forcené, même si le poste affiche une autre situation', async () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        confirmSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        const file = await buildZip(
            { appName: 'PC TAC', version: 1 },
            { [ADVERSARIES_KEY]: JSON.stringify([{ id: 'f1', nom: 'Ancien' }]) },
        );
        const result = await Archive.importFile(file);

        expect(result.ok).toBe(true);
        expect(localStorage.getItem(ADVERSARIES_KEY)).toContain('f1');
        expect(localStorage.getItem(ADVERSARIES_KEY + '@tp')).toBeNull();
    });
});

describe('clearAllData — situation courante seule', () => {
    it('en TP, laisse intactes les clés Forcené', () => {
        localStorage.setItem(ADVERSARIES_KEY, JSON.stringify([{ id: 'f1' }]));
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([{ id: 'f2' }]));

        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        Storage.saveCollection(ADVERSARIES_KEY, [{ id: 't1' }]);
        Storage.saveLogData([{ id: 't2', heure: '10:00', pax: 'X', paxMode: 'standard', lieu: '', remarques: '' }]);

        Storage.clearAllData();

        // TP vidé…
        expect(localStorage.getItem(ADVERSARIES_KEY + '@tp')).toBeNull();
        expect(localStorage.getItem(LOCAL_STORAGE_KEY + '@tp')).toBeNull();
        // …Forcené intact.
        expect(localStorage.getItem(ADVERSARIES_KEY)).toContain('f1');
        expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toContain('f2');
    });

    it('efface aussi l\'index GPX de la situation courante, mais pas celui d\'une autre', () => {
        localStorage.setItem(GPX_INDEX_KEY, JSON.stringify([{ id: 'f-gpx' }]));
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        localStorage.setItem(scopedKey(GPX_INDEX_KEY, 'tp'), JSON.stringify([{ id: 't-gpx' }]));

        Storage.clearAllData();

        // Le reset est censé effacer les traces de la situation visée (comportement
        // historique de main.ts : `localStorage.removeItem(GPX_INDEX_KEY)`).
        expect(localStorage.getItem(scopedKey(GPX_INDEX_KEY, 'tp'))).toBeNull();
        // L'index Forcené (clé nue) survit.
        expect(localStorage.getItem(GPX_INDEX_KEY)).toContain('f-gpx');
    });

    it('clearSituationData n\'efface PAS l\'index GPX (un import ne doit pas perdre les traces)', () => {
        localStorage.setItem(PCTAC_MODE_KEY, 'tp');
        localStorage.setItem(scopedKey(GPX_INDEX_KEY, 'tp'), JSON.stringify([{ id: 't-gpx' }]));

        clearSituationData('tp');

        expect(localStorage.getItem(scopedKey(GPX_INDEX_KEY, 'tp'))).toContain('t-gpx');
    });
});
