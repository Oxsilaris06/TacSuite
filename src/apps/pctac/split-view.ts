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

/**
 * Écouteurs posés sur `document`/`window`. Gardés pour être RETIRÉS avant
 * réinstallation : `initSplitView()` est rappelable (rendu initial, gabarit
 * remonté), et sans ce retrait les écouteurs s'empileraient — un seul Échap
 * fermerait puis rouvrirait l'écran selon la parité du nombre d'écouteurs.
 */
let onData: (() => void) | null = null;
let onResize: (() => void) | null = null;
let onKeydown: ((e: KeyboardEvent) => void) | null = null;
let onFullscreenChange: (() => void) | null = null;

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
    notifyResize();
}

/** Prévient la carte que sa boîte a changé. `planmap/` n'écoute aucun
 *  `resize` : c'est l'événement émis ici que MapLibre (option `trackResize`)
 *  rattrape pour se redimensionner. Appelé sur changement de ratio et au
 *  montage, jamais pendant le glissement — même raison que le `refresh()`
 *  différé : redimensionner la carte à chaque image ferait ramer le geste. */
function notifyResize(): void {
    window.dispatchEvent(new Event('resize'));
}

function updateDockButton(): void {
    const btn = document.getElementById('splitViewDockBtn');
    if (!btn) return;
    btn.classList.toggle('is-active', state.on);
    btn.setAttribute('aria-pressed', String(state.on));
}

/**
 * Demande le plein écran à l'activation par le dock (geste utilisateur). Un
 * refus (iOS, politique du navigateur) est SANS EFFET sur l'écran scindé, qui
 * doit tenir dans la fenêtre de toute façon : l'API renvoie une promesse, et
 * un navigateur qui n'expose pas la méthode est simplement ignoré.
 */
function enterFullscreen(): void {
    const el = document.documentElement;
    if (typeof el.requestFullscreen !== 'function') return;
    try {
        el.requestFullscreen().catch(() => { /* refus : la scission tient sans */ });
    } catch {
        /* idem, navigateur refusant hors promesse */
    }
}

/** Quitte le plein écran seulement si quelqu'un l'a posé : `exitFullscreen`
 *  sur un document déjà en fenêtre rejette et ferait du bruit. */
function exitFullscreen(): void {
    if (!document.fullscreenElement) return;
    if (typeof document.exitFullscreen !== 'function') return;
    try {
        document.exitFullscreen().catch(() => { /* best-effort */ });
    } catch {
        /* best-effort */
    }
}

export function toggleSplit(): void {
    if (!state.on && window.innerWidth < MIN_WIDTH) {
        toast('Écran trop étroit pour deux panneaux : passez en paysage ou sur un écran plus large.', { kind: 'error' });
        return;
    }
    state.on = !state.on;
    if (state.on) enterFullscreen();
    else exitFullscreen();
    writeState(state);
    updateDockButton();
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
        notifyResize();
    };
    divider.addEventListener('pointerup', release);
    divider.addEventListener('pointercancel', release);

    divider.addEventListener('dblclick', () => {
        state.ratio = 50;
        applyRatio();
        writeState(state);
        window.PlanMap?.refresh();
        notifyResize();
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
        notifyResize();
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
        updateDockButton();
        // Affectation, pas addEventListener : un second appel réinstalle au
        // lieu d'empiler un écouteur de plus.
        btn.onclick = () => toggleSplit();
    }

    // Réinstallation propre des écouteurs globaux (cf. commentaire des `on*`).
    if (onData) document.removeEventListener('pctac:data', onData);
    onData = () => refreshBoth();
    document.addEventListener('pctac:data', onData);

    if (onResize) window.removeEventListener('resize', onResize);
    onResize = () => {
        // L'écran rétrécit sous le seuil (rotation, fenêtre réduite) : on sort
        // plutôt que de laisser deux colonnes illisibles.
        if (state.on && window.innerWidth < MIN_WIDTH) toggleSplit();
    };
    window.addEventListener('resize', onResize);

    // Échap ferme l'écran scindé. Un `<dialog>` modal ouvert capte Échap en
    // premier (fermeture du dialogue) : on ne lui vole pas la touche. La fiche
    // ouverte dans la page (`fiche-inline`) traite Échap elle-même, depuis ses
    // champs ; ailleurs, la touche revient à l'écran scindé.
    if (onKeydown) document.removeEventListener('keydown', onKeydown);
    onKeydown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !state.on) return;
        if (document.querySelector('dialog[open]:not(.fiche-inline)')) return;
        toggleSplit();
    };
    document.addEventListener('keydown', onKeydown);

    // Quitter le plein écran par le navigateur (Échap système, bouton de la
    // barre) laisserait un état à moitié plein écran, qui se lit comme un
    // bogue : on ferme l'écran scindé avec.
    if (onFullscreenChange) document.removeEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange = () => {
        if (state.on && !document.fullscreenElement) toggleSplit();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    if (state.on) applySplit();
}
