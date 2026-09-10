/**
 * pm-gpx.test.ts — Import de traces GPX et panneau de calques
 * (`src/apps/pctac/planmap/gpx.ts`).
 *
 * `this` FACTICE portant un faux `map` (jamais `new maplibregl.Map` : WebGL
 * absent sous jsdom — SPEC-PCTAC-CONVERSION §8.4). `GpxStore` est mocké : les
 * tests portent sur le parsing, la composition GeoJSON et la gestion de
 * l'index, pas sur IndexedDB (déjà couvert par pc-imagestore.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GPX_CASING_LAYER, GPX_INDEX_KEY, GPX_LINE_LAYER, GPX_SRC } from '../../../src/apps/pctac/planmap/constants.js';
import { GpxMethods, groupByDay, operationalDayKey, parseGpx, trackTimeBounds } from '../../../src/apps/pctac/planmap/gpx.js';
import { createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { GpxTrackData, LngLatTuple, PlanGpxTrack, PlanMapInternal } from '../../../src/apps/pctac/planmap/types.js';

/** Contenu du magasin GPX simulé, réinitialisé à chaque test. */
const gpxDisk = new Map<string, GpxTrackData>();

vi.mock('@pctac/image-store.js', () => ({
    ImageStore: {},
    GpxStore: {
        put: async (id: string, track: GpxTrackData): Promise<void> => { gpxDisk.set(id, track); },
        get: async (id: string): Promise<GpxTrackData | null> => gpxDisk.get(id) ?? null,
        delete: async (id: string): Promise<void> => { gpxDisk.delete(id); },
        clear: async (): Promise<void> => { gpxDisk.clear(); },
    },
}));

vi.mock('maplibre-gl', () => {
    class FakeLngLatBounds {
        constructor(public sw?: unknown, public ne?: unknown) {}
        extend(): this { return this; }
    }
    return { default: { LngLatBounds: FakeLngLatBounds } };
});

interface FakeGeoJson { type: string; features: Array<{ geometry: { coordinates: LngLatTuple[] }; properties: Record<string, unknown> }> }

function makeFakeMap(existingLayers: readonly string[] = []) {
    const layers = new Set<string>(existingLayers);
    const sources = new Set<string>();
    const added: Array<{ id: string; before: string | undefined }> = [];
    let data: FakeGeoJson = { type: 'FeatureCollection', features: [] };
    return {
        added,
        get data(): FakeGeoJson { return data; },
        getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
        getSource: vi.fn((id: string) => (sources.has(id)
            ? { setData: (d: FakeGeoJson) => { data = d; } }
            : undefined)),
        addSource: vi.fn((id: string) => { sources.add(id); }),
        addLayer: vi.fn((spec: { id: string }, before?: string) => { layers.add(spec.id); added.push({ id: spec.id, before }); }),
        fitBounds: vi.fn(),
    };
}
type FakeMap = ReturnType<typeof makeFakeMap>;

function makeFakeThis(map: FakeMap | null): PlanMapInternal {
    return {
        ...createPlanMapState(),
        ...GpxMethods,
        map: map as unknown as PlanMapInternal['map'],
    } as unknown as PlanMapInternal;
}

const GPX_TRACK = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Fichier complet</name></metadata>
  <trk>
    <name>Boucle du Ventoux</name>
    <trkseg>
      <trkpt lat="44.10" lon="5.20"/>
      <trkpt lat="44.11" lon="5.21"/>
      <trkpt lat="44.12" lon="5.22"/>
    </trkseg>
    <trkseg>
      <trkpt lat="44.20" lon="5.30"/>
      <trkpt lat="44.21" lon="5.31"/>
    </trkseg>
  </trk>
</gpx>`;

beforeEach(() => {
    gpxDisk.clear();
    localStorage.clear();
    document.body.innerHTML = '';
});

// ============================================================
// parseGpx — fonction pure, aucune dépendance
// ============================================================
describe('parseGpx', () => {
    it('extrait un segment par <trkseg> et convertit en [lng, lat]', () => {
        const parsed = parseGpx(GPX_TRACK);
        expect(parsed).not.toBeNull();
        expect(parsed?.segments).toHaveLength(2);
        // GPX écrit lat puis lon ; GeoJSON attend l'inverse.
        expect(parsed?.segments[0]?.[0]).toEqual([5.2, 44.1]);
        expect(parsed?.segments[1]).toHaveLength(2);
    });

    it('préfère le nom de la trace à celui des métadonnées du fichier', () => {
        expect(parseGpx(GPX_TRACK)?.name).toBe('Boucle du Ventoux');
    });

    it('accepte une route <rte>/<rtept>', () => {
        const parsed = parseGpx(`<gpx><rte><name>Itinéraire</name>
            <rtept lat="48.85" lon="2.35"/><rtept lat="48.86" lon="2.36"/></rte></gpx>`);
        expect(parsed?.segments).toHaveLength(1);
        expect(parsed?.name).toBe('Itinéraire');
    });

    it('à défaut de trace ou de route, regroupe les <wpt> en une polyligne', () => {
        const parsed = parseGpx('<gpx><wpt lat="1" lon="2"/><wpt lat="3" lon="4"/></gpx>');
        expect(parsed?.segments).toEqual([[[2, 1], [4, 3]]]);
    });

    it('écarte un segment de moins de deux points : rien de visible à en tirer', () => {
        expect(parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>')).toBeNull();
    });

    it('ignore les points aux coordonnées absentes, non numériques ou hors bornes', () => {
        const parsed = parseGpx(`<gpx><trk><trkseg>
            <trkpt lat="44.10" lon="5.20"/>
            <trkpt lat="abc" lon="5.21"/>
            <trkpt lon="5.22"/>
            <trkpt lat="999" lon="5.23"/>
            <trkpt lat="44.13" lon="5.24"/>
        </trkseg></trk></gpx>`);
        expect(parsed?.segments[0]).toEqual([[5.2, 44.1], [5.24, 44.13]]);
    });

    it('renvoie null sur du XML invalide, sans jamais jeter', () => {
        expect(() => parseGpx('<gpx><trk>pas fermé')).not.toThrow();
        expect(parseGpx('<gpx><trk>pas fermé')).toBeNull();
    });

    it('renvoie null sur une entrée vide ou non textuelle', () => {
        expect(parseGpx('')).toBeNull();
        expect(parseGpx(null as unknown as string)).toBeNull();
    });

    it('renvoie null sur un GPX bien formé mais sans aucun point', () => {
        expect(parseGpx('<gpx><metadata><name>vide</name></metadata></gpx>')).toBeNull();
    });
});

// ============================================================
// parseGpx — horodatage des points
// ============================================================
describe('parseGpx — horodatage', () => {
    const DATE = `<gpx><trk><trkseg>
        <trkpt lat="44.10" lon="5.20"><time>2026-09-08T06:00:00Z</time></trkpt>
        <trkpt lat="44.11" lon="5.21"><time>2026-09-08T06:01:00Z</time></trkpt>
    </trkseg></trk></gpx>`;

    it('lit <time> et le rend en millisecondes epoch, aligné sur les coordonnées', () => {
        const parsed = parseGpx(DATE);
        expect(parsed?.times).toEqual([[Date.parse('2026-09-08T06:00:00Z'), Date.parse('2026-09-08T06:01:00Z')]]);
        expect(parsed?.times?.[0]).toHaveLength(parsed?.segments[0]?.length ?? -1);
    });

    it('trou dans les temps : le point garde sa place, son temps vaut null', () => {
        const parsed = parseGpx(`<gpx><trk><trkseg>
            <trkpt lat="1" lon="2"><time>2026-09-08T06:00:00Z</time></trkpt>
            <trkpt lat="3" lon="4"/>
            <trkpt lat="5" lon="6"><time>2026-09-08T06:02:00Z</time></trkpt>
        </trkseg></trk></gpx>`);
        expect(parsed?.segments[0]).toHaveLength(3);
        expect(parsed?.times?.[0]?.[1]).toBeNull();
        expect(parsed?.times?.[0]?.[0]).toBe(Date.parse('2026-09-08T06:00:00Z'));
        expect(parsed?.times?.[0]?.[2]).toBe(Date.parse('2026-09-08T06:02:00Z'));
    });

    it('un point REJETÉ ne laisse ni coordonnée ni temps : les deux tableaux restent alignés', () => {
        const parsed = parseGpx(`<gpx><trk><trkseg>
            <trkpt lat="1" lon="2"><time>2026-09-08T06:00:00Z</time></trkpt>
            <trkpt lat="999" lon="4"><time>2026-09-08T06:01:00Z</time></trkpt>
            <trkpt lat="5" lon="6"><time>2026-09-08T06:02:00Z</time></trkpt>
        </trkseg></trk></gpx>`);
        expect(parsed?.segments[0]).toHaveLength(2);
        expect(parsed?.times?.[0]).toHaveLength(2);
        // Le temps du point hors bornes a disparu avec lui, pas décalé sur le suivant.
        expect(parsed?.times?.[0]?.[1]).toBe(Date.parse('2026-09-08T06:02:00Z'));
    });

    it('aucun point daté : times vaut null, la trace est marquée non datée', () => {
        expect(parseGpx(GPX_TRACK)?.times).toBeNull();
    });

    it('<time> illisible : traité comme absent, jamais NaN', () => {
        const parsed = parseGpx(`<gpx><trk><trkseg>
            <trkpt lat="1" lon="2"><time>pas une date</time></trkpt>
            <trkpt lat="3" lon="4"><time>2026-09-08T06:00:00Z</time></trkpt>
        </trkseg></trk></gpx>`);
        expect(parsed?.times?.[0]?.[0]).toBeNull();
        expect(parsed?.times?.[0]?.[1]).toBe(Date.parse('2026-09-08T06:00:00Z'));
    });

    it('un itinéraire <rte> n a par nature aucun temps', () => {
        const parsed = parseGpx('<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte></gpx>');
        expect(parsed?.times).toBeNull();
    });
});

describe('trackTimeBounds', () => {
    it('rend le premier et le dernier temps non nuls, tous segments confondus', () => {
        expect(trackTimeBounds([[10, null, 30], [null, 5], [40]]))
            .toEqual({ startedAt: 5, endedAt: 40 });
    });

    it('trace non datée : les deux bornes sont nulles', () => {
        expect(trackTimeBounds(null)).toEqual({ startedAt: null, endedAt: null });
        expect(trackTimeBounds([[null, null]])).toEqual({ startedAt: null, endedAt: null });
    });
});

// ============================================================
// Couches carte
// ============================================================
describe('_ensureGpxLayers', () => {
    it('insère les deux couches SOUS les dessins quand ceux-ci existent', () => {
        const map = makeFakeMap(['plan-shapes-fill']);
        const fake = makeFakeThis(map);

        expect(fake._ensureGpxLayers()).toBe(true);
        expect(map.addSource).toHaveBeenCalledWith(GPX_SRC, expect.objectContaining({ type: 'geojson' }));
        // Une trace importée ne passe JAMAIS par-dessus les dessins de l'opérateur.
        expect(map.added).toEqual([
            { id: GPX_CASING_LAYER, before: 'plan-shapes-fill' },
            { id: GPX_LINE_LAYER, before: 'plan-shapes-fill' },
        ]);
    });

    it("sans couche de dessin encore posée : ajoute en haut de pile sans jeter", () => {
        const map = makeFakeMap();
        const fake = makeFakeThis(map);
        expect(fake._ensureGpxLayers()).toBe(true);
        expect(map.added.map(a => a.before)).toEqual([undefined, undefined]);
    });

    it('idempotent : un second appel ne recrée rien', () => {
        const map = makeFakeMap();
        const fake = makeFakeThis(map);
        fake._ensureGpxLayers();
        fake._ensureGpxLayers();
        expect(map.addLayer).toHaveBeenCalledTimes(2);
    });

    it('sans carte : renvoie false sans jeter (on retentera au prochain rendu)', () => {
        expect(makeFakeThis(null)._ensureGpxLayers()).toBe(false);
    });
});

describe('_renderGpxLayers', () => {
    it("ne publie que les traces VISIBLES, une feature par segment, couleur portée par la donnée", () => {
        const map = makeFakeMap(['plan-shapes-fill']);
        const fake = makeFakeThis(map);
        fake._gpxTracks = [
            { id: 'a', name: 'A', color: '#a855f7', visible: true },
            { id: 'b', name: 'B', color: '#06b6d4', visible: false },
        ];
        fake._gpxCoords = {
            a: { coords: [[[1, 1], [2, 2]], [[3, 3], [4, 4]]], times: null },
            b: { coords: [[[9, 9], [8, 8]]], times: null },
        };

        fake._renderGpxLayers();

        expect(map.data.features).toHaveLength(2);
        expect(map.data.features.every(f => f.properties.gpxId === 'a')).toBe(true);
        expect(map.data.features[0]?.properties.color).toBe('#a855f7');
    });

    it('écarte un segment de moins de deux points (LineString invalide)', () => {
        const map = makeFakeMap();
        const fake = makeFakeThis(map);
        fake._gpxTracks = [{ id: 'a', name: 'A', color: '#fff', visible: true }];
        fake._gpxCoords = { a: { coords: [[[1, 1]], [[2, 2], [3, 3]]], times: null } };

        fake._renderGpxLayers();

        expect(map.data.features).toHaveLength(1);
    });

    it('sans carte : ne jette pas', () => {
        expect(() => makeFakeThis(null)._renderGpxLayers()).not.toThrow();
    });
});

// ============================================================
// Import, visibilité, suppression
// ============================================================
describe('_importGpxFiles', () => {
    function gpxFile(name: string, content: string): File {
        return { name, text: async (): Promise<string> => content } as unknown as File;
    }

    it('importe un fichier, le persiste hors des formes, et le publie sur la carte', async () => {
        const map = makeFakeMap(['plan-shapes-fill']);
        const fake = makeFakeThis(map);
        document.body.innerHTML = '<div id="plan_gpx_list"></div>';

        await fake._importGpxFiles([gpxFile('rando.gpx', GPX_TRACK)]);

        expect(fake._gpxTracks).toHaveLength(1);
        expect(fake._gpxTracks[0]?.name).toBe('Boucle du Ventoux');
        expect(fake._gpxTracks[0]?.visible).toBe(true);
        // Coordonnées en IndexedDB, index seul en localStorage : jamais dans
        // pcTacPlanShapes, que la pile d'annulation recopie en entier.
        const id = fake._gpxTracks[0]?.id ?? '';
        expect(gpxDisk.get(id)?.coords).toHaveLength(2);
        expect(localStorage.getItem('pcTacPlanShapes')).toBeNull();
        const index = JSON.parse(localStorage.getItem(GPX_INDEX_KEY) ?? '[]') as PlanGpxTrack[];
        expect(index).toHaveLength(1);
        expect(Object.keys(index[0] ?? {}).sort()).toEqual(['color', 'endedAt', 'id', 'name', 'startedAt', 'visible']);
        expect(map.data.features).toHaveLength(2);
    });

    it("à défaut de nom dans le fichier, retombe sur le nom de fichier sans l'extension", async () => {
        const fake = makeFakeThis(makeFakeMap());
        await fake._importGpxFiles([gpxFile('Trace du 12-04.gpx',
            '<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>')]);
        expect(fake._gpxTracks[0]?.name).toBe('Trace du 12-04');
    });

    it("un fichier illisible n'annule pas le lot : les autres sont importés, l'utilisateur est averti", async () => {
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const fake = makeFakeThis(makeFakeMap());

        await fake._importGpxFiles([
            gpxFile('casse.gpx', 'pas du tout du xml <<<'),
            gpxFile('bonne.gpx', GPX_TRACK),
        ]);

        expect(fake._gpxTracks).toHaveLength(1);
        expect(fake._gpxTracks[0]?.name).toBe('Boucle du Ventoux');
        expect(alert).toHaveBeenCalledTimes(1);
        alert.mockRestore();
    });

    it('deux traces reçoivent deux couleurs différentes', async () => {
        const fake = makeFakeThis(makeFakeMap());
        await fake._importGpxFiles([gpxFile('a.gpx', GPX_TRACK), gpxFile('b.gpx', GPX_TRACK)]);
        expect(fake._gpxTracks).toHaveLength(2);
        expect(fake._gpxTracks[0]?.color).not.toBe(fake._gpxTracks[1]?.color);
    });

    it('liste vide : ne fait rien', async () => {
        const fake = makeFakeThis(makeFakeMap());
        await fake._importGpxFiles([]);
        expect(fake._gpxTracks).toHaveLength(0);
    });
});

describe('_toggleGpxTrack / _removeGpxTrack', () => {
    async function withOneTrack(): Promise<{ fake: PlanMapInternal; map: FakeMap; id: string }> {
        const map = makeFakeMap(['plan-shapes-fill']);
        const fake = makeFakeThis(map);
        document.body.innerHTML = '<div id="plan_gpx_list"></div>';
        await fake._importGpxFiles([
            { name: 'r.gpx', text: async (): Promise<string> => GPX_TRACK } as unknown as File,
        ]);
        return { fake, map, id: fake._gpxTracks[0]?.id ?? '' };
    }

    it('masquer une trace la retire de la carte SANS la supprimer', async () => {
        const { fake, map, id } = await withOneTrack();
        expect(map.data.features).toHaveLength(2);

        fake._toggleGpxTrack(id);

        expect(map.data.features).toHaveLength(0);
        expect(fake._gpxTracks).toHaveLength(1);
        expect(fake._gpxTracks[0]?.visible).toBe(false);
        // Les coordonnées restent sur le disque : réafficher est immédiat.
        expect(gpxDisk.has(id)).toBe(true);

        fake._toggleGpxTrack(id);
        expect(map.data.features).toHaveLength(2);
    });

    it('supprimer une trace la retire partout : index, mémoire, disque et carte', async () => {
        const { fake, map, id } = await withOneTrack();

        fake._removeGpxTrack(id);
        await Promise.resolve();

        expect(fake._gpxTracks).toHaveLength(0);
        expect(fake._gpxCoords[id]).toBeUndefined();
        expect(map.data.features).toHaveLength(0);
        expect(gpxDisk.has(id)).toBe(false);
        expect(JSON.parse(localStorage.getItem(GPX_INDEX_KEY) ?? '[]')).toEqual([]);
    });

    it('identifiant inconnu : sans effet, sans exception', async () => {
        const { fake } = await withOneTrack();
        expect(() => fake._toggleGpxTrack('inexistant')).not.toThrow();
        expect(() => fake._removeGpxTrack('inexistant')).not.toThrow();
        expect(fake._gpxTracks).toHaveLength(1);
    });
});

// ============================================================
// Rechargement au démarrage
// ============================================================
describe('_loadGpxTracks', () => {
    it("recharge les traces persistées et les republie sur la carte", async () => {
        gpxDisk.set('t1', { coords: [[[1, 1], [2, 2]]], times: null });
        localStorage.setItem(GPX_INDEX_KEY, JSON.stringify(
            [{ id: 't1', name: 'Trace 1', color: '#a855f7', visible: true }]));
        const map = makeFakeMap(['plan-shapes-fill']);
        const fake = makeFakeThis(map);

        await fake._loadGpxTracks();

        expect(fake._gpxTracks).toHaveLength(1);
        expect(fake._gpxCoords['t1']?.coords).toEqual([[[1, 1], [2, 2]]]);
        expect(map.data.features).toHaveLength(1);
    });

    it("écarte une entrée d'index dont les coordonnées ont disparu, et réécrit l'index", async () => {
        gpxDisk.set('t1', { coords: [[[1, 1], [2, 2]]], times: null });
        localStorage.setItem(GPX_INDEX_KEY, JSON.stringify([
            { id: 't1', name: 'Trace 1', color: '#a855f7', visible: true },
            { id: 'orphelin', name: 'Perdue', color: '#06b6d4', visible: true },
        ]));
        const fake = makeFakeThis(makeFakeMap());

        await fake._loadGpxTracks();

        // Pas de ligne fantôme dans le panneau pour une trace irrécupérable.
        expect(fake._gpxTracks.map(t => t.id)).toEqual(['t1']);
        expect(JSON.parse(localStorage.getItem(GPX_INDEX_KEY) ?? '[]')).toHaveLength(1);
    });

    it('index absent : ne jette pas, aucune trace', async () => {
        const fake = makeFakeThis(makeFakeMap());
        await expect(fake._loadGpxTracks()).resolves.toBeUndefined();
        expect(fake._gpxTracks).toHaveLength(0);
    });

    it('conserve une trace enregistrée comme masquée', async () => {
        gpxDisk.set('t1', { coords: [[[1, 1], [2, 2]]], times: null });
        localStorage.setItem(GPX_INDEX_KEY, JSON.stringify(
            [{ id: 't1', name: 'Trace 1', color: '#a855f7', visible: false }]));
        const map = makeFakeMap();
        const fake = makeFakeThis(map);

        await fake._loadGpxTracks();

        expect(fake._gpxTracks[0]?.visible).toBe(false);
        expect(map.data.features).toHaveLength(0);
    });
});

// ============================================================
// Panneau
// ============================================================
describe('_renderGpxList / _toggleGpxPanel', () => {
    it('liste vide : message explicite plutôt qu\'un panneau muet', () => {
        document.body.innerHTML = '<div id="plan_gpx_list"></div>';
        makeFakeThis(null)._renderGpxList();
        expect(document.querySelector('.plan-gpx-empty')?.textContent).toContain('Aucune trace');
    });

    it('une ligne par trace, avec son id, sa couleur et ses deux actions', () => {
        document.body.innerHTML = '<div id="plan_gpx_list"></div>';
        const fake = makeFakeThis(null);
        fake._gpxTracks = [{ id: 't1', name: 'Boucle', color: '#a855f7', visible: true }];

        fake._renderGpxList();

        const row = document.querySelector<HTMLElement>('.plan-gpx-row');
        expect(row?.dataset.gpxId).toBe('t1');
        expect(row?.querySelector('.plan-gpx-name')?.textContent).toBe('Boucle');
        expect(row?.querySelectorAll('[data-gpx-act]')).toHaveLength(2);
        // Œil ouvert quand la trace est visible, barré sinon.
        expect(row?.querySelector('[data-gpx-act="toggle"] .material-symbols-outlined')?.textContent).toBe('visibility');
    });

    it("échappe le nom : un nom piégé ne peut pas injecter de balise", () => {
        document.body.innerHTML = '<div id="plan_gpx_list"></div>';
        const fake = makeFakeThis(null);
        fake._gpxTracks = [{ id: 't1', name: '<img src=x onerror=alert(1)>', color: '#fff', visible: true }];

        fake._renderGpxList();

        const list = document.getElementById('plan_gpx_list');
        expect(list?.querySelector('img')).toBeNull();
        expect(list?.querySelector('.plan-gpx-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('bascule la classe .open et l\'état ARIA du bouton', () => {
        document.body.innerHTML = '<button id="plan_btn_gpx"></button><div id="plan_gpx_panel"><div id="plan_gpx_list"></div></div>';
        const fake = makeFakeThis(null);
        const panel = document.getElementById('plan_gpx_panel');
        const btn = document.getElementById('plan_btn_gpx');

        fake._toggleGpxPanel();
        expect(panel?.classList.contains('open')).toBe(true);
        expect(btn?.getAttribute('aria-expanded')).toBe('true');

        fake._toggleGpxPanel();
        expect(panel?.classList.contains('open')).toBe(false);
        expect(btn?.getAttribute('aria-expanded')).toBe('false');

        // Forçage explicite (exclusion mutuelle avec les autres panneaux).
        fake._toggleGpxPanel(true);
        expect(panel?.classList.contains('open')).toBe(true);
        fake._toggleGpxPanel(false);
        expect(panel?.classList.contains('open')).toBe(false);
    });

    it('sans panneau dans le DOM : ne jette pas', () => {
        expect(() => makeFakeThis(null)._toggleGpxPanel()).not.toThrow();
        expect(() => makeFakeThis(null)._renderGpxList()).not.toThrow();
    });
});

// ============================================================
// Journée opérationnelle
// ============================================================
describe('operationalDayKey / groupByDay', () => {
    /** Instant local, pour raisonner en heures locales comme le fait le code. */
    const local = (y: number, m: number, d: number, h: number, min = 0): number =>
        new Date(y, m - 1, d, h, min).getTime();

    it('bascule à 6h : une opération de nuit reste dans le jour de la VEILLE', () => {
        // 23h le 8, puis 2h du matin le 9 : même engagement, même jour opérationnel.
        expect(operationalDayKey(local(2026, 9, 8, 23, 30), 6)).toBe('2026-09-08');
        expect(operationalDayKey(local(2026, 9, 9, 2, 15), 6)).toBe('2026-09-08');
        // 7h le 9 : la bascule est passée, nouveau jour.
        expect(operationalDayKey(local(2026, 9, 9, 7, 0), 6)).toBe('2026-09-09');
    });

    it('bascule à 0h : on retrouve exactement le jour civil', () => {
        expect(operationalDayKey(local(2026, 9, 8, 23, 30), 0)).toBe('2026-09-08');
        expect(operationalDayKey(local(2026, 9, 9, 2, 15), 0)).toBe('2026-09-09');
    });

    it('groupByDay : du plus récent au plus ancien, les non datées en dernier', () => {
        const tracks: PlanGpxTrack[] = [
            { id: 'a', name: 'A', color: '#000', visible: true, startedAt: local(2026, 9, 8, 10) },
            { id: 'b', name: 'B', color: '#000', visible: true, startedAt: local(2026, 9, 9, 10) },
            { id: 'c', name: 'C', color: '#000', visible: true, startedAt: null },
            { id: 'd', name: 'D', color: '#000', visible: true, startedAt: local(2026, 9, 8, 14) },
        ];
        const groups = groupByDay(tracks, 6);
        expect(groups.map((g) => g.day)).toEqual(['2026-09-09', '2026-09-08', '']);
        expect(groups[1]?.tracks.map((t) => t.id)).toEqual(['a', 'd']);
        // Les traces sans date forment leur propre groupe, jamais mélangées.
        expect(groups[2]?.tracks.map((t) => t.id)).toEqual(['c']);
    });

    it('groupByDay : liste vide donne aucun groupe', () => {
        expect(groupByDay([], 6)).toEqual([]);
    });
});
