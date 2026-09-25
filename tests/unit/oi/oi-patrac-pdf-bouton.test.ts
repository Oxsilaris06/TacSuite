/**
 * Bouton « PDF PATRACDVR » (`generatePatracdvrPdf`, décision 43) : le PDF
 * téléchargé est produit par le moteur de l'OI (pdfmake, polices embarquées),
 * à partir des membres affichés, véhicules ET non assignés, avec l'unité et la
 * date de l'opération saisies dans le formulaire.
 *
 * Seul le rendu du blob change de voie pour le test : sous Node, pdfmake se
 * charge par sa version serveur (polices lues sur disque) au lieu de la
 * version navigateur (polices embarquées en base64). Le document rendu est le
 * même.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({ confirmDialog: vi.fn(async () => true), toast: toastSpy, promptDialog: vi.fn(async () => null) }));

const FONTS = path.resolve(__dirname, '../../../src/apps/oi/pdf/fonts');

vi.mock('@oi/pdf/patrac-doc.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('@oi/pdf/patrac-doc.js')>();
    return {
        ...original,
        renderPatracPdfBlob: async (dd: TDocumentDefinitions): Promise<Blob> => {
            const pdfMake = (await import('pdfmake')).default as unknown as {
                virtualfs: { writeFileSync(name: string, data: Uint8Array): void };
                setFonts(f: unknown): void;
                createPdf(d: unknown): { getBuffer(): Promise<Uint8Array> };
            };
            // Octets recopiés dans un Uint8Array du domaine jsdom : pdfkit refuse
            // sinon le Buffer de Node (`instanceof Uint8Array` faux sous jsdom).
            const files = { 'O.ttf': 'oswald_500.ttf', 'J4.ttf': 'jetbrains_mono_400.ttf', 'J7.ttf': 'jetbrains_mono_700.ttf' };
            for (const [name, file] of Object.entries(files)) pdfMake.virtualfs.writeFileSync(name, new Uint8Array(readFileSync(path.join(FONTS, file))));
            pdfMake.setFonts({ Oswald: { normal: 'O.ttf', bold: 'O.ttf' }, JetBrainsMono: { normal: 'J4.ttf', bold: 'J7.ttf' } });
            const warn = console.warn;
            console.warn = () => {};
            try {
                return new Blob([new Uint8Array(await pdfMake.createPdf(dd).getBuffer())], { type: 'application/pdf' });
            } finally {
                console.warn = warn;
            }
        },
    };
});

async function pdfText(blob: Blob): Promise<string> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useWorkerFetch: false, disableFontFace: true }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    return parts.join(' ').replace(/\s+/g, ' ');
}

function memberHtml(d: Record<string, string>): string {
    const attrs = Object.entries(d).map(([k, v]) => `data-${k}="${v}"`).join(' ');
    return `<button type="button" class="patracdvr-member-btn" ${attrs}>${d.trigramme ?? ''}</button>`;
}

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
        <input id="date_op" type="date" value="2026-09-25">
        <input id="unite_redacteur" value="PSIG TESTVILLE">
        <div id="unassigned_members_container">${memberHtml({ trigramme: 'NAS', fonction: 'Équipier', principales: 'UMP9' })}</div>
        <div id="patracdvr_container">
            <div class="patracdvr-vehicle-row" data-vehicle-name="VL1">
                ${memberHtml({ trigramme: 'TAA', fonction: 'Chef de bord', tenue: 'Tenue d’intervention', equipement: 'Bélier œil-de-bœuf 250 €' })}
                ${memberHtml({ trigramme: 'ИВН', fonction: 'Équipier' })}
            </div>
        </div>`;
});

afterEach(() => {
    vi.restoreAllMocks();
    toastSpy.mockClear();
});

describe('generatePatracdvrPdf — PDF produit par le moteur de l’OI', () => {
    it('télécharge un PDF complet : caractères intacts, CONFIDENTIEL, unité, date, non assignés', async () => {
        const blobs: Blob[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:patrac'; });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const names: string[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });

        await import('@oi/patrac.js');
        await window.generatePatracdvrPdf();

        expect(names).toEqual(['PATRACDVR_2026-09-25.pdf']);
        const blob = blobs[0];
        if (!blob) throw new Error('aucun PDF produit');
        const text = await pdfText(blob);
        expect(text).toContain('Tenue d’intervention');
        expect(text).toContain('Bélier œil-de-bœuf 250 €');
        expect(text).toContain('ИВН');
        expect(text).toContain('CONFIDENTIEL');
        expect(text).toContain('PSIG TESTVILLE');
        expect(text).toContain('25/09/2026');
        expect(text).toMatch(/NON ASSIGNÉS.*NAS/);
    });

    it('sans aucun membre : message clair, aucun téléchargement', async () => {
        document.body.innerHTML = '<div id="unassigned_members_container"></div><div id="patracdvr_container"><div class="patracdvr-vehicle-row" data-vehicle-name="VL1"></div></div>';
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        await import('@oi/patrac.js');
        await window.generatePatracdvrPdf();

        expect(click).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith('Aucun membre dans le PATRACDVR.', { kind: 'error' });
    });
});
