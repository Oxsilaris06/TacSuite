/**
 * drag-drop.ts — Glisser-déposer natif (HTML5) + émulation tactile (touch),
 * FUSION drag.js + patrac.js (P3.CONV, paquet `oi-drag-drop`).
 * ===========================================================================
 *
 * Port TypeScript VERBATIM de `modules/drag.js` (GStart-main, lecture seule,
 * 370 LOC intégral) : état de module `touchDragItem`/`touchDragClone`/
 * `touchStartX`/`touchStartY` (:7-10), `persistAfterDrag` (:12-20),
 * `handleTouchStart` (:22-54), `handleTouchMove` (:56-89), `handleTouchEnd`
 * (:91-151), `handleDragEnter` (:153-167), `handleDragOver` (:169-209),
 * `handleDragLeave` (:211-218), `handleDrop` (:220-266), `handleDeleteDrop`
 * (:268-292), `initializeDragDropListeners` (:294-334),
 * `documentDragTransferInitialized` + `initDocumentDragTransfer` (:340-366).
 *
 * MISSION DE FUSION EXPLICITE (PLAN.md §7, SPEC-OI-CONVERSION.md §5 —
 * SEUL paquet autorisé à restructurer, et uniquement sur ce point précis) :
 * deux exports internes NOUVEAUX (n'existent pas dans l'original), non posés
 * sur `window`, qui factorisent les 2 sites de câblage dupliqués
 * `drag.js` / `patrac.js` :
 *  - `wireDropContainer` factorise les 4 `addEventListener`
 *    dragenter/dragleave/dragover/drop identiques entre `drag.js:301-306`
 *    (init statique) ET `patrac.js:76-79` (par-véhicule dynamique,
 *    `addPatracdvrRow`). `initializeDragDropListeners()` l'appelle sur les 2
 *    conteneurs statiques ; `patrac.ts` l'appellera sur chaque conteneur de
 *    membres de véhicule créé dynamiquement.
 *  - `wireDraggableMember` factorise les 3 `addEventListener`
 *    touchstart/touchmove/touchend de `patrac.js:224-226`
 *    (`addPatracdvrMember`), avec `{ passive: false }` sur les 2 premiers —
 *    exactement comme l'original.
 * Le `dragover` ad hoc de `#time_events_container` (`drag.js:308-327`) et les
 * 2 listeners (`dragover`+`drop` seulement) de chaque `.image-preview-container`
 * (`drag.js:329-334`) NE SONT PAS le motif à 4 listeners : ils restent écrits
 * tels quels dans `initializeDragDropListeners`, PAS via `wireDropContainer`.
 *
 * CONTRAT PUBLIC INCHANGÉ (`OiDragGlobals`, figé par P1.A0) :
 * `window.initializeDragDropListeners()` et `window.initDocumentDragTransfer()`
 * restent les 2 SEULES fonctions posées sur `window`.
 *
 * DÉCISION D'ARCHITECTURE ACTÉE (SPEC §5.3, non rediscutée) : `persistAfterDrag`
 * garde sa signature d'origine À ZÉRO ARGUMENT (PAS de paramètre `onAfter` /
 * callback — la proposition du brouillon est REJETÉE, elle causerait une
 * régression majeure : `persistAfterDrag` est appelée 7 fois DEPUIS ce fichier
 * lui-même, contre 2 fois seulement depuis `patrac.js`/`patrac.ts`, cf.
 * `patrac.js:649,674`). Elle résout ses deux dépendances PAR `window`, avec
 * les gardes d'origine (`drag.js:12-20`, RÈGLE D'OR SPEC §2.2) — ceci garantit
 * aussi que `syncDomToStore` désigne bien la version DÉBOUNCÉE posée par
 * `formulaires.ts` (piège `formulaires.js:392`). `updateArticulationDisplay`
 * reste dans `patrac.ts` (contrat `OiPatracGlobals` figé) ; `getDragAfterElement`
 * est IMPORTÉE de `@oi/outils.js` (drag.js:181,317), PAS redéfinie ;
 * `activeMemberId` (réassignée 4× : drag.js:114,141,254,285) vient de
 * `oiState.activeMemberId` (`@oi/state.js`) ; `updateMemberButtonVisuals`
 * (drag.js:138,249) est cross-module ET exposée sur `window`
 * (`OiPatracGlobals`) ⇒ `window.updateMemberButtonVisuals` (RÈGLE D'OR §2.2).
 * `documentDragTransferInitialized` (drag.js:340) reste un état de module
 * LOCAL à ce fichier (jamais réassigné ailleurs ⇒ pas dans `state.ts`).
 *
 * Adaptations de TYPAGE PUR (aucun changement de comportement observable) :
 *  - `TouchList[0]` / `document.getElementById(...)` / `Element.closest(...)`
 *    sont `T | undefined` / `T | null` sous `strict` +
 *    `noUncheckedIndexedAccess` ; l'original les lit sans garde là où le
 *    navigateur les garantit toujours présents en pratique (≥1 touch pour un
 *    `touchstart`/`touchmove`/`touchend`, `#quickEditPanel` toujours dans le
 *    DOM) — gardes ajoutées (`if (!x) return;` / `if (x) …`), jamais
 *    empruntées en pratique, même précédent que `getEventPos`
 *    (`outils.ts:113`) et `articulation.ts` (en-tête).
 *  - `e.target`/`e.currentTarget` sont `EventTarget | null` côté
 *    `Touch/DragEvent` ; `e.dataTransfer` est `DataTransfer | null` — cast
 *    unique réutilisé (accès multiples au même événement) ou cast ponctuel
 *    (accès unique), même précédent que `@pctac/ui.ts:317-319,704,703`.
 *  - `Element.closest(selectors: string)` retombe sur le surcharge générique
 *    `E extends Element = Element` : `closest<HTMLElement>(...)` explicite
 *    partout où `.style`/`.dataset` est lu ensuite sur le résultat.
 *  - `document.querySelectorAll(...)` : générique `<HTMLElement>` explicite
 *    partout où `.style` est écrit sur les éléments itérés (précédent
 *    `articulation.ts`, `outils.ts:284`).
 *  - `[...].filter(Boolean)` (drag.js:299, conteneurs statiques potentiellement
 *    absents) → prédicat de type explicite `(el): el is HTMLElement =>
 *    Boolean(el)`, même filtrage, même précédent qu'`articulation.ts:495-500`.
 *  - `target.cloneNode(true)` retourne `Node` côté lib.dom.d.ts (signature
 *    générique) ; le clone est structurellement identique à `target:
 *    HTMLElement` (`cloneNode(true)` = copie profonde) — cast `as HTMLElement`.
 *  - Le `reduce` de réordonnancement des photos (drag.js:192-201) : générique
 *    explicite `reduce<{ offset: number; element?: HTMLElement }>`, même
 *    précédent que `getDragAfterElement` (`outils.ts:290`).
 *
 * Source : `/home/nico/Bureau/Web/GStart-main/modules/drag.js` (lecture
 * seule). Cf. `docs/SPEC-OI-CONVERSION.md` §5, `PAQUETS-OI.json`
 * (`oi-drag-drop`).
 */

import { getDragAfterElement } from '@oi/outils.js';
import { oiState } from '@oi/state.js';

// ==================== DragDrop.js ====================
// drag.js:7-10 — état de module (jamais dans state.ts : local à ce fichier).
let touchDragItem: HTMLElement | null = null;
let touchDragClone: HTMLElement | null = null;
let touchStartX = 0;
let touchStartY = 0;
// drag.js:9-10 — assignées dans handleTouchStart (:34-35) mais jamais LUES
// nulle part dans l'original (dead state, pas un oubli de portage) ;
// référence `void` pour satisfaire `noUnusedLocals` sans changer le
// comportement, même précédent que `@pctac/tchap-live.ts:1266-1270`.
void touchStartX;
void touchStartY;

// drag.js:12-20 — VERBATIM (résolution tardive par window, RÈGLE D'OR SPEC §2.2).
function persistAfterDrag(): void {
    if (typeof window.syncDomToStore === 'function') window.syncDomToStore();
    else if (typeof window.Store?.saveToStorage === 'function') window.Store.saveToStorage();

    // NOUVEAU: Déclenche la mise à jour proactive de l'Articulation (Step 6)
    if (typeof window.updateArticulationDisplay === 'function') {
        window.updateArticulationDisplay();
    }
}

// drag.js:22-54
function handleTouchStart(e: TouchEvent): void {
    // Proposition 4 — en mode « déplacement groupé », le tap sert à (dé)sélectionner :
    // on neutralise le glisser-déposer tactile pour éviter tout conflit de geste.
    if (document.body.classList.contains('patrac-batch-mode')) return;

    // drag.js:22 — `e.target` est `EventTarget | null` en TS ; l'original le
    // lit sans garde (toujours un Element en pratique pour un `touchstart`
    // sur un bouton membre) — cast unique réutilisé (accès multiples).
    const eventTarget = e.target as HTMLElement;

    // Si on touche le bouton de suppression ou d'édition à l'intérieur, on ne drag pas
    if (eventTarget.classList.contains('remove-btn') || eventTarget.closest('.remove-btn')) return;

    const target = eventTarget.closest<HTMLElement>('.draggable');
    if (!target) return;

    // drag.js:34-35 — `TouchList[0]` est `Touch | undefined` sous
    // `noUncheckedIndexedAccess` ; un `touchstart` garantit toujours ≥1 touch
    // (spec Touch Events) — garde jamais empruntée en pratique, même idiome
    // que `getEventPos` (`outils.ts:113`).
    const touch = e.touches[0];
    if (!touch) return;

    touchDragItem = target;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    // Créer un clone visuel pour suivre le doigt
    // drag.js:38 — `cloneNode` retourne `Node` en TS ; copie profonde d'un
    // `HTMLElement` ⇒ structurellement identique, cast `as HTMLElement`.
    touchDragClone = target.cloneNode(true) as HTMLElement;
    touchDragClone.style.position = 'fixed';
    touchDragClone.style.zIndex = '9999';
    touchDragClone.style.opacity = '0.8';
    touchDragClone.style.width = target.offsetWidth + 'px';
    touchDragClone.style.pointerEvents = 'none'; // Important pour détecter l'élément dessous
    touchDragClone.classList.add('dragging');

    // Position initiale hors écran pour éviter le flash
    touchDragClone.style.left = '-9999px';
    touchDragClone.style.top = '-9999px';

    document.body.appendChild(touchDragClone);

    // Feedback visuel sur l'original
    target.style.opacity = '0.4';
}

// drag.js:56-89
function handleTouchMove(e: TouchEvent): void {
    if (!touchDragItem || !touchDragClone) return;

    // Empêcher le scroll de la page pendant le drag
    if (e.cancelable) e.preventDefault();

    // drag.js:62 — même garde que handleTouchStart (jamais empruntée en pratique).
    const touch = e.touches[0];
    if (!touch) return;

    // Déplacer le clone
    touchDragClone.style.left = (touch.clientX - (touchDragClone.offsetWidth / 2)) + 'px';
    touchDragClone.style.top = (touch.clientY - (touchDragClone.offsetHeight / 2)) + 'px';

    // Identifier la zone de drop sous le doigt
    touchDragClone.style.display = 'none'; // Cacher brièvement pour voir dessous
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    touchDragClone.style.display = 'block';

    if (!elemBelow) return;

    // Trouver le conteneur valide le plus proche (Véhicule, Non assigné ou Poubelle)
    const droppableBelow = elemBelow.closest<HTMLElement>('.patracdvr-members-container, #unassigned_members_container, #trashCan');

    // Gestion visuelle des bordures (Feedback)
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll<HTMLElement>('.patracdvr-members-container, #unassigned_members_container').forEach(el => el.style.border = '1px dashed var(--border-color)');

    if (droppableBelow) {
        if (droppableBelow.id === 'trashCan') {
            droppableBelow.classList.add('drag-over');
        } else {
            droppableBelow.style.border = '2px dashed var(--accent-blue)';
        }
    }
}

// drag.js:91-151
function handleTouchEnd(e: TouchEvent): void {
    if (!touchDragItem) return;

    // drag.js:94 — `TouchList[0]` (changedTouches) : même garde que
    // handleTouchStart/handleTouchMove, jamais empruntée en pratique.
    const touch = e.changedTouches[0]; // Position finale
    if (!touch) return;

    // Nettoyage visuel
    if (touchDragClone) touchDragClone.remove();
    touchDragItem.style.opacity = '1';

    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll<HTMLElement>('.patracdvr-members-container, #unassigned_members_container').forEach(el => el.style.border = '1px dashed var(--border-color)');

    // Identifier la cible finale
    // drag.js:104 — `x && (x.prop = …)` (expression-statement) rejeté par
    // `@typescript-eslint/no-unused-expressions` ; réécrit en `if`, même
    // effet exact (court-circuit ⇔ garde).
    if (touchDragClone) touchDragClone.style.display = 'none'; // Juste au cas où
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);

    // 1. Gestion Drop : POUBELLE
    const trashCan = elemBelow ? elemBelow.closest('#trashCan') : null;
    if (trashCan) {
        if (confirm(`Voulez-vous vraiment SUPPRIMER DÉFINITIVEMENT le membre ${touchDragItem.dataset.trigramme || 'N/A'} ?`)) {
            const memberId = touchDragItem.id;
            touchDragItem.remove();
            if (oiState.activeMemberId === memberId) {
                oiState.activeMemberId = null;
                // drag.js:115 — `#quickEditPanel` est toujours dans le DOM en
                // pratique ; garde ajoutée pour `HTMLElement | null` strict.
                const quickEditPanel = document.getElementById('quickEditPanel');
                if (quickEditPanel) quickEditPanel.style.display = 'none';
            }
            persistAfterDrag();
        }
    }
    // 2. Gestion Drop : CONTENEURS (Véhicules ou Non assigné)
    else {
        const dropContainer = elemBelow ? elemBelow.closest<HTMLElement>('.patracdvr-members-container, #unassigned_members_container') : null;

        if (dropContainer) {
            // Logique d'insertion (similaire à handleDrop PC)
            dropContainer.appendChild(touchDragItem);

            const isUnassignedZone = dropContainer.id === 'unassigned_members_container';
            if (isUnassignedZone) {
                touchDragItem.dataset.cellule = 'Sans';
                touchDragItem.dataset.fonction = 'Sans';
            } else {
                if (touchDragItem.dataset.cellule === 'Sans') {
                    touchDragItem.dataset.cellule = 'India 1';
                }
            }

            window.updateMemberButtonVisuals(touchDragItem);
            if (touchDragItem.id === oiState.activeMemberId) {
                touchDragItem.classList.remove('member-active');
                oiState.activeMemberId = null;
                const quickEditPanel = document.getElementById('quickEditPanel');
                if (quickEditPanel) quickEditPanel.style.display = 'none';
            }
            persistAfterDrag();
        }
    }

    // Reset variables
    touchDragItem = null;
    touchDragClone = null;
}

// drag.js:153-167
function handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    const targetContainer = e.currentTarget as HTMLElement;

    // FIX: Utilisation de .dragging car dataTransfer.getData n'est pas accessible ici
    const draggedItem = document.querySelector('.dragging');

    if (draggedItem && draggedItem.classList.contains('patracdvr-member-btn')) {
        if (targetContainer.id === 'trashCan') {
            targetContainer.classList.add('drag-over');
        } else {
            targetContainer.style.border = '2px dashed var(--accent-blue)';
        }
    }
}

// drag.js:169-209
function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    const targetContainer = e.currentTarget as HTMLElement;
    // FIX: Utilisation de .dragging car dataTransfer.getData n'est pas accessible ici
    const draggedItem = document.querySelector('.dragging');

    if (!draggedItem) return;

    // Gestion Drop Membres
    if (draggedItem.classList.contains('patracdvr-member-btn')) {
        if (targetContainer.id !== 'trashCan') {
            // Pour insérer le membre à l'endroit approprié dans le conteneur
            const afterElement = getDragAfterElement(targetContainer, e.clientY);

            if (afterElement == null) {
                targetContainer.appendChild(draggedItem);
            } else {
                targetContainer.insertBefore(draggedItem, afterElement);
            }
        }
    }
    // NOUVEAU: Gestion Drop Photos (Réorganisation)
    else if (draggedItem.classList.contains('image-preview-item') && targetContainer.classList.contains('image-preview-container')) {
        const draggableElements = [...targetContainer.querySelectorAll<HTMLElement>('.image-preview-item:not(.dragging)')];
        // drag.js:192-201 — même précédent que `getDragAfterElement`
        // (`outils.ts:290`) : accumulateur initial sans `.element`.
        const afterElement = draggableElements.reduce<{ offset: number; element?: HTMLElement }>((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientX - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        if (afterElement == null) {
            targetContainer.appendChild(draggedItem);
        } else {
            targetContainer.insertBefore(draggedItem, afterElement);
        }
    }
}

// drag.js:211-218
function handleDragLeave(e: DragEvent): void {
    const targetContainer = e.currentTarget as HTMLElement;
    if (targetContainer.id === 'trashCan') {
        targetContainer.classList.remove('drag-over');
    } else {
        targetContainer.style.border = '1px dashed var(--border-color)';
    }
}

// drag.js:220-266
function handleDrop(e: DragEvent): void {
    e.preventDefault();
    const targetContainer = e.currentTarget as HTMLElement;
    const draggedId = (e.dataTransfer as DataTransfer).getData('text/plain');
    const draggedItem = document.getElementById(draggedId);

    if (targetContainer.id === 'trashCan') {
        handleDeleteDrop(e);
        return;
    }

    targetContainer.style.border = '1px dashed var(--border-color)';

    if (draggedItem && draggedItem.classList.contains('patracdvr-member-btn')) {
        // L'ordre a déjà été géré dans handleDragOver, on s'assure juste du parentage
        targetContainer.appendChild(draggedItem);

        const isUnassignedZone = targetContainer.id === 'unassigned_members_container';

        if (isUnassignedZone) {
            draggedItem.dataset.cellule = 'Sans';
            draggedItem.dataset.fonction = 'Sans';
        } else {
            // Si on déplace vers un véhicule, on réattribue une cellule par défaut si elle était "Sans"
            if (draggedItem.dataset.cellule === 'Sans') {
                draggedItem.dataset.cellule = 'India 1';
            }
        }

        window.updateMemberButtonVisuals(draggedItem);

        // Désélectionner le membre actif si déplacé
        if (draggedItem.id === oiState.activeMemberId) {
            draggedItem.classList.remove('member-active');
            oiState.activeMemberId = null;
            if (window.innerWidth >= 768) {
                const quickEditPanel = document.getElementById('quickEditPanel');
                if (quickEditPanel) quickEditPanel.style.display = 'none';
            }
        }

        // CONFORMITÉ: Sauvegarde après le changement de conteneur/statut
        persistAfterDrag();
    } else if (draggedItem && draggedItem.classList.contains('image-preview-item')) {
        // Pour les photos, le DOM est déjà mis à jour par dragOver
        persistAfterDrag();
    }
}

// drag.js:268-292
function handleDeleteDrop(e: DragEvent): void {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drag-over');

    // Récupération de l'élément draggé
    const draggedId = (e.dataTransfer as DataTransfer).getData('text/plain');
    const draggedItem = document.getElementById(draggedId);

    if (draggedItem && draggedItem.classList.contains('patracdvr-member-btn')) {
        // Utilisation d'un `confirm` natif
        const confirmation = confirm(`Voulez-vous vraiment SUPPRIMER DÉFINITIVEMENT le membre ${draggedItem.dataset.trigramme || 'N/A'} de la session ?`);

        if (confirmation) {
            const memberId = draggedItem.id;
            draggedItem.remove();

            if (oiState.activeMemberId === memberId) {
                oiState.activeMemberId = null;
                const quickEditPanel = document.getElementById('quickEditPanel');
                if (quickEditPanel) quickEditPanel.style.display = 'none';
            }
            // CONFORMITÉ: Sauvegarde après suppression définitive
            persistAfterDrag();
        }
    }
}

/**
 * FUSION (mission `oi-drag-drop`, SPEC §5.2) — factorise les 4
 * `addEventListener` dragenter/dragleave/dragover/drop identiques entre
 * `drag.js:301-306` (init statique, `initializeDragDropListeners` ci-dessous)
 * ET `patrac.js:76-79` (par-véhicule dynamique, `addPatracdvrRow` dans
 * `patrac.ts`). Export interne NOUVEAU, non posé sur `window`.
 */
export function wireDropContainer(container: HTMLElement): void {
    container.addEventListener('dragenter', handleDragEnter);
    container.addEventListener('dragleave', handleDragLeave);
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
}

/**
 * FUSION (mission `oi-drag-drop`, SPEC §5.2) — factorise les 3
 * `addEventListener` touchstart/touchmove/touchend de `patrac.js:224-226`
 * (`addPatracdvrMember` dans `patrac.ts`), avec `{ passive: false }` sur les
 * 2 premiers, exactement comme l'original. Export interne NOUVEAU, non posé
 * sur `window`.
 */
export function wireDraggableMember(btn: HTMLElement): void {
    btn.addEventListener('touchstart', handleTouchStart, { passive: false });
    btn.addEventListener('touchmove', handleTouchMove, { passive: false });
    btn.addEventListener('touchend', handleTouchEnd);
}

// drag.js:294-334
function initializeDragDropListeners(): void {
    // Conteneurs statiques (uniquement ceux qui existent au chargement initial)
    // drag.js:299 — `.filter(Boolean)` → prédicat de type explicite, même
    // filtrage (précédent `articulation.ts:495-500`).
    const staticDropContainers = [
        document.getElementById('unassigned_members_container'),
        document.getElementById('trashCan'),
    ].filter((el): el is HTMLElement => Boolean(el));

    // drag.js:301-306 — motif à 4 listeners, factorisé via wireDropContainer (SPEC §5.2).
    staticDropContainers.forEach(container => wireDropContainer(container));

    // Écouteur global pour le dragover des éléments de temps (à l'intérieur de leur conteneur)
    // drag.js:308-327 — NE FAIT PAS PARTIE du motif à 4 listeners : reste tel quel.
    const timeEventsEl = document.getElementById('time_events_container');
    if (timeEventsEl) {
        timeEventsEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggedItem = document.querySelector('.dragging');
            const targetContainer = e.currentTarget as HTMLElement;

            if (draggedItem && draggedItem.classList.contains('time-item')) {
                const afterElement = getDragAfterElement(targetContainer, e.clientY);

                if (afterElement == null) {
                    targetContainer.appendChild(draggedItem);
                } else {
                    targetContainer.insertBefore(draggedItem, afterElement);
                }
                persistAfterDrag();
            }
        });
    }

    // NOUVEAU: Écouteurs pour les galeries d'images (dragover pour permettre le drop)
    // drag.js:329-334 — SEULEMENT 2 listeners (dragover + drop) : NE FAIT PAS
    // PARTIE du motif à 4 listeners, reste tel quel (PAS wireDropContainer).
    document.querySelectorAll<HTMLElement>('.image-preview-container').forEach(container => {
        container.addEventListener('dragover', handleDragOver);
        container.addEventListener('drop', handleDrop);
    });
}

/**
 * Même logique que 4.html : sans dragstart sur document, dataTransfer / .dragging ne sont pas gérés
 * (boutons draggable, items photo, etc.).
 */
// drag.js:340 — état de module local (jamais dans state.ts).
let documentDragTransferInitialized = false;
// drag.js:341-366
function initDocumentDragTransfer(): void {
    if (documentDragTransferInitialized) return;
    documentDragTransferInitialized = true;

    document.addEventListener('dragstart', (e) => {
        // drag.js:346 — `e.target` accédé 3×, cast unique réutilisé (même
        // précédent que handleTouchStart ci-dessus).
        const eventTarget = e.target as HTMLElement;
        const target = eventTarget.closest<HTMLElement>('.draggable');

        if (!target) {
            if (eventTarget.tagName === 'BUTTON' || eventTarget.closest('button')) {
                e.preventDefault();
            }
            return;
        }

        (e.dataTransfer as DataTransfer).setData('text/plain', target.id);
        setTimeout(() => target.classList.add('dragging'), 0);
    });

    document.addEventListener('dragend', (e) => {
        const eventTarget = e.target as HTMLElement;
        const draggedItem = eventTarget.closest<HTMLElement>('.draggable');
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            persistAfterDrag();
        }
    });
}

window.initializeDragDropListeners = initializeDragDropListeners;
window.initDocumentDragTransfer = initDocumentDragTransfer;
