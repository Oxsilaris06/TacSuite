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
 * Cf. docs/SPEC-PCTAC-CONVERSION.md §1.1, §3 (stratégie onclick), §4 (window.*
 * au scope module), §6 (accès localStorage directs conservés), §9 (pièges).
 *
 * POINT CRUCIAL (SPEC-PCTAC-CONVERSION.md §3.2) : les `onclick="..."` générés
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

import type { PctacLogEntry, UIContract } from '@shared/types/contracts.js';
import { PDF_PAX_COLORS, FREE_MODE_COLORS, LONG_PRESS_DELAY, PHOTO_CATEGORIES } from '@pctac/config.js';
import { Storage } from '@pctac/storage.js';
import { ImageStore } from '@pctac/image-store.js';
import { LogManager } from '@pctac/log-manager.js';
import { esc } from '@shared/ui-platform.js';
import { confirmDialog } from '@shared/feedback.js';

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
    document.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
      const active = btn.dataset.view === viewId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active)); // U10 (a11y onglets)
    });
    document.querySelectorAll('.tab-content-view').forEach((view) => {
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
        };

        if (this.elements.paxInput && this.elements.paxInput.value === key) btn.classList.add('selected');
      });
    }
    this.renderCustomPaxOptions();

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
  renderLogTable(logData: readonly PctacLogEntry[]): void {
    const tbody = this.elements.logTableBody;
    if (!tbody) return;
    tbody.innerHTML = '';
    // U11 — état vide explicite plutôt qu'un tableau muet.
    if (logData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Aucun événement enregistré</td></tr>';
      return;
    }
    logData.forEach((entry) => {
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
        paxText = paxInfo.text;
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
    (document.getElementById('edit_heure') as HTMLInputElement).value = entry.heure;
    (document.getElementById('edit_lieu') as HTMLTextAreaElement).value = entry.lieu || '';
    (document.getElementById('edit_remarques') as HTMLTextAreaElement).value = entry.remarques || '';
    (document.getElementById('editModal') as HTMLDialogElement).showModal();
  },

  // ui.js:298-311
  confirmEditLog(): void {
    const id = (document.getElementById('edit_id') as HTMLInputElement).value;
    if (!id) return;
    const updated = {
      heure: (document.getElementById('edit_heure') as HTMLInputElement).value,
      lieu: (document.getElementById('edit_lieu') as HTMLTextAreaElement).value.trim(),
      remarques: (document.getElementById('edit_remarques') as HTMLTextAreaElement).value.trim(),
    };
    LogManager.updateEntry(id, updated);
    if (updated.lieu) LogManager.addLieuToHistory(updated.lieu);
    this.renderLogTable(Storage.loadLogData());
    this.refreshLieuSuggestions();
    this.hideEditModal();
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
      const span = document.createElement('span');
      span.className = 'pax-select-option custom';
      span.textContent = paxName;
      span.dataset.pax = paxName;

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

        span.classList.add('selected');
        span.style.background = paxColor;
        span.style.color = this.getContrastYIQ(paxColor);
      };

      span.onclick = selectCustom;
      span.oncontextmenu = (e) => { e.preventDefault(); this.deleteCustomPax(pax.id); };

      let timer: ReturnType<typeof setTimeout> | undefined;
      span.ontouchstart = () => { timer = setTimeout(() => this.deleteCustomPax(pax.id), LONG_PRESS_DELAY); };
      span.ontouchend = () => clearTimeout(timer);
      // Un scroll tactile qui traverse la puce ne doit PAS déclencher la suppression.
      span.ontouchmove = () => clearTimeout(timer);
      span.ontouchcancel = () => clearTimeout(timer);

      if (this.elements.paxInput && this.elements.paxInput.value === paxName) {
        span.classList.add('selected');
        span.style.background = paxColor;
        span.style.color = this.getContrastYIQ(paxColor);
      }

      container.insertBefore(span, addBtn);
    });
  },

  // ui.js:436-466
  async renderAdversaries(): Promise<void> {
    const raw = Storage.loadCollection('pcTacAdversaries') || [];
    const list = await ImageStore.hydrate(raw, 'photo');
    const tbody = document.getElementById('adversary-table-body');
    if (!tbody) return;
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Aucun adversaire — utilisez le formulaire ci-dessus</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((item) => `
            <tr>
                <td style="width: 80px;">
                    ${item.photo ? `<img src="${item.photo}" style="width: 60px; height: 60px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border-glass);">` : '<span class="material-symbols-outlined" style="font-size: 40px; color: var(--text-muted);">person</span>'}
                </td>
                <td>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 0.85em;">
                        <div><strong style="color: var(--accent-blue);">NOM:</strong> ${esc(item.nom)}</div>
                        <div><strong style="color: var(--accent-blue);">PRÉNOM:</strong> ${esc(item.prenom)}</div>
                        <div><strong style="color: var(--accent-blue);"><span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">cake</span>:</strong> ${esc(item.dob) || 'N/C'}</div>
                        <div><strong style="color: var(--accent-blue);">LIEN VICTIMES:</strong> ${esc(item.lien) || 'N/C'}</div>
                        <div><strong style="color: var(--accent-blue);">ATTITUDE:</strong> ${esc(item.attitude) || 'N/C'}</div>
                        <div><strong style="color: var(--accent-blue);">SUBSTANCE:</strong> ${esc(item.substance) || 'N/C'}</div>
                        <div style="grid-column: span 3;"><strong style="color: var(--accent-blue);">ANTÉCÉDENTS:</strong> ${esc(item.antecedents) || 'N/C'}</div>
                        <div style="grid-column: span 3;"><strong style="color: var(--accent-blue);">ARMES:</strong> ${esc(item.armes) || 'N/C'}</div>
                    </div>
                </td>
                <td style="width: 50px;">
                    <div style="display: flex; gap: 5px;">
                        <button class="action-btn-small edit" onclick="window.UI.showEditAdversaryModal('${item.id}')" title="Modifier" aria-label="Modifier cet adversaire"><span class="material-symbols-outlined" style="font-size: 18px;">edit</span></button>
                        <button class="delete-btn" onclick="window.deleteCollectionItem('pcTacAdversaries', '${item.id}', 'view-adversaires')" aria-label="Supprimer cet adversaire"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
                    </div>
                </td>
            </tr>
        `).join('');
  },

  // ui.js:468-496
  async renderHostages(): Promise<void> {
    const raw = Storage.loadCollection('pcTacHostages') || [];
    const list = await ImageStore.hydrate(raw, 'photo');
    const tbody = document.getElementById('hostage-table-body');
    if (!tbody) return;
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Aucun otage — utilisez le formulaire ci-dessus</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((item) => `
            <tr>
                <td style="width: 80px;">
                    ${item.photo ? `<img src="${item.photo}" style="width: 60px; height: 60px; border-radius: 4px; object-fit: cover; border: 1px solid var(--border-glass);">` : '<span class="material-symbols-outlined" style="font-size: 40px; color: var(--text-muted);">person</span>'}
                </td>
                <td>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 0.85em;">
                        <div><strong style="color: var(--civil-yellow);">NOM:</strong> ${esc(item.nom)}</div>
                        <div><strong style="color: var(--civil-yellow);">PRÉNOM:</strong> ${esc(item.prenom)}</div>
                        <div><strong style="color: var(--civil-yellow);"><span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">cake</span>:</strong> ${esc(item.dob) || 'N/C'}</div>
                        <div><strong style="color: var(--civil-yellow);">LIEN ADV:</strong> ${esc(item.lien) || 'N/C'}</div>
                        <div><strong style="color: var(--civil-yellow);">ÉTAT:</strong> ${esc(item.etat) || 'N/C'}</div>
                        <div><strong style="color: var(--civil-yellow);">BLESSURES:</strong> ${esc(item.blessures) || 'N/C'}</div>
                    </div>
                </td>
                <td style="width: 50px;">
                    <div style="display: flex; gap: 5px;">
                        <button class="action-btn-small edit" onclick="window.UI.showEditHostageModal('${item.id}')" title="Modifier" aria-label="Modifier cet otage"><span class="material-symbols-outlined" style="font-size: 18px;">edit</span></button>
                        <button class="delete-btn" onclick="window.deleteCollectionItem('pcTacHostages', '${item.id}', 'view-otages')" aria-label="Supprimer cet otage"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
                    </div>
                </td>
            </tr>
        `).join('');
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
    const filteredList = await ImageStore.hydrate(preFiltered, 'data');

    // Mise à jour des boutons de filtre pour respecter l'ordre et le style
    const filterContainer = document.getElementById('photo-filter-container');
    if (filterContainer) {
      filterContainer.innerHTML = PHOTO_CATEGORIES.map((cat) => `
                <button class="tab-btn ${filterCategory === cat.id ? 'active' : ''}" onclick="UI.renderPhotos('${cat.id}')" style="padding: 6px 12px; font-size: 0.8em; width: auto; flex-direction: row; min-height: unset;">
                    <span>${cat.label}</span>
                </button>
            `).join('');
    }
    localStorage.setItem('lastPhotoFilter', filterCategory);

    // Sélection automatique de la catégorie correspondante dans le formulaire si ce n'est pas "all"
    const catSelect = document.getElementById('photo_category') as HTMLSelectElement | null;
    if (catSelect && filterCategory !== 'all') {
      catSelect.value = filterCategory;
    }

    board.innerHTML = filteredList.length === 0 ? emptyMsg : filteredList.map((item) => `
            <div class="photo-card" draggable="true" data-id="${item.id}" data-category="${item.category}" data-status="${item.status || 'active'}" ondragstart="UI.handlePhotoDragStart(event)" ondragover="UI.handlePhotoDragOver(event)" ondrop="UI.handlePhotoDrop(event)" ondragend="UI.handlePhotoDragEnd()">
                <img src="${item.data}" onclick="UI.openLightbox('${item.data}', '${esc(String(item.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')" alt="${esc(item.title)}">
                <div style="padding: 10px; display: flex; flex-direction: column; gap: 5px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="photo-title-text" style="font-size: 0.9em; font-weight: bold;">${esc(item.title)}</span>
                        <div style="display: flex; gap: 5px;">
                            <button class="action-btn-small edit" title="Renommer" onclick="window.UI.editPhotoTitle('${item.id}')" aria-label="Renommer cette photo"><span class="material-symbols-outlined" style="font-size: 16px;">edit</span></button>
                            <button class="action-btn-small delete" title="Supprimer" onclick="window.deleteCollectionItem('pcTacPhotos', '${item.id}', 'view-photos')" aria-label="Supprimer cette photo"><span class="material-symbols-outlined" style="font-size: 16px;">delete</span></button>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.7em; color: var(--text-muted); text-transform: uppercase;">${(PHOTO_CATEGORIES.find((c) => c.id === item.category) || { label: 'Autre' }).label}</span>
                        ${(item.category === 'neutralized' || item.category === 'trap') ? `
                            <select onchange="UI.updateAdversaryStatus('${item.id}', this.value)" style="font-size: 0.7em; padding: 2px 20px 2px 5px; height: auto; min-height: unset; width: auto; background-position: right 2px center;">
                                <option value="active" ${item.status === 'active' || !item.status ? 'selected' : ''}>Actif</option>
                                <option value="neutralized" ${item.status === 'neutralized' ? 'selected' : ''}>Neutralisé</option>
                            </select>
                        ` : ''}
                        ${item.category === 'hostage' ? `
                            <select onchange="UI.updateAdversaryStatus('${item.id}', this.value)" style="font-size: 0.7em; padding: 2px 20px 2px 5px; height: auto; min-height: unset; width: auto; background-position: right 2px center;">
                                <option value="ok" ${item.status === 'ok' || !item.status ? 'selected' : ''}>OK</option>
                                <option value="preoccupant" ${item.status === 'preoccupant' ? 'selected' : ''}>Préoccupant</option>
                                <option value="blesse" ${item.status === 'blesse' ? 'selected' : ''}>Blessé</option>
                                <option value="dcd" ${item.status === 'dcd' ? 'selected' : ''}>DCD</option>
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

  // ui.js:612-621
  updateAdversaryStatus(id: string, status: string): void {
    const list = Storage.loadCollection('pcTacPhotos');
    const photo = list.find((p) => p.id === id);
    if (photo) {
      photo.status = status;
      Storage.saveCollection('pcTacPhotos', list);
      const currentFilter = localStorage.getItem('lastPhotoFilter') || 'all';
      this.renderPhotos(currentFilter); // Re-render avec le filtre actuel
    }
  },

  // ui.js:623-629
  editPhotoTitle(id: string): void {
    const list = Storage.loadCollection('pcTacPhotos');
    const photo = list.find((p) => p.id === id);
    if (!photo) return;
    const newTitle = prompt('Nouveau titre :', photo.title as string | undefined);
    if (newTitle) { photo.title = newTitle.trim(); Storage.saveCollection('pcTacPhotos', list); this.renderPhotos(); }
  },

  // ui.js:631-643
  openLightbox(src: string, title?: string): void {
    const modal = document.getElementById('lightboxModal') as HTMLDialogElement | null;
    const img = document.getElementById('lightboxImage') as HTMLImageElement | null;
    const titleEl = document.getElementById('lightboxTitle');
    if (!modal || !img) return;
    img.src = src;
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
    this._lightboxKeydown = (e) => { if (e.key === 'Escape') this.closeLightbox(); };
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

  // ui.js:733-755
  async showEditAdversaryModal(id: string): Promise<void> {
    const list = Storage.loadCollection('pcTacAdversaries');
    const item = list.find((adv) => adv.id === id);
    if (!item) return;

    (document.getElementById('edit_adv_id') as HTMLInputElement).value = id;
    const fields = ['nom', 'prenom', 'dob', 'lien', 'antecedents', 'attitude', 'substance', 'armes'];
    fields.forEach((f) => {
      const el = document.getElementById('edit_adv_' + f) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) el.value = (item[f] as string | undefined) || '';
    });
    const preview = document.getElementById('edit_adv_preview') as HTMLElement;
    const existingPhoto = await ImageStore.get(id);
    preview.innerHTML = existingPhoto
      ? `<img src="${existingPhoto}" style="width: 100%; height: 100%; object-fit: cover;">`
      : '<span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-muted);">person</span>';

    const fileInput = document.getElementById('edit_adv_photo_input') as HTMLInputElement | null;
    if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }

    (document.getElementById('editAdversaryModal') as HTMLDialogElement).showModal();
  },

  // ui.js:757-760
  hideEditAdversaryModal(): void {
    (document.getElementById('editAdversaryModal') as HTMLDialogElement).close();
  },

  // ui.js:762-806
  async handleAdversaryUpdate(): Promise<void> {
    const id = (document.getElementById('edit_adv_id') as HTMLInputElement).value;
    if (!id) return;
    const advList = Storage.loadCollection('pcTacAdversaries');
    const adv = advList.find((a) => a.id === id);
    if (!adv) { this.hideEditAdversaryModal(); return; }

    const fields = ['nom', 'prenom', 'dob', 'lien', 'antecedents', 'attitude', 'substance', 'armes'];
    fields.forEach((f) => {
      const el = document.getElementById('edit_adv_' + f) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) adv[f] = el.value.trim();
    });

    const fileInput = document.getElementById('edit_adv_photo_input') as HTMLInputElement | null;
    const dataUrl = fileInput && fileInput.dataset.compressedBase64;
    if (dataUrl) {
      await ImageStore.put(id, dataUrl);
      delete adv.photo;
      adv.hasImage = true;

      const photoList = Storage.loadCollection('pcTacPhotos');
      const photoSyncId = id + '_sync';
      await ImageStore.put(photoSyncId, dataUrl);
      // ui.js:785 utilise `let photo` ; jamais réassignée ⇒ `const` imposé par
      // la règle ESLint prefer-const du projet (adaptation de style pure).
      const photo = photoList.find((p) => p.id === photoSyncId);
      if (photo) {
        delete photo.data;
        photo.hasImage = true;
        photo.title = `${adv.nom} ${adv.prenom}`;
      } else {
        photoList.push({
          id: photoSyncId,
          title: `${adv.nom} ${adv.prenom}`,
          category: 'neutralized',
          status: 'active',
          hasImage: true,
        });
      }
      Storage.saveCollection('pcTacPhotos', photoList);
    }

    Storage.saveCollection('pcTacAdversaries', advList);
    this.hideEditAdversaryModal();
    await this.renderAdversaries();
    if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }
  },

  // ui.js:808-830
  async showEditHostageModal(id: string): Promise<void> {
    const list = Storage.loadCollection('pcTacHostages');
    const item = list.find((h) => h.id === id);
    if (!item) return;

    (document.getElementById('edit_host_id') as HTMLInputElement).value = id;
    const fields = ['nom', 'prenom', 'dob', 'lien', 'etat', 'blessures'];
    fields.forEach((f) => {
      const el = document.getElementById('edit_host_' + f) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) el.value = (item[f] as string | undefined) || '';
    });
    const preview = document.getElementById('edit_host_preview') as HTMLElement;
    const existingPhoto = await ImageStore.get(id);
    preview.innerHTML = existingPhoto
      ? `<img src="${existingPhoto}" style="width: 100%; height: 100%; object-fit: cover;">`
      : '<span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-muted);">person_off</span>';

    const fileInput = document.getElementById('edit_host_photo_input') as HTMLInputElement | null;
    if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }

    (document.getElementById('editHostageModal') as HTMLDialogElement).showModal();
  },

  // ui.js:832-835
  hideEditHostageModal(): void {
    (document.getElementById('editHostageModal') as HTMLDialogElement).close();
  },

  // ui.js:837-881
  async handleHostageUpdate(): Promise<void> {
    const id = (document.getElementById('edit_host_id') as HTMLInputElement).value;
    if (!id) return;
    const list = Storage.loadCollection('pcTacHostages');
    const host = list.find((h) => h.id === id);
    if (!host) { this.hideEditHostageModal(); return; }

    const fields = ['nom', 'prenom', 'dob', 'lien', 'etat', 'blessures'];
    fields.forEach((f) => {
      const el = document.getElementById('edit_host_' + f) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) host[f] = el.value.trim();
    });

    const fileInput = document.getElementById('edit_host_photo_input') as HTMLInputElement | null;
    const dataUrl = fileInput && fileInput.dataset.compressedBase64;
    if (dataUrl) {
      await ImageStore.put(id, dataUrl);
      delete host.photo;
      host.hasImage = true;

      const photoList = Storage.loadCollection('pcTacPhotos');
      const photoSyncId = id + '_sync';
      await ImageStore.put(photoSyncId, dataUrl);
      // ui.js:860 utilise `let photo` ; jamais réassignée ⇒ `const` imposé par
      // la règle ESLint prefer-const du projet (adaptation de style pure).
      const photo = photoList.find((p) => p.id === photoSyncId);
      if (photo) {
        delete photo.data;
        photo.hasImage = true;
        photo.title = `${host.nom} ${host.prenom}`;
      } else {
        photoList.push({
          id: photoSyncId,
          title: `${host.nom} ${host.prenom}`,
          category: 'hostage',
          status: 'ok',
          hasImage: true,
        });
      }
      Storage.saveCollection('pcTacPhotos', photoList);
    }

    Storage.saveCollection('pcTacHostages', list);
    this.hideEditHostageModal();
    await this.renderHostages();
    if (fileInput) { fileInput.value = ''; delete fileInput.dataset.compressedBase64; }
  },
};

// ui.js:884-890 — façades window.*, posées AU SCOPE MODULE (SPEC-PCTAC-CONVERSION.md §4)
window.UI = UI;
window.openEditModal = UI.openEditModal.bind(UI);
window.switchMainView = UI.switchMainView.bind(UI);
window.toggleSearchMode = UI.toggleSearchMode.bind(UI);
window.closeSearchMode = UI.closeSearchMode.bind(UI);
window.filterLogs = UI.filterLogs.bind(UI);
