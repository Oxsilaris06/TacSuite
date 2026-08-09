/**
 * busy.ts — Overlay de chargement générique PC-Tac (export PDF, archive,
 * capture carte). Reprend le pattern déjà en place côté OI (`#pdfLoadingModal`
 * / `.pdf-spinner`, `oi/index.html:972`, `styles/oi.css:3573-3611`, piloté
 * par `src/apps/oi/pdf/engine-v3.ts`) : un seul overlay plein écran, visibilité
 * pilotée en `style.display` inline (pas de framework réactif dans cette app).
 *
 * Contrat volontairement minimal : `showBusy(message)` / `hideBusy()`, pensé
 * pour un usage `try { showBusy(...); … } finally { hideBusy(); }` à l'appel
 * de haut niveau de chaque opération longue. Module pur ESM (pas de global
 * `window.*`) : aucun appelant HTML inline n'en a besoin, seuls des modules
 * TS l'importent (cf. `src/apps/pctac/pdf-export.ts`, `archive.ts`,
 * `planmap/chrome.ts`).
 *
 * Compteur de profondeur : deux opérations qui se chevauchent (improbable en
 * pratique, mais un `hideBusy()` doit rester sûr même appelé sans `showBusy()`
 * préalable) ne doivent pas se marcher dessus — seul le dernier `hideBusy()`
 * masque réellement l'overlay.
 */

let depth = 0;

function getOverlay(): HTMLElement | null {
    return document.getElementById('pctacBusyOverlay');
}

function getMessageEl(): HTMLElement | null {
    return document.getElementById('pctacBusyMessage');
}

/** Affiche l'overlay busy avec `message` (remplace le message si déjà visible). */
export function showBusy(message = 'Chargement…'): void {
    depth += 1;
    const messageEl = getMessageEl();
    if (messageEl) messageEl.textContent = message;
    const overlay = getOverlay();
    if (overlay) overlay.style.display = 'flex';
}

/** Masque l'overlay busy. Sûr à appeler même sans `showBusy()` préalable. */
export function hideBusy(): void {
    depth = Math.max(0, depth - 1);
    if (depth > 0) return;
    const overlay = getOverlay();
    if (overlay) overlay.style.display = 'none';
}
