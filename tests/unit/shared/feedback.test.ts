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

import { confirmDialog, toast } from '../../../src/shared/feedback.js';

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
