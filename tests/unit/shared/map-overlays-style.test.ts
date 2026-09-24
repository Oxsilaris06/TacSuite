/**
 * Les couches des surcouches (carroyage, MGRS, lignes électriques) passent le
 * validateur de style OFFICIEL de MapLibre. MapLibre ne signale une propriété
 * invalide qu'à l'exécution, en refusant la couche : deux erreurs de ce genre
 * (`line-dasharray`, puis `symbol-spacing` avec une expression de données)
 * avaient échappé aux tests, et la seconde empêchait même l'ajout des couches
 * suivantes (MGRS, carroyage).
 */
import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { OVERLAY_SOURCES, overlayLayers } from '@shared/map-overlays.js';

function validate(withBolt: boolean): string[] {
    const style = {
        version: 8 as const,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: Object.fromEntries(OVERLAY_SOURCES.map((id) => [id, { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } }])),
        layers: overlayLayers(withBolt),
    };
    return validateStyleMin(style as Parameters<typeof validateStyleMin>[0]).map((e) => e.message);
}

describe('surcouches de carte — style valide pour MapLibre', () => {
    it('avec les éclairs : aucune erreur de style', () => {
        expect(validate(true)).toEqual([]);
    });

    it('sans canevas (éclairs omis) : aucune erreur, et aucune couche ne vise une source absente', () => {
        expect(validate(false)).toEqual([]);
        const sources = new Set<string>(OVERLAY_SOURCES);
        for (const l of overlayLayers(true)) expect(sources.has((l as { source: string }).source)).toBe(true);
    });

    it('identifiants de couche uniques', () => {
        const ids = overlayLayers(true).map((l) => l.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
