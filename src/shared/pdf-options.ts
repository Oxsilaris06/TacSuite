/**
 * pdf-options.ts — Fenêtre de génération PDF commune à l'OI et à PC-Tac
 * (décision 42, audit PDF du 2026-09-25).
 *
 * Le bouton PDF ouvre une petite fenêtre : type de rapport (PC-Tac : complet
 * ou synthèse A3), thème (clair par défaut, sombre pour projeter), sortie
 * « Impression » (haute qualité) ou « Partage » (moins de 10 Mo, pour Tchap).
 * Les derniers choix sont retenus PAR application (`tacPdfOptions:<app>`).
 *
 * Les profils d'image (`PDF_IMAGE_PROFILES`) sont la source unique de la
 * définition et de la compression visées par chaque sortie : les deux moteurs
 * les lisent au lieu de porter leurs propres constantes.
 */

import { ensureFeedbackStyles, isBackdropClick } from '@shared/feedback.js';

export type PdfTheme = 'clair' | 'sombre';
export type PdfSortie = 'impression' | 'partage';

export interface PdfKindChoice {
    id: string;
    label: string;
    hint?: string;
}

export interface PdfOptions {
    /** Type de rapport choisi, `null` quand l'application n'en propose qu'un. */
    kind: string | null;
    theme: PdfTheme;
    sortie: PdfSortie;
}

export interface PdfImageProfile {
    /** Définition visée à la taille imprimée (points par pouce). */
    maxPpi: number;
    /** Qualité JPEG des photos ré-encodées. */
    jpegQuality: number;
    /** Poids maximal visé pour tout le PDF, `null` = sans plafond. */
    budgetBytes: number | null;
}

export const PDF_IMAGE_PROFILES: Readonly<Record<PdfSortie, PdfImageProfile>> = {
    impression: { maxPpi: 250, jpegQuality: 0.85, budgetBytes: null },
    partage: { maxPpi: 150, jpegQuality: 0.72, budgetBytes: 10 * 1024 * 1024 },
};

/** Pixels utiles pour une image imprimée sur `printedWidthPt` points. */
export function targetPixels(printedWidthPt: number, sortie: PdfSortie): number {
    return Math.ceil((printedWidthPt / 72) * PDF_IMAGE_PROFILES[sortie].maxPpi);
}

/** Poids lisible en français : « 512 o », « 2 Ko », « 8,4 Mo ». */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} o`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

const STORAGE_PREFIX = 'tacPdfOptions:';
const THEMES: readonly PdfTheme[] = ['clair', 'sombre'];
const SORTIES: readonly PdfSortie[] = ['impression', 'partage'];

function defaults(kinds: readonly PdfKindChoice[] | undefined): PdfOptions {
    return { kind: kinds?.[0]?.id ?? null, theme: 'clair', sortie: 'impression' };
}

export function loadPdfOptions(appKey: string, kinds?: readonly PdfKindChoice[]): PdfOptions {
    const base = defaults(kinds);
    let stored: unknown = null;
    try {
        stored = JSON.parse(localStorage.getItem(STORAGE_PREFIX + appKey) ?? 'null');
    } catch {
        return base;
    }
    if (!stored || typeof stored !== 'object') return base;
    const s = stored as Partial<Record<keyof PdfOptions, unknown>>;
    return {
        kind: kinds && kinds.some((k) => k.id === s.kind) ? (s.kind as string) : base.kind,
        theme: THEMES.includes(s.theme as PdfTheme) ? (s.theme as PdfTheme) : base.theme,
        sortie: SORTIES.includes(s.sortie as PdfSortie) ? (s.sortie as PdfSortie) : base.sortie,
    };
}

export function savePdfOptions(appKey: string, options: PdfOptions): void {
    try {
        localStorage.setItem(STORAGE_PREFIX + appKey, JSON.stringify(options));
    } catch {
        // Stockage plein ou indisponible : le choix vaut pour cette génération seulement.
    }
}

const STYLE_ID = 'tac-pdf-options-style';

function injectStyles(): void {
    ensureFeedbackStyles();
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.tac-pdf-options { display: grid; gap: var(--tac-space-4, 16px); margin: 0; }
.tac-pdf-options fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.tac-pdf-options legend { padding: 0; margin-bottom: var(--tac-space-2, 8px); font-weight: 700; font-size: 13px; }
.tac-pdf-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--tac-space-2, 8px); }
.tac-pdf-choice {
  display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: start;
  padding: 10px 12px; min-height: 44px; border: 1px solid var(--border-light);
  border-radius: var(--tac-radius-sm, 8px); cursor: pointer;
}
.tac-pdf-choice:has(input:checked) { border-color: var(--accent-fill); box-shadow: inset 0 0 0 1px var(--accent-fill); }
.tac-pdf-choice:has(input:focus-visible) { outline: 2px solid var(--accent-fill); outline-offset: 2px; }
.tac-pdf-choice input { margin: 3px 0 0; accent-color: var(--accent-fill); }
.tac-pdf-choice-label { font-weight: 600; }
.tac-pdf-choice-hint { grid-column: 2; font-size: 12px; opacity: 0.75; }
`;
    document.head.appendChild(style);
}

function radioGroup<T extends string>(
    name: string,
    legend: string,
    choices: readonly { id: T; label: string; hint?: string | undefined }[],
    selected: T,
): HTMLFieldSetElement {
    const fieldset = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = legend;
    fieldset.appendChild(lg);
    const list = document.createElement('div');
    list.className = 'tac-pdf-choices';
    for (const c of choices) {
        const label = document.createElement('label');
        label.className = 'tac-pdf-choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = c.id;
        input.checked = c.id === selected;
        const text = document.createElement('span');
        text.className = 'tac-pdf-choice-label';
        text.textContent = c.label;
        label.append(input, text);
        if (c.hint) {
            const hint = document.createElement('span');
            hint.className = 'tac-pdf-choice-hint';
            hint.textContent = c.hint;
            label.appendChild(hint);
        }
        list.appendChild(label);
    }
    fieldset.appendChild(list);
    return fieldset;
}

export interface PdfOptionsForm {
    element: HTMLElement;
    read(): PdfOptions;
}

/**
 * Formulaire seul (sans fenêtre), pour l'intégrer à une fenêtre existante
 * (la modale de génération de l'OI). Pré-coché avec les derniers choix.
 */
export function buildPdfOptionsForm(appKey: string, kinds?: readonly PdfKindChoice[]): PdfOptionsForm {
    injectStyles();
    const current = loadPdfOptions(appKey, kinds);
    const form = document.createElement('div');
    form.className = 'tac-pdf-options';
    if (kinds && kinds.length > 1) {
        form.appendChild(radioGroup('tac-pdf-kind', 'Rapport', kinds, current.kind ?? kinds[0]!.id));
    }
    form.appendChild(radioGroup<PdfTheme>('tac-pdf-theme', 'Thème', [
        { id: 'clair', label: 'Clair', hint: 'Pour imprimer' },
        { id: 'sombre', label: 'Sombre', hint: 'Pour projeter à l’écran' },
    ], current.theme));
    form.appendChild(radioGroup<PdfSortie>('tac-pdf-sortie', 'Sortie', [
        { id: 'impression', label: 'Impression', hint: 'Photos en haute définition' },
        { id: 'partage', label: 'Partage', hint: 'Moins de 10 Mo, pour Tchap' },
    ], current.sortie));
    const value = (name: string): string | null =>
        form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? null;
    return {
        element: form,
        read: () => ({
            kind: kinds && kinds.length > 0 ? (value('tac-pdf-kind') ?? current.kind) : null,
            theme: (value('tac-pdf-theme') as PdfTheme | null) ?? current.theme,
            sortie: (value('tac-pdf-sortie') as PdfSortie | null) ?? current.sortie,
        }),
    };
}

export interface AskPdfOptions {
    appKey: string;
    title: string;
    kinds?: readonly PdfKindChoice[];
    confirmLabel?: string;
}

/**
 * Ouvre la fenêtre de génération. Résout les choix (et les retient), ou `null`
 * si l'utilisateur annule (bouton, Échap, clic sur le fond).
 */
export function askPdfOptions(options: AskPdfOptions): Promise<PdfOptions | null> {
    const { appKey, title, kinds, confirmLabel = 'Générer le PDF' } = options;
    const form = buildPdfOptionsForm(appKey, kinds);

    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'tac-confirm-dialog';
        const h = document.createElement('h2');
        h.className = 'tac-confirm-title';
        h.id = `tac-pdf-options-title-${appKey}`;
        h.textContent = title;
        dialog.setAttribute('aria-labelledby', h.id);

        const actions = document.createElement('div');
        actions.className = 'tac-confirm-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'tac-confirm-btn tac-confirm-btn--cancel';
        cancelBtn.textContent = 'Annuler';
        cancelBtn.dataset.tacConfirm = 'cancel';
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'tac-confirm-btn tac-confirm-btn--ok';
        okBtn.textContent = confirmLabel;
        okBtn.dataset.tacConfirm = 'ok';
        actions.append(cancelBtn, okBtn);
        dialog.append(h, form.element, actions);
        document.body.appendChild(dialog);

        let settled = false;
        let result: PdfOptions | null = null;
        const settle = (): void => {
            if (settled) return;
            settled = true;
            dialog.remove();
            resolve(result);
        };
        const close = (value: PdfOptions | null): void => {
            result = value;
            if (value) savePdfOptions(appKey, value);
            if (typeof dialog.close === 'function') {
                try {
                    dialog.close();
                    return; // l'événement 'close' appelle settle()
                } catch { /* repli ci-dessous */ }
            }
            settle();
        };

        okBtn.addEventListener('click', () => close(form.read()));
        cancelBtn.addEventListener('click', () => close(null));
        dialog.addEventListener('click', (e) => { if (isBackdropClick(dialog, e)) close(null); });
        dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
        dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
        dialog.addEventListener('close', settle);

        if (typeof dialog.showModal === 'function') {
            try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
        } else {
            dialog.setAttribute('open', '');
        }
        okBtn.focus();
    });
}
