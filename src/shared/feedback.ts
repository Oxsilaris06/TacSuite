/**
 * feedback.ts — Système de notifications intégré partagé (R2-T2a).
 * =====================================================================
 *
 * Remplace les `alert()`/`confirm()` natifs du navigateur (bloquants,
 * inaccessibles, non stylables) par deux primitives :
 *   - `toast(message, opts)`      — notification empilable, coin bas, non
 *     bloquante. Remplace `alert()`.
 *   - `confirmDialog(opts)`       — `<dialog>` natif modal, `Promise<boolean>`.
 *     Remplace `confirm()`.
 *
 * Zéro dépendance app : ce module n'importe rien de `@pctac/*`/`@oi/*`, ne
 * pose aucun `window.*`, et injecte son propre `<style>` (pattern
 * `injectStyles` de `src/shared/tuto-engine.ts`) plutôt que de dépendre des
 * classes `.modal`/`.toast` propres à chaque app. Les seules dépendances
 * externes sont les tokens globaux `--tac-*` (`styles/tacsuite-tokens.css`,
 * toujours chargée avant la feuille d'app) et 5 variables sémantiques
 * COMMUNES aux deux apps (vérifiées dans `styles/pctac.css` ET
 * `styles/oi.css`, thèmes sombre et clair) : `--bg-container`, `--text-main`,
 * `--border-light`, `--accent-fill`, `--danger-red`, `--font-ui`.
 *
 * PC-Tac consomme ce module dès R2-T2a ; OI sera branché dans une tranche
 * suivante (mission R2-T2a, scope PC-Tac uniquement).
 *
 * `<dialog>` : `showModal()`/`close()` sont absents de jsdom 30 (cf.
 * `tests/unit/pctac/pm-pingmodal.test.ts:103`, même constat) — chaque usage
 * est donc gardé par un test `typeof … === 'function'` avec repli sur
 * `setAttribute('open', '')` / résolution manuelle, à l'identique du pattern
 * déjà en place dans `src/apps/oi/patrac.ts:1341` et
 * `src/apps/oi/formulaires.ts:1520`.
 */

/* =========================================================================
 * Types publics
 * ========================================================================= */

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  /** Appelée UNE seule fois, au clic sur le bouton d'action (le toast se ferme ensuite). */
  onClick: () => void;
}

export interface ToastOptions {
  /** @default 'info' */
  kind?: ToastKind;
  /** Durée d'affichage en ms avant disparition auto. `0` = persistant (fermeture manuelle uniquement). @default 4000 */
  duration?: number;
  /**
   * Action boutonnée dans le toast (ex. « Annuler »). Rendue comme un vrai
   * `<button type="button">` (cible tactile ≥ 44 px, visible au clavier). Un
   * clic dessus appelle `onClick` une fois PUIS ferme le toast ; un clic sur le
   * corps du toast ferme sans appeler l'action.
   */
  action?: ToastAction;
}

export type BannerLevel = 'info' | 'important' | 'alert';

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface BannerOptions {
  message: string;
  level: BannerLevel;
  /** Boutons d'action, dans l'ordre. */
  actions?: readonly BannerAction[];
  /** Affiche le bouton × (défaut `true`). */
  dismissible?: boolean;
  /** Appelée au clic sur le ×, une fois. */
  onDismiss?: () => void;
}

export interface ConfirmDialogOptions {
  /** Titre optionnel (omis si absent — le message seul suffit dans la plupart des cas). */
  title?: string;
  message: string;
  /** @default 'Confirmer' */
  confirmLabel?: string;
  /** @default 'Annuler' */
  cancelLabel?: string;
  /** Action destructive (reset/suppression/purge) : bouton OK en rouge, focus initial sur Annuler. @default false */
  danger?: boolean;
  /**
   * Troisième voie optionnelle (R9 point 3) : un bouton neutre supplémentaire.
   * `confirmDialog` rend alors `'extra'` quand il est choisi, `true` pour OK,
   * `false` pour Annuler / Échap / clic sur le fond.
   */
  extraLabel?: string;
}

/** Résultat d'un `confirmDialog` : `true` (OK), `false` (annulé) ou `'extra'`. */
export type ConfirmDialogResult = boolean | 'extra';

/* =========================================================================
 * Styles injectés (une seule fois, à la première utilisation)
 * ========================================================================= */

const STYLE_ID = 'tac-feedback-styles';
/** Au-dessus de tout, y compris les `<dialog>` propres à chaque app (`--z-dialog`/`--z-top` locaux ≤3000) — même idiome que `tuto-engine.ts` (`Z = 2147483000`). */
const TOP_Z = 2147483000;
/** Compteur d'identifiants de titre : deux dialogues peuvent coexister (cf. tests), l'`id` ciblé par `aria-labelledby` doit rester unique. */
let dialogUid = 0;

/** Pose les styles des toasts, bandeaux et fenêtres (idempotent) ; exporté pour les fenêtres bâties ailleurs sur le même socle. */
export function ensureFeedbackStyles(): void {
  injectStyles();
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
/* Centré par left/right: 0 + margin auto, avec une largeur PROPRE : calé à
   left: 50%, un élément fixe ne dispose que de la moitié droite de l'écran
   (195 px sur un téléphone de 390 px) et le texte d'un toast à bouton
   s'écrivait une syllabe par ligne (constat UI-1 du 25/09). */
.tac-toast-container {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--tac-space-5, 24px) + env(safe-area-inset-bottom, 0px));
  margin-inline: auto;
  width: min(92vw, 420px);
  z-index: ${TOP_Z};
  display: flex;
  flex-direction: column-reverse;
  gap: var(--tac-space-2, 8px);
  align-items: center;
  pointer-events: none;
}
.tac-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--tac-space-2, 8px);
  padding: var(--tac-space-3, 12px) var(--tac-space-4, 16px);
  border-radius: var(--tac-radius-md, 12px);
  background: var(--bg-container);
  color: var(--text-main);
  border: 1px solid var(--border-light);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font: 500 13.5px/1.4 var(--font-ui, system-ui, sans-serif);
  cursor: pointer;
  max-width: 100%;
  word-break: break-word;
  opacity: 0;
  transform: translateY(12px);
  transition: transform var(--tac-duration-fast, 0.15s) ease-out,
              opacity var(--tac-duration-fast, 0.15s) ease-out;
}
.tac-toast--visible { opacity: 1; transform: translateY(0); }
.tac-toast::before {
  content: '';
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-fill);
}
.tac-toast--success::before { background: #2fb872; }
.tac-toast--error::before { background: var(--danger-red); }
.tac-toast--error { border-color: color-mix(in srgb, var(--danger-red) 45%, var(--border-light)); }
.tac-toast-action {
  appearance: none;
  flex: 0 0 auto;
  margin-left: var(--tac-space-2, 8px);
  min-height: 44px;
  padding: 0 var(--tac-space-4, 16px);
  border: 1px solid var(--border-light);
  border-radius: var(--tac-radius-sm, 6px);
  background: transparent;
  color: var(--accent-fill);
  font: 600 13.5px/1 var(--font-ui, system-ui, sans-serif);
  cursor: pointer;
}
.tac-toast-action:focus-visible {
  outline: 2px solid var(--accent-fill);
  outline-offset: 2px;
}

/* Bandeaux persistants : DANS LE FLUX, en tête de <body>. Un bandeau ne doit
   masquer aucune commande ; on pousse donc le contenu au lieu de le recouvrir.
   La zone sûre iOS est respectée (encoche). */
.tac-banner-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}
/* Les jetons PC-Tac/OI (--bg-container, --text-main…) n'existent PAS sur le
   portail (F-2) : on donne des replis sur les jetons du portail, lisibles dans
   les deux thèmes. Un bandeau de portail est donc toujours lisible. */
.tac-banner {
  display: flex;
  align-items: center;
  gap: var(--tac-space-2, 8px);
  padding: var(--tac-space-2, 8px) var(--tac-space-3, 12px);
  padding-top: calc(var(--tac-space-2, 8px) + env(safe-area-inset-top, 0px));
  border: 1px solid var(--border-light, var(--color-border, #3a3f4b));
  border-left-width: 4px;
  border-radius: 0;
  background: var(--bg-container, var(--color-surface, #1b1d24));
  color: var(--text-main, var(--color-text, #e6e8ee));
  font: 500 13.5px/1.4 var(--font-ui, system-ui, sans-serif);
}
.tac-banner--info { border-left-color: var(--accent-fill, var(--color-primary, #3b82f6)); }
.tac-banner--important { border-left-color: #d97706; background: color-mix(in srgb, #d97706 12%, var(--bg-container, var(--color-surface, #1b1d24))); }
.tac-banner--alert { border-left-color: var(--danger-red, var(--color-danger, #c8344a)); background: color-mix(in srgb, var(--danger-red, var(--color-danger, #c8344a)) 14%, var(--bg-container, var(--color-surface, #1b1d24))); }
.tac-banner-message { flex: 1 1 auto; min-width: 0; }
.tac-banner-action {
  appearance: none;
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 var(--tac-space-3, 12px);
  border: 1px solid var(--border-light, var(--color-border, #3a3f4b));
  border-radius: var(--tac-radius-sm, 6px);
  background: transparent;
  color: var(--text-main, var(--color-text, #e6e8ee));
  font: 600 13.5px/1 var(--font-ui, system-ui, sans-serif);
  cursor: pointer;
}
.tac-banner-close {
  appearance: none;
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  border: none;
  border-radius: var(--tac-radius-sm, 6px);
  background: transparent;
  color: var(--text-main, var(--color-text, #e6e8ee));
  font: 600 20px/1 var(--font-ui, system-ui, sans-serif);
  cursor: pointer;
}
.tac-banner-action:focus-visible,
.tac-banner-close:focus-visible {
  outline: 2px solid var(--accent-fill, var(--color-primary, #3b82f6));
  outline-offset: 2px;
}

/* F-1 : sous ~560 px, le message prend toute la largeur et les actions passent
   dessous (au lieu d'écraser le texte dans une colonne étroite). */
@media (max-width: 560px) {
  /* Texte sur toute la largeur disponible, croix en haut à droite à côté du
     texte (essai réel du 09-25 : seule sur une deuxième ligne, elle gaspillait
     ~60 px), boutons d'action dessous, calés à droite. */
  .tac-banner { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
  .tac-banner-message { grid-column: 1; grid-row: 1; align-self: center; }
  .tac-banner-close { grid-column: 2; grid-row: 1; }
  .tac-banner-action { grid-column: 1 / -1; justify-self: end; }
}

.tac-confirm-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  width: 92%;
  max-width: 420px;
  padding: var(--tac-space-5, 24px);
  border: 1px solid var(--border-light);
  border-radius: var(--tac-radius-md, 12px);
  background: var(--bg-container);
  color: var(--text-main);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  z-index: ${TOP_Z};
  font: 400 14px/1.5 var(--font-ui, system-ui, sans-serif);
}
.tac-confirm-dialog::backdrop {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}
.tac-confirm-title {
  margin: 0 0 var(--tac-space-2, 8px);
  font-size: 16px;
  font-weight: 700;
}
.tac-confirm-message {
  margin: 0;
  white-space: pre-line;
}
.tac-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--tac-space-2, 8px);
  margin-top: var(--tac-space-5, 24px);
}
/* Pas de raccourci font : « font: 600 13.5px/1 inherit » était invalide
   (inherit ne peut pas servir de famille) et donc ignoré ; les boutons
   prennent la typographie de boutons de l'application, comme avant. */
.tac-confirm-btn {
  appearance: none;
  min-height: 44px;
  border: 1px solid var(--border-light);
  border-radius: var(--tac-radius-sm, 6px);
  padding: var(--tac-space-2, 8px) var(--tac-space-4, 16px);
  cursor: pointer;
  background: transparent;
  color: var(--text-main);
}
.tac-confirm-btn--ok {
  background: var(--accent-fill);
  border-color: var(--accent-fill);
  color: #fff;
}
.tac-confirm-btn--ok.tac-confirm-btn--danger {
  background: var(--danger-red);
  border-color: var(--danger-red);
}

.tac-confirm-input {
  width: 100%;
  min-height: 44px;
  margin-top: var(--tac-space-2, 8px);
  padding: 8px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--tac-radius-sm, 8px);
  background: transparent;
  color: var(--text-main);
  font-family: var(--font-ui, system-ui);
  font-size: 0.95em;
}

@media (prefers-reduced-motion: reduce) {
  .tac-toast { transition: none; }
}
`;
  document.head.appendChild(style);
}

/* =========================================================================
 * toast()
 * ========================================================================= */

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_TOAST_DURATION = 4000;
/** Doit couvrir la durée de la transition CSS (`--tac-duration-fast`, 150ms) avant retrait du DOM. */
const LEAVE_DELAY_MS = 200;
/** Délai d'annulation par défaut d'un `undoableToast` (décision 31). */
export const UNDO_DELAY_MS = 10_000;

interface ToastTimer {
  /** Timeout courant (recréé à chaque reprise). */
  id: ReturnType<typeof setTimeout>;
  /** Temps restant avant retrait, en ms. */
  remaining: number;
  /** Instant de départ du décompte en cours. */
  startedAt: number;
  /** Pointeur posé sur le toast (R12) : suspend le décompte. */
  hovered: boolean;
  /** Focus clavier dans le toast (R12) : suspend le décompte. */
  focused: boolean;
  /** Vrai quand le minuteur est actuellement suspendu. */
  paused: boolean;
}

const toastTimers = new WeakMap<HTMLElement, ToastTimer>();
/**
 * Rappel appelé quand un toast disparaît SANS que son action ait été utilisée
 * (expiration, éviction, `pagehide`, clic sur le corps). Sert au « commit »
 * d'un toast d'annulation.
 */
const toastOnDismiss = new WeakMap<HTMLElement, () => void>();
/** Un toast ne se règle qu'une fois : protège double clic et double timer. */
const toastDone = new WeakSet<HTMLElement>();
/** Toasts d'annulation en attente : `pagehide` doit les « committer ». */
const undoableToasts = new Set<HTMLElement>();
let pagehideInstalled = false;
let undoShortcutInstalled = false;

/** Démarre (ou redémarre) le décompte d'un toast. */
function startToastTimer(el: HTMLElement, duration: number): void {
  const id = setTimeout(() => removeToast(el), duration);
  toastTimers.set(el, { id, remaining: duration, startedAt: Date.now(), hovered: false, focused: false, paused: false });
}

/**
 * Recalcule l'état de pause d'un toast (R12). Deux causes indépendantes — le
 * pointeur (`hovered`) et le focus clavier (`focused`) — mais UN SEUL décompte :
 * on ne retranche le temps écoulé qu'au passage de « aucune cause » à « au moins
 * une », et on ne reprend que quand les DEUX sont fausses. Sans cela, deux
 * pauses successives retranchaient deux fois le temps et un `pointerleave`
 * relançait le minuteur alors que le focus était toujours dessus (C7).
 */
function applyPauseState(el: HTMLElement): void {
  const timer = toastTimers.get(el);
  if (!timer) return;
  const shouldPause = timer.hovered || timer.focused;
  if (shouldPause && !timer.paused) {
    clearTimeout(timer.id);
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
    timer.paused = true;
    return;
  }
  if (!shouldPause && timer.paused) {
    timer.startedAt = Date.now();
    timer.id = setTimeout(() => removeToast(el), timer.remaining);
    timer.paused = false;
  }
}

/** Le pointeur entre sur le toast (`true`) ou en sort (`false`). */
function setToastHovered(el: HTMLElement, hovered: boolean): void {
  const timer = toastTimers.get(el);
  if (!timer) return;
  timer.hovered = hovered;
  applyPauseState(el);
}

/** Le focus clavier entre dans le toast (`true`) ou en sort (`false`). */
function setToastFocused(el: HTMLElement, focused: boolean): void {
  const timer = toastTimers.get(el);
  if (!timer) return;
  timer.focused = focused;
  applyPauseState(el);
}

/** Dernier toast d'annulation encore ouvert (annulé par Ctrl+Z). */
function lastUndoableToast(): HTMLElement | null {
  let last: HTMLElement | null = null;
  for (const el of undoableToasts) last = el;
  return last;
}

/** Vrai si la cible clavier est un champ éditable (on ne vole pas Ctrl+Z). */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable === true;
}

/**
 * Raccourci global Ctrl+Z / Cmd+Z (R12) : annule la DERNIÈRE suppression si le
 * focus n'est pas dans un champ éditable (sinon on volerait l'annulation de
 * frappe). Sans toast d'annulation ouvert, la touche n'est pas interceptée.
 */
function ensureUndoShortcut(): void {
  if (undoShortcutInstalled) return;
  undoShortcutInstalled = true;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('keydown', (event) => {
    // K4/C3 : un Ctrl+Z DÉJÀ traité (ex. l'annulation de dessin du Plan, qui
    // pose `preventDefault`) ne doit pas annuler en plus la dernière
    // suppression : une frappe = une action.
    if (event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    // Ctrl+Maj+Z (rétablir) n'est PAS une annulation de suppression.
    if (event.shiftKey || event.altKey) return;
    if (event.key !== 'z' && event.key !== 'Z') return;
    if (isEditableTarget(event.target)) return;
    const el = lastUndoableToast();
    if (!el) return;
    const button = el.querySelector<HTMLButtonElement>('[data-tac-toast-action="undo"]');
    if (!button) return;
    event.preventDefault();
    button.click();
  });
}

function ensureToastContainer(): HTMLElement {
  let el = document.getElementById('tac-toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tac-toast-container';
    el.className = 'tac-toast-container';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  // Recalculé à chaque toast : le dock peut être replié ou déplié entre-temps.
  el.style.bottom = toastBottomOffset();
  return el;
}

/**
 * Hauteur à laisser libre en bas d'écran. Le dock flottant des applications
 * (`#dockMenu`, PC-Tac et OI, fixé en bas au centre comme les toasts) passait
 * sous les toasts : le toast masquait le dock (constat UI-1 du 25/09). Rend ''
 * (position de la feuille) sans dock rendu dans la moitié basse de l'écran.
 */
function toastBottomOffset(): string {
  const dock = document.getElementById('dockMenu');
  if (!dock) return '';
  const r = dock.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.height === 0 || r.top < vh / 2) return '';
  return `${Math.round(vh - r.top + 8)}px`;
}

/**
 * Retire un toast du DOM. `actionUsed` distingue l'action (ou « Annuler ») d'une
 * fermeture passive : seule cette dernière déclenche `onDismiss`.
 */
function removeToast(el: HTMLElement, actionUsed = false): void {
  const timer = toastTimers.get(el);
  if (timer !== undefined) clearTimeout(timer.id);
  toastTimers.delete(el);
  undoableToasts.delete(el);
  if (!toastDone.has(el)) {
    toastDone.add(el);
    if (!actionUsed) {
      const onDismiss = toastOnDismiss.get(el);
      toastOnDismiss.delete(el);
      if (onDismiss) {
        try {
          onDismiss();
        } catch {
          // Un raccord en échec ne doit jamais remonter jusqu'à l'utilisateur.
        }
      }
    }
  }
  if (!el.isConnected) return;
  el.classList.remove('tac-toast--visible');
  setTimeout(() => el.remove(), LEAVE_DELAY_MS);
}

/** Installe UN SEUL écouteur `pagehide` global pour committer les annulations. */
function ensurePagehideListener(): void {
  if (pagehideInstalled) return;
  pagehideInstalled = true;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('pagehide', () => {
    // Copie : `removeToast` retire l'élément de l'ensemble pendant l'itération.
    for (const el of Array.from(undoableToasts)) removeToast(el);
  });
}

interface BuildToastConfig {
  message: string;
  kind: ToastKind;
  duration: number;
  action?: ToastAction;
  /** Variante du bouton d'action (lecture/test) : action simple ou « Annuler ». */
  actionVariant?: 'action' | 'undo';
  onDismiss?: () => void;
}

function buildToast(config: BuildToastConfig): HTMLElement {
  injectStyles();
  const container = ensureToastContainer();

  const visible = Array.from(container.children) as HTMLElement[];
  // Même message déjà affiché, sans bouton : on relance son décompte au lieu
  // d'empiler un doublon (trois « Événement ajouté » couvraient le bouton
  // d'ajout, constat UI-1 du 25/09). Un toast à action n'est jamais fusionné.
  if (!config.action) {
    const same = visible.find((c) => !toastDone.has(c) && !c.querySelector('button')
      && c.textContent === config.message && c.classList.contains(`tac-toast--${config.kind}`));
    if (same) {
      const timer = toastTimers.get(same);
      if (timer) clearTimeout(timer.id);
      toastTimers.delete(same);
      if (config.duration > 0) startToastTimer(same, config.duration);
      return same;
    }
  }
  if (visible.length >= MAX_VISIBLE_TOASTS) {
    const oldest = visible[0];
    // L'éviction d'un toast d'annulation vaut « commit » (décision 31).
    if (oldest) removeToast(oldest);
  }

  const el = document.createElement('div');
  el.className = `tac-toast tac-toast--${config.kind}`;
  el.setAttribute('role', config.kind === 'error' ? 'alert' : 'status');
  el.textContent = config.message;
  if (config.onDismiss) toastOnDismiss.set(el, config.onDismiss);

  if (config.action) {
    const action = config.action;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tac-toast-action';
    btn.textContent = action.label;
    btn.dataset.tacToastAction = config.actionVariant ?? 'action';
    btn.addEventListener('click', (ev) => {
      // Le clic ne doit pas remonter au corps du toast (qui fermerait sans agir).
      ev.stopPropagation();
      if (toastDone.has(el)) return;
      action.onClick();
      removeToast(el, true);
    });
    el.appendChild(btn);
  }

  el.addEventListener('click', () => removeToast(el));
  container.appendChild(el);
  // Reflow avant d'ajouter la classe d'entrée, pour que la transition joue
  // (en environnement sans rAF réel — ex. jsdom — le timeout 0 suffit aussi).
  requestAnimationFrame(() => el.classList.add('tac-toast--visible'));

  if (config.duration > 0) {
    startToastTimer(el, config.duration);
  }
  // R12 : un toast d'annulation ne doit pas s'évanouir pendant que
  // l'utilisateur le vise ou l'a au clavier.
  if (config.actionVariant === 'undo') {
    el.addEventListener('pointerenter', () => setToastHovered(el, true));
    el.addEventListener('pointerleave', () => setToastHovered(el, false));
    el.addEventListener('focusin', () => setToastFocused(el, true));
    el.addEventListener('focusout', () => setToastFocused(el, false));
  }
  return el;
}

/**
 * Affiche une notification empilable en bas d'écran. Non bloquante (à la
 * différence d'`alert()`), se ferme au clic ou après `duration` ms.
 * Au-delà de {@link MAX_VISIBLE_TOASTS} visibles, la plus ancienne est
 * retirée immédiatement pour faire de la place.
 */
export function toast(message: string, options: ToastOptions = {}): void {
  const { kind = 'info', duration = DEFAULT_TOAST_DURATION, action } = options;
  const config: BuildToastConfig = { message, kind, duration };
  if (action) config.action = action;
  buildToast(config);
}

/**
 * Toast de suppression avec « Annuler » (décision 31). Exactement UNE des deux
 * fonctions est appelée, une seule fois :
 *   - `onUndo` si l'utilisateur clique « Annuler » avant l'échéance ;
 *   - `onCommit` à l'échéance, quand le toast est chassé par la limite de toasts
 *     visibles, au `pagehide`, ou au clic sur le corps du toast.
 */
export function undoableToast(
  message: string,
  opts: { onUndo: () => void; onCommit?: () => void; duration?: number },
): void {
  ensurePagehideListener();
  ensureUndoShortcut();
  const duration = opts.duration ?? UNDO_DELAY_MS;
  let settled = false;
  const finish = (undo: boolean): void => {
    if (settled) return;
    settled = true;
    if (undo) opts.onUndo();
    else opts.onCommit?.();
  };
  const el = buildToast({
    message: undoMessageWithShortcut(message),
    kind: 'info',
    duration,
    action: { label: 'Annuler', onClick: () => finish(true) },
    actionVariant: 'undo',
    onDismiss: () => finish(false),
  });
  undoableToasts.add(el);
}

/** Libellé du raccourci selon la plateforme (Ctrl+Z / Cmd+Z). */
function undoShortcutLabel(): string {
  try {
    const platform = typeof navigator !== 'undefined' ? navigator.platform : '';
    return /mac|iphone|ipad|ipod/i.test(platform) ? 'Cmd+Z' : 'Ctrl+Z';
  } catch {
    return 'Ctrl+Z';
  }
}

/**
 * Sans pointeur fin (téléphone, tablette tactile), aucun clavier n'est
 * probable : citer Ctrl+Z n'apporte rien (constat UI-1 du 25/09). Sans
 * `matchMedia` (jsdom), on garde l'annonce.
 */
function keyboardLikely(): boolean {
  try {
    return typeof window.matchMedia !== 'function' || window.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return true;
  }
}

/**
 * Annonce accessible : « … supprimé. Ctrl+Z pour annuler. » (R12), réduite à
 * « … supprimé. » sans clavier probable (le bouton « Annuler » reste).
 * Idempotent si l'appelant a déjà mentionné le raccourci.
 */
function undoMessageWithShortcut(message: string): string {
  const trimmed = message.trim();
  if (/pour annuler/i.test(trimmed)) return trimmed;
  const sentence = /[.!?…]\s*$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return keyboardLikely() ? `${sentence} ${undoShortcutLabel()} pour annuler.` : sentence;
}

/* =========================================================================
 * Bandeaux persistants
 * ========================================================================= */

const BANNERS = new Map<string, HTMLElement>();

function bannerContainer(): HTMLElement {
  let el = document.getElementById('tac-banner-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tac-banner-container';
    el.className = 'tac-banner-container';
    // EN TÊTE de <body>, DANS LE FLUX : le contenu de l'app est poussé vers le
    // bas, jamais recouvert (exigence : aucune commande masquée). PC-Tac, l'OI
    // et le portail défilent en flux normal ; les panneaux `position: fixed`
    // plein écran (écran scindé PC-Tac) se décalent sous le conteneur grâce à
    // `--tac-banner-h` (S0, revue du 25/09 : les bandeaux d'appareil de PC-Tac
    // étaient recouverts en écran scindé).
    document.body.insertBefore(el, document.body.firstChild);
    if (typeof ResizeObserver === 'function') new ResizeObserver(publishBannerHeight).observe(el);
  }
  return el;
}

/**
 * Hauteur du conteneur publiée en variable CSS (`--tac-banner-h`) sur
 * `<html>` : les panneaux plein écran en position fixe s'y décalent au lieu
 * de recouvrir les bandeaux.
 */
function publishBannerHeight(): void {
  const el = document.getElementById('tac-banner-container');
  // Bord BAS du conteneur dans le document (un remplissage de <body> décale
  // son haut) : c'est là que l'écran scindé doit commencer.
  const h = el && el.childElementCount ? el.offsetTop + el.offsetHeight : 0;
  document.documentElement.style.setProperty('--tac-banner-h', `${h}px`);
}

function removeBanner(id: string): void {
  const el = BANNERS.get(id);
  if (!el) return;
  el.remove();
  BANNERS.delete(id);
  publishBannerHeight();
}

/**
 * Affiche un bandeau persistant sous `id` (un seul à la fois : un second appel
 * du même `id` le remplace EN PLACE). Texte posé par `textContent` — jamais
 * `innerHTML` : le message peut venir d'Internet (annonce du portail).
 */
export function showBanner(id: string, options: BannerOptions): void {
  const { message, level, actions, dismissible = true, onDismiss } = options;
  injectStyles();
  const container = bannerContainer();

  const el = document.createElement('div');
  el.className = `tac-banner tac-banner--${level}`;
  el.dataset.bannerId = id;
  el.setAttribute('role', level === 'alert' ? 'alert' : 'status');

  const text = document.createElement('span');
  text.className = 'tac-banner-message';
  text.textContent = message;
  el.appendChild(text);

  actions?.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tac-banner-action';
    btn.dataset.bannerAction = '';
    btn.textContent = action.label;
    btn.addEventListener('click', () => action.onClick());
    el.appendChild(btn);
  });

  if (dismissible) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tac-banner-close';
    close.dataset.bannerClose = '';
    close.setAttribute('aria-label', 'Fermer');
    close.textContent = '×';
    close.addEventListener('click', () => {
      removeBanner(id);
      try {
        onDismiss?.();
      } catch {
        // Un raccord en échec ne doit jamais remonter jusqu'à l'utilisateur.
      }
    });
    el.appendChild(close);
  }

  const previous = BANNERS.get(id);
  if (previous && previous.isConnected) {
    // Remplacement EN PLACE : même position dans le conteneur, sans appeler
    // `onDismiss` (ce n'est pas une fermeture par l'utilisateur).
    previous.replaceWith(el);
  } else {
    container.appendChild(el);
  }
  BANNERS.set(id, el);
  publishBannerHeight();
}

/** Retire le bandeau `id` (retrait programmatique : n'appelle pas `onDismiss`). */
export function hideBanner(id: string): void {
  removeBanner(id);
}

/* =========================================================================
 * confirmDialog()
 * ========================================================================= */

/**
 * Ouvre une boîte de confirmation modale (`<dialog>` natif) et résout une
 * fois l'utilisateur·rice statué·e. Remplace `confirm()` — MÊME contrat
 * `Promise<boolean>` (true = confirmé, false = annulé/Escape/clic hors
 * boîte), mais non bloquant pour le thread principal.
 */
export function confirmDialog(options: ConfirmDialogOptions & { extraLabel: string }): Promise<ConfirmDialogResult>;
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean>;
export function confirmDialog(options: ConfirmDialogOptions): Promise<ConfirmDialogResult> {
  const {
    title,
    message,
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    danger = false,
    extraLabel,
  } = options;
  injectStyles();

  return new Promise<ConfirmDialogResult>((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'tac-confirm-dialog';

    if (title) {
      const h = document.createElement('h2');
      h.className = 'tac-confirm-title';
      h.id = `tac-confirm-title-${++dialogUid}`;
      h.textContent = title;
      dialog.appendChild(h);
      // Nom accessible : le titre s'il existe, sinon le message (C9, WCAG 4.1.2).
      dialog.setAttribute('aria-labelledby', h.id);
    } else {
      dialog.setAttribute('aria-label', message);
    }

    const p = document.createElement('p');
    p.className = 'tac-confirm-message';
    p.textContent = message;
    dialog.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'tac-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'tac-confirm-btn tac-confirm-btn--cancel';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.dataset.tacConfirm = 'cancel';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = danger ? 'tac-confirm-btn tac-confirm-btn--ok tac-confirm-btn--danger' : 'tac-confirm-btn tac-confirm-btn--ok';
    okBtn.textContent = confirmLabel;
    okBtn.dataset.tacConfirm = 'ok';

    // R9 point 3 : 3e voie optionnelle, neutre, entre « Annuler » et l'action.
    let extraBtn: HTMLButtonElement | null = null;
    if (extraLabel) {
      extraBtn = document.createElement('button');
      extraBtn.type = 'button';
      extraBtn.className = 'tac-confirm-btn tac-confirm-btn--extra';
      extraBtn.textContent = extraLabel;
      extraBtn.dataset.tacConfirm = 'extra';
    }

    actions.appendChild(cancelBtn);
    if (extraBtn) actions.appendChild(extraBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);

    let settled = false;
    let pendingResult: ConfirmDialogResult = false; // Escape (cancel natif) => false par défaut, sans action explicite.

    function settle(result: ConfirmDialogResult): void {
      if (settled) return;
      settled = true;
      dialog.remove();
      resolve(result);
    }

    function requestClose(result: ConfirmDialogResult): void {
      pendingResult = result;
      if (typeof dialog.close === 'function') {
        try {
          dialog.close();
          return; // le listener 'close' ci-dessous appelle settle().
        } catch {
          /* repli ci-dessous */
        }
      }
      // jsdom (pas de <dialog> natif) ou navigateur sans support : pas
      // d'événement 'close' à attendre, on résout directement.
      settle(result);
    }

    okBtn.addEventListener('click', () => requestClose(true));
    cancelBtn.addEventListener('click', () => requestClose(false));
    if (extraBtn) extraBtn.addEventListener('click', () => requestClose('extra'));
    // Clic sur le fond (le `<dialog>` lui-même, jamais un enfant) = annulation
    // — même piège documenté dans `src/apps/pctac/ui.ts` (backdrop natif).
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) requestClose(false);
    });
    // Escape natif (`<dialog>` réel) : on intercepte 'cancel' pour piloter la
    // fermeture nous-même plutôt que de laisser la UA fermer sans passer par
    // requestClose (résultat déjà `false` par défaut, mais on garde le flux
    // unique pour le nettoyage/résolution).
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      requestClose(false);
    });
    // Repli explicite : sans `showModal()` (jsdom, navigateur ancien), le
    // `<dialog>` n'a aucune sémantique modale native — Escape ne ferme rien
    // sans ce handler manuel.
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') requestClose(false);
    });
    dialog.addEventListener('close', () => settle(pendingResult));

    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }

    (danger ? cancelBtn : okBtn).focus();
  });
}

/* =========================================================================
 * promptDialog — remplaçant des `prompt()` natifs
 * ========================================================================= */

export interface PromptDialogOptions {
  /** Titre optionnel. */
  title?: string;
  /** Libellé au-dessus du champ (équivalent du message de `prompt()`). */
  message: string;
  /** Valeur pré-remplie. @default '' */
  initial?: string;
  placeholder?: string;
  /** @default 'Valider' */
  confirmLabel?: string;
  /** @default 'Annuler' */
  cancelLabel?: string;
}

/**
 * Saisie texte modale sur le même socle que `confirmDialog` (mêmes styles,
 * même repli jsdom). Résout la valeur saisie, ou `null` si annulation
 * (Échap, clic fond, bouton Annuler) — même contrat que `window.prompt`.
 * Entrée = validation.
 */
export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  const {
    title,
    message,
    initial = '',
    placeholder = '',
    confirmLabel = 'Valider',
    cancelLabel = 'Annuler',
  } = options;
  injectStyles();

  return new Promise<string | null>((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'tac-confirm-dialog';

    if (title) {
      const h = document.createElement('h2');
      h.className = 'tac-confirm-title';
      h.id = `tac-confirm-title-${++dialogUid}`;
      h.textContent = title;
      dialog.appendChild(h);
      // Nom accessible : le titre s'il existe, sinon le message (C9, WCAG 4.1.2).
      dialog.setAttribute('aria-labelledby', h.id);
    } else {
      dialog.setAttribute('aria-label', message);
    }

    const p = document.createElement('p');
    p.className = 'tac-confirm-message';
    p.textContent = message;
    dialog.appendChild(p);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tac-confirm-input';
    input.value = initial;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', message);
    dialog.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'tac-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'tac-confirm-btn tac-confirm-btn--cancel';
    cancelBtn.textContent = cancelLabel;

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'tac-confirm-btn tac-confirm-btn--ok';
    okBtn.textContent = confirmLabel;

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);

    let settled = false;
    let pendingResult: string | null = null;

    function settle(result: string | null): void {
      if (settled) return;
      settled = true;
      dialog.remove();
      resolve(result);
    }

    function requestClose(result: string | null): void {
      pendingResult = result;
      if (typeof dialog.close === 'function') {
        try {
          dialog.close();
          return;
        } catch {
          /* repli ci-dessous */
        }
      }
      settle(result);
    }

    okBtn.addEventListener('click', () => requestClose(input.value));
    cancelBtn.addEventListener('click', () => requestClose(null));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) requestClose(null);
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      requestClose(null);
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') requestClose(null);
      else if (e.key === 'Enter' && e.target === input) requestClose(input.value);
    });
    dialog.addEventListener('close', () => settle(pendingResult));

    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }

    input.focus();
    input.select();
  });
}
