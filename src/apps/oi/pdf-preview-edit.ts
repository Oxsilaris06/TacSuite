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
 *   4. BUDGET DE RECONSTRUCTION (`PENDING_MATCH_BUDGET`, mission « tout le
 *      texte modifiable », cas mesuré : un champ MA réel portant un texte
 *      répété sans espace, ambigu entre plusieurs ancrages quasi identiques)
 *      — une reconstruction `pendingCandidates` encore en lice après
 *      `PENDING_MATCH_BUDGET` fragments est ABANDONNÉE EN BLOC (tous ses
 *      candidats, aucune zone) : sans ce plafond, une ambiguïté qui reste
 *      `productive` indéfiniment (chaque fragment supplémentaire prolonge
 *      encore la tentative sans jamais atteindre un match complet)
 *      échappe à la garantie 2 (jamais « infructueuse ») et consomme alors
 *      TOUT LE RESTE du document — la tête n'avance donc plus jamais au-delà,
 *      constaté : la couverture de sections entières situées APRÈS
 *      s'effondre silencieusement.
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
 *
 * DÉCISION `<select>` (mission « garde-fous d'édition », 2026-08-19) :
 * EXCLUSION MAINTENUE, pas de liste de choix éditable. `document-builder.ts`
 * ne les anchore déjà JAMAIS (paragraphe ci-dessus) — un texte rendu depuis
 * un `<select>` (ethnie, type d'horaire T0..T5…) n'a donc AUCUN fragment
 * candidat et `resolveEditCandidates` ne retient de toute façon que
 * `HTMLInputElement`/`HTMLTextAreaElement` (garde-fou, JSDoc dédié) : aucune
 * `.pdf-edit-hit` n'est JAMAIS posée sur ce texte, il ne prend donc jamais
 * l'affordance clic/survol des zones éditables (`styles/oi.css`,
 * `.pdf-edit-hit:hover`/`:focus-visible`) — rien ne « paraît éditable » là où
 * ça ne l'est pas, sans code additionnel. Justification de fond (pas
 * seulement l'état de fait existant) : une valeur de `<select>` est un code
 * ENUMÉRÉ contraint côté formulaire ; l'exposer en édition texte libre depuis
 * l'aperçu permettrait d'y écrire une valeur hors énumération (aucune des
 * garde-fous `commitEdit` — `checkValidity()`/contraintes natives — ne
 * couvre un ensemble de choix fermé, un `<select>` n'a pas de `pattern`) et
 * romprait la cohérence avec le reste du formulaire pour un gain marginal
 * (ces champs sont courts, déjà corrigibles depuis le formulaire lui-même).
 *
 * SECOND CHEMIN D'ÉCRITURE — `dataset` (mission « tout le texte modifiable »,
 * 2026-08-19) : deux sections restaient ENTIÈREMENT non éditables — la « Vue
 * d'ensemble de l'articulation » (Rame VL / Colonne de Progression / Ordre
 * de Pénétration, `document-builder.ts::buildArticulationOverview`) et le
 * « Récapitulatif PATRACDVR » (`buildPatracPage`) — parce que leur texte ne
 * vit dans AUCUN `<input>`/`<textarea>` : il vient du `dataset` de pastilles/
 * boutons réordonnables (`.patracdvr-member-btn`, `.patracdvr-vehicle-row`,
 * `.rame-vl-chip`, `.order-chip` — cf. `patrac.ts`/`articulation.ts`). Modèle
 * de données réel étudié (`patrac.ts::addPatracdvrMember` pose le dataset à
 * la création ; `formulaires.ts::syncDomToStoreCore` le sérialise TEL QUEL
 * dans `Store.state.formData.patracdvr_rows[].members[]`/`patracdvr_unassigned`,
 * `OiPatracMember` — cf. `contracts.ts` ; les 3 listes d'ordre ne sont que des
 * RÉORDONNANCEMENTS de ces mêmes trigrammes/noms, régénérées par
 * `articulation.ts::refreshArticulationFromPatracdvr`) : le texte affiché s'y
 * partage en 2 catégories —
 *
 *   - CHAMPS LIBRES (texte non contraint) : `trigramme`, `dir` (membre),
 *     `vehicleName` (véhicule) — DÉJÀ éditables ailleurs dans l'app (panneau
 *     Édition Rapide, renommage véhicule), sans validation de forme. Ce sont
 *     les SEULS couverts par ce second chemin.
 *   - PASTILLES À CHOIX FERMÉ : `fonction`/`cellule`/`principales`/
 *     `secondaires`/`afis`/`grenades`/`equipement`/`equipement2`/`tenue`/
 *     `gpb` — MÊME catégorie que la décision `<select>` ci-dessus (énumération
 *     contrainte côté formulaire, panneau Édition Rapide) : jamais ancrées
 *     (`document-builder.ts`), donc jamais candidates ici. La colonne
 *     `EQPT/GREN.` du récapitulatif (`patracEqptText`) reste elle aussi
 *     exclue : c'est un JOIN de 5 champs distincts en une seule chaîne
 *     rendue, même catégorie que les valeurs agrégées déjà exclues (§ PÉRIMÈTRE
 *     EXACT ci-dessus).
 *
 * `OiPdfEditAnchor.kind` (défaut `'field'`, absent) distingue les 2 chemins ;
 * `kind: 'dataset'` porte en plus `datasetKey` (la clé `dataset` visée).
 * `resolveEditCandidates` résout alors un `EditCandidate` DISCRIMINÉ par
 * `kind` (`{kind:'field', el: <input>|<textarea>}` vs `{kind:'dataset', el:
 * HTMLElement, datasetKey}`) ; `commitEdit` distribue vers `commitFieldEdit`
 * (inchangée) ou `commitDatasetEdit` (nouvelle) selon ce discriminant — cf.
 * leurs JSDoc respectives pour les garde-fous propres à chaque chemin. Les 2
 * chemins PARTAGENT la garde « vidage refusé » (`EMPTYING_REJECTED_MESSAGE`)
 * et la séquence post-écriture (`syncDomToStoreImmediate` + `regenerate` +
 * retour en vue) ; `commitDatasetEdit` réutilise `window.updateMemberButtonVisuals`/
 * `window.updateArticulationDisplay` (résolus par `window`, MÊME garde
 * `typeof` que partout dans ce paquet, RÈGLE D'OR — cf. JSDoc `patrac.ts`)
 * plutôt que de réimplémenter les effets de bord du panneau Édition Rapide.
 *
 * AMBIGUÏTÉ D'IDENTITÉ (sûreté) : `trigramme`/`vehicleName` servent aussi de
 * CLÉ DE SÉLECTEUR (`.patracdvr-member-btn[data-trigramme="X"]`) — un
 * trigramme/nom de véhicule DUPLIQUÉ dans le document rendrait ce sélecteur
 * ambigu (plusieurs éléments DOM potentiels). `document-builder.ts`
 * (`countPatracTrigrammes`/`countPatracVehicleNames`) refuse alors d'ANCRER
 * TOUT champ concerné par cette valeur — sous-couverture délibérée, jamais un
 * pari sur QUEL élément dupliqué corriger.
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

/**
 * Discriminé par `kind` (mission « tout le texte modifiable ») — `'field'`
 * (chemin d'origine) : cible un `<input>`/`<textarea>`, écrit via `.value`.
 * `'dataset'` (nouveau) : cible un élément DOM quelconque (pastille/bouton
 * PATRACDVR), écrit via `.dataset[datasetKey]` — cf. JSDoc de fichier.
 */
export type EditCandidate =
    | { kind: 'field'; el: HTMLInputElement | HTMLTextAreaElement }
    | { kind: 'dataset'; el: HTMLElement; datasetKey: string };

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

/**
 * Clé stable d'un ancrage — sélecteur + rang + `datasetKey` (2 ancrages du
 * MÊME champ, ex. 2 items `dashItemList`, partagent la MÊME clé : un seul
 * `EditCandidate` résolu, réutilisé). `datasetKey` INCLUS dans la clé depuis
 * la mission « tout le texte modifiable » — RÉGRESSION mesurée en navigateur
 * réel (Chromium, campagne PATRACDVR) sans lui : un ancrage `kind:'field'`
 * identifie TOUJOURS son champ par le SÉLECTEUR seul (chaque champ `#oi-form`
 * a sa PROPRE classe/attribut, ex. `.moicp-mission` vs `.moicp-objectif` —
 * `selector` seul suffit à les distinguer), mais un ancrage `kind:'dataset'`
 * identifie l'ÉLÉMENT par IDENTITÉ (trigramme/nom de véhicule) et le CHAMP
 * séparément par `datasetKey` — DEUX ancrages `dataset` du MÊME élément
 * (`trigramme` et `dir` d'UN MÊME `.patracdvr-member-btn`) partagent alors le
 * MÊME sélecteur ET le même rang par défaut (0), donc l'ANCIENNE clé
 * (sélecteur+rang seuls) les confondait en UNE SEULE entrée de
 * `EditMatchState.candidates` — celle du PREMIER ancrage enregistré pour cet
 * élément (`trigramme`, émis avant `dir` dans `patracRowCells`) gagnait
 * TOUJOURS, y compris pour les zones cliquables résolues plus tard contre
 * l'ancrage `dir` : cliquer le texte DIR ouvrait alors l'éditeur DU
 * TRIGRAMME — une correction pouvait atterrir dans le MAUVAIS champ malgré
 * un clic pourtant correctement positionné. `datasetKey` (vide pour un
 * ancrage `field`, valeur constante dans ce cas — n'introduit AUCUNE
 * collision nouvelle entre ancrages `field`) désambiguïse désormais les deux.
 */
function anchorKey(a: Pick<OiPdfEditAnchor, 'selector' | 'index' | 'datasetKey'>): string {
    return `${a.selector}::${a.index}::${a.datasetKey ?? ''}`;
}

/**
 * Résout CHAQUE ancrage vers son élément DOM source (`document.
 * querySelectorAll(selector)[index]`) — `#oi-form` scope déjà tous les
 * sélecteurs construits par `document-builder.ts` (`fieldAnchor`/
 * `advFieldAnchor`/`blockFieldAnchor`/`indexedFieldAnchor`/
 * `patracMemberDatasetAnchor`/`patracVehicleDatasetAnchor`). Un ancrage
 * `kind !== 'dataset'` (défaut `'field'`) ne retient que
 * `HTMLInputElement`/`HTMLTextAreaElement` (filet — un sélecteur `'field'` ne
 * devrait jamais désigner autre chose en pratique, ex. un `<select>` n'est
 * jamais la cible d'un tel ancrage) ; un ancrage `kind === 'dataset'` retient
 * tout `HTMLElement` porteur d'un `datasetKey` déclaré (pastille/bouton
 * PATRACDVR, cf. JSDoc de fichier). Un sélecteur introuvable/invalide est
 * silencieusement omis dans les deux cas (l'ancrage correspondant ne
 * produira alors aucune zone cliquable — repli sûr, jamais une exception qui
 * interromprait tout le rendu de l'aperçu). Un `querySelectorAll` par
 * sélecteur DISTINCT (mise en cache) : un champ répété (hypothèses, MA…)
 * partage le MÊME sélecteur pour tous ses rangs.
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
        if (a.kind === 'dataset') {
            if (el instanceof HTMLElement && a.datasetKey) candidates.set(key, { kind: 'dataset', el, datasetKey: a.datasetKey });
        } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            candidates.set(key, { kind: 'field', el });
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
    /** Reconstructions abandonnées par dépassement de `PENDING_MATCH_BUDGET` (garantie 4) — valeur répétée/ambiguë ne convergeant jamais vers un match complet. */
    runawayDrops: number;
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
        stats: { anchorsResolved: 0, hitZonesPlaced: 0, fragmentsSeen: 0, footerSkipped: 0, budgetDrops: 0, interruptDrops: 0, ambiguousSkips: 0, runawayDrops: 0 },
    };
}

/** Éditeur actif (au plus un à la fois — un clic ailleurs/Échap le referme avant d'en ouvrir un autre). */
let activeEditor: HTMLInputElement | HTMLTextAreaElement | null = null;

function closeActiveEditor(): void {
    activeEditor?.remove();
    activeEditor = null;
}

/** Message d'erreur affiché après une correction refusée (au plus un à la fois, même contrat que `activeEditor`) — auto-effacé après `EDIT_ERROR_TTL_MS` ou dès qu'un nouvel éditeur/une nouvelle erreur le remplace. */
let activeErrorEl: HTMLElement | null = null;
let activeErrorTimer: ReturnType<typeof setTimeout> | null = null;

function closeActiveError(): void {
    if (activeErrorTimer !== null) { clearTimeout(activeErrorTimer); activeErrorTimer = null; }
    activeErrorEl?.remove();
    activeErrorEl = null;
}

const EDIT_ERROR_TTL_MS = 6000;

/** Affiche le refus juste sous la zone cliquée (`hit`) — `role="alert"` : annoncé par les lecteurs d'écran sans déplacer le focus (cf. JSDoc `commitEdit`, aucune tentative de garder l'éditeur ouvert). Styles `.pdf-edit-error`, `styles/oi.css`. */
function showEditRejection(hit: HTMLButtonElement, overlay: HTMLElement, message: string): void {
    closeActiveError();
    const box = document.createElement('p');
    box.className = 'pdf-edit-error';
    box.setAttribute('role', 'alert');
    box.textContent = message;
    box.style.left = hit.style.left;
    box.style.top = `calc(${hit.style.top} + ${hit.style.height} + 2px)`;
    overlay.appendChild(box);
    activeErrorEl = box;
    activeErrorTimer = setTimeout(closeActiveError, EDIT_ERROR_TTL_MS);
}

/** Message de la garde 2 (`commitEdit`, JSDoc dédié — vidage d'un champ non vide refusé). */
const EMPTYING_REJECTED_MESSAGE = "Correction refusée : viderait ce champ (valeur actuelle conservée). Utilisez le formulaire pour l'effacer intentionnellement.";

/** Indice de format affiché en cas de refus — seuls les types à format STRICT (date/heure, cf. spec) en ont un utile ; les autres s'appuient sur `validationMessage` natif (`rejectionMessage`). */
function expectedFormatHint(type: string): string | null {
    if (type === 'date') return 'AAAA-MM-JJ (ex. 2026-08-19)';
    if (type === 'time') return 'HH:MM (ex. 14:30)';
    return null;
}

/**
 * Message de refus — distingue 2 cas (capturé AVANT `commitEdit` ne restaure
 * `el.value`, cf. son JSDoc) :
 *  - valeur SILENCIEUSEMENT ASSAINIE par le navigateur (`el.value !==
 *    attempted` après affectation — le bug reproduit, `type="date"`/`"time"`
 *    rejetant un format invalide en le VIDANT) : `validationMessage` porte
 *    alors sur la valeur déjà vidée, inexploitable — message dédié avec le
 *    format attendu ;
 *  - valeur CONSERVÉE mais invalide au sens de la validation de contraintes
 *    (`pattern`/`maxLength`/`min`/`max`/`step`/`required`) : `validationMessage`
 *    natif du navigateur est déjà clair, on le relaie tel quel.
 */
function rejectionMessage(el: HTMLInputElement | HTMLTextAreaElement, attempted: string): string {
    const type = el instanceof HTMLInputElement ? el.type : 'textarea';
    if (el.value !== attempted) {
        const hint = expectedFormatHint(type);
        return `Correction refusée : « ${attempted} » n'est pas une valeur valide.${hint ? ` Format attendu : ${hint}.` : ''} Champ inchangé.`;
    }
    return `Correction refusée : ${el.validationMessage || 'valeur invalide'}. Champ inchangé.`;
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
 *
 * GARDE 1 — SANITISATION SILENCIEUSE (bug reproduit : `lever_soleil`,
 * `type="time"`, un format invalide saisi depuis l'aperçu VIDAIT
 * silencieusement le champ — le navigateur assainit `.value` d'un
 * `<input type="date"|"time">` en `""` sans lever d'exception ni le
 * signaler) — écrit `newValue`, PUIS relit `el.value` et `checkValidity()` :
 * si l'écriture a été assainie en autre chose que `newValue` (perte
 * silencieuse) OU si la contrainte native du champ (`pattern`/`min`/`max`/
 * `step`/`maxLength`/`required`) est violée, `el.value` est IMMÉDIATEMENT
 * restaurée à sa valeur précédente — AVANT tout `dispatchEvent`/
 * `syncDomToStoreImmediate`/`regenerate`, donc aucun code externe n'observe
 * jamais l'état corrompu, même transitoirement.
 *
 * GARDE 2 — VIDAGE (mesure navigateur RÉEL, mission « garde-fous
 * d'édition ») : la garde 1 seule NE SUFFIT PAS une fois `applyFieldConstraints`
 * posé (spec §2 point 2) — un éditeur `type="time"`/`"date"` assainit DÉJÀ
 * lui-même toute saisie hors format EN `""` AVANT que `commitEdit` ne la
 * voie (même algorithme de sanitisation navigateur, appliqué côté éditeur
 * cette fois) : `newValue` arrive donc déjà vide, `checkValidity()` sur `""`
 * est VRAIE pour un champ non `required` (vide = état valide) — la garde 1
 * commettrait alors ce vidage EN LE CROYANT délibéré. Constaté en navigateur
 * réel (Chromium, PAS seulement jsdom) : `lever_soleil` = « 06:26 » → éditeur
 * `type="time"`, valeur hors bornes injectée → `editor.value` assaini en
 * `""` par LE NAVIGATEUR avant même le `blur` → sans cette garde, `""` était
 * committé comme une correction légitime. Défense : toute transition d'une
 * valeur NON VIDE vers `""` est refusée, quel que soit le type/la contrainte
 * — cf. `EMPTYING_REJECTED_MESSAGE`. Vider un champ RESTE possible depuis le
 * formulaire lui-même (hors périmètre de cet éditeur, spec §2 : correction,
 * pas suppression) — compromis délibéré, préférable à toute ambiguïté entre
 * « sanitisation silencieuse » et « vidage volontaire », indiscernables une
 * fois `newValue` reçu.
 *
 * Aucune écriture n'est donc jamais destructrice, y compris pour un type/une
 * contrainte non anticipée ici (filet générique, pas un `switch` par type).
 *
 * EXPORTÉE (via `commitEdit` ci-dessous) pour test unitaire DIRECT
 * (`tests/unit/oi/oi-pdf-preview-edit.test.ts`) — exercer la garde 1 pour une
 * chaîne EFFECTIVEMENT hors format (pas déjà vidée) nécessite d'appeler
 * cette fonction directement avec le champ SOURCE réel comme cible : le
 * cycle `openEditor`/blur, une fois `applyFieldConstraints` posé, n'expose
 * plus JAMAIS une telle chaîne à `commitFieldEdit` pour `type="time"`/`"date"`
 * (garde 2 ci-dessus, seule garde exercée par ce chemin pour ces 2 types).
 */
function commitFieldEdit(
    candidate: Extract<EditCandidate, { kind: 'field' }>,
    newValue: string,
    pageNumber: number,
    regenerate: () => Promise<void>,
): { ok: true } | { ok: false; message: string } {
    const el = candidate.el;
    if (el.value === newValue) return { ok: true };
    const previousValue = el.value;
    if (previousValue !== '' && newValue === '') return { ok: false, message: EMPTYING_REJECTED_MESSAGE }; // garde 2, cf. JSDoc ci-dessus.
    el.value = newValue;
    const accepted = el.value === newValue && el.checkValidity();
    if (!accepted) {
        const message = rejectionMessage(el, newValue);
        el.value = previousValue; // restauration AVANT tout événement/sync — cf. JSDoc ci-dessus.
        return { ok: false, message };
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    syncDomToStoreImmediate();
    void regenerate().then(() => {
        document.querySelector(`.pdf-preview-page[data-page-number="${pageNumber}"]`)?.scrollIntoView?.({ block: 'start' });
    });
    return { ok: true };
}

/**
 * Normalisation propre à chaque clé `dataset` PATRACDVR éditable — MÊME
 * transformation que le chemin d'édition EXISTANT (panneau Édition Rapide/
 * renommage véhicule, `patrac.ts`) : trigramme toujours MAJUSCULE
 * (`saveQuickEditChanges`/écouteur `input`), nom de véhicule toujours
 * `trim()` (`renameVehicle`), DIR écrit tel quel (aucune des 2 UI existantes
 * ne le transforme). Garantit qu'une correction faite DEPUIS L'APERÇU
 * produit exactement la même valeur stockée qu'une correction faite depuis
 * le formulaire — jamais un 2e format parallèle pour la même donnée.
 */
function normalizeDatasetValue(datasetKey: string, value: string): string {
    if (datasetKey === 'trigramme') return value.toUpperCase();
    if (datasetKey === 'vehicleName') return value.trim();
    return value;
}

/**
 * Écrit la correction — chemin `dataset` (mission « tout le texte
 * modifiable », cf. JSDoc de fichier § SECOND CHEMIN D'ÉCRITURE). Symétrique
 * de `commitFieldEdit` : MÊME garde « vidage refusé »
 * (`EMPTYING_REJECTED_MESSAGE`), MÊME séquence post-écriture
 * (`syncDomToStoreImmediate` + `regenerate` + retour en vue) — PAS de garde
 * « sanitisation silencieuse » (garde 1 de `commitFieldEdit`) : un attribut
 * `data-*` n'a AUCUNE contrainte de format côté plateforme (contrairement à
 * `type="date"`/`"time"`), `el.dataset[key] = v` stocke TOUJOURS exactement
 * `v`, jamais assainie par le navigateur.
 *
 * Effets de bord MIROIR du chemin d'édition live plutôt que réimplémentés :
 * `.vehicle-name` (véhicule) mis à jour directement (même effet que
 * `renameVehicle`) ; `window.updateMemberButtonVisuals` (membre — repeint le
 * libellé du bouton) et, dans tous les cas, `window.updateArticulationDisplay`
 * (régénère les 3 listes d'ordre ET la composition MOICP/ZMSPCP/Effraction
 * depuis le PATRACDVR canonique, cf. `articulation.ts::refreshArticulationFromPatracdvr`)
 * — résolus par `window`, MÊME garde `typeof` que partout ailleurs dans ce
 * paquet (RÈGLE D'OR, cf. JSDoc `patrac.ts`).
 */
function commitDatasetEdit(
    candidate: Extract<EditCandidate, { kind: 'dataset' }>,
    newValue: string,
    pageNumber: number,
    regenerate: () => Promise<void>,
): { ok: true } | { ok: false; message: string } {
    const { el, datasetKey } = candidate;
    const previousValue = el.dataset[datasetKey] ?? '';
    const normalized = normalizeDatasetValue(datasetKey, newValue);
    if (previousValue === normalized) return { ok: true };
    if (previousValue !== '' && normalized === '') return { ok: false, message: EMPTYING_REJECTED_MESSAGE }; // même garde que commitFieldEdit.
    el.dataset[datasetKey] = normalized;
    if (datasetKey === 'vehicleName') {
        const nameEl = el.querySelector<HTMLElement>('.vehicle-name');
        if (nameEl) nameEl.textContent = normalized;
    } else if (typeof window.updateMemberButtonVisuals === 'function') {
        window.updateMemberButtonVisuals(el);
    }
    if (typeof window.updateArticulationDisplay === 'function') window.updateArticulationDisplay();
    syncDomToStoreImmediate();
    void regenerate().then(() => {
        document.querySelector(`.pdf-preview-page[data-page-number="${pageNumber}"]`)?.scrollIntoView?.({ block: 'start' });
    });
    return { ok: true };
}

/** Distribue vers `commitFieldEdit` ou `commitDatasetEdit` selon `candidate.kind` — cf. JSDoc de fichier § SECOND CHEMIN D'ÉCRITURE pour ce qui distingue les deux. */
export function commitEdit(candidate: EditCandidate, newValue: string, pageNumber: number, regenerate: () => Promise<void>): { ok: true } | { ok: false; message: string } {
    if (candidate.kind === 'dataset') return commitDatasetEdit(candidate, newValue, pageNumber, regenerate);
    return commitFieldEdit(candidate, newValue, pageNumber, regenerate);
}

/**
 * Reflète `type` + attributs de contrainte natifs du champ SOURCE sur
 * l'éditeur (spec §2 point 2 : l'éditeur doit épouser le type du champ —
 * date → sélecteur de date, heure → sélecteur d'heure — plutôt qu'imposer
 * une saisie libre pour tout). Recensement des types réellement émis par
 * `#oi-form`/les générateurs de blocs (`oi/index.html`, `formulaires.ts`,
 * `articulation.ts`) : `text` (par défaut), `date`, `time`, `<textarea>` —
 * couverts ci-dessous ; `pattern`/`min`/`max`/`step`/`maxLength`/`required`
 * copiés génériquement (aucun n'est posé aujourd'hui, mais le filet reste
 * valable si un futur champ en gagne, sans retouche ici). `<select>` n'est
 * jamais la cible d'un ancrage (cf. JSDoc de fichier et `resolveEditCandidates`)
 * donc jamais un `candidate.el` ici — pas de branche dédiée.
 */
function applyFieldConstraints(editor: HTMLInputElement | HTMLTextAreaElement, source: HTMLInputElement | HTMLTextAreaElement): void {
    if (editor instanceof HTMLInputElement && source instanceof HTMLInputElement) {
        editor.type = source.type;
        if (source.pattern) editor.pattern = source.pattern;
        if (source.min !== '') editor.min = source.min;
        if (source.max !== '') editor.max = source.max;
        if (source.step !== '') editor.step = source.step;
    }
    if (source.maxLength >= 0) editor.maxLength = source.maxLength;
    editor.required = source.required;
}

/**
 * Ouvre le champ d'édition au-dessus du fragment cliqué — `<textarea>` si le
 * champ source en est un (spec §2 point 3), `<input>` du MÊME `type`/mêmes
 * contraintes sinon (`applyFieldConstraints`, spec §2 point 2) pour un
 * candidat `kind:'field'` ; toujours un `<input>` texte SANS contrainte
 * reflétée pour un candidat `kind:'dataset'` (aucun des 3 champs `dataset`
 * couverts — trigramme/dir/vehicleName — n'est multi-ligne ni contraint,
 * cf. JSDoc de fichier). Entrée valide SEULEMENT pour un `<input>` (une
 * `<textarea>` doit pouvoir recevoir un retour à la ligne saisi) ; Échap
 * annule dans les deux cas ; la perte de focus tente toujours la validation
 * (`commitEdit`) — un refus affiche un message (`showEditRejection`) SANS
 * écrire ni fermer l'éditeur autrement que normalement (cf. JSDoc
 * `commitEdit` : le champ source n'est jamais touché par une valeur
 * refusée).
 */
function openEditor(
    hit: HTMLButtonElement,
    candidate: EditCandidate,
    overlay: HTMLElement,
    pageNumber: number,
    regenerate: () => Promise<void>,
): void {
    closeActiveEditor();
    closeActiveError();
    const isTextarea = candidate.kind === 'field' && candidate.el.tagName === 'TEXTAREA';
    const editor = document.createElement(isTextarea ? 'textarea' : 'input');
    editor.className = 'pdf-edit-input';
    if (candidate.kind === 'field') {
        applyFieldConstraints(editor, candidate.el);
        editor.value = candidate.el.value;
    } else {
        editor.value = candidate.el.dataset[candidate.datasetKey] ?? '';
    }

    const hitWidthPx = parseFloat(hit.style.width) || 60;
    const hitHeightPx = parseFloat(hit.style.height) || 14;
    // Un sélecteur natif date/heure a une largeur intrinsèque (chrome du
    // picker) supérieure au texte rendu dans le PDF (ex. « 14:30 » tient sur
    // ~35px de PDF) — plancher relevé pour ces 2 types afin de ne pas le
    // tronquer visuellement.
    const isNativeDateOrTime = editor instanceof HTMLInputElement && (editor.type === 'date' || editor.type === 'time');
    editor.style.left = hit.style.left;
    editor.style.top = hit.style.top;
    editor.style.width = `${Math.max(hitWidthPx, isNativeDateOrTime ? 130 : 90)}px`;
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
        const result = commitEdit(candidate, value, pageNumber, regenerate);
        if (!result.ok) showEditRejection(hit, overlay, result.message);
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
 * Garantie 4 (ajoutée mission « tout le texte modifiable », cas mesuré :
 * champ `ma_list` d'une fiche adversaire réelle portant un texte collé sans
 * espace, ex. « Très hostile forces de l'ordreTrès hostile forces de
 * l'ordre… » répété une douzaine de fois) — budget de fragments qu'UNE
 * reconstruction en cours (`pendingFragIdxs`) peut consommer avant abandon
 * FORCÉ de tous ses candidats. Distinct de `STALE_FRAGMENT_BUDGET` (qui ne
 * compte que les fragments INFRUCTUEUX) : une reconstruction ambiguë entre
 * plusieurs valeurs quasi identiques reste `productive === true` fragment
 * après fragment (chaque mot du groupe répété étend encore la tentative)
 * SANS jamais atteindre un match complet ni redevenir non-productive — la
 * garantie 2 ne s'applique donc jamais à ce cas, et SANS ce plafond la
 * reconstruction continue de consommer TOUT LE RESTE du document (constaté :
 * 305 → 156 zones posées, pages 4 à 13 retombées à 0 après l'ajout de
 * l'ancrage MA sur cette fiche réelle) au lieu de se limiter aux quelques
 * ancrages concernés. `ponytail:` seuil empirique généreux (une page réelle
 * ne dépasse pas ~150 fragments au total, cf. mesure — un champ isolé, même
 * long, en consomme nettement moins) ; upgrade si mesure future : proportionnel
 * à la densité de fragments observée, même esprit que `STALE_FRAGMENT_BUDGET`.
 */
const PENDING_MATCH_BUDGET = 150;

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
        // Garantie 4 (JSDoc `PENDING_MATCH_BUDGET`) : une reconstruction encore
        // ambiguë après un nombre DÉRAISONNABLE de fragments n'atteindra
        // vraisemblablement jamais de match complet (valeur répétée sans
        // frontière nette) — abandon de TOUS les candidats en lice plutôt que
        // de continuer à consommer indéfiniment les fragments du reste du
        // document (aucune zone pour ces quelques ancrages, mais les suivants
        // restent atteignables).
        if (fragIdxs.length > PENDING_MATCH_BUDGET) {
            state.stats.runawayDrops++;
            for (const c of list) dropAnchor(state, c.index);
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
                // PLUSIEURS candidats encore en lice (hypothèses non départagées) : si
                // EXACTEMENT UN d'entre eux avait déjà atteint sa cible COMPLÈTE juste avant
                // l'interruption (cas mesuré : `attitude_adversaire` = « Très hostile forces
                // de l'ordre », préfixe EXACT d'un MA bien plus long répété sur la même
                // fiche — les deux restaient en lice, `allIdentical` faux, tant qu'un mot de
                // plus pouvait encore départager) — cette interruption CONFIRME qu'aucun
                // frère ne pouvait plus s'étendre, la complétion devient donc certaine
                // (résolution différée, jamais un pari : un seul candidat a atteint sa cible
                // EXACTE, tous les autres restaient strictement incomplets). Sans ce
                // rattrapage, le candidat complet était simplement relâché SANS jamais être
                // réglé — la tête restait bloquée dessus jusqu'à épuisement du budget
                // (`STALE_FRAGMENT_BUDGET`), page après page (constaté : 305 → 156 zones
                // après l'ajout de l'ancrage MA sur cette fiche réelle, cf. `PENDING_MATCH_BUDGET`).
                // Aucun candidat complet (ou plusieurs, cas non observé sans `allIdentical`) :
                // aucun n'a jamais été confirmé — on les relâche SANS les régler, une
                // association future (même mot réutilisé ailleurs, ex. « Depart » réapparaît
                // pour un AUTRE événement) reste possible. Ce même fragment est retenté
                // ci-dessous contre la fenêtre d'ancrages COURANTE.
                const completed = pendingCandidates.filter((c) => c.matched === matchableTarget((state.anchors[c.index] as OiPdfEditAnchor).value));
                if (pendingCandidates.length === 1) {
                    state.stats.interruptDrops++;
                    dropAnchor(state, (pendingCandidates[0] as { index: number }).index);
                    advanceHead(state);
                } else if (completed.length === 1) {
                    resolveAnchor(state, (completed[0] as { index: number }).index, pendingFragIdxs, items, viewport, dpr, pageNumber, overlay, regenerate);
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
