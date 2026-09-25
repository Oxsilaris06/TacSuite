/**
 * pc-pdf-ecritures.test.ts — Écritures non latines du rapport complet PC-Tac
 * (décision 44, audit PDF du 2026-09-25, constat M10) :
 *  - chaîne de repli : JetBrains Mono NL puis Noto Sans (cyrillique absent de
 *    JetBrains) puis Noto Sans Arabic pour le corps ; Oswald, Noto Sans,
 *    JetBrains Mono NL pour les titres ;
 *  - polices de repli embarquées seulement si un texte en a besoin ;
 *  - mesure par segments : wrapText et fitTextToWidth tiennent la largeur ;
 *  - « ? » seulement pour ce qu'aucune police ne couvre, émoji retirés ;
 *  - avertissement (confirmUnsupportedChars) AVANT la génération.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { generatePdfBytes, pdfPagesText } from './pdf-test-helpers.js';

vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        getMany: async (): Promise<Record<string, string | null>> => ({}),
        hydrate: async <T,>(items: T[]): Promise<T[]> => items,
    },
    GpxStore: { get: async (): Promise<null> => null },
}));
const confirmSpy = vi.hoisted(() => vi.fn(async (items: unknown) => items !== null));
vi.mock('@shared/pdf-unsupported-dialog.js', () => ({ confirmUnsupportedChars: confirmSpy }));

const OPTS = { kind: 'complet', theme: 'clair', sortie: 'impression' } as const;

beforeEach(() => {
    localStorage.clear();
    confirmSpy.mockClear();
    confirmSpy.mockImplementation(async () => true);
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'PlanMap');
});

const set = (key: string, value: unknown): void => localStorage.setItem(key, JSON.stringify(value));
const log = (remarques: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ id: 'e1', heure: '08:15', date: '2026-09-25', pax: 'Inter', paxMode: 'standard', lieu: 'PC', remarques, ...extra });

/** Noms des polices embarquées (BaseFont, préfixe de sous-ensemble compris). */
async function fontNames(bytes: Uint8Array): Promise<string[]> {
    const doc = await PDFDocument.load(bytes);
    const names = new Set<string>();
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
        const base = obj.get(PDFName.of('BaseFont'));
        if (base) names.add(base.toString().replace(/^\/([A-Z]{6}\+)?/, ''));
    }
    return [...names];
}

async function extraBytes(): Promise<{ notoRegular: Uint8Array; notoBold: Uint8Array; notoArabic: Uint8Array }> {
    const { loadExtraFontVfs, EXTRA_FONT_KEYS, base64ToBytes } = await import('@shared/pdf-fonts/index.js');
    const vfs = await loadExtraFontVfs();
    return {
        notoRegular: base64ToBytes(vfs[EXTRA_FONT_KEYS.notoRegular]!),
        notoBold: base64ToBytes(vfs[EXTRA_FONT_KEYS.notoBold]!),
        notoArabic: base64ToBytes(vfs[EXTRA_FONT_KEYS.notoArabic]!),
    };
}

describe('polices de repli dans le rapport complet', () => {
    it('arabe : Noto Sans Arabic embarquée, plus de « ? » à la place du nom', async () => {
        set('pcTacLogData', [log('Témoin محمد عبد الله à la fenêtre')]);
        const bytes = (await generatePdfBytes({ ...OPTS }))!;
        expect((await fontNames(bytes)).some((n) => n.includes('NotoSansArabic'))).toBe(true);
        const [page] = await pdfPagesText(bytes);
        expect(page).toContain('Témoin');
        expect(page).not.toContain('?');
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('cyrillique absent de JetBrains (kazakh) : Noto Sans embarquée, lettre imprimée', async () => {
        set('pcTacAdversaries', [{ id: 'a1', nom: 'ҚАСЫМОВ', prenom: 'Ерғали' }]);
        const bytes = (await generatePdfBytes({ ...OPTS }))!;
        expect((await fontNames(bytes)).some((n) => n.startsWith('NotoSans-'))).toBe(true);
        const text = (await pdfPagesText(bytes)).join(' ').replace(/\s+/g, '');
        expect(text).toContain('ҚАСЫМОВЕрғали');
        expect(text).not.toContain('?');
    });

    it('latin seul : aucune police de repli embarquée', async () => {
        set('pcTacLogData', [log('Arrivée, RAS — Ωμέγα et Щука restent en JetBrains Mono')]);
        const names = await fontNames((await generatePdfBytes({ ...OPTS }))!);
        expect(names.filter((n) => /Noto/.test(n))).toEqual([]);
    });
});

describe('avertissement avant la génération', () => {
    it('chinois et émoji : le champ et les caractères sont nommés, « Corriger la saisie » n’exporte rien', async () => {
        set('pcTacLogData', [log('Suspect 张伟 🚓 vu')]);
        const capture = vi.fn(async () => null);
        Reflect.set(window, 'PlanMap', { captureToDataUrl: capture, getPinsSummary: () => [] });
        confirmSpy.mockImplementation(async () => false);
        expect(await generatePdfBytes({ ...OPTS })).toBeNull();
        expect(confirmSpy).toHaveBeenCalledWith([{ where: 'Main courante 08:15 — Remarques', chars: ['张', '伟', '🚓'] }]);
        // Rien de lourd avant la réponse : la carte n'a pas été capturée.
        expect(capture).not.toHaveBeenCalled();
    });

    it('« Générer quand même » : émoji retirés, le reste imprimé « ? »', async () => {
        set('pcTacLogData', [log('Suspect 张伟 🚓 vu')]);
        const [page] = await pdfPagesText((await generatePdfBytes({ ...OPTS }))!);
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(page).toContain('Suspect ?? vu');
    });
});

describe('mesure par segments', () => {
    it('wrapText et fitTextToWidth tiennent la largeur quand l’arabe est plus large que la chasse de JetBrains', async () => {
        const { embedReportFonts, wrapText, fitTextToWidth } = await import('@pctac/pdf-export.js');
        const extras = await extraBytes();
        const doc = await PDFDocument.create();
        const fonts = await embedReportFonts(doc, { notoArabic: extras.notoArabic });
        const arabic = await doc.embedFont(extras.notoArabic); // mêmes chasses que la police de repli
        const lines = wrapText('ششش '.repeat(40).trim(), 200, fonts.font, 9);
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) expect(arabic.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(200);
        const fitted = fitTextToWidth('ششش'.repeat(30), fonts.font, 9, 100);
        expect(fitted.endsWith('…')).toBe(true);
        expect(arabic.widthOfTextAtSize(fitted.slice(0, -1), 9) + fonts.font.widthOfTextAtSize('…', 9)).toBeLessThanOrEqual(100);
    });
});

describe('chaîne des titres', () => {
    it('Oswald, puis Noto Sans pour le grec, puis JetBrains Mono NL pour « → »', async () => {
        const { embedReportFonts, drawTextRuns } = await import('@pctac/pdf-export.js');
        const extras = await extraBytes();
        const doc = await PDFDocument.create();
        const fonts = await embedReportFonts(doc, extras);
        const page = doc.addPage([595.28, 841.89]);
        drawTextRuns(page, 'SECTION ΩΜΕΓΑ → FIN', { x: 40, y: 800, size: 14, font: fonts.titleFont });
        // Polices réellement employées sur la page (ressources /Font de la page).
        const saved = await PDFDocument.load(await doc.save());
        const fontsDict = saved.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
        const used = fontsDict.keys().map((key) => {
            const dict = saved.context.lookup(fontsDict.get(key), PDFDict);
            return String(dict.get(PDFName.of('BaseFont'))).replace(/^\//, '');
        });
        expect([...new Set(used.map((n) => n.replace(/-\d+$/, '')))].sort()).toEqual(['JetBrainsMonoNL-Bold', 'NotoSans-Bold', 'Oswald-Medium']);
    });
});
