/**
 * pm-pingmodal.test.ts — Comportement OBSERVÉ de `modules/pctac/planMap.js`
 * (GStart-main, 5596 LOC, lecture seule) pour le paquet `pm-pingmodal` :
 * `planmap/ping-modal.ts` (8 méthodes « MODALE PING », planMap.js:957-1154,
 * cf. docs/SPEC-PLANMAP-SPLIT.md §4.5, §9).
 *
 * `this` TOUJOURS factice (jamais `new maplibregl.Map`, cf. §8.4 de
 * docs/SPEC-PCTAC-CONVERSION.md) : `makeFakeThis()` combine `createPlanMapState()`
 * (état initial réel) + les 8 VRAIES méthodes de `PingModalMethods` (le groupe
 * sous test — leurs appels croisés `this._setSelectedIcon()`,
 * `this._closePingModal()`… s'exécutent pour de vrai) + des stubs `vi.fn()`
 * pour les méthodes des AUTRES paquets (`_loadPins` : pins.ts, `_showHint`/
 * `_hideHint` : chrome.ts).
 *
 * `Storage.loadCollection` (paquet `pctac/storage.ts`) est mocké via
 * `vi.spyOn` pour le test métier de `_renderPingEntities` — pas de dépendance
 * à `localStorage`/`Persist`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// R2-T2a : `alert()` → `toast(..., { kind: 'error' })` (`_armFreePinPlacement`,
// planMap.js:1142-1154). Module mocké plutôt que `vi.stubGlobal('alert', ...)`.
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../src/shared/feedback.js', () => ({ toast: toastSpy }));

import { ADVERSARIES_KEY, FRIENDS_KEY, HOSTAGES_KEY, PIN_ICONS } from '../../../src/apps/pctac/config.js';
import { Storage } from '../../../src/apps/pctac/storage.js';
import { PingModalMethods } from '../../../src/apps/pctac/planmap/ping-modal.js';
import { createPlanMapState } from '../../../src/apps/pctac/planmap/state.js';
import type { PlanMapInternal, PlanPin } from '../../../src/apps/pctac/planmap/types.js';

/** Fabrique un `this` factice : état réel (`createPlanMapState`) + les 8 vraies
 *  méthodes du groupe sous test + stubs pour les dépendances externes. */
function makeFakeThis(pins: PlanPin[] = []): {
    fake: PlanMapInternal;
    showHint: ReturnType<typeof vi.fn>;
    hideHint: ReturnType<typeof vi.fn>;
} {
    const showHint = vi.fn();
    const hideHint = vi.fn();
    const base = {
        ...createPlanMapState(),
        // Les 8 vraies méthodes du groupe sous test : appels croisés réels
        // (`this._setSelectedIcon()`, `this._closePingModal()`, etc.).
        ...PingModalMethods,
        _loadPins: (): PlanPin[] => pins,
        _showHint: showHint,
        _hideHint: hideHint,
    };
    // Cast légitime this-factice (cf. docs/SPEC-PLANMAP-SPLIT.md §1.2 point 4 et
    // pm-wheels.test.ts) : `base` ne porte que le sous-ensemble de
    // `PlanMapInternal` réellement exercé par les 8 méthodes de ping-modal.ts.
    return { fake: base as unknown as PlanMapInternal, showHint, hideHint };
}

/**
 * Monte le DOM minimal de la modale Ping + du picker d'icônes (pctac2.html:2009-2154).
 * R2-T1 (migration `<dialog>` natif) : `#pingModal` est un `<dialog>` (plus un
 * `<div>`) — sans fond `#modalBackdrop` séparé (remplacé par le `::backdrop`
 * intrinsèque du dialog).
 *
 * `HTMLDialogElement.showModal`/`.close` n'existent PAS sous jsdom (vérifié :
 * jsdom 30.0.1 génère l'interface IDL — `.open` est un booléen réactif — mais
 * `HTMLDialogElementImpl` n'implémente ni `showModal` ni `close`, cf. le sujet
 * dépend du rendu/« top layer » que jsdom ne fait pas). Même limite déjà
 * documentée et contournée côté OI (`tests/unit/oi/oi-dessin.test.ts:25-26`,
 * `populateMemberCanvasModal`) : on stubbe `showModal`/`close` en `vi.fn()` sur
 * l'élément monté, puis on assert `toHaveBeenCalled()` au lieu de lire `.open`.
 */
function mountPingModalDom(): {
    modal: HTMLDialogElement;
    labelInput: HTMLInputElement;
    colorInput: HTMLInputElement;
    kindInput: HTMLInputElement;
    vehicleInput: HTMLInputElement;
    iconHidden: HTMLInputElement;
    iconGlyph: HTMLElement;
    iconLabel: HTMLElement;
    suggestWrap: HTMLElement;
    suggestBox: HTMLElement;
    pickerToggle: HTMLElement;
    catalog: HTMLElement;
    search: HTMLInputElement;
    grid: HTMLElement;
    entitiesList: HTMLElement;
} {
    document.body.innerHTML = `
        <dialog class="modal" id="pingModal">
            <div id="ping_entities_list"></div>
            <input type="text" id="free_pin_label" autocomplete="off">
            <input type="hidden" id="free_pin_color" value="#3b82f6">
            <input type="hidden" id="free_pin_kind" value="Inter">
            <input type="checkbox" id="free_pin_is_vehicle">
            <div id="pin_icon_suggestions_wrap" style="display: none;">
                <div id="pin_icon_suggestions"></div>
            </div>
            <button type="button" id="pin_icon_picker_toggle"></button>
            <span id="pin_icon_current_glyph">place</span>
            <span id="pin_icon_current_label">Pin par défaut</span>
            <input type="hidden" id="free_pin_icon" value="">
            <div id="pin_icon_catalog" style="display: none;">
                <input type="text" id="pin_icon_search" autocomplete="off">
                <div id="pin_icon_grid"></div>
            </div>
        </dialog>
    `;
    const modal = document.getElementById('pingModal') as HTMLDialogElement;
    modal.showModal = vi.fn();
    modal.close = vi.fn();
    return {
        modal,
        labelInput: document.getElementById('free_pin_label') as HTMLInputElement,
        colorInput: document.getElementById('free_pin_color') as HTMLInputElement,
        kindInput: document.getElementById('free_pin_kind') as HTMLInputElement,
        vehicleInput: document.getElementById('free_pin_is_vehicle') as HTMLInputElement,
        iconHidden: document.getElementById('free_pin_icon') as HTMLInputElement,
        iconGlyph: document.getElementById('pin_icon_current_glyph') as HTMLElement,
        iconLabel: document.getElementById('pin_icon_current_label') as HTMLElement,
        suggestWrap: document.getElementById('pin_icon_suggestions_wrap') as HTMLElement,
        suggestBox: document.getElementById('pin_icon_suggestions') as HTMLElement,
        pickerToggle: document.getElementById('pin_icon_picker_toggle') as HTMLElement,
        catalog: document.getElementById('pin_icon_catalog') as HTMLElement,
        search: document.getElementById('pin_icon_search') as HTMLInputElement,
        grid: document.getElementById('pin_icon_grid') as HTMLElement,
        entitiesList: document.getElementById('ping_entities_list') as HTMLElement,
    };
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    toastSpy.mockClear();
});

describe('PingModalMethods — les 8 méthodes ne jettent pas quand le DOM attendu est absent (planMap.js:957-1154)', () => {
    it('_openPingModal', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._openPingModal()).not.toThrow();
    });

    it('_closePingModal', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._closePingModal()).not.toThrow();
    });

    it('_renderPingEntities', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._renderPingEntities()).not.toThrow();
    });

    it('_setSelectedIcon', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._setSelectedIcon('local_police', 'Police')).not.toThrow();
    });

    it('_refreshIconSuggestions', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._refreshIconSuggestions('pompier')).not.toThrow();
    });

    it('_renderIconCatalog', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._renderIconCatalog('')).not.toThrow();
    });

    it('_bindIconPickerOnce', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._bindIconPickerOnce()).not.toThrow();
    });

    it('_armFreePinPlacement', () => {
        const { fake } = makeFakeThis();
        expect(() => fake._armFreePinPlacement()).not.toThrow();
    });
});

describe('_openPingModal / _closePingModal (planMap.js:957-975) — DOM présent', () => {
    it('_openPingModal affiche la modale, réinitialise le libellé/la case véhicule et rend entités + catalogue', () => {
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();
        dom.labelInput.value = 'ancien texte';
        dom.vehicleInput.checked = true;

        fake._openPingModal();

        expect(dom.modal.showModal).toHaveBeenCalled();
        expect(dom.labelInput.value).toBe('');
        expect(dom.vehicleInput.checked).toBe(false);
        expect(dom.catalog.style.display).toBe('none');
        // _setSelectedIcon('', 'Pin par défaut') a été appelée réellement (cross-appel du groupe)
        expect(dom.iconGlyph.textContent).toBe('place');
        expect(dom.iconLabel.textContent).toBe('Pin par défaut');
        // _bindIconPickerOnce a câblé le picker (idempotence testée séparément)
        expect(fake._iconPickerBound).toBe(true);
    });

    it('_closePingModal ferme la modale', () => {
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();

        fake._closePingModal();

        expect(dom.modal.close).toHaveBeenCalled();
    });
});

describe('_renderPingEntities (planMap.js:978-1027) — assertion métier', () => {
    it('produit une ligne par entité des 3 collections chargées via Storage (mocké)', () => {
        const adversaries = [
            { id: 'a1', nom: 'Dupont', prenom: 'Jean' },
            { id: 'a2', unite: 'Groupe A' },
        ];
        const hostages = [{ id: 'h1', nom: 'Otage1' }];
        const friends = [{ id: 'f1', unite: 'GIGN' }];

        vi.spyOn(Storage, 'loadCollection').mockImplementation((key: string) => {
            if (key === ADVERSARIES_KEY) return adversaries;
            if (key === HOSTAGES_KEY) return hostages;
            if (key === FRIENDS_KEY) return friends;
            return [];
        });

        const { fake } = makeFakeThis([]);
        mountPingModalDom();

        fake._renderPingEntities();

        const rows = document.querySelectorAll<HTMLElement>('#ping_entities_list .plan-entity-item');
        // 2 adversaires + 1 otage + 1 ami = 4 lignes, une par entité des 3 collections.
        expect(rows).toHaveLength(4);
        const kinds = Array.from(rows).map((el) => el.dataset.kind);
        expect(kinds.filter((k) => k === 'adv')).toHaveLength(2);
        expect(kinds.filter((k) => k === 'host')).toHaveLength(1);
        expect(kinds.filter((k) => k === 'friend')).toHaveLength(1);
        const ids = Array.from(rows).map((el) => el.dataset.id);
        expect(ids.sort()).toEqual(['a1', 'a2', 'f1', 'h1']);
    });

    it('marque "placé" une entité déjà associée à un pin et ne pose pas de handler d\'armement pour elle', () => {
        vi.spyOn(Storage, 'loadCollection').mockImplementation((key: string) => {
            if (key === ADVERSARIES_KEY) return [{ id: 'a1', nom: 'Dupont' }];
            return [];
        });
        const pins: PlanPin[] = [{ id: 'p1', lng: 2, lat: 48, entityRef: { kind: 'adv', id: 'a1' } }];
        const { fake } = makeFakeThis(pins);
        mountPingModalDom();

        fake._renderPingEntities();

        const row = document.querySelector<HTMLElement>('#ping_entities_list .plan-entity-item');
        expect(row).not.toBeNull();
        if (!row) return;
        expect(row.textContent).toContain('placé');
        // Cliquer sur une entité déjà placée ne doit pas armer de placement.
        row.click();
        expect(fake.pendingEntityPin).toBeNull();
    });

    it('affiche le message "aucune entité" quand les 3 collections sont vides', () => {
        vi.spyOn(Storage, 'loadCollection').mockReturnValue([]);
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();

        fake._renderPingEntities();

        expect(dom.entitiesList.textContent).toContain('Aucune entité créée');
    });
});

describe('_setSelectedIcon / _refreshIconSuggestions / _renderIconCatalog (planMap.js:1029-1111)', () => {
    it("_renderIconCatalog('<filtre>') ne retient que les icônes de PIN_ICONS correspondantes", () => {
        const { fake } = makeFakeThis();
        mountPingModalDom();
        const q = 'pompier';

        fake._renderIconCatalog(q);

        const renderedIds = Array.from(document.querySelectorAll<HTMLButtonElement>('#pin_icon_grid .pin-icon-cell')).map(
            (b) => b.dataset.id,
        );
        const expectedIds = PIN_ICONS.filter((ic) =>
            (ic.label + ' ' + ic.cat + ' ' + ic.id + ' ' + ic.tags.join(' ')).toLowerCase().includes(q),
        ).map((ic) => ic.id);

        expect(renderedIds.length).toBeGreaterThan(0);
        expect(renderedIds.length).toBeLessThan(PIN_ICONS.length);
        expect(new Set(renderedIds)).toEqual(new Set(expectedIds));
    });

    it('_renderIconCatalog(\'\') rend le catalogue complet (aucun filtre)', () => {
        const { fake } = makeFakeThis();
        mountPingModalDom();

        fake._renderIconCatalog('');

        const renderedIds = document.querySelectorAll('#pin_icon_grid .pin-icon-cell');
        expect(renderedIds).toHaveLength(PIN_ICONS.length);
    });

    it('cliquer une icône du catalogue appelle _setSelectedIcon et referme le catalogue', () => {
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();
        dom.catalog.style.display = 'block';

        fake._renderIconCatalog('');
        const firstCell = document.querySelector<HTMLButtonElement>('#pin_icon_grid .pin-icon-cell');
        expect(firstCell).not.toBeNull();
        if (!firstCell) return;

        firstCell.click();

        expect(dom.iconHidden.value).toBe(firstCell.dataset.id ?? '');
        expect(dom.catalog.style.display).toBe('none');
    });

    it('_refreshIconSuggestions masque le bloc de suggestions quand aucune icône ne correspond', () => {
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();
        dom.suggestWrap.style.display = 'block';

        fake._refreshIconSuggestions('zzzzz_aucune_correspondance_zzzzz');

        expect(dom.suggestWrap.style.display).toBe('none');
        expect(dom.suggestBox.innerHTML).toBe('');
    });
});

describe('_bindIconPickerOnce (planMap.js:1113-1140)', () => {
    it('ne recâble pas au second appel', () => {
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();
        const addSpy = vi.spyOn(dom.labelInput, 'addEventListener');

        fake._bindIconPickerOnce();
        expect(fake._iconPickerBound).toBe(true);
        expect(addSpy).toHaveBeenCalledTimes(1);

        fake._bindIconPickerOnce();
        expect(addSpy).toHaveBeenCalledTimes(1); // pas de second câblage
    });

    it('câble le toggle du catalogue : premier clic ouvre et rend le catalogue', () => {
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();

        fake._bindIconPickerOnce();
        dom.pickerToggle.click();

        expect(dom.catalog.style.display).toBe('block');
        expect(document.querySelectorAll('#pin_icon_grid .pin-icon-cell').length).toBe(PIN_ICONS.length);
    });
});

describe('_armFreePinPlacement (planMap.js:1142-1154)', () => {
    it('sans libellé : toast d\'erreur (R2-T2a, ex-alert()) et ne pose ni pendingFreePin ni pendingEntityPin', () => {
        const { fake } = makeFakeThis();
        mountPingModalDom(); // labelInput.value === ''

        fake._armFreePinPlacement();

        expect(toastSpy).toHaveBeenCalledWith('Libellé requis', { kind: 'error' });
        expect(fake.pendingFreePin).toBeNull();
    });

    it('avec libellé : arme pendingFreePin, efface pendingEntityPin, ferme la modale et affiche un hint', () => {
        const { fake, showHint } = makeFakeThis();
        const dom = mountPingModalDom();
        dom.labelInput.value = 'PC repli';
        dom.colorInput.value = '#eab308';
        dom.kindInput.value = 'Inter';
        dom.iconHidden.value = 'local_police';
        fake.pendingEntityPin = { kind: 'adv', id: 'a1' };

        fake._armFreePinPlacement();

        expect(fake.pendingEntityPin).toBeNull();
        expect(fake.pendingFreePin).toEqual({ label: 'PC repli', color: '#eab308', kind: 'Inter', icon: 'local_police' });
        expect(dom.modal.close).toHaveBeenCalled();
        expect(showHint).toHaveBeenCalledWith('Clique sur la carte pour placer "PC repli"');
    });

    it('case "véhicule" cochée force kind = "Vehicule"', () => {
        const { fake } = makeFakeThis();
        const dom = mountPingModalDom();
        dom.labelInput.value = 'VL suspect';
        dom.kindInput.value = 'Inter';
        dom.vehicleInput.checked = true;

        fake._armFreePinPlacement();

        expect(fake.pendingFreePin).not.toBeNull();
        expect(fake.pendingFreePin?.kind).toBe('Vehicule');
    });
});
