/**
 * pm-panels.test.ts — Comportement OBSERVÉ des 7 méthodes MINI-PANELS de
 * `modules/pctac/planMap.js` (GStart-main, 5596 LOC, lecture seule),
 * planMap.js:3745-4240. Écrit pour le portage `src/apps/pctac/planmap/panels.ts`
 * (P2.CONV, paquet `pm-panels`). Références `planMap.js:<ligne>` en commentaire.
 *
 * `this` FACTICE avec un faux `map` (jamais `new maplibregl.Map`, cf.
 * docs/SPEC-PCTAC-CONVERSION.md §8.4). `requestAnimationFrame` est mocké par
 * les fake timers de Vitest (précédent : tests/unit/pctac/pc-wheel.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PIN_ICONS } from '../../../src/apps/pctac/config.js';
import { PanelsMethods } from '../../../src/apps/pctac/planmap/panels.js';
import { createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { OtanColor, PlanMapInternal, PlanPin } from '../../../src/apps/pctac/planmap/types.js';

/** Fausse carte MapLibre minimale (getContainer/project/on/off/easeTo). */
function makeFakeMap(): {
    getContainer: () => HTMLElement;
    project: () => { x: number; y: number };
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    easeTo: ReturnType<typeof vi.fn>;
} {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return {
        getContainer: () => container,
        project: () => ({ x: 120, y: 80 }),
        on: vi.fn(),
        off: vi.fn(),
        easeTo: vi.fn(),
    };
}

function makePin(overrides: Partial<PlanPin> & Pick<PlanPin, 'id'>): PlanPin {
    return { lng: 2.35, lat: 48.85, ...overrides };
}

interface FakeMocks {
    closeWheel: ReturnType<typeof vi.fn>;
    renderPins: ReturnType<typeof vi.fn>;
    openPingOptionsWheel: ReturnType<typeof vi.fn>;
    openCreatePingWheel: ReturnType<typeof vi.fn>;
    quickPlacePing: ReturnType<typeof vi.fn>;
}

/** Construit un `this` factice conforme à `PlanMapInternal` pour `PanelsMethods`. */
function makeFakeThis(opts: { pins?: PlanPin[]; withMap?: boolean } = {}): { fake: PlanMapInternal; mocks: FakeMocks; pins: () => PlanPin[] } {
    const { pins = [], withMap = true } = opts;
    const state = createPlanMapState();
    let stored: PlanPin[] = pins;

    const otanColors: OtanColor[] = [
        { kind: 'Inter', color: '#3b82f6', icon: 'group' },
        { kind: 'Adv', color: '#ef4444', icon: 'person_alert' },
    ];

    const mocks: FakeMocks = {
        closeWheel: vi.fn(),
        renderPins: vi.fn(),
        openPingOptionsWheel: vi.fn(),
        openCreatePingWheel: vi.fn(),
        quickPlacePing: vi.fn(),
    };

    const base = {
        ...state,
        ...PanelsMethods,
        map: withMap ? (makeFakeMap() as unknown as PlanMapInternal['map']) : null,
        _closeWheel: mocks.closeWheel,
        _loadPins: (): PlanPin[] => stored,
        _savePins: (list: readonly PlanPin[]): void => {
            stored = list.slice();
        },
        _renderPins: mocks.renderPins,
        _openPingOptionsWheel: mocks.openPingOptionsWheel,
        _openCreatePingWheel: mocks.openCreatePingWheel,
        _otanColors: (): OtanColor[] => otanColors,
        _quickPlacePing: mocks.quickPlacePing,
    };

    const fake = base as unknown as PlanMapInternal;
    return { fake, mocks, pins: () => stored };
}

afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
});

describe('_openPinPhotoPanel / _openPinPhotoViewer (photo↔ping, Goal.md §4)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('_openPinPhotoPanel : ne jette pas quand le pin ciblé est absent', () => {
        const { fake } = makeFakeThis({ pins: [] });
        expect(() => fake._openPinPhotoPanel('missing')).not.toThrow();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });

    it('_openPinPhotoPanel : cliquer une vignette pose photoId, sauve, re-rend et ferme', () => {
        localStorage.setItem('pcTacPhotos', JSON.stringify([{ id: 'ph1', title: 'Recon' }]));
        const { fake, mocks, pins } = makeFakeThis({ pins: [makePin({ id: 'p1' })] });
        fake._openPinPhotoPanel('p1');
        vi.advanceTimersByTime(50);

        const tile = document.querySelector<HTMLButtonElement>('.plan-inline-panel .pin-photo-tile[data-id="ph1"]');
        expect(tile).not.toBeNull();
        tile?.click();

        expect(pins().find((x) => x.id === 'p1')?.photoId).toBe('ph1');
        expect(mocks.renderPins).toHaveBeenCalled();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });

    it('_openPinPhotoPanel : « Retirer la photo » DELETE le photoId (jamais `= undefined`)', () => {
        localStorage.setItem('pcTacPhotos', JSON.stringify([{ id: 'ph1', title: 'Recon' }]));
        const { fake, pins } = makeFakeThis({ pins: [makePin({ id: 'p1', photoId: 'ph1' })] });
        fake._openPinPhotoPanel('p1');
        vi.advanceTimersByTime(50);

        const rm = document.querySelector<HTMLButtonElement>('.plan-inline-panel [data-act="remove-photo"]');
        expect(rm).not.toBeNull();
        rm?.click();

        const p = pins().find((x) => x.id === 'p1');
        expect(p && 'photoId' in p).toBe(false);
    });

    it('_openPinPhotoViewer : ne jette pas sans pin ni sans photoId, et n\'ouvre rien', () => {
        const { fake } = makeFakeThis({ pins: [makePin({ id: 'p1' })] });
        expect(() => fake._openPinPhotoViewer('missing')).not.toThrow();
        expect(() => fake._openPinPhotoViewer('p1')).not.toThrow();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });

    it('_openPinPhotoViewer : « Retirer » supprime le photoId et ferme le panneau', () => {
        const { fake, pins } = makeFakeThis({ pins: [makePin({ id: 'p1', photoId: 'ph1' })] });
        fake._openPinPhotoViewer('p1');
        vi.advanceTimersByTime(50);

        const rm = document.querySelector<HTMLButtonElement>('.plan-inline-panel [data-act="remove"]');
        expect(rm).not.toBeNull();
        rm?.click();

        const p = pins().find((x) => x.id === 'p1');
        expect(p && 'photoId' in p).toBe(false);
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_closeInlinePanel (planMap.js:3745)', () => {
    it("ne jette pas quand aucun panneau n'est ouvert", () => {
        const { fake } = makeFakeThis();
        expect(() => fake._closeInlinePanel()).not.toThrow();
        expect(fake._inlinePanel).toBeNull();
    });
});

describe('_openInlinePanel / _closeInlinePanel (planMap.js:3759 / 3745)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('monte un .plan-inline-panel dans le conteneur de la carte et appelle onMount', () => {
        const { fake } = makeFakeThis();
        const onMount = vi.fn();
        const el = fake._openInlinePanel({ lng: 2, lat: 48 }, '<span>hi</span>', { onMount });

        expect(el.classList.contains('plan-inline-panel')).toBe(true);
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(1);
        expect(fake._inlinePanel).toBe(el);

        vi.advanceTimersByTime(50); // flush le double rAF de mount (opacity + onMount)
        expect(onMount).toHaveBeenCalledTimes(1);
        expect(onMount).toHaveBeenCalledWith(el);
    });

    it('_closeInlinePanel APPELLE __cleanup et retire l\'élément du DOM (planMap.js:3746-3751)', () => {
        const { fake } = makeFakeThis();
        const el = fake._openInlinePanel({ lng: 2, lat: 48 }, '<span>hi</span>');
        const cleanupSpy = vi.spyOn(el, '__cleanup');
        expect(document.body.contains(el)).toBe(true);

        fake._closeInlinePanel();

        expect(cleanupSpy).toHaveBeenCalledTimes(1);
        expect(document.body.contains(el)).toBe(false);
        expect(fake._inlinePanel).toBeNull();
    });

    it('ouvrir un second panneau ferme le premier : un seul .plan-inline-panel dans le document', () => {
        const { fake } = makeFakeThis();
        const el1 = fake._openInlinePanel({ lng: 2, lat: 48 }, '<span>1</span>');
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(1);

        const el2 = fake._openInlinePanel({ lng: 3, lat: 49 }, '<span>2</span>');
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(1);
        expect(document.body.contains(el1)).toBe(false);
        expect(document.body.contains(el2)).toBe(true);
        expect(fake._inlinePanel).toBe(el2);
    });

    it("ne jette pas quand this.map est absent (carte non initialisée) et ne monte rien", () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._openInlinePanel({ lng: 2, lat: 48 }, '<span>x</span>')).not.toThrow();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_editPinText (planMap.js:3870) — ping absent', () => {
    it('ne jette pas et n\'ouvre aucun panneau quand le pin ciblé est absent', () => {
        const { fake } = makeFakeThis({ pins: [] });
        expect(() => fake._editPinText('missing')).not.toThrow();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_editPinText (planMap.js:3870) — happy path', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('enregistrer met à jour le texte du pin et ferme le panneau', () => {
        const { fake, pins } = makeFakeThis({ pins: [makePin({ id: 'p1', text: 'ancien' })] });
        fake._editPinText('p1');
        vi.advanceTimersByTime(50);

        const input = document.querySelector<HTMLInputElement>('.plan-inline-panel input[type="text"]');
        expect(input).not.toBeNull();
        if (!input) return;
        input.value = 'nouveau texte';

        const saveBtn = document.querySelector<HTMLButtonElement>('.plan-inline-panel [data-act="save"]');
        expect(saveBtn).not.toBeNull();
        saveBtn?.click();

        expect(pins().find((p) => p.id === 'p1')?.text).toBe('nouveau texte');
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_editPinDiameter (planMap.js:3977) — ping absent', () => {
    it('ne jette pas quand le pin ciblé est absent', () => {
        const { fake } = makeFakeThis({ pins: [] });
        expect(() => fake._editPinDiameter('missing')).not.toThrow();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_editPinDiameter (planMap.js:3977) — happy path', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('cliquer un preset fixe diameterM et force showDiameter à true', () => {
        const { fake, pins } = makeFakeThis({ pins: [makePin({ id: 'p1' })] });
        fake._editPinDiameter('p1');
        vi.advanceTimersByTime(50);

        const presetBtn = document.querySelector<HTMLButtonElement>('.plan-inline-panel [data-preset="250"]');
        expect(presetBtn).not.toBeNull();
        presetBtn?.click();

        const p = pins().find((x) => x.id === 'p1');
        expect(p?.diameterM).toBe(250);
        expect(p?.showDiameter).toBe(true);
    });
});

describe('_openPinColorPanel (planMap.js:4149) — ping absent', () => {
    it('ne jette pas quand le pin ciblé est absent', () => {
        const { fake } = makeFakeThis({ pins: [] });
        expect(() => fake._openPinColorPanel('missing')).not.toThrow();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_openPinColorPanel (planMap.js:4149) — happy path', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('cliquer une pastille couleur met à jour color+kind du pin et ferme le panneau', () => {
        const { fake, pins } = makeFakeThis({ pins: [makePin({ id: 'p1', color: '#3b82f6', kind: 'Inter' })] });
        fake._openPinColorPanel('p1');
        vi.advanceTimersByTime(50);

        const chip = document.querySelector<HTMLButtonElement>('.plan-inline-panel button[data-color="#ef4444"]');
        expect(chip).not.toBeNull();
        chip?.click();

        const p = pins().find((x) => x.id === 'p1');
        expect(p?.color).toBe('#ef4444');
        expect(p?.kind).toBe('Adv');
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_openIconCatalogPanelForEdit (planMap.js:4180) — ping absent', () => {
    it('ne jette pas quand le pin ciblé est absent', () => {
        const { fake } = makeFakeThis({ pins: [] });
        expect(() => fake._openIconCatalogPanelForEdit('missing')).not.toThrow();
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });

    it('ne jette pas quand this.map est absent (easeTo encapsulé dans un try/catch)', () => {
        const { fake } = makeFakeThis({ pins: [makePin({ id: 'p1' })], withMap: false });
        expect(() => fake._openIconCatalogPanelForEdit('p1')).not.toThrow();
    });
});

describe('_openIconCatalogPanelForEdit (planMap.js:4180) — happy path', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("choisir une icône met à jour l'icône ET le libellé par défaut du pin", () => {
        const { fake, pins } = makeFakeThis({ pins: [makePin({ id: 'p1', icon: 'place', label: 'Ancien' })] });
        fake._openIconCatalogPanelForEdit('p1');
        vi.advanceTimersByTime(50);

        const target = PIN_ICONS[3];
        expect(target).toBeDefined();
        if (!target) return;
        const iconBtn = document.querySelector<HTMLButtonElement>(`.plan-inline-panel [data-id="${target.id}"]`);
        expect(iconBtn).not.toBeNull();
        iconBtn?.click();

        const p = pins().find((x) => x.id === 'p1');
        expect(p?.icon).toBe(target.id);
        expect(p?.label).toBe(target.label);
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});

describe('_openIconCatalogPanel (planMap.js:4069) — carte absente', () => {
    it('ne jette pas quand this.map est absent (easeTo encapsulé dans un try/catch)', () => {
        const { fake } = makeFakeThis({ withMap: false });
        expect(() => fake._openIconCatalogPanel({ lng: 2, lat: 48 })).not.toThrow();
    });
});

describe('_openIconCatalogPanel (planMap.js:4069-4146) — filtre PIN_ICONS sur la saisie', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('sans filtre : la grille affiche les 51 icônes de PIN_ICONS', () => {
        const { fake } = makeFakeThis();
        fake._openIconCatalogPanel({ lng: 2, lat: 48 });
        vi.advanceTimersByTime(50);

        const grid = document.querySelector('#cat-grid');
        expect(grid).not.toBeNull();
        expect(grid?.querySelectorAll('.cat-ic')).toHaveLength(PIN_ICONS.length);
    });

    it('taper "police" dans #cat-filter réduit la grille aux icônes correspondantes', () => {
        const { fake } = makeFakeThis();
        fake._openIconCatalogPanel({ lng: 2, lat: 48 });
        vi.advanceTimersByTime(50);

        const filterInput = document.querySelector<HTMLInputElement>('#cat-filter');
        expect(filterInput).not.toBeNull();
        if (!filterInput) return;
        filterInput.value = 'police';
        filterInput.dispatchEvent(new Event('input', { bubbles: true }));

        const expectedCount = PIN_ICONS.filter((ic) =>
            (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes('police'),
        ).length;
        expect(expectedCount).toBeGreaterThan(0);
        expect(expectedCount).toBeLessThan(PIN_ICONS.length);

        const grid = document.querySelector('#cat-grid');
        expect(grid?.querySelectorAll('.cat-ic')).toHaveLength(expectedCount);
    });

    it("un filtre sans correspondance vide entièrement la grille", () => {
        const { fake } = makeFakeThis();
        fake._openIconCatalogPanel({ lng: 2, lat: 48 });
        vi.advanceTimersByTime(50);

        const filterInput = document.querySelector<HTMLInputElement>('#cat-filter');
        if (!filterInput) return;
        filterInput.value = 'zzzzznotfound';
        filterInput.dispatchEvent(new Event('input', { bubbles: true }));

        const grid = document.querySelector('#cat-grid');
        expect(grid?.querySelectorAll('.cat-ic')).toHaveLength(0);
    });

    it('sélectionner une icône appelle _quickPlacePing avec kind/color par défaut et ferme le panneau', () => {
        const { fake, mocks } = makeFakeThis();
        fake._openIconCatalogPanel({ lng: 2, lat: 48 });
        vi.advanceTimersByTime(50);

        const firstIcon = document.querySelector<HTMLButtonElement>('.cat-ic');
        expect(firstIcon).not.toBeNull();
        firstIcon?.click();

        expect(mocks.quickPlacePing).toHaveBeenCalledTimes(1);
        expect(mocks.quickPlacePing.mock.calls[0]?.[1]).toEqual({ kind: 'Inter', color: '#3b82f6' });
        expect(document.querySelectorAll('.plan-inline-panel')).toHaveLength(0);
    });
});
