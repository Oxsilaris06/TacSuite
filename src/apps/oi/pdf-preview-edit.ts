/**
 * pdf-preview-edit.ts — Édition en place depuis l'aperçu PDF (SPEC-2026-08-18-
 * pdf-et-champs.md §2, partie « édition »). Appelé par `pdf-engine-v2.ts::
 * defaultRenderPdf`, une fois par page rendue, JAMAIS en test unitaire (même
 * précédent que `defaultRenderPdf` lui-même — cf. son JSDoc).
 *
 * RÉGRESSION CORRIGÉE (mesure du 2026-08-19, cf. rapport de mission) :
 * l'ancienne stratégie (rapprochement par ÉGALITÉ DE VALEUR ENTIÈRE entre un
 * fragment pdf.js et la valeur COMPLÈTE d'un champ `#oi-form`) n'exposait
 * quasiment AUCUNE zone éditable — pdfmake découpe le texte en fragments par
 * LIGNE/STYLE (`page.getTextContent()`), colle parfois la ponctuation du
 * libellé au fragment de valeur, et tout champ dont la valeur s'enroule sur
 * 2+ lignes n'a alors AUCUN fragment qui l'égale exactement.
 *
 * STRATÉGIE RETENUE : index d'ancrage émis À LA GÉNÉRATION (`document-
 * builder.ts`/`blocks.ts`, `BuildCtx.anchors` → `buildOiDocDefinition(...).
 * pdfEditAnchors`) — chaque valeur ISSUE D'UN CHAMP `#oi-form` y est
 * enregistrée avec (a) un SÉLECTEUR CSS résolvant vers son élément DOM
 * source (+ un rang pour les champs répétés partageant un sélecteur), (b)
 * son texte ATTENDU, DANS L'ORDRE D'ÉMISSION du document. Le rapprochement
 * fragment pdf.js → ancrage se fait ICI par ALIGNEMENT en flux, ordonné :
 *
 *   - Un curseur PARTAGÉ (`EditMatchState.cursor`, mutable, avance à travers
 *     TOUTES les pages dans l'ordre où `defaultRenderPdf` les peint) pointe
 *     l'ancrage COURANT à retrouver. Pour chaque fragment pdf.js rencontré
 *     (dans l'ordre où pdf.js les restitue — vérifié EMPIRIQUEMENT fidèle à
 *     l'ordre d'émission du document, y compris à travers les mises en page
 *     `columns`/`grid2`, cf. rapport de mission) : s'il ÉTEND la valeur
 *     ATTENDUE de l'ancrage courant (préfixe, espaces normalisés — une
 *     valeur repliée sur N lignes est simplement la CONCATÉNATION, espace
 *     par espace, de ses fragments), il est absorbé et une zone cliquable
 *     lui est posée ; une fois la valeur ENTIÈRE reconstituée, l'ancrage est
 *     validé et le curseur avance à l'ancrage suivant.
 *   - Un fragment qui n'étend PAS l'ancrage courant (titre, libellé,
 *     ponctuation, connecteur) est simplement IGNORÉ (aucune zone posée) SI
 *     aucune reconstitution n'est en cours ; s'il INTERROMPT une
 *     reconstitution déjà entamée, celle-ci est ABANDONNÉE (aucune zone
 *     partielle exposée, jamais de correction qui n'écraserait qu'une partie
 *     du champ) et le curseur avance quand même — direction SÛRE : sous-
 *     couvre plutôt que de risquer un rapprochement au mauvais champ.
 *   - Plusieurs zones cliquables peuvent ainsi partager le MÊME champ source
 *     (valeur repliée sur plusieurs lignes, ou valeur scindée en items à
 *     tiret par `dashItemList`) : un clic sur N'IMPORTE LAQUELLE ouvre
 *     l'éditeur prérempli avec la valeur COMPLÈTE ACTUELLE du champ (lue
 *     LIVE sur son élément DOM, jamais reconstruite depuis les fragments).
 *   - L'écriture passe TOUJOURS PAR L'ÉLÉMENT DOM DU CHAMP LUI-MÊME (`.value`
 *     + event `input`/`change` + `syncDomToStoreImmediate()`) — jamais un
 *     chemin `formData` reconstruit à la main : c'est EXACTEMENT le même
 *     mécanisme que la saisie normale (`formulaires.ts`), donc le formulaire
 *     reflète la correction par construction et `Store.state.formData` reste
 *     cohérent. Un sélecteur CSS résout TOUJOURS vers un élément DOM réel
 *     (`document-builder.ts` ne construit ses sélecteurs qu'à partir
 *     d'identifiants/classes déjà posés par `formulaires.ts`/`articulation.ts`
 *     — jamais de champ « tableau »/« bloc répété » écrit hors DOM) : aucun
 *     chemin `formData` séparé n'est nécessaire.
 *
 * PÉRIMÈTRE EXACT (restreint délibérément là où l'ancrage fiable n'est pas
 * possible, cf. JSDoc `document-builder.ts::buildAdversaryFiche` pour le
 * détail des exclusions — valeurs AGRÉGEANT plusieurs champs DOM en une
 * seule chaîne rendue, ex. « Naissance : <date> @ <lieu> », listes jointes
 * `meList.join(' / ')` ; titres de section, numéros dérivés, pieds de page,
 * badges/`<select>` PATRACDVR — jamais des candidats).
 */
import { syncDomToStoreImmediate } from '@oi/formulaires.js';
import type { OiPdfEditAnchor } from '@shared/types/contracts.js';
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

/** Un item `getTextContent()` porteur de texte (exclut les marqueurs `TextMarkedContent`, sans `str`). */
type TextContentItem = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number];
/** Variante « fragment de texte » de l'union `TextContentItem` : seule celle-ci
 * porte `transform`/`width`/`height` (l'autre, `TextMarkedContent`, ne décrit
 * qu'un marqueur de structure et n'a aucune géométrie). */
type TextFragment = Extract<TextContentItem, { transform: unknown }>;

export interface EditCandidate {
    el: HTMLInputElement | HTMLTextAreaElement;
}

/** Normalisation de comparaison — U+00AD (soft hyphen, `text-utils.ts::breakLongTokens`, invisible au rendu/à l'extraction) retiré, espaces multiples réduits. `getTextContent()` remplace déjà tout blanc par U+0020 (JSDoc pdf.js), donc `\s+` suffit ici. */
function normalizeForMatch(s: string): string {
    return s.replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Constat empirique (vérification navigateur réelle, pdf.js sur le PDF cover
 * page réellement rendu) : `labelValue('Situation générale', valeur, p,
 * {valueBold:true})` (`document-builder.ts::buildCover`) — pdfmake regroupe
 * PARFOIS le « : » de fin de libellé avec le fragment de VALEUR qui suit
 * (item pdf.js observé : `": SITGEN-EDIT-CHECK-42"` au lieu de la valeur
 * seule) alors que le même `labelValue` ailleurs (ex. `Heure H`) n'a jamais
 * ce comportement — un détail interne du découpage en lignes de pdfmake,
 * pas quelque chose que ce fichier contrôle. Un connecteur de ponctuation
 * (« : », tiret) collé en tête d'un fragment ne change jamais l'IDENTITÉ du
 * texte qui suit : appliqué UNIQUEMENT au premier fragment d'une tentative
 * de reconstruction (cf. `tryExtend`), jamais en milieu de valeur.
 */
function stripGluedLeadingConnector(s: string): string {
    return s.replace(/^[:\-–—]\s*/, '');
}

/** Clé stable d'un ancrage — sélecteur + rang (2 ancrages du MÊME champ, ex. 2 items `dashItemList`, partagent la MÊME clé : un seul `EditCandidate` résolu, réutilisé). */
function anchorKey(a: Pick<OiPdfEditAnchor, 'selector' | 'index'>): string {
    return `${a.selector}::${a.index}`;
}

/**
 * Résout CHAQUE ancrage vers son élément DOM source (`document.
 * querySelectorAll(selector)[index]`) — `#oi-form` scope déjà tous les
 * sélecteurs construits par `document-builder.ts` (`fieldAnchor`/
 * `advFieldAnchor`/`blockFieldAnchor`/`indexedFieldAnchor`). Seuls
 * `HTMLInputElement`/`HTMLTextAreaElement` sont retenus (filet — un
 * sélecteur ne devrait jamais désigner autre chose en pratique, ex. un
 * `<select>` n'est jamais la cible d'un ancrage émis par `document-
 * builder.ts`) ; un sélecteur introuvable/invalide est silencieusement omis
 * (l'ancrage correspondant ne produira alors aucune zone cliquable — repli
 * sûr, jamais une exception qui interromprait tout le rendu de l'aperçu).
 * Un `querySelectorAll` par sélecteur DISTINCT (mise en cache) : un champ
 * répété (hypothèses, MA…) partage le MÊME sélecteur pour tous ses rangs.
 */
export function resolveEditCandidates(anchors: OiPdfEditAnchor[]): Map<string, EditCandidate> {
    const candidates = new Map<string, EditCandidate>();
    const bySelector = new Map<string, NodeListOf<Element>>();
    for (const a of anchors) {
        const key = anchorKey(a);
        if (candidates.has(key)) continue;
        let list = bySelector.get(a.selector);
        if (list === undefined) {
            try {
                list = document.querySelectorAll(a.selector);
            } catch {
                list = document.querySelectorAll('.__pdf-edit-invalid-selector__'); // toujours vide, jamais d'exception
            }
            bySelector.set(a.selector, list);
        }
        const el = list[a.index];
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            candidates.set(key, { el });
        }
    }
    return candidates;
}

/**
 * État de rapprochement PARTAGÉ entre tous les appels `attachEditableTextLayer`
 * d'un même rendu d'aperçu (une page après l'autre, cf. `defaultRenderPdf`) —
 * `cursor` avance STRICTEMENT (jamais de retour en arrière ni de relecture
 * d'une page déjà peinte) : un champ dont la valeur s'étalerait sur PLUSIEURS
 * PAGES (cas non observé — les solveurs fit-to-page de `document-builder.ts`
 * bornent chaque usage à une page) resterait alors non éditable plutôt que
 * de risquer un rapprochement erroné, cf. JSDoc de fichier.
 */
export interface EditMatchState {
    anchors: OiPdfEditAnchor[];
    candidates: Map<string, EditCandidate>;
    cursor: { i: number };
}

/** Construit un `EditMatchState` frais pour un rendu d'aperçu complet — `defaultRenderPdf` en crée UN, réutilisé pour toutes les pages. */
export function createEditMatchState(anchors: OiPdfEditAnchor[]): EditMatchState {
    return { anchors, candidates: resolveEditCandidates(anchors), cursor: { i: 0 } };
}

/** Éditeur actif (au plus un à la fois — un clic ailleurs/Échap le referme avant d'en ouvrir un autre). */
let activeEditor: HTMLInputElement | HTMLTextAreaElement | null = null;

function closeActiveEditor(): void {
    activeEditor?.remove();
    activeEditor = null;
}

/**
 * Écrit la correction — PAR L'ÉLÉMENT DOM DU CHAMP SOURCE, jamais par un
 * chemin `formData` recalculé (cf. JSDoc de fichier) : `syncDomToStoreImmediate`
 * (`formulaires.ts`, alias non débouncé de `syncDomToStoreCore`) relit ENSUITE
 * tout `#oi-form` pour reconstruire `Store.state.formData` au complet — la
 * même voie que la saisie normale, aucune divergence possible entre
 * formulaire et Store. `regenerate` régénère l'aperçu ; la page éditée est
 * ensuite ramenée en vue (position exacte de défilement non préservable —
 * la mise en page peut changer — mais la PAGE reste la même, cf. spec §2
 * point 5).
 */
function commitEdit(candidate: EditCandidate, newValue: string, pageNumber: number, regenerate: () => Promise<void>): void {
    const el = candidate.el;
    if (el.value === newValue) return;
    el.value = newValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    syncDomToStoreImmediate();
    void regenerate().then(() => {
        document.querySelector(`.pdf-preview-page[data-page-number="${pageNumber}"]`)?.scrollIntoView?.({ block: 'start' });
    });
}

/**
 * Ouvre le champ d'édition au-dessus du fragment cliqué — `<textarea>` si le
 * champ source en est un (spec §2 point 3), `<input>` sinon. Entrée valide
 * SEULEMENT pour un `<input>` (une `<textarea>` doit pouvoir recevoir un
 * retour à la ligne saisi) ; Échap annule dans les deux cas ; la perte de
 * focus valide toujours (sauf annulation explicite par Échap).
 */
function openEditor(
    hit: HTMLButtonElement,
    candidate: EditCandidate,
    overlay: HTMLElement,
    pageNumber: number,
    regenerate: () => Promise<void>,
): void {
    closeActiveEditor();
    const isTextarea = candidate.el.tagName === 'TEXTAREA';
    const editor = document.createElement(isTextarea ? 'textarea' : 'input');
    editor.className = 'pdf-edit-input';
    editor.value = candidate.el.value;

    const hitWidthPx = parseFloat(hit.style.width) || 60;
    const hitHeightPx = parseFloat(hit.style.height) || 14;
    editor.style.left = hit.style.left;
    editor.style.top = hit.style.top;
    editor.style.width = `${Math.max(hitWidthPx, 90)}px`;
    editor.style.height = isTextarea ? `${Math.max(hitHeightPx * 3, 60)}px` : `${hitHeightPx}px`;
    editor.style.fontSize = `${Math.max(hitHeightPx * 0.75, 10)}px`;

    let cancelled = false;
    // JUSTIFICATION as : `editor` est typé `HTMLInputElement | HTMLTextAreaElement`
    // (union) — `addEventListener` résout alors le surcharge générique
    // `(type: string, listener: (e: Event) => void)`, perdant le typage
    // `KeyboardEvent` normalement inféré pour 'keydown'. Toujours un
    // `KeyboardEvent` à l'exécution (spec DOM).
    editor.addEventListener('keydown', (e) => {
        const evt = e as KeyboardEvent;
        if (evt.key === 'Escape') {
            cancelled = true;
            evt.preventDefault();
            editor.blur();
        } else if (evt.key === 'Enter' && !isTextarea) {
            evt.preventDefault();
            editor.blur();
        }
    });
    editor.addEventListener('blur', () => {
        const value = editor.value;
        closeActiveEditor();
        if (cancelled) return;
        commitEdit(candidate, value, pageNumber, regenerate);
    });

    overlay.appendChild(editor);
    activeEditor = editor;
    editor.focus();
    if (editor instanceof HTMLInputElement) editor.select();
}

/** Pose la zone cliquable `.pdf-edit-hit` sur le rectangle (repère PAGE, pt PDF → px CSS) couvert par `item`. */
function placeHitZone(
    item: TextFragment,
    viewport: PageViewport,
    dpr: number,
    candidate: EditCandidate,
    pageNumber: number,
    overlay: HTMLElement,
    regenerate: () => Promise<void>,
): void {
    // JUSTIFICATION as : `TextItem.transform`/`PageViewport.convertToViewportPoint`
    // sont typés `Array<any>`/`any[]` côté pdf.js (stubs JSDoc non affinés) —
    // toujours des tuples numériques à l'exécution (API pdf.js documentée).
    const transform = item.transform as number[];
    const x0 = transform[4] ?? 0;
    const y0 = transform[5] ?? 0;
    const p1 = viewport.convertToViewportPoint(x0, y0) as [number, number];
    const p2 = viewport.convertToViewportPoint(x0 + item.width, y0 + item.height) as [number, number];
    const left = Math.min(p1[0], p2[0]) / dpr;
    const top = Math.min(p1[1], p2[1]) / dpr;
    const width = Math.abs(p2[0] - p1[0]) / dpr;
    const height = Math.abs(p2[1] - p1[1]) / dpr;
    if (width <= 0 || height <= 0) return;

    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'pdf-edit-hit';
    hit.style.left = `${left}px`;
    hit.style.top = `${top}px`;
    hit.style.width = `${width}px`;
    hit.style.height = `${height}px`;
    hit.title = 'Corriger ce texte';
    hit.setAttribute('aria-label', `Corriger « ${item.str.trim()} »`);
    hit.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditor(hit, candidate, overlay, pageNumber, regenerate);
    });
    overlay.appendChild(hit);
}

/**
 * Superpose une zone cliquable sur chaque fragment de texte de `page`
 * reconnu comme faisant partie de la valeur d'un ancrage (`state.anchors`,
 * cf. JSDoc de fichier pour l'algorithme d'alignement en flux). Position/
 * taille calculées via `viewport.convertToViewportPoint` (le MÊME `viewport`,
 * à `scale * dpr`, que celui passé à `page.render()` par `defaultRenderPdf`)
 * puis ramenées en pixels CSS (÷ `dpr`) — même repère que
 * `.pdf-preview-page`/`data-scale`. Tout ce qui ne correspond à AUCUN
 * ancrage (titres, numéros de section, libellés, texte dérivé/calculé)
 * reste un simple texte de canvas : aucune zone n'y est posée.
 */
export async function attachEditableTextLayer(
    page: PDFPageProxy,
    pageEl: HTMLElement,
    overlay: HTMLElement,
    viewport: PageViewport,
    dpr: number,
    state: EditMatchState,
    regenerate: () => Promise<void>,
): Promise<void> {
    if (state.candidates.size === 0 || state.cursor.i >= state.anchors.length) return;
    const pageNumber = Number(pageEl.dataset.pageNumber ?? '0');
    const textContent = await page.getTextContent();
    const items = textContent.items as TextContentItem[];

    /** Texte accumulé (normalisé) de la reconstruction EN COURS pour `state.anchors[state.cursor.i]` — vide = aucune reconstruction en cours. */
    let matchedSoFar = '';
    let matchedFragIdxs: number[] = [];

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        if (item === undefined) continue;
        if (state.cursor.i >= state.anchors.length) break;
        if (!('str' in item) || !item.str.trim()) continue;

        // Ancrages sans candidat résolu (défensif — cf. JSDoc `resolveEditCandidates`) : jamais tentés, sautés sans consommer de fragment.
        while (state.cursor.i < state.anchors.length && !state.candidates.has(anchorKey(state.anchors[state.cursor.i] as OiPdfEditAnchor))) {
            state.cursor.i++;
            matchedSoFar = '';
            matchedFragIdxs = [];
        }
        if (state.cursor.i >= state.anchors.length) break;

        const anchor = state.anchors[state.cursor.i] as OiPdfEditAnchor;
        const target = normalizeForMatch(anchor.value);
        const fragNorm = normalizeForMatch(item.str);

        // Candidats de fragment à essayer, EXACT d'abord (cf. JSDoc `stripGluedLeadingConnector`) — le connecteur glué ne se produit qu'en TÊTE de valeur.
        const fragCandidates = matchedSoFar === '' && fragNorm !== stripGluedLeadingConnector(fragNorm) ? [fragNorm, stripGluedLeadingConnector(fragNorm)] : [fragNorm];

        let extended = false;
        for (const frag of fragCandidates) {
            const tentative = normalizeForMatch(matchedSoFar === '' ? frag : `${matchedSoFar} ${frag}`);
            if (tentative === '' || !target.startsWith(tentative)) continue;
            matchedSoFar = tentative;
            matchedFragIdxs.push(idx);
            extended = true;
            if (matchedSoFar === target) {
                const candidate = state.candidates.get(anchorKey(anchor));
                if (candidate) {
                    for (const fi of matchedFragIdxs) {
                        const fragItem = items[fi];
                        if (fragItem && 'str' in fragItem) placeHitZone(fragItem, viewport, dpr, candidate, pageNumber, overlay, regenerate);
                    }
                }
                state.cursor.i++;
                matchedSoFar = '';
                matchedFragIdxs = [];
            }
            break;
        }
        if (extended) continue;

        if (matchedSoFar !== '') {
            // Interruption d'une reconstruction en cours : ABANDON (aucune zone
            // partielle exposée, cf. JSDoc de fichier) — le curseur avance quand
            // même, ce même fragment est retenté contre l'ancrage SUIVANT.
            matchedSoFar = '';
            matchedFragIdxs = [];
            state.cursor.i++;
            idx--;
        }
        // Sinon : fragment de chrome (titre/libellé/ponctuation) — ignoré, le curseur ne bouge pas.
    }
}
