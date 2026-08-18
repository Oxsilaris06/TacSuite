/**
 * pdf-section-order.ts — Panneau « Ordre des sections » de l'aperçu PDF OI
 * (§2 SPEC-2026-08-18-pdf-et-champs.md). Réordonnancement des sections
 * RÉORDONNABLES du registre `OI_PDF_SECTIONS` (`document-builder.ts`) par
 * glisser-déposer ET boutons monter/descendre — LES DEUX exigés (le glisser
 * seul est inutilisable au doigt et inaccessible au clavier). Chaque
 * changement écrit `Store.state.formData.pdf_section_order` (persistance
 * normale via le proxy réactif `Store`, `@oi/init.js`) puis régénère
 * l'aperçu (`PDFEngineV2.openPreview`) — au RELÂCHEMENT seulement
 * (`dragend` / clic bouton), jamais à chaque micro-mouvement de glisser.
 *
 * `'adversaires'` (`OI_PDF_LOCKED_SECTION_ID`) est VERROUILLÉE EN POSITION
 * (numérotation fixe « 2.<index> », cf. JSDoc `OI_PDF_SECTIONS`,
 * `document-builder.ts`) : rendue en première ligne, sans poignée de
 * glisser ni boutons — jamais proposée au réordonnancement ici (voir aussi
 * l'épinglage défensif dans `resolveOiPdfSectionOrder`).
 *
 * Glisser-déposer NON branché sur le mécanisme PARTAGÉ `@oi/drag-drop.js`
 * (`wireDraggableMember`/`wireDropContainer`, réutilisé par le PATRACDVR) :
 * ce paquet câble une délégation GLOBALE sur `document` via la classe CSS
 * `.draggable` (`initDocumentDragTransfer`, déjà active pour les membres
 * PATRACDVR/photos/événements temporels) et appelle systématiquement
 * `persistAfterDrag()` (resync DOM→Store PLEINE FORME + rafraîchissement de
 * l'articulation) à chaque `dragend` — sans rapport avec une simple liste de
 * 8 sections. Reprendre la classe `.draggable` ferait donc déclencher CE
 * mécanisme en plus du nôtre pour un gain nul. Le calcul de position au
 * survol suit le MÊME algorithme que `getDragAfterElement` (`@oi/outils.js`,
 * repris par `articulation.ts`), réécrit ici en quelques lignes sur une
 * classe CSS locale pour rester détaché de ce mécanisme global.
 */
import {
    OI_PDF_DEFAULT_SECTION_ORDER,
    OI_PDF_LOCKED_SECTION_ID,
    OI_PDF_SECTION_LABELS,
    resolveOiPdfSectionOrder,
} from '@oi/pdf/document-builder.js';
import { Store } from '@oi/init.js';
import { PDFEngineV2 } from '@oi/pdf-engine-v2.js';

const LIST_ID = 'pdfSectionOrderList';
const PANEL_ID = 'pdfSectionOrderPanel';
const TOGGLE_BTN_ID = 'pdfSectionOrderToggleBtn';
const RESET_BTN_ID = 'pdfSectionOrderResetBtn';
const ROW_CLASS = 'pdf-section-order-row';
const DRAGGING_CLASS = 'is-dragging';

function currentOrder(): string[] {
    return resolveOiPdfSectionOrder(Store.state.formData.pdf_section_order);
}

/** Écrit l'ordre choisi dans le formulaire (persistance normale, `Store`
 * réactif) puis régénère l'aperçu affiché. Jamais appelée pendant un
 * glisser en cours — seulement au relâchement (`dragend`) ou au clic d'un
 * bouton monter/descendre/réinitialiser. */
function commitOrder(order: string[]): void {
    Store.state.formData.pdf_section_order = order;
    void PDFEngineV2.openPreview();
}

/** Lit l'ordre affiché directement depuis le DOM (source de vérité après un
 * glisser : les lignes ont déjà été réordonnées visuellement au survol). */
function readOrderFromDom(list: HTMLElement): string[] {
    return [...list.querySelectorAll<HTMLElement>(`[data-section-id]`)]
        .map((el) => el.dataset.sectionId)
        .filter((id): id is string => id !== undefined);
}

/** Même algorithme que `getDragAfterElement` (`@oi/outils.js`) — réécrit
 * localement (cf. JSDoc en tête de fichier) pour rester sur une classe CSS
 * propre à ce panneau, jamais `.draggable`. La ligne verrouillée est exclue
 * des candidats : rien ne peut jamais être inséré avant elle. */
function findAfterElement(list: HTMLElement, y: number): HTMLElement | undefined {
    const candidates = [...list.querySelectorAll<HTMLElement>(`.${ROW_CLASS}:not(.${DRAGGING_CLASS})`)]
        .filter((el) => el.dataset.sectionId !== OI_PDF_LOCKED_SECTION_ID);
    return candidates.reduce<{ offset: number; element?: HTMLElement }>(
        (closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset, element: child };
            return closest;
        },
        { offset: Number.NEGATIVE_INFINITY },
    ).element;
}

function moveRow(id: string, direction: -1 | 1): void {
    const order = currentOrder();
    const idx = order.indexOf(id);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= order.length) return;
    const a = order[idx];
    const b = order[targetIdx];
    // b === OI_PDF_LOCKED_SECTION_ID : jamais permuter avec la ligne verrouillée.
    if (a === undefined || b === undefined || b === OI_PDF_LOCKED_SECTION_ID) return;
    order[idx] = b;
    order[targetIdx] = a;
    commitOrder(order);
    renderPdfSectionOrderPanel();
    document
        .querySelector<HTMLElement>(`.${ROW_CLASS}[data-section-id="${id}"] .pdf-section-order-move-btn[data-move="${direction}"]`)
        ?.focus();
}

function buildMoveButton(id: string, label: string, direction: -1 | 1, disabled: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pdf-section-order-move-btn';
    btn.dataset.move = String(direction);
    btn.disabled = disabled;
    btn.setAttribute('aria-label', `${direction === -1 ? 'Monter' : 'Descendre'} la section ${label}`);
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = direction === -1 ? 'arrow_upward' : 'arrow_downward';
    btn.appendChild(icon);
    btn.addEventListener('click', () => moveRow(id, direction));
    return btn;
}

/** `movableIndex` : rang de `id` PARMI les seules sections déplaçables
 * (verrouillée exclue) — pilote la désactivation des boutons aux bornes. */
function buildRow(id: string, movableIndex: number, movableTotal: number): HTMLLIElement {
    const locked = id === OI_PDF_LOCKED_SECTION_ID;
    const label = OI_PDF_SECTION_LABELS[id] ?? id;

    const li = document.createElement('li');
    li.className = locked ? `${ROW_CLASS} ${ROW_CLASS}--locked` : ROW_CLASS;
    li.dataset.sectionId = id;

    const handle = document.createElement('span');
    handle.className = 'material-symbols-outlined pdf-section-order-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = locked ? 'lock' : 'drag_indicator';
    li.appendChild(handle);

    const labelEl = document.createElement('span');
    labelEl.className = 'pdf-section-order-label';
    labelEl.textContent = label;
    li.appendChild(labelEl);

    if (locked) {
        const tag = document.createElement('span');
        tag.className = 'pdf-section-order-locked-tag';
        tag.textContent = 'position fixe';
        li.appendChild(tag);
        return li;
    }

    li.draggable = true;
    li.addEventListener('dragstart', (e) => {
        li.classList.add(DRAGGING_CLASS);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
        li.classList.remove(DRAGGING_CLASS);
        const list = li.parentElement;
        if (list) commitOrder(readOrderFromDom(list));
    });

    const moveBtns = document.createElement('div');
    moveBtns.className = 'pdf-section-order-move-btns';
    moveBtns.appendChild(buildMoveButton(id, label, -1, movableIndex <= 0));
    moveBtns.appendChild(buildMoveButton(id, label, 1, movableIndex >= movableTotal - 1));
    li.appendChild(moveBtns);

    return li;
}

/** Câblée UNE fois par élément `<ol>` (drapeau `dataset.wired`, même
 * précédent que `ensurePreviewCloseCleanup`, `pdf-engine-v2.ts`) : seuls les
 * enfants sont reconstruits à chaque rendu, pas ce conteneur. */
function wireList(list: HTMLElement): void {
    if (list.dataset.wired === '1') return;
    list.dataset.wired = '1';
    list.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = list.querySelector<HTMLElement>(`.${ROW_CLASS}.${DRAGGING_CLASS}`);
        if (!dragging) return;
        const after = findAfterElement(list, e.clientY);
        if (after == null) list.appendChild(dragging);
        else list.insertBefore(dragging, after);
    });
}

/** Reconstruit la liste depuis l'ordre effectif courant (`Store` +
 * `resolveOiPdfSectionOrder`) — appelée à l'ouverture de la modale et après
 * chaque changement (glisser, bouton, réinitialisation). No-op si le
 * panneau n'est pas dans le DOM (garde standard du fichier, cf.
 * `runOpenPreview`, `pdf-engine-v2.ts`). */
export function renderPdfSectionOrderPanel(): void {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    wireList(list);

    const order = currentOrder();
    const movable = order.filter((id) => id !== OI_PDF_LOCKED_SECTION_ID);
    list.innerHTML = '';
    order.forEach((id) => {
        const movableIndex = movable.indexOf(id);
        list.appendChild(buildRow(id, movableIndex, movable.length));
    });
}

/** Bouton « Réinitialiser l'ordre » — restaure `OI_PDF_DEFAULT_SECTION_ORDER`. */
export function resetPdfSectionOrder(): void {
    commitOrder([...OI_PDF_DEFAULT_SECTION_ORDER]);
    renderPdfSectionOrderPanel();
}

function wireToggle(): void {
    const btn = document.getElementById(TOGGLE_BTN_ID);
    const panel = document.getElementById(PANEL_ID);
    if (!btn || !panel || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
        const open = panel.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', String(open));
    });
}

function wireReset(): void {
    const btn = document.getElementById(RESET_BTN_ID);
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => resetPdfSectionOrder());
}

/** Idempotente — appelée à chaque ouverture de `#presentationModal`
 * (`openPresentationMode`, `presentation.ts`) : câble les écouteurs une
 * seule fois (drapeaux `dataset.wired`) et rafraîchit toujours la liste
 * affichée depuis l'ordre effectif courant. */
export function initPdfSectionOrderPanel(): void {
    wireToggle();
    wireReset();
    renderPdfSectionOrderPanel();
}
