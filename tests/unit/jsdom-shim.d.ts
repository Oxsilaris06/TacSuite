/**
 * jsdom-shim.d.ts — Déclaration minimale de `jsdom` (dépendance de test).
 *
 * `jsdom` est présent (transitivement, via Vitest) mais n'expose pas de types
 * dans ce dépôt. On ne déclare que la surface utilisée par les garde-fous de
 * test (`new JSDOM(html).window.document`).
 */
declare module 'jsdom' {
    export class JSDOM {
        constructor(html: string, options?: unknown);
        readonly window: { document: Document };
    }
}
