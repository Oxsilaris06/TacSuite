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

import { attachEditableTextLayer, commitEdit, createEditMatchState, resolveEditCandidates } from '@oi/pdf-preview-edit.js';
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

/** `type` optionnel (input seulement, ex. `'date'`/`'time'`) — posé AVANT `value` pour que la sanitisation native du type s'applique dès la construction, même précédent que les champs réels (`oi/index.html`). */
function addField(form: HTMLFormElement, id: string, value: string, tag: 'input' | 'textarea' = 'input', type?: string): HTMLInputElement | HTMLTextAreaElement {
    const el = document.createElement(tag);
    el.id = id;
    if (type && el instanceof HTMLInputElement) el.type = type;
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
        expect(candidates.get('#mission::0::')?.el).toBe(missionEl);
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
        expect(candidates.get('.dash-item::0::')?.el).toBe(el0);
        expect(candidates.get('.dash-item::1::')?.el).toBe(el1);
    });

    it('aucun ancrage : Map vide', () => {
        buildForm();
        expect(resolveEditCandidates([]).size).toBe(0);
    });

    // -- Second chemin d'écriture : ancrages `kind: 'dataset'` (mission
    // « tout le texte modifiable », JSDoc de fichier § SECOND CHEMIN
    // D'ÉCRITURE) — pastilles/boutons PATRACDVR, ni <input> ni <textarea>.

    it("un ancrage kind='dataset' dont l'élément source existe dans le DOM produit un candidat DATASET (pas field), quel que soit le tag DOM", () => {
        const form = buildForm();
        const btn = document.createElement('button');
        btn.className = 'patracdvr-member-btn';
        btn.dataset.trigramme = 'ABC';
        form.appendChild(btn);

        const candidates = resolveEditCandidates([{ selector: '.patracdvr-member-btn', index: 0, value: 'ABC', kind: 'dataset', datasetKey: 'trigramme' }]);

        expect(candidates.size).toBe(1);
        const candidate = candidates.get('.patracdvr-member-btn::0::trigramme');
        expect(candidate?.kind).toBe('dataset');
        expect(candidate?.el).toBe(btn);
        expect(candidate?.kind === 'dataset' && candidate.datasetKey).toBe('trigramme');
    });

    it("un ancrage kind='dataset' SANS datasetKey (émission fautive, ne devrait jamais se produire en pratique) ne produit aucun candidat — repli sûr", () => {
        const form = buildForm();
        const btn = document.createElement('button');
        btn.className = 'patracdvr-member-btn';
        form.appendChild(btn);

        const candidates = resolveEditCandidates([{ selector: '.patracdvr-member-btn', index: 0, value: 'ABC', kind: 'dataset' }]);
        expect(candidates.size).toBe(0);
    });

    it("un ancrage kind='field' (défaut) ciblant le MÊME bouton (ni input ni textarea) reste exclu — la distinction 'dataset' est bien nécessaire, pas un simple assouplissement du filtre existant", () => {
        const form = buildForm();
        const btn = document.createElement('button');
        btn.className = 'patracdvr-member-btn';
        btn.dataset.trigramme = 'ABC';
        form.appendChild(btn);

        expect(resolveEditCandidates([anchor('.patracdvr-member-btn', 'ABC')]).size).toBe(0);
    });

    it("RÉGRESSION (mesure navigateur RÉEL, campagne PATRACDVR) — 2 ancrages 'dataset' du MÊME élément (même sélecteur, même rang par défaut 0) mais de datasetKey DIFFÉRENT (trigramme/dir) résolvent CHACUN vers son PROPRE candidat, jamais un seul partagé : `anchorKey` doit désambiguïser par `datasetKey`, pas seulement sélecteur+rang", () => {
        const form = buildForm();
        const btn = document.createElement('button');
        btn.className = 'patracdvr-member-btn';
        btn.dataset.trigramme = 'GHI';
        btn.dataset.dir = 'PSIG ANTIBES';
        form.appendChild(btn);

        // Même sélecteur, même rang (0, implicite) — SEUL le datasetKey diffère,
        // exactement le cas réel `patracMemberDatasetAnchor('GHI', 'trigramme', …)`
        // vs `patracMemberDatasetAnchor('GHI', 'dir', …)` (document-builder.ts).
        const candidates = resolveEditCandidates([
            { selector: '.patracdvr-member-btn', index: 0, value: 'GHI', kind: 'dataset', datasetKey: 'trigramme' },
            { selector: '.patracdvr-member-btn', index: 0, value: 'PSIG ANTIBES', kind: 'dataset', datasetKey: 'dir' },
        ]);

        // AVANT LE CORRECTIF : size === 1 (les 2 ancrages collisionnaient sur
        // la MÊME clé sélecteur+rang, le 1er — trigramme — écrasait le 2e).
        expect(candidates.size).toBe(2);
        const trigCandidate = candidates.get('.patracdvr-member-btn::0::trigramme');
        const dirCandidate = candidates.get('.patracdvr-member-btn::0::dir');
        expect(trigCandidate?.kind === 'dataset' && trigCandidate.datasetKey).toBe('trigramme');
        expect(dirCandidate?.kind === 'dataset' && dirCandidate.datasetKey).toBe('dir');
        // Les 2 candidats visent bien le MÊME élément DOM (c'est la donnée du
        // champ, pas l'élément, qui doit être distinguée) — la distinction
        // porte uniquement sur `datasetKey`.
        expect(trigCandidate?.el).toBe(btn);
        expect(dirCandidate?.el).toBe(btn);
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

    // -- Garde-fous de validation (mission « garde-fous d'édition », bug
    // reproduit sur `lever_soleil` : un `<input type="time">` recevant un
    // format invalide était VIDÉ silencieusement par le navigateur, aucun
    // avertissement — cf. JSDoc `commitEdit`). ----------------------------

    it("l'éditeur ouvert sur un champ source type=\"time\" est LUI-MÊME un <input type=\"time\"> (spec §2 point 2 — épouse le type du champ, pas une saisie libre)", async () => {
        const form = buildForm();
        addField(form, 'lever_soleil', '06:45', 'input', 'time');
        const state = createEditMatchState([anchor('#lever_soleil', '06:45')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: '06:45', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, vi.fn(async () => {}));
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();

        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        expect(editor?.type).toBe('time');
        expect(editor?.value).toBe('06:45');
    });

    // `commitEdit` testée DIRECTEMENT (exportée pour cette raison, cf. son
    // JSDoc) : le cycle complet `openEditor`/blur ne peut plus reproduire ces
    // 2 régressions une fois `applyFieldConstraints` posé — un éditeur
    // `type="time"`/`"date"` assainit déjà lui-même toute saisie non conforme
    // AVANT que `commitEdit` ne la voie (même algorithme navigateur, cf.
    // vérification manuelle : jsdom applique la MÊME sanitisation qu'un vrai
    // navigateur sur `.value =` pour ces types). `commitEdit` reste
    // néanmoins LA garde qui empêchait historiquement rien — cf. le champ
    // source RÉEL `type="time"`/`"date"` ci-dessous, jamais un éditeur — donc
    // la seule façon d'exercer effectivement la sanitisation navigateur SUR
    // LE CHAMP SOURCE (exactement le bug reproduit : `el.value = newValue`
    // sans garde) est d'appeler la fonction qui le fait.

    it('RÉGRESSION — commitEdit sur un champ source type="time" (lever_soleil) : un format invalide ne vide JAMAIS le champ, valeur précédente conservée, message de refus renvoyé, aucune régénération', async () => {
        const form = buildForm();
        const leverEl = addField(form, 'lever_soleil', '06:45', 'input', 'time');
        const regenerate = vi.fn(async () => {});

        const result = commitEdit({ kind: 'field', el: leverEl }, '25:99', 1, regenerate); // heure hors bornes — un navigateur/jsdom la rejette en assainissant `.value` à ""

        expect(result.ok).toBe(false);
        expect(leverEl.value).toBe('06:45'); // JAMAIS vidé — le cœur de la régression (bug reproduit : l'ancien code écrivait sans garde)
        expect(syncSpy).not.toHaveBeenCalled();
        expect(regenerate).not.toHaveBeenCalled();
        if (result.ok) throw new Error('unreachable');
        expect(result.message).toContain('HH:MM');
    });

    it('RÉGRESSION — commitEdit sur un champ source type="date" (ex. date_op) : un format invalide ne vide jamais le champ (même bug que lever_soleil)', async () => {
        const form = buildForm();
        const dateEl = addField(form, 'date_op', '2026-08-19', 'input', 'date');
        const regenerate = vi.fn(async () => {});

        const result = commitEdit({ kind: 'field', el: dateEl }, '19/08/2026', 1, regenerate); // format FR, pas ISO — invalide pour type="date"

        expect(result.ok).toBe(false);
        expect(dateEl.value).toBe('2026-08-19');
        expect(regenerate).not.toHaveBeenCalled();
        if (result.ok) throw new Error('unreachable');
        expect(result.message).toContain('AAAA-MM-JJ');
    });

    it('RÉGRESSION (garde 2, mesure navigateur RÉEL — Chromium, pas seulement jsdom) — le cycle complet clic→édition→blur sur lever_soleil ne vide JAMAIS le champ, même quand l\'ÉDITEUR type="time" assainit lui-même la saisie en "" AVANT que commitEdit ne la voie', async () => {
        // La garde 1 seule (commitEdit relit el.value après affectation) ne
        // suffit PAS ici : une fois l'éditeur mirroré type="time"
        // (applyFieldConstraints), IL assainit déjà la saisie hors bornes en
        // "" — commitEdit reçoit alors newValue="" directement, un vidage qui
        // checkValidity() considère à tort comme un état valide (champ non
        // required). Constaté en navigateur réel : sans la garde 2, ce test
        // échouait (`leverEl.value` devenait "") alors que les tests
        // `commitEdit` directs ci-dessus passaient déjà — la garde 1 seule ne
        // couvre pas CE chemin précis.
        const form = buildForm();
        const leverEl = addField(form, 'lever_soleil', '06:26', 'input', 'time');
        const state = createEditMatchState([anchor('#lever_soleil', '06:26')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: '06:26', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();
        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');
        expect(editor.type).toBe('time');

        editor.value = '25:99'; // hors bornes — L'ÉDITEUR (type="time") l'assainit déjà en "" ici
        expect(editor.value).toBe(''); // prémisse du scénario : commitEdit reçoit bien newValue=""
        editor.dispatchEvent(new Event('blur'));

        expect(leverEl.value).toBe('06:26'); // JAMAIS vidé
        expect(regenerate).not.toHaveBeenCalled();
        expect(overlay.querySelector('.pdf-edit-error')?.textContent).toContain('viderait');
    });

    it("le cycle complet clic→édition→blur affiche le message de refus (`.pdf-edit-error`, role=\"alert\") quand la correction est rejetée — preuve visuelle end-to-end (spec §2 point 4)", async () => {
        const form = buildForm();
        const trigrammeEl = addField(form, 'trigramme', 'ABC') as HTMLInputElement;
        trigrammeEl.pattern = '[A-Z]{3}'; // contrainte NON assainie à l'affectation (contrairement à date/time) — atteint bien `commitEdit` via le cycle normal, cf. commentaire ci-dessus
        const state = createEditMatchState([anchor('#trigramme', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();
        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');

        editor.value = 'abc-invalide';
        editor.dispatchEvent(new Event('blur'));

        expect(trigrammeEl.value).toBe('ABC'); // champ inchangé
        expect(regenerate).not.toHaveBeenCalled();
        const errorEl = overlay.querySelector('.pdf-edit-error');
        expect(errorEl).not.toBeNull();
        expect(errorEl?.getAttribute('role')).toBe('alert');
        expect(overlay.querySelector('.pdf-edit-input')).toBeNull(); // éditeur refermé (pas de focus-trap)
    });

    it('une correction VALIDE sur un champ type="date" écrit normalement (couverture positive, symétrique du test de régression)', async () => {
        const form = buildForm();
        const dateEl = addField(form, 'date_op', '2026-08-19', 'input', 'date');
        const state = createEditMatchState([anchor('#date_op', '2026-08-19')]);
        Element.prototype.scrollIntoView = vi.fn();
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: '2026-08-19', transform: [1, 0, 0, 1, 10, 50], width: 60, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();
        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');

        editor.value = '2026-09-01';
        editor.dispatchEvent(new Event('blur'));

        expect(dateEl.value).toBe('2026-09-01');
        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(regenerate).toHaveBeenCalledTimes(1);
        expect(overlay.querySelector('.pdf-edit-error')).toBeNull();
    });

    it('une contrainte native générique (`pattern`, non utilisée aujourd\'hui par `#oi-form` mais couverte par construction) rejette une valeur non conforme SANS écrire, avec le `validationMessage` natif du navigateur', async () => {
        const form = buildForm();
        const trigrammeEl = addField(form, 'trigramme', 'ABC') as HTMLInputElement;
        trigrammeEl.pattern = '[A-Z]{3}';
        const state = createEditMatchState([anchor('#trigramme', 'ABC')]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
        overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit')?.click();
        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');
        expect(editor.pattern).toBe('[A-Z]{3}'); // contrainte reflétée sur l'éditeur

        editor.value = 'abc-invalide';
        editor.dispatchEvent(new Event('blur'));

        expect(trigrammeEl.value).toBe('ABC');
        expect(regenerate).not.toHaveBeenCalled();
        expect(overlay.querySelector('.pdf-edit-error')).not.toBeNull();
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

// ===========================================================================
// Second chemin d'écriture — `commitEdit` / candidats `kind: 'dataset'`
// (mission « tout le texte modifiable », JSDoc de fichier § SECOND CHEMIN
// D'ÉCRITURE) : pastilles/boutons PATRACDVR, valeur portée par `dataset`,
// aucun `<input>`/`<textarea>` source. Même style de test DIRECT que les
// gardes `commitEdit` (chemin `field`) ci-dessus (`commitEdit exportée pour
// test unitaire direct`).
// ===========================================================================
describe("commitEdit — chemin dataset (pastilles/boutons PATRACDVR)", () => {
    function patracMemberEl(trigramme: string, dir = ''): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'patracdvr-member-btn';
        btn.dataset.trigramme = trigramme;
        btn.dataset.dir = dir;
        document.body.appendChild(btn);
        return btn;
    }

    function vehicleRowEl(name: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'patracdvr-vehicle-row';
        row.dataset.vehicleName = name;
        const nameEl = document.createElement('span');
        nameEl.className = 'vehicle-name';
        nameEl.textContent = name;
        row.appendChild(nameEl);
        document.body.appendChild(row);
        return row;
    }

    it('trigramme : écrit dans le dataset EN MAJUSCULE (même normalisation que le panneau Édition Rapide), repeint le bouton, régénère la composition articulation, synchronise et régénère le PDF', () => {
        const btn = patracMemberEl('abc');
        const visuals = vi.fn();
        const articulation = vi.fn();
        window.updateMemberButtonVisuals = visuals;
        window.updateArticulationDisplay = articulation;
        const regenerate = vi.fn(async () => {});

        const result = commitEdit({ kind: 'dataset', el: btn, datasetKey: 'trigramme' }, 'xyz', 1, regenerate);

        expect(result.ok).toBe(true);
        expect(btn.dataset.trigramme).toBe('XYZ');
        expect(visuals).toHaveBeenCalledWith(btn);
        expect(articulation).toHaveBeenCalledTimes(1);
        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(regenerate).toHaveBeenCalledTimes(1);
    });

    it('dir : écrit dans le dataset SANS normalisation (aucune des 2 UI existantes ne transforme ce champ)', () => {
        const btn = patracMemberEl('ABC', '');
        window.updateMemberButtonVisuals = vi.fn();
        window.updateArticulationDisplay = vi.fn();
        const regenerate = vi.fn(async () => {});

        const result = commitEdit({ kind: 'dataset', el: btn, datasetKey: 'dir' }, 'G3', 1, regenerate);

        expect(result.ok).toBe(true);
        expect(btn.dataset.dir).toBe('G3');
    });

    it("vehicleName : écrit dans le dataset AVEC trim() (même normalisation que renameVehicle) ET met à jour le texte affiché '.vehicle-name' — même effet que le renommage live, sans réimplémenter updateMemberButtonVisuals (non pertinent pour un véhicule)", () => {
        const row = vehicleRowEl('KODIAQ');
        const visuals = vi.fn();
        window.updateMemberButtonVisuals = visuals;
        window.updateArticulationDisplay = vi.fn();
        const regenerate = vi.fn(async () => {});

        const result = commitEdit({ kind: 'dataset', el: row, datasetKey: 'vehicleName' }, '  SHARAN  ', 1, regenerate);

        expect(result.ok).toBe(true);
        expect(row.dataset.vehicleName).toBe('SHARAN');
        expect(row.querySelector('.vehicle-name')?.textContent).toBe('SHARAN');
        expect(visuals).not.toHaveBeenCalled(); // pas un membre — n'a rien à voir avec le bouton PAX
    });

    it('REFUS — transition non-vide vers vide : MÊME garde que le chemin field (EMPTYING_REJECTED_MESSAGE), aucune synchronisation ni régénération', () => {
        const btn = patracMemberEl('ABC');
        const regenerate = vi.fn(async () => {});

        const result = commitEdit({ kind: 'dataset', el: btn, datasetKey: 'trigramme' }, '', 1, regenerate);

        expect(result.ok).toBe(false);
        expect(btn.dataset.trigramme).toBe('ABC'); // jamais vidé
        expect(regenerate).not.toHaveBeenCalled();
        expect(syncSpy).not.toHaveBeenCalled();
        if (result.ok) throw new Error('unreachable');
        expect(result.message).toContain('viderait');
    });

    it('aucun changement réel (valeur normalisée identique à la précédente, ex. casse différente sur un trigramme) : ok, mais AUCUN effet de bord déclenché — même contrat fast-path que le chemin field', () => {
        const btn = patracMemberEl('ABC');
        const visuals = vi.fn();
        window.updateMemberButtonVisuals = visuals;
        const regenerate = vi.fn(async () => {});

        const result = commitEdit({ kind: 'dataset', el: btn, datasetKey: 'trigramme' }, 'abc', 1, regenerate);

        expect(result.ok).toBe(true);
        expect(visuals).not.toHaveBeenCalled();
        expect(regenerate).not.toHaveBeenCalled();
        expect(syncSpy).not.toHaveBeenCalled();
    });

    it("le cycle complet clic→édition→blur sur une pastille PATRACDVR (fragment pdf.js = trigramme) écrit dans le dataset ET régénère l'aperçu — preuve end-to-end du 2e chemin d'écriture", async () => {
        const btn = patracMemberEl('ABC');
        window.updateMemberButtonVisuals = vi.fn();
        window.updateArticulationDisplay = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
        const state = createEditMatchState([{ selector: '.patracdvr-member-btn', index: 0, value: 'ABC', kind: 'dataset', datasetKey: 'trigramme' }]);
        const { pageEl, overlay } = buildPageEl(1);
        const page = fakePage([{ str: 'ABC', transform: [1, 0, 0, 1, 10, 50], width: 30, height: 12 }]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
        const hit = overlay.querySelector<HTMLButtonElement>('.pdf-edit-hit');
        if (!hit) throw new Error('zone cliquable absente');
        hit.click();

        const editor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!editor) throw new Error('éditeur absent');
        expect(editor.value).toBe('ABC'); // préempli avec la valeur COURANTE du dataset (pas un <select>, un <input> texte plein)

        editor.value = 'xyz';
        editor.dispatchEvent(new Event('blur'));

        expect(btn.dataset.trigramme).toBe('XYZ');
        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(regenerate).toHaveBeenCalledTimes(1);
        expect(overlay.querySelector('.pdf-edit-input')).toBeNull();
    });

    it("RÉGRESSION end-to-end (mesure navigateur RÉEL, campagne PATRACDVR — cas exact mesuré : trigramme 'GHI' + dir 'PSIG ANTIBES' du MÊME membre) — cliquer le fragment DIR ouvre l'éditeur DIR (jamais le trigramme), et réciproquement, même si les 2 ancrages partagent sélecteur et rang", async () => {
        const btn = patracMemberEl('GHI', 'PSIG ANTIBES');
        window.updateMemberButtonVisuals = vi.fn();
        window.updateArticulationDisplay = vi.fn();
        const state = createEditMatchState([
            { selector: '.patracdvr-member-btn', index: 0, value: 'GHI', kind: 'dataset', datasetKey: 'trigramme' },
            { selector: '.patracdvr-member-btn', index: 0, value: 'PSIG ANTIBES', kind: 'dataset', datasetKey: 'dir' },
        ]);
        const { pageEl, overlay } = buildPageEl(1);
        // Reproduit le découpage RÉEL observé (pdf.js, page PATRACDVR) : le
        // trigramme est UN fragment, la valeur DIR est scindée en 2 (« PSIG »
        // puis « ANTIBES ») — cf. capture navigateur réel, frag-dump page 14.
        const page = fakePage([
            { str: 'GHI', transform: [1, 0, 0, 1, 10, 50], width: 20, height: 12 },
            { str: 'PSIG', transform: [1, 0, 0, 1, 200, 50], width: 30, height: 12 },
            { str: 'ANTIBES', transform: [1, 0, 0, 1, 240, 50], width: 40, height: 12 },
        ]);
        const regenerate = vi.fn(async () => {});

        await attachEditableTextLayer(page, pageEl, overlay, fakeViewport(), 1, state, regenerate);
        expect(state.stats.anchorsResolved).toBe(2); // trigramme ET dir, tous deux résolus (pas une seule entrée partagée)

        const hits = overlay.querySelectorAll<HTMLButtonElement>('.pdf-edit-hit');
        expect(hits).toHaveLength(3); // 1 (GHI) + 2 (PSIG, ANTIBES — même champ dir)

        const dirHit = Array.from(hits).find((h) => h.getAttribute('aria-label')?.includes('ANTIBES'));
        if (!dirHit) throw new Error('zone DIR (ANTIBES) absente');
        dirHit.click();
        const dirEditor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!dirEditor) throw new Error('éditeur DIR absent');
        expect(dirEditor.value).toBe('PSIG ANTIBES'); // JAMAIS 'GHI' — cf. régression mesurée
        dirEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        dirEditor.dispatchEvent(new Event('blur'));

        const trigHit = Array.from(hits).find((h) => h.getAttribute('aria-label')?.includes('GHI'));
        if (!trigHit) throw new Error('zone trigramme (GHI) absente');
        trigHit.click();
        const trigEditor = overlay.querySelector<HTMLInputElement>('.pdf-edit-input');
        if (!trigEditor) throw new Error('éditeur trigramme absent');
        expect(trigEditor.value).toBe('GHI'); // JAMAIS 'PSIG ANTIBES'
        trigEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        trigEditor.dispatchEvent(new Event('blur'));

        expect(btn.dataset.trigramme).toBe('GHI'); // rien commité (Échap dans les 2 cas) — champ toujours intact
        expect(btn.dataset.dir).toBe('PSIG ANTIBES');
        expect(regenerate).not.toHaveBeenCalled();
    });
});
