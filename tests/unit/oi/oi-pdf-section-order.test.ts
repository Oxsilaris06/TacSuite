/**
 * oi-pdf-section-order.test.ts — Tests unitaires du panneau « Ordre des
 * sections » de l'aperçu PDF OI (`src/apps/oi/pdf-section-order.ts`, §2
 * SPEC-2026-08-18-pdf-et-champs.md).
 *
 * `Store` RÉEL (pas de double, même précédent que `oi-articulation.test.ts`) :
 * `Store.state.formData` est réinitialisé avant chaque test. Seul
 * `PDFEngineV2` (`@oi/pdf-engine-v2.js`) est mocké (`openPreview` : la
 * régénération de l'aperçu réelle — pdf.js/canvas — n'a rien à faire dans un
 * test unitaire, même précédent que `compressImage`, `oi-medias.test.ts`).
 *
 * Couvre le gate demandé par le chantier :
 *  - réordonner (bouton ET glisser) écrit `formData.pdf_section_order` ;
 *  - la régénération de l'aperçu est déclenchée au RELÂCHEMENT (pas pendant
 *    le survol) ;
 *  - la réinitialisation restaure l'ordre par défaut ;
 *  - un ordre persisté invalide ne casse pas le rendu du panneau ;
 *  - `'adversaires'` (OI_PDF_LOCKED_SECTION_ID) reste verrouillée en tête,
 *    jamais proposée au glisser-déposer/boutons.
 *
 * jsdom ne mesure aucun layout réel (`getBoundingClientRect` renvoie des
 * zéros) : le test de glisser-déposer pose son propre double (hauteur de
 * ligne fixe dérivée de la position DOM courante, même esprit que
 * `oi-drag-drop.test.ts`) pour exercer `findAfterElement` en conditions
 * réalistes plutôt que de se contenter de vérifier le câblage des listeners.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openPreviewMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@oi/pdf-engine-v2.js', () => ({
    PDFEngineV2: { openPreview: openPreviewMock },
}));

import { Store } from '@oi/init.js';
import { OI_PDF_DEFAULT_SECTION_ORDER, OI_PDF_LOCKED_SECTION_ID } from '@oi/pdf/document-builder.js';
import { initPdfSectionOrderPanel, renderPdfSectionOrderPanel, resetPdfSectionOrder } from '@oi/pdf-section-order.js';

/** jsdom : ni `DataTransfer` ni `DragEvent` n'existent (même double que `oi-drag-drop.test.ts`). */
class FakeDataTransfer {
    effectAllowed = '';
}

function makeDragEvent(type: string, init: { dataTransfer?: object; clientY?: number } = {}): Event {
    const evt = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'dataTransfer', { value: init.dataTransfer ?? null, configurable: true });
    Object.defineProperty(evt, 'clientY', { value: init.clientY ?? 0, configurable: true });
    return evt;
}

function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} introuvable dans le test`);
    return el as T;
}

function rowIds(): string[] {
    return [...byId<HTMLOListElement>('pdfSectionOrderList').querySelectorAll<HTMLElement>('[data-section-id]')].map(
        (el) => el.dataset.sectionId as string,
    );
}

function setupPanelDom(): void {
    document.body.innerHTML = `
        <div id="pdfSectionOrderPanel" class="pdf-section-order-panel">
            <button type="button" id="pdfSectionOrderToggleBtn" aria-expanded="false"></button>
            <button type="button" id="pdfSectionOrderResetBtn"></button>
            <ol id="pdfSectionOrderList"></ol>
        </div>
    `;
}

beforeEach(() => {
    setupPanelDom();
    Store.state.formData = {};
    openPreviewMock.mockClear();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('rendu initial', () => {
    it("affiche les 8 sections du registre, dans l'ordre par défaut, avec leur libellé humain", () => {
        initPdfSectionOrderPanel();

        expect(rowIds()).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
        const list = byId<HTMLOListElement>('pdfSectionOrderList');
        expect(list.textContent).toContain('Environnement et amis');
        expect(list.textContent).toContain('Transport');
    });

    it("la ligne 'adversaires' est verrouillée : pas de boutons monter/descendre, pas de glisser", () => {
        initPdfSectionOrderPanel();

        const lockedRow = byId<HTMLLIElement>('pdfSectionOrderList').querySelector<HTMLElement>(
            `[data-section-id="${OI_PDF_LOCKED_SECTION_ID}"]`,
        );
        expect(lockedRow).not.toBeNull();
        expect(lockedRow?.classList.contains('pdf-section-order-row--locked')).toBe(true);
        expect(lockedRow?.querySelectorAll('.pdf-section-order-move-btn')).toHaveLength(0);
        expect(lockedRow?.draggable).toBe(false);
    });

    it('les boutons monter/descendre sont désactivés aux deux bornes de la plage déplaçable', () => {
        initPdfSectionOrderPanel();

        const firstMovable = byId<HTMLElement>('pdfSectionOrderList').querySelector<HTMLElement>('[data-section-id="environnement"]');
        const lastMovable = byId<HTMLElement>('pdfSectionOrderList').querySelector<HTMLElement>('[data-section-id="final"]');

        expect(firstMovable?.querySelector<HTMLButtonElement>('[data-move="-1"]')?.disabled).toBe(true);
        expect(firstMovable?.querySelector<HTMLButtonElement>('[data-move="1"]')?.disabled).toBe(false);
        expect(lastMovable?.querySelector<HTMLButtonElement>('[data-move="1"]')?.disabled).toBe(true);
        expect(lastMovable?.querySelector<HTMLButtonElement>('[data-move="-1"]')?.disabled).toBe(false);
    });

    it("un ordre persisté invalide (ids inconnus) ne casse pas le rendu : repli sur l'ordre par défaut", () => {
        Store.state.formData.pdf_section_order = ['id-fantome', 'autre-id-bidon'];

        expect(() => initPdfSectionOrderPanel()).not.toThrow();
        expect(rowIds()).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
    });
});

describe('boutons monter/descendre', () => {
    it('descendre une section échange sa place avec la suivante, écrit formData.pdf_section_order et régénère l\'aperçu', () => {
        initPdfSectionOrderPanel();

        const envRow = byId<HTMLElement>('pdfSectionOrderList').querySelector<HTMLElement>('[data-section-id="environnement"]');
        envRow?.querySelector<HTMLButtonElement>('[data-move="1"]')?.click();

        expect(Store.state.formData.pdf_section_order).toEqual([
            'adversaires', 'transport', 'environnement', 'mission-execution', 'articulation', 'cat', 'patracdvr', 'final',
        ]);
        expect(rowIds()).toEqual(Store.state.formData.pdf_section_order);
        expect(openPreviewMock).toHaveBeenCalledTimes(1);
    });

    it('monter la première section déplaçable est un no-op (bouton désactivé, jamais de permutation avec la ligne verrouillée)', () => {
        initPdfSectionOrderPanel();

        const envRow = byId<HTMLElement>('pdfSectionOrderList').querySelector<HTMLElement>('[data-section-id="environnement"]');
        envRow?.querySelector<HTMLButtonElement>('[data-move="-1"]')?.click();

        expect(Store.state.formData.pdf_section_order).toBeUndefined();
        expect(openPreviewMock).not.toHaveBeenCalled();
    });
});

describe('réinitialisation', () => {
    it("restaure OI_PDF_DEFAULT_SECTION_ORDER après un réordonnancement et régénère l'aperçu", () => {
        Store.state.formData.pdf_section_order = ['final', 'adversaires', 'environnement', 'transport', 'mission-execution', 'articulation', 'cat', 'patracdvr'];
        initPdfSectionOrderPanel();
        openPreviewMock.mockClear();

        resetPdfSectionOrder();

        expect(Store.state.formData.pdf_section_order).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
        expect(rowIds()).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
        expect(openPreviewMock).toHaveBeenCalledTimes(1);
    });

    it('le bouton « Réinitialiser l\'ordre » déclenche la même réinitialisation', () => {
        Store.state.formData.pdf_section_order = ['final', 'adversaires', 'environnement', 'transport', 'mission-execution', 'articulation', 'cat', 'patracdvr'];
        initPdfSectionOrderPanel();
        openPreviewMock.mockClear();

        byId<HTMLButtonElement>('pdfSectionOrderResetBtn').click();

        expect(Store.state.formData.pdf_section_order).toEqual(OI_PDF_DEFAULT_SECTION_ORDER);
        expect(openPreviewMock).toHaveBeenCalledTimes(1);
    });
});

describe('glisser-déposer', () => {
    it('déplacer une ligne au survol puis relâcher écrit le nouvel ordre DOM dans formData.pdf_section_order (une seule régénération, au relâchement)', () => {
        initPdfSectionOrderPanel();

        // Double de layout : hauteur de ligne fixe (40px), position dérivée du
        // rang DOM courant parmi les enfants du <ol> — assez pour exercer
        // findAfterElement() en conditions réalistes (jsdom ne mesure rien).
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const parent = this.parentElement;
            const idx = parent ? [...parent.children].indexOf(this) : 0;
            return { top: idx * 40, bottom: idx * 40 + 40, height: 40, left: 0, right: 100, width: 100, x: 0, y: idx * 40, toJSON: () => ({}) } as DOMRect;
        });

        const list = byId<HTMLOListElement>('pdfSectionOrderList');
        // 'environnement' (rang 1, juste après la ligne verrouillée) glissée
        // jusqu'au-delà de 'transport' (rang 2) : clientY au milieu de 'transport'.
        const envRow = list.querySelector<HTMLElement>('[data-section-id="environnement"]') as HTMLElement;

        envRow.dispatchEvent(makeDragEvent('dragstart', { dataTransfer: new FakeDataTransfer() }));
        expect(envRow.classList.contains('is-dragging')).toBe(true);

        list.dispatchEvent(makeDragEvent('dragover', { clientY: 2 * 40 + 20 })); // milieu du 3e slot (rang 2)
        // Aucune régénération pendant le survol — seulement au relâchement.
        expect(openPreviewMock).not.toHaveBeenCalled();

        envRow.dispatchEvent(makeDragEvent('dragend'));

        expect(envRow.classList.contains('is-dragging')).toBe(false);
        expect(openPreviewMock).toHaveBeenCalledTimes(1);
        // 'environnement' est passée après 'transport' — la ligne verrouillée reste en tête.
        const order = Store.state.formData.pdf_section_order as string[];
        expect(order[0]).toBe(OI_PDF_LOCKED_SECTION_ID);
        expect(order.indexOf('environnement')).toBeGreaterThan(order.indexOf('transport'));
    });
});

describe('câblage idempotent', () => {
    it("deux appels à initPdfSectionOrderPanel() ne dupliquent pas l'écouteur du bouton bascule (sinon un clic ouvre PUIS referme aussitôt, `classList.toggle` appelé 2×)", () => {
        initPdfSectionOrderPanel();
        initPdfSectionOrderPanel();

        byId<HTMLButtonElement>('pdfSectionOrderToggleBtn').click();

        expect(byId<HTMLElement>('pdfSectionOrderPanel').classList.contains('is-open')).toBe(true);
        expect(byId<HTMLButtonElement>('pdfSectionOrderToggleBtn').getAttribute('aria-expanded')).toBe('true');
    });

    it('renderPdfSectionOrderPanel() seule (sans initPdfSectionOrderPanel) est un no-op silencieux si le panneau est absent du DOM', () => {
        document.body.innerHTML = '';
        expect(() => renderPdfSectionOrderPanel()).not.toThrow();
    });
});
