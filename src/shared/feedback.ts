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

export interface ToastOptions {
  /** @default 'info' */
  kind?: ToastKind;
  /** Durée d'affichage en ms avant disparition auto. `0` = persistant (fermeture manuelle uniquement). @default 4000 */
  duration?: number;
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
}

/* =========================================================================
 * Styles injectés (une seule fois, à la première utilisation)
 * ========================================================================= */

const STYLE_ID = 'tac-feedback-styles';
/** Au-dessus de tout, y compris les `<dialog>` propres à chaque app (`--z-dialog`/`--z-top` locaux ≤3000) — même idiome que `tuto-engine.ts` (`Z = 2147483000`). */
const TOP_Z = 2147483000;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.tac-toast-container {
  position: fixed;
  left: 50%;
  bottom: var(--tac-space-5, 24px);
  transform: translateX(-50%);
  z-index: ${TOP_Z};
  display: flex;
  flex-direction: column-reverse;
  gap: var(--tac-space-2, 8px);
  align-items: center;
  pointer-events: none;
  max-width: min(92vw, 420px);
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
.tac-confirm-btn {
  appearance: none;
  border: 1px solid var(--border-light);
  border-radius: var(--tac-radius-sm, 6px);
  padding: var(--tac-space-2, 8px) var(--tac-space-4, 16px);
  font: 600 13.5px/1 inherit;
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

const toastTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function ensureToastContainer(): HTMLElement {
  let el = document.getElementById('tac-toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tac-toast-container';
    el.className = 'tac-toast-container';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

function removeToast(el: HTMLElement): void {
  const timer = toastTimers.get(el);
  if (timer !== undefined) clearTimeout(timer);
  toastTimers.delete(el);
  if (!el.isConnected) return;
  el.classList.remove('tac-toast--visible');
  setTimeout(() => el.remove(), LEAVE_DELAY_MS);
}

/**
 * Affiche une notification empilable en bas d'écran. Non bloquante (à la
 * différence d'`alert()`), se ferme au clic ou après `duration` ms.
 * Au-delà de {@link MAX_VISIBLE_TOASTS} visibles, la plus ancienne est
 * retirée immédiatement pour faire de la place.
 */
export function toast(message: string, options: ToastOptions = {}): void {
  const { kind = 'info', duration = DEFAULT_TOAST_DURATION } = options;
  injectStyles();
  const container = ensureToastContainer();

  const visible = Array.from(container.children) as HTMLElement[];
  if (visible.length >= MAX_VISIBLE_TOASTS) {
    const oldest = visible[0];
    if (oldest) removeToast(oldest);
  }

  const el = document.createElement('div');
  el.className = `tac-toast tac-toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  el.addEventListener('click', () => removeToast(el));

  container.appendChild(el);
  // Reflow avant d'ajouter la classe d'entrée, pour que la transition joue
  // (en environnement sans rAF réel — ex. jsdom — le timeout 0 suffit aussi).
  requestAnimationFrame(() => el.classList.add('tac-toast--visible'));

  if (duration > 0) {
    toastTimers.set(el, setTimeout(() => removeToast(el), duration));
  }
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
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    danger = false,
  } = options;
  injectStyles();

  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'tac-confirm-dialog';

    if (title) {
      const h = document.createElement('h2');
      h.className = 'tac-confirm-title';
      h.textContent = title;
      dialog.appendChild(h);
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

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);

    let settled = false;
    let pendingResult = false; // Escape (cancel natif) => false par défaut, sans action explicite.

    function settle(result: boolean): void {
      if (settled) return;
      settled = true;
      dialog.remove();
      resolve(result);
    }

    function requestClose(result: boolean): void {
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
 * promptDialog — remplaçant des `prompt()` natifs (U25, Goal.md)
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
      h.textContent = title;
      dialog.appendChild(h);
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
