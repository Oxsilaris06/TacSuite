/**
 * pc-split-view.test.ts — Écran scindé.
 *
 * Ce qui est verrouillé ici :
 *   - les vues sont DÉPLACÉES, jamais clonées. Un clone créerait deux éléments
 *     portant le même identifiant : les fonctions de rendu, qui visent par
 *     identifiant, peindraient l'un et pas l'autre, et la carte MapLibre
 *     resterait attachée au mauvais.
 *   - sortir de l'écran scindé remet CHAQUE vue à son emplacement d'origine ;
 *     sans ça, l'application ne retrouve plus ses onglets.
 *   - deux panneaux ne peuvent pas afficher la même vue : on échange, plutôt
 *     que de laisser un panneau se vider en silence.
 *   - une écriture de données repeint les DEUX panneaux (`pctac:data`), sinon
 *     celui où l'on ne travaille pas se périme.
 *   - un écran trop étroit refuse la scission au lieu de produire deux
 *     colonnes illisibles.
 *   - Échap ferme l'écran scindé, sauf quand un dialogue l'attend en premier ;
 *     quitter le plein écran ferme aussi, et un refus de plein écran (iOS)
 *     laisse la scission intacte.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/feedback.js', () => ({
    toast: toastSpy,
    confirmDialog: vi.fn(async () => true),
    promptDialog: vi.fn(),
}));

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
}));

import { initSplitView, setPaneView, toggleSplit } from '@pctac/split-view.js';
import { Storage } from '@pctac/storage.js';
import { UI } from '@pctac/ui.js';

const VUES = ['view-main-courante', 'view-adversaires', 'view-otages', 'view-plan'];

function monterLeSquelette(): void {
    document.body.className = '';
    document.body.innerHTML = `
        <div class="container">
            <nav class="main-tab-bar">
                ${VUES.map((id) => `<button class="tab-btn" data-view="${id}"><span>i</span><span>${id}</span></button>`).join('')}
            </nav>
            <div id="splitView" class="split-view" hidden>
                <section id="splitPaneLeft"></section>
                <div id="splitDivider"></div>
                <section id="splitPaneRight"></section>
            </div>
            <div id="viewsHome">
                ${VUES.map((id) => `<div id="${id}" class="tab-content-view"></div>`).join('')}
            </div>
            <button id="splitViewDockBtn"></button>
            <table id="logTable"><tbody></tbody></table>
        </div>`;
    UI.initElements();
}

/** Largeur de fenêtre simulée : jsdom vaut 1024 par défaut. */
function poserLargeur(px: number): void {
    Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

beforeEach(() => {
    localStorage.clear();
    toastSpy.mockClear();
    poserLargeur(1440);
    monterLeSquelette();
    initSplitView();
});

describe('bascule', () => {
    it('déplace deux vues dans les panneaux sans les cloner', () => {
        toggleSplit();

        expect(document.querySelectorAll('#view-main-courante')).toHaveLength(1);
        expect(document.querySelectorAll('#view-plan')).toHaveLength(1);
        expect(document.getElementById('splitPaneLeft')?.querySelector('.tab-content-view')?.id)
            .toBe('view-main-courante');
        expect(document.getElementById('splitPaneRight')?.querySelector('.tab-content-view')?.id)
            .toBe('view-plan');
        expect(document.body.classList.contains('is-split')).toBe(true);
    });

    it('remet chaque vue à son emplacement d\'origine en sortant', () => {
        toggleSplit();
        toggleSplit();

        const home = document.getElementById('viewsHome');
        VUES.forEach((id) => {
            expect(document.getElementById(id)?.parentElement, id).toBe(home);
        });
        expect(document.body.classList.contains('is-split')).toBe(false);
        expect(document.getElementById('splitView')?.hidden).toBe(true);
    });

    it('refuse la scission sur un écran trop étroit, et le dit', () => {
        poserLargeur(600);
        toggleSplit();
        expect(document.body.classList.contains('is-split')).toBe(false);
        expect(toastSpy).toHaveBeenCalledOnce();
    });

    it('ne remonte pas un écran scindé mémorisé si la fenêtre est trop étroite', () => {
        localStorage.setItem('pcTacSplit', JSON.stringify({ on: true, left: 'view-plan', right: 'view-otages', ratio: 50 }));
        poserLargeur(600);
        monterLeSquelette();
        initSplitView();
        expect(document.body.classList.contains('is-split')).toBe(false);
    });

    it('survit au switchMainView de démarrage (les deux panneaux restent actifs)', () => {
        // Reproduction du démarrage : `initSplitView()` remonte l'écran
        // mémorisé, puis `main.ts` restaure la dernière vue d'onglet via
        // `UI.switchMainView(lastView)`. Ce second appel retirait `.active`
        // aux vues déplacées dans les panneaux, laissant un panneau vide
        // jusqu'au rechargement suivant.
        localStorage.setItem('pcTacSplit', JSON.stringify({ on: true, left: 'view-main-courante', right: 'view-plan', ratio: 50 }));
        localStorage.setItem('lastView', 'view-main-courante');
        monterLeSquelette();
        initSplitView();

        UI.switchMainView('view-main-courante');

        const gauche = document.getElementById('splitPaneLeft')?.querySelector('.tab-content-view');
        const droite = document.getElementById('splitPaneRight')?.querySelector('.tab-content-view');
        expect(gauche?.id).toBe('view-main-courante');
        expect(droite?.id).toBe('view-plan');
        expect(gauche?.classList.contains('active')).toBe(true);
        expect(droite?.classList.contains('active')).toBe(true);
    });
});

describe('choix des panneaux', () => {
    it('échange les deux vues quand on demande celle d\'en face', () => {
        toggleSplit();
        // Gauche = main courante, droite = plan. On demande le plan à gauche.
        setPaneView('left', 'view-plan');
        expect(document.getElementById('splitPaneLeft')?.querySelector('.tab-content-view')?.id).toBe('view-plan');
        expect(document.getElementById('splitPaneRight')?.querySelector('.tab-content-view')?.id)
            .toBe('view-main-courante');
    });

    it('n\'affiche jamais la même vue des deux côtés', () => {
        toggleSplit();
        setPaneView('right', 'view-main-courante');
        const gauche = document.getElementById('splitPaneLeft')?.querySelector('.tab-content-view')?.id;
        const droite = document.getElementById('splitPaneRight')?.querySelector('.tab-content-view')?.id;
        expect(gauche).not.toBe(droite);
    });

    it('retient la composition et la proportion', () => {
        toggleSplit();
        setPaneView('left', 'view-adversaires');
        const stored = JSON.parse(localStorage.getItem('pcTacSplit') as string) as Record<string, unknown>;
        expect(stored.on).toBe(true);
        expect(stored.left).toBe('view-adversaires');
        expect(stored.ratio).toBe(50);
    });

    it('borne une proportion mémorisée aberrante', () => {
        localStorage.setItem('pcTacSplit', JSON.stringify({ on: true, left: 'view-plan', right: 'view-otages', ratio: 5000 }));
        monterLeSquelette();
        initSplitView();
        expect(document.getElementById('splitView')?.style.getPropertyValue('--split-ratio')).toBe('75%');
    });
});

describe('sortie et plein écran', () => {
    it('ferme l\'écran scindé sur Échap', () => {
        toggleSplit();
        expect(document.body.classList.contains('is-split')).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(document.body.classList.contains('is-split')).toBe(false);
    });

    it('laisse Échap au dialogue ouvert', () => {
        toggleSplit();
        const dialog = document.createElement('dialog');
        dialog.open = true;
        document.body.appendChild(dialog);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(document.body.classList.contains('is-split')).toBe(true);
    });

    it('ferme l\'écran scindé si le plein écran est quitté', () => {
        toggleSplit();
        // Quitter le plein écran par le navigateur : plus d'élément plein écran.
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
        document.dispatchEvent(new Event('fullscreenchange'));

        expect(document.body.classList.contains('is-split')).toBe(false);
    });

    it('reste scindé si requestFullscreen est refusé', async () => {
        const req = vi.fn(() => Promise.reject(new Error('refus')));
        Object.defineProperty(document.documentElement, 'requestFullscreen', {
            value: req, configurable: true, writable: true,
        });

        toggleSplit();
        await Promise.resolve();

        expect(req).toHaveBeenCalled();
        expect(document.body.classList.contains('is-split')).toBe(true);
    });
});

describe('mise à jour permanente', () => {
    it('repeint les deux panneaux à chaque écriture de données', () => {
        toggleSplit();
        const log = vi.spyOn(UI, 'renderLogTable');
        log.mockClear();

        Storage.saveLogData([]);

        expect(log).toHaveBeenCalled();
        log.mockRestore();
    });

    it('ne repeint rien quand l\'écran n\'est pas scindé', () => {
        const log = vi.spyOn(UI, 'renderLogTable');
        log.mockClear();

        Storage.saveCollection('pcTacAdversaires', []);

        expect(log).not.toHaveBeenCalled();
        log.mockRestore();
    });
});
