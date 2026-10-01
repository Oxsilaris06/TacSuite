/**
 * sw-tile-route.test.ts — Routage des tuiles du service worker (décision 28/A2).
 *
 * `public/sw.ts` ne doit plus mettre en cache TOUT `data.geopf.fr` : la même
 * plateforme sert la recherche d'adresse (`/geocodage/search`), volatile. On
 * teste la fonction pure `isTileRequest` sans exécuter le service worker.
 */

import { describe, expect, it } from 'vitest';

import { OI_CARTO_RASTER_STYLE } from '@oi/carto/constants.js';
import { RASTER_STYLE } from '@pctac/planmap/constants.js';
import { isTileRequest, serveFromNetwork, shouldSkipWaitingOnInstall } from '@shared/sw-routes.js';

describe('isTileRequest', () => {
    it('accepte les chemins de tuiles de data.geopf.fr', () => {
        expect(isTileRequest(new URL('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile'))).toBe(true);
        expect(isTileRequest(new URL('https://data.geopf.fr/wmts/1.0.0/WMTSCapabilities.xml'))).toBe(true);
        expect(isTileRequest(new URL('https://data.geopf.fr/tms/1.0.0/ortho/12/2048/1408.png'))).toBe(true);
    });

    it('refuse la recherche d’adresse de data.geopf.fr', () => {
        expect(isTileRequest(new URL('https://data.geopf.fr/geocodage/search?q=Paris'))).toBe(false);
        expect(isTileRequest(new URL('https://data.geopf.fr/geocodage/reverse?lon=2&lat=48'))).toBe(false);
        // Un chemin qui commence par la même chaîne sans être une tuile.
        expect(isTileRequest(new URL('https://data.geopf.fr/wmtsfoo/bar'))).toBe(false);
    });

    it('accepte les autres fournisseurs de tuiles', () => {
        expect(isTileRequest(new URL('https://server.arcgisonline.com/ArcGIS/rest/services/x/1'))).toBe(true);
        expect(isTileRequest(new URL('https://elevation-tiles-prod.s3.amazonaws.com/terrarium/1/2/3.png'))).toBe(true);
        expect(isTileRequest(new URL('https://tiles.openfreemap.org/planet/1/2/3.pbf'))).toBe(true);
    });

    it('refuse tout autre hôte', () => {
        expect(isTileRequest(new URL('https://gist.githubusercontent.com/x/raw/annonce.json'))).toBe(false);
        expect(isTileRequest(new URL('https://example.com/wmts'))).toBe(false);
    });
});

// Retours terrain 2026-10-02 : la carto IGN couvre l'outre-mer. Le service worker
// route par HÔTE et par chemin (`/wmts`, `/tms`), jamais par emprise : une tuile de
// la Guadeloupe ou de La Réunion est donc mise en cache comme une tuile de métropole.
// On le prouve sur les URL que les deux styles génèrent réellement.
describe('isTileRequest — les tuiles IGN de chaque territoire sont mises en cache', () => {
    const sourceUrls = (style: { sources: Record<string, unknown> }): { id: string; url: URL }[] => {
        const out: { id: string; url: URL }[] = [];
        for (const [id, src] of Object.entries(style.sources)) {
            const tiles = (src as { tiles?: string[] }).tiles;
            if (!tiles) continue;
            // z14 sur Pointe-à-Pitre : le routage ne regarde pas x/y, mais autant tester un cas réel.
            for (const t of tiles) out.push({ id, url: new URL(t.replace('{z}', '14').replace('{x}', '5391').replace('{y}', '7442')) });
        }
        return out;
    };

    it.each([
        ['PC-Tac', RASTER_STYLE],
        ['OI', OI_CARTO_RASTER_STYLE],
    ])('%s : toute source data.geopf.fr (métropole ou outre-mer) est routée comme tuile', (_nom, style) => {
        const geopf = sourceUrls(style).filter(({ url }) => url.hostname === 'data.geopf.fr');
        // Métropole + territoires : bien plus que les 6 sources historiques.
        expect(geopf.length).toBeGreaterThan(30);
        for (const { id, url } of geopf) expect(isTileRequest(url), id).toBe(true);
        expect(geopf.map(({ id }) => id)).toEqual(expect.arrayContaining(['ign-ortho-971', 'planign-978', 'lidar-mnt-974']));
    });

    it('le routage ne dépend pas de la position de la tuile (aucune emprise métropole)', () => {
        for (const [z, x, y] of [[14, 5391, 7442], [14, 10715, 9163], [14, 5810, 7967], [8, 0, 0], [19, 524287, 524287]] as const) {
            const wmts = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&TILEMATRIX=${z}&TILECOL=${x}&TILEROW=${y}`;
            const tms = `https://data.geopf.fr/tms/1.0.0/HR.ORTHOIMAGERY.ORTHOPHOTOS/${z}/${x}/${y}.jpeg`;
            expect(isTileRequest(new URL(wmts))).toBe(true);
            expect(isTileRequest(new URL(tms))).toBe(true);
        }
    });
});

describe('shouldSkipWaitingOnInstall — transition depuis l’ancien SW (A-2)', () => {
    it('force l’activation seulement si un worker actif existe ET que la marque manque', () => {
        expect(shouldSkipWaitingOnInstall(true, false)).toBe(true);
        // Marque présente : le worker actif sait attendre, on ne force plus.
        expect(shouldSkipWaitingOnInstall(true, true)).toBe(false);
        // Première installation : rien à remplacer.
        expect(shouldSkipWaitingOnInstall(false, false)).toBe(false);
        expect(shouldSkipWaitingOnInstall(false, true)).toBe(false);
    });
});

describe('serveFromNetwork — navigation (revue du 25/09, A13)', () => {
    it('sert la réponse réseau sauf erreur serveur (5xx) : la copie précachée prend le relais', () => {
        expect(serveFromNetwork(200)).toBe(true);
        expect(serveFromNetwork(304)).toBe(true);
        expect(serveFromNetwork(404)).toBe(true);
        expect(serveFromNetwork(500)).toBe(false);
        expect(serveFromNetwork(502)).toBe(false);
        expect(serveFromNetwork(503)).toBe(false);
    });
});
