// @vitest-environment node
/**
 * Page « Baptême terrain » (décision 46, Nico 2026-09-26) vérifiée sur le PDF
 * RÉELLEMENT RENDU par pdfmake : une légende longue ne doit ni pousser les
 * photos sur une page sans titre, ni les faire disparaître (relecture neuve
 * du 26/09 : deux portraits à 200 caractères de légende en A4 partaient
 * seuls sur la page suivante, à 600 caractères ils n'étaient plus imprimés).
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { OiPhotoMeta } from '@shared/types/contracts.js';
import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';

const FONTS = path.resolve(__dirname, '../../../../src/apps/oi/pdf/fonts');
// JPEG réel (90 × 160) dont l'en-tête est réécrit aux dimensions voulues.
const BASE = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//wAALCACgAFoBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//2Q==';
const jpeg = (width: number, height: number): string => {
    const bytes = Buffer.from(BASE, 'base64');
    const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    bytes.writeUInt16BE(height, sof + 5);
    bytes.writeUInt16BE(width, sof + 7);
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
};
const caption = (n: number): string => 'Portail vert, digicode 4521B, chien signalé dans la cour arrière, accès garage. '.repeat(Math.ceil(n / 80)).slice(0, n);

/** Nombre de pages et d'images dessinées du PDF rendu. */
async function render(format: 'a4' | '16:9', dims: [number, number][], captionLen: number): Promise<{ pages: number; images: number }> {
    const photos: OiPhotoMeta[] = dims.map((_, i) => ({ id: `b${i}`, annotations: '[]', tools: '[]', other_tools: '', customTitle: caption(captionLen) }));
    const photosBase64 = Object.fromEntries(dims.map(([w, h], i) => [`b${i}`, jpeg(w + i, h)]));
    const dd = buildOiDocDefinition({ formData: { missions_psig: 'INTERPELLER.', action_body_text: 'Action.', dynamic_photos: { photo_container_bapteme_terrain_preview_container: photos } }, photosBase64, isDark: false }, { format });
    const pdfMake = (await import('pdfmake')).default as unknown as {
        setFonts(f: unknown): void;
        createPdf(d: unknown): { write(p: string): Promise<void> };
    };
    pdfMake.setFonts({
        Oswald: { normal: path.join(FONTS, 'oswald_500.ttf'), bold: path.join(FONTS, 'oswald_500.ttf') },
        JetBrainsMono: { normal: path.join(FONTS, 'jetbrains_mono_400.ttf'), bold: path.join(FONTS, 'jetbrains_mono_700.ttf') },
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'oi-bapteme-'));
    const out = path.join(dir, 'x.pdf');
    const warn = console.warn;
    console.warn = () => {};
    try {
        await pdfMake.createPdf(dd).write(out);
    } finally {
        console.warn = warn;
    }
    const raw = readFileSync(out).toString('latin1');
    rmSync(dir, { recursive: true, force: true });
    return { pages: (raw.match(/\/Type\s*\/Page(?!s)/g) ?? []).length, images: (raw.match(/\/Subtype\s*\/Image/g) ?? []).length };
}

const PORTRAIT: [number, number] = [3000, 4000];
const PAYSAGE: [number, number] = [4000, 3000];

describe('page « Baptême terrain » rendue : légendes longues', () => {
    it.each([
        ['a4', [PORTRAIT, PORTRAIT]],
        ['a4', [PAYSAGE, PAYSAGE]],
        ['a4', [PAYSAGE]],
        ['a4', [PORTRAIT]],
        ['16:9', [PORTRAIT, PORTRAIT]],
        ['16:9', [PAYSAGE, PAYSAGE]],
        ['16:9', [PAYSAGE]],
        ['16:9', [PORTRAIT]],
    ] as const)('%s, %j : même nombre de pages qu’avec une légende courte, toutes les photos imprimées', async (format, dims) => {
        const short = await render(format, [...dims], 20);
        for (const len of [200, 400, 800, 3000]) {
            const long = await render(format, [...dims], len);
            expect({ len, ...long }).toEqual({ len, pages: short.pages, images: dims.length });
        }
    }, 60000);
});
