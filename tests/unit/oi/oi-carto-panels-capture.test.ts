/**
 * oi-carto-panels-capture.test.ts — Comportement OBSERVÉ de
 * `modules/oi_cartographie.js` (GStart-main, 1681 LOC, lecture seule) pour le
 * paquet `oi-carto-panels-capture` : `carto/panels.ts` (8 méthodes,
 * oi_cartographie.js:993-1158) + `carto/capture.ts` (6 méthodes,
 * oi_cartographie.js:1160-1308). Écrit AVANT le port (TDD, mission P3.CONV).
 * Références `oi_cartographie.js:<ligne>` en commentaire, cf.
 * SPEC-OI-CONVERSION.md §6.2, §6.3, §6.5.
 *
 * `this` FACTICE : jamais `new maplibregl.Map` (WebGL absent sous jsdom,
 * SPEC-OI-CONVERSION §13.5) — un faux `map` ne portant que la surface
 * réellement appelée (`getContainer`, `project`, `on`, `off`, `flyTo`,
 * `getZoom`, `triggerRepaint`, `getCanvas`).
 *
 * `PanelsMethods` est importé STATIQUEMENT (dépendances externes au groupe —
 * `_loadPins`/`_savePins`/`_renderPins`/`_esc`/`_removePin`/`_renderPingLists`,
 * groupes `state.ts`/`pins.ts` — mockées, § « seules les dépendances externes
 * au groupe sont mockées », même patron que `oi-carto-draw.test.ts`).
 *
 * `CaptureMethods` est rechargé DYNAMIQUEMENT à chaque test (`vi.doMock` +
 * `vi.resetModules()`) : seule façon de faire varier « html2canvas absent »
 * d'un test à l'autre sans toucher au module source (import statique
 * `import html2canvas from 'html2canvas'` dans capture.ts — même patron que
 * `@pctac/planmap/capture.ts` / `pm-capture.test.ts`).
 *
 * Doubles d'environnement jsdom posés localement (§13.5, aucune dépendance
 * npm ajoutée) :
 *   - `HTMLDialogElement.prototype.showModal`/`.close` : jsdom v30
 *     n'implémente ni l'un ni l'autre (l'attribut `open` EST en revanche
 *     correctement réfléchi) — polyfill minimal.
 *   - `DataTransfer` : absent de jsdom (aucune implémentation, même interne)
 *     — double minimal (`items.add`/`files`), scopé à `_exportToField`.
 *   - `HTMLInputElement.prototype.files` (setter) : jsdom valide strictement
 *     la valeur assignée contre son propre type interne `FileList` (non
 *     construisible depuis l'extérieur) — accesseur de remplacement scopé à
 *     `_exportToField`, restauré en `afterEach`.
 *   - `HTMLCanvasElement.prototype.getContext('2d')` : jsdom renvoie `null`
 *     (paquet `canvas` absent des dépendances) — mocké pour `_captureCanvas`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelsMethods } from '../../../src/apps/oi/carto/panels.js';
import type { OICartoInternal, OiCartoPin } from '../../../src/apps/oi/carto/types.js';
import { OIWheel } from '../../../src/apps/oi/carto/wheel.js';

// ---------------------------------------------------------------------------
// jsdom : polyfill minimal <dialog> (showModal/close absents, `open` réfléchi
// correctement) — installé une fois, aucun état à restaurer.
// ---------------------------------------------------------------------------
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
        this.setAttribute('open', '');
    };
}
if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
        this.removeAttribute('open');
    };
}

// ---------------------------------------------------------------------------
// Fabriques communes
// ---------------------------------------------------------------------------

interface FakeMap {
    getContainer: ReturnType<typeof vi.fn>;
    project: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    flyTo: ReturnType<typeof vi.fn>;
    getZoom: ReturnType<typeof vi.fn>;
    triggerRepaint: ReturnType<typeof vi.fn>;
    getCanvas: ReturnType<typeof vi.fn>;
}

function makeGlCanvas(clientWidth = 800, clientHeight = 600): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = clientWidth;
    c.height = clientHeight;
    Object.defineProperty(c, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(c, 'clientHeight', { value: clientHeight, configurable: true });
    return c;
}

/** Sous-ensemble RÉELLEMENT appelé de `maplibregl.Map` par panels.ts/capture.ts. */
function makeFakeMap(canvas?: HTMLCanvasElement): FakeMap {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return {
        getContainer: vi.fn(() => container),
        project: vi.fn((ll: { lng: number; lat: number }) => ({ x: ll.lng * 10, y: ll.lat * 10 })),
        on: vi.fn(),
        off: vi.fn(),
        flyTo: vi.fn(),
        getZoom: vi.fn(() => 10),
        triggerRepaint: vi.fn(),
        getCanvas: vi.fn(() => canvas ?? makeGlCanvas()),
    };
}

function makePin(overrides: Partial<OiCartoPin> = {}): OiCartoPin {
    return {
        id: 'pin_1',
        kind: 'member',
        label: 'Membre',
        memberTri: null,
        fonction: null,
        icon: null,
        color: null,
        lng: 5,
        lat: 6,
        ...overrides,
    };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// PanelsMethods (oi_cartographie.js:993-1158)
// ---------------------------------------------------------------------------

/** `this` factice pour `PanelsMethods` : les 21 méthodes PINS/persistance
 *  (groupes `state.ts`/`pins.ts`, hors périmètre) sont mockées. */
function makePanelsState(opts: {
    map?: FakeMap | null;
    pins?: OiCartoPin[];
    markers?: Map<string, unknown>;
} = {}): OICartoInternal {
    let pins = opts.pins ?? [makePin()];
    const state = {
        map: opts.map ?? null,
        _activeWheel: null,
        _inlinePanel: null,
        _inlinePanelMove: null,
        labelsVisible: true,
        markers: opts.markers ?? new Map<string, unknown>(),

        // Les 8 méthodes sous test — implémentations réelles.
        ...PanelsMethods,

        // Dépendances externes mockées (groupes `state.ts` / `pins.ts`).
        _loadPins: vi.fn((): OiCartoPin[] => pins),
        _savePins: vi.fn((list: readonly OiCartoPin[]): void => { pins = [...list]; }),
        _renderPins: vi.fn(),
        _esc: vi.fn((s: string | null | undefined): string => (s == null ? '' : String(s))),
        _removePin: vi.fn((id: string): void => { pins = pins.filter((p) => p.id !== id); }),
        _renderPingLists: vi.fn(),
    };
    return state as unknown as OICartoInternal;
}

describe('_closeWheel (oi_cartographie.js:997-999)', () => {
    it('ne fait rien si aucune roue active', () => {
        const state = makePanelsState();
        expect(() => state._closeWheel()).not.toThrow();
        expect(state._activeWheel).toBeNull();
    });

    it('détruit la roue active et la remet à null', () => {
        const state = makePanelsState();
        const destroy = vi.fn();
        state._activeWheel = { open: vi.fn(), destroy };

        state._closeWheel();

        expect(destroy).toHaveBeenCalledTimes(1);
        expect(state._activeWheel).toBeNull();
    });

    it('avale une exception de destroy() (try/catch verbatim)', () => {
        const state = makePanelsState();
        state._activeWheel = { open: vi.fn(), destroy: () => { throw new Error('boom'); } };

        expect(() => state._closeWheel()).not.toThrow();
        expect(state._activeWheel).toBeNull();
    });
});

describe('_closeInlinePanel (oi_cartographie.js:1001-1007)', () => {
    it('ne fait rien si aucun panneau ouvert', () => {
        const state = makePanelsState({ map: makeFakeMap() });
        expect(() => state._closeInlinePanel()).not.toThrow();
    });

    it('retire le panneau du DOM, détache move/zoom, remet les 2 champs à null', () => {
        const map = makeFakeMap();
        const state = makePanelsState({ map });
        const panel = document.createElement('div');
        document.body.appendChild(panel);
        const move = vi.fn();
        state._inlinePanel = panel;
        state._inlinePanelMove = move;

        state._closeInlinePanel();

        expect(document.body.contains(panel)).toBe(false);
        expect(map.off).toHaveBeenCalledWith('move', move);
        expect(map.off).toHaveBeenCalledWith('zoom', move);
        expect(state._inlinePanel).toBeNull();
        expect(state._inlinePanelMove).toBeNull();
    });

    it('ne touche pas map.off si _inlinePanelMove est déjà null', () => {
        const map = makeFakeMap();
        const state = makePanelsState({ map });
        state._inlinePanel = document.createElement('div');

        state._closeInlinePanel();

        expect(map.off).not.toHaveBeenCalled();
    });
});

describe('_openPinWheel (oi_cartographie.js:1009-1029)', () => {
    it('ne fait rien si le pin est introuvable', () => {
        const state = makePanelsState({ pins: [] });

        state._openPinWheel('missing');

        expect(state._activeWheel).toBeNull();
    });

    it('ferme la roue/le panneau existants avant d’en ouvrir une nouvelle', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [makePin({ id: 'p1' })] });
        const closeWheelSpy = vi.spyOn(state, '_closeWheel');
        const closePanelSpy = vi.spyOn(state, '_closeInlinePanel');

        state._openPinWheel('p1');

        expect(closeWheelSpy).toHaveBeenCalledTimes(1);
        expect(closePanelSpy).toHaveBeenCalledTimes(1);
    });

    it('construit une roue à 5 options + 1 bouton central, la détruit après l’action « Supprimer »', () => {
        const map = makeFakeMap();
        const state = makePanelsState({ map, pins: [makePin({ id: 'p1' })] });

        state._openPinWheel('p1');

        expect(state._activeWheel).toBeInstanceOf(OIWheel);
        const wheel = state._activeWheel as unknown as OIWheel;
        if (!wheel.element) throw new Error('wheel.element manquant');
        const buttons = wheel.element.querySelectorAll('button');
        expect(buttons.length).toBe(6); // 1 centre + 5 options (icon/color/rename/goto/delete)

        const deleteBtn = buttons[buttons.length - 1];
        if (!deleteBtn) throw new Error('bouton « Supprimer » introuvable');
        deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(state._removePin).toHaveBeenCalledWith('p1');
        expect(state._renderPingLists).toHaveBeenCalledTimes(1);
        expect(state._activeWheel).toBeNull();
    });

    it('l’action « Centrer » appelle map.flyTo avec un zoom au moins 17', () => {
        const map = makeFakeMap();
        map.getZoom.mockReturnValue(19);
        const state = makePanelsState({ map, pins: [makePin({ id: 'p2', lng: 3, lat: 44 })] });

        state._openPinWheel('p2');

        const wheel = state._activeWheel as unknown as OIWheel;
        if (!wheel.element) throw new Error('wheel.element manquant');
        const buttons = wheel.element.querySelectorAll('button');
        const gotoBtn = buttons[4]; // 0=centre,1=icon,2=color,3=rename,4=goto
        if (!gotoBtn) throw new Error('bouton « Centrer » introuvable');

        gotoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(map.flyTo).toHaveBeenCalledWith({ center: [3, 44], zoom: 19, speed: 1.2 });
    });
});

describe('_openInlinePanel (oi_cartographie.js:1032-1052)', () => {
    it('sans map : retourne le panneau construit mais NON attaché au DOM', () => {
        const state = makePanelsState({ map: null });
        const onMount = vi.fn();

        const panel = state._openInlinePanel({ lng: 1, lat: 2 }, '<b>hi</b>', onMount);

        expect(panel).toBeInstanceOf(HTMLDivElement);
        expect(panel.className).toBe('oi-carto-inline-panel');
        expect(panel.innerHTML).toBe('<b>hi</b>');
        expect(document.body.contains(panel)).toBe(false);
        expect(state._inlinePanel).toBeNull();
        expect(onMount).not.toHaveBeenCalled();
    });

    it('avec map : attache le panneau, positionne via project(), appelle onMount, s’abonne move/zoom', () => {
        const map = makeFakeMap();
        const state = makePanelsState({ map });
        const onMount = vi.fn();

        const panel = state._openInlinePanel({ lng: 5, lat: 6 }, '<i>x</i>', onMount);

        expect(map.getContainer).toHaveBeenCalled();
        expect(panel.style.left).toBe('50px'); // project(): lng*10
        expect(panel.style.top).toBe('34px'); // lat*10 - 26
        expect(map.on).toHaveBeenCalledWith('move', expect.any(Function));
        expect(map.on).toHaveBeenCalledWith('zoom', expect.any(Function));
        expect(state._inlinePanel).toBe(panel);
        expect(state._inlinePanelMove).toEqual(expect.any(Function));
        expect(onMount).toHaveBeenCalledWith(panel);
    });

    it('ferme un panneau déjà ouvert avant d’en construire un nouveau', () => {
        const state = makePanelsState({ map: makeFakeMap() });
        const closeSpy = vi.spyOn(state, '_closeInlinePanel');

        state._openInlinePanel({ lng: 0, lat: 0 }, 'a');

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('stopPropagation sur pointerdown/click à l’intérieur du panneau', () => {
        const state = makePanelsState({ map: makeFakeMap() });
        const panel = state._openInlinePanel({ lng: 0, lat: 0 }, '<span>x</span>');
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(evt, 'stopPropagation');

        panel.dispatchEvent(evt);

        expect(stopSpy).toHaveBeenCalled();
    });
});

describe('_openPinIconPanel (oi_cartographie.js:1054-1081)', () => {
    it('ne fait rien si le pin est introuvable', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [] });
        expect(() => state._openPinIconPanel('missing')).not.toThrow();
    });

    it('construit une grille avec les 28 icônes du catalogue', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [makePin({ id: 'p1' })] });

        state._openPinIconPanel('p1');

        expect(state._inlinePanel).not.toBeNull();
        const cells = state._inlinePanel?.querySelectorAll('.oi-ic') ?? [];
        expect(cells.length).toBe(28);
    });

    it('un clic sur une icône : met à jour pin.icon, sauvegarde, re-rend, ferme le panneau', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [makePin({ id: 'p1', icon: null })] });

        state._openPinIconPanel('p1');
        const btn = state._inlinePanel?.querySelector<HTMLButtonElement>('.oi-ic[data-id="pets"]');
        if (!btn) throw new Error('bouton icône « pets » introuvable');
        btn.click();

        expect(state._loadPins()[0]?.icon).toBe('pets');
        expect(state._savePins).toHaveBeenCalledTimes(1);
        expect(state._renderPins).toHaveBeenCalledTimes(1);
        expect(state._inlinePanel).toBeNull();
    });
});

describe('_openPinColorPanel (oi_cartographie.js:1083-1107)', () => {
    it('ne fait rien si le pin est introuvable', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [] });
        expect(() => state._openPinColorPanel('missing')).not.toThrow();
    });

    it('construit 8 pastilles de couleur ; un clic met à jour pin.color, sauvegarde, re-rend, ferme', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [makePin({ id: 'p1', color: null })] });

        state._openPinColorPanel('p1');
        const chips = state._inlinePanel?.querySelectorAll('.oi-col') ?? [];
        expect(chips.length).toBe(8);

        const btn = state._inlinePanel?.querySelector<HTMLButtonElement>('.oi-col[data-c="#ef4444"]');
        if (!btn) throw new Error('pastille rouge introuvable');
        btn.click();

        expect(state._loadPins()[0]?.color).toBe('#ef4444');
        expect(state._savePins).toHaveBeenCalledTimes(1);
        expect(state._renderPins).toHaveBeenCalledTimes(1);
        expect(state._inlinePanel).toBeNull();
    });
});

describe('_openPinRenamePanel (oi_cartographie.js:1109-1144)', () => {
    it('ne fait rien si le pin est introuvable', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [] });
        expect(() => state._openPinRenamePanel('missing')).not.toThrow();
    });

    it('bouton OK : applique le texte saisi et met à jour label (pin non-membre)', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [makePin({ id: 'p1', memberTri: null, label: 'Ancien' })] });

        state._openPinRenamePanel('p1');
        const input = state._inlinePanel?.querySelector<HTMLInputElement>('#oi_pin_rename_input');
        const ok = state._inlinePanel?.querySelector<HTMLButtonElement>('#oi_pin_rename_ok');
        if (!input || !ok) throw new Error('input/bouton introuvables');
        input.value = 'Nouveau nom';

        ok.click();

        const updated = state._loadPins()[0];
        expect(updated?.text).toBe('Nouveau nom');
        expect(updated?.label).toBe('Nouveau nom');
        expect(state._renderPins).toHaveBeenCalledTimes(1);
        expect(state._inlinePanel).toBeNull();
    });

    it('touche Entrée applique aussi ; pour un pin MEMBRE, ne touche PAS label (seulement text)', () => {
        const state = makePanelsState({ map: makeFakeMap(), pins: [makePin({ id: 'p1', memberTri: 'ABC', label: 'ABC' })] });

        state._openPinRenamePanel('p1');
        const input = state._inlinePanel?.querySelector<HTMLInputElement>('#oi_pin_rename_input');
        if (!input) throw new Error('input introuvable');
        input.value = 'Chef Inter';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

        const updated = state._loadPins()[0];
        expect(updated?.text).toBe('Chef Inter');
        expect(updated?.label).toBe('ABC');
    });
});

describe('_toggleLabels (oi_cartographie.js:1147-1158)', () => {
    it('bascule labelsVisible et le fab associé (classe + icône)', () => {
        const fab = document.createElement('button');
        fab.id = 'oi_carto_btn_labels';
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'label';
        fab.appendChild(icon);
        document.body.appendChild(fab);
        const state = makePanelsState();
        expect(state.labelsVisible).toBe(true);

        state._toggleLabels();

        expect(state.labelsVisible).toBe(false);
        expect(fab.classList.contains('active')).toBe(true);
        expect(icon.textContent).toBe('label_off');

        state._toggleLabels();

        expect(state.labelsVisible).toBe(true);
        expect(fab.classList.contains('active')).toBe(false);
        expect(icon.textContent).toBe('label');
    });

    it('affiche/masque les libellés de marker connus ; ignore silencieusement les entrées malformées', () => {
        const el1 = document.createElement('div');
        const el2 = document.createElement('div');
        const markers = new Map<string, unknown>([
            ['a', { pin: {}, label: { getElement: () => el1 } }],
            ['b', { pin: {}, label: { getElement: () => el2 } }],
            ['c', { pin: {} }], // pas de `label` — ignorée
            ['d', 'not-an-object'], // valeur non-objet — ignorée
            ['e', null], // valeur null — ignorée
        ]);
        const state = makePanelsState({ markers });

        expect(() => state._toggleLabels()).not.toThrow();

        expect(el1.style.display).toBe('none');
        expect(el2.style.display).toBe('none');
    });
});

// ---------------------------------------------------------------------------
// CaptureMethods (oi_cartographie.js:1160-1308)
// ---------------------------------------------------------------------------

type CaptureMethodsModule = typeof import('../../../src/apps/oi/carto/capture.js');

/** Recharge `capture.ts` avec `html2canvas` mocké à la valeur donnée pour CE test. */
async function loadCaptureMethods(html2canvasValue: unknown): Promise<CaptureMethodsModule['CaptureMethods']> {
    vi.resetModules();
    vi.doMock('html2canvas', () => ({ default: html2canvasValue }));
    const mod = await import('../../../src/apps/oi/carto/capture.js');
    return mod.CaptureMethods;
}

function makeCaptureState(captureMethods: CaptureMethodsModule['CaptureMethods'], map: FakeMap | null): OICartoInternal {
    const state = {
        map,
        ...captureMethods,
    };
    return state as unknown as OICartoInternal;
}

describe('_openCaptureModal (oi_cartographie.js:1164-1175)', () => {
    it('ne fait rien si la modale est absente', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        expect(() => state._openCaptureModal()).not.toThrow();
    });

    it('peuple le <select> avec les cibles disponibles et ouvre la modale', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        document.body.innerHTML = `
            <dialog id="oi_carto_capture_modal"></dialog>
            <select id="oi_carto_capture_target"></select>
            <div id="photo_container_transport_pr_preview_container"></div>
        `;
        const state = makeCaptureState(CaptureMethods, null);

        state._openCaptureModal();

        const sel = document.getElementById('oi_carto_capture_target') as HTMLSelectElement;
        expect(sel.innerHTML).toContain('photo_container_transport_pr_preview_container');
        expect(sel.innerHTML).toContain('Transport PSIG');
        const modal = document.getElementById('oi_carto_capture_modal') as HTMLDialogElement;
        expect(modal.open).toBe(true);
    });

    it('affiche l’option de repli quand aucune cible n’est disponible', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        document.body.innerHTML = `
            <dialog id="oi_carto_capture_modal"></dialog>
            <select id="oi_carto_capture_target"></select>
        `;
        const state = makeCaptureState(CaptureMethods, null);

        state._openCaptureModal();

        const sel = document.getElementById('oi_carto_capture_target') as HTMLSelectElement;
        expect(sel.innerHTML).toContain('Aucun champ photo disponible');
    });
});

describe('_closeCaptureModal (oi_cartographie.js:1177-1180)', () => {
    it('ferme la modale seulement si elle est ouverte', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        document.body.innerHTML = '<dialog id="oi_carto_capture_modal"></dialog>';
        const modal = document.getElementById('oi_carto_capture_modal') as HTMLDialogElement;
        modal.showModal();
        const state = makeCaptureState(CaptureMethods, null);

        state._closeCaptureModal();

        expect(modal.open).toBe(false);
    });

    it('ne fait rien si la modale est absente ou déjà fermée', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        expect(() => state._closeCaptureModal()).not.toThrow();
    });
});

describe('_getPhotoTargets (oi_cartographie.js:1185-1210)', () => {
    it('ne renvoie que les cibles dont le conteneur DOM existe réellement', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        document.body.innerHTML = `
            <div id="photo_container_transport_pr_preview_container"></div>
            <div class="moicp-block" data-block-id="m1">
                <input class="block-title-input" value="Entrée principale" />
            </div>
            <div id="photo_itin_ext_m1"></div>
            <div id="photo_itin_int_m1"></div>
        `;
        const state = makeCaptureState(CaptureMethods, null);

        const targets = state._getPhotoTargets();

        expect(targets).toEqual([
            { id: 'photo_container_transport_pr_preview_container', label: 'Transport PSIG → PR' },
            { id: 'photo_itin_ext_m1', label: 'Cheminement extérieur — Entrée principale' },
            { id: 'photo_itin_int_m1', label: 'Cheminement intérieur — Entrée principale' },
        ]);
        // "Transport PR → Domicile / LE" filtré (conteneur absent du DOM).
        expect(targets.some((t) => t.id === 'photo_container_transport_domicile_preview_container')).toBe(false);
    });

    it('replie sur le titre par défaut quand .block-title-input est absent', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        document.body.innerHTML = `
            <div class="zmspcp-block" data-block-id="z1"></div>
            <div id="photo_bapteme_z1"></div>
            <div id="photo_empl_ao_z1"></div>
        `;
        const state = makeCaptureState(CaptureMethods, null);

        const targets = state._getPhotoTargets();

        expect(targets).toEqual([
            { id: 'photo_bapteme_z1', label: 'Baptême terrain — ZMSPCP' },
            { id: 'photo_empl_ao_z1', label: 'Emplacement AO — ZMSPCP' },
        ]);
    });

    it('gère aussi les blocs Effraction', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        document.body.innerHTML = `
            <div class="effraction-block" data-block-id="e1">
                <input class="block-title-input" value="Porte arrière" />
            </div>
            <div id="photo_effrac_e1"></div>
        `;
        const state = makeCaptureState(CaptureMethods, null);

        const targets = state._getPhotoTargets();

        expect(targets).toEqual([{ id: 'photo_effrac_e1', label: 'Photo effraction — Porte arrière' }]);
    });

    it('aucun bloc/conteneur : liste vide', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);

        expect(state._getPhotoTargets()).toEqual([]);
    });
});

describe('_captureCanvas (oi_cartographie.js:1215-1260)', () => {
    beforeEach(() => {
        const fakeCtx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    });

    it('alerte et renvoie null si html2canvas est indisponible', async () => {
        const CaptureMethods = await loadCaptureMethods(undefined);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const state = makeCaptureState(CaptureMethods, makeFakeMap());

        const result = await state._captureCanvas();

        expect(result).toBeNull();
        expect(alertSpy).toHaveBeenCalledWith('Librairie html2canvas indisponible (réseau ?).');
    });

    it('renvoie null SANS alerter si #oi_carto_map_wrap est absent', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const state = makeCaptureState(CaptureMethods, makeFakeMap());

        const result = await state._captureCanvas();

        expect(result).toBeNull();
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('renvoie null si this.map est absent (même avec #oi_carto_map_wrap présent)', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        document.body.innerHTML = '<div id="oi_carto_map_wrap"></div>';
        const state = makeCaptureState(CaptureMethods, null);

        const result = await state._captureCanvas();

        expect(result).toBeNull();
    });

    it('compose canvas WebGL + overlay html2canvas ; masque puis restaure toolbar/hint (finally)', async () => {
        document.body.innerHTML = '<div id="oi_carto_map_wrap"></div>';
        const hint = document.createElement('div');
        hint.id = 'oi_carto_hint';
        hint.style.display = 'block';
        document.body.appendChild(hint);

        const overlayCanvas = document.createElement('canvas');
        const html2canvasMock = vi.fn().mockResolvedValue(overlayCanvas);
        const CaptureMethods = await loadCaptureMethods(html2canvasMock);
        const glCanvas = makeGlCanvas(800, 600);
        const map = makeFakeMap(glCanvas);
        const state = makeCaptureState(CaptureMethods, map);

        const result = await state._captureCanvas();

        expect(result).toBeInstanceOf(HTMLCanvasElement);
        expect(result?.width).toBe(800);
        expect(result?.height).toBe(600);
        expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
        expect(html2canvasMock).toHaveBeenCalledWith(
            document.getElementById('oi_carto_map_wrap'),
            expect.objectContaining({ scale: 1, width: 800, height: 600 }),
        );
        expect(hint.style.display).toBe('block'); // restauré après capture
    });

    it('alerte, renvoie null et restaure `toHide` si html2canvas jette (finally sur exception)', async () => {
        document.body.innerHTML = '<div id="oi_carto_map_wrap"></div>';
        const hint = document.createElement('div');
        hint.id = 'oi_carto_hint';
        hint.style.display = 'block';
        document.body.appendChild(hint);
        const boom = new Error('html2canvas a explosé');
        const CaptureMethods = await loadCaptureMethods(vi.fn().mockRejectedValue(boom));
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });
        const state = makeCaptureState(CaptureMethods, makeFakeMap(makeGlCanvas()));

        const result = await state._captureCanvas();

        expect(result).toBeNull();
        expect(alertSpy).toHaveBeenCalledWith('Erreur lors de la capture : html2canvas a explosé');
        expect(hint.style.display).toBe('block');
        expect(errSpy).toHaveBeenCalled();
    });
});

describe('_downloadCapture (oi_cartographie.js:1262-1277)', () => {
    it('ne télécharge rien si la capture échoue (canvas null)', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._captureCanvas = vi.fn().mockResolvedValue(null);
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ });

        await state._downloadCapture();

        expect(clickSpy).not.toHaveBeenCalled();
    });

    it('déclenche le téléchargement : lien <a download="carte-oi-…png"> cliqué avec le bon href', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._captureCanvas = vi.fn().mockResolvedValue(document.createElement('canvas'));
        const blob = new Blob(['x'], { type: 'image/png' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) { cb(blob); });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { /* no-op */ });
        const clicks: { href: string; download: string }[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            clicks.push({ href: this.href, download: this.download });
        });

        await state._downloadCapture();

        expect(clicks).toHaveLength(1);
        expect(clicks[0]?.href).toBe('blob:mock-url');
        expect(clicks[0]?.download).toMatch(/^carte-oi-.*\.png$/);
    });

    it('ne télécharge rien si toBlob() résout un blob null', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._captureCanvas = vi.fn().mockResolvedValue(document.createElement('canvas'));
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) { cb(null); });
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ });

        await state._downloadCapture();

        expect(clickSpy).not.toHaveBeenCalled();
    });
});

describe('_exportToField (oi_cartographie.js:1281-1308)', () => {
    let nativeFilesDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        // jsdom : `DataTransfer` n'existe pas du tout (§ en-tête de fichier) —
        // double minimal, scopé à ce bloc.
        class FakeDataTransfer {
            private _files: File[] = [];
            items = { add: (file: File): void => { this._files.push(file); } };
            get files(): File[] { return this._files; }
        }
        vi.stubGlobal('DataTransfer', FakeDataTransfer);

        // jsdom : le setter natif de `HTMLInputElement.files` valide strictement
        // la valeur contre son propre type interne `FileList` — accesseur de
        // remplacement le temps de ce bloc, restauré en `afterEach`.
        nativeFilesDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
        Object.defineProperty(HTMLInputElement.prototype, 'files', {
            configurable: true,
            get(this: HTMLInputElement & { __fakeFiles?: FileList }): FileList | null {
                return this.__fakeFiles ?? null;
            },
            set(this: HTMLInputElement & { __fakeFiles?: FileList }, value: FileList): void {
                this.__fakeFiles = value;
            },
        });
    });

    afterEach(() => {
        if (nativeFilesDescriptor) {
            Object.defineProperty(HTMLInputElement.prototype, 'files', nativeFilesDescriptor);
        }
        delete (window as unknown as Record<string, unknown>).handleFileChange;
        delete (window as unknown as Record<string, unknown>).toast;
    });

    it('ne fait rien si containerId est vide (retour avant toute vérification)', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        const captureSpy = vi.fn();
        state._captureCanvas = captureSpy;

        await state._exportToField('');

        expect(captureSpy).not.toHaveBeenCalled();
    });

    it('alerte « Pipeline photo indisponible. » si window.handleFileChange est absent', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const captureSpy = vi.fn();
        state._captureCanvas = captureSpy;

        await state._exportToField('container_x');

        expect(alertSpy).toHaveBeenCalledWith('Pipeline photo indisponible.');
        expect(captureSpy).not.toHaveBeenCalled();
    });

    it('appelle window.handleFileChange avec un input factice, le bon containerId et `false` ; ferme la modale ; toast', async () => {
        document.body.innerHTML = '<dialog id="oi_carto_capture_modal"></dialog>';
        const modal = document.getElementById('oi_carto_capture_modal') as HTMLDialogElement;
        modal.showModal();
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._captureCanvas = vi.fn().mockResolvedValue(document.createElement('canvas'));
        const blob = new Blob(['x'], { type: 'image/jpeg' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) { cb(blob); });
        const handleFileChangeMock = vi.fn().mockResolvedValue(undefined);
        (window as unknown as Record<string, unknown>).handleFileChange = handleFileChangeMock;
        const toastMock = vi.fn();
        (window as unknown as Record<string, unknown>).toast = toastMock;

        await state._exportToField('container_photo_x');

        expect(handleFileChangeMock).toHaveBeenCalledTimes(1);
        const call = handleFileChangeMock.mock.calls[0];
        if (!call) throw new Error('handleFileChange non appelé');
        expect(call[0]).toBeInstanceOf(HTMLInputElement);
        expect(call[1]).toBe('container_photo_x');
        expect(call[2]).toBe(false);
        expect(modal.open).toBe(false);
        expect(toastMock).toHaveBeenCalledWith('Capture de carte ajoutée au champ photo.');
    });

    it('replie sur alert() si window.toast est absent', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._closeCaptureModal = vi.fn();
        state._captureCanvas = vi.fn().mockResolvedValue(document.createElement('canvas'));
        const blob = new Blob(['x'], { type: 'image/jpeg' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) { cb(blob); });
        (window as unknown as Record<string, unknown>).handleFileChange = vi.fn().mockResolvedValue(undefined);
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        await state._exportToField('container_y');

        expect(alertSpy).toHaveBeenCalledWith('Capture de carte ajoutée au champ photo.');
    });

    it('alerte « Capture échouée. » si le blob est null', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._captureCanvas = vi.fn().mockResolvedValue(document.createElement('canvas'));
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) { cb(null); });
        (window as unknown as Record<string, unknown>).handleFileChange = vi.fn();
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        await state._exportToField('container_z');

        expect(alertSpy).toHaveBeenCalledWith('Capture échouée.');
    });

    it('ne fait rien si _captureCanvas résout null (capture échouée en amont)', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._captureCanvas = vi.fn().mockResolvedValue(null);
        (window as unknown as Record<string, unknown>).handleFileChange = vi.fn();
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        await state._exportToField('container_w');

        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('alerte « Export impossible : … » si handleFileChange jette', async () => {
        const CaptureMethods = await loadCaptureMethods(vi.fn());
        const state = makeCaptureState(CaptureMethods, null);
        state._captureCanvas = vi.fn().mockResolvedValue(document.createElement('canvas'));
        const blob = new Blob(['x'], { type: 'image/jpeg' });
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) { cb(blob); });
        (window as unknown as Record<string, unknown>).handleFileChange = vi.fn().mockRejectedValue(new Error('pipeline HS'));
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });

        await state._exportToField('container_v');

        expect(alertSpy).toHaveBeenCalledWith('Export impossible : pipeline HS');
        expect(errSpy).toHaveBeenCalled();
    });
});
