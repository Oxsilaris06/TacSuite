/**
 * rb-fiche-close.test.ts — R25 : la fiche ne se ferme que si la vue qui la
 * contient est quittée ; pas pendant la capture PDF ; oui en écran scindé
 * quand le panneau qui la contient change de vue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(): Promise<void> {}, async get(): Promise<string | null> { return null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(): Promise<void> {}, async deleteMany(): Promise<void> {}, async clear(): Promise<void> {},
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
  },
}));

import { initSplitView, setPaneView } from '@pctac/split-view.js';
import { UI } from '@pctac/ui.js';

function marquerFiche(dlg: HTMLDialogElement): void {
  dlg.setAttribute('open', '');
  dlg.open = true;
  dlg.close = function close(this: HTMLDialogElement): void { this.open = false; this.removeAttribute('open'); };
}

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
});

describe('switchMainView — R25', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="view-adversaires" class="tab-content-view"><dialog id="ficheSheet" class="fiche-sheet fiche-inline"></dialog></div>
      <div id="view-plan" class="tab-content-view"></div>
      <div id="adversary-table-body"></div><div id="hostage-table-body"></div>`;
    marquerFiche(document.getElementById('ficheSheet') as HTMLDialogElement);
  });

  it('ne ferme pas la fiche quand on reclique SON onglet, même avec keepFiche', () => {
    UI.switchMainView('view-adversaires');
    expect((document.getElementById('ficheSheet') as HTMLDialogElement).open).toBe(true);
    UI.switchMainView('view-adversaires', { keepFiche: true });
    expect((document.getElementById('ficheSheet') as HTMLDialogElement).open).toBe(true);
  });

  it('ne ferme pas la fiche pendant la capture PDF (keepFiche)', () => {
    UI.switchMainView('view-plan', { keepFiche: true });
    expect((document.getElementById('ficheSheet') as HTMLDialogElement).open).toBe(true);
  });

  it('ferme la fiche quand on quitte son onglet', () => {
    UI.switchMainView('view-plan');
    expect((document.getElementById('ficheSheet') as HTMLDialogElement).open).toBe(false);
  });
});

describe('setPaneView — R25', () => {
  beforeEach(() => {
    localStorage.setItem('pcTacSplit', JSON.stringify({ on: true, left: 'view-adversaires', right: 'view-plan', ratio: 50 }));
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
    document.body.innerHTML = `
      <div class="container">
        <div id="splitView" class="split-view" hidden>
          <section id="splitPaneLeft"></section>
          <div id="splitDivider"></div>
          <section id="splitPaneRight"></section>
        </div>
        <div id="viewsHome">
          <div id="view-adversaires" class="tab-content-view"><dialog id="ficheSheet" class="fiche-sheet fiche-inline"></dialog></div>
          <div id="view-plan" class="tab-content-view"></div>
          <div id="view-otages" class="tab-content-view"></div>
        </div>
        <button id="splitViewDockBtn"></button>
        <table id="logTable"><tbody></tbody></table>
      </div>`;
    UI.initElements();
    initSplitView();
    marquerFiche(document.getElementById('ficheSheet') as HTMLDialogElement);
  });

  it('referme la fiche quand le panneau qui la contient change de vue', () => {
    setPaneView('left', 'view-otages');
    expect((document.getElementById('ficheSheet') as HTMLDialogElement).open).toBe(false);
  });
});
