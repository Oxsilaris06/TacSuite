/**
 * sections-ui.ts — Contrôles des sections du formulaire OI : crayon (renommer)
 * et × (retirer / rétablir). La logique vit dans `sections.ts` (pure, partagée
 * avec le PDF) ; ce module ne fait que la montrer et l'écrire dans le `Store`.
 *
 * Balisage attendu : un élément `[data-oi-section="<id>"]` par section
 * (`oi/index.html`), dont le titre est le premier `h2`/`h3` enfant, ou le `h3`
 * de son `.collapsible-header`. Les icônes et le numéro d'étape du titre sont
 * gardés ; seul le libellé devient modifiable.
 *
 * Une section retirée se replie en UNE ligne « « … » retirée — Rétablir » : son
 * contenu reste dans le DOM et dans `formData` (rien n'est effacé), le PDF
 * l'ignore (`applySectionRemovals`).
 */
import { Store } from '@oi/init.js';
import {
    currentOiMode,
    customTitle,
    formSectionTitle,
    OI_SECTIONS,
    OI_SECTION_TITLE_MAX,
    readUnitTitles,
    sectionDef,
    sectionPrefs,
    withSectionPrefs,
    writeUnitTitles,
} from '@oi/sections.js';
import { toast } from '@shared/feedback.js';
import type { OiSectionPrefs } from '@shared/types/contracts.js';

function headingOf(el: HTMLElement): HTMLElement | null {
    return (
        el.querySelector<HTMLElement>(':scope > .collapsible-header h3') ??
        el.querySelector<HTMLElement>(':scope > h2, :scope > h3')
    );
}

function button(icon: string, label: string, cls: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `oi-section-tool ${cls}`;
    b.setAttribute('aria-label', label);
    b.title = label;
    const i = document.createElement('span');
    i.className = 'material-symbols-outlined';
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    b.appendChild(i);
    return b;
}

/** Empêche le clic d'atteindre la délégation des en-têtes repliables (`main.ts`, ouverture/fermeture). */
function isolate(el: HTMLElement): void {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => e.stopPropagation());
}

function updatePrefs(mutate: (prefs: OiSectionPrefs) => void): void {
    const fd = Store.state.formData;
    const prefs = sectionPrefs(fd);
    const next: OiSectionPrefs = { removed: [...prefs.removed], titles: { ...prefs.titles } };
    mutate(next);
    // Affectation d'une NOUVELLE valeur : le proxy du Store notifie et persiste.
    Store.state.formData.oi_sections = withSectionPrefs(fd, next);
}

/** Pose, une seule fois par section, le libellé, le crayon, la × et la ligne « Rétablir ». */
function decorate(el: HTMLElement): void {
    if (el.dataset.oiSectionReady === '1') return;
    const id = el.dataset.oiSection ?? '';
    const def = sectionDef(id);
    const heading = headingOf(el);
    if (!def || !heading) return;
    el.dataset.oiSectionReady = '1';

    // Titre : icônes gardées, numéro d'étape (« 3. ») gardé, libellé isolé.
    const icons = Array.from(heading.querySelectorAll<HTMLElement>('.material-symbols-outlined'));
    const iconText = icons.map((i) => i.textContent ?? '').join('');
    const text = (heading.textContent ?? '').replace(iconText, '').replace(/\s+/g, ' ').trim();
    const num = /^(\d+\.)\s*/.exec(text)?.[1];
    const label = document.createElement('span');
    label.className = 'oi-section-label';
    const tools = document.createElement('span');
    tools.className = 'oi-section-tools';
    isolate(tools);
    heading.replaceChildren(...icons, ...(num ? [document.createTextNode(`${num} `)] : []), label, tools);
    heading.classList.add('oi-section-heading');

    const rename = button('edit', `Renommer la section « ${def.label} »`, 'oi-section-rename');
    rename.addEventListener('click', () => startRename(el, heading, label));
    tools.appendChild(rename);

    if (def.removable) {
        const remove = button('close', `Retirer la section « ${def.label} »`, 'oi-section-remove');
        remove.addEventListener('click', () => {
            updatePrefs((p) => { if (!p.removed.includes(id)) p.removed.push(id); });
            renderSections();
            el.querySelector<HTMLElement>(':scope > .oi-section-restore button')?.focus();
        });
        tools.appendChild(remove);

        const restore = document.createElement('div');
        restore.className = 'oi-section-restore';
        const txt = document.createElement('span');
        txt.className = 'oi-section-restore-text';
        const back = button('undo', `Rétablir la section « ${def.label} »`, 'oi-section-restore-btn');
        back.append(' Rétablir');
        back.addEventListener('click', () => {
            updatePrefs((p) => { p.removed = p.removed.filter((r) => r !== id); });
            renderSections();
            el.querySelector<HTMLButtonElement>('.oi-section-remove')?.focus();
        });
        restore.append(txt, back);
        isolate(restore);
        el.prepend(restore);
    }
}

function startRename(el: HTMLElement, heading: HTMLElement, label: HTMLElement): void {
    const id = el.dataset.oiSection ?? '';
    const def = sectionDef(id);
    if (!def || heading.querySelector('.oi-section-editor')) return;

    const editor = document.createElement('span');
    editor.className = 'oi-section-editor';
    isolate(editor);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = OI_SECTION_TITLE_MAX;
    input.value = label.textContent ?? '';
    input.placeholder = def.label;
    input.setAttribute('aria-label', `Nouveau titre de la section « ${def.label} » (vide : titre d'origine)`);
    const ok = button('check', 'Valider le titre', 'oi-section-ok');
    const keep = button('bookmark_add', 'Valider et garder ce titre pour mes prochaines OI', 'oi-section-keep');
    editor.append(input, ok, keep);
    label.hidden = true;
    heading.querySelector<HTMLElement>('.oi-section-tools')?.setAttribute('hidden', '');
    label.after(editor);
    input.focus();
    input.select();

    const close = (): void => {
        editor.remove();
        label.hidden = false;
        heading.querySelector<HTMLElement>('.oi-section-tools')?.removeAttribute('hidden');
        heading.querySelector<HTMLButtonElement>('.oi-section-rename')?.focus();
    };
    const commit = (asUnitModel: boolean): void => {
        const value = input.value.trim().slice(0, OI_SECTION_TITLE_MAX);
        // Vide, ou identique au titre d'origine : on revient au titre d'origine.
        const custom = value && value !== def.label ? value : '';
        updatePrefs((p) => {
            if (custom) p.titles[id] = custom;
            else delete p.titles[id];
        });
        if (asUnitModel) {
            const mode = currentOiMode(Store.state.formData);
            const unit = readUnitTitles(mode);
            if (custom) unit[id] = custom;
            else delete unit[id];
            if (writeUnitTitles(mode, unit)) toast('Titre gardé pour vos prochaines OI.', { kind: 'success' });
            else toast("Titre enregistré pour cette OI seulement : le stockage local refuse l'écriture.", { kind: 'error' });
        }
        close();
        renderSections();
    };
    input.addEventListener('keydown', (e) => {
        // Entrée dans un champ du formulaire l'enverrait : on valide à la place.
        if (e.key === 'Enter') { e.preventDefault(); commit(false); }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    ok.addEventListener('click', () => commit(false));
    keep.addEventListener('click', () => commit(true));
}

/**
 * Pastilles d'étapes du haut (`.wizard-progress-step`) : suivent le titre
 * personnalisé de leur étape et signalent une étape retirée. Sans titre
 * personnalisé, la pastille garde son libellé court d'origine.
 */
function renderProgressChips(): void {
    const fd = Store.state.formData;
    const { removed } = sectionPrefs(fd);
    document.querySelectorAll<HTMLElement>('.wizard-progress-step[data-step]').forEach((li) => {
        const index = Number(li.dataset.step);
        const def = OI_SECTIONS.find((s) => s.step === index);
        if (!def) return;
        const textNode = Array.from(li.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
        if (!textNode) return;
        if (li.dataset.defaultLabel === undefined) li.dataset.defaultLabel = (textNode.textContent ?? '').trim();
        const custom = customTitle(fd, def.id);
        textNode.textContent = custom ? `${index + 1}. ${custom}` : li.dataset.defaultLabel;
        const isRemoved = removed.includes(def.id);
        li.classList.toggle('is-removed', isRemoved);
        if (isRemoved) li.setAttribute('title', 'Étape retirée de l’OI');
        else li.removeAttribute('title');
    });
}

/** Repeint libellés et états retiré/présent depuis `formData`. Sans effet hors de l'OI. */
export function renderSections(): void {
    renderProgressChips();
    const fd = Store.state.formData;
    const { removed } = sectionPrefs(fd);
    document.querySelectorAll<HTMLElement>('[data-oi-section]').forEach((el) => {
        decorate(el);
        const id = el.dataset.oiSection ?? '';
        const title = formSectionTitle(fd, id);
        const label = el.querySelector<HTMLElement>('.oi-section-label');
        if (label) label.textContent = title;
        const isRemoved = removed.includes(id);
        el.classList.toggle('oi-section-removed', isRemoved);
        const txt = el.querySelector<HTMLElement>(':scope > .oi-section-restore .oi-section-restore-text');
        if (txt) txt.textContent = `« ${title} » retirée de l'OI`;
    });
}

/** Branche les contrôles. À appeler APRÈS `loadFormData` (le `Store` porte alors l'OI chargée). */
export function initSectionControls(): void {
    renderSections();
}
