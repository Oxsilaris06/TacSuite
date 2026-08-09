/**
 * pm-textmodal.test.ts — Tests du paquet `pm-textmodal` (planmap/text-modal.ts)
 * ================================================================================
 *
 * Comportement OBSERVÉ de `modules/pctac/planMap.js:4546-4719` (GStart-main,
 * lecture seule). Références `planMap.js:<ligne>` en commentaire, cf.
 * `docs/SPEC-PLANMAP-SPLIT.md` §4.14, §5.1 (piège reparentage plein écran).
 *
 * `this` FACTICE (jamais `new maplibregl.Map`) : `createFakePlanMap()` fournit
 * un objet conforme à `PlanMapInternal` couvrant strictement ce qu'utilisent
 * les 7 méthodes de ce paquet (état + dépendances externes stubées).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextModalMethods } from '@pctac/planmap/text-modal.js';
import type { PlanMapInternal, PlanShape } from '@pctac/planmap/types.js';

/** Fabrique un `this` factice minimal, conforme à ce qu'utilisent les 7 méthodes de text-modal.ts. */
function createFakePlanMap(initialShapes: PlanShape[] = []): {
    instance: PlanMapInternal;
    spies: {
        loadShapes: ReturnType<typeof vi.fn>;
        saveShapes: ReturnType<typeof vi.fn>;
        pushHistory: ReturnType<typeof vi.fn>;
        refreshUndoRedoButtons: ReturnType<typeof vi.fn>;
        deselectShape: ReturnType<typeof vi.fn>;
        renderShapes: ReturnType<typeof vi.fn>;
        selectShape: ReturnType<typeof vi.fn>;
    };
} {
    let shapes: PlanShape[] = initialShapes.map((s) => ({ ...s }));

    const loadShapes = vi.fn((): PlanShape[] => shapes);
    const saveShapes = vi.fn((list: readonly PlanShape[]): void => {
        shapes = list.map((s) => ({ ...s }));
    });
    const pushHistory = vi.fn((): void => {});
    const refreshUndoRedoButtons = vi.fn((): void => {});
    const deselectShape = vi.fn((): void => {});
    const renderShapes = vi.fn((): void => {});
    const selectShape = vi.fn((): void => {});

    const fake = {
        ...TextModalMethods,
        _modalReparent: null,
        _textModalBound: false,
        _selectedShapeId: null as string | null,
        drawColor: '#ef4444',
        _loadShapes: loadShapes,
        _saveShapes: saveShapes,
        _pushHistory: pushHistory,
        _refreshUndoRedoButtons: refreshUndoRedoButtons,
        _deselectShape: deselectShape,
        _renderShapes: renderShapes,
        _selectShape: selectShape,
    };

    return {
        // Double-cast justifié : `fake` ne couvre volontairement qu'un sous-ensemble
        // de `PlanMapInternal` (les ~189 membres ne sont pas tous pertinents ici) —
        // pattern déjà en usage dans ce dépôt pour les fakes DOM/IDB (cf. pc-tchaplive.test.ts).
        instance: fake as unknown as PlanMapInternal,
        spies: { loadShapes, saveShapes, pushHistory, refreshUndoRedoButtons, deselectShape, renderShapes, selectShape },
    };
}

/**
 * Monte le DOM minimal de la modale de texte (`#planTextModal` + champs + palette).
 * R2-T1 (migration `<dialog>` natif) : `#planTextModal` est un `<dialog>` (plus un
 * `<div>`) — sans fond `#modalBackdrop` séparé (remplacé par le `::backdrop`
 * intrinsèque du dialog).
 *
 * `HTMLDialogElement.showModal`/`.close` n'existent PAS sous jsdom (vérifié :
 * jsdom 30.0.1 génère l'interface IDL — `.open` est un booléen réactif — mais
 * `HTMLDialogElementImpl` n'implémente ni `showModal` ni `close`, le sujet
 * dépend du rendu/« top layer » que jsdom ne fait pas). Même limite déjà
 * documentée et contournée côté OI (`tests/unit/oi/oi-dessin.test.ts:25-26`,
 * `populateMemberCanvasModal`) : on stubbe `showModal`/`close` en `vi.fn()` sur
 * l'élément monté, puis on assert `toHaveBeenCalled()` au lieu de lire `.open`.
 */
function mountTextModalDom(): {
    modal: HTMLDialogElement;
    input: HTMLInputElement;
    idHidden: HTMLInputElement;
    colorVal: HTMLInputElement;
    sizeInput: HTMLInputElement;
    sizeDisp: HTMLElement;
    titleEl: HTMLElement;
} {
    document.body.innerHTML = `
        <dialog id="planTextModal">
            <h3 id="planTextModalTitle"></h3>
            <input id="plan_text_target_id" type="hidden" />
            <input id="plan_text_input" type="text" />
            <input id="plan_text_color_val" type="hidden" />
            <div id="plan_text_color_palette">
                <button type="button" class="plan-text-color" data-color="#ffffff"></button>
                <button type="button" class="plan-text-color" data-color="#ef4444"></button>
            </div>
            <button id="plan_text_size_minus" type="button"></button>
            <input id="plan_text_size_input" type="number" />
            <span id="plan_text_size_val"></span>
            <button id="plan_text_size_plus" type="button"></button>
            <button id="planTextConfirmBtn" type="button"></button>
            <button id="planTextCancelBtn" type="button"></button>
        </dialog>
    `;
    const modal = document.getElementById('planTextModal') as HTMLDialogElement;
    modal.showModal = vi.fn();
    modal.close = vi.fn();
    return {
        modal,
        input: document.getElementById('plan_text_input') as HTMLInputElement,
        idHidden: document.getElementById('plan_text_target_id') as HTMLInputElement,
        colorVal: document.getElementById('plan_text_color_val') as HTMLInputElement,
        sizeInput: document.getElementById('plan_text_size_input') as HTMLInputElement,
        sizeDisp: document.getElementById('plan_text_size_val') as HTMLElement,
        titleEl: document.getElementById('planTextModalTitle') as HTMLElement,
    };
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('TextModalMethods — les 7 méthodes ne jettent pas quand #planTextModal est absent du DOM', () => {
    it('_openTextModal', () => {
        const { instance: fake } = createFakePlanMap();
        expect(() => fake._openTextModal('shape_1')).not.toThrow();
    });

    it('_mountModalInFullscreen', () => {
        const { instance: fake } = createFakePlanMap();
        const modal = document.createElement('div');
        expect(() => fake._mountModalInFullscreen(modal)).not.toThrow();
    });

    it('_restoreModalFromFullscreen', () => {
        const { instance: fake } = createFakePlanMap();
        expect(() => fake._restoreModalFromFullscreen()).not.toThrow();
    });

    it('_hideTextModal', () => {
        const { instance: fake } = createFakePlanMap();
        expect(() => fake._hideTextModal()).not.toThrow();
    });

    it('_confirmTextModal', () => {
        const { instance: fake } = createFakePlanMap();
        expect(() => fake._confirmTextModal()).not.toThrow();
    });

    it('_bindTextModalOnce', () => {
        const { instance: fake } = createFakePlanMap();
        expect(() => fake._bindTextModalOnce()).not.toThrow();
    });

    it('_addFreeText', () => {
        const { instance: fake } = createFakePlanMap();
        expect(() => fake._addFreeText({ lng: 2.35, lat: 48.85 })).not.toThrow();
    });
});

describe('_mountModalInFullscreen / _restoreModalFromFullscreen — reparentage plein écran (planMap.js:4583-4605, piège §5.1)', () => {
    // R2-T1 (migration <dialog> natif) : `_mountModalInFullscreen` ne prend plus
    // qu'un seul nœud (le `<dialog>`) — l'ex-fond `#modalBackdrop`, reparenté en
    // miroir avant la migration, a disparu (remplacé par le `::backdrop`
    // intrinsèque du dialog, qui suit automatiquement son hôte). `ModalReparent`
    // ne mémorise donc plus que `{ modal, modalParent, modalNext }`.
    afterEach(() => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    it('sans élément en plein écran : ne reparente pas (no-op, aucun mémo posé)', () => {
        document.body.innerHTML = '<div id="root"><div id="planTextModal"></div></div>';
        const root = document.getElementById('root') as HTMLElement;
        const modal = document.getElementById('planTextModal') as HTMLElement;
        const { instance: fake } = createFakePlanMap();

        fake._mountModalInFullscreen(modal);

        expect(modal.parentElement).toBe(root);
        expect(fake._modalReparent).toBeNull();
    });

    it('TEST CLÉ — déplace le modal dans l\'élément fullscreen puis le restaure EXACTEMENT (même parent, même nextSibling)', () => {
        // Construction par l'API DOM (pas d'innerHTML) : évite tout nœud texte
        // d'indentation parasite entre les frères, pour un test de position exact.
        document.body.innerHTML = '';
        const root = document.createElement('div');
        root.id = 'root';
        const beforeModal = document.createElement('span');
        beforeModal.id = 'before-modal';
        const modal = document.createElement('div');
        modal.id = 'planTextModal';
        const afterModal = document.createElement('span');
        afterModal.id = 'after-modal';
        root.append(beforeModal, modal, afterModal);
        const fsContainer = document.createElement('div');
        fsContainer.id = 'fsContainer';
        document.body.append(root, fsContainer);
        Object.defineProperty(document, 'fullscreenElement', { value: fsContainer, configurable: true });

        const { instance: fake } = createFakePlanMap();

        fake._mountModalInFullscreen(modal);

        // Reparenté dans l'élément fullscreen — les TROIS références sont mémorisées.
        expect(modal.parentElement).toBe(fsContainer);
        expect(fake._modalReparent).not.toBeNull();
        expect(fake._modalReparent?.modal).toBe(modal);
        expect(fake._modalReparent?.modalParent).toBe(root);
        expect(fake._modalReparent?.modalNext).toBe(afterModal);

        fake._restoreModalFromFullscreen();

        // Restauré EXACTEMENT : même parent ET même position (nextSibling identique).
        expect(modal.parentElement).toBe(root);
        expect(modal.nextSibling).toBe(afterModal);
        expect(fake._modalReparent).toBeNull();
    });

    it('si le modal est déjà dans l\'élément fullscreen : ne reparente pas une 2e fois', () => {
        document.body.innerHTML = '<div id="fsContainer"><div id="planTextModal"></div></div>';
        const fsContainer = document.getElementById('fsContainer') as HTMLElement;
        const modal = document.getElementById('planTextModal') as HTMLElement;
        Object.defineProperty(document, 'fullscreenElement', { value: fsContainer, configurable: true });
        const { instance: fake } = createFakePlanMap();

        fake._mountModalInFullscreen(modal);

        expect(fake._modalReparent).toBeNull();
    });
});

describe('_bindTextModalOnce — idempotent via _textModalBound (planMap.js:4671-4672)', () => {
    it('appelé deux fois : le 2e appel ne rebranche pas les listeners (aucun doublon sur "keydown")', () => {
        document.body.innerHTML = `
            <button id="planTextConfirmBtn" type="button"></button>
            <button id="planTextCancelBtn" type="button"></button>
        `;
        const { instance: fake } = createFakePlanMap();
        const addSpy = vi.spyOn(document, 'addEventListener');

        fake._bindTextModalOnce();
        expect(fake._textModalBound).toBe(true);
        const keydownCallsAfterFirst = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
        expect(keydownCallsAfterFirst).toBe(1);

        fake._bindTextModalOnce();
        const keydownCallsAfterSecond = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
        expect(keydownCallsAfterSecond).toBe(1); // pas de doublon

        addSpy.mockRestore();
    });
});

describe('_confirmTextModal — distingue création (forme "text") et édition (annotation) (planMap.js:4629-4667, piège §... création≠édition)', () => {
    it('forme "text" avec texte vide confirmé → suppression de la forme fantôme (création annulée)', () => {
        const dom = mountTextModalDom();
        const { instance: fake, spies } = createFakePlanMap([
            { id: 's1', type: 'text', text: '', color: '#ffffff', textColor: '#ffffff', coords: [[2, 48]] },
        ]);
        dom.idHidden.value = 's1';
        dom.input.value = '';

        fake._confirmTextModal();

        expect(fake._loadShapes()).toHaveLength(0);
        expect(spies.deselectShape).not.toHaveBeenCalled(); // _selectedShapeId n'était pas s1
    });

    it('forme "text" avec texte renseigné → applique text/textColor/color/fontSize et garde la sélection', () => {
        const dom = mountTextModalDom();
        const { instance: fake, spies } = createFakePlanMap([
            { id: 's1', type: 'text', text: '', color: '#ffffff', textColor: '#ffffff', coords: [[2, 48]] },
        ]);
        dom.idHidden.value = 's1';
        dom.input.value = 'Objectif';
        dom.colorVal.value = '#22c55e';
        dom.sizeInput.value = '30';

        fake._confirmTextModal();

        const s = fake._loadShapes().find((x) => x.id === 's1');
        expect(s?.text).toBe('Objectif');
        expect(s?.textColor).toBe('#22c55e');
        expect(s?.color).toBe('#22c55e');
        expect(s?.fontSize).toBe(30);
        expect(spies.selectShape).toHaveBeenCalledWith('s1');
    });

    it('forme dessinée (line, édition) : applique text/textColor/fontSize mais NE TOUCHE PAS color, même si le texte est vide', () => {
        const dom = mountTextModalDom();
        const { instance: fake } = createFakePlanMap([
            { id: 's2', type: 'line', coords: [[2, 48], [3, 49]], color: '#3b82f6' },
        ]);
        dom.idHidden.value = 's2';
        dom.input.value = '';
        dom.colorVal.value = '#eab308';
        dom.sizeInput.value = '18';

        fake._confirmTextModal();

        // Pas supprimée : ce n'est pas une forme "text" — la branche de suppression
        // ne s'applique qu'à la création annulée (piège : création ≠ édition).
        const s = fake._loadShapes().find((x) => x.id === 's2');
        expect(s).toBeDefined();
        expect(s?.text).toBe('');
        expect(s?.textColor).toBe('#eab308');
        expect(s?.color).toBe('#3b82f6'); // inchangé
        expect(s?.fontSize).toBe(18);
    });

    it('fontSize borné à [9, 72]', () => {
        const dom = mountTextModalDom();
        const { instance: fake } = createFakePlanMap([
            { id: 's3', type: 'text', text: 'x', color: '#fff', coords: [[0, 0]] },
        ]);
        dom.idHidden.value = 's3';
        dom.input.value = 'x';
        dom.sizeInput.value = '999';

        fake._confirmTextModal();

        expect(fake._loadShapes().find((x) => x.id === 's3')?.fontSize).toBe(72);
    });

    it('id absent → ferme simplement la modale, sans toucher au store', () => {
        const dom = mountTextModalDom();
        const { instance: fake, spies } = createFakePlanMap([{ id: 'z', type: 'text', text: 'inchangé', coords: [[0, 0]] }]);
        dom.idHidden.value = '';

        fake._confirmTextModal();

        expect(spies.saveShapes).not.toHaveBeenCalled();
        expect(dom.modal.close).toHaveBeenCalled();
    });
});

describe('_hideTextModal — purge la forme fantôme "text" vide (planMap.js:4607-4626)', () => {
    it('forme "text" vide et ciblée : supprimée', () => {
        const dom = mountTextModalDom();
        const { instance: fake } = createFakePlanMap([{ id: 'g1', type: 'text', text: '', color: '#fff', coords: [[0, 0]] }]);
        dom.idHidden.value = 'g1';

        fake._hideTextModal();

        expect(fake._loadShapes()).toHaveLength(0);
    });

    it('forme "text" avec contenu : conservée', () => {
        const dom = mountTextModalDom();
        const { instance: fake } = createFakePlanMap([{ id: 'g2', type: 'text', text: 'Non vide', color: '#fff', coords: [[0, 0]] }]);
        dom.idHidden.value = 'g2';

        fake._hideTextModal();

        expect(fake._loadShapes()).toHaveLength(1);
    });

    it('modal.close() appelé dans tous les cas', () => {
        const dom = mountTextModalDom();
        const { instance: fake } = createFakePlanMap();

        fake._hideTextModal();

        expect(dom.modal.close).toHaveBeenCalled();
    });
});

describe('_addFreeText — place une forme "text" libre puis ouvre la modale (planMap.js:4705-4719)', () => {
    it('pousse une forme type "text" aux coordonnées données, avec la couleur de tracé courante', () => {
        const { instance: fake, spies } = createFakePlanMap();
        fake.drawColor = '#22c55e';

        fake._addFreeText({ lng: 2.35, lat: 48.85 });

        const shapes = fake._loadShapes();
        expect(shapes).toHaveLength(1);
        expect(shapes[0]?.type).toBe('text');
        expect(shapes[0]?.color).toBe('#22c55e');
        expect(shapes[0]?.textColor).toBe('#22c55e');
        expect(shapes[0]?.coords).toEqual([[2.35, 48.85]]);
        expect(shapes[0]?.text).toBe('');
        expect(spies.pushHistory).toHaveBeenCalledTimes(1);
    });

    it('ouvre immédiatement la modale de texte pour la forme créée', () => {
        const dom = mountTextModalDom();
        const { instance: fake } = createFakePlanMap();

        fake._addFreeText({ lng: 1, lat: 2 });

        const shapes = fake._loadShapes();
        expect(dom.modal.showModal).toHaveBeenCalled();
        expect(dom.idHidden.value).toBe(shapes[0]?.id);
    });
});
