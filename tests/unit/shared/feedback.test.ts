/**
 * feedback.test.ts — Tests unitaires du système de notifications partagé
 * `src/shared/feedback.ts` (mission R2-T2a, remplacement des alert()/confirm()
 * natifs de PC-Tac).
 *
 * Couverture :
 *   - toast() : empilement (max 3 visibles), fermeture au clic, expiration
 *     après `duration`, persistance si `duration: 0`, aria (container
 *     aria-live="polite", role="alert" en erreur / "status" sinon).
 *   - confirmDialog() : résolution true (OK) / false (Annuler, Escape, clic
 *     hors boîte), focus initial (Annuler si danger, OK sinon), classes
 *     danger, `<dialog>` ouvert via showModal (avec repli jsdom déjà observé
 *     ailleurs dans le projet : `.showModal`/`.close` absents de jsdom 30).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  confirmDialog,
  hideBanner,
  showBanner,
  toast,
  undoableToast,
  UNDO_DELAY_MS,
} from '../../../src/shared/feedback.js';

/** Texte de la feuille de styles injectée par `feedback.ts` (jsdom n'applique
 *  pas les règles : on vérifie le CSS lui-même pour les exigences de mise en
 *  page — cible tactile, zone sûre). */
function feedbackCss(): string {
  return document.getElementById('tac-feedback-styles')?.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('#tac-feedback-styles').forEach((el) => el.remove());
});

/** jsdom 30 n'implémente ni `.showModal()` ni `.close()` sur `<dialog>` — même
 * constat que `tests/unit/pctac/pm-pingmodal.test.ts:103`. `feedback.ts` gère
 * ce repli en interne (branche `typeof dialog.close === 'function'`), donc
 * `confirmDialog()` résout de façon synchrone-au-microtask dès le clic, sans
 * dépendre d'un événement `close` natif. */

describe('toast() — empilement et cycle de vie', () => {
  // `confirmDialog()` ne dépend d'aucun timer (résolution synchrone au clic
  // sous jsdom), mais `toast()` en pose (expiration, retrait différé du DOM)
  // — timers factices confinés à ce describe : `expect(...).resolves` sur
  // deux `confirmDialog()` concurrents bloque indéfiniment sous timers
  // factices (interaction connue vitest/@sinonjs fake-timers avec la
  // microtask queue des Promises natives, sans rapport avec la logique de
  // `feedback.ts` elle-même).
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('injecte le conteneur une seule fois, aria-live="polite"', () => {
    toast('Un');
    toast('Deux');
    const containers = document.querySelectorAll('#tac-toast-container');
    expect(containers).toHaveLength(1);
    expect(containers[0]?.getAttribute('aria-live')).toBe('polite');
  });

  it('empile les toasts (ordre DOM = ordre d\'appel)', () => {
    toast('Premier');
    toast('Deuxième');
    const items = document.querySelectorAll('.tac-toast');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('Premier');
    expect(items[1]?.textContent).toBe('Deuxième');
  });

  it('au-delà de 3 visibles, retire le plus ancien pour faire de la place', () => {
    toast('A');
    toast('B');
    toast('C');
    toast('D');
    // Le retrait du plus ancien est différé de LEAVE_DELAY_MS (200ms) après
    // le retrait de la classe --visible : au moment de l'appel, "A" est déjà
    // hors de la classe visible, mais toujours dans le DOM. On avance le
    // temps pour laisser le retrait effectif se produire.
    vi.advanceTimersByTime(250);
    const items = document.querySelectorAll('.tac-toast');
    expect(items).toHaveLength(3);
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['B', 'C', 'D']);
  });

  it('kind="error" => role="alert" ; kind par défaut ("info") => role="status"', () => {
    toast('Erreur', { kind: 'error' });
    toast('Info');
    const items = document.querySelectorAll('.tac-toast');
    expect(items[0]?.getAttribute('role')).toBe('alert');
    expect(items[1]?.getAttribute('role')).toBe('status');
    expect(items[0]?.classList.contains('tac-toast--error')).toBe(true);
  });

  it('kind="success" pose la classe tac-toast--success', () => {
    toast('OK', { kind: 'success' });
    expect(document.querySelector('.tac-toast--success')).not.toBeNull();
  });

  it('disparaît après `duration` ms (défaut 4000)', () => {
    toast('Expire');
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    // Retrait de la classe --visible immédiat à l'expiration, retrait DOM
    // différé de LEAVE_DELAY_MS.
    vi.advanceTimersByTime(250);
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(0);
  });

  it('duration: 0 => persistant (pas de retrait automatique)', () => {
    toast('Persistant', { duration: 0 });
    vi.advanceTimersByTime(60000);
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(1);
  });

  it('se ferme au clic', () => {
    toast('Cliquable');
    const el = document.querySelector<HTMLElement>('.tac-toast');
    expect(el).not.toBeNull();
    el?.click();
    vi.advanceTimersByTime(250);
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(0);
  });
});

describe('confirmDialog() — résolution Promise<boolean>', () => {
  it('résout true au clic sur le bouton de confirmation', async () => {
    const p = confirmDialog({ message: 'Continuer ?' });
    const ok = document.querySelector<HTMLButtonElement>('[data-tac-confirm="ok"]');
    expect(ok).not.toBeNull();
    ok?.click();
    await expect(p).resolves.toBe(true);
  });

  it('résout false au clic sur Annuler', async () => {
    const p = confirmDialog({ message: 'Continuer ?' });
    document.querySelector<HTMLButtonElement>('[data-tac-confirm="cancel"]')?.click();
    await expect(p).resolves.toBe(false);
  });

  it('résout false sur Escape (keydown, repli sans <dialog> natif)', async () => {
    const p = confirmDialog({ message: 'Continuer ?' });
    const dialog = document.querySelector<HTMLElement>('.tac-confirm-dialog');
    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(p).resolves.toBe(false);
  });

  it('résout false au clic sur le fond (le <dialog> lui-même, pas un enfant)', async () => {
    const p = confirmDialog({ message: 'Continuer ?' });
    const dialog = document.querySelector<HTMLElement>('.tac-confirm-dialog');
    dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(p).resolves.toBe(false);
  });

  it('un clic sur un enfant (le message) ne ferme pas la boîte', () => {
    confirmDialog({ message: 'Continuer ?' });
    const message = document.querySelector<HTMLElement>('.tac-confirm-message');
    message?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.tac-confirm-dialog')).not.toBeNull();
  });

  it('retire le <dialog> du DOM après résolution', async () => {
    const p = confirmDialog({ message: 'Continuer ?' });
    document.querySelector<HTMLButtonElement>('[data-tac-confirm="ok"]')?.click();
    await p;
    expect(document.querySelector('.tac-confirm-dialog')).toBeNull();
  });

  it('affiche le titre si fourni, l\'omet sinon', () => {
    confirmDialog({ title: 'Suppression', message: 'Sûr ?' });
    expect(document.querySelector('.tac-confirm-title')?.textContent).toBe('Suppression');
    document.querySelector<HTMLButtonElement>('[data-tac-confirm="cancel"]')?.click();

    confirmDialog({ message: 'Sans titre' });
    expect(document.querySelector('.tac-confirm-title')).toBeNull();
  });

  it('labels par défaut "Confirmer"/"Annuler", surchargeables', () => {
    confirmDialog({ message: 'x' });
    expect(document.querySelector('[data-tac-confirm="ok"]')?.textContent).toBe('Confirmer');
    expect(document.querySelector('[data-tac-confirm="cancel"]')?.textContent).toBe('Annuler');
    document.querySelector<HTMLButtonElement>('[data-tac-confirm="cancel"]')?.click();

    confirmDialog({ message: 'x', confirmLabel: 'Supprimer', cancelLabel: 'Garder' });
    expect(document.querySelector('[data-tac-confirm="ok"]')?.textContent).toBe('Supprimer');
    expect(document.querySelector('[data-tac-confirm="cancel"]')?.textContent).toBe('Garder');
  });

  it('danger: true => bouton OK marqué danger, focus initial sur Annuler', () => {
    confirmDialog({ message: 'Supprimer ?', danger: true });
    const ok = document.querySelector<HTMLButtonElement>('[data-tac-confirm="ok"]');
    const cancel = document.querySelector<HTMLButtonElement>('[data-tac-confirm="cancel"]');
    expect(ok?.classList.contains('tac-confirm-btn--danger')).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it('danger: false (défaut) => focus initial sur OK', () => {
    confirmDialog({ message: 'Continuer ?' });
    const ok = document.querySelector<HTMLButtonElement>('[data-tac-confirm="ok"]');
    expect(document.activeElement).toBe(ok);
  });

  it('deux confirmDialog concurrents résolvent indépendamment', async () => {
    const p1 = confirmDialog({ message: 'Un' });
    const p2 = confirmDialog({ message: 'Deux' });
    const dialogs = document.querySelectorAll('.tac-confirm-dialog');
    expect(dialogs).toHaveLength(2);
    // Capturés AVANT tout clic : le clic sur le bouton de la 1re boîte la
    // retire du DOM (settle() synchrone sous jsdom, cf. feedback.ts), ce qui
    // décalerait les index d'une NodeList re-interrogée après coup.
    const oks = document.querySelectorAll<HTMLButtonElement>('[data-tac-confirm="ok"]');
    const cancels = document.querySelectorAll<HTMLButtonElement>('[data-tac-confirm="cancel"]');
    oks[0]?.click();
    cancels[1]?.click();
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(false);
  });
});

describe('injection de styles — une seule fois, idempotente', () => {
  it('un seul <style id="tac-feedback-styles"> même après plusieurs appels', () => {
    toast('x');
    confirmDialog({ message: 'y' });
    document.querySelector<HTMLButtonElement>('[data-tac-confirm="cancel"]')?.click();
    expect(document.querySelectorAll('#tac-feedback-styles')).toHaveLength(1);
  });
});

describe('toast() avec action', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sans action, aucun bouton n’est ajouté', () => {
    toast('Simple');
    expect(document.querySelector('.tac-toast button')).toBeNull();
  });

  it('un vrai <button type="button"> porte le libellé, cible ≥ 44 px', () => {
    toast('Message', { action: { label: 'Annuler', onClick: () => {} } });
    const button = document.querySelector<HTMLButtonElement>('.tac-toast button');
    expect(button).not.toBeNull();
    expect(button?.type).toBe('button');
    expect(button?.textContent).toBe('Annuler');
    expect(button?.getAttribute('type')).toBe('button');
    expect(feedbackCss()).toContain('min-height: 44px');
  });

  it('le clic sur l’action appelle onClick UNE fois puis ferme le toast', () => {
    const onClick = vi.fn();
    toast('Message', { action: { label: 'Faire', onClick } });
    const button = document.querySelector<HTMLButtonElement>('.tac-toast button')!;
    button.click();
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(0);
  });

  it('un clic ailleurs sur le toast ferme sans appeler l’action', () => {
    const onClick = vi.fn();
    toast('Message', { action: { label: 'Faire', onClick } });
    document.querySelector<HTMLElement>('.tac-toast')!.click();
    expect(onClick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(document.querySelectorAll('.tac-toast')).toHaveLength(0);
  });
});

describe('undoableToast()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('UNDO_DELAY_MS vaut 10 000 ms et sert de durée par défaut', () => {
    expect(UNDO_DELAY_MS).toBe(10_000);
    const onCommit = vi.fn();
    undoableToast('Supprimé', { onUndo: () => {}, onCommit });
    // Rien avant l’échéance…
    vi.advanceTimersByTime(9_999);
    expect(onCommit).not.toHaveBeenCalled();
    // …commit à l’échéance.
    vi.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('« Annuler » appelle onUndo une seule fois (double clic), jamais onCommit', () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoableToast('Supprimé', { onUndo, onCommit });
    const button = document.querySelector<HTMLButtonElement>('.tac-toast button')!;
    expect(button.textContent).toBe('Annuler');
    button.click();
    button.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('chassé par la limite de toasts visibles : onCommit est appelé', () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoableToast('Supprimé', { onUndo, onCommit });
    toast('B');
    toast('C');
    toast('D');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('pagehide : onCommit est appelé, jamais onUndo', () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoableToast('Supprimé', { onUndo, onCommit });
    window.dispatchEvent(new Event('pagehide'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
    // L’échéance suivante ne redéclenche rien (une seule fois).
    vi.advanceTimersByTime(20_000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('clic sur le corps du toast : onCommit, jamais onUndo', () => {
    const onUndo = vi.fn();
    const onCommit = vi.fn();
    undoableToast('Supprimé', { onUndo, onCommit });
    document.querySelector<HTMLElement>('.tac-toast')!.click();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('sans onCommit, « Annuler » fonctionne quand même', () => {
    const onUndo = vi.fn();
    undoableToast('Supprimé', { onUndo });
    document.querySelector<HTMLButtonElement>('.tac-toast button')!.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('annonce le raccourci d’annulation (R12)', () => {
    undoableToast('Photo supprimée.', { onUndo: () => {} });
    expect(document.querySelector('.tac-toast')?.textContent).toContain('pour annuler');
  });

  it('met le décompte en pause au survol, le reprend au départ (R12)', () => {
    const onCommit = vi.fn();
    undoableToast('Supprimé.', { onUndo: () => {}, onCommit });
    const el = document.querySelector<HTMLElement>('.tac-toast')!;
    vi.advanceTimersByTime(9_000);
    el.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(60_000);
    expect(onCommit).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1_000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('met le décompte en pause au focus clavier, le reprend à la sortie (R12)', () => {
    const onCommit = vi.fn();
    undoableToast('Supprimé.', { onUndo: () => {}, onCommit });
    const el = document.querySelector<HTMLElement>('.tac-toast')!;
    vi.advanceTimersByTime(9_500);
    el.dispatchEvent(new Event('focusin'));
    vi.advanceTimersByTime(60_000);
    expect(onCommit).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('focusout'));
    vi.advanceTimersByTime(500);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Z annule la DERNIÈRE suppression, pas les précédentes (R12)', () => {
    const onUndoA = vi.fn();
    const onUndoB = vi.fn();
    undoableToast('A supprimé.', { onUndo: onUndoA });
    undoableToast('B supprimé.', { onUndo: onUndoB });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(onUndoB).toHaveBeenCalledTimes(1);
    expect(onUndoA).not.toHaveBeenCalled();
  });

  it('Ctrl+Maj+Z (rétablir) n’est pas détourné en annulation de suppression (R12)', () => {
    const onUndo = vi.fn();
    undoableToast('Supprimé.', { onUndo });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true }));
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('Ctrl+Z ne vole pas l’annulation de frappe d’un champ éditable (R12)', () => {
    const onUndo = vi.fn();
    undoableToast('Supprimé.', { onUndo });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(onUndo).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('bandeaux persistants', () => {
  it('s’insère en tête du <body>, dans le flux (aucune commande masquée)', () => {
    document.body.innerHTML = '<div class="container">Application</div>';
    showBanner('b1', { message: 'Info', level: 'info' });
    const container = document.getElementById('tac-banner-container');
    expect(container).not.toBeNull();
    expect(document.body.firstElementChild).toBe(container);
    // Le conteneur pousse le contenu, il ne le recouvre pas.
    expect(feedbackCss()).toContain('env(safe-area-inset-top');
  });

  it('role="alert" pour alert, "status" sinon', () => {
    showBanner('a', { message: 'Alerte', level: 'alert' });
    expect(document.querySelector('[data-banner-id="a"]')?.getAttribute('role')).toBe('alert');
    showBanner('i', { message: 'Info', level: 'info' });
    expect(document.querySelector('[data-banner-id="i"]')?.getAttribute('role')).toBe('status');
    showBanner('m', { message: 'Important', level: 'important' });
    expect(document.querySelector('[data-banner-id="m"]')?.getAttribute('role')).toBe('status');
  });

  it('le texte passe par textContent (jamais innerHTML)', () => {
    showBanner('xss', { message: '<img src=x onerror=alert(1)>', level: 'info' });
    expect(document.querySelector('[data-banner-id="xss"] img')).toBeNull();
    expect(document.querySelector('[data-banner-id="xss"] .tac-banner-message')?.textContent)
      .toBe('<img src=x onerror=alert(1)>');
  });

  it('un seul bandeau par id : le second remplace en place', () => {
    document.body.innerHTML = '<div class="container">App</div>';
    showBanner('b1', { message: 'Premier', level: 'info' });
    showBanner('b1', { message: 'Second', level: 'alert' });
    expect(document.querySelectorAll('[data-banner-id="b1"]')).toHaveLength(1);
    const el = document.querySelector('[data-banner-id="b1"]');
    expect(el?.textContent).toContain('Second');
    expect(el?.getAttribute('role')).toBe('alert');
    // L’ordre relatif est conservé : toujours le premier enfant du conteneur.
    expect(document.getElementById('tac-banner-container')?.firstElementChild).toBe(el);
  });

  it('bouton × si dismissible (défaut) : appelle onDismiss et retire le bandeau', () => {
    const onDismiss = vi.fn();
    showBanner('b1', { message: 'Fermable', level: 'info', onDismiss });
    const close = document.querySelector<HTMLButtonElement>('[data-banner-id="b1"] button[data-banner-close]');
    expect(close).not.toBeNull();
    close!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-banner-id="b1"]')).toBeNull();
  });

  it('dismissible: false retire le bouton ×', () => {
    showBanner('b1', { message: 'Sans ×', level: 'important', dismissible: false });
    expect(document.querySelector('[data-banner-id="b1"] button[data-banner-close]')).toBeNull();
  });

  it('les actions sont de vrais boutons qui rappellent onClick', () => {
    const onClick = vi.fn();
    showBanner('b1', {
      message: 'Mettre à jour',
      level: 'important',
      actions: [{ label: 'Recharger', onClick }],
    });
    const btn = document.querySelector<HTMLButtonElement>('[data-banner-id="b1"] button[data-banner-action]');
    expect(btn?.type).toBe('button');
    expect(btn?.textContent).toBe('Recharger');
    btn!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('hideBanner retire le bandeau demandé', () => {
    showBanner('b1', { message: 'Un', level: 'info' });
    showBanner('b2', { message: 'Deux', level: 'info' });
    hideBanner('b1');
    expect(document.querySelector('[data-banner-id="b1"]')).toBeNull();
    expect(document.querySelector('[data-banner-id="b2"]')).not.toBeNull();
    hideBanner('b2');
    expect(document.querySelector('[data-banner-id="b2"]')).toBeNull();
  });

  it('F-1 : sous 560 px, le message prend toute la largeur et les actions passent dessous', () => {
    showBanner('b1', { message: 'x', level: 'info' });
    const css = feedbackCss();
    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain('flex-wrap: wrap');
    expect(css).toMatch(/\.tac-banner-message\s*\{\s*flex:\s*1 1 100%/);
  });

  it('F-2 : les jetons absents du portail ont un repli lisible', () => {
    showBanner('b1', { message: 'x', level: 'alert' });
    const css = feedbackCss();
    expect(css).toContain('var(--color-surface');
    expect(css).toContain('var(--color-text');
    expect(css).toContain('var(--color-danger');
  });
});
