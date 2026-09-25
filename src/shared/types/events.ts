/**
 * events.ts — Évènements DOM personnalisés de PC-Tac (décision 29).
 *
 * Déclarés ici pour qu'`addEventListener` type le `detail` partout :
 *   - `pctac:data`       : une zone de données vient d'être écrite (locale, par
 *     `storage.ts`, ou distante, par `tab-sync.ts`) ;
 *   - `pctac:image`      : une image d'`ImageStore` a changé dans un autre onglet ;
 *   - `pctac:add-point`  : demande d'ajout d'un point sur le plan (lots B et C).
 *
 * `remote` distingue une écriture locale d'une écriture venue d'un autre onglet.
 */

export {};

declare global {
  interface DocumentEventMap {
    'pctac:data': CustomEvent<{ key: string; remote?: boolean }>;
    'pctac:image': CustomEvent<{ id: string; op: 'put' | 'delete'; remote: true }>;
    'pctac:add-point': CustomEvent<{ lat: number; lon: number; label: string }>;
  }
}
