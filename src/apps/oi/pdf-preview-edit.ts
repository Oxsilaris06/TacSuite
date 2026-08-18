/**
 * pdf-preview-edit.ts — Édition en place depuis l'aperçu PDF (SPEC-2026-08-18-
 * pdf-et-champs.md §2, partie « édition »). Appelé par `pdf-engine-v2.ts::
 * defaultRenderPdf`, une fois par page rendue, JAMAIS en test unitaire (même
 * précédent que `defaultRenderPdf` lui-même — cf. son JSDoc).
 *
 * STRATÉGIE RETENUE : (a) rapprochement par VALEUR, rendu fiable par un
 * verrou d'UNICITÉ — jamais l'instrumentation du générateur (option (b) de la
 * spec). `document-builder.ts` compose le texte de CHAQUE section via des
 * dizaines d'appels `labelValue`/`kvTable`/`accentCard` dispersés sur ~2800
 * lignes, dont beaucoup concatènent PLUSIEURS champs sources dans une seule
 * chaîne rendue (ex. « Naissance : <date> @ <lieu> », `buildAdversaryFiche`) —
 * instrumenter fidèlement CHAQUE site d'appel pour émettre un index fiable
 * (clé → valeur) aurait exigé un diff massif et dispersé dans un fichier déjà
 * dense, avec un risque réel de dérive entre l'index émis et le rendu réel.
 * Le rapprochement par valeur, en revanche, coûte zéro ligne dans
 * `document-builder.ts`/`blocks.ts` et offre la MÊME garantie de sûreté :
 *
 *   - Les candidats sont les champs RÉELLEMENT PRÉSENTS dans le formulaire au
 *     moment de l'aperçu (`collectEditCandidates`, scan DOM `#oi-form input/
 *     textarea` — mêmes éléments que `syncDomToStoreCore`, `formulaires.ts`).
 *   - Un fragment de texte pdf.js (`page.getTextContent()`) n'est rendu
 *     ÉDITABLE que si sa valeur normalisée correspond À L'IDENTIQUE à EXACTEMENT
 *     UN SEUL champ candidat — toute ambiguïté (0 ou 2+ champs partageant la
 *     même valeur, ex. deux « - » ou deux « RAS ») désactive l'édition pour ce
 *     fragment plutôt que de risquer d'écrire au mauvais endroit.
 *   - L'écriture passe PAR L'ÉLÉMENT DOM DU CHAMP LUI-MÊME (`.value` + event
 *     `input`/`change` + `syncDomToStoreImmediate()`) — jamais un chemin
 *     `formData` reconstruit à la main : c'est EXACTEMENT le même mécanisme
 *     que la saisie normale, donc le formulaire reflète la correction par
 *     construction (§2 point 4 de la spec) et `Store.state.formData` reste
 *     cohérent avec ce que `syncDomToStoreCore` produirait de toute façon.
 *
 * PÉRIMÈTRE EXACT (restreint délibérément, cf. tolérance explicite de la
 * spec « restreins le périmètre à ce que tu peux garantir ») :
 *   - Seuls les champs `#oi-form input`/`textarea` simples (mission, no_go,
 *     uda, champs adversaire `[data-field]`, blocs ZMSPCP/MOICP/effraction,
 *     hypothèses, ME/MA/véhicules…) sont candidats — PAS les cellules
 *     PATRACDVR (badges glisser-déposer, pas des champs texte), PAS les
 *     `<select>` (valeur contrainte, une saisie libre romprait la
 *     cohérence), PAS les libellés/titres/numéros de section (jamais des
 *     candidats : ils ne proviennent d'aucun champ `#oi-form`).
 *   - Un fragment n'est éditable QUE s'il correspond, texte pour texte
 *     (espaces normalisés), à la valeur ENTIÈRE d'un champ. Un champ dont la
 *     valeur s'enroule sur plusieurs lignes dans le PDF (paragraphe long)
 *     n'a alors AUCUN fragment qui l'égale exactement — non éditable, plutôt
 *     que d'exposer une correction partielle qui écraserait le reste du
 *     champ. Conséquence assumée : les champs `<textarea>` ne sont éditables
 *     DEPUIS L'APERÇU que lorsque leur contenu ACTUEL tient sur une seule
 *     ligne rendue — un champ e.g. `mission_body_text` déjà long reste
 *     corrigible uniquement depuis le formulaire.
 */
import { syncDomToStoreImmediate } from '@oi/formulaires.js';
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

/** Un item `getTextContent()` porteur de texte (exclut les marqueurs `TextMarkedContent`, sans `str`). */
type TextContentItem = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number];

/** Champs `#oi-form` simples, valeur libre — mêmes éléments que `syncDomToStoreCore` (`formulaires.ts`) lit pour reconstruire `Store.state.formData`. `<select>` exclu (valeur contrainte à ses `<option>`, une saisie libre romprait la cohérence). */
const EDITABLE_FIELDS_SELECTOR =
    '#oi-form input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]), #oi-form textarea';

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
 * texte qui suit : on retente la correspondance après avoir retiré un tel
 * préfixe UNIQUEMENT si la correspondance EXACTE échoue d'abord.
 */
function stripGluedLeadingConnector(s: string): string {
    return s.replace(/^[:\-–—]\s*/, '');
}

/**
 * Scanne le formulaire LIVE et regroupe les champs par valeur normalisée —
 * un groupe de taille 2+ marque une valeur AMBIGUË (ex. deux champs vides
 * réduits à '-', ou deux trigrammes identiques) : `attachEditableTextLayer`
 * n'expose alors l'édition pour AUCUN des deux, cf. JSDoc de fichier.
 */
export function collectEditCandidates(): Map<string, EditCandidate[]> {
    const map = new Map<string, EditCandidate[]>();
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(EDITABLE_FIELDS_SELECTOR).forEach((el) => {
        const key = normalizeForMatch(el.value);
        if (!key) return;
        const list = map.get(key);
        if (list) list.push({ el });
        else map.set(key, [{ el }]);
    });
    return map;
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

/**
 * Superpose une zone cliquable sur chaque fragment de texte de `page` dont la
 * valeur correspond, SANS AMBIGUÏTÉ, à exactement un champ candidat
 * (`candidates`, cf. `collectEditCandidates`). Position/taille calculées via
 * `viewport.convertToViewportPoint` (le MÊME `viewport`, à `scale * dpr`, que
 * celui passé à `page.render()` par `defaultRenderPdf`) puis ramenées en
 * pixels CSS (÷ `dpr`) — même repère que `.pdf-preview-page`/`data-scale`.
 * Tout ce qui ne correspond à AUCUN champ (titres, numéros de section,
 * libellés, texte dérivé/calculé) reste un `<span>`… non, un simple texte de
 * canvas : aucune zone n'y est posée, donc rien n'y est interactif — c'est le
 * cas par défaut, aucun code supplémentaire requis.
 */
export async function attachEditableTextLayer(
    page: PDFPageProxy,
    pageEl: HTMLElement,
    overlay: HTMLElement,
    viewport: PageViewport,
    dpr: number,
    candidates: Map<string, EditCandidate[]>,
    regenerate: () => Promise<void>,
): Promise<void> {
    if (candidates.size === 0) return;
    const pageNumber = Number(pageEl.dataset.pageNumber ?? '0');
    const textContent = await page.getTextContent();

    for (const item of textContent.items as TextContentItem[]) {
        if (!('str' in item) || !item.str.trim()) continue;
        const normalized = normalizeForMatch(item.str);
        // Correspondance exacte d'abord ; repli sur le fragment débarrassé
        // d'un connecteur de ponctuation collé en tête (cf. JSDoc
        // `stripGluedLeadingConnector`) SEULEMENT si l'exacte échoue — ne
        // relâche jamais l'exigence d'égalité totale sur le texte du champ.
        const matches = candidates.get(normalized) ?? candidates.get(stripGluedLeadingConnector(normalized));
        if (!matches || matches.length !== 1) continue;
        const candidate = matches[0];
        if (!candidate) continue;

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
        if (width <= 0 || height <= 0) continue;

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
}
