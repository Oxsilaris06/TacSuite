/**
 * fiche-helpers.ts — Outils partagés des tests de la fiche plein écran.
 * jsdom n'implémente pas `showModal()` : on pose le strict nécessaire.
 */
import { Storage } from '@pctac/storage.js';

export function installDialog(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Saisit une valeur dans le champ `key` de la fiche ouverte (texte ou précision). */
export function setField(key: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(`#ficheSheet [data-key="${key}"]`);
  if (!el) throw new Error(`champ absent : ${key}`);
  const input = el.classList.contains('fiche-chips') ? el.querySelector<HTMLInputElement>('.fiche-precision')! : el;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function clickSave(next = false): Promise<void> {
  document.querySelector<HTMLElement>(next ? '#ficheSheet .fiche-save-next' : '#ficheSheet .fiche-save')!.click();
  await flush();
}

export function storedFiche(key: string, id: string): Record<string, unknown> | undefined {
  return Storage.loadCollection(key).find((i) => i.id === id);
}
