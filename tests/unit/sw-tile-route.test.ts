/**
 * sw-tile-route.test.ts — Routage des tuiles du service worker (décision 28/A2).
 *
 * `public/sw.ts` ne doit plus mettre en cache TOUT `data.geopf.fr` : la même
 * plateforme sert la recherche d'adresse (`/geocodage/search`), volatile. On
 * teste la fonction pure `isTileRequest` sans exécuter le service worker.
 */

import { describe, expect, it } from 'vitest';

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
