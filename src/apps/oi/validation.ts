/**
 * validation.ts — R2-T4 : infrastructure de validation inline pour les
 * formulaires OI (SPEC R2-T4, nouveau module — pas un port verbatim).
 * ===========================================================================
 *
 * But : ajouter un retour visuel accessible (message sous le champ,
 * `aria-invalid`, `aria-describedby`) SANS retirer les `alert()` existants
 * (tranche T2 séparée) et SANS rien changer à l'état de repos des champs
 * (aucun DOM ajouté tant qu'aucune erreur n'est déclenchée — impératif pour
 * les baselines visuelles capturées sans état d'erreur, cf. gate (c)).
 *
 * Politique de déclenchement (imposée par la mission) :
 *  - AU BLUR uniquement, tant qu'aucune erreur n'a encore été montrée
 *    (jamais à la frappe avant la première erreur — évite l'agressivité
 *    d'une validation « live » sur un champ que l'utilisateur est encore
 *    en train de remplir) ;
 *  - après une première erreur, re-validation À CHAQUE frappe (`input`)
 *    pour effacer le message dès que la correction rend le champ valide.
 */

// P3 — compteurs de caractères calibrés PDF : lecture SEULE de l'API exportée
// de `pdf/document-builder.ts` (`PAGE_CAPACITY`, source de vérité des
// capacités calibrées) et de `pdf/theme.ts` (primitives de mesure). Ce
// module reste néanmoins un CONSOMMATEUR pur : aucune écriture dans `pdf/`.
import { PAGE_CAPACITY } from '@oi/pdf/document-builder.js';
import { estimateCharsPerLine, mm, pageGeometry } from '@oi/pdf/theme.js';

/** Une règle de validation : `test` renvoie `true` si la valeur est valide. */
export interface FieldRule {
    test: (value: string) => boolean;
    message: string;
}

/** Détache un `attachValidation` : retire les listeners et l'erreur affichée. */
export type DetachValidation = () => void;

/** Champ requis (non vide après trim). */
export function required(message = 'Ce champ est requis.'): FieldRule {
    return { test: (v) => v.trim().length > 0, message };
}

/**
 * Longueur bornée, y compris pour une valeur vide (contrairement à
 * `minLength`/`maxLength` « best effort » qui tolèrent un champ vide libre) —
 * utile pour un format à taille fixe comme un trigramme (2 à 4 caractères,
 * règle déjà appliquée ailleurs dans l'app : `patrac.ts` `addManualMember`/
 * `addCellBatch`).
 */
export function lengthRange(min: number, max: number, message: string): FieldRule {
    return {
        test: (v) => {
            const len = v.trim().length;
            return len >= min && len <= max;
        },
        message,
    };
}

/** Construit l'id de l'élément d'erreur associé à un champ. */
function errorIdFor(input: HTMLInputElement | HTMLTextAreaElement): string {
    return `${input.id}-error`;
}

function showError(input: HTMLInputElement | HTMLTextAreaElement, message: string): void {
    input.setAttribute('aria-invalid', 'true');
    const errorId = errorIdFor(input);
    let errorEl = document.getElementById(errorId);
    if (!errorEl) {
        errorEl = document.createElement('p');
        errorEl.className = 'field-error';
        errorEl.id = errorId;
        input.insertAdjacentElement('afterend', errorEl);
    }
    errorEl.textContent = message;

    const describedBy = input.getAttribute('aria-describedby');
    const ids = describedBy ? describedBy.split(/\s+/).filter(Boolean) : [];
    if (!ids.includes(errorId)) {
        ids.push(errorId);
        input.setAttribute('aria-describedby', ids.join(' '));
    }
}

function clearError(input: HTMLInputElement | HTMLTextAreaElement): void {
    input.removeAttribute('aria-invalid');
    const errorId = errorIdFor(input);

    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy) {
        const ids = describedBy.split(/\s+/).filter((id) => id && id !== errorId);
        if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
        else input.removeAttribute('aria-describedby');
    }

    const errorEl = document.getElementById(errorId);
    if (errorEl) errorEl.remove();
}

/**
 * Branche la validation inline sur un champ. Les règles sont évaluées dans
 * l'ordre ; la première règle en échec fournit le message affiché.
 *
 * Retourne une fonction de détachement (retire les listeners + l'erreur
 * affichée) — utile pour les champs créés dynamiquement et retirés du DOM
 * (ex. fiches adversaire supprimées) afin d'éviter toute fuite de listener.
 */
export function attachValidation(
    input: HTMLInputElement | HTMLTextAreaElement,
    rules: FieldRule[],
): DetachValidation {
    if (!input.id) {
        throw new Error('attachValidation: le champ doit avoir un id (requis pour aria-describedby).');
    }

    let hasErrored = false;

    function validate(): boolean {
        const value = input.value;
        for (const rule of rules) {
            if (!rule.test(value)) {
                showError(input, rule.message);
                hasErrored = true;
                return false;
            }
        }
        clearError(input);
        return true;
    }

    function onBlur(): void {
        validate();
    }

    function onInput(): void {
        // Jamais de validation à la frappe avant la première erreur : on ne
        // veut pas gêner la saisie d'un champ encore incomplet.
        if (hasErrored) validate();
    }

    input.addEventListener('blur', onBlur);
    input.addEventListener('input', onInput);

    return () => {
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('input', onInput);
        clearError(input);
        hasErrored = false;
    };
}

/**
 * charCounter — P3 : compteur de caractères calibré sur les CAPACITÉS RÉELLES
 * du PDF (arbitrage Nico validé : « réduction et si police trop petite refus,
 * avec compteur de caractères »). ==========================================
 *
 * Contrairement à `attachValidation`, ce n'est JAMAIS un blocage de saisie :
 * pas de `maxlength` dur (le refus PDF — `OiPdfFitRefusalError`, cf.
 * `pdf/document-builder.ts` — reste l'arbitre final), seulement une
 * information progressive sous le champ : discrète en régime normal, ambre
 * en avertissement (~85 % du seuil), rouge au-delà (« risque de refus PDF »).
 *
 * Seuil (`softMax`) dérivé de `PAGE_CAPACITY` (source de vérité, calibrée
 * depuis le modèle de coût du PDF) au palier `CHAR_COUNTER_FONT_PX` = 8 px,
 * PAS la police nominale 11 px : les paliers fit-to-page 10→7 (cf.
 * `FIT_FONT_STEPS`, `pdf/theme.ts`) absorbent déjà un dépassement de la
 * capacité au nominal en réduisant automatiquement la police — le compteur
 * ne doit donc avertir que lorsque même ce filet de sécurité devient ténu
 * (au-delà de 8 px, seul le palier plancher 7 px — `FIT_FONT_FLOOR` — reste,
 * zone où le refus devient un risque réel).
 *
 * Politique d'apparition (imposée par la mission, gate visuel) : le compteur
 * n'existe dans le DOM QUE si le champ a le focus OU si sa longueur atteint
 * déjà ≥ 50 % de `softMax` — jamais au repos sur un champ court/vide, pour ne
 * polluer ni les baselines visuelles (`tests/visual/compare.mjs`) ni l'UI
 * d'un formulaire dont l'immense majorité des champs restent sous le seuil.
 */
export interface CharCounterOptions {
    /** Seuil d'avertissement/dépassement (caractères) — jamais un blocage. */
    softMax: number;
    /** Optionnel : borne dure (`maxLength` réel) — inutilisée à ce jour (cf. JSDoc module), disponible si un jour utile. */
    hardMax?: number;
}

type CharCounterZone = 'normal' | 'warning' | 'danger';

/** Ratio de `softMax` à partir duquel la zone passe en avertissement (ambre). */
const CHAR_COUNTER_WARNING_RATIO = 0.85;
/** Ratio de `softMax` à partir duquel le compteur devient visible même hors focus. */
const CHAR_COUNTER_VISIBLE_RATIO = 0.5;

function charCounterZone(count: number, softMax: number): CharCounterZone {
    if (softMax <= 0) return 'normal';
    if (count > softMax) return 'danger';
    if (count >= softMax * CHAR_COUNTER_WARNING_RATIO) return 'warning';
    return 'normal';
}

function counterIdFor(input: HTMLInputElement | HTMLTextAreaElement): string {
    return `${input.id}-charcount`;
}

let autoIdSeq = 0;

/** Assigne un id synthétique si le champ n'en a pas (cas des champs dynamiques `articulation.ts`, sans `id`, seulement une `class`). */
function ensureId(input: HTMLInputElement | HTMLTextAreaElement): void {
    if (!input.id) {
        autoIdSeq += 1;
        input.id = `char-counter-field-${autoIdSeq}`;
    }
}

function removeCharCounterEl(input: HTMLInputElement | HTMLTextAreaElement): void {
    const counterId = counterIdFor(input);
    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy) {
        const ids = describedBy.split(/\s+/).filter((id) => id && id !== counterId);
        if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
        else input.removeAttribute('aria-describedby');
    }
    const el = document.getElementById(counterId);
    if (el) el.remove();
}

function renderCharCounterEl(input: HTMLInputElement | HTMLTextAreaElement, count: number, softMax: number, zone: CharCounterZone): void {
    const counterId = counterIdFor(input);
    let el = document.getElementById(counterId);
    if (!el) {
        el = document.createElement('p');
        el.id = counterId;
        input.insertAdjacentElement('afterend', el);

        const describedBy = input.getAttribute('aria-describedby');
        const ids = describedBy ? describedBy.split(/\s+/).filter(Boolean) : [];
        if (!ids.includes(counterId)) {
            ids.push(counterId);
            input.setAttribute('aria-describedby', ids.join(' '));
        }
    }
    el.className = `char-counter char-counter--${zone}`;
    el.textContent = zone === 'danger' ? `${count}/${softMax} — risque de refus PDF` : `${count}/${softMax}`;
    // aria-live uniquement au passage en zone rouge (mission) : annoncer chaque
    // frappe en régime normal/avertissement serait bruyant pour un lecteur
    // d'écran ; seul le franchissement du seuil dur mérite l'interruption.
    if (zone === 'danger') el.setAttribute('aria-live', 'polite');
    else el.removeAttribute('aria-live');
}

/**
 * Branche un compteur de caractères sur un champ. Retourne une fonction de
 * détachement (même contrat que `attachValidation`) — utile pour les champs
 * dynamiques retirés du DOM (fiches adversaire, hypothèses d'effraction).
 */
export function charCounter(input: HTMLInputElement | HTMLTextAreaElement, opts: CharCounterOptions): DetachValidation {
    const { softMax, hardMax } = opts;
    ensureId(input);
    if (hardMax !== undefined) input.maxLength = hardMax;

    let isFocused = false;

    function update(): void {
        const count = input.value.length;
        const shouldShow = isFocused || count >= softMax * CHAR_COUNTER_VISIBLE_RATIO;
        if (!shouldShow) {
            removeCharCounterEl(input);
            return;
        }
        renderCharCounterEl(input, count, softMax, charCounterZone(count, softMax));
    }

    function onFocus(): void {
        isFocused = true;
        update();
    }
    function onBlur(): void {
        isFocused = false;
        update();
    }
    function onInput(): void {
        update();
    }

    input.addEventListener('focus', onFocus);
    input.addEventListener('blur', onBlur);
    input.addEventListener('input', onInput);

    // État initial : un champ restauré (session/import) déjà long doit afficher
    // le compteur sans attendre une première frappe.
    update();

    return () => {
        input.removeEventListener('focus', onFocus);
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('input', onInput);
        removeCharCounterEl(input);
    };
}

/**
 * Palier de police retenu comme seuil d'alerte des compteurs — cf. JSDoc
 * `charCounter` : au-delà de la capacité à CE palier, seul `FIT_FONT_FLOOR`
 * (7 px, `pdf/theme.ts`) reste comme filet, zone où le refus PDF devient un
 * risque réel plutôt qu'une simple réduction automatique.
 */
const CHAR_COUNTER_FONT_PX = 8;

/**
 * Seuil (caractères) du champ ATCD/dangerosité d'une fiche adversaire —
 * dérivé de `PAGE_CAPACITY.adversaireAtcdMaxChars` (source de vérité,
 * `pdf/document-builder.ts`), palier `CHAR_COUNTER_FONT_PX`.
 */
export const ADVERSAIRE_ATCD_SOFT_MAX = PAGE_CAPACITY.adversaireAtcdMaxChars(CHAR_COUNTER_FONT_PX);

/**
 * Seuil (caractères) des champs « C conduite à tenir » ZMSPCP/MOICP — dérivé
 * de `PAGE_CAPACITY.articulationCatMaxChars`, même palier.
 */
export const ARTICULATION_CAT_SOFT_MAX = PAGE_CAPACITY.articulationCatMaxChars(CHAR_COUNTER_FONT_PX);

/**
 * Seuil (caractères) d'UN champ de carte hypothèse d'effraction (Technique/
 * Moyen, Dégagement OU Assaut — les 3 champs partagent le même seuil,
 * approximation volontairement MINORÉE, cf. ci-dessous).
 *
 * Aucune fonction `PAGE_CAPACITY` n'expose ce seuil (seul le NOMBRE de
 * cartes tenant sur une page, `effractionHypothesesCardsMax`, y est exposé —
 * pas le volume de texte par champ À L'INTÉRIEUR d'une carte). Dérivation
 * locale, MÊME MÉTHODE que `PAGE_CAPACITY` (`pageGeometry`/
 * `estimateCharsPerLine`, `pdf/theme.ts`) mais reconstituant la géométrie
 * d'une carte hypothèse (`pdf/document-builder.ts`, fonctions privées non
 * exportées `hypothesisAdaptiveCardPt`/`hypCardsColumnCount`/`hypCardPadPt`) :
 *  - `EFFRACTION_HEADER_RESERVE_PT` = 76 = EFFRAC_H2_PT(48) + EFFRAC_H3_PT(28)
 *    (constantes privées `document-builder.ts`, dupliquées ICI — À
 *    RESYNCHRONISER si elles changent là-bas) ;
 *  - `PDF_LINE_ADVANCE_EM` = 1.914, idem (`document-builder.ts`) ;
 *  - 2 colonnes dès 2 hypothèses (`hypCardsColumnCount`), `EFFRAC_HYP_CARDS_MAX`
 *    = 4 cartes par page (`PAGE_CAPACITY.effractionHypothesesCardsMax()`),
 *    donc 2 rangées de 2 cartes ;
 *  - padding de carte (24 pt) + 1 ligne de titre réservés par carte ;
 *  - les 3 champs (Technique/Moyen, Dégagement, Assaut) se partagent
 *    équitablement les lignes restantes (mise en page adaptative réelle :
 *    2 champs COURTS côte à côte + 1 LONG pleine largeur — répartition
 *    égale sur 3 = direction SÛRE, jamais optimiste) ;
 *  - largeur de ligne prise à MI-largeur de carte (2 champs sur 3 sont
 *    posés côte à côte dans la mise en page adaptative réelle) — largeur la
 *    PLUS minorée retenue uniformément pour les 3 champs.
 *
 * Capacité MINORÉE par construction (mêmes principes que `PAGE_CAPACITY`,
 * cf. son JSDoc) : mieux vaut avertir tôt qu'annoncer une marge inexistante.
 */
function effractionHypFieldSoftMax(fontPx: number): number {
    const EFFRACTION_HEADER_RESERVE_PT = 76;
    const PDF_LINE_ADVANCE_EM = 1.914;
    const CARD_PAD_PT = 24;
    const FIELDS_PER_CARD = 3;
    const COLS = 2;

    const geo = pageGeometry('a4');
    const cardsMax = PAGE_CAPACITY.effractionHypothesesCardsMax();
    const rows = Math.ceil(cardsMax / COLS);
    const cardWidthPt = (geo.contentWidthPt - mm(6)) / COLS;
    const availableCardsHeightPt = Math.max(0, geo.contentHeightPt - EFFRACTION_HEADER_RESERVE_PT);
    const heightPerCardPt = availableCardsHeightPt / rows;
    const linePt = fontPx * PDF_LINE_ADVANCE_EM;
    const bodyHeightPt = Math.max(0, heightPerCardPt - linePt /* titre */ - CARD_PAD_PT);
    const linesAvailable = Math.floor(bodyHeightPt / linePt);
    const linesPerField = Math.floor(linesAvailable / FIELDS_PER_CARD);
    const halfCardWidthPt = (cardWidthPt - mm(4)) / 2;
    const cpl = estimateCharsPerLine(fontPx, halfCardWidthPt);
    return Math.max(0, linesPerField * cpl);
}

export const EFFRACTION_HYP_FIELD_SOFT_MAX = effractionHypFieldSoftMax(CHAR_COUNTER_FONT_PX);
