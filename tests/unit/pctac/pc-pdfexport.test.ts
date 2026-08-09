/**
 * pc-pdfexport.test.ts — Tests unitaires de PdfExport (P2.CONV).
 *
 * Contexte : IndexedDB est absent sous jsdom → `@pctac/image-store.js` est
 * mocké (passthrough, aucune hydratation réelle nécessaire pour ces tests :
 * `Storage.loadCollection` renvoie `[]` sur un localStorage vide). pdf-lib
 * est un calcul pur (pas d'API navigateur bloquante) : `buildPdf()` s'exécute
 * réellement sous jsdom. `URL.createObjectURL`/`revokeObjectURL`, absents de
 * jsdom, sont posés en beforeEach.
 *
 * Couverture demandée (mission P2.CONV) :
 *  1. sanitizeWinAnsi sur une chaîne à guillemets courbes / tiret cadratin /
 *     espace insécable / BOM — assertions caractère par caractère.
 *  2. cloneA4 : deux clones successifs du même tuple ne partagent PAS le
 *     même tableau (mutation du premier sans effet sur le second) — c'est le
 *     mécanisme appelé à chaque `addPage` (pdfExport.js:102-104, 161).
 *  3. La vue Plan est restaurée (switchMainView) même quand
 *     captureToDataUrl() jette pendant la génération.
 *  4. Aucune référence à `window.Dashboard` ne subsiste dans le fichier
 *     source (grep du fichier lui-même, section 7 supprimée).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    put: async (): Promise<void> => {},
    get: async (): Promise<string | null> => null,
    getMany: async (): Promise<Record<string, string | null>> => ({}),
    delete: async (): Promise<void> => {},
    deleteMany: async (): Promise<void> => {},
    clear: async (): Promise<void> => {},
    migrateFromLocalStorage: async (): Promise<void> => {},
    // Passthrough : pas d'IndexedDB sous jsdom, hydrate() est un no-op fidèle
    // au contrat (renvoie la liste telle quelle).
    hydrate: async <T,>(items: T[]): Promise<T[]> => items,
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  // jsdom n'implémente pas ces deux méthodes : indispensables au téléchargement
  // final de buildPdf() (pdfExport.js:583-587).
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock-url');
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  Reflect.deleteProperty(window, 'UI');
  Reflect.deleteProperty(window, 'PlanMap');
});

describe('sanitizeWinAnsi (P2.CONV)', () => {
  it('translittère guillemets courbes, tiret cadratin, espace insécable et BOM — caractère par caractère', async () => {
    const { sanitizeWinAnsi } = await import('@pctac/pdf-export.js');

    const LEFT_SINGLE_QUOTE = '‘';   // '
    const RIGHT_SINGLE_QUOTE = '’';  // '
    const EM_DASH = '—';             // —
    const NBSP = ' ';                // espace insécable
    const BOM = '﻿';                 // espace de largeur nulle / BOM

    const input = `${LEFT_SINGLE_QUOTE}bonjour${RIGHT_SINGLE_QUOTE}${EM_DASH}test${NBSP}ici${BOM}`;
    const out = sanitizeWinAnsi(input);

    // Reconstruction caractère par caractère de la sortie attendue :
    // ' -> "'", ' -> "'", — -> "-", (rien entre "test" et "ici" hors l'espace
    // insécable devenu un espace ASCII normal), BOM -> "" (supprimé).
    expect(out).toBe("'bonjour'-test ici");

    // Assertions position par position, pour lever toute ambiguïté sur les
    // caractères produits par la translittération.
    expect(out.charAt(0)).toBe("'");
    expect(out.charCodeAt(0)).toBe(0x27);
    expect(out.charAt(8)).toBe("'");
    expect(out.charCodeAt(8)).toBe(0x27);
    expect(out.charAt(9)).toBe('-');
    expect(out.charCodeAt(9)).toBe(0x2D);
    // L'espace insécable (U+00A0) est devenu un espace ASCII normal (U+0020).
    const spaceIndex = out.indexOf(' ', 10);
    expect(spaceIndex).toBeGreaterThan(0);
    expect(out.charCodeAt(spaceIndex)).toBe(0x20);
    // Le BOM (U+FEFF) a disparu : la chaîne se termine par "ici", rien après.
    expect(out.endsWith('ici')).toBe(true);
    expect(out.includes('﻿')).toBe(false);
    expect(out).not.toContain(LEFT_SINGLE_QUOTE);
    expect(out).not.toContain(RIGHT_SINGLE_QUOTE);
    expect(out).not.toContain(EM_DASH);
    expect(out).not.toContain(NBSP);
  });

  it('retourne une chaîne vide pour null/undefined et ne jette jamais', async () => {
    const { sanitizeWinAnsi } = await import('@pctac/pdf-export.js');
    expect(sanitizeWinAnsi(null)).toBe('');
    expect(sanitizeWinAnsi(undefined)).toBe('');
  });
});

describe('cloneA4 (P2.CONV)', () => {
  it('deux clones successifs du même tuple ne partagent pas le même tableau (piège pdfExport.js:102-104,161)', async () => {
    const { cloneA4 } = await import('@pctac/pdf-export.js');
    const source: [number, number] = [595.28, 841.89];

    const a = cloneA4(source);
    const b = cloneA4(source);

    expect(a).not.toBe(b); // pas la même référence
    expect(a).toEqual(b);  // mêmes valeurs

    // Mutation du premier clone : ne doit affecter ni le second, ni la source.
    a[0] = 999;
    expect(b[0]).toBe(595.28);
    expect(source[0]).toBe(595.28);
  });
});

describe('buildPdf — restauration de la vue Plan (P2.CONV)', () => {
  it('restaure la vue précédente même quand captureToDataUrl() jette pendant la génération', async () => {
    // Vue Plan présente mais pas active -> planHidden = true (pdfExport.js:407).
    document.body.innerHTML = '<div id="view-plan"></div>';
    localStorage.setItem('lastView', 'view-journal');

    const switchMainView = vi.fn();
    (window as unknown as { UI: { switchMainView: typeof switchMainView } }).UI = { switchMainView };
    (window as unknown as {
      PlanMap: {
        map: null;
        initialized: boolean;
        init: () => void;
        refresh: () => void;
        getPinsSummary: () => never[];
        captureToDataUrl: () => Promise<string | null>;
      };
    }).PlanMap = {
      map: null,
      initialized: true,
      init: () => {},
      refresh: () => {},
      getPinsSummary: () => [],
      captureToDataUrl: vi.fn().mockRejectedValue(new Error('capture KO')),
    };

    const { PdfExport } = await import('@pctac/pdf-export.js');

    // buildPdf() ne jette JAMAIS (contrat PdfExportContract) : la promesse
    // doit se résoudre même si captureToDataUrl() a rejeté en interne.
    await expect(PdfExport.buildPdf()).resolves.toBeUndefined();

    // La bascule vers 'view-plan' puis la restauration de 'view-journal' (la
    // vue de départ) doivent toutes deux avoir eu lieu, dans cet ordre.
    expect(switchMainView).toHaveBeenNthCalledWith(1, 'view-plan');
    expect(switchMainView).toHaveBeenNthCalledWith(2, 'view-journal');
  }, 10000);
});

describe('absence de window.Dashboard (P2.CONV)', () => {
  it('le fichier source pdf-export.ts ne référence plus window.Dashboard (section 7 supprimée)', () => {
    const path = resolve(process.cwd(), 'src/apps/pctac/pdf-export.ts');
    const source = readFileSync(path, 'utf-8');
    expect(source).not.toMatch(/Dashboard/);
  });
});
