/**
 * oi-patrac.test.ts — Tests unitaires de `patrac.ts` (P3.CONV, paquet
 * `oi-patrac`, CRITIQUE, port de `modules/patrac.js`, 1201 LOC).
 *
 * Module DOM (structure plate, pas de logique pure isolable) : tests écrits
 * APRÈS le port, fumée ciblée (SPEC §13.4(4)) couvrant les preuves EXIGÉES par
 * `PAQUETS-OI.json` (id="oi-patrac") :
 *  (a) plafonds de cellule India (5) / AO (8) — la 6e/9e cellule numérotée
 *      n'est PAS créée, la dernière est réutilisée (patrac.js:158-164).
 *  (b) auto-équipement Effraction : 1er PAX → Bélier, 2e → Lot 5.11, au-delà → Sans.
 *  (c) updateArticulationDisplay respecte window.isFormLoading (return
 *      anticipé) et appelle sinon window.refreshArticulationFromPatracdvr.
 *  (d) addPatracdvrRow câble bien son conteneur de membres (drop simulé
 *      déplaçant un membre — preuve du branchement wireDropContainer).
 *  (e) addPatracdvrMember câble bien les événements tactiles (preuve du
 *      branchement wireDraggableMember).
 *  (f) patracBatchMoveTo appelle persistAfterDrag (window.syncDomToStore PUIS
 *      window.updateArticulationDisplay, dans cet ordre — cf. écart signalé
 *      en tête de `patrac.ts` : copie locale de `persistAfterDrag`, absente
 *      des exports de `drag-drop.ts`).
 *  (g) contextMemberId est bien posé sur window lors d'un contextmenu.
 * Bonus (hors preuves mandatées, couverture complémentaire) : rendu
 * `updateMemberButtonVisuals`, structure `setupQuickEditPanel`,
 * `resetPatracdvrUI` respecte `confirm()`, fumée `generatePatracdvrPdf`
 * (pdf-lib est un calcul pur, s'exécute réellement sous jsdom — même
 * précédent que `tests/unit/pctac/pc-pdfexport.test.ts`).
 *
 * `vi.resetModules()` + import dynamique par test (même précédent que
 * `oi-drag-drop.test.ts`, `oi-store.test.ts`) : isolation de l'état de module
 * PRIVÉ (`_patracBatchMode`, `_patracBatchSel`, `patracQuickEditUiInitialized`
 * — jamais exposé, jamais dans `state.ts`) entre les tests.
 *
 * Règle commune §13.1.3 (interdits absolus) : aucun `any`, aucune assertion
 * non-null `!`. Le petit helper `must()` ci-dessous remplace les `!` pour
 * dérérérencer un retour `T | undefined | null` déjà prouvé défini par une
 * assertion précédente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Remplace une assertion non-null `!` (interdite, règle commune §13.1.3) par une garde explicite. */
function must<T>(value: T | undefined | null, message = 'valeur attendue non-null/undefined'): T {
    if (value === undefined || value === null) throw new Error(message);
    return value;
}

/** jsdom : ni `DataTransfer` ni `DragEvent` n'existent — double minimal (même précédent que `oi-drag-drop.test.ts`). */
class FakeDataTransfer {
    private readonly data = new Map<string, string>();
    getData(format: string): string {
        return this.data.get(format) ?? '';
    }
    setData(format: string, value: string): void {
        this.data.set(format, value);
    }
}

function makeDragEvent(
    type: string,
    init: { dataTransfer?: DataTransfer | null; clientX?: number; clientY?: number } = {},
): DragEvent {
    const evt = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'dataTransfer', { value: init.dataTransfer ?? null, configurable: true });
    Object.defineProperty(evt, 'clientX', { value: init.clientX ?? 0, configurable: true });
    Object.defineProperty(evt, 'clientY', { value: init.clientY ?? 0, configurable: true });
    return evt as unknown as DragEvent;
}

/** Fixture DOM minimale requise par les fonctions posées sur `window` (conteneurs statiques). */
function setupDom(): void {
    document.body.innerHTML = `
        <div id="unassigned_members_container"></div>
        <div id="patracdvr_container"></div>
        <div id="quickEditPanel"><div class="quick-edit-content"></div></div>
    `;
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
    // jsdom n'implémente PAS `Element.prototype.scrollIntoView` (absent, ni
    // même un no-op) : `handleMemberSelection` (patrac.js:506) l'appelle sur
    // #quickEditPanel — stub explicite, même esprit que §13.5 (`alert`,
    // `URL.createObjectURL`… absents de jsdom).
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    const win = window as unknown as Record<string, unknown>;
    delete win.syncDomToStore;
    delete win.updateArticulationDisplay;
    delete win.refreshArticulationFromPatracdvr;
    delete win.isFormLoading;
    delete win.toast;
    delete win.contextMemberId;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Plafonds de cellule (SPEC §11.5, patrac.js:138-193)', () => {
    it('India : la 6e cellule numérotée n\'est pas créée, India 5 est réutilisée', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        const promptMock = vi.fn()
            .mockReturnValueOnce('A1 A2')
            .mockReturnValueOnce('B1 B2')
            .mockReturnValueOnce('C1 C2')
            .mockReturnValueOnce('D1 D2')
            .mockReturnValueOnce('E1 E2')
            .mockReturnValueOnce('F1 F2');
        vi.stubGlobal('prompt', promptMock);

        for (let i = 0; i < 6; i++) {
            window.addCellBatch('India');
        }

        const cellules = Array.from(document.querySelectorAll<HTMLElement>('.patracdvr-member-btn')).map(b => b.dataset.cellule);
        expect(cellules).not.toContain('India 6');
        // E1,E2 (5e cellule) + F1,F2 (6e tentative, plafonnée) partagent tous "India 5".
        expect(cellules.filter(c => c === 'India 5').length).toBe(4);
    });

    it('AO : la 9e cellule numérotée n\'est pas créée, AO8 est réutilisée', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        const promptMock = vi.fn();
        for (let i = 1; i <= 9; i++) promptMock.mockReturnValueOnce(`X${i}a X${i}b`);
        vi.stubGlobal('prompt', promptMock);

        for (let i = 0; i < 9; i++) {
            window.addCellBatch('AO');
        }

        const cellules = Array.from(document.querySelectorAll<HTMLElement>('.patracdvr-member-btn')).map(b => b.dataset.cellule);
        expect(cellules).not.toContain('AO9');
        expect(cellules.filter(c => c === 'AO8').length).toBe(4);
    });
});

describe('Auto-équipement Effraction (patrac.js:173-182)', () => {
    it('1er PAX → Bélier, 2e → Lot 5.11, au-delà → Sans', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        vi.stubGlobal('prompt', vi.fn(() => 'AAA BBB CCC'));

        window.addCellBatch('Effrac');

        const members = Array.from(document.querySelectorAll<HTMLElement>('.patracdvr-member-btn'));
        expect(members).toHaveLength(3);
        const byTrig = (t: string): HTMLElement => must(members.find(m => m.dataset.trigramme === t));
        expect(byTrig('AAA').dataset.equipement).toBe('Belier');
        expect(byTrig('BBB').dataset.equipement).toBe('Lot 5.11');
        expect(byTrig('CCC').dataset.equipement).toBe('Sans');
        members.forEach(m => expect(m.dataset.cellule).toBe('Effrac'));
    });
});

describe('updateArticulationDisplay — wrapper de compatibilité (patrac.js:324-330)', () => {
    it('respecte window.isFormLoading (return anticipé)', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.refreshArticulationFromPatracdvr = vi.fn();

        window.isFormLoading = true;
        window.updateArticulationDisplay();
        expect(window.refreshArticulationFromPatracdvr).not.toHaveBeenCalled();
    });

    it('appelle window.refreshArticulationFromPatracdvr quand isFormLoading est faux', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.refreshArticulationFromPatracdvr = vi.fn();
        window.isFormLoading = false;

        window.updateArticulationDisplay();
        expect(window.refreshArticulationFromPatracdvr).toHaveBeenCalledTimes(1);
    });

    it('ne jette pas si window.refreshArticulationFromPatracdvr est absente (garde typeof)', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.isFormLoading = false;

        expect(() => window.updateArticulationDisplay()).not.toThrow();
    });
});

describe('addPatracdvrRow câble son conteneur (preuve wireDropContainer, SPEC §5.2)', () => {
    it('un drop sur le conteneur de membres du véhicule déplace le membre', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();

        window.addPatracdvrRow('KODIAQ');
        const membersContainer = must(document.querySelector<HTMLElement>('.patracdvr-vehicle-row .patracdvr-members-container'));

        const member = document.createElement('button');
        member.type = 'button';
        member.id = 'member_drop_test';
        member.className = 'patracdvr-member-btn draggable';
        member.dataset.trigramme = 'ABC';
        member.dataset.cellule = 'Sans';
        document.body.appendChild(member);

        const dt = new FakeDataTransfer();
        dt.setData('text/plain', 'member_drop_test');
        membersContainer.dispatchEvent(makeDragEvent('drop', { dataTransfer: dt as unknown as DataTransfer }));

        expect(member.parentElement).toBe(membersContainer);
        // drag.js:244-246 (via wireDropContainer/handleDrop) — hors zone non-assignée,
        // une cellule "Sans" reçoit "India 1" : preuve que le MÊME câblage que
        // l'init statique (drag.js:301-306) s'applique ici.
        expect(member.dataset.cellule).toBe('India 1');
    });

    it('le bouton "supprimer véhicule" désaffecte les membres puis persiste', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        vi.stubGlobal('confirm', vi.fn(() => true));

        window.addPatracdvrRow('SHARAN');
        const row = must(document.querySelector<HTMLElement>('.patracdvr-vehicle-row'));
        const membersContainer = must(row.querySelector<HTMLElement>('.patracdvr-members-container'));
        const member = must(window.addPatracdvrMember(membersContainer, { trigramme: 'XYZ', cellule: 'India 2' }));

        const removeBtn = must(row.querySelector<HTMLElement>('.remove-btn'));
        removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.body.contains(row)).toBe(false);
        expect(document.getElementById('unassigned_members_container')?.contains(member)).toBe(true);
        expect(member.dataset.cellule).toBe('Sans');
    });
});

describe('addPatracdvrMember câble les événements tactiles (preuve wireDraggableMember, SPEC §5.2)', () => {
    it('touchstart puis touchend au-dessus de la poubelle supprime le membre après confirm()', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        vi.stubGlobal('confirm', vi.fn(() => true));

        const trash = document.createElement('div');
        trash.id = 'trashCan';
        document.body.appendChild(trash);

        const container = must(document.getElementById('unassigned_members_container'));
        const btn = must(window.addPatracdvrMember(container, { trigramme: 'TCH' }));

        // jsdom n'implémente pas `elementFromPoint` — mock explicite (§13.5), même précédent que `oi-drag-drop.test.ts`.
        document.elementFromPoint = vi.fn((): Element => trash);

        btn.dispatchEvent(new TouchEvent('touchstart', { touches: [{ clientX: 1, clientY: 1 } as unknown as Touch] }));
        btn.dispatchEvent(new TouchEvent('touchend', { changedTouches: [{ clientX: 1, clientY: 1 } as unknown as Touch] }));

        expect(document.getElementById(btn.id)).toBeNull();
    });

    it('les 3 autres listeners (click/contextmenu) restent en dur, non redupliqués par wireDraggableMember', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();

        const container = must(document.getElementById('unassigned_members_container'));
        const btn = must(window.addPatracdvrMember(container, { trigramme: 'CLK' }));

        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(btn.classList.contains('member-active')).toBe(true);

        btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        expect(window.contextMemberId).toBe(btn.id);
    });
});

describe('patracBatchMoveTo appelle persistAfterDrag (écart signalé — copie locale, SPEC §5.3)', () => {
    it('window.syncDomToStore PUIS window.updateArticulationDisplay, dans cet ordre', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();

        const container = must(document.getElementById('unassigned_members_container'));
        const btn = must(window.addPatracdvrMember(container, { trigramme: 'BAT' }));

        const order: string[] = [];
        window.syncDomToStore = vi.fn(() => { order.push('sync'); });
        window.updateArticulationDisplay = vi.fn(() => { order.push('articulation'); });

        window.togglePatracBatchMode(true);
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(btn.classList.contains('batch-selected')).toBe(true);

        const target = document.createElement('div');
        document.body.appendChild(target);
        window.patracBatchMoveTo(target);

        expect(order).toEqual(['sync', 'articulation']);
        expect(btn.parentElement).toBe(target);
    });

    it('patracBatchUnassign appelle aussi persistAfterDrag, dans le même ordre', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();

        const container = must(document.getElementById('unassigned_members_container'));
        const vehicleRow = document.createElement('div');
        document.body.appendChild(vehicleRow);
        const btn = must(window.addPatracdvrMember(vehicleRow, { trigramme: 'UNS', cellule: 'India 1' }));
        void container;

        const order: string[] = [];
        window.syncDomToStore = vi.fn(() => { order.push('sync'); });
        window.updateArticulationDisplay = vi.fn(() => { order.push('articulation'); });

        window.togglePatracBatchMode(true);
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        window.patracBatchUnassign();

        expect(order).toEqual(['sync', 'articulation']);
        expect(document.getElementById('unassigned_members_container')?.contains(btn)).toBe(true);
        expect(btn.dataset.cellule).toBe('Sans');
    });
});

describe('contextMemberId posé sur window (patrac.js:236-241)', () => {
    it('un contextmenu sur un bouton membre pose window.contextMemberId à son id', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();

        const container = must(document.getElementById('unassigned_members_container'));
        const btn = must(window.addPatracdvrMember(container, { trigramme: 'CTX' }));

        btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

        expect(window.contextMemberId).toBe(btn.id);
    });
});

describe('Bonus — rendu et structure (hors preuves mandatées)', () => {
    it('updateMemberButtonVisuals affiche trigramme + cellule + fonction (hors zone non-assignée)', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();

        const row = document.createElement('div');
        document.body.appendChild(row);
        const btn = must(window.addPatracdvrMember(row, { trigramme: 'VIS', cellule: 'India 2', fonction: 'Inter' }));

        expect(btn.querySelector('.trigramme')?.textContent).toBe('VIS');
        expect(btn.querySelector('.fonction')?.textContent).toContain('India 2');
        expect(btn.querySelector('.fonction')?.textContent).toContain('Inter');
    });

    it('updateMemberButtonVisuals masque fonction/cellule dans #unassigned_members_container', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();

        const container = must(document.getElementById('unassigned_members_container'));
        const btn = must(window.addPatracdvrMember(container, { trigramme: 'MSK', cellule: 'India 3', fonction: 'Inter' }));
        // patrac.js:218 appelle updateMemberButtonVisuals AVANT l'ajout au DOM
        // (btn.closest('#unassigned_members_container') ne peut donc rien
        // détecter à cet instant précis — comportement de l'original, pas un
        // bug de portage). On ré-invoque APRÈS l'ajout, comme le fait tout
        // site réel (handleDrop, patracBatchUnassign…) qui appelle
        // updateMemberButtonVisuals une fois l'élément déjà parenté.
        window.updateMemberButtonVisuals(btn);

        expect(btn.querySelector('.trigramme')?.textContent).toBe('MSK');
        expect(btn.querySelector('.fonction')).toBeNull();
    });

    it('setupQuickEditPanel crée une ligne .qe-row par entrée de quickEditMapping', async () => {
        setupDom();
        const { setupQuickEditPanel } = await import('@oi/patrac.js');
        const { quickEditMapping } = await import('@oi/init.js');

        setupQuickEditPanel();

        const rows = document.querySelectorAll('#quickEditPanel .qe-row');
        expect(rows).toHaveLength(Object.keys(quickEditMapping).length);
    });

    it('resetPatracdvrUI ne réinitialise rien si confirm() est refusé', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        vi.stubGlobal('confirm', vi.fn(() => false));

        const container = must(document.getElementById('unassigned_members_container'));
        window.addPatracdvrMember(container, { trigramme: 'KEEP' });

        window.resetPatracdvrUI();

        expect(document.querySelectorAll('.patracdvr-member-btn')).toHaveLength(1);
    });

    it('resetPatracdvrUI vide le PATRACDVR si confirm() est accepté', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        vi.stubGlobal('confirm', vi.fn(() => true));

        const container = must(document.getElementById('unassigned_members_container'));
        window.addPatracdvrMember(container, { trigramme: 'GONE' });

        window.resetPatracdvrUI();

        expect(document.querySelectorAll('.patracdvr-member-btn')).toHaveLength(0);
    });
});

describe('generatePatracdvrPdf — fumée (pdf-lib réel sous jsdom, même précédent que pc-pdfexport.test.ts)', () => {
    beforeEach(() => {
        (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock-url');
        (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    });

    it('avertit et ne génère rien si le PATRACDVR est vide', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.toast = vi.fn();

        await window.generatePatracdvrPdf();

        expect(window.toast).toHaveBeenCalledWith('Aucun membre dans le PATRACDVR.', 'warning');
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('génère un PDF (véhicule + non-assignés) sans lever d\'exception et déclenche le téléchargement', async () => {
        setupDom();
        await import('@oi/patrac.js');
        window.syncDomToStore = vi.fn();
        window.toast = vi.fn();

        window.addPatracdvrRow('KODIAQ', [{ trigramme: 'AAA', cellule: 'India 1', fonction: 'Inter' }]);
        const unassigned = must(document.getElementById('unassigned_members_container'));
        window.addPatracdvrMember(unassigned, { trigramme: 'BBB' });

        await expect(window.generatePatracdvrPdf()).resolves.toBeUndefined();

        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(window.toast).toHaveBeenCalledWith('PDF PATRACDVR généré', 'success');
    });
});
