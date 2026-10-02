/**
 * ign-territoires.test.ts — Emprises des flux IGN (Géoplateforme) : métropole
 * + outre-mer (décision « retours terrain 2026-10-02 »).
 *
 * Périmètre : DROM (971 Guadeloupe, 972 Martinique, 973 Guyane, 974 La Réunion,
 * 976 Mayotte) + 975 Saint-Pierre-et-Miquelon, 977 Saint-Barthélemy, 978
 * Saint-Martin. Pas la Nouvelle-Calédonie ni la Polynésie (enquête séparée).
 *
 * Les couvertures par famille de couches ne sont PAS une hypothèse : elles
 * viennent d'une sonde curl sans clé de la Géoplateforme (2026-10-02, une tuile
 * par territoire et par couche, plus un quadrillage z12). Ces tests figent le
 * résultat ; `scripts/check-ign-lidar.mjs` permet de le revérifier.
 */

import { describe, expect, it } from 'vitest';

import {
    IGN_METROPOLE,
    IGN_OUTRE_MER,
    ignLayerId,
    ignLayerIds,
    ignLayers,
    ignSources,
    ignTerritories,
    ignTerritoryAt,
    ignUnservedAt,
} from '@shared/ign-territoires.js';

/** Ville de référence de chaque territoire (WGS84, lon/lat) — celles de la sonde. */
const VILLES: Record<string, [string, number, number]> = {
    '971': ['Pointe-à-Pitre', -61.5331, 16.2411],
    '972': ['Fort-de-France', -61.0588, 14.6161],
    '973': ['Cayenne', -52.326, 4.9372],
    '974': ['Saint-Denis', 55.4481, -20.8789],
    '975': ['Saint-Pierre', -56.1773, 46.7766],
    '976': ['Mamoudzou', 45.2278, -12.7806],
    '977': ['Gustavia', -62.8498, 17.8963],
    '978': ['Marigot', -63.0824, 18.0679],
};

const contient = (b: readonly number[], lon: number, lat: number): boolean =>
    lon >= (b[0] as number) && lon <= (b[2] as number) && lat >= (b[1] as number) && lat <= (b[3] as number);

const seChevauchent = (a: readonly number[], b: readonly number[]): boolean =>
    (a[0] as number) < (b[2] as number) && (b[0] as number) < (a[2] as number)
    && (a[1] as number) < (b[3] as number) && (b[1] as number) < (a[3] as number);

describe('table des emprises IGN', () => {
    it('la métropole garde son emprise historique (Corse comprise)', () => {
        expect(IGN_METROPOLE.bounds).toEqual([-5.6, 41.1, 9.8, 51.3]);
    });

    it('outre-mer : DROM + 975, 977, 978, codes uniques', () => {
        const codes = IGN_OUTRE_MER.map((t) => t.code);
        expect([...codes].sort()).toEqual(['971', '972', '973', '974', '975', '976', '977', '978']);
        expect(new Set(codes).size).toBe(codes.length);
    });

    it.each(Object.entries(VILLES))('l\'emprise %s est un rectangle valide qui contient %s', (code, [, lon, lat]) => {
        const t = IGN_OUTRE_MER.find((x) => x.code === code);
        expect(t).toBeDefined();
        const [w, s, e, n] = (t as { bounds: number[] }).bounds as [number, number, number, number];
        expect(w).toBeLessThan(e);
        expect(s).toBeLessThan(n);
        expect(contient([w, s, e, n], lon, lat)).toBe(true);
    });

    // Un rectangle de source ne doit jamais en recouper un autre : la même tuile
    // serait chargée deux fois, et une zone hors-ligne comptée deux fois.
    it('aucune emprise ne chevauche une autre, métropole comprise', () => {
        const toutes = [IGN_METROPOLE, ...IGN_OUTRE_MER];
        for (let i = 0; i < toutes.length; i++) {
            for (let j = i + 1; j < toutes.length; j++) {
                const a = toutes[i]!;
                const b = toutes[j]!;
                expect(seChevauchent(a.bounds, b.bounds), `${a.code} / ${b.code}`).toBe(false);
            }
        }
    });

    // Piège des tuiles blanches : l'ortho hors couverture rend une tuile blanche
    // opaque, donc une emprise ne doit pas déborder sur un autre territoire que
    // le sien. On vérifie au moins que la Dominique, Antigua et Anguilla (voisins
    // immédiats des Antilles, sondés BLANC ou 404) restent hors de nos rectangles.
    it('les voisins étrangers sondés hors couverture restent hors des emprises', () => {
        const voisins: [string, number, number][] = [
            ['Roseau (Dominique)', -61.39, 15.3],
            ['Saint John\'s (Antigua)', -61.85, 17.12],
            ['The Valley (Anguilla)', -63.05, 18.22],
            ['Port-Louis (Maurice)', 57.5, -20.16],
            ['Mutsamudu (Anjouan, Comores)', 44.43, -12.23],
            ['Fortune (Terre-Neuve)', -55.83, 47.07],
        ];
        for (const [nom, lon, lat] of voisins) {
            for (const t of IGN_OUTRE_MER) expect(contient(t.bounds, lon, lat), `${nom} dans ${t.code}`).toBe(false);
        }
    });
});

describe('couverture par famille (sonde Géoplateforme du 2026-10-02)', () => {
    const codes = (family: Parameters<typeof ignTerritories>[0]): string[] =>
        ignTerritories(family).map((t) => t.code);

    it('toujours la métropole en premier : son id de base ne change pas', () => {
        for (const family of ['ortho', 'planign', 'contours', 'lidar'] as const) {
            expect(ignTerritories(family)[0]).toBe(IGN_METROPOLE);
        }
    });

    it('ortho (BD ORTHO) et Plan IGN v2 : les 8 territoires sont servis', () => {
        const attendu = ['FR', '971', '972', '973', '974', '975', '976', '977', '978'];
        expect([...codes('ortho')].sort()).toEqual([...attendu].sort());
        expect([...codes('planign')].sort()).toEqual([...attendu].sort());
    });

    it('courbes de niveau : PAS en Guyane (973) ni à Saint-Pierre-et-Miquelon (975)', () => {
        expect([...codes('contours')].sort()).toEqual(['971', '972', '974', '976', '977', '978', 'FR']);
    });

    it('LiDAR HD : métropole + Guadeloupe + La Réunion seulement', () => {
        expect(codes('lidar')).toEqual(['FR', '971', '974']);
    });
});

describe('identifiants de sources et de couches', () => {
    it('la métropole garde l\'id de base ; l\'outre-mer prend le suffixe -<code>', () => {
        expect(ignLayerId('ign-ortho', IGN_METROPOLE)).toBe('ign-ortho');
        const gp = IGN_OUTRE_MER.find((t) => t.code === '971')!;
        expect(ignLayerId('ign-ortho', gp)).toBe('ign-ortho-971');
    });

    it('ignLayerIds liste métropole puis territoires servis', () => {
        expect(ignLayerIds('lidar', 'lidar-mnt')).toEqual(['lidar-mnt', 'lidar-mnt-971', 'lidar-mnt-974']);
        expect(ignLayerIds('contours', 'contours')).not.toContain('contours-973');
        expect(ignLayerIds('contours', 'contours')).toContain('contours-978');
    });
});

describe('ignSources / ignLayers — une source et une couche par territoire servi', () => {
    const spec = { tiles: ['https://exemple.test/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 11, maxzoom: 19, attribution: 'test' };

    it('ignSources : mêmes paramètres partout, seul `bounds` change', () => {
        const src = ignSources('lidar', 'lidar-mnt', spec);
        expect(Object.keys(src)).toEqual(['lidar-mnt', 'lidar-mnt-971', 'lidar-mnt-974']);
        for (const t of ignTerritories('lidar')) {
            const s = src[ignLayerId('lidar-mnt', t)] as unknown as { type: string; tiles: string[]; bounds: number[]; minzoom: number; maxzoom: number; attribution: string };
            expect(s.type).toBe('raster');
            expect(s.tiles).toEqual(spec.tiles);
            expect(s.minzoom).toBe(11);
            expect(s.maxzoom).toBe(19);
            expect(s.attribution).toBe('test');
            expect(s.bounds).toEqual(t.bounds);
        }
    });

    it('ignSources ne partage pas le tableau `tiles` entre territoires', () => {
        const src = ignSources('lidar', 'lidar-mnt', spec) as unknown as Record<string, { tiles: string[] }>;
        expect(src['lidar-mnt']!.tiles).not.toBe(src['lidar-mnt-971']!.tiles);
        expect(src['lidar-mnt']!.tiles).not.toBe(spec.tiles);
    });

    it('ignLayers : id = source, un calque neuf (layout/paint distincts) par territoire', () => {
        const layers = ignLayers('contours', 'contours', () => ({
            layout: { visibility: 'none' as const },
            paint: { 'raster-opacity': 0.9 },
        }));
        expect(layers.map((l) => l.id)).toEqual(ignLayerIds('contours', 'contours'));
        for (const l of layers) {
            expect(l.type).toBe('raster');
            expect(l.source).toBe(l.id);
            expect(l.layout).toEqual({ visibility: 'none' });
        }
        expect(layers[0]!.layout).not.toBe(layers[1]!.layout);
        expect(layers[0]!.paint).not.toBe(layers[1]!.paint);
    });
});

// Retours terrain 2026-10-02 : l'utilisateur qui active les courbes de niveau en Guyane ne
// voyait rien, sans explication (la Géoplateforme ne les sert pas là). Les bascules des deux
// cartes lisent cette aide pour le dire, d'après le centre de la carte (calcul local).
describe('ignTerritoryAt / ignUnservedAt — où une famille de couches n\'est pas servie', () => {
    it.each(Object.entries(VILLES))('%s : ignTerritoryAt trouve le territoire de %s', (code, [, lon, lat]) => {
        expect(ignTerritoryAt(lon, lat)?.code).toBe(code);
    });

    it('la métropole et les points hors de tout territoire', () => {
        expect(ignTerritoryAt(2.3522, 48.8566)).toBe(IGN_METROPOLE);
        expect(ignTerritoryAt(8.7386, 41.9192)).toBe(IGN_METROPOLE); // Ajaccio
        expect(ignTerritoryAt(-40, 30)).toBeNull(); // Atlantique
        expect(ignTerritoryAt(165.4, -21.2)).toBeNull(); // Nouvelle-Calédonie : hors périmètre
    });

    it('courbes de niveau : non servies en Guyane et à Saint-Pierre-et-Miquelon, servies ailleurs', () => {
        expect(ignUnservedAt('contours', -52.326, 4.9372)).toBe('Guyane');
        expect(ignUnservedAt('contours', -56.1773, 46.7766)).toBe('Saint-Pierre-et-Miquelon');
        expect(ignUnservedAt('contours', -61.5331, 16.2411)).toBeNull(); // Guadeloupe
        expect(ignUnservedAt('contours', 2.3522, 48.8566)).toBeNull(); // métropole
    });

    it('LiDAR HD : servi en Guadeloupe et à La Réunion, absent des autres territoires d\'outre-mer', () => {
        expect(ignUnservedAt('lidar', -61.5331, 16.2411)).toBeNull();
        expect(ignUnservedAt('lidar', 55.4481, -20.8789)).toBeNull();
        expect(ignUnservedAt('lidar', -61.0588, 14.6161)).toBe('Martinique');
        expect(ignUnservedAt('lidar', 45.2278, -12.7806)).toBe('Mayotte');
        expect(ignUnservedAt('lidar', -63.0824, 18.0679)).toBe('Saint-Martin');
    });

    it('en métropole la couverture du LiDAR HD est partielle par construction : jamais d\'avertissement', () => {
        expect(ignUnservedAt('lidar', 5.8, 45.35)).toBeNull();
    });

    it('ortho et Plan IGN sont servis partout : jamais d\'avertissement', () => {
        for (const [, lon, lat] of Object.values(VILLES)) {
            expect(ignUnservedAt('ortho', lon, lat)).toBeNull();
            expect(ignUnservedAt('planign', lon, lat)).toBeNull();
        }
    });

    it('hors de tout territoire : pas d\'avertissement (on ne sait rien de la zone)', () => {
        expect(ignUnservedAt('contours', -40, 30)).toBeNull();
    });
});
