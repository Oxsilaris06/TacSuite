// @vitest-environment node
/**
 * OI express — nombre de pages vérifié sur le PDF RÉELLEMENT RENDU par
 * pdfmake (et non sur le nombre de nœuds de `content`, qui laissait passer un
 * document de 3 à 6 pages : faux positif relevé par la revue du 2026-09-24).
 *
 * Même rendu que le banc `tests/pdf/generate-from-fixture.mjs` : pdfmake côté
 * Node, polices TTF du dépôt. Les pages sont comptées dans le flux PDF.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { OiFormData, OiPatracMember } from '@shared/types/contracts.js';
import { buildOiDocDefinition } from '@oi/pdf/document-builder.js';

const FONTS = path.resolve(__dirname, '../../../../src/apps/oi/pdf/fonts');
// JPEG 1×1 valide (les photos de l'express passent par `figure`).
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z';

async function renderedPages(fd: OiFormData, photos: Record<string, string>): Promise<number> {
    const dd = buildOiDocDefinition({ formData: fd, photosBase64: photos, isDark: false }, { format: 'a4' });
    const pdfMake = (await import('pdfmake')).default as unknown as {
        setFonts(f: unknown): void;
        createPdf(d: unknown): { write(p: string): Promise<void> };
    };
    pdfMake.setFonts({
        Oswald: { normal: path.join(FONTS, 'oswald_500.ttf'), bold: path.join(FONTS, 'oswald_500.ttf') },
        JetBrainsMono: { normal: path.join(FONTS, 'jetbrains_mono_400.ttf'), bold: path.join(FONTS, 'jetbrains_mono_700.ttf') },
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'oi-express-'));
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
    return (raw.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

const txt = (n: number): string => 'Individu retranché au 1er étage, arme longue signalée, accès cour arrière. '.repeat(Math.ceil(n / 75)).slice(0, n);

function member(i: number): OiPatracMember {
    const armes: Array<[string, string]> = [['UMP9', 'PSA'], ['G36', 'PSA'], ['UMP9', 'PSA']];
    return {
        trigramme: `T${String(i).padStart(2, '0')}`, fonction: i === 0 ? 'Chef inter' : 'Inter', cellule: i < 6 ? 'India 1' : 'India 2',
        principales: armes[i % 3]![0], secondaires: armes[i % 3]![1], afis: i % 4 === 0 ? 'PIE' : 'Sans', grenades: i % 2 ? 'GENL' : 'Sans',
        equipement: ['GENL', 'Bouclier', 'Bélier', 'Sans'][i % 4]!, equipement2: 'Sans', tenue: 'UBAS', gpb: 'Sans', dir: '',
    };
}

function expressOi(nMembers: number, nEvents: number, textLen: number): OiFormData {
    const rows: NonNullable<OiFormData['patracdvr_rows']> = [];
    for (let k = 0; k < nMembers; k += 4) {
        rows.push({ vehicle: `VL${k / 4 + 1}`, members: Array.from({ length: Math.min(4, nMembers - k) }, (_, j) => member(k + j)) });
    }
    const meta = (id: string, customTitle = ''): { id: string; annotations: string; tools: string; other_tools: string; customTitle: string } =>
        ({ id, annotations: '[]', tools: '[]', other_tools: '', customTitle });
    return {
        oi_mode: 'express', date_op: '2026-09-24', trigramme_redacteur: 'ABC', unite_redacteur: 'PSIG',
        situation_generale: txt(textLen), situation_particuliere: txt(textLen / 2), missions_psig: "INTERPELLER L'INDIVIDU",
        date_execution: '2026-09-25', heure_execution: '06:00', action_body_text: txt(textLen),
        time_events: Array.from({ length: nEvents }, (_, i) => ({ type: `T${i}`, hour: `0${5 + (i % 4)}:00`, description: `Étape ${i} ${txt(40)}` })),
        patracdvr_rows: rows,
        dynamic_photos: {
            photo_container_express_objectif_preview_container: [meta('o1')],
            photo_container_express_adversaire_preview_container: [meta('a1')],
            photo_container_express_carte_preview_container: [meta('c1', 'Carroyage 50 m')],
        },
    };
}

describe('OI express — pages du PDF rendu', () => {
    const photos = { o1: JPEG, a1: JPEG, c1: JPEG };
    // Décision 24 : toutes les photos, plans pleine largeur (PDF paysage : un
    // plan occupe presque une page). L'ordre et la paire objectif/adversaire
    // tiennent en deux pages ; le plan prend la troisième.
    for (const [n, ev, len] of [[4, 3, 150], [8, 5, 300], [12, 5, 300], [16, 6, 400]] as const) {
        it(`${n} membres, ${ev} étapes, textes de ${len} caractères, 3 photos dont un plan : 3 pages`, async () => {
            expect(await renderedPages(expressOi(n, ev, len), photos)).toBeLessThanOrEqual(3);
        }, 30_000);
    }

    it('ordre minimal sans photo (2 membres, sans chronologie, textes brefs) : une seule page', async () => {
        const fd = { ...expressOi(2, 0, 80), dynamic_photos: {} };
        expect(await renderedPages(fd, {})).toBe(1);
    }, 30_000);

    it('sans photo, équipe de 8 : deux pages au plus', async () => {
        const fd = { ...expressOi(8, 5, 300), dynamic_photos: {} };
        expect(await renderedPages(fd, {})).toBeLessThanOrEqual(2);
    }, 30_000);
});
