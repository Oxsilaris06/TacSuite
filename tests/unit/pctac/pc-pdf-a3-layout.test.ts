/**
 * pc-pdf-a3-layout.test.ts — moteur de placement de la synthèse A3 paysage
 * (décision 41), fonction pure :
 *  - une seule page, tout dans la zone utile, aucune zone qui en chevauche une autre ;
 *  - aucune ligne plus large que sa colonne ;
 *  - réduction graduée annoncée (fiches à 3 faits clés, vignettes carrées,
 *    faits marquants les plus récents), refus seulement au-delà ;
 *  - déterministe.
 */
import { describe, expect, it } from 'vitest';
import { A3_PAGE, layoutA3, type A3Input, type A3Layout, type A3Measure } from '@pctac/pdf-a3-layout.js';

// Mesure monospace de test : 0,6 × corps par caractère (police réelle plus étroite).
const measure: A3Measure = (text, _bold, size) => Array.from(text).length * size * 0.6;

const fiche = (i: number, long = true) => ({
    title: `NOM${i} Prénom${i}`,
    badge: { text: 'Actif', color: '#dc2626' },
    full: long
        ? `Position : étage ${i}, chambre côté rue · Armes : fusil de chasse calibre 12 · Signalement : homme 1m85, corpulence forte, cheveux bruns, barbe · Tenue : sweat gris à capuche, jean bleu · Véhicule : Peugeot 308 grise AB-123-CD · Antécédents : violences conjugales (2019), port d'arme prohibé (2021)`
        : `Position : étage ${i}`,
    short: `Position : étage ${i} · Armes : fusil · Statut : actif`,
});

function input(over: Partial<A3Input> = {}): A3Input {
    return {
        plan: { widthPx: 1720, heightPx: 1230 },
        photos: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, widthPx: i % 2 ? 768 : 1024, heightPx: i % 2 ? 1024 : 768, title: `Photo ${i}` })),
        adv: { header: 'ADVERSAIRES (3)', fiches: [fiche(1), fiche(2), fiche(3)] },
        host: { header: 'OTAGES (4)', fiches: [fiche(4, false), fiche(5, false), fiche(6, false), fiche(7, false)] },
        faits: { header: 'FAITS MARQUANTS (6)', entries: Array.from({ length: 6 }, (_, i) => `25/09 1${i}:00 Adversaire — Contact établi, individu calme, négociation en cours (${i})`) },
        points: { header: 'POINTS DU PLAN (7)', items: Array.from({ length: 7 }, (_, i) => `Point ${i} [C${i}] 31U DQ 12345 6789${i}`) },
        amis: { header: 'FORCES AMIES (3)', items: ['LEROY Cdt (PSIG 45) bouclage', 'GIRARD Cdt (GIGN) appui', 'BONNET Cdt (SDIS 37) secours'] },
        ...over,
    };
}

type Box = { x: number; y: number; w: number; h: number; zone: string };
function allBoxes(l: A3Layout): Box[] {
    const boxes: Box[] = [];
    if (l.plan) boxes.push({ ...l.plan, zone: 'plan' });
    for (const p of l.photos) boxes.push({ ...p.box, zone: 'photos' });
    for (const t of l.textBoxes) boxes.push({ x: t.x, y: t.y, w: t.w, h: t.h, zone: t.zone });
    if (l.banner) boxes.push({ ...l.banner, zone: 'bandeau' });
    return boxes;
}

function assertInvariants(l: A3Layout): void {
    const { width, height, margin } = A3_PAGE;
    const boxes = allBoxes(l);
    for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(margin - 0.01);
        expect(b.y).toBeGreaterThanOrEqual(margin - 0.01);
        expect(b.x + b.w).toBeLessThanOrEqual(width - margin + 0.01);
        expect(b.y + b.h).toBeLessThanOrEqual(height - margin + 0.01);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const inter = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
        expect(inter, `${a.zone} chevauche ${b.zone}`).toBe(false);
    }
    const PT = 72 / 25.4;
    for (const t of l.textBoxes) for (const line of t.lines) {
        expect(measure(line.text, line.bold, t.size) + (line.badge ? measure(line.badge.text, true, t.size) + 4 : 0)).toBeLessThanOrEqual(t.w * PT + 0.01);
    }
}

describe('layoutA3 — cas courant', () => {
    it('tout tient sans réduction, dans la page, sans chevauchement', () => {
        const l = layoutA3(input(), measure);
        expect(l.refused).toBeNull();
        expect(l.reductions).toEqual([]);
        expect(l.banner).toBeNull();
        expect(l.plan).not.toBeNull();
        expect(l.photos).toHaveLength(7);
        assertInvariants(l);
    });

    it('rien n’est perdu : chaque fiche, fait, point et ami apparaît', () => {
        const l = layoutA3(input(), measure);
        const text = l.textBoxes.flatMap((t) => t.lines.map((x) => x.text)).join(' ');
        for (const n of ['NOM1', 'NOM7', '(5)', 'Point 6', 'BONNET']) expect(text).toContain(n);
    });

    it('sans plan ni photo, les colonnes de texte prennent toute la largeur', () => {
        const l = layoutA3(input({ plan: null, photos: [] }), measure);
        expect(l.plan).toBeNull();
        expect(l.photos).toEqual([]);
        expect(Math.min(...l.textBoxes.map((t) => t.x))).toBeCloseTo(A3_PAGE.margin, 5);
        assertInvariants(l);
    });

    it('déterministe', () => {
        expect(layoutA3(input(), measure)).toEqual(layoutA3(input(), measure));
    });
});

describe('layoutA3 — réduction graduée annoncée', () => {
    it('trop de fiches complètes : fiches ramenées à leurs 3 faits clés, annoncé', () => {
        const many = Array.from({ length: 40 }, (_, i) => fiche(i));
        const l = layoutA3(input({ adv: { header: 'ADVERSAIRES (40)', fiches: many } }), measure);
        expect(l.refused).toBeNull();
        expect(l.reductions.join(' ')).toMatch(/3 faits clés/);
        expect(l.banner).not.toBeNull();
        const text = l.textBoxes.filter((t) => t.zone === 'adv').flatMap((t) => t.lines.map((x) => x.text)).join(' ');
        expect(text).toContain('NOM39');
        assertInvariants(l);
    });

    it('trop de photos pour des rangées lisibles : vignettes carrées, annoncé', () => {
        const photos = Array.from({ length: 90 }, (_, i) => ({ id: `p${i}`, widthPx: 1024, heightPx: 768, title: `P${i}` }));
        const l = layoutA3(input({ photos }), measure);
        expect(l.refused).toBeNull();
        expect(l.reductions.join(' ')).toMatch(/vignettes/);
        expect(l.photos).toHaveLength(90);
        expect(l.photos.every((p) => p.square)).toBe(true);
        assertInvariants(l);
    });

    it('trop de faits marquants : les plus récents, et le reste annoncé', () => {
        const entries = Array.from({ length: 400 }, (_, i) => `25/09 ${String(i).padStart(4, '0')} Fait marquant numéro ${i} avec un peu de texte pour occuper la ligne`);
        const l = layoutA3(input({ faits: { header: 'FAITS MARQUANTS (400)', entries } }), measure);
        expect(l.refused).toBeNull();
        const text = l.textBoxes.filter((t) => t.zone === 'faits').flatMap((t) => t.lines.map((x) => x.text)).join(' ');
        expect(text).toContain('numéro 399');
        expect(text).not.toContain('numéro 0 ');
        expect(text).toMatch(/\+ \d+ antérieurs au rapport complet/);
        expect(l.reductions.join(' ')).toMatch(/faits marquants/i);
        assertInvariants(l);
    });

    it('au-delà de toute réduction : refus explicite, qui dit pourquoi', () => {
        const many = Array.from({ length: 900 }, (_, i) => fiche(i));
        const l = layoutA3(input({ adv: { header: 'ADVERSAIRES (900)', fiches: many } }), measure);
        expect(l.refused).not.toBeNull();
        expect(l.refused!.join(' ')).toMatch(/fiches/);
    });
});

describe('layoutA3 — jeux mêlés', () => {
    it('invariants tenus sur une série de jeux de tailles variées', () => {
        for (const [nAdv, nHost, nPhotos, nFaits] of [[0, 0, 0, 0], [1, 0, 1, 1], [8, 8, 12, 20], [12, 29, 24, 42], [2, 30, 0, 80], [15, 0, 41, 5]] as const) {
            const l = layoutA3(input({
                adv: { header: `ADV (${nAdv})`, fiches: Array.from({ length: nAdv }, (_, i) => fiche(i)) },
                host: { header: `OTG (${nHost})`, fiches: Array.from({ length: nHost }, (_, i) => fiche(100 + i, i % 2 === 0)) },
                photos: Array.from({ length: nPhotos }, (_, i) => ({ id: `p${i}`, widthPx: [1024, 768, 2048, 1170][i % 4]!, heightPx: [768, 1024, 512, 2532][i % 4]!, title: `Photo ${i}` })),
                faits: { header: `FAITS (${nFaits})`, entries: Array.from({ length: nFaits }, (_, i) => `25/09 ${i} Fait ${i} texte`) },
            }), measure);
            if (l.refused === null) assertInvariants(l);
        }
    });
});
