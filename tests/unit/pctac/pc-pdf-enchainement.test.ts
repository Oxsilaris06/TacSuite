/**
 * pc-pdf-enchainement.test.ts — Mise en page du rapport complet PC-Tac
 * (audit PDF du 2026-09-25, constat Mo6) : une fiche coupée entre deux pages
 * rappelle « NOM Prénom (suite) » en tête de la page suivante ; les sections
 * s'enchaînent sur la même page quand la suivante y tient (plus de page
 * « Forces amies » de trois lignes), et commencent une page neuve sinon.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePdfBytes, pdfPagesText, pdfTextItems } from './pdf-test-helpers.js';

vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        getMany: async (): Promise<Record<string, string | null>> => ({}),
        hydrate: async <T,>(items: T[]): Promise<T[]> => items,
    },
    GpxStore: { get: async (): Promise<null> => null },
}));

const OPTS = { kind: 'complet', theme: 'clair', sortie: 'impression' } as const;
/** Ordonnée du titre d'une page neuve (A4 portrait, marge de 40 pt). */
const TOP_TITLE_Y = 841.89 - 40;

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'PlanMap');
});

const log = (id: string, heure: string, remarques: string): Record<string, unknown> =>
    ({ id, heure, pax: 'Inter', paxMode: 'standard', lieu: 'PC', remarques });

describe('fiche coupée entre deux pages (Mo6)', () => {
    it('la page suivante rappelle « NOM Prénom (suite) » en tête', async () => {
        localStorage.setItem('pcTacAdversaries', JSON.stringify([
            { id: 'a1', nom: 'DURAND', prenom: 'Marc', antecedents: 'Antecedent detaille numero '.repeat(220) },
        ]));
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const cut = pages.findIndex((t) => t.includes('DURAND Marc (suite)'));
        expect(cut).toBeGreaterThan(0);
        const items = await pdfTextItems(bytes!, cut);
        const reminder = items.find((i) => i.str.includes('DURAND Marc (suite)'));
        // Juste sous le titre de page : c'est la première ligne de la page.
        const below = items.filter((i) => i.y < TOP_TITLE_Y - 1);
        expect(Math.max(...below.map((i) => i.y))).toBe(reminder!.y);
    });
});

describe('sections enchaînées quand la suivante tient', () => {
    it('main courante, fiches et forces amies courtes tiennent sur une seule page', async () => {
        localStorage.setItem('pcTacLogData', JSON.stringify([log('e1', '08:15', 'RAS'), log('e2', '08:30', 'Contact établi')]));
        localStorage.setItem('pcTacAdversaries', JSON.stringify([{ id: 'a1', nom: 'DURAND', prenom: 'Marc', alias: 'Le Grand' }]));
        localStorage.setItem('pcTacHostages', JSON.stringify([{ id: 'h1', nom: 'BERNARD', prenom: 'Claire', status: 'ok' }]));
        localStorage.setItem('pcTacFriends', JSON.stringify([
            { id: 'f1', nom: 'LEROY', prenom: 'Cdt', unite: 'PSIG 45', mission: 'Bouclage' },
            { id: 'f2', nom: 'GIRARD', prenom: 'Cne', unite: 'GIGN', mission: 'Intervention' },
            { id: 'f3', nom: 'BONNET', prenom: 'Lt', unite: 'SDIS 37', mission: 'Secours' },
        ]));
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        expect(pages).toHaveLength(1);
        for (const title of ['MAIN COURANTE', 'FICHIER ADVERSAIRES', 'FICHIER OTAGES', 'FORCES AMIES / UNITÉS']) {
            expect(pages[0]).toContain(title);
        }
    });

    it('une section qui ne tient pas dans la place restante commence une page neuve', async () => {
        localStorage.setItem('pcTacLogData', JSON.stringify([log('e1', '08:15', 'RAS')]));
        localStorage.setItem('pcTacFriends', JSON.stringify(Array.from({ length: 70 }, (_, i) => (
            { id: `f${i}`, nom: `NOM${i}`, prenom: 'Agent', unite: 'PSIG', mission: 'Bouclage' }
        ))));
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const start = pages.findIndex((t) => t.includes('FORCES AMIES / UNITÉS'));
        expect(start).toBeGreaterThan(0);
        const title = (await pdfTextItems(bytes!, start)).find((i) => i.str.includes('FORCES AMIES / UNITÉS'));
        expect(title!.y).toBeCloseTo(TOP_TITLE_Y, 0);
    });

    it('le journal des actions suit la liste des points sur la même page', async () => {
        localStorage.setItem('pcTacLogData', JSON.stringify([
            log('e1', '08:15', 'RAS'),
            { ...log('e2', '09:00', '[PIN] Point « PC avancé » posé'), pax: 'Carte', auto: true },
        ]));
        Reflect.set(window, 'PlanMap', {
            getPinsSummary: () => [{ label: 'PC avancé', mgrs: '31U DQ 12345 67890', cell: 'B2', lat: 47.39, lng: 0.69, diameterM: null }],
        });
        const bytes = await generatePdfBytes({ ...OPTS });
        const pages = await pdfPagesText(bytes!);
        const points = pages.findIndex((t) => t.includes('PLAN TACTIQUE - LISTE DES POINTS'));
        expect(points).toBeGreaterThanOrEqual(0);
        expect(pages[points]).toContain('JOURNAL DES ACTIONS PC-TAC');
    });
});
