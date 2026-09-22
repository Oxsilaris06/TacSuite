/**
 * loader.ts — Sphère d'attente du chargeur PDF de l'OI (`#pdfLoadingModal`).
 *
 * Le chargeur est affiché et masqué par plusieurs modules, chacun posant
 * directement `loader.style.display`. Plutôt que d'ajouter un appel de montage
 * et un de démontage à chaque endroit (et d'en oublier un le jour où un
 * nouveau chemin apparaît), on OBSERVE l'attribut `style` du chargeur : la
 * sphère se monte quand il devient visible, s'arrête quand il disparaît.
 *
 * C'est le seul point du code à connaître l'existence de la sphère côté OI, et
 * aucun appelant n'a été modifié.
 */

import { mountOrb, type OrbHandle } from '@shared/orb.js';

let orb: OrbHandle | null = null;

function isVisible(el: HTMLElement): boolean {
    return el.style.display !== '' && el.style.display !== 'none';
}

function sync(loader: HTMLElement): void {
    if (isVisible(loader)) {
        // C9 — signale l'attente aux technologies d'assistance (role="status").
        loader.setAttribute('aria-busy', 'true');
        // Monté APRÈS l'affichage : un canvas dans un parent masqué mesure zéro.
        if (!orb) orb = mountOrb(document.getElementById('pdfLoadingOrb') as HTMLCanvasElement | null);
        return;
    }
    loader.removeAttribute('aria-busy');
    orb?.stop();
    orb = null;
}

/**
 * Branche l'observation. Sans `#pdfLoadingModal` dans le document, ne fait
 * rien — le chargeur reste ce qu'il était, sans sphère.
 */
export function initPdfLoaderOrb(): void {
    const loader = document.getElementById('pdfLoadingModal');
    if (!loader || typeof MutationObserver !== 'function') return;

    new MutationObserver(() => sync(loader)).observe(loader, {
        attributes: true,
        attributeFilter: ['style'],
    });
    // Le chargeur peut déjà être visible si une génération est en cours au
    // moment du câblage (rechargement à chaud en développement).
    sync(loader);
}
