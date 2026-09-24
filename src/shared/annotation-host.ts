/**
 * annotation-host.ts — Ce que le moteur d'annotation (`@oi/dessin.js`)
 * demande à l'application qui l'héberge (décision 25 : même annotation dans
 * l'OI et le PC-Tac).
 *
 * Le moteur n'importe plus `@oi/init.js` : son Store s'enregistre dans
 * `tactical_oi_data`, et le PC-Tac, sur la même origine, écraserait l'OI en
 * cours de rédaction. L'OI branche ici son Store et sa base (init.ts), le
 * PC-Tac les siens. Module sans effet de bord.
 */
import type { OiAnnotation } from '@shared/types/contracts.js';

export interface AnnotationHost {
    /** Annotations de la photo ouverte, lues et remplacées par le moteur. */
    annotations: OiAnnotation[];
    /** URL `blob:` déjà créées, par id d'aperçu. */
    objectUrlsCache: Record<string, string>;
    /** Image d'un aperçu qui n'a pas encore d'URL `blob:`. */
    getImage(previewId: string): Promise<Blob | null | undefined>;
    /** Après chaque modification des annotations de l'aperçu ouvert. */
    save(): void;
    /** Outil Membre (OI) : relit le formulaire après la pose d'un membre. */
    syncDom(): void;
    /** Fenêtre d'annotation fermée (Enregistrer ou Annuler). */
    closed?(previewId: string): void | Promise<void>;
}

/** Hôte par défaut : rien n'est lu ni écrit hors de la photo ouverte. */
export let annotationHost: AnnotationHost = {
    annotations: [],
    objectUrlsCache: {},
    async getImage() { return null; },
    save() {},
    syncDom() {},
};

export function setAnnotationHost(host: AnnotationHost): void {
    annotationHost = host;
}
