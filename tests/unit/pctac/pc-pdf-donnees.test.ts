/**
 * pc-pdf-donnees.test.ts — Données de l'écran absentes du rapport complet
 * PC-Tac (audit PDF du 2026-09-25, constats Mo4, Mo7, Mo8 et Mo9) :
 *  - fiches liées d'un adversaire ;
 *  - entrées favorites marquées dans la main courante ;
 *  - liste des formes et des traces GPX (nom, type, longueur ou surface) ;
 *  - une entrée saisie à la main ne part plus dans le journal des actions ;
 *  - métadonnées du PDF (titre, sujet, créateur, sans nom de personne) ;
 *  - le tutoriel ne cite que des sections réellement produites.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generatePdfBytes, pdfPageOperators, pdfPagesText } from './pdf-test-helpers.js';

const gpx = vi.hoisted(() => new Map<string, { coords: [number, number][][]; times: null }>());
vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {
        getMany: async (): Promise<Record<string, string | null>> => ({}),
        hydrate: async <T,>(items: T[]): Promise<T[]> => items,
    },
    GpxStore: { get: async (id: string) => gpx.get(id) ?? null },
}));

const OPTS = { kind: 'complet', theme: 'clair', sortie: 'impression' } as const;

beforeEach(() => {
    localStorage.clear();
    gpx.clear();
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'PlanMap');
});

const set = (key: string, value: unknown): void => localStorage.setItem(key, JSON.stringify(value));
const log = (id: string, heure: string, remarques: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ id, heure, date: '2026-09-25', pax: 'Inter', paxMode: 'standard', lieu: 'PC', remarques, ...extra });

/** Décalage en mètres (même sphère que `haversineMeters`, R = 6 371 km). */
const C: [number, number] = [0.69, 47.39];
const DEG = (6371000 * Math.PI) / 180;
const at = (east: number, north: number): [number, number] =>
    [C[0] + east / (DEG * Math.cos((C[1] * Math.PI) / 180)), C[1] + north / DEG];

describe('fiches liées (Mo4)', () => {
    it('la fiche adverse liste les fiches protégées qui lui sont liées, comme l’écran', async () => {
        set('pcTacAdversaries', [{ id: 'a1', nom: 'DURAND', prenom: 'Marc' }]);
        set('pcTacHostages', [
            { id: 'h1', nom: 'BERNARD', prenom: 'Claire', lien: 'a1' },
            { id: 'h2', nom: 'PETIT', prenom: 'Léa', lien: 'a1' },
            { id: 'h3', nom: 'ROUX', prenom: 'Tom' },
        ]);
        const text = (await pdfPagesText((await generatePdfBytes({ ...OPTS }))!)).join(' ');
        expect(text).toContain('Fiches liées : BERNARD Claire, PETIT Léa');
    });
});

describe('favoris de la main courante (Mo4)', () => {
    it('chaque entrée marquée porte l’étoile, et la légende les compte', async () => {
        set('pcTacLogData', [
            log('e1', '08:15', 'Arrivée', { favori: true }),
            log('e2', '08:30', 'RAS'),
            log('e3', '08:45', 'Contact établi', { favori: true }),
        ]);
        const bytes = (await generatePdfBytes({ ...OPTS }))!;
        const [page] = await pdfPagesText(bytes);
        expect(page).toContain('Entrées marquées importantes : 2');
        // Étoile vectorielle (aucune police embarquée n'a « ★ ») : une par
        // favori, plus celle de la légende.
        const stars = (await pdfPageOperators(bytes, 0)).split('0.96 0.68 0.05 rg').length - 1;
        expect(stars).toBe(3);
    });

    it('sans favori : ni légende ni étoile', async () => {
        set('pcTacLogData', [log('e1', '08:15', 'Arrivée')]);
        const bytes = (await generatePdfBytes({ ...OPTS }))!;
        expect((await pdfPagesText(bytes))[0]).not.toContain('marquées importantes');
        expect(await pdfPageOperators(bytes, 0)).not.toContain('0.96 0.68 0.05 rg');
    });
});

describe('formes et traces GPX (Mo4)', () => {
    it('nom, type et longueur ou surface de chaque forme et de chaque trace', async () => {
        set('pcTacPlanShapes', [
            { id: 's1', type: 'line', color: '#ef4444', coords: [at(0, 0), at(0, 100)], text: 'Axe effort' },
            { id: 's2', type: 'rectangle', color: '#f59e0b', coords: [at(0, 0), at(60, 0), at(60, 40), at(0, 40), at(0, 0)], text: 'Zone exclusion' },
            { id: 's3', type: 'circle', color: '#10b981', center: at(0, 0), edge: at(0, 50), coords: [] },
            { id: 's4', type: 'text', color: '#ffffff', coords: [at(10, 10)], text: 'ZONE ROUGE' },
            { id: 's5', type: 'measure', color: '#ffffff', coords: [at(0, 0), at(0, 250)], totalM: 250 },
            { id: 's6', type: 'measure-rings', color: '#ffffff', center: at(0, 0), rings: [{ radiusM: 50, coords: [] }, { radiusM: 100, coords: [] }] },
        ]);
        set('pcTacGpxIndex', [
            { id: 'g1', name: 'Patrouille nord', color: '#3b82f6', visible: true, startedAt: null, endedAt: null },
            { id: 'g2', name: 'Chien', color: '#8b4513', visible: false, startedAt: null, endedAt: null },
        ]);
        // Deux tronçons : le saut entre eux ne compte pas dans la longueur.
        gpx.set('g1', { coords: [[at(0, 0), at(0, 100)], [at(500, 0), at(500, 50)]], times: null });
        gpx.set('g2', { coords: [[at(0, 0), at(0, 1500)]], times: null });
        const text = (await pdfPagesText((await generatePdfBytes({ ...OPTS }))!)).join(' ');
        expect(text).toContain('PLAN TACTIQUE - FORMES ET TRACES');
        expect(text).toMatch(/Axe effort Trait 100 m/);
        expect(text).toMatch(/Zone exclusion Rectangle 2 400 m²/);
        expect(text).toMatch(/Cercle diamètre 100 m, 7 854 m²/);
        expect(text).toMatch(/ZONE ROUGE Texte/);
        expect(text).toMatch(/Mesure 250 m/);
        expect(text).toMatch(/Anneaux d'engagement rayons 50 m, 100 m/);
        expect(text).toMatch(/Patrouille nord Trace GPX 150 m/);
        expect(text).toMatch(/Chien \(masquée\) Trace GPX 1,50 km/);
    });

    it('ni forme ni trace : pas de section', async () => {
        set('pcTacLogData', [log('e1', '08:15', 'Arrivée')]);
        const text = (await pdfPagesText((await generatePdfBytes({ ...OPTS }))!)).join(' ');
        expect(text).not.toContain('FORMES ET TRACES');
    });
});

describe('journal des actions : seules les entrées de l’application y partent (Mo7)', () => {
    it('une remarque saisie à la main qui ressemble à un changement de statut reste en main courante', async () => {
        set('pcTacLogData', [
            log('m1', '09:00', 'ADV DURAND Marc : neutralisé par la colonne'),
            log('m2', '09:05', '[PIN] noté à la main'),
            log('a1', '09:10', 'ADV DURAND Marc : neutralisé', { auto: true, pax: 'Adversaire' }),
        ]);
        const pages = await pdfPagesText((await generatePdfBytes({ ...OPTS }))!);
        const all = pages.join(' ');
        const journal = all.slice(all.indexOf('JOURNAL DES ACTIONS PC-TAC'));
        const courante = all.slice(0, all.indexOf('JOURNAL DES ACTIONS PC-TAC'));
        expect(courante).toContain('neutralisé par la colonne');
        expect(courante).toContain('[PIN] noté à la main');
        expect(journal).not.toContain('par la colonne');
        expect(journal).toContain('DURAND Marc : neutralisé');
    });

    it('les entrées anciennes sans date ni drapeau restent reconnues par leur texte', async () => {
        set('pcTacLogData', [
            { id: 'o1', heure: '09:00', pax: 'Inter', paxMode: 'standard', lieu: '', remarques: '[PIN] Point « PRV » posé' },
            { id: 'o2', heure: '09:05', pax: 'Inter', paxMode: 'standard', lieu: '', remarques: 'RAS' },
        ]);
        const all = (await pdfPagesText((await generatePdfBytes({ ...OPTS }))!)).join(' ');
        expect(all.slice(all.indexOf('JOURNAL DES ACTIONS PC-TAC'))).toContain('Point « PRV » posé');
    });
});

describe('métadonnées du PDF (Mo8)', () => {
    it('titre, sujet, créateur et producteur ; jamais de nom de personne', async () => {
        set('pcTacAdversaries', [{ id: 'a1', nom: 'DURAND', prenom: 'Marc' }]);
        set('pcTacLogData', [log('e1', '08:15', 'Arrivée')]);
        const doc = await PDFDocument.load((await generatePdfBytes({ ...OPTS }))!, { updateMetadata: false });
        expect(doc.getTitle()).toMatch(/^PC-Tac — Forcené — \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
        expect(doc.getSubject()).toBe('DIFFUSION RESTREINTE');
        expect(doc.getCreator()).toBe('TacSuite PC-Tac');
        expect(doc.getProducer()).toBe('TacSuite');
        expect(doc.getAuthor()).toBeUndefined();
        const meta = [doc.getTitle(), doc.getSubject(), doc.getCreator(), doc.getProducer(), doc.getKeywords()].join(' ');
        expect(meta).not.toMatch(/DURAND|Marc/);
    });
});

describe('tutoriel « Comprendre le contenu du PDF » (Mo9)', () => {
    it('chaque section citée existe dans un PDF complet', async () => {
        set('pcTacLogData', [log('e1', '08:15', 'Arrivée'), log('a1', '09:10', '[PIN] Point posé', { auto: true, pax: 'Carte' })]);
        set('pcTacAdversaries', [{ id: 'a1', nom: 'DURAND', prenom: 'Marc' }]);
        set('pcTacHostages', [{ id: 'h1', nom: 'BERNARD', prenom: 'Claire', status: 'ok' }]);
        set('pcTacFriends', [{ id: 'f1', nom: 'LEROY', prenom: 'Cdt', unite: 'PSIG', mission: 'Bouclage' }]);
        set('pcTacPhotos', [{ id: 'p1', title: 'Façade', category: 'location', data: '' }]);
        set('pcTacPlanShapes', [{ id: 's1', type: 'line', coords: [at(0, 0), at(0, 100)], text: 'Axe' }]);
        Reflect.set(window, 'PlanMap', {
            captureToDataUrl: async () => null,
            getPinsSummary: () => [{ label: 'PRV', lat: 47.39, lng: 0.69, diameterM: null }],
        });
        const text = (await pdfPagesText((await generatePdfBytes({ ...OPTS }))!)).join(' ');
        const { pctacTutoData } = await import('@pctac/tuto-data.js');
        const step = pctacTutoData().chapters.flatMap((c) => c.steps).find((s) => s.title === 'Comprendre le contenu du PDF')!;
        const sections = [...step.body.matchAll(/«\s*([^»]+?)\s*»/g)]
            .map((m) => m[1]!)
            .filter((s) => s === s.toUpperCase() && /[A-Z]{4}/.test(s));
        expect(sections.length).toBeGreaterThan(5);
        expect(sections.filter((s) => !text.includes(s))).toEqual([]);
    });
});
