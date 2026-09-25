/**
 * reset-flow.ts — Décision du RESET (décision 28).
 *
 * Deux voies :
 *   - « Exporter l'archive puis effacer » : l'export DOIT réussir avant que
 *     quoi que ce soit soit effacé. Un échec d'export (`'export-failed'`)
 *     n'efface RIEN et laisse l'appelant annoncer l'erreur. Après le
 *     téléchargement, une confirmation explicite (R17) demande si le fichier a
 *     bien été enregistré ; « Pas encore » (`'cancelled'`) n'efface rien. Le
 *     rechargement (dans `performReset`) attend le délai de révocation de l'URL
 *     blob (`revokeDelayMs`).
 *   - « Effacer sans archive » : effacement direct, sans export.
 *
 * La logique est isolée du DOM pour être testée : `main.ts` fournit `exportZip`
 * (`Archive.exportZip`), `confirm` (fenêtre de confirmation) et `performReset`
 * (le nettoyage réel).
 */

/** Issue d'un RESET avec archive. */
export type ResetOutcome = 'reset' | 'cancelled' | 'export-failed';

export async function resetWithArchive(
  exportZip: () => Promise<boolean>,
  performReset: () => void | Promise<void>,
  confirm?: () => boolean | Promise<boolean>,
  revokeDelayMs = 0,
): Promise<ResetOutcome> {
  const exported = await exportZip();
  if (!exported) return 'export-failed';
  // R17 — confirmation explicite après le téléchargement : ne jamais effacer
  // sur la seule foi d'un clic de téléchargement (annulation de la boîte
  // « Enregistrer sous », stockage plein, téléchargement bloqué).
  if (confirm && !(await confirm())) return 'cancelled';
  // R17 — `Archive.exportZip` révoque l'URL blob 2 s après le clic ; on ne
  // recharge qu'après ce délai, sinon le déchargement l'annule.
  if (revokeDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, revokeDelayMs));
  await performReset();
  return 'reset';
}
