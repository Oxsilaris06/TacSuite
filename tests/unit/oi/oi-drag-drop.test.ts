/**
 * oi-drag-drop.test.ts — Preuve de non-régression de la FUSION
 * `modules/drag.js` (370 LOC) + `modules/patrac.js:76-79,224-226` en un
 * module unique iso-comportement, `src/apps/oi/drag-drop.ts` (paquet
 * P3.CONV `oi-drag-drop`). Écrit APRÈS le port (module DOM, fumée ciblée
 * SPEC §13.4(4)), les 5 preuves exigées par `PAQUETS-OI.json`
 * (`oi-drag-drop`) et `SPEC-OI-CONVERSION.md` §5.4 :
 *  (a) wireDropContainer sur un conteneur factice reçoit un drop et déplace l'élément.
 *  (b) persistAfterDrag appelle window.syncDomToStore PUIS
 *      window.updateArticulationDisplay, dans cet ordre — via un drop simulé
 *      ET via un dragend simulé (les 2 chemins internes).
 *  (c) repli : sans window.syncDomToStore, window.Store.saveToStorage est appelée.
 *  (d) équivalence : un conteneur câblé par wireDropContainer et un conteneur
 *      câblé par initializeDragDropListeners() réagissent identiquement à la
 *      MÊME séquence d'événements simulés (jsdom n'expose pas les listeners
 *      posés : comparaison PAR SIMULATION du résultat observable).
 *  (e) initDocumentDragTransfer est idempotent (2 appels = 1 seul jeu de listeners).
 *
 * `vi.resetModules()` + import dynamique par test (même précédent que
 * `oi-store.test.ts`) : isolation totale de l'état de module PRIVÉ
 * `documentDragTransferInitialized` (drag.js:340, jamais exposé, jamais dans
 * `state.ts`) entre les tests — condition nécessaire pour que la preuve (e)
 * soit valable indépendamment de l'ordre d'exécution des tests.
 *
 * Doubles d'environnement jsdom posés localement (SPEC §13.5, aucune
 * dépendance npm ajoutée) :
 *  - `DataTransfer`/`DragEvent` : jsdom n'implémente NI L'UN NI L'AUTRE
 *    (constructeurs absents) — `FakeDataTransfer` (getData/setData minimal,
 *    même esprit que `oi-carto-panels-capture.test.ts`) + `makeDragEvent`
 *    (un `Event` DOM réel, bubbling/preventDefault natifs, avec
 *    `dataTransfer`/`clientX`/`clientY` posés via `Object.defineProperty` —
 *    seule surface lue par `drag-drop.ts`).
 *  - `document.elementFromPoint` : ABSENT de jsdom (pas même un stub
 *    renvoyant `null`) — mocké explicitement (bonus `wireDraggableMember`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// R2-T2b : `confirm()` natif → `confirmDialog` (`@shared/feedback.js`) mocké,
// même pattern que `pc-archive.test.ts`. Mock statique : reste actif à travers
// les `vi.resetModules()` de ce fichier (import dynamique par test).
const confirmDialogSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@shared/feedback.js', () => ({
    confirmDialog: confirmDialogSpy,
}));

/** jsdom : ni `DataTransfer` ni `DragEvent` n'existent — double minimal. */
class FakeDataTransfer {
    private readonly data = new Map<string, string>();
    getData(format: string): string {
        return this.data.get(format) ?? '';
    }
    setData(format: string, value: string): void {
        this.data.set(format, value);
    }
}

/**
 * Construit un `Event` DOM réel (bubbling/preventDefault/target/currentTarget
 * natifs — seule `DragEvent` elle-même manque sous jsdom) et lui pose la
 * surface `dataTransfer`/`clientX`/`clientY` lue par `drag-drop.ts`.
 */
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

/** Bouton membre PATRACDVR minimal (patrac.js:195-234, champs lus par drag-drop.ts). */
function makeMemberBtn(id: string, cellule = 'Sans'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'patracdvr-member-btn draggable';
    btn.dataset.trigramme = 'ABC';
    btn.dataset.cellule = cellule;
    btn.dataset.fonction = 'Sans';
    return btn;
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
});

afterEach(() => {
    delete (window as unknown as { syncDomToStore?: unknown }).syncDomToStore;
    delete (window as unknown as { updateArticulationDisplay?: unknown }).updateArticulationDisplay;
    delete (window as unknown as { updateMemberButtonVisuals?: unknown }).updateMemberButtonVisuals;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    confirmDialogSpy.mockClear();
    confirmDialogSpy.mockImplementation(async () => true);
});

describe('wireDropContainer (SPEC §5.2 — preuve (a))', () => {
    it('un drop sur un conteneur câblé par wireDropContainer déplace l\'élément draggé', async () => {
        const { wireDropContainer } = await import('@oi/drag-drop.js');
        window.updateMemberButtonVisuals = vi.fn();
        window.syncDomToStore = vi.fn();

        const member = makeMemberBtn('member_a', 'Sans');
        document.body.appendChild(member);

        const target = document.createElement('div');
        target.id = 'vehicle_1_members'; // conteneur « véhicule » quelconque, pas un id spécial
        document.body.appendChild(target);
        wireDropContainer(target);

        const dt = new FakeDataTransfer();
        dt.setData('text/plain', 'member_a');
        target.dispatchEvent(makeDragEvent('drop', { dataTransfer: dt as unknown as DataTransfer }));

        expect(member.parentElement).toBe(target);
        // drag.js:244-246 — hors zone non-assignée, une cellule "Sans" reçoit "India 1".
        expect(member.dataset.cellule).toBe('India 1');
        expect(window.updateMemberButtonVisuals).toHaveBeenCalledWith(member);
    });

    it('un drop sur la poubelle câblée déclenche la suppression après confirm()', async () => {
        const { wireDropContainer } = await import('@oi/drag-drop.js');
        window.syncDomToStore = vi.fn();

        const member = makeMemberBtn('member_trash');
        document.body.appendChild(member);

        const trash = document.createElement('div');
        trash.id = 'trashCan';
        document.body.appendChild(trash);
        wireDropContainer(trash);

        const dt = new FakeDataTransfer();
        dt.setData('text/plain', 'member_trash');
        trash.dispatchEvent(makeDragEvent('drop', { dataTransfer: dt as unknown as DataTransfer }));

        // R2-T2b : `handleDeleteDrop` est désormais async (`await confirmDialog`) —
        // la suppression n'est effective qu'après résolution de la micro-tâche.
        await vi.waitFor(() => {
            expect(document.getElementById('member_trash')).toBeNull();
        });
    });
});

describe('persistAfterDrag — ordre des appels (SPEC §5.3/§5.4 — preuve (b))', () => {
    it('chemin DROP : window.syncDomToStore PUIS window.updateArticulationDisplay, dans cet ordre', async () => {
        const { wireDropContainer } = await import('@oi/drag-drop.js');
        window.updateMemberButtonVisuals = vi.fn();
        const order: string[] = [];
        window.syncDomToStore = vi.fn(() => { order.push('sync'); });
        window.updateArticulationDisplay = vi.fn(() => { order.push('articulation'); });

        const member = makeMemberBtn('member_b');
        document.body.appendChild(member);
        const target = document.createElement('div');
        target.id = 'vehicle_2_members';
        document.body.appendChild(target);
        wireDropContainer(target);

        const dt = new FakeDataTransfer();
        dt.setData('text/plain', 'member_b');
        target.dispatchEvent(makeDragEvent('drop', { dataTransfer: dt as unknown as DataTransfer }));

        expect(order).toEqual(['sync', 'articulation']);
    });

    it('chemin DRAGEND (document-level, drag.js:359-365) : même ordre', async () => {
        await import('@oi/drag-drop.js');
        // Contrat OiDragGlobals : posée sur window par le module lui-même.
        window.initDocumentDragTransfer();

        const order: string[] = [];
        window.syncDomToStore = vi.fn(() => { order.push('sync'); });
        window.updateArticulationDisplay = vi.fn(() => { order.push('articulation'); });

        const member = document.createElement('button');
        member.className = 'draggable';
        member.id = 'member_dragend';
        document.body.appendChild(member);

        member.dispatchEvent(makeDragEvent('dragend'));

        // Assertion robuste à l'accumulation de listeners `document`-level
        // d'AUTRES tests de ce fichier : jsdom conserve le même `document`
        // pour tout le fichier, et `documentDragTransferInitialized` est un
        // état de module PRIVÉ — idempotent PAR INSTANCE de module fraîche
        // (`vi.resetModules()`), pas au niveau du `document` réel partagé
        // (cf. describe « idempotence » ci-dessous pour la preuve dédiée à
        // cette garde, construite en DELTA pour être insensible à ce même
        // effet). Chaque paire poussée doit suivre l'ordre sync → articulation.
        expect(order.length).toBeGreaterThan(0);
        expect(order.length % 2).toBe(0);
        for (let i = 0; i < order.length; i += 2) {
            expect(order[i]).toBe('sync');
            expect(order[i + 1]).toBe('articulation');
        }
    });
});

describe('persistAfterDrag — repli sur Store.saveToStorage (SPEC §5.3 — preuve (c))', () => {
    it('sans window.syncDomToStore, window.Store.saveToStorage est appelée', async () => {
        const { wireDropContainer } = await import('@oi/drag-drop.js');
        const { Store } = await import('@oi/init.js');
        window.updateMemberButtonVisuals = vi.fn();
        // Retrait volontaire pour tester le repli (même précédent que
        // `oi-store.test.ts:460` : window.syncDomToStore n'est posé par aucun
        // autre paquet dans ce fichier de test isolé).
        delete (window as unknown as { syncDomToStore?: unknown }).syncDomToStore;
        const saveSpy = vi.spyOn(Store, 'saveToStorage');

        const member = makeMemberBtn('member_c');
        document.body.appendChild(member);
        const target = document.createElement('div');
        target.id = 'vehicle_3_members';
        document.body.appendChild(target);
        wireDropContainer(target);

        const dt = new FakeDataTransfer();
        dt.setData('text/plain', 'member_c');
        target.dispatchEvent(makeDragEvent('drop', { dataTransfer: dt as unknown as DataTransfer }));

        expect(saveSpy).toHaveBeenCalled();
    });
});

describe('Équivalence des 2 sites de câblage (SPEC §5.4 — preuve (d))', () => {
    it('wireDropContainer(B) et initializeDragDropListeners() (câblant A) réagissent identiquement à la même séquence d\'événements', async () => {
        const { wireDropContainer } = await import('@oi/drag-drop.js');
        window.updateMemberButtonVisuals = vi.fn();
        window.syncDomToStore = vi.fn();

        // Site A : câblé IMPLICITEMENT par initializeDragDropListeners()
        // (drag.js:301-306), conteneur statique #unassigned_members_container.
        const containerA = document.createElement('div');
        containerA.id = 'unassigned_members_container';
        document.body.appendChild(containerA);
        window.initializeDragDropListeners();

        // Site B : câblé DIRECTEMENT via wireDropContainer (même id, pour
        // déclencher exactement la même branche de comportement dans
        // handleDrop — c'est la preuve d'équivalence demandée).
        const containerB = document.createElement('div');
        containerB.id = 'unassigned_members_container';
        wireDropContainer(containerB);

        // jsdom n'expose pas les listeners posés (§13.5, point (d) du
        // mandat) : comparaison PAR SIMULATION du résultat observable d'une
        // séquence dragenter → drop identique sur les deux sites.
        const runSequence = (container: HTMLElement, member: HTMLButtonElement): void => {
            document.body.appendChild(member);
            member.classList.add('dragging');
            container.dispatchEvent(makeDragEvent('dragenter'));
            const dt = new FakeDataTransfer();
            dt.setData('text/plain', member.id);
            container.dispatchEvent(makeDragEvent('drop', { dataTransfer: dt as unknown as DataTransfer }));
            member.classList.remove('dragging');
        };

        const memberA = makeMemberBtn('member_eq_a', 'India 3');
        runSequence(containerA, memberA);

        const memberB = makeMemberBtn('member_eq_b', 'India 3');
        runSequence(containerB, memberB);

        expect(containerA.contains(memberA)).toBe(true);
        expect(containerB.contains(memberB)).toBe(true);
        // Bordure remise à l'état repos (handleDrop) : identique sur les 2 sites.
        expect(containerA.style.border).toBe(containerB.style.border);
        // Zone "Non assigné" : cellule/fonction forcées à "Sans" — identique sur les 2 sites.
        expect(memberA.dataset.cellule).toBe(memberB.dataset.cellule);
        expect(memberA.dataset.cellule).toBe('Sans');
        expect(memberA.dataset.fonction).toBe(memberB.dataset.fonction);
    });
});

describe('initDocumentDragTransfer — idempotence (SPEC §5.4 — preuve (e))', () => {
    // Les 2 tests ci-dessous raisonnent en DELTA (nombre d'appels observés
    // APRÈS le 1er `initDocumentDragTransfer()` vs APRÈS le 2e, sur deux
    // dispatches indépendants) plutôt qu'en valeur absolue : jsdom conserve
    // le même `document` pour tout le fichier, et d'autres tests de ce
    // fichier posent aussi (légitimement) leurs propres listeners
    // `document`-level via d'autres instances de module fraîches
    // (`vi.resetModules()`) — la valeur absolue observée dépend donc de
    // l'ordre d'exécution des tests, PAS le delta : si le 2e appel de CETTE
    // instance ajoutait un second jeu de listeners, le delta grandirait.

    it('2 appels = 1 seul jeu de listeners : le 2e appel n\'ajoute aucun setData supplémentaire au dragstart', async () => {
        await import('@oi/drag-drop.js');

        window.initDocumentDragTransfer(); // 1er appel : vraie init pour CETTE instance

        const dt1 = new FakeDataTransfer();
        const setDataSpy1 = vi.spyOn(dt1, 'setData');
        const t1 = document.createElement('button');
        t1.className = 'draggable';
        document.body.appendChild(t1);
        t1.dispatchEvent(makeDragEvent('dragstart', { dataTransfer: dt1 as unknown as DataTransfer }));
        const callsAfterFirstInit = setDataSpy1.mock.calls.length;

        window.initDocumentDragTransfer(); // 2e appel : NO-OP attendu (drag.js:342)

        const dt2 = new FakeDataTransfer();
        const setDataSpy2 = vi.spyOn(dt2, 'setData');
        const t2 = document.createElement('button');
        t2.className = 'draggable';
        document.body.appendChild(t2);
        t2.dispatchEvent(makeDragEvent('dragstart', { dataTransfer: dt2 as unknown as DataTransfer }));
        const callsAfterSecondInit = setDataSpy2.mock.calls.length;

        expect(callsAfterFirstInit).toBeGreaterThan(0);
        expect(callsAfterSecondInit).toBe(callsAfterFirstInit);
    });

    it('2 appels = 1 seul jeu de listeners : le 2e appel n\'ajoute aucun syncDomToStore supplémentaire au dragend', async () => {
        await import('@oi/drag-drop.js');

        window.initDocumentDragTransfer(); // 1er appel

        const syncSpy = vi.fn();
        window.syncDomToStore = syncSpy;

        const t1 = document.createElement('button');
        t1.className = 'draggable';
        document.body.appendChild(t1);
        t1.dispatchEvent(makeDragEvent('dragend'));
        const callsAfterFirstInit = syncSpy.mock.calls.length;

        window.initDocumentDragTransfer(); // 2e appel : NO-OP attendu

        const t2 = document.createElement('button');
        t2.className = 'draggable';
        document.body.appendChild(t2);
        t2.dispatchEvent(makeDragEvent('dragend'));
        const callsAfterSecondInit = syncSpy.mock.calls.length - callsAfterFirstInit;

        expect(callsAfterFirstInit).toBeGreaterThan(0);
        expect(callsAfterSecondInit).toBe(callsAfterFirstInit);
    });
});

describe('wireDraggableMember (SPEC §5.2, fusion patrac.js:224-226 — bonus, hors preuve mandatée)', () => {
    it('touchstart puis touchend au-dessus de la poubelle supprime le membre après confirm()', async () => {
        const { wireDraggableMember } = await import('@oi/drag-drop.js');
        window.syncDomToStore = vi.fn();

        const trash = document.createElement('div');
        trash.id = 'trashCan';
        document.body.appendChild(trash);

        const member = makeMemberBtn('member_touch_1');
        document.body.appendChild(member);
        wireDraggableMember(member);

        // jsdom n'implémente PAS `document.elementFromPoint` (absent, pas
        // même un stub renvoyant `null`, cf. en-tête de fichier) — mock
        // explicite scopé à ce test (même esprit que canvas/getContext, §13.5).
        document.elementFromPoint = vi.fn((): Element => trash);

        member.dispatchEvent(new TouchEvent('touchstart', { touches: [{ clientX: 1, clientY: 1 } as unknown as Touch] }));
        member.dispatchEvent(new TouchEvent('touchend', { changedTouches: [{ clientX: 1, clientY: 1 } as unknown as Touch] }));

        // R2-T2b : `handleTouchEnd` est désormais async (`await confirmDialog`) —
        // la suppression n'est effective qu'après résolution de la micro-tâche.
        await vi.waitFor(() => {
            expect(document.getElementById('member_touch_1')).toBeNull();
        });
        expect(window.syncDomToStore).toHaveBeenCalled();
    });
});
