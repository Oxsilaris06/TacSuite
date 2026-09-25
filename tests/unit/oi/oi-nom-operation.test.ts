/**
 * oi-nom-operation.test.ts — Champ « Nom de l'opération » (décision 43,
 * audit PDF du 2026-09-25, F19 et F24).
 *
 * `nom_operation` était lu par la couverture du PDF (« OP : - ») sans qu'aucun
 * champ ne le saisisse. Le champ, facultatif, vit à l'étape Situation ; il
 * suit le chemin générique du formulaire (Store, localStorage, archive
 * .oi.zip) ; la case « OP » de la couverture n'apparaît que s'il est rempli,
 * et tient dans la marge de sécurité de la page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';
import { pageGeometry } from '@oi/pdf/theme.js';
import type { OiFormData } from '@shared/types/contracts.js';

const HTML = readFileSync(join(process.cwd(), 'oi', 'index.html'), 'utf8');
const htmlDoc = new JSDOM(HTML).window.document;

/** Nœuds de la définition pdfmake qui satisfont `pred` (parcours profond). */
function findNodes(node: unknown, pred: (n: Record<string, unknown>) => boolean, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(node)) {
        node.forEach((n) => findNodes(n, pred, out));
    } else if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (pred(obj)) out.push(obj);
        Object.values(obj).forEach((v) => findNodes(v, pred, out));
    }
    return out;
}

/** Textes (feuilles) d'un sous-arbre, dans l'ordre. */
function texts(node: unknown): string[] {
    return findNodes(node, (n) => typeof n.text === 'string').map((n) => n.text as string);
}

function coverOf(formData: OiFormData): unknown {
    const dd = buildOiDocDefinition({ formData, photosBase64: {}, isDark: false }, { format: 'a4' });
    return (dd.content as unknown[])[0];
}

describe('Nom de l\'opération — formulaire', () => {
    it("l'étape Situation porte un champ texte facultatif, étiqueté, synchronisé avec le Store", () => {
        const input = htmlDoc.querySelector<HTMLInputElement>('#oi-form [data-oi-section="situation"] input#nom_operation');
        expect(input, 'champ #nom_operation à l\'étape Situation').not.toBeNull();
        expect(input!.type).toBe('text');
        expect(input!.required).toBe(false);
        expect(input!.dataset.action).toBe('sync-dom-to-store');
        expect(Number(input!.getAttribute('maxlength'))).toBeGreaterThan(0);
        const label = htmlDoc.querySelector('label[for="nom_operation"]');
        expect(label?.textContent).toMatch(/Nom de l'opération/);
        expect(label?.textContent).toMatch(/facultatif/i);
    });
});

describe("Nom de l'opération — Store et archive .oi.zip (aller et retour)", () => {
    /** Étape Situation RÉELLE de `oi/index.html` + conteneurs requis par `formulaires.ts`. */
    function setupDom(): void {
        const situation = htmlDoc.querySelector('[data-oi-section="situation"]')!.outerHTML;
        document.body.innerHTML = `
            <form id="oi-form">${situation}</form>
            <div id="time_events_container"></div>
            <div id="adversaries_container"></div>
            <div id="hypotheses_container"></div>
            <div id="moicp_container"></div>
            <div id="zmspcp_container"></div>
            <div id="effraction_container"></div>
            <div id="rame_vl_container"></div>
            <div id="colonne_progression_container"></div>
            <div id="ordre_penetration_container"></div>
            <div id="unassigned_members_container"></div>
            <div id="patracdvr_container"></div>
            <dialog id="importSelectModal">
                <div id="importSelectList"></div>
                <input id="importSelectAll" type="checkbox">
                <button id="importSelectConfirmBtn"></button>
                <button id="importSelectCancelBtn"></button>
                <button id="importSelectCloseBtn"></button>
            </dialog>`;
    }

    function stubCrossModuleWindow(): void {
        window.initializePatracdvr = vi.fn();
        window.updateArticulationDisplay = vi.fn();
        window.addMoicp = vi.fn();
        window.addZmspcp = vi.fn();
        window.addEffraction = vi.fn();
        window.refreshRameVL = vi.fn();
        window.refreshColonneProgression = vi.fn();
        window.refreshOrdrePenetration = vi.fn();
        window.syncAllThumbnails = vi.fn();
        window.updateCustomBgPreview = vi.fn(async () => { /* stub */ });
        window.removeImage = vi.fn(async () => { /* stub */ });
    }

    beforeEach(() => {
        setupDom();
        localStorage.clear();
        vi.resetModules();
        window.isFormLoading = false;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.isFormLoading = false;
    });

    it("saisi à l'écran, exporté en archive, réimporté ailleurs puis rechargé : le nom revient intact", async () => {
        const mod = await import('@oi/formulaires.js');
        stubCrossModuleWindow();
        const { Store } = await import('@oi/init.js');

        const input = document.getElementById('nom_operation') as HTMLInputElement;
        input.value = 'HIBOU 26 — Ζέτα';
        mod.flushFormData();
        expect(Store.state.formData.nom_operation).toBe('HIBOU 26 — Ζέτα');

        // Export : l'archive est capturée au lieu d'être téléchargée.
        let archive: Blob | null = null;
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: (b: Blob) => { archive = b; return 'blob:archive'; },
        });
        await window.exportArchive();
        expect(archive, 'archive produite').not.toBeNull();

        // Autre poste : stockage vide, import de l'archive (catégories toutes cochées).
        localStorage.clear();
        const importing = window.importArchive(new File([archive!], 'session.oi.zip'));
        await vi.waitFor(() => {
            expect(document.querySelectorAll('#importSelectList .import-cat-cb').length).toBeGreaterThan(0);
        });
        (document.getElementById('importSelectConfirmBtn') as HTMLButtonElement).click();
        await importing;
        const stored = JSON.parse(localStorage.getItem('tactical_oi_data') ?? '{}') as OiFormData;
        expect(stored.nom_operation).toBe('HIBOU 26 — Ζέτα');

        // Rechargement du formulaire : le champ est rempli.
        setupDom();
        window.isFormLoading = false;
        await window.loadFormData();
        expect((document.getElementById('nom_operation') as HTMLInputElement).value).toBe('HIBOU 26 — Ζέτα');
    });
});

describe("Nom de l'opération — couverture du PDF", () => {
    const geo = pageGeometry('a4');

    it('rempli : la case « OP » porte le nom et tient dans la marge de sécurité de la page', () => {
        const cover = coverOf({ nom_operation: 'HIBOU 26', date_op: '2026-09-25' });
        expect(texts(cover).some((t) => t.includes('HIBOU 26'))).toBe(true);
        const boxes = findNodes(cover, (n) => n.absolutePosition !== undefined && n.table !== undefined);
        expect(boxes).toHaveLength(1);
        const box = boxes[0]!;
        const pos = box.absolutePosition as { x: number; y: number };
        const widths = (box.table as { widths: number[] }).widths;
        // Largeur totale : colonne + marges internes (4 + 4) + filets (1 + 1).
        const outerWidth = widths.reduce((s, w) => s + w, 0) + 10;
        const [left, top, right] = geo.marginsPt;
        expect(pos.x).toBeGreaterThanOrEqual(left);
        expect(pos.x + outerWidth).toBeLessThanOrEqual(geo.widthPt - right + 0.01);
        expect(pos.y).toBeGreaterThanOrEqual(top);
    });

    it("vide : aucune ligne « OP : - », la date reste seule dans la case", () => {
        const cover = coverOf({ nom_operation: '   ', date_op: '2026-09-25' });
        const all = texts(cover);
        expect(all.some((t) => /^OP\b/.test(t))).toBe(false);
        expect(all.some((t) => t.startsWith('DATE'))).toBe(true);
    });

    it('ni nom ni date : pas de case du tout', () => {
        const cover = coverOf({});
        expect(findNodes(cover, (n) => n.absolutePosition !== undefined && n.table !== undefined)).toHaveLength(0);
        expect(texts(cover).some((t) => /^(OP|DATE)\b/.test(t))).toBe(false);
    });
});
