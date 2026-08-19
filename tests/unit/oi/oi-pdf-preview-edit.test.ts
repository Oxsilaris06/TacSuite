/**
 * oi-pdf-preview-edit.test.ts — Tests unitaires de `pdf-preview-edit.ts`
 * (SPEC-2026-08-18-pdf-et-champs.md §2, partie « édition »).
 *
 * RÉÉCRIT (2026-08-19) contre la NOUVELLE API — index d'ancrage émis à la
 * génération (`OiPdfEditAnchor`, `@shared/types/contracts.ts`) au lieu de
 * l'ancien rapprochement par ÉGALITÉ DE VALEUR ENTIÈRE.
 *
 * ÉVOLUÉ (mission « robustesse alignement », même jour) — l'alignement en
 * flux à curseur STRICTEMENT séquentiel figeait DÉFINITIVEMENT dès qu'un
 * ancrage divergeait de l'ordre d'affichage (perte de TOUS les ancrages
 * suivants, mesuré en navigateur réel : 52,7 % de couverture). Cf. JSDoc de
 * fichier `pdf-preview-edit.ts` pour les 3 garanties retenues (fenêtre
 * bornée, budget d'abandon borné, seuil de plausibilité d'amorçage) et
 * l'exclusion du pied de page par position — les nouveaux tests ci-dessous
 * couvrent CES garanties spécifiquement, en plus des cas déjà couverts.
 *
 * `syncDomToStoreImmediate` (`@oi/formulaires.js`) MOCKÉ — la reconstruction
 * complète de `Store.state.formData` depuis `#oi-form` est déjà couverte par
 * `oi-formulaires.test.ts` ; ici on vérifie seulement QUE la correction
 * l'appelle, pas ce qu'elle fait.
 *
 * pdf.js (`PDFPageProxy`/`PageViewport`) n'est jamais exécuté sous jsdom
 * (même précédent que `defaultRenderPdf`, `oi-pdf-engine-v2.test.ts`) : de
 * simples objets DUCK-TYPÉS (`getTextContent`/`convertToViewportPoint`/
 * `viewBox`) tiennent lieu de doubles, castés via `unknown` (comportement
 * RÉEL de ces classes non nécessaire ici — seule leur FORME utilisée par
 * `attachEditableTextLayer` compte). `convertToViewportPoint` identité
 * (dpr=1 dans tous les tests) rend les bbox attendues triviales à calculer.
 * `viewBox` par défaut `[0, 0, 400, 150]` (repère PDF brut, cf. JSDoc
 * `isFooterFragment`) : la zone de pied de page est un seuil ABSOLU
 * (`FOOTER_ZONE_PT` = 34 pt depuis le bas, indépendant de la hauteur de
 * page) — tous les fragments « corps » des tests ci-dessous sont à `y ≥ 50`,
 * hors zone de pied de page par construction ; le test dédié au pied de page
 * utilise volontairement `y = 5` (< 34) pour y entrer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachEditableTextLayer, createEditMatchState, resolveEditCandidates } from '@oi/pdf-preview-edit.js';
import type { OiPdfEditAnchor } from '@shared/types/contracts.js';
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

/** `viewBox` par défaut `[0, 0, 400, 150]` — cf. en-tête de fichier pour le calcul de la zone de pied de page qui en découle. */
function fakeViewport(viewBox: [number, number, number, number] = [0, 0, 400, 150]): PageViewport {
    return {
        viewBox,
        convertToViewportPoint: (x: number, y: number): [number, number] => [x, y],
    } as unknown as PageViewport;
}

function buildForm(): HTMLFormElement {
    const form = document.createElement('form');
    form.id = 'oi-form';
    document.body.appendChild(form);
    return form;
}

function addField(form: HTMLFormElement, id: string, value: string, tag: 'input' | 'textarea' = 'input'): HTMLInputElement | HTMLTextAreaElement {
    const el = document.createElement(tag);
    el.id = id;
    el.value = value;
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

/** Raccourci — `index` par défaut à 0 (champ non répété), cf. `OiPdfEditAnchor`. */
function anchor(selector: string, value: string, index = 0): OiPdfEditAnchor {
    return { selector, index, value };
}

afterEach(() => {
    document.body.innerHTML = '';
    syncSpy.mockClear();
});

describe('resolveEditCandidates', () => {
    it('un ancrage dont le champ source (#id) existe dans le DOM produit un candidat', () => {
        const form = buildForm();
        const missionEl = addField(form, 'mission', 'ABC');
        const candidates = resolveEditCandidates([anchor('#mission', 'ABC')]);
        expect(candidates.size).toBe(1);
        expect(candidates.get('#mission::0')?.el).toBe(missionEl);
    });

    it("un ancrage sans champ correspondant (sélecteur introuvable) ne produit aucun candidat", () => {
        buildForm();
        const candidates = resolveEditCandidates([anchor('#absent', 'x')]);
        expect(candidates.size).toBe(0);
    });

    it('un sélecteur CSS invalide ne lève pas — ancrage silencieusement omis (repli sûr)', () => {
        buildForm();
        expect(() => resolveEditCandidates([anchor(':::invalide', 'x')])).not.toThrow();
        expect(resolveEditCandidates([anchor(':::invalide', 'x')]).size).toBe(0);
    });

    it('un sélecteur désignant un <select> (jamais émis en pratique) est ignoré — seuls input/textarea sont retenus', () => {
        const form = buildForm();
        const select = document.createElement('select');
        select.id = 'patracdvr';
        form.appendChild(select);
        expect(resolveEditCandidates([anchor('#patracdvr', 'x')]).size).toBe(0);
    });

    it('deux ancrages du MÊME champ (même sélecteur + rang, valeur repliée sur 2 lignes) partagent UNE seule entrée', () => {
        const form = buildForm();
        addField(form, 'uda', 'ligne un ligne deux');
        const candidates = resolveEditCandidates([anchor('#uda', 'ligne un'), anchor('#uda', 'ligne deux')]);
        expect(candidates.size).toBe(1);
    });

    it('deux ancrages du MÊME sélecteur mais de RANG différent (champ répété, ex. dashItemList) résolvent chacun vers son propre élément', () => {
        const form = buildForm();
        const el0 = document.createElement('input');
        el0.className = 'dash-item';
        el0.value = 'A';
        const el1 = document.createElement('input');
        el1.className = 'dash-item';
        el1.value = 'B';
        form.append(el0, el1);

        const candidates = resolveEditCandidates([anchor('.dash-item', 'A', 0), anchor('.dash-item', 'B', 1)]);
        expect(candidates.size).toBe(2);
        expect(candidates.get('.dash-item::0')?.el).toBe(el0);
        expect(candidates.get('.dash-item::1')?.el).toBe(el1);
    });

    it('aucun ancrage : Map vide', () => {
        buildForm();
        expect(resolveEditCandidates([]).size).toBe(0);
    });
});

describe('createEditMatchState', () => {
    it('construit un état initial cohérent : curseur à 0, ancrages et candidats résolus portés tels quels', () => {
        const form = buildForm();
        addField(form, 'mission', 'ABC');
        const anchors = [anchor('#mission', 'ABC')];

        const state = createEditMatchState(anchors);

        expect(state.cursor.i).toBe(0);
        expect(state.anchors).toBe(anchors);
        expect(state.candidates.size).toBe(1);
    });

    it('aucun candidat résolvable : état initial avec une Map de candidats vide', () => {
        buildForm();
        const state = createEditMatchState([anchor('#absent', 'x')]);
        expect(state.cursor.i).toBe(0);
        expect(state.candidates.size).toBe(0);
    });
});

describe('attachEditableTextLayer', () => {
    it('pose une zone cliquable pour un ancrage résolu par un fragment unique', async () => {
        const form = buildForm();
        addField(form, 'mission', 'ABC');
        const state = createEditMatchState([anchor('#mission', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1);
        expect(hits[0]?.style.left).toBe('10px');
        expect(hits[0]?.style.top).toBe('50px');
        expect(hits[0]?.style.width).toBe('30px');
        expect(hits[0]?.style.height).toBe('12px');
        expect(state.cursor.i).toBe(1); // ancrage consommé, curseur avancé
    });

    it("cas essentiel — une valeur étalée sur PLUSIEURS fragments pdf.js est reconstruite par concaténation (une zone par fragment absorbé, toutes liées au MÊME champ source) ; cliquer sur N'IMPORTE LAQUELLE ouvre l'éditeur avec la valeur COMPLÈTE", async () => {
        const form = buildForm();
        const missionEl = addField(form, 'mission', 'Ligne un Ligne deux');
        const state = createEditMatchState([anchor('#mission', 'Ligne un Ligne deux')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'Ligne un', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 },
            { str: 'Ligne deux', transform: [1, 0, 0, 1, 10, 64], width: 40, height: 12 },
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(2); // un par fragment absorbé — cf. JSDoc fichier « plusieurs zones... même champ »
        expect(state.cursor.i).toBe(1); // un seul ancrage consommé (pas un par fragment)

        hits[1]?.click(); // clic sur le DEUXIÈME fragment, pas le premier
        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        expect(editor?.value).toBe('Ligne un Ligne deux'); // valeur COMPLÈTE actuelle du champ, pas juste le fragment cliqué
        expect(missionEl.value).toBe('Ligne un Ligne deux'); // pas encore validé (pas de blur)
    });

    it("un fragment ne correspondant à AUCUN ancrage (titre, libellé) ne produit aucune zone", async () => {
        const form = buildForm();
        addField(form, 'mission', 'ABC');
        const state = createEditMatchState([anchor('#mission', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'Titre de section', transform: [1, 0, 0, 1, 0, 0], width: 100, height: 10 },
            { str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 },
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1);
        expect(hits[0]?.getAttribute('aria-label')).toContain('ABC');
    });

    it('un connecteur de ponctuation glué en tête du PREMIER fragment (« : ») ne bloque pas la reconstruction', async () => {
        const form = buildForm();
        addField(form, 'situation', 'SITGEN-42');
        const state = createEditMatchState([anchor('#situation', 'SITGEN-42')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: ': SITGEN-42', transform: [1, 0, 0, 1, 10, 50], width: 50, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(1);
        expect(state.cursor.i).toBe(1);
    });

    it('une reconstruction interrompue par un fragment inattendu est ABANDONNÉE sans zone partielle ; le curseur avance quand même et retente le même fragment contre l\'ancrage suivant', async () => {
        const form = buildForm();
        addField(form, 'mission', 'AB CD'); // valeur qui ne sera JAMAIS entièrement reconstituée
        addField(form, 'suite', 'XYZ');
        const state = createEditMatchState([anchor('#mission', 'AB CD'), anchor('#suite', 'XYZ')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'AB', transform: [1, 0, 0, 1, 10, 50], width: 20, height: 12 }, // amorce une reconstruction pour #mission…
            { str: 'XYZ', transform: [1, 0, 0, 1, 40, 50], width: 20, height: 12 }, // … interrompue ici, puis retentée contre #suite
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1); // AUCUNE zone partielle pour #mission, une seule pour #suite
        expect(hits[0]?.getAttribute('aria-label')).toContain('XYZ');
        expect(state.cursor.i).toBe(2); // les deux ancrages consommés (le premier abandonné, pas rejoué)
    });

    it("un ancrage sans candidat résolu (champ retiré du DOM) est sauté sans consommer de fragment", async () => {
        const form = buildForm();
        addField(form, 'mission', 'ABC');
        // '#ghost' n'existe dans aucun DOM : resolveEditCandidates ne lui associe aucun candidat.
        const state = createEditMatchState([anchor('#ghost', 'ABC'), anchor('#mission', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(1);
        expect(state.cursor.i).toBe(2);
    });

    it('des fragments EN TROP après le dernier ancrage résolu ne provoquent ni zone supplémentaire ni exception', async () => {
        const form = buildForm();
        addField(form, 'mission', 'ABC');
        const state = createEditMatchState([anchor('#mission', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 },
            { str: 'Pied de page hors ancrage', transform: [1, 0, 0, 1, 0, 100], width: 100, height: 10 },
        ]);

        await expect(attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}))).resolves.toBeUndefined();
        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(1);
    });

    it('aucun candidat résolu (tous les ancrages orphelins) : ne pose aucune zone et évite un scan DOM inutile (page.getTextContent jamais appelé)', async () => {
        buildForm(); // aucun champ inséré : #mission introuvable
        const state = createEditMatchState([anchor('#mission', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn());

        expect(page.getTextContent).not.toHaveBeenCalled();
        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(0);
    });

    it('ancrages vides : ne pose aucune zone et évite un scan DOM inutile', async () => {
        const state = createEditMatchState([]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn());

        expect(page.getTextContent).not.toHaveBeenCalled();
        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(0);
    });

    // -- Cycle d'édition : ouverture, validation, annulation ----------------

    it('un clic ouvre un éditeur prérempli ; la perte de focus valide, écrit dans le CHAMP SOURCE, régénère et ramène la page en vue', async () => {
        const form = buildForm();
        const missionEl = addField(form, 'mission', 'ABC');
        const state = createEditMatchState([anchor('#mission', 'ABC')]);
        // jsdom n'implémente PAS `Element.prototype.scrollIntoView` (absent, ni
        // même un no-op) — même précédent que `oi-patrac.test.ts`.
        Element.prototype.scrollIntoView = vi.fn();
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
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
        await vi.waitFor(() => {
            expect(pageEl.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
        });
    });

    it("Échap annule : referme l'éditeur SANS écrire ni régénérer", async () => {
        const form = buildForm();
        const missionEl = addField(form, 'mission', 'ABC');
        const state = createEditMatchState([anchor('#mission', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();
        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');
        editor.value = 'valeur jetée';
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        editor.dispatchEvent(new Event('blur'));

        expect(missionEl.value).toBe('ABC');
        expect(syncSpy).not.toHaveBeenCalled();
        expect(regenerate).not.toHaveBeenCalled();
        expect(overlay.querySelector('.pdf-edit-input')).toBeNull();
    });

    it("ouvre un <textarea> (pas un <input>) quand le champ source en est un", async () => {
        const form = buildForm();
        addField(form, 'uda', 'Texte long', 'textarea');
        const state = createEditMatchState([anchor('#uda', 'Texte long')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'Texte long', transform: [1, 0, 0, 1, 10, 50], width: 60, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();

        expect(overlay.querySelector('.pdf-edit-input')?.tagName).toBe('TEXTAREA');
    });

    // -- Robustesse de l'alignement (mission « robustesse alignement ») -----
    // Les 3 garanties de JSDoc `attachEditableTextLayer` : fenêtre bornée
    // (réordonnancement local toléré), budget d'abandon borné (jamais de gel
    // définitif), seuil de plausibilité (pas d'amorçage sur un jeton trop
    // court) — plus l'exclusion du pied de page par position et la sûreté
    // en cas d'ambiguïté.

    it("un réordonnancement LOCAL de quelques ancrages (cas réel : executionBodyContent) est toléré par la fenêtre en avant — les 3 ancrages sont résolus malgré l'inversion des 2 premiers", async () => {
        const form = buildForm();
        addField(form, 'a', 'AAA');
        addField(form, 'b', 'BBB');
        addField(form, 'c', 'CCC');
        const state = createEditMatchState([anchor('#a', 'AAA'), anchor('#b', 'BBB'), anchor('#c', 'CCC')]);
        const { pageEl, overlay } = buildPageEl(1);
        // Affiché B, A, C — #a et #b enregistrés dans l'ordre inverse de leur affichage.
        const page = fakePage([
            { str: 'BBB', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 },
            { str: 'AAA', transform: [1, 0, 0, 1, 10, 70], width: 30, height: 12 },
            { str: 'CCC', transform: [1, 0, 0, 1, 10, 90], width: 30, height: 12 },
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(3);
        expect(state.cursor.i).toBe(3);
        expect(state.stats.anchorsResolved).toBe(3);
    });

    it("un ancrage dont le texte n'apparaît JAMAIS sur la page est abandonné après un budget de fragments infructueux borné — JAMAIS de gel définitif, l'ancrage suivant reste atteignable", async () => {
        const form = buildForm();
        addField(form, 'introuvable', 'INTROUVABLE-XYZ');
        addField(form, 'suivant', 'SUIVANT-OK');
        const state = createEditMatchState([anchor('#introuvable', 'INTROUVABLE-XYZ'), anchor('#suivant', 'SUIVANT-OK')]);
        const { pageEl, overlay } = buildPageEl(1);
        // 65 fragments de chrome, sans rapport avec aucun ancrage — dépasse largement le budget interne (borné, cf. JSDoc de fichier).
        const filler = Array.from({ length: 65 }, (_, i) => ({
            str: `chrome-${i}`,
            transform: [1, 0, 0, 1, 10, 50 + i] as number[],
            width: 30,
            height: 10,
        }));
        const page = fakePage([...filler, { str: 'SUIVANT-OK', transform: [1, 0, 0, 1, 10, 300], width: 40, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1); // #introuvable jamais résolu — mais #suivant SI (aucune perte en cascade)
        expect(hits[0]?.getAttribute('aria-label')).toContain('SUIVANT-OK');
        expect(state.cursor.i).toBe(2); // les 2 ancrages réglés (le 1er abandonné, pas de gel)
        expect(state.stats.anchorsResolved).toBe(1);
    });

    it("un jeton isolé trop court (ex. « 2 ») ne peut pas amorcer faussement une reconstruction par simple coïncidence de préfixe", async () => {
        const form = buildForm();
        addField(form, 'date_execution', '2026-09-14');
        const state = createEditMatchState([anchor('#date_execution', '2026-09-14')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: '2', transform: [1, 0, 0, 1, 10, 50], width: 8, height: 12 }, // jeton isolé non ancré, préfixe coïncident de la vraie valeur
            { str: '2026-09-14', transform: [1, 0, 0, 1, 30, 50], width: 60, height: 12 }, // la vraie valeur, plus loin
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1); // le « 2 » isolé n'a pas amorcé/consommé de reconstruction
        expect(hits[0]?.style.left).toBe('30px'); // celle du fragment complet, pas du jeton
        expect(state.cursor.i).toBe(1);
    });

    it('un fragment plausible pour PLUSIEURS ancrages de valeurs DIFFÉRENTES (préfixe commun) est ignoré — ambigu, aucune zone posée pour aucun des deux, sans corrompre les ancrages suivants', async () => {
        const form = buildForm();
        addField(form, 'p', 'PSIG GILETTE');
        addField(form, 'q', 'PSIG ALPHA');
        const state = createEditMatchState([anchor('#p', 'PSIG GILETTE'), anchor('#q', 'PSIG ALPHA')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'PSIG', transform: [1, 0, 0, 1, 10, 50], width: 20, height: 12 }, // préfixe commun aux 2 ancrages : ambigu
            { str: 'PSIG ALPHA', transform: [1, 0, 0, 1, 40, 50], width: 50, height: 12 }, // #q entier en un seul fragment, sans ambiguïté
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1);
        expect(hits[0]?.getAttribute('aria-label')).toContain('PSIG ALPHA');
    });

    it('deux ancrages adjacents de valeur IDENTIQUE (ex. deux « OUI ») ne sont PAS traités comme ambigus — le rendu est indiscernable quel que soit celui choisi, les deux se résolvent', async () => {
        const form = buildForm();
        addField(form, 'flag1', 'OUI');
        addField(form, 'flag2', 'OUI');
        const state = createEditMatchState([anchor('#flag1', 'OUI'), anchor('#flag2', 'OUI')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'OUI', transform: [1, 0, 0, 1, 10, 50], width: 20, height: 12 },
            { str: 'OUI', transform: [1, 0, 0, 1, 10, 70], width: 20, height: 12 },
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(2);
        expect(state.cursor.i).toBe(2);
    });

    it('un fragment situé dans la marge basse (pied de page, position verticale) ne consomme JAMAIS un ancrage — même si son texte prolongerait la valeur attendue', async () => {
        const form = buildForm();
        addField(form, 'amies', 'PSIG GILETTE');
        const state = createEditMatchState([anchor('#amies', 'PSIG GILETTE')]);
        const { pageEl, overlay } = buildPageEl(1);
        // Seuil de pied de page ABSOLU (FOOTER_ZONE_PT), indépendant de la hauteur de page — le viewport par défaut suffit.
        const viewport = fakeViewport();
        const page = fakePage([
            { str: 'PSIG GILETTE', transform: [1, 0, 0, 1, 10, 5], width: 60, height: 10 }, // pied de page (y=5 < FOOTER_ZONE_PT=34)
            { str: 'PSIG GILETTE', transform: [1, 0, 0, 1, 10, 90], width: 60, height: 10 }, // corps
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, viewport, 1, state, vi.fn(async () => {}));

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(1);
        expect(hits[0]?.style.top).toBe('90px'); // jamais celle du pied de page
        expect(state.cursor.i).toBe(1);
    });

    it('`state.stats` compte ancrages résolus, zones posées et fragments vus — mesure de couverture exploitable sans changer la signature', async () => {
        const form = buildForm();
        addField(form, 'mission', 'Ligne un Ligne deux');
        const state = createEditMatchState([anchor('#mission', 'Ligne un Ligne deux')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([
            { str: 'Titre', transform: [1, 0, 0, 1, 10, 90], width: 30, height: 10 },
            { str: 'Ligne un', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 },
            { str: 'Ligne deux', transform: [1, 0, 0, 1, 10, 64], width: 40, height: 12 },
        ]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));

        expect(state.stats.anchorsResolved).toBe(1);
        expect(state.stats.hitZonesPlaced).toBe(2); // 2 fragments absorbés pour ce seul ancrage
        expect(state.stats.fragmentsSeen).toBe(3); // les 3 fragments non vides, y compris le titre non apparié
        expect(overlay.querySelectorAll('.pdf-edit-hit')).toHaveLength(state.stats.hitZonesPlaced);
    });
});
