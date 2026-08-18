/**
 * oi-pdf-preview-edit.test.ts — Tests unitaires de `pdf-preview-edit.ts`
 * (SPEC-2026-08-18-pdf-et-champs.md §2, partie « édition »).
 *
 * `syncDomToStoreImmediate` (`@oi/formulaires.js`) MOCKÉ — la reconstruction
 * complète de `Store.state.formData` depuis `#oi-form` est déjà couverte par
 * `oi-formulaires.test.ts` ; ici on vérifie seulement QUE la correction
 * l'appelle, pas ce qu'elle fait.
 *
 * pdf.js (`PDFPageProxy`/`PageViewport`) n'est jamais exécuté sous jsdom
 * (même précédent que `defaultRenderPdf`, `oi-pdf-engine-v2.test.ts`) : de
 * simples objets DUCK-TYPÉS (`getTextContent`/`convertToViewportPoint`)
 * tiennent lieu de doubles, castés via `unknown` (comportement RÉEL de ces
 * classes non nécessaire ici — seule leur FORME utilisée par
 * `attachEditableTextLayer` compte).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachEditableTextLayer, collectEditCandidates } from '@oi/pdf-preview-edit.js';
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

const syncSpy = vi.hoisted(() => vi.fn());
vi.mock('@oi/formulaires.js', () => ({
    syncDomToStoreImmediate: syncSpy,
}));

interface FakeTextItem {
    str: string;
    transform: number[];
    width: number;
    height: number;
}

function fakePage(items: FakeTextItem[]): PDFPageProxy {
    return {
        getTextContent: vi.fn(async () => ({ items, styles: {}, lang: null })),
    } as unknown as PDFPageProxy;
}

/** `convertToViewportPoint` identité (dpr=1 dans tous les tests) — rend les bbox attendues triviales à calculer. */
function fakeViewport(): PageViewport {
    return {
        convertToViewportPoint: (x: number, y: number): [number, number] => [x, y],
    } as unknown as PageViewport;
}

function buildForm(): HTMLFormElement {
    const form = document.createElement('form');
    form.id = 'oi-form';
    document.body.appendChild(form);
    return form;
}

function addField(
    form: HTMLFormElement,
    id: string,
    value: string,
    opts?: { tag?: 'input' | 'textarea' | 'select'; type?: string },
): HTMLInputElement | HTMLTextAreaElement {
    const el = document.createElement(opts?.tag ?? 'input');
    el.id = id;
    if (opts?.type && el instanceof HTMLInputElement) el.type = opts.type;
    // jsdom : un <input type="file"> refuse toute valeur programmatique non vide.
    if (opts?.type !== 'file' && 'value' in el) (el as HTMLInputElement).value = value;
    form.appendChild(el);
    return el as HTMLInputElement | HTMLTextAreaElement;
}

function buildPageEl(pageNumber: number): { pageEl: HTMLElement; overlay: HTMLElement } {
    const pageEl = document.createElement('div');
    pageEl.className = 'pdf-preview-page';
    pageEl.dataset.pageNumber = String(pageNumber);
    const overlay = document.createElement('div');
    overlay.className = 'pdf-preview-page-overlay';
    pageEl.appendChild(overlay);
    document.body.appendChild(pageEl);
    return { pageEl, overlay };
}

afterEach(() => {
    document.body.innerHTML = '';
    syncSpy.mockClear();
});

describe('collectEditCandidates', () => {
    it('regroupe les champs #oi-form par valeur normalisée (espaces/soft-hyphen) et exclut select/checkbox/file/hidden', () => {
        const form = buildForm();
        addField(form, 'mission', 'Interpellation ABC');
        addField(form, 'no_go', 'Interpellation ABC'); // même valeur qu'un autre champ -> groupe ambigu
        addField(form, 'uda', '  Texte   avec   espaces  ', { tag: 'textarea' });
        addField(form, 'ignored_select', 'x', { tag: 'select' });
        addField(form, 'ignored_checkbox', 'x', { type: 'checkbox' });
        addField(form, 'ignored_file', 'x', { type: 'file' });
        addField(form, 'ignored_hidden', 'x', { type: 'hidden' });
        addField(form, 'blank', '   ');

        const candidates = collectEditCandidates();

        expect(candidates.get('Interpellation ABC')).toHaveLength(2);
        expect(candidates.get('Texte avec espaces')).toHaveLength(1);
        expect(candidates.has('x')).toBe(false); // select/checkbox/file/hidden jamais candidats
        expect(candidates.has('')).toBe(false); // valeur blanche jamais candidate
    });
});

describe('attachEditableTextLayer', () => {
    it("ne pose une zone cliquable QUE sur les fragments dont la valeur correspond à EXACTEMENT un champ", async () => {
        const form = buildForm();
        const missionEl = addField(form, 'mission', 'ABC');
        addField(form, 'no_go', 'ambigu');
        addField(form, 'uda', 'ambigu'); // même valeur -> 'ambigu' non éditable
        const candidates = collectEditCandidates();

        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'ABC', transform: [1, 0, 0, 1, 10, 20], width: 30, height: 12 },
            { str: 'ambigu', transform: [1, 0, 0, 1, 50, 20], width: 20, height: 10 },
            { str: 'Titre non lié à un champ', transform: [1, 0, 0, 1, 0, 0], width: 100, height: 10 },
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, candidates, vi.fn());

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1);
        expect(hits[0]?.style.left).toBe('10px');
        expect(hits[0]?.style.top).toBe('20px');
        expect(hits[0]?.style.width).toBe('30px');
        expect(hits[0]?.style.height).toBe('12px');
        expect(missionEl.value).toBe('ABC');
    });

    it('un clic ouvre un éditeur prérempli ; la perte de focus valide, écrit dans le CHAMP SOURCE et régénère', async () => {
        const form = buildForm();
        const missionEl = addField(form, 'mission', 'ABC');
        const candidates = collectEditCandidates();
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 20], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, candidates, regenerate);
        const hit = overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit');
        if (!hit) throw new Error('zone cliquable absente');
        hit.click();

        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');
        expect(editor.value).toBe('ABC');

        editor.value = 'ABC corrigé';
        editor.dispatchEvent(new Event('blur'));

        expect(missionEl.value).toBe('ABC corrigé');
        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(regenerate).toHaveBeenCalledTimes(1);
        expect(overlay.querySelector('.pdf-edit-input')).toBeNull(); // éditeur refermé
    });

    it('Échap annule : referme l\'éditeur SANS écrire ni régénérer', async () => {
        const form = buildForm();
        const missionEl = addField(form, 'mission', 'ABC');
        const candidates = collectEditCandidates();
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 20], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, candidates, regenerate);
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();
        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');
        editor.value = 'valeur jetée';
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        editor.dispatchEvent(new Event('blur'));

        expect(missionEl.value).toBe('ABC');
        expect(syncSpy).not.toHaveBeenCalled();
        expect(regenerate).not.toHaveBeenCalled();
    });

    it('aucun champ candidat : ne pose aucune zone (évite un scan DOM inutile)', async () => {
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 20], width: 30, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, new Map(), vi.fn());

        expect(page.getTextContent).not.toHaveBeenCalled();
        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(0);
    });
});
