/**
 * pm-gpxplay.test.ts — Rejeu animé des traces GPX
 * (`src/apps/pctac/planmap/gpx-play.ts`).
 *
 * Les tests portent sur les fonctions PURES du module : préparation d'une
 * trace, conversion instant → progression, et point à une fraction de longueur.
 * Le rendu lui-même a été établi par prototype mesuré dans un vrai navigateur
 * (line-gradient écrase line-color, refuse les expressions pilotées par la
 * donnée), puis vérifié par le test E2E — pas ici, où il n'y a pas de WebGL.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildPlayTrack, playClockLabel, pointAtFraction, progressAtTime } from '../../../src/apps/pctac/planmap/gpx-play.js';
import type { LngLatTuple, PlanGpxTrack } from '../../../src/apps/pctac/planmap/types.js';

vi.mock('maplibre-gl', () => ({ default: { Marker: class {} } }));

const TRACK: PlanGpxTrack = { id: 't', name: 'T', color: '#a855f7', visible: true };

/** Narrowing sans `!`, proscrit dans ce dépôt : jette explicitement si absent. */
function must<T>(v: T | null | undefined, msg = 'trace attendue'): T {
    if (v === null || v === undefined) throw new Error(msg);
    return v;
}

/** Ligne droite plein est, un point tous les 0,01°, à l'équateur. */
function straight(n: number): LngLatTuple[] {
    return Array.from({ length: n }, (_, i) => [i * 0.01, 0] as LngLatTuple);
}

describe('buildPlayTrack', () => {
    it('raboute les tronçons en UNE polyligne : line-progress est par feature', () => {
        const built = buildPlayTrack(TRACK, [[[0, 0], [1, 0]], [[2, 0], [3, 0]]], null);
        expect(built?.coords).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
        // Les longueurs cumulées couvrent aussi le saut entre tronçons.
        expect(built?.cum).toHaveLength(4);
        expect(built?.total).toBeGreaterThan(0);
    });

    it('aligne les temps sur les points raboutés, trous compris', () => {
        const built = buildPlayTrack(TRACK, [[[0, 0], [1, 0]], [[2, 0], [3, 0]]], [[10, null], [30, 40]]);
        // Le point sans temps ne produit pas d'entrée dans la table.
        expect(built?.table.map((e) => e.t)).toEqual([10, 30, 40]);
    });

    it('table strictement croissante : un horodatage qui recule est écarté', () => {
        // Fusion de fichiers ou pause GPS : sans ce filtre la dichotomie casse.
        const built = buildPlayTrack(TRACK, [straight(4)], [[100, 50, 200, 150]]);
        expect(built?.table.map((e) => e.t)).toEqual([100, 200]);
    });

    it('trace non datée : table vide, bornes nulles, mais géométrie utilisable', () => {
        const built = buildPlayTrack(TRACK, [straight(3)], null);
        expect(built?.table).toEqual([]);
        expect(built?.startedAt).toBeNull();
        expect(built?.total).toBeGreaterThan(0);
    });

    it('moins de deux points, ou longueur nulle : rien à rejouer', () => {
        expect(buildPlayTrack(TRACK, [[[0, 0]]], null)).toBeNull();
        expect(buildPlayTrack(TRACK, [[[0, 0], [0, 0]]], null)).toBeNull();
    });
});

describe('progressAtTime', () => {
    /** Quatre points régulièrement espacés, une minute entre chacun. */
    const built = buildPlayTrack(TRACK, [straight(4)], [[0, 60_000, 120_000, 180_000]]);

    it('avant le début : rien n\'est révélé', () => {
        expect(progressAtTime(must(built), -1)).toBe(0);
        expect(progressAtTime(must(built), 0)).toBe(0);
    });

    it('après la fin : tout est révélé', () => {
        expect(progressAtTime(must(built), 180_000)).toBe(1);
        expect(progressAtTime(must(built), 999_999)).toBe(1);
    });

    it('au milieu : la progression suit la longueur PARCOURUE, pas le temps brut', () => {
        // Points régulièrement espacés en distance ET en temps : à mi-temps, on
        // est à mi-longueur.
        expect(progressAtTime(must(built), 90_000)).toBeCloseTo(0.5, 6);
    });

    it('interpole entre deux points datés', () => {
        const p = progressAtTime(must(built), 30_000);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(0.34);
    });

    it('une équipe ARRÊTÉE ne progresse pas : le temps passe, la longueur non', () => {
        // Trois points, mais les deux premiers sont confondus pendant une heure.
        const stopped = buildPlayTrack(TRACK, [[[0, 0], [0, 0], [0.02, 0]]], [[0, 3_600_000, 3_660_000]]);
        // À la fin de l'arrêt, aucune longueur parcourue.
        expect(progressAtTime(must(stopped), 3_600_000)).toBeCloseTo(0, 6);
        // Puis tout le trajet en une minute.
        expect(progressAtTime(must(stopped), 3_660_000)).toBe(1);
    });

    it('trace non datée : reste à zéro, elle n\'a rien à dire du temps', () => {
        const undated = buildPlayTrack(TRACK, [straight(3)], null);
        expect(progressAtTime(must(undated), 1000)).toBe(0);
    });
});

describe('pointAtFraction', () => {
    const built = buildPlayTrack(TRACK, [straight(5)], null);

    it('0 donne le premier point, 1 le dernier', () => {
        expect(pointAtFraction(must(built), 0)).toEqual([0, 0]);
        const end = pointAtFraction(must(built), 1);
        expect(end[0]).toBeCloseTo(0.04, 6);
    });

    it('borne les valeurs hors de zéro à un', () => {
        expect(pointAtFraction(must(built), -3)).toEqual(pointAtFraction(must(built), 0));
        expect(pointAtFraction(must(built), 7)).toEqual(pointAtFraction(must(built), 1));
    });

    it('la moitié tombe au milieu géométrique d\'une ligne régulière', () => {
        const mid = pointAtFraction(must(built), 0.5);
        expect(mid[0]).toBeCloseTo(0.02, 4);
        expect(mid[1]).toBeCloseTo(0, 6);
    });
});

describe('playClockLabel', () => {
    it('en temps réel : affiche un horodatage lisible', () => {
        const label = playClockLabel({
            mode: 'real',
            span: { from: Date.parse('2026-09-08T06:00:00Z'), to: Date.parse('2026-09-08T08:00:00Z') },
            t: 0.5,
        });
        // Format français jour/mois heure:minute:seconde — on vérifie la forme,
        // pas le fuseau de la machine de test.
        expect(label).toMatch(/\d{2}\/\d{2}.*\d{2}:\d{2}:\d{2}/);
    });

    it('en progression : affiche un pourcentage, aucune date inventée', () => {
        expect(playClockLabel({ mode: 'norm', span: null, t: 0.42 })).toBe('42 %');
    });

    it('sans intervalle de temps, le mode réel retombe sur le pourcentage', () => {
        expect(playClockLabel({ mode: 'real', span: null, t: 0.1 })).toBe('10 %');
    });
});
