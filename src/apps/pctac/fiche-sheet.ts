/**
 * fiche-sheet.ts — La fiche adverse ou protégée à l'écran (décisions 16 à 20).
 *
 * UN seul formulaire pour créer et pour modifier : plein écran sur téléphone,
 * fenêtre sur bureau (`<dialog id="ficheSheet">`). Tout est construit depuis
 * le modèle (`fiche.ts`) : ajouter un champ là-bas le fait apparaître ici, dans
 * la carte et dans le PDF, sans seconde liste à tenir d'accord.
 *
 * - Sections repliables (`<details>` natif : clavier et lecteur d'écran sans
 *   code), la première ouverte, compteur « 2/5 » par section.
 * - Brouillon gardé à chaque frappe, par situation et par fiche : un appel
 *   entrant ou un onglet fermé ne coûte pas la saisie. Photo exclue (lourde).
 * - Le geste retour d'Android ferme la fiche, pas la page (entrée d'historique
 *   poussée à l'ouverture).
 * - Un champ masqué par la variante (Témoin, Phénomène) n'est jamais relu,
 *   donc jamais effacé : la fiche garde sa valeur.
 */

import { ADVERSARIES_KEY, FICHE_DRAFT_KEY, HOSTAGES_KEY, PHOTOS_KEY, hostageStatusFromBlessures } from '@pctac/config.js';
import { Storage } from '@pctac/storage.js';
import { ImageStore } from '@pctac/image-store.js';
import { Utils } from '@pctac/utils.js';
import { PCTAC_MODES, currentModeId, scopedKey } from '@pctac/modes.js';
import {
    TYPE_MENACE_KEY,
    ageFromDob,
    defaultStatus,
    ficheSections,
    ficheTitle,
    headerFields,
    parseChips,
    serializeChips,
    statusChoices,
    toggleChip,
    type FicheField,
    type FicheSide,
} from '@pctac/fiche.js';
import { esc } from '@shared/ui-platform.js';
import { toast } from '@shared/feedback.js';

interface Draft {
    values: Record<string, string>;
    savedAt: number;
    /** Fiche telle qu'à l'ouverture (modification) : un écart écarte le brouillon. */
    base: string | null;
}

interface SheetState {
    side: FicheSide;
    id: string | null;
    base: string | null;
    /** Valeurs de départ (fiche existante ou brouillon repris). */
    item: Record<string, unknown>;
    photo: string | null;
    statusTouched: boolean;
    dirty: boolean;
}

let state: SheetState | null = null;
let historyPushed = false;
/** Dialogue déjà câblé (un gabarit rechargé en crée un neuf). */
let boundTo: HTMLDialogElement | null = null;
let popstateBound = false;

const collectionKey = (side: FicheSide): string => (side === 'adv' ? ADVERSARIES_KEY : HOSTAGES_KEY);
const slotOf = (side: FicheSide, id: string | null): string => `${side}:${id ?? 'new'}`;

// --- Brouillons -------------------------------------------------------------

function readDrafts(): Record<string, Draft> {
    try {
        const raw = localStorage.getItem(scopedKey(FICHE_DRAFT_KEY));
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, Draft> : {};
    } catch {
        return {};
    }
}

function writeDrafts(drafts: Record<string, Draft>): void {
    try {
        if (Object.keys(drafts).length === 0) localStorage.removeItem(scopedKey(FICHE_DRAFT_KEY));
        else localStorage.setItem(scopedKey(FICHE_DRAFT_KEY), JSON.stringify(drafts));
    } catch {
        // Stockage plein ou indisponible : la saisie reste à l'écran.
    }
}

function dropDraft(side: FicheSide, id: string | null): void {
    const drafts = readDrafts();
    delete drafts[slotOf(side, id)];
    writeDrafts(drafts);
}

function saveDraft(): void {
    if (!state) return;
    const drafts = readDrafts();
    drafts[slotOf(state.side, state.id)] = { values: collect(), savedAt: Date.now(), base: state.base };
    writeDrafts(drafts);
}

// --- Rendu ------------------------------------------------------------------

function dialogEl(): HTMLDialogElement | null {
    return document.getElementById('ficheSheet') as HTMLDialogElement | null;
}

function attr(value: unknown): string {
    return esc(String(value ?? ''));
}

function chipsHtml(field: FicheField, value: unknown, cls = ''): string {
    const chips = field.chips ?? [];
    const { selected, precision } = parseChips(value, chips);
    const buttons = chips.map((c) => `<button type="button" class="fiche-chip" aria-pressed="${selected.includes(c)}" data-chip="${attr(c)}">${esc(c)}</button>`).join('');
    const precisionInput = field.key === TYPE_MENACE_KEY || !field.placeholder ? '' :
        `<input type="text" class="fiche-precision" aria-label="${attr(field.label)} : précision" placeholder="${attr(field.placeholder)}"
            value="${attr(precision)}"${field.numeric ? ' inputmode="numeric"' : ''}>`;
    return `<div class="fiche-chips ${cls}" data-key="${attr(field.key)}">
        <div class="fiche-chip-row" role="group" aria-label="${attr(field.label)}">${buttons}</div>${precisionInput}</div>`;
}

function linkOptions(current: string): string {
    const advs = Storage.loadCollection(ADVERSARIES_KEY);
    const mode = currentModeId();
    let html = '<option value="">— Aucun —</option>' + advs.map((a) =>
        `<option value="${attr(a.id)}"${a.id === current ? ' selected' : ''}>${esc(ficheTitle('adv', mode, a))}</option>`).join('');
    // Ancien texte libre, ou fiche supprimée depuis : gardé, jamais perdu.
    if (current && !advs.some((a) => a.id === current)) {
        html += `<option value="${attr(current)}" selected>${esc(current)} (fiche supprimée ou texte libre)</option>`;
    }
    return html;
}

function fieldHtml(field: FicheField, value: unknown): string {
    const id = `fiche_${field.key}`;
    const v = String(value ?? '');
    const ph = field.placeholder ? ` placeholder="${attr(field.placeholder)}"` : '';
    const label = `<label for="${id}">${esc(field.label)}</label>`;
    switch (field.kind) {
        case 'chips':
            return `<div class="fiche-field"><span class="fiche-label">${esc(field.label)}</span>${chipsHtml(field, v)}</div>`;
        case 'long':
            return `<div class="fiche-field">${label}<textarea id="${id}" data-key="${attr(field.key)}" rows="2"${ph}>${esc(v)}</textarea></div>`;
        case 'time':
            return `<div class="fiche-field">${label}<div class="fiche-time">
                <input type="time" id="${id}" data-key="${attr(field.key)}" value="${attr(v)}">
                <button type="button" class="fiche-now" data-now="${attr(field.key)}">Maintenant</button></div></div>`;
        case 'tel':
            return `<div class="fiche-field">${label}<input type="tel" id="${id}" data-key="${attr(field.key)}" autocomplete="off" value="${attr(v)}"${ph}></div>`;
        case 'dob': {
            const age = ageFromDob(v);
            return `<div class="fiche-field">${label}<input type="text" id="${id}" data-key="${attr(field.key)}" autocomplete="off" value="${attr(v)}"${ph}>
                <span class="fiche-hint" data-age-for="${attr(field.key)}">${age === null ? '' : `${age} ans`}</span></div>`;
        }
        case 'link':
            return `<div class="fiche-field">${label}<select id="${id}" data-key="${attr(field.key)}">${linkOptions(v)}</select></div>`;
        default:
            return `<div class="fiche-field">${label}<input type="text" id="${id}" data-key="${attr(field.key)}" autocomplete="off" value="${attr(v)}"${ph}></div>`;
    }
}

function isFilled(el: Element): boolean {
    if (el.classList.contains('fiche-chips')) {
        return !!el.querySelector('.fiche-chip[aria-pressed="true"]') || !!(el.querySelector<HTMLInputElement>('.fiche-precision')?.value.trim());
    }
    return !!(el as HTMLInputElement).value?.trim();
}

function updateCounts(root: ParentNode): void {
    root.querySelectorAll<HTMLDetailsElement>('.fiche-section').forEach((sec) => {
        const fields = [...sec.querySelectorAll('[data-key]')];
        const filled = fields.filter(isFilled).length;
        const count = sec.querySelector('.fiche-count');
        if (count) count.textContent = `${filled}/${fields.length}`;
    });
}

function statusHtml(side: FicheSide, current: string): string {
    const choices = statusChoices(side, currentModeId());
    if (choices.length === 0) return '';
    const label = side === 'host' && (currentModeId() === 'tp' || currentModeId() === 'evenement') ? 'Triage' : 'Statut';
    return `<div class="fiche-field fiche-status"><span class="fiche-label">${label}</span>
        <div class="fiche-chip-row" role="radiogroup" aria-label="${label}">${choices.map((c) =>
            `<button type="button" class="fiche-chip fiche-status-chip" role="radio" aria-checked="${c.key === current}" data-status="${attr(c.key)}"
                style="--chip-color: ${c.color}">${esc(c.label)}</button>`).join('')}</div></div>`;
}

function render(): void {
    const dlg = dialogEl();
    if (!dlg || !state) return;
    const { side, id, item } = state;
    const mode = currentModeId();
    const lex = PCTAC_MODES[mode][side];
    const sections = ficheSections(side, mode, item);
    const status = String(item.status || defaultStatus(side, mode));
    const draft = readDrafts()[slotOf(side, id)];
    const photoSrc = state.photo ?? (typeof item.photo === 'string' ? item.photo : '');
    const title = id ? `Modifier ${lex.demonstrative}` : lex.newLabel;

    dlg.innerHTML = `
    <form class="fiche-form" novalidate>
        <header class="fiche-head">
            <h2 id="ficheSheetTitle">${esc(title)}</h2>
            <button type="button" class="fiche-close" aria-label="Fermer la fiche"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
        </header>
        <div class="fiche-body">
            ${draft && !state.dirty ? `<div class="fiche-draft" role="status">
                <span>Saisie non enregistrée du ${new Date(draft.savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                <button type="button" class="fiche-draft-resume">Reprendre</button>
                <button type="button" class="fiche-draft-drop">Effacer</button></div>` : ''}
            <div class="fiche-top">
                <label class="fiche-photo" aria-label="Photo">
                    ${photoSrc ? `<img src="${attr(photoSrc)}" alt="">` : `<span class="material-symbols-outlined" aria-hidden="true">add_a_photo</span>`}
                    <input type="file" accept="image/*" class="fiche-photo-input" hidden>
                </label>
                <div class="fiche-top-fields">
                    ${statusHtml(side, status)}
                    ${headerFields(side, mode).map((f) => `<div class="fiche-field"><span class="fiche-label">${esc(f.label)}</span>${chipsHtml(f, item[f.key])}</div>`).join('')}
                </div>
            </div>
            ${sections.map((s, i) => `
            <details class="fiche-section" data-section="${attr(s.id)}"${i === 0 ? ' open' : ''}>
                <summary><span class="fiche-section-title">${esc(s.title)}</span><span class="fiche-count"></span></summary>
                <div class="fiche-section-body">${s.fields.map((f) => fieldHtml(f, item[f.key])).join('')}</div>
            </details>`).join('')}
        </div>
        <footer class="fiche-foot">
            <button type="button" class="fiche-save-next">Enregistrer et suivante</button>
            <button type="submit" class="fiche-save">${esc(id ? 'Enregistrer' : lex.saveLabel)}</button>
        </footer>
    </form>`;
    updateCounts(dlg);
}

// --- Lecture du formulaire --------------------------------------------------

/** Valeurs affichées, clé par clé (les champs masqués n'y sont pas). */
function collect(): Record<string, string> {
    const dlg = dialogEl();
    const out: Record<string, string> = {};
    if (!dlg || !state) return out;
    dlg.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
        const key = el.dataset.key;
        if (!key) return;
        if (el.classList.contains('fiche-chips')) {
            const selected = [...el.querySelectorAll<HTMLElement>('.fiche-chip[aria-pressed="true"]')].map((b) => b.dataset.chip ?? '');
            const precision = el.querySelector<HTMLInputElement>('.fiche-precision')?.value ?? '';
            const all = [...el.querySelectorAll<HTMLElement>('.fiche-chip')].map((b) => b.dataset.chip ?? '');
            out[key] = serializeChips(selected, precision, all);
        } else {
            out[key] = (el as HTMLInputElement).value.trim();
        }
    });
    const status = dlg.querySelector<HTMLElement>('.fiche-status-chip[aria-checked="true"]')?.dataset.status;
    if (status) out.status = status;
    return out;
}

function fieldOf(key: string): FicheField | undefined {
    if (!state) return undefined;
    const mode = currentModeId();
    return [...headerFields(state.side, mode), ...ficheSections(state.side, mode, state.item).flatMap((s) => s.fields)]
        .find((f) => f.key === key && f.kind === 'chips');
}

/** Re-rend en gardant la saisie (changement de type de menace). */
function rerenderKeepingInput(): void {
    if (!state) return;
    const open = [...(dialogEl()?.querySelectorAll<HTMLDetailsElement>('.fiche-section[open]') ?? [])].map((d) => d.dataset.section);
    state.item = { ...state.item, ...collect() };
    render();
    dialogEl()?.querySelectorAll<HTMLDetailsElement>('.fiche-section').forEach((d) => {
        if (open.includes(d.dataset.section)) d.open = true;
    });
}

function markDirty(): void {
    if (!state) return;
    state.dirty = true;
    dialogEl()?.querySelector('.fiche-draft')?.remove();
    saveDraft();
    const dlg = dialogEl();
    if (dlg) updateCounts(dlg);
}

// --- Enregistrement ---------------------------------------------------------

async function syncPhoto(side: FicheSide, item: Record<string, unknown>, dataUrl: string): Promise<void> {
    const id = String(item.id);
    try {
        await ImageStore.put(id, dataUrl);
        await ImageStore.put(`${id}_sync`, dataUrl);
    } catch (e) {
        console.error('[PC TAC] enregistrement photo échec:', e);
        toast('Photo non enregistrée (stockage)', { kind: 'error' });
        return;
    }
    delete item.photo;
    item.hasImage = true;
    // Copie dans la galerie Photos, qui suit le statut de la fiche.
    const photos = Storage.loadCollection(PHOTOS_KEY);
    const title = ficheTitle(side, currentModeId(), item);
    const existing = photos.find((p) => p.id === `${id}_sync`);
    if (existing) {
        delete existing.data;
        existing.hasImage = true;
        existing.title = title;
    } else {
        photos.push({
            id: `${id}_sync`,
            title,
            category: side === 'adv' ? 'neutralized' : 'hostage',
            status: String(item.status || defaultStatus(side, currentModeId())),
            hasImage: true,
        });
    }
    Storage.saveCollection(PHOTOS_KEY, photos);
}

async function save(next: boolean): Promise<void> {
    const dlg = dialogEl();
    if (!state || !dlg) return;
    const { side, id } = state;
    const mode = currentModeId();
    const values = collect();
    const { status: chosen, ...fields } = values;
    const hasContent = Object.values(fields).some((v) => v !== '') || state.photo !== null;
    if (!id && !hasContent) {
        toast('Renseignez au moins un champ', { kind: 'error' });
        return;
    }
    const buttons = dlg.querySelectorAll<HTMLButtonElement>('.fiche-save, .fiche-save-next');
    buttons.forEach((b) => { b.disabled = true; });
    try {
        const key = collectionKey(side);
        const list = Storage.loadCollection(key);
        let item = id ? list.find((i) => i.id === id) : undefined;
        if (id && !item) {
            toast('Fiche introuvable (supprimée entre-temps ?)', { kind: 'error' });
            close();
            return;
        }
        const created = !item;
        if (!item) {
            item = { id: Date.now().toString() };
            list.push(item);
        }
        const oldBlessures = String(item.blessures ?? '');
        // Saisie masquée par un changement de type (Phénomène) : gardée aussi.
        const kept = Object.fromEntries(Object.entries(state.item)
            .filter(([k, v]) => typeof v === 'string' && !['id', 'photo', 'status'].includes(k)));
        // Un champ vidé retire sa clé : les QR et archives ne transportent
        // pas une vingtaine de valeurs vides par fiche.
        Object.entries({ ...kept, ...fields }).forEach(([k, v]) => {
            if (v === '') delete item![k];
            else item![k] = v;
        });

        // Statut. Forcené : la déduction par les blessures ne vaut que tant que
        // l'opérateur n'a pas choisi lui-même. Triage : jamais déduit.
        let status = chosen ?? String(item.status || defaultStatus(side, mode));
        if (side === 'host' && mode === 'forcene' && !state.statusTouched
            && (created || String(item.blessures ?? '') !== oldBlessures)) {
            status = hostageStatusFromBlessures(item.blessures);
        }
        if (created) item.status = status;
        if (state.photo) await syncPhoto(side, item, state.photo);
        Storage.saveCollection(key, list);
        // Modification : le changement de statut passe par la voie commune
        // (photo liée, entrée automatique en main courante).
        if (!created && status !== item.status) window.UI.setItemStatus(key, String(item.id), status);

        dropDraft(side, id);
        toast(created ? 'Fiche enregistrée' : 'Fiche mise à jour', { kind: 'success' });
        if (side === 'adv') await window.UI.renderAdversaries();
        else await window.UI.renderHostages();
        if (state.photo) await window.UI.renderPhotos();
        if (next) {
            state = { side, id: null, base: null, item: {}, photo: null, statusTouched: false, dirty: false };
            render();
            dlg.querySelector<HTMLElement>('.fiche-body')?.scrollTo?.({ top: 0 });
        } else {
            close();
        }
    } finally {
        buttons.forEach((b) => { b.disabled = false; });
    }
}

// --- Événements -------------------------------------------------------------

function onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const dlg = dialogEl();
    if (!state || !dlg) return;
    if (target.closest('.fiche-close')) { close(); return; }
    if (target.closest('.fiche-save-next')) { void save(true); return; }
    if (target.closest('.fiche-draft-resume')) {
        const draft = readDrafts()[slotOf(state.side, state.id)];
        if (draft) {
            state.item = { ...state.item, ...draft.values };
            if (draft.values.status) state.statusTouched = true;
            state.dirty = true;
            render();
        }
        return;
    }
    if (target.closest('.fiche-draft-drop')) {
        dropDraft(state.side, state.id);
        target.closest('.fiche-draft')?.remove();
        return;
    }
    const now = target.closest<HTMLElement>('.fiche-now');
    if (now) {
        const input = dlg.querySelector<HTMLInputElement>(`[data-key="${now.dataset.now}"]`);
        if (input) {
            const d = new Date();
            input.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            markDirty();
        }
        return;
    }
    const statusChip = target.closest<HTMLElement>('.fiche-status-chip');
    if (statusChip) {
        dlg.querySelectorAll('.fiche-status-chip').forEach((b) => b.setAttribute('aria-checked', String(b === statusChip)));
        state.statusTouched = true;
        markDirty();
        return;
    }
    const chip = target.closest<HTMLElement>('.fiche-chip');
    if (chip) {
        const box = chip.closest<HTMLElement>('.fiche-chips');
        const field = box?.dataset.key ? fieldOf(box.dataset.key) : undefined;
        if (!box || !field) return;
        const selected = [...box.querySelectorAll<HTMLElement>('.fiche-chip[aria-pressed="true"]')].map((b) => b.dataset.chip ?? '');
        const next = toggleChip(selected, chip.dataset.chip ?? '', field);
        box.querySelectorAll<HTMLElement>('.fiche-chip').forEach((b) => b.setAttribute('aria-pressed', String(next.includes(b.dataset.chip ?? ''))));
        if (field.key === TYPE_MENACE_KEY) rerenderKeepingInput();
        markDirty();
    }
}

function onInput(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.classList.contains('fiche-photo-input')) return;
    const ageFor = (target as HTMLInputElement).dataset.key;
    if (ageFor) {
        const hint = dialogEl()?.querySelector(`[data-age-for="${ageFor}"]`);
        if (hint) {
            const age = ageFromDob((target as HTMLInputElement).value);
            hint.textContent = age === null ? '' : `${age} ans`;
        }
    }
    markDirty();
}

async function onChange(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains('fiche-photo-input') || !state) return;
    const file = input.files?.[0];
    if (!file) return;
    try {
        state.photo = await Utils.compressImage(file, 800, 800, 0.7);
        const holder = input.closest('.fiche-photo');
        holder?.querySelector('img, .material-symbols-outlined')?.remove();
        const img = document.createElement('img');
        img.src = state.photo;
        img.alt = '';
        holder?.prepend(img);
    } catch (err) {
        console.error('Erreur de compression:', err);
        toast('Échec du traitement de la photo', { kind: 'error' });
    }
}

function bind(dlg: HTMLDialogElement): void {
    if (boundTo === dlg) return;
    boundTo = dlg;
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('input', onInput);
    dlg.addEventListener('change', (e) => { void onChange(e); });
    dlg.addEventListener('submit', (e) => { e.preventDefault(); void save(false); });
    // Fermeture par Échap ou `close()` : on rend l'entrée d'historique.
    dlg.addEventListener('close', () => {
        state = null;
        if (historyPushed) {
            historyPushed = false;
            history.back();
        }
    });
    // Geste retour (Android) ou bouton précédent : ferme la fiche, pas la page.
    if (popstateBound) return;
    popstateBound = true;
    window.addEventListener('popstate', () => {
        if (!historyPushed) return;
        historyPushed = false;
        const open = dialogEl();
        if (open?.open) open.close();
    });
}

// --- API --------------------------------------------------------------------

/** Ouvre la fiche : création si `id` est absent, modification sinon. */
export async function openFiche(side: FicheSide, id: string | null = null): Promise<void> {
    const dlg = dialogEl();
    if (!dlg) return;
    bind(dlg);
    let item: Record<string, unknown> = {};
    let base: string | null = null;
    if (id) {
        const found = Storage.loadCollection(collectionKey(side)).find((i) => i.id === id);
        if (!found) {
            toast('Fiche introuvable', { kind: 'error' });
            return;
        }
        base = JSON.stringify(found);
        item = { ...found };
        const photo = await ImageStore.get(id).catch(() => null);
        if (photo) item.photo = photo;
    }
    // Brouillon d'une fiche modifiée ailleurs depuis (import QR, autre vue) :
    // le reprendre écraserait la nouvelle version, on l'écarte en le disant.
    const draft = readDrafts()[slotOf(side, id)];
    if (draft && draft.base !== base) {
        dropDraft(side, id);
        toast('Brouillon écarté : la fiche a changé depuis', { kind: 'info' });
    }
    state = { side, id, base, item, photo: null, statusTouched: false, dirty: false };
    render();
    if (!dlg.open) {
        dlg.showModal();
        try {
            history.pushState({ pctacFiche: true }, '');
            historyPushed = true;
        } catch {
            // Historique indisponible (bac à sable) : la fiche reste fermable.
        }
    }
}

export function close(): void {
    const dlg = dialogEl();
    if (dlg?.open) dlg.close();
}
