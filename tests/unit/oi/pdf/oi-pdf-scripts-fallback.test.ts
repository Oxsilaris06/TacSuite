/**
 * oi-pdf-scripts-fallback.test.ts — Écritures non latines dans le PDF de l'OI
 * (décision 44, audit PDF du 2026-09-25, F14).
 *
 * Passe sur la définition du document, après sa construction : chaque texte
 * est découpé en segments d'une seule police (JetBrains Mono NL ou Oswald,
 * puis Noto Sans, puis Noto Sans Arabic) ; ce qu'aucune police ne couvre est
 * annoncé AVANT la génération, puis remplacé (émoji retirés, reste « ? »).
 * Les polices de repli ne sont enregistrées dans pdfmake que si un texte en a
 * besoin. Vraies polices (fontkit), pdfmake simulé.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

const confirmSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@shared/pdf-unsupported-dialog.js', () => ({ confirmUnsupportedChars: confirmSpy }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', async (orig) => ({ ...(await orig<typeof import('@shared/feedback.js')>()), toast: toastSpy }));

import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';
import type { OiFormData } from '@shared/types/contracts.js';

function fakePdfMake() {
    return { addVirtualFileSystem: vi.fn(), addFonts: vi.fn() };
}

/** Module neuf à chaque test : la mémoire de session (confirmations) repart de zéro. */
async function load(): Promise<typeof import('@oi/pdf/scripts-fallback.js')> {
    vi.resetModules();
    return import('@oi/pdf/scripts-fallback.js');
}

function build(formData: OiFormData): TDocumentDefinitions {
    return buildOiDocDefinition({ formData, photosBase64: {}, isDark: false }, { format: 'a4' });
}

/** Segments `{ text, font }` d'un nœud texte (police héritée : `undefined`). */
type Seg = { text: string; font: string | undefined };
function segmentsOf(node: Record<string, unknown>): Seg[] {
    const t = node.text;
    if (typeof t === 'string') return [{ text: t, font: undefined }];
    if (Array.isArray(t)) {
        return t.flatMap((x): Seg[] => (typeof x === 'string'
            ? [{ text: x, font: undefined }]
            : segmentsOf(x as Record<string, unknown>).map((s) => ({ ...s, font: s.font ?? ((x as { font?: string }).font) }))));
    }
    return [];
}

/** Nœuds texte dont le texte complet (segments recollés) contient `needle`. */
function textNodes(root: unknown, needle: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    const walk = (n: unknown): void => {
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (!n || typeof n !== 'object') return;
        const o = n as Record<string, unknown>;
        if ('text' in o && segmentsOf(o).map((s) => s.text).join('').replace(/\u00a0/g, ' ').includes(needle)) out.push(o);
        Object.values(o).forEach(walk);
    };
    walk(root);
    return out;
}

const ADV = (nom: string) => ({ id: 'a1', nom_adversaire: nom, me_list: [], etat_esprit_list: [], volume_list: [], vehicules_list: [] });

beforeEach(() => {
    confirmSpy.mockReset();
    confirmSpy.mockResolvedValue(true);
});

describe('Écritures — texte latin', () => {
    it('document latin (accents, œ, guillemets) : définition inchangée, aucune police de repli', async () => {
        const { applyOiScriptFallback } = await load();
        const dd = build({ situation_generale: 'Élément « œuvre » — ÇA… 25 €', adversaries: [ADV('MARTIN Éloïse')] });
        const before = JSON.stringify(dd.content);
        const pdfMake = fakePdfMake();
        await applyOiScriptFallback(dd, pdfMake);
        expect(JSON.stringify(dd.content)).toBe(before);
        expect(pdfMake.addVirtualFileSystem).not.toHaveBeenCalled();
        expect(pdfMake.addFonts).not.toHaveBeenCalled();
        expect(confirmSpy).not.toHaveBeenCalled();
    });
});

describe('Écritures — polices de repli', () => {
    it('grec dans un titre Oswald : segment Noto Sans ; dans le corps : JetBrains Mono le couvre', async () => {
        const { applyOiScriptFallback } = await load();
        const dd = build({ adversaries: [{ ...ADV('ΖΕΤΑ Νίκος'), ma_list: ['Fuite par le jardin'] }] });
        const pdfMake = fakePdfMake();
        await applyOiScriptFallback(dd, pdfMake);
        // Titre de la page « Modes d'action » (h2 Oswald, en capitales).
        const title = textNodes(dd.content, "MODES D'ACTION — ΖΕΤΑ ΝΊΚΟΣ")[0]!;
        const segs = segmentsOf(title);
        expect(segs.find((s) => s.text.includes('MODES'))?.font).toBeUndefined();
        expect(segs.find((s) => s.text.includes('ΖΕΤΑ'))?.font).toBe('NotoSans');
        // Noto Sans en gras pour approcher la graisse d'Oswald Medium (comme la synthèse A3).
        const greekPart = (title.text as Record<string, unknown>[]).find((x) => typeof x === 'object' && String(x.text).includes('ΖΕΤΑ'))!;
        expect(greekPart.bold).toBe(true);
        // Corps (JetBrains Mono couvre le grec) : aucun découpage.
        const body = textNodes(dd.content, 'ΖΕΤΑ Νίκος').filter((n) => segmentsOf(n).every((s) => s.font === undefined));
        expect(body.length).toBeGreaterThan(0);
        // Noto Sans seulement (normal et gras), jamais l'arabe.
        const vfsKeys = pdfMake.addVirtualFileSystem.mock.calls.flatMap((c) => Object.keys(c[0] as object));
        expect(vfsKeys.sort()).toEqual(['NotoSans-400.ttf', 'NotoSans-700.ttf']);
        const families = pdfMake.addFonts.mock.calls.flatMap((c) => Object.keys(c[0] as object));
        expect(families).toEqual(['NotoSans']);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("arabe : segment Noto Sans Arabic d'un seul tenant (espaces insécables), enregistré seul", async () => {
        const { applyOiScriptFallback } = await load();
        const dd = build({ situation_generale: 'Contact : محمد بن علي au domicile' });
        const pdfMake = fakePdfMake();
        await applyOiScriptFallback(dd, pdfMake);
        const node = textNodes(dd.content, 'محمد بن علي')[0]!;
        const segs = segmentsOf(node);
        const arabic = segs.filter((s) => s.font === 'NotoSansArabic');
        expect(arabic).toHaveLength(1);
        expect(arabic[0]!.text).toBe('محمد\u00a0بن\u00a0علي');
        expect(segs.some((s) => s.font === undefined && s.text.includes('au domicile'))).toBe(true);
        const vfsKeys = pdfMake.addVirtualFileSystem.mock.calls.flatMap((c) => Object.keys(c[0] as object));
        expect(vfsKeys).toEqual(['NotoSansArabic-400.ttf']);
        expect(pdfMake.addFonts.mock.calls.flatMap((c) => Object.keys(c[0] as object))).toEqual(['NotoSansArabic']);
    });

    it("un segment garde le style de son morceau de texte (gras, couleur) : pdfmake l'oublierait dans un tableau imbriqué", async () => {
        const { applyOiScriptFallback } = await load();
        // « Situation générale » : valeur en gras (labelValue, valueBold).
        const dd = build({ situation_generale: 'Contact : محمد علي au domicile' });
        await applyOiScriptFallback(dd, fakePdfMake());
        const parent = textNodes(dd.content, 'SITUATION GÉNÉRALE : Contact')[0]!;
        const parts = parent.text as Record<string, unknown>[];
        // Aucun tableau imbriqué : chaque segment est un morceau à part entière.
        expect(parts.every((x) => typeof x === 'string' || !Array.isArray(x.text))).toBe(true);
        const valueParts = parts.filter((x) => typeof x === 'object' && /Contact|محمد|domicile/.test(String(x.text)));
        expect(valueParts.map((x) => x.font)).toEqual([undefined, 'NotoSansArabic', undefined]);
        valueParts.forEach((x) => expect(x.bold).toBe(true));
    });

    it("un texte dans une autre police que JetBrains Mono ou Oswald n'est pas touché (sa couverture est inconnue)", async () => {
        const { applyOiScriptFallback } = await load();
        const dd: TDocumentDefinitions = { content: [{ text: 'علي', font: 'Autre' }, { text: 'علي' }], defaultStyle: { font: 'JetBrainsMono' } };
        await applyOiScriptFallback(dd, fakePdfMake());
        const [autre, corps] = dd.content as unknown as Record<string, unknown>[];
        expect(autre!.text).toBe('علي');
        expect(segmentsOf(corps!).map((x) => x.font)).toEqual(['NotoSansArabic']);
    });

    it('cyrillique : couvert par JetBrains Mono (corps) et Oswald (titres), rien à faire', async () => {
        const { applyOiScriptFallback } = await load();
        const dd = build({ adversaries: [ADV('ИВАНОВ Пётр')] });
        const before = JSON.stringify(dd.content);
        const pdfMake = fakePdfMake();
        await applyOiScriptFallback(dd, pdfMake);
        expect(JSON.stringify(dd.content)).toBe(before);
        expect(pdfMake.addFonts).not.toHaveBeenCalled();
    });

    it('pied de page : trigramme et unité passent aussi par la chaîne de polices', async () => {
        const { applyOiScriptFallback } = await load();
        const dd = build({ unite_redacteur: 'وحدة', trigramme_redacteur: 'ABC' });
        await applyOiScriptFallback(dd, fakePdfMake());
        const footer = (dd.footer as (p: number, n: number, s: unknown) => Content)(2, 3, { width: 842, height: 595, orientation: 'landscape' });
        const node = textNodes(footer, 'وحدة')[0]!;
        expect(segmentsOf(node).find((s) => s.text.includes('وحدة'))?.font).toBe('NotoSansArabic');
    });
});

describe('Écritures — caractères sans police (chinois, émoji)', () => {
    it("avertissement AVANT la génération (où, quels caractères), puis chinois « ? » et émoji retirés", async () => {
        const { applyOiScriptFallback } = await load();
        const dd = build({ adversaries: [ADV('WANG 张伟 🔫')] });
        await applyOiScriptFallback(dd, fakePdfMake());
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        const [items] = confirmSpy.mock.calls[0] as unknown as [{ where: string; chars: string[] }[]];
        const item = items.find((i) => i.where.includes('WANG'))!;
        expect(item.chars).toEqual(['张', '伟', '🔫']);
        const json = JSON.stringify(dd.content);
        expect(json).toContain('WANG ??');
        expect(json).not.toMatch(/[张伟]|\u{1F52B}/u);
    });

    it("« Corriger la saisie » : la génération est annulée (erreur dédiée), rien n'est enregistré", async () => {
        const { applyOiScriptFallback, OiScriptsCancelledError } = await load();
        confirmSpy.mockResolvedValue(false);
        const dd = build({ adversaries: [ADV('WANG 张伟')] });
        const pdfMake = fakePdfMake();
        await expect(applyOiScriptFallback(dd, pdfMake)).rejects.toBeInstanceOf(OiScriptsCancelledError);
        expect(pdfMake.addFonts).not.toHaveBeenCalled();
    });

    it("mêmes caractères au rendu suivant (aperçu régénéré) : on ne redemande pas", async () => {
        const { applyOiScriptFallback } = await load();
        await applyOiScriptFallback(build({ adversaries: [ADV('WANG 张伟')] }), fakePdfMake());
        await applyOiScriptFallback(build({ adversaries: [ADV('WANG 张伟')] }), fakePdfMake());
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        await applyOiScriptFallback(build({ adversaries: [ADV('LI 李')] }), fakePdfMake());
        expect(confirmSpy).toHaveBeenCalledTimes(2);
    });
});

describe('Écritures — greffe dans le moteur (engine-v3 · buildOiPdfBlob)', () => {
    it("la définition passée à pdfmake porte les segments de repli, et la police arabe est enregistrée avant le rendu", async () => {
        vi.resetModules();
        const pdfMake = { addVirtualFileSystem: vi.fn(), addFonts: vi.fn(), createPdf: vi.fn(() => ({ getBlob: async () => new Blob(['%PDF']) })) };
        vi.doMock('pdfmake', () => ({ default: pdfMake }));
        try {
            const { buildOiPdfBlob } = await import('@oi/pdf/engine-v3.js');
            await buildOiPdfBlob({ formData: { situation_generale: 'Contact : محمد علي' }, photosBase64: {}, isDark: false }, { format: 'a4' });
            const dd = (pdfMake.createPdf.mock.calls[0] as unknown as [TDocumentDefinitions])[0];
            const node = textNodes(dd.content, 'محمد علي')[0]!;
            expect(segmentsOf(node).find((s) => s.text.includes('محمد'))?.font).toBe('NotoSansArabic');
            const arabicFonts = pdfMake.addFonts.mock.invocationCallOrder.filter((_o, i) => 'NotoSansArabic' in (pdfMake.addFonts.mock.calls[i]![0] as object));
            expect(arabicFonts).toHaveLength(1);
            expect(arabicFonts[0]!).toBeLessThan(pdfMake.createPdf.mock.invocationCallOrder[0]!);
        } finally {
            vi.doUnmock('pdfmake');
        }
    });
});

describe('R4 — « Corriger la saisie » au téléchargement', () => {
    it('sortie silencieuse : aucun message d’erreur, aucun fichier', async () => {
        vi.resetModules();
        const pdfMake = { addVirtualFileSystem: vi.fn(), addFonts: vi.fn(), createPdf: vi.fn(() => ({ getBlob: async () => new Blob(['%PDF']) })) };
        vi.doMock('pdfmake', () => ({ default: pdfMake }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        confirmSpy.mockResolvedValue(false);
        toastSpy.mockClear();
        try {
            const { downloadOiPdfV3 } = await import('@oi/pdf/engine-v3.js');
            await downloadOiPdfV3({ collect: async () => ({ formData: { adversaries: [ADV('WANG 张伟')] } as OiFormData, photosBase64: {}, isDark: false }) });
            expect(click).not.toHaveBeenCalled();
            expect(toastSpy.mock.calls.filter((c) => (c[1] as { kind?: string } | undefined)?.kind === 'error')).toEqual([]);
            expect(toastSpy).toHaveBeenCalledWith('Génération annulée.', { kind: 'info' });
        } finally {
            vi.doUnmock('pdfmake');
            vi.restoreAllMocks();
        }
    });
});
