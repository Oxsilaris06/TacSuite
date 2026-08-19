/**
 * pdf-preview-edit.ts — Édition en place depuis l'aperçu PDF (SPEC-2026-08-18-
 * pdf-et-champs.md §2, partie « édition »). Appelé par `pdf-engine-v2.ts::
 * defaultRenderPdf`, une fois par page rendue, JAMAIS en test unitaire (même
 * précédent que `defaultRenderPdf` lui-même — cf. son JSDoc).
 *
 * RÉGRESSION #1 CORRIGÉE (mesure du 2026-08-19) : l'ancienne stratégie
 * (rapprochement par ÉGALITÉ DE VALEUR ENTIÈRE entre un fragment pdf.js et la
 * valeur COMPLÈTE d'un champ `#oi-form`) n'exposait quasiment AUCUNE zone
 * éditable — pdfmake découpe le texte en fragments par LIGNE/STYLE
 * (`page.getTextContent()`), colle parfois la ponctuation du libellé au
 * fragment de valeur, et tout champ dont la valeur s'enroule sur 2+ lignes
 * n'a alors AUCUN fragment qui l'égale exactement.
 *
 * RÉGRESSION #2 CORRIGÉE (campagne de mesure navigateur réel, mission
 * « robustesse alignement » — 2026-08-19) : la 1ère réécriture introduisait
 * un curseur PARTAGÉ n'avançant QUE dans un sens, avec correspondance
 * STRICTEMENT séquentielle (ancrage courant unique). 52,7 % des ancrages
 * seulement obtenaient une zone (39/74 ; 15,8 % en fragments, 147/933).
 * Mécanisme observé : dès que l'ORDRE D'ÉMISSION des ancrages divergeait de
 * l'ORDRE D'AFFICHAGE (cas réel : `executionBodyContent`, `document-
 * builder.ts` — enregistre chronologie/hypothèses AVANT date_execution/
 * heure_execution mais les affiche APRÈS), le curseur se figeait
 * DÉFINITIVEMENT sur un ancrage dont le texte avait déjà défilé : les
 * dizaines d'ancrages SUIVANTS (tout ZMSPCP/MOICP/Effraction/CAT dans la
 * mesure) devenaient alors irrécupérables — une seule divergence locale
 * coûtait la couverture de TOUT le reste du document. Un jeton isolé trop
 * court/générique (ex. « 2 » d'une page non ancrée) pouvait en plus amorcer
 * une fausse reconstruction par simple préfixe.
 *
 * STRATÉGIE RETENUE (robuste à la divergence d'ordre ET à l'amorçage
 * accidentel — 3 garanties, cf. `attachEditableTextLayer`) :
 *
 *   1. FENÊTRE D'ANCRAGES bornée (`WINDOW_AHEAD`, quelques ancrages, pas tout
 *      le document) : un fragment n'est plus comparé au SEUL ancrage
 *      courant, mais à TOUS les ancrages non encore résolus de
 *      `[cursor.i, cursor.i + WINDOW_AHEAD)` — tolère un réordonnancement
 *      LOCAL (ex. 2 champs intervertis) sans perdre le suivi. GARDE-FOU
 *      sûreté : si le fragment amorce/étend PLUSIEURS ancrages distincts de
 *      la fenêtre à la fois (ambigu), AUCUNE zone n'est posée pour aucun —
 *      mieux vaut sous-couvrir qu'écrire dans le mauvais champ.
 *   2. BUDGET BORNÉ (`STALE_FRAGMENT_BUDGET`) : si l'ancrage le plus ancien
 *      non résolu (`cursor.i`, la « tête ») ne progresse pas (aucun
 *      fragment, dans TOUTE la fenêtre, ne l'étend ni n'en amorce un autre)
 *      pendant plus de `STALE_FRAGMENT_BUDGET` fragments consécutifs
 *      INFRUCTUEUX, il est ABANDONNÉ (aucune zone) et la tête avance quand
 *      même — SEULE garantie qui empêche le gel définitif : la perte d'UN
 *      ancrage (celui dont le texte est déjà passé, hors de portée d'un
 *      alignement en flux à cursseur non rejouable) ne peut plus jamais
 *      entraîner la perte de TOUS les suivants. Compteur PORTÉ PAR `state`
 *      (persiste entre pages, cf. `EditMatchState`).
 *   3. SEUIL DE PLAUSIBILITÉ (`MIN_FRESH_START_LEN`) : un fragment ne peut
 *      AMORCER une reconstruction à PARTIR d'un préfixe partiel que s'il
 *      fait au moins `MIN_FRESH_START_LEN` caractères normalisés — un jeton
 *      isolé trop court/générique (ex. « 2 ») ne peut plus déclencher de
 *      fausse reconstruction par simple coïncidence de préfixe. Un fragment
 *      dont le texte ÉGALE la valeur ENTIÈRE d'un ancrage reste accepté quelle
 *      que soit sa longueur (correspondance certaine, pas un pari).
 *
 * PIED DE PAGE (`buildFooter`, `document-builder.ts`) jamais candidat : ses
 * fragments sont identifiés par POSITION VERTICALE (repère PDF, origine bas-
 * gauche — `TextFragment.transform[5]` comparé à `PageViewport.viewBox`, la
 * boîte de page BRUTE, non mise à l'échelle) plutôt que par contenu — un
 * critère de CONTENU (ex. "CONFIDENTIEL") pourrait accidentellement matcher
 * la valeur d'un champ légitime (constaté : `#amies` collisionnait avec le
 * pied « … <unité> - CONFIDENTIEL »), alors que la POSITION du pied de page
 * (dans la marge basse, `buildFooter` document-wide) est un invariant de
 * mise en page indépendant du contenu. Cf. `isFooterFragment`.
 *
 * INSTRUMENTATION (mission « robustesse alignement ») : `EditMatchState.stats`
 * — compteurs mutables mis à jour en place, exposés SANS changer la
 * signature d'`attachEditableTextLayer` (l'appelant les lit directement sur
 * l'objet `state` qu'il a créé via `createEditMatchState`, réutilisé pour
 * tout le rendu) : `anchorsResolved` (ancrages ayant obtenu ≥1 zone),
 * `hitZonesPlaced` (zones cliquables posées) et `fragmentsSeen` (fragments de
 * texte non vides rencontrés, pied de page inclus — dénominateur de la
 * mesure de couverture). `state.anchors.length` reste la référence pour le
 * nombre total d'ancrages ENREGISTRÉS.
 *
 * AUTRES INVARIANTS (inchangés depuis la 1ère réécriture) :
 *
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

/**
 * Valeur ATTENDUE d'un ancrage, prête pour la comparaison — cf.
 * `normalizeForMatch`. Constat empirique (mesure du 2026-08-19, listes à
 * tiret ZMSPCP/MOICP/CAT, `dashItemList`) : la valeur ENREGISTRÉE porte
 * elle-même un « - » de tête (ex. « - Compte rendu de mise en place. »,
 * `document-builder.ts`), mais pdf.js émet ce tiret comme un FRAGMENT SÉPARÉ
 * (`["-", y], [" ", y], ["Compte", y], …` — un caractère isolé, jamais assez
 * plausible pour amorcer, cf. `MIN_FRESH_START_LEN`) : sans ce retrait côté
 * CIBLE aussi, AUCUN fragment ne peut jamais valider un préfixe de la valeur
 * (le premier mot réel, « Compte », n'est lui-même PAS un préfixe de
 * « - Compte… ») — l'ancrage reste alors bloqué indéfiniment jusqu'à
 * abandon. Symétrique de `stripGluedLeadingConnector` (déjà appliqué côté
 * FRAGMENT) : un connecteur de tête ne change jamais l'IDENTITÉ de la valeur
 * qui suit, qu'il soit collé au premier fragment ou porté par son propre
 * fragment.
 */
function matchableTarget(value: string): string {
    return stripGluedLeadingConnector(normalizeForMatch(value));
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

/** Compteurs de couverture (mission « robustesse alignement ») — mis à jour EN PLACE par `attachEditableTextLayer`, lus directement sur l'objet `state` par l'appelant (aucun retour dédié nécessaire). */
export interface EditMatchStats {
    /** Ancrages ayant obtenu ≥1 zone cliquable (≤ `anchors.length`). */
    anchorsResolved: number;
    /** Zones `.pdf-edit-hit` posées au total (≥ `anchorsResolved` — un ancrage replié sur N lignes pose N zones). */
    hitZonesPlaced: number;
    /** Fragments de texte non vides rencontrés (toutes pages), pied de page INCLUS — dénominateur de la mesure de couverture (cf. rapport de mission, « 933 fragments »). */
    fragmentsSeen: number;
    // DIAGNOSTIC TEMPORAIRE (campagne de mesure) — à retirer une fois la cause de la couverture mesurée identifiée.
    footerSkipped: number;
    budgetDrops: number;
    interruptDrops: number;
    ambiguousSkips: number;
}

/**
 * État de rapprochement PARTAGÉ entre tous les appels `attachEditableTextLayer`
 * d'un même rendu d'aperçu (une page après l'autre, cf. `defaultRenderPdf`).
 * `cursor.i` (la « tête ») avance STRICTEMENT (jamais de retour en arrière ni
 * de relecture d'une page déjà peinte) mais N'EST PLUS le seul ancrage
 * comparé : `attachEditableTextLayer` recherche dans une FENÊTRE bornée
 * `[cursor.i, cursor.i + WINDOW_AHEAD)` (cf. JSDoc de fichier, garantie 1) et
 * abandonne la tête après un budget de fragments infructueux borné (garantie
 * 2) — un champ dont la valeur s'étalerait sur PLUSIEURS PAGES reste hors
 * périmètre (cas non observé, cf. JSDoc de fichier), mais UNE divergence
 * d'ordre locale ou UN ancrage irrécupérable ne bloque plus jamais les
 * ancrages suivants. `settled[i]` (résolu OU abandonné OU sans candidat DOM)
 * et `staleSinceHeadAdvance` (fragments infructueux depuis la dernière
 * avancée de la tête) sont l'état interne de cette garantie — PORTÉS PAR
 * `state` pour survivre au changement de page.
 */
export interface EditMatchState {
    anchors: OiPdfEditAnchor[];
    candidates: Map<string, EditCandidate>;
    cursor: { i: number };
    /** `settled[i]` — ancrage `i` réglé (résolu, abandonné, ou sans candidat DOM dès la construction) : ne sera plus jamais retenté. */
    settled: boolean[];
    // DIAGNOSTIC TEMPORAIRE (campagne de mesure) — distingue résolu de simplement abandonné.
    resolvedFlags: boolean[];
    /** Fragments infructueux consécutifs depuis la dernière avancée de la tête (`cursor.i`) — cf. garantie 2, JSDoc de fichier. */
    staleSinceHeadAdvance: number;
    stats: EditMatchStats;
}

/** Construit un `EditMatchState` frais pour un rendu d'aperçu complet — `defaultRenderPdf` en crée UN, réutilisé pour toutes les pages. */
export function createEditMatchState(anchors: OiPdfEditAnchor[]): EditMatchState {
    const candidates = resolveEditCandidates(anchors);
    // Réglé d'emblée : aucun candidat DOM (cf. JSDoc `resolveEditCandidates`) — jamais un fragment consommé pour lui.
    const settled = anchors.map((a) => !candidates.has(anchorKey(a)));
    return {
        anchors,
        candidates,
        cursor: { i: 0 },
        settled,
        resolvedFlags: anchors.map(() => false),
        staleSinceHeadAdvance: 0,
        stats: { anchorsResolved: 0, hitZonesPlaced: 0, fragmentsSeen: 0, footerSkipped: 0, budgetDrops: 0, interruptDrops: 0, ambiguousSkips: 0 },
    };
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
 * Fenêtre d'ancrages regardée en avant depuis la tête (`state.cursor.i`) pour
 * chaque fragment — cf. JSDoc de fichier, garantie 1. Volontairement PETITE
 * (« quelques ancrages ») : elle absorbe un réordonnancement LOCAL sans
 * transformer l'alignement en flux en recherche globale (qui risquerait des
 * rapprochements ambigus sur tout le document) ; les divergences plus larges
 * (ex. un bloc entier de chronologie/hypothèses intercalé) restent hors de
 * portée de la fenêtre et sont couvertes par la garantie 2 à la place — la
 * tête concernée est abandonnée, jamais rejouée, mais les ancrages suivants
 * restent atteignables.
 */
const WINDOW_AHEAD = 12;

/**
 * Budget de fragments infructueux consécutifs (garantie 2, JSDoc de fichier)
 * avant d'abandonner la tête. `ponytail:` seuil empirique (page réelle : de
 * l'ordre de quelques dizaines à ~150 fragments) — assez grand pour ne pas
 * abandonner un ancrage dont le texte arrive simplement après plusieurs
 * fragments de chrome (titre/libellé/ponctuation) légitimes, assez petit
 * pour garantir une reprise en un temps borné même si plusieurs ancrages
 * consécutifs sont irrécupérables (chacun consomme son propre budget).
 * Upgrade si mesure future : rendre le seuil proportionnel à la densité de
 * fragments observée plutôt qu'une constante.
 */
const STALE_FRAGMENT_BUDGET = 60;

/**
 * Longueur normalisée minimale pour qu'un fragment AMORCE une reconstruction
 * à partir d'un préfixe PARTIEL (garantie 3, JSDoc de fichier — cas mesuré :
 * un « 2 » isolé amorçant faussement « 2026-09-14 »). Un fragment qui égale
 * la valeur ENTIÈRE d'un ancrage (`tentative === target`) reste accepté quelle
 * que soit sa longueur : ce n'est plus un pari sur un préfixe, c'est une
 * correspondance certaine.
 */
const MIN_FRESH_START_LEN = 2;

/**
 * Hauteur (depuis le bas de la page, repère PDF brut) réservée au pied de
 * page — cf. JSDoc de fichier. La marge basse (`theme.ts::pageGeometry`,
 * `mm(11)` ≈ 31,18 pt, IDENTIQUE dans les 2 formats — une marge physique ne
 * s'exprime pas en fraction de la hauteur de page) est l'espace où pdfmake
 * positionne EXCLUSIVEMENT le pied de page document-wide (`buildFooter`) :
 * le CORPS du document n'y descend JAMAIS (garanti par la mise en page
 * pdfmake — `pageMargins`/`contentHeightPt` réservent cette bande). Une
 * fraction de la hauteur de page (ex. 10 %) SURESTIME cette bande sur les
 * pages denses (tables ZMSPCP/MOICP/Effraction compactées par le solveur
 * fit-to-page jusqu'au bord de la marge) et mord alors sur du contenu
 * légitime — CONSTATÉ en mesure réelle (10 % → 121 fragments exclus pour
 * ~14 pages à pied de page, soit ~4× le nombre réel de fragments de pied de
 * page). SEUIL ABSOLU, PAS une fraction : `mm(11)` + une marge de sûreté
 * modeste (le pied de page a lui-même une hauteur non nulle à l'intérieur
 * de cette bande — 2 lignes de texte + un léger `margin` interne).
 */
const FOOTER_ZONE_PT = 34;

/**
 * Un fragment posé dans la marge basse (pied de page, `buildFooter`) —
 * repère PDF BRUT (origine bas-gauche, y croît vers le haut) : `item.
 * transform[5]` est la même coordonnée, non mise à l'échelle, que
 * `PageViewport.viewBox` (`[xMin, yMin, xMax, yMax]`, cf. JSDoc
 * `PageViewport` pdf.js — construit par `page.getViewport()` directement
 * depuis `page.view`, jamais recalculé). Critère de POSITION plutôt que de
 * CONTENU (cf. JSDoc de fichier) : un fragment ainsi identifié est ignoré
 * AVANT toute tentative de rapprochement — jamais candidat, jamais compté
 * dans le budget d'abandon (garantie 2), jamais capable d'interrompre une
 * reconstruction en cours.
 */
function isFooterFragment(item: TextFragment, viewport: PageViewport): boolean {
    const yMin = viewport.viewBox[1] ?? 0;
    const transform = item.transform as number[];
    const y0 = transform[5] ?? 0;
    return y0 - yMin < FOOTER_ZONE_PT;
}

/**
 * `fragNorm` (ou son variant sans connecteur glué, cf. `stripGluedLeadingConnector`)
 * comme AMORCE plausible de `target` — `null` si aucun variant ne qualifie.
 * Une égalité ENTIÈRE est TOUJOURS certaine (aucun seuil) ; un préfixe
 * PARTIEL doit satisfaire `MIN_FRESH_START_LEN` (garantie 3, JSDoc de fichier).
 */
function qualifyFreshStart(fragNorm: string, strippedNorm: string, target: string): string | null {
    for (const candidate of strippedNorm !== fragNorm ? [fragNorm, strippedNorm] : [fragNorm]) {
        if (candidate === '') continue;
        if (candidate === target) return candidate;
        if (candidate.length >= MIN_FRESH_START_LEN && target.startsWith(candidate)) return candidate;
    }
    return null;
}

/** Avance `state.cursor.i` tant que l'ancrage pointé est déjà réglé (résolu/abandonné/sans candidat) — remet `staleSinceHeadAdvance` à 0 dès que la tête bouge réellement (nouveau budget pour le nouvel ancrage de tête). */
function advanceHead(state: EditMatchState): void {
    const before = state.cursor.i;
    while (state.cursor.i < state.anchors.length && (state.settled[state.cursor.i] ?? true)) state.cursor.i++;
    if (state.cursor.i !== before) state.staleSinceHeadAdvance = 0;
}

/** Ancrage `idx` RÉSOLU — pose une zone par fragment absorbé (`fragIdxs`, tous liés au MÊME champ source) et le règle définitivement. */
function resolveAnchor(
    state: EditMatchState,
    idx: number,
    fragIdxs: number[],
    items: TextContentItem[],
    viewport: PageViewport,
    dpr: number,
    pageNumber: number,
    overlay: HTMLElement,
    regenerate: () => Promise<void>,
): void {
    const anchor = state.anchors[idx];
    const candidate = anchor ? state.candidates.get(anchorKey(anchor)) : undefined;
    if (candidate) {
        for (const fi of fragIdxs) {
            const fragItem = items[fi];
            if (fragItem && 'str' in fragItem) placeHitZone(fragItem, viewport, dpr, candidate, pageNumber, overlay, regenerate);
        }
        state.stats.hitZonesPlaced += fragIdxs.length;
    }
    state.settled[idx] = true;
    state.resolvedFlags[idx] = true;
    state.stats.anchorsResolved++;
}

/** Ancrage `idx` ABANDONNÉ (réglé sans zone, jamais rejoué) — cf. garanties 1 (interruption) et 2 (budget épuisé), JSDoc de fichier. */
function dropAnchor(state: EditMatchState, idx: number): void {
    state.settled[idx] = true;
}

/**
 * Superpose une zone cliquable sur chaque fragment de texte de `page`
 * reconnu comme faisant partie de la valeur d'un ancrage (`state.anchors`,
 * cf. JSDoc de fichier pour les 3 garanties de robustesse). Position/taille
 * calculées via `viewport.convertToViewportPoint` (le MÊME `viewport`, à
 * `scale * dpr`, que celui passé à `page.render()` par `defaultRenderPdf`)
 * puis ramenées en pixels CSS (÷ `dpr`) — même repère que
 * `.pdf-preview-page`/`data-scale`. Tout ce qui ne correspond à AUCUN
 * ancrage (titres, numéros de section, libellés, texte dérivé/calculé, pied
 * de page) reste un simple texte de canvas : aucune zone n'y est posée.
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
    console.log(`[frag-dump] page ${pageNumber}:`, JSON.stringify(items.map((it) => ('str' in it ? [it.str, Math.round((it.transform as number[])[5] ?? 0)] : ['<marker>']))));

    /**
     * Reconstruction(s) EN COURS — PLUSIEURS hypothèses candidates en
     * parallèle tant qu'un fragment commun ne les a pas départagées (cf.
     * JSDoc de fichier, garantie 1 : pdf.js émet le texte MOT PAR MOT, deux
     * valeurs voisines de la fenêtre peuvent partager un premier mot — ex.
     * mesuré « Depart GILETTE » / « Depart LE », deux événements de
     * chronologie DIFFÉRENTS commençant tous deux par « Depart »). Vide =
     * aucune reconstruction en cours. Portée à CETTE page (jamais rejouée
     * d'une page à l'autre, cf. JSDoc `EditMatchState`).
     */
    let pendingCandidates: { index: number; matched: string }[] = [];
    let pendingFragIdxs: number[] = [];

    /**
     * Décide, pour un lot de candidats ENCORE viables après le fragment
     * courant (`fragIdxs` = TOUS les fragments absorbés jusqu'ici pour ce
     * lot), s'il faut RÉSOUDRE maintenant ou continuer à accumuler —
     * factorisé entre la continuation (`survivors`) et l'amorçage
     * (`candidates`), même règle dans les deux cas : cf. commentaire
     * `garantie 1` sur `attachEditableTextLayer`. Renvoie `true` si résolu
     * (ou définitivement écarté) — l'appelant vide alors `pendingCandidates`.
     */
    function settleOrDefer(list: { index: number; matched: string }[], fragIdxs: number[]): boolean {
        const distinctTargets = new Set(list.map((c) => matchableTarget((state.anchors[c.index] as OiPdfEditAnchor).value)));
        const allIdentical = distinctTargets.size === 1;
        const fullMatch = list.find((c) => c.matched === matchableTarget((state.anchors[c.index] as OiPdfEditAnchor).value));
        // Résolution : soit UN SEUL candidat en lice (fenêtre départagée), soit
        // PLUSIEURS mais de valeur IDENTIQUE (rendu PDF indiscernable, cf.
        // garantie 1) — jamais tant qu'au moins 2 candidats de valeurs
        // DIFFÉRENTES restent en lice, même si l'un d'eux égale déjà sa cible
        // (un frère encore viable pourrait continuer au fragment suivant : ex.
        // « Depart » seul NE DOIT PAS trancher entre « Depart » et « Depart
        // GILETTE » avant d'avoir vu si un mot de plus suit).
        if ((list.length === 1 || allIdentical) && fullMatch) {
            const winner = list.reduce((a, b) => (a.index <= b.index ? a : b));
            resolveAnchor(state, winner.index, fragIdxs, items, viewport, dpr, pageNumber, overlay, regenerate);
            advanceHead(state);
            return true;
        }
        pendingCandidates = list;
        pendingFragIdxs = fragIdxs;
        return false;
    }

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        if (item === undefined || !('str' in item) || !item.str.trim()) continue;
        state.stats.fragmentsSeen++;
        if (isFooterFragment(item, viewport)) { state.stats.footerSkipped++; continue; } // jamais candidat, jamais compté dans le budget d'abandon — cf. JSDoc `isFooterFragment`.

        advanceHead(state);
        if (state.cursor.i >= state.anchors.length) continue; // plus rien à résoudre — les fragments restants (pied de page compris) sont comptés ci-dessus, sans exception.

        const fragNorm = normalizeForMatch(item.str);
        let productive = false;

        if (pendingCandidates.length > 0) {
            const survivors: { index: number; matched: string }[] = [];
            for (const c of pendingCandidates) {
                const target = matchableTarget((state.anchors[c.index] as OiPdfEditAnchor).value);
                const tentative = normalizeForMatch(`${c.matched} ${fragNorm}`);
                if (tentative !== '' && target.startsWith(tentative)) survivors.push({ index: c.index, matched: tentative });
            }
            if (survivors.length === 0) {
                // Interruption. Un SEUL candidat en lice (association déjà certaine avant ce
                // fragment) : ABANDON définitif (aucune zone partielle, cf. JSDoc de fichier).
                // PLUSIEURS candidats encore en lice (hypothèses non départagées) : aucun n'a
                // jamais été confirmé — on les relâche SANS les régler, une association future
                // (même mot réutilisé ailleurs, ex. « Depart » réapparaît pour un AUTRE
                // événement) reste possible. Ce même fragment est retenté ci-dessous contre la
                // fenêtre d'ancrages COURANTE.
                if (pendingCandidates.length === 1) {
                    state.stats.interruptDrops++;
                    dropAnchor(state, (pendingCandidates[0] as { index: number }).index);
                    advanceHead(state);
                }
                pendingCandidates = [];
                pendingFragIdxs = [];
            } else {
                productive = true;
                if (settleOrDefer(survivors, [...pendingFragIdxs, idx])) {
                    pendingCandidates = [];
                    pendingFragIdxs = [];
                }
            }
        }

        if (pendingCandidates.length === 0 && !productive) {
            const strippedNorm = stripGluedLeadingConnector(fragNorm);
            const candidates: { index: number; matched: string }[] = [];
            const windowEnd = Math.min(state.cursor.i + WINDOW_AHEAD, state.anchors.length);
            for (let w = state.cursor.i; w < windowEnd; w++) {
                if (state.settled[w] ?? true) continue;
                const target = matchableTarget((state.anchors[w] as OiPdfEditAnchor).value);
                const tentative = qualifyFreshStart(fragNorm, strippedNorm, target);
                if (tentative !== null) candidates.push({ index: w, matched: tentative });
            }
            if (candidates.length > 0) {
                productive = true;
                if (candidates.length > 1) state.stats.ambiguousSkips++;
                settleOrDefer(candidates, [idx]);
            }
        }

        if (!productive) {
            state.staleSinceHeadAdvance++;
            if (state.staleSinceHeadAdvance > STALE_FRAGMENT_BUDGET) {
                state.stats.budgetDrops++;
                dropAnchor(state, state.cursor.i);
                advanceHead(state);
                state.staleSinceHeadAdvance = 0;
            }
        }
    }
}
