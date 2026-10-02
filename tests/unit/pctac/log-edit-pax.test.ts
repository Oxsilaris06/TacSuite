/**
 * log-edit-pax.test.ts — retours terrain 2026-10-02 : la pastille PAX se change
 * dans « Modifier l'entrée » de la main courante (jusque-là : date, heure, lieu
 * et remarques seulement).
 *   - la rangée est celle de la saisie : pastilles de la situation (la cinquième
 *     comprise), libellés de la situation, intervenants personnalisés ;
 *   - chaque pastille est un bouton à `aria-pressed` ; une valeur historique
 *     absente de la situation reste proposée, enfoncée, jamais perdue ;
 *   - la pastille voyage en bloc (nom, mode, couleur) : même diff inter-onglets
 *     que les autres champs, libellé « PAX » ;
 *   - la ligne du journal et le PDF lisent la valeur modifiée.
 *
 * La fenêtre testée est la VRAIE (`pctac/index.html`), pas une copie.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePdfBytes, pdfPageOperators, pdfPagesText } from './pdf-test-helpers.js';

vi.mock('@pctac/image-store.js', () => ({
  ImageStore: {
    async put(): Promise<void> {},
    async get(): Promise<string | null> { return null; },
    async getMany(): Promise<Record<string, string | null>> { return {}; },
    async delete(): Promise<void> {},
    async deleteMany(): Promise<void> {},
    async clear(): Promise<void> {},
    async migrateFromLocalStorage(): Promise<void> {},
    async hydrate<T extends { id: string }>(items: T[]): Promise<T[]> { return items; },
  },
  GpxStore: { get: async () => null },
}));
const choiceSpy = vi.hoisted(() => vi.fn<(opts: { message: string }) => Promise<string | null>>());
vi.mock('@pctac/choice-dialog.js', () => ({ choiceDialog: choiceSpy }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/feedback.js')>()),
  toast: toastSpy,
}));

import { UI } from '@pctac/ui.js';
import { LogManager } from '@pctac/log-manager.js';
import { Storage } from '@pctac/storage.js';
import { PCTAC_MODE_KEY, paxChipKeys, paxChipLabel, currentMode } from '@pctac/modes.js';
import { PDF_PAX_COLORS } from '@pctac/config.js';
import type { PctacLogEntry } from '@shared/types/contracts.js';

const html = readFileSync(resolve(process.cwd(), 'pctac/index.html'), 'utf8');
const EDIT_MODAL = /<dialog[^>]*id="editModal"[\s\S]*?<\/dialog>/.exec(html)?.[0] ?? '';

const ENTRY: PctacLogEntry = { id: 'e1', date: '2026-09-25', heure: '10:00', pax: 'Inter', paxMode: 'standard', paxColor: '', lieu: 'L1', remarques: 'R1' };
const GIGN = { id: 'c1', name: 'GIGN 1', color: '#800000' };

function seedPage(): void {
  document.body.innerHTML = `${EDIT_MODAL}<table id="logTable"><tbody></tbody></table>`;
  UI.initElements();
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  if (typeof proto.showModal !== 'function') proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  if (typeof proto.close !== 'function') proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

const stored = (): PctacLogEntry | undefined => Storage.loadLogData().find((e) => e.id === 'e1');
const setInput = (id: string, value: string): void => { (document.getElementById(id) as HTMLInputElement).value = value; };
const chips = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>('#edit_pax_select button'));
const chip = (pax: string): HTMLButtonElement => {
  const found = chips().find((b) => b.dataset.pax === pax);
  if (!found) throw new Error(`pastille « ${pax} » absente`);
  return found;
};
const pressed = (): string[] => chips().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.pax ?? '');
/** Pose l'entrée dans le journal de la situation courante, puis ouvre la fenêtre. */
const open = (over: Partial<PctacLogEntry> = {}): void => {
  Storage.saveLogData([{ ...ENTRY, ...over }]);
  UI.openEditModal('e1');
};
const setSituation = (id: string): void => { localStorage.setItem(PCTAC_MODE_KEY, id); };
/** Couleur CSS normalisée comme le fait le DOM (`#10b981` → `rgb(16, 185, 129)`). */
const css = (color: string): string => {
  const probe = document.createElement('span');
  probe.style.color = color;
  return probe.style.color;
};

beforeEach(() => {
  localStorage.clear();
  choiceSpy.mockClear();
  choiceSpy.mockResolvedValue('theirs');
  toastSpy.mockClear();
  seedPage();
});

describe('« Modifier l’entrée » — rangée de pastilles PAX', () => {
  it('la fenêtre déclare un groupe étiqueté pour les pastilles', () => {
    const group = document.getElementById('edit_pax_select');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('Pax');
  });

  it('propose les pastilles de la saisie, celle de l’entrée est enfoncée', () => {
    open();
    expect(chips().map((b) => b.dataset.pax)).toEqual(paxChipKeys(currentMode()));
    expect(chips().map((b) => b.textContent)).toEqual(paxChipKeys(currentMode()).map((k) => paxChipLabel(k)));
    expect(pressed()).toEqual(['Inter']);
  });

  it('chaque pastille est un bouton à aria-pressed (pas un radio), un seul est enfoncé', () => {
    open();
    for (const b of chips()) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.type).toBe('button');
      expect(b.hasAttribute('role')).toBe(false);
      expect(['true', 'false']).toContain(b.getAttribute('aria-pressed'));
    }
    expect(pressed()).toHaveLength(1);
  });

  it('Tuerie planifiée : la cinquième pastille « IS » suit les quatre historiques', () => {
    setSituation('tp');
    open({ pax: 'IS' });
    expect(chips().map((b) => b.dataset.pax)).toEqual(['Adversaire', 'Otage', 'Inter', 'Oscar', 'IS']);
    expect(chip('IS').textContent).toBe('IS');
    expect(pressed()).toEqual(['IS']);
  });

  it('Recherche : les libellés suivent la situation, les clés stockées restent', () => {
    setSituation('recherche');
    open();
    expect(chip('Inter').textContent).toBe('Recherches');
    expect(chip('Oscar').textContent).toBe('PC');
    expect(chip('Adversaire').textContent).toBe('Recherché');
    expect(pressed()).toEqual(['Inter']);
  });

  it('les intervenants personnalisés viennent après les pastilles de la situation', () => {
    Storage.saveCollection('pcTacCustomPax', [GIGN]);
    open();
    expect(chips().map((b) => b.dataset.pax)).toEqual(['Adversaire', 'Otage', 'Inter', 'Oscar', 'GIGN 1']);
    expect(pressed()).toEqual(['Inter']);
  });

  it('un intervenant personnalisé est enfoncé pour une entrée libre de même nom et couleur', () => {
    Storage.saveCollection('pcTacCustomPax', [GIGN]);
    open({ pax: 'GIGN 1', paxMode: 'free', paxColor: '#800000' });
    expect(pressed()).toEqual(['GIGN 1']);
    expect(chips()).toHaveLength(5);
  });

  it('rouvrir sur une autre entrée remplace la rangée, sans cumul', () => {
    Storage.saveLogData([{ ...ENTRY }, { ...ENTRY, id: 'e2', pax: 'Nego' }]);
    UI.openEditModal('e2');
    expect(chips()).toHaveLength(5);
    UI.openEditModal('e1');
    expect(chips()).toHaveLength(4);
    expect(pressed()).toEqual(['Inter']);
  });

  it('entrée legacy standard absente de la situation (Nego) : pastille gardée, enfoncée, lisible', () => {
    open({ pax: 'Nego' });
    expect(chips().map((b) => b.dataset.pax)).toEqual(['Adversaire', 'Otage', 'Inter', 'Oscar', 'Nego']);
    expect(pressed()).toEqual(['Nego']);
    // Sans couleur, la pastille enfoncée n'aurait pas de fond : elle porte celle de la ligne.
    expect(chip('Nego').style.getPropertyValue('--pax-chip-bg')).toBe(PDF_PAX_COLORS.Nego?.color);
    expect(chip('Nego').style.getPropertyValue('--pax-chip-fg')).toMatch(/^#(000000|ffffff)$/);
  });

  it('cinquième pastille d’une autre situation (IS en Forcené) : gardée, enfoncée', () => {
    open({ pax: 'IS' });
    expect(chips().map((b) => b.dataset.pax)).toEqual(['Adversaire', 'Otage', 'Inter', 'Oscar', 'IS']);
    expect(pressed()).toEqual(['IS']);
  });

  it('entrée libre dont l’intervenant a été supprimé : pastille gardée, enfoncée, sa couleur', () => {
    open({ pax: 'Ancien', paxMode: 'free', paxColor: '#22c55e' });
    expect(chips().map((b) => b.dataset.pax)).toEqual(['Adversaire', 'Otage', 'Inter', 'Oscar', 'Ancien']);
    expect(pressed()).toEqual(['Ancien']);
    expect(chip('Ancien').style.getPropertyValue('--pax-chip-bg')).toBe('#22c55e');
  });

  it('une entrée « Carte » (automatique, sans couleur) garde sa pastille', () => {
    open({ pax: 'Carte', paxMode: 'free', paxColor: undefined, auto: true });
    expect(pressed()).toEqual(['Carte']);
  });

  it('un intervenant de même nom mais d’une autre couleur n’est pas la valeur de l’entrée', () => {
    Storage.saveCollection('pcTacCustomPax', [{ id: 'c1', name: 'GIGN 1', color: '#0f766e' }]);
    open({ pax: 'GIGN 1', paxMode: 'free', paxColor: '#800000' });
    // L'entrée est rouge : la pastille verte du même nom n'est pas elle.
    expect(chips().filter((b) => b.dataset.pax === 'GIGN 1')).toHaveLength(2);
    expect(pressed()).toEqual(['GIGN 1']);
    expect(chips().find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.paxColor).toBe('#800000');
  });
});

describe('« Modifier l’entrée » — choisir une autre pastille', () => {
  it('un clic enfonce la pastille et relâche l’autre ; recliquer ne la relâche pas', () => {
    open();
    chip('Oscar').click();
    expect(pressed()).toEqual(['Oscar']);
    chip('Oscar').click();
    expect(pressed()).toEqual(['Oscar']);
  });

  it('pastille standard : pax, mode et couleur suivent, la ligne reprend la couleur', async () => {
    open({ pax: 'Adversaire' });
    chip('Oscar').click();
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'Oscar', paxMode: 'standard', paxColor: '', lieu: 'L1', remarques: 'R1' });
    const cell = document.querySelector<HTMLElement>('#logTable .pax-cell');
    expect(cell?.textContent).toBe('Oscar');
    const oscar = PDF_PAX_COLORS.Oscar?.color ?? '';
    expect(cell?.style.backgroundColor).toBe(css(oscar));
    expect(cell?.style.color).toBe(css(UI.getContrastYIQ(oscar)));
    expect(toastSpy).toHaveBeenCalledWith('Fiche mise à jour', expect.objectContaining({ kind: 'success' }));
  });

  it('intervenant personnalisé : mode libre et couleur, la ligne prend cette couleur', async () => {
    Storage.saveCollection('pcTacCustomPax', [GIGN]);
    open();
    chip('GIGN 1').click();
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'GIGN 1', paxMode: 'free', paxColor: '#800000' });
    const cell = document.querySelector<HTMLElement>('#logTable .pax-cell');
    expect(cell?.textContent).toBe('GIGN 1');
    expect(cell?.style.backgroundColor).toBe(css('#800000'));
    expect(cell?.style.color).toBe(css(UI.getContrastYIQ('#800000')));
  });

  it('d’un intervenant personnalisé vers une pastille standard : mode standard, couleur vidée', async () => {
    Storage.saveCollection('pcTacCustomPax', [GIGN]);
    open({ pax: 'GIGN 1', paxMode: 'free', paxColor: '#800000' });
    chip('Otage').click();
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'Otage', paxMode: 'standard', paxColor: '' });
  });

  it('cinquième pastille : « IS » s’écrit en standard, la ligne prend sa couleur', async () => {
    setSituation('tp');
    open();
    chip('IS').click();
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'IS', paxMode: 'standard', paxColor: '' });
    expect(document.querySelector<HTMLElement>('#logTable .pax-cell')?.style.backgroundColor).toBe(css(PDF_PAX_COLORS.IS?.color ?? ''));
  });

  it('un intervenant libre nommé comme une pastille standard est bien un changement', async () => {
    Storage.saveCollection('pcTacCustomPax', [{ id: 'c9', name: 'Oscar', color: '#800000' }]);
    open({ pax: 'Oscar' });
    const [standard, libre] = chips().filter((b) => b.dataset.pax === 'Oscar');
    expect(standard?.getAttribute('aria-pressed')).toBe('true');
    expect(libre?.getAttribute('aria-pressed')).toBe('false');
    libre?.click();
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'Oscar', paxMode: 'free', paxColor: '#800000' });
  });

  it('sans toucher à la pastille, rien de PAX n’est écrit (legacy, Carte, libre orphelin)', async () => {
    for (const over of [
      { pax: 'Nego' },
      { pax: 'Carte', paxMode: 'free' as const, paxColor: undefined, auto: true },
      { pax: 'Ancien', paxMode: 'free' as const, paxColor: '#22c55e' },
    ]) {
      const update = vi.spyOn(LogManager, 'updateEntry');
      open(over);
      setInput('edit_lieu', 'L2');
      await UI.confirmEditLog();
      expect(update).toHaveBeenCalledWith('e1', { lieu: 'L2' });
      const after = stored();
      expect(after?.lieu).toBe('L2');
      expect([after?.pax, after?.paxMode, after?.paxColor]).toEqual([over.pax, over.paxMode ?? 'standard', 'paxColor' in over ? over.paxColor : '']);
      update.mockRestore();
    }
  });

  it('revenir à la valeur d’origine annule le changement de pastille', async () => {
    const update = vi.spyOn(LogManager, 'updateEntry');
    open({ pax: 'Nego' });
    chip('Oscar').click();
    chip('Nego').click();
    setInput('edit_lieu', 'L2');
    await UI.confirmEditLog();
    expect(update).toHaveBeenCalledWith('e1', { lieu: 'L2' });
    expect(stored()).toMatchObject({ pax: 'Nego', paxMode: 'standard' });
    update.mockRestore();
  });

  it('page sans rangée de pastilles : la pastille de l’entrée n’est pas touchée', async () => {
    open();
    document.getElementById('edit_pax_select')?.remove();
    setInput('edit_lieu', 'L2');
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'Inter', paxMode: 'standard', lieu: 'L2' });
    expect(choiceSpy).not.toHaveBeenCalled();
  });
});

describe('« Modifier l’entrée » — PAX et autre onglet', () => {
  it('même pastille changée des deux côtés : choix libellé « PAX », « Prendre l’autre » garde l’autre', async () => {
    open();
    Storage.saveLogData([{ ...ENTRY, pax: 'Otage' }]);
    chip('Oscar').click();
    await UI.confirmEditLog();
    expect(choiceSpy).toHaveBeenCalledTimes(1);
    const message = choiceSpy.mock.calls[0]?.[0].message ?? '';
    expect(message).toContain('Champ « PAX »');
    expect(message).toContain('votre valeur « Oscar »');
    expect(message).toContain('autre onglet « Otage »');
    expect(stored()).toMatchObject({ pax: 'Otage', paxMode: 'standard', paxColor: '' });
  });

  it('« Garder la mienne » écrit ma pastille', async () => {
    choiceSpy.mockResolvedValue('mine');
    open();
    Storage.saveLogData([{ ...ENTRY, pax: 'Otage' }]);
    chip('Oscar').click();
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'Oscar', paxMode: 'standard', paxColor: '' });
  });

  it('la pastille de l’autre onglet, libre, reste entière : nom, mode et couleur ensemble', async () => {
    open();
    Storage.saveLogData([{ ...ENTRY, pax: 'GIGN 1', paxMode: 'free', paxColor: '#800000' }]);
    chip('Oscar').click();
    await UI.confirmEditLog();
    const message = choiceSpy.mock.calls[0]?.[0].message ?? '';
    // Le message montre les pastilles, pas leur clé de comparaison.
    expect(message).toContain('autre onglet « GIGN 1 »');
    expect(message).not.toMatch(/free|standard|#800000/);
    expect(stored()).toMatchObject({ pax: 'GIGN 1', paxMode: 'free', paxColor: '#800000' });
  });

  it('« Garder la mienne » remplace aussi le mode et la couleur de l’autre onglet', async () => {
    choiceSpy.mockResolvedValue('mine');
    open();
    Storage.saveLogData([{ ...ENTRY, pax: 'GIGN 1', paxMode: 'free', paxColor: '#800000' }]);
    chip('Oscar').click();
    await UI.confirmEditLog();
    expect(stored()).toMatchObject({ pax: 'Oscar', paxMode: 'standard', paxColor: '' });
  });

  it('pastille changée seulement dans l’autre onglet : elle survit, sans conflit', async () => {
    open();
    Storage.saveLogData([{ ...ENTRY, pax: 'Otage' }]);
    setInput('edit_lieu', 'L2');
    await UI.confirmEditLog();
    expect(choiceSpy).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ pax: 'Otage', paxMode: 'standard', lieu: 'L2' });
  });

  it('pastille changée ici, remarques dans l’autre onglet : les deux survivent', async () => {
    open();
    Storage.saveLogData([{ ...ENTRY, remarques: 'R2' }]);
    chip('Oscar').click();
    await UI.confirmEditLog();
    expect(choiceSpy).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ pax: 'Oscar', remarques: 'R2' });
  });

  it('même pastille choisie des deux côtés : pas de conflit', async () => {
    open();
    Storage.saveLogData([{ ...ENTRY, pax: 'Oscar' }]);
    chip('Oscar').click();
    await UI.confirmEditLog();
    expect(choiceSpy).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ pax: 'Oscar', paxMode: 'standard' });
  });
});

describe('« Modifier l’entrée » — l’export PDF lit la pastille modifiée', () => {
  const OPTS = { kind: 'complet', theme: 'clair', sortie: 'impression' } as const;
  /** Opérateur de remplissage `rg` d'une couleur `#rrggbb`, tel qu'écrit par pdf-lib. */
  const rg = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return `${r} ${g} ${b} rg`;
  };

  it('le PDF reprend le libellé et la couleur de la nouvelle pastille', async () => {
    Storage.saveCollection('pcTacCustomPax', [GIGN]);
    open();
    const before = (await generatePdfBytes({ ...OPTS }))!;
    expect(await pdfPageOperators(before, 0)).not.toContain(rg('#800000'));

    chip('GIGN 1').click();
    await UI.confirmEditLog();
    const after = (await generatePdfBytes({ ...OPTS }))!;
    expect((await pdfPagesText(after)).join(' ')).toContain('GIGN 1');
    expect(await pdfPageOperators(after, 0)).toContain(rg('#800000'));
  });

  it('la synthèse A3 reprend aussi la pastille modifiée (faits marquants)', async () => {
    open({ favori: true, remarques: 'Contact établi' });
    chip('Oscar').click();
    await UI.confirmEditLog();
    const captured: { blob?: Blob } = {};
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((b: Blob) => { captured.blob = b; return 'blob:mock'; });
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { buildA3Pdf } = await import('@pctac/pdf-a3.js');
    await buildA3Pdf({ kind: 'a3', theme: 'clair', sortie: 'impression' });
    click.mockRestore();
    const text = (await pdfPagesText(new Uint8Array(await captured.blob!.arrayBuffer()))).join(' ');
    expect(text).toContain('Oscar — L1 — Contact établi');
    expect(text).not.toContain('Inter — L1');
  });
});
