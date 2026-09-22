/**
 * split-view.ts — Écran scindé : deux onglets de PC-Tac côte à côte.
 *
 * Le besoin vient du poste de commandement : on tient la main courante ET on
 * suit le plan, et basculer d'un onglet à l'autre à chaque message fait perdre
 * le fil. N'importe quelle paire d'onglets est affichable, pas seulement
 * « main courante + plan » — le même écran sert à recouper les fiches
 * adverses avec les photos, ou le plan avec les liens.
 *
 * AUCUNE VUE N'EST DUPLIQUÉE. Les sept vues sont des éléments uniques du
 * document ; l'écran scindé les DÉPLACE dans deux panneaux, et les remet à
 * leur place en sortant. Tout ce qui les vise par identifiant (les fonctions
 * de rendu, le plan, le tutoriel) continue donc de fonctionner sans rien
 * savoir de l'écran scindé. Cloner aurait été plus simple à écrire et aurait
 * cassé tout le reste : deux éléments portant le même identifiant, des
 * écouteurs posés sur le mauvais, une carte MapLibre orpheline.
 *
 * MISE À JOUR PERMANENTE. Le rendu de PC-Tac est déclenché par l'action de
 * l'utilisateur, donc dans la vue où il travaille. En écran scindé, l'autre
 * panneau se périmerait. On écoute donc `pctac:data` (émis par `Storage` à
 * chaque écriture, cf. `storage.ts`) et on repeint les deux panneaux. Le coût
 * est celui d'un rendu déjà existant, déclenché seulement quand des données
 * changent vraiment — pas de minuterie qui tourne dans le vide.
 *
 * La séparation se déplace au doigt ou à la souris, en suivi 1:1, et la
 * proportion est retenue. Un double-clic la remet au milieu.
 */

import { Storage } from '@pctac/storage.js';
import { UI } from '@pctac/ui.js';
import { toast } from '@shared/feedback.js';

const SPLIT_KEY = 'pcTacSplit';
/** Sous cette largeur, deux panneaux côte à côte ne servent plus personne. */
const MIN_WIDTH = 900;
/** Bornes de la séparation, en pourcentage de largeur du panneau gauche. */
const MIN_RATIO = 25;
const MAX_RATIO = 75;

interface SplitState {
    on: boolean;
    left: string;
    right: string;
    ratio: number;
}

const DEFAULT_STATE: SplitState = {
    on: false,
    left: 'view-main-courante',
    right: 'view-plan',
    ratio: 50,
};

/** Vues proposées, dans l'ordre de la barre d'onglets. Libellés lus au DOM. */
function availableViews(): { id: string; label: string }[] {
    return [...document.querySelectorAll<HTMLElement>('.main-tab-bar .tab-btn')]
        .map((btn) => ({
            id: btn.dataset.view ?? '',
            label: (btn.querySelector('span:last-child')?.textContent ?? '').trim(),
        }))
        .filter((v) => v.id !== '');
}

function readState(): SplitState {
    try {
        const raw = localStorage.getItem(SPLIT_KEY);
        if (!raw) return { ...DEFAULT_STATE };
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_STATE };
        const p = parsed as Partial<SplitState>;
        return {
            on: p.on === true,
            left: typeof p.left === 'string' ? p.left : DEFAULT_STATE.left,
            right: typeof p.right === 'string' ? p.right : DEFAULT_STATE.right,
            ratio: typeof p.ratio === 'number' && Number.isFinite(p.ratio)
                ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, p.ratio))
                : DEFAULT_STATE.ratio,
        };
    } catch {
        return { ...DEFAULT_STATE };
    }
}

function writeState(state: SplitState): void {
    try { localStorage.setItem(SPLIT_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

let state: SplitState = { ...DEFAULT_STATE };
/** Parent d'origine des vues, pour les remettre exactement d'où elles viennent. */
let viewsHome: HTMLElement | null = null;

function panes(): { root: HTMLElement | null; left: HTMLElement | null; right: HTMLElement | null } {
    return {
        root: document.getElementById('splitView'),
        left: document.getElementById('splitPaneLeft'),
        right: document.getElementById('splitPaneRight'),
    };
}

/** Repeint une vue. Même aiguillage que `UI.switchMainView`, sans la bascule. */
function refreshView(viewId: string): void {
    switch (viewId) {
        case 'view-main-courante': UI.renderLogTable(Storage.loadLogData()); break;
        case 'view-adversaires': void UI.renderAdversaries(); break;
        case 'view-otages': void UI.renderHostages(); break;
        case 'view-amis': UI.renderFriends(); break;
        case 'view-photos': UI.renderPhotos(localStorage.getItem('lastPhotoFilter') || 'all'); break;
        case 'view-plan': window.PlanMap?.refresh(); break;
        default: break;
    }
}

function refreshBoth(): void {
    if (!state.on) return;
    refreshView(state.left);
    if (state.right !== state.left) refreshView(state.right);
}

/** Construit le sélecteur d'un panneau. Rendu à chaque entrée en écran scindé
 * pour que les libellés suivent la situation opérationnelle courante. */
function buildPaneHeader(side: 'left' | 'right'): HTMLElement {
    const header = document.createElement('div');
    header.className = 'split-pane-header';

    const select = document.createElement('select');
    select.className = 'split-pane-select';
    select.setAttribute('aria-label', side === 'left' ? 'Contenu du panneau gauche' : 'Contenu du panneau droit');
    availableViews().forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.label;
        opt.selected = v.id === (side === 'left' ? state.left : state.right);
        select.appendChild(opt);
    });
    select.addEventListener('change', () => setPaneView(side, select.value));

    header.appendChild(select);
    return header;
}

/** Déplace `viewId` dans le panneau, en rendant à son emplacement d'origine la
 * vue qui s'y trouvait. Rien n'est cloné : la vue reste un élément unique. */
function mountView(pane: HTMLElement, viewId: string): void {
    const view = document.getElementById(viewId);
    if (!view) return;
    // Une vue déjà affichée dans l'AUTRE panneau serait volée : on refuse.
    view.classList.add('active');
    pane.appendChild(view);
}

function unmountViews(): void {
    if (!viewsHome) return;
    document.querySelectorAll<HTMLElement>('.tab-content-view').forEach((view) => {
        if (view.parentElement !== viewsHome) viewsHome?.appendChild(view);
    });
}

export function setPaneView(side: 'left' | 'right', viewId: string): void {
    const other = side === 'left' ? state.right : state.left;
    if (viewId === other) {
        // Deux panneaux sur la même vue est impossible sans la dupliquer : on
        // échange plutôt que de refuser en silence.
        if (side === 'left') state.right = state.left;
        else state.left = state.right;
    }
    if (side === 'left') state.left = viewId;
    else state.right = viewId;
    writeState(state);
    applySplit();
}

/** Pose la proportion en variable CSS. Une seule propriété animable touchée. */
function applyRatio(): void {
    const { root } = panes();
    if (root) root.style.setProperty('--split-ratio', `${state.ratio}%`);
}

function applySplit(): void {
    const { root, left, right } = panes();
    if (!root || !left || !right) return;

    if (!state.on) {
        unmountViews();
        root.hidden = true;
        document.body.classList.remove('is-split');
        // Retour à l'onglet unique courant, avec son rendu habituel.
        UI.switchMainView(localStorage.getItem('lastView') || 'view-main-courante');
        return;
    }

    document.body.classList.add('is-split');
    root.hidden = false;
    // ORDRE CRITIQUE : les vues regagnent leur place AVANT que les panneaux
    // soient vidés. `replaceChildren` sur un panneau détacherait du document la
    // vue qu'il contient, et `unmountViews` ne la retrouverait plus — elle
    // serait perdue jusqu'au rechargement de la page.
    unmountViews();
    document.querySelectorAll<HTMLElement>('.tab-content-view').forEach((v) => v.classList.remove('active'));
    left.replaceChildren(buildPaneHeader('left'));
    right.replaceChildren(buildPaneHeader('right'));
    mountView(left, state.left);
    mountView(right, state.right);
    applyRatio();
    refreshBoth();
    // MapLibre ne connaît pas sa nouvelle largeur tant qu'on ne le lui dit pas.
    window.PlanMap?.refresh();
}

export function toggleSplit(): void {
    if (!state.on && window.innerWidth < MIN_WIDTH) {
        toast('Écran trop étroit pour deux panneaux : passez en paysage ou sur un écran plus large.', { kind: 'error' });
        return;
    }
    state.on = !state.on;
    writeState(state);
    const btn = document.getElementById('splitViewDockBtn');
    if (btn) {
        btn.classList.toggle('is-active', state.on);
        btn.setAttribute('aria-pressed', String(state.on));
    }
    applySplit();
}

/**
 * Séparation déplaçable, en suivi 1:1 du pointeur. `setPointerCapture` garde
 * le suivi même quand le pointeur sort du séparateur — sans lui, un geste
 * rapide décroche dès qu'il dépasse ses quelques pixels de large.
 */
function wireDivider(divider: HTMLElement, root: HTMLElement): void {
    const clamp = (v: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, v));

    divider.addEventListener('pointerdown', (e) => {
        divider.setPointerCapture(e.pointerId);
        divider.classList.add('is-dragging');
    });
    divider.addEventListener('pointermove', (e) => {
        if (!divider.hasPointerCapture(e.pointerId)) return;
        const rect = root.getBoundingClientRect();
        if (rect.width === 0) return;
        state.ratio = clamp(((e.clientX - rect.left) / rect.width) * 100);
        applyRatio();
    });
    const release = (e: PointerEvent): void => {
        if (!divider.hasPointerCapture(e.pointerId)) return;
        divider.releasePointerCapture(e.pointerId);
        divider.classList.remove('is-dragging');
        writeState(state);
        // La carte n'apprend sa nouvelle largeur qu'une fois le geste fini :
        // la redimensionner à chaque image ferait ramer le glissement.
        window.PlanMap?.refresh();
    };
    divider.addEventListener('pointerup', release);
    divider.addEventListener('pointercancel', release);

    divider.addEventListener('dblclick', () => {
        state.ratio = 50;
        applyRatio();
        writeState(state);
        window.PlanMap?.refresh();
    });

    // Un séparateur doit être déplaçable au clavier, sinon il n'existe pas
    // pour qui n'a pas de souris.
    divider.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0;
        if (step === 0) return;
        e.preventDefault();
        state.ratio = clamp(state.ratio + step);
        applyRatio();
        writeState(state);
        window.PlanMap?.refresh();
    });
}

/**
 * Branche l'écran scindé. Sans `#splitView` dans le document (gabarit réduit,
 * tests), la fonction ne fait rien et PC-Tac reste en onglet unique.
 */
export function initSplitView(): void {
    const { root } = panes();
    if (!root) return;

    // Emplacement d'origine des vues : leur parent commun actuel.
    viewsHome = document.querySelector<HTMLElement>('.tab-content-view')?.parentElement ?? null;

    state = readState();
    // Une largeur insuffisante au démarrage annule un écran scindé mémorisé :
    // mieux vaut un onglet lisible qu'une colonne de 200 px.
    if (state.on && window.innerWidth < MIN_WIDTH) state.on = false;

    const divider = document.getElementById('splitDivider');
    if (divider) wireDivider(divider, root);

    const btn = document.getElementById('splitViewDockBtn');
    if (btn) {
        btn.setAttribute('aria-pressed', String(state.on));
        btn.classList.toggle('is-active', state.on);
        btn.addEventListener('click', () => toggleSplit());
    }

    // Mise à jour permanente des deux panneaux (cf. en-tête de fichier).
    document.addEventListener('pctac:data', () => refreshBoth());

    // L'écran rétrécit sous le seuil (rotation, fenêtre réduite) : on sort
    // plutôt que de laisser deux colonnes illisibles.
    window.addEventListener('resize', () => {
        if (state.on && window.innerWidth < MIN_WIDTH) toggleSplit();
    });

    if (state.on) applySplit();
}
