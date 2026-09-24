/**
 * fiche-sheet.ts — La fiche adverse ou protégée à l'écran (décisions 16 à 20).
 *
 * UN seul formulaire pour créer et pour modifier (`<dialog id="ficheSheet">`) :
 * plein écran modal sur téléphone ; sur bureau et tablette (décision 21), ouvert
 * sans modale DANS l'onglet de son camp, à droite de la liste (classe
 * `fiche-inline`, placée dans le `.fiche-layout` de la liste). Tout est construit depuis
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
import { annotatePhoto } from '@pctac/photo-annotation.js';

interface Draft {
    values: Record<string, string>;
    savedAt: number;
    /** Fiche telle qu'à l'ouverture, statut exclu (modification) : un écart écarte le brouillon. */
    base: string | null;
    /** Statut choisi par l'opérateur (sinon, celui du brouillon n'est pas repris). */
    statusTouched?: boolean;
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
    /** Brouillon trouvé à l'ouverture, ni repris ni effacé : jamais écrasé. */
    pendingDraft: boolean;
    /** Compression photo en cours : l'enregistrement l'attend. */
    photoPending: Promise<void> | null;
}

let state: SheetState | null = null;
/** Enregistrement en cours : aucune autre fiche ne s'ouvre (dans la page, la
 *  liste reste cliquable pendant l'attente de la photo). */
let saving = false;
let historyPushed = false;
/** Dialogue déjà câblé (un gabarit rechargé en crée un neuf). */
let boundTo: HTMLDialogElement | null = null;
let popstateBound = false;

/** Même seuil que le CSS : téléphone, ou téléphone en paysage. */
const FULLSCREEN_MQ = '(max-width: 640px), (max-height: 500px)';

const isPhone = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(FULLSCREEN_MQ).matches;

const FIRST_FIELD = '.fiche-section[open] [data-key], .fiche-section[open] .fiche-precision';

/** Fiche dans la page : haut caché (barre d'onglets, liste défilée) ou trop
 *  bas, on l'amène en vue ; puis le focus y entre, sinon il reste dans la
 *  liste et le changement de fiche passe inaperçu. */
function reveal(dlg: HTMLDialogElement, focusSel: string): void {
    const { top } = dlg.getBoundingClientRect();
    if (top < 80 || top > window.innerHeight / 2) dlg.scrollIntoView?.({ block: 'start' });
    // Sans preventScroll : un champ resté sous le pied collant (dock déplié)
    // est remonté, la marge de défilement du CSS en tient compte.
    dlg.querySelector<HTMLElement>(focusSel)?.focus();
}

// Rechargement pendant qu'une fiche était ouverte : l'entrée d'historique
// qu'elle avait poussée est encore là, et un « retour » tomberait dans le
// vide. On la consomme dès le chargement (même document, sans navigation).
try {
    if ((history.state as { pctacFiche?: boolean } | null)?.pctacFiche) history.back();
} catch {
    // Historique inaccessible : sans conséquence.
}

const collectionKey = (side: FicheSide): string => (side === 'adv' ? ADVERSARIES_KEY : HOSTAGES_KEY);
const slotOf = (side: FicheSide, id: string | null): string => `${side}:${id ?? 'new'}`;

/** Empreinte d'une fiche pour son brouillon. Le statut en est exclu : il change
 *  depuis la carte sans que la saisie en cours soit périmée pour autant. */
function baseOf(fiche: Record<string, unknown>): string {
    return JSON.stringify({ ...fiche, status: undefined });
}

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

function saveDraft(force = false): void {
    if (!state || (state.pendingDraft && !force)) return;
    const drafts = readDrafts();
    drafts[slotOf(state.side, state.id)] = { values: collect(), savedAt: Date.now(), base: state.base, statusTouched: state.statusTouched };
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
    const { selected, precision } = parseChips(value, chips, field);
    const buttons = chips.map((c) => `<button type="button" class="fiche-chip" aria-pressed="${selected.includes(c)}" data-chip="${attr(c)}">${esc(c)}</button>`).join('');
    // Précision : si le champ en prévoit une, ou si la valeur stockée porte un
    // texte hors pastilles (sans champ pour l'afficher, il serait effacé).
    const withPrecision = (field.key !== TYPE_MENACE_KEY && !!field.placeholder) || precision !== '';
    const precisionInput = !withPrecision ? '' :
        `<input type="text" class="fiche-precision" aria-label="${attr(field.label)} : précision" placeholder="${attr(field.placeholder ?? 'Précision')}"
            value="${attr(precision)}" enterkeyhint="next"${field.numeric ? ' inputmode="numeric"' : ''}>`;
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
        case 'time': {
            // Heure HH:MM : sélecteur natif. Texte libre ancien (« vers 14h ») :
            // champ texte, sinon le sélecteur l'afficherait vide et l'effacerait.
            const type = v === '' || /^\d{2}:\d{2}$/.test(v) ? 'time' : 'text';
            return `<div class="fiche-field">${label}<div class="fiche-time">
                <input type="${type}" id="${id}" data-key="${attr(field.key)}" value="${attr(v)}" enterkeyhint="next">
                <button type="button" class="fiche-now" data-now="${attr(field.key)}">Maintenant</button></div></div>`;
        }
        case 'tel':
            return `<div class="fiche-field">${label}<input type="tel" id="${id}" data-key="${attr(field.key)}" autocomplete="off" enterkeyhint="next" value="${attr(v)}"${ph}></div>`;
        case 'dob': {
            const age = ageFromDob(v);
            return `<div class="fiche-field">${label}<input type="text" id="${id}" data-key="${attr(field.key)}" autocomplete="off" enterkeyhint="next" value="${attr(v)}"${ph}>
                <span class="fiche-hint" data-age-for="${attr(field.key)}">${age === null ? '' : `${age} ans`}</span></div>`;
        }
        case 'link':
            return `<div class="fiche-field">${label}<select id="${id}" data-key="${attr(field.key)}">${linkOptions(v)}</select></div>`;
        default:
            return `<div class="fiche-field">${label}<input type="text" id="${id}" data-key="${attr(field.key)}" autocomplete="off" enterkeyhint="next" value="${attr(v)}"${ph}></div>`;
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
        <div class="fiche-chip-row" role="radiogroup" aria-label="${label}">${choices.map((c, i) => {
            const checked = c.key === current;
            const tabbable = checked || (i === 0 && !choices.some((x) => x.key === current));
            return `<button type="button" class="fiche-chip fiche-status-chip" role="radio" aria-checked="${checked}" tabindex="${tabbable ? 0 : -1}"
                data-status="${attr(c.key)}" style="--chip-color: ${c.color}">${esc(c.label)}</button>`;
        }).join('')}</div></div>`;
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
    const title = id ? `Modifier ${lex.demonstrative} : ${ficheTitle(side, mode, item)}` : lex.newLabel;

    dlg.innerHTML = `
    <form class="fiche-form" novalidate>
        <header class="fiche-head">
            <h2 id="ficheSheetTitle">${esc(title)}</h2>
            <button type="button" class="fiche-close" aria-label="Fermer la fiche"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
        </header>
        <div class="fiche-body">
            ${draft && state.pendingDraft ? `<div class="fiche-draft" role="status">
                <span>Saisie non enregistrée du ${new Date(draft.savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                <button type="button" class="fiche-draft-resume">Reprendre</button>
                <button type="button" class="fiche-draft-drop">Effacer</button></div>` : ''}
            <div class="fiche-top">
                <div class="fiche-photo-col">
                    <label class="fiche-photo" aria-label="Photo">
                        ${photoSrc ? `<img src="${attr(photoSrc)}" alt="">` : `<span class="material-symbols-outlined" aria-hidden="true">add_a_photo</span>`}
                        <input type="file" accept="image/*" class="fiche-photo-input" hidden>
                    </label>
                    ${id && photoSrc && !state.photo ? `<button type="button" class="fiche-annotate"><span class="material-symbols-outlined" aria-hidden="true">draw</span>Annoter</button>` : ''}
                </div>
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
            <button type="button" class="fiche-save">${esc(id ? 'Enregistrer' : lex.saveLabel)}</button>
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
    // Nouvelle photo : l'annotation de l'ancienne ne la concerne plus (décision 25).
    if (item.annotations !== undefined) {
        delete item.annotations;
        try { await ImageStore.delete(`${id}_orig`); } catch { /* original orphelin, sans effet visible */ }
    }
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
    // `s` et non `state` : la fiche affichée peut changer ou se fermer pendant
    // les attentes ; on n'écrit jamais le formulaire d'une autre fiche.
    const s = state;
    if (!s || !dlg || saving) return;
    const { side, id } = s;
    const mode = currentModeId();
    const buttons = dlg.querySelectorAll<HTMLButtonElement>('.fiche-save, .fiche-save-next');
    saving = true;
    buttons.forEach((b) => { b.disabled = true; });
    try {
        // Photo en cours de compression : l'attendre, sinon la fiche part sans.
        if (s.photoPending) await s.photoPending;
        // Fermée pendant l'attente : rien n'est écrit, la saisie est en brouillon.
        if (state !== s) return;
        const values = collect();
        const { status: chosen, ...fields } = values;
        const hasContent = Object.values(fields).some((v) => v !== '') || s.photo !== null;
        if (!id && !hasContent) {
            toast('Renseignez au moins un champ', { kind: 'error' });
            return;
        }
        const key = collectionKey(side);
        const list = Storage.loadCollection(key);
        let item = id ? list.find((i) => i.id === id) : undefined;
        if (id && !item) {
            // Supprimée ailleurs (autre onglet) : la saisie devient le brouillon
            // d'une NOUVELLE fiche, proposé au prochain « + ».
            const drafts = readDrafts();
            const freeSlot = !drafts[slotOf(side, null)];
            if (freeSlot) {
                drafts[slotOf(side, null)] = { values, savedAt: Date.now(), base: null, statusTouched: s.statusTouched };
                delete drafts[slotOf(side, id)];
                writeDrafts(drafts);
            }
            toast(freeSlot
                ? 'Fiche supprimée entre-temps : votre saisie est proposée dans une nouvelle fiche'
                : 'Fiche supprimée entre-temps : votre saisie reste en brouillon', { kind: 'error' });
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
        const kept = Object.fromEntries(Object.entries(s.item)
            .filter(([k, v]) => typeof v === 'string' && !['id', 'photo', 'status'].includes(k)));
        // Seuls les champs changés depuis l'ouverture sont écrits : une valeur
        // posée ailleurs pendant la saisie (import, autre vue) n'est pas
        // écrasée par la copie d'ouverture. Un champ vidé retire sa clé : les
        // QR et archives ne transportent pas une vingtaine de valeurs vides.
        const opened = (s.base ? JSON.parse(s.base) : {}) as Record<string, unknown>;
        Object.entries({ ...kept, ...fields }).forEach(([k, v]) => {
            if (v === String(opened[k] ?? '')) return;
            if (v === '') delete item![k];
            else item![k] = v;
        });

        // Statut. Forcené : la déduction par les blessures ne vaut que si
        // personne n'a choisi le statut : ni dans cette fiche, ni avant (un DCD
        // posé depuis la carte ne correspond pas à la déduction des anciennes
        // blessures, il est donc gardé). Triage : jamais déduit.
        // Statut de la fiche seulement s'il y a été choisi : sinon celui posé
        // depuis la carte pendant la saisie tient (pas de retour en arrière ni
        // de fausse entrée en main courante).
        let status = s.statusTouched && chosen ? chosen : String(item.status || defaultStatus(side, mode));
        const derivedBefore = String(item.status ?? '') === hostageStatusFromBlessures(oldBlessures);
        if (side === 'host' && mode === 'forcene' && !s.statusTouched
            && (created || (String(item.blessures ?? '') !== oldBlessures && derivedBefore))) {
            status = hostageStatusFromBlessures(item.blessures);
        }
        if (created) item.status = status;
        if (s.photo) await syncPhoto(side, item, s.photo);
        Storage.saveCollection(key, list);
        // Stockage plein : `saveCollection` n'échoue pas bruyamment. On relit ;
        // si la fiche n'y est pas telle quelle, rien n'est jeté ni fermé.
        const persisted = Storage.loadCollection(key).find((i) => i.id === item!.id);
        if (!persisted || JSON.stringify(persisted) !== JSON.stringify(item)) {
            saveDraft(true);
            toast('Stockage plein : fiche NON enregistrée. La saisie reste à l’écran et en brouillon.', { kind: 'error' });
            return;
        }
        // Modification : le changement de statut passe par la voie commune
        // (photo liée, entrée automatique en main courante).
        if (!created && status !== item.status) window.UI.setItemStatus(key, String(item.id), status);

        // Brouillon ancien jamais tranché : il reste proposé (autre saisie).
        if (!s.pendingDraft) dropDraft(side, id);
        toast(created ? 'Fiche enregistrée' : 'Fiche mise à jour', { kind: 'success' });
        if (side === 'adv') await window.UI.renderAdversaries();
        else await window.UI.renderHostages();
        if (s.photo) await window.UI.renderPhotos();
        // Fermée pendant l'enregistrement : c'est écrit, rien d'autre à faire.
        if (state !== s) return;
        if (next) {
            const pendingDraft = !!readDrafts()[slotOf(side, null)];
            state = { side, id: null, base: null, item: {}, photo: null, statusTouched: false, dirty: false, pendingDraft, photoPending: null };
            render();
            // Saisie en rafale : on repart directement dans le premier champ.
            if (dlg.classList.contains('fiche-inline')) {
                reveal(dlg, FIRST_FIELD);
            } else {
                dlg.querySelector<HTMLElement>('.fiche-body')?.scrollTo?.({ top: 0 });
                dlg.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
            }
        } else {
            // Le focus revient à la carte de la fiche, même tout juste créée.
            s.id = String(item.id);
            close();
        }
    } finally {
        saving = false;
        buttons.forEach((b) => { b.disabled = false; });
    }
}

/** Photo enregistrée de la fiche (décision 25) : la fiche montre ensuite la version annotée. */
async function annotateFichePhoto(): Promise<void> {
    const s = state;
    if (!s?.id) return;
    const saved = await annotatePhoto(s.id);
    if (!saved || state !== s) return;
    const fresh = await ImageStore.get(s.id).catch(() => null);
    const img = dialogEl()?.querySelector<HTMLImageElement>('.fiche-photo img');
    if (fresh && img) {
        s.item.photo = fresh;
        img.src = fresh;
    }
}

// --- Événements -------------------------------------------------------------

function onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const dlg = dialogEl();
    if (!state || !dlg) return;
    if (target.closest('.fiche-close')) { close(); return; }
    if (target.closest('.fiche-annotate')) { void annotateFichePhoto(); return; }
    if (target.closest('.fiche-save-next')) { void save(true); return; }
    if (target.closest('.fiche-save')) { void save(false); return; }
    if (target.closest('.fiche-draft-resume')) {
        const draft = readDrafts()[slotOf(state.side, state.id)];
        if (draft) {
            // Statut du brouillon repris seulement s'il avait été choisi : sinon
            // la déduction (Forcené) et un statut posé depuis la carte tiennent.
            const { status: draftStatus, ...values } = draft.values;
            state.item = { ...state.item, ...values, ...(draft.statusTouched && draftStatus ? { status: draftStatus } : {}) };
            state.statusTouched = draft.statusTouched === true;
            state.pendingDraft = false;
            state.dirty = true;
            render();
        }
        return;
    }
    if (target.closest('.fiche-draft-drop')) {
        dropDraft(state.side, state.id);
        state.pendingDraft = false;
        target.closest('.fiche-draft')?.remove();
        // Saisie faite pendant que le bandeau attendait : protégée à son tour.
        if (state.dirty) saveDraft();
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
        dlg.querySelectorAll('.fiche-status-chip').forEach((b) => {
            b.setAttribute('aria-checked', String(b === statusChip));
            b.setAttribute('tabindex', b === statusChip ? '0' : '-1');
        });
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
        if (field.key === TYPE_MENACE_KEY) {
            rerenderKeepingInput();
            dlg.querySelector<HTMLElement>(`[data-key="${TYPE_MENACE_KEY}"] .fiche-chip[data-chip="${CSS.escape(chip.dataset.chip ?? '')}"]`)?.focus();
        }
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
    // La fiche peut changer pendant la compression (« suivante », fermeture) :
    // la photo n'appartient qu'à celle où elle a été choisie.
    const owner = state;
    const job = (async (): Promise<void> => {
        try {
            const data = await Utils.compressImage(file, 800, 800, 0.7);
            if (state !== owner) return;
            owner.photo = data;
            const holder = input.closest('.fiche-photo');
            holder?.querySelector('img, .material-symbols-outlined')?.remove();
            const img = document.createElement('img');
            img.src = data;
            img.alt = '';
            holder?.prepend(img);
        } catch (err) {
            console.error('Erreur de compression:', err);
            toast('Échec du traitement de la photo', { kind: 'error' });
        }
    })();
    owner.photoPending = job;
    await job;
    if (owner.photoPending === job) owner.photoPending = null;
}

/** Entrée : champ suivant (jamais d'enregistrement implicite, cf. revue). */
function onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const dlg = dialogEl();
    if (!dlg) return;
    // Fiche dans la page : Échap la ferme, comme la modale, et ne va pas plus
    // loin (sortie de l'écran scindé). La saisie reste en brouillon.
    if (e.key === 'Escape' && dlg.classList.contains('fiche-inline')) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
    }
    const radio = target.closest<HTMLElement>('.fiche-status-chip');
    if (radio && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
        const radios = [...dlg.querySelectorAll<HTMLElement>('.fiche-status-chip')];
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const next = radios[(radios.indexOf(radio) + step + radios.length) % radios.length];
        e.preventDefault();
        next?.click();
        next?.focus();
        return;
    }
    if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey) return;
    if (!(target instanceof HTMLInputElement) || target.type === 'file') return;
    e.preventDefault();
    const fields = [...dlg.querySelectorAll<HTMLElement>('.fiche-body input:not([type="file"]), .fiche-body textarea, .fiche-body select')];
    const next = fields[fields.indexOf(target) + 1];
    if (!next) { target.blur(); return; }
    const section = next.closest<HTMLDetailsElement>('details');
    if (section && !section.open) section.open = true;
    next.focus();
}

/** Clavier virtuel : la fiche plein écran suit la zone réellement visible,
 *  sinon le pied « Enregistrer » reste sous le clavier (dvh ne bouge pas). */
function fitViewport(): void {
    const dlg = dialogEl();
    const vv = window.visualViewport;
    if (!dlg) return;
    if (!vv || !isPhone() || !dlg.open || dlg.classList.contains('fiche-inline')) {
        dlg.style.removeProperty('height');
        dlg.style.removeProperty('top');
        return;
    }
    dlg.style.height = `${Math.round(vv.height)}px`;
    dlg.style.top = `${Math.round(vv.offsetTop)}px`;
}

function bind(dlg: HTMLDialogElement): void {
    if (boundTo === dlg) return;
    boundTo = dlg;
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('input', onInput);
    dlg.addEventListener('change', (e) => { void onChange(e); });
    dlg.addEventListener('keydown', onKeydown);
    // Filet : aucune soumission de formulaire, quelle qu'en soit l'origine.
    dlg.addEventListener('submit', (e) => { e.preventDefault(); });
    // Fermeture par Échap ou `close()` : on rend l'entrée d'historique.
    dlg.addEventListener('close', () => {
        const closed = state;
        const pushed = historyPushed;
        state = null;
        historyPushed = false;
        // Fiche dans la page : retour à sa carte (focus et défilement), sinon
        // au bouton « + ». Le navigateur rendrait le focus à l'élément de la
        // PREMIÈRE ouverture, parfois une autre carte, hors de l'écran.
        let target: HTMLElement | null = null;
        if (closed && dlg.classList.contains('fiche-inline')) {
            const list = document.getElementById(closed.side === 'adv' ? 'adversary-table-body' : 'hostage-table-body');
            const card = closed.id ? list?.querySelector<HTMLElement>(`.fiche-card[data-id="${CSS.escape(closed.id)}"] [data-fiche-action="edit"]`) : null;
            target = card ?? document.querySelector<HTMLElement>(`[data-fiche-new="${closed.side}"]`);
            target?.focus({ preventScroll: true });
        }
        const reveal = (): void => {
            history.scrollRestoration = 'auto';
            target?.scrollIntoView?.({ block: 'nearest' });
        };
        if (!pushed) { reveal(); return; }
        // Défilement non restauré par ce retour (mode « manual » posé à
        // l'ouverture) : sinon Chrome remet, après popstate, la position
        // d'avant l'ouverture par-dessus celle de la carte.
        window.addEventListener('popstate', reveal, { once: true });
        history.back();
    });
    // Fiche dans la page : un champ qui prend le focus sous le pied collant ou
    // sous la barre d'onglets est ramené en vue. `scroll-padding` (CSS) donne
    // la place, mais focus() ne défile pas un champ déjà à l'écran, et
    // Firefox fait défiler vers le champ en douceur APRÈS focusin, sans tenir
    // compte de la marge : on revérifie à la fin de ce défilement-là (fenêtre
    // d'une seconde, pour ne jamais contrer un défilement de l'utilisateur).
    dlg.addEventListener('focusin', (e) => {
        const el = e.target as HTMLElement;
        if (!dlg.classList.contains('fiche-inline') || el.closest('.fiche-foot, .fiche-head')) return;
        const keepVisible = (): void => {
            if (document.activeElement !== el) return;
            const foot = dlg.querySelector('.fiche-foot')?.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            if ((foot && r.bottom > foot.top) || r.top < 80) el.scrollIntoView?.({ block: 'nearest' });
        };
        keepVisible();
        document.addEventListener('scrollend', keepVisible, { capture: true, once: true });
        setTimeout(() => { document.removeEventListener('scrollend', keepVisible, true); }, 1000);
    });
    // Geste retour (Android) ou bouton précédent : ferme la fiche, pas la page.
    if (popstateBound) return;
    popstateBound = true;
    // Pied collant et défilement au clavier (CSS, `--dock-h`) calés sur la
    // hauteur réelle du dock : replié, ou déplié sur une ou deux rangées.
    // Mesure immédiate : le premier rappel de l'observateur arrive après la
    // première ouverture, trop tard pour y placer le focus.
    const dock = document.getElementById('dockMenu');
    if (dock) {
        const measure = (): void => { document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`); };
        measure();
        if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(dock);
    }
    window.visualViewport?.addEventListener('resize', fitViewport);
    window.visualViewport?.addEventListener('scroll', fitViewport);
    window.addEventListener('popstate', () => {
        if (!historyPushed) return;
        historyPushed = false;
        history.scrollRestoration = 'auto';
        const open = dialogEl();
        if (open?.open) open.close();
    });
}

// --- API --------------------------------------------------------------------

/** Ouvre la fiche : création si `id` est absent, modification sinon. */
export async function openFiche(side: FicheSide, id: string | null = null): Promise<void> {
    const dlg = dialogEl();
    if (!dlg) return;
    if (saving) {
        toast('Enregistrement en cours, un instant', { kind: 'info' });
        return;
    }
    bind(dlg);
    let item: Record<string, unknown> = {};
    let base: string | null = null;
    if (id) {
        const found = Storage.loadCollection(collectionKey(side)).find((i) => i.id === id);
        if (!found) {
            toast('Fiche introuvable', { kind: 'error' });
            return;
        }
        base = baseOf(found);
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
    const pendingDraft = !!readDrafts()[slotOf(side, id)];
    state = { side, id, base, item, photo: null, statusTouched: false, dirty: false, pendingDraft, photoPending: null };
    render();
    // Bureau et tablette : dans l'onglet du camp, à droite de la liste (la
    // grille la place ; AVANT la liste dans le document, pour que la
    // tabulation suive l'ordre affiché en panneau étroit, fiche au-dessus).
    // Déjà ouverte pour l'autre camp : elle y passe (saisie en brouillon).
    const layout = document.getElementById(side === 'adv' ? 'adversary-table-body' : 'hostage-table-body')?.parentElement;
    const inline = dlg.open ? dlg.classList.contains('fiche-inline') : !isPhone();
    if (inline && layout && dlg.parentElement !== layout) layout.prepend(dlg);
    if (!inline && dlg.parentElement !== document.body) document.body.append(dlg);
    if (!dlg.open) {
        dlg.classList.toggle('fiche-inline', inline);
        if (inline) dlg.show();
        else dlg.showModal();
        fitViewport();
        try {
            // Retour à la fermeture : la carte est ramenée en vue par nous, pas
            // par la restauration du navigateur (voir l'écouteur « close »).
            history.scrollRestoration = 'manual';
            history.pushState({ pctacFiche: true }, '');
            historyPushed = true;
        } catch {
            // Historique indisponible (bac à sable) : la fiche reste fermable.
        }
    }
    // Après `show()` : un dialogue fermé ne prend ni focus ni défilement.
    // Création : on tape tout de suite ; modification : focus sur « Fermer ».
    if (inline) reveal(dlg, id ? '.fiche-close' : FIRST_FIELD);
}

export function close(): void {
    const dlg = dialogEl();
    if (dlg?.open) dlg.close();
}
