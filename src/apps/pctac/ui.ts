/**
 * ui.ts — Contrôleur UI central de PC-Tac
 * ============================================================
 *
 * Port TypeScript de `modules/pctac/ui.js` (GStart-main, 890 LOC) — module le
 * plus DOM-lourd hors `planMap.js` : refs DOM, rendu du journal + drag&drop,
 * navigation d'onglets, CRUD des 4 collections, modales d'édition, palettes,
 * thème, plein écran, recherche.
 *
 * Contrat : UIContract (src/shared/types/contracts.ts:599-680)
 * Conventions : stratégie onclick conservée, `window.*` au scope module,
 * accès localStorage directs conservés.
 *
 * POINT CRUCIAL : les `onclick="..."` générés
 * en `innerHTML` NE CHANGENT PAS dans ce paquet — ils sont portés VERBATIM, et
 * les façades `window.UI` / `window.openEditModal` / `window.deleteLogEntry` /
 * `window.deleteCollectionItem` sont MAINTENUES. La migration vers
 * `data-action` est faite en P2.D par un autre agent.
 *
 * SUPPRESSION IMPOSÉE : la branche `viewId === 'view-dashboard'` de
 * `switchMainView` (ui.js:110-113) — `window.Dashboard` est du code mort
 * prouvé (SPEC-PCTAC-CONVERSION.md §1.3), non déclaré dans global.d.ts ; la
 * branche ne compilerait pas.
 *
 * Adaptations de TYPAGE PUR appliquées (aucun changement de comportement
 * observable ; même principe déjà en place dans planmap/chrome.ts et
 * planmap/text-modal.ts) :
 *  - `document.getElementById(...)`/`document.querySelector(...)` retourne un
 *    type nullable ou trop générique (`Element`) en TS strict : là où
 *    l'original accède directement sans garde (ex. `document.getElementById(
 *    'edit_id').value = id`), le port utilise un cast `as HTMLInputElement`
 *    (jamais `!`) — le comportement runtime (TypeError si l'élément est
 *    absent) reste identique. Là où l'original garde explicitement
 *    (`if (this.elements.paxInput) ...`), le port garde à l'identique.
 *  - `document.querySelectorAll(...)` typé via le paramètre générique
 *    (`querySelectorAll<HTMLElement>(...)`) quand `.dataset`/`.style`/
 *    `.value` sont utilisés (ces membres n'existent pas sur `Element`).
 *  - Capture dans une `const` locale avant fermeture imbriquée
 *    (`initPaxModeAndColors`, `renderLogTable`) : le narrowing TS d'une
 *    propriété (`this.elements.x`) ne traverse pas une frontière de fonction
 *    imbriquée, contrairement à une variable locale immuable — même valeur,
 *    même comportement.
 *  - Accès aux champs dynamiques de `PctacCollectionItem` (`[key: string]:
 *    unknown`) via `(item.champ as string | undefined) || ''` — même idiome
 *    que `archive.ts` (`a.nom as string | undefined`).
 *  - `String(el.dataset.xxx)` pour les affectations exigeant `string` :
 *    reproduit la coercion native `ToString`, même idiome que
 *    `planmap/chrome.ts`.
 *  - `PDF_PAX_COLORS[entry.pax] ?? PDF_PAX_COLORS['Adversaire']` : garde
 *    `if (!paxInfo) return;` imposée par `noUncheckedIndexedAccess`, branche
 *    jamais atteinte en pratique ('Adversaire' existe toujours dans
 *    `config.ts`) — même idiome que `pdf-export.ts` (`PDF_PAX_COLORS[x] ??
 *    PDF_PAX_COLORS['Autre']`).
 *
 * ÉCART SIGNALÉ (pas une modification de contracts.ts) : l'original pose un
 * drapeau dynamique `this._logDndBound` (ui.js:246, 249) absent de
 * `UIContract` — l'ajouter au littéral `UI` déclencherait une erreur TS
 * (« excess property »). Le port utilise donc une variable de MODULE
 * (`logDndBound`, scope fichier) au lieu d'une propriété de l'objet exporté :
 * même sémantique de singleton (un seul binding par cycle de vie de la page),
 * strictement même comportement observable. Ce fichier n'a pas modifié
 * `contracts.ts` (interdit par la mission) ; à signaler au gate.
 */

import type { PctacLogEntry, PctacPhotoCategory, UIContract } from '@shared/types/contracts.js';
import { PDF_PAX_COLORS, FREE_MODE_COLORS, LONG_PRESS_DELAY, PHOTO_CATEGORIES, hostageStatusFromBlessures } from '@pctac/config.js';
import { Storage } from '@pctac/storage.js';
import { ImageStore } from '@pctac/image-store.js';
import { LogManager } from '@pctac/log-manager.js';
import { esc } from '@shared/ui-platform.js';
import { confirmDialog, promptDialog, toast } from '@shared/feedback.js';
import { currentMode, currentModeId } from '@pctac/modes.js';
import {
  ageFromDob,
  defaultStatus,
  ficheCounters,
  ficheTitle,
  ficheVariant,
  filledSections,
  sortFichesByPriority,
  statusChoices,
  statusMeta,
  summaryRows,
  type FicheSide,
  type StatusChoice,
} from '@pctac/fiche.js';
import { close as closeFicheSheet, openFiche } from '@pctac/fiche-sheet.js';
import { annotatePhoto } from '@pctac/photo-annotation.js';

/** Options de statut d'une fiche : celles de la situation, plus la valeur
 *  courante si elle vient d'ailleurs (jamais remplacée en silence). */
function statusOptionsFor(side: FicheSide, current: string): string {
  const mode = currentModeId();
  const choices: StatusChoice[] = statusChoices(side, mode);
  const list = choices.some((c) => c.key === current) ? choices : [statusMeta(side, mode, current), ...choices];
  return list.map((c) => `<option value="${esc(c.key)}"${c.key === current ? ' selected' : ''}>${c.symbol} ${esc(c.label)}</option>`).join('');
}

/**
 * Carte résumé d'une fiche (décision 17) : photo, nom, statut, trois faits
 * clés ; « Toute la fiche » déplie les sections remplies. Un champ vide
 * n'apparaît pas ; seuls le nom et le statut gardent « N/C ».
 */
function ficheCard(
  side: FicheSide,
  item: PctacCollectionItemLike,
  linked: string[],
  resolveLink: (id: string) => string,
): string {
  const mode = currentModeId();
  const lex = currentMode()[side];
  const id = esc(item.id);
  const status = String(item.status || defaultStatus(side, mode));
  const meta = statusMeta(side, mode, status);
  const hasStatus = statusChoices(side, mode).length > 0;
  const title = ficheTitle(side, mode, item);
  const name = title === '(sans nom)' ? 'N/C' : title;
  // Phénomène : âge et alias sont masqués dans la fiche, donc ici aussi.
  const age = ficheVariant(side, mode, item) === 'phenomene' ? null : ageFromDob(item.dob);
  const alias = ficheVariant(side, mode, item) === 'phenomene' ? '' : String(item.alias ?? '').trim();
  const sub = [age === null ? '' : `${age} ans`, alias].filter(Boolean).join(' · ');
  const facts = summaryRows(side, mode, item);
  const sections = filledSections(side, mode, item, new Date(), resolveLink);
  const photo = typeof item.photo === 'string' && item.photo
    ? `<img src="${esc(item.photo)}" alt="">`
    : `<span class="material-symbols-outlined" aria-hidden="true">${side === 'adv' ? 'person' : 'person_off'}</span>`;
  return `
    <article class="fiche-card" data-id="${id}" style="--status-color: ${hasStatus ? meta.color : 'var(--border-glass)'}">
      <div class="fiche-card-head">
        <div class="fiche-card-photo">${photo}</div>
        <div class="fiche-card-id">
          <h3 class="fiche-card-name">${esc(name)}</h3>
          ${sub ? `<p class="fiche-card-sub">${esc(sub)}</p>` : ''}
        </div>
        ${hasStatus ? `<select class="fiche-card-status" data-fiche-action="status" data-status="${esc(status)}" aria-label="Statut : ${esc(name)}">${statusOptionsFor(side, status)}</select>` : ''}
      </div>
      ${facts.length ? `<dl class="fiche-card-facts">${facts.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')}</dl>` : ''}
      ${linked.length ? `<p class="fiche-card-linked"><span class="material-symbols-outlined" aria-hidden="true">link</span>Fiches liées : ${esc(linked.join(', '))}</p>` : ''}
      ${sections.length ? `<details class="fiche-card-more"><summary>Toute la fiche</summary>${sections.map((sec) => `
        <section><h4>${esc(sec.title)}</h4><dl>${sec.rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')}</dl></section>`).join('')}
      </details>` : ''}
      <div class="fiche-card-actions">
        <button type="button" class="fiche-card-edit" data-fiche-action="edit" aria-label="Modifier ${esc(lex.demonstrative)} : ${esc(name)}"><span class="material-symbols-outlined" aria-hidden="true">edit</span>Modifier</button>
        <button type="button" class="delete-btn" data-fiche-action="delete" aria-label="Supprimer ${esc(lex.demonstrative)} : ${esc(name)}"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>
      </div>
    </article>`;
}

/**
 * Actions des cartes par délégation (revue neuve, constat XSS) : l'id de la
 * fiche ne passe JAMAIS dans du JavaScript en ligne, il est lu dans
 * `data-id` (texte, échappé) au moment du clic. Câblé une fois par liste.
 */
/**
 * Galerie Photos : « Annoter » et la visionneuse par délégation, l'id lu dans
 * `data-id` au clic (jamais d'id dans du JavaScript en ligne). Câblé une fois.
 */
function bindPhotoBoard(board: HTMLElement): void {
  if (board.dataset.photoBound) return;
  board.dataset.photoBound = '1';
  board.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.photo-card');
    const id = card?.dataset.id;
    if (!card || !id) return;
    if (target.closest('[data-photo-action="annotate"]')) {
      void annotatePhoto(id);
      return;
    }
    const img = target.closest<HTMLImageElement>('img');
    if (img) UI.openLightbox(img.src, card.querySelector('.photo-title-text')?.textContent ?? '', id);
  });
}

function bindFicheList(box: HTMLElement, side: FicheSide): void {
  if (box.dataset.ficheBound) return;
  box.dataset.ficheBound = '1';
  const key = side === 'adv' ? 'pcTacAdversaries' : 'pcTacHostages';
  const view = side === 'adv' ? 'view-adversaires' : 'view-otages';
  const idOf = (el: Element): string | undefined => el.closest<HTMLElement>('.fiche-card')?.dataset.id;
  box.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-fiche-action]');
    const id = btn ? idOf(btn) : undefined;
    if (!btn || !id) return;
    if (btn.dataset.ficheAction === 'edit') void openFiche(side, id);
    if (btn.dataset.ficheAction === 'delete') void window.deleteCollectionItem(key, id, view);
  });
  box.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const id = sel.dataset.ficheAction === 'status' ? idOf(sel) : undefined;
    if (id) UI.setItemStatus(key, id, sel.value);
  });
}

/** Compteurs « Combien », calculés depuis les deux collections. */
function renderFicheCounters(): void {
  const c = ficheCounters(currentModeId(), Storage.loadCollection('pcTacAdversaries'), Storage.loadCollection('pcTacHostages'));
  const adv = document.getElementById('adversary-counters');
  if (adv) adv.textContent = c.adv;
  const host = document.getElementById('hostage-counters');
  if (host) host.textContent = c.host;
}

/* ------------------------------------------------------------------------
 * U16/C1 — Statuts sur les FICHES (source de vérité ; la photo _sync suit).
 * Métadonnées + heuristique : voir @pctac/config.js (partagées avec
 * pdf-export.ts et main.ts).
 * ---------------------------------------------------------------------- */

/**
 * Migration douce U16 : si une fiche n'a pas de `status` mais que sa photo
 * `_sync` en porte un, on le reprend (sinon défaut). Persiste si modifié.
 */
function migrateStatuses(key: string, list: readonly { id: string; status?: unknown }[], fallback: string): void {
  const missing = list.filter((it) => !it.status);
  if (missing.length === 0) return;
  const photos = Storage.loadCollection('pcTacPhotos');
  missing.forEach((it) => {
    const photo = photos.find((p) => p.id === it.id + '_sync');
    (it as { status?: unknown }).status = (photo && photo.status) || fallback;
  });
  Storage.saveCollection(key, list as never);
}

/**
 * C5-statut — écrit le statut sur la FICHE, propage vers la photo `_sync` et
 * journalise le changement en main courante. Retourne true si changement.
 */
function setStatusOnFiche(key: string, id: string, status: string): boolean {
  const list = Storage.loadCollection(key);
  const item = list.find((i) => i.id === id);
  if (!item || item.status === status) return false;
  item.status = status;
  Storage.saveCollection(key, list);

  // La fiche est la source : la photo _sync suit (inverse du flux historique).
  const photos = Storage.loadCollection('pcTacPhotos');
  const photo = photos.find((p) => p.id === id + '_sync');
  if (photo && photo.status !== status) {
    photo.status = status;
    Storage.saveCollection('pcTacPhotos', photos);
  }

  // Entrée automatique en main courante, horodatée.
  const isAdv = key === 'pcTacAdversaries';
  const side: FicheSide = isAdv ? 'adv' : 'host';
  const meta = statusMeta(side, currentModeId(), status);
  const now = new Date();
  const heure = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  // Nom tel que la fiche l'affiche (un Phénomène n'a pas de prénom).
  const nom = ficheTitle(side, currentModeId(), item);
  // Sigle de triage (UA, EU) : jamais mis en minuscules.
  const label = meta.label === meta.label.toUpperCase() ? meta.label : meta.label.toLowerCase();
  LogManager.addEntry({
    mode: 'standard',
    pax: isAdv ? 'Adversaire' : 'Otage',
    heure,
    remarques: `${isAdv ? 'ADV' : 'OTG'} ${nom} : ${label}`,
    auto: true,
  });
  return true;
}

/* ------------------------------------------------------------------------
 * C8 — Lien adversaire ↔ otage (le champ lien otage stocke un id de fiche
 * adversaire, ou un texte libre legacy si non résolu).
 * ---------------------------------------------------------------------- */

/** Résout un lien otage : nom vivant de la fiche adv si l'id existe, sinon texte legacy. */
function resolveLien(lien: unknown, advs: readonly PctacCollectionItemLike[]): string {
  const v = String(lien ?? '');
  if (!v) return '';
  const adv = advs.find((a) => a.id === v);
  return adv ? `${(adv.nom as string | undefined) || ''} ${(adv.prenom as string | undefined) || ''}`.trim() : v;
}

interface PctacCollectionItemLike { id: string; [key: string]: unknown }

/** U15 — `YYYY-MM-DD` → `JJ/MM/AAAA` (affichage sobre des séparateurs de jour). */
function formatDateFr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return (d && m && y) ? `${d}/${m}/${y}` : iso;
}

/**
 * Lot B (constats 7 et 9) — libellé d'une catégorie photo dérivé de la
 * situation courante. Seuls « Otages » et « Adversaire » suivent le vocabulaire
 * du mode ; les autres restent fixes. `PHOTO_CATEGORIES` demeure la source
 * unique des `id` (valeurs stockées, jamais renommées).
 */
function photoCategoryLabel(cat: PctacPhotoCategory): string {
  const mode = currentMode();
  if (cat.id === 'hostage') return mode.host.plural;
  if (cat.id === 'neutralized') return mode.adv.singular;
  return cat.label;
}

/**
 * C9 — Reflète l'état de sélection des pastilles Pax (boutons `role="radio"`)
 * dans `aria-checked`, et applique le curseur de tabulation unique (« roving
 * tabindex ») attendu d'un `radiogroup` ARIA : seule l'option sélectionnée est
 * joignable par Tab, les flèches parcourent le groupe. Le bouton d'ajout
 * (`#openCreatePaxBtn`) n'a pas `role="radio"` : il est ignoré ici.
 */
function syncPaxAriaChecked(container: HTMLElement): void {
  const options = Array.from(container.querySelectorAll<HTMLElement>('.pax-select-option[role="radio"]'));
  const current = options.find((o) => o.classList.contains('selected')) ?? options[0];
  options.forEach((o) => {
    o.setAttribute('aria-checked', String(o.classList.contains('selected')));
    o.tabIndex = (o === current) ? 0 : -1;
  });
}

/**
 * C9 — Navigation clavier d'un `radiogroup` : les flèches déplacent le focus
 * (et la sélection, comportement radio) entre les pastilles. Lié une seule fois
 * par conteneur.
 */
function bindPaxArrowKeys(container: HTMLElement): void {
  if (container.dataset.paxArrowKeys === '1') return;
  container.dataset.paxArrowKeys = '1';
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp') return;
    const options = Array.from(container.querySelectorAll<HTMLElement>('.pax-select-option[role="radio"]'));
    if (options.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    let idx = active ? options.indexOf(active) : -1;
    if (idx < 0) idx = options.findIndex((o) => o.classList.contains('selected'));
    if (idx < 0) idx = 0;
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const next = options[(idx + (forward ? 1 : -1) + options.length) % options.length];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click();
  });
}

/**
 * Gestionnaire de l'interface utilisateur PC TAC
 */
export const UI: UIContract = {
  // Éléments du DOM (mis à jour à l'initialisation)
  elements: {},

  /**
   * Initialise les références aux éléments du DOM
   * ui.js:24-51
   */
  initElements(): void {
    this.elements = {
      logTableBody: document.querySelector('#logTable tbody') as HTMLTableSectionElement | null,
      logForm: document.getElementById('log-form') as HTMLFormElement | null,
      heureInput: document.getElementById('heure_input') as HTMLInputElement | null,
      paxInput: document.getElementById('pax_input') as HTMLInputElement | null,
      paxModeInput: document.getElementById('pax_mode_input') as HTMLInputElement | null,
      paxCustomColorInput: document.getElementById('pax_custom_color_input') as HTMLInputElement | null,
      lieuInput: document.getElementById('lieu_input') as HTMLInputElement | null,
      remarquesInput: document.getElementById('remarques_input') as HTMLTextAreaElement | null,
      paxSelectContainer: document.getElementById('pax_select_container'),
      darkModeIcon: document.getElementById('darkModeIcon'),
      fullscreenIcon: document.getElementById('fullscreenIcon'),
      dockMenu: document.getElementById('dockMenu'),
      dockToggleIcon: document.querySelector('#dockToggleBtn .material-symbols-outlined') as HTMLElement | null,
      adversaryForm: document.getElementById('adversary-form') as HTMLFormElement | null,
      hostageForm: document.getElementById('hostage-form') as HTMLFormElement | null,
      friendForm: document.getElementById('friend-form') as HTMLFormElement | null,
      photoForm: document.getElementById('photo-form') as HTMLFormElement | null,
      createPaxModal: document.getElementById('createPaxModal'),
      newPaxColorPalette: document.getElementById('new_pax_color_palette'),
    };
    this.bindModalBackdrop();
  },

  /**
   * Ferme la modale au clic sur son fond assombri (m5).
   * ui.js:58-66 — RÉÉCRIT pour R2-T1 (migration `<dialog>` natif) : le fond
   * partagé `#modalBackdrop` (div sœur) a disparu, remplacé par le
   * `::backdrop` natif de chaque `<dialog class="modal">`. Un clic sur ce
   * pseudo-élément (ou sur le padding du dialog, hors de tout enfant) cible
   * TOUJOURS le `<dialog>` lui-même (`e.target === dialog`) — jamais un
   * descendant — c'est le pattern natif standard de fermeture « clic hors
   * contenu ». Même comportement observable qu'avant (clic hors modale =
   * fermeture), mais désormais par-dialog au lieu d'un seul fond partagé (nom
   * de méthode conservé : signature `UIContract.bindModalBackdrop` inchangée,
   * cf. tests + contracts.ts non modifié).
   */
  bindModalBackdrop(): void {
    document.querySelectorAll<HTMLDialogElement>('dialog.modal').forEach((dialog) => {
      if (dialog.dataset.bound) return;
      dialog.dataset.bound = '1';
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    });
  },

  /**
   * Calcule le contraste pour la couleur du texte (Noir ou Blanc)
   * ui.js:71-78
   */
  getContrastYIQ(hexcolor: string | null | undefined): string {
    if (!hexcolor || hexcolor === 'undefined') return '#ffffff';
    const r = parseInt(hexcolor.slice(1, 3), 16);
    const g = parseInt(hexcolor.slice(3, 5), 16);
    const b = parseInt(hexcolor.slice(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
  },

  /**
   * Met à jour l'heure dans l'input
   * ui.js:83-88
   */
  updateTimeInput(force = false): void {
    if (window.isTimeInputManuallyChanged && !force) return;
    const now = new Date();
    const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    if (this.elements.heureInput) this.elements.heureInput.value = time;
  },

  /**
   * Change la vue principale via les onglets
   * ui.js:93-117
   *
   * [SUPPRIMÉ] branche `viewId === 'view-dashboard'` (ui.js:110-113) —
   * `window.Dashboard` est du code mort prouvé (SPEC-PCTAC-CONVERSION.md §1.3),
   * non déclaré dans global.d.ts.
   */
  switchMainView(viewId: string): void {
    // Décision 33 — quitter l'onglet de la fiche la referme (dans la page ou en
    // modale) : la saisie reste en brouillon. Évite qu'un retour arrière
    // Android ferme une fiche cachée au lieu d'agir sur l'onglet affiché.
    if (document.getElementById('ficheSheet')?.hasAttribute('open')) closeFicheSheet();
    document.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
      const active = btn.dataset.view === viewId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active)); // U10 (a11y onglets)
    });
    document.querySelectorAll('.tab-content-view').forEach((view) => {
      // En écran scindé, split-view.ts gouverne la visibilité des vues
      // montées dans ses panneaux. Les retirer ici viderait un panneau :
      // `main.ts` appelle `switchMainView(lastView)` APRÈS `initSplitView()`,
      // ce qui cassait un écran scindé mémorisé à chaque rechargement.
      if (document.body.classList.contains('is-split') && view.closest('.split-view')) return;
      view.classList.toggle('active', view.id === viewId);
    });
    if (viewId === 'view-adversaires') this.renderAdversaries();
    if (viewId === 'view-otages') this.renderHostages();
    if (viewId === 'view-amis') this.renderFriends();
    if (viewId === 'view-photos') {
      const lastFilter = localStorage.getItem('lastPhotoFilter') || 'all';
      this.renderPhotos(lastFilter);
    }
    if (viewId === 'view-plan' && window.PlanMap) {
      window.PlanMap.refresh();
    }
    // Quota plein : la bascule de vue (DOM) doit réussir même si la
    // persistance de la préférence échoue.
    try { localStorage.setItem('lastView', viewId); } catch {
      // Quota localStorage plein : la préférence de vue n'est pas persistée,
      // mais la bascule DOM a déjà eu lieu (ui.js:116).
    }
  },

  /**
   * Initialise les couleurs et modes Pax
   * ui.js:138-175
   */
  initPaxModeAndColors(): void {
    this.initColorPalettes();
    // Capture en const : le narrowing TS de `this.elements.paxSelectContainer`
    // ne traverse pas la fermeture imbriquée de `btn.onclick` (adaptation de
    // TYPAGE PUR, même principe que planmap/chrome.ts).
    const container = this.elements.paxSelectContainer;
    if (container) {
      // On attache les événements aux boutons statiques
      container.querySelectorAll<HTMLElement>('.pax-select-option:not(.custom):not(#openCreatePaxBtn)').forEach((btn) => {
        const key = btn.dataset.pax;
        if (!key) return;

        btn.onclick = () => {
          if (this.elements.paxInput) this.elements.paxInput.value = key;
          if (this.elements.paxInput) this.elements.paxInput.dataset.lastSelected = key;
          if (this.elements.paxInput) this.elements.paxInput.dataset.customColor = '';
          if (this.elements.paxModeInput) this.elements.paxModeInput.value = 'standard';

          // Désélectionner TOUS les boutons (natifs et customs)
          container.querySelectorAll<HTMLElement>('.pax-select-option').forEach((b) => {
            b.classList.remove('selected');
            // Réinitialiser les styles inline des boutons custom
            if (b.classList.contains('custom')) {
              b.style.background = '';
              b.style.color = '';
            }
          });
          btn.classList.add('selected');
          syncPaxAriaChecked(container);
        };

        if (this.elements.paxInput && this.elements.paxInput.value === key) btn.classList.add('selected');
      });
      bindPaxArrowKeys(container);
    }
    this.renderCustomPaxOptions();
    if (container) syncPaxAriaChecked(container);

    const openCreatePaxBtn = document.getElementById('openCreatePaxBtn');
    if (openCreatePaxBtn) {
      openCreatePaxBtn.onclick = () => this.showCreatePaxModal();
    }

    this.initColorPalettes();
  },

  /**
   * Supprime un intervenant personnalisé
   * ui.js:180-186
   */
  async deleteCustomPax(id: string): Promise<void> {
    const confirmed = await confirmDialog({
      message: 'Supprimer cet intervenant ?',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) return;
    const list = Storage.loadCollection('pcTacCustomPax');
    const newList = list.filter((p) => p.id !== id);
    Storage.saveCollection('pcTacCustomPax', newList);
    this.initPaxModeAndColors();
  },

  /**
   * Affiche le tableau des logs
   * ui.js:191-251
   */
  /** Ordre d'affichage du journal : false = chrono (heure ASC, ordre du stockage), true = inversé. */
  logSortDesc: false,

  /** Filtre « favoris seuls » de la main courante. Non persisté : c'est une
   * loupe qu'on pose le temps d'un point de situation, pas un réglage. */
  logFavorisOnly: false,

  /**
   * Marque ou démarque une entrée. Le tri du STOCKAGE reste strictement
   * chronologique (`Storage.saveLogData`) : la remontée des favoris est une
   * affaire d'affichage, et une archive relue ailleurs garde l'ordre des faits.
   */
  toggleLogFavori(id: string): void {
    const logs = Storage.loadLogData();
    const entry = logs.find((l) => l.id === id);
    if (!entry) return;
    entry.favori = !entry.favori;
    Storage.saveLogData(logs);
    this.renderLogTable(Storage.loadLogData());
  },

  /** Bascule le filtre « favoris seuls » et rafraîchit le journal. */
  toggleLogFavorisFilter(): void {
    this.logFavorisOnly = !this.logFavorisOnly;
    const btn = document.getElementById('favorisLogBtn');
    if (btn) {
      btn.classList.toggle('is-active', this.logFavorisOnly);
      btn.setAttribute('aria-pressed', String(this.logFavorisOnly));
    }
    this.renderLogTable(Storage.loadLogData());
  },

  renderLogTable(logData: readonly PctacLogEntry[]): void {
    const tbody = this.elements.logTableBody;
    if (!tbody) return;
    if (this.logSortDesc) logData = [...logData].reverse();
    if (this.logFavorisOnly) logData = logData.filter((e) => e.favori);
    // Les favoris remontent en tête SANS casser l'ordre chronologique entre
    // eux : `filter` conserve l'ordre d'entrée, donc concaténer les deux
    // groupes suffit — un tri comparatif ici risquerait de le perdre.
    const favoris = logData.filter((e) => e.favori);
    if (favoris.length > 0 && favoris.length < logData.length) {
      logData = [...favoris, ...logData.filter((e) => !e.favori)];
    }
    tbody.innerHTML = '';
    // U11 — état vide explicite plutôt qu'un tableau muet.
    if (logData.length === 0) {
      tbody.innerHTML = this.logFavorisOnly
        ? '<tr><td colspan="4" class="empty-state">Aucune entrée en favori — marquez-en une avec l\'étoile</td></tr>'
        : '<tr><td colspan="4" class="empty-state">Aucun événement enregistré</td></tr>';
      return;
    }
    // U15 — séparateur de jour discret quand la date change (pas de colonne).
    // Désactivé dès qu'un favori remonte ou que le filtre est posé : l'ordre
    // affiché n'est alors plus chronologique, et un séparateur de date y
    // annoncerait un regroupement qui n'existe pas.
    const separateursDeJour = !this.logFavorisOnly && favoris.length === 0;
    let prevDate: string | undefined;
    logData.forEach((entry) => {
      if (separateursDeJour && entry.date && entry.date !== prevDate) {
        const sep = tbody.insertRow();
        sep.className = 'log-day-sep';
        sep.innerHTML = `<td colspan="4">${esc(formatDateFr(entry.date))}</td>`;
      }
      prevDate = entry.date;
      let paxColor: string;
      let paxText: string;
      let paxFontColor: string;
      if (entry.paxMode === 'standard') {
        // noUncheckedIndexedAccess : PDF_PAX_COLORS[entry.pax] et
        // PDF_PAX_COLORS['Adversaire'] sont typés `| undefined` ; 'Adversaire'
        // existe toujours dans config.ts — branche jamais atteinte en
        // pratique (même idiome que pdf-export.ts).
        const paxInfo = PDF_PAX_COLORS[entry.pax] ?? PDF_PAX_COLORS['Adversaire'];
        if (!paxInfo) return;
        paxColor = paxInfo.color;
        const lex = currentMode();
        paxText = entry.pax === 'Adversaire' ? lex.adv.paxChip
          : entry.pax === 'Otage' ? lex.host.paxChip
          : paxInfo.text;
        paxFontColor = paxInfo.fontColor;
      } else {
        paxColor = entry.paxColor || (FREE_MODE_COLORS[0] ? FREE_MODE_COLORS[0].hex : '');
        paxText = entry.pax;
        paxFontColor = this.getContrastYIQ(paxColor);
      }
      const row = tbody.insertRow();
      row.dataset.id = entry.id;
      row.innerHTML = `
                <td style="width: 15%;">
                    <div class="heure-cell-container">
                        <span class="heure-cell-text">${esc(entry.heure)}</span>
                        <button type="button" class="log-favori-btn${entry.favori ? ' is-favori' : ''}"
                            onclick="window.UI.toggleLogFavori('${entry.id}')"
                            aria-pressed="${entry.favori ? 'true' : 'false'}"
                            title="${entry.favori ? 'Retirer des favoris' : 'Marquer comme important'}"
                            aria-label="${entry.favori ? 'Retirer cette entrée des favoris' : 'Marquer cette entrée comme importante'}">
                            <span class="material-symbols-outlined" aria-hidden="true">${entry.favori ? 'star' : 'star_border'}</span>
                        </button>
                        <button type="button" class="action-btn-small edit" onclick="window.openEditModal('${entry.id}')" title="Modifier" aria-label="Modifier cette entrée">
                            <span class="material-symbols-outlined" style="font-size: 18px;">edit</span>
                        </button>
                        <button type="button" class="delete-btn" onclick="window.deleteLogEntry('${entry.id}')" aria-label="Supprimer cette entrée">
                            <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
                        </button>
                    </div>
                </td>
                <td style="width: 15%;"><span class="pax-cell" style="background-color: ${paxColor}; color: ${paxFontColor};">${esc(paxText)}</span></td>
                <td style="width: 35%;">${esc(entry.lieu)}</td>
                <td style="width: 35%;">${esc(entry.remarques)}</td>
            `;
    });
    // U4 — drag&drop du journal SUPPRIMÉ : le tri chronologique de
    // Storage.saveLogData est la source de vérité de l'ordre.
  },

  // ui.js:286-296
  openEditModal(id: string): void {
    const logData = Storage.loadLogData();
    const entry = logData.find((e) => e.id === id);
    if (!entry) return;
    (document.getElementById('edit_id') as HTMLInputElement).value = id;
    // Décision 30 — la date est modifiable, préremplie avec celle de l'entrée.
    (document.getElementById('edit_date') as HTMLInputElement).value = entry.date || '';
    (document.getElementById('edit_heure') as HTMLInputElement).value = entry.heure;
    (document.getElementById('edit_lieu') as HTMLInputElement).value = entry.lieu || '';
    (document.getElementById('edit_remarques') as HTMLTextAreaElement).value = entry.remarques || '';
    (document.getElementById('editModal') as HTMLDialogElement).showModal();
  },

  // ui.js:298-311
  confirmEditLog(): void {
    const id = (document.getElementById('edit_id') as HTMLInputElement).value;
    if (!id) return;
    const heure = (document.getElementById('edit_heure') as HTMLInputElement).value;
    if (!heure) {
      toast('Renseignez une heure', { kind: 'error' });
      return;
    }
    // Décision 30 — changer l'heure seule garde la date : on ne l'écrit que si
    // elle est renseignée (une entrée legacy sans date reste sans date).
    const date = (document.getElementById('edit_date') as HTMLInputElement).value;
    const updated: Partial<PctacLogEntry> = {
      heure,
      lieu: (document.getElementById('edit_lieu') as HTMLInputElement).value.trim(),
      remarques: (document.getElementById('edit_remarques') as HTMLTextAreaElement).value.trim(),
      ...(date ? { date } : {}),
    };
    LogManager.updateEntry(id, updated);
    if (updated.lieu) LogManager.addLieuToHistory(updated.lieu);
    this.renderLogTable(Storage.loadLogData());
    this.refreshLieuSuggestions();
    this.hideEditModal();
    toast('Fiche mise à jour', { kind: 'success' }); // Lot B — constat 23
  },

  // ui.js:313-316
  hideEditModal(): void {
    (document.getElementById('editModal') as HTMLDialogElement).close();
  },

  /** Recharge les suggestions de localisation dans le datalist
   * ui.js:319-324
   */
  refreshLieuSuggestions(): void {
    const dl = document.getElementById('lieu_suggestions');
    if (!dl) return;
    const hist = LogManager.getLieuHistory();
    dl.innerHTML = hist.map((l) => `<option value="${l.replace(/"/g, '&quot;')}">`).join('');
  },

  /**
   * Lot B (constat 10) — suggestions « Nom Prénom » des otages pour les champs
   * de lien adversaire (`#adv_lien`, `#edit_adv_lien`). Même motif que
   * `refreshLieuSuggestions` : le champ reste un `<input type="text">` libre, la
   * datalist ne fait que proposer ; le stockage demeure du texte.
   */
  refreshOtagesSuggestions(): void {
    const dl = document.getElementById('otages_suggestions');
    if (!dl) return;
    const host = Storage.loadCollection('pcTacHostages') || [];
    dl.innerHTML = host
      .map((h) => `${(h.nom as string | undefined) || ''} ${(h.prenom as string | undefined) || ''}`.trim())
      .filter(Boolean)
      .map((n) => `<option value="${esc(n)}">`)
      .join('');
  },

  /**
   * Lot B (constats 7 et 9) — alimente le `<select id="photo_category">` depuis
   * `PHOTO_CATEGORIES` (source unique) au lieu des options figées du HTML. Les
   * `value` restent strictement `hostage/location/trap/neutralized/target/all`
   * (valeurs stockées dans les fiches photo). Le libellé suit la situation.
   */
  refreshPhotoCategories(): void {
    const sel = document.getElementById('photo_category') as HTMLSelectElement | null;
    if (!sel) return;
    const previous = sel.value;
    sel.innerHTML = PHOTO_CATEGORIES.map((cat) =>
      `<option value="${cat.id}">${esc(photoCategoryLabel(cat))}</option>`).join('');
    if (previous && PHOTO_CATEGORIES.some((c) => c.id === previous)) sel.value = previous;
  },

  // ui.js:326-336
  selectColorSwatch(hex: string, paletteId: string, hiddenInputId?: string): void {
    const palette = document.getElementById(paletteId);
    if (!palette) return;
    if (hiddenInputId) {
      const input = document.getElementById(hiddenInputId) as HTMLInputElement | null;
      if (input) input.value = hex;
    }
    palette.querySelectorAll<HTMLElement>('.color-swatch').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.color === hex);
    });
  },

  /**
   * Marque, dans la palette de CRÉATION de bouton modulaire, les couleurs déjà
   * prises par un pax personnalisé existant : pastille bloquée (disabled) et
   * libellé du bouton propriétaire affiché au survol (à la place du nom de la
   * couleur). Rafraîchi à chaque ouverture de la modale (créations/suppressions).
   * ui.js:344-365
   */
  refreshNewPaxPalette(): void {
    const palette = document.getElementById('new_pax_color_palette');
    if (!palette) return;
    const customPax = Storage.loadCollection('pcTacCustomPax') || [];
    const usedBy: Record<string, string> = {};
    customPax.forEach((p) => {
      const color = p.color as string | undefined;
      if (p && color) usedBy[String(color).toLowerCase()] = (p.name as string | undefined) || '(sans nom)';
    });
    palette.querySelectorAll<HTMLButtonElement>('.color-swatch').forEach((btn) => {
      const hex = String(btn.dataset.color || '').toLowerCase();
      const owner = usedBy[hex];
      const def = FREE_MODE_COLORS.find((c) => c.hex.toLowerCase() === hex);
      if (owner) {
        btn.disabled = true;
        btn.classList.add('used');
        btn.classList.remove('selected');
        btn.title = `Déjà utilisé par « ${owner} »`;
      } else {
        btn.disabled = false;
        btn.classList.remove('used');
        btn.title = def ? def.name : hex;
      }
    });
  },

  // ui.js:367-378
  showCreatePaxModal(): void {
    (document.getElementById('createPaxModal') as HTMLDialogElement).showModal();
    (document.getElementById('new_pax_name') as HTMLInputElement).value = '';
    (document.getElementById('new_pax_name') as HTMLInputElement).focus();

    // Bloque les couleurs déjà prises, puis sélectionne la 1re couleur LIBRE
    // (sans ce filtre, la sélection par défaut pouvait tomber sur une bloquée).
    this.refreshNewPaxPalette();
    const firstColor = document.querySelector<HTMLElement>('#new_pax_color_palette .color-swatch:not(.used)');
    if (firstColor) firstColor.click();
  },

  // ui.js:380-383
  hideCreatePaxModal(): void {
    (document.getElementById('createPaxModal') as HTMLDialogElement).close();
  },

  // ui.js:385-434
  renderCustomPaxOptions(): void {
    const customPaxList = Storage.loadCollection('pcTacCustomPax') || [];
    const container = this.elements.paxSelectContainer;
    if (!container) return;
    container.querySelectorAll('.pax-select-option.custom').forEach((el) => el.remove());
    const addBtn = document.getElementById('openCreatePaxBtn');
    customPaxList.forEach((pax) => {
      const paxName = (pax.name as string | undefined) || '';
      const paxColor = (pax.color as string | undefined) || '';
      // C9 — la pastille personnalisée est un bouton radio (utilisable au
      // clavier), mêmes classe et `dataset.pax` que les options statiques.
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', 'false');
      option.className = 'pax-select-option custom';
      option.textContent = paxName;
      option.dataset.pax = paxName;

      const selectCustom = (): void => {
        // Non gardé dans l'original (ui.js:398-401) : cast de typage pur,
        // même comportement (TypeError si l'élément est absent).
        (this.elements.paxInput as HTMLInputElement).value = paxName;
        (this.elements.paxInput as HTMLInputElement).dataset.lastSelected = paxName;
        (this.elements.paxInput as HTMLInputElement).dataset.customColor = paxColor;
        (this.elements.paxModeInput as HTMLInputElement).value = 'free';

        container.querySelectorAll<HTMLElement>('.pax-select-option').forEach((b) => {
          b.classList.remove('selected');
          if (b.classList.contains('custom')) {
            b.style.background = '';
            b.style.color = '';
          }
        });

        option.classList.add('selected');
        option.style.background = paxColor;
        option.style.color = this.getContrastYIQ(paxColor);
        syncPaxAriaChecked(container);
      };

      option.onclick = selectCustom;
      option.oncontextmenu = (e) => { e.preventDefault(); this.deleteCustomPax(pax.id); };

      let timer: ReturnType<typeof setTimeout> | undefined;
      option.ontouchstart = () => { timer = setTimeout(() => this.deleteCustomPax(pax.id), LONG_PRESS_DELAY); };
      option.ontouchend = () => clearTimeout(timer);
      // Un scroll tactile qui traverse la puce ne doit PAS déclencher la suppression.
      option.ontouchmove = () => clearTimeout(timer);
      option.ontouchcancel = () => clearTimeout(timer);

      if (this.elements.paxInput && this.elements.paxInput.value === paxName) {
        option.classList.add('selected');
        option.style.background = paxColor;
        option.style.color = this.getContrastYIQ(paxColor);
      }

      container.insertBefore(option, addBtn);
    });
    syncPaxAriaChecked(container);
  },

  // ui.js:436-466
  async renderAdversaries(): Promise<void> {
    const stored = Storage.loadCollection('pcTacAdversaries') || [];
    migrateStatuses('pcTacAdversaries', stored, 'active'); // U16 — migration douce
    // Décision 33 — tri par priorité (source unique partagée avec le PDF).
    const raw = sortFichesByPriority('adv', currentModeId(), stored);
    renderFicheCounters();
    const box = document.getElementById('adversary-table-body');
    if (!box) return;
    bindFicheList(box, 'adv');
    const lex = currentMode().adv;
    if (raw.length === 0) {
      box.innerHTML = `<p class="empty-state">${esc(lex.emptyLabel)} — touchez « ${esc(lex.newLabel)} »</p>`;
      return;
    }
    // U26 — squelette pendant l'hydratation IndexedDB des photos, au premier
    // rendu seulement : remplacer des cartes déjà là ferait sauter la liste.
    if (!box.querySelector('.fiche-card')) box.innerHTML = '<p class="empty-state">Chargement des photos…</p>';
    const list = await ImageStore.hydrate(raw, 'photo');
    const hostages = Storage.loadCollection('pcTacHostages');
    const mode = currentModeId();
    box.innerHTML = list.map((item) => {
      // C8 — fiches protégées liées à celle-ci (calcul au rendu).
      const linked = hostages.filter((h) => h.lien === item.id).map((h) => ficheTitle('host', mode, h));
      return ficheCard('adv', item, linked, (v) => v);
    }).join('');
  },

  // ui.js:468-496
  async renderHostages(): Promise<void> {
    const stored = Storage.loadCollection('pcTacHostages') || [];
    const mode = currentModeId();
    // U16 — migration douce : photo _sync d'abord, sinon statut par défaut de
    // la situation (Forcené : heuristique blessures ; triage : « Non triée »).
    const noStatus = stored.filter((it) => !it.status);
    if (noStatus.length > 0) {
      const photos = Storage.loadCollection('pcTacPhotos');
      noStatus.forEach((it) => {
        const photo = photos.find((p) => p.id === it.id + '_sync');
        it.status = (photo && photo.status)
          || (mode === 'forcene' ? hostageStatusFromBlessures(it.blessures) : defaultStatus('host', mode));
      });
      Storage.saveCollection('pcTacHostages', stored);
    }
    // Décision 33 — tri par priorité (source unique partagée avec le PDF).
    const raw = sortFichesByPriority('host', mode, stored);
    // Lot B (constat 10) — suggestions de la main courante.
    this.refreshOtagesSuggestions();
    renderFicheCounters();
    const box = document.getElementById('hostage-table-body');
    if (!box) return;
    bindFicheList(box, 'host');
    const lex = currentMode().host;
    if (raw.length === 0) {
      box.innerHTML = `<p class="empty-state">${esc(lex.emptyLabel)} — touchez « ${esc(lex.newLabel)} »</p>`;
      return;
    }
    if (!box.querySelector('.fiche-card')) box.innerHTML = '<p class="empty-state">Chargement des photos…</p>';
    const list = await ImageStore.hydrate(raw, 'photo');
    const advs = Storage.loadCollection('pcTacAdversaries');
    box.innerHTML = list.map((item) => ficheCard('host', item, [], (v) => resolveLien(v, advs) || v)).join('');
  },

  // ui.js:498-511
  renderFriends(): void {
    const list = Storage.loadCollection('pcTacFriends') || [];
    const tbody = document.getElementById('friend-table-body');
    if (!tbody) return;
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Aucun ami — utilisez le formulaire ci-dessus</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((item) => `
            <tr>
                <td>${esc(item.nom)} ${esc(item.prenom)}</td>
                <td>${esc(item.unite)}</td>
                <td>${esc(item.tph)}</td>
                <td>${esc(item.mission)}</td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="action-btn-small edit" onclick="window.UI.showEditFriendModal('${item.id}')" title="Modifier" aria-label="Modifier cet ami"><span class="material-symbols-outlined" style="font-size: 18px;">edit</span></button>
                        <button class="delete-btn" onclick="window.deleteCollectionItem('pcTacFriends', '${item.id}', 'view-amis')" aria-label="Supprimer cet ami"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
                    </div>
                </td>
            </tr>
        `).join('');
  },

  // U13 — édition d'une fiche Ami (parité avec showEditAdversaryModal, sans photo).
  showEditFriendModal(id: string): void {
    const list = Storage.loadCollection('pcTacFriends');
    const item = list.find((f) => f.id === id);
    if (!item) return;
    (document.getElementById('edit_friend_id') as HTMLInputElement).value = id;
    ['nom', 'prenom', 'unite', 'tph', 'mission'].forEach((f) => {
      const el = document.getElementById('edit_friend_' + f) as HTMLInputElement | null;
      if (el) el.value = (item[f] as string | undefined) || '';
    });
    (document.getElementById('editFriendModal') as HTMLDialogElement).showModal();
  },

  hideEditFriendModal(): void {
    (document.getElementById('editFriendModal') as HTMLDialogElement).close();
  },

  handleFriendUpdate(): void {
    const id = (document.getElementById('edit_friend_id') as HTMLInputElement).value;
    if (!id) return;
    const list = Storage.loadCollection('pcTacFriends');
    const item = list.find((f) => f.id === id);
    if (!item) { this.hideEditFriendModal(); return; }
    ['nom', 'prenom', 'unite', 'tph', 'mission'].forEach((f) => {
      const el = document.getElementById('edit_friend_' + f) as HTMLInputElement | null;
      if (el) item[f] = el.value.trim();
    });
    Storage.saveCollection('pcTacFriends', list);
    this.hideEditFriendModal();
    this.renderFriends();
    toast('Fiche mise à jour', { kind: 'success' }); // Lot B — constat 23
  },

  /**
   * ui.js:513-574
   *
   * PC4 — sans argument explicite, conserver le dernier filtre choisi : les
   * appels après ajout / renommage / suppression ne doivent pas réinitialiser
   * l'affichage à « tout » et perdre la catégorie en cours de consultation.
   */
  async renderPhotos(filterCategory?: string): Promise<void> {
    if (filterCategory === undefined) {
      filterCategory = localStorage.getItem('lastPhotoFilter') || 'all';
    }
    const raw = Storage.loadCollection('pcTacPhotos') || [];
    const board = document.getElementById('photo-board');
    if (!board) return;
    const emptyMsg = '<div class="empty-state">Aucune photo — utilisez le formulaire ci-dessus</div>';
    const preFiltered = filterCategory === 'all' ? raw : raw.filter((item) => item.category === filterCategory);
    // U26 — squelette pendant l'hydratation IndexedDB.
    if (preFiltered.length > 0) board.innerHTML = '<div class="empty-state">Chargement des photos…</div>';
    const filteredList = await ImageStore.hydrate(preFiltered, 'data');

    // Mise à jour des boutons de filtre pour respecter l'ordre et le style
    const filterContainer = document.getElementById('photo-filter-container');
    if (filterContainer) {
      filterContainer.innerHTML = PHOTO_CATEGORIES.map((cat) => `
                <button class="tab-btn ${filterCategory === cat.id ? 'active' : ''}" onclick="UI.renderPhotos('${cat.id}')" style="padding: 6px 12px; font-size: 0.8em; width: auto; flex-direction: row; min-height: unset;">
                    <span>${esc(photoCategoryLabel(cat))}</span>
                </button>
            `).join('');
    }
    localStorage.setItem('lastPhotoFilter', filterCategory);

    // Sélection automatique de la catégorie correspondante dans le formulaire si ce n'est pas "all"
    const catSelect = document.getElementById('photo_category') as HTMLSelectElement | null;
    if (catSelect && filterCategory !== 'all') {
      catSelect.value = filterCategory;
    }

    bindPhotoBoard(board);
    board.innerHTML = filteredList.length === 0 ? emptyMsg : filteredList.map((item) => `
            <div class="photo-card" draggable="true" data-id="${item.id}" data-category="${item.category}" data-status="${item.status || 'active'}" ondragstart="UI.handlePhotoDragStart(event)" ondragover="UI.handlePhotoDragOver(event)" ondrop="UI.handlePhotoDrop(event)" ondragend="UI.handlePhotoDragEnd()">
                <img src="${item.data}" alt="${esc(item.title)}">
                <div style="padding: 10px; display: flex; flex-direction: column; gap: 5px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="photo-title-text" style="font-size: 0.9em; font-weight: bold;">${esc(item.title)}</span>
                        <div style="display: flex; gap: 5px;">
                            <button type="button" class="action-btn-small" title="Annoter" data-photo-action="annotate" aria-label="Annoter cette photo"><span class="material-symbols-outlined" style="font-size: 16px;">draw</span></button>
                            <button class="action-btn-small edit" title="Renommer" onclick="window.UI.editPhotoTitle('${item.id}')" aria-label="Renommer cette photo"><span class="material-symbols-outlined" style="font-size: 16px;">edit</span></button>
                            <button class="action-btn-small delete" title="Supprimer" onclick="window.deleteCollectionItem('pcTacPhotos', '${item.id}', 'view-photos')" aria-label="Supprimer cette photo"><span class="material-symbols-outlined" style="font-size: 16px;">delete</span></button>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase;">${esc(photoCategoryLabel(PHOTO_CATEGORIES.find((c) => c.id === item.category) || { id: item.category as string, label: 'Autre' }))}</span>
                        ${item.category === 'trap' ? `
                            <select onchange="UI.updateAdversaryStatus('${item.id}', this.value)" style="font-size: 0.7em; padding: 2px 20px 2px 5px; height: auto; min-height: unset; width: auto; background-position: right 2px center;">
                                <option value="active" ${item.status === 'active' || !item.status ? 'selected' : ''}>Actif</option>
                                <option value="neutralized" ${item.status === 'neutralized' ? 'selected' : ''}>Neutralisé</option>
                            </select>
                        ` : ''}
                        ${(item.category === 'neutralized' || (item.category === 'hostage' && statusChoices('host', currentModeId()).length > 0)) ? `
                            <select onchange="UI.updateAdversaryStatus('${item.id}', this.value)" style="font-size: 0.7em; padding: 2px 20px 2px 5px; height: auto; min-height: unset; width: auto; background-position: right 2px center;">
                                ${statusOptionsFor(item.category === 'hostage' ? 'host' : 'adv', String(item.status || defaultStatus(item.category === 'hostage' ? 'host' : 'adv', currentModeId())))}
                            </select>
                        ` : ''}
                    </div>
                </div>
            </div>
        `).join('');
  },

  // ui.js:576-579
  handlePhotoDragStart(e: DragEvent): void {
    const card = (e.target as HTMLElement).closest('.photo-card') as HTMLElement;
    (e.dataTransfer as DataTransfer).setData('text/plain', String(card.dataset.id));
    card.classList.add('dragging-photo');
  },

  // ui.js:581-583
  handlePhotoDragOver(e: DragEvent): void {
    e.preventDefault();
  },

  // ui.js:585-605
  handlePhotoDrop(e: DragEvent): void {
    e.preventDefault();
    const draggedId = (e.dataTransfer as DataTransfer).getData('text/plain');
    const targetCard = (e.target as HTMLElement).closest<HTMLElement>('.photo-card');
    if (!targetCard) return;
    const targetId = targetCard.dataset.id;
    if (draggedId === targetId) return;

    const list = Storage.loadCollection('pcTacPhotos');
    const draggedIdx = list.findIndex((p) => p.id === draggedId);
    const targetIdx = list.findIndex((p) => p.id === targetId);
    // Drag externe (fichier, autre app) ou id inconnu : findIndex = -1 et
    // splice(-1,1) déplacerait silencieusement la DERNIÈRE photo. PIÈGE VITAL
    // (ui.js:598).
    if (draggedIdx === -1 || targetIdx === -1) return;

    const removedArr = list.splice(draggedIdx, 1);
    // noUncheckedIndexedAccess : removedArr[0] est typé `| undefined` bien que
    // splice(draggedIdx, 1) retourne toujours exactement 1 élément ici
    // (draggedIdx déjà validé ci-dessus) — branche jamais atteinte en pratique.
    const removed = removedArr[0];
    if (!removed) return;
    list.splice(targetIdx, 0, removed);

    Storage.saveCollection('pcTacPhotos', list);
    this.renderPhotos();
  },

  /** Nettoie l'état visuel du drag même si le drop est annulé (Échap, drop hors zone).
   * ui.js:607-610
   */
  handlePhotoDragEnd(): void {
    document.querySelectorAll('.dragging-photo').forEach((el) => el.classList.remove('dragging-photo'));
  },

  /**
   * ui.js:612-621 — RÉÉCRIT (U16/C1) : la FICHE est désormais la source de
   * vérité. Depuis une carte photo `_sync`, on écrit la fiche (qui propage
   * vers la photo + journalise) ; photo orpheline : comportement historique.
   */
  updateAdversaryStatus(id: string, status: string): void {
    const ficheId = id.endsWith('_sync') ? id.slice(0, -'_sync'.length) : id;
    const routed =
      setStatusOnFiche('pcTacAdversaries', ficheId, status) ||
      setStatusOnFiche('pcTacHostages', ficheId, status) ||
      // Fiche introuvable mais statut déjà à jour ? Vérifie l'existence.
      Storage.loadCollection('pcTacAdversaries').some((a) => a.id === ficheId) ||
      Storage.loadCollection('pcTacHostages').some((h) => h.id === ficheId);
    if (!routed) {
      // Photo sans fiche : écrit sur la photo seule (comportement historique).
      const list = Storage.loadCollection('pcTacPhotos');
      const photo = list.find((p) => p.id === id);
      if (!photo) return;
      photo.status = status;
      Storage.saveCollection('pcTacPhotos', list);
    }
    this.renderLogTable(Storage.loadLogData()); // C5 — l'entrée auto est visible
    const currentFilter = localStorage.getItem('lastPhotoFilter') || 'all';
    this.renderPhotos(currentFilter); // Re-render avec le filtre actuel
  },

  /**
   * U16/C1 — changement de statut depuis une LISTE (adversaires/otages) :
   * fiche → photo _sync → journal auto, puis re-rendus.
   */
  setItemStatus(key: string, id: string, status: string): void {
    if (!setStatusOnFiche(key, id, status)) return;
    this.renderLogTable(Storage.loadLogData());
    if (key === 'pcTacAdversaries') void this.renderAdversaries();
    else void this.renderHostages();
  },

  // ui.js:623-629 — U25 : promptDialog async au lieu du prompt() natif.
  async editPhotoTitle(id: string): Promise<void> {
    const list = Storage.loadCollection('pcTacPhotos');
    const photo = list.find((p) => p.id === id);
    if (!photo) return;
    const newTitle = await promptDialog({
      title: 'Renommer la photo',
      message: 'Nouveau titre :',
      initial: (photo.title as string | undefined) || '',
    });
    if (newTitle) { photo.title = newTitle.trim(); Storage.saveCollection('pcTacPhotos', list); void this.renderPhotos(); }
  },

  // ui.js:631-643
  /** `photoId` : photo de la galerie, annotable depuis la visionneuse (décision 25). */
  openLightbox(src: string, title?: string, photoId?: string): void {
    const modal = document.getElementById('lightboxModal') as HTMLDialogElement | null;
    const img = document.getElementById('lightboxImage') as HTMLImageElement | null;
    const titleEl = document.getElementById('lightboxTitle');
    if (!modal || !img) return;
    img.src = src;
    modal.dataset.photoId = photoId ?? '';
    const annotateBtn = document.getElementById('lightboxAnnotateBtn');
    if (annotateBtn) {
      annotateBtn.hidden = !photoId;
      annotateBtn.onclick = () => {
        const id = modal.dataset.photoId;
        if (!id) return;
        void annotatePhoto(id).then(async (saved) => {
          const fresh = saved && modal.open && modal.dataset.photoId === id ? await ImageStore.get(id) : null;
          if (fresh) img.src = fresh;
        });
      };
    }
    // `textContent` n'accepte pas `undefined` (`string | null`) : adaptation de
    // typage pur, jamais exercée en pratique (title est toujours fourni par
    // les appelants de ce module, ui.js:545).
    if (titleEl) titleEl.textContent = title || '';
    // R2-T1 : `<dialog>` natif au lieu de `classList.add('active')`.
    modal.showModal();
    document.body.style.overflow = 'hidden';
    modal.onclick = (e) => { if (e.target === modal) this.closeLightbox(); };
    // Conservé malgré l'Escape natif du <dialog> : redondant mais inoffensif
    // (`this.closeLightbox()` ferme un dialog déjà fermé sans jeter, cf.
    // spec `HTMLDialogElement.close()`), et évite de dépendre de l'ordre
    // événement/action-par-défaut du navigateur pour restaurer le scroll.
    // Échap dans l'annotation ouverte par-dessus ne ferme qu'elle.
    this._lightboxKeydown = (e) => {
      if (e.key === 'Escape' && !document.getElementById('annotationModal')?.hasAttribute('open')) this.closeLightbox();
    };
    window.addEventListener('keydown', this._lightboxKeydown);
  },

  // ui.js:645-651
  closeLightbox(): void {
    const modal = document.getElementById('lightboxModal') as HTMLDialogElement | null;
    if (!modal) return;
    modal.close();
    document.body.style.overflow = '';
    if (this._lightboxKeydown) window.removeEventListener('keydown', this._lightboxKeydown);
  },

  // ui.js:653-674
  initColorPalettes(): void {
    const palettes = [
      { id: 'new_pax_color_palette', inputId: 'new_pax_color_val' },
    ];
    palettes.forEach((p) => {
      const container = document.getElementById(p.id);
      if (!container) return;
      container.innerHTML = '';
      FREE_MODE_COLORS.forEach((color) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'color-swatch';
        btn.style.backgroundColor = color.hex;
        btn.dataset.color = color.hex;
        btn.title = color.name; // nom au survol : lève toute ambiguïté
        btn.onclick = () => this.selectColorSwatch(color.hex, p.id, p.inputId);
        container.appendChild(btn);
      });
    });
  },

  // ui.js:676-680
  toggleFullscreen(): void {
    // Vendor-prefixes absents du lib DOM standard TS, même idiome que
    // planmap/chrome.ts (_toggleFullscreen).
    const isFullscreen = document.fullscreenElement
      || (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
      || (document as { mozFullScreenElement?: Element | null }).mozFullScreenElement
      || (document as { msFullscreenElement?: Element | null }).msFullscreenElement;
    if (!isFullscreen) { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); } else { if (document.exitFullscreen) document.exitFullscreen(); }
  },

  // ui.js:682-685
  updateFullscreenIcon(): void {
    const isFullscreen = document.fullscreenElement
      || (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement
      || (document as { mozFullScreenElement?: Element | null }).mozFullScreenElement
      || (document as { msFullscreenElement?: Element | null }).msFullscreenElement;
    if (this.elements.fullscreenIcon) this.elements.fullscreenIcon.textContent = isFullscreen ? 'fullscreen_exit' : 'fullscreen';
  },

  // ui.js:687-693
  handleThemeToggle(): void {
    document.body.classList.toggle('light-mode');
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    // U20 — pont de continuité : le portail lit sa propre clé.
    localStorage.setItem('tacsuite.portal.theme', isDarkMode ? 'dark' : 'light');
    if (this.elements.darkModeIcon) this.elements.darkModeIcon.textContent = isDarkMode ? 'nightlight' : 'clear_day';
  },

  // ui.js:695-699
  toggleDock(): void {
    // Non gardé dans l'original (ui.js:696) : cast de typage pur.
    const dockCollapsed = (this.elements.dockMenu as HTMLElement).classList.toggle('collapsed');
    // localStorage.setItem exige une string : String(boolean) reproduit la
    // coercion DOMString native que l'original obtenait implicitement.
    localStorage.setItem('dockCollapsed', String(dockCollapsed));
    if (this.elements.dockToggleIcon) this.elements.dockToggleIcon.textContent = dockCollapsed ? 'expand_less' : 'expand_more';
  },

  // ui.js:701-706
  toggleSearchMode(): void {
    (document.getElementById('search_container') as HTMLElement).style.display = 'block';
    (document.querySelector('.form-row.main-fields') as HTMLElement).style.display = 'none';
    (document.getElementById('addLogBtn') as HTMLElement).style.display = 'none';
    (document.getElementById('searchInput') as HTMLInputElement).focus();
  },

  // ui.js:708-714
  closeSearchMode(): void {
    (document.getElementById('search_container') as HTMLElement).style.display = 'none';
    (document.querySelector('.form-row.main-fields') as HTMLElement).style.display = '';
    (document.getElementById('addLogBtn') as HTMLElement).style.display = '';
    (document.getElementById('searchInput') as HTMLInputElement).value = '';
    this.filterLogs();
  },

  // ui.js:716-720
  filterLogs(): void {
    const query = (document.getElementById('searchInput') as HTMLInputElement).value.toLowerCase();
    const rows = document.querySelectorAll<HTMLElement>('#logTable tbody tr');
    rows.forEach((row) => { row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none'; });
  },

  // ui.js:722-725
  showResetModal(): void {
    (document.getElementById('resetModal') as HTMLDialogElement).showModal();
  },

  // ui.js:727-731
  hideResetModal(): void {
    (document.getElementById('resetModal') as HTMLDialogElement).close();
    this.hideEditModal();
  },

  /** Décision 17 — la modification ouvre la MÊME fiche que la création. */
  async showEditAdversaryModal(id: string): Promise<void> {
    await openFiche('adv', id);
  },

  async showEditHostageModal(id: string): Promise<void> {
    await openFiche('host', id);
  },

};

// ui.js:884-890 — façades window.*, posées AU SCOPE MODULE (SPEC-PCTAC-CONVERSION.md §4)
window.UI = UI;
window.openEditModal = UI.openEditModal.bind(UI);
window.switchMainView = UI.switchMainView.bind(UI);
window.toggleSearchMode = UI.toggleSearchMode.bind(UI);
window.closeSearchMode = UI.closeSearchMode.bind(UI);
window.filterLogs = UI.filterLogs.bind(UI);
