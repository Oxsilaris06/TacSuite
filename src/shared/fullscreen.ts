/**
 * fullscreen.ts — plein écran d'un conteneur (carte), avec repli.
 *
 * Safari sur iPhone n'expose pas l'API Fullscreen (seul l'iPad l'a). Sans elle,
 * ou si la demande est refusée, le conteneur est agrandi à la taille de
 * l'écran par une classe CSS. Les écouteurs suivent les deux cas par
 * `FULLSCREEN_CHANGE_EVENT`, émis sur `document` à chaque bascule du repli ;
 * le plein écran natif garde ses événements `fullscreenchange`.
 */

const PSEUDO_CLASS = 'tac-pseudo-fullscreen';
const OPEN_CLASS = 'tac-pseudo-fullscreen-open';
const STYLE_ID = 'tac-pseudo-fullscreen-styles';

/** Émis sur `document` quand le repli entre ou sort. */
export const FULLSCREEN_CHANGE_EVENT = 'tac-fullscreenchange';

type WebkitDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** Élément en plein écran, natif ou repli ; `null` sinon. */
export function fullscreenElement(): Element | null {
    const doc = document as WebkitDocument;
    return doc.fullscreenElement || doc.webkitFullscreenElement || document.querySelector(`.${PSEUDO_CLASS}`);
}

function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.${PSEUDO_CLASS} {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  height: 100dvh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  z-index: 2147482000 !important;
  background: #000;
}
html.${OPEN_CLASS}, html.${OPEN_CLASS} body { overflow: hidden !important; }
`;
    document.head.appendChild(style);
}

function setPseudo(container: HTMLElement, on: boolean): void {
    if (on) injectStyles();
    container.classList.toggle(PSEUDO_CLASS, on);
    document.documentElement.classList.toggle(OPEN_CLASS, on);
    document.dispatchEvent(new Event(FULLSCREEN_CHANGE_EVENT));
}

/** Sort du plein écran, natif ou repli ; sans effet hors plein écran. */
export async function exitFullscreen(): Promise<void> {
    const current = fullscreenElement();
    if (!current) return;
    if (current.classList.contains(PSEUDO_CLASS)) { setPseudo(current as HTMLElement, false); return; }
    const doc = document as WebkitDocument;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) { try { await exit.call(doc); } catch { /* déjà sorti */ } }
}

/** Bascule `container` en plein écran (natif si possible, repli sinon), ou en sort. */
export async function toggleFullscreen(container: HTMLElement): Promise<void> {
    if (fullscreenElement()) { await exitFullscreen(); return; }
    const el = container as WebkitElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
        try { await req.call(el); return; } catch { /* refusé : repli */ }
    }
    setPseudo(container, true);
}
