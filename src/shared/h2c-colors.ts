/**
 * h2c-colors.ts — Couleurs lisibles par html2canvas.
 *
 * html2canvas 1.4 ne sait pas lire `color(srgb …)`, la forme CALCULÉE de
 * `color-mix(in srgb, …)` dans Chrome et Firefox : toute capture d'un
 * conteneur qui en contient échouait (« Attempting to parse an unsupported
 * color function "color" »), même pour un panneau masqué. Appelé dans
 * `onclone`, `legacyCaptureColors` réécrit ces valeurs en `rgba()` sur le
 * CLONE seulement : la page ne change pas, et une future couleur en
 * `color-mix()` reste capturable.
 */

const PROPS = [
    'color', 'background-color', 'background-image',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'box-shadow', 'text-shadow', 'fill', 'stroke',
];

const SRGB = /color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([-\d.e]+%?))?\s*\)/g;

/** `color(srgb r g b / a)` (0..1) → `rgba(R, G, B, a)`, partout dans la valeur. */
export function srgbToRgba(value: string): string {
    return value.replace(SRGB, (_m, r: string, g: string, b: string, a?: string) => {
        const c = (x: string): number => Math.round(Math.min(1, Math.max(0, Number(x))) * 255);
        const alpha = a === undefined ? 1 : a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a);
        return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${alpha})`;
    });
}

/** Réécrit en rgba() les couleurs `color(srgb …)` de `root` et de ses descendants (clone html2canvas). */
export function legacyCaptureColors(root: Element | null): void {
    const win = root?.ownerDocument.defaultView;
    if (!root || !win) return;
    for (const el of [root, ...root.querySelectorAll('*')]) {
        const style = (el as HTMLElement).style;
        if (!style) continue;
        const cs = win.getComputedStyle(el);
        for (const prop of PROPS) {
            const v = cs.getPropertyValue(prop);
            if (v.includes('color(')) style.setProperty(prop, srgbToRgba(v), 'important');
        }
    }
}
