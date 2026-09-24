/**
 * mode-ui.ts — Couche DOM des situations opérationnelles (`modes.ts`).
 *
 * Deux responsabilités, volontairement séparées du vocabulaire lui-même pour
 * que `modes.ts` reste un fichier de DONNÉES que Nico peut corriger sans lire
 * une ligne de manipulation du DOM :
 *
 *   1. `applyLexicon()` — réécrit les libellés de la page depuis la situation
 *      courante. Tout élément portant `data-lex="adv.singular"` reçoit le mot
 *      correspondant ; `data-lex-title`, `data-lex-aria` et
 *      `data-lex-placeholder` font de même sur l'attribut nommé. Le texte
 *      d'origine reste dans le HTML : il sert de repli si un jeton est inconnu,
 *      et la page reste lisible avant l'exécution du script.
 *   2. `initModeSelector()` — construit le sélecteur de situation en haut à
 *      droite, à partir de `PCTAC_MODES` (jamais d'énumération en dur dans le
 *      HTML : ajouter une situation ne doit toucher qu'un fichier).
 *
 * Le sélecteur est un `radiogroup` et non une rangée de boutons : quatre
 * options exclusives dont une est toujours active, c'est exactement la
 * sémantique d'un groupe de boutons radio, et les lecteurs d'écran annoncent
 * alors « 2 sur 4 » au lieu d'une suite de boutons sans lien.
 */

import {
    PCTAC_MODES,
    PCTAC_MODE_ORDER,
    currentMode,
    currentModeId,
    persistModeId,
    type PctacMode,
    type PctacModeId,
} from '@pctac/modes.js';

/** Jetons résolvables par `data-lex`. Toute autre valeur laisse le DOM intact. */
function resolveToken(token: string, mode: PctacMode): string | null {
    const [group, prop] = token.split('.');
    if (group === 'mode') {
        if (prop === 'label') return mode.label;
        if (prop === 'short') return mode.short;
        if (prop === 'summary') return mode.summary;
        return null;
    }
    if (group === 'chip') {
        // Libellé de pastille Pax propre à la situation (« Inter » → « Recherches »
        // en Recherche de personnes). Une clé absente garde le libellé du HTML.
        if (!prop) return null;
        return mode.paxChipLabels[prop] ?? null;
    }
    if (group !== 'adv' && group !== 'host') return null;
    const lexicon = mode[group];
    switch (prop) {
        case 'singular': return lexicon.singular;
        case 'plural': return lexicon.plural;
        case 'demonstrative': return lexicon.demonstrative;
        case 'icon': return lexicon.icon;
        case 'paxChip': return lexicon.paxChip;
        case 'newLabel': return lexicon.newLabel;
        case 'saveLabel': return lexicon.saveLabel;
        case 'emptyLabel': return lexicon.emptyLabel;
        case 'linkLabel': return lexicon.linkLabel;
        default: return null;
    }
}

/**
 * Applique le vocabulaire de la situation courante à `root` (la page entière
 * par défaut, ou un fragment fraîchement rendu). Idempotent : réappliquer sur
 * un DOM déjà traité redonne exactement le même résultat, ce qui permet de
 * l'appeler après chaque rendu sans tenir de registre.
 *
 * Les gabarits acceptent `{lex}` pour insérer le mot dans une phrase :
 * `data-lex-title="Modifier {adv.demonstrative}"` rend « Modifier cet ennemi ».
 * Sans accolades, la valeur entière est un jeton.
 */
export function applyLexicon(root: ParentNode = document): void {
    const mode = currentMode();
    const fill = (raw: string): string | null => {
        if (raw.includes('{')) {
            let missing = false;
            const out = raw.replace(/\{([a-zA-Z.]+)\}/g, (_m, token: string) => {
                const value = resolveToken(token, mode);
                if (value === null) { missing = true; return _m; }
                return value;
            });
            return missing ? null : out;
        }
        return resolveToken(raw, mode);
    };

    root.querySelectorAll<HTMLElement>('[data-lex]').forEach((el) => {
        const value = fill(el.dataset.lex ?? '');
        if (value !== null) el.textContent = value;
    });
    const attrMap: [string, string][] = [
        ['lexTitle', 'title'],
        ['lexAria', 'aria-label'],
        ['lexPlaceholder', 'placeholder'],
    ];
    attrMap.forEach(([dataKey, attr]) => {
        root.querySelectorAll<HTMLElement>(`[data-${dataKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`).forEach((el) => {
            const value = fill(el.dataset[dataKey] ?? '');
            if (value !== null) el.setAttribute(attr, value);
        });
    });
    // Icônes Material Symbols pilotées par la situation (onglets, titres).
    root.querySelectorAll<HTMLElement>('[data-lex-icon]').forEach((el) => {
        const value = fill(el.dataset.lexIcon ?? '');
        if (value !== null) el.textContent = value;
    });
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// --- Sélecteur de situation ------------------------------------------------

/** Rappelé après chaque changement de situation (re-rendu des vues). */
type ModeChangeHandler = (mode: PctacMode) => void;

const listeners: ModeChangeHandler[] = [];

export function onModeChange(handler: ModeChangeHandler): void {
    listeners.push(handler);
}

function notify(): void {
    const mode = currentMode();
    listeners.forEach((fn) => {
        try { fn(mode); } catch (e) { console.error('[PC TAC] écouteur de situation en échec:', e); }
    });
}

/**
 * Déplace la pastille active sous le segment sélectionné. Les quatre segments
 * ont la MÊME largeur (`grid-template-columns: repeat(4, 1fr)`) : seul un
 * `translateX` est nécessaire, jamais une animation de largeur — c'est la
 * seule forme qui tienne 60 images par seconde sans repeindre la mise en page.
 */
function positionIndicator(group: HTMLElement, index: number): void {
    const indicator = group.querySelector<HTMLElement>('.mode-selector-indicator');
    if (indicator) indicator.style.transform = `translateX(${index * 100}%)`;
}

export function setMode(id: PctacModeId, group?: HTMLElement | null): void {
    if (currentModeId() === id) return;
    persistModeId(id);
    const root = group ?? document.getElementById('modeSelector');
    if (root) {
        const index = PCTAC_MODE_ORDER.indexOf(id);
        root.querySelectorAll<HTMLElement>('[role="radio"]').forEach((btn) => {
            const selected = btn.dataset.modeId === id;
            btn.setAttribute('aria-checked', String(selected));
            btn.tabIndex = selected ? 0 : -1;
            btn.classList.toggle('is-active', selected);
        });
        positionIndicator(root, index);
    }
    applyLexicon();
    notify();
    // Bascule = RECHARGEMENT. Chaque situation est un espace de travail
    // indépendant : listes, compteurs, plan (MapLibre), écran scindé et états
    // internes des modules portent encore les données de la situation quittée.
    // Un rendu complet à la main devrait tous les couvrir, un par un, et le
    // premier oubli laisserait un résidu. Le rechargement repart d'un document
    // neuf, donc sans résidu possible.
    // Le rechargement attend que la pastille se pose (sa transition dure
    // 250 ms) : le choix se voit arriver. Page inerte pendant l'attente, rien
    // ne s'écrit dans la situation d'arrivée depuis un écran encore ancien.
    const reload = (): void => {
        try {
            location.reload();
        } catch {
            // Environnement sans navigation (tests unitaires) : le rendu ci-dessus
            // a déjà appliqué le vocabulaire, l'échec est sans conséquence.
        }
    };
    const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || !root?.querySelector('.mode-selector-indicator')) {
        reload();
        return;
    }
    document.body.inert = true;
    setTimeout(reload, 250);
}

/**
 * Insère (ou retire) la cinquième pastille Pax de la situation courante dans
 * `#pax_select_container`, AVANT `#openCreatePaxBtn`. Hors de sa situation, la
 * pastille est ABSENTE du DOM (jamais `display:none`) : la navigation aux
 * flèches du `radiogroup` ne tombe pas sur un fantôme.
 *
 * Les écouteurs sont posés par `UI.initPaxModeAndColors()`, appelé APRÈS
 * cette fonction au démarrage ; le bouton porte les mêmes classes et
 * `data-pax` que les pastilles statiques.
 */
export function syncSituationPaxChip(): void {
    const container = document.getElementById('pax_select_container');
    if (!container) return;
    container.querySelectorAll<HTMLElement>('.pax-select-option.situation').forEach((el) => el.remove());
    const extra = currentMode().extraPaxChip;
    if (!extra) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.className = 'pax-select-option situation';
    btn.dataset.pax = extra.key;
    btn.textContent = extra.label;
    // Couleur en variables seulement : `.situation.selected` la consomme. Un
    // `style.background` inline peindrait la pastille en permanence.
    btn.style.setProperty('--pax-chip-bg', extra.color);
    btn.style.setProperty('--pax-chip-fg', extra.fontColor);
    const addBtn = document.getElementById('openCreatePaxBtn');
    if (addBtn) container.insertBefore(btn, addBtn);
    else container.appendChild(btn);
}

/** Seuil tranché : sous 520 px (là où les libellés disparaissaient), le
 *  sélecteur devient un menu déroulant natif. */
const MOBILE_SELECTOR_MQ = '(max-width: 520px)';

/** Rangée de boutons radio (bureau). Les quatre segments ont la même largeur,
 *  la pastille active se déplace d'un simple `translateX`. */
function buildRadioSelector(group: HTMLElement, active: PctacModeId): void {
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Situation opérationnelle');
    group.innerHTML = `<span class="mode-selector-indicator" aria-hidden="true"></span>`
        + PCTAC_MODE_ORDER.map((id) => {
            const mode = PCTAC_MODES[id];
            const selected = id === active;
            return `<button type="button" role="radio" class="mode-selector-option${selected ? ' is-active' : ''}"
                data-mode-id="${id}" aria-checked="${selected}" tabindex="${selected ? 0 : -1}"
                title="${escapeAttr(`${mode.label} — ${mode.summary}`)}">
                <span class="material-symbols-outlined" aria-hidden="true">${mode.icon}</span>
                <span class="mode-selector-label">${escapeAttr(mode.short)}</span>
            </button>`;
        }).join('');
    positionIndicator(group, PCTAC_MODE_ORDER.indexOf(active));
}

/**
 * Menu déroulant natif (mobile). Un `<option>` n'accepte pas d'icône — les
 * navigateurs l'ignorent — donc l'icône de la situation ACTIVE vit dans un
 * `<span>` à gauche du `<select>`, rafraîchie au changement. Le `change`
 * n'appelle que `setMode()` : un seul chemin de vérité, pas de seconde
 * logique de sélection.
 */
function buildSelectSelector(group: HTMLElement, active: PctacModeId): void {
    group.removeAttribute('role');
    group.setAttribute('aria-label', 'Situation opérationnelle');
    // L'icône est IMBRIQUÉE dans le cercle, pas portée par lui : la feuille de
    // la police d'icônes (chargée après) remet `display: inline-block` sur
    // `.material-symbols-outlined`, ce qui annulait le centrage en flex.
    group.innerHTML = `<span class="mode-selector-current" aria-hidden="true"><span class="material-symbols-outlined">${PCTAC_MODES[active].icon}</span></span>`
        + `<select class="mode-selector-select" aria-label="Situation opérationnelle">`
        + PCTAC_MODE_ORDER.map((id) => `<option value="${id}"${id === active ? ' selected' : ''}>${escapeAttr(PCTAC_MODES[id].label)}</option>`).join('')
        + `</select>`;
    const select = group.querySelector<HTMLSelectElement>('select');
    const icon = group.querySelector<HTMLElement>('.mode-selector-current .material-symbols-outlined');
    select?.addEventListener('change', () => {
        const id = select.value as PctacModeId;
        if (icon) icon.textContent = PCTAC_MODES[id].icon;
        setMode(id);
    });
}

/**
 * Construit le sélecteur dans `#modeSelector`. Sans cet élément (autre page,
 * gabarit réduit), la fonction ne fait rien : les situations restent pilotables
 * par `setMode()` et le vocabulaire s'applique quand même.
 *
 * Un seul des deux rendus est présent dans le DOM à la fois, et la bascule se
 * fait sur `matchMedia` : tourner le téléphone remplace le contenu au lieu
 * d'empiler deux sélecteurs.
 */
export function initModeSelector(): void {
    const group = document.getElementById('modeSelector');
    if (!group) return;

    const media = typeof window.matchMedia === 'function'
        ? window.matchMedia(MOBILE_SELECTOR_MQ)
        : null;
    const render = (): void => {
        if (media?.matches) buildSelectSelector(group, currentModeId());
        else buildRadioSelector(group, currentModeId());
    };
    render();

    // `matchMedia` absent (gabarit réduit) : on garde les boutons radio, état
    // sûr au clavier et au lecteur d'écran.
    if (media) {
        const onMediaChange = (): void => render();
        if (typeof media.addEventListener === 'function') media.addEventListener('change', onMediaChange);
        else media.addListener?.(onMediaChange); // Safari ancien
    }

    group.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-mode-id]');
        const id = btn?.dataset.modeId;
        if (id) setMode(id as PctacModeId, group);
    });

    // Navigation au clavier attendue d'un radiogroup : flèches pour changer,
    // sans avoir à tabuler à travers les quatre options. En menu déroulant,
    // le `<select>` gère lui-même les flèches : on ne les lui vole pas.
    group.addEventListener('keydown', (e) => {
        if (group.querySelector('.mode-selector-select')) return;
        const key = (e as KeyboardEvent).key;
        const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1
            : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
        if (delta === 0) return;
        e.preventDefault();
        const order = PCTAC_MODE_ORDER;
        const next = order[(order.indexOf(currentModeId()) + delta + order.length) % order.length];
        if (!next) return;
        setMode(next, group);
        group.querySelector<HTMLElement>(`[data-mode-id="${next}"]`)?.focus();
    });

    applyLexicon();
    syncSituationPaxChip();
}
